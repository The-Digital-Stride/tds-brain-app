import { Fold } from '../../shell/Fold.tsx';
import { useStore } from '../../store.tsx';
import { DetailActions, DetailList } from '../shared/parts.tsx';
import { dateWords, sizeWords } from '../shared/words.ts';
import { Art } from './Art.tsx';
import { KIND_WORDS, LIBRARY } from './data.ts';
import { chatDraft } from './library.ts';
import { useImages } from './store.ts';

/** The right panel for the Images app: the chosen image, what it is and where it is used. */
export function ImagesPanel() {
  const s = useImages();
  const { newChat } = useStore();
  const image = LIBRARY.find((i) => i.id === s.currentId && i.client === s.client);
  if (!image) return <p className="dock-empty">Choose an image to see its details.</p>;

  return (
    <div className="lib-detail">
      <div className="lib-preview">
        <span className="img-preview-frame">
          <Art image={image} label={`Preview of ${image.name}`} />
        </span>
      </div>
      <h3 className="lib-name">{image.name}</h3>
      <ul className="lib-tags" aria-label="Tags">
        {image.tags.map((tag) => (
          <li key={tag} className="chip">
            {tag}
          </li>
        ))}
      </ul>
      <DetailActions path={image.path} onAsk={() => newChat({ draft: chatDraft([image]) })} />
      <dl className="kv">
        <dt>Type</dt>
        <dd className="kv-cap">{KIND_WORDS[image.kind]}</dd>
        <dt>Dimensions</dt>
        <dd>
          {image.width} × {image.height}
        </dd>
        <dt>Size</dt>
        <dd>{sizeWords(image.bytes)}</dd>
        <dt>Folder</dt>
        <dd>{image.folder}</dd>
        <dt>Added</dt>
        <dd>
          {dateWords(image.added)}
          <span className="kv-note">by {image.by}</span>
        </dd>
        <dt className="kv-wide">File path</dt>
        <dd className="kv-wide">
          <code className="terminal-cmd">{image.path}</code>
        </dd>
      </dl>
      <Fold title="Used in" count={image.usedIn.length}>
        <DetailList items={image.usedIn} empty="Not used anywhere yet." />
      </Fold>
    </div>
  );
}
