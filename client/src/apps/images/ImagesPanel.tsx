import type { LibraryItem } from '../../../../shared/contract.ts';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useStore } from '../../store.tsx';
import { pictureWords } from '../shared/library.ts';
import { DetailActions } from '../shared/parts.tsx';
import { Thumb } from '../shared/Thumb.tsx';
import { dateWords, sizeWords } from '../shared/words.ts';
import { chatDraft } from './library.ts';
import { imagesStore, useImages } from './store.ts';

/** The right panel for the Images app: the chosen image and the facts the file itself holds. */
export function ImagesPanel() {
  const { current: image } = useImages();
  const { newChat } = useStore();
  const { dispatch, modes } = useShell();
  // A floating panel would hide the file it opens, so it closes; a docked one stays.
  const open = (item: LibraryItem) => {
    imagesStore.set({ viewing: item });
    if (modes.panelOverlays) dispatch({ type: 'set-panel', open: false });
  };
  if (!image) return <p className="dock-empty">Choose an image to see its details.</p>;
  const size = pictureWords(image);

  return (
    <div className="lib-detail">
      <div className="lib-preview">
        <Thumb item={image} width={320} label={`Preview of ${image.name}`} iconSize={32} />
      </div>
      <h3 className="lib-name">{image.name}</h3>
      <DetailActions
        item={image}
        onAsk={() => newChat({ draft: chatDraft([image]) })}
        onOpen={image.view ? () => open(image) : null}
      />
      <dl className="kv">
        <dt>Type</dt>
        <dd>{image.ext.toUpperCase()}</dd>
        {size ? (
          <>
            <dt>Dimensions</dt>
            <dd>{size}</dd>
          </>
        ) : null}
        <dt>Size</dt>
        <dd>{sizeWords(image.bytes)}</dd>
        <dt>Group</dt>
        <dd>{image.group}</dd>
        <dt>Changed</dt>
        <dd>{dateWords(image.modified)}</dd>
        <dt className="kv-wide">File path</dt>
        <dd className="kv-wide">
          <code className="terminal-cmd">{image.path}</code>
        </dd>
      </dl>
    </div>
  );
}
