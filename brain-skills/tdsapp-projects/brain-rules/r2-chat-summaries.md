# Brain rules for Projects R2 phase 5b: chat summaries

Proposed text, copied into the brain straight after the merge (files only, never git in the brain), together
with `tdsapp-projects` 0.7.0 (script and SKILL.md). Plan: `docs/plans/2026-11-24-chat-summary-updates.md`,
decisions 1 and 2.

## Why

A project's Updates can now hold a **chat summary**: what a TDS Cortex chat set out to do, what came of it, key
figures, linked documents and next steps. The person presses **Save to project** in the chat, checks and edits
Claude's draft, and the app saves it with the `tdsapp-projects` skill's `update` action (`kind: chat`). Claude
never writes one itself: the review step is the point. Sessions outside the app should say the same.

## Before you start

If a "current passage" no longer matches, the brain file has changed: re-read it and adjust the edit rather
than overwriting.

## 1. `.claude/skills/tdsapp-projects/` (copy)

Copy `brain-skills/tdsapp-projects/SKILL.md` and `scripts/tdsapp-projects.cjs` (version 0.7.0) over the brain's
0.6.0 copy (without `test/`). Nothing else in the brain changes for the script: 0.6 calls behave exactly as
before, and `capabilities` now also lists `projects-chat-summary-v1`.

## 2. `.claude/rules/save-locations.md` (1 edit)

This applies on top of the email edit in `r2-email.md`. The brain's `save-locations.md` text for update kinds
isn't in this folder's `save-locations.md` (that file only covers project folders), so this adds one sentence
after the email bullet.

Current passage (the last sentence of the email bullet, as applied from `r2-email.md`):

```
  email entry or note yourself, and never open the `briefing/email-drafts/` folder. Email from someone
  else's inbox never goes in; ask its owner to add it.
```

Replacement:

```
  email entry or note yourself, and never open the `briefing/email-drafts/` folder. Email from someone
  else's inbox never goes in; ask its owner to add it.
- A summary of a chat goes into a project only through **Save to project** in TDS Cortex, where the person
  reviews the draft first. Never write a `chat` entry or a note standing in for one; if asked to log, save
  or summarise the chat on a project, tell the person to press Save to project.
```

## Greps after copying

- `grep -c "projects-chat-summary-v1" .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs` → at least 1
- `grep -c "^version: 0.7.0" .claude/skills/tdsapp-projects/SKILL.md` → 1
- `grep -c "Save to project" .claude/rules/save-locations.md` → 1
- `echo '{}' | node .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs capabilities` lists `projects-chat-summary-v1`
