import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PURGE_EVERY_MS, startPurgeTimer } from './purge-timer.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the purge timer', () => {
  it('runs once at start-up and then every 24 hours', async () => {
    const purge = vi.fn(async () => 0);
    const t = startPurgeTimer({ purge, enabled: true, log: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(purge).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PURGE_EVERY_MS - 1);
    expect(purge).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(purge).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(PURGE_EVERY_MS);
    expect(purge).toHaveBeenCalledTimes(3);
    t.stop();
    await vi.advanceTimersByTimeAsync(PURGE_EVERY_MS * 2);
    expect(purge).toHaveBeenCalledTimes(3);
  });

  it('does nothing in setup mode or without a purge', async () => {
    const purge = vi.fn(async () => 0);
    startPurgeTimer({ purge, enabled: false, log: () => {} });
    startPurgeTimer({ purge: undefined, enabled: true, log: () => {} });
    await vi.advanceTimersByTimeAsync(PURGE_EVERY_MS * 2);
    expect(purge).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never overlaps itself: a tick while one is running is skipped', async () => {
    let release: () => void = () => {};
    const purge = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(0);
        }),
    );
    const t = startPurgeTimer({ purge, enabled: true, log: () => {}, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(purge).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(purge).toHaveBeenCalledTimes(2);
    release();
    t.stop();
  });

  it('never throws, logs a failure and keeps its schedule', async () => {
    const lines: string[] = [];
    const purge = vi.fn(async () => {
      throw new Error('boom');
    });
    const t = startPurgeTimer({ purge, enabled: true, log: (l) => lines.push(l), intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(purge).toHaveBeenCalledTimes(2);
    expect(lines.length).toBe(2);
    expect(lines.join('')).not.toContain('boom');
    t.stop();
  });

  it('logs only when something was erased, and does not hold the process open', async () => {
    const lines: string[] = [];
    const counts = [0, 2];
    const t = startPurgeTimer({
      purge: async () => counts.shift() ?? 0,
      enabled: true,
      log: (l) => lines.push(l),
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(lines).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('2');
    t.stop();
  });
});
