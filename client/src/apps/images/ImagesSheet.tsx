import { useMemo, useRef } from 'react';
import { Seg } from '../../shell/Seg.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useStore } from '../../store.tsx';
import { useCopy } from '../shared/copy.ts';
import { DetailsButton, FolderCard, LibraryTools, SelectionBar } from '../shared/parts.tsx';
import { groupByFolder, selectionWords } from '../shared/words.ts';
import { Art } from './Art.tsx';
import { FOLDERS, type Kind, LIBRARY, LIBRARY_CLIENTS, type LibraryImage } from './data.ts';
import { chatDraft, countWords, filterImages, metaWords, summaryWords } from './library.ts';
import { imagesStore, useImages } from './store.ts';

const KINDS: { value: Kind | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'logo', label: 'Logos' },
  { value: 'photo', label: 'Photos' },
  { value: 'ad', label: 'Ad creative' },
  { value: 'screenshot', label: 'Screenshots' },
];

const LAYOUTS: { value: 'grid' | 'list'; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
];

/** The button in the sheet bar that shows or hides the details panel. */
export function ImagesBar() {
  return <DetailsButton label="Image details" />;
}

function Item({
  image,
  layout,
  current,
  ticked,
  onOpen,
}: {
  image: LibraryImage;
  layout: 'grid' | 'list';
  current: boolean;
  ticked: boolean;
  onOpen: () => void;
}) {
  return (
    <li
      className={layout === 'list' ? 'line lib-row' : 'img-tile'}
      data-current={current ? 'true' : undefined}
      data-ticked={ticked ? 'true' : undefined}
    >
      <label className="tick-hit lib-tick">
        <input
          type="checkbox"
          className="tick"
          checked={ticked}
          aria-label={`Select ${image.name}`}
          onChange={() => imagesStore.toggleTick(image.id)}
        />
      </label>
      <button type="button" className="lib-open" aria-current={current ? 'true' : undefined} onClick={onOpen}>
        <span className="img-thumb">
          <Art image={image} />
        </span>
        <span className="line-text">
          <span className="line-title" title={image.name}>
            {image.name}
          </span>
          <span className="line-meta">
            {/* A tile has room for the dimensions only; the size is in the list and the panel. */}
            {layout === 'list' ? metaWords(image) : `${image.width} × ${image.height}`}
          </span>
        </span>
      </button>
    </li>
  );
}

/** The example Images app: one client's image library, by folder, as a grid or a list. */
export function ImagesSheet() {
  const s = useImages();
  const { state, dispatch } = useShell();
  const { newChat } = useStore();
  const { said, copy } = useCopy();
  const summary = useRef<HTMLParagraphElement>(null);

  const found = useMemo(
    () => filterImages(LIBRARY, { client: s.client, query: s.query, kind: 'all' }),
    [s.client, s.query],
  );
  const shown = s.kind === 'all' ? found : found.filter((i) => i.kind === s.kind);
  const groups = groupByFolder(shown, FOLDERS);
  const picked = LIBRARY.filter((i) => i.client === s.client && s.ticked.has(i.id));
  const hidden = picked.filter((i) => !shown.includes(i)).length;
  const pickedWords = selectionWords(countWords(picked.length), hidden);
  const clientName = LIBRARY_CLIENTS.find((c) => c.slug === s.client)?.name ?? 'Client';
  const kinds = KINDS.map((k) => ({
    value: k.value,
    label: `${k.label}, ${k.value === 'all' ? found.length : found.filter((i) => i.kind === k.value).length}`,
  }));

  const open = (id: string) => {
    imagesStore.set({ currentId: id });
    if (!state.panelOpen) dispatch({ type: 'set-panel', open: true });
  };

  return (
    <div className="lib imgs" data-layout={s.layout} data-picking={picked.length > 0 ? 'true' : undefined}>
      <LibraryTools
        id="imgs"
        clients={LIBRARY_CLIENTS}
        client={s.client}
        onClient={(client) => imagesStore.set({ client })}
        query={s.query}
        onQuery={(query) => imagesStore.set({ query })}
        searchLabel="Search images"
        placeholder="Search by name or tag"
      >
        <Seg
          label="Layout"
          value={s.layout}
          options={LAYOUTS}
          onChange={(layout) => imagesStore.set({ layout })}
        />
      </LibraryTools>

      <div className="lib-filter">
        <Seg label="Type" value={s.kind} options={kinds} onChange={(kind) => imagesStore.set({ kind })} />
        <p className="lib-summary" role="status" ref={summary} tabIndex={-1}>
          {summaryWords(shown)}
        </p>
      </div>

      <h2 className="visually-hidden">{clientName} images</h2>
      {groups.length === 0 ? (
        <p className="lib-empty">No images match. Try another search or type.</p>
      ) : (
        <div className="tray lib-tray">
          {groups.map((g) => (
            <FolderCard key={`${s.client}/${g.folder}`} title={g.folder} count={g.items.length}>
              {g.items.map((image) => (
                <Item
                  key={image.id}
                  image={image}
                  layout={s.layout}
                  current={s.currentId === image.id}
                  ticked={s.ticked.has(image.id)}
                  onOpen={() => open(image.id)}
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
          label="Selected images"
          words={pickedWords}
          many={picked.length > 1}
          said={said}
          onAsk={() => newChat({ draft: chatDraft(picked) })}
          onCopy={() => void copy(picked.map((i) => i.path).join('\n'))}
          onClear={() => {
            imagesStore.set({ ticked: new Set() });
            // The bar goes with the selection, so focus moves to the line above the images.
            summary.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
