# Rail hover and tool tabs

Date: 2026-11-20. Branch `rail-hover-tool-tabs`. Size L. Release: `feat` (minor, 0.53.0).

## Objective (Ian, 2026-11-20)

1. The rail (main menu) slides out over the page on hover, like the TDS Toolbox portal.
2. Switching between the three Ads tools (Ads Manager, Ads Command Centre, Ads Account Summary) takes one click,
   not "Workbench, then the tool". Ian chose tabs on the page over a shrinking drawer strip (the UX/UI overseer
   advised against the strip: it sits under the sliding rail, puts two hover zones side by side, does nothing on
   touch and costs page width).
3. The Manager tab's count is all accounts, matching the rail and the drawer.
4. No visual explainer.

Out of scope: hover-opening the working drawers (Chats, To-dos, Skills, Help); a flyout off the Workbench item;
`lastTool` reopening (noted for later).

## Team

| Role | Agent | Model | Why |
|---|---|---|---|
| Overseer (UX/UI) | `overseer` | fable, high | Pre-review done; signs off |
| Builder A: hover rail | `builder` | sonnet, medium | UI |
| Builder B: tool tabs | `builder` | sonnet, medium | UI |
| Reviewers | `reviewer` | opus high (correctness), sonnet medium (UI and accessibility) | |

## Decisions

### 1. The rail expands on hover (port of the portal's decision 34)

Source: `tds-app-portal` commit c4ec997, `apps/portal/components/shell/rail-hover.ts` and
`apps/portal/__tests__/shell/rail-hover.test.ts`, decision 34 of `docs/plans/2026-11-15-brain-design-system.md`.

- 1a. `client/src/shell/rail-hover.ts` is a copy of the portal's pure timing logic (open after 200ms rest, close
  150ms after leaving, Esc and choosing dismiss until the pointer leaves and returns), with a header naming the
  source commit. Its test is copied too (vitest). One change: `hoverCapable` is replaced by passing the pointer
  type on enter (`pointerType === 'mouse' || 'pen'`), as `Tooltips.tsx` does, so touch laptops work.
  Plain: the same timing as the portal, so both apps feel the same.
- 1b. Only while the rail shows icons (`railShowsNames` false: chosen, under 900px, or held by the panel). Never
  touches `railWide`; the toggle and `[` still pin names.
  Plain: pointing never changes your saved setting.
- 1c. **Overlay, never push.** The rail sits in a `.railslot` that keeps `--rail-w` (60px) in the desk's flex row;
  the rail inside is absolutely positioned and widens to 212px over the drawer and sheet, with `--lift-2`. The
  hover zone is the `.railslot` plus a pseudo-element that reaches left over the 12px desk gutter.
  Plain: the names slide over the page; nothing else moves, and shoving the mouse to the screen edge keeps it open.
- 1d. In `Rail.tsx`, `showsNames = wide || expanded` feeds `data-wide`, `Item` and `SyncStamp`. A new
  `data-expanded="true"` only sets width, shadow and z-index. No portal `data-icons` selectors.
  Plain: one switch decides whether names show, so less new CSS.
- 1e. z-index 39 when expanded: under the veil (40) and every modal layer. It collapses at once when anything modal
  opens (floating drawer, floating panel, palette, viewer, to-do panel, tour), and never expands while the rail is
  `inert`.
  Plain: the menu can never get stuck on top of a pop-up.
- 1f. Keyboard: opens when focus moves in from Tab or Shift+Tab (track the last key; a focus that a closing drawer
  hands back to its rail button, or a click's focus, does not open it). Closes when focus leaves.
  Esc: when pointer-opened, Esc closes it and stops there; when focus-opened, Esc closes it and also lets the key
  through (as the tooltip layer does).
  Plain: Tab into the menu and the names show; closing a drawer with Esc doesn't make the menu pop out.
- 1g. Choosing an item (any rail button) closes it; opening a drawer from it closes it.
- 1h. Tooltips: no rail tooltip while expanded. Fix the race in `Tooltips.tsx`: when the timer fires, `show()` does
  nothing unless `tipTarget(el) === el` (the element still qualifies), so an item whose `data-tip` went away at
  200ms doesn't fall back to its `aria-label` at 350ms. Timed tests for pointer and keyboard.
  Plain: no stray label blinks beside the menu as it slides out.
- 1i. The names toggle: with a hovering pointer and icons only, it is not shown over the mark any more; once expanded
  it shows top right (as with names on), labelled "Keep names showing" (tooltip the same). Pressing it pins names
  (`toggle-rail`). Touch keeps today's behaviour (shown over the mark). `docs/design-system.md` updated.
  Plain: the pin button doesn't jump from under the mouse.
- 1j. Motion: width and shadow over 160ms `--ease`; none under `prefers-reduced-motion`.

### 2. Tool tabs under the sheet bar

- 2a. When the sheet shows a visible tool whose `group` has two or more visible tools, the shell (`App.tsx`, the
  `tool:` branch) renders a `ToolTabs` row between `SheetBar` and `.sheet-scroll`. Rendered by the shell, not the
  tool, so focus stays on the pressed tab and nothing flickers. A group of one shows nothing.
  Plain: inside Ads, the three tools sit as tabs at the top of the page.
- 2b. Markup: `nav aria-label="{group} tools"` ("Ads tools") holding plain `button`s, `aria-current="page"` on the
  current one. Not the `Seg` component (a radio group whose arrows would load a page per press). It reuses the
  `.seg` look: add `[aria-current="page"]` to `.seg`'s chosen style in `base.css`. Options size to their words and
  never clip; the row scrolls sideways when the sheet is narrow (480px, run chat open). Left-aligned, no line or
  backing (as `.drawer-tools`). Padding lines its left edge up with the sheet's content.
  Plain: it looks like the app's other switches but works as page links.
- 2c. Labels come from a new optional `ToolSlot.tabLabel` ("Manager", "Command Centre", "Account Summary"); falls
  back to `title`. Each tab shows the drawer's numbers: `badge` as `.count`, else `rowNote` as small text, with a
  spoken name such as "Manager, 5 waiting" (from the badge) or "Command Centre, 3 due" (from the note).
  Plain: the numbers match the drawer and are read out clearly.
- 2d. Pressing a tab calls `openTool(section.id, tool.id)` with no argument: the chosen account already survives a
  tool change (`adStore.account`, `use-ads-account.ts`), and so does the run chat drawer (`store.tsx` ~764). Tests
  for both. Pressing the current tab does nothing.
  Plain: the client and an open run chat stay put as you switch.
- 2e. The sheet bar title is "Workbench · {group}" when tabs show, with the tool name kept for screen readers as
  visually-hidden text in the `h1` ("Workbench · Ads<hidden>: Ads Command Centre</hidden>"). `SheetBar` gains an
  optional `titleHidden` (or equivalent) prop; the `title` attribute keeps the full text.
  Plain: screen reader users still hear which tool they are on.
- 2f. Ads Manager's two in-page buttons ("Ads Command Centre", "Ads Account Summary", `toolLinks` in
  `AdManagerSheet.tsx`) go. Contextual links (Needs you rows, Approvals) stay.
- 2g. Help: `help/workbench.md` and `help/ad-manager.md` describe the tabs and hover rail; a What's new page
  `help/whats-new/0.53.0.md`. UK English, readable (the help readability test).

### 3. Backward compatibility

No saved setting is added or changes meaning. `ToolSlot.tabLabel` is optional. Old views, search hits and
`lastTool` keep working.

## Files

- Builder A: `client/src/shell/rail-hover.ts` (new), `client/src/shell/rail-hover.test.ts` (new),
  `client/src/shell/Rail.tsx`, `client/src/shell/Rail.test.tsx`, `client/src/shell/Tooltips.tsx`,
  `client/src/shell/Tooltips.test.tsx`, `client/src/styles/shell.css`.
- Builder B: `client/src/shell/ToolTabs.tsx` (new), `client/src/shell/ToolTabs.test.tsx` (new),
  `client/src/shell/sections-contract.ts` (`tabLabel`), `client/src/tools/ad-manager/{slot,command-slot,summary-slot}.ts`,
  `client/src/App.tsx`, `client/src/shell/SheetBar.tsx`, `client/src/styles/base.css`, `client/src/styles/sections.css`,
  `client/src/tools/ad-manager/AdManagerSheet.tsx` (+ its tests that look for the removed buttons), help pages.
- Lead: this plan, `docs/design-system.md`.

## Tests

- A: `rail-hover.test.ts` (copied, adapted for pointer type); `Rail.test.tsx`: expands only when icons-only, never
  changes `railWide`, closes on choose, collapses when the palette or a floating drawer opens, a click's focus
  doesn't open it, Tab does; `Tooltips.test.tsx`: no tooltip after the rail expands (pointer and keyboard).
- B: `ToolTabs.test.tsx`: shows for 2+, hides for 1 and for hidden tools; current marked; press opens the tool with
  no arg; account kept across a switch; counts and spoken names; the run chat drawer stays open across a switch.

## Review outcomes

- Overseer pre-review (fable): chose tabs over the shrinking strip; added the tooltip race fix, the Tab-only focus
  rule, z-index 39 under the veil, the gutter hover zone, the toggle not jumping, `tabLabel`, shell-rendered tabs.
  All folded into decisions 1 and 2 before building.
- Correctness review (opus): 2 confirmed. (1) A modal opening called `escape()`, which dismissed the rail until the
  pointer left it, so the first hover after the palette, viewer or to-do panel did nothing: fixed with
  `collapse()` (no dismissal), tests in `rail-hover.test.ts` and `Rail.test.tsx` (the latter fails without the fix).
  (2) The 2d and 2e tests were missing: added `ToolTabs.app.test.tsx` (title and hidden name; account kept) and a
  store test for the run chat drawer surviving a tab press.
- UI and accessibility review (sonnet): 1 confirmed. After Tab then Esc, focus could sit on the invisible names
  toggle: it now shows over the mark while it has keyboard focus. Nit kept: the tabs row has no overflow hint;
  three Ads tabs need about 400px, so it rarely clips.
- Lead: put back the help line "Every live change needs your yes" that the builder had cut for length; hid
  `.railslot` in the Guide's print styles; browser check on a preview (hover over the Chats drawer and a tool page,
  choosing closes it, tabs switch in one click keeping the client).
- Known: on a touch laptop that reports `hover: hover`, a tap can't reveal the names toggle at icons only; `[` and
  Tab still reach it.
