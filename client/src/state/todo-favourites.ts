import type { TodoItem } from '../../../shared/contract.ts';

/**
 * Favourite to-dos (plan 2026-11-14-todo-favourites) are keyed by `TodoItem.key`. Splits a list into the starred
 * ones and the rest, each keeping the order given, so a starred to-do shows once, in Favourites.
 */
export function splitFavouriteTodos(
  items: TodoItem[],
  favs: readonly string[],
): { favourites: TodoItem[]; rest: TodoItem[] } {
  if (favs.length === 0) return { favourites: [], rest: items };
  const starred = new Set(favs);
  const favourites: TodoItem[] = [];
  const rest: TodoItem[] = [];
  for (const t of items) (starred.has(t.key) ? favourites : rest).push(t);
  return { favourites, rest };
}
