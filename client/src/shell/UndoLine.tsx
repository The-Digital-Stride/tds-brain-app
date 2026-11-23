import { type FocusEvent, type MouseEvent, useEffect, useRef, useState } from 'react';

/**
 * How long a held delete or tick waits before it is sent: one value for to-dos, files and chats
 * (plan 2026-11-22-ux-consistency, decision 12). The store's held queue and the countdown bar both read it.
 */
export const UNDO_MS = 10_000;

export interface UndoLineProps {
  /** What happened, shown on the line: "“Weekly report” deleted." */
  text: string;
  /** Accessible name for the button: "Undo deleting “Weekly report”". Visible text is always "Undo". */
  undoLabel: string;
  onUndo: () => void;
  /** Called when pointer or focus arrives (either one); the clock stops. */
  onPause: () => void;
  /** Called only when both pointer and focus have left; the clock runs again from the full time. */
  onResume: () => void;
  /** Move focus to the Undo button on mount: ONLY after a keyboard press (see `pressedByKeyboard`). */
  focusOnMount?: boolean;
  /** While the request is in flight after the time ran out: shows "Sending…", no button. */
  sending?: boolean;
  /** `row`: an `li` in place of the removed list row. `strip`: a `div` at the top of the sheet. */
  as: 'row' | 'strip';
}

// The last way the person pressed something, so a host can tell a keyboard press from a pointer one even when
// the press happened somewhere else (the to-do panel's buttons). A click with `detail` 0 came from the keyboard
// (Enter or Space on a button, a form's implicit submit) or a screen reader; a pointer click counts its clicks.
let lastInput: 'keyboard' | 'pointer' = 'pointer';
if (typeof document !== 'undefined') {
  const pointer = () => {
    lastInput = 'pointer';
  };
  document.addEventListener(
    'keydown',
    () => {
      lastInput = 'keyboard';
    },
    true,
  );
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('mousedown', pointer, true);
  document.addEventListener(
    'click',
    (e) => {
      lastInput = e.detail === 0 ? 'keyboard' : 'pointer';
    },
    true,
  );
}

/** True when the press that is being handled now (or the last one) came from the keyboard. */
export function pressedByKeyboard(): boolean {
  return lastInput === 'keyboard';
}

/**
 * The one Undo line (docs/design-system.md, Actions rule 4): what happened, a quiet small Undo, and a bar that
 * runs down over UNDO_MS. The pointer and focus each hold the clock on their own: it runs again only when both
 * have left, so a mouse passing over while focus sits on Undo can't restart it. The line never announces
 * itself: the host keeps an always-mounted `role="status"` line that does.
 */
export function UndoLine({
  text,
  undoLabel,
  onUndo,
  onPause,
  onResume,
  focusOnMount = false,
  sending = false,
  as,
}: UndoLineProps) {
  const button = useRef<HTMLButtonElement>(null);
  const on = useRef({ pointer: false, focus: false });
  const [paused, setPaused] = useState(false);
  // Counts each time the clock runs again, so the bar starts over from full (a new element, a new animation).
  const [run, setRun] = useState(0);
  useEffect(() => {
    // preventScroll: the line is where the person already is.
    if (focusOnMount) button.current?.focus({ preventScroll: true });
  }, [focusOnMount]);
  const set = (which: 'pointer' | 'focus', value: boolean) => {
    const was = on.current.pointer || on.current.focus;
    on.current = { ...on.current, [which]: value };
    const now = on.current.pointer || on.current.focus;
    if (now && !was) {
      setPaused(true);
      onPause();
    }
    if (!now && was) {
      setPaused(false);
      setRun((n) => n + 1);
      onResume();
    }
  };
  const handlers = {
    onMouseEnter: () => set('pointer', true),
    onMouseLeave: () => set('pointer', false),
    onFocus: () => set('focus', true),
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) set('focus', false);
    },
  };
  const body = (
    <>
      <span className="undo-line-text">{text}</span>
      {sending ? (
        <span className="undo-line-sending">Sending…</span>
      ) : (
        <button
          type="button"
          className="btn"
          data-variant="quiet"
          data-size="small"
          ref={button}
          aria-label={undoLabel}
          onClick={(e: MouseEvent<HTMLButtonElement>) => {
            // The second click of a double-click on the bin lands here, where the bin was: it is not an Undo.
            if (e.detail > 1) return;
            onUndo();
          }}
        >
          Undo
        </button>
      )}
      {sending ? null : (
        <span
          key={run}
          className="undo-line-bar"
          data-paused={paused ? 'true' : undefined}
          aria-hidden="true"
          style={{ animationDuration: `${UNDO_MS}ms` }}
        />
      )}
    </>
  );
  const Tag = as === 'row' ? 'li' : 'div';
  return (
    // The handlers only hold the Undo clock; the button inside is the control.
    <Tag className="undo-line" data-as={as} {...handlers}>
      {body}
    </Tag>
  );
}
