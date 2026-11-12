/**
 * Is this folder a brain (decision 8), and where might one be (decision 9's Setup list)?
 * Used by the server, the installer and `doctor`. Never throws.
 */
import { promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { BrainCheck, BrainCheckContext, BrainRefusal } from '../../shared/install-contract.ts';

/** Folders searched one level deep, after `~/agencybrain`. */
const SEARCH_ROOTS = ['', 'Documents', 'Developer', 'Projects', 'My Repos'];

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

function isDenied(err: unknown): boolean {
  const code = errorCode(err);
  return code === 'EPERM' || code === 'EACCES';
}

/**
 * The link-resolved path. When it doesn't exist yet (a data folder not made), the nearest existing
 * parent is resolved and the rest added back, so a link in home still compares equal.
 */
async function realOr(p: string): Promise<string> {
  const abs = resolve(p);
  try {
    return await fs.realpath(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(await realOr(parent), basename(abs));
  }
}

/** True when `child` is `parent` itself or inside it. */
function within(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

type MarkerResult = 'ok' | 'missing' | 'denied';

async function marker(path: string, kind: 'file' | 'file-or-dir'): Promise<MarkerResult> {
  try {
    const st = await fs.stat(path);
    if (kind === 'file') return st.isFile() ? 'ok' : 'missing';
    return st.isFile() || st.isDirectory() ? 'ok' : 'missing';
  } catch (err) {
    return isDenied(err) ? 'denied' : 'missing';
  }
}

function refuse(reason: BrainRefusal): BrainCheck {
  return { ok: false, reason };
}

/** Resolves links first, then applies decision 8's test. */
export async function checkBrain(path: string, ctx: BrainCheckContext): Promise<BrainCheck> {
  try {
    if (typeof path !== 'string' || !isAbsolute(path)) return refuse('not-absolute');

    let real: string;
    try {
      real = await fs.realpath(path);
      if (!(await fs.stat(real)).isDirectory()) return refuse('not-found');
    } catch (err) {
      return refuse(isDenied(err) ? 'protected-folder' : 'not-found');
    }

    const [home, appRoot, dataDir] = await Promise.all([
      realOr(ctx.home),
      realOr(ctx.appRoot),
      realOr(ctx.dataDir),
    ]);
    if (real === home || !within(real, home)) return refuse('outside-home');
    // The data folder, anything inside it, or a folder holding it; the app folder, or a folder holding it.
    if (within(real, dataDir) || within(dataDir, real)) return refuse('is-data-folder');
    if (within(appRoot, real)) return refuse('is-app-folder');

    const [roles, whoami, git] = await Promise.all([
      marker(join(real, '.team-config', 'roles.json'), 'file'),
      marker(join(real, 'tools', 'whoami.cjs'), 'file'),
      marker(join(real, '.git'), 'file-or-dir'),
    ]);
    if ([roles, whoami, git].includes('denied')) return refuse('protected-folder');
    if (roles === 'missing') return refuse('missing-roles');
    if (whoami === 'missing') return refuse('missing-whoami');
    if (git === 'missing') return refuse('not-a-repo');

    return { ok: true, path: real };
  } catch {
    return refuse('not-found');
  }
}

/** Folders (or links) one level inside `dir`, skipping dot folders, sorted by name. */
async function childFolders(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || e.isSymbolicLink()))
      .map((e) => e.name)
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Brains one level inside `~`, `~/Documents`, `~/Developer`, `~/Projects` and `~/My Repos`,
 * skipping dot folders. `~/agencybrain` comes first when it qualifies. Each brain once, by its real path.
 */
export async function findBrainCandidates(ctx: BrainCheckContext): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (check: BrainCheck) => {
    if (check.ok && !seen.has(check.path)) {
      seen.add(check.path);
      found.push(check.path);
    }
  };
  try {
    add(await checkBrain(join(ctx.home, 'agencybrain'), ctx));
    for (const root of SEARCH_ROOTS) {
      const children = await childFolders(join(ctx.home, root));
      for (const check of await Promise.all(children.map((c) => checkBrain(c, ctx)))) add(check);
    }
  } catch {
    // never throw: give what was found so far
  }
  return found;
}
