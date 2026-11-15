---
name: tdsapp-files
description: Delete an image or document from the library the way TDS Cortex does, put a deleted file back, or see what's been deleted - through one small script that moves the file into tdsapp-deleted/, keeps it for 30 days, then erases it, and writes every delete, put-back and erase to a team log. USE WHEN someone says "delete that file", "delete the old logo from Acme's folder", "put back the file I deleted", "restore the report I deleted yesterday", "what was deleted?", "who deleted that file?", or asks to bin a client file or a template. Only client files (anyone on the team) and templates (the owner only). Not for to-dos (use tdsapp-todo) or personal files. TDS Cortex also runs this script for its bin buttons and its daily clear-out.
version: 0.1
last_updated: 2026-11-15
roles: owner, scout
maturity: draft
members: false
agency: true
---

# tdsapp-files

One script that deletes library files, puts them back and erases them for good after 30 days. The
TDS Cortex runs it for the bin button on library files, so a delete made here or in the app comes
out the same, and nothing else moves or erases these files.

It's in testing. Only the owner and scouts can use it until Pete, as brain guardian, releases it to
the team.

## How it works

- **Delete** moves the file into its own folder in `tdsapp-deleted/`, named for the time it was
  deleted, such as `tdsapp-deleted/20261115-102030-a1b2c3/clients/acme/brand/logo.png`. Next to it,
  `record.json` says where it came from, who deleted it, when, and when it will be erased.
- **Put back** moves it to where it was, making its folder again if that has gone.
- **Erase** happens 30 days after the delete. The app does it when it starts and once a day; run
  `purge` to do it now. Git history still has the file, so it isn't gone from the brain's history.
- **The log**: every delete, put-back and erase adds one line to
  `tdsapp-deleted/log/<your-name>.<this-mac>.jsonl`, which syncs to the whole team. One file per person
  per Mac, so two Macs never write to the same file.

`tdsapp-deleted/` is deleted files, not sources. Don't quote them, search them for facts or use them
as current work.

## How to run it

Send one JSON object on stdin and name the action:

```bash
echo '{"path":"clients/acme/brand/old-logo.png"}' \
  | node .claude/skills/tdsapp-files/scripts/tdsapp-files.cjs delete
```

| Action | Fields | What it does |
|---|---|---|
| `delete` | `path`; optional `expect`, `via`, `by_name` | Moves the file at `path` (from the brain folder, forward slashes) into a new holding folder and logs it. Replies with its `holding` id and `purge_after`. |
| `restore` | `holding`; optional `via`, `by_name` | Puts that holding folder's file back where it was and logs it. |
| `list-deleted` | none | Lists what's waiting in `tdsapp-deleted/`, newest first: path, who, when, when it will be erased, its `holding` id, and `changed_after_deletion` when the file's size no longer matches the record. |
| `purge` | optional `via` | Erases every holding folder more than 30 days old and logs each file erased. |
| `capabilities` | none | `{"ok":true,"action":"capabilities","version":"0.1","features":["files-delete-v1"]}` |

`via` names the tool (such as `TDS Cortex`); it's `tdsapp-files skill` when not sent. `expect` is
the library's version of the file (`<bytes>-<modified time in ms>`): if the file has changed since,
nothing is deleted.

It prints one line of JSON: `{"ok":true,…}` or `{"ok":false,"code":…,"error":…}`. Exit 0 means it
worked, exit 2 means it refused, anything else means something went wrong. The codes are
`bad-request`, `not-found`, `not-allowed`, `changed` (the file changed since it was listed), `exists`
(something is already where the file would go back) and `internal`. Tell the person in a plain
sentence what happened, or why it didn't.

### From a chat

- **"Delete that file"**: confirm the exact file with the person first, then run `delete`. Tell them
  it's kept for 30 days and can be put back.
- **"Put back the file I deleted"**: run `list-deleted`, find the right one by path, person and time,
  check with the person if more than one could fit, then run `restore` with its `holding` id. If it
  says `exists`, a file is already at that path: ask what they want, and never move or overwrite it
  yourself.
- **"What was deleted?"**: run `list-deleted` and give the file names, who deleted each and when, and
  when each will be erased. Mention any marked `changed_after_deletion`: someone edited it after it was
  deleted, so the copy waiting is their newer one.

Never move, copy or erase anything in `tdsapp-deleted/` by hand, and never edit `record.json` or the
log.

## What it refuses

It says no rather than guessing:

- anything outside `clients/<client>/` and `templates/`: personal files, to-dos, `tdsapp-deleted/`
  itself, and the places the library never lists (folders starting with a dot, `node_modules`,
  `clients/_…`, a client's `config/`, `crm/data/` and `context/google-ads/data/`), in any mix of
  capitals;
- templates, unless you're the owner. Who you are comes from this Mac's git email (or name, when no
  email is set) in `.team-config/roles.json`, never from what the caller sends;
- `CLAUDE.md`, `AGENTS.md` and `README.md` anywhere, and a client's `profile.md`;
- anything that isn't an image or document the library lists (png, jpg, jpeg, webp, gif, avif, svg,
  pdf, md, txt, docx, html, htm, csv, xlsx, pptx);
- folders, links, and paths that go through a link;
- files git ignores (kept on one Mac only, such as `clients/*/data/semrush-rankings.csv`), because a
  copy moved into `tdsapp-deleted/` would sync to everyone. It also refuses when git can't check, or
  the brain isn't a git folder;
- putting back over something: it replies `exists` and changes nothing. A `record.json` that's been
  changed by hand gets the same checks as a delete, so it can't put a file anywhere else.

`purge` erases nothing while a git merge or rebase is under way or the brain's sync is running
(`.claude/sync.lockdir`). It only erases a holding folder whose name and `record.json` both say it's
more than 30 days old, and it never touches `log/` or `tdsapp-deleted/README.md`.

## Backward compatibility

Everything it writes is versioned (`"v": 1`), and readers skip fields and actions they don't know.
An app without this skill doesn't show a bin. Older copies of the app and the brain's other skills
don't read `tdsapp-deleted/`.
