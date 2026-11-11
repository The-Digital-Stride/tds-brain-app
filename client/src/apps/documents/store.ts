import type { DocFormat } from '../../../../shared/contract.ts';
import { createLibraryStore, type LibraryState, useLibrary } from '../shared/store.ts';
import type { Sort } from './library.ts';

/** What the Documents app is showing; shared by its sheet and its panel. */
export interface DocsState extends LibraryState {
  query: string;
  format: DocFormat | 'all';
  sort: Sort;
  /** List by default: about half the documents are notes with no picture. */
  layout: 'grid' | 'list';
}

const initial = (): DocsState => ({
  scope: '',
  query: '',
  format: 'all',
  sort: 'newest',
  layout: 'list',
  current: null,
  viewing: null,
  ticked: new Set(),
});

export const docsStore = createLibraryStore(initial);

export function useDocs(): DocsState {
  return useLibrary(docsStore);
}
