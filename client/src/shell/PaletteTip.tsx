import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SearchHit } from './contract.ts';

/** How long a row must be pointed at, or stay highlighted from the keyboard, before its tooltip shows. As the rail's. */
export const TIP_DELAY_MS = 350;

/**
 * How long a tooltip stays after the pointer leaves its row, so the pointer can move onto it (WCAG 1.4.13,
 * hoverable). It touches its row, so that move never crosses another row.
 */
export const HOVER_GRACE_MS = 150;

/** Kept clear at the window's edges. */
const EDGE = 8;

/**
 * Which row's tooltip shows: `want` (the row pointed at, or highlighted from the keyboard) after
 * TIP_DELAY_MS. While one is showing, moving to another row follows at once, as menus do.
 */
export function useTipKey(want: string | null): string | null {
  const [shown, setShown] = useState<string | null>(null);
  const showing = useRef(false);
  showing.current = shown !== null;
  useEffect(() => {
    if (!want) return setShown(null);
    if (showing.current) return setShown(want);
    const t = setTimeout(() => setShown(want), TIP_DELAY_MS);
    return () => clearTimeout(t);
  }, [want]);
  return shown !== null && want !== null ? want : null;
}

/** Whether a row earns a tooltip: always for a file, otherwise only when the row cuts its label or hint short. */
export function tipWanted(hit: SearchHit, row: HTMLElement): boolean {
  if (hit.detail) return true;
  return [...row.querySelectorAll<HTMLElement>('.opt-label, .opt-hint')].some(
    (el) => el.scrollWidth > el.clientWidth,
  );
}

/** The lines a hit's tooltip shows after its label: its details, else its hint. */
export function tipLines(hit: SearchHit): string[] {
  return hit.detail ? hit.detail.lines : hit.hint ? [hit.hint] : [];
}

interface Props {
  hit: SearchHit;
  /** The option row it belongs to. */
  row: HTMLElement;
  /** The scrolling list: the tooltip follows the row as it scrolls and hides once the row is out of view. */
  list: RefObject<HTMLElement | null>;
  /** The pointer moved onto the tooltip, or off it: it stays while pointed at. */
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

/**
 * The full details of a search result, in a navy tooltip under its row (above it near the window's foot).
 * The palette shows it only when `tipWanted`. Drawn into the body so the palette's rounded, clipped panel
 * never cuts it off. Screen readers get the same words from the row's description, so this is hidden from
 * them. It can be pointed at (and its path selected); Escape puts it away.
 */
export function PaletteTip({ hit, row, list, onPointerEnter, onPointerLeave }: Props) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number; maxWidth: number } | null>(null);
  const [scrolls, setScrolls] = useState(0);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const moved = () => setScrolls((n) => n + 1);
    el.addEventListener('scroll', moved, { passive: true });
    window.addEventListener('resize', moved);
    return () => {
      el.removeEventListener('scroll', moved);
      window.removeEventListener('resize', moved);
    };
  }, [list]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `scrolls` is the signal to measure again
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip) return;
    const r = row.getBoundingClientRect();
    const view = list.current?.getBoundingClientRect();
    // Out of the list's view (scrolled away): no tooltip pointing at nothing.
    if (view && (r.bottom <= view.top || r.top >= view.bottom)) return setAt(null);
    const label = row.querySelector('.opt-label')?.getBoundingClientRect();
    const left = Math.max(EDGE, (label?.left ?? r.left) - 8);
    const maxWidth = Math.max(160, Math.min(440, window.innerWidth - left - EDGE));
    tip.style.maxWidth = `${maxWidth}px`;
    const h = tip.offsetHeight;
    const top = r.bottom + h > window.innerHeight - EDGE ? Math.max(EDGE, r.top - h) : r.bottom;
    setAt({ top, left, maxWidth });
  }, [row, list, scrolls, hit]);

  const path = hit.detail?.path;
  return createPortal(
    <div
      ref={tipRef}
      className="palette-tip"
      aria-hidden="true"
      data-placed={at ? 'true' : undefined}
      style={at ? { top: at.top, left: at.left, maxWidth: at.maxWidth } : undefined}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      <p className="palette-tip-title">{hit.label}</p>
      {tipLines(hit).map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed lines in a fixed order, never reordered
        <p key={i}>{line}</p>
      ))}
      {path ? <p className="palette-tip-path">{path}</p> : null}
    </div>,
    document.body,
  );
}
