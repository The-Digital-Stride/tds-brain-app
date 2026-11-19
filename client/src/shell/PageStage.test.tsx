// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../../../shared/contract.ts';
import type { ChatPage } from '../../../shared/pages-contract.ts';

const h = vi.hoisted(() => ({
  pages: [] as unknown[],
  sessionState: 'idle' as string,
  files: [] as unknown[],
  askPage: vi.fn(),
  openChat: vi.fn(),
  run: vi.fn(async (action: () => Promise<unknown>) => {
    await action();
    return true;
  }),
}));
vi.mock('../store.tsx', () => ({
  useToolSnapshot: () => ({ ads: null }),
  useStore: () => ({
    chats: {
      s1: {
        files: { files: h.files, attachments: [], links: [], pages: h.pages },
        sessionState: h.sessionState,
      },
    },
    sessions: { live: [{ id: 's1', state: h.sessionState }], past: [] },
    askPage: h.askPage,
    openChat: h.openChat,
    run: h.run,
    libraryVersion: 0,
    openView: () => {},
  }),
}));

const { api } = await import('../api.ts');
const { PageStage, pageFormState, versionLabel, writeMark } = await import('./PageStage.tsx');
const { FileViewer } = await import('./FileViewer.tsx');
const { ShellProvider, useShell } = await import('./ShellProvider.tsx');

const page = (over: Partial<ChatPage> = {}): ChatPage => ({
  key: 'pg1',
  title: 'Quarterly page',
  url: 'https://claude.ai/artifact/abc123',
  versions: [{ n: 1, remote: null, at: null, hasCopy: true }],
  draft: false,
  fileKey: null,
  live: false,
  multiFile: false,
  toolUseIds: [],
  order: 1,
  ...over,
});
// The status line above the box (the box repeats the reason for screen readers).
const LINE = { selector: '.page-ask-line' };
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
  h.files = [];
  h.askPage.mockReset();
  h.askPage.mockResolvedValue(null);
  h.openChat.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
  localStorage.clear();
});

describe('pageFormState', () => {
  const st = (s: SessionState | null, asked: { mark: string; sawBusy: boolean } | null = null, mark = 'w1') =>
    pageFormState(s, asked, mark);
  it('maps the chat state', () => {
    expect(st('idle')).toBe('ready');
    expect(st('error')).toBe('ready');
    expect(st('working')).toBe('running');
    expect(st('starting')).toBe('running');
    expect(st('waiting')).toBe('waiting');
    expect(st('closed')).toBe('closed');
    expect(st(null)).toBe('ready');
  });
  it('after asking: running until Claude has started, then replied unless Claude wrote the page', () => {
    expect(st('idle', { mark: 'w1', sawBusy: false })).toBe('running');
    expect(st('idle', { mark: 'w1', sawBusy: true })).toBe('replied');
    expect(st('idle', { mark: 'w1', sawBusy: true }, 'w2')).toBe('ready');
    // A chat already busy when the ask was made counts as seen.
    expect(st('idle', { mark: 'w1', sawBusy: true })).toBe('replied');
  });
  it('the write mark follows the newest step, not version numbers (filing a draft changes no mark)', () => {
    const base = {
      key: 'k',
      title: 't',
      url: null,
      versions: [],
      live: false,
      multiFile: false,
      order: 1,
      draft: true,
      fileKey: null,
    };
    expect(writeMark(null)).toBe('');
    expect(writeMark({ ...base, toolUseIds: [] })).toBe('');
    const drafted = { ...base, toolUseIds: ['a', 'b'] };
    const filed = { ...drafted, draft: false, versions: [{ n: 1, remote: null, at: null, hasCopy: true }] };
    expect(writeMark(filed)).toBe(writeMark(drafted));
    // A capped list still moves on: same length, newer last id.
    expect(writeMark({ ...base, toolUseIds: ['b', 'c'] })).not.toBe(writeMark(drafted));
  });
  it('labels versions with the remote number when there is one', () => {
    expect(versionLabel(v(2, { remote: 3 }), 1, 3)).toBe('Version 3');
    expect(versionLabel(v(2), 1, 3)).toBe('Version 2');
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
    h.pages = [page({ versions: [v(1, { remote: 1 }), v(2, { remote: 2 })], toolUseIds: ['w1', 'w2'] })];
    const view = mount();
    const select = screen.getByLabelText('Version') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Version 1', 'Version 2']);
    expect(select.value).toBe('2');
    h.pages = [
      page({
        versions: [v(1, { remote: 1 }), v(2, { remote: 2 }), v(3, { remote: 3 })],
        toolUseIds: ['w1', 'w2', 'w3'],
      }),
    ];
    rerenderWith(view);
    expect((document.querySelector('iframe') as HTMLIFrameElement).getAttribute('src')).toBe(
      '/api/sessions/s1/pages/pg1/3',
    );
    expect(screen.getAllByRole('status').some((e) => e.textContent === 'Page updated.')).toBe(true);
  });

  it("doesn't announce an update when only the draft was filed as a version (no new write)", () => {
    h.pages = [page({ draft: true, versions: [v(1)], toolUseIds: ['w1', 'w2'] })];
    const view = mount();
    h.pages = [page({ draft: false, versions: [v(1), v(2)], toolUseIds: ['w1', 'w2'] })];
    rerenderWith(view);
    expect(screen.queryByText('Page updated.')).toBeNull();
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
    expect(screen.queryByText(/^Updated/)).toBeNull();
  });

  it('says so for live pages, multi-file pages and a version without a copy', () => {
    h.pages = [page({ live: true, multiFile: true, versions: [v(1, { hasCopy: false })] })];
    mount();
    expect(screen.getByText('Some parts of this page only work on claude.ai.')).toBeTruthy();
    expect(screen.getByText("Some files this page uses aren't shown here.")).toBeTruthy();
    expect(screen.getByText("This version isn't kept in the app. Open it on claude.ai.")).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
  });

  const stubDownload = (headers: Record<string, string> = {}) => {
    const fetchMock = vi.fn(async () => new Response('<html></html>', { headers }));
    vi.stubGlobal('fetch', fetchMock);
    const created = vi.fn(() => 'blob:x');
    const revoked = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }));
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    return { fetchMock, names, click };
  };

  it('downloads with TDS branding whatever the chat is doing, then offers to file a copy', async () => {
    const { fetchMock, names } = stubDownload({
      'Content-Disposition': 'attachment; filename="Quarterly-tds.html"',
      'X-Page-Self-Contained': 'yes',
    });
    h.sessionState = 'working';
    const view = mount();
    const dl = screen.getByRole('button', { name: 'Download with TDS branding' });
    expect(screen.queryByRole('button', { name: "File in client's folder" })).toBeNull();
    h.sessionState = 'idle';
    rerenderWith(view);
    fireEvent.click(screen.getByRole('button', { name: 'Download with TDS branding' }));
    expect(dl).toBeTruthy();
    expect(await screen.findByText("Downloaded. Want a copy filed in the client's folder too?")).toBeTruthy();
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/sessions/s1/pages/pg1/1/branded');
    expect(names).toEqual(['Quarterly-tds.html']);
    expect(h.askPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: "File in client's folder" }));
    expect(h.askPage).toHaveBeenCalledWith('s1', 'pg1', { kind: 'brand' });
    expect(await screen.findByText('Asked Claude to file the TDS-branded copy.')).toBeTruthy();
  });

  it('says some parts still need the internet when the copy is partial, and falls back to a file name', async () => {
    const { names } = stubDownload({ 'X-Page-Self-Contained': 'partial' });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Download with TDS branding' }));
    expect(
      await screen.findByText(
        "Downloaded. Some parts still need the internet to show. Want a copy filed in the client's folder too?",
      ),
    ).toBeTruthy();
    expect(names).toEqual(['Quarterly page-tds.html']);
  });

  it('shows an error when the download fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 500 })),
    );
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Download with TDS branding' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/download/i);
    expect(screen.queryByText(/Downloaded\./)).toBeNull();
  });

  it('calls the draft "Latest", without the working notice, once Claude has finished', () => {
    h.pages = [page({ draft: true, versions: [v(1)] })];
    mount();
    expect(screen.queryByText('Claude is still working on this page.')).toBeNull();
    const select = screen.getByLabelText('Version') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Version 1', 'Latest']);
  });

  it('shows the in-progress copy as version 0 and moves to the numbered one at the boundary', () => {
    h.sessionState = 'working';
    h.pages = [page({ draft: true, versions: [] })];
    const view = mount();
    expect(screen.getByText('Claude is still working on this page.')).toBeTruthy();
    expect((document.querySelector('iframe') as HTMLIFrameElement).getAttribute('src')).toBe(
      '/api/sessions/s1/pages/pg1/0',
    );
    h.pages = [page({ draft: false, versions: [v(1)] })];
    rerenderWith(view);
    expect(screen.queryByText('Claude is still working on this page.')).toBeNull();
    expect((document.querySelector('iframe') as HTMLIFrameElement).getAttribute('src')).toBe(
      '/api/sessions/s1/pages/pg1/1',
    );
  });

  it('reloads the frame when the draft is written again', () => {
    h.pages = [page({ draft: true, versions: [], order: 1 })];
    const view = mount();
    const first = document.querySelector('iframe');
    h.pages = [page({ draft: true, versions: [], order: 2 })];
    rerenderWith(view);
    expect(document.querySelector('iframe')).not.toBe(first);
  });

  it('stops a page that navigates itself and can show it again', () => {
    mount();
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    fireEvent.load(frame);
    expect(document.querySelector('iframe')).toBe(frame);
    fireEvent.load(frame);
    expect(document.querySelector('iframe')).toBeNull();
    expect(
      screen.getByText('This page tried to move the viewer to another site, so it was stopped.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show the page again' }));
    expect(document.querySelector('iframe')).not.toBeNull();
  });

  it('opens a link the page sends after a click in a new tab, and keeps the page', () => {
    mount();
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    frame.focus();
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: true } });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      const data = { type: 'tds-page-open-link', url: 'https://example.com/' };
      window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }));
      expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
      expect(document.querySelector('iframe')).toBe(frame);
    } finally {
      open.mockRestore();
      Reflect.deleteProperty(navigator, 'userActivation');
    }
  });

  it('offers Open in Documents for a page with a source file, and says nothing of claude.ai without a link', () => {
    h.pages = [page({ url: null, fileKey: 'k1', versions: [v(1, { hasCopy: false })] })];
    h.files = [{ key: 'k1', item: { id: 'i' }, scope: { id: 'sc', name: 'S' } }];
    mount();
    expect(screen.getByRole('button', { name: 'Open in Documents' })).toBeTruthy();
    expect(screen.getByText("This version isn't kept in the app.")).toBeTruthy();
    expect(screen.queryByText(/claude\.ai/)).toBeNull();
  });

  it('leaves the version out of the frame title when there is only one', () => {
    mount();
    expect((document.querySelector('iframe') as HTMLIFrameElement).getAttribute('title')).toBe(
      'Page: Quarterly page',
    );
  });
});

describe('asking while the chat state changes during the send', () => {
  it('counts a chat that went busy and finished while askPage was open as replied', async () => {
    let resolve: (v: string | null) => void = () => {};
    h.askPage.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const view = mount();
    const box = screen.getByLabelText('Suggest a change') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Make it blue' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    h.sessionState = 'working';
    rerenderWith(view);
    h.sessionState = 'idle';
    rerenderWith(view);
    await act(async () => resolve(null));
    expect(await screen.findByText('Claude replied in the chat.')).toBeTruthy();
  });

  it('treats a waiting chat as working for the draft', () => {
    h.sessionState = 'waiting';
    h.pages = [page({ draft: true, versions: [] })];
    mount();
    expect(screen.getByText('Claude is still working on this page.')).toBeTruthy();
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
    expect(screen.getByText('Claude is working on this chat.', LINE)).toBeTruthy();
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

  it('while Claude works: the box is locked, its ring is the working colour and Send is a red Stop', async () => {
    const interrupt = vi.spyOn(api, 'interrupt').mockResolvedValue({ ok: true });
    h.sessionState = 'working';
    mount();
    expect(screen.getByText('Claude is working on this chat.', LINE)).toBeTruthy();
    const box = screen.getByLabelText('Suggest a change') as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);
    expect(box.getAttribute('aria-disabled')).toBe('true');
    expect(box.getAttribute('aria-describedby')).toBeTruthy();
    // The chat's own message box, so it looks and acts the same.
    expect(box.closest('.composer')?.getAttribute('data-attention')).toBe('working');
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop.getAttribute('data-variant')).toBe('stop');
    fireEvent.click(stop);
    await waitFor(() => expect(interrupt).toHaveBeenCalledWith('s1'));
    expect(h.askPage).not.toHaveBeenCalled();
    interrupt.mockRestore();
  });

  it('has the ready ring and Send when the chat is idle, and asks for an answer with the asking ring', () => {
    mount();
    const box = screen.getByLabelText('Suggest a change') as HTMLTextAreaElement;
    expect(box.closest('.composer')?.getAttribute('data-attention')).toBe('ready');
    expect(box.maxLength).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    cleanup();
    h.sessionState = 'waiting';
    mount();
    expect(
      (screen.getByLabelText('Suggest a change') as HTMLTextAreaElement)
        .closest('.composer')
        ?.getAttribute('data-attention'),
    ).toBe('asking');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('points to the chat when Claude needs an answer, and Go to chat closes the viewer', () => {
    h.sessionState = 'waiting';
    mount();
    expect(screen.getByText('Claude needs your answer in the chat.', LINE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to chat' }));
    expect(h.openChat).toHaveBeenCalledWith('s1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says Claude replied when a turn ends with no new version', async () => {
    const view = mount();
    fireEvent.change(screen.getByLabelText('Suggest a change'), { target: { value: 'Tweak' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Claude is working on this chat.', LINE)).toBeTruthy());
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
