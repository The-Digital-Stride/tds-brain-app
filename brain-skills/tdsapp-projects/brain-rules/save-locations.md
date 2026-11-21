# Brain edit: `.claude/rules/save-locations.md`

## Why

The table sends "ongoing internal project documents" to `projects/`, which is now the legacy home.
Project files need their own rows so every session saves them inside the project folder.

## Edit 1: the project rows

### Current passage

````text
| Ongoing internal project documents | `projects/<project>/` |
````

### Proposed replacement

````text
| A file for one client project: plan, brief, copy, page, notes | `clients/<client>/projects/<project>/`. The folder has a `project.md` card. Never rename or move it. A file kept elsewhere is linked from the card's `## Linked files`, not copied |
| A file for an internal TDS project | `clients/the-digital-stride/projects/<project>/`. Older internal folders in `projects/<project>/` stay where they are |
| A file for your own personal project | `personal/projects/<project>/` (stays on your machine, never shared) |
| A project card (`project.md`) | Made or changed only through the `tdsapp-projects` skill. Never save anything else called `project.md`, `retainer.md` or `summary.md` in a project folder, or use `updates/`, `months/` or `reports/` there for anything but their own purpose |
````

## Edit 2: note under the table

### Current passage

````text
- Every file or folder in `created/` is dated and named for what it is.
````

### Proposed replacement

````text
- Every file or folder in `created/` is dated and named for what it is.
- A new project folder is made with the `tdsapp-projects` skill, never by hand at the brain root,
  the `clients/` root or a client's root. `projects/` at the brain root is the older home for
  internal projects: don't start new ones there.
````
