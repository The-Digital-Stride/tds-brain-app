// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskedTodo, AskedTodoList, TodoItem } from '../../shared/contract.ts';
import { entryKey, lookedMark } from '../../shared/todo-changes.ts';
import type { TodoUpdate } from '../../shared/todo-updates-contract.ts';
import type { Store } from './store.tsx';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  askedTodos: vi.fn(),
  sessions: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
  startSession: vi.fn(),
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
  close() {
    this.readyState = 2;
  }
}

const { StoreProvider, useStore } = await import('./store.tsx');

let store: Store | undefined;
function Grab() {
  store = useStore();
  return null;
}

const ME = { slug: 'sam-example', name: 'Sam Example' };
const NOW = new Date();
const note = (text: string, minutesAgo = 60): TodoUpdate => ({
  kind: 'note',
  at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  by: 'ben-mcadam',
  byName: 'Ben McAdam',
  text,
  via: null,
  action: 'update',
});
const held = (id: string, updates: TodoUpdate[], scope: 'tds' | 'personal' = 'tds'): TodoItem =>
  ({ id, scope, key: id, handover: null, updates }) as unknown as TodoItem;
const askedRow = (id: string): AskedTodo =>
  ({
    id,
    key: `asked:${id}`,
    state: 'waiting',
    updates: [],
    done: null,
    asked: { at: '2020-01-01T00:00:00Z' },
  }) as unknown as AskedTodo;
const askedList = (...ids: string[]): AskedTodoList => ({
  waiting: ids.map(askedRow),
  done: [],
  historyRead: true,
});

const mount = async () => {
  api.bootstrap.mockResolvedValue({
    identity: { ...ME, email: null, role: 'owner', knownMember: true },
    prefs: { pins: [], todoLooked: {} },
    clients: [],
  });
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.todos.mockResolvedValue({
    mine: [],
    open: [],
    othersCount: 0,
    team: [],
    changes: 'on',
    canAddOpen: false,
  });
  render(
    <StoreProvider>
      <Grab />
    </StoreProvider>,
  );
  await act(async () => {});
};

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  api.askedTodos.mockResolvedValue(askedList('a.md'));
  api.updatePrefs.mockImplementation(async (p: object) => ({ pins: [], ...p }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('store: the Asked list', () => {
  it('loads once the task list has loaded', async () => {
    await mount();
    expect(store?.askedState).toBe('loaded');
    expect(store?.asked?.waiting.map((r) => r.id)).toEqual(['a.md']);
  });

  it('reloads on a todos change, keeping the last list while it runs, and keeps it on failure', async () => {
    await mount();
    let release: (l: AskedTodoList) => void = () => {};
    api.askedTodos.mockReturnValueOnce(new Promise<AskedTodoList>((r) => (release = r)));
    act(() => store?.reloadAsked());
    expect(store?.asked?.waiting.map((r) => r.id)).toEqual(['a.md']);
    expect(store?.askedState).toBe('loaded');
    await act(async () => release(askedList('b.md')));
    expect(store?.asked?.waiting.map((r) => r.id)).toEqual(['b.md']);
    api.askedTodos.mockRejectedValueOnce(new Error('down'));
    await act(async () => store?.reloadAsked());
    expect(store?.askedState).toBe('failed');
    expect(store?.asked?.waiting.map((r) => r.id)).toEqual(['b.md']);
    await act(async () => store?.reloadAsked());
    expect(store?.askedState).toBe('loaded');
  });

  it('runs one request at a time, with one more queued however many are asked for', async () => {
    await mount();
    api.askedTodos.mockClear();
    const releases: ((l: AskedTodoList) => void)[] = [];
    api.askedTodos.mockImplementation(() => new Promise<AskedTodoList>((r) => releases.push(r)));
    act(() => {
      store?.reloadAsked();
      store?.reloadAsked();
      store?.reloadAsked();
    });
    expect(api.askedTodos).toHaveBeenCalledTimes(1);
    await act(async () => releases[0]?.(askedList('x.md')));
    expect(api.askedTodos).toHaveBeenCalledTimes(2);
    await act(async () => releases[1]?.(askedList('y.md')));
    expect(api.askedTodos).toHaveBeenCalledTimes(2);
    expect(store?.asked?.waiting.map((r) => r.id)).toEqual(['y.md']);
  });
});

describe('store.markTodosLooked', () => {
  it('keeps a looked marker when the reply to a seen save lands first (review R2)', async () => {
    await mount();
    // A server that applies saves in order and answers each with the whole prefs file as it then stands.
    let file: Record<string, unknown> = { pins: [], todoLooked: {}, todoSeen: {} };
    const replies: (() => void)[] = [];
    api.updatePrefs.mockImplementation(
      (p: object) =>
        new Promise((resolve) => {
          file = { ...file, ...p };
          const snapshot = file;
          replies.push(() => resolve(snapshot));
        }),
    );
    const a = { ...held('a.md', [note('One')]), handover: { at: '2026-11-27T10:00:00+00:00' } } as TodoItem;
    act(() => {
      store?.markTodosSeen([a]);
      store?.markTodosLooked([{ kind: 'held', todo: a }]);
    });
    expect(replies).toHaveLength(2);
    await act(async () => replies[0]?.());
    expect(Object.keys(store?.boot?.prefs.todoLooked ?? {})).toEqual(['a.md']);
    await act(async () => replies[1]?.());
    expect(Object.keys(store?.boot?.prefs.todoLooked ?? {})).toEqual(['a.md']);
    expect(store?.boot?.prefs.todoSeen).toEqual({ 'a.md': '2026-11-27T10:00:00+00:00' });
    // The next mark carries the earlier one: nothing was lost on the way.
    const b = held('b.md', [note('Two')]);
    act(() => store?.markTodosLooked([{ kind: 'held', todo: b }]));
    expect(Object.keys((file.todoLooked as object) ?? {}).sort()).toEqual(['a.md', 'b.md']);
  });

  it('keeps a seen marker when the reply to a looked save lands first', async () => {
    await mount();
    let file: Record<string, unknown> = { pins: [], todoLooked: {}, todoSeen: {} };
    const replies: (() => void)[] = [];
    api.updatePrefs.mockImplementation(
      (p: object) =>
        new Promise((resolve) => {
          file = { ...file, ...p };
          const snapshot = file;
          replies.push(() => resolve(snapshot));
        }),
    );
    const a = { ...held('a.md', [note('One')]), handover: { at: '2026-11-27T10:00:00+00:00' } } as TodoItem;
    act(() => {
      store?.markTodosLooked([{ kind: 'held', todo: a }]);
      store?.markTodosSeen([a]);
    });
    await act(async () => replies[0]?.());
    expect(store?.boot?.prefs.todoSeen).toEqual({ 'a.md': '2026-11-27T10:00:00+00:00' });
    await act(async () => replies[1]?.());
    expect(store?.boot?.prefs.todoSeen).toEqual({ 'a.md': '2026-11-27T10:00:00+00:00' });
  });

  it('saves the whole map with a marker per task, and keeps both of two quick marks', async () => {
    await mount();
    const a = held('a.md', [note('One')]);
    const b = held('b.md', [note('Two')]);
    act(() => {
      store?.markTodosLooked([{ kind: 'held', todo: a }]);
      store?.markTodosLooked([{ kind: 'held', todo: b }]);
    });
    const last = api.updatePrefs.mock.calls.at(-1)?.[0].todoLooked;
    expect(Object.keys(last).sort()).toEqual(['a.md', 'b.md']);
    expect(last['a.md'].keys).toEqual([entryKey(a.updates?.[0] as TodoUpdate)]);
    expect(last['a.md'].keys).toEqual(lookedMark({ kind: 'held', todo: a }, ME, new Date()).keys);
  });

  it('does not save again when the marker would have the same keys and done flag', async () => {
    await mount();
    const a = held('a.md', [note('One')]);
    act(() => store?.markTodosLooked([{ kind: 'held', todo: a }]));
    expect(api.updatePrefs).toHaveBeenCalledTimes(1);
    act(() => store?.markTodosLooked([{ kind: 'held', todo: a }]));
    expect(api.updatePrefs).toHaveBeenCalledTimes(1);
    const more = held('a.md', [note('One'), note('Newer', 5)]);
    act(() => store?.markTodosLooked([{ kind: 'held', todo: more }]));
    expect(api.updatePrefs).toHaveBeenCalledTimes(2);
  });

  it('saves a marker when an asked task is done, even with the same keys', async () => {
    await mount();
    const open = askedRow('q.md');
    act(() => store?.markTodosLooked([{ kind: 'asked', todo: open }]));
    const done = { ...open, state: 'done' } as AskedTodo;
    act(() => store?.markTodosLooked([{ kind: 'asked', todo: done }]));
    expect(api.updatePrefs).toHaveBeenCalledTimes(2);
    expect(api.updatePrefs.mock.calls.at(-1)?.[0].todoLooked['q.md'].done).toBe(true);
  });
});
