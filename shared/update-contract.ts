/**
 * In-app updates (docs/plans/2026-11-13-in-app-updates.md). The server checks the installed copy's
 * GitHub `main` for a newer version and, when the person clicks "Update and restart", pulls, installs,
 * builds, checks the new code starts, and restarts itself. Shared by `server/update/`,
 * `server/http/routes.ts` and the client.
 */
import type { VersionNotes } from './contract.ts';

/** What the updater is doing now. `failed` keeps `UpdateStatus.error` until the next check or start. */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'installing'
  | 'building'
  | 'restarting'
  | 'failed';

/**
 * Why this copy can't update itself from the app. Each has a fixed UK English sentence in
 * `UPDATE_BLOCKED_TEXT`. The client never shows the update banner for a blocked copy; Settings says why.
 * - `not-service`: not started by macOS at login (a development copy, or `pnpm start` by hand), so
 *   nothing would start it again after the restart.
 * - `not-git`: the app folder isn't a git clone.
 * - `not-on-main`: the clone isn't on branch `main` tracking `origin/main`.
 * - `local-changes`: files in the app folder were changed on this Mac (`git status --porcelain` not empty).
 */
export type UpdateBlocked = 'not-service' | 'not-git' | 'not-on-main' | 'local-changes';

export const UPDATE_BLOCKED_TEXT: Record<UpdateBlocked, string> = {
  'not-service': "This copy of TDS Brain was started by hand, so it can't update itself.",
  'not-git': "This copy of TDS Brain wasn't installed from GitHub, so it can't update itself.",
  'not-on-main':
    "This copy of TDS Brain isn't on the main version, so it can't update itself. Tell whoever looks after TDS Brain.",
  'local-changes':
    "Files in this copy of TDS Brain were changed on this Mac, so it won't update itself. Tell whoever looks after TDS Brain.",
};

/** Shown when the last check couldn't reach GitHub. Not a block: a known update stays available. */
export const UPDATE_CHECK_FAILED_TEXT =
  "Couldn't check for updates just now. TDS Brain will try again later.";

/** Shown (as `error`, with phase `failed`) at start-up when an update was interrupted. */
export const UPDATE_UNFINISHED_TEXT = "The last update didn't finish. Choose Try again to finish it.";

/** The sentence for `error` when a step fails. Never raw command output (that goes to the server log). */
export const UPDATE_FAILED_TEXT = {
  preflight:
    "The update couldn't start because something on this Mac wasn't ready, such as disk space. Nothing was changed.",
  download:
    "The update couldn't be applied. Nothing was changed. Try again, or tell whoever looks after TDS Brain.",
  install: "The update couldn't be installed. TDS Brain is still on the version you had.",
  build: "The update couldn't be built. TDS Brain is still on the version you had.",
  'boot-check': "The new version wouldn't start, so TDS Brain stayed on the version you had.",
  'rollback-failed':
    "The update didn't finish and TDS Brain couldn't go back to the version you had. Choose Try again, or tell whoever looks after TDS Brain.",
} as const;
export type UpdateFailedStep = keyof typeof UPDATE_FAILED_TEXT;

export interface UpdateStatus {
  /** The running version (package.json at start-up). */
  current: string;
  /** The version on GitHub `main` at the last successful check. null before the first one. */
  latest: string | null;
  /** True when `latest` is a higher version than `current` (x.y.z compared as numbers). */
  available: boolean;
  /** null when this copy can update itself. */
  blocked: UpdateBlocked | null;
  /** ISO time of the last check that reached GitHub. null before the first one. */
  checkedAt: string | null;
  /** True when the most recent check couldn't reach GitHub. `available` keeps its last good value. */
  checkFailed: boolean;
  /**
   * True when an update was interrupted (the pending marker is in the data folder) or its rollback
   * failed. `start()` is then allowed even when `available` is false, and finishes the update.
   */
  unfinished: boolean;
  phase: UpdatePhase;
  /** One plain UK English sentence when `phase` is `failed`; else null. */
  error: string | null;
  /**
   * CHANGELOG entries on `main` newer than `current`, newest first. [] when none or unreadable.
   * The route sends [] to roles other than owner and scout (the same rule as `ROUTES.changelog`).
   */
  notes: VersionNotes[];
  /** Chats a restart would close, so the page can warn before it starts. */
  openChats: number;
}

/** `POST /api/update/start` body. Anything else is 400 `bad-request`. */
export interface StartUpdateRequest {
  confirm: true;
}

/**
 * Routes (also listed in `ROUTES` in shared/contract.ts). Every one is behind the existing
 * session-cookie and Origin gate, for every role: each person updates their own Mac.
 * - `GET  /api/update`        → UpdateStatus. `no-store`. Never waits on git; when `checkedAt` is
 *   over UPDATE_CHECK_EVERY_MS old (timers stall while a Mac sleeps) it starts a background check.
 * - `POST /api/update/check`  → UpdateStatus after a fresh check. 409 `busy` while an update runs.
 *   At most one check runs at once; a second caller waits for the same one.
 * - `POST /api/update/start`  StartUpdateRequest → 202 UpdateStatus with phase `downloading`.
 *   409 `busy` if one is already running; 403 `not-allowed` when `blocked` is set, or nothing is
 *   `available` and nothing is `unfinished`. Progress is read with `GET /api/update`. On success the
 *   server restarts itself.
 */
export const UPDATE_ROUTES = {
  status: '/api/update',
  check: '/api/update/check',
  start: '/api/update/start',
} as const;

/** How often the server checks GitHub on its own, and how long after start-up the first check runs. */
export const UPDATE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const UPDATE_FIRST_CHECK_AFTER_MS = 2 * 60 * 1000;

/** Free space the pre-flight wants in the app folder's volume before it changes anything. */
export const UPDATE_MIN_FREE_BYTES = 1024 * 1024 * 1024;

/** The marker written to `<dataDir>/update-pending.json` before the merge, removed after the swap or a clean rollback. */
export interface UpdatePending {
  /** HEAD before the update. */
  from: string;
  /** The `origin/main` SHA recorded at the check, the one merged. */
  to: string;
  /** Version strings, for the log. */
  fromVersion: string;
  toVersion: string;
  startedAt: string;
}

/**
 * One command the updater runs: `spawn` (never `execFile`'s 1 MB buffer), no shell, fixed arguments,
 * `detached` so a timeout or `killAll()` kills the whole process group (pnpm outlives npx otherwise).
 * Never rejects: a spawn error or timeout is a non-zero `code`. `tail` is the last 20 lines of
 * stdout and stderr together, for the server log only.
 */
export interface UpdateCommandResult {
  code: number;
  stdout: string;
  tail: string;
  timedOut: boolean;
}
export interface UpdateCommandRunner {
  (
    file: string,
    args: string[],
    opts: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv },
  ): Promise<UpdateCommandResult>;
  /** Kills every process group still running (called from the server's shutdown). */
  killAll(): void;
}

/** `server/update/updater.ts` `createUpdater(deps)`. */
export interface UpdaterDeps {
  appRoot: string;
  /** `<appRoot>/dist/client`, the folder the server serves. Swapped with `client.next` / `client.prev` beside it. */
  clientDir: string;
  /** The app's data folder, for `update-pending.json`. */
  dataDir: string;
  currentVersion: string;
  underService: boolean;
  run: UpdateCommandRunner;
  /** The folder holding the running `node` (dirname of process.execPath): `npx` is found there. */
  nodeBinDir: string;
  /** The running `node` (process.execPath), for `vite.js build` and the boot check. */
  nodePath: string;
  /** Base environment for commands (process.env); the updater adds PATH, CI, GIT_TERMINAL_PROMPT. */
  env: NodeJS.ProcessEnv;
  /** Free bytes on the volume holding `path` (fs.statfs). */
  freeBytes(path: string): Promise<number>;
  openChats(): Promise<number>;
  /** Stops the server cleanly; launchd starts it again on the new code. */
  restart(): void;
  log(line: string): void;
  now(): Date;
}

export interface Updater {
  status(): Promise<UpdateStatus>;
  /** Fetches from GitHub and re-reads what's on `main`. Shares one in-flight check. */
  check(): Promise<UpdateStatus>;
  /** Starts the update in the background and returns at once. Throws `UpdateRefused` when it can't. */
  start(): Promise<UpdateStatus>;
  /** Begins the timed checks (first after UPDATE_FIRST_CHECK_AFTER_MS). A no-op unless under the service. */
  startTimer(): void;
  stopTimer(): void;
  /**
   * Called by the server's shutdown, which awaits it (bounded by its own 20 s exit timer). Stops
   * the timer, kills running commands and refuses new ones. If an update had changed the code
   * (merge done, swap not done), runs only `git reset --hard <from>` with a short timeout and KEEPS
   * the marker, so the next start shows `unfinished` and a resume reinstalls. Never throws.
   */
  abort(): Promise<void>;
}

export class UpdateRefused extends Error {
  readonly reason: 'busy' | 'not-allowed';
  constructor(reason: 'busy' | 'not-allowed') {
    super(reason);
    this.reason = reason;
  }
}
