# Done to-dos: see and search them

Date: 2026-11-24 · Size: L · Branch: `done-todos-search` · Explainer: none

## Objective

Ticked to-dos move to `todo/done/` (226 today) and the app never lists them again, except the Asked tab's
"done" group for to-dos you passed on. Ian wants to see finished to-dos and search them, especially a
project's finished to-dos.

## User decisions (fixed)

- Show done to-dos in all three places: the To-dos drawer (a new Done tab with its own search box, same
  client and project filters as the other tabs), a project's To-dos tab (folded under the open ones, with a
  count), and the global search (marked as done).
- View only. No untick / reopen in this task (no brain skill change).
- No explainer.

## Facts (checked)

- Done files: `todo/done/<id>.md` (TDS) and `personal/todo/done/<id>.md` (personal; may be a link, see
  `brain-skills/tdsapp-todo/SKILL.md` lines 52-61). Personal files are only ever this person's
  (`assignee` = me), as `readFolder` (`server/brain/todos.ts:196`) applies to open ones.
- 123 of 226 live done files have no `completed_by`, 105 no `completed`/`completed_at` (ticked before the
  stamp existed, `server/brain/done-record.ts`). `todo-asked.ts` already reads one `git log` pass for
  "when was it added to `todo/done/`" (`LogFacts.doneAdd`, `whoFinished` at `todo-asked.ts:216`).
- The Asked tab already shows done items read-only: `AskedTodo` (`shared/contract.ts:356`),
  `AskedReadView` in `client/src/shell/TodoPanel.tsx:533`, history via `asked:todo/done/<id>` keys
  (`server/brain/todo-timeline.ts:35`).
- Project To-dos: `projects.ts` `projectTodos` (line 1234) already reads `todo/done/` into `TodoRec`
  (`done: true`, `doneDate`) and filters them out; it doesn't read `personal/todo/done/`.
- Global search: `client/src/shell/search-sources.ts` `todos` source ranks `ctx.todos.mine/open`.
- The drawer dropped its own search row earlier in favour of global search (`todo-filter.ts` comment).
  The Done tab brings a search box back for that tab only (user decision).

## Decisions

1. **One server reader, `listDoneTodos`, in a new `server/brain/todo-done.ts`.** Reads `todo/done/` and
   this person's `personal/todo/done/` with the same file rules as `readFolder` (SAFE_ID names, skip
   rule files, personal only when `assignee` = me and the folders pass the same real-directory check).
   Returns `DoneTodoList` (contract). **No file cache** (overseer): files are read on every call, as
   `askedTodos` does; only the git log is cached per HEAD, as one shared instance with `todo-asked.ts`.
   Plain: a to-do you just ticked shows in Done straight away.
2. **When it was done: stamp first, then git.** `completed_at` → `completed` → the date the file was
   added to `todo/done/` in git (one `git log` pass, reusing `todo-asked.ts`' log reader, not one call
   per file; TDS only) → null ("Date not known"). Who: `completed_by` → git author of that add → null.
   If the log couldn't be read, `historyRead: false` and the tab says so in one line, as Asked does.
   Plain: older to-dos that were ticked before the app stamped them still get a sensible date.
3. **Key: `done:todo/done/<id>` and `done:personal/todo/done/<id>`.** Never equal to a `TodoItem.key` or
   `AskedTodo.key`. `parseHistoryKey` learns `done:` keys (TDS → the done folder's history; personal →
   no history, as today for personal).
   Plain: each finished to-do has its own id, so opening one never opens the wrong to-do.
4. **New route `GET ROUTES.doneTodos`** → `DoneTodoList`, everything (no paging) newest-done first. 226
   files ≈ 1 MB; `details` is sent whole so search can match it. Revisit with a cap if it passes ~2,000.
   Plain: one request brings every finished to-do; it's small enough today.
5. **Drawer: a fourth segment, "Done" (no count:** unknown before the lazy load, and four labels are
   tight at 316px). The list lives in a new `DoneList.tsx`, as `AskedList.tsx`. Its own search box, a
   `.field` in `.drawer-tools` as the Skills/Help search, on the Done tab only (title, details, client,
   project words). Client and project filters apply; the kind filter doesn't. Grouped by when done:
   "This week", "Earlier this month", then month names ("October 2026"), "Date not known" last. Rows
   say who ticked it and when. An older server (404) or a failed load shows Asked's failed state with
   Try again. `docs/design-system.md` (the "To-dos drawer has no search row" line) is updated.
   Plain: a Done tab lists the team's finished to-dos, newest first, with a search box.
6. **Opening a done to-do shows it read-only in the panel**, reusing the Asked read view (generalised to
   take a `DoneTodo`): "Done by Ian on 12 Nov", details, files, history. No Edit, Tick or Delete.
   Plain: you can read a finished to-do and its history but not change it.
7. **Project To-dos tab: a "Done (N)" section, folded by default, under the open groups.**
   `ProjectTodosResponse` gains optional `done: ProjectDoneRow[]` and `doneCount` (older servers send
   none → no section). **Built from `listDoneTodos`, injected into `createProjects` like
   `opts.todoList`** (overseer: `TodoRec` has different privacy and date rules and feeds tidy and counts,
   so it isn't extended). Rows match the project by `projectMatch`. Clicking a row opens the read-only
   panel.
   Plain: a project page shows its finished to-dos, tucked away until you open them.
8. **Global search finds done to-dos** in its own async source, "Done to-dos", last, with its own six
   (so done never pushes open ones out); only once the query has text. Hint "Done 12 Nov" plus place.
   Choosing one opens the drawer on the Done tab with that to-do in the panel.
   Plain: finished to-dos get their own search group, clearly marked as done.

8a. **One shared done store** (`client/src/state/todo-done.ts`, modelled on `projectsStore` in
   `client/src/state/projects.ts`): loaded by the Done tab, the search source, or any `done:` panel key,
   refreshed on the brain change stamp. `PanelHost` treats a `done:` key as loading (no 4-second give-up)
   while the store is loading, and shows the `DoneTodo` read-only once found.
   Plain: opening a finished to-do from a project or search never flashes shut.

8b. **Done shows everyone's TDS to-dos plus your own personal ones** (133 of 226 are teammates'), and each
   row names who ticked it. A Mine / Everyone switch is a possible follow-up.
   Plain: searching the app finds finished to-dos too, clearly marked as done.
9. **Help:** `help/todos.md` gets a short "Finished to-dos" section (UK English). No tour step: this
   isn't a new app, rail item or Home feature.
   Plain: the help page says where finished to-dos are.

10. **Teammates' open to-dos open read-only from a project page** (Ian, 2026-11-24, added mid-task: "Show
   everyone's to-dos on the project" → chose "open teammates' to-dos"). A project's To-dos tab already
   lists every TDS to-do in the project, but a teammate's row was plain text. It becomes a button that
   opens the panel read-only, like a done to-do: details, files, history, "With Ben McAdam", due. New
   `GET ROUTES.teamTodo?id=<id>` returns one `TeamTodo` from `todo/` (TDS only, never `personal/`, SAFE_ID,
   no symlinked files; 404 when it has gone). Panel key `team:todo/<id>`; its history uses the plain id
   (the existing item history). The panel waits while it loads and closes if it has gone.
   Plain: on a project page you can open and read any teammate's to-do, but only change your own.

## Open questions for the overseer

Decided by the overseer (2026-11-24): A keep the git fallback (46% have no stamp); B keep the box, Done
tab only, design-system.md updated; C send `details` whole (415 KB today; revisit at ~2,000 files);
D everyone's TDS done to-dos (decision 8b).

## Contract

`shared/contract.ts` (DoneTodo, DoneTodoList, ROUTES.doneTodos) and `shared/projects-contract.ts`
(ProjectDoneRow, ProjectTodosResponse.done / doneCount). Written by the lead before building.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A (server) | `builder`, sonnet | default | `server/brain/todo-done.ts` (+ test), `server/brain/todo-asked.ts`, `server/brain/todo-timeline.ts`, `server/brain/projects.ts`, `server/http/routes.ts`, `server/brain/index.ts`, `server/setup-mode.ts`, server tests |
| Builder B pass 1 (client) | `builder`, sonnet | default | `client/src/api.ts`, `client/src/state/todo-done.ts` (+ test), `client/src/shell/DoneList.tsx`, `client/src/shell/TodosDrawer.tsx`, `client/src/shell/TodoPanel.tsx`, `client/src/shell/words.ts`, `client/src/store.tsx`, `client/src/shell/contract.ts`, `client/src/styles/todo-panel.css`, drawer tests |
| Builder B pass 2 (client, after pass 1) | `builder`, sonnet | default | `client/src/shell/search-sources.ts`, `client/src/shell/Palette.tsx`, `client/src/apps/projects/ProjectTodos.tsx`, `help/todos.md`, `docs/design-system.md`, their tests |
| UX/UI expert | `expert`, opus | domain gate | (read-only) |
| Reviewers | `reviewer`: correctness + privacy (opus), UI (sonnet) | | (read-only) |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/brain/todo-done.test.ts` | lists TDS done + own personal done only; another person's personal file is never listed; date/who fallbacks; newest first; rule files skipped | A |
| `server/brain/todo-timeline.test.ts` | `done:` keys parse; bad ones are refused | A |
| project to-dos test | `done` rows for the project, personal done only for its owner | A |
| route test through `checkRequest` | `GET doneTodos` answers through the real gate | A |
| `client/src/state/todo-done.test.ts` | grouping by when done; search matching; filters | B |
| `client/src/shell/TodosDrawer.done.test.tsx` | Done tab loads, searches, opens read-only panel | B |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (preview in `/tmp/tba-preview-done-todos-search`, port 3878)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: UX/UI expert; privacy (personal to-dos) in the correctness review
- [ ] Browser check: drawer Done tab + search, project To-dos tab, global search

## Review outcomes

<Filled at step 10.>
