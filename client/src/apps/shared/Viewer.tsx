import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { type LibraryItem, ROUTES } from '../../../../shared/contract.ts';
import { api } from '../../api.ts';
import { Markdown } from '../../markdown.tsx';
import { useStore } from '../../store.tsx';
import { useLoaded } from './data.ts';

/** A small stable number for a string, so a version string can drive `useLoaded`'s quiet refresh. */
function versionNumber(v: string): number {
  let n = 0;
  for (let i = 0; i < v.length; i++) n = (n * 31 + v.charCodeAt(i)) | 0;
  return n;
}

/**
 * A text or Markdown file's body. `version` (the library's version, say) refetches quietly when it
 * changes, with no "Loading…" flash, so a file Claude is editing stays current with its scroll kept.
 */
export function TextBody({ item, version }: { item: LibraryItem; version?: string }) {
  // Refetched only when this file itself changes, not whenever anything else in the library does.
  const text = useLoaded(`${item.id}|${item.modified}`, version ? versionNumber(version) : 0, () =>
    api.libraryText(item.id),
  );
  if (text.status === 'loading') {
    return (
      <p className="lib-note" role="status">
        Loading…
      </p>
    );
  }
  if (text.status === 'failed') {
    return (
      <div className="lib-failed" role="alert">
        <p>{text.message}</p>
        <button type="button" className="btn" onClick={text.retry}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <>
      {item.ext === 'md' ? (
        <Markdown text={text.data.text} />
      ) : (
        <pre className="lib-text">{text.data.text}</pre>
      )}
      {text.data.truncated ? (
        <p className="lib-note">This file is long, so only the start is shown.</p>
      ) : null}
    </>
  );
}

export function PictureBody({ item }: { item: LibraryItem }) {
  // The parent keys this on the file's version and the library's, so a failure is not remembered for ever.
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="lib-note">This picture could not be shown.</p>;
  return (
    <img
      className="lib-viewer-image"
      src={ROUTES.libraryThumb(item.id, 1600, item.modified)}
      alt={item.title}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * A file open on the sheet in place of the list. Focus moves here when it opens, and Escape goes
 * back while focus is inside it (handled here, not by the shell's own key handling).
 */
export function Viewer({ item, onBack }: { item: LibraryItem; onBack: () => void }) {
  const { libraryVersion } = useStore();
  const root = useRef<HTMLDivElement>(null);
  // Take focus when the file opens. When "Open" also closes a floating panel, the sheet is inert for
  // a moment and the panel hands focus back to its opener, so keep claiming it for a few frames.
  useEffect(() => {
    let frames = 0;
    let frame = 0;
    const take = () => {
      const el = root.current;
      if (!el) return;
      if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
      frames += 1;
      if (frames < 10) frame = requestAnimationFrame(take);
    };
    take();
    return () => cancelAnimationFrame(frame);
  }, []);

  const [reloads, setReloads] = useState(0);
  const [blocked, setBlocked] = useState(false);
  // A link to another site is refused by the app's policy and leaves the frame blank: put the page back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the file's id and version clear the line.
  useEffect(() => {
    setBlocked(false);
    if (item.view !== 'page') return;
    const onViolation = (e: Event) => {
      const directive = (e as Partial<SecurityPolicyViolationEvent>).violatedDirective ?? '';
      if (!directive.startsWith('frame-src')) return;
      setReloads((n) => n + 1);
      setBlocked(true);
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    return () => document.removeEventListener('securitypolicyviolation', onViolation);
  }, [item.id, item.modified, item.view]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onBack();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled region that takes focus when a file opens.
    <div
      className="lib-viewer"
      ref={root}
      tabIndex={-1}
      role="region"
      aria-label={item.title}
      onKeyDown={onKeyDown}
    >
      <h2 className="visually-hidden">{item.title}</h2>
      <div className="tray lib-stage">
        {item.view === 'image' ? (
          <div className="card lib-pic">
            <PictureBody key={`${item.modified}|${libraryVersion}`} item={item} />
          </div>
        ) : null}
        {item.view === 'text' ? (
          <div className="card lib-doc">
            <TextBody item={item} />
          </div>
        ) : null}
        {item.view === 'page' ? (
          <div className="card lib-page">
            <iframe
              key={`${item.modified}|${reloads}`}
              className="lib-frame"
              sandbox=""
              referrerPolicy="no-referrer"
              title={item.title}
              src={ROUTES.libraryPage(item.id)}
            />
          </div>
        ) : null}
        {item.view === 'pdf' ? (
          <div className="card lib-page lib-pdf">
            {/* No sandbox: the browser will not show a PDF in a sandboxed frame. The server only sends
                a real PDF, and the browser's reader runs apart from the app. The fragment hides
                Chrome's page sidebar and fits the page to the width; other browsers ignore it. */}
            <iframe
              key={item.modified}
              className="lib-frame"
              referrerPolicy="no-referrer"
              title={item.title}
              src={`${ROUTES.libraryPdf(item.id)}#navpanes=0&view=FitH`}
            />
          </div>
        ) : null}
      </div>
      <p className="lib-note" role="status">
        {blocked ? 'Links to other sites are switched off here.' : ''}
      </p>
    </div>
  );
}
