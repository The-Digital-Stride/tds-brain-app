import { type FocusEvent, useCallback, useRef } from 'react';

/**
 * For a form that asks "Discard your changes?" in a strip (shell/Confirm): the strip takes focus when it appears, so
 * "Keep editing" must give it back to what the person was doing. Put `track` on the form's `onFocus` (it bubbles) and
 * call `restore` when the question is answered with Keep. The strip's own buttons are never remembered, and an element
 * that has gone is skipped.
 */
export function useKeepFocus() {
  const last = useRef<HTMLElement | null>(null);
  const track = useCallback((e: FocusEvent<HTMLElement>) => {
    const el = e.target;
    if (el instanceof HTMLElement && !el.closest('.confirm')) last.current = el;
  }, []);
  const restore = useCallback(() => {
    const el = last.current;
    if (el?.isConnected) el.focus();
  }, []);
  return { track, restore };
}
