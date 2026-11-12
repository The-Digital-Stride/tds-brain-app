/**
 * `tds-brain <command>`: argument parsing and dispatch only. The work lives in server/install/.
 * Run through `<app>/bin/tds-brain`, which picks a suitable Node.
 */
import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { DEFAULT_PORT } from '../shared/contract.ts';
import type { CliCommand, InstallOptions } from '../shared/install-contract.ts';
import { APP_ROOT, findClaude, loadOrCreateLaunchToken } from './config.ts';
import { runDoctor } from './install/doctor.ts';
import {
  type InstallDeps,
  install,
  installPaths,
  type Outcome,
  openApp,
  restartApp,
  servicePath,
  signOutEverywhere,
  uninstall,
} from './install/install.ts';
import { createLaunchctl, defaultLaunchRunner } from './install/launchctl.ts';
import { codeFromRunningServer, isOurServer, openBrowser } from './launcher.ts';

const COMMANDS: readonly CliCommand[] = [
  'install',
  'open',
  'restart',
  'doctor',
  'sign-out-everywhere',
  'uninstall',
];

export const USAGE = `Usage: tds-brain <command>

  install --brain <folder> [--migrate-from <data folder>]
                        Set TDS Brain up to start at login, then sign you in
  open                  Open TDS Brain in Chrome
  restart               Restart the app
  doctor                Check everything the app needs and say what to fix
  sign-out-everywhere   Sign out every browser, then restart
  uninstall [--all]     Stop it starting at login (--all also removes its data)
`;

export type Parsed =
  | { ok: true; command: CliCommand; install: Partial<InstallOptions>; all: boolean }
  | { ok: false; help: boolean; message: string };

export function parseArgs(argv: string[]): Parsed {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    return { ok: false, help: true, message: USAGE };
  }
  if (!(COMMANDS as readonly string[]).includes(command)) {
    return { ok: false, help: false, message: `"${command}" is not a command.\n\n${USAGE}` };
  }
  const out = {
    ok: true as const,
    command: command as CliCommand,
    install: {} as Partial<InstallOptions>,
    all: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    const [flag, inline] =
      a.startsWith('--') && a.includes('=')
        ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]
        : [a, undefined];
    const value = (): string | null => inline ?? rest[++i] ?? null;
    if (command === 'install' && (flag === '--brain' || flag === '--migrate-from')) {
      const v = value();
      if (!v) return { ok: false, help: false, message: `${flag} needs a folder after it.` };
      if (flag === '--brain') out.install.brain = v;
      else out.install.migrateFrom = v;
    } else if (command === 'uninstall' && flag === '--all') {
      out.all = true;
    } else {
      return { ok: false, help: false, message: `"${a}" is not an option for ${command}.\n\n${USAGE}` };
    }
  }
  if (command === 'install' && !out.install.brain) {
    return {
      ok: false,
      help: false,
      message: 'install needs --brain <folder>, the folder holding your agency brain.',
    };
  }
  return out;
}

function parsePort(raw: string | undefined): number {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

const isExecutable = (p: string): boolean => {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

function run(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 10_000 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

function readToken(dataDir: string): string | null {
  try {
    const t = (JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8')) as { launchToken?: unknown })
      .launchToken;
    return typeof t === 'string' && /^[A-Za-z0-9_-]{32,}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** True when something accepts a connection on 127.0.0.1:port. */
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host: '127.0.0.1', port });
    sock.setTimeout(1500);
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('error', () => resolve(false));
  });
}

async function realDeps(): Promise<InstallDeps> {
  const settings = await import('./settings.ts');
  const home = homedir();
  const uid = process.getuid?.() ?? 501;
  return {
    home,
    appRoot: APP_ROOT,
    port: parsePort(process.env.TDS_BRAIN_APP_PORT),
    env: process.env,
    settings,
    readLaunchToken: readToken,
    portInUse,
    checkBrain: (await import('./brain/locate.ts')).checkBrain,
    launchctl: createLaunchctl(defaultLaunchRunner, uid),
    loadLaunchToken: loadOrCreateLaunchToken,
    isOurServer,
    codeFromRunningServer,
    openBrowser,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (m) => console.log(m),
  };
}

async function doctorCommand(d: InstallDeps): Promise<number> {
  const dataDir = d.settings.resolveDataDir(d.env, d.home);
  const { readSettings } = await import('./settings.ts');
  const { checkBrain } = await import('./brain/locate.ts');
  const p = installPaths(d.home);
  const brainPath = d.env.TDS_BRAIN_PATH || readSettings(dataDir).brainPath || null;
  const report = await runDoctor({
    appRoot: d.appRoot,
    port: d.port,
    launchToken: d.readLaunchToken(dataDir),
    brainPath,
    servicePath: servicePath(d.appRoot, d.home),
    logFile: p.logFile,
    signinAppDir: p.signinApp,
    claudePath: findClaude({ ...process.env, PATH: servicePath(d.appRoot, d.home).join(delimiter) }),
    nodeVersion: async () => {
      const out = await run(join(d.appRoot, 'bin', 'node'), ['--version']);
      return out ? out.trim().replace(/^v/, '') : null;
    },
    which: (tool, dirs) => dirs.some((dir) => isExecutable(join(dir, tool))),
    checkBrain: (path) => checkBrain(path, { home: d.home, appRoot: d.appRoot, dataDir }),
    exists: existsSync,
    isLoaded: d.launchctl.isLoaded,
    isDisabled: d.launchctl.isDisabled,
    portOwner: async (port) => {
      const out = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fc']);
      return (
        out
          ?.split('\n')
          .find((l) => l.startsWith('c'))
          ?.slice(1) ?? null
      );
    },
    isOurServer: d.isOurServer,
    readLogTail: (file, n) => {
      try {
        return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-n);
      } catch {
        return [];
      }
    },
  });
  for (const r of report.results) console.log(`${r.ok ? 'OK    ' : 'FIX   '} ${r.message}`);
  if (report.logTail.length) console.log(`\nLast lines of the log:\n${report.logTail.join('\n')}`);
  console.log(report.ok ? '\nEverything looks fine.' : '\nSome things need attention (marked FIX above).');
  return report.ok ? 0 : 1;
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    (parsed.help ? console.log : console.error)(parsed.message);
    return parsed.help ? 0 : 2;
  }
  if (process.platform !== 'darwin') {
    console.error('The tds-brain command only works on a Mac.');
    return 1;
  }
  const d = await realDeps();
  if (parsed.command === 'doctor') return doctorCommand(d);
  let result: Outcome;
  try {
    switch (parsed.command) {
      case 'install':
        result = await install(parsed.install as InstallOptions, d);
        break;
      case 'open':
        result = await openApp(d);
        break;
      case 'restart':
        result = await restartApp(d);
        break;
      case 'sign-out-everywhere':
        result = await signOutEverywhere(d);
        break;
      default:
        result = await uninstall({ all: parsed.all }, d);
    }
  } catch (err) {
    result = { ok: false, message: (err as Error).message };
  }
  (result.ok ? console.log : console.error)(result.message);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
