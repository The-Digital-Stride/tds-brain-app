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
  updatePrefs: vi.fn(),
}));
class TestFailure extends Error {
  code = 'internal';
}
vi.mock('./api.ts', () => ({ api, streamUrl: () => '/api/stream', ApiFailure: TestFailure }));

const { StoreProvider, useStore } = await import('./store.tsx');

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
