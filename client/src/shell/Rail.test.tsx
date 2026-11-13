// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TodoItem } from '../../../shared/contract.ts';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../store.tsx', () => ({ useStore: () => store.current }));
vi.mock('./ShellProvider.tsx', () => ({
  useShell: () => ({ state: { drawer: null, singleKeys: true }, dispatch: vi.fn() }),
  useDesk: () => ({ railShowsNames: false, width: 1400 }),
}));
vi.mock('./SyncStamp.tsx', () => ({ SyncStamp: () => null }));

const { Rail } = await import('./Rail.tsx');

const at = new Date(Date.now() - 3_600_000).toISOString();
const todo = (id: string, by: string | null): TodoItem => ({
  id,
  scope: 'tds',
  key: id,
  path: `todo/${id}`,
  handover: by ? { by, byName: by, at, from: null, via: null, source: 'stamp' } : null,
  createdBy: null,
  title: id,
  assignee: 'sam-example',
  due: null,
  surfaceDate: null,
  project: null,
  client: null,
  created: null,
  source: null,
  details: '',
  version: 'v1',
});

function setStore(mine: TodoItem[], seen: Record<string, string> = {}) {
  store.current = {
    boot: {
      identity: { slug: 'sam-example', name: 'Sam Example', role: 'team' },
      prefs: { todoSeen: seen },
    },
    todos: { mine },
    sessions: { live: [] },
    view: 'chat',
    activeChat: { kind: 'new' },
    newChat: vi.fn(),
    openView: vi.fn(),
  };
}
afterEach(cleanup);

describe('Rail to-dos item', () => {
  it('says how many are new and shows the pip', () => {
    setStore([todo('a.md', 'ben-mcadam'), todo('b.md', null)]);
    const { container } = render(<Rail />);
    expect(screen.getByRole('button', { name: 'To-dos, 2 of yours, 1 new' })).toBeTruthy();
    expect(container.querySelector('.rail-pip[data-new="true"]')).toBeTruthy();
  });

  it('has no pip and no "new" when nothing is new', () => {
    setStore([todo('a.md', 'ben-mcadam')], { 'a.md': at });
    const { container } = render(<Rail />);
    expect(screen.getByRole('button', { name: 'To-dos, 1 of yours' })).toBeTruthy();
    expect(container.querySelector('.rail-pip[data-new="true"]')).toBeNull();
  });
});
