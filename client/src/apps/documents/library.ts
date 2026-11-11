import type { DocFormat, LibraryItem } from '../../../../shared/contract.ts';
import { matchesWords, plural, sizeWords } from '../shared/words.ts';

export type Sort = 'newest' | 'name';

/** What a file is called on screen, by extension. An extension not listed shows as itself in capitals. */
const TYPE_WORDS: Record<string, string> = {
  pdf: 'PDF',
  md: 'Markdown',
  txt: 'Text',
  docx: 'Word',
  html: 'HTML page',
  htm: 'HTML page',
  csv: 'CSV',
  xlsx: 'Excel',
  pptx: 'PowerPoint',
};

export function typeWords(ext: string): string {
  return TYPE_WORDS[ext.toLowerCase()] ?? ext.toUpperCase();
}

export interface DocFilter {
  query: string;
  format: DocFormat | 'all';
}

/** The documents of one kind that match every word of the search (title, file name or card), whatever the case. */
export function filterDocs(docs: LibraryItem[], { query, format }: DocFilter): LibraryItem[] {
  return docs.filter((doc) => {
    if (format !== 'all' && doc.format !== format) return false;
    return matchesWords(`${doc.title} ${doc.name} ${doc.group}`, query);
  });
}

/** Newest first (by when the file changed, then by title), or A to Z by title. */
export function sortDocs(docs: LibraryItem[], sort: Sort): LibraryItem[] {
  const byTitle = (a: LibraryItem, b: LibraryItem) => a.title.localeCompare(b.title, 'en-GB');
  const time = (d: LibraryItem) => Date.parse(d.modified) || 0;
  return [...docs].sort((a, b) => (sort === 'name' ? byTitle(a, b) : time(b) - time(a) || byTitle(a, b)));
}

/** "1 document", "18 documents". */
export function countWords(n: number): string {
  return plural(n, 'document', 'documents');
}

/** "No documents", "1 document, 840 KB", "18 documents, 8.7 MB". */
export function summaryWords(docs: LibraryItem[]): string {
  if (docs.length === 0) return 'No documents';
  return `${countWords(docs.length)}, ${sizeWords(docs.reduce((sum, d) => sum + d.bytes, 0))}`;
}

/** A row's meta line: "PDF, 840 KB". */
export function metaWords(doc: LibraryItem): string {
  return `${typeWords(doc.ext)}, ${sizeWords(doc.bytes)}`;
}

/** The message a new chat starts with when it is opened from the library. */
export function chatDraft(docs: LibraryItem[]): string {
  const [only] = docs;
  if (docs.length === 1 && only) return `Help me with this document: ${only.path}`;
  return `Help me with these ${docs.length} documents:\n${docs.map((d) => `- ${d.path}`).join('\n')}`;
}
