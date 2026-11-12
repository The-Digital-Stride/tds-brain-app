import { join } from 'node:path';
import type { Identity, MemberProfile } from '../../shared/contract.ts';
import { readText } from './util.ts';

/** Where the brain describes each person: a Markdown table with Name, Title, Departments, ... columns. */
export const TEAM_PROFILE_PATH = ['context', 'team-profile.md'];

const EMPTY: MemberProfile = { title: null, departments: [], owns: null };

export interface TeamProfileRow extends MemberProfile {
  /** The name as written, without Markdown emphasis, e.g. "David (Dave) Jolly". */
  name: string;
}

/**
 * The departments in a cell: comma-separated ("SEO, Content"). Trimmed, blanks dropped, repeats
 * dropped ignoring case (first spelling wins).
 */
export function parseDepartments(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (name === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * A table row's cells, with or without the outer pipes. Splits on `|` but not `\|`, which stays
 * as a literal pipe. A line with no pipe is not a row.
 */
function cells(line: string): string[] | null {
  const t = line.trim();
  if (!t.includes('|')) return null;
  const inner = t.replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

/** Plain text from a cell: bold and code marks removed. */
function plain(cell: string): string {
  return cell
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '')
    .trim();
}

const isDivider = (row: string[]) => row.length > 0 && row.every((c) => /^:?-+:?$/.test(c));

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Longer than any real name; keeps the bracket patterns below quick on a mangled cell. */
const MAX_NAME = 200;

/**
 * The names a person answers to, lower case with single spaces. "David (Dave) Jolly" answers to
 * "david jolly" and "dave jolly". Used for both the table row and the person, so a nickname
 * written in either place still matches.
 */
export function nameKeys(name: string): string[] {
  const n = plain(name.slice(0, MAX_NAME));
  const nick = /^(\S+)\s*\(([^)]+)\)\s*(.*)$/.exec(n);
  const keys = [squash(n.replace(/\([^)]*\)/g, ' '))];
  if (nick) keys.push(squash(`${nick[2]} ${nick[3]}`));
  return keys.filter((k) => k !== '');
}

/**
 * Every person in the first table whose header has both a Name and a Departments column. The Title
 * and "What they own day to day" columns are optional; columns may come in any order.
 */
export function parseTeamProfile(md: string): TeamProfileRow[] {
  const lines = md.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i++) {
    const head = cells(lines[i] ?? '');
    const divider = cells(lines[i + 1] ?? '');
    if (!head || !divider || !isDivider(divider)) continue;
    const cols = head.map((h) => plain(h).toLowerCase());
    const nameAt = cols.indexOf('name');
    const deptAt = cols.findIndex((c) => c === 'departments' || c === 'department');
    if (nameAt < 0 || deptAt < 0) continue;
    const titleAt = cols.indexOf('title');
    const ownsAt = cols.findIndex((c) => c.startsWith('what they own'));
    const text = (row: string[], at: number) => (at < 0 ? null : plain(row[at] ?? '') || null);
    const rows: TeamProfileRow[] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const row = cells(lines[j] ?? '');
      if (!row) break;
      const name = text(row, nameAt);
      if (!name) continue;
      rows.push({
        name,
        title: text(row, titleAt),
        departments: parseDepartments(text(row, deptAt) ?? ''),
        owns: text(row, ownsAt),
      });
    }
    return rows;
  }
  return [];
}

/** This person's row in `context/team-profile.md`, matched by name. Never throws. */
export async function readMemberProfile(root: string, identity: Identity): Promise<MemberProfile> {
  const keys = nameKeys(identity.name);
  if (keys.length === 0) return EMPTY;
  try {
    const md = await readText(join(root, ...TEAM_PROFILE_PATH));
    const row = md
      ? parseTeamProfile(md).find((r) => nameKeys(r.name).some((k) => keys.includes(k)))
      : undefined;
    return row ? { title: row.title, departments: row.departments, owns: row.owns } : EMPTY;
  } catch {
    return EMPTY;
  }
}
