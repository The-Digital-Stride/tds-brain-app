# Projects R2, phase 5: email entries, only with the inbox owner's OK

Date: 2026-11-24 · Size: L · Branch: `projects-r2-email-entries` · Explainer: https://claude.ai/artifact/EZs8Q3qxjV1jAHJZ39tySh
(phase 5 added at step 10)

Parent: `docs/plans/2026-11-20-projects-system.md` decision 30; routing from
`docs/plans/2026-11-24-projects-r2-project-codes.md` decision 12.

## Objective

A project's Updates log can hold emails: who wrote, who else was on it, when, and a short summary, so the
team sees what was agreed by email without opening anyone's inbox. Nothing from an email reaches a project
until the inbox owner has seen and approved exactly what will be saved. Ian ran /gm in Cortex and saw no
emails in a project because this was not built yet.

## User decisions (fixed)

- **Owner approval, every route (Ian, 2026-11-23).** No email content goes into a project in any form
  (an `email` entry, a note or call, a file, a link) without the inbox owner approving exactly what is saved.
- **Both ways in (Ian, 2026-11-24).** /gm suggests client threads that belong to a project, and in any
  Cortex chat you can say "link this thread to the project". Both make a draft that waits for approval.
- **A code can be in the email body too (Ian, 2026-11-24).** Routing (codes decision 12): a thread already
  linked to a project wins; then a code in the subject; then a code in the newest message's own text (not
  quoted earlier messages, not the signature); then the sender's domain. Two or more different codes → ask.
  A code only pre-selects the project; approval is always needed.
- Merge and push once checks and reviews pass. Brain edits are prepared in `brain-skills/` and copied into
  the brain after merge (files only, never git; Ian's standing yes for R2).
- Explainer: yes (programme explainer, updated at step 10).

## Facts (from the code and the brain, 2026-11-24)

- `tdsapp-projects` 0.5.0 `update` takes only `note` and `call` (`MANUAL_UPDATE_KINDS`, script line 146).
  `by` comes from `identity()` (git user email → `.team-config/roles.json`). `update-remove` refuses `email`.
- The server already parses `email_*` frontmatter into `ProjectUpdateItem` (`server/brain/project-updates.ts`
  ~132). The Updates tab shows an unknown kind by its name; nothing handles `email`.
- The app has no way for Claude to put a card in front of the user for approval (no app-provided MCP tools;
  `server/engine/permissions.ts` covers tool permission prompts only).
- /gm (brain `skills/gm/SKILL.md` Step 4b) already reads the inbox through the Gmail connector as whoever is
  signed in, and writes `briefing/inbox-cache.json` (gitignored) for the Workbench. Phase 4 set the pattern
  for the app reading a gitignored `briefing/` file: `server/brain/project-meetings.ts` refuses it unless
  `git check-ignore` says it is ignored.
- Cortex chats get the person's claude.ai connectors, Gmail included, so Claude in a chat can read a thread.
- The project-chat instruction (`server/engine/session-manager.ts` ~681) already forbids email content in a
  project without the inbox owner's approval.
- Gmail thread ids belong to one mailbox: the same conversation has different ids in two people's inboxes.
  The RFC 822 `Message-ID` header is the same everywhere.

## Decisions

1. **A draft is a local, gitignored file written by the script, never shared.** New script actions in
   `tdsapp-projects` 0.6.0: `email-draft` writes one JSON file into `briefing/email-drafts/` (refused unless
   `git check-ignore` says that path is ignored), and `email-draft-remove` deletes one. The draft records
   `inbox_owner` from this Mac's identity, never from the request. The newest message's text is passed in so
   the script can find codes in it, then thrown away: a draft holds the facts and Claude's summary, never the
   email text. Decision 30's "the draft is never a brain file" meant never synced or seen by others; a
   gitignored file on the owner's Mac meets that, as the meetings cache does.
   Plain: Claude's suggested entry waits on your own Mac, where only you can see it.
2. **Routing happens in the app, from facts the script records.** The draft stores `codes_subject`,
   `codes_body` (found in the newest message's own text, quoted lines and the signature skipped), the
   sender's domain, the thread id, the message ids and an optional `requested` project (from "link this
   thread to X"). The server picks the pre-selected project: requested > a thread already linked by this
   inbox owner, or a Message-ID already in a project > one subject code > one body code > one live project of
   the client whose website matches the sender's domain > none ("Choose a project"). Two different codes →
   none, with the reason. Codes use the shared code rules (`shared/` from phase 4b); domains use the
   meetings matcher's profile `Website` rule.
   Plain: the app suggests the right project and says why; you can change it.
3. **Approval writes the entry through the script.** `update` accepts `kind: 'email'` only with a `draft` id.
   The script reads the draft, refuses unless its `inbox_owner` is this Mac's identity, takes the approved
   summary, subject, sender, people and client-safe flag from the request (all editable on screen), takes the
   thread id, Message-ID, sent time and inbox owner from the draft (not editable), writes the entry, then
   deletes the draft. bcc is never accepted. The summary limit is the updates limit.
   Plain: only the person whose inbox it is can save it, and only what they saw.
4. **One email, one entry.** If any project already has an `email` entry with the same Message-ID, approval
   is refused with `exists` and the app says "Already in <project>, added by <name>", then clears the draft.
   Plain: two people approving the same email don't make two entries.
5. **Dismissed stays dismissed.** "Not for a project" removes the draft and records its Message-ID in
   `briefing/email-drafts/dismissed.json` (90 days, ids only), and `email-draft` refuses a dismissed id, so
   /gm doesn't suggest it again.
6. **Where you approve.** A "Waiting for your OK" card at the top of the Projects app lists every draft on
   this Mac; a project's Overview shows the ones pre-selected for it. Each opens an approval sheet: project
   picker (pre-selected, with the reason), subject, from, people, summary (editable), "Client can see this"
   (off by default), and the buttons Save to project and Not for a project. Uses the shared sheet and
   form components (`docs/design-system.md`, `useSheetHold`).
   Plain: emails wait in one place until you say yes, edit, or say no.
7. **How an email entry looks.** Updates row: chip "Email", the subject, "From Alex Smith · with 2 others ·
   20 Nov, 16:30", the summary. The inbox owner gets "Open in Gmail"; others see "In Ian's inbox". The inbox
   owner (or the Owner or a scout) can remove it; `update-remove` allows `email` for them. Activity
   ("Since you last looked") says "Ian added an email", never the subject (existing rule).
8. **/gm makes drafts (brain edit).** In Step 4b, for client threads with a new message since the last run
   that hold a decision, figure, date or scope change, Claude writes a summary and calls `email-draft`, at most
   8 a run, skipping dismissed and already-saved ids. It says how many are waiting and where. Read-only
   rules of /gm are unchanged (it never sends, archives or labels).
9. **A chat can draft on request.** "Link this thread to the project": Claude finds the thread with the
   Gmail connector, drafts the summary and calls `email-draft` with `requested` set, then says it is waiting
   on the Projects app for the inbox owner's OK. Never `update` for email. The project-chat instruction and
   the skill say so. Saved summaries are untrusted data when Claude reads them later.
10. **Words.** Help pages `projects.md` and `project-codes.md` drop "emails soon"; the code note becomes
    "Put this in a meeting invite or an email's subject or text so they find this project." Codes still
    never go in signatures.

## Contract

`docs/plans/2026-11-24-projects-r2-email-entries-contract.ts` (copied into `shared/project-email-contract.ts`
by the lead before builders start).

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A (script) | `builder`, opus | hard list: who may write (owner-only), de-duplication, never-shared drafts | `brain-skills/tdsapp-projects/scripts/tdsapp-projects.cjs`, its test, `brain-skills/tdsapp-projects/SKILL.md` |
| Builder B (server) | `builder`, sonnet | default; routing is one pure function, table test first | `server/brain/email-drafts.ts` (+test), `server/brain/email-route.ts` (+test), `server/brain/project-updates.ts` (+test), `server/brain/project-activity.ts`, `server/brain/index.ts`, `server/http/routes.ts`, `server/http/project-email-routes.test.ts`, `shared/contract.ts` |
| Builder C (client) | `builder`, sonnet | default (UI) | `client/src/apps/projects/EmailDrafts.tsx` (+test), `client/src/apps/projects/EmailApproval.tsx` (+test), `client/src/apps/projects/ProjectUpdates.tsx` (+test), `client/src/apps/projects/ProjectsApp.tsx`, `client/src/apps/projects/ProjectPage.tsx`, `client/src/apps/projects/ProjectRef.tsx` (+ProjectsRefs test), `client/src/api.ts`, `client/src/styles/projects.css`, `help/projects.md`, `help/project-codes.md` |
| Lead | me | | plan, contract, `shared/project-email-contract.ts`, `server/engine/session-manager.ts` line, `brain-skills/tdsapp-projects/brain-rules/r2-email.md` (gm Step 4b text), explainer |
| Correctness reviewer | `reviewer`, opus high | | |
| Security gate | `reviewer`, opus high (email content, identity, files) | | |
| UX/UI gate | `expert`, sonnet medium + lead's browser check | | |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `tdsapp-projects.test.ts` (first) | `email-draft` refuses when the folder isn't git-ignored; records identity not request; stores codes from subject and newest text (quoted `>` lines and after `-- ` skipped), never the text; refuses a dismissed or already-saved Message-ID; `update` email: refuses without draft, refuses another owner's draft, takes ids from the draft not the request, writes the entry, deletes the draft, refuses bcc, `exists` across projects; `email-draft-remove` records dismissal; `update-remove` email for inbox owner only (plus Owner/scout) | A |
| `server/brain/email-route.test.ts` (first) | table: requested wins; linked thread (same owner); Message-ID match; one subject code; one body code; two codes → none with reason; domain → one live project; domain with two projects → none; archived/done never; unknown code → none | B |
| `server/brain/email-drafts.test.ts` | not ignored → none; bad file skipped and counted; another owner's draft never listed; response holds no email text | B |
| `server/http/project-email-routes.test.ts` | through the real `checkRequest`: list, approve (passes edited fields, never ids), dismiss; bad body → 400 | B |
| `EmailDrafts.test.tsx`, `EmailApproval.test.tsx` | card lists drafts; Overview shows only its own; sheet pre-selects with the reason; edits are sent; "Not for a project" dismisses; `exists` message | C |
| `ProjectUpdates.test.tsx` | email row: chip, subject, from line, Open in Gmail only for the owner, "In <name>'s inbox" otherwise | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (port 3147)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: security (email content, identity, local files), UX/UI
- [ ] Browser check: Projects app card, approval sheet, Overview card, Updates email row, narrow width

## Pre-review outcomes

<Filled after the overseer's pre-review.>

## Review outcomes

<Filled at step 10.>
