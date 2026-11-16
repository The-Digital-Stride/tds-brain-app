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
  type AskedTodoList,
  type Bootstrap,
  type BrainHealth,
  type BrainReaders,
  type ChangelogResponse,
  CLIENT_PICK_REPORTED,
  type ClientGuessResponse,
  type ClientPickReported,
  EFFORT_LEVELS,
  type EffortLevel,
  type EngineHealth,
  FAVOURITE_CHATS_MAX,
  FAVOURITE_FILES_MAX,
  FAVOURITE_TODOS_MAX,
  FILE_ID_MAX,
  type Identity,
  LIBRARY_SEARCH_QUERY,
  type LibraryFile,
  type LibraryItemsResponse,
  type LibrarySearchResponse,
  type LibraryText,
  MAX_ATTACHMENTS,
  type MemberProfile,
  MODEL_PREF_MAX,
  MODEL_PREF_PATTERN,
  type PermissionReply,
  type QuestionReply,
  ROUTES,
  SESSION_UUID_PATTERN,
  type StartSessionRequest,
  type SyncStatus,
  THUMB_WIDTHS,
  type Thumbnailer,
  type ThumbWidth,
  TODO_KEY_MAX,
  TODO_SEEN_MAX,
  type TodoAction,
  TodoChangeError,
  type TodoHistoryResponse,
  type TodoList,
  type TodoScope,
  UPLOAD_NAME_HEADER,
  type UploadResponse,
  VERSION_PATTERN,
  type VersionNotes,
} from '../../shared/contract.ts';
import { FILES_CHANGE_MESSAGES, FILES_CHANGE_STATUS, FilesChangeError } from '../../shared/files-contract.ts';
import { type AppState, SETUP_ROUTES, type SetupService } from '../../shared/install-contract.ts';
import { USAGE_SAVINGS_PATH } from '../../shared/kits-contract.ts';
import {
  isLevelTier,
  type LevelTier,
  SKILL_LEVEL_NOTE_MAX,
  SKILL_LEVEL_SETTERS,
  type SkillLevels,
} from '../../shared/levels-contract.ts';
import { LINK_SCRIPT_TAG, linkScriptOffset } from '../../shared/page-links.ts';
import {
  UPDATE_CHECK_EVERY_MS,
  UpdateRefused,
  type Updater,
  type UpdateStatus,
} from '../../shared/update-contract.ts';
import { readClientAliases, withClientAliases } from '../brain/client-aliases.ts';
import { parseFrontmatter } from '../brain/frontmatter.ts';
import { openChecked, PAGE_MAX_BYTES, readChecked, scopeOfId, TEXT_MAX_BYTES } from '../brain/library.ts';
import { SKILL_LEVEL_MESSAGES, SkillLevelError, type SkillLevelsService } from '../brain/skill-levels.ts';
import { TODO_CHANGE_MESSAGES } from '../brain/todo-skill.ts';
import {
  CLIENT_GUESS_MAX_CHARS,
  type ClientAlias,
  createClientGuesser,
  type JevAsk,
} from '../engine/client-guess.ts';
import { jevFromBrain } from '../engine/jev.ts';
import {
  type BrandedCopy,
  parsePageAsk,
  SessionError,
  type SessionManager,
} from '../engine/session-manager.ts';
import { type ClientPickTally, guessOutcome } from '../store/client-pick-tally.ts';
import { isPageKey } from '../store/page-copies.ts';
import { UploadError, type UploadErrorCode, type UploadStaging } from '../uploads/staging.ts';
import { emptySummary, type SavingsService } from '../usage/savings.ts';
import {
  hasValidSession,
  isLibraryPagePath,
  MAX_BODY_BYTES,
  PAGE_CSP,
  PAGE_PREVIEW_CSP,
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
  /** Team skill levels: reads the brain's file and runs its skill script to change it. Absent: none (older tests). */
  skillLevels?: SkillLevelsService;
  /**
   * The token savings ledger (`GET USAGE_SAVINGS_PATH`). Absent (older tests, or no data folder):
   * the route answers 200 with an empty summary, so the Settings panel shows its empty state.
   */
  savings?: Pick<SavingsService, 'summary'>;
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
const SEEN_KEY_MAX = TODO_KEY_MAX;
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
          throw bad('The favourite skills were not understood.');
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
      case 'model': {
        if (
          value !== null &&
          !(typeof value === 'string' && value.length <= MODEL_PREF_MAX && MODEL_PREF_PATTERN.test(value))
        ) {
          throw bad('That model name was not understood.');
        }
        patch.model = value as string | null;
        break;
      }
      case 'favouriteChats': {
        if (
          !Array.isArray(value) ||
          value.length > FAVOURITE_CHATS_MAX ||
          !value.every((v) => typeof v === 'string' && SESSION_UUID_PATTERN.test(v))
        ) {
          throw bad('The favourite chats were not understood.');
        }
        patch.favouriteChats = [...new Set(value as string[])];
        break;
      }
      case 'favouriteTodos': {
        if (
          !Array.isArray(value) ||
          value.length > FAVOURITE_TODOS_MAX ||
          !value.every((v) => typeof v === 'string' && v !== '' && v.length <= TODO_KEY_MAX)
        ) {
          throw bad('The favourite to-dos were not understood.');
        }
        patch.favouriteTodos = [...new Set(value as string[])];
        break;
      }
      case 'favouriteFiles': {
        if (
          !Array.isArray(value) ||
          value.length > FAVOURITE_FILES_MAX ||
          !value.every((v) => typeof v === 'string' && v !== '' && v.length <= FILE_ID_MAX)
        ) {
          throw bad('The starred files were not understood.');
        }
        patch.favouriteFiles = [...new Set(value as string[])];
        break;
      }
      case 'levelMode': {
        if (value !== 'auto' && value !== 'manual') throw bad('That level setting was not understood.');
        patch.levelMode = value;
        break;
      }
      case 'effort': {
        if (value !== null && !(EFFORT_LEVELS as readonly unknown[]).includes(value)) {
          throw bad('That effort level was not understood.');
        }
        patch.effort = value as EffortLevel | null;
        break;
      }
      case 'tourSeen': {
        if (
          value !== null &&
          !(Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 1000)
        ) {
          throw bad('That tour setting was not understood.');
        }
        patch.tourSeen = value as number | null;
        break;
      }
      case 'whatsNewSeen': {
        if (value !== null && !(typeof value === 'string' && VERSION_PATTERN.test(value))) {
          throw bad("That What's new setting was not understood.");
        }
        patch.whatsNewSeen = value as string | null;
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

/** The skill-levels service; absent in setup mode. */
function skillLevelsOf(ctx: RouteContext): SkillLevelsService | undefined {
  return ctx.skillLevels;
}

function canSetSkillLevels(identity: Identity): boolean {
  return (SKILL_LEVEL_SETTERS as readonly string[]).includes(identity.role);
}

async function skillLevelsFor(ctx: RouteContext, identity: Identity): Promise<SkillLevels | undefined> {
  const service = skillLevelsOf(ctx);
  if (!service) return undefined;
  const [levels, writable] = await Promise.all([safe(service.read(), {}), safe(service.writable(), false)]);
  return { levels, canSet: canSetSkillLevels(identity), writable };
}

/** `POST ROUTES.skillLevels`: `{ skill, tier | null, note? }`. */
function parseSetSkillLevel(body: unknown): { skill: string; tier: LevelTier | null; note?: string } {
  const bad = () => new HttpError(400, 'bad-request', SKILL_LEVEL_MESSAGES['bad-request']);
  if (!isRec(body)) throw bad();
  const { skill, tier, note } = body;
  if (typeof skill !== 'string' || !SKILL_NAME.test(skill)) throw bad();
  if (tier !== null && !isLevelTier(tier)) throw bad();
  if (
    note !== undefined &&
    note !== null &&
    (typeof note !== 'string' || note.length > SKILL_LEVEL_NOTE_MAX)
  ) {
    throw bad();
  }
  return typeof note === 'string' && tier !== null ? { skill, tier, note } : { skill, tier };
}

async function bootstrap(ctx: RouteContext): Promise<Bootstrap> {
  const identity = await safe(ctx.brain.identity(), UNKNOWN_IDENTITY);
  const brainFallback: BrainHealth = {
    ok: false,
    path: ctx.brain.root,
    problems: ['The app could not read your brain folder.'],
  };
  const [brain, profile, skills, clients, usedOften, prefs, levelsInfo] = await Promise.all([
    safe(ctx.brain.health(), brainFallback),
    safe(ctx.brain.profile(identity), EMPTY_PROFILE),
    safe(ctx.brain.skills(identity), []),
    // With their codes and other names from clients/map.json, so the client pickers can find them.
    safe(
      ctx.brain.clients().then((list) => withClientAliases(ctx.brain.root, list)),
      [],
    ),
    safe(ctx.brain.usedOften(identity), []),
    ctx.store.get(),
    skillLevelsFor(ctx, identity),
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
    ...(levelsInfo ? { skillLevels: levelsInfo } : {}),
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

const TODO_HISTORY_BAD_KEY = "That to-do wasn't understood.";

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
    // R7: the file's own scripts run, locked down as a chat's page is; errors stay script-free.
    sendPreviewHtml(res, 200, withLinkScriptBytes(read.data));
  } catch {
    if (res.headersSent) res.end();
    else sendPageError(res, 500, 'Something went wrong in the app. Try again.');
  }
}

/** `ROUTES.libraryItem`. Not one of the GET kinds above (`thumb`, `text`, ...): those have two segments. */
const LIBRARY_ITEM_DELETE = /^\/api\/library\/items\/([^/]+)$/;

/**
 * `DELETE ROUTES.libraryItem` (plan 2026-11-15-delete-library-files, decision 6): the brain's script
 * moves the file to the holding folder. The app's stars are cleared and the page told only after it did.
 */
async function deleteLibraryItem(req: IncomingMessage, rawId: string, ctx: RouteContext): Promise<void> {
  const body = await readJson(req);
  const expect =
    typeof body === 'object' && body !== null ? (body as { expect?: unknown }).expect : undefined;
  if (expect !== undefined && (typeof expect !== 'string' || expect === '' || expect.length > 200)) {
    throw new HttpError(400, 'bad-request', FILES_CHANGE_MESSAGES['bad-request']);
  }
  const id = decodeId(rawId);
  const remove = ctx.brain.deleteLibraryFile;
  if (!id || !remove) throw new HttpError(404, 'not-found', FILES_CHANGE_MESSAGES['not-found']);
  try {
    await remove.call(ctx.brain, id, expect === undefined ? {} : { expect });
  } catch (err) {
    if (err instanceof FilesChangeError) {
      // `exists` only comes from restore, which has no route; `changed` is the nearest API code.
      const code = err.code === 'exists' ? 'changed' : err.code;
      throw new HttpError(FILES_CHANGE_STATUS[err.code], code, err.message);
    }
    ctx.log('Deleting a library file failed unexpectedly.');
    throw new HttpError(500, 'internal', FILES_CHANGE_MESSAGES.internal);
  }
  ctx.log('Deleted a library file.');
  // The file is gone for everyone: drop its star, then tell the open pages. Neither may fail the delete.
  try {
    const starred = (await ctx.store.get()).favouriteFiles ?? [];
    if (starred.includes(id)) await ctx.store.update({ favouriteFiles: starred.filter((s) => s !== id) });
  } catch {
    ctx.log('Could not clear the star of a deleted library file.');
  }
  ctx.hub.publish({ type: 'brain-changed', area: 'library' });
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
  if (path === '/api/library/items') {
    if (method !== 'POST') throw methodNotAllowed();
    const body = await readJson(req);
    const ids = (body as { ids?: unknown } | null)?.ids;
    if (
      !Array.isArray(ids) ||
      ids.length > FAVOURITE_FILES_MAX ||
      !ids.every((v) => typeof v === 'string' && v !== '' && v.length <= FILE_ID_MAX)
    ) {
      throw new HttpError(400, 'bad-request', 'Those files were not understood.');
    }
    const scopes = await safe(ctx.brain.libraryScopes(), []);
    const files: LibraryItemsResponse['files'] = [];
    for (const id of [...new Set(ids as string[])]) {
      const scope = scopes.find((s) => s.id === scopeOfId(id));
      const file = scope ? await safe(ctx.brain.libraryFile(id), null) : null;
      // The item and its scope only: never the file's real location on this machine.
      if (scope && file) files.push({ item: file.item, scope });
    }
    sendJson(res, 200, { files } satisfies LibraryItemsResponse);
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
  const del = LIBRARY_ITEM_DELETE.exec(path);
  if (del?.[1]) {
    if (method !== 'DELETE') throw methodNotAllowed();
    await deleteLibraryItem(req, del[1], ctx);
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
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

// -- a chat's pages (plan 2026-11-14-artifacts-in-app, decisions 3, 6 and 7) --------------------

/** `ROUTES.chatPage` and `ROUTES.chatPageAsk`: the last segment is a version number, or `ask`. */
const SESSION_PAGE = /^\/api\/sessions\/([^/]+)\/pages\/([^/]+)\/([^/]+)$/;
/** `ROUTES.chatPageBranded`. */
const SESSION_PAGE_BRANDED = /^\/api\/sessions\/([^/]+)\/pages\/([^/]+)\/([^/]+)\/branded$/;
/** A version number; `0` is the copy Claude is still working on. */
const PAGE_VERSION = /^(?:0|[1-9][0-9]{0,4})$/;
const PAGE_NOT_FOUND = 'That page could not be found. It may have been closed with its chat.';
const PAGE_NOT_KEPT = "This version isn't kept in the app. Open it on claude.ai.";
const DRAFT_NOT_KEPT = "The app couldn't keep a copy of this page, so it can't be shown here.";

/**
 * claude.ai's page skeleton: it wraps a stored file that has no doctype at publish time, so the route
 * does the same at serve time (the stored bytes are never changed).
 */
export const PAGE_SKELETON_HEAD =
  '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  '<style>body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none}</style>\n' +
  '</head>\n<body>\n';
export const PAGE_SKELETON_FOOT = '\n</body>\n</html>\n';

/** The page as served: as stored when it starts with a doctype (after a BOM or spaces), else inside the skeleton. */
export function wrapPage(data: Buffer): Buffer {
  const head = data
    .subarray(0, 512)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (/^<!doctype\s/i.test(head)) return data;
  return Buffer.concat([Buffer.from(PAGE_SKELETON_HEAD), data, Buffer.from(PAGE_SKELETON_FOOT)]);
}

/** How far into a page to look for a leading doctype (past any comments before it). */
const DOCTYPE_SCAN_BYTES = 64 * 1024;
const LINK_SCRIPT_BYTES = Buffer.from(LINK_SCRIPT_TAG);

/**
 * A page as served (hardening decision 1): its bytes with the link script added right after a
 * leading doctype, else at the start. A new buffer every time; the stored bytes are never changed.
 * Read as latin1, one character is one byte, so the offset is a byte offset and nothing is re-encoded.
 */
export function withLinkScriptBytes(data: Buffer): Buffer {
  // A UTF-16 page (byte order mark FE FF / FF FE) is served as it is: bytes added in front of its mark
  // would garble it, and its links fall back to the stop notice.
  if (data.length >= 2 && ((data[0] === 0xfe && data[1] === 0xff) || (data[0] === 0xff && data[1] === 0xfe)))
    return data;
  const at = linkScriptOffset(data.subarray(0, DOCTYPE_SCAN_BYTES).toString('latin1'));
  return Buffer.concat([data.subarray(0, at), LINK_SCRIPT_BYTES, data.subarray(at)]);
}

/** HTML under the preview policy, which REPLACES the app's (two policies would both apply and block the frame). */
function sendPreviewHtml(res: ServerResponse, status: number, body: string | Buffer): void {
  const length = typeof body === 'string' ? Buffer.byteLength(body) : body.length;
  res.setHeader('Content-Security-Policy', PAGE_PREVIEW_CSP);
  res.writeHead(status, {
    'Content-Security-Policy': PAGE_PREVIEW_CSP,
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Length': length,
  });
  res.end(body);
}

function sendPreviewError(res: ServerResponse, status: number, message: string): void {
  sendPreviewHtml(
    res,
    status,
    `<!doctype html>
<html lang="en-GB">
<head><meta charset="utf-8"><title>Cannot show this page</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:2rem;color:#444}</style></head>
<body><p>${escapeHtml(message)}</p></body>
</html>
`,
  );
}

/** `GET ROUTES.chatPage`: one stored version of a chat's page. Every answer is HTML under the preview policy. */
async function sendChatPage(
  req: IncomingMessage,
  res: ServerResponse,
  raw: { id: string; key: string; n: string },
  ctx: RouteContext,
): Promise<void> {
  try {
    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      sendPreviewError(res, 405, 'That is not something this address does.');
      return;
    }
    const id = decodeId(raw.id);
    const key = decodeId(raw.key);
    const pageCopy = ctx.sessions.pageCopy;
    if (!id || !key || !isPageKey(key) || !PAGE_VERSION.test(raw.n) || !pageCopy) {
      sendPreviewError(res, 404, PAGE_NOT_FOUND);
      return;
    }
    let data: Buffer | null;
    try {
      data = await pageCopy.call(ctx.sessions, id, key, Number(raw.n));
    } catch (err) {
      if (err instanceof SessionError) {
        sendPreviewError(res, 404, PAGE_NOT_FOUND);
        return;
      }
      throw err;
    }
    if (!data) {
      sendPreviewError(res, 404, raw.n === '0' ? DRAFT_NOT_KEPT : PAGE_NOT_KEPT);
      return;
    }
    sendPreviewHtml(res, 200, withLinkScriptBytes(wrapPage(data)));
  } catch {
    ctx.log('A page could not be shown.');
    if (res.headersSent) res.end();
    else sendPreviewError(res, 500, 'Something went wrong in the app. Try again.');
  }
}

/**
 * Says whether the branded download works offline (R8): `yes`, or `partial` when a script, stylesheet
 * or font it uses still comes from the internet. The viewer reads it to word its status line.
 */
export const PAGE_SELF_CONTAINED_HEADER = 'X-Page-Self-Contained';

/**
 * `GET ROUTES.chatPageBranded`: one stored copy wrapped in the TDS bar, as a download under the
 * download policy (never shown or run in place). Errors are the same small page as `chatPage`'s.
 */
async function sendBrandedPage(
  req: IncomingMessage,
  res: ServerResponse,
  raw: { id: string; key: string; n: string },
  ctx: RouteContext,
): Promise<void> {
  try {
    if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
      sendPreviewError(res, 405, 'That is not something this address does.');
      return;
    }
    const id = decodeId(raw.id);
    const key = decodeId(raw.key);
    const branded = ctx.sessions.brandedCopy;
    if (!id || !key || !isPageKey(key) || !PAGE_VERSION.test(raw.n) || !branded) {
      sendPreviewError(res, 404, PAGE_NOT_FOUND);
      return;
    }
    let file: BrandedCopy | null;
    try {
      file = await branded.call(ctx.sessions, id, key, Number(raw.n));
    } catch (err) {
      if (err instanceof SessionError) {
        sendPreviewError(res, 404, PAGE_NOT_FOUND);
        return;
      }
      throw err;
    }
    if (!file) {
      sendPreviewError(res, 404, raw.n === '0' ? DRAFT_NOT_KEPT : PAGE_NOT_KEPT);
      return;
    }
    const body = Buffer.from(file.html, 'utf8');
    res.setHeader('Content-Security-Policy', DOWNLOAD_CSP);
    res.writeHead(200, {
      'Content-Security-Policy': DOWNLOAD_CSP,
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': attachmentHeader(file.name),
      [PAGE_SELF_CONTAINED_HEADER]: file.selfContained ? 'yes' : 'partial',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Content-Length': body.length,
    });
    res.end(body);
  } catch {
    ctx.log('A branded page could not be made.');
    if (res.headersSent) res.end();
    else sendPreviewError(res, 500, 'Something went wrong in the app. Try again.');
  }
}

/** `POST ROUTES.chatPageAsk`: PageAskRequest, checked here, sent into the chat by the session manager. */
async function askPage(
  req: IncomingMessage,
  res: ServerResponse,
  raw: { id: string; key: string },
  ctx: RouteContext,
): Promise<void> {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') throw methodNotAllowed();
  let id: string;
  let key: string;
  try {
    id = decodeURIComponent(raw.id);
    key = decodeURIComponent(raw.key);
  } catch {
    throw new HttpError(400, 'bad-request', 'That page was not understood.');
  }
  const ask = parsePageAsk(await readJson(req));
  const send = ctx.sessions.askPage;
  if (!send || !isPageKey(key))
    throw new HttpError(404, 'not-found', 'That page could not be found in this chat.');
  await send.call(ctx.sessions, id, key, ask);
  sendJson(res, 200, { ok: true });
}

const PAST_SESSION = /^\/api\/sessions\/past\/([^/]+)$/;
const SESSION_ACTION = /^\/api\/sessions\/([^/]+)\/(messages|permission|answer|interrupt|close|kind)$/;
const SESSION_LEVEL = /^\/api\/sessions\/([^/]+)\/level$/;
const SESSION_CONTEXT = /^\/api\/sessions\/([^/]+)\/context$/;
const SESSION_FILE_CHANGES = /^\/api\/sessions\/([^/]+)\/file-changes\/([^/]+)$/;

function prewarmPick(ctx: RouteContext, text: string): void {
  try {
    ctx.sessions.prewarmPick(text);
  } catch {
    // the pick is made at the first message instead
  }
}

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
    if (!updater) throw new HttpError(403, 'not-allowed', "This copy of TDS Cortex can't update itself.");
    sendJson(res, 202, await shape(await updater.start()));
  } catch (err) {
    if (err instanceof UpdateRefused) {
      if (err.reason === 'busy') throw new HttpError(409, 'busy', 'An update is already running.');
      throw new HttpError(403, 'not-allowed', "This copy of TDS Cortex can't update right now.");
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

  if (path === ROUTES.askedTodos) {
    if (method !== 'GET') throw methodNotAllowed();
    const identity = await safe(ctx.brain.identity(), UNKNOWN_IDENTITY);
    const body: AskedTodoList = await safe(ctx.brain.askedTodos(identity), {
      waiting: [],
      done: [],
      historyRead: false,
    });
    sendJson(res, 200, body);
    return;
  }

  if (path === ROUTES.todoHistory) {
    if (method !== 'GET') throw methodNotAllowed();
    const key = url.searchParams.get('key');
    if (key === null || key === '' || key.length > TODO_KEY_MAX) {
      throw new HttpError(400, 'bad-request', TODO_HISTORY_BAD_KEY);
    }
    let body: TodoHistoryResponse;
    try {
      body = await ctx.brain.todoHistory(key, await safe(ctx.brain.identity(), UNKNOWN_IDENTITY));
    } catch (err) {
      if (err instanceof TodoChangeError) throw new HttpError(statusFor(err.code), err.code, err.message);
      ctx.log('Reading a to-do history failed unexpectedly.');
      throw new HttpError(500, 'internal', "That to-do's history couldn't be read. Try again.");
    }
    sendJson(res, 200, body);
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
    const saved = await ctx.store.update(patch);
    if ('model' in patch || 'effort' in patch || 'levelMode' in patch) {
      // Settings never waits on an engine, and a failure here must not fail the save.
      try {
        void Promise.resolve(
          ctx.sessions.setEngineChoice({
            model: saved.model,
            effort: saved.effort,
            levelMode: saved.levelMode,
          }),
        ).catch(() => {});
      } catch {
        // the choice reaches new chats at the next start
      }
    }
    sendJson(res, 200, saved);
    return;
  }

  if (path === ROUTES.skillLevels) {
    const identity = await safe(ctx.brain.identity(), UNKNOWN_IDENTITY);
    if (method === 'GET') {
      sendJson(
        res,
        200,
        (await skillLevelsFor(ctx, identity)) ?? { levels: {}, canSet: false, writable: false },
      );
      return;
    }
    if (method !== 'POST') throw methodNotAllowed();
    const body = await readJson(req);
    const service = skillLevelsOf(ctx);
    if (!canSetSkillLevels(identity))
      throw new HttpError(403, 'not-allowed', SKILL_LEVEL_MESSAGES['not-allowed']);
    if (!service || !(await safe(service.writable(), false))) {
      throw new HttpError(403, 'not-allowed', "Skill levels can't be changed in this brain yet.");
    }
    const change = parseSetSkillLevel(body);
    try {
      await service.change(change.skill, change.tier, change.note);
    } catch (err) {
      if (err instanceof SkillLevelError) throw new HttpError(statusFor(err.code), err.code, err.message);
      ctx.log('A skill level change failed unexpectedly.');
      throw new HttpError(500, 'internal', SKILL_LEVEL_MESSAGES.internal);
    }
    ctx.log(`Changed a skill level (${change.tier === null ? 'clear' : 'set'}).`);
    sendJson(res, 200, (await skillLevelsFor(ctx, identity)) as SkillLevels);
    return;
  }

  if (path === ROUTES.engineChoices) {
    if (method !== 'GET') throw methodNotAllowed();
    sendJson(res, 200, await ctx.sessions.engineChoices());
    return;
  }

  if (path === '/api/client-guess') {
    if (method !== 'POST') throw methodNotAllowed();
    const text = parseClientGuessRequest(await readJson(req));
    // Starts the level pick while the person is still choosing a client; fire and forget.
    prewarmPick(ctx, text);
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

  if (path === USAGE_SAVINGS_PATH) {
    if (method !== 'GET') throw methodNotAllowed();
    sendJson(res, 200, ctx.savings ? await ctx.savings.summary() : emptySummary());
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

  const past = PAST_SESSION.exec(path);
  if (past?.[1]) {
    if (method !== 'DELETE') throw methodNotAllowed();
    let id: string;
    try {
      id = decodeURIComponent(past[1]);
    } catch {
      throw new HttpError(400, 'bad-request', 'That chat was not understood.');
    }
    await ctx.sessions.deletePast(id);
    sendJson(res, 200, {});
    return;
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

  const br = SESSION_PAGE_BRANDED.exec(path);
  if (br?.[1] && br[2] && br[3]) {
    await sendBrandedPage(req, res, { id: br[1], key: br[2], n: br[3] }, ctx);
    return;
  }

  const pg = SESSION_PAGE.exec(path);
  if (pg?.[1] && pg[2] && pg[3]) {
    if (pg[3] === 'ask') await askPage(req, res, { id: pg[1], key: pg[2] }, ctx);
    else await sendChatPage(req, res, { id: pg[1], key: pg[2], n: pg[3] }, ctx);
    return;
  }

  const lv = SESSION_LEVEL.exec(path);
  if (lv?.[1]) {
    if (method !== 'POST') throw methodNotAllowed();
    let id: string;
    try {
      id = decodeURIComponent(lv[1]);
    } catch {
      throw new HttpError(400, 'bad-request', 'That chat was not understood.');
    }
    const body = await readJson(req);
    const tier = isRec(body) ? body.tier : undefined;
    if (tier !== null && !isLevelTier(tier)) {
      throw new HttpError(400, 'bad-request', 'That level was not understood.');
    }
    sendJson(res, 200, { level: await ctx.sessions.setChatLevel(id, tier) });
    return;
  }

  // `GET ROUTES.chatContext` (plan 2026-11-14-context-management, decision 6). The manager rate-limits
  // the engine's full read and never makes it during a reply.
  const cx = SESSION_CONTEXT.exec(path);
  if (cx?.[1]) {
    if (method !== 'GET') throw methodNotAllowed();
    let id: string;
    try {
      id = decodeURIComponent(cx[1]);
    } catch {
      throw new HttpError(400, 'bad-request', 'That chat was not understood.');
    }
    if (!ctx.sessions.contextDetail) {
      throw new HttpError(404, 'not-found', 'That chat could not be found. It may have been closed.');
    }
    sendJson(res, 200, await ctx.sessions.contextDetail(id));
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
    if (m[2] === 'kind') {
      if (!isTodoScope(body.kind)) throw new HttpError(400, 'bad-request', 'Choose TDS or Personal.');
      sendJson(res, 200, { session: await ctx.sessions.setKind(id, body.kind) });
      return;
    }
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
