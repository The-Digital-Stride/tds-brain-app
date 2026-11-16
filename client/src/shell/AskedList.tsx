import { useState } from 'react';
import { ASKED_DONE_DAYS, type AskedTodo, type AskedTodoList } from '../../../shared/contract.ts';
import { dueInWords, isOverdue } from '../format.ts';
import { Fold } from './Fold.tsx';
import { askedMeta } from './words.ts';

/** How the separate "asked of others" request is going. */
export type AskedState = 'loading' | 'loaded' | 'failed';

/** The order previous and next walk in this tab: waiting first, then done. */
export function askedOrder(list: AskedTodoList | null): string[] {
  return list ? [...list.waiting, ...list.done].map((t) => t.key) : [];
}

function AskedRow({
  todo,
  open,
  onOpen,
}: {
  todo: AskedTodo;
  open: boolean;
  onOpen: (t: AskedTodo) => void;
}) {
  const due = todo.due ? dueInWords(todo.due) : '';
  return (
    <li className="todo" data-panel-open={open ? 'true' : undefined}>
      <div className="todo-main">
        <span className="line-text">
          <button
            type="button"
            className="line-title todo-open"
            data-panel-for={todo.key}
            aria-haspopup="dialog"
            onClick={() => onOpen(todo)}
          >
            {todo.title}
          </button>
        </span>
      </div>
      <div className="todo-foot">
        <span className="line-meta todo-meta">
          {askedMeta(todo)}
          {due && todo.state === 'waiting' ? (
            <>
              {', '}
              <span
                className={todo.state === 'waiting' && todo.due && isOverdue(todo.due) ? 'late' : undefined}
              >
                {due}
              </span>
            </>
          ) : null}
        </span>
      </div>
    </li>
  );
}

/**
 * The Asked tab: to-dos you passed on or added for someone else. Read only. It leads with one quiet line, then
 * two folds (plan 2026-11-16-asked-of-others, decision 1).
 */
export function AskedList({
  list,
  state,
  onRetry,
  openKey,
  onOpen,
}: {
  list: AskedTodoList | null;
  state: AskedState;
  onRetry: () => void;
  openKey: string | null;
  onOpen: (t: AskedTodo) => void;
}) {
  // The folds are held here so the panel's to-do can be kept in view: moving the panel (previous, next, global
  // search) to a row in a closed fold opens that fold, so closing the panel returns focus to the row.
  const [folds, setFolds] = useState({ waiting: true, done: false });
  const [seenKey, setSeenKey] = useState<string | null>(null);
  if (seenKey !== openKey) {
    setSeenKey(openKey);
    const side =
      !openKey || !list
        ? null
        : list.waiting.some((t) => t.key === openKey)
          ? 'waiting'
          : list.done.some((t) => t.key === openKey)
            ? 'done'
            : null;
    if (side && !folds[side]) setFolds({ ...folds, [side]: true });
  }
  const intro = (
    <p className="todo-note asked-intro">Asked of others: to-dos you passed on or added for someone.</p>
  );
  if (!list) {
    return (
      <>
        {intro}
        {state === 'failed' ? (
          <p className="dock-empty asked-retry" role="status">
            Couldn't load these.{' '}
            <button type="button" className="link-btn" onClick={onRetry}>
              Try again
            </button>
          </p>
        ) : (
          <p className="dock-empty">Loading what you've asked of others.</p>
        )}
      </>
    );
  }
  const rows = (items: AskedTodo[]) => (
    <ul className="drawer-list">
      {items.map((t) => (
        <AskedRow key={t.key} todo={t} open={openKey === t.key} onOpen={onOpen} />
      ))}
    </ul>
  );
  return (
    <>
      {intro}
      {list.historyRead ? null : (
        <p className="todo-note asked-partial">
          Only to-dos passed on in the app or with the to-do skill are listed: the git history couldn't be
          read.
        </p>
      )}
      {state === 'failed' ? (
        <p className="todo-note asked-retry" role="status">
          Couldn't refresh this list.{' '}
          <button type="button" className="link-btn" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : null}
      <Fold
        title="Waiting"
        count={list.waiting.length}
        open={folds.waiting}
        onToggle={(o) => setFolds((f) => ({ ...f, waiting: o }))}
      >
        {list.waiting.length === 0 ? (
          <p className="dock-empty">Nothing you've asked of others is waiting.</p>
        ) : (
          rows(list.waiting)
        )}
      </Fold>
      {/* Reads "Done in the last 60 days" (the help page quotes it, so keep both in step). */}
      <Fold
        title={`Done in the last ${ASKED_DONE_DAYS} days`}
        count={list.done.length}
        open={folds.done}
        onToggle={(o) => setFolds((f) => ({ ...f, done: o }))}
      >
        {list.done.length === 0 ? (
          <p className="dock-empty">Nothing you've asked of others was finished recently.</p>
        ) : (
          rows(list.done)
        )}
      </Fold>
    </>
  );
}
