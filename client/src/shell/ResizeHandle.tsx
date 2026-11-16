import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef } from 'react';
import { type LayerWidth, stepWidth } from './useLayerWidth.ts';

/** Set on the body while dragging: no text selecting, and the page frame stops swallowing the pointer (viewer.css). */
const DRAGGING = 'viewer-resizing';

/**
 * The strip on the viewer's left edge that makes it wider or narrower. A vertical separator that
 * takes the pointer (drag, double-click for the default) and the keyboard (arrows, Home, End).
 */
export function ResizeHandle({ layer, label = 'Resize viewer' }: { layer: LayerWidth; label?: string }) {
  const { min, max, width, preview, commit } = layer;
  const start = useRef<{ x: number; width: number; moved: boolean } | null>(null);
  const hintId = useId();
  const last = useRef(width);
  last.current = width;

  // The body class must not outlive the handle (the viewer closing mid-drag).
  useEffect(() => () => document.body.classList.remove(DRAGGING), []);

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const w = Math.min(max, Math.max(min, Math.round(s.width + s.x - e.clientX)));
    if (w !== s.width) s.moved = true;
    last.current = w;
    preview(w);
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    start.current = null;
    document.body.classList.remove(DRAGGING);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // A click with no drag saves nothing: a saved width the window is clamping, or the default, stays as it is.
    if (s.moved) commit(last.current);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = stepWidth(width, e.key, e.shiftKey, { min, max });
    if (next === null) return;
    e.preventDefault();
    commit(next);
  };

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA window splitter; <hr> can't take focus or a value. */}
      <div
        className="viewer-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={width}
        aria-valuetext={`${width} pixels wide`}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End"
        aria-describedby={hintId}
        tabIndex={0}
        data-tip="Drag to resize. Double-click to reset."
        data-tip-side="left"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          start.current = { x: e.clientX, width, moved: false };
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
      {/* A separator's children are hidden from screen readers, so its key hint sits beside it. */}
      <span id={hintId} className="visually-hidden">
        Left and right arrow keys resize, Shift for bigger steps. Home is narrowest, End is widest.
        Double-click resets.
      </span>
    </>
  );
}
