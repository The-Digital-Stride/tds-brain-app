import { useId, useMemo, useState } from 'react';
import type { TeamMember } from '../../../../shared/contract.ts';
import type { ProjectCard, ProjectList as ProjectListData } from '../../../../shared/projects-contract.ts';
import { Seg } from '../../shell/Seg.tsx';
import {
  dotState,
  type Filters,
  filterProjects,
  groupProjects,
  LIGHT_WORDS,
  NO_FILTERS,
  needsCard,
  ownersIn,
  personName,
  rowMeta,
  STATUS_WORDS,
  STATUSES,
  servicesIn,
  serviceWords,
} from './logic.ts';

const VIEWS: { value: 'all' | 'mine'; label: string }[] = [
  { value: 'all', label: 'All projects' },
  { value: 'mine', label: 'Mine' },
];

function Select({
  label,
  value,
  onChange,
  any,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  any: string;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <span className="proj-filter">
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{any}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

function Row({ card, onOpen }: { card: ProjectCard; onOpen: () => void }) {
  const dot = dotState(card.health);
  return (
    <li className="line proj-row">
      <button type="button" className="proj-open" data-focus={`proj:${card.key}`} onClick={onOpen}>
        <span className="health-dot" data-state={dot} aria-hidden="true" />
        <span className="line-text">
          <span className="line-title">{card.title}</span>
          <span className="line-meta">{rowMeta(card)}</span>
        </span>
        <span className="visually-hidden">
          {card.health ? `. Health: ${LIGHT_WORDS[card.health].toLowerCase()}` : '. No health light set'}
        </span>
      </button>
    </li>
  );
}

/** The list: grouped by client (personal last), with filters and the Mine view. */
export function ProjectListView({
  data,
  me,
  team,
  clients,
  onOpen,
}: {
  data: ProjectListData;
  me: string;
  team: readonly TeamMember[] | undefined;
  clients: readonly { slug: string; name: string }[];
  onOpen: (card: ProjectCard) => void;
}) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const shown = useMemo(() => filterProjects(data.projects, filters, me), [data.projects, filters, me]);
  const groups = useMemo(() => groupProjects(shown, clients), [shown, clients]);
  const owners = useMemo(() => ownersIn(data.projects), [data.projects]);
  const services = useMemo(() => servicesIn(data.projects), [data.projects]);
  const cardless = useMemo(() => data.projects.filter(needsCard).length, [data.projects]);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <>
      {cardless > 0 ? (
        <div className="proj-banner">
          <span>
            {cardless} project{cardless === 1 ? ' needs' : 's need'} a card
          </span>
          <button
            type="button"
            className="btn"
            data-size="small"
            aria-pressed={filters.noCard}
            onClick={() => set({ noCard: !filters.noCard })}
          >
            {filters.noCard ? 'Show all' : 'Show them'}
          </button>
        </div>
      ) : null}
      <div className="proj-tools">
        <Seg
          label="Show"
          value={filters.mine ? 'mine' : 'all'}
          options={VIEWS}
          onChange={(v) => set({ mine: v === 'mine' })}
        />
        <Select
          label="Status"
          value={filters.status}
          any="Any status"
          options={STATUSES.map((s) => ({ value: s, label: STATUS_WORDS[s] }))}
          onChange={(v) => set({ status: v as Filters['status'] })}
        />
        <Select
          label="Account Owner"
          value={filters.owner}
          any="Any Account Owner"
          options={owners.map((o) => ({ value: o, label: personName(o, team) }))}
          onChange={(v) => set({ owner: v })}
        />
        <Select
          label="Service"
          value={filters.service}
          any="Any service"
          options={services.map((s) => ({ value: s, label: serviceWords(s) }))}
          onChange={(v) => set({ service: v })}
        />
        <p className="lib-summary" role="status">
          {shown.length} of {data.projects.length} project{data.projects.length === 1 ? '' : 's'}
        </p>
      </div>
      {data.projects.length === 0 ? (
        <p className="proj-note">No projects yet. Use New project to add the first one.</p>
      ) : shown.length === 0 ? (
        <p className="proj-note">
          No projects match these filters.{' '}
          <button type="button" className="link-btn" onClick={() => setFilters(NO_FILTERS)}>
            Show all projects
          </button>
        </p>
      ) : (
        <div className="tray lib-tray">
          {groups.map((g) => (
            <section className="card" key={g.id} aria-labelledby={`proj-g-${g.id}`}>
              <div className="card-head">
                <h3 id={`proj-g-${g.id}`}>{g.title}</h3>
                <span className="count">{g.items.length}</span>
              </div>
              <ul className="lib-list">
                {g.items.map((c) => (
                  <Row key={c.key} card={c} onOpen={() => onOpen(c)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {data.skippedFolders > 0 ? (
        <p className="proj-note">
          {data.skippedFolders} folder{data.skippedFolders === 1 ? ' was' : 's were'} skipped because the name
          can't be used for a project.
        </p>
      ) : null}
    </>
  );
}
