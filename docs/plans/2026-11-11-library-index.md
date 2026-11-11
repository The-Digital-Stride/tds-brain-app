# Library index: real images and documents (step 1)

Date: 2026-11-11 · Size: L · Branch: `library-index` (from `app-look-refresh` at `31e0757`) · Explainer: a local HTML page kept in Ian's `personal/` folder and shown in the app's Documents screen (built after the overseer's review)

## Objective

The Images and Documents screens stop showing made-up data and show the files that are really in the
brain: found by rules, sorted into cards, with a real small picture where one can be made and a
standard type tile where it cannot. Read-only. The way files are found has to be flexible, because
images and documents sit in different folders by type and by client.

## User decisions (fixed)

- Build step 1 of the three-step order: the index, standard tiles and real image previews. PDF first
  pages, Markdown and CSV covers (step 2) and Office previews, "linked from" and search inside
  documents (step 3) are out of scope.
- The look refresh and the two examples were committed first (`31e0757`); this work is on its own
  branch. Local only: no push, nothing published.
- An explainer: yes. It is stored in Ian's personal files and shown in the app. So the library also
  covers the person's own `personal/` folder, and the app can open an HTML document.
- Standing: nothing reads or writes `~/agencybrain` until the morning of 12 Nov 2026, except the one
  explainer file Ian asked to be stored in `personal/` (not synced). Build and preview against the
  pretend brain only. The app never writes into the brain for this feature.
- One new library, `sharp`, to resize images.

## Facts (from the code)

- `server/brain/index.ts` builds `BrainReaders`; each reader degrades to empty and never throws.
- `server/brain/watch.ts` watches named folders and fires a debounced `brain-changed` event with an
  area; `client/src/store.tsx` reloads to-dos for `todos` and the whole bootstrap for anything else.
- Every `/api` request passes `checkRequest` in `server/http/security.ts`: allowed Host, no foreign
  Origin, the session cookie. Every reply carries `SECURITY_HEADERS`, including
  `frame-ancestors 'none'` and `img-src 'self' data:`.
- The app's own notes live in `config.dataDir` (default `<app>/data`), never in the brain.
- Tests copy `test/fixtures/brain` to a temp folder (`server/brain/test-helpers.ts`).

## Decisions

1. **Files are found by a rules table, not fixed folders.** `server/brain/library-rules.ts` holds an
   ordered list: a path prefix inside a scope and the card it belongs to (`reports/` → Reports,
   `plans/` → Plans, `briefs/` → Briefs, `call-notes/` → Call notes, `notes/` → Notes,
   `context/brand/` → Brand, `context/reference/` → Reference, `context/analysis/` → Analysis,
   `landing-pages/` → Landing pages, `created/` → Ad builds, `website/` → Website). A file no rule
   matches takes a card named after its first folder, tidied up, as every file in `personal/` does;
   only a file loose in the scope's root goes to "Other". `LibraryScope.kind` allows `shared` now, so
   agency folders outside `clients/` are one line later.
   Plain: a new folder gets its own card with no code change, and a rule only renames or merges cards.
2. **What a file is comes from its extension.** Images: png, jpg, jpeg, webp, gif, avif, svg.
   Documents: pdf; md, txt, docx, html, htm (doc); csv, xlsx (sheet); pptx (deck). Anything else is
   not listed.
   Plain: only pictures and documents appear, not code or settings files.
3. **Some places are never listed.** Any name starting with a dot, `node_modules`, a client's
   `config/` and `crm/data/`, `context/google-ads/data/`, `clients/_*` and symbolic links (files or
   folders). Names are matched whatever their case (`Config/` as well as `config/`). The same check
   runs again when a file is served.
   Plain: passwords, customers' personal data and bulk exports can never appear in the library.
4. **Scopes.** `personal` ("My personal files") first in the list, then one per client from
   `brain.clients()`. The picker's label becomes "Library". The screen never opens on `personal`: it
   starts on the last-used client (`prefs.lastClient`), else the first client, so the titles of
   private notes are not on screen unasked.
   Plain: you choose whose files to look at; your own are one click away, never shown by default.
5. **The index is built on demand and kept in memory.** One walk per scope (depth 8, at most 5,000
   listed files and 50,000 entries visited per scope; `truncated` says when either cap was hit),
   reused until the watcher says that scope's folder changed. The watcher passes the changed path so
   only that scope is marked stale; where no live watcher could be set up (a missing folder, an
   unsupported platform) a listing older than 30 seconds is re-walked. Image sizes and Markdown
   titles are read once per file version and kept in `<dataDir>/library-meta.json` so a restart does
   not re-read every file. A Markdown title comes from its frontmatter `title:` (read with
   `server/brain/frontmatter.ts`), else its first heading, from the first 8 KB only. New watch
   targets, `clients` and `personal` (recursive), fire the new area `library`.
   Plain: the list appears quickly, stays current as files change, and nothing is written to the brain.
6. **Ids are opaque.** An item's id is `<scope id>.<hash of its path>`. The server maps ids back to
   paths from its own index, and re-lists that one scope when it does not know the id (after a
   restart), so pictures keep working; the browser never sends a path. Before serving, the real path is resolved and must
   still be a regular file inside the brain that the rules allow.
   Plain: the page cannot be tricked into reading a file outside the library.
7. **Pictures are always re-made, never passed through.** `GET /api/library/thumb/<id>?w=96|320|1600`
   returns a WebP made by `sharp` (SVG is drawn to pixels too), cached in `<dataDir>/thumbs/` under a
   name made from the file's version. The checked file is read into memory and given to `sharp` as
   bytes, never as a path (the overseer showed an SVG opened by path draws neighbouring image files,
   so a picture from `crm/data/` could leak into a thumbnail; from bytes it draws none). Resize
   `fit: 'inside'` to the width and a 16,000 height (a width-only resize of a very long screenshot
   fails), auto-rotate, a pixel limit and a time limit. Source cap 50 MB; two at a time. A failure answers 404 and is
   remembered until the file changes; the screen then shows the standard tile.
   Plain: real previews for images, and an odd or broken image falls back to the standard tile.
8. **Documents show the standard type tile in step 1.** The row and the panel use the line icon in a
   flat box; no page counts, word counts, status, author, tags, contents or "goes with", because the
   files alone do not say. The row is: icon, title, "PDF, 840 KB", date.
   Plain: the screen only shows what is true of the real file.
9. **Opening a file in the app.** Images open large (the 1600 picture). Markdown and text open
   rendered by the existing Markdown code (`GET /api/library/text/<id>`, cut at 1 MB). HTML opens in a
   frame with an empty `sandbox` attribute; the reply itself carries
   `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'`
   in place of the app's usual policy, capped at 5 MB. No scripts run, the page cannot reach the app,
   and it loads nothing from the network. A link clicked inside the page cannot take the frame to
   an outside site either: the app's own policy (`default-src 'self'`, which covers frames) blocks
   it, checked in Chrome and pinned by a test; the viewer reloads the page and says links are
   switched off. An error on this route is a small plain HTML page under the same policy. The
   text route strips a YAML frontmatter block before sending. PDF and Office files are listed but not opened in step 1.
   Plain: you can read notes and HTML pages (such as the explainer) inside the app, safely.
10. **The viewer sits on the sheet.** "Open" in the panel swaps the sheet's list for the file, with a
    "Back to Documents" (or Images) button in the sheet bar; the panel keeps the details (a panel
    floating over a narrow window closes instead, so the file is not opened behind it). Escape goes
    back when focus is in the viewer (handled there, not in the global key order); going back puts
    the list's scroll position and the focus where they were.
    Plain: opening a file does not take you away from where you were.
11. **The two apps become real and share one data hook.** `client/src/apps/shared` gains the fetch
    hook (loading, failed with "Try again", empty) and the viewer. Sample data and the drawn pictures
    are deleted. Images loses its Type filter (not knowable from a file; the cards do that job);
    Documents keeps its Type filter (from the extension). Status, author, tags, contents and "goes
    with" are removed, not left blank. The search hint is "Search by name or folder" on both screens (both match the name, the title and the card).
    Pictures load lazily, and a card shows its first 60 items with a "Show all" button. The build switch is renamed `VITE_LIBRARY_APPS`; the server routes
    are always there.
    Plain: both screens run on the same plumbing, and stay hidden from the real app until Ian has tried them.
12. **Live updates.** `store.tsx` counts `brain-changed: library` events instead of reloading the
    bootstrap; the hook refetches when the count changes, and again after the server restarts (the
    stream's `hello`), retrying pictures that had failed.
    Plain: add a file to a client's folder and it appears without a reload.

## Contract

`shared/contract.ts`: `BrainArea` (+ `library`), `BrainReaders.libraryScopes / library / libraryFile`,
`LibraryScope`, `LibraryItem`, `LibraryListing`, `LibraryFile`, `LibraryText`, `Thumbnailer`,
`THUMB_WIDTHS`, and the five `ROUTES.library*` entries.

## Team and file ownership

| Role | Agent and model | Owns (files) |
|---|---|---|
| Lead | Fable | `shared/contract.ts`, `package.json`, `pnpm-lock.yaml`, this plan, the pretend brain's sample files, the explainer |
| Overseer | `overseer`, fable | (read-only) |
| Security expert | `expert`, opus | (read-only) |
| Builder A (server) | `builder`, opus | `server/brain/library-rules.ts`, `server/brain/library.ts`, `server/brain/thumbs.ts` and their tests, `server/brain/index.ts`, `server/brain/watch.ts` (+ test), `server/http/routes.ts` (+ test), `server/http/security.ts` (+ test), `server/http/server.ts`, `server/index.ts`, `test/fixtures/brain/**` |
| Builder B (screens) | `builder`, sonnet | `client/src/api.ts`, `client/src/store.tsx`, `client/src/apps/**`, `client/src/shell/apps.ts` (+ test), `client/src/shell/Icon.tsx`, `client/src/shell/contract.ts`, `docs/design-system.md` |
| Reviewers | `reviewer`: correctness (opus), security (opus), UI and accessibility (sonnet), drift and copy (sonnet) | (read-only) |

No file appears in two rows.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/brain/library-rules.test.ts` | each rule's card; "Other" for no match; kinds and formats by extension; every never-listed place is refused | A |
| `server/brain/library.test.ts` | scopes; a listing's items and group order; a symlink, a dot-file, `config/` and `crm/data/` are left out; the cap sets `truncated`; ids are stable; `libraryFile` refuses an unknown id, a file that has gone, and a path that now resolves outside the brain; titles from a Markdown heading | A |
| `server/brain/thumbs.test.ts` | a PNG and an SVG give a WebP of the asked width; the second call is served from the cache; a broken image gives null and is not retried until the version changes | A |
| `server/http/routes.test.ts` | each library route's reply and errors: bad width, unknown id, wrong `view` for the route, the page route's own policy header | A |
| `client/src/apps/**` tests | loading, failed, empty and loaded states; cards from `groups`; filter, sort, selection and chat draft with real paths; standard tile when `thumb` is false or the picture fails; the viewer for each `view`; Back returns focus | B |
| `client/src/shell/apps.test.ts` | the apps appear only with `VITE_LIBRARY_APPS=1` | B |

## Gates

- [x] Type-check · [x] Tests · [x] Lint · [x] Scratch build (never `pnpm build`: the real app serves `dist/client`)
- [x] Domain gates: security (file serving, ids, the HTML frame), UX/UI
- [x] Browser check: Images and Documents on the pretend brain; personal scope; open an image, a note and the explainer; a broken image shows the tile; add a file and see it appear

## Review outcomes

**Overseer pre-review (Fable):** sound, with two blocking changes, both taken. (1) Ids now carry
their scope and the server re-lists on a miss, so pictures survive a restart. (2) `sharp` is given
bytes, not a path, with `fit: 'inside'`, a height cap, a pixel limit and a time limit. Seven
should-fix points taken into decisions 1, 3, 5, 9, 11 and the contract's wording. Product decisions:
keep the build switch until tried on the real brain; drop fields the files cannot fill; viewer on the
sheet with Back and Escape; list all of `personal/` but never open on it; Images loses its Type
filter. Left for later: "Show in Finder" for files the app cannot open, and pruning old pictures.

**Build:** Builder A (server, Opus) and Builder B (screens, Sonnet) in parallel on disjoint files.
Type-check, lint and 559 tests pass (after the review fixes). A normal build ships no library screens.

**Correctness (Opus):** nothing blocking; three confirmed, all fixed. A refetch could join a walk
that started before the change and miss the new file (in-flight walks now carry their generation).
Image size was read from the first 64 KB only, so JPEGs with large metadata lost their size for good
(one whole-file retry, never for an SVG). An open picture or page never refreshed (keyed on the
file's `modified`).

**Security gate (Opus):** nothing blocking; one should-fix and two cheap hardenings, all fixed.
A 1.4 KB SVG took 14 s to measure and starved every other file read. SVG size is now read from the
root tag as text, and SVG pictures are drawn in a separate process (`server/brain/svg-render.ts`),
one at a time, stopped after 5 s, with the failure remembered until the file changes. The reader
now refuses a file whose device and inode differ from the one checked. A symlinked `clients/` or
scope root lists nothing. The gate also reported that a link clicked inside an HTML page could
take the frame to an outside site; the overseer and a click test in Chrome showed the app's own
policy already blocks it, so that finding was dropped and the policy is now pinned by a test.

**UX/UI gate (Sonnet):** one blocking, fixed: the three viewer kinds sit on a tray with one white
card each. Also fixed: Open from a floating panel closes it and focus lands in the viewer; the
whole tile or row is clickable; pressed state on the current item; the "CRM" card name. Left:
status regions that mount already filled; Escape cannot reach inside the HTML frame.

**Drift and copy (Sonnet):** nothing blocking. Fixed: the note for a very large library, "hidden by
your search" wording, one search hint on both screens, "Group" in the panel, the hidden heading.
Text over 1 MB opens cut at 1 MB, as decision 9 says.

**Found in the browser by the lead:** a floating right dock still took its docked width, squeezing
the sheet on a narrow window (`client/src/styles/shell.css`, fixed), and the narrow sheet bar had
no padding above the title (fixed). Both belong to the shell work on `app-look-refresh`.

**Left for later:** `server/brain/clients.ts` still follows a symlinked
`clients/` for the client picker's names (not library code); one to-do watcher timing test failed
once and passed seven times after; "Show in Finder"; pruning old pictures.

**Overseer sign-off (Fable):** signed off, no blockers; it re-ran the gates itself. Two should-fix
points taken: SVG bytes saved under a raster extension are now refused before they reach `sharp`
(the slow-SVG fix was keyed on the extension only), and the frame-navigation finding was corrected
as above. One nice-to-have taken: an open note refetches only when its own file changes. Noted for a
team release: the SVG process is started with an empty environment, untested on Windows.
