# To-dos are called tasks (wording only)

Date: 2026-11-24 · Size: L · Branch: `todos-to-tasks-wording` · Explainer: none

## Objective

From Monday 30 November the team says "tasks", not "to-dos". Every word a person reads in Cortex follows, so the switch-over is simple. Nothing underneath changes, so Cortex keeps working with the agency brain's `todo/` files, skills, the Workbench parser, the Reminders sync and older installed copies of the app.

## User decisions (fixed)

- Reverses the 2026-11-21 "keep to-dos" decision. The new word is **task / tasks** ("Tasks" as a name or label).
- **Frontend words only**: the app's labels, messages, errors, help, tour and screenshots. No code, route, file, folder, key or skill names change.
- **Ad Manager stays exactly as it is** for now: nothing under `client/src/tools/ad-manager/`, `client/src/styles/ad-manager.css`, `server/brain/ads-*` or the ads help pages (`ad-manager.md`, `ads-*.md`) changes, including its one "to-do" mention.
- **Chats say "tasks" too**: the app adds one line to its own chat instructions. The brain's skills and files are not touched.
- Land: merge and push once built, checked and reviewed.
- Keep a later full migration in mind (if the agency brain moves to "tasks"), but don't build it.

## Contract: the word map

Every builder uses exactly these swaps in text a person reads. Sentence case as today.

| Was | Now |
|---|---|
| to-do / to-dos | task / tasks |
| To-do / To-dos (label, rail, drawer, tab, heading, search group) | Task / Tasks |
| To-dos drawer, To-dos tab, to-do panel | Tasks drawer, Tasks tab, task panel |
| Add a to-do | Add a task |
| Done to-dos, Favourite to-dos, personal to-dos, Whose to-dos | Done tasks, Favourite tasks, personal tasks, Whose tasks |
| Previous to-do (P) / Next to-do (N) | Previous task (P) / Next task (N) |
| a to-do / an open to-do | a task / an open task |
| Show N more to-do / to-dos (ShowMore noun) | task / tasks |
| Let the app change to-dos (Settings switch, `SettingsView.tsx:157`, `routes.ts:787`, help pages) | Let the app change tasks |
| To-dos and chats, All to-dos, To-do added:, To-do done: | Tasks and chats, All tasks, Task added:, Task done: |
| "the todo skill" in user text (`AskedList.tsx:165`) | keep the skill name exact; reword the sentence around it to say task |

Server log lines (`server/http/routes.ts` and others) follow the map too, so the guard's allowlist stays small.

Never changes (the "underneath" list):

- Identifiers, types, function and file names (`TodoItem`, `TodosDrawer.tsx`, `todoChatDraft`, `todosRailLabel`, `DrawerName` value `'todos'`), CSS classes, `data-*` attribute **names**, ids such as `go-todos`.
- API routes (`/api/todos/*`, `/api/misc-todos`), SSE and event names, localStorage keys, prefs fields, settings keys.
- Help page ids, file names, `area: todos`, `related:` ids, image file names (`todo-add.webp` and so on), `shots.json` ids.
- The brain: the `todo/` and `personal/todo/` folders, the `todo` and `tdsapp-todo` skills, everything in `brain-skills/` and `scripts/help-demo/brain/`, the markdown format, and any text the app passes to the brain's script.
- Paths and skill names that appear inside user text keep their exact spelling ("`todo/20261116-…md`", "tdsapp-todo").
- Code comments (US English and old words are fine in code), `docs/plans/*`, `CHANGELOG.md`, and past `help/whats-new/*.md` pages (history stays as it shipped).

## Decisions

1. **Words only, by hand, no runtime word constant.** Each string is edited in place with the word map. A shared `TASK_WORD` constant would make every sentence a template and the grammar ("a task", plurals) harder to read; the guard test (decision 9) does the job of keeping it consistent.
   Plain: people see "task" everywhere; nothing that saves or reads tasks changes.
2. **The rail label changes, so its selector follows.** `Rail.tsx` `DRAWER_LABELS.todos` and the rail button's `label` become "Tasks". That changes the `data-dock-label` *value*, so the tour anchor in `client/src/tour/steps.ts` (`button.rail-item[data-dock-label="To-dos"]`) and any test or CSS selecting on that value change with it. The keyboard hint stays **T**.
   Plain: the Tasks button sits where To-dos was, the T key still opens it, and the tour still points at it.
3. **The old word still finds Tasks (overseer S2).** Only the Go to entry gets old-word terms: add an optional `terms` to `GoTo` (`search-sources.ts` ~line 83) and pass them as `fields` in the `goTo` source (~line 384) instead of `[]`; the Tasks entry's terms are `['to-do', 'to-dos', 'todo', 'todos']`. The Tasks group itself is left alone (otherwise "to-do" would list every task). Help finds "to-do" through the sentence "Tasks used to be called to-dos" on `help/todos.md` and the glossary.
   Plain: typing the old word jumps to Tasks without flooding the results.
4. **Text the person sees and Claude reads becomes "task".** The chat draft from a task (`todoChatDraft`: "Help me with this to-do: …") becomes "Help me with this task: …". The path in it stays exact. Instructions only Claude reads (`session-manager.ts` lines ~703 and ~716 that name the `tdsapp-todo` skill, `context-policy.ts` "To-do for this chat:") stay as they are, because they name the brain's skill and files; the builder checks each one is truly hidden from people before leaving it.
   Plain: what you see in the message box says task; Claude still finds the right brain files.
5. **One chat line tells Claude the word.** Add `TASKS_WORD_LINE` to the `appendLine` list in `server/engine/session-manager.ts` (next to `FILES_LINE`), straight after `FILES_LINE`, for every chat: "The team calls to-dos 'tasks'. Say task or tasks to the person, and when they say task they mean a to-do in the brain. Underneath nothing is renamed: keep the `todo/` folder, the `todo` and `tdsapp-todo` skills and every path as they are. Ad Manager's scheduled tasks are a separate thing." The exact-match `appendLine` assertions in `server/engine/session-manager.test.ts` (about ten, e.g. lines 443, 539, 1527, 3692, 3704, 4983, 6334, 6571) are updated. The demo engine's canned text says "tasks" too.
   Plain: Claude's replies match the screens, without touching the brain.
6. **Errors and messages from the server say "task".** User-visible error and status strings in `server/http/routes.ts`, `server/brain/*.ts` and `server/engine/session-manager.ts` (for example "That to-do is not on your list any more.") follow the word map. Strings matched by tests or by the client (error codes, `kind` values) don't change; only their human text does.
   Plain: a problem message says "task" too.
7. **Help.** Help pages' titles, summaries, benefit lines and text follow the map; ids, file names, `area`, `related` and image names stay. `help/glossary.md`'s `### to-do` entry becomes `### task` with "Tasks used to be called to-dos." (one entry, no second one). The glossary headings are pinned by `client/src/help/help.test.ts:85` to `HELP_GLOSSARY_TERMS`, so Builder A changes `client/src/help/contract.ts:97` to `'task'` and the area label at line 27 to `'Tasks'` in step with Builder C. `reviewed:` dates move to 2026-11-24 on pages changed. Ad Manager pages are left alone. A new What's new page announces it in two or three plain sentences (version set at merge time to the version the merge produces).
   Plain: the help reads the same as the screens, and the What's new note tells people about the new word.
8. **Screenshots retaken.** Help images that show the word (`todo-add.webp`, `todo-edit.webp`, `todos-drawer.webp`, `settings-todos-switch.webp`, plus any other shot in `help/shots.json` whose picture shows "To-do") are retaken with `pnpm help:shots` after the build, same file names.
   Plain: the pictures match the words.
9. **A guard test stops "to-do" creeping back.** `scripts/wording.test.ts` (vitest only includes `scripts/`, `server/`, `shared/`, `client/src/`, `brain-skills/`) scans `client/src/**/*.{ts,tsx,css}`, `server/**/*.ts` and `shared/**/*.ts` (not tests), `help/*.md` (not `whats-new/`) and the alts in `help/shots.json`, and fails on `to-do` (any case, singular or plural). Overseer S1: strip **whole-line** comments only (`//…`, `/* … */` blocks, `{/* … */}`), never inline regex stripping, so a miss fails loudly rather than hiding text (the stripper in `client/src/styles/design-system.test.ts:29` swallows code after glob strings such as `'/**'`). The allowlist is by file plus exact text (never line numbers), each with a reason: Ad Manager files, the instructions-to-Claude lines in decisions 4 and 5, and the "used to be called to-dos" lines. The test also asserts it scanned a sensible number of files and that its matcher flags a sample string. Other sessions adding "to-do" copy on open branches are caught when they merge.
   Plain: new screens can't quietly bring back the old word.
10. **No tour re-show.** The tour text and anchor change, but `TOUR_VERSION` stays: nothing new was added, and re-showing the whole tour for a rename would be noise. The What's new note is how people hear about it.
    Plain: people aren't sent round the tour again just for a new word.
11. **Developer docs that quote the UI follow.** `docs/design-system.md` and `README.md` quote labels such as "Add a to-do" and "To-dos drawer"; those quotes follow the map so the design rules still match the screens. Other wording in them may stay.
    Plain: the design rulebook names buttons as they now read.
12. **Version.** Commit as `refactor(ui): …` and `fix(help): …` so it ships as a patch release (a rename adds nothing new; see the commit-type rule).
    Plain: it goes out as a small update.

## Later: a full migration (not built now)

If the agency brain moves to "tasks", the app would need, in this order and each backward compatible: read both `todo/` and `task/` folders; accept `/api/tasks/*` as an alias of `/api/todos/*`; skill name aliases (`task` → `todo`, `tdsapp-task` → `tdsapp-todo`) found by both names until every installed app has updated; then rename code identifiers in one mechanical pass. This plan keeps every code name stable so that later pass is a clean, separate job, and the guard test's allowlist shrinks as each step lands.

## Backward compatibility

- Old files → new app: unchanged reading and writing; only labels differ.
- New app → old readers (Workbench `lib/todo-parser.cjs`, `~/.plaud-reminders/todo-sync.mjs`, `frontmatter.ts`): nothing written changes.
- Old app ↔ new app on the same team: older copies still say "to-do" until they update; same data, so no conflict. Routes and prefs are unchanged.
- Stricter checks: none added.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A | `builder`, sonnet | default | `client/src/**` except `client/src/apps/projects/**` and `client/src/tools/ad-manager/**`, with their tests |
| Builder B | `builder`, sonnet | default | `client/src/apps/projects/**`, `server/**` (not `server/brain/ads-*`), `shared/**`, with their tests |
| Builder C | `builder`, sonnet | default | `help/*.md` (not `whats-new/` history, not ads pages), `help/glossary.md`, `help/shots.json` (alts must equal the pages' alts, `client/src/help/checks.ts:262`), `scripts/help-shots.ts` (selectors on "To-dos"/"Add a to-do"), `docs/design-system.md`, `README.md`, `scripts/wording.test.ts` |
| Lead | — | — | new `help/whats-new/<version>.md` (named for the version the merge produces), `client/src/help/whats-new.test.ts:88`, retaking every screenshot (`pnpm help:shots`), commits |

Tests cross areas: each builder changes a test only where its own edit makes it fail; the lead runs the full check once all three finish. What's new wording (overseer S6): "To-dos are now called tasks. Nothing else has changed. The team switches to the new word on Monday 30 November."

No file appears in two rows.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `scripts/wording.test.ts` | no "to-do" left in user-facing text outside the allowlist (written first; fails until A and B finish) | Builder C |
| `client/src/shell/search-sources.test.ts` | "to-do" and "todo" still find the Tasks Go to entry | Builder A |
| `server/engine/session-manager*.test.ts` | every new chat's `appendLine` carries `TASKS_WORD_LINE` | Builder B |
| existing tests asserting "To-do" text | updated to "Task" with no change in what they prove | A and B, each their own |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (preview on 3878 from `/tmp/tba-preview-todos-to-tasks-wording`)
- [ ] No unintended large deletions: `git diff origin/main --numstat | awk '$2 > 40'`
- [ ] Identifier freeze: `git diff origin/main` shows no renamed file, route, key, id or exported name
- [ ] Domain gates: UX/UI expert critique of the wording and screens
- [ ] Browser check: rail, Tasks drawer (all tabs), task panel (read, edit, add), Home cards, search ("to-do" and "task"), a project's Tasks tab, Settings switch, tour step, help pages

## Review outcomes

(Filled at step 10.)
