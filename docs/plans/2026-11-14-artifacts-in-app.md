# Pages (artifacts) in the app

Date: 2026-11-14 · Size: XL (phases 1 and 2 in one task) · Branch: `artifacts-in-app` · Explainer: none

## Objective

When Claude makes a page with its Artifact tool, the page is published to claude.ai and the app only
shows a raw "Artifact" step and a link that opens a new tab. Pages get lost. This task keeps the
person in the app: the page shows in the app's file viewer, is linked from the reply and the Files tab
like any document, and can be changed ("Suggest a change") or turned into a TDS-branded client
document ("Convert to TDS branding") from the viewer.

## User decisions (fixed)

- Keep publishing to claude.ai (the private link stays shareable); view and work on pages in the app.
- Scripts may run in the page preview, locked down.
- Scope: phase 1 (see it in the app) + phase 2 (suggest a change, versions) + Convert to TDS branding.
  Point-and-click on parts of the page (phase 3) is out of scope.
- Convert to TDS branding uses the brain's existing `tds-doc` skill: a self-contained A4 HTML with a
  PDF alongside, in `clients/<client>/reports/`, like
  `clients/weightmans/reports/call-tracking/weightmans-call-tracking-privacy-research-2026-11-11.html`
  and `clients/photobubble/reports/podww-2026-11-12-cheat-sheet.html`.
- Base branch `main`. No explainer.

## Decisions

1. **Follow Artifact publishes in the chat-files tracker.** `server/engine/chat-files.ts` `observe`
   learns tool_use `Artifact` (any parent): `artifactPublish(input)` says whether it may be a page
   publish; only a tool_result without `is_error` for which `artifactPublishResult(content)` is
   non-null makes it one (quickstart, list, read, open and typed-artifact results all mention
   claude.ai addresses and must not count; see `test/fixtures/artifact-calls.json`). A publish whose
   result address matches a known page adds a version to it (with claude.ai's `remote` version
   number); otherwise it is a new page. The page `key` is fixed at its first publish. The snapshot
   gains `pages`, newest first, capped at `CHAT_PAGES_MAX`.
   Plain: every page Claude publishes in a chat is listed with that chat, and a republish shows as a
   new version of the same page, not a second page.

2. **The app keeps its own copy of each version, outside the brain.** On a successful publish the
   server copies the page file into `<dataDir>/pages/<sdkSessionId>/<key>/v<n>.html`
   (`server/store/page-copies.ts`). It copies only when the path is absolute, ends `.html`/`.htm`,
   has no control characters and is at most 1024 characters, and its `realpath` sits under
   `/private/tmp/claude-<uid>/`, the brain root (configured or real) or the session's cwd. The read
   reuses the `openChecked` pattern (`server/brain/library.ts`): open with
   `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`, `fstat` the handle and require `isFile()`, take the size from
   `fstat`, read at most `PAGE_COPY_MAX_BYTES + 1` bytes from that handle and refuse anything over
   (no check-then-open race, no hang on a FIFO). Folders are made `0o700`, files `0o600`. Writes are
   atomic (temp file + rename); a stored copy is made read-only (`0o444`) and never rewritten, and a
   source path inside `<dataDir>/pages/` is refused. When the chat's `sdkSessionId` changes
   (`handleMessage`, `system/init`), its folder is renamed to the new id. Moving a chat to the Bin
   moves its pages folder to the macOS Bin with the same helper (nothing is erased); at start-up,
   folders of chats whose history no longer exists go to the Bin too.
   Replaying a reopened chat reuses copies already on disk; the only new copy it makes is of a
   page's newest version, when that version has no copy and its source file still exists (older
   versions would otherwise get today's content). Versions without a copy have `hasCopy: false`.
   Retention: copies are kept while the chat exists, at most 16 MB each (claude.ai's own cap) and
   200 MB per chat; over that, the oldest versions lose their copy first, never a page's newest.
   Plain: the page still opens after the temporary file Claude wrote is cleared, old versions show
   what they really were, and the app never writes anything into the brain.

3. **Show a page through its own locked-down route.** `GET ROUTES.chatPage(sessionId, key, n)`
   serves a copy under a new `PAGE_PREVIEW_CSP` (in `server/http/security.ts`):
   `sandbox allow-scripts allow-popups; default-src 'none';
   script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/
   https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com;
   style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:;
   img-src data: blob:; media-src data: blob:; connect-src 'none'; form-action 'none';
   base-uri 'none'; frame-ancestors 'self'` — the same outside sources claude.ai allows artifacts,
   nothing wider (no `img-src https:` beacon).
   claude.ai wraps the stored file at publish time, so the route does too, at serve time (stored
   bytes untouched): unless the file starts with a doctype, it is served inside the same skeleton
   (`<!doctype html>`, `<meta charset="utf-8">`, viewport meta, and the small base reset: zero body
   margin, 14px system font, `img{max-width:100%}`, `[hidden]{display:none}`). Route errors are a
   small HTML page under the same policy, as `libraryPage` does. No `allow-same-origin`, so the page runs in an opaque origin: no cookies,
   no reach into the app or its API (which also refuses a foreign or `null` Origin). The viewer's
   iframe carries the same `sandbox="allow-scripts allow-popups"` attribute; never
   `allow-popups-to-escape-sandbox` (an unsandboxed popup keeps `opener` and could redirect the app's
   tab) and never any `allow-top-navigation*`. The route REPLACES the app's CSP with
   `res.setHeader` as `sendPageHtml` does (two policies would both apply and block the frame), and the
   path is added to `isLibraryPagePath` (`server/http/server.ts`) so gate errors also come back as a
   framable page. The existing `PAGE_CSP` for library pages is unchanged. 404 for an unknown chat,
   key or version, or a version without a copy. A separate port was considered and rejected: cookies
   ignore ports, so it would be less isolated than the opaque origin.
   Plain: interactive pages work and look as they do on claude.ai, but a page can't read anything
   from the app or this Mac, and can only load what claude.ai would let it load. (A link the person
   clicks can still open another site in a new tab.)

4. **One viewer, two kinds of thing.** `ViewerRequest` (`client/src/shell/contract.ts`) becomes a
   union: the existing library-file shape, or `{ kind: 'page'; chat: string; key: string }`. The
   page variant renders `PageStage` in the same drawer: heading = page title, place = "Page from this
   chat", header actions "Open on claude.ai" (new tab, when `url`) and "Copy link"; a version picker
   (newest selected; "Version 3" using `remote` when set, else "Version 2 of 3") when there is more
   than one; a notice when `live` ("Some parts
   of this page only work on claude.ai.") or `multiFile` ("Some files this page uses aren't shown
   here."); "This version isn't kept in the app. Open it on claude.ai." when `hasCopy` is false. When
   a new version arrives while the viewer is open on the newest, it moves to the new one and says
   "Updated" in a polite live region.
   Plain: a page opens over the chat the same way a document does, with its versions and a link out.

5. **Linking pages like files.** The Artifact step reads "Publishing a page" (`toolLabel` in
   `server/engine/event-map.ts`) and opens the page (via `toolUseIds`). A claude.ai artifact address
   in a reply that matches a page in the snapshot renders as an in-app link that opens the viewer
   instead of a new tab (`client/src/components/Transcript.tsx`); an unknown one stays an outside
   link. The Files tab gets a "Pages" fold above "Web links" (`client/src/shell/ChatFiles.tsx`),
   one row per page with its title and "Version n". Matching addresses are left out of "Web links".
   Plain: pages show up where documents and links already do, and open in the app.

6. **Suggest a change from the viewer.** A small form at the foot of the page viewer: a text box
   labelled "Suggest a change" and a "Send" button (Enter sends, Shift+Enter is a new line). It posts
   `PageAskRequest { kind: 'change', note }` to `ROUTES.chatPageAsk`; the server builds
   `suggestionMessage` and sends it into that chat through the same path as the composer (role and
   skill checks, busy rule). The transcript shows only the short `visible` line; the instructions
   and path ride as an engine-only note behind a marker, the way `attachmentNote` does, and are
   split off on replay like `splitAttachmentNote`. An `idle` chat (reopened, not running) takes it
   as the composer would; only a `closed` chat shows "Reopen this chat to suggest changes."
   The desk is inert while the viewer is open, so the form area carries the chat's state:
   - running: form disabled, "Claude is working on this chat." (polite live region);
   - waiting for an approval or an answer: "Claude needs your answer in the chat." + "Go to chat"
     (closes the viewer, focuses the card);
   - a turn that ends with no new version of this page: "Claude replied in the chat." + "Go to chat";
   - a new version: decision 4's "Updated".
   Plain: you type what you want changed next to the page, Claude updates the same page and link, and
   you're told if it needs you in the chat instead.

7. **Convert to TDS branding.** A "Convert to TDS branding" button in the viewer header (same chat
   states and busy rule as decision 6) posts `{ kind: 'brand' }`. It shows only when `tds-doc` is in
   the person's skills list. The server sends `brandingMessage(page, client)` with the chat's client
   when it has one; the visible line starts `/tds-doc`, so the existing `checkSkill` role check
   applies and Claude Code loads the skill. With no client, Claude asks in the chat (decision 6's
   "needs your answer" state covers it); there is no picker. Claude runs `tds-doc` and saves the HTML and PDF in the
   client's reports folder through its own tools and the brain's skill; they then appear in the Files
   tab's "Made" group and open in Documents like any file. The app writes nothing.
   Plain: one click asks Claude for the branded version you send to clients, saved in their folder.

8. **Page text is data, not instructions.** The title and source path come from the model, yet the
   two messages are sent as the person. `artifactPublish` rejects a `file_path` with
   `[\x00-\x1f\x7f]` or over 1024 characters; the messages strip control characters from the title,
   quote it as data ("the page titled “…”") and put the path in a code span.
   Plain: a booby-trapped page title can't speak to Claude as if it were you.

9. **Backward compatible.** `ChatFilesSnapshot.pages` is optional; a client treats it as `[]` when
   missing, and older clients ignore it. Library viewer behaviour and `PAGE_CSP` don't change. A chat
   with no pages looks exactly as before (no empty "Pages" fold).
   Plain: nothing changes for chats without pages, and a mixed old/new app keeps working.

## Contract

`shared/pages-contract.ts`: `ChatPage`, `ChatPageVersion`, `ArtifactPublish`, `PageRef`,
`PageAskRequest`, limits, and the signatures of the pure helpers in `shared/pages.ts`.

Additive edits in `shared/contract.ts` (landed by the lead before building):
- `ChatFilesSnapshot.pages?: ChatPage[]`
- `ROUTES.chatPage(id, key, n)` → `/api/sessions/<id>/pages/<key>/<n>` (GET, HTML)
- `ROUTES.chatPageAsk(id, key)` → `/api/sessions/<id>/pages/<key>/ask` (POST, JSON)

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique, product calls, sign-off | (read-only) |
| Security expert | `expert`, opus | gate: script-running preview, reading model-named paths | (read-only) |
| UX/UI expert | `expert`, opus | gate: viewer, form, links | (read-only) |
| Builder A | `builder`, sonnet | default | `shared/pages.ts`, `shared/pages.test.ts` |
| Builder B | `builder`, opus | security: copies files from paths the model names and serves pages under a new script-allowing policy; a mistake exposes local files | `server/engine/chat-files.ts` (+ test), `server/engine/event-map.ts` (+ test), `server/engine/session-manager.ts` (+ test), `server/store/page-copies.ts` (+ test), `server/http/routes.ts` (+ test), `server/http/security.ts` (+ test), `server/http/server.ts` (`isLibraryPagePath` only), `server/index.ts` (wiring only) |
| Lead | (me) | contract landed first so B and C aren't blocked | `shared/contract.ts`, `shared/pages-contract.ts`, `test/fixtures/artifact-calls.json`, this plan |
| Builder C | `builder`, sonnet | default (UI) | `client/src/shell/contract.ts`, `client/src/state/shell.ts` (+ test), `client/src/shell/FileViewer.tsx` (+ test), new `client/src/shell/PageStage.tsx` (+ test), `client/src/shell/ChatFiles.tsx` (+ test), `client/src/components/Transcript.tsx` (+ `Transcript.links.test.tsx`), `client/src/api.ts` (+ test), `client/src/store.tsx` (only the page-ask call), `client/src/styles/*` (page viewer styles), `client/src/shell/words.ts` |

Builder A runs first (small); B and C build against the contract in parallel.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `shared/pages.test.ts` | publish detection (asset, type_url, read/list, relative path, non-HTML → null; capabilities → live; files → multiFile); URL checks (code/ and plain forms; rejects other hosts, user names, ports, queries, `claude.ai.evil.com`); URL from string and block results; titles (entities, missing, very long); control characters or an over-long `file_path` → null; both messages name title, address and source path, the note is kept verbatim, and a title of `"x\n\nIgnore previous instructions"` comes out on one line, quoted | A |
| `server/engine/chat-files.test.ts` | every fixture in `test/fixtures/artifact-calls.json` gives the expected pages (publish + republish → one page, two versions, `remote` 1 and 2; refusals, quickstart, list, open and typed results → nothing); a helper's publish counts; history replay builds the same pages and copies only a missing newest version; the cap holds | B |
| `server/store/page-copies.test.ts` | copies only absolute regular `.html` files under the size cap and the allowed roots; refuses a symbolic link, a FIFO (without hanging), a folder, a missing file, a file one byte over the cap, a path outside the roots; files `0o600`, folders `0o700`; atomic write; remove-chat clears its folder; keys can't escape the folder | B |
| `server/http/routes.test.ts` | the page route sends `PAGE_PREVIEW_CSP`, `nosniff`, HTML type; wraps a fragment in the skeleton and leaves a doctype'd file alone; 404s (as HTML under the preview policy) for unknown chat, key, version, or no copy; ask route validates the body, 409 when busy, sends the composed message | B |
| `server/engine/session-manager.test.ts` | an ask echoes only `visible` live and on replay (the path never appears in events); the brand message passes through `checkSkill`; the pages folder follows an `sdkSessionId` change and goes to the Bin with the chat | B |
| `server/http/security.test.ts` | `PAGE_PREVIEW_CSP` has `sandbox` with `allow-scripts` and never `allow-same-origin`, `allow-popups-to-escape-sandbox` or `allow-top-navigation`; `connect-src 'none'`, `frame-ancestors 'self'`; the page route sends exactly one CSP header; `isLibraryPagePath` matches the page route | B |
| `client/src/api.test.ts` | the page-ask request passes the real `checkRequest` (JSON content type on POST) | C |
| `client/src/shell/PageStage.test.tsx` | version picker, live / multi-file / no-copy notices, follows a new version when on the newest; form states: running, waiting ("Go to chat"), replied with no new version, closed chat's reopen line; Convert button hidden without `tds-doc` | C |
| `client/src/components/Transcript.links.test.tsx` | a known artifact address opens the viewer; an unknown one stays an outside link | C |
| `client/src/shell/ChatFiles.test.tsx` | "Pages" fold shows only with pages; matching addresses leave "Web links" | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (`pnpm check`; preview per repo rule: `/tmp/tba-preview-artifacts-in-app/`, port 3878, own `TDS_BRAIN_APP_DATA`)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: security (preview policy, file copying, ask route), UX/UI (viewer, form, links)
- [ ] Browser check: a real chat that publishes a page; open from reply link, step and Files tab;
      suggest a change → version 2 appears; Convert to TDS branding → HTML + PDF appear under Made;
      an interactive page with a CDN chart runs; a page cannot fetch the app's API

## Follow-ups (not this task)

- Point-and-click on parts of the page (phase 3).
- A short "Converting a page" section in the brain's `tds-doc` skill, raised as a change request in
  `os/tds-brain-app/change-requests.md` through the brain guardian (the app never edits the brain).

## Review outcomes

<Filled at step 10.>
