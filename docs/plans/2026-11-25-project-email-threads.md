# Project email threads: paste a code once, start emails from a project, one row per thread

Date: 2026-11-25 · Size: L · Branch: `project-email-threads` · Explainer: https://claude.ai/artifact/4DobCZwLCoR2tKAS7tqqfN (copy in `docs/project-email-threads-explainer.html`)

## Objective

Make it easy to tie an email thread to a project and keep the project free of repeats. A project code put
into a thread once keeps pointing every later message at the project; an email started from a project
carries the code without typing; and when several teammates are on one thread, the project holds one row
for it, each person adding only what is new.

## User decisions (fixed)

- **Owner approval, every route (Ian, 2026-11-23).** Nothing from an email reaches a project without the
  inbox owner approving exactly what is saved. Nothing here changes that: a code or a thread match only
  pre-selects a project, and every addition to a thread's row is its own approved entry.
- **No Gmail plugin (Ian, 2026-11-25).** A browser extension was weighed and dropped.
- **A code anywhere in the thread counts (Ian, 2026-11-25).** This replaces the 24 Nov rule that quoted
  earlier messages are ignored: they now count, below a code in the newest message's own subject or text.
  Signatures are still ignored.
- **Emails started from a project end with the code (Ian, 2026-11-25).** The line is `Ref: [AST4K7]`.
- **Teammates on one thread must not duplicate information in the project (Ian, 2026-11-25).**
- Build, then merge and push once checks and reviews pass; brain wording copied into the brain after the
  merge (files only, never git). Explainer: yes.

## Facts (from the code and probes, 2026-11-25)

- Codes are read from the subject and from the newest message's own text only
  (`codes_subject`, `codes_body`; `ownText` skips `>` lines and everything after a `-- ` line).
- A thread is remembered only through saved entries: `linkedThread(owner, threadId)` (one inbox) and
  `linkedMessage(id)` over `email_key`. `/gm` never passes `threadMessageIds`, because the connector shows
  the Message-ID only in RAW format, so a teammate's copy of a saved thread is not recognised.
- `email_key` is `x:` + SHA-256 of sender address, sent minute (UTC) and normalised subject. Approval of
  the same key twice is refused (`exists`); within a project the same key collapses on read.
- Probe (Gmail connector, `get_thread` PLAIN_TEXT): every message has `sender`, `date` (ISO, to the second)
  and `subject`; `date` equalled `internalDate`; Gmail-style replies quote with `>`; a forwarded block and
  Outlook-style quoting are not `>`-marked, so they already read as own text.
- Probe (Chrome): `https://mail.google.com/mail/?view=cm&fs=1&body=…` opens compose with the text filled in.
  The test account has no Gmail signature, so where a signature lands is not verified.
- `parseDraft` (`server/brain/email-drafts.ts`) checks only the fields it knows, so an older app reads a
  draft with extra fields. Frontmatter readers ignore unknown keys.
- `ProjectRef.tsx` shows the code and Copy on the Overview; `projectLine` in
  `server/engine/session-manager.ts` is what Claude is told in a project chat.

## Decisions

1. **A code in the thread counts, one tier below the newest message.** The script stores `codes_thread`:
   valid codes in the quoted (`>`) lines of `newestText`, plus `threadCodes` that Claude reports from earlier
   messages' own text, minus codes already in the subject or body. `routeEmail` gains `thread-code` after
   `body-code` and before `domain`. The newest message outranks the thread: one project from subject and
   body wins even if the thread names another; subject and body disagreeing is `codes-disagree` as today;
   with none there, exactly one project from `codes_thread` is `thread-code` and two or more are
   `codes-disagree`. Signatures stay ignored.
   Plain: paste the code once, anywhere in the thread, and later replies still find the project.
2. **Every thread message gets the cross-inbox key.** `email-draft` takes an optional `thread`: sender
   address and sent time of each message, newest first, at most 30. The script computes the existing `x:`
   key for each and stores `thread_keys` in the draft (hashes only, never addresses). On approval the entry
   gains `email_thread_keys`.
   Plain: the app can tell that two people are looking at the same conversation.
3. **A few seconds of slack at a minute boundary.** Stored keys stay exact-minute. The side asking also
   tries the neighbouring minute when the sent time is within 5 seconds of a boundary (`near_keys` in the
   draft, computed by the script). Old entries match exactly as before.
   Plain: one email stamped 10:41:59 in one inbox and 10:42:01 in another is still one email.
4. **A message is held when any entry lists its key.** `emailHeld` (script) and `scanEmailEntries` (server)
   treat `email_key` and `email_thread_keys` alike. So a draft whose own email is in a teammate's thread
   entry is refused as `exists`, and a draft on a thread already in a project routes there (`message`).
   Plain: the second person is pointed at the project the first one used.
5. **Check before summarising.** New read-only script action `email-check`: the thread's message list in,
   the indexes already held and the project holding them out. `/gm` and "link this thread" call it first,
   summarise only the messages no project holds, and make no draft when nothing is new. The draft records
   `fresh_at_draft`.
   Plain: each person adds only what the project doesn't know yet.
6. **One thread, one row.** `project-updates.ts` joins `email` entries of one project that share any key,
   or the same inbox owner and Gmail thread id, and gives them one `emailThread` id. The Updates tab shows
   one row per conversation: the latest part open, earlier parts under "Earlier in this thread (n)", each
   part with its own from line, who saved it, its own Client can see this mark, Open in Gmail and Remove.
   Each part stays its own file, so two people saving at once never clash.
   Plain: the team reads one conversation in one place, however many people saved parts of it.
7. **Waiting drafts keep up.** The drafts list leaves out a draft whose own email is now held (a teammate
   saved it first). It is hidden, never deleted (pre-review S2). The approval sheet says when the thread
   is already in the project ("Adds to a thread Sam saved on 20 Nov"), how many messages the summary covers,
   and warns when a teammate saved part of it after the draft was made ("check the summary for repeats").
   Plain: you don't approve something a teammate already saved, and you're told when to re-read.
8. **"Write an email" on the project Overview.** Beside the code and Copy, a link styled as a button opens
   Gmail compose in a new tab (`gmailComposeUrl`): the message text is empty except for the last line
   `Ref: [AST4K7]`. Shown only when the code is shown. Built in the browser from the identity's email; no
   Claude call, nothing saved. The note under the code changes to say so.
   Plain: start the email from the project and the code is already there.
9. **Project chats add the line too.** `projectLine` gains one sentence when the project has a code: any
   email Claude drafts for the project (new or a reply) ends its text with `Ref: [CODE]` on its own line,
   above the signature, unless the code is already in that thread. The skill's "Project codes" section says
   the same and drops "subjects only".
   Plain: emails Claude drafts for a project carry the code as well.
10. **Capability and brain wording.** The script answers `projects-email-threads-v1` (0.8.0). The `/gm`
    Step 4b text and the skill's Emails section are rewritten to pass `thread` and `threadCodes` and to call
    `email-check`, only when that capability is listed; otherwise they do as today.
11. **Words.** `help/project-emails.md` and `help/project-codes.md` are updated (350-word cap), a What's new
    note is added, and the release is a `feat`.

## Backward compatibility

- **Old /gm rule, new script:** no `thread` or `threadCodes` → the draft is made exactly as today.
- **New /gm rule, old script:** the rule is gated on `projects-email-threads-v1`.
- **New drafts, old app:** extra fields are ignored by `parseDraft`; `v` stays 1.
- **Old drafts and entries, new app:** missing fields read as empty. Old entries still join into one row
  by inbox owner and Gmail thread id, and still match by `email_key`.
- **New entries, old app:** `email_thread_keys` is an unknown frontmatter key and is ignored; each part
  shows as its own row, as today.
- **Stricter checks:** none on existing fields. A `thread` over 30 or a bad address in it is refused
  (`bad-request`), new input only.
- No break. The 24 Nov "quoted text is ignored" rule changes on Ian's instruction (fixed decision above).

## Contract

`shared/project-email-threads-contract.ts` (written by the lead before builders start).

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A (script) | `builder`, opus | hard list: de-duplication rules and who-may-write checks live in this file | `brain-skills/tdsapp-projects/scripts/tdsapp-projects.cjs`, `brain-skills/tdsapp-projects/test/tdsapp-projects.test.ts`, `brain-skills/tdsapp-projects/SKILL.md` |
| Builder B (server) | `builder`, sonnet | default; pure functions, table tests first | `server/brain/email-route.ts` (+test), `server/brain/email-drafts.ts` (+test), `server/brain/project-updates.ts` (+test), `server/http/project-email-routes.test.ts` |
| Builder C (client) | `builder`, sonnet | default (UI) | `client/src/apps/projects/ProjectRef.tsx`, `ProjectsRefs.test.tsx`, `EmailApproval.tsx` (+test), `EmailDrafts.tsx`, `ProjectUpdates.tsx` (+test), `logic.ts`, `client/src/styles/projects.css`, `help/project-emails.md`, `help/project-codes.md`, `help/whats-new/<version>.md` |
| Lead | me | | plan, `shared/project-email-threads-contract.ts`, `shared/project-email-contract.ts`, `shared/project-updates-contract.ts`, `server/engine/session-manager.ts` (+test), `brain-skills/tdsapp-projects/brain-rules/r2-email-threads.md`, explainer |
| Correctness reviewer | `reviewer`, opus high | | |
| Security gate | `reviewer`, opus high (email content, identity, hashes in shared files) | | |
| UX/UI gate | `expert`, sonnet medium + lead's browser check | | |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `tdsapp-projects.test.ts` (first) | `thread` makes `thread_keys` (hashes, no address anywhere in the draft); over 30 or a bad address refused; `codes_thread` from quoted lines and `threadCodes`, never from after `-- `, never repeating subject or body codes; near key made only within 5 s of a boundary; `emailHeld` finds a key in another entry's `email_thread_keys` and by near key; approval writes `email_thread_keys`; `email-check` answers covered indexes and the project, writes nothing, refuses another inbox; a draft without the new fields behaves as 0.7.0; no sweep of held drafts; one scan per run with a 30-message thread; removing an entry frees its messages (B1); `capabilities` lists the new feature | A |
| `server/brain/email-route.test.ts` (first) | table: one thread code → `thread-code`; body code beats a different thread code; two thread codes → `codes-disagree`; thread key already in a project → `message`; near key → `message`; old drafts route as before | B |
| `server/brain/email-drafts.test.ts` | a held draft is not listed; `thread` facts (`total`, `fresh`, `partOf`, `overlap`); a draft without thread fields has no `thread` | B |
| `server/brain/project-updates.test.ts` | entries sharing a key, or owner and thread id, get one `emailThread`; unrelated entries get none; old entries unchanged | B |
| `ProjectUpdates.test.tsx` | one row per conversation, latest part open, earlier parts folded, each part keeps its own Remove and Gmail link | C |
| `EmailApproval.test.tsx` | `thread-code` reason; "Adds to a thread…" line; the overlap warning; covers-n line | C |
| `ProjectsRefs.test.tsx` | "Write an email" only when the code shows; its link carries the code line and opens in a new tab | C |
| `session-manager` test | the project line names the code line only when the project has a code | Lead |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (preview on port 3878, own data folder)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: security (email content, identity, hashes in synced files), UX/UI
- [ ] Browser check: Overview "Write an email", approval sheet lines, Updates thread row, narrow width

## Pre-review outcomes (overseer, 2026-11-25)

These override the decisions above where they differ; the contract has them.

- **B1 Two lists, two jobs (blocking, fixed).** An entry's `email_thread_keys` holds only the thread
  messages no entry held when it was approved (what its summary covers). A new `email_thread_link` holds one
  already-held key, only to join the entry to its conversation. "Held" reads `email_key` and
  `email_thread_keys`; the join reads all three, transitively.
  Plain: taking an email off a project and saving it again always works, and the thread stays one row.
- **S1 One scan per run.** The script builds the map of held keys once per command; tested with a
  30-message thread.
  Plain: saving doesn't slow down as the brain grows.
- **S2 Hide, don't delete.** A draft whose email a teammate saved is hidden from the list, not swept. It
  returns if that entry is removed and expires at 30 days as before.
  Plain: your waiting summary isn't lost because of someone else's save.
- **S3 Paging.** The server keeps all parts of a conversation together at its newest-saved part before
  paging; inside the row, parts are ordered by `email_sent_at`.
  Plain: a conversation never splits across "Show older".
- **S4 Name the new messages.** `email-check` also returns `fresh` (index and sent time of each new
  message), and `email-draft` refuses a `thread` that doesn't contain the drafted email.
  Plain: Claude summarises the right messages.
- **S5 Shared types first.** The lead adds `'thread-code'`, `EmailRoute.overruled`, `EmailDraftItem.thread`
  and `ProjectUpdateItem.emailThread` to the two shared contracts before builders start. `EmailThreadRoute`
  dropped.
- **S6 The pair to probe** is a sender's Sent copy against a teammate's received copy. Not possible from
  one inbox; the 5-second slack stays and a miss only causes a repeat (see Watch).
- **S7 Hashes can be guessed.** With the subject in clear, a teammate could test likely senders and minutes
  against the keys. B1 stores fewer; the security gate rules on it. "This summary covers n messages" sits
  above Save.
  Plain: teammates could work out who wrote in a thread and when, never what was said.
- **Nice, adopted:** the sheet says when a saved thread outranks a different code in the newest message
  (`overruled`); the over-size refusal says "send fewer thread messages"; help says how to add something a
  summary missed (its owner removes it and saves again).
- **Rulings:** held-through-thread-keys is safe with B1 and the covers-n line; `threadCodes` from Claude
  is acceptable because it only pre-selects, worded "A project code earlier in this thread"; Opus for
  Builder A holds; a draft a teammate has saved is hidden silently; one Gmail line per row, each part keeps
  its saver, date, client mark and Remove, never a row-level client mark.
- **Ruling (a), compose link.** Keep the code line in the text if a Gmail signature survives below it;
  otherwise use the subject. Not probed (changing Gmail settings needs Ian's yes). User reports say a
  `body=` link drops the signature, so this goes to Ian as a choice; the contract's `gmailComposeUrl` is the
  one place to change.

## Watch (not verified)

- Whether Gmail keeps a signature when the compose link fills the text. Ian's account has none. If a
  teammate's signature is dropped, the fallback is the code in the subject (`su=`), a one-line change.
- Whether two inboxes ever stamp one message more than 5 seconds apart.

## Review outcomes

Reviews on 2026-11-25: correctness (Opus), security and privacy (Opus), UX/UI and accessibility (Sonnet),
plus the lead's browser check. Every finding was checked in code before it was fixed.

Correctness (3 confirmed, all fixed, tests written first):
1. The 5-second slack could take a quick follow-up for the message before it (same sender and subject,
   either side of a minute), so the follow-up was called "already saved" and left out. Fixed in `threadOf`:
   a near key equal to another listed message's own key is dropped.
   Plain: a second email sent seconds after the first is no longer skipped.
2. `fresh_at_draft` counted messages while the app counts distinct keys, giving a false "may repeat"
   warning when two messages share a key. Fixed: counted over distinct keys.
   Plain: no false warning on the Save sheet.
3. A draft made with both a Message-ID and a `thread` kept the Message-ID as its key, so a teammate's later
   save of the same email wasn't recognised. Fixed: with `thread`, `email_key` is always the derived key; the
   Message-ID joins `thread_message_ids`, and an old entry saved under it still refuses a repeat at draft.
   Plain: the same email is recognised whichever way it was first saved.

Security (0 blocking, 1 "consider", fixed): Claude supplies the `thread` list, so a hidden instruction in an
email could add a made-up future message and block that email from being filed later. Fixed: a thread message
dated more than five minutes after this Mac's clock is refused. Plain: nobody can reserve an email that hasn't
been sent.

Accepted residual (security ruling on overseer S7): `email_thread_keys` in synced entries can be checked
against a guessed sender and minute, so a teammate could work out who wrote in a saved thread and when, never
what was said. Same kind of exposure as `email_key` (shipped in v0.74.0), a little more of it; no cheap
mitigation exists (the brain is shared, so no secret). Accepted for a small internal team.

Known limit kept: when an inbox has the follow-up but not the message before it (so the thread list can't
show the clash), the 5-second slack can still take the follow-up for a saved copy. Needs the same sender, the
same subject, two messages within 5 seconds of a minute boundary, and the earlier one missing from that inbox.

Second known limit (the other side of the same fix): minute-level keys can't tell a copy stamped across a
minute boundary from a second message in the next minute. When one sender writes twice with the same subject
in neighbouring minutes, the first message's slack is switched off, so if a teammate's inbox stamped it on the
other side of the boundary it counts as new and can be summarised again. A repeat, never a loss, which is the
rule the contract sets.

Second correctness look at the fix commit (Opus, 2026-11-25): 3 confirmed regressions from fix 3, all fixed
with tests first; 1 dropped as a fix (its suggested change would have brought fault 1 back) and written down
above as the second known limit.
- An email dismissed under its Message-ID came back when drafted with a thread. Both keys are now checked.
- A waiting draft keyed by the Message-ID was doubled, not replaced. Both keys now match.
- A teammate's entry saved under the Message-ID between draft and Save was missed. The draft now keeps
  `message_id`, checked at Save and by the app's list.
Plain: giving a Message-ID with a thread never makes an email ask twice or save twice.

Overseer sign-off (2026-11-25): signed off, confirming rulings (a) to (d); the three regressions above were
found and fixed after it, each making matching stricter in the direction it had asked about.

UX/UI (5 confirmed, all fixed): each Delete button's name now carries the saver; after deleting one part the
keyboard stays in the thread; the covers line shows only for a thread of more than one email and says how
much of the thread it covers; two wording fixes on the sheet; `docs/design-system.md` records the new pieces.

Not verified (as "Watch"): where Gmail puts a signature when the compose link fills the text; how far apart
two inboxes stamp one message in practice.
