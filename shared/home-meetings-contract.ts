/**
 * Home meetings and calendar links (plan docs/plans/2026-11-24-home-meetings.md).
 *
 * Ian (2026-11-24): "When you show up and coming meetings, always include the link to Google Calendar. Also, on the
 * home page, show up and coming meeting for the user in a efficient layout … and display all meeting regardless of
 * existing in a project or not. The purpose of Cortex is to keep the user organised."
 *
 * Same source and guards as R2 phase 4 (shared/project-meetings-contract.ts): the server READS this Mac's
 * gitignored `briefing/meetings-cache.json` (only when `git check-ignore` says ignored), never writes it, never
 * asks another Mac. Attendee emails are used in memory for matching and never reach the page.
 */

import type { ProjectKey } from './projects-contract.ts';

// ─── Links (decisions 1–3) ──────────────────────────────────────────────────────────────────────

/**
 * The cache's `link` (Google's `htmlLink`) is kept only when it parses as https on one of these hosts with a path
 * under `/calendar/`. Anything else is dropped and the day link is used instead.
 */
export const CALENDAR_LINK_HOSTS: readonly string[] = ['www.google.com', 'calendar.google.com'];

/**
 * The cache's `join` (the video call: Google's `hangoutLink` or `conferenceData` video entry point) is kept only
 * when it parses as https on one of these hosts or a subdomain of the `.`-prefixed ones. Anything else: no Join.
 * An invite's location text is never turned into a link.
 */
export const JOIN_LINK_HOSTS: readonly string[] = [
  'meet.google.com',
  'teams.microsoft.com',
  'teams.live.com',
  'zoom.us',
  '.zoom.us',
];

/** "Open Google Calendar" in the Home card's head (UX spec). */
export const CALENDAR_HOME_URL = 'https://calendar.google.com/calendar/r';

/** When a meeting has no usable event link: Google Calendar's day view on its local date (`/r/day/Y/M/D`). */
export const CALENDAR_DAY_URL = 'https://calendar.google.com/calendar/r/day/';

/**
 * PRIVACY (overseer ruling): an event link's `eid` is base64 of the event id plus a calendar address, so treat
 * `calendar` like an email. It may live only in the cache, the app's own data file (`project-meetings.json`) and
 * this Mac's page. It never goes into a chat prompt, a log, error text, a brain file or any shared read.
 *
 * Both links as the page gets them. `calendar` is ALWAYS set: the event's own page when the cache had a good link,
 * else the day view (`calendarKind: 'day'`). `join` is null when there's no allowed video link.
 */
export interface MeetingLinks {
  calendar: string;
  calendarKind: 'event' | 'day';
  join: string | null;
}

// ─── Home (decisions 6–11) ──────────────────────────────────────────────────────────────────────

/** Home shows meetings that haven't ended, from now to this many days ahead (the cache holds 14). */
export const HOME_MEETING_DAYS = 14;

/**
 * Event kinds (`kind` in the cache, Google's `eventType`) that are not meetings: dropped everywhere the cache is
 * read. A missing kind (older caches) shows.
 */
export const NOT_MEETING_KINDS: readonly string[] = [
  'workingLocation',
  'outOfOffice',
  'birthday',
  'focusTime',
];

/**
 * One upcoming meeting on Home, project or not.
 *
 * All-day (overseer blocker 1): `start`/`end` are plain dates (`YYYY-MM-DD`, end EXCLUSIVE as Google sends it; no
 * end = one day) and are never passed to `new Date()`. It counts as ended once the local date reaches `end`.
 */
export interface HomeMeeting extends MeetingLinks {
  id: string;
  title: string;
  /** ISO date-time; for an all-day meeting a plain `YYYY-MM-DD`. */
  start: string;
  end: string | null;
  allDay: boolean;
  /**
   * The local date (`YYYY-MM-DD`) the row is listed under: the start date, or today for an all-day meeting that
   * began earlier and is still running. The page groups by this; rows come all-day first within a day.
   */
  day: string;
  /** An all-day meeting running past `day`: its last day (`end` minus one day). Null otherwise. For "until Fri 27 Nov". */
  lastDay: string | null;
  /** Up to MEETING_PEOPLE_SHOWN display names (never emails); `others` is the full count. */
  people: string[];
  others: number;
  /** The open (not archived) project it matched, as phase 4/4b match it; null when none. */
  project: { key: ProjectKey; title: string; ref: string | null } | null;
  /**
   * The client it belongs to: the project's client, else the client its attendees or title point at; null when
   * none, and null for the agency's own (internal) client.
   */
  client: { slug: string; name: string } | null;
}

/** `GET ROUTES.homeMeetings` → this. Only ever this Mac's own calendar. */
export interface HomeMeetingsResponse {
  /** As ProjectMeetingsResponse: 'none' when there's no (ignored) cache on this Mac. */
  cache: 'none' | 'fresh' | 'stale';
  checked: string | null;
  /**
   * Not ended, `day` within HOME_MEETING_DAYS of today, ordered by `day`, then all-day first, then start time.
   * `checked` is ALWAYS shown on the card ("Calendar checked today 08:12"), stale or not (overseer blocker 2).
   */
  meetings: HomeMeeting[];
}

/** The Home card re-reads this often while it's on screen, so finished meetings drop off. */
export const HOME_MEETINGS_REFRESH_MS = 5 * 60 * 1000;

// ROUTES addition (shared/contract.ts): homeMeetings: '/api/meetings' (GET).
