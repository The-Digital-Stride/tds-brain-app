/**
 * Chat summaries as project updates (plan docs/plans/2026-11-24-chat-summary-updates.md, decision 2): builds and
 * reads the fixed body layout of a `chat` entry. Pure, no I/O, so the server and the app share it.
 */
import {
  CHAT_DOC_NAME_MAX,
  CHAT_DOCUMENTS_MAX,
  CHAT_FIGURE_MAX,
  CHAT_FIGURES_MAX,
  CHAT_NEXT_STEP_MAX,
  CHAT_NEXT_STEPS_MAX,
  CHAT_OBJECTIVE_MAX,
  CHAT_OUTCOME_MAX,
  CHAT_TITLE_MAX,
  type ChatSummaryFields,
} from './chat-summary-contract.ts';
import { UPDATE_SUMMARY_MAX } from './project-updates-contract.ts';

/** A document ref longer than this is dropped (cutting one would break it). */
const REF_MAX = 1_000;

const fold = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();
const cut = (s: string, max: number): string => (s.length > max ? s.slice(0, max).trimEnd() : s);
const clean = (s: unknown, max: number): string => cut(fold(typeof s === 'string' ? s : ''), max);

/** Trims, folds line ends, drops empty items and cuts everything to the contract limits. */
export function normaliseChatSummaryFields(fields: ChatSummaryFields): ChatSummaryFields {
  const list = (v: unknown, max: number, count: number): string[] =>
    (Array.isArray(v) ? v : [])
      .map((x) => clean(x, max))
      .filter((x) => x !== '')
      .slice(0, count);
  const documents = (Array.isArray(fields.documents) ? fields.documents : [])
    .map((d) => ({ ref: clean(d?.ref, Number.POSITIVE_INFINITY), name: clean(d?.name, CHAT_DOC_NAME_MAX) }))
    .filter((d) => d.ref !== '' && d.ref.length <= REF_MAX)
    .map((d) => ({ ref: d.ref, name: d.name === '' ? d.ref.slice(0, CHAT_DOC_NAME_MAX) : d.name }))
    .slice(0, CHAT_DOCUMENTS_MAX);
  return {
    objective: clean(fields.objective, CHAT_OBJECTIVE_MAX),
    outcome: clean(fields.outcome, CHAT_OUTCOME_MAX),
    figures: list(fields.figures, CHAT_FIGURE_MAX, CHAT_FIGURES_MAX),
    documents,
    nextSteps: list(fields.nextSteps, CHAT_NEXT_STEP_MAX, CHAT_NEXT_STEPS_MAX),
  };
}

// Backslash-escapes what could start a link, image, autolink, raw tag, emphasis or code span. Bare web
// addresses and email addresses (GFM autolinks) are broken too: the colon after a scheme, the dot of `www.`, `@`.
const escapeText = (s: string): string =>
  s
    .replace(/[\\[\]<>*_`@]/g, '\\$&')
    // No \b: an address glued to a word (`foo_https://…`, `1www.…`) still autolinks in GFM (security review).
    .replace(/((?:https?|ftp)):/gi, '$1\\:')
    .replace(/www\./gi, (m) => `${m.slice(0, 3)}\\.`);
const unescapeText = (s: string): string => s.replace(/\\([\\[\]<>*_`@:.])/g, '$1');

// A ref lives only in the link target: anything that could end or reshape it is percent-encoded.
const escapeRef = (s: string): string =>
  s.replace(/[^\x21-\x7e]|[%()<>\\[\]"'`*_]/gu, (c) =>
    c.charCodeAt(0) < 128
      ? `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
      : encodeURIComponent(c),
  );
const unescapeRef = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const H_OBJECTIVE = '**Objective:** ';
const H_OUTCOME = '**Outcome:** ';
const H_FIGURES = '**Key figures:**';
const H_DOCUMENTS = '**Documents:**';
const H_STEPS = '**Next steps:**';

function build(f: ChatSummaryFields): string {
  const blocks: string[] = [];
  if (f.objective) blocks.push(`${H_OBJECTIVE}${escapeText(f.objective)}`);
  if (f.outcome) blocks.push(`${H_OUTCOME}${escapeText(f.outcome)}`);
  if (f.figures.length) blocks.push(`${H_FIGURES}\n${f.figures.map((x) => `- ${escapeText(x)}`).join('\n')}`);
  if (f.documents.length)
    blocks.push(
      `${H_DOCUMENTS}\n${f.documents.map((d) => `- [${escapeText(d.name)}](${escapeRef(d.ref)})`).join('\n')}`,
    );
  if (f.nextSteps.length)
    blocks.push(`${H_STEPS}\n${f.nextSteps.map((x) => `- ${escapeText(x)}`).join('\n')}`);
  return blocks.join('\n\n');
}

/**
 * The body of a `chat` entry (contract layout). If the escaped text would pass UPDATE_SUMMARY_MAX, the
 * lowest-priority parts go first: documents, then key figures, then next steps (last item first), then the
 * outcome is shortened.
 */
export function composeChatSummary(fields: ChatSummaryFields): string {
  const f = normaliseChatSummaryFields(fields);
  let body = build(f);
  while (body.length > UPDATE_SUMMARY_MAX) {
    if (f.documents.length) f.documents.pop();
    else if (f.figures.length) f.figures.pop();
    else if (f.nextSteps.length) f.nextSteps.pop();
    else if (f.outcome.length > 0) f.outcome = cut(f.outcome, Math.max(0, f.outcome.length - 100));
    else f.objective = cut(f.objective, Math.max(0, f.objective.length - 100));
    body = build(f);
  }
  return body;
}

function listOf(block: string, header: string): string[] | null {
  if (!block.startsWith(`${header}\n`)) return null;
  const lines = block.slice(header.length + 1).split('\n');
  if (lines.some((l) => !l.startsWith('- ') || l.length < 3)) return null;
  return lines.map((l) => l.slice(2));
}

const DOC_LINE = /^\[((?:\\[\s\S]|[^\\\]])*)\]\(([^()\s]*)\)$/;

/** Reads a body back into its fields; null when it isn't the layout (hand-edited, another kind of entry). */
export function readChatSummary(body: string): ChatSummaryFields | null {
  if (typeof body !== 'string') return null;
  const text = body.replace(/\r\n?/g, '\n').trim();
  if (text === '') return null;
  const out: ChatSummaryFields = { objective: '', outcome: '', figures: [], documents: [], nextSteps: [] };
  let seen = -1;
  for (const block of text.split('\n\n')) {
    let at: number;
    if (block.startsWith(H_OBJECTIVE)) {
      at = 0;
      out.objective = unescapeText(block.slice(H_OBJECTIVE.length));
    } else if (block.startsWith(H_OUTCOME)) {
      at = 1;
      out.outcome = unescapeText(block.slice(H_OUTCOME.length));
    } else if (block.startsWith(H_FIGURES)) {
      at = 2;
      const items = listOf(block, H_FIGURES);
      if (!items) return null;
      out.figures = items.map(unescapeText);
    } else if (block.startsWith(H_DOCUMENTS)) {
      at = 3;
      const items = listOf(block, H_DOCUMENTS);
      if (!items) return null;
      for (const item of items) {
        const m = DOC_LINE.exec(item);
        if (!m) return null;
        out.documents.push({ name: unescapeText(m[1] as string), ref: unescapeRef(m[2] as string) });
      }
    } else if (block.startsWith(H_STEPS)) {
      at = 4;
      const items = listOf(block, H_STEPS);
      if (!items) return null;
      out.nextSteps = items.map(unescapeText);
    } else return null;
    if (at <= seen || (block.includes('\n') && at < 2)) return null;
    seen = at;
  }
  if (!out.objective && !out.outcome) return null;
  return out;
}

/**
 * A chat title the script can always write (correctness review): its frontmatter quoting needs no escapes, so a
 * title holding `'` together with `"` or `\` can't be written. Then `"` becomes `'` and `\` becomes `/`.
 * One line, at most CHAT_TITLE_MAX.
 */
export function writableChatTitle(title: string): string {
  let t = title.replace(/\s+/g, ' ').trim();
  if (t.includes("'") && (t.includes('"') || t.includes('\\'))) t = t.replace(/"/g, "'").replace(/\\/g, '/');
  return t.slice(0, CHAT_TITLE_MAX).trim();
}
