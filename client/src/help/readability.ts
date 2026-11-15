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

/** Flesch-Kincaid grade level. 0 when there is nothing to read. */
export function fkGrade(text: string): number {
  const w = words(text);
  const s = sentences(text);
  if (w.length === 0 || s.length === 0) return 0;
  const syl = w.reduce((n, x) => n + countSyllables(x), 0);
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
