# Favourites: review across the app, built in Chats first

Date: 2026-11-14 · Size: L · Branch: `chat-favourites` · Explainer: none (declined)

## Objective

Let the person star anything they keep coming back to, so it sits at the top of its list. This plan
reviews every list in the app for where a star fits, and builds it in the Chats drawer first.

## User decisions (fixed)

- A star icon marks a favourite. Favourites sit at the top of their list.
- Build Chats first; the other lists are reviewed here, built later.
- No visual explainer.
- Merge locally (`wt-finish --merge`) once the overseer signs off and every check passes. No push.

## Facts (from the code, 2026-11-14)

- The app's own settings live in `prefs.json` in its data folder (`server/store/app-store.ts`, `AppPrefs` in
  `shared/contract.ts`), never in the brain. `PUT /api/prefs` takes a partial patch checked key by key in
  `validatePrefsPatch` (`server/http/routes.ts`); the store merges it and runs `sanitise`, which keeps only known
  keys with valid values. Writes are queued one at a time and land with write-to-temp-then-rename.
- Skills already have this feature under another name: `AppPrefs.pins` (skill names in pin order, at most 100),
  a `pin` icon button on each skill row (`aria-pressed`, "Pin X" / "Unpin X", shown on hover or focus unless
  pinned), and a "Pinned" fold at the top of the Skills drawer. The client toggles it with `togglePin` →
  `updatePrefs({ pins })` (`client/src/store.tsx`).
- Chats drawer (`client/src/shell/ChatsDrawer.tsx`): Open tab (sorted by `sortChats`: needs an answer, working,
  ready, stopped; newest first in each) and Earlier tab (folds Today / This week / Earlier from
  `groupChatsByDay`, only the first open). Kind switch All / TDS / Personal filters both. Each row has one
  trailing 28px `icon-btn` (Close on Open, bin on Earlier).
- A chat's lasting id is `sdkSessionId` (Claude Code's own UUID): set at once for a reopened chat, and a moment
  after the first message for a new one (null before). `PastSession.sdkSessionId` is always set. The kind store
  already keys by it, so a chat keeps its mark when it moves from Open to Earlier and back.

## Review: where a star fits

| List | Fits? | Why, and how it would work |
|---|---|---|
| **Chats** (Open and Earlier) | **Yes, now** | Long-running chats get buried by date. Keyed by `sdkSessionId`, stored in prefs. This plan. |
| **To-dos** (Mine, Open to anyone, Team) | Yes, next | A to-do you're focused on stays on top of Mine whatever its due date. Keyed by `TodoItem.key`, stored in the app's prefs, **never in the to-do file** (the brain rule). A "Favourites" fold above the due-date groups. |
| **Skills** | Already has it, as "Pinned" | Rename "Pinned" to "Favourites" and swap the pin for the star, so the app has one word and one icon for this. The data stays in `prefs.pins`, so nothing old breaks. Small follow-up. |
| **Documents and Images** | Yes, later | Files you open often (brand guide, rate card). Keyed by `LibraryItem.id` (stable per path). A "Favourites" card first in the grid, a star in the details panel. |
| **Client picker** | Maybe | A few clients you work on most could sit first. The app already remembers the last client, so wait to see if it's wanted. |
| Helpers rows | No | They last one reply. |
| Chat files panel | No | Short, and only about one chat. |
| Global search, Home "Needs you", attention bar, Settings, What's changed | No | Ranked by urgency or time, or not lists you keep. |

## Decisions

1. **One word, one icon, everywhere.** The feature is "Favourites", shown as a star. A new `star` icon goes in
   `client/src/shell/Icon.tsx`; on a favourite it is filled (CSS on `[aria-pressed="true"]`), otherwise outlined.
   Plain: wherever you can favourite something, it looks and reads the same.
2. **Stored in the app's own prefs, flat key per list.** `AppPrefs.favouriteChats: string[]`, `sdkSessionId`s in the
   order they were starred, at most 200, each a UUID. Default `[]`. Later lists get their own key
   (`favouriteTodos`, …) so a change to one list never has to resend another. `validatePrefsPatch` refuses a bad
   list with `bad-request` ("The favourite chats were not understood."); `sanitise` drops bad entries and repeats
   and keeps the newest 200.
   Plain: the app remembers your favourite chats in its own settings file; nothing is written in the brain.
3. **Keyed by `sdkSessionId`.** An open chat with no `sdkSessionId` yet (a new chat before its first reply starts)
   shows no star. Once it has one, the star appears.
   Plain: a chat can be starred as soon as it has started, and stays starred when you close and reopen it.
4. **Order: favourites first, nothing else changes.** Open tab: favourite chats first, then the rest, each part in
   the `sortChats` order (so "needs an answer" still leads within each part). Earlier tab: a "Favourites" fold at
   the top, open, holding the starred chats newest first; the day folds follow without them (no chat shows twice),
   and the first day fold stays open as now. The kind switch filters favourites like any other row; counts stay
   as now. Pure logic in `client/src/state/chat-favourites.ts`.
   Plain: starred chats sit at the top of both tabs; everything else is where it was.
5. **The star control.** On every chat row with an `sdkSessionId`, a 28px `icon-btn` with the `star` icon, before
   the Close or bin button, `aria-pressed`, labelled "Favourite: {title}" (the pressed state tells a screen reader
   whether it's on). Like the skill pin, an unstarred chat's star shows on the row under the pointer or the
   keyboard; a starred one always shows. On touch screens it always shows.
   Plain: tap the star on a chat to keep it at the top; tap again to let it go.
6. **Client action.** `toggleFavouriteChat(sdkSessionId)` in `client/src/store.tsx`. Not built like `togglePin`
   (which reads a stale list on quick taps): the latest list lives in a ref, the star moves at once, only the
   newest reply is shown, and a failure puts back the last list the server confirmed. Over 200 the oldest star
   goes (`.slice(-FAVOURITE_CHATS_MAX)`). Deleting a chat does **not** remove its star (overseer): unknown ids are
   ignored, the cap trims, and a chat put back from the Bin keeps its star. Two open tabs: last write wins, as
   pins do today.
   Plain: starring is instant, quick taps never undo each other, and a failed save says so.
7. **Backward compatibility.** New optional field only. An old `prefs.json` reads as `favouriteChats: []`. A page
   from before this ignores the field. The new page treats a missing field as `[]` (an older server during an
   update), and the server refuses nothing old. One loss to know about: if an **older** app version later saves
   prefs, its `sanitise` drops the unknown key, so favourites are forgotten after a downgrade. Brain files are
   never read or written for this.
   Plain: nothing existing breaks; only rolling back to an older app forgets the stars.

## Contract

`shared/contract.ts`:

```ts
export interface AppPrefs {
  // …existing fields…
  /** Favourite chats: `sdkSessionId`s (UUIDs) in the order starred, at most FAVOURITE_CHATS_MAX. Shown first in the Chats drawer. */
  favouriteChats: string[];
}
export const FAVOURITE_CHATS_MAX = 200;
// DEFAULT_PREFS.favouriteChats = []
```

`client/src/state/chat-favourites.ts`:

```ts
/** Favourites first, then the rest; each part keeps the order given. */
export function favouritesFirst<T extends { sdkSessionId: string | null }>(items: T[], favs: readonly string[]): T[];
/** Splits earlier chats into starred ones and the rest, each keeping the order given. */
export function splitFavourites(past: PastSession[], favs: readonly string[]): { favourites: PastSession[]; rest: PastSession[] };
```

## Team and file ownership

The build is about eight small files, cheaper for the lead than briefing builders.

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Lead (builds) | main session | small change, context already loaded | all files below, this plan |
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Gate: UX/UI | `expert`, opus | domain gate | (read-only) |
| Reviewers | `reviewer`: correctness opus; UI and accessibility sonnet | | (read-only) |

Files: `shared/contract.ts`, `server/store/app-store.ts`, `server/http/routes.ts`, `client/src/state/chat-favourites.ts`,
`client/src/shell/ChatsDrawer.tsx`, `client/src/shell/Icon.tsx`, `client/src/shell/contract.ts` (IconName),
`client/src/store.tsx`, `client/src/styles/drawers.css`, `docs/design-system.md`, and their tests.

## Tests

| Test file | Proves |
|---|---|
| `client/src/state/chat-favourites.test.ts` | favourites first, order kept in each part; null `sdkSessionId` is never a favourite; split keeps order; unknown ids ignored |
| `server/store/app-store.test.ts` | old file reads `[]`; bad entries and repeats dropped; cap keeps newest 200; patch saves |
| `server/http/routes.test.ts` | `PUT /api/prefs` accepts a UUID list, refuses non-UUIDs, non-arrays and over 200 with `bad-request` |
| `client/src/shell/drawers.test.tsx` | star shows with `aria-pressed`; starred open chat sorts first; Earlier shows a Favourites fold without duplicates; no star without `sdkSessionId`; pressing calls the action |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (preview on port 3878, own data folder)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: UX/UI
- [ ] Browser check: Chats drawer, both tabs, star on and off, kind filter, narrow width

## Review outcomes

**Overseer pre-review (fable):** one blocking item, keyboard focus lost on every star press on Earlier (the
row moves to another section): fixed, focus follows the chat. Should items taken: client-side cap, no
removal on delete, ref pattern instead of `togglePin`'s stale read, design-system fold rule amended, the
pin's hover rule extended instead of copied. Nice items taken: fill scoped to `.star-btn`, `SESSION_UUID_PATTERN`
shared with `session-manager.ts`. Decisions as in 4-6 above; Inspector star and the Skills rename deferred.

**Correctness review (opus):** two confirmed, both fixed with tests in `client/src/store.favourites.test.tsx`:
(1) two failed saves in a row left the first star shown though unsaved, so a failure now restores the last list
the server confirmed (`favSaved`, guarded by `favSavedTurn` against late replies); (2) another setting's reply
(pins, last client, to-dos seen) landing mid-save could wipe a star and the next tap built on the wrong
list, so `keepStars` keeps the local list while a star save is waiting. Delete-confirm refactor and server
checks confirmed unchanged and correct.

**UX/UI gate (opus):** (1) un-starring an older chat moved it into a closed section and focus jumped to
another chat, so the destination section now opens (Earlier folds are controlled) and focus follows; (2)
the design-system rule contradicted the Skills pin, so it's noted as pending the Skills follow-up; (3) a
failed save could drop focus, so the focus record now lives 15s and refocuses only when focus was lost. Wash
plus fill, hover reveal, 28px size, contrast and the star's shape all checked fine.

**Fix-round re-review (opus):** two more, both fixed with tests that fail without them: (1) any reply with an
equal list counted as a move and could take focus back within 15s, so the drawer now compares the stars
themselves and refocuses only when the move dropped focus to the page; (2) if the newer tap failed before an
older tap's save succeeded, the stars showed none until a reload, so the late success now shows what the server
holds. Also added a test for the late-reply guard (`favSavedTurn`).

**Browser (preview, port 3444, own data folder):** star and unstar on Earlier by mouse and keyboard; the
Favourites section appears open with Today still open; the star survives a reload (saved to the preview's
`prefs.json`); un-starring into a closed section reopens it with focus on the chat; 390px wide, no sideways
scroll. Port 3878 was held by another session's preview, so 3444 (`wt-start`'s) was used.
