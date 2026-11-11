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
| Dock (drawer, panel) heading | `--head` | 15 / 600 (T) | navy |
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

- Rail item 36px high. Drawer and card rows: padding 7px 8px. Fold header 30px. Dock header padding 12px 10px 8px 14px.
- Sheet bar 48px, padding 0 10px 0 18px.
- Tray: gap and padding 6px. Card: padding 12px 6px 6px (its heading row is inset 8px so text lines up with the rows).
- Home: top padding 32px; greeting margin 0 0 4px; summary line 14px, margin 0 0 18px.
- Composer padding 10px 10px 8px 14px; input 14px. Floater padding 8px 28px 14px.
- Thread: column gap 12px; paragraph margin 0 0 12px.
- Settings rows: padding 10px 0, divided by hairlines.

## Controls

- **Button** `.btn`: 32px high, padding 0 12px, radius 9, 13/600, tray fill. `data-size="small"`: 28px, padding 0 10px, 12px. `data-variant="primary"`: navy. `data-variant="quiet"`: transparent, blue-ink text.
- **Icon button** `.icon-btn`: 32px, radius 9 (28px inside rows). Always has an `aria-label`.
- **Field and select** `.field`: 32px, padding 0 10px, 1px `--field-edge`, radius 9, 13px, white fill.
- **Tick** `.tick` (on `input[type=checkbox]` or `input[type=radio]`): 18px, `appearance: none`, 1.5px solid `--tick-edge` (#7C8AA5), fill rgba(255,255,255,.7), radius 5 (radio 50%). Checked checkbox: navy fill, white check. Checked radio: navy border, centred 8px navy dot. Hit area: wrap in `label.tick-hit` (24px box) when the input stands alone.
- **Switch** `.switch` (on `input[type=checkbox][role=switch]`), for on/off settings that apply at once: track 30×18, radius 999, off #8A94A6, on navy; knob 14px white with `0 1px 2px rgba(2,27,67,.2)`, moves 12px. Row: grid `1fr auto`, gap 16; title 14/500; help 12 iron, margin-top 2.
- **Seg**: options 28px, 3px padding, radius 10 / 8, 13px.
- **Chip** `.chip`: 12/500, padding 2px 9px, tray fill. **Count** `.count`: 12/600, line-height 18.

## Surfaces inside the sheet

- Recessed **tray** holding raised **cards**: the one card device, on Home and for any collection an app shows on the sheet (Ian, 2026-11-11: an app's content must use "the other card type devices", not a look of its own). A picture sits flat on the white card with a 1px hairline edge and no shadow.
- Settings and the Details tab: plain content, hairline rows (`border-top: 1px solid var(--line)`). No cards.
- **Answer box** (the approval or question waiting on you, `.pending`): ONE amber-glass surface. Radius 14, padding 12px 14px, 1px rgba(245,158,11,.5), fill rgba(255,248,232,.72), blur 20, `--lift-3`. Nothing inside it has its own border, box or shadow. Text stays navy. The focus ring belongs to the surface: `.pending:has(> :focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px }`, and the card inside has no outline of its own.

## Thread content

- Reply headings h1/h2 18, h3 15, h4 14 (`--head`, 600, margin 16px 0 6px). Lists: padding-left 20px.
- Tables 14px; `td` padding 8px 10px 8px 0 with a 1px `--line` rule; `th` 12/600 iron with a 1.5px navy rule.
- Inline code: tray fill. Code block: tray fill, radius 10, padding 10px 12px, 12.5px.
- Blockquote and Claude's side notes: 2px `--line-strong` left rule, 12px padding, 13px iron.
- "What Claude did": 13px iron, padding 3px 8px 3px 4px, a 14px chevron `Icon` (rotated −90° when shut).
- Your message: 14/1.5, wash fill, radius 14 14 4 14, padding 8px 12px. Record lines: 13px iron with an 8px #B9C0CE dot.

## Interaction states

New token `--lift-h: 0 1px 2px rgba(2,27,67,.06), 0 2px 8px rgba(2,27,67,.07)`. Transition
`background-color, box-shadow, transform 120ms var(--ease)`. Under reduced motion: no transform; the
surface and shadow change stay. Hover is the element lifting towards you, in the same language as the
layers. Selected or current is always distinct from hover.

| Element | Hover | Pressed | Current or selected |
|---|---|---|---|
| Rail item | rgba(255,255,255,.8) + `--lift-h` | no shadow | #fff + `--lift-1` + 600 (an open drawer's item gets the hover surface plus its 3px bar) |
| Drawer row, answer-box option (these lift) | rgba(255,255,255,.92) + `--lift-h` + `translateY(-1px)` | no transform | #fff + `--lift-1`; a current row's title goes to 600. No coloured edge (Ian, 2026-11-11: "the blue edge" is an old style) |
| Row or tile inside a card: Home rows, "N more", an app's items (surface only) | #EAE6DE | #E2DDD3 | wash fill + title 600 (hover #D9E8FC) |
| `.btn` | #EAE6DE + `0 1px 2px rgba(2,27,67,.12)` | #E2DDD3, no shadow | n/a |
| `.btn` primary | #0A2A5E + `--lift-1` | navy, no shadow | n/a |
| `.btn` quiet | wash | #D9E8FC | n/a |
| `.icon-btn`, fold header | rgba(2,27,67,.08) | rgba(2,27,67,.12) | `aria-pressed`: wash + blue-ink |
| "Search or jump to" | #EAE6DE + the `.btn` shadow | #E2DDD3 | n/a |
| Seg option | rgba(255,255,255,.55) | n/a | #fff + seg shadow + 600 |
| Palette option | rgba(255,255,255,.85) + `--lift-h` | n/a | #fff + `--lift-1` + 1.5px blue-ink inset ring |
| Links | 2px underline, offset 2 | n/a | n/a |

Focus everywhere: 2px blue-ink outline, offset 2 (offset −2 inside clipping scrollers: drawer rows,
palette, seg).

## Row meta lines

One sentence-like line, the same on Home, in drawers and in the palette: parts joined by ", " in the
text itself (`overdue by 2 days, Acme Heating Ltd, renewals`), with the first letter capitalised by
`.line-meta::first-letter { text-transform: uppercase }`. `.line-meta` is `display: block` everywhere:
no flex, no gap, no stray spaces. Clients are always shown by name, never by folder slug.

## Apps on the sheet

An app is one entry in `client/src/shell/apps.ts` (`AppSlot`): a rail item, a sheet, and optionally
its own sheet-bar buttons and right-panel body. It builds from the shared pieces and adds no look of
its own: `.field` for pickers and search, `Seg` for any one-of-many choice (including filters,
labelled "Name, count"), the `.tray` with one `.card` per group (`.card-head`: title, `.count`, a
quiet button on the right), `.line` rows or tiles inside the card, `.tick` in `label.tick-hit` for
picking, `.kv` rows and `.chip` tags in the panel, `.btn` for actions, `.glass` for a floating
action bar. Sheet padding 12px 16px 16px, gap 8px.

Those pieces are already assembled in `client/src/apps/shared`: `LibraryTools` (client, search, one
control of the app's own), `FolderCard`, `SelectionBar`, `DetailsButton`, `DetailActions`,
`DetailList`, a store factory for state the sheet and the panel share, and `library.css`. A new app
writes its row or tile, its panel body and a short stylesheet for what is particular to its items.

| Example | What is its own |
|---|---|
| `client/src/apps/images` | Grid or list. Tiles: padding 8px, radius 10, 2px apart, picture box 3:2 with the picture at its own proportions. |
| `client/src/apps/documents` | Rows that read like a table: a 32px flat white box with a line icon for the file's kind, title and meta, then status (96px), who (88px) and date (80px, right-aligned) at 12px. Who drops out under 640px of sheet and the date under 480px (both are in the panel); status stays. A draft's status is 600 navy. In the panel the white card is the page: title, file name, then a sketch of what is inside (headings and bars, a slide, or a sheet's grid). |

Both are shown only in a build with `VITE_EXAMPLE_APPS=1`.

## Old tokens being retired

`--s1`…`--s5`, `--radius`, `--radius-sm`, `--card`, `--rule`, `--rule-strong`, `--accent`, `--accent-ink`,
`--accent-wash`, `--ink`, `--text-soft`, `--font`. Swap: `--rule-strong`→`--line-strong`, `--rule`→`--line`,
`--accent` and `--accent-ink`→`--blue-ink`, `--accent-wash`→`--wash`, `--card`→`#fff`,
`--text-soft`→`--iron`, `--radius`→`14px`, `--radius-sm`→`10px`, spacing as mapped above. They stay
defined in `tokens.css` as aliases until no file uses them; the lead removes them last.
