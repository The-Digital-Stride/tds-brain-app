/**
 * Markdown <-> Tiptap JSON for to-do details, with an exact round trip (plan decision 7).
 * Pure: no DOM, so `scripts/todo-roundtrip.ts` can run it in Node.
 *
 * How it works:
 * - Tiptap's own lexer (marked 17 inside `@tiptap/markdown`, with Tiptap's task-list tokenizer) splits the
 *   markdown into top-level blocks. The joined `raw` of the tokens must equal the input, else the whole
 *   body becomes one kept block and `isFaithful` is false.
 * - A block is editable only when Tiptap parses it to one allowed node, that node re-serialises and
 *   re-parses to itself, and the re-serialised markdown renders to the same HTML as the source (so the
 *   parse dropped nothing). Anything else becomes a `keptBlock` holding the exact source.
 * - Each top-level node carries `md` (its source, position and the whitespace before it). On the way back
 *   a node whose JSON equals the parse of its source is written as that source; others are serialised in
 *   brain style.
 */
import { getSchema, type JSONContent } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import type { Schema } from '@tiptap/pm/model';
import { Marked, type Token, type Tokens, type TokensList } from 'marked';
import { type BlockOrigin, baseExtensions, KEPT_BLOCK, KEPT_LINK } from './extensions.ts';
import { isSafeHref } from './links.ts';

// ---------------------------------------------------------------------------------------------------------
// Shared readers and writers

let state: { manager: MarkdownManager; schema: Schema } | null = null;

function engine(): { manager: MarkdownManager; schema: Schema } {
  if (state) return state;
  const extensions = baseExtensions();
  const manager = new MarkdownManager({ extensions, indentation: { style: 'space', size: 2 } });
  // Tiptap escapes every `_`, `~`, `<`, `>` and `&`, which litters brain files; write only the escapes
  // markdown needs. The method is internal, so it is replaced on this one instance (packages pinned).
  Object.assign(manager, { encodeTextForMarkdown: encodeText });
  state = { manager, schema: getSchema(extensions) };
  return state;
}

/** An independent reader used to check that a block means the same before and after re-serialising. */
const htmlReader = new Marked({ gfm: true });

// ---------------------------------------------------------------------------------------------------------
// Text escaping for changed and new blocks

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;

/** Whether a text node begins a line: first in its block or after a hard break. */
function linePosition(node: JSONContent, parent: JSONContent | undefined): 'start' | 'mid' | 'unknown' {
  const siblings = parent?.content;
  const i = siblings ? siblings.indexOf(node) : -1;
  if (!siblings || i < 0) return 'unknown';
  return i === 0 || siblings[i - 1]?.type === 'hardBreak' ? 'start' : 'mid';
}

/** Escapes a marker that would turn the line into a heading, quote, list or rule. */
function escapeLineStart(text: string, dropSpaces: boolean): string {
  // Leading spaces mean nothing in markdown, or start a code block, so a line's own are dropped.
  const t = dropSpaces ? text.replace(/^[ \t]+/, '') : text;
  if (/^(?:#{1,6}(?:[ \t]|$)|>|[-+](?:[ \t]|$)|-+[ \t]*$|=+[ \t]*$)/.test(t)) return `\\${t}`;
  const num = /^(\d{1,9})[.)](?:[ \t]|$)/.exec(t);
  if (num?.[1]) return `${num[1]}\\${t.slice(num[1].length)}`;
  // Tiptap's list reader also takes one or two letters, or a Roman numeral, as a list number ("a)", "Dr.",
  // "OK.", "iv."), so their full stop or bracket is escaped too; otherwise the block falls back to escaping
  // every punctuation mark.
  const word = /^([a-zA-Z]{1,2}|[ivxlcdmIVXLCDM]+)[.)](?=[ \t]|$)/.exec(t);
  if (word?.[1]) return `${word[1]}\\${t.slice(word[1].length)}`;
  return t;
}

/**
 * How text is escaped. `brain`: only what markdown needs. A block whose `brain` writing would read back
 * differently is written again: `urls` leaves web addresses bare (an escaped `_` in one would show up in
 * the link), and `all` escapes every ASCII punctuation character, which markdown always reads as itself.
 */
let escaping: 'brain' | 'urls' | 'all' = 'brain';

/**
 * Stands in for a space in inline code while Tiptap writes it. Tiptap moves spaces at the ends of a mark
 * outside it, which is right for bold but drops them from code (` x ` would read back as `x`).
 */
const CODE_SPACE = '\uE000';

/** Web addresses as GFM links them: from `http(s)://` or `www.` to the next space or `<`. */
const URL_RUN = /((?:https?:\/\/|www\.)[^\s<]+)/i;

function brainEscape(text: string): string {
  let t = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    const next = text[i + 1] ?? '';
    if (c === '\\') t += ASCII_PUNCT.test(next) ? '\\\\' : '\\';
    else if (c === '*' || c === '`' || c === '[' || c === ']') t += `\\${c}`;
    else t += c;
  }
  // `_` only opens or closes emphasis next to a non-word character.
  t = t.replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\_');
  // A single `~` ("~5 days") is plain text; two can strike through.
  if ((t.match(/~/g)?.length ?? 0) >= 2) t = t.replace(/~/g, '\\~');
  t = t.replace(/<(?=[A-Za-z/!?])/g, '\\<');
  return t.replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&');
}

function encodeText(text: string, node: JSONContent, parent?: JSONContent): string {
  if (node.marks?.some((m) => m.type === 'code')) return text.replace(/ /g, CODE_SPACE);
  let t = '';
  if (escaping === 'all') for (const c of text) t += ASCII_PUNCT.test(c) ? `\\${c}` : c;
  else if (escaping === 'urls')
    t = text
      .split(URL_RUN)
      .map((part, i) => (i % 2 ? part : brainEscape(part)))
      .join('');
  else t = brainEscape(text);
  const at = linePosition(node, parent);
  // Unknown position: escape anyway (harmless mid-line) but keep the spaces.
  if (at !== 'mid') t = escapeLineStart(t, at === 'start');
  // A heading's closing `#`s are dropped ("## Ticket #" reads "Ticket"), so a final run of them is escaped.
  const siblings = parent?.content;
  if (parent?.type === 'heading' && siblings && siblings[siblings.length - 1] === node)
    t = t.replace(/(^|[ \t])(#+)([ \t]*)$/, '$1\\$2$3');
  return t;
}

// ---------------------------------------------------------------------------------------------------------
// Node helpers

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Drops `md` attrs, merges neighbouring text with the same marks and drops empty text. */
function tidy(node: JSONContent): JSONContent {
  const out: JSONContent = { ...node };
  if (out.attrs && 'md' in out.attrs) {
    const { md: _md, ...rest } = out.attrs;
    out.attrs = rest;
  }
  if (out.content) {
    const merged: JSONContent[] = [];
    for (const child of out.content.map(tidy)) {
      if (child.type === 'text' && !child.text) continue;
      const last = merged[merged.length - 1];
      if (last?.type === 'text' && child.type === 'text' && deepEqual(last.marks ?? [], child.marks ?? [])) {
        merged[merged.length - 1] = { ...last, text: `${last.text ?? ''}${child.text ?? ''}` };
      } else merged.push(child);
    }
    out.content = merged;
  }
  return out;
}

/** The node as the editor would hold it: every attr filled in, marks in schema order. Null if invalid. */
function canon(node: JSONContent): JSONContent | null {
  try {
    const pm = engine().schema.nodeFromJSON(tidy(node));
    pm.check();
    return tidy(pm.toJSON() as JSONContent);
  } catch {
    return null;
  }
}

type Marks = NonNullable<JSONContent['marks']>;

/** Each mark of every text node in `node` passed through `map` (a new tree; `node` is not changed). */
function mapMarks(node: JSONContent, map: (marks: Marks) => Marks): JSONContent {
  const out: JSONContent = { ...node };
  if (out.marks) out.marks = map(out.marks);
  if (out.content) out.content = out.content.map((c) => mapMarks(c, map));
  return out;
}

/** A link the editor must not show as a link (decision 14) becomes a `keptLink` holding its address. */
function keepUnsafeLinks(node: JSONContent): JSONContent {
  return mapMarks(node, (marks) =>
    marks.map((m) => {
      if (m.type !== 'link' || isSafeHref(String(m.attrs?.href ?? ''))) return m;
      const title = typeof m.attrs?.title === 'string' && m.attrs.title ? m.attrs.title : null;
      return { type: KEPT_LINK, attrs: { href: String(m.attrs?.href ?? ''), title } };
    }),
  );
}

/** Back to markdown links for writing; a `keptLink` under a real link (the Link button) gives way to it. */
function restoreKeptLinks(node: JSONContent): JSONContent {
  return mapMarks(node, (marks) => {
    if (!marks.some((m) => m.type === KEPT_LINK)) return marks;
    const linked = marks.some((m) => m.type === 'link');
    return marks.flatMap((m) =>
      m.type !== KEPT_LINK
        ? [m]
        : linked
          ? []
          : [{ type: 'link', attrs: { href: String(m.attrs?.href ?? ''), title: m.attrs?.title ?? null } }],
    );
  });
}

/** Soft line breaks read as spaces, so the editor shows flowing text. */
function softBreaksToSpaces(node: JSONContent): void {
  if (node.type === 'text' && node.text) node.text = node.text.replace(/[ \t]*\n[ \t]*/g, ' ');
  for (const child of node.content ?? []) softBreaksToSpaces(child);
}

const parseCache = new Map<string, JSONContent | null>();

/** Tiptap's reading of one block's markdown, canonical. Null unless it is exactly one valid node. */
function parseBlock(source: string): JSONContent | null {
  const hit = parseCache.get(source);
  if (hit !== undefined) return hit;
  let result: JSONContent | null = null;
  try {
    const nodes = engine().manager.parse(source).content ?? [];
    if (nodes.length === 1 && nodes[0]) {
      softBreaksToSpaces(nodes[0]);
      result = canon(keepUnsafeLinks(nodes[0]));
    }
  } catch {
    result = null;
  }
  if (parseCache.size > 2000) parseCache.clear();
  parseCache.set(source, result);
  return result;
}

/**
 * A link destination that reads back as exactly `href`: bare when it can be, else in angle brackets
 * (which allow spaces and brackets) with `\\`, `<` and `>` escaped.
 */
function linkDestination(href: string): string {
  if (/^[^\s()<>\\]*$/.test(href)) return href;
  return `<${href.replace(/[\\<>]/g, '\\$&')}>`;
}

/** Tiptap writes a link as `[text](${href} "${title}")`, so both are handed over ready to write. */
function withMarkdownLinks(node: JSONContent): JSONContent {
  const out: JSONContent = { ...node };
  if (out.marks)
    out.marks = out.marks.map((m) => {
      if (m.type !== 'link' || !m.attrs) return m;
      const attrs: Record<string, unknown> = {
        ...m.attrs,
        href: linkDestination(String(m.attrs.href ?? '')),
      };
      if (typeof m.attrs.title === 'string' && m.attrs.title)
        attrs.title = m.attrs.title.replace(/["\\]/g, '\\$&');
      return { ...m, attrs };
    });
  if (out.content) out.content = out.content.map(withMarkdownLinks);
  return out;
}

/** One top-level node in brain style, as Tiptap writes it. */
function serialiseNode(node: JSONContent): string {
  return engine()
    .manager.serialize({ type: 'doc', content: [withMarkdownLinks(restoreKeptLinks(tidy(node)))] })
    .trim()
    .replaceAll(CODE_SPACE, ' ');
}

// What "reads back the same" means for a block written fresh: the same nodes, attrs and text, and the same
// marks on every character, except that (as Tiptap writes and every markdown reader reads) spaces at the
// ends of a line, around a hard break and at the edges of bold, italic, strike and links may lose those
// marks or go, and a bare URL may come back as a link to itself.

const EDGE_MARKS = new Set(['bold', 'italic', 'strike', 'link', KEPT_LINK]);

interface Char {
  ch: string;
  marks: NonNullable<JSONContent['marks']>;
}

function isInline(content: JSONContent[]): boolean {
  return content.some((c) => c.type === 'text' || c.type === 'hardBreak');
}

function chars(content: JSONContent[]): Char[] {
  const out: Char[] = [];
  for (const c of content) {
    if (c.type === 'text') for (const ch of c.text ?? '') out.push({ ch, marks: c.marks ?? [] });
    else if (c.type === 'hardBreak') out.push({ ch: '\n', marks: [] });
    else out.push({ ch: `\u0000${JSON.stringify(c)}`, marks: [] });
  }
  return out;
}

function isLooseSpace(c: Char | undefined): boolean {
  return !!c && (c.ch === ' ' || c.ch === '\t') && !c.marks.some((m) => m.type === 'code');
}

/** Drops the spaces markdown drops: at the ends, and next to a hard break (and hard breaks at the ends). */
function trimChars(list: Char[]): Char[] {
  const edge = (c: Char | undefined) => isLooseSpace(c) || c?.ch === '\n';
  let a = 0;
  let b = list.length;
  while (a < b && edge(list[a])) a++;
  while (b > a && edge(list[b - 1])) b--;
  const core = list.slice(a, b);
  const out: Char[] = [];
  for (let i = 0; i < core.length; i++) {
    if (isLooseSpace(core[i])) {
      let l = i;
      while (isLooseSpace(core[l])) l--;
      let r = i;
      while (isLooseSpace(core[r])) r++;
      if (core[l]?.ch === '\n' || core[r]?.ch === '\n') continue;
    }
    out.push(core[i] as Char);
  }
  return out;
}

function marksKey(c: Char): string {
  const marks = isLooseSpace(c) ? c.marks.filter((m) => !EDGE_MARKS.has(m.type)) : c.marks;
  return JSON.stringify(marks);
}

function sameInline(want: JSONContent[], got: JSONContent[]): boolean {
  const x = trimChars(chars(want));
  const y = trimChars(chars(got));
  if (x.length !== y.length || x.some((c, i) => c.ch !== y[i]?.ch)) return false;
  // A bare URL the reader links (GFM autolink) is the same words; the link is dropped for comparing.
  const linkOf = (c: Char | undefined) => c?.marks.find((m) => m.type === 'link');
  for (let i = 0; i < y.length; ) {
    const link = linkOf(y[i]);
    if (!link || linkOf(x[i])) {
      i++;
      continue;
    }
    const key = JSON.stringify(link);
    let j = i;
    while (j < y.length && JSON.stringify(linkOf(y[j]) ?? null) === key && !linkOf(x[j])) j++;
    const text = y
      .slice(i, j)
      .map((c) => c.ch)
      .join('');
    const href = String(link.attrs?.href ?? '');
    if (href === text || href === `http://${text}` || href === `mailto:${text}`)
      for (let k = i; k < j; k++) {
        const c = y[k] as Char;
        y[k] = { ch: c.ch, marks: c.marks.filter((m) => m.type !== 'link') };
      }
    i = j;
  }
  return x.every((c, i) => marksKey(c) === marksKey(y[i] as Char));
}

/** Whether `got` (a block read back) holds what `want` (the editor's block) does, as described above. */
function readsSame(want: JSONContent | null, got: JSONContent | null): boolean {
  if (!want || !got || want.type !== got.type) return false;
  if (!deepEqual(want.attrs ?? {}, got.attrs ?? {})) return false;
  const a = want.content ?? [];
  const b = got.content ?? [];
  if (isInline(a) || isInline(b)) return sameInline(a, b);
  return a.length === b.length && a.every((n, i) => readsSame(n, b[i] ?? null));
}

/**
 * A changed or new block's markdown. Tiptap's writing is checked by reading it back; if it would read
 * differently it is written again with more left bare or more escaped (see `escaping`). If nothing reads
 * back the same, the first writing is kept: the words are all there.
 */
function writeFresh(node: JSONContent): string {
  const want = canon(node);
  // A web address linked to itself (as the reader links a bare one) is tried bare first, so editing a
  // paragraph doesn't turn `https://x` into `[https://x](https://x)`. Kept only if it reads back the same
  // in the editor AND the brain's own reader shows it as it shows the written-out link: Tiptap's older
  // marked links `www.` straight after punctuation ("Site:www.x"), the brain's doesn't (review finding).
  const first = serialiseNode(node);
  const bare = withoutSelfLinks(node);
  if (want && bare !== node) {
    const shown = meaning(first);
    for (const mode of ['brain', 'urls'] as const) {
      escaping = mode;
      let text: string;
      try {
        text = serialiseNode(bare);
      } finally {
        escaping = 'brain';
      }
      if (readsSame(want, parseBlock(text)) && meaning(text) === shown) return text;
    }
  }
  if (!want || readsSame(want, parseBlock(first))) return first;
  for (const mode of ['urls', 'all'] as const) {
    escaping = mode;
    let text: string;
    try {
      text = serialiseNode(node);
    } finally {
      escaping = 'brain';
    }
    if (readsSame(want, parseBlock(text))) return text;
  }
  return first;
}

/**
 * The node with the link taken off any text whose words are its own address (`https://x` → https://x,
 * `www.x` → http://www.x, `a@b` → mailto:a@b), which is what a bare address reads back as. The same
 * node when there is none.
 */
function withoutSelfLinks(node: JSONContent): JSONContent {
  let changed = false;
  const strip = (n: JSONContent): JSONContent => {
    let out = n;
    if (n.type === 'text' && n.marks?.length) {
      const text = n.text ?? '';
      const marks = n.marks.filter((m) => {
        if (m.type !== 'link') return true;
        const href = String(m.attrs?.href ?? '');
        const self = href === text || href === `http://${text}` || href === `mailto:${text}`;
        if (self && /^(?:https?:\/\/|www\.|[^\s@]+@[^\s@]+$)/i.test(text)) {
          changed = true;
          return false;
        }
        return true;
      });
      if (marks.length !== n.marks.length) out = marks.length ? { ...n, marks } : { type: n.type, text };
    }
    if (n.content) {
      const content = n.content.map(strip);
      if (content.some((c, i) => c !== n.content?.[i])) out = { ...out, content };
    }
    return out;
  };
  const out = strip(node);
  return changed ? out : node;
}

/** Rendered HTML with list looseness and layout whitespace evened out. */
function meaning(md: string): string {
  const html = htmlReader.parse(md, { async: false }) as string;
  return html
    .replace(
      /\s*(<\/?(?:ul|ol|li|p|h[1-6]|blockquote|table|thead|tbody|tr|td|th|pre|hr|br)\b[^>]*>)\s*/g,
      '$1',
    )
    .replace(/<\/p><p>/g, '¶')
    .replace(/<\/?p>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function walk(node: JSONContent, visit: (n: JSONContent) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

function hasUnsafeLink(node: JSONContent): boolean {
  let unsafe = false;
  walk(node, (n) => {
    for (const m of n.marks ?? [])
      if (m.type === 'link' && !isSafeHref(String(m.attrs?.href ?? ''))) unsafe = true;
  });
  return unsafe;
}

/** `[ ]`/`[x]` markers on task-item lines, in order, as offsets into `source`. */
export function taskMarkers(source: string): { offset: number; checked: boolean }[] {
  const out: { offset: number; checked: boolean }[] = [];
  let pos = 0;
  for (const line of source.split('\n')) {
    const m = /^([ \t]*[-+*][ \t]+\[)([ xX])\](?:[ \t]|$)/.exec(line);
    if (m?.[1]) out.push({ offset: pos + m[1].length, checked: m[2] !== ' ' });
    pos += line.length + 1;
  }
  return out;
}

function taskStates(node: JSONContent): boolean[] {
  const out: boolean[] = [];
  walk(node, (n) => {
    if (n.type === 'taskItem') out.push(n.attrs?.checked === true);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Splitting into blocks

const EDITABLE: Record<string, string[]> = {
  paragraph: ['paragraph'],
  heading: ['heading'],
  list: ['bulletList', 'orderedList', 'taskList'],
  taskList: ['taskList'],
};

export interface Block {
  /** Offset of the block in the markdown. */
  start: number;
  /** The lexer's token type (`paragraph`, `list`, `table`, ...), or `joined`/`whole`. */
  kind: string;
  source: string;
  before: string;
  /** The editable node, or null for a kept block. */
  node: JSONContent | null;
  /** Why it is kept, when it is. */
  kept?: KeptReason;
}

export interface Analysis {
  blocks: Block[];
  /** True when the markdown could not be split exactly; it is then one kept block. */
  fallback: boolean;
}

/** Why a block is kept rather than editable (for the dev round-trip report). */
export type KeptReason =
  | 'type'
  | 'deep-heading'
  | 'refs'
  | 'parse'
  | 'unsafe-link'
  | 'reserialise'
  | 'meaning'
  | 'tasks';

function editableNode(token: Token, source: string, hasRefs: boolean): JSONContent | KeptReason {
  const allowed = EDITABLE[token.type];
  if (!allowed) return 'type';
  if (token.type === 'heading' && ((token as Tokens.Heading).depth ?? 0) > 3) return 'deep-heading';
  if (hasRefs && source.includes('[')) return 'refs';
  const node = parseBlock(source);
  if (!node?.type || !allowed.includes(node.type)) return 'parse';
  if (hasUnsafeLink(node)) return 'unsafe-link';
  const out = writeFresh(node);
  if (!deepEqual(parseBlock(out), node)) return 'reserialise';
  if (meaning(out) !== meaning(source)) return 'meaning';
  const markers = taskMarkers(source).map((m) => m.checked);
  if (!deepEqual(markers, taskStates(node))) return 'tasks';
  return node;
}

const analysisCache = new Map<string, Analysis>();

export function analyse(markdown: string): Analysis {
  const hit = analysisCache.get(markdown);
  if (hit) return hit;
  const result = analyseUncached(markdown);
  if (analysisCache.size > 200) analysisCache.clear();
  analysisCache.set(markdown, result);
  return result;
}

interface Span {
  start: number;
  end: number;
  token: Token;
}

function lex(markdown: string): TokensList | null {
  try {
    const tokens = engine().manager.instance.lexer(markdown) as TokensList;
    return tokens.map((t) => t.raw).join('') === markdown ? tokens : null;
  } catch {
    return null;
  }
}

/** Each top-level block's span, without the blank lines around it. Blocks sharing a line are joined. */
function blockSpans(markdown: string, tokens: TokensList): Span[] {
  const spans: Span[] = [];
  let pos = 0;
  for (const token of tokens) {
    const raw = token.raw;
    const lead = /^(?:[ \t]*\n)*/.exec(raw)?.[0].length ?? 0;
    const body = raw.slice(lead).replace(/\s+$/, '');
    if (token.type !== 'space' && body) {
      const span = { start: pos + lead, end: pos + lead + body.length, token };
      const prev = spans[spans.length - 1];
      // Two tokens on one line can't be separated safely: keep them together, as one kept block.
      if (prev && !markdown.slice(prev.end, span.start).includes('\n')) {
        prev.end = span.end;
        prev.token = { type: 'joined', raw: markdown.slice(prev.start, span.end) } as Token;
      } else spans.push(span);
    }
    pos += raw.length;
  }
  return spans;
}

function analyseUncached(markdown: string): Analysis {
  if (markdown === '') return { blocks: [], fallback: false };
  const whole: Analysis = {
    blocks: [{ start: 0, kind: 'whole', source: markdown, before: '', node: null }],
    fallback: true,
  };
  const tokens = lex(markdown);
  if (!tokens) return whole;
  const hasRefs = Object.keys(tokens.links ?? {}).length > 0;
  const spans = blockSpans(markdown, tokens);
  if (spans.length === 0) return whole;

  const blocks: Block[] = [];
  let prevEnd = 0;
  for (const span of spans) {
    const source = markdown.slice(span.start, span.end);
    let found: JSONContent | KeptReason;
    try {
      found = editableNode(span.token, source, hasRefs);
    } catch {
      found = 'parse';
    }
    const node = typeof found === 'string' ? null : found;
    const kept = typeof found === 'string' ? found : undefined;
    blocks.push({
      start: span.start,
      kind: span.token.type,
      source,
      before: markdown.slice(prevEnd, span.start),
      node,
      kept,
    });
    prevEnd = span.end;
  }
  return { blocks, fallback: false };
}

// ---------------------------------------------------------------------------------------------------------
// Public API

function readOrigin(node: JSONContent): BlockOrigin | null {
  const md = node.attrs?.md as Partial<BlockOrigin> | null | undefined;
  if (!md || typeof md.source !== 'string' || typeof md.index !== 'number' || typeof md.before !== 'string')
    return null;
  return { source: md.source, index: md.index, before: md.before };
}

export function toDoc(markdown: string): JSONContent {
  const { blocks } = analyse(markdown);
  if (blocks.length === 0) return { type: 'doc', content: [{ type: 'paragraph' }] };
  const content = blocks.map((b, index): JSONContent => {
    const md: BlockOrigin = { source: b.source, index, before: b.before };
    if (b.node) return { ...structuredClone(b.node), attrs: { ...(b.node.attrs ?? {}), md } };
    return { type: KEPT_BLOCK, attrs: { source: b.source, md } };
  });
  return { type: 'doc', content };
}

function isEmptyParagraph(node: JSONContent): boolean {
  return node.type === 'paragraph' && !(node.content ?? []).some((c) => c.type !== 'text' || c.text?.trim());
}

interface Written {
  text: string;
  origin: BlockOrigin | null;
  unchanged: boolean;
}

function writeNode(node: JSONContent, force: boolean): Written | null {
  if (isEmptyParagraph(node)) return null;
  const origin = readOrigin(node);
  if (node.type === KEPT_BLOCK) {
    const text = String(node.attrs?.source ?? '');
    return text.trim() ? { text, origin, unchanged: true } : null;
  }
  if (!force && origin) {
    const now = canon(node);
    if (now && deepEqual(now, parseBlock(origin.source)))
      return { text: origin.source, origin, unchanged: true };
  }
  let text: string;
  try {
    text = writeFresh(node);
  } catch {
    // Never expected; keep the words rather than throw from the editor's change handler.
    text = plainText(node).trim();
  }
  return text ? { text, origin, unchanged: false } : null;
}

function plainText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content ?? []).map(plainText);
  return node.type === 'paragraph' || node.type === 'heading' ? inner.join('') : inner.join('\n\n');
}

/**
 * What goes between two pieces: the whitespace that was there when they were neighbours, else a blank line. A
 * tight one ("Text:\n- list", or a tick list straight above a plain one) is kept when a side changed too, so a
 * tick or a word typed doesn't loosen the list; `keepBlocksApart` loosens it (`loose`) if they then run together.
 */
function separator(prev: Piece, cur: Piece): string {
  const a = prev.origin;
  const b = cur.origin;
  if (!a || !b || a.index + 1 !== b.index) return '\n\n';
  if (cur.loose && !/\n[ \t]*\n/.test(b.before)) return '\n\n';
  return b.before;
}

/** Whether the separator before `cur` has no blank line, so it could be loosened. */
function isTight(prev: Piece, cur: Piece): boolean {
  return !/\n[ \t]*\n/.test(separator(prev, cur));
}

// ---------------------------------------------------------------------------------------------------------
// Keeping blocks apart
//
// A block written fresh, or two blocks that were not neighbours before, can run together: two lists with
// the same bullet become one list, and a list swallows an indented code block after it. So the joined
// markdown is read again and every block must still be its own block, of the same type, over the same
// span as when read alone. Untouched blocks are never rewritten. Instead:
// - a changed bullet list next to a list with the same bullet keeps its original bullet if that differs,
//   else takes one its neighbours don't use (numbered lists can't do this: Tiptap's reader, marked, joins
//   `1.` and `1)` lists, so they get the break below);
// - anything still running together gets an empty HTML comment between, the CommonMark spec's own way
//   to end a list (spec 5.3, "Lists"). It reads as nothing and stays in the file as a kept block.

/** Written between two blocks that would otherwise run together. */
export const BLOCK_BREAK = '<!-- -->';

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

interface Piece extends Written {
  /** A changed list, whose bullets may be switched. */
  list: boolean;
  /** A `BLOCK_BREAK` added here. */
  breaker: boolean;
  /** Its tight separator ran it into the piece before, so it gets a blank line instead. */
  loose?: boolean;
}

const spanCache = new Map<string, { start: number; end: number; type: string }[] | null>();

/** The blocks a piece of markdown reads as on its own: span and token type. Null if it can't be lexed. */
function shapeOf(markdown: string): { start: number; end: number; type: string }[] | null {
  const hit = spanCache.get(markdown);
  if (hit !== undefined) return hit;
  const tokens = lex(markdown);
  const result = tokens
    ? blockSpans(markdown, tokens).map((sp) => ({ start: sp.start, end: sp.end, type: sp.token.type }))
    : null;
  if (spanCache.size > 2000) spanCache.clear();
  spanCache.set(markdown, result);
  return result;
}

/** A bullet list's bullet (`-`, `*`, `+`), when the markdown starts with one. */
function bulletOf(markdown: string): string | null {
  const first = lex(markdown)?.find((t) => t.type !== 'space');
  if (first?.type !== 'list' || (first as Tokens.List).ordered) return null;
  return /^ {0,3}([-+*])/.exec(markdown)?.[1] ?? null;
}

/** Changed bullet lists take a bullet their neighbours don't use, so they don't join them. */
function keepListsApart(pieces: Piece[]): void {
  pieces.forEach((piece, i) => {
    if (!piece.list || piece.unchanged) return;
    const own = bulletOf(piece.text);
    if (!own) return;
    const clash = [pieces[i - 1], pieces[i + 1]].map((n) => (n ? bulletOf(n.text) : null));
    if (!clash.includes(own)) return;
    const original = piece.origin ? bulletOf(piece.origin.source) : null;
    const pick = [original, '-', '*', '+'].find((m) => m && !clash.includes(m));
    if (!pick) return;
    // Top-level items start at the line start; nested ones are indented.
    const text = piece.text.replace(/^[-+*](?=[ \t]|$)/gm, pick);
    if (deepEqual(parseBlock(text), parseBlock(piece.text))) piece.text = text;
  });
}

function join(pieces: Piece[]): { out: string; offsets: number[] } {
  let out = '';
  const offsets: number[] = [];
  pieces.forEach((cur, i) => {
    const prev = pieces[i - 1];
    if (prev) out += separator(prev, cur);
    offsets.push(out.length);
    out += cur.text;
  });
  return { out, offsets };
}

/**
 * The first place two pieces run together, as the index of the piece before it; null when every piece
 * reads as it does alone, or when that can't be checked.
 */
function runTogether(out: string, offsets: number[], pieces: Piece[]): number | null {
  const want: { start: number; end: number; type: string; piece: number }[] = [];
  for (let p = 0; p < pieces.length; p++) {
    const shape = shapeOf((pieces[p] as Piece).text);
    if (!shape) return null;
    const at = offsets[p] ?? 0;
    for (const sp of shape) want.push({ start: sp.start + at, end: sp.end + at, type: sp.type, piece: p });
  }
  const got = shapeOf(out);
  if (!got) return null;
  const k = want.findIndex(
    (w, i) => got[i]?.start !== w.start || got[i]?.end !== w.end || got[i]?.type !== w.type,
  );
  if (k < 0 && got.length === want.length) return null;
  const at = k < 0 ? want.length - 1 : k;
  const w = want[at];
  if (!w) return null;
  // This piece reaches into the next one, unless it is the last (then the one before reached into it).
  const p = w.piece;
  if (k >= 0 && got[k]?.start === w.start && p + 1 < pieces.length) return p;
  return Math.max(0, p - 1);
}

function breaker(): Piece {
  return { text: BLOCK_BREAK, origin: null, unchanged: false, list: false, breaker: true };
}

/** Joins the pieces, adding `BLOCK_BREAK` wherever two would run together. */
function keepBlocksApart(pieces: Piece[]): string {
  // The details are stored trimmed, so a first block starting with spaces (indented code) needs a break.
  if (/^[ \t]/.test(pieces[0]?.text ?? '')) pieces.unshift(breaker());
  let { out, offsets } = join(pieces);
  // Each piece can be loosened once and each gap broken once.
  for (let round = 0; round < pieces.length * 3; round++) {
    const at = runTogether(out, offsets, pieces);
    if (at === null) break;
    const prev = pieces[at];
    const next = pieces[at + 1];
    // A tight separator first gives way to a blank line, which is all most blocks need.
    if (prev && next && !next.loose && !next.breaker && !prev.breaker && isTight(prev, next)) {
      next.loose = true;
      ({ out, offsets } = join(pieces));
      continue;
    }
    // Already broken there: nothing better can be done without rewriting an untouched block.
    if (prev?.breaker || next?.breaker) break;
    pieces.splice(at + 1, 0, breaker());
    ({ out, offsets } = join(pieces));
  }
  return out;
}

export function toMarkdown(doc: JSONContent): string {
  const pieces: Piece[] = [];
  for (const node of doc.content ?? []) {
    const cur = writeNode(node, false);
    if (cur) pieces.push({ ...cur, list: LIST_TYPES.has(node.type ?? ''), breaker: false });
  }
  // Every block as it was, in its first order: the original markdown, nothing to check.
  const asWas = pieces.every((p, i) => p.unchanged && p.origin?.index === i);
  if (asWas) return join(pieces).out.trim();
  keepListsApart(pieces);
  return keepBlocksApart(pieces).trim();
}

/**
 * A fenced code block with no closing fence runs to the end of the details, so a block typed after it would be
 * swallowed into the code. Such details open read-only.
 */
function unclosedFence(source: string): boolean {
  const lines = source.replace(/\n+$/, '').split('\n');
  const open = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0] ?? '');
  if (!open) return false;
  const fence = open[1] as string;
  if (lines.length < 2) return true;
  const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
  return !close.test(lines[lines.length - 1] as string);
}

export function isFaithful(markdown: string): boolean {
  try {
    const { blocks, fallback } = analyse(markdown);
    if (fallback) return false;
    if (blocks.some((b) => b.kind === 'code' && unclosedFence(b.source))) return false;
    if (toMarkdown(toDoc(markdown)) !== markdown) return false;
    for (const b of blocks) {
      if (!b.node) continue;
      const forced = writeNode(b.node, true);
      if (!forced || !deepEqual(parseBlock(forced.text), b.node)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export { isSafeHref };
