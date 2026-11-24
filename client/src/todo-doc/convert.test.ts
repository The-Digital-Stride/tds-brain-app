// @vitest-environment jsdom
import { Editor, getSchema, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { analyse } from './convert.ts';
import { countTasks, isFaithful, isSafeHref, toDoc, todoDocExtensions, toMarkdown } from './index.ts';
import { showTicks } from './kept-view.ts';

// Synthetic fixtures in the style of live to-do bodies (no real brain content).
const MIXED = [
  '# Acme — no target on file',
  '`clients/acme/context/business.md` § Targets:',
  '',
  '- **CPL target:** not provided yet',
  '- **Average sale:** not provided yet',
  '  - ask for it *per brand*',
  '',
  'The file flags the first one as *"needed before any audit"*. That is literal:',
  'with no target the checks report **"not assessable"** rather than pass or',
  'fail.',
  '',
  '## What is needed',
  '',
  '1. **CPL target** — ideally split, since the two brands differ. Budgets',
  '   are separate (£3,650 / £2,000).',
  '2. **Average sale value** — again per brand.',
  '   - shower enclosures',
  '   - wall panels',
  '',
  '| Area | What it covers |',
  '|---|---|',
  '| **Technical** | Schema, redirects |',
  '| On-page | Copy, `meta` |',
  '',
  '### Steps',
  '',
  '- [ ] Ask the client',
  '- [x] Check the [business file](https://example.com/acme)',
  '  - [ ] nested step with `code`',
  '',
  '> A quote from the call.',
  '',
  'Done ~~soon~~ later.',
].join('\n');

/** What the editor hands back: the document rebuilt through the schema, with every default attr filled in. */
function asEditorJson(doc: JSONContent): JSONContent {
  return getSchema(todoDocExtensions()).nodeFromJSON(doc).toJSON() as JSONContent;
}

function roundTrip(md: string): string {
  return toMarkdown(asEditorJson(toDoc(md)));
}

function top(doc: JSONContent): JSONContent[] {
  return doc.content ?? [];
}

function textNode(text: string, marks?: JSONContent['marks']): JSONContent {
  return marks ? { type: 'text', text, marks } : { type: 'text', text };
}

/** Replaces the text of the first text node in top-level block `i` (a simple edit). */
function retextBlock(doc: JSONContent, i: number, text: string): JSONContent {
  const copy = structuredClone(doc);
  const walk = (n: JSONContent): boolean => {
    if (n.type === 'text') {
      n.text = text;
      return true;
    }
    return (n.content ?? []).some(walk);
  };
  const block = top(copy)[i];
  if (!block || !walk(block)) throw new Error(`no text in block ${i}`);
  return copy;
}

describe('isSafeHref', () => {
  it('allows http, https and mailto only', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('http://example.com/a?b=c')).toBe(true);
    expect(isSafeHref('mailto:someone@example.com')).toBe(true);
    expect(isSafeHref('  HTTPS://EXAMPLE.COM ')).toBe(true);
    expect(isSafeHref('MailTo:x@example.com')).toBe(true);
  });
  it('refuses everything else', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref(' JavaScript:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html,hi')).toBe(false);
    expect(isSafeHref('vbscript:x')).toBe(false);
    expect(isSafeHref('/relative/path')).toBe(false);
    expect(isSafeHref('notes/file.md')).toBe(false);
    expect(isSafeHref('//example.com')).toBe(false);
    expect(isSafeHref('#anchor')).toBe(false);
    expect(isSafeHref('')).toBe(false);
  });
});

describe('exact round trip', () => {
  const cases: Record<string, string> = {
    'one paragraph': 'Just a sentence.',
    headings: '# Big\n\n## Middle\n\n### Small',
    'heading straight into text': '# Title\nText under it with no blank line.',
    'inline marks':
      'Some **bold**, `code`, *italic*, _also italic_, __strong__, ~~gone~~ and a [link](https://example.com "Title").',
    'bold around code': '**Run `pnpm test` first**',
    'soft-wrapped paragraph': 'A line that wraps\nonto a second line\nand a third.',
    'hard break': 'Line one  \nLine two\\\nLine three',
    'bullets nested by 2': '- one\n  - two\n    - three\n- four',
    'bullets nested by 4 and 6': '- one\n    - four in\n      - six in',
    'star bullets': '* one\n* two\n  * nested',
    'plus bullets': '+ one\n+ two',
    tasks: '- [ ] open\n- [x] done\n- [X] done too\n  - [ ] nested open',
    'mixed tasks and bullets': '- [ ] a task\n- a bullet',
    'numbered from 3': '3. three\n4. four',
    'numbered with nesting and continuation':
      '1. **First** — a long item that\n   carries on here.\n2. Second\n   - sub a\n   - sub b',
    'numbered with parens': '1) one\n2) two',
    'loose list': '- a\n\n- b\n\n- c',
    'item with two paragraphs': '- item\n\n  second paragraph',
    'paragraph straight into list': 'Steps:\n- one\n- two',
    'many blank lines': 'Top\n\n\n\nBottom',
    'escapes and entities': '\\*not bold\\* a_b_c 5 \\< 6 &amp; &copy; -> done',
    'bare url': 'See https://example.com/page for more.',
    'angle url': 'See <https://example.com/page>.',
    table: '| A | B |\n|---|---|\n| 1 | 2 |',
    quote: '> quoted\n> more',
    'fenced code with a task inside': '```ts\n- [ ] not a task\nconst a = 1;\n```',
    'indented code': 'Text\n\n    indented code',
    'html block': '<div>\n<b>hi</b>\n</div>',
    'inline html': 'a <kbd>Ctrl</kbd> b',
    rule: 'Above\n\n---\n\nBelow',
    'deep heading': '#### Too deep\n\nText',
    'setext heading': 'Title\n=====',
    'unsafe link': 'Do not [click](javascript:alert(1)) this.',
    'relative link': 'See [notes](notes/file.md).',
    image: '![alt](https://example.com/a.png)',
    'reference link': 'See [the doc][1].\n\n[1]: https://example.com',
    'table straight after text': 'Intro:\n| A | B |\n|---|---|\n| 1 | 2 |',
    'unicode and emoji': 'Café ⚠️ — “quotes” → arrows £3,650',
    mixed: MIXED,
  };
  for (const [name, md] of Object.entries(cases)) {
    it(name, () => {
      expect(roundTrip(md)).toBe(md);
      expect(toMarkdown(toDoc(md))).toBe(md);
    });
  }

  it('empty string is an empty document and back', () => {
    const doc = toDoc('');
    expect(doc.type).toBe('doc');
    expect(top(doc).every((n) => n.type === 'paragraph' && !n.content?.length)).toBe(true);
    expect(roundTrip('')).toBe('');
  });

  it('never throws on an odd document', () => {
    const odd: JSONContent = {
      type: 'doc',
      content: [
        { type: 'mystery', content: [textNode('x')] },
        { type: 'paragraph', attrs: { md: { source: 1 } }, content: [textNode('y')] },
        { type: 'keptBlock', attrs: {} },
      ],
    };
    expect(() => toMarkdown(odd)).not.toThrow();
    expect(toMarkdown({ type: 'doc' })).toBe('');
  });

  it('never throws on odd input', () => {
    for (const md of ['\u0000', '[', '***', '- ', '1.', '|', '<', '```', '- [ ]', '> ', '\t\tx']) {
      expect(() => toMarkdown(toDoc(md))).not.toThrow();
    }
  });
});

describe('blocks the editor offers and kept blocks', () => {
  const kinds = (md: string) => top(toDoc(md)).map((n) => n.type);

  it('maps allowed blocks to their nodes', () => {
    expect(kinds('# H\n\ntext\n\n- a\n\n1. b\n\n- [ ] c')).toEqual([
      'heading',
      'paragraph',
      'bulletList',
      'orderedList',
      'taskList',
    ]);
  });

  it('keeps everything else as a keptBlock holding its exact source', () => {
    for (const md of [
      '| A | B |\n|---|---|\n| 1 | 2 |',
      '> quoted',
      '```\ncode\n```',
      '<div>x</div>',
      '---',
      '#### deep',
      '    indented',
    ]) {
      const nodes = top(toDoc(md));
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.type).toBe('keptBlock');
      expect(nodes[0]?.attrs?.source).toBe(md);
    }
  });

  it('keeps a block whose markdown the editor would change', () => {
    expect(kinds('a <kbd>Ctrl</kbd> b')).toEqual(['keptBlock']);
    expect(kinds('![alt](https://example.com/a.png)')).toEqual(['keptBlock']);
  });

  // Decision 14: kept in the markdown, shown as plain text. The block stays editable (its tick boxes work); the
  // address is held by a `keptLink` mark, never a `link`.
  it('keeps unsafe links as text, never as a link, in an editable block', () => {
    for (const md of [
      '[x](javascript:alert(1))',
      '[x](data:text/html,hi)',
      '[x](notes/a.md)',
      '[x](//evil.example)',
      'See [the brief](<clients/acme/a brief.md> "Brief") now.',
    ]) {
      const nodes = top(toDoc(md));
      expect(nodes[0]?.type, md).toBe('paragraph');
      expect(JSON.stringify(nodes), md).not.toContain('"type":"link"');
      expect(JSON.stringify(nodes), md).toContain('"type":"keptLink"');
      expect(roundTrip(md), md).toBe(md);
      expect(isFaithful(md), md).toBe(true);
    }
  });

  it('a checklist linking a brain file keeps its tick boxes and its links', () => {
    const md = '## Steps\n\n- [ ] Read the [brief](clients/acme/brief.md)\n- [x] Ring Bob\n- [ ] Send quote';
    expect(kinds(md)).toEqual(['heading', 'taskList']);
    expect(isFaithful(md)).toBe(true);
    expect(countTasks(md)).toBe(3);
    // Ticked through the editor: the link is written back as it was.
    const doc = asEditorJson(toDoc(md));
    const list = top(doc)[1] as JSONContent;
    const first = list.content?.[0] as JSONContent;
    first.attrs = { ...first.attrs, checked: true };
    expect(toMarkdown(doc)).toBe(md.replace('- [ ] Read', '- [x] Read'));
    // Typed into: the link stays a link in the markdown.
    const edited = retextBlock(asEditorJson(toDoc(md)), 1, 'Now read the ');
    expect(toMarkdown(edited)).toContain('[brief](clients/acme/brief.md)');
  });

  it('keeps safe links as link marks', () => {
    const json = JSON.stringify(toDoc('A [link](https://example.com) and [mail](mailto:a@example.com).'));
    expect(json).toContain('"type":"link"');
    expect(json).toContain('https://example.com');
    expect(json).toContain('mailto:a@example.com');
  });

  it('keeps inline code, italic and strike as marks', () => {
    const json = JSON.stringify(toDoc('`c` *i* ~~s~~'));
    for (const mark of ['code', 'italic', 'strike']) expect(json).toContain(`"type":"${mark}"`);
  });

  it('lets inline code sit inside bold, italic and links (common in tasks)', () => {
    for (const md of [
      '**Run `pnpm test` first**',
      '*see `a.md`*',
      '[`code` link](https://example.com)',
      '- **`x`** item',
    ]) {
      const nodes = top(toDoc(md));
      expect(nodes[0]?.type).not.toBe('keptBlock');
      expect(JSON.stringify(nodes)).toContain('"type":"code"');
    }
  });

  it('never lets a kept block into a list item', () => {
    const schema = getSchema(todoDocExtensions());
    const bad = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [textNode('a')] },
                { type: 'keptBlock', attrs: { source: '> q' } },
              ],
            },
          ],
        },
      ],
    };
    expect(() => schema.nodeFromJSON(bad).check()).toThrow();
  });

  it('shows a soft line break as a space', () => {
    const p = top(toDoc('one\ntwo'))[0];
    expect(p?.content?.[0]?.text).toBe('one two');
  });
});

describe('editing one block changes only that block', () => {
  it('rewrites only the edited paragraph', () => {
    const md = 'First para.\n\nSecond para.\n\n\nThird para.';
    const doc = asEditorJson(toDoc(md));
    expect(toMarkdown(retextBlock(doc, 1, 'Changed.'))).toBe('First para.\n\nChanged.\n\n\nThird para.');
  });

  it('rewrites only the edited block in the mixed fixture', () => {
    const doc = asEditorJson(toDoc(MIXED));
    const idx = top(doc).findIndex((n) => n.type === 'heading' && n.attrs?.level === 2);
    const out = toMarkdown(retextBlock(doc, idx, 'What we need'));
    expect(out).toBe(MIXED.replace('## What is needed', '## What we need'));
  });

  it('re-serialises an edited list in brain style and leaves the rest alone', () => {
    const md = 'Intro.\n\n* one\n* two\n\nOutro.';
    const doc = asEditorJson(toDoc(md));
    expect(toMarkdown(retextBlock(doc, 1, 'uno'))).toBe('Intro.\n\n- uno\n- two\n\nOutro.');
  });

  it('keeps a bare web address bare when its paragraph is edited', () => {
    for (const url of ['https://example.com/page', 'http://example.com/a_b?x=1', 'www.example.com/page']) {
      const md = `See ${url} for more.`;
      const doc = asEditorJson(toDoc(md));
      const p = top(doc)[0] as JSONContent;
      const last = p.content?.[p.content.length - 1] as JSONContent;
      last.text = `${last.text?.slice(0, -1)}!`;
      expect(toMarkdown(doc)).toBe(`See ${url} for more!`);
    }
  });

  it('keeps the link written out when a bare address would swallow the words after it', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            textNode('https://example.com/a', [{ type: 'link', attrs: { href: 'https://example.com/a' } }]),
            textNode('bc next'),
          ],
        },
      ],
    };
    const out = toMarkdown(asEditorJson(doc));
    expect(out).toBe('[https://example.com/a](https://example.com/a)bc next');
  });

  it('writes a www. link out when the brain would not link it bare (straight after punctuation)', () => {
    const doc = asEditorJson(toDoc('Site: www.example.com today.'));
    const p = top(doc)[0] as JSONContent;
    const firstText = p.content?.[0] as JSONContent;
    firstText.text = 'Site:';
    expect(toMarkdown(doc)).toBe('Site:[www.example.com](http://www.example.com) today.');
  });

  it('keeps a bare email address bare when its paragraph is edited', () => {
    const doc = asEditorJson(toDoc('Email sam@example.com today.'));
    const p = top(doc)[0] as JSONContent;
    const last = p.content?.[p.content.length - 1] as JSONContent;
    last.text = `${last.text?.slice(0, -1)}!`;
    expect(toMarkdown(doc)).toBe('Email sam@example.com today!');
  });

  it('still writes a link whose words differ from its address, or an address in angle brackets', () => {
    const doc = asEditorJson(toDoc('A [page](https://example.com/page) and <https://example.com/b>.'));
    const p = top(doc)[0] as JSONContent;
    const last = p.content?.[p.content.length - 1] as JSONContent;
    last.text = `${last.text?.slice(0, -1)}!`;
    expect(toMarkdown(doc)).toMatch(
      /^A \[page\]\(https:\/\/example\.com\/page\) and .*https:\/\/example\.com\/b.*!$/,
    );
  });

  it('adding bold to a word changes only that block', () => {
    const md = '# H\n\nPlain words here.\n\nLast.';
    const doc = asEditorJson(toDoc(md));
    const p = top(doc)[1] as JSONContent;
    p.content = [textNode('Plain '), textNode('words', [{ type: 'bold' }]), textNode(' here.')];
    expect(toMarkdown(doc)).toBe('# H\n\nPlain **words** here.\n\nLast.');
  });

  it('a reflowed soft-wrapped paragraph becomes one line only when edited', () => {
    const md = 'a\nb\n\nc\nd';
    const doc = asEditorJson(toDoc(md));
    expect(toMarkdown(doc)).toBe(md);
    expect(toMarkdown(retextBlock(doc, 1, 'c d!'))).toBe('a\nb\n\nc d!');
  });

  it('ticking a task in the document rewrites that list only', () => {
    const md = 'Top.\n\n- [ ] a\n- [x] b\n\nEnd.';
    const doc = asEditorJson(toDoc(md));
    const list = top(doc)[1] as JSONContent;
    (list.content?.[0] as JSONContent).attrs = { ...(list.content?.[0]?.attrs ?? {}), checked: true };
    expect(toMarkdown(doc)).toBe('Top.\n\n- [x] a\n- [x] b\n\nEnd.');
  });

  it('a split block is written fresh, with a blank line between the halves', () => {
    const md = 'Alpha beta.\n\nNext.';
    const doc = asEditorJson(toDoc(md));
    const first = top(doc)[0] as JSONContent;
    const a = { ...structuredClone(first), content: [textNode('Alpha')] };
    const b = { ...structuredClone(first), content: [textNode('beta.')] };
    doc.content = [a, b, ...top(doc).slice(1)];
    expect(toMarkdown(doc)).toBe('Alpha\n\nbeta.\n\nNext.');
  });

  it('keeps a tight separator only between original neighbours', () => {
    const md = 'Steps:\n- one\n- two\n\nEnd.';
    const doc = asEditorJson(toDoc(md));
    expect(toMarkdown(doc)).toBe(md);
    // Edit the paragraph: the list still reads as its own list, so the separator stays as it was.
    expect(toMarkdown(retextBlock(doc, 0, 'Do these:'))).toBe('Do these:\n- one\n- two\n\nEnd.');
  });

  it('ticking in a list of ticks and plain bullets adds no blank line', () => {
    const md = '- [ ] a\n- plain\n- [x] c';
    const doc = asEditorJson(toDoc(md));
    const item = (top(doc)[0] as JSONContent).content?.[0] as JSONContent;
    item.attrs = { ...item.attrs, checked: true };
    expect(toMarkdown(doc)).toBe('- [x] a\n- plain\n- [x] c');
  });

  it('falls back to a blank line where the tight one would join the blocks', () => {
    const md = 'Text\n- one';
    const doc = asEditorJson(toDoc(md));
    // A numbered list from 2 can't interrupt a paragraph, so "Text\n2. one" would read as one paragraph.
    const list = top(doc)[1] as JSONContent;
    doc.content = [
      top(doc)[0] as JSONContent,
      { ...list, type: 'orderedList', attrs: { ...list.attrs, start: 2 } },
    ];
    expect(toMarkdown(doc)).toBe('Text\n\n2. one');
  });

  it('deleting a block joins its neighbours with one blank line', () => {
    const md = 'A\n\n\n\nB\n\nC';
    const doc = asEditorJson(toDoc(md));
    doc.content = [top(doc)[0] as JSONContent, top(doc)[2] as JSONContent];
    expect(toMarkdown(doc)).toBe('A\n\nC');
  });

  it('drops empty paragraphs the editor leaves behind', () => {
    const doc = asEditorJson(toDoc('A\n\nB'));
    doc.content = [
      top(doc)[0] as JSONContent,
      { type: 'paragraph' },
      top(doc)[1] as JSONContent,
      { type: 'paragraph' },
    ];
    expect(toMarkdown(doc)).toBe('A\n\nB');
  });
});

describe('kept blocks survive edits around them', () => {
  const TABLE = '| A | B |\n|---|---|\n| 1 | 2 |';
  const CODE = '```\n- [ ] x\n```';

  it('edits next to a table and code block leave them byte for byte', () => {
    const md = `Before.\n\n${TABLE}\n\nMiddle.\n\n${CODE}\n\nAfter.`;
    const doc = asEditorJson(toDoc(md));
    let edited = retextBlock(doc, 0, 'Before!');
    edited = retextBlock(edited, 2, 'Middle!');
    edited = retextBlock(edited, 4, 'After!');
    expect(toMarkdown(edited)).toBe(`Before!\n\n${TABLE}\n\nMiddle!\n\n${CODE}\n\nAfter!`);
  });

  it('moving a kept block keeps its source', () => {
    const md = `One.\n\n${TABLE}\n\nTwo.`;
    const doc = asEditorJson(toDoc(md));
    const [a, t, b] = top(doc) as [JSONContent, JSONContent, JSONContent];
    doc.content = [t, a, b];
    expect(toMarkdown(doc)).toBe(`${TABLE}\n\nOne.\n\nTwo.`);
  });

  it('deleting a kept block removes exactly it', () => {
    const md = `One.\n\n${TABLE}\n\nTwo.`;
    const doc = asEditorJson(toDoc(md));
    doc.content = [top(doc)[0] as JSONContent, top(doc)[2] as JSONContent];
    expect(toMarkdown(doc)).toBe('One.\n\nTwo.');
  });
});

describe('new content is written in brain style', () => {
  it('writes every offered block and mark the brain way', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [textNode('Plan')] },
        {
          type: 'paragraph',
          content: [
            textNode('Run '),
            textNode('pnpm test', [{ type: 'code' }]),
            textNode(' then '),
            textNode('check', [{ type: 'bold' }]),
            textNode(' the '),
            textNode('site', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
            textNode('.'),
            { type: 'hardBreak' },
            textNode('Next line.'),
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [textNode('one')] },
                {
                  type: 'bulletList',
                  content: [
                    { type: 'listItem', content: [{ type: 'paragraph', content: [textNode('nested')] }] },
                  ],
                },
              ],
            },
            { type: 'listItem', content: [{ type: 'paragraph', content: [textNode('two')] }] },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 1 },
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [textNode('first')] }] },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [textNode('second')] },
                {
                  type: 'bulletList',
                  content: [
                    { type: 'listItem', content: [{ type: 'paragraph', content: [textNode('under')] }] },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [textNode('to do')] }],
            },
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                { type: 'paragraph', content: [textNode('done')] },
                {
                  type: 'taskList',
                  content: [
                    {
                      type: 'taskItem',
                      attrs: { checked: false },
                      content: [{ type: 'paragraph', content: [textNode('sub')] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(toMarkdown(asEditorJson(doc))).toBe(
      [
        '## Plan',
        '',
        'Run `pnpm test` then **check** the [site](https://example.com).  ',
        'Next line.',
        '',
        '- one',
        '  - nested',
        '- two',
        '',
        '1. first',
        '2. second',
        '   - under',
        '',
        '- [ ] to do',
        '- [x] done',
        '  - [ ] sub',
      ].join('\n'),
    );
  });

  it('keeps a numbered list starting number', () => {
    const doc = asEditorJson(toDoc('3. three\n4. four'));
    expect(toMarkdown(retextBlock(doc, 0, 'THREE'))).toBe('3. THREE\n4. four');
  });

  it('does not clutter ordinary text with escapes', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [textNode('a < b -> c & d, snake_case, ~5 days, 50% (ok)')] }],
    };
    expect(toMarkdown(asEditorJson(doc))).toBe('a < b -> c & d, snake_case, ~5 days, 50% (ok)');
  });

  it('leaves markers in the middle of a line as typed', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [textNode('Go '), textNode('now', [{ type: 'bold' }]), textNode(' - then # 2. > done')],
        },
      ],
    };
    expect(toMarkdown(asEditorJson(doc))).toBe('Go **now** - then # 2. > done');
  });

  it('escapes text that would otherwise turn into markdown', () => {
    const para = (t: string): JSONContent => ({
      type: 'doc',
      content: [{ type: 'paragraph', content: [textNode(t)] }],
    });
    const cases: Record<string, string> = {
      '*not bold*': '\\*not bold\\*',
      '_not italic_': '\\_not italic\\_',
      '`tick`': '\\`tick\\`',
      '[x](y)': '\\[x\\](y)',
      '# not heading': '\\# not heading',
      '- not bullet': '\\- not bullet',
      '+ not bullet': '\\+ not bullet',
      '1. not numbered': '1\\. not numbered',
      '> not quote': '\\> not quote',
      '<b>not html</b>': '\\<b>not html\\</b>',
      'a &amp; b': 'a \\&amp; b',
      '~~not struck~~': '\\~\\~not struck\\~\\~',
      'back\\slash': 'back\\slash',
      'back\\*': 'back\\\\\\*',
    };
    for (const [text, expected] of Object.entries(cases)) {
      const out = toMarkdown(asEditorJson(para(text)));
      expect(out).toBe(expected);
      // And it reads back as the same text.
      expect(top(toDoc(out))[0]?.content?.[0]?.text).toBe(text);
    }
  });
});

/** The text of a block, marks dropped, hard breaks as newlines. */
function plain(n: JSONContent | undefined): string {
  if (!n) return '';
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  return (n.content ?? []).map(plain).join('');
}

/** Each top-level block as the reader sees it: its type and, for kept blocks, the exact source. */
function blockShape(md: string): string[] {
  return analyse(md).blocks.map((b) => (b.node ? (b.node.type ?? '?') : `kept:${b.source}`));
}

/** As `blockShape`, without the empty HTML comments written to keep two blocks apart. */
function shapeWithoutBreaks(md: string): string[] {
  return blockShape(md).filter((s) => s !== 'kept:<!-- -->');
}

describe('changed blocks read back the same', () => {
  const one = (node: JSONContent): string => toMarkdown(asEditorJson({ type: 'doc', content: [node] }));

  it('keeps a heading ending in # (closing hashes would be dropped)', () => {
    for (const text of ['Ticket #', 'C# ##', '#', 'Issue #12 #']) {
      const out = one({ type: 'heading', attrs: { level: 2 }, content: [textNode(text)] });
      const back = top(toDoc(out))[0];
      expect(back?.type).toBe('heading');
      expect(plain(back)).toBe(text);
    }
  });

  // The editor's list reader takes letters and Roman numerals as list numbers ("a)", "Dr.", "OK."), so the
  // full stop is escaped instead of every punctuation mark in the paragraph.
  it('keeps a paragraph starting "Dr." or "OK." readable, with one backslash at most', () => {
    for (const text of [
      "Dr. Patel's notes: check the results, then call back - today.",
      'OK. Done.',
      'a) first',
      'I. One',
      'Did. it',
    ]) {
      const out = one({ type: 'paragraph', content: [textNode(text)] });
      const back = top(toDoc(out))[0];
      expect(back?.type).toBe('paragraph');
      expect(plain(back)).toBe(text);
      expect(out.split('\\').length - 1).toBeLessThanOrEqual(1);
    }
  });

  it('writes link destinations with spaces or brackets so they read back the same', () => {
    for (const href of [
      'https://a.com/x)y',
      'https://a.com/a b',
      'https://a.com/(x',
      'https://a.com/a<b>c',
      'https://a.com/a\\_b',
    ]) {
      const out = one({
        type: 'paragraph',
        content: [textNode('lnk', [{ type: 'link', attrs: { href } }]), textNode(' after')],
      });
      const back = top(toDoc(out))[0];
      expect(back?.type).toBe('paragraph');
      expect(plain(back)).toBe('lnk after');
      const link = back?.content?.[0]?.marks?.find((m) => m.type === 'link');
      expect(link?.attrs?.href).toBe(href);
      expect(isSafeHref(String(link?.attrs?.href))).toBe(true);
    }
  });

  it('keeps the spaces at the ends of inline code', () => {
    for (const code of [' x ', ' x', 'x ', '  two  ', ' `tick` ', '   ']) {
      const out = one({
        type: 'paragraph',
        content: [textNode('a '), textNode(code, [{ type: 'code' }]), textNode(' b')],
      });
      const back = top(toDoc(out))[0];
      const c = back?.content?.find((n) => n.marks?.some((m) => m.type === 'code'));
      expect(c?.text).toBe(code);
    }
  });

  it('moves spaces at the edge of bold outside it, keeping the text', () => {
    const out = one({
      type: 'paragraph',
      content: [textNode('bold ', [{ type: 'bold' }]), textNode('after')],
    });
    expect(out).toBe('**bold** after');
    const back = top(toDoc(out))[0];
    expect(plain(back)).toBe('bold after');
    expect(back?.content?.[0]).toMatchObject({ text: 'bold', marks: [{ type: 'bold' }] });
  });

  it('never stores text that reads back differently', () => {
    const texts = [
      'see http://a.com/_x_ now',
      'see https://a.com/x here',
      'Costs £5 & up',
      '1) item',
      '| a | b |',
      '![alt](x)',
      'a\\b and path\\',
      '***',
      '<div>',
      '&amp;',
    ];
    for (const text of texts) {
      const out = one({ type: 'paragraph', content: [textNode(text)] });
      const back = top(toDoc(out))[0];
      expect(back?.type, text).toBe('paragraph');
      expect(plain(back), text).toBe(text);
    }
  });
});

describe('a changed block never changes its neighbours', () => {
  const bullet = (...items: string[]): JSONContent => ({
    type: 'bulletList',
    content: items.map((t) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [textNode(t)] }],
    })),
  });

  it('an edited list keeps its own bullet when it would join the next list', () => {
    const doc = asEditorJson(toDoc('* a\n\n- b'));
    const out = toMarkdown(retextBlock(doc, 0, 'a!'));
    expect(out.endsWith('\n\n- b')).toBe(true);
    expect(blockShape(out)).toEqual(['bulletList', 'bulletList']);
  });

  it('an edited list keeps its own bullet when it would join the list before', () => {
    const doc = asEditorJson(toDoc('- a\n\n* b'));
    expect(toMarkdown(retextBlock(doc, 1, 'b!'))).toBe('- a\n\n* b!');
  });

  it('a new list next to a list picks a different bullet', () => {
    const doc = asEditorJson(toDoc('para\n\n- b'));
    doc.content = [bullet('new'), top(doc)[1] as JSONContent];
    const out = toMarkdown(doc);
    expect(out.endsWith('\n\n- b')).toBe(true);
    expect(blockShape(out)).toEqual(['bulletList', 'bulletList']);
  });

  it('an edited numbered list is kept apart from the next one by an empty comment', () => {
    const doc = asEditorJson(toDoc('1. a\n\npara\n\n1. b'));
    const edited = retextBlock(doc, 0, 'a!');
    edited.content = [top(edited)[0] as JSONContent, top(edited)[2] as JSONContent];
    expect(toMarkdown(edited)).toBe('1. a!\n\n<!-- -->\n\n1. b');
  });

  it('a paragraph turned into a list does not swallow the code block after it', () => {
    const doc = asEditorJson(toDoc('para\n\n    code'));
    doc.content = [bullet('para'), top(doc)[1] as JSONContent];
    const out = toMarkdown(doc);
    expect(out.endsWith('\n\n    code')).toBe(true);
    expect(shapeWithoutBreaks(out)).toEqual(['bulletList', 'kept:    code']);
  });

  it('deleting the block between a list and a code block keeps them apart', () => {
    const doc = asEditorJson(toDoc('- a\n\npara\n\n    code'));
    doc.content = [top(doc)[0] as JSONContent, top(doc)[2] as JSONContent];
    const out = toMarkdown(doc);
    expect(out.startsWith('- a\n\n')).toBe(true);
    expect(out.endsWith('\n\n    code')).toBe(true);
    expect(shapeWithoutBreaks(out)).toEqual(['bulletList', 'kept:    code']);
  });

  it('deleting the block between two untouched lists keeps them two lists', () => {
    const doc = asEditorJson(toDoc('- a\n\npara\n\n- b'));
    doc.content = [top(doc)[0] as JSONContent, top(doc)[2] as JSONContent];
    const out = toMarkdown(doc);
    expect(out.startsWith('- a\n\n')).toBe(true);
    expect(out.endsWith('\n\n- b')).toBe(true);
    expect(shapeWithoutBreaks(out)).toEqual(['bulletList', 'bulletList']);
  });

  it('rewriting any one block leaves every other block reading the same', () => {
    const bodies = [
      '* a\n\n- b\n\n+ c',
      'Intro:\n- a\n- b\n\n    code\n\nEnd.',
      '1. a\n\n1) b\n\n- c\n\n- [ ] d',
      '# H\n\n- a\n  more\n\n  indented para\n\nText.',
      'para\n\n- a\n\n<!-- -->\n\n- b',
    ];
    for (const md of bodies) {
      const doc = asEditorJson(toDoc(md));
      const before = shapeWithoutBreaks(md);
      top(doc).forEach((n, i) => {
        if (n.type === 'keptBlock') return;
        const forced = structuredClone(doc);
        const node = top(forced)[i] as JSONContent;
        node.attrs = { ...node.attrs, md: null };
        const out = toMarkdown(forced);
        expect(shapeWithoutBreaks(out), `${md} / block ${i}`).toEqual(before);
      });
    }
  });
});

describe('isFaithful', () => {
  it('is true for everything the editor can show without loss', () => {
    for (const md of [MIXED, '', 'x', '- a\n  - b', '| A |\n|---|\n| 1 |', '[x](javascript:alert(1))']) {
      expect(isFaithful(md)).toBe(true);
    }
  });

  it('is false when the details would not come back byte for byte', () => {
    expect(isFaithful('  leading space')).toBe(false);
    expect(isFaithful('trailing newline\n')).toBe(false);
    expect(isFaithful('windows\r\nline ends')).toBe(false);
  });

  // A fence that is never closed runs to the end, so anything typed after it would turn into code.
  it('is false when a code fence is never closed', () => {
    expect(isFaithful('para\n\n```\ncode')).toBe(false);
    expect(isFaithful('para\n\n~~~ts\ncode\n```')).toBe(false);
    expect(isFaithful('```\ncode\n```')).toBe(true);
    expect(isFaithful('para\n\n````\ncode\n````')).toBe(true);
    expect(isFaithful('para\n\n    indented code')).toBe(true);
  });
});

describe('in a real editor', () => {
  let editor: Editor | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function open(md: string): Editor {
    editor = new Editor({ extensions: todoDocExtensions(), content: toDoc(md) });
    return editor;
  }

  it('loads and saves the mixed fixture unchanged', () => {
    expect(toMarkdown(open(MIXED).getJSON())).toBe(MIXED);
  });

  it('typing in one paragraph changes only that paragraph', () => {
    const md = 'First.\n\n| A |\n|---|\n| 1 |\n\nSecond.';
    const ed = open(md);
    let pos = -1;
    ed.state.doc.descendants((node, p) => {
      if (node.isText && node.text === 'Second.') pos = p + node.nodeSize;
    });
    ed.chain().setTextSelection(pos).insertContent(' More').run();
    expect(toMarkdown(ed.getJSON())).toBe('First.\n\n| A |\n|---|\n| 1 |\n\nSecond. More');
  });

  it('Enter at the end of a paragraph starts a new block written fresh', () => {
    const md = 'First.\nwrapped\n\nLast.';
    const ed = open(md);
    let pos = -1;
    ed.state.doc.descendants((node, p) => {
      if (node.isText && node.text === 'First. wrapped') pos = p + node.nodeSize;
    });
    ed.chain().setTextSelection(pos).splitBlock().insertContent('New').run();
    expect(toMarkdown(ed.getJSON())).toBe('First.\nwrapped\n\nNew\n\nLast.');
  });

  it('renders kept blocks formatted inside .todo-kept, not editable', () => {
    const ed = open('| A | B |\n|---|---|\n| 1 | 2 |');
    const kept = ed.view.dom.querySelector('.todo-kept');
    expect(kept).not.toBeNull();
    expect(kept?.querySelector('table')).not.toBeNull();
    expect(kept?.getAttribute('contenteditable')).toBe('false');
  });

  it('renders an unsafe link as plain text, never an <a>', () => {
    const ed = open('Do not [click](javascript:alert(1)) this.\n\n- [ ] Read the [brief](clients/a.md)');
    expect(ed.view.dom.querySelector('.todo-kept')).toBeNull();
    expect(ed.view.dom.textContent).toContain('click');
    expect(ed.view.dom.querySelector('a')).toBeNull();
    expect(ed.view.dom.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  });

  it("shows a kept block's tick items as ☐ and ☑, and saves them unchanged", () => {
    const md = '- [ ] a\n- plain\n- [x] c';
    const ed = open(md);
    const kept = ed.view.dom.querySelector('.todo-kept');
    expect(kept?.textContent).toContain('☑Done:  c');
    expect(kept?.querySelector('[aria-hidden="true"]')?.textContent).toBe('☑');
    expect(kept?.querySelector('.visually-hidden')?.textContent).toBe('Done: ');
    expect(kept?.textContent).not.toContain('[x]');
    expect(toMarkdown(ed.getJSON())).toBe(md);
    expect(showTicks('```\n- [ ] code\n```\n- [X] done')).toBe('```\n- [ ] code\n```\n- ☑ done');
  });

  it('renders safe links with a safe rel', () => {
    const ed = open('A [link](https://example.com).');
    const a = ed.view.dom.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  it('shows nothing for a comment-only kept block (the list separator), but saves it unchanged', () => {
    const md = '- a\n\n<!-- -->\n\n* b';
    const el = document.createElement('div');
    const ed = new Editor({ element: el, extensions: todoDocExtensions(), content: toDoc(md) });
    try {
      const kept = [...el.querySelectorAll<HTMLElement>('[data-todo-kept]')];
      expect(kept).toHaveLength(1);
      expect(kept[0]?.hidden).toBe(true);
      expect(kept[0]?.getAttribute('aria-hidden')).toBe('true');
      expect(toMarkdown(ed.getJSON())).toBe(md);
    } finally {
      ed.destroy();
    }
  });

  it('a pasted copy of a kept block keeps its source', () => {
    const md = '> quoted';
    const ed = open(md);
    const html = ed.getHTML();
    const ed2 = new Editor({ extensions: todoDocExtensions(), content: html });
    try {
      expect(toMarkdown(ed2.getJSON())).toBe(md);
    } finally {
      ed2.destroy();
    }
  });
});
