import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TeamMember } from '../../../../shared/contract.ts';
import type { ProjectCard, ProjectList as ProjectListData } from '../../../../shared/projects-contract.ts';
import { Icon } from '../../shell/Icon.tsx';
import { Seg } from '../../shell/Seg.tsx';
import {
  ARCHIVED,
  didYouMean,
  dotState,
  type Filters,
  filterProjects,
  groupProjects,
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
import { useProjectChange } from './useChange.ts';

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
        <span className="dot" data-state={dot} aria-hidden="true" />
        <span className="line-text">
          <span className="line-title">{card.title}</span>
          <span className="line-meta">{rowMeta(card)}</span>
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
  action,
}: {
  data: ProjectListData;
  me: string;
  team: readonly TeamMember[] | undefined;
  clients: readonly { slug: string; name: string }[];
  onOpen: (card: ProjectCard) => void;
  /** The primary action (New project): last in the tools row, at the right end. */
  action?: ReactNode;
}) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const shown = useMemo(() => filterProjects(data.projects, filters, me), [data.projects, filters, me]);
  const groups = useMemo(() => groupProjects(shown, clients), [shown, clients]);
  const owners = useMemo(() => ownersIn(data.projects), [data.projects]);
  const services = useMemo(() => servicesIn(data.projects), [data.projects]);
  // Decision 12: archived projects sit outside the count and the empty state; the Archived filter shows them.
  const live = useMemo(() => data.projects.filter((c) => !c.archived), [data.projects]);
  const archivedCount = data.projects.length - live.length;
  const cardless = useMemo(() => live.filter(needsCard).length, [live]);
  const change = useProjectChange();
  const [codesBusy, setCodesBusy] = useState(false);
  const [codesNote, setCodesNote] = useState('');
  const [codesProblem, setCodesProblem] = useState('');
  const searchId = useId();
  const codeless = live.filter((c) => c.refState === 'missing').length;
  const canGiveCodes = data.canRefAll === true && data.canChange && codeless > 0;
  const guesses = useMemo(
    () => (shown.length === 0 && filters.query ? didYouMean(filters.query, data.projects) : []),
    [shown.length, filters.query, data.projects],
  );
  const giveCodes = async () => {
    if (codesBusy) return;
    setCodesBusy(true);
    setCodesNote('');
    setCodesProblem('');
    const res = await change({ kind: 'ref', all: true });
    setCodesBusy(false);
    if (!res.ok) {
      setCodesProblem(res.message);
      return;
    }
    const withCode = (cards: readonly ProjectCard[]) => cards.filter((c) => c.ref).length;
    const given = Math.max(0, withCode(res.list.projects) - withCode(data.projects));
    setCodesNote(
      given === 0
        ? 'No projects were given a code.'
        : `${given} project${given === 1 ? ' was' : 's were'} given a code.`,
    );
  };
  const codesNoteRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (codesNote) codesNoteRef.current?.focus();
  }, [codesNote]);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <>
      {cardless > 0 ? (
        <div className="notice" data-level="info" data-shape="box">
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
      {canGiveCodes ? (
        <div className="notice" data-level="info" data-shape="box">
          <span>
            {codeless} project{codeless === 1 ? ' has' : 's have'} no code yet
          </span>
          <button
            type="button"
            className="btn"
            data-size="small"
            aria-disabled={codesBusy || undefined}
            onClick={() => void giveCodes()}
          >
            Give projects codes
          </button>
        </div>
      ) : null}
      <div role="status">
        {codesNote ? (
          <p ref={codesNoteRef} className="notice" data-level="info" data-shape="box" tabIndex={-1}>
            {codesNote}
          </p>
        ) : null}
      </div>
      {codesProblem ? (
        <p className="notice" data-level="error" data-shape="box" role="alert">
          {codesProblem}
        </p>
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
          options={[
            ...STATUSES.map((s) => ({ value: s, label: STATUS_WORDS[s] })),
            ...(archivedCount > 0 || filters.status === ARCHIVED
              ? [{ value: ARCHIVED, label: 'Archived' }]
              : []),
          ]}
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
        <div className="lib-search">
          <Icon name="search" size={16} />
          <label className="visually-hidden" htmlFor={searchId}>
            Search projects
          </label>
          <input
            id={searchId}
            type="search"
            className="field"
            placeholder="Search by name or code"
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
          />
        </div>
        <p className="lib-summary" role="status">
          {filters.status === ARCHIVED
            ? `${shown.length} of ${archivedCount} archived project${archivedCount === 1 ? '' : 's'}`
            : `${shown.length} of ${live.length} project${live.length === 1 ? '' : 's'}`}
        </p>
        {action}
      </div>
      {live.length === 0 && filters.status !== ARCHIVED ? (
        <p className="proj-note">
          No projects yet. Use New project to add the first one.
          {archivedCount > 0 ? (
            <>
              {' '}
              <button type="button" className="link-btn" onClick={() => set({ status: ARCHIVED })}>
                {archivedCount} archived
              </button>
            </>
          ) : null}
        </p>
      ) : shown.length === 0 ? (
        <p className="proj-note">
          No projects match these filters.{' '}
          {guesses.map((g) => (
            <button
              key={g}
              type="button"
              className="btn"
              data-size="small"
              onClick={() => setFilters({ ...NO_FILTERS, query: g })}
            >
              Did you mean {g}?
            </button>
          ))}{' '}
          <button type="button" className="btn" data-size="small" onClick={() => setFilters(NO_FILTERS)}>
            Clear filters
          </button>
          {archivedCount > 0 && filters.status !== ARCHIVED ? (
            <>
              {' '}
              <button type="button" className="link-btn" onClick={() => set({ status: ARCHIVED })}>
                {archivedCount} archived
              </button>
            </>
          ) : null}
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
