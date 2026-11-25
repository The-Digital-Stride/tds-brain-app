import { useCallback } from 'react';
import type { AppPrefs } from '../../../shared/contract.ts';
import { usePrefList } from './pref-list.ts';

/** The prefs lists a star saves to (plans 2026-11-14-chat-favourites and 2026-11-14-todo-favourites). */
export type FavouriteField = 'favouriteChats' | 'favouriteTodos' | 'favouriteFiles';

export interface FavouriteList {
  /** Stars or unstars one id. The star moves at once; a failure puts the saved list back. */
  toggle: (id: string) => Promise<void>;
  /** Swaps `from` for `to` in place, if `from` is starred (a to-do that moved and got a new key). */
  rename: (from: string, to: string) => Promise<void>;
  /** A prefs reply for another setting, with this list kept as shown while one of its saves is waiting. */
  keep: (prefs: AppPrefs) => AppPrefs;
  /** A bootstrap's prefs begun at `begun`, with this list kept as shown when a save came after (see `usePrefList`). */
  keepBoot: (prefs: AppPrefs, begun: number) => AppPrefs;
}

/** One favourites list in the app's prefs, saved by the list engine in `pref-list.ts`. */
export function useFavouriteList({
  field,
  max,
  current,
  save,
  show,
  onError,
}: {
  field: FavouriteField;
  max: number;
  /** The list in the app's state now (`boot.prefs[field]`). */
  current: string[] | undefined;
  /** Sends `{ [field]: list }` and answers the saved prefs. */
  save: (patch: Partial<AppPrefs>) => Promise<AppPrefs>;
  /** Puts a list in the app's state. */
  show: (field: FavouriteField, list: string[]) => void;
  onError: (err: unknown) => void;
}): FavouriteList {
  const { set, keep, keepBoot } = usePrefList({ field, current, save, show, onError });

  const toggle = useCallback(
    // Over the cap the oldest star goes, as the server keeps the newest (it refuses a longer list).
    (id: string) =>
      set((favs) => (favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id].slice(-max))),
    [set, max],
  );

  const rename = useCallback(
    (from: string, to: string) =>
      set((favs) =>
        from === to || !favs.includes(from) ? null : [...new Set(favs.map((f) => (f === from ? to : f)))],
      ),
    [set],
  );

  return { toggle, rename, keep, keepBoot };
}
