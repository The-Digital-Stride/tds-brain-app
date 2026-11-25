# Customising Home: the playbook

How to change what Home shows, fast. Worked out on the pinned-cards change
(`docs/plans/2026-11-15-home-pinned-cards.md`, v0.35.0). Read this first, then copy that plan's shape.

## Where things live

| Part | File |
|---|---|
| The page and its cards | `client/src/shell/Home.tsx` |
| The list of Home items a person can hide (titles, hints) | `client/src/shell/home-items.ts` |
| Hide/show and shortcut logic (pure) | `client/src/state/home-layout.ts` |
| The Customise Home panel body and its CSS | `client/src/shell/CustomiseHome.tsx`, `client/src/styles/customise-home.css` |
| What a shortcut can point at | `client/src/shell/useHomeShortcuts.ts` |
| Hidden items and shortcuts (saved in prefs: `homeHidden`, `homeShortcuts`) | `shared/contract.ts`, `server/store/app-store.ts`, `server/http/routes.ts`, `client/src/store.tsx` |
| What each card lists (pure logic, easy to test) | `client/src/state/home-pins.ts`, `client/src/state/home.ts` |
| Card and tray layout (grid, rows) | `client/src/styles/home.css` |
| Words on screen (UK English) | `client/src/shell/words.ts`, or inline in `Home.tsx` |
| A star on something | `client/src/shell/StarButton.tsx` (+ `FileStar.tsx` for files) |
| Saving a list of stars, hidden items or shortcuts | `client/src/state/pref-list.ts` (`usePrefList`, optimistic, with the stale-reload guard `keepBoot`); `favourite-list.ts` wraps it for stars; wired in `client/src/store.tsx` |
| Saved settings (prefs) | `shared/contract.ts` (`AppPrefs`, caps), `server/store/app-store.ts` (clean on read/write), `server/http/routes.ts` (validate on PUT `/api/prefs`) |
| The look rules | `docs/design-system.md` (update it when a card or control changes) |

## Pick the kind of change

1. **Reorder, rename, show more or fewer rows:** `Home.tsx` and `home.css` only. Tests in `Home.test.tsx`.
2. **A card that lists something already starred** (chats, to-dos, skills): add a list function in
   `state/home-pins.ts` that reuses the drawer's own ordering (`favouritesFirst`, `splitFavouriteTodos`,
   `sortChats`), then a card in `Home.tsx`. No server change.
3. **Pinning a new kind of thing** (the files recipe):
   1. Add `favouriteX?: string[]` to `AppPrefs` with a `FAVOURITE_X_MAX` and an id length cap, and a default `[]` in `DEFAULT_PREFS`.
   2. Clean it in `app-store.ts` (drop bad, repeated, over-long; keep the newest N) and validate it in the
      `routes.ts` prefs switch with a plain error ("The starred … were not understood."). Mirror the rules in both.
   3. Add the field name to `FavouriteField` in `favourite-list.ts`, make a third `useFavouriteList` in
      `store.tsx`, add its `keep` to `keepStars`, and expose `toggleFavouriteX` (type and both context lists).
   4. Put a `StarButton` where people meet the thing. Put it **last** in a row of actions so the main action
      stays first in the tab order.
   5. If Home needs the thing's details, the browser sends **ids only**; add a read-only route that returns what
      the library rules already show (see `POST /api/library/items`).
   6. Add the card to `Home.tsx`.
4. **A card of something new that isn't starred** (the Recent cards, v0.88.0, plan `2026-11-25-home-recent-cards`):
   same as 2, but decide the order and cap in the plan, and add the empty-state sentence. Files across every
   folder come from `GET /api/library/recent` (`Library.recent`, sharing search's listing gathering); a `partial`
   answer is asked again every second, up to five times. Leave personal-scope things out of anything listed
   unasked. "Mine" (v0.88.1) comes from `server/brain/my-changes.ts`: this person's commits (git author) plus
   uncommitted changes; it also gives project cards `lastMine`.
5. **A new kind of Home shortcut** (the places and drawers recipe, v0.87.0):
   1. Add the kind to `HomeShortcut`, `homeShortcutKey` and `parseHomeShortcut` in `shared/contract.ts`. Prefer a
      fixed list (like `HOME_SHORTCUT_PLACES`) over a pattern when the targets are known. The app store and the
      prefs route both use `parseHomeShortcut`, so there is one rule to change.
   2. Give `ShortcutSources` (`state/home-layout.ts`) the list and an action, and add a `case` to
      `resolveShortcut` and a group to `SHORTCUT_GROUPS` and `shortcutChoices`.
   3. Fill the list and action in `useHomeShortcuts.ts`, using the rail's own names, and add the kind's word to
      `KIND_META` in `CustomiseHome.tsx`.
   4. Tests: `home-layout.test.ts`, `app-store.test.ts`, `routes.test.ts`, `prefs-routes.test.ts`, the panel
      test, and one `Home.test.tsx` test that clicks the real shortcut.

## Rules that decided past arguments

- **Pin by id, never by path.** Ids are stable for a path and survive restarts; sending paths from the browser
  breaks "the browser only sends ids" and opens a probing hole outside the brain.
- **Home lists what the person chose.** Nothing is picked for them, except the Recent cards (newest first, a fixed
  rule, never personal-scope things; the person can hide each one). Five rows a card, then a quiet small
  "and N more <things>" button that opens the full list. Never a fake list row.
- **Order matches the drawer's Favourites section** for chats and to-dos; files newest pin first (a new pin is never hidden by the row cap).
- **Words:** UK English. The star's name stays "Favourite"; Home's headings say "Pinned …".
- **Any number of cards fits the grid** (`home.css`). A lone last card fills the row (`.home-tray[data-odd="true"]`, set from the count of shown cards, never `:last-child` alone: the drag placeholder is a child too). A new card also needs a row in `home-items.ts`, so people can hide it.
- **Loading, empty and failed are three different states.** Empty text: "Star a … to keep it here."
- **Leave no dead code** when a card goes (`needsYou` was removed with its tests).
- **Prefs stay on this machine.** Never write a pin into the brain.

## The fast process

1. Start in a worktree (`wt-start <task>`); work only there. Merge with `wt-finish --merge` only when told to.
2. Write a short plan from `docs/plans/2026-11-15-home-pinned-cards.md`: objective, user decisions, facts, numbered
   decisions, tests. Size S (one card, no new pref) needs no overseer; a new pref or route is L.
3. Tests first for logic: list functions (`home-pins.test.ts`), prefs clean/validate (`app-store.test.ts`,
   `routes.test.ts`), the toggle (`store.favourites.test.tsx`), and each card in `Home.test.tsx`. In
   `Home.test.tsx` a to-do or chat only shows if the fixture's prefs star it.
4. Gates: `pnpm lint:fix`, `pnpm typecheck`, `pnpm test`, `pnpm build` (`pnpm check` runs them all). Run pnpm
   after `source ~/.nvm/nvm.sh`.
5. Reviews when touching: a new route or pref (security expert), anything people see (UX expert against
   `docs/design-system.md`, who also checks the CSS: the star's hover-reveal only applies inside list rows),
   logic (a correctness reviewer).
6. Update `docs/design-system.md` when a card or control changes.

## Known gaps (as of v0.35.0)

- Files in gitignored client folders (such as feed-cache images) never show on Recent documents or images: git
  never records who changed them.
- Recent documents and images sort by the time of the person's own change: the commit time, or, for a change not
  yet synced, this Mac's file time. History is read from the last 400 of their commits under clients, templates and
  projects, so a file changed long ago may drop off.

- "and N more files" opens Documents, which has no starred view, so pins past the fifth are found by browsing.
- A failed pinned-files lookup shows a message but doesn't retry until a star or the library changes.
- With two tabs open, the last change to hidden items or shortcuts wins (the same gap as favourites).
- Going back to an older version forgets the Home set-up: an older app drops `homeHidden` and `homeShortcuts` on its next settings save, so everything shows again.
- Going back to v0.85 or v0.86 keeps tool shortcuts but drops place and drawer ones, which those versions don't know.
- Shortcuts never hold a skill (Ian, 2026-11-25): v0.87.1 drops any saved skill shortcut on read and refuses one on save. Starting a skill from Cortex's own buttons (the Skills drawer, the Pinned skills card, search) is for owners and scouts only (`skillsMenuVisible`); everyone can still type `/name` in a chat, and a button made for one skill (Start my day) is fine. A new generic list or picker of skills must check `skillsMenuVisible`.
- An older server sends neither field, so Customise Home is hidden until the server updates.
- A save sent a moment before a page reload begins, which the server reads before it writes, can show the old list
  until the next change (`pref-list.ts` `keepBoot`; about a millisecond on a local server, accepted).
