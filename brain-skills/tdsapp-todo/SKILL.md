---
name: tdsapp-todo
description: Change a loose to-do in todo/ the way the Workbench does, with its known weak spots fixed - add one (for someone or open to anyone, or a private one in personal/todo/), edit its title or details, pass it on to someone else (or make it open to anyone), set or clear its due date, delete it, tick it off, move it between TDS and personal, put it in a project (with a stage), link a library file or a web page to it (or take one off), add an update to its log, or hand it back to whoever asked - through one small script, so every tool changes to-do files the same way. USE WHEN asked to add, edit, pass on, re-date, delete or tick a to-do, or someone says "add a to-do", "pass that to Ben", "move the due date", "clear the date", "make it open", "delete that to-do", "tick it off", "make that personal", "add a personal to-do", "attach the quote to that to-do", "link the logo to the to-do", "take that file off the to-do", "put that to-do in the website project", "move it to the Build stage", "add an update to that to-do", "say I've sent the quote", "add this link to the to-do", "hand it back to Ben". Not for project to-dos in projects/<name>/todo.md. The TDS Brain app also runs this script for its to-do controls.
version: 0.7
last_updated: 2026-11-27
roles: owner, scout, team
maturity: draft
members: false
agency: true
---

# tdsapp-todo

One script that changes the files in `todo/` the way the Workbench does: same file names, same
frontmatter, same error messages. The TDS Brain app uses it for its to-do controls, so a change made
here or in the app comes out the same. It was called `todo` until version 0.3; the `todo` skill is now
a stand-in that runs this one.

Released to the whole team for the first release (Ian, 2026-11-25). The weak spots it fixes are listed in `os/tds-brain-app/change-requests.md` (BCR-01 to 17).
The Workbench still has them until it's changed too.

## How to run it

Send one JSON object on stdin and name the command:

```bash
echo '{"title":"Renew the Acme contract","due":"2026-12-01"}' \
  | node .claude/skills/tdsapp-todo/scripts/tdsapp-todo.cjs add
```

| Command | Fields | What it does |
|---|---|---|
| `add` | `title`; optional `due`, `assignee`, `open`, `via`, `by`, `scope`, `body`, `client`, `project`, `stage` | Writes `todo/YYYYMMDD-<slug>.md` dated today, with `created_at` (the UK time), with a name not already used in `todo/`, `personal/todo/` or the `done/` and `deleted/` folders of either. No assignee means the person in `git config user.name`; `open: true` leaves it open to anyone instead. `via` names the tool, written as `source: added from <via>` (`added with the todo skill` when not sent). Records `created_by` (`by`, else the git user). A to-do for someone else is stamped as passed on (see below). `scope: "personal"` writes it to `personal/todo/` instead, always for the person adding it. `body` becomes its details, for anyone it's for. `client`, `project` and `stage` put it straight into a project, with the same checks as `project`. |
| `edit` | `file`, `title`; optional `body`, `expect`, `keep_files`, `by`, `by_name`, `via` | Replaces the title. Replaces all the details below the frontmatter only when `body` is sent. When the title really changes, the old one goes under `## Title history` (see below). With `keep_files: true`, `body` is the details without the `## Files` section, and the section already in the file is kept (see below). It never changes the `## Updates` log or the `## Handover history` (see below). If neither the title nor the details really change, nothing is written. |
| `due` | `file`, `due`; optional `expect`, `by`, `by_name`, `via` | Sets the due date (`YYYY-MM-DD`, a real date), or clears it when empty or null. If it's already that, nothing is written. |
| `assignee` | `file`, `assignee`; optional `expect`, `by`, `by_name`, `via`, `note`, `back` | Passes it on (a team member's name slug such as `ben-mcadam`), or makes it open to anyone when empty or null. Records who passed it on (see below). If the assignee is already that, nothing is written (and a `note` is refused, as nothing was passed on). `note` adds an update in the same write. `back: true` makes it a hand back to the person who asked (see below). Not for personal to-dos: move it to TDS first. |
| `delete` | `file`; optional `via`, `by`, `by_name`, `expect` | Moves it to `todo/deleted/`, adding `status: deleted`, `deleted` (date), `deleted_at` (UK time), `deleted_by` (`by`, else the person in `git config user.name`) and `deleted_via` (`via`, such as `TDS Brain App`; `todo skill` when not sent), and a "Deleted by … at …" line at the end. An earlier deleted to-do of the same name is kept: the new one gets a number added. |
| `tick` | `file`; optional `via`, `by`, `by_name`, `expect`, `note` | Moves it to `todo/done/`, adding `status: done`, `completed`, `completed_at`, `completed_by` and `completed_via` and a "Ticked off by … at …" line, the same record the app writes when you tick a to-do there. `note` adds an update first, in the same write. |
| `move` | `file`, `to` (`"personal"` or `"tds"`); optional `scope`, `expect`, `by`, `by_name`, `via`, `dropProject` | Moves your own to-do between `todo/` and `personal/todo/` without changing a byte. Only the person it's assigned to can move it. If the name is taken there, a number is added; the reply's `file` is the new name. A personal to-do in a personal project (`project: personal/…`, or the bare name of one of your personal projects), or one linking a file under `personal/projects/`, only moves to TDS with `dropProject: true`. Then it always loses its `project:` and `stage:` lines and those file links, so a private project's name never reaches the team. Ask the person first. |
| `project` | `file`, `client`, `project`, `stage`; optional `scope`, `expect`, `by`, `by_name`, `via` | Puts the to-do in a project, or takes it out: sets its `client:`, `project:` and `stage:` lines together (null or empty removes a line) and leaves everything else as it was. `project` is a project key: `<client>/<project>` (such as `skyseal/website-rebuild`, or `the-digital-stride/client-portal` for a folder in `projects/`) or `personal/<project>`. `client` must be the key's client (none for a personal project). A stage needs a project. |
| `attach` | `file`, `path`; optional `scope`, `expect`, `by`, `by_name`, `via` | Links a file from the library to the to-do, in its `## Files` section (see below). `path` is from the brain folder, such as `clients/acme/files/quote.pdf`. If it's already linked, nothing is written. A team to-do can't link a file under `personal/projects/` (403); other `personal/` files are fine. |
| `detach` | `file`, `path`; optional `scope`, `expect`, `by`, `by_name`, `via` | Takes that file's link out of the `## Files` section, and the section too once it's empty. The file itself stays where it is. If it isn't linked, nothing is written. |
| `update` | `file`, `text`; optional `scope`, `expect`, `by`, `by_name`, `via` | Adds an update (a note from a person) to the to-do's `## Updates` log (see below). |
| `link` | `file`, `url`; optional `name`, `scope`, `expect`, `by`, `by_name`, `via` | Links a web page (`http://` or `https://` only) in the `## Files` section, named `name` or else the site's name. If that address is already linked, nothing is written. At most 20 links, beside the 20 files. |
| `unlink` | `file`, `url`; optional `scope`, `expect`, `by`, `by_name`, `via` | Takes every link to that exact address out of the `## Files` section, and the section too once it's empty. If it isn't linked, nothing is written. |
| `roster` | none | Lists the team from `.team-config/roles.json`. |
| `list` | none | Lists this person's to-dos and the open ones. Each has a `version`. |
| `capabilities` | none | Says what this script can do: `{"version":"0.7","features":["handover","attach","todo-project-v1","updates-v1","links-v1","scope"]}`. `scope` is there only when personal to-dos are safe to use in this brain (see below). |

`file` is the file name inside `todo/`, such as `20261201-renew-acme-contract.md`.

`scope` picks the folder: leave it out (or send `"tds"`) for `todo/`, send `"personal"` for
`personal/todo/`. It works on `edit`, `due`, `tick`, `delete`, `move`, `update`, `link` and `unlink`; ticked and deleted personal
to-dos go to `personal/todo/done/` and `personal/todo/deleted/`; `attach` and `detach` work there
too. `assignee` refuses a personal to-do: move it to TDS first.

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
someone else records the same frontmatter, without `assigned_from`. Only `assignee` writes that
section: `edit` keeps it as it is, just like the `## Updates` log (see below).

**Handing it back.** When someone has finished their part of a to-do they were given, `assignee`
with `back: true` passes it back to the person who asked. The record also gets `assigned_back: true`
and the history line reads `… Ben McAdam handed it back to ian-hancock (TDS Cortex).` The app works
out who to hand it back to; a later pass-on without `back` replaces the record without that line.

### Projects

A project is a folder: `clients/<client>/projects/<project>/` (internal work under
`clients/the-digital-stride/projects/`, and the older `projects/<project>/` folders), or
`personal/projects/<project>/` for your own. Its key is `<client>/<project>` or `personal/<project>`.
`project` checks the folder is there and writes both `client:` and `project:`, such as
`client: skyseal` and `project: skyseal/website-rebuild`. A team to-do can never be in a personal
project: that would show the team something private, so the script refuses it (`status` 403).
Older labels such as `project: harvey-nash` are left alone until someone tidies them up.

### Files on a to-do

`attach` links a file in a `## Files` section of the to-do's details, one line per file:

```markdown
## Files

- [quote.pdf](../clients/acme/files/quote.pdf)
- [Q3 report.pdf](<../clients/acme/files/Q3 report.pdf>)
- [My notes.pdf](<../personal/files/My notes.pdf>) (only on sam-example's Mac)
```

- The path is written from the to-do's own folder: `../` from `todo/`, `../../` from
  `personal/todo/`. Readers drop every leading `../`, so a link still works once the to-do is ticked
  into `done/`. A path with a space, a round bracket or `<` goes in `<…>`.
- A file in `personal/` never syncs, so its line says whose Mac has it (`by`, else the person in
  `git config user.name`). Teammates see the line but can't open the file.
- A new section goes after the details and before `## Title history`, `## Handover history` or the
  done or deleted note, whichever comes first; with none of those it goes at the end.
- Only `attach` and `detach` change the section. When you change the details with `edit`, send
  `keep_files: true` with the details alone, and the section is kept where it belongs.
- The Workbench, Claude and older apps see the section as ordinary links.

### Updates and links

Every to-do can keep a running log of who did what and when, in an `## Updates` section that only
this script writes and only ever adds to:

```markdown
## Updates

- 27 Nov 2026, 14:05 UK: Ben McAdam (ben-mcadam) wrote: Sent the quote to the client.
  They want it signed by Friday.
- 27 Nov 2026, 14:09 UK: Ben McAdam (ben-mcadam) added a link: Quote on Drive (TDS Cortex).
```

- Each line has the UK date and time, the person's name and their name slug. An update from a person
  (`update`, or the `note` on `assignee` and `tick`) says `wrote:`; a longer one carries on in lines
  indented by two spaces. Tabs become spaces, blank lines are dropped, and it can't hold a code block.
- Every command that really changes an open to-do adds exactly one line: `edit` ("changed the title",
  "changed the details" or both), `due`, `attach`, `detach`, `link`, `unlink`, `project` ("changed the
  project", never naming it) and `update`. A command that changes nothing writes nothing. Passing on
  still goes under `## Handover history`; adding writes `created_at` instead.
- In a personal to-do, the file and link lines leave the name out ("added a file"), so nothing private
  is named if it later moves to the team.
- The section goes after the details and `## Files`, before `## Title history`, `## Handover history`
  or the done or deleted note.
- `edit` never changes it, or the `## Handover history`. Send the details without them: the ones in
  the file are kept. If the details you send do hold one (an older app shows them in the details), it
  must say the same as the one in the file (spaces, blank lines and a `*` or `-` list mark don't
  matter), and the 8,000-character limit counts the details without it. If it says something else,
  such as a paragraph typed below the log, the edit is refused and nothing is written, rather than
  losing what was typed: put new details above the `## Updates` heading. If the file has no such
  section yet, details holding that heading are refused too.
- If the details end inside a code block that is never closed (a line of three backticks or tildes
  with no closing one), the script closes it before it adds a section after it, so the log, the files,
  the title history, the handover history and the done or deleted note are never read as code.

Web links sit in the `## Files` section beside files, one per line, such as
`- [Quote on Drive](https://drive.google.com/file/d/abc/view)`. An address with a round bracket is
written in `<…>`. Only `http://` and `https://` addresses are taken, with no spaces.

The brain merges two people's changes to one to-do line by line (`todo/*.md merge=union` in its
`.gitattributes`), so both people's lines are kept. A merge can leave two `## Updates` or `## Files`
sections, or a frontmatter line twice: readers read every section and take the last copy of a line,
and the next change through this script folds them back into one. One known limit: when two people
add updates of more than one line at about the same time and both end with the very same line, the
merge keeps that line once, so one of the two updates loses its last line.

`expect` is the `version` that `list` gave for that to-do (a fingerprint of the file). Send it when
you've shown someone a to-do and are about to change it: if the file has changed since, nothing is
written and you get status 409, `changed since read`. Read it again and check with the person
before trying again.

It prints one line of JSON. Exit 0 means it worked. Exit 2 means it refused, and the JSON says why
(`error`, with `status` 400 for bad input, 403 when it would put a personal project on a team
to-do, 404 when the to-do isn't there, 409 when it changed since
it was read, 500 when the file couldn't be changed). Tell the person in a plain sentence what
changed, or why it didn't.

## What it refuses

It says no, with a clear message, rather than quietly changing what you sent:

- a title over 200 characters, details over 8,000 characters, or an assignee over 40 characters;
- details with a `## Files` heading on `add`, or on `edit` with `keep_files` (use `attach`);
- details with an `## Updates` or `## Handover history` heading on `add`, or on `edit` when the file
  has no such section yet (use `update`, or `assignee` to pass it on); on `edit`, such a section that
  doesn't say the same as the one in the file;
- an update or note that is empty, over 2,000 characters, holds a control character or a code block;
  a note on `assignee` when nothing is passed on; `back` that isn't `true`, or a hand back to nobody;
- for `link`: an address that isn't `http://` or `https://`, has no site, holds a space, `<`, `>` or a
  backslash, or is over 2,000 characters; a name over 120 characters, on more than one line or with
  `[` or `]`; and a 21st link;
- for `attach`: a path that isn't a real file under `clients/<client>/`, `projects/<project>/`,
  `templates/` or `personal/`; a link, or a path through a link; a type the library doesn't list (images, and pdf,
  md, txt, docx, html, htm, csv, xlsx, pptx); a place the library never lists, such as
  `personal/todo/` or a folder starting with a dot; a name with `>` in it; and a 21st file;
- an assignee who isn't on the team in `.team-config/roles.json` (either way of turning their name
  into a slug is accepted; if that file is missing or names nobody, any name is accepted);
- a due date that doesn't exist, such as `2026-02-31`;
- `CLAUDE.md`, `README.md` and `AGENTS.md` in `todo/`, in any mix of capitals;
- a `scope` other than `tds` or `personal`, and any personal request when personal to-dos aren't
  safe to use here (see above);
- passing on a personal to-do, adding one that's open or for someone else, and moving a to-do that
  isn't yours;
- for `project` (and `add` with a project): a key that isn't well formed or has no folder, a client
  that isn't the key's, a stage over 40 characters or with no project, and a personal project on a
  team to-do; for `move` to TDS, a to-do in a personal project or linking a file in one, unless
  `dropProject` is sent; for `attach` on a team to-do, a file under `personal/projects/`;
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

Everything added in 0.5 is optional too. Without `keep_files`, `edit` replaces the whole body as
before (a `## Files` section included), and `add` without `body` writes what 0.4 wrote. An older
script answers `attach` and `detach` with `unknown command` and ignores `body` on `add`, so a caller
checks `capabilities` for `attach` first. Files linked by a newer script stay readable everywhere:
they're plain markdown links.

Everything added in 0.6 is optional too. `add` without `client`, `project` or `stage` writes what 0.5
wrote, and `move` without a personal project is unchanged. An older script answers `project` with
`unknown command` and ignores the new `add` fields, so a caller checks `capabilities` for
`todo-project-v1` first. The new lines are plain frontmatter that other readers show as text.

Everything added in 0.7 is optional too, but from 0.7 the results are no longer byte-identical to
0.6: every real change made by an older caller also adds a line under `## Updates`, and `add` also
writes `created_at`. Everything added is plain markdown, so the Workbench and the Reminders sync read
the same title, due date, assignee and details, with a few extra lines. `edit`'s reply leaves the log
out of `body`. `edit` now also keeps the `## Handover history` when the body sent leaves it out, and
refuses a body whose log or handover history says something different from the file's. An older app counts the log inside its 8,000-character details limit, so it may refuse
to save the details of a to-do with a long log until it is updated. An older script answers `update`,
`link` and `unlink` with `unknown command` and ignores `note` and `back`, so a caller checks
`capabilities` for `updates-v1` and `links-v1` first.

The `todo` skill stays for one release as a stand-in: its script just runs this one, so an older
copy of the app still works. Use `tdsapp-todo`.

## Detail and checklists

Every to-do you add carries its detail in `body` (what to do, why, and the source), and a to-do
with more than one step uses `- [ ]` checklist items. Full rule: `todo/AGENTS.md`, "Detail and
checklists". Send the detail with `add` and `edit`; don't leave the title to carry it.

## Changing to-dos by hand

When you edit a to-do yourself rather than through the script, the rules in `todo/AGENTS.md` still
apply: keep the file name, update the `#` heading with the title, keep the old title under
`## Title history`, and name new files by the date they should surface. Link files with `attach`
and web pages with `link` rather than by hand, so the path is checked and written the way every
reader expects. Never edit the `## Updates` log or the `## Handover history` by hand: add to them with
`update` and `assignee`.

