import type { LibraryItem } from '../../../shared/contract.ts';
import { useStore } from '../store.tsx';
import { NO_FAVOURITES, StarButton } from './StarButton.tsx';

/** The star on a file (plan 2026-11-15-home-pinned-cards): starred files are "Pinned files" on Home. */
export function FileStar({ item }: { item: LibraryItem }) {
  const { boot, toggleFavouriteFile } = useStore();
  const favs = boot?.prefs.favouriteFiles ?? NO_FAVOURITES;
  return (
    <StarButton
      id={item.id}
      title={item.title}
      on={favs.includes(item.id)}
      onPress={(id) => void toggleFavouriteFile(id)}
    />
  );
}
