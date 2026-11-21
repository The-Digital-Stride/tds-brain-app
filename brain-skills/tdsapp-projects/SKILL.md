---
name: tdsapp-projects
description: Make a project and change its card the way TDS Cortex does - start a project inside a client (or The Digital Stride for internal work, or your own personal space), add a card to an existing project folder, change its status, health light, client-comms light, Account Owner, team, service, dates, budget hours, stages or brief, and link files from elsewhere in the brain to it (or unlink them), and move a project to another client (or from your personal space to a client) - through one small script that writes `project.md` safely and never overwrites anything. USE WHEN someone says "start a project for Skyseal", "new project", "make a website rebuild project for Acme", "add a card to the client-portal project", "set the project to on hold", "the project is amber", "make Steve the Account Owner", "add Simon to the project team", "link the brief to the project", "take that file off the project", "move this project to Skyseal", "this project belongs to Acme, not me". Not for to-dos in a project (use tdsapp-todo's `project` action) or for deleting files (use tdsapp-files). TDS Cortex also runs this script for its Projects app.
version: 0.2
last_updated: 2026-11-21
roles: owner, scout
maturity: draft
members: false
agency: true
---

# tdsapp-projects

One script that makes projects and changes their cards. TDS Cortex runs it for its Projects app, so a
change made here or in the app comes out the same, and nothing else writes a project card.

It's in testing. Only the owner and scouts can use it until Pete, as brain guardian, releases it to
the team.

## Where projects live

Every folder in one of these places is a project, with a card or without one:

| Folder | Key | Notes |
|---|---|---|
| `clients/<client>/projects/<project>/` | `<client>/<project>` | Client work. |
| `clients/the-digital-stride/projects/<project>/` | `the-digital-stride/<project>` | Internal work. |
| `projects/<project>/` | `the-digital-stride/<project>` | The older internal project folders, read where they are. |
| `projects-archive/<project>/`, `clients/_archive/<client>/projects/<project>/` | as above | Archived: read only. |
| `personal/projects/<project>/` | `personal/<project>` | Yours only. Never synced or backed up. |

The key is what everything links by: a to-do's `project:` line, and later time entries. The folder
name never changes after the project is made, so renaming a project (its title) never breaks a link.
Moving a project to another client changes the client half of its key (`acme/website` becomes
`skyseal/website`); the old key is kept on the card's `moved_from:` list, so to-dos and links that
still say the old key keep finding it.
For The Digital Stride, `clients/the-digital-stride/projects/` comes first, then `projects/`, then
`projects-archive/`, so a name can only be used once across all three.

## The card

`project.md` in the project folder: frontmatter, then the brief, then an optional `## Linked files`
section.

```markdown
---
v: 1
title: Website rebuild
client: skyseal
kind: one-off
status: active
health: green
comms: amber
owner: steve-blassberg
team:
  - "simon-jones"
service:
  - "seo"
start: 2026-11-20
end: 2027-02-28
budget_hours: 40
billable: true
stages:
  - "Discovery"
  - "Build"
created: 2026-11-20
created_by: ian-hancock
moved_from:
  - "acme/website-rebuild"
---

Rebuild the site in two phases.

## Linked files

- [Brief.pdf](../../../../clients/skyseal/files/Brief.pdf)
```

- `kind`: `one-off` or `ongoing` (a retainer). `status`: `planned`, `active`, `on-hold` or `done`.
  `health` and `comms`: `green`, `amber` or `red`.
- `owner` is the Account Owner and `team` the people on it, as team slugs from
  `.team-config/roles.json`.
- `budget_hours` is for the whole project when it's one-off, and per calendar month when it's
  ongoing. An ongoing project has no `end`. `end` can't be before `start`.
- `moved_from` lists the keys the project had before it was moved, oldest first, at most 10. Only
  `move` writes it; leave it as it is.
- Empty fields are left out. There's no "updated" stamp: who changed it last comes from git.
- Any other line you add by hand is kept as it is.

## How to run it

Send one JSON object on stdin and name the action:

```bash
echo '{"space":"client","client":"skyseal","slug":"website-rebuild","fields":{"title":"Website rebuild"}}' \
  | node .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs create
```

| Action | Fields | What it does |
|---|---|---|
| `create` | `space` (`"client"` or `"personal"`), `client` (for a client project), `slug`, `fields` (with `title`) | Makes the folder and its card. `slug` is the folder name: lower-case letters, numbers and single dashes, at most 60. Refused with `exists` if the name is used anywhere the key could point, archives included. |
| `card` | `key`, `fields` | Adds a card to a project folder that has none (such as one in `projects/`), titled from its `README.md` heading unless you send a title. Changes nothing else in the folder. |
| `edit` | `key`, `fields`, `expect` | Changes only the fields you send; `null` clears one. `brief` replaces the brief and keeps the linked files. |
| `link` | `key`, `path`, `expect` | Adds a file from the brain to `## Linked files`. `path` is from the brain folder, such as `clients/skyseal/files/Brief.pdf`. Already linked: nothing is written. |
| `unlink` | `key`, `path`, `expect` | Takes that file's line out, and the section once it's empty. The file itself stays where it is. |
| `move` | `key`, `client`, `expect`, optional `dropPersonal: true`, optional `check: true`, optional `filesExpect` | Moves the project's folder to `clients/<client>/projects/` under the same folder name and answers the new key. Works on client projects and personal ones, never into your personal space. See "Moving a project" below. |
| `capabilities` | none | `{"ok":true,"action":"capabilities","version":"0.2","features":["projects-v1","projects-move-v1"]}`. |

`fields` uses the app's names: `title`, `kind`, `status`, `health`, `comms`, `owner`, `team`,
`service`, `start`, `end`, `budgetHours`, `billable`, `stages`, `brief`. `expect` is the SHA-256 of
`project.md` as you read it (`shasum -a 256 project.md`): if the card changed since, nothing is
written and the reply is `changed`.

It prints one line of JSON: `{"ok":true,"action":…,"key":…,"version":…}`, where `version` is the
card's new SHA-256, or `{"ok":false,"error":…,"message":…}`. Exit 0 means it worked, 2 that it
refused (`bad-request`, `not-found`, `exists`, `changed`, `not-allowed`), 1 that something went
wrong. Tell the person in a plain sentence what changed, or why it didn't.

## What it refuses

- Changes to a shared project by anyone not on the team: who you are comes from this Mac's git email
  (or name, when no email is set) in `.team-config/roles.json`, never from what the caller sends.
- A personal project where git doesn't ignore it, or where `personal/` or `personal/projects/` is a
  link, so nothing private is ever synced.
- A personal file linked from a shared project: that would show the team something private.
- Archived projects, a project with no card (except `card`), and a card it can't read, such as one
  holding a merge conflict: fix it by hand first.
- Bad values: an unknown status or light, someone not on the team, more than 20 people, 12 stages or
  200 linked files, a title over 120 characters, a brief over 20,000 characters or with its own
  `## Linked files` heading, dates that don't exist.
- For `link`: anything that isn't a real file of a type the library lists, under `clients/<client>/`,
  `projects/<project>/`, `templates/` or `personal/`, or that goes through a link.

## Moving a project

```bash
echo '{"key":"personal/jev","client":"skyseal","expect":"<sha-256 of project.md>","check":true}' \
  | node .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs move
```

- Send `check: true` first. It writes nothing and adds `check` to the reply: the new `key`, the
  folder's `files` (the first 50) and `fileCount`, `ignoredCount` (files git ignores at the new place:
  they move but stay on this Mac), `personalLinks` (personal files the card links from outside
  its folder) and `filesVersion` (a fingerprint of every file in the folder, ignored ones included).
  Tell the person what will move before you move it.
- Send the check's `filesVersion` back as `filesExpect` with the move. If a file was added to or taken
  out of the folder since the check, the move is refused with `changed`: check again and tell the
  person what will move now.
- Moving a personal project to a client shares everything in its folder with the team. If the card
  links personal files from outside the folder, the move is refused until you unlink them, or send
  `dropPersonal: true` to take those lines off the card as it moves.
- The card is updated as it moves: the old key goes on `moved_from:`, a `client:` line changes to the
  new client, and every `## Linked files` line is written from the new folder (links to files inside
  the folder point into the new one). Nothing else on the card changes.
- Ask the team to sync first: a teammate who adds a file to the old folder before syncing will get a
  sync clash. Files git ignores (and so never synced) can stay behind in the old folder on their Macs;
  the app knows the old key and doesn't show that folder as a project.
- It can't be undone from here, though you can move a client project on to another client.
- Refused: an archived project, one with no card or an unreadable card, one in the older `projects/`
  folder, a move to the client it's already in, a client with no folder, a new key that's already
  used anywhere (archives included) with `exists`, an old key that has another folder behind it
  (such as an archived twin), a folder holding a link, its own `.git`, a hard-linked file or anything
  that isn't a plain file or folder, and a new place git would ignore.
- The folder is renamed in one step on the same disk. If that fails, the card is put back as it was and
  the project stays where it was.

## How it writes files

Each change is written to a hidden temporary file in the same folder (`.tdsapp-projects-….tmp~`) and
then swapped in, so a crash can't leave a half-written card. A new card never overwrites anything.
Windows line endings and a byte order mark are kept, so the sync history shows only the lines that
changed.

## Changing a card by hand

You can, as long as the frontmatter stays flat: text, or lists of `- "item"` lines, no nested keys.
Keep the folder name as it is, and don't move the folder by hand: to-dos link to it. Use `move`.
