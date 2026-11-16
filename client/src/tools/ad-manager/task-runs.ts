/**
 * When each Ad Manager task last ran on an account, and the chat that run started, so a task card can say
 * "Last run Today, 21:46" and show "Running" while that chat works. Kept in this browser's localStorage:
 * it knows runs started from this app on this machine, not ones started in a terminal or by a teammate.
 */
import { useSyncExternalStore } from 'react';
import type { LiveSession } from '../../../../shared/contract.ts';

export const TASK_RUNS_KEY = 'tds.adManager.taskRuns.v1';
const MAX_RUNS = 300;

export interface TaskRun {
  /** ISO time the run was started. */
  at: string;
  /** The app's id for the chat it started (`LiveSession.id`), or null. */
  chat: string | null;
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
  const next: TaskRuns = { ...runs, [runKey(client, task)]: { at: at.toISOString(), chat } };
  const keys = Object.keys(next);
  if (keys.length <= MAX_RUNS) return next;
  const keep = keys.sort((a, b) => (next[b]?.at ?? '').localeCompare(next[a]?.at ?? '')).slice(0, MAX_RUNS);
  return Object.fromEntries(keep.map((k) => [k, next[k] as TaskRun]));
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
      if (k.length <= 200 && isRun(v)) out[k] = { at: v.at, chat: v.chat };
    }
    return out;
  } catch {
    return {};
  }
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
