import { describe, expect, it } from 'vitest';
import type { TodoItem } from '../../../shared/contract.ts';
import { greeting, needsYou, summary } from './home.ts';

const todo = (id: string, due: string | null): TodoItem => ({
  id,
  title: id,
  created: null,
  source: null,
  details: '',
  assignee: 'sam-example',
  due,
  surfaceDate: null,
  project: null,
  client: null,
});

const TODAY = '2026-11-11';

describe('needsYou', () => {
  it('keeps overdue, today and tomorrow, soonest first, and leaves out later and undated', () => {
    const mine = [
      todo('later', '2026-11-13'),
      todo('tomorrow', '2026-11-12'),
      todo('none', null),
      todo('today', '2026-11-11'),
      todo('overdue', '2026-11-09'),
    ];
    const r = needsYou(mine, TODAY);
    expect(r.rows.map((t) => t.id)).toEqual(['overdue', 'today', 'tomorrow']);
    expect(r.count).toBe(3);
    expect(r.more).toBe(2);
  });

  it('shows at most 4 rows but counts them all', () => {
    const mine = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => todo(id, `2026-11-0${i + 1}`));
    const r = needsYou(mine, TODAY);
    expect(r.rows).toHaveLength(4);
    expect(r.count).toBe(6);
    expect(r.more).toBe(2);
  });

  it('copes with nothing', () => {
    expect(needsYou([], TODAY)).toEqual({ rows: [], count: 0, more: 0 });
  });

  it('crosses a month end for tomorrow', () => {
    const r = needsYou([todo('x', '2026-12-01')], '2026-11-30');
    expect(r.count).toBe(1);
  });
});

describe('greeting', () => {
  const at = (h: number, m: number) => new Date(2026, 10, 11, h, m);
  it('changes at 12:00 and 18:00', () => {
    expect(greeting(at(11, 59), 'Sam Example')).toBe('Good morning, Sam');
    expect(greeting(at(12, 0), 'Sam Example')).toBe('Good afternoon, Sam');
    expect(greeting(at(17, 59), 'Sam Example')).toBe('Good afternoon, Sam');
    expect(greeting(at(18, 0), 'Sam Example')).toBe('Good evening, Sam');
  });
  it('uses the first name only, and copes with an empty name', () => {
    expect(greeting(at(9, 0), '  Ian   Hancock ')).toBe('Good morning, Ian');
    expect(greeting(at(9, 0), '')).toBe('Good morning');
  });
});

describe('summary', () => {
  const s = (overdue: number, dueToday: number, asking: number) => summary({ overdue, dueToday, asking });
  it('says nothing is waiting when all are zero', () => {
    expect(s(0, 0, 0)).toBe('Nothing is waiting for you.');
  });
  it('reads singular and plural naturally', () => {
    expect(s(1, 0, 0)).toBe('One to-do is overdue.');
    expect(s(3, 0, 0)).toBe('3 to-dos are overdue.');
    expect(s(0, 1, 0)).toBe('One to-do is due today.');
    expect(s(0, 2, 0)).toBe('2 to-dos are due today.');
    expect(s(0, 0, 1)).toBe('One chat is waiting for you.');
    expect(s(0, 0, 3)).toBe('3 chats are waiting for you.');
  });
  it('joins two and three parts', () => {
    expect(s(1, 0, 1)).toBe('One to-do is overdue and one chat is waiting for you.');
    expect(s(3, 2, 0)).toBe('3 to-dos are overdue and 2 are due today.');
    expect(s(1, 1, 0)).toBe('One to-do is overdue and one is due today.');
    expect(s(3, 2, 1)).toBe('3 to-dos are overdue, 2 are due today and one chat is waiting for you.');
  });
});
