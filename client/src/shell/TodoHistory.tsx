import { useState } from 'react';
import type { TeamMember, TodoHistoryResponse } from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { Fold } from './Fold.tsx';
import { actorName, eventWords, shortDayTime } from './words.ts';

type Load =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'loaded'; res: TodoHistoryResponse };

/**
 * The History fold at the bottom of the panel's read view. Closed at first; the record is fetched the first
 * time it is opened, once for this to-do (the panel remounts it, by key, for the next one). Plan
 * 2026-11-16-asked-of-others, decision 8.
 */
export function TodoHistory({ todoKey, team }: { todoKey: string; team: readonly TeamMember[] }) {
  const [load, setLoad] = useState<Load>({ kind: 'idle' });

  const fetchIt = async () => {
    setLoad({ kind: 'loading' });
    try {
      setLoad({ kind: 'loaded', res: await api.todoHistory(todoKey) });
    } catch {
      setLoad({ kind: 'failed' });
    }
  };

  const announce =
    load.kind === 'loading'
      ? 'Loading the history.'
      : load.kind === 'failed'
        ? "Couldn't load the history."
        : load.kind === 'loaded' && load.res.status === 'ok'
          ? load.res.events.length === 0
            ? 'No changes are recorded yet.'
            : `${load.res.events.length} ${load.res.events.length === 1 ? 'change' : 'changes'}.`
          : '';
  return (
    <Fold
      title="History"
      defaultOpen={false}
      onToggle={(open) => {
        if (open && load.kind === 'idle') void fetchIt();
      }}
    >
      <div className="todo-history">
        <p className="visually-hidden" role="status">
          {announce}
        </p>
        {load.kind === 'loading' ? <p className="todo-note">Loading the history.</p> : null}
        {load.kind === 'failed' ? (
          <p className="todo-note">
            Couldn't load the history.{' '}
            <button type="button" className="link-btn" onClick={() => void fetchIt()}>
              Try again
            </button>
          </p>
        ) : null}
        {load.kind === 'loaded' ? <HistoryBody res={load.res} team={team} /> : null}
      </div>
    </Fold>
  );
}

function HistoryBody({ res, team }: { res: TodoHistoryResponse; team: readonly TeamMember[] }) {
  if (res.status === 'personal')
    return <p className="todo-note">Personal to-dos aren't synced, so there's no history.</p>;
  if (res.status === 'unavailable')
    return <p className="todo-note">History isn't available in this brain.</p>;
  const fromGit = res.events.some((e) => e.actor.source === 'history');
  return (
    <>
      {res.events.length === 0 ? (
        <p className="todo-note">No changes are recorded yet.</p>
      ) : (
        <ul className="todo-history-list">
          {res.events.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, never reordered.
            <li key={i}>
              <span className="todo-history-when">{shortDayTime(e.actor.at)}</span>
              {' · '}
              {actorName(e.actor)}
              {e.actor.source === 'history' ? (
                <>
                  <span aria-hidden="true">*</span>
                  <span className="visually-hidden"> (git history)</span>
                </>
              ) : null}{' '}
              {eventWords(e, team)}
            </li>
          ))}
        </ul>
      )}
      {fromGit ? (
        <p className="todo-note">
          * From git history (the brain's sync record): it names whoever's Mac synced the change, which may
          not be who made it.
        </p>
      ) : null}
      {res.more ? <p className="todo-note">Older changes aren't shown.</p> : null}
    </>
  );
}
