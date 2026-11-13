import { CLIENT_VERSION, isOutdated } from '../build-version.ts';
import { useUpdate } from '../state/update.ts';
import { useStore } from '../store.tsx';
import type { SheetNoticesProps } from './contract.ts';
import { UpdateBanner } from './UpdateBanner.tsx';

const UPDATE_TEXT =
  "A new version of TDS Brain is ready. Reload to start using it. Anything you haven't sent will be cleared.";

/**
 * The lines any sheet can show: a newer version is ready, lost connection, the last action's error,
 * and a brief notice.
 */
export function SheetNotices(_: SheetNoticesProps) {
  const { boot, streamUp, actionError, clearError, notice } = useStore();
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
        <div className="update-banner">
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
        <div className="offline-banner" role="status">
          Lost touch with TDS Brain. Trying to reconnect.
        </div>
      )}
      {actionError ? (
        <div className="error-banner" role="alert">
          <span>{actionError}</span>
          <button type="button" className="btn" data-variant="quiet" data-size="small" onClick={clearError}>
            Dismiss
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="closed-note" role="status">
          {notice}
        </p>
      ) : null}
    </>
  );
}
