/**
 * Contract for the installable app (docs/plans/2026-11-12-installable-app.md).
 * Types and signatures only. Builders build against these; changes go through the lead.
 */

// ---------------------------------------------------------------------------
// Settings and folders (decisions 7, 8)
// ---------------------------------------------------------------------------

/** `<data>/settings.json`. Every field optional; a missing or broken file means `{}`. */
export interface AppSettings {
  /** Absolute, link-resolved path to the person's brain. */
  brainPath?: string;
}

/** Where a setting came from, so Settings and `doctor` can say why. */
export type SettingSource = 'env' | 'settings' | 'default';

/**
 * Everything installed lives in `~/Library/Application Support/TDS Brain/`: the app clone in `app/`
 * and the data folder in `data/`, side by side (decision 11). `TDS_BRAIN_APP_DATA` overrides the data folder.
 */
export const SUPPORT_DIR_NAME = 'TDS Brain';
export const INSTALLED_APP_DIR = 'app';
export const INSTALLED_DATA_DIR = 'data';

/**
 * Added to `AppConfig` (lead). `brainPath` is null when no folder passes the brain check; then no chat
 * may start and the brain readers and watcher do nothing (decision 9).
 */
export interface BrainConfig {
  brainPath: string | null;
  brainSource: SettingSource | null;
  /** True when `TDS_BRAIN_SERVICE=1`: launchd restarts the server when it exits. */
  underService: boolean;
}

/**
 * `server/settings.ts` (Builder A). Functions are pure apart from the file reads and writes named.
 * - `supportDir(home)`: `<home>/Library/Application Support/TDS Brain`
 * - `defaultDataDir(home)`: `<supportDir>/data`; `installedAppDir(home)`: `<supportDir>/app`
 * - `readSettings(dataDir)`: `<dataDir>/settings.json`, `{}` when missing or broken; never throws
 * - `writeSettings(dataDir, settings)`: atomic (temp file + rename), file 0600, folder created 0700
 * - `resolveBrainPath(env, settings, home)`: `TDS_BRAIN_PATH`, then `settings.brainPath`, then
 *   `<home>/agencybrain`. Phase 1 keeps today's unchecked fallback; the `null` of decision 9 arrives in phase 3.
 */
export interface SettingsModule {
  supportDir(home: string): string;
  defaultDataDir(home: string): string;
  installedAppDir(home: string): string;
  readSettings(dataDir: string): AppSettings;
  writeSettings(dataDir: string, settings: AppSettings): void;
  resolveBrainPath(
    env: Record<string, string | undefined>,
    settings: AppSettings,
    home: string,
  ): { path: string; source: SettingSource };
}

/** Where `checkBrain` looks for clashes. */
export interface BrainCheckContext {
  home: string;
  appRoot: string;
  dataDir: string;
}

/** Why a folder is not accepted as a brain. */
export type BrainRefusal =
  | 'not-absolute'
  | 'not-found'
  | 'outside-home'
  | 'is-app-folder'
  | 'is-data-folder' // the data folder or anything inside it
  | 'protected-folder' // ~/Documents, ~/Desktop, ~/Downloads, if the spike shows the service can't read them
  | 'missing-roles' // no .team-config/roles.json
  | 'missing-whoami' // no tools/whoami.cjs
  | 'not-a-repo'; // no .git folder, nor a .git file (worktree)

export type BrainCheck = { ok: true; path: string } | { ok: false; reason: BrainRefusal };

/**
 * `server/brain/locate.ts` (Builder A), exported as `checkBrain` and `findBrainCandidates`. Never throw.
 * `checkBrain` resolves links first, then applies decision 8's test.
 * `findBrainCandidates` looks one level inside `~`, `~/Documents`, `~/Developer`, `~/Projects` and
 * `~/My Repos`, skipping dot folders; `~/agencybrain` first when it qualifies.
 */
export interface BrainLocator {
  checkBrain(path: string, ctx: BrainCheckContext): Promise<BrainCheck>;
  findBrainCandidates(ctx: BrainCheckContext): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Boot and setup (decision 9)
// ---------------------------------------------------------------------------

/**
 * Added to `Bootstrap` in shared/contract.ts. `ready`: the brain was found. `setup`: no usable brain,
 * so the client shows the Setup page and the rest of Bootstrap holds empty lists.
 */
export type AppState =
  | { kind: 'ready' }
  | { kind: 'setup'; tried: string | null; reason: BrainRefusal | null };

/** `GET /api/setup/candidates` */
export interface SetupCandidatesResponse {
  candidates: string[];
  /** The brain path in use now, if any, and where it came from. */
  current: { path: string; source: SettingSource } | null;
}

/** `PUT /api/setup/brain` (session, same origin, JSON). */
export interface SetBrainRequest {
  path: string;
}

/**
 * Saved: `restarting` is true when the server will exit for the LaunchAgent to restart it, false
 * when it runs without one (then the person starts it again). Refused: `reason` says why.
 * When `TDS_BRAIN_PATH` is set the route refuses with `env-override`, since saving would do nothing.
 */
export type SetBrainResponse =
  | { ok: true; path: string; restarting: boolean }
  | { ok: false; reason: BrainRefusal | 'env-override' };

export const SETUP_ROUTES = {
  candidates: '/api/setup/candidates',
  brain: '/api/setup/brain',
} as const;

// ---------------------------------------------------------------------------
// The gate (decisions 5, 6)
// ---------------------------------------------------------------------------

/**
 * Served without a session (GET and HEAD only), after the Host and Origin checks. Exact matches, case
 * sensitive. A listed path whose file is missing answers 404, never the SPA's index.html.
 */
export const PUBLIC_PATHS: readonly string[] = [
  '/manifest.webmanifest',
  '/sw.js',
  '/offline.html',
  // The offline page's stylesheet: the CSP blocks inline styles, and the page is shown signed out.
  '/offline.css',
];
export const PUBLIC_ICON_PATTERN = /^\/icons\/[a-z0-9-]+\.(png|svg)$/;

/** The session cookie's Max-Age (Chrome's cap), re-sent on every authenticated `GET /api/bootstrap`. */
export const AUTH_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Command-line tool and service (decisions 1, 2, 10)
// ---------------------------------------------------------------------------

export type CliCommand = 'install' | 'open' | 'restart' | 'doctor' | 'sign-out-everywhere' | 'uninstall';

export interface InstallOptions {
  brain: string;
  /** The app folder the service runs from. Default: the folder holding this code. */
  appRoot?: string;
  /** An existing data folder to copy across once (keeps the launch token, so the sign-in survives). */
  migrateFrom?: string;
}

export interface UninstallOptions {
  /** Also remove the data folder. Never removes the app folder. */
  all?: boolean;
}

/** The sign-in app the installer builds (decision 6b). */
export const SIGNIN_APP_NAME = 'TDS Brain Sign-in';
export const SIGNIN_APP_BUNDLE_ID = 'uk.co.thedigitalstride.tds-brain.signin';
/** Oldest Node the node launcher accepts. */
export const MIN_NODE_VERSION = '22.18.0';

export const LAUNCH_AGENT_LABEL = 'uk.co.thedigitalstride.tds-brain';

/** Everything the plist needs. `renderLaunchAgent(spec)` turns it into XML; pure and tested. */
export interface LaunchAgentSpec {
  label: typeof LAUNCH_AGENT_LABEL;
  /** `<app>/bin/node`, the node launcher. */
  node: string;
  /** `<app>/server/index.ts` */
  entry: string;
  appRoot: string;
  /** Fixed PATH for the service: `<app>/bin`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`. */
  path: string[];
  /** `~/Library/Logs/TDS Brain/server.log` */
  logFile: string;
  /** Always `TDS_BRAIN_SERVICE=1` and `LANG=en_GB.UTF-8`; the data folder and port only when asked (development, tests). */
  env: { TDS_BRAIN_SERVICE: '1'; LANG: 'en_GB.UTF-8' } & Partial<
    Record<'TDS_BRAIN_APP_DATA' | 'TDS_BRAIN_APP_PORT', string>
  >;
  /** 10 */
  throttleSeconds: number;
  /** 30: more than `shutdown()`'s own 20 s. */
  exitTimeoutSeconds: number;
  /**
   * `~/Applications/TDS Brain Sign-in.app/Contents/MacOS/tds-brain-service`. It sits inside the bundle so Login
   * Items names the job after the bundle, not "node" (spike, 2026-11-12). It execs `node` with `entry`.
   */
  serviceExecutable: string;
}

export type DoctorCheck =
  | 'node'
  | 'tools' // node, bash, git, jq, python3 on the service PATH
  | 'claude'
  | 'brain'
  | 'build'
  | 'agent-loaded'
  | 'port'
  | 'answering'
  | 'login-item' // switched off in System Settings
  | 'signin-app';

export interface DoctorResult {
  check: DoctorCheck;
  ok: boolean;
  /** One plain sentence, UK English: what is wrong and what to do. */
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  results: DoctorResult[];
  /** The last lines of the service log when anything failed. */
  logTail: string[];
}
