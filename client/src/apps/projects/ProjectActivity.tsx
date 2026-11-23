import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type {
  ActivityItem,
  ComingUpItem,
  ProjectActivityResponse,
} from '../../../../shared/project-activity-contract.ts';
import type { ProjectKey } from '../../../../shared/projects-contract.ts';
import { api } from '../../api.ts';
import { StateNote } from '../../shell/StateNote.tsx';
import { ShellContext } from '../../shell/shell-context.ts';
import { dateWords } from './logic.ts';
import { whenWords } from './ProjectUpdates.tsx';

export interface ActivityState {
  data: ProjectActivityResponse | null;
  error: boolean;
  /** The Overview calls this when the "Since you last looked" card is on screen. */
  markShown: () => void;
  retry: () => void;
}

async function postSeen(key: ProjectKey, token: string): Promise<void> {
  try {
    await api.projectSeen({ key, token });
  } catch {
    // Fire and forget: if it fails the same changes simply show again next time.
  }
}

/**
 * Reads a project's activity once per project and keeps the read's token. When the person leaves the page or switches
 * project, it says what was seen, but only if the "Since you last looked" card was actually shown. Never on open.
 */
export function useProjectActivity(key: ProjectKey, enabled: boolean): ActivityState {
  const [data, setData] = useState<ProjectActivityResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const shown = useRef(false);
  const token = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the read for "Try again".
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    shown.current = false;
    token.current = null;
    setData(null);
    setError(false);
    Promise.resolve()
      .then(() => api.projectActivity(key))
      .then((res) => {
        if (!live) return;
        token.current = res.token;
        setData(res);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
      if (shown.current && token.current) void postSeen(key, token.current);
    };
  }, [key, enabled, attempt]);

  const markShown = useCallback(() => {
    shown.current = true;
  }, []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, error, markShown, retry };
}

/** The tab dot: there is something new since the person last looked. */
export const hasNews = (a: ActivityState): boolean => (a.data?.items.length ?? 0) > 0;

function SinceLine({ item, onOpen }: { item: ActivityItem; onOpen: () => void }) {
  const bits = [item.at ? whenWords(item.at) : '', item.byName ?? ''].filter(Boolean);
  return (
    <li>
      <button type="button" className="line proj-activity-row" onClick={onOpen}>
        <span className="line-text">
          <span className="line-title">{item.text}</span>
          {bits.length > 0 ? <span className="line-meta">{bits.join(' · ')}</span> : null}
        </span>
      </button>
    </li>
  );
}

/**
 * The two cards at the top of a project's Overview: "Since you last looked" and "Coming up".
 * `onUpdates` switches to the Updates tab.
 */
export function ProjectActivity({
  projectKey,
  activity,
  onUpdates,
}: {
  projectKey: ProjectKey;
  activity: ActivityState;
  onUpdates: () => void;
}) {
  const shell = useContext(ShellContext);
  const dispatch = shell?.dispatch ?? (() => {});
  const [message, setMessage] = useState('');
  const { data, error, markShown, retry } = activity;
  const sinceShown = data !== null;
  useEffect(() => {
    if (sinceShown) markShown();
  }, [sinceShown, markShown]);

  const openTodo = (key: string) => {
    dispatch({ type: 'open-drawer', drawer: 'todos' });
    dispatch({ type: 'open-todo', key, mode: 'read' });
  };
  // A file opens in the viewer the way the Files tab does; it is found among the project's files by its path.
  const openFile = async (path: string) => {
    setMessage('');
    try {
      const lists = await Promise.all([
        api.projectFiles(projectKey, 'document'),
        api.projectFiles(projectKey, 'image'),
      ]);
      const item = lists.flatMap((l) => l.items).find((i) => i.path === path);
      if (item) dispatch({ type: 'open-viewer', viewer: { item } });
      else setMessage("That file can't be opened from here. Look for it under Files.");
    } catch {
      setMessage("That file can't be opened from here. Look for it under Files.");
    }
  };
  const open = (t: ActivityItem['target']) => {
    if (t.kind === 'todo') openTodo(t.key);
    else if (t.kind === 'file') void openFile(t.path);
    else onUpdates();
  };

  return (
    <>
      <section className="card proj-card" aria-labelledby="proj-since">
        <div className="card-head">
          <h3 id="proj-since">Since you last looked</h3>
        </div>
        {error ? (
          <StateNote kind="error" onRetry={retry}>
            Couldn't read what's changed.
          </StateNote>
        ) : !data ? (
          <StateNote kind="loading" />
        ) : data.since === null ? (
          <p className="proj-note">Changes will show here from your next visit.</p>
        ) : data.items.length === 0 ? (
          <StateNote kind="empty">Nothing new since you last looked.</StateNote>
        ) : (
          <ul className="lib-list">
            {data.items.map((item, i) => (
              // Items can repeat, so the position keeps keys unique.
              // biome-ignore lint/suspicious/noArrayIndexKey: read-only list, never reordered
              <SinceLine key={i} item={item} onOpen={() => open(item.target)} />
            ))}
            {data.more > 0 ? (
              <li className="proj-note">{data.more === 1 ? '1 more' : `${data.more} more`}</li>
            ) : null}
          </ul>
        )}
        {message ? (
          <p className="proj-note" role="status">
            {message}
          </p>
        ) : null}
      </section>

      <section className="card proj-card" aria-labelledby="proj-coming">
        <div className="card-head">
          <h3 id="proj-coming">Coming up</h3>
        </div>
        {error ? null : !data ? (
          <StateNote kind="loading" />
        ) : data.comingUp.length === 0 ? (
          <StateNote kind="empty">Nothing due in the next two weeks.</StateNote>
        ) : (
          <ul className="lib-list">
            {data.comingUp.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: read-only list, never reordered
              <ComingLine key={i} item={c} onOpen={openTodo} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ComingLine({ item, onOpen }: { item: ComingUpItem; onOpen: (key: string) => void }) {
  const body = (
    <>
      <span className="line-text">
        <span className="line-title">{item.text}</span>
        <span className="line-meta">{dateWords(item.date)}</span>
      </span>
      {item.overdue ? <span className="chip proj-overdue">Overdue</span> : null}
    </>
  );
  const target = item.target;
  return (
    <li>
      {target ? (
        <button type="button" className="line proj-activity-row" onClick={() => onOpen(target.key)}>
          {body}
        </button>
      ) : (
        <div className="line">{body}</div>
      )}
    </li>
  );
}
