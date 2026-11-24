// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdsSummary } from '../../shared/ads-contract.ts';
import type { StreamFrame } from '../../shared/contract.ts';
import type { Store } from './store.tsx';
import { readRuns, runKey, taskRuns } from './tools/ad-manager/task-runs.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
  startSession: vi.fn(),
  sendMessage: vi.fn(),
  updatePrefs: vi.fn(),
  adsCapabilities: vi.fn(),
  adsApprovals: vi.fn(),
}));
const summary = vi.hoisted(() => ({ loadAdsSummary: vi.fn() }));
vi.mock('./api.ts', () => ({
  api,
  streamUrl: () => '/api/stream',
  ApiFailure: class extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));
vi.mock('./tools/ad-manager/summary.ts', () => summary);

class FakeEventSource {
  static last: FakeEventSource | null = null;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  static CLOSED = 2;
  constructor() {
    FakeEventSource.last = this;
  }
  addEventListener() {}
  close() {}
}

const { StoreProvider, useStore } = await import('./store.tsx');

let store: Store;
function Probe() {
  store = useStore();
  return null;
}

const boot = {
  appVersion: '0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  identity: { name: 'Sam', slug: 'sam', email: null, role: 'owner', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' },
  skills: [],
  clients: [],
  usedOften: [],
  prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false },
};
const ads = (waiting: number): AdsSummary => ({
  visible: true,
  me: { slug: 'sam' } as AdsSummary['me'],
  sameIdentity: true,
  waiting,
  clients: [],
});

async function mount() {
  render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await waitFor(() => expect(store?.boot).not.toBeNull());
  await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
}

beforeEach(() => {
  FakeEventSource.last = null;
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.startSession.mockResolvedValue({ session: { id: 's9' } });
  api.updatePrefs.mockImplementation(async (patch: object) => ({ ...boot.prefs, ...patch }));
  summary.loadAdsSummary.mockResolvedValue(ads(2));
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('startChat', () => {
  it('starts a new chat directly and never posts into the open one', async () => {
    await mount();
    let id: string | null = null;
    await act(async () => {
      id = await store.startChat('Run the weekly check', 'acme', { open: true });
    });
    expect(id).toBe('s9');
    expect(api.startSession).toHaveBeenCalledWith({ prompt: 'Run the weekly check', client: 'acme' });
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(store.activeChat).toEqual({ kind: 'live', sessionId: 's9' });
  });

  it("sends the chat's project when given one (File the notes), and nothing extra when not", async () => {
    await mount();
    await act(async () => {
      await store.startChat('File the notes', 'acme', { open: true, in: 'drawer', project: 'acme/site' });
    });
    expect(api.startSession).toHaveBeenLastCalledWith({
      prompt: 'File the notes',
      client: 'acme',
      project: 'acme/site',
    });
    await act(async () => {
      await store.startChat('Run it', 'acme', { open: false, project: null });
    });
    expect(api.startSession).toHaveBeenLastCalledWith({ prompt: 'Run it', client: 'acme' });
  });

  it('with open: false leaves the person where they are', async () => {
    await mount();
    await act(async () => {
      store.openView('settings');
    });
    const before = store.activeChat;
    await act(async () => {
      await store.startChat('Revise it', 'acme', { open: false });
    });
    expect(store.activeChat).toBe(before);
    expect(store.view).toBe('settings');
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("with in: 'drawer' keeps the tool on the sheet and shows the chat in the drawer", async () => {
    await mount();
    await act(async () => {
      store.openTool('workbench', 'ad-manager');
    });
    const tool = store.view;
    await act(async () => {
      await store.startChat('Run the weekly check', 'acme', { open: true, in: 'drawer' });
    });
    expect(store.view).toBe(tool);
    expect(store.activeChat).toEqual({ kind: 'live', sessionId: 's9' });
    expect(store.chatDrawer).toBe('s9');
  });

  it('the drawer goes on Hide, Open full screen, leaving the tool, a new chat or another chat', async () => {
    await mount();
    const openInDrawer = async () => {
      await act(async () => {
        store.openTool('workbench', 'ad-manager');
      });
      await act(async () => {
        store.openChat('s9', { in: 'drawer' });
      });
      expect(store.chatDrawer).toBe('s9');
    };
    await openInDrawer();
    await act(async () => store.hideChatDrawer());
    expect(store.chatDrawer).toBeNull();
    expect(store.activeChat).toEqual({ kind: 'live', sessionId: 's9' });

    await openInDrawer();
    await act(async () => store.expandChatDrawer());
    expect(store.chatDrawer).toBeNull();
    expect(store.view).toBe('chat');

    await openInDrawer();
    await act(async () => store.openView('settings'));
    expect(store.chatDrawer).toBeNull();
    // Back on the tool, the old drawer does not come back by itself.
    await act(async () => store.openTool('workbench', 'ad-manager'));
    expect(store.chatDrawer).toBeNull();

    await openInDrawer();
    await act(async () => store.newChat());
    expect(store.chatDrawer).toBeNull();

    await openInDrawer();
    await act(async () => store.openChat('s2'));
    expect(store.chatDrawer).toBeNull();
    expect(store.view).toBe('chat');
  });

  it('a chat stays in the drawer beside Projects (Save to project), but not beside another app', async () => {
    await mount();
    await act(async () => store.openView('app:projects'));
    await act(async () => store.openChat('s9', { in: 'drawer' }));
    expect(store.view).toBe('app:projects');
    expect(store.chatDrawer).toBe('s9');
    await act(async () => store.openView('app:documents'));
    expect(store.chatDrawer).toBeNull();
  });

  it('the drawer stays open when another tool of the same section is opened (a tab press)', async () => {
    await mount();
    await act(async () => store.openTool('workbench', 'ad-manager'));
    await act(async () => store.openChat('s9', { in: 'drawer' }));
    expect(store.chatDrawer).toBe('s9');
    await act(async () => store.openTool('workbench', 'ads-command-centre'));
    expect(store.view).toBe('tool:workbench/ads-command-centre');
    expect(store.chatDrawer).toBe('s9');
    expect(store.activeChat).toEqual({ kind: 'live', sessionId: 's9' });
  });

  it('a chat opened without in: drawer still goes to the chat screen', async () => {
    await mount();
    await act(async () => store.openTool('workbench', 'ad-manager'));
    await act(async () => store.openChat('s9'));
    expect(store.view).toBe('chat');
    expect(store.chatDrawer).toBeNull();
  });

  it('resolves null and sets actionError when the server refuses', async () => {
    await mount();
    api.startSession.mockRejectedValue(new Error('No room'));
    let id: string | null = 'x';
    await act(async () => {
      id = await store.startChat('p', null, { open: true });
    });
    expect(id).toBeNull();
    expect(store.actionError).toBeTruthy();
  });
});

describe('openTool', () => {
  it('shows the tool view, hands over the argument once, and remembers the last tool', async () => {
    await mount();
    await act(async () => {
      store.openTool('workbench', 'ad-manager', 'acme');
    });
    expect(store.view).toBe('tool:workbench/ad-manager');
    expect(store.toolArg).toBe('acme');
    await waitFor(() =>
      expect(api.updatePrefs).toHaveBeenCalledWith({ lastTool: { workbench: 'ad-manager' } }),
    );
    act(() => store.clearToolArg());
    expect(store.toolArg).toBeNull();
  });

  it('does not rewrite prefs when the tool is already the remembered one', async () => {
    api.bootstrap.mockResolvedValue({
      ...boot,
      prefs: { ...boot.prefs, lastTool: { workbench: 'ad-manager' } },
    });
    await mount();
    await act(async () => {
      store.openTool('workbench', 'ad-manager');
    });
    expect(api.updatePrefs).not.toHaveBeenCalled();
    expect(store.toolArg).toBeNull();
  });
});

describe('ads summary', () => {
  it('loads after boot with the app identity, and reloads on ads-changed', async () => {
    await mount();
    await waitFor(() => expect(store.ads?.waiting).toBe(2));
    expect(summary.loadAdsSummary).toHaveBeenCalledWith('sam');
    summary.loadAdsSummary.mockResolvedValue(ads(5));
    const frame: StreamFrame = { kind: 'app', event: { type: 'ads-changed' } };
    act(() => FakeEventSource.last?.onmessage?.({ data: JSON.stringify(frame) }));
    await waitFor(() => expect(store.ads?.waiting).toBe(5));
  });

  it('stays null when the server has no ads routes, and reloadAds fetches again', async () => {
    summary.loadAdsSummary.mockResolvedValue(null);
    await mount();
    await waitFor(() => expect(summary.loadAdsSummary).toHaveBeenCalled());
    expect(store.ads).toBeNull();
    summary.loadAdsSummary.mockResolvedValue(ads(1));
    await act(async () => {
      await store.reloadAds();
    });
    expect(store.ads?.waiting).toBe(1);
  });

  it('keeps what it had when a reload fails', async () => {
    await mount();
    await waitFor(() => expect(store.ads?.waiting).toBe(2));
    // The real loadAdsSummary, with the server answering 500: it rethrows, and the store keeps its summary.
    const real = await vi.importActual<typeof import('./tools/ad-manager/summary.ts')>(
      './tools/ad-manager/summary.ts',
    );
    const { ApiFailure } = await import('./api.ts');
    api.adsCapabilities.mockRejectedValue(new ApiFailure('internal', 'boom', 500));
    summary.loadAdsSummary.mockImplementation((slug: string) => real.loadAdsSummary(slug));
    await act(async () => {
      await store.reloadAds();
    });
    expect(store.ads?.waiting).toBe(2);
  });
});

describe('openPast', () => {
  const live = (id: string, sdk: string) => ({ id, sdkSessionId: sdk, state: 'idle' });

  it('opens on the chat screen by default and resolves true', async () => {
    await mount();
    api.startSession.mockResolvedValue({ session: { id: 's5' } });
    await act(async () => store.openTool('workbench', 'ad-manager'));
    let opened: boolean | undefined;
    await act(async () => {
      opened = await store.openPast('sdk-1');
    });
    expect(opened).toBe(true);
    expect(api.startSession).toHaveBeenCalledWith({ resume: 'sdk-1' });
    expect(store.view).toBe('chat');
    expect(store.activeChat).toEqual({ kind: 'live', sessionId: 's5' });
    expect(store.chatDrawer).toBeNull();
  });

  it("with in: 'drawer' keeps the tool and shows the chat in the drawer", async () => {
    await mount();
    api.startSession.mockResolvedValue({ session: { id: 's5' } });
    await act(async () => store.openTool('workbench', 'ad-manager'));
    const tool = store.view;
    await act(async () => {
      await store.openPast('sdk-1', { in: 'drawer' });
    });
    expect(store.view).toBe(tool);
    expect(store.chatDrawer).toBe('s5');
  });

  it('an already-open chat opens in the asked place too, and resolves true', async () => {
    await mount();
    const { ApiFailure } = await import('./api.ts');
    api.startSession.mockRejectedValue(new ApiFailure('already-open', 'Open already', 409));
    api.sessions.mockResolvedValue({ live: [live('s7', 'sdk-1')], past: [] });
    await act(async () => store.openTool('workbench', 'ad-manager'));
    const tool = store.view;
    let opened: boolean | undefined;
    await act(async () => {
      opened = await store.openPast('sdk-1', { in: 'drawer' });
    });
    expect(opened).toBe(true);
    expect(store.view).toBe(tool);
    expect(store.chatDrawer).toBe('s7');
    await act(async () => {
      await store.openPast('sdk-1');
    });
    expect(store.view).toBe('chat');
    expect(store.chatDrawer).toBeNull();
  });

  it('resolves false and sets actionError when the chat cannot be opened', async () => {
    await mount();
    api.startSession.mockRejectedValue(new Error('Gone'));
    let opened: boolean | undefined;
    await act(async () => {
      opened = await store.openPast('sdk-1');
    });
    expect(opened).toBe(false);
    expect(store.actionError).toBeTruthy();
  });
});

describe('task run reconcile', () => {
  it('records the sdk id and a good run when the chat list shows a finished chat, and writes only on change', async () => {
    const key = runKey('acme', 'weekly');
    taskRuns.record('acme', 'weekly', 'c1', new Date('2026-11-16T10:00:00.000Z'));
    api.sessions.mockResolvedValue({
      live: [{ id: 'c1', sdkSessionId: 'sdk-1', state: 'idle', lastTurn: 'ok' }],
      past: [],
    });
    const set = vi.spyOn(Storage.prototype, 'setItem');
    await mount();
    await waitFor(() =>
      expect(readRuns()[key]?.good).toEqual({ at: '2026-11-16T10:00:00.000Z', sdk: 'sdk-1' }),
    );
    expect(readRuns()[key]?.sdk).toBe('sdk-1');
    const writes = set.mock.calls.filter(([k]) => k === 'tds.adManager.taskRuns.v1').length;
    expect(writes).toBe(1);
    set.mockRestore();
    localStorage.clear();
  });
});
