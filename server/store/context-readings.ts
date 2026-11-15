/**
 * Each chat's newest context reading, kept by `sdkSessionId` so a reopened chat's meter is right at
 * once (plan 2026-11-14-context-management, decision 7). Same pattern as `chat-levels.ts`: lives in
 * the app's data folder, never the brain; capped with the oldest pruned first; a junk file reads as
 * empty; writes run one at a time. Holds numbers only, never chat content.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ContextEvent } from '../../shared/context-contract.ts';

export interface ContextReadingStore {
  get(sdkSessionId: string): Promise<ContextEvent | null>;
  /** Never throws: a reading that can't be kept just isn't. */
  set(sdkSessionId: string, reading: ContextEvent): Promise<void>;
}

export const CONTEXT_READINGS_MAX = 500;
const KEY_MAX = 200;
const SOURCES = new Set(['engine', 'usage', 'stored']);

function whole(v: unknown, min = 0): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min;
}

function cleanReading(v: unknown): ContextEvent | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (
    r.type !== 'context' ||
    !whole(r.usedTokens) ||
    !whole(r.limitTokens, 1) ||
    !whole(r.windowTokens, 1) ||
    !whole(r.percent) ||
    typeof r.autoCompact !== 'boolean' ||
    typeof r.source !== 'string' ||
    !SOURCES.has(r.source) ||
    !whole(r.at)
  )
    return null;
  return {
    type: 'context',
    usedTokens: r.usedTokens,
    limitTokens: r.limitTokens,
    windowTokens: r.windowTokens,
    percent: r.percent,
    autoCompact: r.autoCompact,
    source: r.source as ContextEvent['source'],
    at: r.at,
  };
}

export function createContextReadingStore(dataDir: string): ContextReadingStore {
  const file = join(dataDir, 'context-readings.json');
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<Map<string, ContextEvent>> {
    const out = new Map<string, ContextEvent>();
    try {
      const data: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
      for (const [key, value] of Object.entries(data)) {
        const rec = cleanReading(value);
        if (rec && key !== '' && key.length <= KEY_MAX) out.set(key, rec);
      }
    } catch {
      // missing or junk: nothing remembered
    }
    return out;
  }

  async function write(records: Map<string, ContextEvent>): Promise<void> {
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
    set: (id, reading) =>
      serial(async () => {
        const rec = cleanReading(reading);
        if (!rec || id === '' || id.length > KEY_MAX) return;
        try {
          const records = await read();
          records.delete(id);
          records.set(id, rec);
          if (records.size > CONTEXT_READINGS_MAX) {
            // Oldest `at` first; ties go to the one saved earlier (Map keeps insertion order).
            const oldest = [...records.entries()]
              .map(([key, r], i) => ({ key, t: r.at, i }))
              .sort((a, b) => a.t - b.t || a.i - b.i)
              .slice(0, records.size - CONTEXT_READINGS_MAX);
            for (const o of oldest) records.delete(o.key);
          }
          await write(records);
        } catch {
          // a reading that can't be kept just isn't: the meter fills in after the next reply
        }
      }),
  };
}
