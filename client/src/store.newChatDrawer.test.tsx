// @vitest-environment jsdom
// An unsent chat in the chat drawer (plan 2026-11-26-project-chat-in-place, decisions 1 and 9): the real store, no shell.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
  startSession: vi.fn(),
  sendMessage: vi.fn(),
  updatePrefs: vi.fn(),
}));
vi.mock('./api.ts', () => ({ api, streamUrl: () => '/api/stream', ApiFailure: class extends Error {} }));

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
}

const { StoreProvider, useStore } = await import('./store.tsx');
const { keptDrafts } = await import('./state/kept-drafts.ts');
type StoreApi = ReturnType<typeof useStore>;

let store: StoreApi;
const seen: { drawer: string | null; unsent: number | null }[] = [];
function Probe() {
  store = useStore();
  seen.push({ drawer: store.chatDrawer, unsent: store.newChatDrawer });
  return null;
}

const boot = {
  appVersion: '0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  identity: { name: 'Sam', slug: 'sam', email: null, role: 'team', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [],
  clients: [],
  usedOften: [],
  prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false },
};

async function mount() {
  render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await waitFor(() => expect(store?.boot).not.toBeNull());
}
const PROJECTS = 'app:projects';
const picks = { project: 'acme/site' as const, client: 'acme' };

beforeEach(() => {
  window.localStorage.clear();
  keptDrafts.use('sam');
  keptDrafts.reload();
  seen.length = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.startSession.mockResolvedValue({ session: { id: 's9' } });
  api.updatePrefs.mockImplementation(async (patch: object) => ({ ...boot.prefs, ...patch }));
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('newChat in the drawer', () => {
  it('keeps the view on Projects and sets newChatDrawer', async () => {
    await mount();
    act(() => store.openView(PROJECTS));
    act(() => store.newChat({ in: 'drawer', project: 'acme/site', client: 'acme', draft: 'Hi' }));
    expect(store.view).toBe(PROJECTS);
    expect(store.activeChat).toMatchObject({
      kind: 'new',
      in: 'drawer',
      scope: 'chat',
      project: 'acme/site',
      draft: 'Hi',
    });
    expect(store.newChatDrawer).toBe(store.activeChat.kind === 'new' ? store.activeChat.key : -1);
    expect(store.chatDrawer).toBeNull();
  });

  it('works beside a tool too, and a drawer chat with no project is still chat-scoped', async () => {
    await mount();
    act(() => store.openTool('workbench', 'ad-manager'));
    act(() => store.newChat({ in: 'drawer' }));
    expect(store.view).toMatch(/^tool:/);
    expect(store.activeChat).toMatchObject({ in: 'drawer', scope: 'chat' });
    expect(store.newChatDrawer).not.toBeNull();
  });

  it("falls back to Home's chat on a view with no drawer", async () => {
    await mount();
    act(() => store.newChat({ in: 'drawer', project: 'acme/site' }));
    expect(store.view).toBe('chat');
    expect(store.activeChat).toMatchObject({ in: 'sheet', scope: 'chat', project: 'acme/site' });
    expect(store.newChatDrawer).toBeNull();
  });

  it("a chat without a project or drawer is Home's own (scope app)", async () => {
    await mount();
    expect(store.activeChat).toMatchObject({ in: 'sheet', scope: 'app' });
    act(() => store.newChat({ client: 'acme' }));
    expect(store.activeChat).toMatchObject({ in: 'sheet', scope: 'app' });
  });

  it('leaving Projects clears it into a fresh sheet chat', async () => {
    await mount();
    act(() => store.openView(PROJECTS));
    act(() => store.newChat({ in: 'drawer', project: 'acme/site', draft: 'Hi' }));
    act(() => store.openView('settings'));
    expect(store.newChatDrawer).toBeNull();
    expect(store.activeChat).toMatchObject({ kind: 'new', in: 'sheet', scope: 'app', draft: '' });
  });

  it('moving from Projects to a tool clears it too, though a drawer may sit beside a tool', async () => {
    await mount();
    act(() => store.openView(PROJECTS));
    act(() => store.newChat({ in: 'drawer', project: 'acme/site', draft: 'Hi' }));
    act(() => store.openTool('ads', 'ad-manager'));
    expect(store.view).toBe('tool:ads/ad-manager');
    expect(store.newChatDrawer).toBeNull();
    expect(store.activeChat).toMatchObject({ kind: 'new', in: 'sheet', draft: '' });
  });

  it('a second drawer chat takes the drawer with no question when no guard is registered', async () => {
    await mount();
    act(() => store.openView(PROJECTS));
    act(() => store.newChat({ in: 'drawer', project: 'acme/site' }));
    const first = store.newChatDrawer;
    act(() => store.newChat({ in: 'drawer', project: 'acme/other' }));
    expect(store.newChatDrawer).not.toBe(first);
    expect(store.newChatDrawer).not.toBeNull();
  });

  it('asks the drawer guard before a second drawer chat or a chat opened in the drawer', async () => {
    await mount();
    const held: (() => void)[] = [];
    act(() => store.setDrawerGuard((go) => void held.push(go)));
    act(() => store.openView(PROJECTS));
    // The first has nothing to ask about: no unsent chat in the drawer yet.
    act(() => store.newChat({ in: 'drawer', project: 'acme/site' }));
    expect(held).toHaveLength(0);
    const first = store.newChatDrawer;
    act(() => store.newChat({ in: 'drawer', project: 'acme/other' }));
    expect(held).toHaveLength(1);
    expect(store.newChatDrawer).toBe(first);
    act(() => store.openChat('s5', { in: 'drawer' }));
    expect(held).toHaveLength(2);
    expect(store.chatDrawer).toBeNull();
    act(() => held[1]?.());
    expect(store.chatDrawer).toBe('s5');
    expect(store.newChatDrawer).toBeNull();
  });

  it('starts nothing for the drawer until the guard says go, and nothing at all on Keep writing', async () => {
    await mount();
    const held: { go: () => void; cancel?: () => void }[] = [];
    act(() => store.setDrawerGuard((go, cancel) => void held.push({ go, cancel })));
    act(() => store.openView(PROJECTS));
    act(() => store.newChat({ in: 'drawer', project: 'acme/site' }));
    const unsent = store.newChatDrawer;
    api.startSession.mockClear();

    // Keep writing: no session is started, the unsent chat stays, and neither call reports a failure.
    let started: Promise<string | null> = Promise.resolve(null);
    act(() => {
      started = store.startChat('File the notes', 'acme', { open: true, in: 'drawer', project: 'acme/site' });
    });
    expect(held).toHaveLength(1);
    expect(api.startSession).not.toHaveBeenCalled();
    await act(async () => held[0]?.cancel?.());
    expect(await started).toBeNull();
    let opened: Promise<boolean> = Promise.resolve(false);
    act(() => {
      opened = store.openPast('sdk-1', { in: 'drawer' });
    });
    await act(async () => held[1]?.cancel?.());
    expect(await opened).toBe(true);
    expect(api.startSession).not.toHaveBeenCalled();
    expect(store.newChatDrawer).toBe(unsent);
    expect(store.actionError).toBeNull();

    // Discard: the chat starts and takes the drawer.
    act(() => store.setDrawerGuard((go) => go()));
    await act(async () => {
      await store.startChat('File the notes', 'acme', { open: true, in: 'drawer', project: 'acme/site' });
    });
    expect(api.startSession).toHaveBeenCalledTimes(1);
    expect(store.chatDrawer).toBe('s9');
  });

  it('a live drawer chat is replaced without asking (it keeps running)', async () => {
    await mount();
    const guard = vi.fn();
    act(() => store.setDrawerGuard(guard));
    act(() => store.openView(PROJECTS));
    act(() => store.openChat('s5', { in: 'drawer' }));
    act(() => store.newChat({ in: 'drawer', project: 'acme/site' }));
    expect(guard).not.toHaveBeenCalled();
    expect(store.chatDrawer).toBeNull();
    expect(store.newChatDrawer).not.toBeNull();
  });
});

describe('send from the drawer', () => {
  it('leaves the live chat in the drawer, which never reads closed in between', async () => {
    await mount();
    act(() => store.openView(PROJECTS));
    act(() => store.newChat({ in: 'drawer', project: 'acme/site', client: 'acme' }));
    seen.length = 0;
    await act(async () => {
      await store.send('Hello', 'acme', [], 'acme/site');
    });
    expect(api.startSession).toHaveBeenCalledWith({ prompt: 'Hello', client: 'acme', project: 'acme/site' });
    expect(store.view).toBe(PROJECTS);
    expect(store.chatDrawer).toBe('s9');
    expect(store.newChatDrawer).toBeNull();
    // Every render after Send: the drawer is a live chat; none has neither.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.drawer === 's9' || r.unsent !== null)).toBe(true);
    expect(seen.some((r) => r.drawer === null && r.unsent === null)).toBe(false);
  });

  it('a drawer chat left while it starts never pulls the person back or opens over where they went', async () => {
    await mount();
    for (const leave of [() => store.openView('settings'), () => store.openTool('ads', 'ad-manager')]) {
      act(() => store.openView(PROJECTS));
      act(() => store.newChat({ in: 'drawer', project: 'acme/site', client: 'acme' }));
      let started: (v: { session: { id: string } }) => void = () => {};
      api.startSession.mockReturnValueOnce(new Promise((resolve) => (started = resolve)));
      let sent: Promise<boolean> = Promise.resolve(false);
      act(() => {
        sent = store.send('Hello', 'acme', [], 'acme/site');
      });
      expect(store.newChatStarting).toBe(store.activeChat.kind === 'new' ? store.activeChat.key : -1);
      act(leave);
      const view = store.view;
      expect(view).not.toBe(PROJECTS);
      await act(async () => {
        started({ session: { id: 's9' } });
        expect(await sent).toBe(true);
      });
      expect(store.newChatStarting).toBeNull();
      expect(store.view).toBe(view);
      expect(store.chatDrawer).toBeNull();
      expect(store.activeChat).toMatchObject({ kind: 'new', in: 'sheet' });
    }
  });

  it('no start replaces a different unsent chat in the drawer, from the drawer or from Home', async () => {
    await mount();
    for (const first of [{ in: 'drawer' as const, project: 'acme/site' }, {}]) {
      act(() => store.openView(PROJECTS));
      act(() => store.newChat(first));
      let started: (v: { session: { id: string } }) => void = () => {};
      api.startSession.mockReturnValueOnce(new Promise((resolve) => (started = resolve)));
      act(() => {
        void store.send('Hello', 'acme', []);
      });
      // A second chat, opened beside the project while the first is still starting.
      act(() => store.openView(PROJECTS));
      if (store.newChatDrawer !== null) act(() => store.dropNewChatDrawer());
      act(() => store.newChat({ in: 'drawer', project: 'acme/site' }));
      const second = store.newChatDrawer;
      expect(second).not.toBeNull();
      expect(store.newChatStarting).not.toBe(second);
      await act(async () => started({ session: { id: 's9' } }));
      expect(store.newChatDrawer).toBe(second);
      expect(store.chatDrawer).toBeNull();
      expect(store.newChatStarting).toBeNull();
    }
  });

  it("a sheet chat's send does not open the drawer", async () => {
    await mount();
    act(() => store.openView(PROJECTS));
    act(() => store.newChat({ project: 'acme/site' }));
    expect(store.view).toBe('chat');
    await act(async () => {
      await store.send('Hello', 'acme', [], 'acme/site');
    });
    expect(store.chatDrawer).toBeNull();
    expect(store.activeChat).toMatchObject({ kind: 'live', sessionId: 's9' });
  });
});

describe('a message saved for later', () => {
  const KEY = 'project:acme/site';
  it("comes back from the same button, with its words and picks, in place of the opener's own", async () => {
    keptDrafts.save(KEY, { text: 'Half a thought', picks: { project: '', client: 'northwind' } });
    await mount();
    act(() => store.openView(PROJECTS));
    act(() => store.newChat({ in: 'drawer', project: 'acme/site', client: 'acme', draft: 'Opener text' }));
    expect(store.activeChat).toMatchObject({
      kind: 'new',
      in: 'drawer',
      draft: 'Half a thought',
      picks: { project: '', client: 'northwind' },
      keepKey: KEY,
      kept: { text: 'Half a thought' },
    });
  });

  it("with nothing kept the opener's own text is used, and the chat knows where it would be kept", async () => {
    await mount();
    act(() => store.openView(PROJECTS));
    act(() => store.newChat({ in: 'drawer', project: 'acme/site', draft: 'Opener text' }));
    expect(store.activeChat).toMatchObject({ draft: 'Opener text', keepKey: KEY });
    expect(store.activeChat).not.toHaveProperty('kept');
  });

  it("a task's chat and the checklist button each keep their own", async () => {
    keptDrafts.save(KEY, { text: 'For the project', picks: null });
    await mount();
    act(() => store.openView(PROJECTS));
    act(() =>
      store.newChat({ in: 'drawer', project: 'acme/site', todoId: 'a.md', draft: 'About todo/a.md' }),
    );
    expect(store.activeChat).toMatchObject({ draft: 'About todo/a.md', keepKey: 'todo:a.md' });
    act(() => store.dropNewChatDrawer());
    act(() => store.newChat({ in: 'drawer', project: 'acme/site', draft: 'Show me', slot: 'checklist' }));
    expect(store.activeChat).toMatchObject({ draft: 'Show me', keepKey: 'project:acme/site#checklist' });
  });

  it("Home's own chat, and a chat with no task or project, can't be kept", async () => {
    keptDrafts.save(KEY, { text: 'For the project', picks: null });
    await mount();
    act(() => store.newChat({ project: 'acme/site' }));
    expect(store.activeChat).toMatchObject({ in: 'sheet', draft: '', keepKey: null });
    act(() => store.openView(PROJECTS));
    act(() => store.newChat({ in: 'drawer' }));
    expect(store.activeChat).toMatchObject({ in: 'drawer', keepKey: null });
  });

  it('is used up by Send, from the drawer or after Open full screen', async () => {
    for (const fullScreen of [false, true]) {
      keptDrafts.save(KEY, { text: 'Half a thought', picks: null });
      await mount();
      act(() => store.openView(PROJECTS));
      act(() => store.newChat({ in: 'drawer', project: 'acme/site', client: 'acme' }));
      if (fullScreen) {
        act(() => store.expandNewChatDrawer('Half a thought', { project: 'acme/site', client: 'acme' }));
        expect(store.activeChat).toMatchObject({ in: 'sheet', keepKey: KEY });
        // Still kept: Home's box doesn't ask before it loses text.
        expect(keptDrafts.get(KEY)).not.toBeNull();
      }
      await act(async () => {
        await store.send('Half a thought', 'acme', [], 'acme/site');
      });
      expect(keptDrafts.get(KEY)).toBeNull();
      cleanup();
    }
  });

  it('stays kept when the start is refused', async () => {
    keptDrafts.save(KEY, { text: 'Half a thought', picks: null });
    api.startSession.mockRejectedValueOnce(new Error('Four chats are already running.'));
    await mount();
    act(() => store.openView(PROJECTS));
    act(() => store.newChat({ in: 'drawer', project: 'acme/site', client: 'acme' }));
    await act(async () => {
      expect(await store.send('Half a thought', 'acme', [], 'acme/site')).toBe(false);
    });
    expect(keptDrafts.get(KEY)?.text).toBe('Half a thought');
  });
});

describe('dropNewChatDrawer and expandNewChatDrawer', () => {
  it('Hide chat gives a fresh sheet chat and keeps the view', async () => {
    await mount();
    act(() => store.openView(PROJECTS));
    act(() => store.newChat({ in: 'drawer', project: 'acme/site' }));
    act(() => store.dropNewChatDrawer());
    expect(store.view).toBe(PROJECTS);
    expect(store.newChatDrawer).toBeNull();
    expect(store.activeChat).toMatchObject({ kind: 'new', in: 'sheet', scope: 'app' });
  });

  it('does nothing to a live chat', async () => {
    await mount();
    act(() => store.openView(PROJECTS));
    act(() => store.openChat('s5', { in: 'drawer' }));
    act(() => store.dropNewChatDrawer());
    expect(store.chatDrawer).toBe('s5');
  });

  it('Open full screen carries the draft, picks, task, skill, client and project to Home', async () => {
    await mount();
    act(() => store.openView(PROJECTS));
    const skill = { id: 'x', name: 'X' } as never;
    act(() => store.newChat({ in: 'drawer', project: 'acme/site', client: 'acme', todoId: 't1.md', skill }));
    act(() => store.expandNewChatDrawer('Half typed', { project: '', client: '@none' }));
    expect(store.view).toBe('chat');
    expect(store.newChatDrawer).toBeNull();
    expect(store.activeChat).toMatchObject({
      kind: 'new',
      in: 'sheet',
      scope: 'chat',
      draft: 'Half typed',
      todoId: 't1.md',
      skill,
      client: 'acme',
      project: 'acme/site',
      picks: { project: '', client: '@none' },
    });
  });

  it('asks the leave guard but tells it to skip the drawer hold', async () => {
    await mount();
    const guard = vi.fn((go: () => void) => go());
    act(() => store.setLeaveGuard(guard));
    act(() => store.openView(PROJECTS));
    act(() => store.newChat({ in: 'drawer', project: 'acme/site' }));
    act(() => store.expandNewChatDrawer('x', picks));
    expect(guard).toHaveBeenLastCalledWith(expect.any(Function), { skipDrawer: true });
    expect(store.view).toBe('chat');
  });
});
