/**
 * The shell contract: the types and signatures every builder of the layered shell builds against.
 * Plan: docs/plans/2026-11-11-shell-layers.md. Types only; no behaviour lives here.
 *
 * Layers, back to front: desk, rail, docks (left drawer, right panel), sheet, overlays.
 */
import type { ComponentType, ReactNode } from 'react';
import type { LiveSession, PastSession, SkillInfo, TodoItem } from '../../../shared/contract.ts';
import type { ChatItem } from '../state/chat-reducer.ts';

// ── Shell state ────────────────────────────────────────────────────────────────────────────────

/** The left drawers. Only one is open at a time. */
export type DrawerName = 'chats' | 'todos' | 'skills';

/** Tabs in the right panel ("This chat"). */
export type PanelTab = 'steps' | 'details';

export interface ShellState {
  /** True: the rail shows names beside the icons. False: icons only. */
  railWide: boolean;
  drawer: DrawerName | null;
  /** The person's choice. The panel only shows while a live chat is on the sheet. */
  panelOpen: boolean;
  panelTab: PanelTab;
  /** Never saved: the palette is always shut after a reload. */
  paletteOpen: boolean;
  /** Single-key shortcuts ([, T, C, S) on or off. Cmd/Ctrl+K and Esc always work. */
  singleKeys: boolean;
}

export type ShellAction =
  | { type: 'toggle-rail' }
  | { type: 'toggle-drawer'; drawer: DrawerName }
  | { type: 'open-drawer'; drawer: DrawerName }
  | { type: 'close-drawer' }
  | { type: 'toggle-panel' }
  | { type: 'set-panel'; open: boolean }
  | { type: 'set-panel-tab'; tab: PanelTab }
  | { type: 'set-palette'; open: boolean }
  | { type: 'set-single-keys'; on: boolean };

/** `client/src/state/shell.ts` */
export type ShellReducer = (state: ShellState, action: ShellAction) => ShellState;
/** Reads what was saved. Anything missing, malformed or of the wrong type falls back to the default. */
export type LoadShell = (raw: string | null) => ShellState;
/** The saved part of the state as JSON: everything except `paletteOpen`. */
export type SaveShell = (state: ShellState) => string;
export const SHELL_STORAGE_KEY = 'tds-brain-shell';

/**
 * Whether each dock pushes the sheet or floats over it, so the sheet never drops below 480px.
 * `client/src/state/shell.ts` `dockModes(width, state)`:
 * - the drawer overlays under 900px (under 1060px when the rail shows names)
 * - the panel overlays under 1100px (under 1400px when a drawer is open)
 * An overlaying dock is modal: a veil behind it, the rest of the desk `inert`, and Esc, the veil
 * or choosing a row closes it.
 */
export interface DockModes {
  drawerOverlays: boolean;
  panelOverlays: boolean;
}
export type DockModesOf = (width: number, state: ShellState) => DockModes;

/** What `useShell()` returns (`client/src/shell/ShellProvider.tsx`). */
export interface ShellApi {
  state: ShellState;
  dispatch: (action: ShellAction) => void;
  modes: DockModes;
}

// ── Keys ───────────────────────────────────────────────────────────────────────────────────────

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface KeyContext {
  /** Focus is in a text field, select, or editable area. */
  typing: boolean;
  state: ShellState;
  /** The right panel is showing and floats over the sheet, so Esc closes it. Missing means no. */
  panelFloating?: boolean;
}

/**
 * `client/src/state/keys.ts`. The shell action a key press means, or null to leave it alone.
 * - Cmd+K or Ctrl+K: toggle the palette, even while typing.
 * - Esc: shut the palette; else close a floating panel; else close the open drawer; else null.
 *   One thing per press. A pushing panel never closes on Esc.
 *
 * The one global `keydown` listener (in `ShellProvider`) ignores any event whose `defaultPrevented`
 * is true. Anything that handles Esc itself (the chat's close confirm, a card) calls
 * `preventDefault()` so the drawer behind it stays open.
 * - `[`, `t`, `c`, `s` (no modifier, not typing, palette shut, `singleKeys` on): rail, To-dos, Chats, Skills.
 */
export type KeyAction = (e: KeyLike, ctx: KeyContext) => ShellAction | null;

// ── Icons ──────────────────────────────────────────────────────────────────────────────────────

export type IconName =
  | 'home'
  | 'chat'
  | 'todos'
  | 'skills'
  | 'settings'
  | 'rail'
  | 'panel'
  | 'close'
  | 'search'
  | 'chevron'
  | 'go'
  | 'pin'
  | 'image'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'stop'
  | 'paperclip';

/** `client/src/shell/Icon.tsx`. Decorative: always `aria-hidden`; the control carries the name. */
export interface IconProps {
  name: IconName;
  /** Pixels. Default 20. */
  size?: number;
}

// ── Shared pieces (wave 1 builds them; wave 2 uses them) ───────────────────────────────────────

/**
 * `client/src/shell/Dock.tsx`. The sliding holder for a drawer or the panel.
 *
 * `App.tsx` mounts exactly two: one left (its child is the open drawer's body: `TodosDrawer`,
 * `ChatsDrawer` or `SkillsDrawer`) and one right (its child is `Inspector`). Those four components
 * render the body only: no `aside`, no heading, no close button. The Dock renders the `aside`
 * (named by `label`), the `h2` heading (text = `label`, `tabIndex={-1}`, focused when the dock opens
 * by a person's action), the close button, and a scrolling body. A closed dock is `inert` and
 * `aria-hidden`, so nothing in it can be reached.
 */
export interface DockProps {
  side: 'left' | 'right';
  open: boolean;
  /** The heading and the accessible name of the region, e.g. "To-dos". */
  label: string;
  /** True: float over the sheet with a veil (see `DockModes`). False: push the sheet. */
  overlay: boolean;
  /** Called by the close button and by a click on the veil. */
  onClose: () => void;
  /** Sits in the heading row before the close button (e.g. the Chats drawer's "New chat"). */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * `client/src/shell/SheetBar.tsx`. The bar across the top of every sheet. Renders the page's one
 * `h1` (`title`), an optional lead-in before it ("Chats" for a chat), whatever `children` the sheet
 * adds on the right (chip, Stop, panel toggle, Close chat), and last the "Search or jump to"
 * button that opens the palette.
 */
export interface SheetBarProps {
  title: string;
  crumb?: string;
  children?: ReactNode;
}

/**
 * `client/src/shell/SheetNotices.tsx`, no props. The lines every sheet can show, from the store:
 * the offline banner (`streamUp` false), the action error with its Dismiss button (`role="alert"`),
 * and the brief notice (`role="status"`). `App.tsx` mounts it once, at the top of the sheet.
 */
export type SheetNoticesProps = Record<string, never>;

/**
 * `client/src/shell/words.ts`. Wording shared by the rail, drawers, Home, palette and panel, so a
 * status or a date reads the same everywhere. (Moved from Sidebar, Todos and HistoryView.)
 */
/** What the rail says about the brain's last sync (UK English, local time). */
export interface SyncWords {
  /** Older than SYNC_STALE_MS, or never synced: shown in red. A time ahead of the clock is not stale. */
  stale: boolean;
  /** "11:24", or '' when it never synced. */
  time: string;
  /** "12 Nov", or '' when it never synced. */
  date: string;
  /** The words before the time: "Synced", "Not synced since", or "No sync found" (no time follows). */
  lead: string;
  /** One line for the wide rail and the icons-only tooltip: "Synced 11:24, 12 Nov", "Not synced since 11:24, 12 Nov" or "No sync found". */
  line: string;
  /** A full sentence for screen readers, with what to do when stale. */
  spoken: string;
}

export interface Words {
  /** A chat's state in words: "Working", "Needs your answer", "Ready for you", "Stopped by a problem", "Ended". */
  STATE_WORDS: Record<LiveSession['state'], string>;
  /** "Owner", "Scout", "Team", "Role not set". */
  ROLE_WORDS: Record<'owner' | 'scout' | 'team' | 'unknown', string>;
  /**
   * The opening message for a chat about a to-do. Must contain `todo/<id>`: the store keeps the
   * chat linked to the to-do only while the message still mentions it.
   * Exactly: `Help me with this to-do: todo/${todo.id} (${todo.title})`.
   */
  todoChatDraft: (todo: TodoItem) => string;
  /** "11 Nov, 16:42" (en-GB), or '' when the date can't be read. */
  whenWords: (iso: string) => string;
  /** The rail's last-sync stamp. See `SyncWords`. `now` is milliseconds since 1970. */
  syncWords: (lastSync: string | null, now: number) => SyncWords;
  /** The person's pinned skills and the ones used often, as `SkillInfo`, unknown names dropped. */
  starterSkills: (boot: {
    skills: SkillInfo[];
    prefs: { pins: string[] };
    usedOften: { name: string }[];
  }) => { pinned: SkillInfo[]; often: SkillInfo[] };
}

/** `client/src/state/chats.ts`. Needs an answer first, then working, then ready; newest activity first within each. */
export type SortChats = (live: LiveSession[]) => LiveSession[];

/** `client/src/shell/Fold.tsx`. An expanding section: a 30px header button with a count. */
export interface FoldProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** `client/src/shell/Seg.tsx`. A segmented choice (radio group behaviour, arrow keys move). */
export interface SegProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

// ── App slots (hidden until a real app exists) ─────────────────────────────────────────────────

/** `client/src/shell/apps.ts` exports `APPS: AppSlot[]`, empty for now. */
export interface AppSlot {
  /** Lowercase, no spaces. The sheet shows this app when the view is `app:<id>`; an unknown id shows Home. */
  id: string;
  title: string;
  icon: IconName;
  Sheet: ComponentType;
  /** Buttons the app adds to the sheet bar, before "Search or jump to". */
  BarActions?: ComponentType;
  /** The app's body for the right panel. With one, the panel can open while the app is on the sheet. */
  Panel?: ComponentType;
  /** The right panel's heading while this app is on the sheet. Default: the app's title. */
  panelLabel?: string;
}

// ── To-dos drawer ──────────────────────────────────────────────────────────────────────────────

export type TodoGroupKey = 'overdue' | 'today' | 'week' | 'later' | 'none';

export interface TodoGroup {
  key: TodoGroupKey;
  /** "Overdue", "Today", "This week", "Later", "No date". */
  title: string;
  items: TodoItem[];
}

/**
 * `client/src/state/todo-groups.ts`. Groups by `due` against `today` (YYYY-MM-DD), keeping the
 * order given. "week" is tomorrow up to 7 days ahead. Empty groups are left out.
 */
export type GroupTodos = (items: TodoItem[], today: string) => TodoGroup[];

// ── Home ───────────────────────────────────────────────────────────────────────────────────────

export interface NeedsYou {
  /** Mine, overdue or due today or tomorrow, soonest first, at most 4. */
  rows: TodoItem[];
  /** How many of mine are overdue or due today or tomorrow (may exceed `rows.length`). */
  count: number;
  /** The rest of mine: `mine.length - rows.length`. */
  more: number;
}

/** `client/src/state/home.ts` */
export interface HomeLogic {
  needsYou: (mine: TodoItem[], today: string) => NeedsYou;
  /** "Good morning, Sam" (before 12), "Good afternoon, Sam" (before 18), else "Good evening, Sam". */
  greeting: (now: Date, fullName: string) => string;
  /**
   * One plain sentence, e.g. "One to-do is overdue and one chat is waiting for you." Counts of
   * zero are left out; with nothing to say: "Nothing is waiting for you."
   */
  summary: (counts: { overdue: number; dueToday: number; asking: number }) => string;
}

// ── Palette ────────────────────────────────────────────────────────────────────────────────────

export type PaletteCommand =
  | { kind: 'home' }
  | { kind: 'settings' }
  | { kind: 'drawer'; drawer: DrawerName }
  | { kind: 'chat'; sessionId: string }
  | { kind: 'skill'; skill: SkillInfo }
  | { kind: 'todo'; todo: TodoItem };

export interface PaletteOption {
  /** Unique in the list; also the DOM id suffix for `aria-activedescendant`. */
  id: string;
  label: string;
  /** A short second line or trailing note, e.g. a client name or "T". */
  hint: string | null;
  icon: IconName;
  command: PaletteCommand;
}

export interface PaletteGroup {
  /** "Go to", "Open chats", "Run a skill", "Start a chat on a to-do". */
  title: string;
  options: PaletteOption[];
}

export interface PaletteData {
  live: LiveSession[];
  skills: SkillInfo[];
  /** Skill names, pinned first: used to order skills when the query is empty. */
  pins: string[];
  todos: TodoItem[];
}

/**
 * `client/src/state/palette.ts`. Case-insensitive match of every word of `query` against the label.
 * Empty query: all "Go to" options, open chats, pinned skills and the first five to-dos.
 * At most 6 options per group; empty groups are left out.
 */
export type PaletteGroups = (query: string, data: PaletteData) => PaletteGroup[];

// ── Right panel ────────────────────────────────────────────────────────────────────────────────

export interface StepRow {
  id: string;
  label: string;
  status: 'running' | 'ok' | 'failed';
  /** 0 for Claude's own steps, 1+ for a helper's steps under one of them. */
  depth: number;
}

/** `client/src/state/steps.ts`. Every tool step of the chat, in order, helpers' steps nested after their parent. */
export type StepsOf = (items: ChatItem[]) => StepRow[];

// ── Chats drawer ───────────────────────────────────────────────────────────────────────────────

/** The two lists in the Chats drawer. "Earlier" is what the old History page showed. */
export type ChatsTab = 'open' | 'earlier';
export interface ChatsLists {
  open: LiveSession[];
  earlier: PastSession[];
}
