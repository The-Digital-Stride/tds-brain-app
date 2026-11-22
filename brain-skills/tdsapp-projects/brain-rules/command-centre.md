# Workbench (command-centre) patch

Why: the brain's Workbench must look the same for people not using TDS Cortex, and also show projects now kept at `clients/<client>/projects/<slug>/project.md`.

What changes (`tools/members/command-centre`):
- `lib/todo-parser.cjs`: `getProjectsList()` is unchanged apart from skipping dot-folders and card-less ghost folders (archived, or listed in a live card's `moved_from`). New `getCardProjects()`, `projectLabel()`; `getMiscTodos()` gains an optional `projectLabel`.
- `server.cjs`: `/api/projects` adds an optional `cardProjects`; dispatch and project tick accept a card key resolved from the server's own scan (unknown key: 400); archive refuses a clash with 409 and no longer renames to `-2`; `/api/todos/add` takes an optional `project` (a scanned live key only) and writes `client:` and `project:` after `due:`.
- `public/js/cc.js`, `public/css/cc.css`: card projects after the legacy cards, to-do labels show the project title. All new fields are optional, so the new page works against an old server.

Apply (from inside `tools/members/command-centre`, file writes only, no git):
    patch --dry-run -p1 < command-centre.patch
    patch -p1 < command-centre.patch
Stop on any mismatch. Restart the Workbench server afterwards if it was started from a terminal.

Check:
- `node --check lib/todo-parser.cjs server.cjs public/js/cc.js`
- Open the Workbench: legacy cards unchanged; Cortex projects appear after them with their to-dos; a to-do tied to a project shows the project title.
