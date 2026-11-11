import { describe, expect, it } from 'vitest';
import { doc } from '../shared/testing.ts';
import {
  chatDraft,
  countWords,
  filterDocs,
  metaWords,
  sortDocs,
  summaryWords,
  typeWords,
} from './library.ts';

describe('typeWords', () => {
  it('names each kind of file by its extension', () => {
    const words = ['pdf', 'md', 'txt', 'docx', 'html', 'htm', 'csv', 'xlsx', 'pptx'].map(typeWords);
    expect(words).toEqual([
      'PDF',
      'Markdown',
      'Text',
      'Word',
      'HTML page',
      'HTML page',
      'CSV',
      'Excel',
      'PowerPoint',
    ]);
  });

  it('shows an unknown extension as itself in capitals, whatever its case', () => {
    expect(typeWords('rtf')).toBe('RTF');
    expect(typeWords('PDF')).toBe('PDF');
  });
});

describe('filterDocs', () => {
  const library = [
    doc({ id: 'a' }),
    doc({
      id: 'b',
      format: 'doc',
      ext: 'md',
      group: 'Plans',
      title: 'Winter boiler campaign',
      name: 'winter.md',
    }),
    doc({
      id: 'c',
      format: 'sheet',
      ext: 'csv',
      group: 'Notes',
      title: 'Competitor prices',
      name: 'prices.csv',
    }),
  ];

  it('narrows by type from the format', () => {
    expect(filterDocs(library, { query: '', format: 'sheet' }).map((d) => d.id)).toEqual(['c']);
    expect(filterDocs(library, { query: '', format: 'all' })).toHaveLength(3);
  });

  it('matches every word in the title, file name or card, whatever the case', () => {
    const find = (query: string) => filterDocs(library, { query, format: 'all' }).map((d) => d.id);
    expect(find('WINTER')).toEqual(['b']);
    expect(find('prices.csv')).toEqual(['c']);
    expect(find('reports')).toEqual(['a']);
    expect(find('winter prices')).toEqual([]);
    expect(find('  ')).toEqual(['a', 'b', 'c']);
  });
});

describe('sortDocs', () => {
  const docs = [
    doc({ id: 'old', title: 'Beta', modified: '2026-09-01T09:00:00.000Z' }),
    doc({ id: 'new-z', title: 'Zulu', modified: '2026-11-03T09:00:00.000Z' }),
    doc({ id: 'new-a', title: 'Alpha', modified: '2026-11-03T09:00:00.000Z' }),
  ];

  it('puts the newest first, then by title', () => {
    expect(sortDocs(docs, 'newest').map((d) => d.id)).toEqual(['new-a', 'new-z', 'old']);
  });

  it('sorts A to Z by title', () => {
    expect(sortDocs(docs, 'name').map((d) => d.id)).toEqual(['new-a', 'old', 'new-z']);
  });

  it('leaves the list it was given alone', () => {
    const before = docs.map((d) => d.id);
    sortDocs(docs, 'name');
    expect(docs.map((d) => d.id)).toEqual(before);
  });
});

describe('words', () => {
  it('summarises a list', () => {
    expect(summaryWords([])).toBe('No documents');
    expect(summaryWords([doc()])).toBe('1 document, 840 KB');
    expect(countWords(18)).toBe('18 documents');
  });

  it('a row meta line is the type and the size', () => {
    expect(metaWords(doc())).toBe('PDF, 840 KB');
    expect(metaWords(doc({ ext: 'md', bytes: 3000 }))).toBe('Markdown, 3 KB');
  });

  it('drafts a chat message that names each file by its path', () => {
    expect(chatDraft([doc()])).toBe(
      'Help me with this document: clients/acme/reports/2026-11-03-october-report.pdf',
    );
    expect(chatDraft([doc(), doc({ path: 'clients/acme/plans/p.md' })])).toBe(
      'Help me with these 2 documents:\n- clients/acme/reports/2026-11-03-october-report.pdf\n- clients/acme/plans/p.md',
    );
  });
});
