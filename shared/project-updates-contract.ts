/**
 * Projects R2 phase 2 (plan docs/plans/2026-11-23-projects-r2-updates-log.md): each project's updates log.
 * The brain script (`tdsapp-projects` 0.4), the server (server/brain/project-updates.ts, routes) and the
 * Updates tab build against this file. The on-disk layout is the one reserved in R1
 * (shared/projects-contract.ts, `ProjectUpdate`); this file adds the action, the read shapes and limits.
 * The app never writes brain files itself: every entry is written by the script.
 */

import type { ProjectKey, ProjectUpdate } from './projects-contract.ts';

// ─── Capability ──────────────────────────────────────────────────────────────────────────────────

/** The script answers `capabilities` with this once it has the `update` action and auto entries (0.4). */
export const PROJECTS_UPDATES_CAPABILITY = 'projects-updates-v1';

// ─── Where entries live (R1 reservation, unchanged) ───────────────────────────────────────────────

/** Inside the project folder. Hidden from Documents/Images and protected from tdsapp-files since R1. */
export const UPDATES_DIR = 'updates';
/**
 * `<YYYY-MM-DD>-<HHmm>-<person>-<random6>.md`, UK local date and time of `at`; `person` is the writer's team
 * slug; `random6` is 6 characters of [a-z0-9]. A clash (already exists) is retried with a new suffix.
 */
export const UPDATE_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{6}\.md$/;

// ─── Limits ──────────────────────────────────────────────────────────────────────────────────────

/** Characters in an entry's summary (its markdown body), after trimming. Empty is refused. */
export const UPDATE_SUMMARY_MAX = 5_000;
/** Entries one read returns, newest first; `before` pages further back. */
export const UPDATES_PAGE = 50;

// ─── Kinds ───────────────────────────────────────────────────────────────────────────────────────

/** What a person (or Claude, through the skill) may add with the `update` action. */
export type ManualUpdateKind = 'note' | 'call';
/** Written by the script itself on `edit` (decision 4): a status, health or Account Owner change. */
export type AutoUpdateKind = 'status' | 'owner';
/** Reserved for later phases: `email` (phase 5), `digest` (phase 6), `contract` (R3). Read and shown as written. */
export type UpdateKind = ProjectUpdate['kind'];

// ─── The action (added to ProjectAction) ─────────────────────────────────────────────────────────

/**
 * `{kind:'update', key, entry:{kind, summary, clientSafe}}`. Script 0.4. `by` and `at` are the script's
 * (this Mac's identity and clock), never the request's. Refused: archived project (`not-allowed`), card-less
 * legacy folder is ALLOWED (an updates/ folder is made beside whatever is there), empty or over-long summary
 * (`bad-request`), any other kind (`bad-request`). Personal projects: allowed (personal/ never syncs).
 * Answers `{ok:true, action:'update', key, version, file}` where `version` is project.md's hash (unchanged,
 * '' when there's no card) and `file` the new entry's brain-relative path.
 */
export interface ProjectUpdateAction {
  kind: 'update';
  key: ProjectKey;
  entry: { kind: ManualUpdateKind; summary: string; clientSafe: boolean };
}

/**
 * Auto entries on `edit` (decision 4). After the card is written, for each of these that changed, one entry:
 *   status  → kind 'status', summary `Status: <old> → <new>.` (words as the app shows them: Planned, Active,
 *             On hold, Done)
 *   health  → kind 'status', summary `Health: <old or "not set"> → <new or "not set">.` (Green, Amber, Red)
 *   owner   → kind 'owner',  summary `Account Owner: <old name or "nobody"> → <new name or "nobody">.`
 * One `edit` that changes several writes one entry per change, all client_safe false. A failure writing an
 * auto entry never undoes the card change: the reply adds `updatesFailed: true` and the app says so.
 */
export const AUTO_UPDATE_FIELDS = ['status', 'health', 'owner'] as const;

// ─── Reading (server → app) ──────────────────────────────────────────────────────────────────────

/** One entry as the app shows it. Unknown frontmatter keys are ignored; unknown kinds are kept as written. */
export interface ProjectUpdateItem extends ProjectUpdate {
  /** Brain-relative path of the entry file (its id). */
  path: string;
  /** `by`'s display name from the team roster, else `by` as written. */
  byName: string;
}

/** `GET ROUTES.projectUpdates?key=<ProjectKey>[&before=<path>]` → this. */
export interface ProjectUpdatesResponse {
  /** Newest first by `at` (ties: by file name, descending). At most UPDATES_PAGE. */
  updates: ProjectUpdateItem[];
  /** True when older entries exist beyond this page. */
  more: boolean;
  /** Entry files that couldn't be read (bad frontmatter, merge markers): counted, never shown. */
  unreadable: number;
  /** Whether this person can add entries here: the script has PROJECTS_UPDATES_CAPABILITY, the project is live, and the person may change projects. */
  canAdd: boolean;
}

// ROUTES additions (shared/contract.ts): projectUpdates: '/api/projects/updates' (GET). Adding goes through the
// existing `POST ROUTES.projectsChange` with a ProjectUpdateAction.
