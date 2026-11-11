import { matchesWords, plural, sizeWords } from '../shared/words.ts';
import { FORMAT_WORDS, type Format, type LibraryDoc } from './data.ts';

export type Sort = 'newest' | 'name';

export interface DocFilter {
  client: string;
  query: string;
  format: Format | 'all';
}

/** One client's documents, narrowed by type and by every word of the search (title, file name, tags, folder). */
export function filterDocs(docs: LibraryDoc[], { client, query, format }: DocFilter): LibraryDoc[] {
  return docs.filter((doc) => {
    if (doc.client !== client) return false;
    if (format !== 'all' && doc.format !== format) return false;
    return matchesWords(`${doc.title} ${doc.name} ${doc.tags.join(' ')} ${doc.folder}`, query);
  });
}

/** Newest first (by the day it was last changed, then by title), or A to Z by title. */
export function sortDocs(docs: LibraryDoc[], sort: Sort): LibraryDoc[] {
  const byTitle = (a: LibraryDoc, b: LibraryDoc) => a.title.localeCompare(b.title, 'en-GB');
  return [...docs].sort((a, b) =>
    sort === 'name' ? byTitle(a, b) : b.updated.localeCompare(a.updated) || byTitle(a, b),
  );
}

/** "1 document", "18 documents". */
export function countWords(n: number): string {
  return plural(n, 'document', 'documents');
}

/** "No documents", "1 document, 840 KB", "18 documents, 8.7 MB". */
export function summaryWords(docs: LibraryDoc[]): string {
  if (docs.length === 0) return 'No documents';
  return `${countWords(docs.length)}, ${sizeWords(docs.reduce((sum, d) => sum + d.bytes, 0))}`;
}

/** How long it is, in the unit that suits the format: "12 pages", "1,840 words", "240 rows", "14 slides". */
export function lengthWords(doc: LibraryDoc): string {
  if (doc.format === 'pdf') return plural(doc.length, 'page', 'pages');
  if (doc.format === 'sheet') return plural(doc.length, 'row', 'rows');
  if (doc.format === 'deck') return plural(doc.length, 'slide', 'slides');
  return plural(doc.length, 'word', 'words');
}

/** A row's meta line: "PDF, 12 pages, 840 KB". */
export function metaWords(doc: LibraryDoc): string {
  return `${FORMAT_WORDS[doc.format]}, ${lengthWords(doc)}, ${sizeWords(doc.bytes)}`;
}

/** The message a new chat starts with when it is opened from the library. */
export function chatDraft(docs: LibraryDoc[]): string {
  const [only] = docs;
  if (docs.length === 1 && only) return `Help me with this document: ${only.path}`;
  return `Help me with these ${docs.length} documents:\n${docs.map((d) => `- ${d.path}`).join('\n')}`;
}
