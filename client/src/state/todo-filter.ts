import type { FilterTodos, TodoFilter } from '../shell/contract.ts';
import { todoPlaces } from '../shell/words.ts';

/** Lower case with accents removed, so "Café" matches "cafe". */
function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** True while any search or filter is set, which is when the drawer forces every group open. */
export function filterActive(f: TodoFilter): boolean {
  return f.query.trim() !== '' || f.scope !== 'all' || f.client !== null;
}

export const EMPTY_FILTER: TodoFilter = { query: '', scope: 'all', client: null };

/** Search and filter in the browser. Keeps the order given; a clear filter returns `items` itself. */
export const filterTodos: FilterTodos = (items, filter, clients) => {
  if (!filterActive(filter)) return items;
  const q = plain(filter.query.trim());
  return items.filter((t) => {
    if (filter.scope !== 'all' && t.scope !== filter.scope) return false;
    if (filter.client !== null && t.client !== filter.client) return false;
    if (q === '') return true;
    // What the row shows: the client and project as words ("Website rebuild"), never the folder name.
    const hay = plain([t.title, t.details, ...todoPlaces(t, clients)].join('\n'));
    return hay.includes(q);
  });
};
