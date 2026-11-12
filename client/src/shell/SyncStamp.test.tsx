// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock('../api.ts', () => ({ api }));

const { SyncStamp } = await import('./SyncStamp.tsx');

const SYNCED = new Date(2026, 10, 12, 11, 24, 44);

/** Lets the stamp's request settle inside act. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(SYNCED.getTime() + 30_000));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('SyncStamp', () => {
  it('shows nothing until the server answers', () => {
    api.sync.mockReturnValue(new Promise(() => {}));
    const { container } = render(<SyncStamp wide />);
    expect(container.querySelector('.rail-sync')).toBeNull();
  });

  it('shows the last sync with a green dot, then red after five minutes with no new sync', async () => {
    api.sync.mockResolvedValue({ lastSync: SYNCED.toISOString() });
    const { container } = render(<SyncStamp wide />);
    await settle();
    const stamp = container.querySelector('.rail-sync');
    expect(stamp?.getAttribute('data-stale')).toBe('false');
    expect(stamp?.querySelector('.rail-sync-dot')).not.toBeNull();
    expect(stamp?.textContent).toContain('Synced 11:24, 12 Nov');

    // The server keeps answering with the same time: the brain has stopped syncing.
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    await settle();
    expect(stamp?.getAttribute('data-stale')).toBe('true');
    expect(stamp?.textContent).toContain('Not synced since 11:24, 12 Nov');
    expect(stamp?.textContent).toContain('Brain Connect is running');
  });

  it('asks again every 30 seconds and keeps the last time if the server cannot be reached', async () => {
    api.sync.mockResolvedValueOnce({ lastSync: SYNCED.toISOString() }).mockRejectedValue(new Error('down'));
    const { container } = render(<SyncStamp wide={false} />);
    await settle();
    expect(api.sync).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await settle();
    expect(api.sync).toHaveBeenCalledTimes(2);
    const stamp = container.querySelector('.rail-sync');
    expect(stamp?.getAttribute('data-tip')).toBe('Synced 11:24, 12 Nov');
    expect(stamp?.textContent).toContain('11:2412 Nov');

    // Still unreachable: the clock alone turns it red.
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    await settle();
    expect(stamp?.getAttribute('data-stale')).toBe('true');
  });

  it('turns red between polls, on the clock tick alone', async () => {
    // Every poll hangs, so only the 15-second tick can move the clock on.
    api.sync.mockResolvedValueOnce({ lastSync: SYNCED.toISOString() }).mockReturnValue(new Promise(() => {}));
    const { container } = render(<SyncStamp wide />);
    await settle();
    vi.setSystemTime(new Date(SYNCED.getTime() + 5 * 60_000 + 1_000));
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(container.querySelector('.rail-sync')?.getAttribute('data-stale')).toBe('true');
  });

  it('asks again as soon as a background tab is seen', async () => {
    api.sync.mockResolvedValue({ lastSync: SYNCED.toISOString() });
    render(<SyncStamp wide />);
    await settle();
    expect(api.sync).toHaveBeenCalledTimes(1);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(api.sync).toHaveBeenCalledTimes(2);
  });

  it('tells screen readers once when it goes stale, and when it recovers', async () => {
    api.sync.mockResolvedValue({ lastSync: SYNCED.toISOString() });
    const { container } = render(<SyncStamp wide />);
    await settle();
    const status = () => container.querySelector('[role="status"]')?.textContent;
    expect(status()).toBe('');
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    await settle();
    expect(status()).toContain('The brain has not synced since 11:24 on 12 Nov');
    const fresh = new Date(Date.now() - 10_000).toISOString();
    api.sync.mockResolvedValue({ lastSync: fresh });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await settle();
    expect(status()).toBe('The brain is syncing again.');
  });
});
