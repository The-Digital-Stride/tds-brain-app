// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../store.tsx', () => ({ useStore: () => store.current }));
vi.mock('../build-version.ts', async (orig) => ({
  ...(await orig<typeof import('../build-version.ts')>()),
  CLIENT_VERSION: '0.6.0',
}));

const update = vi.hoisted(() => ({
  current: { status: null, restarting: false } as Record<string, unknown>,
}));
vi.mock('../state/update.ts', () => ({ useUpdate: () => update.current }));

const { SheetNotices } = await import('./SheetNotices.tsx');

const base = { streamUp: true, actionError: null, clearError: vi.fn(), notice: null };

const available = {
  status: {
    current: '0.6.0',
    latest: '0.7.0',
    available: true,
    blocked: null,
    checkedAt: null,
    checkFailed: false,
    unfinished: false,
    phase: 'idle',
    error: null,
    notes: [],
    openChats: 0,
  },
  stalled: false,
  checking: false,
  dismissed: false,
  check: vi.fn(),
  start: vi.fn(),
  later: vi.fn(),
};

afterEach(() => {
  update.current = { status: null, restarting: false };
  cleanup();
  vi.restoreAllMocks();
});

describe('SheetNotices: new version', () => {
  it('offers a reload when the server runs a newer version than this page', () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    store.current = { ...base, boot: { appVersion: '0.7.0' } };
    render(<SheetNotices />);
    expect(screen.getByTestId('update-status').textContent).toContain('A new version of TDS Brain is ready');
    expect(screen.getByTestId('update-status').getAttribute('role')).toBe('status');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when the versions match', () => {
    store.current = { ...base, boot: { appVersion: '0.6.0' } };
    render(<SheetNotices />);
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    // The announcer stays on the page, empty, so the sentence is read out when it arrives.
    expect(screen.getByTestId('update-status').textContent).toBe('');
  });

  it('shows nothing before the bootstrap has loaded', () => {
    store.current = { ...base, boot: null };
    render(<SheetNotices />);
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });
});

describe('SheetNotices: update banner', () => {
  it('shows the update banner when this page is current', () => {
    update.current = available;
    store.current = { ...base, boot: { appVersion: '0.6.0' } };
    render(<SheetNotices />);
    expect(screen.getAllByText('TDS Brain 0.7.0 is available.').length).toBeGreaterThan(0);
  });

  it('hides the lost-connection line while the update restarts the server', () => {
    update.current = { ...available, restarting: true };
    store.current = { ...base, streamUp: false, boot: { appVersion: '0.6.0' } };
    render(<SheetNotices />);
    expect(screen.queryByText(/Lost touch/)).toBeNull();
  });

  it('shows only Reload when the page is already outdated', () => {
    update.current = available;
    store.current = { ...base, boot: { appVersion: '0.7.0' } };
    render(<SheetNotices />);
    expect(screen.queryByText('TDS Brain 0.7.0 is available.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});
