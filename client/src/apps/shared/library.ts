import type { LibraryItem, LibraryScope } from '../../../../shared/contract.ts';

/** A card shows this many items until "Show all" is pressed. */
export const FIRST_SHOWN = 60;

/**
 * Which library to show. What the person chose, if it is still listed; else the last client they
 * used; else the first client. Their own files only when no client exists, so private titles are
 * never on screen unasked. '' when nothing is listed.
 */
export function pickScope(scopes: LibraryScope[], lastClient: string | null, chosen: string): string {
  const listed = (id: string) => scopes.some((s) => s.id === id);
  if (chosen && listed(chosen)) return chosen;
  if (lastClient && listed(`client:${lastClient}`)) return `client:${lastClient}`;
  const firstClient = scopes.find((s) => s.kind === 'client');
  if (firstClient) return firstClient.id;
  return scopes.find((s) => s.kind === 'personal')?.id ?? scopes[0]?.id ?? '';
}

export interface ItemGroup<T> {
  group: string;
  items: T[];
}

/** The cards, in the order the server gave them, each with its items in the order given. Empty cards are left out. */
export function groupItems<T extends Pick<LibraryItem, 'group'>>(
  items: T[],
  order: string[],
): ItemGroup<T>[] {
  const by = new Map<string, T[]>();
  for (const item of items) {
    const list = by.get(item.group);
    if (list) list.push(item);
    else by.set(item.group, [item]);
  }
  const known = order.filter((g) => by.has(g));
  // A group the order does not name goes last rather than being lost.
  const extra = [...by.keys()].filter((g) => !order.includes(g));
  return [...known, ...extra].map((group) => ({ group, items: by.get(group) ?? [] }));
}

/** "1200 × 628", or null when the size is not known. */
export function pictureWords(item: Pick<LibraryItem, 'width' | 'height'>): string | null {
  return item.width && item.height ? `${item.width} × ${item.height}` : null;
}
