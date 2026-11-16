# Workbench section and Ad Manager

Date: 2026-11-16 · Size: XL (one release, three parts) · Branch: `workbench-ad-manager` · Explainer: https://claude.ai/artifact/8xfXHZeKSD2JuLi8a32tUk (`docs/workbench-explainer.html`)

Brain to-do: `todo/20261116-cortex-ad-manager-rebuild.md` (due 2026-11-19; "Test with Pete" before launch).

## Objective

Give Cortex a reusable navigation pattern, the **section**: a rail item that opens a left drawer listing
tools as icon and title rows, where each tool opens on the main sheet. **Workbench** is the first section
and **Ad Manager** its first tool: a native rebuild of the brain Workbench's Ads tab (approvals panel and
ads board) with the same content and features, driven by the brain's own `ads-manager` skill and scripts
and needing no Workbench server. Later sections, starting with Processes, reuse the pattern with no new
shell code.

## User decisions (fixed)

1. A tool opens on the **main sheet** (like Images and Documents); the drawer is the launcher (Ian, 2026-11-16).
2. **Drawer and view names.** `DrawerName` gains one fixed member, `'section'`; which section shows is `ShellState.section` (like `helpPage`), set by `open-section` / `toggle-section`, never saved (visibility loads after the shell). Every `Record<DrawerName, …>` (`Rail.tsx:17`, `App.tsx:58`, `search-sources.ts:81`) stays exhaustive. `View` gains `tool:<sectionId>/<toolId>`; an unknown or invisible tool view shows Home. (Overseer: a template-literal drawer name would silently break those records.)
   Plain: the drawer and the open tool behave exactly like the other drawers and apps.
7. **The bridge: `tdsapp-ads`.** A new brain skill in `brain-skills/tdsapp-ads/` (`members: false`, `agency: true`, `roles: owner, scout`, `maturity: draft` until Pete releases it). One script, `scripts/tdsapp-ads.cjs`, run by the app through `server/brain/skill-runner.ts` as `tdsapp-todo` is: `node tdsapp-ads.cjs <action>`, one JSON object on stdin, one JSON line on stdout. Actions and shapes are in `shared/ads-contract.ts`. Visibility also needs `skillAccess` to allow it (as to-dos, `server/brain/todos.ts:282`), so only owners and scouts see it until Pete releases the skill.
   Plain: Cortex asks the brain to do ad work the same way you would from the terminal; the app itself never changes a brain file.
8. **Processes**: not defined yet. Build the section pattern generically; no Processes section in this release.
9. Bring across the Today roll-up as a **Home card** and a **waiting count on the rail**. **UC Leads is out** (client-specific).
10. The Workbench rail item **hides** when no tool in it is open to the person.
11. Proposal details open in the **right panel**, not inline in the table.
12. A visual explainer: yes.

## Decisions

1. **A section is data, not shell code.** `client/src/shell/sections.ts` exports `SECTIONS: SectionSlot[]` (contract `client/src/shell/sections-contract.ts`). A section has id, title, icon, shortcut key and `tools: ToolSlot[]`. A `ToolSlot` is an `AppSlot` plus `summary`, optional `group`, and pure `visible(snap)` / `badge(snap)` functions of a store snapshot (like `SearchSource`). Adding Processes later is one entry.
   Plain: new areas of Cortex can be added without redesigning the menu.
2. **Drawer and view names.** `DrawerName` gains `section:<id>` (today `'workbench'` only). `View` gains `tool:<sectionId>/<toolId>`. An unknown tool view shows Home, as an unknown app does today.
   Plain: the drawer and the open tool behave exactly like the other drawers and apps.
3. **The rail.** One item per section with at least one visible tool, placed after Skills and before the Apps group. Its count is the sum of its tools' badges. Shortcut `W` for Workbench (free: `client/src/state/keys.ts`).
   Plain: Workbench sits with the other main areas and shows how many ad proposals wait for you.
4. **The section drawer** (`SectionDrawer`) reuses Help's drawer anatomy: rows are `line` buttons with a 20px `Icon`, the title, the summary as meta, and a `count` when the badge is above 0. The open tool's row has `aria-current="page"` and the `--tint-1` fill. Groups show as `Fold`s only when there are two or more groups; a search row (`.drawer-tools`) only above 8 tools. **Choosing a tool opens it and closes the drawer, as opening an app does** (`ShellProvider.tsx:262`); otherwise the right panel floats under 1400px and the Proposal panel would turn modal on laptops (overseer).
   Plain: the Workbench menu looks and works like Help's list, with icons, and gets out of the way when a tool opens.
5. **Last tool remembered.** `AppPrefs.lastTool?: Record<string, string>` (section id to tool id). Opening a section whose drawer is already showing doesn't open a tool by itself; it only marks the remembered one.
   Plain: Cortex remembers where you were, without jumping you anywhere unexpectedly.
6. **Tools are searchable.** Every `ToolSlot` sets `search` (the `AppSlot` rule and `apps.test.ts` check apply to tools too). Ad Manager's source finds the tool and each ads account by name; choosing an account opens Ad Manager on it.
   Plain: typing "Ad Manager" or a client's name in Search or jump to gets you there.
7. **The bridge: `tdsapp-ads`.** A new brain skill in `brain-skills/tdsapp-ads/` (`members: false`, `agency: true`, `roles: owner, scout`, `maturity: draft` until Pete releases it). One script, `scripts/tdsapp-ads.cjs`, run by the app through `server/brain/skill-runner.ts` exactly as `tdsapp-todo` is: `node tdsapp-ads.cjs <action>`, one JSON object on stdin, one JSON line on stdout. Actions and shapes are in `shared/ads-contract.ts`.
   Plain: Cortex asks the brain to do ad work the same way you would from the terminal; the app itself never changes a brain file.
8. **The bridge calls the brain's own ads code for every rule.** Proposals, decisions and stamps go through `.claude/skills/ads-manager/scripts/lib/proposals.cjs`; monthly status and sign-off through `monthly.cjs`; dry run and apply by spawning `scripts/apply.cjs` (live only with `--confirmed`); the client email through `scripts/client-draft.cjs`. It loads them from the brain root at run time and never copies their logic.
   Plain: the rules about who may approve and what may be applied live in one place, so Cortex and the Workbench always agree.
9. **What the bridge owns (copied from the Workbench, which it must not depend on).** The board reader (`tools/members/command-centre/lib/ads-board-data.cjs`, `ads-normalize.cjs`), the approvals roll-up (`lib/approvals-board.cjs`), the standup logic (`lib/standup-board.cjs`, and the set-up / brief / feedback handlers in `server.cjs` 1329-1370), and, moved verbatim to `scripts/cadence-tasks.json`: the 16 cards (`TASKS`), their shared prompt (`BASE`), `STANDUP_PROMPT` (`ads-command-board.html:481`), the three set-up prompts and `ACTION_LABELS` (`:476-491`), and the request-changes revise prompt (`server.cjs:1275`). Each copied file starts with a comment naming its source; `brain-skills/tdsapp-ads/SOURCES.md` records each source's sha256 (no git in the brain), and a test compares them when the Workbench folder is present (skipped otherwise), so drift shows up as a failing check.
   Plain: Cortex works on a Mac that never runs the Workbench; the cost is that these pieces exist twice, and a check tells us when they drift.
10. **Who acts, and who may.** The bridge works out the person with `P.gitUser()` matched against the roster and passes `by: <that slug>` to the library, as the CLI does (`proposals.cjs:527-531`); nothing in stdin names the actor, and `skill-runner` already drops `WORKBENCH_AS`. The brain library checks `mayDecide` only inside approve, reject and request changes; `decided` (`P.stamp`), `dry-run`, `apply` (falls back to `$USER`, `apply.cjs:120`) and `client-draft` have no check, and the Workbench's only lock was its server guard. So the bridge requires a roster identity for every change action, and also `P.mayDecide(me, fm)` for `decided`, `dry-run`, `apply` and `client-draft`, each with a test. Cortex hides buttons from the flags the bridge returns, but never relies on hiding. If the bridge's person differs from the app's own identity (`tools/whoami.cjs`), every action is hidden with one plain line saying whose name Ad Manager would act in.
    Plain: nobody can approve, apply or stamp in someone else's name, and hiding a button is never the only lock.
11. **Who sees Ad Manager.** `capabilities` returns `features` (cached by `createCapabilityProbe`), `adsAccess` (a gads-proxy config or `google-ads.yaml`, the Workbench's `hasAdsAccess()` rule), `adsManager` (the skill and the exports the bridge needs are present) and `me` (the last two not cached). Ad Manager is visible only when `features` has `ads-v1`, both flags are true and `skillAccess` allows it. The store keeps an `AdsSummary` (visible, me, waiting per client), loaded at boot and on `ads-changed`, which the rail, drawer, Home card and search read. A saved `tool:` view whose tool isn't visible shows Home.
    Plain: only Macs that can reach Google Ads, and people the skill is released to, see the Ad Manager.
12. **Live-spend safety** (overseer B1). `apply.cjs` runs its executor with `spawnSync` (`apply.cjs:93`), so killing the bridge on a time limit would leave the live write running while the proposal still passes `checkApproved`: a second press could write twice. So:
    - `apply`, `dry-run` and `sign-monthly` are spawned **detached and never killed**. Their time limit (180 s, 180 s, 120 s) ends only the wait: the app replies `unknown-outcome` for apply (`internal` for the others) and keeps the change queue held until the process exits.
    - The server writes an in-flight entry (`client`, `id`, `pid`, start) to `ads-inflight.json` in the app's own data folder before an apply starts and removes it when the bridge replies. While an entry exists, including after an app restart mid-apply, `canApply` is false and the panel says "We don't know whether this change reached Google Ads. Check the account, then press I've checked the account." An entry whose process has exited and whose proposal shows `applied_at` clears itself.
    - Nothing retries `apply`: not the client, the server or the bridge. A network failure on the apply call shows the unknown-outcome wording, not the generic error. The Apply button is busy (`aria-disabled`) from press to reply.
    - Change actions run one at a time per Mac (`createQueue`); reads run unqueued, sharing identical in-flight reads, so a long apply never freezes the screen. Other limits: reads 15 s, simple changes 30 s, client draft 60 s.
    - The output is kept as now (last 6000 characters, `proxy:` lines removed) and shown on request.
    - Known, unchanged risk: two Macs applying the same proposal at the same moment. The Workbench has it too; tell Pete.
    Plain: a live change to ad spend can't happen twice by accident, even if something times out or the app restarts.
13. **Confirmations are inline**, using the `fieldset.close-confirm` pattern (danger or primary action, Cancel focused, Esc cancels): Approve, Reject, Apply now, Sign off the report. Notes stay required for Reject and Request changes; the text field caps at 1000 characters, as now.
    Plain: the same "are you sure" steps as the Workbench, in Cortex's look.
14. **The screen** (`client/src/tools/ad-manager/`): sheet bar with the Account `SearchSelect` ("(n waiting)" after accounts with proposals for you), Refresh and the panel toggle. One scrolling page: the account's status card; "Waiting for a decision (n)" (open) and "Recent decisions (n, last 14 days)" (closed) as `Fold`s with the Workbench's columns; then the board: data health line (or the set-up card with its three Copy prompt buttons), "What I run on <account>" (five cadence columns, 16 cards, badges, Run), the Daily standup card (Set up, Run, Rate calls), Standup account triage, and Ads account deep dive (six sortable tables, the Workbench's column types). Cards sit in a tray, per `docs/design-system.md`. The board's theme toggle is dropped.
    Plain: everything the Ads tab shows today, in the same order, in Cortex's look.
15. **"Recent decisions" says 14 days.** The Workbench labels it "last 30 days" but its window is 14 (`RECENT_DAYS`). Cortex keeps 14 and says so. Ian can change this.
    Plain: the label tells the truth; the list is the same.
16. **The right panel** (`Panel` on the tool slot, label "Proposal") shows the selected proposal: the key/value table (Expected effect, Risk and rollback, Learning window, Operations file, Executor, Dry run, Evidence, Client approval, Proposed by, Approved, Changes requested, Warnings), "Full proposal text" as a `Fold`, the action buttons the person may use, and the last result. After a decision the next waiting proposal opens, as now. Rate calls (standup) also uses the panel.
    Plain: the details have room to breathe, and the table stays readable.
17. **Run starts a chat.** A cadence card's Run (and the standup's Run) calls the store's new `startChat(prompt, client, { open: true })`, which starts a new session directly (as `openPast` does), never `send` (which would post into whatever chat is open, overseer B3). The prompt is the card's, verbatim; the client is the account key.
    Plain: the work happens in a new Cortex chat you can watch, approve and come back to.
18. **Reports and PDFs open in the existing file viewer.** `GET /api/ads/file?p=` checks `ADS_FILE_PATTERN`, refuses `..`, then resolves the path with the existing `libraryItemForPath` (`server/brain/index.ts:128`) and returns the `LibraryItem`; the client opens it with the existing `{ kind: 'file', item }` request without delete. `reports/` and `proposals/` are already library folders (`library-rules.ts`). PDFs, sandboxed HTML and markdown show; JSON and CSV offer Download only. No raw brain-file route: brain HTML served on the app's own origin could call the app's own routes (overseer B4).
    Plain: reports open beside your work, through the same safe viewer as every other file.
19. **Fresh by itself.** `clients/` is already watched (`server/brain/watch.ts:29`). The watch callback also matches the ads paths (`clients/*/proposals/`, `reports/monthly/`, `context/google-ads/board/`, `data/_fetch-status.json`, `standup/`) before its `isNeverListed` return (`:83`) and publishes a separate `{ type: 'ads-changed' }` app event (not a `BrainArea`, which an older tab would treat as a full reload). The store reloads `AdsSummary`; Ad Manager reloads what it shows. No polling, and no re-fetch timer after actions (a change reply carries the proposal's new state). A custom standup `data_path` isn't watched; Refresh covers it.
    Plain: when the Monday check or Pete's morning fetch lands, the screen updates without a click.
20. **Lighter loading.** `approvals` returns summaries (no proposal bodies); `proposal` returns one in full when opened. `board` returns one account's data.
    Plain: the screen loads faster, and it only fetches what you look at.
21. **Remembered per person** in `AppPrefs` (all optional fields): `adsAccount?: string`, `adsFolds?: Record<string, boolean>` (key `<client>:<open|recent>`), `lastTool` (decision 5). First use opens the first account with something waiting, as now.
    Plain: Cortex opens on the account you last used, with the sections the way you left them.
22. **Home card "Ads approvals"**, shown only when Ad Manager is visible and something is waiting: one row per client with its waiting count; choosing one opens Ad Manager on that account. Reuses Home's card and row pieces.
    Plain: your morning view tells you which clients need an ads decision.
23. **Help.** `help/workbench.md` (the section) and `help/ad-manager.md` (the tool), following `docs/help-standard.md`, in UK English; Ad Manager's sheet bar links to its page with `HelpLink`.
    Plain: each new part explains itself in the usual place.
24. **Backward compatibility.** The Workbench and every brain file are untouched; Cortex reads and writes the same files only through the same libraries. New `AppPrefs` fields are optional; an older app ignores them. An older Cortex has no Workbench item. A brain without `tdsapp-ads`, or with an older `ads-manager` (missing an export the bridge needs), gets `capabilities` saying so and the tool stays hidden. The bridge tolerates unknown proposal fields and statuses (shows them as they are).
    Plain: nothing that works today stops working, on any version mix.
25. **Copying `tdsapp-ads` into the brain needs Ian's yes**, as for every `tdsapp-*` skill. Until then the feature is invisible on every Mac.
    Plain: merging this release changes nothing anyone sees until the skill is installed.
26. **Request changes starts the revising chat in the background.** The Workbench opens a revising session at once. Cortex calls `startChat(revisePrompt, client, { open: false })` after the decision lands, and the result line offers "Open chat". (Overseer decision: keeps the reviewer on the panel to go on deciding.)
    Plain: asking for changes sets Claude revising the proposal without pulling you away.

## Later (not in this release)

- One shared cadence-prompt file the Workbench reads too (a brain change; removes the copy in decision 9).
- Proposals in Search or jump to; a notification when a proposal arrives for you.
- A Processes section.

## Contract

- `client/src/shell/sections-contract.ts`: `SectionSlot`, `ToolSlot`, view and drawer names, store additions.
- `shared/ads-contract.ts`: bridge actions, stdin and reply shapes, error codes, time limits, capability, path rule, routes.
- `shared/contract.ts` `AppPrefs`: `lastTool`, `adsAccount`, `adsFolds` and their limits (all optional).

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable, high | plan critique and sign-off | (read-only) |
| Builder A: sections and store | `builder`, sonnet, medium | default (UI, wiring) | `client/src/shell/sections.ts`, `client/src/shell/SectionDrawer.tsx` (+ test), `client/src/shell/Rail.tsx`, `client/src/shell/contract.ts`, `client/src/shell/ShellProvider.tsx`, `client/src/shell/apps.test.ts`, `client/src/shell/Icon.tsx`, `client/src/shell/search-sources.ts` (+ test), `client/src/state/shell.ts`, `client/src/state/keys.ts` (+ tests), `client/src/help/{contract,context,topics}.ts`, `client/src/App.tsx`, `client/src/store.tsx` (View, `openTool`, `toolArg`, `startChat`, `ads` summary and `reloadAds`, the `ads-changed` event), `client/src/styles/sections.css`, `help/workbench.md` |
| Builder B: bridge and server | `builder`, opus, high | hard list: live Google Ads writes (B1), permissions and identity (B2), data integrity of shared proposal files | `brain-skills/tdsapp-ads/**`, `brain-skills/README.md`, `server/brain/ads-skill.ts` (+ test), `server/brain/skill-runner.ts` (detached, no-kill runs), `server/brain/index.ts`, `server/brain/watch.ts`, `server/http/routes.ts` (ads routes only), `server/http/server.ts`, `server/http/ads-routes.test.ts`, `server/settings.ts` (validating the new prefs fields) |
| Builder C: Ad Manager screen | `builder`, sonnet, medium | default (UI) | `client/src/tools/ad-manager/**` (screen, panel, bar, search source, slot), `client/src/shell/Home.tsx` (Ads approvals card), `client/src/api.ts` (ads calls; apply's network failure → unknown-outcome wording), `client/src/styles/ad-manager.css`, `help/ad-manager.md` |

The lead writes both contract files, the `AppPrefs` additions and the `ads-changed` `AppEvent` in `shared/contract.ts` before builders start; `sections.ts` imports Ad Manager's slot from `client/src/tools/ad-manager/slot.ts` (C's file), so A builds against a stub slot until C's lands. Where `shared/ads-contract.ts` says `unknown` (pack, monthly, board health, tables, standup, triage), Builder B replaces it with exact types read from the Workbench source before Builder C uses those fields; until then C builds against the Workbench's field names in the inventory below. No file appears in two rows.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `brain-skills/tdsapp-ads/scripts/tdsapp-ads.test.ts` | Against a fixture brain with copied ads-manager libraries and a **stub `apply.cjs`** (the libraries find `ROOT` from `__dirname`; never run the real apply: the dev Mac holds live credentials): `approvals` matches the Workbench roll-up for the same files ("mine" rules, 14-day window); `board` matches `ads-board-data.cjs` for the fixture CSVs; `decide` refuses a non-reviewer; `decided`, `dry-run`, `apply` and `client-draft` refuse someone who isn't the reviewer, owner or an owner; a person not on the roster is refused every change; `by` in stdin is ignored; `apply` passes `--confirmed` only for `apply`; bad ids, account keys and slugs are refused; `standup-setup` never overwrites; SOURCES.md hashes match the Workbench files when present | Builder B |
| `server/brain/ads-skill.test.ts` | A slow `apply` doesn't block `board`; identical reads share one run; per-action time limits; on the apply limit the reply is `unknown-outcome`, the process is NOT killed, the change queue stays held until it exits, and the in-flight entry blocks `canApply` (also after a simulated restart) until cleared; `apply` is never retried; missing or old bridge gives `visible: false` | Builder B |
| `server/http/ads-routes.test.ts` | Every ads route goes through `checkRequest` (content type, origin), tested through the real gate (memory: test new requests through the gate); the file route refuses `..`, other folders, other extensions and paths outside the library, and returns a `LibraryItem` | Builder B |
| `client/src/state/shell.test.ts`, `keys.test.ts` | `open-section` / `toggle-section`; section never restored on reload; `W` toggles Workbench; opening a tool closes the drawer | Builder A |
| `client/src/shell/SectionDrawer.test.tsx` | Rows show icon, title, summary, count; open tool marked current; folds only with 2+ groups; search only above 8 tools; hidden section has no rail item | Builder A |
| `client/src/shell/apps.test.ts` | Every tool has a search source (or a listed reason) | Builder A |
| `client/src/tools/ad-manager/*.test.tsx` | Account choice and first-use default; folds remembered; panel opens the selected proposal and the next one after a decision; buttons follow the bridge's flags; inline confirms; Run calls `startChat` with the card prompt verbatim and the account key, never `send`; request changes starts a background chat and offers Open chat; an in-flight apply shows the unknown-outcome line and hides Apply; Apply button disabled while running | Builder C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build; preview on the project's port 3878 with its own data folder (memory: worktree-for-every-task)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: **security** (live writes, the in-flight guard, identity, the file route, detached child processes) and **UX/UI** (consistency with `docs/design-system.md`, accessibility)
- [ ] Browser check: rail item and drawer (wide, narrow, icons only), Ad Manager on a fixture brain and on the real brain read-only, Home card, file viewer with a PDF
- [ ] With Pete: dry run on a real account; Apply now only by Ian or Pete on a harmless change they choose

## Review outcomes

2026-11-16. Every finding was checked in code before it was fixed. Gates on the final commit: typecheck, lint (0 errors), 4064 tests, build, deletion scan.

- **Lead, after the build:** apply.cjs exit 3 leaves a gads-write proposal approved and unapplied, so it could be applied again. That is now `unknown-outcome`.
- **Security expert (3 confirmed, 0 dropped):**
  - "I've checked the account" could clear the lock while the apply still ran, which meant a double write. Now refused while the pid is alive and the apply is under 1 hour old.
  - Newlines in client-approval fields broke the frontmatter. Now flattened.
  - The gateway secret could show in curl error output. Now hidden.
- **Correctness reviewer (4 confirmed, 0 dropped):**
  - A transient error hid Ad Manager. Now the store keeps the last summary.
  - Search showed accounts on Macs without Google Ads access.
  - Unknown-outcome output was dropped; it now shows.
  - "A chat is revising" showed when no chat started.
- **UX and accessibility expert (10 confirmed, 0 dropped):**
  - Fixed: focus after confirms, persistent status regions, the Confirm pattern, plain status words, sort headers, current rail item, quiet Refresh, visible file notes, identity wording, and a help claim that wasn't true.
  - Two calls against this plan: the drawer's current row uses the app standard (#fff + lift-1), not the tint in decision 4; fold counts use Fold's `count` badge, not "(n)" in decision 14.
- **Correctness recheck of the fixes (2 confirmed + 2 test gaps, 0 dropped):**
  - apply.cjs:149 maps any live gads-write failure, including a crash after the write, to exit 4 ("nothing changed"). The bridge now fails closed: a 4 on a still-applicable proposal is `unknown-outcome` unless the output says the dry run failed.
  - A reused pid could lock "I've checked" forever; fixed by the 1-hour age limit.
  - The two test gaps were pinned.
- **Brain follow-up (outside Cortex):** apply.cjs should pass a live gads-write exit through as 1 rather than 4. The Workbench has the same gap.
- **Not done here:** copying `tdsapp-ads` into the brain, and the dry run with Pete on a real account. The file viewer with a PDF and the real brain read-only were not checked in the browser.

## Appendix: the Workbench Ads tab today (source of truth for parity)

Read-only survey of `~/agencybrain/tools/members/command-centre` (2026-11-16). Use `command-centre`, never `command-centre-preview` (a divergent copy). Paths below are relative to that folder unless they start with `.claude/`.

**Account dropdown** (`cc.js initAdsAccount`): accounts from the board data plus any supervised client; "(n waiting)" after accounts with proposals for you; first use picks the first account with something waiting; drives both the panel and the board.

**Approvals panel** (`index.html` 179-205, `cc.js` 2029-2296, `lib/approvals-board.cjs`):
- Header: count ("N waiting, M to apply" or "nothing waiting"), Refresh, Hide/Show.
- Empty states: no client names you as reviewer; "<account> is not on the supervised ads-manager yet"; "<client>'s proposals are reviewed by X".
- Status table per client: latest weekly pack (date, "N act, M watch", provisional flag, Open report); monthly close (month, state pill: signed off by/when, draft month-to-date (can't sign), draft not reviewed with staleness reason; PDF button final if signed else draft; Close notes; Email draft); open proposal count; verification findings from `pack.json`.
- "Last result" box with Dismiss, kept across list rebuilds.
- "Waiting for a decision (n)", open: ID, Tier (T0-T3 pill), Type, Proposal, § (`framework_section`), Campaigns, Expires, Status, Details. Detail: Expected effect, Risk and rollback, Learning window (days + lock type), Operations file, Executor, Dry run, Evidence, Client approval state, Proposed by, Approved, Changes requested, Warnings; "Full proposal text"; action buttons; output. One detail open at a time; after a decision the next opens.
- "Recent decisions", shut: Date, ID, Tier, Proposal, Decision (rejected, "approved, applied", decided, verified, failed, "expired unanswered"), By, Reason/outcome. Window `RECENT_DAYS` = 14.

**Actions** (all POSTs need a roster identity; the real rule is `proposals.cjs` `requireHuman`/`mayDecide`):
- Approve (confirm) → `P.approve`; if `needs_client_approval`, also `scripts/client-draft.cjs` (markdown + Gmail draft, never sent).
- Request changes (note required) → `P.requestChanges`. Reject (note required, confirm) → `P.reject`.
- Dry run (change proposals with an operations file, status proposed, changes-requested or approved) → `node .claude/skills/ads-manager/scripts/apply.cjs --client= --id=`; saves dry-run output beside the proposal.
- Apply now (approved change, confirm) → same with `--confirmed`: LIVE write via gads-write / update-rsa / pmax-text on this Mac's credentials; re-validates approval, reads back, logs, stamps.
- Draft the client email → `client-draft.cjs --json [--again]`. Record client approval (who/how) → `P.recordClientApproval` (apply refuses without it when required). Record decision (decision-type, approved) → `P.stamp` status applied + outcome.
- Sign off the report (confirm, optional note; complete, unsigned month with a body) → `monthly.cjs sign` in the viewer's name, builds the final PDF.
- Open report / PDF / Close notes / Email draft → `/reports/view?p=` (path rule in `ADS_FILE_PATTERN`).

**Board** (`public/ads-command-board.html`, `lib/ads-board-data.cjs`, `lib/ads-normalize.cjs`):
- Data health line: per-file dots for dailyPerf, summary, search80, keyword80, quality, productID, geo_locations, pages, assetFatigue, campSettings, campaign_budgets, im_pmax_categories, im_pmax_search_terms (ok, stale, missing, wrong-shape, na); folder; "fresh through"; daily fetch (lastRun, errors, ageHours; flagged with errors or over 36 h). No data: "Get your account data flowing" with three Copy prompt buttons (discover, 8020 sheet, proxy).
- "What I run on <account>": Daily, Weekly, Fortnightly, Monthly, Quarterly; 16 cards (d-spend, d-policy, d-tracking, w-search, w-pacing, w-newkw, w-negatives, f-assets, f-bidstrat, f-products, m-audit, m-rsa, m-report, q-structure, q-competitor, q-cro), each Report/Insight/Action with title, description, optional badge, Run. Prompts: `TASKS` + `BASE` in the HTML.
- Daily standup card: Set up (`/api/standup-config`: creates `clients/<k>/standup/config.json` from enabled campaigns, never overwrites), Run (standup prompt), Rate calls (`/api/standup-brief`, `/api/standup-feedback`: 1-5 per campaign + note into the dated standup folder); verdict line (call, top campaign, date, "stale, rerun").
- Standup account triage: the selected account's latest verdict (flagged / hold / run / "+ set up").
- Ads account deep dive: top campaigns (30 days by spend), top search terms, wasted spend (zero-conversion terms), top keywords, top products (Shopping only), Quality Score spread; column types text, money, int, num1, x, pct, qs; sortable.

**Data:** `clients/*/config/management.json`; `clients/<c>/proposals/*.md`; `clients/<c>/proposals/evidence/<YYYYMMDD>/pack.json`; `clients/<c>/reports/monthly/<YYYY-MM>-monthly-close.json`; `clients/<k>/context/google-ads/board/*.csv` (or standup config `data_path`); `.claude/accounts.json`; `clients/<k>/data/_fetch-status.json`; `clients/<k>/standup/<YYYYMMDD>/brief.json`. Producers: `scripts/ads-board-ingest.cjs` (06:50 daily on Pete's Mac), gads-context fetch (05:00), ads-manager weekly (Mon 06:00), monthly (3rd).

**Visibility:** whole tab hidden unless `hasAdsAccess()` (gads-proxy config or `google-ads.yaml`). Owner role sees every client; a reviewer sees their own.

## Pre-review outcomes (overseer, 2026-11-16)

All five blocking items were checked in code and taken into the plan and contracts:
- B1 apply could write twice after a time-out → decision 12 (detached, never killed, in-flight file, queue held).
- B2 the library doesn't check who acts for `decided`, `dry-run`, `apply`, `client-draft` → decision 10 (bridge checks).
- B3 `send` posts into the open chat → `startChat` (decision 17, contract).
- B4 FileViewer loads library items only; raw brain HTML is unsafe → decision 18 (resolve to a `LibraryItem`).
- B5 unowned files and the A/C seam → team table, `AdsSummary` in the store.
Should items taken: fixed `'section'` drawer name (2), tool opens and drawer closes (4), queues (12), `features` naming (11), full copy list and sha256 drift check (9), request changes in the background (26), identity mismatch line (10), `skillAccess` gate (7, 11), `ads-changed` event (19), account key pattern and one-campaign standup feedback (contract), stub apply in tests.
