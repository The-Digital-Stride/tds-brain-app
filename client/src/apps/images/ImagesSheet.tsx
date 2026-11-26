import type { LibraryItem } from '../../../../shared/contract.ts';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useStore } from '../../store.tsx';
import { useKeepCurrent, useLibraryData } from '../shared/data.ts';
import { LibraryBrowser } from '../shared/LibraryBrowser.tsx';
import { useSheetUpload } from '../shared/upload.tsx';
import { IMAGES } from './kind.tsx';
import { chatDraft } from './library.ts';
import { type ImagesState, imagesStore, useImages } from './store.ts';

/** The Images app: the images in one library, by folder, as a grid or a list. */
export function ImagesSheet() {
  const s = useImages();
  const { state, dispatch } = useShell();
  const { newChat } = useStore();
  const data = useLibraryData(imagesStore, 'image');
  // A file just uploaded is chosen (its details show in the panel) and brought into view.
  const up = useSheetUpload(data, (item) => imagesStore.set({ current: item }), s.current?.id);
  useKeepCurrent(imagesStore, data);

  const open = (image: LibraryItem) => {
    imagesStore.set({ current: image });
    if (!state.panelOpen) dispatch({ type: 'set-panel', open: true });
  };

  // A file opens in the viewer drawer over the right of the page, the same everywhere in the app.
  const view = (image: LibraryItem) => {
    imagesStore.set({ current: image });
    dispatch({ type: 'open-viewer', viewer: { item: image, place: data.scopeName || undefined } });
  };

  return (
    <LibraryBrowser
      spec={IMAGES}
      view={s}
      onView={(patch) => imagesStore.set(patch as Partial<ImagesState>)}
      data={data}
      pickers={{
        scopes: data.scopes,
        scope: data.scope,
        onScope: (scope) => imagesStore.set({ scope }),
        project: s.project ?? '',
        onProject: (project) => imagesStore.set({ project }),
      }}
      onChoose={open}
      onOpen={view}
      actions={up.actions}
      upload={up.status}
      selection={{ onAsk: (picked) => newChat({ draft: chatDraft(picked) }) }}
    />
  );
}
