import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADS_TASK_RESULTS_CAPABILITY } from '../../../../shared/ads-contract.ts';
import type { LiveSession } from '../../../../shared/contract.ts';
import { api } from '../../api.ts';
import {
  lastRunText,
  newResultPosts,
  readRuns,
  reconcileRuns,
  recordRun,
  runKey,
  runStatus,
  shownRun,
  TASK_RUNS_KEY,
  type TaskRuns,
  taskRuns,
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

describe('shownRun', () => {
  const mine = { at: '2026-11-16T10:00:00.000Z', chat: 's1' };
  const pete = { at: '2026-11-16T12:00:00.000Z', by: 'pete-smith', byName: 'Pete Smith' };
  it('shows a newer teammate run with their first name', () => {
    expect(shownRun(mine, pete, 'ian-hancock', false)).toEqual({ at: pete.at, by: 'Pete' });
  });
  it('shows my own newer run without a name', () => {
    expect(shownRun({ ...mine, at: '2026-11-16T13:00:00.000Z' }, pete, 'ian-hancock', false)).toEqual({
      at: '2026-11-16T13:00:00.000Z',
      by: null,
    });
  });
  it('never names me, even from the shared log', () => {
    expect(
      shownRun(undefined, { ...pete, by: 'ian-hancock', byName: 'Ian Hancock' }, 'ian-hancock', false),
    ).toEqual({
      at: pete.at,
      by: null,
    });
  });
  it('keeps my live run while its chat is going, even if a teammate ran it since', () => {
    expect(shownRun(mine, pete, 'ian-hancock', true)).toEqual({ at: mine.at, by: null });
  });
  it('is nothing when nobody has run it, and falls back to the slug for a blank name', () => {
    expect(shownRun(undefined, null, 'ian-hancock', false)).toBeNull();
    expect(shownRun(undefined, undefined, null, false)).toBeNull();
    expect(shownRun(undefined, { ...pete, byName: '  ' }, null, false)).toEqual({
      at: pete.at,
      by: 'pete-smith',
    });
  });
});

describe('good runs and the Claude session id (decision 9)', () => {
  const sess = (id: string, extra: Partial<LiveSession>) => ({ id, ...extra }) as LiveSession;
  const start = (chat: string | null = 'c1', at = '2026-11-16T10:00:00.000Z'): TaskRuns => ({
    [runKey('acme', 't')]: { at, chat },
  });

  it('keeps sdk and good through a save and load, and still loads old records', () => {
    const runs: TaskRuns = {
      a: {
        at: '2026-11-16T10:00:00.000Z',
        chat: 'c1',
        sdk: 'sdk1',
        good: { at: '2026-11-15T10:00:00.000Z', sdk: 'sdk0' },
      },
      b: { at: '2026-11-16T10:00:00.000Z', chat: null },
    };
    const mem = memory();
    writeRuns(runs, mem);
    expect(readRuns(mem)).toEqual(runs);
    const old = memory(JSON.stringify({ x: { at: '2026-11-16T10:00:00.000Z', chat: 'c9' } }));
    expect(readRuns(old)).toEqual({ x: { at: '2026-11-16T10:00:00.000Z', chat: 'c9' } });
  });
  it('drops a malformed sdk or good but keeps the run', () => {
    const mem = memory(
      JSON.stringify({
        x: { at: '2026-11-16T10:00:00.000Z', chat: 'c', sdk: 4, good: { at: 'nope', sdk: 's' } },
      }),
    );
    expect(readRuns(mem)).toEqual({ x: { at: '2026-11-16T10:00:00.000Z', chat: 'c' } });
  });
  it('records the sdk id once it is known', () => {
    const next = reconcileRuns(start(), [sess('c1', { sdkSessionId: 'sdk1' })]);
    expect(next[runKey('acme', 't')]).toMatchObject({ sdk: 'sdk1' });
    expect(next[runKey('acme', 't')]?.good).toBeUndefined();
  });
  it('sets good the first time the chat shows lastTurn ok', () => {
    const next = reconcileRuns(start(), [sess('c1', { sdkSessionId: 'sdk1', lastTurn: 'ok' })]);
    expect(next[runKey('acme', 't')]?.good).toEqual({ at: '2026-11-16T10:00:00.000Z', sdk: 'sdk1' });
  });
  it('records no good for an older server without lastTurn, or a stopped or failed run', () => {
    for (const lastTurn of [undefined, 'stopped', 'failed'] as const) {
      const next = reconcileRuns(start(), [sess('c1', { sdkSessionId: 'sdk1', lastTurn })]);
      expect(next[runKey('acme', 't')]?.good).toBeUndefined();
    }
  });
  it('a stopped or failed newest run keeps the previous good', () => {
    const good = { at: '2026-11-10T10:00:00.000Z', sdk: 'old' };
    const runs: TaskRuns = { [runKey('acme', 't')]: { at: '2026-11-16T10:00:00.000Z', chat: 'c1', good } };
    const next = reconcileRuns(runs, [sess('c1', { sdkSessionId: 'sdk1', lastTurn: 'failed' })]);
    expect(next[runKey('acme', 't')]?.good).toEqual(good);
  });
  it('a new good replaces the previous one', () => {
    const runs: TaskRuns = {
      [runKey('acme', 't')]: {
        at: '2026-11-16T10:00:00.000Z',
        chat: 'c1',
        good: { at: '2026-11-10T10:00:00.000Z', sdk: 'old' },
      },
    };
    const next = reconcileRuns(runs, [sess('c1', { sdkSessionId: 'sdk1', lastTurn: 'ok' })]);
    expect(next[runKey('acme', 't')]?.good).toEqual({ at: '2026-11-16T10:00:00.000Z', sdk: 'sdk1' });
  });
  it('returns the same object when nothing changed, and ignores runs with no live chat', () => {
    const runs = start();
    expect(reconcileRuns(runs, [])).toBe(runs);
    expect(reconcileRuns(runs, [sess('other', { sdkSessionId: 'x', lastTurn: 'ok' })])).toBe(runs);
    const done = reconcileRuns(runs, [sess('c1', { sdkSessionId: 'sdk1', lastTurn: 'ok' })]);
    expect(reconcileRuns(done, [sess('c1', { sdkSessionId: 'sdk1', lastTurn: 'ok' })])).toBe(done);
    expect(reconcileRuns(start(null), [sess('c1', { sdkSessionId: 'sdk1', lastTurn: 'ok' })])).toEqual(
      start(null),
    );
  });
  it('recording a new run keeps the previous good', () => {
    const good = { at: '2026-11-10T10:00:00.000Z', sdk: 'old' };
    const a: TaskRuns = {
      [runKey('acme', 't')]: { at: '2026-11-11T10:00:00.000Z', chat: 'c1', sdk: 's', good },
    };
    const b = recordRun(a, 'acme', 't', new Date('2026-11-16T10:00:00Z'), 'c2');
    expect(b[runKey('acme', 't')]).toEqual({ at: '2026-11-16T10:00:00.000Z', chat: 'c2', good });
  });
});

describe('taskRuns.reconcile with a second window', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("re-reads the saved records first, so another window's newer run is not overwritten", () => {
    const mem = memory();
    vi.stubGlobal('localStorage', mem);
    // Window A holds t1.
    taskRuns.record('acme', 't1', 'c1', new Date('2026-11-16T10:00:00Z'));
    // Window B saves t2; A has no Ads sheet open, so it never hears about it.
    writeRuns(
      { ...readRuns(mem), [runKey('acme', 't2')]: { at: '2026-11-16T11:00:00.000Z', chat: 'c2' } },
      mem,
    );
    // A reconciles a finished chat for t1.
    taskRuns.reconcile([{ id: 'c1', sdkSessionId: 'sdk1', lastTurn: 'ok' }] as LiveSession[]);
    const saved = readRuns(mem);
    expect(saved[runKey('acme', 't1')]?.good).toBeDefined();
    expect(saved[runKey('acme', 't2')]).toMatchObject({ chat: 'c2' });
  });
});

describe("sending a run's result (plan 2026-11-19-ads-release-2, decision 5)", () => {
  const BRAIN = '2026-11-16T10:00:00.500Z';
  const sess = (extra: Partial<LiveSession>) =>
    ({ id: 'c1', sdkSessionId: 'sdk1', lastTurn: 'ok', ...extra }) as LiveSession;
  const run = (extra: Partial<TaskRuns[string]> = {}): TaskRuns => ({
    [runKey('acme', 't')]: { at: '2026-11-16T10:00:00.000Z', chat: 'c1', ...extra },
  });

  it('brainAt and resultSent survive a save and load; a bad brainAt is dropped', () => {
    const runs = run({ brainAt: BRAIN, resultSent: true });
    const mem = memory();
    writeRuns(runs, mem);
    expect(readRuns(mem)).toEqual(runs);
    expect(readRuns(memory(JSON.stringify(run({ brainAt: 'soon', resultSent: false } as never))))).toEqual(
      run(),
    );
  });
  it('a new run of the task starts without the old brainAt or resultSent', () => {
    const next = recordRun(
      run({ brainAt: BRAIN, resultSent: true }),
      'acme',
      't',
      new Date('2026-11-17T10:00:00Z'),
      'c2',
    );
    expect(next[runKey('acme', 't')]).toEqual({ at: '2026-11-17T10:00:00.000Z', chat: 'c2' });
  });
  it('marks resultSent the first time a run with a brainAt turns good, and only then', () => {
    const first = reconcileRuns(run({ brainAt: BRAIN }), [sess({})], true);
    expect(first[runKey('acme', 't')]?.resultSent).toBe(true);
    expect(newResultPosts(run({ brainAt: BRAIN }), first)).toEqual([
      { account: 'acme', task: 't', at: BRAIN, chat: 'c1' },
    ]);
    expect(reconcileRuns(first, [sess({})], true)).toBe(first);
    expect(newResultPosts(first, first)).toEqual([]);
  });
  it('still posts for a run that turned good before the feature was known', () => {
    const before = reconcileRuns(run({ brainAt: BRAIN }), [sess({})], false);
    expect(before[runKey('acme', 't')]?.good).toBeTruthy();
    expect(before[runKey('acme', 't')]?.resultSent).toBeUndefined();
    const after = reconcileRuns(before, [sess({})], true);
    expect(after[runKey('acme', 't')]?.resultSent).toBe(true);
    expect(newResultPosts(before, after)).toEqual([{ account: 'acme', task: 't', at: BRAIN, chat: 'c1' }]);
  });
  it('marks nothing without a brainAt, without the feature, or for a run that did not finish well', () => {
    expect(reconcileRuns(run(), [sess({})], true)[runKey('acme', 't')]?.resultSent).toBeUndefined();
    expect(
      reconcileRuns(run({ brainAt: BRAIN }), [sess({})])[runKey('acme', 't')]?.resultSent,
    ).toBeUndefined();
    expect(
      reconcileRuns(run({ brainAt: BRAIN }), [sess({ lastTurn: 'failed' })], true)[runKey('acme', 't')]
        ?.resultSent,
    ).toBeUndefined();
  });

  describe('taskRuns', () => {
    afterEach(() => {
      // Forget this test's chats, so the next test's setFeatures has nothing to catch up on.
      taskRuns.reconcile([]);
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      taskRuns.setFeatures([]);
    });
    const setup = (features: string[]) => {
      const mem = memory(JSON.stringify(run({ brainAt: BRAIN })));
      vi.stubGlobal('localStorage', mem);
      taskRuns.reconcile([]); // no chats seen yet, whatever ran before in this file
      taskRuns.setFeatures(features);
      return mem;
    };
    it('posts task-result once when the run first turns good, and never again', () => {
      const mem = setup([ADS_TASK_RESULTS_CAPABILITY]);
      const post = vi.spyOn(api, 'adsChange').mockResolvedValue({ result: null } as never);
      taskRuns.reconcile([sess({})]);
      taskRuns.reconcile([sess({})]);
      expect(post).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledWith('task-result', { account: 'acme', task: 't', at: BRAIN, chat: 'c1' });
      expect(readRuns(mem)[runKey('acme', 't')]?.resultSent).toBe(true);
    });
    it('does not retry a failed post', async () => {
      setup([ADS_TASK_RESULTS_CAPABILITY]);
      const post = vi.spyOn(api, 'adsChange').mockRejectedValue(new Error('no'));
      taskRuns.reconcile([sess({})]);
      await Promise.resolve();
      taskRuns.reconcile([sess({})]);
      expect(post).toHaveBeenCalledTimes(1);
    });
    it('catches up as soon as the feature is known, for a run that finished first', () => {
      setup([]);
      const post = vi.spyOn(api, 'adsChange').mockResolvedValue({ result: null } as never);
      taskRuns.reconcile([sess({})]);
      expect(post).not.toHaveBeenCalled();
      taskRuns.setFeatures([ADS_TASK_RESULTS_CAPABILITY]);
      expect(post).toHaveBeenCalledTimes(1);
    });
    it('posts nothing when the skill does not list the feature', () => {
      setup([]);
      const post = vi.spyOn(api, 'adsChange').mockResolvedValue({ result: null } as never);
      taskRuns.reconcile([sess({})]);
      expect(post).not.toHaveBeenCalled();
    });
    it("share keeps the brain's own at as brainAt on the run just recorded", async () => {
      const mem = memory();
      vi.stubGlobal('localStorage', mem);
      taskRuns.record('acme', 'shared', 'c1', new Date('2026-11-16T10:00:00Z'));
      vi.spyOn(api, 'adsTaskRun').mockResolvedValue({
        run: { at: BRAIN, by: 'ian', byName: 'Ian' },
      });
      taskRuns.share('acme', 'shared');
      await vi.waitFor(() => expect(readRuns(mem)[runKey('acme', 'shared')]?.brainAt).toBe(BRAIN));
    });
  });
});
