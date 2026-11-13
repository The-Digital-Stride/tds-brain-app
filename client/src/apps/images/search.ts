import { librarySearchSource } from '../shared/search.ts';
import { imagesStore } from './store.ts';

/** Images in the global search. Kept out of `ui.ts` so the palette never loads the app's screens. */
export const imagesSearch = librarySearchSource({
  appId: 'images',
  title: 'Images',
  kind: 'image',
  icon: 'image',
  store: imagesStore,
});
