// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../../../shared/update-contract.ts';

const hook = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const store = vi.hoisted(() => ({ openSettings: (() => {}) as (tab?: string) => void }));
vi.mock('../state/update.ts', () => ({ useUpdate: () => hook.current }));
vi.mock('../store.tsx', () => ({
  useStore: () => ({ boot: { appVersion: '0.8.2' }, openSettings: store.openSettings }),
}));

const { RailUpdate, CHECK_RESULT_MS } = await import('./RailUpdate.tsx');

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  current: '0.8.2',
  latest: null,
  available: false,
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
type Hook = { check: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> };
const set = (over: Partial<UpdateStatus> | null = {}, extra: Record<string, unknown> = {}): Hook => {
  hook.current = {
    status: over === null ? null : status(over),
    stalled: false,
    restarting: false,
    checking: false,
    dismissed: false,
    check: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    later: vi.fn(),
    ...extra,
  };
  return hook.current as unknown as Hook;
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RailUpdate', () => {
  it('shows the version from boot before the first answer, with a check button', () => {
    set(null);
    render(<RailUpdate wide pinned />);
    expect(screen.getByText('Version 0.8.2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy();
  });

  it('icons only: the short version shows, and the full words are there for screen readers', () => {
    set();
    render(<RailUpdate wide={false} pinned={false} />);
    expect(screen.getByText('0.8.2').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Version 0.8.2')).toBeTruthy();
  });

  it('checks when pressed, and says so once the check finds nothing new', () => {
    const h = set();
    const { rerender } = render(<RailUpdate wide pinned />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(h.check).toHaveBeenCalledTimes(1);
    set({}, { checking: true, check: h.check });
    rerender(<RailUpdate wide pinned />);
    const busy = screen.getByRole('button', { name: 'Checking for updates…' });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(busy);
    expect(h.check).toHaveBeenCalledTimes(1);
    set({ checkedAt: '2026-11-22T10:00:00Z' });
    rerender(<RailUpdate wide pinned />);
    expect(screen.getByText('You have the newest version.')).toBeTruthy();
  });

  it('the answer goes after a few seconds, and later background checks stay quiet', () => {
    vi.useFakeTimers();
    const h = set();
    const { rerender } = render(<RailUpdate wide pinned />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    set({}, { checking: true, check: h.check });
    rerender(<RailUpdate wide pinned />);
    set({ checkedAt: '2026-11-22T10:00:00Z' });
    rerender(<RailUpdate wide pinned />);
    expect(screen.getByText('You have the newest version.')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(CHECK_RESULT_MS);
    });
    expect(screen.queryByText('You have the newest version.')).toBeNull();
    set({ checkedAt: '2026-11-22T11:00:00Z', checkFailed: true });
    rerender(<RailUpdate wide pinned />);
    expect(screen.queryByText(/Couldn't check/)).toBeNull();
  });

  it("doesn't show the result of the poller's own checks", () => {
    set({ checkedAt: '2026-11-22T10:00:00Z' });
    render(<RailUpdate wide pinned />);
    expect(screen.queryByText('You have the newest version.')).toBeNull();
  });

  it('icons only: a tick for a few seconds after a check finds nothing new', () => {
    vi.useFakeTimers();
    const h = set();
    const { rerender } = render(<RailUpdate wide={false} pinned={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    set({}, { checking: true, check: h.check });
    rerender(<RailUpdate wide={false} pinned={false} />);
    set({ checkedAt: '2026-11-22T10:00:00Z' });
    rerender(<RailUpdate wide={false} pinned={false} />);
    const btn = screen.getByRole('button', { name: 'Check for updates' });
    expect(btn.getAttribute('data-tip')).toBe('Up to date');
    act(() => {
      vi.advanceTimersByTime(CHECK_RESULT_MS);
    });
    expect(btn.getAttribute('data-tip')).toBe('Check for updates');
  });

  it('says why when this copy cannot update itself', () => {
    const h = set();
    const { rerender } = render(<RailUpdate wide pinned />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    set({}, { checking: true, check: h.check });
    rerender(<RailUpdate wide pinned />);
    set({ blocked: 'not-service', available: true, latest: '0.9.0' }, { check: h.check });
    rerender(<RailUpdate wide pinned />);
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull();
    expect(screen.getByText(/started by hand/)).toBeTruthy();
  });

  it('an update is ready: one short primary button that starts at once with no chats open', () => {
    const h = set({ available: true, latest: '0.9.0' });
    render(<RailUpdate wide pinned />);
    const go = screen.getByRole('button', { name: 'Update to 0.9.0 and restart' });
    expect(go.textContent).toBe('Update');
    expect(go.getAttribute('data-tip')).toBe('Update to 0.9.0 and restart');
    expect(go.getAttribute('data-variant')).toBe('primary');
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull();
    fireEvent.click(go);
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('names pinned, with chats open: asks in place before restarting', () => {
    const h = set({ available: true, latest: '0.9.0', openChats: 2 });
    render(<RailUpdate wide pinned />);
    fireEvent.click(screen.getByRole('button', { name: 'Update to 0.9.0 and restart' }));
    expect(h.start).not.toHaveBeenCalled();
    expect(screen.getByText('Updating restarts TDS Cortex and closes 2 open chats.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('icons only, or names only slid out, with chats open: opens Settings › About to ask there', () => {
    for (const wide of [false, true]) {
      const openSettings = vi.fn();
      store.openSettings = openSettings;
      const h = set({ available: true, latest: '0.9.0', openChats: 1 });
      render(<RailUpdate wide={wide} pinned={false} />);
      const go = screen.getByRole('button', { name: 'Update to 0.9.0 and restart…' });
      expect(go.getAttribute('data-tip')).toBe('Update to 0.9.0 and restart: asks first in Settings');
      fireEvent.click(go);
      expect(h.start).not.toHaveBeenCalled();
      expect(openSettings).toHaveBeenCalledWith('about');
      cleanup();
    }
  });

  it('icons only, no chats open: starts at once', () => {
    const h = set({ available: true, latest: '0.9.0' });
    render(<RailUpdate wide={false} pinned={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update to 0.9.0 and restart' }));
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('an unfinished or failed update offers Try again', () => {
    set({ unfinished: true, phase: 'failed', error: 'x' });
    render(<RailUpdate wide pinned />);
    expect(screen.getByRole('button', { name: 'Try the update again' }).textContent).toBe('Try again');
  });

  it('while an update runs: the step in words and no button', () => {
    set({ phase: 'installing', available: true, latest: '0.9.0' });
    render(<RailUpdate wide pinned />);
    expect(screen.getByText('Installing the update…')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
