import { useEffect, useId, useRef } from 'react';
import { ROUTES } from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { DeleteButton } from '../apps/shared/parts.tsx';
import { openLibraryItem } from '../apps/shared/search.ts';
import { FileStage } from '../apps/shared/Viewer.tsx';
import { useStore } from '../store.tsx';
import { FileStar } from './FileStar.tsx';
import { Icon } from './Icon.tsx';
import { PageStage } from './PageStage.tsx';
import { useDesk, useShell } from './ShellProvider.tsx';
import { ViewerDrawer } from './ViewerDrawer.tsx';

const APP_WORDS = { documents: 'Open in Documents', images: 'Open in Images' } as const;

/**
 * The file viewer: a wide drawer that slides over the desk to show one file large (a document, a
 * picture, a PDF), so the person reads it without leaving what they were on. Any part of the app
 * opens it with `{ type: 'open-viewer' }`.
 *
 * Modal: the desk behind it is inert (`App.tsx`), the veil or Esc closes it (`state/keys.ts`), its
 * heading takes focus when it opens, and closing it puts focus back on whatever opened it.
 */
export function FileViewer() {
  const { state, dispatch, modes } = useShell();
  const { viewerOpener } = useDesk();
  const { libraryVersion, openView, deleteFile } = useStore();
  const request = state.viewer;
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  // Set when "Open in Documents" closes the viewer: focus goes to the app, not back to the opener.
  const leaving = useRef(false);
  // After a delete: the file next to the deleted one in the list that opened this viewer.
  const afterDelete = useRef<HTMLElement | null>(null);
  const shown = request !== null;

  // Each file asked for takes focus at its heading (a second file replacing the first, too). A newer
  // copy of the same file (Claude changed it) leaves focus where it is.
  const shownId =
    request === null
      ? null
      : request.kind === 'page'
        ? `page:${request.chat}:${request.key}`
        : request.item.id;
  useEffect(() => {
    if (shownId !== null) heading.current?.focus({ preventScroll: true });
  }, [shownId]);

  // A file that changes while it is open (Claude edited it) is swapped for its newer copy, so a page,
  // PDF or picture reloads; text refetches by itself. Whoever opened it (a project, a to-do, a tool,
  // the search), the drawer keeps it current. Checked only when the library changes after opening.
  const latest = useRef(request);
  latest.current = request;
  const fileId = request !== null && request.kind !== 'page' ? request.item.id : null;
  const seen = useRef<{ id: string | null; version: number }>({ id: null, version: 0 });
  useEffect(() => {
    if (fileId === null) return;
    if (seen.current.id !== fileId) {
      seen.current = { id: fileId, version: libraryVersion };
      return;
    }
    if (seen.current.version === libraryVersion) return;
    seen.current.version = libraryVersion;
    let live = true;
    api
      .libraryItems([fileId])
      .then(({ files }) => {
        const fresh = files[0]?.item;
        const now = latest.current;
        if (!live || !fresh || now === null || now.kind === 'page' || now.item.id !== fresh.id) return;
        if (now.item.modified !== fresh.modified)
          dispatch({ type: 'update-viewer', viewer: { ...now, item: fresh } });
      })
      .catch(() => {
        // Offline or gone: the copy on screen stays; a delete closes the drawer by its own route.
      });
    return () => {
      live = false;
    };
  }, [fileId, libraryVersion, dispatch]);

  // On close, back to the opener while it is still on the page; failing that, the sheet.
  useEffect(() => {
    if (shown) return;
    const opener = viewerOpener.current;
    viewerOpener.current = null;
    const toApp = leaving.current;
    leaving.current = false;
    const next = afterDelete.current;
    afterDelete.current = null;
    // A deleted file's own row is gone: land on the next file shown, if there is one.
    if (next?.isConnected && next.closest('[inert]') === null) {
      next.focus({ preventScroll: true });
      return;
    }
    // Off to the app: the sheet holds focus until the app's own viewer takes it.
    // An opener that went inert meanwhile (its panel shut as the window narrowed) can't take focus.
    const reachable = opener?.isConnected === true && opener.closest('[inert]') === null;
    if (!toApp && reachable) opener.focus({ preventScroll: true });
    else if (toApp || opener) document.getElementById('main')?.focus({ preventScroll: true });
  }, [shown, viewerOpener]);

  if (!request) return null;
  const close = () => dispatch({ type: 'close-viewer' });
  if (request.kind === 'page') {
    return (
      <div className="viewer-layer">
        <div className="viewer-veil" aria-hidden="true" onClick={close} />
        <ViewerDrawer role="dialog" aria-modal="true" aria-labelledby={headingId}>
          <PageStage
            chat={request.chat}
            pageKey={request.key}
            headingId={headingId}
            headingRef={heading}
            onClose={close}
            onOpenInDocuments={(file) => {
              if (!file.item) return;
              leaving.current = true;
              dispatch({ type: 'close-viewer' });
              openLibraryItem('documents', file.scope.id, file.item);
              openView('app:documents');
              if (modes.panelOverlays) dispatch({ type: 'set-panel', open: false });
            }}
          />
        </ViewerDrawer>
      </div>
    );
  }
  const { item, place, openIn } = request;
  const remove = () => {
    // The row that opened the viewer goes with the file; the next row's open button gets focus.
    const row = viewerOpener.current?.closest('li') ?? null;
    const sibling = row?.nextElementSibling ?? row?.previousElementSibling ?? null;
    afterDelete.current = sibling?.querySelector<HTMLElement>('button, a') ?? null;
    deleteFile(item);
    close();
  };
  const openInApp = () => {
    if (!openIn) return;
    leaving.current = true;
    dispatch({ type: 'close-viewer' });
    openLibraryItem(openIn.app, openIn.scope, item);
    openView(`app:${openIn.app}`);
    // A floating panel would cover the app's own viewer, so it closes; a docked one stays.
    if (modes.panelOverlays) dispatch({ type: 'set-panel', open: false });
  };

  return (
    <div className="viewer-layer">
      {/* A pointer shortcut only: Esc and the close button do the same. */}
      <div className="viewer-veil" aria-hidden="true" onClick={close} />
      <ViewerDrawer role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <header className="viewer-head">
          <div className="viewer-name">
            <h2 id={headingId} ref={heading} tabIndex={-1}>
              {item.title}
            </h2>
            {place ? <p className="viewer-place">{place}</p> : null}
          </div>
          <div className="viewer-actions">
            {openIn ? (
              <button type="button" className="btn" onClick={openInApp}>
                {APP_WORDS[openIn.app]}
              </button>
            ) : null}
            <a
              className="btn"
              href={ROUTES.libraryFile(item.id)}
              download={item.name}
              aria-label={`Download ${item.name}`}
            >
              Download
            </a>
            <FileStar item={item} />
            <DeleteButton item={item} onDelete={remove} />
          </div>
          <button type="button" className="icon-btn viewer-close" aria-label="Close file" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        {/* Focusable so the keyboard can scroll a long file (Safari doesn't reach scroll areas by Tab). */}
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus to scroll. */}
        <section className="viewer-body" aria-label={`Contents of ${item.title}`} tabIndex={0}>
          {item.view === null ? (
            <p className="lib-note">This type can't be shown here. Download it to open it.</p>
          ) : (
            <FileStage key={item.id} item={item} version={String(libraryVersion)} />
          )}
        </section>
      </ViewerDrawer>
    </div>
  );
}
