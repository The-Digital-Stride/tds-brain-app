// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdsSummary } from '../../shared/ads-contract.ts';
import type { StreamFrame } from '../../shared/contract.ts';
import type { Store } from './store.tsx';

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
