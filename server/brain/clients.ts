import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ClientInfo } from '../../shared/contract.ts';
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

export async function listClients(root: string): Promise<ClientInfo[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(join(root, 'clients'));
  } catch {
    return [];
  }
  const names = await accountNames(root);
  const out: ClientInfo[] = [];
  for (const slug of entries) {
    if (slug.startsWith('_') || slug.startsWith('.')) continue;
    if (!(await isDir(join(root, 'clients', slug)))) continue;
    out.push({ slug, name: names.get(slug.replace(/-/g, '_')) ?? humanise(slug) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
