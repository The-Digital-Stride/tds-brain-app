import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { keyAction } from '../state/keys.ts';
import {
  dockModes,
  fitToWidth,
  giveWay,
  type Layout,
  layoutOf,
  loadShell,
  RAIL_NAMES_FROM,
  saveShell,
  toggleRail,
} from '../state/shell.ts';
import { useStore } from '../store.tsx';
import { APPS } from './apps.ts';
import { SHELL_STORAGE_KEY, type ShellAction, type ShellApi, type ShellState } from './contract.ts';

type DockSide = 'left' | 'right';

/**
 * The desk as laid out now (see `layoutOf`): the rail as it shows (names only when chosen, wide
 * enough, and not held to icons by the panel), which docks are showing and which float.
 */
interface Desk extends Omit<Layout, 'modes'> {
  /** The window's inner width, kept current. */
  width: number;
  /** Which dock a person just asked to open, so it (and only it) takes focus. */
  focusIntent: RefObject<DockSide | null>;
}

const ShellContext = createContext<ShellApi | null>(null);
const DeskContext = createContext<Desk | null>(null);

export function useShell(): ShellApi {
  const s = useContext(ShellContext);
  if (!s) throw new Error('useShell must be used inside ShellProvider');
  return s;
}

/** Window width and how the rail shows. For shell pieces; wave 2 views should not need it. */
export function useDesk(): Desk {
  const d = useContext(DeskContext);
  if (!d) throw new Error('useDesk must be used inside ShellProvider');
  return d;
}

function windowWidth(): number {
  return typeof window === 'undefined' ? 1280 : window.innerWidth;
}

/** Saved state, with a drawer or panel restored only where it would push (never a modal on load). */
function initialState(): ShellState {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SHELL_STORAGE_KEY);
  } catch {
    // Storage blocked: start from the defaults.
  }
  const saved = loadShell(raw);
  const width = windowWidth();
  const modes = dockModes(width, { ...saved, railWide: saved.railWide && width >= RAIL_NAMES_FROM });
  return {
    ...saved,
    drawer: modes.drawerOverlays ? null : saved.drawer,
    panelOpen: modes.panelOverlays ? false : saved.panelOpen,
  };
}

/** A shell action with the width it happened at, or a resize to fit the docks to. */
type Step = { action: ShellAction; width: number; rail: boolean } | { fit: number; rail: boolean };

/** `rail`: whether the rail shows names, since a drawer's push-or-float depends on it. */
function step(state: ShellState, s: Step): ShellState {
  return 'fit' in s ? fitToWidth(state, s.fit, s.rail) : giveWay(state, s.action, s.width, s.rail);
}

function isTyping(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.matches('input, textarea, select') || el.isContentEditable === true;
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(step, undefined, initialState);
  const [width, setWidth] = useState(windowWidth);
  const widthRef = useRef(width);
  widthRef.current = width;
  const stateRef = useRef(state);
  stateRef.current = state;
  const focusIntent = useRef<DockSide | null>(null);

  // The panel only shows for a live chat on the sheet, or an app that brings a panel of its own;
  // while it shows, the rail is held to icons.
  const { view, activeChat } = useStore();
  const liveOnSheet =
    (view === 'chat' && activeChat?.kind === 'live') ||
    APPS.some((a) => view === `app:${a.id}` && a.Panel !== undefined);
  const [railOverride, setRailOverride] = useState(false);
  const layout = useMemo(
    () => layoutOf(state, width, { liveOnSheet, railOverride }),
    [state, width, liveOnSheet, railOverride],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const overrideRef = useRef(railOverride);
  overrideRef.current = railOverride;

  // The hold ends with the panel, and so does the person's override of it.
  useEffect(() => {
    if (!layout.panelShowing) setRailOverride(false);
  }, [layout.panelShowing]);

  const dispatch = useCallback((action: ShellAction) => {
    const s = stateRef.current;
    const now = layoutRef.current;
    if (action.type === 'toggle-rail') {
      // While the panel shows, the toggle works against its hold (see toggleRail).
      const next = toggleRail(s, widthRef.current, {
        panelShowing: now.panelShowing,
        railOverride: overrideRef.current,
      });
      setRailOverride(next.railOverride);
      if (next.railWide !== s.railWide)
        rawDispatch({ action, width: widthRef.current, rail: now.railShowsNames });
      return;
    }
    const opensDrawer =
      (action.type === 'toggle-drawer' || action.type === 'open-drawer') && s.drawer !== action.drawer;
    const opensPanel =
      (action.type === 'toggle-panel' && !s.panelOpen) || (action.type === 'set-panel' && action.open);
    if (opensDrawer) focusIntent.current = 'left';
    else if (opensPanel) focusIntent.current = 'right';
    rawDispatch({ action, width: widthRef.current, rail: now.railShowsNames });
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SHELL_STORAGE_KEY, saveShell(state));
    } catch {
      // Storage blocked or full: the shell still works, it just won't be remembered.
    }
  }, [state]);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setWidth(w);
      const rail = stateRef.current.railWide && w >= RAIL_NAMES_FROM && !layoutRef.current.railHeld;
      rawDispatch({ fit: w, rail });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The one global key listener. Anything that handles a key itself calls preventDefault first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Held keys repeat: act on the first press only, so a drawer doesn't flicker open and shut.
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      const action = keyAction(e, {
        typing: isTyping(document.activeElement),
        state: stateRef.current,
        panelFloating: layoutRef.current.panelModal,
      });
      if (!action) return;
      e.preventDefault();
      dispatch(action);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dispatch]);

  const { modes } = layout;
  const api = useMemo<ShellApi>(() => ({ state, dispatch, modes }), [state, dispatch, modes]);
  const desk = useMemo<Desk>(
    () => ({
      width,
      railShowsNames: layout.railShowsNames,
      railHeld: layout.railHeld,
      drawerModal: layout.drawerModal,
      panelShowing: layout.panelShowing,
      panelModal: layout.panelModal,
      focusIntent,
    }),
    [width, layout],
  );

  return (
    <ShellContext.Provider value={api}>
      <DeskContext.Provider value={desk}>{children}</DeskContext.Provider>
    </ShellContext.Provider>
  );
}
