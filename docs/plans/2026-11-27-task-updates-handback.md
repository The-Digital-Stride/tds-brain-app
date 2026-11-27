# Tasks: updates, hand back, links and time stamps

Date: 2026-11-27 · Size: XL (two releases) · Branch: `task-updates-handback` (release 1) · Explainer: none

## Objective

Tasks should work for handing work to a teammate and back. The person who gets a task can action it, say
what they did, add links and files, and hand it back or finish it. The person who asked can reply. Every
action carries who did it and when. Release 2 then tells people, prominently, when a task of theirs changed.

## User decisions (fixed)

- Two releases, in order: (1) updates log, Hand back, web links, a time on every action; (2) notifications.
  Release 1 merges before release 2 starts.
- Finishing a task someone gave you: the holder chooses each time between **Mark as done** (the asker is
  told, release 2) and **Hand back** (it returns to the asker's list with a note).
- Notifications are inside the app only. No Mac banners.
- No visual explainer.
- Sync clashes (asked 2026-11-27): add `todo/*.md merge=union` to the brain's `.gitattributes`, so two
  people's changes to one task merge into one file. Ian's yes is needed again when it and the script go in.
- Standing rules: the app never writes brain files (changes go through `tdsapp-todo`); backward
  compatibility first; UI says "task", code says `todo`; the brain copy of the script needs Ian's yes.

## Facts (checked 2026-11-27)

- Pass-on exists: `assignee` in `brain-skills/tdsapp-todo/scripts/tdsapp-todo.cjs:1116` stamps
  `assigned_to/_at/_by/_from/_via` and a line under `## Handover history` (`stampHandover`, line 1391).
- "New to you" exists for a received task only: `client/src/state/todo-new.ts` (7 days, red dot, rail count).
- A task you passed on is read only (`AskedReadView`, `client/src/shell/TodoPanel.tsx:634`); the server only
  lets a change through for a task in `mine` or `open` (`changeTodo`, `server/brain/todos.ts:760`).
- There is no update or comment. The body's history sections ride inside `details` and show in the editor.
- Files: `## Files` section, script-only writer (`attach`/`detach`), `keep_files` on `edit`. A web link line
  there is an "extra" shown as text (`todoFileExtras`, `shared/todo-files.ts:109`).
- Times today: pass-on, tick and delete carry date, time and person. `add` writes `created:` (date only,
  script line 1064). `edit`, `due`, `attach`, `detach`, `project` stamp nothing. A title change writes a
  date-only line under `## Title history`.
- History in the panel is worked out from the brain's git record (`server/brain/todo-timeline.ts`), so it
  shows the sync time and the syncing Mac, not always the actor.
- The script has no idea who may do what; the server decides (`changeTodo`).
- `scripts/help-demo/brain/.claude/skills/tdsapp-todo/` holds its own copy of the script (it differs from
  the repo's today).

## Decisions

### Release 1

1. **A `## Updates` section in the task file, written only by the script.** Format in
   `shared/todo-updates-contract.ts` ("On disk: the `## Updates` section"). One line per entry with UK date
   and time, name and slug; a person's note says `wrote:`; longer notes continue on two-space-indented lines.
   Plain: each task gets a running log of who said what and when, readable in the app, the Workbench and by Claude.
2. **New script command `update`** adds a note. `assignee` and `tick` take an optional `note`, written in the
   same file write.
   Plain: you can say what you did when you add an update, pass a task on, hand it back or finish it.
3. **`edit` never changes `## Updates`.** With a section on disk, an `## Updates` section in the incoming body
   is dropped and the one on disk carried over, with or without `keep_files`. With none on disk, a body
   holding that heading is refused with a clear message (overseer should 3). No new flag.
   Plain: an older copy of the app, which shows the log inside the details, can't damage it by saving.
4. **One log line per action, no stamp lines.** Every script command that really changes an open task
   appends exactly one entry to `## Updates` (edit, due, attach, detach, link, unlink, project, update);
   `assignee` keeps its `## Handover history` line; `add` writes `created_at`. No `changed_*` frontmatter:
   a rewritten line clashes on every merge, an appended one doesn't (overseer blocking 1, confirmed in a
   scratch repo). The server works out `lastChange` from the newest entry.
   Plain: every change records the real person and time in the task itself, in a way two people can't clash on.
5. **Automatic entries name files and links only on TDS tasks.** In a personal task the entry says "added a
   file" without the name, and the project entry never names the project anywhere. No folding of repeats
   (overseer: saves are explicit, so repeats are rare).
   Plain: the log shows "changed the due date" or "added a file" with the time, and never leaks a private name.
5a. **Built for union merges.** Readers read every `## Updates` and `## Files` section, sort entries by time
   and take the last copy of a frontmatter key; the script folds doubled sections and doubled keys back to
   one whenever it writes. A test merges two clones' changes to one task under `merge=union`.
   Plain: if two people change a task in the same minute, both changes are kept in the one task.
6. **Web links live in `## Files`**, written by new commands `link` and `unlink`. http(s) only, checked by the
   script, the server and the form. Up to 20 links beside the 20 files.
   Plain: a task can hold a link to a Drive doc or a web page next to its files; older apps show it as text.
7. **Hand back is `assignee` to the person who passed it to you, with a note.** Target worked out by
   `handBackTarget` (contract): `handover.by`, else `createdBy`, when that is a teammate other than you. No
   new script command; `assignee` takes `back: true`, which writes `assigned_back: true` and "handed it back
   to <slug>", and `handBackTarget` is null on a task that was itself handed back (overseer should 2). It
   uses the same Undo hold as passing on.
   Plain: one button returns the task to whoever asked, with your note; the log says "handed it back", and the
   button doesn't bounce between two people.
8. **The asker can add an update to a task they passed on while it is waiting.** The server allows `update`
   and nothing else on a task in the person's Asked waiting list (overseer: update only; a pasted URL is
   already a link). Files, links and edits stay with the holder.
   Plain: you can answer a question on a task you gave someone without taking it back.
9. **The server parses the timeline and sends it** on every task shape (`updates`, `links`, `lastChange`,
   `createdAt`; contract `TodoTimelineFields`), merging `## Handover history` lines in by time. `details`
   still holds the whole body; the client shows it through `splitTodoSections` when `canUpdate`.
   Plain: the panel shows one list of everything that happened to a task, newest activity easy to find.
10. **The git History block stays, but stops reporting log-only changes.** A commit that only touched
    `## Updates` lines or a `created_at` line gives no History event.
    Plain: History doesn't fill up with "changed" lines that the Updates list already shows properly.
11. **Capabilities gate everything.** `updates-v1` and `links-v1` from the script; `TodoList.canUpdate` /
    `canLink`. With an older script in the brain, none of the new controls show and nothing else changes.
    Plain: the app keeps working exactly as now until the brain has the new script.
12. **Panel UI.** An **Updates** block under Files (new `TodoUpdates.tsx`): the list, and a box to add an
    update for the holder and the waiting asker. **Hand back to <name>** beside Mark as done when there is a
    target, opening a small note form. Passing on in Edit offers an optional note. Mark as done stays one
    press; the update box offers "Add update and mark as done" (one file write, with the usual Undo). Moving
    a personal task to TDS says its updates and links go too. Files block becomes **Files and links** with
    **Add a link**. All follow `docs/design-system.md`; forms use `useSheetHold`.
    Plain: the task panel gains a conversation-style log, a Hand back button and links.
13. **Help in the same branch.** New page `task-updates` (updates and hand back), changes to
    `passing-todos-on`, `files-on-todos`, `todos`, `asked-of-others`, pictures, and a What's new note.
    Pictures come from a throwaway git brain (the demo brain's script is a stand-in that changes nothing).
    Plain: the help matches what people see on day one.
14. **Break announced.** From 0.7 the script's results for old calls are no longer byte-identical to 0.6:
    they gain a log line (and `created_at` on add). Everything added is plain markdown. The Workbench and
    Reminders-sync parser fixtures must read the same title, due, assignee and body apart from those lines.
    An older app counts the log inside its 8,000-character details limit, so it may refuse to save details
    on a task with a long log until it is updated (overseer should 4).
    Plain: other tools that read tasks see a few extra plain lines and keep working.

### Release 2 (outline; planned in detail after release 1 merges)

15. **"Changed since you looked".** For tasks you hold and tasks you asked for: a change by someone else
    (`lastChange.by` ≠ you, or it was finished or handed back) newer than your seen marker. Seen markers
    extend `prefs.todoSeen` (app data, never the brain) and store the task's `version` (the file's
    fingerprint), because entry times are only to the minute and the Reminders sync changes title and due
    date without leaving an entry (overseer).
16. **Where it shows.** A count on the rail, a section at the top of the Tasks drawer, a Home card, and a
    line on the task saying what changed. In the app only.

## Overseer pre-review (2026-11-27)

- Blocking 1, sync clashes: fixed by decisions 4 and 5a and the brain's `merge=union` line (Ian said yes).
- Should 2 (hand back mark), 3 (refuse a typed `## Updates` heading), 4 (older apps and the details limit):
  taken, in decisions 7, 3 and 14. Nice 5 (say that updates and links go with a personal task moved to TDS):
  taken, in decision 12.
- Decisions: keep automatic entries, no folding; the asker gets update only; "Add update and mark as done"
  is one button with Undo; dropping an incoming log section is safe because the log only grows.
- Still to confirm by hand: one real two-Mac clash through the brain's sync app after the script is in.

## Contract

`shared/todo-updates-contract.ts`: the on-disk format, limits, types, actions, script commands and the
shared reader signatures. `shared/contract.ts` gains the fields and action kinds it names.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique, product decisions, sign-off | (read-only) |
| Builder A: script and readers | `builder`, opus | data model and file format with tricky rules, mirrored in two parsers | `brain-skills/tdsapp-todo/**`, `shared/todo-updates.ts`, `shared/todo-updates.test.ts`, `shared/todo-updates.fixtures.json`, `shared/todo-files.ts`, `shared/todo-files.test.ts`, `shared/todo-files.fixtures.json` |
| Builder B: server | `builder`, sonnet | default | `shared/contract.ts`, `server/brain/todos.ts`, `server/brain/todo-asked.ts`, `server/brain/todo-done.ts`, `server/brain/todo-team.ts`, `server/brain/todo-skill.ts`, `server/brain/todo-timeline.ts`, `server/http/routes.ts`, and their test files, `server/http/todo-change-contract.test.ts` |
| Builder C: panel | `builder`, sonnet | default (UI) | `client/src/shell/TodoUpdates.tsx` (new), `TodoPanel.tsx`, `TodoFiles.tsx`, `TodoForms.tsx`, `TodosDrawer.tsx`, `words.ts`, `client/src/store.tsx`, `client/src/api.ts`, `client/src/styles/todo-panel.css`, and their test files |
| Lead | main session | — | plan, contract, help pages, pictures, What's new, commits |
| Reviewers | `reviewer`: correctness (opus), security (opus), UI and accessibility (sonnet) | per lens | (read-only) |
| UX/UI gate | `expert`, opus | project rule: sign-off on every UI change | (read-only) |

No file appears in two rows.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `brain-skills/tdsapp-todo/scripts/tdsapp-todo.test.ts` (and `test/updates.test.ts`, new) | `update`, `link`, `unlink`, `note` and `back` on assignee, `note` on tick, one entry per real change and none on a no-op, no names in a personal task's entries, doubled sections and keys folded, two clones merged under `merge=union` keep both entries, `edit` keeps `## Updates` whatever the body holds, section placement, refusals, 0.6 callers still work, Workbench and Reminders parsers read the same | A |
| `shared/todo-updates.test.ts` + fixtures run by the script's tests too | both parsers agree on every fixture: notes, multi-line notes, auto entries, extras, fences, handover merge, UK time to ISO across both clock changes | A |
| `shared/todo-files.test.ts` | link lines parse as links, not extras; bad URLs stay extras | A |
| `server/brain/todos.test.ts`, `todo-asked.test.ts` | timeline fields on every shape; `update` allowed on a waiting Asked task and nothing else is; `back` only to the hand-back target; the last copy of a doubled key wins; hidden-project rule still applies; `note` needs `canUpdate` | B |
| `server/http/todo-change-contract.test.ts` | every new action shape passes the real route gate (`checkRequest`) and reaches the runner | B |
| `server/brain/todo-timeline.test.ts` | a commit that only added `## Updates` lines or `created_at` gives no History event | B |
| `client/src/shell/TodoUpdates.test.tsx`, `TodoPanel.test.tsx`, `TodoFiles.test.tsx` | the list renders each kind; add update, hand back with note, add link send the right actions; controls hidden without the capability | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (`pnpm check`; preview on port 3878 from `/tmp/tba-preview-task-updates-handback/`)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] `node scripts/todo-roundtrip.ts` still passes
- [ ] Domain gates: security (new input, links, who may change an Asked task); UX/UI expert sign-off
- [ ] Browser check on a throwaway git brain: add update, hand back, reply as asker, add link, type key by key
- [ ] Help standard: page, pictures, What's new note

## Review outcomes

(Filled at the end.)
