import { FileStar } from '../../shell/FileStar.tsx';
import type { ItemProps, KindSpec } from '../shared/LibraryBrowser.tsx';
import { ViewButton } from '../shared/parts.tsx';
import { Thumb } from '../shared/Thumb.tsx';
import { TypeBadge, TypeWord } from '../shared/TypeBadge.tsx';
import { countWords, filterImages, metaWords, summaryWords, tileWords } from './library.ts';

function Item({ item: image, layout, current, onChoose, onOpen, tick, note, edge }: ItemProps) {
  const thumb = (
    <Thumb item={image} width={layout === 'list' ? 96 : 320} iconSize={layout === 'list' ? 18 : 22} />
  );
  // A tile has room for the dimensions only; the type and size are in the list and the panel.
  const meta = layout === 'list' ? metaWords(image) : tileWords(image);
  return (
    <li
      className={layout === 'list' ? 'line lib-row' : 'img-tile'}
      data-current={current ? 'true' : undefined}
      data-ticked={tick?.ticked ? 'true' : undefined}
    >
      {tick ? (
        <label className="tick-hit lib-tick">
          <input
            type="checkbox"
            className="tick"
            checked={tick.ticked}
            aria-label={`Select ${image.name}`}
            onChange={tick.onToggle}
          />
        </label>
      ) : null}
      {/* A tile's picture sits outside the open button, so the bin can sit on the picture's own corner. */}
      {layout === 'grid' ? (
        <div className="lib-tile-pic">
          {thumb}
          <TypeBadge ext={image.ext} />
          {edge}
        </div>
      ) : null}
      <button
        type="button"
        className="lib-open"
        data-open-id={image.id}
        aria-current={current ? 'true' : undefined}
        onClick={onChoose}
      >
        {layout === 'list' ? thumb : null}
        {layout === 'list' ? <TypeBadge ext={image.ext} /> : null}
        <span className="line-text">
          <span className="line-title" title={image.name}>
            {image.name}
          </span>
          <span className="line-meta">
            <TypeWord ext={image.ext} />
            {note ? `${meta} · ${note}` : meta}
          </span>
        </span>
      </button>
      <FileStar item={image} name={image.name} />
      {onOpen ? <ViewButton title={image.name} onView={image.view ? onOpen : null} /> : null}
      {layout === 'list' ? edge : null}
    </li>
  );
}

/** What Images adds to the shared library browser. */
export const IMAGES: KindSpec = {
  id: 'imgs',
  words: {
    searchLabel: 'Search images',
    placeholder: 'Search by name or folder',
    heading: 'Images',
    none: "Nothing here yet. Images saved in this library's folders will appear here.",
    noMatch: 'No images match. Try another search.',
    selected: 'Selected images',
  },
  filter: filterImages,
  summary: summaryWords,
  count: countWords,
  name: (item) => item.name,
  Item,
};
