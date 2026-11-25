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
const TABLE_RULE = /^[\s:|-]+$/;
const MAIN_LABEL = /^(?:main|primary)\s+contacts?$/i;
const SAYS_MAIN = /\b(?:main|primary)\s+contact\b/i;
/** A label or heading longer than this is not a contact label (and is never cleaned up: see LOOK). */
const LABEL_MAX = 80;
/**
 * How much text beside an address is read for a name. Everything that cleans markdown (`plain`) or looks
 * backwards for a name works on a slice this long at most, so a hostile or pasted-in file costs time in
 * proportion to its size and never more (correctness review, 2026-11-25: whole-block reads took minutes).
 */
const LOOK = 300;
/** A name: capitalised words; a nickname may sit in quotes; a few lower-case particles ("de", "van") may join them. */
const NAME =
  /^\p{Lu}[\p{L}\p{M}'’.-]*(?:\s+(?:\p{Lu}[\p{L}\p{M}'’.-]*|["“]\p{Lu}[\p{L}\p{M}'’.-]*["”]|de|del|der|den|di|da|la|le|van|von|bin|al))*$/u;
/** Words that lead a line but are never part of a person's name. */
const LEADING_WORDS = new Set([
  'her',
  'his',
  'their',
  'the',
  'also',
  'and',
  'or',
  'with',
  'cc',
  'plus',
  'then',
  'via',
  'to',
  'from',
  'for',
]);
/** Words that mean a line label, a job or a team, never a person. */
const NOT_A_NAME = new Set([
  // A company is not a person.
  'ltd',
  'limited',
  'plc',
  'llp',
  'inc',
  'email',
  'e-mail',
  'tel',
  'phone',
  'mobile',
  'contact',
  'contacts',
  'note',
  'notes',
  'invoices',
  'billing',
  'enquiries',
  'director',
  'manager',
  'head',
  'lead',
  'owner',
  'founder',
  'officer',
  'executive',
  'assistant',
  'marketing',
  'sales',
  'accounts',
  'finance',
  'operations',
  'team',
  'ceo',
  'md',
  'cfo',
  'coo',
  'cto',
  'pa',
  'partner',
  'engineer',
  'coordinator',
  'administrator',
  'consultant',
  'office',
  'support',
  'department',
]);
/** "Name (" or "Name <" straight before an address: up to four capitalised words. */
const NAME_BEFORE_OPENER = /(\p{Lu}[\p{L}\p{M}'’.-]*(?:\s+\p{Lu}[\p{L}\p{M}'’.-]*){0,3})\s*[(<[]\s*$/u;
/** What ends one person's part of a line: `;`, `·`, a table bar, or the end of a sentence. */
const SEPARATOR = /[;·|]|\.\s/g;

const isContactLabel = (label: string): boolean =>
  label.length <= LABEL_MAX &&
  !label.includes('*') &&
  /(?:^|\s)contacts?$/i.test(plain(label).trim()) &&
  // "Do not contact:", "Never contact:" name people NOT to write to.
  !/\b(?:not|never|no|don't|don’t)\b/i.test(label);

function isContactHeading(text: string): boolean {
  if (text.length > LABEL_MAX) return false;
  const key = headingKey(text);
  return /(?:^|\s)contacts?$/.test(key) || key === 'people' || key === 'key people';
}

/**
 * The words as a person's name, or null when they don't read as one: the first clause, without leading
 * words like "her" or "PA", every word capitalised, and no job or team word left in it.
 */
function asName(text: string): string | null {
  // A name that is the text of a mailto link: `[Kim Example](mailto:` straight before the address.
  const words = text
    .slice(0, LOOK)
    .replace(/\]\((?:mailto:)?\s*$/i, '')
    .replace(/^\s*\[/, '');
  const first = plain(words).split(/[—–,(:;·|[<]|\s-\s|\.(?:\s|$)/)[0] ?? '';
  const parts = first.trim().split(/\s+/).filter(Boolean);
  while (parts.length > 0 && isFiller(parts[0] ?? '')) parts.shift();
  const name = parts.join(' ');
  if (name === '' || name.length > CONTACT_NAME_MAX || parts.length > 5) return null;
  if (parts.some((w) => NOT_A_NAME.has(bare(w)))) return null;
  return NAME.test(name) ? name : null;
}

const bare = (word: string): string => word.toLowerCase().replace(/[^\p{L}-]/gu, '');
const isFiller = (word: string): boolean => LEADING_WORDS.has(bare(word)) || NOT_A_NAME.has(bare(word));

/**
 * Does the address look like this person's? True when a word of the name is in the part before the @
 * ("brown" in `t.brown`), that part starts a word of the name (`rob` for Robert), or it is their initials.
 */
function related(name: string, email: string): boolean {
  const local = email.slice(0, email.indexOf('@')).toLowerCase();
  const tokens = local.split(/[^a-z0-9]+/).filter(Boolean);
  const words = name
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 2);
  const hit = words.some(
    (w) =>
      (w.length >= 3 && local.includes(w)) ||
      tokens.includes(w) ||
      tokens.some((t) => t.length >= 3 && w.startsWith(t)),
  );
  if (hit) return true;
  const initials = words.map((w) => w[0]).join('');
  return initials.length >= 2 && tokens.join('') === initials;
}

/** The name that leads a line, list item, table cell or label value: its bold start, or the words before the address. */
function leadName(raw: string): string | null {
  const t = raw
    .slice(0, LOOK * 2)
    .replace(LIST_ITEM, '')
    .replace(/^\*\*[^*]+:\*\*\s*/, '');
  const bold = /^\*\*([^*]+)\*\*/.exec(t);
  if (bold) return asName(bold[1] ?? '');
  EMAIL.lastIndex = 0;
  const at = EMAIL.exec(t);
  EMAIL.lastIndex = 0;
  return asName(at ? t.slice(0, at.index) : t);
}

/** Markdown marks that can sit inside or round a name. */
const MARKS = /[`*_~]/g;
/** What may sit between a name and its address: spaces, an opening bracket, a dash, a colon or a comma. */
const CONNECTORS = /[\s(<[`—–:,-]+$/;

/** The name written straight before an address: a bold name that ends there, else "Name (" or "Name <". */
function nameTouching(part: string): string | null {
  const bold = /\*\*([^*]+)\*\*$/.exec(part.replace(CONNECTORS, ''));
  const fromBold = bold ? asName(bold[1] ?? '') : null;
  if (fromBold) return fromBold;
  const opener = NAME_BEFORE_OPENER.exec(part.replace(MARKS, ''));
  return opener ? asName(opener[1] ?? '') : null;
}

/**
 * The name that starts a part of a line (after a separator or an earlier address): its first capitalised
 * words. A lone word must also look like the address: any sentence starts with a capital ("Prefers kim@…",
 * "Reception: hello@…" name nobody; "Tom (tom@…)" is Tom).
 */
function nameStarting(part: string, email: string): string | null {
  const fromCapital = /(?:^|[^\p{L}])(\p{Lu}[\s\S]*)$/u.exec(part.replace(MARKS, ''));
  const name = fromCapital ? asName(fromCapital[1] ?? '') : null;
  if (!name) return null;
  return name.includes(' ') || related(name, email) ? name : null;
}

/**
 * True when nothing but a role, a phone number or punctuation sits between `name` and the end of `part`
 * ("Sarah Jones (MD) — ", "Sarah Jones, Director (", a mailto link's `](mailto:`): the name is then the only
 * person the address can belong to. Any other word ("Senior Designer", "PA is Jan Lee", "the office is")
 * could be another name or say whose address it is, so it is not.
 */
function onlyNameBefore(part: string, name: string): boolean {
  const text = part.replace(MARKS, '');
  const at = text.indexOf(name);
  if (at < 0) return false;
  const between = text.slice(at + name.length).replace(/\]\((?:mailto:)?/i, ' ');
  return between.split(/[^\p{L}]+/u).every((w) => w === '' || NOT_A_NAME.has(w.toLowerCase()));
}

/**
 * Which name goes with the address at the end of `part`, where `first` is the name that starts the part.
 * Better no name than the wrong one:
 * - `first`, when it is the only person named before the address;
 * - else there may be two (`first`, and a name touching the address): the one the address looks like, the
 *   touching one when both do;
 * - else a touching name of two words or more when the part starts with nobody; otherwise nobody.
 */
function pick(part: string, first: string | null, email: string): string | null {
  if (first && onlyNameBefore(part, first)) return first;
  const touching = nameTouching(part);
  if (touching && related(touching, email)) return touching;
  if (first && related(first, email)) return first;
  // No name starts the part: a touching name of two words or more (a lone word was a team or a title once
  // its role words were dropped: "Accounts Payable (ap@…)").
  return !first && touching?.includes(' ') ? touching : null;
}

/**
 * The name for the address that starts at `start`, given where the address before it ended. The first
 * address on a line with nothing separating it from the start is read against the name that leads the line.
 * After a separator, and for every later address, it is read against the name that starts its own part of
 * the line ("…; her PA Kate Lee (kate@…)"). When that part names nobody, the first address may still take
 * the leading name, but only when it looks like that person's (a table's first cell, a list item's bold
 * name; "Invoices to accounts@…" in Sarah's row is not Sarah).
 */
function nameFor(b: Block, n: number, prevEnd: number, start: number, email: string): string | null {
  const seg = b.raw.slice(Math.max(prevEnd, start - LOOK), start);
  let cut = -1;
  for (const m of seg.matchAll(SEPARATOR)) cut = (m.index ?? 0) + m[0].length;
  const separated = cut >= 0 || start - prevEnd > LOOK;
  if (n === 0 && !separated) return pick(seg, b.lead, email);
  const part = cut >= 0 ? seg.slice(cut) : seg;
  const name = pick(part, nameStarting(part, email), email);
  if (name) return name;
  return n === 0 && b.lead && related(b.lead, email) ? b.lead : null;
}

interface Block {
  raw: string;
  lead: string | null;
  main: boolean;
}

const block = (raw: string, lead: string | null, main = false): Block => ({
  raw,
  lead,
  main: main || SAYS_MAIN.test(raw.replace(MARKS, '')),
});

/** A name struck through at the start of an item or cell, however the marks are nested (`**~~Name~~**`). */
const STRUCK_START = /^(?:\*\*|__)?~~/;

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
    if (STRUCK_START.test(first)) return [null, i + 1];
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
  if (item && STRUCK_START.test(line.replace(LIST_ITEM, ''))) return [null, j];
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
      // Struck-through runs: an address inside one, or whose name is exactly the struck one, belongs to someone
      // who has left. (A note about somebody else, `~~Tom Brown~~`, never removes Tom.)
      const struck = [...b.raw.matchAll(/~~[^~]*~~/g)].map((m) => ({
        from: m.index ?? 0,
        to: (m.index ?? 0) + m[0].length,
        name: asName(m[0].slice(0, LOOK)),
      }));
      let prevEnd = 0;
      let n = 0;
      for (const m of b.raw.matchAll(EMAIL)) {
        if (++seen > MATCHES_MAX) break;
        const email = m[0];
        const start = m.index ?? 0;
        // A struck address is as if it were not written: the next one on the line still counts as the first.
        if (struck.some((r) => start >= r.from && start < r.to)) continue;
        const name = nameFor(b, n, prevEnd, start, email);
        n++;
        prevEnd = start + email.length;
        if (name && struck.some((r) => r.name === name)) continue;
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
