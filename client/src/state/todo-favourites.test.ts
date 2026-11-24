import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../../../shared/contract.ts';
import { splitFavouriteTodos } from './todo-favourites.ts';

const item = (id: string, scope: 'tds' | 'personal' = 'tds'): TodoItem => ({
  id,
  scope,
  key: scope === 'personal' ? `personal/${id}` : id,
  path: scope === 'personal' ? `personal/todo/${id}` : `todo/${id}`,
  handover: null,
  createdBy: null,
  title: id,
  created: null,
  source: null,
  details: '',
  version: 'v1',
  attachments: [],
  assignee: null,
  due: null,
  surfaceDate: null,
  project: null,
  client: null,
});

const ids = (items: TodoItem[]) => items.map((t) => t.key);

describe('splitFavouriteTodos', () => {
  it('takes starred tasks out, each part keeping the order given', () => {
    const items = [item('a'), item('b'), item('c', 'personal'), item('d')];
    const { favourites, rest } = splitFavouriteTodos(items, ['d', 'personal/c']);
    expect(ids(favourites)).toEqual(['personal/c', 'd']);
    expect(ids(rest)).toEqual(['a', 'b']);
  });

  it('matches by key, so a personal task and a TDS one with the same id are told apart', () => {
    const { favourites } = splitFavouriteTodos([item('x'), item('x', 'personal')], ['personal/x']);
    expect(ids(favourites)).toEqual(['personal/x']);
  });

  it('ignores stars for tasks not in the list, and returns the list itself when nothing is starred', () => {
    const items = [item('a')];
    expect(splitFavouriteTodos(items, ['gone'])).toEqual({ favourites: [], rest: items });
    expect(splitFavouriteTodos(items, []).rest).toBe(items);
  });
});
