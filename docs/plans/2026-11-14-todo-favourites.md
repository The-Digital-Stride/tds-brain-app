# Favourites in the To-dos drawer

Date: 2026-11-14 · Size: L · Branch: `todo-favourites` · Explainer: none (declined for this feature)
Follows `docs/plans/2026-11-14-chat-favourites.md` (v0.26.0), whose review table named To-dos next.

## Objective

Star a to-do so it sits at the top of the To-dos drawer, whatever its due date. Same look, words and behaviour
as Chat favourites.

## User decisions (fixed)

- "Do the same with todos": same star, same "Favourites" section at the top, same storage rule.
- No explainer. Merge locally with `wt-finish --merge` once the overseer signs off and every check passes. No push.

## Facts (from the code)

- `TodoItem.key` is unique across scopes: `id` for TDS, `personal/<id>` for personal. It already keys every client
  map (held changes, `prefs.todoSeen`, React keys) and a chat's `todoId`. `prefs.todoSeen` keys are ≤ 300 chars.
- A `move` (TDS ⇄ personal) answers `moved: {from, to}`: the to-do gets a new key.
- The drawer (`client/src/shell/TodosDrawer.tsx`): tabs Mine / Open to anyone; filters kind and client; on Mine a
  "New to you" fold (`newToYou`), then due-date folds from `groupTodos` (Overdue, Today, This week, Later, No date).
  Folds are uncontrolled and remount by `key` to reset `defaultOpen`. Only the top section starts open; every
  group opens while a filter is on; the group the global search revealed is held open.
- Rows: `li.todo` is a grid (`minmax(0,1fr) auto`): the `todo-main` button, then an edit button when changes are
  on. Held rows (Undo) and the open editor replace the row.
- Chat favourites' client save (`saveFavouriteChats` in `client/src/store.tsx`) handles quick taps, failures, late
  replies and other prefs saves replacing the list (`keepStars`), each with tests in `store.favourites.test.tsx`.

## Decisions

1. **Stored in prefs as `favouriteTodos`.** `AppPrefs.favouriteTodos?: string[]`, `TodoItem.key`s in star order,
   at most `FAVOURITE_TODOS_MAX = 200`, each a non-empty string ≤ 300 chars (`TODO_KEY_MAX`, the `todoSeen` key
   rule). Default `[]`; optional because an older server sends none. `validatePrefsPatch` refuses a bad list
   ("The favourite to-dos were not understood."); `sanitise` drops bad entries and repeats and keeps the newest 200.
   Never written to the to-do file.
   Plain: the app remembers your starred to-dos in its own settings; the brain's to-do files are untouched.
2. **One save engine for both lists.** `saveFavouriteChats`' logic moves into a hook,
   `useFavouriteList(field, max)` (`client/src/state/favourite-list.ts`), used twice. `keepStars` becomes one
   function that keeps both lists while either is saving. The existing store tests must pass unchanged, plus the
   same cases for to-dos.
   Plain: the tested rules for quick taps and failed saves now cover to-dos too, without a second copy to drift.
3. **Placement.** On both tabs, starred to-dos that pass the filters come first, in a "Favourites" fold above
   "New to you" and the due-date folds, keeping the drawer's order within it. A starred to-do is in Favourites only
   (not also in its due group). If it is also new to you it keeps its dot there, and opening it marks it seen;
   "New to you" and its "Mark all as seen" cover the rest.
   Plain: your starred to-dos are the first thing you see; nothing shows twice.
4. **Which sections start open.** Favourites starts open, and so does the section under it ("New to you", else the
   first due group), as the design-system Fold rule says. While a filter is on every section opens, as now.
5. **The star.** Each normal row (not held, not being edited) gets the shared `StarButton` (moved from
   `ChatsDrawer.tsx` to `client/src/shell/StarButton.tsx`): `icon-btn star-btn`, `aria-pressed`, constant label
   "Favourite: {title}", hover/focus reveal on pointer screens, always shown when on and on touch. It sits between
   the row's main button and its edit button. Available whether or not changes are on, because it changes no
   to-do. Rows for personal to-dos with the gate off get it too.
   Plain: the same star as on chats, on every to-do row, even when the app can't change to-dos.
6. **Focus follows the to-do.** As in Chats: a star press records the to-do and the star after it; when the list
   of stars changes and focus fell to the page, focus goes to that to-do's star, else the next one, else the list.
   Kept 15 s so a failed save that moves it back brings focus back. The section it moves into is opened (a
   per-visit `starOpen` set added to that fold's `defaultOpen` and `key`).
7. **A moved to-do keeps its star.** When a save answers `moved: {from, to}` and `from` is starred, the client
   swaps `from` for `to` in `favouriteTodos` in place.
   Plain: switching a starred to-do between TDS and Personal doesn't lose the star.
8. **No clean-up on done or delete** (as Chats): a ticked-off or deleted to-do's key stays until the cap pushes it
   out. It shows nowhere, and Undo needs no restore.
9. **Home "Needs you" and search stay as they are** (urgency and relevance order).

## Contract

`shared/contract.ts`: `AppPrefs.favouriteTodos?: string[]`; `FAVOURITE_TODOS_MAX = 200`; `TODO_KEY_MAX = 300`;
`DEFAULT_PREFS.favouriteTodos = []`. Store: `toggleFavouriteTodo(key: string): Promise<void>`.

## Team

Lead builds (one pass across contract, server, store and drawer; the parts are small and share files). Fable
overseer (pre-review, sign-off). Reviewers: correctness (Opus, high), UI and accessibility (Sonnet, medium).
UX gate: the UI reviewer's brief includes the design-system consistency check, plus a browser check by the lead.

## Tests

- Server: `sanitise` and `validatePrefsPatch` for `favouriteTodos` (good list, bad entry, too long, repeats, cap).
- Pure: `splitFavouriteTodos(items, favs)`.
- Store: the chat cases repeated for to-dos (quick taps, failure revert, keep during another save), and a
  chat star save plus a to-do star save in flight together keep each other's lists; `moved` keeps the star.
- Drawer: Favourites fold order and contents per tab and filter, no double rows, new dot inside Favourites,
  sections open, star not on held or editing rows, focus follows into a closed section.

## Review outcomes

- **Overseer pre-review:** one blocking item. Fold opening by remount-by-key would steal focus from an open editor or Undo row, and a section closed by hand wouldn't reopen for a later move. So decision 6 became controlled folds (`foldChoice`), reset on tab, filtering or reveal. Should items applied:
  - a starred new to-do keeps its dot in Favourites, and "New to you" is worked out before the split;
  - "Mark all as seen" covers starred new ones too;
  - the star column and hover rules on `.todo`;
  - one shared focus hook (`useStarFocus`).
  Nice item applied: the star swaps at the move step inside `changeTodos`. Decided: carry the star over on move; star on both tabs.
- **UI and accessibility reviewer:** no findings. Doc note added (which sections start open).
- **Correctness reviewer:** one should-fix. Choices made by hand came back after a round trip to another tab or a filter, a regression from the remount scheme. Fixed by dropping them when the scope changes, with a round-trip test. The engine refactor was checked for parity with the old chat code.
- **Mutation checks:** every new store and drawer rule was broken on purpose and a test failed.
- **Mid-task request from Ian:** a to-do row is no longer one big button. An arrow icon button (last, after star and Edit) starts or opens the chat (commit `fix(todos)`). The overseer kept the arrow last, and Chats rows stay whole-row buttons. Dead `.todo-edit` sizing was removed, and the button gap widened to 4px.
- **Browser check (preview, port 3517):**
  - starring moves a row into an open Favourites;
  - unstarring from the keyboard opens the closed Overdue section, and focus follows;
  - stars are saved only in the app's prefs.json;
  - the title no longer starts a chat, and the arrow does.
