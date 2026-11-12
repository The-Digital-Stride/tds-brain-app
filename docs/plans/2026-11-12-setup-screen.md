# Setup screen: no brain, no Claude

Date: 2026-11-12 · Size: L · Branch: `setup-screen` (from `main` 1dd0526) · Explainer: no ·
Parent plan: `docs/plans/2026-11-12-installable-app.md`, decision 9 (phase 3)

## Objective

A teammate's fresh install may not find their brain folder. Today the server then runs against
`~/agencybrain` unchecked, and the app shows "Can't find your brain" with only "Check again". After
this work the app opens a Setup page that finds likely brain folders, lets the person pick one or paste
a path, checks it, saves it and restarts itself on it. Until a real brain is chosen, Claude can't be
started anywhere. Settings gets a way to change the folder later.

## Facts established

- `resolveBrainPath(env, settings, home)` (`server/settings.ts:76`) returns `TDS_BRAIN_PATH`, then
  `settings.brainPath`, then `~/agencybrain`, always a string and unchecked (phase 1 kept it so).
- `checkBrain` and `findBrainCandidates` (`server/brain/locate.ts`) already exist and are tested
  (decision 8's test: markers `.team-config/roles.json`, `tools/whoami.cjs`, `.git`; inside home; not
  the app or data folder; links resolved).
- `server/index.ts` builds everything from `config.brainPath`: `createBrainReaders`, the thumbnailer,
  upload staging, the session manager (Claude runs with `cwd: brainRoot`) and `resolvePermissionMode`.
- `BrainReaders` (`shared/contract.ts:142`) and `SessionManager` (`server/engine/session-manager.ts:118`)
  are interfaces, so a setup-mode stand-in can implement them without touching the real ones.
- `ApiErrorCode` already has `brain-missing`.
- The client: `Root` in `client/src/App.tsx:175` shows `BootProblem` (`components/Gates.tsx:54`) when
  `boot.brain.ok` is false. Settings opens with `HealthPanel`, whose "Brain folder" row shows the path.
- The LaunchAgent has `KeepAlive` true and `ThrottleInterval` 10, so any exit is restarted within
  about 10 seconds. `shutdown()` in `server/index.ts` closes chats first.
- `shared/install-contract.ts` already defines `AppState`, `SetupCandidatesResponse`,
  `SetBrainRequest`, `SetBrainResponse` and `SETUP_ROUTES`.

## Decisions

1. **The brain is decided once, at start-up, and checked.** `resolveBrainPath` keeps returning the
   candidate and its source. A new async `decideBrain(candidate, check)` runs `checkBrain` on it:
   - passes → `ready` on the resolved path;
   - fails, source `env` or `settings` → `setup`, with `tried` = that path and the refusal;
   - fails, source `default` (`~/agencybrain`, never chosen) → `setup` with `tried` and `reason` null.

   `server/index.ts` awaits it before building anything that touches the brain. `AppConfig` loses
   `brainPath`/`brainSource` and gains `brainCandidate` (unchecked), so the only brain path any brain
   code can be handed is `decision.path`.
   A folder that passes `checkBrain` but then fails `health()` stays `ready`: BootProblem shows, with
   "Check again" and "Choose a different folder".
   Plain: the app never quietly runs on a folder that isn't a brain.

2. **Setup mode runs a stand-in brain and no Claude.** In `setup`, `index.ts` builds
   `createSetupBrain()` (every reader returns empty lists, `health()` says not ok with the plain
   reason, `identity()` an unknown person, `watch()` does nothing), `createSetupSessions()`
   (`list()` is empty, `start()` throws `brain-missing`, everything else `not-found`), and stand-in
   thumbs and uploads that refuse everything. `engineHealth()` reports `permissionMode: 'default'`
   without reading any folder. The real readers, watcher, thumbnailer, upload staging, session manager
   and `resolvePermissionMode` are never reached, so Claude can't be started and no brain hook can
   load. All stand-ins live in `server/setup-mode.ts`.
   Plain: until a real brain is chosen, nothing can run Claude, by construction rather than by checks.

3. **Boot says which state.** `Bootstrap.appState: AppState` is `{ kind: 'ready' }` or
   `{ kind: 'setup', tried, reason }`. The client shows the Setup page for `setup` before any other
   screen (after the sign-in gate).

4. **Two setup routes, behind the normal gate.** Both need the session cookie; the save also needs
   the app's own Origin and JSON, as every change does.
   - `GET /api/setup/candidates` → `SetupCandidatesResponse`, from `findBrainCandidates`.
   - `PUT /api/setup/brain` with `{ path }` (a leading `~` is expanded):
     - `TDS_BRAIN_PATH` set → `{ ok: false, reason: 'env-override' }`;
     - `checkBrain` fails → `{ ok: false, reason }`;
     - passes → write `settings.json` `brainPath` (resolved path), log
       `Brain folder changed to <path>.` (path JSON-quoted), answer `{ ok: true, path, restarting:
       underService }`. When restarting, the route calls `restart()` on the response's `finish`
       event; the server shuts down (closing chats) and launchd starts it on the new brain. The
       service runs with `--no-open` and keeps its launch token, so no new tab or sign-in.
   - A pasted path is tidied first (`normalizePastedPath`): trim, strip surrounding quotes,
     unescape `\ `, expand `~`. Settings are merged, not replaced.
   - Available in both states, so Settings can change a working brain. Bodies go through the existing
     `readJson`; a path over 4 KB or not a string is `bad-request`.
   - The candidates answer also carries `openChats` and `envOverride`.
   Plain: picking a folder is checked on the server, saved, and the app restarts itself on it.

5. **The Setup page** (`client/src/components/SetupView.tsx`), full screen like the other gate panels:
   - Heading "Choose your brain folder"; one line saying what the brain folder is.
   - If `tried` is set, says it looked there and why it wasn't used (one sentence per refusal).
   - `source: 'env'` (or `envOverride`): shows the `env-override` sentence and no form, since every
     choice would be refused.
   - The found folders ("in the usual places") as a list, each with a "Use this folder" button; the
     folder in use now is marked "In use now" with no button. None found → says so.
   - A "Folder path" field, prefilled with `tried`, with a hint: in Finder, select the folder and
     press Option-Command-C to copy its path. Browsers can't hand a page a real folder path, so there
     is no folder picker.
   - On save: "Restarting TDS Brain…", then it polls `/api/bootstrap` every second until it answers
     `ready` AND `brain.path` equals the saved `path` (the old server keeps answering `ready` while it
     closes chats), then reloads. After 60 s: a plain message and "Try again". Not under the
     service: "Saved. Start TDS Brain again to use this folder."
   - Opened from Settings (state `ready`): a Cancel button; buttons read "Use this folder and
     restart"; a warning that changing the folder restarts TDS Brain and closes N open chats
     (`openChats`, worded for 0, 1 and many).
   - Refusals show inline, linked to the field with `aria-describedby`; status changes are announced.
   Plain: the person sees the folders the app found, or pastes one, and is told plainly what's wrong.

6. **Settings and the brain problem screen link to it.** The Health panel's "Brain folder" row gets a
   "Change…" button (accessible name "Change brain folder"). `BootProblem`, when the brain is found but
   not healthy, is titled "There's a problem with your brain folder" and gets "Choose a different
   folder". Both open the same full-screen Setup page through store state `setupOpen` (the shell
   unmounts, so an unsent draft is lost on Cancel; accepted for a rare action).

7. **The CLI follows.** `doctor` and `open` read the same decision, so `doctor` says "No brain folder
   chosen yet; open TDS Brain to choose one." instead of checking `~/agencybrain` blindly. `doctor`
   uses `BRAIN_REFUSAL_TEXT` and drops its own `REFUSALS` table.

## Contract

`shared/install-contract.ts` (lead): `BrainDecision`, `decideBrain`'s signature, `SetupService`, and
`BRAIN_REFUSAL_TEXT` (UK sentences per refusal, shared by the page and `doctor`). `shared/contract.ts`
(lead): `Bootstrap.appState`.

## Team and file ownership

| Role | Agent and model | Owns |
|---|---|---|
| Overseer | `overseer`, fable, high | read-only |
| Lead | me | `shared/install-contract.ts`, `shared/contract.ts`, this plan |
| Builder A: server | `builder`, opus, high | `server/brain/decide.ts` (new), `server/setup-mode.ts` (new), `server/setup-service.ts` (new), `server/index.ts`, `server/config.ts`, `server/settings.ts`, `server/http/routes.ts`, `server/http/server.ts`, `server/cli.ts`, `server/install/doctor.ts`, and their tests |
| Builder B: client | `builder`, sonnet, medium | `client/src/components/SetupView.tsx` (new), `client/src/App.tsx`, `client/src/components/Gates.tsx`, `client/src/components/HealthPanel.tsx`, `client/src/state/health.ts`, `client/src/store.tsx`, `client/src/api.ts`, `client/src/styles/*`, and their tests, plus every client test that builds a `Bootstrap` (add `appState: { kind: 'ready' }`) |

Builder A also owns every server test that builds a `Bootstrap`, `RouteContext` or `ServerDeps`.

## Tests (first, for the logic)

| Test | Proves | Owner |
|---|---|---|
| `server/brain/decide.test.ts` | ready on a pass; setup with `tried` and reason for env and settings; setup with nulls for the default | A |
| `server/setup-mode.test.ts` | `start()` throws `brain-missing`; readers return empty; `watch()` returns a no-op | A |
| `server/setup-service.test.ts` | env override refused; refusal passed on; a pass merges the resolved path into settings (other keys kept), logs, and reports `restarting` per `underService`; `normalizePastedPath` trims, strips quotes, unescapes `\ `, expands `~`; candidates carry `openChats`, `envOverride`, `current` | A |
| `server/http/routes.test.ts` (added to) | both routes need a session; the save needs Origin and JSON; bad bodies are `bad-request`; restart runs on `finish` and only when `restarting`; bootstrap carries `appState`; in setup mode bootstrap never calls `resolvePermissionMode` | A |
| `server/install/doctor.test.ts` (added to) | the "no brain chosen" message | A |
| `client/src/components/SetupView.test.tsx` | lists candidates; current marked "In use now" with no button; "Use this folder" saves; a refusal shows its sentence; "Restarting…" then reload only once `ready` with the new path (not on the old server's `ready`); 60 s give-up with "Try again"; not-under-service message; Cancel and chat-count warning only when opened from Settings; `source: 'env'` shows no form | B |
| `client/src/App` or store test | `appState: setup` shows the Setup page | B |

## Overseer pre-review (2026-11-12)

Blocking, both folded in: polling must wait for the new path (decision 5); setup mode still reached
`resolvePermissionMode` and lacked stand-in thumbs and uploads (decisions 1–2). Should, all folded in:
`AppState.source`, ownership of `state/health.ts` and Bootstrap-building tests, restart on `finish`,
pasted-path tidying, "In use now" and chat count, "usual places" wording, stale contract comments.
Rulings: stand-ins over null threading; "Change…" on the Brain folder row opening the same page;
check-passes-health-fails stays `ready`; the save route is always reachable. Trial note: on the
fresh-account trial, confirm the candidates scan can read `~/Documents` under the service.

## Gates

- Type-check, tests, lint, build, in the worktree.
- Security (opus, high): the save route (path handling, settings write, restart), setup mode really
  never starting Claude.
- UX/UI expert (sonnet) and a browser check: setup with no settings, a refused path, a good path,
  Change from Settings.
- Reviewers: correctness (opus, high), UI and accessibility (sonnet, medium).

## Review outcomes (2026-11-12)

| Gate | Confirmed | Dropped | Fixed |
|---|---|---|---|
| Security (opus) | 0 | 0 | Nothing to fix: setup mode can't start Claude or read a folder; routes gated; restart only after a valid save, on `finish`, under the service |
| Correctness (opus) | 1 | 0 | Wiring for `setupOpen`, "Change…" and "Choose a different folder" had no tests; added |
| UI and accessibility (sonnet) | 6 | 0 | Distinct button names (path in `aria-label`); status region always rendered; refusal in `--danger`; focus to the field after a refusal and to "Change brain folder" after Cancel; `role="alert"` dropped; flex gap for BootProblem buttons |
| UX expert (sonnet) | 8 | 2 | Dead end with no brain on the Mac → guidance and "Check again"; intro reworded; restart warning above the actions and on first run under the service; timed-out and saved copy; "Found on this Mac" / "Or paste the folder's path"; single candidate primary; refusal sentences plain. Dropped: "set by your IT or admin" (untrue) and "open TDS Brain from Applications" (the service restarts the server, not the PWA) |
| Overseer sign-off (fable) | — | — | Signed off. Nice items done: reload at once when the restarted server comes back in setup (the page has seen it go down, so the answer is the new server's); contract comment order |

Browser check on 3878 (restart loop standing in for launchd): first run showed the tried folder and refusal; a quoted `'~/Downloads'` was tidied and refused inline with focus on the field; choosing `~/agencybrain` saved, restarted and reloaded into the full app with no new sign-in.

Still owed before the team gets it: one real choose–restart–reload on the installed copy under the LaunchAgent, and the fresh-account trial (including whether the candidates scan can read `~/Documents`).
