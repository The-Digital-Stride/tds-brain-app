/**
 * The shell contract: the types and signatures every builder of the layered shell builds against.
 * Plan: docs/plans/2026-11-11-shell-layers.md. Types only; no behaviour lives here.
 *
 * Layers, back to front: desk, rail, docks (left drawer, right panel), sheet, overlays.
 */
import type { ComponentType, ReactNode } from 'react';
import type { AdsSummary } from '../../../shared/ads-contract.ts';
import type {
  ClientInfo,
  LibraryItem,
  LiveSession,
  PastSession,
  SkillInfo,
  TodoItem,
  TodoList,
} from '../../../shared/contract.ts';
import type { ProjectCard } from '../../../shared/projects-contract.ts';
import type { SettingsTab } from './settings-tabs.ts';

// ── Shell state ────────────────────────────────────────────────────────────────────────────────

/** The left drawers. Only one is open at a time. */
export type DrawerName = 'chats' | 'todos' | 'skills' | 'help' | 'section';

/**
 * Tabs in the right panel ("This chat"). `files`: plan 2026-11-13-chat-files. A Steps tab was
 * removed in v0.21 (the chat's "What Claude did" folds show them); a saved `steps` loads as `files`.
 */
export type PanelTab = 'files' | 'details';

export interface ShellState {
  /** True: the rail shows names beside the icons. False: icons only. */
  railWide: boolean;
  drawer: DrawerName | null;
  /**
   * The drawer Help replaced when it opened, or null. Never saved. Closing Help with `close-help` (its close
   * button, `H`, Esc) reopens it; opening any other drawer or `close-drawer` clears it.
   */
  helpReturn: DrawerName | null;
  /**
   * Which section the `'section'` drawer shows (a `SectionSlot.id`), or null. Never saved: a section drawer isn't
   * restored on reload, since visibility loads after the shell. Plan 2026-11-16-workbench-ad-manager, decision 2.
   */
  section: string | null;
  /** The help page id Help opened on (decided when it opened), or null. Never saved. */
  helpPage: string | null;
  /** Goes up by one each time Help is opened on a page, so the drawer starts afresh even on the same page. Never saved. */
  helpOpened: number;
  /** The person's choice. The panel only shows while a live chat is on the sheet. */
  panelOpen: boolean;
  panelTab: PanelTab;
  /**
   * The chat file open in the panel's Files tab, or null for the list. Never saved; cleared when the
   * tab changes. Tagged with its chat: the panel shows the preview only while that chat is the
   * active one and the key is in its snapshot, so switching chats needs no clearing.
   */
  panelFile: { chat: string; key: string } | null;
  /** Never saved: the palette is always shut after a reload. */
  paletteOpen: boolean;
  /**
   * The file shown large over the desk (`FileViewer`), or null. Never saved. While it shows, the
   * desk is `inert`, Esc closes it, and focus goes back to whatever opened it.
   */
  viewer: ViewerRequest | null;
  /**
   * The to-do open in the to-do panel (`TodoPanel`, plan 2026-11-16-todo-panel), or null. Never saved. It
   * belongs to the To-dos drawer: it closes whenever that drawer does or another replaces it.
   */
  todoPanel: TodoPanelState | null;
  /** Single-key shortcuts ([, T, C, S) on or off. Cmd/Ctrl+K and Esc always work. */
  singleKeys: boolean;
  /**
   * The width the person dragged the file viewer to, in px, or null for its default. Saved. It is
   * held inside the limits for the window as it is (`useLayerWidth`), so a stale value is harmless.
   */
  viewerWidth: number | null;
  /** The width the person dragged the chat drawer to, in px, or null for its default. Saved, like `viewerWidth`. */
  chatDrawerWidth: number | null;
}

/**
 * A file to show in the file viewer: a drawer that slides over the sheet, so the person reads the
 * file without leaving what they were doing (a chat, say). Any part of the app can ask for one.
 */
export interface LibraryViewerRequest {
  /** Missing means a library file (every request written before pages existed). */
  kind?: 'file';
  item: LibraryItem;
  /** Where the file is, shown under its name (the client or library's name). */
  place?: string;
  /** Offer "Open in Documents" (or Images): the app and library scope that hold the file. */
  openIn?: { app: 'documents' | 'images'; scope: string };
}

/**
 * A page Claude published in a chat (plan 2026-11-14-artifacts-in-app, decision 4): `key` is the
 * page's key in that chat's files snapshot. The viewer follows the page as it gains versions.
 */
export interface PageViewerRequest {
  kind: 'page';
  chat: string;
  key: string;
}

export type ViewerRequest = LibraryViewerRequest | PageViewerRequest;

/** What the to-do panel is doing: reading a to-do, editing it, or adding a new one. */
export type TodoPanelMode = 'read' | 'edit' | 'add';

export interface TodoPanelState {
  /** The to-do's `key`, or null while adding a new one. */
  key: string | null;
  mode: TodoPanelMode;
  /** Unsaved changes in edit or add mode. Set by the panel; while true, anything that would close or change the panel asks first. */
  dirty: boolean;
  /**
   * An action that was held back because the panel had unsaved changes (a drawer swap, the next to-do, a close).
   * The panel asks "Discard your changes?"; Discard runs it, Keep editing drops it.
   */
  ask: ShellAction | null;
  /** The keys of the to-dos the drawer shows now, in order, held ones left out: what previous and next walk through. */
  order: string[];
}

export type ShellAction =
  | { type: 'toggle-rail' }
  | { type: 'toggle-drawer'; drawer: DrawerName }
  | { type: 'open-drawer'; drawer: DrawerName }
  | { type: 'close-drawer' }
  /** Opens the section drawer on `section`. */
  | { type: 'open-section'; section: string }
  /** Opens it, or closes it when that same section is already open. */
  | { type: 'toggle-section'; section: string }
  /** Opens Help over whatever is open, on page `page` (null: the welcome page). Records `helpReturn`. */
  | { type: 'open-help'; page: string | null }
  /** Closes Help and reopens the drawer it replaced, if any. Does nothing when Help is not open. */
  | { type: 'close-help' }
  | { type: 'toggle-panel' }
  | { type: 'set-panel'; open: boolean }
  | { type: 'set-panel-tab'; tab: PanelTab }
  /**
   * Opens the panel on the Files tab showing `key` of chat `chat` (null: the Files list). Used by
   * reply links, the chat's steps and the list's rows and Back button. Sets `panelOpen`, `panelTab: 'files'` and
   * `panelFile` in one update. It opens the panel, so `ShellProvider` treats it like `set-panel` open.
   */
  | { type: 'show-chat-file'; chat: string; key: string | null }
  | { type: 'set-palette'; open: boolean }
  /** Shows a file in the viewer over the desk (replacing one already shown). */
  | { type: 'open-viewer'; viewer: ViewerRequest }
  /**
   * Fills in more about the file the viewer shows (where it is, "Open in Documents", a newer copy),
   * only while that same file is still shown: a late answer never reopens or replaces anything.
   */
  | { type: 'update-viewer'; viewer: LibraryViewerRequest }
  | { type: 'close-viewer' }
  /** Opens the to-do panel on a to-do (read or edit) or, with a null key, on the add form. Replaces one already open (`force`: even over unsaved changes, for a to-do that was just saved or added). */
  | { type: 'open-todo'; key: string | null; mode: TodoPanelMode; force?: true }
  | { type: 'set-todo-mode'; mode: TodoPanelMode }
  | { type: 'set-todo-dirty'; dirty: boolean }
  | { type: 'set-todo-order'; order: string[] }
  /** Previous (-1) or next (1) to-do in `todoPanel.order`. */
  | { type: 'todo-step'; dir: -1 | 1 }
  /** Shuts the panel. `force`: a held change or finished add, which asks nothing even with unsaved changes. */
  | { type: 'close-todo'; force?: true }
  /** Held back by unsaved changes: the panel shows its question. Only the shell provider sends it. */
  | { type: 'ask-todo'; after: ShellAction }
  /** "Keep editing": drops the held-back action. */
  | { type: 'keep-todo' }
  /** "Discard": runs the held-back action with the changes dropped. Handled by the shell provider. */
  | { type: 'discard-todo' }
  /**
   * The right panel (a tool's or app's) says whether it holds unsaved work, to the shell provider, which keeps it in
   * `ShellApi.panelHold` (design system, Actions rule 9). While true, a close of the panel, or a step the panel passes to
   * `guardPanel`, is held back and the panel asks "Discard your changes?". Not part of `ShellState`: the reducer ignores it.
   */
  | { type: 'set-panel-dirty'; dirty: boolean }
  /** "Keep editing": drops the held-back action. Handled by the shell provider. */
  | { type: 'keep-panel' }
  /** "Discard changes": the panel's work is dropped and the held-back action runs. Handled by the shell provider. */
  | { type: 'discard-panel' }
  /**
   * A form on the sheet (the project form) says whether it holds unsaved work, kept in `ShellApi.sheetHold` (plan
   * 2026-11-23-ux-follow-ups, decision 1). While true, a page change (`guardLeave`) is held back and the form asks
   * "Discard your changes?". One form at a time: the sheet shows one page. Not part of `ShellState`.
   */
  | { type: 'set-sheet-dirty'; dirty: boolean }
  /** "Keep editing": drops the held-back page change. Handled by the shell provider. */
  | { type: 'keep-sheet' }
  /** "Discard changes": the form's work is dropped and the held-back page change runs. Handled by the shell provider. */
  | { type: 'discard-sheet' }
  | { type: 'set-single-keys'; on: boolean }
  /** The viewer's width in px, or null for its default. */
  | { type: 'set-viewer-width'; width: number | null }
  /** The chat drawer's width in px, or null for its default. */
  | { type: 'set-chat-drawer-width'; width: number | null }
  /** Hides the chat drawer. Held in the store (`hideChatDrawer`): `ShellProvider` hands it over, the reducer ignores it. */
  | { type: 'close-chat-drawer' };

/** `client/src/state/shell.ts` */
export type ShellReducer = (state: ShellState, action: ShellAction) => ShellState;
/** Reads what was saved. Anything missing, malformed or of the wrong type falls back to the default. */
export type LoadShell = (raw: string | null) => ShellState;
/** The saved part of the state as JSON: everything except `paletteOpen`, `panelFile` and `viewer`. */
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
  /** The right panel's unsaved-work hold: `dirty` is what it last reported, `asking` that an action is held and it should show the question. */
  panelHold: PanelHold;
  /**
   * Runs `run` now, or, while the right panel holds unsaved work, asks first and runs it on "Discard changes"
   * (never on "Keep editing"). For what changes the panel's content without a shell action (choosing another
   * proposal, another account).
   */
  guardPanel: (run: () => void) => void;
  /** The sheet form's unsaved-work hold, the same shape as `panelHold`. */
  sheetHold: PanelHold;
  /**
   * The leave guard: runs `go` (a page change) now, or asks first while unsaved work would be lost, and runs it only
   * once every question has had "Discard changes" (never after "Keep editing"). The store sends every page change a
   * person makes through it (`Store.setLeaveGuard`); an in-page move that bypasses the store can call it too.
   * One question at a time, in this order: the to-do panel (it covers the sheet and the right panel, so it shuts
   * first, through its own hold), then the right panel, then the sheet form.
   */
  guardLeave: (go: () => void) => void;
}

/** An unsaved-work hold (the right panel's or the sheet form's). */
export interface PanelHold {
  dirty: boolean;
  asking: boolean;
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
  /** Help is switched on for this person's role (`helpVisible`). Missing means no. */
  helpVisible?: boolean;
  /** The Skills drawer is not this person's (`skillsMenuVisible`): `s` does nothing. Missing means shown. */
  skillsHidden?: boolean;
  /** Single key to section id, for the sections visible to this person now (`W` for Workbench). Missing means none. */
  sectionKeys?: Record<string, string>;
  /** The chat drawer is open over the tool (plan 2026-11-16-run-chat-drawer). Missing means no. */
  chatDrawer?: boolean;
  /** Focus is in the chat drawer's message box and it holds text: Esc then does nothing, so no typing is lost. */
  chatDraft?: boolean;
}

/**
 * `client/src/state/keys.ts`. The shell action a key press means, or null to leave it alone.
 * - Cmd+K or Ctrl+K: toggle the palette, even while typing.
 * - While the file viewer shows: Esc closes it, and no other key does anything to the desk behind it.
 * - Esc: shut the palette; else close a floating panel; else hide the chat drawer (nothing at all while its
 *   message box holds text); else close the open drawer; else null.
 *   One thing per press. A pushing panel never closes on Esc.
 *
 * The one global `keydown` listener (in `ShellProvider`) ignores any event whose `defaultPrevented`
 * is true. Anything that handles Esc itself (the chat's close confirm, a card) calls
 * `preventDefault()` so the drawer behind it stays open.
 * - While the to-do panel is open: Esc closes it first (it asks when there are unsaved changes), and `p` / `n`
 *   move to the previous / next to-do. Anything that would close or change the panel while it holds unsaved changes
 *   is held back and asks (`ShellProvider`).
 * - `[`, `t`, `c`, `s` (no modifier, not typing, palette shut, `singleKeys` on): rail, To-dos, Chats, Skills
 *   (`s` only without `skillsHidden`).
 * - `/` (not typing, palette shut, `singleKeys` on; Shift allowed, as some keyboards need it): open the global search.
 * - `h` toggles Help and `?` opens it (Shift allowed), under the same rules, and only with `helpVisible`.
 */
export type KeyAction = (e: KeyLike, ctx: KeyContext) => ShellAction | null;

// ── Icons ──────────────────────────────────────────────────────────────────────────────────────

export type IconName =
  | 'end'
  | 'expand'
  | 'home'
  | 'star'
  | 'edit'
  | 'more'
  | 'chat'
  | 'todos'
  | 'skills'
  | 'settings'
  | 'rail'
  | 'panel'
  | 'close'
  | 'search'
  | 'chevron'
  | 'check'
  | 'go'
  | 'link'
  | 'image'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'stop'
  | 'send'
  | 'paperclip'
  | 'plus'
  | 'lock'
  | 'calendar'
  /** A folder with a tab: Projects. */
  | 'folder'
  | 'person'
  | 'bin'
  | 'help'
  | 'up'
  | 'heading'
  | 'body'
  | 'bullets'
  | 'numbers'
  | 'bold'
  /** Six dots: the handle that drags something to a new place. */
  | 'grip'
  /** Arrows apart: make something span the full width. */
  | 'wide'
  /** A toolbox: the Workbench section. */
  | 'workbench'
  /** A rising line: Ads Account Summary. */
  | 'chart'
  /** A tray: Ads Manager (decisions waiting). */
  | 'inbox'
  /** A triangle: Ads Command Centre (tasks to run). */
  | 'play'
  /** A circling arrow: check for updates. */
  | 'refresh'
  /** An arrow down into a tray: install an update. */
  | 'update';

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
 * adds on the right (chip, Stop, panel toggle, End chat), and last the "Search or jump to"
 * button that opens the palette.
 */
export interface SheetBarProps {
  title: string;
  crumb?: string;
  /** Screen-reader-only text added after the title inside the h1; the `title` attribute carries both. */
  titleHidden?: string;
  /** The right panel's toggle label ("Files and details"). Given, the toggle sits last: top right. */
  panel?: string;
  /** Sheet buttons, placed before "Search or jump to". */
  children?: ReactNode;
}

/**
 * `client/src/shell/SheetNotices.tsx`, no props. The lines every sheet can show, from the store:
 * the update banner (`UpdateBanner`: a newer version can be installed, hidden while the page is
 * already out of date), the offline banner (`streamUp` false), the action error with its Dismiss button (`role="alert"`),
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
   * The opening message for a chat about a to-do. Must contain the to-do's `path` (`todo/<id>`
   * or `personal/todo/<id>`): the store keeps the chat linked to the to-do only while the message still
   * mentions it. Exactly: `Help me with this to-do: ${todo.path} (${todo.title})`.
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
  /** Set to control it from outside (with `onToggle`); left out, the fold keeps its own state. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  /** Shown beside the heading, never inside its toggle (e.g. "Mark all as seen"). */
  action?: ReactNode;
  children: ReactNode;
}

/** `client/src/shell/Seg.tsx`. A segmented choice (radio group behaviour, arrow keys move). */
export interface SegProps<T extends string> {
  label: string;
  /** Id of a visible label; when set, it names the group instead of `label` (which is then not read). */
  labelledBy?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

// ── App slots (hidden until a real app exists) ─────────────────────────────────────────────────

/** `client/src/shell/apps.ts` exports `APPS: AppSlot[]` (Images, Documents). */
export interface AppSlot {
  /** Lowercase, no spaces. The sheet shows this app when the view is `app:<id>`; an unknown id shows Home. */
  id: string;
  title: string;
  icon: IconName;
  Sheet: ComponentType;
  /** Buttons the app adds to the sheet bar, before "Search or jump to". */
  BarActions?: ComponentType;
  /**
   * How the global search ("Search or jump to") finds this app's things. REQUIRED for every app: a new
   * app is searchable as part of building it (plan 2026-11-13-global-search, decision 9). `null` only with
   * a reason listed in `client/src/shell/apps.test.ts`, which fails otherwise. The source must not import
   * the app's lazy UI chunk.
   */
  search: SearchSource | null;
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

/** The drawer's filters (decision 7). Nothing here is remembered between visits. Text search is global (plan 2026-11-13-global-search). */
export interface TodoFilter {
  scope: 'all' | 'tds' | 'personal';
  /** A client slug, or null for every client. */
  client: string | null;
  /**
   * Projects R1 (decision 11): a ProjectKey, or null/absent for every project. The app-wide picker's
   * project takes this place while it holds one (callers pass it in), so it is never shown as a choice.
   */
  project?: string | null;
}

/**
 * `client/src/state/todo-filter.ts`. Keeps the order given. Scope 'all' and client null return `items`
 * unchanged. `clients` is kept for callers; the filter no longer matches text.
 */
export type FilterTodos = (
  items: TodoItem[],
  filter: TodoFilter,
  clients: { slug: string; name: string }[],
) => TodoItem[];

/**
 * `client/src/state/todo-new.ts` (decision 6). The to-dos in `mine` that are "New to you": a handover by
 * someone other than `me`, dated within TODO_NEW_DAYS of `now`, whose `handover.at` isn't `seen[key]`.
 * Keeps the order given.
 */
export type NewToYou = (mine: TodoItem[], me: string, seen: Record<string, string>, now: Date) => TodoItem[];

// ── Home ───────────────────────────────────────────────────────────────────────────────────────

/** `client/src/state/home.ts` */
export interface HomeLogic {
  /** "Good morning, Sam" (before 12), "Good afternoon, Sam" (before 18), else "Good evening, Sam". */
  greeting: (now: Date, fullName: string) => string;
  /**
   * One plain sentence, e.g. "One to-do is overdue and one chat is waiting for you." Counts of
   * zero are left out; with nothing to say: "Nothing is waiting for you."
   */
  summary: (counts: { overdue: number; dueToday: number; asking: number }) => string;
}

// ── Chats drawer ───────────────────────────────────────────────────────────────────────────────

/** The two lists in the Chats drawer. "Earlier" is what the old History page showed. */
export type ChatsTab = 'open' | 'earlier';
export interface ChatsLists {
  open: LiveSession[];
  earlier: PastSession[];
}

// ── Global search (plan 2026-11-13-global-search) ──────────────────────────────────────────────────

/** What a hit may do when chosen. The palette closes itself after `run` unless the hit says otherwise. */
export interface SearchActions {
  openView: (view: 'chat' | 'settings' | 'profile' | 'guide' | `app:${string}`) => void;
  /** Opens Settings on a tab. Optional: without it a Settings tab entry opens Settings on the remembered tab. */
  openSettings?: (tab: SettingsTab) => void;
  /** Opens a section's tool on the sheet (store `openTool`), closing the open drawer. `arg` is handed to the tool. */
  openTool: (sectionId: string, toolId: string, arg?: string) => void;
  /** Opens the Help drawer on a page (a help page id). */
  openHelp: (id: string) => void;
  /** Shows Home (the sheet with no chat or app). */
  goHome: () => void;
  openDrawer: (drawer: DrawerName) => void;
  openChat: (sessionId: string) => void;
  /** Reopens an earlier chat (store `openPast`). */
  openPast: (sdkSessionId: string) => void;
  startSkill: (skill: SkillInfo) => void;
  /** Opens the to-dos drawer on the to-do's tab, clears its filters, opens its group and focuses its row. */
  revealTodo: (todo: TodoItem) => void;
  /** Shows Home with this client chosen. */
  chooseClient: (slug: string) => void;
  /**
   * Opens a library app (`app:<appId>`) on `scope` with `item` selected, and the file in the viewer
   * drawer. `place` is the library's name, shown under the file's.
   */
  openLibraryItem: (appId: string, scope: string, item: LibraryItem, place?: string) => void;
  /** Projects R1 (decision 14): sets the app-wide picker to this project (and so its client) and shows Home. */
  filterToProject?: (key: string) => void;
}

export interface SearchHit {
  /** Unique within its source. */
  id: string;
  label: string;
  /** Second line or trailing note (client name, "My personal files", due date). */
  hint: string | null;
  icon: IconName;
  /**
   * More than the row can hold, for a tooltip on hover or when the row is highlighted from the keyboard
   * (`client/src/shell/PaletteTip.tsx`). Given: the tooltip always shows, with the label, these lines and the
   * path. Omitted: it shows the label and hint only when the row cuts either of them short.
   */
  detail?: SearchHitDetail;
  run: (actions: SearchActions) => void;
}

export interface SearchHitDetail {
  /** Plain lines under the label: "acme-logo.png", "Acme Heating Ltd · Brand", "PNG · 1200 × 628 · 184 KB · Changed 5 Nov 2026". */
  lines: string[];
  /** A file path, shown last in monospace and broken anywhere so it always fits. */
  path?: string;
}

/** The data every synchronous source searches; a snapshot from the store. */
export interface SearchContext {
  me: string;
  todos: TodoList | null;
  live: LiveSession[];
  past: PastSession[];
  skills: SkillInfo[];
  pins: string[];
  clients: ClientInfo[];
  /** Help is switched on for this person's role: "Go to" lists Help. Missing means no. */
  helpVisible?: boolean;
  /** The Skills drawer is not this person's (`skillsMenuVisible`): "Go to" leaves it out. Missing means shown. */
  skillsHidden?: boolean;
  /** The team skill levels are on for this person: "Go to" lists the Skill levels tab. Missing means no. */
  hasSkillLevels?: boolean;
  /** The ads summary (store `ads`), for tools that search it; null or missing until it has loaded. */
  ads?: AdsSummary | null;
  /** Projects R1: the projects list (`useProjects`), for the Projects group and "Client · Project" on hits. Missing until loaded. */
  projects?: ProjectCard[];
}

export interface SearchResults {
  hits: SearchHit[];
  /** How many matched in all (the heading shows "6 of N" when more than shown). */
  total: number;
  /** Async only: true while the server is still building some folders' lists ("Still looking…"). */
  partial?: boolean;
}

/**
 * One searchable thing: a built-in (Go to, To-dos, Open chats, Skills, Clients, Earlier chats) or an
 * app's `AppSlot.search`. Exactly one of `search` / `searchAsync` is given. Groups show in
 * `client/src/shell/search-sources.ts` order, async ones last so late results never move the highlight.
 */
export interface SearchSource {
  id: string;
  /** The group heading: "To-dos", "Documents". */
  title: string;
  /** Instant: runs on every keystroke. Ranked (decision 5); `query` is already trimmed and non-empty. */
  search?: (query: string, ctx: SearchContext) => SearchResults;
  /** Server-backed: debounced (~150 ms); aborted when the query changes; only for 2+ characters. */
  searchAsync?: (query: string, signal: AbortSignal) => Promise<SearchResults>;
  /** What shows with an empty query; omit for none. */
  idle?: (ctx: SearchContext) => SearchHit[];
}

/**
 * `client/src/state/search-match.ts`. Every word of `query`, in any order, case- and accent-insensitive.
 * Returns a rank (lower is better): 0 title starts with the query, 1 a title word starts with a query
 * word, 2 the title contains all words, 3 only other `fields` match; null for no match.
 */
export type MatchRank = (query: string, title: string, fields: string[]) => 0 | 1 | 2 | 3 | null;
