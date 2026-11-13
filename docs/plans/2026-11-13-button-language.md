# One button language (2026-11-13)

Date: 2026-11-13 · Size: L · Branch: `button-language` (from main 0cf0eb2, carrying the uncommitted To-dos + work) · Explainer: none

## Objective

Every clickable control in the app follows one small set of button kinds. Each kind has one look for rest,
hover, pressed, toggled or open, disabled and focus, and every colour comes from a named token. A standalone
action always looks like a button, never bare text. Text-only controls are allowed only inside a sentence.

## User decisions (fixed)

- Review every button: colours, shades, hover, inactive and the other states.
- Rule: "every button should be a button, not text. Unless within inline text."
- Fold the To-dos + work (navy icon primary, labelled primary small "Add a to-do") into this review.
- Propose first and get the user's yes, then build. No explainer.
- Pending the user: Q1 standard look, Q2 quiet text colour, Q3 "Allow for this chat" (see the end).

## Facts (checked 2026-11-13)

- Inventory of every control, with its states and file:line: scratchpad `button-inventory.md` (scout, 2026-11-13).
- Styles: `.btn` / `.icon-btn` in `client/src/styles/base.css` (~150-310). Overrides in `drawers.css`,
  `home.css`, `shell.css`, `chat.css` and `apps/shared/library.css`. Tokens in `client/src/styles/tokens.css`.
  `--line-strong`, `--danger` (#a4261b) and `--danger-wash` (#fdeceb) already exist.
- Grey `.btn` (#f3f0ea tray) on drawer glass (about #faf9f8) is 1.08:1, so it barely shows. Navy hover
  #0a2a5e against navy #021b43 is 1.21:1, so the hover is nearly invisible.
- Hard-coded shades repeat across files: #eae6de, #e2ddd3, #0a2a5e, #d9e8fc, #33456a, #8a94a6, and
  rgba(2,27,67,.08/.12).
- Text-like buttons today:
  - quiet `.btn` (bare blue-ink text): about 15 uses
  - `.link-btn`: 3 uses, one of them inside a sentence (TodosDrawer.tsx:710)
  - `.card-more`: Home.tsx:160 and :183, parts.tsx:144
- Disabled looks differ: `.btn` ignores `aria-disabled` ("Check for updates" shows no disabled look), and a
  disabled `.icon-btn` still tints on hover.
- Tests that pin variants: `UpdateBanner.test.tsx`, `TodosDrawer.search.test.tsx`, `ImagesApp.test.tsx`.

## Decisions

1. **Six kinds:** primary, standard, quiet, danger, icon (plain or primary) and inline link.
   - Primary: navy.
   - Standard: white, raised, with a fine edge.
   - Quiet: a flat grey tint.
   - Danger: standard with red text.
   - Icon: bare unless primary.
   - Light blue (wash with blue-ink) only ever means "on" or "open". Underlined blue text only ever means a link in a sentence.
   Plain: navy means "do it", white "another option", grey "minor", red "careful", light blue "switched on".
2. **Raised kinds lift on hover; flat kinds darken.**
   - Primary, standard and danger rise 1px with `--lift-1` on hover, and settle flat when pressed.
   - Quiet and icon tints go one step darker on hover and another step darker when pressed.
   - With reduced motion there is no movement.
   Plain: every button visibly reacts when you point at it and when you click it.
3. **Toggled and open look the same on primary and icon buttons.** `aria-pressed`, `data-on` and
   `aria-expanded` on `.btn[data-variant="primary"]` or `.icon-btn` give wash + blue-ink, with `--wash-strong`
   on hover.
   - A quiet button never takes the wash, because a grey tint against wash is about 1.01:1. It shows "open"
     with a chevron instead.
   - "What's new" (UpdateBanner.tsx:210) gains a turning chevron. Its strip is `--wash`, so a wash fill
     would vanish (overseer B1).
   - Buttons with a chevron opt out of the wash through `data-chevron` (set on `.skill-more`).
   - FolderCard's Show/Hide keeps changing its words and gets no `aria-expanded`, since cards start open.
   Plain: an icon or navy button that's switched on or open turns light blue; text buttons show open with a
   turning arrow.
4. **One disabled look.** `:disabled` and `[aria-disabled="true"]` get opacity .5, a not-allowed cursor, and no
   hover or press. The guards are written `:where(:not(:disabled, [aria-disabled="true"]))`, and the toggled
   rules go last.
   Plain: greyed-out buttons look the same everywhere and don't react.
5. **One focus ring:** 2px `--focus`, offset 2, or −2 inside clipping scrollers. No change from today.
   Plain: the keyboard ring is the same blue everywhere.
6. **Scope of "a button, not text".** Every standalone action looks like a button. The exemptions, and what
   already shows each one is clickable:
   - List rows (`.line`, `.line-main`, `.todo-main`, `.lib-open`, palette options, rail items, question
     options): they are the content, and they lift on hover.
   - Fold heads and `.activity summary`: a chevron.
   - Seg options: a visible track.
   - Bare icon utilities: the icon.
   - `.chip-remove`: it sits inside a chip.
   - Only TodosDrawer.tsx:710 ("…in Settings.") stays a text link.
   Plain: anything you click that isn't a list item or a link inside a sentence looks like a button.
7. **One primary per area:** the action the area exists for. "Mark as done" is standard in the edit form
   (where Save is primary) and primary in its own confirm step.
   Plain: there is only ever one navy button per area.
8. **Fixed roles:**
   - Cancel, Keep open, Not now, Don't allow, Stop: standard. Setup's quiet Cancel changes to standard.
   - Close chat (confirm) and Delete: danger.
   - Update now and Update and restart: primary small.
   - Later, What's new, Dismiss, Reload, Back, Show/Hide, Clear date, Clear selection, Mark all as seen,
     All to-dos / chats / skills, Check for updates: quiet.
   Plain: the same kind of choice always looks the same.
9. **Two sizes:**
   - 32px default: header bands, forms, cards, sheets.
   - 28px small: a button on a line with text (card head, Fold action, notice strips, inline confirms,
     selection bar, inside rows).
   - The 36px `.todo-actions .btn` goes. Both New chat buttons become 32px primary.
   - Changes:
     - App.tsx:131 New chat drops `data-size`.
     - Home.tsx:145, :194, :227 (All to-dos / chats / skills) add `data-size="small"`.
     - `.todo-undo` drops its forced 32px (drawers.css:332).
     - "Clear date" stays 32px beside its 32px field.
   Plain: buttons come in two sizes, not three.
10. **One "see all" per card:** the quiet button in the card head. Home's `.card-more` ("See all N",
    "N more") is removed; FolderCard's "Show all N" becomes a quiet small button. `.link-btn` "More options"
    and "Show older versions" become quiet small buttons.
    Home.tsx:160 loses "See all N to-dos", so the count moves into the note sentence ("12 other to-dos").
    Plain: each card has one "All …" button at the top right, and nothing clickable is plain text.
11. **Overseer decisions on the drafted questions (2026-11-13):**
    - Standard is white. Grey is 1.08:1 on drawer glass; white with a `--line-strong` edge reads on every
      surface. Check that it doesn't look like a `.field` dropdown beside the To-dos filter selects.
    - Quiet text is navy, so blue means only "on" and links.
    - "Allow for this chat" stays standard. Its emphasis is a permissions question, not a colour one.
    Plain: buttons are white, minor buttons have navy text, and the permission card keeps its current order.
12. **Grey family trimmed.**
    - `.jump` uses `--tint-1/2/3` (iron text on `--tint-1` is 6.79:1), so there are no `--tray-hover` or
      `--tray-press` tokens.
    - `#8a94a6` is named `--grey-dot` (switch off, idle dots).
    - `.count` and badge fills at .08 stay as they are; they are fills, not hovers.
    Plain: one family of greys instead of two.
13. **The answer box (`.pending`) keeps its buttons as real buttons.** Its override (chat.css:396-406) is
    deleted. design-system.md:67 changes to "buttons and fields excepted", and :70 drops "a small plain Update
    and restart".
    Plain: buttons in Claude's question card look like the buttons everywhere else.
14. **If quiet looks faint in the browser check,** the tints step up to .09 / .13 / .17.
    Plain: we'll check the grey buttons on a drawer and darken them a little if they read as text.

## Contract: the kinds and states

The markup API stays the same. Danger is the only new variant.

- `.btn`, with `data-variant` = `primary` | `quiet` | `danger`; absent means standard. Optional
  `data-size="small"`.
- `.icon-btn`, with optional `data-variant="primary"`.
- `.link-btn`, only inside a sentence.

| Kind | Rest | Hover | Pressed | Toggled / expanded | Disabled |
|---|---|---|---|---|---|
| Primary | `--navy`, `--paper` text | `--navy-hover` + `--lift-1` + up 1px | `--navy`, no shadow | `--wash` + `--blue-ink`; hover `--wash-strong` | .5 |
| Standard | #fff, 1px `--line-strong`, `--lift-0`, navy text | #fff + `--lift-1` + up 1px | `--tray`, no shadow | n/a | .5 |
| Quiet | `--tint-1`, navy text | `--tint-2` | `--tint-3` | chevron (`data-chevron`), no wash | .5 |
| Danger | as standard, `--danger` text | `--danger-wash` + `--lift-1` + up 1px | `--danger-wash-strong` | n/a | .5 |
| Icon | bare, `--ink-soft` | `--tint-2` + navy | `--tint-3` | as primary | .5 |
| Icon primary | `--navy`, `--paper` icon | as primary | as primary | as primary | .5 |
| Inline link | blue-ink, 1px underline | 2px underline | n/a | n/a | n/a |

New tokens in `tokens.css`:

```
--navy-hover: #213f73;                 /* replaces #0a2a5e; 1.63:1 against navy, paper text 9.79:1 */
--ink-soft: #33456a;                   /* icon, seg and rail text */
--tint-1: rgba(2, 27, 67, 0.07);       /* quiet rest, seg track */
--tint-2: rgba(2, 27, 67, 0.11);       /* flat hover */
--tint-3: rgba(2, 27, 67, 0.15);       /* flat pressed */
--wash-strong: #d9e8fc;                /* blue-ink on it 5.26:1 */
--danger-wash-strong: #f9d9d6;
--grey-dot: #8a94a6;                   /* switch off, idle dots */
```

Mapping of current usage to kinds: see the expert table, reproduced in the builder briefs. Groups:
- primaries: CSS only, except App.tsx:131 drops `data-size`
- standard: CSS only; delete `.pending .btn` (chat.css:396-406) and the 36px rule
- quiet: CSS only; delete the update-banner override (shell.css:583)
- markup changes: SetupView Cancel, UpdateBanner :80 and :107, Delete and Close-chat confirm to danger,
  `.link-btn` ×2, `.card-more` ×3
- exempt controls: hex values swapped for tokens only

## Team and file ownership

- **Builder A (CSS, Sonnet):** `tokens.css`, `base.css`, `drawers.css`, `home.css`, `shell.css`, `chat.css`,
  `apps/shared/library.css`.
- **Builder B (markup and tests, Sonnet):** `App.tsx`, `shell/Home.tsx`, `apps/shared/parts.tsx`,
  `components/SetupView.tsx`, `shell/UpdateBanner.tsx`, `shell/TodoForms.tsx`, `components/Chat.tsx`,
  `components/VersionHistory.tsx`, `shell/SkillsDrawer.tsx` (`data-chevron`), and the affected `*.test.tsx`.
- **Lead:** `docs/design-system.md`: the Controls section, the state table and the rule.

## Tests

- Update the variant assertions in UpdateBanner, TodosDrawer.search and ImagesApp.
- Home.test.tsx:183 and :309 test the removed `.card-more` buttons: delete them, or point them at
  "All to-dos" and the count sentence.
- SetupView.test.tsx:149 and :211 pin `data-variant`: check them against the Cancel change.
- Add: Delete and Close chat render `data-variant="danger"`. No `.card-more` or `.link-btn` outside a sentence.
- CSS states are checked in the browser, not in jsdom.

## Gates

`pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`, then a browser check on the test copy (3878):
Home, the drawers, a to-do form, the chat confirm, the update banner, Settings and a library sheet. Then the
UX/UI gate.

## Exemptions to name to the user

- Fold heads (section titles in drawers): text with a chevron and a tint on hover.
- "What Claude did (N steps)" in a chat: small text with a chevron. This is the weakest exemption.
- Bare icon utilities (close, pin, edit, more): already ruled on (design-system.md:55).

## Overseer pre-review (2026-11-13)

- One blocking item: B1, quiet toggled wash. Fixed in decision 3.
- Should items S1-S6 were folded into decisions 9-14, the tests and the exemptions.

## Review outcomes

- **Correctness (Opus):** no cascade bugs. Found 6 groups of markup changes with no regression test; assertions added. The plan table's standard and quiet toggled cells were corrected.
- **UI, accessibility, drift (Sonnet):** no code findings. Two stale doc lines (`.card-more`, #D9E8FC) fixed.
- **UX gate (Opus, screenshots):** nothing blocking. Quiet tints are not faint, so decision 14 was not needed. Fixes applied:
  - reduced-motion fill for standard hover
  - pressed step for toggled buttons
  - `--lift-0` doc row
  Left as is, with the overseer's agreement:
  - the `+` stays navy beside an edit form's Save
  - the `.count` fill
- **Overseer sign-off:** no blockers. Follow-ups applied:
  - reduced-motion pressed fill (`--tray`)
  - `.activity summary:active` `--tint-3`
- **Browser (test copy, 3878):** Home, the edit form, Delete hover, the add form with the `+` open, and the Skills chevron open without the wash.
- **Open:** `Shell.test.tsx` flakes now and then under full-suite load (a different test each time). It didn't reproduce in 6 runs, and it isn't known whether it predates this branch.
