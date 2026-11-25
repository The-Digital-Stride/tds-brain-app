import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { Icon } from './Icon.tsx';

/**
 * The star that keeps an item at the top of its list (plans 2026-11-14-chat-favourites and -todo-favourites).
 * The label stays the same and `aria-pressed` says whether it is on.
 */
export function StarButton({
  id,
  title,
  on,
  onPress,
}: {
  id: string;
  title: string;
  on: boolean;
  onPress: (id: string, button: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className="icon-btn star-btn"
      aria-pressed={on}
      aria-label={`Pin: ${title}`}
      data-tip="Pin"
      data-star-id={id}
      onClick={(e) => onPress(id, e.currentTarget)}
    >
      <Icon name="pin" size={16} />
    </button>
  );
}

/** One shared empty list, so prefs without a list don't look like a change on every render. */
export const NO_FAVOURITES: readonly string[] = [];
/** How long after a star press focus may still follow that item (a failed save puts it back). */
const STAR_FOCUS_MS = 15_000;

/**
 * A starred or unstarred item moves to another place in its list, so its button is a new one and focus drops to
 * the page. When the stars change, focus goes back to that item's star, else the star that came next when it was
 * pressed, else `root`. The press is kept for a while, not for one move only, so a failed save that puts the star
 * back also brings focus back. Answers the function to call on each press, before the star is toggled.
 */
export function useStarFocus(
  root: RefObject<HTMLElement | null>,
  favs: readonly string[],
): (id: string, button: HTMLElement) => void {
  const want = useRef<{ id: string; next: string | null; favs: readonly string[]; at: number } | null>(null);
  useEffect(() => {
    const w = want.current;
    // Only a real change of stars moves a row; a reply with the same list must not take focus.
    if (!w || sameList(w.favs, favs)) return;
    if (Date.now() - w.at > STAR_FOCUS_MS) {
      want.current = null;
      return;
    }
    w.favs = favs;
    // Only when the row's move dropped focus to the page: never from something the person has moved on to.
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const stars = visibleStars(root.current);
    const target =
      stars.find((b) => b.dataset.starId === w.id) ?? stars.find((b) => b.dataset.starId === w.next);
    if (target && active !== target) target.focus();
    else if (!target) root.current?.focus();
  }, [favs, root]);
  return useCallback(
    (id: string, button: HTMLElement) => {
      const stars = visibleStars(root.current);
      const at = stars.indexOf(button as HTMLButtonElement);
      const next = stars[at + 1] ?? stars[at - 1];
      want.current = { id, next: next?.dataset.starId ?? null, favs, at: Date.now() };
    },
    [root, favs],
  );
}

/** The star buttons a person can reach: rows in a folded group stay in the page but hidden. */
function visibleStars(root: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(root?.querySelectorAll<HTMLButtonElement>('[data-star-id]') ?? []).filter(
    (b) => !b.closest('[hidden]'),
  );
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a === b || (a.length === b.length && a.every((x, i) => x === b[i]));
