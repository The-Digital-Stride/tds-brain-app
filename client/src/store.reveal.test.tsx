// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoItem } from '../../shared/contract.ts';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
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

const todo = (id: string): TodoItem => ({
  id,
  scope: 'tds',
  key: id,
  path: `todo/${id}`,
  handover: null,
  createdBy: null,
  title: id,
  created: null,
  source: null,
  details: '',
  version: 'v1',
  assignee: 'sam',
  due: null,
  surfaceDate: null,
  project: null,
  client: null,
});

let latest: ReturnType<typeof useStore> | null = null;
function Probe() {
  const s = useStore();
  latest = s;
  return <p>reveal {s.reveal ? `${s.reveal.todo.id} #${s.reveal.n}` : 'none'}</p>;
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.bootstrap.mockResolvedValue({
    appVersion: '0',
    appState: { kind: 'ready' },
    identity: { name: 'Sam', slug: 'sam', email: null, role: 'team', knownMember: true },
    skills: [],
    clients: [],
    usedOften: [],
    prefs: { pins: [], lastClient: null, todoPanelOpen: false, directWrites: false },
  });
  api.todos.mockResolvedValue({ mine: [], open: [], othersCount: 0 });
  api.sessions.mockResolvedValue({ live: [], past: [] });
});
afterEach(() => {
  cleanup();
  latest = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('revealTodo', () => {
  it('holds one request until it is cleared, and counts a repeat as a new one', async () => {
    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>,
    );
    await screen.findByText('reveal none');
    act(() => latest?.revealTodo(todo('a.md')));
    await screen.findByText('reveal a.md #1');
    act(() => latest?.revealTodo(todo('a.md')));
    await screen.findByText('reveal a.md #2');
    act(() => latest?.clearReveal());
    await waitFor(() => expect(screen.getByText('reveal none')).toBeTruthy());
  });
});
