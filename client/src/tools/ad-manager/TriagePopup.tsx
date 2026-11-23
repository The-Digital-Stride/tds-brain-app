import { type RefObject, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { AdsTriageRow } from '../../../../shared/ads-contract.ts';
import { api } from '../../api.ts';
import { StateNote } from '../../shell/StateNote.tsx';
import { useStore } from '../../store.tsx';
import { selectAccount } from './store.ts';
import { actionLabel, adsErrorText, dateWords, daysFromNow, relativeWords, triageWords } from './words.ts';

/** "today", "yesterday", else "Mon 17 Nov": dates keep their capitals mid-sentence. */
const verdictWhen = (d: string) => {
  const n = daysFromNow(d);
  return n !== null && Math.abs(n) <= 1 ? relativeWords(d) : dateWords(d);
};

/**
 * "All accounts' standups" (Release 2, decision 1): every account's latest standup verdict, worst first, read each
 * time it opens. Non-modal and anchored under its button: Esc or a click outside closes it, focus goes to its close
 * button and comes back to the opener. Choosing a row switches the shared account and closes it.
 */
export function TriagePopup({
  account,
  openerRef,
  onClose,
}: {
  account: string;
  openerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { updatePrefs } = useStore();
  const [rows, setRows] = useState<AdsTriageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const head = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the Try again trigger
  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    api
      .adsTriage()
      .then((r) => live && setRows(Array.isArray(r.rows) ? r.rows : []))
      .catch((err) => live && setError(adsErrorText(err)));
    return () => {
      live = false;
    };
  }, [attempt]);

  // Focus to the close button on open, and back to the opener on close.
  useEffect(() => {
    closeBtn.current?.focus();
    const opener = openerRef.current;
    return () => opener?.focus();
  }, [openerRef]);

  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    const away = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && (box.current?.contains(t) || openerRef.current?.contains(t))) return;
      close();
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('mousedown', away);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('mousedown', away);
    };
  }, [close, openerRef]);

  const choose = (key: string) => {
    if (key !== account) {
      selectAccount(key);
      void updatePrefs({ adsAccount: key });
    }
    close();
  };

  return (
    <div className="popover" role="dialog" aria-labelledby={head} ref={box}>
      <div className="cc-triage-head">
        <h4 id={head}>All accounts' standups</h4>
        <button
          type="button"
          className="btn"
          data-variant="quiet"
          data-size="small"
          ref={closeBtn}
          onClick={close}
        >
          Close
        </button>
      </div>
      <p className="am-sub cc-triage-hint">Worst first. Choose an account to open it.</p>
      {error ? (
        <StateNote kind="error" onRetry={() => setAttempt((n) => n + 1)}>
          {error}
        </StateNote>
      ) : rows === null ? (
        <StateNote kind="loading" />
      ) : rows.length === 0 ? (
        <StateNote kind="empty">No accounts to show.</StateNote>
      ) : (
        <ul className="cc-triage-list">
          {rows.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                className="menu-row"
                aria-current={r.key === account ? 'true' : undefined}
                onClick={() => choose(r.key)}
              >
                <span className="cc-triage-name">
                  {r.name}
                  {r.stale ? <span className="badge">Old</span> : null}
                  {r.verdict ? (
                    r.verdict.flagged > 0 ? (
                      <span className="badge cc-triage-flag" data-tone="waiting">
                        {r.verdict.flagged} flagged
                      </span>
                    ) : (
                      <span className="badge cc-triage-flag" data-tone="muted">
                        Holding
                      </span>
                    )
                  ) : null}
                </span>
                <span className="am-sub">{triageWords(r)}</span>
                {r.verdict &&
                (verdictWhen(r.verdict.date) || (r.verdict.flagged > 0 && r.verdict.topAction)) ? (
                  <span className="am-sub">
                    {[
                      r.verdict.flagged > 0 && r.verdict.topAction
                        ? `Top action: ${actionLabel(r.verdict.topAction)}`
                        : '',
                      verdictWhen(r.verdict.date),
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
