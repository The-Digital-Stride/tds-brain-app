/**
 * When each Ad Manager task last ran on an account, and the chat that run started, so a task card can say
 * "Last run Today, 21:46" and show "Running" while that chat works. Kept in this browser's localStorage:
 * it knows runs started from this app on this machine, not ones started in a terminal or by a teammate.
 */
import { useSyncExternalStore } from 'react';
import type { AdsTaskRun } from '../../../../shared/ads-contract.ts';
import type { LiveSession } from '../../../../shared/contract.ts';

export const TASK_RUNS_KEY = 'tds.adManager.taskRuns.v1';
const MAX_RUNS = 300;

export interface TaskRun {
  /** ISO time the run was started. */
  at: string;
  /** The app's id for the chat it started (`LiveSession.id`), or null. */
  chat: string | null;
  /** Claude Code's own session id for that chat, once known (`LiveSession.sdkSessionId`). */
  sdk?: string | null;
  /** The last run of this task that finished well: set the first time its chat shows `lastTurn: 'ok'`. */
  good?: { at: string; sdk: string } | null;
}
export type TaskRuns = Record<string, TaskRun>;
export type RunStatus = 'running' | 'waiting' | null;

type Readable = Pick<Storage, 'getItem'> | null | undefined;
type Writable = Pick<Storage, 'setItem'> | null | undefined;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export const runKey = (client: string, task: string) => `${client}/${task}`;

/** The runs with this one recorded, keeping the newest `MAX_RUNS`. */
export function recordRun(
  runs: TaskRuns,
  client: string,
  task: string,
  at: Date,
  chat: string | null,
): TaskRuns {
  const good = runs[runKey(client, task)]?.good;
  const run: TaskRun = { at: at.toISOString(), chat, ...(good ? { good } : {}) };
  const next: TaskRuns = { ...runs, [runKey(client, task)]: run };
  const keys = Object.keys(next);
  if (keys.length <= MAX_RUNS) return next;
  const keep = keys.sort((a, b) => (next[b]?.at ?? '').localeCompare(next[a]?.at ?? '')).slice(0, MAX_RUNS);
  return Object.fromEntries(keep.map((k) => [k, next[k] as TaskRun]));
}

function cleanGood(v: unknown): { at: string; sdk: string } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { at, sdk } = v as Record<string, unknown>;
  return typeof at === 'string' &&
    !Number.isNaN(Date.parse(at)) &&
    typeof sdk === 'string' &&
    sdk !== '' &&
    sdk.length <= 128
    ? { at, sdk }
    : undefined;
}

function isRun(v: unknown): v is TaskRun {
  if (!v || typeof v !== 'object') return false;
  const { at, chat } = v as Record<string, unknown>;
  return (
    typeof at === 'string' &&
    !Number.isNaN(Date.parse(at)) &&
    (chat === null || (typeof chat === 'string' && chat.length <= 128))
  );
}

export function readRuns(storage: Readable = browserStorage()): TaskRuns {
  try {
    const raw = storage?.getItem(TASK_RUNS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: TaskRuns = {};
    for (const [k, v] of Object.entries(parsed).slice(0, MAX_RUNS)) {
      if (k.length <= 200 && isRun(v)) {
        const good = cleanGood(v.good);
        const sdk = typeof v.sdk === 'string' && v.sdk !== '' && v.sdk.length <= 128 ? v.sdk : undefined;
        out[k] = { at: v.at, chat: v.chat, ...(sdk ? { sdk } : {}), ...(good ? { good } : {}) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The runs updated from the live chats: each run's chat id gives its `sdk` once known, and the first time that chat
 * shows `lastTurn: 'ok'` the run becomes `good`. Stopped, failed or unknown (older server) leave `good` alone.
 * Returns `runs` itself when nothing changed.
 */
export function reconcileRuns(runs: TaskRuns, sessions: readonly LiveSession[]): TaskRuns {
  let next: TaskRuns | null = null;
  for (const [key, run] of Object.entries(runs)) {
    if (!run.chat) continue;
    const s = sessions.find((l) => l.id === run.chat);
    if (!s) continue;
    const sdk = s.sdkSessionId ?? run.sdk ?? null;
    let updated = run;
    if (s.sdkSessionId && run.sdk !== s.sdkSessionId) updated = { ...updated, sdk: s.sdkSessionId };
    if (s.lastTurn === 'ok' && sdk && !(run.good?.at === run.at && run.good.sdk === sdk)) {
      updated = { ...updated, good: { at: run.at, sdk } };
    }
    if (updated === run) continue;
    next ??= { ...runs };
    next[key] = updated;
  }
  return next ?? runs;
}

export function writeRuns(runs: TaskRuns, storage: Writable = browserStorage()): void {
  try {
    storage?.setItem(TASK_RUNS_KEY, JSON.stringify(runs));
  } catch {
    // Storage blocked or full: the times last until the page reloads.
  }
}

/** Running while the run's chat starts or works; waiting while it needs an answer; otherwise nothing. */
export function runStatus(run: TaskRun | undefined, live: LiveSession[] | undefined): RunStatus {
  if (!run?.chat || !live) return null;
  const s = live.find((l) => l.id === run.chat)?.state;
  if (s === 'starting' || s === 'working') return 'running';
  if (s === 'waiting') return 'waiting';
  return null;
}

/** The run a card shows: when, and the teammate's first name when it was someone else (null for me). */
export interface ShownRun {
  at: string;
  by: string | null;
}

/**
 * The newer of this browser's run and the brain's shared `lastRun` (plan 2026-11-16-ad-manager-shared-run-times).
 * While my own run's chat is live, my run wins: it is the one Running and Open chat are about.
 */
export function shownRun(
  local: TaskRun | undefined,
  shared: AdsTaskRun | null | undefined,
  me: string | null,
  live: boolean,
): ShownRun | null {
  const mine = local ? { at: local.at, by: null } : null;
  if (live && mine) return mine;
  const theirs = shared
    ? { at: shared.at, by: shared.by === me ? null : shared.byName.trim().split(/\s+/)[0] || shared.by }
    : null;
  if (!theirs) return mine;
  if (!mine) return theirs;
  return Date.parse(theirs.at) > Date.parse(mine.at) ? theirs : mine;
}

const two = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today, 21:46", "Yesterday, 09:05", "3 Nov, 14:00" or "30 Dec 2025, 08:00", in local time. */
export function lastRunText(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? `${date}, ${time}` : `${date} ${d.getFullYear()}, ${time}`;
}

// One copy shared by every card, saved on each change, and kept in step with other tabs.
let current: TaskRuns | null = null;
const listeners = new Set<() => void>();
const snapshot = () => {
  current ??= readRuns();
  return current;
};

export const taskRuns = {
  /** Updates the runs from the live chats (see `reconcileRuns`); saves and notifies only when something changed. */
  reconcile(sessions: readonly LiveSession[]) {
    // Re-read first: a window with no Ads sheet open isn't listening for storage changes, so its copy may be stale.
    const fresh = readRuns();
    const next = reconcileRuns(fresh, sessions);
    const moved = JSON.stringify(fresh) !== JSON.stringify(current);
    if (next === fresh) {
      if (!moved) return;
      current = fresh;
      for (const l of listeners) l();
      return;
    }
    current = next;
    writeRuns(current);
    for (const l of listeners) l();
  },
  record(client: string, task: string, chat: string | null, at = new Date()) {
    current = recordRun(snapshot(), client, task, at, chat);
    writeRuns(current);
    for (const l of listeners) l();
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== TASK_RUNS_KEY) return;
    current = readRuns();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useTaskRuns(): TaskRuns {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
