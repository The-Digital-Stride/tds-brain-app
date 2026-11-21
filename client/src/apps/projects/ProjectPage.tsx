import { useState } from 'react';
import type { TeamMember } from '../../../../shared/contract.ts';
import type { ProjectCard, ProjectList } from '../../../../shared/projects-contract.ts';
import { SheetTabs } from '../../shell/SheetTabs.tsx';
import { useStore } from '../../store.tsx';
import {
  dateWords,
  dotState,
  isEditable,
  LIGHT_WORDS,
  personName,
  READ_ONLY_NOTICE,
  STATUS_WORDS,
  serviceWords,
  statusOf,
  teamRows,
} from './logic.ts';
import { ProjectFiles } from './ProjectFiles.tsx';
import { ProjectTodos } from './ProjectTodos.tsx';
import { useProjectChange } from './useChange.ts';
import { useProjectTodos } from './useProjectTodos.ts';

export type ProjectTab = 'overview' | 'todos' | 'files';

function Light({ light }: { light: ProjectCard['health'] }) {
  if (!light) return <>Not set</>;
  return (
    <span className="proj-light">
      <span className="health-dot" data-state={dotState(light)} aria-hidden="true" />
      {LIGHT_WORDS[light]}
    </span>
  );
}

function Team({
  card,
  team,
  canEdit,
}: {
  card: ProjectCard;
  team: readonly TeamMember[] | undefined;
  canEdit: boolean;
}) {
  const change = useProjectChange({ reloadOnChanged: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const rows = teamRows(card);

  const add = async (person: string) => {
    setBusy(person);
    setMessage('');
    const res = await change({
      kind: 'edit',
      key: card.key,
      fields: { team: [...card.team, person] },
      expect: card.version,
    });
    setBusy(null);
    if (!res.ok) setMessage(res.message);
  };

  if (rows.length === 0) return <p className="proj-note">Nobody is on this project yet.</p>;
  return (
    <>
      <ul className="proj-team">
        {rows.map((r) => (
          <li key={r.person} className="line">
            <span className="line-text">
              <span className="line-title">{personName(r.person, team)}</span>
              <span className="line-meta">
                {r.role === 'owner' ? 'Account Owner' : r.role === 'team' ? 'Team' : null}
                {r.role === 'from-todos' ? <span className="chip">from to-dos</span> : null}
                {r.role === 'from-todos' && r.openTodos
                  ? ` ${r.openTodos} open to-do${r.openTodos === 1 ? '' : 's'}`
                  : null}
              </span>
            </span>
            {r.role === 'from-todos' && canEdit ? (
              <button
                type="button"
                className="btn"
                data-size="small"
                disabled={busy !== null}
                aria-label={`Add ${personName(r.person, team)} to the team`}
                onClick={() => void add(r.person)}
              >
                Add to team
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {message ? (
        <p className="proj-error" role="alert">
          {message}
        </p>
      ) : null}
    </>
  );
}

function Overview({
  card,
  team,
  clients,
  canChange,
  onAddCard,
}: {
  card: ProjectCard;
  team: readonly TeamMember[] | undefined;
  clients: readonly { slug: string; name: string }[];
  canChange: boolean;
  onAddCard: () => void;
}) {
  const { newChat } = useStore();
  const editable = canChange && isEditable(card);
  const clientName =
    card.space === 'personal'
      ? 'Personal'
      : (clients.find((c) => c.slug === card.client)?.name ?? card.client ?? '');
  const hoursLabel = card.kind === 'ongoing' ? 'Hours a month' : 'Budget hours';

  return (
    <>
      {card.archived ? (
        <p className="proj-banner" role="status">
          This project is archived, so it can't be changed.
        </p>
      ) : null}
      {card.card === 'none' ? (
        <div className="proj-banner">
          <span>This project has no card yet, so its details can't be edited.</span>
          {canChange && !card.archived ? (
            <button type="button" className="btn" data-size="small" data-focus="addcard" onClick={onAddCard}>
              Add a card
            </button>
          ) : null}
        </div>
      ) : null}
      {card.card === 'unreadable' ? (
        <div className="proj-banner" data-level="warning" role="alert">
          <span>
            This project's card can't be read, so it can't be edited. You can add a new card, or ask someone
            to fix the file.
          </span>
          {canChange && !card.archived ? (
            <button type="button" className="btn" data-size="small" data-focus="addcard" onClick={onAddCard}>
              Add a card
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="card proj-card" aria-label="Details">
        <dl className="kv">
          <dt>Client</dt>
          <dd>{clientName}</dd>
          <dt>Status</dt>
          <dd>{STATUS_WORDS[statusOf(card)]}</dd>
          <dt>Kind</dt>
          <dd>{card.kind === 'ongoing' ? 'Ongoing' : card.kind === 'one-off' ? 'One-off' : 'Not set'}</dd>
          <dt>Health</dt>
          <dd>
            <Light light={card.health} />
          </dd>
          <dt>Client comms</dt>
          <dd>
            <Light light={card.comms} />
          </dd>
          <dt>Account Owner</dt>
          <dd>{card.owner ? personName(card.owner, team) : 'Not set'}</dd>
          <dt>Service</dt>
          <dd>{card.service.length > 0 ? card.service.map(serviceWords).join(', ') : 'Not set'}</dd>
          <dt>Starts</dt>
          <dd>{card.start ? dateWords(card.start) : 'Not set'}</dd>
          {card.kind === 'ongoing' ? null : (
            <>
              <dt>Ends</dt>
              <dd>{card.end ? dateWords(card.end) : 'Not set'}</dd>
            </>
          )}
          <dt>{hoursLabel}</dt>
          <dd>{card.budgetHours === null ? 'Not set' : card.budgetHours.toLocaleString('en-GB')}</dd>
          <dt>Billable</dt>
          <dd>{card.billable === null ? 'Not set' : card.billable ? 'Yes' : 'No'}</dd>
          <dt>Stages</dt>
          <dd>{card.stages.length > 0 ? card.stages.join(', ') : 'None'}</dd>
          {card.lastChanged ? (
            <>
              <dt>Last changed</dt>
              <dd>
                {dateWords(card.lastChanged.at)} by {personName(card.lastChanged.by, team)}
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="card proj-card" aria-labelledby="proj-brief">
        <div className="card-head">
          <h3 id="proj-brief">Brief</h3>
        </div>
        {card.brief ? <p className="proj-brief">{card.brief}</p> : <p className="proj-note">No brief yet.</p>}
      </section>

      <section className="card proj-card" aria-labelledby="proj-team">
        <div className="card-head">
          <h3 id="proj-team">Team</h3>
        </div>
        <Team card={card} team={team} canEdit={editable} />
      </section>

      {card.checklist ? (
        <section className="card proj-card" aria-labelledby="proj-checklist">
          <div className="card-head">
            <h3 id="proj-checklist">Old checklist</h3>
          </div>
          <p className="proj-note">
            This project has a checklist from before to-dos were linked to projects:{' '}
            <code>{card.checklist}</code>
          </p>
          <button
            type="button"
            className="btn"
            data-size="small"
            onClick={() => newChat({ draft: `Show me the checklist in ${card.checklist}` })}
          >
            Ask Claude about the checklist
          </button>
        </section>
      ) : null}
    </>
  );
}

/** One project: its title and tabs (Overview, To-dos, Files). */
export function ProjectPage({
  card,
  list,
  tab,
  onTab,
  onBack,
  onEdit,
  onAddCard,
  team,
  clients,
  me,
}: {
  card: ProjectCard;
  list: ProjectList;
  tab: ProjectTab;
  onTab: (tab: ProjectTab) => void;
  onBack: () => void;
  onEdit: () => void;
  onAddCard: () => void;
  team: readonly TeamMember[] | undefined;
  clients: readonly { slug: string; name: string }[];
  me: string;
}) {
  const canChange = list.canChange;
  const editable = canChange && isEditable(card);
  const projectTodos = useProjectTodos(card.key, card.openTodos);
  return (
    <>
      <div className="proj-head">
        <button type="button" className="btn" data-size="small" onClick={onBack}>
          All projects
        </button>
        <h2 className="proj-title">{card.title}</h2>
        {editable ? (
          <button type="button" className="btn" data-size="small" data-focus="edit" onClick={onEdit}>
            Edit
          </button>
        ) : null}
      </div>
      {!canChange ? (
        <p className="proj-banner" role="status">
          {READ_ONLY_NOTICE}
        </p>
      ) : null}
      {list.duplicates.some((d) => d.endsWith(`/${card.slug}`)) ? (
        <p className="proj-banner" role="status">
          Another folder has the same name as this project and is hidden: {list.duplicates.join(', ')}.
        </p>
      ) : null}
      <SheetTabs
        label="Project sections"
        current={tab}
        onChoose={(id) => onTab(id as ProjectTab)}
        items={[
          { id: 'overview', label: 'Overview', dot: null },
          { id: 'todos', label: 'To-dos', count: projectTodos.data?.count ?? card.openTodos },
          { id: 'files', label: 'Files' },
        ]}
      />
      <div className="proj-body">
        {tab === 'overview' ? (
          <Overview card={card} team={team} clients={clients} canChange={canChange} onAddCard={onAddCard} />
        ) : null}
        {tab === 'todos' ? (
          <ProjectTodos
            card={card}
            team={team}
            me={me}
            rows={projectTodos.data?.todos ?? null}
            failed={projectTodos.error}
            reload={projectTodos.reload}
          />
        ) : null}
        {tab === 'files' ? <ProjectFiles card={card} canChange={editable} /> : null}
      </div>
    </>
  );
}
