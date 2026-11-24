import { useState } from 'react';
import type { DoneTodo } from '../../../shared/contract.ts';
import { type DoneGroup, groupDone } from '../state/todo-done.ts';
import { Fold } from './Fold.tsx';
import { ProjectChip } from './ProjectChip.tsx';
import { StateNote } from './StateNote.tsx';
import { doneMeta } from './words.ts';

/** How the finished to-dos request is going. */
export type DoneState = 'loading' | 'loaded' | 'failed';

/** Where a finished to-do belongs, as its row shows it (the same shape as the Asked tab's). */
export interface DonePlace {
  chip: { key: string; label: string; short?: string } | null;
  places: string[];
}

/** The order previous and next walk in this tab: the groups top to bottom. */
export function doneOrder(groups: readonly DoneGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((t) => t.key));
}

function DoneRow({
  todo,
  open,
  onOpen,
  place,
  onProject,
}: {
  todo: DoneTodo;
  open: boolean;
  onOpen: (t: DoneTodo) => void;
  place: DonePlace | null;
  onProject?: (key: string) => void;
}) {
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
          <span className="todo-meta-item">{doneMeta(todo)}</span>
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
 * The Done tab: every finished to-do, newest first, grouped by when it was done (done-todos plan, decision
 * 5). Read only: a row opens the panel. `items` are already narrowed by the drawer's client and project
 * filters and its search box.
 */
export function DoneList({
  items,
  historyRead,
  query,
  filteredBy = null,
  now,
  placeOf,
  onProject,
  state,
  onRetry,
  openKey,
  onOpen,
}: {
  /** Null until the first load finishes. */
  items: DoneTodo[] | null;
  /** False when git history couldn't be read: older to-dos have no date. */
  historyRead: boolean;
  /** The trimmed search text, or ''. */
  query: string;
  /** The drawer's filter, named, while one is on. */
  filteredBy?: string | null;
  now: Date;
  placeOf?: (t: DoneTodo) => DonePlace;
  onProject?: (key: string) => void;
  state: DoneState;
  onRetry: () => void;
  openKey: string | null;
  onOpen: (t: DoneTodo) => void;
}) {
  // Sections the person opened or closed by hand hold only while the search and filter stay the same.
  const scope = `${query}|${filteredBy ?? ''}`;
  const [choice, setChoice] = useState<{ scope: string; open: Record<string, boolean> }>({
    scope,
    open: {},
  });
  if (choice.scope !== scope) setChoice({ scope, open: {} });
  const chosen = choice.scope === scope ? choice.open : {};

  if (!items) {
    return state === 'failed' ? (
      <p className="dock-empty done-retry" role="status">
        Couldn't load these.{' '}
        <button type="button" className="btn" data-size="small" onClick={onRetry}>
          Try again
        </button>
      </p>
    ) : (
      <StateNote kind="loading" />
    );
  }
  const partial = historyRead ? null : (
    <p className="todo-note done-partial">Older to-dos have no date: the git history couldn't be read.</p>
  );
  const retry =
    state === 'failed' ? (
      <p className="todo-note done-retry" role="status">
        Couldn't refresh this list.{' '}
        <button type="button" className="btn" data-size="small" onClick={onRetry}>
          Try again
        </button>
      </p>
    ) : null;
  if (items.length === 0) {
    const where = filteredBy ? ` in ${filteredBy}` : '';
    return (
      <>
        {partial}
        {retry}
        <p className="dock-empty">
          {query
            ? `No finished to-dos match “${query}”${where}.`
            : filteredBy
              ? `Nothing in ${filteredBy} has been finished yet.`
              : 'No finished to-dos yet.'}
        </p>
      </>
    );
  }
  const groups = groupDone(items, now);
  const narrowed = query !== '' || filteredBy !== null;
  return (
    <>
      {partial}
      {retry}
      {groups.map((g, i) => (
        <Fold
          key={g.title}
          title={g.title}
          count={g.items.length}
          open={chosen[g.title] ?? (narrowed || i === 0 || g.items.some((t) => t.key === openKey))}
          onToggle={(o) => setChoice({ scope, open: { ...chosen, [g.title]: o } })}
        >
          <ul className="drawer-list">
            {g.items.map((t) => (
              <DoneRow
                key={t.key}
                todo={t}
                open={openKey === t.key}
                onOpen={onOpen}
                place={placeOf ? placeOf(t) : null}
                onProject={onProject}
              />
            ))}
          </ul>
        </Fold>
      ))}
    </>
  );
}
