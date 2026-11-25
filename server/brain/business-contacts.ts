/**
 * Reads who an email can go to out of a client's business.md and profile.md ("Write an email", 2026-11-25).
 * Pure: text in, contacts out. The rules are the comment on `BusinessContact` in
 * shared/project-business-contract.ts. Nothing here touches the disk, and nothing is ever written back.
 *
 * The files are free text, so the name beside an address is a best reading: when nothing reads as a name the
 * contact is listed by its address alone, which is always the part taken exactly as written.
 */
import {
  BUSINESS_CONTACTS_MAX,
  type BusinessContact,
  CONTACT_NAME_MAX,
} from '../../shared/project-business-contract.ts';
import { clean, HEADING, headingKey, LABEL_LINE, plain } from './business-parse.ts';

/**
 * One address. Letters, digits and `._%+-` before the @ (at most 64, not starting or ending with a dot), a
 * dotted host after. The look-behind stops a match starting part-way through a longer run of characters.
 */
const EMAIL =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9_%+-](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9_%+-])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}/g;
/** Template text, never a real person. */
const TEMPLATE_HOST = /(?:^|\.)example\.(?:com|org|net)$|\.(?:test|example|invalid)$/i;
/** More addresses than this in one file are not read (a cap on work, far above any real file). */
const MATCHES_MAX = 400;

const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const TABLE_ROW = /^\s*\|/;
const TABLE_RULE = /^\s*\|?[\s:|-]+\|?\s*$/;
const MAIN_LABEL = /^(?:main|primary)\s+contacts?$/i;
const SAYS_MAIN = /\b(?:main|primary)\s+contact\b/i;
/** A name: a capitalised word, then more words (a nickname may sit in quotes). Letters, marks, `'`, `.` and `-` only. */
const NAME = /^\p{Lu}[\p{L}\p{M}'’.-]*(?:\s+(?:[\p{L}\p{M}'’.-]+|["“][\p{L}\p{M}'’.-]+["”]))*$/u;
/** Words that lead a line but are never a person. */
const NOT_A_NAME = new Set([
  'email',
  'e-mail',
  'tel',
  'phone',
  'mobile',
  'contact',
  'contacts',
  'note',
  'notes',
]);
/** "Name (" or "Name <" straight before an address: up to four capitalised words. */
const NAME_BEFORE_OPENER = /(\p{Lu}[\p{L}\p{M}'’.-]*(?:\s+\p{Lu}[\p{L}\p{M}'’.-]*){0,3})\s*[(<[]\s*$/u;

const isContactLabel = (label: string): boolean =>
  !label.includes('*') && /(?:^|\s)contacts?$/i.test(plain(label).trim());

function isContactHeading(text: string): boolean {
  const key = headingKey(text);
  return /(?:^|\s)contacts?$/.test(key) || key === 'people' || key === 'key people';
}

/** The words as a person's name, or null when they don't read as one. */
function asName(words: string): string | null {
  const first = plain(words).split(/[—–,(:;·|[<]|\s-\s|\.(?:\s|$)/)[0] ?? '';
  const name = first.trim();
  if (name === '' || name.length > CONTACT_NAME_MAX) return null;
  if (name.split(/\s+/).length > 5 || NOT_A_NAME.has(name.toLowerCase())) return null;
  return NAME.test(name) ? name : null;
}

/** The name that leads a line, list item, table cell or label value: its bold start, or the words before the address. */
function leadName(raw: string): string | null {
  const t = raw.replace(LIST_ITEM, '').replace(/^\*\*[^*]+:\*\*\s*/, '');
  const bold = /^\*\*([^*]+)\*\*/.exec(t);
  if (bold) return asName(bold[1] ?? '');
  EMAIL.lastIndex = 0;
  const at = EMAIL.exec(t);
  EMAIL.lastIndex = 0;
  return asName(at ? t.slice(0, at.index) : t);
}

/** The name for a later address on a line that holds several: read from the words since the address before. */
function nearName(before: string): string | null {
  const bolds = [...before.matchAll(/\*\*([^*]+)\*\*/g)];
  const lastBold = bolds[bolds.length - 1];
  if (lastBold) return asName(lastBold[1] ?? '');
  const t = before.replace(/[`*_]/g, '');
  const opener = NAME_BEFORE_OPENER.exec(t);
  if (opener) return asName(opener[1] ?? '');
  const tail = t.split(/[;·|\n]/).pop() ?? '';
  const fromCapital = /(?:^|[^\p{L}])(\p{Lu}[\s\S]*)$/u.exec(tail);
  return fromCapital ? asName(fromCapital[1] ?? '') : null;
}

interface Block {
  raw: string;
  lead: string | null;
  main: boolean;
}

const block = (raw: string, lead: string | null, main = false): Block => ({
  raw,
  lead,
  main: main || SAYS_MAIN.test(plain(raw)),
});

const isBreak = (line: string): boolean => line.trim() === '' || HEADING.test(line);

/**
 * One list item (with the lines that continue it), one table row or one paragraph starting at `i`.
 * Returns the block (null for a blank line, a table rule, or someone struck through) and the next line to read.
 */
function readOne(lines: string[], i: number): [Block | null, number] {
  const line = lines[i] ?? '';
  if (line.trim() === '') return [null, i + 1];
  if (TABLE_ROW.test(line)) {
    if (TABLE_RULE.test(line)) return [null, i + 1];
    const first = (line.replace(/^\s*\|/, '').split('|')[0] ?? '').trim();
    if (first.startsWith('~~')) return [null, i + 1];
    return [block(line, leadName(first)), i + 1];
  }
  const item = LIST_ITEM.exec(line);
  const parts = [line];
  let j = i + 1;
  for (; j < lines.length; j++) {
    const next = lines[j] ?? '';
    if (isBreak(next) || TABLE_ROW.test(next)) break;
    const nextItem = LIST_ITEM.exec(next);
    if (item) {
      // A list item runs on through its indented lines (nested bullets too) and plain wrapped lines.
      if (nextItem && (nextItem[1] ?? '').length <= (item[1] ?? '').length) break;
      if (!nextItem && !/^\s/.test(next) && LABEL_LINE.test(next)) break;
    } else if (nextItem || LABEL_LINE.test(next)) break;
    parts.push(next);
  }
  if (item && /^~~/.test(line.replace(LIST_ITEM, ''))) return [null, j];
  const raw = parts.join('\n');
  return [block(raw, leadName(parts.join(' '))), j];
}

/** The lines and items that can hold a contact, in file order. */
function contactBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const out: Block[] = [];
  let sectionLevel = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const h = HEADING.exec(line);
    if (h) {
      const level = h[1]?.length ?? 6;
      if (sectionLevel > 0 && level <= sectionLevel) sectionLevel = 0;
      if (sectionLevel === 0 && level >= 2 && level <= 4 && isContactHeading(h[2] ?? ''))
        sectionLevel = level;
      i++;
      continue;
    }
    const lab = LABEL_LINE.exec(line);
    if (lab && isContactLabel(lab[1] ?? '')) {
      const main = MAIN_LABEL.test(plain(lab[1] ?? '').trim());
      if ((lab[2] ?? '').trim() !== '') {
        const parts = [lab[2] ?? ''];
        let j = i + 1;
        for (; j < lines.length; j++) {
          const next = lines[j] ?? '';
          if (isBreak(next) || LABEL_LINE.test(next) || LIST_ITEM.test(next) || TABLE_ROW.test(next)) break;
          parts.push(next);
        }
        out.push(block(parts.join('\n'), leadName(parts.join(' ')), main));
        i = j;
        continue;
      }
      // No value of its own: the list or table straight under it (blank lines between are fine).
      let j = i + 1;
      for (;;) {
        let k = j;
        while (k < lines.length && (lines[k] ?? '').trim() === '') k++;
        const next = lines[k] ?? '';
        if (k >= lines.length || !(LIST_ITEM.test(next) || TABLE_ROW.test(next))) break;
        const [b, after] = readOne(lines, k);
        if (b) out.push({ ...b, main: b.main || main });
        j = after;
      }
      i = Math.max(j, i + 1);
      continue;
    }
    if (sectionLevel > 0) {
      const [b, after] = readOne(lines, i);
      if (b) out.push(b);
      i = after;
      continue;
    }
    i++;
  }
  return out;
}

/** The client's contacts that have an email address: main contacts first, then file order, business.md before profile.md. */
export function parseContacts(businessText: string | null, profileText: string | null): BusinessContact[] {
  const found = new Map<string, BusinessContact>();
  for (const text of [clean(businessText), clean(profileText)]) {
    if (text === '') continue;
    let seen = 0;
    for (const b of contactBlocks(text)) {
      if (seen >= MATCHES_MAX) break;
      let prevEnd = 0;
      let n = 0;
      for (const m of b.raw.matchAll(EMAIL)) {
        if (++seen > MATCHES_MAX) break;
        const email = m[0];
        const start = m.index ?? 0;
        const name = n === 0 ? b.lead : nearName(b.raw.slice(prevEnd, start));
        n++;
        prevEnd = start + email.length;
        if (email.length > 254 || TEMPLATE_HOST.test(email.slice(email.indexOf('@') + 1))) continue;
        const key = email.toLowerCase();
        const had = found.get(key);
        if (had) {
          had.main = had.main || b.main;
          had.name = had.name ?? name;
        } else found.set(key, { name, email, main: b.main });
      }
    }
  }
  const all = [...found.values()];
  return [...all.filter((c) => c.main), ...all.filter((c) => !c.main)].slice(0, BUSINESS_CONTACTS_MAX);
}
