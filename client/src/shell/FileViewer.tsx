import { useEffect, useId, useRef } from 'react';
import { ROUTES } from '../../../shared/contract.ts';
import { openLibraryItem } from '../apps/shared/search.ts';
import { FileStage } from '../apps/shared/Viewer.tsx';
import { useStore } from '../store.tsx';
import { Icon } from './Icon.tsx';
import { useDesk, useShell } from './ShellProvider.tsx';

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
  const { libraryVersion, openView } = useStore();
  const request = state.viewer;
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  // Set when "Open in Documents" closes the viewer: focus goes to the app, not back to the opener.
  const leaving = useRef(false);
  const shown = request !== null;

  // Each file asked for takes focus at its heading (a second file replacing the first, too). A newer
  // copy of the same file (Claude changed it) leaves focus where it is.
  const shownId = request?.item.id ?? null;
  useEffect(() => {
    if (shownId !== null) heading.current?.focus({ preventScroll: true });
  }, [shownId]);

  // On close, back to the opener while it is still on the page; failing that, the sheet.
  useEffect(() => {
    if (shown) return;
    const opener = viewerOpener.current;
    viewerOpener.current = null;
    const toApp = leaving.current;
    leaving.current = false;
    // Off to the app: the sheet holds focus until the app's own viewer takes it.
    // An opener that went inert meanwhile (its panel shut as the window narrowed) can't take focus.
    const reachable = opener?.isConnected === true && opener.closest('[inert]') === null;
    if (!toApp && reachable) opener.focus({ preventScroll: true });
    else if (toApp || opener) document.getElementById('main')?.focus({ preventScroll: true });
  }, [shown, viewerOpener]);

  if (!request) return null;
  const { item, place, openIn } = request;
  const close = () => dispatch({ type: 'close-viewer' });
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
      <div className="viewer-drawer glass" role="dialog" aria-modal="true" aria-labelledby={headingId}>
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
      </div>
    </div>
  );
}
