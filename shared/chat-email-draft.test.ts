import { describe, expect, it } from 'vitest';
import { chatEmailLink, parseChatEmail } from './chat-email-draft.ts';
import {
  CHAT_EMAIL_RECIPIENTS_MAX,
  CHAT_EMAIL_SUBJECT_MAX,
  type ChatEmail,
  GMAIL_COMPOSE_URL_MAX,
} from './chat-email-draft-contract.ts';

const email = (over: Partial<ChatEmail> = {}): ChatEmail => ({
  to: [],
  cc: [],
  bcc: [],
  subject: '',
  body: '',
  dropped: 0,
  over: 0,
  ...over,
});
const query = (url: string) => new URL(url).searchParams;

describe('parseChatEmail', () => {
  it('reads the header lines, then the text exactly as written', () => {
    expect(
      parseChatEmail(
        'To: jo@acme.co.uk\nCc: kim@acme.co.uk\nBcc: boss@acme.co.uk\nSubject: Boiler quote\n\nHi Jo,\n\n  - one\n**not bold**\n\nRef: [ACM4K7]\n',
      ),
    ).toEqual(
      email({
        to: ['jo@acme.co.uk'],
        cc: ['kim@acme.co.uk'],
        bcc: ['boss@acme.co.uk'],
        subject: 'Boiler quote',
        body: 'Hi Jo,\n\n  - one\n**not bold**\n\nRef: [ACM4K7]',
      }),
    );
  });

  it('takes headers in any case and order, and a repeated list header adds to the list', () => {
    const got = parseChatEmail('SUBJECT:  Hello there \nto: a@x.co\nTO : b@x.co\nsubject: ignored\n\nText');
    expect(got).toEqual(email({ to: ['a@x.co', 'b@x.co'], subject: 'Hello there', body: 'Text' }));
  });

  it('a block with no header lines is all text; headers end at the first line that is not one', () => {
    expect(parseChatEmail('Hi Jo,\nTo: not a header here\n')).toEqual(
      email({ body: 'Hi Jo,\nTo: not a header here' }),
    );
    expect(parseChatEmail('To: a@x.co\nHi Jo,\nSubject: nor this')).toEqual(
      email({ to: ['a@x.co'], body: 'Hi Jo,\nSubject: nor this' }),
    );
    expect(parseChatEmail('\n\nTo: a@x.co\n\n\nBody\n\n')).toEqual(email({ to: ['a@x.co'], body: 'Body' }));
    expect(parseChatEmail('')).toEqual(email());
  });

  it('keeps only real addresses: a name is dropped, anything else is left out and counted', () => {
    const got = parseChatEmail(
      'To: Jo Example <jo@acme.co.uk>, kim@acme.co.uk; the team, <bare@acme.co.uk>, jo@acme, "x" <a@b.co> trailing\n\nx',
    );
    expect(got.to).toEqual(['jo@acme.co.uk', 'kim@acme.co.uk', 'bare@acme.co.uk']);
    expect(got.dropped).toBe(3);
    // An empty entry is not a left-out address.
    expect(parseChatEmail('To: a@x.co,, ;\nCc:\n\nx')).toEqual(email({ to: ['a@x.co'], body: 'x' }));
  });

  it('a comma inside a quoted name does not split the entry', () => {
    const got = parseChatEmail(
      'To: "Example, Jo" <jo@acme.co.uk>, "Lee; Kim" <kim@acme.co.uk>, "unclosed <x@acme.co.uk>\n\nx',
    );
    expect(got.to).toEqual(['jo@acme.co.uk', 'kim@acme.co.uk']);
    expect(got.dropped).toBe(1);
    // Curly quotes round a name work the same way.
    expect(parseChatEmail('To: \u201CExample, Jo\u201D <jo@acme.co.uk>\n\nx')).toMatchObject({
      to: ['jo@acme.co.uk'],
      dropped: 0,
    });
  });

  it('a From line among the headers is ignored: Gmail sends from the account it opens in', () => {
    expect(parseChatEmail('From: Sam <sam@tds.example>\nTo: jo@acme.co.uk\nSubject: Hi\n\nText')).toEqual(
      email({ to: ['jo@acme.co.uk'], subject: 'Hi', body: 'Text' }),
    );
    expect(parseChatEmail('To: jo@acme.co.uk\nfrom: sam@tds.example\nSubject: Hi\n\nText').subject).toBe(
      'Hi',
    );
    // A sentence that only starts like one is part of the message, never lost.
    expect(parseChatEmail('Subject: Hi\nFrom: here on, we will meet weekly.\nBye').body).toBe(
      'From: here on, we will meet weekly.\nBye',
    );
    expect(parseChatEmail('From: the whole team\n\nThanks').body).toBe('From: the whole team\n\nThanks');
  });

  it('never repairs or invents an address', () => {
    const got = parseChatEmail(
      'To: jo@acme.co.uk>, <jo@acme.co.uk, jo @acme.co.uk, mailto:jo@acme.co.uk\n\nx',
    );
    expect(got.to).toEqual([]);
    expect(got.dropped).toBe(4);
  });

  it('keeps an address once across the three lists, whatever its case, without counting it', () => {
    const got = parseChatEmail('To: a@x.co, A@X.CO\nCc: a@x.co, b@x.co\nBcc: B@x.co\n\nx');
    expect(got).toEqual(email({ to: ['a@x.co'], cc: ['b@x.co'], body: 'x' }));
  });

  it('stops at the limit and says how many were over it', () => {
    const many = Array.from({ length: CHAT_EMAIL_RECIPIENTS_MAX + 3 }, (_, i) => `p${i}@x.co`);
    const got = parseChatEmail(`To: ${many.slice(0, 15).join(', ')}\nCc: ${many.slice(15).join(', ')}\n\nx`);
    expect(got.to).toHaveLength(15);
    expect(got.cc).toEqual(many.slice(15, CHAT_EMAIL_RECIPIENTS_MAX));
    expect(got.over).toBe(3);
    expect(got.dropped).toBe(0);
  });

  it('cleans the subject: one line, no control or text-direction characters, cut at the limit', () => {
    expect(parseChatEmail('Subject: Hello‮ dlrow\u0007\tthere​\n\nx').subject).toBe('Hello dlrow there');
    expect(parseChatEmail(`Subject: ${'s'.repeat(CHAT_EMAIL_SUBJECT_MAX + 50)}\n\nx`).subject).toHaveLength(
      CHAT_EMAIL_SUBJECT_MAX,
    );
  });

  it('removes characters nobody can see from the text, keeping line breaks and tabs', () => {
    const hidden = '\u200B\u200C\u200D\u2060\uFEFF\u202E\u200F\u0007\u0000\u00AD\u061C\u180E';
    const got = parseChatEmail(`To: a@x.co\n\nHi${hidden} Jo,\n\tindented\u200B\n\nBye${hidden}`);
    expect(got.body).toBe('Hi Jo,\n\tindented\n\nBye');
  });

  it('refuses an address with a % in it: it could read as another address', () => {
    const got = parseChatEmail('To: jo%40acme.co.uk@evil.example, jo+tag@acme.co.uk\n\nx');
    expect(got.to).toEqual(['jo+tag@acme.co.uk']);
    expect(got.dropped).toBe(1);
  });

  it('stops adding addresses once they would not all fit in a link', () => {
    const long = Array.from(
      { length: 20 },
      (_, i) =>
        `${'+'.repeat(62)}${String(i).padStart(2, '0')}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.co`,
    );
    const got = parseChatEmail(`To: ${long.join(', ')}\nSubject: ${'“'.repeat(300)}\n\n${'x'.repeat(9000)}`);
    expect(got.dropped).toBe(0);
    expect(got.over).toBeGreaterThan(0);
    expect(got.to.length + got.over).toBe(20);
    // Whatever is kept always fits, with the longest account address too.
    const { url, fits } = chatEmailLink(`${'o'.repeat(64)}@${'t'.repeat(180)}.example`, got);
    expect(fits).toBe(false);
    expect(url.length).toBeLessThanOrEqual(GMAIL_COMPOSE_URL_MAX);
    expect(query(url).get('to')?.split(',')).toEqual(got.to);
    // The subject on the card is always the subject Gmail gets: only the text is ever left out.
    expect(query(url).get('su')).toBe(got.subject);
    expect(got.subject).toHaveLength(250);
  });

  it('the subject on the card always reaches Gmail, however long the list of addresses', () => {
    // 20 addresses that cost exactly 250 characters of link each, the longest subject, a long account address.
    const list = Array.from(
      { length: 20 },
      (_, i) =>
        `${'a'.repeat(56)}${String(i).padStart(2, '0')}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.com`,
    );
    const got = parseChatEmail(
      `To: ${list.join(', ')}\nSubject: ${'\u201C'.repeat(250)}\n\n${'x'.repeat(9000)}`,
    );
    const { url } = chatEmailLink(`${'o'.repeat(64)}@${'t'.repeat(180)}.example`, got);
    expect(url.length).toBeLessThanOrEqual(GMAIL_COMPOSE_URL_MAX);
    expect(query(url).get('su')).toBe(got.subject);
    expect(got.subject).toHaveLength(250);
    expect(got.to.length + got.over).toBe(20);
  });

  it('folds Windows line ends', () => {
    expect(parseChatEmail('To: a@x.co\r\nSubject: S\r\n\r\nOne\r\nTwo\r\n')).toEqual(
      email({ to: ['a@x.co'], subject: 'S', body: 'One\nTwo' }),
    );
  });

  it('stays quick on hostile text', () => {
    const cases = [
      `To: ${'<'.repeat(200000)}\n\nx`,
      `To: ${'a@'.repeat(100000)}\n\nx`,
      `To: ${'a.'.repeat(100000)}@x.co\n\nx`,
      `To: ${'x <'.repeat(60000)}\n\nx`,
      `To: ${'a@b.co,'.repeat(30000)}\n\nx`,
      `Subject: ${' ‮'.repeat(100000)}\n\nx`,
      '\n'.repeat(250000),
      `${'To:\n'.repeat(60000)}x`,
    ];
    for (const c of cases) {
      const start = Date.now();
      parseChatEmail(c);
      expect(Date.now() - start, c.slice(0, 20)).toBeLessThan(4000);
    }
  }, 60_000);
});

describe('chatEmailLink', () => {
  it('fills Gmail compose with the recipients, subject and text', () => {
    const { url, fits } = chatEmailLink(
      'me@tds.example',
      email({
        to: ['jo@acme.co.uk', 'kim@acme.co.uk'],
        cc: ['c@acme.co.uk'],
        bcc: ['b@acme.co.uk'],
        subject: 'Boiler quote',
        body: 'Hi Jo,\n\nRef: [ACM4K7]',
      }),
    );
    expect(fits).toBe(true);
    expect(url.startsWith('https://mail.google.com/mail/?authuser=me%40tds.example&view=cm&fs=1&to=')).toBe(
      true,
    );
    const q = query(url);
    expect(q.get('to')).toBe('jo@acme.co.uk,kim@acme.co.uk');
    expect(q.get('cc')).toBe('c@acme.co.uk');
    expect(q.get('bcc')).toBe('b@acme.co.uk');
    expect(q.get('su')).toBe('Boiler quote');
    expect(q.get('body')).toBe('Hi Jo,\n\nRef: [ACM4K7]');
  });

  it('leaves out what is empty, and the account when there is no identity email', () => {
    expect(chatEmailLink(null, email({ body: 'Hi' })).url).toBe(
      'https://mail.google.com/mail/?view=cm&fs=1&body=Hi',
    );
    expect(chatEmailLink(null, email()).url).toBe('https://mail.google.com/mail/?view=cm&fs=1');
  });

  it('cannot be given extra parameters through the subject or the text', () => {
    const { url } = chatEmailLink(
      null,
      email({ subject: 'A&bcc=evil@x.co#frag', body: 'one&to=evil@x.co\n#two?three=4 £ “quoted” 50%' }),
    );
    const q = query(url);
    expect([...q.keys()]).toEqual(['view', 'fs', 'su', 'body']);
    expect(q.get('su')).toBe('A&bcc=evil@x.co#frag');
    expect(q.get('body')).toBe('one&to=evil@x.co\n#two?three=4 £ “quoted” 50%');
    expect(new URL(url).hash).toBe('');
  });

  it('leaves the text out when the link would be too long, keeping recipients and subject', () => {
    const long = email({ to: ['jo@acme.co.uk'], subject: 'S', body: '£ “x” '.repeat(1000) });
    const { url, fits } = chatEmailLink(null, long);
    expect(fits).toBe(false);
    expect(url.length).toBeLessThanOrEqual(GMAIL_COMPOSE_URL_MAX);
    expect(query(url).get('to')).toBe('jo@acme.co.uk');
    expect(query(url).get('su')).toBe('S');
    expect(query(url).has('body')).toBe(false);
  });

  it('a text just inside the limit is filled in', () => {
    const base = chatEmailLink(null, email({ body: 'a' })).url.length - 1;
    const exact = email({ body: 'a'.repeat(GMAIL_COMPOSE_URL_MAX - base) });
    expect(chatEmailLink(null, exact)).toMatchObject({ fits: true });
    expect(chatEmailLink(null, exact).url).toHaveLength(GMAIL_COMPOSE_URL_MAX);
    expect(chatEmailLink(null, email({ body: `${exact.body}a` }))).toMatchObject({ fits: false });
  });

  it('a long list and a long subject lose the subject before any recipient', () => {
    const big = email({
      to: Array.from(
        { length: 20 },
        (_, i) =>
          `${'a'.repeat(62)}${String(i).padStart(2, '0')}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.co`,
      ),
      subject: '“'.repeat(CHAT_EMAIL_SUBJECT_MAX),
      body: 'x'.repeat(2000),
    });
    const { url, fits } = chatEmailLink(`${'o'.repeat(64)}@${'t'.repeat(60)}.example`, big);
    expect(fits).toBe(false);
    expect(url.length).toBeLessThanOrEqual(GMAIL_COMPOSE_URL_MAX);
    expect(query(url).get('to')?.split(',')).toHaveLength(20);
    expect(query(url).has('su')).toBe(false);
    expect(query(url).has('body')).toBe(false);
  });

  it('never throws on half a character pair', () => {
    const { url } = chatEmailLink(null, email({ subject: 'a\uD83D', body: '\uDE00b 😀' }));
    expect(query(url).get('su')).toBe('a�');
    expect(query(url).get('body')).toBe('�b 😀');
  });
});
