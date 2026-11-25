import { useCallback, useState } from 'react';
import { useDesk, useShell } from './ShellProvider.tsx';

/**
 * The gap round the viewer drawer (`--viewer-pad` in viewer.css). 8px under 600px wide, where the drawer fills the
 * window and has no handle, so this is not used there.
 */
export const VIEWER_PAD = 12;
/** What the viewer leaves clear on the left so the rail stays in view (the same 70px viewer.css leaves). */
const RAIL_ROOM = 70;
/** The viewer's default width (viewer.css: `min(1040px, ...)`), and so its narrowest. */
const DEFAULT_WIDTH = 1040;
/** The chat drawer's default and narrowest widths (plan 2026-11-16-run-chat-drawer). */
export const CHAT_DRAWER_DEFAULT = 520;
export const CHAT_DRAWER_MIN = 380;

/** Which right-hand layer a width is for: the file viewer or the chat drawer. Each has its own saved width. */
export type Layer = 'viewer' | 'chat';
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
  return layerLimits(windowWidth, DEFAULT_WIDTH);
}

/** A layer's limits: `narrowest` (or the room, if less) up to the room beside the rail. */
function layerLimits(windowWidth: number, narrowest: number): WidthLimits {
  const room = windowWidth - 2 * VIEWER_PAD - RAIL_ROOM;
  const min = Math.min(narrowest, room);
  return { min, max: Math.max(min, room) };
}

/**
 * The gap the chat drawer keeps on its left, inside the sheet (`--chat-drawer-gap` on `.chat-drawer` in viewer.css).
 * Its top, bottom and right are the sheet's own edges, so it is as tall as the file viewer.
 */
export const CHAT_DRAWER_PAD = 12;

/**
 * The chat drawer sits inside the sheet, on its right edge, so its room is the sheet's width less the gap on its
 * left: down to 380px (or the room, if less); its default is 520px.
 */
export function chatDrawerLimits(sheetWidth: number): WidthLimits {
  const room = sheetWidth - CHAT_DRAWER_PAD;
  const min = Math.min(CHAT_DRAWER_MIN, room);
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
/** Under this much room to grow, a handle could barely move, so none shows. */
export const MIN_TRAVEL = 64;

/** What a page needs beside the chat drawer to stay usable (Save to project's review form). */
export const CONTENT_MIN = 600;

/**
 * The widest the chat drawer may be, for this session only, so `CONTENT_MIN` is left beside it on the sheet
 * (its own gap included). Never below the drawer's narrowest: under that the drawer overlays as before.
 */
export function maxBesideContent(sheetWidth: number): number {
  return Math.max(chatDrawerLimits(sheetWidth).min, sheetWidth - CHAT_DRAWER_PAD - CONTENT_MIN);
}

/**
 * `sheetWidth`: the sheet's width now, which bounds the chat drawer (the viewer is bounded by the window).
 * `maxWidth`: a cap for this session only, never saved (the saved width comes back when the cap goes).
 */
export function useLayerWidth(layer: Layer = 'viewer', sheetWidth?: number, maxWidth?: number): LayerWidth {
  const { state, dispatch } = useShell();
  const { width: windowWidth } = useDesk();
  const [draft, setDraft] = useState<number | null>(null);
  const chat = layer === 'chat';
  const full = chat ? chatDrawerLimits(sheetWidth ?? windowWidth) : viewerLimits(windowWidth);
  // A session cap is the handle's real maximum too, so a drag or End can't save a width wider than is shown (which
  // tools would then open at): correctness re-check of the design round.
  const limits: WidthLimits =
    maxWidth === undefined ? full : { min: full.min, max: Math.max(full.min, Math.min(full.max, maxWidth)) };
  const resizable = windowWidth > FULL_WIDTH_AT && limits.max - limits.min >= MIN_TRAVEL;
  const wanted = draft ?? (chat ? state.chatDrawerWidth : state.viewerWidth);
  // The width without the cap; the cap shows (inline) whenever it makes the drawer narrower than that.
  const natural =
    wanted === null ? (chat ? clampWidth(CHAT_DRAWER_DEFAULT, full) : full.min) : clampWidth(wanted, full);
  const capped = natural > limits.max;
  const width = capped ? limits.max : natural;
  const preview = useCallback((w: number) => setDraft(w), []);
  const capMax = limits.max;
  const commit = useCallback(
    (w: number | null) => {
      setDraft(null);
      const saved = w !== null && maxWidth !== undefined ? Math.min(w, capMax) : w;
      dispatch({ type: chat ? 'set-chat-drawer-width' : 'set-viewer-width', width: saved });
    },
    [dispatch, chat, maxWidth, capMax],
  );
  return {
    ...limits,
    resizable,
    width,
    style: capped || (resizable && wanted !== null) ? { width } : undefined,
    preview,
    commit,
  };
}
