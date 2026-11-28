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
import type { Role } from '../../../shared/contract.ts';
import { helpForContext } from '../help/context.ts';
import type { HelpContext } from '../help/contract.ts';
import { helpLibrary } from '../help/library.ts';
import { helpVisible, skillsMenuVisible } from '../help/visibility.ts';
import { initialChatState, pendingCard } from '../state/chat-reducer.ts';
import { keyAction } from '../state/keys.ts';
import {
  dockModes,
  fitToWidth,
  followHome,
  giveWay,
  type Layout,
  layoutOf,
  loadShell,
  RAIL_NAMES_FROM,
  sameStart,
  saveShell,
  shellReducer,
  toggleRail,
} from '../state/shell.ts';
import { type Store, useStore, useToolSnapshot, type View } from '../store.tsx';
import { appsFor } from './app-roles.ts';
import {
  type DrawerName,
  type PanelHold,
  SHELL_STORAGE_KEY,
  type ShellAction,
  type ShellApi,
  type ShellState,
} from './contract.ts';
import { sectionKeys, visibleToolFor } from './sections.ts';
import type { ToolSnapshot } from './sections-contract.ts';
import { settingsTabOrDefault } from './settings-tabs.ts';
import { ShellContext } from './shell-context.ts';
import { todoOpener } from './todo-opener.ts';

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

const DeskContext = createContext<Desk | null>(null);

/** The panel hold's guard, or a plain run outside a ShellProvider (pieces tested on their own). */
export function useGuardPanel(): (run: () => void) => void {
  const s = useContext(ShellContext);
  return s ? s.guardPanel : runNow;
}
const runNow = (run: () => void) => run();

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

/**
 * The close the leave guard sends the to-do panel before a page change (see `guardLeave`). Its own object, so the
 * provider can tell its question from any other the to-do panel asks.
 */
const LEAVE_CLOSE_TODO: ShellAction = { type: 'close-todo' };

/** A shell action with the width it happened at, a resize to fit the docks to, or a page change (Home or not). */
type Step =
  | { action: ShellAction; width: number; rail: boolean }
  | { fit: number; rail: boolean }
  | { onHome: boolean };

/** `rail`: whether the rail shows names, since a drawer's push-or-float depends on it. */
function step(state: ShellState, s: Step): ShellState {
  if ('onHome' in s) return followHome(state, s.onHome);
  return 'fit' in s ? fitToWidth(state, s.fit, s.rail) : giveWay(state, s.action, s.width, s.rail);
}

/**
 * Home is what the sheet shows: the same choice as `SheetContent` in App.tsx (a new chat; or a page that falls back to
 * Home: an unknown app, a tool this person can't see yet, or the guide when Help is off).
 */
export function homeOnSheet(
  view: View,
  activeChat: Store['activeChat'],
  snap: ToolSnapshot,
  helpOn: boolean,
  role?: Role,
): boolean {
  if (view === 'settings' || view === 'profile') return false;
  if (view === 'guide') return !helpOn;
  // `?.`: a store test double may have no view.
  if (view?.startsWith('app:')) return !appsFor(role).some((a) => view === `app:${a.id}`);
  if (view?.startsWith('tool:')) return !visibleToolFor(view, snap);
  return activeChat?.kind !== 'live';
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
  const {
    view,
    activeChat,
    chats,
    boot,
    chatDrawer,
    hideChatDrawer,
    newChatDrawer,
    dropNewChatDrawer,
    settingsTab,
    skillLevels,
    setLeaveGuard,
    setDrawerGuard,
  } = useStore();
  const snap = useToolSnapshot();
  // Read by the key listener and dispatch, which are made once.
  // A store without the drawer (an older test double) reads as closed.
  // An unsent chat in the drawer counts as the drawer being open; hiding it drops the chat (through the drawer hold).
  const chatDrawerRef = useRef({
    open: chatDrawer != null || newChatDrawer != null,
    unsent: newChatDrawer != null,
    hide: hideChatDrawer,
    drop: dropNewChatDrawer,
  });
  chatDrawerRef.current = {
    open: chatDrawer != null || newChatDrawer != null,
    unsent: newChatDrawer != null,
    hide: hideChatDrawer,
    drop: dropNewChatDrawer,
  };
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
    appsFor(role).some((a) => view === `app:${a.id}` && a.Panel !== undefined) ||
    visibleToolFor(view, snap)?.tool.Panel !== undefined;
  const onHome = homeOnSheet(view, activeChat, snap, helpOn, role);
  const onHomeRef = useRef(onHome);
  onHomeRef.current = onHome;
  const [railOverride, setRailOverride] = useState(false);
  const layout = useMemo(
    () => layoutOf(state, width, { liveOnSheet, railOverride, onHome }),
    [state, width, liveOnSheet, railOverride, onHome],
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

  // The right panel's own hold (a tool's or app's panel with typed work). Kept here and not in the shell state: the
  // panel reports it, and the held action is a function that need not be a shell action. `holdRef` is current at once,
  // so two calls in one event see each other.
  const [panelHold, setPanelHoldState] = useState<PanelHold>({ dirty: false, asking: false });
  const holdRef = useRef(panelHold);
  const heldRun = useRef<(() => void) | null>(null);
  const setHold = useCallback((next: PanelHold) => {
    if (holdRef.current.dirty === next.dirty && holdRef.current.asking === next.asking) return;
    holdRef.current = next;
    setPanelHoldState(next);
  }, []);

  // The sheet form's hold (the project form), the panel hold's sibling: only page changes (`guardLeave`) are held.
  const [sheetHold, setSheetHoldState] = useState<PanelHold>({ dirty: false, asking: false });
  const sheetRef = useRef(sheetHold);
  const sheetRun = useRef<(() => void) | null>(null);
  const setSheet = useCallback((next: PanelHold) => {
    if (sheetRef.current.dirty === next.dirty && sheetRef.current.asking === next.asking) return;
    sheetRef.current = next;
    setSheetHoldState(next);
  }, []);

  // The unsent drawer chat's hold: the sheet hold's sibling, with its own slot (the sheet's is shared by the forms on
  // the page). Held: a page change (`guardLeave`) and whatever would replace or close the unsent chat (`guardDrawer`).
  const [drawerHold, setDrawerHoldState] = useState<PanelHold>({ dirty: false, asking: false });
  const drawerRef = useRef(drawerHold);
  const drawerRun = useRef<(() => void) | null>(null);
  // Told when what was held back is dropped unrun (Keep writing, or the text went), so a waiting caller can stop.
  const drawerCancel = useRef<(() => void) | null>(null);
  const dropDrawerRun = useCallback(() => {
    const cancel = drawerCancel.current;
    drawerRun.current = null;
    drawerCancel.current = null;
    cancel?.();
  }, []);
  const setDrawer = useCallback((next: PanelHold) => {
    if (drawerRef.current.dirty === next.dirty && drawerRef.current.asking === next.asking) return;
    drawerRef.current = next;
    setDrawerHoldState(next);
  }, []);
  const guardDrawer = useCallback(
    (run: () => void, cancel?: () => void) => {
      if (!drawerRef.current.dirty) {
        run();
        return;
      }
      // A second question replaces the one held.
      dropDrawerRun();
      drawerRun.current = run;
      drawerCancel.current = cancel ?? null;
      setDrawer({ dirty: true, asking: true });
    },
    [setDrawer, dropDrawerRun],
  );

  // A page change waiting on the to-do panel's question (see `guardLeave`): run on its Discard, dropped on its Keep or
  // when another question replaces it.
  const afterTodo = useRef<(() => void) | null>(null);

  const dispatch = useCallback(
    function dispatch(action: ShellAction) {
      const s = stateRef.current;
      const now = layoutRef.current;
      // The chat drawer is the store's (it goes with the active chat), so hiding it is handed over there.
      if (action.type === 'close-chat-drawer') {
        // An unsent chat is dropped, but only once the drawer hold has been through (it asks when there is text).
        if (chatDrawerRef.current.unsent) guardDrawer(() => chatDrawerRef.current.drop?.());
        else chatDrawerRef.current.hide?.();
        return;
      }
      // The right panel's unsaved-work hold (its state is the provider's own, not the reducer's).
      if (action.type === 'set-panel-dirty') {
        if (!action.dirty) heldRun.current = null;
        setHold({ dirty: action.dirty, asking: action.dirty && holdRef.current.asking });
        return;
      }
      if (action.type === 'keep-panel') {
        heldRun.current = null;
        setHold({ ...holdRef.current, asking: false });
        return;
      }
      if (action.type === 'discard-panel') {
        const run = heldRun.current;
        heldRun.current = null;
        // The work is dropped first, so what was held is not held back again.
        setHold({ dirty: false, asking: false });
        run?.();
        return;
      }
      // The sheet form's hold, the same way.
      if (action.type === 'set-sheet-dirty') {
        if (!action.dirty) sheetRun.current = null;
        setSheet({ dirty: action.dirty, asking: action.dirty && sheetRef.current.asking });
        return;
      }
      if (action.type === 'keep-sheet') {
        sheetRun.current = null;
        setSheet({ ...sheetRef.current, asking: false });
        return;
      }
      if (action.type === 'discard-sheet') {
        const run = sheetRun.current;
        sheetRun.current = null;
        setSheet({ dirty: false, asking: false });
        run?.();
        return;
      }
      // The unsent drawer chat's hold, the same way.
      if (action.type === 'set-drawer-dirty') {
        if (!action.dirty) dropDrawerRun();
        setDrawer({ dirty: action.dirty, asking: action.dirty && drawerRef.current.asking });
        return;
      }
      if (action.type === 'keep-drawer') {
        dropDrawerRun();
        setDrawer({ ...drawerRef.current, asking: false });
        return;
      }
      if (action.type === 'discard-drawer') {
        const run = drawerRun.current;
        drawerRun.current = null;
        drawerCancel.current = null;
        setDrawer({ dirty: false, asking: false });
        // Discard means the message goes, whatever was held back: the unsent chat is dropped first, so its box can't
        // stay on screen (and take more text) while a chat is still starting or the page changes to a tool.
        chatDrawerRef.current.drop?.();
        run?.();
        return;
      }
      // "Keep editing" on the to-do panel also drops a page change waiting on it.
      if (action.type === 'keep-todo') afterTodo.current = null;
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
        // The leave guard's close: the page change carries on to the next hold.
        const after = then === LEAVE_CLOSE_TODO ? afterTodo.current : null;
        afterTodo.current = null;
        after?.();
        return;
      }
      // The to-do panel holds unsaved changes: whatever would close it or move it to another to-do (a drawer
      // swap, Esc, the next to-do) is held back and the panel asks first, so nothing typed is lost at a key press.
      const forced = (action.type === 'close-todo' || action.type === 'open-todo') && action.force === true;
      if (s.todoPanel?.dirty && !discarding.current && !forced && !TODO_BOOKKEEPING.has(action.type)) {
        const next = shellReducer(s, action).todoPanel;
        if (
          next === null ||
          next.key !== s.todoPanel.key ||
          next.mode !== s.todoPanel.mode ||
          !sameStart(next.start ?? null, s.todoPanel.start ?? null)
        ) {
          // Another question replaces the leave guard's: the page change waiting on it is dropped.
          if (action !== LEAVE_CLOSE_TODO) afterTodo.current = null;
          rawDispatch({
            action: { type: 'ask-todo', after: action },
            width: widthRef.current,
            rail: now.railShowsNames,
          });
          return;
        }
      }
      // The right panel holds unsaved work: whatever would shut it (its toggle, Esc, a drawer that needs the room) is
      // held back and the panel asks first.
      if (
        holdRef.current.dirty &&
        s.panelOpen &&
        !giveWay(s, action, widthRef.current, now.railShowsNames).panelOpen
      ) {
        heldRun.current = () => dispatch(action);
        setHold({ dirty: true, asking: true });
        return;
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
      if (action.type === 'open-todo') {
        const active = document.activeElement;
        todoOpener.current =
          action.start && active instanceof HTMLElement && active !== document.body ? active : null;
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
        rawDispatch({
          action: { type: 'open-help', page },
          width: widthRef.current,
          rail: now.railShowsNames,
        });
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
        (action.type === 'set-customise-home' && action.open && !s.homeCustomiseOpen) ||
        (action.type === 'show-chat-file' && !now.panelShowing);
      if (opensDrawer) focusIntent.current = 'left';
      else if (opensPanel) focusIntent.current = 'right';
      rawDispatch({ action, width: widthRef.current, rail: now.railShowsNames });
    },
    [setHold, setSheet, setDrawer, guardDrawer, dropDrawerRun],
  );

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

  // Customise Home belongs to Home: any other page on the sheet shuts it (decision 15). The layout already hides it
  // there, so nothing shows in between.
  useEffect(() => {
    if (!onHome) rawDispatch({ onHome });
  }, [onHome]);

  // Customise Home opens only on Home; it never touches `panelOpen` (This chat's).
  const openCustomiseHome = useCallback(() => {
    if (onHomeRef.current) dispatch({ type: 'set-customise-home', open: true });
  }, [dispatch]);
  const closeCustomiseHome = useCallback(
    () => dispatch({ type: 'set-customise-home', open: false }),
    [dispatch],
  );

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
        unsentDrawer: chatDrawerRef.current.unsent,
      });
      if (!action) return;
      e.preventDefault();
      dispatch(action);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dispatch]);

  const guardPanel = useCallback(
    (run: () => void) => {
      if (!holdRef.current.dirty) {
        run();
        return;
      }
      heldRun.current = run;
      // A resize can shut the panel past the hold; the question lives in the panel, so bring it into view.
      if (!stateRef.current.panelOpen) dispatch({ type: 'set-panel', open: true });
      setHold({ dirty: true, asking: true });
    },
    [setHold, dispatch],
  );

  const guardSheet = useCallback(
    (run: () => void) => {
      if (!sheetRef.current.dirty) {
        run();
        return;
      }
      sheetRun.current = run;
      setSheet({ dirty: true, asking: true });
    },
    [setSheet],
  );

  // The leave guard (plan 2026-11-23-ux-follow-ups, decision 1): every page change a person makes, from the store.
  // One question at a time, always in this order, and nothing runs after a "Keep editing":
  //  1. The to-do panel, only when the right panel or the sheet form holds work: it covers both (they are inert under
  //     it), so it shuts first, through its own hold (a dirty to-do asks; its Discard carries on, its Keep stops).
  //     With nothing else held the to-do panel is left to its own rule: the page changes and the panel then asks.
  //  2. The right panel's hold (`guardPanel`: a shut panel opens to ask).
  //  3. The sheet form's hold.
  //  4. The unsent drawer chat's hold (`opts.skipDrawer`: Open full screen moves the text, so it doesn't ask).
  //  Then the page changes. A second page change while one is asking replaces the one held.
  const guardLeave = useCallback(
    (go: () => void, opts?: { skipDrawer?: boolean }) => {
      const last = opts?.skipDrawer ? go : () => guardDrawer(go);
      const unsaved = () => guardPanel(() => guardSheet(last));
      const s = stateRef.current;
      if (
        s.todoPanel === null ||
        !(holdRef.current.dirty || sheetRef.current.dirty || (drawerRef.current.dirty && !opts?.skipDrawer))
      ) {
        unsaved();
        return;
      }
      afterTodo.current = unsaved;
      dispatch(LEAVE_CLOSE_TODO);
      // Nothing typed in the to-do panel: it has shut, so carry on now. Otherwise it asks, and its answer decides.
      if (!s.todoPanel.dirty) {
        afterTodo.current = null;
        unsaved();
      }
    },
    [guardPanel, guardSheet, guardDrawer, dispatch],
  );

  // The store sends every page change through the guard (it sits outside this provider, so it can't `useShell`).
  // A store without it (an older test double) changes pages at once.
  useEffect(() => {
    setLeaveGuard?.(guardLeave);
    return () => setLeaveGuard?.(null);
  }, [setLeaveGuard, guardLeave]);

  // The store calls it before anything replaces an unsent drawer chat (a second new chat, a chat opened in the drawer).
  useEffect(() => {
    setDrawerGuard?.(guardDrawer);
    return () => setDrawerGuard?.(null);
  }, [setDrawerGuard, guardDrawer]);

  const { modes } = layout;
  const api = useMemo<ShellApi>(
    () => ({
      state,
      dispatch,
      modes,
      panelHold,
      guardPanel,
      sheetHold,
      guardLeave,
      drawerHold,
      guardDrawer,
      onHome,
      homeCustomiseOpen: state.homeCustomiseOpen,
      openCustomiseHome,
      closeCustomiseHome,
    }),
    [
      state,
      dispatch,
      modes,
      panelHold,
      guardPanel,
      sheetHold,
      guardLeave,
      drawerHold,
      guardDrawer,
      onHome,
      openCustomiseHome,
      closeCustomiseHome,
    ],
  );
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
