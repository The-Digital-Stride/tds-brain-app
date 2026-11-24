# Brain rules for Projects R2 phase 5: email entries

Proposed text, copied into the brain straight after the merge (files only, never git in the brain), together
with `tdsapp-projects` 0.6.0 (script and SKILL.md). Plan: `docs/plans/2026-11-24-projects-r2-email-entries.md`,
decisions 8 and 9 and the pre-review outcomes.

## Why

A project's Updates can now hold emails: who wrote, who else was on it, when, and a short summary. Nothing is
saved until the inbox owner approves it in TDS Cortex (Projects app, "Waiting for your OK"). Claude only ever
makes a **draft**, with the `tdsapp-projects` skill's `email-draft` action; the draft stays on that person's Mac
(`briefing/email-drafts/`, git-ignored, never synced) and the app's Save button writes the entry.

## Before you start

If a "current passage" no longer matches, the brain file has changed: re-read it and adjust the edit rather
than overwriting.

## 1. `.claude/rules/save-locations.md` (1 edit)

Current passage:

```
- Nothing from an email (its text, a summary, quotes or attachments) goes into a project, as an
  update, a file or a link, until the owner of the inbox it came from has approved exactly what will
  be saved. Email from someone else's inbox never goes in; ask its owner to add it.
```

Replacement:

```
- Nothing from an email (its text, a summary, quotes or attachments) goes into a project, as an
  update, a note, a file or a link, until the owner of the inbox it came from has approved exactly
  what will be saved. The only way in is the tdsapp-projects skill's `email-draft` action: the draft
  waits in TDS Cortex (Projects app, "Waiting for your OK") until that person saves it. Never write an
  email entry or note yourself, and never open the `briefing/email-drafts/` folder. Email from someone
  else's inbox never goes in; ask its owner to add it.
```

## 2. `.claude/skills/gm/SKILL.md` (1 edit, Step 4b)

Insert this block straight **before** the paragraph that starts
`**Read-only. Never send, reply, archive, label or delete during \`/gm\`.**`

```
**Emails for projects (TDS Cortex 0.73 or later).** Only when this Mac has the `tdsapp-projects` skill
with the `email-draft` action (`node .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs
capabilities` lists `projects-email-v1`); skip silently otherwise.

From the threads you read for the inbox list above, and any other **client** thread with a new message
since yesterday, pick the ones that carry something a teammate on the project should know: a decision,
a figure, a date, an approval, a change of scope, or a problem. Skip newsletters, notifications, receipts,
scheduling back-and-forth and anything only about you. At most **8** a run, most useful first.

For each one, read the thread with the Gmail connector (`get_thread`, plain text) and make one draft:

    echo '<json>' | node .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs email-draft

with `threadId` (the connector's thread id), `inboxAddress` (the Gmail address you're signed in as: the
`authuser` in the connector's `viewUrl`), `subject`, `from` and `people` (to and cc, never bcc) as
`{ "name": …, "address": … }` from `addressDisplayNames`, `sentAt` (the message's `date`), `summary`
(3 to 6 plain sentences: what was said and what it means for the project; no greetings, no quotes
longer than a few words, nothing from the signature) and `newestText` (the newest message's own text,
at most 4,000 characters; the script only reads it for project codes and throws it away). Add
`requested` only if the person told you which project it's for. Never add anything else.

The script answers `dismissed` (the person said it's not for a project) or `exists` (already in a
project): skip those quietly. Never call the skill's `update` action for an email and never open the
`briefing/email-drafts/` folder: saving is the person's click in the app.

Then one line: "**Emails for projects:** N waiting for your OK in TDS Cortex (Projects)" or nothing
when N is 0.
```

## Greps after copying

- `grep -c "email-draft" .claude/rules/save-locations.md` → 1
- `grep -c "Emails for projects" .claude/skills/gm/SKILL.md` → 2
- `grep -c "projects-email-v1" .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs` → at least 1
- `git check-ignore briefing/email-drafts/x.json` prints the path (the folder is ignored)
