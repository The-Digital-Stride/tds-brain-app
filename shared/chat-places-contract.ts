/**
 * Projects R2 phase 1 (plan docs/plans/2026-11-23-projects-r2-chat-project.md): a chat's place, the
 * client AND project it is for. Server (session manager, chat-places store, routes) and client (store,
 * Home, to-do chat button, Chats drawer) build against this file. Additions to contract.ts types are
 * listed at the bottom and are all optional, so older servers and clients keep working.
 */

import type { ProjectKey } from './projects-contract.ts';

// ─── Saved per chat, in the app's own data folder (decision 3) ─────────────────────────────────────

/** `<dataDir>/chat-places.json`. Never the brain. */
export const CHAT_PLACES_FILE = 'chat-places.json';
/** Oldest entries (by `savedAt`) are dropped past this many. */
export const CHAT_PLACES_MAX = 2000;

export interface ChatScope {
  /** A client slug, or null (no client, or a personal project). */
  client: string | null;
  /** A ProjectKey, or null. When set and the project is a client one, `client` is that project's client. */
  project: ProjectKey | null;
}

export interface ChatPlacesFile {
  version: 1;
  /** sdkSessionId → place. Only chats with a client or a project are kept. */
  chats: Record<string, ChatScope & { savedAt: string }>;
}

export interface ChatScopeStore {
  /** Null when nothing was saved (or the file can't be read). */
  placeOf(sdkSessionId: string): Promise<ChatScope | null>;
  /** Every saved place (a fresh copy), for the past-chats list. */
  all(): Promise<Map<string, ChatScope>>;
  /** Queued, one write at a time; never rejects (a failed write is logged). A place with neither is removed. */
  set(sdkSessionId: string, place: ChatScope): Promise<void>;
  /** When a past chat is deleted. Queued; never rejects. */
  remove(sdkSessionId: string): Promise<void>;
}

// ─── What Claude is told (decisions 4–6) ──────────────────────────────────────────────────────────

/** Names Claude must never use inside a project folder (the brain's save rules, row "A project card"). */
export const PROJECT_RESERVED_NAMES = [
  'project.md',
  'retainer.md',
  'summary.md',
  'updates/',
  'months/',
  'reports/',
] as const;

/** A project title as it goes into Claude's instructions: newlines and backticks removed, at most this long. */
export const PROMPT_TITLE_MAX = 80;
/** "Which project?" (decision 6): at most this many of the client's open projects are listed. */
export const WHICH_PROJECT_MAX = 12;

/** What the session manager needs to know about the chat's project to write its instructions. */
export interface ChatProjectFacts {
  key: ProjectKey;
  title: string;
  /** Brain-relative live folder, from the projects index, never from the request. */
  folder: string;
  space: 'client' | 'personal' | 'legacy';
}

/** One row of the "which project?" list: the client's live, not-done projects. */
export interface OpenProjectFacts {
  key: ProjectKey;
  title: string;
  folder: string;
}

// ─── Additions to existing types (shared/contract.ts) ─────────────────────────────────────────────
//
// StartSessionRequest.project?: ProjectKey | null
//   A live (not archived) project in the projects index. Unknown or archived → 400 `bad-request`
//   "That project isn't open any more. Pick another from Working on." For a client project, `client`
//   may be omitted (it is filled in from the project); a different `client` → 400 `bad-request`
//   "That project belongs to another client." A personal project: `client` must be null/omitted and
//   the chat's kind is 'personal'. Ignored on resume (the saved place is used instead).
//
// LiveSession.project?: ProjectKey | null   (absent from older servers = null)
// PastSession.client?: string | null        (from chat-places.json; absent = unknown)
// PastSession.project?: ProjectKey | null
//
// Legacy-space projects (`projects/<slug>`, key `the-digital-stride/<slug>`): client = the card's client
// when it is in Bootstrap.clients, else null; kind 'tds'.
//
// On resume (decision 3) the chat's saved client and project are restored, so a reopened chat keeps
// both (before this, a reopened chat had client null). A saved project that has since moved resolves
// through the projects index's moved-from aliases; one that is archived or gone is dropped (client kept).
// Resume NEVER refuses because of the place: a store or index failure, or a client no longer in the
// brain, falls back to today's behaviour (no client, no project). All place reads happen in the awaited
// part of start(), before the synchronous re-check.
