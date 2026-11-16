# Workbench section and Ad Manager

Date: 2026-11-16 · Size: XL (one release, three parts) · Branch: `workbench-ad-manager` · Explainer: (link after overseer review)

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
2. **Full parity from day one**, live Google Ads actions included: decide, dry run, apply, client email draft, record client approval, record decision, sign off the monthly report.
3. The brain Workbench's Ads tab keeps running **side by side**; nothing in it changes.
4. Cortex's Ad Manager **stands on its own**: it calls the same brain skills and scripts, and never needs the Workbench server running or its folder present (Ian: "This should stand on its own and not require the workbench").
5. The name **Workbench** is borrowed from the brain; Cortex's Workbench section is separate from the brain's Workbench page.
6. A cadence card's **Run** starts a **Cortex chat** for that client with the card's prompt (the Workbench opens a Terminal).
7. **Images and Documents stay** as the rail's Apps group.
8. **Processes**: not defined yet. Build the section pattern generically; no Processes section in this release.
9. Bring across the Today roll-up as a **Home card** and a **waiting count on the rail**. **UC Leads is out** (client-specific).
10. The Workbench rail item **hides** when no tool in it is open to the person.
11. Proposal details open in the **right panel**, not inline in the table.
12. A visual explainer: yes.

## Decisions

1. **A section is data, not shell code.** `client/src/shell/sections.ts` exports `SECTIONS: SectionSlot[]` (contract `shared/sections-contract.ts`). A section has id, title, icon, shortcut key and `tools: ToolSlot[]`. A `ToolSlot` is an `AppSlot` plus `summary`, optional `group`, `useVisible()` and `useBadge()`. Adding Processes later is one entry.
   Plain: new areas of Cortex can be added without redesigning the menu.
2. **Drawer and view names.** `DrawerName` gains `section:<id>` (today `'workbench'` only). `View` gains `tool:<sectionId>/<toolId>`. An unknown tool view shows Home, as an unknown app does today.
   Plain: the drawer and the open tool behave exactly like the other drawers and apps.
3. **The rail.** One item per section with at least one visible tool, placed after Skills and before the Apps group. Its count is the sum of its tools' badges. Shortcut `W` for Workbench (free today; check `client/src/shell/ShellProvider.tsx` keys).
   Plain: Workbench sits with the other main areas and shows how many ad proposals wait for you.
4. **The section drawer** (`SectionDrawer`) reuses Help's drawer anatomy: rows are `line` buttons with a 20px `Icon`, the title, the summary as meta, and a `count` when the badge is above 0. The open tool's row has `aria-current="page"` and the `--tint-1` fill. Groups show as `Fold`s only when there are two or more groups; a search row (`.drawer-tools`) only above 8 tools. Choosing a tool opens it; the drawer closes only when it overlays (`modes.drawerOverlays`).
   Plain: the Workbench menu looks and works like Help's list, with icons.
5. **Last tool remembered.** `AppPrefs.lastTool?: Record<string, string>` (section id to tool id). Opening a section whose drawer is already showing doesn't open a tool by itself; it only marks the remembered one.
   Plain: Cortex remembers where you were, without jumping you anywhere unexpectedly.
6. **Tools are searchable.** Every `ToolSlot` sets `search` (the `AppSlot` rule and `apps.test.ts` check apply to tools too). Ad Manager's source finds the tool and each ads account by name; choosing an account opens Ad Manager on it.
   Plain: typing "Ad Manager" or a client's name in Search or jump to gets you there.
7. **The bridge: `tdsapp-ads`.** A new brain skill in `brain-skills/tdsapp-ads/` (`members: false`, `agency: true`, `roles: owner, scout`, `maturity: draft` until Pete releases it). One script, `scripts/tdsapp-ads.cjs`, run by the app through `server/brain/skill-runner.ts` exactly as `tdsapp-todo` is: `node tdsapp-ads.cjs <action>`, one JSON object on stdin, one JSON line on stdout. Actions and shapes are in `shared/ads-contract.ts`.
   Plain: Cortex asks the brain to do ad work the same way you would from the terminal; the app itself never changes a brain file.
8. **The bridge calls the brain's own ads code for every rule.** Proposals, decisions and stamps go through `.claude/skills/ads-manager/scripts/lib/proposals.cjs`; monthly status and sign-off through `monthly.cjs`; dry run and apply by spawning `scripts/apply.cjs` (live only with `--confirmed`); the client email through `scripts/client-draft.cjs`. It loads them from the brain root at run time and never copies their logic.
   Plain: the rules about who may approve and what may be applied live in one place, so Cortex and the Workbench always agree.
9. **What the bridge owns (copied from the Workbench, which it must not depend on).** The board reader (`tools/members/command-centre/lib/ads-board-data.cjs`, `ads-normalize.cjs`), the approvals roll-up (`lib/approvals-board.cjs`), standup set-up and rating (the `/api/standup-config`, `/api/standup-brief`, `/api/standup-feedback` handlers in `server.cjs`), and the 16 cadence cards and their shared prompt (`TASKS` and `BASE` in `public/ads-command-board.html`), moved verbatim to `scripts/cadence-tasks.json`. Each copied file starts with a comment naming its source and the source's git commit; `brain-skills/tdsapp-ads/SOURCES.md` lists them for drift checks.
   Plain: Cortex works on a Mac that never runs the Workbench; the cost is that these pieces exist twice, and the list says where.
10. **Who acts is never taken from the request.** The bridge works out the person from this Mac's git identity matched against the roster (`proposals.cjs` `gitUser` and `findMember`), as the Workbench and the CLI do. Any `by` in stdin is ignored. `skill-runner` already drops `WORKBENCH_AS`. Cortex hides buttons a person can't use (from `mayDecide`-equivalent flags the bridge returns), but the brain library makes the real check.
    Plain: nobody can approve or apply in someone else's name, and hiding a button is never the only lock.
11. **Who sees Ad Manager.** `capabilities` returns `adsAccess` (a gads-proxy config or `google-ads.yaml`, the Workbench's `hasAdsAccess()` rule) and `adsManager` (the skill and its libraries are present). Ad Manager is visible only when both are true and the bridge's capability is `ads-v1` or later. Without the bridge, or with an older one, the tool says "Ad Manager needs the tdsapp-ads skill. Ask Ian or Pete to add it." on its sheet only if someone reaches it by a saved view; the rail stays hidden.
    Plain: only Macs that can reach Google Ads see the Ad Manager, as now.
12. **Live-spend safety.** `apply` runs once per press: no automatic retry anywhere (client, server, bridge). Changes run one at a time per Mac in their own queue; reads run in a second queue so a long apply never freezes the screen. Time limits: reads 15 s, changes 30 s, `dry-run` and `apply` 180 s, `sign-monthly` 120 s. A time-out on `apply` is reported as "We don't know whether this change reached Google Ads. Check the account before trying again." never as a failure to retry. The full output is kept (last 6000 characters, `proxy:` lines removed, as now) and shown on request.
    Plain: a live change to ad spend can't happen twice by accident.
13. **Confirmations are inline**, using the `fieldset.close-confirm` pattern (danger or primary action, Cancel focused, Esc cancels): Approve, Reject, Apply now, Sign off the report. Notes stay required for Reject and Request changes; the text field caps at 1000 characters, as now.
    Plain: the same "are you sure" steps as the Workbench, in Cortex's look.
14. **The screen** (`client/src/tools/ad-manager/`): sheet bar with the Account `SearchSelect` ("(n waiting)" after accounts with proposals for you), Refresh and the panel toggle. One scrolling page: the account's status card; "Waiting for a decision (n)" (open) and "Recent decisions (n, last 14 days)" (closed) as `Fold`s with the Workbench's columns; then the board: data health line (or the set-up card with its three Copy prompt buttons), "What I run on <account>" (five cadence columns, 16 cards, badges, Run), the Daily standup card (Set up, Run, Rate calls), Standup account triage, and Ads account deep dive (six sortable tables, the Workbench's column types). Cards sit in a tray, per `docs/design-system.md`. The board's theme toggle is dropped.
    Plain: everything the Ads tab shows today, in the same order, in Cortex's look.
15. **"Recent decisions" says 14 days.** The Workbench labels it "last 30 days" but its window is 14 (`RECENT_DAYS`). Cortex keeps 14 and says so. Ian can change this.
    Plain: the label tells the truth; the list is the same.
16. **The right panel** (`Panel` on the tool slot, label "Proposal") shows the selected proposal: the key/value table (Expected effect, Risk and rollback, Learning window, Operations file, Executor, Dry run, Evidence, Client approval, Proposed by, Approved, Changes requested, Warnings), "Full proposal text" as a `Fold`, the action buttons the person may use, and the last result. After a decision the next waiting proposal opens, as now. Rate calls (standup) also uses the panel.
    Plain: the details have room to breathe, and the table stays readable.
17. **Run starts a chat.** A cadence card's Run (and the standup's Run) calls `newChat({ client })` and sends the card's prompt at once, as the Workbench starts its session at once. The client is the account's client slug.
    Plain: the work happens in a Cortex chat you can watch, approve and come back to.
18. **Reports and PDFs open in the file viewer.** A new viewer request kind, `{ kind: 'brain-file', path }`, served by a new read route that allows only `^clients/[a-z0-9-]+/(reports|proposals)/.+\.(pdf|html|md|json|csv|txt)$`, no `..`, resolved inside the brain's real path (the Workbench's rule). The app reads these files directly: reading the brain is allowed.
    Plain: reports open beside your work, and nothing outside the client report folders can be read this way.
19. **Fresh by itself.** `server/brain/watch.ts` also watches `clients/*/proposals/`, `clients/*/reports/monthly/`, `clients/*/context/google-ads/board/`, `clients/*/data/_fetch-status.json` and `clients/*/standup/`, and tells the client that ads data changed; the screen, Home card and rail count reload their summaries. No polling, and no 0.8 s re-fetch after actions (an action's reply carries the new state of that proposal).
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
| Builder A: sections | `builder`, sonnet, medium | default (UI, wiring) | `client/src/shell/sections.ts`, `client/src/shell/SectionDrawer.tsx` (+ test), `client/src/shell/Rail.tsx`, `client/src/shell/contract.ts`, `client/src/shell/ShellProvider.tsx`, `client/src/shell/apps.test.ts`, `client/src/shell/Icon.tsx`, `client/src/App.tsx`, `client/src/store.tsx` (View, `openTool`), `client/src/styles/sections.css`, `help/workbench.md` |
| Builder B: bridge and server | `builder`, opus, high | hard list: live Google Ads writes, permissions and identity, data integrity of shared proposal files | `brain-skills/tdsapp-ads/**`, `brain-skills/README.md`, `server/brain/ads-skill.ts` (+ test), `server/brain/watch.ts`, `server/http/routes.ts` (ads and brain-file routes only), `server/http/*.test.ts` for those routes, `server/settings.ts` (validating the new prefs fields) |
| Builder C: Ad Manager screen | `builder`, sonnet, medium | default (UI) | `client/src/tools/ad-manager/**`, `client/src/shell/Home.tsx` (Ads approvals card), `client/src/shell/FileViewer.tsx` (brain-file kind), `client/src/api.ts` (ads calls), `client/src/styles/ad-manager.css`, `help/ad-manager.md` |

The lead writes both contract files and the `AppPrefs` additions in `shared/contract.ts` before builders start. Where `shared/ads-contract.ts` says `unknown` (pack, monthly, board health, tables, standup, triage), Builder B replaces it with exact types read from the Workbench source before Builder C uses those fields; until then C builds against the Workbench's field names in the inventory below. No file appears in two rows.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `brain-skills/tdsapp-ads/scripts/tdsapp-ads.test.ts` | Against a fixture brain: `approvals` matches the Workbench's roll-up for the same files (including "mine" rules and the 14-day window); `board` matches `ads-board-data.cjs` output for the fixture CSVs; `decide` goes through `proposals.cjs` and refuses a non-reviewer; `by` in stdin is ignored; `apply` without `confirmed` never passes `--confirmed`; bad ids and slugs are refused; `standup-setup` never overwrites | Builder B |
| `server/brain/ads-skill.test.ts` | Two queues (a slow `apply` doesn't block `board`); time limits per action; `apply` is never retried and a time-out gives the "don't know" message; missing or old bridge gives `capabilities` unavailable | Builder B |
| `server/http/ads-routes.test.ts` | Routes go through `checkRequest` (content type, origin) like every other change route; brain-file route refuses `..`, other folders, other extensions and symlinks out of the brain | Builder B |
| `client/src/shell/SectionDrawer.test.tsx` | Rows show icon, title, summary, count; open tool marked current; folds only with 2+ groups; search only above 8 tools; hidden section has no rail item | Builder A |
| `client/src/shell/apps.test.ts` | Every tool has a search source (or a listed reason) | Builder A |
| `client/src/tools/ad-manager/*.test.tsx` | Account choice and first-use default; folds remembered; panel opens the selected proposal and the next one after a decision; buttons follow the bridge's flags; inline confirms; Run sends the card prompt verbatim with the client; Apply button disabled while running | Builder C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build; preview on the project's port 3878 with its own data folder (memory: worktree-for-every-task)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: **security** (live writes, identity, the brain-file route, child processes) and **UX/UI** (consistency with `docs/design-system.md`, accessibility)
- [ ] Browser check: rail item and drawer (wide, narrow, icons only), Ad Manager on a fixture brain and on the real brain read-only, Home card, file viewer with a PDF
- [ ] With Pete: dry run on a real account; Apply now only by Ian or Pete on a harmless change they choose

## Review outcomes

(Filled at step 10.)

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
