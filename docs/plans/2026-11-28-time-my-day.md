# My day: review, edit and confirm a day's time, sent to TDS Toolbox

Date: 2026-11-28 · Size: L · Branch: `time-my-day` · Explainer: yes (Ian) · Contract: `shared/time-contract.ts`
Follows Toolbox PRs 144 and 145 (`tds-toolbox` `docs/architecture/time-tool.md`, `apps/portal/lib/time/contract.ts` at `75ee320`).
Brain project: `clients/the-digital-stride/projects/tds-time-recording-in-cortex/` (overall plan, version 5, phase 3).

## Objective

An owner or scout opens **My day** in Cortex. They see the whole of a day built from their Cortex chats, edit any
entry's description, work item, times and billable flag, add or remove entries, and press **Confirm day**. Cortex
sends the day to TDS Toolbox, which stores it. Done when a real day is confirmed into the Toolbox **test**
database from a portal run on Ian's Mac.

## User decisions (fixed)

- Phase 3 includes chat time from Cortex chats (Ian, 2026-11-28). TimeLens, screen capture and calibrating the
  timing rules stay in phase 4.
- The person always sees the whole day and confirms it. Nothing is sent before that (Ian, 2026-11-27).
- Description and client/project can be changed; description changes are logged (Ian).
- Connect with a "Connect to Toolbox" button, not a pasted token (Ian, phase 2).
- Toolbox only accepts admins until release; portal admins will be made to match owners and scouts (Ian).
- Visual explainer: yes. Nothing merged or pushed without Ian saying so.
- Standing rules: the app never writes brain files; UK English in UI copy; help page and What's new in the same
  branch; design expert review before Ian sees UI; backward compatibility.

## Facts checked (2026-11-28)

- Cortex's server listens on `127.0.0.1` only, port `config.port` (default 3877, `TDS_BRAIN_APP_PORT`)
  (`server/index.ts:319`, `shared/contract.ts:51-53`).
- The request gate (`server/http/security.ts` `checkRequest`) checks Host, refuses a foreign `Origin`, refuses
  `/api` requests whose `Sec-Fetch-Site` isn't `same-origin`/`none`, then requires the session cookie, which is
  `SameSite=Strict`. A top-level navigation arriving from Toolbox is cross-site, so **the browser will not send
  that cookie on the callback**.
- Body cap for the app's own routes: 64 KB (`security.ts:13`).
- Chats run with `cwd: brainRoot`; transcripts are Claude Code's `<configDir>/projects/<folder>/<id>.jsonl`
  (`server/engine/trash-session.ts:75-90`). `getSessionMessages` returns no timestamps and only messages since the
  last compaction, so it can't give message times. The jsonl lines carry `timestamp`.
- A chat's place: `<dataDir>/chat-places.json` (`shared/chat-places-contract.ts`), sdkSessionId → `{client, project}`.
  Personal chats: `<dataDir>/chat-kinds.json` (`server/store/chat-kinds.ts`).
- Identity and role: `server/brain/identity.ts`, `Role = owner | scout | team | unknown`.
- Secrets today: only `runtime.json` and `settings.json`, 0600 in a 0700 data folder. No Keychain use. No shared
  outbound HTTP helper (`server/store/asset-cache.ts:128` injects `fetch`).
- Toolbox: `/time-connect` (Allow page), `POST /api/time/token`, `POST /api/time/days`, `GET /api/time/days/<date>`,
  `GET /api/time/work-items`, `DELETE /api/time/token`. Off unless `TIME_TOOL_ENABLED=true` (404). Errors come as
  `{error}` or `{ok:false, code, problems}`. Change times more than 10 minutes ahead of the server or 62 days
  before it are `invalid`. Day bodies up to 1 MB; 200 entries; 2000 changes; descriptions up to 1000 characters.
- Imported test work items have no `cortexKey`, so Cortex must ask which work item a project is, once.
- No production Toolbox time address exists yet (the tool is off there).

## Decisions

1. **Owners and scouts only, until release.** My day and its routes exist only when `identity.role` is `owner` or
   `scout`. Team members see nothing (no rail item, routes 404).
   Plain: nobody's time is collected before the team has been told, matching Toolbox's admins-only rule.
2. **Toolbox address is a setting, empty by default.** `toolboxUrl` in `settings.json`, set in Settings → General
   by an owner or scout. Accepted: `https://<host>` or `http://localhost:<port>` / `http://127.0.0.1:<port>`, origin
   only (no path, query, credentials). `TDS_TOOLBOX_URL` in the environment overrides it, for testing. Changing the
   address disconnects.
   Plain: for now Ian points Cortex at the Toolbox on his own Mac; the live address is set at release.
3. **Connect flow (PKCE, loopback).** Pressing Connect makes a 32-byte verifier, its S256 challenge and a 32-byte
   `state`, kept **in server memory only**, one pending connect at a time, 10 minutes. Cortex opens
   `<toolbox>/time-connect?port=<config.port>&state=…&code_challenge=…&device=<label>` in the browser (the
   launcher's `open` pattern). The label is `TDS Cortex on <first name>'s Mac`, trimmed to 60.
   Plain: one press opens Toolbox; you press Allow there and Cortex is connected.
4. **The callback is a public path authorised by `state` alone.** `GET /toolbox-callback` is added to the gate
   before the cookie check (GET only; Host still checked; no cookie needed, since SameSite=Strict blocks it). It
   compares `state` in constant time with the pending one, consumes it on first use whatever the outcome, then
   exchanges `{code, codeVerifier}` with `POST /api/time/token` from the server. It answers a small self-contained
   HTML page ("Connected to Toolbox. You can close this tab and go back to TDS Cortex." or a plain failure), with
   `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and a CSP of `default-src 'none'; style-src
   'unsafe-inline'`. The code and state never reach the app's client or any log. A wrong or missing `state` gets
   the failure page and leaves the pending connect alone.
   Plain: only the Cortex that started the connect can finish it, and a copied link is useless.
5. **The token lives in the macOS Keychain.** Generic password, service `TDS Cortex: Toolbox time`, account = the
   Toolbox origin, written with `security -i` reading its command from stdin (never in argv), read with
   `find-generic-password -w`. Beside it, `<dataDir>/time/connection.json` (0600) holds origin, `connectionId`,
   `expiresAt` and `connectedAt`, never the token. The token never reaches the browser. Disconnect calls
   `DELETE /api/time/token`, then deletes the Keychain item and the file, even if Toolbox can't be reached. A 401
   from Toolbox marks the connection lost (same clean-up, no revoke call). 14 days before `expiresAt` My day
   says "Reconnect soon".
   Plain: the key is kept where macOS keeps passwords, and the screen in the browser never sees it.
6. **Chat time comes from transcripts, timestamps only.** `transcript-times.ts` reads the jsonl files of the
   brain's project folder modified on or after the day, line by line, keeping only `type`, `timestamp`,
   `isSidechain` and whether a `user` line is a real prompt (not a tool result, meta or compaction summary). Text,
   titles, file paths and tool details are never kept or logged. Files over 50 MB are skipped and noted. Personal
   chats (chat-kinds) and chats whose project is a personal project are left out. Chats started in the terminal
   in the brain folder count too, with no place.
   Plain: Cortex knows when you were chatting and for which client, without keeping what was said.
7. **The timing rules (one pure function, `chatBlocks`).** For each prompt: active from the prompt time minus 2
   minutes (reading and writing it) to the last assistant line before the next prompt plus 2 minutes (reading the
   answer). Intervals of one chat closer than 10 minutes merge into a block. Where chats overlap, each minute
   goes to the chat with the latest prompt at that minute, so overlapping time is counted once. Blocks are split at
   London midnight, rounded to whole minutes, and anything under 1 minute is dropped. Claude's own run time per
   block is kept as evidence, not as time. Constants live in the contract so phase 4 can calibrate them.
   Plain: an open chat isn't time worked; time near your messages is, and two chats at once aren't counted twice.
8. **Assignment.** A block's place gives its work item: a project chat uses the remembered link for that project
   (`certain`), or a Toolbox work item whose `cortexKey` equals the project key (`certain`); a client-only chat
   uses the remembered link for that client (`strong`); otherwise `unassigned`. When the person picks a work item
   for an entry with a place, "Remember for <project or client>" is on by default and saves the link in
   `<dataDir>/time/links.json`. A person's pick is `manual`. Billable defaults to true for `retainer` and `project`
   items, false for `internal` and unassigned (Toolbox refuses unassigned billable time).
   Plain: you say once which Toolbox job a project is, and Cortex remembers.
9. **The day draft is local, edits beside the evidence.** `<dataDir>/time/days/<YYYY-MM-DD>.json` (0600, atomic
   write, one queue per file) holds entries (with their captured values and the person's values separately), the
   local change list, the last confirmed revision and submission, and the status. Refreshing capture
   (`mergeCapture`) adds new blocks, updates a captured block's times only while the person hasn't edited them,
   and never removes an entry the person touched. A captured block that vanishes, untouched, is kept and marked
   "no longer found". Entry ids are lower-case `crypto.randomUUID()`, kept for the life of the entry.
   Plain: your corrections are never undone by a refresh.
10. **Change history.** Every save in the edit drawer records one `LocalChange` per changed field (description,
    workItemId, startAt, minutes, billable), plus create and delete, with the Mac's time. Typing is not recorded
    keystroke by keystroke. "This removes private detail" on a description edit, or "Remove as private" on a
    delete, records the change as redacted with no values. Changes are sent only while the day has never been
    confirmed (`baseRevision` 0); after that Toolbox logs the differences itself. If the list would pass 2000
    changes or the body 900 KB, older changes to the same entry and field collapse into one (first old value,
    last new value; redacted wins).
    Plain: what you changed is recorded, private wording can be removed without leaving a copy, and the day
    always fits what Toolbox accepts.
11. **Confirm.** `Confirm day` sends the whole day as a `DaySubmission` (`submissionId` new per confirm, kept until
    it succeeds so a retry is a repeat). Answers: `ok` → status Confirmed with the revision; `conflict` → fetch
    the stored day, show "This day was changed somewhere else", let the person compare and confirm again on the
    stored revision; `invalid` → each problem shown against its entry; `locked` → "This month is closed"; 401 →
    connection lost; network failure → kept, "Not sent". Editing a confirmed day sets "Changed since confirmed"
    until confirmed again. Days: today back 62 days; never a future day.
    Plain: Toolbox only ever holds what you confirmed, and a failed send loses nothing.
12. **The screen.** My day is an app in the rail (`shell/apps.ts`), shown to owners and scouts. Top: the date
    with previous/next and Today, the status chip (Not confirmed, Confirmed, Changed since confirmed, Not sent,
    Conflict), the day's total, and Confirm day (the area's one primary button). Then the entries in time order with
    gaps between them shown as quiet rows, each: start–end, minutes, description, work item, billable, source and
    certainty chip, "edited". Totals by work item. Add entry. A row opens the edit drawer (description, work item
    picker, start, minutes, billable, private, Remember link, Delete). When not connected, the screen shows the
    day and a Connect to Toolbox panel; Confirm is disabled with the reason. Split, merge and bulk-assign wait for
    phase 4.
    Plain: one screen shows the whole day, what each line is based on, and one button to confirm it.
13. **Work items list.** Fetched from Toolbox `GET /api/time/work-items` when My day opens and on Refresh, cached
    in memory for the session. An entry pointing at an item no longer listed shows "Closed in Toolbox" and must be
    changed before confirming.
14. **Routes (app's own, `/api/time/*`).** `GET status`, `POST connect`, `POST disconnect`, `GET day/:date`,
    `POST day/:date/refresh`, `POST day/:date/entries` (add), `PATCH day/:date/entries/:id`,
    `DELETE day/:date/entries/:id`, `POST day/:date/confirm`, `GET work-items`. All behind the existing gate
    (cookie, same-origin), owners and scouts only, 64 KB cap unchanged. Shapes in the contract.
15. **Logging.** No entry text, token, code, state, verifier or submission body is ever logged. Errors log the
    route and code only.
16. **Help and release.** `help/my-day.md` (owners and scouts), a What's new line, a tour step if the tour test
    needs one for apps (shown to owners and scouts only), and a picture made with `pnpm help:shots` on demo data.

## Overseer pre-review (2026-11-28, binding; wins over the decisions above where they differ)

Six blocking items, all folded in. The contract already carries them.

17. **(B1) Claude's runs aren't the person's time.** A prompt's interval ends at
    min(last answer + 2, prompt + `maxRunMinutes` 10). The full run is kept in `claudeMinutes`.
    Plain: a long Claude run while you're away shows as a gap, not as hours you'd have to trim.
18. **(B2) Refresh matches by chat and overlap, not by key.** `mergeCapture` pairs a new block with an entry of the
    same chat whose captured interval overlaps it. A touched or deleted entry freezes its interval and new blocks
    of that chat are cut around it. `captureKey` is informational.
    Plain: refreshing never double-counts time you've already corrected.
19. **(B3) A failed send is finished with the exact same body.** The draft keeps `pending {submissionId, body}`.
    Confirm resends it unchanged first; edits made since then show as "Changed since confirmed" and go in the
    next confirm. Problems map `entries[i]` to ids through that body.
    Plain: a send that failed halfway can always be finished safely.
20. **(B4) Conflict merges, never overwrites, never auto-sends.** Read the stored day and join by entry id. Stored-only
    entries join the draft marked "From Toolbox". Where both exist, local values win only if changed since last
    confirmed (per-entry `confirmed` snapshot). The revision becomes Toolbox's, `changes` are dropped, and the
    person reviews and confirms again. An untouched captured entry with the same start and length as a stored
    one is replaced by it (no duplicates after a lost draft). Opening a day at local revision 0 while connected
    reads the stored day first.
    Plain: nothing already in Toolbox disappears because this Mac didn't know about it.
21. **(B5) Private removal only before first confirmation.** "This removes private detail" and "Remove as private"
    are offered only at revision 0 (`privateAllowed`). Afterwards the screen says Toolbox already holds the earlier
    wording and an admin can remove it later.
    Plain: Cortex never promises to remove wording it can't remove.
22. **(B6) Team and seams.** See the team table: A owns the gate wiring and the facade; B exposes pure
    `buildSubmission` and `applyResult`; C builds routes and screen against a fake `TimeService`.
23. **Gate order.** The callback branch goes straight after the Host check, before the foreign-Origin refusal, and
    is tested with `Sec-Fetch-Site: cross-site` and a foreign `Origin`. The page uses the existing `plainPage` /
    `sendHtml` (`server/http/server.ts`); `TimeService.callback` returns a `CallbackOutcome`. `/toolbox-callback`
    joins `SKIPPED` in `client/public/sw.js`.
24. **Prompts are a person's turns only.** Machine turns (`promptSource: system` task notifications, `turnOrigin`
    machine values, tag-led notices) don't count. Top-level `<id>.jsonl` only, never `<id>/subagents/`. Streamed,
    cap 500 MB, marks cached by size and mtime. Claude Code keeps about 29 days of transcripts, so older days say
    "No chat history is kept this far back"; a confirmed day is never refreshed automatically.
25. **Outbound calls.** `redirect: 'error'`, 10 s timeout, 2 MB answer cap. Only a 401 clears the connection; 404
    (tool off), 403, 429 and 5xx leave it and say what happened.
    Plain: a Toolbox outage never disconnects you.
26. **Closed work items** block Confirm only when the entry's work item is new or changed since last confirmed
    (Toolbox lets old time keep an archived item). The last list is kept on disk (0600) for names offline.
27. **Remember applies at once** to the day's other untouched entries with the same place.
    Plain: one pick assigns the project's whole day.
28. **Overlaps include personal chats**, so personal time isn't credited to a client; their minutes are then dropped.
    Ties go to a chat with a place, then the lower chat id. A chat since marked personal loses its untouched,
    unconfirmed entries; other vanished captures stay, flagged in the row and beside Confirm.
29. **Keychain (overseer decision a).** `security -i` with the command on stdin, token checked against
    `^tds_time_[0-9a-f]{64}$` and origin validated first, every value quoted, `-U`, read back and compared, 5 s
    timeout, cached in memory, behind `TokenStore`. No file fallback: if saving fails, revoke the new token and
    fail the connect with a plain message.
30. **Split, merge and bulk assign wait for phase 4** (overseer decision d). Editing times and Add entry cover them.
31. **Nice:** changes older than 60 days are dropped when building a submission. Later Toolbox change: return the
    account name so Cortex can show "Connected as".

## Overseer decisions after the first build (2026-11-28, binding)

32. **The chat's own title as a hint, view only.** `dayView` joins a title by `captured.chatId` into
    `DayEntryView.titleHint` (`server/time/chat-titles.ts`). It never goes into `DraftEntry`, anything under
    `<dataDir>/time/`, a log line or a submission body; the transcript reader is unchanged. Titles come through
    `TimeServiceDeps.chatTitles`, wired in `server/index.ts` from Claude Code's sessions list (the same
    `listSessions` the session manager's `listPast` reads). Real titles only: a custom title, or the summary when
    it isn't the first prompt (equal to it, or either one a prefix of the other, gives no hint; so does a missing
    first prompt). One line, control and bidi characters stripped, cut to 80 characters with an ellipsis.
    "Use as description" in the edit panel saves the hint as an ordinary, logged description edit, through the
    panel's unsaved-work hold; there is no "use all". For a chat in a restricted project (card
    `visibility: restricted`, through `TimeServiceDeps.projectRestricted`; a failed lookup counts as restricted)
    the hint shows with no button (`hintAcceptable: false`).
    With it, `mergeCapture`: only a `startAt` or `minutes` edit (or a delete) freezes an entry's times. An entry
    with only description, work item or billable edits still follows capture for its times and keeps the
    person's values (a picked work item keeps its billable flag and certainty). `captured` is always what capture
    proposed, and a times update from capture records no change.
    Plain: Cortex can show you the chat's name to save typing, but it only goes to Toolbox if you choose it.
A. **Open the chat an entry came from.** `DayEntryView.chatId` is set while the chat is still in Cortex's
    sessions list, otherwise null; it is never sent to Toolbox. Each such row has a trailing 28px `icon-btn` with
    the chat icon, a sibling of the row's main button, named "Open chat: <titleHint>" or "Open the chat this came
    from". It calls the store's `openPast(chatId, { in: 'drawer' })` and writes no prompt. The row shows
    `titleHint` as a quiet second line (`--iron`) while the description is empty.
    Plain: one press takes you back to the chat, to check what the time was for.
B. **Joining blocks from the same place is deferred to phase 4**, first on its list.

## Contract

`shared/time-contract.ts`: Toolbox wire types (mirrored from `apps/portal/lib/time/contract.ts` at `75ee320`),
the local day draft, timing constants, and the app routes' request and answer shapes.

## Team and file ownership

| Role | Agent, model | Why | Owns |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique, decisions, sign-off | — |
| Builder A: connection and facade | `builder`, opus | auth, tokens, the gate (hard list) | `server/time/toolbox-client.ts`, `server/time/connect.ts`, `server/time/token-store.ts`, `server/time/connection.ts`, `server/time/index.ts` (the `TimeService`, written last, on B's functions), gate change in `server/http/security.ts` and its switch in `server/http/server.ts`, wiring in `server/index.ts`, `toolboxUrl` in `server/settings.ts` and `AppSettings` in `shared/install-contract.ts`, their tests |
| Builder B: day engine | `builder`, opus | timing engine and data integrity (hard list) | `server/time/transcript-times.ts`, `server/time/chat-blocks.ts`, `server/time/day-store.ts`, `server/time/merge-capture.ts`, `server/time/changes.ts`, `server/time/submit.ts` (`buildSubmission`, `applyResult`), `server/time/links.ts`, `server/time/day-view.ts`, their tests. Order: draft store and submit first, then timing |
| Builder C: routes and screen | `builder`, sonnet | wiring and UI | `server/http/time-routes.ts` (+ the dispatch line in `server/http/routes.ts`), `client/src/apps/my-day/*`, `client/src/shell/apps.ts`, `client/src/shell/Icon.tsx`, `client/src/api.ts` additions, the Settings address field, `client/public/sw.js`, tour, `help/my-day.md`, What's new, tests. Builds against a fake `TimeService` |
| Reviewers | `reviewer` opus: security, correctness; sonnet: UI and accessibility | | — |
| Gates | `expert` opus: security; `expert` sonnet: UX/UI design review | | — |

Builder C builds against the interfaces in the contract (`TimeService`), so it can start at the same time.

## Tests

- A: verifier/challenge format; state single-use and constant-time; wrong state leaves pending; expiry; callback
  never needs the cookie and is GET only; other gate rules unchanged; exchange errors mapped; Keychain write never
  puts the token in argv (spawn args asserted); disconnect cleans up offline; address validation.
- B (tests first): `chatBlocks` (allowance, 10-minute merge, overlap counted once, midnight and BST, sub-minute
  dropped); transcript reader keeps no text and skips tool results, meta and sidechains; `mergeCapture` never
  undoes edits; change list per save, redaction, collapse under limits; submission build (`baseRevision` 0 with
  changes, later without); result handling for ok, repeat, conflict, invalid, locked, 401, network.
- C: routes refuse team role and bad input; screen renders a day, edits, confirms, shows each status; help page
  passes the help tests.

## Gates

`pnpm check` (typecheck, lint, test, build), unintended-deletion scan, browser check on port 3411 against a local
Toolbox on the test database, security expert, design expert review.

## Review outcomes

(to be added)
