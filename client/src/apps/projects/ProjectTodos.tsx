import { useMemo, useRef } from 'react';
import type { TeamMember } from '../../../../shared/contract.ts';
import type { ProjectCard, ProjectDoneRow, ProjectTodoRow } from '../../../../shared/projects-contract.ts';
import { Fold } from '../../shell/Fold.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { NO_FAVOURITES, StarButton, useStarFocus } from '../../shell/StarButton.tsx';
import { TodoChatButton } from '../../shell/TodoChatButton.tsx';
import { useStore } from '../../store.tsx';
import { dateWords, groupByStage, personName } from './logic.ts';

/** The project's open to-dos, by stage. Its Add a to-do button (ProjectPage) opens the To-dos panel's full form. */
export function ProjectTodos({
  card,
  team,
  rows,
  done,
  doneCount,
  failed,
  reload,
}: {
  card: ProjectCard;
  team: readonly TeamMember[] | undefined;
  /** The project's open to-dos from the server, or null while loading. */
  rows: readonly ProjectTodoRow[] | null;
  /** The project's finished to-dos, newest first. Absent from an older server: no Done section. */
  done?: readonly ProjectDoneRow[] | undefined;
  doneCount?: number | undefined;
  failed: boolean;
  reload: () => Promise<void>;
}) {
  const { todos, boot, toggleFavouriteTodo, openSettings, revealDoneTodo } = useStore();
  const { dispatch } = useShell();
  // The same star as the To-dos drawer's rows; focus follows a to-do whose star moved it.
  const favs = boot?.prefs?.favouriteTodos ?? NO_FAVOURITES;
  const trayRef = useRef<HTMLDivElement>(null);
  const rememberStar = useStarFocus(trayRef, favs);
  const star = (key: string, button: HTMLElement) => {
    rememberStar(key, button);
    void toggleFavouriteTodo(key);
  };

  const groups = useMemo(() => groupByStage(rows ?? [], card.stages), [rows, card.stages]);
  // The to-do panel belongs to the To-dos drawer, so open the drawer first.
  const openPanel = (key: string) => {
    dispatch({ type: 'open-drawer', drawer: 'todos' });
    dispatch({ type: 'open-todo', key, mode: 'read' });
  };
  // A finished to-do opens in the drawer's read-only panel, as the global search does it.
  const openDone = (key: string) => {
    dispatch({ type: 'open-drawer', drawer: 'todos' });
    revealDoneTodo(key);
  };
  const doneSection =
    done && done.length > 0 ? (
      <Fold title="Done" count={doneCount ?? done.length} defaultOpen={false}>
        <ul className="lib-list">
          {done.map((t) => (
            <li key={t.key} className="line proj-todo">
              <button type="button" className="proj-open" onClick={() => openDone(t.key)}>
                <span className="line-text">
                  <span className="line-title">{t.title}</span>
                  <span className="line-meta">
                    {doneRowMeta(t)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Fold>
    ) : null;
  return (
    <>
      {card.archived ? null : todos?.changes === 'switched-off' ? (
        <p className="proj-note">
          Adding to-dos is switched off. Turn on 'Let the app change to-dos' in{' '}
          <button type="button" className="link-btn" onClick={() => openSettings('general', 'set-direct')}>
            Settings
          </button>
          .
        </p>
      ) : todos?.canProject === true &&
        (card.space !== 'personal' || todos.canUsePersonal === true) ? null : (
        <p className="proj-note">Update the brain's skills to add to-dos to a project.</p>
      )}
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
        <>
          <p className="proj-note">No open to-dos in this project.</p>
          {doneSection}
        </>
      ) : (
        <div className="tray lib-tray" ref={trayRef} tabIndex={-1}>
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
                    {/* The same buttons, in the same order, as a To-dos drawer row (Actions rules 2 and 10). Only on my
                        to-dos: the server links a chat only to a to-do on my lists, and Home lists only those stars. */}
                    {t.mine ? (
                      <div className="todo-btns">
                        <StarButton
                          id={t.key}
                          title={t.title}
                          on={favs.includes(t.key)}
                          onPress={(_, button) => star(t.key, button)}
                        />
                        <TodoChatButton
                          todo={{
                            key: t.key,
                            path: t.scope === 'personal' ? `personal/todo/${t.id}` : `todo/${t.id}`,
                            title: t.title,
                            client: card.client,
                            project: card.archived ? null : card.key,
                          }}
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {doneSection}
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
        {t.mine
          ? t.assignee
            ? personName(t.assignee, team)
            : 'Open to anyone'
          : t.assignee
            ? `Assigned to ${personName(t.assignee, team)}`
            : 'Not assigned'}
        {t.due ? ` · due ${dateWords(t.due)}` : ''}
      </span>
    </span>
  );
}

/**
 * A finished row's line, worded as the To-dos drawer's Done rows (who ticked it, not who had it): "Done by Sam,
 * 20 Nov 2026". The year stays: the project's Done list has no month groups to give it.
 */
export function doneRowMeta(t: Pick<ProjectDoneRow, 'doneDate' | 'doneBy'>): string {
  const first = t.doneBy?.split(/\s+/)[0] ?? '';
  if (!t.doneDate) return first ? `Done by ${first}; date not known` : 'Done; date not known';
  return `${first ? `Done by ${first}` : 'Done'}, ${dateWords(t.doneDate)}`;
}
