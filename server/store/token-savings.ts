import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  type SavingsMeasure,
  type SavingsSource,
  TOKEN_SAVINGS_FILE,
  TOKEN_SAVINGS_LIMITS,
} from '../../shared/kits-contract.ts';

/**
 * The token savings ledger's totals, in the app's own data folder (never the brain): tokens per UTC
 * day by `source/measure`, plus the dedupe keys of counted summaries (capped), so a boundary counts
 * once across app runs. Same shape of care as `chat-kinds.ts`: writes are queued one at a time, only a
 * missing file reads as empty, and any other read error is not cached and the pending write is skipped,
 * so a bad read can never wipe the saved totals.
 */
const SOURCES: readonly SavingsSource[] = ['summary', 'cache', 'kits'];
const MEASURES: readonly SavingsMeasure[] = ['compacted', 'reused', 'switched-off'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_KEY_CHARS = 200;
const MAX_DAYS = 800;

export interface TokenSavingsFile {
  version: 1;
  /** UTC day → `source/measure` → tokens. */
  days: Record<string, Record<string, number>>;
  /** Counted dedupe keys, oldest first. */
  keys: string[];
}

export interface TokenSavingsAdd {
  day: string;
  source: SavingsSource;
  measure: SavingsMeasure;
  tokens: number;
  dedupeKey: string | null;
}

export interface TokenSavingsStore {
  /** Queued. True when counted; false for a repeat key, bad input or a failed read/write. Never rejects. */
  add(entry: TokenSavingsAdd): Promise<boolean>;
  /** A fresh copy, or null when the file can't be read. */
  read(): Promise<TokenSavingsFile | null>;
}

const empty = (): TokenSavingsFile => ({ version: 1, days: {}, keys: [] });

export const savingsCell = (source: SavingsSource, measure: SavingsMeasure): string => `${source}/${measure}`;

export function parseSavingsCell(cell: string): { source: SavingsSource; measure: SavingsMeasure } | null {
  const [source, measure] = cell.split('/');
  if (!(SOURCES as readonly string[]).includes(source ?? '')) return null;
  if (!(MEASURES as readonly string[]).includes(measure ?? '')) return null;
  return { source: source as SavingsSource, measure: measure as SavingsMeasure };
}

function clean(raw: unknown): TokenSavingsFile {
  const out = empty();
  const r = raw as { days?: unknown; keys?: unknown } | null;
  if (r?.days && typeof r.days === 'object' && !Array.isArray(r.days)) {
    for (const [day, cells] of Object.entries(r.days)) {
      if (!DAY.test(day) || !cells || typeof cells !== 'object' || Array.isArray(cells)) continue;
      const row: Record<string, number> = {};
      for (const [cell, n] of Object.entries(cells)) {
        if (!parseSavingsCell(cell)) continue;
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) row[cell] = Math.round(n);
      }
      if (Object.keys(row).length > 0) out.days[day] = row;
    }
  }
  if (Array.isArray(r?.keys)) {
    for (const k of r.keys) {
      if (typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY_CHARS) out.keys.push(k);
    }
    out.keys = out.keys.slice(-TOKEN_SAVINGS_LIMITS.maxKeys);
  }
  return out;
}

function trim(data: TokenSavingsFile): void {
  if (data.keys.length > TOKEN_SAVINGS_LIMITS.maxKeys) {
    data.keys = data.keys.slice(-TOKEN_SAVINGS_LIMITS.maxKeys);
  }
  const days = Object.keys(data.days).sort();
  for (const d of days.slice(0, Math.max(0, days.length - MAX_DAYS))) delete data.days[d];
}

export function createTokenSavingsStore(
  dataDir: string | null,
  log: (line: string) => void = () => {},
): TokenSavingsStore {
  const file = dataDir ? join(dataDir, TOKEN_SAVINGS_FILE) : null;
  let memory: TokenSavingsFile | null = file ? null : empty();
  let queue: Promise<void> = Promise.resolve();
  let loading: Promise<TokenSavingsFile> | null = null;

  /** Read once and shared; throws on any read error except a missing file, and caches nothing then. */
  function load(): Promise<TokenSavingsFile> {
    if (memory) return Promise.resolve(memory);
    loading ??= readFromDisk().finally(() => {
      loading = null;
    });
    return loading;
  }

  async function readFromDisk(): Promise<TokenSavingsFile> {
    const path = file as string;
    let text: string;
    try {
      text = await fs.readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        memory = empty();
        return memory;
      }
      throw err;
    }
    try {
      memory = clean(JSON.parse(text));
    } catch {
      try {
        await fs.copyFile(path, `${path}.broken`);
      } catch {
        // a failed copy must not stop the app reading the file as empty
      }
      log('The saved token savings could not be read. A copy was kept and they start empty.');
      memory = empty();
    }
    return memory;
  }

  async function save(data: TokenSavingsFile): Promise<void> {
    if (!file || !dataDir) return;
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmp, `${JSON.stringify(data)}\n`);
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  return {
    add(e) {
      const tokens = Math.round(e.tokens);
      if (
        !DAY.test(e.day) ||
        !Number.isFinite(tokens) ||
        tokens <= 0 ||
        !(SOURCES as readonly string[]).includes(e.source) ||
        !(MEASURES as readonly string[]).includes(e.measure) ||
        (e.dedupeKey !== null && (e.dedupeKey === '' || e.dedupeKey.length > MAX_KEY_CHARS))
      ) {
        return Promise.resolve(false);
      }
      const job = queue.then(async (): Promise<boolean> => {
        let data: TokenSavingsFile;
        try {
          data = await load();
        } catch {
          log('The saved token savings could not be read, so this count was not saved.');
          return false;
        }
        if (e.dedupeKey !== null && data.keys.includes(e.dedupeKey)) return false;
        const row = data.days[e.day] ?? {};
        data.days[e.day] = row;
        const cell = savingsCell(e.source, e.measure);
        row[cell] = (row[cell] ?? 0) + tokens;
        if (e.dedupeKey !== null) data.keys.push(e.dedupeKey);
        trim(data);
        try {
          await save(data);
        } catch {
          log('Could not save the token savings.');
        }
        return true;
      });
      queue = job.then(
        () => {},
        () => {},
      );
      return job.catch(() => false);
    },
    async read() {
      await queue;
      try {
        return structuredClone(await load());
      } catch {
        return null;
      }
    },
  };
}
