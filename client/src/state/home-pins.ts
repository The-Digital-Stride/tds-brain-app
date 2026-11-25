import type { LiveSession, PastSession, TodoItem } from '../../../shared/contract.ts';
import type { ProjectCard } from '../../../shared/projects-contract.ts';
import { isFavourite, splitFavourites } from './chat-favourites.ts';
import { sortChats } from './chats.ts';
import { isOpenProject } from './projects.ts';
import { splitFavouriteTodos } from './todo-favourites.ts';

/** How many rows a pinned card shows on Home; the rest are one click away in the drawer or app. */
export const PINNED_ROWS = 5;

/**
 * The starred to-dos Home lists (plan 2026-11-15-home-pinned-cards): the person's own, then ones open to anyone,
 * in the order the To-dos drawer shows its Favourites.
 */
export function pinnedTodos(mine: TodoItem[], open: TodoItem[], favs: readonly string[]): TodoItem[] {
  return splitFavouriteTodos([...mine, ...open], favs).favourites;
}

export type PinnedChat = { kind: 'live'; chat: LiveSession } | { kind: 'past'; chat: PastSession };

/**
 * The starred chats Home lists, in the Chats drawer's order: open chats first (needs an answer, then working,
 * ready, stopped), then earlier ones as the drawer lists them. A chat open and earlier at once shows once.
 */
export function pinnedChats(live: LiveSession[], past: PastSession[], favs: readonly string[]): PinnedChat[] {
  if (favs.length === 0) return [];
  const open = sortChats(live).filter((s) => isFavourite(s, favs));
  const openIds = new Set(open.map((s) => s.sdkSessionId));
  const earlier = splitFavourites(past, favs).favourites.filter((s) => !openIds.has(s.sdkSessionId));
  return [
    ...open.map((chat): PinnedChat => ({ kind: 'live', chat })),
    ...earlier.map((chat): PinnedChat => ({ kind: 'past', chat })),
  ];
}

/** Newest pin first: the star list is stored oldest first, so a new pin is never hidden by the row cap. */
export function pinnedFileIds(favs: readonly string[]): string[] {
  return [...favs].reverse();
}

/**
 * The projects Home lists under "Recent projects": open, non-archived ones with a known last-worked date,
 * newest first (`lastChanged.at` is the last git commit on the project's folder).
 */
export function recentProjects(cards: readonly ProjectCard[] | undefined): ProjectCard[] {
  const list = cards ?? [];
  // A server that read this person's history sends `lastMine` on every card (null when they never worked on it):
  // then only their own projects show, by their own last change (plan 2026-11-25-my-recents, decision 3).
  if (list.some((c) => c.lastMine !== undefined)) {
    return list
      .filter((c) => isOpenProject(c) && Boolean(c.lastMine))
      .sort((a, b) => Date.parse(b.lastMine ?? '') - Date.parse(a.lastMine ?? ''));
  }
  return list
    .filter((c) => isOpenProject(c) && Boolean(c.lastChanged))
    .sort((a, b) => Date.parse(b.lastChanged?.at ?? '') - Date.parse(a.lastChanged?.at ?? ''));
}

/** The date Recent projects shows for a card, and whether it is this person's own last change. */
export function projectWorkedOn(c: ProjectCard): { at: string; mine: boolean } {
  return c.lastMine ? { at: c.lastMine, mine: true } : { at: c.lastChanged?.at ?? '', mine: false };
}

/** Most rows a Recent card ever holds (the server's cap for files; tasks and chats are cut to match). */
export const RECENT_MAX = 20;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/**
 * When a task reached the person and how to say so: "Passed to you" when someone else passed it to `me` after it was made,
 * else "Added" from `created` (first 10 characters, when a YYYY-MM-DD date), else the file name's date when it
 * is today or earlier (a later one is a reminder date, not an arrival). `date` is an ISO timestamp or a day.
 */
export function todoArrival(
  t: TodoItem,
  today: string,
  me: string | null,
): { date: string; word: 'Added' | 'Passed to you' } | null {
  const created = t.created && ISO_DAY.test(t.created) ? t.created.slice(0, 10) : null;
  // Only a task passed on to this person by someone else counts; one open to anyone, or taken by them, is "Added".
  const toMe = Boolean(me) && t.assignee === me && t.handover?.by !== me;
  const passed = toMe && t.handover?.at && !Number.isNaN(Date.parse(t.handover.at)) ? t.handover.at : null;
  if (passed && (!created || passed.slice(0, 10) > created)) return { date: passed, word: 'Passed to you' };
  if (created) return { date: created, word: 'Added' };
  if (t.surfaceDate && ISO_DAY.test(t.surfaceDate) && t.surfaceDate <= today)
    return { date: t.surfaceDate, word: 'Added' };
  return null;
}

/**
 * The tasks Home lists under "Recent tasks": the ones assigned to this person (plan 2026-11-25-my-recents), TDS
 * scope only (private titles stay off Home unless pinned), once each, newest arrival first, undated last, ties by
 * title.
 */
export function recentTodos(mine: TodoItem[], today: string, me: string | null): TodoItem[] {
  const seen = new Set<string>();
  const rows: { t: TodoItem; at: number }[] = [];
  for (const t of mine) {
    if (t.scope !== 'tds' || seen.has(t.key)) continue;
    seen.add(t.key);
    const a = todoArrival(t, today, me);
    rows.push({ t, at: a ? Date.parse(a.date) : Number.NEGATIVE_INFINITY });
  }
  rows.sort((a, b) => (a.at === b.at ? a.t.title.localeCompare(b.t.title) : b.at - a.at));
  return rows.map((r) => r.t);
}

const stamp = (iso: string) => {
  const n = Date.parse(iso);
  return Number.isNaN(n) ? Number.NEGATIVE_INFINITY : n;
};

/**
 * The chats Home lists under "Recent chats": open and earlier together, newest activity first. A chat open
 * and earlier at once shows once, as open.
 */
export function recentChats(live: LiveSession[], past: PastSession[]): PinnedChat[] {
  const openIds = new Set(live.map((s) => s.sdkSessionId).filter((id): id is string => Boolean(id)));
  const rows: { row: PinnedChat; at: number }[] = [
    ...live.map((chat) => ({ row: { kind: 'live', chat } as PinnedChat, at: stamp(chat.lastActivityAt) })),
    ...past
      .filter((s) => !openIds.has(s.sdkSessionId))
      .map((chat) => ({ row: { kind: 'past', chat } as PinnedChat, at: stamp(chat.lastModified) })),
  ];
  return rows.sort((a, b) => b.at - a.at).map((r) => r.row);
}
