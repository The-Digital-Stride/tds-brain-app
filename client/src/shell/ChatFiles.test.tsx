// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatFile, ChatFilesSnapshot, LibraryItem } from '../../../shared/contract.ts';
import type { ShellState } from './contract.ts';

const h = vi.hoisted(() => ({
  files: { files: [], attachments: [], links: [] } as unknown,
  sessionState: 'idle' as string,
  libraryVersion: 0,
}));
const api = vi.hoisted(() => ({
  libraryText: vi.fn(),
  chatFileChanges: vi.fn(),
}));
vi.mock('../api.ts', () => ({
  api,
  ApiFailure: class ApiFailure extends Error {
    status = 404;
  },
}));
vi.mock('../store.tsx', () => ({
  useStore: () => ({
    chats: { s1: { files: h.files, sessionState: h.sessionState } },
    sessions: { live: [{ id: 's1', state: h.sessionState }], past: [] },
    libraryVersion: h.libraryVersion,
    openView: () => {},
  }),
}));

const { ChatFiles } = await import('./ChatFiles.tsx');
const { ShellProvider, useShell } = await import('./ShellProvider.tsx');

const scope = { id: 'client:acme', name: 'Acme Heating', kind: 'client' as const };

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

const file = (key: string, actions: ChatFile['actions'], over: Partial<ChatFile> = {}): ChatFile => ({
  key,
  path: `clients/acme/${key}.md`,
  item: item({ id: key, title: `Title ${key}`, name: `${key}.md` }),
  scope,
  actions,
  toolUseIds: [],
  edits: 0,
  order: 1,
  ...over,
});

const set = (snap: Partial<ChatFilesSnapshot>) => {
  h.files = { files: [], attachments: [], links: [], ...snap };
};

function renderTab() {
  return render(
    <ShellProvider>
      <ChatFiles sessionId="s1" />
    </ShellProvider>,
  );
}

beforeEach(() => {
  h.sessionState = 'idle';
  set({});
  api.libraryText.mockReset();
  api.libraryText.mockResolvedValue({ text: '# Hello\n\nBody text', truncated: false });
  api.chatFileChanges.mockReset();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

// Stands in for a reply link elsewhere in the shell: asks for the same file again.
let askAgain: () => void = () => {};
function Asker() {
  const { dispatch } = useShell();
  askAgain = () => dispatch({ type: 'show-chat-file', chat: 's1', key: 'made1' });
  return <button type="button">elsewhere</button>;
}

// Stands in for leaving the chat and coming back: the panel's contents unmount and mount again.
let setPanelShown: (on: boolean) => void = () => {};
function Toggle() {
  const [on, setOn] = useState(true);
  setPanelShown = setOn;
  return on ? <ChatFiles sessionId="s1" /> : null;
}

// Watches the shell's file viewer and stands in for a reply link asking for any file.
let viewerShown: ShellState['viewer'] = null;
let askFor: (key: string) => void = () => {};
function ViewerProbe() {
  const { state, dispatch } = useShell();
  viewerShown = state.viewer;
  askFor = (key) => dispatch({ type: 'show-chat-file', chat: 's1', key });
  return null;
}

const headings = () => Array.from(document.querySelectorAll('.fold-title')).map((e) => e.textContent);

describe('the Files tab list', () => {
  it('says so when there is nothing yet', () => {
    renderTab();
    expect(
      screen.getByText('No files yet. Files Claude reads, makes or names in this chat appear here.'),
    ).toBeTruthy();
  });

  it('shows the groups in order and folds Looked at when it is not the only group', () => {
    set({
      files: [
        file('read1', ['read']),
        file('ment1', ['mentioned']),
        file('made1', ['changed']),
        file('att1', ['filed']),
      ],
      attachments: [{ name: 'brief.pdf', kind: 'document', filedKey: 'att1' }],
      links: [{ url: 'https://example.com/page' }],
    });
    renderTab();
    expect(headings()).toEqual([
      'Made or changed',
      'Attached',
      'Mentioned in replies',
      'Looked at',
      'Web links',
    ]);
    expect(screen.getByRole('button', { name: /Looked at/ }).getAttribute('aria-expanded')).toBe('false');
    const row = screen.getByRole('button', { name: /Title made1/ });
    expect(row.textContent).toContain('Changed');
    expect(row.textContent).toContain('Acme Heating');
    expect(screen.getByRole('link', { name: /example\.com/ }).getAttribute('target')).toBe('_blank');
  });

  it('opens Looked at when it is the only group', () => {
    set({ files: [file('read1', ['read'])] });
    renderTab();
    expect(screen.getByRole('button', { name: /Looked at/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('says "Not filed yet" while a turn runs and "Not filed" after', () => {
    set({ attachments: [{ name: 'brief.pdf', kind: 'document', filedKey: null }] });
    h.sessionState = 'working';
    const first = renderTab();
    expect(screen.getByText('Not filed yet')).toBeTruthy();
    first.unmount();
    h.sessionState = 'idle';
    renderTab();
    expect(screen.getByText('Not filed')).toBeTruthy();
  });

  it('marks a file that is gone', () => {
    set({ files: [file('gone', ['changed'], { item: null })] });
    renderTab();
    expect(screen.getByRole('button', { name: /gone/ }).textContent).toContain('No longer there');
  });
});

describe('the preview', () => {
  const openRow = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

  it('shows a text file in the panel, announces it, and Escape goes back to the list', async () => {
    set({ files: [file('made1', ['created'])] });
    renderTab();
    openRow(/Title made1/);
    const region = screen.getByRole('region', { name: 'Preview of Title made1' });
    expect(within(region).getByRole('heading', { name: 'Title made1' })).toBeTruthy();
    expect(within(region).getByText('Acme Heating')).toBeTruthy();
    expect(screen.getAllByRole('status').map((e) => e.textContent)).toContain('Opened Title made1');
    await waitFor(() => expect(within(region).getByText('Body text')).toBeTruthy());
    expect(within(region).getByRole('link', { name: 'Download made1.md' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Open Title made1' })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(region).getByRole('heading', { name: 'Title made1' })),
    );

    fireEvent.keyDown(region, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: /Preview of/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Title made1/ }));
  });

  it('takes focus again when the same file is asked for again (a reply link after the panel shut)', async () => {
    set({ files: [file('made1', ['created'])] });
    render(
      <ShellProvider>
        <Asker />
        <ChatFiles sessionId="s1" />
      </ShellProvider>,
    );
    openRow(/Title made1/);
    const heading = () => screen.getByRole('heading', { name: 'Title made1' });
    await waitFor(() => expect(document.activeElement).toBe(heading()));
    screen.getByRole('button', { name: 'elsewhere' }).focus();
    act(() => askAgain());
    await waitFor(() => expect(document.activeElement).toBe(heading()));
  });

  it('does not take focus when the panel comes back on a file nobody asked for again (returning to the chat)', async () => {
    set({ files: [file('made1', ['created'])] });
    render(
      <ShellProvider>
        <Asker />
        <Toggle />
      </ShellProvider>,
    );
    openRow(/Title made1/);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Title made1' })),
    );
    const elsewhere = screen.getByRole('button', { name: 'elsewhere' });
    act(() => setPanelShown(false));
    elsewhere.focus();
    act(() => setPanelShown(true));
    expect(screen.getByRole('heading', { name: 'Title made1' })).toBeTruthy();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 30));
    expect(document.activeElement).toBe(elsewhere);
  });

  it('goes back with the All files button', () => {
    set({ files: [file('made1', ['created'])] });
    renderTab();
    openRow(/Title made1/);
    fireEvent.click(screen.getByRole('button', { name: 'All files' }));
    expect(screen.queryByRole('region', { name: /Preview of/ })).toBeNull();
  });

  it('Open shows the file in the viewer over the chat, with where it is and the way on to Documents', () => {
    set({ files: [file('made1', ['created'])] });
    render(
      <ShellProvider>
        <ViewerProbe />
        <ChatFiles sessionId="s1" />
      </ShellProvider>,
    );
    openRow(/Title made1/);
    fireEvent.click(screen.getByRole('button', { name: 'Open Title made1' }));
    expect(viewerShown).toMatchObject({
      item: { id: 'made1', title: 'Title made1' },
      place: 'Acme Heating',
      openIn: { app: 'documents', scope: 'client:acme' },
    });
    // The panel stays on the file underneath, so closing the viewer comes back to it.
    expect(screen.getByRole('region', { name: 'Preview of Title made1' })).toBeTruthy();
  });

  it('opens a picture with the way on to Images', () => {
    set({
      files: [
        file('pic', ['read'], {
          item: item({ id: 'pic', kind: 'image', view: 'image', title: 'Pic', name: 'pic.png', ext: 'png' }),
        }),
      ],
    });
    render(
      <ShellProvider>
        <ViewerProbe />
        <ChatFiles sessionId="s1" />
      </ShellProvider>,
    );
    act(() => askFor('pic'));
    fireEvent.click(screen.getByRole('button', { name: 'Open Pic' }));
    expect(viewerShown?.openIn).toEqual({ app: 'images', scope: 'client:acme' });
  });

  it('offers Open (and Download) for a PDF, with no body', () => {
    set({
      files: [
        file('report', ['created'], {
          item: item({
            id: 'report',
            ext: 'pdf',
            format: 'pdf',
            view: 'pdf',
            title: 'Report',
            name: 'report.pdf',
          }),
        }),
      ],
    });
    renderTab();
    openRow(/Report/);
    const region = screen.getByRole('region', { name: 'Preview of Report' });
    expect(within(region).getByRole('button', { name: 'Open Report' })).toBeTruthy();
    expect(region.querySelector('iframe')).toBeNull();
    expect(api.libraryText).not.toHaveBeenCalled();
  });

  it("says a type can't be shown, with Download and no Open", () => {
    set({
      files: [
        file('sheet', ['created'], {
          item: item({
            id: 'sheet',
            ext: 'xlsx',
            format: 'sheet',
            view: null,
            title: 'Numbers',
            name: 'n.xlsx',
          }),
        }),
      ],
    });
    renderTab();
    openRow(/Numbers/);
    const region = screen.getByRole('region', { name: 'Preview of Numbers' });
    expect(within(region).getByText("This type can't be shown here.")).toBeTruthy();
    expect(within(region).getByRole('link', { name: 'Download n.xlsx' })).toBeTruthy();
    expect(within(region).queryByRole('button', { name: /^Open/ })).toBeNull();
  });

  it('says "No longer there" for a gone file, with no buttons but Back', () => {
    set({ files: [file('gone', ['changed'], { item: null })] });
    renderTab();
    openRow(/gone/);
    const region = screen.getByRole('region', { name: 'Preview of gone.md' });
    expect(within(region).getByText('No longer there')).toBeTruthy();
    expect(
      within(region)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['All files']);
  });

  it('loads "What changed" newest first with its notes', async () => {
    api.chatFileChanges.mockResolvedValue({
      truncated: false,
      changes: [
        { at: null, tool: 'Write', change: { kind: 'new-file', parts: [] }, cut: null, hiddenChars: false },
        {
          at: null,
          tool: 'Edit',
          change: { kind: 'edit', parts: [] },
          cut: { lines: 5, chars: 9 },
          hiddenChars: true,
        },
      ],
    });
    set({ files: [file('made1', ['created', 'changed'], { edits: 2 })] });
    renderTab();
    openRow(/Title made1/);
    fireEvent.click(screen.getByRole('button', { name: 'What changed' }));
    await waitFor(() => expect(screen.getByText('This change was too long to show in full.')).toBeTruthy());
    expect(screen.getByText('Hidden characters are shown as ⟨U+…⟩ markers.')).toBeTruthy();
    expect(api.chatFileChanges).toHaveBeenCalledWith('s1', 'made1');
    // Newest (the Edit) comes first.
    expect(document.querySelectorAll('.files-change')[0]?.textContent).toContain('too long');
  });

  it('shows a quiet line, not an error, when the server has no changes (404)', async () => {
    const { ApiFailure } = await import('../api.ts');
    api.chatFileChanges.mockRejectedValue(new ApiFailure('not-found' as never, 'x', 404));
    set({ files: [file('made1', ['changed'], { edits: 1 })] });
    renderTab();
    openRow(/Title made1/);
    fireEvent.click(screen.getByRole('button', { name: 'What changed' }));
    await waitFor(() => expect(screen.getByText('The changes are no longer available.')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
