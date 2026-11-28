import type { Certainty, ConnectionState, DayStatus, EntrySource } from '../../../../shared/time-contract.ts';

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
/** "Friday 27 November 2026". */
export function dateWords(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : dayFormat.format(d).replace(',', '');
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
