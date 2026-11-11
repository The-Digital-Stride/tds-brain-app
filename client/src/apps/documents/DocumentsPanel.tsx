import type { LibraryItem } from '../../../../shared/contract.ts';
import { Icon } from '../../shell/Icon.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useStore } from '../../store.tsx';
import { DetailActions } from '../shared/parts.tsx';
import { dateWords, sizeWords } from '../shared/words.ts';
import { FORMAT_ICONS } from './icons.ts';
import { chatDraft, typeWords } from './library.ts';
import { docsStore, useDocs } from './store.ts';

/** The right panel for the Documents app: the chosen document and the facts the file itself holds. */
export function DocumentsPanel() {
  const { current: doc } = useDocs();
  const { newChat } = useStore();
  const { dispatch, modes } = useShell();
  // A floating panel would hide the file it opens, so it closes; a docked one stays.
  const open = (item: LibraryItem) => {
    docsStore.set({ viewing: item });
    if (modes.panelOverlays) dispatch({ type: 'set-panel', open: false });
  };
  if (!doc) return <p className="dock-empty">Choose a document to see its details.</p>;

  return (
    <div className="lib-detail">
      <div className="lib-preview doc-cover">
        <span className="doc-glyph">
          <Icon name={FORMAT_ICONS[doc.format ?? 'doc']} size={18} />
        </span>
        <h3 className="lib-name">{doc.title}</h3>
        <p className="lib-file">{doc.name}</p>
      </div>
      <DetailActions
        item={doc}
        onAsk={() => newChat({ draft: chatDraft([doc]) })}
        onOpen={doc.view ? () => open(doc) : null}
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
        <dt className="kv-wide">File path</dt>
        <dd className="kv-wide">
          <code className="terminal-cmd">{doc.path}</code>
        </dd>
      </dl>
    </div>
  );
}
