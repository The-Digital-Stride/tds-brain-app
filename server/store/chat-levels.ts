/**
 * Each chat's level, kept by `sdkSessionId` so a resumed chat keeps it (plan 2026-11-14-skill-levels-
 * and-helpers, decision 6). Lives in the app's data folder, never the brain. Capped at
 * CHAT_LEVELS_MAX with the oldest pruned first; a junk file reads as empty; writes run one at a time.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  CHAT_LEVELS_MAX,
  type ChatLevelRecord,
  type ChatLevelStore,
  isLevelTier,
} from '../../shared/levels-contract.ts';

const KEY_MAX = 200;

function cleanRecord(v: unknown): ChatLevelRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (!isLevelTier(r.tier) || (r.source !== 'auto' && r.source !== 'chat') || typeof r.at !== 'string')
    return null;
  return { tier: r.tier, source: r.source, at: r.at };
}

function time(r: ChatLevelRecord): number {
  const t = Date.parse(r.at);
  return Number.isNaN(t) ? 0 : t;
}

export function createChatLevelStore(dataDir: string): ChatLevelStore {
  const file = join(dataDir, 'chat-levels.json');
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<Map<string, ChatLevelRecord>> {
    const out = new Map<string, ChatLevelRecord>();
    try {
      const data: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
      for (const [key, value] of Object.entries(data)) {
        const rec = cleanRecord(value);
        if (rec && key !== '' && key.length <= KEY_MAX) out.set(key, rec);
      }
    } catch {
      // missing or junk: nothing remembered
    }
    return out;
  }

  async function write(records: Map<string, ChatLevelRecord>): Promise<void> {
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      // fromEntries defines own properties, so an id such as `__proto__` is just a key.
      await fs.writeFile(tmp, `${JSON.stringify(Object.fromEntries(records), null, 2)}\n`);
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  function serial<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  }

  return {
    get: (id) => serial(async () => (await read()).get(id) ?? null),
    set: (id, record) =>
      serial(async () => {
        const rec = cleanRecord(record);
        if (!rec || id === '' || id.length > KEY_MAX) return;
        try {
          const records = await read();
          records.delete(id);
          records.set(id, rec);
          if (records.size > CHAT_LEVELS_MAX) {
            // Oldest `at` first; ties go to the one saved earlier (Map keeps insertion order).
            const oldest = [...records.entries()]
              .map(([key, r], i) => ({ key, t: time(r), i }))
              .sort((a, b) => a.t - b.t || a.i - b.i)
              .slice(0, records.size - CHAT_LEVELS_MAX);
            for (const o of oldest) records.delete(o.key);
          }
          await write(records);
        } catch {
          // a level that can't be remembered just isn't: the chat re-picks when resumed
        }
      }),
  };
}
