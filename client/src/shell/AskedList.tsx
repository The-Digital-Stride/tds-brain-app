import { useState } from 'react';
import { ASKED_DONE_DAYS, type AskedTodo, type AskedTodoList } from '../../../shared/contract.ts';
import { dueInWords, isOverdue } from '../format.ts';
import { Fold } from './Fold.tsx';
import { ProjectChip } from './ProjectChip.tsx';
import { StateNote } from './StateNote.tsx';
import { askedMeta, cap } from './words.ts';

/** How the separate "asked of others" request is going. */
export type AskedState = 'loading' | 'loaded' | 'failed';

/** Where an asked to-do belongs, as its row shows it: a project chip that filters by it, else plain words. */
export interface AskedPlace {
  chip: { key: string; label: string; short?: string } | null;
  places: string[];
}

/** The order previous and next walk in this tab: waiting first, then done. */
export function askedOrder(list: AskedTodoList | null): string[] {
  return list ? [...list.waiting, ...list.done].map((t) => t.key) : [];
}

function AskedRow({
  todo,
  open,
  onOpen,
  place,
  onProject,
}: {
  todo: AskedTodo;
  open: boolean;
  onOpen: (t: AskedTodo) => void;
  place: AskedPlace | null;
  onProject?: (key: string) => void;
}) {
  const due = todo.due ? dueInWords(todo.due) : '';
  const chip = onProject ? (place?.chip ?? null) : null;
  const places = chip ? [] : (place?.places ?? []);
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
          <span className="todo-meta-item">{askedMeta(todo)}</span>
          {due && todo.state === 'waiting' ? (
            <span className="todo-meta-item">
              <span className="todo-sep"> · </span>
              <span
                className={todo.state === 'waiting' && todo.due && isOverdue(todo.due) ? 'late' : undefined}
              >
                {cap(due)}
              </span>
            </span>
          ) : null}
        </span>
        {chip || places.length > 0 ? (
          <div className="todo-end">
            <span className="todo-where">
              {chip && onProject ? (
                <ProjectChip label={chip.label} short={chip.short} onPick={() => onProject(chip.key)} />
              ) : (
                <span className="line-meta todo-where-text">{places.join(' · ')}</span>
              )}
            </span>
          </div>
        ) : null}
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
  filteredBy = null,
  placeOf,
  onProject,
  state,
  onRetry,
  openKey,
  onOpen,
}: {
  list: AskedTodoList | null;
  /** The drawer's filter, named ("Acme · Website"), while one is on: `list` is already narrowed to it. */
  filteredBy?: string | null;
  /** Where each row belongs, as the other tabs show it. Without it, rows don't say. */
  placeOf?: (t: AskedTodo) => AskedPlace;
  /** Filters the drawer by a row's project; absent while a project filter is on. */
  onProject?: (key: string) => void;
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
            <button type="button" className="btn" data-size="small" onClick={onRetry}>
              Try again
            </button>
          </p>
        ) : (
          <StateNote kind="loading" />
        )}
      </>
    );
  }
  const rows = (items: AskedTodo[]) => (
    <ul className="drawer-list">
      {items.map((t) => (
        <AskedRow
          key={t.key}
          todo={t}
          open={openKey === t.key}
          onOpen={onOpen}
          place={placeOf ? placeOf(t) : null}
          onProject={onProject}
        />
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
          <button type="button" className="btn" data-size="small" onClick={onRetry}>
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
          <p className="dock-empty">
            {filteredBy
              ? `Nothing in ${filteredBy} is waiting.`
              : "Nothing you've asked of others is waiting."}
          </p>
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
          <p className="dock-empty">
            {filteredBy
              ? `Nothing in ${filteredBy} was finished recently.`
              : "Nothing you've asked of others was finished recently."}
          </p>
        ) : (
          rows(list.done)
        )}
      </Fold>
    </>
  );
}
