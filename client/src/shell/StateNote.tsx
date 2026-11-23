import type { ReactNode } from 'react';

/**
 * One empty, loading or error line, at one size (12px, `.lib-note`'s look). Loading says "Loading…" unless told
 * otherwise. An error with `onRetry` gets the standard "Try again" button.
 */
export function StateNote({
  kind,
  children,
  onRetry,
}: {
  kind: 'empty' | 'loading' | 'error';
  children?: ReactNode;
  onRetry?: () => void;
}) {
  const text = children ?? (kind === 'loading' ? 'Loading…' : null);
  return (
    <p
      className="hint"
      data-kind={kind}
      role={kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined}
    >
      {text}
      {kind === 'error' && onRetry ? (
        <>
          {' '}
          <button type="button" className="btn" data-size="small" onClick={onRetry}>
            Try again
          </button>
        </>
      ) : null}
    </p>
  );
}
