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
import { helpForContext } from '../help/context.ts';
import type { HelpContext } from '../help/contract.ts';
import { helpLibrary } from '../help/library.ts';
import { helpVisible, skillsMenuVisible } from '../help/visibility.ts';
import { initialChatState, pendingCard } from '../state/chat-reducer.ts';
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
  shellReducer,
  toggleRail,
} from '../state/shell.ts';
import { type Store, useStore, useToolSnapshot } from '../store.tsx';
import { APPS } from './apps.ts';
import {
  type DrawerName,
  SHELL_STORAGE_KEY,
  type ShellAction,
  type ShellApi,
  type ShellState,
} from './contract.ts';
import { sectionKeys, visibleToolFor } from './sections.ts';
import { settingsTabOrDefault } from './settings-tabs.ts';

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
  /**
   * What had focus when the file viewer was asked for, so closing it can put focus back. Taken in
   * `dispatch`, before the desk goes inert and the browser moves focus away from it.
   */
  viewerOpener: RefObject<HTMLElement | null>;
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

/** The to-do panel's own housekeeping: never held back by unsaved changes. */
const TODO_BOOKKEEPING: ReadonlySet<string> = new Set([
  'set-todo-dirty',
  'set-todo-mode',
  'set-todo-order',
  'ask-todo',
  'keep-todo',
]);

/** A shell action with the width it happened at, or a resize to fit the docks to. */
type Step = { action: ShellAction; width: number; rail: boolean } | { fit: number; rail: boolean };

/** `rail`: whether the rail shows names, since a drawer's push-or-float depends on it. */
function step(state: ShellState, s: Step): ShellState {
  return 'fit' in s ? fitToWidth(state, s.fit, s.rail) : giveWay(state, s.action, s.width, s.rail);
}

/** Where the person is, in the words Help uses: Home is the chat view with no active chat. */
function helpContext(
  { view, activeChat, chats, settingsTab }: Pick<Store, 'view' | 'activeChat' | 'chats' | 'settingsTab'>,
  drawer: DrawerName | null,
): HelpContext {
  const live = activeChat.kind === 'live';
  const chat = live ? chats[activeChat.sessionId] : undefined;
  return {
    view: view === 'chat' && !live ? 'home' : (view as HelpContext['view']),
    drawer,
    waiting: pendingCard(chat ?? initialChatState) !== null,
    ...(view === 'settings' && settingsTab ? { settingsTab } : {}),
  };
}

function isTyping(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.matches('input, textarea, select') || el.isContentEditable === true;
}

/** Focus is in the chat drawer's message box and something is typed there. */
function draftInChatDrawer(el: Element | null): boolean {
  return (
    el instanceof HTMLTextAreaElement &&
    el.closest('[data-placement="drawer"]') !== null &&
    el.value.trim() !== ''
  );
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(step, undefined, initialState);
  const [width, setWidth] = useState(windowWidth);
  const widthRef = useRef(width);
  widthRef.current = width;
  const stateRef = useRef(state);
  stateRef.current = state;
  const focusIntent = useRef<DockSide | null>(null);
  const viewerOpener = useRef<HTMLElement | null>(null);

  // The panel only shows for a live chat on the sheet, or an app that brings a panel of its own;
  // while it shows, the rail is held to icons.
  const { view, activeChat, chats, boot, chatDrawer, hideChatDrawer, settingsTab, skillLevels } = useStore();
  const snap = useToolSnapshot();
  // Read by the key listener and dispatch, which are made once.
  // A store without the drawer (an older test double) reads as closed.
  const chatDrawerRef = useRef({ open: chatDrawer != null, hide: hideChatDrawer });
  chatDrawerRef.current = { open: chatDrawer != null, hide: hideChatDrawer };
  const role = boot?.identity.role ?? 'unknown';
  const helpOn = helpVisible(role);
  const helpOnRef = useRef(helpOn);
  helpOnRef.current = helpOn;
  const skillsHidden = !skillsMenuVisible(role);
  const skillsHiddenRef = useRef(skillsHidden);
  skillsHiddenRef.current = skillsHidden;
  // Where the person is, read only when Help opens (see `dispatch`): the page Help starts on follows from it.
  // The sections visible now and their single keys (`W`), read by the key listener.
  const sectionKeysRef = useRef<Record<string, string>>({});
  sectionKeysRef.current = sectionKeys(snap);
  const whereRef = useRef({ view, activeChat, chats, settingsTab });
  // The tab on show: a remembered Skill levels tab that is hidden shows General, and Help follows what shows.
  whereRef.current = {
    view,
    activeChat,
    chats,
    settingsTab: settingsTabOrDefault(settingsTab, { hasSkillLevels: Boolean(skillLevels) }),
  };
  const liveOnSheet =
    (view === 'chat' && activeChat?.kind === 'live') ||
    APPS.some((a) => view === `app:${a.id}` && a.Panel !== undefined) ||
    visibleToolFor(view, snap)?.tool.Panel !== undefined;
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

  // Set while "Discard" runs the action the to-do panel held back, so it is not held back again.
  const discarding = useRef(false);

  const dispatch = useCallback(function dispatch(action: ShellAction) {
    const s = stateRef.current;
    const now = layoutRef.current;
    // The chat drawer is the store's (it goes with the active chat), so hiding it is handed over there.
    if (action.type === 'close-chat-drawer') {
      chatDrawerRef.current.hide?.();
      return;
    }
    // "Discard": drop the unsaved changes, then do what was asked.
    if (action.type === 'discard-todo') {
      const then = s.todoPanel?.ask ?? null;
      rawDispatch({
        action: { type: 'set-todo-dirty', dirty: false },
        width: widthRef.current,
        rail: now.railShowsNames,
      });
      if (then) {
        discarding.current = true;
        try {
          dispatch(then);
        } finally {
          discarding.current = false;
        }
      }
      return;
    }
    // The to-do panel holds unsaved changes: whatever would close it or move it to another to-do (a drawer
    // swap, Esc, the next to-do) is held back and the panel asks first, so nothing typed is lost at a key press.
    const forced = (action.type === 'close-todo' || action.type === 'open-todo') && action.force === true;
    if (s.todoPanel?.dirty && !discarding.current && !forced && !TODO_BOOKKEEPING.has(action.type)) {
      const next = shellReducer(s, action).todoPanel;
      if (next === null || next.key !== s.todoPanel.key || next.mode !== s.todoPanel.mode) {
        rawDispatch({
          action: { type: 'ask-todo', after: action },
          width: widthRef.current,
          rail: now.railShowsNames,
        });
        return;
      }
    }
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
    if (action.type === 'open-viewer' && s.viewer === null) {
      const active = document.activeElement;
      viewerOpener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    // Opening Help decides its first page now: the one asked for, else the one for where the person is.
    if (
      s.drawer !== 'help' &&
      (action.type === 'open-help' ||
        ((action.type === 'toggle-drawer' || action.type === 'open-drawer') && action.drawer === 'help'))
    ) {
      if (!helpOnRef.current) return;
      const page =
        action.type === 'open-help' && action.page
          ? action.page
          : helpForContext(helpContext(whereRef.current, s.drawer), helpLibrary);
      focusIntent.current = 'left';
      rawDispatch({ action: { type: 'open-help', page }, width: widthRef.current, rail: now.railShowsNames });
      return;
    }
    // Asking for a page while Help shows moves it there.
    if (action.type === 'open-help' && !action.page) return;
    const opensDrawer =
      ((action.type === 'toggle-drawer' || action.type === 'open-drawer') && s.drawer !== action.drawer) ||
      ((action.type === 'toggle-section' || action.type === 'open-section') &&
        (s.drawer !== 'section' || s.section !== action.section)) ||
      // Closing Help puts a drawer back, which takes focus like any drawer a person opened.
      ((action.type === 'close-help' || (action.type === 'toggle-drawer' && action.drawer === 'help')) &&
        s.drawer === 'help' &&
        s.helpReturn !== null);
    const opensPanel =
      (action.type === 'toggle-panel' && !s.panelOpen) ||
      (action.type === 'set-panel' && action.open) ||
      (action.type === 'show-chat-file' && !now.panelShowing);
    if (opensDrawer) focusIntent.current = 'left';
    else if (opensPanel) focusIntent.current = 'right';
    rawDispatch({ action, width: widthRef.current, rail: now.railShowsNames });
  }, []);

  // Opening an app or a tool (from the rail, a drawer, the palette or a search result) closes the open drawer, so it
  // has the room. Only on the move into an app: a drawer opened while the app shows stays open.
  const lastView = useRef(view);
  useEffect(() => {
    const was = lastView.current;
    lastView.current = view;
    if (view === was || !(view.startsWith('app:') || view.startsWith('tool:')) || !stateRef.current.drawer)
      return;
    // Focus still in the drawer (the palette hands it back there; Safari doesn't focus a clicked
    // button) would otherwise be sent to the drawer's rail button as it closes: send it to the app.
    const active = document.activeElement;
    if (!active || active === document.body || document.getElementById('drawer')?.contains(active))
      document.getElementById('main')?.focus({ preventScroll: true });
    dispatch({ type: 'close-drawer' });
  }, [view, dispatch]);

  // The Skills drawer is only for owners and scouts: one saved from before (or opened any other way) shuts.
  const skillsDrawer = state.drawer === 'skills';
  useEffect(() => {
    if (skillsDrawer && skillsHidden) dispatch({ type: 'close-drawer' });
  }, [skillsDrawer, skillsHidden, dispatch]);

  // A new page (the rail, a link in a drawer, Home, a search result) closes the to-do panel, which would
  // otherwise stay over it with the sheet out of reach. With unsaved changes the panel asks first.
  const todoView = useRef(view);
  useEffect(() => {
    const was = todoView.current;
    todoView.current = view;
    // Moving into an app with the drawer open: the effect above closes the drawer, which closes the panel too
    // (and asks first). Asking again here would replace that question, so Discard would leave the drawer open.
    if (view === was || stateRef.current.todoPanel === null) return;
    if ((view?.startsWith('app:') || view?.startsWith('tool:')) && stateRef.current.drawer) return;
    dispatch({ type: 'close-todo' });
  }, [view, dispatch]);

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
        helpVisible: helpOnRef.current,
        skillsHidden: skillsHiddenRef.current,
        sectionKeys: sectionKeysRef.current,
        // Under a floating left drawer the sheet (and the chat drawer in it) is out of reach: Esc is the drawer's.
        chatDrawer: chatDrawerRef.current.open && !layoutRef.current.drawerModal,
        chatDraft: draftInChatDrawer(document.activeElement),
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
      viewerOpener,
    }),
    [width, layout],
  );

  return (
    <ShellContext.Provider value={api}>
      <DeskContext.Provider value={desk}>{children}</DeskContext.Provider>
    </ShellContext.Provider>
  );
}
