/** Reading checks for help pages: syllables, sentences, words and the Flesch-Kincaid grade. No dependencies. */

export function countSyllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  // Silent endings: "-es" after a consonant, "-ed" not after t or d, a final "-e" (but not "-le" after a consonant).
  w = w.replace(/(?:[^lcgsxzaeiouy]es|[^tdaeiouy]ed|[^laeiouy]e)$/, (m) => m.slice(0, 1));
  w = w.replace(/^y/, '');
  const groups = w.match(/[aeiouy]+/g) ?? [];
  let n = groups.length;
  // Vowel pairs that are really two sounds.
  n +=
    (w.match(/ia|io|uie|ea$|eat(?=ed$)/g) ?? []).length -
    (w.match(/tion|sion|cia|cio|tia|tio/g) ?? []).length;
  return Math.max(1, n);
}

/** Splits prose into sentences: on . ! ? and at every line break (list items). */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    for (const part of t.split(/(?<=[.!?])\s+/)) if (part.trim()) out.push(part.trim());
  }
  return out;
}

export function words(text: string): string[] {
  return text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? [];
}

/** The terms of help/glossary.md: its `### Term` lines, in order. */
export function glossaryTerms(markdown: string): string[] {
  return [...markdown.matchAll(/^###[ \t]+(.+?)[ \t]*$/gm)].map((m) => m[1] as string);
}

/** A word, or a term, as one comparable key: lower case, no possessive, hyphens for spaces. */
const termKey = (w: string) =>
  w
    .toLowerCase()
    .replace(/['’]s$/, '')
    .replace(/[\s-]+/g, '-');
/** The key a word may stand for once its plural is taken off. */
const singulars = (key: string) => {
  const out = [key];
  if (key.endsWith('s')) out.push(key.slice(0, -1));
  if (key.endsWith('es')) out.push(key.slice(0, -2));
  return out;
};

/** Syllables per word, where a word that is a glossary term (or a plural, or a hyphenated form) counts as one. */
function syllablesFor(ws: readonly string[], terms: readonly string[]): number[] {
  const single = new Set<string>();
  const multi: string[][] = [];
  for (const t of terms) {
    const parts = t
      .trim()
      .split(/[\s-]+/)
      .filter(Boolean);
    if (parts.length === 0) continue;
    single.add(termKey(t));
    if (parts.length > 1) multi.push(parts.map(termKey));
  }
  const keys = ws.map(termKey);
  const out = ws.map((w, i) =>
    singulars(keys[i] as string).some((k) => single.has(k)) ? 1 : countSyllables(w),
  );
  // A two-word term written as two words: each of them counts one.
  for (const parts of multi) {
    for (let i = 0; i + parts.length <= ws.length; i++) {
      if (parts.every((p, j) => singulars(keys[i + j] as string).includes(p))) {
        for (let j = 0; j < parts.length; j++) out[i + j] = 1;
      }
    }
  }
  return out;
}

/**
 * Flesch-Kincaid grade level. 0 when there is nothing to read. `terms` are glossary terms: a word that matches one
 * (any case, plural, or hyphenated) counts as one syllable, because the glossary explains it.
 */
export function fkGrade(text: string, terms: readonly string[] = []): number {
  const w = words(text);
  const s = sentences(text);
  if (w.length === 0 || s.length === 0) return 0;
  const syl =
    terms.length === 0
      ? w.reduce((n, x) => n + countSyllables(x), 0)
      : syllablesFor(w, terms).reduce((n, x) => n + x, 0);
  return 0.39 * (w.length / s.length) + 11.8 * (syl / w.length) - 15.59;
}

/** The text a reader reads: no frontmatter, headings, code, image lines, tables or link targets. One item per line. */
export function prose(markdown: string): string {
  let t = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  t = t.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
  const lines: string[] = [];
  for (const raw of t.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,6}\s/.test(line)) continue;
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(line)) continue;
    if (line.startsWith('|')) continue;
    if (/^(```|~~~)/.test(line)) continue;
    let l = line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`[^`]*`/g, '')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/^>\s?/, '')
      .replace(/^([-*+]|\d+[.)])\s+/, '');
    l = l.replace(/\s+/g, ' ').trim();
    if (l) lines.push(l);
  }
  return lines.join('\n');
}
