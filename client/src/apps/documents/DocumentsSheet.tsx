import { useMemo, useRef } from 'react';
import type { IconName } from '../../shell/contract.ts';
import { Icon } from '../../shell/Icon.tsx';
import { Seg } from '../../shell/Seg.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useStore } from '../../store.tsx';
import { useCopy } from '../shared/copy.ts';
import { DetailsButton, FolderCard, LibraryTools, SelectionBar } from '../shared/parts.tsx';
import { dateWords, groupByFolder, selectionWords } from '../shared/words.ts';
import { DOC_CLIENTS, DOC_FOLDERS, DOCUMENTS, type Format, type LibraryDoc, STATUS_WORDS } from './data.ts';
import {
  chatDraft,
  countWords,
  filterDocs,
  metaWords,
  type Sort,
  sortDocs,
  summaryWords,
} from './library.ts';
import { docsStore, useDocs } from './store.ts';

const FORMATS: { value: Format | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'doc', label: 'Docs' },
  { value: 'sheet', label: 'Sheets' },
  { value: 'deck', label: 'Decks' },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'A to Z' },
];

export const FORMAT_ICONS: Record<Format, IconName> = {
  pdf: 'doc',
  doc: 'doc',
  sheet: 'sheet',
  deck: 'slides',
};

/** The button in the sheet bar that shows or hides the details panel. */
export function DocumentsBar() {
  return <DetailsButton label="Document details" />;
}

function Row({
  doc,
  current,
  ticked,
  onOpen,
}: {
  doc: LibraryDoc;
  current: boolean;
  ticked: boolean;
  onOpen: () => void;
}) {
  return (
    <li
      className="line lib-row"
      data-current={current ? 'true' : undefined}
      data-ticked={ticked ? 'true' : undefined}
    >
      <label className="tick-hit lib-tick">
        <input
          type="checkbox"
          className="tick"
          checked={ticked}
          aria-label={`Select ${doc.title}`}
          onChange={() => docsStore.toggleTick(doc.id)}
        />
      </label>
      <button type="button" className="lib-open" aria-current={current ? 'true' : undefined} onClick={onOpen}>
        <span className="doc-glyph">
          <Icon name={FORMAT_ICONS[doc.format]} size={18} />
        </span>
        <span className="line-text">
          <span className="line-title" title={doc.name}>
            {doc.title}
          </span>
          <span className="line-meta">{metaWords(doc)}</span>
        </span>
        <span className="doc-col doc-status" data-status={doc.status}>
          {STATUS_WORDS[doc.status]}
        </span>
        <span className="doc-col doc-by">
          <span className="visually-hidden">By </span>
          {doc.by}
        </span>
        <span className="doc-col doc-date">
          <span className="visually-hidden">Updated </span>
          {dateWords(doc.updated)}
        </span>
      </button>
    </li>
  );
}

/** The example Documents app: one client's documents, by folder, newest first or A to Z. */
export function DocumentsSheet() {
  const s = useDocs();
  const { state, dispatch } = useShell();
  const { newChat } = useStore();
  const { said, copy } = useCopy();
  const summary = useRef<HTMLParagraphElement>(null);

  const found = useMemo(
    () => filterDocs(DOCUMENTS, { client: s.client, query: s.query, format: 'all' }),
    [s.client, s.query],
  );
  const shown = s.format === 'all' ? found : found.filter((d) => d.format === s.format);
  const groups = groupByFolder(sortDocs(shown, s.sort), DOC_FOLDERS);
  const picked = DOCUMENTS.filter((d) => d.client === s.client && s.ticked.has(d.id));
  const hidden = picked.filter((d) => !shown.includes(d)).length;
  const pickedWords = selectionWords(countWords(picked.length), hidden);
  const clientName = DOC_CLIENTS.find((c) => c.slug === s.client)?.name ?? 'Client';
  const formats = FORMATS.map((f) => ({
    value: f.value,
    label: `${f.label}, ${f.value === 'all' ? found.length : found.filter((d) => d.format === f.value).length}`,
  }));

  const open = (id: string) => {
    docsStore.set({ currentId: id });
    if (!state.panelOpen) dispatch({ type: 'set-panel', open: true });
  };

  return (
    <div className="lib docs">
      <LibraryTools
        id="docs"
        clients={DOC_CLIENTS}
        client={s.client}
        onClient={(client) => docsStore.set({ client })}
        query={s.query}
        onQuery={(query) => docsStore.set({ query })}
        searchLabel="Search documents"
        placeholder="Search by title or tag"
      >
        <Seg label="Sort" value={s.sort} options={SORTS} onChange={(sort) => docsStore.set({ sort })} />
      </LibraryTools>

      <div className="lib-filter">
        <Seg
          label="Type"
          value={s.format}
          options={formats}
          onChange={(format) => docsStore.set({ format })}
        />
        <p className="lib-summary" role="status" ref={summary} tabIndex={-1}>
          {summaryWords(shown)}
        </p>
      </div>

      <h2 className="visually-hidden">{clientName} documents</h2>
      {groups.length === 0 ? (
        <p className="lib-empty">No documents match. Try another search or type.</p>
      ) : (
        <div className="tray lib-tray">
          {groups.map((g) => (
            <FolderCard key={`${s.client}/${g.folder}`} title={g.folder} count={g.items.length}>
              {g.items.map((doc) => (
                <Row
                  key={doc.id}
                  doc={doc}
                  current={s.currentId === doc.id}
                  ticked={s.ticked.has(doc.id)}
                  onOpen={() => open(doc.id)}
                />
              ))}
            </FolderCard>
          ))}
        </div>
      )}

      <div className="visually-hidden" role="status">
        {picked.length > 0 ? pickedWords : ''}
        {said ? `. ${said}` : ''}
      </div>
      {picked.length > 0 ? (
        <SelectionBar
          label="Selected documents"
          words={pickedWords}
          many={picked.length > 1}
          said={said}
          onAsk={() => newChat({ draft: chatDraft(picked) })}
          onCopy={() => void copy(picked.map((d) => d.path).join('\n'))}
          onClear={() => {
            docsStore.set({ ticked: new Set() });
            // The bar goes with the selection, so focus moves to the line above the documents.
            summary.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
