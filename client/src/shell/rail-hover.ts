/**
 * Hover to expand the icons-only rail. Pure timing logic; the rail wires the events.
 * Ported from tds-app-portal (commit c4ec997, apps/portal/components/shell/rail-hover.ts, decision 34), so both
 * apps feel the same. One change: the pointer's type arrives on `pointerEnter`, not a one-off `hoverCapable`.
 *
 * - Opens after a mouse or pen rests 200 ms, or at once when keyboard focus moves in.
 * - Closes 150 ms after the pointer leaves, when focus leaves, on Escape, or when an item is chosen.
 * - After Escape or a choice it stays shut until the pointer has left and come back (or focus returns).
 * - Never for touch.
 * - Not a preference: this only reports "expanded"; the saved names setting is never touched.
 */

export const HOVER_OPEN_MS = 200;
export const HOVER_CLOSE_MS = 150;

export interface RailHoverOptions {
  onChange(expanded: boolean): void;
}

export interface RailHover {
  isExpanded(): boolean;
  /** What opened it, or null while shut: Escape stops there for a pointer, but passes on for focus. */
  openedBy(): 'pointer' | 'focus' | null;
  pointerEnter(pointerType: string): void;
  pointerLeave(): void;
  focusIn(): void;
  focusOut(): void;
  escape(): void;
  choose(): void;
  dispose(): void;
}

export function createRailHover({ onChange }: RailHoverOptions): RailHover {
  let expanded = false;
  let by: 'pointer' | 'focus' | null = null;
  /** Escape or a choice closed it while the pointer is still over the rail. */
  let dismissed = false;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: boolean, source: 'pointer' | 'focus' | null) => {
    by = next ? source : null;
    if (expanded === next) return;
    expanded = next;
    onChange(next);
  };
  const clearOpen = () => {
    clearTimeout(openTimer);
    openTimer = undefined;
  };
  const clearClose = () => {
    clearTimeout(closeTimer);
    closeTimer = undefined;
  };
  const shut = () => {
    clearOpen();
    clearClose();
    dismissed = true;
    set(false, null);
  };

  return {
    isExpanded: () => expanded,
    openedBy: () => by,
    pointerEnter(pointerType) {
      if (pointerType !== 'mouse' && pointerType !== 'pen') return;
      clearClose();
      if (expanded || dismissed || openTimer !== undefined) return;
      openTimer = setTimeout(() => {
        openTimer = undefined;
        set(true, 'pointer');
      }, HOVER_OPEN_MS);
    },
    pointerLeave() {
      dismissed = false;
      clearOpen();
      if (!expanded) return;
      clearClose();
      closeTimer = setTimeout(() => {
        closeTimer = undefined;
        set(false, null);
      }, HOVER_CLOSE_MS);
    },
    focusIn() {
      clearOpen();
      clearClose();
      dismissed = false;
      set(true, 'focus');
    },
    focusOut() {
      clearOpen();
      clearClose();
      dismissed = false;
      set(false, null);
    },
    escape: shut,
    choose: shut,
    dispose() {
      clearOpen();
      clearClose();
    },
  };
}
