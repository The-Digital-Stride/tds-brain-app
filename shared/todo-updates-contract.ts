/**
 * Task updates, hand back, web links and change stamps (plan docs/plans/2026-11-27-task-updates-handback.md,
 * release 1). The brain script (`tdsapp-todo` 0.7), the server (server/brain/todos.ts, todo-asked.ts, routes)
 * and the task panel build against this file. The app never writes brain files itself: every line described
 * here is written by the script.
 *
 * Code names stay `todo`; the words people read say "task".
 */

// ─── Capabilities ────────────────────────────────────────────────────────────────────────────────

/** The script answers `capabilities` with this once it has `update`, `note` and `back` on assignee, `note` on tick and the action log (0.7). */
export const TODO_UPDATES_CAPABILITY = 'updates-v1';
/** The script answers `capabilities` with this once it has `link` and `unlink` (0.7). */
export const TODO_LINKS_CAPABILITY = 'links-v1';

// ─── Limits ──────────────────────────────────────────────────────────────────────────────────────

/** Characters in one update's text after normalising (see "Update text" below). Empty is refused. */
export const TODO_UPDATE_MAX = 2_000;
/** Characters in a web link's URL. */
export const TODO_LINK_URL_MAX = 2_000;
/** Characters in a web link's name, after trimming. */
export const TODO_LINK_NAME_MAX = 120;
/** Most web links one task's `## Files` section may hold (files have their own TODO_ATTACHMENTS_MAX). */
export const TODO_LINKS_MAX = 20;
/** Entries of one task the server sends (the newest); `updatesMore` says when older ones were left out. */
export const TODO_UPDATES_SHOWN_MAX = 200;

// ─── On disk: the `## Updates` section ───────────────────────────────────────────────────────────
/*
 * A level-2 heading that says exactly "Updates" (any case), outside code fences, up to the next level-1 or
 * level-2 heading. The script is its only writer and only ever appends. Placement of a new section: after the
 * details and after `## Files`, before the first `## Title history`, `## Handover history`, `## Done <date>`
 * or `## Deleted <date>` heading, else at the end. (A new `## Files` section goes before `## Updates` too.)
 *
 * One entry starts at column 0:
 *
 *   - 27 Nov 2026, 14:05 UK: Ben McAdam (ben-mcadam) wrote: Sent the quote to the client.
 *     They want it signed by Friday.
 *   - 27 Nov 2026, 14:09 UK: Ben McAdam (ben-mcadam) added a link: Quote on Drive (TDS Cortex).
 *
 * - `D Mon YYYY, HH:mm UK` is UK wall-clock time (Europe/London), the same form as `## Handover history`.
 * - `Name (slug)`: the actor's display name (never containing "(" or ")"; the script strips them) and team slug.
 * - A NOTE has ` wrote: ` straight after `(slug)`, then the first line of the text. Further lines of the text
 *   follow, each indented by exactly two spaces. The text never holds a blank line.
 * - Anything else after `(slug) ` is an AUTO entry: one line the script wrote for an action, ending with
 *   ` (<via>).` like a handover line.
 * - Any other line at column 0 inside the section (a hand edit) is an "extra": kept on disk, shown as plain text.
 *
 * Every script command that really changes an open task's file appends exactly one entry (a command that
 * ends up changing nothing writes nothing). There are no "last changed" frontmatter lines: two people's
 * appended lines merge cleanly under the brain's `todo/*.md merge=union` rule, where a rewritten stamp line
 * would not (overseer blocking 1). Auto wording (the script's, fixed; readers map it to TodoEntryAction):
 *   due        "set the due date to 1 Dec 2026" | "changed the due date from 1 Dec 2026 to 3 Dec 2026" |
 *              "cleared the due date (it was 1 Dec 2026)"
 *   edit       "changed the title" | "changed the details" | "changed the title and the details"
 *   attach     "added a file: <link name>"        detach   "removed a file: <link name>"
 *   link       "added a link: <link name>"        unlink   "removed a link: <link name>"
 *   project    "changed the project"              (never names the project, client or stage)
 * In a personal task (`personal/todo/`) the file and link entries leave the name out ("added a file",
 * "removed a link"), so nothing private is named in a file that might later move to the team.
 * `assignee` writes no entry here (its line goes under `## Handover history`, as before; with `back: true` it
 * reads "handed it back to <slug>"). `add`, `move`, `tick` and `delete` write none (`add` writes `created_at:`
 * after `created:`, ISO with the UK offset like `assigned_at`; tick and delete keep their own records). A
 * `note` on `assignee` or `tick` is written as a NOTE entry in the same file write.
 *
 * Known limit (accepted, review round 1): when two people add multi-line notes in the same sync window and
 * both notes end with the very same line, the union merge keeps that line once, so one note loses its last
 * line. Single-line notes and notes with different endings are unaffected.
 *
 * Under the union rule a merge can leave lines out of time order, two `## Updates` (or `## Files`) sections,
 * or two copies of a frontmatter key. So:
 * - Readers read EVERY `## Updates` section in the body and sort entries by time (stable: equal minutes keep
 *   file order). `parseTodoFiles` / `parseTodoLinks` likewise read every `## Files` section.
 * - Readers of frontmatter take the LAST copy of a key.
 * - The script, whenever it writes a task, first folds later `## Updates` and `## Files` sections into the
 *   first of each (item lines appended, exact duplicates dropped) and, for any key it sets (title, due,
 *   assignee, assigned_*, client, project, stage), removes every copy before writing one.
 *
 * Update text (the `text` of `update`, the `note` of `assignee` and `tick`), normalised by the script:
 * CRLF and CR become LF; a tab becomes a space; each line loses its trailing spaces; blank lines are dropped;
 * the whole is trimmed. Refused (400): not a string, empty after that, over TODO_UPDATE_MAX, any other
 * control character, or a line that starts (after spaces) with ``` or ~~~ ("an update can't hold a code block").
 * The text is plain text everywhere: the app shows it as written and only turns http(s) URLs into links.
 */

/** One entry of a task's timeline, as the server sends it. */
export interface TodoUpdate {
  /**
   * - 'note': a person's update (`wrote:`).
   * - 'auto': a line the script wrote for an action in `## Updates`.
   * - 'handover': a line from `## Handover history` (older than this release too), merged in by time.
   */
  kind: 'note' | 'auto' | 'handover';
  /**
   * ISO 8601 with the UK offset, to the minute (seconds `00`), worked out from the UK wall time written.
   * For the hour that happens twice when the clocks go back, the first one.
   */
  at: string;
  /** Team slug as written in `(slug)`; null for a handover line (they carry no slug) or a slug not on the team. */
  by: string | null;
  /** The name as written. */
  byName: string;
  /**
   * note: the text, lines joined with `\n`. auto: the action in words, without the trailing ` (<via>).`
   * handover: the line after the name, without the trailing ` (<via>).`, e.g. "passed it from ben-mcadam to ian-hancock".
   */
  text: string;
  /** auto and handover: the tool named at the end, e.g. "TDS Cortex"; null when absent. Always null for a note. */
  via: string | null;
  /**
   * What happened, for release 2's words: 'update' for a note; for an auto entry, from its wording (null for
   * wording this app doesn't know); for a handover line 'handback' when it reads "handed it back to …", else
   * 'assignee'.
   */
  action: TodoEntryAction | null;
}

export type TodoEntryAction =
  | 'update'
  | 'due'
  | 'title'
  | 'details'
  | 'files'
  | 'links'
  | 'project'
  | 'assignee'
  | 'handback';

// ─── On disk: web links in `## Files` ────────────────────────────────────────────────────────────
/*
 * A web link is one more item in the task's `## Files` section, written by `link`:
 *
 *   - [Quote on Drive](https://drive.google.com/file/d/abc/view)
 *   - [Spec (v2)](<https://example.com/spec_(v2)>)
 *
 * The target is in `<…>` when the URL holds "(" or ")". A URL must: parse as a URL, be `http:` or `https:`,
 * have a host, be at most TODO_LINK_URL_MAX characters, and hold no whitespace, control character, "<", ">"
 * or backslash. The name is 1–TODO_LINK_NAME_MAX characters on one line with no "[" or "]"; when none is sent
 * the script uses the URL's host name (without a leading "www."). A URL already linked is a no-op; a
 * 21st link is refused. `unlink` removes every line linking that exact URL, and the section once it is empty.
 *
 * Older apps and the Workbench show such a line as text (the section's "extras"), as their help already says.
 */

/** One web link in a task's `## Files` section, in written order. */
export interface TodoLink {
  /** Always http(s), already checked by the parser with the rules above. */
  url: string;
  /** The link text as written. */
  name: string;
}

// ─── Hand back (frontmatter) ─────────────────────────────────────────────────────────────────────
/*
 * `assignee` with `back: true` is a hand back: the `assigned_*` record also gets `assigned_back: true`, and
 * the handover line reads "handed it back to <slug>". Any later `assignee` without `back` replaces the record
 * without that line. TodoHandover (shared/contract.ts) gains `back?: boolean`.
 */

/** The newest entry of the task's timeline, by time. Null when it has none. Worked out by the server. */
export interface TodoLastChange {
  at: string;
  by: string | null;
  byName: string;
  action: TodoEntryAction | null;
}

// ─── What the server adds to each task it sends ──────────────────────────────────────────────────

/**
 * Added (all optional, so an older server's answer still type-checks at the edges) to TodoItem, AskedTodo,
 * DoneTodo and TeamTodo in shared/contract.ts. `details` still holds the whole body; the client shows it
 * through `splitTodoSections`.
 */
export interface TodoTimelineFields {
  /**
   * Notes, auto entries and handover lines, oldest first (stable for equal minutes: file order, `## Updates`
   * before `## Handover history`). At most TODO_UPDATES_SHOWN_MAX, the newest. [] when there are none.
   */
  updates?: TodoUpdate[];
  /** True when older entries were left out of `updates`. */
  updatesMore?: boolean;
  /** Lines in `## Updates` that aren't entries (hand edits), as written. */
  updateExtras?: string[];
  /** Web links in `## Files`, in written order. */
  links?: TodoLink[];
  /** The newest entry of `updates` (before the cap), else null. */
  lastChange?: TodoLastChange | null;
  /** Frontmatter `created_at` as written, else null. */
  createdAt?: string | null;
}

/** Added to AskedTodo only. */
export interface AskedTodoUpdateFields {
  /**
   * This person may add an update to this task they passed on: it is still waiting, changes are on, and the
   * script lists TODO_UPDATES_CAPABILITY. Nothing else can be changed on it (overseer: update only; a URL
   * in an update is already a link).
   */
  canUpdate?: boolean;
}

/** Added to TodoList. False from an older server (absent). */
export interface TodoListUpdateFields {
  /** `changes` is 'on' and the script lists TODO_UPDATES_CAPABILITY: `update`, and `note` on assignee and tick. */
  canUpdate?: boolean;
  /** `changes` is 'on' and the script lists TODO_LINKS_CAPABILITY: `link` and `unlink`. */
  canLink?: boolean;
}

// ─── Actions (added to TodoAction in shared/contract.ts) ─────────────────────────────────────────
/*
 * - `update`: adds a note. Allowed on a task listed for this person (mine or open), AND on a task in their
 *   Asked list that is still waiting (TDS only; the same hidden-project rule as the Asked list). Needs canUpdate.
 * - `link` / `unlink`: adds or removes a web link, on mine/open only. Needs canLink.
 * - `assignee` takes an optional `note` and an optional `back: true` (a hand back; the server checks the new
 *   assignee is `handBackTarget` for this task, else `bad-request`). `tick` takes an optional `note`. A note
 *   is written in the same file write. Both need canUpdate (sent without it: `bad-request`). `assignee` with
 *   a note to the person who already has the task is `bad-request` (the script refuses: nothing was passed on).
 * Every other action is unchanged, and still refused (`not-found`) on an Asked task.
 * - `edit`: when canUpdate, the client sends the details without the `## Updates` and `## Handover history`
 *   sections too (`splitTodoSections`), so neither shows twice or can be retyped. A `details` holding an
 *   `## Updates` or `## Handover history` heading is `bad-request` with the app's words
 *   (the pattern of TODO_FILES_MESSAGES.headingInDetails) when the task has no such section on disk; when it
 *   has one, the script drops the incoming section and keeps its own (an older app sends it back unchanged).
 * Route checks: `text` / `note` is a string of 1–TODO_UPDATE_MAX characters after trimming with no control
 * character other than \n, \r and \t, and no line starting (after spaces) with ``` or ~~~ (refused with the
 * app's own words, so the person is told why); `url` passes `isTodoLinkUrl`; `name` (optional) is 1–TODO_LINK_NAME_MAX
 * characters after trimming, one line, no "[" or "]"; `back` is absent or `true`.
 * A personal task (`scope: 'personal'`) takes update, link and unlink like any other action there (`expect`
 * required).
 */
export type TodoUpdateAction =
  | { kind: 'update'; id: string; text: string; expect?: string; scope?: 'tds' | 'personal' }
  | { kind: 'link'; id: string; url: string; name?: string; expect?: string; scope?: 'tds' | 'personal' }
  | { kind: 'unlink'; id: string; url: string; expect?: string; scope?: 'tds' | 'personal' };

/** `note` on the existing `assignee` action and on the tick action. */
export interface TodoNoteField {
  note?: string;
}

/** `back` on the existing `assignee` action: this pass-on is a hand back. */
export interface TodoBackField {
  back?: true;
}

// ─── The script's command line (0.7 additions; every new field optional) ─────────────────────────
/*
 *   update   {file, text, scope?, expect?, by?, by_name?, via?}        → {ok, file}
 *   link     {file, url, name?, scope?, expect?, by?, by_name?, via?}  → {ok, file, url, name}  (no-op when linked)
 *   unlink   {file, url, scope?, expect?, by?, by_name?, via?}         → {ok, file, url}        (no-op when not linked)
 *   assignee … plus optional `note` and `back: true`     tick … plus optional `note`
 *   edit     never changes `## Updates` or `## Handover history` (the two script-owned records; review round 1).
 *            For each: with a section on disk, the same section in the incoming `body` is taken out and the
 *            one on disk carried over (placed by the rules above), with or without `keep_files`, and the
 *            details limit counts the body without it. The incoming section must say the same as the one on
 *            disk, compared tolerantly (entries and other lines, trimmed, runs of spaces as one, list marker
 *            `-` or `*`): an older app, which shows the sections inside the details, sends them back unchanged
 *            and succeeds. If it differs (someone typed below the log, or changed a line) the edit is refused
 *            (400, nothing written) rather than dropping their text. With NO section on disk, a body holding
 *            that heading (outside code fences) is refused (400), as `add` with such a `body` is.
 *   fences   a body whose last code fence never closes: before a section is added or appended after it, the
 *            script adds the matching closing fence line, so the section is never swallowed by the code block.
 *   text     U+2028 and U+2029 in an update's text count as line breaks.
 *   attach, detach, due, edit, project: append their auto entry; they now also read optional `by`, `by_name`
 *            and `via` where they didn't before (else the git user and "todo skill").
 *   capabilities → version "0.7", features add "updates-v1" and "links-v1".
 * Errors as before: 400 bad input, 404 not there, 409 changed since read, 500 can't write.
 *
 * Backward compatibility (announced to Ian, 2026-11-27): a 0.6 call now also appends a line under
 * `## Updates`, so results are no longer byte-identical to 0.6. Everything added is plain markdown (and one
 * `created_at:` line); the Workbench parser and the Reminders sync parser fixtures must still read the same
 * title, due date, assignee and body text apart from those added lines. An older app counts the log inside
 * its 8,000-character details limit, so it may refuse to save details on a task with a long log until it
 * is updated.
 *
 * The brain needs `todo/*.md merge=union` in its `.gitattributes` (Ian's yes, 2026-11-27; added by hand with
 * the script copy, never by this repo's tooling), so two people's entries merge into one file.
 */

// ─── Shared reading code (shared/todo-updates.ts; the script mirrors it, both run the same fixtures) ─────

/** The script-owned sections and the section-free details, like `splitTodoFiles`. */
export type SplitTodoSections = (body: string) => {
  /** The body without its `## Files`, `## Updates` and `## Handover history` sections, trimmed. */
  details: string;
  /** The `## Handover history` section as written ('' when none). Every such section, joined, when doubled. */
  handover: string;
  /** The `## Files` section as written ('' when none). */
  files: string;
  /** The `## Updates` section as written ('' when none). */
  updates: string;
};

/** Notes and auto entries from `## Updates`, in written order, with the lines that aren't entries. */
export type ParseTodoUpdates = (body: string) => { entries: TodoUpdate[]; extras: string[] };

/** The lines of `## Handover history` as entries (`kind: 'handover'`, `by: null`), in written order. */
export type ParseTodoHandovers = (body: string) => TodoUpdate[];

/** `entries` of both, merged oldest first (see TodoTimelineFields.updates for ties). Not capped. */
export type TodoTimeline = (body: string) => { updates: TodoUpdate[]; extras: string[] };

/** Web links in `## Files` (shared/todo-files.ts gains this; `todoFileExtras` then leaves link lines out). */
export type ParseTodoLinks = (body: string) => TodoLink[];

/** The URL rules above. Used by the parser, the route and the form. */
export type IsTodoLinkUrl = (url: string) => boolean;

/** UK wall time ("2026-11-27", "14:05") → ISO with the UK offset, seconds 00. Null for an impossible time. */
export type UkWallToIso = (date: string, time: string) => string | null;

/**
 * Who a task goes back to with "Hand back": the person who passed it to its holder (`handover.by`, from a
 * stamp or git history), else who added it (`createdBy`); null when that is the holder themself, nobody, or
 * someone not on the team, or when the task was itself handed back to `me` (`handover.back`), so the button
 * never bounces between two people. Only for a TDS task assigned to `me`.
 */
export type HandBackTarget = (
  todo: {
    scope: 'tds' | 'personal';
    assignee: string | null;
    createdBy: string | null;
    handover: { by: string | null; back?: boolean } | null;
  },
  me: string,
  team: { slug: string; name: string }[],
) => { slug: string; name: string } | null;

/** The fixtures both parsers run: shared/todo-updates.fixtures.json. */
export const TODO_UPDATES_FIXTURES = 'shared/todo-updates.fixtures.json';
