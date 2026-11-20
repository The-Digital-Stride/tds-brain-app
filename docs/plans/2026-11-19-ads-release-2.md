# Ads section, Release 2: triage pop-up, totals, earlier months, draft the change, result links

Date: 2026-11-19 · Size: L · Branch: `ads-release-2` · Explainer: none (Ian: no)

Follows `docs/plans/2026-11-19-ads-workbench-sections.md` (Release 1, shipped v0.50.0). Its Release 2 decisions 13 to 15
are replaced by this plan.

## Objective

Give the three Ads tools the parts that need the brain's bridge skill (`tdsapp-ads`) to supply more: every account's
standup at a glance, headline totals with a comparison, past monthly reports, the brain Workbench's new "Record and
draft the change", and a link to a teammate's saved result.

## User decisions (fixed)

- Scope (Ian, 2026-11-19): the triage pop-up and totals (old decisions 13, 14), plus all four extras: the 7 / 30 / 90-day
  switch (old Q2), Earlier months on Monthly close, a teammate's result link (old Q3), and "Record and draft the change".
- Landing: merge and push when signed off. Ian copies `brain-skills/tdsapp-ads/` (without the test file and fixtures)
  into the brain's `.claude/skills/` himself. Nothing in this task writes to or runs git in `~/agencybrain`.
- Backward compatibility first: every brain addition is optional. An older skill means the new parts don't show; an
  older app ignores the new fields; older run-log readers skip the new lines.
- No explainer.

## Facts established (2026-11-19)

- The brain's installed `tdsapp-ads` is byte-identical to `brain-skills/tdsapp-ads/` on main (SCRIPT_VERSION 0.2).
- The server passes bridge replies through (`server/http/routes.ts` `adsRead`, `adsChange`); change bodies are filtered by
  `ADS_CHANGE_FIELDS`. The client already reads `features` (`client/src/tools/ad-manager/summary.ts:13`).
- `ads-board-data.cjs listAccounts()` already returns each account's `standupSummary()`; the bridge's `accounts` action
  drops it today.
- `summary.csv` (dated, per campaign per day: Date, Campaign, Impr, Clicks, Cost, Conv, Value) covers about 180 days for
  most accounts (93 to 180 on 2026-11-19), so 7 / 30 / 90 days and the period before each are possible. `search80.csv`
  has no dates.
- Monthly closes are `clients/<slug>/reports/monthly/<YYYY-MM>-monthly-close.json`; `monthly.cjs monthStatus(clientDir,
  month)` reads any month; `approvals-board.cjs latestMonthly()` takes only the newest.
- The brain Workbench's `POST /api/approvals/decided` (server.cjs, 2026-11-17) with `draftChange` opens a chat with:
  `Draft a change proposal from an ads-manager decision. Decision proposal ${id} for client ${client}. ${name} recorded
  this decision on the Workbench:\n\n"${text with " → '}"\n\nFollow the ads-manager skill, section "Turning a decision
  into a change proposal". Never approve, apply or post anything: the new change proposal goes to ${name} on the
  Workbench Ads tab as proposed.` The ads-manager skill has that section, and `proposals.cjs new` gained `--follows`.
- Run log lines are `{ v: 1, ts, account, task, by, by_name }`; `readRuns` skips any line whose `v` isn't 1.
- Each tab has one event stream, for the open chat only (`store.tsx` "One event stream per tab", `server/http/stream.ts`),
  so a background chat's file list is not in the browser. The server holds it: `ctx.sessions.subscribe(id, 0, …)`
  replays a live chat's events, `files` included (overseer, corrected).
- v0.50.0's `SummarySheet.tsx` already draws a strip from `board.totals` in the old draft shape, so the new field must
  have another name (overseer, blocking 1).
- `compactRunLog` keeps the newest line per task whatever its `v` (overseer, blocking 2).

## Decisions

1. **The triage pop-up reads its own list.** A new read action `triage` (route `GET ADS_ROUTES.triage`) returns
   `AdsTriageReply`: every account from `listAccounts()`, built from the `standup` it already carries, sorted as the
   contract says, `stale` by `ADS_TRIAGE_STALE_DAYS` (all fresh verdicts above all stale ones), keys filtered by
   `ADS_ACCOUNT_KEY`. It is read each time the pop-up opens, so a board load stays as fast as now. The server refuses
   it without the feature. The "All accounts' standups…" button on the Daily standup card shows only when `features`
   has `ADS_TRIAGE_CAPABILITY`.
   - The pop-up is non-modal and anchored under the button. It closes on Esc or an outside click. Focus goes to its
     close button on open and back to the button on close. It is `role="dialog"` with a heading.
   - Each row shows the account name, the headline, "N flagged · M anomalies", the verdict date in words, and an "Old"
     tag when stale. Without a standup, a row says "No standup set up"; with a standup but no verdict, "Not run yet". The
     current account has `aria-current`. Choosing a row switches the shared account and closes the pop-up.
   - Loading shows "Loading…"; a failure shows the app's error words and a Try again button.
   Plain: from the standup card you can see which client's standup most needs you, and jump to it.
2. **Totals for 7, 30 and 90 days, all in one board reply.** The board gains `totalRanges: AdsTotals` (never `totals`,
   which v0.50.0 reads in another shape; a bridge test asserts the board has no `totals` key), with one
   `AdsTotalsRange` per `ADS_TOTALS_DAYS`, so the switch changes view without a reload. Each range ends on the daily
   file's newest date (as the "Top campaigns" table does), runs `days` days back inclusive, and compares with the
   `days` before. `previous` is null when the file doesn't reach back that far; `partial` is true when it starts inside
   the range. `wastedSpend` is the total spend of every search term with no conversions (`conv < 1 && cost > 0`, the
   same rule as the "Wasted spend" table), with no range or comparison, since that file has no dates.
   - Ads Account Summary draws the strip only when `board.totalRanges` is present (no feature check needed); the old
     `totals` strip code goes. A three-way switch (7 / 30 / 90 days) sits on the strip. It is a radio group with a
     visible label. It starts at 30 on each visit and is held in the ad store across account switches (overseer: the
     figures get quoted to clients, and the tables stay at 30).
   - Each figure shows its value, then the change against the period before ("+12% vs £1,204") or "No earlier data to
     compare". The strip says the dates it covers in words ("10 Oct to 8 Nov"), and "Data starts 3 Jul" when partial.
     Wasted spend sits apart from the period figures, captioned "search terms with no conversions, from the
     search-terms file", since it has no period and can exceed 7-day spend. The strip's label follows the switch
     ("against the 7 days before"); the page's fixed "Last 30 days" tag goes while the strip shows.
   - ROAS shows "n/a" when value is 0. A previous figure of 0 reads "vs £0", not "No earlier data to compare".
   - Help adds one line: Google counts a conversion on the click's date, so the newest days fill in over the next
     week or so and a 7-day view often shows a drop that isn't real.
   - Only the totals follow the switch. The six tables keep their own fixed windows and subtitles.
   Plain: the summary page opens with spend, conversions, value, ROAS, CPA and waste, against the period before, for
   the last week, month or quarter.
3. **Earlier months on Monthly close.** The approvals reply gains `earlierMonths` per client: the month files before
   the latest, newest first, at most `ADS_EARLIER_MONTHS_MAX`, each from `monthStatus()` with the same `canSign` rule.
   The bridge lists `reports/monthly/` itself (approvals-board.cjs stays a verbatim copy). An "Earlier months" fold
   (the design system's `Fold`) under the Monthly close card lists each month: its name, status in words ("Signed off by
   Pete on 3 Nov", "Not signed off", "Changed after sign-off, sign again", "Month-to-date draft"), its file buttons,
   and "Sign off…" when `canSign`, through the same confirm step as the latest month. No fold when the list is empty or
   missing.
   Plain: past months' reports and their sign-off are one click away, and a missed sign-off can be done late.
4. **Record and draft the change.** `decided` takes `draftChange: true` and then also replies `draftPrompt`: the brain
   Workbench's prompt, copied word for word into `cadence-tasks.json` as `draftChangePrompt` with `{{id}}`,
   `{{client}}`, `{{name}}` and `{{note}}` (the note with `"` turned into `'`, as `revisePrompt`). The reply message is
   "Decision recorded. A chat is drafting the change proposal; it comes back here as proposed when done." The
   server passes `draftChange` on only when it is a boolean.
   - On a decision proposal, next to "Record decision", a second button "Record and draft the change" shows when the
     person may record the decision and `features` has `ADS_DRAFT_CHANGE_CAPABILITY`. It uses the same note box and
     check. The runner starts the chat in the background with `draftPrompt`, as it does for `revisePrompt`, and the
     result line offers "Open chat". If the chat can't start: "Decision recorded. The drafting chat couldn't start, so
     ask for the change proposal in a chat yourself."
   - `SOURCES.md`'s `server.cjs` row adds the `decided` prompt to what is copied.
   Plain: after recording what was decided, one button also gets Claude to write the change for you to approve, as
   the brain's own Workbench now does.
5. **A run's result file, shown to teammates.** A new change action `task-result`. The server picks the file, never the
   browser (overseer decision c).
   - The browser posts `AdsTaskResultRequest` `{ account, task, at, chat }` once per run: when `taskRuns.reconcile`
     first marks a run `good`, using the brain's own `at` for that run (kept from the `task-run` reply as
     `TaskRun.brainAt`) and the run's live session id. It marks `resultSent` first (re-reading storage, as reconcile
     does), so two tabs rarely both post, and the bridge writes once per run anyway. A failed post isn't retried.
   - The route needs `ADS_TASK_RESULTS_CAPABILITY`, checks the fields, then replays the chat's newest `files` event
     from `ctx.sessions.subscribe(chat, 0, …)` and unsubscribes. It picks the newest file the chat created or changed
     (`ChatFile.actions`) whose path matches `ADS_FILE_PATTERN` and starts `clients/<account>/`. No live chat or no
     match: reply `{ result: null }` without running the bridge.
   - The bridge's `task-result` (`AdsTaskResultInput`) appends `{ v: 2, kind: 'result', ts, run_ts, account, task,
     by, by_name, result }` to the person's own run log file, with `task-run`'s checks (roster person, plain files, no
     symlinks). It refuses a `result` that doesn't match `ADS_FILE_PATTERN`, isn't under `clients/<account>/`, holds
     `..` or `.`, or isn't a plain file in the brain now, and a `run_ts` that isn't one of that person's runs of that
     task. A second call for the same `run_ts` writes nothing.
   - `compactRunLog` keeps each task's newest v1 line plus the result line whose `run_ts` matches it.
   - `readRuns` attaches `result` to the newest run when a result line from the same person (same file) has `run_ts`
     equal to that run's `ts`, after re-checking the path (pattern, `clients/<key>/` prefix, no `..` or `.`, length):
     the log is hand-editable and merged across Macs.
   - Any run with a `result` shows "Open result" on its card, opening the file in the app's viewer through
     `ADS_ROUTES.file` (which checks the path again). A person's own run keeps its chat link as well.
   - The Daily standup gets no link this release: its brief is written by a script under `clients/<key>/standup/`,
     outside `ADS_FILE_PATTERN`, and most daily cards save no file. Help and What's new say the link appears for tasks
     that save a report.
   Plain: when Pete runs a task and Claude saves a report, Ian's card links to that report.
6. **The skill's version and features.** `SCRIPT_VERSION` becomes `0.3`; `capabilities` adds the five Release 2
   features. The ported `scripts/lib/*.cjs` copies stay verbatim (their `SOURCES.md` hashes don't move); new reading
   goes in `tdsapp-ads.cjs`, using `ads-normalize.cjs` exports (`readTable`, `FILE_ALIASES`, `num`) and
   `ads-board-data.cjs dataDirFor`. `SKILL.md` documents the new actions and fields.
   Plain: the app can tell exactly what the installed skill can do, so a Mac with the old skill simply shows less.
7. **Help and What's new.** Help pages for the three tools gain the new parts; `help/whats-new/0.51.0.md` names them and
   says they appear once Ian has copied the updated skill into the brain.
   Plain: the help says what's new and why it might not show yet.

## Contract

`shared/ads-contract.ts`, Release 2 additions (search "Release 2"): five capability constants, `ADS_TOTALS_DAYS`,
`ADS_EARLIER_MONTHS_MAX`, `ADS_TRIAGE_STALE_DAYS`, `AdsTaskRun.result`, `AdsTaskResultRequest`, the `triage` read and
`task-result` change, `ClientApprovals.earlierMonths`, `AdsTriageRow`, `AdsTriageReply`, `AdsTotals*`, `AdsBoard.totals`,
`AdsChangeReply.draftPrompt`, `decided.draftChange`, `ADS_ROUTES.triage` and `AdsSummary.features`.
`client/src/tools/ad-manager/ads-tools-contract.ts`'s old Release 2 draft is removed in favour of these.

Client signatures builders share:
- `api.adsTriage(): Promise<AdsTriageReply>` (client/src/api.ts).
- `RunOptions.draft?: boolean` in `actions.ts`: like `revise`, starts the chat from `reply.draftPrompt`.
- `useStore().ads?.features ?? []` for feature checks (summary.ts fills it).
- Task runs keep the brain's `at` from the `task-run` reply as `TaskRun.brainAt?: string` and `TaskRun.resultSent?: true`;
  `readRuns` in task-runs.ts carries both through.
- `taskRuns.share(account, task)` in task-runs.ts replaces `shareRun` in `Board.tsx` (F writes it, G switches Board to it).
- `api.adsChange('task-result', AdsTaskResultRequest): Promise<AdsTaskResultReply>`.

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique, decisions, sign-off | (read-only) |
| Builder E: bridge | `builder`, sonnet | default; tests first | `brain-skills/tdsapp-ads/scripts/tdsapp-ads.cjs`, `scripts/cadence-tasks.json`, `scripts/tdsapp-ads.test.ts`, `SKILL.md`, `SOURCES.md` |
| Builder F: server and data | `builder`, sonnet | default; tests first for the reconcile and pick rules | `shared/ads-contract.ts` (fixes only), `server/http/routes.ts`, `server/http/routes.test.ts`, `server/http/ads-routes.test.ts`, `server/brain/ads-skill.ts`, `client/src/api.ts`, `client/src/tools/ad-manager/task-runs.ts` (+ test), `actions.ts`, `summary.ts`, `store.ts` |
| Builder G: screens | `builder`, sonnet | default (UI) | `ads-tools-contract.ts`, `Board.tsx`, new `TriagePopup.tsx`, `SummarySheet.tsx`, `Approvals.tsx`, `ProposalPanel.tsx`, `words.ts` (+ test), `client/src/styles/command.css`, `summary.css`, `ad-manager.css`, `Command.test.tsx`, `Summary.test.tsx`, the ad-manager component tests for Approvals and ProposalPanel, `help/ad-manager.md`, `help/ads-command-centre.md`, `help/ads-account-summary.md`, `help/whats-new/0.51.0.md`, `client/src/help/whats-new.test.ts` |

No file appears in two rows. G builds against the contract signatures above, which F implements; G may stub them in
tests.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `tdsapp-ads.test.ts` | `triage` order, stale rule and no-standup rows; `totals` ranges, previous null and partial, roas/cpa null on zero, wastedSpend over all rows; `earlierMonths` newest first, capped, latest left out, `canSign`; `decided` with `draftChange` replies the filled prompt and without it doesn't; `task-result` writes a v2 line once per run, refuses bad paths, symlinks, `..`, other clients' files, missing files and unknown `run_ts`; `readRuns` attaches `result` only to its own run and older readers' v1 rule still skips v2 lines; compaction keeps the newest v1 line and its result line; `readRuns` drops a hand-edited bad path; the board has `totalRanges` and no `totals` key; capabilities list the five features; the constants match the contract | E |
| `ads-routes.test.ts` (through `checkRequest`) and `routes.test.ts` | `GET /api/ads/triage`, refused without the feature; `decided` passes `draftChange` only as a boolean; `task-result` refused without the feature and with bad fields, picks the newest created or changed file of this client from the chat's replay, ignores read-only and other clients' files, and replies `{ result: null }` without running the bridge when nothing matches | F |
| `task-runs.test.ts` | `brainAt` and `resultSent` survive `readRuns`; a run posts `task-result` once, when it first turns good, and never again | F |
| `Command.test.tsx` | the triage button only with the feature; the pop-up's focus, Esc, outside click, rows and switching account; "Open result" on a teammate's run | G |
| `Summary.test.tsx` | the switch changes the figures; previous null and partial wording; no strip without `totals` | G |
| Approvals and ProposalPanel tests | the Earlier months fold and late sign-off; "Record and draft the change" only with the feature, and its chat start and failure line | G |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (preview on port 3264, its own data folder)
- [ ] No unintended large deletions: `git diff main --numstat | awk '$2 > 40'`
- [ ] Domain gates: security (the bridge writes a path into the brain's run log and the app opens files from it); UX
  (expert critique plus my browser check)
- [ ] Browser check: the pop-up, the totals switch, Earlier months, the new button, a result link (an `m-report`-type
  task). The preview's brain is a synthetic one in the scratch folder, built like `buildBrain()` in
  `tdsapp-ads.test.ts` (stub apply, client-draft and gads-access; this Mac's git user on its roster), optionally with
  one client's `board/*.csv` and monthly files copied in by reading. Never the real brain: it carries the live apply
  and Gmail scripts.

## Review outcomes

**Overseer pre-review (2026-11-19).** Blocking, all folded in: the `totals` name clash with v0.50.0 (now
`totalRanges`); compaction dropping a run once its result line is newer (decision 5); the browser can't see a
background chat's files (the server picks, decision 5). Should, folded in: no standup link, said in help; wasted spend
captioned apart and labels follow the switch; triage keys filtered and the route gated; gate tests through
`checkRequest` in `ads-routes.test.ts`; `readRuns` re-checks a logged path. Nice, folded in: the conversion-lag help
line; ROAS "n/a" on zero value and "vs £0". Decisions: a lazy `triage` read; the calendar stale rule with fresh above
stale; the server picks the result file; a synthetic preview brain; the switch resets to 30 each visit.

**Ian's artifact check (2026-11-19).** The all-ready account-data panel had shrunk to one green line. Rebuilt to the
artifact: groups always shown with "n of n ready", "Not needed" groups, a "Show files" toggle, the artifact's wording.
Also fixed: an approved decision Ian can record said "Waiting on someone else" (now "Record the decision").

**Brain process review (Fable, read-only, 2026-11-19).** All `SOURCES.md` hashes match; parsers, cadence tasks and
coexistence clean. Fixed: totals end on `_refreshed.json` `through` and cover the 180-day pull when the first row is
within 14 days of its start (accounts that didn't serve lost their 90-day comparison); Google-basis wording on the
headline figures and wasted spend (last 30 days); the draft-change message no longer promises the proposal comes back;
the skill's description drops the approve and sign-off triggers; version 0.3; `apply.cjs` hash-watched. Not the app's
to fix: the brain's write gate doesn't cover the bridge (true since v0.2). Request for Pete:
`2026-11-19-brain-write-gate-ads-bridge.md`. Nice, left: supervised clients' cards go round proposals (Workbench parity).

**UX expert vs the artifact (2026-11-19).** Must, fixed: the Quality Score line counted score bands, not keywords (and
the test fixture had the wrong table shape); the standup card said "Never run here" beside yesterday's verdict (the
verdict date now counts as the last run, for the card and the menu's due count). Should, fixed: proposal facts order
and dates in words; earlier unsigned months in Needs you; dates in words in Needs you; triage badges and hint, no
repeated count; better/worse tone on changes (lower CPA is better); a note when Top products is missing; a stale
month's own reason. Found in the browser check: the triage pop-up ran off a phone screen (opens in place at ≤640px).
Deferred to the next release (Ian, 2026-11-19): the menu's "N due" before the tool is first opened; names instead of
slugs (proposal slugs don't match `roles.json`); Previous/Next in the proposal panel.

**Overseer sign-off (2026-11-19): signed off.** Confirmed the totals rule against the brain's ingest (a missing day is
a day with no impressions). Should, after merge: a run whose result wasn't seen being saved never gets a link (help
now says so); runs started on the old skill get no link.
