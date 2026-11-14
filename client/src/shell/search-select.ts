/**
 * Pure logic for `SearchSelect` (plan 2026-11-14-client-picker): matching, ranking, the groups the
 * list shows and the per-viewer "Recent" list. No React, no DOM, so it is tested on its own.
 */

/** One choice in a SearchSelect. */
export interface PickOption {
  /** What `onChange` gets: a client slug, "auto", "none", a library scope id… Unique in the list. */
  value: string;
  /** What the person sees, and what the box shows once it is chosen. */
  label: string;
  /** Other words that find it but are never shown: client codes and other names ("UC", "Air Con"). */
  terms?: readonly string[];
  /**
   * Heading it sits under ("Clients", "Mine"). Options with no group are the fixed choices
   * ("Auto", "No client", "All clients"): always first, in the order given, under no heading.
   */
  group?: string;
}

/** A run of the label to draw bold: [start, end) in UTF-16 code units of `label`. */
export type MatchRange = readonly [start: number, end: number];

/** One row the list draws. `key` is unique across the whole list (an option can show twice: Recent and A–Z). */
export interface ShownOption {
  key: string;
  option: PickOption;
  /** Bold runs in the label for the current query; empty when the query is empty or only a term matched. */
  ranges: readonly MatchRange[];
}

/** A block of rows under one heading. `title` null: the fixed choices, drawn with no heading. */
export interface ShownGroup {
  id: string;
  title: string | null;
  rows: ShownOption[];
}

/** "Recent" shows only when the list has at least this many options, and the query is empty. */
export const RECENT_MIN_OPTIONS = 10;
/** At most this many recent picks are kept and shown. */
export const RECENT_MAX = 5;
/** With a query, at most this many matches are drawn (best first). */
export const MAX_MATCHES = 50;
/** A stored recent value longer than this is not a real slug or scope id. */
const MAX_RECENT_CHARS = 200;

const WORD_CHARS = /^[\p{L}\p{N}]+$/u;
const MARKS = /\p{M}/gu;

/** The normalised text, and for each of its characters the [start, end) of the original it came from. */
interface Folded {
  text: string;
  from: (readonly [number, number])[];
}

function fold(text: string): Folded {
  let out = '';
  const from: (readonly [number, number])[] = [];
  let i = 0;
  for (const ch of text) {
    const span = [i, i + ch.length] as const;
    i += ch.length;
    const piece = ch.normalize('NFD').replace(MARKS, '').toLowerCase();
    if (piece !== '' && WORD_CHARS.test(piece)) {
      for (const c of piece) {
        out += c;
        from.push(span);
      }
    } else if (piece === '' && ch !== '') {
      // A lone combining mark: part of the letter before it, adds nothing.
    } else if (out !== '' && !out.endsWith(' ')) {
      out += ' ';
      from.push(span);
    }
  }
  if (out.endsWith(' ')) {
    out = out.slice(0, -1);
    from.pop();
  }
  return { text: out, from };
}

/**
 * Lower case, accents dropped, anything that is not a letter or digit turned into one space, trimmed.
 * "Café-Bar  Ltd" → "cafe bar ltd". Used on the query, labels and terms alike.
 */
export function normalise(text: string): string {
  return fold(text).text;
}

/** Where `needle` first starts a word in `hay`, else where it first occurs, else -1. */
function findPreferWordStart(hay: string, needle: string): number {
  let first = -1;
  let at = hay.indexOf(needle);
  while (at !== -1) {
    if (at === 0 || hay[at - 1] === ' ') return at;
    if (first === -1) first = at;
    at = hay.indexOf(needle, at + 1);
  }
  return first;
}

const startsAWord = (hay: string, needle: string) => hay.startsWith(needle) || hay.includes(` ${needle}`);

/**
 * How well `option` matches `query` (already normalised, non-empty). null when it does not match.
 * Lower is better:
 *   0  label starts with the query
 *   1  a term is exactly the query (a client code: "uc")
 *   2  a word in the label starts with the query
 *   3  a term starts with the query, or a word in a term does
 *   4  the label contains the query
 *   5  a term contains the query
 * When the whole query is not found as one run, a multi-word query matches if every word starts a
 * word: in the label (2), or in the label or a term (3). So "urb cool" finds "Urban Cooling".
 */
export function matchRank(option: PickOption, query: string): number | null {
  const q = normalise(query);
  if (q === '') return null;
  const label = normalise(option.label);
  const terms = (option.terms ?? []).map(normalise).filter((t) => t !== '');
  if (label.startsWith(q)) return 0;
  if (terms.includes(q)) return 1;
  if (startsAWord(label, q)) return 2;
  if (terms.some((t) => startsAWord(t, q))) return 3;
  if (label.includes(q)) return 4;
  if (terms.some((t) => t.includes(q))) return 5;
  const words = q.split(' ');
  if (words.length > 1) {
    if (words.every((w) => startsAWord(label, w))) return 2;
    if (words.every((w) => startsAWord(label, w) || terms.some((t) => startsAWord(t, w)))) return 3;
  }
  return null;
}

/** Bold runs for `query` (raw, as typed) in `label`: the whole query as one run, else each word's first match, merged, in order. */
export function matchRanges(label: string, query: string): MatchRange[] {
  const q = normalise(query);
  if (q === '') return [];
  const f = fold(label);
  const toOriginal = (start: number, len: number): MatchRange => {
    const a = f.from[start];
    const b = f.from[start + len - 1];
    return [a ? a[0] : 0, b ? b[1] : 0];
  };
  const whole = findPreferWordStart(f.text, q);
  if (whole !== -1) return [toOriginal(whole, q.length)];
  const runs: [number, number][] = [];
  for (const w of q.split(' ')) {
    const at = findPreferWordStart(f.text, w);
    if (at !== -1) runs.push([...toOriginal(at, w.length)]);
  }
  runs.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r);
  }
  return merged;
}

function ranked(options: readonly PickOption[], query: string): PickOption[] {
  return options
    .map((option, i) => ({ option, i, rank: matchRank(option, query) }))
    .filter((x): x is { option: PickOption; i: number; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.option);
}

/**
 * The groups to draw.
 * - Empty query: the fixed choices; then "Recent" (the `recent` values still in `options` and in a
 *   group, in `recent` order, at most RECENT_MAX) when `options.length >= RECENT_MIN_OPTIONS` and at least one
 *   is left; then each group in first-seen order with its options in the order given.
 *   Options with no group after a grouped one still count as fixed.
 * - A query: one untitled group "matches" with every matching option (fixed ones too), best rank
 *   first, then the order given, at most MAX_MATCHES. No Recent. Empty array when nothing matches.
 * Keys: `${group id}:${value}`. Group ids: "fixed", "recent", "matches", or "g:" + title.
 */
export function shownGroups(
  options: readonly PickOption[],
  query: string,
  recent: readonly string[],
): ShownGroup[] {
  if (normalise(query) !== '') {
    const rows = ranked(options, query)
      .slice(0, MAX_MATCHES)
      .map((option) => ({
        key: `matches:${option.value}`,
        option,
        ranges: matchRanges(option.label, query),
      }));
    return rows.length > 0 ? [{ id: 'matches', title: null, rows }] : [];
  }
  const row = (id: string, option: PickOption): ShownOption => ({
    key: `${id}:${option.value}`,
    option,
    ranges: [],
  });
  const groups: ShownGroup[] = [];
  const fixed = options.filter((o) => o.group === undefined);
  if (fixed.length > 0) groups.push({ id: 'fixed', title: null, rows: fixed.map((o) => row('fixed', o)) });
  if (options.length >= RECENT_MIN_OPTIONS) {
    const byValue = new Map(options.map((o) => [o.value, o]));
    const rows: ShownOption[] = [];
    for (const v of recent) {
      const o = byValue.get(v);
      // Only grouped options (clients, libraries): a fixed choice is already at the top.
      if (o && o.group !== undefined && !rows.some((r) => r.option.value === v)) rows.push(row('recent', o));
      if (rows.length >= RECENT_MAX) break;
    }
    if (rows.length > 0) groups.push({ id: 'recent', title: 'Recent', rows });
  }
  const titled = new Map<string, ShownGroup>();
  for (const o of options) {
    if (o.group === undefined) continue;
    let g = titled.get(o.group);
    if (!g) {
      g = { id: `g:${o.group}`, title: o.group, rows: [] };
      titled.set(o.group, g);
      groups.push(g);
    }
    g.rows.push(row(g.id, o));
  }
  return groups;
}

/** How many options the query matches in all (before the MAX_MATCHES cap); all of them for an empty query. */
export function matchCount(options: readonly PickOption[], query: string): number {
  if (normalise(query) === '') return options.length;
  return options.filter((o) => matchRank(o, query) !== null).length;
}

/** Clients as options: label = name, terms = [slug, ...aliases], group = "Clients". Order kept. */
export function clientOptions(
  clients: readonly { slug: string; name: string; aliases?: readonly string[] }[],
  group = 'Clients',
): PickOption[] {
  return clients.map((c) => ({ value: c.slug, label: c.name, terms: [c.slug, ...(c.aliases ?? [])], group }));
}

const storageKey = (listKey: string) => `tds-brain-recent.${listKey}`;

/**
 * The viewer's recent picks for a list, newest first, from localStorage key
 * `tds-brain-recent.${listKey}`. Never throws: unreadable, missing or malformed storage gives [].
 * Values are strings of at most 200 characters; at most RECENT_MAX are returned.
 */
export function readRecent(listKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(listKey));
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((v): v is string => typeof v === 'string' && v !== '' && v.length <= MAX_RECENT_CHARS)
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/**
 * Puts `value` first in the list's recent picks (dropping an older copy) and keeps RECENT_MAX.
 * Never throws (a full or blocked storage just isn't saved). Returns the new list.
 */
export function rememberRecent(listKey: string, value: string): string[] {
  const next = [value, ...readRecent(listKey).filter((v) => v !== value)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(storageKey(listKey), JSON.stringify(next));
  } catch {
    // Private window or full storage: Recent is a convenience, so it just isn't kept.
  }
  return next;
}
