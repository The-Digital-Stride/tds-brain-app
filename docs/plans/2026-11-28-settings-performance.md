# Settings → Performance

Date: 2026-11-28 · Size: L · Branch: `settings-performance` · Explainer: https://claude.ai/artifact/HwgDx36H5RvZwv9qasuXUX

## Objective

Owners and scouts get a Performance tab in Settings showing how this Mac uses Claude Code: tokens, estimated cost, Code Mode on against off, and where it goes (projects, models, subagents). It refreshes daily and keeps its own history, so changes such as turning on Code Mode can be judged over weeks.

## User decisions (fixed)

- **This Mac only** while testing. Team-wide totals may come later; nothing here should block that.
- **All Claude Code** on the Mac: code repos, the brain, TDS Brain App chats, scratch folders.
- **Owners and scouts only.** A new Settings tab named **Performance**.
- **Updates every day.**
- Base branch `main`. Lands as a PR, then merged on the Mac so the version hook runs (`feat` → minor).

## Decisions

1. **Source: Claude Code's session logs.** Read `~/.claude/projects/*/*.jsonl` (main sessions) and `*/<session>/subagents/agent-*.jsonl` with their `.meta.json` (subagents), the root injected (tests never read the real `~/.claude`; `CLAUDE_CONFIG_DIR` honoured). Read-only, streamed line by line, and only lines containing `"type":"assistant"` are parsed (171k of 645k lines; other lines reach 16 MB).
   Plain: the page counts what Claude Code already writes down on this Mac; nothing new is recorded while people work.
2. **Owner and scout only, enforced on the server.** `GET ROUTES.performance` and `POST ROUTES.performanceRefresh` check `identity.role` against `PERFORMANCE_VIEWERS` and answer 403 `not-allowed` otherwise, like skill levels (`server/http/routes.ts:777`). The tab is hidden for others (`hasPerformance` in `visibleSettingsTabs`).
   Plain: only Owners and scouts see the tab, and a hand-made request from anyone else is refused.
3. **Numbers only.** Kept per assistant entry: `timestamp`, `message.id`, `message.model`, `message.usage`, and whether it holds a `tool_use` named `REPL`. Per session: the first `cwd` and `gitBranch` (to name the project). Per subagent: `agentType` from `.meta.json`. No message text, tool input or output is kept, logged or sent.
   Plain: the page knows how much was used and where, never what was said.
4. **Project names from the session's real folder** (overseer). Use the session's `cwd`, not the encoded folder name (which loses "My Repos" spaces). `~` itself reads "Home folder". The brain path and `~/agencybrain` read "Brain". The system temp folder and Claude scratch folders read "Temporary folders". A worktree folds into `<repo>` when its cwd is inside `<repo>`, or is a sibling `<repo>-<suffix>` where the suffix equals the session's `gitBranch` and `<repo>` is also a project. Otherwise the cwd's last folder name. Risk: hand-named worktrees stay separate.
   Plain: worktrees and scratch runs count towards the project they belong to.
5. **Counting.** One request per `message.id`; the last line for that id gives its usage. Skip `model: "<synthetic>"`. Dedupe ids across files (the oldest file keeps the id; 31 of 83,622 ids are in two files today). Date = the message's local date. Main sessions and agents are counted once per period, never by summing rows.
   Plain: nothing is counted twice.
6. **Daily refresh, incremental, with irreplaceable history.**
   - Timer in `server/index.ts`, following `server/purge-timer.ts`: first check after `PERFORMANCE_FIRST_CHECK_AFTER_MS`, then every `PERFORMANCE_CHECK_EVERY_MS`, `unref`'d, stopped on shutdown. Each tick runs a refresh only if today's hasn't run **and** the current identity's role is in `PERFORMANCE_VIEWERS` (re-checked each tick) **and** the app isn't in setup or demo mode.
   - Re-read only files whose size or mtime changed. Keep each file's per-session, per-day sums and its message ids in `<dataDir>/performance/` (atomic tmp + rename). Drop a file's ids when it leaves disk but keep its sums, so history outlives Claude Code's ~30-day clean-up. Days older than `PERFORMANCE_KEEP_DAYS` are dropped.
   - Follow `server/store/token-savings.ts`: only a missing store reads as empty; any other read error or an unknown `version` reports `history-unreadable` and **skips the write**. One refresh at a time; a failure keeps the last good data.
   Plain: the first build takes seconds in the background; history keeps growing even after Claude Code tidies its logs, and a damaged file is never overwritten with nothing.
7. **Costs are estimates, by exact model.** `MODEL_PRICES` by model id (claude-api reference, 2026-11-28; Fable 5.2 from agent-usage.sh). Unknown models count in `unpricedRequests` and the page says "N requests on models with no price aren't in the cost". The page says "estimated at API list prices; not your bill".
   Plain: on a subscription there's no per-token bill, so the figure is a yardstick, not money spent.
8. **The page** (Settings → Performance; `PerformanceSection` lazy-loaded, importing `ad-manager.css` for `AmTable`):
   - Status line: "This Mac only · Updated Today, 06:12" with a quiet small **Update now** at its right end; "Building the first report…" (spinner, polls every 3 s); "Couldn't update (<plain reason>). Showing the last good figures."
   - Range: Last 7 days · 30 days · 90 days (segmented control).
   - Order: **Summary** (`dl.kv`: estimated cost, requests, sessions, agents started; change against the previous period only when `previous` isn't null, else "No earlier figures yet") → **Daily** (a bar per day of estimated cost, values readable without colour) → **Where it goes** (`AmTable`: by project, by model, agents by type; columns text, money `currency: 'USD'` with key `spend` for the bar, pct, int; no token columns) → **Code Mode** (sessions, input per request, cost per session, each side; a verdict line only when both sides have at least `CODE_MODE_MIN_SESSIONS`, else "Too few Code Mode sessions to compare yet") → **Tokens** last (fresh input, cache written, cache read, output, each its own line, `tokenWords`).
   - Model labels from `MODEL_PRICES` ("Opus 5.5"). UK English.
   Plain: one page answers "how much, where, and is Code Mode helping?" for a chosen period.
9. **Demo mode.** Under `TDS_CORTEX_DEMO` the routes return a fixed sample report and neither the timer nor the reader starts (keep `server/engine/demo-guard.ts`'s allow-list closed).
   Plain: screenshots and demos show made-up figures, never real use.
10. **Help standard.** `help/performance.md` (topic id `performance`), a help picture (`help/shots.json`, demo scene), and `help/whats-new/0.98.0.md`. No tour step (a Settings tab isn't an app, section or drawer).
    Plain: Help explains the page, with a picture, and What's new announces it.
11. **The server works out the views** (overseer). It sends `views` for 7, 30 and 90 days, current and previous, so session ids never leave the server and counts are never summed wrongly in the browser.
    Plain: the page shows figures the server has already checked.
12. **Update now.** `POST ROUTES.performanceRefresh`, same role gate, single-flight (a second press while one runs just returns the report), tested through the real `checkRequest`. Never-run + first tab open also starts a refresh.
    Plain: an Owner can get today's figures straight away instead of waiting for tomorrow.

## Contract

`shared/performance-contract.ts`: roles, timings, prices, `PerformanceRow`, `PerformanceReport`. Routes to add: `ROUTES.performance = '/api/performance'` (GET) and `ROUTES.performanceRefresh = '/api/performance/refresh'` (POST).

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A: server | `builder`, sonnet | default (tests first) | `server/performance/*` (new: `reader.ts`, `projects.ts`, `store.ts`, `refresh.ts`, `demo.ts`, tests), the route in `server/http/routes.ts`, the timer in `server/index.ts` (new `server/performance/timer.ts` like `server/purge-timer.ts`), the demo guard if it needs an entry |
| Builder B: client | `builder`, sonnet | default | `client/src/shell/settings-tabs.ts`, `client/src/components/SettingsSheet.tsx`, `client/src/components/SettingsView.tsx` (one line to render the section), new `client/src/components/PerformanceSection.tsx` (+ test), `client/src/api.ts` (one call), CSS, `help/performance.md`, `client/src/help/topics.ts`, `help/shots.json`, `help/whats-new/0.98.0.md` |
| Lead | me | | `shared/performance-contract.ts`, the two `ROUTES` entries in `shared/contract.ts`, this plan, explainer |

No file appears in two rows.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/performance/reader.test.ts` | one request per id, last line wins; `<synthetic>` skipped; only assistant lines parsed; 1h cache writes; REPL marks the session, subagents inherit; local date; no text kept (no string fields beyond the allowed ones) | A |
| `server/performance/projects.test.ts` | cwd → project (repo, worktree fold by gitBranch, Brain, Temporary folders, Home folder) | A |
| `server/performance/refresh.test.ts` | only changed files re-read; deleted files keep their sums; cross-file dedupe (oldest wins); days past KEEP dropped; unreadable/unknown-version store skips the write; a throw keeps the last good data; once per local day; timer skips non-viewers, setup and demo; views: sessions counted once, previous null unless covered, unpriced counted | A |
| `server/http/routes.test.ts` + `server/http/performance-contract.test.ts` (real `checkRequest`) | GET and POST: 403 for team/unknown, 200 for owner/scout; POST single-flight; demo returns the sample | A |
| `client/src/shell/settings-tabs.test.ts` | Performance tab only with `hasPerformance` | B |
| `client/src/components/PerformanceSection.test.tsx` | range switch; change shown only with a previous period; tokens on separate lines; Code Mode verdict only above the minimum; unpriced note; never-run, building and failed states; Update now | B |

## Gates

- [x] Type-check · [x] Tests · [x] Lint · [x] Build (preview on 3878 with its own `TDS_BRAIN_APP_DATA`, from `/tmp/tba-preview-settings-performance/`)
- [x] No unintended large deletions: `git diff origin/main --numstat | awk '$2 > 40'`
- [x] Domain gates: security (reads private logs; role gate), UX/UI expert
- [x] Browser check: Settings → Performance as owner (demo) and as team (tab absent); keyboard through the range control and tables

## Review outcomes

- **Correctness (Opus):** 3 confirmed, all fixed. (1) A deleted log's shared ids were counted twice, so gone files now keep their ids in one oldest-first order. (2) The previous period was judged from the oldest figures, so `completeFrom` is now stored at the first refresh. (3) The cost maths had no test; there is now an exact-cost test plus a `logsRootFor` test. The fix-round re-check found that the first `completeFrom` day could be partly cleared, so it now starts the day after the oldest log (never later than today).
- **Security (Opus):** 1 confirmed, fixed. Project keys carried full folder paths to the browser; they are now a 12-hex sha256, and a test checks no `/Users` appears.
- **UI and accessibility (Sonnet):** 4 confirmed, fixed. Update now failed silently; the status region was swapped rather than kept mounted; the range labels didn't match; the 90-day list was 90 rows long (now weekly).
- **Drift and copy (Sonnet):** no findings.
- **UX expert (Opus):** 6 confirmed, fixed. Partial history shows "Figures start" and "—"; the Code Mode verdict is worded as a rough guide; a failed first build no longer spins for ever; money uses one decimal setting per column; weekly rows for 90 days; a failed update says how old the figures are.
- **Browser check (lead):** two wording fixes. The heading reads "Weekly" in the 90-day view, and the verdict says "less cost per session".
- **Overseer sign-off:** approved. Its one blocker (Sonnet 5.5 cache read $0.10) was checked against the claude-api reference (`models.md`: "cache reads $0.20") and dropped. Follow-up: fold Claude desktop scratch folders (`~/Library/Application Support/Claude/scratch-workspaces/<id>`) into "Temporary folders".
- **Real logs:** 84,018 requests over 90 days, first build 14 s, a rerun with nothing new 0.5 s, store 8 MB (about 27 MB at 400 days).
