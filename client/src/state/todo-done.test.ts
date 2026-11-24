import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DoneTodo, DoneTodoList } from '../../../shared/contract.ts';

const apiMock = vi.hoisted(() => ({ doneTodos: vi.fn() }));
vi.mock('../api.ts', () => ({ api: apiMock }));

const { doneStore, filterDone, groupDone, searchDone } = await import('./todo-done.ts');

const done = (id: string, title: string, at: string | null, over: Partial<DoneTodo> = {}): DoneTodo => ({
  key: `done:todo/done/${id}`,
  id,
  scope: 'tds',
  path: `todo/done/${id}`,
  title,
  assignee: null,
  assigneeName: null,
  due: null,
  details: '',
  done: at ? { slug: 'sam', name: 'Sam Example', at, source: 'stamp' } : null,
  version: 'v1',
  attachments: [],
  client: null,
  project: null,
  stage: null,
  ...over,
});

// Tuesday 24 November 2026.
const NOW = new Date(2026, 10, 24, 12, 0, 0);

describe('groupDone', () => {
  it('groups by when it was done, with unknown dates last', () => {
    const items = [
      done('a.md', 'A', new Date(2026, 10, 23, 9).toISOString()),
      done('b.md', 'B', new Date(2026, 10, 10, 9).toISOString()),
      done('c.md', 'C', new Date(2026, 9, 30, 9).toISOString()),
      done('d.md', 'D', new Date(2026, 9, 2, 9).toISOString()),
      done('e.md', 'E', new Date(2025, 11, 25, 9).toISOString()),
      done('f.md', 'F', null),
    ];
    const groups = groupDone(items, NOW);
    expect(groups.map((g) => g.title)).toEqual([
      'This week',
      'Earlier this month',
      'October 2026',
      'December 2025',
      'Date not known',
    ]);
    expect(groups[2]?.items.map((t) => t.id)).toEqual(['c.md', 'd.md']);
  });

  it('leaves empty groups out and treats a bad date as not known', () => {
    const bad = done('x.md', 'X', 'nonsense');
    expect(groupDone([bad], NOW).map((g) => g.title)).toEqual(['Date not known']);
    expect(groupDone([], NOW)).toEqual([]);
  });
});

describe('searchDone', () => {
  const ctx = { clients: [{ slug: 'acme', name: 'Acme Heating' }] };
  const items = [
    done('a.md', 'Send the quote', null, { details: 'Include the boiler options', client: 'acme' }),
    done('b.md', 'Book the van', null),
  ];
  it('matches every word across title, details and client, ignoring case', () => {
    expect(searchDone(items, 'QUOTE', ctx).map((t) => t.id)).toEqual(['a.md']);
    expect(searchDone(items, 'boiler quote', ctx).map((t) => t.id)).toEqual(['a.md']);
    expect(searchDone(items, 'heating', ctx).map((t) => t.id)).toEqual(['a.md']);
    expect(searchDone(items, 'quote van', ctx)).toEqual([]);
  });
  it('returns everything for an empty query', () => {
    expect(searchDone(items, '  ', ctx)).toBe(items);
  });
});

describe('filterDone', () => {
  const items = [
    done('a.md', 'A', null, { client: 'acme', projectMatch: { how: 'key', key: 'clients/acme/web' } }),
    done('b.md', 'B', null, { client: 'bolt' }),
  ];
  it('filters by client and by project', () => {
    expect(filterDone(items, { client: 'bolt', project: null })).toEqual([items[1]]);
    expect(filterDone(items, { client: null, project: 'clients/acme/web' })).toEqual([items[0]]);
    expect(filterDone(items, { client: null, project: null })).toBe(items);
  });
});

describe('doneStore', () => {
  afterEach(() => {
    doneStore.reset();
    apiMock.doneTodos.mockReset();
  });
  const list: DoneTodoList = { items: [], historyRead: true };

  it('loads once on ensure, sharing one request', async () => {
    apiMock.doneTodos.mockResolvedValue(list);
    doneStore.ensure();
    doneStore.ensure();
    void doneStore.refresh();
    expect(doneStore.get().loading).toBe(true);
    await doneStore.refresh();
    expect(apiMock.doneTodos).toHaveBeenCalledTimes(1);
    expect(doneStore.get()).toEqual({ list, loading: false, error: null });
  });

  it('keeps the last good list when a refresh fails', async () => {
    apiMock.doneTodos.mockResolvedValueOnce(list);
    await doneStore.refresh();
    apiMock.doneTodos.mockRejectedValueOnce(new Error('boom'));
    await doneStore.refresh();
    expect(doneStore.get().list).toBe(list);
    expect(doneStore.get().error).toBe('boom');
  });
});
