# Shell layers: the app as a piece of software

Date: 2026-11-11 · Size: L · Branch: `app-look-refresh` · Explainer: `docs/shell-explainer.html` (local file, built after the pre-review)

## Objective

Rebuild the app's frame so it looks and behaves like a piece of software, not a web page: an icon
rail, drawers that push the work over, a raised sheet where the work happens, a right-hand panel
for detail, and frosted overlays. The approved look is `docs/shell-prototype.html`; this plan builds
it into the real client. Nothing about what the app can do, or how it talks to the brain, changes.

## User decisions (fixed)

- The look and layout are the approved prototype, `docs/shell-prototype.html`. "Tune as we go."
- Simple, effective UI/UX comes first. No brand motifs worked into interface elements (the slanted
  "needs you" strip was rejected). Brand shows through colour, type and the logo mark only.
- App slots: the framework exists, but nothing shows on the rail until a real app exists.
- Light look first. Dark mode is a follow-up.
- Local only: no pushes, nothing published, nothing in `~/agencybrain`. The brain must not be read
  from or written to by this work; previews and tests use the fake brain in `test/fixtures/brain`.
- No commit until Ian asks.
- Status colours stay: ready green, asking amber, working red.
- The app must ask for approvals no more often than Ian's terminal (unchanged by this work).
- UK English in everything a person reads; US English in code.

## Decisions

1. **Client only.** No change under `server/` or `shared/`. `AppPrefs.todoPanelOpen` stays in the
   contract and on disk but the client stops reading it; its Settings toggle goes.
   Plain: how the app reads the brain, signs you in and runs chats is untouched, so this can't break them.

2. **Five layers, in one flex row.** `.desk` (tinted background) holds, left to right: `Rail`, left
   `Dock` (drawer), `main.sheet`, right `Dock` (panel). Overlays (`Palette`) sit above. The sheet is
   the only solid white surface; the rail and docks are frosted (`backdrop-filter`), with a solid
   fallback under `@supports not (backdrop-filter: blur(1px))` and under
   `@media (prefers-reduced-transparency: reduce)`.
   Plain: where you are working is the one bright, raised surface, so it reads as the front layer.

3. **Shell state is separate from the data store.** A pure reducer in `client/src/state/shell.ts`,
   held by `ShellProvider` (`client/src/shell/ShellProvider.tsx`) and saved to `localStorage` under
   `tds-brain-shell` (rail wide or not, open drawer, panel open, panel tab, single keys). Storage
   failures are ignored. A saved drawer is reopened on load only when the window is wide enough for it
   to push (`dockModes`), and without moving focus. `store.tsx` changes only its `View` type
   (decision 4) and one line of wording (decision 18).
   Plain: the app remembers how you left the rail, drawers and panel, per browser, and forgets nothing if storage is blocked.

4. **Views shrink to two; lists become drawers.** `View` becomes `'chat' | 'settings' | \`app:${string}\``.
   Home is `view === 'chat'` with a new (unsent) chat; a live chat is the chat sheet. Skills, To-dos
   and History stop being pages: Skills and To-dos are drawers, and History is the "Earlier" list in
   the Chats drawer. The old right-hand to-do panel and the top bar with its Menu button go.
   Plain: you never leave your work to look at a list; the list slides in beside it.

5. **Rail.** `nav` with: the mark and "TDS Brain"; Home (`newChat()`), Chats, To-dos, Skills; an
   "Apps" group rendered only when `APPS` is non-empty; then the rail toggle, Settings, and the
   person (initials, name, role). 60px icons-only or 212px with names. Icons-only buttons carry
   `aria-label` and a tooltip. Drawer buttons carry `aria-expanded` and `aria-controls`; Home and
   Settings carry `aria-current="page"` when showing. Chats shows a dot in the most urgent open
   chat's status colour and a count of open chats; To-dos shows the count of mine. While a drawer is
   open the rail stays as the person set it. **While the right panel is showing, the rail is held at
   icons only** to give the sheet more room, and returns to the person's setting when the panel
   closes (Ian, 2026-11-11). It is a hold, not a change of preference; using the rail toggle while
   held shows the names again until the panel closes.
   Plain: one slim strip gets you everywhere, and can shrink to icons to give the work more room.

6. **Left drawers** (316px, one at a time, push the sheet). `App.tsx` mounts one left `Dock`; the
   drawer components render its body only. Opening moves focus to the drawer's heading; closing
   (close button, Esc, or the rail button again) returns focus to the rail button that opened it.
   The dock is an `aside` named for its content, and `inert` while closed.
   - **To-dos:** `Seg` "Mine, N" / "Open to anyone, N"; `Fold` groups Overdue, Today, This week,
     Later, No date (`groupTodos`, by `due`); rows keep today's behaviour exactly: tick box only
     when `prefs.directWrites` is on, "Open chat" when a chat exists for the to-do, else start one.
     The line about other people's to-dos (`othersCount`) stays.
   - **Chats:** "New chat" button; `Seg` "Open, N" / "Earlier". Open rows show the status dot and
     words and a close button (`requestClose`); Earlier rows are `sessions.past` and call `openPast`.
   - **Skills:** search field; `Fold` groups Pinned, Used often, All skills; each row starts the
     skill, has a pin toggle, and shows "Still being tested" for drafts, as now.
   Starting or opening a chat from a drawer leaves the drawer open (the sheet changes beside it).
   Plain: the three lists you reach for most open beside your work and nudge it over rather than covering it.

7. **Home (the light dashboard).** Shown for a new chat. The sheet bar holds the page's `h1`,
   "Home"; below it the greeting (large, not a heading), one summary sentence, the
   composer (existing `Composer`, with the client `select` and the skill banner), then a recessed
   tray of three raised cards: **Needs you** (count pill, up to 4 to-dos that are overdue or due
   today or tomorrow, a "N more to-dos" row that opens the drawer), **Open chats** (up to 4, most
   urgent first), **Pinned skills** (up to 5; titled "Used often" when nothing is pinned). Card
   headers have "All to-dos / All chats / All skills" buttons that open the drawer. Empty states are
   one plain line each; with nothing due, Needs you says so and offers "See all N to-dos". `/clear`
   typed on Home just empties the box, as now. No attach button and no other control without a
   feature behind it.
   Plain: opening the app shows what needs you and lets you start typing straight away.

8. **Chat sheet.** A top bar: "Chats / <title>", the client as a chip, Stop (while working), the
   panel toggle, and Close chat. The close confirm (`close-confirm` fieldset, focus handling) is
   kept, and its Esc handler now calls `preventDefault()` (decision 11). Under the thread sits the
   floater: a frosted strip holding the pending card, the status line (`AttentionBar`) and the
   composer. It is a flex child below the thread, not positioned over it, so it can't clip a tall
   card or cover focused content (WCAG 2.4.11). **The pending approval or question card moves out
   of the thread into the floater** as amber glass, scrolling inside itself past half the sheet's
   height. `Transcript` skips every unanswered card and the floater shows the first; an answered
   card shows in the thread as the record, as now. After an answer, focus goes to the next pending
   card, else the composer. The "What Claude did" groups stay in the thread unchanged. "Continue in
   the terminal" moves to the panel's Details tab.
   Plain: when Claude needs a yes, the question sits right above where you type instead of scrolling away.

9. **Right panel "This chat"** (332px, pushes; only offered on a live chat). `Seg` tabs **Steps**
   (every step in the chat, numbered, with status; helpers' steps indented; `stepsOf`) and
   **Details** (client, to-do, started, state, the approvals sentence from
   `approvalsSentence(engine.permissionMode)`, and for owners and scouts the `claude --resume` line).
   **No Files tab yet:** the server sends step labels with file base names only, so a file list
   would be guesswork. It comes back when the server sends paths (a server change, out of scope).
   Plain: detail about the chat sits to the side when you want it, and there is no tab that shows nothing.

10. **Command palette** (overlay). Opens with Cmd+K or Ctrl+K and from a "Search or jump to" button
    in the sheet bar. `role="dialog"`, `aria-modal="true"`, a combobox input with a listbox of
    grouped options (`paletteGroups`): Go to, Open chats, Run a skill, Start a chat on a to-do.
    Up/Down move, Enter runs, Esc or a click on the veil closes, Tab stays inside, focus returns to
    where it was. Frosted, over a dimming veil.
    Plain: one shortcut finds any skill, chat or to-do without touching the mouse.

11. **Keys.** `keyAction` (pure): Cmd/Ctrl+K palette; Esc shuts the palette, else closes the drawer.
    The one global listener ignores events already handled (`defaultPrevented`), so Esc on the
    chat's close confirm cancels the confirm and leaves the drawer open: one thing per press. Esc does not
    close a panel that is pushing (it is a side panel, shut with its toggle or close button); a dock
    that is floating over the work is modal and Esc closes it (the `Dock` handles that itself). `[` rail, `T` To-dos, `C`
    Chats, `S` Skills only with no modifier, outside text fields, palette shut. A Settings switch
    "Single-key shortcuts" turns the letter keys off (WCAG 2.1.4, Character Key Shortcuts).
    Plain: keyboard users move fast, and anyone the letter keys trip up can switch them off.

12. **Tokens, type and icons.** `tokens.css` takes the prototype's `:root` (navy
    `#021B43`, blue `#1889FF`, `--blue-ink #0B5CB5` for text and focus, desk, tray, glass, three lift
    shadows, one easing, 240ms) and keeps today's `--attn-*`, `--attn-*-edge`, `--field-edge`, amber
    and danger tokens: the prototype's own green and amber dots are only about 2.4:1 and 2.1:1 on
    white, so status dots and edges use the deeper `-edge` shades. Buttons keep `data-variant` and
    `data-size` (no `.btn.primary`). `color-scheme: light` only; the dark block is removed until the
    dark follow-up. Fonts are bundled, never fetched: `@fontsource/poppins` (500, 600; headings) and
    `@fontsource-variable/inter` (body), latin subset, with the system stack as fallback (the CSP is
    `default-src 'self'`). Icons are a local inline-SVG `Icon` component; no icon library. Navy
    primary buttons; blue for focus and selection only. Text on glass must reach 4.5:1 against the
    darkest desk tint; text-bearing glass uses `--glass-strong`.
    Plain: it carries the TDS colours and typefaces, loads with no outside requests, and stays readable.

13. **Motion.** Docks animate `width` and `opacity` over 240ms; the palette fades. All of it is off
    under `prefers-reduced-motion: reduce`. No entrance animation on content.
    Plain: things slide so you can see where they came from, unless you've asked your computer for less motion.

14. **The sheet never drops below 480px.** `dockModes(width, state)` decides push or overlay: the
    drawer overlays under 900px (under 1060px when the rail shows names); the panel overlays under
    1100px (under 1400px when a drawer is open). An overlaying dock is modal: a veil behind it, the
    rest of the desk `inert`, and Esc, the veil or choosing a row closes it. Under 900px the rail is
    icons-only. Nothing scrolls sideways at 360px.
    Plain: when there isn't room to push, a panel floats over the work instead of squeezing it thin.

15. **CSS is split by owner.** `main.tsx` imports, in order: `tokens.css`, `base.css` (type,
    buttons, fields, shared pieces: `.btn`, `.icon-btn`, `.chip`, `.count`, `.dot`, `.seg`, `.fold`,
    `.line`, `.todo`, `.glass`, `.card`, `.visually-hidden`), `shell.css` (desk, rail, dock, sheet,
    sheet bar), `drawers.css`, `home.css`, `palette.css`, `chat.css` (thread, floater, cards,
    settings, whole-app states). `app.css` is emptied into these and deleted at the end.
    Plain: each builder has their own stylesheet, so two people never edit the same file.

16. **App slots.** `client/src/shell/apps.ts` exports `APPS: AppSlot[] = []`. The rail lists them
    under "Apps" when there are any; the sheet renders `APPS.find(a => a.id === id)?.Sheet` for the
    view `app:<id>`. One test registers a fake app to prove the path. Nothing shows today.
    Plain: adding an app later means adding one entry, and until then the rail has no empty slots.

17. **What is kept exactly.** Skip link, `Announcer`, gate screens, the offline banner, error and
    notice lines, composer behaviour, `/clear`, close-chat rules, approval and question card
    behaviour and wording, the attention bar's wording and colours. Existing tests keep passing;
    a test changes only where this plan moves the thing it looks at, and is never weakened.
    Plain: everything you rely on today still works the same way; only where it sits has changed.

18. **Shared wording and sheet pieces live in one place** (wave 1). `shell/words.ts` holds
    `STATE_WORDS`, `ROLE_WORDS`, `todoChatDraft`, `whenWords` and `starterSkills`; `state/chats.ts`
    holds `sortChats`; `SheetBar` and `SheetNotices` (offline, error and notice lines) are mounted by
    the sheet, so every view shows them. The close notice in `store.tsx` becomes "Chat closed. It's
    under Earlier in Chats if you want it back."
    Plain: a status or date reads the same wherever it appears, a chat started from a to-do keeps its link, and no message names a page that has gone.

19. **Hidden means unreachable.** A closed dock is `inert`; the whole desk is `inert` under the
    palette and under an overlaying dock; the Chats rail button's accessible name states the status
    ("Chats, 2 open, 1 needs your answer").
    Plain: keyboard and screen-reader users never land in something they can't see.

## Contract

`client/src/shell/contract.ts`: shell state and actions, key handling, icon names, the shared
pieces' props (`Dock`, `Fold`, `Seg`), app slots, and the pure functions each builder owes
(`groupTodos`, `HomeLogic`, `paletteGroups`, `stepsOf`). Owned by the lead; a builder who needs it
changed says so in their report instead of editing it.

Unchanged and relied on: `Store` in `client/src/store.tsx` (apart from `View`), `Composer`'s props,
`shared/contract.ts`.

## Team and file ownership

Two waves. Wave 1 lays the frame and the shared pieces, removes the old pages, leaves compiling
stubs for the wave 2 files, and ends on a green `pnpm check`. Wave 2 runs in parallel. Three files
change hands between waves (marked); the waves don't overlap, so nobody edits a file at the same
time as anyone else. Wave 2 builders read the removed pages with `git show HEAD:<path>`.

| Role | Agent and model | Owns (files) |
|---|---|---|
| Overseer | `overseer`, fable, high | (read-only) |
| Lead | (me) | `client/src/shell/contract.ts`, `docs/plans/2026-11-11-shell-layers.md`; checks and finishes `docs/shell-explainer.html` |
| Builder A, wave 1: frame | `builder`, opus, high | `client/src/state/shell.ts`, `state/shell.test.ts`, `state/keys.ts`, `state/keys.test.ts`, `shell/ShellProvider.tsx`, `shell/Icon.tsx`, `shell/Rail.tsx`, `shell/Dock.tsx`, `shell/Fold.tsx`, `shell/Seg.tsx`, `shell/SheetBar.tsx`, `shell/SheetNotices.tsx`, `shell/words.ts`, `shell/words.test.ts`, `state/chats.ts`, `state/chats.test.ts`, `shell/apps.ts`, `shell/Shell.test.tsx`, `client/src/App.tsx`, `client/src/store.tsx` (the `View` type and the close notice only), `client/src/main.tsx`, `styles/tokens.css`, `styles/base.css`, `styles/shell.css`, `package.json`, `pnpm-lock.yaml`; deletes `components/Sidebar.tsx`, `Todos.tsx`, `SkillsView.tsx`, `HistoryView.tsx`; creates the wave 2 stubs and empty stylesheets. In wave 1 only: `components/Chat.tsx` (drop the new-chat branch's `openView('skills')`, add `preventDefault()` to the close confirm's Esc), `client/src/closeChat.test.tsx` (lands on Home), `styles/app.css` (move out or delete the button, shell, sidebar and list rules) |
| Builder B, wave 2: drawers | `builder`, sonnet, medium | `shell/TodosDrawer.tsx`, `shell/ChatsDrawer.tsx`, `shell/SkillsDrawer.tsx`, `shell/drawers.test.tsx`, `state/todo-groups.ts`, `state/todo-groups.test.ts`, `styles/drawers.css` |
| Builder C, wave 2: home and palette | `builder`, sonnet, medium | `shell/Home.tsx`, `shell/Home.test.tsx`, `state/home.ts`, `state/home.test.ts`, `shell/Palette.tsx`, `shell/Palette.test.tsx`, `state/palette.ts`, `state/palette.test.ts`, `styles/home.css`, `styles/palette.css` |
| Builder D, wave 2: chat sheet, panel, settings | `builder`, opus, high | `components/Chat.tsx`, `components/Chat.test.tsx`, `components/Transcript.tsx`, `components/AttentionBar.tsx`, `components/Cards.tsx`, `components/Cards.test.tsx`, `components/Composer.tsx` (markup and class names only; props fixed) and every `.composer` style rule, `components/SettingsView.tsx`, `components/Gates.tsx`, `client/src/closeChat.test.tsx`, `shell/Inspector.tsx`, `shell/Inspector.test.tsx`, `state/steps.ts`, `state/steps.test.ts`, `styles/chat.css`, `styles/app.css` (moves its remaining rules out, then deletes it and its import line in `main.tsx`) |
| Explainer | `builder`, sonnet, medium | `docs/shell-explainer.html` (draft; the lead checks it) |
| Reviewers | `reviewer` ×3: correctness (opus, high), UI and accessibility (sonnet, medium), requirement drift and copy (sonnet, medium) | (read-only) |
| UX/UI gate | `expert`, opus, high | (read-only) |

No file appears in two rows. Paths without a folder prefix are under `client/src/`.

## Tests

Tests first for every pure function.

| Test file | Proves | Owner |
|---|---|---|
| `state/shell.test.ts` | Opening a drawer closes the other; toggling the open one closes it; `loadShell` survives null, bad JSON and wrong types; `saveShell` never saves `paletteOpen`; `dockModes` at each breakpoint, one pixel either side | A |
| `shell/words.test.ts`, `state/chats.test.ts` | `todoChatDraft` contains `todo/<id>`; `whenWords` on a good and a bad date; `starterSkills` drops unknown names; `sortChats` order | A |
| `state/keys.test.ts` | Cmd+K and Ctrl+K toggle the palette even while typing; Esc order (palette, then drawer); letter keys ignored while typing, with a modifier, with the palette open, or when switched off | A |
| `shell/Shell.test.tsx` | Rail toggle flips names and `aria-label`s; a drawer button sets `aria-expanded`, moves focus in, and Esc returns focus to it; a closed dock is `inert`; an Esc already handled (`defaultPrevented`) leaves the drawer open; a fake `APPS` entry shows on the rail and renders its sheet, and an unknown `app:` id shows Home | A |
| `state/todo-groups.test.ts` | Overdue, today, tomorrow, day 7, day 8 and no-date land in the right groups; order kept; empty groups dropped | B |
| `shell/drawers.test.tsx` | No tick boxes when `directWrites` is off; ticking calls `completeTodo`; "Open chat" appears for a to-do with a live chat; Earlier rows call `openPast`; skill search filters; pin toggles | B |
| `state/home.test.ts` | `needsYou` rows, count and more; greeting at 11:59, 12:00, 17:59, 18:00; every `summary` wording including singular, plural and nothing | C |
| `state/palette.test.ts` | Empty query defaults; multi-word and case-insensitive match; six per group; empty groups dropped | C |
| `shell/Home.test.tsx` | Cards render from boot data; sending from Home calls `send` with the chosen client; `/clear` is never sent; a chat started from a to-do row keeps its `todoId`; "All to-dos" opens the drawer | C |
| `shell/Palette.test.tsx` | Opens focused; arrows and Enter run the option; Esc closes and focus returns; Tab stays inside; the desk is `inert` while it is open | C |
| `state/steps.test.ts` | Steps flatten in order with helpers nested at depth 1+ | D |
| `shell/Inspector.test.tsx` | Tabs switch; resume line only for owner and scout; panel absent on Home | D |
| `components/Chat.test.tsx`, `Cards.test.tsx`, `closeChat.test.tsx` | Existing behaviour holds; a pending card renders once, above the composer, and moves to the thread when answered; with two pending, the first shows and focus moves to the second after an answer, then to the composer | D |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build: `pnpm check` (no server writing to `dist/` while it builds)
- [ ] Domain gates: UX/UI expert critique (layout, hierarchy, accessibility against WCAG 2.2 AA). Security: none new (no server change; CSP unchanged; fonts bundled).
- [ ] Browser check, on the fake brain at port 3878: Home; each drawer open and closed; rail both widths; a live chat with the panel on each tab; a pending approval; the palette; Settings; 1280px, 1000px and 400px wide; keyboard only; reduced motion.

## Review outcomes

**Overseer pre-review (2026-11-11).** Two blocking points, both confirmed in code and folded in:
wave 1 could not have ended green (narrowing `View` broke `Sidebar.tsx`, `Chat.tsx` and
`closeChat.test.tsx`), so wave 1 now removes the old pages and takes those edits; and wave 2 would
have invented shared wording and sheet pieces three times, so they moved into wave 1 and the
contract (decision 18). Its other rulings are in decisions 3, 8, 11, 12, 14, 16 and 19: move the
pending card now, as a flex child; drop the Files tab; keep the `APPS` registry; persist the drawer;
hold the sheet at 480px; keep the "Needs you" rule; Builder D on opus.

**Build (2026-11-11).** Two waves, four builders, files kept disjoint. Final gates: type-check
clean, lint clean, 42 test files and 398 tests pass, nothing changed under `server/` or `shared/`.
The client was built to a scratch folder only, because the running app serves `dist/client`.

**Lens reviews.** Every finding was checked in code before it went back to the builder who owned
the file.

- *Correctness (opus).* Confirmed: between 1100 and 1399px, a drawer plus the panel switched off the
  rail, the sheet and the drawer itself (fixed with the give-way rule: the one opened last stays);
  Esc did not close a floating panel; holding a shortcut key down flickered a drawer open and shut.
  Plain: on a laptop-width window the app could lock up with two side panels open.
- *UI and accessibility (sonnet).* Confirmed: folds never folded (a `display: grid` rule beat the
  `hidden` attribute); shortcut hints were announced with single keys switched off; the sheet bar
  overflowed on narrow sheets; the question card's option styles leaked into the palette; the
  icons-only rail lost its to-do count; the message box looked editable while Claude was working.
  Dropped: making the rail tooltip close on Esc (it cannot be hovered and the button has a name).
- *Drift and copy (sonnet).* Confirmed: the palette showed folder slugs and unsorted to-dos;
  "Untitled chat" where the rest of the app says "New chat"; Inter shipped seven language subsets
  (now Latin only); stray separators and capitals in meta lines; dead rules for removed pages.
- *UX gate (opus).* Confirmed: the close-chat confirm appeared on a switched-off sheet when the
  Chats drawer was floating; long Approvals wording in the panel. Dropped: middle-dot separators in
  meta lines (a comma reads better and is less template-like).
- *Design-system audit (opus).* The interior screens had been moved across with their old sizes.
  Outcome: `docs/design-system.md`, and every screen restyled to it.

**Ian's review of the first build (2026-11-11)** and what was done:

| His point | Outcome |
|---|---|
| Answer box doesn't fit the system | One amber-glass surface; nothing boxed inside it; focus ring on the surface |
| Interior pages: big checkboxes and type | 18px ticks, 32px buttons and fields, switches and hairline rows in Settings, seven type sizes |
| Hovers too subtle, no depth | Hover lifts (`--lift-h`), with a 1px rise on drawer rows and answer options |
| A little tighter | 48px sheet bar, 36px rail items, 30px fold headers, tighter rows and Home |
| Rail collapses when the right panel opens | Rail held at icons while the panel shows; the saved preference is untouched |

**Amendments to the decisions above.** Decision 5: the rail is held at icons while the right panel
shows. Decision 11: Esc does not close a pushing panel; a floating dock handles Esc itself.
Decision 14: between 1100 and 1399px a drawer and the panel no longer share the window; opening one
closes the other. Fold headers are 30px, not 44px (the whole header is the target).

**Lead's browser check (fake brain, 1240px wide).** Home, the three drawers, the palette, a live
chat with a question card (focus moves in, the answer is recorded, focus returns to the message
box), the panel's Steps and Details, the rail hold and release, Settings. No console errors.

**Not verified.** Windows under 900px are covered by unit tests only: the browser tool could not
resize the window. An approval card (as opposed to a question) was not seen live, because the
permission mode allowed the write without asking; the card tests cover it.

**Overseer sign-off (2026-11-11).** First pass: one blocker and four should-fix items, all confirmed
in code and fixed. Blocker: with the panel showing and the rail saved as icons, "Show names" did
nothing, because the rail was treated as held even when there was nothing to hold. Now the rail is
held only when names were chosen, and a press with the panel open shows the names and saves that
choice; a second press tucks them away until the panel closes. Should-fix: the to-do row's label hid
its due date and client from screen readers; Esc closed a floating panel only when the keyboard was
inside it; leaving a chat from inside the panel lost the keyboard's place (it now lands on the
sheet); the skill chip's remove button was under 24px. Second pass: **signed off**, 398 tests pass.
The five departures from the plan (rail hold, Esc on a pushing panel, give-way, 30px folds, chat
status in the to-do meta line) were each confirmed.

**Open before any commit.** Ian drags the window under 900px once, since that layout has only been
unit-tested.

## After sign-off: example apps (11 Nov, evening)

Ian asked for an example app to show the design system's flexibility, then a second one.

- `AppSlot` gained `BarActions`, `Panel` and `panelLabel`, so an app can put buttons in the sheet bar
  and fill the right panel. An app with a panel counts as "live on the sheet" for the rail-hold rule.
  Plain: an app can use the right-hand panel the same way a chat does.
- `client/src/apps/images` and `client/src/apps/documents`: sample data only, nothing read from a
  brain. Both sit on the tray-and-cards device (Ian's review of the first Images layout: too loose,
  not the app's card device; reworked). Shared pieces are in `client/src/apps/shared`.
  Plain: two pretend apps that prove a new app can be built from the existing parts.
- They are compiled in only when `VITE_EXAMPLE_APPS=1`; a normal build has neither (checked by
  searching a scratch build).
- Dock change that also helps chats: a floating panel (under 1100px) takes focus whenever it opens,
  however it came to open.
- Reviews of Documents and the shared pieces: correctness found that Hide on a folder card did nothing in a real browser (fixed, checked in the browser in both apps); UX found five points (fixed) and one dropped.
- Gates after both: type-check clean, lint clean, 48 test files and 451 tests pass.

