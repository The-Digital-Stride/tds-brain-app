import { librarySearchSource } from '../shared/search.ts';
import { docsStore } from './store.ts';

/** Documents in the global search. Kept out of `ui.ts` so the palette never loads the app's screens. */
export const documentsSearch = librarySearchSource({
  appId: 'documents',
  title: 'Documents',
  kind: 'document',
  icon: 'doc',
  store: docsStore,
});
