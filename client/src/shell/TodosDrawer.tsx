import { useState } from 'react';
import { ATTENTION_LABEL, attentionFor, type TodoItem } from '../../../shared/contract.ts';
import { dueInWords, isOverdue, todayIso } from '../format.ts';
import { chatForTodo } from '../state/attention.ts';
import { groupTodos } from '../state/todo-groups.ts';
import { useStore } from '../store.tsx';
import { Fold } from './Fold.tsx';
import { Icon } from './Icon.tsx';
import { Seg } from './Seg.tsx';
import { useShell } from './ShellProvider.tsx';
import { todoChatDraft, todoPlaces } from './words.ts';

type Tab = 'mine' | 'open';

function TodoRow({ todo }: { todo: TodoItem }) {
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

  return (
    <li className="todo" data-attention={attention ?? undefined} aria-current={current ? 'true' : undefined}>
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
    </li>
  );
}

export function TodosDrawer() {
  const { todos } = useStore();
  const [tab, setTab] = useState<Tab>('mine');
  if (!todos) return <p className="dock-empty">Loading your to-dos.</p>;
  const items = tab === 'mine' ? todos.mine : todos.open;
  const groups = groupTodos(items, todayIso());
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
      <div className="drawer-scroll">
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
                    <TodoRow key={t.id} todo={t} />
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
