import { describe, expect, it } from 'vitest';
import type { LiveSession } from '../../../../shared/contract.ts';
import {
  lastRunText,
  readRuns,
  recordRun,
  runKey,
  runStatus,
  TASK_RUNS_KEY,
  type TaskRuns,
  writeRuns,
} from './task-runs.ts';

function memory(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(TASK_RUNS_KEY, initial);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const live = (id: string, state: LiveSession['state']) => ({ id, state }) as LiveSession;

describe('recordRun', () => {
  it('records when a task ran and the chat it started, per account', () => {
    const at = new Date('2026-11-16T21:46:00Z');
    const runs = recordRun({}, 'acme', 'weekly-check', at, 's1');
    expect(runs[runKey('acme', 'weekly-check')]).toEqual({ at: at.toISOString(), chat: 's1' });
    expect(runs[runKey('beta', 'weekly-check')]).toBeUndefined();
  });
  it('replaces the older run of the same task', () => {
    const a = recordRun({}, 'acme', 't', new Date('2026-11-10T10:00:00Z'), 's1');
    const b = recordRun(a, 'acme', 't', new Date('2026-11-16T10:00:00Z'), 's2');
    expect(Object.keys(b)).toHaveLength(1);
    expect(b[runKey('acme', 't')]?.chat).toBe('s2');
  });
  it('keeps only the newest 300 runs', () => {
    let runs: TaskRuns = {};
    for (let i = 0; i < 305; i++)
      runs = recordRun(runs, 'acme', `t${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)), null);
    expect(Object.keys(runs)).toHaveLength(300);
    expect(runs[runKey('acme', 't0')]).toBeUndefined();
    expect(runs[runKey('acme', 't304')]).toBeDefined();
  });
});

describe('readRuns and writeRuns', () => {
  it('round-trips', () => {
    const m = memory();
    const runs = recordRun({}, 'acme', 't', new Date('2026-11-16T21:46:00Z'), 's1');
    writeRuns(runs, m);
    expect(readRuns(m)).toEqual(runs);
  });
  it('drops entries that are not a run, and reads broken text as none', () => {
    const saved = JSON.stringify({
      'acme/ok': { at: '2026-11-16T21:46:00.000Z', chat: 's1' },
      'acme/no-chat': { at: '2026-11-16T21:46:00.000Z', chat: null },
      'acme/bad-date': { at: 'yesterday', chat: 's1' },
      'acme/bad-chat': { at: '2026-11-16T21:46:00.000Z', chat: 7 },
      'acme/not-object': 'x',
    });
    expect(Object.keys(readRuns(memory(saved))).sort()).toEqual(['acme/no-chat', 'acme/ok']);
    for (const bad of ['nope', '[]', 'null', '3']) expect(readRuns(memory(bad))).toEqual({});
  });
  it('copes with blocked or missing storage', () => {
    const boom = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readRuns(boom)).toEqual({});
    expect(() => writeRuns({}, boom)).not.toThrow();
    expect(readRuns(null)).toEqual({});
  });
});

describe('runStatus', () => {
  const run = { at: '2026-11-16T21:46:00.000Z', chat: 's1' };
  it('is running while its chat starts or works', () => {
    expect(runStatus(run, [live('s1', 'starting')])).toBe('running');
    expect(runStatus(run, [live('s1', 'working')])).toBe('running');
  });
  it('is waiting while its chat needs an answer', () => {
    expect(runStatus(run, [live('s1', 'waiting')])).toBe('waiting');
  });
  it('is done once the chat is idle, closed, failed or gone', () => {
    for (const s of ['idle', 'closed', 'error'] as const) expect(runStatus(run, [live('s1', s)])).toBeNull();
    expect(runStatus(run, [live('other', 'working')])).toBeNull();
    expect(runStatus(run, undefined)).toBeNull();
    expect(runStatus(undefined, [live('s1', 'working')])).toBeNull();
    expect(runStatus({ ...run, chat: null }, [live('s1', 'working')])).toBeNull();
  });
});

describe('lastRunText', () => {
  const now = new Date(2026, 10, 16, 22, 0);
  it('says today, yesterday, a date this year, or a date with its year', () => {
    expect(lastRunText(new Date(2026, 10, 16, 21, 46).toISOString(), now)).toBe('Today, 21:46');
    expect(lastRunText(new Date(2026, 10, 15, 9, 5).toISOString(), now)).toBe('Yesterday, 09:05');
    expect(lastRunText(new Date(2026, 10, 3, 14, 0).toISOString(), now)).toBe('3 Nov, 14:00');
    expect(lastRunText(new Date(2025, 11, 30, 8, 0).toISOString(), now)).toBe('30 Dec 2025, 08:00');
  });
});
