/**
 * The app's own version history, for Settings (owners and scouts). Read from the app's CHANGELOG.md,
 * which `scripts/bump-version.ts` writes on every release: `## vX.Y.Z — YYYY-MM-DD` headings, each
 * followed by `- **kind**: text` lines. Never a brain file.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { VersionNotes } from '../shared/contract.ts';

const HEADING = /^##\s+v?(\d+\.\d+\.\d+)(?:\s+[—–-]\s+(\d{4}-\d{2}-\d{2}))?\s*$/;
const CHANGE = /^-\s+(?:\*\*(\w+)\*\*:\s*)?(.+?)\s*$/;

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Every version in the file, newest version number first. Lines it doesn't recognise are skipped. */
export function parseChangelog(text: string): VersionNotes[] {
  if (typeof text !== 'string') return [];
  const versions: VersionNotes[] = [];
  let current: VersionNotes | null = null;
  for (const line of text.split(/\r?\n/)) {
    const h = HEADING.exec(line);
    if (h) {
      current = { version: h[1] as string, date: h[2] ?? null, changes: [] };
      versions.push(current);
      continue;
    }
    if (line.startsWith('#')) {
      current = null;
      continue;
    }
    const c = current ? CHANGE.exec(line) : null;
    if (current && c) current.changes.push({ kind: (c[1] ?? '').toLowerCase(), text: c[2] as string });
  }
  return versions.sort((a, b) => compareVersions(b.version, a.version));
}

/** Reads `<appRoot>/CHANGELOG.md`, parsing again only when the file changes. [] when it can't be read. */
export function createChangelogReader(appRoot: string): () => Promise<VersionNotes[]> {
  const file = join(appRoot, 'CHANGELOG.md');
  let cached: { stamp: string; versions: VersionNotes[] } | null = null;
  return async () => {
    try {
      const st = await fs.stat(file);
      const stamp = `${st.mtimeMs}:${st.size}`;
      if (cached?.stamp !== stamp) {
        cached = { stamp, versions: parseChangelog(await fs.readFile(file, 'utf8')) };
      }
      return cached.versions;
    } catch {
      return [];
    }
  };
}
