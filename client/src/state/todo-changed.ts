import type { AppPrefs, AskedTodo, AskedTodoList, TodoItem, TodoList } from '../../../shared/contract.ts';
import { type ChangeViewer, type TodoChange, todoChange } from '../../../shared/todo-changes.ts';
import { isNewToYou } from './todo-new.ts';

export interface ChangedTodos {
  /** Tasks you hold with something new, newest change first. */
  held: { todo: TodoItem; change: TodoChange }[];
  /** Tasks you asked for (waiting or done) with something new, newest change first. */
  asked: { todo: AskedTodo; change: TodoChange }[];
  /** How many tasks (not entries) have a change: what the rail badge adds to "New to you". */
  total: number;
}

const byNewest = (a: { change: TodoChange }, b: { change: TodoChange }): number =>
  Date.parse(b.change.at) - Date.parse(a.change.at) || 0;

/**
 * What changed since the person looked, across the tasks they hold and the ones they asked for. The rule itself is
 * `todoChange` in shared/todo-changes.ts; this only gathers the tasks. A held task that is "New to you" is left out:
 * its arrival is the news, not what came with it. A null `asked` list (not loaded yet, or failed) adds nothing.
 */
export function changedTodos(
  todos: Pick<TodoList, 'mine'>,
  asked: AskedTodoList | null,
  me: ChangeViewer,
  prefs: Partial<Pick<AppPrefs, 'todoSeen' | 'todoLooked'>>,
  now: Date,
): ChangedTodos {
  const seen = prefs.todoSeen ?? {};
  const looked = prefs.todoLooked ?? {};
  const heldRows: ChangedTodos['held'] = [];
  for (const todo of todos.mine) {
    if (isNewToYou(todo, me.slug, seen, now)) continue;
    const change = todoChange({ kind: 'held', todo }, me, looked[todo.id], now);
    if (change) heldRows.push({ todo, change });
  }
  const askedRows: ChangedTodos['asked'] = [];
  for (const todo of [...(asked?.waiting ?? []), ...(asked?.done ?? [])]) {
    const change = todoChange({ kind: 'asked', todo }, me, looked[todo.id], now);
    if (change) askedRows.push({ todo, change });
  }
  heldRows.sort(byNewest);
  askedRows.sort(byNewest);
  return { held: heldRows, asked: askedRows, total: heldRows.length + askedRows.length };
}
