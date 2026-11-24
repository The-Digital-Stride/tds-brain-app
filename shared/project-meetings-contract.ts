/**
 * Projects R2 phase 4 (plan docs/plans/2026-11-23-projects-r2-meetings.md): meetings on the project home.
 *
 * The app has no Google access. It READS `briefing/meetings-cache.json`, which the brain's /gm (Step 3) and
 * `tools/members/command-centre/lib/calendar-live.cjs` already write on each Mac from that person's own calendar.
 * `briefing/` is gitignored, so the list never syncs. The app never writes the cache and never writes meetings
 * into the brain. It keeps a small history of matched meetings in its own data folder, so "Last meeting" still
 * works after the cache has moved on.
 *
 * Overseer blocker 1: the cache is read ONLY when `git check-ignore` says it is ignored (`gitIgnored`,
 * server/brain/library.ts). Not ignored, or git can't say → treated as no cache ('none'), so a synced cache can
 * never show one person's calendar to another.
 *
 * Call notes (decision 19): the brain's meeting-notes skill adds `project: <project slug>` to a call note's
 * frontmatter when the call was about an open project. The app reads it (never writes it).
 */

import type { ProjectKey } from './projects-contract.ts';

// ─── The cache (brain, read only) ───────────────────────────────────────────────────────────────

/** Brain-relative. Written by /gm and calendar-live.cjs; gitignored (`briefing/`). */
export const MEETINGS_CACHE_PATH = 'briefing/meetings-cache.json';

/** One event as /gm writes it (gm SKILL.md Step 3). Every field may be missing or the wrong type: read defensively. */
export interface CachedMeeting {
  id: string;
  title: string;
  /** ISO. */
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  attendees: { name: string | null; email: string | null }[];
  /**
   * R2 phase 4b (shared/project-refs-contract.ts): code-shaped words from the invite DESCRIPTION, at most
   * MEETING_REFS_MAX. Absent from older caches. The description itself is never in the cache.
   */
  refs?: string[];
}

export interface MeetingsCacheFile {
  generated: string;
  source: string;
  meetings: CachedMeeting[];
}

/** The cache counts as stale (shown with "Calendar last checked …") when `generated` is older than this. */
export const MEETINGS_STALE_MS = 3 * 24 * 60 * 60 * 1000;

// ─── The history (app data folder, this Mac only) ───────────────────────────────────────────────

export const MEETING_HISTORY_FILE = 'project-meetings.json';
/** Matched meetings older than this (by start) are dropped. */
export const MEETING_HISTORY_DAYS = 90;
/** At most this many kept; the oldest start is dropped first. */
export const MEETING_HISTORY_MAX = 500;

/**
 * A matched meeting as kept. ONLY meetings that have ended are kept (overseer blocker 2), keyed by `id` AND
 * `start` together (a recurring series can share one id). "Next meeting" comes from the cache alone, so a
 * cancelled or moved future meeting never lingers. Attendee NAMES only: emails are used for matching in memory,
 * never stored or sent to the page. `key` and `match` are as matched when it was last seen in the cache.
 */
export interface KeptMeeting {
  id: string;
  key: ProjectKey;
  match: ProjectMatch;
  title: string;
  start: string;
  end: string | null;
  /** Display names of the other people (not this person), as the calendar gave them; emails never kept. */
  people: string[];
  /** How many other people there were (names can be missing). */
  others: number;
}

/** `{ v: 1, meetings: KeptMeeting[] }`. A bad read never wipes the file (as project-seen.json). */
export interface MeetingHistoryFile {
  v: 1;
  meetings: KeptMeeting[];
}

/**
 * How the meeting's project was found (decision 4). 'title': the meeting title names the project. 'only': the
 * client has exactly one open project and the title named none, so it's a likely guess (the File-the-notes prompt
 * asks Claude to check it with the person). 'ref' (R2 phase 4b): a project code in the title or description
 * resolved to exactly one project, and no attendee domain points at a different client; the prompt states the
 * project without asking.
 */
export type ProjectMatch = 'title' | 'only' | 'ref';

// ─── Reading (server → app) ─────────────────────────────────────────────────────────────────────

export interface MeetingView {
  id: string;
  title: string;
  start: string;
  end: string | null;
  /** Up to MEETING_PEOPLE_SHOWN names; `others` is the full count, for "+2". */
  people: string[];
  others: number;
  match: ProjectMatch;
  /**
   * Last meeting only (always null on `next`): the filed call note for it, or null when none was found. A call
   * note is looked for in the client's `call-notes/` folder (or the project folder for internal and personal
   * projects) and matches when EITHER its `meeting_start` is within MEETING_NOTE_MATCH_MS of the start (tag or
   * not, so notes filed before this release count), OR it has no `meeting_start`, its `date` is the meeting's local
   * date and its `project:` is this project (or it sits in this project's folder). `id` is the library item id,
   * so the page can open it in Documents; `path` is brain-relative.
   */
  notes: { id: string; path: string } | null;
}

export const MEETING_PEOPLE_SHOWN = 3;
export const MEETING_NOTE_MATCH_MS = 30 * 60 * 1000;

/**
 * `GET ROUTES.projectMeetings?key=<ProjectKey>` → this. Only ever this Mac's own calendar; the server never asks
 * another Mac or the brain's shared files for meetings.
 */
export interface ProjectMeetingsResponse {
  /** 'none': no cache on this Mac (calendar not set up, or /gm not run yet). */
  cache: 'none' | 'fresh' | 'stale';
  /** The cache's `generated`, when there is one. */
  checked: string | null;
  /** The most recent matched meeting that has ended, from the cache or the history. */
  last: MeetingView | null;
  /** The soonest matched meeting that hasn't ended (an in-progress one counts). */
  next: MeetingView | null;
}

// Coming up: the PAGE adds `next` to the "Coming up" list when it starts within COMING_UP_DAYS (overseer ruling).
// The activity service and shared/project-activity-contract.ts stay calendar-free, so nothing private can ride
// into a later shared read (the phase 6 digest).

/** The server re-reads the cache into the history this often, besides at start-up and on each read (blocker 4). */
export const MEETINGS_MERGE_EVERY_MS = 30 * 60 * 1000;

// ROUTES addition (shared/contract.ts): projectMeetings: '/api/projects/meetings' (GET).
