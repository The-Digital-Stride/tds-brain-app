/**
 * Projects R2 phase 3 (plan docs/plans/2026-11-23-projects-r2-activity.md): activity on the project home.
 * "Since you last looked" and "Coming up" on a project's Overview. Everything is worked out on read; the only
 * thing kept is this person's "last looked" snapshot per project, in the app's data folder on this Mac
 * (never the brain). The app writes no brain files for this phase.
 */

import type { ProjectKey } from './projects-contract.ts';

// ─── The seen store (app data folder) ────────────────────────────────────────────────────────────

export const PROJECT_SEEN_FILE = 'project-seen.json';
/** Projects remembered; the oldest `at` is dropped past this. */
export const PROJECT_SEEN_MAX = 500;
/** Paths or ids kept per list in one snapshot; a bigger list is cut (newest kept) and marked `cut`. */
export const PROJECT_SEEN_LIST_MAX = 500;

/**
 * What this person had seen of one project when they last looked. Lists, not dates, so personal projects
 * (not in git) and files with odd timestamps work the same way.
 */
export interface ProjectSeen {
  /** ISO time they last looked. */
  at: string;
  /** Open to-do keys (ProjectTodoRow.key) in the project then. */
  todos: string[];
  /** The card's `links` then. */
  links: string[];
  /** Brain paths of the project's files (ProjectFilesResponse items) then. */
  files: string[];
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

export interface ActivityItem {
  kind: ActivityKind;
  /** One line of plain text, e.g. "Sam Taylor added a note", "To-do done: Send the quote". */
  text: string;
  /** ISO time when known (updates log `at`, to-do done time); null when only "since you looked" is known. */
  at: string | null;
  /** Team display name when known, else null. */
  byName: string | null;
  /** What it opens: a to-do key, a brain path, or the Updates tab. */
  target:
    | { kind: 'todo'; key: string }
    | { kind: 'file'; path: string }
    | { kind: 'updates' };
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
  /** Newest first where `at` is known; items without `at` after those, in kind order. At most ACTIVITY_MAX. */
  items: ActivityItem[];
  /** How many more there were beyond ACTIVITY_MAX. */
  more: number;
  /** Soonest first. Overdue first of all. */
  comingUp: ComingUpItem[];
}

/**
 * `POST ROUTES.projectSeen` `{ key }` → 204. Saves this person's snapshot of the project as it is now. The app
 * sends it when the person leaves the project page (or switches project), never on open, so what was shown is
 * what gets marked seen. Unknown or archived key → 404 / no-op as the plan says.
 */
export interface ProjectSeenRequest {
  key: ProjectKey;
}

// ROUTES additions (shared/contract.ts): projectActivity: '/api/projects/activity' (GET),
// projectSeen: '/api/projects/seen' (POST).
