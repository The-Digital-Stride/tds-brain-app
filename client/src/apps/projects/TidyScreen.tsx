import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type {
  ProjectList,
  TidyApply,
  TidyList,
  TidyRow,
  TidySuggestion,
} from '../../../../shared/projects-contract.ts';
import { ApiFailure, api } from '../../api.ts';
import { projectText, useProjects } from '../../state/projects.ts';
import { errorWords } from './logic.ts';

type Clients = readonly { slug: string; name: string }[];

/** A suggestion in plain words. */
export function suggestionWords(s: TidySuggestion, list: ProjectList, clients: Clients): string {
  const clientName = (slug: string | null) =>
    slug ? (clients.find((c) => c.slug === slug)?.name ?? slug) : 'The Digital Stride';
  switch (s.do) {
    case 'link': {
      const card = list.projects.find((p) => p.key === s.key);
      return `Link to ${card ? projectText(card, clients) : s.key}`;
    }
    case 'client-only':
      return `Set the client to ${clientName(s.client)}, with no project`;
    case 'merge':
      return `Treat as the same as “${s.into}”`;
    case 'clear':
      return 'Remove the label. It is only a placeholder';
    case 'new-project':
      return `Make a new project “${s.slug}” for ${clientName(s.client)}`;
    case 'skip':
      return 'No match found. Choose a project, or skip it';
  }
}

function Row({
  row,
  list,
  clients,
  busy,
  canChange,
  onApply,
}: {
  row: TidyRow;
  list: ProjectList;
  clients: Clients;
  busy: boolean;
  canChange: boolean;
  onApply: (apply: TidyApply) => void;
}) {
  const [changing, setChanging] = useState(false);
  const [choice, setChoice] = useState('');
  const selectId = useId();
  const options = useMemo(() => list.projects.filter((p) => !p.archived), [list]);

  const picked = (): TidySuggestion | null => {
    if (choice === '__clear') return { do: 'clear', why: 'placeholder' };
    if (choice) return { do: 'link', key: choice, why: 'same-slug' };
    return null;
  };
  const shown = row.todos.slice(0, 3);

  return (
    <li className="card proj-card proj-tidy-row" aria-label={`Label ${row.label}`}>
      <div className="card-head">
        <h3>
          <code>{row.label}</code>
        </h3>
        <span className="count">{row.todos.length}</span>
      </div>
      <p className="proj-suggest">{suggestionWords(row.suggestion, list, clients)}</p>
      <ul className="proj-tidy-todos">
        {shown.map((t) => (
          <li key={`${t.scope}/${t.id}`}>{t.title}</li>
        ))}
        {row.todos.length > shown.length ? <li>and {row.todos.length - shown.length} more</li> : null}
      </ul>
      {row.conflicts.length > 0 ? (
        <div className="proj-conflicts">
          <p className="proj-hint">Left alone, because they already belong to a different client:</p>
          <ul>
            {row.conflicts.map((c) => (
              <li key={c.id}>
                {c.title} ({clients.find((x) => x.slug === c.client)?.name ?? c.client})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {changing ? (
        <div className="proj-field">
          <label htmlFor={selectId}>Use this instead</label>
          <select id={selectId} className="field" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Choose…</option>
            <option value="__clear">Remove the label</option>
            {options.map((p) => (
              <option key={p.key} value={p.key}>
                {projectText(p, clients)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {canChange ? (
        <div className="proj-buttons">
          {changing ? (
            <>
              <button
                type="button"
                className="btn"
                data-variant="primary"
                data-size="small"
                disabled={busy || picked() === null}
                onClick={() => {
                  const s = picked();
                  if (s) onApply({ label: row.label, do: 'approve', suggestion: s });
                }}
              >
                Apply
              </button>
              <button type="button" className="btn" data-size="small" onClick={() => setChanging(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                data-variant="primary"
                data-size="small"
                disabled={busy || row.suggestion.do === 'skip'}
                onClick={() => onApply({ label: row.label, do: 'approve', suggestion: row.suggestion })}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn"
                data-size="small"
                disabled={busy}
                onClick={() => setChanging(true)}
              >
                Change
              </button>
              <button
                type="button"
                className="btn"
                data-variant="quiet"
                data-size="small"
                disabled={busy}
                onClick={() => onApply({ label: row.label, do: 'skip' })}
              >
                Skip
              </button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

const failWords = (err: unknown): string =>
  err instanceof ApiFailure ? errorWords(err.code, err.message) : errorWords('internal');

/** The one-off tidy-up of old project labels on to-dos (decision 13). Nothing changes until a row is approved. */
export function TidyScreen({
  list,
  clients,
  onBack,
  canChange,
}: {
  list: ProjectList;
  clients: Clients;
  onBack: () => void;
  canChange: boolean;
}) {
  const { refresh } = useProjects();
  const [tidy, setTidy] = useState<TidyList | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTidy(await api.tidy());
      setMessage('');
    } catch (err) {
      setMessage(failWords(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // After every apply the rows are redrawn from the list the server sends back.
  const apply = async (a: TidyApply) => {
    setBusy(true);
    setMessage('');
    try {
      setTidy(await api.applyTidy(a));
      void refresh();
    } catch (err) {
      setMessage(failWords(err));
      void load();
    }
    setBusy(false);
  };

  return (
    <>
      <div className="proj-head">
        <button type="button" className="btn" data-size="small" onClick={onBack}>
          All projects
        </button>
        <h2 className="proj-title">Tidy up old project labels</h2>
      </div>
      <p className="proj-note">
        Some to-dos carry an old project label. Approve, change or skip each one. Nothing is changed until you
        approve it.
      </p>
      {message ? (
        <p className="proj-error" role="alert">
          {message}
        </p>
      ) : null}
      {tidy === null && !message ? (
        <p className="proj-note" role="status">
          Loading…
        </p>
      ) : null}
      {tidy && tidy.rows.length === 0 ? (
        <p className="proj-note" role="status">
          All tidy. There are no old labels left.
        </p>
      ) : null}
      {tidy && tidy.rows.length > 0 ? (
        <ul className="proj-tidy">
          {tidy.rows.map((r) => (
            <Row
              key={r.label}
              row={r}
              list={list}
              clients={clients}
              busy={busy}
              canChange={canChange}
              onApply={(a) => void apply(a)}
            />
          ))}
        </ul>
      ) : null}
      {tidy && tidy.skipped.length > 0 ? (
        <section className="card proj-card" aria-labelledby="proj-skipped">
          <div className="card-head">
            <h3 id="proj-skipped">Skipped</h3>
            <span className="count">{tidy.skipped.length}</span>
          </div>
          <ul className="lib-list">
            {tidy.skipped.map((label) => (
              <li key={label} className="line">
                <span className="line-text">
                  <code>{label}</code>
                </span>
                {canChange ? (
                  <button
                    type="button"
                    className="btn"
                    data-size="small"
                    disabled={busy}
                    aria-label={`Bring back ${label}`}
                    onClick={() => void apply({ label, do: 'unskip' })}
                  >
                    Bring back
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
