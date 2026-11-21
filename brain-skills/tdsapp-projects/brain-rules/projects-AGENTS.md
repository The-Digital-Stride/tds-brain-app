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
