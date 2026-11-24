/**
 * The project To-dos tab's Everyone / Mine switch. "Mine" means what the To-dos drawer's Mine tab means: to-dos
 * assigned to this person, plus their personal ones (only ever their own). Open-to-anyone ones stay under Everyone.
 * The choice is kept per person in this browser's localStorage: a convenience, never written to the brain.
 */

import { browserStorage } from '../../state/card-order.ts';

export type TodoWho = 'everyone' | 'mine';

type Readable = Pick<Storage, 'getItem'> | null | undefined;
type Writable = Pick<Storage, 'setItem'> | null | undefined;

/** Per person (identity slug), so people sharing a browser each keep their own. */
export function todoWhoKey(person: string): string {
  return `tds.projects.todoWho.v1:${person}`;
}

/** A row of the tab (open or done) that is this person's. */
export function isMyTodo(row: { assignee: string | null; scope: string }, me: string): boolean {
  return row.scope === 'personal' || (row.assignee !== null && row.assignee === me);
}

/** The saved choice; Everyone when there is none, it can't be read, or it is not one we know. */
export function readTodoWho(person: string, storage: Readable = browserStorage()): TodoWho {
  try {
    return storage?.getItem(todoWhoKey(person)) === 'mine' ? 'mine' : 'everyone';
  } catch {
    return 'everyone';
  }
}

export function saveTodoWho(person: string, who: TodoWho, storage: Writable = browserStorage()): void {
  try {
    storage?.setItem(todoWhoKey(person), who);
  } catch {
    // Storage full or blocked: the switch still works for this visit.
  }
}
