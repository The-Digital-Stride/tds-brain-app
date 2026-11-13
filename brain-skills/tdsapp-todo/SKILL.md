---
name: tdsapp-todo
description: Change a loose to-do in todo/ the way the Workbench does, with its known weak spots fixed - add one (for someone or open to anyone), edit its title or details, pass it on to someone else (or make it open to anyone), set or clear its due date, delete it, or tick it off - through one small script, so every tool changes to-do files the same way. USE WHEN asked to add, edit, pass on, re-date, delete or tick a to-do, or someone says "add a to-do", "pass that to Ben", "move the due date", "clear the date", "make it open", "delete that to-do", "tick it off". Not for project to-dos in projects/<name>/todo.md. The TDS Brain app also runs this script for its to-do controls.
version: 0.3
last_updated: 2026-11-13
roles: owner, scout
maturity: draft
members: false
agency: true
---

# tdsapp-todo

One script that changes the files in `todo/` the way the Workbench does: same file names, same
frontmatter, same error messages. The TDS Brain app uses it for its to-do controls, so a change made
here or in the app comes out the same. It was called `todo` until version 0.3; the `todo` skill is now
a stand-in that runs this one.

It's in testing. Only the owner and scouts can use it until Pete, as brain guardian, releases it to
the team. The weak spots it fixes are listed in `os/tds-brain-app/change-requests.md` (BCR-01 to 17).
The Workbench still has them until it's changed too.

## How to run it

Send one JSON object on stdin and name the command:

```bash
echo '{"title":"Renew the Acme contract","due":"2026-12-01"}' \
  | node .claude/skills/tdsapp-todo/scripts/tdsapp-todo.cjs add
```

| Command | Fields | What it does |
|---|---|---|
| `add` | `title`; optional `due`, `assignee`, `open`, `via` | Writes `todo/YYYYMMDD-<slug>.md` dated today, with a name not already used in `todo/`, `todo/done/` or `todo/deleted/`. No assignee means the person in `git config user.name`; `open: true` leaves it open to anyone instead. `via` names the tool, written as `source: added from <via>` (`added with the todo skill` when not sent). |
| `edit` | `file`, `title`; optional `body`, `expect` | Replaces the title. Replaces all the details below the frontmatter only when `body` is sent. When the title really changes, the old one goes under `## Title history` (see below). |
| `due` | `file`, `due`; optional `expect` | Sets the due date (`YYYY-MM-DD`, a real date), or clears it when empty or null. |
| `assignee` | `file`, `assignee`; optional `expect` | Passes it on (a team member's name slug such as `ben-mcadam`), or makes it open to anyone when empty or null. |
| `delete` | `file`; optional `via`, `by`, `by_name`, `expect` | Moves it to `todo/deleted/`, adding `status: deleted`, `deleted` (date), `deleted_at` (UK time), `deleted_by` (`by`, else the person in `git config user.name`) and `deleted_via` (`via`, such as `TDS Brain App`; `todo skill` when not sent), and a "Deleted by … at …" line at the end. An earlier deleted to-do of the same name is kept: the new one gets a number added. |
| `tick` | `file`; optional `via`, `by`, `by_name`, `expect` | Moves it to `todo/done/`, adding `status: done`, `completed`, `completed_at`, `completed_by` and `completed_via` and a "Ticked off by … at …" line, the same record the app writes when you tick a to-do there. |
| `roster` | none | Lists the team from `.team-config/roles.json`. |
| `list` | none | Lists this person's to-dos and the open ones. Each has a `version`. |

`file` is the file name inside `todo/`, such as `20261201-renew-acme-contract.md`.

`expect` is the `version` that `list` gave for that to-do (a fingerprint of the file). Send it when
you've shown someone a to-do and are about to change it: if the file has changed since, nothing is
written and you get status 409, `changed since read`. Read it again and check with the person
before trying again.

It prints one line of JSON. Exit 0 means it worked. Exit 2 means it refused, and the JSON says why
(`error`, with `status` 400 for bad input, 404 when the to-do isn't there, 409 when it changed since
it was read, 500 when the file couldn't be changed). Tell the person in a plain sentence what
changed, or why it didn't.

## What it refuses

It says no, with a clear message, rather than quietly changing what you sent:

- a title over 200 characters, details over 8,000 characters, or an assignee over 40 characters;
- an assignee who isn't on the team in `.team-config/roles.json` (either way of turning their name
  into a slug is accepted; if that file is missing or names nobody, any name is accepted);
- a due date that doesn't exist, such as `2026-02-31`;
- `CLAUDE.md`, `README.md` and `AGENTS.md` in `todo/`, in any mix of capitals;
- a to-do that is a link to another file, or (for `edit`, `due` and `assignee`) one it isn't
  allowed to write.

## How it writes files

- **Titles.** A title that could be misread, such as `ON HOLD: quote`, is put in quotes. When a title
  really changes, the first `#` heading is updated too if it matched the old title (a heading that
  says something different on purpose is left alone), and `- YYYY-MM-DD: was "<old title>"` is added
  under `## Title history` at the end. A change of only capitals, spaces or punctuation updates the
  heading without a history line. This follows "Keeping the title accurate" in `todo/AGENTS.md`.
- **The file as it was.** Windows line endings and a byte order mark are kept, so the sync history
  shows only the lines that changed.
- **All or nothing.** Each change is written to a hidden temporary file in the same folder
  (`.tdsapp-todo-….tmp~`, which the brain's sync ignores) and then swapped in, so a crash can't leave a
  half-written to-do. New files never overwrite an existing one.

## Backward compatibility

Older callers keep working. Every field added in 0.3 is optional, so a request with only the
Workbench's fields (`file`, `title`, `body`, `due`, `assignee`) does what it did before, apart from
the refusals above, the tick record, the title history and the new `source:` wording. Older to-do
files (no frontmatter, Windows line endings, a byte order mark, no `title:` line) are read and
changed as before. The files it writes still read the same on the Workbench, in the Reminders sync
and in the app.

The `todo` skill stays for one release as a stand-in: its script just runs this one, so an older
copy of the app still works. Use `tdsapp-todo`.

## Changing to-dos by hand

When you edit a to-do yourself rather than through the script, the rules in `todo/AGENTS.md` still
apply: keep the file name, update the `#` heading with the title, keep the old title under
`## Title history`, and name new files by the date they should surface.
