import { HelpLink } from '../shell/HelpLink.tsx';
import { useLastSync } from '../shell/useLastSync.ts';
import { type HealthCheck, healthChecks, healthSummary, STATE_WORDS } from '../state/health.ts';
import { useStore } from '../store.tsx';

/**
 * The top of Settings: one line saying whether everything is connected and working, then each check
 * with what's wrong and what to do. Updates as things change (the live connection, the brain's last
 * sync, the lists loading). Only the summary line is announced, so a screen reader hears a change
 * once rather than every row.
 */
export function HealthPanel({ checks }: { checks?: HealthCheck[] }) {
  return checks ? <HealthList checks={checks} /> : <OwnHealth />;
}

/** With no checks handed in (Settings hands them in, so one sync poll serves the tab dot and the list), work them out here. */
function OwnHealth() {
  const { boot, streamUp, lists } = useStore();
  const { lastSync, now } = useLastSync();
  if (!boot) return null;
  return <HealthList checks={healthChecks({ boot, streamUp, lists, lastSync, now })} />;
}

function HealthList({ checks }: { checks: HealthCheck[] }) {
  const { setSetupOpen } = useStore();
  const summary = healthSummary(checks);
  return (
    <section aria-labelledby="health-h" className="health">
      <div className="help-inline" data-heading="true">
        <h2 id="health-h">How TDS Cortex is running</h2>
        <HelpLink page="health" />
      </div>
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
