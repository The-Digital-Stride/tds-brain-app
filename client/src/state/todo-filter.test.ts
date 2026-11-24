import { describe, expect, it } from 'vitest';
import type { AskedTodo, TodoItem } from '../../../shared/contract.ts';
import { EMPTY_FILTER, filterActive, filterAsked, filterTodos } from './todo-filter.ts';

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
  attachments: [],
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

describe('the project filter', () => {
  const inProject = (id: string, key: string) =>
    todo(id, { projectMatch: { how: 'key', key }, project: key });
  const items = [
    inProject('a', 'acme/website'),
    inProject('b', 'bolt/seo'),
    todo('c'),
    todo('d', { projectMatch: { how: 'loose', label: 'website' }, project: 'website' }),
  ];

  it('keeps only the tasks whose project resolves to the key', () => {
    expect(ids(filterTodos(items, { ...EMPTY_FILTER, project: 'acme/website' }, clients))).toEqual(['a']);
    expect(filterActive({ ...EMPTY_FILTER, project: 'acme/website' })).toBe(true);
  });

  it('treats an older server (no projectMatch) as no project', () => {
    expect(
      ids(filterTodos(items, { scope: 'all', client: null, project: 'acme/website' }, clients)),
    ).not.toContain('c');
    expect(filterTodos(items, { scope: 'all', client: null }, clients)).toBe(items);
  });

  it('combines with the client filter', () => {
    const f = { scope: 'all' as const, client: 'bolt', project: 'acme/website' };
    expect(
      filterTodos(
        [todo('x', { client: 'bolt', projectMatch: { how: 'key', key: 'acme/website' } })],
        f,
        clients,
      ),
    ).toHaveLength(1);
    expect(filterTodos(items, f, clients)).toEqual([]);
  });
});

describe('filterAsked', () => {
  const asked = (id: string, over: Partial<AskedTodo> = {}) => ({ key: id, ...over }) as AskedTodo;
  const rows = [
    asked('a', { client: 'acme', projectMatch: { how: 'key', key: 'acme/site' } }),
    asked('b', { client: 'bolt' }),
    // An older server sends neither: it matches only "All".
    asked('c'),
  ];
  it('narrows by client and project, and returns the list itself with no filter', () => {
    expect(filterAsked(rows, EMPTY_FILTER)).toBe(rows);
    expect(filterAsked(rows, { ...EMPTY_FILTER, project: 'acme/site' }).map((t) => t.key)).toEqual(['a']);
    expect(filterAsked(rows, { ...EMPTY_FILTER, client: 'bolt' }).map((t) => t.key)).toEqual(['b']);
  });
});
