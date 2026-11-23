import { FileStar } from '../../shell/FileStar.tsx';
import { Icon } from '../../shell/Icon.tsx';
import { validArtifact } from '../shared/artifact-words.ts';
import type { ItemProps, KindSpec } from '../shared/LibraryBrowser.tsx';
import { ViewButton } from '../shared/parts.tsx';
import { Thumb } from '../shared/Thumb.tsx';
import { dateWords } from '../shared/words.ts';
import { FORMAT_ICONS } from './icons.ts';
import { countWords, filterDocs, metaWords, sortDocs, summaryWords } from './library.ts';

function metaLine({ item, note }: ItemProps): string {
  const words = validArtifact(item.artifact) ? `${metaWords(item)}, from claude.ai` : metaWords(item);
  return note ? `${words} · ${note}` : words;
}

/** A grid tile: the first page where Quick Look drew one, otherwise the type's icon on the page. */
function Tile(p: ItemProps) {
  const { item: doc, current, onChoose, onOpen, edge } = p;
  return (
    <li className="img-tile" data-current={current ? 'true' : undefined}>
      {/* The picture sits outside the open button, so the bin can sit on the picture's own corner. */}
      <div className="lib-tile-pic">
        <Thumb item={doc} width={320} icon={FORMAT_ICONS[doc.format ?? 'doc']} iconSize={22} />
        {edge}
      </div>
      <button
        type="button"
        className="lib-open"
        data-open-id={doc.id}
        aria-current={current ? 'true' : undefined}
        onClick={onChoose}
      >
        <span className="line-text">
          <span className="line-title" title={doc.name}>
            {doc.title}
          </span>
          <span className="line-meta">{metaLine(p)}</span>
        </span>
      </button>
      <FileStar item={doc} />
      {onOpen ? <ViewButton title={doc.title} onView={doc.view ? onOpen : null} /> : null}
    </li>
  );
}

function Row(p: ItemProps) {
  const { item: doc, current, onChoose, onOpen, edge } = p;
  return (
    <li className="line lib-row" data-current={current ? 'true' : undefined}>
      <button
        type="button"
        className="lib-open"
        data-open-id={doc.id}
        aria-current={current ? 'true' : undefined}
        onClick={onChoose}
      >
        <span className="doc-glyph">
          <Icon name={FORMAT_ICONS[doc.format ?? 'doc']} size={18} />
        </span>
        <span className="line-text">
          <span className="line-title" title={doc.name}>
            {doc.title}
          </span>
          <span className="line-meta">{metaLine(p)}</span>
        </span>
        <span className="doc-col doc-date">
          <span className="visually-hidden">Changed </span>
          {dateWords(doc.modified)}
        </span>
      </button>
      <FileStar item={doc} />
      {onOpen ? <ViewButton title={doc.title} onView={doc.view ? onOpen : null} /> : null}
      {edge}
    </li>
  );
}

/** What Documents adds to the shared library browser. */
export const DOCUMENTS: KindSpec = {
  id: 'docs',
  words: {
    searchLabel: 'Search documents',
    placeholder: 'Search by name or folder',
    heading: 'Documents',
    none: "Nothing here yet. Documents saved in this library's folders will appear here.",
    noMatch: 'No documents match. Try another search or type.',
    selected: 'Selected documents',
  },
  formats: [
    { value: 'all', label: 'All' },
    { value: 'pdf', label: 'PDFs' },
    { value: 'doc', label: 'Docs' },
    { value: 'sheet', label: 'Sheets' },
    { value: 'deck', label: 'Decks' },
  ],
  sorts: [
    { value: 'newest', label: 'Newest' },
    { value: 'name', label: 'A to Z' },
  ],
  filter: (items, query) => filterDocs(items, { query, format: 'all' }),
  sort: (items, sort) => sortDocs(items, sort === 'name' ? 'name' : 'newest'),
  summary: summaryWords,
  count: countWords,
  name: (item) => item.title,
  Item: (p) => (p.layout === 'grid' ? <Tile {...p} /> : <Row {...p} />),
};
