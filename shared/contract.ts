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

import type { AppState } from './install-contract.ts';
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
  project: string | null;
  client: string | null;
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
}

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
  | { kind: 'add'; title: string; due: string | null; assignee: string | null; scope?: TodoScope }
  | { kind: 'edit'; id: string; title: string; details?: string; expect?: string; scope?: TodoScope }
  | { kind: 'due'; id: string; due: string | null; expect?: string; scope?: TodoScope }
  | { kind: 'assignee'; id: string; assignee: string | null; expect?: string; scope?: TodoScope }
  | { kind: 'delete'; id: string; expect?: string; scope?: TodoScope }
  /** v0.4: moves the file between `todo/` (tds) and `personal/todo/` (personal), bytes unchanged. */
  | { kind: 'move'; id: string; scope: TodoScope; to: TodoScope; expect?: string };
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
  /** `personal`, or `client:<slug>`. (`shared:<name>` is reserved for agency folders; none yet.) */
  id: string;
  /** "My personal files", or the client's name. */
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
   * The card it is shown in. From the rules ("Reports", "Brand"); a file no rule matches takes its
   * first folder's name, tidied up; a file loose in the scope's root goes in "Other".
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

export interface AppPrefs {
  /** Skill names, in the order the person pinned them. */
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
}

export const TODO_SEEN_MAX = 500;
/** A handover counts as "New to you" for this long. */
export const TODO_NEW_DAYS = 7;

export const DEFAULT_PREFS: AppPrefs = {
  pins: [],
  lastClient: null,
  todoPanelOpen: true,
  directWrites: false,
  todoSeen: {},
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
   * The to-do this chat was started on (a `TodoItem.id`), or null. Fixed when the chat is created.
   * Kept only while the chat is open: a chat reopened from History has null.
   */
  todoId: string | null;
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
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; text: string }
  /**
   * Everything this chat has used or produced so far (plan 2026-11-13-chat-files). A whole snapshot
   * each time, never a delta: the newest one replaces any before it, and the server keeps only the
   * newest in its replay log. Sent only on streams opened with `files=1` (see `ROUTES.stream`):
   * an older page's reducer would reset the chat on an event it does not know.
   */
  | ({ type: 'files' } & ChatFilesSnapshot);

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
  /**
   * The to-do this chat is about. Must be an id in the person's current `TodoList` (mine or open),
   * else `bad-request`. Ignored when `resume` is set.
   */
  todoId?: string | null;
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
  | 'changed' // a to-do changed since the person read it (409)
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
  prefs: '/api/prefs',
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
  sessionClose: (id: string) => `/api/sessions/${encodeURIComponent(id)}/close`,
  /**
   * `GET`: ChatFileChanges for one `ChatFile.key` of a live chat. 404 `not-found` for an unknown chat
   * or a key with no edits in it; `session-closed` as for the other session routes. `no-store`.
   */
  sessionFileChanges: (id: string, key: string) =>
    `/api/sessions/${encodeURIComponent(id)}/file-changes/${encodeURIComponent(key)}`,
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
   * reducer resets a chat on an unknown event) keeps working until it reloads.
   */
  stream: (sessionId?: string | null, after = 0, files = false) =>
    sessionId
      ? `/api/stream?session=${encodeURIComponent(sessionId)}&after=${after}${files ? '&files=1' : ''}`
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
