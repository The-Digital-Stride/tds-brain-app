import { describe, expect, it } from 'vitest';
import { holdsEmail, splitReply } from './email-draft.ts';

const F = '```';
const block = (inner: string, fence = F, lang = 'email') => `${fence}${lang}\n${inner}\n${fence}`;
const kinds = (text: string) => splitReply(text).map((p) => p.kind);

describe('splitReply', () => {
  it('a reply with no email block is one text piece, exactly as given', () => {
    for (const text of [
      '',
      'Just words.\r\n\r\n- a list\n',
      `${F}ts\nconst email = 1;\n${F}`,
      'Write to me by email\n\nemail',
      `    ${F}email\n    indented code\n`,
    ]) {
      expect(splitReply(text), JSON.stringify(text)).toEqual([{ kind: 'text', text }]);
    }
  });

  it('gives the text before, the email, and the text after, in order', () => {
    const pieces = splitReply(
      `Here it is:\n\n${block('To: jo@acme.co.uk\nSubject: Hi\n\nHello Jo')}\n\nShall I change anything?`,
    );
    expect(pieces.map((p) => p.kind)).toEqual(['text', 'email', 'text']);
    expect(pieces[0]).toMatchObject({ kind: 'text' });
    expect((pieces[0] as { text: string }).text.trim()).toBe('Here it is:');
    expect(pieces[1]).toEqual({
      kind: 'email',
      closed: true,
      email: { to: ['jo@acme.co.uk'], cc: [], bcc: [], subject: 'Hi', body: 'Hello Jo', dropped: 0, over: 0 },
    });
    expect((pieces[2] as { text: string }).text.trim()).toBe('Shall I change anything?');
  });

  it('finds two emails, tilde fences, longer fences and any case of the word', () => {
    const text = `${block('One', '~~~', 'EMAIL')}\n\nand\n\n${block(`Two\n${F}\ninside\n${F}`, '````', 'Email')}`;
    const pieces = splitReply(text);
    expect(pieces.map((p) => p.kind)).toEqual(['email', 'text', 'email']);
    expect(pieces[0]).toMatchObject({ closed: true, email: { body: 'One' } });
    expect(pieces[2]).toMatchObject({ closed: true, email: { body: `Two\n${F}\ninside\n${F}` } });
  });

  it('leaves a block inside a list, a quote or a longer fence as ordinary markdown', () => {
    expect(kinds(`- item\n\n  ${F}email\n  To: a@x.co\n  ${F}\n`)).toEqual(['text']);
    expect(kinds(`> ${F}email\n> To: a@x.co\n> ${F}\n`)).toEqual(['text']);
    expect(kinds(`${F}${F}md\n${F}email\nTo: a@x.co\n${F}\n${F}${F}\n`)).toEqual(['text']);
    // Another word after "email", or before it, is another language.
    expect(kinds(`${F}email-template\nx\n${F}`)).toEqual(['text']);
    expect(kinds(`${F}html email\nx\n${F}`)).toEqual(['text']);
  });

  it('an email still arriving is not closed; it closes when its fence comes', () => {
    const open = splitReply(`Draft:\n\n${F}email\nTo: jo@acme.co.uk\n\nHello`);
    expect(open.at(-1)).toMatchObject({ kind: 'email', closed: false, email: { body: 'Hello' } });
    expect(splitReply(`${F}email\nHello\n${F}`).at(-1)).toMatchObject({ closed: true });
    // A fence of the other kind, or a shorter one, does not close it.
    expect(splitReply(`${F}${F}email\nHello\n${F}`).at(-1)).toMatchObject({ closed: false });
    expect(splitReply(`${F}email\nHello\n~~~`).at(-1)).toMatchObject({ closed: false });
    expect(splitReply(`${F}email`).at(-1)).toMatchObject({ kind: 'email', closed: false });
  });

  it('finds an email in a reply with Windows line ends', () => {
    const pieces = splitReply(`Draft:\r\n\r\n${F}email\r\nTo: jo@acme.co.uk\r\n\r\nHello\r\n${F}\r\n`);
    expect(pieces.at(-1)).toMatchObject({
      kind: 'email',
      closed: true,
      email: { to: ['jo@acme.co.uk'], body: 'Hello' },
    });
  });

  it('holdsEmail says whether a reply has one', () => {
    expect(holdsEmail('no')).toBe(false);
    expect(holdsEmail(`${F}ts\nemail\n${F}`)).toBe(false);
    expect(holdsEmail(`x\n\n${block('Hi')}`)).toBe(true);
    expect(holdsEmail(`- a\n\n  ${F}email\n  x\n  ${F}`)).toBe(false);
  });

  it('stays quick on a long reply, with and without a block', () => {
    const long = 'word '.repeat(60000);
    for (const text of [long, `${long}\n\n${block(long)}`, `${F}email\n`.repeat(20000), '`'.repeat(200000)]) {
      const start = Date.now();
      splitReply(text);
      expect(Date.now() - start).toBeLessThan(4000);
    }
  }, 60_000);
});
