import { join } from 'node:path';
import type { ClientInfo } from '../../shared/contract.ts';
import type { ClientAlias } from '../engine/client-guess.ts';
import { readText } from './util.ts';

/** Guards against a huge or odd map.json: nobody needs more, and each alias becomes a pattern. */
const MAX_ALIASES = 50;
const MAX_ALIAS_CHARS = 80;

/**
 * Each client with its other names from `clients/map.json` (`{ "<slug>": { name, aliases } }`), read
 * only. Clients in the map come first, in map order, then the rest in the order given. A key may use
 * `_` for `-`. Only clients in `clients` are returned; a missing or unreadable map gives no aliases.
 */
export async function readClientAliases(root: string, clients: ClientInfo[]): Promise<ClientAlias[]> {
  let map: unknown = null;
  try {
    const raw = await readText(join(root, 'clients', 'map.json'));
    map = raw ? JSON.parse(raw) : null;
  } catch {
    map = null;
  }
  const bySlug = new Map(clients.map((c) => [c.slug, c]));
  const out: ClientAlias[] = [];
  const done = new Set<string>();
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    for (const [key, entry] of Object.entries(map)) {
      const slug = key.replace(/_/g, '-');
      const client = bySlug.get(slug);
      if (!client || done.has(slug) || !entry || typeof entry !== 'object') continue;
      const e = entry as { name?: unknown; aliases?: unknown };
      const raw = [...(Array.isArray(e.aliases) ? e.aliases : []), e.name];
      const aliases: string[] = [];
      for (const a of raw) {
        if (typeof a !== 'string') continue;
        const t = a.trim();
        if (!t || t.length > MAX_ALIAS_CHARS || aliases.includes(t)) continue;
        if (aliases.length < MAX_ALIASES) aliases.push(t);
      }
      out.push({ slug, name: client.name, aliases });
      done.add(slug);
    }
  }
  for (const c of clients) if (!done.has(c.slug)) out.push({ slug: c.slug, name: c.name, aliases: [] });
  return out;
}
