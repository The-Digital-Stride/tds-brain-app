/**
 * Projects R2 phase 2 (plan docs/plans/2026-11-23-projects-r2-updates-log.md): each project's updates log.
 * The brain script (`tdsapp-projects` 0.4), the server (server/brain/project-updates.ts, routes) and the
 * Updates tab build against this file. The on-disk layout is the one reserved in R1
 * (shared/projects-contract.ts, `ProjectUpdate`); this file adds the actions, the read shapes and limits.
 * The app never writes brain files itself: every entry is written or removed by the script.
 */

import type { ChatSummaryEntryInput, ChatUpdateFields } from './chat-summary-contract.ts';
import type { ProjectEmailEntryInput } from './project-email-contract.ts';
import type { ProjectKey, ProjectUpdate } from './projects-contract.ts';

// ─── Capability ──────────────────────────────────────────────────────────────────────────────────

/** The script answers `capabilities` with this once it has `update`, `update-remove` and auto entries (0.4). */
export const PROJECTS_UPDATES_CAPABILITY = 'projects-updates-v1';

// ─── Where entries live (R1 reservation, unchanged) ───────────────────────────────────────────────

/** Inside the project folder. Hidden from Documents/Images and protected from tdsapp-files since R1. */
export const UPDATES_DIR = 'updates';
/**
 * `<YYYY-MM-DD>-<HHmm>-<person>-<random6>.md`, UK local date and time of `at`; `person` is the writer's team
 * slug (`me` for a personal project with none); `random6` is 6 characters of [a-z0-9]. A clash (already
 * exists) is retried with a new suffix.
 */
export const UPDATE_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{6}\.md$/;

// ─── Limits ──────────────────────────────────────────────────────────────────────────────────────

/** Characters in an entry's summary (its markdown body), after trimming. Empty is refused. */
export const UPDATE_SUMMARY_MAX = 5_000;
/** Entries one read returns, newest first; `before` pages further back. */
export const UPDATES_PAGE = 50;

// ─── Kinds ───────────────────────────────────────────────────────────────────────────────────────

/** What a person (or Claude, through the skill) may add with the `update` action. `chat` (summaries of a chat, script 0.7) is added by the app's Save to project only: see ChatSummaryEntryInput. */
export type ManualUpdateKind = 'note' | 'call';
/** Written by the script itself on `edit` (decision 4): a status, health or Account Owner change. */
export type AutoUpdateKind = 'status' | 'owner';
/** Also read: `email` (phase 5), `chat` (chat summaries), and reserved `digest` (phase 6), `contract` (R3). Shown as written. */
export type UpdateKind = ProjectUpdate['kind'];

// ─── The actions (added to ProjectAction) ────────────────────────────────────────────────────────

/**
 * `{kind:'update', key, entry:{kind, summary, clientSafe}}`. Script 0.4. `by` and `at` are the script's
 * (this Mac's identity and clock), never the request's; a personal project with no team slug writes `by: me`.
 * Refused: archived project or a folder with no readable card (`not-allowed`: a card-less folder could be a
 * moved or archived project's leftover, and an entry there would turn it into a ghost project), `updates/`
 * being a link or not a folder (`not-allowed`), empty or over-long summary (`bad-request`), any other kind
 * (`bad-request`). Personal projects: allowed (personal/ never syncs).
 * Answers `{ok:true, action:'update', key, version, file}` where `version` is project.md's hash (unchanged)
 * and `file` the new entry's brain-relative path.
 */
export interface ProjectUpdateAction {
  kind: 'update';
  key: ProjectKey;
  entry:
    | { kind: ManualUpdateKind; summary: string; clientSafe: boolean }
    | ProjectEmailEntryInput
    | ChatSummaryEntryInput;
}

/**
 * `{kind:'update-remove', key, file, expect}` (overseer ruling a). Removes one `note` or `call` entry. Allowed
 * for its author (`by` = this Mac's identity), the brain's Owner or a scout; never for auto entries (`status`,
 * `owner`) or later kinds (`email`, `digest`, `contract`: their own phases decide). `file` is the entry's
 * brain-relative path and must be inside this project's `updates/`; `expect` is the entry file's SHA-256 (refused
 * with `changed` if it differs). No edit action: a wrong entry is removed and added again. Shared projects keep
 * the old entry in git history; personal ones don't (the app's confirm says so).
 * Answers `{ok:true, action:'update-remove', key, version}`.
 */
export interface ProjectUpdateRemoveAction {
  kind: 'update-remove';
  key: ProjectKey;
  file: string;
  expect: string;
}

/**
 * Auto entries on `edit` (decision 4). After the card is written, for each of these that changed, one entry:
 *   status  → kind 'status', summary `Status: <old> → <new>.` (words as the app shows them: Planned, Active,
 *             On hold, Done)
 *   health  → kind 'status', summary `Health: <old or "not set"> → <new or "not set">.` (On track, At risk, Off track: the app's words)
 *   owner   → kind 'owner',  summary `Account Owner: <old name or "nobody"> → <new name or "nobody">.`
 * One `edit` that changes several writes one entry per change, all client_safe false. A value sent back
 * unchanged writes nothing (older apps send every field on `edit`). Each auto entry also carries flat facts
 * beside the sentence, so later phases never parse wording:
 *   change: status | health | owner     from: <old value or empty>     to: <new value or empty>
 * (raw values: `on-hold`, `amber`, a team slug). A failure writing an auto entry never undoes the card change:
 * the reply adds `updatesFailed: true` and the app says the change was saved but the log entry wasn't.
 */
export const AUTO_UPDATE_FIELDS = ['status', 'health', 'owner'] as const;

// ─── Reading (server → app) ──────────────────────────────────────────────────────────────────────

/**
 * One entry as the app shows it. Unknown frontmatter keys are ignored; `kind` is plain text so a newer kind
 * never breaks an older app (shown by its name).
 */
export interface ProjectUpdateItem extends Omit<ProjectUpdate, 'kind'>, ChatUpdateFields {
  kind: string;
  /** Auto entries only: what changed, from and to (raw values). */
  change?: 'status' | 'health' | 'owner' | string;
  from?: string;
  to?: string;
  /** Email entries (phase 5): the key that makes one email one entry (shared/project-email-contract.ts). */
  emailKey?: string;
  /** Email entries, only when this Mac's identity is the entry's inbox owner: "Open in Gmail". */
  gmailUrl?: string;
  /** Email entries of one conversation in this project share this value (project-email-threads-contract.ts); absent when alone. */
  emailThread?: string;
  /** Brain-relative path of the entry file (its id). */
  path: string;
  /** SHA-256 of the entry file's bytes, sent back as `expect` on `update-remove`. */
  version: string;
  /** `by`'s display name from the team roster, else `by` as written. */
  byName: string;
  /**
   * True for an entry found in one of the project's old folders (a `moved_from` key's folder, or a leftover
   * at this key) — written by someone who hadn't synced the move or archive yet. Shown read-only, marked.
   */
  fromOldFolder?: true;
  /** Whether this person may remove it (`update-remove` rules above, capability present, project live). */
  canRemove: boolean;
}

/**
 * `GET ROUTES.projectUpdates?key=<ProjectKey>[&before=<path>]` → this. Lists the project's own `updates/` plus,
 * read-only, any in its `moved_from` folders and leftover folder at its key (overseer blocker 1). A `before`
 * that isn't one of the listed entries answers 400 `bad-request` (never silently page one).
 */
export interface ProjectUpdatesResponse {
  /** Newest first by `at` (ties: by file name, descending). At most UPDATES_PAGE. */
  updates: ProjectUpdateItem[];
  /** True when older entries exist beyond this page. */
  more: boolean;
  /** Entry files that couldn't be read (bad frontmatter, merge markers): counted, never shown. */
  unreadable: number;
  /** Whether this person can add entries here: the script has PROJECTS_UPDATES_CAPABILITY, the project is live with a card, and the person may change projects. */
  canAdd: boolean;
}

// ROUTES additions (shared/contract.ts): projectUpdates: '/api/projects/updates' (GET). Adding and removing go
// through the existing `POST ROUTES.projectsChange` with a ProjectUpdateAction or ProjectUpdateRemoveAction.
