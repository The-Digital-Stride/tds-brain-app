import { describe, expect, it } from 'vitest';
import type { TodoHandover, TodoItem } from '../../../shared/contract.ts';
import { isNewToYou, newToYou } from './todo-new.ts';

const NOW = new Date('2026-11-13T12:00:00Z');
const handover = (over: Partial<TodoHandover> = {}): TodoHandover => ({
  by: 'ben-mcadam',
  byName: 'Ben McAdam',
  at: '2026-11-12T09:00:00+00:00',
  from: null,
  via: null,
  source: 'stamp',
  ...over,
});
const todo = (key: string, h: TodoHandover | null): TodoItem => ({
  id: key,
  scope: 'tds',
  key,
  path: `todo/${key}`,
  handover: h,
  createdBy: null,
  title: key,
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

describe('newToYou', () => {
  it('counts a recent handover by someone else that has not been seen', () => {
    const a = todo('a.md', handover());
    expect(newToYou([a], 'sam-example', {}, NOW)).toEqual([a]);
  });
  it('ignores your own handovers, old ones and to-dos with no handover', () => {
    const own = todo('own.md', handover({ by: 'sam-example' }));
    const old = todo('old.md', handover({ at: '2026-11-01T09:00:00+00:00' }));
    const none = todo('none.md', null);
    expect(newToYou([own, old, none], 'sam-example', {}, NOW)).toEqual([]);
  });
  it('stops counting once the marker is seen, but a newer handover is new again', () => {
    const a = todo('a.md', handover());
    expect(newToYou([a], 'sam-example', { 'a.md': '2026-11-12T09:00:00+00:00' }, NOW)).toEqual([]);
    expect(newToYou([a], 'sam-example', { 'a.md': '2026-11-10T09:00:00+00:00' }, NOW)).toEqual([a]);
  });
  it('keys the seen map by key, so a personal to-do and a TDS one with one name stay apart', () => {
    const p = { ...todo('personal/a.md', handover()), scope: 'personal' as const };
    expect(newToYou([p], 'sam-example', { 'a.md': p.handover?.at ?? '' }, NOW)).toEqual([p]);
  });
  it('keeps the order given and treats a bad date as not new', () => {
    const a = todo('a.md', handover());
    const b = todo('b.md', handover());
    expect(newToYou([b, a], 'sam-example', {}, NOW)).toEqual([b, a]);
    expect(isNewToYou(todo('c.md', handover({ at: 'nonsense' })), 'sam-example', {}, NOW)).toBe(false);
  });
});
