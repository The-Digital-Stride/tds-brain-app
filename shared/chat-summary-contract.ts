/**
 * Chat summaries as project updates (plan docs/plans/2026-11-24-chat-summary-updates.md). The brain script
 * (`tdsapp-projects` 0.7.0), the server (server/engine/chat-summary.ts, routes, project-updates.ts) and the
 * app (Save to project, Updates tab, Overview) build against this file. The app never writes brain files
 * itself: every entry is written by the script's `update` action and every to-do by tdsapp-todo's `add`.
 *
 * CONTRACT FILE: types, constants and signatures fixed by the lead. Bodies of the pure helpers live in
 * shared/chat-summary.ts (Builder B, tests first).
 */
import type { ProjectKey } from './projects-contract.ts';

// ─── Capability ──────────────────────────────────────────────────────────────────────────────────

/** The script answers `capabilities` with this once `update` takes a `chat` entry (0.7.0). */
export const PROJECTS_CHAT_SUMMARY_CAPABILITY = 'projects-chat-summary-v1';

// ─── The entry (decision 1) ──────────────────────────────────────────────────────────────────────

/**
 * Server-side check on save (overseer should 3): `projectsChange` with a ChatSummaryEntryInput is refused
 * `bad-request` unless `readChatSummary(summary)` is non-null, every document ref is `https://…` or a
 * brain-relative path the library resolves, and no ref is under `personal/` when the project isn't personal.
 */
/** Claude Code's session ids are UUIDs (lower-case hex). */
export const CHAT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The chat's title as stored on the entry (`chat_title`), one line after trimming. */
export const CHAT_TITLE_MAX = 120;

/**
 * `{kind:'update', key, entry: ChatSummaryEntryInput}`, script 0.7.0. Written like a note: `by`/`at` are the
 * script's, `client_safe` as sent, plus flat `chat: <id>` and `chat_title: <title>`. The summary is the body,
 * built by `composeChatSummary` from the reviewed fields (UPDATE_SUMMARY_MAX applies). Removable like a note
 * (its author, the brain's Owner or a scout). Refused: a `chat` that doesn't match CHAT_ID_PATTERN, an empty
 * or over-long title, plus everything a note is refused for.
 */
export interface ChatSummaryEntryInput {
  kind: 'chat';
  summary: string;
  clientSafe: boolean;
  chat: string;
  title: string;
}

// ─── The body (decision 2) ───────────────────────────────────────────────────────────────────────

export const CHAT_OBJECTIVE_MAX = 500;
export const CHAT_OUTCOME_MAX = 1_500;
export const CHAT_FIGURES_MAX = 12;
export const CHAT_FIGURE_MAX = 200;
export const CHAT_DOCUMENTS_MAX = 12;
export const CHAT_DOC_NAME_MAX = 120;
export const CHAT_NEXT_STEPS_MAX = 10;
/** Same as TODO_TITLE_MAX, so every next step can become a to-do title as written. */
export const CHAT_NEXT_STEP_MAX = 200;

/** One document the summary links: a brain-relative path (opens in the viewer) or an https address. */
export interface ChatSummaryDoc {
  ref: string;
  name: string;
}

/** What the person reviewed and saves. Objective and outcome are required; the lists may be empty. */
export interface ChatSummaryFields {
  objective: string;
  outcome: string;
  figures: string[];
  documents: ChatSummaryDoc[];
  nextSteps: string[];
}

/**
 * The body, always in this order, sections with nothing left out:
 *
 *   **Objective:** <objective>
 *
 *   **Outcome:** <outcome>
 *
 *   **Key figures:**
 *   - <figure>
 *
 *   **Documents:**
 *   - [<name>](<ref>)
 *
 *   **Next steps:**
 *   - <step>
 *
 * Text is one paragraph each (line ends folded to spaces), markdown link syntax in names and refs escaped so
 * a name can never become another link. Readable by an older app (plain markdown) and by Claude (the digest).
 * Signature (body in shared/chat-summary.ts): `composeChatSummary(fields: ChatSummaryFields): string`.
 * `readChatSummary(body: string): ChatSummaryFields | null` reads one back (null when the body isn't this
 * layout, e.g. hand-edited): the Updates tab uses it for the short card and falls back to plain markdown.
 */
export type ComposeChatSummary = (fields: ChatSummaryFields) => string;
export type ReadChatSummary = (body: string) => ChatSummaryFields | null;

// ─── The draft (decisions 4–6) ───────────────────────────────────────────────────────────────────

/** `POST ROUTES.chatSummaryDraft` body. `project` must be a live project this person can add updates to. */
export interface ChatSummaryDraftRequest {
  chat: string;
  project: ProjectKey;
}

/** A document Claude could link: from the chat's own files list, never invented. `picked` = Claude's choice. */
export interface ChatSummaryDocChoice extends ChatSummaryDoc {
  kind: 'file' | 'page' | 'link';
  picked: boolean;
  /**
   * (Builder B1) The file is under `personal/`. On a shared project it can't be linked (decision 5): the server
   * sends it unticked and the form shows it disabled ("Only on your Mac"). Absent otherwise.
   */
  personal?: true;
}

/** An earlier summary of this same chat on this project, by this person (decision 7). */
export interface ChatSummaryEarlier {
  path: string;
  at: string;
}

/**
 * `POST ROUTES.chatSummaryDraft` answer. Errors: `bad-request` (shape), `not-found` (no such chat on this Mac,
 * or project not found), `not-allowed` (project archived, no card, no capability, or this person can't change
 * projects), `busy` (the chat is replying or waiting on a question, or a draft for it is already running),
 * `internal` (Claude didn't answer in time or answered something unreadable: "Try again").
 */
export interface ChatSummaryDraft {
  chat: string;
  project: ProjectKey;
  /** The chat's title, cut to CHAT_TITLE_MAX. */
  title: string;
  /** Claude's draft, already cut to the limits above. */
  fields: Omit<ChatSummaryFields, 'documents'>;
  /** Every candidate document (at most CHAT_DOCUMENTS_CANDIDATES), Claude's picks ticked. */
  documents: ChatSummaryDocChoice[];
  /** Claude said some of this came from email (decision 6): the review sheet says saving is the owner's OK. */
  fromEmail: boolean;
  /** Newest first (all of this person's `chat` entries for this chat here, not just one page). Non-empty means
   * the draft covers only what's new since the newest one. */
  earlier: ChatSummaryEarlier[];
  /** Claude found nothing new since the newest earlier summary: the sheet says so and still lets the person go on. */
  nothingNew: boolean;
}

export const CHAT_DOCUMENTS_CANDIDATES = 30;
/** The side copy of the chat gets this long to answer before the draft fails. */
export const CHAT_DRAFT_TIMEOUT_MS = 120_000;

// ─── Only the chat's creator saves (decision 3) ─────────────────────────────────────────────────

/**
 * `POST ROUTES.projectsChange` with a ChatSummaryEntryInput is refused `not-allowed` unless `chat` is a chat
 * Claude Code holds on this Mac for this brain (live in the app with that sdkSessionId, or in listSessions).
 * Chats are never shared between Macs, so this means the person who ran it. Signature on the session manager:
 * `ownsChat(sdkSessionId: string): Promise<boolean>`.
 */
export type OwnsChat = (sdkSessionId: string) => Promise<boolean>;

// ─── Reading (additions to ProjectUpdateItem, shared/project-updates-contract.ts) ───────────────

/**
 * For `kind: 'chat'` entries the server adds `chatId` and `chatTitle` (as written), and `chatOpenable: true`
 * when this Mac holds that chat (so "Open chat" can reopen it). Older apps ignore all three.
 */
export interface ChatUpdateFields {
  chatId?: string;
  chatTitle?: string;
  chatOpenable?: true;
}

// ─── Chats not saved yet (decision 10) ──────────────────────────────────────────────────────────

/**
 * `GET ROUTES.projectUnsavedChats?key=<ProjectKey>` → this. This Mac's chats whose saved place is this project
 * (chat-places.json; a moved project's `moved_from` keys count), modified in the last UNSAVED_CHATS_DAYS, that
 * have new messages since they were last saved here. "New" is counted, not timed (overseer should 1: ending or
 * reopening a chat touches its file): on every successful save the server records, in app data
 * `chat-summaries.json` (CHAT_SUMMARIES_FILE, never the brain), `{[sdkSessionId]: {[projectKey]: {savedAt,
 * messages}}}` where `messages` = the count of user + assistant messages in getSessionMessages; a chat is listed
 * when its count now is greater, or when it has no record and no `chat` entry by this person here. Newest first
 * by file time, at most UNSAVED_CHATS_MAX. Live chats still replying are left out. Empty when `canSave` false.
 */
export interface UnsavedChat {
  chat: string;
  title: string;
  /** ISO time of the chat's last activity. */
  lastActive: string;
  /** ISO time of this person's newest summary of it here, when there is one. */
  savedAt: string | null;
}
export interface UnsavedChatsResponse {
  chats: UnsavedChat[];
  /** The capability is present, the project is live with a card, and this person may change projects. */
  canSave: boolean;
}
export const UNSAVED_CHATS_DAYS = 30;
export const CHAT_SUMMARIES_FILE = 'chat-summaries.json';
export const UNSAVED_CHATS_MAX = 5;

// ROUTES additions (shared/contract.ts):
//   chatSummaryDraft: '/api/chat-summary/draft'            (POST ChatSummaryDraftRequest → ChatSummaryDraft)
//   projectUnsavedChats: '/api/projects/unsaved-chats'     (GET → UnsavedChatsResponse)
// Saving goes through the existing POST ROUTES.projectsChange with a ProjectUpdateAction whose entry is a
// ChatSummaryEntryInput; to-dos through the existing to-do `add` with TodoAddProjectFields.

// ─── Capability on the projects list (overseer blocking 5) ──────────────────────────────────────

/**
 * `ProjectList.canSaveChat?: boolean` (shared/projects-contract.ts, built in server/brain/projects.ts beside
 * `canRef`): canChange && the script lists PROJECTS_CHAT_SUMMARY_CAPABILITY. The chat header shows Save to
 * project only when it is true; the Overview card and the Updates tab form need it too.
 */

// ─── Opening the review form (decision 8, overseer ruling) ──────────────────────────────────────

/**
 * The review form lives on the project's Updates tab, with the chat open in the chat drawer beside it.
 * client/src/state/save-chat-request.ts (Builder C) is a tiny external store like `projectPageRequest`
 * (client/src/state/client-choice.ts): `saveChatRequest.set(req)`, `saveChatRequest.subscribe(fn)`,
 * `takeSaveChatRequest(key): SaveChatRequest | null` (returns and clears it when it is for that project).
 * The chat header's Save to project (Builder C) picks a project first when the chat has none, sets the request,
 * sets `projectPageRequest` to the key, opens `app:projects` and keeps the chat open in the chat drawer.
 * ProjectsSheet / ProjectPage (Builder D) take the request, show the Updates tab and open the form.
 * The Overview's "Chats not saved yet" opens the form directly (no drawer for a past chat; the form has an
 * "Open chat" link).
 */
export interface SaveChatRequest {
  key: ProjectKey;
  chat: string;
  title: string;
}

/** client/src/apps/projects/SaveToProject.tsx (Builder D): the review form and, after saving, the to-dos step. */
export interface SaveToProjectProps {
  chat: string;
  title: string;
  project: ProjectKey;
  onClose(saved: boolean): void;
}
