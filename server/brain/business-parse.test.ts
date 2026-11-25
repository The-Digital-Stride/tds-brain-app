import { describe, expect, it } from 'vitest';
import { FACT_MAX_CHARS, SECTION_MAX_CHARS } from '../../shared/project-business-contract.ts';
import { clean, HEADING, parseBusiness, plain, profileStatus } from './business-parse.ts';

/** Synthetic: the SHAPE of a client's business.md, none of its content. */
const TEMPLATE = `# Business Context

> Created by /client-setup on 2026-01-01.

## Account

**Client:** Example Ltd
**URL:** https://example.test/
**Services we provide:** PPC (Google Ads, Search), SEO (organic
content work and **AI search** optimisation)

## Business Model

### What We Sell
Daily contract widgets, not one-offs.

### Who We Sell To
**Who buys:** Buyers at mid-size firms.

## Goals & KPIs

### Primary Focus
Grow qualified leads.

### Performance Targets
Cost per lead under the agreed figure.

### Budget
**Monthly budget:** About a thousand a month, flexible.
Held in the shared account.

## Marketing strategy

Search first, then remarketing.

## Market & Niche (updated 2026-10)

Flats and listed buildings.

## Competitive Landscape

Two big names and a long tail.

## Brand & Voice

Plain, friendly.

## Working Relationship

**Main contact:** Pat Example, who leads day to day and
signs off spend.
**Preferred comms:** Email, with a monthly call.
**Primary KPI:** Cost per lead
**Target:** Under the agreed figure
**Target area:** The north of England
**Reporting to providers:** Not the one we want
**Reporting:** Monthly email

### Contracts (added 2026-11-03)

Fee is a secret amount; notice is some months.

#### Retainer
| Fee | secret retainer |

### Who's who
- **Pat**: lead.

## Gaps

Nothing.
`;

const TEXT = (s: ReturnType<typeof parseBusiness>) => Object.fromEntries(s.facts.map((f) => [f.id, f.value]));

describe('parseBusiness: key facts', () => {
  it('picks every fact from a template file (PPC)', () => {
    const { facts } = parseBusiness(TEMPLATE, null, ['ppc']);
    expect(facts.map((f) => f.id)).toEqual([
      'contact',
      'comms',
      'services',
      'kpi',
      'target',
      'budget',
      'reporting',
    ]);
    expect(facts.every((f) => f.from === 'business')).toBe(true);
    expect(facts[0]?.words).toBe('Main contact');
  });

  it('joins a wrapped value and strips emphasis', () => {
    const t = TEXT(parseBusiness(TEMPLATE, null, ['ppc']));
    expect(t.contact).toBe('Pat Example, who leads day to day and signs off spend.');
    expect(t.services).toBe(
      'PPC (Google Ads, Search), SEO (organic content work and AI search optimisation)',
    );
    expect(t.budget).toBe('About a thousand a month, flexible. Held in the shared account.');
  });

  it('matches the whole label: Target area never reads as Target', () => {
    const t = TEXT(parseBusiness(TEMPLATE, null, ['ppc']));
    expect(t.target).toBe('Under the agreed figure');
    const onlyArea = parseBusiness(
      '**Target area:** The north\n**Reporting to providers:** Monthly\n',
      null,
      [],
    );
    expect(onlyArea.facts).toEqual([]);
  });

  it('matches a list-marker label line, any case', () => {
    const r = parseBusiness('- **Main contact:** Sam Example\n* **primary kpi:** Revenue\n', null, []);
    expect(TEXT(r)).toEqual({ contact: 'Sam Example', kpi: 'Revenue' });
  });

  it('stops a value at a blank line, a list item, a table row, a heading or the next label', () => {
    for (const stop of ['', '- item', '| a | b |', '## Next', '**Other:** x', '1. one']) {
      const r = parseBusiness(`**Main contact:** Sam\nExample\n${stop}\nmore text\n`, null, []);
      expect(TEXT(r).contact, JSON.stringify(stop)).toBe('Sam Example');
    }
  });

  it('drops placeholders: {…}, Not provided yet, N/A and the rest', () => {
    for (const v of [
      '{name here}',
      'Not provided yet',
      'N/A, portal build',
      'not applicable',
      'TBC',
      'Not set',
      '',
    ]) {
      const r = parseBusiness(`**Primary KPI:** ${v}\n`, null, []);
      expect(r.facts, JSON.stringify(v)).toEqual([]);
    }
  });

  it('keeps "Unknown" in the middle of a value', () => {
    const r = parseBusiness('**Reporting:** Monthly, day Unknown\n', null, []);
    expect(TEXT(r).reporting).toBe('Monthly, day Unknown');
  });

  it('falls back to profile.md for Main contact and Services', () => {
    const profile = '---\nstatus: active\n---\n\n**Main contact:** Kim Example\n**Services:** SEO\n';
    const r = parseBusiness('**Main contact:** Not provided yet\n', profile, []);
    expect(r.facts.map((f) => [f.id, f.value, f.from])).toEqual([
      ['contact', 'Kim Example', 'profile'],
      ['services', 'SEO', 'profile'],
    ]);
  });

  it('prefers business.md over profile.md', () => {
    const r = parseBusiness('**Main contact:** Pat\n', '**Main contact:** Kim\n', []);
    expect(r.facts[0]).toMatchObject({ value: 'Pat', from: 'business' });
  });

  it('shows Budget only for ppc, whatever the case of the service', () => {
    expect(parseBusiness(TEMPLATE, null, ['seo']).facts.map((f) => f.id)).not.toContain('budget');
    expect(parseBusiness(TEMPLATE, null, []).facts.map((f) => f.id)).not.toContain('budget');
    expect(parseBusiness(TEMPLATE, null, ['PPC']).facts.map((f) => f.id)).toContain('budget');
  });

  it('cuts a long value at a word with an ellipsis', () => {
    const r = parseBusiness(`**Reporting:** ${'word '.repeat(100)}\n`, null, []);
    const v = TEXT(r).reporting ?? '';
    expect(v.endsWith('…')).toBe(true);
    expect(v.length).toBeLessThanOrEqual(FACT_MAX_CHARS + 1);
    expect(v.slice(0, -1).endsWith('word')).toBe(true);
  });

  it('gives plain text: links, code and tags removed', () => {
    const r = parseBusiness(
      '**Reporting:** See [the report](https://x.test) and `code` <b>now</b>\n',
      null,
      [],
    );
    expect(TEXT(r).reporting).toBe('See the report and code now');
  });

  it('ignores frontmatter and HTML comments', () => {
    const r = parseBusiness(
      '---\nTarget: x\n---\n<!-- **Target:** hidden\nmore -->\n**Target:** Real\n',
      null,
      [],
    );
    expect(TEXT(r).target).toBe('Real');
  });
});

describe('parseBusiness: sections', () => {
  const titles = (services: string[]) => parseBusiness(TEMPLATE, null, services).sections.map((s) => s.title);

  it('takes a ### on its own body, up to the next ### or ##', () => {
    const s = parseBusiness(TEMPLATE, null, ['ppc']).sections.find((x) => x.heading === 'What We Sell');
    expect(s).toMatchObject({
      title: 'What they sell',
      markdown: 'Daily contract widgets, not one-offs.',
      cut: false,
      open: false,
    });
    expect(s?.from).toBe('business');
  });

  it('takes a ## up to the next ##, leaving out ### Contracts but keeping other ### as bold lines', () => {
    const s = parseBusiness(TEMPLATE, null, ['ppc']).sections.find(
      (x) => x.heading === 'Working Relationship',
    );
    expect(s?.title).toBe('Working with them');
    expect(s?.markdown).toContain('**Main contact:**');
    expect(s?.markdown).toContain("**Who's who**");
    expect(s?.markdown).toContain('- **Pat**: lead.');
    expect(s?.markdown).not.toContain('secret');
    expect(s?.markdown).not.toContain('Contracts');
    expect(s?.markdown).not.toContain('Nothing.');
  });

  it('matches a heading with trailing bracket text, ignoring it', () => {
    expect(titles(['ppc'])).toContain('Market and niche');
  });

  it('follows the rules order, not the file order', () => {
    expect(titles(['ppc'])).toEqual([
      'What they sell',
      'Who they sell to',
      'Current focus',
      'Targets',
      'Budget',
      'Marketing strategy',
      'Market and niche',
      'Competitors',
      'Working with them',
    ]);
  });

  it('shows Budget only for ppc, Brand and voice only for seo or social-email', () => {
    expect(titles(['seo'])).not.toContain('Budget');
    expect(titles(['seo'])).toContain('Brand and voice');
    expect(titles(['social-email'])).toContain('Marketing strategy');
    expect(titles(['hosting'])).toEqual([
      'What they sell',
      'Who they sell to',
      'Current focus',
      'Working with them',
    ]);
  });

  it('skips a section where every line is a placeholder', () => {
    const text =
      '## Budget\n\n**Monthly budget:** Not provided yet\nTBC\n{fill in}\n\n## Marketing strategy\nReal.\n';
    expect(parseBusiness(text, null, ['ppc']).sections.map((s) => s.heading)).toEqual(['Marketing strategy']);
  });

  it('takes "Where they stand" from profile.md, open', () => {
    const profile =
      '---\nstatus: active\n---\n# Name\n\n## Where they stand\n\nStable.\n\n## Key dates\n\nSoon.\n';
    const r = parseBusiness(null, profile, []);
    expect(r.sections).toEqual([
      {
        title: 'Where they stand',
        heading: 'Where they stand',
        markdown: 'Stable.',
        cut: false,
        open: true,
        from: 'profile',
      },
    ]);
  });

  it('does not look for business headings in profile.md or the reverse', () => {
    expect(parseBusiness(null, '## What We Sell\nx\n', []).sections).toEqual([]);
    expect(parseBusiness('## Where they stand\nx\n', null, []).sections).toEqual([]);
  });

  it('cuts a long section at a line end with cut: true', () => {
    const line = 'a line of the section text that is fairly long.';
    const body = Array.from({ length: 200 }, () => line).join('\n');
    const s = parseBusiness(`### What We Sell\n${body}\n`, null, []).sections[0];
    expect(s?.cut).toBe(true);
    expect(s?.markdown.length).toBeLessThanOrEqual(SECTION_MAX_CHARS);
    expect(s?.markdown.endsWith('long.')).toBe(true);
  });

  it('removes comments from a section body', () => {
    const s = parseBusiness('### What We Sell\nOne.\n<!-- hidden\nlines -->\nTwo.\n', null, []).sections[0];
    expect(s?.markdown).toBe('One.\n\nTwo.');
  });

  it('handles CRLF', () => {
    const s = parseBusiness('### What We Sell\r\nOne.\r\n', null, []).sections[0];
    expect(s?.markdown).toBe('One.');
  });
});

describe('parseBusiness: files outside the template', () => {
  it('finds nothing in a file with other headings and no labels', () => {
    const text =
      '# Notes\n\n## Revenue targets\n\nSome numbers.\n\n## Seasonality\n\n- **Reporting cadence** none\n';
    expect(parseBusiness(text, null, ['ppc', 'seo'])).toEqual({ facts: [], sections: [] });
  });

  it('copes with null and empty input', () => {
    expect(parseBusiness(null, null, [])).toEqual({ facts: [], sections: [] });
    expect(parseBusiness('', '', ['ppc'])).toEqual({ facts: [], sections: [] });
  });
});

describe('profileStatus', () => {
  it('reads the frontmatter status', () => {
    expect(profileStatus('---\nowner: x\nstatus: active\n---\n# T\n')).toBe('active');
    expect(profileStatus('---\nstatus: "prospect"\n---\n')).toBe('prospect');
  });
  it('is null when absent, empty, not in frontmatter or no text', () => {
    expect(profileStatus('---\nowner: x\n---\n')).toBeNull();
    expect(profileStatus('---\nstatus:\n---\n')).toBeNull();
    expect(profileStatus('# T\nstatus: active\n')).toBeNull();
    expect(profileStatus(null)).toBeNull();
  });
});

describe('reading stays quick on hostile text (2026-11-25)', () => {
  // Before: a heading followed by a long run of spaces took time that grew with the cube of its length
  // (800 spaces: 2.8 s), and runs of `[`, `<` or `<!--` with the square (64,000: over 15 s). A client file can
  // be 256 KB, and the read runs on the server's one thread.
  it('parses each in well under a second', () => {
    const cases = {
      headingSpaces: `## a${' '.repeat(64000)}x\n`,
      headingBrackets: `## ${'['.repeat(64000)} x\n`,
      labelBrackets: `**Main contact:** ${'['.repeat(64000)}\n`,
      labelTags: `**Main contact:** ${'<'.repeat(64000)}\n`,
      labelLinks: `**Main contact:** ${'[a]('.repeat(16000)}\n`,
      bodyBrackets: `### What We Sell\n${'['.repeat(64000)}\n`,
      comments: `${'<!--'.repeat(64000)}\n## Account\n`,
    };
    for (const [name, text] of Object.entries(cases)) {
      const start = Date.now();
      parseBusiness(text, text, ['ppc']);
      expect(Date.now() - start, name).toBeLessThan(1000);
    }
  });

  it('a heading reads as before: level, then the text without a closing run of #s', () => {
    const read = (line: string) => {
      const h = HEADING.exec(line);
      return h ? [h[1]?.length, h[2]] : null;
    };
    expect(read('## Account')).toEqual([2, 'Account']);
    expect(read('###   What We Sell   ')).toEqual([3, 'What We Sell']);
    expect(read('## Budget ##')).toEqual([2, 'Budget']);
    expect(read('## Budget ##   ')).toEqual([2, 'Budget']);
    expect(read('## C#')).toEqual([2, 'C']);
    expect(read('## a # b')).toEqual([2, 'a # b']);
    expect(read('## a # #')).toEqual([2, 'a #']);
    expect(read('## ###')).toEqual([2, '']);
    expect(read('##   ')).toEqual([2, '']);
    expect(read('###### Six')).toEqual([6, 'Six']);
    expect(read('##')).toBeNull();
    expect(read('####### Seven')).toBeNull();
    expect(read('#NoSpace')).toBeNull();
    expect(read(' ## Indented')).toBeNull();
    expect(read('Text ## not a heading')).toBeNull();
    for (const line of ['## Account', '#\tTab', '##', '#NoSpace', 'plain', '####### Seven']) {
      expect(HEADING.test(line), line).toBe(HEADING.exec(line) !== null);
    }
  });

  it('comments are removed as before: closed ones anywhere, an unclosed one to the end', () => {
    expect(clean('a<!-- x -->b<!--y-->c')).toBe('abc');
    expect(clean('a<!-- x\n\ny -->b')).toBe('ab');
    expect(clean('a<!-->b-->c')).toBe('ac');
    expect(clean('keep<!-- open\nrest')).toBe('keep');
    expect(clean('a<!-- x -->b<!-- open')).toBe('ab');
    expect(clean('no comments --> here')).toBe('no comments --> here');
  });

  it('plain text is as before for ordinary links and tags', () => {
    expect(plain('See [the site](https://example.test/a?b=1) and ![logo](x.png).')).toBe(
      'See the site and logo.',
    );
    expect(plain('A <b>bold</b> **move** in `code`')).toBe('A bold move in code');
    expect(plain('[multi\nline](u) text')).toBe('multi line text');
  });
});
