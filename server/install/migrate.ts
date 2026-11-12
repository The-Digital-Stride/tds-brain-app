import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export type MigrateResult = { ok: true } | { ok: false; message: string };

function tokenOf(dir: string): string | null {
  try {
    const t = (JSON.parse(readFileSync(join(dir, 'runtime.json'), 'utf8')) as { launchToken?: unknown })
      .launchToken;
    return typeof t === 'string' ? t : null;
  } catch {
    return null;
  }
}

const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/** Whether `migrateData(fromPath, toPath)` would be accepted. Changes nothing. */
export function checkMigrate(fromPath: string, toPath: string): MigrateResult {
  const from = resolve(fromPath);
  const to = resolve(toPath);
  try {
    if (!existsSync(from) || !statSync(from).isDirectory()) {
      return { ok: false, message: `There is no data folder at ${from} to copy.` };
    }
    if (!existsSync(join(from, 'runtime.json'))) {
      return { ok: false, message: `${from} has no runtime.json, so it does not look like TDS Brain data.` };
    }
    if (from === to || inside(from, to) || inside(to, from)) {
      return { ok: false, message: 'The old and new data folders overlap, so nothing was copied.' };
    }
    const existing = existsSync(to) ? readdirSync(to) : [];
    if (existing.length > 0 && !(existing.length === 1 && existing[0] === 'runtime.json')) {
      return {
        ok: false,
        message: `${to} already has data in it, so nothing was copied. Move it aside first if you want to copy the old data.`,
      };
    }
    if (existsSync(`${from}.moved`)) {
      return {
        ok: false,
        message: `${from}.moved already exists, so nothing was copied. Remove or rename it first.`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `Checking the old data failed: ${(err as Error).message}` };
  }
}

/**
 * Copies the old data folder to `to` once, checks the launch token survived, then renames the old
 * folder to `<from>.moved`. Refuses (touching nothing) when `to` holds anything except a lone
 * runtime.json, which it replaces.
 */
export function migrateData(fromPath: string, toPath: string): MigrateResult {
  const from = resolve(fromPath);
  const to = resolve(toPath);
  try {
    if (!existsSync(from) || !statSync(from).isDirectory()) {
      return { ok: false, message: `There is no data folder at ${from} to copy.` };
    }
    if (from === to || inside(from, to) || inside(to, from)) {
      return { ok: false, message: 'The old and new data folders overlap, so nothing was copied.' };
    }
    const existing = existsSync(to) ? readdirSync(to) : [];
    const onlyToken = existing.length === 1 && existing[0] === 'runtime.json';
    if (existing.length > 0 && !onlyToken) {
      return {
        ok: false,
        message: `${to} already has data in it, so nothing was copied. Move it aside first if you want to copy the old data.`,
      };
    }
    const moved = `${from}.moved`;
    if (existsSync(moved)) {
      return {
        ok: false,
        message: `${moved} already exists, so nothing was copied. Remove or rename it first.`,
      };
    }
    if (onlyToken) rmSync(join(to, 'runtime.json'));
    mkdirSync(dirname(to), { recursive: true });
    mkdirSync(to, { recursive: true, mode: 0o700 });
    cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
    chmodSync(to, 0o700);
    const token = tokenOf(from);
    if (token !== null) {
      if (tokenOf(to) !== token) {
        return {
          ok: false,
          message: 'The copied sign-in did not match the original, so the old folder was left as it was.',
        };
      }
      chmodSync(join(to, 'runtime.json'), 0o600);
    }
    renameSync(from, moved);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `Copying the old data failed: ${(err as Error).message}` };
  }
}
