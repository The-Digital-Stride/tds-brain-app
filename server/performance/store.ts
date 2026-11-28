/**
 * The Performance history, in the app's own data folder (never the brain): per log file, its request rows (while the
 * file is on disk) and its per-day sums (kept after the file goes, so history outlives Claude Code's clean-up).
 * Numbers only. Same care as `store/token-savings.ts`: only a missing file reads as empty; any other read error,
 * bad JSON or an unknown version reads as unreadable, and the caller then skips the write so a damaged file is
 * never replaced with nothing. Writes are atomic (temp file, then rename).
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PERFORMANCE_STORE_VERSION } from '../../shared/performance-contract.ts';
import type { ReqRow } from './reader.ts';

/** [requests, input, cache write 5m, cache write 1h, cache read, output]. */
export type Counts = [number, number, number, number, number, number];

export interface FileRecord {
  kind: 'main' | 'agent';
  /** The main session's id; for an agent, its parent's. */
  sessionId: string;
  agentId?: string;
  agentType?: string;
  cwd?: string;
  gitBranch?: string;
  /** Resolved project, set at each refresh. */
  project?: { key: string; label: string };
  /** Code Mode side; an agent takes its parent session's. */
  codeMode: boolean;
  size: number;
  mtimeMs: number;
  /** ISO time of the earliest request; decides which file keeps an id that is in two. */
  firstTs: string;
  /**
   * Request rows by message id, only those this file owns (an id in two files belongs to the oldest). Kept after the
   * file leaves disk, pruned only by `PERFORMANCE_KEEP_DAYS`, so an id a gone file owned is never counted again when a
   * newer file holding it is re-read. Absent only on records written before that rule.
   */
  reqs?: Record<string, ReqRow>;
  /** Date → model → sums of the requests this file owns. */
  days: Record<string, Record<string, Counts>>;
}

export interface PerformanceHistory {
  version: typeof PERFORMANCE_STORE_VERSION;
  /** Local date of the last finished refresh. */
  lastRunDate: string | null;
  updatedAt: string | null;
  /**
   * Local date the history is complete from: set once at the first refresh to the date of the oldest log file's
   * last change then on disk, never moved later. Optional so older stores still read; absent means not set yet.
   */
  completeFrom?: string;
  files: Record<string, FileRecord>;
}

export type StoreRead = { ok: true; history: PerformanceHistory } | { ok: false };

export interface PerformanceStore {
  read(): Promise<StoreRead>;
  /** Throws on failure; the caller reports `write-failed` and keeps the last good data. */
  write(history: PerformanceHistory): Promise<void>;
}

export const emptyHistory = (): PerformanceHistory => ({
  version: PERFORMANCE_STORE_VERSION,
  lastRunDate: null,
  updatedAt: null,
  files: {},
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isDate = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function createPerformanceStore(dataDir: string): PerformanceStore {
  const dir = join(dataDir, 'performance');
  const file = join(dir, 'history.json');
  return {
    async read() {
      let text: string;
      try {
        text = await fs.readFile(file, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, history: emptyHistory() };
        return { ok: false };
      }
      try {
        const raw: unknown = JSON.parse(text);
        if (
          !isRecord(raw) ||
          raw.version !== PERFORMANCE_STORE_VERSION ||
          !isRecord(raw.files) ||
          (raw.completeFrom !== undefined && !isDate(raw.completeFrom))
        ) {
          return { ok: false };
        }
        return { ok: true, history: raw as unknown as PerformanceHistory };
      } catch {
        return { ok: false };
      }
    },
    async write(history) {
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fs.writeFile(tmp, JSON.stringify(history));
        await fs.rename(tmp, file);
      } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
    },
  };
}
