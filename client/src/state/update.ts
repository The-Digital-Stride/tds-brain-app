import { useSyncExternalStore } from 'react';
import type { UpdateStatus } from '../../../shared/update-contract.ts';
import { api } from '../api.ts';

/** The phases in which the server is busy, so the page asks every 2 s. */
const RUNNING = new Set<UpdateStatus['phase']>([
  'checking',
  'downloading',
  'installing',
  'building',
  'restarting',
]);

export const SLOW_POLL_MS = 30 * 60 * 1000;
export const FAST_POLL_MS = 2000;
export const FOCUS_MIN_MS = 60 * 1000;
export const STALLED_AFTER_MS = 60 * 1000;
export const LATER_KEY = 'tds-brain-update-later';
export const STARTED_KEY = 'tds-brain-update-started';

export interface UpdateView {
  /** null until the first answer. */
  status: UpdateStatus | null;
  /** True once the restart has taken over a minute. */
  stalled: boolean;
  /** The server is restarting (or went quiet mid-update): shown as "Restarting TDS Brain…". */
  restarting: boolean;
  /** A check asked for from this page is running. */
  checking: boolean;
  /** The person chose "Later" for this version. */
  dismissed: boolean;
}

export interface UpdateActions {
  check: () => Promise<void>;
  start: () => Promise<void>;
  later: () => void;
}

let status: UpdateStatus | null = null;
let stalled = false;
let checking = false;
let restartingSince: number | null = null;
let lastFetchAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let view: UpdateView = { status: null, stalled: false, restarting: false, checking: false, dismissed: false };
const listeners = new Set<() => void>();

function readStore(kind: 'local' | 'session', key: string): string | null {
  try {
    return (kind === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
function writeStore(kind: 'local' | 'session', key: string, value: string | null): void {
  try {
    const s = kind === 'local' ? window.localStorage : window.sessionStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    // Storage can be blocked; the page works without it.
  }
}

function publish(): void {
  const dismissed = status?.latest != null && readStore('local', LATER_KEY) === status.latest;
  view = { status, stalled, restarting: restartingSince !== null, checking, dismissed };
  for (const l of listeners) l();
}

function accept(next: UpdateStatus): void {
  status = next;
  if (next.phase === 'restarting') restartingSince ??= Date.now();
  else {
    restartingSince = null;
    stalled = false;
  }
  // The tab that started the update reloads itself once the server runs a different version.
  const startedFrom = readStore('session', STARTED_KEY);
  if (startedFrom && next.current !== startedFrom) {
    writeStore('session', STARTED_KEY, null);
    window.location.reload();
  }
  publish();
}

async function poll(): Promise<void> {
  lastFetchAt = Date.now();
  try {
    accept(await api.updateStatus());
  } catch {
    // The server exits within milliseconds of restarting, so the page rarely sees that phase. If an
    // update was running (or this tab started one), a failed request means "restarting".
    const phase = status?.phase;
    const running =
      phase === 'downloading' || phase === 'installing' || phase === 'building' || phase === 'restarting';
    if (running || readStore('session', STARTED_KEY)) {
      restartingSince ??= Date.now();
      if (Date.now() - restartingSince >= STALLED_AFTER_MS) stalled = true;
      publish();
    }
  }
}

function schedule(): void {
  clearTimeout(timer);
  if (listeners.size === 0) return;
  const fast = (status !== null && RUNNING.has(status.phase)) || restartingSince !== null;
  timer = setTimeout(
    async () => {
      await poll();
      schedule();
    },
    fast ? FAST_POLL_MS : SLOW_POLL_MS,
  );
}

function onFocus(): void {
  if (Date.now() - lastFetchAt < FOCUS_MIN_MS) return;
  void poll().then(schedule);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener('focus', onFocus);
    void poll().then(schedule);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('focus', onFocus);
      clearTimeout(timer);
    }
  };
}

const getSnapshot = () => view;

async function check(): Promise<void> {
  checking = true;
  publish();
  try {
    accept(await api.updateCheck());
  } catch {
    // The status keeps its last answer; the next poll says what the server thinks.
  } finally {
    checking = false;
    publish();
    schedule();
  }
}

async function start(): Promise<void> {
  try {
    const next = await api.updateStart();
    writeStore('session', STARTED_KEY, status?.current ?? next.current);
    accept(next);
  } catch {
    // Busy, or no longer allowed: show what the server says now.
    await poll();
  }
  schedule();
}

function later(): void {
  if (!status?.latest) return;
  writeStore('local', LATER_KEY, status.latest);
  publish();
}

const actions: UpdateActions = { check, start, later };

/** One shared poller for every component that shows the update. */
export function useUpdate(): UpdateView & UpdateActions {
  const v = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...v, ...actions };
}

/** Tests only: forget everything. */
export function resetUpdateForTests(): void {
  clearTimeout(timer);
  status = null;
  stalled = false;
  checking = false;
  restartingSince = null;
  lastFetchAt = 0;
  view = { status: null, stalled: false, restarting: false, checking: false, dismissed: false };
  listeners.clear();
  window.removeEventListener('focus', onFocus);
}
