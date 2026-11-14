// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatKind, LiveSession } from '../../shared/contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  setChatKind: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
}));
vi.mock('./api.ts', () => ({ api, streamUrl: () => '/api/stream', ApiFailure: class extends Error {} }));

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

let setKind: ((id: string, kind: ChatKind) => Promise<void>) | null = null;
function Probe() {
  const store = useStore();
  setKind = store.setChatKind;
  return (
    <p>
      kinds {store.sessions?.live.map((c) => `${c.id}:${c.kind}:${c.title}`).join(' ') ?? 'loading'}
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

const chat = (id: string, kind: ChatKind): LiveSession => ({
  id,
  sdkSessionId: `sdk-${id}`,
  title: `Chat ${id}`,
  client: null,
  todoId: null,
  kind,
  state: 'idle',
  startedAt: '2026-11-14T10:00:00.000Z',
  lastActivityAt: '2026-11-14T10:00:00.000Z',
});

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [chat('a', 'tds'), chat('b', 'tds')], past: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  setKind = null;
});

async function start() {
  render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await waitFor(() => expect(screen.getByText(/kinds a:tds:Chat a b:tds:Chat b/)).toBeTruthy());
}

describe('setChatKind', () => {
  it('moves the chat at once and keeps the reply, leaving other chats alone', async () => {
    let reply: (v: { session: LiveSession }) => void = () => {};
    api.setChatKind.mockReturnValue(new Promise((r) => (reply = r)));
    await start();
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = setKind?.('b', 'personal') ?? done;
    });
    // Before the server answers: the switch has already moved.
    expect(screen.getByText(/kinds a:tds:Chat a b:personal:Chat b/)).toBeTruthy();
    expect(api.setChatKind).toHaveBeenCalledWith('b', 'personal');
    await act(async () => {
      reply({ session: { ...chat('b', 'personal'), title: 'Renamed' } });
      await done;
    });
    // The server's reply replaces the chat (its title shows it landed).
    expect(screen.getByText(/kinds a:tds:Chat a b:personal:Renamed/)).toBeTruthy();
    expect(screen.queryByText(/error/)).toBeNull();
  });

  it('reloads the chats and shows an error when the change fails', async () => {
    api.setChatKind.mockRejectedValue(new Error('offline'));
    await start();
    const loadsBefore = api.sessions.mock.calls.length;
    await act(async () => {
      await setKind?.('a', 'personal');
    });
    expect(api.sessions.mock.calls.length).toBeGreaterThan(loadsBefore);
    await waitFor(() => expect(screen.getByText(/kinds a:tds:Chat a b:tds:Chat b, error/)).toBeTruthy());
  });
});
