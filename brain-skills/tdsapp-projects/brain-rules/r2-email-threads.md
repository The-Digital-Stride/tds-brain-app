# Brain rules for project email threads

Proposed text, copied into the brain straight after the merge (files only, never git in the brain), together
with `tdsapp-projects` 0.8.0 (script and SKILL.md). Plan: `docs/plans/2026-11-25-project-email-threads.md`,
decisions 5 and 10 and the pre-review outcomes.

## Why

One email thread often sits in several teammates' inboxes. Each person can still only add what came from
their own inbox, with their own OK, but the project should hold the conversation once. So before Claude
summarises a thread it asks the script which messages a project already holds (`email-check`) and
summarises only the newer ones. It also passes the thread's message list, so the same conversation is
recognised in every inbox, and any project codes it saw earlier in the thread, so a code pasted once keeps
working.

## Before you start

If a "current passage" no longer matches, the brain file has changed: re-read it and adjust the edit rather
than overwriting.

## 1. `.claude/skills/tdsapp-projects/` (copy)

Copy `brain-skills/tdsapp-projects/SKILL.md` and `scripts/tdsapp-projects.cjs` (version 0.8.0) over the
brain's 0.7.0 copy (without `test/`). 0.7 calls behave exactly as before; `capabilities` now also lists
`projects-email-threads-v1`.

## 2. `.claude/skills/gm/SKILL.md` (1 edit, Step 4b)

Current passage (inside the "Emails for projects" block, as applied from `r2-email.md`):

```
For each one, read the thread with the Gmail connector (`get_thread`, plain text) and make one draft:

    echo '<json>' | node .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs email-draft
```

Replacement:

```
For each one, read the thread with the Gmail connector (`get_thread`, plain text).

**Check the thread first (only when `capabilities` also lists `projects-email-threads-v1`; otherwise go
straight to the draft and leave out `thread` and `threadCodes`).** Ask what a project already holds:

    echo '<json>' | node .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs email-check

with `inboxAddress`, `threadId`, `subject` (the newest message's) and `thread`: one
`{ "from": <the sender's address>, "sentAt": <the message's date> }` for every message in the thread,
newest first, at most 30 (add `"subject"` only for a message whose subject is different). The answer's
`fresh` lists the messages no project holds yet, by position in your list and by sent time. If `fresh` is
empty, a teammate has already saved all of it: skip the thread quietly. Otherwise write the summary about
the `fresh` messages only: what is new since the project last heard, never the whole thread again.

Then make one draft:

    echo '<json>' | node .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs email-draft
```

And, in the same block, this current passage:

```
at most 4,000 characters; the script only reads it for project codes and throws it away). Add
`requested` only if the person told you which project it's for. Never add anything else.
```

Replacement:

```
at most 4,000 characters; the script only reads it for project codes and throws it away). Add
`requested` only if the person told you which project it's for. After a check, also add `thread` (the
same list you sent to `email-check`) and `threadCodes`: any project codes (such as AST4K7) you saw in
earlier messages' own text, never one from a signature. Never add anything else.
```

## Greps after copying

- `grep -c "email-check" .claude/skills/gm/SKILL.md` → at least 2
- `grep -c "threadCodes" .claude/skills/gm/SKILL.md` → at least 2
- `grep -c "projects-email-threads-v1" .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs` → at least 1
- `grep -c "version: 0.8.0" .claude/skills/tdsapp-projects/SKILL.md` → 1
