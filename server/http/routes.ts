/**
 * The JSON API (the route table in `shared/contract.ts`). Every request reaching here has already
 * passed the security gate in `security.ts`.
 */
import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import {
  ADS_ACCOUNT_KEY,
  ADS_CLIENT_SLUG,
  ADS_ERROR_MESSAGES,
  ADS_ERROR_STATUS,
  ADS_FILE_PATTERN,
  ADS_PROPOSAL_ID,
  ADS_ROUTES,
  ADS_SKILL,
  ADS_TASK_RESULTS_CAPABILITY,
  ADS_TASK_RUNS_CAPABILITY,
  ADS_TRIAGE_CAPABILITY,
  type AdsCapabilities,
  type AdsChangeAction,
  type AdsErrorCode,
  type AdsRequests,
} from '../../shared/ads-contract.ts';
import { readChatSummary } from '../../shared/chat-summary.ts';
import {
  CHAT_ID_PATTERN,
  CHAT_TITLE_MAX,
  type ChatSummaryDraftRequest,
  UNSAVED_CHATS_DAYS,
  type UnsavedChatsResponse,
} from '../../shared/chat-summary-contract.ts';
import {
  ADS_FOLDS_MAX,
  ADS_PREF_KEY_MAX,
  type ApiError,
  type ApiErrorCode,
  type AppPrefs,
  type AppStore,
  type AskedTodoList,
  type Bootstrap,
  type BrainHealth,
  type BrainReaders,
  type ChangelogResponse,
  type ChatFile,
  CLIENT_PICK_REPORTED,
  type ClientGuessResponse,
  type ClientPickReported,
  type DoneTodoList,
  EFFORT_LEVELS,
  type EffortLevel,
  type EngineHealth,
  FAVOURITE_CHATS_MAX,
  FAVOURITE_FILES_MAX,
  FAVOURITE_TODOS_MAX,
  FILE_ID_MAX,
  HOME_HIDDEN_MAX,
  HOME_ITEM_ID_PATTERN,
  HOME_SHORTCUTS_MAX,
  type HomeShortcut,
  homeShortcutKey,
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
  SECTION_ID_PATTERN,
  SECTIONS_MAX,
  SESSION_UUID_PATTERN,
  type SequencedEvent,
  SKILL_NAME_PATTERN,
  type StartSessionRequest,
  type SyncStatus,
  type TeamTodo,
  THUMB_WIDTHS,
  type Thumbnailer,
  type ThumbWidth,
  TODO_KEY_MAX,
  TODO_SEEN_MAX,
  TODO_UPLOAD_TYPES,
  type TodoAction,
  TodoChangeError,
  type TodoHistoryResponse,
  type TodoList,
  type TodoScope,
  type TodoUploadRequest,
  type TodoUploadResponse,
  UPLOAD_NAME_HEADER,
  type UploadResponse,
  VERSION_PATTERN,
  type VersionNotes,
} from '../../shared/contract.ts';
import { FILES_CHANGE_MESSAGES, FILES_CHANGE_STATUS, FilesChangeError } from '../../shared/files-contract.ts';
import type { HomeMeetingsResponse } from '../../shared/home-meetings-contract.ts';
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
import { cleanArtifactUrl } from '../../shared/pages.ts';
import type { ProjectActivityResponse } from '../../shared/project-activity-contract.ts';
import type { ProjectBusinessResponse } from '../../shared/project-business-contract.ts';
import {
  EMAIL_NAME_MAX,
  EMAIL_PEOPLE_MAX,
  EMAIL_SUBJECT_MAX,
  type EmailDraftApproveRequest,
  type EmailDraftDismissRequest,
} from '../../shared/project-email-contract.ts';
import type { ProjectMeetingsResponse } from '../../shared/project-meetings-contract.ts';
import { UPDATE_SUMMARY_MAX } from '../../shared/project-updates-contract.ts';
import {
  PROJECT_BRIEF_MAX,
  PROJECT_KEY_PATTERN,
  PROJECT_KEY_SEGMENT_MAX,
  PROJECT_SLUG_MAX,
  PROJECT_SLUG_PATTERN,
  PROJECT_STAGE_MAX,
  PROJECT_STAGES_MAX,
  PROJECT_TEAM_MAX,
  PROJECT_TITLE_MAX,
  PROJECTS_ERROR_STATUS,
  type ProjectAction,
  type ProjectArtifactRequest,
  type ProjectCard,
  type ProjectFields,
  type ProjectKey,
  type ProjectList,
  type ProjectMoveRequest,
  type ProjectRemoveRequest,
  ProjectsError,
  type TidyApply,
  type TidySuggestion,
} from '../../shared/projects-contract.ts';
import {
  UPDATE_CHECK_EVERY_MS,
  UpdateRefused,
  type Updater,
  type UpdateStatus,
} from '../../shared/update-contract.ts';
import { AdsError, type AdsInflightEntry, type AdsService } from '../brain/ads-skill.ts';
import { readClientAliases, withClientAliases } from '../brain/client-aliases.ts';
import type { EmailDraftsService } from '../brain/email-drafts.ts';
import { parseFrontmatter } from '../brain/frontmatter.ts';
import { openChecked, PAGE_MAX_BYTES, readChecked, scopeOfId, TEXT_MAX_BYTES } from '../brain/library.ts';
import { classify } from '../brain/library-rules.ts';
import {
  artifactRefusal,
  cleanArtifactDescription,
  cleanArtifactTitle,
  type ProjectArtifactService,
} from '../brain/project-artifact.ts';
import type { ProjectUpdatesService } from '../brain/project-updates.ts';
import { PROJECTS_SKILL } from '../brain/projects-skill.ts';
import { SKILL_LEVEL_MESSAGES, SkillLevelError, type SkillLevelsService } from '../brain/skill-levels.ts';
import { TODO_CHANGE_MESSAGES } from '../brain/todo-skill.ts';
import { TODO_FILES_MESSAGES } from '../brain/todos.ts';
import { ChatDraftError } from '../engine/chat-summary.ts';
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
import { FOLDED_SECTIONS_MAX, isGroupNameList } from '../store/app-store.ts';
import { type ClientPickTally, guessOutcome } from '../store/client-pick-tally.ts';
import { isPageKey } from '../store/page-copies.ts';
import {
  extensionOf,
  type StagedFile,
  UploadError,
  type UploadErrorCode,
  type UploadStaging,
} from '../uploads/staging.ts';
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
  /** `ads`: Ad Manager's bridge (the real brain always has one; older test fakes don't). Read per request. */
  brain: BrainReaders & {
    ads?: AdsService;
    /** Projects R2 phase 3: activity on the project home, and committing what was seen. Beside the contract like `ads`. */
    projectActivity?: (key: ProjectKey, identity: Identity) => Promise<ProjectActivityResponse>;
    projectSeen?: (key: ProjectKey, token: string, identity: Identity) => Promise<void>;
    /** Claude artifacts in projects (decision 8): "Add a claude.ai page". Absent: the route says it isn't there. */
    projectArtifact?: ProjectArtifactService;
    projectMeetings?: (key: ProjectKey) => Promise<ProjectMeetingsResponse>;
    projectBusiness?: (key: ProjectKey) => Promise<ProjectBusinessResponse>;
    homeMeetings?: () => Promise<HomeMeetingsResponse>;
    /** Projects R2 phase 5: email drafts waiting for their inbox owner's OK. Absent: the route says it isn't there. */
    emailDrafts?: EmailDraftsService;
    /** Done-todos plan: finished to-dos. Beside the contract like `ads`; the real brain and setup mode have it. */
    doneTodos?: (identity: Identity) => Promise<DoneTodoList>;
    /** Done-todos plan, decision 10: one teammate's open to-do, read only. Null when it has gone. */
    teamTodo?: (id: string, identity: Identity) => Promise<TeamTodo | null>;
    /** Chat summaries: this person's `chat` entries for one chat on a project (whole log, newest first). */
    chatEntries?: ProjectUpdatesService['chatEntries'];
    /** Chat summaries: hands the brain the session manager's `ownsChat`, for "Open chat" on `chat` entries. */
    setHoldsChat?: (fn: ((chatId: string) => Promise<boolean>) | null) => void;
  };
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

const NO_DONE: DoneTodoList = { items: [], historyRead: false };

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
  canAttach: false,
  canUpload: false,
};
const MAX_PINS = 100;
const SEEN_KEY_MAX = TODO_KEY_MAX;
const SEEN_VALUE_MAX = 40;

/** A Home shortcut of a kind this server knows, with every field in its pattern. Extra fields are dropped. */
function isHomeShortcut(v: unknown): v is HomeShortcut {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (o.kind === 'skill') return typeof o.name === 'string' && SKILL_NAME_PATTERN.test(o.name);
  if (o.kind === 'tool') {
    return (
      typeof o.section === 'string' &&
      SECTION_ID_PATTERN.test(o.section) &&
      typeof o.tool === 'string' &&
      SECTION_ID_PATTERN.test(o.tool)
    );
  }
  return false;
}

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
          !value.every((v) => typeof v === 'string' && SKILL_NAME_PATTERN.test(v))
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
          throw bad('The list of tasks you have seen was not understood.');
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
          throw bad('The pinned chats were not understood.');
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
          throw bad('The pinned tasks were not understood.');
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
      case 'homeHidden': {
        if (
          !Array.isArray(value) ||
          value.length > HOME_HIDDEN_MAX ||
          !value.every((v) => typeof v === 'string' && HOME_ITEM_ID_PATTERN.test(v))
        ) {
          throw bad('The hidden Home items were not understood.');
        }
        patch.homeHidden = [...new Set(value as string[])];
        break;
      }
      case 'homeShortcuts': {
        if (!Array.isArray(value) || value.length > HOME_SHORTCUTS_MAX || !value.every(isHomeShortcut)) {
          throw bad('The Home shortcuts were not understood.');
        }
        const byKey = new Map<string, HomeShortcut>();
        for (const v of value as HomeShortcut[])
          if (!byKey.has(homeShortcutKey(v))) byKey.set(homeShortcutKey(v), v);
        patch.homeShortcuts = [...byKey.values()];
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
      // Workbench and Ad Manager (plan 2026-11-16-workbench-ad-manager, decision 21).
      case 'lastTool': {
        const entries = isRec(value) ? Object.entries(value) : null;
        if (
          entries === null ||
          entries.length > SECTIONS_MAX ||
          !entries.every(
            ([k, v]) => SECTION_ID_PATTERN.test(k) && typeof v === 'string' && SECTION_ID_PATTERN.test(v),
          )
        ) {
          throw bad('The last tool in each section was not understood.');
        }
        patch.lastTool = Object.fromEntries(entries as [string, string][]);
        break;
      }
      case 'adsAccount': {
        if (
          value !== null &&
          !(typeof value === 'string' && value.length <= ADS_PREF_KEY_MAX && ADS_ACCOUNT_KEY.test(value))
        ) {
          throw bad('That ads account was not understood.');
        }
        patch.adsAccount = value as string | null;
        break;
      }
      case 'adsFolds': {
        const entries = isRec(value) ? Object.entries(value) : null;
        if (
          entries === null ||
          entries.length > ADS_FOLDS_MAX ||
          !entries.every(([k, v]) => k !== '' && k.length <= ADS_PREF_KEY_MAX && typeof v === 'boolean')
        ) {
          throw bad('The open and shut lists in Ads Manager were not understood.');
        }
        patch.adsFolds = Object.fromEntries(entries as [string, boolean][]);
        break;
      }
      case 'foldedGroups': {
        const entries = isRec(value) ? Object.entries(value) : null;
        if (
          entries === null ||
          entries.length > FOLDED_SECTIONS_MAX ||
          !entries.every(([k, v]) => SECTION_ID_PATTERN.test(k) && isGroupNameList(v))
        ) {
          throw bad('The folded groups in the drawer were not understood.');
        }
        patch.foldedGroups = Object.fromEntries(entries as [string, string[]][]);
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
 * (the client, the to-do and the project must be in the brain, the past chat must exist).
 */
export function parseStartRequest(body: unknown): StartSessionRequest {
  if (!isRec(body)) throw new HttpError(400, 'bad-request', 'That request was not understood.');
  const out: StartSessionRequest = {};
  for (const key of ['prompt', 'client', 'resume', 'todoId', 'project'] as const) {
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
  if (typeof skill !== 'string' || !SKILL_NAME_PATTERN.test(skill)) throw bad();
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
  return prefs?.directWrites === true
    ? list
    : { ...list, changes: 'switched-off', canUsePersonal: false, canAttach: false, canUpload: false };
}

const TODO_HISTORY_BAD_KEY = "That task wasn't understood.";

const TODO_SWITCHED_OFF =
  "Adding and editing tasks is switched off. Turn on 'Let the app change tasks' in Settings.";

/** Each action's fields besides `kind`: required text, text or null, optional text, or optional `true`. */
const TODO_SHAPES: Record<
  TodoAction['kind'],
  Record<string, 'text' | 'text-or-null' | 'optional-text' | 'optional-text-or-null' | 'optional-true'>
> = {
  add: {
    title: 'text',
    due: 'text-or-null',
    assignee: 'text-or-null',
    scope: 'optional-text',
    details: 'optional-text',
    // Projects R1: only with TodoList.canProject (checked by changeTodo).
    client: 'optional-text-or-null',
    project: 'optional-text-or-null',
    stage: 'optional-text-or-null',
  },
  edit: {
    id: 'text',
    title: 'text',
    details: 'optional-text',
    // The browser sent the details without the `## Files` section (it saw canAttach): see TodoAction.
    detailsOnly: 'optional-true',
    expect: 'optional-text',
    scope: 'optional-text',
  },
  due: { id: 'text', due: 'text-or-null', expect: 'optional-text', scope: 'optional-text' },
  assignee: { id: 'text', assignee: 'text-or-null', expect: 'optional-text', scope: 'optional-text' },
  delete: { id: 'text', expect: 'optional-text', scope: 'optional-text' },
  move: { id: 'text', scope: 'text', to: 'text', expect: 'optional-text', dropProject: 'optional-true' },
  attach: { id: 'text', path: 'text', expect: 'optional-text', scope: 'optional-text' },
  detach: { id: 'text', path: 'text', expect: 'optional-text', scope: 'optional-text' },
  // Projects R1 (decisions 5, 6): client, project and stage are all sent; null clears.
  project: {
    id: 'text',
    client: 'text-or-null',
    project: 'text-or-null',
    stage: 'text-or-null',
    expect: 'optional-text',
    scope: 'optional-text',
  },
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
    if (
      (type === 'optional-text' || type === 'optional-text-or-null' || type === 'optional-true') &&
      v === undefined
    )
      continue;
    if (type === 'optional-true') {
      if (v !== true) throw bad();
      action[key] = v;
      continue;
    }
    if (
      !(
        typeof v === 'string' ||
        ((type === 'text-or-null' || type === 'optional-text-or-null') && v === null)
      )
    )
      throw bad();
    if ((key === 'scope' || key === 'to') && !isTodoScope(v)) throw bad();
    action[key] = v;
  }
  return action as unknown as TodoAction;
}

// ---------------------------------------------------------------------------
// Projects (plan 2026-11-20-projects-system, decisions 10, 7, 13). The route checks shapes, sizes and the
// words a field may hold; the service and the brain's script check the rest, again.
// ---------------------------------------------------------------------------

const PROJECTS_BAD_REQUEST = "That wasn't understood. Check it and try again.";
const PROJECTS_NOT_THERE = 'Projects are not available in this copy of the brain yet.';
const PROJECTS_INTERNAL = "That didn't work. Try again, and tell a scout if it keeps happening.";
const PROJECT_VERSION = /^[0-9a-f]{64}$/;
const PROJECT_PATH_MAX = 1024;
const PROJECT_LABEL_MAX = 200;
const PROJECT_NAME_MAX = 120;

const PROJECTS_NOT_ALLOWED = "Changing projects isn't available to you in the app yet.";

/** A token is 32 hex characters; anything much longer is refused outright. */
const ACTIVITY_TOKEN_MAX = 200;

const projectBad = () => new HttpError(400, 'bad-request', PROJECTS_BAD_REQUEST);

/** A key, checked as the contract says: the pattern, and each side at most PROJECT_KEY_SEGMENT_MAX. */
export function isProjectKey(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2 * PROJECT_KEY_SEGMENT_MAX + 1 || !PROJECT_KEY_PATTERN.test(v))
    return false;
  return v.split('/').every((seg) => seg.length <= PROJECT_KEY_SEGMENT_MAX);
}

const isSlug = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= PROJECT_SLUG_MAX && PROJECT_SLUG_PATTERN.test(v);
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const textList = (v: unknown, count: number, each: number): boolean =>
  Array.isArray(v) && v.length <= count && v.every((x) => isText(x, each) && x !== '');

const FIELD_ENUMS = {
  kind: ['one-off', 'ongoing'],
  status: ['planned', 'active', 'on-hold', 'done'],
  health: ['green', 'amber', 'red'],
  comms: ['green', 'amber', 'red'],
} as const;

/** The fields of a create or edit: known names only, each the right type and size. */
function parseProjectFields(v: unknown): ProjectFields {
  if (!isRec(v)) throw projectBad();
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(v)) {
    switch (key) {
      case 'title':
        if (!isText(value, PROJECT_TITLE_MAX)) throw projectBad();
        break;
      case 'brief':
        if (!isText(value, PROJECT_BRIEF_MAX)) throw projectBad();
        break;
      case 'kind':
      case 'status':
      case 'health':
      case 'comms': {
        const allowed = FIELD_ENUMS[key] as readonly string[];
        // `status` has no null (it is always one of the four); the other three clear with null.
        if (!(typeof value === 'string' && allowed.includes(value)) && !(key !== 'status' && value === null))
          throw projectBad();
        break;
      }
      case 'owner':
      case 'start':
      case 'end':
        if (!(value === null || isText(value, PROJECT_NAME_MAX))) throw projectBad();
        break;
      case 'team':
        if (!textList(value, PROJECT_TEAM_MAX, PROJECT_NAME_MAX)) throw projectBad();
        break;
      case 'service':
        if (!textList(value, PROJECT_TEAM_MAX, PROJECT_NAME_MAX)) throw projectBad();
        break;
      case 'stages':
        if (!textList(value, PROJECT_STAGES_MAX, PROJECT_STAGE_MAX)) throw projectBad();
        break;
      case 'budgetHours':
        if (!(value === null || (typeof value === 'number' && Number.isFinite(value)))) throw projectBad();
        break;
      case 'billable':
        if (!(value === null || typeof value === 'boolean')) throw projectBad();
        break;
      default:
        throw projectBad();
    }
    out[key] = value;
  }
  return out as ProjectFields;
}

/** Exactly the keys `allowed` (every one in `need`), nothing else. */
function onlyKeys(body: Record<string, unknown>, allowed: string[], need: string[]): void {
  for (const k of Object.keys(body)) if (!allowed.includes(k)) throw projectBad();
  for (const k of need) if (body[k] === undefined) throw projectBad();
}

const EMAIL_DRAFT_ID = /^[a-z0-9]{12}$/;
const noNewline = (v: string) => !/[\r\n\u2028\u2029]/.test(v);

/**
 * `POST ROUTES.projectEmailDrafts`: exactly an EmailDraftApproveRequest or an EmailDraftDismissRequest and no other
 * field. No token, address or thread id ever comes from the browser: the server reads the draft file itself.
 */
export function parseEmailDraftPost(body: unknown): EmailDraftApproveRequest | EmailDraftDismissRequest {
  if (!isRec(body) || typeof body.id !== 'string' || !EMAIL_DRAFT_ID.test(body.id)) throw projectBad();
  if (body.action === 'dismiss') {
    onlyKeys(body, ['action', 'id'], ['action', 'id']);
    return { action: 'dismiss', id: body.id };
  }
  if (body.action !== 'approve') throw projectBad();
  onlyKeys(
    body,
    ['action', 'id', 'key', 'summary', 'subject', 'from', 'people', 'clientSafe'],
    ['action', 'id', 'key', 'summary', 'subject', 'from', 'people', 'clientSafe'],
  );
  const { key, summary, subject, from, people, clientSafe } = body;
  const name = (v: unknown): v is string =>
    typeof v === 'string' && v.trim() !== '' && v.length <= EMAIL_NAME_MAX && noNewline(v);
  if (
    !isProjectKey(key) ||
    typeof summary !== 'string' ||
    summary.trim() === '' ||
    summary.trim().length > UPDATE_SUMMARY_MAX ||
    // An email can have no subject; the script saves it as given (correctness review).
    typeof subject !== 'string' ||
    subject.length > EMAIL_SUBJECT_MAX ||
    !noNewline(subject) ||
    !name(from) ||
    !Array.isArray(people) ||
    people.length > EMAIL_PEOPLE_MAX ||
    !people.every(name) ||
    typeof clientSafe !== 'boolean'
  )
    throw projectBad();
  return { action: 'approve', id: body.id, key, summary, subject, from, people: [...people], clientSafe };
}

/**
 * `POST ROUTES.projectsChange`: exactly one ProjectAction shape, no other fields. `capabilities` is the
 * script's own probe and not something a page may send. The service checks the values again.
 */
export function parseProjectAction(body: unknown): ProjectAction {
  if (!isRec(body) || typeof body.kind !== 'string') throw projectBad();
  switch (body.kind) {
    case 'create': {
      onlyKeys(body, ['kind', 'space', 'client', 'slug', 'fields'], ['space', 'slug', 'fields']);
      const { space, client, slug } = body;
      if (space !== 'client' && space !== 'personal') throw projectBad();
      if (!isSlug(slug)) throw projectBad();
      if (client !== undefined && !isSlug(client)) throw projectBad();
      const fields = parseProjectFields(body.fields);
      if (typeof fields.title !== 'string' || fields.title.trim() === '') throw projectBad();
      return {
        kind: 'create',
        space,
        ...(client !== undefined ? { client } : {}),
        slug,
        fields: { ...fields, title: fields.title },
      };
    }
    case 'card': {
      onlyKeys(body, ['kind', 'key', 'fields'], ['key', 'fields']);
      if (!isProjectKey(body.key)) throw projectBad();
      return { kind: 'card', key: body.key, fields: parseProjectFields(body.fields) };
    }
    case 'edit': {
      onlyKeys(body, ['kind', 'key', 'fields', 'expect'], ['key', 'fields', 'expect']);
      if (!isProjectKey(body.key) || typeof body.expect !== 'string' || !PROJECT_VERSION.test(body.expect))
        throw projectBad();
      return { kind: 'edit', key: body.key, fields: parseProjectFields(body.fields), expect: body.expect };
    }
    case 'link':
    case 'unlink': {
      onlyKeys(body, ['kind', 'key', 'path', 'expect'], ['key', 'path', 'expect']);
      if (
        !isProjectKey(body.key) ||
        typeof body.path !== 'string' ||
        body.path === '' ||
        body.path.length > PROJECT_PATH_MAX ||
        typeof body.expect !== 'string' ||
        !PROJECT_VERSION.test(body.expect)
      )
        throw projectBad();
      return { kind: body.kind, key: body.key, path: body.path, expect: body.expect };
    }
    case 'update': {
      onlyKeys(body, ['kind', 'key', 'entry'], ['key', 'entry']);
      if (!isProjectKey(body.key) || !isRec(body.entry)) throw projectBad();
      const entry = body.entry;
      if (entry.kind === 'chat') {
        // Chat summaries (decision 1): the route checks ownership and the body's layout before the script runs.
        onlyKeys(
          entry,
          ['kind', 'summary', 'clientSafe', 'chat', 'title'],
          ['kind', 'summary', 'clientSafe', 'chat', 'title'],
        );
        if (
          typeof entry.summary !== 'string' ||
          entry.summary.trim() === '' ||
          entry.summary.trim().length > UPDATE_SUMMARY_MAX ||
          typeof entry.clientSafe !== 'boolean' ||
          typeof entry.chat !== 'string' ||
          !CHAT_ID_PATTERN.test(entry.chat) ||
          typeof entry.title !== 'string' ||
          entry.title.trim() === '' ||
          entry.title.trim().length > CHAT_TITLE_MAX ||
          !noNewline(entry.title)
        )
          throw projectBad();
        return {
          kind: 'update',
          key: body.key,
          entry: {
            kind: 'chat',
            summary: entry.summary,
            clientSafe: entry.clientSafe,
            chat: entry.chat,
            title: entry.title.trim(),
          },
        };
      }
      onlyKeys(entry, ['kind', 'summary', 'clientSafe'], ['kind', 'summary', 'clientSafe']);
      if (
        (entry.kind !== 'note' && entry.kind !== 'call') ||
        typeof entry.summary !== 'string' ||
        entry.summary.trim() === '' ||
        entry.summary.trim().length > UPDATE_SUMMARY_MAX ||
        typeof entry.clientSafe !== 'boolean'
      )
        throw projectBad();
      return {
        kind: 'update',
        key: body.key,
        entry: { kind: entry.kind, summary: entry.summary, clientSafe: entry.clientSafe },
      };
    }
    case 'update-remove': {
      onlyKeys(body, ['kind', 'key', 'file', 'expect'], ['key', 'file', 'expect']);
      if (
        !isProjectKey(body.key) ||
        typeof body.file !== 'string' ||
        body.file === '' ||
        body.file.length > PROJECT_PATH_MAX ||
        typeof body.expect !== 'string' ||
        !PROJECT_VERSION.test(body.expect)
      )
        throw projectBad();
      return { kind: 'update-remove', key: body.key, file: body.file, expect: body.expect };
    }
    case 'ref': {
      // Project codes (R2 phase 4b): exactly one of three shapes.
      if (body.all !== undefined) {
        onlyKeys(body, ['kind', 'all'], ['all']);
        if (body.all !== true) throw projectBad();
        return { kind: 'ref', all: true };
      }
      onlyKeys(body, ['kind', 'key', 'expect', 'replace'], ['key', 'expect']);
      if (!isProjectKey(body.key) || typeof body.expect !== 'string' || !PROJECT_VERSION.test(body.expect))
        throw projectBad();
      if (body.replace !== undefined && body.replace !== true) throw projectBad();
      return {
        kind: 'ref',
        key: body.key,
        expect: body.expect,
        ...(body.replace === true ? { replace: true as const } : {}),
      };
    }
    default:
      throw projectBad();
  }
}

/**
 * `POST ROUTES.projectsMove` (move plan): exactly `key`, `client` and `expect`, with `dropPersonal` and
 * `check` only ever `true`. The client is a client folder name, never `personal`.
 */
export function parseProjectMove(body: unknown): ProjectMoveRequest {
  if (!isRec(body)) throw projectBad();
  onlyKeys(
    body,
    ['key', 'client', 'expect', 'dropPersonal', 'check', 'filesExpect'],
    ['key', 'client', 'expect'],
  );
  const { key, client, expect, dropPersonal, check, filesExpect } = body;
  if (!isProjectKey(key) || !isSlug(client) || client === 'personal') throw projectBad();
  if (typeof expect !== 'string' || !PROJECT_VERSION.test(expect)) throw projectBad();
  if ((dropPersonal !== undefined && dropPersonal !== true) || (check !== undefined && check !== true))
    throw projectBad();
  // The check's filesVersion (security review): optional, so an older app still moves.
  if (filesExpect !== undefined && (typeof filesExpect !== 'string' || !PROJECT_VERSION.test(filesExpect)))
    throw projectBad();
  return {
    key,
    client,
    expect,
    ...(dropPersonal === true ? { dropPersonal: true } : {}),
    ...(check === true ? { check: true } : {}),
    ...(filesExpect !== undefined ? { filesExpect } : {}),
  };
}

/**
 * `POST ROUTES.projectsArchive` / `ROUTES.projectsDelete` (archive plan): exactly `key` and `action`
 * (the archive route takes 'archive' or 'unarchive', the delete route 'delete'), with `expect`,
 * `filesExpect`, `check` (only ever `true`) and `todos` (not with `check`) optional. A to-do choice must
 * fit the action: archive 'done' | 'keep', delete 'delete' | 'unlink'; unarchive takes none.
 */
export function parseProjectRemove(body: unknown, route: 'archive' | 'delete'): ProjectRemoveRequest {
  if (!isRec(body)) throw projectBad();
  onlyKeys(body, ['key', 'action', 'expect', 'check', 'filesExpect', 'todos'], ['key', 'action']);
  const { key, action, expect, check, filesExpect, todos } = body;
  if (!isProjectKey(key)) throw projectBad();
  const actions = route === 'archive' ? ['archive', 'unarchive'] : ['delete'];
  if (typeof action !== 'string' || !actions.includes(action)) throw projectBad();
  for (const v of [expect, filesExpect]) {
    if (v !== undefined && (typeof v !== 'string' || !PROJECT_VERSION.test(v))) throw projectBad();
  }
  if (check !== undefined && check !== true) throw projectBad();
  let choices: NonNullable<ProjectRemoveRequest['todos']> | undefined;
  if (todos !== undefined) {
    const fits = action === 'archive' ? ['done', 'keep'] : action === 'delete' ? ['delete', 'unlink'] : [];
    if (check === true || !Array.isArray(todos) || todos.length > 500) throw projectBad();
    choices = todos.map((t) => {
      if (!isRec(t)) throw projectBad();
      onlyKeys(t, ['id', 'scope', 'version', 'do'], ['id', 'scope', 'version', 'do']);
      if (
        typeof t.id !== 'string' ||
        t.id === '' ||
        t.id.length > 255 ||
        /[\\/\0]/.test(t.id) ||
        t.id.startsWith('.')
      )
        throw projectBad();
      if (!isTodoScope(t.scope) || typeof t.version !== 'string' || !PROJECT_VERSION.test(t.version))
        throw projectBad();
      if (typeof t.do !== 'string' || !fits.includes(t.do)) throw projectBad();
      return {
        id: t.id,
        scope: t.scope,
        version: t.version,
        do: t.do as 'done' | 'keep' | 'delete' | 'unlink',
      };
    });
  }
  return {
    key,
    action: action as ProjectRemoveRequest['action'],
    ...(expect !== undefined ? { expect: expect as string } : {}),
    ...(check === true ? { check: true } : {}),
    ...(filesExpect !== undefined ? { filesExpect: filesExpect as string } : {}),
    ...(choices !== undefined ? { todos: choices } : {}),
  };
}

/** One tidy suggestion: exactly the fields of its `do`, with `why` the one value that `do` has. */
function parseTidySuggestion(v: unknown): TidySuggestion {
  if (!isRec(v) || typeof v.do !== 'string') throw projectBad();
  switch (v.do) {
    case 'link':
      onlyKeys(v, ['do', 'key', 'why'], ['key', 'why']);
      if (!isProjectKey(v.key) || v.why !== 'same-slug') throw projectBad();
      return { do: 'link', key: v.key, why: 'same-slug' };
    case 'client-only':
      onlyKeys(v, ['do', 'client', 'why'], ['client', 'why']);
      if (!isSlug(v.client) || v.why !== 'is-a-client') throw projectBad();
      return { do: 'client-only', client: v.client, why: 'is-a-client' };
    case 'merge':
      onlyKeys(v, ['do', 'into', 'why'], ['into', 'why']);
      if (!isText(v.into, PROJECT_LABEL_MAX) || v.into === '' || v.why !== 'near-spelling')
        throw projectBad();
      return { do: 'merge', into: v.into, why: 'near-spelling' };
    case 'clear':
      onlyKeys(v, ['do', 'why'], ['why']);
      if (v.why !== 'placeholder') throw projectBad();
      return { do: 'clear', why: 'placeholder' };
    case 'new-project':
      onlyKeys(v, ['do', 'client', 'slug', 'why'], ['client', 'slug', 'why']);
      if (!(v.client === null || isSlug(v.client)) || !isSlug(v.slug) || v.why !== 'no-match')
        throw projectBad();
      return { do: 'new-project', client: v.client, slug: v.slug, why: 'no-match' };
    case 'skip':
      onlyKeys(v, ['do', 'why'], ['why']);
      if (v.why !== 'no-match') throw projectBad();
      return { do: 'skip', why: 'no-match' };
    default:
      throw projectBad();
  }
}

/** `POST ROUTES.projectsTidy`: a TidyApply: one old label, and approve (with the suggestion), skip or unskip. */
export function parseTidyApply(body: unknown): TidyApply {
  if (!isRec(body) || typeof body.do !== 'string') throw projectBad();
  if (!isText(body.label, PROJECT_LABEL_MAX) || body.label === '') throw projectBad();
  const label = body.label;
  if (body.do === 'approve') {
    onlyKeys(body, ['label', 'do', 'suggestion'], ['suggestion']);
    return { label, do: 'approve', suggestion: parseTidySuggestion(body.suggestion) };
  }
  if (body.do === 'skip' || body.do === 'unskip') {
    onlyKeys(body, ['label', 'do'], []);
    return { label, do: body.do };
  }
  throw projectBad();
}

/** A ProjectsError becomes its status and plain message; anything else is logged and answered as a 500. */
function projectsFailure(err: unknown, ctx: RouteContext, what: string): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof ProjectsError) {
    // `exists` is a clash like `changed`: the nearest API code (as for library deletes).
    return new HttpError(
      PROJECTS_ERROR_STATUS[err.code],
      err.code === 'exists' ? 'changed' : err.code,
      err.message,
    );
  }
  ctx.log(`${what} failed unexpectedly.`);
  return new HttpError(500, 'internal', PROJECTS_INTERNAL);
}

const ARTIFACT_BAD_ADDRESS =
  "That isn't a link to a claude.ai page. Open the page on claude.ai, press Share and copy its link.";
const ARTIFACT_BAD_TITLE = 'Give the page a name of up to 200 characters.';
const ARTIFACT_BAD_DESCRIPTION = 'The description can be up to 300 characters.';
const ARTIFACT_NOT_ALLOWED = "Adding a claude.ai page isn't available to you in the app yet.";
const ARTIFACT_REFUSALS = {
  'no-card': 'This project needs a card before pages can be added to it.',
  archived: "Pages can't be added to an archived project.",
  legacy: "Pages can't be added to this older project from the app yet.",
} as const;

/**
 * `POST ROUTES.projectArtifact`: exactly `key`, `url` and `title`, with `description` optional. The address is
 * cleaned (trimmed, query and fragment dropped) and must be a claude.ai artifact link; no path ever comes from the browser.
 */
export function parseProjectArtifact(body: unknown): ProjectArtifactRequest {
  if (!isRec(body)) throw projectBad();
  onlyKeys(body, ['key', 'url', 'title', 'description'], ['key', 'url', 'title']);
  if (!isProjectKey(body.key) || typeof body.url !== 'string' || typeof body.title !== 'string')
    throw projectBad();
  const url = cleanArtifactUrl(body.url);
  if (url === null) throw new HttpError(400, 'bad-request', ARTIFACT_BAD_ADDRESS);
  const title = cleanArtifactTitle(body.title);
  if (title === null) throw new HttpError(400, 'bad-request', ARTIFACT_BAD_TITLE);
  let description: string | undefined;
  if (body.description !== undefined) {
    const d = cleanArtifactDescription(body.description);
    if (d === null) throw new HttpError(400, 'bad-request', ARTIFACT_BAD_DESCRIPTION);
    if (d !== '') description = d;
  }
  return { key: body.key, url, title, ...(description !== undefined ? { description } : {}) };
}

// ---------------------------------------------------------------------------
// Chat summaries (plan 2026-11-24-chat-summary-updates, decisions 2-4, 10)
// ---------------------------------------------------------------------------

const CHAT_NOT_HERE = "That chat couldn't be found on this Mac.";
const CHAT_NOT_YOURS = 'Only the person who had this chat can save a summary of it.';
const CHAT_PROJECT_CLOSED = "Chat summaries can't be saved to an archived project.";
const CHAT_NO_CARD = 'This project needs a card before chat summaries can be saved to it.';
const CHAT_NEEDS_SKILLS = "Update the brain's skills to save chat summaries to projects.";
const CHAT_BAD_BODY = "That summary isn't in the layout the app saves. Open Save to project again.";
const CHAT_BAD_DOC = "One of the documents can't be linked. Untick it and try again.";
const CHAT_PERSONAL_DOC =
  "A file in your personal files can't be linked from a shared project. Untick it and try again.";

/** `POST ROUTES.chatSummaryDraft`: exactly `chat` and `project`. */
export function parseChatSummaryDraft(body: unknown): ChatSummaryDraftRequest {
  if (!isRec(body)) throw projectBad();
  onlyKeys(body, ['chat', 'project'], ['chat', 'project']);
  if (typeof body.chat !== 'string' || !CHAT_ID_PATTERN.test(body.chat) || !isProjectKey(body.project))
    throw projectBad();
  return { chat: body.chat, project: body.project };
}

/**
 * The live project a summary may be saved to (followed through moved keys), for this person. Throws HttpError:
 * not-found (no such project) or not-allowed (archived, no card, no capability or this person can't change projects).
 */
async function savableCard(
  ctx: RouteContext,
  list: NonNullable<RouteContext['brain']['projects']>,
  key: ProjectKey,
  who: Identity,
): Promise<ProjectCard> {
  const projects = await list.call(ctx.brain, who);
  const card =
    projects.projects.find((c) => c.key === key) ??
    projects.projects.find((c) => (c.movedFrom ?? []).includes(key)) ??
    null;
  if (!card) throw new HttpError(404, 'not-found', "That project couldn't be found. It may have been moved.");
  if (card.archived) throw new HttpError(403, 'not-allowed', CHAT_PROJECT_CLOSED);
  if (card.card !== 'ok') throw new HttpError(403, 'not-allowed', CHAT_NO_CARD);
  if (projects.canChange !== true) throw new HttpError(403, 'not-allowed', PROJECTS_NOT_ALLOWED);
  if (projects.canSaveChat !== true) throw new HttpError(403, 'not-allowed', CHAT_NEEDS_SKILLS);
  return card;
}

/**
 * Before a `chat` entry reaches the script (decisions 2, 3; overseer should 3): only this Mac's own chat, a body
 * in the layout, and every document an https address or a brain file the library lists, never a `personal/`
 * file on a shared project. Answers the project's live key, for the saved count. Throws HttpError.
 */
async function checkChatSummarySave(
  ctx: RouteContext,
  key: ProjectKey,
  entry: { chat: string; summary: string },
): Promise<ProjectKey> {
  const owns = ctx.sessions.chatSummaries?.owns ?? ctx.sessions.ownsChat;
  if (!owns || !(await safe(owns(entry.chat), false)))
    throw new HttpError(403, 'not-allowed', CHAT_NOT_YOURS);
  const fields = readChatSummary(entry.summary);
  if (!fields) throw new HttpError(400, 'bad-request', CHAT_BAD_BODY);
  const card = ctx.brain.projectsIndex
    ? ((await safe(ctx.brain.projectsIndex(), null))?.byKey(key) ?? null)
    : null;
  const shared = card ? card.space !== 'personal' : !key.startsWith('personal/');
  for (const doc of fields.documents) {
    const ref = doc.ref;
    if (/^https:\/\//i.test(ref)) {
      let ok = false;
      try {
        const u = new URL(ref);
        ok = u.protocol === 'https:' && u.username === '' && u.password === '';
      } catch {
        ok = false;
      }
      if (!ok) throw new HttpError(400, 'bad-request', CHAT_BAD_DOC);
      continue;
    }
    const personal = ref === 'personal' || ref.startsWith('personal/');
    if (personal && shared) throw new HttpError(400, 'bad-request', CHAT_PERSONAL_DOC);
    if (ref.startsWith('/') || ref.split('/').some((seg) => seg === '..' || seg === '.' || seg === ''))
      throw new HttpError(400, 'bad-request', CHAT_BAD_DOC);
    const found = ctx.brain.libraryItemForPath ? await safe(ctx.brain.libraryItemForPath(ref), null) : null;
    if (!found?.item) throw new HttpError(400, 'bad-request', CHAT_BAD_DOC);
    if (shared && found.scope.kind === 'personal') throw new HttpError(400, 'bad-request', CHAT_PERSONAL_DOC);
  }
  return card?.key ?? key;
}

/** Hands the brain this app's `ownsChat` once, so `chat` entries can say "Open chat" (decision 12). */
const boundHolds = new WeakMap<object, unknown>();
function bindHoldsChat(ctx: RouteContext): void {
  const set = ctx.brain.setHoldsChat;
  const owns = ctx.sessions.ownsChat;
  if (!set || !owns || boundHolds.get(ctx.brain) === ctx.sessions) return;
  boundHolds.set(ctx.brain, ctx.sessions);
  set.call(ctx.brain, (chatId) => owns.call(ctx.sessions, chatId));
}

/** Sets `canAddArtifact` (true only; absent otherwise) on a list the route sends: changes allowed and the files skill can add pages. */
async function withArtifactFlag(ctx: RouteContext, list: ProjectList, who: Identity): Promise<ProjectList> {
  const service = ctx.brain.projectArtifact;
  if (!service || !list || list.canChange !== true) return list;
  return (await safe(service.canAdd(who), false)) ? { ...list, canAddArtifact: true } : list;
}

/** The six projects routes. Every one has already passed the security gate. */
async function projectsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: RouteContext,
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const path = url.pathname;
  const identity = () => safe(ctx.brain.identity(), UNKNOWN_IDENTITY);
  const missing = () => new HttpError(404, 'not-found', PROJECTS_NOT_THERE);

  if (path === ROUTES.projects) {
    if (method !== 'GET') throw methodNotAllowed();
    const list = ctx.brain.projects;
    if (!list) throw missing();
    try {
      const who = await identity();
      sendJson(res, 200, await withArtifactFlag(ctx, await list.call(ctx.brain, who), who));
    } catch (err) {
      throw projectsFailure(err, ctx, 'Reading the projects');
    }
    return;
  }

  if (path === ROUTES.projectsChange) {
    if (method !== 'POST') throw methodNotAllowed();
    const body = await readJson(req);
    const action = parseProjectAction(body);
    const change = ctx.brain.changeProject;
    if (!change) throw missing();
    // Review fix (release 1): only people the `tdsapp-projects` skill's `roles:` allow.
    const who = await identity();
    if ((await safe(ctx.brain.skillAccess(who, PROJECTS_SKILL), 'unknown-skill' as const)) !== 'allowed')
      throw new HttpError(403, 'not-allowed', PROJECTS_NOT_ALLOWED);
    // Project codes: a backfill of every card is the brain Owner's alone, refused before the script runs.
    if (action.kind === 'ref' && action.all === true && who.role !== 'owner' && who.role !== 'scout')
      throw new HttpError(
        403,
        'not-allowed',
        'Only an owner or a scout can give every project a code at once.',
      );
    const chatEntry = action.kind === 'update' && action.entry.kind === 'chat' ? action.entry : null;
    const savedKey =
      chatEntry && action.kind === 'update' ? await checkChatSummarySave(ctx, action.key, chatEntry) : null;
    try {
      const list = await change.call(ctx.brain, action, who);
      // Counted, not timed (decision 10): the nudge lists this chat again only once it has new messages.
      if (chatEntry && savedKey) await ctx.sessions.chatSummaries?.recordSaved(chatEntry.chat, savedKey);
      ctx.log(`Changed a project (${action.kind}).`);
      sendJson(res, 200, await withArtifactFlag(ctx, list, who));
    } catch (err) {
      throw projectsFailure(err, ctx, 'A project change');
    }
    return;
  }

  if (path === ROUTES.projectArtifact) {
    if (method !== 'POST') throw methodNotAllowed();
    const body = await readJson(req);
    const add = parseProjectArtifact(body);
    const list = ctx.brain.projects;
    const service = ctx.brain.projectArtifact;
    if (!list || !service) throw missing();
    // The same roles check as any project change; then the files skill's own (inside `add`).
    const who = await identity();
    if ((await safe(ctx.brain.skillAccess(who, PROJECTS_SKILL), 'unknown-skill' as const)) !== 'allowed')
      throw new HttpError(403, 'not-allowed', PROJECTS_NOT_ALLOWED);
    try {
      const projects = await list.call(ctx.brain, who);
      const card = projects.projects.find((c) => c.key === add.key);
      if (!card) throw new HttpError(404, 'not-found', PROJECTS_NOT_THERE);
      const refusal = artifactRefusal(card);
      if (refusal) throw new HttpError(403, 'not-allowed', ARTIFACT_REFUSALS[refusal]);
      if (projects.canChange !== true || !(await safe(service.canAdd(who), false)))
        throw new HttpError(403, 'not-allowed', ARTIFACT_NOT_ALLOWED);
      const saved = await service.add(
        card,
        {
          url: add.url,
          title: add.title,
          ...(add.description !== undefined ? { description: add.description } : {}),
        },
        who,
      );
      ctx.log('Added a claude.ai page to a project.');
      sendJson(res, 200, saved);
    } catch (err) {
      if (err instanceof FilesChangeError) {
        const code = err.code === 'exists' ? 'changed' : err.code;
        throw new HttpError(FILES_CHANGE_STATUS[err.code], code, err.message);
      }
      throw projectsFailure(err, ctx, 'Adding a claude.ai page');
    }
    return;
  }

  if (path === ROUTES.projectsMove) {
    if (method !== 'POST') throw methodNotAllowed();
    const body = await readJson(req);
    const move = parseProjectMove(body);
    const run = ctx.brain.moveProject;
    if (!run) throw missing();
    // The same roles check as any project change.
    const who = await identity();
    if ((await safe(ctx.brain.skillAccess(who, PROJECTS_SKILL), 'unknown-skill' as const)) !== 'allowed')
      throw new HttpError(403, 'not-allowed', PROJECTS_NOT_ALLOWED);
    // The to-dos follow the project only where the app may change to-dos (the Settings switch and the
    // to-do script), as the tidy-up; otherwise they stay and still resolve through the old key.
    const prefs = await ctx.store.get();
    const todos = prefs.directWrites ? await safe(ctx.brain.todos(who), null) : null;
    const repoint = todos?.changes === 'on' && todos.canProject === true;
    try {
      const answer = await run.call(ctx.brain, move, who, { todos: repoint });
      ctx.log(move.check ? 'Checked a project move.' : 'Moved a project to another client.');
      sendJson(
        res,
        200,
        'list' in answer ? { ...answer, list: await withArtifactFlag(ctx, answer.list, who) } : answer,
      );
    } catch (err) {
      throw projectsFailure(err, ctx, move.check ? 'A project move check' : 'A project move');
    }
    return;
  }

  if (path === ROUTES.projectsArchive || path === ROUTES.projectsDelete) {
    if (method !== 'POST') throw methodNotAllowed();
    const body = await readJson(req);
    const isDelete = path === ROUTES.projectsDelete;
    const change = parseProjectRemove(body, isDelete ? 'delete' : 'archive');
    const run = ctx.brain.removeProject;
    if (!run) throw missing();
    // The same roles check as any project change; whether this person may archive or delete THIS project
    // is the skill script's answer alone.
    const who = await identity();
    if ((await safe(ctx.brain.skillAccess(who, PROJECTS_SKILL), 'unknown-skill' as const)) !== 'allowed')
      throw new HttpError(403, 'not-allowed', PROJECTS_NOT_ALLOWED);
    // To-do choices run only where the app may change to-dos (the Settings switch and the to-do script).
    const prefs = await ctx.store.get();
    const todoState = prefs.directWrites ? await safe(ctx.brain.todos(who), null) : null;
    const mayTodos = todoState?.changes === 'on';
    const what = change.check ? `A project ${change.action} check` : `A project ${change.action}`;
    try {
      const answer = await run.call(ctx.brain, change, who, { todos: mayTodos });
      ctx.log(`${what} was done.`);
      sendJson(
        res,
        200,
        'list' in answer ? { ...answer, list: await withArtifactFlag(ctx, answer.list, who) } : answer,
      );
    } catch (err) {
      throw projectsFailure(err, ctx, what);
    }
    return;
  }

  if (path === ROUTES.projectFiles) {
    if (method !== 'GET') throw methodNotAllowed();
    const key = url.searchParams.get('key');
    const kind = url.searchParams.get('kind');
    if (!isProjectKey(key) || (kind !== 'image' && kind !== 'document')) throw projectBad();
    const files = ctx.brain.projectFiles;
    if (!files) throw missing();
    try {
      sendJson(res, 200, await files.call(ctx.brain, key, kind, await identity()));
    } catch (err) {
      throw projectsFailure(err, ctx, "Reading a project's files");
    }
    return;
  }

  if (path === ROUTES.projectUpdates) {
    if (method !== 'GET') throw methodNotAllowed();
    const key = url.searchParams.get('key');
    const before = url.searchParams.get('before');
    if (!isProjectKey(key) || (before !== null && (before === '' || before.length > PROJECT_PATH_MAX)))
      throw projectBad();
    const read = ctx.brain.projectUpdates;
    if (!read) throw missing();
    bindHoldsChat(ctx);
    try {
      sendJson(res, 200, await read.call(ctx.brain, key, before, await identity()));
    } catch (err) {
      throw projectsFailure(err, ctx, "Reading a project's updates");
    }
    return;
  }

  if (path === ROUTES.chatSummaryDraft) {
    if (method !== 'POST') throw methodNotAllowed();
    const draftReq = parseChatSummaryDraft(await readJson(req));
    const service = ctx.sessions.chatSummaries;
    const list = ctx.brain.projects;
    if (!service || !list) throw missing();
    // Only the person who ran the chat (decision 3): a chat this Mac doesn't hold is not found.
    if (!(await service.owns(draftReq.chat))) throw new HttpError(404, 'not-found', CHAT_NOT_HERE);
    const who = await identity();
    if ((await safe(ctx.brain.skillAccess(who, PROJECTS_SKILL), 'unknown-skill' as const)) !== 'allowed')
      throw new HttpError(403, 'not-allowed', PROJECTS_NOT_ALLOWED);
    try {
      const card = await savableCard(ctx, list, draftReq.project, who);
      const earlier = (await ctx.brain.chatEntries?.(card.key, draftReq.chat, who)) ?? [];
      const draft = await service.draft({
        chat: draftReq.chat,
        project: { key: card.key, title: card.title, personal: card.space === 'personal' },
        earlier,
      });
      ctx.log('Drafted a chat summary.');
      sendJson(res, 200, draft);
    } catch (err) {
      if (err instanceof ChatDraftError) throw new HttpError(statusFor(err.code), err.code, err.message);
      throw projectsFailure(err, ctx, 'A chat summary draft');
    }
    return;
  }

  if (path === ROUTES.projectUnsavedChats) {
    if (method !== 'GET') throw methodNotAllowed();
    const key = url.searchParams.get('key');
    if (!isProjectKey(key)) throw projectBad();
    const list = ctx.brain.projects;
    if (!list) throw missing();
    const none: UnsavedChatsResponse = { chats: [], canSave: false };
    const service = ctx.sessions.chatSummaries;
    const who = await identity();
    if (
      !service ||
      (await safe(ctx.brain.skillAccess(who, PROJECTS_SKILL), 'unknown-skill' as const)) !== 'allowed'
    ) {
      sendJson(res, 200, none);
      return;
    }
    let card: ProjectCard;
    try {
      card = await savableCard(ctx, list, key, who);
    } catch (err) {
      if (err instanceof HttpError && err.code === 'not-allowed') {
        sendJson(res, 200, none);
        return;
      }
      throw projectsFailure(err, ctx, 'Reading the chats not saved yet');
    }
    try {
      const entries = ctx.brain.chatEntries;
      const chats = await service.unsaved({
        keys: [card.key, ...(card.movedFrom ?? [])],
        since: Date.now() - UNSAVED_CHATS_DAYS * 24 * 60 * 60 * 1000,
        hasEntry: async (chat) => (entries ? (await entries(card.key, chat, who)).length > 0 : false),
      });
      const body: UnsavedChatsResponse = { chats, canSave: true };
      sendJson(res, 200, body);
    } catch (err) {
      throw projectsFailure(err, ctx, 'Reading the chats not saved yet');
    }
    return;
  }

  if (path === ROUTES.projectEmailDrafts) {
    const drafts = ctx.brain.emailDrafts;
    if (!drafts) throw missing();
    if (method === 'GET') {
      const key = url.searchParams.get('key');
      if (key !== null && !isProjectKey(key)) throw projectBad();
      try {
        sendJson(res, 200, await drafts.list(key));
      } catch (err) {
        throw projectsFailure(err, ctx, 'Reading the emails waiting for approval');
      }
      return;
    }
    if (method !== 'POST') throw methodNotAllowed();
    const post = parseEmailDraftPost(await readJson(req));
    // The same roles check as any project change; the service checks the draft's owner and the script's again.
    const who = await identity();
    if ((await safe(ctx.brain.skillAccess(who, PROJECTS_SKILL), 'unknown-skill' as const)) !== 'allowed')
      throw new HttpError(403, 'not-allowed', PROJECTS_NOT_ALLOWED);
    try {
      if (post.action === 'dismiss') {
        await drafts.dismiss(post.id);
        ctx.log('Cleared an email waiting for approval.');
        sendJson(res, 200, { ok: true });
        return;
      }
      const answer = await drafts.approve(post);
      ctx.log(answer.ok ? 'Saved an approved email to a project.' : 'An email was already in a project.');
      sendJson(res, 200, answer);
    } catch (err) {
      throw projectsFailure(err, ctx, 'Saving an email to a project');
    }
    return;
  }

  if (path === ROUTES.projectTodos) {
    if (method !== 'GET') throw methodNotAllowed();
    const key = url.searchParams.get('key');
    if (!isProjectKey(key)) throw projectBad();
    const read = ctx.brain.projectTodos;
    if (!read) throw missing();
    try {
      sendJson(res, 200, await read.call(ctx.brain, key, await identity()));
    } catch (err) {
      throw projectsFailure(err, ctx, "Reading a project's tasks");
    }
    return;
  }

  if (path === ROUTES.projectActivity) {
    if (method !== 'GET') throw methodNotAllowed();
    const key = url.searchParams.get('key');
    if (!isProjectKey(key)) throw projectBad();
    const read = ctx.brain.projectActivity;
    if (!read) throw missing();
    try {
      sendJson(res, 200, await read.call(ctx.brain, key, await identity()));
    } catch (err) {
      throw projectsFailure(err, ctx, "Reading a project's activity");
    }
    return;
  }

  if (path === ROUTES.homeMeetings) {
    if (method !== 'GET') throw methodNotAllowed();
    const read = ctx.brain.homeMeetings;
    if (!read) throw missing();
    try {
      sendJson(res, 200, await read.call(ctx.brain));
    } catch (err) {
      throw projectsFailure(err, ctx, 'Reading your meetings');
    }
    return;
  }

  if (path === ROUTES.projectMeetings) {
    if (method !== 'GET') throw methodNotAllowed();
    const key = url.searchParams.get('key');
    if (!isProjectKey(key)) throw projectBad();
    const read = ctx.brain.projectMeetings;
    if (!read) throw missing();
    try {
      sendJson(res, 200, await read.call(ctx.brain, key));
    } catch (err) {
      throw projectsFailure(err, ctx, "Reading a project's meetings");
    }
    return;
  }

  if (path === ROUTES.projectBusiness) {
    if (method !== 'GET') throw methodNotAllowed();
    const key = url.searchParams.get('key');
    if (!isProjectKey(key)) throw projectBad();
    const read = ctx.brain.projectBusiness;
    if (!read) throw missing();
    try {
      sendJson(res, 200, await read.call(ctx.brain, key));
    } catch (err) {
      throw projectsFailure(err, ctx, "Reading a project's client background");
    }
    return;
  }

  if (path === ROUTES.projectSeen) {
    if (method !== 'POST') throw methodNotAllowed();
    const body = await readJson(req);
    // Exactly { key, token }: any other field is refused.
    if (
      !isRec(body) ||
      Object.keys(body).some((k) => k !== 'key' && k !== 'token') ||
      !isProjectKey(body.key) ||
      typeof body.token !== 'string' ||
      body.token === '' ||
      body.token.length > ACTIVITY_TOKEN_MAX
    )
      throw projectBad();
    const seen = ctx.brain.projectSeen;
    if (!seen) throw missing();
    try {
      await seen.call(ctx.brain, body.key, body.token, await identity());
    } catch (err) {
      throw projectsFailure(err, ctx, 'Saving what was seen');
    }
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  if (path === ROUTES.projectsTidy) {
    if (method === 'GET') {
      const tidy = ctx.brain.tidy;
      if (!tidy) throw missing();
      try {
        sendJson(res, 200, await tidy.call(ctx.brain, await identity()));
      } catch (err) {
        throw projectsFailure(err, ctx, 'Reading the tidy-up');
      }
      return;
    }
    if (method !== 'POST') throw methodNotAllowed();
    const body = await readJson(req);
    const apply = parseTidyApply(body);
    const run = ctx.brain.applyTidy;
    if (!run) throw missing();
    const who = await identity();
    // Skip and unskip only write the app's own data folder. An approval changes to-dos (a teammate's
    // included), so it follows the Settings switch and the same access changing a to-do needs.
    if (apply.do === 'approve') {
      const prefs = await ctx.store.get();
      if (!prefs.directWrites) throw new HttpError(403, 'not-allowed', TODO_SWITCHED_OFF);
      const list = await safe(ctx.brain.todos(who), null);
      if (list?.changes !== 'on' || !list.canProject)
        throw new HttpError(403, 'not-allowed', TODO_CHANGE_MESSAGES['not-allowed']);
    }
    try {
      const list = await run.call(ctx.brain, apply, who);
      ctx.log(`Tidied task projects (${apply.do}).`);
      sendJson(res, 200, list);
    } catch (err) {
      throw projectsFailure(err, ctx, 'The task tidy-up');
    }
    return;
  }

  throw new HttpError(404, 'not-found', 'There is nothing at that address.');
}

/**
 * `POST ROUTES.todoUpload`: exactly a TodoUploadRequest, no other fields. `upload`, `id` and `expect`
 * are text, `scope` 'tds' or 'personal' when present. The values are checked by `uploadTodoFile`.
 */
export function parseTodoUploadRequest(body: unknown): TodoUploadRequest {
  const bad = () => new HttpError(400, 'bad-request', TODO_CHANGE_MESSAGES['bad-request']);
  if (!isRec(body)) throw bad();
  for (const key of Object.keys(body)) {
    if (key !== 'upload' && key !== 'id' && key !== 'scope' && key !== 'expect') throw bad();
  }
  const { upload, id, scope, expect } = body;
  if (typeof upload !== 'string' || upload === '' || upload.length > 64) throw bad();
  if (typeof id !== 'string' || typeof expect !== 'string') throw bad();
  if (scope !== undefined && !isTodoScope(scope)) throw bad();
  return scope === undefined ? { upload, id, expect } : { upload, id, scope, expect };
}

/**
 * Files a staged upload on a to-do (release 3). The staged file is used up first, whatever happens
 * next, so the same upload can never be filed twice; the brain readers do the rest.
 */
async function uploadTodoFileRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const body = await readJson(req);
  const prefs = await ctx.store.get();
  if (!prefs.directWrites) throw new HttpError(403, 'not-allowed', TODO_SWITCHED_OFF);
  const request = parseTodoUploadRequest(body);
  let file: StagedFile | undefined;
  try {
    file = ctx.uploads.claim([request.upload]).files[0];
  } catch (err) {
    if (err instanceof UploadError) throw new HttpError(400, 'bad-request', err.message);
    throw err;
  }
  if (!file) throw new HttpError(400, 'bad-request', TODO_CHANGE_MESSAGES['bad-request']);
  // The staged kind must be the library's kind for that extension (an image is never filed as a document).
  const ext = extensionOf(file.name);
  if (!TODO_UPLOAD_TYPES.includes(ext) || classify(ext)?.kind !== file.kind) {
    throw new HttpError(400, 'bad-request', TODO_FILES_MESSAGES.badType);
  }
  let saved: { path: string; personal: boolean };
  try {
    saved = await ctx.brain.uploadTodoFile(
      {
        stagedPath: file.path,
        name: file.name,
        id: request.id,
        scope: request.scope ?? 'tds',
        expect: request.expect,
      },
      await safe(ctx.brain.identity(), UNKNOWN_IDENTITY),
    );
  } catch (err) {
    if (err instanceof TodoChangeError) throw new HttpError(statusFor(err.code), err.code, err.message);
    ctx.log('Adding a file to a task failed unexpectedly.');
    throw new HttpError(500, 'internal', TODO_CHANGE_MESSAGES.internal);
  }
  ctx.log(saved.personal ? 'Added a personal file to a task.' : 'Added a file to a task.');
  const out: TodoUploadResponse = { list: await todos(ctx), path: saved.path, personal: saved.personal };
  sendJson(res, 200, out);
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
const SESSION_ACTION = /^\/api\/sessions\/([^/]+)\/(messages|permission|answer|interrupt|resend|close|kind)$/;
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
      sendJson(res, 200, status);
      return;
    }
    if (path === ROUTES.updateCheck) {
      if (method !== 'POST') throw methodNotAllowed();
      sendJson(res, 200, updater ? await updater.check() : noUpdaterStatus(ctx));
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
    sendJson(res, 202, await updater.start());
  } catch (err) {
    if (err instanceof UpdateRefused) {
      if (err.reason === 'busy') throw new HttpError(409, 'busy', 'An update is already running.');
      throw new HttpError(403, 'not-allowed', "This copy of TDS Cortex can't update right now.");
    }
    throw err;
  }
}

// ── Ad Manager (plan 2026-11-16-workbench-ad-manager, decisions 10-12 and 18) ─────────────────────

const ADS_PREFIX = '/api/ads/';
const ADS_CHANGE_PREFIX = '/api/ads/do/';

/** The fields each change takes; anything else in the body (an actor, say) is never passed on (decision 10). */
const ADS_CHANGE_FIELDS: { [A in AdsChangeAction]: readonly (keyof AdsRequests[A] & string)[] } = {
  decide: ['client', 'id', 'action', 'note'],
  'dry-run': ['client', 'id'],
  apply: ['client', 'id', 'confirmed'],
  'client-draft': ['client', 'id', 'again'],
  'client-approved': ['client', 'id', 'who', 'note'],
  decided: ['client', 'id', 'note', 'draftChange'],
  'sign-monthly': ['client', 'month', 'note'],
  'standup-setup': ['account'],
  'standup-feedback': ['account', 'date', 'campaign', 'action_category', 'score', 'note'],
  'task-run': ['account', 'task'],
  'task-result': ['account', 'task', 'at', 'result'],
};
const isAdsChange = (a: string): a is AdsChangeAction => Object.hasOwn(ADS_CHANGE_FIELDS, a);

const NO_ADS: AdsCapabilities = { features: [], version: '', adsAccess: false, adsManager: false, me: null };

/** Ads errors carry the ads code itself in `error.code` (ADS_ERROR_STATUS), with the app's own words. */
function sendAdsError(res: ServerResponse, code: AdsErrorCode, output?: string): void {
  // The run's output only for an unknown outcome: the person needs it to check the account (decision 12).
  const extra = code === 'unknown-outcome' && output ? { output } : {};
  sendJson(res, ADS_ERROR_STATUS[code], { error: { code, message: ADS_ERROR_MESSAGES[code], ...extra } });
}

/** The bridge, when this person may use it: the skill allowed for them (restricted: not-allowed) and present. */
async function adsFor(ctx: RouteContext, identity: Identity): Promise<AdsService> {
  const access = await ctx.brain.skillAccess(identity, ADS_SKILL.skill);
  if (access === 'restricted') throw new AdsError('not-allowed');
  const ads = ctx.brain.ads;
  if (access !== 'allowed' || !ads) throw new AdsError('unavailable');
  return ads;
}

function adsParam(url: URL, name: string, pattern: RegExp): string {
  const v = url.searchParams.get(name);
  if (v === null || v.length > 120 || !pattern.test(v)) throw new AdsError('bad-request');
  return v;
}

/** Apply stays off, and the panel says so, while an apply of this proposal has no known outcome (decision 12). */
function markInflight<T>(p: T, client: string, held: AdsInflightEntry[]): T {
  if (!isRec(p) || typeof p.id !== 'string' || !isRec(p.flags)) return p;
  if (!held.some((e) => e.client === client && e.id === p.id)) return p;
  return { ...p, flags: { ...p.flags, canApply: false, inflight: true } };
}
function markApprovals(reply: Record<string, unknown>, held: AdsInflightEntry[]): Record<string, unknown> {
  if (held.length === 0 || !Array.isArray(reply.clients)) return reply;
  return {
    ...reply,
    clients: reply.clients.map((c: unknown) => {
      if (!isRec(c) || typeof c.slug !== 'string') return c;
      const slug = c.slug;
      const mark = (list: unknown) =>
        Array.isArray(list) ? list.map((p) => markInflight(p, slug, held)) : list;
      return { ...c, open: mark(c.open), recent: mark(c.recent) };
    }),
  };
}

async function adsRead(url: URL, ctx: RouteContext, ads: AdsService, path: string): Promise<unknown> {
  switch (path) {
    case ADS_ROUTES.accounts: {
      // Search reads this on every keystroke: a Mac that can't reach Google Ads (Ad Manager hidden) gets nothing.
      const caps = await ads.capabilities();
      if (!caps?.adsAccess) throw new AdsError('no-access');
      return (await ads.read('accounts', {})).accounts;
    }
    case ADS_ROUTES.approvals: {
      const input = url.searchParams.has('client')
        ? { client: adsParam(url, 'client', ADS_CLIENT_SLUG) }
        : {};
      return markApprovals(await ads.read('approvals', input), await ads.inflight());
    }
    case ADS_ROUTES.proposal: {
      const client = adsParam(url, 'client', ADS_CLIENT_SLUG);
      const id = adsParam(url, 'id', ADS_PROPOSAL_ID);
      const reply = await ads.read('proposal', { client, id });
      return markInflight(reply.proposal, client, await ads.inflight());
    }
    case ADS_ROUTES.board:
      return (await ads.read('board', { account: adsParam(url, 'account', ADS_ACCOUNT_KEY) })).board;
    case ADS_ROUTES.standupBrief:
      return (await ads.read('standup-brief', { account: adsParam(url, 'account', ADS_ACCOUNT_KEY) })).brief;
    case ADS_ROUTES.triage: {
      // Read each time the pop-up opens; a skill that can't build it is unavailable, not empty.
      const caps = await ads.capabilities();
      if (!caps?.features.includes(ADS_TRIAGE_CAPABILITY)) throw new AdsError('unavailable');
      const { rows } = await ads.read('triage', {});
      return { rows: Array.isArray(rows) ? rows : [] };
    }
    case ADS_ROUTES.file: {
      // Decision 18: only reports and proposals, never `..` or `.`, and only what the library lists.
      const p = url.searchParams.get('p') ?? '';
      if (
        p.length > 1000 ||
        !ADS_FILE_PATTERN.test(p) ||
        p.split('/').some((seg) => seg === '..' || seg === '.')
      ) {
        throw new AdsError('bad-request');
      }
      const found = ctx.brain.libraryItemForPath ? await ctx.brain.libraryItemForPath(p) : null;
      if (!found?.item) throw new AdsError('not-found');
      return found.item;
    }
    default:
      throw new HttpError(404, 'not-found', 'There is nothing at that address.');
  }
}

/** The bridge's person must be the app's person before anything changes (decision 10). */
async function adsChanger(ads: AdsService, identity: Identity): Promise<AdsCapabilities> {
  const caps = await ads.capabilities();
  if (!caps) throw new AdsError('unavailable');
  if (!caps.me || caps.me.slug !== identity.slug) throw new AdsError('not-allowed');
  return caps;
}

/** A task id: a cadence card id (lower-case words) or `standup:daily`. The bridge checks it against its list. */
const ADS_TASK_ID = /^[a-z0-9][a-z0-9:-]{0,63}$/;

/** A chat's app id (a UUID today; any plain token is accepted, the session manager says whether it is live). */
const ADS_CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The file a finished chat saved for this account: the newest (by `order`) in its latest `files` event that it
 * created or changed, matching ADS_FILE_PATTERN under `clients/<account>/`. Null for no live chat or no such file.
 * The browser can't see a background chat's files, so the server replays them (plan 2026-11-19-ads-release-2, 5).
 */
function pickChatResult(ctx: RouteContext, chat: string, account: string): string | null {
  let sub: { replay: SequencedEvent[]; unsubscribe(): void };
  try {
    sub = ctx.sessions.subscribe(chat, 0, () => {});
  } catch (err) {
    if (err instanceof SessionError) return null;
    throw err;
  }
  sub.unsubscribe();
  let files: ChatFile[] = [];
  for (const { event } of sub.replay) if (event.type === 'files') files = event.files;
  const prefix = `clients/${account}/`;
  let best: ChatFile | null = null;
  for (const f of files) {
    if (!(f.actions.includes('created') || f.actions.includes('changed'))) continue;
    if (!ADS_FILE_PATTERN.test(f.path) || !f.path.startsWith(prefix)) continue;
    if (f.path.split('/').some((seg) => seg === '..' || seg === '.')) continue;
    if (!best || f.order > best.order) best = f;
  }
  return best?.path ?? null;
}

async function adsChange(
  req: IncomingMessage,
  ctx: RouteContext,
  ads: AdsService,
  identity: Identity,
  action: AdsChangeAction,
): Promise<unknown> {
  const body = await readJson(req);
  if (!isRec(body)) throw new AdsError('bad-request');
  const caps = await adsChanger(ads, identity);
  if (action === 'task-run') {
    // An older skill can't record runs (the app then keeps them in the browser only).
    if (!caps.features.includes(ADS_TASK_RUNS_CAPABILITY)) throw new AdsError('unavailable');
    const { account, task } = body;
    if (typeof account !== 'string' || !ADS_ACCOUNT_KEY.test(account)) throw new AdsError('bad-request');
    if (typeof task !== 'string' || !ADS_TASK_ID.test(task)) throw new AdsError('bad-request');
  }
  if (action === 'task-result') {
    if (!caps.features.includes(ADS_TASK_RESULTS_CAPABILITY)) throw new AdsError('unavailable');
    const { account, task, at, chat } = body;
    if (typeof account !== 'string' || !ADS_ACCOUNT_KEY.test(account)) throw new AdsError('bad-request');
    if (typeof task !== 'string' || !ADS_TASK_ID.test(task)) throw new AdsError('bad-request');
    if (typeof at !== 'string' || at.length > 40 || Number.isNaN(Date.parse(at))) {
      throw new AdsError('bad-request');
    }
    if (typeof chat !== 'string' || !ADS_CHAT_ID.test(chat)) throw new AdsError('bad-request');
    const result = pickChatResult(ctx, chat, account);
    if (result === null) return { result: null };
    await ads.change('task-result', { account, task, at, result });
    return { result };
  }
  const input: Record<string, unknown> = {};
  for (const key of ADS_CHANGE_FIELDS[action] as readonly string[]) {
    if (key === 'draftChange') {
      if (typeof body[key] === 'boolean') input[key] = body[key];
    } else if (body[key] !== undefined) input[key] = body[key];
  }
  const reply = await ads.change(action, input);
  if (isRec(reply.proposal) && typeof input.client === 'string') {
    return { ...reply, proposal: markInflight(reply.proposal, input.client, await ads.inflight()) };
  }
  return reply;
}

/** Handles `/api/ads/*`. Returns false for any other path. */
async function routeAds(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: RouteContext,
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith(ADS_PREFIX)) return false;
  const method = (req.method ?? 'GET').toUpperCase();
  try {
    const identity = await ctx.brain.identity();
    if (path === ADS_ROUTES.capabilities) {
      if (method !== 'GET') throw methodNotAllowed();
      let caps: AdsCapabilities | null = null;
      try {
        caps = await (await adsFor(ctx, identity)).capabilities();
      } catch (err) {
        if (!(err instanceof AdsError)) throw err;
      }
      sendJson(res, 200, caps ?? NO_ADS);
      return true;
    }
    if (path.startsWith(ADS_CHANGE_PREFIX)) {
      const action = path.slice(ADS_CHANGE_PREFIX.length);
      if (!isAdsChange(action)) throw new HttpError(404, 'not-found', 'There is nothing at that address.');
      if (method !== 'POST') throw methodNotAllowed();
      const ads = await adsFor(ctx, identity);
      sendJson(res, 200, await adsChange(req, ctx, ads, identity, action));
      return true;
    }
    if (path === ADS_ROUTES.clearInflight) {
      if (method !== 'POST') throw methodNotAllowed();
      const ads = await adsFor(ctx, identity);
      const body = await readJson(req);
      if (
        !isRec(body) ||
        typeof body.client !== 'string' ||
        !ADS_CLIENT_SLUG.test(body.client) ||
        typeof body.id !== 'string' ||
        !ADS_PROPOSAL_ID.test(body.id)
      ) {
        throw new AdsError('bad-request');
      }
      await adsChanger(ads, identity);
      await ads.clearInflight(body.client, body.id);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (
      ![
        ADS_ROUTES.accounts,
        ADS_ROUTES.approvals,
        ADS_ROUTES.proposal,
        ADS_ROUTES.board,
        ADS_ROUTES.standupBrief,
        ADS_ROUTES.triage,
        ADS_ROUTES.file,
      ].includes(path as never)
    ) {
      throw new HttpError(404, 'not-found', 'There is nothing at that address.');
    }
    if (method !== 'GET') throw methodNotAllowed();
    const ads = await adsFor(ctx, identity);
    sendJson(res, 200, await adsRead(url, ctx, ads, path));
    return true;
  } catch (err) {
    if (!(err instanceof AdsError)) throw err;
    if (err.code === 'internal' || err.code === 'unknown-outcome') ctx.log(`Ad Manager: ${err.code}.`);
    sendAdsError(res, err.code, err.output);
    return true;
  }
}

async function route(req: IncomingMessage, res: ServerResponse, url: URL, ctx: RouteContext): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const path = url.pathname;

  if (await routeAds(req, res, url, ctx)) return;

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

  if (
    path === ROUTES.projects ||
    path === ROUTES.projectsChange ||
    path === ROUTES.projectsMove ||
    path === ROUTES.projectsArchive ||
    path === ROUTES.projectsDelete ||
    path === ROUTES.projectFiles ||
    path === ROUTES.projectTodos ||
    path === ROUTES.projectUpdates ||
    path === ROUTES.chatSummaryDraft ||
    path === ROUTES.projectUnsavedChats ||
    path === ROUTES.projectEmailDrafts ||
    path === ROUTES.projectActivity ||
    path === ROUTES.projectSeen ||
    path === ROUTES.projectArtifact ||
    path === ROUTES.projectMeetings ||
    path === ROUTES.projectBusiness ||
    path === ROUTES.homeMeetings ||
    path === ROUTES.projectsTidy
  ) {
    await projectsRoute(req, res, url, ctx);
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

  if (path === ROUTES.doneTodos) {
    if (method !== 'GET') throw methodNotAllowed();
    const identity = await safe(ctx.brain.identity(), UNKNOWN_IDENTITY);
    const body: DoneTodoList = await safe(
      ctx.brain.doneTodos?.(identity) ?? Promise.resolve(NO_DONE),
      NO_DONE,
    );
    sendJson(res, 200, body);
    return;
  }

  if (path === ROUTES.teamTodo) {
    if (method !== 'GET') throw methodNotAllowed();
    const id = url.searchParams.get('id');
    if (id === null || id.length > TODO_KEY_MAX || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(id)) {
      throw new HttpError(400, 'bad-request', 'That is not a task this app can open.');
    }
    const identity = await safe(ctx.brain.identity(), UNKNOWN_IDENTITY);
    const item = await safe(ctx.brain.teamTodo?.(id, identity) ?? Promise.resolve(null), null);
    if (item === null) {
      throw new HttpError(
        404,
        'not-found',
        'That task could not be found. It may have been finished or moved.',
      );
    }
    sendJson(res, 200, item);
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
      ctx.log('Reading a task history failed unexpectedly.');
      throw new HttpError(500, 'internal', "That task's history couldn't be read. Try again.");
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
        'Ticking tasks is switched off. Turn on changes to the shared brain in Settings first.',
      );
    }
    const id = isRec(body) ? body.id : undefined;
    if (typeof id !== 'string' || !id || id.length > 255 || /[\\/\0]/.test(id) || id.startsWith('.')) {
      throw new HttpError(400, 'bad-request', 'That task was not understood.');
    }
    const scope = isRec(body) ? body.scope : undefined;
    const expect = isRec(body) ? body.expect : undefined;
    if (
      (scope !== undefined && !isTodoScope(scope)) ||
      (expect !== undefined && typeof expect !== 'string')
    ) {
      throw new HttpError(400, 'bad-request', 'That task was not understood.');
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
        throw new HttpError(404, 'not-found', 'That task could not be found. It may already be done.');
      }
    }
    ctx.log('Ticked a task.');
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
      ctx.log('A task change failed unexpectedly.');
      throw new HttpError(500, 'internal', TODO_CHANGE_MESSAGES.internal);
    }
    ctx.log(`Changed a task (${action.kind}).`);
    const list = await todos(ctx);
    sendJson(res, 200, moved ? { ...list, moved } : list);
    return;
  }

  if (path === ROUTES.todoUpload) {
    if (method !== 'POST') throw methodNotAllowed();
    await uploadTodoFileRoute(req, res, ctx);
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
      case 'resend':
        if (!ctx.sessions.resend) throw new HttpError(404, 'not-found', 'That chat could not be found.');
        await ctx.sessions.resend(id);
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
