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
import { groupTodos } from '../state/todo-groups.ts';
import { type ChangeTodosResult, type HeldTodo, TODO_UNDO_MS, useStore } from '../store.tsx';
import { Fold } from './Fold.tsx';
import { Icon } from './Icon.tsx';
import { Seg } from './Seg.tsx';
import { useShell } from './ShellProvider.tsx';
import { AddTodoForm, type EditDraft, TodoDonePanel, TodoEditor } from './TodoForms.tsx';
import { todoChatDraft, todoPlaces } from './words.ts';

type Tab = 'mine' | 'open';

/** What the rows need to edit: set by the drawer only when changes are on. */
interface Editing {
  id: string | null;
  /** The open editor's fields. They live here so a row that moves group keeps what was typed. */
  draft: EditDraft;
  setDraft: (d: EditDraft) => void;
  /** False for someone who may only tick to-dos off: opening one shows just "Mark as done". */
  canEdit: boolean;
  busy: boolean;
  me: string;
  team: TeamMember[];
  open: (todo: TodoItem) => void;
  close: () => void;
  save: (todo: TodoItem, actions: TodoAction[]) => Promise<ChangeTodosResult>;
  remove: (todo: TodoItem) => Promise<void>;
  done: (todo: TodoItem) => void;
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

function TodoRow({ todo, editing }: { todo: TodoItem; editing: Editing | null }) {
  const { boot, newChat, sessions, activeChat, openChat, view } = useStore();
  const { dispatch, modes } = useShell();
  const chat = sessions ? chatForTodo(todo.id, sessions.live) : null;
  const attention = chat ? attentionFor(chat.state) : null;
  const current =
    chat !== null && view === 'chat' && activeChat.kind === 'live' && activeChat.sessionId === chat.id;
  const due = todo.due ? dueInWords(todo.due) : '';
  const overdue = todo.due ? isOverdue(todo.due) : false;

  const parts: { text: string; late?: boolean }[] = [];
  if (due) parts.push({ text: due, late: overdue });
  for (const text of todoPlaces(todo, boot?.clients ?? [])) parts.push({ text });
  if (chat)
    parts.push({ text: `open chat${attention ? `, ${ATTENTION_LABEL[attention].toLowerCase()}` : ''}` });

  const choose = () => {
    if (chat) openChat(chat.id);
    else newChat({ draft: todoChatDraft(todo), todoId: todo.id });
    if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
  };

  if (editing && editing.id === todo.id) {
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
      <button type="button" className="todo-main" onClick={choose}>
        <span className="line-text">
          <span className="line-title">
            <span className="visually-hidden">{chat ? 'Open chat:' : 'Start a chat on this:'}</span>{' '}
            {todo.title}
          </span>{' '}
          <span className="line-meta">
            {parts.map((part, i) => (
              <span key={part.text}>
                {i > 0 ? ', ' : ''}
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
          data-edit-for={todo.id}
          aria-label={editing.canEdit ? `Edit "${todo.title}"` : `Options for "${todo.title}"`}
          disabled={editing.busy}
          onClick={() => editing.open(todo)}
        >
          <Icon name={editing.canEdit ? 'edit' : 'more'} size={16} />
        </button>
      ) : null}
    </li>
  );
}

export function TodosDrawer() {
  const { todos, boot, changeTodos, openView, heldTodos, holdTodo, undoHeld } = useStore();
  const [focusUndo, setFocusUndo] = useState<string | null>(null);
  // The to-do the status line's "You can undo this" is about, so it can be cleared once that's sent.
  const [undoMessageFor, setUndoMessageFor] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('mine');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>({
    title: '',
    details: '',
    due: '',
    assignee: '',
    version: '',
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
  const groups = groupTodos(items, todayIso());
  const me = boot?.identity.slug ?? '';
  const canChange = todos.changes === 'on';
  // Ticking off is the app's own switch; editing needs the `todo` skill as well.
  const canTick = boot?.prefs.directWrites === true;
  const heldById = new Map(heldTodos.map((h) => [h.todoId, h]));

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
          draft,
          setDraft,
          busy,
          me,
          team: todos.team,
          open: (t) => {
            setAdding(false);
            setMessage('');
            setDraft({
              title: t.title,
              details: t.details,
              due: t.due ?? '',
              assignee: t.assignee ?? '',
              version: t.version,
            });
            setEditingId(t.id);
          },
          close: () => {
            const id = editingId;
            setEditingId(null);
            setMessage('');
            setRefocus(id);
          },
          save: async (todo, actions) => {
            // Title, details and date are saved now (they can simply be edited again). Passing the to-do
            // on is held with an Undo, because it leaves this list and can't be edited back from here.
            let passed = actions.find((a) => a.kind === 'assignee');
            const now = actions.filter((a) => a.kind !== 'assignee');
            const result: ChangeTodosResult = now.length > 0 ? await run(now) : { done: 0 };
            if (result.error) {
              // Keep the editor and the draft untouched, but adopt the version now in the brain (a teammate's
              // change, or our own earlier steps), so pressing Save again is a deliberate overwrite.
              const fresh = result.todos
                ? [...result.todos.mine, ...result.todos.open].find((t) => t.id === todo.id)
                : undefined;
              if (fresh) setDraft({ ...draft, version: fresh.version });
              if (result.error.code === 'changed') {
                setMessage(result.error.message, true);
                return result;
              }
              if (result.done > 0) {
                setMessage('Some changes were saved, but not all. Check the to-do and save again.', true);
              } else setMessage(result.error.message, true);
              return result;
            }
            if (passed && now.length > 0) {
              // The pass-on is held and sent later: it checks against the version after this save's own steps.
              const version = result.todos?.mine
                .concat(result.todos.open)
                .find((t) => t.id === todo.id)?.version;
              if (!version) {
                setMessage('This to-do is no longer in your list, so it was not passed on.', true);
                return {
                  done: result.done,
                  error: {
                    code: 'not-found',
                    message: 'This to-do is no longer in your list, so it was not passed on.',
                  },
                };
              }
              passed = { ...passed, expect: version };
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
              hold({ todoId: todo.id, title, kind: 'assignee', label, action: passed });
            } else {
              setMessage('Saved.');
              setRefocus(todo.id);
            }
            return { done: result.done + (passed ? 1 : 0) };
          },
          done: (todo) => {
            setEditingId(null);
            hold({ todoId: todo.id, title: todo.title, kind: 'tick', label: 'Marked as done', action: null });
          },
          remove: async (todo) => {
            setEditingId(null);
            hold({
              todoId: todo.id,
              title: todo.title,
              kind: 'delete',
              label: 'Deleted',
              // The version as shown when Delete was pressed.
              action: { kind: 'delete', id: todo.id, expect: todo.version },
            });
          },
        }
      : null;
  // The switch filters the list, so it sits on the drawer above it: only the list scrolls.
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
      {canChange ? (
        <div className="drawer-tools todo-add">
          {adding ? (
            <AddTodoForm
              me={me}
              team={todos.team}
              busy={busy}
              canAddOpen={todos.canAddOpen}
              onAdd={(a) => void add(a)}
              onCancel={() => {
                setAdding(false);
                setMessage('');
                setRefocus('');
              }}
            />
          ) : (
            <button
              type="button"
              className="btn todo-add-btn"
              ref={addButton}
              onClick={() => {
                setEditingId(null);
                setMessage('');
                setAdding(true);
              }}
            >
              Add a to-do
            </button>
          )}
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
      <p className="todo-status" role="status" data-tone={isError ? 'error' : undefined}>
        {message}
      </p>
      <div className="drawer-scroll" ref={scrollRef} tabIndex={-1}>
        <div className="drawer-body">
          {groups.length === 0 ? (
            <p className="dock-empty">
              {tab === 'mine' ? 'Nothing assigned to you.' : 'Nothing open to anyone.'}
            </p>
          ) : (
            groups.map((g) => (
              <Fold
                key={`${tab}-${g.key}`}
                title={g.title}
                count={g.items.length}
                defaultOpen={g.key !== 'none'}
              >
                <ul className="drawer-list">
                  {g.items.map((t) => {
                    const held = heldById.get(t.id);
                    return held ? (
                      <HeldRow key={t.id} held={held} focus={focusUndo === t.id} onUndo={() => undo(held)} />
                    ) : (
                      <TodoRow key={t.id} todo={t} editing={editing} />
                    );
                  })}
                </ul>
              </Fold>
            ))
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
