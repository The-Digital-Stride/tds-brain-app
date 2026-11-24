/**
 * Home meetings plan decisions 2–3 (docs/plans/2026-11-24-home-meetings.md): the links a meeting carries to the
 * page. The cache is a brain file anyone's tooling could write, so a link is kept only when it is https on an
 * allowed host; anything else is dropped. Every meeting still gets a calendar link: the day view as a fallback.
 */
import {
  CALENDAR_DAY_URL,
  CALENDAR_LINK_HOSTS,
  JOIN_LINK_HOSTS,
  type MeetingLinks,
} from '../../shared/home-meetings-contract.ts';

const MAX_LINK = 2048;

function httpsUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > MAX_LINK) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  return url;
}

/** The event's Google Calendar page, or null when it isn't one. */
export function cleanCalendarLink(raw: unknown): string | null {
  const url = httpsUrl(raw);
  if (!url || !CALENDAR_LINK_HOSTS.includes(url.hostname) || !url.pathname.startsWith('/calendar/'))
    return null;
  return url.href;
}

/** The video call link, or null when it isn't Meet, Teams or Zoom. */
export function cleanJoinLink(raw: unknown): string | null {
  const url = httpsUrl(raw);
  if (!url) return null;
  const host = url.hostname;
  const ok = JOIN_LINK_HOSTS.some((h) =>
    h.startsWith('.') ? host.endsWith(h) && host.length > h.length : host === h,
  );
  return ok ? url.href : null;
}

/** Google Calendar's day view on the meeting's local date. A plain `YYYY-MM-DD` (all-day) is used as written. */
export function dayLink(start: string): string {
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (plain) return `${CALENDAR_DAY_URL}${plain[1]}/${Number(plain[2])}/${Number(plain[3])}`;
  const d = new Date(start);
  return `${CALENDAR_DAY_URL}${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function meetingLinks(m: { link?: unknown; join?: unknown; start: string }): MeetingLinks {
  const event = cleanCalendarLink(m.link);
  return {
    calendar: event ?? dayLink(m.start),
    calendarKind: event ? 'event' : 'day',
    join: cleanJoinLink(m.join),
  };
}

// ─── Days (overseer blocker 1): all-day dates stay plain dates, never `new Date()` ────────────────

const PLAIN = /^(\d{4})-(\d{2})-(\d{2})/;

/** `YYYY-MM-DD` of a moment in this Mac's own time zone. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** An all-day value's date as written (`2026-11-25` or `2026-11-25T00:00:00Z` → `2026-11-25`), or null. */
export function plainDate(v: string | null): string | null {
  const m = v ? PLAIN.exec(v) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** A plain date moved by whole days (calendar arithmetic in UTC, so no time zone can shift it). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}
