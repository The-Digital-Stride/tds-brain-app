---
name: tdsapp-todo
description: Change a loose to-do in todo/ the way the Workbench does, with its known weak spots fixed - add one (for someone or open to anyone, or a private one in personal/todo/), edit its title or details, pass it on to someone else (or make it open to anyone), set or clear its due date, delete it, tick it off, or move it between TDS and personal - through one small script, so every tool changes to-do files the same way. USE WHEN asked to add, edit, pass on, re-date, delete or tick a to-do, or someone says "add a to-do", "pass that to Ben", "move the due date", "clear the date", "make it open", "delete that to-do", "tick it off", "make that personal", "add a personal to-do". Not for project to-dos in projects/<name>/todo.md. The TDS Brain app also runs this script for its to-do controls.
version: 0.4
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
| `add` | `title`; optional `due`, `assignee`, `open`, `via`, `by`, `scope` | Writes `todo/YYYYMMDD-<slug>.md` dated today, with a name not already used in `todo/`, `personal/todo/` or the `done/` and `deleted/` folders of either. No assignee means the person in `git config user.name`; `open: true` leaves it open to anyone instead. `via` names the tool, written as `source: added from <via>` (`added with the todo skill` when not sent). Records `created_by` (`by`, else the git user). A to-do for someone else is stamped as passed on (see below). `scope: "personal"` writes it to `personal/todo/` instead, always for the person adding it. |
| `edit` | `file`, `title`; optional `body`, `expect` | Replaces the title. Replaces all the details below the frontmatter only when `body` is sent. When the title really changes, the old one goes under `## Title history` (see below). |
| `due` | `file`, `due`; optional `expect` | Sets the due date (`YYYY-MM-DD`, a real date), or clears it when empty or null. |
| `assignee` | `file`, `assignee`; optional `expect`, `by`, `by_name`, `via` | Passes it on (a team member's name slug such as `ben-mcadam`), or makes it open to anyone when empty or null. Records who passed it on (see below). If the assignee is already that, nothing is written. Not for personal to-dos: move it to TDS first. |
| `delete` | `file`; optional `via`, `by`, `by_name`, `expect` | Moves it to `todo/deleted/`, adding `status: deleted`, `deleted` (date), `deleted_at` (UK time), `deleted_by` (`by`, else the person in `git config user.name`) and `deleted_via` (`via`, such as `TDS Brain App`; `todo skill` when not sent), and a "Deleted by … at …" line at the end. An earlier deleted to-do of the same name is kept: the new one gets a number added. |
| `tick` | `file`; optional `via`, `by`, `by_name`, `expect` | Moves it to `todo/done/`, adding `status: done`, `completed`, `completed_at`, `completed_by` and `completed_via` and a "Ticked off by … at …" line, the same record the app writes when you tick a to-do there. |
| `move` | `file`, `to` (`"personal"` or `"tds"`); optional `scope`, `expect`, `by`, `by_name`, `via` | Moves your own to-do between `todo/` and `personal/todo/` without changing a byte. Only the person it's assigned to can move it. If the name is taken there, a number is added; the reply's `file` is the new name. |
| `roster` | none | Lists the team from `.team-config/roles.json`. |
| `list` | none | Lists this person's to-dos and the open ones. Each has a `version`. |
| `capabilities` | none | Says what this script can do: `{"version":"0.4","features":["handover","scope"]}`. `scope` is there only when personal to-dos are safe to use in this brain (see below). |

`file` is the file name inside `todo/`, such as `20261201-renew-acme-contract.md`.

`scope` picks the folder: leave it out (or send `"tds"`) for `todo/`, send `"personal"` for
`personal/todo/`. It works on `edit`, `due`, `tick`, `delete` and `move`; ticked and deleted personal
to-dos go to `personal/todo/done/` and `personal/todo/deleted/`. `assignee` refuses a personal
to-do: move it to TDS first.

### Personal to-dos

`personal/todo/` is for to-dos only you see. It's never synced, so the Workbench, the Reminders sync
and the rest of the team don't see them, and they aren't backed up. The script only works there when
the brain isn't a git folder, or git ignores `personal/todo/` with its `done/` and `deleted/` folders
and every file it writes there, and tracks nothing in `personal/todo/`. None of `personal`,
`personal/todo`, `personal/todo/done` or `personal/todo/deleted` may be a link to another folder.
Otherwise every personal request is refused, so nothing private is synced by mistake. A personal to-do can't be open to anyone or passed on: move it to TDS first.

### Passing a to-do on

When `assignee` really changes who has it, the script records it in the frontmatter
(`assigned_to`, `assigned_at` in UK time, `assigned_by`, `assigned_from`, `assigned_via`, replacing
any earlier ones; `open` stands for nobody) and adds a line for people under `## Handover history` at
the end, such as `- 13 Nov 2026, 14:05 UK: Ben McAdam passed it from ben-mcadam to ian-hancock (TDS Brain App).`
Who did it is `by` and `by_name`, else the person in `git config user.name`. Adding a to-do for
someone else records the same frontmatter, without `assigned_from`.

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
- a `scope` other than `tds` or `personal`, and any personal request when personal to-dos aren't
  safe to use here (see above);
- passing on a personal to-do, adding one that's open or for someone else, and moving a to-do that
  isn't yours;
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

Everything added in 0.4 is optional too. Without `scope`, `edit`, `due`, `tick`, `delete`, `roster`
and `list` give exactly what 0.3 gave. `add` now also writes `created_by`, and `assignee` records the
handover; other tools that read to-dos skip these new lines. An older script answers `capabilities`
with `unknown command`, which is how a caller can tell.

The `todo` skill stays for one release as a stand-in: its script just runs this one, so an older
copy of the app still works. Use `tdsapp-todo`.

## Changing to-dos by hand

When you edit a to-do yourself rather than through the script, the rules in `todo/AGENTS.md` still
apply: keep the file name, update the `#` heading with the title, keep the old title under
`## Title history`, and name new files by the date they should surface.
