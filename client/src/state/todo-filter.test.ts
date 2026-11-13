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
  it('matches title, details, client name and project, ignoring case and accents', () => {
    const q = (query: string) => ids(filterTodos(items, { ...EMPTY_FILTER, query }, clients));
    expect(q('contract')).toEqual(['a']);
    expect(q('residence')).toEqual(['b']);
    expect(q('CAFE')).toEqual(['a', 'c']);
    expect(q('  bolt ')).toEqual(['b']);
    expect(q('nothing')).toEqual([]);
  });
  it('matches a project by the words the row shows', () => {
    const list = [todo('w', { title: 'Plan', project: 'website-rebuild' })];
    expect(ids(filterTodos(list, { ...EMPTY_FILTER, query: 'website rebuild' }, clients))).toEqual(['w']);
  });
  it('filters by scope and by client, and combines them with the text', () => {
    expect(ids(filterTodos(items, { ...EMPTY_FILTER, scope: 'personal' }, clients))).toEqual(['c']);
    expect(ids(filterTodos(items, { ...EMPTY_FILTER, scope: 'tds' }, clients))).toEqual(['a', 'b']);
    expect(ids(filterTodos(items, { ...EMPTY_FILTER, client: 'bolt' }, clients))).toEqual(['b']);
    expect(ids(filterTodos(items, { query: 'ring', scope: 'tds', client: 'bolt' }, clients))).toEqual(['b']);
    expect(filterActive({ ...EMPTY_FILTER, client: 'bolt' })).toBe(true);
  });
});
