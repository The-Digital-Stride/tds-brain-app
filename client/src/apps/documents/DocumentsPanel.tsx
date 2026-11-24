import type { LibraryItem } from '../../../../shared/contract.ts';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useStore } from '../../store.tsx';
import { artifactWords, validArtifact } from '../shared/artifact-words.ts';
import { DetailActions, focusLibrarySummary } from '../shared/parts.tsx';
import { Thumb } from '../shared/Thumb.tsx';
import { dateWords, sizeWords } from '../shared/words.ts';
import { FORMAT_ICONS } from './icons.ts';
import { chatDraft, typeWords } from './library.ts';
import { docsStore, useDocs } from './store.ts';

/** The right panel for the Documents app: the chosen document and the facts the file itself holds. */
export function DocumentsPanel() {
  const { current: doc } = useDocs();
  const { newChat, deleteFile, hiddenFileIds } = useStore();
  const { dispatch, modes } = useShell();
  // The file opens in the viewer drawer. A floating panel would sit under it, so it closes; a docked one stays.
  const open = (item: LibraryItem) => {
    if (modes.panelOverlays) dispatch({ type: 'set-panel', open: false });
    dispatch({ type: 'open-viewer', viewer: { item } });
  };
  if (!doc || hiddenFileIds.has(doc.id))
    return <p className="dock-empty">Choose a document to see its details.</p>;

  const artifact = validArtifact(doc.artifact);
  return (
    <div className="lib-detail">
      <div className="lib-preview doc-preview">
        <Thumb
          item={doc}
          width={320}
          label={`Preview of ${doc.title}`}
          icon={FORMAT_ICONS[doc.format ?? 'doc']}
          iconSize={32}
        />
      </div>
      <h3 className="lib-name">{doc.title}</h3>
      <p className="lib-file">{doc.name}</p>
      <DetailActions
        item={doc}
        onAsk={() => newChat({ draft: chatDraft([doc]) })}
        onOpen={doc.view ? () => open(doc) : null}
        onDelete={() => {
          deleteFile(doc);
          docsStore.set({ current: null });
          focusLibrarySummary();
        }}
      />
      <dl className="kv">
        <dt>Type</dt>
        <dd>{typeWords(doc.ext)}</dd>
        <dt>Size</dt>
        <dd>{sizeWords(doc.bytes)}</dd>
        <dt>Group</dt>
        <dd>{doc.group}</dd>
        <dt>Changed</dt>
        <dd>{dateWords(doc.modified)}</dd>
        {artifact ? (
          <>
            <dt>Source</dt>
            <dd>{artifactWords(artifact)}</dd>
          </>
        ) : null}
        <dt className="kv-wide">File path</dt>
        <dd className="kv-wide">
          <code className="terminal-cmd">{doc.path}</code>
        </dd>
      </dl>
    </div>
  );
}
