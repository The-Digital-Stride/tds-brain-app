import { useEffect, useRef, useState } from 'react';
import {
  ATTENTION_LABEL,
  attentionFor,
  type TeamMember,
  type TodoAction,
  type TodoItem,
} from '../../../shared/contract.ts';
import { dueInWords, isOverdue, todayIso } from '../format.ts';
import { chatForTodo } from '../state/attention.ts';
import { todoChatClient } from '../state/client-choice.ts';
import { EMPTY_FILTER, filterActive, filterTodos } from '../state/todo-filter.ts';
import { groupTodos } from '../state/todo-groups.ts';
import { newToYou } from '../state/todo-new.ts';
import { type ChangeTodosResult, type HeldTodo, TODO_UNDO_MS, useStore } from '../store.tsx';
import type { TodoFilter } from './contract.ts';
import { Fold } from './Fold.tsx';
import { Icon } from './Icon.tsx';
import { Seg } from './Seg.tsx';
import { useShell } from './ShellProvider.tsx';
import { AddTodoForm, type EditDraft, TodoDonePanel, TodoEditor } from './TodoForms.tsx';
import { handoverMeta, todoChatDraft, todoPlaces } from './words.ts';

type Tab = 'mine' | 'open';

/** What the rows need to edit: set by the drawer only when changes are on. */
interface Editing {
  /** The open editor's to-do, by `key`. */
  id: string | null;
  /** The open editor's fields. They live here so a row that moves group keeps what was typed. */
  draft: EditDraft;
  setDraft: (d: EditDraft) => void;
  /** False for someone who may only tick to-dos off: opening one shows just "Mark as done". */
  canEdit: boolean;
  /** TodoList.canUsePersonal: shows the TDS / Personal switch in the editor. */
  canUsePersonal: boolean;
  busy: boolean;
  me: string;
  team: TeamMember[];
  open: (todo: TodoItem) => void;
  close: () => void;
  save: (todo: TodoItem, actions: TodoAction[]) => Promise<ChangeTodosResult>;
  remove: (todo: TodoItem) => Promise<void>;
  done: (todo: TodoItem) => void;
}

/**
 * Moves a draft onto the version now in the brain: fields the person didn't touch take the fresh value,
 * fields they edited stay as typed. Functional, so text typed while a save was in flight survives.
 */
function rebase(d: EditDraft, fresh: TodoItem, conflict: boolean): EditDraft {
  const now = {
    title: fresh.title,
    details: fresh.details,
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
  editing,
  fresh,
  showScope,
  onOpened,
}: {
  todo: TodoItem;
  editing: Editing | null;
  /** In "New to you": a dot, and opening it marks it seen. */
  fresh: boolean;
  /** The scope filter is All: a personal row says so. */
  showScope: boolean;
  /** The row was opened (chat or editor): "New to you" marks it seen. */
  onOpened: (todo: TodoItem) => void;
}) {
  const { boot, newChat, sessions, activeChat, openChat, view } = useStore();
  const { dispatch, modes } = useShell();
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
    onOpened(todo);
    if (chat) openChat(chat.id);
    else {
      const client = todoChatClient(todo, boot?.clients ?? []);
      newChat({ draft: todoChatDraft(todo), todoId: todo.key, ...(client !== undefined ? { client } : {}) });
    }
    if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
  };

  if (editing && editing.id === todo.key) {
    return (
      <li className="todo todo-editing">
        {editing.canEdit ? (
          <TodoEditor
            draft={editing.draft}
            onDraft={editing.setDraft}
            todo={todo}
            me={editing.me}
            team={editing.team}
            busy={editing.busy}
            canUsePersonal={editing.canUsePersonal}
            onSave={(actions) => editing.save(todo, actions)}
            onDone={() => editing.done(todo)}
            onDelete={() => void editing.remove(todo)}
            onCancel={editing.close}
          />
        ) : (
          <TodoDonePanel todo={todo} onDone={() => editing.done(todo)} onCancel={editing.close} />
        )}
      </li>
    );
  }

  return (
    <li
      className="todo"
      data-editable={editing ? 'true' : undefined}
      data-attention={attention ?? undefined}
      aria-current={current ? 'true' : undefined}
    >
      <button type="button" className="todo-main" data-todo-open={todo.key} onClick={choose}>
        {fresh ? <span className="dot todo-new" data-new="true" aria-hidden="true" /> : null}
        <span className="line-text">
          <span className="line-title">
            <span className="visually-hidden">
              {fresh ? 'New to you. ' : ''}
              {chat ? 'Open chat:' : 'Start a chat on this:'}
            </span>{' '}
            {todo.title}
          </span>{' '}
          <span className="line-meta">
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
        </span>
        <span className="go" aria-hidden="true">
          <Icon name="go" size={16} />
        </span>
      </button>
      {editing ? (
        <button
          type="button"
          className="icon-btn todo-edit"
          data-edit-for={todo.key}
          aria-label={editing.canEdit ? `Edit "${todo.title}"` : `Options for "${todo.title}"`}
          disabled={editing.busy}
          onClick={() => {
            onOpened(todo);
            editing.open(todo);
          }}
        >
          <Icon name={editing.canEdit ? 'edit' : 'more'} size={16} />
        </button>
      ) : null}
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

export function TodosDrawer() {
  const {
    todos,
    boot,
    changeTodos,
    openView,
    heldTodos,
    holdTodo,
    undoHeld,
    markTodosSeen,
    reveal,
    clearReveal,
  } = useStore();
  const [focusUndo, setFocusUndo] = useState<string | null>(null);
  // The to-do the status line's "You can undo this" is about, so it can be cleared once that's sent.
  const [undoMessageFor, setUndoMessageFor] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>('mine');
  // To-dos opened this visit: they stay in "New to you" (without the dot) until the tab changes, so a row
  // doesn't jump away under the person's hands.
  const [visitSeen, setVisitSeen] = useState<ReadonlySet<string>>(new Set());
  // A to-do the global search sent us to: its group is held open, and its row takes focus once it shows.
  // `n` counts requests, so asking again remounts the groups (a group closed by hand opens again).
  const [revealed, setRevealed] = useState<{ key: string; n: number } | null>(null);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const setTab = (t: Tab) => {
    setVisitSeen(new Set());
    setRevealed(null);
    setTabState(t);
  };
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  // The global search chose a to-do (`revealTodo`): show its tab with no filters, hold its group open and
  // focus its row. The request is taken at once, so it happens once. It waits for the list to load.
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
    setAdding(false);
    setEditingId(null);
    setRevealed({ key, n: reveal.n });
    setFocusRow(key);
  }, [reveal, todos, clearReveal]);

  // The row exists only after the render that opened its group, hence a second step.
  useEffect(() => {
    if (focusRow === null) return;
    const row = document.querySelector<HTMLElement>(`[data-todo-open="${CSS.escape(focusRow)}"]`);
    if (row) {
      row.focus();
      row.scrollIntoView?.({ block: 'nearest' });
    } else scrollRef.current?.focus();
    setFocusRow(null);
  }, [focusRow]);

  // After the editor closes, put the keyboard back on the row's edit button (or the Add button).
  useEffect(() => {
    if (refocus === null) return;
    if (refocus === '') (addButton.current ?? scrollRef.current)?.focus();
    else {
      const id = CSS.escape(refocus);
      const row = document.querySelector<HTMLElement>(`[data-edit-for="${id}"]`);
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

  if (!todos) return <p className="dock-empty">Loading your to-dos.</p>;
  const items = tab === 'mine' ? todos.mine : todos.open;
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
  const fresh = tab === 'mine' ? newToYou(shown, me, seenMap, new Date()) : [];
  const freshKeys = new Set(fresh.map((t) => t.key));
  const groups = groupTodos(
    fresh.length > 0 ? shown.filter((t) => !freshKeys.has(t.key)) : shown,
    todayIso(),
  );
  const showScope = tab === 'mine' && active.scope === 'all';
  // The group the global search sent us to stays open, whatever else is closed.
  const holdsRevealed = (list: TodoItem[]) => revealed !== null && list.some((t) => t.key === revealed.key);
  const revealN = revealed?.n ?? 0;

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
      row?.querySelector<HTMLElement>('select') ??
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

  const toggleAdd = () => {
    if (adding) {
      setAdding(false);
      setMessage('');
      return;
    }
    setEditingId(null);
    setMessage('');
    setAdding(true);
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
    const result = await run([action]);
    if (result.error) return setMessage(result.error.message, true);
    setAdding(false);
    setMessage('Added.');
    setRefocus('');
  };

  const editing: Editing | null =
    canChange || canTick
      ? {
          id: editingId,
          canEdit: canChange,
          canUsePersonal: todos.canUsePersonal,
          draft,
          setDraft,
          busy,
          me,
          team: todos.team,
          open: (t) => {
            setAdding(false);
            setMessage('');
            const fields = {
              title: t.title,
              details: t.details,
              due: t.due ?? '',
              assignee: t.assignee ?? '',
              scope: t.scope,
            };
            setDraft({ ...fields, version: t.version, base: fields });
            setEditingId(t.key);
          },
          close: () => {
            const id = editingId;
            setEditingId(null);
            setMessage('');
            setRefocus(id);
          },
          save: async (todo, actions) => {
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
              if (key !== todo.key) setEditingId(key);
              if (result.error.code === 'changed') {
                if (fresh) setDraft((d) => rebase(d, fresh, true));
                setMessage(`${result.error.message} Your changes are still here.`, true);
                return result;
              }
              if (fresh) setDraft((d) => rebase(d, fresh, false));
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
            setEditingId(null);
            if (passed?.kind === 'assignee') {
              const who = todos.team.find((m) => m.slug === passed.assignee)?.name;
              const label =
                passed.assignee === null
                  ? 'Made open to anyone'
                  : passed.assignee === me
                    ? 'Assigned to you'
                    : `Passed to ${who ?? passed.assignee}`;
              const title = actions.find((a) => a.kind === 'edit')?.title ?? todo.title;
              hold({ todoId: finalKey, title, kind: 'assignee', label, action: passed });
            } else {
              setMessage('Saved.');
              setRefocus(finalKey);
            }
            return { done: result.done + (passed ? 1 : 0) };
          },
          done: (todo) => {
            setEditingId(null);
            hold({
              todoId: todo.key,
              title: todo.title,
              kind: 'tick',
              label: 'Marked as done',
              action: null,
              // A personal to-do is ticked through the brain script, which needs its scope and version.
              ...(todo.scope === 'personal'
                ? { tick: { id: todo.id, scope: todo.scope, expect: todo.version } }
                : {}),
            });
          },
          remove: async (todo) => {
            setEditingId(null);
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
        }
      : null;

  const row = (t: TodoItem, isFresh: boolean) => {
    const held = heldById.get(t.key);
    return held ? (
      <HeldRow key={t.key} held={held} focus={focusUndo === t.key} onUndo={() => undo(held)} />
    ) : (
      <TodoRow
        key={t.key}
        todo={t}
        // A personal to-do can't be changed when the gate is off (the server would refuse): chat only.
        editing={t.scope === 'personal' && !todos.canUsePersonal ? null : editing}
        fresh={isFresh && !visitSeen.has(t.key)}
        showScope={showScope}
        onOpened={opened}
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
            { value: 'open', label: `Open to anyone, ${todos.open.length}` },
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
              <select
                id="todo-client"
                className="field"
                value={active.client ?? ''}
                onChange={(e) => setFilter({ ...filter, client: e.target.value || null })}
              >
                <option value="">All clients</option>
                {clientSlugs.map((slug) => (
                  <option key={slug} value={slug}>
                    {clients.find((c) => c.slug === slug)?.name ?? slug}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {addToggle}
        </div>
      ) : null}
      {canChange && adding ? (
        <div className="drawer-tools todo-add">
          <AddTodoForm
            me={me}
            team={todos.team}
            busy={busy}
            canAddOpen={todos.canAddOpen}
            canUsePersonal={todos.canUsePersonal}
            startPersonal={tab === 'mine' && active.scope === 'personal'}
            onAdd={(a) => void add(a)}
            onCancel={() => {
              setAdding(false);
              setMessage('');
              setRefocus('');
            }}
          />
        </div>
      ) : null}
      {todos.changes === 'switched-off' ? (
        <p className="todo-note todo-off">
          Adding and editing to-dos is switched off. Turn on 'Let the app change to-dos' in{' '}
          <button type="button" className="link-btn" onClick={() => openView('settings')}>
            Settings
          </button>
          .
        </p>
      ) : null}
      <ResultsAnnouncer filtering={filtering} count={shown.length} />
      <p className="todo-status" role="status" data-tone={isError ? 'error' : undefined}>
        {message}
      </p>
      <div className="drawer-scroll" ref={scrollRef} tabIndex={-1}>
        <div className="drawer-body">
          {shown.length === 0 ? (
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
              {fresh.length > 0 ? (
                <Fold
                  key={`${tab}-new-${filtering}-${revealN}`}
                  title="New to you"
                  count={fresh.length}
                  action={
                    <button
                      type="button"
                      className="btn"
                      data-variant="quiet"
                      data-size="small"
                      onClick={() => {
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
                  <ul className="drawer-list">{fresh.map((t) => row(t, true))}</ul>
                </Fold>
              ) : null}
              {groups.map((g, i) => (
                <Fold
                  // Only the top section starts open ("New to you" when there is one), so the list isn't
                  // overwhelming (Ian, 2026-11-13). While a filter is on, every group opens. The key
                  // remounts a group when either changes, so the new top group opens once "New to you" empties.
                  key={`${tab}-${g.key}-${filtering}-${fresh.length === 0 && i === 0}-${holdsRevealed(g.items)}-${revealN}`}
                  title={g.title}
                  count={g.items.length}
                  defaultOpen={filtering || (fresh.length === 0 && i === 0) || holdsRevealed(g.items)}
                >
                  <ul className="drawer-list">{g.items.map((t) => row(t, false))}</ul>
                </Fold>
              ))}
            </>
          )}
          {todos.othersCount > 0 ? (
            <p className="dock-empty">
              {todos.othersCount} more {todos.othersCount === 1 ? 'belongs' : 'belong'} to other people.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
