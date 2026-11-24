import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ClientInfo } from '../../shared/contract.ts';
import { CLIENT_CODE_PATTERN } from '../../shared/project-refs-contract.ts';
import { humanise, isDir, readText } from './util.ts';

async function accountNames(root: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const raw = await readText(join(root, '.claude', 'accounts.json'));
    const j = raw ? (JSON.parse(raw) as unknown) : null;
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      for (const [key, v] of Object.entries(j)) {
        const name = v && typeof v === 'object' ? (v as { name?: unknown }).name : null;
        if (typeof name === 'string' && name.trim() !== '') names.set(key, name.trim());
      }
    }
  } catch {
    // unreadable registry: fall back to humanised folder names
  }
  return names;
}

/** `clients/map.json` names by folder name (a key may use `_` for `-`). Read only. */
async function mapNames(root: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const raw = await readText(join(root, 'clients', 'map.json'));
    const j = raw ? (JSON.parse(raw) as unknown) : null;
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      for (const [key, v] of Object.entries(j)) {
        const name = v && typeof v === 'object' ? (v as { name?: unknown }).name : null;
        if (typeof name === 'string' && name.trim() !== '') names.set(key.replace(/_/g, '-'), name.trim());
      }
    }
  } catch {
    // unreadable map: the next source names the client
  }
  return names;
}

/**
 * The `client:` line of a client's `profile.md` frontmatter, without quotes or a trailing bracket
 * ("AI Stores (Associated Independent Stores Ltd)" reads "AI Stores"). Null when there's none.
 */
async function profileName(root: string, slug: string): Promise<string | null> {
  const text = await readText(join(root, 'clients', slug, 'profile.md')).catch(() => null);
  if (!text?.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  const head = end === -1 ? '' : text.slice(3, end);
  const m = /^client:[ \t]*(.+)$/m.exec(head);
  if (!m?.[1]) return null;
  const name = m[1]
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .replace(/\s*\([^)]*\)$/, '')
    .trim();
  return name !== '' && name.length <= 80 ? name : null;
}

/**
 * The `code:` line of a client's `profile.md` frontmatter (project codes, R2 phase 4b), upper-cased. Null when
 * there's none or it doesn't pass CLIENT_CODE_PATTERN: a bad code reads as no code.
 */
async function profileCode(root: string, slug: string): Promise<string | null> {
  const text = await readText(join(root, 'clients', slug, 'profile.md')).catch(() => null);
  if (!text?.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  const head = end === -1 ? '' : text.slice(3, end);
  const m = /^code:[ \t]*(.*)$/m.exec(head);
  if (!m?.[1]) return null;
  const code = m[1]
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim()
    .toUpperCase();
  return CLIENT_CODE_PATTERN.test(code) ? code : null;
}

const SMALL_WORDS = new Set(['and', 'of', 'the', 'for', 'in', 'on', 'at', 'to', 'a']);

/** A client folder name as a name: "sig-roofing" reads "Sig Roofing", "gladwell-and-patterson" "Gladwell and Patterson". */
function folderName(slug: string): string {
  return humanise(slug)
    .split(' ')
    .map((w, i) =>
      i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
}

/**
 * The brain's clients. A client's name comes from `.claude/accounts.json`, else `clients/map.json`,
 * else its profile's `client:` line, else its folder name with each word capitalised.
 */
export async function listClients(root: string): Promise<ClientInfo[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(join(root, 'clients'));
  } catch {
    return [];
  }
  const [names, mapped] = await Promise.all([accountNames(root), mapNames(root)]);
  const out: ClientInfo[] = [];
  for (const slug of entries) {
    if (slug.startsWith('_') || slug.startsWith('.')) continue;
    if (!(await isDir(join(root, 'clients', slug)))) continue;
    const name =
      names.get(slug.replace(/-/g, '_')) ??
      mapped.get(slug) ??
      (await profileName(root, slug)) ??
      folderName(slug);
    out.push({ slug, name, code: await profileCode(root, slug) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
