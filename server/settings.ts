/**
 * App settings that live outside the app folder (decisions 7 and 8).
 * Pure apart from the reads and writes of `<data>/settings.json`.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  type AppSettings,
  INSTALLED_APP_DIR,
  INSTALLED_DATA_DIR,
  type SettingSource,
  SUPPORT_DIR_NAME,
} from '../shared/install-contract.ts';

const SETTINGS_FILE = 'settings.json';

/** `<home>/Library/Application Support/TDS Brain` */
export function supportDir(home: string): string {
  return join(home, 'Library', 'Application Support', SUPPORT_DIR_NAME);
}

export function defaultDataDir(home: string): string {
  return join(supportDir(home), INSTALLED_DATA_DIR);
}

export function installedAppDir(home: string): string {
  return join(supportDir(home), INSTALLED_APP_DIR);
}

/** `~` and `~/…` against the given home; anything else unchanged. */
export function expandHomeFor(p: string, home: string): string {
  return p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p;
}

/**
 * The data folder, for the server and the CLI alike: `TDS_BRAIN_APP_DATA` (trimmed, `~` expanded) when it is
 * an absolute path, else `defaultDataDir(home)`.
 */
export function resolveDataDir(env: Record<string, string | undefined>, home: string): string {
  const raw = env.TDS_BRAIN_APP_DATA?.trim();
  if (!raw) return defaultDataDir(home);
  const expanded = expandHomeFor(raw, home);
  return isAbsolute(expanded) ? resolve(expanded) : defaultDataDir(home);
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** `<dataDir>/settings.json`. Missing, unreadable or broken means `{}`; never throws. */
export function readSettings(dataDir: string): AppSettings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dataDir, SETTINGS_FILE), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const brainPath = nonEmptyString((parsed as Record<string, unknown>).brainPath);
    return brainPath ? { brainPath } : {};
  } catch {
    return {};
  }
}

/** Atomic: a temp file renamed over the old one. File 0600; the folder is created 0700. */
export function writeSettings(dataDir: string, settings: AppSettings): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, SETTINGS_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

/**
 * `TDS_BRAIN_PATH`, then `settings.brainPath`, then `<home>/agencybrain`. Phase 1 keeps the
 * unchecked fallback; the `null` of decision 9 arrives in phase 3.
 */
export function resolveBrainPath(
  env: Record<string, string | undefined>,
  settings: AppSettings,
  home: string,
): { path: string; source: SettingSource } {
  const fromEnv = nonEmptyString(env.TDS_BRAIN_PATH);
  if (fromEnv) return { path: resolve(expandHomeFor(fromEnv, home)), source: 'env' };
  const fromSettings = nonEmptyString(settings.brainPath);
  if (fromSettings) return { path: resolve(expandHomeFor(fromSettings, home)), source: 'settings' };
  return { path: join(home, 'agencybrain'), source: 'default' };
}
