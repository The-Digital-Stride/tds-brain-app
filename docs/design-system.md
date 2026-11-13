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

- Rail item 36px high. Drawer and card rows: padding 7px 8px. Fold header 30px. Dock header min-height 47px (48 with the glass edge), padding 0 10px 1px 14px.
- Sheet bar 48px, padding 0 10px 0 18px, no border.
- Header band: the rail's logo, every dock header and the sheet bar fill the top 48px of their layer, with their contents centred on one line (y 36 from the desk's top edge); 32px controls sit 8px from top and bottom.
- A drawer's search or filter (the Skills search, the To-dos switch) sits on the drawer's own glass between the header and the list (`.drawer-tools`, padding 0 10px 8px); only the list scrolls (`.drawer-scroll`). Nothing in a drawer has a backing of its own (Ian, 2026-11-11: a whiter strip behind the search was "not good").
- A skill row shows its title and one clipped line of description. A chevron (28px, right when closed, down when open) opens the full text; clicking the title still starts the skill. The pin shows on the row under the pointer or the keyboard; a pinned skill keeps its pin. The pin sits left of the chevron, so the chevron is always at the row's right edge.
- Tray: gap and padding 6px. Card: padding 12px 6px 6px (its heading row is inset 8px so text lines up with the rows).
- Home: top padding 32px; greeting margin 0 0 4px; summary line 14px, margin 0 0 18px.
- Composer padding 10px 10px 8px 14px; input 14px. Floater padding 8px 28px 14px.
- Thread: column gap 12px; paragraph margin 0 0 12px.
- Settings rows: padding 10px 0, divided by hairlines.

## Controls

- **Button** `.btn`: 32px high, padding 0 12px, radius 9, 13/600, tray fill. `data-size="small"`: 28px, padding 0 10px, 12px. `data-variant="primary"`: navy. `data-variant="quiet"`: transparent, blue-ink text.
- **Icon button** `.icon-btn`: 32px, radius 9 (28px inside rows). Always has an `aria-label`.
- **Show/hide toggles are icons, top right, always** (Ian, 2026-11-13: "put the icon in the top right ALWAYS everywhere it appears - it's a rule"). The rail's names toggle (`rail` icon) and the right panel's toggle (`panel` icon) are icon buttons with no visible words; the name lives in `aria-label` and a hover tip. The rail's sits at the top right of its header band, 10px from the edge like a dock's close button; with the rail at icons only it takes the mark's place (on hover or keyboard focus where the pointer hovers, always on touch). The panel's is the last thing in the sheet bar, after "Search or jump to": pass `panel` to `SheetBar` and never place `PanelToggle` yourself.
- **Field and select** `.field`: 32px, padding 0 10px, 1px `--field-edge`, radius 9, 13px, white fill.
- **Tick** `.tick` (on `input[type=checkbox]` or `input[type=radio]`): 18px, `appearance: none`, 1.5px solid `--tick-edge` (#7C8AA5), fill rgba(255,255,255,.7), radius 5 (radio 50%). Checked checkbox: navy fill, white check. Checked radio: navy border, centred 8px navy dot. Hit area: wrap in `label.tick-hit` (24px box) when the input stands alone.
- **Switch** `.switch` (on `input[type=checkbox][role=switch]`), for on/off settings that apply at once: track 30×18, radius 999, off #8A94A6, on navy; knob 14px white with `0 1px 2px rgba(2,27,67,.2)`, moves 12px. Row: grid `1fr auto`, gap 16; title 14/500; help 12 iron, margin-top 2.
- **Seg**: options 28px, 3px padding, radius 10 / 8, 13px.
- **Chip** `.chip`: 12/500, padding 2px 9px, tray fill. **Count** `.count`: 12/600, line-height 18.

## Surfaces inside the sheet

- Recessed **tray** holding raised **cards**: the one card device, on Home and for any collection an app shows on the sheet (Ian, 2026-11-11: an app's content must use "the other card type devices", not a look of its own). A picture sits flat on the white card with a 1px hairline edge and no shadow.
- Settings and the Details tab: plain content, hairline rows (`border-top: 1px solid var(--line)`). No cards.
- **Answer box** (the approval or question waiting on you, `.pending`): ONE amber-glass surface. Radius 14, padding 12px 14px, 1px rgba(245,158,11,.5), fill rgba(255,248,232,.72), blur 20, `--lift-3`. Nothing inside it has its own border, box or shadow. Text stays navy. The focus ring belongs to the surface: `.pending:has(> :focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px }`, and the card inside has no outline of its own.

- **Update line** (`UpdateBanner`, top of the sheet, above the other notices): "TDS Brain x.y.z is
  available." with a quiet "What's new" (owners and scouts), a small plain "Update and restart" and a
  quiet "Later". Open chats get the in-place `fieldset.close-confirm` before anything restarts. Only
  one version line shows at a time: once the page is out of date, the Reload line replaces it.

## Thread content

- Reply headings h1/h2 18, h3 15, h4 14 (`--head`, 600, margin 16px 0 6px). Lists: padding-left 20px.
- Tables 14px; `td` padding 8px 10px 8px 0 with a 1px `--line` rule; `th` 12/600 iron with a 1.5px navy rule.
- Inline code: tray fill. Code block: tray fill, radius 10, padding 10px 12px, 12.5px.
- Blockquote and Claude's side notes: 2px `--line-strong` left rule, 12px padding, 13px iron.
- "What Claude did": 13px iron, padding 3px 8px 3px 4px, a 14px chevron `Icon` (rotated −90° when shut).
- Your message: 14/1.5, wash fill, radius 14 14 4 14, padding 8px 12px. Record lines: 13px iron with an 8px #B9C0CE dot.

## Height (shadows)

One light, one formula, even steps (Ian, 2026-11-11: "the drop shadows should be consistent across all
layers to represent consistent height spacing"). Each step up is 6px higher: its shadow drops 6px
further, spreads 16px wider and is 0.04 darker. Every shadow in the app is one of these tokens; no
stylesheet writes its own.

| Token | Height | Shadow | What sits there |
|---|---|---|---|
| `--recess` | one step down | `inset 0 1px 2px rgba(2,27,67,.06)` | the tray |
| `--lift-0` | touching | `0 1px 2px rgba(2,27,67,.1)` | a switch's knob, the chosen segment, a plain button or "Search or jump to" under the pointer |
| `--lift-1` | 1 step | `0 1px 2px rgba(2,27,67,.06), 0 6px 16px rgba(2,27,67,.06)` | the sheet, rail and drawers on the desk; a card in the tray; anything hovered or current that rises off its surface (row, tile, rail item, palette option); the composer |
| `--lift-2` | 2 steps | `0 1px 2px rgba(2,27,67,.06), 0 12px 32px rgba(2,27,67,.1)` | what floats over the sheet: menus, tooltips, the selection bar, a floating composer, the sign-in card |
| `--lift-3` | 3 steps | `0 1px 2px rgba(2,27,67,.06), 0 18px 48px rgba(2,27,67,.14)` | what sits over everything: the palette, the answer box, a floating drawer or panel |

A shadow is measured from the surface the thing sits on, so a row lifting off a card casts the same
`--lift-1` as the card casts on the tray. No hover or current state draws a border or ring to show
height (Ian, 2026-11-11: "you're placing a border around the hover, which should be more subtle").
Rings are for keyboard focus and the palette's active option only.

No layer draws a line under its header (Ian, 2026-11-11: the hairline under the sheet bar was "not in
line with the design system"). Content that scrolls under a fixed header fades out over the scroller's
top 8px (`mask-image`), and the scroller takes `scroll-padding-top: 8px`. Hairlines are for rows of plain
content (Settings, tables) and picture edges only. Scrollbars show a thumb and no track.

## Interaction states

Transition `background-color, box-shadow, transform 120ms var(--ease)`. Under reduced motion: no
transform; the surface and shadow change stay. Hover is the element rising one step towards you
(`--lift-1`); pressed is it pushed back to the surface (no shadow). Selected or current is always
distinct from hover by its fill or weight, not by a deeper shadow.

| Element | Hover | Pressed | Current or selected |
|---|---|---|---|
| Rail item | rgba(255,255,255,.8) + `--lift-1` | no shadow | #fff + `--lift-1` + 600 (an open drawer's item gets the hover surface plus its 3px bar) |
| Drawer row, answer-box option (these lift) | rgba(255,255,255,.92) + `--lift-1` + `translateY(-1px)` | no transform | #fff + `--lift-1`; a current row's title goes to 600. No coloured edge (Ian, 2026-11-11: "the blue edge" is an old style) |
| Row or tile inside a card: Home rows, "N more", an app's items | stays #fff + `--lift-1` + up 1px, above its neighbours; no edge | `--tray` fill, no shadow | wash fill + `--lift-1` + title 600 (hover #D9E8FC) |
| `.btn` | #EAE6DE + `--lift-0` | #E2DDD3, no shadow | n/a |
| `.btn` primary | #0A2A5E + `--lift-1` | navy, no shadow | n/a |
| `.btn` quiet | wash | #D9E8FC | n/a |
| `.icon-btn`, fold header | rgba(2,27,67,.08) | rgba(2,27,67,.12) | `aria-pressed`: wash + blue-ink |
| "Search or jump to" | #EAE6DE + the `.btn` shadow | #E2DDD3 | n/a |
| Seg option | rgba(255,255,255,.55) | n/a | #fff + seg shadow + 600 |
| Palette option | rgba(255,255,255,.85) + `--lift-1` | n/a | #fff + `--lift-1` + 1.5px blue-ink inset ring |
| Links | 2px underline, offset 2 | n/a | n/a |

Focus everywhere: 2px blue-ink outline, offset 2 (offset −2 inside clipping scrollers: drawer rows,
palette, seg).

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
picking, `.kv` rows and `.chip` tags in the panel, `.btn` for actions, `.glass` for a floating
action bar. Sheet padding 12px 16px 16px, gap 8px.

Those pieces are already assembled in `client/src/apps/shared`: `LibraryTools` (the "Library" picker
with Mine and Clients groups (a Shared group exists for agency folders but is unused today), search, the app's own controls, together on the right), `FolderCard` (first 60 items,
then a `.card-more` "Show all N"), `SelectionBar`, `LibraryBar` (Back, details), `DetailActions`,
`LibraryNotice` (loading, failed with "Try again", empty), `Thumb`, `Viewer`, the data hooks and a
store factory for state the sheet and the panel share, plus `library.css`. A new app writes its row
or tile, its panel body and a short stylesheet for what is particular to its items. Both examples
list the real files the server finds; nothing is sample data.

| App | What is its own |
|---|---|
| `client/src/apps/images` | Grid or list. Tiles: padding 8px, radius 10, 2px apart, picture box 3:2 with a hairline edge, the picture contained at its own proportions. No picture (or one that fails to load): the standard tile, the `image` line icon centred in the same box. Meta: the dimensions, else the size. |
| `client/src/apps/documents` | Rows that read like a table: a 32px flat white box with a line icon for the file's kind, title and meta ("PDF, 840 KB"), then the date changed (80px, right-aligned, 12px; gone under 480px of sheet, it is in the panel). Grid or list (list by default). Tiles as in Images, but the picture box is 3:4. On a Mac, Quick Look draws the first page of PDFs, Word, Excel and PowerPoint; other files (web pages too: Quick Look would load local files into them), and every file elsewhere, show their format icon in the same box. In the panel: the preview (square when there is a picture, 3:2 with the icon when not), then the title and file name. |

In both panels the `.kv` row for a card is labelled "Group" (it is a card name, not always a folder).

The panel's actions (`DetailActions`) sit on two rows on purpose, each a `.lib-actions-row`: the
actions on the file (Open, primary, when the app can open it; then "Ask Claude about it", primary when
there is no Open), then the file utilities (Download, Copy file path) as standard `.btn`s. Download is
an `<a class="btn" download>` to `ROUTES.libraryFile`, named "Download <file name>" for screen readers;
the server sends the file as an attachment, so it is saved and the app stays where it is.

The client chosen on Home or in any app is shared: moving between them stays on it until the page is
reloaded, when Home falls back to the last client a chat used. "No client" on Home leaves the apps
where they are. Choosing the client an app already shows keeps what is ticked, open and in the panel.

Opening a file ("Open" in the panel) swaps the sheet's list for the viewer and adds a quiet small
"Back to ..." button to the sheet bar. When the panel floats, Open also closes it, and the viewer takes
focus once the sheet is live again. The list stays mounted, hidden, so Back (or Escape inside the
viewer) restores its scroll and puts focus on the item. The viewer sits on a `.tray` like the lists,
with one white `.card`: a picture opens large and contained, flat with a hairline edge (8px padding,
no shadow); text and Markdown in a card up to 760px wide; an HTML page fills a card in an iframe with
an empty `sandbox`; a PDF opens in the browser's own reader, edge to edge in its card (no padding), at
`#navpanes=0&view=FitH`, unsandboxed because browsers refuse PDFs in a sandboxed frame; if a link to another site is blocked the frame reloads and a quiet line says "Links to other sites are switched off here." Items are clickable across their whole box, not only the inner button.

Both are on the rail in every build.

## Old tokens being retired

`--s1`…`--s5`, `--radius`, `--radius-sm`, `--card`, `--rule`, `--rule-strong`, `--accent`, `--accent-ink`,
`--accent-wash`, `--ink`, `--text-soft`, `--font`. Swap: `--rule-strong`→`--line-strong`, `--rule`→`--line`,
`--accent` and `--accent-ink`→`--blue-ink`, `--accent-wash`→`--wash`, `--card`→`#fff`,
`--text-soft`→`--iron`, `--radius`→`14px`, `--radius-sm`→`10px`, spacing as mapped above. They stay
defined in `tokens.css` as aliases until no file uses them; the lead removes them last.
