import { useEffect, useSyncExternalStore } from 'react';
import type { TeamTodo } from '../../../shared/contract.ts';
import { api } from '../api.ts';

/**
 * A small cache of teammates' open to-dos opened read only (done-todos plan, decision 10), keyed by the panel
 * key `team:todo/<id>`. An external store like `doneStore`. `ensure` fetches a key once; `refresh` fetches again
 * (the drawer calls it for the keys already loaded when the brain changes).
 */
export interface TeamSnapshot {
  /** The to-do, or null while loading, when it has gone (404) or when the load failed. */
  item: TeamTodo | null;
  loading: boolean;
  /** The last request's failure (a 404 included), else null. A failed refresh keeps the last good item. */
  error: string | null;
}

const NONE: TeamSnapshot = { item: null, loading: false, error: null };
const PREFIX = 'team:todo/';
const entries = new Map<string, TeamSnapshot>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function set(key: string, next: TeamSnapshot): void {
  entries.set(key, next);
  for (const l of [...listeners]) l();
}

export const teamTodoStore = {
  get: (key: string): TeamSnapshot => entries.get(key) ?? NONE,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  refresh(key: string): Promise<void> {
    const running = inflight.get(key);
    if (running) return running;
    if (!key.startsWith(PREFIX)) return Promise.resolve();
    set(key, { ...teamTodoStore.get(key), loading: true });
    const p = api
      .teamTodo(key.slice(PREFIX.length))
      .then(
        (item) => set(key, { item, loading: false, error: null }),
        (e: unknown) => {
          // A to-do that has gone is gone: drop the old copy. Any other failure keeps the last good one.
          const status = (e as { status?: number } | null)?.status;
          const keep = status === 404 ? null : teamTodoStore.get(key).item;
          set(key, { item: keep, loading: false, error: e instanceof Error ? e.message : String(e) });
        },
      )
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, p);
    return p;
  },
  /** Fetches the first time only. */
  ensure(key: string): void {
    if (entries.has(key)) return;
    void teamTodoStore.refresh(key);
  },
  /** Refreshes every key already loaded (the brain changed). */
  refreshLoaded(): void {
    for (const key of [...entries.keys()]) void teamTodoStore.refresh(key);
  },
  /** Tests only: forget everything. */
  reset(): void {
    entries.clear();
    inflight.clear();
    listeners.clear();
  },
};

/** One key's state; `ensure` starts its first load. A null key (no `team:` panel) reads nothing. */
export function useTeamTodo(key: string | null): TeamSnapshot {
  const s = useSyncExternalStore(teamTodoStore.subscribe, () =>
    key === null ? NONE : teamTodoStore.get(key),
  );
  useEffect(() => {
    if (key !== null) teamTodoStore.ensure(key);
  }, [key]);
  return s;
}
