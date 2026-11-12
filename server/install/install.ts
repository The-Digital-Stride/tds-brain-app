import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  type BrainCheck,
  type BrainCheckContext,
  type BrainRefusal,
  type InstallOptions,
  LAUNCH_AGENT_LABEL,
  type LaunchAgentSpec,
  SIGNIN_APP_NAME,
  type UninstallOptions,
} from '../../shared/install-contract.ts';
import { signInUrl } from '../launcher.ts';
import type { Launchctl } from './launchctl.ts';
import { checkMigrate, type MigrateResult, migrateData } from './migrate.ts';
import { renderLaunchAgent } from './plist.ts';
import { writeSigninApp } from './signin-app.ts';

export interface Outcome {
  ok: boolean;
  /** Plain UK English for the person. */
  message: string;
}

export interface InstallDeps {
  home: string;
  /** The app folder the service runs from. */
  appRoot: string;
  port: number;
  env: Record<string, string | undefined>;
  settings: {
    resolveDataDir(env: Record<string, string | undefined>, home: string): string;
    readSettings(dataDir: string): { brainPath?: string };
    writeSettings(dataDir: string, settings: { brainPath?: string }): void;
  };
  checkBrain(path: string, ctx: BrainCheckContext): Promise<BrainCheck>;
  launchctl: Launchctl;
  /** Reads (or makes) the launch token in `<dataDir>/runtime.json`. */
  loadLaunchToken(dataDir: string): string;
  /** Reads the token without creating it; null when there is none (not installed). */
  readLaunchToken(dataDir: string): string | null;
  /** True when anything at all is listening on the port. */
  portInUse(port: number): Promise<boolean>;
  isOurServer(port: number, token: string): Promise<boolean>;
  codeFromRunningServer(port: number, token: string): Promise<string | null>;
  openBrowser(url: string): void;
  migrate?(from: string, to: string): MigrateResult;
  /** Checks a migration would be accepted, changing nothing. Default: `checkMigrate`. */
  precheckMigrate?(from: string, to: string): MigrateResult;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
  /** How long to wait for the app to answer. Default 20 000. */
  timeoutMs?: number;
}

export function installPaths(home: string) {
  const logDir = join(home, 'Library', 'Logs', 'TDS Brain');
  return {
    plist: join(home, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`),
    signinApp: join(home, 'Applications', `${SIGNIN_APP_NAME}.app`),
    logDir,
    logFile: join(logDir, 'server.log'),
  };
}

/** The fixed PATH the service runs with (decision 2). */
export const servicePath = (appRoot: string, home: string): string[] => [
  join(appRoot, 'bin'),
  join(home, '.local', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
];

export function launchAgentSpec(d: Pick<InstallDeps, 'home' | 'appRoot' | 'env'>): LaunchAgentSpec {
  const p = installPaths(d.home);
  const env: LaunchAgentSpec['env'] = { TDS_BRAIN_SERVICE: '1', LANG: 'en_GB.UTF-8' };
  if (d.env.TDS_BRAIN_APP_DATA) env.TDS_BRAIN_APP_DATA = d.env.TDS_BRAIN_APP_DATA;
  if (d.env.TDS_BRAIN_APP_PORT) env.TDS_BRAIN_APP_PORT = d.env.TDS_BRAIN_APP_PORT;
  return {
    label: LAUNCH_AGENT_LABEL,
    node: join(d.appRoot, 'bin', 'node'),
    entry: join(d.appRoot, 'server', 'index.ts'),
    appRoot: d.appRoot,
    path: servicePath(d.appRoot, d.home),
    logFile: p.logFile,
    env,
    throttleSeconds: 10,
    exitTimeoutSeconds: 30,
    serviceExecutable: join(p.signinApp, 'Contents', 'MacOS', 'tds-brain-service'),
  };
}

export const dataDirOf = (d: InstallDeps): string => d.settings.resolveDataDir(d.env, d.home);

const REFUSALS: Record<BrainRefusal, string> = {
  'not-absolute': 'The brain folder must be a full path starting with /.',
  'not-found': 'There is no folder at that path.',
  'outside-home': 'The brain folder must be inside your home folder.',
  'is-app-folder': 'That is the app folder, not your brain.',
  'is-data-folder': 'That is inside the app data folder, not your brain.',
  'protected-folder':
    'macOS stops the app reading that folder. Move your brain out of Documents, Desktop and Downloads.',
  'missing-roles':
    'That folder has no team list (.team-config/roles.json), so it does not look like your agency brain.',
  'missing-whoami': 'That folder has no tools/whoami.cjs, so it does not look like your agency brain.',
  'not-a-repo': 'That folder is not a git repository, so it does not look like your agency brain.',
};

export async function install(options: InstallOptions, d: InstallDeps): Promise<Outcome> {
  const dataDir = dataDirOf(d);
  // Everything that can fail comes before bootout, so a failed re-install leaves the working copy running.
  const check = await d.checkBrain(options.brain, { home: d.home, appRoot: d.appRoot, dataDir });
  if (!check.ok) return { ok: false, message: `Nothing was installed. ${REFUSALS[check.reason]}` };
  if (options.migrateFrom) {
    const pre = (d.precheckMigrate ?? checkMigrate)(options.migrateFrom, dataDir);
    if (!pre.ok) return { ok: false, message: `Nothing was installed. ${pre.message}` };
  }
  const p = installPaths(d.home);
  try {
    mkdirSync(p.logDir, { recursive: true });
    mkdirSync(dirname(p.signinApp), { recursive: true });
    mkdirSync(dirname(p.plist), { recursive: true });
  } catch (err) {
    return {
      ok: false,
      message: `Nothing was installed. A folder could not be made: ${(err as Error).message}`,
    };
  }

  const hadPlist = existsSync(p.plist);
  const wasLoaded = await d.launchctl.isLoaded();
  if (wasLoaded) await d.launchctl.bootout();
  if (await d.portInUse(d.port)) {
    if (wasLoaded && hadPlist) {
      try {
        await d.launchctl.bootstrap(p.plist);
      } catch {
        // best effort: the message below still tells the person what to do
      }
    }
    return {
      ok: false,
      message: `Nothing was installed. Another program is using port ${d.port}, probably a copy of TDS Brain started with "pnpm start" in a terminal. Quit it (Control-C in that terminal), then run the install again.`,
    };
  }

  if (options.migrateFrom) {
    const m = (d.migrate ?? migrateData)(options.migrateFrom, dataDir);
    if (!m.ok) return { ok: false, message: `Nothing was installed. ${m.message}` };
    d.log(`Copied your old data to ${dataDir}.`);
  }

  d.settings.writeSettings(dataDir, { brainPath: check.path });
  const token = d.loadLaunchToken(dataDir);

  writeSigninApp(p.signinApp, d.appRoot);
  writeFileSync(p.plist, renderLaunchAgent(launchAgentSpec(d)));

  await d.launchctl.enable();
  await d.launchctl.bootstrap(p.plist);

  const interval = 500;
  const attempts = Math.max(1, Math.ceil((d.timeoutMs ?? 20_000) / interval));
  let up = false;
  for (let i = 0; i < attempts && !up; i++) {
    up = await d.isOurServer(d.port, token);
    if (!up) await d.sleep(interval);
  }
  if (!up) {
    return {
      ok: false,
      message: `TDS Brain was installed but is not answering yet. Run "tds-brain doctor" to see what is wrong.`,
    };
  }
  const opened = await openApp(d);
  return {
    ok: true,
    message: `TDS Brain is installed and running. ${opened.ok ? 'Signing you in now.' : opened.message}`,
  };
}

export async function openApp(d: InstallDeps): Promise<Outcome> {
  const token = d.readLaunchToken(dataDirOf(d));
  if (!token) {
    return {
      ok: false,
      message: 'TDS Brain has not been installed here yet. Run "tds-brain install --brain <folder>" first.',
    };
  }
  const code = await d.codeFromRunningServer(d.port, token);
  if (!code) {
    return {
      ok: false,
      message: 'TDS Brain is not running. Run "tds-brain restart", or "tds-brain doctor" to see why.',
    };
  }
  d.openBrowser(signInUrl(d.port, code));
  return { ok: true, message: 'Opening TDS Brain in Chrome.' };
}

export async function restartApp(d: InstallDeps): Promise<Outcome> {
  await d.launchctl.kickstart();
  return { ok: true, message: 'TDS Brain is restarting.' };
}

/** A new launch token makes every browser's old sign-in stop working. Same atomic, 0600 write as the server's. */
export async function signOutEverywhere(d: InstallDeps): Promise<Outcome> {
  const dataDir = dataDirOf(d);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, 'runtime.json');
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ launchToken: randomBytes(32).toString('base64url') }, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  const stay =
    'The sign-in code was changed, but people stay signed in until TDS Brain is restarted. Run "tds-brain restart" (or install again) to finish signing everyone out.';
  if (!(await d.launchctl.isLoaded())) return { ok: false, message: stay };
  try {
    await d.launchctl.kickstart();
  } catch {
    return { ok: false, message: stay };
  }
  return {
    ok: true,
    message:
      'Everyone is signed out and TDS Brain is restarting. Run "tds-brain open" to sign yourself back in.',
  };
}

const contains = (parent: string, child: string): boolean => {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** Why `--all` must not remove this folder, or null when it is safe. */
function unsafeToWipe(dataDir: string, d: InstallDeps): string | null {
  if (!existsSync(join(dataDir, 'runtime.json'))) {
    return `${dataDir} does not look like TDS Brain data (it has no runtime.json).`;
  }
  if (contains(dataDir, d.home)) return `${dataDir} is your home folder or holds it.`;
  if (contains(dataDir, d.appRoot)) return `${dataDir} is or holds the app folder, which is never removed.`;
  const brain = d.env.TDS_BRAIN_PATH || d.settings.readSettings(dataDir).brainPath;
  if (brain && contains(dataDir, brain)) return `${dataDir} is or holds your brain folder.`;
  return null;
}

export async function uninstall(options: UninstallOptions, d: InstallDeps): Promise<Outcome> {
  const p = installPaths(d.home);
  const dataDir = dataDirOf(d);
  const wipe = options.all === true;
  if (wipe) {
    const reason = unsafeToWipe(dataDir, d);
    if (reason) return { ok: false, message: `Nothing was removed. ${reason}` };
  }
  await d.launchctl.bootout();
  rmSync(p.plist, { force: true });
  rmSync(p.signinApp, { recursive: true, force: true });
  if (wipe) rmSync(dataDir, { recursive: true, force: true });
  return {
    ok: true,
    message:
      `TDS Brain will no longer start at login${wipe ? ', and its data was removed' : ''}. ` +
      'The app folder was left alone. To remove the Dock icon, open chrome://apps in Chrome, right-click TDS Brain and choose Uninstall.',
  };
}
