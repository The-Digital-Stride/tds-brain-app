import type { LibraryItem, LibraryKind, LibraryScope } from '../../../../shared/contract.ts';
import { api } from '../../api.ts';
import type { IconName, SearchHitDetail, SearchSource } from '../../shell/contract.ts';
import { pictureWords } from './library.ts';
import { dateWords, sizeWords } from './words.ts';

/** What the global search needs of a library app's store: nothing else of it. */
interface OpensItems {
  openItem: (scope: string, item: LibraryItem) => void;
}

/** The stores of the library apps that have a search source, by app id (filled by `librarySearchSource`). */
const stores = new Map<string, OpensItems>();

/** `SearchActions.openLibraryItem`: opens the app's sheet's data on `item` (the caller then shows the app). */
export function openLibraryItem(appId: string, scope: string, item: LibraryItem): void {
  stores.get(appId)?.openItem(scope, item);
}

interface LibrarySearchSourceOptions {
  /** The app's id: the hit opens `app:<appId>`. */
  appId: string;
  /** The group heading: "Images", "Documents". */
  title: string;
  kind: LibraryKind;
  icon: IconName;
  store: OpensItems;
  /** What the file type is called on screen ("Word"); the extension in capitals when omitted. */
  typeWords?: (ext: string) => string;
}

/**
 * The tooltip's lines for a file: its name (when the title is not just that), where it is, then what it is.
 * The same facts the app's details panel shows.
 */
export function fileDetail(
  item: LibraryItem,
  scope: LibraryScope,
  typeWords: (ext: string) => string = (ext) => ext.toUpperCase(),
): SearchHitDetail {
  const changed = dateWords(item.modified);
  const facts = [
    typeWords(item.ext),
    pictureWords(item),
    sizeWords(item.bytes),
    changed ? `Changed ${changed}` : null,
  ].filter((f): f is string => Boolean(f));
  const lines = [`${scope.name} · ${item.group}`, facts.join(' · ')];
  if (item.name !== item.title) lines.unshift(item.name);
  return { lines, path: item.path };
}

/**
 * The global search source of a library app: asks the server (`GET /api/library/search`) across every
 * folder the person can see. It lives outside the app's lazy UI chunk (`ui.ts`) on purpose, so the
 * palette never loads the screens just to search.
 */
export function librarySearchSource(o: LibrarySearchSourceOptions): SearchSource {
  stores.set(o.appId, o.store);
  return {
    id: o.appId,
    title: o.title,
    searchAsync: async (query, signal) => {
      const res = await api.librarySearch(query, o.kind, { signal });
      return {
        hits: res.hits.map(({ item, scope }) => ({
          id: item.id,
          label: item.title,
          // A typed query is the only way in here, so personal files are never listed unasked.
          hint: scope.kind === 'personal' ? 'My personal files' : scope.name,
          icon: o.icon,
          detail: fileDetail(item, scope, o.typeWords),
          run: (actions) => actions.openLibraryItem(o.appId, scope.id, item),
        })),
        total: res.total,
        partial: res.partial,
      };
    },
  };
}

let warmed = false;

/**
 * Asks the server for a search nobody will read, once per page load, so it builds the folder lists behind
 * the first real one while the person is still typing. A failure is ignored: the real search asks again.
 */
export function warmLibrarySearch(): void {
  if (warmed) return;
  warmed = true;
  void Promise.resolve()
    .then(() => api.librarySearch('zz', 'document'))
    .catch(() => {});
}
