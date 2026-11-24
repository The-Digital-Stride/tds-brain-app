import { useEffect, useMemo, useRef, useState } from 'react';
import type { TeamMember } from '../../../../shared/contract.ts';
import type { ProjectCard, ProjectDoneRow, ProjectTodoRow } from '../../../../shared/projects-contract.ts';
import { Fold } from '../../shell/Fold.tsx';
import { Seg } from '../../shell/Seg.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { NO_FAVOURITES, StarButton, useStarFocus } from '../../shell/StarButton.tsx';
import { TodoChatButton } from '../../shell/TodoChatButton.tsx';
import { primeTeamTodo } from '../../state/team-todo.ts';
import { useStore } from '../../store.tsx';
import { dateWords, groupByStage, personName } from './logic.ts';
import { isMyTodo, readTodoWho, saveTodoWho, type TodoWho } from './todo-who.ts';

/**
 * The project's open to-dos, by stage, with an Everyone / Mine switch. Its Add a to-do button (ProjectPage) opens the
 * To-dos panel's full form.
 */
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

  // Everyone's to-dos, or only mine (todo-who.ts says what counts), remembered per person in this browser.
  const me = boot?.identity?.slug ?? null;
  const [picked, setPicked] = useState<TodoWho | null>(null);
  const anyTodos = rows !== null && (rows.length > 0 || (done?.length ?? 0) > 0);
  // Not in a personal project: everything there is mine, so the switch would change nothing.
  const showWho = me !== null && anyTodos && card.space !== 'personal';
  const who: TodoWho = !showWho ? 'everyone' : (picked ?? readTodoWho(me));
  const chooseWho = (next: TodoWho) => {
    setPicked(next);
    if (me) saveTodoWho(me, next);
  };
  const mineRows = useMemo(() => (me ? (rows ?? []).filter((t) => isMyTodo(t, me)) : []), [rows, me]);
  const shownRows = who === 'mine' ? mineRows : (rows ?? []);
  const shownDone = who === 'mine' && me && done ? done.filter((t) => isMyTodo(t, me)) : done;
  const groups = useMemo(() => groupByStage(shownRows, card.stages), [shownRows, card.stages]);
  // "Show everyone's" in the Mine empty state goes away as it is pressed: focus moves to the switch's choice.
  const whoRef = useRef<HTMLDivElement>(null);
  const [focusWho, setFocusWho] = useState(false);
  useEffect(() => {
    if (!focusWho) return;
    setFocusWho(false);
    whoRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [focusWho]);
  // The to-do panel belongs to the To-dos drawer, so open the drawer first.
  const openPanel = (key: string) => {
    primeTeamTodo(key);
    dispatch({ type: 'open-drawer', drawer: 'todos' });
    dispatch({ type: 'open-todo', key, mode: 'read' });
  };
  // A finished to-do opens in the drawer's read-only panel, as the global search does it.
  const openDone = (key: string) => {
    dispatch({ type: 'open-drawer', drawer: 'todos' });
    revealDoneTodo(key);
  };
  const doneSection =
    shownDone && shownDone.length > 0 ? (
      <Fold
        title="Done"
        count={who === 'mine' ? shownDone.length : (doneCount ?? shownDone.length)}
        defaultOpen={false}
      >
        <ul className="lib-list">
          {shownDone.map((t) => (
            <li key={t.key} className="line proj-todo">
              <button type="button" className="proj-open" onClick={() => openDone(t.key)}>
                <span className="line-text">
                  <span className="line-title">{t.title}</span>
                  <span className="line-meta">{doneRowMeta(t)}</span>
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
          Adding tasks is switched off. Turn on 'Let the app change tasks' in{' '}
          <button type="button" className="link-btn" onClick={() => openSettings('general', 'set-direct')}>
            Settings
          </button>
          .
        </p>
      ) : todos?.canProject === true &&
        (card.space !== 'personal' || todos.canUsePersonal === true) ? null : (
        <p className="proj-note">Update the brain's skills to add tasks to a project.</p>
      )}
      {showWho ? (
        <div className="proj-tools" ref={whoRef}>
          <Seg
            label="Whose tasks"
            value={who}
            options={[
              { value: 'everyone', label: `Everyone, ${rows?.length ?? 0}` },
              { value: 'mine', label: `Mine, ${mineRows.length}` },
            ]}
            onChange={chooseWho}
          />
        </div>
      ) : null}
      {failed && rows === null ? (
        <p className="proj-note" role="alert">
          The tasks can't be loaded right now.{' '}
          <button type="button" className="btn" data-size="small" onClick={() => void reload()}>
            Try again
          </button>
        </p>
      ) : rows === null ? (
        <p className="proj-note" role="status">
          Loading tasks…
        </p>
      ) : groups.length === 0 ? (
        <>
          {who === 'mine' ? (
            <p className="proj-note">
              You have no open tasks in this project.{' '}
              <button
                type="button"
                className="btn"
                data-size="small"
                onClick={() => {
                  chooseWho('everyone');
                  setFocusWho(true);
                }}
              >
                Show everyone's
              </button>
            </p>
          ) : (
            <p className="proj-note">No open tasks in this project.</p>
          )}
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
                    {/* A teammate's to-do opens read only (its own `team:` key); only mine get the star and chat. */}
                    {t.mine || t.scope === 'tds' ? (
                      <button
                        type="button"
                        className="proj-open"
                        onClick={() => openPanel(t.mine ? t.key : `team:todo/${t.id}`)}
                      >
                        <TodoText t={t} team={team} />
                      </button>
                    ) : (
                      // A personal to-do not on my lists (one with no assignee) has nothing the panel can show.
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
