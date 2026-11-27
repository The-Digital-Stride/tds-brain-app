/**
 * Contract for plan 2026-11-27-restricted-projects. Types only: nothing imports this file at run time.
 * Builders copy these shapes into the files they own. The rule itself is real code, already written and
 * tested: `shared/project-visibility.ts` (canSeeProject, mayRestrict, canTakeTask, parseVisibility,
 * rawTextRestricted, outsideProjectNote, RESTRICTED_LABEL, PROJECTS_VISIBILITY_CAPABILITY). Import from
 * there; never restate the rule.
 *
 * Already in the code (lead, before the builders start), so S1 and S2 compile side by side:
 * - `shared/projects-contract.ts`: ProjectCard.visibility, ProjectFields.visibility, ProjectList.canRestrict
 *   and .seesAll, TodoProjectMatch `{ how: 'restricted' }`.
 * - `server/brain/projects.ts`: ProjectsIndex.hiddenPath/hiddenKey/hiddenCount (optional on the type so test
 *   stand-ins compile; the real index always sets them), the readers `isHiddenPath(index, rel)` and
 *   `isHiddenKey(index, key)` that every consumer uses, `AssignAnswer`, `TaskPlace`, and
 *   `ProjectsService.assignCheck` (a stand-in answering ok until S1 writes it).
 */
import type { Identity } from '../../shared/contract.ts';
import type { ProjectVisibility } from '../../shared/project-visibility.ts';
import type { ProjectCard, ProjectKey } from '../../shared/projects-contract.ts';

// ---- shared/projects-contract.ts (ALREADY ADDED by the lead; S1 owns further edits) ------------------------

/** New on ProjectCard. Always set by this server; absent (an older server) reads as 'everyone'. */
export interface ProjectCardAdds {
  visibility?: ProjectVisibility;
}

/** New on ProjectFields (create, card, edit). 'everyone' removes the card's line; absent leaves it. */
export interface ProjectFieldsAdds {
  visibility?: ProjectVisibility;
}

/** New on ProjectList. */
export interface ProjectListAdds {
  /**
   * The script answers PROJECTS_VISIBILITY_CAPABILITY and changes are allowed (`canChange`). False or absent:
   * no "Who can see it" control anywhere. Per card the client also needs `mayRestrict(card, identity)`.
   */
  canRestrict?: boolean;
  /**
   * Every slug form (personSlugs: roster slug, member slug, Workbench slug) of each owner and scout in
   * `.team-config/roles.json`. They see every project, so they can take a task in a restricted one.
   * Absent on an older server: the client then treats nobody as outside (no client-side block; the server
   * still refuses).
   */
  seesAll?: string[];
}

/**
 * New member of TodoProjectMatch: the to-do's `project:` label names a project this person can't see.
 * No key, no title, no label. Rows carrying it also have `project: null` and `stage: null` in what the
 * server sends (the raw label would name the project).
 */
export type TodoProjectMatchAdd = { how: 'restricted' };

// ---- server/brain/projects.ts (Builder S1) -----------------------------------------------------------------

/**
 * New on ProjectsOptions. `viewer`: the person using this Mac, read once per index load (30 s cache).
 * Missing, or failing, means an unknown viewer (sees no restricted project). `members`: the roster with
 * roles, for `seesAll` and for naming people in the assign note.
 */
export interface ProjectsOptionsAdds {
  viewer?: () => Promise<Identity>;
  members?: () => Promise<{ name: string; slug: string; role: string }[]>;
}

/**
 * New on ProjectsIndex. The index a caller gets holds ONLY the cards this person can see: `cards`, `byKey`,
 * `keysForPath`, `refs` and `list()` never mention a hidden project, so a hidden key behaves like one that
 * doesn't exist. Build order matters (overseer S4): resolve labels and build the code index from ALL cards,
 * then mask, so a code or label never resolves differently per person and `refDuplicateOf` never names a
 * hidden key. A visible card's `links` that point inside a hidden folder are stripped.
 */
export interface ProjectsIndexAdds {
  /**
   * True when the brain-relative path is, or is inside, any folder of a hidden project: its live or archived
   * folder, a duplicate folder shadowed by it, a leftover of it, and its moved-from folders. Also true for a
   * file directly in `clients/<client>/files/` or `images/` that a hidden card links and no visible card
   * links (review fix: a restricted project's Files tab uploads land there). Any other linked file outside
   * those folders is NOT hidden. Always false when nothing is hidden.
   */
  hiddenPath(brainRel: string): boolean;
  /**
   * What `hiddenPath` hides, as lower-case brain paths (folders and exact files). Only for matching a glob
   * against, in the chat guard (review fix); one path is always decided with `hiddenPath`.
   */
  hiddenPaths: readonly string[];
  /** True for a hidden project's key and for any old key it moved from. */
  hiddenKey(key: ProjectKey): boolean;
  /** How many projects are hidden from this person. Never sent to the client. */
  hiddenCount: number;
}
// `resolve(value, client, scope)` answers `{ how: 'restricted' }` when the label matches a hidden card by the
// rules that would have answered 'key', 'legacy' or a moved key. It never answers 'loose', 'client' or
// 'missing' for a hidden project's label (the tidy-up would then offer to re-point it).
//
// Reading a card's visibility (overseer S5): restricted when `parseVisibility(<the raw frontmatter value, not
// through text()>)` says so OR `rawTextRestricted(<the whole frontmatter block as text>)` does. The second
// catches `Visibility:`, a merge-doubled key and a card that no longer parses.
//
// Writes (overseer B2): `change`, `move` and `remove` throw the same ProjectsError a missing project gets
// when `index.hiddenKey(key)`, BEFORE the script runs (script 0.8.0 knows nothing about visibility).

/** New on ProjectsService: the assign block's one question. Unfiltered cards never leave projects.ts. */
export type AssignAnswer =
  | { ok: true }
  /** The project is restricted and this person can't see it. `name`: their roster name, else the slug. */
  | { ok: false; why: 'outside'; name: string };

export interface ProjectsServiceAdds {
  /**
   * `place` is the task's project label, client and scope as they will be after the change; `assignee` is
   * the slug the task will have (null = open to anyone → always ok). Resolves the label against ALL cards.
   * No project, an open project, a personal scope, or a person who can see it (`canTakeTask`): ok.
   * It ignores who is asking: an outsider handing on their own task gets the same answer.
   */
  assignCheck(
    place: { project: string | null; client: string | null; scope: 'tds' | 'personal' },
    assignee: string | null,
  ): Promise<AssignAnswer>;
}

// ---- server to-dos (Builder S2) ----------------------------------------------------------------------------
//
// THE task rule (overseer B1), one sentence, applied everywhere a task is served or changed:
//   A task whose project is hidden from this person is served, opened or changed only when it is assigned to
//   them (Asked list: only when they asked for it). Then it carries `projectMatch: { how: 'restricted' }` and
//   `project: null`, `stage: null`.
// Everywhere = Open list and its counts, Done list, Asked list, team to-do by id, history/timeline by id,
// tick/complete, and every `changeTodo` action (an id not served to this person is `not-found`, as today for
// an unlisted id). `changeTodo` builds its own list (server/brain/todos.ts:611): it must get the index too.
//
// Fail closed (overseer S5): when the index can't be read, leave out every open task that carries a
// `project:` label and isn't assigned to this person, rather than showing all.
//
// The assign block: `changeTodo` takes `assignCheck` as a dep (wired in server/brain/index.ts by S1) and
// calls it before the to-do script runs, for `add`, `assignee`, `project`, and `move` to TDS, with the
// task's place and person as they will be after the change. `{ ok: false, why: 'outside' }` →
// TodoChangeError 'not-allowed' with message `outsideProjectNote(name)`.
// Pointing a task at a project the ACTOR can't see (`resolve` → 'restricted') is refused the way a project
// that doesn't exist is refused today.
export interface TodoChangeDepsAdds {
  assignCheck?: (
    place: { project: string | null; client: string | null; scope: 'tds' | 'personal' },
    assignee: string | null,
  ) => Promise<AssignAnswer>;
}

// ---- server library (Builder S2) ---------------------------------------------------------------------------
//
// Filter at serve time with `index.hiddenPath` (where the project stamp is applied today), never inside a
// cached listing or the search index: list, search, recent, starred, by-id reads (thumb, text, page, pdf,
// file), `projectFiles`, upload and delete targets (→ not found). When the index can't be read, hide every
// path under any `clients/*/projects/`, `clients/*/projects-archive/`, `clients/_archive/*/projects/` and
// `projects/` folder rather than showing all.
//
// Review fix: a client project's meeting notes are filed OUTSIDE its folder, at `clients/<client>/call-notes/`,
// with a `project:` line. Such a note is hidden when `index.resolve(tag, client, 'tds')` answers `restricted`
// (frontmatter read at serve time, cached by path and version; no file is read when nothing is restricted;
// index unreadable → any note with a `project:` line is hidden). `isHiddenCallNote` shares the rule with the
// task attach check, which answers a hidden path exactly as a missing file.

// ---- script (Builder B): brain-skills/tdsapp-projects/scripts/tdsapp-projects.cjs, v0.9.0 ------------------
//
// - Frontmatter key `visibility`, placed after `team` in ORDER. Written only as `visibility: restricted`;
//   'everyone' removes the line. Never written to a personal card (refuse 'bad-request').
// - Input field `visibility` on `create`, `card` and `edit`: 'everyone' | 'restricted', anything else
//   'bad-request'.
// - Who may set or clear it: `ownerChangeRule` as it stands (the Account Owner by either slug form, or role
//   owner or scout; a card with no Account Owner: an owner or scout). Else 'not-allowed':
//   "Only <allowedWho> can change who sees this project."
// - `create` with visibility 'restricted' by someone who is neither owner/scout nor the Account Owner named
//   in the same call: they are added to `team` (they would otherwise hide it from themselves).
// - Any `edit`, `link`, `unlink`, `ref` (one card), `update`, `update-remove`, `archive`, `unarchive`,
//   `delete`, `move`, `email-draft`, `email-draft-remove` of a restricted card by someone who can't see it
//   (not Account Owner, not on the team, not owner/scout): 'not-found', worded exactly as a missing project
//   is today. `find-ref` and `email-check` leave a restricted card's code out of what they answer for such a
//   person. `ref` with `all: true` is owner/scout only already.
// - `capabilities` adds 'projects-visibility-v1'.
// - Reading rule = parseVisibility in shared/project-visibility.ts: any value but empty/"everyone" is
//   restricted. A hand-written unknown value is kept on edit, as every unknown key's value is today.

export type { Identity, ProjectCard, ProjectKey, ProjectVisibility };
