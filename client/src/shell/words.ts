/**
 * Wording shared by the rail, drawers, Home, palette and panel, so a status or a date reads the same
 * everywhere. Contract: `Words` in client/src/shell/contract.ts.
 */
import {
  ATTENTION_LABEL,
  type ClientInfo,
  type LiveSession,
  type SkillInfo,
  SYNC_STALE_MS,
  type TodoItem,
} from '../../../shared/contract.ts';
import { slugWords } from '../../../shared/words.ts';
import type { Words } from './contract.ts';

export const STATE_WORDS: Words['STATE_WORDS'] = {
  starting: ATTENTION_LABEL.working,
  working: ATTENTION_LABEL.working,
  waiting: ATTENTION_LABEL.asking,
  idle: ATTENTION_LABEL.ready,
  error: 'Stopped by a problem',
  closed: 'Ended',
};

export const ROLE_WORDS: Words['ROLE_WORDS'] = {
  owner: 'Owner',
  scout: 'Scout',
  team: 'Team',
  unknown: 'Role not set',
};

export const todoChatDraft: Words['todoChatDraft'] = (todo) =>
  `Help me with this to-do: ${todo.path} (${todo.title})`;

export const whenWords: Words['whenWords'] = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function agoWords(ms: number): string {
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, 'hour');
  return plural(Math.floor(hours / 24), 'day');
}

export const syncWords: Words['syncWords'] = (lastSync, now) => {
  const d = new Date(lastSync ?? '');
  if (!lastSync || Number.isNaN(d.getTime())) {
    return {
      stale: true,
      time: '',
      date: '',
      lead: 'No sync found',
      line: 'No sync found',
      spoken: "The app has not seen the brain sync yet. Check you're online and Brain Connect is running.",
    };
  }
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const age = now - d.getTime();
  if (age <= SYNC_STALE_MS) {
    return {
      stale: false,
      time,
      date,
      lead: 'Synced',
      line: `Synced ${time}, ${date}`,
      spoken: `The brain last synced at ${time} on ${date}.`,
    };
  }
  return {
    stale: true,
    time,
    date,
    lead: 'Not synced since',
    line: `Not synced since ${time}, ${date}`,
    spoken: `The brain has not synced since ${time} on ${date}, ${agoWords(age)} ago. It normally syncs every minute, so check you're online and Brain Connect is running.`,
  };
};

export const starterSkills: Words['starterSkills'] = (boot) => {
  const byName = (name: string) => boot.skills.find((s) => s.name === name);
  const known = (s: SkillInfo | undefined): s is SkillInfo => s !== undefined;
  const pinned = boot.prefs.pins.map(byName).filter(known);
  const often = boot.usedOften
    .map((u) => byName(u.name))
    .filter(known)
    .filter((s) => !boot.prefs.pins.includes(s.name));
  return { pinned, often };
};

/** The Chats rail button's accessible name: "Chats, 2 open, 1 needs your answer". */
export function chatsRailLabel(live: LiveSession[]): string {
  if (live.length === 0) return 'Chats';
  const asking = live.filter((s) => s.state === 'waiting').length;
  const open = `Chats, ${live.length} open`;
  if (asking === 0) return open;
  return `${open}, ${asking} ${asking === 1 ? 'needs' : 'need'} your answer`;
}

/** The To-dos rail button's accessible name: "To-dos, 5 of yours, 2 new". Undefined when there is nothing to add. */
export function todosRailLabel(mine: number, fresh: number): string | undefined {
  if (mine === 0) return undefined;
  return `To-dos, ${mine} of yours${fresh > 0 ? `, ${fresh} new` : ''}`;
}

/** "SE" for "Sam Example": first and last names' first letters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/** A client or project as people say it: the client's name, else its folder name as words. Never a folder name as written. */
export function placeName(slug: string, clients: readonly Pick<ClientInfo, 'slug' | 'name'>[]): string {
  return clients.find((c) => c.slug === slug)?.name ?? slugWords(slug);
}

/** The client and the project of a to-do, by name. A place is said once when both are the same. */
export function todoPlaces(
  todo: Pick<TodoItem, 'client' | 'project'>,
  clients: readonly Pick<ClientInfo, 'slug' | 'name'>[],
): string[] {
  const out: string[] = [];
  for (const slug of [todo.client, todo.project]) {
    if (!slug) continue;
    const name = placeName(slug, clients);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** How long ago, in calendar days, as people say it: "today", "yesterday", "3 days ago". */
function agoDays(at: Date, now: Date): string {
  const day = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  const n = Math.max(0, day(now) - day(at));
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n} days ago`;
}

/** Who passed it on: the name, else the slug as words, else "someone" (the roster may not list them). */
function handoverName(h: NonNullable<TodoItem['handover']>): string {
  return h.byName?.trim() || (h.by ? slugWords(h.by) : '') || 'someone';
}

/** Handovers older than this show no "from" in the row (decision 11). */
export const HANDOVER_ROW_DAYS = 14;

/**
 * The row's "from Ben, yesterday" (a stamp) or "from Ben (git history)". Null when the handover is by
 * the person themselves, unknown, or older than HANDOVER_ROW_DAYS.
 */
export function handoverMeta(
  todo: Pick<TodoItem, 'handover' | 'assignee'>,
  me: string,
  now: Date = new Date(),
): string | null {
  const h = todo.handover;
  // Only for what is yours now: an open to-do stamped "to open" was not passed to you.
  if (!h || h.by === me || todo.assignee !== me) return null;
  const at = new Date(h.at);
  if (Number.isNaN(at.getTime()) || now.getTime() - at.getTime() > HANDOVER_ROW_DAYS * DAY_MS) return null;
  const first = handoverName(h).split(/\s+/)[0] || 'someone';
  return h.source === 'history' ? `from ${first} (git history)` : `from ${first}, ${agoDays(at, now)}`;
}

/** The editor's line: "Passed to you by Ben McAdam, 12 Nov (TDS Brain App)" or "From Ben McAdam (git history), 12 Nov". */
export function handoverLine(todo: Pick<TodoItem, 'handover' | 'assignee'>, me: string): string | null {
  const h = todo.handover;
  // Only for what is yours now: an open to-do stamped "to open" was not passed to you.
  if (!h || h.by === me || todo.assignee !== me) return null;
  const at = new Date(h.at);
  const date = Number.isNaN(at.getTime()) ? '' : `, ${at.getDate()} ${MONTHS[at.getMonth()]}`;
  const name = handoverName(h);
  if (h.source === 'history') return `From ${name} (git history)${date}`;
  return `Passed to you by ${name}${date}${h.via ? ` (${h.via})` : ''}`;
}
