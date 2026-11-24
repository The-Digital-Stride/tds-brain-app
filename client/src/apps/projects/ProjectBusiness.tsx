import { Fragment, useContext, useEffect, useState } from 'react';
import type { ProjectBusinessResponse } from '../../../../shared/project-business-contract.ts';
import { INTERNAL_CLIENT, type ProjectKey } from '../../../../shared/projects-contract.ts';
import { api } from '../../api.ts';
import { Markdown } from '../../markdown.tsx';
import { Fold } from '../../shell/Fold.tsx';
import { StateNote } from '../../shell/StateNote.tsx';
import { ShellContext } from '../../shell/shell-context.ts';
import { useStore } from '../../store.tsx';
import { openLibraryItem } from '../shared/search.ts';

/** Only a live client project can have a business file (the server agrees: everything else answers 'none'). */
export function showsBusiness(card: { archived: boolean; space: string; client: string | null }): boolean {
  return !card.archived && card.space === 'client' && card.client !== null && card.client !== INTERNAL_CLIENT;
}

export interface BusinessState {
  data: ProjectBusinessResponse | null;
  error: boolean;
  retry: () => void;
}

/** Reads the client's business background once per project open (no polling), like useProjectMeetings. */
export function useProjectBusiness(key: ProjectKey, enabled: boolean): BusinessState {
  const [data, setData] = useState<ProjectBusinessResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the read for Try again.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setData(null);
    setError(false);
    Promise.resolve()
      .then(() => api.projectBusiness(key))
      .then((res) => {
        if (live) setData(res);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [key, enabled, attempt]);
  return { data, error, retry: () => setAttempt((n) => n + 1) };
}

/**
 * The "About <client>" card on a project's Overview: key facts and a few sections from the client's business
 * file in the brain. Read only: no edit, update or "ask Claude" control. Renders nothing for a project with
 * no client file to show (state 'none').
 */
export function ProjectBusiness({
  card,
  clients,
  business,
}: {
  card: { client: string | null };
  clients: readonly { slug: string; name: string }[];
  business: BusinessState;
}) {
  const { openView } = useStore();
  const shell = useContext(ShellContext);
  const dispatch = shell?.dispatch ?? (() => {});
  const [message, setMessage] = useState('');
  const { data, error, retry } = business;

  if (data?.state === 'none') return null;
  const name = data?.client?.name ?? clients.find((c) => c.slug === card.client)?.name ?? 'the client';

  // The file is a client file, not a project file, so it is found in that client's library listing by its path
  // (the same listing the Documents app shows), then opened in Documents with its details in the panel.
  const openFile = async () => {
    setMessage('');
    const missing = "The business file can't be opened from here. Look for it in Documents.";
    const path = data?.path;
    const slug = data?.client?.slug;
    if (!path || !slug) {
      setMessage(missing);
      return;
    }
    try {
      const scope = `client:${slug}`;
      const listing = await api.library(scope);
      const item = listing.items.find((i) => i.path === path);
      if (!item) {
        setMessage(missing);
        return;
      }
      openLibraryItem('documents', scope, item);
      openView('app:documents');
      dispatch({ type: 'set-panel', open: true });
    } catch {
      setMessage(missing);
    }
  };

  const openButton = data?.path ? (
    <button
      type="button"
      className="btn"
      data-variant="quiet"
      data-size="small"
      onClick={() => void openFile()}
    >
      Open the business file
    </button>
  ) : null;

  let body: React.ReactNode;
  if (error) {
    body = (
      <StateNote kind="error" onRetry={retry}>
        Couldn't read the client background just now.
      </StateNote>
    );
  } else if (!data) {
    body = <StateNote kind="loading" />;
  } else if (data.state === 'missing') {
    body = (
      <StateNote kind="empty">
        There's no business file for {name} yet. It's made in the brain with client-setup.
      </StateNote>
    );
  } else if (data.state === 'unreadable') {
    body = <StateNote kind="empty">The business file for {name} can't be read.</StateNote>;
  } else {
    const thin = data.facts.length === 0 && data.sections.length === 0;
    body = (
      <>
        {thin ? (
          <StateNote kind="empty">
            {name}'s business file isn't laid out in the usual way, so nothing is picked out here.
          </StateNote>
        ) : null}
        {data.facts.length > 0 ? (
          <dl className="kv">
            {data.facts.map((f) => (
              <Fragment key={f.id}>
                <dt>{f.words}</dt>
                <dd>{f.value}</dd>
              </Fragment>
            ))}
          </dl>
        ) : null}
        {data.sections.map((s) => (
          <Fold key={s.heading} title={s.title} defaultOpen={s.open} level={4}>
            <div>
              <Markdown text={s.markdown} />
              {s.cut ? <p className="hint">Shortened here. Open the business file for the rest.</p> : null}
            </div>
          </Fold>
        ))}
        <p className="hint">
          {data.path
            ? "From the client's business file in the brain. It's changed there, not here."
            : "From the client's profile in the brain. It's changed there, not here."}
        </p>
      </>
    );
  }

  return (
    <section className="card proj-card" aria-labelledby="proj-business">
      <div className="card-head">
        <h3 id="proj-business">About {name}</h3>
        {error ? null : openButton}
      </div>
      {body}
      <p className={message ? 'proj-note' : 'visually-hidden'} role="status">
        {message}
      </p>
    </section>
  );
}
