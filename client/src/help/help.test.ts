/**
 * The help standard's checks, run over every real page in /help (docs/help-standard.md section 6).
 * Reads the folder from disk, not through the bundler glob, so a bad page is reported here by name.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Role } from '../../../shared/contract.ts';
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
import { helpForContext } from './context.ts';
import { HELP_GLOSSARY_TERMS, type HelpContext, type HelpShot, type HelpTopic } from './contract.ts';
import { parseHelpFile } from './frontmatter.ts';
import { createHelpLibrary } from './library.ts';
import { glossaryTerms } from './readability.ts';
import { HELP_TOPIC_IDS } from './topics.ts';
import { helpVisible } from './visibility.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const HELP_DIR = join(ROOT, 'help');
const SRC_DIR = join(ROOT, 'client/src');

const fileNames = existsSync(HELP_DIR) ? readdirSync(HELP_DIR).filter((f) => f.endsWith('.md')) : [];
const topics: HelpTopic[] = [];
const parseErrors: string[] = [];
for (const f of fileNames) {
  const r = parseHelpFile(f, readFileSync(join(HELP_DIR, f), 'utf8'));
  if (r.ok) topics.push(r.topic);
  else parseErrors.push(...r.errors);
}
const ids = topics.map((t) => t.id);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (p !== join(SRC_DIR, 'help')) walk(p, out);
    } else if (/\.(ts|tsx|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const appText = walk(SRC_DIR)
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');

const glossaryPath = join(HELP_DIR, 'glossary.md');
const glossaryText = existsSync(glossaryPath) ? readFileSync(glossaryPath, 'utf8') : '';
const terms = glossaryTerms(glossaryText);

const IMAGE_DIR = join(HELP_DIR, 'images');
const imageFiles = new Map<string, { bytes: number }>();
if (existsSync(IMAGE_DIR))
  for (const f of readdirSync(IMAGE_DIR))
    if (f.endsWith('.webp')) imageFiles.set(f, { bytes: statSync(join(IMAGE_DIR, f)).size });
const shotsPath = join(HELP_DIR, 'shots.json');
const shots: HelpShot[] = existsSync(shotsPath)
  ? (JSON.parse(readFileSync(shotsPath, 'utf8')) as HelpShot[])
  : [];

describe('help pages', () => {
  it('every file has valid frontmatter', () => expect(parseErrors).toEqual([]));
  it('every page id is in topics.ts and back', () => expect(checkTopicIds(ids, HELP_TOPIC_IDS)).toEqual([]));

  const each = (name: string, check: (t: HelpTopic) => string[]) =>
    it(name, () => expect(topics.flatMap(check)).toEqual([]));
  each('has the standard headings in order', checkHeadings);
  each('keeps every sentence short', checkSentences);
  each('is the right length', checkLength);
  each('reads at grade 9 or lower (glossary words count as one syllable)', (t) => checkGrade(t, terms));
  it('the glossary has no more than 25 terms', () => expect(checkGlossary(glossaryText)).toEqual([]));
  it('the glossary defines exactly the fixed terms (changing them needs a plan change)', () =>
    expect(terms.map((t) => t.toLowerCase())).toEqual(HELP_GLOSSARY_TERMS.map((t) => t.toLowerCase())));
  each('uses UK spelling', checkSpelling);
  each('avoids banned jargon', checkJargon);
  each('only bolds labels that exist in the app', (t) => checkBoldLabels(t, appText));
  each('relates only to pages that exist', (t) => checkRelated(t, ids));
  each('uses pictures that exist, are small and match shots.json', (t) => checkImages(t, imageFiles, shots));
});

describe('help contexts', () => {
  const library = createHelpLibrary(topics);
  const ctx = (over: Partial<HelpContext>): HelpContext => ({
    view: 'home',
    drawer: null,
    waiting: false,
    ...over,
  });
  const rows: [string, HelpContext, string][] = [
    ['chats drawer', ctx({ drawer: 'chats' }), 'chats-drawer'],
    ['todos drawer', ctx({ drawer: 'todos' }), 'todos'],
    ['skills drawer', ctx({ drawer: 'skills' }), 'skills'],
    ['waiting chat', ctx({ view: 'chat', waiting: true }), 'approvals-and-questions'],
    ['home', ctx({ view: 'home' }), 'home'],
    ['chat', ctx({ view: 'chat' }), 'talking-to-claude'],
    ['documents', ctx({ view: 'app:documents' }), 'documents'],
    ['images', ctx({ view: 'app:images' }), 'images'],
  ];
  for (const [name, c, id] of rows)
    it(`${name} opens ${id}`, () => expect(helpForContext(c, library)).toBe(id));
  it('the fallback page exists', () => expect(library.byId('welcome')).toBeDefined());
});

describe('who sees help', () => {
  it('is shown to every role', () => {
    for (const role of ['owner', 'scout', 'team', 'unknown'] as Role[]) expect(helpVisible(role)).toBe(true);
  });
});
