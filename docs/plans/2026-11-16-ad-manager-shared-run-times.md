# Ad Manager: shared task run times

Date: 2026-11-16 · Size: L · Branch: `ad-manager-shared-run-times` · Explainer: none (Ian: no)

## Objective

v0.47.0 shows on each Ad Manager task card when that task last ran, but only for runs started in this
browser (localStorage). Ian (2026-11-16): "The run time on ad manager tasks should show globally i.e.
another user should also pick this up when reviewing the ad manager." So a run is recorded in the brain
(which syncs to the team), and every teammate's board shows "Last run 16 Nov, 21:46 by Pete".

## User decisions (fixed)

- Run times are shared with the whole team through the brain.
- The updated `tdsapp-ads` skill is copied into `~/agencybrain/.claude/skills/tdsapp-ads/` once built and
  tested (Ian: "Yes, copy it when ready"). No git is ever run in the brain; the brain's own sync shares it.
- No explainer.
- Standing rules: the app never writes brain files itself (only through a brain skill); backward
  compatibility first (older app and older skill keep working); UK English in UI text.

## Facts

- Precedent: `tdsapp-files` appends a team-wide log at `tdsapp-deleted/log/<member-slug>.<machine-id>.jsonl`,
  one file per person per Mac so two Macs never write the same file (`machineId` in
  `brain-skills/tdsapp-files/scripts/tdsapp-files.cjs:451`, id kept in `~/.config/tdsapp/machine-id`).
- The ads bridge (`brain-skills/tdsapp-ads/scripts/tdsapp-ads.cjs`): `ACTIONS` table (:658), `whoAmI` /
  `requireMe` (roster identity from git, never from stdin), `board()` (:371) builds `AdsBoard` incl. `cards`
  from `cadence-tasks.json`, `capabilities()` returns `features`.
- Server: `server/brain/ads-skill.ts` runs the bridge; routes `/api/ads/do/<action>` in
  `server/http/routes.ts` (`adsChange`, `adsChanger`); timeouts and action unions in `shared/ads-contract.ts`.
- Client (v0.47.0): `RunLine` / `RunButton` / `useTaskRun` in `client/src/tools/ad-manager/Board.tsx`,
  local store `client/src/tools/ad-manager/task-runs.ts` (keeps the run's live chat id for Running / Open chat).

## Decisions

1. **A new bridge action `task-run`** records one run: input `{ account, task }`. `task` must be a card id
   from `cadence-tasks.json` or `standup:daily`; `account` passes `accountKey` + `accountDir`; the person is
   `requireMe` (roster, from git). It appends one line `{ v: 1, ts, account, task, by, by_name }` to
   `tdsapp-ads/runs/<member-slug>.<machine-id>.jsonl` (same machine id file and append style as
   `tdsapp-files`). Reply `{ ok: true, run: { at, by, byName } }`.
   Plain: pressing Run leaves a one-line note in the shared brain saying who ran what, when.
2. **`board()` adds `lastRun`** to each card and to `standup`: the newest record for that account and task
   across every file in `tdsapp-ads/runs/`, as `{ at, by, byName } | null`. Reading is bounded (at most 200
   files, the last 256 KB of each); bad lines, unknown versions, other accounts and future timestamps more
   than a day ahead are skipped. Additive fields only.
   Plain: everyone's board shows the latest run by anyone, once the brain has synced.
3. **Capability `task-runs-v1`** in `capabilities().features`. The app calls `task-run` only when the skill
   says it can; with an older skill it keeps today's local-only behaviour.
   Plain: an app newer than the skill (or older) never breaks; it just doesn't share.
4. **Server**: `task-run` joins `AdsChangeAction` with a 15 s timeout; same gate as other changes
   (`adsChanger`: signed in, ads access) but no "may decide" rule — anyone on the roster with ads access can
   record a run they started. Body validated server-side (`account` and `task` strings, length caps).
   Plain: the same people who can use Ad Manager can record runs; nothing else opens up.
5. **Client**: after `startChat` succeeds, Run records locally (as now, for the chat id) and fires
   `api.adsChange('task-run', { account, task })` without waiting; a failure is silent (the local record
   still shows). `RunLine` shows the newer of the local run and the board's `lastRun`, adding "by {first
   name}" when someone else ran it; it never says "by" for the person themselves. Running / Needs your answer
   / Open chat stay local (only the person whose chat it is can see or open it).
   Plain: you see a teammate's run with their name; your own runs read as before.
6. **Freshness**: the board already reloads on Refresh and on opening; no polling is added. A teammate's run
   appears once their brain has synced and this board reloads.
   Plain: it isn't instant across Macs; it follows the brain's sync.

### Overseer pre-review (applied)

- **Blocking, fixed:** one log per account: `tdsapp-ads/runs/<account>/<member-slug>.<machine-id>.jsonl`. The writer compacts its own file to the newest line per task once it passes 64 KB (temp file, then rename). `board` reads only that account's folder, in full. This replaces Decision 1's single-folder path and Decision 2's tail-bounded read.
- `board` never writes: no folders, README or machine id. It uses `lstat`, reads plain files only, and a missing folder gives `lastRun: null`.
- **Writes:**
  - `plainFolder`-style creation for each segment, ported into `tdsapp-ads.cjs`. Each skill is self-contained.
  - `me.slug` must match `^[a-z0-9-]{1,80}$` before it becomes a filename.
  - `ctx.home`, defaulting to `os.homedir()`, so tests never touch the real `~/.config/tdsapp/machine-id`.
  - Write `tdsapp-ads/README.md` once ("not a source").
  - Write `tdsapp-ads/.gitattributes` once with `runs/**/*.jsonl merge=union`.
- **Reads:**
  - `by` comes from the filename's slug, and lines whose `by` disagrees are skipped.
  - `by_name` is flattened and capped at 80.
  - Every `*.jsonl` is read, so the sync's `__from-remote` copies count.
  - A line more than 10 minutes in the future is skipped.
  - `v` is bumped only for breaking changes.
- **Server:**
  - `task-run` runs unqueued through `runRead` and is not in `DETACHED`, so its time is never held behind an apply.
  - `ADS_TIMEOUT_MS['task-run'] = 15_000`.
  - `ADS_CHANGE_FIELDS['task-run'] = ['account', 'task']`.
  - It refuses with `unavailable` when `features` lacks `task-runs-v1`.
  - `SCRIPT_VERSION` is bumped.
- Global "Running" is not in this change. If it's added later: a run id, an end line when the chat goes idle, and the reader treats a run as ended after 30 minutes.
- Wording: "Last run 16 Nov, 21:46 by Pete". While your own chat is live, your local run wins.
- `SKILL.md` says anyone who can write the brain could forge a log file. The help page says teammates on an older app don't share runs.

## Contract

`shared/ads-contract.ts`:

```ts
export interface AdsTaskRun { at: string; by: string; byName: string }
// AdsBoard.cards[n].lastRun?: AdsTaskRun | null      (optional: older skills omit it)
// AdsStandupState.lastRun?: AdsTaskRun | null
// AdsChangeAction gains 'task-run'; ADS_TIMEOUTS['task-run'] = 15_000
export interface AdsTaskRunRequest { account: string; task: string }
export interface AdsTaskRunReply { ok: true; run: AdsTaskRun }
export const ADS_TASK_RUNS_CAPABILITY = 'task-runs-v1';
```

## Team and file ownership

| Role | Agent and model | Why this model | Owns (files) |
|---|---|---|---|
| Overseer | `overseer`, fable | plan critique and sign-off | (read-only) |
| Builder A | `builder`, sonnet | scripts and tests (default) | `brain-skills/tdsapp-ads/scripts/tdsapp-ads.cjs`, `brain-skills/tdsapp-ads/scripts/tdsapp-ads.test.ts`, `brain-skills/tdsapp-ads/SKILL.md` |
| Lead | me | small wiring | `shared/ads-contract.ts`, `server/brain/ads-skill.ts`, `server/http/routes.ts` + tests, client `Board.tsx`, `task-runs.ts`, `api.ts`, `AdManager.test.tsx`, help page |
| Security gate | `expert`, opus | new brain write + route | (read-only) |

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `brain-skills/tdsapp-ads/scripts/tdsapp-ads.test.ts` | `task-run` appends to the person's own file; refuses unknown task, bad account, off-roster user; `board` returns the newest run across several people's files; skips bad lines, other accounts, far-future times; bounded read | Builder A |
| `server/http/ads-routes.test.ts` | `POST /api/ads/do/task-run` goes through the real request gate (`checkRequest`), validates the body, and maps refusals | Lead |
| `client/src/tools/ad-manager/AdManager.test.tsx` | Run calls `task-run` only with the capability; a teammate's `lastRun` shows "by Pete"; the newer of local and shared wins; own run has no "by" | Lead |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build
- [ ] No unintended large deletions
- [ ] Domain gates: security (brain write path, identity, input caps), UX (run line wording)
- [ ] Browser check: Ad Manager task cards with a practice brain holding two people's run logs
- [ ] Brain copy of `tdsapp-ads` after merge (Ian said yes)

## Review outcomes

(filled at the end)
