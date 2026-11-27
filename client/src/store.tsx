import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { AdsSummary } from '../../shared/ads-contract.ts';
import type {
  AppPrefs,
  AskedTodoList,
  Bootstrap,
  ChatKind,
  HomeItemId,
  HomeShortcut,
  LibraryItem,
  PastSession,
  SequencedEvent,
  SessionList,
  SkillInfo,
  StreamFrame,
  TodoAction,
  TodoItem,
  TodoList,
  TodoScope,
  TodoUploadRequest,
} from '../../shared/contract.ts';
import {
  FAVOURITE_CHATS_MAX,
  FAVOURITE_FILES_MAX,
  FAVOURITE_TODOS_MAX,
  HOME_SHORTCUTS_MAX,
  homeShortcutKey,
  STREAM_PING_EVENT,
  STREAM_STALL_MS,
} from '../../shared/contract.ts';
import { FILES_CHANGE_MESSAGES, filesDeletedNotice } from '../../shared/files-contract.ts';
import type { LevelTier, SkillLevels } from '../../shared/levels-contract.ts';
import type { PageAskRequest } from '../../shared/pages-contract.ts';
import type { ProjectKey } from '../../shared/projects-contract.ts';
import { type ChangeSubject, fitLooked, lookedMark, type TodoLooked } from '../../shared/todo-changes.ts';
import { ApiFailure, api, streamUrl } from './api.ts';
import { toolView } from './shell/sections.ts';
import type { ToolSnapshot } from './shell/sections-contract.ts';
import { type SettingsTab, settingsTabForFocus } from './shell/settings-tabs.ts';
import { UNDO_MS } from './shell/UndoLine.tsx';
import { type ChatAction, type ChatState, chatReducer, initialChatState } from './state/chat-reducer.ts';
import { needsCloseConfirm } from './state/close.ts';
import { useFavouriteList } from './state/favourite-list.ts';
import type { ListState } from './state/health.ts';
import { type KeptDraft, keptDraftKey, keptDrafts } from './state/kept-drafts.ts';
import { type PrefListField, prefStamp, usePrefList } from './state/pref-list.ts';
import { projectsStore } from './state/projects.ts';
import { chooseInitialChat, readSavedChat, saveChat } from './state/resume.ts';
import { isStalled } from './state/stall.ts';
import { teamTodoStore } from './state/team-todo.ts';
import { doneStore } from './state/todo-done.ts';
import { loadAdsSummary } from './tools/ad-manager/summary.ts';
import { taskRuns } from './tools/ad-manager/task-runs.ts';

export interface ChangeTodosResult {
  done: number;
  error?: { code: string; message: string };
  /**
   * The newest list the server returned (after a 'changed' error, a freshly loaded one), so the caller
   * can read the versions its own steps produced. Absent when nothing came back.
   */
  todos?: TodoList;
  /** Set when a `move` step went through: the to-do's key before and after (a name clash renames it). */
  moved?: { from: string; to: string };
}

/** What `uploadTodoFile` gives back: where the file went, or why it didn't. */
export type UploadTodoFileResult =
  | { ok: true; path: string; personal: boolean; todos: TodoList }
  | { ok: false; error: { code: string; message: string }; todos?: TodoList };

/**
 * A library file being deleted: held for UNDO_MS (Undo works), then sent. It leaves every list, the
 * starred files and Home from the moment it is held, and stays out until the delete fails or Undo is pressed.
 */
export interface HeldFile {
  id: string;
  /** The name the person saw on the file (an image's file name, a document's title). */
  title: string;
  /** 'waiting': Undo works. 'sending': its time is up and the request is queued or on its way. */
  phase: 'waiting' | 'sending';
}

/** The plain line for a failed library delete: the app's own words for the server's code. */
/** Views a chat drawer may stay open beside: a tool, and Projects (a chat saved beside its review form). */
export function drawerView(view: string): boolean {
  return view.startsWith('tool:') || view === 'app:projects';
}

function fileDeleteMessage(err: unknown): string {
  if (err instanceof ApiFailure && err.code in FILES_CHANGE_MESSAGES) {
    return FILES_CHANGE_MESSAGES[err.code as keyof typeof FILES_CHANGE_MESSAGES];
  }
  return err instanceof ApiFailure ? err.message : FILES_CHANGE_MESSAGES.internal;
}

/** How long a deleted file stays out of the lists after the server confirms (a refresh may still carry it). */
const FILE_GONE_MS = 60_000;

/** How long a held to-do change waits, with an Undo button, before it is sent: the one `UNDO_MS` (kept by this name for older callers). */
export const TODO_UNDO_MS = UNDO_MS;
/** After one library file delete, presses on another bin are ignored for this long (a double-click, a held Enter). */
export const FILE_DELETE_GUARD_MS = 600;

/**
 * An earlier chat being deleted: held for UNDO_MS (Undo works), then sent. It leaves the past list everywhere
 * (Chats, Home, search) from the moment it is held, and stays out until the delete fails or Undo is pressed.
 */
export interface HeldChatDelete {
  sdkSessionId: string;
  title: string;
  /** 'waiting': Undo works. 'sending': its time is up and the request is queued or on its way. */
  phase: 'waiting' | 'sending';
  /** The row as it was, so the Chats drawer can keep the Undo line in its place. */
  session: PastSession;
}

/** One held item: 'waiting' (Undo works) until its time is up, then 'queued' behind any item still being sent. */
interface HeldEntry<T> {
  item: T;
  timer: ReturnType<typeof setTimeout> | null;
  state: 'waiting' | 'queued';
}

export interface HeldQueue<T> {
  /** Starts the clock. `replace` swaps a waiting item for this one; false when nothing was held. */
  hold: (id: string, item: T, opts?: { replace?: boolean }) => boolean;
  /** Drops a waiting item before it is sent; false once it is queued (too late). */
  undo: (id: string) => boolean;
  /** Stops a waiting item's clock. */
  pause: (id: string) => void;
  /** Starts a paused item's clock again from the full UNDO_MS. */
  resume: (id: string) => void;
  has: (id: string) => boolean;
  /** Closing the page: sends everything not yet started, at once, with keepalive. */
  flush: () => void;
}

/**
 * The one held queue behind every Undo line (to-dos, files, earlier chats; plan 2026-11-22-ux-consistency,
 * decision 12 and R5). Nothing is sent until an item's time is up; then it joins a queue that sends one at a
 * time, so lists come back in the order the changes were made and a second failure never races the first.
 * An item leaves `entries` only when its request starts (or on Undo), so each item is sent exactly once:
 * by its turn in the queue or by `flush`, whichever comes first.
 */
export function createHeldQueue<T>(opts: {
  send: (item: T, sendOpts?: { keepalive: true }) => Promise<unknown>;
  /** The time ran out: the item is queued and Undo no longer works. */
  onQueued: (id: string, item: T) => void;
}): HeldQueue<T> {
  const entries = new Map<string, HeldEntry<T>>();
  let chain: Promise<unknown> = Promise.resolve();
  const arm = (id: string, entry: HeldEntry<T>) => {
    entry.timer = setTimeout(() => {
      entry.timer = null;
      entry.state = 'queued';
      opts.onQueued(id, entry.item);
      chain = chain
        .then(() => {
          // Closing the page may already have sent it.
          if (entries.get(id) !== entry) return;
          entries.delete(id);
          return opts.send(entry.item);
        })
        // A send that throws must not stop the items queued behind it.
        .catch(() => undefined);
    }, UNDO_MS);
  };
  return {
    hold(id, item, holdOpts) {
      const existing = entries.get(id);
      if (existing) {
        // Already on its way, or held and not to be replaced.
        if (!holdOpts?.replace || existing.state !== 'waiting') return false;
        if (existing.timer) clearTimeout(existing.timer);
      }
      const entry: HeldEntry<T> = { item, timer: null, state: 'waiting' };
      entries.set(id, entry);
      arm(id, entry);
      return true;
    },
    undo(id) {
      const entry = entries.get(id);
      if (entry?.state !== 'waiting') return false;
      if (entry.timer) clearTimeout(entry.timer);
      entries.delete(id);
      return true;
    },
    pause(id) {
      const entry = entries.get(id);
      if (entry?.state !== 'waiting' || !entry.timer) return;
      clearTimeout(entry.timer);
      entry.timer = null;
    },
    resume(id) {
      const entry = entries.get(id);
      if (entry?.state !== 'waiting' || entry.timer) return;
      arm(id, entry);
    },
    has: (id) => entries.has(id),
    flush() {
      for (const [id, entry] of entries) {
        if (entry.timer) clearTimeout(entry.timer);
        entries.delete(id);
        void opts.send(entry.item, { keepalive: true });
      }
    },
  };
}

/** A held queue for the provider's lifetime; it always calls the latest `send` and `onQueued`. */
function useHeldQueue<T>(
  send: (item: T, sendOpts?: { keepalive: true }) => Promise<unknown>,
  onQueued: (id: string, item: T) => void,
): HeldQueue<T> {
  const latest = useRef({ send, onQueued });
  latest.current = { send, onQueued };
  const [queue] = useState(() =>
    createHeldQueue<T>({
      send: (item, sendOpts) => latest.current.send(item, sendOpts),
      onQueued: (id, item) => latest.current.onQueued(id, item),
    }),
  );
  return queue;
}

/**
 * A to-do change waiting to be sent, so it can be undone. Nothing has been written to the brain yet:
 * Undo just drops it. Ticks, deletes and passing a to-do on are held; each is one request.
 */
export interface HeldTodo {
  /** The to-do's `key` (a bare id for TDS, `personal/<id>` for personal). Held changes are mapped by it. */
  todoId: string;
  title: string;
  kind: 'tick' | 'delete' | 'assignee';
  /** What the row says while held, e.g. "Marked as done", "Passed to Pete Tyler". */
  label: string;
  /** The change to send; null for a tick, which uses the tick route. */
  action: TodoAction | null;
  /**
   * For a tick: the file name and, for a personal to-do, the scope and version to send with it
   * (`api.completeTodo` with `{id, scope: 'personal', expect}`). Absent = the app's own tick of `todoId`.
   */
  tick?: { id: string; scope: TodoScope; expect: string };
  /** For a tick: an update written with it ("Add update and mark as done"). */
  note?: string;
  /** Set by the store once the undo time is up and the change is on its way: Undo no longer works. */
  sending?: boolean;
}

export type View = 'chat' | 'settings' | 'profile' | 'guide' | `app:${string}` | `tool:${string}/${string}`;
export type Gate = 'loading' | 'ready' | 'not-signed-in' | 'unreachable';

export interface NewChat {
  kind: 'new';
  /** Changes each time a new chat is opened, so the composer resets. */
  key: number;
  draft: string;
  skill: SkillInfo | null;
  /** The to-do this chat is about, when it was started from one. */
  todoId: string | null;
  /** A client this chat was opened with (palette, to-do): a slug, or null for no client. Absent = work it out. */
  client?: string | null;
  /** The project this chat was opened for (to-do, project page): a ProjectKey, or null. Absent = none. */
  project?: ProjectKey | null;
  /** Where this chat opened: 'drawer' is the unsent chat in the chat drawer beside a tool or Projects. Fixed when made. */
  in: ChatPlace;
  /**
   * Which row the message box shows: 'chat' (Project, this chat's own) when it was opened with a project or in the
   * drawer; 'app' (Home's own chat, Working on). Fixed when made, never worked out again.
   */
  scope: 'app' | 'chat';
  /** The Project and Chat for picks carried over by Open full screen, so "No project" doesn't turn back into a project. */
  picks?: { project: ProjectKey | ''; client: string };
  /**
   * Where "Save for later" keeps this chat's unsent message (`state/kept-drafts.ts`): its task, else its project.
   * Null when it has neither (no button would bring it back) or it never opened in the drawer.
   */
  keepKey: string | null;
  /** The kept message this chat opened with, when one was waiting: unchanged, it needn't be asked about again. */
  kept?: KeptDraft;
  /**
   * The text the opener itself put in the box (a task's chat, the checklist button), '' when none. Text that still
   * equals it isn't the person's writing, so it is neither asked about nor kept.
   */
  preset: string;
}
export interface LiveChat {
  kind: 'live';
  sessionId: string;
}
export type ActiveChat = NewChat | LiveChat;

type Chats = Record<string, ChatState>;
type ChatsAction =
  | { sessionId: string; item: SequencedEvent }
  | { sessionId: string; local: Extract<ChatAction, { type: 'level' | 'clear-offer' }> };

function chatsReducer(chats: Chats, action: ChatsAction): Chats {
  const current = chats[action.sessionId] ?? initialChatState;
  const next = chatReducer(current, 'local' in action ? action.local : { type: 'event', item: action.item });
  return next === current && action.sessionId in chats ? chats : { ...chats, [action.sessionId]: next };
}

/** Where a chat opens: the chat screen (the default) or the right-hand drawer over a tool. */
export type ChatPlace = 'sheet' | 'drawer';

/**
 * Asked before a page change a person makes (plan 2026-11-23-ux-follow-ups, decision 1): runs `go` now, or later, or
 * never, once any unsaved work has been asked about. The shell registers its `guardLeave` (`ShellProvider`).
 */
export type LeaveGuard = (go: () => void, opts?: { skipDrawer?: boolean }) => void;
/**
 * Asked before anything replaces an unsent chat in the drawer: runs `go` now, or after "Discard". `cancel` runs
 * when the person keeps writing (or the question goes away unanswered), so a waiting caller isn't left hanging.
 */
export type DrawerGuard = (go: () => void, cancel?: () => void) => void;

export interface Store {
  gate: Gate;
  boot: Bootstrap | null;
  todos: TodoList | null;
  sessions: SessionList | null;
  view: View;
  activeChat: ActiveChat;
  chats: Chats;
  /** False while the event stream is down and being retried. */
  streamUp: boolean;
  /** Whether the to-do and chat lists have loaded, for the Settings health panel. */
  lists: { todos: ListState; chats: ListState };
  /** A short plain message about the last action that failed, if any. */
  actionError: string | null;
  clearError: () => void;
  openView: (view: View) => void;
  newChat: (opts?: {
    draft?: string;
    skill?: SkillInfo | null;
    todoId?: string | null;
    client?: string | null;
    project?: ProjectKey | null;
    /** 'drawer': the unsent chat opens in the chat drawer and the view stays (only while `drawerView(view)`). */
    in?: ChatPlace;
    /** Picks to start the scope row on (Open full screen). */
    picks?: { project: ProjectKey | ''; client: string };
    /**
     * For an opener that puts its own text in the box (the checklist button): its own place for a message saved for
     * later, so it and the project's plain new chat don't bring back each other's.
     */
    slot?: string;
  }) => void;
  startSkill: (skill: SkillInfo) => void;
  /** Shows a live chat: on the chat screen, or with `in: 'drawer'` in the right-hand drawer over the tool on the sheet. */
  openChat: (sessionId: string, opts?: { in?: ChatPlace }) => void;
  /**
   * The chat shown in the right-hand drawer, or null: set only while that chat is the active one and a tool is on
   * the sheet (plan 2026-11-16-run-chat-drawer).
   */
  chatDrawer: string | null;
  /**
   * The key of the unsent chat shown in the drawer, or null: non-null only while `drawerView(view)` and the active
   * chat is a new one with `in: 'drawer'`. `chatDrawer` (a live session id) is unchanged.
   */
  newChatDrawer: number | null;
  /**
   * The key of the new chat whose first message is on its way, from Send until its session has started (or the
   * start failed); else null. That message has gone, so the drawer hold doesn't ask about that chat: Discard could
   * no longer stop it. Any other unsent chat still asks.
   */
  newChatStarting: number | null;
  /** Hide chat on an unsent drawer chat: a fresh sheet chat replaces it, nothing is sent. The caller has been through the drawer hold. */
  dropNewChatDrawer: () => void;
  /**
   * Open full screen on an unsent drawer chat: the same chat (to-do, skill, client, project) on Home with `draft` and
   * `picks`. The text moves, so the drawer hold does not ask.
   */
  expandNewChatDrawer: (draft: string, picks: { project: ProjectKey | ''; client: string }) => void;
  /** Hides the drawer; the chat keeps running and stays in Chats. */
  hideChatDrawer: () => void;
  /** Moves the drawer's chat to the chat screen. */
  expandChatDrawer: () => void;
  /** Reopens a past chat. Resolves true when it opened, false when it couldn't (the reason is in `actionError`). */
  openPast: (sdkSessionId: string, opts?: { in?: ChatPlace }) => Promise<boolean>;
  /** Opens a section's tool on the sheet and records it as the section's last tool. `arg` is read once via `toolArg`. */
  openTool: (sectionId: string, toolId: string, arg?: string) => void;
  toolArg: string | null;
  clearToolArg: () => void;
  /**
   * Starts a NEW chat with `prompt` for `client`, directly (as `openPast` does), never through `send`, which posts
   * into the active chat. `open: false` leaves the person where they are. Resolves to the session id, or null with
   * `actionError` set.
   */
  startChat: (
    prompt: string,
    client: string | null,
    /** `project`: the chat's project (phase 1), e.g. "File the notes" on a project's Meetings card. */
    opts: { open: boolean; in?: ChatPlace; project?: ProjectKey | null },
  ) => Promise<string | null>;
  /** The ads summary: loaded after boot and on `ads-changed`; null until then or when the server has none. */
  ads: AdsSummary | null;
  reloadAds: () => Promise<void>;
  /** Sends the first message of a new chat, or a follow-up in a live one. */
  send: (
    text: string,
    client: string | null,
    attachments?: string[],
    /** The project to send with a new chat (Home works it out); a to-do chat's own project is dropped with its link. */
    project?: ProjectKey | null,
  ) => Promise<boolean>;
  /** Asks Claude, in `sessionId`, to change a page or brand it. Returns null when sent, else the plain reason it wasn't. */
  askPage: (sessionId: string, key: string, req: PageAskRequest) => Promise<string | null>;
  updatePrefs: (patch: Partial<AppPrefs>) => Promise<void>;
  /** Team skill levels: from the server's bootstrap, then whatever the last change returned. null on an older server. */
  skillLevels: SkillLevels | null;
  /** Sets (or, with null, clears) a skill's team level. Returns false, with `actionError` set, when it failed. */
  setSkillLevel: (skill: string, tier: LevelTier | null) => Promise<boolean>;
  /** The person's tier for the rest of this chat; null goes back to automatic. */
  setChatLevel: (sessionId: string, tier: LevelTier | null) => Promise<void>;
  /** Hides the "Set a team level" offer for this chat. */
  dismissLevelOffer: (sessionId: string) => void;
  /** Marks these to-dos' handovers as seen ("New to you"): saves `prefs.todoSeen` with the full map. */
  markTodosSeen: (todos: TodoItem[]) => void;
  /**
   * The tasks this person asked for (waiting and done), loaded with the task list and again on every `todos` change.
   * The last list is kept while a reload runs or after a failure. null until the first load.
   */
  asked: AskedTodoList | null;
  askedState: 'loading' | 'loaded' | 'failed';
  /** Loads the Asked list again: one request at a time, one more queued behind it however often this is called. */
  reloadAsked: () => void;
  /**
   * The person has looked at these tasks: saves `prefs.todoLooked` (the whole map) with a marker for each whose
   * entries or finish differ from the saved one (shared/todo-changes.ts).
   */
  markTodosLooked: (subjects: ChangeSubject[]) => void;
  togglePin: (name: string) => Promise<void>;
  completeTodo: (id: string) => Promise<void>;
  /**
   * Sends to-do changes one at a time, in order, stopping at the first failure. `todos` becomes the last
   * list the server returned. `done` is how many went through; `error` carries the server's message.
   */
  changeTodos: (actions: TodoAction[]) => Promise<ChangeTodosResult>;
  /**
   * Files one staged upload into the library and links it to a to-do (release 3). `todos` becomes the
   * fresh list. After a 'changed' refusal the list is loaded again, so the caller can read the new version.
   */
  uploadTodoFile: (req: TodoUploadRequest) => Promise<UploadTodoFileResult>;
  /** To-do changes waiting out their undo time, oldest first. */
  heldTodos: HeldTodo[];
  /**
   * Ids of to-dos whose last held change was refused or failed (until the next hold of that to-do). The panel
   * keeps what the person typed for them, since `actionError` asks them to try again. Optional, so a screen's
   * test double need not carry it.
   */
  failedHeld?: readonly string[];
  /**
   * Holds a change for UNDO_MS, then sends it (a failure shows in `actionError`). Closing the page
   * sends every held change at once, so nothing is lost.
   */
  holdTodo: (held: HeldTodo) => void;
  /** Drops a held change before it is sent. Nothing reaches the brain. */
  undoHeld: (todoId: string) => void;
  /** Stops a held change's Undo clock while the pointer or focus is on its line. */
  pauseHeld: (todoId: string) => void;
  /** Starts a held change's Undo time again from the full length when the pointer and focus have left. */
  resumeHeld: (todoId: string) => void;
  /** Library files held for a delete or being sent, in the order they were deleted. */
  heldFiles: HeldFile[];
  /** Every id in `heldFiles`, plus files whose delete just went through: lists leave these out. */
  hiddenFileIds: ReadonlySet<string>;
  /** True while a delete is being sent, so every bin is disabled until it ends. */
  fileDeleteBusy: boolean;
  /**
   * Deletes a library file with an Undo: it leaves the lists, the starred files and Home at once and
   * nothing is sent for UNDO_MS. On success `notice` says so; on failure it comes back and `actionError`
   * says why. Closing the page sends it at once.
   */
  deleteFile: (item: Pick<LibraryItem, 'id' | 'title' | 'version'>, name?: string) => void;
  /** Brings a held file back before anything is sent. */
  undoDeleteFile: (id: string) => void;
  /** Stops the Undo clock while the pointer or focus is on the held line, so Undo can be reached. */
  pauseFileDelete: (id: string) => void;
  /** Starts the Undo time again from the full length when the pointer or focus leaves the held line. */
  resumeFileDelete: (id: string) => void;
  /** Counts up when the library's files change or the server restarts; the library screens refetch. */
  libraryVersion: number;
  retry: () => void;
  /** True while the full-screen brain folder page is open from Settings or the brain problem screen. */
  setupOpen: boolean;
  setSetupOpen: (open: boolean) => void;
  /** The chat whose inline "End this chat?" question is showing in the header, if any. */
  closeRequest: string | null;
  cancelClose: () => void;
  /** Closes at once when idle; otherwise switches to the chat and asks first. */
  requestClose: (id: string) => void;
  closeChat: (id: string) => Promise<boolean>;
  /** Earlier chats held for a delete or being sent, in the order they were deleted. */
  heldChats: HeldChatDelete[];
  /**
   * Deletes an earlier chat (to the Mac's Bin) with an Undo: it leaves the past list everywhere at once and
   * nothing is sent for UNDO_MS. On success `notice` and `chatNotice` say so; on failure it comes back,
   * `actionError` says why and `chatNotice` says it couldn't be deleted. Closing the page sends it at once.
   */
  holdDeletePastChat: (sdkSessionId: string, title: string) => void;
  /** Brings a held chat back before anything is sent. */
  undoDeletePastChat: (sdkSessionId: string) => void;
  /** Stops the Undo clock while the pointer or focus is on the held line. */
  pauseChatDelete: (sdkSessionId: string) => void;
  /** Starts the Undo time again from the full length when the pointer and focus have left the held line. */
  resumeChatDelete: (sdkSessionId: string) => void;
  /** The result of the last earlier-chat delete, for the Chats drawer's always-mounted status line. */
  chatNotice: string | null;
  /** Marks an open chat TDS or personal; the list updates at once, and a failure shows in `actionError`. */
  setChatKind: (id: string, kind: ChatKind) => Promise<void>;
  /**
   * Stars or unstars a chat by its `sdkSessionId`. The star moves at once; a failure puts the saved list back
   * and shows in `actionError`.
   */
  toggleFavouriteChat: (sdkSessionId: string) => Promise<void>;
  /**
   * Stars or unstars a to-do by its `TodoItem.key` (kept in prefs, never in the to-do file). The same rules as
   * `toggleFavouriteChat`. A to-do that moves (TDS ⇄ personal) keeps its star under its new key.
   */
  toggleFavouriteTodo: (key: string) => Promise<void>;
  /**
   * Stars or unstars a library file by its `LibraryItem.id` (kept in prefs, never in the brain). The same rules as
   * `toggleFavouriteChat`. Starred files are "Favourite files" on Home.
   */
  toggleFavouriteFile: (id: string) => Promise<void>;
  /**
   * The Home items this person hid (plan 2026-11-25-home-card-library). Always an array once booted; undefined means an
   * older server that keeps no Home layout, so "Customise Home" is hidden.
   */
  homeHidden: readonly string[] | undefined;
  /** The shortcut buttons this person added to Home, in order. Undefined on an older server, as `homeHidden`. */
  homeShortcuts: readonly HomeShortcut[] | undefined;
  /**
   * Shows or hides one Home item. Home changes at once and the save follows; the newest choice wins a quick double
   * toggle, and a failed save puts back the saved list and shows in `actionError`. The same for the three below.
   */
  setHomeItemShown: (id: HomeItemId, shown: boolean) => void;
  /** Adds a shortcut at the end. Ignored when one with the same `homeShortcutKey` is there, or at HOME_SHORTCUTS_MAX. */
  addHomeShortcut: (shortcut: HomeShortcut) => void;
  /** Removes the shortcut with this `homeShortcutKey`. */
  removeHomeShortcut: (key: string) => void;
  /** "Show everything again" (decision 14): no Home item hidden. Shortcuts and card order are left alone. */
  showAllHomeItems: () => void;
  /** A brief plain line shown after a chat is closed. */
  notice: string | null;
  /** The part of `notice` that says a library file was deleted: the always-mounted status line speaks it. */
  fileNotice: string | null;
  /** Counts up each time focus should return to the message box. */
  composerFocus: number;
  requestComposerFocus: () => void;
  /**
   * A to-do the global search asked the to-dos drawer to show, or null. One-shot, like `composerFocus`:
   * `revealTodo` sets it, the drawer takes it and calls `clearReveal`. `n` changes on every request, so
   * asking for the same to-do twice still counts.
   */
  reveal: { todo: TodoItem; n: number } | null;
  revealTodo: (todo: TodoItem) => void;
  clearReveal: () => void;
  /**
   * A finished to-do (`DoneTodo.key`, "done:...") the global search or a project page asked the to-dos
   * drawer to show: it opens on the Done tab with that to-do in the panel. One-shot like `reveal`. The caller
   * also opens the drawer (`open-drawer` 'todos'), as the palette does for `revealTodo`.
   */
  doneReveal: { key: string; n: number } | null;
  revealDoneTodo: (key: string) => void;
  clearDoneReveal: () => void;
  /**
   * True when the chat's "Change" button asked Settings to put the cursor on Model. One-shot, like
   * `reveal`: Settings takes it once it has rendered and calls `clearSettingsFocus`.
   */
  settingsFocus: string | null;
  /** Asks Settings to focus the control with this id (default Model), on the tab that holds it. */
  requestSettingsFocus: (id?: string) => void;
  clearSettingsFocus: () => void;
  /** The Settings tab shown (kept for the session; not saved). */
  settingsTab: SettingsTab;
  /** Opens Settings on a tab (default: the remembered one), optionally asking for a control to be focused. */
  openSettings: (tab?: SettingsTab, focusId?: string) => void;
  /** Runs a chat action (answer, stop) and reports a failure in plain words. */
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  /**
   * Registers the guard every page change a person makes passes through (`openView`, `openSettings`, `newChat`,
   * `openChat` on the sheet, `expandChatDrawer`, `requestClose` when it switches, `openTool`); null removes it. Without
   * one (outside the shell), page changes happen at once.
   */
  setLeaveGuard: (guard: LeaveGuard | null) => void;
  /**
   * Registers the drawer hold's guard (`ShellProvider`), asked before anything replaces an unsent drawer chat:
   * `openChat` / `openPast` with `in: 'drawer'` and a second `newChat({ in: 'drawer' })`. Without one, they happen at once.
   */
  setDrawerGuard: (guard: DrawerGuard | null) => void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore must be used inside StoreProvider');
  return s;
}

/** What a tool's `visible`, `badge` and `rowNote` read: one snapshot, so the rail, drawer and sheets agree. */
export function useToolSnapshot(): ToolSnapshot {
  const { ads } = useStore();
  return useMemo(() => ({ ads }), [ads]);
}

function messageOf(err: unknown): string {
  return err instanceof ApiFailure ? err.message : 'Something went wrong. Please try again.';
}

/** True when a send was refused because its chat has ended, not for some other reason. */
async function chatHasEnded(id: string, err: unknown): Promise<boolean> {
  if (!(err instanceof ApiFailure)) return false;
  if (err.code === 'session-closed') return true;
  // `not-found` also covers a file that has gone: the chat has ended only if the server no longer has it open.
  if (err.code !== 'not-found') return false;
  const list = await api.sessions().catch(() => null);
  return list !== null && !list.live.some((s) => s.id === id);
}

let newChatKey = 0;
function freshNewChat(
  draft = '',
  skill: SkillInfo | null = null,
  todoId: string | null = null,
  client?: string | null,
  project?: ProjectKey | null,
  place: ChatPlace = 'sheet',
  picks?: { project: ProjectKey | ''; client: string },
  scope?: 'app' | 'chat',
  keep: { key: string | null; kept?: KeptDraft | null; preset?: string } = { key: null },
): NewChat {
  newChatKey += 1;
  return {
    kind: 'new',
    key: newChatKey,
    draft,
    skill,
    todoId,
    ...(client === undefined ? {} : { client }),
    ...(project ? { project } : {}),
    in: place,
    scope: scope ?? (project || place === 'drawer' ? 'chat' : 'app'),
    ...(picks ? { picks } : {}),
    keepKey: keep.key,
    ...(keep.kept ? { kept: keep.kept } : {}),
    preset: keep.preset ?? '',
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>('loading');
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [todos, setTodos] = useState<TodoList | null>(null);
  const [sessions, setSessions] = useState<SessionList | null>(null);
  // A to-do list change (a tick, a hand-over, a sync) also refreshes the finished to-dos and any teammate's
  // to-do already read, whether or not the To-dos drawer is open, so search and the panel stay current.
  useEffect(() => {
    if (todos === null) return;
    if (doneStore.isStarted()) void doneStore.refresh();
    teamTodoStore.refreshLoaded();
  }, [todos]);
  const [view, setView] = useState<View>('chat');
  const [activeChat, setActiveChat] = useState<ActiveChat>(() => freshNewChat());
  const [chats, dispatchChat] = useReducer(chatsReducer, {} as Chats);
  const [streamUp, setStreamUp] = useState(true);
  const [levelsOverride, setLevelsOverride] = useState<SkillLevels | null>(null);
  const [todosState, setTodosState] = useState<ListState>('loading');
  const [chatsState, setChatsState] = useState<ListState>('loading');
  const [actionError, setActionError] = useState<string | null>(null);
  const [ads, setAds] = useState<AdsSummary | null>(null);
  const [toolArg, setToolArg] = useState<string | null>(null);
  const [composerFocus, setComposerFocus] = useState(0);
  const requestFocus = useCallback(() => setComposerFocus((n) => n + 1), []);
  const [settingsFocus, setSettingsFocus] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const requestSettingsFocus = useCallback((id = 'set-model') => {
    setSettingsTab(settingsTabForFocus(id));
    setSettingsFocus(id);
  }, []);
  const clearSettingsFocus = useCallback(() => setSettingsFocus(null), []);
  const [reveal, setReveal] = useState<{ todo: TodoItem; n: number } | null>(null);
  const revealCount = useRef(0);
  const revealTodo = useCallback((todo: TodoItem) => {
    revealCount.current += 1;
    setReveal({ todo, n: revealCount.current });
  }, []);
  const clearReveal = useCallback(() => setReveal(null), []);
  const [doneReveal, setDoneReveal] = useState<{ key: string; n: number } | null>(null);
  const doneRevealCount = useRef(0);
  const revealDoneTodo = useCallback((key: string) => {
    doneRevealCount.current += 1;
    setDoneReveal({ key, n: doneRevealCount.current });
  }, []);
  const clearDoneReveal = useCallback(() => setDoneReveal(null), []);
  const restored = useRef(false);
  const [closeRequest, setCloseRequest] = useState<string | null>(null);
  const [drawerChat, setDrawerChat] = useState<string | null>(null);
  const drawerRef = useRef(drawerChat);
  drawerRef.current = drawerChat;
  const [notice, setNotice] = useState<string | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chatNotice, setChatNotice] = useState<string | null>(null);
  // Earlier chats held for a delete (or just deleted): `openPast` leaves them alone. Set below, once known.
  const hiddenChatRef = useRef<ReadonlySet<string>>(new Set());
  /**
   * Shows a brief `notice` for `ms`. `part` names the always-mounted status line that speaks it instead (a file
   * delete's, an earlier chat delete's); the other parts are cleared, because the one shared timer that would
   * have cleared them is replaced here.
   */
  const showNotice = useCallback((text: string, ms: number, part?: 'file' | 'chat') => {
    setNotice(text);
    setFileNotice(part === 'file' ? text : null);
    setChatNotice(part === 'chat' ? text : null);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => {
      setNotice(null);
      setFileNotice(null);
      setChatNotice(null);
    }, ms);
  }, []);
  // Messages saved for later are kept per person: tell that store who is signed in.
  const person = boot?.identity.slug;
  useEffect(() => {
    if (person) keptDrafts.use(person);
  }, [person]);
  const activeRef = useRef(activeChat);
  activeRef.current = activeChat;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  // Task runs learn their Claude session id and whether they finished well from the chats (decision 9).
  useEffect(() => {
    if (sessions) taskRuns.reconcile(sessions.live);
  }, [sessions]);

  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  // What each chat needs to wake up (its Claude session id, client and to-do), kept after it leaves the open list.
  const wakeInfo = useRef(
    new Map<
      string,
      { sdk: string | null; client: string | null; todoId: string | null; project: ProjectKey | null }
    >(),
  );
  useEffect(() => {
    for (const s of sessions?.live ?? [])
      wakeInfo.current.set(s.id, {
        sdk: s.sdkSessionId,
        client: s.client,
        todoId: s.todoId,
        project: s.project ?? null,
      });
  }, [sessions]);
  const serverStartedAt = useRef<string | null>(null);

  const failGate = useCallback((err: unknown) => {
    if (err instanceof ApiFailure && err.notSignedIn) setGate('not-signed-in');
    else setGate((g) => (g === 'ready' ? g : 'unreachable'));
  }, []);

  // Each saved list (favourites, Home layout) is kept as shown when this bootstrap began before its newest save, so a
  // reload that crossed a save never undoes it (plan 2026-11-25-home-card-library, decision 7). The lists are made
  // below, so they are reached through a ref.
  const keepListsRef = useRef<(prefs: AppPrefs, begun: number) => AppPrefs>((prefs) => prefs);
  const loadBootstrap = useCallback(async () => {
    try {
      const begun = prefStamp();
      const b = await api.bootstrap();
      setBoot({ ...b, prefs: keepListsRef.current(b.prefs, begun) });
      setGate('ready');
    } catch (err) {
      failGate(err);
    }
  }, [failGate]);

  const loadTodos = useCallback(async () => {
    try {
      setTodos(await api.todos());
      setTodosState('loaded');
    } catch {
      // The to-do list is not essential; the next change will try again. Settings says so meanwhile.
      setTodosState('failed');
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const list = await api.sessions();
      setSessions(list);
      setChatsState('loaded');
      if (!restored.current) {
        // First load: go back to the chat this tab had open, if it is still open.
        restored.current = true;
        const id = chooseInitialChat(
          readSavedChat(),
          list.live.map((s) => s.id),
        );
        if (id)
          setActiveChat((cur) =>
            cur.kind === 'new' && !cur.draft && !cur.skill ? { kind: 'live', sessionId: id } : cur,
          );
        else saveChat(null);
      }
    } catch {
      // As above.
      setChatsState('failed');
    }
  }, []);

  const loadAll = useCallback(() => {
    void loadBootstrap();
    void loadTodos();
    void loadSessions();
  }, [loadBootstrap, loadTodos, loadSessions]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // The ads summary: once the app knows who this is, and again on `ads-changed`. A failed reload keeps what we had,
  // and a server with no ads routes leaves it null.
  const appSlug = boot?.identity.slug ?? null;
  const reloadAds = useCallback(async () => {
    if (!appSlug) return;
    try {
      setAds(await loadAdsSummary(appSlug));
    } catch {
      // Keep the last summary.
    }
  }, [appSlug]);
  const reloadAdsRef = useRef(reloadAds);
  reloadAdsRef.current = reloadAds;
  useEffect(() => {
    void reloadAds();
  }, [reloadAds]);

  // Remember the open chat for this tab, so a reload returns to it.
  useEffect(() => {
    if (!restored.current) return;
    saveChat(activeChat.kind === 'live' ? activeChat.sessionId : null);
  }, [activeChat]);

  // While the server cannot be reached (or the brain is still loading), keep trying quietly.
  useEffect(() => {
    if (gate !== 'unreachable') return;
    const t = setInterval(loadAll, 3000);
    return () => clearInterval(t);
  }, [gate, loadAll]);

  // One event stream per tab. It follows the open chat and picks up where it left off.
  const liveId = activeChat.kind === 'live' ? activeChat.sessionId : null;
  useEffect(() => {
    if (gate !== 'ready') return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let failures = 0;
    let dropped = false;
    let lastHeard = Date.now();
    let watchdog: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      const after = liveId ? (chatsRef.current[liveId]?.lastSeq ?? 0) : 0;
      const es = new EventSource(streamUrl(liveId, after));
      source = es;
      lastHeard = Date.now();
      es.addEventListener(STREAM_PING_EVENT, () => {
        lastHeard = Date.now();
      });
      es.onopen = () => {
        lastHeard = Date.now();
        setStreamUp(true);
        failures = 0;
        if (dropped) {
          // Events may have been missed while we were away.
          dropped = false;
          loadAll();
          setLibraryVersion((n) => n + 1);
        }
      };
      es.onmessage = (e) => {
        lastHeard = Date.now();
        let frame: StreamFrame;
        try {
          frame = JSON.parse(e.data) as StreamFrame;
        } catch {
          return;
        }
        if (frame.kind === 'chat') {
          dispatchChat({ sessionId: frame.sessionId, item: frame.item });
          return;
        }
        const ev = frame.event;
        if (ev.type === 'hello') {
          if (serverStartedAt.current && serverStartedAt.current !== ev.serverStartedAt) {
            loadAll();
            setLibraryVersion((n) => n + 1);
          }
          serverStartedAt.current = ev.serverStartedAt;
        } else if (ev.type === 'brain-changed') {
          if (ev.area === 'todos') void loadTodos();
          else if (ev.area === 'library') setLibraryVersion((n) => n + 1);
          else void loadBootstrap();
        } else if (ev.type === 'sessions-changed') {
          void loadSessions();
        } else if (ev.type === 'ads-changed') {
          void reloadAdsRef.current();
        }
      };
      const fail = () => {
        // Close and reconnect ourselves, so the new request asks only for what is still missing.
        es.close();
        setStreamUp(false);
        dropped = true;
        failures += 1;
        if (failures >= 2) {
          // Still failing: find out whether the sign-in is the problem.
          api.bootstrap().catch((err) => {
            if (err instanceof ApiFailure && err.notSignedIn) setGate('not-signed-in');
          });
        }
        if (!stopped && !retry) {
          retry = setTimeout(() => {
            retry = null;
            connect();
          }, 2000);
        }
      };
      es.onerror = fail;
      // Silence with no error counts as a drop too.
      if (watchdog) clearInterval(watchdog);
      watchdog = setInterval(() => {
        if (es.readyState !== EventSource.CLOSED && isStalled(lastHeard, Date.now(), STREAM_STALL_MS)) fail();
      }, 5000);
    };
    connect();
    return () => {
      stopped = true;
      if (watchdog) clearInterval(watchdog);
      source?.close();
      if (retry) clearTimeout(retry);
    };
  }, [gate, liveId, loadAll, loadBootstrap, loadTodos, loadSessions]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
      setActionError(null);
      return true;
    } catch (err) {
      setActionError(messageOf(err));
      return false;
    }
  }, []);

  // The leave guard (plan 2026-11-23-ux-follow-ups, decision 1). Every page change a person makes goes through
  // `leave`, so typed work in a form that the change would unmount is asked about first. Boot and restore never set
  // the view, so they don't pass here. The shell registers the guard; `viewRef` is read so a click on the page
  // already shown runs at once (nothing unmounts).
  const leaveGuard = useRef<LeaveGuard | null>(null);
  const setLeaveGuard = useCallback((guard: LeaveGuard | null) => {
    leaveGuard.current = guard;
  }, []);
  const viewRef = useRef(view);
  viewRef.current = view;
  /** Runs `go`, a change to page `next`, through the leave guard. `refills`: it changes the page even when `next` is the page shown. */
  const leave = useCallback(
    (next: View, go: () => void, refills = false, opts?: { skipDrawer?: boolean }) => {
      const guard = leaveGuard.current;
      if (!guard || (next === viewRef.current && !refills)) go();
      else guard(go, opts);
    },
    [],
  );
  // The drawer hold's guard, registered the same way: asked before an unsent drawer chat is replaced.
  const drawerGuard = useRef<DrawerGuard | null>(null);
  const setDrawerGuard = useCallback((guard: DrawerGuard | null) => {
    drawerGuard.current = guard;
  }, []);

  const openView = useCallback((v: View) => leave(v, () => setView(v)), [leave]);
  const openSettings = useCallback(
    (tab?: SettingsTab, focusId?: string) =>
      leave('settings', () => {
        if (tab) setSettingsTab(tab);
        if (focusId) setSettingsFocus(focusId);
        setView('settings');
      }),
    [leave],
  );

  const newChat = useCallback(
    (opts?: {
      draft?: string;
      skill?: SkillInfo | null;
      todoId?: string | null;
      client?: string | null;
      project?: ProjectKey | null;
      in?: ChatPlace;
      picks?: { project: ProjectKey | ''; client: string };
      slot?: string;
    }) => {
      // In the drawer only beside a tool or Projects; anywhere else it is Home's chat, as ever.
      const inDrawer = opts?.in === 'drawer' && drawerView(viewRef.current);
      const make = () => {
        // A message saved for later from this same button comes back: its words and picks, not the opener's.
        const keepKey = inDrawer
          ? keptDraftKey({
              todoId: opts?.todoId ?? null,
              project: opts?.project,
              ...(opts?.slot ? { slot: opts.slot } : {}),
            })
          : null;
        const kept = keptDrafts.get(keepKey);
        return freshNewChat(
          kept?.text ?? opts?.draft ?? '',
          opts?.skill ?? null,
          opts?.todoId ?? null,
          opts?.client,
          opts?.project,
          inDrawer ? 'drawer' : 'sheet',
          kept?.picks ?? opts?.picks,
          undefined,
          { key: keepKey, kept, preset: inDrawer ? (opts?.draft ?? '') : '' },
        );
      };
      if (inDrawer) {
        // The view stays; a second unsent chat asks before it takes the drawer. A live drawer chat keeps running.
        const open = () => {
          setActiveChat(make());
          setActionError(null);
          requestFocus();
        };
        const cur = activeRef.current;
        if (cur.kind === 'new' && cur.in === 'drawer' && drawerGuard.current) drawerGuard.current(open);
        else open();
        return;
      }
      leave('chat', () => {
        setActiveChat(make());
        setView('chat');
        setActionError(null);
      });
    },
    [leave, requestFocus],
  );

  const closeChat = useCallback(
    async (id: string) => {
      try {
        await api.close(id);
      } catch (err) {
        // A chat that went to sleep before the app restarted is unknown to the server now: it is closed already.
        const gone = err instanceof ApiFailure && (err.code === 'not-found' || err.code === 'session-closed');
        if (!gone) {
          setActionError(messageOf(err));
          return false;
        }
      }
      setActionError(null);
      setCloseRequest(null);
      setSessions((s) => (s ? { ...s, live: s.live.filter((c) => c.id !== id) } : s));
      void loadSessions();
      const cur = activeRef.current;
      if (cur.kind === 'live' && cur.sessionId === id) {
        setActiveChat(freshNewChat());
        // From the drawer (/clear) there is no Home box to focus: the drawer hands focus back as it goes.
        if (drawerRef.current !== id) requestFocus();
      }
      showNotice("Chat closed. It's under Earlier in Chats if you want it back.", 6000);
      return true;
    },
    [loadSessions, requestFocus, showNotice],
  );

  // Favourites (chats, to-dos, files) and the Home layout: one save engine per list, in `state/pref-list.ts`.
  const showFavourites = useCallback((field: PrefListField, list: readonly unknown[]) => {
    setBoot((b) => (b ? { ...b, prefs: { ...b.prefs, [field]: list } } : b));
  }, []);
  const favouriteError = useCallback((err: unknown) => setActionError(messageOf(err)), []);
  const chatFavourites = useFavouriteList({
    field: 'favouriteChats',
    max: FAVOURITE_CHATS_MAX,
    current: boot?.prefs.favouriteChats,
    save: api.updatePrefs,
    show: showFavourites,
    onError: favouriteError,
  });
  const todoFavourites = useFavouriteList({
    field: 'favouriteTodos',
    max: FAVOURITE_TODOS_MAX,
    current: boot?.prefs.favouriteTodos,
    save: api.updatePrefs,
    show: showFavourites,
    onError: favouriteError,
  });
  const fileFavourites = useFavouriteList({
    field: 'favouriteFiles',
    max: FAVOURITE_FILES_MAX,
    current: boot?.prefs.favouriteFiles,
    save: api.updatePrefs,
    show: showFavourites,
    onError: favouriteError,
  });
  const hiddenList = usePrefList({
    field: 'homeHidden',
    current: boot?.prefs.homeHidden,
    save: api.updatePrefs,
    show: showFavourites,
    onError: favouriteError,
  });
  const shortcutList = usePrefList({
    field: 'homeShortcuts',
    current: boot?.prefs.homeShortcuts,
    save: api.updatePrefs,
    show: showFavourites,
    onError: favouriteError,
  });
  const keepChatStars = chatFavourites.keep;
  const keepTodoStars = todoFavourites.keep;
  const keepFileStars = fileFavourites.keep;
  const keepHidden = hiddenList.keep;
  const keepShortcuts = shortcutList.keep;
  // The task markers ("New to you" and "changed since you looked"): the latest maps, kept here so quick successive
  // marks each carry the earlier ones, and how many saves of each are still waiting for their reply.
  const seenRef = useRef<Record<string, string>>({});
  const seenSaving = useRef(0);
  const lookedRef = useRef<TodoLooked>({});
  const lookedSaving = useRef(0);
  /**
   * A prefs reply for another setting, with each saved list (the stars and the Home layout) and each task marker
   * map kept as shown while one of its saves is waiting. Without this, the reply to a "seen" save, which carries
   * the prefs file as it stood before a "looked" save sent just after it, put the old map back and the next mark
   * saved over the lost one (review R2).
   */
  const keepStars = useCallback(
    (prefs: AppPrefs): AppPrefs => {
      const kept = keepShortcuts(keepHidden(keepFileStars(keepTodoStars(keepChatStars(prefs)))));
      if (seenSaving.current === 0 && lookedSaving.current === 0) return kept;
      return {
        ...kept,
        ...(seenSaving.current > 0 ? { todoSeen: seenRef.current } : {}),
        ...(lookedSaving.current > 0 ? { todoLooked: lookedRef.current } : {}),
      };
    },
    [keepChatStars, keepTodoStars, keepFileStars, keepHidden, keepShortcuts],
  );
  const bootLists = [chatFavourites, todoFavourites, fileFavourites, hiddenList, shortcutList];
  keepListsRef.current = (prefs, begun) => bootLists.reduce((p, list) => list.keepBoot(p, begun), prefs);

  const setHiddenList = hiddenList.set;
  const setShortcutList = shortcutList.set;
  const setHomeItemShown = useCallback(
    (id: HomeItemId, shown: boolean) => {
      void setHiddenList((hidden) => {
        if (hidden.includes(id) !== shown) return null;
        return shown ? hidden.filter((h) => h !== id) : [...hidden, id];
      });
    },
    [setHiddenList],
  );
  const showAllHomeItems = useCallback(() => {
    void setHiddenList((hidden) => (hidden.length === 0 ? null : []));
  }, [setHiddenList]);
  const addHomeShortcut = useCallback(
    (shortcut: HomeShortcut) => {
      const key = homeShortcutKey(shortcut);
      void setShortcutList((list) =>
        list.length >= HOME_SHORTCUTS_MAX || list.some((s) => homeShortcutKey(s) === key)
          ? null
          : [...list, shortcut],
      );
    },
    [setShortcutList],
  );
  const removeHomeShortcut = useCallback(
    (key: string) => {
      void setShortcutList((list) =>
        list.some((s) => homeShortcutKey(s) === key) ? list.filter((s) => homeShortcutKey(s) !== key) : null,
      );
    },
    [setShortcutList],
  );
  const toggleFavouriteChat = chatFavourites.toggle;
  const toggleFavouriteTodo = todoFavourites.toggle;
  const toggleFavouriteFile = fileFavourites.toggle;
  const renameFavouriteTodo = todoFavourites.rename;

  const setChatKind = useCallback(
    async (id: string, kind: ChatKind) => {
      // The switch moves at once (a radio group checks what it moves to); a failure reloads the truth.
      setSessions((s) => (s ? { ...s, live: s.live.map((c) => (c.id === id ? { ...c, kind } : c)) } : s));
      try {
        const { session } = await api.setChatKind(id, kind);
        setActionError(null);
        setSessions((s) => (s ? { ...s, live: s.live.map((c) => (c.id === id ? session : c)) } : s));
      } catch (err) {
        setActionError(messageOf(err));
        void loadSessions();
      }
    },
    [loadSessions],
  );

  const requestClose = useCallback(
    (id: string) => {
      const cur = activeRef.current;
      const mine = cur.kind === 'live' && cur.sessionId === id ? chatsRef.current[id] : undefined;
      const state =
        mine && mine.stateSince !== null
          ? mine.sessionState
          : sessionsRef.current?.live.find((c) => c.id === id)?.state;
      if (state && needsCloseConfirm(state)) {
        leave('chat', () => {
          setActiveChat({ kind: 'live', sessionId: id });
          setView('chat');
          setCloseRequest(id);
        });
      } else {
        void closeChat(id);
      }
    },
    [closeChat, leave],
  );

  const startSkill = useCallback(
    (skill: SkillInfo) => {
      newChat({ draft: '', skill });
    },
    [newChat],
  );

  const openChat = useCallback(
    (sessionId: string, opts?: { in?: ChatPlace }) => {
      if (opts?.in === 'drawer') {
        // The tool stays on the sheet (no page change); the drawer's message box takes focus. An unsent drawer chat
        // is replaced only after the drawer hold has asked.
        const open = () => {
          setActiveChat({ kind: 'live', sessionId });
          setActionError(null);
          setCloseRequest(null);
          setDrawerChat(sessionId);
          requestFocus();
        };
        const cur = activeRef.current;
        if (cur.kind === 'new' && cur.in === 'drawer' && drawerGuard.current) drawerGuard.current(open);
        else open();
        return;
      }
      leave('chat', () => {
        setActiveChat({ kind: 'live', sessionId });
        setActionError(null);
        setCloseRequest(null);
        setDrawerChat(null);
        setView('chat');
      });
    },
    [requestFocus, leave],
  );
  const hideChatDrawer = useCallback(() => setDrawerChat(null), []);
  const expandChatDrawer = useCallback(
    () =>
      leave('chat', () => {
        setDrawerChat(null);
        setView('chat');
      }),
    [leave],
  );
  // The drawer goes with its chat and with the tool (or Projects, where a chat is saved beside its review form,
  // plan 2026-11-24-chat-summary-updates decision 8): any other active chat or any other view clears it.
  useEffect(() => {
    if (drawerChat === null) return;
    if (!drawerView(view) || activeChat.kind !== 'live' || activeChat.sessionId !== drawerChat)
      setDrawerChat(null);
  }, [drawerChat, view, activeChat]);
  // An unsent chat in the drawer goes with the view it opened on: on any other view (a tool included, though the
  // drawer may sit beside one) it is a fresh sheet chat. The leave guard has already asked about its text. Before
  // paint, so Home never shows it.
  const unsentView = useRef<View | null>(null);
  useLayoutEffect(() => {
    if (activeChat.kind !== 'new' || activeChat.in !== 'drawer') {
      unsentView.current = null;
      return;
    }
    if (unsentView.current === null) unsentView.current = view;
    if (unsentView.current !== view || !drawerView(view)) {
      unsentView.current = null;
      setActiveChat(freshNewChat());
    }
  }, [activeChat, view]);
  const newChatDrawer =
    activeChat.kind === 'new' && activeChat.in === 'drawer' && drawerView(view) ? activeChat.key : null;
  const dropNewChatDrawer = useCallback(
    () => setActiveChat((cur) => (cur.kind === 'new' && cur.in === 'drawer' ? freshNewChat() : cur)),
    [],
  );
  const expandNewChatDrawer = useCallback(
    (draft: string, picks: { project: ProjectKey | ''; client: string }) => {
      const cur = activeRef.current;
      if (cur.kind !== 'new' || cur.in !== 'drawer') return;
      leave(
        'chat',
        () => {
          setActiveChat(
            // The kept message (if any) stays where it is until this one is sent: Home's box doesn't ask.
            freshNewChat(draft, cur.skill, cur.todoId, cur.client, cur.project, 'sheet', picks, 'chat', {
              key: cur.keepKey,
            }),
          );
          setView('chat');
          setActionError(null);
        },
        false,
        { skipDrawer: true },
      );
    },
    [leave],
  );
  const chatDrawer =
    drawerChat !== null &&
    drawerView(view) &&
    activeChat.kind === 'live' &&
    activeChat.sessionId === drawerChat
      ? drawerChat
      : null;

  /**
   * Before a chat is STARTED for the drawer: asks the drawer hold about an unsent chat's text first, so "Keep
   * writing" starts nothing. True to carry on. (`openChat` asks again; by then the hold is clean.)
   */
  const clearUnsentDrawer = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        const cur = activeRef.current;
        const guard = drawerGuard.current;
        if (cur.kind !== 'new' || cur.in !== 'drawer' || !guard) resolve(true);
        else
          guard(
            () => resolve(true),
            () => resolve(false),
          );
      }),
    [],
  );

  const openPast = useCallback(
    async (sdkSessionId: string, opts?: { in?: ChatPlace }): Promise<boolean> => {
      // A chat being deleted is out of every list; a stale press (or search result) must not bring it back.
      if (hiddenChatRef.current.has(sdkSessionId)) return false;
      // Kept writing: nothing is reopened, and that is not a failure.
      if (opts?.in === 'drawer' && !(await clearUnsentDrawer())) return true;
      try {
        const { session } = await api.startSession({ resume: sdkSessionId });
        void loadSessions();
        openChat(session.id, opts);
        return true;
      } catch (err) {
        if (err instanceof ApiFailure && err.code === 'already-open') {
          const list = await api.sessions().catch(() => null);
          const live = list?.live.find((s) => s.sdkSessionId === sdkSessionId);
          if (live) {
            setSessions(list);
            openChat(live.id, opts);
            return true;
          }
        }
        setActionError(messageOf(err));
        return false;
      }
    },
    [loadSessions, openChat, clearUnsentDrawer],
  );

  const startChat = useCallback(
    async (
      prompt: string,
      client: string | null,
      opts: { open: boolean; in?: ChatPlace; project?: ProjectKey | null },
    ) => {
      // Kept writing: no chat is started (null, with no error to show).
      if (opts.open && opts.in === 'drawer' && !(await clearUnsentDrawer())) return null;
      try {
        const { session } = await api.startSession({
          prompt,
          client,
          ...(opts.project ? { project: opts.project } : {}),
        });
        void loadSessions();
        if (opts.open) openChat(session.id, { in: opts.in ?? 'sheet' });
        return session.id;
      } catch (err) {
        setActionError(messageOf(err));
        return null;
      }
    },
    [loadSessions, openChat, clearUnsentDrawer],
  );

  /**
   * Sends into a chat that has ended (idle for 30 minutes, or the app restarted) by reopening it from its history
   * with the message, in the same place on screen, so the person never has to paste it again. When another tab has
   * reopened it already, the message goes to that one. False when there is nothing to reopen it from.
   */
  const wakeAndSend = useCallback(
    async (endedId: string, body: string, attachments: string[]): Promise<boolean> => {
      const info = wakeInfo.current.get(endedId);
      const sdk = chatsRef.current[endedId]?.sdkSessionId ?? info?.sdk ?? null;
      // A chat being deleted must not come back.
      if (!sdk || hiddenChatRef.current.has(sdk)) return false;
      let id: string;
      try {
        // Its client and to-do go with it, so Claude still knows who the chat is for.
        const { session } = await api.startSession({
          resume: sdk,
          prompt: body,
          ...(info?.client ? { client: info.client } : {}),
          ...(info?.todoId ? { todoId: info.todoId } : {}),
          ...(info?.project ? { project: info.project } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        });
        id = session.id;
      } catch (err) {
        if (!(err instanceof ApiFailure && err.code === 'already-open')) throw err;
        const open = (await api.sessions()).live.find((s) => s.sdkSessionId === sdk);
        if (!open) throw err;
        await api.sendMessage(open.id, body, attachments);
        id = open.id;
      }
      void loadSessions();
      // Only if the person is still on the ended chat: never pull them back from somewhere else.
      setActiveChat((cur) =>
        cur.kind === 'live' && cur.sessionId === endedId ? { kind: 'live', sessionId: id } : cur,
      );
      setDrawerChat((d) => (d === endedId ? id : d));
      return true;
    },
    [loadSessions],
  );

  const [newChatStarting, setNewChatStarting] = useState<number | null>(null);
  const send = useCallback(
    async (text: string, client: string | null, attachments: string[] = [], project?: ProjectKey | null) => {
      const body = text.trim();
      // A message may be files only.
      if (!body && attachments.length === 0) return false;
      const files = attachments.length > 0 ? { attachments } : {};
      try {
        if (activeChat.kind === 'new') {
          // Keep the to-do link only while the message still mentions it.
          const link = activeChat.todoId;
          const known = link
            ? [...(todos?.mine ?? []), ...(todos?.open ?? [])].find((t) => t.key === link)
            : null;
          // The draft names the to-do by its path (`todo/<id>` or `personal/todo/<id>`).
          const path = known
            ? known.path
            : link?.startsWith('personal/')
              ? `personal/todo/${link.slice('personal/'.length)}`
              : `todo/${link}`;
          const todoId = link && body.includes(path) ? link : null;
          // The to-do's project goes with its link: a message that no longer names the to-do isn't about it.
          // Only for Home's own chat (scope 'app'): a chat that was opened for a project sends what its row shows.
          const sendProject =
            activeChat.scope === 'app' && link && !todoId && project === activeChat.project ? null : project;
          const key = activeChat.key;
          setNewChatStarting(key);
          const { session } = await api
            .startSession({
              prompt: body,
              client,
              ...(sendProject ? { project: sendProject } : {}),
              ...(todoId ? { todoId } : {}),
              ...files,
            })
            .finally(() => setNewChatStarting((k) => (k === key ? null : k)));
          if (client && boot && boot.prefs.lastClient !== client) {
            void api
              .updatePrefs({ lastClient: client })
              .then((prefs) => setBoot((b) => (b ? { ...b, prefs: keepStars(prefs) } : b)))
              .catch(() => {});
          }
          void loadSessions();
          // Sent, so a message saved for later from this chat's button has been used.
          keptDrafts.drop(activeChat.keepKey);
          // The chat has begun and is in Chats. It takes the screen unless the person has moved on in a way it must
          // not undo: a drawer chat they have since hidden or left never pulls them back or opens over where they
          // went, and no start ever replaces a different unsent chat in the drawer (its text would go unasked).
          const cur = activeRef.current;
          const same = cur.kind === 'new' && cur.key === key;
          const gone = !same && (activeChat.in === 'drawer' || (cur.kind === 'new' && cur.in === 'drawer'));
          if (!gone) {
            // From the drawer the new session takes the drawer in the same update, so it never closes and reopens.
            if (activeChat.in === 'drawer' && drawerView(viewRef.current)) setDrawerChat(session.id);
            setActiveChat({ kind: 'live', sessionId: session.id });
          }
        } else {
          const id = activeChat.sessionId;
          const woken =
            chatsRef.current[id]?.sessionState === 'closed' && (await wakeAndSend(id, body, attachments));
          if (!woken) {
            try {
              await api.sendMessage(id, body, attachments);
            } catch (err) {
              // The page may not know yet that the chat has ended (the app restarted, or the stream was away).
              if (!(await chatHasEnded(id, err)) || !(await wakeAndSend(id, body, attachments))) throw err;
            }
          }
        }
        setActionError(null);
        return true;
      } catch (err) {
        setActionError(messageOf(err));
        // A refused to-do has probably gone: refresh the list.
        if (err instanceof ApiFailure && err.code === 'bad-request') void loadTodos();
        return false;
      }
    },
    [activeChat, boot, todos, loadSessions, loadTodos, keepStars, wakeAndSend],
  );

  const askPage = useCallback(async (sessionId: string, key: string, req: PageAskRequest) => {
    try {
      await api.askPage(sessionId, key, req);
      return null;
    } catch (err) {
      return messageOf(err);
    }
  }, []);

  const updatePrefs = useCallback(
    async (patch: Partial<AppPrefs>) => {
      try {
        const prefs = keepStars(await api.updatePrefs(patch));
        setBoot((b) => (b ? { ...b, prefs } : b));
        // The server works out whether to-dos can be changed from this switch, so ask again.
        if ('directWrites' in patch) await loadTodos();
      } catch (err) {
        setActionError(messageOf(err));
      }
    },
    [loadTodos, keepStars],
  );

  // Opening a tool remembers it for its section. A failed save is quiet: it only costs the memory.
  const openTool = useCallback(
    (sectionId: string, toolId: string, arg?: string) => {
      const next = toolView(sectionId, toolId);
      // An `arg` (an account) fills the tool afresh even when it is the one shown.
      leave(
        next,
        () => {
          setToolArg(arg ?? null);
          setView(next);
          const last = boot?.prefs.lastTool ?? {};
          if (last[sectionId] === toolId) return;
          void api
            .updatePrefs({ lastTool: { ...last, [sectionId]: toolId } })
            .then((prefs) => setBoot((b) => (b ? { ...b, prefs: keepStars(prefs) } : b)))
            .catch(() => {});
        },
        arg !== undefined,
      );
    },
    [boot, keepStars, leave],
  );
  const clearToolArg = useCallback(() => setToolArg(null), []);

  const setSkillLevel = useCallback(async (skill: string, tier: LevelTier | null) => {
    try {
      setLevelsOverride(await api.setSkillLevel({ skill, tier }));
      return true;
    } catch (err) {
      setActionError(messageOf(err));
      return false;
    }
  }, []);

  const setChatLevel = useCallback(async (sessionId: string, tier: LevelTier | null) => {
    try {
      const res = await api.setChatLevel(sessionId, tier);
      // Only a real TurnLevel reaches the reducer; the server's own `level` event follows anyway.
      const level = res && typeof res === 'object' ? res.level : undefined;
      if (level && typeof level === 'object' && level.source && typeof level.source === 'object') {
        dispatchChat({ sessionId, local: { type: 'level', level } });
      }
    } catch (err) {
      setActionError(messageOf(err));
    }
  }, []);

  const dismissLevelOffer = useCallback((sessionId: string) => {
    dispatchChat({ sessionId, local: { type: 'clear-offer' } });
  }, []);

  const togglePin = useCallback(
    async (name: string) => {
      if (!boot) return;
      const pins = boot.prefs.pins.includes(name)
        ? boot.prefs.pins.filter((p) => p !== name)
        : [...boot.prefs.pins, name];
      await updatePrefs({ pins });
    },
    [boot, updatePrefs],
  );

  useEffect(() => {
    seenRef.current = boot?.prefs.todoSeen ?? {};
  }, [boot?.prefs.todoSeen]);
  const markTodosSeen = useCallback(
    (items: TodoItem[]) => {
      const next = { ...seenRef.current };
      let changed = false;
      for (const t of items) {
        const at = t.handover?.at;
        if (at && next[t.key] !== at) {
          next[t.key] = at;
          changed = true;
        }
      }
      if (!changed) return;
      seenRef.current = next;
      // Optimistic, so the dot goes at once; the server's reply (pruned, capped) replaces it.
      setBoot((b) => (b ? { ...b, prefs: { ...b.prefs, todoSeen: next } } : b));
      seenSaving.current += 1;
      api
        .updatePrefs({ todoSeen: next })
        .then((prefs) => {
          seenSaving.current -= 1;
          // A newer mark still waiting keeps its own map (keepStars); otherwise the server's replaces it.
          setBoot((b) => (b ? { ...b, prefs: keepStars(prefs) } : b));
        })
        .catch(() => {
          seenSaving.current -= 1;
          // Not saved: it shows as new again next time. Nothing to tell the person.
        });
    },
    [keepStars],
  );

  useEffect(() => {
    lookedRef.current = boot?.prefs.todoLooked ?? {};
  }, [boot?.prefs.todoLooked]);
  const meSlug = boot?.identity.slug;
  const meName = boot?.identity.name;
  const markTodosLooked = useCallback(
    (subjects: ChangeSubject[]) => {
      if (meSlug === undefined || meName === undefined) return;
      const me = { slug: meSlug, name: meName };
      const now = new Date();
      let next = lookedRef.current;
      let changed = false;
      for (const subject of subjects) {
        // Only TDS tasks have markers: nobody else can change a personal one.
        if (subject.kind === 'held' && subject.todo.scope !== 'tds') continue;
        const mark = lookedMark(subject, me, now);
        const old = next[subject.todo.id];
        if (
          old &&
          old.done === mark.done &&
          old.keys.length === mark.keys.length &&
          old.keys.every((k, i) => k === mark.keys[i])
        )
          continue;
        if (!changed) next = { ...next };
        next[subject.todo.id] = mark;
        changed = true;
      }
      if (!changed) return;
      next = fitLooked(next);
      lookedRef.current = next;
      const saved = next;
      // Optimistic, so the badge drops at once; the server's reply (pruned, capped) replaces it.
      setBoot((b) => (b ? { ...b, prefs: { ...b.prefs, todoLooked: saved } } : b));
      lookedSaving.current += 1;
      api
        .updatePrefs({ todoLooked: saved })
        .then((prefs) => {
          lookedSaving.current -= 1;
          setBoot((b) => (b ? { ...b, prefs: keepStars(prefs) } : b));
        })
        .catch(() => {
          lookedSaving.current -= 1;
          // Not saved: the changes show as new again next time. Nothing to tell the person.
        });
    },
    [meSlug, meName, keepStars],
  );

  // The Asked list (asked-of-others): its own request, never blocking or failing the task list.
  const [asked, setAsked] = useState<AskedTodoList | null>(null);
  const [askedState, setAskedState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const askedHave = useRef(false);
  const askedBusy = useRef(false);
  const askedQueued = useRef(false);
  const askedAlive = useRef(true);
  useEffect(() => {
    askedAlive.current = true;
    return () => {
      askedAlive.current = false;
    };
  }, []);
  const reloadAsked = useCallback(() => {
    if (askedBusy.current) {
      askedQueued.current = true;
      return;
    }
    askedBusy.current = true;
    void (async () => {
      do {
        askedQueued.current = false;
        // Only the very first load shows as loading: a reload keeps the list and its state as they were.
        if (!askedHave.current && askedAlive.current) setAskedState('loading');
        try {
          const list = await api.askedTodos();
          if (askedAlive.current) {
            askedHave.current = true;
            setAsked(list);
            setAskedState('loaded');
          }
        } catch {
          if (askedAlive.current) setAskedState('failed');
        }
      } while (askedQueued.current && askedAlive.current);
      askedBusy.current = false;
    })();
  }, []);
  const haveTodos = todos !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `todos` changing (a new object each load) is the trigger.
  useEffect(() => {
    if (haveTodos) reloadAsked();
  }, [todos, haveTodos, reloadAsked]);

  const completeTodo = useCallback(async (id: string) => {
    try {
      setTodos(await api.completeTodo(id));
      setActionError(null);
    } catch (err) {
      setActionError(messageOf(err));
    }
  }, []);

  const changeTodos = useCallback(
    async (actions: TodoAction[]): Promise<ChangeTodosResult> => {
      let done = 0;
      let latest: TodoList | undefined;
      let moved: { from: string; to: string } | undefined;
      // After a `move`, later steps for the same to-do go to its new place (and new name, after a clash).
      const renamed = new Map<string, string>();
      const keyOf = (id: string, scope: TodoScope | undefined) =>
        scope === 'personal' ? `personal/${id}` : id;
      const found = () => (moved ? { moved } : {});
      for (const [i, original] of actions.entries()) {
        let action = original;
        if (action.kind !== 'add') {
          // The editor addresses steps after a `move` by the key it expects the file to have there.
          const to = renamed.get(keyOf(action.id, action.scope));
          if (to !== undefined) {
            const personal = to.startsWith('personal/');
            const { scope: _old, ...rest } = action;
            action = {
              ...rest,
              id: personal ? to.slice('personal/'.length) : to,
              ...(personal ? { scope: 'personal' as const } : {}),
            } as TodoAction;
          }
        }
        // Each step after the first checks against the version the previous step left behind (the
        // person's own change), so only someone else's change can stop the save. Never sent without it.
        if (i > 0 && action.kind !== 'add') {
          const key = keyOf(action.id, action.scope);
          const version = latest && [...latest.mine, ...latest.open].find((t) => t.key === key)?.version;
          if (!version) {
            return {
              done,
              error: {
                code: 'not-found',
                message: 'This task is no longer in your list, so the rest of your changes were not saved.',
              },
              ...(latest ? { todos: latest } : {}),
              ...found(),
            };
          }
          action = { ...action, expect: version };
        }
        try {
          latest = await api.changeTodo(action);
          setTodos(latest);
          done += 1;
          if (action.kind === 'move' && latest.moved) {
            // The reply names the new key. If a name clash changed it, later steps go to the new name.
            const expected = keyOf(action.id, action.to);
            if (expected !== latest.moved.to) renamed.set(expected, latest.moved.to);
            moved = { from: moved?.from ?? latest.moved.from, to: latest.moved.to };
            // A starred to-do keeps its star under its new key, swapped with the list so it never shows unstarred.
            void renameFavouriteTodo(latest.moved.from, latest.moved.to);
          }
        } catch (err) {
          const error =
            err instanceof ApiFailure
              ? { code: err.code, message: err.message }
              : { code: 'internal', message: messageOf(err) };
          if (error.code === 'changed') {
            // Someone else changed it: load what is there now so the editor can adopt the new version.
            try {
              latest = await api.todos();
              setTodos(latest);
            } catch {
              // The next change will try again.
            }
          }
          return { done, error, ...(latest ? { todos: latest } : {}), ...found() };
        }
      }
      // Open-to-do counts and teams on the project cards moved with this save.
      if (actions.some((a) => a.kind === 'project' || (a.kind === 'add' && a.project) || a.kind === 'move'))
        void projectsStore.refresh();
      return { done, ...(latest ? { todos: latest } : {}), ...found() };
    },
    [renameFavouriteTodo],
  );

  const uploadTodoFile = useCallback(async (req: TodoUploadRequest): Promise<UploadTodoFileResult> => {
    try {
      const res = await api.uploadTodoFile(req);
      setTodos(res.list);
      return { ok: true, path: res.path, personal: res.personal, todos: res.list };
    } catch (err) {
      const error =
        err instanceof ApiFailure
          ? { code: err.code, message: err.message }
          : { code: 'internal', message: messageOf(err) };
      let fresh: TodoList | undefined;
      if (error.code === 'changed') {
        try {
          fresh = await api.todos();
          setTodos(fresh);
        } catch {
          // The next change will try again.
        }
      }
      return { ok: false, error, ...(fresh ? { todos: fresh } : {}) };
    }
  }, []);

  const [heldTodos, setHeldTodos] = useState<HeldTodo[]>([]);
  const [failedHeld, setFailedHeld] = useState<readonly string[]>([]);

  /** Starts the request for a held change. The queue has already taken it out of its entries. */
  const sendHeld = useCallback(async (held: HeldTodo, opts?: { keepalive: true }) => {
    const note = held.note ? { note: held.note } : {};
    const send = () =>
      held.kind === 'tick' || held.action === null
        ? held.tick && held.tick.scope === 'personal'
          ? api.completeTodo(held.tick.id, opts, { scope: 'personal', expect: held.tick.expect, ...note })
          : held.note
            ? api.completeTodo(held.todoId, opts, note)
            : opts
              ? api.completeTodo(held.todoId, opts)
              : api.completeTodo(held.todoId)
        : opts
          ? api.changeTodo(held.action, opts)
          : api.changeTodo(held.action);
    try {
      setTodos(await send());
    } catch (err) {
      // A 'changed' refusal shows like any other held failure. On pagehide (keepalive) nothing can be
      // shown: it fails safe, the change is refused and nothing is written.
      setFailedHeld((ids) => (ids.includes(held.todoId) ? ids : [...ids, held.todoId]));
      setActionError(
        err instanceof ApiFailure && err.code === 'changed'
          ? `${err.message} Open it to see the latest, then try again.`
          : messageOf(err),
      );
    } finally {
      setHeldTodos((list) => list.filter((h) => h.todoId !== held.todoId));
    }
  }, []);
  const todoQueue = useHeldQueue<HeldTodo>(sendHeld, (id) =>
    setHeldTodos((list) => list.map((h) => (h.todoId === id ? { ...h, sending: true } : h))),
  );

  const holdTodo = useCallback(
    (held: HeldTodo) => {
      // A change still waiting is replaced; one already on its way can't be.
      if (!todoQueue.hold(held.todoId, held, { replace: true })) return;
      setFailedHeld((ids) => (ids.includes(held.todoId) ? ids.filter((id) => id !== held.todoId) : ids));
      setHeldTodos((list) => [...list.filter((h) => h.todoId !== held.todoId), held]);
    },
    [todoQueue],
  );

  const undoHeld = useCallback(
    (todoId: string) => {
      // Only while the time is still running: once a change is on its way, Undo can't stop it.
      if (!todoQueue.undo(todoId)) return;
      setHeldTodos((list) => list.filter((h) => h.todoId !== todoId));
    },
    [todoQueue],
  );
  const pauseHeld = useCallback((todoId: string) => todoQueue.pause(todoId), [todoQueue]);
  const resumeHeld = useCallback((todoId: string) => todoQueue.resume(todoId), [todoQueue]);

  // Library deletes: held like to-do changes. `fileRows` is what the screens see; the queue holds the timers.
  const [fileRows, setFileRows] = useState<(HeldFile & { gone?: true })[]>([]);
  type FileItem = Pick<LibraryItem, 'id' | 'version'> & { name: string };

  const sendFile = useCallback(
    async (item: FileItem, opts?: { keepalive: true }) => {
      setFileRows((rows) => rows.map((r) => (r.id === item.id ? { ...r, phase: 'sending' } : r)));
      try {
        await api.deleteLibraryFile(item.id, item.version, opts);
      } catch (err) {
        // It comes back, with the reason. (On pagehide nothing can be shown: the file simply stays.)
        setFileRows((rows) => rows.filter((r) => r.id !== item.id));
        setActionError(fileDeleteMessage(err));
        return;
      }
      setActionError(null);
      // The server has already dropped the star; do the same here so the saved list matches.
      setBoot((b) => {
        const favs = b?.prefs.favouriteFiles;
        return b && favs?.includes(item.id)
          ? { ...b, prefs: { ...b.prefs, favouriteFiles: favs.filter((f) => f !== item.id) } }
          : b;
      });
      showNotice(filesDeletedNotice(item.name), 8000, 'file');
      // A list that was already loading may still carry it, so it stays out for a while.
      setFileRows((rows) => rows.map((r) => (r.id === item.id ? { ...r, gone: true } : r)));
      setTimeout(
        () => setFileRows((rows) => rows.filter((r) => !(r.id === item.id && r.gone))),
        FILE_GONE_MS,
      );
    },
    [showNotice],
  );
  const fileQueue = useHeldQueue<FileItem>(sendFile, (id) =>
    setFileRows((rows) => rows.map((r) => (r.id === id ? { ...r, phase: 'sending' } : r))),
  );

  const lastFileDelete = useRef(Number.NEGATIVE_INFINITY);
  const deleteFile = useCallback(
    (item: Pick<LibraryItem, 'id' | 'title' | 'version'>, name?: string) => {
      if (fileQueue.has(item.id)) return;
      // A delete just now slides the next file's bin under the pointer (or keeps Enter on a bin): a
      // second press that quick was aimed at the first file, not this one (overseer, 2026-11-15).
      const now = Date.now();
      if (now - lastFileDelete.current < FILE_DELETE_GUARD_MS) return;
      lastFileDelete.current = now;
      const shown = name ?? item.title;
      fileQueue.hold(item.id, { id: item.id, version: item.version, name: shown });
      setFileRows((rows) => [
        ...rows.filter((r) => r.id !== item.id),
        { id: item.id, title: shown, phase: 'waiting' },
      ]);
    },
    [fileQueue],
  );
  const pauseFileDelete = useCallback((id: string) => fileQueue.pause(id), [fileQueue]);
  const resumeFileDelete = useCallback((id: string) => fileQueue.resume(id), [fileQueue]);
  const undoDeleteFile = useCallback(
    (id: string) => {
      // Once it is on its way Undo can't stop it.
      if (!fileQueue.undo(id)) return;
      setFileRows((rows) => rows.filter((r) => r.id !== id));
    },
    [fileQueue],
  );

  // Earlier chat deletes: held like files (plan 2026-11-22-ux-consistency, R2). `chatRows` is what the screens see.
  const [chatRows, setChatRows] = useState<(HeldChatDelete & { gone?: true })[]>([]);
  const sendChat = useCallback(
    async (held: HeldChatDelete) => {
      const id = held.sdkSessionId;
      setChatRows((rows) => rows.map((r) => (r.sdkSessionId === id ? { ...r, phase: 'sending' } : r)));
      try {
        // Always keepalive (api.ts), so a delete already on its way finishes if the page closes.
        await api.deletePastChat(id);
      } catch (err) {
        // It comes back in every list, with the reason. (On pagehide nothing can be shown: the chat stays.)
        setChatRows((rows) => rows.filter((r) => r.sdkSessionId !== id));
        setActionError(messageOf(err));
        setChatNotice(`“${held.title}” couldn't be deleted.`);
        return;
      }
      setActionError(null);
      showNotice(`“${held.title}” moved to the Bin. You can put it back from there.`, 6000, 'chat');
      // Out of the list we have at once; it stays hidden until the reload after this success has landed.
      setSessions((s) => (s ? { ...s, past: s.past.filter((p) => p.sdkSessionId !== id) } : s));
      setChatRows((rows) => rows.map((r) => (r.sdkSessionId === id ? { ...r, gone: true } : r)));
      await loadSessions();
      setChatRows((rows) => rows.filter((r) => !(r.sdkSessionId === id && r.gone)));
    },
    [loadSessions, showNotice],
  );
  const chatQueue = useHeldQueue<HeldChatDelete>(sendChat, (id) =>
    setChatRows((rows) => rows.map((r) => (r.sdkSessionId === id ? { ...r, phase: 'sending' } : r))),
  );

  const lastChatDelete = useRef(Number.NEGATIVE_INFINITY);
  const holdDeletePastChat = useCallback(
    (sdkSessionId: string, title: string) => {
      if (chatQueue.has(sdkSessionId)) return;
      // As for files: a second bin press that quick was aimed at the chat just deleted.
      const now = Date.now();
      if (now - lastChatDelete.current < FILE_DELETE_GUARD_MS) return;
      const session = sessionsRef.current?.past.find((p) => p.sdkSessionId === sdkSessionId);
      if (!session) return;
      lastChatDelete.current = now;
      const held: HeldChatDelete = { sdkSessionId, title, phase: 'waiting', session };
      chatQueue.hold(sdkSessionId, held);
      setChatNotice(null);
      setChatRows((rows) => [...rows.filter((r) => r.sdkSessionId !== sdkSessionId), held]);
    },
    [chatQueue],
  );
  const undoDeletePastChat = useCallback(
    (sdkSessionId: string) => {
      if (!chatQueue.undo(sdkSessionId)) return;
      setChatRows((rows) => rows.filter((r) => r.sdkSessionId !== sdkSessionId));
    },
    [chatQueue],
  );
  const pauseChatDelete = useCallback((id: string) => chatQueue.pause(id), [chatQueue]);
  const resumeChatDelete = useCallback((id: string) => chatQueue.resume(id), [chatQueue]);

  // Closing or leaving the page: start everything not yet sent, at once, so no change is lost.
  useEffect(() => {
    const flush = () => {
      todoQueue.flush();
      fileQueue.flush();
      chatQueue.flush();
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [todoQueue, fileQueue, chatQueue]);

  const heldChats = useMemo(() => chatRows.filter((r) => !r.gone), [chatRows]);
  const hiddenChatIds = useMemo<ReadonlySet<string>>(
    () => new Set(chatRows.map((r) => r.sdkSessionId)),
    [chatRows],
  );
  hiddenChatRef.current = hiddenChatIds;
  // Every screen reads the same list (the Chats drawer, Home, search): a chat being deleted is not in it.
  const shownSessions = useMemo(() => {
    if (!sessions?.past.some((p) => hiddenChatIds.has(p.sdkSessionId))) return sessions;
    return { ...sessions, past: sessions.past.filter((p) => !hiddenChatIds.has(p.sdkSessionId)) };
  }, [sessions, hiddenChatIds]);

  const heldFiles = useMemo(() => fileRows.filter((r) => !r.gone), [fileRows]);
  const hiddenFileIds = useMemo<ReadonlySet<string>>(() => new Set(fileRows.map((r) => r.id)), [fileRows]);
  const fileDeleteBusy = fileRows.some((r) => r.phase === 'sending' && !r.gone);
  // Home and the stars read the saved list; a file being deleted is not shown in it.
  const shownBoot = useMemo(() => {
    const favs = boot?.prefs.favouriteFiles;
    if (!boot || !favs?.some((id) => hiddenFileIds.has(id))) return boot;
    return { ...boot, prefs: { ...boot.prefs, favouriteFiles: favs.filter((id) => !hiddenFileIds.has(id)) } };
  }, [boot, hiddenFileIds]);

  const value = useMemo<Store>(
    () => ({
      gate,
      boot: shownBoot,
      todos,
      sessions: shownSessions,
      view,
      activeChat,
      chats,
      streamUp,
      lists: { todos: todosState, chats: chatsState },
      actionError,
      clearError: () => setActionError(null),
      openView,
      newChat,
      startSkill,
      openChat,
      chatDrawer,
      newChatDrawer,
      newChatStarting,
      dropNewChatDrawer,
      expandNewChatDrawer,
      hideChatDrawer,
      expandChatDrawer,
      openPast,
      openTool,
      toolArg,
      clearToolArg,
      startChat,
      ads,
      reloadAds,
      send,
      askPage,
      updatePrefs,
      skillLevels: levelsOverride ?? boot?.skillLevels ?? null,
      setSkillLevel,
      setChatLevel,
      dismissLevelOffer,
      markTodosSeen,
      asked,
      askedState,
      reloadAsked,
      markTodosLooked,
      togglePin,
      completeTodo,
      changeTodos,
      uploadTodoFile,
      heldTodos,
      failedHeld,
      holdTodo,
      undoHeld,
      pauseHeld,
      resumeHeld,
      heldFiles,
      hiddenFileIds,
      fileDeleteBusy,
      deleteFile,
      undoDeleteFile,
      pauseFileDelete,
      resumeFileDelete,
      libraryVersion,
      retry: loadAll,
      setupOpen,
      setSetupOpen,
      composerFocus,
      requestComposerFocus: requestFocus,
      reveal,
      revealTodo,
      clearReveal,
      doneReveal,
      revealDoneTodo,
      clearDoneReveal,
      settingsFocus,
      settingsTab,
      openSettings,
      requestSettingsFocus,
      clearSettingsFocus,
      closeRequest,
      cancelClose: () => setCloseRequest(null),
      requestClose,
      closeChat,
      heldChats,
      holdDeletePastChat,
      undoDeletePastChat,
      pauseChatDelete,
      resumeChatDelete,
      chatNotice,
      setChatKind,
      toggleFavouriteChat,
      toggleFavouriteTodo,
      toggleFavouriteFile,
      homeHidden: shownBoot?.prefs.homeHidden,
      homeShortcuts: shownBoot?.prefs.homeShortcuts,
      setHomeItemShown,
      addHomeShortcut,
      removeHomeShortcut,
      showAllHomeItems,
      notice,
      fileNotice,
      run,
      setLeaveGuard,
      setDrawerGuard,
    }),
    [
      gate,
      boot,
      shownBoot,
      todos,
      shownSessions,
      view,
      activeChat,
      chats,
      streamUp,
      todosState,
      chatsState,
      actionError,
      openView,
      newChat,
      startSkill,
      openChat,
      chatDrawer,
      newChatDrawer,
      newChatStarting,
      dropNewChatDrawer,
      expandNewChatDrawer,
      hideChatDrawer,
      expandChatDrawer,
      openPast,
      openTool,
      toolArg,
      clearToolArg,
      startChat,
      ads,
      reloadAds,
      send,
      askPage,
      updatePrefs,
      levelsOverride,
      setSkillLevel,
      setChatLevel,
      dismissLevelOffer,
      markTodosSeen,
      asked,
      askedState,
      reloadAsked,
      markTodosLooked,
      togglePin,
      completeTodo,
      changeTodos,
      uploadTodoFile,
      heldTodos,
      failedHeld,
      holdTodo,
      undoHeld,
      pauseHeld,
      resumeHeld,
      heldFiles,
      hiddenFileIds,
      fileDeleteBusy,
      deleteFile,
      undoDeleteFile,
      pauseFileDelete,
      resumeFileDelete,
      libraryVersion,
      loadAll,
      setupOpen,
      composerFocus,
      requestFocus,
      reveal,
      revealTodo,
      clearReveal,
      doneReveal,
      revealDoneTodo,
      clearDoneReveal,
      settingsFocus,
      settingsTab,
      openSettings,
      requestSettingsFocus,
      clearSettingsFocus,
      closeRequest,
      requestClose,
      closeChat,
      heldChats,
      holdDeletePastChat,
      undoDeletePastChat,
      pauseChatDelete,
      resumeChatDelete,
      chatNotice,
      setChatKind,
      toggleFavouriteChat,
      toggleFavouriteTodo,
      toggleFavouriteFile,
      setHomeItemShown,
      addHomeShortcut,
      removeHomeShortcut,
      showAllHomeItems,
      notice,
      fileNotice,
      run,
      setLeaveGuard,
      setDrawerGuard,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
