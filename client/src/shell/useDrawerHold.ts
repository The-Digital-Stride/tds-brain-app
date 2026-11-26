import { useCallback, useContext, useEffect } from 'react';
import { ShellContext } from './shell-context.ts';

/**
 * For the unsent chat in the chat drawer: tells the shell's drawer hold whether the box holds typed work, so anything
 * that would replace or close it asks first (plan 2026-11-26-project-chat-in-place, decision 8). Its own hold, not the
 * sheet's: the sheet's slot is shared by the forms on the page. Reported clean again when the drawer unmounts. `asking`:
 * something is held and the drawer should show "Keep writing / Discard"; `keep` and `discard` answer it. Outside a
 * ShellProvider it never asks.
 */
export function useDrawerHold(dirty: boolean): { asking: boolean; keep: () => void; discard: () => void } {
  const s = useContext(ShellContext);
  const dispatch = s?.dispatch;
  useEffect(() => {
    dispatch?.({ type: 'set-drawer-dirty', dirty });
  }, [dirty, dispatch]);
  useEffect(() => () => dispatch?.({ type: 'set-drawer-dirty', dirty: false }), [dispatch]);
  const keep = useCallback(() => dispatch?.({ type: 'keep-drawer' }), [dispatch]);
  const discard = useCallback(() => dispatch?.({ type: 'discard-drawer' }), [dispatch]);
  return { asking: s?.drawerHold?.asking ?? false, keep, discard };
}
