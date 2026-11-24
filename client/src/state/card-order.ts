/**
 * The order a person has dragged a set of cards into (Home's cards; Ad Manager's deep-dive tables use the same
 * helpers through table-layout.ts). Kept in this browser's localStorage: a per-person convenience, never written to
 * the brain or shared.
 */

const MAX_IDS = 32;
const MAX_ID_LENGTH = 64;

type Readable = Pick<Storage, 'getItem'> | null | undefined;
type Writable = Pick<Storage, 'setItem'> | null | undefined;

export function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Home's card order for one person (identity slug), so people sharing a browser each keep their own. */
export function homeOrderKey(person: string): string {
  return `tds.home.cardOrder.v1:${person}`;
}

/** Saved ids first (those shown now), then the rest in their default order. */
export function arrange<T extends { id: string }>(items: T[], saved: string[]): T[] {
  const byId = new Map(items.map((t) => [t.id, t]));
  const first = saved.flatMap((id) => {
    const t = byId.get(id);
    byId.delete(id);
    return t ? [t] : [];
  });
  return [...first, ...items.filter((t) => byId.has(t.id))];
}

/** The shown order with one id moved to place `to` (clamped to the ends). */
export function moveItem(shown: string[], id: string, to: number): string[] {
  const from = shown.indexOf(id);
  if (from < 0) return shown;
  const rest = shown.filter((x) => x !== id);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * The saved order with the shown ids put in their new order, keeping every other saved id (a card not shown
 * now, such as Ads approvals with nothing waiting) in its place.
 */
export function mergeOrder(saved: string[], shown: string[]): string[] {
  const base = [...saved, ...shown.filter((id) => !saved.includes(id))];
  let next = 0;
  return base.map((id) => (shown.includes(id) ? (shown[next++] as string) : id));
}

export function cleanIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ID_LENGTH || out.includes(v)) continue;
    out.push(v);
    if (out.length === MAX_IDS) break;
  }
  return out;
}

export function readOrder(key: string, storage: Readable = browserStorage()): string[] {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return [];
    return cleanIds(JSON.parse(raw)) ?? [];
  } catch {
    return [];
  }
}

export function writeOrder(key: string, order: string[], storage: Writable = browserStorage()): void {
  try {
    storage?.setItem(key, JSON.stringify(order));
  } catch {
    // Storage blocked or full: the order lasts until the page reloads.
  }
}
