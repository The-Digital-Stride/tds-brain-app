# Ads section: Ads Manager, Ads Command Centre and Ads Account Summary

Date: 2026-11-19 · Size: XL (two releases) · Branch: `ads-workbench-sections` · Explainer and agreed design: https://claude.ai/artifact/8pJex7Y5WaF8ohye2QrMMh (version 17)

Builds on `2026-11-16-workbench-ad-manager.md` (the section pattern, the `tdsapp-ads` bridge) and `2026-11-16-run-chat-drawer.md` (the tool chat layer). The memory note `workbench-ad-manager-programme` holds the decision history.

Revision 2 (2026-11-19): the overseer's pre-review is folded in. Its outcomes are listed under "Review outcomes" at the end.

## Objective

Today one long Ad Manager page holds decisions, sign-off, data checks, every task, the standup and six report tables. Split it into three Workbench tools under a collapsible **Ads** section, each doing one job:
- **Ads Manager:** decisions.
- **Ads Command Centre:** running the account. This brings back the original brain board's layout and wording.
- **Ads Account Summary:** the deep-dive tables.

Add a shared set of category colours to the design system on the way. The agreed design is the artifact above. Where this plan and the artifact differ, the artifact wins, unless the plan says why.

## User decisions (fixed)

1. **Three tools, in a collapsible "Ads" section** of the Workbench drawer, named **Ads Manager**, **Ads Command Centre** and **Ads Account Summary** (Ian, 2026-11-18). "All accounts" and "Monthly reports" pages are dropped.
2. **Keep the original text** for the board and the tables: task titles and descriptions, the key's notes, the "What I run on…" subtitle and the table titles and subtitles, from the brain board (`tools/members/command-centre/public/ads-command-board.html`, `lib/ads-board-data.cjs`), which the bridge already copies into `cadence-tasks.json`. Sentence case stays the app's (Ian, 2026-11-18).
3. **Back to the original board in Ads Command Centre:**
   - Five frequency columns.
   - The Daily standup is the first card in Daily.
   - The account data panel goes green when every required file is ready. Otherwise it shows files nested by group, each with a dot: green ready, grey not needed, amber stale or wrong shape, red missing.
4. **One colour per task type**, used as the whole card fill and shown as the same fill in the key. There are no dots or coloured edges. The colours are:
   - Report: aqua
   - Insight: yellow
   - Action: rose
   - Standup: iris

   They come from a proposed shared category palette (Ian and Pete, 2026-11-19; UX expert review, 2026-11-18).
5. **Standup account triage is a pop-up** opened from the Daily standup card ("All accounts' standups…"). The page shows only the picked account (Pete, 2026-11-19; Ian chose the pop-up).
6. **"Needs you" jumps to the Monthly close card and outlines it briefly.** The card stays where it is (Pete and Ian, 2026-11-19).
7. **Task run links** open the chat of the last run that finished, as the glass chat layer over the page (`ChatDrawer.tsx`), not on the chat screen (Ian, 2026-11-18).
8. **Backward compatibility first** (memory `backward-compatibility-first`): old links, saved settings, older brain skills and older app versions keep working. The brain is changed only through the `tdsapp-ads` skill, copied in with Ian's yes.
9. **Nothing is built until Ian approves this plan.** Merging and pushing are separate yeses.

## Decisions

### Release 1: app only (no brain change)

1. **The Ads section.** The Workbench keeps one `SectionSlot` (`client/src/shell/sections.ts`). Its `tools` become `[adsManagerTool, adsCommandTool, adsSummaryTool]`, each with `group: 'Ads'`.
   - `SectionDrawer.tsx:60` shows group folds from **one** group (`groupNames.length >= 1`), not two.
   - The drawer uses `Fold`'s existing `open` and `onToggle`. When folded, it passes the sum of the group's badges as the `count`; when open, the tool count. `Fold.tsx` doesn't change.
   - Fold state is remembered in `AppPrefs.foldedGroups?: Record<string, string[]>` (section id to folded group names). This needs three server changes, or the setting is refused and dropped:
     - a `foldedGroups` case in `parsePrefsPatch` (`server/http/routes.ts`, next to `adsFolds`), with limits and a UK English error;
     - a `cleanFoldedGroups` in `sanitise` (`server/store/app-store.ts`), so a bad saved value falls back;
     - a test through the real PATCH route (`server/http/ads-routes.test.ts`), per memory `test-new-requests-through-gate`.

   Plain: the Workbench menu shows an Ads heading you can fold away, it stays folded next time, and a folded heading still shows how many things wait for you.
2. **Ids and names.** Ads Manager keeps the id `ad-manager`, so `tool:workbench/ad-manager` views and search results keep working. The two new tools are `ads-command-centre` and `ads-account-summary`.
   - Titles and summaries are as in the artifact.
   - Icons: `inbox`, `play` and `chart`, or the nearest in `Icon.tsx`. Add an icon only if none fits.
   - The sheet-bar title reads "Workbench · <tool>" (`client/src/App.tsx:137`).
   - User-facing "Ad Manager" becomes "Ads Manager" where it names the tool: the Home button (`Home.tsx:340`), the `unavailable` message (`shared/ads-contract.ts:174`), the settings error in `routes.ts` and the help page. Code names and comments stay as they are.

   Plain: the old Ad Manager link still opens, now called Ads Manager.
3. **One account across the three tools.** Account loading lives only in `AdManagerSheet.tsx:26-55` today, so a tool opened directly would load nothing. It moves to a shared hook, `useAdsAccount()` (new `use-ads-account.ts`): the caller's account (`toolArg`), else the saved one, else the first with something waiting; then loading the board for it. All three sheets call it. The account picker in `AdManagerBar.tsx` becomes every tool's `BarActions`. `openTool(section, tool, account)` already takes an account, and the tools use it to link to each other.
   Plain: pick a client once and every Ads tool shows that client, whichever tool you open first.
4. **Visibility and counts.**
   - All three tools use today's `visible` rule (`snap.ads?.visible === true`).
   - Ads Manager keeps today's `badge`, so the rail number doesn't change.
   - Ads Command Centre's drawer row shows "N due" as text through a new optional `ToolSlot.rowNote`. A due count isn't a waiting count, so its `badge` returns 0 and the rail sum is unchanged.
   - The count comes from `ToolSnapshot.adsDue`. The snapshot is built as `{ ads }` in five places today, so they become one `useToolSnapshot()` hook in `client/src/store.tsx`, which reads a main-store `adsDue` field. The ad store sets that field when a board loads; until then there is no note.
   - Ads Account Summary has no count.

   Plain: the rail number still means "proposals waiting for you"; due tasks show in the menu once a board has loaded.
5. **Ads Manager page** (`AdManagerSheet.tsx` slims down to decisions):
   - **Header:** an account head, then four fact tiles: Waiting for a decision, Approved and ready to apply, Latest weekly pack, Monthly close.
   - **Needs you:** a list built by a pure `needsYou()` from data the app already loads: verification findings with severity, account data problems from the board's `health`, and an unsigned month. Each line has one action:
     - "Open report" (existing `OpenFile`).
     - "Ads Command Centre": `openTool` to that tool, and lands on the data panel. The target travels as `adStore.set({ jump: 'readiness' })`; the target sheet reads it once it has drawn, focuses that heading and clears it.
     - "Go to monthly close": scrolls to the card, focuses it and outlines it for 1.6 s. With reduced motion it jumps without the smooth scroll.

     The Monthly close fact tile does the same jump.
   - **Proposals:** two cards, "Waiting for a decision" and "Approved, ready to apply". Each table is title first with the campaign underneath, then Tier, Expires or Approved, and Status or Next step. Id, type and section move to `ProposalPanel`. The "Recent decisions, last 14 days" fold stays.
   - **Monthly close card:** status badge, one primary "Sign off the report…" that opens today's confirm step and note (`Confirm.tsx`), the file buttons, and an "Earlier months" fold.
   - Dates are written in words throughout ("Mon 17 Nov", "in 3 days"), using `words.ts` helpers.
   - `ProposalPanel` loses its Rate calls mode (decision 6a).

   Plain: Ads Manager opens on what needs you, then the decisions, and sign-off is one clear button that's never buried.
6. **Ads Command Centre page** (new `CommandSheet.tsx`, built from today's `Board.tsx` parts):
   - Account head.
   - `DataHealth` restyled as the readiness panel, with its tone from a pure `readiness(health)`:
     - `ok` (green) only when every required file is ready; `na` counts as ready and shows a hollow grey dot;
     - a fetch problem (`health.fetch.problem`, which `Board.tsx:221` shows today) makes it `warn`, so it never goes green while the daily fetch is failing;
     - any missing file makes it `bad`; an unknown file status counts as `warn`;
     - null health is accepted and gives no panel. The set-up card (`Board.tsx:204`) still shows when there's no data at all.
     - Files are grouped as daily, search, products and deep, with a dot per file.
   - "What I run on <account>" with the original subtitle and the key: Report, Insight, Action and Standup chips in their fills, with the original notes.
   - Five frequency columns of `cards`, each card filled by its `kind`. The standup card leads Daily.
   - Each card shows a badge from a pure `dueState(cadence, lastRunAt, now)`:
     - daily is due one day after its last run;
     - weekly is due after 7 days and overdue after 14;
     - fortnightly is due after 14 and overdue after 28;
     - monthly is due on the 1st and overdue 7 days after;
     - quarterly is due on the quarter's first day;
     - before a monthly or quarterly task is due, it shows "Due Mon 1 Dec" (`upcoming`).

     The rules:
     - Days are counted in local calendar days from the due date, and the thresholds are inclusive.
     - A last run dated in the future, or an invalid date, gives no badge.
     - A task that has never run is due only if it is daily, and is never overdue, so a new account doesn't open covered in red.
     - "Stopped" comes from the task's run record, not from `dueState`.

     The builder writes the tests first, and the UX gate checks the wording.
   - The standup card keeps Run and Rate calls.
   - The triage table leaves the page.

   Plain: the board looks and reads like the original, shows what's due, and makes it obvious when the data is all ready.
6a. **Rate calls opens in Ads Command Centre's side panel.** It renders inside Ads Manager's proposal panel today (`ProposalPanel.tsx:429`), which Ads Command Centre doesn't show. The command slot gets `Panel: RateCalls` and `panelLabel: 'Rate calls'`, and `RateCalls` drops its "Back to proposals" link.
   Plain: the Rate calls button opens where you are.
7. **Category colours in the design system.**
   - `client/src/styles/tokens.css` gains `--cat-rose #fecbd8`, `--cat-yellow #fef08a`, `--cat-aqua #bef9f1`, `--cat-sky #bceefe`, `--cat-iris #d2d3ff` and `--cat-mauve #e3d2e8`.
   - The task types alias them: `--type-report`, `--type-insight`, `--type-action` and `--type-standup`.
   - `docs/design-system.md` gets a "Category colours" section with the rules:
     - A category is a whole fill with navy text and its word. Dots and edges stay for status.
     - Use the white `.btn` on fills, not the quiet one.
     - The colours are named by hue and used by meaning.
     - A dark set redefines the same names later.
   - Navy, `#525252` and `#33456a` text pass WCAG AA on every fill (checked 2026-11-18/19).

   Plain: the app gets one set of "kind of thing" colours that can never be mistaken for "waiting", "error" or "done".
8. **Ads Account Summary page** (new `SummarySheet.tsx`):
   - Today's `DeepDive.tsx` moves here unchanged: its six tables, their sorting, drag order and "Ask Claude".
   - Above the tables:
     - an account head;
     - a "Worth a look" list from a pure `worthALook(board)`, covering wasted spend share, ROAS under 1 and Quality Score of 4 or less, each jumping to its table. A table missing from the board gives no line;
     - a totals strip, **only when the board carries `totals`** (Release 2).
   - Until then the strip is left out rather than shown empty.

   Plain: the report tables get their own page with the main things worth a look at the top.
9. **Run links to the last finished chat** (`task-runs.ts`, `store.tsx`, the session engine):
   - `TaskRun` gains optional `sdk?: string | null` (the chat's `sdkSessionId`) and `good?: { at: string; sdk: string } | null`, the last run that finished.
   - `LiveSession` (`shared/contract.ts`) gains optional `lastTurn?: 'ok' | 'stopped' | 'failed'`, set by `server/engine/session-manager.ts` at each of its three `turn-end` points. Today a stopped or failed reply also ends `idle`, so the state alone can't tell them apart. Older servers leave the field out, and the client then records no `good`.
   - The client store (`client/src/store.tsx`) reconciles runs from the sessions list it already keeps, not from the lazy screen. When a run's chat shows an `sdkSessionId`, it records `sdk`. The first time that chat shows `lastTurn: 'ok'`, it records `good`.
   - `readRuns` and `recordRun` rebuild records as `{ at, chat }` today, so both must carry the new fields through.
   - Older records without these fields still load, and their run time shows with no link.
   - The localStorage key stays `tds.adManager.taskRuns.v1`. The fields are additive, so older app versions ignore them.
   - The run time links to `good`. A stopped or failed newest run shows "Stopped today, 09:30" with "Last good run <link>".
   - A teammate's run (shared log, `lastRun.by` ≠ me) shows text only.
   - If a past chat can't be opened (for example, its transcript has been cleared), the card shows one inline line saying so, instead of failing silently.

   Plain: each task's last run time opens what that run found, weeks later too, and a run you stopped is never labelled as a good one.
10. **Open a past chat in the layer.** `openPast(sdkSessionId, opts?: { in?: ChatPlace })` passes `in` on to `openChat`, including the `already-open` path (`store.tsx:756-775`). It defaults to the chat screen, so today's callers don't change. The run link calls it with `{ in: 'drawer' }`, and the layer's "Open full screen" works as now. It resolves to whether the chat opened, so the card can show the line from decision 9.
    Plain: the result opens over the board, like other tool chats, so you don't lose your place.
11. **Search.** Each tool sets `search`, as `apps.test.ts` requires.
    - Ads Manager keeps the tool and account results, and keeps "ad manager" as a match, so the old name still finds it.
    - Ads Command Centre finds tasks by title, and Ads Account Summary finds tables by title.
    - Both read only the board already loaded in the ad store, synchronously; they never ask the bridge while you type. With no board loaded, they offer just the tool.
    - Choosing a result opens that tool on the current account.
    - Search sources stay outside the lazy screen chunk (as `ad-manager/search.ts` is).

    Plain: typing a task or table name takes you to the right tool, and search stays fast.
12. **One lazy chunk.** The three sheets, the board parts and the three CSS files load together through `ad-manager/ui.ts`, since they share the store and the board.
    Plain: one short load the first time, then switching between the Ads tools is instant.

### Release 2: needs a brain skill update (`tdsapp-ads`, add-only)

13. **Every account's latest standup verdict, and the triage pop-up.** The bridge's `board` reply gains `triageAll?: AdsTriageRow[]`, built from each account's `standupSummary()`, worst first. The bridge advertises `triage-all-v1` in `features`, but the client gates on the field being present, since it never sees `features`.
    - The pop-up itself is built in this release too, so it ships with data to test against.
    - It opens from the standup card's "All accounts' standups…" button, which shows only when `triageAll` is present.
    - It is non-modal, anchored under the button, and closes with Esc or an outside click. Focus moves to its close button and goes back to the button when it closes.
    - It is a `role="dialog"` with a heading. The list is worst first, and choosing an account switches the shared account.

    Plain: the pop-up can list every client's standup; until the brain supplies them, nothing about the standup card changes.
14. **Account totals with the previous period.** The `board` reply gains `totals?: AdsTotals`: spend, conversions, conversion value, ROAS, CPA and wasted spend, for the period and the one before. The bridge advertises `totals-v1`; the client shows the strip only when the field is present.
    Plain: the summary page gets its headline numbers once the brain supplies them.
15. **Copying into the brain** follows the existing route: the skill in `brain-skills/tdsapp-ads/`, then copied in with Ian's yes. It only adds things, so older app versions keep working (memory `ad-manager-cloud-add-only`, `never-write-brain-files`).
    Plain: the brain change only adds information; nothing that works today changes.

### Open questions for Ian (these don't block Release 1)

- **Q2.** Can Ads Account Summary offer 7, 30 and 90 days? This depends on whether the brain's data files are fixed at 30 days, so it is Release 2 at the earliest. The default is a fixed "last 30 days" label with no switch.
- **Q3.** Should a teammate's run link to their saved result file? That needs the shared run log to record a file, which is a brain change. The default is text only.

(Q1, which tool opens first, is dropped: `lastTool` is saved but never read, and the rail opens the drawer rather than a tool, so there's nothing to choose.)

## Contract

`client/src/tools/ad-manager/ads-tools-contract.ts`: the new tool ids, the pure functions (`needsYou`, `readiness`, `dueState`, `worthALook`), the additions to `TaskRun`, `LiveSession`, `openPast`, `ToolSlot`, `ToolSnapshot`, `AppPrefs` and the ad store, the `useAdsAccount` and `useToolSnapshot` hooks, and the Release 2 additions to `AdsBoard`. Builders import from it, and the real modules re-export or implement it. Release 2 types are added to `shared/ads-contract.ts` only when Release 2 starts.

## Team and file ownership (Release 1)

Paths under `client/src/tools/ad-manager/` are written by file name alone.

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | Plan critique and sign-off | (read-only) |
| UX/UI expert (gate) | `expert`, opus | Domain gate for UI | (read-only) |
| Builder A1: server and stores | `builder`, sonnet | Default. Each change is small and additive and tests come first. The session-engine change is three lines at known points, and an Opus correctness reviewer checks it | `server/http/routes.ts`, `server/store/app-store.ts`, `server/http/ads-routes.test.ts`, `shared/contract.ts` (`AppPrefs`, `LiveSession` only), `server/engine/session-manager.ts` (`lastTurn` only) and its test, `client/src/store.tsx` (`openPast`, `useToolSnapshot`, `adsDue`, run reconcile), `task-runs.ts`, `task-runs.test.ts`, the store tests |
| Builder A2: shell and logic | `builder`, sonnet | Default; the pure functions are tests first | `client/src/shell/SectionDrawer.tsx`, `client/src/shell/sections.ts`, `client/src/shell/sections-contract.ts`, `client/src/App.tsx` (bar title only), `store.ts` (`jump`), `use-ads-account.ts` (new), `AdManagerBar.tsx`, `logic.ts` and `logic.test.ts` (new), `slot.ts`, `command-slot.ts` and `summary-slot.ts` (new), `search.ts`, `command-search.ts` and `summary-search.ts` (new), `ui.ts`, and the shell tests (`SectionDrawer`, `sections`, `search-sources`, `apps`) |
| Builder B: Ads Manager | `builder`, sonnet | Default (UI) | `AdManagerSheet.tsx`, `Approvals.tsx`, `AmTable.tsx`, `ProposalPanel.tsx`, `Confirm.tsx`, `words.ts` and `words.test.ts`, `client/src/styles/ad-manager.css`, `client/src/shell/Home.tsx` (button text only), `shared/ads-contract.ts` (`unavailable` text only), the help page, `AdManager.test.tsx` |
| Builder C: Ads Command Centre | `builder`, sonnet | Default (UI) | `Board.tsx`, `CommandSheet.tsx`, `RateCalls.tsx`, `client/src/styles/command.css`, `client/src/styles/tokens.css`, `docs/design-system.md`, `Command.test.tsx` (new) |
| Builder D: Ads Account Summary | `builder`, sonnet | Default (UI) | `DeepDive.tsx`, `SummarySheet.tsx`, `client/src/styles/summary.css`, `Summary.test.tsx` (new) |

- **A1 and A2 go first, in parallel.** A2 also creates stub `CommandSheet.tsx`, `SummarySheet.tsx`, `command.css` and `summary.css`, so `sections.ts` and `ui.ts` build from the start. When A2 is done, those four files pass to C and D, who fill them in. No two builders work on a file at the same time.
- **B, C and D then build in parallel.**
- **CSS:** the existing board and deep-dive rules stay in `ad-manager.css`, since all three files load in one chunk. New rules go in each tool's own file. If C or D needs an existing rule changed, they ask the lead.
- **No Opus builder:** nothing here is on the hard list.

Release 2 gets its own short plan section and team when it starts: one Sonnet builder for the bridge actions in `brain-skills/tdsapp-ads/`, the app reading them and the triage pop-up.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `ads-routes.test.ts` (extend) | `foldedGroups` is accepted, and bad values are refused, through the real PATCH route. A bad saved value is cleaned on read. | A1 |
| session engine test (extend) | `lastTurn` is `ok` after a good reply, `stopped` after a stop (both the engine path and the before-Claude-saw-it path), and `failed` after an error. | A1 |
| `task-runs.test.ts` (extend) | Old records load. `readRuns` and `recordRun` keep `sdk` and `good`. `good` is set only on `lastTurn: 'ok'`. A stopped newest run keeps the previous `good`. | A1 |
| store tests | `openPast` with `{ in: 'drawer' }` reaches `openChat` on both the normal and `already-open` paths, the default stays the chat screen, and a failed open resolves `false`. `useToolSnapshot` carries `adsDue`. | A1 |
| `logic.test.ts` (new) | `readiness`: `ok` only when all required files are ready, `na` counts as ready, a fetch problem gives `warn`, a missing file gives `bad`, null health is accepted. `dueState`: each cadence's edges, `upcoming`, local days, future and invalid dates, never-run tasks. `needsYou`: severity order and one target per line. `worthALook`: thresholds, and a missing table gives no line. | A2 |
| `SectionDrawer.test.tsx` (extend) | One group shows a fold. A folded group shows the summed badge. Fold state is saved. | A2 |
| `sections.test.ts`, `search-sources.test.ts`, `apps.test.ts` | Each Ads tool opens directly on the right account (`tool:workbench/ads-command-centre` with no visit to Ads Manager first). Every tool sets `search`. "ad manager" still finds Ads Manager. | A2 |
| `AdManager.test.tsx` (update) | The two proposal cards, the jump to Monthly close (focus and outline), the jump target reaching Ads Command Centre, and old `tool:workbench/ad-manager` views still opening. | B |
| `Command.test.tsx` (new) | Columns and order (standup first), type fills and key, readiness tones including a fetch problem, Rate calls opening in the side panel, and the run link opening the drawer chat or showing the line when it can't. | C |
| `Summary.test.tsx` (new) | The six tables render, "Worth a look" jumps, and there's no totals strip without `totals`. | D |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build, on the worktree's own port (3159).
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`. `AdManagerSheet.tsx`, `Board.tsx` and `ProposalPanel.tsx` are expected to shrink; check every other file.
- [ ] Domain gates:
  - UX/UI: the expert reviews against the artifact and `docs/design-system.md`.
  - Copy: UK English and the original task and table text unchanged, checked against `cadence-tasks.json`.
  - Security: no new routes, but one new settings field (`foldedGroups`). A security reviewer lens checks its limits and cleaning. No security expert is needed: nothing touches auth, permissions or secrets.
- [ ] Reviewers: correctness (opus), security for the settings field (opus), UI and accessibility (sonnet).
- [ ] Browser check in the dev app:
  - all three tools and the Ads fold, including folding and reloading;
  - opening each tool directly;
  - switching account across tools;
  - a run link opening the layer, and a stopped run showing "Last good run";
  - the jump to Monthly close, and the jump to the data panel;
  - Rate calls in the side panel;
  - readiness green, amber with a fetch problem, and red;
  - narrow-width scroll inside frames.

## Review outcomes

**Overseer pre-review (2026-11-19, fable):** "not ready to build" on revision 1, with four blocking items. All were checked in code and fixed in revision 2.

Blocking, fixed:
1. `foldedGroups` would be refused by `parsePrefsPatch` and dropped by `sanitise`. Fixed in decision 1.
2. A stopped or failed reply also ends `idle`, so "finished" couldn't be told from the state. Fixed with `LiveSession.lastTurn` and reconciling runs in the main store (decision 9).
3. The builder split missed the shared account loading, the slot and `ui.ts` order, shared CSS and six unowned files. Fixed with `useAdsAccount()` (decision 3), A2 creating the stubs, one CSS file per tool and the new ownership table.
4. Rate calls had nowhere to open in Ads Command Centre. Fixed with decision 6a.

Should, all taken: `dueState` rules and `upcoming` (decision 6), readiness and fetch problems (decision 6), one `useToolSnapshot()` (decision 4), the `jump` carrier (decision 5), synchronous search with the old name kept (decision 11).

Nice, taken: no `Fold` change (decision 1), Q1 dropped, and the extra tests.

Decisions the overseer made: one lazy chunk (decision 12); the triage pop-up is built in Release 2 (decision 13); triage and totals are gated on the field being present; a failed past-chat open shows a line on the card (decision 9).

**Release 1 build and review (2026-11-19).**

Team: Builder A1 (server and stores), A2 (shell and logic), B (Ads Manager), C (Ads Command Centre) and D (Ads Account Summary), all Sonnet; a Sonnet builder to port the 14 board and table tests the split dropped; two Sonnet fix rounds; the lead made small fixes.

Gates: type-check, lint and build pass; 4,268 tests, one failing (below). The large-deletion scan shows only `AdManager.test.tsx`, `AdManagerSheet.tsx`, `Approvals.tsx` and `Board.tsx`, all expected; the 14 tests that left `AdManager.test.tsx` were ported to `Command.test.tsx` and `Summary.test.tsx`, and no behaviour was lost. Browser check on a preview (port 3159, own data folder, read-only on the brain): all three tools, the fold remembered after reload, direct opening, account switching, 600 px with no sideways scroll, no console errors.

Confirmed and fixed:
- Lead browser check: Ads Manager was near empty for any account without proposals, or reviewed by someone else, because the board that used to fill the page moved out. Every account now shows the head, Needs you, the status line and links to the other two tools. Also: duplicate "Worth a look" lines (now name their table's noun), raw dates on the data panel and the standup, a "0" on a folded heading.
- Correctness (opus): a window with no Ads sheet could overwrite newer run records from another window (`reconcile` now re-reads first); "N due" missed the Daily standup; no test on `adsDue`; a `jump` could fire later after a board error. Re-check of the fix round: "No fetch for 2 day" plural, fixed with a test.
- Security sub-lens: `foldedGroups` limits and `__proto__` refused on both the PATCH and the saved file. The lead added a test through the real route.
- UI and accessibility (sonnet): help for the two new tools and the lost Run, chat and table-drag sections (new `help/ads-command-centre.md`, `help/ads-account-summary.md`); Act and Watch shown as words, not colour alone; a focus ring after a mouse jump; standup buttons white like every other card.
- UX gate (opus), nothing blocking: sign-off moved above the file buttons; tool links moved to the end of Ads Manager; "Never run here" on cards with no run; no count on an open group; one shared account head; What's new 0.50.0; shared dot, tag and badge-tone styles; plurals; a status-tint exception in `design-system.md`; an edge on default badges on fills.
- Lead: new `inbox` and `play` icons (the builder had borrowed the To-dos icon); the row-note style.

Dropped or deferred:
- "4 due on <account>" in the drawer: the row is narrow and the picker sits above it.
- The Details button's `aria-pressed` (pre-existing).
- Plan error: decision 8 named an "Ask Claude" button on the tables; it never existed in the app.
- No "Earlier months" fold: `AdsMonthly` carries only the latest month (needs a bridge field; Release 2 candidate).
- "Next step" reads `fm.dry_run` as pass, true or ok: check against real proposal data.

Known failing test, not from this change: `brain-skills/tdsapp-ads/scripts/tdsapp-ads.test.ts` "the hashes match the brain's files today". The brain changed `server.cjs` and `ads-manager/scripts/lib/proposals.cjs` on 2026-11-17. Resolved first in its own branch, `ads-brain-source-refresh` (merged 2026-11-19): every copied part of `server.cjs` still matched, so only its sha256 moved; the test copy of `proposals.cjs` was refreshed for a new optional `follows` field. Nothing needed copying into the brain.

(Release 2 outcomes are filled when it ends.)
