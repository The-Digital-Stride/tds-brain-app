// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent, StreamFrame } from '../../shared/contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  // The rail's last-sync stamp asks for this.
  sync: vi.fn(async () => ({ lastSync: null })),
  doneTodos: vi.fn(),
  teamTodo: vi.fn(),
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

const { StoreProvider } = await import('./store.tsx');
const { doneStore } = await import('./state/todo-done.ts');
const { teamTodoStore } = await import('./state/team-todo.ts');

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
  // A fresh list each time, as the server sends.
  api.todos.mockImplementation(async () => ({ mine: [], open: [], othersCount: 0 }));
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.doneTodos.mockResolvedValue({ items: [], historyRead: true });
});
afterEach(() => {
  cleanup();
  doneStore.reset();
  teamTodoStore.reset();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("finished and teammates' tasks follow a task change with the Tasks drawer closed", () => {
  const start = async () => {
    render(
      <StoreProvider>
        <p>app</p>
      </StoreProvider>,
    );
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    await waitFor(() => expect(api.todos).toHaveBeenCalledTimes(1));
  };

  it("reloads the done list once something has asked for it, and a teammate's task already read", async () => {
    await start();
    await doneStore.refresh();
    api.teamTodo.mockResolvedValue(null);
    await teamTodoStore.refresh('team:todo/t.md');
    const doneCalls = api.doneTodos.mock.calls.length;
    const teamCalls = api.teamTodo.mock.calls.length;
    send({ type: 'brain-changed', area: 'todos' });
    await waitFor(() => expect(api.doneTodos.mock.calls.length).toBe(doneCalls + 1));
    await waitFor(() => expect(api.teamTodo.mock.calls.length).toBe(teamCalls + 1));
  });

  it('never loads the done list when nothing has asked for it', async () => {
    await start();
    send({ type: 'brain-changed', area: 'todos' });
    await waitFor(() => expect(api.todos).toHaveBeenCalledTimes(2));
    expect(api.doneTodos).not.toHaveBeenCalled();
  });
});
