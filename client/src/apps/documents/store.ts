import { createLibraryStore, type LibraryState, useLibrary } from '../shared/store.ts';
import { DOC_CLIENTS, type Format } from './data.ts';
import type { Sort } from './library.ts';

/** What the Documents app is showing; shared by its sheet and its panel. */
export interface DocsState extends LibraryState {
  query: string;
  format: Format | 'all';
  sort: Sort;
}

const initial = (): DocsState => ({
  client: DOC_CLIENTS[0]?.slug ?? '',
  query: '',
  format: 'all',
  sort: 'newest',
  currentId: null,
  ticked: new Set(),
});

export const docsStore = createLibraryStore(initial);

export function useDocs(): DocsState {
  return useLibrary(docsStore);
}
