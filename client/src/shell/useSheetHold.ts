import { useCallback, useContext, useEffect } from 'react';
import { ShellContext } from './shell-context.ts';

/**
 * For a form on the sheet (the project form): tells the shell's sheet hold whether it holds unsaved work, so a page
 * change asks first (plan 2026-11-23-ux-follow-ups, decision 1; design system, Actions rule 9). Reported clean again
 * when the form unmounts (after a save, a cancel or a discard). `asking`: a page change is held and the form should
 * show "Discard your changes?"; `keep` and `discard` answer it. Outside a ShellProvider (pieces tested on their own)
 * it never asks.
 */
export function useSheetHold(dirty: boolean): { asking: boolean; keep: () => void; discard: () => void } {
  const s = useContext(ShellContext);
  const dispatch = s?.dispatch;
  useEffect(() => {
    dispatch?.({ type: 'set-sheet-dirty', dirty });
  }, [dirty, dispatch]);
  useEffect(() => () => dispatch?.({ type: 'set-sheet-dirty', dirty: false }), [dispatch]);
  const keep = useCallback(() => dispatch?.({ type: 'keep-sheet' }), [dispatch]);
  const discard = useCallback(() => dispatch?.({ type: 'discard-sheet' }), [dispatch]);
  return { asking: s?.sheetHold?.asking ?? false, keep, discard };
}
