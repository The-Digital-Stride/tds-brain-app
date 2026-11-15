import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkBoldLabels,
  checkGlossary,
  checkGrade,
  checkHeadings,
  checkImages,
  checkJargon,
  checkLength,
  checkRelated,
  checkSentences,
  checkSpelling,
  checkTopicIds,
} from './checks.ts';
import type { HelpShot, HelpTopic } from './contract.ts';
import { parseHelpFile } from './frontmatter.ts';

const raw = readFileSync(new URL('./__fixtures__/good.md', import.meta.url), 'utf8');
const parsed = parseHelpFile('good.md', raw);
if (!parsed.ok) throw new Error(parsed.errors.join());
const good: HelpTopic = parsed.topic;
const withBody = (body: string, over: Partial<HelpTopic> = {}): HelpTopic => ({ ...good, ...over, body });
const replaceIn = (from: string, to: string) => withBody(good.body.replace(from, to));

const shot: HelpShot = { id: 'good', scene: 's', crop: '.x', alt: 'The chat with a Save it button' };
const files = new Map([['good.webp', { bytes: 1000 }]]);

describe('the good fixture passes everything', () => {
  it('has no problems', () => {
    expect(checkHeadings(good)).toEqual([]);
    expect(checkSentences(good)).toEqual([]);
    expect(checkLength(good)).toEqual([]);
    expect(checkGrade(good)).toEqual([]);
    expect(checkSpelling(good)).toEqual([]);
    expect(checkJargon(good)).toEqual([]);
    expect(checkBoldLabels(good, 'Save it')).toEqual([]);
    expect(checkRelated(good, ['other'])).toEqual([]);
    expect(checkImages(good, files, [shot])).toEqual([]);
  });
});

describe('checkTopicIds', () => {
  it('fails both ways', () => {
    expect(checkTopicIds(['a', 'b'], ['a', 'c'])).toEqual([
      expect.stringContaining('"b" is not listed'),
      expect.stringContaining('"c" but help/c.md'),
    ]);
    expect(checkTopicIds(['a'], ['a'])).toEqual([]);
  });
});

describe('checkHeadings', () => {
  it('fails on a wrong order, a missing required heading and an extra one', () => {
    expect(checkHeadings(replaceIn('## Why it helps', '## Benefits'))).toHaveLength(1);
    expect(checkHeadings(withBody(good.body.replace('## How to use it', '## Steps')))).toHaveLength(1);
    expect(checkHeadings(withBody(`${good.body}\n## Extra\nMore.`))).toHaveLength(1);
  });
  it('allows the last two to be left out', () => {
    expect(checkHeadings(withBody(good.body.slice(0, good.body.indexOf('## Good to know'))))).toEqual([]);
  });
  it('skips free-form areas', () => {
    expect(checkHeadings(withBody('## Anything', { area: 'getting-started' }))).toEqual([]);
    // The glossary and "Fixing problems" are free-form by page; getting-help is not.
    expect(checkHeadings(withBody('## Anything', { id: 'glossary', area: 'help' }))).toEqual([]);
    expect(checkHeadings(withBody('## Anything', { id: 'fixing-problems', area: 'help' }))).toEqual([]);
    expect(checkHeadings(withBody('## Anything', { id: 'getting-help', area: 'help' }))).toHaveLength(1);
  });
});

describe('checkSentences', () => {
  it('fails on a sentence over 25 words', () => {
    const long = `${'word '.repeat(26).trim()}.`;
    expect(checkSentences(replaceIn('Open the chat you want to keep.', long))).toHaveLength(1);
  });
});

describe('checkLength', () => {
  it('fails when too short or too long, not for free-form pages', () => {
    expect(checkLength(withBody('## What it does\nShort.'))).toHaveLength(1);
    expect(checkLength(withBody(`${good.body}\n${'More words here. '.repeat(100)}`))).toHaveLength(1);
    expect(checkLength(withBody('Short.', { area: 'getting-started' }))).toEqual([]);
    expect(checkLength(withBody('Short.', { id: 'glossary', area: 'help' }))).toEqual([]);
    expect(checkLength(withBody('Short.', { id: 'getting-help', area: 'help' }))).toHaveLength(1);
  });
});

describe('checkGrade', () => {
  it('fails on dense prose', () => {
    const dense =
      'Organisational transformation necessitates comprehensive reconsideration of administrative responsibilities, particularly regarding interdepartmental communication infrastructure.';
    expect(checkGrade(withBody(`${good.body}\n\n${dense} ${dense}`))).toHaveLength(1);
  });
});

describe('checkSpelling', () => {
  it('fails on US spellings, whole words only, ignoring code', () => {
    expect(checkSpelling(replaceIn('safe', 'Color'))).toEqual([expect.stringContaining('"color"')]);
    expect(checkSpelling(replaceIn('safe', 'colourful'))).toEqual([]);
    expect(checkSpelling(replaceIn('safe', '`color`'))).toEqual([]);
    expect(checkSpelling(replaceIn('safe', 'organize'))).toHaveLength(1);
  });
});

describe('checkJargon', () => {
  it('fails on banned words and Brain app', () => {
    expect(checkJargon(replaceIn('safe', 'API'))).toHaveLength(1);
    expect(checkJargon(replaceIn('safe', 'the repo'))).toHaveLength(1);
    expect(checkJargon(replaceIn('safe', 'the Brain app'))).toHaveLength(1);
    expect(checkJargon(replaceIn('safe', 'a token'))).toHaveLength(1);
  });
  it('lets token through for how full a chat is, and ignores code and longer words', () => {
    expect(checkJargon(replaceIn('safe', 'a token shows how full a chat is'))).toEqual([]);
    expect(checkJargon(replaceIn('safe', '`API`'))).toEqual([]);
    expect(checkJargon(replaceIn('safe', 'repository'))).toEqual([]);
  });
});

describe('checkBoldLabels', () => {
  it('fails when a bold label is not in the app', () => {
    expect(checkBoldLabels(good, 'Something else')).toEqual([expect.stringContaining('"Save it"')]);
  });
  it('matches curly and straight apostrophes, and allows keyboard words', () => {
    const t = withBody('**Don’t allow** and **Esc** and **H**');
    expect(checkBoldLabels(t, "label: 'Don\\'t allow'")).toEqual([]);
  });
  it('ignores bold sentences', () => {
    expect(
      checkBoldLabels(withBody('**This is a long bold sentence, with many more than six words.**'), ''),
    ).toEqual([]);
  });
});

describe('checkRelated', () => {
  it('fails on an unknown page', () => {
    expect(checkRelated(good, [])).toEqual([expect.stringContaining('"other"')]);
  });
});

describe('checkImages', () => {
  it('fails when the file is missing', () => {
    expect(checkImages(good, new Map(), [shot])).toEqual([expect.stringContaining('does not exist')]);
  });
  it('fails without alt text', () => {
    expect(checkImages(replaceIn('![The chat with a Save it button]', '![]'), files, [shot])).toEqual([
      expect.stringContaining('no alt text'),
    ]);
  });
  it('fails when the shot is not listed or its alt differs', () => {
    expect(checkImages(good, files, [])).toEqual([expect.stringContaining('not listed')]);
    expect(checkImages(good, files, [{ ...shot, alt: 'Different' }])).toEqual([
      expect.stringContaining('differs'),
    ]);
  });
  it('fails when the file is too big', () => {
    expect(checkImages(good, new Map([['good.webp', { bytes: 200 * 1024 }]]), [shot])).toEqual([
      expect.stringContaining('limit'),
    ]);
  });
  it('fails with more than 4 callouts', () => {
    const callouts = [1, 2, 3, 4, 5].map((n) => ({ n, target: '.x' }));
    expect(checkImages(good, files, [{ ...shot, callouts }])).toEqual([expect.stringContaining('callouts')]);
  });
  it('fails on a path outside images/', () => {
    expect(checkImages(replaceIn('images/good.webp', 'pics/good.png'), files, [shot])).toHaveLength(1);
  });
  it('passes trivially with no images', () => {
    expect(checkImages(withBody('No pictures here.'), new Map(), [])).toEqual([]);
  });
});

describe('free-form pages are still checked for the rest', () => {
  const dense =
    'Notwithstanding administrative reorganisation, interdepartmental communication deteriorated.';
  it('reading grade, spelling and jargon', () => {
    const t = (body: string) => withBody(body, { id: 'glossary', area: 'help' });
    expect(checkGrade(t(`${dense} ${dense} ${dense}`))).toHaveLength(1);
    expect(checkSpelling(t('A color.'))).toHaveLength(1);
    expect(checkJargon(t('The API.'))).toHaveLength(1);
  });
});

describe('checkGrade with glossary terms', () => {
  it('leaves glossary words out of the score, so a page of them passes', () => {
    const line = 'The authorisation and the administration committee.\n';
    const page = withBody(line.repeat(40));
    expect(checkGrade(page)).toHaveLength(1);
    expect(checkGrade(page, ['authorisation', 'administration', 'committee'])).toEqual([]);
  });
});

describe('checkGlossary', () => {
  const md = (n: number) => Array.from({ length: n }, (_, i) => `### Term${i}\nMeaning.`).join('\n\n');
  it('passes 25 terms and fails 26', () => {
    expect(checkGlossary(md(25))).toEqual([]);
    expect(checkGlossary(md(26))).toHaveLength(1);
    expect(checkGlossary(md(26))[0]).toContain('26');
  });
});

describe('checkJargon: token', () => {
  it('is allowed for how full a chat is, Tokens saved and the glossary', () => {
    expect(checkJargon(withBody('See how full it is. A token is small.'))).toEqual([]);
    expect(checkJargon(withBody('Open Tokens saved in Settings. A token is small.'))).toEqual([]);
    expect(
      checkJargon(withBody('### Token\nA small piece of text.', { id: 'glossary', area: 'help' })),
    ).toEqual([]);
  });
  it('is still banned elsewhere', () => {
    expect(checkJargon(withBody('A token is small.'))).toHaveLength(1);
  });
});
