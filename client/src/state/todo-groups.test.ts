import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../../../shared/contract.ts';
import { groupTodos } from './todo-groups.ts';

const TODAY = '2026-11-11';
const item = (id: string, due: string | null): TodoItem => ({
  id,
  title: id,
  created: null,
  source: null,
  details: '',
  assignee: null,
  due,
  surfaceDate: null,
  project: null,
  client: null,
});

const keysOf = (items: TodoItem[]) => groupTodos(items, TODAY).map((g) => g.key);

describe('groupTodos', () => {
  it('puts each date in the right group', () => {
    const groups = groupTodos(
      [
        item('past', '2026-11-10'),
        item('today', '2026-11-11'),
        item('tomorrow', '2026-11-12'),
        item('day7', '2026-11-18'),
        item('day8', '2026-11-19'),
        item('none', null),
      ],
      TODAY,
    );
    const by = Object.fromEntries(groups.map((g) => [g.key, g.items.map((i) => i.id)]));
    expect(by).toEqual({
      overdue: ['past'],
      today: ['today'],
      week: ['tomorrow', 'day7'],
      later: ['day8'],
      none: ['none'],
    });
  });

  it('titles the groups and lists them in order', () => {
    const groups = groupTodos(
      [
        item('n', null),
        item('l', '2027-01-01'),
        item('w', '2026-11-13'),
        item('t', TODAY),
        item('o', '2020-01-01'),
      ],
      TODAY,
    );
    expect(groups.map((g) => g.title)).toEqual(['Overdue', 'Today', 'This week', 'Later', 'No date']);
  });

  it('keeps the order given inside a group', () => {
    const groups = groupTodos(
      [item('b', '2026-11-14'), item('a', '2026-11-13'), item('c', '2026-11-12')],
      TODAY,
    );
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('drops empty groups', () => {
    expect(keysOf([item('x', null)])).toEqual(['none']);
    expect(keysOf([])).toEqual([]);
  });

  it('treats an unreadable date as no date', () => {
    expect(keysOf([item('x', 'soon')])).toEqual(['none']);
  });
});
