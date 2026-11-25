# Home card and button library

Date: 2026-11-25 · Size: L · Branch: `home-card-library` · Explainer: none · Mock-up: `docs/home-library-prototype.html`

## Objective

Let each person choose what their Home shows: hide or show each card and button, and add up to six shortcut buttons of their own (a skill, a tool, a place or a drawer). Some people want a busy Home, some a quiet one; today everyone gets all seven cards.

## User decisions (fixed)

- "Buttons" means both: existing Home buttons (Start my day, What's new) can be hidden, and people add their own shortcut buttons.
- Each person sets up their own Home. No team default layout.
- This round: evaluate and plan, then stop for the owner's go-ahead before any build.
- Base branch: `main`.

## Facts (checked in code)

- Cards: Meetings, Ads approvals (only while something waits), Pinned tasks, Recent projects (only when projects exist), Pinned chats, Pinned files, Pinned skills (`client/src/shell/Home.tsx:110`, `:253-264`). Start my day shows only if the `gm` skill exists (`:339`). What's new sits above the composer (`:352`).
- Card order: drag grips and keyboard moves in `useCardOrder.tsx`, saved in localStorage per person (`state/card-order.ts`). A card left out of the list keeps its saved place (`card-order.ts:47-55`); the grip's "n of total" counts only cards shown (`useCardOrder.tsx:141`).
- An older server refuses any pref key it doesn't know with a 400 (`server/http/routes.ts:573`). An older `sanitise` keeps only keys it knows (`server/store/app-store.ts:163`), so a downgrade drops new fields.
- `updatePrefs` waits for the server before Home changes (`store.tsx:1222-1232`). `loadBootstrap` replaces prefs without `keepStars` (`store.tsx:661-664`), so a brain-changed reload can undo a choice still being saved.
- `useFavouriteList` only takes `string[]` fields (`state/favourite-list.ts:5`).
- The right Dock shows when `panelOpen && liveOnSheet` (`state/shell.ts:312`); `panelOpen` is one saved flag shared with "This chat".
- Tour step `cards` anchors on `.home-tray .card-head` (`tour/steps.ts:117`), `TOUR_VERSION = 2`.
- Switches apply at once (`docs/design-system.md:140`); hide/show is "easily put back" (Actions rule 4, `:212-220`): status line, no Undo line.

## Decisions

Overseer pre-review (2026-11-25) changed decisions 1, 2, 4, 12-17 and added 18-21; noted inline.

1. **A "Customise Home" side panel, no edit mode, opened from the top-right panel icon.** Home's `SheetBar` gets `panel="Customise Home"`, the same icon toggle every sheet uses (`docs/design-system.md:136`, `PanelToggle.tsx`), wired to the Home flag (decision 15). The panel opens in the right Dock; Home stays visible and changes live. *(Overseer: was a tray-foot button, which broke the "toggles are icons, top right, always" rule.)*
   Plain: the Customise button sits top right like every other panel button, and Home updates as you flip switches.
2. **Two panel sections.** "Cards and buttons": one `.switch` row per item a person can ever see, in Home's order, with a hint under the ones that only show sometimes. No `gm` skill → no Start my day row; no Ads access → no Ads approvals row. "Shortcuts": the person's shortcuts, each with an X "Remove {name} from Home", and an "Add a shortcut" `+` opening a grouped popover.
   Plain: one list for what's on Home, one for your own buttons, and no switches for things you'd never see.
3. **Never removable:** greeting, summary line, the message box, Working on, New chat.
   Plain: Home always lets you start work, however much you hide.
4. **Everything on by default**, for existing and new people. No migration: an absent field reads as `[]`. The one visible change for everyone: with an odd number of cards, the last card now fills the row (decision 13).
   Plain: nobody's Home loses anything after the update; a lone last card just gets wider.
5. **Saved in `AppPrefs`** as `homeHidden` and `homeShortcuts` (contract Part 1), cleaned on read and validated on PUT, following recipe 3 in `docs/customising-home.md`. Hidden ids are checked by pattern on the server, closed list on the client, so a newer app's ids survive an older server. Card order stays in localStorage.
   Plain: your setup is kept with your app, not just one browser tab.
6. **Older-server guard.** If `boot.prefs.homeHidden === undefined`, the server is older: no Customise Home toggle (so no 400s).
   Plain: if the app's background part hasn't updated yet, the button waits rather than failing.
7. **Optimistic saves.** Generalise `useFavouriteList` into a list-pref save engine that accepts `homeHidden` and `homeShortcuts`, applies at once, and lets the newest choice win. `loadBootstrap` ignores a list from any bootstrap begun before that list's newest save (reach `keepStars` through a ref: it is declared after `loadBootstrap`, `store.tsx:658` vs `:961`). *(Overseer: `keep` alone only protects a save in flight.)*
   Plain: switches feel instant and never flip back on their own.
8. **Shortcut kinds: skills and tools only in v1** (owner, 2026-11-25, on the overseer's advice). Skill: `startSkill` opens the skill ready, doesn't run it. Tool: `openTool`. Places (Projects, Documents, Images) and drawers (Tasks, Chats) are left out because they are already one click on the rail; they can come later. Label is the target's own name, no renaming, max 6, `gm` left out of the add list.
   Plain: shortcuts are for skills and tools, which take several clicks today, and you can't add the same thing twice.
9. **Start my day is a Home item, not a stored shortcut.** It sits first in the shortcut row, runs at once as today, is a switch under "Cards and buttons", hidden through `homeHidden`, and does not count towards the 6.
   Plain: six of your own shortcuts, plus Start my day, which works exactly as now.
10. **Missing targets.** A shortcut whose skill or tool is gone hides on Home and shows "No longer in your Brain" with Remove in the panel. The server never removes it (a skill can come back). Tools show nothing until the ads list has loaded, then "gone" only if truly absent.
    Plain: losing access to something never breaks Home, and it comes back if access does.
11. **Keep Pinned skills.** The star also drives the Skills drawer's Favourites. In the add list an already-pinned skill shows "Also in Pinned skills".
    Plain: your pinned skills stay where they are; shortcuts are the one-click buttons at the top.
12. **Tray foot.** When cards are hidden: "N cards hidden." with a "Show hidden cards" button that opens the panel. "Reset card order" stays as it is. *(Overseer: Customise Home itself moved to the top-right icon.)*
    Plain: you can always see that something is hidden and get it back.
13. **No gap in the grid, on Home only.** A lone last card spans both columns, set from Home's own count of shown cards (a `data-` attribute or class), not `:last-child`, because the drag placeholder is also a child and `.tray` is shared with Ad Manager and Projects.
    Plain: a last card on its own fills the row, on Home only.
14. **"Show everything again"** at the panel foot: clears `homeHidden` only, at once, no confirm (it's easily put back). Shortcuts are removed one by one; card order untouched. *(Overseer: was "Put Home back as it started" behind a confirm, which over-promised and deleted shortcuts.)*
    Plain: one click brings every card back and never deletes your shortcuts.
15. **Separate shell flag `homeCustomiseOpen`**, unsaved, so the Dock shows on Home without touching `panelOpen`. Every path that closes the panel clears it: `set-panel` false, give-way and fit-to-width (`state/shell.ts:268-287`), the veil (`App.tsx:243`), Esc when floating (`state/keys.ts:36`), and leaving Home. A docked panel is not closed by Esc (as This chat today). *(Overseer: under-scoped before.)*
    Plain: the panel closes when it should and never squeezes Home.
16. **Keep `Home.tsx` in one piece.** Add the registry `client/src/shell/home-items.ts`, pure logic `client/src/state/home-layout.ts` and the panel `client/src/shell/CustomiseHome.tsx`. No card-body split: a card left out of `useCardOrder`'s list is already not drawn (`useCardOrder.tsx:215`). *(Overseer: smaller v1.)*
    Plain: less code churn, same result for people.
17. **Narrow windows: no new sheet.** The Dock already floats over the page under 1100px (`styles/shell.css:523-554`). Home is dimmed then, so the status line announces every change.
    Plain: on a small window the panel slides over Home, as This chat does.
18. **Tour, help and docs.** The `cards` tour step anchors on the panel toggle and mentions Customise Home; `TOUR_VERSION` 2 → 3 with a third `TOUR_HISTORY` line (`tour/steps.ts:4`). This replays the whole tour once for everyone. Add a Help section; update `docs/design-system.md` (new pieces from the mock-up) and `docs/customising-home.md`.
    Plain: everyone sees the tour once more after the update, and the help explains the feature.
19. **Downgrade cost, announced.** An older app drops both fields on its next settings save (`server/store/app-store.ts:163`).
    Plain: going back to an older version forgets your Home set-up; everything shows again.
20. **Skip work for hidden cards.** Don't fetch pinned files while that card is hidden (`Home.tsx:217`).
    Plain: a quieter Home loads a little less.
21. **Two tabs: leave for now** (same gap as favourites); add it to Known gaps in `docs/customising-home.md`.
    Plain: with two tabs open, the last change wins.

## Copy (UK English)

Customise Home (icon `aria-label`, hover tip and panel title) · "Choose what shows on your Home. Only you see this." · Cards and buttons · Shortcuts · Add a shortcut · "Shows only while an Ads change waits for you. You'll still find it in Ads Manager." · "Shows once a project has been worked on." · "N cards hidden." / Show hidden cards · Show everything again · "Your Home has no cards. Customise Home to add some." · "Add a shortcut to start a skill or open a tool in one click." · "You have 6 shortcuts. Remove one to add another." · "No longer in your Brain" · Status: "Pinned files hidden from Home", "Pinned files shown on Home", "Ads Manager added to Home", "Ads Manager removed from Home", "Every card is back on Home".

## Open questions

Resolved by the overseer: Start my day doesn't count towards 6 (9); two tabs left (21); Settings tab later; lone-card span on Home only (13). Owner decided shortcut kinds: skills and tools only (8).

## Contract

`docs/plans/2026-11-25-home-card-library-contract.ts`

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A (first) | `builder`, sonnet | recipe 3 exists; shape checks only | `shared/contract.ts`, `server/store/app-store.ts` (+test), `server/http/routes.ts` (+test), new `server/http/prefs-routes.test.ts` |
| Builder B | `builder`, opus | hard list: concurrency and data integrity (optimistic save engine, stale-bootstrap race, shell close paths) | `client/src/state/favourite-list.ts` (or new `pref-list.ts`), `client/src/store.tsx`, new `client/src/store.homeLayout.test.tsx`, `client/src/state/shell.ts` (+`shell.test.ts`), `client/src/state/keys.ts`, `client/src/shell/contract.ts`, `client/src/shell/ShellProvider.tsx`, `client/src/shell/SheetBar.tsx`, `client/src/shell/PanelToggle.tsx`, `client/src/App.tsx` |
| Builder C | `builder`, sonnet | default (UI) | `client/src/shell/home-items.ts`, `client/src/state/home-layout.ts` (+test), `client/src/shell/Home.tsx`, `client/src/styles/home.css`, `client/src/shell/Home.test.tsx` |
| Builder D | `builder`, sonnet | default (UI) | new `client/src/shell/CustomiseHome.tsx` (+test), new `client/src/styles/customise-home.css` + its import in `client/src/main.tsx`, `client/src/tour/steps.ts` (+`steps.test.ts`, `Tour.test.tsx`), `help/` Home page, `docs/design-system.md`, `docs/customising-home.md` |

A runs first; B, C and D then run in parallel against the contract. B exposes `openCustomiseHome`/`homeCustomiseOpen` (contract Part 4) and the Dock slot; D supplies the panel component B mounts.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/store/app-store.test.ts` | old file reads `[]`; junk and repeats dropped; unknown id matching the pattern kept; unknown kind dropped; capped at 6 | A |
| `server/http/routes.test.ts` | `validatePrefsPatch` 400s on each bad shape and on 7 shortcuts | A |
| `server/http/prefs-routes.test.ts` | through the real request gate (`createAppServer`, cookie as `ads-routes.test.ts:38-41`): PUT `/api/prefs` with JSON → 200, then GET returns both | A |
| `client/src/store.homeLayout.test.tsx` | hide applies before the save returns; quick double toggle keeps the newest; a bootstrap begun before a save and landing after it doesn't undo it | B |
| `client/src/state/shell.test.ts` | `set-panel` false, give-way, fit-to-width and leaving Home all clear `homeCustomiseOpen`; `panelOpen` untouched by opening Customise Home | B |
| `client/src/state/home-layout.test.ts` | each shortcut kind resolves to ready, waiting or gone; choices leave out `gm` and duplicates; "Also in Pinned skills"; rows only for items a person can see | C |
| `client/src/shell/Home.test.tsx` | hidden card disappears; grip says "1 of 5"; saved order survives hide and show; hidden Start my day stays hidden; `homeHidden` undefined → no toggle; tray foot count; lone-card span | C |
| `client/src/shell/CustomiseHome.test.tsx` | focus to heading on open; switch names and hints; Add disabled at 6 with hint; Remove moves focus; Show everything again | D |
| `client/src/tour/steps.test.ts`, `Tour.test.tsx` | pass with the new anchor, version 3 and history line | D |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (`pnpm check`, port 3124)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: UX/UI expert (against `docs/design-system.md` and the mock-up); security light-touch on the new prefs validation (input from the browser)
- [ ] Browser check: Home wide and narrow, panel open/close, hide all, add 6, reset; demo mode on 3878 per project rule

## Review outcomes

Build: Builder A (Sonnet) server and contract; B (Opus) save engine and shell; C (Sonnet) Home and logic; D (Sonnet) panel, tour, help, docs. Lead: test-kit and tour fixtures, Help split into its own page (`help/customise-home.md`, word limit), What's new moved to 0.85.0 (main released 0.84.0 meanwhile).

- **Security (Opus):** no findings. Tampered prefs can only hide items or add a button for a skill or tool the person can already use; extra fields are stripped on save.
- **Correctness (Opus):** 1 confirmed. A bootstrap begun before a save, landing while a later save waited, became the "saved" list, so a failed save fell back to a stale list and undid a confirmed hide (also affected favourites). Fixed in `pref-list.ts` `keepBoot`, test `pref-list.test.ts` (seen failing first). Untested wiring it named now has tests: `PanelToggle.test.tsx`, leaving Home in `ShellProvider.help.test.tsx` (checked by breaking the code: the test fails).
- **UX/UI expert (Opus):** no WCAG failures. Confirmed and fixed: "Also in Pinned skills" never showed (pins not passed); waiting/gone tool shortcuts showed the raw id (now the tool's own title, meta "Tool"); Add opened an empty menu when nothing was left (now disabled with a hint); shortcut row is a named `<ul aria-label="Shortcuts">`; Remove has a short tip; redundant Start my day hint dropped; design-system doc matches the lone-card selector. Dropped: "Close customise home" lowercasing (shared Dock behaviour for every panel; reads the same aloud).
- **Drift and copy (Sonnet):** all 21 decisions built. Fixed: What's new said nothing changes, but a lone last card now fills the row. Dropped by decision: the hidden count includes a hidden Ads approvals card on days nothing waits (that is the point of the line, risk R1).
- **Browser check (lead, demo mode, 1440 and 900 px):** toggle opens the panel with focus on its heading; hiding, the foot count, a shortcut added and shown, lone last card spans the row, all kept after reload with the panel closed; narrow floats over Home, Esc closes and focus returns to the toggle; no console errors.
- **Gates:** `pnpm check` green (6401 tests, lint, typecheck, build). Large-deletion scan: only `favourite-list.ts` (logic moved to `pref-list.ts`, intended).
