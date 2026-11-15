# Home shows your pinned to-dos, chats and documents

Date: 2026-11-15 · Size: L · Branch: `home-pinned-cards` · Explainer: none (declined)
Follows `2026-11-14-chat-favourites.md` and `2026-11-14-todo-favourites.md`.

## Objective

Home's "To-dos" and "Open chats" cards become "Pinned to-dos" and "Pinned chats", listing what the person starred.
A new "Pinned documents" card lists starred files, which needs a star on the file viewer. "Pinned" is the word on Home
and "Favourite" stays the word on the stars (a rename would touch every drawer, out of scope).

## User decisions (fixed)

- Replace the existing cards (not add beside them). Any file the app can open can be pinned. Pins stay on this
  machine (app prefs, never the brain). No explainer. Merge locally only, no push.

## Facts

- Stars for chats (`prefs.favouriteChats`, session ids) and to-dos (`prefs.favouriteTodos`, `TodoItem.key`) exist,
  with one save engine `client/src/state/favourite-list.ts` (`useFavouriteList`) wired in `client/src/store.tsx`.
- Home (`client/src/shell/Home.tsx`) has three cards: to-dos needing you, open chats, favourite skills (kept).
- A library file's `id` is opaque; its `path` (brain-relative) is "shown and copied; never sent back". The viewer
  (`FileViewer.tsx`, `LibraryViewerRequest`) gets `item`, `place`, `openIn`. `BrainReaders.libraryItemForPath(rel)`
  returns `{key, scope, item|null}` (optional), used by chats' files.
- Earlier chats (not open) are in `sessions.past`, keyed by `sdkSessionId` like live ones.

## Decisions

1. **Documents are pinned by brain path**: `AppPrefs.favouriteDocs?: string[]`, newest last, at most
   `FAVOURITE_DOCS_MAX = 100`, each a non-empty string ≤ `DOC_PATH_MAX = 400`, no `..` segment, not absolute.
   Default `[]`. `validatePrefsPatch` and `sanitise` as for the other two. A path survives the library re-listing,
   unlike an id. Plain: the app remembers which files you pinned in its own settings.
2. **Third instance of `useFavouriteList`** (`FavouriteField` gains `'favouriteDocs'`); the existing store tests pass
   unchanged. Store exposes `toggleFavouriteDoc(path)`.
3. **Resolving pins for Home**: `POST ROUTES.libraryResolve` `{paths: string[]}` (≤ 100, same path rule) answers
   `{files: {path, scope, item}[]}` for pins that still resolve to a listed file, in the order sent; others are left
   out (a deleted file just disappears from Home, its pin stays so it returns if the file does). Without
   `libraryItemForPath` it answers `{files: []}`. The browser sends paths only here (the route is read-only, the
   server checks each against the library rules; it never reads a file).
4. **Star on the viewer**: a `StarButton` in `.viewer-actions` of `FileViewer` for library files (not chat pages),
   `on` when `item.path` is pinned. No focus-return logic needed (the button does not move).
5. **Home cards** (order: Pinned to-dos, Pinned chats, Pinned documents, Favourite skills as now; "needs you"
   summary line unchanged):
   - Pinned to-dos: starred `todos.mine` in star order, first 5, row as today (due text, opens via `openTodo`).
     Empty: "Star a to-do to keep it here." Button "All to-dos".
   - Pinned chats: starred chats from `live` then `past` in star order, first 5; live ones show state dot,
     past ones the date; click opens as the Chats drawer does (`openChat` for live; for past use the drawer's
     resume path, found in code). Empty: "Star a chat to keep it here." Button "All chats".
   - Pinned documents: resolved files, first 5, title + place; click dispatches `open-viewer` with
     `{item, place: scope.name, openIn}`. Empty: "Pin a file from its viewer to keep it here." While loading, "Loading".
   - Each card shows "and N more" opening its drawer/app when there are more than 5.
   Plain: Home shows only what you chose to keep; nothing is picked for you.
6. **Words in `shell/words.ts`**, UK English. Existing "Needs you" logic stays for the summary line only.

## Tests (first, for logic)

- `app-store`/routes: `favouriteDocs` validated, de-duplicated, capped; bad paths refused.
- `libraryResolve`: order kept, unresolvable left out, missing reader gives `[]`, over-cap and bad paths refused.
- Store: `toggleFavouriteDoc` (quick taps, failure rollback) mirroring `store.favourites.test.tsx`.
- Home: each card's list, order, cap and empty text; document click opens the viewer; a past pinned chat is listed.

## Team

Solo build by the lead (one connected change, context already loaded). Overseer pre-review and sign-off (Fable,
high); Opus security gate on the new route (paths from the browser); UX/UI expert gate on Home and the viewer star;
one Opus correctness reviewer.

## Overseer pre-review: changes adopted (supersede the decisions above where they differ)

- B1: pin by `LibraryItem.id`, never path. `AppPrefs.favouriteFiles?: string[]` (ids, non-empty, <= 400 chars, max 100,
  de-duplicated). `POST ROUTES.libraryItems` `{ids}` (<= 100) answers `{files: {item, scope}[]}` in order sent, unknown ids
  left out, using `ctx.brain.libraryFile(id)` and `libraryScopes()`; never sends `absPath` or `version`. No
  `libraryItemForPath` use. A test fixes `idFor(...)` to a literal, because pins depend on that scheme.
- B2: the star also goes in `DetailActions` (`client/src/apps/shared/parts.tsx`) for Documents and Images, plus `FileViewer`.
- S1: pinned to-dos come from `mine` then open-to-anyone. S2: `keepStars` also keeps the third list.
- S3: files card re-resolves when `favouriteFiles` or `libraryVersion` change; latest reply wins; old rows stay while
  re-resolving; rows filtered by the current star list.
- S4: chats and to-dos use the drawer's Favourites order (`favouritesFirst`, `sortChats`, `splitFavouriteTodos`); files
  newest pin first. "And N more" opens the drawer.
- S5: card is "Pinned files"; empty text "Star a file to keep it here."
- Past pinned chat: `live` lookup by `sdkSessionId` then `openChat`, else store `openPast(sdkSessionId)`; row meta `whenWords`.
- Remove dead `needsYou`/`HomeLogic` entry if unused; replace its tests.
