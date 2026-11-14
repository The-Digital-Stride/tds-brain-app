// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../../../shared/contract.ts';
import type { ChatPage } from '../../../shared/pages-contract.ts';

const h = vi.hoisted(() => ({
  pages: [] as unknown[],
  sessionState: 'idle' as string,
  skills: [{ name: 'tds-doc' }] as { name: string }[],
  askPage: vi.fn(),
  openChat: vi.fn(),
}));
vi.mock('../store.tsx', () => ({
  useStore: () => ({
    chats: {
      s1: { files: { files: [], attachments: [], links: [], pages: h.pages }, sessionState: h.sessionState },
    },
    sessions: { live: [{ id: 's1', state: h.sessionState }], past: [] },
    boot: { skills: h.skills },
    askPage: h.askPage,
    openChat: h.openChat,
    libraryVersion: 0,
    openView: () => {},
  }),
}));

const { PageStage, pageFormState, versionLabel } = await import('./PageStage.tsx');
const { FileViewer } = await import('./FileViewer.tsx');
const { ShellProvider, useShell } = await import('./ShellProvider.tsx');

const page = (over: Partial<ChatPage> = {}): ChatPage => ({
  key: 'pg1',
  title: 'Quarterly page',
  url: 'https://claude.ai/artifact/abc123',
  versions: [{ n: 1, remote: null, at: null, hasCopy: true }],
  live: false,
  multiFile: false,
  toolUseIds: [],
  order: 1,
  ...over,
});
const v = (n: number, over: Record<string, unknown> = {}) => ({
  n,
  remote: null,
  at: null,
  hasCopy: true,
  ...over,
});

function Open() {
  const { dispatch } = useShell();
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'open-viewer', viewer: { kind: 'page', chat: 's1', key: 'pg1' } })}
    >
      Open it
    </button>
  );
}
function mount() {
  const view = render(
    <ShellProvider>
      <Open />
      <FileViewer />
    </ShellProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
  return view;
}
const rerenderWith = (view: ReturnType<typeof mount>) =>
  view.rerender(
    <ShellProvider>
      <Open />
      <FileViewer />
    </ShellProvider>,
  );

beforeEach(() => {
  h.pages = [page()];
  h.sessionState = 'idle';
  h.skills = [{ name: 'tds-doc' }];
  h.askPage.mockReset();
  h.askPage.mockResolvedValue(null);
  h.openChat.mockReset();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('pageFormState', () => {
  const st = (s: SessionState | null, asked: { versions: number; sawBusy: boolean } | null = null, n = 1) =>
    pageFormState(s, asked, n);
  it('maps the chat state', () => {
    expect(st('idle')).toBe('ready');
    expect(st('error')).toBe('ready');
    expect(st('working')).toBe('running');
    expect(st('starting')).toBe('running');
    expect(st('waiting')).toBe('waiting');
    expect(st('closed')).toBe('closed');
    expect(st(null)).toBe('ready');
  });
  it('after asking: running until Claude has started, then replied unless a new version came', () => {
    expect(st('idle', { versions: 1, sawBusy: false })).toBe('running');
    expect(st('idle', { versions: 1, sawBusy: true })).toBe('replied');
    expect(st('idle', { versions: 1, sawBusy: true }, 2)).toBe('ready');
  });
  it('labels versions with the remote number when there is one', () => {
    expect(versionLabel(v(2, { remote: 3 }), 1, 3)).toBe('Version 3');
    expect(versionLabel(v(2), 1, 3)).toBe('Version 2 of 3');
  });
});

describe('the page viewer', () => {
  it('shows the page in a locked-down frame with its title, place and links out', () => {
    mount();
    const dialog = screen.getByRole('dialog', { name: 'Quarterly page' });
    expect(dialog).toBeTruthy();
    expect(screen.getByText('Page from this chat')).toBeTruthy();
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-popups');
    expect(frame.getAttribute('src')).toBe('/api/sessions/s1/pages/pg1/1');
    expect(frame.getAttribute('title')).toBeTruthy();
    const open = screen.getByRole('link', { name: /Open on claude.ai/ });
    expect(open.getAttribute('href')).toBe('https://claude.ai/artifact/abc123');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('picks between versions and follows a new one when on the newest', () => {
    h.pages = [page({ versions: [v(1, { remote: 1 }), v(2, { remote: 2 })] })];
    const view = mount();
    const select = screen.getByLabelText('Version') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Version 1', 'Version 2']);
    expect(select.value).toBe('2');
    h.pages = [page({ versions: [v(1, { remote: 1 }), v(2, { remote: 2 }), v(3, { remote: 3 })] })];
    rerenderWith(view);
    expect((document.querySelector('iframe') as HTMLIFrameElement).getAttribute('src')).toBe(
      '/api/sessions/s1/pages/pg1/3',
    );
    expect(screen.getAllByRole('status').some((e) => e.textContent === 'Updated')).toBe(true);
  });

  it('stays on an older version the person chose when a new one arrives', () => {
    h.pages = [page({ versions: [v(1), v(2)] })];
    const view = mount();
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: '1' } });
    h.pages = [page({ versions: [v(1), v(2), v(3)] })];
    rerenderWith(view);
    expect((document.querySelector('iframe') as HTMLIFrameElement).getAttribute('src')).toBe(
      '/api/sessions/s1/pages/pg1/1',
    );
    expect(screen.queryByText('Updated')).toBeNull();
  });

  it('says so for live pages, multi-file pages and a version without a copy', () => {
    h.pages = [page({ live: true, multiFile: true, versions: [v(1, { hasCopy: false })] })];
    mount();
    expect(screen.getByText('Some parts of this page only work on claude.ai.')).toBeTruthy();
    expect(screen.getByText("Some files this page uses aren't shown here.")).toBeTruthy();
    expect(screen.getByText("This version isn't kept in the app. Open it on claude.ai.")).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('shows Convert to TDS branding only when tds-doc is among the skills', () => {
    h.skills = [];
    const view = mount();
    expect(screen.queryByRole('button', { name: 'Convert to TDS branding' })).toBeNull();
    cleanup();
    h.skills = [{ name: 'tds-doc' }];
    view.unmount();
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Convert to TDS branding' }));
    expect(h.askPage).toHaveBeenCalledWith('s1', 'pg1', { kind: 'brand' });
  });
});

describe('suggesting a change', () => {
  it('sends on Enter, keeps Shift+Enter for a new line, and clears the box', async () => {
    mount();
    const box = screen.getByLabelText('Suggest a change') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Make the heading blue' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(h.askPage).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() =>
      expect(h.askPage).toHaveBeenCalledWith('s1', 'pg1', { kind: 'change', note: 'Make the heading blue' }),
    );
    await waitFor(() => expect(box.value).toBe(''));
    // Sent: it now waits for Claude to start.
    expect(screen.getByText('Claude is working on this chat.')).toBeTruthy();
  });

  it('shows why a send failed and keeps the note', async () => {
    h.askPage.mockResolvedValue('Claude is busy.');
    mount();
    const box = screen.getByLabelText('Suggest a change') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Claude is busy.');
    expect(box.value).toBe('Hello');
  });

  it('disables the form while Claude works', () => {
    h.sessionState = 'working';
    mount();
    expect(screen.getByText('Claude is working on this chat.')).toBeTruthy();
    expect((screen.getByLabelText('Suggest a change') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('points to the chat when Claude needs an answer, and Go to chat closes the viewer', () => {
    h.sessionState = 'waiting';
    mount();
    expect(screen.getByText('Claude needs your answer in the chat.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to chat' }));
    expect(h.openChat).toHaveBeenCalledWith('s1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says Claude replied when a turn ends with no new version', async () => {
    const view = mount();
    fireEvent.change(screen.getByLabelText('Suggest a change'), { target: { value: 'Tweak' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Claude is working on this chat.')).toBeTruthy());
    h.sessionState = 'working';
    rerenderWith(view);
    h.sessionState = 'idle';
    rerenderWith(view);
    expect(await screen.findByText('Claude replied in the chat.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to chat' })).toBeTruthy();
  });

  it('offers only the reopen line for a closed chat', () => {
    h.sessionState = 'closed';
    mount();
    expect(screen.getByText('Reopen this chat to suggest changes.')).toBeTruthy();
    expect(screen.queryByLabelText('Suggest a change')).toBeNull();
  });
});

describe('PageStage on its own', () => {
  it('says the page is gone when the chat no longer lists it', () => {
    h.pages = [];
    const ref = { current: null };
    render(<PageStage chat="s1" pageKey="nope" headingId="h" headingRef={ref} onClose={() => {}} />);
    expect(screen.getByText('This page is no longer available.')).toBeTruthy();
    act(() => {});
  });
});
