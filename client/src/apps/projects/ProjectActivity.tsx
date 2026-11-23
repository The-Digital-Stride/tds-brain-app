import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type {
  ActivityItem,
  ComingUpItem,
  ProjectActivityResponse,
} from '../../../../shared/project-activity-contract.ts';
import type { ProjectKey } from '../../../../shared/projects-contract.ts';
import { api } from '../../api.ts';
import { ShowMore } from '../../shell/ShowMore.tsx';
import { StateNote } from '../../shell/StateNote.tsx';
import { ShellContext } from '../../shell/shell-context.ts';
import { useStore } from '../../store.tsx';
import { openLibraryItem } from '../shared/search.ts';
import { dateWords } from './logic.ts';
import { whenWords } from './ProjectUpdates.tsx';

/** Rows shown before "Show N more changes", as Home's cards (design system: shared ShowMore). */
const SINCE_ROWS = 5;

/** What Clear did: marked the list seen, found the read too old to mark (nothing marked), or failed. */
export type ClearResult = 'cleared' | 'stale' | 'failed';

export interface ActivityState {
  data: ProjectActivityResponse | null;
  error: boolean;
  /** The Overview calls this when the "Since you last looked" card is on screen. */
  markShown: () => void;
  retry: () => void;
  /** Marks what the read listed as seen, then reads again quietly (no loading state). */
  clear: () => Promise<ClearResult>;
}

async function postSeen(key: ProjectKey, token: string): Promise<void> {
  try {
    await api.projectSeen({ key, token });
  } catch {
    // Fire and forget: if it fails the same changes simply show again next time.
  }
}

/**
 * Reads a project's activity once per project and keeps the read's token. The list stays until the person presses
 * Clear (Ian, 2026-11-23), so leaving never marks listed changes seen. Leaving does mark an EMPTY card seen (first
 * visit, or nothing new) when it was shown: otherwise a first visit would never start the "since" clock.
 */
export function useProjectActivity(key: ProjectKey, enabled: boolean): ActivityState {
  const [data, setData] = useState<ProjectActivityResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const shown = useRef(false);
  const token = useRef<string | null>(null);
  // Whether the read listed any changes: then only Clear marks them seen.
  const listed = useRef(false);
  // The project being read, so a Clear that finishes after a switch changes nothing.
  const current = useRef(key);
  current.current = key;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the read for "Try again".
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    shown.current = false;
    token.current = null;
    listed.current = false;
    setData(null);
    setError(false);
    Promise.resolve()
      .then(() => api.projectActivity(key))
      .then((res) => {
        if (!live) return;
        token.current = res.token;
        listed.current = res.since !== null && res.items.length > 0;
        setData(res);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
      if (shown.current && !listed.current && token.current) void postSeen(key, token.current);
    };
  }, [key, enabled, attempt]);

  const markShown = useCallback(() => {
    shown.current = true;
  }, []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const clear = useCallback(async (): Promise<ClearResult> => {
    const held = token.current;
    const before = data?.since ?? null;
    if (!held) return 'failed';
    try {
      await api.projectSeen({ key, token: held });
      const res = await api.projectActivity(key);
      if (current.current !== key) return 'failed';
      token.current = res.token;
      listed.current = res.since !== null && res.items.length > 0;
      setData(res);
      // The server says nothing when a token has expired (12 hours, or a restart), so an unchanged "since" means
      // nothing was marked. Never post again: the fresh list may hold changes the person hasn't seen.
      return res.since !== before ? 'cleared' : 'stale';
    } catch {
      return 'failed';
    }
  }, [key, data]);

  return { data, error, markShown, retry, clear };
}

/**
 * What a row does when pressed: open the to-do panel (only for a to-do on this person's lists, the only ones the
 * panel can show), switch tab, open a file, or nothing (a finished to-do that isn't on their lists).
 */
type RowAction = { panel: boolean; run: () => void } | null;

function SinceLine({ item, action }: { item: ActivityItem; action: RowAction }) {
  // The name is left out when the row already starts with it ("Alex Morgan added a call").
  const name = item.byName && !item.text.startsWith(item.byName) ? item.byName : '';
  const bits = [item.at ? whenWords(item.at) : '', name].filter(Boolean);
  const text = (
    <span className="line-text">
      <span className="line-title">{item.text}</span>
      {bits.length > 0 ? <span className="line-meta">{bits.join(' · ')}</span> : null}
    </span>
  );
  return (
    <li>
      {action ? (
        <button
          type="button"
          className="line"
          onClick={action.run}
          aria-haspopup={action.panel ? 'dialog' : undefined}
        >
          {text}
        </button>
      ) : (
        <div className="line proj-static">{text}</div>
      )}
    </li>
  );
}

/**
 * The two cards at the top of a project's Overview: "Since you last looked" and "Coming up".
 * `onUpdates` and `onTodos` switch to the Updates and To-dos tabs.
 */
export function ProjectActivity({
  projectKey,
  activity,
  onUpdates,
  onTodos,
}: {
  projectKey: ProjectKey;
  activity: ActivityState;
  onUpdates: () => void;
  onTodos: () => void;
}) {
  const { todos, openView } = useStore();
  const shell = useContext(ShellContext);
  const dispatch = shell?.dispatch ?? (() => {});
  const [message, setMessage] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Where focus goes once a Clear has re-rendered the card: its heading, or Clear itself when nothing was cleared.
  const [focusTo, setFocusTo] = useState<'heading' | 'clear' | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const clearButton = useRef<HTMLButtonElement>(null);
  const { data, error, markShown, retry, clear } = activity;
  const sinceShown = data !== null;
  useEffect(() => {
    if (sinceShown) markShown();
  }, [sinceShown, markShown]);
  useEffect(() => {
    if (!focusTo) return;
    ((focusTo === 'clear' ? clearButton.current : null) ?? heading.current)?.focus();
    setFocusTo(null);
  }, [focusTo]);
  const listed = data !== null && data.since !== null && data.items.length > 0;

  // Clear acts at once, with no Undo (design system Actions rule 4): the changes are still on their tabs.
  const onClear = async () => {
    if (clearing) return;
    setClearing(true);
    setMessage('');
    const result = await clear();
    setClearing(false);
    setShowAll(false);
    if (result === 'cleared') {
      setMessage('Cleared. New changes will show here.');
      setFocusTo('heading');
    } else if (result === 'stale') {
      setMessage('This list was out of date, so nothing was cleared.');
      setFocusTo('clear');
    } else {
      setMessage("Couldn't clear the list. Try again.");
    }
  };

  const openTodo = (key: string) => {
    dispatch({ type: 'open-drawer', drawer: 'todos' });
    dispatch({ type: 'open-todo', key, mode: 'read' });
  };
  // A file opens in its app (Documents or Images), chosen there with its details in the panel, as the viewer's
  // "Open in Documents" does. It is found among the project's files by its path, then its library by its id.
  const openFile = async (path: string) => {
    setMessage('');
    const missing = "That file can't be opened from here. Look for it under Files.";
    try {
      const lists = await Promise.all([
        api.projectFiles(projectKey, 'document'),
        api.projectFiles(projectKey, 'image'),
      ]);
      const item = lists.flatMap((l) => l.items).find((i) => i.path === path);
      const found = item ? (await api.libraryItems([item.id])).files[0] : undefined;
      if (!found) {
        setMessage(missing);
        return;
      }
      const app = found.item.kind === 'image' ? 'images' : 'documents';
      openLibraryItem(app, found.scope.id, found.item);
      openView(`app:${app}`);
      dispatch({ type: 'set-panel', open: true });
    } catch {
      setMessage(missing);
    }
  };
  // The panel can only show a to-do on this person's lists (a teammate's, or a finished one, would leave an
  // empty panel over a locked page). A teammate's open to-do is listed on the To-dos tab instead.
  const onMyLists = (key: string) =>
    todos !== null && (todos.mine.some((t) => t.key === key) || todos.open.some((t) => t.key === key));
  const todoAction = (key: string, stillOpen: boolean): RowAction =>
    onMyLists(key)
      ? { panel: true, run: () => openTodo(key) }
      : stillOpen
        ? { panel: false, run: onTodos }
        : null;
  const sinceAction = (item: ActivityItem): RowAction => {
    const t = item.target;
    if (t.kind === 'todo') return todoAction(t.key, item.kind !== 'todo-closed');
    if (t.kind === 'file') return { panel: false, run: () => void openFile(t.path) };
    return { panel: false, run: onUpdates };
  };

  return (
    <>
      <section className="card proj-card" aria-labelledby="proj-since">
        <div className="card-head">
          <h3 id="proj-since" ref={heading} tabIndex={-1}>
            Since you last looked
          </h3>
          {listed ? <span className="count">{data.items.length + data.more}</span> : null}
          {listed ? (
            <button
              ref={clearButton}
              type="button"
              className="btn"
              data-variant="quiet"
              data-size="small"
              aria-label="Clear Since you last looked"
              aria-disabled={clearing || undefined}
              onClick={() => void onClear()}
            >
              Clear
            </button>
          ) : null}
        </div>
        {error ? (
          <StateNote kind="error" onRetry={retry}>
            Couldn't read what's changed.
          </StateNote>
        ) : !data ? (
          <StateNote kind="loading" />
        ) : data.since === null ? (
          <StateNote kind="empty">Changes will show here from your next visit.</StateNote>
        ) : data.items.length === 0 ? (
          // Just after Clear the status line below says it; one note, not two.
          message ? null : (
            <StateNote kind="empty">Nothing new since you last looked.</StateNote>
          )
        ) : (
          <>
            <ul className="lib-list">
              {(showAll ? data.items : data.items.slice(0, SINCE_ROWS)).map((item, i) => (
                // Items can repeat, so the position keeps keys unique.
                // biome-ignore lint/suspicious/noArrayIndexKey: read-only list, never reordered
                <SinceLine key={i} item={item} action={sinceAction(item)} />
              ))}
            </ul>
            {data.items.length > SINCE_ROWS ? (
              <div className="proj-more">
                <ShowMore
                  expanded={showAll}
                  count={data.items.length - SINCE_ROWS}
                  noun={{ one: 'change', many: 'changes' }}
                  wording="more"
                  onToggle={() => setShowAll((v) => !v)}
                />
              </div>
            ) : null}
            {showAll && data.more > 0 ? (
              <p className="hint proj-more">
                {data.more === 1 ? '1 more change is' : `${data.more} more changes are`} on the To-dos,
                Updates and Files tabs.
              </p>
            ) : null}
          </>
        )}
        {/* Always in the page, so the words are announced when they change. */}
        <p className={message ? 'proj-note' : 'visually-hidden'} role="status">
          {message}
        </p>
      </section>

      {error ? null : (
        <section className="card proj-card" aria-labelledby="proj-coming">
          <div className="card-head">
            <h3 id="proj-coming">Coming up</h3>
          </div>
          {!data ? (
            <StateNote kind="loading" />
          ) : data.comingUp.length === 0 ? (
            <StateNote kind="empty">Nothing due in the next two weeks.</StateNote>
          ) : (
            <ul className="lib-list">
              {data.comingUp.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: read-only list, never reordered
                <ComingLine key={i} item={c} action={c.target ? todoAction(c.target.key, true) : null} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function ComingLine({ item, action }: { item: ComingUpItem; action: RowAction }) {
  const body = (
    <>
      <span className="line-text">
        <span className="line-title">{item.text}</span>
        <span className="line-meta">{dateWords(item.date)}</span>
      </span>
      {item.overdue ? (
        <span className="badge" data-tone="warn">
          Overdue
        </span>
      ) : null}
    </>
  );
  return (
    <li>
      {action ? (
        <button
          type="button"
          className="line"
          aria-haspopup={action.panel ? 'dialog' : undefined}
          onClick={action.run}
        >
          {body}
        </button>
      ) : (
        <div className="line proj-static">{body}</div>
      )}
    </li>
  );
}
