import { useMemo, useRef } from 'react';
import type { DocFormat, LibraryItem } from '../../../../shared/contract.ts';
import { Icon } from '../../shell/Icon.tsx';
import { Seg } from '../../shell/Seg.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useStore } from '../../store.tsx';
import { useCopy } from '../shared/copy.ts';
import { useKeepCurrent, useLibraryData, useViewerReturn } from '../shared/data.ts';
import { groupItems } from '../shared/library.ts';
import { FolderCard, LibraryBar, LibraryNotice, LibraryTools, SelectionBar } from '../shared/parts.tsx';
import { Thumb } from '../shared/Thumb.tsx';
import { Viewer } from '../shared/Viewer.tsx';
import { dateWords, selectionWords } from '../shared/words.ts';
import { FORMAT_ICONS } from './icons.ts';
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

const FORMATS: { value: DocFormat | 'all'; label: string }[] = [
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

const LAYOUTS: { value: 'grid' | 'list'; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
];

/** The buttons in the sheet bar: Back while a document is open, and the details button. */
export function DocumentsBar() {
  return <LibraryBar store={docsStore} back="Back to Documents" details="Document details" />;
}

/** A grid tile: the first page where Quick Look drew one, otherwise the type's icon on the page. */
function Tile({
  doc,
  current,
  ticked,
  onOpen,
}: {
  doc: LibraryItem;
  current: boolean;
  ticked: boolean;
  onOpen: () => void;
}) {
  return (
    <li
      className="img-tile"
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
      <button
        type="button"
        className="lib-open"
        data-open-id={doc.id}
        aria-current={current ? 'true' : undefined}
        onClick={onOpen}
      >
        <Thumb item={doc} width={320} icon={FORMAT_ICONS[doc.format ?? 'doc']} iconSize={22} />
        <span className="line-text">
          <span className="line-title" title={doc.name}>
            {doc.title}
          </span>
          <span className="line-meta">{metaWords(doc)}</span>
        </span>
      </button>
    </li>
  );
}

function Row({
  doc,
  current,
  ticked,
  onOpen,
}: {
  doc: LibraryItem;
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
      <button
        type="button"
        className="lib-open"
        data-open-id={doc.id}
        aria-current={current ? 'true' : undefined}
        onClick={onOpen}
      >
        <span className="doc-glyph">
          <Icon name={FORMAT_ICONS[doc.format ?? 'doc']} size={18} />
        </span>
        <span className="line-text">
          <span className="line-title" title={doc.name}>
            {doc.title}
          </span>
          <span className="line-meta">{metaWords(doc)}</span>
        </span>
        <span className="doc-col doc-date">
          <span className="visually-hidden">Changed </span>
          {dateWords(doc.modified)}
        </span>
      </button>
    </li>
  );
}

/** The Documents app: the documents in one library, by folder, newest first or A to Z. */
export function DocumentsSheet() {
  const s = useDocs();
  const { state, dispatch } = useShell();
  const { newChat } = useStore();
  const { said, copy } = useCopy();
  const root = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const data = useLibraryData(docsStore, 'document');
  useKeepCurrent(docsStore, data);
  useViewerReturn(docsStore, root, summary);

  const found = useMemo(
    () => filterDocs(data.items, { query: s.query, format: 'all' }),
    [data.items, s.query],
  );
  const shown = s.format === 'all' ? found : found.filter((d) => d.format === s.format);
  const groups = useMemo(() => groupItems(sortDocs(shown, s.sort), data.order), [shown, s.sort, data.order]);
  const picked = data.items.filter((d) => s.ticked.has(d.id));
  const hidden = picked.filter((d) => !shown.includes(d)).length;
  const pickedWords = selectionWords(countWords(picked.length), hidden, 'your search or filter');
  const ready = data.status === 'ready';
  const formats = FORMATS.map((f) => ({
    value: f.value,
    label: `${f.label}, ${f.value === 'all' ? found.length : found.filter((d) => d.format === f.value).length}`,
  }));

  const open = (doc: LibraryItem) => {
    docsStore.set({ current: doc });
    if (!state.panelOpen) dispatch({ type: 'set-panel', open: true });
  };

  return (
    <div
      className="lib docs"
      ref={root}
      data-layout={s.layout}
      data-picking={picked.length > 0 ? 'true' : undefined}
    >
      {s.viewing ? <Viewer item={s.viewing} onBack={() => docsStore.set({ viewing: null })} /> : null}
      <div className="lib-main" hidden={s.viewing !== null}>
        <LibraryTools
          id="docs"
          scopes={data.scopes}
          scope={data.scope}
          onScope={(scope) => docsStore.set({ scope })}
          query={s.query}
          onQuery={(query) => docsStore.set({ query })}
          searchLabel="Search documents"
          placeholder="Search by name or folder"
        >
          <Seg label="Sort" value={s.sort} options={SORTS} onChange={(sort) => docsStore.set({ sort })} />
          <Seg
            label="Layout"
            value={s.layout}
            options={LAYOUTS}
            onChange={(layout) => docsStore.set({ layout })}
          />
        </LibraryTools>

        <div className="lib-filter">
          <Seg
            label="Type"
            value={s.format}
            options={formats}
            onChange={(format) => docsStore.set({ format })}
          />
          <p className="lib-summary" role="status" ref={summary} tabIndex={-1}>
            {ready ? summaryWords(shown) : ''}
          </p>
        </div>

        {data.scopeName ? <h2 className="visually-hidden">Documents in {data.scopeName}</h2> : null}
        <LibraryNotice
          status={data.status}
          message={data.message}
          retry={data.retry}
          empty={
            data.items.length === 0
              ? "Nothing here yet. Documents saved in this library's folders will appear here."
              : shown.length === 0
                ? 'No documents match. Try another search or type.'
                : undefined
          }
        />
        {ready && groups.length > 0 ? (
          <div className="tray lib-tray">
            {groups.map((g) => (
              <FolderCard
                key={`${data.scope}/${g.group}`}
                title={g.group}
                items={g.items}
                renderItem={(doc) => {
                  const Item = s.layout === 'grid' ? Tile : Row;
                  return (
                    <Item
                      key={doc.id}
                      doc={doc}
                      current={s.current?.id === doc.id}
                      ticked={s.ticked.has(doc.id)}
                      onOpen={() => open(doc)}
                    />
                  );
                }}
              />
            ))}
          </div>
        ) : null}
        {ready && data.truncated ? (
          <p className="lib-note">This library is very large, so some files are not listed.</p>
        ) : null}

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
    </div>
  );
}
