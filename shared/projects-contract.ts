/**
 * Contract for the projects system (plan docs/plans/2026-11-20-projects-system.md), release 1.
 * The app (server/brain/projects.ts, server/brain/projects-skill.ts, client/src/apps/projects/*) and the
 * brain skill script (brain-skills/tdsapp-projects) build against this file; a test checks the script's
 * constants match. The app never writes brain files itself: every change is a ProjectAction run by the
 * `tdsapp-projects` script, or a TodoProjectAction run by `tdsapp-todo`.
 *
 * NOT BUILT YET (reserved so phase one stores what they need): TimeEntry (phase 2).
 */

// ─── Where projects live (decision 1) ─────────────────────────────────────────────────────────────

/** A project's permanent folder name. Never changes after `create`; the title can. */
export const PROJECT_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const PROJECT_SLUG_MAX = 60;

/** The card file inside every project folder. */
export const PROJECT_CARD_FILE = 'project.md';

/** Brain-relative folders, `<client>` and `<slug>` filled in. */
export const CLIENT_PROJECTS_DIR = 'clients/<client>/projects/<slug>';
export const PERSONAL_PROJECTS_DIR = 'personal/projects/<slug>';
/** Legacy folders, read in place as internal TDS projects (decision 4). Never moved by R1. */
export const LEGACY_PROJECTS_DIR = 'projects/<slug>';
/** Archived locations, read only (decision 4b). Keys still resolve, so old to-dos and later time entries never orphan. */
export const LEGACY_ARCHIVE_DIR = 'projects-archive/<slug>';
export const ARCHIVED_CLIENT_PROJECTS_DIR = 'clients/_archive/<client>/projects/<slug>';
/**
 * Reader precedence for INTERNAL_CLIENT keys (overseer B4): the first folder found wins; any later
 * folder with the same slug is reported in ProjectList.duplicates and never shown as a second project.
 * `create` refuses a slug found in ANY of these.
 */
export const INTERNAL_PRECEDENCE = [
  'clients/the-digital-stride/projects/<slug>',
  'projects/<slug>',
  'projects-archive/<slug>',
] as const;
// Any other client: the live folder first, then `clients/_archive/<client>/projects/<slug>`.
/** The client legacy and internal projects belong to. */
export const INTERNAL_CLIENT = 'the-digital-stride';

/**
 * Where a project lives. 'legacy' = a folder in `projects/`, reported under INTERNAL_CLIENT.
 * A slug is unique per client, and INTERNAL_CLIENT's slugs are unique across `clients/the-digital-stride/projects/`
 * AND `projects/` together (the script refuses a clash), so a key never points at two folders.
 */
export type ProjectSpace = 'client' | 'personal' | 'legacy';
/**
 * Every folder in a projects location is a project in all three spaces (overseer B3), card or not.
 * 'none': no `project.md` (title from README's first heading, else the folder name tidied up).
 * 'unreadable': `project.md` exists but its frontmatter can't be parsed (merge markers, hand edits):
 * still a project, shown with a warning, read-only until fixed; its key keeps resolving.
 */
export type CardState = 'ok' | 'none' | 'unreadable';

/**
 * The one string every link uses: `<client>/<slug>` for client and legacy projects
 * (legacy: `the-digital-stride/<slug>`), `personal/<slug>` for personal ones.
 * Written to to-do frontmatter as `project:` (decision 5) and, in phase 2, to time entries.
 * `personal` is never a client slug (the script refuses to treat it as one).
 */
export type ProjectKey = string;
export const PROJECT_KEY_PATTERN = /^(personal|[a-z0-9]+(-[a-z0-9]+)*)\/[a-z0-9]+(-[a-z0-9]+)*$/;
/** Each side of the slash at most this long (checked separately from the pattern). */
export const PROJECT_KEY_SEGMENT_MAX = 60;
// Legacy folder names that fail PROJECT_SLUG_PATTERN are skipped and counted (ProjectList.skippedFolders).

// ─── The card (decision 2) ─────────────────────────────────────────────────────────────────────────

export type ProjectKind = 'one-off' | 'ongoing';
export type ProjectStatus = 'planned' | 'active' | 'on-hold' | 'done';
export type Light = 'green' | 'amber' | 'red';
/** Mirrors Monday's TDS Projects "Type" column. More may be added; readers keep unknown values as text. */
export type ProjectService = 'ppc' | 'seo' | 'social-email' | 'hosting';

export const PROJECT_TITLE_MAX = 120;
export const PROJECT_BRIEF_MAX = 20_000;
export const PROJECT_STAGES_MAX = 12;
export const PROJECT_STAGE_MAX = 40;
export const PROJECT_TEAM_MAX = 20;
export const PROJECT_BUDGET_MAX_HOURS = 100_000;
export const PROJECT_LINKS_MAX = 200;

/**
 * `project.md` frontmatter, as written by the script (snake_case on disk, keys in this order).
 * Every field but `v`, `title` and `status` is optional on disk; readers treat missing as null/[].
 * Unknown keys are kept byte-for-byte by every edit (decision 9).
 *
 *   v: 1
 *   title: "Website rebuild"
 *   client: skyseal               # absent for personal; INTERNAL_CLIENT for internal
 *   kind: one-off
 *   status: active
 *   health: green
 *   comms: amber
 *   owner: steve-blassberg        # the Account Owner (team slug)
 *   team: [simon-jones, ian-hancock]
 *   service: [ppc, seo]
 *   start: 2026-11-20
 *   end: 2027-02-28               # one-off only; the script refuses `end` before `start`
 *   budget_hours: 40
 *   billable: true
 *   stages: [Discovery, Build, Launch]
 *   monday_id: 1234567890         # reserved for the switch-over import (decision 16); omitted when empty
 *   created: 2026-11-20           # written once by `create`/`card`, never changed
 *   created_by: ian-hancock
 *
 * No `updated`/`updated_by` stamps (overseer S2): two edits between syncs would then always clash
 * textually and stall the brain's sync. "Last changed by/when" comes from git on read (lastChanged).
 * Empty fields are omitted, not written as null.
 *
 * Body: the brief (markdown), then an optional `## Linked files` section of `- [name](relative path)`
 * lines, the same format and parser as to-do attachments (shared/todo-files.ts).
 */
export interface ProjectCard {
  key: ProjectKey;
  space: ProjectSpace;
  slug: string;
  /** Null for personal projects. INTERNAL_CLIENT for legacy and internal ones. */
  client: string | null;
  /** Brain-relative folder, e.g. "clients/skyseal/projects/website-rebuild". */
  folder: string;
  /** See CardState. 'none' and 'unreadable' are read-only until "Add a card" (`card` action) or a fix. */
  card: CardState;
  /** True for archive locations (projects-archive/, clients/_archive/): status forced 'done', no actions. */
  archived: boolean;
  title: string;
  kind: ProjectKind | null;
  status: ProjectStatus;
  health: Light | null;
  comms: Light | null;
  owner: string | null;
  team: string[];
  /** Known values typed; anything else kept as written. */
  service: (ProjectService | string)[];
  start: string | null;
  end: string | null;
  budgetHours: number | null;
  billable: boolean | null;
  stages: string[];
  mondayId: string | null;
  created: string | null;
  createdBy: string | null;
  /** From `git log -1` on the folder: who (team slug, else git name) and when (ISO). Null outside git or when unknown. */
  lastChanged: { by: string; at: string } | null;
  /** The body without the `## Linked files` section, trimmed. */
  brief: string;
  /** Brain-relative paths from `## Linked files`, in written order. */
  links: string[];
  /** SHA-256 hex of `project.md`'s bytes ('' when card !== 'ok'). Sent back as `expect`. */
  version: string;
  /** Counted from all open TDS to-dos (and this person's personal ones) whose projectMatch points here. */
  openTodos: number;
  /**
   * Brain path of a legacy `todo.md` checklist in the folder, else null. Linked from Overview, never
   * counted as to-dos (six legacy folders have one).
   */
  checklist: string | null;
}

// ─── Reading (decision 10) ─────────────────────────────────────────────────────────────────────────

/** `GET /api/projects` → ProjectList. Personal projects are only this Mac's (they never sync). */
export interface ProjectList {
  projects: ProjectCard[];
  /** The script answered `capabilities` with PROJECTS_CAPABILITY; false → the app is read-only with a notice. */
  canChange: boolean;
  /**
   * Tidy rows still waiting (overseer B1): distinct old labels on open TDS and own personal to-dos
   * (never `todo/done/`) whose match is 'legacy', 'client' or 'loose', minus labels skipped on this Mac.
   * 0 hides the tidy-up.
   */
  looseLabels: number;
  /** Same-slug folders shadowed by INTERNAL_PRECEDENCE, e.g. ["projects/client-portal"]. Shown as a notice. */
  duplicates: string[];
  /** Folders whose names fail PROJECT_SLUG_PATTERN, skipped. */
  skippedFolders: number;
}

// ─── Changing (decisions 8, 9) ─────────────────────────────────────────────────────────────────────

export const PROJECTS_CAPABILITY = 'projects-v1';
export const PROJECTS_SCRIPT_TIMEOUT_MS = 10_000;

/** Fields a create or edit may set. `null` clears; absent leaves as is (edit). */
export interface ProjectFields {
  title?: string;
  kind?: ProjectKind | null;
  status?: ProjectStatus;
  health?: Light | null;
  comms?: Light | null;
  owner?: string | null;
  team?: string[];
  service?: string[];
  start?: string | null;
  end?: string | null;
  budgetHours?: number | null;
  billable?: boolean | null;
  stages?: string[];
  brief?: string;
}

/**
 * `POST /api/projects/change` body, passed to the script as one JSON object on stdin (camelCase → the
 * script maps to snake_case). Every action but `create` and `card` carries `expect` = ProjectCard.version.
 * The script answers one line: `{ok:true, key, version}` or `{ok:false, error: ProjectsErrorCode, message}`.
 * Who did it always comes from this Mac's git identity matched against the team (as tdsapp-files).
 */
export type ProjectAction =
  | {
      kind: 'create';
      space: 'client' | 'personal';
      client?: string;
      slug: string;
      fields: ProjectFields & { title: string };
    }
  /**
   * Adds `project.md` to ANY card-less project folder (legacy, client or personal; not archived). Title
   * defaults to the README heading or folder name. Refused with `exists` if a card appeared meanwhile.
   * Never moves or edits anything else.
   */
  | { kind: 'card'; key: ProjectKey; fields: ProjectFields }
  | { kind: 'edit'; key: ProjectKey; fields: ProjectFields; expect: string }
  /** Adds a `- [name](path)` line to `## Linked files`. Refused when a shared project would link a `personal/` file. */
  | { kind: 'link'; key: ProjectKey; path: string; expect: string }
  | { kind: 'unlink'; key: ProjectKey; path: string; expect: string }
  | { kind: 'capabilities' };

export type ProjectsErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'exists'
  | 'changed'
  | 'not-allowed'
  | 'internal';

// ─── To-dos (decisions 5, 6) ───────────────────────────────────────────────────────────────────────

/** Capability `tdsapp-todo` v0.6 answers; the app shows Project/Stage fields only with it (TodoList.canProject). */
export const TODO_PROJECT_CAPABILITY = 'todo-project-v1';

/**
 * v0.6 `add` gains optional `client`, `project`, `stage` (one write, overseer S5). Same checks as
 * TodoProjectAction. A save that changes several fields sends them in the order edit → due → project →
 * assignee.
 */
export interface TodoAddProjectFields {
  client?: string | null;
  project?: ProjectKey | null;
  stage?: string | null;
}

/**
 * v0.6 `move` (overseer B2): moving a personal to-do to TDS whose `project:` is a `personal/` key is
 * refused with `not-allowed` unless the request carries `dropProject: true`, in which case the script
 * removes the `project:` and `stage:` lines in the moved copy. The app asks first ("This to-do is in a
 * private project. Moving it to the team removes it from that project.").
 */
export interface TodoMoveProjectFields {
  dropProject?: true;
}

/**
 * New `tdsapp-todo` action (script v0.6, capability 'todo-project-v1'): sets a to-do's client, project
 * and stage together. `project` is a ProjectKey or null; when set, `client` must equal the key's client
 * (null for personal). A TDS (shared) to-do may not take a `personal/` key: `not-allowed`.
 * Writes `client:`, `project:`, `stage:` in frontmatter; null removes the line. Other bytes unchanged.
 */
export interface TodoProjectAction {
  kind: 'project';
  id: string;
  scope?: 'tds' | 'personal';
  client: string | null;
  project: ProjectKey | null;
  stage: string | null;
  expect?: string;
}

/**
 * How a to-do's `project:` value is read: pure function
 * `resolveTodoProject(value, todoClient, scope, projects, clients)` in shared/projects.ts.
 * A TDS to-do resolves ONLY against shared projects (never `personal/`), so it reads the same on every
 * Mac (overseer B2). A personal to-do may resolve against either.
 * Precedence (overseer S3):
 * 1. Well-formed ProjectKey: folder exists (any space, archive included) → 'key'; else → 'missing'.
 *    The key's client wins if `client:` disagrees; `client:` absent → derived from the key.
 * 2. Slash-less label equal to a client slug → 'client' ("harvey-nash").
 * 3. Slash-less label equal to a project slug: within the to-do's `client:` when it has one; else
 *    exactly one match among eligible projects → 'legacy'. Several matches → 'loose'.
 * 4. Anything else → 'loose' (shown as text, as today).
 * 'missing' is never offered in the tidy-up and never fuzzy-merged: the folder may arrive with a sync.
 */
export type TodoProjectMatch =
  | { how: 'key' | 'legacy'; key: ProjectKey }
  | { how: 'missing'; key: ProjectKey }
  | { how: 'client'; client: string }
  | { how: 'loose'; label: string }
  | { how: 'none' };

/** Added to TodoItem (shared/contract.ts) in R1. Old servers send neither; the client treats absent as null / none. */
export interface TodoProjectFields {
  stage: string | null;
  projectMatch: TodoProjectMatch;
}

// ─── Files (decision 7) ────────────────────────────────────────────────────────────────────────────

/**
 * Added to LibraryItem in R1: the keys of every project the file belongs to, by folder (inside a project
 * folder) or by link (listed in a card's `## Linked files`). [] when none. Absent from older servers.
 * Computed when serving, never cached with the item (overseer B5): a card edit in one scope changes
 * items cached in another.
 */
export interface LibraryProjectFields {
  projects: ProjectKey[];
}

/** The library scope for legacy `projects/` folders. Read-only in R1: no delete, own watch folder. */
export const LEGACY_PROJECTS_SCOPE = 'shared:projects';

/**
 * `GET /api/projects/files?key=<ProjectKey>&kind=image|document` → { items: LibraryItem[] }: every file
 * in the project's folder (whatever scope it sits in) plus each `## Linked files` path that resolves to a
 * listable library item (via the library's `itemForPath`). A link the person can't see (another's
 * personal file) or that is gone is left out, and counted in `hidden`. The picker's project choice and the
 * project page's Files tab both use this, because a project's files can span scopes.
 */
export interface ProjectFilesResponse {
  items: import('./contract').LibraryItem[];
  hidden: number;
}

// ─── The picker (decision 11) ──────────────────────────────────────────────────────────────────────

/**
 * The app-wide choice grows a project: client choice stays as today ("client:<slug>", "personal",
 * NO_CLIENT, ''); project choice is a ProjectKey or ''. Setting a different client clears the project.
 * A project choice always implies its client choice (personal → "personal").
 */
export type ProjectChoice = ProjectKey | '';

// ─── Tidy-up (decision 13) ─────────────────────────────────────────────────────────────────────────

export type TidySuggestion =
  | { do: 'link'; key: ProjectKey; why: 'same-slug' }
  | { do: 'client-only'; client: string; why: 'is-a-client' }
  | { do: 'merge'; into: string; why: 'near-spelling' }
  | { do: 'clear'; why: 'placeholder' }
  | { do: 'new-project'; client: string | null; slug: string; why: 'no-match' }
  | { do: 'skip'; why: 'no-match' };

/**
 * Suggestion rules (`suggestTidy`, server/brain/tidy.ts; overseer S4):
 * - 'legacy' match → link to that key. 'client' match → client only (sets `client:` only when absent;
 *   a to-do whose `client:` already names a DIFFERENT client is left out of the row and listed apart).
 * - near spelling → merge only on a plural (`s`/`es`), hyphen difference, or edit distance 1 with
 *   both labels at least 6 characters. Never for short labels (`os`).
 * - the template placeholder `optional-project-slug` → clear.
 * - otherwise → new project under the to-do's `client:`, else INTERNAL_CLIENT (never personal for a
 *   TDS to-do), or skip.
 */
/** One row of the tidy-up screen: one old label and every to-do carrying it. Nothing changes until approved. */
export interface TidyRow {
  label: string;
  todos: {
    id: string;
    scope: 'tds' | 'personal';
    title: string;
    client: string | null;
    assignee: string | null;
    version: string;
  }[];
  /** To-dos with this label left out because their `client:` names another client. Shown, not changed. */
  conflicts: { id: string; title: string; client: string }[];
  suggestion: TidySuggestion;
}

/**
 * `GET /api/projects/tidy` → TidyList. `POST /api/projects/tidy` with TidyApply → TidyList (re-read from
 * disk after every apply, so a partial failure just shows what's left; an `exists` on create becomes a link).
 * Unlike /api/todos/change, the tidy route may change ANY open TDS to-do, a teammate's included (overseer
 * B1), but only the `client:`/`project:`/`stage:` lines, each with its own `expect`. Personal to-dos: own only.
 * Skips are kept in the app's own data folder (`tidy-skips.json`), per Mac, never in the brain.
 */
export interface TidyList {
  rows: TidyRow[];
  skipped: string[];
}

export type TidyApply =
  | { label: string; do: 'approve'; suggestion: TidySuggestion }
  | { label: string; do: 'skip' }
  | { label: string; do: 'unskip' };

/** Per-to-do outcome of an approve: the row is re-read either way. */
export interface TidyApplyOutcome {
  changed: number;
  failed: { id: string; error: 'changed' | 'not-found' | 'not-allowed' | 'internal' }[];
}

// ─── Phase 2 (reserved, NOT BUILT) ─────────────────────────────────────────────────────────────────

/**
 * One time entry. Phase 2 stores them one file per person per Mac per month (so no two Macs ever write
 * one file, as `tdsapp-deleted/log/`), e.g. `time/<person>.<machine-id>/<YYYY-MM>.jsonl`. Suggestions never count in a report until approved.
 * Listed here so R1 keeps every id an entry needs stable: client slug, ProjectKey, to-do key, person slug.
 */
export interface TimeEntry {
  v: 1;
  id: string;
  person: string;
  date: string;
  minutes: number;
  client: string | null;
  project: ProjectKey | null;
  todo: string | null;
  stage: string | null;
  source: 'timer' | 'manual' | 'session' | 'suggested' | 'tracket';
  status: 'suggested' | 'approved' | 'rejected';
  billable: boolean;
  note: string;
  /** Client-safe notes are the only ones a client-facing report may show. */
  clientSafe: boolean;
}
