/**
 * The deep-dive tables' layout as the person arranged it: their order, and which ones span the full width.
 * Kept in this browser's localStorage (a per-person convenience, never written to the brain). One layout for
 * every account: table ids are the same kinds of table everywhere (`readTables`).
 */

export const TABLE_LAYOUT_KEY = 'tds.adManager.tableLayout.v1';
const MAX_IDS = 32;
const MAX_ID_LENGTH = 64;

export interface TableLayout {
  /** Table ids in the person's order. Tables not listed follow, in the default order. */
  order: string[];
  /** Table ids shown across both columns. */
  wide: string[];
}

type Readable = Pick<Storage, 'getItem'> | null | undefined;
type Writable = Pick<Storage, 'setItem'> | null | undefined;

const empty = (): TableLayout => ({ order: [], wide: [] });

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Saved ids first (those this account has), then the rest in their default order. */
export function arrange<T extends { id: string }>(tables: T[], saved: string[]): T[] {
  const byId = new Map(tables.map((t) => [t.id, t]));
  const first = saved.flatMap((id) => {
    const t = byId.get(id);
    byId.delete(id);
    return t ? [t] : [];
  });
  return [...first, ...tables.filter((t) => byId.has(t.id))];
}

/** The shown order with one table moved to place `to` (clamped to the ends). */
export function moveTable(shown: string[], id: string, to: number): string[] {
  const from = shown.indexOf(id);
  if (from < 0) return shown;
  const rest = shown.filter((x) => x !== id);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * The saved order with this account's tables put in their new order, keeping every other saved table
 * (one this account doesn't have) in its place, so arranging a smaller account never reshuffles a bigger one.
 */
export function mergeOrder(saved: string[], shown: string[]): string[] {
  const base = [...saved, ...shown.filter((id) => !saved.includes(id))];
  let next = 0;
  return base.map((id) => (shown.includes(id) ? (shown[next++] as string) : id));
}

function cleanIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ID_LENGTH || out.includes(v)) continue;
    out.push(v);
    if (out.length === MAX_IDS) break;
  }
  return out;
}

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
