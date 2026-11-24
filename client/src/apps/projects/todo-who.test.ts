import { describe, expect, it } from 'vitest';
import { isMyTodo, readTodoWho, saveTodoWho, todoWhoKey } from './todo-who.ts';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('isMyTodo', () => {
  it("counts tasks assigned to me and my personal ones, never a teammate's or an open-to-anyone one", () => {
    expect(isMyTodo({ assignee: 'sam', scope: 'tds' }, 'sam')).toBe(true);
    expect(isMyTodo({ assignee: null, scope: 'personal' }, 'sam')).toBe(true);
    expect(isMyTodo({ assignee: 'ben', scope: 'tds' }, 'sam')).toBe(false);
    expect(isMyTodo({ assignee: null, scope: 'tds' }, 'sam')).toBe(false);
  });
});

describe('the remembered choice', () => {
  it('is Everyone until Mine is saved, and is kept per person', () => {
    const s = memory();
    expect(readTodoWho('sam', s)).toBe('everyone');
    saveTodoWho('sam', 'mine', s);
    expect(readTodoWho('sam', s)).toBe('mine');
    expect(readTodoWho('ben', s)).toBe('everyone');
    expect(s.m.get(todoWhoKey('sam'))).toBe('mine');
  });

  it('falls back to Everyone for an unknown value, no storage, or storage that throws', () => {
    const s = memory();
    s.setItem(todoWhoKey('sam'), 'nonsense');
    expect(readTodoWho('sam', s)).toBe('everyone');
    expect(readTodoWho('sam', null)).toBe('everyone');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(readTodoWho('sam', broken)).toBe('everyone');
    expect(() => saveTodoWho('sam', 'mine', broken)).not.toThrow();
  });
});
