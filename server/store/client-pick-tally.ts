import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ClientGuessResponse, ClientPickOutcome } from '../../shared/contract.ts';

/**
 * A count of how each new chat's client was decided, by month, in the app's own data folder (never
 * the brain). Only counts: no message text, no client names. Writes are queued one at a time, and a
 * failed write is dropped quietly: the tally must never get in the way of starting a chat.
 */
export const TALLY_FILE = 'client-pick-tally.json';
const KEEP_MONTHS = 24;

export interface TallyFile {
  version: 1;
  /** "YYYY-MM" (local time) → outcome → count. */
  months: Record<string, Partial<Record<ClientPickOutcome, number>>>;
}

export interface ClientPickTally {
  record(outcome: ClientPickOutcome): void;
  read(): Promise<TallyFile>;
}

export function guessOutcome(guess: ClientGuessResponse): ClientPickOutcome {
  if (guess.kind === 'sure') return guess.how === 'jev' ? 'jev' : 'named';
  if (guess.kind === 'none') return 'not-client';
  return guess.options.length > 0 ? 'asked' : 'asked-blank';
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function clean(raw: unknown): TallyFile {
  const out: TallyFile = { version: 1, months: {} };
  const months = (raw as { months?: unknown } | null)?.months;
  if (!months || typeof months !== 'object' || Array.isArray(months)) return out;
  for (const [month, counts] of Object.entries(months)) {
    if (!/^\d{4}-\d{2}$/.test(month) || !counts || typeof counts !== 'object') continue;
    const kept: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts)) {
      if (typeof v === 'number' && Number.isInteger(v) && v > 0) kept[k] = v;
    }
    if (Object.keys(kept).length > 0) out.months[month] = kept;
  }
  return out;
}

export function createClientPickTally(
  dataDir: string | null,
  now: () => Date = () => new Date(),
): ClientPickTally {
  const file = dataDir ? join(dataDir, TALLY_FILE) : null;
  let memory: TallyFile | null = file ? null : { version: 1, months: {} };
  let queue: Promise<void> = Promise.resolve();

  async function load(): Promise<TallyFile> {
    if (memory) return memory;
    try {
      memory = clean(JSON.parse(await fs.readFile(file as string, 'utf8')));
    } catch {
      memory = { version: 1, months: {} };
    }
    return memory;
  }

  async function save(data: TallyFile): Promise<void> {
    if (!file || !dataDir) return;
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  return {
    record(outcome) {
      // The month it happened in, not the month the queued write gets to run.
      const key = monthKey(now());
      queue = queue
        .then(async () => {
          const data = await load();
          const month = data.months[key] ?? {};
          month[outcome] = (month[outcome] ?? 0) + 1;
          data.months[key] = month;
          for (const old of Object.keys(data.months).sort().slice(0, -KEEP_MONTHS)) delete data.months[old];
          await save(data);
        })
        .catch(() => {});
    },
    async read() {
      await queue;
      return structuredClone(await load());
    },
  };
}
