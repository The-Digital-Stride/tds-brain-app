import { useEffect, useState } from 'react';
import { ATTENTION_LABEL, attentionFor, type SessionState } from '../../../shared/contract.ts';
import { formatElapsed, initialSince } from '../state/attention.ts';

const STOPPED: Partial<Record<SessionState, string>> = {
  error: 'This chat stopped because of a problem. You can try sending a message again.',
  closed: 'This chat has ended. Start a new chat to carry on.',
};

/** Thin coloured rule above the message box: ready (green), working (red), needs your answer (amber). */
export function AttentionBar({
  state,
  step,
  lastActivityAt,
  stateSince,
}: {
  state: SessionState;
  step: string | null;
  lastActivityAt: string | null;
  stateSince: number | null;
}) {
  const attention = attentionFor(state);
  // Only used when no state event has been seen yet.
  const [fallbackSince] = useState(() => initialSince(lastActivityAt, Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const since = stateSince ?? fallbackSince;

  useEffect(() => {
    if (!attention) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [attention]);

  if (!attention) {
    const text = STOPPED[state];
    return text ? (
      <div className="notice" data-level="error">
        {text}
      </div>
    ) : null;
  }

  const elapsed = formatElapsed(now - since, attention);
  const label = ATTENTION_LABEL[attention];
  return (
    <div className="attn-bar">
      <div className="attn-text">
        {attention === 'working' ? (
          <svg className="attn-spinner" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
            <path d="M13.8 2.2v3.2h-3.2" />
          </svg>
        ) : (
          <span className="attn-dot" data-attention={attention} aria-hidden="true" />
        )}
        <span className="attn-label">
          {label}
          {attention === 'working' ? ` ${elapsed}` : ` · ${elapsed}`}
        </span>
        {attention === 'working' && step ? (
          <span className="attn-step">
            {' '}
            {'·'} {step}
          </span>
        ) : null}
      </div>
    </div>
  );
}
