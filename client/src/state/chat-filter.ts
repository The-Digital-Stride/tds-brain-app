import type { ChatKind } from '../../../shared/contract.ts';

export type ChatKindFilter = 'all' | ChatKind;

/** A chat's kind; a missing one (an older server) counts as TDS. */
export const kindOf = (c: { kind?: ChatKind }): ChatKind => c.kind ?? 'tds';

/** Filters chats by kind, keeping the order given. 'all' returns `items` itself. */
export function filterChats<T extends { kind?: ChatKind }>(items: T[], filter: ChatKindFilter): T[] {
  if (filter === 'all') return items;
  return items.filter((c) => kindOf(c) === filter);
}
