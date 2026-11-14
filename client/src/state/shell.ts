/**
 * Shell state: the rail, the drawers, the panel, the palette and the single-key switch.
 * Separate from the data store; held by `ShellProvider` and saved to localStorage.
 * Contract: client/src/shell/contract.ts.
 */
import type {
  DockModes,
  DockModesOf,
  DrawerName,
  LoadShell,
  PanelTab,
  SaveShell,
  ShellAction,
  ShellReducer,
  ShellState,
} from '../shell/contract.ts';

export const DEFAULT_SHELL: ShellState = {
  railWide: false,
  drawer: null,
  panelOpen: false,
  panelTab: 'files',
  panelFile: null,
  paletteOpen: false,
  viewer: null,
  singleKeys: true,
};

/** Below this width the rail is always icons only. */
export const RAIL_NAMES_FROM = 900;

const DRAWERS: readonly DrawerName[] = ['chats', 'todos', 'skills'];
// A saved tab not listed here (the removed `steps`) loads as the default.
const TABS: readonly PanelTab[] = ['files', 'details'];

export const shellReducer: ShellReducer = (state, action) => {
  switch (action.type) {
    case 'toggle-rail':
      return { ...state, railWide: !state.railWide };
    case 'toggle-drawer':
      return { ...state, drawer: state.drawer === action.drawer ? null : action.drawer };
    case 'open-drawer':
      return state.drawer === action.drawer ? state : { ...state, drawer: action.drawer };
    case 'close-drawer':
      return state.drawer === null ? state : { ...state, drawer: null };
    case 'toggle-panel':
      return { ...state, panelOpen: !state.panelOpen };
    case 'set-panel':
      return state.panelOpen === action.open ? state : { ...state, panelOpen: action.open };
    case 'set-panel-tab':
      return state.panelTab === action.tab && state.panelFile === null
        ? state
        : { ...state, panelTab: action.tab, panelFile: null };
    case 'show-chat-file':
      return {
        ...state,
        panelOpen: true,
        panelTab: 'files',
        panelFile: action.key === null ? null : { chat: action.chat, key: action.key },
      };
    case 'set-palette':
      return state.paletteOpen === action.open ? state : { ...state, paletteOpen: action.open };
    case 'open-viewer':
      return { ...state, viewer: action.viewer };
    case 'close-viewer':
      return state.viewer === null ? state : { ...state, viewer: null };
    case 'set-single-keys':
      return state.singleKeys === action.on ? state : { ...state, singleKeys: action.on };
    default:
      return state;
  }
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const loadShell: LoadShell = (raw) => {
  if (raw === null) return { ...DEFAULT_SHELL };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SHELL };
  }
  if (!isRecord(parsed)) return { ...DEFAULT_SHELL };
  const bool = (key: keyof ShellState, fallback: boolean) =>
    typeof parsed[key] === 'boolean' ? (parsed[key] as boolean) : fallback;
  const drawer = DRAWERS.find((d) => d === parsed.drawer) ?? null;
  const panelTab = TABS.find((t) => t === parsed.panelTab) ?? DEFAULT_SHELL.panelTab;
  return {
    railWide: bool('railWide', DEFAULT_SHELL.railWide),
    drawer,
    panelOpen: bool('panelOpen', DEFAULT_SHELL.panelOpen),
    panelTab,
    panelFile: null,
    paletteOpen: false,
    viewer: null,
    singleKeys: bool('singleKeys', DEFAULT_SHELL.singleKeys),
  };
};

export const saveShell: SaveShell = (state) =>
  JSON.stringify({
    railWide: state.railWide,
    drawer: state.drawer,
    panelOpen: state.panelOpen,
    panelTab: state.panelTab,
    singleKeys: state.singleKeys,
  });

/** Push or float, so pushing never squeezes the sheet below 480px. */
export const dockModes: DockModesOf = (width, state) => ({
  drawerOverlays: width < (state.railWide ? 1060 : RAIL_NAMES_FROM),
  panelOverlays: width < (state.drawer ? 1400 : 1100),
});

/**
 * The reducer plus the rule that the two docks give way to each other when both cannot push:
 * the most recent wins. Opening a drawer closes a panel that would then float. Opening the panel
 * closes the drawer when the panel could push without it; under 1100px the panel floats instead.
 */
export function giveWay(
  state: ShellState,
  action: ShellAction,
  width: number,
  railShowsNames = state.railWide,
): ShellState {
  const next = shellReducer(state, action);
  const shown = (s: ShellState) => ({ ...s, railWide: railShowsNames });
  const openedDrawer = next.drawer !== null && next.drawer !== state.drawer;
  const openedPanel = next.panelOpen && !state.panelOpen;
  if (openedDrawer && next.panelOpen && dockModes(width, shown(next)).panelOverlays) {
    return { ...next, panelOpen: false };
  }
  if (
    openedPanel &&
    next.drawer !== null &&
    dockModes(width, shown(next)).panelOverlays &&
    !dockModes(width, shown({ ...next, drawer: null })).panelOverlays
  ) {
    return { ...next, drawer: null };
  }
  return next;
}

/** After a resize: when both docks are open and one of them must float, the panel closes. */
export function fitToWidth(state: ShellState, width: number, railShowsNames = state.railWide): ShellState {
  if (state.drawer === null || !state.panelOpen) return state;
  const modes = dockModes(width, { ...state, railWide: railShowsNames });
  return modes.drawerOverlays || modes.panelOverlays ? { ...state, panelOpen: false } : state;
}

/** How the desk is laid out right now: the rail as it shows, the dock modes, and what is modal. */
export interface Layout {
  /** The rail shows names: chosen, wide enough, and not held to icons by the panel. */
  railShowsNames: boolean;
  /** The panel is showing, so the rail is held to icons (unless the person overrode it). */
  railHeld: boolean;
  /** Dock modes for the rail as it shows. */
  modes: DockModes;
  /** A drawer is open and floating. */
  drawerModal: boolean;
  /** The panel is open, a live chat is on the sheet, and no floating drawer is over it. */
  panelShowing: boolean;
  /** The panel is showing and floating. */
  panelModal: boolean;
}

export function layoutOf(
  state: ShellState,
  width: number,
  { liveOnSheet, railOverride }: { liveOnSheet: boolean; railOverride: boolean },
): Layout {
  const chosen = state.railWide && width >= RAIL_NAMES_FROM;
  const panelWanted = state.panelOpen && liveOnSheet;
  const pass = (held: boolean) => {
    const railShowsNames = chosen && !held;
    const modes = dockModes(width, { ...state, railWide: railShowsNames });
    const drawerModal = state.drawer !== null && modes.drawerOverlays;
    return { railShowsNames, modes, drawerModal, panelShowing: panelWanted && !drawerModal };
  };
  // A narrower rail only makes a drawer less likely to float, so a second pass settles it.
  let p = pass(panelWanted && !railOverride);
  // Only names can be held: with icons chosen there is nothing to tuck away.
  const railHeld = chosen && p.panelShowing && !railOverride;
  if (!railHeld) p = pass(false);
  return { ...p, railHeld, panelModal: p.panelShowing && p.modes.panelOverlays };
}

/**
 * The rail toggle (button or `[`). With no panel showing, or under 900px, it flips the person's
 * choice. While the panel shows: if names are showing because the person overrode the hold, the
 * press re-hides them (override off, choice kept); otherwise it shows the names now (override on)
 * and records names as the choice, so a person who had icons sees the names they asked for.
 */
export function toggleRail(
  state: ShellState,
  width: number,
  { panelShowing, railOverride }: { panelShowing: boolean; railOverride: boolean },
): { railWide: boolean; railOverride: boolean } {
  if (!panelShowing || width < RAIL_NAMES_FROM) return { railWide: !state.railWide, railOverride };
  if (railOverride) return { railWide: state.railWide, railOverride: false };
  return { railWide: true, railOverride: true };
}
