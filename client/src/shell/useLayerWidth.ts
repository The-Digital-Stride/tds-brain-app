import { useCallback, useState } from 'react';
import { useDesk, useShell } from './ShellProvider.tsx';

/** The gap round the viewer drawer (`--viewer-pad` in viewer.css). */
export const VIEWER_PAD = 12;
/** What the viewer leaves clear on the left so the rail stays in view (the same 70px viewer.css leaves). */
const RAIL_ROOM = 70;
/** The viewer's default width (viewer.css: `min(1040px, ...)`), and so its narrowest. */
const DEFAULT_WIDTH = 1040;
/** At or under this window width the drawer fills the window (viewer.css) and cannot be resized. */
export const FULL_WIDTH_AT = 640;
export const KEY_STEP = 32;
export const KEY_STEP_BIG = 128;

export interface WidthLimits {
  min: number;
  max: number;
}

/** The narrowest the drawer goes is its default width; the widest leaves the rail and the pad in view. */
export function viewerLimits(windowWidth: number): WidthLimits {
  const room = windowWidth - 2 * VIEWER_PAD - RAIL_ROOM;
  const min = Math.min(DEFAULT_WIDTH, room);
  return { min, max: Math.max(min, room) };
}

export function clampWidth(width: number, { min, max }: WidthLimits): number {
  return Math.min(max, Math.max(min, Math.round(width)));
}

/**
 * The width a key on the handle asks for, or null for a key it ignores. The drawer sits on the right,
 * so Left (moving the edge left) widens and Right narrows.
 */
export function stepWidth(current: number, key: string, shift: boolean, limits: WidthLimits): number | null {
  const by = shift ? KEY_STEP_BIG : KEY_STEP;
  switch (key) {
    case 'ArrowLeft':
      return clampWidth(current + by, limits);
    case 'ArrowRight':
      return clampWidth(current - by, limits);
    case 'Home':
      return limits.min;
    case 'End':
      return limits.max;
    default:
      return null;
  }
}

export interface LayerWidth extends WidthLimits {
  /** False where the drawer fills the window or has no room to grow: no handle then. */
  resizable: boolean;
  /** The width now, in px (the default when none is saved), always inside the limits. */
  width: number;
  /** An inline width for the drawer, or undefined to leave it at its default (the CSS). */
  style: { width: number } | undefined;
  /** Shows a width live while dragging, without saving it. */
  preview: (width: number) => void;
  /** Saves a width (null: back to the default) and ends any preview. */
  commit: (width: number | null) => void;
}

/**
 * The viewer drawer's width: the one saved in the shell state, held inside the limits for the window as
 * it is now (the saved width is kept, so widening the window again gives it back).
 */
export function useLayerWidth(): LayerWidth {
  const { state, dispatch } = useShell();
  const { width: windowWidth } = useDesk();
  const [draft, setDraft] = useState<number | null>(null);
  const limits = viewerLimits(windowWidth);
  const resizable = windowWidth > FULL_WIDTH_AT && limits.max > limits.min;
  const wanted = draft ?? state.viewerWidth;
  const width = wanted === null ? limits.min : clampWidth(wanted, limits);
  const preview = useCallback((w: number) => setDraft(w), []);
  const commit = useCallback(
    (w: number | null) => {
      setDraft(null);
      dispatch({ type: 'set-viewer-width', width: w });
    },
    [dispatch],
  );
  return {
    ...limits,
    resizable,
    width,
    style: resizable && wanted !== null ? { width } : undefined,
    preview,
    commit,
  };
}
