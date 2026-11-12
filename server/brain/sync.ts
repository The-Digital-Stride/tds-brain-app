import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SyncStatus } from '../../shared/contract.ts';

/** The brain's git folder: `.git` itself, or the folder a `.git` file points at (`gitdir: ...`). */
async function gitDir(root: string): Promise<string | null> {
  const dotGit = join(root, '.git');
  try {
    const st = await fs.stat(dotGit);
    if (st.isDirectory()) return dotGit;
    if (!st.isFile()) return null;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(await fs.readFile(dotGit, 'utf8'));
    return m?.[1] ? resolve(root, m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * One look at when the brain last synced: the modified time of `FETCH_HEAD`, which git rewrites on
 * every fetch. A FAILED fetch (offline, login expired) also rewrites it, but leaves it empty, as
 * does a fetch still running; a good one always writes at least one line. So an empty file is not
 * a sync, and this returns null for it. Read-only; runs no git. Never throws.
 */
export async function readSync(root: string): Promise<SyncStatus> {
  const dir = await gitDir(root);
  if (!dir) return { lastSync: null };
  try {
    const st = await fs.stat(join(dir, 'FETCH_HEAD'));
    return { lastSync: st.isFile() && st.size > 0 ? st.mtime.toISOString() : null };
  } catch {
    return { lastSync: null };
  }
}

/**
 * `readSync`, remembering the last good sync it saw, so a run of failed fetches (each leaving an
 * empty `FETCH_HEAD`) keeps reporting that time and the page turns red, instead of having nothing
 * to show. Kept in memory only: after a restart in the middle of an outage it reports null until a
 * fetch works.
 */
export function createSyncReader(root: string): { read(): Promise<SyncStatus> } {
  let lastGood: string | null = null;
  return {
    async read() {
      const { lastSync } = await readSync(root);
      if (lastSync && (!lastGood || lastSync > lastGood)) lastGood = lastSync;
      return { lastSync: lastGood };
    },
  };
}
