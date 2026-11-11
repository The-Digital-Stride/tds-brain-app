import { useStore } from '../store.tsx';
import type { SheetNoticesProps } from './contract.ts';

/** The lines any sheet can show: lost connection, the last action's error, and a brief notice. */
export function SheetNotices(_: SheetNoticesProps) {
  const { streamUp, actionError, clearError, notice } = useStore();
  return (
    <>
      {streamUp ? null : (
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
