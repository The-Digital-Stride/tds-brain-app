/**
 * The `## Files` section of a to-do body (plan 2026-11-16-todo-attachments, decisions 1 and 4, overseer B1/S3/S4).
 * Read side only: the brain's `tdsapp-todo` skill is the only writer. Its `.cjs` follows the same rules;
 * `shared/todo-files.fixtures.json` is run by both test suites so the two can't drift.
 *
 * Format, one line per file, written relative to the to-do's own folder:
 *   ## Files
 *
 *   - [logo.png](../clients/acme/images/logo.png)
 *   - [My notes.pdf](<../personal/files/My notes.pdf>) (only on ian-hancock's Mac)
 *
 * Since the task-updates plan (docs/plans/2026-11-27-task-updates-handback.md, decisions 5a and 6) the
 * section also holds web links (`- [name](https://…)`, written by `link`), and EVERY `## Files` section is
 * read: the brain's `todo/*.md merge=union` rule can leave two after a merge.
 */

import { cutTodoSections, isTodoLinkUrl, TODO_FILES_HEADING, todoSectionRanges } from './todo-updates.ts';
import type { TodoLink } from './todo-updates-contract.ts';

// The section starts at a level-2 heading that says exactly "Files" (any case) and ends at the next
// level-1 or level-2 heading, outside code fences (TODO_FILES_HEADING, todoSectionRanges).

/**
 * `- [name](path)` or `- [name](<path>)`, optionally followed by ` (only on <slug>'s Mac)`.
 * `*` bullets are read too (a hand edit), but the skill writes `-`.
 */
const ITEM =
  /^[ \t]*[-*][ \t]+\[([^\]\n]+)\]\((?:<([^>\n]+)>|([^\s()<>]+))\)(?:[ \t]+\(only on ([a-z0-9]+(?:-[a-z0-9]+)*)'s Mac\))?[ \t]*$/;
const ROOTS = ['clients/', 'projects/', 'templates/', 'personal/'];

export interface TodoFileLink {
  /** Brain-relative, e.g. "clients/acme/images/logo.png". */
  path: string;
  /** The link text. */
  name: string;
  /** For a `personal/` file: the team slug of the person whose Mac has it, when written; else null. */
  holder: string | null;
}

/**
 * A link target as a brain path, or null. Every leading `../` is dropped (so a link still resolves after
 * the to-do moves to `done/`), then the rest must start with clients/, projects/ (projects plan, decision 7), templates/ or personal/ and have
 * no empty, `.` or `..` segment, no backslash, no colon (scheme) and no `%` (nothing is decoded).
 */
export function resolveTodoFilePath(target: string): string | null {
  let rest = target.trim();
  while (rest.startsWith('../')) rest = rest.slice(3);
  if (!ROOTS.some((r) => rest.startsWith(r))) return null;
  if (/[\\:%\0]/.test(rest)) return null;
  const parts = rest.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  return rest;
}

/** Every line index inside a `## Files` section (headings excluded), outside code fences, in order. */
function sectionLines(lines: string[]): number[] {
  const out: number[] = [];
  for (const [start, end] of todoSectionRanges(lines, TODO_FILES_HEADING)) {
    for (let i = start + 1; i < end; i++) out.push(i);
  }
  return out;
}

/** One section line as a web link, or null: an item with no holder whose target passes isTodoLinkUrl. */
function webLinkOf(line: string): TodoLink | null {
  const m = ITEM.exec(line);
  if (!m || m[4] !== undefined) return null;
  const url = (m[2] ?? m[3]) as string;
  const name = (m[1] as string).trim();
  return name !== '' && isTodoLinkUrl(url) ? { url, name } : null;
}

/**
 * The files linked in the body's `## Files` sections, in written order, each path once. Lines that
 * aren't a well-formed item, or whose target doesn't resolve, are skipped. `personal/` links keep their
 * holder; other links never have one.
 */
export function parseTodoFiles(body: string): TodoFileLink[] {
  const lines = String(body ?? '').split(/\r?\n/);
  const out: TodoFileLink[] = [];
  const seen = new Set<string>();
  for (const i of sectionLines(lines)) {
    const m = ITEM.exec(lines[i] as string);
    if (!m) continue;
    const path = resolveTodoFilePath((m[2] ?? m[3]) as string);
    if (path === null || seen.has(path)) continue;
    seen.add(path);
    const name = (m[1] as string).trim();
    out.push({ path, name, holder: path.startsWith('personal/') ? (m[4] ?? null) : null });
  }
  return out;
}

/**
 * The web links in the body's `## Files` sections, in written order, each URL once (the first name
 * kept). A line is a link when it is a well-formed item with no "(only on …'s Mac)" and its target passes
 * `isTodoLinkUrl`; anything else stays an extra.
 */
export function parseTodoLinks(body: string): TodoLink[] {
  const lines = String(body ?? '').split(/\r?\n/);
  const out: TodoLink[] = [];
  const seen = new Set<string>();
  for (const i of sectionLines(lines)) {
    const link = webLinkOf(lines[i] as string);
    if (link === null || seen.has(link.url)) continue;
    seen.add(link.url);
    out.push(link);
  }
  return out;
}

/**
 * Non-blank lines of the `## Files` sections that are neither a brain-file link `parseTodoFiles` reads
 * nor a web link `parseTodoLinks` reads (a sub-heading, a note written by hand, a link it refuses),
 * trimmed, in order. The skill keeps them on disk; the panel shows them as plain text so nothing in the
 * section is hidden.
 */
export function todoFileExtras(body: string): string[] {
  const lines = String(body ?? '').split(/\r?\n/);
  const out: string[] = [];
  for (const i of sectionLines(lines)) {
    const line = (lines[i] as string).trim();
    if (line === '') continue;
    const m = ITEM.exec(lines[i] as string);
    if (m && resolveTodoFilePath((m[2] ?? m[3]) as string) !== null) continue;
    if (webLinkOf(lines[i] as string) !== null) continue;
    out.push(line);
  }
  return out;
}

/**
 * The body without its `## Files` sections (`details`, what the panel shows and the editor edits), and
 * their exact source (`files`, two sections joined by a blank line; '' when there is none). Blank lines
 * either side of a removed section collapse to one blank line; `details` is trimmed at both ends. An
 * `## Updates` section stays in `details`: `splitTodoSections` (shared/todo-updates.ts) takes both out.
 */
export function splitTodoFiles(body: string): { details: string; files: string } {
  const { details, sections } = cutTodoSections(body, [TODO_FILES_HEADING]);
  return { details, files: sections[0] as string };
}
