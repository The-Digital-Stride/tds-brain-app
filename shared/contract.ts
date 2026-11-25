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

import type { CompactionEvent, ContextEvent } from './context-contract.ts';
import { chatContextPath } from './context-contract.ts';
import type { AppState } from './install-contract.ts';
import type { LevelMode, LevelTier, OwnLevel, SkillLevels, TurnLevel } from './levels-contract.ts';
import type { ArtifactSource } from './pages.ts';
import type { ChatPage } from './pages-contract.ts';
import type { ProjectUpdatesResponse } from './project-updates-contract.ts';
import type {
  ProjectAction,
  ProjectCard,
  ProjectFilesResponse,
  ProjectKey,
  ProjectList,
  ProjectMoveCheckResponse,
  ProjectMoveRequest,
  ProjectMoveResult,
  ProjectRemoveCheckResponse,
  ProjectRemoveRequest,
  ProjectRemoveResult,
  ProjectTodosResponse,
  TidyApply,
  TidyList,
  TodoAddProjectFields,
  TodoMoveProjectFields,
  TodoProjectAction,
  TodoProjectMatch,
} from './projects-contract.ts';
import { UPDATE_ROUTES } from './update-contract.ts';

export const DEFAULT_PORT = 3877;
/** The app is served on this host only. `localhost` is refused: cookies do not carry between the two names. */
export const APP_HOST = '127.0.0.1';
export const SESSION_COOKIE = 'tba_session';
/**
 * The session cookie's name for the app on `port`. Browsers share cookies across ports on one host, so
 * two copies on 127.0.0.1 (the live app and a test copy) would overwrite each other's sign-in. The
 * default port keeps the original name, so the live app never asks anyone to sign in again; every
 * other port gets its own.
 */
export function sessionCookieName(port: number): string {
  return port === DEFAULT_PORT ? SESSION_COOKIE : `${SESSION_COOKIE}_${port}`;
}
export const MAX_LIVE_SESSIONS = 4;

// ---------------------------------------------------------------------------
// The merge-and-push card (plan 2026-11-25-app-change-guards)
// ---------------------------------------------------------------------------

/** What a confirmed publish does. `merge-and-push` is `wt-finish --merge --push`. */
export type PublishKind = 'push' | 'merge' | 'merge-and-push';

/** What the merge-and-push card shows. Every field but `kind`, `isApp` and `command` may be unknown (null). */
export interface PublishFacts {
  kind: PublishKind;
  /** `owner/name` from the repo's origin URL, e.g. "The-Digital-Stride/tds-brain-app". */
  repo: string | null;
  /** True when the repo is TDS Cortex itself. */
  isApp: boolean;
  /** The branch being merged or pushed, e.g. "app-change-guards". */
  branch: string | null;
  /** Where it lands, e.g. "main". */
  target: string | null;
  /** The app's package.json version when `isApp`, e.g. "0.82.3". */
  version: string | null;
  /** Up to 20 one-line commits going out, newest first ("abc1234 fix: …"). */
  commits: string[] | null;
  /** How many commits go out in total (may be more than `commits.length`). */
  commitCount: number | null;
  /** The exact command or tool call. */
  command: string;
}

const PUBLISH_WORDS: Record<PublishKind, string> = {
  push: 'push',
  merge: 'merge',
  'merge-and-push': 'merge and push',
};

/** The card's title, e.g. "Are you sure you want to merge and push?". */
export function publishTitle(kind: PublishKind): string {
  return `Are you sure you want to ${PUBLISH_WORDS[kind]}?`;
}

/** The card's Yes button, e.g. "Yes, merge and push". The No button is always "No, not now". */
export function publishYesLabel(kind: PublishKind): string {
  return `Yes, ${PUBLISH_WORDS[kind]}`;
}

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

/**
 * What the brain says about a person beyond who they are: their row in `context/team-profile.md`
 * (columns Name, Title, Departments, What they own day to day), matched by name. Shown on the
 * Profile page. Every field is empty when they have no row.
 */
export interface MemberProfile {
  /** e.g. "Director – Finance & Technical". */
  title: string | null;
  /** The Departments cell, comma-separated there, e.g. ["Finance", "Technical"]. */
  departments: string[];
  /** The "What they own day to day" cell. */
  owns: string | null;
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
  /**
   * The skill's own frontmatter `model` / `effort` (plan 2026-11-14-skill-levels-and-helpers,
   * decision 3). null when neither is set; absent from older servers. Read only.
   */
  ownLevel?: OwnLevel | null;
}

/**
 * Where a to-do lives is its scope (plan 2026-11-13-todo-handover-search-scope, decision 1):
 * 'tds' = `todo/*.md` (shared through git), 'personal' = `personal/todo/*.md` (git-ignored, this Mac only).
 */
export type TodoScope = 'tds' | 'personal';

/** The personal to-do folder, relative to the brain root. Done/deleted go in its `done/` and `deleted/`. */
export const TODO_PERSONAL_DIR = 'personal/todo';

/** Who passed a to-do to its current assignee, and when (decision 5). */
export interface TodoHandover {
  /** Team slug of the person who passed it on; null when it can't be matched to the team. */
  by: string | null;
  /** Display name: the roster's name for `by`, else the stamp/git author's name as written. */
  byName: string | null;
  /** When: an ISO timestamp (stamp: with UK offset; history: the commit's author date). */
  at: string;
  /** Previous assignee slug, 'open' when it was open to anyone, null when not known. */
  from: string | null;
  /** `assigned_via` from the stamp (e.g. "TDS Brain App"); null for history or when absent. */
  via: string | null;
  /**
   * 'stamp': from the `assigned_*` frontmatter, used only when `assigned_to` equals the current assignee.
   * 'history': from `git log -G '^assignee:'` (usually the creating commit), for TDS to-dos in `mine`.
   */
  source: 'stamp' | 'history';
}

export interface TodoItem {
  /**
   * The file name inside its folder (`todo/` or `personal/todo/`), e.g. "20260702-renew-contract.md".
   * Sent as `id` in the API, together with `scope`. NOT unique on its own across scopes: use `key`.
   */
  id: string;
  /** Which folder it lives in. 'tds' for everything in `todo/`. */
  scope: TodoScope;
  /**
   * Unique across scopes: `id` for TDS, `personal/<id>` for personal. Used for every client map
   * (held changes, seen markers, React keys) and as the session's `todoId`.
   */
  key: string;
  /** Brain-relative path: `todo/<id>` or `personal/todo/<id>`. Used in chat drafts. */
  path: string;
  /** Who passed it on and when; null when not known or when it was never passed on. */
  handover: TodoHandover | null;
  /** Frontmatter `created_by` (team slug), else null. */
  createdBy: string | null;
  title: string;
  /** Slugified person name, or null when the to-do is open to anyone. */
  assignee: string | null;
  /** YYYY-MM-DD from frontmatter `due`, else null. */
  due: string | null;
  /** YYYY-MM-DD from the file name's date prefix, else null. */
  surfaceDate: string | null;
  /** Frontmatter `project:` exactly as written (a ProjectKey, an old label, or null). See `projectMatch`. */
  project: string | null;
  client: string | null;
  /**
   * Projects R1 (plan 2026-11-20-projects-system, decision 6): frontmatter `stage`, else null.
   * Absent from older servers: the client treats absent as null.
   */
  stage?: string | null;
  /**
   * Projects R1 (decision 5): how `project` resolves, by `resolveTodoProject` (shared/projects.ts).
   * Absent from older servers: the client treats absent as `{ how: 'none' }`.
   */
  projectMatch?: TodoProjectMatch;
  /** Frontmatter `created` as written, else null. */
  created: string | null;
  /** Frontmatter `source` (where the to-do came from), else null. */
  source: string | null;
  /**
   * Everything below the frontmatter, trimmed ('' when empty). The Workbench shows this on hover
   * and edits it as "details"; an edit replaces it whole.
   */
  details: string;
  /**
   * The file's fingerprint when it was read: lower-case hex SHA-256 of its raw bytes (64 characters).
   * Sent back as `expect` with a change, so the skill refuses it if the file has changed since
   * (BCR-01). Changes when anyone changes the file, including this person.
   */
  version: string;
  /**
   * Release 3 (plan 2026-11-16-todo-attachments): the files linked in the body's `## Files` section, in
   * written order. [] when there is none. `details` still holds the whole body, section included; the
   * client splits it with `splitTodoFiles` (shared/todo-files.ts) and, when TodoList.canAttach, edits and
   * sends only the details part (see `edit` below).
   */
  attachments: TodoAttachment[];
}

/**
 * One file linked to a to-do (release 3). Parsed from a `- [name](path)` line in the body's `## Files`
 * section; the path is written relative to the to-do's own folder and resolved to a brain path.
 */
export interface TodoAttachment {
  /** Brain-relative, forward slashes, e.g. "clients/acme/images/logo.png". */
  path: string;
  /** The link text as written (usually the file name). */
  name: string;
  /** From the extension, by the library's rules; null for a type the library doesn't list. */
  kind: LibraryKind | null;
  /**
   * The library item id when this person's library lists the file (opens in the file viewer), else null:
   * missing on this Mac, someone else's personal file, or a place the library doesn't list.
   */
  libraryId: string | null;
  /** Under `personal/`: only the Mac that saved it has it (personal files never sync). */
  personal: boolean;
  /**
   * For a `personal/` file: the team slug written as "(only on <slug>'s Mac)", else null. `libraryId` is
   * set for a personal file only when `holder` is this person (overseer S3), so a teammate never opens
   * their own file of the same name.
   */
  holder: string | null;
}

/** Most files one to-do's `## Files` section may hold; `attach` beyond it is refused `bad-request`. */
export const TODO_ATTACHMENTS_MAX = 20;

/** One person a to-do can be passed to: a member of `.team-config/roles.json`. */
export interface TeamMember {
  /**
   * The Workbench's slug rule (`/api/todos/roster`): lower-case, every run of characters other than
   * a–z and 0–9 becomes one dash, no dash at either end. "Ben McAdam" → "ben-mcadam".
   */
  slug: string;
  name: string;
}

/**
 * Whether this person can add, edit, pass on, re-date and delete to-dos in the app. The app never
 * writes those changes itself: it runs the brain's own `todo` skill script (TODO_SCRIPT), so the
 * brain decides how the file changes. Ticking is separate and unchanged (`directWrites`).
 * - `on`: the skill is in this brain, this person's role may use it, and the Settings switch is on.
 * - `switched-off`: as `on`, but the Settings switch ("Let the app change to-dos") is off.
 * - `restricted`: the skill's `roles:` leave this person out (it hasn't been released to them yet).
 * - `no-skill`: this brain has no `todo` skill, or its script is missing.
 */
export type TodoChangeAccess = 'on' | 'switched-off' | 'restricted' | 'no-skill';

/** What `BrainReaders.todos` may return for `changes`; the route adds 'switched-off'. */
export type TodoSkillAccess = Exclude<TodoChangeAccess, 'switched-off'>;

export interface TodoList {
  /** Assigned to the current person, soonest first. */
  mine: TodoItem[];
  /** No assignee: anyone can pick these up. */
  open: TodoItem[];
  /** How many belong to other people (not listed). */
  othersCount: number;
  /** Everyone in `.team-config/roles.json` with a name, in file order. [] when it can't be read. */
  team: TeamMember[];
  /** `BrainReaders.todos` gives a TodoSkillAccess; the route turns 'on' into 'switched-off' when the switch is off. */
  changes: TodoChangeAccess;
  /**
   * Whether the brain's skill can add a to-do open to anyone (`add` with `assignee: null`). True only
   * when `changes` is 'on' and the skill found is `tdsapp-todo` (v0.3 or later by definition): the older
   * `todo` script ignores the request and would assign the to-do to the person instead.
   */
  canAddOpen: boolean;
  /**
   * Whether personal to-dos can be added, changed, moved and ticked: `changes` is 'on' and the script's
   * `capabilities` lists "scope" (v0.4+, and the brain's git ignores `personal/todo/`). Personal to-dos
   * already on disk are listed in `mine` whatever this says.
   */
  canUsePersonal: boolean;
  /**
   * Release 3: whether files can be linked to and unlinked from to-dos (`attach` / `detach`), and `add`
   * takes `details`: `changes` is 'on' and the to-do script's `capabilities` lists "attach" (v0.5+).
   */
  canAttach: boolean;
  /**
   * Release 3: whether a new file can be uploaded to a to-do (ROUTES.todoUpload): `canAttach`, and the
   * `tdsapp-files` skill is here, allowed for this person, and its `capabilities` list "files-add-v1".
   */
  canUpload: boolean;
  /**
   * Projects R1 (decision 15): the to-do script answers `capabilities` with TODO_PROJECT_CAPABILITY
   * ('todo-project-v1'), so the `project` action, `add` with client/project/stage and `move` with
   * `dropProject` are understood. False hides the Project and Stage fields. Absent from older servers = false.
   */
  canProject?: boolean;
  /**
   * Only in the reply to a `move` change: the to-do's `key` before and after (a name clash at the
   * destination changes the id). Lets a multi-step save address the next step to the new place.
   */
  moved?: { from: string; to: string };
}

/**
 * The brain skill that changes to-dos, and its script relative to the brain root. Brain files the
 * app adds start with `tdsapp-`. The skill was called `todo` until v0.3 (2026-11-13). The app uses the
 * first skill in TODO_SKILLS whose folder exists (presence, not access: if `tdsapp-todo` is there but
 * restricted for this person, the app does not fall back to `todo`). For one release the brain keeps a
 * `todo` shim (deprecated SKILL.md with the same `roles:`, script that runs tdsapp-todo.cjs) so an older
 * app or older instructions keep working.
 */
export const TODO_SKILL = 'tdsapp-todo';
export const TODO_SCRIPT = '.claude/skills/tdsapp-todo/scripts/tdsapp-todo.cjs';
export const TODO_SKILL_LEGACY = 'todo';
export const TODO_SCRIPT_LEGACY = '.claude/skills/todo/scripts/todo.cjs';
/** Where the app looks, first match wins: the skill name (for roles) and its script. */
export const TODO_SKILLS: readonly { skill: string; script: string }[] = [
  { skill: TODO_SKILL, script: TODO_SCRIPT },
  { skill: TODO_SKILL_LEGACY, script: TODO_SCRIPT_LEGACY },
];
/** `expect` / TodoItem.version: lower-case hex SHA-256. */
export const TODO_VERSION_PATTERN = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// "Asked of others" and to-do history (plan 2026-11-16-asked-of-others). Read only: nothing here
// writes a brain file or runs any git command that changes the brain.
// ---------------------------------------------------------------------------

/**
 * Where a fact about a to-do came from.
 * - 'stamp': lines the app or the to-do skill wrote in the file (`assigned_*`, `completed_*`, `created_by`).
 *   Names the person who did it.
 * - 'history': the brain's git record. Names the Mac that synced the change, which is usually but not
 *   always the person who made it (a change made on someone else's Workbench is synced from theirs).
 */
export type TodoFactSource = 'stamp' | 'history';

/** Who did something to a to-do, and when. */
export interface TodoActor {
  /** Team slug, or null when it can't be matched to `.team-config/roles.json`. */
  slug: string | null;
  /** The roster's name for `slug`, else the name as the stamp or git wrote it; null when neither has one. */
  name: string | null;
  /** ISO 8601 (a stamp keeps its UK offset; history is the commit's author date). */
  at: string;
  source: TodoFactSource;
}

/**
 * A TDS to-do this person passed on to someone else (or added for them), still waiting or finished.
 * Never a personal to-do. Never one now assigned to this person or open to anyone.
 */
export interface AskedTodo {
  /**
   * `asked:todo/<id>` (waiting) or `asked:todo/done/<id>` (done). Never equal to a TodoItem.key, so the
   * panel, prev/next and React keys can hold both kinds.
   */
  key: string;
  /** The file name, e.g. "20261113-send-the-quote.md". */
  id: string;
  /** 'waiting': still in `todo/`. 'done': in `todo/done/`. */
  state: 'waiting' | 'done';
  /** Brain-relative path: `todo/<id>` or `todo/done/<id>`. */
  path: string;
  title: string;
  /** Team slug of who has it (waiting) or had it when it was ticked (done). */
  assignee: string;
  /** The roster's name for `assignee`, else the slug. */
  assigneeName: string;
  /** YYYY-MM-DD from frontmatter `due`, else null. */
  due: string | null;
  /** Everything below the frontmatter, trimmed. Shown read only. */
  details: string;
  /** When this person passed it on (or added it for them). */
  asked: TodoActor;
  /** Who ticked it off and when; null while waiting. */
  done: TodoActor | null;
  /** The file's fingerprint, as TodoItem.version. */
  version: string;
  /** As TodoItem.attachments (release 3). Shown read only. */
  attachments: TodoAttachment[];
  /**
   * As TodoItem.client / project / projectMatch, so the drawer's filters apply to the Asked tab too.
   * Optional: an older server sends none, and the row then matches only "All".
   */
  client?: string | null;
  project?: string | null;
  projectMatch?: TodoProjectMatch;
}

/** Finished to-dos older than this many days (by `done.at`) are left out of AskedTodoList.done. */
export const ASKED_DONE_DAYS = 60;

/** `GET ROUTES.askedTodos`. */
export interface AskedTodoList {
  /** Still in `todo/`, oldest ask first. */
  waiting: AskedTodo[];
  /** Ticked within ASKED_DONE_DAYS, most recently finished first. */
  done: AskedTodo[];
  /**
   * False when the brain's git record couldn't be read (not a git folder, git missing, too slow): only
   * to-dos with a stamp are listed, so the list may be short. The drawer says so in one line.
   */
  historyRead: boolean;
}

/**
 * A finished to-do (done-todos plan 2026-11-24): a TDS one from `todo/done/`, or this person's own
 * personal one from `personal/todo/done/`. Shown read only.
 */
export interface DoneTodo {
  /**
   * `done:todo/done/<id>` or `done:personal/todo/done/<id>`. Never equal to a TodoItem.key or an
   * AskedTodo.key, so the panel, prev/next and React keys can hold every kind. Also the history key.
   */
  key: string;
  /** The file name, e.g. "20261113-send-the-quote.md". */
  id: string;
  scope: TodoScope;
  /** Brain-relative path: `todo/done/<id>` or `personal/todo/done/<id>`. */
  path: string;
  title: string;
  /** Team slug of who had it when it was ticked; null when it was open to anyone. */
  assignee: string | null;
  /** The roster's name for `assignee`, else the slug; null when `assignee` is null. */
  assigneeName: string | null;
  /** YYYY-MM-DD from frontmatter `due`, else null. */
  due: string | null;
  /** Everything below the frontmatter, trimmed. Shown read only and searched. */
  details: string;
  /**
   * Who ticked it and when: the done stamp (`completed_by`, `completed_at`/`completed`), else the git
   * commit that added it to the done folder; null when neither is known.
   */
  done: TodoActor | null;
  /** The file's fingerprint, as TodoItem.version. */
  version: string;
  /** As TodoItem.attachments. Shown read only. */
  attachments: TodoAttachment[];
  /** As TodoItem.client / project / stage / projectMatch, so the drawer's filters apply. */
  client: string | null;
  project: string | null;
  stage: string | null;
  projectMatch?: TodoProjectMatch;
}

/**
 * A teammate's open TDS to-do, shown read only (done-todos plan, decision 10): from `todo/<id>`, never personal.
 * `GET ROUTES.teamTodo?id=<id>`; 404 when it isn't in `todo/` any more.
 */
export interface TeamTodo {
  /** `team:todo/<id>`: never equal to a TodoItem.key, AskedTodo.key or DoneTodo.key. */
  key: string;
  /** The file name, e.g. "20261113-send-the-quote.md". Also its history key (TodoItem.key for TDS). */
  id: string;
  /** Brain-relative path: `todo/<id>`. */
  path: string;
  title: string;
  /** Team slug of who has it; null when it is open to anyone. */
  assignee: string | null;
  /** The roster's name for `assignee`, else the slug; null when `assignee` is null. */
  assigneeName: string | null;
  /** YYYY-MM-DD from frontmatter `due`, else null. */
  due: string | null;
  /** Everything below the frontmatter, trimmed. Shown read only. */
  details: string;
  /** The file's fingerprint, as TodoItem.version. */
  version: string;
  /** As TodoItem.attachments. Shown read only. */
  attachments: TodoAttachment[];
  client: string | null;
  project: string | null;
  stage: string | null;
  projectMatch?: TodoProjectMatch;
}

/** `GET ROUTES.doneTodos`. */
export interface DoneTodoList {
  /** Every finished to-do this person may see, most recently finished first; unknown dates last. */
  items: DoneTodo[];
  /** False when the brain's git record couldn't be read: older to-dos without a stamp have no date. */
  historyRead: boolean;
}

/**
 * One change in a to-do's life, worked out from one git commit (plus the stamps that commit added).
 * - created: the file first appears. `to` = the assignee it was created with ('open' for anyone).
 * - passed-on: `assignee:` changed. `from`/`to` = slugs, 'open' for anyone.
 * - retitled: `title:` changed. `from`/`to` = the old and new titles.
 * - due: `due:` set, changed or cleared. `from`/`to` = YYYY-MM-DD or null.
 * - details: lines below the frontmatter changed (no from/to: the wording isn't repeated).
 * - done: moved to `todo/done/`.
 * - deleted: moved to `todo/deleted/`.
 * - changed: anything else (other frontmatter lines).
 * One commit can give several events; they share `actor`.
 */
export type TodoEventKind =
  | 'created'
  | 'passed-on'
  | 'retitled'
  | 'due'
  | 'details'
  | 'done'
  | 'deleted'
  | 'changed';

export interface TodoEvent {
  kind: TodoEventKind;
  actor: TodoActor;
  from?: string | null;
  to?: string | null;
}

/** At most this many commits are read for one to-do's history. */
export const TODO_HISTORY_MAX = 40;

/** `GET ROUTES.todoHistory?key=<TodoItem.key | AskedTodo.key>`. */
export interface TodoHistoryResponse {
  /**
   * - 'ok': `events` holds the record (it can be empty for a to-do added since the last sync).
   * - 'personal': a personal to-do; it is never synced, so there is no record.
   * - 'unavailable': not a git folder, git missing or too slow.
   */
  status: 'ok' | 'personal' | 'unavailable';
  /** Newest first. */
  events: TodoEvent[];
  /** True when the record goes back further than TODO_HISTORY_MAX commits. */
  more: boolean;
}

export const TODO_TITLE_MAX = 200;
export const TODO_DETAILS_MAX = 8000;
export const TODO_ASSIGNEE_MAX = 40;
export const TODO_SCRIPT_MAX_OUTPUT_BYTES = 65_536;

/**
 * One change to a to-do, run through the brain's `todo` skill script. Field names and rules are
 * the Workbench's (`tools/members/command-centre/server.cjs`, routes `/api/todos/*`), unchanged.
 * - `add`: the app always sends `assignee` (default: the person's own `Identity.slug`), so a new
 *   to-do lands on their own list even if git's user name differs. `due` is YYYY-MM-DD or null.
 * - `edit`: replaces the title; replaces the whole details text only when `details` is sent.
 *   Omit it to leave the body alone.
 * - `assignee: null` on `assignee` makes the to-do open to anyone.
 * - `add` with `assignee: null` adds it open to anyone; only offered when TodoList.canAddOpen.
 * - `expect` (optional, on every action with an `id`): the TodoItem.version the person was looking
 *   at. The server refuses with 'changed' if the listed to-do is no longer that version, then passes it
 *   to the skill, which checks again just before writing (BCR-01). Omitted, the change runs as before.
 *   When a save sends several actions for one to-do, each one after the first carries the version from
 *   the fresh list the previous one returned (the person's own change); if the to-do is missing from
 *   that list, the save stops. A later step is never sent without `expect`.
 * A save that changes several fields sends them one at a time in this order, stopping at the first
 * failure: edit → due → assignee (passing on last, because the to-do then leaves this person's list).
 *
 * Route checks before anything runs: `id` matches `^[A-Za-z0-9][A-Za-z0-9 ._-]*\.md$` and is
 * listed for this person; title 1–TODO_TITLE_MAX characters after trimming; details at most
 * TODO_DETAILS_MAX; assignee matches `^[a-z0-9]+(-[a-z0-9]+)*$`, at most TODO_ASSIGNEE_MAX;
 * `expect` matches TODO_VERSION_PATTERN; `add` with `assignee: null` only when canAddOpen.
 */
export type TodoAction =
  /**
   * Release 3: `details` (optional, at most TODO_DETAILS_MAX) becomes the new file's body, so a to-do
   * added for someone else can carry details. Only sent when TodoList.canAttach (the script is v0.5+);
   * an older script would ignore it.
   */
  | ({
      kind: 'add';
      title: string;
      due: string | null;
      assignee: string | null;
      scope?: TodoScope;
      details?: string;
    } & TodoAddProjectFields)
  /**
   * Release 3: when TodoList.canAttach, `details` is the body WITHOUT its `## Files` section (the client
   * sends `splitTodoFiles(...).details`), TODO_DETAILS_MAX counts only that, and the server always runs the
   * script with `keep_files: true`, so the skill carries the on-disk section across (overseer B1). A
   * `details` holding a `## Files` heading is then `bad-request`. Without canAttach, unchanged.
   * `detailsOnly: true` says the browser sent the details without the section (it saw canAttach); if the
   * server can no longer keep the section, that edit is refused as `changed` instead of dropping it.
   */
  | {
      kind: 'edit';
      id: string;
      title: string;
      details?: string;
      detailsOnly?: true;
      expect?: string;
      scope?: TodoScope;
    }
  | { kind: 'due'; id: string; due: string | null; expect?: string; scope?: TodoScope }
  | { kind: 'assignee'; id: string; assignee: string | null; expect?: string; scope?: TodoScope }
  | { kind: 'delete'; id: string; expect?: string; scope?: TodoScope }
  /** v0.4: moves the file between `todo/` (tds) and `personal/todo/` (personal), bytes unchanged. */
  | ({ kind: 'move'; id: string; scope: TodoScope; to: TodoScope; expect?: string } & TodoMoveProjectFields)
  /**
   * Release 3: links a library file (brain-relative `path`) in the body's `## Files` section, or unlinks
   * it. Only when TodoList.canAttach. `attach` checks the file is a real file the library lists (not a
   * link), under `clients/<client>/`, `templates/` or `personal/`; a path already linked is a no-op;
   * more than TODO_ATTACHMENTS_MAX is `bad-request`. `detach` of a path not linked is a no-op. Neither
   * touches the file itself.
   */
  | { kind: 'attach'; id: string; path: string; expect?: string; scope?: TodoScope }
  | { kind: 'detach'; id: string; path: string; expect?: string; scope?: TodoScope }
  /** Projects R1 (decisions 5, 6): set client, project and stage together. Only when TodoList.canProject. */
  | TodoProjectAction;
/*
 * v0.4 rules for `scope` (plan 2026-11-13-todo-handover-search-scope, decisions 2 and 4):
 * - Absent means 'tds', so every v0.3 action shape is unchanged. The server matches the listed to-do
 *   by scope + id.
 * - Any action on a personal to-do (scope 'personal', or `move`, or `add` with scope 'personal') is
 *   refused `not-allowed` unless TodoList.canUsePersonal, and every one with an `id` must carry `expect`
 *   (`bad-request` otherwise).
 * - `add` with scope 'personal' needs `assignee` = the person. `assignee` on a personal to-do is refused
 *   (`bad-request`): move it to TDS first. `move` needs the to-do's assignee to be the person, both ways,
 *   and `to` different from `scope`.
 */

/** `changed`: the to-do's file changed since the person read it (`expect` didn't match). HTTP 409. */
export type TodoChangeErrorCode = 'bad-request' | 'not-found' | 'not-allowed' | 'changed' | 'internal';

/** What `BrainReaders.changeTodo` reports back: for a `move`, the to-do's key before and after. */
export interface TodoChangeOutcome {
  moved?: { from: string; to: string };
}

/** Thrown by `BrainReaders.changeTodo`. `message` is plain UK English, fit to show the user. */
export class TodoChangeError extends Error {
  readonly code: TodoChangeErrorCode;
  constructor(code: TodoChangeErrorCode, message: string) {
    super(message);
    this.name = 'TodoChangeError';
    this.code = code;
  }
}

/**
 * The script's command line (the agreement between the brain skill and the app):
 *
 *   node <brain>/.claude/skills/tdsapp-todo/scripts/tdsapp-todo.cjs <command>
 *   (before v0.3: <brain>/.claude/skills/todo/scripts/todo.cjs, the same agreement minus the v0.3 parts)
 *
 * - `<command>`: add | edit | due | assignee | delete | tick | roster | list.
 * - stdin: one JSON object, the Workbench route's request body with the same field names
 *   (`file`, `title`, `body`, `due`, `assignee`). `roster` and `list` need none (send `{}`).
 *   Every field added since is optional, so a caller that sends only the Workbench's fields gets the
 *   same result as before, apart from the fixes listed below.
 * - `delete` differs from the Workbench (BCR-05): optional `via` (the app sends "TDS Brain App"),
 *   `by`, `by_name`; moves the file to `todo/deleted/` stamped with `status: deleted`, `deleted`,
 *   `deleted_at`, `deleted_by` and `deleted_via`, answering `{ok, file, moved}`.
 * - v0.3 additions (2026-11-13), all optional:
 *   - `expect` on edit, due, assignee, delete and tick: the hex SHA-256 of the file's bytes the
 *     caller read. If the file now differs → `{"error":"changed since read","status":409}`, exit 2,
 *     nothing written (BCR-01).
 *   - `add`: `open: true` adds it with no assignee (BCR-06); `via` names the tool, written as
 *     `source: added from <via>` (BCR-13; default `added with the todo skill`). The app sends
 *     `via: "TDS Brain App"`.
 *   - `tick`: `via`, `by`, `by_name`, stamping `status: done`, `completed`, `completed_at`,
 *     `completed_by`, `completed_via` like the app's own tick (BCR-09).
 *   - `list` entries gain `version` (the fingerprint).
 * - v0.3 fixes (each refuses with 400 where the Workbench quietly accepted): over-long title (200),
 *   details (8000) or assignee (40) are refused, not cut (BCR-02); an explicit assignee must be on
 *   the team in `.team-config/roles.json` by either slug rule, unless that file is missing or empty
 *   (BCR-07); due dates must be real calendar dates (BCR-17); CLAUDE.md, README.md and AGENTS.md are
 *   refused in any letter case (BCR-12).
 * - v0.3 fixes to how files are written: titles needing quotes are quoted when that needs no escapes
 *   (BCR-03); a title change adds to `## Title history`, and updates the first `#` heading only when
 *   it matched the old title (BCR-04/16); the file's own line endings and BOM are kept (BCR-11); a new
 *   name also avoids `todo/done/` and `todo/deleted/` (BCR-14); writes go to a temporary file named
 *   `.tdsapp-todo-<pid>-<random>.tmp~` (ignored by the brain's `*~` rule) renamed or linked into place;
 *   symlinks and files without write permission are refused (BCR-15).
 * - The brain root is `process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..')`
 *   (scripts → tdsapp-todo → skills → .claude → brain).
 * - stdin is read to the end. Empty means `{}`. Invalid JSON, a non-object or an unknown command
 *   → `{"error":"invalid JSON"|"unknown command","status":400}`, exit 2.
 * - stdout: one JSON line. Exit 0: the success body, with no `status`. Exit 2: the error body plus
 *   `status` (400, 404, 409 or 500, including unterminated frontmatter and file errors). stderr is
 *   ignored. Any other exit code is a crash.
 * - Kept from the Workbench: the file regex `^[A-Za-z0-9][A-Za-z0-9 ._-]*\.md$` (spaces allowed);
 *   local-date file names; the default assignee from `git config user.name`. `list` honours
 *   `WORKBENCH_AS`; `add` does not.
 * - The app runs it with `spawn` (no shell), the real path of the script inside the brain's real
 *   path, a scrubbed environment plus `BRAIN_ROOT` (no `WORKBENCH_AS`, no `NODE_OPTIONS`), SIGKILL
 *   at TODO_SCRIPT_TIMEOUT_MS, at most TODO_SCRIPT_MAX_OUTPUT_BYTES of stdout, one run at a time.
 * - `roster` → `{"members":[{slug,name}]}`; `list` → `{"todos":[…]}` as `/api/misc-todos`.
 * - v0.4 additions (2026-11-13, plan 2026-11-13-todo-handover-search-scope, decision 2), all optional:
 *   - `capabilities` (new command, `{}` in) → `{"version":"0.4","features":[…]}`: "handover" always;
 *     "scope" only when the brain isn't a git repo or `git check-ignore -q personal/todo/x.md` passes,
 *     and `personal/todo` is not a symlink. A v0.3 script answers `unknown command` (400).
 *   - `scope: "personal"` on edit, due, delete, tick, assignee and move picks `personal/todo/` (and its
 *     done/ and deleted/); absent or "tds" = `todo/`; any other value → 400. Personal requests → 400
 *     when "scope" isn't advertised.
 *   - `add`: `scope: "personal"` writes to `personal/todo/` with assignee = the adder (`by`, else git
 *     user); `open` or another assignee → 400. Writes `created_by: <slug>` when the adder is known. An
 *     assignee other than the adder also stamps the handover. New names avoid all six folders.
 *   - `assignee`: when the value changes, writes `assigned_to` (new slug or "open"), `assigned_at`
 *     (ISO, UK offset), `assigned_by`, `assigned_from` (old slug or "open"), `assigned_via`, replacing
 *     earlier `assigned_*` lines, and appends a line to `## Handover history` at the end of the body.
 *     Unchanged → nothing written. Personal → 400.
 *   - `move` (new): `{file, scope, to, expect?, by?, by_name?, via?}` copies the bytes unchanged to the
 *     other folder (assignee must be the actor), clash → `-<n>` suffix, answers `{ok, file, moved}`
 *     with `file` = the new name.
 *   - v0.3 calls to edit, due, tick, delete, roster and list give byte-identical results.
 */
export const TODO_SCRIPT_TIMEOUT_MS = 10_000;

export interface ClientInfo {
  /** Folder name under `clients/`, e.g. "urban-cooling". */
  slug: string;
  name: string;
  /**
   * Other names and codes from `clients/map.json` ("UC", "Air Con"), for finding the client in a
   * picker; never shown. Absent when it has none, and from older servers.
   */
  aliases?: string[];
  /**
   * R2 phase 4b: the profile's `code:` (e.g. "AST"), upper-cased, when it passes CLIENT_CODE_PATTERN
   * (shared/project-refs-contract.ts); else null. Absent from older servers.
   */
  code?: string | null;
}

/**
 * `POST /api/client-guess`: which client a new chat's first message is for, worked out before the
 * chat starts (exact name match, then Jev). Text is a string of at most 100,000 characters (the chat
 * limit), else `bad-request`; only the first 4,000 are used. Empty text answers `none`.
 */
export interface ClientGuessRequest {
  text: string;
}

/**
 * - `sure`: start the chat with `client` (a slug from `Bootstrap.clients`). `how` says whether the
 *   message named it (`named`) or Jev picked it (`jev`).
 * - `none`: not client work; start with no client and ask nothing.
 * - `ask`: ask the person. `options` are the likeliest slugs, best first (0 to 3); empty when nothing
 *   could be guessed (Jev unavailable), so the person picks from the full list.
 */
export type ClientGuessResponse =
  | { kind: 'sure'; client: string; how: 'named' | 'jev' }
  | { kind: 'none' }
  | { kind: 'ask'; options: string[] };

/**
 * How a new chat's client was decided, counted by month in the app's own data folder
 * (`client-pick-tally.json`, never the brain) so we can see how often people are asked.
 * The server counts the guess itself: `named`, `jev`, `not-client`, `asked`, `asked-blank` (asked with
 * nothing to suggest). Home reports the rest with `POST ROUTES.clientPickOutcome`.
 * Known gap: a sure guess for a client added to the brain after Home loaded is counted by the server
 * and then asked by Home, so that one chat appears twice. Rare; Home's list catches up on reload.
 */
export const CLIENT_PICK_REPORTED = [
  /** The person chose a client, or No client, in the select before sending. */
  'by-hand',
  /** The chat arrived with its client set (a to-do, or a client found in search). */
  'preset',
  /** The question was answered with one of its suggestions. */
  'ask-suggested',
  /** The question was answered with another client from the full list. */
  'ask-other',
  /** The question was answered with No client. */
  'ask-no-client',
  /** The question was cancelled, or left by opening something else. */
  'ask-cancelled',
  /** A skill sent on its own with Client on Auto: no client, nothing guessed. */
  'skill-only',
] as const;
export type ClientPickReported = (typeof CLIENT_PICK_REPORTED)[number];
export type ClientPickOutcome = ClientPickReported | 'named' | 'jev' | 'not-client' | 'asked' | 'asked-blank';

/** `POST ROUTES.clientPickOutcome`: answered with `{}`. Anything else in `outcome` is `bad-request`. */
export interface ClientPickOutcomeRequest {
  outcome: ClientPickReported;
}

export interface UsedSkill {
  name: string;
  count: number;
  /** ISO timestamp of the most recent use. */
  lastUsed: string;
}

export type BrainArea = 'skills' | 'todos' | 'clients' | 'identity' | 'usage' | 'library';

export interface BrainHealth {
  ok: boolean;
  path: string;
  /** Plain UK-English sentences fit to show the user. Empty when ok. */
  problems: string[];
}

/**
 * When the brain last synced with GitHub. The desktop sync app runs `git fetch` about once a
 * minute, and git rewrites `.git/FETCH_HEAD` on every fetch, even when nothing new came down,
 * so that file's modified time is the last sync.
 */
export interface SyncStatus {
  /** ISO timestamp, or null when the brain has never fetched or is not a git folder. */
  lastSync: string | null;
}

/** Older than this, the rail shows the last sync in red. */
export const SYNC_STALE_MS = 5 * 60_000;
/** How often the page asks for the last sync time. */
export const SYNC_POLL_MS = 30_000;

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
  /** Their row in `context/team-profile.md`; empty fields when there is none. */
  profile(identity: Identity): Promise<MemberProfile>;
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
  /**
   * The one direct write: moves `todo/<id>` to `todo/done/<id>` and records in the file who ticked it
   * (`by`), the UK date and time, and that it was ticked in this app. Rejects unknown ids.
   */
  completeTodo(id: string, by: Identity): Promise<void>;
  /**
   * Runs the brain's `todo` skill script for one change (see TodoAction and the command line above
   * TODO_SCRIPT_TIMEOUT_MS). The app writes nothing itself. Refuses with TodoChangeError
   * `not-allowed` unless `todos(identity).changes` is 'on' (before the switch), and `not-found`
   * for an `id` that is not listed for this person (theirs or open). Script status 400 →
   * `bad-request`, 404 → `not-found`, anything else or a crash/timeout → `internal`.
   */
  changeTodo(action: TodoAction, identity: Identity): Promise<TodoChangeOutcome>;
  /**
   * v0.4: ticks a personal to-do (`personal/todo/<id>`) through the brain script's `tick` with
   * `scope: "personal"`. Same refusals as `changeTodo`; `not-allowed` unless `canUsePersonal`.
   */
  completePersonalTodo(id: string, expect: string, by: Identity): Promise<void>;
  /**
   * TDS to-dos this person passed on that someone else has or has finished (plan
   * 2026-11-16-asked-of-others). Reads `todo/`, `todo/done/` and the brain's git record; writes nothing.
   */
  askedTodos(identity: Identity): Promise<AskedTodoList>;
  /**
   * Release 3: files a staged upload (its real path, from the upload staging) into the library through
   * `tdsapp-files add`, then `attach`es it to the to-do. Same refusals as changeTodo, plus `not-allowed`
   * unless canUpload and `bad-request` for a type not in TODO_UPLOAD_TYPES. Returns the saved path.
   * If `attach` fails after `add` worked, the file stays in the library and the error says so.
   */
  uploadTodoFile(
    req: { stagedPath: string; name: string; id: string; scope: TodoScope; expect: string },
    identity: Identity,
  ): Promise<{ path: string; personal: boolean }>;
  /**
   * The record of one to-do, by TodoItem.key or AskedTodo.key. Throws TodoChangeError `bad-request` for
   * a key of the wrong shape and `not-found` when no such file exists. Never throws for git trouble:
   * that is `status: 'unavailable'`.
   */
  todoHistory(key: string, identity: Identity): Promise<TodoHistoryResponse>;
  /** Folders in `clients/`, skipping names that start with `_` or `.`. */
  clients(): Promise<ClientInfo[]>;
  /**
   * From `z-logs/team-usage/<slug>.jsonl`. Counts three line shapes: `{event:"skill",name}`,
   * `{event:"command",name:"/x"}` (strip the slash) and `{skill, ts}` with no event. Keeps only
   * names that `skills(identity)` lists. Defaults: 30 days, top 6.
   */
  usedOften(identity: Identity, opts?: { days?: number; limit?: number }): Promise<UsedSkill[]>;
  /** Whose files can be shown: the person's own `personal/` folder first, then each client. */
  libraryScopes(): Promise<LibraryScope[]>;
  /** Every image and document in one scope, or null when the scope is not one `libraryScopes` lists. */
  library(scope: string): Promise<LibraryListing | null>;
  /**
   * The file behind an id from `library`, for the routes that serve a picture, text or a page.
   * Null when the id is unknown, the file has gone, or it no longer resolves to a real file inside
   * the brain that the rules allow. The browser never sends a path, only ids.
   */
  libraryFile(id: string): Promise<LibraryFile | null>;
  /**
   * Global search over every scope `libraryScopes` lists (see LibrarySearchResponse). Optional so
   * older test fakes still satisfy the type; the route answers an empty reply when it is missing.
   */
  librarySearch?(q: string, kind: LibraryKind): Promise<LibrarySearchResponse>;
  /**
   * The listed scope a path from the brain's root falls in, with the key the file has (or would
   * have) there and the item when it is listed now (chat files, plan 2026-11-13-chat-files).
   * Null when the path is in no listed scope, or the library rules never list it. Optional so older
   * test fakes still satisfy the type; without it a chat reports no files.
   */
  libraryItemForPath?(
    rel: string,
  ): Promise<{ key: string; scope: LibraryScope; item: LibraryItem | null } | null>;
  /**
   * Deletes one library file through the brain's `tdsapp-files` script (plan
   * 2026-11-15-delete-library-files): moves it to the holding folder and logs it. Throws a
   * `FilesChangeError` (shared/files-contract.ts). Optional so older test fakes still satisfy the
   * type; the route answers 404 `not-found` when it is missing.
   */
  deleteLibraryFile?(id: string, opts: { expect?: string }): Promise<void>;
  /**
   * Projects R1 (plan 2026-11-20-projects-system, decisions 10, 7, 13). Optional so older test fakes
   * still satisfy the type; the routes answer 404 `not-found` when missing. All throw ProjectsError
   * (shared/projects-contract.ts) with a plain UK-English message.
   */
  projects?(identity: Identity): Promise<ProjectList>;
  /**
   * Projects R2 phase 1: the projects index (every card, and a key lookup that follows moved keys), so the session
   * manager can check a chat's project and find its folder. Optional so older test fakes still satisfy the type.
   */
  projectsIndex?(): Promise<{ cards: ProjectCard[]; byKey(key: ProjectKey): ProjectCard | null }>;
  /**
   * `file` (an `update`: the new entry's path) and `updatesFailed` (an `edit` whose card change was saved but an
   * automatic log entry wasn't) ride beside the list (Projects R2 phase 2).
   */
  changeProject?(
    action: ProjectAction,
    identity: Identity,
  ): Promise<ProjectList & { file?: string; updatesFailed?: true }>;
  /**
   * Move plan (2026-11-21-project-move): a check (`check: true`) or a move. `todos: false` leaves the
   * to-dos as they are (they still resolve through the old key).
   */
  moveProject?(
    req: ProjectMoveRequest,
    identity: Identity,
    opts?: { todos?: boolean },
  ): Promise<ProjectMoveCheckResponse | ProjectMoveResult>;
  /** Archive plan: archive, unarchive or delete a project (with `check`, the panel's facts). */
  removeProject?(
    req: ProjectRemoveRequest,
    identity: Identity,
    opts?: { todos?: boolean },
  ): Promise<ProjectRemoveCheckResponse | ProjectRemoveResult>;
  projectFiles?(key: ProjectKey, kind: LibraryKind, identity: Identity): Promise<ProjectFilesResponse>;
  projectTodos?(key: ProjectKey, identity: Identity): Promise<ProjectTodosResponse>;
  /** Projects R2 phase 2: a project's updates log (`before` is the last entry of the page before). */
  projectUpdates?(
    key: ProjectKey,
    before: string | null,
    identity: Identity,
  ): Promise<ProjectUpdatesResponse>;
  tidy?(identity: Identity): Promise<TidyList>;
  applyTidy?(apply: TidyApply, identity: Identity): Promise<TidyList>;
  /** Runs the script's `purge` (30-day clean-up). Resolves to the number erased; never throws (0 on any failure). */
  purgeDeletedFiles?(): Promise<number>;
  /** When the brain last synced (see SyncStatus). Never throws. */
  sync(): Promise<SyncStatus>;
  /** Calls back (debounced) when an area changes on disk. Returns a function that stops watching. */
  watch(onChange: (area: BrainArea) => void): () => void;
}

// ---------------------------------------------------------------------------
// The library: images and documents found in the brain (read-only)
// ---------------------------------------------------------------------------

export type LibraryKind = 'image' | 'document';

/** What sort of document, from its extension: pdf | doc (md, txt, docx, html) | sheet (csv, xlsx) | deck (pptx). */
export type DocFormat = 'pdf' | 'doc' | 'sheet' | 'deck';

/**
 * How the app can open the file itself, or null when it can only be listed:
 * 'image' (a large re-encoded picture), 'text' (Markdown or plain text), 'page' (HTML, sandboxed) or
 * 'pdf' (the browser's own PDF reader, in a frame).
 */
export type LibraryView = 'image' | 'text' | 'page' | 'pdf';

export interface LibraryScope {
  /** `personal`, `client:<slug>`, or `shared:<name>` for an agency folder (today only `shared:templates`). */
  id: string;
  /** "My personal files", the client's name, or the agency folder's ("Templates"). */
  name: string;
  kind: 'personal' | 'client' | 'shared';
}

export interface LibraryItem {
  /**
   * Stable for a path, and the only thing the browser sends back. Made as `<scope id>.<hash of the
   * path>`, so the server can find the file again after a restart by re-listing that one scope. The
   * client treats it as opaque and never takes it apart.
   */
  id: string;
  kind: LibraryKind;
  /** Null for an image. */
  format: DocFormat | null;
  /** Lower case, no dot: "png", "md". */
  ext: string;
  /**
   * The card it is shown in. In a client's area, from the rules ("Reports", "Brand"); a file no rule
   * matches takes its first folder's name, tidied up; a file loose in the scope's root goes in "Other",
   * except in an agency folder, where loose files go in a first card named after it ("Templates").
   */
  group: string;
  /** The file's name. */
  name: string;
  /** For people: a Markdown file's first heading when it has one, else the file name tidied up. */
  title: string;
  /** From the brain's root, forward slashes: "clients/acme-heating/reports/x.pdf". Shown and copied; never sent back. */
  path: string;
  bytes: number;
  /** ISO time the file last changed. */
  modified: string;
  /** Pixels, for an image whose size could be read. */
  width: number | null;
  height: number | null;
  /**
   * True when `GET /api/library/thumb/<id>` can try to make a picture of it. An image: always, up to
   * the 50 MB cap (1 MB for an SVG). A document: only a PDF, Word, Excel or PowerPoint file, up to
   * 50 MB (never a web page: Quick Look would draw local files into it), and only on a Mac, where Quick Look draws its first page (at width 320 only). False:
   * show the standard tile. A true can still fail (a broken file): the route answers 404 and the
   * screen falls back to the tile.
   */
  thumb: boolean;
  /**
   * Null when the app cannot open it, or an HTML page is over 5 MB. Text over 1 MB still opens: the
   * text route sends the first 1 MB, marked `truncated`.
   */
  view: LibraryView | null;
  /**
   * `versionOf(bytes, mtimeMs)`, sent back as `expect` on a delete so a file changed since it was
   * listed is refused (plan 2026-11-15-delete-library-files). Optional: older servers don't send it.
   */
  version?: string;
  /**
   * True when this person may delete it from the app: the `tdsapp-files` skill reports
   * `FILES_CAPABILITY`, the scope and role allow it, git doesn't ignore the file and it isn't a
   * protected name. The script checks all of this again. Missing or false: no bin.
   */
  canDelete?: boolean;
  /**
   * Projects R1 (decision 7, LibraryProjectFields): keys of every project this file belongs to, by
   * folder or by link. Filled when serving, never cached with the item. Absent from older servers = [].
   */
  projects?: ProjectKey[];
  /**
   * Claude artifacts in projects (decision 4): set on an `.html`/`.htm` file whose head carries a valid
   * `tds-artifact-source` tag. Absent, never null, otherwise and from older servers.
   */
  artifact?: ArtifactSource;
}

export interface LibraryListing {
  scope: string;
  /**
   * The cards to show, in order, and only those that have items: the rules' cards in the rules'
   * order, then cards named after a folder A to Z, then "Other". In `personal` every card is named
   * after a folder, so A to Z with "Other" last.
   */
  groups: string[];
  items: LibraryItem[];
  /** True when the scope held more files than the cap and the rest were left out. */
  truncated: boolean;
}

/** Server only: where an item's file really is. */
export interface LibraryFile {
  item: LibraryItem;
  /** Absolute, already checked to be a real file inside the brain. */
  absPath: string;
  /** Changes whenever the file's size or time changes; keys the picture cache. */
  version: string;
}

/** The picture widths the server will make. Anything else is refused. */
export const THUMB_WIDTHS = [96, 320, 1600] as const;
export type ThumbWidth = (typeof THUMB_WIDTHS)[number];

/** `POST /api/library/items`. */
export interface LibraryItemsResponse {
  files: { item: LibraryItem; scope: LibraryScope }[];
}

/** `GET /api/library/text/<id>`. */
export interface LibraryText {
  /** The file's text with any YAML frontmatter block at the top removed. */
  text: string;
  /** True when the file was longer than the cap and was cut. */
  truncated: boolean;
}

/**
 * Server only: makes and caches small pictures in the app's data folder, never in the brain.
 * Resolves to the cached file's absolute path (always WebP), or null when no picture can be made;
 * a failure is remembered for that `version` so it is not retried until the file changes.
 *
 * The source is read into memory and handed to the image library as bytes, never as a path: an SVG
 * opened by path can pull in neighbouring files, and from bytes it cannot. The picture fits inside
 * `width` wide and 16,000 high, is turned the right way up, and is refused over a pixel limit or a
 * time limit.
 */
export interface Thumbnailer {
  get(file: LibraryFile, width: ThumbWidth): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// The app's own notes (kept in the app's data folder, never in the brain)
// ---------------------------------------------------------------------------

/** Every Home item a person can hide, in the default order. The client ignores ids it doesn't know. */
export const HOME_ITEM_IDS = [
  'start-my-day',
  'whats-new',
  'meetings',
  'ads',
  'todos',
  'projects',
  'chats',
  'files',
  'skills',
] as const;
export type HomeItemId = (typeof HOME_ITEM_IDS)[number];

/** The server checks hidden ids by pattern only, so an id from a newer app survives an older server's clean. */
export const HOME_ITEM_ID_PATTERN = /^[a-z0-9-]{1,40}$/; // same as SECTION_ID_PATTERN
export const HOME_HIDDEN_MAX = 40;
export const HOME_SHORTCUTS_MAX = 6;
/** A skill's name, as the server checks it for pins and Home shortcuts. */
export const SKILL_NAME_PATTERN = /^[A-Za-z0-9][\w.:-]{0,127}$/;

/** Places a Home shortcut can open (the rail's apps; plan 2026-11-25-home-shortcuts-places). Never Settings. */
export const HOME_SHORTCUT_PLACES = ['projects', 'images', 'documents'] as const; // rail order
export type HomeShortcutPlace = (typeof HOME_SHORTCUT_PLACES)[number];
/** Drawers a Home shortcut can open: the ones everyone has (Skills is for owners and scouts only). */
export const HOME_SHORTCUT_DRAWERS = ['chats', 'todos'] as const; // rail order
export type HomeShortcutDrawer = (typeof HOME_SHORTCUT_DRAWERS)[number];

/**
 * A skill, a tool, a place or a drawer. A newer app may add kinds; an older app drops kinds it doesn't know when it
 * cleans its settings (so a downgrade forgets them), and the server only ever talks to the client it serves.
 */
export type HomeShortcut =
  | { kind: 'skill'; name: string } // name matches SKILL_NAME_PATTERN
  | { kind: 'tool'; section: string; tool: string } // both match SECTION_ID_PATTERN
  | { kind: 'place'; place: HomeShortcutPlace }
  | { kind: 'drawer'; drawer: HomeShortcutDrawer };

/**
 * Same shortcut twice = same key. Used for de-duplication on both sides, e.g. 'skill:gm', 'tool:workbench/ads',
 * 'place:projects', 'drawer:todos'.
 */
export function homeShortcutKey(s: HomeShortcut): string {
  switch (s.kind) {
    case 'skill':
      return `skill:${s.name}`;
    case 'tool':
      return `tool:${s.section}/${s.tool}`;
    case 'place':
      return `place:${s.place}`;
    case 'drawer':
      return `drawer:${s.drawer}`;
  }
}

/**
 * One Home shortcut rebuilt from known fields only, or undefined when it isn't one. Both the save check (routes) and
 * the clean on read (app store) use this, so they can't drift apart.
 */
export function parseHomeShortcut(v: unknown): HomeShortcut | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const id = (x: unknown): x is string => typeof x === 'string' && SECTION_ID_PATTERN.test(x);
  switch (o.kind) {
    case 'skill':
      return typeof o.name === 'string' && SKILL_NAME_PATTERN.test(o.name)
        ? { kind: 'skill', name: o.name }
        : undefined;
    case 'tool':
      return id(o.section) && id(o.tool) ? { kind: 'tool', section: o.section, tool: o.tool } : undefined;
    case 'place':
      return (HOME_SHORTCUT_PLACES as readonly unknown[]).includes(o.place)
        ? { kind: 'place', place: o.place as HomeShortcutPlace }
        : undefined;
    case 'drawer':
      return (HOME_SHORTCUT_DRAWERS as readonly unknown[]).includes(o.drawer)
        ? { kind: 'drawer', drawer: o.drawer as HomeShortcutDrawer }
        : undefined;
    default:
      return undefined;
  }
}

export interface AppPrefs {
  /** Favourite skills' names, in the order the person starred them (still called `pins`, so older versions agree). */
  pins: string[];
  lastClient: string | null;
  todoPanelOpen: boolean;
  /**
   * Off by default while the app is in testing. Shown in Settings as "Let the app change to-dos".
   * When off, the app makes NO change to to-dos: `POST /api/todos/complete` and
   * `POST /api/todos/change` are refused with `not-allowed`, and the page shows to-dos without tick
   * boxes, the add button or the edit controls. (Claude can still change brain files in a chat, with approval, exactly
   * as it can in the terminal.)
   */
  directWrites: boolean;
  /**
   * "New to you" seen markers: TodoItem.key → the `handover.at` the person has seen. Entries whose
   * marker is more than 7 days old are dropped on every write; at most TODO_SEEN_MAX entries
   * (a patch with more is refused). Keys at most 300 characters, markers at most 40.
   */
  todoSeen: Record<string, string>;
  /**
   * The model chats use: an alias such as 'opus' or a full id, at most MODEL_PREF_MAX characters
   * and matching MODEL_PREF_PATTERN. null (the default, and what older prefs files read as) means
   * "Same as Claude Code": the app passes no model, exactly as before this setting existed.
   * Shown in Settings as "Model".
   */
  model: string | null;
  /** The effort chats use. null (the default) means "Same as Claude Code". Shown in Settings as "Effort". */
  effort: EffortLevel | null;
  /**
   * 'auto' (the default): the app picks each chat's level (plan 2026-11-14-skill-levels-and-helpers,
   * decision 2). 'manual': `model` and `effort` above, as in v0.19.0. A prefs file without it reads
   * as 'manual' when `model` or `effort` is set, else 'auto'. Shown in Settings as "Automatic" /
   * "Choose myself".
   */
  levelMode: LevelMode;
  /**
   * Favourite chats (plan 2026-11-14-chat-favourites): `sdkSessionId`s (UUIDs) in the order they were starred,
   * at most FAVOURITE_CHATS_MAX. Shown first in the Chats drawer. This server always sends it; optional because
   * an older server sends none, which reads as [].
   */
  favouriteChats?: string[];
  /**
   * Favourite to-dos (plan 2026-11-14-todo-favourites): `TodoItem.key`s in the order they were starred, at most
   * FAVOURITE_TODOS_MAX, each at most TODO_KEY_MAX characters. Shown first in the To-dos drawer. Kept only here,
   * never in a to-do file. This server always sends it; optional because an older server sends none, which reads as [].
   */
  favouriteTodos?: string[];
  /**
   * Starred files (plan 2026-11-15-home-pinned-cards): `LibraryItem.id`s in the order they were starred, at most
   * FAVOURITE_FILES_MAX, each at most FILE_ID_MAX characters. Shown on Home as "Favourite files". An id is stable for a
   * path, so a pin follows the file across re-listings. Kept only here, never in the brain. This server always
   * sends it; optional because an older server sends none, which reads as [].
   */
  favouriteFiles?: string[];
  /**
   * Hidden Home items (plan 2026-11-25-home-card-library): ids matching HOME_ITEM_ID_PATTERN, at most HOME_HIDDEN_MAX,
   * no repeats. An id the app doesn't know is kept, so one from a newer app survives. Kept only here, never in the
   * brain. This server always sends it; optional because an older server sends none, which reads as [].
   */
  homeHidden?: string[];
  /**
   * Home shortcut buttons (plan 2026-11-25-home-card-library): in the order added, at most HOME_SHORTCUTS_MAX, no
   * repeats by homeShortcutKey. Skills, tools, places and drawers (plan 2026-11-25-home-shortcuts-places); an unknown
   * kind is dropped on clean. Start my day is not stored
   * here. This server always sends it; optional because an older server sends none, which reads as [].
   */
  homeShortcuts?: HomeShortcut[];
  /**
   * The first-run tour (plan 2026-11-15-cortex-help-phase-3): the TOUR_VERSION last finished or skipped, or null
   * (never). A whole number from 1. Optional because an older server sends none, which reads as null.
   */
  tourSeen?: number | null;
  /**
   * What's new (plan 2026-11-15-cortex-help-phase-3): the newest note version the person has dismissed, as
   * "major.minor.patch", or null (none). Optional because an older server sends none, which reads as null.
   */
  whatsNewSeen?: string | null;
  /**
   * Sections (plan 2026-11-16-workbench-ad-manager, decision 5): section id → the tool last opened in it. Ids match
   * SECTION_ID_PATTERN; at most SECTIONS_MAX entries. Optional because an older server sends none, which reads as {}.
   */
  lastTool?: Record<string, string>;
  /** Ad Manager's last account key (decision 21), at most ADS_PREF_KEY_MAX characters, or null. Older servers send none. */
  adsAccount?: string | null;
  /**
   * Ad Manager folds the person changed (decision 21): `<client>:<open|recent>` → open. At most ADS_FOLDS_MAX entries;
   * keys at most ADS_PREF_KEY_MAX characters. Older servers send none, which reads as {} (the defaults: open shown,
   * recent shut).
   */
  adsFolds?: Record<string, boolean>;
  /**
   * Folded group names per section id in the section drawer, e.g. `{ workbench: ['Ads'] }` (plan
   * 2026-11-19-ads-workbench-sections, decision 1). Optional: older settings files still load.
   */
  foldedGroups?: Record<string, string[]>;
}

/** Section and tool ids in prefs: lowercase letters, digits and hyphens. */
export const SECTION_ID_PATTERN = /^[a-z0-9-]{1,40}$/;
export const SECTIONS_MAX = 20;
export const ADS_PREF_KEY_MAX = 120;
export const ADS_FOLDS_MAX = 400;

/** "major.minor.patch", as app versions and What's new notes are named. */
export const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;

export const FAVOURITE_CHATS_MAX = 200;
export const FAVOURITE_TODOS_MAX = 200;
export const FAVOURITE_FILES_MAX = 100;
/** The longest library id the app accepts (the server's own limit on an id). */
export const FILE_ID_MAX = 400;
/** The longest `TodoItem.key` the app's prefs keep (favourites and "New to you" markers). */
export const TODO_KEY_MAX = 300;
/** Claude Code's session ids, which favourite chats are keyed by. */
export const SESSION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MODEL_PREF_MAX = 100;
/** A model alias or id: letters, digits and . _ : - [ ] only (e.g. 'opus', 'claude-opus-5-5[1m]'). */
export const MODEL_PREF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/;

export const TODO_SEEN_MAX = 500;
/** A handover counts as "New to you" for this long. */
export const TODO_NEW_DAYS = 7;

export const DEFAULT_PREFS: AppPrefs = {
  pins: [],
  lastClient: null,
  todoPanelOpen: true,
  directWrites: false,
  todoSeen: {},
  model: null,
  effort: null,
  levelMode: 'auto',
  favouriteChats: [],
  favouriteTodos: [],
  favouriteFiles: [],
  homeHidden: [],
  homeShortcuts: [],
  tourSeen: null,
  whatsNewSeen: null,
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

/** How much thinking Claude puts in, as Claude Code applies it for the chat's next message. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** One model the person can pick in Settings. */
export interface ModelChoice {
  /** What is saved in `AppPrefs.model` and passed to Claude Code, e.g. 'opus'. */
  value: string;
  /** Shown in the list, e.g. 'Opus 5.5'. */
  label: string;
  /** Effort levels this model takes; null when not known. */
  efforts: EffortLevel[] | null;
}

/**
 * `GET /api/engine/choices`: what Settings offers for Model and Effort.
 * - `models`: from Claude Code's own model list, read from the most recent chat engine (cached in
 *   memory); before any chat has started this session, a fixed fallback list (Opus, Sonnet, Haiku).
 *   The saved `AppPrefs.model` is always in the list, even if Claude Code no longer offers it.
 * - `claudeCode.model`: what "Same as Claude Code" means for Model right now: top-level `model`
 *   read from ~/.claude/settings.json, then the brain's .claude/settings.json, then its
 *   settings.local.json (last file that sets it wins). null when no file sets it. There is no
 *   effort counterpart: Claude Code resolves effort per model (`modelSettings`), so the app never
 *   names it.
 */
export interface EngineChoices {
  models: ModelChoice[];
  claudeCode: { model: string | null };
}

/** The model and effort the app asks Claude Code for. null for either = "Same as Claude Code". */
export interface EngineChoice {
  model: string | null;
  effort: EffortLevel | null;
}

export interface EngineHealth {
  ok: boolean;
  /** The mode the next chat will start in. Read afresh for each new chat. */
  permissionMode: AppPermissionMode;
  /** Where the installed `claude` command was found, or null. */
  claudePath: string | null;
  /** A plain sentence when not ok, e.g. "Claude Code is not installed on this computer." */
  problem: string | null;
}

/**
 * The three things a person needs to tell apart at a glance, and the colours for them. These match
 * Ian's attention-bar mod for the terminal: green = ready for you, red = working, amber = needs
 * your answer (an approval or a question). Always shown with the words, never colour alone.
 */
export type Attention = 'ready' | 'working' | 'asking';

/** `error` and `closed` have no attention colour: they are shown as a plain stopped message. */
export function attentionFor(state: SessionState): Attention | null {
  switch (state) {
    case 'idle':
      return 'ready';
    case 'starting':
    case 'working':
      return 'working';
    case 'waiting':
      return 'asking';
    default:
      return null;
  }
}

export const ATTENTION_LABEL: Record<Attention, string> = {
  ready: 'Ready for you',
  working: 'Working',
  asking: 'Needs your answer',
};

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
  /**
   * The project this chat is for (Projects R2 phase 1, shared/chat-places-contract.ts), or null. Fixed when
   * the chat is created, and kept for a chat reopened from History. Absent from older servers: treat as null.
   */
  project?: ProjectKey | null;
  /**
   * The to-do this chat was started on (a `TodoItem.id`), or null. Fixed when the chat is created.
   * Kept only while the chat is open: a chat reopened from History has null.
   */
  todoId: string | null;
  /**
   * Work (TDS) or personal. Worked out when the chat is created (a chat on a personal to-do is
   * 'personal'; a reopened chat keeps what was saved for it; anything else is 'tds') and changed with
   * `ROUTES.sessionKind`. The app saves it in its own data folder, keyed by `sdkSessionId`.
   */
  kind: ChatKind;
  state: SessionState;
  startedAt: string;
  lastActivityAt: string;
  /**
   * The helpers this chat's current or last reply started (plan 2026-11-14-helpers-in-chats-drawer),
   * in start order (oldest first). Cleared when the next message is sent. Absent from older servers; treat as [].
   */
  helpers?: LiveHelper[];
  /**
   * How this chat's latest reply ended (plan 2026-11-19-ads-workbench-sections, decision 9): 'ok', 'stopped' (the
   * person stopped it) or 'failed'. Absent until a reply has ended, and from older servers: then treat as unknown.
   */
  lastTurn?: 'ok' | 'stopped' | 'failed';
}

/** 'stopped': the reply ended or the chat closed before the helper reported back. */
export type LiveHelperStatus = 'working' | 'done' | 'failed' | 'stopped';

/** One helper in `LiveSession.helpers`. Only the main chat's helpers, never a helper's own helpers. */
export interface LiveHelper {
  /** The Agent / Task step's tool use id. */
  id: string;
  /** "Scout", "Worker", "Expert", "Helper (Explore)" or "Helper". UK English, ready to show. */
  name: string;
  /** What it was asked, one line, at most 120 characters. Empty when unknown. */
  brief: string;
  /** The app level it runs at, when known. */
  tier: LevelTier | null;
  /** The model alias or id it runs on ("haiku", "claude-opus-5-5"), when known. */
  model: string | null;
  status: LiveHelperStatus;
  startedAt: string;
  /** Null while working. */
  endedAt: string | null;
  /** Tool steps it has taken so far. */
  steps: number;
  /** What it is doing now, plain words ("reading files"), or null. */
  lastStep: string | null;
}

/** A chat's kind: the same two values as a to-do's scope, so both lists filter the same way. */
export type ChatKind = TodoScope;

export interface PastSession {
  sdkSessionId: string;
  title: string;
  lastModified: string;
  /** What the app saved for this chat; 'tds' when nothing was saved. */
  kind: ChatKind;
  /** The client saved for this chat (chat-places.json), or null. Absent from older servers: unknown. */
  client?: string | null;
  /** The project saved for this chat, as saved (it may since have moved), or null. Absent: unknown. */
  project?: ProjectKey | null;
}

/**
 * `POST ROUTES.sessionKind(id)` body. Reply 200 `{ session: LiveSession }`. A `kind` other than 'tds' or
 * 'personal' is 400 `bad-request`; an unknown chat 404 `not-found`; a closing chat `session-closed`.
 */
export interface SetChatKindRequest {
  kind: ChatKind;
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
 * One line of a proposed file change on an approval card. `gap` stands for that many unchanged
 * lines left out between the lines that matter; it is always shown, never silently dropped.
 * `cut` marks where the server stopped because the change was too long to show: everything after
 * it in that part (and every later part) is not shown, and the card's `warning` says so too.
 * Hidden characters that could change how text looks arrive already made visible, as `⟨U+202E⟩`.
 */
export type ChangeLine =
  | { kind: 'same' | 'removed' | 'added'; text: string }
  | { kind: 'gap'; count: number }
  | { kind: 'cut' };

/** One replaced passage: an Edit has one; a MultiEdit has one per edit; a Write has one. */
export interface ChangePart {
  /** True when Claude asked to change every match in the file, not just the first. */
  everyMatch: boolean;
  lines: ChangeLine[];
}

/**
 * What a Write or Edit will do to the file, worked out by the server from what Claude sent.
 * `edit`: passages are replaced. `new-file`: the file does not exist yet. `replace-file`: the
 * existing file's whole contents are replaced (its current contents are not read or shown).
 */
export interface ProposedChange {
  kind: 'edit' | 'new-file' | 'replace-file';
  parts: ChangePart[];
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
  /**
   * The model and effort Claude Code will use for the chat's next message, after its settings,
   * environment, organisation caps and model support are applied. Sent when the engine can say and
   * whenever either changes. `effort` is null when no effort level applies (or it is not known).
   */
  | { type: 'engine-settings'; model: string | null; effort: EffortLevel | null }
  /**
   * `text` never includes the app's attachment note, and `attachments` never carries a path. On
   * history replay the note is recognised and turned back into `attachments`.
   */
  | { type: 'user-message'; messageId: string; text: string; attachments?: AttachmentInfo[] }
  /** A piece of a reply as it is typed. Append to the block with this id. One id per text block. */
  | { type: 'assistant-delta'; messageId: string; text: string; parentToolUseId: string | null }
  /** The finished text for that block. Replaces whatever the deltas built. Also used to replay history. */
  | { type: 'assistant-message'; messageId: string; text: string; parentToolUseId: string | null }
  | { type: 'tool-start'; toolUseId: string; tool: string; label: string; parentToolUseId: string | null }
  | { type: 'tool-end'; toolUseId: string; ok: boolean }
  /**
   * A background helper's report, handed back to Claude when it finished (as markdown). `name` is
   * the description of the step that started it, or null when it is not known. Sent only on streams
   * opened with `files=1`, like `files`: those pages ignore events they do not know.
   */
  | { type: 'helper-report'; messageId: string; name: string | null; text: string }
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
      /**
       * For Write, Edit and MultiEdit: the lines Claude wants to remove and add, shown as plain
       * text below the detail. Absent for other tools (and from older servers), so a client must
       * treat it as optional. If it had to be cut short, `warning` says so.
       */
      change?: ProposedChange;
      /**
       * Set when the call merges or pushes (plan 2026-11-25-app-change-guards): the page shows the
       * merge-and-push card. `sessionAllowLabel` is then always null. Older pages ignore it.
       */
      publish?: PublishFacts;
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
  | {
      type: 'notice';
      level: 'info' | 'warning' | 'error';
      text: string;
      /**
       * A hook in Claude Code dropped the person's last message before Claude saw it (the cache-tax mod does this
       * once when a chat's cache has gone cold). The page offers Send again (`ROUTES.sessionResend`). Absent
       * otherwise; an older page ignores it and shows the text.
       */
      resend?: true;
    }
  /**
   * Context management (plan 2026-11-14-context-management, decisions 1–7). Sent only on streams
   * opened with `context=1` (see `ROUTES.stream`), for the same reason as `files`. The server keeps
   * the newest `context` and every `compaction` `done` in its replay log.
   */
  | CompactionEvent
  | ContextEvent
  /**
   * Everything this chat has used or produced so far (plan 2026-11-13-chat-files). A whole snapshot
   * each time, never a delta: the newest one replaces any before it, and the server keeps only the
   * newest in its replay log. Sent only on streams opened with `files=1` (see `ROUTES.stream`):
   * an older page's reducer would reset the chat on an event it does not know.
   */
  | ({ type: 'files' } & ChatFilesSnapshot)
  /**
   * The level the chat's next (or current) reply runs at, and why (plan
   * 2026-11-14-skill-levels-and-helpers, decision 7). Sent whenever it changes. Only on streams opened
   * with `levels=1` (see `ROUTES.stream`), for the same reason as `files`; the server keeps only the
   * newest in its replay log.
   */
  | {
      type: 'level';
      level: TurnLevel;
      /**
       * Set once, right after Claude ran a skill that has no team level and no own setting, so Owners
       * and scouts can be offered "Set a team level for /x?" (decision 7). The client shows the offer
       * only when `SkillLevels.canSet`.
       */
      unlevelledSkill?: string;
    };

// ---------------------------------------------------------------------------
// Chat files: the documents, attachments and web links of one chat (plan 2026-11-13-chat-files)
// ---------------------------------------------------------------------------

/**
 * What happened to a file in this chat. `created`: written by a Write with no earlier Read of that
 * path in the chat (Claude Code refuses to overwrite a file it has not read, so that means new).
 * `changed`: any later Write, or an Edit / MultiEdit / NotebookEdit. `read`: a Read. `mentioned`: its
 * path appears in a finished reply. `filed`: an attachment of this chat was copied or moved here.
 * Only steps that finished ok count for `created`, `changed` and `read`.
 */
export type ChatFileAction = 'created' | 'changed' | 'read' | 'mentioned' | 'filed';

/** The screen's groups, in order. Worked out on the client by `chatFileGroup`. */
export type ChatFileGroup = 'made' | 'attached' | 'mentioned' | 'looked-at';

export interface ChatFile {
  /**
   * Stable for the path: the library id the file has (or would have) in its scope, so it equals
   * `item.id` whenever `item` is set. Opaque; the only thing the browser sends back.
   */
  key: string;
  /** From the brain's root, forward slashes. Shown and matched against reply text; never sent back. */
  path: string;
  /** The file as the library lists it now, or null when it is gone or no longer listed ("No longer there"). */
  item: LibraryItem | null;
  /** The scope it is in (always known: a path outside every listed scope is never reported). */
  scope: LibraryScope;
  /** Each action at most once, in the order first seen. */
  actions: ChatFileAction[];
  /** The steps that touched it (Read, Write, Edit…), so a step can open its file. */
  toolUseIds: string[];
  /** Successful edits and writes in this chat; above 0, "What changed" is offered. */
  edits: number;
  /**
   * Sent only by server 0.16.2: shorter names replies used for it, matched across the whole chat.
   * No longer sent, and ignored when present: a short name links only into a folder the same reply
   * names (`chatFileFor`), since `profile.md` in one reply may be another client's in the next.
   */
  aliases?: string[];
  /**
   * Orders the list only; never shown (a reopened chat's history has no times, so it counts the
   * order things were seen instead). Newer is greater.
   */
  order: number;
}

/** A file the person attached to this chat. Never carries the staged copy's path. */
export interface ChatAttachment {
  name: string;
  kind: UploadKind;
  /** `ChatFile.key` of where Claude filed it, or null while that is not known. */
  filedKey: string | null;
}

/** A web address from a reply or a WebFetch step. Opens in a new tab, as every outside link does. */
export interface ChatWebLink {
  /** Always `http:` or `https:`, never with a user name or password, at most CHAT_LINK_MAX_CHARS. */
  url: string;
}

export interface ChatFilesSnapshot {
  /** Most recently touched first (by `order`). At most CHAT_FILES_MAX. */
  files: ChatFile[];
  /** In the order attached. */
  attachments: ChatAttachment[];
  /** Newest first, no repeats. At most CHAT_LINKS_MAX. */
  links: ChatWebLink[];
  /**
   * Pages Claude published with its Artifact tool (`shared/pages-contract.ts`), newest first. Sent
   * by servers from 0.28; treat as `[]` when missing. Their claude.ai addresses are left out of `links`.
   */
  pages?: ChatPage[];
}

export const CHAT_FILES_MAX = 200;
export const CHAT_LINKS_MAX = 100;

/** `GET ROUTES.sessionFileChanges`: the edits this chat made to one file, oldest first. */
export interface ChatFileChanges {
  /**
   * Oldest first. `cut` and `hiddenChars` as `ChangeSummary` gives them (the approval card's
   * warnings), so the view can say when a change was cut short or had hidden characters made visible.
   * `at` is null for a change rebuilt from history (stored messages carry no time).
   */
  changes: {
    at: string | null;
    tool: string;
    change: ProposedChange;
    cut: { lines: number; chars: number } | null;
    hiddenChars: boolean;
  }[];
  /** True when older edits were dropped (over CHAT_FILE_CHANGES_MAX, or the chat's byte budget). */
  truncated: boolean;
}

export const CHAT_FILE_CHANGES_MAX = 20;
/** Most bytes of kept Write/Edit input per chat; the oldest kept edits go first. */
export const CHAT_FILE_CHANGES_BUDGET = 4 * 1024 * 1024;
/** Most tool use ids kept per file (the newest). */
export const CHAT_FILE_TOOL_IDS_MAX = 50;
/** Longer web addresses are not kept. */
export const CHAT_LINK_MAX_CHARS = 2000;

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
  | { type: 'sessions-changed' }
  /**
   * Ads files changed (plan 2026-11-16-workbench-ad-manager, decision 19): proposals, monthly reports, board CSVs,
   * fetch status or standup under `clients/`. Re-fetch the ads summary and whatever Ad Manager shows. A separate type,
   * not a BrainArea, because an older tab treats an unknown area as a full bootstrap reload.
   */
  | { type: 'ads-changed' };

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

/** How this copy of the app is running. */
export interface ServiceInfo {
  /** True when macOS started it at login (the LaunchAgent sets `TDS_BRAIN_SERVICE=1`), so it restarts by itself. */
  underService: boolean;
}

export interface Bootstrap {
  appVersion: string;
  /** `setup`: no usable brain was found, so the client shows the Setup page (setup-screen plan, decision 3). */
  appState: AppState;
  service: ServiceInfo;
  identity: Identity;
  profile: MemberProfile;
  brain: BrainHealth;
  engine: EngineHealth;
  skills: SkillInfo[];
  clients: ClientInfo[];
  usedOften: UsedSkill[];
  prefs: AppPrefs;
  /** Team skill levels (plan 2026-11-14-skill-levels-and-helpers, decision 8). Absent from older servers. */
  skillLevels?: SkillLevels;
}

/**
 * Starts a chat. Give `prompt`, `resume`, or both.
 * - `prompt` only: a new chat; the engine starts at once.
 * - `resume` only: reopens a past chat. The server replays its earlier messages as
 *   `user-message` / `assistant-message` events and leaves it `idle`; the engine starts on the
 *   first message. `resume` must be in the brain's own session list and not already live
 *   (else `not-found` / `already-open`).
 * - `client` must be a slug from `Bootstrap.clients` (else `bad-request`). On resume (a chat woken after it went
 *   to sleep) it is kept when still known and dropped when not, never refused.
 * - `project` (Projects R2 phase 1, shared/chat-places-contract.ts) must be a live project in the projects
 *   index (else `bad-request`); for a client project `client` may be omitted, and a different one is
 *   `bad-request`. On resume the chat's saved client and project win; with nothing saved, the request's are
 *   kept when still valid and dropped when not, never refused.
 * - A prompt that begins `/name` for a role-restricted skill is refused with `not-allowed`.
 */
export interface StartSessionRequest {
  prompt?: string;
  client?: string | null;
  resume?: string | null;
  /**
   * The to-do this chat is about. Must be an id in the person's current `TodoList` (mine or open),
   * else `bad-request`. With `resume`, kept when still listed and dropped when not, never refused.
   */
  todoId?: string | null;
  /** The project this chat is for (a ProjectKey), or null. See above. */
  project?: ProjectKey | null;
  /** Upload ids from `POST /api/uploads`, at most MAX_ATTACHMENTS. With attachments, `prompt` may be empty. */
  attachments?: string[];
}

export interface StartSessionResponse {
  session: LiveSession;
}

/** Refused with `busy` while a turn is running, `session-closed` after close, `not-allowed` as above. */
export interface SendMessageRequest {
  /** May be empty when `attachments` is not. */
  text: string;
  /** Upload ids, at most MAX_ATTACHMENTS. Each id is used once; a used, unknown or expired one is `bad-request`. */
  attachments?: string[];
}

// ---------------------------------------------------------------------------
// Attachments (docs/plans/2026-11-12-chat-attachments.md)
// ---------------------------------------------------------------------------

export type UploadKind = 'image' | 'document';

/** A file staged in the app's data folder, waiting to go with a message. Never a path. */
export interface UploadInfo {
  /** Server-made, opaque. */
  id: string;
  /** The cleaned name, as Claude will see it. */
  name: string;
  /** Bytes. */
  size: number;
  kind: UploadKind;
}

export interface UploadResponse {
  upload: UploadInfo;
}

/**
 * Release 3: the extensions a to-do upload may have — the library's image and document types, minus
 * the ones that can carry script (svg, html, htm). Lower case, no dot.
 */
export const TODO_UPLOAD_TYPES: readonly string[] = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'pdf',
  'md',
  'txt',
  'docx',
  'csv',
  'xlsx',
  'pptx',
];

/**
 * `POST ROUTES.todoUpload`. Where the file goes is the server's choice, never the browser's
 * (plan decision 3): a TDS to-do whose `client` matches a brain client → `clients/<slug>/images/` or
 * `clients/<slug>/files/` (by kind); anything else (no client, an unknown client, a personal to-do) →
 * `personal/images/` or `personal/files/`. A name already taken gets " (2)", " (3)"… before the extension.
 */
export interface TodoUploadRequest {
  /** UploadInfo.id from ROUTES.uploads. */
  upload: string;
  /** The to-do: TodoItem.id + scope, as changeTodo. */
  id: string;
  scope?: TodoScope;
  /** TodoItem.version; required. */
  expect: string;
}

export interface TodoUploadResponse {
  /** The fresh list, as changeTodo returns. */
  list: TodoList;
  /** Where the file was saved, brain-relative. */
  path: string;
  /** True when it went to `personal/` (only this Mac has it). */
  personal: boolean;
}

/** A file shown on a sent message. */
export type AttachmentInfo = Omit<UploadInfo, 'id'>;

export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export const MAX_STAGED_BYTES = 512 * 1024 * 1024;
/** The request header carrying the file name, `encodeURIComponent`ed. */
export const UPLOAD_NAME_HEADER = 'x-upload-name';

/** Allowed extensions (lower case, no dot) and what each counts as. Anything else is refused. */
export const UPLOAD_TYPES: Readonly<Record<string, UploadKind>> = {
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
  csv: 'document',
  tsv: 'document',
  ppt: 'document',
  pptx: 'document',
  odt: 'document',
  ods: 'document',
  rtf: 'document',
  txt: 'document',
  md: 'document',
  json: 'document',
  html: 'document',
  htm: 'document',
  eml: 'document',
  vtt: 'document',
  srt: 'document',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  heic: 'image',
  svg: 'image',
};

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
  /**
   * v0.4. Absent = 'tds' (the app's own tick, as before). 'personal' ticks through the brain script's
   * `tick` with scope, only when TodoList.canUsePersonal, and then `expect` is required.
   */
  scope?: TodoScope;
  expect?: string;
}

export type ChangeTodoRequest = TodoAction;

export interface OkResponse {
  ok: true;
}

export type ApiErrorCode =
  | 'bad-request'
  | 'unauthorised' // no or wrong session cookie
  | 'forbidden' // wrong Host or Origin
  | 'not-found'
  | 'not-allowed' // the person's role may not run that skill
  | 'changed' // a task changed since the person read it (409)
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
 *   POST /api/todos/change     ChangeTodoRequest   → TodoList
 *   GET  /api/todos/asked                       → AskedTodoList
 *   GET  /api/todos/history?key=<key>           → TodoHistoryResponse
 *   POST /api/todos/upload     TodoUploadRequest   → TodoUploadResponse
 *   PUT  /api/prefs            Partial<AppPrefs>   → AppPrefs
 *   GET  /api/sessions                          → SessionList
 *   POST /api/sessions         StartSessionRequest → StartSessionResponse
 *   POST /api/sessions/:id/messages   SendMessageRequest → OkResponse
 *   POST /api/uploads          raw file bytes      → UploadResponse
 *                              (Content-Type: application/octet-stream; name in UPLOAD_NAME_HEADER)
 *   POST /api/uploads/:id/discard     {}                 → OkResponse
 *   POST /api/sessions/:id/permission PermissionReply    → OkResponse
 *   POST /api/sessions/:id/answer     QuestionReply      → OkResponse
 *   POST /api/sessions/:id/interrupt  {}                 → OkResponse
 *   POST /api/sessions/:id/close      {}                 → OkResponse
 *   POST /api/sessions/:id/level      ChatLevelRequest   → { level: TurnLevel }
 *   GET  /api/skill-levels                      → SkillLevels
 *   POST /api/skill-levels     SetSkillLevelRequest → SkillLevels
 *   GET  /api/stream?session=<id>&after=<seq>   Server-Sent Events. Each `data:` is a StreamFrame.
 *                                               `session` and `after` are optional. With `session`,
 *                                               the chat's events with seq > after are sent first
 *                                               (default after=0: the whole chat), then live ones.
 *
 * Every POST and PUT except the upload sends `Content-Type: application/json` and a JSON body; routes with nothing
 * to say send `{}`. Any failure returns ApiError with a fitting HTTP status.
 */
/** One released version of the app, from its own `CHANGELOG.md` (written by the version hook). */
export interface VersionNotes {
  /** "0.6.0", without the "v". */
  version: string;
  /** YYYY-MM-DD, or null when the heading has none. */
  date: string | null;
  /** In file order. `kind` is the commit type ("feat", "fix", "perf", "refactor"), or '' when none. */
  changes: { kind: string; text: string }[];
}

/** `GET ROUTES.changelog`: newest version first. */
export interface ChangelogResponse {
  versions: VersionNotes[];
}

export const ROUTES = {
  /** `GET /auth?code=<one-time code>`: swaps a single-use, 60-second code for the session cookie. */
  auth: '/auth',
  /** Launcher only (never a browser): proves it knows the secret and gets a one-time code back. */
  authCode: '/auth/code',
  bootstrap: '/api/bootstrap',
  todos: '/api/todos',
  completeTodo: '/api/todos/complete',
  /**
   * `POST` ChangeTodoRequest → the fresh TodoList. 403 `not-allowed` when `changes` isn't 'on';
   * 400 `bad-request` for a body that isn't a TodoAction or a change the script refuses;
   * 404 `not-found`; 500 `internal` when the script fails.
   */
  changeTodo: '/api/todos/change',
  /** `GET` → AskedTodoList. `no-store`. */
  askedTodos: '/api/todos/asked',
  doneTodos: '/api/todos/done',
  teamTodo: '/api/todos/team',
  /** `GET ?key=` → TodoHistoryResponse. `no-store`. 400 `bad-request` for a bad key, 404 `not-found`. */
  todoHistory: '/api/todos/history',
  /**
   * `POST` TodoUploadRequest → TodoUploadResponse (release 3). Files a staged upload (from ROUTES.uploads)
   * into the library through the `tdsapp-files` skill's `add`, then links it to the to-do through the
   * to-do skill's `attach`. 403 `not-allowed` unless TodoList.canUpload; 400 `bad-request` for a type
   * not in TODO_UPLOAD_TYPES or an unknown/sent upload id; 404/409 as changeTodo. The staged upload is
   * used up either way.
   */
  todoUpload: '/api/todos/upload',
  /** Projects R1 (decision 10). `GET` → ProjectList (shared/projects-contract.ts). */
  projects: '/api/projects',
  /** `POST` ProjectAction → ProjectList. Errors as ProjectsErrorCode with a plain UK-English `error`. */
  projectsChange: '/api/projects/change',
  projectsMove: '/api/projects/move',
  /** Archive plan: archive or unarchive (with `check`). Body ProjectRemoveRequest. */
  projectsArchive: '/api/projects/archive',
  /** Archive plan: delete (with `check`). Body ProjectRemoveRequest with action 'delete'. */
  projectsDelete: '/api/projects/delete',
  /** `GET ?key=<ProjectKey>&kind=image|document` → ProjectFilesResponse (decision 7). */
  projectFiles: '/api/projects/files',
  /** `GET ?key=<ProjectKey>` → ProjectTodosResponse (every assignee's open to-dos in the project). */
  projectTodos: '/api/projects/todos',
  /** R2 phase 2. `GET ?key=<ProjectKey>[&before=<path>]` → ProjectUpdatesResponse (shared/project-updates-contract.ts). */
  projectUpdates: '/api/projects/updates',
  /** R2 phase 3. `GET ?key=<ProjectKey>` → ProjectActivityResponse (shared/project-activity-contract.ts). */
  projectActivity: '/api/projects/activity',
  /** R2 phase 3. `POST {key}` → 204: saves this person's "last looked" snapshot in the app data folder. */
  projectSeen: '/api/projects/seen',
  /** Claude artifacts in projects (decision 8). `POST` JSON ProjectArtifactRequest → ProjectArtifactResponse (shared/projects-contract.ts). */
  projectArtifact: '/api/projects/artifact',
  /** R2 phase 4. `GET ?key=<ProjectKey>` → ProjectMeetingsResponse (shared/project-meetings-contract.ts). This Mac's own calendar only. */
  projectMeetings: '/api/projects/meetings',
  /** Client background on a project's Overview. `GET ?key=<ProjectKey>` → ProjectBusinessResponse (shared/project-business-contract.ts). Read only. */
  projectBusiness: '/api/projects/business',
  /**
   * R2 phase 5. `GET [?key=<ProjectKey>]` → EmailDraftsResponse; `POST` EmailDraftApproveRequest or EmailDraftDismissRequest
   * (shared/project-email-contract.ts). This Mac's own drafts only; the server reads the draft file and adds the token.
   */
  projectEmailDrafts: '/api/projects/email-drafts',
  /**
   * Chat summaries (shared/chat-summary-contract.ts). `POST` ChatSummaryDraftRequest → ChatSummaryDraft: Claude's
   * draft from a side copy of the chat, never saved. Saving goes through `projectsChange`.
   */
  chatSummaryDraft: '/api/chat-summary/draft',
  /** Chat summaries, decision 10. `GET ?key=<ProjectKey>` → UnsavedChatsResponse (this Mac's chats only). */
  projectUnsavedChats: '/api/projects/unsaved-chats',
  /** Home meetings. `GET` → HomeMeetingsResponse (shared/home-meetings-contract.ts): every upcoming meeting, this Mac's calendar only. */
  homeMeetings: '/api/meetings',
  /** `GET` → TidyList; `POST` TidyApply → TidyList (decision 13). */
  projectsTidy: '/api/projects/tidy',
  prefs: '/api/prefs',
  /** `GET`: EngineChoices. `no-store`, every role. */
  engineChoices: '/api/engine/choices',
  /**
   * `GET`: SkillLevels (every role, `no-store`). `POST` SetSkillLevelRequest → the fresh SkillLevels:
   * 403 `not-allowed` unless owner or scout, or while `writable` is false; 400 `bad-request` for an
   * unknown skill or tier; 500 `internal` when the brain skill's script fails. The app never writes
   * the file itself.
   */
  skillLevels: '/api/skill-levels',
  /**
   * `POST` ChatLevelRequest → `{ level: TurnLevel }`: the person picks a tier for the rest of this
   * chat (null = back to automatic). Applies from the next message. 404 `not-found` for an unknown
   * chat; 400 `bad-request` for an unknown tier; ignored (answers with the manual level) in manual mode.
   */
  chatLevel: (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/level`,
  /**
   * `GET`: ChatContextDetail (shared/context-contract.ts) for one open chat. 404 `not-found` for an
   * unknown chat. `detail: 'full'` at most once per 30 s per chat and never during a reply; otherwise
   * the newest reading with `approximate: true`.
   */
  chatContext: chatContextPath,
  /**
   * `GET`: ChangelogResponse, read from the app's own CHANGELOG.md (never a brain file). Owners and
   * scouts only: 403 `not-allowed` for anyone else. An unreadable file gives `{versions: []}`.
   */
  changelog: '/api/changelog',
  /**
   * `GET`: UpdateStatus. `no-store`, every role. Never waits on git; a stale or missing `checkedAt`
   * starts a background check. `notes` is [] for roles other than owner and scout.
   */
  updateStatus: UPDATE_ROUTES.status,
  /** `POST`: UpdateStatus after a fresh check. 409 `busy` while an update runs. */
  updateCheck: UPDATE_ROUTES.check,
  /**
   * `POST` `{confirm: true}` (else 400 `bad-request`) → 202 UpdateStatus. 409 `busy` if an update is
   * running; 403 `not-allowed` when the copy is blocked or there is nothing to update to.
   */
  updateStart: UPDATE_ROUTES.start,
  /** `GET`: SyncStatus. `no-store`. */
  sync: '/api/brain/sync',
  sessions: '/api/sessions',
  /** `POST`: ClientGuessRequest → ClientGuessResponse. */
  clientGuess: '/api/client-guess',
  /** `POST`: ClientPickOutcomeRequest → `{}`. */
  clientPickOutcome: '/api/client-guess/outcome',
  sessionMessages: (id: string) => `/api/sessions/${encodeURIComponent(id)}/messages`,
  sessionPermission: (id: string) => `/api/sessions/${encodeURIComponent(id)}/permission`,
  sessionAnswer: (id: string) => `/api/sessions/${encodeURIComponent(id)}/answer`,
  sessionInterrupt: (id: string) => `/api/sessions/${encodeURIComponent(id)}/interrupt`,
  /**
   * `POST {}` → `{ ok: true }`: sends again the message a hook in Claude Code held back (a `notice` with `resend`),
   * exactly as it went the first time, files included. `busy` while a turn runs; `bad-request` when nothing is held
   * (it was sent again already, or a newer message replaced it); `session-closed` / `not-found` as for messages.
   * On success the stream gets an `info` notice "Sent again." (after it, no page offers Send again for that message),
   * and with levels on, the level is worked out again first, as for a new message.
   */
  sessionResend: (id: string) => `/api/sessions/${encodeURIComponent(id)}/resend`,
  sessionClose: (id: string) => `/api/sessions/${encodeURIComponent(id)}/close`,
  /**
   * `DELETE`: moves an earlier chat's history (Claude Code's `<id>.jsonl` and its `<id>/` folder) to the macOS
   * Bin, so it can be put back. Reply 200 `{}`. The id must be a UUID (else 400 `bad-request`) that is in
   * `SessionList.past` (else 404 `not-found`); an open chat is 409 `already-open` (close it first). If the Bin
   * move fails, 500 `internal` with a plain message, and nothing is deleted.
   */
  pastSession: (sdkSessionId: string) => `/api/sessions/past/${encodeURIComponent(sdkSessionId)}`,
  /** `POST`: SetChatKindRequest → StartSessionResponse (`{ session }`). */
  sessionKind: (id: string) => `/api/sessions/${encodeURIComponent(id)}/kind`,
  /**
   * `GET`: ChatFileChanges for one `ChatFile.key` of a live chat. 404 `not-found` for an unknown chat
   * or a key with no edits in it; `session-closed` as for the other session routes. `no-store`.
   */
  sessionFileChanges: (id: string, key: string) =>
    `/api/sessions/${encodeURIComponent(id)}/file-changes/${encodeURIComponent(key)}`,
  /**
   * `GET`: one stored version of a chat's page, as HTML under PAGE_PREVIEW_CSP (sandboxed, scripts
   * allowed, opaque origin), wrapped in claude.ai's page skeleton when it has no doctype. Errors are a
   * small HTML page under the same policy. Plan docs/plans/2026-11-14-artifacts-in-app.md.
   */
  chatPage: (id: string, key: string, n: number) =>
    `/api/sessions/${encodeURIComponent(id)}/pages/${encodeURIComponent(key)}/${n}`,
  /**
   * `GET`: version `n` of a chat's page wrapped in the TDS bar (`brandedPage`), as a download
   * (`brandedFileName`), under the download policy. Errors as for `chatPage`.
   */
  chatPageBranded: (id: string, key: string, n: number) =>
    `/api/sessions/${encodeURIComponent(id)}/pages/${encodeURIComponent(key)}/${n}/branded`,
  /** `POST` PageAskRequest (`shared/pages-contract.ts`): ask Claude to change or brand a page. */
  chatPageAsk: (id: string, key: string) =>
    `/api/sessions/${encodeURIComponent(id)}/pages/${encodeURIComponent(key)}/ask`,
  /**
   * `POST`: the file's bytes. Errors (all ApiError, sent with `Connection: close`):
   * 400 `bad-request` for a missing or bad name, a type not in UPLOAD_TYPES, a bad Content-Length
   * or an upload cut short; 403 `not-allowed` when uploads are switched off; 409 `busy` when the
   * staging folder is full or more than 4 uploads are running; 411 `bad-request` without a
   * Content-Length; 413 `bad-request` over MAX_UPLOAD_BYTES; 415 `bad-request` for a Content-Type
   * other than application/octet-stream; 507 `internal` when the disk is full; 500 `internal`
   * otherwise. The page sends at most 4 at once.
   */
  uploads: '/api/uploads',
  /** `POST {}`: deletes an upload that has not been sent. An unknown id is fine (OkResponse). */
  uploadDiscard: (id: string) => `/api/uploads/${encodeURIComponent(id)}/discard`,
  /** `GET`: LibraryScope[]. */
  libraryScopes: '/api/library/scopes',
  librarySearch: '/api/library/search',
  /**
   * `POST {ids: string[]}` (at most FAVOURITE_FILES_MAX ids) → LibraryItemsResponse. The listed files for these ids,
   * in the order sent; an id that is unknown or no longer a listed file is left out. Read-only.
   * 400 `bad-request` for a body that is not that.
   */
  libraryItems: '/api/library/items',
  /**
   * `DELETE`, JSON body `{ expect?: string }` (a `LibraryItem.version`) → 204. Plan 2026-11-15-delete-library-files.
   * Errors: 400 `bad-request`, 403 `not-allowed`, 404 `not-found`, 409 `changed`, 500 `internal`, each with a
   * plain UK-English `error` from FILES_CHANGE_MESSAGES.
   */
  libraryItem: (id: string) => `/api/library/items/${encodeURIComponent(id)}`,
  /**
   * `GET`: LibraryListing. 404 `not-found` for a scope that is not listed.
   *
   * Errors on every library route: 400 `bad-request` for a width that is not in THUMB_WIDTHS or an
   * item whose `thumb` or `view` does not fit the route; 404 `not-found` for an id that is unknown,
   * gone or no longer allowed. Error replies are `no-store`.
   */
  library: (scope: string) => `/api/library?scope=${encodeURIComponent(scope)}`,
  /**
   * `GET`: image/webp, for an item with `thumb: true`. `w` must be one of THUMB_WIDTHS. `v` is the
   * item's `modified` and only makes the address change when the file does; the server ignores it.
   * A picture is sent with `Cache-Control: private, max-age=31536000, immutable`.
   */
  libraryThumb: (id: string, w: ThumbWidth, v: string) =>
    `/api/library/thumb/${encodeURIComponent(id)}?w=${w}&v=${encodeURIComponent(v)}`,
  /** `GET`: LibraryText, for an item with `view: 'text'`. */
  libraryText: (id: string) => `/api/library/text/${encodeURIComponent(id)}`,
  /**
   * `GET`: the HTML file itself, for an item with `view: 'page'`, sent with its own strict policy
   * (sandboxed: no scripts, no access to the app) so it is safe inside a sandboxed frame. Its
   * errors are a small plain HTML page under the same policy, never JSON, because a frame shows them.
   */
  libraryPage: (id: string) => `/api/library/page/${encodeURIComponent(id)}`,
  /**
   * `GET`: the PDF itself, for an item with `view: 'pdf'`, as `application/pdf`, `inline`, `nosniff`,
   * under its own policy (only the app may frame it). Refused unless the file really starts as a
   * PDF. Errors are a small plain HTML page under the page policy, as for `libraryPage`.
   */
  libraryPdf: (id: string) => `/api/library/pdf/${encodeURIComponent(id)}`,
  /**
   * `GET`: the file itself as a download, for any listed item. Always `application/octet-stream`
   * with `Content-Disposition: attachment`, `nosniff` and a sandbox policy, so the browser saves it
   * and never shows it inside the app, whatever is in it. `no-store`.
   */
  libraryFile: (id: string) => `/api/library/file/${encodeURIComponent(id)}`,
  /**
   * `files`: the page understands `files` chat events (plan 2026-11-13-chat-files). Without it the
   * server leaves them out of the stream, replay and live, so a tab from an older version (whose
   * reducer resets a chat on an unknown event) keeps working until it reloads. `levels`: the same
   * for `level` events (plan 2026-11-14-skill-levels-and-helpers). `context`: the same for
   * `compaction` and `context` events (plan 2026-11-14-context-management).
   */
  stream: (sessionId?: string | null, after = 0, files = false, levels = false, context = false) =>
    sessionId
      ? `/api/stream?session=${encodeURIComponent(sessionId)}&after=${after}${files ? '&files=1' : ''}${levels ? '&levels=1' : ''}${context ? '&context=1' : ''}`
      : '/api/stream',
} as const;

/**
 * Stream health. The server sends a named `ping` event (not a comment, so the page can see it) on
 * every stream at this interval. If the page hears nothing at all on its stream, pings included,
 * for `STREAM_STALL_MS`, it treats the stream as dropped: closes it, reconnects, and reloads what
 * it may have missed. This catches a connection that stalls without raising an error.
 */
export const STREAM_PING_EVENT = 'ping';
export const STREAM_PING_MS = 15_000;
export const STREAM_STALL_MS = 40_000;

// ── Library search (plan 2026-11-13-global-search, decision 4) ───────────────────────────────────────

/**
 * `GET /api/library/search?q=<2–80 chars>&kind=image|doc` → LibrarySearchResponse. Read-only. Matches
 * every word of `q` (case- and accent-insensitive) against an item's title, name, group, folder words and
 * its scope's name, across every scope the person can see. Uses cached listings even past their freshness
 * (refreshing behind); builds cold scopes three at a time within a 1.5 s budget, then answers with
 * `partial: true`. At most LIBRARY_SEARCH_MAX hits, best first (title starts-with, word-start, contains,
 * other fields; ties newest first). Bad `q` or `kind` → 400 `bad-request`.
 */
export interface LibrarySearchHit {
  item: LibraryItem;
  /** The scope the item is in, so the client can open it without taking the id apart. */
  scope: LibraryScope;
}

export interface LibrarySearchResponse {
  hits: LibrarySearchHit[];
  /** All matches found so far (may exceed hits.length). */
  total: number;
  /** True when some scopes weren't listed yet; asking again soon may find more. */
  partial: boolean;
}

export const LIBRARY_SEARCH_MAX = 20;
export const LIBRARY_SEARCH_QUERY = { min: 2, max: 80 } as const;
