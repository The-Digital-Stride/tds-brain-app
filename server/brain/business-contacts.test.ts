import { describe, expect, it } from 'vitest';
import { BUSINESS_CONTACTS_MAX, CONTACT_NAME_MAX } from '../../shared/project-business-contract.ts';
import { parseContacts } from './business-contacts.ts';

/** Synthetic throughout: the SHAPES found in the brain's client files (2026-11-25), none of their content. */
const one = (business: string | null, profile: string | null = null) => parseContacts(business, profile);

describe('parseContacts: label lines', () => {
  it('reads "Name (address) — role" from a Main contact line and marks it main', () => {
    expect(one('**Main contact:** Kim Example (kim@acme.test.uk) — marketing lead\n')).toEqual([
      { name: 'Kim Example', email: 'kim@acme.test.uk', main: true },
    ]);
  });

  it('reads "Name, Role — address." and drops the full stop', () => {
    expect(one('**Main contact:** Kim Example, Director — kim@acme.co.uk.\n')).toEqual([
      { name: 'Kim Example', email: 'kim@acme.co.uk', main: true },
    ]);
  });

  it('reads "Name, address" and a value wrapped over two lines', () => {
    expect(
      one('**Main contact:** Kim Example,\nkim@acme.co.uk. Prefers email.\n\nNot this: x@acme.co.uk\n'),
    ).toEqual([{ name: 'Kim Example', email: 'kim@acme.co.uk', main: true }]);
  });

  it('reads several people on one line, each with the name next to their address', () => {
    const got = one(
      '**Main contact:** Kim Example (kim@acme.co.uk) — marketing lead; Sam (sam@acme.co.uk) — web/technical\n',
    );
    expect(got).toEqual([
      { name: 'Kim Example', email: 'kim@acme.co.uk', main: true },
      { name: 'Sam', email: 'sam@acme.co.uk', main: true },
    ]);
  });

  it('reads bold names and addresses in code marks', () => {
    const got = one(
      '- **Primary contact:** **Kim Example — Marketing Director, ACME** (`kim@acme.co.uk`), also **Lee Other** (`lee@acme.co.uk`)\n',
    );
    expect(got).toEqual([
      { name: 'Kim Example', email: 'kim@acme.co.uk', main: true },
      { name: 'Lee Other', email: 'lee@acme.co.uk', main: true },
    ]);
  });

  it('a second or other contact line is read too, and is not main', () => {
    const got = one(
      '**Main contact:** Kim Example (kim@acme.co.uk)\n**Second contact:** Lee Other — lee@acme.co.uk\n**Other Acme contacts:** Pat Third (pat@acme.co.uk)\n',
    );
    expect(got.map((c) => [c.name, c.main])).toEqual([
      ['Kim Example', true],
      ['Lee Other', false],
      ['Pat Third', false],
    ]);
  });

  it('a label that only starts with "Contact" is not a contact line', () => {
    expect(one('**Contact history warning:** do not write to old@acme.co.uk\n')).toEqual([]);
  });

  it('a contact label with no value takes the list straight under it', () => {
    const got = one(
      '**Other contacts:**\n\n- Lee Other (lee@acme.co.uk)\n- **Pat Third** — pat@acme.co.uk\n\nLater: z@acme.co.uk\n',
    );
    expect(got).toEqual([
      { name: 'Lee Other', email: 'lee@acme.co.uk', main: false },
      { name: 'Pat Third', email: 'pat@acme.co.uk', main: false },
    ]);
  });

  it('a line with a name and no address gives nobody', () => {
    expect(one('**Main contact:** Kim Example, Director. Prefers a call.\n')).toEqual([]);
  });

  it('an address with no readable name is listed by address alone', () => {
    expect(one('**Main contact:** the marketing team — hello@acme.co.uk\n')).toEqual([
      { name: null, email: 'hello@acme.co.uk', main: true },
    ]);
  });
});

describe('parseContacts: sections', () => {
  it('reads a table: the name is the first cell, the address anywhere in the row', () => {
    const got = one(
      [
        '## Contacts',
        '',
        '| Name | Role | Notes |',
        '|---|---|---|',
        '| Kim Example | Director | Main contact. kim@acme.co.uk · 01234 567 890. |',
        '| **Lee Other** (she/her) | Marketing Manager | `lee@acme.co.uk` — day to day |',
        '| Pat Third | Owner | No address on file. |',
        '',
        '## Next',
        'after@acme.co.uk',
      ].join('\n'),
    );
    expect(got).toEqual([
      { name: 'Kim Example', email: 'kim@acme.co.uk', main: true },
      { name: 'Lee Other', email: 'lee@acme.co.uk', main: false },
    ]);
  });

  it('reads a list: the bold name leads the item, the address may sit lines later', () => {
    const got = one(
      null,
      [
        '## Key contacts',
        '',
        'Emails come from two people:',
        '',
        '- **Kim Example-Smith**, Senior Manager for the North region. Tel: +44 1234 567 890.',
        '  Email: Kim.Example-Smith@acme.co.uk. Joined in 2021.',
        '- **Lee Other** (lee@acme.co.uk), Head of Marketing; reviews all copy.',
        '- **Pat Third** — Operations. No address.',
        '- Jo Fourth — jo@acme.co.uk',
      ].join('\n'),
    );
    expect(got).toEqual([
      { name: 'Kim Example-Smith', email: 'Kim.Example-Smith@acme.co.uk', main: false },
      { name: 'Lee Other', email: 'lee@acme.co.uk', main: false },
      { name: 'Jo Fourth', email: 'jo@acme.co.uk', main: false },
    ]);
  });

  it('reads a "People" section and a ### "Key Contacts" section, and stops at the next heading of its level', () => {
    const got = one(
      [
        '## People',
        '- **Kim Example** — kim@acme.co.uk',
        '### Agency side',
        '- **Lee Other** — lee@acme.co.uk',
        '## Budget',
        '- **Not Them** — no@acme.co.uk',
        '### Key Contacts',
        '- **Pat Third** — pat@acme.co.uk',
        '### Something else',
        '- **Nor Them** — nor@acme.co.uk',
      ].join('\n'),
    );
    expect(got.map((c) => c.email)).toEqual(['kim@acme.co.uk', 'lee@acme.co.uk', 'pat@acme.co.uk']);
  });

  it('skips someone whose name is struck through (they have left)', () => {
    const got = one(
      [
        '## Contacts',
        '| Person | Role | Note |',
        '|---|---|---|',
        '| ~~**Old Hand**~~ | Was the lead | old@acme.co.uk |',
        '| Kim Example | Lead | kim@acme.co.uk |',
        '',
        '- ~~Gone Person~~ — gone@acme.co.uk',
      ].join('\n'),
    );
    expect(got.map((c) => c.email)).toEqual(['kim@acme.co.uk']);
  });

  it('an item that says main contact is marked main and comes first', () => {
    const got = one(
      [
        '## Contacts',
        '- **Lee Other** — lee@acme.co.uk',
        '- **Kim Example** — primary contact. kim@acme.co.uk',
      ].join('\n'),
    );
    expect(got).toEqual([
      { name: 'Kim Example', email: 'kim@acme.co.uk', main: true },
      { name: 'Lee Other', email: 'lee@acme.co.uk', main: false },
    ]);
  });
});

describe('parseContacts: what is kept and left out', () => {
  it('never picks up an address outside a contact line or section', () => {
    expect(
      one(
        '# Business\n\nWrite to sales@rival.co.uk for a quote.\n\n## Working Relationship\n\n**Email domain:** x@acme.co.uk\n',
      ),
    ).toEqual([]);
  });

  it('one contact per address, whatever the case, across both files; main and the name are kept', () => {
    const got = one(
      '## Contacts\n- kim@acme.co.uk\n- **Lee Other** — lee@acme.co.uk\n',
      '**Main contact:** Kim Example (KIM@acme.co.uk)\n',
    );
    expect(got).toEqual([
      { name: 'Kim Example', email: 'kim@acme.co.uk', main: true },
      { name: 'Lee Other', email: 'lee@acme.co.uk', main: false },
    ]);
  });

  it('business.md comes before profile.md', () => {
    const got = one('**Second contact:** Bee (bee@acme.co.uk)\n', '**Second contact:** Ay (ay@acme.co.uk)\n');
    expect(got.map((c) => c.name)).toEqual(['Bee', 'Ay']);
  });

  it('leaves out template addresses, placeholders and anything in a comment or the frontmatter', () => {
    expect(
      one(
        '---\ncontact: fm@acme.co.uk\n---\n**Main contact:** {name} ({email})\n**Second contact:** Name (name@example.com)\n<!-- **Other contacts:** hid@acme.co.uk -->\n',
      ),
    ).toEqual([]);
  });

  it('reads an address out of a markdown link or angle brackets once', () => {
    expect(
      one(
        '**Main contact:** Kim Example [kim@acme.co.uk](mailto:kim@acme.co.uk)\n**Second contact:** Lee <lee@acme.co.uk>\n',
      ),
    ).toEqual([
      { name: 'Kim Example', email: 'kim@acme.co.uk', main: true },
      { name: 'Lee', email: 'lee@acme.co.uk', main: false },
    ]);
  });

  it('a name is plain text and never longer than the cap; markup in it gives no name', () => {
    const long = 'A'.repeat(CONTACT_NAME_MAX + 5);
    const got = one(
      `**Main contact:** ${long} (a@acme.co.uk)\n**Second contact:** <img src=x onerror=alert(1)> (b@acme.co.uk)\n**Other contacts:** Kim "KE" Example (c@acme.co.uk)\n`,
    );
    expect(got).toEqual([
      { name: null, email: 'a@acme.co.uk', main: true },
      { name: null, email: 'b@acme.co.uk', main: false },
      { name: 'Kim "KE" Example', email: 'c@acme.co.uk', main: false },
    ]);
  });

  it('only a strict address shape passes', () => {
    const got = one(
      '**Other contacts:** A (kim@acme), B (@acme.co.uk), C (kim@@acme.co.uk), D (k.i+m_%-x@sub.acme-co.uk), E (kim@acme.co.uk?subject=x&bcc=evil@rival.co.uk)\n',
    );
    expect(got.map((c) => c.email)).toEqual([
      'k.i+m_%-x@sub.acme-co.uk',
      'kim@acme.co.uk',
      'evil@rival.co.uk',
    ]);
    for (const c of got) expect(c.email).toMatch(/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/);
  });

  it('main contacts first, then file order, cut at the cap', () => {
    const rows = Array.from(
      { length: BUSINESS_CONTACTS_MAX + 4 },
      (_, i) => `- Person${i} — p${i}@acme.co.uk`,
    );
    const got = one(`## Contacts\n${rows.join('\n')}\n\n**Main contact:** Kim Example (kim@acme.co.uk)\n`);
    expect(got).toHaveLength(BUSINESS_CONTACTS_MAX);
    expect(got[0]).toEqual({ name: 'Kim Example', email: 'kim@acme.co.uk', main: true });
    expect(got[1]?.email).toBe('p0@acme.co.uk');
  });

  it('nothing in, nothing out; CRLF files read the same', () => {
    expect(one(null, null)).toEqual([]);
    expect(
      one('**Main contact:** Kim Example (kim@acme.co.uk)\r\n\r\n## Contacts\r\n- Lee — lee@acme.co.uk\r\n'),
    ).toEqual([
      { name: 'Kim Example', email: 'kim@acme.co.uk', main: true },
      { name: 'Lee', email: 'lee@acme.co.uk', main: false },
    ]);
  });

  it('a very long line of at signs returns quickly', () => {
    const start = Date.now();
    expect(one(`**Main contact:** ${'a@'.repeat(60000)}\n## Contacts\n${'x'.repeat(100000)}@\n`)).toEqual([]);
    expect(Date.now() - start).toBeLessThan(1500);
  });
});
