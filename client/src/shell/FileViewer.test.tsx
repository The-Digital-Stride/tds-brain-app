// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryItem } from '../../../shared/contract.ts';
import type { ViewerRequest } from './contract.ts';

const h = vi.hoisted(() => ({ openView: vi.fn(), openLibraryItem: vi.fn() }));
const api = vi.hoisted(() => ({ libraryText: vi.fn() }));
vi.mock('../api.ts', () => ({ api }));
vi.mock('../store.tsx', () => ({
  useStore: () => ({ libraryVersion: 0, openView: h.openView, view: 'chat', activeChat: { kind: 'none' } }),
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
let close: () => void = () => {};
// Stands in for the part of the app that opens the viewer: a button that keeps focus as it asks.
// Shuts the opener's part of the page (as a panel shutting underneath the viewer would).
let setShut: (on: boolean) => void = () => {};
function Opener({ ask = request, gone = false }: { ask?: ViewerRequest; gone?: boolean }) {
  const { state, dispatch } = useShell();
  const [shut, setShutState] = useState(false);
  setShut = setShutState;
  viewing = state.viewer !== null;
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

  it('Open in Documents closes it and opens the file in the app', () => {
    renderViewer();
    openIt();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Documents' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.openLibraryItem).toHaveBeenCalledWith('documents', 'client:acme', request.item);
    expect(h.openView).toHaveBeenCalledWith('app:documents');
    expect(document.activeElement).toBe(document.getElementById('main'));
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
});
