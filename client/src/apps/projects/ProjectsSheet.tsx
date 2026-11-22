import { useEffect, useMemo, useRef, useState } from 'react';
import { followMovedProject, projectPageRequest, takeProjectPageRequest } from '../../state/client-choice.ts';
import { useProjects } from '../../state/projects.ts';
import { useStore } from '../../store.tsx';
import { moveState, plural, READ_ONLY_NOTICE } from './logic.ts';
import { MoveScreen } from './MoveScreen.tsx';
import { ProjectForm } from './ProjectForm.tsx';
import { ProjectListView } from './ProjectList.tsx';
import { ProjectPage, type ProjectTab } from './ProjectPage.tsx';
import { TidyScreen } from './TidyScreen.tsx';

type Screen =
  | { is: 'list' }
  | { is: 'tidy' }
  | { is: 'project'; key: string; tab: ProjectTab }
  | { is: 'new' }
  | { is: 'edit' | 'card' | 'move'; key: string };

/** The Projects app: the list, one project's page, the create and edit form, and the tidy-up. */
export function ProjectsSheet() {
  const { boot, todos } = useStore();
  const { list, error, refresh } = useProjects();
  const [screen, setScreen] = useState<Screen>({ is: 'list' });
  // Said aloud after a move; always mounted so a screen reader hears it when the page changes.
  const [announce, setAnnounce] = useState('');
  // Shown on the list after a delete, because the project's own page is gone.
  const [notice, setNotice] = useState('');
  // A Projects search hit asks for a project's page (client-choice `projectPageRequest`): open it on
  // mount, and again whenever another hit asks while the app is already showing.
  useEffect(() => {
    const open = () => {
      const key = takeProjectPageRequest();
      if (key) setScreen({ is: 'project', key, tab: 'overview' });
    };
    open();
    return projectPageRequest.subscribe(open);
  }, []);
  const root = useRef<HTMLDivElement>(null);
  // What was pressed to get to each screen, so Back puts focus there again.
  const came = useRef<(string | null)[]>([]);
  const returnTo = useRef<string | null>(null);
  const first = useRef(true);
  const screenId = `${screen.is}:${'key' in screen ? screen.key : ''}`;
  const me = boot?.identity.slug ?? '';
  const clients = boot?.clients ?? [];
  const team = todos?.team;
  const card = useMemo(() => {
    const key = 'key' in screen ? screen.key : null;
    return key ? (list?.projects.find((p) => p.key === key) ?? null) : null;
  }, [list, screen]);

  // Each screen's heading gets focus when the screen changes; Back goes to what was pressed instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of screen moves focus.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const wanted = returnTo.current;
    returnTo.current = null;
    const el = wanted
      ? root.current?.querySelector<HTMLElement>(`[data-focus="${CSS.escape(wanted)}"]`)
      : null;
    if (el) {
      el.focus();
      return;
    }
    const h2 = root.current?.querySelector<HTMLElement>('h2');
    if (h2) {
      h2.tabIndex = -1;
      h2.focus();
    }
  }, [screenId]);

  if (!list) {
    return (
      <div className="lib proj">
        {error ? (
          <p className="proj-note" role="alert">
            Projects can't be loaded right now. {error}{' '}
            <button type="button" className="btn" data-size="small" onClick={() => void refresh()}>
              Try again
            </button>
          </p>
        ) : (
          <p className="proj-note" role="status">
            Loading projects…
          </p>
        )}
      </div>
    );
  }

  const canChange = list.canChange;
  const go = (next: Screen, from: string) => {
    came.current.push(from);
    returnTo.current = null;
    setNotice('');
    setScreen(next);
  };
  const back = (next: Screen) => {
    returnTo.current = came.current.pop() ?? null;
    setScreen(next);
  };
  const toList = () => back({ is: 'list' });
  const openProject = (key: string) => go({ is: 'project', key, tab: 'overview' }, `proj:${key}`);
  const toProject = (key: string) => back({ is: 'project', key, tab: 'overview' });
  const toTab = (key: string, tab: ProjectTab) => setScreen({ is: 'project', key, tab });

  let body: React.ReactNode;
  if (screen.is === 'tidy') {
    body = (
      <TidyScreen list={list} clients={clients} onBack={toList} canChange={canChange} me={me} team={team} />
    );
  } else if (screen.is === 'new') {
    body = (
      <ProjectForm
        mode="create"
        card={null}
        clients={clients}
        team={team}
        me={me}
        onDone={(key) => (key ? toProject(key) : toList())}
        onCancel={toList}
      />
    );
  } else if ((screen.is === 'edit' || screen.is === 'card') && card) {
    body = (
      <ProjectForm
        mode={screen.is === 'edit' ? 'edit' : 'card'}
        card={card}
        clients={clients}
        team={team}
        me={me}
        canMove={moveState(card, list)}
        onMove={() => go({ is: 'move', key: card.key }, 'move')}
        onDone={() => toProject(card.key)}
        onCancel={() => toProject(card.key)}
      />
    );
  } else if (screen.is === 'move' && card) {
    body = (
      <MoveScreen
        card={card}
        clients={clients}
        onCancel={() => toProject(card.key)}
        onMoved={(res, name) => {
          followMovedProject(card.key, res.key);
          // Cleared first, so a second move with the same words is still read out.
          setAnnounce('');
          const words =
            res.todosMoved > 0
              ? `Moved to ${name}. ${plural(res.todosMoved, 'to-do')} moved with it.`
              : `Moved to ${name}.`;
          setTimeout(() => setAnnounce(words), 50);
          toProject(res.key);
        }}
      />
    );
  } else if (screen.is === 'project' && card) {
    body = (
      <ProjectPage
        card={card}
        list={list}
        tab={screen.tab}
        onTab={(tab) => toTab(card.key, tab)}
        onBack={toList}
        onEdit={() => go({ is: 'edit', key: card.key }, 'edit')}
        onMove={() => go({ is: 'move', key: card.key }, 'move')}
        onAddCard={() => go({ is: 'card', key: card.key }, 'addcard')}
        onRemoved={(words) => {
          setNotice(words);
          setAnnounce('');
          setTimeout(() => setAnnounce(words), 50);
          toList();
        }}
        team={team}
        clients={clients}
        me={me}
      />
    );
  } else {
    body = (
      <>
        <h2 className="visually-hidden">Projects</h2>
        {!canChange ? (
          <p className="proj-banner" role="status">
            {READ_ONLY_NOTICE}
          </p>
        ) : null}
        {notice ? <p className="proj-banner">{notice}</p> : null}
        {list.looseLabels > 0 ? (
          <div className="proj-banner">
            <span>
              {list.looseLabels} old project label{list.looseLabels === 1 ? '' : 's'} on your to-dos could be
              tidied up.
            </span>
            {canChange ? (
              <button
                type="button"
                className="btn"
                data-size="small"
                data-focus="tidy"
                onClick={() => go({ is: 'tidy' }, 'tidy')}
              >
                Tidy up
              </button>
            ) : null}
          </div>
        ) : null}
        {list.duplicates.length > 0 ? (
          <p className="proj-banner" role="status">
            Some folders share a name with another project, so only one is shown: {list.duplicates.join(', ')}
            .
          </p>
        ) : null}
        {(list.leftovers ?? []).length > 0 ? (
          <p className="proj-banner" role="status">
            These folders were left behind when a project moved or was archived, so they're hidden. Anything
            still in them stays only on this Mac: {(list.leftovers ?? []).join(', ')}.
          </p>
        ) : null}
        <ProjectListView
          data={list}
          me={me}
          team={team}
          clients={clients}
          onOpen={(c) => openProject(c.key)}
          action={
            canChange ? (
              <button
                type="button"
                className="btn"
                data-variant="primary"
                data-focus="new"
                onClick={() => go({ is: 'new' }, 'new')}
              >
                New project
              </button>
            ) : null
          }
        />
      </>
    );
  }

  return (
    <div className="lib proj" ref={root}>
      {body}
      <p className="visually-hidden" role="status">
        {announce}
      </p>
    </div>
  );
}
