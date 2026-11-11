import { createLibraryStore, type LibraryState, useLibrary } from '../shared/store.ts';
import { type Kind, LIBRARY_CLIENTS } from './data.ts';

/**
 * What the Images app is showing. It lives outside React because the sheet and the panel are
 * mounted in different places in the shell and both need it.
 */
export interface ImagesState extends LibraryState {
  query: string;
  kind: Kind | 'all';
  layout: 'grid' | 'list';
}

const initial = (): ImagesState => ({
  client: LIBRARY_CLIENTS[0]?.slug ?? '',
  query: '',
  kind: 'all',
  layout: 'grid',
  currentId: null,
  ticked: new Set(),
});

export const imagesStore = createLibraryStore(initial);

export function useImages(): ImagesState {
  return useLibrary(imagesStore);
}
