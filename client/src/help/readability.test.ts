import { describe, expect, it } from 'vitest';
import { countSyllables, fkGrade, glossaryTerms, prose, sentences, words } from './readability.ts';

describe('countSyllables', () => {
  const pinned: Record<string, number> = {
    a: 1,
    the: 1,
    make: 1,
    home: 1,
    chat: 1,
    table: 2,
    little: 2,
    people: 2,
    simple: 2,
    claude: 1,
    ready: 2,
    skill: 1,
    created: 3,
    wanted: 2,
    asked: 1,
    opened: 2,
    changes: 2,
    approve: 2,
    document: 3,
    favourite: 3,
    everything: 4, // 'every' counts as 3: a slight over-count, which errs towards a stricter grade
    question: 2,
    area: 3,
    idea: 3,
    quiet: 2,
  };
  for (const [word, n] of Object.entries(pinned)) {
    it(`${word} has ${n}`, () => expect(countSyllables(word)).toBe(n));
  }
});

describe('sentences and words', () => {
  it('splits on full stops, question marks and list lines', () => {
    expect(sentences('One two. Three four? Five\nSix seven')).toEqual([
      'One two.',
      'Three four?',
      'Five',
      'Six seven',
    ]);
  });
  it('counts words, keeping apostrophes together', () => {
    expect(words("Don't stop 3 times")).toEqual(["Don't", 'stop', '3', 'times']);
  });
});

describe('prose', () => {
  it('drops frontmatter, headings, code, images, tables and link targets', () => {
    const md = [
      '---',
      'id: x',
      '---',
      '## Heading',
      'Read the [guide](help:todos) now.',
      '![Alt text](images/a.webp)',
      '| a | b |',
      '|---|---|',
      '```',
      'const x = 1;',
      '```',
      'Press `Enter` to go.',
      '- A **bold** item',
      '1. Numbered item',
    ].join('\n');
    expect(prose(md)).toBe('Read the guide now.\nPress to go.\nA bold item\nNumbered item');
  });
});

describe('fkGrade', () => {
  it('rates a simple passage low', () => {
    const text = 'The cat sat on the mat. The dog ran to the park. We like to play.';
    expect(fkGrade(text)).toBeLessThan(3);
  });
  it('rates a dense passage high', () => {
    const text =
      'Organisational transformation necessitates comprehensive reconsideration of administrative responsibilities, particularly regarding interdepartmental communication infrastructure.';
    expect(fkGrade(text)).toBeGreaterThan(15);
  });
  it('is 0 for empty text', () => {
    expect(fkGrade('')).toBe(0);
  });
});

describe('glossary terms in the reading score', () => {
  const text = 'Every approval needs a favourite helper. Each team member sees the to-dos.';
  const plain = fkGrade(text);

  it('glossaryTerms reads the ### lines only', () => {
    const md =
      '# Glossary\n\nIntro.\n\n### Brain\nThe shared folder.\n\n#### Not a term\n\n### Team member\nSomeone.';
    expect(glossaryTerms(md)).toEqual(['Brain', 'Team member']);
  });
  it('a matching word counts as one syllable (case, plural, hyphen)', () => {
    expect(fkGrade(text, ['approval', 'favourite', 'helper', 'team member', 'to-do'])).toBeLessThan(plain);
    expect(fkGrade('Approvals.', ['Approval'])).toBeCloseTo(fkGrade('Cat.'), 5);
    expect(fkGrade('APPROVAL.', ['approval'])).toBeCloseTo(fkGrade('Cat.'), 5);
    expect(fkGrade('To-dos.', ['to-do'])).toBeCloseTo(fkGrade('Cat.'), 5);
    expect(fkGrade('Team-members.', ['team member'])).toBeLessThan(fkGrade('Team-members.'));
  });
  it('a two-word term counts each of its words as one syllable', () => {
    expect(fkGrade('A team member.', ['team member'])).toBeCloseTo(fkGrade('A cat cat.'), 5);
  });
  it('other words are untouched', () => {
    expect(fkGrade('Unfamiliar vocabulary.', ['approval'])).toBe(fkGrade('Unfamiliar vocabulary.'));
  });
  it('no terms means the old score', () => {
    expect(fkGrade(text, [])).toBe(plain);
  });
});
