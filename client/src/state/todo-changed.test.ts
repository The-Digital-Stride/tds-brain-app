import { describe, expect, it } from 'vitest';
import type { AskedTodo, AskedTodoList, TodoItem, TodoList } from '../../../shared/contract.ts';
import { lookedMark } from '../../../shared/todo-changes.ts';
import type { TodoUpdate } from '../../../shared/todo-updates-contract.ts';
import { changedTodos } from './todo-changed.ts';

const NOW = new Date('2026-11-27T12:00:00Z');
const me = { slug: 'sam-example', name: 'Sam Example' };

const note = (at: string, by = 'ben-mcadam', text = 'Hello'): TodoUpdate => ({
  kind: 'note',
  at,
  by,
  byName: 'Ben McAdam',
  text,
  via: null,
  action: 'update',
});

const held = (id: string, over: Partial<TodoItem> = {}): TodoItem =>
  ({
    id,
    scope: 'tds',
    key: id,
    path: `todo/${id}`,
    handover: null,
    title: id,
    assignee: 'sam-example',
    updates: [],
    ...over,
  }) as unknown as TodoItem;

const askedRow = (id: string, over: Partial<AskedTodo> = {}): AskedTodo =>
  ({
    key: `asked:todo/${id}`,
    id,
    state: 'waiting',
    title: id,
    asked: { slug: 'sam-example', name: 'Sam Example', at: '2026-11-10T09:00:00+00:00', source: 'stamp' },
    done: null,
    updates: [],
    ...over,
  }) as unknown as AskedTodo;

const list = (mine: TodoItem[]) => ({ mine, open: [], othersCount: 0 }) as unknown as TodoList;
const askedList = (waiting: AskedTodo[], done: AskedTodo[] = []): AskedTodoList => ({
  waiting,
  done,
  historyRead: true,
});

describe('changedTodos', () => {
  it('lists held tasks with a change, newest first, and counts them', () => {
    const a = held('a.md', { updates: [note('2026-11-25T10:00:00+00:00')] });
    const b = held('b.md', { updates: [note('2026-11-26T10:00:00+00:00')] });
    const quiet = held('c.md');
    const r = changedTodos(list([a, quiet, b]), null, me, {}, NOW);
    expect(r.held.map((x) => x.todo.id)).toEqual(['b.md', 'a.md']);
    expect(r.held[0]?.change.count).toBe(1);
    expect(r.asked).toEqual([]);
    expect(r.total).toBe(2);
  });

  it('leaves out a task that is new to you, and one already looked at', () => {
    const handover = {
      by: 'ben-mcadam',
      byName: 'Ben',
      at: '2026-11-26T09:00:00+00:00',
      from: null,
      via: null,
      source: 'stamp',
    };
    const fresh = held('new.md', { handover, updates: [note('2026-11-26T12:00:00+00:00')] } as never);
    const seen = held('seen.md', { updates: [note('2026-11-25T10:00:00+00:00')] });
    const todoLooked = { 'seen.md': lookedMark({ kind: 'held', todo: seen }, me, NOW) };
    expect(changedTodos(list([fresh, seen]), null, me, { todoLooked }, NOW).total).toBe(0);
    // Once it has been seen as new, the change counts.
    const todoSeen = { 'new.md': handover.at };
    expect(changedTodos(list([fresh]), null, me, { todoSeen }, NOW).held.map((x) => x.todo.id)).toEqual([
      'new.md',
    ]);
  });

  it('never counts personal tasks', () => {
    const p = held('p.md', { scope: 'personal', updates: [note('2026-11-25T10:00:00+00:00')] });
    expect(changedTodos(list([p]), null, me, {}, NOW).total).toBe(0);
  });

  it('lists asked tasks, waiting and done, newest first, and ignores a null list', () => {
    const w = askedRow('w.md', { updates: [note('2026-11-24T10:00:00+00:00')] });
    const d = askedRow('d.md', {
      state: 'done',
      done: { slug: 'ben-mcadam', name: 'Ben McAdam', at: '2026-11-26T10:00:00+00:00', source: 'stamp' },
    });
    const r = changedTodos(list([]), askedList([w], [d]), me, {}, NOW);
    expect(r.asked.map((x) => x.todo.id)).toEqual(['d.md', 'w.md']);
    expect(r.asked[0]?.change.finished).not.toBeNull();
    expect(r.total).toBe(2);
    expect(changedTodos(list([]), null, me, {}, NOW)).toEqual({ held: [], asked: [], total: 0 });
  });

  it('counts tasks, not entries', () => {
    const a = held('a.md', {
      updates: [note('2026-11-25T10:00:00+00:00'), note('2026-11-25T11:00:00+00:00', 'ben-mcadam', 'Two')],
    });
    const r = changedTodos(list([a]), null, me, {}, NOW);
    expect(r.held[0]?.change.count).toBe(2);
    expect(r.total).toBe(1);
  });
});
