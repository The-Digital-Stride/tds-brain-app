import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type AskedTodo,
  type AskedTodoList,
  ATTENTION_LABEL,
  attentionFor,
  type TodoAction,
  type TodoItem,
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { dueInWords, isOverdue, todayIso } from '../format.ts';
import { chatForTodo } from '../state/attention.ts';
import { todoChatClient } from '../state/client-choice.ts';
import { splitFavouriteTodos } from '../state/todo-favourites.ts';
import { EMPTY_FILTER, filterActive, filterTodos } from '../state/todo-filter.ts';
import { groupTodos } from '../state/todo-groups.ts';
import { newToYou } from '../state/todo-new.ts';
import { type ChangeTodosResult, type HeldTodo, TODO_UNDO_MS, useStore } from '../store.tsx';
import { AskedList, type AskedState, askedOrder } from './AskedList.tsx';
import type { TodoFilter, TodoPanelState } from './contract.ts';
import { Fold } from './Fold.tsx';
import { Icon } from './Icon.tsx';
import { SearchSelect } from './SearchSelect.tsx';
import { Seg } from './Seg.tsx';
import { useShell } from './ShellProvider.tsx';
import { NO_FAVOURITES, StarButton, useStarFocus } from './StarButton.tsx';
import { buildEditActions, detailsText, type EditDraft } from './TodoForms.tsx';
import type { TodoPanelProps } from './TodoPanel.tsx';
import { handoverMeta, todoChatDraft, todoPlaces } from './words.ts';

// The panel, its editor and the converter load as one chunk the first time a to-do is opened (plan decision 19).
const TodoPanel = lazy(() => import('./TodoPanel.tsx'));

type Tab = 'mine' | 'open' | 'asked';

/** What a row needs to open the panel: set by the drawer for every to-do (reading needs no permission). */
interface RowControls {
  /** May edit (changes are on): the row's button says Edit; otherwise Options (read, and tick it off). */
  canEdit: boolean;
  /** The keys of the open panel, to mark its row. */
  openKey: string | null;
  busy: boolean;
  open: (todo: TodoItem, mode: 'read' | 'edit') => void;
  /** Whether the person may do anything but read (change or tick off): shows the Edit / Options button. */
  actionable: boolean;
}

/**
 * Moves a draft onto the version now in the brain: fields the person didn't touch take the fresh value,
 * fields they edited stay as typed. Functional, so text typed while a save was in flight survives.
 */
function rebase(d: EditDraft, fresh: TodoItem, conflict: boolean, canAttach: boolean): EditDraft {
  const now = {
    title: fresh.title,
    details: detailsText(fresh, canAttach),
    due: fresh.due ?? '',
    assignee: fresh.assignee ?? '',
    scope: fresh.scope,
  };
  const keep = <K extends keyof typeof now>(k: K) => (d[k] === d.base[k] ? now[k] : d[k]);
  return {
    title: keep('title'),
    details: keep('details'),
    due: keep('due'),
    assignee: keep('assignee'),
    scope: keep('scope'),
    version: fresh.version,
    base: now,
    ...(conflict ? { theirs: now } : {}),
  };
}

const UNDO_VERB: Record<HeldTodo['kind'], string> = {
  tick: 'marking as done',
  delete: 'deleting',
  assignee: 'passing on',
};

/** A to-do whose tick, delete or pass-on is waiting out its undo time. Nothing is in the brain yet. */
function HeldRow({ held, focus, onUndo }: { held: HeldTodo; focus: boolean; onUndo: () => void }) {
  const undo = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // preventScroll: a mouse tick shouldn't jump the list.
    if (focus) undo.current?.focus({ preventScroll: true });
  }, [focus]);
  const gone = held.kind !== 'assignee';
  return (
    <li className="todo todo-held" data-held={held.kind}>
      <span className="line-text">
        <span className={gone ? 'line-title todo-gone' : 'line-title'}>{held.title}</span>{' '}
        <span className="line-meta">{held.label}</span>
      </span>
      {held.sending ? (
        <span className="todo-sending">Sending…</span>
      ) : (
        <button
          type="button"
          className="btn todo-undo"
          ref={undo}
          aria-label={`Undo ${UNDO_VERB[held.kind]} "${held.title}"`}
          onClick={onUndo}
        >
          Undo
        </button>
      )}
      {held.sending ? null : (
        <span
          className="todo-countdown"
          aria-hidden="true"
          style={{ animationDuration: `${TODO_UNDO_MS}ms` }}
        />
      )}
    </li>
  );
}

function TodoRow({
  todo,
  controls,
  fresh,
  showScope,
  onOpened,
  favourite,
  onStar,
}: {
  todo: TodoItem;
  controls: RowControls;
  /** In "New to you": a dot, and opening it marks it seen. */
  fresh: boolean;
  /** The scope filter is All: a personal row says so. */
  showScope: boolean;
  /** The row was opened (chat or editor): "New to you" marks it seen. */
  onOpened: (todo: TodoItem) => void;
  /** Starred: it sits in Favourites, at the top. */
  favourite: boolean;
  onStar: (todo: TodoItem, button: HTMLElement) => void;
}) {
  const { boot, newChat, sessions, activeChat, openChat, view } = useStore();
  const { state: shellState, dispatch, modes } = useShell();
  // The chat button is named by its action and title; "New to you" and the details line describe it, so a keyboard or
  // screen-reader user who lands on it hears them too.
  const newId = useId();
  const metaId = useId();
  const chat = sessions ? chatForTodo(todo.key, sessions.live) : null;
  const attention = chat ? attentionFor(chat.state) : null;
  const current =
    chat !== null && view === 'chat' && activeChat.kind === 'live' && activeChat.sessionId === chat.id;
  const due = todo.due ? dueInWords(todo.due) : '';
  const overdue = todo.due ? isOverdue(todo.due) : false;

  const parts: { text: string; late?: boolean; icon?: 'lock' }[] = [];
  const from = handoverMeta(todo, boot?.identity.slug ?? '');
  if (from) parts.push({ text: from });
  if (showScope && todo.scope === 'personal') parts.push({ text: 'Personal', icon: 'lock' });
  if (due) parts.push({ text: due, late: overdue });
  for (const text of todoPlaces(todo, boot?.clients ?? [])) parts.push({ text });
  if (chat)
    parts.push({ text: `open chat${attention ? `, ${ATTENTION_LABEL[attention].toLowerCase()}` : ''}` });

  const choose = () => {
    // The panel holds unsaved changes: it asks first, and the chat waits for the answer.
    if (shellState.todoPanel?.dirty) return dispatch({ type: 'close-todo' });
    onOpened(todo);
    if (chat) openChat(chat.id);
    else {
      const client = todoChatClient(todo, boot?.clients ?? []);
      newChat({ draft: todoChatDraft(todo), todoId: todo.key, ...(client !== undefined ? { client } : {}) });
    }
    // The panel (if one is open) makes way for the chat.
    if (shellState.todoPanel) dispatch({ type: 'close-todo', force: true });
    if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
  };

  return (
    <li
      className="todo"
      data-editable={controls.actionable ? 'true' : undefined}
      data-panel-open={controls.openKey === todo.key ? 'true' : undefined}
      data-attention={attention ?? undefined}
      aria-current={current ? 'true' : undefined}
    >
      {/* The row itself is not a button (Ian, 2026-11-14): only the chat button starts or opens the chat. The title
          has the row's whole width; its details and buttons share the line below (Ian, 2026-11-14). */}
      <div className="todo-main">
        {fresh ? <span className="dot todo-new" data-new="true" aria-hidden="true" /> : null}
        <span className="line-text">
          {fresh ? (
            <span className="visually-hidden" id={newId}>
              New to you.
            </span>
          ) : null}
          {/* The title opens the to-do in the panel, for everyone: reading needs no permission. */}
          <button
            type="button"
            className="line-title todo-open"
            data-panel-for={todo.key}
            aria-haspopup="dialog"
            aria-describedby={fresh ? newId : undefined}
            onClick={() => {
              onOpened(todo);
              controls.open(todo, 'read');
            }}
          >
            {todo.title}
          </button>
        </span>
      </div>
      <div className="todo-foot">
        <span className="line-meta todo-meta" id={metaId}>
          {parts.map((part, i) => (
            <span key={part.text}>
              {i > 0 ? ', ' : ''}
              {part.icon ? (
                <span className="todo-lock">
                  <Icon name={part.icon} size={12} />
                </span>
              ) : null}
              <span className={part.late ? 'late' : undefined}>{part.text}</span>
            </span>
          ))}
        </span>
        {/* The star changes no to-do (it lives in the app's own settings), so it shows whether or not changes are on. */}
        <StarButton
          id={todo.key}
          title={todo.title}
          on={favourite}
          onPress={(_, button) => onStar(todo, button)}
        />
        {controls.actionable ? (
          <button
            type="button"
            className="icon-btn todo-edit"
            data-edit-for={todo.key}
            aria-label={controls.canEdit ? `Edit "${todo.title}"` : `Options for "${todo.title}"`}
            data-tip={controls.canEdit ? 'Edit' : 'Options'}
            disabled={controls.busy}
            onClick={() => {
              onOpened(todo);
              controls.open(todo, controls.canEdit ? 'edit' : 'read');
            }}
          >
            <Icon name={controls.canEdit ? 'edit' : 'more'} size={16} />
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn todo-go"
          data-todo-open={todo.key}
          aria-label={`${chat ? 'Open chat' : 'Start a chat on this'}: ${todo.title}`}
          data-tip={chat ? 'Open chat' : 'Start a chat'}
          aria-describedby={fresh ? `${newId} ${metaId}` : metaId}
          onClick={choose}
        >
          <Icon name="chat" size={16} />
        </button>
      </div>
    </li>
  );
}

/** Tells screen readers how many to-dos match, a moment after the person stops typing. Silent unless filtering. */
function ResultsAnnouncer({ filtering, count }: { filtering: boolean; count: number }) {
  const text = filtering
    ? count === 0
      ? 'No to-dos match'
      : `${count} ${count === 1 ? 'to-do matches' : 'to-dos match'}`
    : '';
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (text === '') return setSaid('');
    const t = setTimeout(() => setSaid(text), 500);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <p className="visually-hidden" role="status">
      {said}
    </p>
  );
}

/** What `PanelHost` adds to the panel's own props: where it is open and what the drawer holds for it. */
type HostProps = Omit<TodoPanelProps, 'todo' | 'asked' | 'mode' | 'dirtyAsk' | 'order'> & {
  panel: TodoPanelState;
  todo: TodoItem | null;
  asked: AskedTodo | null;
  order: string[];
};

/**
 * Mounts the to-do panel beside the dock (`#todo-panel-slot` in App.tsx: the dock clips what is inside it) and
 * keeps the shell's list of what previous and next walk through. The controller (drafts, saves, holds) stays
 * in the drawer, which is why the panel is rendered from here and not from App.
 */
function PanelHost({ panel, todo, asked, order, ...rest }: HostProps) {
  const { dispatch } = useShell();
  const orderKey = order.join('\n');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `orderKey` stands for `order`.
  useEffect(() => {
    dispatch({ type: 'set-todo-order', order });
  }, [orderKey, dispatch]);
  // A to-do that has gone since it was opened (passed on, done by someone else) closes the panel; one that
  // has not shown up in the list yet (just added) is waited for.
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (panel.key === null) return;
    if (todo || asked) seen.current = panel.key;
    else if (seen.current === panel.key) dispatch({ type: 'close-todo', force: true });
  }, [panel.key, todo, asked, dispatch]);
  if (panel.mode !== 'add' && !todo && !asked) return null;
  const node = (
    <Suspense fallback={null}>
      <TodoPanel todo={todo} asked={asked} mode={panel.mode} {...rest} />
    </Suspense>
  );
  const slot = typeof document === 'undefined' ? null : document.getElementById('todo-panel-slot');
  return slot ? createPortal(node, slot) : node;
}

export function TodosDrawer() {
  const {
    todos,
    boot,
    changeTodos,
    openSettings,
    heldTodos,
    holdTodo,
    undoHeld,
    markTodosSeen,
    reveal,
    clearReveal,
    toggleFavouriteTodo,
  } = useStore();
  const favs = boot?.prefs.favouriteTodos ?? NO_FAVOURITES;
  const [focusUndo, setFocusUndo] = useState<string | null>(null);
  // The to-do the status line's "You can undo this" is about, so it can be cleared once that's sent.
  const [undoMessageFor, setUndoMessageFor] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>('mine');
  // To-dos opened this visit: they stay in "New to you" (without the dot) until the tab changes, so a row
  // doesn't jump away under the person's hands.
  const [visitSeen, setVisitSeen] = useState<ReadonlySet<string>>(new Set());
  // A to-do the global search sent us to: its group is held open and it opens in the panel.
  // `n` counts requests, so asking again remounts the groups (a group closed by hand opens again).
  const [revealed, setRevealed] = useState<{ key: string; n: number } | null>(null);
  const setTab = (t: Tab) => {
    setVisitSeen(new Set());
    setRevealed(null);
    setTabState(t);
  };
  // Sections the person opened or closed by hand, or that a star press opened. They hold only while the tab,
  // the filtering and the last global-search reveal stay the same (`scope`); after that every section is back
  // to its default (`defaultOpen` below).
  const [foldChoice, setFoldChoice] = useState<{
    scope: string;
    open: Record<string, boolean>;
  }>({
    scope: '',
    open: {},
  });
  const { state: shell, dispatch: shellDispatch, modes } = useShell();
  const panel = shell.todoPanel ?? null;
  // The asked-of-others list is its own request: it never blocks or fails the main list. It loads with the
  // drawer and again whenever the to-dos reload (`todos` is a new object each time). A failed reload keeps
  // what was shown.
  const [asked, setAsked] = useState<AskedTodoList | null>(null);
  const [askedState, setAskedState] = useState<AskedState>('loading');
  const askedRun = useRef(0);
  const loadAsked = useCallback(async () => {
    const run = ++askedRun.current;
    setAskedState('loading');
    try {
      const list = await api.askedTodos();
      if (run !== askedRun.current) return;
      setAsked(list);
      setAskedState('loaded');
    } catch {
      if (run === askedRun.current) setAskedState('failed');
    }
  }, []);
  const haveTodos = todos !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `todos` changing is the trigger to reload.
  useEffect(() => {
    if (haveTodos) void loadAsked();
  }, [todos, haveTodos, loadAsked]);
  useEffect(
    () => () => {
      askedRun.current = -1;
    },
    [],
  );
  const adding = panel?.mode === 'add';
  const [filter, setFilter] = useState<TodoFilter>(EMPTY_FILTER);
  const [draft, setDraft] = useState<EditDraft>({
    title: '',
    details: '',
    due: '',
    assignee: '',
    scope: 'tds',
    version: '',
    base: { title: '', details: '', due: '', assignee: '', scope: 'tds' },
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessageText] = useState('');
  const [isError, setIsError] = useState(false);
  const setMessage = (text: string, error = false) => {
    setUndoMessageFor(null);
    setMessageText(text);
    setIsError(error);
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const [refocus, setRefocus] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  // Focus follows a to-do whose star moved it (`useStarFocus`).
  const rememberStar = useStarFocus(scrollRef, favs);

  // The global search chose a to-do (`revealTodo`): show its tab with no filters, hold its group open and
  // open it in the panel. The request is taken at once, so it happens once. It waits for the list to load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `setMessage` only sets state.
  useEffect(() => {
    if (!reveal || !todos) return;
    const key = reveal.todo.key;
    clearReveal();
    const inMine = todos.mine.some((t) => t.key === key);
    // A to-do that has gone since it was found has nothing to show.
    if (!inMine && !todos.open.some((t) => t.key === key)) return;
    setVisitSeen(new Set());
    setTabState(inMine ? 'mine' : 'open');
    setFilter(EMPTY_FILTER);
    setRevealed({ key, n: reveal.n });
    // The to-do opens in the panel, read first; closing it puts the keyboard back on the row.
    setMessage('');
    shellDispatch({ type: 'open-todo', key, mode: 'read' });
  }, [reveal, todos, clearReveal, shellDispatch]);

  // After the panel closes, put the keyboard back on the row's title button (or the Add button).
  useEffect(() => {
    if (refocus === null) return;
    if (refocus === '') (addButton.current ?? scrollRef.current)?.focus();
    else {
      const id = CSS.escape(refocus);
      const row =
        document.querySelector<HTMLElement>(`[data-panel-for="${id}"]`) ??
        document.querySelector<HTMLElement>(`[data-edit-for="${id}"]`);
      // The row may have left the list (passed on) or sit in a closed group: fall back to Add, then the list.
      (row ?? addButton.current ?? scrollRef.current)?.focus();
    }
    setRefocus(null);
  }, [refocus]);

  // A held change was sent and its row went: if the keyboard was on its Undo button, keep it in the drawer,
  // and drop a "You can undo this" line that is no longer true.
  // The same when its Undo turns into "Sending…".
  const heldCount = heldTodos.length;
  const sendingCount = heldTodos.filter((h) => h.sending).length;
  const lastHeld = useRef({ heldCount, sendingCount });
  useEffect(() => {
    const was = lastHeld.current;
    lastHeld.current = { heldCount, sendingCount };
    if (heldCount >= was.heldCount && sendingCount <= was.sendingCount) return;
    if (undoMessageFor !== null && !heldTodos.some((h) => h.todoId === undoMessageFor && !h.sending)) {
      setUndoMessageFor(null);
      setMessageText('');
    }
    if (document.activeElement === null || document.activeElement === document.body)
      (addButton.current ?? scrollRef.current)?.focus();
  }, [heldCount, sendingCount, heldTodos, undoMessageFor]);

  // The panel closed (a key press, the veil, Esc, a finished to-do): put the keyboard back on the row's button,
  // unless a held to-do's Undo took it.
  const openKey = panel === null ? undefined : (panel.key ?? '');
  const wasOpen = useRef<string | undefined>(undefined);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = openKey;
    if (was !== undefined && openKey === undefined && focusUndo !== was) setRefocus(was);
  }, [openKey, focusUndo]);

  if (!todos) return <p className="dock-empty">Loading your to-dos.</p>;
  const items = tab === 'mine' ? todos.mine : tab === 'open' ? todos.open : [];
  const me = boot?.identity.slug ?? '';
  const canChange = todos.changes === 'on';
  // Ticking off is the app's own switch; editing needs the `todo` skill as well.
  const canTick = boot?.prefs.directWrites === true;
  const heldById = new Map(heldTodos.map((h) => [h.todoId, h]));
  const clients = boot?.clients ?? [];
  const savedSeen = boot?.prefs.todoSeen ?? {};
  const seenMap = Object.fromEntries(Object.entries(savedSeen).filter(([k]) => !visitSeen.has(k)));

  // Filters (the text search is the global search's now). The kind filter belongs to Mine: everything open
  // to anyone is TDS.
  const showKind = tab === 'mine' && (todos.canUsePersonal || todos.mine.some((t) => t.scope === 'personal'));
  const clientSlugs = [...new Set(items.map((t) => t.client).filter((c): c is string => c !== null))];
  const showClient = clientSlugs.length >= 2;
  const active: TodoFilter = {
    scope: showKind ? filter.scope : 'all',
    client:
      showClient && filter.client !== null && clientSlugs.includes(filter.client) ? filter.client : null,
  };
  const filtering = filterActive(active);
  const shown = filterTodos(items, active, clients);
  // "New to you" is worked out over every row, so a starred new to-do keeps its dot and is marked seen when
  // opened. Then the starred ones go to Favourites, the only place they show; new ones not starred go to
  // "New to you"; the rest are grouped by date.
  const fresh = tab === 'mine' ? newToYou(shown, me, seenMap, new Date()) : [];
  const freshKeys = new Set(fresh.map((t) => t.key));
  const { favourites, rest } = splitFavouriteTodos(shown, favs);
  const freshRows = favourites.length > 0 ? fresh.filter((t) => !favs.includes(t.key)) : fresh;
  const groups = groupTodos(
    freshRows.length > 0 ? rest.filter((t) => !freshKeys.has(t.key)) : rest,
    todayIso(),
  );
  const showScope = tab === 'mine' && active.scope === 'all';
  // The group the global search sent us to stays open, whatever else is closed.
  const holdsRevealed = (list: TodoItem[]) => revealed !== null && list.some((t) => t.key === revealed.key);
  const revealN = revealed?.n ?? 0;
  const foldScope = `${tab}-${filtering}-${revealN}`;
  // A new tab, filtering or reveal starts every section at its default, and coming back doesn't bring old
  // choices back: they are dropped as soon as the scope changes (React's adjust-state-while-rendering pattern).
  if (foldChoice.scope !== foldScope) setFoldChoice({ scope: foldScope, open: {} });
  const chosen = foldChoice.scope === foldScope ? foldChoice.open : {};
  const setFold = (id: string, open: boolean) =>
    setFoldChoice((c) => ({
      scope: foldScope,
      open: { ...(c.scope === foldScope ? c.open : {}), [id]: open },
    }));
  // Favourites starts open, and so does the section under it ("New to you", else the top date group). While a
  // filter is on every section opens; the group the global search sent us to is held open.
  const foldOpen = (id: string, byDefault: boolean) => chosen[id] ?? byDefault;

  const onStar = (todo: TodoItem, button: HTMLElement) => {
    rememberStar(todo.key, button);
    // Open the section the to-do moves to, so focus can follow it there.
    const to = !favs.includes(todo.key)
      ? 'favourites'
      : freshKeys.has(todo.key)
        ? 'new'
        : groupTodos([todo], todayIso())[0]?.key;
    if (to) setFold(to, true);
    void toggleFavouriteTodo(todo.key);
  };

  const opened = (todo: TodoItem) => {
    if (tab === 'mine' && freshKeys.has(todo.key) && !visitSeen.has(todo.key)) {
      setVisitSeen(new Set(visitSeen).add(todo.key));
      markTodosSeen([todo]);
    }
  };
  const clearFilters = () => {
    setFilter(EMPTY_FILTER);
    // The button leaves with the "No to-dos match" panel: put the keyboard on a filter, now reset.
    const row = filtersRef.current;
    const filter =
      row?.querySelector<HTMLElement>('[role="combobox"]') ??
      row?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    (filter ?? scrollRef.current)?.focus();
  };

  const hold = (held: HeldTodo) => {
    holdTodo(held);
    setFocusUndo(held.todoId);
    setMessage(`${held.label}. You can undo this for ${TODO_UNDO_MS / 1000} seconds.`);
    setUndoMessageFor(held.todoId);
  };
  const undo = (held: HeldTodo) => {
    undoHeld(held.todoId);
    setFocusUndo(null);
    setMessage('Undone.');
    setRefocus(held.todoId);
  };

  const fieldsOf = (t: TodoItem) => ({
    title: t.title,
    details: detailsText(t, todos.canAttach),
    due: t.due ?? '',
    assignee: t.assignee ?? '',
    scope: t.scope,
  });
  /** A draft for editing `t`: the version it has now, and what it says now as the base to tell edits from. */
  const draftOf = (t: TodoItem): EditDraft => ({ ...fieldsOf(t), version: t.version, base: fieldsOf(t) });

  /** Opens the panel on a to-do, reading or editing. */
  const openPanel = (t: TodoItem, mode: 'read' | 'edit') => {
    // Unsaved changes in the panel: it asks first (and the press is dropped, so the draft is never swapped under it).
    if (panel?.dirty) return shellDispatch({ type: 'close-todo' });
    setMessage('');
    setDraft(draftOf(t));
    shellDispatch({ type: 'open-todo', key: t.key, mode });
  };
  /** Closes the panel without asking: a held change or a finished add has nothing left to lose. */
  const closePanelNow = () => shellDispatch({ type: 'close-todo', force: true });

  const toggleAdd = () => {
    setMessage('');
    if (adding) shellDispatch({ type: 'close-todo' });
    else shellDispatch({ type: 'open-todo', key: null, mode: 'add' });
  };

  const run = async (actions: TodoAction[]) => {
    setBusy(true);
    try {
      return await changeTodos(actions);
    } finally {
      setBusy(false);
    }
  };

  const add = async (action: TodoAction) => {
    const before = new Set([...todos.mine, ...todos.open].map((t) => t.key));
    const result = await run([action]);
    if (result.error) return setMessage(result.error.message, true);
    setMessage('Added.');
    // After adding one for yourself, the panel stays on it. With files available it opens in read view (the
    // details were written in the Add panel, and files are added from there); otherwise in edit mode so the
    // details can be written at once.
    const added = result.todos?.mine.find((t) => !before.has(t.key));
    if (added) {
      setDraft(draftOf(added));
      shellDispatch({
        type: 'open-todo',
        key: added.key,
        mode: result.todos?.canAttach ? 'read' : 'edit',
        force: true,
      });
      return;
    }
    closePanelNow();
    setRefocus('');
  };

  // The order previous and next walk through: what the drawer shows now, held rows left out.
  const order =
    tab === 'asked'
      ? askedOrder(asked)
      : [...favourites, ...freshRows, ...groups.flatMap((g) => g.items)]
          .map((t) => t.key)
          .filter((k) => !heldById.has(k));

  const panelTodo = panel?.key
    ? ([...todos.mine, ...todos.open].find((t) => t.key === panel.key) ?? null)
    : null;
  const panelAsked =
    panel?.key && asked ? ([...asked.waiting, ...asked.done].find((t) => t.key === panel.key) ?? null) : null;

  const rows: RowControls = {
    canEdit: canChange,
    openKey: panel?.key ?? null,
    busy,
    open: openPanel,
    actionable: canChange || canTick,
  };

  /** Saves what the panel's editor changed: title, details, date and where it is kept now; a pass-on is held. */
  const save = async (todo: TodoItem, actions: TodoAction[]): Promise<ChangeTodosResult> => {
    // Title, details, date and where it is kept are saved now (they can simply be edited again).
    // Passing the to-do on is held with an Undo, because it leaves this list and can't be edited
    // back from here.
    let passed = actions.find((a) => a.kind === 'assignee');
    const now = actions.filter((a) => a.kind !== 'assignee');
    const result: ChangeTodosResult = now.length > 0 ? await run(now) : { done: 0 };
    // A `move` may have given it a new key (and a new name, after a clash).
    const key = result.moved && result.moved.from === todo.key ? result.moved.to : todo.key;
    const all = result.todos ? [...result.todos.mine, ...result.todos.open] : [];
    if (result.error) {
      // Keep the editor and the draft untouched, but adopt the version now in the brain (a teammate's
      // change, or our own earlier steps), so pressing Save again is a deliberate overwrite.
      const fresh = all.find((t) => t.key === key);
      if (key !== todo.key) shellDispatch({ type: 'open-todo', key, mode: 'edit', force: true });
      if (result.error.code === 'changed') {
        if (fresh) setDraft((d) => rebase(d, fresh, true, todos.canAttach));
        setMessage(`${result.error.message} Your changes are still here.`, true);
        return result;
      }
      if (fresh) setDraft((d) => rebase(d, fresh, false, todos.canAttach));
      if (result.done > 0) {
        setMessage(
          'Some of your changes were saved, but not all. Your other changes are still here. Press Save to try again.',
          true,
        );
      } else setMessage(result.error.message, true);
      return result;
    }
    let finalKey = key;
    if (passed && now.length > 0) {
      // The pass-on is held and sent later: it checks against the version after this save's own steps.
      const latest = all.find((t) => t.key === key);
      if (!latest) {
        setMessage('This to-do is no longer in your list, so it was not passed on.', true);
        return {
          done: result.done,
          error: {
            code: 'not-found',
            message: 'This to-do is no longer in your list, so it was not passed on.',
          },
        };
      }
      finalKey = latest.key;
      passed = { ...passed, id: latest.id, expect: latest.version };
    }
    if (passed?.kind === 'assignee') {
      closePanelNow();
      const who = todos.team.find((m) => m.slug === passed.assignee)?.name;
      const label =
        passed.assignee === null
          ? 'Made open to anyone'
          : passed.assignee === me
            ? 'Assigned to you'
            : `Passed to ${who ?? passed.assignee}`;
      const title = actions.find((a) => a.kind === 'edit')?.title ?? todo.title;
      hold({
        todoId: finalKey,
        title,
        kind: 'assignee',
        label,
        action: passed,
      });
    } else {
      // Saved: back to reading it, on the key it has now.
      shellDispatch({ type: 'open-todo', key: finalKey, mode: 'read', force: true });
      setMessage('Saved.');
    }
    return { done: result.done + (passed ? 1 : 0) };
  };

  /** A tick box pressed while reading: one details change, through the same conflict check as Save. */
  const tick = async (todo: TodoItem, markdown: string) => {
    const actions = buildEditActions(todo, { ...draftOf(todo), details: markdown }, true, todos.canAttach);
    if (actions.length === 0) return;
    const result = await run(actions);
    if (result.error) return setMessage(result.error.message, true);
    setMessage('');
  };

  const finishPanel = {
    done: (todo: TodoItem) => {
      closePanelNow();
      hold({
        todoId: todo.key,
        title: todo.title,
        kind: 'tick',
        label: 'Marked as done',
        action: null,
        // A personal to-do is ticked through the brain script, which needs its scope and version.
        ...(todo.scope === 'personal'
          ? {
              tick: {
                id: todo.id,
                scope: todo.scope,
                expect: todo.version,
              },
            }
          : {}),
      });
    },
    remove: (todo: TodoItem) => {
      closePanelNow();
      hold({
        todoId: todo.key,
        title: todo.title,
        kind: 'delete',
        label: 'Deleted',
        // The version as shown when Delete was pressed.
        action: {
          kind: 'delete',
          id: todo.id,
          expect: todo.version,
          ...(todo.scope === 'personal' ? { scope: 'personal' as const } : {}),
        },
      });
    },
  };

  const row = (t: TodoItem, isFresh: boolean) => {
    const held = heldById.get(t.key);
    return held ? (
      <HeldRow key={t.key} held={held} focus={focusUndo === t.key} onUndo={() => undo(held)} />
    ) : (
      <TodoRow
        key={t.key}
        todo={t}
        // A personal to-do can't be changed when the gate is off (the server would refuse): read and chat only.
        controls={t.scope === 'personal' && !todos.canUsePersonal ? { ...rows, actionable: false } : rows}
        fresh={isFresh && !visitSeen.has(t.key)}
        showScope={showScope}
        onOpened={opened}
        favourite={favs.includes(t.key)}
        onStar={onStar}
      />
    );
  };

  // The tools sit on the drawer above the list: only the list scrolls.
  // With a filter row the + icon closes it at the right end. With none, a labelled button on a row of its
  // own, right-aligned to line up with that +. Both primary: adding is the drawer's main action.
  const hasFilterRow = showKind || showClient;
  const addToggle = canChange ? (
    hasFilterRow ? (
      <button
        type="button"
        className="icon-btn todo-add-btn"
        data-variant="primary"
        ref={addButton}
        aria-label="Add a to-do"
        aria-expanded={adding}
        onClick={toggleAdd}
      >
        <Icon name="plus" size={18} />
      </button>
    ) : (
      <button
        type="button"
        className="btn todo-add-label"
        data-variant="primary"
        data-size="small"
        ref={addButton}
        aria-expanded={adding}
        onClick={toggleAdd}
      >
        <Icon name="plus" size={14} />
        Add a to-do
      </button>
    )
  ) : null;

  return (
    <div className="drawer-split">
      <div className="drawer-tools">
        <Seg
          label="Which to-dos"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'mine', label: `Mine, ${todos.mine.length}` },
            { value: 'open', label: `Open, ${todos.open.length}` },
            { value: 'asked', label: asked ? `Asked, ${asked.waiting.length}` : 'Asked' },
          ]}
        />
      </div>
      {hasFilterRow || canChange ? (
        <div
          className="drawer-tools todo-filters"
          ref={filtersRef}
          data-stacked={showKind && showClient ? 'true' : undefined}
        >
          {showKind ? (
            <Seg<TodoFilter['scope']>
              label="Which kind of to-do"
              value={active.scope}
              onChange={(scope) => setFilter({ ...filter, scope })}
              options={[
                { value: 'all', label: 'All' },
                { value: 'tds', label: 'TDS' },
                { value: 'personal', label: 'Personal' },
              ]}
            />
          ) : null}
          {showClient ? (
            <>
              <label className="visually-hidden" htmlFor="todo-client">
                Client
              </label>
              <SearchSelect
                id="todo-client"
                className="todo-client-pick"
                value={active.client ?? ''}
                options={[
                  { value: '', label: 'All clients' },
                  ...clientSlugs.map((slug) => {
                    const known = clients.find((c) => c.slug === slug);
                    return {
                      value: slug,
                      label: known?.name ?? slug,
                      terms: [slug, ...(known?.aliases ?? [])],
                      group: 'Clients',
                    };
                  }),
                ]}
                recentKey="clients"
                onChange={(value) => setFilter({ ...filter, client: value || null })}
              />
            </>
          ) : null}
          {addToggle}
        </div>
      ) : null}
      {todos.changes === 'switched-off' ? (
        <p className="todo-note todo-off">
          Adding and editing to-dos is switched off. Turn on 'Let the app change to-dos' in{' '}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              // A floating drawer covers the sheet (and makes it inert): it makes way, as choosing a to-do does.
              if (modes.drawerOverlays) shellDispatch({ type: 'close-drawer' });
              openSettings('general', 'set-direct');
            }}
          >
            Settings
          </button>
          .
        </p>
      ) : null}
      <ResultsAnnouncer filtering={filtering} count={shown.length} />
      {/* With the panel open the status is said there (it may cover this drawer). */}
      <p className="todo-status" role="status" data-tone={isError ? 'error' : undefined}>
        {panel === null ? message : ''}
      </p>
      <div className="drawer-scroll" ref={scrollRef} tabIndex={-1}>
        <div className="drawer-body">
          {tab === 'asked' ? (
            <AskedList
              list={asked}
              state={askedState}
              onRetry={() => void loadAsked()}
              openKey={panel?.key ?? null}
              onOpen={(t) => {
                if (panel?.dirty) return shellDispatch({ type: 'close-todo' });
                setMessage('');
                shellDispatch({ type: 'open-todo', key: t.key, mode: 'read' });
              }}
            />
          ) : shown.length === 0 ? (
            filtering ? (
              <div className="dock-empty todo-nomatch">
                <p>No to-dos match.</p>
                <p>
                  <button type="button" className="btn" data-size="small" onClick={clearFilters}>
                    Clear filters
                  </button>
                </p>
              </div>
            ) : (
              <p className="dock-empty">
                {tab === 'mine' ? 'Nothing assigned to you.' : 'Nothing open to anyone.'}
              </p>
            )
          ) : (
            <>
              {favourites.length > 0 ? (
                <Fold
                  key="favourites"
                  title="Favourites"
                  count={favourites.length}
                  open={foldOpen('favourites', true)}
                  onToggle={(o) => setFold('favourites', o)}
                >
                  <ul className="drawer-list">{favourites.map((t) => row(t, freshKeys.has(t.key)))}</ul>
                </Fold>
              ) : null}
              {freshRows.length > 0 ? (
                <Fold
                  key="new"
                  title="New to you"
                  count={freshRows.length}
                  open={foldOpen('new', true)}
                  onToggle={(o) => setFold('new', o)}
                  action={
                    <button
                      type="button"
                      className="btn"
                      data-variant="quiet"
                      data-size="small"
                      onClick={() => {
                        // Starred new to-dos too, so no dot is left anywhere.
                        markTodosSeen(fresh);
                        setVisitSeen(new Set());
                        setMessage('Marked as seen.');
                        // The button leaves with its group: keep the keyboard in the drawer.
                        scrollRef.current?.focus();
                      }}
                    >
                      Mark all as seen
                    </button>
                  }
                >
                  <ul className="drawer-list">{freshRows.map((t) => row(t, true))}</ul>
                </Fold>
              ) : null}
              {groups.map((g, i) => (
                <Fold
                  // Only the top section starts open (below Favourites), so the list isn't overwhelming (Ian,
                  // 2026-11-13). Worked out on every render, so the new top group opens once "New to you" empties.
                  key={g.key}
                  title={g.title}
                  count={g.items.length}
                  open={foldOpen(
                    g.key,
                    filtering || (freshRows.length === 0 && i === 0) || holdsRevealed(g.items),
                  )}
                  onToggle={(o) => setFold(g.key, o)}
                >
                  <ul className="drawer-list">{g.items.map((t) => row(t, false))}</ul>
                </Fold>
              ))}
            </>
          )}
          {tab !== 'asked' && todos.othersCount > 0 ? (
            <p className="dock-empty">
              {todos.othersCount} more {todos.othersCount === 1 ? 'belongs' : 'belong'} to other people.
            </p>
          ) : null}
        </div>
      </div>
      {panel !== null ? (
        <PanelHost
          panel={panel}
          todo={panelTodo}
          asked={panelAsked}
          order={order}
          message={message}
          isError={isError}
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          canEdit={canChange}
          canTick={canTick}
          me={me}
          team={todos.team}
          canUsePersonal={todos.canUsePersonal}
          canAddOpen={todos.canAddOpen}
          canAttach={todos.canAttach}
          canUpload={todos.canUpload}
          onStatus={setMessage}
          startPersonal={tab === 'mine' && active.scope === 'personal'}
          onEdit={(t) => {
            setMessage('');
            setDraft(draftOf(t));
            shellDispatch({ type: 'set-todo-mode', mode: 'edit' });
          }}
          onCancelEdit={() => {
            setMessage('');
            shellDispatch({ type: 'set-todo-mode', mode: 'read' });
          }}
          onSave={save}
          onTick={tick}
          onDone={finishPanel.done}
          onDelete={finishPanel.remove}
          onAdd={(a) => void add(a)}
          onCancelAdd={() => {
            // A typed title asks first (the shell holds the close); the focus goes back when the panel shuts.
            setMessage('');
            shellDispatch({ type: 'close-todo' });
          }}
        />
      ) : null}
    </div>
  );
}
