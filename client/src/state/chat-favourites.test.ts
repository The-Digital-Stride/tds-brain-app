import { describe, expect, it } from 'vitest';
import type { PastSession } from '../../../shared/contract.ts';
import { favouritesFirst, isFavourite, splitFavourites } from './chat-favourites.ts';

const past = (id: string): PastSession => ({ sdkSessionId: id, title: id, lastModified: '', kind: 'tds' });
const live = (id: string | null) => ({ sdkSessionId: id, name: id ?? 'new' });

describe('chat favourites', () => {
  it('puts favourites first and keeps the order given in each part', () => {
    const list = [live('a'), live('b'), live('c'), live('d')];
    // The order starred (d before b) does not matter: the list's own order does.
    expect(favouritesFirst(list, ['d', 'b']).map((c) => c.name)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('never counts a chat with no session id yet as a favourite', () => {
    const list = [live('a'), live(null)];
    expect(isFavourite(live(null), ['a'])).toBe(false);
    expect(favouritesFirst(list, ['a']).map((c) => c.name)).toEqual(['a', 'new']);
  });

  it('returns the same order when nothing is starred, or only unknown ids are', () => {
    const list = [live('a'), live('b')];
    expect(favouritesFirst(list, [])).toEqual(list);
    expect(favouritesFirst(list, ['zzz'])).toEqual(list);
  });

  it('splits earlier chats into favourites and the rest, each in the order given', () => {
    const { favourites, rest } = splitFavourites([past('a'), past('b'), past('c')], ['c', 'a']);
    expect(favourites.map((s) => s.sdkSessionId)).toEqual(['a', 'c']);
    expect(rest.map((s) => s.sdkSessionId)).toEqual(['b']);
  });
});
