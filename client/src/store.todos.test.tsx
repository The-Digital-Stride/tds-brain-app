// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoItem } from '../../shared/contract.ts';
import type { Store } from './store.tsx';

const api = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  todos: vi.fn(),
  sessions: vi.fn(),
  sync: vi.fn(async () => ({ lastSync: null })),
  startSession: vi.fn(),
  updatePrefs: vi.fn(),
}));
vi.mock('./api.ts', () => ({ api, streamUrl: () => '/api/stream', ApiFailure: class extends Error {} }));

const { StoreProvider, useStore } = await import('./store.tsx');

let store: Store | undefined;
function Grab() {
  store = useStore();
  return null;
}

const item = (id: string, over: Partial<TodoItem> = {}): TodoItem => ({
  id,
  scope: 'tds',
  key: id,
  path: `todo/${id}`,
  handover: {
    by: 'ben',
    byName: 'Ben',
    at: `2026-11-1${id.length}T09:00:00Z`,
    from: null,
    via: null,
    source: 'stamp',
  },
  createdBy: null,
  title: id,
  assignee: 'sam',
  due: null,
  surfaceDate: null,
  project: null,
  client: null,
  created: null,
  source: null,
  details: '',
  version: 'v1',
  ...over,
});

const mount = async (todos: TodoItem[] = []) => {
  api.bootstrap.mockRejectedValue(new Error('no boot'));
  api.sessions.mockResolvedValue({ live: [], past: [] });
  api.todos.mockResolvedValue({
    mine: todos,
    open: [],
    othersCount: 0,
    team: [],
    changes: 'on',
    canAddOpen: false,
    canUsePersonal: true,
  });
  render(
    <StoreProvider>
      <Grab />
    </StoreProvider>,
  );
  await act(async () => {});
};

beforeEach(() => {
  api.startSession.mockResolvedValue({ session: { id: 's9' } });
  api.updatePrefs.mockImplementation(async (p: object) => ({ pins: [], ...p }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('store.markTodosSeen', () => {
  it('keeps both of two quick marks', async () => {
    await mount();
    const a = item('a.md');
    const b = item('bb.md');
    act(() => {
      store?.markTodosSeen([a]);
      store?.markTodosSeen([b]);
    });
    const last = api.updatePrefs.mock.calls.at(-1)?.[0];
    expect(last).toEqual({ todoSeen: { 'a.md': a.handover?.at, 'bb.md': b.handover?.at } });
  });
});

describe('store.send, the to-do link', () => {
  it('keeps the link for a personal to-do named by its personal path', async () => {
    const p = item('p.md', { scope: 'personal', key: 'personal/p.md', path: 'personal/todo/p.md' });
    await mount([p]);
    act(() => store?.newChat({ draft: 'Help me with this to-do: personal/todo/p.md (p)', todoId: p.key }));
    await act(async () => {
      await store?.send('Help me with this to-do: personal/todo/p.md (p)', null);
    });
    expect(api.startSession).toHaveBeenCalledWith(expect.objectContaining({ todoId: 'personal/p.md' }));
  });

  it('drops the link when the message no longer names the to-do', async () => {
    const p = item('p.md', { scope: 'personal', key: 'personal/p.md', path: 'personal/todo/p.md' });
    await mount([p]);
    act(() => store?.newChat({ draft: 'x', todoId: p.key }));
    await act(async () => {
      await store?.send('something else', null);
    });
    expect(api.startSession.mock.calls[0]?.[0]).not.toHaveProperty('todoId');
  });
});
