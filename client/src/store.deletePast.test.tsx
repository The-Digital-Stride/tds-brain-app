// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  deletePastChat: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
}));
class FakeFailure extends Error {}
vi.mock('./api.ts', () => ({ api, streamUrl: () => '/api/stream', ApiFailure: FakeFailure }));

class FakeEventSource {
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {
    this.readyState = 2;
  }
}

const { StoreProvider, useStore } = await import('./store.tsx');

let del: ((id: string) => Promise<boolean>) | null = null;
function Probe() {
  const store = useStore();
  del = store.deletePastChat;
  return (
    <p>
      past {store.sessions?.past.map((p) => p.sdkSessionId).join(' ') ?? 'loading'}
      {store.notice ? `, notice ${store.notice}` : ''}
      {store.actionError ? `, error ${store.actionError}` : ''}
    </p>
  );
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
const past = (id: string) => ({
  sdkSessionId: id,
  title: id,
  lastModified: '2026-11-01T10:00:00Z',
  kind: 'tds',
});

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [past('p1'), past('p2')] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  del = null;
});

async function start() {
  render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await waitFor(() => expect(screen.getByText(/past p1 p2/)).toBeTruthy());
}

describe('deletePastChat', () => {
  it('reloads the chats and shows the notice on success', async () => {
    api.deletePastChat.mockResolvedValue({});
    await start();
    api.sessions.mockResolvedValue({ live: [], past: [past('p2')] });
    let ok = false;
    await act(async () => {
      ok = (await del?.('p1')) ?? false;
    });
    expect(ok).toBe(true);
    expect(api.deletePastChat).toHaveBeenCalledWith('p1');
    await waitFor(() =>
      expect(
        screen.getByText(/past p2, notice Chat moved to the Bin. You can put it back from there./),
      ).toBeTruthy(),
    );
  });

  it('sets the error and leaves the list alone on failure', async () => {
    api.deletePastChat.mockRejectedValue(
      new FakeFailure('That chat is open. Close it first, then delete it.'),
    );
    await start();
    const loads = api.sessions.mock.calls.length;
    let ok = true;
    await act(async () => {
      ok = (await del?.('p1')) ?? true;
    });
    expect(ok).toBe(false);
    expect(api.sessions.mock.calls.length).toBe(loads);
    expect(screen.getByText(/past p1 p2, error /)).toBeTruthy();
    expect(screen.queryByText(/notice/)).toBeNull();
  });
});
