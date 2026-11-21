import type { AskedTodo, TodoItem } from '../../../shared/contract.ts';
import { matchedKey } from '../../../shared/projects.ts';
import type { TodoProjectMatch } from '../../../shared/projects-contract.ts';
import type { FilterTodos, TodoFilter } from '../shell/contract.ts';

/** True while a kind, client or project filter is set, which is when the drawer forces every group open. */
export function filterActive(f: TodoFilter): boolean {
  return f.scope !== 'all' || f.client !== null || Boolean(f.project);
}

/** `query` stays in the contract type only until it is dropped: the drawer has no search row any more. */
export const EMPTY_FILTER: TodoFilter = { scope: 'all', client: null, project: null };

/**
 * The project a to-do belongs to, as a key, or null. Older servers send no `projectMatch`: read as none.
 */
export function todoProjectKey(t: { projectMatch?: TodoProjectMatch }): string | null {
  return matchedKey(t.projectMatch ?? { how: 'none' });
}

/** What a to-do's row says about its project: the label of a loose match, else null (keys are named from the list). */
export function looseProjectLabel(t: Pick<TodoItem, 'projectMatch' | 'project'>): string | null {
  const m = t.projectMatch ?? { how: 'none' };
  if (m.how === 'loose') return m.label;
  if (m.how === 'client' || m.how === 'missing') return t.project;
  return null;
}

/**
 * The drawer's filters, applied in the browser: kind (TDS or personal), client and project. Text search
 * lives in the global search now (`search-sources.ts`). Keeps the order given; a clear filter returns
 * `items` itself.
 */
export const filterTodos: FilterTodos = (items, filter) => {
  if (!filterActive(filter)) return items;
  return items.filter((t) => {
    if (filter.scope !== 'all' && t.scope !== filter.scope) return false;
    if (filter.client !== null && t.client !== filter.client) return false;
    return !filter.project || todoProjectKey(t) === filter.project;
  });
};

/**
 * The drawer's client and project filters on the Asked tab. Everything there is TDS, so the kind filter
 * has nothing to narrow. An older server sends no client or project: such a row matches only "All".
 */
export function filterAsked(items: AskedTodo[], filter: TodoFilter): AskedTodo[] {
  if (filter.client === null && !filter.project) return items;
  return items.filter((t) => {
    if (filter.client !== null && (t.client ?? null) !== filter.client) return false;
    return !filter.project || todoProjectKey(t) === filter.project;
  });
}
