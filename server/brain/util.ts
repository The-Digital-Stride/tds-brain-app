import { promises as fs } from 'node:fs';
import type { Role } from '../../shared/contract.ts';
import { keepAcronyms } from '../../shared/words.ts';

export async function readText(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function isDir(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** "head-scout" and "agency" count as scout. Anything unrecognised or missing is unknown. */
export function mapRole(raw: unknown): Role {
  const r = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (r === 'owner') return 'owner';
  if (r === 'scout' || r === 'head-scout' || r === 'agency') return 'scout';
  if (r === 'team') return 'team';
  return 'unknown';
}

/** Same rule as the brain: lowercase, spaces to dashes, drop everything but a-z, 0-9 and dashes. */
export function memberSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ /g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/** "meeting-notes" becomes "Meeting notes", "tds-doc" becomes "TDS doc". */
export function humanise(name: string): string {
  const s = name
    .replace(/\.md$/i, '')
    .replace(/^\d{8}-/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return s === '' ? name : keepAcronyms(s.charAt(0).toUpperCase() + s.slice(1));
}
