// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TodoAction, TodoList } from '../../shared/contract.ts';
import type { ChangeTodosResult, Store } from './store.tsx';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
  changeTodo: vi.fn(),
  completeTodo: vi.fn(),
  updatePrefs: vi.fn(),
}));
class TestFailure extends Error {
  code = 'internal';
}
vi.mock('./api.ts', () => ({ api, streamUrl: () => '/api/stream', ApiFailure: TestFailure }));

const { StoreProvider, useStore, TODO_UNDO_MS } = await import('./store.tsx');

const list = (title: string): TodoList => ({
  mine: [
    {
      id: 'a.md',
      title,
      assignee: null,
      due: null,
      surfaceDate: null,
      project: null,
      client: null,
      created: null,
      source: null,
      details: '',
    },
  ],
  open: [],
  othersCount: 0,
  team: [],
  changes: 'on',
});

let store: Store | undefined;
function Grab() {
  store = useStore();
  return null;
}

afterEach(cleanup);

describe('store.changeTodos', () => {
  it('sends in order, stops at the first failure and keeps the last good list', async () => {
    api.bootstrap.mockRejectedValue(new Error('no boot'));
    api.todos.mockResolvedValue(list('start'));
    api.sessions.mockResolvedValue({ live: [], past: [] });
    api.changeTodo.mockReset();
    api.changeTodo
      .mockResolvedValueOnce(list('after first'))
      .mockRejectedValueOnce(new TestFailure('Bad date.'))
      .mockResolvedValue(list('should not happen'));
    render(
      <StoreProvider>
        <Grab />
      </StoreProvider>,
    );
    const actions: TodoAction[] = [
      { kind: 'edit', id: 'a.md', title: 'T' },
      { kind: 'due', id: 'a.md', due: '2030-01-01' },
      { kind: 'assignee', id: 'a.md', assignee: null },
    ];
    let result: ChangeTodosResult | undefined;
    await act(async () => {
      result = await store?.changeTodos(actions);
    });
    expect(api.changeTodo.mock.calls.map((c) => (c[0] as TodoAction).kind)).toEqual(['edit', 'due']);
    expect(result).toEqual({ done: 1, error: { code: 'internal', message: 'Bad date.' } });
    expect(store?.todos?.mine[0]?.title).toBe('after first');
  });

  it('reloads the to-dos when the "Let the app change to-dos" switch changes', async () => {
    api.bootstrap.mockRejectedValue(new Error('no boot'));
    api.sessions.mockResolvedValue({ live: [], past: [] });
    api.todos.mockReset();
    api.todos.mockResolvedValueOnce({ ...list('start'), changes: 'switched-off' });
    api.todos.mockResolvedValue(list('after switch'));
    api.updatePrefs.mockResolvedValue({
      pins: [],
      lastClient: null,
      todoPanelOpen: true,
      directWrites: true,
    });
    render(
      <StoreProvider>
        <Grab />
      </StoreProvider>,
    );
    await act(async () => {});
    expect(store?.todos?.changes).toBe('switched-off');
    await act(async () => {
      await store?.updatePrefs({ directWrites: true });
    });
    expect(store?.todos?.changes).toBe('on');
  });

  it('does not reload the to-dos for other preferences', async () => {
    api.bootstrap.mockRejectedValue(new Error('no boot'));
    api.sessions.mockResolvedValue({ live: [], past: [] });
    api.todos.mockReset();
    api.todos.mockResolvedValue(list('start'));
    api.updatePrefs.mockResolvedValue({
      pins: ['x'],
      lastClient: null,
      todoPanelOpen: true,
      directWrites: false,
    });
    render(
      <StoreProvider>
        <Grab />
      </StoreProvider>,
    );
    await act(async () => {});
    const before = api.todos.mock.calls.length;
    await act(async () => {
      await store?.updatePrefs({ pins: ['x'] });
    });
    expect(api.todos.mock.calls.length).toBe(before);
  });
});

describe('store.holdTodo (undo)', () => {
  const start = async () => {
    api.bootstrap.mockRejectedValue(new Error('no boot'));
    api.sessions.mockResolvedValue({ live: [], past: [] });
    api.todos.mockReset();
    api.todos.mockResolvedValue(list('start'));
    api.completeTodo.mockReset();
    api.changeTodo.mockReset();
    render(
      <StoreProvider>
        <Grab />
      </StoreProvider>,
    );
    await act(async () => {});
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds a tick, then sends it once the undo time is up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await start();
    api.completeTodo.mockResolvedValue(list('after tick'));
    act(() =>
      store?.holdTodo({ todoId: 'a.md', title: 'A', kind: 'tick', label: 'Marked as done', action: null }),
    );
    expect(store?.heldTodos.map((h) => h.todoId)).toEqual(['a.md']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS - 100);
    });
    expect(api.completeTodo).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(api.completeTodo).toHaveBeenCalledWith('a.md');
    expect(store?.heldTodos).toEqual([]);
    expect(store?.todos?.mine[0]?.title).toBe('after tick');
  });

  it('undo cancels a held change, so nothing is sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await start();
    act(() =>
      store?.holdTodo({
        todoId: 'a.md',
        title: 'A',
        kind: 'delete',
        label: 'Deleted',
        action: { kind: 'delete', id: 'a.md' },
      }),
    );
    act(() => store?.undoHeld('a.md'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS * 2);
    });
    expect(api.changeTodo).not.toHaveBeenCalled();
    expect(store?.heldTodos).toEqual([]);
  });

  it('sends a held change straight away when the page is closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await start();
    api.changeTodo.mockResolvedValue(list('after'));
    const action: TodoAction = { kind: 'assignee', id: 'a.md', assignee: 'pete-tyler' };
    act(() =>
      store?.holdTodo({ todoId: 'a.md', title: 'A', kind: 'assignee', label: 'Passed to Pete', action }),
    );
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(api.changeTodo).toHaveBeenCalledWith(action, { keepalive: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS * 2);
    });
    expect(api.changeTodo).toHaveBeenCalledTimes(1);
  });

  it('once a held change is on its way, Undo does nothing and the row says it is sending', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await start();
    let finish: (v: TodoList) => void = () => {};
    api.changeTodo.mockReturnValue(new Promise<TodoList>((r) => (finish = r)));
    const action: TodoAction = { kind: 'delete', id: 'a.md' };
    act(() => store?.holdTodo({ todoId: 'a.md', title: 'A', kind: 'delete', label: 'Deleted', action }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS + 10);
    });
    expect(api.changeTodo).toHaveBeenCalledTimes(1);
    expect(store?.heldTodos[0]?.sending).toBe(true);
    act(() => store?.undoHeld('a.md'));
    expect(store?.heldTodos.map((h) => h.todoId)).toEqual(['a.md']);
    await act(async () => finish(list('after')));
    expect(store?.heldTodos).toEqual([]);
  });

  it('closing the page sends a change still queued behind another', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await start();
    let finishA: (v: TodoList) => void = () => {};
    api.changeTodo.mockReturnValueOnce(new Promise<TodoList>((r) => (finishA = r)));
    api.changeTodo.mockResolvedValue(list('after'));
    const a: TodoAction = { kind: 'delete', id: 'a.md' };
    const b: TodoAction = { kind: 'delete', id: 'b.md' };
    act(() => store?.holdTodo({ todoId: 'a.md', title: 'A', kind: 'delete', label: 'Deleted', action: a }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS / 2);
    });
    act(() => store?.holdTodo({ todoId: 'b.md', title: 'B', kind: 'delete', label: 'Deleted', action: b }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS);
    });
    // A is still on its way, B is queued behind it.
    expect(api.changeTodo).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(api.changeTodo).toHaveBeenCalledWith(b, { keepalive: true });
    await act(async () => finishA(list('after')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    // B went once, by the page-closing send only.
    expect(api.changeTodo.mock.calls.filter(([x]) => x === b)).toHaveLength(1);
  });

  it('shows the error and gives the to-do back when a held change fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await start();
    api.completeTodo.mockRejectedValue(new TestFailure('That to-do could not be found.'));
    act(() =>
      store?.holdTodo({ todoId: 'a.md', title: 'A', kind: 'tick', label: 'Marked as done', action: null }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODO_UNDO_MS + 100);
    });
    expect(store?.actionError).toBe('That to-do could not be found.');
    expect(store?.heldTodos).toEqual([]);
  });
});
