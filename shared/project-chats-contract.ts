/**
 * A project's Chats tab (plan docs/plans/2026-11-26-project-chats-tab.md): every chat this person had for the
 * project on this Mac, with whether its summary was saved to the project's Updates. Server
 * (server/engine/chat-summary.ts `forProject`, routes) and app (client/src/apps/projects/ProjectChats.tsx)
 * build against this file. Read-only: the tab writes nothing. Saving still goes through Save to project
 * (shared/chat-summary-contract.ts); opening a chat goes through the store's `openChat` / `openPast`.
 *
 * CONTRACT FILE: types, constants and rules fixed by the lead.
 */
import type { ProjectKey } from './projects-contract.ts';

/**
 * Whether this person has saved the chat's summary to this project:
 * - `never`: no summary by this person here.
 * - `saved`: a summary is saved and nothing was said since (or it can't be told that something was).
 * - `new`: a summary is saved and the chat has more messages now than when it was saved.
 * - `null`: the app couldn't check (the project's updates couldn't be read). The row says nothing about saving.
 */
export type ProjectChatSaved = 'never' | 'saved' | 'new';

export interface ProjectChat {
  /** Claude Code's session id (CHAT_ID_PATTERN): what `openPast` and SaveChatRequest take. */
  chat: string;
  /** One line, at most CHAT_TITLE_MAX; 'Untitled chat' when the chat has none. */
  title: string;
  /** ISO time of the chat's last activity. */
  lastActive: string;
  /** Live and replying, or waiting on a question: Save to project isn't offered (a draft would answer `busy`). */
  busy: boolean;
  saved: ProjectChatSaved | null;
  /** ISO time of this person's newest summary of it here; null when `saved` is 'never' or null. */
  savedAt: string | null;
}

/**
 * `GET ROUTES.projectChats?key=<ProjectKey>` → this. This Mac's chats whose saved place is this project
 * (chat-places.json; the card's `movedFrom` keys count), live ones included, newest first by last activity,
 * at most PROJECT_CHATS_MAX. Unlike the Overview's "Chats not saved yet" there is no age limit, and an archived
 * project's chats are still listed (`canSave` false).
 *
 * Errors: `bad-request` (no or bad key), `not-found` (no such project for this person). A project this person
 * can see but can't save to answers 200 with `canSave: false` and the chats.
 *
 * The saved rule, per chat (the same counting rule as UnsavedChat, so the tab and the Overview card agree):
 * 1. `rec` = the newest record in chat-summaries.json for this chat under any of the project's keys.
 * 2. With a `rec`: `savedAt = rec.savedAt`. When the chat's last activity is not after `rec.savedAt`, it is
 *    `saved` without counting. Otherwise its messages are counted (`ChatSourcePort.messages`): more than
 *    `rec.messages` → `new`; the same, fewer, or uncountable → `saved`.
 * 3. Without a `rec`: this person's `chat` entries on the project are read once (`entries`). One for this chat →
 *    `saved`, `savedAt` = its newest `at`. None → `never`. The read failing → `saved: null`.
 *
 * No chat service (`ctx.sessions.chatSummaries` absent) answers an error, never an empty list.
 */
export interface ProjectChatsResponse {
  chats: ProjectChat[];
  /** As UnsavedChatsResponse.canSave: the capability is present, the project is live with a card, and this
   * person may change projects. False: rows show no Save to project. */
  canSave: boolean;
  /** The project has more chats than PROJECT_CHATS_MAX: only the newest are in `chats`. */
  more: boolean;
}

export const PROJECT_CHATS_MAX = 100;

// ROUTES addition (shared/contract.ts):
//   projectChats: '/api/projects/chats'     (GET → ProjectChatsResponse)

/** What the service is asked (server/engine/chat-summary.ts, beside UnsavedInput). */
export interface ProjectChatsInput {
  /** The project's live key and its moved_from keys. */
  keys: readonly ProjectKey[];
  /**
   * This person's `chat` entries on the project, read ONCE for the whole list (overseer should 1): chat id →
   * the newest entry's `at`. Only called when some chat has no record. Rejects when the updates can't be read:
   * every chat without a record then gets `saved: null`.
   * Built on `ProjectUpdatesService.myChatEntries(key, identity)` (server/brain/project-updates.ts), exposed as
   * `ctx.brain.myChatEntries` beside `chatEntries`.
   */
  entries(): Promise<Map<string, string>>;
}

/** `ChatSummaryService.forProject(input)`: the rows and whether there were more than PROJECT_CHATS_MAX. */
export interface ProjectChatsResult {
  chats: ProjectChat[];
  more: boolean;
}

/**
 * client/src/apps/projects/ProjectChats.tsx.
 *
 * Live or not is the STORE's answer, not the server's: a row whose `chat` equals a `sessions.live[].sdkSessionId`
 * is "Open now" and its title opens with `openChat(live.id, { in: 'drawer' })` (the live session's app `id`, never
 * `chat`); any other row opens with `openPast(chat, { in: 'drawer' })`. Once `sessions` has loaded, a row whose
 * chat is in neither `sessions.live` nor `sessions.past` is not shown (the store leaves out a chat being deleted).
 */
export interface ProjectChatsProps {
  projectKey: ProjectKey;
  /** The card's `movedFrom` keys, so the tab can tell from the store's chat list when to read again. */
  movedFrom: readonly ProjectKey[];
  /** The project isn't archived, so the page's head has New chat for this project: the empty text may name it. */
  canStart: boolean;
  /** Opens the Save to project form on the Updates tab (ProjectPage's `saveChat`). */
  onSave(req: { key: ProjectKey; chat: string; title: string }): void;
}
