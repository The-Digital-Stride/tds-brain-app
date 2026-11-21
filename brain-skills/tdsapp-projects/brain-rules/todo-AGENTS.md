# Brain edit: `todo/AGENTS.md`

## Why

A to-do's `project:` was a free label. It now holds a project key that points at a real project folder, with an optional stage.
Old labels keep working and are only changed when someone tidies them up in the app.

## Edit 1: the frontmatter example

### Current passage

````text
project: optional-project-slug
````

### Proposed replacement

````text
client: optional-client-slug
project: optional-project-key
stage: optional stage name
````

## Edit 2: add a "Project" section

Paste it directly before "## Todo vs Project".

### Current passage

````text
## Todo vs Project
````

### Proposed replacement

````text
## Project and stage

- `project:` holds the full project key: `<client>/<slug>` (for example `skyseal/website-rebuild`;
  `the-digital-stride/<slug>` for internal work) or `personal/<slug>`. Set `client:` to the key's
  client too. A personal project has no `client:`.
- `stage:` is optional and names one of the project card's stages (Discovery, Build, Launch).
- **A shared to-do never takes a `personal/` key.** That would show the team a private project's
  name. The script refuses it.
- **Use `tdsapp-todo`'s `project` action** to put a to-do in a project or take it out. It checks
  the project exists and writes `client:`, `project:` and `stage:` together.
- Older labels (such as `project: harvey-nash`) keep working and are left alone. Don't rewrite them
  by hand: the app's tidy-up screen proposes a mapping and the person approves it.

## Todo vs Project
````

## Edit 3: promoting a to-do

### Current passage

````text
A todo is a single task. When it grows scope and a deadline, promote it to `projects/<name>/` and delete the todo file.
````

### Proposed replacement

````text
A todo is a single task. When it grows scope and a deadline, make it a project with the
`tdsapp-projects` skill (`clients/<client>/projects/<name>/`, or `clients/the-digital-stride/projects/<name>/`
for internal work) and delete the todo file. Smaller pieces of the same project stay as to-dos with
`project:` set.
````
