// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../../../shared/update-contract.ts';

const hook = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../state/update.ts', () => ({ useUpdate: () => hook.current }));

const { UpdateBanner } = await import('./UpdateBanner.tsx');

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
const set = (over: Partial<UpdateStatus> = {}, extra: Record<string, unknown> = {}) => {
  hook.current = {
    status: status(over),
    stalled: false,
    restarting: false,
    checking: false,
    dismissed: false,
    check: vi.fn(),
    start: vi.fn(),
    later: vi.fn(),
    ...extra,
  };
  return hook.current as { start: ReturnType<typeof vi.fn>; later: ReturnType<typeof vi.fn> };
};

afterEach(cleanup);

describe('UpdateBanner', () => {
  it('says which version is available and starts at once with no chats open', () => {
    const h = set();
    render(<UpdateBanner />);
    expect(screen.getAllByText('TDS Brain 0.9.0 is available.')[0]).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update and restart' }));
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('is hidden when blocked, not available, or dismissed', () => {
    for (const [over, extra] of [
      [{ blocked: 'not-service' as const }, {}],
      [{ available: false }, {}],
      [{}, { dismissed: true }],
    ] as const) {
      set(over, extra);
      const { container } = render(<UpdateBanner />);
      expect(container.textContent).toBe('');
      cleanup();
    }
  });

  it('Later calls later()', () => {
    const h = set();
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(h.later).toHaveBeenCalledTimes(1);
  });

  it("shows What's new only when there are notes", () => {
    set();
    render(<UpdateBanner />);
    expect(screen.queryByRole('button', { name: "What's new" })).toBeNull();
    cleanup();
    set({
      notes: [{ version: '0.9.0', date: null, changes: [{ kind: 'feat', text: 'Updates in the app' }] }],
    });
    render(<UpdateBanner />);
    expect(screen.queryByText('Updates in the app')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "What's new" }));
    expect(screen.getByText('Updates in the app')).toBeTruthy();
  });

  it('asks first when chats are open: Not now has focus, Esc cancels, Update now starts', () => {
    const h = set({ openChats: 2 });
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Update and restart' }));
    expect(screen.getByText('Updating restarts TDS Brain and closes 2 open chats.')).toBeTruthy();
    expect(h.start).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Not now' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Not now' }), { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Update and restart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('uses the singular for one open chat', () => {
    set({ openChats: 1 });
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Update and restart' }));
    expect(screen.getByText('Updating restarts TDS Brain and closes 1 open chat.')).toBeTruthy();
  });

  it.each([
    ['downloading', 'Downloading the update…'],
    ['installing', 'Installing the update…'],
    ['building', 'Building the update…'],
    ['restarting', 'Restarting TDS Brain…'],
  ] as const)('says %s in words with role=status', (phase, words) => {
    set({ phase });
    render(<UpdateBanner />);
    expect(screen.getByRole('status').textContent).toBe(words);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says it has not come back after a minute', () => {
    set({ phase: 'restarting' }, { stalled: true });
    render(<UpdateBanner />);
    expect(screen.getByRole('status').textContent).toContain("hasn't come back after a minute");
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('shows restarting when the server went quiet mid-update', () => {
    set({ phase: 'building' }, { restarting: true });
    render(<UpdateBanner />);
    expect(screen.getByRole('status').textContent).toBe('Restarting TDS Brain…');
  });

  it('ignores Later for a failure, and hides Later with no latest version', () => {
    set({ phase: 'failed', error: 'It failed.' }, { dismissed: true });
    render(<UpdateBanner />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('It failed.');
    cleanup();
    set({ phase: 'failed', unfinished: true, available: false, latest: null, error: 'It failed.' });
    render(<UpdateBanner />);
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull();
  });

  it('returns focus to the trigger after Not now', async () => {
    set({ openChats: 1 });
    render(<UpdateBanner />);
    const trigger = screen.getByRole('button', { name: 'Update and restart' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Update and restart' }));
  });

  it("links What's new to its list", () => {
    set({ notes: [{ version: '0.9.0', date: null, changes: [{ kind: 'feat', text: 'One' }] }] });
    render(<UpdateBanner />);
    const toggle = screen.getByRole('button', { name: "What's new" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')?.textContent).toBe('One');
  });

  it('shows a failure with Try again', () => {
    const h = set({
      phase: 'failed',
      error: "The update couldn't be built. TDS Brain is still on the version you had.",
    });
    render(<UpdateBanner />);
    expect(screen.getAllByText(/couldn't be built/)[0]).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('offers to finish an interrupted update even when nothing is newer', () => {
    set({ phase: 'failed', unfinished: true, available: false, latest: null, error: null });
    render(<UpdateBanner />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
