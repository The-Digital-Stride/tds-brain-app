import { useMemo, useRef } from 'react';
import type { LibraryItem } from '../../../../shared/contract.ts';
import { FileStar } from '../../shell/FileStar.tsx';
import { Seg } from '../../shell/Seg.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useStore } from '../../store.tsx';
import { useCopy } from '../shared/copy.ts';
import { useKeepCurrent, useLibraryData } from '../shared/data.ts';
import { groupItems } from '../shared/library.ts';
import {
  DeleteButton,
  FolderCard,
  LibraryNotice,
  LibraryTools,
  neighbourId,
  SelectionBar,
  useDeleteFocus,
  ViewButton,
} from '../shared/parts.tsx';
import { Thumb } from '../shared/Thumb.tsx';
import { selectionWords } from '../shared/words.ts';
import { chatDraft, countWords, filterImages, metaWords, summaryWords, tileWords } from './library.ts';
import { imagesStore, useImages } from './store.ts';

const LAYOUTS: { value: 'grid' | 'list'; label: string }[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
];

function Item({
  image,
  layout,
  current,
  ticked,
  onOpen,
  onView,
  onDelete,
  reserveBin,
}: {
  image: LibraryItem;
  layout: 'grid' | 'list';
  current: boolean;
  ticked: boolean;
  /** Choose the image (its details show in the panel). */
  onOpen: () => void;
  /** Show it in the viewer straight away. */
  onView: () => void;
  /** Delete it (shown as a bin when the file's `canDelete` is true). */
  onDelete: () => void;
  /** Some file in the list has a bin: a row without one keeps its place empty. */
  reserveBin: boolean;
}) {
  const thumb = (
    <Thumb item={image} width={layout === 'list' ? 96 : 320} iconSize={layout === 'list' ? 18 : 22} />
  );
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
      {/* A tile's picture sits outside the open button, so the bin can sit on the picture's own corner. */}
      {layout === 'grid' ? (
        <div className="lib-tile-pic">
          {thumb}
          <DeleteButton item={image} name={image.name} onDelete={onDelete} className="lib-delete" />
        </div>
      ) : null}
      <button
        type="button"
        className="lib-open"
        data-open-id={image.id}
        aria-current={current ? 'true' : undefined}
        onClick={onOpen}
      >
        {layout === 'list' ? thumb : null}
        <span className="line-text">
          <span className="line-title" title={image.name}>
            {image.name}
          </span>
          {/* A tile has room for the dimensions only; the type and size are in the list and the panel. */}
          <span className="line-meta">{layout === 'list' ? metaWords(image) : tileWords(image)}</span>
        </span>
      </button>
      <FileStar item={image} name={image.name} />
      <ViewButton title={image.name} onView={image.view ? onView : null} />
      {layout === 'list' ? (
        <DeleteButton
          item={image}
          name={image.name}
          onDelete={onDelete}
          className="lib-delete"
          reserve={reserveBin}
        />
      ) : null}
    </li>
  );
}

/** The Images app: the images in one library, by folder, as a grid or a list. */
export function ImagesSheet() {
  const s = useImages();
  const { state, dispatch } = useShell();
  const { newChat, deleteFile, hiddenFileIds } = useStore();
  const { said, copy } = useCopy();
  const root = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const data = useLibraryData(imagesStore, 'image');
  useKeepCurrent(imagesStore, data);
  const focusAfterDelete = useDeleteFocus(root, summary, false);

  // A file being deleted is out of the list at once, even if a refresh still carries it.
  const items = useMemo(
    () => data.items.filter((i) => !hiddenFileIds.has(i.id)),
    [data.items, hiddenFileIds],
  );
  const shown = useMemo(() => filterImages(items, s.query), [items, s.query]);
  const groups = useMemo(() => groupItems(shown, data.order), [shown, data.order]);
  const picked = items.filter((i) => s.ticked.has(i.id));
  const hidden = picked.filter((i) => !shown.includes(i)).length;
  const pickedWords = selectionWords(countWords(picked.length), hidden);
  const ready = data.status === 'ready';
  const reserveBin = shown.some((i) => i.canDelete === true);

  const open = (image: LibraryItem) => {
    imagesStore.set({ current: image });
    if (!state.panelOpen) dispatch({ type: 'set-panel', open: true });
  };

  // A file opens in the viewer drawer over the right of the page, the same everywhere in the app.
  const view = (image: LibraryItem) => {
    imagesStore.set({ current: image });
    dispatch({ type: 'open-viewer', viewer: { item: image, place: data.scopeName || undefined } });
  };

  // Delete with an Undo; focus goes to the next file shown (found by id).
  const remove = (image: LibraryItem) => {
    const next = neighbourId(
      groups.flatMap((g) => g.items.map((i) => i.id)),
      image.id,
    );
    deleteFile(image, image.name);
    imagesStore.set({
      ...(s.current?.id === image.id ? { current: null } : {}),
    });
    focusAfterDelete(next);
  };

  return (
    <div
      className="lib imgs"
      ref={root}
      data-layout={s.layout}
      data-picking={picked.length > 0 ? 'true' : undefined}
    >
      <div className="lib-main">
        <LibraryTools
          id="imgs"
          scopes={data.scopes}
          scope={data.scope}
          onScope={(scope) => imagesStore.set({ scope })}
          query={s.query}
          onQuery={(query) => imagesStore.set({ query })}
          project={s.project ?? ''}
          onProject={(project) => imagesStore.set({ project })}
          searchLabel="Search images"
          placeholder="Search by name or folder"
        >
          <p className="lib-summary" data-lib-summary role="status" ref={summary} tabIndex={-1}>
            {ready ? summaryWords(shown) : ''}
          </p>
          <Seg
            label="Layout"
            value={s.layout}
            options={LAYOUTS}
            onChange={(layout) => imagesStore.set({ layout })}
          />
        </LibraryTools>

        {data.scopeName ? <h2 className="visually-hidden">Images in {data.scopeName}</h2> : null}
        <LibraryNotice
          status={data.status}
          message={data.message}
          retry={data.retry}
          empty={
            items.length === 0
              ? "Nothing here yet. Images saved in this library's folders will appear here."
              : shown.length === 0
                ? 'No images match. Try another search.'
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
                renderItem={(image) => (
                  <Item
                    key={image.id}
                    image={image}
                    layout={s.layout}
                    current={s.current?.id === image.id}
                    ticked={s.ticked.has(image.id)}
                    onOpen={() => open(image)}
                    onView={() => view(image)}
                    onDelete={() => remove(image)}
                    reserveBin={reserveBin}
                  />
                )}
              />
            ))}
          </div>
        ) : null}
        {ready && data.hiddenLinks > 0 ? (
          <p className="lib-note">
            {data.hiddenLinks === 1
              ? '1 linked file is not shown because you cannot see it.'
              : `${data.hiddenLinks} linked files are not shown because you cannot see them.`}
          </p>
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
    </div>
  );
}
