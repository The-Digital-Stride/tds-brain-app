/**
 * The Performance service (plan 2026-11-28-settings-performance, decisions 5, 6, 11, 12): reads the session logs
 * incrementally into the stored history, then builds the report. One refresh at a time; a failure keeps the last
 * good data; a store that can't be read is never overwritten. Numbers only; errors are codes, never messages.
 */
import { existsSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PERFORMANCE_KEEP_DAYS,
  type PerformanceErrorCode,
  type PerformanceReport,
  PRICES_CHECKED,
} from '../../shared/performance-contract.ts';
import { createProjectResolver } from './projects.ts';
import {
  type FileRead,
  type LogFile,
  listLogFiles,
  localDate,
  PerformanceError,
  readLogFile,
} from './reader.ts';
import {
  type Counts,
  emptyHistory,
  type FileRecord,
  type PerformanceHistory,
  type PerformanceStore,
} from './store.ts';
import { buildViews, datesEndingAt, historyFrom } from './views.ts';

/** What the routes and the timer use. */
export interface PerformanceService {
  /** The report as it is now. Never refreshes. */
  report(): Promise<PerformanceReport>;
  /** Starts a refresh unless one is running, and replies at once with the report (decision 12). */
  start(): Promise<PerformanceReport>;
  /** Runs a refresh and resolves when it ends; joins one already running. Never rejects. */
  refreshNow(): Promise<void>;
  /** True when today's refresh hasn't run (and the history can be read). */
  dueToday(): Promise<boolean>;
}

export interface PerformanceOptions {
  /** Claude Code's `projects` folder (`$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`). */
  logsRoot: string;
  store: PerformanceStore;
  now?: () => Date;
  home?: string;
  /** The brain's path and ~/agencybrain. */
  brainPaths?: readonly string[];
  tempDirs?: readonly string[];
  isRepoRoot?: (path: string) => boolean;
  log?: (line: string) => void;
  /** Injectable for tests. */
  list?: (root: string) => Promise<LogFile[]>;
  read?: (path: string) => Promise<FileRead>;
}

export function logsRootFor(env: Record<string, string | undefined>, home: string): string {
  return join(env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude'), 'projects');
}

const defaultIsRepoRoot = (path: string): boolean => {
  try {
    return existsSync(join(path, '.git')) && statSync(join(path, '.git')).isDirectory();
  } catch {
    return false;
  }
};

const zeroCounts = (): Counts => [0, 0, 0, 0, 0, 0];

/**
 * Gives each message id to the oldest file that holds it, rebuilds each file's day sums, and prunes old days.
 * Files that have left disk keep their rows and take part in the same oldest-first order, so an id a gone file owned
 * stays its own when a newer file that also holds it is re-read (it would otherwise be counted twice).
 */
function recount(history: PerformanceHistory, today: string): void {
  const cutoff = datesEndingAt(today, PERFORMANCE_KEEP_DAYS)[0] as string;
  const live = Object.entries(history.files)
    .filter(([, r]) => r.reqs)
    .sort(([ak, a], [bk, b]) => (a.firstTs < b.firstTs ? -1 : a.firstTs > b.firstTs ? 1 : ak < bk ? -1 : 1));
  const seen = new Set<string>();
  for (const [, rec] of live) {
    const reqs = rec.reqs as NonNullable<FileRecord['reqs']>;
    rec.days = {};
    for (const [id, row] of Object.entries(reqs)) {
      if (seen.has(id) || row[0] < cutoff) {
        delete reqs[id];
        continue;
      }
      seen.add(id);
      const [date, model, input, w5, w1, read, output] = row;
      const models = rec.days[date] ?? {};
      rec.days[date] = models;
      const cell = models[model] ?? zeroCounts();
      models[model] = cell;
      cell[0] += 1;
      cell[1] += input;
      cell[2] += w5;
      cell[3] += w1;
      cell[4] += read;
      cell[5] += output;
    }
  }
  for (const [key, rec] of Object.entries(history.files)) {
    for (const date of Object.keys(rec.days)) if (date < cutoff) delete rec.days[date];
    if (!rec.reqs || Object.keys(rec.reqs).length === 0) {
      if (Object.keys(rec.days).length === 0) delete history.files[key];
    }
  }
}

export function createPerformanceService(o: PerformanceOptions): PerformanceService {
  const now = o.now ?? (() => new Date());
  const home = o.home ?? homedir();
  const log = o.log ?? (() => {});
  const list = o.list ?? listLogFiles;
  const read = o.read ?? readLogFile;
  const store = o.store;

  type View = Pick<PerformanceReport, 'updatedAt' | 'historyFrom' | 'completeFrom' | 'views'> & {
    lastRunDate: string;
  };
  let view: View | null = null;
  let loaded = false;
  let lastError: PerformanceErrorCode | null = null;
  let running: Promise<void> | null = null;

  function viewOf(history: PerformanceHistory): View | null {
    if (!history.lastRunDate) return null;
    return {
      lastRunDate: history.lastRunDate,
      updatedAt: history.updatedAt,
      historyFrom: historyFrom(history),
      completeFrom: history.completeFrom ?? null,
      views: buildViews(history, history.lastRunDate),
    };
  }

  async function load(): Promise<void> {
    if (loaded) return;
    const r = await store.read();
    if (!r.ok) {
      lastError = 'history-unreadable';
      return;
    }
    loaded = true;
    if (lastError === 'history-unreadable') lastError = null;
    applyProjects(r.history); // keys are worked out afresh, so a key stored by an older build never reaches the page
    view = viewOf(r.history);
  }

  async function run(): Promise<void> {
    try {
      const r = await store.read();
      if (!r.ok) {
        lastError = 'history-unreadable';
        return; // never write over a file that couldn't be read
      }
      const history = r.history ?? emptyHistory();
      const today = localDate(now());
      const files = await list(o.logsRoot);
      // Set once, never moved later. Claude Code clears logs older than a moment (about 30 days back), not a date,
      // so the oldest surviving log's own day may be partly cleared: start the day after it (never after today).
      if (history.completeFrom === undefined) {
        const oldest = files.reduce((min, f) => Math.min(min, f.mtimeMs), Number.POSITIVE_INFINITY);
        if (Number.isFinite(oldest)) {
          const o = new Date(oldest);
          const next = localDate(new Date(o.getFullYear(), o.getMonth(), o.getDate() + 1, 12));
          history.completeFrom = [next, today].sort()[0] as string; // ISO dates sort by time
        } else history.completeFrom = today;
      }
      let skipped = 0;
      for (const f of files) {
        const rec = history.files[f.key];
        if (rec?.reqs && rec.size === f.size && rec.mtimeMs === f.mtimeMs) {
          rec.sessionId = f.sessionId;
          if (f.agentType) rec.agentType = f.agentType;
          continue;
        }
        let got: FileRead;
        try {
          got = await read(f.path);
        } catch {
          skipped += 1;
          continue;
        }
        const reqs: NonNullable<FileRecord['reqs']> = {};
        for (const [id, row] of got.reqs) reqs[id] = row;
        history.files[f.key] = {
          kind: f.kind,
          sessionId: f.sessionId,
          ...(f.agentId ? { agentId: f.agentId } : {}),
          ...(f.agentType ? { agentType: f.agentType } : {}),
          ...(got.cwd ? { cwd: got.cwd } : {}),
          ...(got.gitBranch ? { gitBranch: got.gitBranch } : {}),
          codeMode: got.codeMode,
          size: f.size,
          mtimeMs: f.mtimeMs,
          firstTs: got.firstTs,
          reqs,
          days: rec?.days ?? {},
        };
      }
      if (skipped > 0)
        log(`${skipped} Claude Code log file${skipped === 1 ? '' : 's'} could not be read for Performance.`);
      recount(history, today);
      applyProjects(history);
      history.lastRunDate = today;
      history.updatedAt = now().toISOString();
      try {
        await store.write(history);
      } catch {
        lastError = 'write-failed';
        return;
      }
      loaded = true;
      view = viewOf(history);
      lastError = null;
    } catch (err) {
      lastError = err instanceof PerformanceError ? err.code : 'read-failed';
    }
  }

  function applyProjects(history: PerformanceHistory): void {
    const recs = Object.values(history.files);
    const resolver = createProjectResolver({
      home,
      brainPaths: o.brainPaths ?? [join(home, 'agencybrain')],
      tempDirs: o.tempDirs ?? [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'],
      isRepoRoot: o.isRepoRoot ?? defaultIsRepoRoot,
      knownCwds: new Set(recs.flatMap((r) => (r.cwd ? [r.cwd] : []))),
    });
    const mains = new Map<string, FileRecord>();
    for (const r of recs) if (r.kind === 'main') mains.set(r.sessionId, r);
    for (const r of recs) {
      const parent = r.kind === 'agent' ? mains.get(r.sessionId) : undefined;
      if (parent) r.codeMode = parent.codeMode;
      const from = parent?.cwd ? parent : r;
      r.project = resolver.resolve(from.cwd, from.gitBranch);
    }
  }

  const refreshNow = (): Promise<void> => {
    running ??= run().finally(() => {
      running = null;
    });
    return running;
  };

  async function report(): Promise<PerformanceReport> {
    await load();
    const refreshing = running !== null;
    const base = { refreshing, pricesChecked: PRICES_CHECKED };
    if (view) {
      return {
        status: lastError ? 'failed' : 'ready',
        ...base,
        updatedAt: view.updatedAt,
        ...(lastError ? { error: lastError } : {}),
        historyFrom: view.historyFrom,
        completeFrom: view.completeFrom,
        ...(view.views ? { views: view.views } : {}),
      };
    }
    return {
      status: refreshing ? 'building' : lastError ? 'failed' : 'never-run',
      ...base,
      updatedAt: null,
      ...(lastError && !refreshing ? { error: lastError } : {}),
      historyFrom: null,
      completeFrom: null,
    };
  }

  return {
    report,
    refreshNow,
    async start() {
      void refreshNow();
      return report();
    },
    async dueToday() {
      await load();
      if (lastError === 'history-unreadable') return false;
      return view?.lastRunDate !== localDate(now());
    },
  };
}
