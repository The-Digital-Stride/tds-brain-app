/**
 * My day (plan docs/plans/2026-11-28-time-my-day.md): the contract between the day engine, the Toolbox
 * connection, the app's routes and the My day screen. Types and constants only.
 *
 * Section 1 mirrors TDS Toolbox `apps/portal/lib/time/contract.ts` at commit 75ee320 (SUBMISSION_VERSION 1).
 * Change it only when Toolbox's contract changes, and keep the names identical.
 */

import type { ProjectKey } from './projects-contract.ts';

// ─── 1. Toolbox wire types (mirrored; do not edit without Toolbox) ─────────────────────────────────────

export const SUBMISSION_VERSION = 1;
export const MAX_ENTRIES_PER_DAY = 200;
export const MAX_CHANGES_PER_SUBMISSION = 2000;
export const MAX_DESCRIPTION_LENGTH = 1000;
export const MINUTES_PER_DAY = 1440;
/** Toolbox refuses a change time more than this many days before its clock. */
export const MAX_CHANGE_AGE_DAYS = 62;

export const ENTRY_SOURCES = ['cortex-chat', 'cortex-task', 'cortex-time', 'calendar', 'manual'] as const;
/** Cortex never creates this; it only resubmits entries Toolbox already holds with it. */
export const IMPORT_SOURCE = 'import-tracket';
export type EntrySource = (typeof ENTRY_SOURCES)[number] | typeof IMPORT_SOURCE;

export const CERTAINTIES = ['certain', 'strong', 'suggested', 'manual', 'unassigned'] as const;
export type Certainty = (typeof CERTAINTIES)[number];

export const LOGGED_FIELDS = ['description', 'workItemId', 'startAt', 'minutes', 'billable'] as const;
export type LoggedField = (typeof LOGGED_FIELDS)[number];

export interface EntryInput {
  /** Lower-case UUID, stable for the life of the entry. */
  id: string;
  /** ISO 8601 with offset, whose Europe/London date is the day; or null (time with no clock time). */
  startAt: string | null;
  /** Whole minutes, 1–1440. */
  minutes: number;
  workItemId: string | null;
  description: string;
  billable: boolean;
  source: EntrySource;
  certainty: Certainty;
}

export interface LocalChange {
  entryId: string;
  /** ISO 8601 instant, the Mac's clock. */
  at: string;
  action: 'create' | 'update' | 'delete';
  /** Set for `update`, null otherwise. */
  field: LoggedField | null;
  /**
   * Only `update` carries values, encoded as Toolbox stores them: minutes as digits, startAt as
   * `toISOString()`, billable `true`/`false`, workItemId as the id, description trimmed. Null = no value.
   */
  oldValue: string | null;
  newValue: string | null;
  /** Private detail removed: both values null. */
  redacted: boolean;
}

export interface DaySubmission {
  version: typeof SUBMISSION_VERSION;
  submissionId: string;
  /** YYYY-MM-DD, Europe/London. */
  workDate: string;
  /** 0 for a day never confirmed. */
  baseRevision: number;
  entries: EntryInput[];
  /** Only when `baseRevision` is 0; otherwise always []. */
  changes: LocalChange[];
}

export type DayErrorCode = 'invalid' | 'forbidden' | 'conflict' | 'locked';
export interface DayProblem {
  /** Dotted path, e.g. `entries[2].minutes`. */
  path: string;
  message: string;
}
export type DayResult =
  | { ok: true; revision: number; repeated: boolean }
  | { ok: false; code: DayErrorCode; problems: DayProblem[] };

export interface StoredEntry extends EntryInput {
  personId: string;
  workDate: string;
  deleted: boolean;
}
export interface StoredDay {
  personId: string;
  workDate: string;
  revision: number;
  entries: StoredEntry[];
}

/** `GET /api/time/work-items` → `{ items: WireWorkItem[] }` (active only, A to Z). */
export interface WireWorkItem {
  id: string;
  name: string;
  kind: 'retainer' | 'project' | 'internal';
  /** Cortex key `client/project`, or null. */
  cortexKey: string | null;
  clientId: string | null;
}

/** `POST /api/time/token` 200. */
export interface TokenAnswer {
  token: string;
  tokenType: 'Bearer';
  expiresAt: string;
  connectionId: string;
}

/** Toolbox `{ error }` codes Cortex handles. Anything else is treated as `server_error`. */
export type ToolboxErrorCode =
  | 'invalid_request'
  | 'invalid_grant'
  | 'access_denied'
  | 'too_many_connections'
  | 'too_large'
  | 'rate_limited'
  | 'unauthorised'
  | 'forbidden'
  | 'not_found'
  | 'server_error';

// ─── 2. Timing rules (decision 7; phase 4 calibrates these) ────────────────────────────────────────────

export const CHAT_TIME = {
  /** Counted before each prompt (reading and writing it). */
  leadMinutes: 2,
  /** Counted after the last answer line before the next prompt (reading the answer). */
  tailMinutes: 2,
  /**
   * A prompt's interval ends at min(last answer + tailMinutes, prompt + maxRunMinutes), so a long
   * Claude run while the person is away is not their time (overseer B1). The full run stays in claudeMinutes.
   */
  maxRunMinutes: 10,
  /** Intervals of one chat closer than this merge into one block. */
  mergeGapMinutes: 10,
  /** Blocks shorter than this, after rounding, are dropped. */
  minBlockMinutes: 1,
  /** Transcript files larger than this are skipped and noted. Read streamed; marks cached by size + mtime. */
  maxTranscriptBytes: 500 * 1024 * 1024,
} as const;

/**
 * What the transcript reader keeps from one jsonl line. Never text, titles, paths or tool detail.
 * Only top-level `<id>.jsonl` files are read (subagent files under `<id>/subagents/` are not). A `prompt` is a
 * `user` line that is a person's turn: not a tool result, not `isMeta`, not a compaction summary, not a
 * sidechain, and not machine-made (`promptSource` other than a person's, e.g. `system` task notifications;
 * `turnOrigin` likewise). The builder pins the exact values against fixtures shaped like real lines.
 */
export interface TranscriptMark {
  /** ISO 8601 instant from the line's `timestamp`. */
  at: string;
  /** `prompt` = a person's turn; `answer` = an assistant line. */
  kind: 'prompt' | 'answer';
}

/** One chat's marks for the days asked about. */
export interface ChatMarks {
  /** The sdkSessionId. Stays on this Mac. */
  chatId: string;
  marks: TranscriptMark[];
}

/** A chat's place, as `chat-places.json` holds it (shared/chat-places-contract.ts). */
export interface ChatPlace {
  client: string | null;
  project: ProjectKey | null;
}

/** Input to `chatBlocks`: personal chats ARE included, so overlaps resolve fairly; their blocks are then dropped. */
export interface ChatInput extends ChatMarks {
  place: ChatPlace | null;
  /** A personal chat, or one whose project is a personal project. */
  personal: boolean;
}

/**
 * One block of chat time on one London day (output of `chatBlocks`). Order of work: per-prompt intervals,
 * merge within a chat, resolve overlaps per whole minute (latest prompt wins; ties go to a chat with a
 * place, then the lower chatId), re-form blocks, split at London midnight, drop personal and short blocks.
 */
export interface ChatBlock {
  chatId: string;
  /** Informational only. `mergeCapture` matches by chatId + interval overlap, never by this key (overseer B2). */
  captureKey: string;
  workDate: string;
  /** ISO 8601 instant (UTC), whole minute. */
  startAt: string;
  /** ISO 8601 instant (UTC), whole minute; startAt + minutes. */
  endAt: string;
  minutes: number;
  /** Claude's own run time inside the block, in minutes: evidence, not time. */
  claudeMinutes: number;
  prompts: number;
}

/** `chatBlocks(inputs, workDate)`: pure; Builder B. */
export type ChatBlocksFn = (inputs: readonly ChatInput[], workDate: string) => ChatBlock[];

// ─── 3. The local day draft (decision 9), `<dataDir>/time/days/<date>.json`, 0600 ──────────────────────

export const TIME_DIR = 'time';
export const TIME_DAYS_DIR = 'time/days';
export const TIME_LINKS_FILE = 'time/links.json';
export const TIME_CONNECTION_FILE = 'time/connection.json';
/** The last work item list from Toolbox (0600), for names when offline and the closed-item rule. */
export const TIME_WORK_ITEMS_FILE = 'time/work-items.json';
export const KEYCHAIN_SERVICE = 'TDS Cortex: Toolbox time';

/** The values Toolbox gets for an entry. */
export interface EntryValues {
  startAt: string | null;
  minutes: number;
  workItemId: string | null;
  description: string;
  billable: boolean;
}

export interface DraftEntry {
  id: string;
  source: EntrySource;
  certainty: Certainty;
  /** The values now (captured, then edited). */
  values: EntryValues;
  /**
   * What capture last proposed, kept beside the person's values. Null for a manual or Toolbox entry.
   * `startAt`/`endAt` are the captured interval `mergeCapture` matches on. Once the entry is touched
   * (edited or deleted) the interval is frozen and new blocks of the same chat are cut around it.
   */
  captured:
    | (EntryValues & {
        chatId: string;
        captureKey: string;
        endAt: string;
        claudeMinutes: number;
        prompts: number;
      })
    | null;
  /** Fields the person has changed; capture never overwrites these. */
  edited: LoggedField[];
  /** The block's place, for assignment and "Remember for". */
  place: ChatPlace | null;
  /** A captured block that capture no longer finds (kept and flagged, never removed silently). */
  missing: boolean;
  /** Came from Toolbox's stored day (another Mac, the import, or a conflict merge). */
  fromToolbox: boolean;
  /**
   * The values as Toolbox last accepted them (per-entry snapshot), or null if never confirmed. Drives
   * "changed since confirmed", the conflict merge and the closed-item rule (overseer B4).
   */
  confirmed: EntryValues | null;
  /** Removed by the person. Kept in the draft so the change log and Toolbox stay right; not sent. */
  deleted: boolean;
}

export type DayStatus = 'not-confirmed' | 'confirmed' | 'changed' | 'not-sent' | 'conflict';

export interface DayDraft {
  version: 1;
  workDate: string;
  entries: DraftEntry[];
  /** Changes since the day was made; sent only while `revision` is 0. */
  changes: LocalChange[];
  /** Toolbox's revision of this day as last confirmed or read: 0 = never confirmed. */
  revision: number;
  /**
   * The exact submission last attempted and not yet answered (overseer B3). While set, Confirm resends this
   * body unchanged first; edits made since show as "changed". Problems map `entries[i]` through this body.
   */
  pending: { submissionId: string; body: DaySubmission } | null;
  /** When the stored day was last read from Toolbox, or null. */
  storedReadAt: string | null;
  status: DayStatus;
  /** Problems from the last refused confirm, by entry id ('' = the day). */
  problems: Array<{ entryId: string; message: string }>;
  updatedAt: string;
}

/** `<dataDir>/time/links.json`: which Toolbox work item a project or client is. */
export interface TimeLinksFile {
  version: 1;
  projects: Record<ProjectKey, string>;
  clients: Record<string, string>;
}

/** `<dataDir>/time/connection.json`. Never the token (that is in the Keychain). */
export interface ConnectionFile {
  version: 1;
  origin: string;
  connectionId: string;
  expiresAt: string;
  connectedAt: string;
}

// ─── 4. The app's own routes (decision 14) ─────────────────────────────────────────────────────────────

export const TIME_ROUTES = {
  status: '/api/time/status',
  connect: '/api/time/connect',
  disconnect: '/api/time/disconnect',
  workItems: '/api/time/work-items',
  day: (date: string) => `/api/time/day/${date}`,
  refresh: (date: string) => `/api/time/day/${date}/refresh`,
  entries: (date: string) => `/api/time/day/${date}/entries`,
  entry: (date: string, id: string) => `/api/time/day/${date}/entries/${id}`,
  confirm: (date: string) => `/api/time/day/${date}/confirm`,
} as const;

/** The public loopback path Toolbox redirects to (decision 4). Not under /api. */
export const TOOLBOX_CALLBACK_PATH = '/toolbox-callback';

export type ConnectionState =
  | { state: 'no-address' }
  | { state: 'not-connected'; origin: string; pending: boolean }
  | { state: 'connected'; origin: string; expiresAt: string; reconnectSoon: boolean }
  | { state: 'lost'; origin: string; reason: 'expired' | 'revoked' | 'refused' };

/** `GET status`. */
export interface TimeStatus {
  connection: ConnectionState;
  /** Earliest day the screen offers (today minus 62 days), YYYY-MM-DD. */
  earliest: string;
  today: string;
}

/** `POST connect` → the URL Cortex has opened (also shown as a link if the browser didn't open). */
export interface ConnectAnswer {
  url: string;
}

/** Work item as the screen shows it. */
export interface WorkItemOption extends WireWorkItem {}

/** `GET work-items`. `items` is empty when not connected. */
export interface WorkItemsAnswer {
  items: WorkItemOption[];
  fetchedAt: string | null;
}

/** An entry as the screen shows it. */
export interface DayEntryView {
  id: string;
  source: EntrySource;
  certainty: Certainty;
  values: EntryValues;
  /** End time, when startAt is set. */
  endAt: string | null;
  edited: LoggedField[];
  /** "Cortex chat: <project title or client name>", never the chat's title. */
  evidence: string | null;
  claudeMinutes: number | null;
  missing: boolean;
  fromToolbox: boolean;
  /** Place label for "Remember for …", or null. */
  placeLabel: string | null;
  /** The work item is not in Toolbox's active list. */
  workItemClosed: boolean;
  problems: string[];
}

/** `GET day/:date`, and the answer to every change on the day. */
export interface DayView {
  workDate: string;
  status: DayStatus;
  revision: number;
  entries: DayEntryView[];
  totalMinutes: number;
  totals: Array<{ workItemId: string | null; minutes: number; billableMinutes: number }>;
  /** Gaps over 15 minutes between the first and last entry. */
  gaps: Array<{ startAt: string; minutes: number }>;
  dayProblems: string[];
  /** Why Confirm is disabled, or null when it can be pressed. */
  confirmBlocked: string | null;
  /** Notes from capture, e.g. a transcript too large to read, or "No chat history is kept this far back". */
  captureNotes: string[];
  /** "This removes private detail" / "Remove as private" are offered only while revision is 0 (overseer B5). */
  privateAllowed: boolean;
}

/** `POST day/:date/entries`. */
export interface AddEntryRequest {
  values: EntryValues;
}

/** `PATCH day/:date/entries/:id`: only the fields given change. */
export interface EntryPatchRequest {
  description?: string;
  workItemId?: string | null;
  startAt?: string | null;
  minutes?: number;
  billable?: boolean;
  /** This description edit removes private detail. */
  privateEdit?: boolean;
  /** Save the work item as the link for this entry's project (or client). Default true when there is a place. */
  remember?: boolean;
}

/** `DELETE day/:date/entries/:id?private=1`. */
export interface EntryDeleteQuery {
  private?: boolean;
}

/** `POST day/:date/confirm`. */
export type ConfirmAnswer =
  | { outcome: 'confirmed'; day: DayView; repeated: boolean }
  | { outcome: 'conflict'; day: DayView; stored: StoredDay }
  | { outcome: 'invalid' | 'locked' | 'forbidden'; day: DayView }
  | { outcome: 'not-connected' | 'not-sent'; day: DayView; message: string };

// ─── 5. The server facade (Builder C wires routes to this) ─────────────────────────────────────────────

/**
 * The loopback callback's result. `server/http/server.ts` turns it into a page with the existing
 * `plainPage`/`sendHtml` helpers. `state` = wrong or missing state (pending connect left alone).
 */
export type CallbackOutcome =
  | { ok: true }
  | { ok: false; reason: 'state' | 'expired' | 'denied' | 'exchange' | 'too-many' | 'storage' };

export interface TimeService {
  status(): Promise<TimeStatus>;
  connect(): Promise<ConnectAnswer>;
  disconnect(): Promise<TimeStatus>;
  /** Public loopback callback (decision 4). */
  callback(query: URLSearchParams): Promise<CallbackOutcome>;
  workItems(refresh: boolean): Promise<WorkItemsAnswer>;
  day(workDate: string): Promise<DayView>;
  refresh(workDate: string): Promise<DayView>;
  addEntry(workDate: string, req: AddEntryRequest): Promise<DayView>;
  changeEntry(workDate: string, id: string, req: EntryPatchRequest): Promise<DayView>;
  deleteEntry(workDate: string, id: string, opts: EntryDeleteQuery): Promise<DayView>;
  confirm(workDate: string): Promise<ConfirmAnswer>;
}

/** Thrown by TimeService for a bad request (400), unknown entry (404) or a day out of range (400). */
export interface TimeServiceError {
  code: 'bad-request' | 'not-found';
  message: string;
}

// ─── 6. Internal seams (Builder A ↔ Builder B; overseer 4e) ────────────────────────────────────────────

/** Outcome of a Toolbox call. Only `unauthorised` (401) clears the connection (overseer: SHOULD). */
export type ToolboxCall<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      kind: 'unauthorised' | 'off' | 'forbidden' | 'rate-limited' | 'server' | 'network' | 'too-large';
    }
  | { ok: false; kind: 'error'; code: ToolboxErrorCode; status: number };

/**
 * Builder A. Server-side only; the token never leaves it. Every call: `redirect: 'error'`, 10 s timeout,
 * 2 MB answer cap, `Authorization: Bearer`, no cookies. `submitDay` reads both `{ok:false}` and `{error}`.
 */
export interface ToolboxClient {
  exchange(origin: string, code: string, codeVerifier: string): Promise<ToolboxCall<TokenAnswer>>;
  revoke(): Promise<ToolboxCall<void>>;
  workItems(): Promise<ToolboxCall<WireWorkItem[]>>;
  readDay(workDate: string): Promise<ToolboxCall<StoredDay>>;
  /** `DayResult` covers 200/400/403/409/423 answers in the `{ok}` shape. */
  submitDay(body: DaySubmission): Promise<ToolboxCall<DayResult>>;
}

/**
 * Builder A. macOS Keychain via `security -i` (command on stdin, never argv); token checked against
 * `^tds_time_[0-9a-f]{64}$`, every value quoted, `-U`, read back and compared, 5 s timeout, cached in memory.
 * No file fallback: a failed save revokes the new token and fails the connect.
 */
export interface TokenStore {
  read(origin: string): Promise<string | null>;
  save(origin: string, token: string): Promise<void>;
  remove(origin: string): Promise<void>;
}

/**
 * Builder B, pure. The submission for the draft as it stands: live (not deleted) entries, `changes` only
 * when `draft.revision` is 0 and with changes older than 60 days dropped, collapsed to fit
 * MAX_CHANGES_PER_SUBMISSION and 900 KB. If `draft.pending` is set, returns that body unchanged.
 */
export type BuildSubmissionFn = (draft: DayDraft, newSubmissionId: () => string, now: Date) => DaySubmission;

/**
 * Builder B, pure. The draft after Toolbox answered `body`. `stored` is the day read after a conflict.
 * ok → revision set, per-entry `confirmed` snapshots, changes cleared, pending cleared, status
 * confirmed (or changed, if edited since `body`). conflict → union by id with `stored` (decision 11). invalid /
 * locked / forbidden → problems mapped through `body`, pending cleared. Network/server → pending kept, not-sent.
 */
export type ApplyResultFn = (
  draft: DayDraft,
  body: DaySubmission,
  result: ToolboxCall<DayResult>,
  stored: StoredDay | null,
  now: Date,
) => DayDraft;
