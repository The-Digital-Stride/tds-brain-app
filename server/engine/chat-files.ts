/**
 * One chat's files: which brain files it read, made, changed or named, where its attachments went,
 * and the web addresses it used. Fed the engine's raw messages (live) or Claude Code's stored history
 * (a reopened chat), so the same code builds both. Plan: docs/plans/2026-11-13-chat-files.md.
 *
 * CONTRACT FILE: signatures fixed by the lead; bodies are Builder B's (tests first).
 *
 * Read-only: never touches the brain. Every path goes through `resolve` (the library), so a file the
 * person could not open in Documents is never reported, and nothing outside the brain is either.
 */
import type { ChatFileChanges, ChatFilesSnapshot, LibraryItem, LibraryScope } from '../../shared/contract.ts';

export type ResolvePath = (
  rel: string,
) => Promise<{ key: string; scope: LibraryScope; item: LibraryItem | null } | null>;

/** An attachment as the session knows it. `stagedPath` is absolute and never leaves the server. */
export interface TrackedAttachment {
  name: string;
  kind: 'image' | 'document';
  stagedPath: string;
}

export interface ChatFilesOptions {
  /**
   * The brain root as configured and as its real path (they differ when it sits behind a symbolic
   * link; Claude's tool paths use the real one). Each tool path is normalised against each in turn.
   */
  brainRoots: readonly string[];
  resolve: ResolvePath;
  /** Stamps live edits for `changes`. */
  now?: () => Date;
}

export interface ChatFilesTracker {
  /**
   * One raw engine message (`assistant` with text / tool_use blocks, `user` with tool_result blocks)
   * or one stored history message of the same shape. Anything else is ignored. Never throws.
   * - tool_use Read / Write / Edit / MultiEdit / NotebookEdit (any parent: a helper's steps count):
   *   path from `file_path` or `notebook_path`, normalised with `normaliseBrainPath`; counted when its
   *   tool_result arrives without `is_error`. Write/Edit/MultiEdit inputs are kept for `changes`: at
   *   most CHAT_FILE_CHANGES_MAX per file and CHAT_FILE_CHANGES_BUDGET bytes per chat, oldest dropped
   *   first (then `truncated`); kept inputs of a path that resolves to null are dropped.
   * - tool_use Bash whose `command` contains a tracked attachment's `stagedPath`: every other token
   *   that normalises to a brain path is a candidate destination, and so is `<token>/<staged file
   *   name>` (for a folder). On a successful result, candidates that resolve to a listed item are
   *   marked `filed` and the attachment's `filedKey` set (the last one wins).
   * - tool_use WebFetch: its `url`, when http(s), without credentials and at most
   *   CHAT_LINK_MAX_CHARS, is added to `links` on success.
   * - text blocks of an `assistant` message with no parent (never a helper's text):
   *   `findPathMentions` → `mentioned`; `findWebLinks` → links (same URL rules).
   * Marks the tracker dirty when anything changed. `history: true`: a stored message, so its kept
   * edits get `at: null`.
   */
  observe(message: unknown, opts?: { history?: boolean }): void;
  /** The person attached these to the message just sent (or found in history). Marks dirty. */
  addAttachments(files: readonly TrackedAttachment[]): void;
  /**
   * The turn ended: forget tool uses still waiting for a result, and make the next `snapshot`
   * re-resolve every path (not just the touched ones). Marks dirty.
   */
  endTurn(): void;
  /**
   * Null when not dirty. Otherwise clears the dirty flag FIRST (so an `observe` during the await makes
   * the next call run again), resolves the paths touched since the last snapshot (all of them after
   * `endTurn` or on the first call), and returns the whole snapshot. A file that is only `mentioned`
   * and/or `filed` and resolves to `item: null` is left out; one that was read or edited stays, as
   * "No longer there". Ordered by `order`, newest first, capped per CHAT_FILES_MAX / CHAT_LINKS_MAX.
   */
  snapshot(): Promise<ChatFilesSnapshot | null>;
  /**
   * The kept edits for one key, via `proposedChange` (file-change.ts; a `created` file's first Write
   * as `fileExists: false`, every other Write as true). Null unless the key's latest resolution has an
   * item and it has kept edits.
   */
  changes(key: string): ChatFileChanges | null;
}

export function createChatFiles(opts: ChatFilesOptions): ChatFilesTracker {
  void opts;
  throw new Error('not built yet');
}
