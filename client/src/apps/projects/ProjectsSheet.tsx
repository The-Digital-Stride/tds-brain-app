import { useMemo, useState } from 'react';
import { useProjects } from '../../state/projects.ts';
import { useStore } from '../../store.tsx';
import { READ_ONLY_NOTICE } from './logic.ts';
import { ProjectForm } from './ProjectForm.tsx';
import { ProjectListView } from './ProjectList.tsx';
import { ProjectPage, type ProjectTab } from './ProjectPage.tsx';
import { TidyScreen } from './TidyScreen.tsx';

type Screen =
  | { is: 'list' }
  | { is: 'tidy' }
  | { is: 'project'; key: string; tab: ProjectTab }
  | { is: 'new' }
  | { is: 'edit' | 'card'; key: string };

/** The Projects app: the list, one project's page, the create and edit form, and the tidy-up. */
export function ProjectsSheet() {
  const { boot, todos } = useStore();
  const { list, error, refresh } = useProjects();
  const [screen, setScreen] = useState<Screen>({ is: 'list' });
  const me = boot?.identity.slug ?? '';
  const clients = boot?.clients ?? [];
  const team = todos?.team;
  const card = useMemo(() => {
    const key = 'key' in screen ? screen.key : null;
    return key ? (list?.projects.find((p) => p.key === key) ?? null) : null;
  }, [list, screen]);

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
  const toList = () => setScreen({ is: 'list' });
  const toProject = (key: string, tab: ProjectTab = 'overview') => setScreen({ is: 'project', key, tab });

  let body: React.ReactNode;
  if (screen.is === 'tidy') {
    body = <TidyScreen list={list} clients={clients} onBack={toList} canChange={canChange} />;
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
        onDone={() => toProject(card.key)}
        onCancel={() => toProject(card.key)}
      />
    );
  } else if (screen.is === 'project' && card) {
    body = (
      <ProjectPage
        card={card}
        list={list}
        tab={screen.tab}
        onTab={(tab) => toProject(card.key, tab)}
        onBack={toList}
        onEdit={() => setScreen({ is: 'edit', key: card.key })}
        onAddCard={() => setScreen({ is: 'card', key: card.key })}
        team={team}
        clients={clients}
        me={me}
      />
    );
  } else {
    body = (
      <>
        <div className="proj-head">
          <h2 className="visually-hidden">Projects</h2>
          {canChange ? (
            <button
              type="button"
              className="btn"
              data-variant="primary"
              onClick={() => setScreen({ is: 'new' })}
            >
              New project
            </button>
          ) : null}
        </div>
        {!canChange ? (
          <p className="proj-banner" role="status">
            {READ_ONLY_NOTICE}
          </p>
        ) : null}
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
                onClick={() => setScreen({ is: 'tidy' })}
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
        <ProjectListView data={list} me={me} team={team} clients={clients} onOpen={(c) => toProject(c.key)} />
      </>
    );
  }

  return <div className="lib proj">{body}</div>;
}
