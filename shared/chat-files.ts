/**
 * Chat files: pure text helpers shared by the server (which decides what is real) and the client
 * (which matches reply text to files the server already reported). Plan: docs/plans/2026-11-13-chat-files.md.
 *
 * CONTRACT FILE: signatures fixed by the lead; bodies are Builder A's (tests first).
 * Nothing here touches the disk or trusts a path: the server still resolves every candidate
 * through the library, and the client only ever links to keys the server sent.
 */
import type { ChatFile, ChatFileGroup } from './contract.ts';

/**
 * A path as Claude wrote it, made comparable: from the brain's root, forward slashes, no `./`, no
 * trailing slash, no `#fragment` or `?query`, `%xx` decoded once, wrapping backticks, quotes and
 * angle brackets removed, and a trailing `:12` / `:12-30` line reference dropped.
 * - Absolute and inside `brainRoot` (after that same tidying, compared as strings): made relative.
 * - Absolute elsewhere, `~/…`, a URL with a scheme, empty, or containing a `..` segment: null.
 * - Relative: kept as is (after tidying).
 * Never resolves symbolic links (the server's library check does that).
 */
export function normaliseBrainPath(raw: string, brainRoot: string): string | null {
  void raw;
  void brainRoot;
  throw new Error('not built yet');
}

/**
 * Candidate file paths in a finished reply, raw (not normalised), each once, in order of first
 * appearance: Markdown link targets that are not web addresses, inline code spans, and bare
 * paths that start `clients/`, `personal/` or the brain root and end in a file extension.
 * Text inside fenced code blocks is skipped. At most 200.
 */
export function findPathMentions(text: string): string[] {
  void text;
  throw new Error('not built yet');
}

/**
 * `http:` / `https:` addresses in a reply (Markdown link targets and bare addresses), each once, in
 * order, with trailing punctuation `.,;:!?)` that is not part of the address dropped. Fenced code
 * blocks are skipped. At most 100.
 */
export function findWebLinks(text: string): string[] {
  void text;
  throw new Error('not built yet');
}

/**
 * Which group a file shows in: `made` (created or changed), else `attached` (filed), else
 * `mentioned`, else `looked-at` (read only).
 */
export function chatFileGroup(file: ChatFile): ChatFileGroup {
  void file;
  throw new Error('not built yet');
}

/**
 * For linking reply text and steps: maps each file's normalised `path` → `key`, and each tool use
 * id → `key`. Built once per snapshot on the client.
 */
export interface ChatFileIndex {
  byPath: ReadonlyMap<string, string>;
  byToolUse: ReadonlyMap<string, string>;
}
export function indexChatFiles(files: readonly ChatFile[]): ChatFileIndex {
  void files;
  throw new Error('not built yet');
}

/** The URL fragment a reply link to a chat file is rewritten to. Click handling looks for this prefix. */
export const CHAT_FILE_HREF_PREFIX = '#chat-file=';
