# Pages: hardening and follow-ups

Date: 2026-11-15 · Size: L · Branch: `pages-hardening` · Explainer: `docs/explainer.html` (also published as an Artifact)

## Objective

Close every known gap in pages in the app (shipped in v0.31.0, `docs/plans/2026-11-14-artifacts-in-app.md`), so a page
Claude makes always shows, keeps working, and files or downloads correctly, with nothing quietly piling up on disk.
Bring the app explainer up to date with pages, animated and self-contained, so it can be filed and viewed in the app.

## User decisions (fixed)

- Scope: every follow-up and known limit from the v0.31.0 plan, plus the two flows nobody has tried end to end
  (filing into a client folder, the where-to-save question). Point-and-click stays a separate phase (Phase B) and is
  built only on the user's yes.
- No new paid services, no new infrastructure. Base branch `main`.
- Explainers (this one and any later one) are self-contained HTML that works when filed in the app, and are written
  so a 12-year-old can follow them.
- The app never writes brain files; brain changes go through brain skills or the brain guardian.

## Decisions

### Phase A: robustness (this task)

1. **Ordinary links open in a new tab.** Today a click on any `<a href="https://…">` in a page moves the frame, hits the
   frame-src policy and shows the stop notice. A small link script is added **when a page is served**, never into
   stored bytes: right after the doctype (so the page doesn't drop into quirks mode) in `sendPreviewHtml`'s callers
   (`server/http/routes.ts` library pages and chat pages) and in the branded copy's wrapper (`shared/pages.ts`), which
   gets its own listener. The script listens in the capture phase, takes plain and `target="_blank"` links to `http(s)`
   addresses, leaves `#` links alone, and sends `{ type: 'tds-page-open-link', url }` to its parent. One shared hook
   (`client/src/apps/shared/usePageLinks.ts`) serves both frames (Documents' `Viewer.tsx` and the chat's
   `PageStage.tsx`). It accepts a message only when: `event.source` is that frame's `contentWindow` (its origin is
   `"null"`); the frame has focus and `navigator.userActivation.isActive` is true (a real click); the address parses
   with `new URL`, is `http:` or `https:`, has no user name or password, is at most 2,048 characters, and is not the
   app's own origin or a loopback address (`localhost`, `127.0.0.0/8`, `[::1]`). It then opens `url.href` with
   `window.open(href, '_blank', 'noopener,noreferrer')`. Everything else is ignored. The sandbox, the policy and the stop
   notice for any other move stay as they are. Security gate.
   Plain: clicking a link in a page opens the website in a new tab instead of showing "this page tried to open another
   site", and a page can't use this to open the app's own addresses or open tabs without a click.
2. **Library cache stays fresh.** One exported `isPinned(url)` in `server/store/asset-cache.ts` decides: a full
   `x.y.z` version for the host's own address shape (`…/npm/pkg@1.2.3/`, `…/ajax/libs/pkg/1.2.3/`, unpkg `pkg@1.2.3`,
   `code.jquery.com/jquery-1.2.3`) is pinned; `fonts.gstatic.com` is always pinned; `fonts.googleapis.com` never;
   anything else (including `@4`, `@4.4`, `@latest`, `cdn.tailwindcss.com`) is unpinned. Pinned files are kept for
   ever. Unpinned ones are re-fetched once the cache file's mtime is 7 days old; if the re-fetch fails, the kept copy
   is used and the failure is remembered in memory for an hour, so a download offline doesn't wait 10 s per library
   each time. Table test for `isPinned`.
   Plain: "chart.js@4" looks fixed but changes, so only exact versions are kept for ever; offline conversion still
   works and stays quick.
3. **Version clean-up stops re-reading the folder.** `makeRoom` in `server/store/page-copies.ts` lists the chat's page
   folder on every kept version. It keeps a per-chat byte total in memory instead: added to on each draft, keep and
   copy; a full listing only when the total is unknown or over `PAGE_CHAT_MAX_BYTES` (that listing resets it); the
   total is forgotten on rename, bin, sweep or any error. All changes to one chat's total go through one promise chain
   inside the store, because one chat can have two `Session` objects. Plain: long chats stay quick to save, and the
   total re-counts itself whenever it matters, so it can't drift.
4. **Leftover temporary files are swept.** Beside `sweepPageCopies()` at start (`server/index.ts`), remove regular
   files matching the two exact temp-name shapes (page copies: `.<name>.<12 hex>.tmp`, three folders down; asset
   cache: `<name>.<12 hex>.tmp`) older than `SWEEP_GRACE_MS` (one hour), at those fixed depths only, never following
   links. Plain: a crash mid-save no longer leaves half-written files behind.
5. **Pages made with Bash still show.** In `chat-files.ts`, the Bash branch keeps absolute `.html` / `.htm` change
   words (today shell paths are stored brain-relative and anything outside the brain, such as the scratchpad, is
   dropped). On the command's tool result, each one whose mtime is not older than the command's start is queued
   through the existing `pageWritten` path with `writeIsPage: null`, so it gets exactly Write's checks (`locate`,
   `readSource`, real-page shape) and, like a Write, opens when the reply ends. Shell words are guesses, so a file
   that wasn't touched by the command is skipped. The `PAGES_LINE` instruction to use Write stays.
   Plain: if Claude saves a page with a script, it still shows under Pages and opens, with the same safety checks.
6. **A page that adds libraries at run time is marked as needing the internet.** Before inlining, when one of the
   page's **own** inline scripts names an allowed library host in a string, the branded copy is marked `partial`
   (`X-Page-Self-Contained: partial`). Inlined libraries aren't scanned (they name CDN hosts themselves). Plain: the
   "works offline" mark is only shown when it's true.
7. **Missing tests are added and the flaky test is fixed.** Tests for: a closed chat's events are cleared
   (`closeSession`); no copy is kept when a file grows while it is read (`readSource`). `client/src/shell/Shell.test.tsx`
   fails under load: find the timing it depends on and make it wait for the state instead (no longer timeouts).
   Plain: the checks catch these mistakes if they come back, and stop failing for no reason.
8. **One end-to-end test through the request gate.** A server test drives a fake chat turn that writes a page, then
   fetches the page, a version, the branded download and the change ask through the real routes and `checkRequest`.
   Plain: the whole path is tested the way the browser uses it, not just its parts.
9. **The two untried flows are run with the user.** Filing a branded copy into a client folder and the where-to-save
   question both write to the brain, so the user runs them in the preview from a short script of steps in this plan
   (below) before merge. Any fault found is fixed in this task. Plain: we see both work for real before shipping.
10. **The tds-doc change request is drafted, not filed.** The text of a short "Converting a page" section for the brain's
   `tds-doc` skill is added to this plan for the user to raise through the brain guardian. Plain: the brain's own
   document skill learns about TDS branding, through the proper route.
11. **The explainer is rebuilt.** `docs/explainer.html` covers the whole app as it is now, adds how pages work
   (ask → Claude writes the file → it opens in the app → suggest a change → new version → TDS branding → file or
   download), and shows this plan's changes as "coming next". It uses CSS and a little inline script for animation,
   respects reduced motion, loads nothing from the internet, works with JavaScript off, and reads at a 12-year-old's
   level. Plain: anyone can open it in the app, offline, and understand how it works.

### Phase B: point-and-click (only on the user's yes)

12. **Point at a part of the page to change it.** In the viewer, a "Point at something" mode lets the user click an
    element; the page script sends a short description (tag, text, a CSS path, its box) to the app by the same
    message channel as decision 1, and the change box pre-fills "Change this: …". Needs its own plan, UX gate and
    security gate. Plain: say "make this bigger" by clicking the thing, not describing it.

## Contract

`shared/pages-contract.ts` gains only the message both sides share:

```ts
/** Sent by a page's link script to the app (decision 1). */
export interface PageOpenLinkMessage { type: 'tds-page-open-link'; url: string }
export const PAGE_LINK_URL_MAX = 2048;
```

Server-only constants stay in their stores: `ASSET_UNPINNED_MAX_AGE_MS` (7 days) and the refresh-failure memory (1 hour)
in `asset-cache.ts`; the sweep reuses `SWEEP_GRACE_MS` in `page-copies.ts`.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A | `builder`, opus | security boundary (decision 1): the message gate is the whole defence | link script (`shared/page-links.ts`), its injection in `server/http/routes.ts` and `shared/pages.ts`, `client/src/apps/shared/usePageLinks.ts`, `Viewer.tsx`, `client/src/shell/PageStage.tsx`, their tests |
| Builder B | `builder`, sonnet | default (the overseer's tally ruling makes it routine) | `server/store/asset-cache.ts`, `server/store/page-copies.ts`, their tests, the sweep call in `server/index.ts` |
| Builder C | `builder`, sonnet | default | `server/engine/chat-files.ts`, `server/engine/session-manager.ts`, their tests, `server/http/pages-e2e.test.ts` (new), `client/src/shell/Shell.test.tsx` |
| Explainer | `builder`, sonnet | default (visual) | `docs/explainer.html` |
| Security gate | `expert`, opus | decisions 1 and 5 | (read-only) |
| Reviewers | `reviewer`: correctness (opus), security (opus) | | (read-only) |

The lead writes the contract additions, the plan's review outcomes and the tds-doc text.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `client/src/apps/shared/usePageLinks.test.ts` | a clicked link from the frame opens a tab; a message from another window, without a click, to `javascript:`, to the app's origin or loopback, with `user:pass@`, or over 2,048 characters does nothing | Builder A |
| `server/http/routes.test.ts`, `shared/pages.test.ts` | the link script is served right after the doctype in library pages, chat pages and the branded wrapper, and never stored | Builder A |
| `server/store/asset-cache.test.ts` | `isPinned` table; an unpinned file over 7 days old is re-fetched; a failed re-fetch uses the kept copy and isn't retried within the hour; a pinned one is never re-fetched; a library host named in the page's own inline script marks the copy partial, one inside an inlined library doesn't | Builder B |
| `server/store/page-copies.test.ts` | the total matches a fresh listing after drafts, keeps, copies and removals, including two sessions of one chat at once; the folder is listed only when the total is unknown or over the limit; both temp shapes older than an hour are swept and new ones, other files and links are left; a file that grows while read is not copied | Builder B |
| `server/engine/chat-files.test.ts` | an absolute `.html` written by `cat > /x.html` or `cp` (brain or scratchpad) becomes a page like a Write; a non-page `.html`, a path outside the allowed roots, or a file older than the command doesn't | Builder C |
| `server/engine/session-manager.test.ts` | closing a chat clears its events | Builder C |
| `server/http/pages-e2e.test.ts` (new) | a page written in a fake turn is served, versioned, branded and asked about through `checkRequest` | Builder C |

## Gates

- [ ] Type-check · [ ] Tests (run `Shell.test.tsx` five times in a row) · [ ] Lint · [ ] Build (port 3223)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: security (decisions 1, 5); UX for the link behaviour and the explainer
- [ ] Browser check: a link in a page opens a new tab; a page made with `cp` shows; the branded download offline;
      the explainer in Documents and as an Artifact, light and dark, at phone width, with reduced motion

## User test script (decision 9)

1. In the preview, ask: "Make a one-page chart of last month's traffic for Urban Cooling." Expect the where-to-save
   question with places from the brain's save rules. Pick "just show it here".
2. When it opens, choose "Convert to TDS branding", then "File in client's folder" for Urban Cooling. Expect it filed
   under `clients/urban-cooling/reports/` and listed in Documents.
3. Ask for a new deck template without saying where. Expect the question; pick `templates/`.
4. Change the page with "Suggest a change"; expect no save question and the same page with a new version.

## tds-doc change request (decision 10, for the user to raise)

> **Converting a page.** The TDS Brain App can wrap any HTML page Claude makes in a TDS presentation wrapper ("Convert
> to TDS branding"). The page itself isn't restyled. When a skill produces an HTML page, save it as one
> self-contained file (styles and scripts inline, or from the allowed library hosts) so the app can convert, file and
> show it offline.

## Review outcomes

- **Overseer pre-review (Fable).** Four blocking items, all taken: decision 1 injected the link script where only
  the download passes (now injected at serve time after the doctype, both frames, plus the branded wrapper); the
  link gate was too thin (now also requires a real click, refuses the app's own origin, loopback and `user:pass@`,
  and opens the parsed address); decision 5 would have found nothing (shell paths are stored brain-relative and the
  scratchpad was dropped; now absolute `.html` words go through Write's own `pageWritten` path, skipping untouched
  files); "versioned" was undefined (now `isPinned`, exact `x.y.z` only). Should items taken: byte-total ruling for
  the tally, exact temp-name shapes for the sweep, an hour's memory of a failed refresh, scan only the page's own
  scripts, and the branded copy's links. Rulings: 7 days and one hour kept; the Opus builder moves to decision 1.
- **Build.** Three builders in parallel (A: Opus, links; B: Sonnet, cache and copies; C: Sonnet, script
  pages and tests). All gates passed first time together (2,776 tests).
- **Security review (Opus).** No findings. 42 address forms tried against the link gate (IPv4 short,
  hex, octal and decimal forms, IPv6-mapped, `localhost.`, credentials, `javascript:`/`data:`/`blob:`);
  all refused. Addresses that still pass (`[64:ff9b::7f00:1]`, names resolving to loopback) can't
  reach the app: the gate refuses any Host but `127.0.0.1:<port>` and the cookie is `SameSite=Strict`.
  Script-made pages take Write's own path checks (`O_NOFOLLOW`, device and inode match).
- **Correctness review (Opus).** Confirmed and fixed: the link script ran in the capture phase, so a
  page that handles its own link clicks would also open a tab (now decided on the window in the
  bubble phase, after the page's handlers; test first); a page Bash made vanished when its chat was
  replayed after a restart (now rebuilt when the live run kept a copy under that tool use, `heldOnly`);
  the "touched by this command" check had no slack for drives that keep times to the second (now
  2 s, `MTIME_SLACK_MS`). Tests for both, failing first. From the security review, a UTF-16 page is
  now served unchanged (bytes before its mark would garble it). The Shell test now waits for the
  shell's open-chat button and presses once (no dropped first press found; passes under load).
- **Browser check.** A page Claude saved with `cat >` showed and opened by itself; a plain link and a
  `target="_blank"` link each opened one new tab with the page left in place; a `#` link scrolled
  the page. The explainer ran under the viewer's policy in a sandboxed origin with no requests.
