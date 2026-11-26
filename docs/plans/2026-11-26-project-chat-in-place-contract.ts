/**
 * Contract for plan 2026-11-26-project-chat-in-place. Types only: nothing imports this file at run time.
 * Builders copy these shapes into the files they own.
 */
import type { ProjectCard, ProjectKey } from '../../shared/projects-contract.ts';

/** Where a chat opens (already in `client/src/store.tsx`). */
export type ChatPlace = 'sheet' | 'drawer';

// ---- Store (Builder A) -------------------------------------------------------------------------------------

/** `newChat`'s options: `in` is new. Absent or 'sheet' = today's behaviour (leave guard, then Home). */
export interface NewChatOpts {
  draft?: string;
  skill?: unknown;
  todoId?: string | null;
  client?: string | null;
  project?: ProjectKey | null;
  /**
   * 'drawer': open the unsent chat in the chat drawer and keep the current view. Honoured only while
   * `drawerView(view)` is true; otherwise it is treated as 'sheet'.
   */
  in?: ChatPlace;
}

/** Added to `NewChat`, both fixed in `freshNewChat` when the chat is made. */
export interface NewChatPlace {
  /** 'sheet' unless decision 1 put it in the drawer. */
  in: ChatPlace;
  /** 'chat' when it was opened with a project or in the drawer; else 'app' (Home's own chat). */
  scope: 'app' | 'chat';
  /** Picks carried over by Open full screen, so "No project" doesn't turn back into Working on. */
  picks?: { project: ProjectKey | ''; client: string };
}

export interface StoreAdditions {
  /** The key of the unsent chat shown in the drawer, or null. `chatDrawer` (a live session id) is unchanged. */
  newChatDrawer: number | null;
  /**
   * Hide chat on an unsent drawer chat: replaces the active chat with a fresh sheet one (nothing is sent).
   * The view does not change. The caller has already been through the drawer hold.
   */
  dropNewChatDrawer: () => void;
  /**
   * Open full screen on an unsent drawer chat: the same new chat (text, both picks, to-do, skill) on Home.
   * `draft` is the text in the box at that moment; it moves, so the drawer hold does not ask.
   */
  expandNewChatDrawer: (draft: string, picks: { project: ProjectKey | ''; client: string }) => void;
}

/**
 * The drawer hold (ShellProvider, Builder A): a sibling of the panel and sheet holds, NOT `useSheetHold`'s slot.
 * `useDrawerHold(dirty)` returns `{ asking, keep, discard }` like `useSheetHold`. `guardDrawer(go)` runs `go` now
 * when the unsent drawer is clean, or after Discard. It is chained in `guardLeave`, and the store calls it before
 * anything replaces an unsent drawer chat: `openChat`/`openPast` with `in: 'drawer'`, a second
 * `newChat({ in: 'drawer' })`, Hide chat and Esc. `chatDraft` for the Esc rule reads this dirty flag, not the
 * focused element. A tab or project-page change inside Projects is not a replace and never asks.
 */
export interface DrawerHold {
  asking: boolean;
  keep: () => void;
  discard: () => void;
}

/**
 * Store rules:
 * - `newChatDrawer` is non-null only while `drawerView(view)` and the active chat is `kind: 'new'` with
 *   `in: 'drawer'`. When the view stops being a drawer view, the active chat becomes a fresh sheet chat.
 * - `send()` on such a chat sets the drawer to the new session id in the same update as the active chat, so the
 *   drawer never closes and reopens.
 * - The shell's Esc rule (`state/keys.ts`) treats `chatDrawer != null || newChatDrawer != null` as "drawer open".
 */

// ---- The scope row's rule (Builder A; pure, tests first) ------------------------------------------------------

export const AUTO = '@auto';
export const NONE = '@none';
/** The Project picker's "No project" value in a chat-bound row. */
export const NO_PROJECT = '';

export interface ChatScopeInput {
  /** The project the chat was opened with; null when none. */
  presetProject: ProjectKey | null;
  /** The client the chat was opened with: a slug, null for no client, undefined when it wasn't given. */
  presetClient: string | null | undefined;
  /** Home's app-wide Working on ('' when none). Read only in an app-bound row. */
  workingOn: ProjectKey | '';
  /** 'chat' or 'app', from `NewChat.scope` (fixed when the chat was made). */
  bound: 'app' | 'chat';
  /**
   * The chat-bound row's picks, or undefined until the person touches either picker. Always a consistent pair,
   * written only by `pickProject` / `pickClient` below.
   */
  picks: { project: ProjectKey | ''; client: string } | undefined;
  cards: readonly Pick<ProjectCard, 'key' | 'client' | 'space' | 'archived' | 'title' | 'slug'>[] | undefined;
  clients: readonly { slug: string }[];
}

export interface ChatScopeView {
  /** 'app': "Working on", writes `projectChoice`. 'chat': "Project", writes this chat's pick only. */
  bound: 'app' | 'chat';
  projectLabel: 'Working on' | 'Project';
  /** The project picker's value: a key, or '' (shown as "All projects" when app-bound, "No project" when chat-bound). */
  project: ProjectKey | '';
  /** Chat for's value: AUTO, NONE or a client slug. */
  client: string;
  /** True when Chat for's value came from the project, not a hand pick (the "Set by …" screen-reader note). */
  clientSetByProject: boolean;
  /** The project to send once the final client is known (Auto resolves later). Chat-bound: non-null only when
   *  `project` is shown and `client` is that project's own; so what is sent is what is shown. */
  projectFor: (finalClient: string | null) => ProjectKey | null;
}

/**
 * Rules (decisions 3 and 4):
 * - App-bound: today's behaviour, unchanged.
 * - Chat-bound, nothing picked, `presetClient` given and NOT the preset project's own client (a personal task
 *   on a client project): client = presetClient, project = NO_PROJECT. The given client wins, as today.
 * - Chat-bound, nothing picked otherwise: project = presetProject (if live and known), client = its own client
 *   (NONE for personal or an unlisted client), or presetClient / AUTO when there is no project.
 * - An archived or unknown key is never shown and never sent.
 */
export declare function chatScope(input: ChatScopeInput): ChatScopeView;

/** Picking a project sets both: the project and its own client (NONE for personal; NO_PROJECT keeps the client). */
export declare function pickProject(
  key: ProjectKey | '',
  current: { project: ProjectKey | ''; client: string },
  cards: ChatScopeInput['cards'],
  clients: ChatScopeInput['clients'],
): { project: ProjectKey | ''; client: string };

/** Picking a client sets both: the client, and NO_PROJECT unless it is the shown project's own client (AUTO clears it). */
export declare function pickClient(
  client: string,
  current: { project: ProjectKey | ''; client: string },
  cards: ChatScopeInput['cards'],
  clients: ChatScopeInput['clients'],
): { project: ProjectKey | ''; client: string };

// ---- The shared message box (Builder B) -------------------------------------------------------------------------

export interface NewChatBoxProps {
  /** 'sheet' on Home, 'drawer' in the chat drawer. Changes only the layout and where a refusal is repeated. */
  placement: ChatPlace;
  /** The chat-bound row's current picks, lifted so the drawer can hand them to Open full screen. */
  onPicks?: (picks: { project: ProjectKey | ''; client: string }) => void;
}
/**
 * `Composer.tsx` is not changed. The drawer reads the box's text and whether files are attached from the DOM,
 * as the live drawer does (`Chat.tsx:155-156`), and feeds `useDrawerHold` from the textarea's input events.
 * In the drawer, a refused start (`actionError`) is repeated in the box's `role="status"` line.
 */

// ---- The drawer's unsent state (Builder C) ------------------------------------------------------------------------

/**
 * `ChatDrawer` renders `<NewChatDrawer key={newChatDrawer} />` when `newChatDrawer != null`, else the live body
 * as today. Both use one extracted header component:
 */
export interface ChatDrawerHeadProps {
  headingId: string;
  /** "New chat" for the unsent state; the chat's title once live. */
  title: string;
  /** One chip. Unsent: the project's title, else the client's name, else none. Live: the client, as today. */
  chip: string | null;
  /** The chip's tooltip when it is cut short: "Client · Project" from `chatPlaceWords`. */
  chipTip: string | null;
  /** Live chats only: the Save to project button. */
  save?: unknown;
  onFullScreen: () => void;
  onHide: () => void;
  /** The `role="status"` note under the buttons (e.g. "Send or remove the attached files first."). */
  note: string;
}

/**
 * `ChatDrawer` keeps ONE frame (`.chat-drawer`) mounted across unsent → live and swaps its inside, so the slide-in
 * doesn't replay and the return-focus timer doesn't fire on Send.
 *
 * `TodoChatButton` gains `in?: ChatPlace`, passed to both its `newChat` and its `openChat`; `ProjectTodos` passes
 * 'drawer'. The task panel's chat action (`TodoPanel.tsx:410`) does the same when the view is Projects.
 */
export interface TodoChatButtonAddition {
  in?: ChatPlace;
}
