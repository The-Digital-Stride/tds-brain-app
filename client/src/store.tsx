import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type {
  AppPrefs,
  Bootstrap,
  SequencedEvent,
  SessionList,
  SkillInfo,
  StreamFrame,
  TodoList,
} from '../../shared/contract.ts';
import { STREAM_PING_EVENT, STREAM_STALL_MS } from '../../shared/contract.ts';
import { ApiFailure, api, streamUrl } from './api.ts';
import { type ChatState, chatReducer, initialChatState } from './state/chat-reducer.ts';
import { needsCloseConfirm } from './state/close.ts';
import type { ListState } from './state/health.ts';
import { chooseInitialChat, readSavedChat, saveChat } from './state/resume.ts';
import { isStalled } from './state/stall.ts';

export type View = 'chat' | 'settings' | 'profile' | `app:${string}`;
export type Gate = 'loading' | 'ready' | 'not-signed-in' | 'unreachable';

export interface NewChat {
  kind: 'new';
  /** Changes each time a new chat is opened, so the composer resets. */
  key: number;
  draft: string;
  skill: SkillInfo | null;
  /** The to-do this chat is about, when it was started from one. */
  todoId: string | null;
}
export interface LiveChat {
  kind: 'live';
  sessionId: string;
}
export type ActiveChat = NewChat | LiveChat;

type Chats = Record<string, ChatState>;
type ChatsAction = { sessionId: string; item: SequencedEvent };

function chatsReducer(chats: Chats, action: ChatsAction): Chats {
  const current = chats[action.sessionId] ?? initialChatState;
  const next = chatReducer(current, { type: 'event', item: action.item });
  return next === current && action.sessionId in chats ? chats : { ...chats, [action.sessionId]: next };
}

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
  newChat: (opts?: { draft?: string; skill?: SkillInfo | null; todoId?: string | null }) => void;
  startSkill: (skill: SkillInfo) => void;
  openChat: (sessionId: string) => void;
  openPast: (sdkSessionId: string) => Promise<void>;
  /** Sends the first message of a new chat, or a follow-up in a live one. */
  send: (text: string, client: string | null, attachments?: string[]) => Promise<boolean>;
  updatePrefs: (patch: Partial<AppPrefs>) => Promise<void>;
  togglePin: (name: string) => Promise<void>;
  completeTodo: (id: string) => Promise<void>;
  /** Counts up when the library's files change or the server restarts; the library screens refetch. */
  libraryVersion: number;
  retry: () => void;
  /** True while the full-screen brain folder page is open from Settings or the brain problem screen. */
  setupOpen: boolean;
  setSetupOpen: (open: boolean) => void;
  /** The chat whose inline "Close anyway?" is showing in the header, if any. */
  closeRequest: string | null;
  cancelClose: () => void;
  /** Closes at once when idle; otherwise switches to the chat and asks first. */
  requestClose: (id: string) => void;
  closeChat: (id: string) => Promise<boolean>;
  /** A brief plain line shown after a chat is closed. */
  notice: string | null;
  /** Counts up each time focus should return to the message box. */
  composerFocus: number;
  requestComposerFocus: () => void;
  /** Runs a chat action (answer, stop) and reports a failure in plain words. */
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore must be used inside StoreProvider');
  return s;
}

function messageOf(err: unknown): string {
  return err instanceof ApiFailure ? err.message : 'Something went wrong. Please try again.';
}

let newChatKey = 0;
function freshNewChat(draft = '', skill: SkillInfo | null = null, todoId: string | null = null): NewChat {
  newChatKey += 1;
  return { kind: 'new', key: newChatKey, draft, skill, todoId };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>('loading');
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [todos, setTodos] = useState<TodoList | null>(null);
  const [sessions, setSessions] = useState<SessionList | null>(null);
  const [view, setView] = useState<View>('chat');
  const [activeChat, setActiveChat] = useState<ActiveChat>(() => freshNewChat());
  const [chats, dispatchChat] = useReducer(chatsReducer, {} as Chats);
  const [streamUp, setStreamUp] = useState(true);
  const [todosState, setTodosState] = useState<ListState>('loading');
  const [chatsState, setChatsState] = useState<ListState>('loading');
  const [actionError, setActionError] = useState<string | null>(null);
  const [composerFocus, setComposerFocus] = useState(0);
  const requestFocus = useCallback(() => setComposerFocus((n) => n + 1), []);
  const restored = useRef(false);
  const [closeRequest, setCloseRequest] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(activeChat);
  activeRef.current = activeChat;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const serverStartedAt = useRef<string | null>(null);

  const failGate = useCallback((err: unknown) => {
    if (err instanceof ApiFailure && err.notSignedIn) setGate('not-signed-in');
    else setGate((g) => (g === 'ready' ? g : 'unreachable'));
  }, []);

  const loadBootstrap = useCallback(async () => {
    try {
      const b = await api.bootstrap();
      setBoot(b);
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

  const openView = useCallback((v: View) => setView(v), []);

  const newChat = useCallback(
    (opts?: { draft?: string; skill?: SkillInfo | null; todoId?: string | null }) => {
      setActiveChat(freshNewChat(opts?.draft ?? '', opts?.skill ?? null, opts?.todoId ?? null));
      setView('chat');
      setActionError(null);
    },
    [],
  );

  const closeChat = useCallback(
    async (id: string) => {
      try {
        await api.close(id);
      } catch (err) {
        setActionError(messageOf(err));
        return false;
      }
      setActionError(null);
      setCloseRequest(null);
      setSessions((s) => (s ? { ...s, live: s.live.filter((c) => c.id !== id) } : s));
      void loadSessions();
      const cur = activeRef.current;
      if (cur.kind === 'live' && cur.sessionId === id) {
        setActiveChat(freshNewChat());
        requestFocus();
      }
      setNotice("Chat closed. It's under Earlier in Chats if you want it back.");
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 6000);
      return true;
    },
    [loadSessions, requestFocus],
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
        setActiveChat({ kind: 'live', sessionId: id });
        setView('chat');
        setCloseRequest(id);
      } else {
        void closeChat(id);
      }
    },
    [closeChat],
  );

  const startSkill = useCallback(
    (skill: SkillInfo) => {
      newChat({ draft: '', skill });
    },
    [newChat],
  );

  const openChat = useCallback((sessionId: string) => {
    setActiveChat({ kind: 'live', sessionId });
    setView('chat');
    setActionError(null);
    setCloseRequest(null);
  }, []);

  const openPast = useCallback(
    async (sdkSessionId: string) => {
      try {
        const { session } = await api.startSession({ resume: sdkSessionId });
        void loadSessions();
        openChat(session.id);
      } catch (err) {
        if (err instanceof ApiFailure && err.code === 'already-open') {
          const list = await api.sessions().catch(() => null);
          const live = list?.live.find((s) => s.sdkSessionId === sdkSessionId);
          if (live) {
            setSessions(list);
            openChat(live.id);
            return;
          }
        }
        setActionError(messageOf(err));
      }
    },
    [loadSessions, openChat],
  );

  const send = useCallback(
    async (text: string, client: string | null, attachments: string[] = []) => {
      const body = text.trim();
      // A message may be files only.
      if (!body && attachments.length === 0) return false;
      const files = attachments.length > 0 ? { attachments } : {};
      try {
        if (activeChat.kind === 'new') {
          // Keep the to-do link only while the message still mentions it.
          const todoId =
            activeChat.todoId && body.includes(`todo/${activeChat.todoId}`) ? activeChat.todoId : null;
          const { session } = await api.startSession({
            prompt: body,
            client,
            ...(todoId ? { todoId } : {}),
            ...files,
          });
          if (client && boot && boot.prefs.lastClient !== client) {
            void api
              .updatePrefs({ lastClient: client })
              .then((prefs) => setBoot((b) => (b ? { ...b, prefs } : b)))
              .catch(() => {});
          }
          void loadSessions();
          setActiveChat({ kind: 'live', sessionId: session.id });
        } else {
          await api.sendMessage(activeChat.sessionId, body, attachments);
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
    [activeChat, boot, loadSessions, loadTodos],
  );

  const updatePrefs = useCallback(async (patch: Partial<AppPrefs>) => {
    try {
      const prefs = await api.updatePrefs(patch);
      setBoot((b) => (b ? { ...b, prefs } : b));
    } catch (err) {
      setActionError(messageOf(err));
    }
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

  const completeTodo = useCallback(async (id: string) => {
    try {
      setTodos(await api.completeTodo(id));
      setActionError(null);
    } catch (err) {
      setActionError(messageOf(err));
    }
  }, []);

  const value = useMemo<Store>(
    () => ({
      gate,
      boot,
      todos,
      sessions,
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
      openPast,
      send,
      updatePrefs,
      togglePin,
      completeTodo,
      libraryVersion,
      retry: loadAll,
      setupOpen,
      setSetupOpen,
      composerFocus,
      requestComposerFocus: requestFocus,
      closeRequest,
      cancelClose: () => setCloseRequest(null),
      requestClose,
      closeChat,
      notice,
      run,
    }),
    [
      gate,
      boot,
      todos,
      sessions,
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
      openPast,
      send,
      updatePrefs,
      togglePin,
      completeTodo,
      libraryVersion,
      loadAll,
      setupOpen,
      composerFocus,
      requestFocus,
      closeRequest,
      requestClose,
      closeChat,
      notice,
      run,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
