# Client picker (type-to-search select)

Date: 2026-11-14 · Size: L · Branch: `client-picker` · Explainer: none (Ian said no)

## Objective

The client lists are native selects with the browser's own arrow, which sits on the text, and 48
clients (and growing) is too long to scroll. Replace every client list with one type-to-search picker
that looks like the rest of the app, finds a client by name or code, and remembers recent picks. Short
fixed lists keep a native select but get the design system's chevron and spacing.

## User decisions (fixed)

- Ian accepted the recommendation (chat, 2026-11-14): inline type-to-search picker for client lists;
  short fixed lists stay native, restyled. Search finds codes from `clients/map.json` aliases.
- No explainer. Merge locally with `wt-finish --merge` once the overseer signs off. No push.
- Finish with a design crit of the built picker in the browser (Ian's goal, 2026-11-14).

## Decisions

1. **One shared component, `SearchSelect`** (`client/src/shell/SearchSelect.tsx`), with its pure logic in
   `client/src/shell/search-select.ts` (matching, ranking, groups, recents). Styles in
   `client/src/styles/search-select.css`, imported in `main.tsx` after `palette.css`.
   Plain: every client list in the app works and looks the same, and there is one place to fix it.

2. **Where it replaces a select (four places):**
   - Home composer foot, "Client": fixed Auto, No client; then group "Clients". `recentKey="clients"`. Width 180px.
   - `ClientAsk` "Another client…": no fixed choices, value `''` shows the placeholder "Another client…";
     the "Use this client" button stays. `recentKey="clients"`. Width 240px (max 100%).
   - To-dos drawer client filter: fixed "All clients" (value `''`), then group "Clients" (the slugs it
     lists today, name or slug as label). `recentKey="clients"`. Takes the space the select took.
   - Library scope (`LibraryTools` in `client/src/apps/shared/parts.tsx`): groups "Mine", "Clients",
     "Shared" as today's optgroups, no fixed choices, `recentKey="library"`. Keeps `.lib-client` width.
   The id and visible or hidden `<label htmlFor>` stay as they are, so the names ("Client", "Another
   client", "Library") are unchanged.
   Plain: the four places where you pick a client become searchable; nothing else moves.

3. **Short fixed lists stay native selects, restyled app-wide.** In `base.css`, `select.field`:
   `appearance: none`, the `chevron` path as an inline SVG background in `--ink-soft` (#33456a), 16px,
   at `right 10px center`, and `padding-right: 34px`. Covers Settings Model, Effort, team levels and the
   to-do people picker. Check `.todo-field select.field`, `.setting .field`, `.levels-actions .field`
   still look right.
   Plain: every remaining dropdown gets our arrow, with room between it and the text.

4. **Search matches the label and hidden terms.** For clients the terms are the slug and the
   `aliases` from `clients/map.json` (codes like "UC", other names like "Air Con"). Ranking and
   multi-word rules are in `matchRank` (contract). Matching letters in the label are bold (`<mark>`,
   weight 600, no fill). At most 50 matches drawn. Fixed choices filter too ("no" finds "No client").
   Plain: type "uc", "air con" or "urban" and Urban Cooling comes up first.

5. **`ClientInfo.aliases?: string[]`, sent in the bootstrap.** Optional, so older servers and callers
   are fine. The server (`bootstrap` in `server/http/routes.ts`) adds each client's aliases from
   `readClientAliases`, keeps the list's A–Z order, and drops aliases that only repeat the name or the
   slug (case and `_`/`-` ignored). Clients with no map entry have no `aliases` field. Read only: the
   app never writes `map.json`.
   Plain: the app learns the client codes the brain already knows; nothing in the brain changes.

6. **Recent picks, per viewer, in localStorage** (`tba.recent.<listKey>`, newest first, at most 5).
   Shown as a "Recent" group under the fixed choices only when the query is empty and the list has 10
   or more options. A pick made in the picker is remembered; a preset (a to-do's client) is not.
   Storage errors are swallowed. Recent rows also stay in the A–Z list (unique keys).
   Plain: the clients you use most are one click away; this is a convenience, so losing it costs nothing.

7. **Behaviour.**
   - At rest it is a `.field`: the chosen label, our chevron (decorative, `aria-hidden`,
     `pointer-events: none`) 10px from the right, text padded 34px on the right. Value not in options:
     empty box showing the placeholder.
   - Focus (click or Tab) selects the box's text. Click, typing, ArrowDown or Alt+ArrowDown opens the
     list. Typing replaces the text and filters.
   - Active option: on open, the current value (scrolled into view); after typing, the first match.
     Up/Down move (wrap off), Home/End move to first/last only while the list is open and the query
     is empty (otherwise they move the caret).
   - Enter: open, picks the active option and closes; closed, opens. Never submits a form or sends a
     message (`preventDefault`).
   - Escape: open, closes and restores the chosen label, and stops the event (so a drawer or
     ClientAsk doesn't also close); closed, does nothing and lets it through.
   - Tab: if the person typed and there is an active option, picks it, then focus moves on normally;
     otherwise closes and restores.
   - Blur by pointer elsewhere: closes and restores. Clicking an option picks it (mousedown is
     prevented so focus stays on the box).
   - `onChange` fires only when the value changes; the recent list is updated on every pick.
   - Disabled: the box is disabled and the list can't open.
   Plain: it works like a select from the keyboard, but you can type to jump straight to a client.

8. **The list is a popover drawn into `document.body`** (a portal), `position: fixed`, so no drawer
   or composer clips it. It opens below the box, or above when there is less than 260px below and
   more above (Home's composer usually opens upward). Width: the box's width, at least 260px, kept
   8px inside the window. Max height 320px or the room available, scrolls. Repositions on resize and
   on scroll (capture) while open. z-index above drawers and the tooltip layer's base (check
   `shell.css` / `Tooltips` z-index). Look: white, 1px `--line`, radius 12, `--lift-2`, padding 6px 0.
   Rows: min-height 32px, 13px, padding 6px 10px, margin 0 6px, radius 8. Hover and the active row:
   `--tint-1` fill. The current value: a `check` icon (or the closest existing icon) at the right in
   navy. Group headings as the palette's `.grp` (12/600 iron, padding 8px 16px 4px). No matches: a
   "Nothing matches" line in iron, not an option.
   Plain: the list floats over everything like a menu and never gets cut off.

9. **Accessibility: the ARIA 1.2 combobox pattern**, as `Palette.tsx` uses: the input has
   `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-autocomplete="list"`,
   `autocomplete="off"`, `spellcheck={false}`; the list `role="listbox"` (labelled by the field's
   name); headed groups `role="group"` with `aria-labelledby`; rows `role="option"`, `aria-selected` on
   the active row; the current value has visually-hidden ", chosen". A visually-hidden `role="status"`
   says "N results" or "Nothing matches" as the query changes. Options are reachable without a pointer;
   the popover follows WCAG 1.4.13 (Escape dismisses, it stays while hovered).
   Plain: screen-reader and keyboard users get the same picker, told how many clients match.

10. **Design system.** `docs/design-system.md` gets a "Search select" entry next to "Field and select"
    (when to use it: any list that can grow, such as clients; a short fixed list stays a native select
    with the chevron), and the Home, To-dos and Library paragraphs that say "client select" are updated.
    Plain: the next screen that needs a client picker uses this one.

11. **Overseer pre-review amendments (these override 6–9 where they differ).**
    - Rows: hover `--tint-1`; the active row `--tint-1` plus the palette's 1.5px `--blue-ink` inset ring
      (`palette.css:93`), since it is the keyboard focus; the chosen value shows only the check (new
      `check` icon in `Icon.tsx`), no wash. Amend "Rings are for…" in `docs/design-system.md`.
    - An empty box is not a choice: with an empty query the active row is the current value, and Tab or
      blur restore it. Only a non-empty query commits on Tab.
    - `mousedown` is prevented on the whole popover (scrollbar drags and headings don't close it).
    - Escape when open calls `preventDefault()` and `stopPropagation()` (`ShellProvider.tsx:196` skips
      handled events). Enter is ignored while `isComposing` (as `Composer.tsx:415`).
    - Recent holds grouped options only (never "Auto"); recents are read when the list opens, not on
      mount (three pickers share "clients"). Storage key `tds-brain-recent.<listKey>`. Per browser.
    - Select-on-focus must survive the click's mouseup.
    - Portal with `createPortal` into body, `position: fixed`, measured in `useLayoutEffect` as
      `Tooltips.tsx:204`; ignore scroll events from inside the popover. z-index 45 (above the floating
      dock 41, below the viewer 50, palette 70, tooltips 80).
    - The listbox is named from the input's label (`input.labels[0]`), else `aria-label`.
    - On open the first row is active if it is the current value; the current value shows the check
      in Recent and A–Z alike.
    - One shared test helper (`client/src/test/pick.ts` or next to existing helpers):
      `pickOption(label, optionName)`.
    Plain: keyboard users can see what Enter will pick, deleting the text never changes the client,
    and the list never closes while you scroll it.

## Contract

`client/src/shell/search-select.ts`: `PickOption`, `ShownGroup`, `ShownOption`, `MatchRange`,
`normalise`, `matchRank`, `matchRanges`, `shownGroups`, `matchCount`, `readRecent`, `rememberRecent`,
plus `clientOptions(clients)` (below). The lead builds it test-first.

```ts
/** Clients as options: label = name, terms = [slug, ...aliases], group = 'Clients'. Order kept. */
export function clientOptions(clients: readonly ClientInfo[], group?: string): PickOption[];
```

`client/src/shell/SearchSelect.tsx`:

```ts
export interface SearchSelectProps {
  /** The input's id, for the `<label htmlFor>` that names it. */
  id: string;
  /** Name when there is no `<label>` (not used by the four call sites, which all have one). */
  'aria-label'?: string;
  value: string;
  options: readonly PickOption[];
  onChange: (value: string) => void;
  /** localStorage list for Recent ("clients", "library"); no Recent without it. */
  recentKey?: string;
  disabled?: boolean;
  /** Shown when the value is not one of the options, and while the box is empty. Default "Type to search". */
  placeholder?: string;
  /** On the wrapper, for width rules at the call site. */
  className?: string;
}
export function SearchSelect(props: SearchSelectProps): JSX.Element;
```

`shared/contract.ts`: `ClientInfo` gains `/** Other names and codes from clients/map.json, e.g. "UC". Absent when it has none, and from older servers. */ aliases?: string[];`

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Lead (me) | — | small pure logic, already in context | `client/src/shell/search-select.ts`, `client/src/shell/search-select.test.ts`, `shared/contract.ts`, `server/brain/client-aliases.ts`, `server/brain/client-aliases.test.ts` (or a new test file), `server/http/routes.ts` |
| Builder | `builder`, sonnet | default (UI) | `client/src/shell/SearchSelect.tsx`, `client/src/shell/SearchSelect.test.tsx`, `client/src/styles/search-select.css`, `client/src/main.tsx`, `client/src/styles/base.css`, `client/src/styles/home.css`, `client/src/styles/drawers.css`, `client/src/apps/shared/library.css`, `client/src/shell/Home.tsx`, `client/src/shell/ClientAsk.tsx`, `client/src/shell/TodosDrawer.tsx`, `client/src/apps/shared/parts.tsx`, `client/src/shell/Icon.tsx` (new `check`), a shared test helper, the tests that drive those selects (`Home.test.tsx`, `Palette.test.tsx`, `TodosDrawer.search.test.tsx`, `ImagesApp.test.tsx`, `DocumentsApp.test.tsx`, any other To-dos test), `docs/design-system.md` |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `client/src/shell/search-select.test.ts` | normalise; each rank; code "uc" beats a label containing "uc"; multi-word; ranges; groups with and without Recent (threshold, stale values dropped, max 5); cap at 50; unique keys; storage that throws or holds junk gives [] | Lead |
| server alias test | bootstrap clients carry aliases minus name and slug repeats; order kept; no map → no `aliases` | Lead |
| `client/src/shell/SearchSelect.test.tsx` | typing filters and "uc" finds the client by code; Enter picks and calls onChange once; Enter inside a form doesn't submit; Escape restores and stops propagation only when open; Tab commits a typed match; ARIA attributes and the status count; disabled can't open; Recent shows after a pick | Builder |
| existing Home / Images / Documents tests | still pass, driving the picker instead of `fireEvent.change` on a select | Builder |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (`pnpm check`)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: UX/UI expert critique (accessibility included)
- [ ] Browser check: Home composer (open upward, type a code), ClientAsk, To-dos drawer filter, Images and Documents library scope, Settings selects (chevron)

## Review outcomes

<Filled at step 10.>
