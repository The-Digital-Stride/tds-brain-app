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

## Type (seven sizes: 11.5, 12, 13, 14, 15, 18, 26)

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

## Spacing, radii, widths

- Spacing steps: 4, 6, 8, 12, 16, 24, 32. Old tokens map `--s1`→8, `--s2`→12, `--s3`→16, `--s4`→24, `--s5`→32.
- Radii: 6, 9, 10, 14, 18.
- Column widths: reading 680px, settings 600px, Home 880px.

## Dimensions

- Rail item 36px high. Drawer and card rows: padding 7px 8px. Fold header 30px (32px in a drawer). Dock header min-height 47px (48 with the glass edge), padding 0 10px 1px 14px.
- Sheet bar 48px, padding 0 10px 0 18px, no border.
- Header band: the rail's logo, every dock header and the sheet bar fill the top 48px of their layer, with their contents centred on one line (y 36 from the desk's top edge); 32px controls sit 8px from top and bottom.
- A drawer's search or filter (the Skills search, the To-dos switch and client picker) sits on the drawer's own glass between the header and the list (`.drawer-tools`, padding 0 10px 8px); only the list scrolls (`.drawer-scroll`). Nothing in a drawer has a backing of its own (Ian, 2026-11-11: a whiter strip behind the search was "not good").
- The To-dos drawer has no search row: "/" and Search or jump to search everything, and choosing a to-do there opens this drawer on it (its tab, filters cleared, its group open, its row focused). The add button shows whenever the person can add. With a filter (the kind switch, the client picker) it is a 32px `+` primary icon button (`icon-btn` `data-variant="primary"`, "Add a to-do") at the right end of the filter row (`.todo-filters`): with both filters the switch has the first line and the picker and `+` share the second, never wrapping. With no filter, the row holds only a labelled primary small `btn` with a `+` and "Add a to-do", right-aligned so it lines up with that `+` (the tabs row has no room for an icon at 316px: "Open to anyone, N" truncates).
- The Chats drawer's kind switch (All / TDS / Personal, "Which kind of chat") sits straight in the drawer body under the Open / Earlier switch, with no `.drawer-tools` wrapper, because that body is already padded and the two switches must be the same width. It shows only once a chat is Personal (or while a kind is picked). A personal chat's meta ends ", personal" with no lock, because a personal chat is only sorted apart and isn't private (personal to-dos keep the lock). This chat → Details has a "Kind" row, a TDS / Personal `Seg` with a `kv-note` that says what it does.
- Earlier chat rows have a trailing 28px `icon-btn` with the `bin` icon ("Delete chat: {title}"), the same place and size as an Open row's Close. Pressing it swaps the row for an inline `fieldset.close-confirm`: the title stays, the question is linked with `aria-describedby`, there's a small danger "Delete chat" and "Keep chat" (focused), and Esc keeps the chat. While a delete runs the two buttons are `aria-disabled`, never `disabled`, because a disabled button drops focus to the page. The other bins are disabled.
- To-do rows are not buttons (Ian, 2026-11-14: clicking anywhere on one started a chat, which surprised): the title and details are plain text, and the title runs the row's full width, with the details and then the row's buttons on the line below it (Ian, 2026-11-14: buttons beside the title made titles wrap early). The buttons run star, Edit (when changes are on), then a blue chat button `icon-btn.todo-go` with the `chat` icon (the speech bubble Chats has on the rail; Ian, 2026-11-14: an arrow didn't say chat), always shown and always last, labelled "Start a chat on this: {title}" or "Open chat: {title}". The row takes a light hover background but doesn't lift. Chat and skill rows stay whole-row buttons, because opening the thing a row names is what a click is expected to do; a to-do row's click made something new.
- Favourites (plan 2026-11-14-chat-favourites): one word and one icon wherever something can be kept at the top of its list. Skills have it too (Ian, 2026-11-14), replacing the pin: a "Favourites" section above "Used often" in the Skills drawer, and Home's card says "Favourite skills". Home's other cards are "Pinned to-dos", "Pinned chats" and "Pinned files" (plan 2026-11-15-home-pinned-cards): the starred ones only, five rows each, then a quiet "and N more" button that opens the full list. Files have the same star (`FileStar`), last in the file viewer's actions and in the first row of `DetailActions`, saved by library id in prefs' `favouriteFiles`. Their list is still saved as the prefs' `pins`, so older versions of the app agree. A chat row with a lasting id has a 28px `icon-btn.star-btn` with the `star` icon, left of Close or the bin, `aria-pressed`, labelled "Favourite: {title}" (the label never changes; the pressed state says whether it is on). The star is outlined when off and filled when on; like every unstarred star, an unstarred chat's star shows only on the row under the pointer or the keyboard (always on touch). Open lists favourites first; Earlier has a "Favourites" section at the top. After a press, focus follows the chat to its new place, and the Earlier section it moves to opens. To-dos (plan 2026-11-14-todo-favourites) work the same way: every to-do row (not one waiting out its Undo, not one being edited) has the star, before Edit and the chat button, shown whether or not changes are on, since it changes no to-do; starred to-dos sit only in a "Favourites" section above "New to you" and the date sections, on each tab, keeping a new one's dot. Favourites and the section under it ("New to you", else the top date section) start open, and a star press opens the section the to-do moves to. The shared pieces are `StarButton` and `useStarFocus` in `client/src/shell/StarButton.tsx`.
- A skill row shows its title and one clipped line of description. A chevron (28px, right when closed, down when open) opens the full text; clicking the title still starts the skill. The star shows on the row under the pointer or the keyboard; a favourite keeps its star. The star sits left of the chevron, so the chevron is always at the row's right edge.
- Tray: gap and padding 6px. Card: padding 12px 6px 6px (its heading row is inset 8px so text lines up with the rows).
- Home: top padding 32px; greeting margin 0 0 4px; summary line 14px, margin 0 0 18px.
- Composer padding 10px 10px 8px 14px; input 14px. Floater padding 8px 28px 14px.
- Thread: column gap 12px; paragraph margin 0 0 12px.
- Drawer sections: header 32px; a `--line` hairline and 12px of space above every section but the first; rows 6px apart; only the top section starts open, except that a Favourites section and the section under it both start open, so starring never hides today's items. A section can carry one action (`Fold`'s `action` slot): a quiet small `.btn` on the right of the heading line, outside the toggle button (nested buttons are invalid). The unread dot hangs in the row's left padding so titles share one left edge.

## Controls

- **Buttons: one language** (Ian, 2026-11-13: "every button should be a button, not text. Unless within inline text"). Six kinds, each with one meaning:
  - **Primary** `.btn[data-variant="primary"]`: navy, paper text. The action the area exists for; one per area (an edit form's Save, a confirm step's "Mark as done", New chat, Send, Update and restart).
  - **Standard** `.btn` (no variant): white, 1px `--line-strong` edge, `--lift-0`, navy text. Every other option: Cancel, Keep open, Not now, Don't allow, Copy path, Try again.
  - **Quiet** `[data-variant="quiet"]`: `--tint-1` fill, navy text, no edge. Minor and "see all" actions: Later, Reload, Dismiss, Back, Clear date, All chats, Mark all as seen, Show older versions, More options.
  - **Danger** `[data-variant="danger"]`: standard with `--danger` text. Removes something or ends work that can't be got back: Delete, the "Close chat" confirm.
  - **Send and Stop** (Ian, 2026-11-14): Send is primary (navy, for consistency: Ian tried green and kept navy) with the `send` paper-plane icon. While Claude works on a reply it becomes Stop, `.btn[data-variant="stop"]`, filled `--danger` red with the `stop` square, used nowhere else, in the same place (the same button, so focus stays on it). The second click of a double-click is ignored (`detail >= 2`), so a double-click on Send can't stop the reply it just sent; a keyboard press always works. Pressing it says "Stopping" to screen readers, and when the reply ends focus on it moves to the message box (the Send it turns back into is disabled). White on the red is 7.3:1. Stop lives only here, not in the chat's top bar.
  - **Icon** `.icon-btn`: 32px, radius 9 (28px inside rows), always with an `aria-label`. Bare, `--ink-soft`, for utilities (close, toggle, star, attach, edit, more): the icon is the shape. `data-variant="primary"` (navy fill, paper icon) only for the one icon button that creates the main thing in its area, such as the To-dos `+`.
  - **Tooltips (the standard, Ian, 2026-11-14): every button that shows only an icon has one.** The shared layer (`client/src/shell/Tooltips.tsx`, mounted once in `App.tsx`) shows a navy name, 12px, under the button (to the right of the rail's icons), drawn into the body so no drawer clips it, kept 8px inside the window and flipped above when there is no room below. It shows the button's `aria-label` for any `.icon-btn` or `.chip-remove`, or `data-tip` on anything. A tall edge handle sets `data-tip-side="left"` to have it beside the handle, centred on it (the viewer's resize grip; Ian, 2026-11-15: under a full-height strip it showed at the top of the window). When the label carries a title ("Favourite: {title}", "Close chat: {title}"), set `data-tip` to the short name ("Favourite", "Close chat"); otherwise the label is the tooltip. It appears after 350ms of pointing (at once while another is showing), at once for a button reached from the keyboard, never for touch or a click's focus. It stays while pointed at, for 150ms after the pointer leaves, and Escape puts it away (WCAG 1.4.13). Pressing the button, scrolling the page or the list it is in (not another scroller, such as a chat streaming a reply) or resizing puts it away too; a button that changes its name or moves takes the tooltip with it. A button whose words show (`.btn-label`) gets none; give it `data-tip` too if a narrow layout hides those words, and the tooltip shows only then. It is `aria-hidden`: the button's own name already says it. Never use the native `title` on an icon button: it draws a second, browser tooltip. `client/src/shell/icon-buttons.test.ts` fails on an icon-only button that would have no tooltip, or that has a `title`.
  - **Link** `.link-btn` or `a`: blue-ink, underlined. Only inside a sentence ("…in Settings.").
  - Sizes: 32px by default (header bands, forms, cards, sheets); `data-size="small"` 28px for a button on a line with text (card head, Fold action, notice strips, inline confirms, the selection bar, inside rows). No other heights.
  - Colour meanings: navy "do it", white "another option", grey "minor", red "careful" (and, filled, the message box's Stop), light blue (wash + blue-ink) only "switched on" or "open", underlined blue only a link in a sentence.
  - Not boxed, because something else shows they're clickable: list rows (they lift; a to-do row is the exception, below), fold heads (chevron), Seg options (the track), `.chip-remove` (inside its chip) (Ian, 2026-11-13: keep headings as text with an arrow). Nothing else that you click is bare text.
- **Show/hide toggles are icons, top right, always** (Ian, 2026-11-13: "put the icon in the top right ALWAYS everywhere it appears - it's a rule"). The rail's names toggle (`rail` icon) and the right panel's toggle (`panel` icon) are icon buttons with no visible words; the name lives in `aria-label` and a hover tip. The rail's sits at the top right of its header band, 10px from the edge like a dock's close button; with the rail at icons only it takes the mark's place (on hover or keyboard focus where the pointer hovers, always on touch). The panel's is the last thing in the sheet bar, after "Search or jump to": pass `panel` to `SheetBar` and never place `PanelToggle` yourself.
- **Field and select** `.field`: 32px, padding 0 10px, 1px `--field-edge`, radius 9, 13px, white fill. A native `select.field` (a short fixed list: Settings Model, Effort, team levels, the to-do people picker) has `appearance: none`, our `chevron` (16px, `--ink-soft`) at `right 10px center` and `padding-right: 34px`.
- **Search select** `SearchSelect` (`client/src/shell/SearchSelect.tsx`, logic in `search-select.ts`): use it for any list that can grow, such as clients (Home's Client, "Another client…", the To-dos client filter, the Library scope); a short fixed list stays a native select with the chevron. It is a `.field` (text padded 34px on the right, the decorative `chevron` 10px from the edge) that selects its text on focus, whenever the list opens and after a pick, and filters as you type, by label and hidden terms (client codes). The list is a popover drawn into the body (`position: fixed`, z-index 45, opens upward when there is less than 260px below and more room above): white, 1px `--line`, radius 12, `--lift-2`; rows 32px, 13px, hover `--tint-1`; the active row (the keyboard's place) `--tint-1` plus the palette's 1.5px `--blue-ink` inset ring; the chosen value shows only a navy `check` at the right; group headings as the palette's `.grp`; matching letters bold (`<mark>`, 600, no fill); a "Recent" group (this browser's last 5 picks, shown with 10 or more options and no query) and "Nothing matches" in iron. ARIA 1.2 combobox as the palette. Enter never submits a form or sends a message; Escape closes and stops the event only when open.
- **Tick** `.tick` (on `input[type=checkbox]` or `input[type=radio]`): 18px, `appearance: none`, 1.5px solid `--tick-edge` (#7C8AA5), fill rgba(255,255,255,.7), radius 5 (radio 50%). Checked checkbox: navy fill, white check. Checked radio: navy border, centred 8px navy dot. Hit area: wrap in `label.tick-hit` (24px box) when the input stands alone.
- **Switch** `.switch` (on `input[type=checkbox][role=switch]`), for on/off settings that apply at once: track 30×18, radius 999, off `--grey-dot`, on navy; knob 14px white with `0 1px 2px rgba(2,27,67,.2)`, moves 12px. Row: grid `1fr auto`, gap 16; title 14/500; help 12 iron, margin-top 2.
- **Seg**: options 28px, 3px padding, 3px gap between options (so a hovered or focused one never touches its neighbour), radius 10 / 8, 13px.
- **Chip** `.chip`: 12/500, padding 2px 9px, tray fill. **Count** `.count`: 12/600, line-height 18.

## Surfaces inside the sheet

- Recessed **tray** holding raised **cards**: the one card device, on Home and for any collection an app shows on the sheet (Ian, 2026-11-11: an app's content must use "the other card type devices", not a look of its own). A picture sits flat on the white card with a 1px hairline edge and no shadow.
- Settings and the Details tab: plain content, hairline rows (`border-top: 1px solid var(--line)`). No cards.
- **Answer box** (the approval or question waiting on you, `.pending`): ONE amber-glass surface. Radius 14, padding 12px 14px, 1px rgba(245,158,11,.5), fill rgba(255,248,232,.72), blur 20, `--lift-3`. Nothing inside it has its own border, box or shadow, buttons and fields excepted. Text stays navy. The focus ring belongs to the surface: `.pending:has(> :focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px }`, and the card inside has no outline of its own.

- **Update line** (`UpdateBanner`, top of the sheet, above the other notices): "TDS Brain x.y.z is
  available." with a quiet "What's new" (owners and scouts; a chevron shows it open), a primary small "Update and
  restart" and a quiet "Later". Open chats get the in-place `fieldset.close-confirm` before anything restarts. Only
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
- **Rail and keys**: a "Help" rail item (icon `help`: a circle with a question mark) directly above Settings, toggling the drawer like the others. `H` toggles it and `?` opens it, under the single-key rules; "Go to" lists Help with the hint H. Closing Help (its close button, `H`, Esc) reopens the drawer it replaced; opening another drawer forgets that. Help is shown only where `helpVisible(role)` says so (owners only for now).
- **HelpLink** (`client/src/shell/HelpLink.tsx`): a bare 32px `.icon-btn` (`--ink-soft`) like the other header controls, with the `help` icon, `aria-label` "Help: {page title}" and `data-tip` "Help" (the short tooltip), opening Help on that page. It goes in a drawer's header actions, before the drawer's own button, and is not shown to anyone who cannot see Help.

## Row meta lines

One sentence-like line, the same on Home, in drawers and in the palette: parts joined by ", " in the
text itself (`overdue by 2 days, Acme Heating Ltd, renewals`), with the first letter capitalised by
`.line-meta::first-letter { text-transform: uppercase }`. `.line-meta` is `display: block` everywhere:
no flex, no gap, no stray spaces. Clients are always shown by name, never by folder slug. The same goes for a to-do's project: a project that is a client's folder shows that client's name, and any other folder name is shown as words (`placeName`, `todoPlaces` in `client/src/shell/words.ts`). Short forms keep their capitals wherever a name becomes words (TDS, AI, SEO, PDF: the list is in `shared/words.ts`).

## Apps on the sheet

An app is one entry in `client/src/shell/apps.ts` (`AppSlot`): a rail item, a sheet, and optionally
its own sheet-bar buttons and right-panel body. It builds from the shared pieces and adds no look of
its own: `.field` for pickers and search, `Seg` for any one-of-many choice (including filters,
labelled "Name, count"), the `.tray` with one `.card` per group (`.card-head`: title, `.count`, a
quiet button on the right), `.line` rows or tiles inside the card, `.tick` in `label.tick-hit` for
picking several (only where that is worth it: Images has ticks, Documents doesn't), `.kv` rows and `.chip` tags in the panel, `.btn` for actions, `.glass` for a floating
action bar. Sheet padding 12px 16px 16px, gap 8px.

Every app declares `search` (global search); a new list or inventory is searchable from Search or jump to. An app's `AppSlot.search` is a `SearchSource` kept outside its lazy UI chunk (`search.ts` in the app's folder), with a hit that opens the item (`SearchActions`); `client/src/shell/apps.test.ts` fails for a `search: null` that has no reason listed. The palette's groups: Go to (derived from the apps), To-dos, Open chats, Skills, Clients, Earlier chats, then the apps' own, async ones last. Six per group, with "6 of N" beside the heading when there are more; "Still looking…" beside it while the server builds more; a hit's second line is the client, the scope name or "My personal files".

Those pieces are already assembled in `client/src/apps/shared`: `LibraryTools` (the "Library" picker
with Mine and Clients groups (a Shared group exists for agency folders but is unused today), search, the app's own controls, together on the right), `FolderCard` (first 60 items,
then a quiet small `btn` "Show all N"), `SelectionBar`, `ViewButton` (the inline Open), `LibraryBar` (Back, details), `DetailActions`,
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
can be made wider (Ian, 2026-11-15: a landscape A4 deck ran off the right): a 20px grab strip centred on its
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

## Old tokens being retired

`--s1`…`--s5`, `--radius`, `--radius-sm`, `--card`, `--rule`, `--rule-strong`, `--accent`, `--accent-ink`,
`--accent-wash`, `--ink`, `--text-soft`, `--font`. Swap: `--rule-strong`→`--line-strong`, `--rule`→`--line`,
`--accent` and `--accent-ink`→`--blue-ink`, `--accent-wash`→`--wash`, `--card`→`#fff`,
`--text-soft`→`--iron`, `--radius`→`14px`, `--radius-sm`→`10px`, spacing as mapped above. They stay
defined in `tokens.css` as aliases until no file uses them; the lead removes them last.
