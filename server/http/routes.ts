/**
 * The JSON API (the route table in `shared/contract.ts`). Every request reaching here has already
 * passed the security gate in `security.ts`.
 */
import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import {
  type ApiError,
  type ApiErrorCode,
  type AppPrefs,
  type AppStore,
  type Bootstrap,
  type BrainHealth,
  type BrainReaders,
  type ChangelogResponse,
  CLIENT_PICK_REPORTED,
  type ClientGuessResponse,
  type ClientPickReported,
  type EngineHealth,
  type Identity,
  LIBRARY_SEARCH_QUERY,
  type LibraryFile,
  type LibrarySearchResponse,
  type LibraryText,
  MAX_ATTACHMENTS,
  type MemberProfile,
  type PermissionReply,
  type QuestionReply,
  ROUTES,
  type StartSessionRequest,
  type SyncStatus,
  THUMB_WIDTHS,
  type Thumbnailer,
  type ThumbWidth,
  TODO_SEEN_MAX,
  type TodoAction,
  TodoChangeError,
  type TodoList,
  type TodoScope,
  UPLOAD_NAME_HEADER,
  type UploadResponse,
  type VersionNotes,
} from '../../shared/contract.ts';
import { type AppState, SETUP_ROUTES, type SetupService } from '../../shared/install-contract.ts';
import {
  UPDATE_CHECK_EVERY_MS,
  UpdateRefused,
  type Updater,
  type UpdateStatus,
} from '../../shared/update-contract.ts';
import { readClientAliases } from '../brain/client-aliases.ts';
import { parseFrontmatter } from '../brain/frontmatter.ts';
import { openChecked, PAGE_MAX_BYTES, readChecked, TEXT_MAX_BYTES } from '../brain/library.ts';
import { TODO_CHANGE_MESSAGES } from '../brain/todo-skill.ts';
import {
  CLIENT_GUESS_MAX_CHARS,
  type ClientAlias,
  createClientGuesser,
  type JevAsk,
} from '../engine/client-guess.ts';
import { jevFromBrain } from '../engine/jev.ts';
import { SessionError, type SessionManager } from '../engine/session-manager.ts';
import { type ClientPickTally, guessOutcome } from '../store/client-pick-tally.ts';
import { UploadError, type UploadErrorCode, type UploadStaging } from '../uploads/staging.ts';
import {
  hasValidSession,
  isLibraryPagePath,
  MAX_BODY_BYTES,
  PAGE_CSP,
  PDF_CSP,
  sessionSetCookie,
} from './security.ts';
import { type AppEventHub, openStream } from './stream.ts';

export interface RouteContext {
  brain: BrainReaders;
  store: AppStore;
  sessions: SessionManager;
  hub: AppEventHub;
  /** Makes and caches the library's small pictures, in the app's data folder. */
  thumbs: Thumbnailer;
  /** Chat attachments waiting in the app's data folder. */
  uploads: UploadStaging;
  /** Built per request: the permission mode is read afresh (A18). */
  engineHealth: () => EngineHealth;
  /** What start-up decided about the brain (setup-screen plan, decision 3). */
  appState: AppState;
  /** Choosing the brain folder; available in both states (decision 4). */
  setup: SetupService;
  appVersion: string;
  /** The app's own version history, newest first (from its CHANGELOG.md, never the brain). */
  changelog: () => Promise<VersionNotes[]>;
  /** In-app updates. Absent: the routes say this copy can't update itself (`not-service`). */
  updater?: Updater;
  /** True when running as the login service (`TDS_BRAIN_SERVICE=1`). */
  underService: boolean;
  serverStartedAt: string;
  /** Only to renew the session cookie on `GET /api/bootstrap` (decision 6a). */
  launchToken: string;
  /** The port the app listens on; the session cookie's name depends on it (`sessionCookieName`). */
  port: number;
  log: (line: string) => void;
  /**
   * Works out a new chat's client (`POST /api/client-guess`). Absent: one guesser per brain, asking
   * Jev with the config read from the brain at call time (`jevFromBrain`).
   */
  clientGuess?: (text: string, clients: ClientAlias[]) => Promise<ClientGuessResponse>;
  /** Counts how each new chat's client was decided, in the app's data folder. Absent: nothing is counted. */
  clientPickTally?: ClientPickTally;
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
  changed: 409,
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

const UNKNOWN_IDENTITY: Identity = {
  name: '',
  slug: '',
  email: null,
  role: 'unknown',
  knownMember: false,
};
const EMPTY_PROFILE: MemberProfile = { title: null, departments: [], owns: null };
const EMPTY_TODOS: TodoList = {
  mine: [],
  open: [],
  othersCount: 0,
  team: [],
  changes: 'no-skill',
  canAddOpen: false,
  canUsePersonal: false,
};
const SKILL_NAME = /^[A-Za-z0-9][\w.:-]{0,127}$/;
const MAX_PINS = 100;
const SEEN_KEY_MAX = 300;
const SEEN_VALUE_MAX = 40;

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
      case 'todoSeen': {
        const entries = isRec(value) ? Object.entries(value) : null;
        if (
          entries === null ||
          entries.length > TODO_SEEN_MAX ||
          !entries.every(
            ([k, v]) =>
              k !== '' &&
              k.length <= SEEN_KEY_MAX &&
              typeof v === 'string' &&
              v !== '' &&
              v.length <= SEEN_VALUE_MAX,
          )
        ) {
          throw bad('The list of to-dos you have seen was not understood.');
        }
        patch.todoSeen = Object.fromEntries(entries as [string, string][]);
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

const MAX_ID_CHARS = 100;

/** `attachments` on a new chat or a message: absent or null (none), or a list of at most MAX_ATTACHMENTS ids. */
export function parseAttachments(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.length > MAX_ATTACHMENTS ||
    !value.every((v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_CHARS)
  ) {
    throw new HttpError(
      400,
      'bad-request',
      `The attached files were not understood. A message can carry up to ${MAX_ATTACHMENTS} files.`,
    );
  }
  return value as string[];
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
  if ('attachments' in body) out.attachments = parseAttachments(body.attachments);
  return out;
}

/** The longest message a chat accepts (session-manager's MAX_PROMPT_CHARS). */
const CLIENT_GUESS_MAX_TEXT = 100_000;

/**
 * `POST /api/client-guess`: `{text}` (ClientGuessRequest), any text up to the chat limit; only the
 * first CLIENT_GUESS_MAX_CHARS are used. Empty text is allowed (the guess is then `none`).
 */
export function parseClientGuessRequest(body: unknown): string {
  if (!isRec(body) || typeof body.text !== 'string')
    throw new HttpError(400, 'bad-request', 'That request was not understood.');
  if (body.text.length > CLIENT_GUESS_MAX_TEXT)
    throw new HttpError(400, 'bad-request', 'That message is too long to send.');
  return body.text.slice(0, CLIENT_GUESS_MAX_CHARS);
}

/** One guesser per brain, so Jev's 60-second back-off after a failure holds across requests. */
const guessers = new WeakMap<BrainReaders, NonNullable<RouteContext['clientGuess']>>();

function clientGuesser(ctx: RouteContext): NonNullable<RouteContext['clientGuess']> {
  if (ctx.clientGuess) return ctx.clientGuess;
  let guess = guessers.get(ctx.brain);
  if (!guess) {
    const root = ctx.brain.root;
    // Config is read on every ask, so setting Jev up needs no restart; no config counts as a failure.
    const ask: JevAsk = async (state, criteria, signal) =>
      (await jevFromBrain(root, process.env)?.(state, criteria, signal)) ?? null;
    guess = createClientGuesser({ ask });
    guessers.set(ctx.brain, guess);
  }
  return guess;
}

// ---------------------------------------------------------------------------
// Uploads. The gate lets raw bytes through on exactly POST /api/uploads; nothing else here reads
// a body that is not JSON.
// ---------------------------------------------------------------------------

const UPLOAD_STATUS: Record<UploadErrorCode, [number, ApiErrorCode]> = {
  off: [403, 'not-allowed'],
  'bad-name': [400, 'bad-request'],
  'bad-type': [400, 'bad-request'],
  'no-length': [411, 'bad-request'],
  'too-large': [413, 'bad-request'],
  full: [409, 'busy'],
  busy: [409, 'busy'],
  aborted: [400, 'bad-request'],
  'no-space': [507, 'internal'],
  gone: [400, 'bad-request'],
  failed: [500, 'internal'],
};

const UPLOAD_DISCARD = /^\/api\/uploads\/([^/]+)\/discard$/;

function headerText(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

async function uploadFile(req: IncomingMessage, res: ServerResponse, ctx: RouteContext): Promise<void> {
  // Whatever goes wrong, the rest of the body is never read: close the connection after the reply.
  try {
    const type = headerText(req, 'content-type')?.split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/octet-stream') {
      throw new HttpError(
        415,
        'bad-request',
        'The app sent that in the wrong format. Reload the page and try again.',
      );
    }
    // No length is refused with 411 by the staging folder, after the name and type checks.
    const rawLength = headerText(req, 'content-length');
    const declared = rawLength === undefined ? null : /^\d{1,15}$/.test(rawLength) ? Number(rawLength) : -1;
    if (declared === -1) throw new HttpError(400, 'bad-request', 'That file could not be read. Try again.');
    const upload = await ctx.uploads.save(req, headerText(req, UPLOAD_NAME_HEADER), declared);
    const body: UploadResponse = { upload };
    sendJson(res, 200, body);
  } catch (err) {
    if (!res.headersSent) res.setHeader('Connection', 'close');
    if (err instanceof UploadError) {
      const [status, code] = UPLOAD_STATUS[err.code];
      throw new HttpError(status, code, err.message);
    }
    throw err;
  }
}

async function bootstrap(ctx: RouteContext): Promise<Bootstrap> {
  const identity = await safe(ctx.brain.identity(), UNKNOWN_IDENTITY);
  const brainFallback: BrainHealth = {
    ok: false,
    path: ctx.brain.root,
    problems: ['The app could not read your brain folder.'],
  };
  const [brain, profile, skills, clients, usedOften, prefs] = await Promise.all([
    safe(ctx.brain.health(), brainFallback),
    safe(ctx.brain.profile(identity), EMPTY_PROFILE),
    safe(ctx.brain.skills(identity), []),
    safe(ctx.brain.clients(), []),
    safe(ctx.brain.usedOften(identity), []),
    ctx.store.get(),
  ]);
  return {
    appVersion: ctx.appVersion,
    appState: ctx.appState,
    service: { underService: ctx.underService },
    identity,
    profile,
    brain,
    engine: ctx.engineHealth(),
    skills,
    clients,
    usedOften,
    prefs,
  };
}

/** A pasted path is at most this many bytes; longer is never a real folder. */
const MAX_SETUP_PATH_BYTES = 4096;

/** `PUT /api/setup/brain`: `{ path }`, a string of at most 4 KB. The setup service tidies and checks it. */
export function parseSetBrainRequest(body: unknown): string {
  const path = isRec(body) ? body.path : undefined;
  if (typeof path !== 'string' || Buffer.byteLength(path, 'utf8') > MAX_SETUP_PATH_BYTES) {
    throw new HttpError(400, 'bad-request', 'That folder path was not understood.');
  }
  return path;
}

/** The to-do list, with 'on' turned into 'switched-off' while the Settings switch is off. */
async function todos(ctx: RouteContext): Promise<TodoList> {
  const identity = await safe(ctx.brain.identity(), UNKNOWN_IDENTITY);
  const list = await safe(ctx.brain.todos(identity), EMPTY_TODOS);
  if (list.changes !== 'on') return list;
  const prefs = await safe(ctx.store.get(), null);
  return prefs?.directWrites === true ? list : { ...list, changes: 'switched-off', canUsePersonal: false };
}

const TODO_SWITCHED_OFF =
  "Adding and editing to-dos is switched off. Turn on 'Let the app change to-dos' in Settings.";

/** Each action's fields besides `kind`: required text, text or null, or optional text. */
const TODO_SHAPES: Record<TodoAction['kind'], Record<string, 'text' | 'text-or-null' | 'optional-text'>> = {
  add: { title: 'text', due: 'text-or-null', assignee: 'text-or-null', scope: 'optional-text' },
  edit: {
    id: 'text',
    title: 'text',
    details: 'optional-text',
    expect: 'optional-text',
    scope: 'optional-text',
  },
  due: { id: 'text', due: 'text-or-null', expect: 'optional-text', scope: 'optional-text' },
  assignee: { id: 'text', assignee: 'text-or-null', expect: 'optional-text', scope: 'optional-text' },
  delete: { id: 'text', expect: 'optional-text', scope: 'optional-text' },
  move: { id: 'text', scope: 'text', to: 'text', expect: 'optional-text' },
};

const isTodoScope = (v: unknown): v is TodoScope => v === 'tds' || v === 'personal';

/**
 * `POST /api/todos/change`: exactly one TodoAction shape, no other fields. `scope` and `to` must be
 * 'tds' or 'personal'. The other values (lengths, date, slug, id) are checked by `BrainReaders.changeTodo`.
 */
export function parseTodoAction(body: unknown): TodoAction {
  const bad = () => new HttpError(400, 'bad-request', TODO_CHANGE_MESSAGES['bad-request']);
  if (!isRec(body) || typeof body.kind !== 'string' || !Object.hasOwn(TODO_SHAPES, body.kind)) throw bad();
  const shape = TODO_SHAPES[body.kind as TodoAction['kind']];
  for (const key of Object.keys(body)) {
    if (key !== 'kind' && !Object.hasOwn(shape, key)) throw bad();
  }
  const action: Record<string, unknown> = { kind: body.kind };
  for (const [key, type] of Object.entries(shape)) {
    const v = body[key];
    if (type === 'optional-text' && v === undefined) continue;
    if (!(typeof v === 'string' || (type === 'text-or-null' && v === null))) throw bad();
    if ((key === 'scope' || key === 'to') && !isTodoScope(v)) throw bad();
    action[key] = v;
  }
  return action as unknown as TodoAction;
}

// ---------------------------------------------------------------------------
// The library (read-only). The browser only ever sends an id; the brain readers map it to a file
// they have checked, and each route then checks the item suits it.
// ---------------------------------------------------------------------------

const LIBRARY_ITEM = /^\/api\/library\/(thumb|text|page|pdf|file)\/([^/]+)$/;
/** A download is never run or shown, even if something opens it in place of saving it. */
const DOWNLOAD_CSP = "sandbox; default-src 'none'";
const THUMB_CACHE = 'private, max-age=31536000, immutable';
const NOT_FOUND = 'That file could not be found. It may have been moved or deleted.';
const WRONG_VIEW = 'That file cannot be opened that way.';

function decodeId(raw: string): string | null {
  try {
    const id = decodeURIComponent(raw);
    return id.length > 0 && id.length <= 400 ? id : null;
  } catch {
    return null;
  }
}

async function libraryFile(ctx: RouteContext, rawId: string): Promise<LibraryFile> {
  const id = decodeId(rawId);
  const file = id ? await safe(ctx.brain.libraryFile(id), null) : null;
  if (!file) throw new HttpError(404, 'not-found', NOT_FOUND);
  return file;
}

function thumbWidth(raw: string | null): ThumbWidth {
  const n = raw !== null && /^[1-9][0-9]{0,4}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(THUMB_WIDTHS as readonly number[]).includes(n)) {
    throw new HttpError(400, 'bad-request', 'That picture size is not one the app makes.');
  }
  return n as ThumbWidth;
}

async function sendThumb(res: ServerResponse, url: URL, rawId: string, ctx: RouteContext): Promise<void> {
  const width = thumbWidth(url.searchParams.get('w'));
  const file = await libraryFile(ctx, rawId);
  if (!file.item.thumb) throw new HttpError(400, 'bad-request', 'There is no picture of that file.');
  const path = await safe(ctx.thumbs.get(file, width), null);
  const data = path ? await safe(fs.readFile(path), null) : null;
  if (!data) throw new HttpError(404, 'not-found', 'A picture of that file could not be made.');
  res.writeHead(200, {
    'Content-Type': 'image/webp',
    'Cache-Control': THUMB_CACHE,
    'Content-Length': data.length,
  });
  res.end(data);
}

async function sendText(res: ServerResponse, rawId: string, ctx: RouteContext): Promise<void> {
  const file = await libraryFile(ctx, rawId);
  if (file.item.view !== 'text') throw new HttpError(400, 'bad-request', WRONG_VIEW);
  const read = await readChecked(file, TEXT_MAX_BYTES);
  if (!read) throw new HttpError(404, 'not-found', NOT_FOUND);
  // A cut can fall inside a character: the decoder keeps only whole ones.
  const text = new StringDecoder('utf8').write(read.data);
  const body: LibraryText = { text: parseFrontmatter(text).body, truncated: read.truncated };
  sendJson(res, 200, body);
}

/**
 * `attachment` (or `inline`) with a plain-ASCII name for old browsers and the exact name as UTF-8
 * (RFC 6266 and RFC 8187). Quotes, backslashes, controls and anything outside printable ASCII become
 * `_` in the plain one.
 */
export function attachmentHeader(name: string, disposition: 'attachment' | 'inline' = 'attachment'): string {
  const plain = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const exact = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${plain}"; filename*=UTF-8''${exact}`;
}

/** A real PDF has `%PDF-` within its first 1 KB (where readers look for it). */
const PDF_HEAD_BYTES = 1024;

async function sendDownload(res: ServerResponse, rawId: string, ctx: RouteContext): Promise<void> {
  const file = await libraryFile(ctx, rawId);
  const sent = await sendWhole(res, file, {
    'Content-Security-Policy': DOWNLOAD_CSP,
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': attachmentHeader(file.item.name),
  });
  if (!sent) throw new HttpError(404, 'not-found', NOT_FOUND);
}

/** The PDF route. Like the page route, its errors are a small page, since a frame shows them. */
async function sendPdf(req: IncomingMessage, res: ServerResponse, rawId: string, ctx: RouteContext) {
  try {
    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      sendPageError(res, 405, 'That is not something this address does.');
      return;
    }
    const id = decodeId(rawId);
    const file = id ? await safe(ctx.brain.libraryFile(id), null) : null;
    if (!file) {
      sendPageError(res, 404, NOT_FOUND);
      return;
    }
    if (file.item.view !== 'pdf') {
      sendPageError(res, 400, WRONG_VIEW);
      return;
    }
    const head = await readChecked(file, PDF_HEAD_BYTES);
    if (!head) {
      sendPageError(res, 404, NOT_FOUND);
      return;
    }
    // A file named .pdf that is something else (a web page, say) is never handed to the browser to show.
    if (!head.data.includes('%PDF-', 0, 'latin1')) {
      sendPageError(res, 400, 'That file is not a PDF the app can show. Download it instead.');
      return;
    }
    const sent = await sendWhole(res, file, {
      'Content-Security-Policy': PDF_CSP,
      'Content-Type': 'application/pdf',
      'Content-Disposition': attachmentHeader(file.item.name, 'inline'),
    });
    if (!sent) sendPageError(res, 404, NOT_FOUND);
  } catch {
    if (res.headersSent) res.end();
    else sendPageError(res, 500, 'Something went wrong in the app. Try again.');
  }
}

/**
 * Streams a checked file whole, with `nosniff` and `no-store` added to the headers given. False,
 * having sent nothing, when the file is no longer the one that was checked.
 */
async function sendWhole(
  res: ServerResponse,
  file: LibraryFile,
  headers: { 'Content-Security-Policy': string; 'Content-Type': string; 'Content-Disposition': string },
): Promise<boolean> {
  const opened = await openChecked(file);
  if (!opened) return false;
  const { handle, size } = opened;
  try {
    res.setHeader('Content-Security-Policy', headers['Content-Security-Policy']);
    res.writeHead(200, {
      ...headers,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Content-Length': size,
    });
    if (size === 0) res.end();
    // Exactly the bytes the length promised, even if the file grows while it is being sent.
    else await pipeline(handle.createReadStream({ start: 0, end: size - 1, autoClose: false }), res);
    return true;
  } finally {
    await handle.close().catch(() => {});
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Sends HTML under the page policy, replacing the app's usual one. */
function sendPageHtml(res: ServerResponse, status: number, body: string | Buffer): void {
  const length = typeof body === 'string' ? Buffer.byteLength(body) : body.length;
  res.setHeader('Content-Security-Policy', PAGE_CSP);
  res.writeHead(status, {
    'Content-Security-Policy': PAGE_CSP,
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Length': length,
  });
  res.end(body);
}

/** The page route's errors: a tiny plain page under the same policy, never JSON (a frame shows it). */
export function sendPageError(res: ServerResponse, status: number, message: string): void {
  sendPageHtml(
    res,
    status,
    `<!doctype html>
<html lang="en-GB">
<head><meta charset="utf-8"><title>Cannot show this file</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:2rem;color:#444}</style></head>
<body><p>${escapeHtml(message)}</p></body>
</html>
`,
  );
}

async function sendPage(req: IncomingMessage, res: ServerResponse, rawId: string, ctx: RouteContext) {
  try {
    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      sendPageError(res, 405, 'That is not something this address does.');
      return;
    }
    const id = decodeId(rawId);
    const file = id ? await safe(ctx.brain.libraryFile(id), null) : null;
    if (!file) {
      sendPageError(res, 404, NOT_FOUND);
      return;
    }
    if (file.item.view !== 'page') {
      sendPageError(res, 400, WRONG_VIEW);
      return;
    }
    const read = await readChecked(file, PAGE_MAX_BYTES);
    if (!read) {
      sendPageError(res, 404, NOT_FOUND);
      return;
    }
    if (read.truncated) {
      sendPageError(res, 400, 'That page is too large to open in the app.');
      return;
    }
    sendPageHtml(res, 200, read.data);
  } catch {
    if (res.headersSent) res.end();
    else sendPageError(res, 500, 'Something went wrong in the app. Try again.');
  }
}

async function libraryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: RouteContext,
): Promise<boolean> {
  const method = (req.method ?? 'GET').toUpperCase();
  const path = url.pathname;
  if (isLibraryPagePath(path)) {
    const m = LIBRARY_ITEM.exec(path);
    if (m?.[1] === 'page' && m[2]) await sendPage(req, res, m[2], ctx);
    else if (m?.[1] === 'pdf' && m[2]) await sendPdf(req, res, m[2], ctx);
    else sendPageError(res, 404, NOT_FOUND);
    return true;
  }
  if (path === '/api/library/scopes') {
    if (method !== 'GET') throw methodNotAllowed();
    sendJson(res, 200, await safe(ctx.brain.libraryScopes(), []));
    return true;
  }
  if (path === '/api/library/search') {
    if (method !== 'GET') throw methodNotAllowed();
    const q = (url.searchParams.get('q') ?? '').trim();
    const kind = url.searchParams.get('kind');
    const { min, max } = LIBRARY_SEARCH_QUERY;
    if (q.length < min || q.length > max) {
      throw new HttpError(400, 'bad-request', `Type between ${min} and ${max} characters to search.`);
    }
    if (kind !== 'image' && kind !== 'doc') {
      throw new HttpError(400, 'bad-request', 'Choose whether to search images or documents.');
    }
    const search = ctx.brain.librarySearch;
    const empty: LibrarySearchResponse = { hits: [], total: 0, partial: false };
    sendJson(
      res,
      200,
      search ? await safe(search.call(ctx.brain, q, kind === 'doc' ? 'document' : 'image'), empty) : empty,
    );
    return true;
  }
  if (path === '/api/library') {
    if (method !== 'GET') throw methodNotAllowed();
    const scope = url.searchParams.get('scope');
    if (!scope) throw new HttpError(400, 'bad-request', 'Choose whose files to show.');
    const listing = await safe(ctx.brain.library(scope), null);
    if (!listing) throw new HttpError(404, 'not-found', 'Those files could not be found.');
    sendJson(res, 200, listing);
    return true;
  }
  const m = LIBRARY_ITEM.exec(path);
  if (!m?.[1] || !m[2]) return false;
  if (method !== 'GET') throw methodNotAllowed();
  if (m[1] === 'thumb') await sendThumb(res, url, m[2], ctx);
  else if (m[1] === 'file') await sendDownload(res, m[2], ctx);
  else await sendText(res, m[2], ctx);
  return true;
}

const SESSION_ACTION = /^\/api\/sessions\/([^/]+)\/(messages|permission|answer|interrupt|close)$/;
const SESSION_FILE_CHANGES = /^\/api\/sessions\/([^/]+)\/file-changes\/([^/]+)$/;

function methodNotAllowed(): HttpError {
  return new HttpError(405, 'bad-request', 'That is not something this address does.');
}

/** What the update routes answer when the server was built without an updater. */
function noUpdaterStatus(ctx: RouteContext): UpdateStatus {
  return {
    current: ctx.appVersion,
    latest: null,
    available: false,
    blocked: 'not-service',
    checkedAt: null,
    checkFailed: false,
    unfinished: false,
    phase: 'idle',
    error: null,
    notes: [],
    openChats: 0,
  };
}

/** `GET /api/update`, `POST /api/update/check`, `POST /api/update/start` (in-app updates, decision 6). */
async function updateRoute(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  ctx: RouteContext,
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const updater = ctx.updater;
  // Notes are the version history, so they follow the changelog's rule: owners and scouts only.
  const shape = async (status: UpdateStatus): Promise<UpdateStatus> => {
    const identity = await safe(ctx.brain.identity(), UNKNOWN_IDENTITY);
    const allowed = identity.role === 'owner' || identity.role === 'scout';
    return allowed ? status : { ...status, notes: [] };
  };
  try {
    if (path === ROUTES.updateStatus) {
      if (method !== 'GET') throw methodNotAllowed();
      if (!updater) {
        sendJson(res, 200, noUpdaterStatus(ctx));
        return;
      }
      const status = await updater.status();
      const stale =
        status.checkedAt === null || Date.now() - Date.parse(status.checkedAt) > UPDATE_CHECK_EVERY_MS;
      if (stale && !status.blocked) {
        updater.check().catch(() => {});
      }
      sendJson(res, 200, await shape(status));
      return;
    }
    if (path === ROUTES.updateCheck) {
      if (method !== 'POST') throw methodNotAllowed();
      sendJson(res, 200, await shape(updater ? await updater.check() : noUpdaterStatus(ctx)));
      return;
    }
    if (method !== 'POST') throw methodNotAllowed();
    const body = await readJson(req);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new HttpError(400, 'bad-request', 'That request was not understood.');
    }
    const keys = Object.keys(body);
    if (keys.length !== 1 || (body as { confirm?: unknown }).confirm !== true) {
      throw new HttpError(400, 'bad-request', 'That request was not understood.');
    }
    if (!updater) throw new HttpError(403, 'not-allowed', "This copy of TDS Brain can't update itself.");
    sendJson(res, 202, await shape(await updater.start()));
  } catch (err) {
    if (err instanceof UpdateRefused) {
      if (err.reason === 'busy') throw new HttpError(409, 'busy', 'An update is already running.');
      throw new HttpError(403, 'not-allowed', "This copy of TDS Brain can't update right now.");
    }
    throw err;
  }
}

async function route(req: IncomingMessage, res: ServerResponse, url: URL, ctx: RouteContext): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const path = url.pathname;

  if (path === '/api/bootstrap') {
    if (method !== 'GET') throw methodNotAllowed();
    const body = await bootstrap(ctx);
    // Each visit restarts the cookie's 400 days (6a). The gate already refused anyone without a
    // session; checking again here means a renewal can never be handed out by mistake.
    if (hasValidSession(req.headers.cookie, ctx.launchToken, ctx.port)) {
      res.setHeader('Set-Cookie', sessionSetCookie(ctx.launchToken, ctx.port));
    }
    sendJson(res, 200, body);
    return;
  }

  if (path === SETUP_ROUTES.candidates) {
    if (method !== 'GET') throw methodNotAllowed();
    sendJson(res, 200, await ctx.setup.candidates());
    return;
  }

  if (path === SETUP_ROUTES.brain) {
    if (method !== 'PUT') throw methodNotAllowed();
    const result = await ctx.setup.save(parseSetBrainRequest(await readJson(req)));
    // Only once the answer has gone out, so the page learns it was saved before the server stops.
    if (result.ok && result.restarting) res.once('finish', () => ctx.setup.restart());
    sendJson(res, 200, result);
    return;
  }

  if (path === ROUTES.changelog) {
    if (method !== 'GET') throw methodNotAllowed();
    const identity = await safe(ctx.brain.identity(), UNKNOWN_IDENTITY);
    if (identity.role !== 'owner' && identity.role !== 'scout') {
      throw new HttpError(403, 'not-allowed', 'The version history is for owners and scouts.');
    }
    const body: ChangelogResponse = { versions: await safe(ctx.changelog(), []) };
    sendJson(res, 200, body);
    return;
  }

  if (path === ROUTES.updateStatus || path === ROUTES.updateCheck || path === ROUTES.updateStart) {
    await updateRoute(req, res, path, ctx);
    return;
  }

  if (path === '/api/brain/sync') {
    if (method !== 'GET') throw methodNotAllowed();
    const body: SyncStatus = await safe(ctx.brain.sync(), { lastSync: null });
    sendJson(res, 200, body);
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
    const scope = isRec(body) ? body.scope : undefined;
    const expect = isRec(body) ? body.expect : undefined;
    if (
      (scope !== undefined && !isTodoScope(scope)) ||
      (expect !== undefined && typeof expect !== 'string')
    ) {
      throw new HttpError(400, 'bad-request', 'That to-do was not understood.');
    }
    if (scope === 'personal') {
      // A personal to-do is ticked by the brain's script (scope + expect), never by the app's own write.
      if (expect === undefined) throw new HttpError(400, 'bad-request', TODO_CHANGE_MESSAGES['bad-request']);
      try {
        await ctx.brain.completePersonalTodo(id, expect, await safe(ctx.brain.identity(), UNKNOWN_IDENTITY));
      } catch (err) {
        if (err instanceof TodoChangeError) throw new HttpError(statusFor(err.code), err.code, err.message);
        throw new HttpError(500, 'internal', TODO_CHANGE_MESSAGES.internal);
      }
    } else {
      try {
        await ctx.brain.completeTodo(id, await safe(ctx.brain.identity(), UNKNOWN_IDENTITY));
      } catch {
        throw new HttpError(404, 'not-found', 'That to-do could not be found. It may already be done.');
      }
    }
    ctx.log('Ticked a to-do.');
    sendJson(res, 200, await todos(ctx));
    return;
  }

  if (path === ROUTES.changeTodo) {
    if (method !== 'POST') throw methodNotAllowed();
    const body = await readJson(req);
    const prefs = await ctx.store.get();
    if (!prefs.directWrites) throw new HttpError(403, 'not-allowed', TODO_SWITCHED_OFF);
    const action = parseTodoAction(body);
    let moved: TodoList['moved'];
    try {
      moved = (await ctx.brain.changeTodo(action, await safe(ctx.brain.identity(), UNKNOWN_IDENTITY))).moved;
    } catch (err) {
      if (err instanceof TodoChangeError) throw new HttpError(statusFor(err.code), err.code, err.message);
      ctx.log('A to-do change failed unexpectedly.');
      throw new HttpError(500, 'internal', TODO_CHANGE_MESSAGES.internal);
    }
    ctx.log(`Changed a to-do (${action.kind}).`);
    const list = await todos(ctx);
    sendJson(res, 200, moved ? { ...list, moved } : list);
    return;
  }

  if (path === '/api/prefs') {
    if (method !== 'PUT') throw methodNotAllowed();
    const patch = await validatePrefsPatch(await readJson(req), ctx.brain);
    sendJson(res, 200, await ctx.store.update(patch));
    return;
  }

  if (path === '/api/client-guess') {
    if (method !== 'POST') throw methodNotAllowed();
    const text = parseClientGuessRequest(await readJson(req));
    const clients = await safe(
      safe(ctx.brain.clients(), []).then((list) => readClientAliases(ctx.brain.root, list)),
      [],
    );
    const fallback: ClientGuessResponse = { kind: 'ask', options: [] };
    const guess = await safe(clientGuesser(ctx)(text, clients), fallback);
    ctx.clientPickTally?.record(guessOutcome(guess));
    sendJson(res, 200, guess);
    return;
  }

  if (path === ROUTES.clientPickOutcome) {
    if (method !== 'POST') throw methodNotAllowed();
    const body = (await readJson(req)) as { outcome?: unknown } | null;
    const outcome = body?.outcome;
    if (!(CLIENT_PICK_REPORTED as readonly unknown[]).includes(outcome)) {
      throw new HttpError(400, 'bad-request', 'That outcome was not understood.');
    }
    ctx.clientPickTally?.record(outcome as ClientPickReported);
    sendJson(res, 200, {});
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

  const fc = SESSION_FILE_CHANGES.exec(path);
  if (fc?.[1] && fc[2]) {
    if (method !== 'GET') throw methodNotAllowed();
    let id: string;
    let key: string;
    try {
      id = decodeURIComponent(fc[1]);
      key = decodeURIComponent(fc[2]);
    } catch {
      throw new HttpError(400, 'bad-request', 'That file was not understood.');
    }
    const changes = ctx.sessions.fileChanges(id, key);
    if (!changes) throw new HttpError(404, 'not-found', 'Those changes could not be found.');
    sendJson(res, 200, changes);
    return;
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
        // The text is validated by the session manager.
        await ctx.sessions.send(id, body.text as string, parseAttachments(body.attachments));
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

  if (path === ROUTES.uploads) {
    if (method !== 'POST') throw methodNotAllowed();
    await uploadFile(req, res, ctx);
    return;
  }

  const discard = UPLOAD_DISCARD.exec(path);
  if (discard?.[1]) {
    if (method !== 'POST') throw methodNotAllowed();
    const id = decodeId(discard[1]);
    if (!id) throw new HttpError(400, 'bad-request', 'That file was not understood.');
    await readJson(req);
    await ctx.uploads.discard(id);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (path.startsWith('/api/library') && (await libraryRoute(req, res, url, ctx))) return;

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
