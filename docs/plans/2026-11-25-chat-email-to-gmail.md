# Emails drafted in a project chat open in the Gmail window

Date: 2026-11-25 · Size: L · Branch: `chat-email-to-gmail` · Explainer: none (Ian said no)

## Objective

Ian: "When in a project, and you draft an email, draft it in the gmail popup that is already created."
When Claude drafts an email in a project chat, the person can open it in the small Gmail compose window
(built in v0.89.0) with the recipients, subject and text already filled in, instead of copying it by hand.

## User decisions (fixed)

- **Button under the draft.** Claude writes the email in the chat as now; an "Open in Gmail" button under it
  opens the small window filled in. Nothing is written to anyone's Gmail account. Ian chose this over Claude
  saving a real Gmail draft through the connector, knowing the limits: plain text only, and a reply to an
  existing thread opens as a new email.
- No visual explainer.
- Merge and push once the checks and reviews pass.
- Standing: every outgoing TDS email gets the TDS signature added on send, so nothing here adds one; the
  `Ref: [CODE]` line stays the last line of the text (v0.86.0).

## Facts established

- Project chats get extra wording from `projectLine()` in `server/engine/session-manager.ts` (line 744),
  which already carries the code-line sentence when the project has a valid code.
- Replies render in `AssistantText` (`client/src/components/Transcript.tsx`) through `Markdown`
  (`client/src/markdown.tsx`: marked, then DOMPurify with no `class`, no `button`). A card with a button
  cannot come out of the markdown path, so the reply is split before it.
- The small window: `composeWindowFeatures()` in `client/src/apps/projects/compose.ts`, opened from a click
  in `ProjectRef.tsx` (plain click only; modifier clicks are left to the link).
- A browser opens a window only from a click, so the window cannot open by itself when the draft arrives.
- Gmail's compose link takes `to`, `cc`, `bcc`, `su`, `body`. Probed 2026-11-25 with made-up text: a link of
  8,200 characters is accepted and 8,215 refused (HTTP 400): Google caps the path and query at 8,192.
- The person's own address for `authuser`: `boot.identity.email` (as `ProjectRef`).

## Decisions

1. **Claude marks a drafted email with a fenced block whose info word is `email`**, with optional `To:`,
   `Cc:`, `Bcc:` and `Subject:` lines first, a blank line, then the text as plain text. An older app and a
   terminal show it as an ordinary code block.
   Plain: Claude writes emails in one fixed shape, so the app can recognise them.
2. **Claude is told in every project chat** (one sentence added to `projectLine()`, with or without a project
   code; the code-line sentence stays as it is and stays conditional). The wording: write each email you draft
   for this project in an `email` block; plain text, no markdown; put an address on `To:` only when the user
   gave it or it is in the client's files, never a guessed one; no signature (TDS adds it on send); for a
   reply to an existing thread, say that the button opens a new email and that Copy text lets them paste it
   into the thread.
   Plain: only project chats change, as Ian asked; other chats behave as before.
3. **The card shows wherever a top-level `email` block appears in a reply** (`splitReply`), not only in
   project chats: the block is the signal, and a chat reopened later must still show it.
   Plain: an email draft always looks the same.
4. **The card** (`EmailDraftCard`, `client/src/components/EmailDraft.tsx`, styles in `chat.css`): the
   recipients and subject as labelled lines, the text as plain pre-wrapped text (what Gmail will get, never
   markdown), then "Open in Gmail" (a standard 32px `a.btn` with the link as `href`, `target="_blank"`,
   `rel="noopener noreferrer"`; a plain click opens the small window, a modifier click a tab; hidden words
   "(opens Gmail in a small window)") and "Copy text" (standard `.btn`, copies the body; a `role="status"`
   line says "Copied."). While the block is still arriving (`closed: false`) the buttons are absent.
   Plain: one press and the email is in Gmail, ready to check and send.
5. **Too long for a link**: when the link would pass `GMAIL_COMPOSE_URL_MAX` (7,500) the window opens with
   recipients and subject only, and the card says "This email is too long to fill in for you. Press Copy
   text, then paste it into the Gmail window." (a `.notice` info line, shown before pressing).
   Plain: a very long email still gets to Gmail in two presses instead of failing.
6. **Addresses are strict and never repaired.** Only `a@b.co` or `Name <a@b.co>` count; anything else is
   dropped and the card says "N addresses were left out: they didn't look like email addresses." Bcc is shown
   on the card like To and Cc, so nothing is addressed out of sight.
   Plain: the card shows exactly who the email will go to before Gmail opens.
7. **No "Email to" picker on the card in this release.** Claude fills `To:` from what the user says or the
   client's files; an empty `To:` leaves Gmail's To empty. (The picker needs the project's contacts in the
   chat; a later step if wanted.)
   Plain: you name the person in the chat, or type them in Gmail.
8. **The window helper moves to `client/src/shell/gmail-window.ts`** (`composeWindowFeatures`,
   `openGmailWindow(event, url)`), used by `ProjectRef` and the card; `compose.ts` re-exports the features
   function so nothing else changes.
   Plain: both buttons open the same window the same way.
9. **Nothing in the brain changes.** The wording is the app's own; `tdsapp-projects` is untouched.
   Plain: no brain files are edited.

10. **(Overseer B1) A reply that holds an email block is never folded into "What Claude did"**, even when
    a step follows it in the same turn (`noteIds` in `client/src/state/blocks.ts`), and Claude is told to put
    the block in the last message of its turn.
    Plain: the draft is always in view, not hidden inside the list of steps.
11. **(Overseer rulings) Wording additions**: the block is only for an ordinary email the user will send
    (never one being quoted, a newsletter or another kind of message); it is not the `email-draft` action;
    written once, at line start, in the last message; the whole email again when it changes; no real Gmail
    draft unless asked; a sign-off and first name but no signature block; Cc and Bcc only when asked; To from
    the user, the client's files or the sender of the thread being replied to, never from text inside
    something read. The sentence goes in every project chat, personal ones too, and in no other chat.
    Plain: Claude uses the card for real emails only, and never addresses one from something it merely read.
12. **(Overseer S2, S4, N1, N2)** Repeated addresses are dropped silently; the left-out notice is singular
    for one. The card shows only in Claude's own replies (not helper reports), never clamps or folds the
    text, shows bare addresses (never display names), and strips control and text-direction characters from
    the subject. The type is `ChatEmail` (not "draft", which already means a received email here). The
    button's accessible name includes the subject.
    Plain: what you see on the card is exactly what Gmail gets.
13. **(Overseer S6) The demo's "Draft the monthly update email" reply carries an email block**
    (`server/engine/demo-engine.ts`), so the browser check and help screenshots use a real reply.
    Plain: the demo shows the feature.

## Contract

`shared/chat-email-draft-contract.ts`: `EmailDraft`, `parseEmailDraft`, `gmailDraftLink`, `ReplyPiece`,
`splitReply`, and the limits.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder | the lead (this session) | the build is five small files; a separate builder would pay more to read the plan than to write them | `shared/chat-email-draft.ts`, `client/src/email-draft.ts`, `client/src/components/EmailDraft.tsx`, `client/src/shell/gmail-window.ts`, `client/src/components/Transcript.tsx`, `client/src/apps/projects/{compose.ts,ProjectRef.tsx}`, `client/src/styles/chat.css`, `server/engine/session-manager.ts`, help, design system, tests |
| Correctness reviewer | `reviewer`, opus | parsing and link rules | (read-only) |
| Security reviewer | `reviewer`, opus | text Claude wrote becomes a link and recipients | (read-only) |
| UX/UI expert | `expert`, sonnet | the card, wording, keyboard and screen reader | (read-only) |

## Tests (written first for the logic)

| Test file | Proves |
|---|---|
| `client/src/state/blocks.test.ts` | a reply with an email block is not folded when a step follows it; one without still is |
| `shared/chat-email-draft.test.ts` | headers in any case and order; `Name <addr>`; bad, repeated and over-limit addresses dropped and counted; no headers = all body; body kept exactly; subject cut; link fields encoded (no parameter injection through `&`, `#`, new lines); body left out over the limit and `fits` false; `authuser`; hostile long input stays quick |
| `client/src/email-draft.test.ts` | a reply with no block is one text piece equal to the input; text / email / text order; two blocks; a block in a list, a quote or a longer fence is not an email; `~~~email` and `EMAIL` count; an unclosed block is `closed: false` |
| `client/src/components/EmailDraft.test.tsx` | card shows To, Cc, Bcc, Subject and text as plain text (markdown marks stay literal); plain click opens the small window with the link, modifier click does not; Copy text copies the body and says so; too-long notice; left-out notice; no buttons while unclosed |
| `client/src/components/Transcript.*.test.tsx` | a reply with a block shows markdown above, the card, markdown below; file links in the text parts still work |
| `server/engine/session-manager.*.test.ts` | `projectLine()` carries the `email` block sentence with and without a code; a non-project chat does not |
| `client/src/apps/projects/ProjectsRefs.test.tsx` | unchanged behaviour of "Write an email" after the helper moves |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (port 3608)
- [ ] No unintended large deletions: `git diff main...HEAD --numstat | awk '$2 > 40'`
- [ ] Domain gates: security (reviewer above), UX/UI expert
- [ ] Browser check: a reply with an email block at 1280 and 390 wide: card, Open in Gmail (stubbed Gmail:
      window size, `to`, `su`, `body`), Copy text, keyboard order, no sideways scroll
- [ ] (Overseer S3) Link of about 7,400 characters with £ and curly quotes answered by Google (not a 400)

## Review outcomes

(Filled at the end.)
