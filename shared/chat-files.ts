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
  let p = unwrap(raw);
  if (!p || p.startsWith('~')) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p) || /^(mailto|javascript|data|tel):/i.test(p)) return null;
  p = p.replace(/[#?].*$/s, '');
  p = p.replace(/(?::\d+)+(?:-\d+)?$/, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    // Not valid percent-encoding: keep the text as written.
  }
  p = p.replace(/\\/g, '/');
  if (!p || p.startsWith('~')) return null;
  const segments = p.split('/');
  if (segments.includes('..')) return null;
  if (p.startsWith('/')) {
    const root = brainRoot.trim().replace(/\/+$/, '');
    if (!root || !p.startsWith(`${root}/`)) return null;
    p = p.slice(root.length + 1);
  }
  const out = p.split('/').filter((s) => s !== '' && s !== '.');
  return out.length ? out.join('/') : null;
}

// Strips whitespace and any wrapping backticks, quotes or angle brackets, however many layers.
function unwrap(raw: string): string {
  let p = raw.trim();
  for (;;) {
    const m = /^(`+)(.*)\1$/s.exec(p) ?? /^(["'])(.*)\1$/s.exec(p) ?? /^(<)(.*)>$/s.exec(p);
    if (!m) return p;
    p = (m[2] as string).trim();
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[`~]*[ \t]*(?=\n|$)|(?![\s\S]))/gm;

// Blanks fenced code blocks (keeping length) so nothing in them is read.
function withoutFences(text: string): string {
  return text.replace(FENCE, (m) => m.replace(/[^\n]/g, ' '));
}

const MD_LINK = /\[[^\]\n]*\]\(\s*(?:<([^>\n]*)>|([^\s)]*))[^)\n]*\)/g;
const CODE_SPAN = /`([^`\n]+)`/g;
const BARE_PATH =
  /(?<![\w/.~-])((?:\/[^\s/`]+){0,32}?\/(?:clients|personal)\/[^\s`<>"]+|(?:clients|personal)\/[^\s`<>"]+)/g;
const MAX_SCAN = 100_000;
const MAX_CANDIDATE = 1000;
const TRAILING = /[.,;:!?)\]]+$/;

/**
 * Candidate file paths in a finished reply, raw (not normalised), each once, in order of first
 * appearance: Markdown link targets that are not web addresses, inline code spans, and bare
 * paths that start `clients/`, `personal/` or the brain root and end in a file extension.
 * Text inside fenced code blocks is skipped. At most 200.
 */
export function findPathMentions(text: string): string[] {
  const body = withoutFences(text.slice(0, MAX_SCAN));
  const found: { at: number; raw: string }[] = [];
  const mask = body.split('');
  const blank = (from: number, len: number) => {
    for (let i = from; i < from + len; i++) mask[i] = ' ';
  };
  for (const m of body.matchAll(MD_LINK)) {
    const target = (m[1] ?? m[2] ?? '').trim();
    if (target && !/^(https?:|mailto:|#)/i.test(target)) found.push({ at: m.index, raw: target });
    blank(m.index, m[0].length);
  }
  const afterLinks = mask.join('');
  for (const m of afterLinks.matchAll(CODE_SPAN)) {
    const raw = (m[1] as string).trim();
    if (raw && raw.length <= 300) found.push({ at: m.index, raw });
    blank(m.index, m[0].length);
  }
  const rest = mask.join('');
  for (const m of rest.matchAll(BARE_PATH)) {
    const raw = (m[1] as string).slice(0, MAX_CANDIDATE).replace(TRAILING, '');
    if (/\.[A-Za-z0-9]{1,8}(?::\d+(?:-\d+)?)?$/.test(raw)) found.push({ at: m.index, raw });
  }
  found.sort((a, b) => a.at - b.at);
  return unique(
    found.map((f) => f.raw),
    200,
  );
}

function unique(items: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(i);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * `http:` / `https:` addresses in a reply (Markdown link targets and bare addresses), each once, in
 * order, with trailing punctuation `.,;:!?)` that is not part of the address dropped. Fenced code
 * blocks are skipped. At most 100.
 */
export function findWebLinks(text: string): string[] {
  const out: string[] = [];
  for (const m of withoutFences(text).matchAll(/https?:\/\/[^\s<>"'`\]]+/gi)) {
    const url = trimUrl(m[0]);
    if (/^https?:\/\/[^/?#]/i.test(url)) out.push(url);
  }
  return unique(out, 100);
}

// Drops trailing punctuation and any unbalanced closing bracket, so "(https://a.com)." gives the address.
function trimUrl(url: string): string {
  let u = url;
  for (;;) {
    const last = u.at(-1);
    if (last && '.,;:!?*\'"'.includes(last)) u = u.slice(0, -1);
    else if (last === ')' && count(u, ')') > count(u, '(')) u = u.slice(0, -1);
    else return u;
  }
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

/**
 * Which group a file shows in: `made` (created or changed), else `attached` (filed), else
 * `mentioned`, else `looked-at` (read only).
 */
export function chatFileGroup(file: ChatFile): ChatFileGroup {
  if (file.actions.includes('created') || file.actions.includes('changed')) return 'made';
  if (file.actions.includes('filed')) return 'attached';
  if (file.actions.includes('mentioned')) return 'mentioned';
  return 'looked-at';
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
  const byPath = new Map<string, string>();
  const byToolUse = new Map<string, string>();
  for (const f of files) {
    byPath.set(f.path, f.key);
    for (const id of f.toolUseIds) byToolUse.set(id, f.key);
  }
  return { byPath, byToolUse };
}

/** The URL fragment a reply link to a chat file is rewritten to. Click handling looks for this prefix. */
export const CHAT_FILE_HREF_PREFIX = '#chat-file=';
