import type {
  Certainty,
  ConnectionState,
  DayEntryView,
  DayStatus,
  DayView,
  EntrySource,
} from '../../../../shared/time-contract.ts';

/** The Toolbox day is a Europe/London day (plan 2026-11-28-time-my-day), so every clock time here is London time. */
const LONDON = 'Europe/London';

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const offsetFormat = new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, timeZoneName: 'longOffset' });

/** 75 -> "1:15", 5 -> "0:05". */
export function hoursWords(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** 75 -> "1 hour 15 minutes": what a screen reader says for a duration shown as "1:15". */
export function durationWords(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
  if (rest > 0 || h === 0) parts.push(`${rest} ${rest === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ');
}

/** An ISO instant as London "HH:MM", or null. */
export function londonClock(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : clock.format(new Date(t));
}

/** The London offset ("+00:00" or "+01:00") at an instant. */
function offsetAt(ms: number): string {
  const name =
    offsetFormat.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return '+00:00';
  return `${m[1]}${(m[2] ?? '0').padStart(2, '0')}:${m[3] ?? '00'}`;
}

/**
 * London `date` and "HH:MM" as an ISO 8601 string with the London offset, or null when `hhmm` isn't a time.
 * A time that does not exist (the spring clocks change) moves on an hour, as the Mac's own clock would.
 */
export function londonIso(date: string, hhmm: string): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const naive = Date.parse(`${date}T${hhmm}:00Z`);
  if (Number.isNaN(naive)) return null;
  const guess = offsetAt(naive);
  const sign = guess.startsWith('-') ? -1 : 1;
  const off = sign * (Number(guess.slice(1, 3)) * 60 + Number(guess.slice(4, 6)));
  const real = offsetAt(naive - off * 60_000);
  return `${date}T${hhmm}:00${real}`;
}

/** The end of an entry as London "HH:MM". */
export function endClock(startAt: string | null, minutes: number): string | null {
  if (!startAt) return null;
  const t = Date.parse(startAt);
  return Number.isNaN(t) ? null : clock.format(new Date(t + minutes * 60_000));
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const dayFormatShort = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
/** "Friday 27 November 2026"; with `today` given, the year is dropped when it is the current year. */
export function dateWords(date: string, today?: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  const sameYear = today !== undefined && today.slice(0, 4) === date.slice(0, 4);
  return (sameYear ? dayFormatShort : dayFormat).format(d).replace(',', '');
}

/** The heading over the day: "Today, Saturday 28 November" on today. */
export function dayTitle(date: string, today: string): string {
  return date === today ? `Today, ${dateWords(date, today)}` : dateWords(date, today);
}

/** The day's entries in time order, those with no clock time last. */
export function entriesInOrder(day: DayView): DayEntryView[] {
  const timed: { at: number; entry: DayEntryView }[] = [];
  const untimed: DayEntryView[] = [];
  for (const entry of day.entries) {
    const at = entry.values.startAt ? Date.parse(entry.values.startAt) : Number.NaN;
    if (Number.isNaN(at)) untimed.push(entry);
    else timed.push({ at, entry });
  }
  timed.sort((a, b) => a.at - b.at);
  return [...timed.map((t) => t.entry), ...untimed];
}

/** An entry that still needs words or a work item before the day can be confirmed. */
export function needsAttention(entry: DayEntryView): boolean {
  return entry.values.description.trim() === '' || entry.values.workItemId === null || entry.workItemClosed;
}

/** The next entry after `afterId`, in time order and wrapping round, that needs attention; null when none does. */
export function nextNeedingAttention(day: DayView, afterId: string): string | null {
  const all = entriesInOrder(day);
  const at = all.findIndex((e) => e.id === afterId);
  const ordered = at < 0 ? all : [...all.slice(at + 1), ...all.slice(0, at)];
  return ordered.find((e) => e.id !== afterId && needsAttention(e))?.id ?? null;
}

export const STATUS_WORDS: Record<DayStatus, string> = {
  'not-confirmed': 'Not confirmed',
  confirmed: 'Confirmed',
  changed: 'Changed since confirmed',
  'not-sent': 'Not sent',
  conflict: 'Conflict',
};

export const STATUS_TONE: Record<DayStatus, 'ok' | 'warn' | 'bad' | 'muted'> = {
  'not-confirmed': 'muted',
  confirmed: 'ok',
  changed: 'warn',
  'not-sent': 'warn',
  conflict: 'bad',
};

export function sourceWords(source: EntrySource, fromToolbox: boolean): string {
  if (fromToolbox || source === 'import-tracket') return 'From Toolbox';
  switch (source) {
    case 'cortex-chat':
      return 'From chat';
    case 'manual':
      return 'Added by you';
    case 'cortex-task':
      return 'From a task';
    case 'cortex-time':
      return 'From a timer';
    case 'calendar':
      return 'From your calendar';
    default:
      return 'From Toolbox';
  }
}

/** The certainty chip, or null where there is nothing to say (the person's own pick). */
export function certaintyWords(c: Certainty): string | null {
  switch (c) {
    case 'certain':
      return 'Certain';
    case 'strong':
      return 'Strong';
    case 'suggested':
      return 'Check';
    case 'unassigned':
      return 'Unassigned';
    default:
      return null;
  }
}

export function lostWords(reason: Extract<ConnectionState, { state: 'lost' }>['reason']): string {
  if (reason === 'expired') return 'Your connection to Toolbox has run out.';
  if (reason === 'revoked') return 'Toolbox closed this connection.';
  return 'Toolbox refused the connection.';
}

/** Words the My day screens use that are longer than a label. */
export const CONNECT_NOTICE = 'Connect to Toolbox to pick work items and confirm your day.';
export const NO_ADDRESS_NOTICE =
  'Cortex does not know where Toolbox is yet. An owner or scout sets its address in Settings.';
export const WAITING_NOTICE = 'Waiting for you to press Allow in Toolbox.';
export const CONNECTED_WORDS = 'Connected to Toolbox.';
export const DESCRIPTION_PLACEHOLDER = 'Add a description';
/** The chat's own title, shown as a hint (plan decision 32). It reaches Toolbox only if used as the description. */
export const chatTitleWords = (hint: string): string => `Chat title: ${hint}`;
export const USE_AS_DESCRIPTION = 'Use as description';
export const HINT_RESTRICTED = 'This chat is in a restricted project, so type the description yourself.';
/** The row's open-chat button (decision A). */
export const openChatLabel = (hint: string | null): string =>
  hint ? `Open chat: ${hint}` : 'Open the chat this came from';
export const CHOOSE_ENTRY = 'Choose an entry to edit it, or add a new one.';

export const START_ERROR = 'Enter the start time as hours and minutes.';
export const minutesError = (max: number): string => `Enter whole minutes, from 1 to ${max}.`;

/** The empty day. Refresh is hidden on a confirmed day, so it is only mentioned when it is there. */
export function emptyDayWords(confirmed: boolean): string {
  return confirmed
    ? 'Nothing recorded for this day. Add an entry.'
    : 'Nothing recorded for this day yet. Add an entry, or refresh to read your chats again.';
}

/** "2 of 5 need a description or work item" (a part of the header summary, so no full stop). */
export function needWords(need: number, total: number): string {
  return `${need} of ${total} need a description or work item`;
}
