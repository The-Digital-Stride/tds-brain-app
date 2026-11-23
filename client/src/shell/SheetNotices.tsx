import { FileDeleteNotice } from '../apps/shared/parts.tsx';
import { CLIENT_VERSION, isOutdated } from '../build-version.ts';
import { useUpdate } from '../state/update.ts';
import { useStore } from '../store.tsx';
import type { SheetNoticesProps } from './contract.ts';
import { UpdateBanner } from './UpdateBanner.tsx';

const UPDATE_TEXT =
  "A new version of TDS Cortex is ready. Reload to start using it. Anything you haven't sent will be cleared.";

/**
 * The lines any sheet can show: a newer version is ready, lost connection, the last action's error,
 * a brief notice, and any library file deletes still waiting out their Undo time (wherever they were
 * started: a library sheet, Home or a chat's file viewer).
 */
export function SheetNotices(_: SheetNoticesProps) {
  const { boot, streamUp, actionError, clearError, notice, fileNotice } = useStore();
  // Stays subscribed even when the banner is hidden, so the tab that started an update still reloads.
  const { restarting } = useUpdate();
  const outdated = isOutdated(CLIENT_VERSION, boot?.appVersion);
  return (
    <>
      {/* Always on the page, so a screen reader announces the sentence when it arrives. */}
      <p className="visually-hidden" role="status" data-testid="update-status">
        {outdated ? UPDATE_TEXT : ''}
      </p>
      {/* A page that is already out of date only offers Reload. */}
      {outdated ? null : <UpdateBanner />}
      {outdated ? (
        <div className="notice" data-shape="strip" data-level="info">
          <span>{UPDATE_TEXT}</span>
          <button
            type="button"
            className="btn"
            data-variant="quiet"
            data-size="small"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      ) : null}
      {streamUp || restarting ? null : (
        <div className="notice" data-shape="strip" data-level="warn" role="status">
          Lost touch with TDS Cortex. Trying to reconnect.
        </div>
      )}
      {actionError ? (
        <div className="notice sheet-error" data-shape="box" data-level="error" role="alert">
          <span>{actionError}</span>
          <button type="button" className="btn" data-variant="quiet" data-size="small" onClick={clearError}>
            Dismiss
          </button>
        </div>
      ) : null}
      <FileDeleteNotice />
      {notice ? (
        // A deleted file's note is spoken by the status line in FileDeleteNotice (always on the page), and a
        // deleted chat's by the Chats drawer's, where the delete was started.
        <p
          className="closed-note"
          role={notice === fileNotice ? undefined : 'status'}
          aria-hidden={notice === fileNotice ? true : undefined}
        >
          {notice}
        </p>
      ) : null}
    </>
  );
}
