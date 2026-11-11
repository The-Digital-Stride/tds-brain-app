/**
 * Where everything is (decisions 2 and 13, amendment A7). Read once at start-up.
 */
import { randomBytes } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { DEFAULT_PORT } from '../shared/contract.ts';

export interface AppConfig {
  appRoot: string;
  brainPath: string;
  port: number;
  dataDir: string;
  clientDir: string;
  /** The installed `claude`, or null when it could not be found. */
  claudePath: string | null;
  appVersion: string;
  /** The secret in the launch URL. Swapped once at `/auth` for the session cookie. */
  launchToken: string;
}

export const APP_ROOT = resolve(import.meta.dirname, '..');

function expandHome(p: string): string {
  return p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

function isExecutableFile(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** `TDS_CLAUDE_PATH`, else `claude` on PATH widened with the usual install folders. */
export function findClaude(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.TDS_CLAUDE_PATH?.trim();
  if (explicit) return isExecutableFile(expandHome(explicit)) ? expandHome(explicit) : null;
  const home = homedir();
  const dirs = [
    ...(env.PATH ?? '').split(delimiter),
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].filter(Boolean);
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

function readVersion(appRoot: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_PORT;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

/**
 * The launch token lives in `<data>/runtime.json` (mode 0600) and is reused across restarts, so a
 * cookie the browser already holds keeps working (A7).
 */
export function loadOrCreateLaunchToken(dataDir: string): string {
  const file = join(dataDir, 'runtime.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { launchToken?: unknown };
    if (typeof parsed.launchToken === 'string' && /^[A-Za-z0-9_-]{32,}$/.test(parsed.launchToken)) {
      try {
        chmodSync(file, 0o600);
      } catch {
        // best effort
      }
      return parsed.launchToken;
    }
  } catch {
    // missing or corrupt: make a new one
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const launchToken = randomBytes(32).toString('base64url');
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ launchToken }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  return launchToken;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env, appRoot: string = APP_ROOT): AppConfig {
  const brainPath = resolve(expandHome(env.TDS_BRAIN_PATH?.trim() || '~/agencybrain'));
  const dataDir = resolve(expandHome(env.TDS_BRAIN_APP_DATA?.trim() || join(appRoot, 'data')));
  return {
    appRoot,
    brainPath,
    port: parsePort(env.TDS_BRAIN_APP_PORT),
    dataDir,
    clientDir: join(appRoot, 'dist', 'client'),
    claudePath: findClaude(env),
    appVersion: readVersion(appRoot),
    launchToken: loadOrCreateLaunchToken(dataDir),
  };
}
