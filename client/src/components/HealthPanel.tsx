import { useLastSync } from '../shell/useLastSync.ts';
import { healthChecks, healthSummary, STATE_WORDS } from '../state/health.ts';
import { useStore } from '../store.tsx';

/**
 * The top of Settings: one line saying whether everything is connected and working, then each check
 * with what's wrong and what to do. Updates as things change (the live connection, the brain's last
 * sync, the lists loading). Only the summary line is announced, so a screen reader hears a change
 * once rather than every row.
 */
export function HealthPanel() {
  const { boot, streamUp, lists, setSetupOpen } = useStore();
  const { lastSync, now } = useLastSync();
  if (!boot) return null;
  const checks = healthChecks({ boot, streamUp, lists, lastSync, now });
  const summary = healthSummary(checks);
  return (
    <section aria-labelledby="health-h" className="health">
      <h2 id="health-h">How TDS Brain is running</h2>
      <p className="health-summary" data-state={summary.state} role="status">
        <span className="health-dot" data-state={summary.state} aria-hidden="true" />
        {summary.text}
      </p>
      <ul className="health-list">
        {checks.map((c) => (
          <li key={c.id} className="health-check" data-state={c.state}>
            <span className="health-dot" data-state={c.state} aria-hidden="true" />
            <div>
              <p className="health-label">
                {c.label}
                {/* Shown for anything not OK, so colour is never the only signal; OK is said to screen readers only. */}
                {c.state === 'ok' ? (
                  <span className="visually-hidden">: {STATE_WORDS.ok}.</span>
                ) : (
                  <span className="health-tag" data-state={c.state}>
                    <span className="visually-hidden">: </span>
                    {STATE_WORDS[c.state]}
                  </span>
                )}
              </p>
              <p className="health-text">{c.text}</p>
              {c.detail && <code className="about-code health-detail">{c.detail}</code>}
              {c.id === 'brain' && (
                <button
                  type="button"
                  className="btn"
                  data-size="small"
                  aria-label="Change brain folder"
                  onClick={() => setSetupOpen(true)}
                >
                  Change…
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
