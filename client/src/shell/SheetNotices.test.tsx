// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../store.tsx', () => ({ useStore: () => store.current }));
vi.mock('../build-version.ts', async (orig) => ({
  ...(await orig<typeof import('../build-version.ts')>()),
  CLIENT_VERSION: '0.6.0',
}));

const { SheetNotices } = await import('./SheetNotices.tsx');

const base = { streamUp: true, actionError: null, clearError: vi.fn(), notice: null };

afterEach(() => {
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
