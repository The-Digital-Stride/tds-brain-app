// Contract for plan 2026-11-25-home-recent-cards. Builder A adds the shared names to shared/contract.ts exactly
// as written here; Builder B builds the client against them. Not imported by the app.

import type { LibraryKind, LibrarySearchHit } from '../../shared/contract.ts';
import type { ProjectKey } from '../../shared/projects-contract.ts';

// ---------------------------------------------------------------------------
// Part 1: shared/contract.ts
// ---------------------------------------------------------------------------

/** HOME_ITEM_IDS gains four ids, inserted in this default order (decision 3). */
export const HOME_ITEM_IDS = [
  'start-my-day',
  'whats-new',
  'meetings',
  'ads',
  'todos',
  'recent-todos',
  'projects',
  'chats',
  'recent-chats',
  'files',
  'recent-documents',
  'recent-images',
  'skills',
] as const;

/** At most this many files a recent card can hold (decision 6, 8). */
export const LIBRARY_RECENT_MAX = 20;

/**
 * `GET /api/library/recent?kind=image|doc[&project=<ProjectKey>]` → LibraryRecentResponse. Read-only.
 * The newest files of one kind across every scope the person can see, newest `modified` first (ties by path),
 * at most LIBRARY_RECENT_MAX. With `project`, only files whose `item.projects` holds that key (filtered before
 * the cap). Same listing gathering as search: cached listings even past freshness (refreshing behind), cold
 * scopes built three at a time within the search budget, then `partial: true`. Items carry `projects` like
 * search hits. Bad `kind` or a `project` failing PROJECT_KEY_PATTERN → 400 `bad-request`.
 */
export interface LibraryRecentResponse {
  files: LibrarySearchHit[];
  partial: boolean;
}

/** ROUTES gains: */
export const ROUTES_ADDITION = { libraryRecent: '/api/library/recent' } as const;

/** BrainReaders gains (optional, so older test fakes still satisfy the type; the route answers empty without it): */
export interface BrainReadersAddition {
  libraryRecent?(kind: LibraryKind, project?: ProjectKey): Promise<LibraryRecentResponse>;
}

// ---------------------------------------------------------------------------
// Part 2: server/brain/library.ts
// ---------------------------------------------------------------------------

export interface LibraryAddition {
  /** See LibraryRecentResponse. Never throws: a failure answers `{ files: [], partial: false }`. */
  recent(kind: LibraryKind, project?: ProjectKey): Promise<LibraryRecentResponse>;
}

// ---------------------------------------------------------------------------
// Part 3: client
// ---------------------------------------------------------------------------

/** client/src/api.ts */
export interface ApiAddition {
  /** `kind` is sent as `image` or `doc`, as librarySearch. */
  libraryRecent(kind: LibraryKind, project?: ProjectKey): Promise<LibraryRecentResponse>;
}

/** client/src/state/home-pins.ts (pure; tests first) */
export interface HomePinsAddition {
  /** Decision 4. Takes `mine` and `open`; a task in both shows once. Caller narrows by project. */
  recentTodos(mine: import('../../shared/contract.ts').TodoItem[], open: import('../../shared/contract.ts').TodoItem[]): import('../../shared/contract.ts').TodoItem[];
  /** Decision 5. `project` '' = no narrowing. Returns PinnedChat rows (same union as pinnedChats). */
  recentChats(
    live: import('../../shared/contract.ts').LiveSession[],
    past: import('../../shared/contract.ts').PastSession[],
    project: string,
  ): import('../../client/src/state/home-pins.ts').PinnedChat[];
}

/** home-items.ts rows (UK English titles; "tasks", never "to-dos"). No hints. */
export const HOME_ITEM_ROWS = [
  { id: 'recent-todos', title: 'Recent tasks', kind: 'card' },
  { id: 'recent-chats', title: 'Recent chats', kind: 'card' },
  { id: 'recent-documents', title: 'Recent documents', kind: 'card' },
  { id: 'recent-images', title: 'Recent images', kind: 'card' },
] as const;
