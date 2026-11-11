import { ATTENTION_LABEL, attentionFor, type TodoItem } from '../../../shared/contract.ts';
import { dueInWords, isOverdue } from '../format.ts';
import { chatForTodo } from '../state/attention.ts';
import { useStore } from '../store.tsx';

function TodoRow({ todo, compact }: { todo: TodoItem; compact: boolean }) {
  const { boot, completeTodo, newChat, sessions, activeChat, openChat } = useStore();
  const chat = sessions ? chatForTodo(todo.id, sessions.live) : null;
  const attention = chat ? attentionFor(chat.state) : null;
  const current = chat !== null && activeChat.kind === 'live' && activeChat.sessionId === chat.id;
  const ticks = boot?.prefs.directWrites === true;
  const clientName = todo.client
    ? (boot?.clients.find((c) => c.slug === todo.client)?.name ?? todo.client)
    : null;
  const due = todo.due ? dueInWords(todo.due) : '';
  const overdue = todo.due ? isOverdue(todo.due) : false;
  return (
    <li
      className="row"
      data-compact={compact}
      data-attention={attention ?? undefined}
      data-current={current || undefined}
      aria-current={current ? 'true' : undefined}
    >
      {ticks ? (
        <input
          type="checkbox"
          className="todo-tick"
          aria-label={`Mark "${todo.title}" as done`}
          checked={false}
          onChange={() => void completeTodo(todo.id)}
        />
      ) : (
        <span className="todo-bullet" aria-hidden="true" />
      )}
      <div className="row-main">
        <div className="row-title">{todo.title}</div>
        <div className="meta">
          {due ? <span className={overdue ? 'overdue' : undefined}>{due}</span> : null}
          {clientName ? <span>{clientName}</span> : null}
          {attention ? (
            <span className="todo-state">
              <span className="attn-dot" data-attention={attention} aria-hidden="true" />
              {ATTENTION_LABEL[attention]}
            </span>
          ) : null}
        </div>
      </div>
      <div className="row-actions">
        {chat ? (
          <button
            type="button"
            className="btn"
            data-size="small"
            aria-label={`Open chat: ${todo.title}`}
            onClick={() => openChat(chat.id)}
          >
            Open chat
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            data-size="small"
            aria-label={`Start a chat on this: ${todo.title}`}
            onClick={() =>
              newChat({ draft: `Help me with this to-do: todo/${todo.id} (${todo.title})`, todoId: todo.id })
            }
          >
            Start a chat on this
          </button>
        )}
      </div>
    </li>
  );
}

function Group({ title, items, compact }: { title: string; items: TodoItem[]; compact: boolean }) {
  return (
    <section className="todo-group">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="meta">Nothing here.</p>
      ) : (
        <ul className="list">
          {items.map((t) => (
            <TodoRow key={t.id} todo={t} compact={compact} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Used by both the full To-dos view and the side panel. */
export function TodoLists({ compact }: { compact: boolean }) {
  const { todos } = useStore();
  if (!todos) return <p className="meta">Loading your to-dos.</p>;
  return (
    <>
      <Group title="Mine" items={todos.mine} compact={compact} />
      <Group title="Open to anyone" items={todos.open} compact={compact} />
      {todos.othersCount > 0 ? (
        <p className="meta">
          {todos.othersCount} more {todos.othersCount === 1 ? 'belongs' : 'belong'} to other people.
        </p>
      ) : null}
    </>
  );
}

export function TodosView() {
  return (
    <div className="page">
      <div>
        <h1>To-dos</h1>
        <p className="lede">Yours first, then the ones anyone can pick up.</p>
      </div>
      <TodoLists compact={false} />
    </div>
  );
}

export function TodoPanel() {
  const { boot, updatePrefs } = useStore();
  return (
    <aside className="todo-panel" aria-label="To-dos">
      <div className="panel-head">
        <h2>My to-dos</h2>
        <button
          type="button"
          className="btn"
          data-variant="quiet"
          data-size="small"
          onClick={() => void updatePrefs({ todoPanelOpen: false })}
          disabled={!boot}
        >
          Hide
        </button>
      </div>
      <div className="panel-body">
        <TodoLists compact={true} />
      </div>
    </aside>
  );
}
