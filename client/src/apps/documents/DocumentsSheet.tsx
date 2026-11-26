import type { LibraryItem } from '../../../../shared/contract.ts';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useKeepCurrent, useLibraryData } from '../shared/data.ts';
import { LibraryBrowser } from '../shared/LibraryBrowser.tsx';
import { useSheetUpload } from '../shared/upload.tsx';
import { DOCUMENTS } from './kind.tsx';
import { type DocsState, docsStore, useDocs } from './store.ts';

/** The Documents app: the documents in one library, by folder, newest first or A to Z. */
export function DocumentsSheet() {
  const s = useDocs();
  const { state, dispatch } = useShell();
  const data = useLibraryData(docsStore, 'document');
  const up = useSheetUpload(data);
  useKeepCurrent(docsStore, data);

  const open = (doc: LibraryItem) => {
    docsStore.set({ current: doc });
    if (!state.panelOpen) dispatch({ type: 'set-panel', open: true });
  };

  // A file opens in the viewer drawer over the right of the page, the same everywhere in the app.
  const view = (doc: LibraryItem) => {
    docsStore.set({ current: doc });
    dispatch({ type: 'open-viewer', viewer: { item: doc, place: data.scopeName || undefined } });
  };

  return (
    <LibraryBrowser
      spec={DOCUMENTS}
      view={s}
      onView={(patch) => docsStore.set(patch as Partial<DocsState>)}
      data={data}
      pickers={{
        scopes: data.scopes,
        scope: data.scope,
        onScope: (scope) => docsStore.set({ scope }),
        project: s.project ?? '',
        onProject: (project) => docsStore.set({ project }),
      }}
      onChoose={open}
      onOpen={view}
      actions={up.actions}
      upload={up.status}
    />
  );
}
