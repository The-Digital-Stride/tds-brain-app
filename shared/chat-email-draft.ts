/**
 * Emails Claude drafts in a project chat: reading the block and building Gmail's compose link.
 * Rules and limits: `shared/chat-email-draft-contract.ts`. Pure; used by the client.
 */
import {
  CHAT_EMAIL_RECIPIENTS_MAX,
  CHAT_EMAIL_RECIPIENTS_URL_BUDGET,
  CHAT_EMAIL_SUBJECT_MAX,
  type ChatEmail,
  type ChatEmailLink,
  GMAIL_COMPOSE_URL_MAX,
} from './chat-email-draft-contract.ts';

/** The strict address shape `BusinessContact.email` uses, as the whole string. */
const ADDRESS =
  /^[A-Za-z0-9_%+-](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9_%+-])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;
const ADDRESS_MAX = 254;
/** `Name <address>`: an optional name with no angle brackets, then the address in them, and nothing after. */
const ANGLED = /^[^<>]*<([^<>\s]*)>$/;
// `From:` with an address is read so that it does not end the headers, and then ignored: Gmail sends from
// its own account. Without an address it is a sentence, and stays in the message.
const HEADER = /^(to|cc|bcc|subject|from)[ \t]*:(.*)$/i;
// Characters nobody can see: control characters, zero-width characters and the marks that change text
// direction. A subject and a message must read on the card exactly as they will in Gmail. Built from
// strings so the source holds no invisible character itself.
const ZERO_WIDTH_AND_DIRECTION = '\\u00AD\\u061C\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF';
const UNSEEN = new RegExp(`[\\u0000-\\u001F\\u007F-\\u009F${ZERO_WIDTH_AND_DIRECTION}]`, 'g');
/** The same, sparing the line break and the tab a message is made of. */
const UNSEEN_IN_TEXT = new RegExp(
  `[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F${ZERO_WIDTH_AND_DIRECTION}]`,
  'g',
);
/** Half of a two-part character: `encodeURIComponent` throws on one. */
const LONE_HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The address in one header entry, null when it is not one; '' entries are no entry at all. */
function addressOf(entry: string): string | null {
  const angled = ANGLED.exec(entry);
  // A name with a quote left open is not a name: nothing is guessed about where it was meant to end.
  if (angled && (entry.split('"').length - 1) % 2 === 1) return null;
  const address = angled ? (angled[1] ?? '') : entry;
  // A `%` is legal but never needed, and `jo%40acme.co.uk@evil.example` reads as someone else's address.
  return address.length <= ADDRESS_MAX && !address.includes('%') && ADDRESS.test(address) ? address : null;
}

/** A header's entries: split on commas and semicolons, but not inside a quoted name (`"Example, Jo" <…>`,
 *  straight or curly quotes). */
function entriesOf(value: string): string[] {
  const out: string[] = [];
  let from = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '"' || c === '\u201C' || c === '\u201D') quoted = !quoted;
    else if ((c === ',' || c === ';') && !quoted) {
      out.push(value.slice(from, i));
      from = i + 1;
    }
  }
  out.push(value.slice(from));
  return out;
}

const cleanSubject = (raw: string): string =>
  raw.replace(/\s+/g, ' ').replace(UNSEEN, '').trim().slice(0, CHAT_EMAIL_SUBJECT_MAX).trim();

export function parseChatEmail(block: string): ChatEmail {
  const lines = block.replace(/\r\n?/g, '\n').replace(UNSEEN_IN_TEXT, '').split('\n');
  const out: ChatEmail = { to: [], cc: [], bcc: [], subject: '', body: '', dropped: 0, over: 0 };
  const seen = new Set<string>();
  let budget = CHAT_EMAIL_RECIPIENTS_URL_BUDGET;
  let hasSubject = false;
  let at = 0;
  // Blank lines before anything else are no part of the email.
  while (at < lines.length && (lines[at] ?? '').trim() === '') at++;
  for (; at < lines.length; at++) {
    const header = HEADER.exec(lines[at] ?? '');
    if (!header) break;
    const name = (header[1] ?? '').toLowerCase();
    const value = header[2] ?? '';
    if (name === 'from') {
      if (!value.includes('@')) break;
      continue;
    }
    if (name === 'subject') {
      if (!hasSubject) out.subject = cleanSubject(value);
      hasSubject = true;
      continue;
    }
    const list = name === 'to' ? out.to : name === 'cc' ? out.cc : out.bcc;
    for (const part of entriesOf(value)) {
      const entry = part.trim();
      if (entry === '') continue;
      const address = addressOf(entry);
      if (address === null) {
        out.dropped++;
        continue;
      }
      const key = address.toLowerCase();
      if (seen.has(key)) continue;
      // One more than its own encoded length: the comma that joins it to the next.
      const cost = encodeURIComponent(`${address},`).length;
      if (seen.size >= CHAT_EMAIL_RECIPIENTS_MAX || cost > budget) {
        out.over++;
        continue;
      }
      budget -= cost;
      seen.add(key);
      list.push(address);
    }
  }
  let end = lines.length;
  while (at < end && (lines[at] ?? '').trim() === '') at++;
  while (end > at && (lines[end - 1] ?? '').trim() === '') end--;
  out.body = lines.slice(at, end).join('\n');
  return out;
}

/** The address lists in the order a card shows them, each with its label. */
export const chatEmailPeople = (
  email: ChatEmail,
): { label: 'To' | 'Cc' | 'Bcc'; list: readonly string[] }[] => [
  { label: 'To', list: email.to },
  { label: 'Cc', list: email.cc },
  { label: 'Bcc', list: email.bcc },
];

const enc = (value: string): string => encodeURIComponent(value.replace(LONE_HALF, '�'));

export function chatEmailLink(ownerEmail: string | null, email: ChatEmail): ChatEmailLink {
  const people = (key: string, list: readonly string[]): string =>
    list.length > 0 ? `&${key}=${enc(list.join(','))}` : '';
  const head = `https://mail.google.com/mail/?${ownerEmail ? `authuser=${enc(ownerEmail)}&` : ''}view=cm&fs=1${people('to', email.to)}${people('cc', email.cc)}${people('bcc', email.bcc)}`;
  const subject = email.subject ? `&su=${enc(email.subject)}` : '';
  const body = email.body ? `&body=${enc(email.body)}` : '';
  if (head.length + subject.length + body.length <= GMAIL_COMPOSE_URL_MAX) {
    return { url: head + subject + body, fits: true };
  }
  // Too long for Gmail's link: the person copies the text in. The recipients always fit: `parseChatEmail`
  // keeps them inside CHAT_EMAIL_RECIPIENTS_URL_BUDGET.
  return { url: head.length + subject.length <= GMAIL_COMPOSE_URL_MAX ? head + subject : head, fits: false };
}
