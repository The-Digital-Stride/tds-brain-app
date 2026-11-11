import { join } from 'node:path';
import type { Identity, UsedSkill } from '../../shared/contract.ts';
import { readText } from './util.ts';

export async function readUsage(
  root: string,
  identity: Identity,
  listed: Set<string>,
  now: Date,
  opts: { days?: number; limit?: number } = {},
): Promise<UsedSkill[]> {
  const days = opts.days ?? 30;
  const limit = opts.limit ?? 6;
  if (!/^[a-z0-9-]+$/.test(identity.slug)) return [];
  const text = await readText(join(root, 'z-logs', 'team-usage', `${identity.slug}.jsonl`));
  if (text === null) return [];
  const cutoff = now.getTime() - days * 86_400_000;
  const tally = new Map<string, { count: number; last: number }>();
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let j: unknown;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (!j || typeof j !== 'object' || Array.isArray(j)) continue;
    const rec = j as Record<string, unknown>;
    let raw: unknown;
    if (rec.event === 'skill' || rec.event === 'command') raw = rec.name ?? rec.skill;
    else if (rec.event === undefined) raw = rec.skill;
    if (typeof raw !== 'string') continue;
    const name = raw.trim().replace(/^\//, '');
    if (!listed.has(name)) continue;
    const t = typeof rec.ts === 'string' ? Date.parse(rec.ts) : Number.NaN;
    if (Number.isNaN(t) || t < cutoff) continue;
    const cur = tally.get(name) ?? { count: 0, last: 0 };
    cur.count++;
    cur.last = Math.max(cur.last, t);
    tally.set(name, cur);
  }
  return [...tally.entries()]
    .map(([name, v]) => ({ name, count: v.count, lastUsed: new Date(v.last).toISOString() }))
    .sort((a, b) => b.count - a.count || (a.lastUsed < b.lastUsed ? 1 : a.lastUsed > b.lastUsed ? -1 : 0))
    .slice(0, limit);
}
