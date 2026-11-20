# Settings tabs

Date: 2026-11-20 · Size: L · Branch: `settings-tabs` · Explainer: none · Release: `feat` (minor, 0.54.0)

## Objective

Settings is one long page of seven sections. Split it into a few tabs, using the same tab row as the Ads tools
(v0.53.0), so each tab is one short page and the page looks like the rest of the app.

## User decisions (fixed)

- Ian, 2026-11-20: use the new sub-menu (tool tabs) structure; a design agent and a UX/UI agent review and plan;
  then build. Stop before merging. No visual explainer.
- Product and design calls are delegated to the UX/UI overseer.

## Decisions

Sources: UX/UI overseer (fable) and design expert (opus) reviews, 2026-11-20.

1. **Five tabs, the same for every role: General · Claude · Skill levels · Health · About.** Default General.
   - General: Preferences (`#set-direct`, `#set-keys`, "Working out the client").
   - Claude: "Claude in chats", then "Tokens saved".
   - Skill levels: `SkillLevelsSection`; the tab hides when `skillLevels` is null (as the section did).
   - Health: `HealthPanel`, unchanged inside.
   - About: the About list, then "What's changed" (owner/scout only, as now).
   Tabs, labels, order and help pages live in `client/src/shell/settings-tabs.ts` (the contract).
   Plain: each tab is one short page; nobody scrolls past things they didn't come for.
2. **Profile stays its own view.** It describes the person, has its own rail button and help page.
   Plain: your profile still opens from your name on the rail.
3. **`view` stays `'settings'`; the store gains `settingsTab: SettingsTab` and
   `openSettings(tab?: SettingsTab, focusId?: string)`.** `openView('settings')` (rail, search "go-settings") lands
   on the remembered tab. The tab lives in store state for the session only (not saved; `View` isn't saved either,
   `store.tsx:357`). `App.tsx` renders `settingsTabOrDefault(settingsTab, ctx)`, so an unknown or hidden tab shows
   General. Existing `view === 'settings'` checks (`Rail.tsx:316`, `help/context.ts:27`) don't change.
   Plain: every way into Settings keeps working; it reopens where you left it until the app reloads.
4. **Focus jumps land on the right tab.** `settingsFocus` becomes `string | null` (an element id).
   `requestSettingsFocus(id = 'set-model')` keeps its call shape and also sets the tab (`set-model` → `claude`;
   `openSettings(tab, focusId)` sets both). **One** focus effect at Settings level (in `SettingsSheet`, decision 6),
   keyed on tab, focus id and ready: it focuses the element, else the fallback (in Automatic level `#set-model` is
   absent, so the chosen Level option), and **always** clears the flag, so a focus id whose element is on another tab
   never steals focus later. (Overseer pre-review, blocking.) `Chat.tsx:377` works unedited. The to-dos link (`TodosDrawer.tsx:889`) calls
   `openSettings('general', 'set-direct')`.
   Plain: "Change" in a chat still lands on the Model box, and the to-dos link lands on the switch it names.
5. **One shared tab row: `client/src/shell/SheetTabs.tsx`** (props in the contract). Same pattern as plan
   2026-11-20-rail-hover-tool-tabs 2b: `nav` + plain `button`s + `aria-current="page"`, `.seg` look, no `tablist`,
   focus stays on the pressed tab, scrolls sideways when narrow. `ToolTabs` becomes a thin wrapper and keeps its
   `tool-tabs seg` classes, labels and tests unchanged. Settings nav is named "Settings sections".
   Plain: the same tabs as Ads, with the same look and keys.
6. **A `SettingsSheet` component** (new, `client/src/components/SettingsSheet.tsx`), returned by the `settings`
   branch of `SheetContent` in `App.tsx`, renders `SheetBar`, the `.page-tabs` row and `.sheet-scroll`, in that order.
   It owns `useLastSync`, `healthChecks` and the focus effect. Only the `.sheet-scroll` is keyed by tab (a tab change
   starts at the top); the nav and the health hooks are **outside** the keyed subtree, so the pressed tab keeps focus
   and the sync poll doesn't restart on each switch (overseer pre-review, blocking). Only the current tab's panel
   mounts. When the current tab changes, it scrolls into view (`inline: 'nearest'`). Title stays
   "Settings" with hidden ": Claude" via `titleHidden`.
   Plain: switching tabs feels instant and always starts at the top.
7. **The row lines up with the settings column.** A `.page-tabs` wrapper: `max-width: 600px; margin: 12px auto 0;
   padding: 0 28px; flex: none` (16px under 600px, in the existing `@media (max-width: 599px)` block), with
   `.page-tabs > .tool-tabs { margin: 0; max-width: 100%; width: fit-content; }`, because `.seg` is `display: flex`
   and would otherwise stretch to the full 600px with the buttons bunched left. No new tokens. The settings page's top padding drops to
   16px under the tabs.
   Plain: the tabs sit right above the text they control, not off at the far left.
8. **A health problem shows from every tab** as an 8px `.health-dot[data-state="problem"]` after the Health label,
   only when `healthSummary().state === 'problem'`, spoken `Health, ${summary.text}` ("Health, 1 thing needs
   attention: Brain sync."). Not `.count`: that navy pill means "waiting". The design expert's call over the overseer's `.count`
   suggestion, for that reason. `useLastSync` and `healthChecks` move up to `SettingsSheet` and the checks are
   passed into `HealthPanel` (a prop; with none, it works out its own, so nothing else breaks), so only one sync
   poll runs. No new banner: a lost connection already shows on every sheet (`SheetNotices.tsx:43`).
   Plain: a red dot on Health tells you something is wrong wherever you are in Settings.
9. **Every heading, `aria-labelledby` id and control id stays** (`prefs-h`, `claude-h`, `levels-h`, `saved-h`,
   `health-h`, `about-h`, `changes-h`, `#set-direct`, `#set-keys`, `#set-model`). Each section keeps its `h2`; no
   new `h2` repeats a tab name. Help screenshots and tests select on them.
   Plain: help pictures and links into Settings keep finding what they point at.
10. **Search: five "Go to" entries** — "Settings: General", "Settings: Claude", … (`search-sources.ts`, a new optional
    `openSettings` on `SearchActions`; the existing "Settings" entry stays). The entries come from
    `visibleSettingsTabs`, using a new optional `hasSkillLevels` on `SearchContext` (`shell/contract.ts:559`), so
    "Settings: Skill levels" is absent when that tab is hidden. Hits for single settings: not now.
    Plain: typing "health" in search takes you straight there.
11. **Help follows the tab.** `HelpContext` (`client/src/help/contract.ts:142`) gains an optional `settingsTab`;
    `ShellProvider.tsx:258` (which builds it) passes the shown tab; `help/context.ts` returns that tab's `help` page
    (missing → `settings`, as now).
    Plain: Help opens the page about what you're looking at.
12. **Help, screenshots and docs ship together.** `help/settings.md` (no longer "one page"; describe the tabs), the
    other pages that say "Under X in Settings" (`change-todos-setting`, `keyboard-shortcuts`, `levels`,
    `skill-levels`, `tokens-saved`, `health`, `version-history`, `dock-app`, `updates`, `fixing-problems`, others found
    by grep), `scripts/help-shots.ts` scenes that need a tab click (tokens-saved, skill-levels, any after line 458;
    select with `getByRole('navigation', { name: 'Settings sections' })` then the button by its name),
    a What's new page `help/whats-new/0.54.0.md`, and `docs/design-system.md` (tool tabs → page tabs; Settings
    surfaces). UK English; passes the help readability test.
    Plain: the guide matches the new layout on day one.
13. **Backward compatibility.** No saved setting added or changed. `requestSettingsFocus()` and `openView('settings')`
    keep working with no arguments. `HealthPanel` works without the new prop. `SearchActions.openSettings` optional.
    Accepted loss: the skill-levels search text clears when you leave that tab. Known: if skill levels arrive after a
    remembered Skill levels tab fell back to General, the page would switch to it; nothing opens that tab directly
    today. The What's new version (0.54.0) is confirmed at merge.
    Plain: nothing you rely on stops working.

## Contract

`client/src/shell/settings-tabs.ts`: `SettingsTab`, `SETTINGS_TABS`, `visibleSettingsTabs`, `settingsTabOrDefault`,
`SheetTabItem`, `SheetTabsProps`.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer (UX/UI) | `overseer`, fable | pre-review done; sign-off | (read-only) |
| Design expert | `expert`, opus | visual and design-system review done | (read-only) |
| Builder A: code | `builder`, sonnet | UI and wiring | `client/src/shell/SheetTabs.tsx` (new) + test, `client/src/shell/ToolTabs.tsx`, `client/src/shell/settings-tabs.test.ts` (new), `client/src/components/SettingsSheet.tsx` (new), `client/src/App.tsx`, `client/src/store.tsx`, `client/src/shell/contract.ts`, `client/src/components/SettingsView.tsx` (+ tests), `client/src/components/HealthPanel.tsx`, `client/src/shell/TodosDrawer.tsx` (the link only), `client/src/shell/search-sources.ts` (+ test), `client/src/help/context.ts` (+ test), `client/src/help/contract.ts` (`settingsTab`), `client/src/shell/ShellProvider.tsx` (help context only), `client/src/styles/*.css`, a new app test `client/src/components/SettingsTabs.app.test.tsx` |
| Builder B: help | `builder`, sonnet | copy and a script | `help/**`, `scripts/help-shots.ts` |
| Lead | — | — | this plan, the contract, `docs/design-system.md` |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `client/src/shell/settings-tabs.test.ts` | Skill levels hides without levels; unknown/hidden tab → general; order | A |
| `client/src/shell/SheetTabs.test.tsx` | current marked `aria-current="page"`; count, note and dot render; spoken name; press calls `onChoose`, current press doesn't | A |
| `client/src/shell/ToolTabs*.test.tsx` | pass unchanged | A |
| `client/src/components/SettingsView*.test.tsx` | each section on its tab; What's changed by role; Health dot shows from General when a check fails | A |
| `client/src/components/SettingsTabs.app.test.tsx` (real store) | Chat "Change" lands on Claude with `#set-model` focused (and the Level fallback in Automatic); to-dos link lands on General with `#set-direct` focused; hidden title ": Claude"; tab remembered across leaving and returning; after pressing a tab `document.activeElement` is that tab; the Health dot survives a tab switch and the last-sync fetch isn't called again; a focus id for an element not on the shown tab is cleared | A |
| `client/src/shell/search-sources.test.ts`, `client/src/help/context.test.ts` | the Go to entries, with Skill levels absent when hidden; help page per tab | A |
| help readability test | new and changed help pages read clearly | B |

## Gates

- [ ] `pnpm check` (type-check, tests, lint, build) in the worktree
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Run the `settings-*`, `tokens-saved` and `skill-levels` help-shot scenes (a scene waiting on a missing section fails only when run)
- [ ] Domain gates: UX/UI (overseer sign-off + UI reviewer); no SEO, Payload CMS or security surface
- [ ] Browser check on a preview (port 3878, own data folder): each tab, the Health dot, Chat "Change", to-dos link,
      480px sheet with the run chat open (tab row sized to its buttons, not stretched)

## Review outcomes

- Overseer pre-review (fable): accepted the design expert's two changes (decisions 7 and 8). Blocking, folded in:
  `SettingsSheet` owns the health hooks and focus effect outside the keyed scroll (6, 8); one focus effect that always
  clears (4). Should, folded in: tab id `skill-levels`; `HelpContext.settingsTab` and `SearchContext.hasSkillLevels`;
  `.seg` stretch trap (7); spoken name from `summary.text`; extra app tests; Builder B's selector and a shot-scene
  gate. Nice, folded in: scroll the current tab into view; confirm the version at merge.
- UI and accessibility review (sonnet): no findings.
- Copy review (sonnet): 2 confirmed, fixed. `help/settings.md` said each tab has its own help page (General and About
  share `settings`; Claude opens `levels`): now names the page each opens. The 0.54.0 note now says "each tab you can
  see" and "until the app restarts"; the glossary says Skill levels shows only with levels.
- Correctness review (opus): 1 confirmed, fixed (d33c5bf). On a narrow window the To-dos drawer floats and `<main>` is
  inert, so the Settings link's jump to `#set-direct` was lost. The link closes a floating drawer first, and the focus
  effect waits up to 30 frames while its target is inside `[inert]`. App test fails without it. A fresh review of
  the fix: no findings, and it raised a timing question for an open to-do panel.
- Lead, browser check of that question: already on Settings, the link left an open to-do panel open (the view
  didn't change, so `ShellProvider` didn't close it), and once closed, the panel put focus back on its row. Fixed
  (72dc878): the link closes the panel (asking first if it has unsaved changes) and skips that one focus return.
  Drawer test fails without the skip.
- Fresh review of 72dc878 (opus): 1 confirmed, fixed. With the drawer floating and unsaved changes in the panel, the
  link asked twice and the second question replaced the first, so Discard left the drawer over Settings. Now the link
  closes only the floating drawer (which closes the panel); test fails without it.
- Overseer sign-off (fable): signed off, no blockers, on condition the fix review came back clean. Should-fixes done:
  narrow sheet checked (476px sheet: 5 tabs 347px, no clipping, aligned with the headings at 16px), version
  confirmed (main at 0.53.1, so this `feat` becomes 0.54.0), these outcomes recorded.
- Known, left: leaving Settings within the half-second inert wait leaves the focus request set, so the switch gets
  focus on the next visit to General. Clearing it on unmount would break React StrictMode's double mount in
  development.
- Gates: `pnpm check` green (224 files, 4416 tests). Flaky under load, each clean on rerun and outside this change's
  logic: Shell.test.tsx, TodoFiles.test.tsx, one Tour.test.tsx focus test. Help-shot scenes
  settings-prefs, settings-todos-switch, tokens-saved, skill-levels and todos-drawer ran; pictures refreshed.
  Browser (demo app, headless Chrome): tab row aligned with the first heading, not stretched; focus stays on the
  pressed tab; hidden title per tab; each tab's sections as planned; the tab is remembered; ⌘K lists each tab; the
  Health dot shows on a problem; the To-dos link lands on the switch at 820px, at 560px and with a panel open.
