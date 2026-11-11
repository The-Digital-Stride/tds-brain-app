import { useEffect, useRef } from 'react';
import type { DockProps } from './contract.ts';
import { Icon } from './Icon.tsx';
import { useDesk } from './ShellProvider.tsx';

/** The ids of the two docks, for the buttons that open them (`aria-controls`). */
export const DOCK_IDS = { left: 'drawer', right: 'panel' } as const;

/**
 * The sliding holder for a drawer (left) or the panel (right). Renders the region, its heading and
 * close button; the child is the body only. A closed dock is inert and hidden from assistive tech.
 *
 * Focus: when a person opens it (a dispatched open, not a restore or a chat switch), or whenever
 * it opens floating, the heading takes focus; when it closes with focus inside it, focus goes back to whatever opened it, or else
 * to the rail button marked `data-dock-label` with this dock's label.
 */
export function Dock({ side, open, label, overlay, onClose, actions, children }: DockProps) {
  const { focusIntent } = useDesk();
  const aside = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const shown = useRef({ open: false, label });
  const id = DOCK_IDS[side];

  useEffect(() => {
    const prev = shown.current;
    shown.current = { open, label };
    const active = document.activeElement;
    const inside = active !== null && (aside.current?.contains(active) ?? false);

    if (open && (!prev.open || prev.label !== label)) {
      const asked = focusIntent.current === side;
      // A floating dock is modal: it takes focus however it came to open (a view change with the
      // panel left open, say), or focus would be stranded on something that has just gone inert.
      if (!asked && !overlay) return;
      if (asked) focusIntent.current = null;
      if (!inside && active instanceof HTMLElement && active !== document.body) opener.current = active;
      heading.current?.focus();
      return;
    }

    if (!open && prev.open) {
      // Focus is lost to the page when the region it was in goes inert.
      if (inside || active === null || active === document.body) {
        const back =
          opener.current?.isConnected === true
            ? opener.current
            : (document.querySelector<HTMLElement>(
                `[aria-controls="${id}"][data-dock-label="${prev.label}"]`,
              ) ??
              document.querySelector<HTMLElement>(`[aria-controls="${id}"]`) ??
              // The opener went with what was on the sheet (e.g. leaving a chat): land on the sheet.
              document.getElementById('main'));
        back?.focus();
      }
      opener.current = null;
    }
  }, [open, label, side, id, focusIntent, overlay]);

  return (
    <div className="dock" data-side={side} data-open={open} data-overlay={overlay}>
      {overlay ? (
        // A pointer shortcut only: Esc and the close button do the same.
        <div className="veil" data-open={open} aria-hidden="true" onClick={onClose} />
      ) : null}
      <aside
        ref={aside}
        id={id}
        className="dock-panel glass"
        aria-label={label}
        inert={!open}
        aria-hidden={open ? undefined : true}
      >
        <header className="dock-head">
          <h2 ref={heading} tabIndex={-1}>
            {label}
          </h2>
          {actions}
          <button
            type="button"
            className="icon-btn"
            aria-label={`Close ${label.toLowerCase()}`}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="dock-body">{children}</div>
      </aside>
    </div>
  );
}
