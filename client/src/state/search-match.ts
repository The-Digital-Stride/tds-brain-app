import type { MatchRank } from '../shell/contract.ts';

/** Lower case with accents removed, so "Café" matches "cafe". */
export function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const wordsOf = (text: string): string[] => plain(text).split(/\s+/).filter(Boolean);
const titleWords = (title: string): string[] =>
  plain(title)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * How well `query` matches (contract: `MatchRank`). Every query word must be found somewhere in the
 * title or the other fields; the rank says how good the match is:
 * 0 the title starts with the query, 1 each query word starts a title word, 2 the title contains
 * every word, 3 some word is only in the other fields.
 */
export const matchRank: MatchRank = (query, title, fields) => {
  const words = wordsOf(query);
  if (words.length === 0) return null;
  const t = plain(title);
  if (t.startsWith(words.join(' '))) return 0;
  const inTitle = words.every((w) => t.includes(w));
  if (inTitle) {
    const starts = titleWords(title);
    return words.every((w) => starts.some((s) => s.startsWith(w))) ? 1 : 2;
  }
  const hay = plain([title, ...fields].join('\n'));
  return words.every((w) => hay.includes(w)) ? 3 : null;
};
