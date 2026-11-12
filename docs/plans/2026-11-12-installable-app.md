# Installable app: always running, a Dock icon, any brain folder

Date: 2026-11-12 · Size: XL (three phases) · Branch: `installable-app` (from `main` 9e922e1) ·
Explainer: https://claude.ai/artifact/8H4b5LEW21pZY17Cg6whH9

## Objective

Make TDS Brain something a team member installs once and then just opens. It starts on its own
when the Mac starts, opens from a Dock icon as its own window, finds the person's brain wherever
they keep it, and runs Claude Code in that folder without anyone starting anything. Today it only
runs while someone keeps `pnpm start` open in a terminal, assumes `~/agencybrain`, and exists only
on Ian's Mac.

## User decisions (fixed)

- **Code home:** a new private GitHub repo under `The-Digital-Stride` (created by Ian; name
  `The-Digital-Stride/tds-brain-app`). Installs clone it and updates pull from it. The repo is created
  and pushed only after Ian approves this plan. Each push needs his go-ahead.
- **Scope:** ready for the team in this piece of work. That means the background service, the
  installable PWA, first-run brain-folder setup, the sign-in change, and install and update skills
  in the brain.
- **Explainer:** yes. A one-page diagram, built after the overseer pre-review.
- macOS only (the whole team is on Macs). Chrome is the supported browser, as today.

## Facts established

- **Claude already runs in the brain.** `server/engine/session-manager.ts:751` starts each chat
  with `cwd: opts.brainRoot` and `pathToClaudeCodeExecutable: opts.claudePath`. Nobody starts
  Claude by hand; only the app's own server needs starting.
- **Where things are found.** `server/config.ts` `resolveConfig()` takes the brain from
  `TDS_BRAIN_PATH`, else `~/agencybrain`. The data folder comes from `TDS_BRAIN_APP_DATA`, else
  `<app>/data`. The port comes from `TDS_BRAIN_APP_PORT`, else 3877. `findClaude()` searches
  `PATH`, `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin` and `/usr/local/bin`.
- **The brain's location varies.** The brain's own `docs/adding-a-team-member.md` says
  "`cd ~/[your brain folder]`", so a team member's brain can be anywhere.
- **Sign-in today.** `server/index.ts` mints a single-use code (60 s, held in memory) and opens
  Chrome at `/auth?code=…`. `authExchange` swaps the code for a cookie:
  `HttpOnly; SameSite=Strict; Path=/; Max-Age=30 days`, valued `cookieValueFor(launchToken)`, a
  hash of the secret in `<data>/runtime.json` (mode 0600). A second `pnpm start` proves it holds
  that secret (`/auth/ping`, then `/auth/code` with an HMAC proof) and opens a fresh code.
- **The gate.** `server/http/security.ts` `checkRequest()` rules, in order:
  - The `Host` must be exactly `127.0.0.1:<port>`.
  - Any foreign `Origin` is refused.
  - Every path except the `/auth*` ones needs the session cookie. A page visit without one gets
    `LAUNCHER_PAGE` (401).
  - Requests that change things need the app's own `Origin` and a JSON or upload content type.

  So today the manifest, icons and a service worker would all be refused without a cookie.
- **What's served.** The default CSP is `default-src 'self'`, which also covers workers.
  `server/http/server.ts` already maps `.webmanifest` to `application/manifest+json`. Static files
  are `no-cache`, and hashed assets are immutable.
- **Ian's machine:** Node is managed by nvm. `~/.local/bin/node` is a small script that runs the
  newest nvm Node 22, written so processes keep working after an nvm upgrade. `claude` is
  `~/.local/bin/claude`.
- **Stopping the server ends live chats.** `shutdown()` calls `sessions.closeAll()`. Every restart,
  including updates, ends open chats.
- **Building in the folder the app runs from replaces its screens.** This happened earlier today.
  The README already says to keep the everyday folder on `main` and build elsewhere.

## Decisions (after the overseer pre-review; see "Pre-review outcomes" below)

1. **macOS starts the server at login and keeps it running.** The installer writes a LaunchAgent
   at `~/Library/LaunchAgents/uk.co.thedigitalstride.tds-brain.plist`:
   - `RunAtLoad` and `KeepAlive` are true, so it restarts after a crash.
   - `ThrottleInterval` is 10 s and `ExitTimeOut` is 30 s, which leaves room for `shutdown()`'s own
     20 s.
   - `ProgramArguments` is a single executable inside the app bundle the installer builds,
     `~/Applications/TDS Brain Sign-in.app/Contents/MacOS/tds-brain-service`, which `exec`s the
     node launcher (decision 2) with `<app>/server/index.ts --no-open`. The spike showed macOS names
     the login item after the bundle that holds its executable, so Login Items shows "TDS Brain
     Sign-in", not "node" from "Unknown Developer". `AssociatedBundleIdentifiers` is dropped: it
     made no difference, because it only works for apps signed with an Apple developer
     certificate.
   - `WorkingDirectory` is the app folder.
   - Logs go to `~/Library/Logs/TDS Brain/server.log`.
   - The environment adds `TDS_BRAIN_SERVICE=1`, so the server knows launchd will restart it.

   Install can be run again safely, in this order:
   1. Stop an older copy already on the port, after it passes the ping proof.
   2. `launchctl bootout gui/<uid>/<label>`, ignoring its error.
   3. `enable`. A disabled service stays disabled across restarts.
   4. `bootstrap`.
   5. Wait until the server answers.

   Restart is `launchctl kickstart -k`.
   Plain: the app is already running whenever the Mac is on, and installing twice does no harm.

2. **The service gets a fixed PATH and a stable Node.** launchd doesn't read shell settings, so
   the plist sets:
   - `PATH` to the app's `bin`, then `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`,
     `/usr/bin` and `/bin`. The brain's hooks need `node`, `bash`, `git`, `jq` and `python3`, and
     `jq` is in `/usr/bin` on current macOS.
   - `LANG=en_GB.UTF-8`.

   The plist runs `<app>/bin/node`, a launcher script the installer writes. It `exec`s the newest
   Node 22.18 or later it finds in nvm, Homebrew or the system, so an nvm upgrade doesn't break the
   service. `doctor` checks each tool using the service's PATH, not the terminal's.
   Plain: the brain's hooks behave the same as they do in Terminal, and updating Node doesn't stop
   the app.

3. **An installable PWA, served from `http://127.0.0.1:3877`.** Browsers treat a local address as
   safe (W3C Secure Contexts), so Chrome offers Install. The app adds:
   - `client/public/manifest.webmanifest`, with `"id": "/"`, `start_url: /`, `scope: /`,
     `display: standalone`, `launch_handler: { client_mode: "navigate-existing" }` and the TDS
     mark as icons (192, 512 and a maskable 512).
   - `<link rel="manifest">` and `theme-color` in `client/index.html`.
   - A service worker, `/sw.js`.

   Chrome then makes its own "TDS Brain" app in `~/Applications/Chrome Apps.localized/`. That is
   the Dock icon.
   Plain: TDS Brain appears in the Dock and opens like any other app.

4. **The service worker only shows a friendly page when the app isn't running.** It caches one
   page, `/offline.html`, plus its icon at install.
   - For page loads it goes to the network first, and shows the offline page only when the
     connection fails.
   - It never caches or answers `/api/*`, `/auth*`, `/manifest.webmanifest` or `/sw.js`.
   - The offline page has no script (the CSP would block an inline one). A
     `<meta http-equiv="refresh" content="5">` retries and reloads into the app once the server
     answers.
   - A self-unregistering version of `sw.js` is kept ready, in case the worker ever needs
     removing.
   Plain: instead of a browser error you see what to do, and the app comes back by itself.

5. **An exact public allow-list in the gate.** `checkRequest()` lets these through without a
   session, for `GET` and `HEAD` only, after the `Host` and `Origin` checks:
   - exactly `/manifest.webmanifest`, `/sw.js`, `/offline.html` and `/offline.css` (the CSP blocks inline styles);
   - icons matching `^/icons/[a-z0-9-]+\.(png|svg)$`.

   A public path whose file is missing gets a 404, never the app's home page.
   Plain: only the named files are public, and nothing slips through on a lookalike address.

6. **Sign-in: a long cookie renewed on each visit, a small app for the rare re-sign-in.**
   - **(a) Renewal.** The cookie's `Max-Age` becomes 400 days, Chrome's cap. It is re-sent on
     every authenticated `GET /api/bootstrap`. The value and its protections (`HttpOnly`,
     `SameSite=Strict`) are unchanged.
   - **(b) "TDS Brain Sign-in".** A small app at `~/Applications/TDS Brain Sign-in.app`, a shell
     script in a bundle the installer builds locally. It isn't the Dock icon. It runs
     `<app>/bin/tds-brain open`, which uses the existing `/auth/ping` and `/auth/code` handshake
     to mint a code and opens `/auth?code=…` with `open -a "Google Chrome"`. That goes to the Chrome
     profile used last. Install can't record a profile, because macOS blocks reading Chrome's
     profile list, so the signed-out page says to open the link in the main profile if Chrome
     picked another. Signing in still only ever starts from something that can read the 0600
     secret file. If the wrong profile proves a nuisance, the security gate in phase 2 considers a
     window-approved sign-in: the window asks, and the Sign-in app approves.
   - **(c) The signed-out page.** `LAUNCHER_PAGE` says "Open TDS Brain Sign-in from Applications to
     sign in again" and refreshes every 5 s. Once a tab sets the cookie, a signed-out PWA window
     picks it up, because they share the Chrome profile's cookies.
   - **(d) `tds-brain sign-out-everywhere`.** Makes a new secret in `runtime.json`, which ends every
     cookie. Cookies aren't separated by port, so this is the remedy if one ever leaks to another
     local server. It doesn't remove a service worker another program planted while the port was
     free; for that, the gate answers any foreign worker's update check (`Service-Worker: script`
     on a path other than `/sw.js`) with the self-unregistering worker (phase 2 security review).
   Plain: you stay signed in for over a year, and when you do need to sign in, there's one obvious
   app for it.

7. **App settings live outside the app folder.** The data folder default moves to
   `~/Library/Application Support/TDS Brain/data/`, holding `runtime.json`, `prefs.json`, caches
   and the new `settings.json`. Nothing moves automatically on start-up. Moving Ian's existing data
   is explicit: `install --migrate-from <path>` copies it, checks it, then renames the old folder to
   `data.moved`. That keeps his launch token, so his sign-in survives. Environment variables still
   override everything, for development and the preview port.
   Plain: updating or reinstalling never loses your settings, and your current sign-in and pins
   come across once, on purpose.

8. **The brain path comes from settings, set by the installer.** `resolveConfig()` uses, in order:
   `TDS_BRAIN_PATH`, then `settings.json` `brainPath`, then `~/agencybrain` if it is a brain, else
   `null`.

   **A folder counts as a brain** when it has `.team-config/roles.json`, `tools/whoami.cjs` and a
   `.git` (a folder or, for a worktree, a file). The path must be absolute, resolved through any
   links, and inside the person's home folder. It must not be the app folder or inside the data
   folder.

   On Ian's Mac the service read a brain in `~/Documents` without a prompt. That may be because
   Node already had permission there, so the phase 3 trial on a fresh account checks it again.
   If it fails, the check refuses those folders with `protected-folder`, and `doctor` reports
   EPERM.
   Plain: each person's app points at their own brain, and the app says so plainly if it can't see
   it.

9. **No brain, no Claude.** `AppConfig.brainPath` is `string | null`.
   - **While it is `null`:**
     - the session manager refuses to start any chat;
     - the brain readers and the watcher do nothing;
     - boot returns `appState: { kind: 'setup' }`.
   - **The Setup page:**
     - lists brains found one level inside `~`, `~/Documents`, `~/Developer`, `~/Projects` and
       `~/My Repos`;
     - lets the person paste a path, since browsers can't hand a web page a full folder path;
     - checks the choice with decision 8's test and saves it.
   - **After saving:** under the service (`TDS_BRAIN_SERVICE=1`) the server exits and launchd
     restarts it on the new brain. Otherwise it says to start it again.
   - **Settings** gains a "Brain folder" row with a Change button that opens the same page.

   Each change is written to the log. Anyone with a session can already approve what Claude does,
   so a page that changes the brain adds no new power.
   Plain: until a real brain is chosen, Claude can't be started anywhere, and the app asks rather
   than breaks.

10. **One command-line tool.** `server/cli.ts`, run as `<app>/bin/tds-brain <command>`, has these
    commands:
    - `install --brain <path> [--migrate-from <path>]`: writes `settings.json`, the node launcher,
      the LaunchAgent and the sign-in app (holding the service executable), loads the agent
      (decision 1's order) and opens the sign-in.
    - `open`
    - `restart`
    - `doctor`: checks Node, each tool on the service PATH, Claude Code, the brain (including
      EPERM on protected folders), the build, the agent, the port (naming any other program on
      it), whether the server answers, and the sign-in app. It ends with the last log lines.
    - `sign-out-everywhere`
    - `uninstall [--all]`: removes the agent and the sign-in app. `--all` also removes the data
      folder, never the app folder. It says how to remove the PWA in `chrome://apps`, which the
      tool can't do itself.

    The plist, the node launcher and the sign-in app's contents are made by pure functions, so
    they can be tested. `codeFromRunningServer` and `openBrowser` move from `server/index.ts` to
    `server/launcher.ts`, so the server and `open` share them.
    Plain: install, repair and remove are each one step, and the skills only call these.

11. **The installed copy is not the development copy.** The app is cloned to
    `~/Library/Application Support/TDS Brain/app`, beside `data`, not inside it. For Ian, that is
    not the `My Repos` folder he develops in, so building or switching branches there never
    touches the running app. The README's "Working on it" section is updated to match.
    Plain: working on the app can't break the copy you're using, and removing settings never
    removes the app.

12. **Install and update through the brain.** Skills are written in this repo under
    `brain-skills/` and copied into the brain's `.claude/skills/` as a separate, approved step,
    because that writes to the shared brain everyone syncs.
    - **`/install-brain-app`** works through these steps:
      1. Checks Node 22.18 or later, `pnpm` via `corepack`, `git`, Claude Code, and GitHub access to
         the repo.
      2. Clones the repo, then runs `pnpm install --frozen-lockfile` and `pnpm build`.
      3. Runs `bin/tds-brain install --brain "$PWD"`.
      4. Warns about macOS's "Background Items Added" notice and says not to switch the item off.
      5. Walks the person through Chrome's Install button.
    - **`/update-brain-app`** warns if there are live chats, which a restart ends. It then runs
      `git pull --ff-only`, `pnpm install --frozen-lockfile` and `pnpm build`, then
      `bin/tds-brain restart`.
    - **`/doctor-brain-app`** runs `bin/tds-brain doctor` and explains the result.
    Plain: a team member types one command in Claude in their brain, and the app is set up.

13. **GitHub.** Ian created the private `The-Digital-Stride/tds-brain-app` (2026-11-12). Push `main` with its
    history, after checking that `.gitignore` covers `data/`, `dist/` and `.playwright-mcp/`. Team
    members get read access through an org team, so the install skill can clone. No CI in this
    phase. The README gains an "Install" section that points to the skill.
    Plain: the code is backed up, everyone installs the same version, and updates are one pull.

14. **Phasing.** Each phase ends usable:
    0. **Spike, half a day, nothing kept.**
       - Chrome offers Install on `127.0.0.1:3877`.
       - Whether `open -a "Google Chrome" <url>` lands in the PWA window.
       - A cookie set in a tab reaches the PWA window.
       - Which profile `open` targets when there are two, and whether `--profile-directory` fixes
         it.
       - Whether the service can read a brain in `~/Documents`.
       - How Login Items names the agent.
    1. **Runs by itself (Ian's Mac):** decisions 1, 2, 7, 8 (settings read; `install` writes it),
       10 (all commands except the Setup-page restart), 11 and 13. Ian's app moves to the installed
       copy with `--migrate-from`.
    2. **Dock app:** decisions 3, 4, 5 and 6.
    3. **Ready for the team:** decisions 9 and 12, then a trial install on a second macOS user
       account with the brain outside `~/agencybrain`. Use `~/Documents/brain` if the spike says
       that works, else `~/Developer/brain`.

## Step 0 spike results (2026-11-12, Chrome 157, macOS 27.0.1)

Throwaway app on `127.0.0.1:3879`, a test LaunchAgent and a test sign-in app, all removed afterwards.

| Question | Result | Effect on the plan |
|---|---|---|
| Does Chrome offer Install on a local address? | Yes. Chrome made `TDS Spike.app` in `~/Applications/Chrome Apps.localized/`, and it opened standalone (`display-mode: standalone`). | Decision 3 holds. |
| Does `open -a "Google Chrome" <url>` open in the app window? | No, it opens a tab. Opening Chrome's app with a URL opens the window at `start_url` and ignores the URL. | Decision 6: the Dock icon is Chrome's app; the Sign-in app opens a tab. |
| Does a cookie set in a tab reach the app window? | Yes. After the Sign-in app signed in a tab, a fresh app window loaded signed in. | Decision 6 holds. |
| Two Chrome profiles | Chrome's app isn't tied to one profile folder. `open -a` uses the profile used last. `--profile-directory=Default` did open a different profile, so steering works, but macOS blocks reading Chrome's profile list, even outside Claude's sandbox. | Install can't record the profile. Decision 6b uses the last-used profile, with guidance on the signed-out page. |
| Can the service read a brain in `~/Documents`? | Yes on Ian's Mac, with no prompt. | Recheck on a fresh account in the phase 3 trial. |
| How does Login Items name the service? | As "node" from "Unknown Developer" when it runs the node launcher directly; `AssociatedBundleIdentifiers` was ignored (unsigned). As "TDS Spike Sign-in" when the executable sits inside the app bundle. | Decision 1: the service executable lives in the sign-in app bundle. |
| Does the PATH and the node launcher work? | Yes. It found `git`, `jq`, `python3`, `bash` and `claude`, and the launcher picked Node 24.15, the newest qualifying version in nvm. | Decision 2 holds. |

## Contract

`shared/install-contract.ts` holds the settings file shape, the brain check and its refusals, the
setup routes and their types, the boot `AppState`, the public paths, the CLI commands, the
LaunchAgent spec and the doctor report. The `Bootstrap` change in `shared/contract.ts` and the
nullable `AppConfig.brainPath` belong to the lead. Builders build against these; changes go through
the lead.

## Team and file ownership

| Role | Agent and model | Owns (files) |
|---|---|---|
| Overseer | `overseer`, fable, high (opus when Fable is at its limit) | (read-only) |
| Lead | me | `shared/install-contract.ts`, `shared/contract.ts` (`Bootstrap`), this plan, README, `.gitignore`, GitHub setup, the spike |
| Builder A: config, gate and server | `builder`, opus, high | `server/config.ts`, `server/settings.ts`, `server/brain/locate.ts`, `server/launcher.ts`, `server/index.ts`, `server/http/security.ts`, `server/http/server.ts`, `server/http/routes.ts` (setup routes, renewal), `server/engine/session-manager.ts` (refuse with no brain), `server/brain/index.ts` and `watch.ts` (no-op with no brain) |
| Builder B: CLI and service | `builder`, sonnet, medium | `server/cli.ts`, `server/install/*` (plist, node launcher, sign-in app, doctor, migrate), `bin/tds-brain` |
| Builder C: PWA and setup screen | `builder`, sonnet, medium | `client/public/*` (manifest, icons, `sw.js`, `sw-off.js`, `offline.html`), `client/index.html`, `client/src/components/SetupView.tsx`, Settings brain-folder row, store and `App.tsx` setup state |
| Builder D: brain skills | `builder`, sonnet, medium | `brain-skills/install-brain-app/SKILL.md`, `brain-skills/update-brain-app/SKILL.md`, `brain-skills/doctor-brain-app/SKILL.md` |

No file appears in two rows. Builder A moves the launcher code into `server/launcher.ts` first, so
Builder B can import it from the start.

## Tests (first, for the logic)

| Test file | Proves | Owner |
|---|---|---|
| `server/settings.test.ts` | resolution order is env, then settings, then `~/agencybrain`, then null; a broken `settings.json` is ignored and never throws | A |
| `server/brain/locate.test.ts` | the brain check accepts a real brain and a worktree (`.git` file); it rejects a missing marker, a relative path, a link out of home, the app folder and anything inside the data folder; the search goes one level only and skips dot folders | A |
| `server/http/security.test.ts` (added to) | only the exact public paths and the icon pattern pass, for `GET`/`HEAD`, still behind the Host and Origin checks; `/sw.js/`, `/SW.JS`, `/icons/`, `/icons/a/b`, `/icons/x` and `/icons/../api/x` are refused; a public path with no file gets 404, not the home page | A |
| `server/http/routes.test.ts` (added to) | bootstrap re-sends a 400-day cookie only with a valid session; setup routes list candidates, refuse a non-brain path and `env-override`, save a valid one, and refuse without a session or from another origin | A |
| `server/engine/session-manager.test.ts` (added to) | with no brain, starting a chat is refused and Claude is never started | A |
| `server/install/plist.test.ts` | exact keys (`ExitTimeOut`, `ThrottleInterval`, the environment, and `ProgramArguments` pointing at the service executable inside the sign-in app); paths with spaces and `&` are escaped | B |
| `server/install/node-launcher.test.ts` | picks the newest Node at 22.18 or later across nvm, Homebrew and the system, and refuses older ones | B |
| `server/install/signin-app.test.ts` | the bundle's `Info.plist` and script; the script quotes the app path | B |
| `server/install/doctor.test.ts` | each failure (no Node, a missing tool on the service PATH, no Claude, brain missing or EPERM, agent not loaded, port held by another program, no build) gives its plain message | B |
| `server/install/migrate.test.ts` | copies, checks, renames the old folder, keeps the launch token, and refuses to overwrite existing data | B |
| `client/src/components/SetupView.test.tsx` | lists candidates, shows a refusal reason, and says "Restarting…" then reloads | C |
| `client/src/sw.test.ts` (runs `client/public/sw.js` in `node:vm` with a fake worker; a test inside `public/` would ship in the build) | a failed page load gives the offline page; `/api`, `/auth`, the manifest and `sw.js` are never cached or answered | C |

## Gates

- [ ] Type-check · [ ] Tests · [ ] Lint · [ ] Build, run in the worktree, never in the folder the
  app runs from
- [ ] **Security** (expert, opus, high), for the cookie renewal, the public allow-list, the setup
  routes, the sign-in app and `sign-out-everywhere`
- [ ] **UX/UI** (expert, sonnet): the setup screen, the offline page, the signed-out page wording
  and the Settings row
- [ ] **Browser check:**
  - Install the PWA from Chrome.
  - Restart the Mac: the app comes back on its own.
  - Kill the server: the offline page shows, then the app recovers.
  - Remove `settings.json`: the setup screen appears and no chat can start.
- [ ] **Trial install** on a second macOS user account, run only through `/install-brain-app`

## Risks

- **Restarts end live chats** (updates, brain-path changes). The update skill and the setup
  screen say so first.
- **Port 3877 is fixed per Mac.** The PWA's identity is tied to it. If another program takes it,
  `doctor` says which one and the agent can't start.
- **Chrome profiles.** The PWA belongs to one Chrome profile. Install records it, and the sign-in
  app opens that profile. Installing in another profile means signing in there too.
- **Background Items notice.** macOS 13 and later announce the new login item. If someone switches
  it off in System Settings, the app stops starting; `doctor` spots it.
- **GitHub access.** A team member without org access can't clone. The install skill checks first
  and says who to ask.

## Pre-review outcomes (2026-11-12, Opus; Fable was at its limit)

All blocking and should items were accepted and are folded into the decisions above.

- **B1 (decision 6):** a script launcher as the Dock icon would open a Chrome tab on every click,
  and "TDS Brain" would appear twice in Spotlight. Fixed: Chrome's own PWA app is the Dock icon,
  the script app becomes "TDS Brain Sign-in", and the signed-out page refreshes itself.
- **B2 (decision 9):** in setup, a chat could have started Claude in a fallback folder and loaded
  its hooks. Fixed: `brainPath` is nullable and the session manager refuses to start a chat
  without it.
- **B3 (decisions 8 and 9):** a launchd service may not be allowed to read `~/Documents`. Fixed:
  checked in the spike, with a `protected-folder` refusal and an EPERM message in `doctor`.
- **S1:** exact public paths and an icon pattern. A missing public file gets 404 rather than the
  home page, and the offline page uses a meta refresh because the CSP blocks inline scripts.
- **S2:** a 400-day cookie renewed on every bootstrap, replacing "once a day", which would have
  needed extra state.
- **S3:** install order of `bootout`, `enable`, `bootstrap`, then wait; `ExitTimeOut` 30;
  `AssociatedBundleIdentifiers` (later dropped: the spike showed it is ignored for an unsigned app); `TDS_BRAIN_SERVICE=1`.
- **S4:** an explicit `--migrate-from` replaces moving data on start-up.
- **S5:** `app` sits beside `data`, not inside it.
- **S6:** Node 22.18 or later; `LANG`; `doctor` checks tools on the service PATH.
- **S7:** the settings read moves into phase 1; the launcher code moves to `server/launcher.ts`;
  the lead owns the `Bootstrap` change.
- **S8:** manifest `id`, a self-unregistering worker, and PWA removal steps from `uninstall`.
- **Nice, taken:** `sign-out-everywhere`, worktree `.git` files, and tests for the node launcher
  and the sign-in app. Gatekeeper needs no action, because the bundle is built locally.
- **Rulings:** decision 6 as above. The spike (phase 0) settles what the documentation can't.

## Review outcomes

### Phase 1 (2026-11-12, merged as `fd284f1`)

- **Correctness:** install moved the old data before checking an old copy still held the port; now
  every check runs first and a held port changes nothing. `doctor` and `open` created
  `runtime.json`, which then blocked `--migrate-from`; they now only read it.
- **Security:** the CLI and the server could resolve different data folders (so `uninstall --all`
  could remove the wrong one); now one `resolveDataDir`. `data.moved` held the live secret and wasn't
  git-ignored (`*.moved/`). `sign-out-everywhere` said "signed out" when no restart happened. The
  brain may not contain the data or app folder.
- **Overseer:** a failed reinstall no longer switches off the working copy. Dropped:
  `AssociatedBundleIdentifiers`, which the spike showed is ignored.
- **Cutover:** Ian's app moved to the installed copy; service running, the sign-in secret carried
  across, a chat ran the brain's tools under the service PATH, and Login Items lists
  "TDS Brain Sign-in" under "Unknown Developer" (unsigned).

### Phase 2 (2026-11-12, `b6a3765`)

- **Correctness and browser check:** the offline page lost its stylesheet and mark, because the
  worker answered only page loads; those two files now fall back to the cache. The Dock row was
  wrong after the prompt and when already installed.
- **Security:** a worker planted by another program while the port was free would survive
  `sign-out-everywhere`; any foreign worker's update check now gets the self-unregistering worker.
  The 400-day cookie was judged fine: the server never checks expiry, so `Max-Age` only sets how long
  Chrome keeps it.
- **UX:** calmer offline wording ("TDS Brain is starting up"), the Terminal step only for whoever looks
  after the app, Spotlight directions to TDS Brain Sign-in, and page titles that follow the heading.
- **Overseer:** pass. Still to check on Ian's Chrome after the update: install, the Sign-in app
  reviving a signed-out window, and the profile wording.
