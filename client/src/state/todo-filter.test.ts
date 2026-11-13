import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../../../shared/contract.ts';
import { EMPTY_FILTER, filterActive, filterTodos } from './todo-filter.ts';

const clients = [
  { slug: 'acme', name: 'Acme Café' },
  { slug: 'bolt', name: 'Bolt Ltd' },
];
const todo = (id: string, over: Partial<TodoItem> = {}): TodoItem => ({
  id,
  scope: 'tds',
  key: id,
  path: `todo/${id}`,
  handover: null,
  createdBy: null,
  title: id,
  assignee: null,
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
const ids = (items: TodoItem[]) => items.map((t) => t.id);

describe('filterTodos', () => {
  const items = [
    todo('a', { title: 'Renew contract', client: 'acme' }),
    todo('b', { title: 'Ring Bob', details: 'About the RESIDENCE', client: 'bolt' }),
    todo('c', { title: 'Plan', project: 'acme', scope: 'personal' }),
  ];
  it('returns the same list for an empty filter', () => {
    expect(filterTodos(items, EMPTY_FILTER, clients)).toBe(items);
    expect(filterActive(EMPTY_FILTER)).toBe(false);
  });
  it('filters by scope and by client, and combines them', () => {
    expect(ids(filterTodos(items, { ...EMPTY_FILTER, scope: 'personal' }, clients))).toEqual(['c']);
    expect(ids(filterTodos(items, { ...EMPTY_FILTER, scope: 'tds' }, clients))).toEqual(['a', 'b']);
    expect(ids(filterTodos(items, { ...EMPTY_FILTER, client: 'bolt' }, clients))).toEqual(['b']);
    expect(ids(filterTodos(items, { ...EMPTY_FILTER, scope: 'personal', client: 'bolt' }, clients))).toEqual(
      [],
    );
    expect(filterActive({ ...EMPTY_FILTER, client: 'bolt' })).toBe(true);
  });
});
