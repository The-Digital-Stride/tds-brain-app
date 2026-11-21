import { type FormEvent, useId, useMemo, useState } from 'react';
import type { TeamMember, TodoAction } from '../../../../shared/contract.ts';
import type { ProjectCard, ProjectTodoRow } from '../../../../shared/projects-contract.ts';
import { useShell } from '../../shell/ShellProvider.tsx';
import { useProjects } from '../../state/projects.ts';
import { useStore } from '../../store.tsx';
import { dateWords, groupByStage, personName } from './logic.ts';

/** The project's open to-dos, by stage, and a way to add one with client and project filled in. */
export function ProjectTodos({
  card,
  team,
  me,
  rows,
  failed,
  reload,
  adding,
  onAdding,
}: {
  card: ProjectCard;
  team: readonly TeamMember[] | undefined;
  me: string;
  /** The project's open to-dos from the server, or null while loading. */
  rows: readonly ProjectTodoRow[] | null;
  failed: boolean;
  reload: () => Promise<void>;
  /** The add form is open. Its button sits at the end of the tabs row (ProjectPage), so the state lives there. */
  adding: boolean;
  onAdding: (open: boolean) => void;
}) {
  const { todos, changeTodos } = useStore();
  const { dispatch } = useShell();
  const { refresh } = useProjects();
  const [title, setTitle] = useState('');
  const [stage, setStage] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const titleId = useId();
  const stageId = useId();

  const groups = useMemo(() => groupByStage(rows ?? [], card.stages), [rows, card.stages]);
  // The to-do panel belongs to the To-dos drawer, so open the drawer first.
  const openPanel = (key: string) => {
    dispatch({ type: 'open-drawer', drawer: 'todos' });
    dispatch({ type: 'open-todo', key, mode: 'read' });
  };
  const canAdd = todos?.canProject === true && !card.archived;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = title.trim();
    if (!text) {
      setMessage('Give the to-do a title.');
      return;
    }
    setBusy(true);
    setMessage('');
    const action: TodoAction = {
      kind: 'add',
      title: text,
      due: null,
      assignee: me || null,
      ...(card.space === 'personal' ? { scope: 'personal' as const } : {}),
      client: card.space === 'personal' ? null : card.client,
      project: card.key,
      stage: stage || null,
    };
    const res = await changeTodos([action]);
    setBusy(false);
    if (res.error) {
      setMessage(res.error.message);
      return;
    }
    setTitle('');
    setStage('');
    onAdding(false);
    void refresh();
    void reload();
  };

  return (
    <>
      {canAdd ? null : <p className="proj-note">Update the brain's skills to add to-dos to a project.</p>}
      {adding && canAdd ? (
        <form className="card proj-card proj-form" onSubmit={(e) => void submit(e)} aria-label="Add a to-do">
          <div className="proj-field">
            <label htmlFor={titleId}>To-do</label>
            <input
              id={titleId}
              className="field"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              // biome-ignore lint/a11y/noAutofocus: the person just pressed Add a to-do.
              autoFocus
            />
          </div>
          {card.stages.length > 0 ? (
            <div className="proj-field">
              <label htmlFor={stageId}>Stage</label>
              <select id={stageId} className="field" value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="">No stage</option>
                {card.stages.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {message ? (
            <p className="proj-error" role="alert">
              {message}
            </p>
          ) : null}
          <div className="proj-buttons">
            <button type="submit" className="btn" data-variant="primary" disabled={busy}>
              Add to-do
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                onAdding(false);
                setMessage('');
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {failed && rows === null ? (
        <p className="proj-note" role="alert">
          The to-dos can't be loaded right now.{' '}
          <button type="button" className="btn" data-size="small" onClick={() => void reload()}>
            Try again
          </button>
        </p>
      ) : rows === null ? (
        <p className="proj-note" role="status">
          Loading to-dos…
        </p>
      ) : groups.length === 0 ? (
        <p className="proj-note">No open to-dos in this project.</p>
      ) : (
        <div className="tray lib-tray">
          {groups.map((g) => (
            <section className="card proj-card" key={g.stage || 'none'} aria-label={g.title}>
              <div className="card-head">
                <h3>{g.title}</h3>
                <span className="count">{g.items.length}</span>
              </div>
              <ul className="lib-list">
                {g.items.map((t) => (
                  <li key={t.key} className="line proj-todo">
                    {t.mine ? (
                      <button type="button" className="proj-open" onClick={() => openPanel(t.key)}>
                        <TodoText t={t} team={team} />
                      </button>
                    ) : (
                      <TodoText t={t} team={team} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function TodoText({ t, team }: { t: ProjectTodoRow; team: readonly TeamMember[] | undefined }) {
  return (
    <span className="line-text">
      <span className="line-title">{t.title}</span>
      <span className="line-meta">
        {t.assignee ? personName(t.assignee, team) : 'Open to anyone'}
        {t.due ? ` · due ${dateWords(t.due)}` : ''}
      </span>
    </span>
  );
}
