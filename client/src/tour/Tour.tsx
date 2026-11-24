import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { pickNote, whatsNewNotes } from '../help/whats-new.ts';
import { useDesk, useShell } from '../shell/ShellProvider.tsx';
import { useStore } from '../store.tsx';
import { clearTourRequest, requestTour, setTourOpen, useTourRequested } from './request.ts';
import { TOUR_SEEN_KEY, TOUR_STEPS, TOUR_VERSION, type TourStep, welcomeStep } from './steps.ts';

const CARD_W = 300;
const PAD = 5;
/** Keys the shell treats as shortcuts. They do nothing while the tour shows. */
const SINGLE_KEYS = new Set(['c', 't', 's', 'h', '?', '/', '[']);

function readFallback(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
function writeFallback(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    // Nothing more to try: the tour may show again next time.
  }
}

/** True when the element and everything around it is displayed (not display:none, hidden or invisible). */
function isShown(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.hasAttribute('hidden')) return false;
    const style = getComputedStyle(n);
    if (style.display === 'none') return false;
    if (n === el && style.visibility === 'hidden') return false;
  }
  return true;
}
function findAnchor(step: TourStep): HTMLElement | null {
  if (!step.anchor) return null;
  const el = document.querySelector<HTMLElement>(step.anchor);
  return el && isShown(el) ? el : null;
}
const usable = (step: TourStep) => step.anchor === null || findAnchor(step) !== null;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The first-run tour: a spotlight and a small card, walking round Cortex (steps.ts). Mounted once, inside the shell. */
export function Tour() {
  const { boot, lists, sessions, view, activeChat, newChat, updatePrefs } = useStore();
  const { state, dispatch } = useShell();
  const { drawerModal, panelModal } = useDesk();
  const requested = useTourRequested();
  const titleId = useId();
  const textId = useId();

  const [phase, setPhase] = useState<'idle' | 'prep' | 'running'>('idle');
  const [existing, setExisting] = useState(false);
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [save, setSave] = useState<'none' | 'done'>('none');
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(180);
  const cardRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const seenInPrefs = (boot?.prefs.tourSeen ?? 0) >= TOUR_VERSION;
  const blocked = state.paletteOpen || state.viewer !== null || drawerModal || panelModal;
  const isHome = view === 'chat' && activeChat.kind === 'new';
  const listsReady = lists.chats !== 'loading';

  const steps = useMemo(() => [welcomeStep(existing), ...TOUR_STEPS], [existing]);

  // Focus goes back once the desk is no longer inert, so it is set here and applied after the next render.
  const returnTo = useRef<HTMLElement | null>(null);
  const [returned, setReturned] = useState(0);
  const stop = useCallback(() => {
    setPhase('idle');
    setTourOpen(false);
    const back = opener.current;
    opener.current = null;
    returnTo.current = back?.isConnected ? back : document.getElementById('main');
    setReturned((n) => n + 1);
  }, []);
  useEffect(() => {
    if (returned === 0) return;
    const target = returnTo.current;
    returnTo.current = null;
    target?.focus();
  }, [returned]);

  const finish = useCallback(() => {
    stop();
    setDismissed(true);
    // Someone new to Cortex has nothing to catch up on: the notes up to this version count as read, so old
    // What's new cards (the TDS Cortex rename among them) never greet a person who has just arrived.
    const caughtUp =
      !existing && !boot?.prefs.whatsNewSeen
        ? pickNote(whatsNewNotes, boot?.appVersion ?? '', null)?.version
        : undefined;
    updatePrefs(
      caughtUp ? { tourSeen: TOUR_VERSION, whatsNewSeen: caughtUp } : { tourSeen: TOUR_VERSION },
    ).then(
      () => setSave('done'),
      () => writeFallback(),
    );
  }, [stop, updatePrefs, existing, boot]);

  // The store's save never throws; it leaves prefs as they were. So after it settles, check it took.
  useEffect(() => {
    if (save !== 'done') return;
    setSave('none');
    if (!seenInPrefs) writeFallback();
  }, [save, seenInPrefs]);

  // Start: once, when asked or when the person has never seen it, and nothing modal is open.
  const autoDue = !dismissed && !seenInPrefs && !readFallback();
  useEffect(() => {
    if (phase !== 'idle' || blocked || !boot || !listsReady || !(requested || autoDue)) return;
    clearTourRequest();
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setExisting((sessions?.past.length ?? 0) + (sessions?.live.length ?? 0) > 0);
    setIdx(0);
    setDismissed(false);
    setPhase('prep');
    setTourOpen(true);
  }, [phase, blocked, boot, listsReady, requested, autoDue, sessions]);

  // Getting ready: a pushing drawer closes and Home shows, so the places to point at are there.
  useEffect(() => {
    if (phase !== 'prep') return;
    if (state.drawer !== null) dispatch({ type: 'close-drawer' });
    else if (!isHome) newChat();
    else setPhase('running');
  }, [phase, state.drawer, isHome, dispatch, newChat]);

  // Something modal opened (the palette, a floating drawer): step aside; it starts again when that closes.
  useEffect(() => {
    if (phase === 'idle' || !blocked) return;
    // Ask again, so a replay (already seen, so not due by itself) comes back too.
    requestTour();
    stop();
  }, [phase, blocked, stop]);

  // Keys: Esc skips; the single-key shortcuts do nothing; Tab stays on the card.
  useEffect(() => {
    if (phase === 'idle') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish();
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && SINGLE_KEYS.has(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [phase, finish]);

  const step = (steps[idx] ?? steps[0]) as TourStep;
  const shown = steps.filter((s) => phase === 'running' && usable(s));
  const nextIdx = steps.findIndex((s, i) => i > idx && usable(s));
  const prevIdx = steps.findLastIndex((s, i) => i < idx && usable(s));

  // Where to point, kept current as the window changes.
  useLayoutEffect(() => {
    if (phase !== 'running') return;
    const place = () => {
      const el = findAnchor(step);
      if (!el) return setBox(null);
      const r = el.getBoundingClientRect();
      setBox({ left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
      setCardH(cardRef.current?.offsetHeight || 180);
    };
    // Home scrolls on its own: bring the step's target into view first, so the spotlight is never off-screen.
    findAnchor(step)?.scrollIntoView?.({ block: 'nearest' });
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // A layout change (a drawer sliding, the rail folding) moves the anchor without a resize or scroll.
    const watcher = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    const anchor = findAnchor(step);
    if (anchor) watcher?.observe(anchor);
    const desk = document.querySelector('.desk');
    if (desk) watcher?.observe(desk);
    return () => {
      watcher?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [phase, step]);

  // Focus moves into the card when the tour starts.
  useEffect(() => {
    if (phase === 'running') cardRef.current?.focus();
  }, [phase]);

  if (phase !== 'running') return null;

  const position = shown.findIndex((s) => s.id === step.id) + 1;

  const go = (to: number) => setIdx(to);
  let cardStyle: React.CSSProperties | undefined;
  if (box) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = box.left + box.width + 14;
    let top = box.top;
    if (left + CARD_W > vw - 8) {
      left = Math.max(8, Math.min(box.left, vw - CARD_W - 8));
      top = box.top + box.height + 12;
    }
    if (top + cardH > vh - 8) top = Math.max(8, box.top - cardH - 12);
    cardStyle = { left, top };
  }

  return (
    <div className="tour">
      <div className="tour-backdrop" data-dim={box ? undefined : 'true'} />
      {box ? <div className="tour-spot" aria-hidden="true" style={box} /> : null}
      <div
        ref={cardRef}
        className="tour-card"
        data-centred={box ? undefined : 'true'}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)')];
          if (items.length === 0) return;
          const first = items[0] as HTMLElement;
          const last = items[items.length - 1] as HTMLElement;
          if (
            e.shiftKey &&
            (document.activeElement === first || document.activeElement === e.currentTarget)
          ) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="visually-hidden" role="status" aria-live="polite">
          {`Step ${position} of ${shown.length}: ${step.title}`}
        </div>
        <div className="tour-dots" aria-hidden="true">
          {shown.map((s) => (
            <i key={s.id} data-on={s.id === step.id ? 'true' : undefined} />
          ))}
        </div>
        <h2 id={titleId} className="tour-title">
          {step.title}
        </h2>
        <p id={textId} className="tour-text">
          {step.text}
        </p>
        <div className="tour-acts">
          <button type="button" className="btn" data-variant="quiet" onClick={finish}>
            Skip tour
          </button>
          <span className="tour-sp" />
          <button
            type="button"
            className="btn"
            aria-disabled={prevIdx < 0 ? 'true' : undefined}
            onClick={() => {
              if (prevIdx >= 0) go(prevIdx);
            }}
          >
            Back
          </button>
          <button
            type="button"
            className="btn"
            data-variant="primary"
            onClick={() => (nextIdx < 0 ? finish() : go(nextIdx))}
          >
            {nextIdx < 0 ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
