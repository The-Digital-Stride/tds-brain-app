# Brain rules for Projects R2 phase 2: the updates log

Proposed text for Ian to approve before it is copied in (files only, never git in the brain). Plan:
`docs/plans/2026-11-23-projects-r2-updates-log.md`, decision 7.

## Why

`tdsapp-projects` 0.4 adds an `update` action that writes a dated entry into a project's `updates/` folder.
After a call about a project, the most useful entry is a one-line "what was agreed". The meeting-notes
skill already offers follow-ups after filing; this adds one more choice there, so the project's diary keeps
up without anyone having to remember.

## Before you start

1. Copy `brain-skills/tdsapp-projects/` (SKILL.md and `scripts/tdsapp-projects.cjs`, version 0.4) into the
   brain's `.claude/skills/tdsapp-projects/`, replacing 0.3.2.
2. Apply the edit below. If the "current passage" no longer matches, the brain file has changed: re-read
   it and adjust the edit rather than overwriting.

## 1. `.claude/skills/meeting-notes/SKILL.md` (2 edits, step 9)

Current passage:

```
**[Ask]** once, as a multi-select with these three options plus "None for now". Each
```

Replacement:

```
**[Ask]** once, as a multi-select with these options plus "None for now" (offer (d) only
when the meeting was about a project that is open). Each
```

Current passage (end of step 9's list):

```
- **(c) Anything client-facing** — a follow-up email or summary doc. Draft, never send
  (house rule), and build documents with `tds-doc`.
```

Replacement:

```
- **(c) Anything client-facing** — a follow-up email or summary doc. Draft, never send
  (house rule), and build documents with `tds-doc`.
- **(d) A project update.** One or two sentences on what was agreed, added to the project's
  updates log with the `tdsapp-projects` skill's `update` action as a `call` entry. Internal
  unless the person says it's fine for the client. Nothing personal, and no figures the
  summary didn't confirm.
```

Check after applying: `grep -c "(d) A project update" .claude/skills/meeting-notes/SKILL.md` is 1.

## 2. `.claude/rules/save-locations.md` (1 edit): email needs its owner's yes

Ian's rule (2026-11-23): nothing from an email reaches a project without the inbox owner's approval.

Current passage (added in phase 1):

```
- When the work is for a client that has open projects and nobody has said which, use the one the
  person names, or ask which project it is for before saving, offering those project folders first.
```

Replacement:

```
- When the work is for a client that has open projects and nobody has said which, use the one the
  person names, or ask which project it is for before saving, offering those project folders first.
- Nothing from an email (its text, a summary, quotes or attachments) goes into a project, as an
  update, a file or a link, until the owner of the inbox it came from has approved exactly what will
  be saved. Email from someone else's inbox never goes in; ask its owner to add it.
```

Check after applying: `grep -c "Nothing from an email" .claude/rules/save-locations.md` is 1.

## Then

Save and sync as usual so the team gets the text and the new skill version.
