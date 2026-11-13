# In-app updates

Date: 2026-11-13 · Size: L · Branch: `in-app-updates` · Explainer: none

## Objective

Close the loop between development and the team: every installed TDS Brain checks GitHub `main` for a
newer version, tells the person in the app, and updates and restarts itself when they click one
button. Nobody has to run `/update-brain-app` or a terminal command again.

## User decisions (fixed)

- Notify plus one click. Nothing updates until the person clicks "Update and restart"; no silent or
  idle-time updates.
- Source of updates: GitHub `main` of the installed clone (the public repo it was installed from).
- No visual explainer.
- `/update-brain-app` and the README command keep working unchanged (backward compatibility first).

## Decisions

1. **The server owns checking and updating; the page only shows status and asks.** A new
   `server/update/updater.ts` (`createUpdater`, contract `shared/update-contract.ts`) runs git and pnpm
   with `execFile`, no shell, fixed arguments, cwd the app folder. No request data reaches a command.
   Plain: the button can only ever run the same few fixed steps the update skill runs today.

2. **Checking.** `git fetch --quiet origin main`, then `git show origin/main:package.json` for the
   version and `git show origin/main:CHANGELOG.md` for the notes (parsed with the existing
   `parseChangelog`, keeping entries newer than the running version). Runs 2 minutes after start-up,
   every 6 hours, and on demand from Settings ("Check for updates"). One check at a time; callers share it.
   `available` is true only when GitHub's version is higher (numeric x.y.z), so a chore-only push never
   nags anyone. The check records the `origin/main` SHA it read; the update merges that SHA. A failed
   check sets `checkFailed` and keeps the last `available`/`latest` (not a block). `GET /api/update`
   starts a background check when the last one is over 6 hours old (timers stall while a Mac sleeps).
   Plain: the app looks for a new version a few times a day and only speaks up when there really is one.

3. **When a copy may update itself (`blocked`).** Only under the LaunchAgent (`underService`), only a
   git clone, only on `main` tracking `origin/main`, and only with a clean working tree. Otherwise
   `blocked` names the reason and the banner never shows. Development copies (started by hand) are
   therefore always `not-service`.
   Plain: Ian's development folder and any hand-changed install are never touched by the button.

4. **Updating, in order, with a way back** (overseer pre-review blocking 1–3 and should items folded in).
   (a) *Pre-flight* (nothing changed yet): re-check `blocked`; `<nodeBinDir>/npx` exists; HEAD is an
   ancestor of the SHA recorded at the check (`git merge-base --is-ancestor`); at least
   `UPDATE_MIN_FREE_BYTES` free. Record HEAD. Write `<dataDir>/update-pending.json` (`UpdatePending`).
   (b) `downloading`: `git -c core.hooksPath=/dev/null merge --ff-only <recorded SHA>` (never the moving
   `origin/main`; no hooks, so the repo's post-merge version-bump hook never runs in an install).
   (c) `installing`: only when `pnpm-lock.yaml` differs between old HEAD and the new SHA
   (`git diff --quiet <old> <new> -- pnpm-lock.yaml package.json`): `<nodeBinDir>/npx --yes pnpm@10
   install --frozen-lockfile`, env `CI=true`, PATH `<nodeBinDir>:<appRoot>/bin:<service PATH>`.
   (d) `building`: `<nodePath> node_modules/vite/bin/vite.js build --outDir <absolute appRoot/dist/client.next>
   --emptyOutDir` (Vite resolves a relative outDir against `root: 'client'`, so it must be absolute).
   (e) *Boot check*: `<appRoot>/bin/node server/index.ts --check` must exit 0 (new flag: exits right
   after the imports load; catches a release that can't start and a raised Node minimum).
   (f) *Swap*: remove old `dist/client.prev`; rename `dist/client` → `dist/client.prev`; rename
   `dist/client.next` → `dist/client`; if the second rename throws, rename `.prev` back. Remove the marker.
   (g) `restarting`: `restart()` (the existing `shutdown`, which also calls `run.killAll()`).
   *On a failure in (b)–(f)*: `git reset --hard <recorded HEAD>` (safe: the tree was verified clean in
   (a)), re-install only if (c) ran, remove `dist/client.next`, leave `dist/client` untouched, remove
   the marker, `phase: failed` with `UPDATE_FAILED_TEXT[step]`; the step and `tail` go to the server
   log only. If the rollback itself fails, keep the marker and use `rollback-failed`.
   *Interrupted update* (logout, crash, restart mid-way): at start-up, a marker present →
   `unfinished: true`, `phase: failed`, `error: UPDATE_UNFINISHED_TEXT`; `start()` then resumes from the
   install (reinstall always, build, boot check, swap) against the marker's `to`.
   Plain: if anything goes wrong, TDS Brain goes back to the version it was on, and an update cut off
   half-way finishes with one click instead of leaving the app broken.

5. **Timeouts.** fetch 60 s, merge 30 s, install 10 min, build 5 min, boot check 60 s. A timeout kills
   the whole process group. Commands get `GIT_TERMINAL_PROMPT=0`.
   Plain: a stuck network can't leave the update spinning for ever.

6. **Routes** (`UPDATE_ROUTES`, also listed in `ROUTES`): `GET /api/update`, `POST /api/update/check`,
   `POST /api/update/start` with `{ confirm: true }`. All behind the existing cookie and Origin gate,
   for every role, since each person updates their own Mac. Errors use the existing `ApiError` shape.
   Plain: only someone signed in to this Mac's TDS Brain can trigger it.

7. **The banner.** In `SheetNotices`, above the other lines, when `(available || unfinished) && !blocked`
   and the page isn't already outdated (then only the existing Reload banner shows):
   "TDS Brain 0.9.0 is available." with a quiet "What's new" (only when `notes` is not empty: other
   roles get none, as with the version history), a plain small `.btn` "Update and restart", and a
   quiet "Later". When chats are open the button first asks, in place, with the
   `fieldset.close-confirm` pattern (focus on "Not now", Esc cancels): "Updating restarts TDS Brain
   and closes 2 open chats." / "…closes 1 open chat." with "Update now" and "Not now". "Later" hides it for this version in this browser
   (localStorage, try/catch); a newer version shows it again. During an update the banner shows the
   phase in words ("Downloading…", "Installing…", "Building…", "Restarting…") with `role="status"`.
   A failure shows the sentence with "Try again". While restarting, failed requests are expected:
   keep polling; after 60 s say "TDS Brain hasn't come back after a minute. Reload this page, and if
   it's still not back, tell whoever looks after TDS Brain." The existing "Reload" banner then appears
   once the restarted server reports the new version; the tab that started the update reloads by itself.
   Plain: people see one calm line at the top saying a new version is ready, and one button.

8. **Settings, About section.** Next to the version: "Check for updates" (quiet button), the result
   ("You have the newest version", "0.9.0 is ready" with the same Update button, or the `blocked`
   sentence), and "Last checked 14:05" (the `SyncStamp` time format), and `UPDATE_CHECK_FAILED_TEXT` when `checkFailed`. The version history stays where it is.
   Plain: anyone can check by hand, and see why their copy can't update if it can't.

9. **Polling.** The page reads `GET /api/update` on load, every 30 minutes, when the window regains
   focus (at most once a minute), and every 2 s while a phase other than idle/failed is running.
   One shared poller in `client/src/state/update.ts` (`useSyncExternalStore`), so `store.tsx` is untouched.
   Plain: the banner turns up within half an hour of a check finding a new version, without slowing
   anything down.

11. **Trust.** Updates come from `main` as they already do through the skill and the install; no
    remote pinning (anyone who can edit `.git/config` already runs code as the person). Recommend
    protecting `main` on GitHub (no force-push, required review): a push is now one click from every Mac.
    Plain: whatever lands on `main` reaches the team, so `main` should be guarded.

12. **Old tabs after the swap (nice).** A request for `/assets/*` that misses in `dist/client` is
    served from `dist/client.prev/assets` when present, so a tab open across the swap can still load
    its lazy chunks until it reloads.

10. **First roll-out.** Copies older than this release don't have the updater, so each person updates
    once more by `/update-brain-app` (the skill's text gains one line saying later updates are in-app).
    Plain: one last manual update, and never again.

## Contract

`shared/update-contract.ts`: the status, blocked reasons and sentences, routes, runner and updater
interfaces every builder builds against.

## Team and file ownership

| Role | Agent and model | Owns (files) |
|---|---|---|
| Overseer | `overseer`, fable | (read-only) |
| Builder A (engine) | `builder`, opus | `server/update/updater.ts`, `server/update/run.ts`, `server/update/updater.test.ts`, `server/update/run.test.ts` |
| Builder B (wiring) | `builder`, sonnet | `shared/contract.ts` (ROUTES entries only), `server/http/routes.ts`, `server/http/server.ts` (incl. the `.prev/assets` fallback; `updater?` optional in deps like `changelog?`), `server/index.ts` (incl. `--check`, wiring, `killAll` in shutdown), `server/http/update-routes.test.ts`, `brain-skills/update-brain-app/SKILL.md` |
| Builder C (page) | `builder`, sonnet | `client/src/api.ts`, `client/src/state/update.ts`, `client/src/shell/UpdateBanner.tsx`, `client/src/shell/SheetNotices.tsx`, `client/src/shell/contract.ts`, `client/src/components/SettingsView.tsx`, `client/src/styles/shell.css`, `client/src/shell/UpdateBanner.test.tsx`, `client/src/state/update.test.ts`, `client/src/shell/SheetNotices.test.tsx`, `client/src/components/SettingsView.test.tsx` |

No file appears in two rows. The lead owns `shared/update-contract.ts`, the plan, README and
`docs/design-system.md`.

## Tests

| Test file | Proves | Owner |
|---|---|---|
| `server/update/run.test.ts` | spawn not execFile; a timeout kills the process group and gives a non-zero code with `timedOut`; `tail` keeps the last 20 lines; `killAll` | A |
| `server/update/updater.test.ts` | pre-flight refusals change nothing; merge uses the recorded SHA with hooks off; install skipped when the lockfile is unchanged; vite outDir absolute; boot-check failure rolls back; swap and swap-failure restore; marker written/removed; interrupted marker → unfinished and resume; rollback failure keeps the marker; checkFailed keeps available; blocked reasons (each); version compare (0.10.0 > 0.9.9; equal and lower not available); notes filtered to newer; one shared in-flight check; start refused when busy/blocked/not available; step order and args (no shell, fixed args); failure at merge/install/build resets to recorded HEAD, re-installs, leaves dist alone, phase failed with a sentence, never calls restart; success swaps dist and calls restart once; timer only under the service | A |
| `server/http/update-routes.test.ts` | status/check/start shapes; `confirm` required; 409 busy and 403 not-allowed mapped from `UpdateRefused`; gate refuses without a cookie or with a foreign Origin; notes [] for team/unknown roles; stale `checkedAt` starts a background check; `/assets` fallback to `.prev`; `--check` exits 0 | B |
| `client/src/state/update.test.ts` | polling cadence rules; "Later" stored per version and shown again for a newer one; storage that throws is harmless | C |
| `client/src/shell/UpdateBanner.test.tsx` | hidden when blocked or not available; open-chats confirm step; phase words with role=status; failure with Try again | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build (into a scratch outDir, never this folder's dist)
- [ ] Domain gates: security (runs commands, restarts the app, trust in GitHub `main`); UX/UI
- [ ] Browser check: banner states and Settings on a preview copy (port 3878) with a stubbed status

## Review outcomes

**Overseer pre-review (Fable).** Blocking, all fixed before building: Vite resolves a relative
`--outDir` against `root: 'client'` (now absolute, via `node_modules/vite/bin/vite.js`); interrupted
updates needed a pending marker and resume; no boot check before the swap (now `server/index.ts --check`).
Should items folded in: lockfile-conditional install with `CI=true`, `spawn` runner with process-group
kill, `GIT_TERMINAL_PROMPT=0`, hooks off on merge (the repo's post-merge hook would have run the version
bump inside installs; the skill and README now turn hooks off too), merge the recorded SHA, pre-flight
with free-space check, two-rename swap with restore, `checkFailed` instead of an `offline` block,
role-gated notes, copy fixes, `.prev/assets` fallback, stale-check on GET.

**Review round.** All findings checked in code; none dropped.
- Security (Opus): a tag named `main` or `origin/main` on GitHub could freeze or pin updates (short-name
  lookup prefers tags) → fetch `--no-tags` into `refs/remotes/origin/main` and resolve the full ref;
  version string now anchored and capped. Otherwise clean.
- Correctness (Opus): shutdown didn't wait for the rollback → `Updater.abort()`, awaited by shutdown;
  the page never saw `restarting` → a failed poll after a running phase counts as restarting; the
  starting tab could miss its reload → the poller stays subscribed via `SheetNotices`.
- UX/accessibility (Opus): one always-mounted status line; focus returns after confirm/Later/Update;
  `aria-controls` on What's new; Settings stacked, shows phases and errors, `aria-disabled` while
  checking; Later edge cases; Reload button when stalled.
- Drift and copy (Sonnet): Later no longer hides a failure; failure sentences made true.

**Overseer sign-off.** Two fixes required, both done with tests: a kill mid-merge resets and resume
starts with `reset --hard HEAD` (a pending marker no longer counts as `local-changes`); a marker left
after a hand update finishes what is on disk instead of failing for ever. No further review needed.

**End-to-end (scratch clone behind a fake remote, server under a restart loop like launchd).**
0.8.2 → 0.9.0: check, banner, What's new, update, restart, the tab reloaded itself. A broken 0.9.1
(unresolvable import): boot check failed, rolled back to 0.9.0, tree clean, server kept running,
"The new version wouldn't start…" with Try again.

**Gates.** Type-check clean; 1,430 tests; lint has only the 3 warnings already on `main`; build OK;
`--check` exits 0.
