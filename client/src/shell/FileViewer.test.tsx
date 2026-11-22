// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryItem } from '../../../shared/contract.ts';
import type { ViewerRequest } from './contract.ts';

const h = vi.hoisted(() => ({ openView: vi.fn(), openLibraryItem: vi.fn(), libraryVersion: 0 }));
const api = vi.hoisted(() => ({ libraryText: vi.fn(), libraryItems: vi.fn() }));
vi.mock('../api.ts', () => ({ api }));
vi.mock('../store.tsx', () => ({
  useToolSnapshot: () => ({ ads: null }),
  useStore: () => ({
    libraryVersion: h.libraryVersion,
    openView: h.openView,
    view: 'chat',
    activeChat: { kind: 'none' },
  }),
}));
vi.mock('../apps/shared/search.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openLibraryItem: h.openLibraryItem,
}));

const { FileViewer } = await import('./FileViewer.tsx');
const { ShellProvider, useShell } = await import('./ShellProvider.tsx');

const item = (over: Partial<LibraryItem> = {}): LibraryItem =>
  ({
    id: 'client:acme.1',
    kind: 'document',
    format: 'doc',
    ext: 'md',
    group: 'Reports',
    name: 'audit.md',
    title: 'Audit',
    path: 'clients/acme/reports/audit.md',
    bytes: 10,
    modified: '2026-11-13T10:00:00.000Z',
    width: null,
    height: null,
    thumb: false,
    view: 'text',
    ...over,
  }) as LibraryItem;

const request: ViewerRequest = {
  item: item(),
  place: 'Acme Heating',
  openIn: { app: 'documents', scope: 'client:acme' },
};

let viewing = false;
let panelOpen = false;
let shownItem: LibraryItem | null = null;
let close: () => void = () => {};
// Stands in for the part of the app that opens the viewer: a button that keeps focus as it asks.
// Shuts the opener's part of the page (as a panel shutting underneath the viewer would).
let setShut: (on: boolean) => void = () => {};
function Opener({ ask = request, gone = false }: { ask?: ViewerRequest; gone?: boolean }) {
  const { state, dispatch } = useShell();
  const [shut, setShutState] = useState(false);
  setShut = setShutState;
  viewing = state.viewer !== null;
  panelOpen = state.panelOpen;
  shownItem = state.viewer !== null && state.viewer.kind !== 'page' ? state.viewer.item : null;
  close = () => dispatch({ type: 'close-viewer' });
  return (
    <main id="main" tabIndex={-1}>
      <div inert={shut}>
        {gone && viewing ? null : (
          <button type="button" onClick={() => dispatch({ type: 'open-viewer', viewer: ask })}>
            Open it
          </button>
        )}
      </div>
    </main>
  );
}

function renderViewer(props: { ask?: ViewerRequest; gone?: boolean } = {}) {
  return render(
    <ShellProvider>
      <Opener {...props} />
      <FileViewer />
    </ShellProvider>,
  );
}

const openIt = () => {
  const button = screen.getByRole('button', { name: 'Open it' });
  button.focus();
  fireEvent.click(button);
  return button;
};

beforeEach(() => {
  api.libraryText.mockResolvedValue({ text: 'Body text', truncated: false });
  h.openView.mockReset();
  h.openLibraryItem.mockReset();
  h.libraryVersion = 0;
  api.libraryItems.mockReset();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the file viewer', () => {
  it('shows nothing until a file is asked for', () => {
    renderViewer();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a dialog named by the file, with where it is, its body, Download and the way on', async () => {
    renderViewer();
    openIt();
    const dialog = screen.getByRole('dialog', { name: 'Audit' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByText('Acme Heating')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Download audit.md' }).getAttribute('download')).toBe(
      'audit.md',
    );
    expect(within(dialog).getByRole('button', { name: 'Open in Documents' })).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByText('Body text')).toBeTruthy());
    expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'Audit' }));
  });

  it('Close puts focus back on what opened it', () => {
    renderViewer();
    const button = openIt();
    fireEvent.click(screen.getByRole('button', { name: 'Close file' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('Esc closes it, and other single keys do nothing behind it', () => {
    renderViewer();
    const button = openIt();
    const heading = screen.getByRole('heading', { name: 'Audit' });
    fireEvent.keyDown(heading, { key: 't' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(heading, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('a click on the veil closes it', () => {
    renderViewer();
    openIt();
    const veil = document.querySelector('.viewer-veil');
    expect(veil?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(veil as Element);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lands on the sheet when what opened it has gone', () => {
    renderViewer({ gone: true });
    openIt();
    expect(screen.queryByRole('button', { name: 'Open it' })).toBeNull();
    act(() => close());
    expect(document.activeElement).toBe(document.getElementById('main'));
  });

  it('lands on the sheet when what opened it is still there but out of reach', () => {
    renderViewer();
    openIt();
    act(() => setShut(true));
    act(() => close());
    expect(document.activeElement).toBe(document.getElementById('main'));
  });

  it('the file body is a named region the keyboard can reach, to scroll a long file', () => {
    renderViewer();
    openIt();
    const body = screen.getByRole('region', { name: 'Contents of Audit' });
    expect(body.tabIndex).toBe(0);
  });

  it('Open in Documents closes it and opens the file in the app, with its details panel showing', () => {
    renderViewer();
    openIt();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Documents' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.openLibraryItem).toHaveBeenCalledWith('documents', 'client:acme', request.item);
    expect(h.openView).toHaveBeenCalledWith('app:documents');
    expect(panelOpen).toBe(true);
  });

  it('offers no way on when the caller names no app, and says when a type cannot be shown', () => {
    renderViewer({ ask: { item: item({ view: null, name: 'n.xlsx', title: 'Numbers' }) } });
    openIt();
    const dialog = screen.getByRole('dialog', { name: 'Numbers' });
    expect(within(dialog).queryByRole('button', { name: /Open in/ })).toBeNull();
    expect(within(dialog).getByText("This type can't be shown here. Download it to open it.")).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Download n.xlsx' })).toBeTruthy();
    expect(api.libraryText).not.toHaveBeenCalled();
  });

  it('shows a PDF in the browser reader, full width', () => {
    renderViewer({
      ask: { item: item({ id: 'p1', view: 'pdf', ext: 'pdf', format: 'pdf', title: 'Report' }) },
    });
    openIt();
    const frame = screen.getByTitle('Report');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('src')).toContain('#navpanes=0&view=FitH');
  });

  it('swaps in a newer copy of the open file when the library changes, wherever it was opened from', async () => {
    const pageItem = item({ id: 'p2', view: 'page', ext: 'html', title: 'Explainer' });
    const view = renderViewer({ ask: { item: pageItem, place: 'Acme Heating' } });
    openIt();
    // Opening it asks nothing more of the server.
    expect(api.libraryItems).not.toHaveBeenCalled();
    const frame = screen.getByTitle('Explainer');
    const newer = { ...pageItem, modified: '2026-11-20T10:00:00.000Z' };
    api.libraryItems.mockResolvedValue({
      files: [{ item: newer, scope: { id: 'client:acme', name: 'Acme Heating' } }],
    });
    h.libraryVersion = 1;
    view.rerender(
      <ShellProvider>
        <Opener ask={{ item: pageItem, place: 'Acme Heating' }} />
        <FileViewer />
      </ShellProvider>,
    );
    await waitFor(() => expect(screen.getByTitle('Explainer')).not.toBe(frame));
    expect(api.libraryItems).toHaveBeenCalledWith(['p2']);
    // Still the same drawer, place line and all.
    expect(within(screen.getByRole('dialog', { name: 'Explainer' })).getByText('Acme Heating')).toBeTruthy();
  });

  it('keeps the copy on screen when the newer one cannot be fetched', async () => {
    const view = renderViewer();
    openIt();
    api.libraryItems.mockRejectedValue(new Error('offline'));
    h.libraryVersion = 1;
    view.rerender(
      <ShellProvider>
        <Opener />
        <FileViewer />
      </ShellProvider>,
    );
    await waitFor(() => expect(api.libraryItems).toHaveBeenCalled());
    expect(screen.getByRole('dialog', { name: 'Audit' })).toBeTruthy();
  });

  const rerenderWith = (view: ReturnType<typeof renderViewer>, ask: ViewerRequest) =>
    view.rerender(
      <ShellProvider>
        <Opener ask={ask} />
        <FileViewer />
      </ShellProvider>,
    );

  it("keeps the opener's choice on deleting when a newer copy comes (no bin on an Ad Manager report)", async () => {
    const report = item({ id: 'r1', view: 'pdf', ext: 'pdf', title: 'Report', canDelete: false });
    const ask = { kind: 'file' as const, item: report };
    const view = renderViewer({ ask });
    openIt();
    const newer = { ...report, modified: '2026-11-20T10:00:00.000Z', canDelete: true };
    api.libraryItems.mockResolvedValue({
      files: [{ item: newer, scope: { id: 'client:acme', name: 'Acme' } }],
    });
    h.libraryVersion = 1;
    rerenderWith(view, ask);
    await waitFor(() => expect(shownItem?.modified).toBe(newer.modified));
    expect(shownItem?.canDelete).toBe(false);
    expect(screen.queryByRole('button', { name: /^Delete file/ })).toBeNull();
  });

  it('changes nothing when the file has not changed', async () => {
    const view = renderViewer();
    openIt();
    const before = shownItem;
    api.libraryItems.mockResolvedValue({
      files: [{ item: { ...request.item, canDelete: true }, scope: { id: 'x', name: 'X' } }],
    });
    h.libraryVersion = 1;
    rerenderWith(view, request);
    await waitFor(() => expect(api.libraryItems).toHaveBeenCalled());
    await act(async () => {});
    expect(shownItem).toBe(before);
  });

  it('drops a late answer about a file that is no longer shown', async () => {
    const view = renderViewer();
    openIt();
    let answer: (v: unknown) => void = () => {};
    api.libraryItems.mockReturnValue(new Promise((r) => (answer = r)));
    h.libraryVersion = 1;
    rerenderWith(view, request);
    await waitFor(() => expect(api.libraryItems).toHaveBeenCalled());
    act(() => close());
    await act(async () => {
      answer({ files: [{ item: { ...request.item, modified: 'later' }, scope: { id: 'x', name: 'X' } }] });
    });
    expect(viewing).toBe(false);
  });
});
