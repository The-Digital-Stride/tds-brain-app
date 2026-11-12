---
name: todo
description: Change a loose to-do in todo/ exactly as the Workbench does - add one, edit its title or details, pass it on to someone else (or make it open to anyone), set or clear its due date, delete it, or tick it off - through one small script, so every tool changes to-do files the same way. USE WHEN asked to add, edit, pass on, re-date, delete or tick a to-do, or someone says "add a to-do", "pass that to Ben", "move the due date", "clear the date", "make it open", "delete that to-do", "tick it off". Not for project to-dos in projects/<name>/todo.md. The TDS Brain app also runs this script for its to-do controls.
version: 0.1
last_updated: 2026-11-12
roles: owner, scout
maturity: draft
members: false
agency: true
---

# todo

One script that changes the files in `todo/` the same way the Workbench does: same file names,
same frontmatter, same limits, same error messages. The TDS Brain app uses it for its to-do
controls, so a change made here, in the app or on the Workbench comes out identical.

It's in testing. Only the owner and scouts can use it until Pete, as brain guardian, releases it
to the team. Known weak spots it copies from the Workbench are listed in
`os/tds-brain-app/change-requests.md`; don't work around them here.

## How to run it

Send one JSON object on stdin and name the command:

```bash
echo '{"title":"Renew the Acme contract","due":"2026-12-01"}' \
  | node .claude/skills/todo/scripts/todo.cjs add
```

| Command | Fields | What it does |
|---|---|---|
| `add` | `title`, `due` (optional), `assignee` (optional) | Writes `todo/YYYYMMDD-<slug>.md` dated today. No assignee means the person in `git config user.name`. |
| `edit` | `file`, `title`, `body` (optional) | Replaces the title. Replaces all the details below the frontmatter only when `body` is sent. |
| `due` | `file`, `due` | Sets the due date (`YYYY-MM-DD`), or clears it when empty or null. |
| `assignee` | `file`, `assignee` | Passes it on (a name slug such as `ben-mcadam`), or makes it open to anyone when empty or null. |
| `delete` | `file` | Removes the file for good. |
| `tick` | `file` | Moves it to `todo/done/`. |
| `roster` | none | Lists the team from `.team-config/roles.json`. |
| `list` | none | Lists this person's to-dos and the open ones. |

`file` is the file name inside `todo/`, such as `20261201-renew-acme-contract.md`.

It prints one line of JSON. Exit 0 means it worked. Exit 2 means it refused, and the JSON says why
(`error`, with `status` 400 for bad input, 404 when the to-do isn't there, 500 when the file
couldn't be changed). Tell the person in a plain sentence what changed, or why it didn't.

## Changing to-dos by hand

The script doesn't follow every rule in `todo/AGENTS.md` yet. When you edit a to-do yourself
rather than through the script, those rules still apply: keep the file name, update the `#`
heading with the title, keep the old title under `## Title history`, and name new files by the
date they should surface.
