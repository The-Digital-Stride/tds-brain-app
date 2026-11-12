import type { ReactNode } from 'react';
import type { Bootstrap } from '../../../shared/contract.ts';
import { type Gate, useStore } from '../store.tsx';

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="gate">
      <div className="card gate-card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function Loading() {
  return (
    <main className="gate" aria-busy="true">
      <div className="card gate-card">
        <div className="spinner" aria-hidden="true" />
        <p role="status">Opening TDS Brain.</p>
      </div>
    </main>
  );
}

export function GateScreen({ gate, retry }: { gate: Exclude<Gate, 'ready' | 'loading'>; retry: () => void }) {
  if (gate === 'not-signed-in') {
    return (
      <Panel title="Open TDS Brain from its launcher">
        <p>
          This page needs to be opened from the TDS Brain launcher on your computer, so it knows it is you.
        </p>
        <p className="lede">Close this tab and start TDS Brain again.</p>
      </Panel>
    );
  }
  return (
    <Panel title="Can't reach TDS Brain">
      <p role="status">
        TDS Brain isn't answering on this computer. It may still be starting, or it may have been closed. This
        page will keep trying quietly.
      </p>
      <div>
        <button type="button" className="btn" onClick={retry}>
          Try again now
        </button>
      </div>
    </Panel>
  );
}

/** Problems with the brain folder or Claude Code stop the app before the shell appears. */
export function BootProblem({ boot, retry }: { boot: Bootstrap; retry: () => void }) {
  const { setSetupOpen } = useStore();
  if (!boot.brain.ok) {
    return (
      <Panel title="There's a problem with your brain folder">
        <p>TDS Brain needs your Agency Brain folder to work.</p>
        {boot.brain.problems.length > 0 ? (
          <ul className="problem-list">
            {boot.brain.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        <p className="lede">Looked in: {boot.brain.path}</p>
        <div className="setup-actions">
          <button type="button" className="btn" onClick={retry}>
            Check again
          </button>
          <button type="button" className="btn" onClick={() => setSetupOpen(true)}>
            Choose a different folder
          </button>
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="Claude Code isn't ready">
      <p>{boot.engine.problem ?? 'Claude Code could not be started on this computer.'}</p>
      <div>
        <button type="button" className="btn" onClick={retry}>
          Check again
        </button>
      </div>
    </Panel>
  );
}
