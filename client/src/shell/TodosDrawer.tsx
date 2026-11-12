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
import { type ChangeTodosResult, useStore } from '../store.tsx';
import { Fold } from './Fold.tsx';
import { Icon } from './Icon.tsx';
import { Seg } from './Seg.tsx';
import { useShell } from './ShellProvider.tsx';
import { AddTodoForm, type EditDraft, TodoEditor } from './TodoForms.tsx';
import { todoChatDraft, todoPlaces } from './words.ts';

type Tab = 'mine' | 'open';

/** What the rows need to edit: set by the drawer only when changes are on. */
interface Editing {
  id: string | null;
  /** The open editor's fields. They live here so a row that moves group keeps what was typed. */
  draft: EditDraft;
  setDraft: (d: EditDraft) => void;
  busy: boolean;
  me: string;
  team: TeamMember[];
  open: (todo: TodoItem) => void;
  close: () => void;
  save: (todo: TodoItem, actions: TodoAction[]) => Promise<ChangeTodosResult>;
  remove: (todo: TodoItem) => Promise<void>;
}

function TodoRow({ todo, editing }: { todo: TodoItem; editing: Editing | null }) {
  const { boot, completeTodo, newChat, sessions, activeChat, openChat, view } = useStore();
  const { dispatch, modes } = useShell();
  const chat = sessions ? chatForTodo(todo.id, sessions.live) : null;
  const attention = chat ? attentionFor(chat.state) : null;
  const current =
    chat !== null && view === 'chat' && activeChat.kind === 'live' && activeChat.sessionId === chat.id;
  const ticks = boot?.prefs.directWrites === true;
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
        <TodoEditor
          draft={editing.draft}
          onDraft={editing.setDraft}
          todo={todo}
          me={editing.me}
          team={editing.team}
          busy={editing.busy}
          onSave={(actions) => editing.save(todo, actions)}
          onDelete={() => void editing.remove(todo)}
          onCancel={editing.close}
        />
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
      {ticks ? (
        <label className="tick-hit">
          <input
            type="checkbox"
            className="tick"
            aria-label={`Mark "${todo.title}" as done`}
            checked={false}
            onChange={() => void completeTodo(todo.id)}
          />
        </label>
      ) : (
        <span className="todo-bullet" aria-hidden="true" />
      )}
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
          aria-label={`Edit "${todo.title}"`}
          disabled={editing.busy}
          onClick={() => editing.open(todo)}
        >
          <Icon name="edit" size={16} />
        </button>
      ) : null}
    </li>
  );
}

export function TodosDrawer() {
  const { todos, boot, changeTodos, openView } = useStore();
  const [tab, setTab] = useState<Tab>('mine');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>({ title: '', details: '', due: '', assignee: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessageText] = useState('');
  const [isError, setIsError] = useState(false);
  const setMessage = (text: string, error = false) => {
    setMessageText(text);
    setIsError(error);
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const [refocus, setRefocus] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  // After the editor closes, put the keyboard back on the row's edit button (or the Add button).
  useEffect(() => {
    if (refocus === null) return;
    if (refocus === '') addButton.current?.focus();
    else {
      const pencil = document.querySelector<HTMLElement>(`[data-edit-for="${CSS.escape(refocus)}"]`);
      // The row may have left the list (passed on) or sit in a closed group: fall back to Add, then the list.
      (pencil ?? addButton.current ?? scrollRef.current)?.focus();
    }
    setRefocus(null);
  }, [refocus]);

  if (!todos) return <p className="dock-empty">Loading your to-dos.</p>;
  const items = tab === 'mine' ? todos.mine : todos.open;
  const groups = groupTodos(items, todayIso());
  const me = boot?.identity.slug ?? '';
  const canChange = todos.changes === 'on';

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

  const editing: Editing | null = canChange
    ? {
        id: editingId,
        draft,
        setDraft,
        busy,
        me,
        team: todos.team,
        open: (t) => {
          setAdding(false);
          setMessage('');
          setDraft({ title: t.title, details: t.details, due: t.due ?? '', assignee: t.assignee ?? '' });
          setEditingId(t.id);
        },
        close: () => {
          const id = editingId;
          setEditingId(null);
          setMessage('');
          setRefocus(id);
        },
        save: async (todo, actions) => {
          const result = await run(actions);
          if (result.error) {
            if (result.done > 0) {
              setMessage('Some changes were saved, but not all. Check the to-do and save again.', true);
            } else setMessage(result.error.message, true);
            return result;
          }
          const passed = actions.find((a) => a.kind === 'assignee');
          if (passed?.kind === 'assignee') {
            const who = todos.team.find((m) => m.slug === passed.assignee)?.name;
            setMessage(
              passed.assignee === null
                ? 'Now open to anyone.'
                : passed.assignee === me
                  ? 'Saved.'
                  : `Passed to ${who ?? passed.assignee}. It's on their list now.`,
            );
          } else setMessage('Saved.');
          setEditingId(null);
          setRefocus(todo.id);
          return result;
        },
        remove: async (todo) => {
          const result = await run([{ kind: 'delete', id: todo.id }]);
          if (result.error) return setMessage(result.error.message, true);
          setEditingId(null);
          setMessage('Deleted.');
          setRefocus('');
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
                  {g.items.map((t) => (
                    <TodoRow key={t.id} todo={t} editing={editing} />
                  ))}
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
