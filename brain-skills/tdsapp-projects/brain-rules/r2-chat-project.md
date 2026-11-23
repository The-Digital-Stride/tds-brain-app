# Brain rules for Projects R2 phase 1: files made in a project chat

Proposed text for two brain files, for Ian to approve before it is copied in (files only, never git in
the brain). Plan: `docs/plans/2026-11-23-projects-r2-chat-project.md`, decisions 4 and 6.

## Why

TDS Cortex now tells Claude which project a chat is for and to save that work in the project folder.
Sessions outside the app (a terminal, another tool) only have the brain's own rules, and two of them
point the other way: the save table says "A skill's own stated path wins", and `tds-doc` says client
documents go in `reports/`. These edits make the brain say the same as the app, so a document lands in
one place whoever makes it. Private data and the special folders stay as they are.

## Before you start

Apply after TDS Cortex with phase 1 (the version that adds "New chat for this project") is installed.
If a "current passage" no longer matches, the brain file has changed: re-read it and adjust the edit
rather than overwriting.

## 1. `.claude/rules/save-locations.md` (1 edit)

Current passage (the bullet list under the table, first bullet):

```
- Never create a new folder at the brain root, at the `clients/` root or at a client's root.
```

Insert BEFORE it:

```
- When the work is for one project (the person or TDS Cortex names it), the files you make for it
  go in that project's folder, even where a skill or a row above would put a client document in
  `reports/`. These still go where their row says: anything with names, emails, phone numbers or
  addresses (`crm/data/`), call notes, to-dos, dated data pulls and files for an ad platform. Link
  those to the project with the `tdsapp-projects` skill's `link` action, except files in
  `crm/data/` or `personal/`, which are never linked to a shared project.
- When the work is for a client that has open projects and nobody has said which, use the one the
  person names, or ask which project it is for before saving, offering those project folders first.
```

Check after applying: `grep -c "When the work is for one project" .claude/rules/save-locations.md` is 1.

## 2. `.claude/skills/tds-doc/SKILL.md` (1 edit)

Current passage:

```
Client documents go in `clients/<client>/reports/`. Commit both the `.html` and `.pdf`.
```

Replacement:

```
Client documents go in `clients/<client>/reports/`, or in the project's folder
(`clients/<client>/projects/<project>/`) when the work is for a project. Commit both the `.html`
and `.pdf`.
```

Check after applying: `grep -c "when the work is for a project" .claude/skills/tds-doc/SKILL.md` is 1.

## Then

Save and sync as usual so the team gets the text.
