# One search for everything (2026-11-13)

Date: 2026-11-13 · Size: L · Branch: `global-search` (from `todo-handover-search-scope`, commit c04a324) · Explainer: none

## Objective

The global search ("Search or jump to", the palette, ⌘K) finds anything in the app: to-dos, open and
earlier chats, skills, images, documents, places to go, and anything a future app adds. Each app and
feature declares how it is searched in one place, so a new app is searchable as part of building it
and a test fails if it isn't. The to-dos drawer loses its own search row; its `+` moves beside the
client filter.

## User decisions (fixed)

- Global search covers to-dos, chats, images, documents and "whatever app and inventory there is".
- New apps/features must be searchable automatically as part of the build.
- Remove the drawer's search row; move the `+` beside the client filter.
- Branch `global-search` stacked on the committed to-do work. No explainer.

## Facts (checked 2026-11-13)

- Palette: `client/src/shell/Palette.tsx`, logic `client/src/state/palette.ts` (`paletteGroups(query, data)`),
  types `PaletteCommand`/`PaletteOption`/`PaletteGroup`/`PaletteData` in `client/src/shell/contract.ts`
  (~334-373). Today: Go to, Open chats, Run a skill, Start a chat on a to-do; titles only; max 6 per group;
  synchronous.
- Apps: `client/src/shell/apps.ts` exports `APPS: AppSlot[]` (Images, Documents). `AppSlot` in
  `client/src/shell/contract.ts` (~254).
- Library: images/documents are listed per scope (`personal`, `client:<slug>`) by `server/brain/library.ts`
  (`createLibrary`, cached per scope, `LIMITS.listed` 5000), routes `/api/library/scopes`, `/api/library`.
  `LibraryItem` in `shared/contract.ts` (~492) has id, kind, format, ext, group, name/title fields.
- Chats: `LiveSession[]` and `PastSession[]` in the store (`sessions.live`, `sessions.past`).
- To-dos: `client/src/state/todo-filter.ts` (`filterTodos`, accent/case-insensitive, matches title,
  details, client name, project words).

## Decisions (after the overseer's pre-review)

1. **Hits run a callback.** `SearchHit { id, label, hint, icon, run(actions) }` (contract
   `client/src/shell/contract.ts`, "Global search"). The palette passes `SearchActions` from the store, so an
   app adds search without editing the palette's command switch. Plain: new apps plug in without touching search.
2. **Deep link into a library.** `createLibraryStore` gains `openItem(scope, item)`: one `set({ scope, current:
   item, viewing: <item if it can be viewed>, query: '' })`, then `openView('app:<id>')`. App search adapters sit
   outside the lazy UI chunk. Plain: choosing a file opens it in its folder.
3. **Sources, in order:** Go to (Home, To-dos, Chats, Skills, Settings, plus every `APPS` entry, derived not
   hard-coded) · To-dos (mine and open, incl. personal) · Open chats · Skills · Clients (opens Home on that client)
   · Earlier chats (title only: `PastSession` has no client) · Documents · Images (async, last). No Settings sections
   in v1. Empty query: as today (Go to, open chats, pinned skills, first five to-dos).
4. **Server `GET /api/library/search`** (inside `libraryRoute`): `q` 2–80 chars, `kind` required; matches title,
   name, group, folder words and scope name; reply `{ hits: {item, scope}[] ≤ 20, total, partial }`; uses cached
   listings even if stale (refresh behind); builds cold scopes 3 at a time within 1.5 s, then `partial: true`. The
   client retries every 1 s up to 5 times showing "Still looking…". Personal files show only for a typed query,
   hinted "My personal files". Warm the index on first palette open (nice). Plain: fast, and never stalls chats.
5. **Ranking:** title starts-with > word-start > contains > other fields (`search-match.ts`); ties: soonest due
   (to-dos), newest (chats, files). Six per group; heading "6 of N" when more. No "Show all" in v1.
6. **To-do hit:** a one-shot `revealTodo` request (like `requestComposerFocus`) opens the drawer, switches tab,
   clears filters, opens the group and focuses the row. No auto-editor (works for every permission). The old "Start
   a chat on a to-do" becomes two Enters — note it in the changelog.
7. **`/`** opens the global search from anywhere (`client/src/state/keys.ts`); the drawer's own listener and search
   row go; `TodoFilter.query` is removed and `plain` moves to `search-match.ts`.
8. **`+` placement:** right end of the filter row, which always renders when the person can add; the select and `+`
   share one non-wrapping line. With no filter beside it, a labelled quiet "Add a to-do" button instead of a lone icon.
9. **Enforcement:** `AppSlot.search: SearchSource | null` is required (type error if missing); drawer sources are a
   `Record<DrawerName, SearchSource>`; `client/src/shell/apps.test.ts` fails on a `null` not in a reasons allowlist;
   the rule is in the `AppSlot` JSDoc and `docs/design-system.md` ("Apps on the sheet").
10. **Palette:** active option tracked by id, not index; async groups last; live region announces counts.

## Backward compatibility

App-internal (client + one new read-only route). No brain files change. Older brain files and scripts
unaffected. The new route is read-only and returns only what `/api/library` already exposes.

## Team and file ownership (draft)

| Role | Agent and model | Owns |
|---|---|---|
| Overseer | `overseer`, fable | (read-only) |
| Lead | me | `client/src/shell/contract.ts`, `shared/contract.ts`, this plan |
| Builder S (server) | `builder`, sonnet | `server/brain/library.ts` (search fn), `server/http/routes.ts`, `server/brain/index.ts`, `server/setup-mode.ts`, test fakes, tests |
| Builder C (client) | `builder`, sonnet | `client/src/shell/search-sources.ts` (new), `client/src/state/search-match.ts` (new), `client/src/state/palette.ts`, `client/src/state/keys.ts`, `client/src/apps/shared/store.ts`, `client/src/shell/apps.test.ts` (new), `client/src/shell/Shell.test.tsx`, `CHANGELOG` note, `client/src/shell/Palette.tsx`, `client/src/shell/apps.ts`, `client/src/apps/*/` search adapters, `client/src/shell/TodosDrawer.tsx`, `client/src/state/todo-filter.ts`, `client/src/api.ts`, `client/src/store.tsx`, styles, `docs/design-system.md`, tests |

## Tests

| Test | Proves | Owner |
|---|---|---|
| `server/brain/library.test.ts` / routes | search across scopes, cap, no contents, kind filter, bad query refused | S |
| `search-sources.test.ts` | every `APPS` entry declares `search`; registry includes app sources | C |
| `palette.test.ts` | matching/ranking, groups, async merge, stale drop | C |
| drawer tests | no search row; `+` beside client filter | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build
- [ ] Domain gates: UX/UI; security (new route: query length, scopes the person may see)
- [ ] Browser check in the test brain

## Review outcomes

- **Correctness (opus):** 3 confirmed, fixed. Reveal into a hand-closed group (reveal counter in Fold keys);
  server tier 1 now needs every word in the title; stale refreshes go through a pool capped at 3.
- **Security (opus), new route:** no findings. Only scopes `/api/library/scopes` lists, no contents read,
  `q` 2–80 and `kind` validated, no regex from input, builds shared per scope.
- **UX/a11y (opus expert):** 8 confirmed, fixed. No empty "still looking" groups; one announcement while
  looking and one when settled; `/` works with Shift and is advertised; combobox label; group labels carry
  "6 of N"; Clear filters focuses the select; design-doc fix.
- **Drift/copy (sonnet):** 4 confirmed. `/` contract comment; failed or partial file search says so
  ("Couldn't search files just now", "Some folders weren't searched") instead of "Nothing matches";
  "Start a chat on a to-do is now two Enters" goes in the commit body (CHANGELOG is generated).
- **Overseer sign-off:** no blockers. Decision: with no filter row, a labelled quiet "Add a to-do" row
  (the `+` icon on the tabs row truncated "Open to anyone"). Watch item: the cold-build cap is per request;
  overlapping searches share in-flight builds, but a single shared queue would make it a guarantee.
- **Contract after build:** `SearchActions.goHome`/`openDrawer`; `TodoFilter.query` and old `Palette*`
  types removed; `BrainReaders.librarySearch?` optional.
- **Browser (test brain, 3899):** `/` opens search; "acme" finds to-dos, client, image, documents; image
  hit opens Images on its scope; to-do hit reveals and focuses the row; personal files hinted "My personal
  files"; select and `+` on one line at 420px.
