# UX consistency programme: one action language, shared parts, tokens

Date: 2026-11-22 · Size: XL (four releases on one branch) · Branch: `ux-consistency` · Explainer: none

Findings, evidence and file:line for everything below: `docs/plans/2026-11-22-ux-consistency-review.md`
(sections 2 to 4). This file holds the decisions, the team and the gates.

## Objective

Make every tool in the app speak one action language (where Open, Edit, Delete, New, star and close go,
how they look, what they're called, and what safety net they get), fix the bugs the review found, replace
the per-tool copies of small parts with shared ones, and turn the design system's scales into tokens with
a test that stops drift coming back.

## User decisions (fixed, Ian 2026-11-22)

- All four releases, built and tested; expert review of design, layout, UX/UI and code quality, repeated
  until every reviewer is satisfied. Then merge to main **and push** (this branch's work only).
- Home's pinned to-dos open the to-do (panel), not a chat.
- Ending a chat gets its own icon and the words "End chat"; X only ever closes a surface or removes a chip.
- "Favourite" everywhere (card titles, hints, labels). Prefs key `pins` stays (older app versions).
- Deleting an earlier chat uses the shared Undo line instead of the inline confirm.
- Red (danger) only for an action with no Undo; the to-do panel's Delete becomes a standard button.
- "New chat" moves from the Chats dock header to the end of the Open/Earlier row.
- No explainer.

## Constraints

- Backward compatibility first: no prefs keys, API routes, brain files or saved formats change. The app
  never writes brain files itself. The todo editor keeps saving markdown.
- UK English in anything a person reads (UI, help pages under `help/`); US English in code.
- Reuse existing pieces (Fold, Icon, StarButton, Seg, SheetBar, `.btn`/`.icon-btn`); no new dependency.
- Commit types: `fix:` for bugs, `refactor:` for consolidation, `feat:` only for genuinely new behaviour
  (chat delete Undo, star on Home rows / to-do panel, Delete in the details pane).

## Decisions

### Release 1: fix what's broken, freeze the drift

1. **Eager file-stage styles (review B1).** Move `.lib-note`, `.lib-failed` (+ `p`), `.lib-file`,
   `pre.lib-text` and the file-stage rules from `apps/shared/library.css` into an eagerly loaded sheet
   (`styles/viewer.css`), and delete the 47-line copy at `viewer.css:175-221`.
   Plain: file previews look the same whether or not you've opened Documents first.
2. **Scope `.todo-status` (B2)** to `.todo-panel .todo-status` in `todo-panel.css`.
   Plain: the To-dos drawer's status line gets its own spacing back.
3. **One small size for buttons (B3).** `[data-size="small"]` gives 28px for both `.btn` and `.icon-btn`
   (in `base.css`); every `data-size="28"` and the per-file 28px icon rules (`drawers.css:36`,
   `shell.css:317`, `guide.css:191`, `base.css:278`) move to it. `HelpLink size={28}` keeps its prop but
   renders `data-size="small"`.
   Plain: small buttons are one size everywhere, including the Ads tables.
4. **Health in words (B4).** The project list row shows the health word in its meta line (as
   `ProjectPage.tsx:157` does); amber dots use a 3:1 colour (`--attn-asking-edge` or a new `--state-warn`).
   Plain: you can tell a project's health without relying on colour.
5. **Small fixes (B6, B8, B10, B11).** Project "Delete…" buttons both standard (they lead to a confirm,
   decision 13); fix the Project Files comment; Unlink says what happened in a status line and moves focus
   to the next row; triage pop-up heading uses `--head`; Ads note box padding `8px 10px`; remove the native
   `title` on `Approvals.tsx:167`; the three browser-default checkboxes get `.tick`; confirm strips focus the
   safe option (`TodoFiles.tsx:476-481`, `TodoPanel.tsx:624-626`); the viewer resize strip reaches 24px.
   Plain: a batch of small slips are fixed.
6. **Dead CSS (B12)** removed: the 15 unreferenced classes; the design-system doc drops `LibraryBar`,
   `.lib-viewer-bar` and the "Old tokens being retired" section.
   Plain: leftover styles for removed features are gone.
7. **Drift guard.** `client/src/styles/design-system.test.ts` (fs + regex in Vitest, like
   `shell/icon-buttons.test.ts`) with checks frozen at today's counts (a ratchet: counts may fall, never
   rise): off-scale font sizes, radii and z-index; raw colours outside `tokens.css`; an unscoped class
   defined in two files; CSS classes referenced nowhere; classes used by eager code defined only in lazy
   CSS; `data-size` values outside a known set; checkbox/radio inputs without `.tick`/`.switch`.
   Plain: a test fails if anyone adds a new one-off style.

### Release 2: the action standard

8. **Write the standard** into `docs/design-system.md` as a new "Actions" section: review sections 4.1
   (rules 1 to 10) and 4.2 (wording table), with the user decisions above.
   Plain: the rulebook finally answers where buttons go and what they're called.
9. **Row clicks.** Home's pinned to-do rows open the to-do panel (same as the drawer title; the drawer opens
   too if the panel needs it). Documents/Images keep select-then-Open (the named exception). Project Files
   keeps row = open.
   Plain: clicking a to-do always opens it.
10. **Icons mean one thing.** X only closes a surface or removes a chip. Ending a chat (Open chat rows,
    the chat's top bar) uses a new `end` icon with the label "End chat: {title}" / tooltip "End chat".
    "Open full screen" in the chat drawer stops using `wide`. Three dots only ever open a menu: the to-do
    row's read-only "Options" button becomes an "Open" (eye or chevron) icon, or is removed because the
    title already opens it (overseer decides).
    Plain: the cross always just closes things.
11. **Trailing order in rows:** star → utility → remove, at most three icons (already true; verified, and
    the new Home and file-row stars follow it).
12. **One Undo line.** A shared `UndoLine` (contract) replaces the two builds: 10 s, pauses while pointed
    at or focused, a countdown bar, quiet small Undo, a polite status. To-dos, files and earlier chats use
    it. Chat delete is held client-side for the Undo time before the request is sent (as files are).
    Plain: deleting a to-do, a file or a chat works the same way and can be undone.
13. **Red only at the point of no return.** Triggers that lead to a confirm or an Undo are neutral (bin
    icon or standard). To-do panel Delete becomes standard. Final buttons that commit with no Undo
    (project Delete in the panel, "Delete chat" no longer exists) stay danger. "Apply now" stays primary
    behind its confirm.
    Plain: a red button always means "this can't be undone".
14. **Footers and unsaved work.** Forms: primary first on the left, then alternatives, Cancel last.
    Panel footers (to-do panel, any future panel): item actions left, mode actions right. Every form asks
    "Discard your changes?" on Cancel, Esc, Back and close once changed, in one strip under the header band
    (to-do panel edit Cancel, project to-do add, project form move their strips there).
    Plain: Save is always in the same place, and you're always asked before typed work is thrown away.
15. **Create placement.** New/Add is primary with `+`, at the right end of the row it acts on. "New chat"
    moves to the end of the Chats Open/Earlier row. Project "Add a to-do" becomes primary with `+`.
    Plain: the "make a new one" button is in the same spot in every tool.
16. **Edit placement.** Rows: pencil icon. Pages: labelled "Edit" with pencil at the right end of the
    header row (project page moves it off the title's side). To-do panel keeps Edit in its footer (rule 14).
    Plain: Edit is easy to find and always looks the same.
17. **Favourites.** "Favourite" wording everywhere; a star on Home card rows (hover/focus, always on touch),
    in the to-do panel header, and on library rows/tiles.
    Plain: you can favourite or unfavourite something wherever you see it.
18. **Back and stepping.** "All {things}" is quiet small with a left chevron. Stepping between items is
    up/down icon buttons in the header band (Ads proposal stepper moves to match the to-do panel).
    Plain: going back or to the next item looks the same in every tool.
19. **Wording sweep** per the wording table: Remove (not Unlink), Mark as done, Save, Clear filters (a button
    everywhere), Try again (a button everywhere), Close for pickers, no ellipsis on buttons, "Close notes"
    renamed for what it does. Help pages in `help/` updated to match.
    Plain: the same job has the same name everywhere.
20. **Other parity.** Ads Account Summary period uses `Seg`; Documents/Images details pane gets the bin;
    Ads right panel stays closed until a proposal is chosen; "Rate calls" panel drops its repeated heading
    and gets a footer with Save; non-owned project to-dos show who they're assigned to; message box border
    at rest reaches 3:1; Ads load errors use the error notice.
    Plain: the smaller rough edges the review found are smoothed.

### Release 3: shared patterns

21. **Promote and build shared pieces** per review 4.3: `shell/Confirm.tsx` (from `tools/ad-manager/`),
    `.notice[data-level][data-shape]`, `.dot[data-state]` (red = problem only), form field
    (`.form-field`/`.label`/`.hint`/`.error`, `[aria-invalid]`, `:disabled`, `textarea.field`),
    `.hint`/`.note`, `.popover`/`.menu-row`, `.stat`, `ShowMore`, `.panel-head`, `StateNote`
    (generalised `LibraryNotice`; "Loading…"), one `useCopy`. Swap every copy over and delete the old
    classes.
    Plain: each small part exists once, so it looks the same everywhere.

### Release 4: tokens and layers

22. **Correct the scales** in the doc (radii 5, 6, 8, 9, 10, 12, 14, 16, 18; spacing 2, 4, 6, 8, 10, 12,
    16, 24, 32; type scale + 12.5 mono) and add tokens: `--sp-*`, `--r-*`, `--fs-*`, named `--z-*`,
    `--t-fast`/`--t-mid`, `--surface`, `--veil`, `--state-*`. Bring off-scale values onto the scale.
    Add the rule "a pop-up sits above the layer that hosts it".
    Plain: every size and colour comes from one list, ready for a dark theme later.
23. **CSS layers.** `@layer tokens, primitives, patterns, features, tools;` with new `styles/primitives.css`
    and `styles/patterns.css` (eager), shared pieces moved out of feature files, `styles/settings.css`
    split from `chat.css`.
    Plain: shared styles live in one place and can't be accidentally overridden by file order.
24. **Tighten the guard** to the new floor after each release, and finally to zero raw values where clean.
    Plain: the test keeps the app tidy from now on.


## Revisions after the overseer pre-review (2026-11-22; all BLOCKING and SHOULD taken)

These override the decisions above where they differ.

- **R1. D12 focus vs pause (blocking).** `focusOnMount` only after a keyboard press. After a pointer
  press focus goes to the neighbouring row (or stays put), so a mouse tick/delete sends at 10 s untouched.
  Test: a pointer hold sends at 10 s with no interaction.
  Plain: a to-do ticked with the mouse is saved on time even if you don't click elsewhere.
- **R2. Held chats are hidden in the store (blocking).** The store serves past sessions minus held ids (as
  `hiddenFileIds`, `client/src/store.tsx:1318-1326`) to the drawer, Home and search alike, until the reload
  after success; `openPast` ignores a held id; `api.deletePastChat` gains `keepalive`; closing the app
  sends pending deletes at once (to-do/file precedent `store.tsx:1176-1188`).
  Plain: a chat you delete vanishes everywhere at once, and closing the app finishes the delete.
- **R3. R2 ownership (blocking).** Builder 2C runs first and alone. 2C owns `store.tsx`,
  `shell/UndoLine.tsx`, `ChatsDrawer.tsx` and `TodosDrawer.tsx` whole (D10 removal of the read-only
  Options button, End chat on Open rows, D15 New chat incl. `App.tsx:224-236`), `SheetNotices.tsx`, the
  held code in `apps/shared/parts.tsx`, `styles/drawers.css`, `api.ts`. The lead lands the `end` icon and
  D8 (the Actions section) before 2C starts. Then 2A and 2B run in parallel on disjoint files.
  `docs/design-system.md` and `help/` each get one final pass by the lead.
  Plain: the riskiest piece lands first, and no two builders edit the same file.
- **R4. D3 narrowed.** Keep the contextual "icon buttons inside rows are 28px" rule
  (`base.css:277-281`). Fold in only `[data-size="28"]`, `.rail-update` and the duplicate at
  `drawers.css:36`; `[data-size="small"]` works on both `.btn` and `.icon-btn`.
  Plain: no row button can grow because someone forgot a setting.
- **R5. UndoLine doesn't announce.** Hosts keep their always-mounted status lines (`parts.tsx:390`,
  `TodosDrawer.tsx:1103`, plus one for chats). One held-queue helper in the store serves to-dos, files and
  chats; resume restarts the full 10 s (file precedent `store.tsx:264`); `remainingMs` dropped.
  Plain: Undo behaves and is announced the same way for all three.
- **R6. End chat sweep (to 2A, except ChatsDrawer which is 2C).** `client/src/state/close.ts:20-24`,
  `components/Chat.tsx:238-259` ("Close anyway?", "Close chat", "Keep open" → End chat wording),
  `server/engine/session-manager.ts:3192` message, `help/chats-drawer.md`, `help/deleting-a-chat.md`.
  The `end` icon must not look like the Stop square.
  Plain: the button, the question and the help all say "End chat".
- **R7. Help screenshots and selectors.** `pnpm help:shots` joins the R2 gate. `help/shots.json` and
  `client/src/tour/steps.ts` hold class selectors: R3 deletions and the guard's unused-class check read
  them. The help slug `pinned` stays.
  Plain: help pictures match the app and the tour keeps working.
- **R8. Scales into R1.** D22's corrected scale lists land in the doc in R1 so the guard checks against
  them; the tokens themselves start R3 (token definitions, empty `primitives.css`/`patterns.css` and the
  layer order line), and R4 is the sweep. `@layer` lands in one commit across every sheet, lazy ones too.
  Plain: the test checks against the right list from day one, and styles never win by accident.
- **R9. Guard style.** Named allowlists (each offender listed by file and value), not bare counts; print
  the offender on failure; a "scan still works" assertion as `shell/icon-buttons.test.ts:62`.
  Plain: when the test fails it names the stray style.
- **R10. Nice items taken.** "New chat" becomes the 32px primary `+` icon button like To-dos (label "New
  chat"); busy buttons use `aria-disabled`, never `disabled` (`ChatsDrawer.tsx:122`, `TodosDrawer.tsx:303`).
  Plain: both drawers add things the same way, and keyboard focus never drops mid-action.
- **D10 decided:** remove the read-only "Options" button; the title opens the same read view.

## Contract

`docs/plans/2026-11-22-ux-consistency-contract.ts`: props for `UndoLine`, `Confirm`, `ShowMore`,
`StateNote`, the `end` icon, and the CSS attribute API (`data-size`, `data-level`, `data-shape`,
`data-state`).

## Team and file ownership

Builders work in this worktree, one release at a time. Within a release no file is owned twice; exact file
lists are set in each builder's brief from the review's file:line evidence.

| Release | Role | Agent and model | Owns |
|---|---|---|---|
| all | Overseer (UX/UI and design systems) | `overseer`, fable, high | read-only |
| 1 | Builder R1 | `builder`, sonnet | styles/*.css, library.css, the R1 TSX files, the guard test |
| 2 | Builder 2A (shell) | `builder`, sonnet | Home, Chat drawer/top bar, TodoPanel, TodoFiles, TodoForms, App, Icon, AskedList, TodoHistory, their CSS, design-system.md |
| 2 | Builder 2B (apps and tools) | `builder`, sonnet | apps/projects/*, apps/shared/*, apps/documents, apps/images, tools/ad-manager/*, their CSS, help/*.md |
| 2 | Builder 2C (Undo) | `builder`, opus — reason: data integrity (held deletes that must not double-send or lose an item) | `shell/UndoLine.tsx`, store.tsx, ChatsDrawer.tsx, TodosDrawer.tsx, SheetNotices, the held-file code in parts.tsx |
| 3 | Builders 3A / 3B | `builder`, sonnet | 3A: shell/, components/, eager styles; 3B: apps/, tools/, their CSS (new shared pieces built first by 3A) |
| 4 | Builders 4A / 4B | `builder`, sonnet | split by stylesheet |
| per release | Reviewers | `reviewer`: correctness opus high; UI and accessibility sonnet medium; code quality opus high | read-only |
| final | Design, layout and UX/UI critique | `expert`, fable, high | read-only, repeated until satisfied |

## Tests

| Test | Proves | Release |
|---|---|---|
| `client/src/styles/design-system.test.ts` | drift counts never rise; B1/B2/B3/tick rules | 1, tightened 2–4 |
| `TodosDrawer` held row test | Undo clock pauses on focus and pointer | 2 |
| `UndoLine` test | 10 s, pause/resume, undo cancels the send, expiry sends once | 2 |
| store chat-delete test | held chat delete sends once after the Undo time; Undo sends nothing | 2 |
| `Home` test | pinned to-do click opens the panel, never creates a chat | 2 |
| `ChatsDrawer` tests | New chat in the row; End chat icon/label; delete → Undo | 2 |
| existing suites | nothing else regressed (`pnpm check`) | all |

## Gates (every release)

- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build`
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`, every file checked
- [ ] UX/UI gate: UI/accessibility reviewer + the final expert critique
- [ ] Browser check on the preview (`/tmp/tba-preview-ux-consistency/`, port 3878, own `TDS_BRAIN_APP_DATA`)

## Review outcomes

(filled as each release lands)
