---
name: tdsapp-ads
description: The bridge TDS Cortex's Ad Manager uses to read and decide ads-manager proposals, run a dry run or the live apply, draft the client email, record the client's yes or a decision, sign off a monthly report, and read the Ads board and Daily Standup - always through the brain's own ads-manager scripts, as the person at this Mac. USE WHEN TDS Cortex runs it for Ad Manager, or someone asks "what ads proposals are waiting for me?", "show the ads board for Acme", "dry run that proposal", "set up the standup for Acme", or "rate the standup calls". Approving, rejecting, recording a decision or the client's yes, signing off a report and applying a change are the person's own decisions, made in Ad Manager: Claude never runs `decide`, `decided`, `client-approved`, `sign-monthly` or `apply` from a chat.
version: 0.3
last_updated: 2026-11-19
roles: owner, scout
maturity: draft
members: false
agency: true
---

# tdsapp-ads

One script, `scripts/tdsapp-ads.cjs`, that TDS Cortex runs for its Ad Manager (the Workbench section's
first tool). It does what the Workbench's Ads tab does, without the Workbench running: the approvals
panel, the ads board and the Daily Standup.

It's in testing. Only the owner and scouts can use it until Pete, as brain guardian, releases it to
the team.

## How it works

- **The rules stay in ads-manager.** Proposals, decisions and stamps go through
  `.claude/skills/ads-manager/scripts/lib/proposals.cjs`; the monthly status and sign-off through
  `monthly.cjs`; the dry run and the live apply through `apply.cjs`; the client email through
  `client-draft.cjs`. The script loads them from the brain every time it runs and copies none of
  their rules.
- **Who you are** comes from this Mac's git name and email, matched against
  `.team-config/roles.json`, exactly as `proposals.cjs approve --as` checks it. Nothing sent to the
  script can name someone else. Someone not on the roster can read, but not change anything.
- **Who may do what.** Approve, request changes and reject: the proposal's reviewer, its owner or an
  owner (the library checks this). The script also checks the same rule itself before a dry run, an
  apply, a client email draft, recording the client's yes or recording a decision, because the
  library doesn't check those.
- **The board and standup** use copies of the Workbench's board reader and standup code
  (`scripts/lib/`), and the 16 cadence cards and their prompts, word for word, in
  `scripts/cadence-tasks.json`. `SOURCES.md` says where each came from.

## How to run it

Send one JSON object on stdin and name the action:

```bash
echo '{"client":"acme"}' | node .claude/skills/tdsapp-ads/scripts/tdsapp-ads.cjs approvals
```

| Action | Fields | What it does |
|---|---|---|
| `capabilities` | none | The feature list, whether this Mac can reach Google Ads, whether ads-manager is installed, and who you are. |
| `accounts` | none | Every account with board data or a supervised client, with how many proposals wait for you. |
| `approvals` | optional `client` | Each supervised client: proposals open and decided in the last 14 days (no bodies), the latest weekly pack and monthly close, and which buttons you may use. |
| `proposal` | `client`, `id` | One proposal in full. |
| `board` | `account` | The account's data health, deep-dive tables, the 16 cards with their badges and prompts, and the standup. |
| `standup-brief` | `account` | The latest standup brief's call for each campaign. |
| `triage` | none | Every account's latest standup verdict as `rows` of `{key, name, hasStandup, verdict, stale}`, worst first: fresh verdicts (most flagged, then most anomalies), then stale ones (2 or more local days old), then standups not run yet, then accounts with no standup. Ties by name. |
| `decide` | `client`, `id`, `action` (`approve`, `request-changes` or `reject`), `note` | Decides. A note is needed to reject or request changes. Approving a proposal the client must agree to also drafts the client email. |
| `dry-run` | `client`, `id` | Runs `apply.cjs` without `--confirmed`: nothing changes in Google Ads. |
| `apply` | `client`, `id`, `confirmed: true` | Runs `apply.cjs --confirmed`: the LIVE change to Google Ads. |
| `client-draft` | `client`, `id`, optional `again` | Runs `client-draft.cjs` (a Gmail draft and a markdown copy, never sent). |
| `client-approved` | `client`, `id`, `who`, optional `note` | Records who at the client said yes, and how. |
| `decided` | `client`, `id`, `note`, optional `draftChange` (true or false) | Records what was decided on an approved decision proposal. With `draftChange: true` it also replies `draftPrompt`, the Workbench's prompt for a chat that drafts the change proposal (from `cadence-tasks.json` `draftChangePrompt`). |
| `sign-monthly` | `client`, `month` (YYYY-MM), optional `note` | Signs off the month's report in your name and builds the final PDF. |
| `standup-setup` | `account` | Writes a starter standup config from the account's enabled campaigns. Never overwrites one. |
| `standup-feedback` | `account`, `date`, `campaign`, `action_category`, `score` (1-5), optional `note` | Saves your rating of one standup call for the next run. |
| `task-run` | `account`, `task` (a card id from `cadence-tasks.json`, or `standup:daily`) | Records that you ran a task, in the shared run log. Replies `{run: {at, by, byName}}`. |
| `task-result` | `account`, `task`, `at` (the run's own time from `task-run`), `result` (a brain-relative report path) | Records the file a finished run saved, once per run. The path must match the app's file pattern (`clients/<account>/reports|proposals/...`), hold no `.` or `..`, and be a plain file now (no links). Refuses a run that isn't yours. Replies `{result}`. |

Release 2 additions to existing replies (version 0.3; `capabilities.features` lists `triage-all-v1`, `totals-v1`,
`earlier-months-v1`, `draft-change-v1`, `task-results-v1`):

- `board` carries `totalRanges`: `{ranges, wastedSpend}`, one range per 7, 30 and 90 days from the daily file
  (`summary.csv`), ending on its newest date, with `current`, `previous` (null when the file doesn't reach back),
  `partial`, `dataFrom`, and spend, conversions, value, ROAS and CPA. It is never named `totals`.
  `wastedSpend` adds up every search term with no conversions. No daily file: `ranges` is empty.
- `approvals` carries `earlierMonths` per client: up to 12 months before the latest close, newest first, each with
  the same `canSign` rule as `monthly`.
- `lastRun` may carry `result`, the file that run saved.

It prints one line of JSON: `{"ok":true,…}` or `{"ok":false,"code":…,"error":…}`. Exit 0 means it
worked, exit 2 means it refused, exit 1 means something went wrong. The codes are `bad-request`,
`not-found`, `not-allowed`, `changed` (the proposal isn't in a state that allows it), `unknown-outcome`
(an apply ended in a way that doesn't say whether Google Ads changed), `unavailable` (ads-manager
isn't installed) and `internal`.

A dry run or apply that ran but didn't succeed replies `ok: true` with `failed: true`, a plain
`message` and the last 6,000 characters of `output`.

### Run log and `lastRun`

`task-run` appends one line to `tdsapp-ads/runs/<account>/<your-slug>.<machine-id>.jsonl` in the brain:
`{"v":1,"ts":…,"account":…,"task":…,"by":<slug>,"by_name":<name>}`. The person is always the roster
person on this Mac, never from stdin. The first run also writes a short `tdsapp-ads/README.md` and a
`.gitattributes` (`runs/**/*.jsonl merge=union`) so two people's files merge cleanly. A file over 64 KB
is rewritten with only its newest line per task.

`board` reads every `.jsonl` in that account's folder and puts `lastRun` (`{at, by, byName}` or `null`)
on each card and on `standup` (task `standup:daily`). It never writes. It skips links, bad lines, other
accounts, times more than 10 minutes ahead and lines whose `by` is not the file name's person.

`task-result` appends `{"v":2,"kind":"result","ts","run_ts","account","task","by","by_name","result"}` to the
same file, once per `run_ts`. Older readers skip any line whose `v` isn't 1, so it never counts as a run. A
file that grows past 64 KB keeps each task's newest run line and its result line. `board` attaches `result` to
a task's newest run only when the result line is in the same person's file and its path passes the checks again.

This is a convenience record, not an audit trail: anyone who can write the brain could add or edit a
log file, so don't treat a `lastRun` as proof of who did what.

Past 64 KB the writer rewrites its own file to the newest line per task (a log past 4 MB is left as it is).
Two runs at the same instant on one Mac can, rarely, lose one line during that rewrite; that person's own
app still shows their run.

### From a chat

- **"What's waiting for me?"**: run `approvals` and list the proposals where `flags.canDecide` is
  true, by client, with tier and title.
- **Never run `decide`, `apply`, `client-approved`, `decided` or `sign-monthly` for someone.** These
  are human decisions. Point them to Ad Manager in TDS Cortex, or tell them the exact command to run
  themselves.
- A dry run is safe to run when asked: it changes nothing in Google Ads.

## Safety

- `apply` is the only action that passes `--confirmed`, and only when the request says
  `"confirmed": true`. `apply.cjs` then re-checks the approval itself.
- TDS Cortex runs `apply`, `dry-run` and `sign-monthly` detached and never stops them, so a live
  write is never cut off half way. If one takes too long, Cortex says it doesn't know whether the
  change reached Google Ads, and hides Apply until someone has checked the account.
- Nothing retries an apply.

## Backward compatibility

The script reads and writes the same files as the Workbench, only through the same libraries, so
the Workbench and the CLI see every change. Unknown proposal fields and statuses are passed through
as they are. Without ads-manager (or with an older one missing a function this needs),
`capabilities` says `adsManager: false` and Cortex keeps Ad Manager hidden.
