import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TeamMember } from '../../../../shared/contract.ts';
import type {
  ProjectList,
  TidyApply,
  TidyList,
  TidyRow,
  TidySuggestion,
} from '../../../../shared/projects-contract.ts';
import { ApiFailure, api } from '../../api.ts';
import { projectText, useProjects } from '../../state/projects.ts';
import { errorWords, joinWords, personName, slugFromTitle } from './logic.ts';

type Clients = readonly { slug: string; name: string }[];

/** A client's display name from the clients list ("Harvey Nash"); a slug tidied up if it is not listed. */
function clientWords(slug: string | null, clients: Clients): string {
  if (!slug) return 'The Digital Stride';
  const hit = clients.find((c) => c.slug === slug)?.name;
  if (hit) return hit;
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** A suggestion in plain words. */
export function suggestionWords(
  s: TidySuggestion,
  list: ProjectList,
  clients: Clients,
  rows: readonly TidyRow[] = [],
): string {
  const clientName = (slug: string | null) => clientWords(slug, clients);
  switch (s.do) {
    case 'link': {
      const card = list.projects.find((p) => p.key === s.key);
      return `Link to ${card ? projectText(card, clients) : s.key}`;
    }
    case 'client-only':
      return `Set the client to ${clientName(s.client)}, with no project`;
    case 'merge': {
      const target = list.projects.find((p) => p.slug === s.into || p.key === s.into);
      const n = target ? target.openTodos : rows.find((r) => r.label === s.into)?.todos.length;
      return n === undefined
        ? `Rename to '${s.into}'`
        : `Rename to '${s.into}', joining its ${n} to-do${n === 1 ? '' : 's'}`;
    }
    case 'clear':
      return 'Remove the label. It is only a placeholder';
    case 'new-project':
      return `Make a new project '${s.slug}' for ${clientName(s.client)}`;
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
  approveOff,
  rows,
  onApply,
}: {
  row: TidyRow;
  list: ProjectList;
  clients: Clients;
  busy: boolean;
  canChange: boolean;
  /** The server says to-do changes are switched off: no Approve, Change or Apply. */
  approveOff: boolean;
  rows: readonly TidyRow[];
  onApply: (apply: TidyApply) => void;
}) {
  const [changing, setChanging] = useState(false);
  const [choice, setChoice] = useState('');
  const firstClient = row.todos.find((t) => t.client)?.client ?? '';
  const [clientPick, setClientPick] = useState(firstClient);
  const selectId = useId();
  const clientId = useId();
  const newSlug = row.suggestion.do === 'new-project' ? row.suggestion.slug : slugFromTitle(row.label);
  const options = useMemo(() => list.projects.filter((p) => !p.archived), [list]);

  const picked = (): TidySuggestion | null => {
    if (choice === '__clear') return { do: 'clear', why: 'placeholder' };
    if (choice === '__new' && newSlug) {
      return {
        do: 'new-project',
        client: row.suggestion.do === 'new-project' ? row.suggestion.client : firstClient || null,
        slug: newSlug,
        why: 'no-match',
      };
    }
    if (choice === '__client') {
      return clientPick ? { do: 'client-only', client: clientPick, why: 'is-a-client' } : null;
    }
    if (choice && !choice.startsWith('__')) return { do: 'link', key: choice, why: 'same-slug' };
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
      <p className="proj-suggest">{suggestionWords(row.suggestion, list, clients, rows)}</p>
      <ul className="proj-tidy-todos">
        {shown.map((t) => (
          <li key={`${t.scope}/${t.id}`}>
            {t.title}
            {t.client ? ` (${clientWords(t.client, clients)})` : ''}
          </li>
        ))}
        {row.todos.length > shown.length ? <li>and {row.todos.length - shown.length} more</li> : null}
      </ul>
      {row.conflicts.length > 0 ? (
        <div className="proj-conflicts">
          <p className="proj-hint">Left alone, because they already belong to a different client:</p>
          <ul>
            {row.conflicts.map((c) => (
              <li key={`${c.scope}:${c.id}`}>
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
            {newSlug ? <option value="__new">Make a new project with this name</option> : null}
            <option value="__client">Client only</option>
            {options.map((p) => (
              <option key={p.key} value={p.key}>
                {projectText(p, clients)}
              </option>
            ))}
          </select>
          {choice === '__client' ? (
            <>
              <label htmlFor={clientId}>Which client?</label>
              <select
                id={clientId}
                className="field"
                value={clientPick}
                onChange={(e) => setClientPick(e.target.value)}
              >
                <option value="">Choose…</option>
                {clients.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
      ) : null}
      {canChange ? (
        <div className="proj-buttons">
          {changing && !approveOff ? (
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
              {approveOff ? null : (
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
                </>
              )}
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
  me = '',
  team,
}: {
  list: ProjectList;
  clients: Clients;
  onBack: () => void;
  canChange: boolean;
  me?: string;
  team?: readonly TeamMember[];
}) {
  const { refresh } = useProjects();
  const [tidy, setTidy] = useState<TidyList | null>(null);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const [approveOff, setApproveOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const list$ = useRef<HTMLUListElement>(null);
  // Where focus goes once the rows have been redrawn: the row now at this place, else the heading.
  const focusAt = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      setTidy(await api.tidy());
    } catch (err) {
      setMessage(failWords(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // After every apply the rows are redrawn from the list the server sends back.
  const apply = async (a: TidyApply) => {
    const index = tidy?.rows.findIndex((r) => r.label === a.label) ?? -1;
    const row = index >= 0 ? tidy?.rows[index] : undefined;
    setBusy(true);
    setMessage('');
    setStatus('');
    try {
      const next = await api.applyTidy(a);
      focusAt.current = index >= 0 ? index : null;
      setTidy(next);
      if (a.do === 'approve' && row) setStatus(doneWords(row, a.suggestion, list, clients, me, team));
      void refresh();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === 'not-allowed' && /settings/i.test(err.message)) {
        setApproveOff(true);
      }
      setMessage(failWords(err));
      void load();
    }
    setBusy(false);
  };

  useEffect(() => {
    const at = focusAt.current;
    if (at === null || !tidy) return;
    focusAt.current = null;
    const rows = list$.current?.querySelectorAll<HTMLElement>(':scope > li') ?? [];
    const target = rows[Math.min(at, rows.length - 1)];
    const button = target?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    if (button) button.focus();
    else heading.current?.focus();
  }, [tidy]);

  return (
    <>
      <div className="proj-head">
        <button type="button" className="btn" data-size="small" onClick={onBack}>
          All projects
        </button>
        <h2 className="proj-title" ref={heading} tabIndex={-1}>
          Tidy up old project labels
        </h2>
      </div>
      <p className="proj-note">
        Some to-dos carry an old project label. Approve, change or skip each one. Nothing is changed until you
        approve it. Approving changes your teammates' to-dos too, but only their client, project and stage
        lines.
      </p>
      {status ? (
        <p className="proj-note" role="status">
          {status}
        </p>
      ) : null}
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
        <ul className="proj-tidy" ref={list$}>
          {tidy.rows.map((r) => (
            <Row
              key={r.label}
              row={r}
              list={list}
              clients={clients}
              busy={busy}
              canChange={canChange}
              approveOff={approveOff}
              rows={tidy.rows}
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

/** "Linked 3 to-dos (2 belong to Simon) to Client Portal", from the row as it was before the apply. */
function doneWords(
  row: TidyRow,
  s: TidySuggestion,
  list: ProjectList,
  clients: Clients,
  me: string,
  team: readonly TeamMember[] | undefined,
): string {
  const n = row.todos.length;
  const todos = `${n} to-do${n === 1 ? '' : 's'}`;
  const theirs = row.todos.filter((t) => t.assignee && t.assignee !== me);
  const owners = [...new Set(theirs.map((t) => t.assignee as string))];
  const whose =
    theirs.length === 0
      ? ''
      : ` (${theirs.length} ${theirs.length === 1 ? 'belongs' : 'belong'} to ${
          owners.length <= 2 ? joinWords(owners.map((o) => personName(o, team))) : 'teammates'
        })`;
  switch (s.do) {
    case 'link': {
      const card = list.projects.find((p) => p.key === s.key);
      return `Linked ${todos}${whose} to ${card ? projectText(card, clients) : s.key}.`;
    }
    case 'client-only':
      return `Set the client on ${todos}${whose} to ${clientWords(s.client, clients)}.`;
    case 'merge':
      return `Renamed ${todos}${whose} to '${s.into}'.`;
    case 'clear':
      return `Removed the label from ${todos}${whose}.`;
    case 'new-project':
      return `Made the project '${s.slug}' and linked ${todos}${whose} to it.`;
    case 'skip':
      return '';
  }
}
