import { type KeyboardEvent, type PointerEvent, useEffect, useRef } from 'react';
import { type LayerWidth, stepWidth } from './useLayerWidth.ts';

/** Set on the body while dragging: no text selecting, and the page frame stops swallowing the pointer (viewer.css). */
const DRAGGING = 'viewer-resizing';

/**
 * The strip on the viewer's left edge that makes it wider or narrower. A vertical separator that
 * takes the pointer (drag, double-click for the default) and the keyboard (arrows, Home, End).
 */
export function ResizeHandle({ layer }: { layer: LayerWidth }) {
  const { min, max, width, preview, commit } = layer;
  const start = useRef<{ x: number; width: number } | null>(null);
  const last = useRef(width);
  last.current = width;

  // The body class must not outlive the handle (the viewer closing mid-drag).
  useEffect(() => () => document.body.classList.remove(DRAGGING), []);

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const w = Math.min(max, Math.max(min, Math.round(s.width + s.x - e.clientX)));
    last.current = w;
    preview(w);
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    start.current = null;
    document.body.classList.remove(DRAGGING);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    commit(last.current);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = stepWidth(width, e.key, e.shiftKey, { min, max });
    if (next === null) return;
    e.preventDefault();
    commit(next);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA window splitter; <hr> can't take focus or a value.
    <div
      className="viewer-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize viewer"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      data-tip="Drag to resize. Double-click to reset."
      data-tip-side="left"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        start.current = { x: e.clientX, width };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        document.body.classList.add(DRAGGING);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => commit(null)}
      onKeyDown={onKeyDown}
    />
  );
}
