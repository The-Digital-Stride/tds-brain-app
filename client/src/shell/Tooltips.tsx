import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HOVER_GRACE_MS, TIP_DELAY_MS } from './PaletteTip.tsx';

/**
 * What gets a tooltip (docs/design-system.md, "Tooltips"): every icon-only button. An `.icon-btn` or `.chip-remove`
 * with an `aria-label` shows that label; anything with `data-tip` shows that instead, so a button whose label
 * carries a long title (`Favourite: Renew the contract…`) can show a short name (`Favourite`).
 */
export const TIP_SELECTOR = '[data-tip], .icon-btn[aria-label], .chip-remove[aria-label]';

/** Kept clear at the window's edges, and between a button and its tooltip. */
const EDGE = 8;
const GAP = 6;
/** The rail's names sit to the right of its icons, as before. */
const RAIL_GAP = 14;

export function tipText(el: HTMLElement): string | null {
  const text = el.dataset.tip ?? el.getAttribute('aria-label');
  return text && text.trim() !== '' ? text : null;
}

/** A button whose words show (`.btn-label`, as Stop has until the sheet is narrow) needs no tooltip. */
function showsWords(el: HTMLElement): boolean {
  const label = el.querySelector('.btn-label');
  return label !== null && label.getBoundingClientRect().width > 1;
}

function tipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest<HTMLElement>(TIP_SELECTOR);
  return el && tipText(el) !== null && !showsWords(el) ? el : null;
}

interface Shown {
  el: HTMLElement;
  text: string;
  /** Pointed at (rather than reached from the keyboard): Escape is then the tooltip's alone. */
  byPointer: boolean;
}

/**
 * The one tooltip layer, mounted once. It shows a navy name under an icon-only button (to the right of the
 * rail's icons) after TIP_DELAY_MS of pointing, or at once when the button is reached from the keyboard; never
 * for touch. While one shows, the next button pointed at follows at once, as menus do. Like the search's tooltips
 * it can be pointed at (WCAG 1.4.13): it stays for HOVER_GRACE_MS after the pointer leaves, and Escape puts it
 * away. Pressing the button, scrolling or resizing puts it away too. It repeats the button's accessible name, so
 * it is hidden from screen readers.
 */
export function Tooltips() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // The button waiting out the delay, if any.
    let pending: HTMLElement | null = null;
    // Whether the last input was a key: only then does focus show a tooltip (a click focuses buttons too).
    let keyboard = false;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    };
    const show = (el: HTMLElement, byPointer: boolean) => {
      clear();
      // A button that left the page while its wait ran (Escape closing the drawer it sat in) has no place to show.
      if (!el.isConnected) return;
      const text = tipText(el);
      if (text !== null) setShown({ el, text, byPointer });
    };
    const hide = () => {
      clear();
      setShown(null);
    };
    const later = (fn: () => void, ms: number) => {
      clear();
      timer = setTimeout(fn, ms);
    };
    const onTip = (node: EventTarget | null) =>
      node instanceof Node && (tipRef.current?.contains(node) ?? false);

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const cur = shownRef.current;
      if (onTip(e.target)) return clear();
      const el = tipTarget(e.target);
      if (!el) return;
      if (cur?.el === el) return clear();
      if (cur) show(el, true);
      else {
        later(() => show(el, true), TIP_DELAY_MS);
        pending = el;
      }
    };
    const onPointerOut = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const to = e.relatedTarget;
      const cur = shownRef.current;
      const from = onTip(e.target) ? (cur?.el ?? null) : tipTarget(e.target);
      if (!from) return;
      // Still on the button, or moving between it and its tooltip.
      if (to instanceof Node && (from.contains(to) || onTip(to))) return;
      if (cur?.el === from) later(hide, HOVER_GRACE_MS);
      else clear();
    };
    const onPointerDown = () => {
      keyboard = false;
      if (shownRef.current || timer) hide();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      keyboard = true;
      const cur = shownRef.current;
      if (!cur) return;
      if (e.key === 'Escape') {
        // A pointed-at tooltip is put away without moving the pointer, and that is all Escape does. One shown by
        // focus goes too, but Escape still reaches the shell (closing a drawer), or it would take two presses.
        if (cur.byPointer) e.preventDefault();
        hide();
      } else if (e.key === 'Enter' || e.key === ' ') hide();
    };
    // Only a scroll that moves the button puts its tooltip away: a chat scrolling as a reply streams in must not.
    const onScroll = (e: Event) => {
      // The page itself (window or document) moves every button; any other scroller only the ones inside it.
      const moves = (el: HTMLElement | null) =>
        el !== null && (!(e.target instanceof Node) || e.target.contains(el));
      if (moves(shownRef.current?.el ?? null) || moves(pending)) hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = tipTarget(e.target);
      if (el && el === e.target && keyboard) show(el, false);
    };
    const onFocusOut = (e: FocusEvent) => {
      const cur = shownRef.current;
      if (cur && !cur.byPointer && cur.el === e.target) hide();
    };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('pointerdown', onPointerDown, true);
    // Capture, so a pointed-at tooltip takes Escape before the shell's listener sees it.
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', hide);
    return () => {
      clear();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', hide);
    };
  }, []);

  // A button that leaves the page (a starred row moving, a drawer closing) takes its tooltip with it; one that
  // changes its name (the rail's toggle after "[") or moves (the rail widening) takes the new name or place.
  useEffect(() => {
    if (!shown) return;
    const was = shown.el.getBoundingClientRect();
    const check = setInterval(() => {
      const el = shown.el;
      if (!el.isConnected || el.closest('[hidden], [inert]') || tipTarget(el) !== el) return setShown(null);
      const text = tipText(el);
      const now = el.getBoundingClientRect();
      if (text !== shown.text || now.left !== was.left || now.top !== was.top)
        setShown({ ...shown, text: text ?? shown.text });
    }, 200);
    return () => clearInterval(check);
  }, [shown]);

  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!shown || !tip) return setAt(null);
    const r = shown.el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top: number;
    let left: number;
    if (shown.el.closest('.rail')) {
      left = r.right + RAIL_GAP;
      top = r.top + r.height / 2 - h / 2;
    } else {
      left = r.left + r.width / 2 - w / 2;
      top = r.bottom + GAP;
      // No room below: above.
      if (top + h > vh - EDGE) top = r.top - GAP - h;
    }
    left = Math.max(EDGE, Math.min(left, vw - EDGE - w));
    top = Math.max(EDGE, Math.min(top, vh - EDGE - h));
    setAt({ top, left });
  }, [shown]);

  if (!shown) return null;
  return createPortal(
    <div
      ref={tipRef}
      className="tip"
      aria-hidden="true"
      data-placed={at ? 'true' : undefined}
      style={at ? { top: at.top, left: at.left } : undefined}
    >
      {shown.text}
    </div>,
    document.body,
  );
}
