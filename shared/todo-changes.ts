/**
 * "Changed since you looked" for tasks (plan 2026-11-27-task-change-notices). THE rule, in one place: the rail,
 * the Tasks drawer, the Home card and the task panel all call these functions and never work it out themselves.
 *
 * In words:
 * - A change is an entry in the task's log (a note, an automatic line, a handover) made by someone else. For a
 *   task you asked someone to do, its being finished by someone else is a change too.
 * - Your own actions never count. Personal tasks never count (only you can change them).
 * - On a task you hold, only what happened after it came to you counts: its arrival is "New to you" (the older
 *   rule, `client/src/state/todo-new.ts`), and what earlier holders wrote is its history, not news.
 * - On a task you asked for, only what happened after you passed it on counts. On one you handed back
 *   (`AskedTodo.handedBack`), only notes and the finish are news: the rest is the other person's own business.
 * - A change older than TODO_CHANGED_DAYS is never shown as new, whatever the marker says.
 * - "Looked" is a marker per task (`AppPrefs.todoLooked`, app data, never the brain): the entries by others
 *   the person has seen, each as a short key made from its time, author, kind and text. An entry is new when
 *   its key is not there. Keys (not a count, a clock time or the file's fingerprint) are what make this hold
 *   when two entries share a minute, when a sync slots an older entry in late, when the task changes hands and
 *   the person's role with it, and when the Reminders sync rewrites the file with nobody else involved
 *   (overseer pre-review, blocking 1).
 *
 * Known miss: a task you asked for that its holder passes to a third person leaves your Asked list (it is no
 * longer the task you asked that person to do), so you get no notice of the pass-on.
 */
import type { AskedTodo, TodoItem } from './contract.ts';
import type { TodoUpdate } from './todo-updates-contract.ts';

/** A change by someone else counts as news for this long. */
export const TODO_CHANGED_DAYS = 7;
/** At most this many markers are kept. The app drops the ones looked at longest ago to fit; more is refused. */
export const TODO_LOOKED_MAX = 500;
/** A marker not refreshed for this long is dropped on write: nothing that old can be news (TODO_CHANGED_DAYS). */
export const TODO_LOOKED_KEEP_DAYS = 30;
/** At most this many entry keys in one marker: the newest. A task rarely has this many in TODO_CHANGED_DAYS. */
export const TODO_LOOKED_KEYS_MAX = 80;
/** An entry key's length: letters and digits only. */
export const TODO_LOOKED_KEY_LENGTH = 11;

/** What the person had seen of one task when they last looked. Keyed by the task file's `id` (TDS tasks only). */
export interface TodoLookedMark {
  /** `entryKey` of each entry by other people from the last TODO_CHANGED_DAYS, newest first, whatever their role. */
  keys: string[];
  /** The task was finished when they looked (Asked tasks). */
  done?: true;
  /** When they looked: ISO 8601 from the app. Markers older than TODO_LOOKED_KEEP_DAYS are dropped. */
  seen: string;
}

/** `AppPrefs.todoLooked`: task `id` → marker. */
export type TodoLooked = Record<string, TodoLookedMark>;

/** The person, as `BootInfo.identity` has them. */
export interface ChangeViewer {
  slug: string;
  name: string;
}

/** What is new on one task for this person. */
export interface TodoChange {
  /** The log entries they have not seen, newest first. Empty when the only news is `finished`. */
  entries: TodoUpdate[];
  /** An Asked task that someone else finished since they looked. */
  finished: { at: string; byName: string | null } | null;
  /** How many things are new: `entries.length`, plus one when `finished`. Never 0. */
  count: number;
  /** When the newest of them happened (ISO). */
  at: string;
}

/** The parts of a task the rule reads. A TodoItem (held) or an AskedTodo (asked) both fit. */
export type ChangeSubject =
  | { kind: 'held'; todo: Pick<TodoItem, 'id' | 'scope' | 'updates' | 'handover'> }
  | { kind: 'asked'; todo: Pick<AskedTodo, 'id' | 'state' | 'updates' | 'done' | 'asked' | 'handedBack'> };

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

const time = (iso: string): number => Date.parse(iso);

/** cyrb53: a small, well-spread string hash. Not for secrets; only to tell one log entry from another. */
function hash53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** One entry's key: the same entry gives the same key on every Mac, whatever order the log is in. */
export function entryKey(e: TodoUpdate): string {
  const text = [e.at, e.by ?? '', e.by ? '' : e.byName, e.kind, e.text].join('\u0001');
  return hash53(text).toString(36).padStart(TODO_LOOKED_KEY_LENGTH, '0');
}

/** Made by someone other than this person. A handover line has a slug only when the server matched its name. */
function byOther(e: TodoUpdate, me: ChangeViewer): boolean {
  return e.by ? e.by !== me.slug : e.byName !== me.name;
}

const recentFrom = (now: Date): number => now.getTime() - TODO_CHANGED_DAYS * DAY_MS;

/** Every entry by someone else from the last TODO_CHANGED_DAYS, newest first: what a marker records. */
function recentOthers(updates: readonly TodoUpdate[] | undefined, me: ChangeViewer, now: Date): TodoUpdate[] {
  const cutoff = recentFrom(now);
  return (
    (updates ?? [])
      .map((e, i) => ({ e, i, at: time(e.at) }))
      .filter((x) => !Number.isNaN(x.at) && x.at >= cutoff && byOther(x.e, me))
      // Entries in the same minute keep the log's order, the one written last first.
      .sort((a, b) => b.at - a.at || b.i - a.i)
      .map((x) => x.e)
  );
}

/**
 * The recent entries by other people that can be news to this person in their present role, newest first:
 * after the task came to them (held) or after they passed it on (asked).
 */
export function othersEntries(subject: ChangeSubject, me: ChangeViewer, now: Date): TodoUpdate[] {
  const others = recentOthers(subject.todo.updates, me, now);
  const since = subject.kind === 'held' ? subject.todo.handover?.at : subject.todo.asked.at;
  const from = since ? time(since) : Number.NaN;
  // Entry times are to the minute; the stamps are to the second.
  const fromMinute = Number.isNaN(from) ? null : Math.floor(from / MINUTE_MS) * MINUTE_MS;
  return others.filter((e) => {
    // Handed back: the other person's own running of the task is not news; what they say is.
    if (subject.kind === 'asked' && subject.todo.handedBack === true && e.kind !== 'note') return false;
    if (fromMinute === null) return true;
    const at = time(e.at);
    if (at < fromMinute) return false;
    // The pass-on that brought it here is "New to you", not a change.
    return !(subject.kind === 'held' && e.kind === 'handover' && at === fromMinute);
  });
}

/** The marker to save when the person looks at this task now. */
export function lookedMark(subject: ChangeSubject, me: ChangeViewer, now: Date): TodoLookedMark {
  return {
    keys: recentOthers(subject.todo.updates, me, now).slice(0, TODO_LOOKED_KEYS_MAX).map(entryKey),
    ...(subject.kind === 'asked' && subject.todo.state === 'done' ? { done: true as const } : {}),
    seen: now.toISOString(),
  };
}

/**
 * What is new on this task for this person, or null when nothing is. `mark` is their marker for the task's
 * `id` (undefined when they have never looked).
 */
export function todoChange(
  subject: ChangeSubject,
  me: ChangeViewer,
  mark: TodoLookedMark | undefined,
  now: Date,
): TodoChange | null {
  if (subject.kind === 'held' && subject.todo.scope !== 'tds') return null;
  const seen = new Set(mark?.keys ?? []);
  const entries = othersEntries(subject, me, now).filter((e) => !seen.has(entryKey(e)));

  let finished: TodoChange['finished'] = null;
  if (subject.kind === 'asked' && subject.todo.state === 'done' && subject.todo.done && !mark?.done) {
    const done = subject.todo.done;
    const at = time(done.at);
    if (done.slug !== me.slug && !Number.isNaN(at) && at >= recentFrom(now)) {
      finished = { at: done.at, byName: done.name };
    }
  }
  const count = entries.length + (finished ? 1 : 0);
  if (count === 0) return null;
  const newestEntry = entries[0]?.at ?? '';
  const at =
    finished && (newestEntry === '' || time(finished.at) >= time(newestEntry)) ? finished.at : newestEntry;
  return { entries, finished, count, at };
}

/** Drops markers nobody has refreshed for TODO_LOOKED_KEEP_DAYS (or whose `seen` can't be read). */
export function pruneLooked(looked: TodoLooked, now: Date): TodoLooked {
  const cutoff = now.getTime() - TODO_LOOKED_KEEP_DAYS * DAY_MS;
  const out: TodoLooked = {};
  for (const [id, mark] of Object.entries(looked)) {
    const seen = time(mark.seen);
    if (!Number.isNaN(seen) && seen >= cutoff) out[id] = mark;
  }
  return out;
}

/** The map cut to TODO_LOOKED_MAX markers, dropping the ones looked at longest ago, so a save is never refused. */
export function fitLooked(looked: TodoLooked): TodoLooked {
  const all = Object.entries(looked);
  if (all.length <= TODO_LOOKED_MAX) return looked;
  return Object.fromEntries(all.sort((a, b) => time(b[1].seen) - time(a[1].seen)).slice(0, TODO_LOOKED_MAX));
}

const KEY_PATTERN = /^[0-9a-z]+$/;

/** A marker as it may be stored: the right shape and within the limits. Used by the route and the prefs file. */
export function isLookedMark(v: unknown): v is TodoLookedMark {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const m = v as Record<string, unknown>;
  if (Object.keys(m).some((k) => k !== 'keys' && k !== 'done' && k !== 'seen')) return false;
  if (!Array.isArray(m.keys) || m.keys.length > TODO_LOOKED_KEYS_MAX) return false;
  if (
    !m.keys.every((k) => typeof k === 'string' && k.length === TODO_LOOKED_KEY_LENGTH && KEY_PATTERN.test(k))
  )
    return false;
  if ('done' in m && m.done !== true) return false;
  return typeof m.seen === 'string' && m.seen.length <= 40 && !Number.isNaN(time(m.seen));
}
