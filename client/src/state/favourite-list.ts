import { useCallback, useEffect, useRef } from 'react';
import type { AppPrefs } from '../../../shared/contract.ts';

/** The prefs lists a star saves to (plans 2026-11-14-chat-favourites and 2026-11-14-todo-favourites). */
export type FavouriteField = 'favouriteChats' | 'favouriteTodos' | 'favouriteFiles';

export interface FavouriteList {
  /** Stars or unstars one id. The star moves at once; a failure puts the saved list back. */
  toggle: (id: string) => Promise<void>;
  /** Swaps `from` for `to` in place, if `from` is starred (a to-do that moved and got a new key). */
  rename: (from: string, to: string) => Promise<void>;
  /** A prefs reply for another setting, with this list kept as shown while one of its saves is waiting. */
  keep: (prefs: AppPrefs) => AppPrefs;
}

/**
 * One favourites list in the app's prefs. `latest` is the list as shown, so quick taps each build on the one
 * before; `saved` is the last list the server confirmed; `turn` counts the saves so only the newest reply (or
 * failure) is shown; `pending` counts saves still waiting, while which another setting's reply must not replace
 * the stars.
 */
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
  const latest = useRef<string[]>([]);
  const saved = useRef<string[]>([]);
  const turn = useRef(0);
  const pending = useRef(0);
  const savedTurn = useRef(0);
  /** The newest tap whose save failed, so a late success from an older tap can still correct the stars. */
  const failedTurn = useRef(0);
  // The latest callbacks, so the returned functions stay the same across renders.
  const deps = useRef({ save, show, onError });
  deps.current = { save, show, onError };

  useEffect(() => {
    if (pending.current > 0) return;
    latest.current = current ?? [];
    saved.current = latest.current;
  }, [current]);

  const keep = useCallback(
    (prefs: AppPrefs): AppPrefs => {
      if (pending.current === 0) return prefs;
      saved.current = prefs[field] ?? [];
      return { ...prefs, [field]: latest.current };
    },
    [field],
  );

  const send = useCallback(
    async (list: string[]) => {
      const { save, show, onError } = deps.current;
      latest.current = list;
      const mine = ++turn.current;
      show(field, list);
      pending.current += 1;
      try {
        const prefs = await save({ [field]: list });
        // A late reply to an older tap must not stand in for a newer saved list.
        if (mine > savedTurn.current) {
          savedTurn.current = mine;
          saved.current = prefs[field] ?? [];
        }
        pending.current -= 1;
        if (mine === turn.current) show(field, saved.current);
        else if (pending.current === 0 && failedTurn.current === turn.current) {
          // The newest tap failed and this older one was saved after all: show what the server holds.
          latest.current = saved.current;
          show(field, saved.current);
        }
      } catch (err) {
        pending.current -= 1;
        onError(err);
        // The change did not stick: show what the server last saved, unless a newer tap has moved on.
        if (mine === turn.current) {
          failedTurn.current = mine;
          latest.current = saved.current;
          show(field, saved.current);
        }
      }
    },
    [field],
  );

  const toggle = useCallback(
    async (id: string) => {
      const favs = latest.current;
      // Over the cap the oldest star goes, as the server keeps the newest (it refuses a longer list).
      await send(favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id].slice(-max));
    },
    [send, max],
  );

  const rename = useCallback(
    async (from: string, to: string) => {
      const favs = latest.current;
      if (from === to || !favs.includes(from)) return;
      await send([...new Set(favs.map((f) => (f === from ? to : f)))]);
    },
    [send],
  );

  return { toggle, rename, keep };
}
