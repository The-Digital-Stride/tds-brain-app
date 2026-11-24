import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type AskedTodo,
  type AskedTodoList,
  ATTENTION_LABEL,
  attentionFor,
  type DoneTodo,
  type TeamTodo,
  type TodoAction,
  type TodoItem,
} from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { dueInWords, isOverdue, todayIso } from '../format.ts';
import { chatForTodo } from '../state/attention.ts';
import { setChoice, useClientChoice, useProjectChoice } from '../state/client-choice.ts';
import {
  filterOptions,
  labelForKey,
  todoPlaceParts,
  todoProjectChip,
  useProjects,
} from '../state/projects.ts';
import { useTeamTodo } from '../state/team-todo.ts';
import { doneStore, filterDone, groupDone, searchDone, useDoneTodos } from '../state/todo-done.ts';
import { splitFavouriteTodos } from '../state/todo-favourites.ts';
import {
  EMPTY_FILTER,
  filterActive,
  filterAsked,
  filterTodos,
  todoProjectKey,
} from '../state/todo-filter.ts';
import { groupTodos } from '../state/todo-groups.ts';
import { newToYou } from '../state/todo-new.ts';
import { type ChangeTodosResult, type HeldTodo, useStore } from '../store.tsx';
import { AskedList, type AskedState, askedOrder } from './AskedList.tsx';
import type { TodoFilter, TodoPanelState } from './contract.ts';
import { DoneList, type DoneState, doneOrder } from './DoneList.tsx';
import { Fold } from './Fold.tsx';
import { Icon } from './Icon.tsx';
import { ProjectChip } from './ProjectChip.tsx';
import { SearchSelect } from './SearchSelect.tsx';
import { Seg } from './Seg.tsx';
import { useShell } from './ShellProvider.tsx';
import { NO_FAVOURITES, StarButton, useStarFocus } from './StarButton.tsx';
import { StateNote } from './StateNote.tsx';
import { TodoChatButton } from './TodoChatButton.tsx';
import { buildEditActions, detailsText, type EditDraft } from './TodoForms.tsx';
import type { TodoPanelProps } from './TodoPanel.tsx';
import { todoOpener } from './todo-opener.ts';
import { pressedByKeyboard, UNDO_MS, UndoLine } from './UndoLine.tsx';
import { cap, handoverMeta } from './words.ts';

// The panel, its editor and the converter load as one chunk the first time a to-do is opened (plan decision 19).
const TodoPanel = lazy(() => import('./TodoPanel.tsx'));

type Tab = 'mine' | 'open' | 'asked' | 'done';

/** What a row needs to open the panel: set by the drawer for every to-do (reading needs no permission). */
interface RowControls {
  /** May edit (changes are on): the row has an Edit button. Without it the title opens the read view. */
  canEdit: boolean;
  /** The keys of the open panel, to mark its row. */
  openKey: string | null;
  busy: boolean;
  open: (todo: TodoItem, mode: 'read' | 'edit') => void;
  /** Whether the person may do anything but read (change or tick off); with `canEdit`, shows the Edit button. */
  actionable: boolean;
}

type DraftFields = EditDraft['base'];

/** What the steps of a save that went through wrote, as draft fields (the title as sent, trimmed). */
function landedBy(steps: TodoAction[]): Partial<DraftFields> {
  const out: Partial<DraftFields> = {};
  for (const a of steps) {
    if (a.kind === 'edit') {
      out.title = a.title;
      if (a.details !== undefined) out.details = a.details;
    } else if (a.kind === 'due') out.due = a.due ?? '';
    else if (a.kind === 'move') out.scope = a.to;
  }
  return out;
}

/**
 * Moves a draft onto the version now in the brain: fields the person didn't touch take the fresh value,
 * fields they edited stay as typed. Functional, so text typed while a save was in flight survives. `landed`:
 * what the steps that did go through wrote. A field still as it was sent is saved, so it takes the fresh value
 * too: the script may have added to it (a title change adds "## Title history" to the details), and keeping
 * the typed text would drop that on the next Save.
 */
function rebase(
  d: EditDraft,
  fresh: TodoItem,
  conflict: boolean,
  canAttach: boolean,
  landed: Partial<DraftFields> = {},
): EditDraft {
  const now = {
    title: fresh.title,
    details: detailsText(fresh, canAttach),
    due: fresh.due ?? '',
    assignee: fresh.assignee ?? '',
    scope: fresh.scope,
  };
  const sent = <K extends keyof typeof now>(k: K) =>
    landed[k] !== undefined && (k === 'title' ? d.title.trim() : d[k]) === landed[k];
  const keep = <K extends keyof typeof now>(k: K) => (d[k] === d.base[k] || sent(k) ? now[k] : d[k]);
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

/** "Marked as done" → "marked as done": the label follows the title in the Undo line's sentence. */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * A to-do whose tick, delete or pass-on is waiting out its undo time: the shared Undo line in its place. Nothing
 * is in the brain yet. `focus` only after a keyboard press (plan 2026-11-22-ux-consistency, R1).
 */
function HeldRow({
  held,
  focus,
  onUndo,
  onPause,
  onResume,
}: {
  held: HeldTodo;
  focus: boolean;
  onUndo: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  return (
    <UndoLine
      as="row"
      text={`"${held.title}" ${lowerFirst(held.label)}.`}
      undoLabel={`Undo ${UNDO_VERB[held.kind]} "${held.title}"`}
      sending={held.sending === true}
      focusOnMount={focus}
      onUndo={onUndo}
      onPause={onPause}
      onResume={onResume}
    />
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
  onProject,
  showPlace = true,
}: {
  todo: TodoItem;
  controls: RowControls;
  /** Filters the drawer by a project; absent while a project filter is on, so the project shows as text. */
  onProject?: (key: string) => void;
  /** False while a project filter is on: every row is in that project, so the select already says it. */
  showPlace?: boolean;
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
  const { boot, sessions, activeChat, view } = useStore();
  // The chat button is named by its action and title; "New to you" and the details line describe it, so a keyboard or
  // screen-reader user who lands on it hears them too.
  const newId = useId();
  const metaId = useId();
  const whereId = useId();
  const { list: projectList } = useProjects();
  const chat = sessions ? chatForTodo(todo.key, sessions.live) : null;
  const attention = chat ? attentionFor(chat.state) : null;
  const current =
    chat !== null && view === 'chat' && activeChat.kind === 'live' && activeChat.sessionId === chat.id;
  const due = todo.due ? dueInWords(todo.due) : '';
  const overdue = todo.due ? isOverdue(todo.due) : false;

  const parts: { text: string; late?: boolean; icon?: 'lock'; dot?: string }[] = [];
  if (due) parts.push({ text: cap(due), late: overdue });
  const from = handoverMeta(todo, boot?.identity.slug ?? '');
  if (from) parts.push({ text: cap(from) });
  if (showScope && todo.scope === 'personal') parts.push({ text: 'Personal', icon: 'lock' });
  if (chat)
    parts.push({
      text: cap(`open chat${attention ? `, ${ATTENTION_LABEL[attention].toLowerCase()}` : ''}`),
      ...(attention ? { dot: attention } : {}),
    });
  // A known project is a chip that filters by it; anything else stays text. Either way it sits on the bottom line.
  const chip = onProject ? todoProjectChip(todo, projectList?.projects, boot?.clients ?? []) : null;
  const whereText =
    !chip && showPlace ? todoPlaceParts(todo, projectList?.projects, boot?.clients ?? []).join(' · ') : '';
  const hasWhere = Boolean(chip) || whereText !== '';
  const describedBy = [fresh ? newId : '', parts.length > 0 ? metaId : '', hasWhere ? whereId : '']
    .filter(Boolean)
    .join(' ');

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
            <span className="todo-title-text">{todo.title}</span>
          </button>
        </span>
      </div>
      <div className="todo-foot">
        {parts.length > 0 ? (
          <span className="line-meta todo-meta" id={metaId}>
            {parts.map((part, i) => (
              <span key={part.text} className="todo-meta-item">
                {i > 0 ? <span className="todo-sep"> · </span> : null}
                {part.dot ? <span className="dot" data-attention={part.dot} aria-hidden="true" /> : null}
                {part.icon ? (
                  <span className="todo-lock">
                    <Icon name={part.icon} size={12} />
                  </span>
                ) : null}
                <span className={part.late ? 'late' : undefined}>{part.text}</span>
              </span>
            ))}
          </span>
        ) : null}
        <div className="todo-end">
          {hasWhere ? (
            <span className="todo-where" id={whereId}>
              {chip && onProject ? (
                <ProjectChip label={chip.label} short={chip.short} onPick={() => onProject(chip.key)} />
              ) : (
                <span className="line-meta todo-where-text">{whereText}</span>
              )}
            </span>
          ) : null}
          <div className="todo-btns">
            {/* The star changes no to-do (it lives in the app's own settings), so it shows whether or not changes are on. */}
            <StarButton
              id={todo.key}
              title={todo.title}
              on={favourite}
              onPress={(_, button) => onStar(todo, button)}
            />
            {/* Edit only: someone who may only tick it off opens it from the title (three dots only ever open a
                menu, design system Actions rule 3). */}
            {controls.actionable && controls.canEdit ? (
              <button
                type="button"
                className="icon-btn todo-edit"
                data-edit-for={todo.key}
                aria-label={`Edit "${todo.title}"`}
                data-tip="Edit"
                // aria-disabled, not disabled: a disabled button drops focus to the page (Actions rule 12).
                aria-disabled={controls.busy || undefined}
                onClick={() => {
                  if (controls.busy) return;
                  onOpened(todo);
                  controls.open(todo, 'edit');
                }}
              >
                <Icon name="edit" size={16} />
              </button>
            ) : null}
            <TodoChatButton todo={todo} onOpened={() => onOpened(todo)} describedBy={describedBy} />
          </div>
        </div>
      </div>
    </li>
  );
}

/** Tells screen readers how many to-dos match, a moment after the person stops typing. Silent unless filtering. */
function ResultsAnnouncer({ filtering, count }: { filtering: boolean; count: number }) {
  const text = filtering
    ? count === 0
      ? 'No tasks match'
      : `${count} ${count === 1 ? 'task matches' : 'tasks match'}`
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

/** How long the panel waits for a to-do it was opened on to reach the drawer's lists before it closes. */
export const PANEL_WAIT_MS = 4000;

/** What `PanelHost` adds to the panel's own props: where it is open and what the drawer holds for it. */
type HostProps = Omit<
  TodoPanelProps,
  'todo' | 'asked' | 'done' | 'teamTodo' | 'mode' | 'dirtyAsk' | 'order'
> & {
  panel: TodoPanelState;
  todo: TodoItem | null;
  asked: AskedTodo | null;
  done: DoneTodo | null;
  /** The finished to-dos are still on their way (not loaded, no failure yet): a `done:` key waits for them. */
  doneLoading: boolean;
  /** A teammate's open to-do, loaded for a `team:` key. */
  teamTodo: TeamTodo | null;
  /** Its load is still on its way (no answer or failure yet): a `team:` key waits for it. */
  teamLoading: boolean;
  order: string[];
};

/**
 * Mounts the to-do panel beside the dock (`#todo-panel-slot` in App.tsx: the dock clips what is inside it) and
 * keeps the shell's list of what previous and next walk through. The controller (drafts, saves, holds) stays
 * in the drawer, which is why the panel is rendered from here and not from App.
 */
function PanelHost({
  panel,
  todo,
  asked,
  done,
  doneLoading,
  teamTodo,
  teamLoading,
  order,
  ...rest
}: HostProps) {
  const { dispatch } = useShell();
  const orderKey = order.join('\n');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `orderKey` stands for `order`.
  useEffect(() => {
    dispatch({ type: 'set-todo-order', order });
  }, [orderKey, dispatch]);
  // A to-do that has gone since it was opened (passed on, done by someone else) closes the panel; one that
  // has not shown up in the list yet (just added) is waited for, but only for PANEL_WAIT_MS: a key that never
  // shows up (a teammate's to-do, one already done) would otherwise leave an empty panel over a locked sheet.
  const seen = useRef<string | null>(null);
  // A teammate's to-do that has been passed to this person since it opened is theirs now: show it as their own.
  const passedToMe =
    panel.key?.startsWith('team:') === true && teamTodo !== null && teamTodo.assignee === rest.me;
  useEffect(() => {
    if (passedToMe && teamTodo) dispatch({ type: 'open-todo', key: teamTodo.id, mode: 'read', force: true });
  }, [passedToMe, teamTodo, dispatch]);
  useEffect(() => {
    if (panel.key === null) return;
    if (todo || asked || done || teamTodo) {
      seen.current = panel.key;
      return;
    }
    // A finished to-do is found in the shared done store: while that is still loading there is nothing to
    // give up on yet (it can be big, and may be slow).
    if (panel.key.startsWith('done:') && doneLoading) return;
    // A teammate's to-do loads on its own: wait for it however long it takes, and close the moment it is
    // known to be missing (finished or moved) or can't be read.
    if (panel.key.startsWith('team:')) {
      if (!teamLoading) dispatch({ type: 'close-todo', force: true });
      return;
    }
    if (seen.current === panel.key) {
      dispatch({ type: 'close-todo', force: true });
      return;
    }
    const giveUp = setTimeout(() => dispatch({ type: 'close-todo', force: true }), PANEL_WAIT_MS);
    return () => clearTimeout(giveUp);
  }, [panel.key, todo, asked, done, doneLoading, teamTodo, teamLoading, dispatch]);
  if (panel.mode !== 'add' && !todo && !asked && !done && !teamTodo) return null;
  const node = (
    <Suspense fallback={null}>
      <TodoPanel todo={todo} asked={asked} done={done} teamTodo={teamTodo} mode={panel.mode} {...rest} />
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
    view,
    heldTodos,
    holdTodo,
    undoHeld,
    pauseHeld,
    resumeHeld,
    markTodosSeen,
    reveal,
    clearReveal,
    doneReveal,
    clearDoneReveal,
    toggleFavouriteTodo,
  } = useStore();
  const pickedProject = useProjectChoice();
  const pickedClient = useClientChoice();
  const { list: projectCards, refresh: refreshProjects } = useProjects();
  /** Clears the app-wide picker's project (keeping its client): what the drawer's "Clear" and "Clear filters" do. */
  const clearPicked = () => setChoice({ client: pickedClient, project: '' });
  const favs = boot?.prefs.favouriteTodos ?? NO_FAVOURITES;
  // The held to-do whose Undo takes focus: only after a keyboard press. After a pointer press focus goes to the
  // neighbouring row's title (`afterHold`), so nothing holds the clock and the change is sent on time.
  const [focusUndo, setFocusUndo] = useState<string | null>(null);
  const afterHold = useRef<{ id: string; next: string | null } | null>(null);
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
  // The finished to-dos are one shared store: the Done tab or a `done:` panel key starts the first load.
  const panelIsDone = panel?.key?.startsWith('done:') === true;
  const doneSnap = useDoneTodos(tab === 'done' || panelIsDone);
  // A teammate's open to-do (`team:` key, from a project page) loads on its own, by key.
  const panelTeamKey = panel?.key?.startsWith('team:') === true ? panel.key : null;
  const teamSnap = useTeamTodo(panelTeamKey);
  const [doneQuery, setDoneQuery] = useState('');
  const searchId = useId();
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
    // The finished to-dos and teammates' to-dos refresh on the same signal in the store (StoreProvider).
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
    const mineItem = todos.mine.find((t) => t.key === key);
    const inMine = mineItem !== undefined;
    const item = mineItem ?? todos.open.find((t) => t.key === key);
    // A to-do that has gone since it was found has nothing to show.
    if (!item) return;
    setVisitSeen(new Set());
    setTabState(inMine ? 'mine' : 'open');
    setFilter(EMPTY_FILTER);
    // The to-do must show: a project held by the picker would hide it, but one it is in keeps the choice.
    if (pickedProject && todoProjectKey(item) !== pickedProject)
      setChoice({ client: pickedClient, project: '' });
    setRevealed({ key, n: reveal.n });
    // The to-do opens in the panel, read first; closing it puts the keyboard back on the row.
    setMessage('');
    shellDispatch({ type: 'open-todo', key, mode: 'read' });
  }, [reveal, todos, clearReveal, shellDispatch]);

  // A finished to-do was asked for (`revealDoneTodo`): show the Done tab with no filters or search and open it in
  // the panel. It waits for the shared store's list; a failed load drops the request. One the list doesn't hold
  // yet (ticked since it last loaded, while the drawer was closed) gets one refresh before it is given up.
  const doneRevealRefreshed = useRef<unknown>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `setMessage` only sets state.
  useEffect(() => {
    if (!doneReveal || !todos) return;
    doneStore.ensure();
    if (!doneSnap.list) {
      if (doneSnap.error) clearDoneReveal();
      return;
    }
    const key = doneReveal.key;
    const item = doneSnap.list.items.find((t) => t.key === key);
    if (!item) {
      if (doneSnap.loading) return;
      if (doneRevealRefreshed.current !== doneReveal) {
        doneRevealRefreshed.current = doneReveal;
        void doneStore.refresh();
        return;
      }
      // Still not there after a fresh load: it has gone (deleted, or moved back), so there is nothing to show.
      clearDoneReveal();
      return;
    }
    clearDoneReveal();
    setVisitSeen(new Set());
    setTabState('done');
    setFilter(EMPTY_FILTER);
    setDoneQuery('');
    if (pickedProject && todoProjectKey(item) !== pickedProject)
      setChoice({ client: pickedClient, project: '' });
    setMessage('');
    shellDispatch({ type: 'open-todo', key, mode: 'read' });
  }, [doneReveal, todos, doneSnap.list, doneSnap.error, doneSnap.loading, clearDoneReveal, shellDispatch]);

  // After the panel closes, put the keyboard back on the row's title button (or the Add button).
  useEffect(() => {
    if (refocus === null) return;
    // An add form a page opened (a project's Add a to-do) gives the keyboard back to that page's button.
    const opener = todoOpener.current;
    todoOpener.current = null;
    const after = afterHold.current;
    if (after !== null && after.id === refocus) {
      // Held after a pointer press: the neighbouring row's title, else the list (a row in a closed group can't
      // take focus).
      afterHold.current = null;
      const next = after.next
        ? document.querySelector<HTMLElement>(`[data-panel-for="${CSS.escape(after.next)}"]`)
        : null;
      (next && !next.closest('[hidden]') ? next : scrollRef.current)?.focus({ preventScroll: true });
    } else if (refocus === '') {
      const back = opener?.isConnected && opener.closest('[inert]') === null ? opener : null;
      (back ?? addButton.current ?? scrollRef.current)?.focus();
    } else {
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
  // Not when the Settings link closed it: the keyboard is going to the switch there.
  const openKey = panel === null ? undefined : (panel.key ?? '');
  const wasOpen = useRef<string | undefined>(undefined);
  const leavingForSettings = useRef(false);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = openKey;
    if (openKey !== undefined) return;
    const skip = leavingForSettings.current;
    leavingForSettings.current = false;
    if (was !== undefined && !skip && focusUndo !== was) setRefocus(was);
  }, [openKey, focusUndo]);

  // With no list (still loading, or the load failed) PanelHost isn't mounted, so its give-up timer can't run: a
  // panel opened from elsewhere (a project's To-dos tab) would leave the sheet locked under nothing. Same limit here.
  const waitingKey = !todos && panel && panel.mode !== 'add' ? panel.key : null;
  useEffect(() => {
    if (waitingKey === null) return;
    const giveUp = setTimeout(() => shellDispatch({ type: 'close-todo', force: true }), PANEL_WAIT_MS);
    return () => clearTimeout(giveUp);
  }, [waitingKey, shellDispatch]);

  if (!todos) return <StateNote kind="loading" />;
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
  // One project filter for every tab: the app-wide picker's project when it holds one (projects plan, decision 11;
  // it locks the drawer's Project select), else the drawer's own. A project names its client, so while one is on the
  // Client filter steps aside. Kind is Mine's alone: everything open to anyone, or asked of others, is TDS.
  const project = pickedProject || filter.project || null;
  const kindOnMine = todos.canUsePersonal || todos.mine.some((t) => t.scope === 'personal');
  const slugsOf = (list: readonly { client?: string | null }[]) => [
    ...new Set(list.map((t) => t.client ?? null).filter((c): c is string => c !== null)),
  ];
  const activeFor = (which: Tab, list: readonly { client?: string | null }[]): TodoFilter => {
    const slugs = slugsOf(list);
    return {
      scope: which === 'mine' && kindOnMine ? filter.scope : 'all',
      client:
        !project && slugs.length >= 2 && filter.client !== null && slugs.includes(filter.client)
          ? filter.client
          : null,
      project,
    };
  };
  const askedAll = asked ? [...asked.waiting, ...asked.done] : [];
  const doneAll = doneSnap.list?.items ?? null;
  const tabItems = tab === 'asked' ? askedAll : tab === 'done' ? (doneAll ?? []) : items;
  const showKind = tab === 'mine' && kindOnMine;
  const clientSlugs = slugsOf(tabItems);
  const showClient = !project && clientSlugs.length >= 2;
  const active = activeFor(tab, tabItems);
  const filtering = filterActive(active);
  const shown = filterTodos(items, active, clients);
  const askedActive = activeFor('asked', askedAll);
  const askedShown = asked
    ? {
        ...asked,
        waiting: filterAsked(asked.waiting, askedActive),
        done: filterAsked(asked.done, askedActive),
      }
    : null;
  const doneQueryText = doneQuery.trim();
  const doneShown = doneAll
    ? searchDone(filterDone(doneAll, active), doneQueryText, { clients, projects: projectCards?.projects })
    : null;
  const doneState: DoneState = doneSnap.error ? 'failed' : doneSnap.list ? 'loaded' : 'loading';
  const doneGroups = doneShown ? groupDone(doneShown, new Date()) : [];
  // The tab counts follow the filters, so a number always matches what its tab shows.
  const counts = {
    mine: filterTodos(todos.mine, activeFor('mine', todos.mine), clients).length,
    open: filterTodos(todos.open, activeFor('open', todos.open), clients).length,
    asked: askedShown ? askedShown.waiting.length : null,
  };
  const shownCount =
    tab === 'asked'
      ? askedShown
        ? askedShown.waiting.length + askedShown.done.length
        : 0
      : tab === 'done'
        ? (doneShown?.length ?? 0)
        : shown.length;
  /** The keyboard to the Project select; if it has gone (no projects listed), the first filter, else the list. */
  const focusProjectFilter = () => {
    const target =
      document.getElementById('todo-project') ??
      filtersRef.current?.querySelector<HTMLElement>(
        '[role="combobox"], [role="radio"][aria-checked="true"]',
      ) ??
      scrollRef.current;
    target?.focus();
  };
  /** Filters the drawer by a row's project; the chip goes with the filter, so the keyboard goes to the Project select. */
  const pickProject = (key: string) => {
    setFilter({ ...filter, project: key });
    requestAnimationFrame(focusProjectFilter);
  };
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
    if (pickedProject) clearPicked();
    // The button leaves with the "No to-dos match" panel: put the keyboard on a filter, now reset.
    const row = filtersRef.current;
    const filter =
      row?.querySelector<HTMLElement>('[role="combobox"]') ??
      row?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    (filter ?? scrollRef.current)?.focus();
  };

  /** Holds a change from the panel (which closes first; its close puts focus where `afterHold` says). */
  const hold = (held: HeldTodo) => {
    const keyboard = pressedByKeyboard();
    const id = held.todoId;
    const shownOrder = [...favourites, ...freshRows, ...groups.flatMap((g) => g.items)]
      .map((t) => t.key)
      .filter((k) => k === id || !heldById.has(k));
    const at = shownOrder.indexOf(id);
    holdTodo(held);
    if (keyboard) {
      afterHold.current = null;
      setFocusUndo(id);
    } else {
      afterHold.current = { id, next: at === -1 ? null : (shownOrder[at + 1] ?? shownOrder[at - 1] ?? null) };
      setFocusUndo(null);
    }
    setMessage(`${held.label}. You can undo this for ${UNDO_MS / 1000} seconds.`);
    setUndoMessageFor(id);
  };
  const undo = (held: HeldTodo) => {
    undoHeld(held.todoId);
    afterHold.current = null;
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
    // A to-do added to a project changes that project's count (and its page's list, which follows the count).
    if (action.kind === 'add' && action.project) void refreshProjects();
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
  const order = panelTeamKey
    ? [panelTeamKey]
    : tab === 'asked'
      ? askedOrder(askedShown)
      : tab === 'done'
        ? doneOrder(doneGroups)
        : [...favourites, ...freshRows, ...groups.flatMap((g) => g.items)]
            .map((t) => t.key)
            .filter((k) => !heldById.has(k));

  const panelTodo = panel?.key
    ? ([...todos.mine, ...todos.open].find((t) => t.key === panel.key) ?? null)
    : null;
  const panelDone =
    panel?.key && panelIsDone && doneAll ? (doneAll.find((t) => t.key === panel.key) ?? null) : null;
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
      const landed = landedBy(now.slice(0, result.done));
      if (key !== todo.key) shellDispatch({ type: 'open-todo', key, mode: 'edit', force: true });
      if (result.error.code === 'changed') {
        if (fresh) setDraft((d) => rebase(d, fresh, true, todos.canAttach, landed));
        setMessage(`${result.error.message} Your changes are still here.`, true);
        return result;
      }
      if (fresh) setDraft((d) => rebase(d, fresh, false, todos.canAttach, landed));
      if (result.done > 0) {
        setMessage(
          'Some of your changes were saved, but not all. Your other changes are still here. Press Save to try again.',
          true,
        );
      } else setMessage(`${result.error.message} Your changes are still here.`, true);
      return result;
    }
    let finalKey = key;
    if (passed && now.length > 0) {
      // The pass-on is held and sent later: it checks against the version after this save's own steps.
      const latest = all.find((t) => t.key === key);
      if (!latest) {
        setMessage('This task is no longer in your list, so it was not passed on.', true);
        return {
          done: result.done,
          error: {
            code: 'not-found',
            message: 'This task is no longer in your list, so it was not passed on.',
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
  const tick = async (todo: TodoItem, markdown: string): Promise<boolean> => {
    const actions = buildEditActions(todo, { ...draftOf(todo), details: markdown }, true, todos.canAttach);
    if (actions.length === 0) return true;
    // Said in the panel's status line, so a screen reader hears the tick go out and what became of it.
    setMessage('Saving your tick…');
    const result = await run(actions);
    if (result.error) {
      // The box clears again. A refusal that explains itself (someone else's change, a to-do gone) is said
      // in full; the others only need "try again".
      const { code, message } = result.error;
      const why =
        code === 'changed' || code === 'not-found' || code === 'not-allowed' ? message : 'Try again.';
      setMessage(`Your tick wasn't saved. ${why}`, true);
      return false;
    }
    setMessage('');
    return true;
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
      <HeldRow
        key={t.key}
        held={held}
        focus={focusUndo === t.key}
        onUndo={() => undo(held)}
        onPause={() => pauseHeld(held.todoId)}
        onResume={() => resumeHeld(held.todoId)}
      />
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
        onProject={project ? undefined : pickProject}
        showPlace={!project}
      />
    );
  };

  // The tools sit on the drawer above the list: only the list scrolls.
  // With a filter row the + icon closes it at the right end. With none, a labelled button on a row of its
  // own, right-aligned to line up with that +. Both primary: adding is the drawer's main action.
  const showProject = (projectCards?.projects.length ?? 0) > 0 || pickedProject !== '';
  const hasFilterRow = showKind || showClient || showProject;
  // What the drawer is narrowed to, for the Asked tab's empty lines: the project, else the client.
  const filterName = project
    ? (labelForKey(project, projectCards?.projects, clients) ?? project)
    : active.client
      ? (clients.find((c) => c.slug === active.client)?.name ?? active.client)
      : '';
  const addToggle = canChange ? (
    hasFilterRow ? (
      <button
        type="button"
        className="icon-btn todo-add-btn"
        data-variant="primary"
        ref={addButton}
        aria-label="Add a task"
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
        Add a task
      </button>
    )
  ) : null;

  return (
    <div className="drawer-split">
      <div className="drawer-tools todo-tabs">
        <Seg
          label="Which tasks"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'mine', label: `Mine, ${counts.mine}` },
            { value: 'open', label: `Open, ${counts.open}` },
            { value: 'asked', label: counts.asked !== null ? `Asked, ${counts.asked}` : 'Asked' },
            { value: 'done', label: 'Done' },
          ]}
        />
      </div>
      {tab === 'done' ? (
        <div className="drawer-tools">
          <Icon name="search" size={16} />
          <label className="visually-hidden" htmlFor={searchId}>
            Search done tasks
          </label>
          <input
            id={searchId}
            type="search"
            className="field"
            placeholder="Search done tasks"
            value={doneQuery}
            onChange={(e) => setDoneQuery(e.target.value)}
          />
        </div>
      ) : null}
      {hasFilterRow || canChange ? (
        <div
          className="drawer-tools todo-filters"
          ref={filtersRef}
          // The kind switch takes a line of its own whenever a select shares the row: three controls don't fit 296px.
          data-stacked={showKind && (showClient || showProject) ? 'true' : undefined}
        >
          {showKind ? (
            <Seg<TodoFilter['scope']>
              label="Which kind of task"
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
          {showProject ? (
            <>
              <label className="visually-hidden" htmlFor="todo-project">
                Project
              </label>
              <SearchSelect
                id="todo-project"
                className="todo-client-pick"
                value={active.project ?? ''}
                disabled={pickedProject !== ''}
                aria-describedby={pickedProject ? 'todo-project-why' : undefined}
                options={[
                  { value: '', label: 'All projects' },
                  ...filterOptions(projectCards?.projects ?? [], clients),
                ]}
                recentKey="projects"
                onChange={(value) => setFilter({ ...filter, project: value || null })}
              />
            </>
          ) : null}
          {addToggle}
          {pickedProject ? (
            // The locked select shows the project; this says why, and Clear hands it back to the drawer.
            // After the +, so the + keeps the end of the select's line and Tab runs select, +, Clear.
            <span className="todo-project-why" id="todo-project-why">
              Set by Working on (Home) ·{' '}
              <button
                type="button"
                className="btn"
                data-variant="quiet"
                data-size="small"
                onClick={() => {
                  clearPicked();
                  // The button goes with the reason: the keyboard moves to the Project select, now free.
                  requestAnimationFrame(focusProjectFilter);
                }}
              >
                Clear
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      {todos.changes === 'switched-off' && tab !== 'done' ? (
        <p className="todo-note todo-off">
          Adding and editing tasks is switched off. Turn on 'Let the app change tasks' in{' '}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              // A floating drawer covers the sheet (and makes it inert): it makes way, as choosing a to-do does.
              if (modes.drawerOverlays) shellDispatch({ type: 'close-drawer' });
              // Changing view closes an open to-do panel (ShellProvider); already on Settings, nothing changes, so
              // close it here (it asks first when it holds changes), or the switch stays behind it. Not when the
              // drawer floats: closing it already closes the panel, and a second question would replace the first.
              if (view === 'settings' && shell.todoPanel && !modes.drawerOverlays) {
                // Unsaved changes: it asks first and stays open, so the row keeps its usual focus return.
                leavingForSettings.current = !shell.todoPanel.dirty;
                shellDispatch({ type: 'close-todo' });
              }
              openSettings('general', 'set-direct');
            }}
          >
            Settings
          </button>
          .
        </p>
      ) : null}
      <ResultsAnnouncer
        filtering={filtering || (tab === 'done' && doneQueryText !== '')}
        count={shownCount}
      />
      {/* With the panel open the status is said there (it may cover this drawer). */}
      <p className="todo-status" role="status" data-tone={isError ? 'error' : undefined}>
        {panel === null ? message : ''}
      </p>
      <div className="drawer-scroll" ref={scrollRef} tabIndex={-1}>
        <div className="drawer-body">
          {tab === 'asked' && filtering && askedShown && shownCount === 0 && askedAll.length > 0 ? (
            <div className="dock-empty todo-nomatch">
              <p>None of the tasks you've asked of others are in {filterName || 'this filter'}.</p>
              <p>
                <button type="button" className="btn" data-size="small" onClick={clearFilters}>
                  Clear filters
                </button>
              </p>
            </div>
          ) : tab === 'asked' ? (
            <AskedList
              list={askedShown}
              filteredBy={filtering ? filterName || null : null}
              placeOf={(t) => {
                // Where it belongs, as on the other tabs: a known project is a chip, anything else words.
                const where = {
                  client: t.client ?? null,
                  project: t.project ?? null,
                  projectMatch: t.projectMatch,
                };
                const chip = todoProjectChip(where, projectCards?.projects, clients);
                // No words while a project filter is on: every row is in it, and the select says so once.
                return {
                  chip,
                  places: project ? [] : todoPlaceParts(where, projectCards?.projects, clients),
                };
              }}
              onProject={project ? undefined : pickProject}
              state={askedState}
              onRetry={() => void loadAsked()}
              openKey={panel?.key ?? null}
              onOpen={(t) => {
                if (panel?.dirty) return shellDispatch({ type: 'close-todo' });
                setMessage('');
                shellDispatch({ type: 'open-todo', key: t.key, mode: 'read' });
              }}
            />
          ) : tab === 'done' ? (
            <DoneList
              items={doneShown}
              historyRead={doneSnap.list?.historyRead ?? true}
              query={doneQueryText}
              filteredBy={filtering ? filterName || null : null}
              now={new Date()}
              placeOf={(t) => {
                const where = {
                  client: t.client ?? null,
                  project: t.project ?? null,
                  projectMatch: t.projectMatch,
                };
                const chip = todoProjectChip(where, projectCards?.projects, clients);
                return {
                  chip,
                  places: project ? [] : todoPlaceParts(where, projectCards?.projects, clients),
                };
              }}
              onProject={project ? undefined : pickProject}
              state={doneState}
              onRetry={() => void doneStore.refresh()}
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
                <p>No tasks match.</p>
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
          {/* It counts everyone's, filter or not: left out while filtering so the numbers don't disagree. */}
          {(tab === 'mine' || tab === 'open') && !filtering && todos.othersCount > 0 ? (
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
          done={panelDone}
          doneLoading={doneSnap.list === null && doneSnap.error === null}
          teamTodo={panelTeamKey ? teamSnap.item : null}
          teamLoading={teamSnap.loading || (teamSnap.item === null && teamSnap.error === null)}
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
          startProject={project ?? ''}
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
