/**
 * The JSON API (the route table in `shared/contract.ts`). Every request reaching here has already
 * passed the security gate in `security.ts`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  ApiError,
  ApiErrorCode,
  AppPrefs,
  AppStore,
  Bootstrap,
  BrainHealth,
  BrainReaders,
  EngineHealth,
  Identity,
  PermissionReply,
  QuestionReply,
  StartSessionRequest,
  TodoList,
} from '../../shared/contract.ts';
import { SessionError, type SessionManager } from '../engine/session-manager.ts';
import { MAX_BODY_BYTES } from './security.ts';
import { type AppEventHub, openStream } from './stream.ts';

export interface RouteContext {
  brain: BrainReaders;
  store: AppStore;
  sessions: SessionManager;
  hub: AppEventHub;
  /** Built per request: the permission mode is read afresh (A18). */
  engineHealth: () => EngineHealth;
  appVersion: string;
  serverStartedAt: string;
  log: (line: string) => void;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

const STATUS: Record<ApiErrorCode, number> = {
  'bad-request': 400,
  unauthorised: 401,
  forbidden: 403,
  'not-found': 404,
  'not-allowed': 403,
  busy: 409,
  'session-closed': 410,
  'too-many-chats': 409,
  'already-open': 409,
  'engine-missing': 503,
  'brain-missing': 503,
  internal: 500,
};

export function statusFor(code: ApiErrorCode): number {
  return STATUS[code];
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

export function sendError(res: ServerResponse, status: number, code: ApiErrorCode, message: string): void {
  const body: ApiError = { error: { code, message } };
  sendJson(res, status, body);
}

/** Reads a JSON body, refusing anything over the cap. */
export function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, 'bad-request', 'That request is too large.'));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(new HttpError(413, 'bad-request', 'That request is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(
          new HttpError(
            400,
            'bad-request',
            'The app sent something it could not read. Reload the page and try again.',
          ),
        );
      }
    });
    req.on('error', () => {
      if (!failed) reject(new HttpError(400, 'bad-request', 'The request was cut short.'));
    });
  });
}

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

const UNKNOWN_IDENTITY: Identity = { name: '', slug: '', email: null, role: 'unknown', knownMember: false };
const EMPTY_TODOS: TodoList = { mine: [], open: [], othersCount: 0 };
const SKILL_NAME = /^[A-Za-z0-9][\w.:-]{0,127}$/;
const MAX_PINS = 100;

/** `PUT /api/prefs`: only known keys, each of the right type. */
export async function validatePrefsPatch(
  body: unknown,
  brain: Pick<BrainReaders, 'clients'>,
): Promise<Partial<AppPrefs>> {
  const bad = (message: string) => new HttpError(400, 'bad-request', message);
  if (!isRec(body)) throw bad('Those settings were not understood.');
  const patch: Partial<AppPrefs> = {};
  for (const [key, value] of Object.entries(body)) {
    switch (key) {
      case 'pins': {
        if (
          !Array.isArray(value) ||
          value.length > MAX_PINS ||
          !value.every((v) => typeof v === 'string' && SKILL_NAME.test(v))
        ) {
          throw bad('The pinned skills were not understood.');
        }
        patch.pins = [...new Set(value as string[])];
        break;
      }
      case 'lastClient': {
        if (value !== null) {
          const known = typeof value === 'string' && (await brain.clients()).some((c) => c.slug === value);
          if (!known) throw bad('That client is not in the brain.');
        }
        patch.lastClient = value as string | null;
        break;
      }
      case 'todoPanelOpen':
      case 'directWrites': {
        if (typeof value !== 'boolean') throw bad('That setting must be on or off.');
        patch[key] = value;
        break;
      }
      default:
        throw bad('That setting is not one the app knows about.');
    }
  }
  return patch;
}

/**
 * `POST /api/sessions`: each field is checked for type here; the session manager checks the values
 * (the client and the to-do must be in the brain, the past chat must exist).
 */
export function parseStartRequest(body: unknown): StartSessionRequest {
  if (!isRec(body)) throw new HttpError(400, 'bad-request', 'That request was not understood.');
  const out: StartSessionRequest = {};
  for (const key of ['prompt', 'client', 'resume', 'todoId'] as const) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null) {
      if (key !== 'prompt') out[key] = null;
      continue;
    }
    if (typeof value !== 'string')
      throw new HttpError(400, 'bad-request', 'That request was not understood.');
    out[key] = value;
  }
  return out;
}

async function bootstrap(ctx: RouteContext): Promise<Bootstrap> {
  const identity = await safe(ctx.brain.identity(), UNKNOWN_IDENTITY);
  const brainFallback: BrainHealth = {
    ok: false,
    path: ctx.brain.root,
    problems: ['The app could not read your brain folder.'],
  };
  const [brain, skills, clients, usedOften, prefs] = await Promise.all([
    safe(ctx.brain.health(), brainFallback),
    safe(ctx.brain.skills(identity), []),
    safe(ctx.brain.clients(), []),
    safe(ctx.brain.usedOften(identity), []),
    ctx.store.get(),
  ]);
  return {
    appVersion: ctx.appVersion,
    identity,
    brain,
    engine: ctx.engineHealth(),
    skills,
    clients,
    usedOften,
    prefs,
  };
}

async function todos(ctx: RouteContext): Promise<TodoList> {
  const identity = await safe(ctx.brain.identity(), UNKNOWN_IDENTITY);
  return safe(ctx.brain.todos(identity), EMPTY_TODOS);
}

const SESSION_ACTION = /^\/api\/sessions\/([^/]+)\/(messages|permission|answer|interrupt|close)$/;

function methodNotAllowed(): HttpError {
  return new HttpError(405, 'bad-request', 'That is not something this address does.');
}

async function route(req: IncomingMessage, res: ServerResponse, url: URL, ctx: RouteContext): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const path = url.pathname;

  if (path === '/api/bootstrap') {
    if (method !== 'GET') throw methodNotAllowed();
    sendJson(res, 200, await bootstrap(ctx));
    return;
  }

  if (path === '/api/todos') {
    if (method !== 'GET') throw methodNotAllowed();
    sendJson(res, 200, await todos(ctx));
    return;
  }

  if (path === '/api/todos/complete') {
    if (method !== 'POST') throw methodNotAllowed();
    const body = await readJson(req);
    const prefs = await ctx.store.get();
    if (!prefs.directWrites) {
      throw new HttpError(
        403,
        'not-allowed',
        'Ticking to-dos is switched off. Turn on changes to the shared brain in Settings first.',
      );
    }
    const id = isRec(body) ? body.id : undefined;
    if (typeof id !== 'string' || !id || id.length > 255 || /[\\/\0]/.test(id) || id.startsWith('.')) {
      throw new HttpError(400, 'bad-request', 'That to-do was not understood.');
    }
    try {
      await ctx.brain.completeTodo(id, await safe(ctx.brain.identity(), UNKNOWN_IDENTITY));
    } catch {
      throw new HttpError(404, 'not-found', 'That to-do could not be found. It may already be done.');
    }
    ctx.log('Ticked a to-do.');
    sendJson(res, 200, await todos(ctx));
    return;
  }

  if (path === '/api/prefs') {
    if (method !== 'PUT') throw methodNotAllowed();
    const patch = await validatePrefsPatch(await readJson(req), ctx.brain);
    sendJson(res, 200, await ctx.store.update(patch));
    return;
  }

  if (path === '/api/sessions') {
    if (method === 'GET') {
      sendJson(res, 200, await ctx.sessions.list());
      return;
    }
    if (method === 'POST') {
      const session = await ctx.sessions.start(parseStartRequest(await readJson(req)));
      sendJson(res, 200, { session });
      return;
    }
    throw methodNotAllowed();
  }

  const m = SESSION_ACTION.exec(path);
  if (m?.[1] && m[2]) {
    if (method !== 'POST') throw methodNotAllowed();
    let id: string;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      throw new HttpError(400, 'bad-request', 'That chat was not understood.');
    }
    const body = await readJson(req);
    if (!isRec(body)) throw new HttpError(400, 'bad-request', 'That request was not understood.');
    switch (m[2]) {
      case 'messages':
        await ctx.sessions.send(id, body.text as string); // validated by the session manager
        break;
      case 'permission':
        await ctx.sessions.replyPermission(id, body as unknown as PermissionReply);
        break;
      case 'answer':
        await ctx.sessions.replyQuestion(id, body as unknown as QuestionReply);
        break;
      case 'interrupt':
        await ctx.sessions.interrupt(id);
        break;
      case 'close':
        await ctx.sessions.close(id);
        break;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (path === '/api/stream') {
    if (method !== 'GET') throw methodNotAllowed();
    openStream(req, res, url, { sessions: ctx.sessions, hub: ctx.hub, serverStartedAt: ctx.serverStartedAt });
    return;
  }

  throw new HttpError(404, 'not-found', 'There is nothing at that address.');
}

export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: RouteContext,
): Promise<void> {
  try {
    await route(req, res, url, ctx);
  } catch (err) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (err instanceof HttpError) {
      sendError(res, err.status, err.code, err.message);
    } else if (err instanceof SessionError) {
      sendError(res, statusFor(err.code), err.code, err.message);
    } else {
      ctx.log('An API request failed unexpectedly.');
      sendError(
        res,
        500,
        'internal',
        'Something went wrong in the app. Try again, and tell a scout if it keeps happening.',
      );
    }
  }
}
