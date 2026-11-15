# TDS Cortex help, Phase 2: every page, the Cortex Guide, help in search, Settings links

Date: 2026-11-15 · Size: L · Branch: `cortex-help-phase-2` · Explainer: declined (programme decision)
Parent plan: `docs/plans/2026-11-15-tds-cortex-help.md`. Phase 1: `docs/plans/2026-11-15-cortex-help-phase-1.md`
(merged as v0.37.0). Standard: `docs/help-standard.md`. Contract: `client/src/help/contract.ts`.

## Objective

Every remaining feature gets its help page (39 new pages, 48 in all), the Cortex Guide sheet shows them all as a
printable book, ⌘K finds help pages, Settings rows get "?" links, and the Help drawer opens the right page on
every screen. Still **owners only** (`helpVisible`); the launch for everyone is Phase 3.

## Facts (2026-11-15, after v0.37.0)

- Phase 1 engine: `client/src/help/{library,context,render,checks,readability,topics,visibility}.ts`,
  `HelpArticle.tsx`, `help.test.ts`; drawer `client/src/shell/HelpDrawer.tsx`, `HelpLink.tsx`, `styles/help.css`.
  `HELP_TOPIC_IDS` (topics.ts) must list every page. `HELP_FREEFORM_AREAS = ['getting-started']`.
- `View = 'chat' | 'settings' | 'profile' | \`app:${string}\`` (`client/src/store.tsx:79`); `SheetContent` in
  `client/src/App.tsx:62` picks the sheet per view.
- ⌘K sources: `client/src/shell/search-sources.ts` (built-ins + per-app sources; Go to already has Help for owners).
- Settings (`client/src/components/SettingsView.tsx`): sections "Tokens saved" (new from start-up kits, v0.36.0),
  "Preferences" (Let the app change to-dos, Single-key shortcuts, Working out the client), "Claude in chats"
  (level mode, model, effort, skill levels), "About TDS Brain on this computer" (health, Dock app, version),
  "What's changed" (owners and scouts).
- Screenshots: `scripts/help-shots.ts` scenes + `help/shots.json`; demo engine `server/engine/demo-engine.ts`;
  seed `scripts/help-demo/brain/`. The health panel and setup screen show folder paths that contain the home
  path, so the privacy check would (rightly) refuse them: no pictures of those.

## Decisions

1. **Pages**: the 39 in the table below, each `help/<id>.md`, written to the standard. Pages in areas
   `getting-started` and `help` are free-form (no fixed headings); everything else uses the five headings.
2. **Free-form areas** become `['getting-started', 'help']`.
3. **Glossary** `help/glossary.md`: one `### Term` per word, then a one- or two-sentence plain meaning. The
   readability check leaves glossary terms out of the syllable count (terms parsed from `glossary.md`'s `###`
   lines), so a page that uses "skill" or "approval" isn't punished for a word the glossary explains.
4. **Context → page** (`context.ts`): add view `settings` → `settings`, `profile` → `your-profile`, `guide` →
   `cortex-guide`. Unchanged otherwise.
5. **Cortex Guide** (`client/src/shell/GuideView.tsx`, `styles/guide.css`): `View` gains `'guide'`; `SheetContent`
   shows it with `SheetBar title="Cortex Guide"`. Left: contents (area labels, then page titles, current one
   marked like a current row); right: the page (title h2, `HelpArticle`, then "Related" links). Under 900px the
   contents become a `SearchSelect`-style picker above the page (or a `Fold`; reuse an existing component).
   **Print** (`@media print` in guide.css): hide rail, docks, sheet bar and contents; print **every** page in order,
   each starting on a new page, pictures kept, links shown as text. A "Print the guide" button (`btn`, standard)
   sits in the sheet bar's actions and calls `window.print()`.
   Opened from: the Help drawer ("Open the Cortex Guide", quiet button under the search), ⌘K Go to ("Cortex Guide"),
   and Settings (a line in "About": "Read the Cortex Guide"). All owner-only for now. No rail item.
   Plain: the whole help as a book you can read or print.
6. **⌘K help results**: a new source "Help" (owner-only) after the built-ins: `helpLibrary.search(q, 5)`, each
   row title + summary, opening the Help drawer on that page.
7. **Settings "?" links**: a `HelpLink` beside these rows' labels: Let the app change to-dos → `change-todos-setting`;
   Single-key shortcuts → `keyboard-shortcuts`; Working out the client → `picking-the-client`; level mode →
   `levels`; skill levels → `skill-levels`; Tokens saved heading → `tokens-saved`; About heading → `health`;
   What's changed heading → `version-history`. In a row, `HelpLink` is 28px (the in-row size); add a `size` prop.
8. **Help drawer** gains the "Open the Cortex Guide" quiet button under the search box.
9. **New shots** (table below). Pages without a picture are fine: the standard asks for a picture where it helps.
   Reusing a Phase 1 picture is fine (same id, same alt).
10. **Demo engine** may grow only what scenes need (e.g. a context-meter reading); `demo-guard.ts` is not changed.

## Pages and shots

| Page id | Area | Title | Shot id (new unless marked) | Alt text |
|---|---|---|---|---|
| `why-cortex` | getting-started | Why TDS Cortex | — | |
| `a-day-with-cortex` | getting-started | A day with Cortex | — | |
| `brain-and-cortex` | getting-started | The Brain and Cortex | — | |
| `picking-the-client` | home | Picking the client | `home-start` (reuse) | The message box on Home, with the client picker set to Auto. |
| `pinned` | home | Pinned to-dos, chats and files | `home-overview` (reuse) | Home in TDS Cortex, with the message box, the client picker and your pinned cards. |
| `attaching-files` | chats | Attaching files | `attach-files` | The message box with two files attached, ready to send. |
| `what-claude-did` | chats | What Claude did | `chat-reply` (reuse) | A chat where Claude has replied, with the What Claude did fold. |
| `helpers` | chats | Helpers | — | |
| `levels` | chats | Levels: Quick, Standard and Deep | `level-line` | The level line in a chat, showing the level picked for this chat. |
| `how-full-a-chat-is` | chats | How full a chat is | `context-meter` | The meter that shows how full a chat is. |
| `this-chat-panel` | chats | The This chat panel | `chat-details` | The This chat panel on its Details tab. |
| `chat-files` | chats | Chat files | `chat-files` | The Files tab, listing what a chat made, changed and looked at. |
| `pages-claude-makes` | chats | Pages Claude makes | — | |
| `chat-kinds` | chats | TDS or Personal chats | `chat-details` (reuse) | The This chat panel on its Details tab. |
| `deleting-a-chat` | chats | Deleting a chat | `delete-chat` | An earlier chat about to be deleted, with the question that asks first. |
| `continuing-in-the-terminal` | chats | Continuing in the terminal | — | (roles: owner, scout) |
| `adding-todos` | todos | Adding and editing to-dos | `todo-add` | The form for adding a to-do, with a due date and who it's for. |
| `passing-todos-on` | todos | Passing a to-do on | `todo-edit` | Editing a to-do, with the Assigned to field. |
| `change-todos-setting` | todos | Letting Cortex change to-dos | `settings-todos-switch` | The Let the app change to-dos switch in Settings. |
| `sharing-with-your-team` | team | Sharing with your team | `todos-drawer` (reuse) | The To-dos drawer with the Mine tab open. |
| `favourites` | skills | Favourites | `skills-drawer` (reuse) | The Skills drawer with a favourite skill at the top. |
| `viewing-a-file` | files | Viewing a file | `file-viewer` | A document open in the viewer, with its download and open buttons. |
| `search-and-jump` | getting-around | Search or jump to | `palette` | Search or jump to, showing results for a search. |
| `keyboard-shortcuts` | getting-around | Keyboard shortcuts | — | |
| `settings` | settings | Settings | `settings-prefs` | The Preferences part of Settings. |
| `tokens-saved` | settings | Tokens saved | `tokens-saved` | Tokens saved in Settings. |
| `health` | settings | How Cortex is running | — | |
| `choosing-your-brain-folder` | settings | Choosing your Brain folder | — | |
| `updates` | settings | Updates and what's new | — | |
| `your-profile` | settings | Your profile | `profile` | Your profile, with your details from the Brain. |
| `dock-app` | settings | Adding Cortex to your Dock | — | |
| `skill-levels` | settings | Skill levels | `skill-levels` | The Skill levels list in Settings. (roles: owner, scout) |
| `version-history` | settings | Version history | — | (roles: owner, scout) |
| `getting-help` | help | Getting help | `help-drawer` | The Help drawer, open on the page for the screen you're on. |
| `cortex-guide` | help | The Cortex Guide | `guide-sheet` | The Cortex Guide, with the contents on the left and a page on the right. |
| `fixing-problems` | help | Fixing problems | — | |
| `glossary` | help | Glossary | — | |
| `signing-in` | getting-started | Signing in | — | |
| `personal-todos` | todos | Personal to-dos | — | |

## Builders (files each owns)

| Builder | Owns | Model |
|---|---|---|
| **E, Guide + search + links** (tests first for logic) | `client/src/help/{contract,topics,context,readability,checks,library}.ts` + tests, `client/src/shell/GuideView.tsx` (+test), `client/src/styles/guide.css`, `client/src/main.tsx` (import), `client/src/store.tsx` (View `'guide'` only), `client/src/App.tsx` (SheetContent + sheet-bar action), `client/src/shell/search-sources.ts` (+test), `client/src/shell/HelpDrawer.tsx` (Guide button), `client/src/shell/HelpLink.tsx` (`size` prop), `client/src/components/SettingsView.tsx` (+test: HelpLinks, Guide line), `docs/design-system.md` | Sonnet, medium |
| **F, shots** | `scripts/help-shots.ts`, `help/shots.json`, `help/images/*`, `scripts/help-demo/brain/**`, `server/engine/demo-engine.ts` (+test) | Sonnet, medium |
| **G1, writer** | `help/{why-cortex,a-day-with-cortex,brain-and-cortex,picking-the-client,pinned,sharing-with-your-team,favourites,viewing-a-file,search-and-jump,keyboard-shortcuts,getting-help,cortex-guide}.md` | Sonnet, medium |
| **G2, writer** | `help/{attaching-files,what-claude-did,helpers,levels,how-full-a-chat-is,this-chat-panel,chat-files,pages-claude-makes,chat-kinds,deleting-a-chat,continuing-in-the-terminal,fixing-problems}.md` | Sonnet, medium |
| **G3, writer** | `help/{adding-todos,passing-todos-on,change-todos-setting,settings,tokens-saved,health,choosing-your-brain-folder,updates,your-profile,dock-app,skill-levels,version-history,glossary}.md` | Sonnet, medium |

All five start together. The writers don't depend on E or F: shot ids and alt text come from the table above.
Then the lead runs the shots and `pnpm check`. The Phase 1 pages may get `related` links to new pages (lead).

## Tests (first, for logic)

- context: settings, profile, guide rows.
- readability: glossary terms left out; fixture.
- checks: `help` area free-form.
- search-sources: Help source owner-only, ranks, opens the drawer on the page.
- GuideView: renders contents and the chosen page; a related link moves the page; print list holds every page.
- SettingsView: each HelpLink owner-only and pointing at its page.
- help.test.ts (existing) covers every new page.

## Gates

UX/UI expert (Guide sheet, print, Settings links, consistency). Copy truth reviewer (every claim, **every timing
claim**, every bold label, each picture against its step). Correctness reviewer. Browser check of the Guide and
print preview on the demo server, owner and team.

## Pre-review changes (overseer, 2026-11-15; these override the decisions above)

- **Two more pages**: `signing-in` (the TDS Brain Sign-in app, the wrong Chrome profile; G1) and `personal-todos`
  (private, never synced; G3). Sync and the rail's "Synced" stamp belong to `sharing-with-your-team`; model and effort
  belong to `levels`; chatting about a to-do belongs to `adding-todos`.
- **Who owns what**: `favourites` = the star, wherever it shows; `pinned` = Home's cards (links to `favourites`).
  `health` = what each line means; `fixing-problems` = what's wrong, then the fix (links to `health`). `updates`
  doesn't mention a What's new card (that arrives in Phase 3).
- **Callouts**: new Phase 2 shots have **no callouts**, and new pages never write "(1)". Steps name the bold label.
- **Glossary terms fixed now** (25 at most, checked): Brain, Cortex, client, chat, Claude, skill, helper, level,
  approval, to-do, drawer, rail, Home, pin, favourite, sync, owner, scout, team member, token, page, Dock,
  terminal, Settings, Help. `glossary.md` has exactly these `###` headings, and the check fails above 25.
- **Free-form by page**: the `getting-started` area stays free-form, and a new `HELP_FREEFORM_PAGES =
  ['glossary', 'fixing-problems']` joins it. `getting-help` and `cortex-guide` keep the five headings.
- **E also owns** `client/src/shell/contract.ts` (`SearchActions.openView` gains `'guide'`, plus a new
  `openHelp(id)`), `client/src/shell/Palette.tsx` (implements them), `client/src/components/HealthPanel.tsx`
  (the `health` HelpLink sits on its "How TDS Brain is running" heading) and `client/src/help/render.ts` (an
  `eager` option for print). The About HelpLink from decision 7 is dropped.
- **Guide rules**: a non-owner on view `guide` sees Home. "Open the Cortex Guide" in the Help drawer runs
  `close-drawer`, not `close-help`. `GuideView` is lazy-loaded.
- **Print**: scoped to the Guide, reset height and overflow on `.desk`, `.sheet` and `.sheet-scroll`
  (`shell.css:503` scrolls inside itself); the hidden print copy renders pictures eager.
- **Picture safety**: `chat-details` crops out the Approvals line (it reads the real `~/.claude` settings) and the
  "Started" time. `tokens-saved` seeds the ledger through the store module and crops to the total, because the Today
  and 7-day rows follow the real date. `attach-files` attaches seed files only.
- **Shot order**: F writes every scene now, but runs only those that don't need E's markup. `guide-sheet`,
  `help-drawer`, `settings-prefs`, `settings-todos-switch`, `skill-levels` and `tokens-saved` run after E lands,
  using these agreed selectors: `.guide` (root), `.guide-contents` (contents), `.guide-page` (the page).

## Review outcomes (2026-11-15)

- **Overseer pre-review**: no blockers; 10 "should" items adopted (see Pre-review changes).
- **Correctness (Opus)**: 2 confirmed and fixed: print also printed the on-screen page; a ⌘K help result didn't
  reset the drawer when Help was already on that page (new `helpOpened` counter, never saved). Tests added for
  both, for the Palette's Help result and Guide, and to pin the glossary to `HELP_GLOSSARY_TERMS`.
- **Copy truth (4 Sonnet passes, all 39 pages)**: about 20 claims corrected, each checked in code first
  (approvals "as often as your terminal", helper click, Files tab needs Open, favourites vs Home, "Use this folder
  and restart", update rollback, the to-dos switch, Auto client guessing, pass-on Undo, ⌘K in the viewer).
- **UX (Opus)**: current-row wash, focus on the Guide heading on open, area names as list labels (not headings),
  lint warning cleared, dead rule removed, print margins.
- **Browser (demo app)**: owner and team checks pass; print gives 48 pages, each on its own sheet, with pictures.
- **Overseer sign-off**: signed off after two copy fixes (picture leaves out rows; the tokens "Try this").
- **For Phase 3**: pin the Approvals mode and start time in demo mode when the shots are retaken for the rename;
  add a test for a non-owner on view `guide` before Help opens to everyone; Phase 1 pages and keyboard-shortcuts
  say "owners" for Help keys, which changes at launch.

## Change after merge (2026-11-15)

Ian asked for Help to be open to every Cortex user now, ahead of the rest of Phase 3. `helpVisible` returns true
for every role (branch `help-for-everyone`); the "for now, only owners" lines in the pages are gone. The visible
rename, the tour and the What's new card are still Phase 3, so the app's own labels still say "TDS Brain" while
the help says "TDS Cortex" until then.
