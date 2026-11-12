// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent, StreamFrame } from '../../shared/contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  // The rail's last-sync stamp asks for this.
  sync: vi.fn(async () => ({ lastSync: null })),
}));
vi.mock('./api.ts', () => ({ api, streamUrl: () => '/api/stream', ApiFailure: class extends Error {} }));

class FakeEventSource {
  static last: FakeEventSource | null = null;
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeEventSource.last = this;
  }
  addEventListener() {}
  close() {
    this.readyState = 2;
  }
}

const { StoreProvider, useStore } = await import('./store.tsx');

function Probe() {
  const { lists } = useStore();
  return (
    <p>
      todos {lists.todos}, chats {lists.chats}
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

function send(event: AppEvent) {
  const frame: StreamFrame = { kind: 'app', event };
  act(() => FakeEventSource.last?.onmessage?.({ data: JSON.stringify(frame) }));
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue(boot);
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('lists (the Settings health panel)', () => {
  const start = async () => {
    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
  };

  it('says both lists loaded when they did', async () => {
    await start();
    await screen.findByText('todos loaded, chats loaded');
  });

  it('marks the to-dos failed, then loaded again on the next change', async () => {
    api.todos.mockRejectedValueOnce(new Error('down'));
    await start();
    await screen.findByText('todos failed, chats loaded');
    send({ type: 'brain-changed', area: 'todos' });
    await screen.findByText('todos loaded, chats loaded');
  });

  it('marks the chats failed, then loaded again on the next change', async () => {
    api.sessions.mockRejectedValueOnce(new Error('down'));
    await start();
    await screen.findByText('todos loaded, chats failed');
    send({ type: 'sessions-changed' });
    await screen.findByText('todos loaded, chats loaded');
  });
});
