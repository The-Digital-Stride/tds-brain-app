# Brain edit: `personal/AGENTS.md`

## Why

Personal projects need a fixed private home, so the app and Claude never put one where it would sync.
They stay on your machine like everything else in `personal/`.

## Edit 1: add a "Personal projects" section

Paste it directly before "## Two things to know".

### Current passage

````text
This `AGENTS.md`, and the short `CLAUDE.md` pointing at it, are the only files in here that sync, because they are the shared explanation. Everything else you add stays local.
````

### Proposed replacement

````text
This `AGENTS.md`, and the short `CLAUDE.md` pointing at it, are the only files in here that sync, because they are the shared explanation. Everything else you add stays local.

## Personal projects

Your own projects live in `personal/projects/<slug>/`, each with a `project.md` card, and stay
private like the rest of this folder. The key is `personal/<slug>`, and your personal to-dos
(`personal/todo/`) can use it as their `project:`. Make and change them with the `tdsapp-projects`
skill. Never rename the folder after it's made.

A personal project is never shared. A team to-do, a shared project or a client folder must not
link to it or name it. To share one, move it to the client (or The Digital Stride) with the
`tdsapp-projects` skill's `move`: everything in its folder is then shared with the team.
````
