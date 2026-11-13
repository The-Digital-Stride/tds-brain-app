import type { FilterTodos, TodoFilter } from '../shell/contract.ts';

/** True while a kind or client filter is set, which is when the drawer forces every group open. */
export function filterActive(f: TodoFilter): boolean {
  return f.scope !== 'all' || f.client !== null;
}

/** `query` stays in the contract type only until it is dropped: the drawer has no search row any more. */
export const EMPTY_FILTER: TodoFilter = { scope: 'all', client: null };

/**
 * The drawer's filters, applied in the browser: kind (TDS or personal) and client. Text search lives in
 * the global search now (`search-sources.ts`). Keeps the order given; a clear filter returns `items` itself.
 */
export const filterTodos: FilterTodos = (items, filter) => {
  if (!filterActive(filter)) return items;
  return items.filter((t) => {
    if (filter.scope !== 'all' && t.scope !== filter.scope) return false;
    return filter.client === null || t.client === filter.client;
  });
};
