# Workbench to-dos in the app

Date: 2026-11-12 · Size: L · Branch: `workbench-todos` (from `main` fbb16c2) · Explainer: none (Ian said no)

## Objective

Bring the Workbench's to-do actions into the app — add, edit (title and details), pass to a teammate,
set or clear a due date, delete — as the first step to the app replacing the Workbench (port 3851).
The app stays a front end: it never writes a brain file itself. Every change runs the brain's own
`todo` skill script, which behaves exactly as the Workbench does today.

## User decisions (fixed)

- **Never change brain files from the app's own code.** Brain files change only when a brain skill
  or tool is actioned, exactly as from the terminal. (Saved to memory as a standing rule.)
- **Behave exactly like the Workbench.** Weak spots are not fixed here; they are logged in
  `os/tds-brain-app/change-requests.md` in the brain for Pete (the brain guardian) to sign off.
- **The script lives in the brain** as a new skill `todo` (written in `brain-skills/todo/`, copied
  into the brain only with Ian's approval). Until Pete releases it, only owner and scouts may use it
  (`roles: owner, scout`, `maturity: draft`).
- Scope: the core five (add, edit, pass on, due date, delete). Not filters, sort, drag order or
  project to-dos.
- One Settings switch covers every to-do change ("Let the app change to-dos"), off by default.
- Ticking stays as it is today (the app's own `completeTodo`). Known to break the rule above; left
  for a later change at Ian's request.
- Delete is permanent, as on the Workbench (supersedes the earlier "recoverable" choice, because
  Ian then asked for Workbench behaviour). Logged as a weak spot.
- No visual explainer.

## Facts established

- Workbench: `~/agencybrain/tools/members/command-centre/server.cjs`, routes `/api/todos/add`
  (1569), `/edit` (1684), `/due` (1615), `/assignee` (1650), `/delete` (1725), `/tick` (1451),
  `/roster` (730), `/api/misc-todos` (523, uses `lib/todo-parser.cjs` `getMiscTodos`). Plain `fs`
  writes; no conflict check; default assignee from `git config user.name`, slugified.
- Brain to-do rules: `~/agencybrain/todo/AGENTS.md`. The brain has no to-do skill or tool today.
- Brain skills can carry scripts (`.claude/skills/request-skill/scripts/request.cjs`) and be limited
  by `roles:`; `maturity:` is draft / live / trusted (`docs/skill-maturity.md`).
- The app already runs brain scripts as child processes (`tools/whoami.cjs` in
  `server/brain/identity.ts`, injectable `Runner`) and checks skill roles (`skillAccess`).
- `brain-skills/` in this repo is where the app's brain skills are written and reviewed; copying into
  the brain is a separate approved step (`brain-skills/README.md`).
- Ian's Plaud ⇄ Reminders sync completes a reminder when its to-do file leaves `todo/`, so a delete
  in the app also completes the linked reminder. Slack to-do add-on keys on `todo/<file>` paths.

## Decisions

1. **New brain skill `todo`** in `brain-skills/todo/`: `SKILL.md` (`roles: owner, scout`,
   `maturity: draft`, `members: false`, `agency: true`, USE WHEN list) and `scripts/todo.cjs`, a
   faithful, dependency-free port of the Workbench routes listed above, including their regexes,
   limits, frontmatter edits and error texts. Command line as in `shared/contract.ts` (above
   `TODO_SCRIPT_TIMEOUT_MS`). The SKILL.md tells Claude to use the script for any to-do change.
   Plain: the brain gets one tool that changes to-dos the Workbench way, which the app, Claude and later the Workbench can all use.
2. **The app runs the script, never writes.** `server/brain/todo-skill.ts` runs
   `process.execPath <brain>/<TODO_SCRIPT> <command>` with `BRAIN_ROOT=<brain>`, cwd the brain, JSON
   on stdin, `TODO_SCRIPT_TIMEOUT_MS`, no shell. The script path's real path must sit inside the
   brain's real path. Status 400/404 from the script map to `bad-request`/`not-found` with the app's
   own plain UK message (the script's texts are for developers); anything else is `internal`.
   Plain: changes happen inside the brain's own code; the app only asks.
3. **Who can change.** `todos(identity).changes`: `skillAccess(identity, 'todo')` 'allowed' and the
   script present → 'on'; 'restricted' → 'restricted'; else 'no-skill'. The route turns 'on' into
   'switched-off' when `directWrites` is off. `changeTodo` also refuses an `id` not listed for this
   person (theirs or open), matching what the Workbench shows.
   Plain: only Pete and the scouts see the controls until Pete releases the skill, and only with the switch on.
4. **One route.** `POST /api/todos/change` with a `TodoAction`, returning the fresh `TodoList`, behind
   the existing request gate (cookie, Origin, JSON). The body is checked strictly against the action
   shapes before anything runs.
   Plain: one door for every to-do change, with the same locks as every other change.
5. **Reads gain the fields the editor needs**: `created`, `source`, `details` (body trimmed), and
   `TodoList.team` from `.team-config/roles.json` (read only).
   Plain: the edit form can show the details and the people to pass to.
6. **UI in the To-dos drawer.** When `changes` is 'on': an "Add a to-do" control above the list and
   an edit control on each row opening an inline editor (title, details, due date, assigned to,
   Save, Cancel, Delete; no browser dialogs). Ticks, deletes and pass-ons are held with an Undo (decision 9). Saving sends one action
   per changed field. Passing to someone else drops it from "Mine" and says so. When
   'switched-off', one line points to Settings; when 'restricted' or 'no-skill', nothing changes from
   today. The overseer settles the exact layout.
   Plain: the same jobs as the Workbench, done in the drawer you already use.
7. **Settings switch renamed** "Let the app change to-dos", help text covering tick, add, edit, pass
   on and delete. The pref key stays `directWrites`.
   Plain: one switch, clearly named, still off until you turn it on.
8. **Weak spots logged, not fixed**: `os/tds-brain-app/change-requests.md` in the brain.
9. **Undo (follow-up, Ian's request).** Ticking, deleting and passing on are held in the client for
   `TODO_UNDO_MS` (10 s) with an Undo on the row, then sent as one request each, one at a time. Undo
   only drops the held change, so nothing in the brain is ever reversed. Title, details and date save
   at once. `pagehide` sends anything not yet started with `fetch` keepalive. Once a change has
   started sending, Undo is replaced by "Sending…".
   Plain: a mis-click can be taken back for 10 seconds, without the app or the brain undoing a file.
10. **No tick box (Ian's request).** The list has no tick box; a to-do is finished from inside it. The
   editor's footer has Save and Cancel, then a separate row with "Mark as done" and "Delete" (red).
   Mark as done waits while there are unsaved edits ("Save or cancel your changes before marking it
   as done."). Someone who may tick but not edit (switch on, no `todo` skill yet) gets a "…" button,
   `Options for "<title>"`, opening a small panel: the title (focused, so Enter twice can't finish it),
   the details, "Mark as done" and "Cancel". Both actions keep the 10-second Undo; the held row says
   "Marked as done".
   Plain: finishing or deleting a to-do is always a deliberate step, and titles get the tick box's room.
11. **Deleted to-dos are kept (Ian's request; BCR-05, awaiting Pete).** The skill's `delete` moves the
   file to `todo/deleted/` (suffix on a clash, never overwriting) and stamps `status: deleted`,
   `deleted`, `deleted_at`, `deleted_by` and `deleted_via`, mirroring `stampDone`. Who: the body's
   `by` / `by_name` (the app sends its signed-in identity, as its tick records use), else git
   user.name. `via`: the app sends "TDS Brain App"; "todo skill" otherwise. The Workbench still deletes for good until changed.
   Plain: every delete leaves a record of who and when, for reporting, and can be put back.

## Overseer pre-review (applied)

Blocking, all applied to the contract: B1 a multi-field save sends edit → due → assignee one at a
time and stops at the first failure; B2 `edit.details` is optional and sent only when changed
(details over TODO_DETAILS_MAX are shown read-only); B3 `add` always sends `assignee` (default the
person's own slug); B4 the script's command line spelled out (root, stdin, stdout, exit codes, what
is kept literally, how tests fix git's user name). Should: S1 child-process rules (spawn, real path,
scrubbed env, SIGKILL timeout, output cap, one run at a time); S2 detection as planned, with tests;
S3 team slugs use the Workbench rule; S4 weak-spot log corrected and extended (#12–#16); S5 the
SKILL.md says "use when asked to add, edit, pass on, re-date or delete a to-do", not "for any
change". Nice: the script's test isn't copied into the brain.

### UI decisions (overseer, decision 6)

- **Add:** full-width "Add a to-do" button in `drawer-tools` under the tabs. It opens a one-column
  form in place: "What needs doing?" (max 200), "Due date (optional)", "Assigned to" ("Me", then
  team names; no open option, as on the Workbench), then "Add" and "Cancel". Enter adds, Esc cancels.
- **Edit:** a pencil button on each row, `aria-label` `Edit "<title>"`. The editor replaces the row,
  one open at a time: "Title", "Details" (5 rows, max 8000), "Due date" with "Clear date",
  "Assigned to" ("Me", team, "Open to anyone"). Footer: "Save", "Cancel", and "Delete" on the far side.
- **Save:** explicit only, in the B1 order, using the last list returned. If one fails midway the
  editor stays open with the fresh values, so saving again sends only what's left.
- **Delete:** sends nothing at once: the row is held with an Undo for 10 seconds (decision 9). The
  first build's in-page "Delete this to-do for good?" confirm was removed at Ian's request.
- **switched-off:** one line under the tabs, with "Settings" as a link. **restricted / no-skill:**
  nothing shown.

| Where | Copy |
|---|---|
| Partial save | "Some changes were saved, but not all. Check the to-do and save again." |
| Held (tick, delete, pass on) | Row: "Ticked off" · "Deleted" · "Passed to Ben McAdam" · "Made open to anyone" · "Assigned to you", with "Undo". Status: "<that>. You can undo this for 10 seconds." · after Undo: "Undone." · once sent: "Sending…" |
| Made open | "Now open to anyone." |
| Switched off | "Adding and editing to-dos is switched off. Turn on 'Let the app change to-dos' in Settings." |
| Long details | "These details are too long to edit here. Change them in a chat instead." |
| `bad-request` | "That change wasn't understood. Check the title and date, then try again." |
| `not-found` | "That to-do could not be found. It may have been finished, deleted or passed on." |
| `internal` | "The change could not be made. Try again." |
| Success (added, saved) | "Added." · "Saved." |
| Settings help | "Lets you mark to-dos as done, add, edit, pass them on and delete them here. Each change is made in the shared brain, so the whole team sees it. Off by default." |

## Contract

`shared/contract.ts`: `TodoItem` (created, source, details), `TeamMember`, `TodoChangeAccess`,
`TodoList.team` and `.changes`, `TODO_SKILL`, `TODO_SCRIPT`, `TodoAction`, `TodoChangeError`, the
script's command line, `BrainReaders.changeTodo`, `ChangeTodoRequest`, `ROUTES.changeTodo`.

## Team and file ownership

| Role | Agent and model | Owns (files) |
|---|---|---|
| Lead | main session | `shared/contract.ts`, `docs/**`, `README.md`, `brain-skills/README.md` |
| Overseer | `overseer`, fable | (read-only) |
| Builder A, brain skill | `builder`, opus | `brain-skills/todo/**`, `vitest.config.ts` |
| Builder B, server | `builder`, sonnet | `server/brain/todos.ts`, `server/brain/todo-skill.ts`, `server/brain/index.ts`, `server/brain/identity.ts`, `server/brain/*.test.ts` for these, `server/http/routes.ts`, `server/http/routes.test.ts`, `server/setup-mode.ts`, `server/setup-mode.test.ts`, `server/engine/session-manager.test.ts` (fixture only) |
| Builder C, page | `builder`, sonnet | `client/src/**` |

No file appears in two rows.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `brain-skills/todo/scripts/todo.test.ts` | Each command gives the same file text and JSON as the Workbench route on the same input (add incl. default assignee and `-2` names, edit title+body, due set/clear, assignee set/clear, delete, tick, roster, list), bad input → status 400/404 and exit 2 | A |
| `server/brain/todo-skill.test.ts` | Runs a fake script: argv, stdin, env, timeout; maps 400/404/crash; refuses a script outside the brain; never writes itself | B |
| `server/brain/todos.test.ts` | New fields; `changes` from skill access and script presence; unlisted id refused | B |
| `server/http/routes.test.ts` | `/api/todos/change`: switch off → 403; bad bodies → 400; ok → fresh list; error mapping | B |
| client tests | Controls only when 'on'; editor sends one action per changed field; tick, delete and pass-on are held with Undo (store timers, late Undo, page close); switched-off line | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (no dev server on 3000–3002)
- [ ] Domain gates: security (child process, request gate, path checks); UX expert on the drawer
- [ ] Browser check: To-dos drawer against a test brain copy with the skill installed

## Review outcomes

### Kept deletes follow-up

- **Correctness and security (opus):** injection, data loss, rollback, line endings and list readers
  clean. Confirmed and fixed: deletes named the person from git while ticks used the app's identity, so
  one person could appear under two names in reports (the app now sends its identity); four safety
  parts had no test (rollback, BOM/CRLF, the 60-character tool name, multi-line keys), now added. The
  rollback test was checked to fail with the rollback switched off.
- **Gates:** type-check, lint, build and all 1,111 tests pass.

### No tick box follow-up

- **UX and accessibility (sonnet):** applied all six: the "…" button's name no longer starts "Open"
  (clashed with "Open chat"); the panel is named by its title (a `legend`); focus on the title, not
  the button; Mark as done and Delete on their own row, Delete red; Mark as done waits for unsaved
  edits.
- **Browser check (throwaway test brain):** rows use the full width; the editor footer reads as
  above; Mark as done → Undo restored the row and put focus back on its edit button; a delete ran out
  its 10 seconds and the skill removed the file. The tick-only panel is covered by tests only (the
  test copy ran as a scout, who gets the full editor).
- **Gates:** type-check, lint, build and all 1,099 tests pass.

### Undo follow-up

- **Correctness (opus):** confirmed and fixed: Undo pressed after the time ran out (change in flight)
  said "Undone." but the change still went; a change queued behind another was not sent on
  `pagehide`. Added the missing test that a failed title/date save doesn't hold the pass-on.
- **UX and accessibility (sonnet):** applied: 10 s instead of 8; bar hidden under reduced motion;
  stale "You can undo" line cleared once sent; Undo's accessible name built from the action, not a
  lower-cased label; focus without scrolling. Not applied: pause on hover (the held row sits under
  the pointer that ticked it, so it would pause at once).
- **Browser check (lead, throwaway test brain, port 3879):** tick → Undo left the file alone; delete
  ran out and the skill removed the file; focus moved Undo → tick box → Add.
- **Gates:** type-check, lint, build pass; tests 1,096 of 1,097, the one failure the known flaky
  `Shell.test.tsx` (passes 3 of 3 alone).

### First build

- **Security (opus):** no findings. Same request gate, strict body checks, ids can't leave `todo/`,
  only the brain's real script runs, no new app writes.
- **Correctness (opus):** script parity with the Workbench confirmed line for line. Confirmed and
  fixed: a part-saved edit reset the unsaved fields (editor re-keyed) so Save again sent nothing; no
  test on the real `store.changeTodos` stop-at-first-failure rule.
- **UI and accessibility (sonnet):** confirmed and fixed: focus lost after passing on; add form could
  clip in a short window; delete warning not announced; errors looked like successes. "Added.",
  "Saved.", "Deleted." accepted and added to the copy table.
- **Requirement drift and copy (sonnet):** all six user requirements hold. Doc overclaims fixed (the
  parity check was a one-off, the tick exception, the app's data folder, three line numbers).
- **Browser check (lead, test brain copy on port 3878):** add, edit + due + pass on in one save,
  delete with confirm, the switched-off line all worked, and the files the skill wrote match the
  Workbench's format. Found and fixed: turning the Settings switch on didn't refresh the drawer, so the
  controls only appeared after a reload (`store.updatePrefs` now reloads to-dos; tests added).
- **Overseer (fable):** signed off, no blockers. Watch: ask Pete whether `members: false` affects the
  skill reaching team brains (it shouldn't: the field only tells the brain-update tool to leave the
  skill alone, and skills reach everyone by sync); one flaky `Shell.test.tsx` Esc test also flakes on
  `main` (2 of 4 full runs) and is unrelated.
- **Gates:** type-check, lint, 1,085 tests and build pass.
