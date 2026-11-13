// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../../../shared/update-contract.ts';

const apiMock = vi.hoisted(() => ({
  updateStatus: vi.fn(),
  updateCheck: vi.fn(),
  updateStart: vi.fn(),
}));
vi.mock('../api.ts', () => ({ api: apiMock }));

const mod = await import('./update.ts');

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  current: '0.8.2',
  latest: '0.9.0',
  available: true,
  blocked: null,
  checkedAt: null,
  checkFailed: false,
  unfinished: false,
  phase: 'idle',
  error: null,
  notes: [],
  openChats: 0,
  ...over,
});

async function mount() {
  const hook = renderHook(() => mod.useUpdate());
  await act(async () => {});
  return hook;
}
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers();
  mod.resetUpdateForTests();
  window.localStorage.clear();
  window.sessionStorage.clear();
  for (const f of Object.values(apiMock)) f.mockReset();
  apiMock.updateStatus.mockResolvedValue(status());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('polling cadence', () => {
  it('reads once on first subscribe and shares it between components', async () => {
    const a = await mount();
    const b = await mount();
    expect(apiMock.updateStatus).toHaveBeenCalledTimes(1);
    expect(a.result.current.status?.latest).toBe('0.9.0');
    expect(b.result.current.status?.latest).toBe('0.9.0');
  });

  it('reads again every 30 minutes, not sooner', async () => {
    await mount();
    await tick(mod.SLOW_POLL_MS - 1000);
    expect(apiMock.updateStatus).toHaveBeenCalledTimes(1);
    await tick(1000);
    expect(apiMock.updateStatus).toHaveBeenCalledTimes(2);
  });

  it('reads every 2 seconds while an update is running', async () => {
    apiMock.updateStatus.mockResolvedValue(status({ phase: 'building' }));
    await mount();
    await tick(2000);
    await tick(2000);
    expect(apiMock.updateStatus).toHaveBeenCalledTimes(3);
  });

  it('reads on window focus at most once a minute', async () => {
    await mount();
    await act(async () => void window.dispatchEvent(new Event('focus')));
    expect(apiMock.updateStatus).toHaveBeenCalledTimes(1);
    await tick(mod.FOCUS_MIN_MS);
    await act(async () => void window.dispatchEvent(new Event('focus')));
    expect(apiMock.updateStatus).toHaveBeenCalledTimes(2);
  });
});

describe('restarting', () => {
  it('keeps polling through failed requests and flags a stall after a minute', async () => {
    apiMock.updateStatus.mockResolvedValueOnce(status({ phase: 'restarting' }));
    const { result } = await mount();
    apiMock.updateStatus.mockRejectedValue(new Error('down'));
    await tick(30_000);
    expect(result.current.stalled).toBe(false);
    expect(result.current.status?.phase).toBe('restarting');
    await tick(32_000);
    expect(result.current.stalled).toBe(true);
    expect(apiMock.updateStatus.mock.calls.length).toBeGreaterThan(20);
  });

  it('treats a failed request after building as restarting, then stalled', async () => {
    apiMock.updateStatus.mockResolvedValueOnce(status({ phase: 'building' }));
    const { result } = await mount();
    apiMock.updateStatus.mockRejectedValue(new Error('down'));
    await tick(2000);
    expect(result.current.restarting).toBe(true);
    expect(result.current.stalled).toBe(false);
    await tick(60_000);
    expect(result.current.stalled).toBe(true);
  });

  it('reloads the tab that started the update once a new version is running', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    const { result } = await mount();
    apiMock.updateStart.mockResolvedValue(status({ phase: 'downloading' }));
    await act(async () => result.current.start());
    expect(apiMock.updateStart).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    apiMock.updateStatus.mockResolvedValue(status({ current: '0.9.0', available: false, phase: 'idle' }));
    await tick(2000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload a tab that did not start the update', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    await mount();
    apiMock.updateStatus.mockResolvedValue(status({ current: '0.9.0', available: false }));
    await tick(mod.SLOW_POLL_MS);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('Later', () => {
  it('hides the update for that version only', async () => {
    const { result } = await mount();
    expect(result.current.dismissed).toBe(false);
    act(() => result.current.later());
    expect(result.current.dismissed).toBe(true);
    expect(window.localStorage.getItem(mod.LATER_KEY)).toBe('0.9.0');
    apiMock.updateStatus.mockResolvedValue(status({ latest: '0.9.1' }));
    await tick(mod.SLOW_POLL_MS);
    expect(result.current.dismissed).toBe(false);
  });

  it('is harmless when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = await mount();
    expect(() => act(() => result.current.later())).not.toThrow();
    expect(result.current.status?.latest).toBe('0.9.0');
    apiMock.updateStart.mockResolvedValue(status({ phase: 'downloading' }));
    await expect(act(async () => result.current.start())).resolves.not.toThrow();
  });
});

describe('check', () => {
  it('shows checking while it runs, then the new answer', async () => {
    const { result } = await mount();
    let done!: (s: UpdateStatus) => void;
    apiMock.updateCheck.mockReturnValue(new Promise<UpdateStatus>((r) => (done = r)));
    let p!: Promise<void>;
    act(() => {
      p = result.current.check();
    });
    expect(result.current.checking).toBe(true);
    await act(async () => {
      done(status({ available: false, checkedAt: '2026-11-13T14:05:00Z' }));
      await p;
    });
    expect(result.current.checking).toBe(false);
    expect(result.current.status?.checkedAt).toBe('2026-11-13T14:05:00Z');
  });
});
