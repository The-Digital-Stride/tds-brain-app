/**
 * Projects R2 phase 3 (plan docs/plans/2026-11-23-projects-r2-activity.md): activity on the project home.
 * "Since you last looked" and "Coming up" on a project's Overview. Everything is worked out on read; the only
 * thing kept is this person's "last looked" snapshot per project, in the app's data folder on this Mac
 * (never the brain). The app writes no brain files for this phase.
 */

import type { ProjectKey } from './projects-contract.ts';

// ─── The seen store (app data folder) ────────────────────────────────────────────────────────────

export const PROJECT_SEEN_FILE = 'project-seen.json';
/** Projects remembered; the oldest `at` is dropped past this (overseer nice: keep the file small). */
export const PROJECT_SEEN_MAX = 200;
/** Paths or ids kept per list in one snapshot; a bigger list is cut (newest kept) and marked `cut`. */
export const PROJECT_SEEN_LIST_MAX = 500;

/**
 * What this person had seen of one project when they last looked. Lists, not dates, so personal projects
 * (not in git) and files with odd timestamps work the same way.
 */
export interface ProjectSeen {
  /** ISO time they last looked. */
  at: string;
  /** The project's folder when the snapshot was taken. A different folder now (a move) counts as a first visit. */
  folder: string;
  /** Open to-do keys (ProjectTodoRow.key) in the project then. */
  todos: string[];
  /** The card's `links` then. */
  links: string[];
  /** The project's files then, as paths RELATIVE to the project folder (so a move can't list every file as new). */
  files: string[];
  /**
   * Paths of the updates-log entries seen then (the newest UPDATES_PAGE). An entry is new when its path isn't here,
   * so a teammate's note that syncs in late still shows (correctness review). Older snapshots without it fall back
   * to "written after `at`".
   */
  updates?: string[];
  /** Titles of the open to-dos then, by key, so a to-do that's gone can still be named (dropped when unknown). */
  todoTitles?: Record<string, string>;
  /** True when a list was cut at PROJECT_SEEN_LIST_MAX (then "added" from that list is not shown). */
  cut?: true;
}

/** `{ v: 1, projects: { [ProjectKey]: ProjectSeen } }`. A bad read never wipes the file (as chat-places.json). */
export interface ProjectSeenFile {
  v: 1;
  projects: Record<string, ProjectSeen>;
}

// ─── Reading (server → app) ──────────────────────────────────────────────────────────────────────

/** Items shown at most in "Since you last looked"; `more` says how many were left out. */
export const ACTIVITY_MAX = 20;
/** "Coming up": open to-dos due within this many days (overdue ones too), and the end date within it. */
export const COMING_UP_DAYS = 14;

export type ActivityKind =
  | 'update' // a note or call in the updates log (phase 2)
  | 'status' // an automatic status, health or Account Owner entry (phase 2)
  | 'todo-added'
  | 'todo-closed' // done, or gone from the project (moved, deleted)
  | 'file-added' // a new file in the project folder
  | 'link-added'; // a new line in the card's Linked files (call notes, data pulls, ad files…)

/**
 * Overseer rulings (pre-review, 2026-11-23):
 * - Update rows say who and what kind only ("Sam Taylor added a note", "… added a call", "Health changed",
 *   any other kind: "… added an update"). NEVER the summary or an email subject.
 * - The person's own changes are left out where the data says who (an update's `by`, a to-do's done stamp).
 * - Personal to-dos follow the To-dos tab: the person's OWN personal to-dos show in a shared project, to them only.
 * - A to-do that's gone and whose title isn't known is skipped (no blank rows).
 * - Files are nameless (no git for uncommitted or personal files).
 */
export interface ActivityItem {
  kind: ActivityKind;
  /** One line of plain text, e.g. "Sam Taylor added a note", "To-do done: Send the quote". */
  text: string;
  /** ISO time when known (updates log `at`, to-do done time); null when only "since you looked" is known. */
  at: string | null;
  /** Team display name when known, else null. */
  byName: string | null;
  /** What it opens: a to-do key, a brain path, or the Updates tab. */
  target: { kind: 'todo'; key: string } | { kind: 'file'; path: string } | { kind: 'updates' };
}

export interface ComingUpItem {
  kind: 'todo-due' | 'project-end';
  text: string;
  /** YYYY-MM-DD. */
  date: string;
  overdue: boolean;
  target: { kind: 'todo'; key: string } | null;
}

/**
 * `GET ROUTES.projectActivity?key=<ProjectKey>` → this. Reading never changes the seen record.
 * `since` null means this person has never looked at this project on this Mac: `items` is empty and the app
 * says changes will show from the next visit.
 */
export interface ProjectActivityResponse {
  since: string | null;
  /**
   * Overseer blocker 1: the server keeps the snapshot of exactly what this read saw, under this token (in memory,
   * one per project and person, replaced by the next read, gone after ACTIVITY_TOKEN_TTL_MS or a restart). The app
   * sends it back on `projectSeen`, so only what was shown gets marked seen. Null for an archived project.
   */
  token: string | null;
  /** Newest first where `at` is known; items without `at` after those, in kind order. At most ACTIVITY_MAX. */
  items: ActivityItem[];
  /** How many more there were beyond ACTIVITY_MAX. */
  more: number;
  /** Soonest first. Overdue first of all. */
  comingUp: ComingUpItem[];
}

/** How long a read's snapshot is held for its `projectSeen`. */
export const ACTIVITY_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * `POST ROUTES.projectSeen` `{ key, token }` → 204. Commits the snapshot held for that read (never "the project
 * as it is now"). The app sends it when the person presses Clear on the "Since you last looked" card, then reads
 * again (plan 2026-11-23-project-files-library-view, decision 6). An EMPTY card (first visit, or nothing new) is
 * also sent when the person leaves the page or switches project, and ONLY if it was actually on screen. An
 * unknown, expired or superseded token, or an unknown key, → 204 and nothing saved (it will simply show again).
 * Extra fields → 400.
 */
export interface ProjectSeenRequest {
  key: ProjectKey;
  token: string;
}

// ROUTES additions (shared/contract.ts): projectActivity: '/api/projects/activity' (GET),
// projectSeen: '/api/projects/seen' (POST).
