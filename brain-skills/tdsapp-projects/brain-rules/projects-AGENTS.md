# Brain edit: `projects/AGENTS.md`

## Why

`projects/` is now the legacy home for internal projects. New internal projects go under The Digital Stride's client folder, with a card, so the app and Claude find them by one key.
Existing folders keep working and count as projects where they are. Nothing is moved.

## Edit 1: say what `projects/` is now

### Current passage

````text
Active projects with deadlines or defined end states. One folder per project.
````

### Proposed replacement

````text
Active projects with deadlines or defined end states. One folder per project.

**This is the older home for internal projects.** New internal projects go in
`clients/the-digital-stride/projects/<slug>/`, each with a `project.md` card (see
`clients/AGENTS.md`, "Projects"). Folders already here keep working: they count as internal
projects where they are, with the key `the-digital-stride/<slug>`, and nothing is moved. To add a
card to one, use the `tdsapp-projects` skill's `card` action.
````

## Edit 2: don't move a finished project

### Current passage

````text
When a project is done, move or archive the folder.
````

### Proposed replacement

````text
When a project is done, set its status to Done (on its card, through `tdsapp-projects`, once it has
one). Don't rename or move the folder: to-dos and file links point at its name.
````

## Archive and delete (tdsapp-projects 0.3)

This edit applies on top of edit 2, which is already in the brain. The "current passage" is its text
as applied. The Command Centre's own "Archive project" button is noted here, not changed: it renames
a clashing folder to `<slug>-2`, which breaks the key.

### Why

A finished project can now be archived with the skill, which keeps its folder name and key. Moving
it by hand (or renaming it on a clash) breaks every to-do and link that names it.

### Edit 3: archive and delete with the skill

#### Current passage

````text
When a project is done, set its status to Done (on its card, through `tdsapp-projects`, once it has
one). Don't rename or move the folder: to-dos and file links point at its name.
````

#### Proposed replacement

````text
When a project is done, set its status to Done (on its card, through `tdsapp-projects`, once it has
one). Don't rename or move the folder: to-dos and file links point at its name. Archive and delete
a project only with the `tdsapp-projects` skill, never by hand: `archive` moves `projects/<slug>/`
to `projects-archive/<slug>/` under the same name, and `delete` removes an archived one for good.
It won't archive a folder a skill or tool in `.claude/skills/` or `tools/` still writes to.
````
