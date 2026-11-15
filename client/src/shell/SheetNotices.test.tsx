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

const base = {
  streamUp: true,
  actionError: null,
  clearError: vi.fn(),
  notice: null,
  fileNotice: null,
  heldFiles: [] as { id: string; title: string; phase: string }[],
  undoDeleteFile: vi.fn(),
};

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
    expect(screen.getByTestId('update-status').textContent).toContain('A new version of TDS Cortex is ready');
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
    expect(screen.getAllByText('TDS Cortex 0.7.0 is available.').length).toBeGreaterThan(0);
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
    expect(screen.queryByText('TDS Cortex 0.7.0 is available.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});

describe('SheetNotices: library deletes waiting out their Undo', () => {
  it('lists each waiting file wherever the delete started, and Undo brings one back', () => {
    const undoDeleteFile = vi.fn();
    store.current = {
      ...base,
      boot: null,
      undoDeleteFile,
      heldFiles: [
        { id: 'client:acme.1', title: 'Acme logo', phase: 'waiting' },
        { id: 'client:acme.2', title: 'Old audit', phase: 'sending' },
      ],
    };
    render(<SheetNotices />);
    expect(screen.getByText('Acme logo deleted.')).toBeTruthy();
    // A file already being sent has no Undo left.
    expect(screen.queryByText('Old audit deleted.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo deleting Acme logo' }));
    expect(undoDeleteFile).toHaveBeenCalledWith('client:acme.1');
  });

  it('has one status line always on the page: empty, then the delete, then the result', () => {
    store.current = { ...base, boot: null, heldFiles: [] };
    const { rerender } = render(<SheetNotices />);
    const status = screen.getByTestId('file-delete-status');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toBe('');
    store.current = {
      ...base,
      boot: null,
      heldFiles: [{ id: 'a', title: 'acme-logo.png', phase: 'waiting' }],
    };
    rerender(<SheetNotices />);
    // The same element, now holding the words, so a screen reader announces them.
    expect(screen.getByTestId('file-delete-status')).toBe(status);
    expect(status.textContent).toBe('acme-logo.png deleted. Undo is at the top of the page.');
    store.current = {
      ...base,
      boot: null,
      heldFiles: [],
      notice: 'acme-logo.png deleted. Kept 30 days.',
      fileNotice: 'acme-logo.png deleted. Kept 30 days.',
    };
    rerender(<SheetNotices />);
    expect(screen.getByTestId('file-delete-status')).toBe(status);
    expect(status.textContent).toBe('acme-logo.png deleted. Kept 30 days.');
  });

  it('stops the clock while the pointer or focus is on a held line, and starts it when they leave', () => {
    const pauseFileDelete = vi.fn();
    const resumeFileDelete = vi.fn();
    store.current = {
      ...base,
      boot: null,
      pauseFileDelete,
      resumeFileDelete,
      heldFiles: [{ id: 'a', title: 'Acme logo', phase: 'waiting' }],
    };
    render(<SheetNotices />);
    const line = screen.getByText('Acme logo deleted.').parentElement as HTMLElement;
    fireEvent.mouseEnter(line);
    expect(pauseFileDelete).toHaveBeenCalledWith('a');
    fireEvent.mouseLeave(line);
    expect(resumeFileDelete).toHaveBeenCalledWith('a');
    resumeFileDelete.mockClear();
    const undo = screen.getByRole('button', { name: 'Undo deleting Acme logo' });
    fireEvent.focus(undo);
    expect(pauseFileDelete).toHaveBeenCalledTimes(2);
    fireEvent.blur(undo, { relatedTarget: document.body });
    expect(resumeFileDelete).toHaveBeenCalledWith('a');
  });

  it('keeps the clock stopped while focus is on Undo, even when the pointer passes over and leaves', () => {
    const pauseFileDelete = vi.fn();
    const resumeFileDelete = vi.fn();
    store.current = {
      ...base,
      boot: null,
      pauseFileDelete,
      resumeFileDelete,
      heldFiles: [{ id: 'a', title: 'Acme logo', phase: 'waiting' }],
    };
    render(<SheetNotices />);
    const line = screen.getByText('Acme logo deleted.').parentElement as HTMLElement;
    const undo = screen.getByRole('button', { name: 'Undo deleting Acme logo' });
    fireEvent.focus(undo);
    fireEvent.mouseEnter(line);
    fireEvent.mouseLeave(line);
    expect(pauseFileDelete).toHaveBeenCalledTimes(1);
    expect(resumeFileDelete).not.toHaveBeenCalled();
    // The other way round: pointer on, focus in and out, pointer still there.
    fireEvent.mouseEnter(line);
    fireEvent.blur(undo, { relatedTarget: document.body });
    expect(resumeFileDelete).not.toHaveBeenCalled();
    fireEvent.mouseLeave(line);
    expect(resumeFileDelete).toHaveBeenCalledTimes(1);
  });
});
