/**
 * The contract every part of the TDS Brain App builds against.
 *
 * Types only, plus a few constants. Server and client both import from here and
 * from nowhere else in each other's folders.
 *
 * House rule for this repo: relative imports carry their real extension
 * (`./contract.ts`), and only erasable TypeScript syntax is used (no enums, no
 * parameter properties, no namespaces), because the server runs straight from
 * source with Node's built-in type stripping.
 */

export const DEFAULT_PORT = 3877;
/** The app is served on this host only. `localhost` is refused: cookies do not carry between the two names. */
export const APP_HOST = '127.0.0.1';
export const SESSION_COOKIE = 'tba_session';
export const APP_NAME = 'TDS Brain';
export const MAX_LIVE_SESSIONS = 4;

// ---------------------------------------------------------------------------
// Who is using this copy of the brain
// ---------------------------------------------------------------------------

/**
 * Brain roles, folded to four. Map `head-scout` and `agency` to `scout`; a missing or
 * unrecognised role to `unknown`.
 */
export type Role = 'owner' | 'scout' | 'team' | 'unknown';

export interface Identity {
  /** Display name, e.g. "Ian Hancock". */
  name: string;
  /** The slugified `name` from roles.json, e.g. "ian-hancock". Never the roles.json `slug` field. */
  slug: string;
  email: string | null;
  role: Role;
  /** False when the person could not be matched to `.team-config/roles.json`. */
  knownMember: boolean;
}

// ---------------------------------------------------------------------------
// What the brain folder holds (read fresh from disk, never cached in the app's own files)
// ---------------------------------------------------------------------------

export type SkillKind = 'skill' | 'command';

export interface SkillInfo {
  /** Folder or file name. Run it by sending `/${name}` as the prompt. */
  name: string;
  /** Humanised name for menus, e.g. "Meeting notes". */
  title: string;
  /** From frontmatter (skills) or the first heading/paragraph (commands). '' when there is none. */
  description: string;
  kind: SkillKind;
  maturity: 'draft' | 'live' | 'trusted' | null;
  argumentHint: string | null;
  /** From the `roles:` frontmatter line. null means everyone may run it. */
  restrictedTo: Role[] | null;
}

export interface TodoItem {
  /** The file name inside `todo/`, e.g. "20260702-renew-contract.md". Also the id used in the API. */
  id: string;
  title: string;
  /** Slugified person name, or null when the to-do is open to anyone. */
  assignee: string | null;
  /** YYYY-MM-DD from frontmatter `due`, else null. */
  due: string | null;
  /** YYYY-MM-DD from the file name's date prefix, else null. */
  surfaceDate: string | null;
  project: string | null;
  client: string | null;
}

export interface TodoList {
  /** Assigned to the current person, soonest first. */
  mine: TodoItem[];
  /** No assignee: anyone can pick these up. */
  open: TodoItem[];
  /** How many belong to other people (not listed). */
  othersCount: number;
}

export interface ClientInfo {
  /** Folder name under `clients/`, e.g. "urban-cooling". */
  slug: string;
  name: string;
}

export interface UsedSkill {
  name: string;
  count: number;
  /** ISO timestamp of the most recent use. */
  lastUsed: string;
}

export type BrainArea = 'skills' | 'todos' | 'clients' | 'identity' | 'usage';

export interface BrainHealth {
  ok: boolean;
  path: string;
  /** Plain UK-English sentences fit to show the user. Empty when ok. */
  problems: string[];
}

/**
 * Everything the app reads from the brain folder, plus its ONE direct write.
 * Implemented in `server/brain/index.ts` as `createBrainReaders(root: string): BrainReaders`.
 * Nothing here may import or execute brain code in-process; brain tools are run as
 * child processes (e.g. `node tools/whoami.cjs --json`) or their files are parsed.
 * No method throws for a missing or malformed brain file; it degrades (empty list, role `unknown`).
 */
export interface BrainReaders {
  readonly root: string;
  health(): Promise<BrainHealth>;
  identity(): Promise<Identity>;
  /**
   * Only the skills and commands this person may run: hidden when `roles:` excludes them or
   * `user-invocable: false`. (`members:` is a vendor packaging flag and is NOT a hide signal.)
   * An `unknown` role is treated as `team` here. A skill beats a command of the same name.
   */
  skills(identity: Identity): Promise<SkillInfo[]>;
  /**
   * The role rule for one name, checked against ALL skills, including hidden ones.
   * 'allowed' | 'restricted' (a `roles:` line excludes this person) | 'unknown-skill'.
   * The server uses it to refuse a typed `/name`, because the brain's own role hook does not
   * fire for a typed slash command.
   */
  skillAccess(identity: Identity, name: string): Promise<'allowed' | 'restricted' | 'unknown-skill'>;
  /** Files in `todo/` only (not `done/`, `archive/`, `AGENTS.md`, `README.md`). */
  todos(identity: Identity): Promise<TodoList>;
  /** The one direct write: moves `todo/<id>` to `todo/done/<id>`, as the Workbench does. Rejects unknown ids. */
  completeTodo(id: string): Promise<void>;
  /** Folders in `clients/`, skipping names that start with `_` or `.`. */
  clients(): Promise<ClientInfo[]>;
  /**
   * From `z-logs/team-usage/<slug>.jsonl`. Counts three line shapes: `{event:"skill",name}`,
   * `{event:"command",name:"/x"}` (strip the slash) and `{skill, ts}` with no event. Keeps only
   * names that `skills(identity)` lists. Defaults: 30 days, top 6.
   */
  usedOften(identity: Identity, opts?: { days?: number; limit?: number }): Promise<UsedSkill[]>;
  /** Calls back (debounced) when an area changes on disk. Returns a function that stops watching. */
  watch(onChange: (area: BrainArea) => void): () => void;
}

// ---------------------------------------------------------------------------
// The app's own notes (kept in the app's data folder, never in the brain)
// ---------------------------------------------------------------------------

export interface AppPrefs {
  /** Skill names, in the order the person pinned them. */
  pins: string[];
  lastClient: string | null;
  todoPanelOpen: boolean;
  /**
   * Off by default while the app is in testing. When off, the app makes NO direct write to the
   * brain: `POST /api/todos/complete` is refused with `not-allowed`, and the page shows to-dos
   * without tick boxes. (Claude can still change brain files in a chat, with approval, exactly
   * as it can in the terminal.)
   */
  directWrites: boolean;
}

export const DEFAULT_PREFS: AppPrefs = {
  pins: [],
  lastClient: null,
  todoPanelOpen: true,
  directWrites: false,
};

/** Implemented in `server/store/app-store.ts` as `createAppStore(dataDir: string): AppStore`. */
export interface AppStore {
  get(): Promise<AppPrefs>;
  update(patch: Partial<AppPrefs>): Promise<AppPrefs>;
}

// ---------------------------------------------------------------------------
// The engine (Claude Code) and chat sessions
// ---------------------------------------------------------------------------

/**
 * How chats ask for approval. Taken from the person's own Claude Code settings, so the app behaves
 * like their terminal: 'default' asks before changes and commands; 'acceptEdits' lets file changes
 * through; 'auto' lets Claude Code's own safety check approve low-risk steps and asks about the
 * rest. The app never runs with approvals switched off.
 */
export type AppPermissionMode = 'default' | 'acceptEdits' | 'auto';

export interface EngineHealth {
  ok: boolean;
  /** The mode the next chat will start in. Read afresh for each new chat. */
  permissionMode: AppPermissionMode;
  /** Where the installed `claude` command was found, or null. */
  claudePath: string | null;
  /** A plain sentence when not ok, e.g. "Claude Code is not installed on this computer." */
  problem: string | null;
}

export type SessionState =
  | 'starting' // process launching
  | 'working' // Claude is thinking or using tools
  | 'waiting' // a question or approval is waiting on the person
  | 'idle' // ready for a message (turn finished, or a reopened chat not yet continued)
  | 'error'
  | 'closed';

export interface LiveSession {
  /** App-local id, stable for the life of the server process. */
  id: string;
  /**
   * Claude Code's own session id. Set at once for a reopened chat; otherwise known a moment
   * after the engine starts. The person can carry on in a terminal with `claude --resume <id>`.
   */
  sdkSessionId: string | null;
  title: string;
  /** Fixed when the chat is created; it cannot change mid-chat. */
  client: string | null;
  state: SessionState;
  startedAt: string;
  lastActivityAt: string;
}

export interface PastSession {
  sdkSessionId: string;
  title: string;
  lastModified: string;
}

export interface SessionList {
  live: LiveSession[];
  /** Claude Code's own history for the brain folder, newest first, minus any that are live now. */
  past: PastSession[];
}

export interface AskOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  options: AskOption[];
  multiSelect: boolean;
}

/**
 * One thing that happened in a chat, in the order it happened.
 *
 * Rendering rule (security): ONLY `assistant-message` / `assistant-delta` text is rendered as
 * markdown, and only after sanitising. Every other string in every event is shown as plain text.
 *
 * `parentToolUseId` is null for the main conversation. When set, the text or tool belongs to a
 * helper agent started by that tool call; show it nested under that tool, not as a reply.
 */
export type ChatEvent =
  | { type: 'state'; state: SessionState; detail?: string }
  | { type: 'session-info'; sdkSessionId: string; model: string | null; claudeVersion: string | null }
  | { type: 'user-message'; messageId: string; text: string }
  /** A piece of a reply as it is typed. Append to the block with this id. One id per text block. */
  | { type: 'assistant-delta'; messageId: string; text: string; parentToolUseId: string | null }
  /** The finished text for that block. Replaces whatever the deltas built. Also used to replay history. */
  | { type: 'assistant-message'; messageId: string; text: string; parentToolUseId: string | null }
  | { type: 'tool-start'; toolUseId: string; tool: string; label: string; parentToolUseId: string | null }
  | { type: 'tool-end'; toolUseId: string; ok: boolean }
  | {
      type: 'permission-request';
      requestId: string;
      tool: string;
      /** Plain sentence, e.g. "Claude wants to save a file". */
      title: string;
      /**
       * The specifics: a path, a command, a URL. Shown in full in a scrolling code-style block.
       * A file inside the brain folder is given relative to it. Never silently shortened: if the
       * server had to shorten it, `warning` says so.
       */
      detail: string;
      /**
       * A plain caution the card shows above the buttons, or null. Used when the file is outside
       * the brain folder, and when the detail was too long to show in full.
       */
      warning: string | null;
      /**
       * What "Allow for this chat" would cover, as one full plain sentence shown beside the button,
       * e.g. "For the rest of this chat, Claude won't ask before running `node tools/x` commands."
       * null when the engine offers nothing safe to remember: then only Allow and Don't are shown.
       */
      sessionAllowLabel: string | null;
    }
  | { type: 'question-request'; requestId: string; questions: AskQuestion[] }
  | { type: 'request-resolved'; requestId: string; outcome: 'allowed' | 'denied' | 'answered' | 'cancelled' }
  | {
      type: 'turn-end';
      ok: boolean;
      interrupted: boolean;
      durationMs: number | null;
      errorText: string | null;
    }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; text: string };

export interface SequencedEvent {
  /** Starts at 1 and rises by one per event within a session. Used to replay after a reconnect. */
  seq: number;
  at: string;
  event: ChatEvent;
}

/** App-wide happenings, not tied to one chat. */
export type AppEvent =
  | { type: 'hello'; serverStartedAt: string }
  | { type: 'brain-changed'; area: BrainArea }
  /** A chat was created, closed or changed state. Re-fetch `GET /api/sessions`. */
  | { type: 'sessions-changed' };

/**
 * A tab holds ONE Server-Sent Events connection (browsers allow about six per site, across tabs).
 * It carries app-wide events and, when `session` is given, that chat's events.
 */
export type StreamFrame =
  | { kind: 'app'; event: AppEvent }
  | { kind: 'chat'; sessionId: string; item: SequencedEvent };

// ---------------------------------------------------------------------------
// HTTP API. JSON in, JSON out. Every route needs the session cookie.
// ---------------------------------------------------------------------------

export interface Bootstrap {
  appVersion: string;
  identity: Identity;
  brain: BrainHealth;
  engine: EngineHealth;
  skills: SkillInfo[];
  clients: ClientInfo[];
  usedOften: UsedSkill[];
  prefs: AppPrefs;
}

/**
 * Starts a chat. Give `prompt`, `resume`, or both.
 * - `prompt` only: a new chat; the engine starts at once.
 * - `resume` only: reopens a past chat. The server replays its earlier messages as
 *   `user-message` / `assistant-message` events and leaves it `idle`; the engine starts on the
 *   first message. `resume` must be in the brain's own session list and not already live
 *   (else `not-found` / `already-open`).
 * - `client` must be a slug from `Bootstrap.clients` (else `bad-request`). Ignored on resume.
 * - A prompt that begins `/name` for a role-restricted skill is refused with `not-allowed`.
 */
export interface StartSessionRequest {
  prompt?: string;
  client?: string | null;
  resume?: string | null;
}

export interface StartSessionResponse {
  session: LiveSession;
}

/** Refused with `busy` while a turn is running, `session-closed` after close, `not-allowed` as above. */
export interface SendMessageRequest {
  text: string;
}

export type PermissionDecision = 'allow' | 'allow-session' | 'deny';

export interface PermissionReply {
  requestId: string;
  decision: PermissionDecision;
  /** Optional words from the person, passed to Claude when they say no. */
  note?: string;
}

export interface QuestionReply {
  requestId: string;
  /**
   * Keyed by the question text. The chosen option label, an array of labels when the question
   * allows several, or the person's own typed words for that question.
   */
  answers: Record<string, string | string[]>;
  /**
   * Set when the person replied to the whole set in their own words instead of answering each
   * question. Sent to the engine as the SDK's `response` field.
   */
  freeText?: string;
}

export interface CompleteTodoRequest {
  id: string;
}

export interface OkResponse {
  ok: true;
}

export type ApiErrorCode =
  | 'bad-request'
  | 'unauthorised' // no or wrong session cookie
  | 'forbidden' // wrong Host or Origin
  | 'not-found'
  | 'not-allowed' // the person's role may not run that skill
  | 'busy' // a turn is already running in that chat
  | 'session-closed'
  | 'too-many-chats' // MAX_LIVE_SESSIONS are all busy
  | 'already-open' // that past chat is already live
  | 'engine-missing' // Claude Code is not installed or not signed in
  | 'brain-missing'
  | 'internal';

export interface ApiError {
  error: {
    code: ApiErrorCode;
    /** A plain UK-English sentence fit to show the user. */
    message: string;
  };
}

/**
 * Route table (the single source of truth for paths):
 *
 *   GET  /auth?code=…                           swaps a one-time code for the cookie, redirects to /
 *   GET  /auth/code?nonce=…&proof=…             launcher only: returns a one-time code
 *   GET  /auth/ping?nonce=…                     launcher only: proves this is the app
 *   GET  /api/bootstrap                         → Bootstrap
 *   GET  /api/todos                             → TodoList
 *   POST /api/todos/complete   CompleteTodoRequest → TodoList
 *   PUT  /api/prefs            Partial<AppPrefs>   → AppPrefs
 *   GET  /api/sessions                          → SessionList
 *   POST /api/sessions         StartSessionRequest → StartSessionResponse
 *   POST /api/sessions/:id/messages   SendMessageRequest → OkResponse
 *   POST /api/sessions/:id/permission PermissionReply    → OkResponse
 *   POST /api/sessions/:id/answer     QuestionReply      → OkResponse
 *   POST /api/sessions/:id/interrupt  {}                 → OkResponse
 *   POST /api/sessions/:id/close      {}                 → OkResponse
 *   GET  /api/stream?session=<id>&after=<seq>   Server-Sent Events. Each `data:` is a StreamFrame.
 *                                               `session` and `after` are optional. With `session`,
 *                                               the chat's events with seq > after are sent first
 *                                               (default after=0: the whole chat), then live ones.
 *
 * Every POST and PUT sends `Content-Type: application/json` and a JSON body; routes with nothing
 * to say send `{}`. Any failure returns ApiError with a fitting HTTP status.
 */
export const ROUTES = {
  /** `GET /auth?code=<one-time code>`: swaps a single-use, 60-second code for the session cookie. */
  auth: '/auth',
  /** Launcher only (never a browser): proves it knows the secret and gets a one-time code back. */
  authCode: '/auth/code',
  bootstrap: '/api/bootstrap',
  todos: '/api/todos',
  completeTodo: '/api/todos/complete',
  prefs: '/api/prefs',
  sessions: '/api/sessions',
  sessionMessages: (id: string) => `/api/sessions/${encodeURIComponent(id)}/messages`,
  sessionPermission: (id: string) => `/api/sessions/${encodeURIComponent(id)}/permission`,
  sessionAnswer: (id: string) => `/api/sessions/${encodeURIComponent(id)}/answer`,
  sessionInterrupt: (id: string) => `/api/sessions/${encodeURIComponent(id)}/interrupt`,
  sessionClose: (id: string) => `/api/sessions/${encodeURIComponent(id)}/close`,
  stream: (sessionId?: string | null, after = 0) =>
    sessionId ? `/api/stream?session=${encodeURIComponent(sessionId)}&after=${after}` : '/api/stream',
} as const;
