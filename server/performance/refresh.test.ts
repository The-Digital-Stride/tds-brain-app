import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERFORMANCE_KEEP_DAYS } from '../../shared/performance-contract.ts';
import { createDemoPerformance } from './demo.ts';
import { localDate, readLogFile } from './reader.ts';
import { createPerformanceService, logsRootFor } from './refresh.ts';
import { createPerformanceStore } from './store.ts';
import { startPerformanceTimer } from './timer.ts';

let root: string;
let data: string;
let logs: string;
const NOW = new Date(2026, 10, 28, 10, 0, 0);
let clock = NOW;
const day = (back: number, h = 12) => new Date(2026, 10, 28 - back, h, 0, 0).toISOString();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'perf-refresh-'));
  data = join(root, 'data');
  logs = join(root, 'projects');
  await mkdir(join(logs, 'p1'), { recursive: true });
  clock = NOW;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const L = (
  id: string,
  ts: string,
  over: { model?: string; out?: number; repl?: boolean; cwd?: string; usage?: Record<string, unknown> } = {},
) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    cwd: over.cwd ?? '/Users/x/repo',
    gitBranch: 'main',
    message: {
      id,
      model: over.model ?? 'claude-opus-5-5',
      usage: over.usage ?? {
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 100,
        output_tokens: over.out ?? 5,
      },
      content: over.repl ? [{ type: 'tool_use', name: 'REPL' }] : [{ type: 'text', text: 'PRIVATE' }],
    },
  });
const put = (rel: string, lines: string[]) => writeFile(join(logs, rel), `${lines.join('\n')}\n`);
/** Sets a log's last change to `back` days ago, as Claude Code's own clock would have left it. */
const touch = (rel: string, back: number) =>
  utimes(join(logs, rel), new Date(day(back)), new Date(day(back)));

function make(over: Partial<Parameters<typeof createPerformanceService>[0]> = {}) {
  const store = createPerformanceStore(data);
  const svc = createPerformanceService({
    logsRoot: logs,
    store,
    now: () => clock,
    home: '/Users/x',
    brainPaths: [],
    tempDirs: [],
    isRepoRoot: () => false,
    ...over,
  });
  return { svc, store };
}

describe('refresh', () => {
  it('builds views: sessions once, unpriced requests counted', async () => {
    await put('p1/s1.jsonl', [L('a', day(1)), L('b', day(1)), L('c', day(0), { model: 'claude-mystery-9' })]);
    await mkdir(join(logs, 'p1/s1/subagents'), { recursive: true });
    await put('p1/s1/subagents/agent-z.jsonl', [L('d', day(1), { model: 'claude-haiku-5-5' })]);
    await writeFile(
      join(logs, 'p1/s1/subagents/agent-z.meta.json'),
      JSON.stringify({ agentType: 'reviewer' }),
    );
    const { svc } = make();
    expect((await svc.report()).status).toBe('never-run');
    await svc.refreshNow();
    const r = await svc.report();
    expect(r.status).toBe('ready');
    const v = r.views?.['7'];
    expect(v?.current.sessions).toBe(1);
    expect(v?.current.agentsStarted).toBe(1);
    expect(v?.current.totals.requests).toBe(4);
    expect(v?.current.totals.unpricedRequests).toBe(1);
    expect(v?.current.byAgentType[0]?.label).toBe('reviewer');
    expect(v?.current.daily).toHaveLength(7);
    expect(v?.previous).toBeNull();
    expect(r.historyFrom).toBe(localDate(day(1)));
    expect(JSON.stringify(r)).not.toContain('PRIVATE');
  });

  it('Code Mode: the REPL session and its subagents are one side', async () => {
    await put('p1/on.jsonl', [L('a', day(1), { repl: true })]);
    await mkdir(join(logs, 'p1/on/subagents'), { recursive: true });
    await put('p1/on/subagents/agent-1.jsonl', [L('b', day(1))]);
    await put('p1/off.jsonl', [L('c', day(1))]);
    const { svc } = make();
    await svc.refreshNow();
    const cm = (await svc.report()).views?.['7'].current.codeMode;
    expect(cm?.on.sessions).toBe(1);
    expect(cm?.on.requests).toBe(2);
    expect(cm?.off.sessions).toBe(1);
  });

  it('re-reads only files whose size or time changed', async () => {
    await put('p1/s1.jsonl', [L('a', day(1))]);
    await put('p1/s2.jsonl', [L('b', day(1))]);
    const read = vi.fn(readLogFile);
    const { svc } = make({ read });
    await svc.refreshNow();
    expect(read).toHaveBeenCalledTimes(2);
    await svc.refreshNow();
    expect(read).toHaveBeenCalledTimes(2);
    await put('p1/s2.jsonl', [L('b', day(1)), L('c', day(1))]);
    await svc.refreshNow();
    expect(read).toHaveBeenCalledTimes(3);
    expect((await svc.report()).views?.['7'].current.totals.requests).toBe(3);
    const later = new Date(Date.now() + 5000);
    await utimes(join(logs, 'p1/s1.jsonl'), later, later);
    await svc.refreshNow();
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('a deleted file keeps its sums and its ids', async () => {
    await put('p1/s1.jsonl', [L('a', day(1)), L('b', day(1))]);
    const { svc, store } = make();
    await svc.refreshNow();
    await rm(join(logs, 'p1/s1.jsonl'));
    await put('p1/s2.jsonl', [L('z', day(0))]);
    await svc.refreshNow();
    expect((await svc.report()).views?.['7'].current.totals.requests).toBe(3);
    const saved = await store.read();
    expect(saved.ok && Object.keys(saved.history.files['p1/s1.jsonl']?.reqs ?? {}).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  it('an id a deleted file owned is not counted again when a newer file holding it is re-read', async () => {
    await put('p1/old.jsonl', [L('o', day(3)), L('dup', day(2))]);
    await put('p1/new.jsonl', [L('dup', day(2)), L('n', day(0))]);
    const { svc, store } = make();
    await svc.refreshNow();
    const total = async () => (await svc.report()).views?.['7'].current.totals.requests;
    expect(await total()).toBe(3);
    await rm(join(logs, 'p1/old.jsonl'));
    await svc.refreshNow();
    expect(await total()).toBe(3);
    await put('p1/new.jsonl', [L('dup', day(2)), L('n', day(0)), L('m', day(0))]);
    await svc.refreshNow();
    expect(await total()).toBe(4);
    await svc.refreshNow();
    expect(await total()).toBe(4);
    const s = await store.read();
    expect(s.ok && Object.keys(s.history.files['p1/old.jsonl']?.reqs ?? {}).sort()).toEqual(['dup', 'o']);
    expect(s.ok && Object.keys(s.history.files['p1/new.jsonl']?.reqs ?? {}).sort()).toEqual(['m', 'n']);
  });

  it('an id in two files counts once, for the oldest file', async () => {
    await put('p1/new.jsonl', [L('dup', day(2), { out: 7 }), L('n', day(0))]);
    await put('p1/old.jsonl', [L('dup', day(2), { out: 7 }), L('o', day(3))]);
    // the old file's first request is 3 days back, so it owns `dup`
    const { svc, store } = make();
    await svc.refreshNow();
    expect((await svc.report()).views?.['7'].current.totals.requests).toBe(3);
    const s = await store.read();
    expect(s.ok && Object.keys(s.history.files['p1/old.jsonl']?.reqs ?? {}).sort()).toEqual(['dup', 'o']);
    expect(s.ok && Object.keys(s.history.files['p1/new.jsonl']?.reqs ?? {})).toEqual(['n']);
  });

  it('drops days older than the keep limit', async () => {
    await put('p1/s1.jsonl', [L('a', day(PERFORMANCE_KEEP_DAYS + 5)), L('b', day(1))]);
    const { svc, store } = make();
    await svc.refreshNow();
    const s = await store.read();
    expect(s.ok && Object.keys(s.history.files['p1/s1.jsonl']?.days ?? {})).toEqual([localDate(day(1))]);
  });

  it('previous is filled only when the logs on disk at the first refresh cover it', async () => {
    await put('p1/old.jsonl', [L('a', day(13))]);
    await touch('p1/old.jsonl', 15);
    await put('p1/new.jsonl', [L('b', day(1))]);
    const { svc } = make();
    expect((await svc.report()).completeFrom).toBeNull();
    await svc.refreshNow();
    const r = await svc.report();
    // The day after the oldest log's last change: that day itself may be partly cleared.
    expect(r.completeFrom).toBe(localDate(day(14)));
    expect(r.views?.['7'].previous?.totals.requests).toBe(1);
    expect(r.views?.['30'].previous).toBeNull();
  });

  it('an old request in a recently changed log does not make a previous period', async () => {
    // Claude Code may have cleared other logs from 70 days back; only this file's last change is known.
    await put('p1/s1.jsonl', [L('a', day(70)), L('b', day(1))]);
    await touch('p1/s1.jsonl', 1);
    const { svc } = make();
    await svc.refreshNow();
    const r = await svc.report();
    expect(r.historyFrom).toBe(localDate(day(70)));
    expect(r.completeFrom).toBe(localDate(day(0)));
    expect(r.views?.['30'].previous).toBeNull();
    expect(r.views?.['7'].previous).toBeNull();
  });

  it('completeFrom is set once and never moves later', async () => {
    await put('p1/old.jsonl', [L('a', day(20))]);
    await touch('p1/old.jsonl', 20);
    await put('p1/new.jsonl', [L('b', day(1))]);
    const { svc, store } = make();
    await svc.refreshNow();
    await rm(join(logs, 'p1/old.jsonl'));
    clock = new Date(2026, 10, 29, 10);
    await svc.refreshNow();
    expect((await svc.report()).completeFrom).toBe(localDate(day(19)));
    const s = await store.read();
    expect(s.ok && s.history.completeFrom).toBe(localDate(day(19)));
  });

  it('a stored history without completeFrom still reads, and gets one at the next refresh', async () => {
    await mkdir(join(data, 'performance'), { recursive: true });
    await writeFile(
      join(data, 'performance/history.json'),
      JSON.stringify({ version: 1, lastRunDate: null, updatedAt: null, files: {} }),
    );
    await put('p1/s1.jsonl', [L('a', day(5))]);
    await touch('p1/s1.jsonl', 5);
    const { svc } = make();
    await svc.refreshNow();
    expect(await svc.report()).toMatchObject({ status: 'ready', completeFrom: localDate(day(4)) });
  });

  it('completeFrom never goes past today when the oldest log changed today', async () => {
    await put('p1/s1.jsonl', [L('a', day(0, 9))]);
    await touch('p1/s1.jsonl', 0);
    const { svc } = make();
    await svc.refreshNow();
    expect((await svc.report()).completeFrom).toBe(localDate(day(0)));
  });

  it('prices each kind of token exactly, per day, and leaves unknown models out of the cost', async () => {
    // Opus 5.5: input 4, 5-minute write 5, 1-hour write 8, cache read 0.2, output 20 ($ per million).
    const opus = {
      input_tokens: 1000,
      cache_creation_input_tokens: 5000,
      cache_creation: { ephemeral_5m_input_tokens: 2000, ephemeral_1h_input_tokens: 3000 },
      cache_read_input_tokens: 10000,
      output_tokens: 500,
    };
    const sonnet = { input_tokens: 1_000_000, cache_read_input_tokens: 0, output_tokens: 0 };
    await put('p1/s1.jsonl', [
      L('a', day(1), { usage: opus }),
      L('b', day(0), { model: 'claude-sonnet-5-5', usage: sonnet }),
      L('c', day(0), { model: 'claude-mystery-9', usage: opus }),
    ]);
    const { svc } = make();
    await svc.refreshNow();
    const cur = (await svc.report()).views?.['7'].current;
    // (1000*4 + 2000*5 + 3000*8 + 10000*0.2 + 500*20) / 1e6 = 0.05; Sonnet 1M input at 2 = 2.
    expect(cur?.totals).toEqual({
      requests: 3,
      input: 1_002_000,
      cacheWrite5m: 4000,
      cacheWrite1h: 6000,
      cacheRead: 20000,
      output: 1000,
      costUsd: 2.05,
      unpricedRequests: 1,
    });
    expect(cur?.daily.slice(-2)).toEqual([
      { date: localDate(day(1)), costUsd: 0.05, requests: 1 },
      { date: localDate(day(0)), costUsd: 2, requests: 2 },
    ]);
    expect(cur?.byModel.find((g) => g.key === 'claude-mystery-9')?.totals).toMatchObject({
      costUsd: 0,
      unpricedRequests: 1,
    });
  });

  it('no folder path or user name reaches the report', async () => {
    await put('p1/s1.jsonl', [L('a', day(1), { cwd: '/Users/someone/My Repos/client-x' })]);
    await put('p1/s2.jsonl', [L('b', day(1), { cwd: '/Users/someone/My Repos/client-x-fix' })]);
    const { svc } = make({ home: '/Users/someone' });
    await svc.refreshNow();
    const r = await svc.report();
    const text = JSON.stringify(r);
    expect(text).not.toContain('/Users');
    expect(text).not.toContain('someone');
    const keys = r.views?.['7'].current.byProject.map((g) => g.key) ?? [];
    expect(keys).toHaveLength(2);
    for (const k of keys) expect(k).toMatch(/^[0-9a-f]{12}$/);
    // stable: a fresh service over the same store sends the same keys
    const again = await make({ home: '/Users/someone' }).svc.report();
    expect(again.views?.['7'].current.byProject.map((g) => g.key)).toEqual(keys);
  });

  it('an unreadable or unknown-version store is reported and never overwritten', async () => {
    const file = join(data, 'performance/history.json');
    await mkdir(join(data, 'performance'), { recursive: true });
    await put('p1/s1.jsonl', [L('a', day(1))]);
    for (const text of ['{broken', JSON.stringify({ version: 99, files: {} })]) {
      await writeFile(file, text);
      const { svc } = make();
      await svc.refreshNow();
      const r = await svc.report();
      expect(r).toMatchObject({ status: 'failed', error: 'history-unreadable' });
      expect(await readFile(file, 'utf8')).toBe(text);
      expect(await svc.dueToday()).toBe(false);
    }
  });

  it('a failure keeps the last good data and reports a code only', async () => {
    await put('p1/s1.jsonl', [L('a', day(1))]);
    let fail = false;
    const { svc } = make({
      list: async (r) => {
        if (fail) throw new Error('/Users/secret/path exploded');
        return (await import('./reader.ts')).listLogFiles(r);
      },
    });
    await svc.refreshNow();
    fail = true;
    await svc.refreshNow();
    const r = await svc.report();
    expect(r).toMatchObject({ status: 'failed', error: 'read-failed' });
    expect(r.views?.['7'].current.totals.requests).toBe(1);
    expect(JSON.stringify(r)).not.toContain('secret');
    fail = false;
    await svc.refreshNow();
    expect((await svc.report()).status).toBe('ready');
  });

  it('a missing logs folder is logs-missing', async () => {
    const { svc } = make({ logsRoot: join(root, 'nope') });
    await svc.refreshNow();
    expect(await svc.report()).toMatchObject({ status: 'failed', error: 'logs-missing' });
  });

  it('runs once per local day, and one at a time', async () => {
    await put('p1/s1.jsonl', [L('a', day(1))]);
    const read = vi.fn(readLogFile);
    const { svc } = make({ read });
    expect(await svc.dueToday()).toBe(true);
    const first = await svc.start();
    expect(first.status).toBe('building');
    expect(first.refreshing).toBe(true);
    await svc.start();
    await svc.refreshNow();
    expect(read).toHaveBeenCalledTimes(1);
    expect(await svc.dueToday()).toBe(false);
    clock = new Date(2026, 10, 29, 0, 5);
    expect(await svc.dueToday()).toBe(true);
  });

  it('groups worktrees into their project', async () => {
    await put('p1/s1.jsonl', [L('a', day(1), { cwd: '/Users/x/My Repos/app' })]);
    await put('p1/s2.jsonl', [L('b', day(1), { cwd: '/Users/x/My Repos/app-fix' })]);
    const { svc } = make({ isRepoRoot: (p) => p === '/Users/x/My Repos/app' });
    // the second session's branch is `main`, so it is a separate project here
    await svc.refreshNow();
    const groups = (await svc.report()).views?.['7'].current.byProject.map((g) => g.label).sort();
    expect(groups).toEqual(['app', 'app-fix']);
  });
});

describe('logsRootFor', () => {
  it('uses CLAUDE_CONFIG_DIR when set, else ~/.claude', () => {
    expect(logsRootFor({ CLAUDE_CONFIG_DIR: '/cfg/claude' }, '/Users/x')).toBe('/cfg/claude/projects');
    expect(logsRootFor({ CLAUDE_CONFIG_DIR: '  ' }, '/Users/x')).toBe('/Users/x/.claude/projects');
    expect(logsRootFor({}, '/Users/x')).toBe('/Users/x/.claude/projects');
  });
});

describe('timer', () => {
  const fakeService = (due: boolean) => {
    const refreshNow = vi.fn(async () => {});
    return { refreshNow, svc: { report: vi.fn(), start: vi.fn(), refreshNow, dueToday: async () => due } };
  };
  const base = { log: () => {}, firstCheckAfterMs: 1e9 };

  it('refreshes for a viewer when due', async () => {
    const { svc, refreshNow } = fakeService(true);
    const t = startPerformanceTimer({
      ...base,
      service: svc as never,
      enabled: true,
      canRun: async () => true,
    });
    await t.tick();
    expect(refreshNow).toHaveBeenCalledTimes(1);
    t.stop();
  });
  it('skips non-viewers, setup and demo, and a day already done', async () => {
    const a = fakeService(true);
    const t1 = startPerformanceTimer({
      ...base,
      service: a.svc as never,
      enabled: true,
      canRun: async () => false,
    });
    await t1.tick();
    const b = fakeService(true);
    const t2 = startPerformanceTimer({
      ...base,
      service: b.svc as never,
      enabled: false,
      canRun: async () => true,
    });
    await t2.tick();
    const c = fakeService(false);
    const t3 = startPerformanceTimer({
      ...base,
      service: c.svc as never,
      enabled: true,
      canRun: async () => true,
    });
    await t3.tick();
    expect(a.refreshNow).not.toHaveBeenCalled();
    expect(b.refreshNow).not.toHaveBeenCalled();
    expect(c.refreshNow).not.toHaveBeenCalled();
    for (const t of [t1, t2, t3]) t.stop();
  });
});

describe('demo', () => {
  it('answers a fixed sample report without reading any logs', async () => {
    const svc = createDemoPerformance(() => NOW);
    const a = await svc.report();
    const b = await svc.start();
    expect(a.status).toBe('ready');
    expect(a.views?.['30'].current.totals.requests).toBeGreaterThan(0);
    expect(a.views?.['30'].previous).not.toBeNull();
    expect(b).toEqual(a);
    expect(a.views?.['7'].current.byProject.map((g) => g.label)).not.toContain('Unknown');
  });
});
