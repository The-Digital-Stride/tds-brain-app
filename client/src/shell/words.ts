/**
 * Wording shared by the rail, drawers, Home, palette and panel, so a status or a date reads the same
 * everywhere. Contract: `Words` in client/src/shell/contract.ts.
 */

import { BRAND } from '../../../shared/brand.ts';
import {
  type AskedTodo,
  ATTENTION_LABEL,
  type ClientInfo,
  type DoneTodo,
  type LiveSession,
  type SkillInfo,
  SYNC_STALE_MS,
  type TeamMember,
  type TodoActor,
  type TodoEvent,
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

/** Upper-cases the first letter: the details line's parts each start with a capital. */
export const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

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

/** To-dos stamped before the rename say this; they are shown under the app's current name. */
const LEGACY_VIA = 'TDS Brain App';
const viaName = (via: string) => (via === LEGACY_VIA ? BRAND : via);

/** The editor's line: "Passed to you by Ben McAdam, 12 Nov (TDS Brain App)" or "From Ben McAdam (git history), 12 Nov". */
export function handoverLine(todo: Pick<TodoItem, 'handover' | 'assignee'>, me: string): string | null {
  const h = todo.handover;
  // Only for what is yours now: an open to-do stamped "to open" was not passed to you.
  if (!h || h.by === me || todo.assignee !== me) return null;
  const at = new Date(h.at);
  const date = Number.isNaN(at.getTime()) ? '' : `, ${at.getDate()} ${MONTHS[at.getMonth()]}`;
  const name = handoverName(h);
  if (h.source === 'history') return `From ${name} (git history)${date}`;
  return `Passed to you by ${name}${date}${h.via ? ` (${viaName(h.via)})` : ''}`;
}

/** "13 Nov" for an ISO date or timestamp; '' when it can't be read. */
export function shortDay(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

/** "13 Nov, 14:05" (the viewer's own clock); '' when it can't be read. */
export function shortDayTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getDate()} ${MONTHS[at.getMonth()]}, ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** The asked-of-others row's second line: "With Ben McAdam · since 13 Nov", "Done by Ben McAdam · 14 Nov". */
export function askedMeta(t: Pick<AskedTodo, 'state' | 'assigneeName' | 'asked' | 'done'>): string {
  if (t.state === 'done') {
    const day = t.done ? shortDay(t.done.at) : '';
    const first = t.done?.name?.split(/\s+/)[0];
    const who = first ? `Done by ${first}` : 'Done';
    return day ? `${who}, ${day}` : who;
  }
  const day = shortDay(t.asked.at);
  const first = t.assigneeName.split(/\s+/)[0] || t.assigneeName;
  return day ? `With ${first} since ${day}` : `With ${first}`;
}

/** The panel's status line for an asked-of-others to-do. Names from git history say "(git history)". */
export function askedStatusLine(t: Pick<AskedTodo, 'state' | 'assigneeName' | 'asked' | 'done'>): string {
  if (t.state === 'done') {
    const day = t.done ? shortDay(t.done.at) : '';
    const who = t.done?.name ? `Done by ${t.done.name}` : 'Done';
    const tag = day && t.done?.source === 'history' ? ' (git history)' : '';
    return day ? `${who}, ${day}${tag}` : who;
  }
  const day = shortDay(t.asked.at);
  const tag = day && t.asked.source === 'history' ? ' (git history)' : '';
  return day ? `With ${t.assigneeName} since ${day}${tag}` : `With ${t.assigneeName}`;
}

/** The panel's status line for a teammate's open to-do: "With Ben McAdam", or "Open to anyone". */
export function teamStatusLine(t: { assigneeName: string | null }): string {
  return t.assigneeName ? `With ${t.assigneeName}` : 'Open to anyone';
}

/** The footer line saying why a teammate's to-do can't be changed from here. */
export function teamNote(t: { assigneeName: string | null }): string {
  const first = t.assigneeName?.trim().split(/\s+/)[0];
  return t.assigneeName
    ? `This is ${first}'s to-do, so you can read it but not change it.`
    : 'This to-do is open to anyone. Pick it up from the Open tab to change it.';
}

/** The Done tab's row line: "Done by Sam, 12 Nov", "Done 12 Nov", or "Date not known". */
export function doneMeta(t: Pick<DoneTodo, 'done'>): string {
  const day = t.done ? shortDay(t.done.at) : '';
  if (!day) return 'Date not known';
  const first = t.done?.name?.split(/\s+/)[0];
  return first ? `Done by ${first}, ${day}` : `Done ${day}`;
}

const LONG_MONTHS = [
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

/** The panel's status line for a finished to-do: "Done by Sam Example on 12 November 2026". */
export function doneStatusLine(t: Pick<DoneTodo, 'done'>): string {
  const at = t.done ? new Date(t.done.at) : null;
  if (!t.done || !at || Number.isNaN(at.getTime())) return 'Done; date not known';
  const day = `${at.getDate()} ${LONG_MONTHS[at.getMonth()]} ${at.getFullYear()}`;
  const tag = t.done.source === 'history' ? ' (git history)' : '';
  return `${t.done.name ? `Done by ${t.done.name}` : 'Done'} on ${day}${tag}`;
}

/** A name for a slug in a history line: the roster's, else the slug as words; 'open' means anyone. */
function historyWho(
  slug: string | null | undefined,
  team: readonly Pick<TeamMember, 'slug' | 'name'>[],
): string {
  if (!slug) return 'no one';
  if (slug === 'open') return 'anyone';
  return team.find((m) => m.slug === slug)?.name ?? slugWords(slug);
}

/** Who did it, for a history line: the actor's name, else "Someone". */
export function actorName(actor: TodoActor): string {
  return actor.name?.trim() || 'Someone';
}

/**
 * What a history event says after the actor's name: "passed it from Ian Hancock to Ben McAdam". The
 * actor is named by the caller (it may carry a mark for the sync record).
 */
export function eventWords(e: TodoEvent, team: readonly Pick<TeamMember, 'slug' | 'name'>[]): string {
  switch (e.kind) {
    case 'created':
      return e.to === 'open' || !e.to ? 'added it, open to anyone' : `added it for ${historyWho(e.to, team)}`;
    case 'passed-on':
      return `passed it from ${historyWho(e.from, team)} to ${historyWho(e.to, team)}`;
    case 'retitled':
      return e.from ? `renamed it from \u2018${e.from}\u2019` : 'renamed it';
    case 'due': {
      const day = e.to ? shortDay(e.to) : '';
      return day ? `set the due date to ${day}` : 'cleared the due date';
    }
    case 'details':
      return 'changed the details';
    case 'done':
      return 'ticked it off';
    case 'deleted':
      return 'deleted it';
    default:
      return 'changed it';
  }
}
