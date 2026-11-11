import { Fold } from '../../shell/Fold.tsx';
import { useStore } from '../../store.tsx';
import { DetailActions, DetailList } from '../shared/parts.tsx';
import { dateWords, sizeWords } from '../shared/words.ts';
import { DOCUMENTS, FORMAT_WORDS, type Format, type LibraryDoc, STATUS_WORDS } from './data.ts';
import { chatDraft, lengthWords } from './library.ts';
import { useDocs } from './store.ts';

/** What the headings inside each kind of file are called. */
const OUTLINE_WORDS: Record<Format, string> = {
  pdf: 'Contents',
  doc: 'Contents',
  sheet: 'Columns',
  deck: 'Sections',
};

/**
 * A sketch of what is inside, under the title on the white card: the first headings of a page, a
 * sheet's ruled grid, or a slide. The grey bars stand for text. It is decoration: the headings are
 * listed in full further down.
 */
function Sketch({ doc }: { doc: LibraryDoc }) {
  if (doc.format === 'sheet') return <span className="doc-sketch doc-grid" aria-hidden="true" />;
  if (doc.format === 'deck') {
    return (
      <span className="doc-sketch doc-slide" aria-hidden="true">
        {doc.outline[0]}
      </span>
    );
  }
  return (
    <span className="doc-sketch" aria-hidden="true">
      {doc.outline.slice(0, 3).map((heading) => (
        <span className="doc-sec" key={heading}>
          <span className="doc-sec-head">{heading}</span>
          <span className="doc-bar" />
          <span className="doc-bar" data-short="true" />
        </span>
      ))}
    </span>
  );
}

/** The right panel for the Documents app: the chosen document, what it is and what is in it. */
export function DocumentsPanel() {
  const s = useDocs();
  const { newChat } = useStore();
  const doc = DOCUMENTS.find((d) => d.id === s.currentId && d.client === s.client);
  if (!doc) return <p className="dock-empty">Choose a document to see its details.</p>;

  return (
    <div className="lib-detail">
      <div className="lib-preview doc-cover">
        <h3 className="lib-name">{doc.title}</h3>
        <p className="lib-file">{doc.name}</p>
        <Sketch doc={doc} />
      </div>
      <ul className="lib-tags" aria-label="Tags">
        {doc.tags.map((tag) => (
          <li key={tag} className="chip">
            {tag}
          </li>
        ))}
      </ul>
      <DetailActions path={doc.path} onAsk={() => newChat({ draft: chatDraft([doc]) })} />
      <dl className="kv">
        <dt>Status</dt>
        <dd>{STATUS_WORDS[doc.status]}</dd>
        <dt>Type</dt>
        <dd>{FORMAT_WORDS[doc.format]}</dd>
        <dt>Length</dt>
        <dd>{lengthWords(doc)}</dd>
        <dt>Size</dt>
        <dd>{sizeWords(doc.bytes)}</dd>
        <dt>Folder</dt>
        <dd>{doc.folder}</dd>
        <dt>Updated</dt>
        <dd>
          {dateWords(doc.updated)}
          <span className="kv-note">by {doc.by}</span>
        </dd>
        <dt className="kv-wide">File path</dt>
        <dd className="kv-wide">
          <code className="terminal-cmd">{doc.path}</code>
        </dd>
      </dl>
      <Fold title={OUTLINE_WORDS[doc.format]} count={doc.outline.length}>
        <DetailList items={doc.outline} empty="No headings." />
      </Fold>
      <Fold title="Goes with" count={doc.related.length}>
        <DetailList items={doc.related} empty="Not linked to anything yet." />
      </Fold>
    </div>
  );
}
