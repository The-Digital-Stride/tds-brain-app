/**
 * What a Write, Edit or MultiEdit will do to a file, as lines for the approval card.
 *
 * Worked out only from what Claude sent: the file on disk is never read, so nothing the person
 * could not otherwise see (a hidden `.env`, say) is shown. A Write to an existing file therefore
 * says it replaces the file rather than showing what is lost.
 */
import type { ChangeLine, ChangePart, ProposedChange } from '../../shared/contract.ts';

type Rec = Record<string, unknown>;

/**
 * Most characters one card shows, each line counting its line break too, so a pile of blank lines
 * costs as much as text. Anything longer is cut, marked, and the card warns.
 */
export const MAX_CHANGE_CHARS = 50_000;
/** Most lines one card shows, however short they are. */
export const MAX_CHANGE_LINES = 2_000;
/** Unchanged lines kept either side of a change. */
export const CONTEXT_LINES = 3;
/** Above this many line pairs (after common lines at each end), lines are not aligned one by one. */
const MAX_ALIGN_CELLS = 1_000_000;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `stripped`: one final line break was taken off, so empty text was one blank line, not none. */
function toLines(text: string, stripped = false): string[] {
  if (text === '') return stripped ? [''] : [];
  return text.split('\n');
}

/**
 * Characters that are invisible or change how the text around them is shown: control characters
 * (not tab), direction overrides and isolates, zero-width spaces and marks, line and paragraph
 * separators, blank-looking fillers (Hangul fillers, the blank braille cell, the grapheme joiner),
 * variation selectors other than the two emoji ones, the byte-order mark, the object replacement
 * character, and tag characters (which can spell out hidden text).
 *
 * Left alone: joiners (U+200C, U+200D), which emoji and some scripts need and which cannot reorder
 * text; U+FE0E and U+FE0F, which pick the text or emoji look of a symbol (as in the red heart emoji); and the tag
 * sequences of the England, Scotland and Wales flags, matched whole so no other tag text passes.
 * A carriage return is marked only inside a line; one at the end is just a Windows line ending.
 *
 * Built from code-point numbers so the source never holds the invisible characters themselves
 * (the formatter would otherwise turn written escapes back into them).
 */
const HIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x180e, 0x180e],
  [0x200b, 0x200b],
  [0x200e, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0x2800, 0x2800],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0d],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffc],
  [0xe0000, 0xe007f],
  [0xe0100, 0xe01ef],
];
const cp = (n: number) => `\\u{${n.toString(16)}}`;
const seq = (...ns: number[]) => ns.map(cp).join('');
/** 🏴 + g b + (e n g | s c t | w l s) + cancel tag. */
const UK_FLAGS = `${seq(0x1f3f4, 0xe0067, 0xe0062)}(?:${seq(0xe0065, 0xe006e, 0xe0067)}|${seq(0xe0073, 0xe0063, 0xe0074)}|${seq(0xe0077, 0xe006c, 0xe0073)})${cp(0xe007f)}`;
const HIDDEN_CLASS = `[${HIDDEN_RANGES.map(([a, b]) => (a === b ? cp(a) : `${cp(a)}-${cp(b)}`)).join('')}]`;
const HIDDEN = new RegExp(`(${UK_FLAGS})|${HIDDEN_CLASS}|\\r(?!$)`, 'gu');

/** Shows each hidden character as a visible `⟨U+XXXX⟩` marker, so the card cannot look innocent. */
export function revealHidden(text: string): { text: string; found: boolean } {
  let found = false;
  const shown = text.replace(HIDDEN, (ch: string, flag: string | undefined) => {
    if (flag) return ch;
    found = true;
    return `⟨U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}⟩`;
  });
  return { text: shown, found };
}

/** Every line of `before` and `after`, each marked same, removed or added (removals first). */
export function diffLines(before: string, after: string): ChangeLine[] {
  let b = before;
  let a = after;
  const stripped = b.endsWith('\n') && a.endsWith('\n');
  if (stripped) {
    b = b.slice(0, -1);
    a = a.slice(0, -1);
  }
  const old = toLines(b, stripped);
  const neu = toLines(a, stripped);

  let start = 0;
  while (start < old.length && start < neu.length && old[start] === neu[start]) start++;
  let endOld = old.length;
  let endNew = neu.length;
  while (endOld > start && endNew > start && old[endOld - 1] === neu[endNew - 1]) {
    endOld--;
    endNew--;
  }

  const out: ChangeLine[] = old.slice(0, start).map((text) => ({ kind: 'same', text }));
  const x = old.slice(start, endOld);
  const y = neu.slice(start, endNew);
  const n = x.length;
  const m = y.length;

  if (n * m > MAX_ALIGN_CELLS) {
    for (const text of x) out.push({ kind: 'removed', text });
    for (const text of y) out.push({ kind: 'added', text });
  } else {
    // lcs[i * (m + 1) + j]: longest common run of lines in x[i..] and y[j..]
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] =
          x[i] === y[j]
            ? (lcs[(i + 1) * w + j + 1] ?? 0) + 1
            : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) {
        out.push({ kind: 'same', text: x[i] ?? '' });
        i++;
        j++;
      } else if (j >= m || (i < n && (lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + j + 1] ?? 0))) {
        out.push({ kind: 'removed', text: x[i] ?? '' });
        i++;
      } else {
        out.push({ kind: 'added', text: y[j] ?? '' });
        j++;
      }
    }
  }

  for (const text of old.slice(endOld)) out.push({ kind: 'same', text });
  return out;
}

/** Folds long runs of unchanged lines into a counted gap, keeping `context` lines beside each change. */
export function withGaps(lines: readonly ChangeLine[], context = CONTEXT_LINES): ChangeLine[] {
  const out: ChangeLine[] = [];
  // One at a time: spreading a run of hundreds of thousands of lines into push() overflows the stack.
  const keep = (from: number, to: number) => {
    for (let k = from; k < to; k++) out.push(lines[k] as ChangeLine);
  };
  let i = 0;
  while (i < lines.length) {
    if (lines[i]?.kind !== 'same') {
      out.push(lines[i] as ChangeLine);
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end]?.kind === 'same') end++;
    const len = end - i;
    const atStart = i === 0;
    const atEnd = end === lines.length;
    if (atStart && atEnd) {
      keep(i, end);
    } else if (atStart) {
      if (len > context + 1) {
        out.push({ kind: 'gap', count: len - context });
        keep(end - context, end);
      } else keep(i, end);
    } else if (atEnd) {
      if (len > context + 1) {
        keep(i, i + context);
        out.push({ kind: 'gap', count: len - context });
      } else keep(i, end);
    } else if (len > 2 * context + 1) {
      keep(i, i + context);
      out.push({ kind: 'gap', count: len - 2 * context });
      keep(end - context, end);
    } else {
      keep(i, end);
    }
    i = end;
  }
  return out;
}

function editPart(edit: unknown): ChangePart | null {
  if (!isRec(edit) || typeof edit.old_string !== 'string' || typeof edit.new_string !== 'string') return null;
  return {
    everyMatch: edit.replace_all === true,
    lines: withGaps(diffLines(edit.old_string, edit.new_string)),
  };
}

function readChange(tool: string, input: Rec, fileExists: boolean): ProposedChange | null {
  if (tool === 'Edit') {
    const part = editPart(input);
    return part ? { kind: 'edit', parts: [part] } : null;
  }
  if (tool === 'MultiEdit') {
    if (!Array.isArray(input.edits) || input.edits.length === 0) return null;
    const parts: ChangePart[] = [];
    for (const e of input.edits) {
      const part = editPart(e);
      if (!part) return null;
      parts.push(part);
    }
    return { kind: 'edit', parts };
  }
  if (tool === 'Write') {
    if (typeof input.content !== 'string') return null;
    const stripped = input.content.endsWith('\n');
    const body = stripped ? input.content.slice(0, -1) : input.content;
    const lines: ChangeLine[] = toLines(body, stripped).map((text) => ({ kind: 'added', text }));
    return { kind: fileExists ? 'replace-file' : 'new-file', parts: [{ everyMatch: false, lines }] };
  }
  return null;
}

/** Lines and characters (each line with its line break) of all text lines in the change. */
function measure(change: ProposedChange): { lines: number; chars: number } {
  let lines = 0;
  let chars = 0;
  for (const p of change.parts) {
    for (const l of p.lines) {
      if (!('text' in l)) continue;
      lines++;
      chars += l.text.length + 1;
    }
  }
  return { lines, chars };
}

/**
 * Keeps lines until either limit is reached, cutting the line that crosses the character limit.
 * Every part is kept, so "Change 3 of 3" and its every-match note stay true; from the cut on, each
 * part shows a `cut` line instead of its text.
 */
function cutChange(change: ProposedChange): ProposedChange {
  let chars = MAX_CHANGE_CHARS;
  let lines = MAX_CHANGE_LINES;
  let stopped = false;
  const parts: ChangePart[] = change.parts.map((p) => {
    if (stopped) return { everyMatch: p.everyMatch, lines: [{ kind: 'cut' }] };
    const kept: ChangeLine[] = [];
    for (const l of p.lines) {
      if (!('text' in l)) {
        kept.push(l);
        continue;
      }
      const room = chars - 1;
      if (lines === 0 || room < 0) {
        stopped = true;
        break;
      }
      if (l.text.length > room) {
        if (room > 0) kept.push({ kind: l.kind, text: l.text.slice(0, room) });
        stopped = true;
        break;
      }
      kept.push(l);
      lines--;
      chars -= l.text.length + 1;
    }
    if (stopped) kept.push({ kind: 'cut' });
    return { everyMatch: p.everyMatch, lines: kept };
  });
  return { kind: change.kind, parts };
}

/** Makes hidden characters visible in every text line; says whether there were any. */
function reveal(change: ProposedChange): { change: ProposedChange; found: boolean } {
  let found = false;
  const parts = change.parts.map((p) => ({
    everyMatch: p.everyMatch,
    lines: p.lines.map((l): ChangeLine => {
      if (!('text' in l)) return l;
      const r = revealHidden(l.text);
      if (r.found) found = true;
      return { kind: l.kind, text: r.text };
    }),
  }));
  return { change: { kind: change.kind, parts }, found };
}

export interface ChangeSummary {
  /** Null for any tool other than Write, Edit and MultiEdit, or input that cannot be read. */
  change: ProposedChange | null;
  /** The whole change's size when it was too long and had to be cut, else null. */
  cut: { lines: number; chars: number } | null;
  /** True when hidden characters were found and shown as `⟨U+XXXX⟩` markers. */
  hiddenChars: boolean;
}

/** The change for a file tool's approval card, made visible and cut to size. */
export function proposedChange(tool: string, input: Rec, fileExists: boolean): ChangeSummary {
  const read = readChange(tool, input, fileExists);
  if (!read) return { change: null, cut: null, hiddenChars: false };
  const { change: revealed, found } = reveal(read);
  const full = measure(revealed);
  const tooLong = full.chars > MAX_CHANGE_CHARS || full.lines > MAX_CHANGE_LINES;
  return { change: tooLong ? cutChange(revealed) : revealed, cut: tooLong ? full : null, hiddenChars: found };
}
