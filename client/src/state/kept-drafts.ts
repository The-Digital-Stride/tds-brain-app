import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ProjectKey } from '../../../shared/projects-contract.ts';

/**
 * Unsent chats saved for later. A new chat in the chat drawer that holds typed text asks before it is closed; "Save
 * for later" keeps the text and the two picks here, on this Mac only (localStorage, per person like Home's card
 * order), until the message is sent, discarded or emptied. The button that opened the chat brings it back.
 *
 * It lives outside React because the buttons that show a saved chat is waiting (a project's page, a task row) and
 * the drawer that saves it are mounted in different places.
 */
export interface KeptDraft {
  /** The typed text, trimmed. Never empty. */
  text: string;
  /** The Project and Chat for picks, or null when the pickers were never touched (the opener's own apply). */
  picks: { project: ProjectKey | ''; client: string } | null;
  /** ISO time it was saved; the oldest go first when there are too many. */
  savedAt: string;
}

export const KEPT_DRAFTS_KEY = 'tds.chatDrafts.v1';
/** One person's kept messages (identity slug), so people sharing a browser each keep their own. */
export const keptDraftsKey = (person: string): string => `${KEPT_DRAFTS_KEY}:${person}`;
/** Enough for every project someone is juggling; beyond it the oldest is dropped. */
export const KEPT_DRAFTS_MAX = 20;

type Saved = Record<string, KeptDraft>;

/**
 * Which saved chat an opener's chat is: its task, else its project (with the opener's own slot, e.g. the checklist
 * button, which opens with its own text). Null when there is neither: no button would bring it back, so it can't be
 * saved.
 */
export function keptDraftKey(chat: {
  todoId: string | null;
  project?: ProjectKey | null;
  slot?: string;
}): string | null {
  if (chat.todoId) return `todo:${chat.todoId}`;
  if (chat.project) return `project:${chat.project}${chat.slot ? `#${chat.slot}` : ''}`;
  return null;
}

function asPicks(v: unknown): KeptDraft['picks'] {
  if (typeof v !== 'object' || v === null) return null;
  const { project, client } = v as { project?: unknown; client?: unknown };
  return typeof project === 'string' && typeof client === 'string'
    ? { project: project as ProjectKey | '', client }
    : null;
}

/** Reads what localStorage holds. Anything missing, broken or not ours is left out, never thrown. Pure. */
export function parseKept(raw: string | null): Saved {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const out: Saved = {};
  for (const [key, v] of Object.entries(data)) {
    if (typeof v !== 'object' || v === null) continue;
    const { text, picks, savedAt } = v as { text?: unknown; picks?: unknown; savedAt?: unknown };
    if (typeof text !== 'string' || text.trim() === '') continue;
    out[key] = { text, picks: asPicks(picks), savedAt: typeof savedAt === 'string' ? savedAt : '' };
  }
  return out;
}

/** Adds or replaces one, then keeps the most recently saved `max`. Pure. */
export function withKept(all: Saved, key: string, chat: KeptDraft, max = KEPT_DRAFTS_MAX): Saved {
  const next = { ...all, [key]: chat };
  const keys = Object.keys(next);
  if (keys.length <= max) return next;
  const newestFirst = keys.sort((a, b) => (next[b]?.savedAt ?? '').localeCompare(next[a]?.savedAt ?? ''));
  return Object.fromEntries(newestFirst.slice(0, max).map((k) => [k, next[k] as KeptDraft]));
}

/** Removes one. The same object comes back when the key isn't there. Pure. */
export function withoutKept(all: Saved, key: string): Saved {
  if (!(key in all)) return all;
  const { [key]: _gone, ...rest } = all;
  return rest;
}

/**
 * Whether the box still holds exactly what was saved: the same words (spaces at the ends aside) and the same picks.
 * `picks` null means the pickers haven't been touched since the chat opened, so they still show what was saved.
 */
export function sameAsKept(
  saved: KeptDraft | null,
  text: string,
  picks: { project: ProjectKey | ''; client: string } | null,
): boolean {
  if (!saved || saved.text !== text.trim()) return false;
  if (picks === null || saved.picks === null) return picks === null;
  return saved.picks.project === picks.project && saved.picks.client === picks.client;
}

let state: Saved | null = null;
/** The storage text `state` was last read from or written as: a different text means another tab changed it. */
let raw: string | null = null;
/**
 * Memory holds something storage doesn't (a read or the last write failed: blocked or full), so storage is not read
 * over it. Every change still tries to write, and one that gets through puts the two back in step.
 */
let unsaved = false;
/** Whose messages these are; until the app knows (before sign-in), nothing is read from or written to storage. */
let person: string | null = null;
/** Goes up each time a message is saved, for the "Message saved for later" announcement. */
let saves = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of [...listeners]) l();
}

/** Reads storage into `state`; true when that changed it. Entries keep their identity while the text is the same. */
function load(): boolean {
  if (person === null || unsaved) {
    state ??= {};
    return false;
  }
  try {
    const text = window.localStorage.getItem(keptDraftsKey(person));
    if (state !== null && text === raw) return false;
    raw = text;
    state = parseKept(text);
    return true;
  } catch {
    // Storage is blocked (a private window): saved chats last until the page is reloaded.
    unsaved = true;
    state ??= {};
    return false;
  }
}

function read(): Saved {
  if (state === null) load();
  return state ?? {};
}

/**
 * Applies one change on top of what storage holds now, not what this tab read earlier: another tab may have saved
 * or dropped a message since, and writing an old copy back would undo that.
 */
function change(apply: (all: Saved) => Saved): void {
  const moved = state !== null && load();
  const before = read();
  const next = apply(before);
  if (next !== before) {
    state = next;
    try {
      if (person !== null) {
        const text = JSON.stringify(next);
        window.localStorage.setItem(keptDraftsKey(person), text);
        raw = text;
        unsaved = false;
      }
    } catch {
      // Full or blocked: the chat is still saved for as long as the page stays open.
      unsaved = true;
    }
  }
  if (moved || next !== before) notify();
}

/** Another tab saved or dropped a message: this one's buttons follow. */
function onStorage(e: StorageEvent): void {
  if (person === null || (e.key !== null && e.key !== keptDraftsKey(person))) return;
  if (state !== null && load()) notify();
}

export const keptDrafts = {
  get: (key: string | null): KeptDraft | null => (key ? (read()[key] ?? null) : null),
  /** Saves the chat under its key. Text that is only spaces is nothing to keep, so it drops the saved chat. */
  save(key: string, chat: { text: string; picks: KeptDraft['picks'] }): void {
    const text = chat.text.trim();
    if (text === '') {
      keptDrafts.drop(key);
      return;
    }
    saves += 1;
    change((all) => withKept(all, key, { text, picks: chat.picks, savedAt: new Date().toISOString() }));
  },
  drop(key: string | null): void {
    if (key) change((all) => withoutKept(all, key));
  },
  subscribe(listener: () => void): () => void {
    if (listeners.size === 0) window.addEventListener('storage', onStorage);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) window.removeEventListener('storage', onStorage);
    };
  },
  /** Whose kept messages to use, once the app knows who is signed in. Reads that person's from storage. */
  use(who: string): void {
    if (who === person) return;
    person = who;
    state = null;
    raw = null;
    unsaved = false;
    notify();
  },
  /** How many times a message has been saved since the page loaded. */
  saves: (): number => saves,
  /** Forgets what is in memory and reads localStorage again (tests). */
  reload(): void {
    state = null;
    raw = null;
    unsaved = false;
  },
};

/**
 * True for a few seconds after a message is saved for later, for the app's polite status line (nothing shows: the
 * button that opened the chat changes its name instead).
 */
export function useJustKept(ms = 4000): boolean {
  const count = useSyncExternalStore(keptDrafts.subscribe, keptDrafts.saves, () => 0);
  const [seen, setSeen] = useState(count);
  useEffect(() => {
    if (count === seen) return;
    const t = setTimeout(() => setSeen(count), ms);
    return () => clearTimeout(t);
  }, [count, seen, ms]);
  return count !== seen;
}

/** The chat saved under this key, or null; re-renders when it is saved or dropped. */
export function useKeptDraft(key: string | null): KeptDraft | null {
  return useSyncExternalStore(
    keptDrafts.subscribe,
    () => keptDrafts.get(key),
    () => null,
  );
}
