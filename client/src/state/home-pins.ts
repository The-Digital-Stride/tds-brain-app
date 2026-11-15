import type { LiveSession, PastSession, TodoItem } from '../../../shared/contract.ts';
import { isFavourite, splitFavourites } from './chat-favourites.ts';
import { sortChats } from './chats.ts';
import { splitFavouriteTodos } from './todo-favourites.ts';

/** How many rows a pinned card shows on Home; the rest are one click away in the drawer or app. */
export const PINNED_ROWS = 5;

/**
 * The starred to-dos Home lists (plan 2026-11-15-home-pinned-cards): the person's own, then ones open to anyone,
 * in the order the To-dos drawer shows its Favourites.
 */
export function pinnedTodos(mine: TodoItem[], open: TodoItem[], favs: readonly string[]): TodoItem[] {
  return splitFavouriteTodos([...mine, ...open], favs).favourites;
}

export type PinnedChat = { kind: 'live'; chat: LiveSession } | { kind: 'past'; chat: PastSession };

/**
 * The starred chats Home lists, in the Chats drawer's order: open chats first (needs an answer, then working,
 * ready, stopped), then earlier ones as the drawer lists them. A chat open and earlier at once shows once.
 */
export function pinnedChats(live: LiveSession[], past: PastSession[], favs: readonly string[]): PinnedChat[] {
  if (favs.length === 0) return [];
  const open = sortChats(live).filter((s) => isFavourite(s, favs));
  const openIds = new Set(open.map((s) => s.sdkSessionId));
  const earlier = splitFavourites(past, favs).favourites.filter((s) => !openIds.has(s.sdkSessionId));
  return [
    ...open.map((chat): PinnedChat => ({ kind: 'live', chat })),
    ...earlier.map((chat): PinnedChat => ({ kind: 'past', chat })),
  ];
}

/** Newest pin first: the star list is stored oldest first, so a new pin is never hidden by the row cap. */
export function pinnedFileIds(favs: readonly string[]): string[] {
  return [...favs].reverse();
}
