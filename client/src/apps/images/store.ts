import { createLibraryStore, type LibraryState, useLibrary } from '../shared/store.ts';

/**
 * What the Images app is showing. It lives outside React because the sheet and the panel are
 * mounted in different places in the shell and both need it.
 */
export interface ImagesState extends LibraryState {
  query: string;
  layout: 'grid' | 'list';
}

const initial = (): ImagesState => ({
  scope: '',
  query: '',
  layout: 'grid',
  current: null,
  viewing: null,
  ticked: new Set(),
});

export const imagesStore = createLibraryStore(initial);

export function useImages(): ImagesState {
  return useLibrary(imagesStore);
}
