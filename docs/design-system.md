# TDS Brain App: design system

The numbers every screen uses. Source: the approved prototype (`docs/shell-prototype.html`), tightened
one step where marked (T) after Ian's review on 2026-11-11 ("the overall design needs to be a little
tighter", "big checkboxes and type", "the hovers feel too subtle and lack the same depth as the other
elements", "use simple effective UI/UX before anything"). Extended where the prototype was silent (X).

Rules of thumb: it is a piece of software, not a web page. Compact and calm. One solid white raised
sheet; glass for the rail, docks and overlays. Brand shows through colour, type and the mark only.
Sentence case everywhere: no capitals-only labels, no letter-spacing. WCAG 2.2 AA: text 4.5:1,
non-text 3:1, targets at least 24×24 CSS px (a smaller visual box is fine when its clickable area,
including label or padding, reaches 24px), visible focus on everything.

## Type (seven sizes: 11.5, 12, 13, 14, 15, 18, 26, plus 12.5 for mono)

| Role | Font | px / weight / line-height | Colour |
|---|---|---|---|
| Sheet-bar title (the page `h1`) | `--head` | 14 / 600 / 1.25 (T) | navy |
| Greeting on Home | `--head` | 26 / 600 / 1.15, −0.01em (T) | navy |
| Drawer section heading (a `Fold` in a drawer) | `--head` | 14 / 600 | navy |
| Dock (drawer, panel) heading | `--head` | 14 / 600 (T) | navy |
| Card heading, section heading in a sheet, answer-box title | `--head` | 14 / 600 | navy |
| Body; row title (row title at 500) | `--body` | 14 / 400 / 1.5 | navy |
| Chat thread reading text | `--body` | 15 / 400 / 1.6 | navy |
| Tile name in an app's grid (denser than a row; up to two lines) | `--body` | 13 / 500 / 1.3 | navy |
| Row meta, hint, help text | `--body` | 12 / 400 / 1.45 | iron |
| Label, group name | `--body` | 12 / 600 | iron |
| Buttons, seg, fold header, key/value lists, step meta | `--body` | 13 / 600 (seg 500) | navy |
| Code | `--mono` | 12.5 (inline 0.88em) | navy |
| `kbd` | `--body` | 11.5 / 500 | iron |

13.5 is used in one place only: a background helper's report card (see Thread content). Nothing else is off this list; `client/src/styles/design-system.test.ts` fails for a new size.

## Spacing, radii, widths

- Spacing steps: 2, 4, 6, 8, 10, 12, 16, 24, 32.
- Radii: 5, 6, 8, 9, 10, 12, 14, 16, 18 (5 ticks, 6 and 8 small pieces, 9 buttons and fields, 10 cards and tiles, 12 pop-ups, 14 big cards and your message, 16 the glass layers, 18 the largest surfaces).
- Column widths: reading 680px, settings 600px, Home 880px.
- Each step is a token in `styles/tokens.css` (`--sp-2` … `--sp-32`, `--r-5` … `--r-18`, `--fs-*` for the type sizes, see "Tokens for the scales"). Every sheet uses the tokens; the guard fails a typed size, radius or layer in a locked sheet.

## CSS layers and files

Every stylesheet is wrapped in one cascade layer. The order is declared once, at the top of `styles/tokens.css` (the first sheet `main.tsx` imports): `@layer tokens, primitives, patterns, features, tools;`. A rule in a later layer beats an earlier layer's rule whatever its specificity, and an unlayered rule would beat all of them, so nothing is left unlayered except the `@font-face` blocks (Fontsource's CSS and the Inter face in `base.css`, which only declare fonts). `@media`, `@supports`, `@container` and `@keyframes` blocks sit inside their layer. `!important` reverses the order across layers (an earlier layer's `!important` wins), which only `todo-panel.css` uses.

| Layer | What goes in it | Files |
|---|---|---|
| `tokens` | custom properties only | `tokens.css` |
| `primitives` | one element each: type, buttons, fields, ticks, `.seg`, `.fold`, `.line`; and the small shared pieces `.tray`, `.card-head`, `.kv`, `.spinner`, `.link-btn` | `base.css`, `primitives.css` |
| `patterns` | composed pieces that exist once: notice, dot, form field, popover, menu row, stat, panel head, confirm, the Setting row, the library parts the eager shell draws | `patterns.css`, `library-shared.css` |
| `features` | one screen or area: shell, drawers, sections (Workbench rows and tool tabs), Home, palette, search-select, chat, Settings, viewer, to-do panel, help, guide, tour, the library, Images, Documents, Projects | `shell.css`, `drawers.css`, `sections.css`, `home.css`, `palette.css`, `search-select.css`, `chat.css`, `settings.css`, `viewer.css`, `todo-panel.css`, `help.css`, `guide.css`, `tour.css`, `apps/shared/library.css`, `apps/images/images.css`, `apps/documents/documents.css`, `projects.css` |
| `tools` | a tool's own look (lazy) | `ad-manager.css`, `command.css`, `summary.css` |

The eager sheets load in this order (`main.tsx`): tokens, base, primitives, shell, drawers, sections, home, palette, search-select, chat, settings, viewer, todo-panel, help, guide, tour, patterns, library-shared. The lazy ones (`ui.ts` of each app or tool) are library, images, projects, documents, ad-manager, command, summary. Inside one layer, order still decides ties.

Rules of thumb that follow:

- A feature restyles a primitive or pattern by setting a property on its own class. It always wins, so it must not hide a state the primitive handles: restate the hover, pressed or disabled look beside it (`.skill-more:hover` does this for the icon button's hover colour) or leave that property out.
- A rule that is only here to be overridden by a later layer is dead: delete it (the viewer header's old grid and the sheet error notice's margin were removed this way, because the shared rule had always won).
- A new shared piece goes in `primitives.css` (one element) or `patterns.css` (a composition), never in a feature file. The guard (`design-system.test.ts`) fails for a sheet with rules outside a named layer.

## Tokens for the scales

All in `styles/tokens.css`. Every stylesheet uses them; a raw size, radius or layer in a locked sheet fails the guard (`design-system.test.ts`). Where a token holds a value that sat between two scale steps, it has its own name (`--glass-75`, `--glass-80`, `--glass-85`, `--tint-04`, `--grey-record`), so swapping a typed value for its token changes nothing. Two deliberate moves off the old values (plan decision 22): the tour's timing is 240ms and its title is 15px.

| Group | Tokens |
|---|---|
| Spacing | `--sp-2`, `--sp-4`, `--sp-6`, `--sp-8`, `--sp-10`, `--sp-12`, `--sp-16`, `--sp-24`, `--sp-32` |
| Radii | `--r-5`, `--r-6`, `--r-8`, `--r-9`, `--r-10`, `--r-12`, `--r-14`, `--r-16`, `--r-18` |
| Type sizes | `--fs-caption` 11.5, `--fs-small` 12, `--fs-mono` 12.5, `--fs-control` 13, `--fs-body` 14, `--fs-reading` 15, `--fs-title` 18, `--fs-display` 26 |
| Layers | `--z-tour` 200, `--z-tooltip` 80, `--z-palette` 70, `--z-skip` 60, `--z-viewer` 50, `--z-popover` 45, `--z-floating-panel` 45, `--z-dock` 41, `--z-veil` 40, `--z-hover-rail` 39, `--z-docked-panel` 8, `--z-rail` 5 |
| Motion | `--t-fast` 120ms, `--t-mid` 160ms (`--t` 240ms stays) |
| Surfaces | `--surface` `#fff`, `--veil` `rgba(2, 27, 67, 0.16)` (the dim behind the to-do panel, the palette and a floating drawer) |

## Layers (z-index)

Named by `--z-*` (see above). The current values, top first: tour 200, tooltip 80, palette 70–72, skip link 60, viewer 50, pop-up 45 (`.popover`: the search-select list, the level menu, the triage pop-up), floating to-do panel 45, floating dock 41, veil 40, hover rail 39, docked to-do panel 8, rail and chat drawer 5. Values from -1 to 3 only order things inside one component. The rule: a pop-up sits above the layer that hosts it. `design-system.test.ts` fails for a value outside this list.

## Dimensions

- Rail item 36px high. Drawer and card rows: padding 7px 8px. Fold header 30px (32px in a drawer). Dock header min-height 47px (48 with the glass edge), padding 0 10px 1px 14px.
- Sheet bar 48px, padding 0 `--sheet-gutter` (16px), no border.
- Header band: the rail's logo, every dock header and the sheet bar fill the top 48px of their layer, with their contents centred on one line (y 36 from the desk's top edge); 32px controls sit 8px from top and bottom.
- A drawer's search or filter (the Skills search, the To-dos switch and client picker) sits on the drawer's own glass between the header and the list (`.drawer-tools`, padding 0 10px 8px); only the list scrolls (`.drawer-scroll`). Nothing in a drawer has a backing of its own (Ian, 2026-11-11: a whiter strip behind the search was "not good").
- The To-dos drawer has no search row: "/" and Search or jump to search everything, and choosing a to-do there opens this drawer on it (its tab, filters cleared, its group open, its row focused). The add button shows whenever the person can add. With a filter (the kind switch, the client picker) it is a 32px `+` primary icon button (`icon-btn` `data-variant="primary"`, "Add a to-do") at the right end of the filter row (`.todo-filters`): with both filters the switch has the first line and the picker and `+` share the second, never wrapping. With no filter, the row holds only a labelled primary small `btn` with a `+` and "Add a to-do", right-aligned so it lines up with that `+` (the tabs row has no room for an icon at 316px: "Open to anyone, N" truncates).
- The Chats drawer's kind switch (All / TDS / Personal, "Which kind of chat") sits straight in the drawer body under the Open / Earlier switch, with no `.drawer-tools` wrapper, because that body is already padded and the two switches must be the same width. It shows only once a chat is Personal (or while a kind is picked). A personal chat's meta ends ", personal" with no lock, because a personal chat is only sorted apart and isn't private (personal to-dos keep the lock). This chat → Details has a "Kind" row, a TDS / Personal `Seg` with a `kv-note` that says what it does.
- Earlier chat rows have a trailing 28px `icon-btn` with the `bin` icon ("Delete chat: {title}"), the same place and size as an Open row's End chat button. Pressing it moves the chat to the Bin at once and swaps the row for the Undo line ("“{title}” moved to the Bin. It leaves the terminal too."; Actions rule 4). Nothing is sent until the Undo time runs out.
- To-do rows are not buttons (Ian, 2026-11-14: clicking anywhere on one started a chat, which surprised). The row's title is a real button that opens the to-do in the to-do panel (plan 2026-11-16-todo-panel; `.todo-open`, for everyone, whether or not changes are on, so reading needs no permission). It looks like text (inherits colour and font, underlined on hover) and has `aria-haspopup="dialog"`. The title (14/500, clamped to two lines, `.todo-title-text`) runs the row's full width; below it are the details line, then a bottom line with the place (a project chip, or plain `.todo-where-text`, ellipsised) on the left and the buttons (`.todo-btns`) always bottom right. With no place and short details the buttons share the details line; otherwise they wrap below (Ian, 2026-11-14: buttons beside the title made titles wrap early; 2026-11-22: the row was clumsy). The buttons run star, Edit (when changes are on: opens the panel already editing; when the person may only tick things off there is no Edit, and the title opens the panel reading), then a blue chat button `icon-btn.todo-go` with the `chat` icon (the speech bubble Chats has on the rail; Ian, 2026-11-14: an arrow didn't say chat), always shown and always last, labelled "Start a chat on this: {title}" or "Open chat: {title}". The row takes a light hover background but doesn't lift; the row open in the panel keeps `--tint-1` (`data-panel-open`). Nothing edits inside a row any more. Chat and skill rows stay whole-row buttons, because opening the thing a row names is what a click is expected to do; a to-do row's click made something new.
- **The to-do panel** (`TodoPanel`, `styles/todo-panel.css`; plan 2026-11-16-todo-panel). A wide panel that slides out from the To-dos drawer's right edge to read, edit and add a to-do, because the 316px drawer is too narrow for details. It uses the file viewer's glass, 16px radius, `--lift-3` and `viewer-in` motion (none under reduced motion), up to 760px wide, kept inside the window. It sits in the desk (`#todo-panel-slot`, mounted by `TodosDrawer`) because `.dock` clips its content; its open state (`todoPanel`: key, mode read / edit / add, unsaved changes, order) lives in the shell like the viewer. `role="dialog"`: with the drawer docked it is non-modal (the sheet is `inert` under a veil, the drawer and rail stay live); when the drawer floats (`modes.drawerOverlays`) it covers the drawer and the sheet at full width less the 12px pad, `aria-modal`, and the rest of the desk is `inert`. Header band: the title (14/600, as the viewer's) with previous and next `icon-btn`s (up and down, tooltips "Previous to-do (P)" / "Next to-do (N)", `aria-disabled` at the ends: the standard 0.5 and not-allowed) and close, all pinned to the top so a wrapped title doesn't push them down. It slides out of the drawer: from 24px to the left (`todo-in`), none under reduced motion. When the drawer floats the layer is z-index 45, above the dock's 40 and 41. Body: the details as the main column; a side strip (`.todo-facts`, a `--tint-1` fill, no edge) with due, assigned to, kept as, for, handed over and chat (worded as a fact: "Has a chat", never "Open chat", which would look like a button; labels 12/600), which drops under the details below 640px of panel width (a container query). Footer: Start a chat or Open chat (primary while reading), Mark as done and Delete (standard: it leads to an Undo, Actions rule 5) on the left; Edit on the right while reading, Save (primary) and Cancel while editing. Read-only people see no Edit or Delete. The status line and errors show in the panel, as the drawer may be under it: one `role="status"` at panel level, under the header, so it is announced across read, edit and add.
  - **The details**: one Tiptap document for reading and editing, so what is read is what is edited (`TodoDetailsEditor`, `.todo-prose`). The editing toolbar is seven `icon-btn`s with tooltips: Heading (one toggle: level 2, keeps an existing level), Body text, Bullet list, Numbered list, Tick list, Bold, Link; pressed is the standard wash and blue ink (a `--tint-1` fill on the `--tint-1` toolbar was invisible), never a ring. Link asks for the address in a small inline field (Apply, Cancel; Esc closes only the field), never a browser prompt, and accepts only http, https and mailto. The toolbar is one tab stop with arrow keys, Home and End moving along it, and it sticks to the top of the body while long details scroll. The details box draws the standard focus ring when the editor has focus (`:has(.todo-prose:focus-visible)`). Tick boxes use the app's `.tick` look and are pressable while reading and save at once; when they can't be pressed they are `disabled`, and each is named by its item's text. A part the editor doesn't offer (a table, a code block, a quote) is a `.todo-kept` block: a quiet `--tint-1` fill, read-only, focusable, with "Edit this part in a chat." as a real `.todo-note` line under it while editing (linked by `aria-describedby`); a wide table scrolls sideways. Tiptap's injected style is off (`injectCSS: false`, the app's CSP blocks it); its base rules live in `todo-panel.css`. The editor's text is always saved back as markdown.
  - **Unsaved changes**: Esc (also from inside the editor), the close button, the veil, previous, next, Start or Open chat, a drawer swap, a new page and a search that reopens the to-do in another mode ask "Discard your changes?" in a quiet `--tint-1` strip under the header (Discard changes danger, Keep editing focused; Esc keeps editing). The Add form's Esc and Cancel ask too once a title is typed. Cancel and Save don't ask. Save is `aria-disabled` while busy, never `disabled`, so focus stays in the panel. Mark as done and Delete close the panel at once and focus the row's Undo.
  - **Focus**: the heading takes focus when it opens (the title while editing or adding); closing returns it to the row's title button. `E` edits, Cmd/Ctrl+Enter saves, `P` / `N` step through the drawer's order (held rows skipped), Esc closes it before the drawer.
- Favourites (plan 2026-11-14-chat-favourites): one word and one icon wherever something can be kept at the top of its list. Skills have it too (Ian, 2026-11-14), replacing the pin: a "Favourites" section above "Used often" in the Skills drawer, and Home's card says "Favourite skills". Home's other cards are "Favourite to-dos", "Favourite chats" and "Favourite files" (plan 2026-11-15-home-pinned-cards): the starred ones only, five rows each, then a quiet "Show N more {to-do/to-dos}" button (singular for one) that expands the card in place and turns into "Show fewer" (`aria-expanded`, hidden noun for screen readers, not saved); it used to open the drawer, which did nothing visible when that drawer was already open. Each card head has its "All …" button, Favourite files included ("All files" opens Documents). Files have the same star (`FileStar`), last in the file viewer's actions and in the first row of `DetailActions`, saved by library id in prefs' `favouriteFiles`. Their list is still saved as the prefs' `pins`, so older versions of the app agree. A chat row with a lasting id has a 28px `icon-btn.star-btn` with the `star` icon, left of End chat or the bin, `aria-pressed`, labelled "Favourite: {title}" (the label never changes; the pressed state says whether it is on). The star is outlined when off and filled when on; like every unstarred star, an unstarred chat's star shows only on the row under the pointer or the keyboard (always on touch). Open lists favourites first; Earlier has a "Favourites" section at the top. After a press, focus follows the chat to its new place, and the Earlier section it moves to opens. To-dos (plan 2026-11-14-todo-favourites) work the same way: every to-do row (not one waiting out its Undo, not one being edited) has the star, before Edit and the chat button, shown whether or not changes are on, since it changes no to-do; starred to-dos sit only in a "Favourites" section above "New to you" and the date sections, on each tab, keeping a new one's dot. Favourites and the section under it ("New to you", else the top date section) start open, and a star press opens the section the to-do moves to. The shared pieces are `StarButton` and `useStarFocus` in `client/src/shell/StarButton.tsx`.
- A skill row shows its title and one clipped line of description. A chevron (28px, right when closed, down when open) opens the full text; clicking the title still starts the skill. The star shows on the row under the pointer or the keyboard; a favourite keeps its star. The star sits left of the chevron, so the chevron is always at the row's right edge.
- Tray: gap and padding 6px. Card: padding 12px 6px 6px (its heading row is inset 8px so text lines up with the rows).
- Home: top padding 32px; greeting margin 0 0 4px; summary line 14px, margin 0 0 18px.
- Composer padding 10px 10px 8px 14px; input 14px. Floater padding 8px 28px 14px.
- Thread: column gap 12px; paragraph margin 0 0 12px.
- Drawer sections: header 32px; a `--line` hairline and 12px of space above every section but the first; rows 6px apart; only the top section starts open, except that a Favourites section and the section under it both start open, so starring never hides today's items. A section can carry one action (`Fold`'s `action` slot): a quiet small `.btn` on the right of the heading line, outside the toggle button (nested buttons are invalid). The unread dot hangs in the row's left padding so titles share one left edge.

## Shared pieces

Each piece below exists once; tools compose it and never restyle it. Built in the UX consistency programme (plan 2026-11-22-ux-consistency, decision 21). The "Not" column lists the old builds that were swapped for each piece; use the piece.

| Need | Use | Not |
|---|---|---|
| Warning, error, info or success box | `.notice` with `data-level="info\|warn\|error\|ok"` and `data-shape="box\|strip"` (`patterns.css`). A box is a 10px-radius card line; a strip is a full-width band (`--sheet-gutter` inset, bottom hairline). Buttons placed in it go to the end of the line; wrap two in `.notice-actions`. Error and warn use `--danger` / `--amber-*` on their washes. The rules need `data-shape`, so the old chat `.notice` is unaffected | `.proj-banner`, `.error-banner`, `.update-banner`, `.offline-banner`, `.health-summary`, `.am-line`, `.home-skill`; `data-level="warning"` (it is `warn`) |
| "Are you sure?" strip | `Confirm` (`shell/Confirm.tsx`): `label`, `text`, `action`, optional `safe` (default "Cancel"; "Keep editing" or "Keep chat" when protecting work), `variant`, `busy`. The safe option has focus, Esc picks it, busy uses `aria-disabled`. Class `confirm` | a hand-written confirm strip, `.todo-ask`, `.proj-ask`, `.am-confirm` |
| Status dot | `.dot` with `data-state="ok\|warn\|bad\|idle\|working\|asking"` (colours `--state-*`, each 3:1 or better on white). **Always beside a visible word**, or inside a labelled control whose name says it (a Settings tab's dot: "Health, 1 thing needs attention"). Red is `bad` only: running work is `working` (blue), never red | `.attn-dot`, `.health-dot`, `.cc-dot`; red for "running" (`--attn-working-edge` now points at the working blue) |
| Form field | `.form-field` (label above, 4px gap) holding a `.label`, the control (`.field`, `textarea.field`), then `.hint` (12px, iron) and `.error` (12px, danger). Mark a bad control `aria-invalid="true"` (danger border) and link its message with `aria-describedby`. `:disabled` is styled once | `.todo-field`, `.proj-field`, `.am-field`, `.note-field` |
| Hint or meta text | `.hint` (12px) and `.note` (13px) | one-off 12/13px text classes |
| Pop-up list or menu | `.popover` (layer 45, radius 12, `--lift-2`) holding `.menu-row`s (hover `--tint-1`, `aria-current="true"` ring) | `.ss-pop`, `.cc-triage`, `.level-menu` and their rows |
| Headline figure | `.stat` with `.stat-label`, `.stat-value` (18px), `.stat-change` (`data-tone="good\|bad"`), inside a `.card` | `.am-fact`, `.sm-fact` |
| "Show N more / Show all N / Show fewer" | `ShowMore` (`shell/ShowMore.tsx`): `expanded`, `count`, `noun {one, many}`, `wording "more\|all"`, `onToggle`. A quiet small button with `aria-expanded`; "Show fewer" keeps the noun for screen readers | the three hand-built buttons (Home's `MoreLink`, `FolderCard`, `AmTable`) |
| Panel header band | `.panel-head`: 47px high, padding `0 10px 1px 16px` (the 16px is `--sheet-gutter`, the sheet bar's and the viewer's inset; the dock used 14 and the to-do panel 18), contents centred, `h2` 14/600 | the five header builds with insets of 14, 16 and 18px |
| Empty, loading, error line | `StateNote` (`shell/StateNote.tsx`): `kind`, children ("Loading…" is the default), `onRetry` adds a standard "Try again" button. One size: 12px, the `.hint` look | `LibraryNotice`, 12/13/14px variants, "Loading" without the ellipsis |
| Undo line | `UndoLine` (`shell/UndoLine.tsx`; contract in `docs/plans/2026-11-22-ux-consistency-contract.ts`; styles `.undo-line*` in `patterns.css`): `as="row"` in place of a drawer row, or `as="strip"` at the top of the sheet. Ten seconds, a countdown bar, a quiet small Undo (Actions rule 4) | a hand-built "Undone" or "Removed" line |
| Copy to clipboard | `useCopy` (`shell/useCopy.ts`): `{ said, copy }`; `said` is "Copied" or "Could not copy" for two seconds | `apps/shared/copy.ts` (kept as a re-export) |

## Controls

- **Buttons: one language** (Ian, 2026-11-13: "every button should be a button, not text. Unless within inline text"). Six kinds, each with one meaning:
  - **Primary** `.btn[data-variant="primary"]`: navy, paper text. The action the area exists for; one per area (an edit form's Save, a confirm step's "Mark as done", New chat, Send, Update and restart).
  - **Standard** `.btn` (no variant): white, 1px `--line-strong` edge, `--lift-0`, navy text. Every other option: Cancel, Keep open, Not now, Don't allow, Copy path, Try again.
  - **Quiet** `[data-variant="quiet"]`: `--tint-1` fill, navy text, no edge. Minor and "see all" actions: Later, Reload, Dismiss, Back, Clear date, All chats, Mark all as seen, Show older versions, More options.
  - **Danger** `[data-variant="danger"]`: standard with `--danger` text. Removes something or ends work that can't be got back: Delete, the "End chat" confirm.
  - **Send and Stop** (Ian, 2026-11-14): Send is primary (navy, for consistency: Ian tried green and kept navy) with the `send` paper-plane icon. While Claude works on a reply it becomes Stop, `.btn[data-variant="stop"]`, filled `--danger` red with the `stop` square, used nowhere else, in the same place (the same button, so focus stays on it). The second click of a double-click is ignored (`detail >= 2`), so a double-click on Send can't stop the reply it just sent; a keyboard press always works. Pressing it says "Stopping" to screen readers, and when the reply ends focus on it moves to the message box (the Send it turns back into is disabled). White on the red is 7.3:1. Stop lives only here, not in the chat's top bar.
  - **Icon** `.icon-btn`: 32px, radius 9 (28px inside rows), always with an `aria-label`. Bare, `--ink-soft`, for utilities (close, toggle, star, attach, edit, more): the icon is the shape. `data-variant="primary"` (navy fill, paper icon) only for the one icon button that creates the main thing in its area, such as the To-dos `+`.
  - **Tooltips (the standard, Ian, 2026-11-14): every button that shows only an icon has one.** The shared layer (`client/src/shell/Tooltips.tsx`, mounted once in `App.tsx`) shows a navy name, 12px, under the button (to the right of the rail's icons), drawn into the body so no drawer clips it, kept 8px inside the window and flipped above when there is no room below. It shows the button's `aria-label` for any `.icon-btn` or `.chip-remove`, or `data-tip` on anything. A tall edge handle sets `data-tip-side="left"` to have it beside the handle, centred on it (the viewer's resize grip; Ian, 2026-11-15: under a full-height strip it showed at the top of the window). When the label carries a title ("Favourite: {title}", "End chat: {title}"), set `data-tip` to the short name ("Favourite", "End chat"); otherwise the label is the tooltip. It appears after 350ms of pointing (at once while another is showing), at once for a button reached from the keyboard, never for touch or a click's focus. It stays while pointed at, for 150ms after the pointer leaves, and Escape puts it away (WCAG 1.4.13). Pressing the button, scrolling the page or the list it is in (not another scroller, such as a chat streaming a reply) or resizing puts it away too; a button that changes its name or moves takes the tooltip with it. A button whose words show (`.btn-label`) gets none; give it `data-tip` too if a narrow layout hides those words, and the tooltip shows only then. It is `aria-hidden`: the button's own name already says it. Never use the native `title` on an icon button: it draws a second, browser tooltip. `client/src/shell/icon-buttons.test.ts` fails on an icon-only button that would have no tooltip, or that has a `title`.
  - **Link** `.link-btn` or `a`: blue-ink, underlined. Only inside a sentence ("…in Settings.").
  - Sizes: 32px by default (header bands, forms, cards, sheets); `data-size="small"` 28px for a button on a line with text (card head, Fold action, notice strips, inline confirms, the selection bar, inside rows). No other heights.
  - Colour meanings: navy "do it", white "another option", grey "minor", red "careful" (and, filled, the message box's Stop), light blue (wash + blue-ink) only "switched on" or "open", underlined blue only a link in a sentence.
  - Not boxed, because something else shows they're clickable: list rows (they lift; a to-do row is the exception, below), fold heads (chevron), Seg options (the track), `.chip-remove` (inside its chip) (Ian, 2026-11-13: keep headings as text with an arrow). Nothing else that you click is bare text.
- **Show/hide toggles are icons, top right, always** (Ian, 2026-11-13: "put the icon in the top right ALWAYS everywhere it appears - it's a rule"). The rail's names toggle (`rail` icon) and the right panel's toggle (`panel` icon) are icon buttons with no visible words; the name lives in `aria-label` and a hover tip. The rail's sits at the top right of its header band, 10px from the edge like a dock's close button; with the rail at icons only and a pointer that hovers, it shows top right once the rail has slid out (see Rail hover below), labelled "Keep names showing", so it never moves from under the pointer; on touch it takes the mark's place, as before. The panel's is the last thing in the sheet bar, after "Search or jump to": pass `panel` to `SheetBar` and never place `PanelToggle` yourself.
- **Field and select** `.field`: 32px, padding 0 10px, 1px `--field-edge`, radius 9, 13px, white fill. A native `select.field` (a short fixed list: Settings Model, Effort, team levels, the to-do people picker) has `appearance: none`, our `chevron` (16px, `--ink-soft`) at `right 10px center` and `padding-right: 34px`.
- **Search select** `SearchSelect` (`client/src/shell/SearchSelect.tsx`, logic in `search-select.ts`): use it for any list that can grow, such as clients (Home's Client, "Another client…", the To-dos client filter, the Library scope); a short fixed list stays a native select with the chevron. It is a `.field` (text padded 34px on the right, the decorative `chevron` 10px from the edge) that selects its text on focus, whenever the list opens and after a pick, and filters as you type, by label and hidden terms (client codes). The list is a popover drawn into the body (`position: fixed`, z-index 45, opens upward when there is less than 260px below and more room above): white, 1px `--line`, radius 12, `--lift-2`; rows 32px, 13px, hover `--tint-1`; the active row (the keyboard's place) `--tint-1` plus the palette's 1.5px `--blue-ink` inset ring; the chosen value shows only a navy `check` at the right; group headings as the palette's `.grp`; matching letters bold (`<mark>`, 600, no fill); a "Recent" group (this browser's last 5 picks, shown with 10 or more options and no query) and "Nothing matches" in iron. ARIA 1.2 combobox as the palette. Enter never submits a form or sends a message; Escape closes and stops the event only when open.
- **Tick** `.tick` (on `input[type=checkbox]` or `input[type=radio]`): 18px, `appearance: none`, 1.5px solid `--tick-edge` (#7C8AA5), fill rgba(255,255,255,.7), radius 5 (radio 50%). Checked checkbox: navy fill, white check. Checked radio: navy border, centred 8px navy dot. Hit area: wrap in `label.tick-hit` (24px box) when the input stands alone.
- **Switch** `.switch` (on `input[type=checkbox][role=switch]`), for on/off settings that apply at once: track 30×18, radius 999, off `--grey-dot`, on navy; knob 14px white with `0 1px 2px rgba(2,27,67,.2)`, moves 12px. Row: grid `1fr auto`, gap 16; title 14/500; help 12 iron, margin-top 2.
- **Seg**: options 28px, 3px padding, 3px gap between options (so a hovered or focused one never touches its neighbour), radius 10 / 8, 13px.
- **Rail hover** (plan 2026-11-20-rail-hover-tool-tabs, decision 1; ported from the portal's decision 34, Ian, 2026-11-20). With the rail at icons only and a pointer that hovers, resting on the rail for 200ms (or tabbing into it) slides it out to 212px with names, counts and the full sync line, over the drawer and sheet on the same glass with `--lift-2`. Nothing else moves: `.railslot` keeps 60px in the row, and its hover zone reaches over the desk's 12px gutter. It shuts 150ms after the pointer leaves, when focus leaves, on Esc, when an item is chosen, and at once when anything modal opens; it sits at z-index 39, under every veil. It is not a setting: the toggle and `[` still pin names. No rail tooltips while it is out. Focus handed back to a rail button by a closing drawer, or a click's focus, doesn't open it. Width and shadow ease over 160ms; none under reduced motion.
- **Tool tabs** (`ToolTabs`, decision 2). When a tool's group has two or more tools this person can see, a row of tabs sits between the sheet bar and the page: a `nav` named "{group} tools" of buttons with the `.seg` look, the current one `aria-current="page"`. Labels are `ToolSlot.tabLabel` (Ads: Manager, Command Centre, Account Summary), with the drawer row's numbers. Not the `Seg` component, which is a radio group: these are page links. The row scrolls sideways rather than clip. The sheet bar title is then "Workbench · {group}", the tool's name kept as hidden text for screen readers. The chosen account and an open run chat stay across a switch.
- **Page tabs** (`SheetTabs`, plan 2026-11-20-settings-tabs). The tool tabs' row, shared: `ToolTabs` wraps it, and Settings uses it as a `nav` named "Settings sections" (General, Claude, Skill levels, Health, About). Same look, keys and rules; labels only, no icons. A tab that holds nothing for this person is hidden, and a row of one shows nothing. Settings starts at the gutter like the title above it: the row sits in `.page-tabs` (12px above, `--sheet-gutter` sides) over a `.page.settings` column (max 600px, left-aligned, `--sheet-gutter` sides) so the tabs line up with the text below; the row sizes to its buttons (`width: fit-content`), since `.seg` is a flex row that would otherwise stretch. A problem that must show from any tab is an 8px `.dot[data-state="bad"]` after the label, with the problem in the tab's spoken name; never `.count`, which means "waiting". The sheet bar keeps the page's name ("Settings") with the tab's name as hidden text. Each tab's sections keep their own `h2`; none repeats the tab's name. A tab change starts the page at the top.
- **Chip** `.chip`: 12/500, padding 2px 9px, tray fill. **Count** `.count`: 12/600, line-height 18.

## Actions: where they go, what they look like, what they're called

(Plan 2026-11-22-ux-consistency, decisions 8 to 20; Ian, 2026-11-22: "the button placements should be
consistent".) These rules answer the same questions for every tool. A new tool follows them; an exception is
named here or it isn't one.

1. **A row click opens what the row names and never creates anything.** Chat, skill, project and Home card
   rows open their thing; a to-do's title opens it in the to-do panel (Home's Favourite to-dos too). One
   named exception: a list with a details pane (Documents, Images) selects on click, and a trailing "Open"
   opens it large. Project Files has no pane, so its row opens the file.
2. **Trailing order in a row**, left to right: star → the item's utility (Edit, Open, the expand chevron) →
   remove (bin, or X for a chip) at the very edge. At most three icons. Where the row's main action is an icon
   (a to-do's blue chat button), that icon takes the edge and nothing destructive sits in the row.
3. **One icon, one verb.**

   | Icon | Means only |
   |---|---|
   | `close` (X) | put a surface away (drawer, panel, viewer, pop-up), or take a chip out of a set. Never ends work |
   | `end` | End chat: ends a chat session (Open chat rows, the chat's top bar). Not a square, so it can't be read as Stop |
   | `bin` | delete |
   | `edit` (pencil) | edit |
   | `more` (three dots) | opens a menu, nothing else |
   | `star` | favourite |
   | `chat` | start or open a chat |
   | `chevron` | disclose, step, or go back |
   | `wide` | full width |
   | `expand` | open full screen |
   | `plus` | new or add |

4. **One safety net per kind of action.**

   | Kind | Pattern |
   |---|---|
   | Easily put back (remove a file from a to-do or project, clear, star) | do it at once; a polite status line says what happened; focus moves to the next row |
   | Recoverable delete or tick (to-do, file, chat to the Bin, Mark as done) | do it at once and show the **Undo line** (`UndoLine`): 10 s, a countdown bar, a quiet small Undo; the clock stops while pointed at or focused and restarts in full on leaving. As a row in place of the removed drawer row, or a strip at the top of the sheet when no row is in view (viewer, grid, details pane). Focus moves to Undo only after a keyboard press; after a pointer press it goes to the neighbouring row, so the hold sends on time. Nothing is sent until the time runs out; closing the app sends at once. The host keeps one always-mounted `role="status"` line that announces it |
   | Stops running work, or throws away typing | the inline confirm strip (`Confirm`): a question naming the consequence, the specific verb, the safe option focused, Esc keeps |
   | Permanent or structural (delete or move a project, apply a change to a live ad account) | a panel that spells out what goes with it; typing the name only for a permanent deletion. Reference build: `apps/projects/RemovePanel.tsx` |

5. **Red marks the point of no return.** A button that leads to an Undo or a confirm is neutral (a bin icon
   or a standard button), the to-do panel's Delete included. The button that commits something with no Undo
   is danger. A constructive step that can't be undone ("Apply now") stays primary behind its confirm.
6. **Button groups**: primary first on the left, then the alternatives, Cancel last. **Panel footers** (the
   to-do panel, any later panel) are the one named layout: item actions on the left (Start a chat, Mark as
   done, Delete), mode actions on the right (Edit while reading; Save and Cancel while editing). A
   form-only panel (the to-do Add form, Rate calls) has no item actions: it uses button-group order, primary
   first and Cancel last, and its footer is pinned to the foot of the panel.
7. **New and Add** are primary with `plus`, at the right end of the row they act on, never in a dock header:
   the Chats and To-dos drawers' 32px primary `+` icon button ("New chat", "Add a to-do"), "New project" on
   the Projects tools row, "Add a to-do" on a project's tabs row.
8. **Edit**: a pencil icon in a row; a labelled "Edit" with the pencil at the right end of the header row on a
   page (a project); in the to-do panel it lives in the footer (rule 6).
9. **Unsaved changes**: every form asks "Discard your changes?" on Cancel, Esc, Back and close once anything
   has changed, in one strip under the header band (Discard changes, danger; Keep editing, focused).
10. **Header band, right side**: item actions → star → bin → Help → previous / next → close, close always last.
11. **Stepping** between items is up and down `icon-btn`s in the header band ("Previous {thing} (P)", "Next
    {thing} (N)"). **Back** to a list is "All {things}", quiet small with a left chevron. One named
    exception: the Ads proposal stepper sits at the top right of the panel body, because the dock header has
    no slot for it. It uses the same icons and has no P and N keys.
12. **Busy** buttons are `aria-disabled`, never `disabled`, so focus never drops to the page. A control with
    nothing to act on yet may be `disabled` (Send while the box is empty); a busy control never is.

### Words

| Word | Use for | Not |
|---|---|---|
| Delete | the item leaves its list (with Undo, or to the Bin) | |
| Remove | taken out of a set; it still exists | Unlink |
| Archive / Unarchive | hidden, kept | |
| Close | put a surface away | Dismiss (for pickers) |
| End chat | stop a chat session | Close chat |
| Hide / Show | fold in place | |
| Dismiss | put a message away | |
| Cancel | leave without doing it | |
| Clear filters | a button, everywhere | Show all projects, a Clear link |
| Clear {project} | undo a picked project (the libraries, the To-dos drawer), next to Clear filters | |
| Hide chat | the X on the chat drawer (the chat keeps running) | |
| Mark as done | complete a to-do | Mark done |
| New … / Add … | new: a top-level thing; add: into a list or parent | |
| Save | always | Save changes |
| Favourite | the star, card titles ("Favourite to-dos"), hints ("Favourite a to-do to keep it here") | Pinned, Star a… |
| All {things} | back to a list | |
| Try again | always a standard button | a link |

No button ends in an ellipsis: the confirm that follows already says there's another step.

## Report tables and reordering (Ad Manager deep dive)

- **Task run line** (Ad Manager task cards and the Daily standup, `RunLine` in `Board.tsx`): 12px iron under the description, only once the task has run from Cortex: "Last run Today, 21:46" ("Yesterday, …", "3 Nov, …", with the year when not this year). While the run's chat is live: a `.dot` (`working` or `asking`) and 600 navy words "Running" or "Needs your answer", then "· started …", and Run becomes a plain "Open chat" for that chat. The status is spoken from a visually hidden `role="status"` that is always in the page and names the task ("Spend check: Running"). Times live in this browser's localStorage by account and task (`task-runs.ts`).
- **One saved layout for every account**: moving tables on an account merges into the saved order (`mergeOrder`), so tables that account lacks keep their places.
- **One table component** (`AmTable`, `client/src/tools/ad-manager/AmTable.tsx`) for every report table. Headers are sort buttons with `aria-sort`. Five rows show, then a quiet small "Show all N" button (`aria-expanded`) that becomes "Show fewer". Too wide for its card: it scrolls sideways (no column hides) and the first column sticks (`position: sticky; left: 0`, white). No sticky header.
- **Figures are formatted per column, not per value** (`words.ts`): money in the account's own currency (`Intl`, en-GB), 2 decimals when the column's largest figure is under 100, else 0; conversions 1 decimal; ROAS 2 decimals with "x"; Quality Score whole. True zeros ("0.0", "£0") are `--iron`; a ROAS of 0.00x keeps its colour because it is a result, except on a row that spent nothing (no return to judge), where it is quiet and never flagged low.
- **Bad values never rely on colour:** ROAS under 1.00x (only when the column has some return) and Quality Score 4 or below are `--danger` at weight 600 with visually hidden ", low". There are no green "good" marks. The Spend figure has a right-anchored `--wash` bar behind it, sized to its share of the column's largest value; it is `aria-hidden` and the number stays readable.
- **Card head:** grip, title (h3), a 12/400 iron meta line under it, the "Worth a look" badge (carries the waste share, "13% of search spend", on the wasted-spend table), and the full-width toggle. Two columns, one at a container width of 940px.
- **Reorder** (native HTML drag and drop, no dependency). The handle is a 28px `icon-btn` with the `grip` icon, left of the title; like the star it shows on the card under the pointer or the keyboard (always on touch). The card is `draggable` only while the handle is pressed, so table text stays selectable. The drop slot is a `--tint-1` placeholder the size of the card with a dashed `--line-strong` edge and radius 14, placed by the left or right half of the card under the pointer (top or bottom half for a full-width card). Esc cancels. Keyboard on the handle: arrows move one place, Home and End to the ends; the name is "Move {title}, {n} of {total}" with a hidden key hint, one `role="status"` says "Moved to {n} of {total}", and focus stays on the handle.
- **Full width:** a 28px `icon-btn` (`wide` icon, `aria-pressed`, "Full width: {title}") at the top right makes a card span both columns; hidden in one column. "Reset layout" (quiet, small) sits on the heading line only while the layout differs from the default.
- **Saved** in this browser's localStorage (`table-layout.ts`, one layout for every account); never written to the brain.

## Alignment

Every main sheet's header, toolbars, tab switches, action buttons and plain text line up to ONE left/right edge: the sheet gutter, `--sheet-gutter` (16px, `tokens.css`). Use the token wherever a sheet sets its edge (`.lib`, `.am`, the sheet bar, the Guide).

- **On the gutter:** the sheet title text, the outer edge of every top-level box (buttons, fields, segs, tabs, banners, trays), and plain text sitting straight on the sheet (no side inset of its own: `.lib-empty`, `.lib-note`, `.am-h`, `.cc-h`, a `.proj-note` straight in `.lib`).
- **Cards:** the outer edge sits on the gutter, inside a `.tray`; the content is inset by the card's own padding. A card group without a tray is wrong.
- **Vertical rhythm:** sheet bar to first row 12px; between control rows 8px; last control row to content 8px. Tabs inside `.lib` take no margin of their own (`.lib > .tool-tabs`); tabs above a sheet body leave 8px (`.tool-tabs + .sheet-scroll > .am`, Settings).
- **A primary action** sits at the right end of the row it acts on, never on a row of its own (New project ends the tools row; Link files ends the project tabs row).
- **Only conversation pages are centred** (Home, the chat thread). Pages with tools or tabs (Settings, Profile, the Guide) start at the gutter.

## Surfaces inside the sheet

- Recessed **tray** holding raised **cards**: the one card device, on Home and for any collection an app shows on the sheet (Ian, 2026-11-11: an app's content must use "the other card type devices", not a look of its own). A picture sits flat on the white card with a 1px hairline edge and no shadow.
- Settings (and Profile, which uses `.page.settings`) and the Details tab: plain content, hairline rows (`border-top: 1px solid var(--line)`). No cards. Settings is split across page tabs (above); each tab is one short page of these sections.
- **Answer box** (the approval or question waiting on you, `.pending`): ONE amber-glass surface. Radius 14, padding 12px 14px, 1px rgba(245,158,11,.5), fill rgba(255,248,232,.72), blur 20, `--lift-3`. Nothing inside it has its own border, box or shadow, buttons and fields excepted. Text stays navy. The focus ring belongs to the surface: `.pending:has(> :focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px }`, and the card inside has no outline of its own.

- **Update line** (`UpdateBanner`, top of the sheet, above the other notices): "TDS Brain x.y.z is
  available." with a quiet "What's new" (owners and scouts; a chevron shows it open), a primary small "Update and
  restart" and a quiet "Later". Open chats get the in-place `Confirm` before anything restarts. Only
  one version line shows at a time: once the page is out of date, the Reload line replaces it.

## Thread content

- Reply headings h1/h2 18, h3 15, h4 14 (`--head`, 600, margin 16px 0 6px). Lists: padding-left 20px.
- Tables 14px; `td` padding 8px 10px 8px 0 with a 1px `--line` rule; `th` 12/600 iron with a 1.5px navy rule.
- Inline code: tray fill. Code block: tray fill, radius 10, padding 10px 12px, 12.5px.
- Blockquote: 2px `--line-strong` left rule, 12px padding, 13px iron.
- "What Claude did": 13px iron, padding 3px 8px 3px 4px, a 14px chevron `Icon` (rotated −90° when shut). It holds the turn's steps and Claude's side notes (text a step follows in the same turn) in order, so a turn reads: your message, one fold, the answer. A side note in the fold, like a helper's text: 2px `--line-strong` left rule, 8px padding, iron. The fold sits on a `--tint-1` panel (radius 12, padding 3px), as wide as its line when shut and the column's width when open or while Claude works, so Claude's working reads apart from answers and your messages. A background helper's report is its own fold inside ("Helper's report: name"), opening on a #fff card (radius 10, padding 10px 12px, 13.5px navy; its headings 15/14px). The count is steps, then helper reports.
- Your message: 14/1.5, wash fill, radius 14 14 4 14, padding 8px 12px. Record lines: 13px iron with an 8px #B9C0CE dot.
- File links in a reply (a brain path the chat reported, plan 2026-11-13-chat-files): link colour with a
  small file icon before them; they open the file in the panel's Files tab, never a new tab. A step that
  touched a file has its label as the same link. Any other relative link is plain text.

## The chat's Files tab

"This chat" has two tabs: Files, Details (a Steps tab was removed in v0.21: the chat's "What Claude did" folds show every step, note and helper report). Files lists, in order, **Made or changed**, **Attached**,
**Mentioned in replies**, **Looked at** (a `Fold`, shut unless it is the only group) and **Web links**
(new tab, each with the `link` icon, two chain links; Ian, 2026-11-14). A row is a button: the format icon, the title, the client (or "My personal files") and the
strongest action word (Made, Changed, Filed, Mentioned, Read). Choosing one shows it in the panel with an
"All files" back button: text, Markdown and pictures show there; PDFs and web pages offer **Open in
Documents** (or Images), which closes a floating panel first; Word, Excel and PowerPoint say "This type
can't be shown here." with Download first. Escape goes back to the list. A file the chat edited has
"What changed", using the approval card's change view. Empty: "No files yet. Files Claude reads, makes or
names in this chat appear here."

## Context meter and summary divider

**ContextMeter** (`components/ContextMeter.tsx`) sits in its own `.context-foot` row under the message
box (not `.composer-foot`, which is the attach and send row), above the level or engine line, and shows in
manual mode too. A 4px bar (64px wide) with words: "Chat 42% full". Bands come from `meterBand` (shared):
neutral under 60%, amber (`--attn-asking-edge`) from 60%, red (`--danger`) from 85%, where the words become
"Chat 90% full: Claude will summarise the earlier messages soon". Colour never carries it alone.
`role="meter"` with `aria-valuenow/min/max`, the fixed name "How full this chat is" and the words as
`aria-valuetext`. Hidden until the first reading. The page's announcer (`App.tsx`) speaks "summarising" and
"nearly full", not the meter itself. The Inspector's Details tab has a **Context** `Fold` (shut) that opens
with the meter's own words, then used against the summarising point, then the model's full size.

**Summary divider** is a `.notice` with `data-kind="summary"` (quiet tint, dashed edge, centred), not a
new component. It marks where earlier messages were summarised. While summarising, a status line
(`.engine-line`) says so above the status bar.

## Height (shadows)

One light, one formula, even steps (Ian, 2026-11-11: "the drop shadows should be consistent across all
layers to represent consistent height spacing"). Each step up is 6px higher: its shadow drops 6px
further, spreads 16px wider and is 0.04 darker. Every shadow in the app is one of these tokens; no
stylesheet writes its own.

| Token | Height | Shadow | What sits there |
|---|---|---|---|
| `--recess` | one step down | `inset 0 1px 2px rgba(2,27,67,.06)` | the tray |
| `--lift-0` | touching | `0 1px 2px rgba(2,27,67,.1)` | a switch's knob, the chosen segment, a standard button at rest |
| `--lift-1` | 1 step | `0 1px 2px rgba(2,27,67,.06), 0 6px 16px rgba(2,27,67,.06)` | the sheet, rail and drawers on the desk; a card in the tray; anything hovered or current that rises off its surface (row, tile, rail item, palette option); the composer |
| `--lift-2` | 2 steps | `0 1px 2px rgba(2,27,67,.06), 0 12px 32px rgba(2,27,67,.1)` | what floats over the sheet: menus, tooltips, the selection bar, a floating composer, the sign-in card |
| `--lift-3` | 3 steps | `0 1px 2px rgba(2,27,67,.06), 0 18px 48px rgba(2,27,67,.14)` | what sits over everything: the palette, the answer box, a floating drawer or panel |

A shadow is measured from the surface the thing sits on, so a row lifting off a card casts the same
`--lift-1` as the card casts on the tray. No hover or current state draws a border or ring to show
height (Ian, 2026-11-11: "you're placing a border around the hover, which should be more subtle").
Rings are for keyboard focus, the palette's active option and the search select's active row only.

No layer draws a line under its header (Ian, 2026-11-11: the hairline under the sheet bar was "not in
line with the design system"). Content that scrolls under a fixed header fades out over the scroller's
top 8px (`mask-image`), and the scroller takes `scroll-padding-top: 8px`. Hairlines are for rows of plain
content (Settings, tables), between drawer sections, and picture edges only. Scrollbars show a thumb and no track.

## Interaction states

Transition `background-color, box-shadow, transform 120ms var(--ease)`. Under reduced motion: no
transform; the surface and shadow change stay. Hover is the element rising one step towards you
(`--lift-1`); pressed is it pushed back to the surface (no shadow). Selected or current is always
distinct from hover by its fill or weight, not by a deeper shadow.

| Element | Hover | Pressed | Current or selected |
|---|---|---|---|
| Rail item | rgba(255,255,255,.8) + `--lift-1` | no shadow | #fff + `--lift-1` + 600 (an open drawer's item gets the hover surface plus its 3px bar) |
| Drawer row, answer-box option (these lift) | rgba(255,255,255,.92) + `--lift-1` + `translateY(-1px)` | no transform | #fff + `--lift-1`; a current row's title goes to 600. No coloured edge (Ian, 2026-11-11: "the blue edge" is an old style) |
| Row or tile inside a card: Home rows, an app's items | stays #fff + `--lift-1` + up 1px, above its neighbours; no edge | `--tray` fill, no shadow | wash fill + `--lift-1` + title 600 (hover `--wash-strong`) |
| `.btn` primary, `.icon-btn` primary | `--navy-hover` + `--lift-1` + up 1px | navy, no shadow | toggled or open: wash + blue-ink (hover `--wash-strong`, pressed wash) |
| `.btn` standard | #fff + `--lift-1` + up 1px (reduced motion: `--glass-solid` fill instead of the move) | `--tray`, no shadow | n/a |
| `.btn` danger | `--danger-wash` + `--lift-1` + up 1px | `--danger-wash-strong`, no shadow | n/a |
| `.btn` quiet | `--tint-2` | `--tint-3` | never the wash; open is shown by a chevron (`data-chevron`) |
| `.icon-btn`, fold header, chip remove, "What Claude did" (over its `--tint-1` panel) | `--tint-2` | `--tint-3` | `.icon-btn` toggled or open (`aria-pressed`, `data-on`, `aria-expanded`): wash + blue-ink, unless it carries `data-chevron` |
| "Search or jump to" | `--tint-2` | `--tint-3` | n/a |
| Seg option | rgba(255,255,255,.55) | n/a | #fff + seg shadow + 600 |
| Palette option | rgba(255,255,255,.85) + `--lift-1` | n/a | #fff + `--lift-1` + 1.5px blue-ink inset ring |
| Links | 2px underline, offset 2 | n/a | n/a |

Disabled everywhere (`:disabled` or `aria-disabled="true"`): opacity .5, a not-allowed cursor, no hover
or press.

Focus everywhere: 2px blue-ink outline, offset 2 (offset −2 inside clipping scrollers: drawer rows,
palette, seg).

## Help drawer and HelpLink

- **Help drawer** (`client/src/shell/HelpDrawer.tsx`, plan 2026-11-15-cortex-help-phase-1): a left drawer built from the Skills drawer's pieces and nothing new. A `.drawer-tools` search field ("Search help") sits on top; while it has text, `.line` rows (title, summary as `.line-meta`) replace everything below, or "No help pages match that search." Otherwise: the page for where you are (a 14/600 `--head` heading, then the article), a quiet small **Back** button with the chevron (as ChatFiles' "All files") above the heading once you have followed a link (the drawer keeps a small history), then one shut `Fold` per area directly in the drawer body (drawer fold style, hairline above the first as for the rest) with `.line` rows. A page written for some roles carries a `.badge`: "For owners", "For scouts" or "For owners and scouts". The page title is the h3, so article `##` is h4 and `###` is h5. A visually-hidden `role="status"` line announces the search count. Moving to another page scrolls to the top and focuses the page heading (`tabIndex` -1).
- **Article type** (`styles/help.css`, `.help-article`): 13/1.5, headings 14 (h1 to h4) and 13 (h5) in `--head` 600, lists indented 20px, links blue-ink, pictures at most the column's width with a 1px `--line` edge and radius 10 and no shadow.
- **Rail and keys**: a "Help" rail item (icon `help`: a circle with a question mark) directly above Settings, toggling the drawer like the others. `H` toggles it and `?` opens it, under the single-key rules; "Go to" lists Help with the hint H. Closing Help (its close button, `H`, Esc) reopens the drawer it replaced; opening another drawer forgets that. Help is shown where `helpVisible(role)` says so: everyone, since 2026-11-15.
- **HelpLink** (`client/src/shell/HelpLink.tsx`): a bare 32px `.icon-btn` (`--ink-soft`) like the other header controls, with the `help` icon, `aria-label` "Help: {page title}" and `data-tip` "Help" (the short tooltip), opening Help on that page. It goes in a drawer's header actions, before the drawer's own button, and is not shown to anyone who cannot see Help.
- **HelpLink sizes**: 32px (default) in a header or beside a section `h2`; `size={28}` in a row beside a setting's label (the in-row icon-button size). The link sits in a `.help-inline` flex wrapper (gap 2) with the heading or label; on a Settings `h2` the wrapper keeps the heading's 4px bottom margin. Shown to everyone (`helpVisible`).
- **Cortex Guide** (`client/src/shell/GuideView.tsx`, `styles/guide.css`, view `guide`; anyone `helpVisible` turns away lands on Home): the whole help as a book on the sheet, titled "Cortex Guide", with a "Print the guide" `btn` in the sheet bar. Left, a 240px sticky contents: area names as 12/600 iron headings, then page titles as `.line` rows, the current one `aria-current="true"` like a current chat. Right, the page (max 640px): an 18px `--head` `h2` (takes focus when the page changes), the `.badge` for role pages, the article at 14px, then "Related" quiet `btn`s. When the sheet is under 900px (a container query on `.sheet`) the contents give way to a "Page" `select.field` above the page, grouped by area. A hidden `.guide-print` copy holds every page in order with eager pictures; `@media print` hides the rail, docks, sheet bar and contents, resets height and overflow on `.desk`, `.sheet` and `.sheet-scroll` (only while the Guide shows), starts each page on a new sheet and shows links as plain text. Opened from the Help drawer's quiet "Open the Cortex Guide" button, "Go to" and Settings' About.

## Row meta lines

Home and the palette: one sentence-like line, parts joined by ", " in the text itself (`overdue by 2 days, Acme Heating Ltd, renewals`), with the first letter capitalised by `.line-meta::first-letter { text-transform: uppercase }`. `.line-meta` is `display: block` everywhere: no flex, no gap, no stray spaces.

The To-dos drawer's rows (and the Asked tab's) are different: the details line is due, from (handover), Personal (with its lock), then the chat ("Open chat, needs your answer", with a `.dot[data-attention]` before it). Each part is capitalised (`cap()` in `words.ts`), `white-space: nowrap`, and parts are separated by " · " in a `.todo-sep` span. Overdue stays `.late` text. The place goes on the bottom line (`.todo-end`), left of the buttons, never in the details line; the chat button's `aria-describedby` names the details and the place.

Clients are always shown by name, never by folder slug. The same goes for a to-do's project: a project that is a client's folder shows that client's name, and any other folder name is shown as words (`placeName`, `todoPlaces` in `client/src/shell/words.ts`). Short forms keep their capitals wherever a name becomes words (TDS, AI, SEO, PDF: the list is in `shared/words.ts`).

## Apps on the sheet

An app is one entry in `client/src/shell/apps.ts` (`AppSlot`): a rail item, a sheet, and optionally
its own sheet-bar buttons and right-panel body. It builds from the shared pieces and adds no look of
its own: `.field` for pickers and search, `Seg` for any one-of-many choice (including filters,
labelled "Name, count"), the `.tray` with one `.card` per group (`.card-head`: title, `.count`, a
quiet button on the right), `.line` rows or tiles inside the card, `.tick` in `label.tick-hit` for
picking several (only where that is worth it: Images has ticks, Documents doesn't), `.kv` rows and `.chip` tags in the panel, `.btn` for actions, `.glass` for a floating
action bar. Sheet padding 12px `--sheet-gutter` 16px, gap 8px (see Alignment).

Every app declares `search` (global search); a new list or inventory is searchable from Search or jump to. An app's `AppSlot.search` is a `SearchSource` kept outside its lazy UI chunk (`search.ts` in the app's folder), with a hit that opens the item (`SearchActions`); `client/src/shell/apps.test.ts` fails for a `search: null` that has no reason listed. The palette's groups: Go to (derived from the apps), To-dos, Open chats, Skills, Clients, Earlier chats, then the apps' own, async ones last. Six per group, with "6 of N" beside the heading when there are more; "Still looking…" beside it while the server builds more; a hit's second line is the client, the scope name or "My personal files".

Those pieces are already assembled in `client/src/apps/shared`: `LibraryTools` (the "Library" picker
with Mine and Clients groups (a Shared group exists for agency folders but is unused today), search, the app's own controls, together on the right), `FolderCard` (first 60 items,
then a quiet small `btn` "Show all N"), `SelectionBar`, `ViewButton` (the inline Open), `DetailActions`,
`LibraryNotice` (loading, failed with "Try again", empty), `Thumb`, `Viewer`, the data hooks and a
store factory for state the sheet and the panel share, plus `library.css`. A new app writes its row
or tile, its panel body and a short stylesheet for what is particular to its items. Both examples
list the real files the server finds; nothing is sample data.

| App | What is its own |
|---|---|
| `client/src/apps/images` | Grid or list. Tiles: padding 8px, radius 10, 2px apart, picture box 3:2 with a hairline edge, the picture contained at its own proportions. No picture (or one that fails to load): the standard tile, the `image` line icon centred in the same box. Meta: the dimensions, else the size. |
| `client/src/apps/documents` | Rows that read like a table: a 32px flat white box with a line icon for the file's kind, title and meta ("PDF, 840 KB"), then the date changed (80px, right-aligned, 12px; gone under 480px of sheet, it is in the panel). Grid or list (list by default). Tiles as in Images, but the picture box is 3:4. No ticks: one document at a time, through its row or the panel (Ian, 2026-11-13: the panel already does what the selection bar did). On a Mac, Quick Look draws the first page of PDFs, Word, Excel and PowerPoint; other files (web pages too: Quick Look would load local files into them), and every file elsewhere, show their format icon in the same box. In the panel: the preview (square when there is a picture, 3:2 with the icon when not), then the title and file name. |

In both panels the `.kv` row for a card is labelled "Group" (it is a card name, not always a folder).

The panel's actions (`DetailActions`) sit on two rows on purpose, each a `.lib-actions-row`: the
actions on the file (Open, primary, when the app can open it; then "Ask Claude about it", primary when
there is no Open), then the file utilities (Download, Copy file path) as standard `.btn`s. Download is
an `<a class="btn" download>` to `ROUTES.libraryFile`, named "Download <file name>" for screen readers;
the server sends the file as an attachment, so it is saved and the app stays where it is.

The client chosen in an app is shared between the apps. Home no longer shares it (and no longer
pre-fills the last client a chat used): its Client picker sits in the composer's foot (`tools` slot),
a search select (180px) with a visible small "Client" label: "Auto" (default), "No client", then the
clients. With auto, Send works the client out from the first message (`POST /api/client-guess`); a short
"Working out the client…" note (`aria-live="polite"`) shows after 400 ms, and when the app can't tell,
a `.pending` card above the composer asks "Which client is this for?" (`ClientAsk`: a `.btn` per likely
client, "No client", an "Another client…" search select, "Cancel"; Escape cancels and the text
stays in the box). A chat opened from search (a client) or a to-do (its client) starts with that client
chosen. Choosing the client an app already shows keeps what is ticked (Images), open and in the panel.

Every row and tile for a file the app can show has its own **Open** (`ViewButton`, Ian, 2026-11-13:
saves choosing the item and then pressing Open in the panel): a standard small `.btn`, named "Open
<title>" for screen readers, at the end of a row (after the date) or on the top right corner of a
tile's picture (a tile's tick is top left). It shows on hover, on keyboard focus, on the chosen item
and always where nothing hovers (`hover: none`), fading in (opacity only, so nothing moves). A row for a
file the app can't show keeps the same 56px empty, so the columns line up. It opens the viewer
straight away and makes the item the chosen one.

**Delete file** (the library bin; plan decision 7): a 28px `icon-btn` with the `bin` icon, only on files
the server says can be deleted (`canDelete`). On a row it follows Open at the end; on a tile it sits on
the bottom right corner of the picture (`.lib-tile-pic`, a positioned box around the `Thumb`), never on the
name. It shows on hover or keyboard focus, on the chosen item, and always where nothing hovers (`hover:
none`), fading in by opacity only. In a list where any file has a bin, a row without one keeps a 28px
empty slot (`.lib-delete-gap`), as Open does. It is labelled "Delete file: <name>", the name the list
shows (an image's file name, a document's title), with the tooltip "Delete file". While a delete is being
sent it is `aria-disabled`, never `disabled`, and does nothing, so focus stays. Pressing it takes the file
out of every list at once and shows a held line at the top of the page (`FileDeleteNotice`, an
`UndoLine` strip "<name> deleted." with Undo) for 10 seconds; the clock stops while the pointer or focus
is on that line. One visually hidden `role="status"` line stays on the page and says "<name> deleted.
Undo is at the top of the page.", then the result ("<name> deleted. To get it back within 30 days, ask
Claude."), so a screen reader announces both. The file viewer drawer has the same bin among its actions.

Opening a file ("Open" on the item or in the panel, or a file chosen in Search or jump to) swaps the sheet's list for the viewer and adds a quiet small
"Back to ..." button to the sheet bar. When the panel floats, Open also closes it, and the viewer takes
focus once the sheet is live again. The list stays mounted, hidden, so Back (or Escape inside the
viewer) restores its scroll and puts focus on the item. The viewer sits on a `.tray` like the lists,
with one white `.card`: a picture opens large and contained, flat with a hairline edge (8px padding,
no shadow); text and Markdown in a card up to 760px wide; an HTML page fills a card in an iframe with
an empty `sandbox`; a PDF opens in the browser's own reader, edge to edge in its card (no padding), at
`#navpanes=0&view=FitH`, unsandboxed because browsers refuse PDFs in a sandboxed frame; if a link to another site is blocked the frame reloads and a quiet line says "Links to other sites are switched off here." Items are clickable across their whole box, not only the inner button.

**File viewer** (`client/src/shell/FileViewer.tsx`, `styles/viewer.css`; Ian, 2026-11-14: a file opened
from a chat should open "over the current chat … and when closed, go back to the source of the open").
For showing one file large without leaving where the person is. Any part of the app opens it with
`dispatch({ type: 'open-viewer', viewer: { item, place?, openIn? } })`; the chat's Files panel uses it
for its **Open** button (named "Open <title>"). It is a glass drawer from the right over a veil, up to
1040px wide by default, leaving the rail and an edge of the page in view (full width under 640px). It
can be made wider (Ian, 2026-11-15: a landscape A4 deck ran off the right): a 24px grab strip centred on its
left edge (`ResizeHandle`, a focusable `separator` "Resize viewer"; arrows 32px, Shift 128px, Home/End;
double-click resets; `aria-valuetext` in pixels and a hidden key hint) from 1040px up to the window less 94px, shown only with at least 64px to grow; a click with no drag saves nothing; the width remembered in the shell state
(`viewerWidth`). Its grip is one 4×48px bar, radius 2, in the gap beside the drawer: `--grey-dot` at
rest, `--ink-soft` on hover or focus, `--navy` while dragging, changing by fill only (Ian, 2026-11-15:
a dotted pill with an edge "doesn't fit with the clean design system"). No line runs down the edge. The header has
the title (14 / 600, focused when it opens) with the place under it (12px, iron), then the actions as
standard 32px buttons: "Open in Documents" or "Open in Images" when `openIn` is given (closes the viewer
and opens the file in the app), and Download; the close icon button ("Close file") sits top right, and
under 640px the actions take a second line below it. The body is the same stage as the sheet's viewer
(`FileStage`), in a scrolling region named "Contents of <title>" that the keyboard can reach. While it
shows, the desk and skip link are `inert` and no shortcut but Esc reaches the desk; Esc, the veil and
close shut it, and focus goes back to the control that opened it (or the sheet, if that has gone or
can't take focus). Esc does nothing while focus is inside a PDF or page frame (the browser keeps the
key there); close still works.

Both are on the rail in every build.

## Chat drawer (tool chats)

A tool that starts or reopens a chat shows it in the chat drawer, not on the chat screen, so the tool stays in view.
Plan: `docs/plans/2026-11-16-run-chat-drawer.md`.

- Call `startChat(prompt, client, { open: true, in: 'drawer' })` or `openChat(id, { in: 'drawer' })`.
  Without `in`, a chat opens on the chat screen as before.
- The drawer (`client/src/shell/ChatDrawer.tsx`) is a glass layer inside the sheet, on the right. It is non-modal:
  there's no veil, and the tool behind it stays usable. It has its own saved width (`chatDrawerWidth`; default
  520px, narrowest 380px) and a `ResizeHandle` labelled "Resize chat".
- It holds `ChatView placement="drawer"`, which has an `h2` header (title, client chip), **Open full screen**
  (`wide` icon) and **Hide chat** (`close` icon). The page keeps its one `h1` and search. Ending a chat happens on
  the chat screen only.
- The drawer chat is the active chat, so it is fully live. The store clears the drawer when the active chat
  changes or the sheet leaves a tool. Esc hides it, after the palette, viewer, to-do panel and a floating panel,
  but never while its message box holds text.
- A floating right panel closes before a tool opens its chat in the drawer; a pushing one stays beside it.

## Category colours

Six soft fills for "kind of thing" (a task type, a tag), so a colour never has to mean "state". Plan:
`docs/plans/2026-11-19-ads-workbench-sections.md`, decision 7.

| Token | Value | Used for |
|---|---|---|
| `--cat-aqua` | `#bef9f1` | Ads task type Report (`--type-report`) |
| `--cat-yellow` | `#fef08a` | Insight, which highlights a finding (`--type-insight`) |
| `--cat-rose` | `#fecbd8` | Action, which changes the account, so it reads as caution (`--type-action`) |
| `--cat-iris` | `#d2d3ff` | Daily standup (`--type-standup`) |
| `--cat-sky` | `#bceefe` | Free for other tools |
| `--cat-mauve` | `#e3d2e8` | Free for other tools |

- A category is a whole fill with navy text and its word on it. Dots and coloured edges stay for status.
- One exception: a whole panel may be tinted by status (the account data panel's green, amber or red). Never a single card or chip.
- The key shows the same fill as the thing it explains.
- On a fill use the standard white `.btn`, not the quiet one.
- Named by hue, used by meaning: tools alias the shared names (`--type-report: var(--cat-aqua)`), so a dark set can
  later redefine the same names.
- Navy, `#525252` and `#33456a` text pass WCAG AA on every fill (checked 2026-11-18 and 19). Only about six soft
  colours stay clearly apart for people with colour blindness once the status colours are left out, so there are
  six, not eight.

## Tokens saved (Settings)

A plain Settings section, on the Claude tab: an `h2`, `h3` labels, a `dl.kv` for the figures and `setting-help` text. Saved tokens and tokens reused from the cache are always separate lines. No team figure is shown. Token counts use `tokenWords` (k, M, B).
