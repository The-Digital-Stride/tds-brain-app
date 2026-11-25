/**
 * Reads the useful parts of a client's business.md (and profile.md) for a project's Overview.
 * Pure: text in, facts and sections out. The rules are the comments in shared/project-business-contract.ts.
 * Nothing here touches the disk.
 */
import {
  type BusinessSection,
  FACT_MAX_CHARS,
  KEY_FACTS,
  type KeyFact,
  PLACEHOLDER_STARTS,
  SECTION_MAX_CHARS,
  SECTION_RULES,
} from '../../shared/project-business-contract.ts';

export const LABEL_LINE = /^\s*(?:[-*]\s+)?\*\*(.+?):\*\*\s*(.*)$/;
const HEADING_START = /^(#{1,6})\s+/;
const SPACE = /\s/;
/**
 * A markdown heading: `[line, hashes, text]`, the text without a closing run of #s or the spaces round it.
 * Used like the pattern it replaced (`/^(#{1,6})\s+(.*?)\s*#*\s*$/`), which took time growing with the cube
 * of a long run of spaces after a heading (800 spaces: 2.8 s on the server's one thread). The end is now
 * trimmed by hand, in one pass.
 */
export const HEADING = {
  exec(line: string): [string, string, string] | null {
    const m = HEADING_START.exec(line);
    if (!m) return null;
    const from = m[0].length;
    let end = line.length;
    while (end > from && SPACE.test(line[end - 1] ?? '')) end--;
    while (end > from && line[end - 1] === '#') end--;
    while (end > from && SPACE.test(line[end - 1] ?? '')) end--;
    return [line, m[1] ?? '', line.slice(from, end)];
  },
  test: (line: string): boolean => HEADING_START.test(line),
};
const LIST_OR_TABLE = /^\s*(?:[-*+]\s|\d+[.)]\s|\||>)/;

/** Text with CRLF folded, frontmatter and HTML comments removed. */
export function clean(text: string | null): string {
  if (!text) return '';
  let t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  t = t.replace(/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '');
  return withoutComments(t);
}

/**
 * HTML comments removed: each `<!-- … -->`, then anything from a `<!--` still left to the end (an unclosed
 * one, or one the removals joined up, exactly as the two patterns this replaced did). One pass with
 * `indexOf`; the patterns looked from every unclosed `<!--` to the end of the file.
 */
function withoutComments(t: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = t.indexOf('<!--', at);
    const close = open < 0 ? -1 : t.indexOf('-->', open + 4);
    if (close < 0) {
      out += t.slice(at);
      break;
    }
    out += t.slice(at, open);
    at = close + 3;
  }
  const left = out.indexOf('<!--');
  return left < 0 ? out : out.slice(0, left);
}

/**
 * Plain text: markdown marks, links and tags removed, spaces folded. A link's text, its address and a tag are
 * each looked for over a bounded length, so a run of `[` or `<` costs in proportion to its size (unbounded,
 * 64,000 of them took over 15 s).
 */
export function plain(s: string): string {
  return s
    .replace(/!?\[([^\]]{0,300})\]\([^)]{0,1000}\)/g, '$1')
    .replace(/<[^>]{0,500}>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|~~)/g, '')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=$|[\s).,;:!?])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPlaceholder(value: string): boolean {
  if (value === '') return true;
  if (value.includes('{') && value.includes('}')) return true;
  const lower = plain(value).toLowerCase();
  return lower === '' || PLACEHOLDER_STARTS.some((p) => lower.startsWith(p));
}

function cutWord(s: string): string {
  if (s.length <= FACT_MAX_CHARS) return s;
  const head = s.slice(0, FACT_MAX_CHARS);
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[\s,;:.-]+$/, '')}…`;
}

/** The first line of `text` that is `**label:** …`, with its wrapped value, or null when missing or a placeholder. */
function findFact(text: string, labels: readonly string[]): string | null {
  const want = new Set(labels.map((l) => l.toLowerCase()));
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = LABEL_LINE.exec(lines[i] ?? '');
    if (!m || !want.has((m[1] ?? '').trim().toLowerCase())) continue;
    const parts = [m[2] ?? ''];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] ?? '';
      if (next.trim() === '' || LABEL_LINE.test(next) || HEADING.test(next) || LIST_OR_TABLE.test(next))
        break;
      parts.push(next);
    }
    const raw = parts.join(' ').trim();
    if (isPlaceholder(raw)) return null;
    const value = plain(raw);
    return isPlaceholder(value) ? null : cutWord(value);
  }
  return null;
}

/** A heading's text for matching: marks removed, trailing "(…)" dropped, lower case. */
export function headingKey(text: string): string {
  return plain(text)
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
    .toLowerCase();
}

/** The body of the first `##` or `###` heading called `heading`, as markdown, or null. */
function sectionBody(text: string, heading: string): string | null {
  const lines = text.split('\n');
  const want = heading.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const h = HEADING.exec(lines[i] ?? '');
    if (!h || (h[1]?.length !== 2 && h[1]?.length !== 3) || headingKey(h[2] ?? '') !== want) continue;
    const level = h[1]?.length ?? 2;
    const out: string[] = [];
    let skipping = false;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? '';
      const n = HEADING.exec(line);
      if (n) {
        const nl = n[1]?.length ?? 6;
        if (nl <= level) break;
        // A `###` under a `##` that starts with "Contract" is left out, up to the next heading of its level or above:
        // deeper headings inside it (`####`) stay left out with it.
        if (skipping && nl > 3) continue;
        skipping = level === 2 && nl === 3 && /^contract/i.test(plain(n[2] ?? ''));
        if (skipping) continue;
        out.push(`**${plain(n[2] ?? '')}**`);
        continue;
      }
      if (!skipping) out.push(line);
    }
    return out.join('\n').trim();
  }
  return null;
}

/** True when nothing in the body says anything: every real line is empty or a placeholder. */
function allPlaceholder(body: string): boolean {
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (t === '' || /^\*\*[^*]+\*\*$/.test(t) || /^\|?[\s:|-]+\|?$/.test(t)) continue;
    const m = LABEL_LINE.exec(t);
    const value = (m ? (m[2] ?? '') : t.replace(/^(?:[-*+]|\d+[.)])\s+/, '')).trim();
    if (!isPlaceholder(value)) return false;
  }
  return true;
}

function cutSection(body: string): { markdown: string; cut: boolean } {
  if (body.length <= SECTION_MAX_CHARS) return { markdown: body, cut: false };
  const lines = body.split('\n');
  let used = '';
  for (const line of lines) {
    const next = used === '' ? line : `${used}\n${line}`;
    if (next.length > SECTION_MAX_CHARS) break;
    used = next;
  }
  if (used === '') used = body.slice(0, SECTION_MAX_CHARS);
  return { markdown: used.trimEnd(), cut: true };
}

const applies = (when: 'always' | readonly string[], services: string[]): boolean =>
  when === 'always' || services.some((s) => when.includes(s.toLowerCase()));

/** The key facts and sections for a client project. Anything not found is left out. */
export function parseBusiness(
  businessText: string | null,
  profileText: string | null,
  services: string[],
): { facts: KeyFact[]; sections: BusinessSection[] } {
  const business = clean(businessText);
  const profile = clean(profileText);
  const facts: KeyFact[] = [];
  for (const f of KEY_FACTS) {
    if (!applies(f.when, services)) continue;
    const fromBusiness = findFact(business, f.labels);
    if (fromBusiness !== null) {
      facts.push({ id: f.id, words: f.words, value: fromBusiness, from: 'business' });
      continue;
    }
    const fromProfile = f.profileLabel ? findFact(profile, [f.profileLabel]) : null;
    if (fromProfile !== null) facts.push({ id: f.id, words: f.words, value: fromProfile, from: 'profile' });
  }
  const sections: BusinessSection[] = [];
  for (const r of SECTION_RULES) {
    if (!applies(r.when, services)) continue;
    const body = sectionBody(r.file === 'profile' ? profile : business, r.heading);
    if (body === null || body === '' || allPlaceholder(body)) continue;
    const { markdown, cut } = cutSection(body);
    sections.push({
      title: r.title,
      heading: r.heading,
      markdown,
      cut,
      open: r.open === true,
      from: r.file,
    });
  }
  return { facts, sections };
}

/** profile.md's frontmatter `status:` (active, prospect, ended…), or null. */
export function profileStatus(profileText: string | null): string | null {
  if (!profileText) return null;
  const t = profileText.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(t);
  if (!fm) return null;
  const m = /^status:[ \t]*(.*)$/m.exec(fm[1] ?? '');
  const v = (m?.[1] ?? '')
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .trim();
  return v === '' ? null : v;
}
