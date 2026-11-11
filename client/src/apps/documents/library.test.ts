import { describe, expect, it } from 'vitest';
import type { LibraryDoc } from './data.ts';
import {
  chatDraft,
  countWords,
  filterDocs,
  lengthWords,
  metaWords,
  sortDocs,
  summaryWords,
} from './library.ts';

const doc = (over: Partial<LibraryDoc>): LibraryDoc => ({
  id: 'a',
  client: 'acme-heating',
  folder: 'Reports',
  format: 'pdf',
  title: 'October performance report',
  name: '2026-11-03-october-performance-report.pdf',
  path: 'clients/acme-heating/reports/2026-11-03-october-performance-report.pdf',
  length: 12,
  bytes: 840_000,
  updated: '2026-11-03',
  by: 'Sam Example',
  status: 'final',
  tags: ['monthly', 'leads'],
  outline: ['Summary'],
  related: [],
  ...over,
});

const library = [
  doc({ id: 'a' }),
  doc({
    id: 'b',
    format: 'doc',
    folder: 'Plans',
    title: 'Winter boiler campaign',
    name: 'winter.md',
    tags: ['campaign'],
  }),
  doc({
    id: 'c',
    format: 'sheet',
    folder: 'Notes',
    title: 'Competitor price check',
    name: 'prices.csv',
    tags: ['pricing'],
  }),
  doc({ id: 'd', client: 'northwind', title: 'Website audit', name: 'audit.pdf', tags: ['audit'] }),
];

describe('filterDocs', () => {
  it('keeps one client only', () => {
    expect(filterDocs(library, { client: 'northwind', query: '', format: 'all' }).map((d) => d.id)).toEqual([
      'd',
    ]);
  });

  it('narrows by type', () => {
    const ids = filterDocs(library, { client: 'acme-heating', query: '', format: 'sheet' }).map((d) => d.id);
    expect(ids).toEqual(['c']);
  });

  it('matches every word of the search in the title, file name, tags or folder, whatever the case', () => {
    const find = (query: string) =>
      filterDocs(library, { client: 'acme-heating', query, format: 'all' }).map((d) => d.id);
    expect(find('WINTER')).toEqual(['b']);
    expect(find('prices.csv')).toEqual(['c']);
    expect(find('monthly report')).toEqual(['a']);
    expect(find('plans')).toEqual(['b']);
    expect(find('winter pricing')).toEqual([]);
    expect(find('  ')).toEqual(['a', 'b', 'c']);
  });
});

describe('sortDocs', () => {
  const docs = [
    doc({ id: 'old', title: 'Audit', updated: '2026-09-15' }),
    doc({ id: 'new-z', title: 'Zebra plan', updated: '2026-11-06' }),
    doc({ id: 'new-a', title: 'Apple plan', updated: '2026-11-06' }),
  ];

  it('puts the latest change first, and the same day in title order', () => {
    expect(sortDocs(docs, 'newest').map((d) => d.id)).toEqual(['new-a', 'new-z', 'old']);
  });

  it('sorts A to Z by title', () => {
    expect(sortDocs(docs, 'name').map((d) => d.id)).toEqual(['new-a', 'old', 'new-z']);
  });

  it('leaves the list it was given as it was', () => {
    sortDocs(docs, 'name');
    expect(docs.map((d) => d.id)).toEqual(['old', 'new-z', 'new-a']);
  });
});

describe('the words', () => {
  it('counts documents', () => {
    expect(countWords(1)).toBe('1 document');
    expect(countWords(18)).toBe('18 documents');
  });

  it('sums up what is shown', () => {
    expect(summaryWords([])).toBe('No documents');
    expect(summaryWords([doc({})])).toBe('1 document, 840 KB');
    expect(summaryWords([doc({}), doc({ bytes: 2_300_000 })])).toBe('2 documents, 3.1 MB');
  });

  it('gives the length in the unit that suits the file', () => {
    expect(lengthWords(doc({ format: 'pdf', length: 1 }))).toBe('1 page');
    expect(lengthWords(doc({ format: 'pdf', length: 12 }))).toBe('12 pages');
    expect(lengthWords(doc({ format: 'doc', length: 1840 }))).toBe('1,840 words');
    expect(lengthWords(doc({ format: 'sheet', length: 240 }))).toBe('240 rows');
    expect(lengthWords(doc({ format: 'deck', length: 14 }))).toBe('14 slides');
  });

  it('writes a row’s meta line', () => {
    expect(metaWords(doc({}))).toBe('PDF, 12 pages, 840 KB');
  });

  it('drafts a chat that names each file', () => {
    expect(chatDraft([doc({})])).toBe(
      'Help me with this document: clients/acme-heating/reports/2026-11-03-october-performance-report.pdf',
    );
    expect(chatDraft([doc({ path: 'x/a.pdf' }), doc({ path: 'x/b.md' })])).toBe(
      'Help me with these 2 documents:\n- x/a.pdf\n- x/b.md',
    );
  });
});
