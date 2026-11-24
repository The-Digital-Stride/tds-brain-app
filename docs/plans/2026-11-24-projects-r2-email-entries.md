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
| Builder B (server) | `builder`, sonnet | default; routing is one pure function, table test first | `server/brain/email-drafts.ts` (+test), `server/brain/email-route.ts` (+test), `server/brain/project-updates.ts` (+test), `server/brain/project-activity.ts`, `server/brain/index.ts`, `server/http/routes.ts`, `server/http/project-email-routes.test.ts`, `shared/contract.ts`, `shared/project-updates-contract.ts` |
| Builder C (client) | `builder`, sonnet | default (UI) | `client/src/apps/projects/EmailDrafts.tsx` (+test), `client/src/apps/projects/EmailApproval.tsx` (+test), `client/src/apps/projects/ProjectUpdates.tsx` (+test), `client/src/apps/projects/ProjectsApp.tsx`, `client/src/apps/projects/ProjectPage.tsx`, `client/src/apps/projects/ProjectRef.tsx` (+ProjectsRefs test), `client/src/api.ts`, `client/src/styles/projects.css`, `help/projects.md`, `help/project-codes.md` |
| Lead | me | | plan, contract, `shared/project-email-contract.ts`, `server/engine/session-manager.ts` (EMAIL_LINE + `canUseTool` denial, +test), `brain-skills/tdsapp-projects/brain-rules/r2-email.md` (gm Step 4b text), explainer |
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

## Pre-review outcomes (overseer, 2026-11-24)

These override the decisions above where they differ; the contract has them.

- **B1 Approval needs the owner's click.** The script writes a random `approve_token` into the draft and
  never returns it. Email `update` needs it; only the server reads it from the file, on Save
  (`POST ROUTES.projectEmailDrafts {action:'approve'}`). The lead adds a `canUseTool` denial for tool calls
  naming the drafts folder or the token (`server/engine/session-manager.ts`), with a test. Residual risk: a
  process that deliberately reads the file can still forge approval (security gate weighs it).
  Plain: Claude can suggest; only your click saves.
- **B2 Message-ID.** Probed 2026-11-24: the Gmail connector shows the Message-ID only in RAW format. So
  `messageId` is optional and the script derives `email_key` = Message-ID, else `x:` + SHA-256 of sender
  address, sent minute and normalised subject. The probe also confirmed the Gmail link format
  (`?authuser=<email>#all/thread-f:<decimal>`), so "Open in Gmail" is built from it.
  Plain: the same email is still recognised in two inboxes.
- **B3 No addresses in synced files.** Entries store display names (an address only where there's no name).
  Addresses and the domain stay in the local draft (brain `save-locations.md`: contact details live in
  `crm/data/`).
  Plain: the team sees who was on an email, not their addresses.
- **B4 Size.** Newest text at most 4,000 characters and thread ids at most 20, so "link this thread" fits
  Cortex's 20,000-character command limit (test it).
- **S5** The server collapses the same `email_key` within a project on read (earliest wins).
- **S6** Drafts expire after 30 days; folder 0700, files 0600; dismissals kept per inbox owner.
- **S7** `inboxAddress` must equal this person's `roles.json` email, so a shared inbox or someone else's
  login can't be saved as yours (watch: aliases).
- **S8** The email rule moves to an every-chat line naming `email-draft` as the only route ("never as a note").
- **S9** Patterns: hex thread id, Message-ID ≤300 characters with no whitespace, no newlines in subject or names.
- Rulings: (a) a gitignored draft is fine with the conditions above; (b) the server routes, the script records
  facts, both use the shared code rules; (c) the key is enough, thread Message-IDs kept in the draft only;
  (d) removal by the inbox owner, the Owner or a scout; (e) team approved, the lead owns the `canUseTool`
  denial; (f) drafts don't follow you to another Mac; a non-project chat may draft (routing decides); the
  Workbench doesn't read `updates/`; older Cortex shows "email" and the summary.
- Nice, adopted: the sheet says when the requested project differs from an already-linked thread; /gm says
  which app version is needed to approve.

## Review outcomes

Three reviewers (correctness opus, security opus, UX sonnet), then an overseer ruling on the token design.

**Correctness**
- *Blocking:* the drafts guard matched prose. A Write containing "Daily briefing", or an email that mentions a briefing, was refused, including /gm's own briefing file. Fixed: the guard checks only paths: path fields, a Glob's pattern and the path-shaped words of a Bash command. Prose cases are now in the tests.
- *Should:* "Smith, Alex" was split into two people. Fixed: the field takes one name per line.
- *Should:* an email with no subject couldn't be saved. Fixed: the server allows an empty subject, as the script already did.

**Security**
- *High:* the approve token sat in plain text in the brain. A read-only `grep -r` from the brain root runs without a card. If the person had always-allowed the script, one pipeline could then save an email with zero cards. A hand-written draft with a chosen token also passed.
- *Fixed per the overseer's ruling:*
  - The token now lives outside the brain, at `<account home>/Library/Application Support/TDS Brain/data/email-keys/<id>.key`. The home comes from `os.userInfo()`, so neither HOME nor TDS_BRAIN_APP_DATA can move it. The file also holds the SHA-256 of the draft's bytes and the brain's path.
  - `update` refuses if there is no key file, the token is different, or the draft has changed. The server hides drafts that have no key.
  - Every chat denies Read and Edit on the drafts folder and the keys folder.
  - File tools are refused for any `projects/<slug>/updates/` path.
  - The sweep never deletes another brain's keys, except by age.
- *Medium:* prose false positives. Fixed by the same path-only change as the correctness blocker.
- *Low, residual:*
  - Claude could reach the app's API with curl after reading the launch token.
  - `inboxAddress` is whatever Claude states.
  - Email text going into a note, Write or link is stopped only by the instructions.

**UX**
- No blockers.
- Fixed:
  - The reason line only describes the suggested project.
  - Save explains itself when no project is chosen.
  - "Nothing is saved until…".
  - "This date is saved too".
  - Help has its own Emails page, and the Projects page is restored to the original apart from the word "emails".
  - The list shows where each email is headed.
  - The empty state reads "Nothing else is waiting".
  - The Gmail line sits on one aligned row.
  - An empty owner name falls back to "In their inbox".
  - `@` is refused in names, on screen and in the script.

**Residual, accepted by the overseer as far as an app under the same Mac account can go (Ian to confirm)**
1. Reading the keys folder deliberately. It sits outside the working folder, so in Cortex this needs a card naming the path. This is the same class of risk as the launch token.
2. Writing a project's `updates/` file directly, bypassing the script. Refused in Cortex for file tools. A Bash write needs a card. In terminal Claude Code with accept-edits or skip-permissions mode, this is zero cards. Terminal Claude Code in a no-prompt mode is outside what the app can enforce.
