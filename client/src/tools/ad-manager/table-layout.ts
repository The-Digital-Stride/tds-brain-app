import { browserStorage, cleanIds } from '../../state/card-order.ts';

/**
 * The deep-dive tables' layout as the person arranged it: their order, and which ones span the full width.
 * Kept in this browser's localStorage (a per-person convenience, never written to the brain). One layout for
 * every account: table ids are the same kinds of table everywhere (`readTables`).
 */

export const TABLE_LAYOUT_KEY = 'tds.adManager.tableLayout.v1';
export interface TableLayout {
  /** Table ids in the person's order. Tables not listed follow, in the default order. */
  order: string[];
  /** Table ids shown across both columns. */
  wide: string[];
}

type Readable = Pick<Storage, 'getItem'> | null | undefined;
type Writable = Pick<Storage, 'setItem'> | null | undefined;

const empty = (): TableLayout => ({ order: [], wide: [] });

/** The shared card-order helpers (client/src/state/card-order.ts), under the names this tool has always used. */
export { arrange, mergeOrder, moveItem as moveTable } from '../../state/card-order.ts';

export function readLayout(storage: Readable = browserStorage()): TableLayout {
  try {
    const raw = storage?.getItem(TABLE_LAYOUT_KEY);
    if (!raw) return empty();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty();
    const { order, wide } = parsed as Record<string, unknown>;
    return { order: cleanIds(order) ?? [], wide: cleanIds(wide) ?? [] };
  } catch {
    return empty();
  }
}

export function writeLayout(layout: TableLayout, storage: Writable = browserStorage()): void {
  try {
    storage?.setItem(TABLE_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Storage blocked or full: the layout lasts until the page reloads.
  }
}
