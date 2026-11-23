import { useEffect, useRef } from 'react';
import { useShell } from '../../shell/ShellProvider.tsx';

/**
 * Tells the shell this panel holds typed work while `dirty`, so closing the panel, or anything run through
 * `guardPanel`, asks "Discard your changes?" first (design system, Actions rule 9). The work is reported clean again
 * on save, on discard and when the panel unmounts. `onDiscarded` runs when the shell drops the work on "Discard
 * changes", so the boxes empty even if the panel stays mounted.
 */
export function useUnsavedWork(dirty: boolean, onDiscarded: () => void): void {
  const { dispatch, panelHold } = useShell();
  useEffect(() => {
    dispatch({ type: 'set-panel-dirty', dirty });
  }, [dirty, dispatch]);
  useEffect(() => () => dispatch({ type: 'set-panel-dirty', dirty: false }), [dispatch]);
  // The shell's flag going from true to false while work is still typed means Discard was pressed.
  const was = useRef(false);
  const discard = useRef(onDiscarded);
  discard.current = onDiscarded;
  const held = panelHold.dirty;
  useEffect(() => {
    if (was.current && !held && dirty) discard.current();
    was.current = held;
  }, [held, dirty]);
}
