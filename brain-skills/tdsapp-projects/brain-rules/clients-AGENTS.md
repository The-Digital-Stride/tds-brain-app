# Brain edit: `clients/AGENTS.md`

## Why

Client projects get one fixed home inside the client's folder, so the folder tree itself shows Client then Project.
Every Claude session needs the layout, the permanent folder name and the reserved names, or it will save project files in the wrong place.

## Edit 1: add `projects/` to the layout

### Current passage

````text
    plans/              <- Plans we write for the client: campaign plans, build specs, strategy
````

### Proposed replacement

````text
    projects/           <- One folder per project, each with a project.md card (see "Projects")
    plans/              <- Plans we write for the client: campaign plans, build specs, strategy
````

## Edit 2: add a "Projects" section

Paste it directly after the "Call notes" section, before "## Landing pages".

### Current passage

````text
Each folder has a `README.md` with the same guidance. New clients get the folder from
`client-setup`, or create it by hand.
````

### Proposed replacement

````text
Each folder has a `README.md` with the same guidance. New clients get the folder from
`client-setup`, or create it by hand.

## Projects

**A project is a folder with a card:** `clients/<client>/projects/<slug>/project.md`. The
card is a short file (frontmatter, then the brief) holding the title, status, health and
client-comms lights, Account Owner, team, dates and budget hours. Internal TDS work uses
`clients/the-digital-stride/projects/<slug>/`. The older `projects/<slug>/` folders still count as
internal projects where they are.

- **The folder name is permanent.** To-dos, file links and later time reports all link by the
  key `<client>/<slug>`, so never rename or move a project folder by hand. The title can change
  freely. To move a project to another client, use the `tdsapp-projects` skill's `move`: old links
  keep working.
- **Files saved inside the folder belong to the project.** Plans, briefs, copy and pages for one
  project go there. A file kept elsewhere (or used by two projects) stays where it is and is
  listed in the card's `## Linked files`. Don't copy it in.
- **Reserved names inside a project folder:** `project.md`, `retainer.md`, `summary.md`,
  `updates/`, `months/` and `reports/`. Don't use them for anything else, and never delete the
  first four (`project.md`, `retainer.md`, `updates/`, `months/`): the app hides and protects them.
- **Change a card only through the `tdsapp-projects` skill** (create, card, edit, link, unlink).
  It writes safely and records who made the change. If you must edit one by hand, keep the
  frontmatter flat (text, or lists of `- "item"` lines) and leave the folder name alone.
- **To-dos in a project** are set with `tdsapp-todo`'s `project` action (see `todo/AGENTS.md`).
- A project with no card is still a project. Add one with the skill's `card` action.
````

## Edit 3: new clients

### Current passage

````text
`config/`, `created/`, `context/memory/` and `context/analysis/` are deliberately NOT
pre-created: the skills that own them create them on demand, with their own internal
````

### Proposed replacement

````text
`config/`, `created/`, `projects/`, `context/memory/` and `context/analysis/` are deliberately NOT
pre-created: the skills that own them create them on demand, with their own internal
````

## Archive and delete (tdsapp-projects 0.3)

The edits below apply on top of edits 1 and 2, which are already in the brain. The "current
passage" is their text as applied.

### Why

A finished project now moves to `projects-archive/` beside `projects/`, keeping its name and key, so
every to-do and link still finds it. Archiving or deleting by hand would break those links, or leave
a half-deleted project for the team to sync.

### Edit 4: add `projects-archive/` to the layout

#### Current passage

````text
    projects/           <- One folder per project, each with a project.md card (see "Projects")
````

#### Proposed replacement

````text
    projects/           <- One folder per project, each with a project.md card (see "Projects")
    projects-archive/   <- Archived projects, same folder names (see "Projects")
````

### Edit 5: archive and delete with the skill

#### Current passage

````text
- **Change a card only through the `tdsapp-projects` skill** (create, card, edit, link, unlink).
````

#### Proposed replacement

````text
- **Archive and delete a project only with the `tdsapp-projects` skill, never by hand.** `archive`
  moves the folder to `clients/<client>/projects-archive/<slug>/` under the same key, so to-dos and
  links keep working, and `unarchive` brings it back. `delete` removes it for good (only an archived
  project, or one holding nothing but its card; only its Account Owner or the brain's Owner). Never
  rename a project to `<slug>-2` or similar to make room.
- **Change a card only through the `tdsapp-projects` skill** (create, card, edit, link, unlink).
````
