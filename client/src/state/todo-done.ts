import { useEffect, useSyncExternalStore } from 'react';
import type { DoneTodo, DoneTodoList } from '../../../shared/contract.ts';
import type { ProjectCard } from '../../../shared/projects-contract.ts';
import { api } from '../api.ts';
import type { TodoFilter } from '../shell/contract.ts';
import { weekStart } from '../shell/meeting-words.ts';
import { todoPlaceParts } from './projects.ts';
import { plain } from './search-match.ts';
import { todoProjectKey } from './todo-filter.ts';

/**
 * One shared cache of the finished to-dos for the whole page (done-todos plan, decision 8a), an external
 * store like `projectsStore`. Loaded lazily by whoever needs it first (the drawer's Done tab, a `done:`
 * panel key, later the global search) and refreshed on the brain change signal (`refresh`).
 */
export interface DoneSnapshot {
  list: DoneTodoList | null;
  /** True while a request is out (the first load or a refresh). */
  loading: boolean;
  /** The last request's failure, else null. A failed refresh keeps the last good list. */
  error: string | null;
}

const EMPTY: DoneSnapshot = { list: null, loading: false, error: null };
let snap: DoneSnapshot = EMPTY;
let started = false;
let inflight: Promise<void> | null = null;
/** A refresh was asked for while one was loading: its answer may be out of date, so load once more. */
let again = false;
const listeners = new Set<() => void>();

function emit(next: DoneSnapshot): void {
  snap = next;
  for (const l of [...listeners]) l();
}

export const doneStore = {
  get: (): DoneSnapshot => snap,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /**
   * GET again. A call while a load is running doesn't start a second request: that load's answer is
   * thrown away and one more is made, so a change that came during it isn't missed. Every caller's
   * promise settles with the last load. Failures keep the last good list.
   */
  refresh(): Promise<void> {
    if (inflight) {
      again = true;
      return inflight;
    }
    started = true;
    emit({ ...snap, loading: true });
    const load = async (): Promise<void> => {
      again = false;
      try {
        const list = await api.doneTodos();
        if (again) return load();
        emit({ list, loading: false, error: null });
      } catch (e: unknown) {
        if (again) return load();
        emit({ list: snap.list, loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    };
    inflight = load().finally(() => {
      inflight = null;
    });
    return inflight;
  },
  /** Starts the first load once; later loads come from `refresh`. */
  ensure(): void {
    if (started) return;
    void doneStore.refresh();
  },
  /** Whether a first load has been asked for (so a refresh on a change signal is worth making). */
  isStarted: (): boolean => started,
  /** Tests only: forget everything. */
  reset(): void {
    snap = EMPTY;
    started = false;
    inflight = null;
    again = false;
    listeners.clear();
  },
};

/** The store's state; `ensure` starts the first load (pass false to only read, e.g. when no one needs it yet). */
export function useDoneTodos(load = true): DoneSnapshot & { refresh(): Promise<void> } {
  const s = useSyncExternalStore(doneStore.subscribe, doneStore.get);
  useEffect(() => {
    if (load) doneStore.ensure();
  }, [load]);
  return { ...s, refresh: () => doneStore.refresh() };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────────────────────────

export interface DoneGroup {
  /** "This week", "Earlier this month", "October 2026", "Date not known". */
  title: string;
  items: DoneTodo[];
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Groups finished to-dos by when they were done, keeping the order given: "This week" (this calendar week,
 * Monday on), "Earlier this month", then one group per older month ("October 2026") in order of first
 * appearance, and "Date not known" last. Empty groups are left out.
 */
export function groupDone(items: readonly DoneTodo[], now: Date): DoneGroup[] {
  const week = weekStart(now);
  const groups = new Map<string, DoneTodo[]>();
  const add = (title: string, t: DoneTodo) => groups.set(title, [...(groups.get(title) ?? []), t]);
  const unknown: DoneTodo[] = [];
  for (const t of items) {
    const at = t.done ? new Date(t.done.at) : null;
    if (!at || Number.isNaN(at.getTime())) {
      unknown.push(t);
      continue;
    }
    if (at.getTime() >= week) add('This week', t);
    else if (at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth())
      add('Earlier this month', t);
    else add(`${MONTH_NAMES[at.getMonth()]} ${at.getFullYear()}`, t);
  }
  const out: DoneGroup[] = [...groups].map(([title, list]) => ({ title, items: list }));
  if (unknown.length > 0) out.push({ title: 'Date not known', items: unknown });
  return out;
}

/** What `searchDone` needs to turn a client or project into words. */
export interface DoneSearchContext {
  clients: readonly { slug: string; name: string }[];
  projects?: readonly ProjectCard[];
}

/**
 * Finished to-dos whose title, details, client or project words contain every word of `query` (case and
 * accents ignored, any order). An empty query returns `items` itself. Keeps the order given.
 */
export function searchDone(items: readonly DoneTodo[], query: string, ctx: DoneSearchContext): DoneTodo[] {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items as DoneTodo[];
  return items.filter((t) => {
    const hay = plain([t.title, t.details, ...todoPlaceParts(t, ctx.projects, ctx.clients)].join('\n'));
    return words.every((w) => hay.includes(w));
  });
}

/** The drawer's client and project filters on the Done tab (kind has nothing to narrow). */
export function filterDone(items: DoneTodo[], filter: Pick<TodoFilter, 'client' | 'project'>): DoneTodo[] {
  if (filter.client === null && !filter.project) return items;
  return items.filter((t) => {
    if (filter.client !== null && (t.client ?? null) !== filter.client) return false;
    return !filter.project || todoProjectKey(t) === filter.project;
  });
}
