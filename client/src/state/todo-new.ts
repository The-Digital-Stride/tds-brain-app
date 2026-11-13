import { TODO_NEW_DAYS, type TodoItem } from '../../../shared/contract.ts';
import type { NewToYou } from '../shell/contract.ts';

const DAY_MS = 86_400_000;

/** One to-do: is it "New to you" (decision 6)? Used by the list and, for a count, by the rail. */
export function isNewToYou(todo: TodoItem, me: string, seen: Record<string, string>, now: Date): boolean {
  const h = todo.handover;
  if (!h || h.by === me) return false;
  const at = Date.parse(h.at);
  if (Number.isNaN(at)) return false;
  if (now.getTime() - at > TODO_NEW_DAYS * DAY_MS) return false;
  return seen[todo.key] !== h.at;
}

/** The to-dos in `mine` that are new to the person, in the order given. */
export const newToYou: NewToYou = (mine, me, seen, now) => mine.filter((t) => isNewToYou(t, me, seen, now));
