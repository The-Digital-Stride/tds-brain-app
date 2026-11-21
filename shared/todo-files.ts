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
 */

/** The section starts at a level-2 heading that says exactly "Files" (any case). */
const FILES_HEADING = /^##[ \t]+files[ \t]*$/i;
/** It ends at the next level-1 or level-2 heading. */
const NEXT_HEADING = /^#{1,2}[ \t]/;
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

/** Indexes of the lines outside ``` and ~~~ code fences (the skill's `linesOutsideFences`). */
function linesOutsideFences(lines: string[]): number[] {
  const out: number[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] as string).match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence !== null) {
      if (m && (m[1] as string)[0] === fence[0] && (m[1] as string).length >= fence.length) fence = null;
      continue;
    }
    if (m) {
      fence = m[1] as string;
      continue;
    }
    out.push(i);
  }
  return out;
}

/** The [start, end) line range of the first `## Files` section outside code fences, or null. */
function sectionRange(lines: string[]): [number, number] | null {
  const outside = linesOutsideFences(lines);
  const at = outside.findIndex((i) => FILES_HEADING.test(lines[i] as string));
  if (at === -1) return null;
  const start = outside[at] as number;
  for (let k = at + 1; k < outside.length; k++) {
    const i = outside[k] as number;
    if (NEXT_HEADING.test(lines[i] as string)) return [start, i];
  }
  return [start, lines.length];
}

/**
 * The files linked in the body's first `## Files` section, in written order, each path once. Lines that
 * aren't a well-formed item, or whose target doesn't resolve, are skipped. `personal/` links keep their
 * holder; other links never have one.
 */
export function parseTodoFiles(body: string): TodoFileLink[] {
  const lines = String(body ?? '').split(/\r?\n/);
  const range = sectionRange(lines);
  if (!range) return [];
  const out: TodoFileLink[] = [];
  const seen = new Set<string>();
  for (let i = range[0] + 1; i < range[1]; i++) {
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
 * Non-blank lines of the first `## Files` section that aren't a brain-file link `parseTodoFiles` reads
 * (a web link, a sub-heading, a note written by hand), trimmed, in order. The skill keeps them on disk;
 * the panel shows them as plain text so nothing in the section is hidden.
 */
export function todoFileExtras(body: string): string[] {
  const lines = String(body ?? '').split(/\r?\n/);
  const range = sectionRange(lines);
  if (!range) return [];
  const out: string[] = [];
  for (let i = range[0] + 1; i < range[1]; i++) {
    const line = (lines[i] as string).trim();
    if (line === '') continue;
    const m = ITEM.exec(lines[i] as string);
    if (m && resolveTodoFilePath((m[2] ?? m[3]) as string) !== null) continue;
    out.push(line);
  }
  return out;
}

/**
 * The body without its first `## Files` section (`details`, what the panel shows and the editor edits),
 * and that section's exact source (`files`, '' when there is none). Blank lines either side of the
 * removed section collapse to one blank line; `details` is trimmed at both ends.
 */
export function splitTodoFiles(body: string): { details: string; files: string } {
  const text = String(body ?? '');
  const lines = text.split(/\r?\n/);
  const range = sectionRange(lines);
  if (!range) return { details: text.trim(), files: '' };
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const before = lines.slice(0, range[0]).join(eol).trimEnd();
  const after = lines.slice(range[1]).join(eol).trimStart();
  const files = lines.slice(range[0], range[1]).join(eol).trimEnd();
  const details = [before, after].filter((s) => s !== '').join(`${eol}${eol}`);
  return { details: details.trim(), files };
}
