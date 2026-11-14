import type { PastSession } from '../../../shared/contract.ts';

/**
 * Favourite chats (plan 2026-11-14-chat-favourites) are keyed by `sdkSessionId`, so a chat keeps its star when
 * it moves between Open and Earlier. A new chat has no id until its first reply starts, and is never a favourite.
 */
export function isFavourite(chat: { sdkSessionId: string | null }, favs: readonly string[]): boolean {
  return chat.sdkSessionId !== null && favs.includes(chat.sdkSessionId);
}

/** Favourites first, then the rest; each part keeps the order given. */
export function favouritesFirst<T extends { sdkSessionId: string | null }>(
  items: T[],
  favs: readonly string[],
): T[] {
  if (favs.length === 0) return items;
  const starred: T[] = [];
  const rest: T[] = [];
  for (const c of items) (isFavourite(c, favs) ? starred : rest).push(c);
  return [...starred, ...rest];
}

/** Splits earlier chats into starred ones and the rest, each keeping the order given. */
export function splitFavourites(
  past: PastSession[],
  favs: readonly string[],
): { favourites: PastSession[]; rest: PastSession[] } {
  const favourites: PastSession[] = [];
  const rest: PastSession[] = [];
  for (const s of past) (isFavourite(s, favs) ? favourites : rest).push(s);
  return { favourites, rest };
}
