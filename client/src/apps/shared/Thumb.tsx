import { useState } from 'react';
import { type LibraryItem, ROUTES } from '../../../../shared/contract.ts';
import type { IconName } from '../../shell/contract.ts';
import { Icon } from '../../shell/Icon.tsx';
import { useStore } from '../../store.tsx';

/**
 * A file's picture in its box (3:2, or the `--thumb-ratio` the app sets). The standard tile (an icon,
 * centred) stands in when the server cannot make a picture, or when the one it made fails to load.
 * A failure is forgotten when the file changes or the library refreshes, so it gets another go.
 */
export function Thumb({
  item,
  width,
  label = '',
  icon = 'image',
  iconSize = 22,
}: {
  item: LibraryItem;
  width: 96 | 320;
  /** The picture's alternative text; empty where the name is beside it. */
  label?: string;
  /** The standard tile's icon: the image icon, or a document's format icon. */
  icon?: IconName;
  iconSize?: number;
}) {
  const { libraryVersion } = useStore();
  const version = `${item.id}|${item.modified}|${libraryVersion}`;
  const [failed, setFailed] = useState<string | null>(null);
  const plain = !item.thumb || failed === version;
  return (
    <span className="img-thumb" data-plain={plain ? 'true' : undefined}>
      {plain ? (
        <Icon name={icon} size={iconSize} />
      ) : (
        <img
          src={ROUTES.libraryThumb(item.id, width, item.modified)}
          alt={label}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(version)}
        />
      )}
    </span>
  );
}
