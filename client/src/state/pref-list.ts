import { useCallback, useEffect, useRef } from 'react';
import type { AppPrefs } from '../../../shared/contract.ts';

/**
 * The prefs lists saved one whole list at a time, optimistically: the favourites (plans 2026-11-14-chat-favourites and
 * 2026-11-14-todo-favourites) and Home's hidden items and shortcuts (plan 2026-11-25-home-card-library, decision 7).
 */
export type PrefListField =
  | 'favouriteChats'
  | 'favouriteTodos'
  | 'favouriteFiles'
  | 'homeHidden'
  | 'homeShortcuts';

/** One entry of a prefs list: a string id, or a Home shortcut. */
export type PrefListItem<F extends PrefListField> = NonNullable<AppPrefs[F]>[number];

/**
 * Orders the saves and the bootstraps in this tab. A bootstrap takes a stamp when it begins and each save when it is
 * sent, so a bootstrap that lands late can tell it was read before a save.
 */
let clock = 0;
export function prefStamp(): number {
  clock += 1;
  return clock;
}

export interface PrefList<T> {
  /**
   * Shows the list `change` makes of the list as shown now, then saves it. `change` answering null means no change:
   * nothing is sent. Quick changes each build on the one before; the newest wins; a failure puts the saved list back.
   */
  set: (change: (list: readonly T[]) => T[] | null) => Promise<void>;
  /** A prefs reply for another setting, with this list kept as shown while one of its saves is waiting. */
  keep: (prefs: AppPrefs) => AppPrefs;
  /**
   * A bootstrap's prefs, begun at stamp `begun` (`prefStamp()`): this list is kept as shown while one of its saves is
   * waiting, or when its newest save was sent after the bootstrap began (the bootstrap read the list before it).
   */
  keepBoot: (prefs: AppPrefs, begun: number) => AppPrefs;
}

/**
 * One prefs list. `latest` is the list as shown, so quick changes each build on the one before; `saved` is the last
 * list the server confirmed; `turn` counts the saves so only the newest reply (or failure) is shown; `pending` counts
 * saves still waiting, while which another setting's reply must not replace the list; `sentAt` is the stamp of the
 * newest save, which a bootstrap begun before it must not undo.
 */
export function usePrefList<F extends PrefListField>({
  field,
  current,
  save,
  show,
  onError,
}: {
  field: F;
  /** The list in the app's state now (`boot.prefs[field]`). */
  current: readonly PrefListItem<F>[] | undefined;
  /** Sends `{ [field]: list }` and answers the saved prefs. */
  save: (patch: Partial<AppPrefs>) => Promise<AppPrefs>;
  /** Puts a list in the app's state. */
  show: (field: F, list: PrefListItem<F>[]) => void;
  onError: (err: unknown) => void;
}): PrefList<PrefListItem<F>> {
  type T = PrefListItem<F>;
  const latest = useRef<T[]>([]);
  const saved = useRef<T[]>([]);
  const turn = useRef(0);
  const pending = useRef(0);
  const savedTurn = useRef(0);
  const sentAt = useRef(0);
  /** The newest change whose save failed, so a late success from an older change can still correct the list. */
  const failedTurn = useRef(0);
  // The latest callbacks, so the returned functions stay the same across renders.
  const deps = useRef({ save, show, onError });
  deps.current = { save, show, onError };

  const read = useCallback((prefs: AppPrefs): T[] => [...((prefs[field] ?? []) as readonly T[])], [field]);

  useEffect(() => {
    if (pending.current > 0) return;
    latest.current = current ? [...current] : [];
    saved.current = latest.current;
  }, [current]);

  const keep = useCallback(
    (prefs: AppPrefs): AppPrefs => {
      if (pending.current === 0) return prefs;
      saved.current = read(prefs);
      return { ...prefs, [field]: latest.current };
    },
    [field, read],
  );

  const keepBoot = useCallback(
    (prefs: AppPrefs, begun: number): AppPrefs => {
      if (pending.current > 0) return keep(prefs);
      return sentAt.current > begun ? { ...prefs, [field]: latest.current } : prefs;
    },
    [field, keep],
  );

  const send = useCallback(
    async (list: T[]) => {
      const { save, show, onError } = deps.current;
      latest.current = list;
      const mine = ++turn.current;
      sentAt.current = prefStamp();
      show(field, list);
      pending.current += 1;
      try {
        const prefs = await save({ [field]: list } as Partial<AppPrefs>);
        // A late reply to an older change must not stand in for a newer saved list.
        if (mine > savedTurn.current) {
          savedTurn.current = mine;
          saved.current = read(prefs);
        }
        pending.current -= 1;
        if (mine === turn.current) show(field, saved.current);
        else if (pending.current === 0 && failedTurn.current === turn.current) {
          // The newest change failed and this older one was saved after all: show what the server holds.
          latest.current = saved.current;
          show(field, saved.current);
        }
      } catch (err) {
        pending.current -= 1;
        onError(err);
        // The change did not stick: show what the server last saved, unless a newer change has moved on.
        if (mine === turn.current) {
          failedTurn.current = mine;
          latest.current = saved.current;
          show(field, saved.current);
        }
      }
    },
    [field, read],
  );

  const set = useCallback(
    async (change: (list: readonly T[]) => T[] | null) => {
      const next = change(latest.current);
      if (next !== null) await send(next);
    },
    [send],
  );

  return { set, keep, keepBoot };
}
