import { useContext, useEffect, useMemo, useState } from 'react';
import type { TeamMember } from '../../../../shared/contract.ts';
import type {
  ProjectCard,
  ProjectList,
  ProjectRemoveCheck,
  ProjectRemoveResult,
} from '../../../../shared/projects-contract.ts';
import { ApiFailure, api } from '../../api.ts';
import { Icon } from '../../shell/Icon.tsx';
import { SheetTabs } from '../../shell/SheetTabs.tsx';
import { ShellContext } from '../../shell/shell-context.ts';
import { projectChatPlace } from '../../state/chat-project.ts';
import { useProjects } from '../../state/projects.ts';
import { useStore } from '../../store.tsx';
import { EmailDrafts } from './EmailDrafts.tsx';
import {
  dateWords,
  dotState,
  isEditable,
  LIGHT_WORDS,
  type MoveState,
  moveState,
  personName,
  READ_ONLY_NOTICE,
  refusalWords,
  STATUS_WORDS,
  serviceWords,
  statusOf,
  teamRows,
} from './logic.ts';
import { type ActivityState, ProjectActivity, useProjectActivity } from './ProjectActivity.tsx';
import {
  type BusinessState,
  ProjectBusiness,
  showsBusiness,
  useProjectBusiness,
} from './ProjectBusiness.tsx';
import { ProjectFiles } from './ProjectFiles.tsx';
import { type MeetingsState, ProjectMeetings, useProjectMeetings } from './ProjectMeetings.tsx';
import { ProjectRef } from './ProjectRef.tsx';
import { ProjectTodos } from './ProjectTodos.tsx';
import { ProjectUpdates } from './ProjectUpdates.tsx';
import { notAllowedWords, RemovePanel, resultWords } from './RemovePanel.tsx';
import { useProjectChange } from './useChange.ts';
import { useProjectTodos } from './useProjectTodos.ts';

export type ProjectTab = 'overview' | 'todos' | 'updates' | 'files';

/** What the Overview needs to archive, unarchive and delete this project. */
interface Removal {
  /** The brain can archive and this person can change projects. */
  on: boolean;
  /** A check made when the page opened: archive's for a live project, delete's for an archived one. */
  pre: ProjectRemoveCheck | null;
  panel: 'archive' | 'delete' | null;
  setPanel: (p: 'archive' | 'delete' | null) => void;
  /** Close the panel and put focus back on the button that opened it. */
  cancel: () => void;
  me: string;
  busy: boolean;
  problem: string;
  unarchive: () => void;
  onDone: (res: ProjectRemoveResult, mode: 'archive' | 'delete') => void;
}

function useRemoval(
  card: ProjectCard,
  list: ProjectList,
  me: string,
  onRemoved: (words: string) => void,
  setNote: (words: string) => void,
): Removal {
  const { apply } = useProjects();
  const on = list.canArchive === true && list.canChange;
  const live = on && isEditable(card);
  const [pre, setPre] = useState<ProjectRemoveCheck | null>(null);
  const [panel, setPanel] = useState<'archive' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  // Which `data-focus` element gets focus once the next render has put it back on the page.
  const [focusOn, setFocusOn] = useState<string | null>(null);
  const expect = card.card === 'ok' ? card.version : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a different project, state or card version needs a fresh check.
  useEffect(() => {
    setPre(null);
    setPanel(null);
    setProblem('');
    if (!live && !(on && card.archived)) return;
    let cancelled = false;
    api
      .checkProjectRemove({
        key: card.key,
        action: card.archived ? 'delete' : 'archive',
        ...(expect ? { expect } : {}),
      })
      .then((r) => {
        if (!cancelled) setPre(r.check);
      })
      .catch(() => {
        if (!cancelled) setPre(null);
      });
    return () => {
      cancelled = true;
    };
  }, [card.key, card.archived, card.version, live, on]);

  useEffect(() => {
    if (!focusOn) return;
    document.querySelector<HTMLElement>(`[data-focus="${focusOn}"]`)?.focus();
    setFocusOn(null);
  }, [focusOn]);

  const cancel = () => {
    setFocusOn(panel);
    setPanel(null);
  };

  const unarchive = async () => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      const c = await api.checkProjectRemove({
        key: card.key,
        action: 'unarchive',
        ...(expect ? { expect } : {}),
      });
      if (!c.check.allowed) {
        setProblem(notAllowedWords('unarchive', c.check.allowedWho));
      } else {
        const res = await api.removeProject({
          key: card.key,
          action: 'unarchive',
          ...(expect ? { expect } : {}),
          filesExpect: c.check.filesVersion,
        });
        setNote('Unarchived. It is back in the Projects list.');
        setFocusOn('title');
        apply(res.list);
      }
    } catch (err) {
      setProblem(err instanceof ApiFailure ? refusalWords(err.code, err.message) : refusalWords('internal'));
    }
    setBusy(false);
  };

  const onDone = (res: ProjectRemoveResult, mode: 'archive' | 'delete') => {
    setPanel(null);
    if (mode === 'delete') {
      const gone = `Deleted ${card.title}.`;
      const left = res.leftBehind
        ? ` Some of its files couldn't be removed and are hidden in ${res.leftBehind} on this Mac.`
        : '';
      onRemoved(`${resultWords(gone, res)}${left}`);
    } else {
      setNote(
        resultWords('Archived. It has left the Projects list and sits under the Archived filter.', res),
      );
      setFocusOn('note');
    }
  };

  return { on, pre, panel, setPanel, cancel, me, busy, problem, unarchive: () => void unarchive(), onDone };
}

function Light({ light }: { light: ProjectCard['health'] }) {
  if (!light) return <>Not set</>;
  return (
    <span className="proj-light">
      <span className="dot" data-state={dotState(light)} aria-hidden="true" />
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
                aria-disabled={busy !== null || undefined}
                aria-label={`Add ${personName(r.person, team)} to the team`}
                onClick={() => busy === null && void add(r.person)}
              >
                Add to team
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {message ? (
        <p className="notice" data-level="error" data-shape="box" role="alert">
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
  canMove,
  list,
  removal,
  activity,
  meetings,
  business,
  onUpdates,
  onTodos,
  onAddCard,
  onMove,
}: {
  card: ProjectCard;
  team: readonly TeamMember[] | undefined;
  clients: readonly { slug: string; name: string }[];
  canChange: boolean;
  canMove: MoveState;
  list: ProjectList;
  removal: Removal;
  activity: ActivityState;
  meetings: MeetingsState;
  business: BusinessState;
  onUpdates: () => void;
  onTodos: () => void;
  onAddCard: () => void;
  onMove: () => void;
}) {
  const { newChat } = useStore();
  const editable = canChange && isEditable(card);
  const clientName =
    card.space === 'personal'
      ? 'Just me'
      : (clients.find((c) => c.slug === card.client)?.name ?? card.client ?? '');
  const hoursLabel = card.kind === 'ongoing' ? 'Hours a month' : 'Budget hours';

  return (
    <>
      {removal.panel ? (
        <RemovePanel
          card={card}
          mode={removal.panel}
          me={removal.me}
          onCancel={removal.cancel}
          onDone={(res) => removal.onDone(res, removal.panel ?? 'archive')}
        />
      ) : null}
      {card.archived ? (
        <div className="notice" data-level="info" data-shape="box" role="status">
          <span>
            This project is archived, so it can't be changed.
            {removal.on && removal.pre && !removal.pre.allowed
              ? ` ${notAllowedWords('delete', removal.pre.allowedWho)}`
              : ''}
          </span>
          {removal.on ? (
            <span className="notice-actions">
              <button
                type="button"
                className="btn"
                data-size="small"
                aria-disabled={removal.busy || undefined}
                onClick={removal.busy ? undefined : removal.unarchive}
              >
                Unarchive
              </button>
              {removal.pre?.allowed && !removal.panel ? (
                <button
                  type="button"
                  className="btn"
                  data-size="small"
                  data-focus="delete"
                  onClick={() => removal.setPanel('delete')}
                >
                  Delete
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
      {removal.problem ? (
        <p className="notice" data-level="error" data-shape="box" role="alert">
          {removal.problem}
        </p>
      ) : null}
      {card.card === 'none' ? (
        <div className="notice" data-level="info" data-shape="box">
          <span>This project has no card yet, so its details can't be edited.</span>
          {canChange && !card.archived ? (
            <button type="button" className="btn" data-size="small" data-focus="addcard" onClick={onAddCard}>
              Add a card
            </button>
          ) : null}
        </div>
      ) : null}
      {card.card === 'unreadable' ? (
        <div className="notice" data-level="warn" data-shape="box" role="alert">
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

      <ProjectRef
        card={card}
        list={list}
        title={(key) => list.projects.find((p) => p.key === key)?.title ?? 'another project'}
      />
      <div className="tray lib-tray">
        {card.archived ? null : <EmailDrafts list={list} clients={clients} projectKey={card.key} />}
        {card.archived ? null : (
          <ProjectActivity
            key={card.key}
            projectKey={card.key}
            activity={activity}
            meetings={meetings}
            between={<ProjectMeetings card={card} clients={clients} meetings={meetings} />}
            onUpdates={onUpdates}
            onTodos={onTodos}
          />
        )}
        <section className="card proj-card" aria-labelledby="proj-brief">
          <div className="card-head">
            <h3 id="proj-brief">Brief</h3>
          </div>
          {card.brief ? (
            <p className="proj-brief">{card.brief}</p>
          ) : (
            <p className="proj-note">No brief yet.</p>
          )}
        </section>

        {showsBusiness(card) ? <ProjectBusiness card={card} clients={clients} business={business} /> : null}

        <section className="card proj-card" aria-label="Details">
          <dl className="kv">
            <dt>Client</dt>
            <dd>
              {clientName}
              {canChange && canMove === 'yes' ? (
                <button
                  type="button"
                  className="btn proj-move-btn"
                  data-size="small"
                  data-focus="move"
                  aria-label={`Move ${card.title} to another client`}
                  onClick={onMove}
                >
                  Move
                </button>
              ) : null}
            </dd>
            <dt>Status</dt>
            <dd>
              {card.archived ? 'Archived' : STATUS_WORDS[statusOf(card)]}
              {removal.on && editable && !removal.panel ? (
                <>
                  <button
                    type="button"
                    className="btn proj-move-btn"
                    data-size="small"
                    data-focus="archive"
                    aria-label={`Archive ${card.title}`}
                    onClick={() => removal.setPanel('archive')}
                  >
                    Archive
                  </button>
                  {removal.pre?.empty ? (
                    <button
                      type="button"
                      className="btn"
                      data-size="small"
                      data-focus="delete"
                      aria-label={`Delete ${card.title}`}
                      onClick={() => removal.setPanel('delete')}
                    >
                      Delete
                    </button>
                  ) : null}
                </>
              ) : null}
            </dd>
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
            {card.checklistOpen && card.checklistOpen.length > 0 ? (
              <>
                <p className="proj-note">
                  {card.checklistOpen.length === 1
                    ? '1 item is still open. It shows on the Workbench and isn’t counted in this project’s to-dos:'
                    : `${card.checklistOpen.length} items are still open. They show on the Workbench and aren’t counted in this project’s to-dos:`}
                </p>
                <ul className="proj-checklist">
                  {card.checklistOpen.map((item, i) => (
                    // Items can repeat, so the position keeps keys unique.
                    // biome-ignore lint/suspicious/noArrayIndexKey: read-only list, never reordered
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <button
              type="button"
              className="btn"
              data-size="small"
              onClick={() =>
                newChat({
                  draft: `Show me the checklist in ${card.checklist}`,
                  ...(card.archived ? {} : projectChatPlace(card, clients)),
                })
              }
            >
              Ask Claude about the checklist
            </button>
          </section>
        ) : null}
      </div>
    </>
  );
}

/** One project: its title and tabs (Overview, To-dos, Updates, Files). */
export function ProjectPage({
  card,
  list,
  tab,
  onTab,
  onBack,
  onEdit,
  onMove,
  onAddCard,
  onRemoved,
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
  onMove: () => void;
  onAddCard: () => void;
  /** After a delete: the page is gone, so the list says what happened. */
  onRemoved?: (words: string) => void;
  team: readonly TeamMember[] | undefined;
  clients: readonly { slug: string; name: string }[];
  me: string;
}) {
  const canChange = list.canChange;
  const editable = canChange && isEditable(card);
  const [note, setNote] = useState('');
  const removal = useRemoval(card, list, me, onRemoved ?? (() => {}), setNote);
  const { todos, newChat } = useStore();
  // The list reloads when the project's count moves or the to-do lists change (an add in the To-dos panel).
  const todosStamp = useMemo(() => [card.openTodos, todos], [card.openTodos, todos]);
  const projectTodos = useProjectTodos(card.key, todosStamp);
  // Read once per project; it says what was seen when the person leaves (see useProjectActivity).
  const activity = useProjectActivity(card.key, !card.archived);
  // Read once per project too: the Meetings card and Coming up share it.
  const meetings = useProjectMeetings(card.key, !card.archived);
  // And the client background: only for a live client project (the server answers 'none' for the rest).
  const business = useProjectBusiness(card.key, showsBusiness(card));
  // Add files sits at the right end of the tabs row, so the picker's state lives here.
  const [linking, setLinking] = useState(false);
  // And Add a claude.ai page, offered only where the server says so (live project with a card, not legacy).
  const [addingArtifact, setAddingArtifact] = useState(false);
  const canAddArtifact = list.canAddArtifact === true && editable && card.space !== 'legacy';
  // And Add an update: the Updates tab says whether the brain's skill allows it.
  const [addingUpdate, setAddingUpdate] = useState(false);
  const [canAddUpdate, setCanAddUpdate] = useState(false);
  // As in the To-dos drawer: only while the app may change to-dos (the server refuses an add otherwise). A personal
  // project also needs personal to-dos, or the form would drop the project and add a TDS to-do the team can see.
  const canAddTodo =
    todos?.changes === 'on' &&
    todos.canProject === true &&
    (card.space !== 'personal' || todos.canUsePersonal === true) &&
    !card.archived;
  useEffect(() => {
    if (tab !== 'files') setLinking(false);
    if (tab !== 'updates') setAddingUpdate(false);
  }, [tab]);
  // A tab switch replaces the add form or the file picker inside this page, so it goes through the leave guard like a
  // page change: with typed work (or chosen files) the form asks first (Actions rule 9). Without any it changes at once.
  const shell = useContext(ShellContext);
  const held = (go: () => void) => {
    if (shell?.sheetHold.dirty) shell.guardLeave(go);
    else go();
  };
  const chooseTab = (next: ProjectTab) => held(() => onTab(next));
  // Add a to-do opens the same full form as the To-dos drawer, in its panel, with this project filled in.
  const addTodo = () => {
    shell?.dispatch({ type: 'open-drawer', drawer: 'todos' });
    shell?.dispatch({
      type: 'open-todo',
      key: null,
      mode: 'add',
      start: { project: card.key, personal: card.space === 'personal' },
    });
  };
  // A row on the Overview that switches tab removes itself, so focus would fall to the page: it goes to the tab
  // that is now current instead (design review), and only once the switch really happened (the leave guard may ask).
  const [focusTab, setFocusTab] = useState(false);
  const chooseTabFromRow = (next: ProjectTab) =>
    held(() => {
      onTab(next);
      setFocusTab(true);
    });
  useEffect(() => {
    if (!focusTab) return;
    setFocusTab(false);
    document
      .querySelector<HTMLElement>('nav[aria-label="Project sections"] button[aria-current="page"]')
      ?.focus();
  }, [focusTab]);
  return (
    <>
      <div className="proj-head">
        <button
          type="button"
          className="btn proj-back"
          data-variant="quiet"
          data-size="small"
          onClick={() => held(onBack)}
        >
          <Icon name="chevron" size={14} />
          All projects
        </button>
        <h2 className="proj-title" data-focus="title" tabIndex={-1}>
          {card.title}
        </h2>
        {!card.archived ? (
          <button
            type="button"
            className="btn proj-head-end"
            data-size="small"
            data-focus="chat"
            onClick={() => newChat(projectChatPlace(card, clients))}
          >
            <Icon name="chat" size={14} />
            New chat for this project
          </button>
        ) : null}
        {editable ? (
          <button
            type="button"
            className="btn proj-head-end"
            data-size="small"
            data-focus="edit"
            onClick={() => held(onEdit)}
          >
            <Icon name="edit" size={14} />
            Edit
          </button>
        ) : null}
      </div>
      {!canChange ? (
        <p className="notice" data-level="info" data-shape="box" role="status">
          {READ_ONLY_NOTICE}
        </p>
      ) : null}
      {note ? (
        <p
          className="notice"
          data-level="info"
          data-shape="box"
          role="status"
          data-focus="note"
          tabIndex={-1}
        >
          {note}
        </p>
      ) : null}
      {list.duplicates.some((d) => d.endsWith(`/${card.slug}`)) ? (
        <p className="notice" data-level="info" data-shape="box" role="status">
          Another folder has the same name as this project and is hidden: {list.duplicates.join(', ')}.
        </p>
      ) : null}
      <div className="proj-tabrow">
        <SheetTabs
          label="Project sections"
          current={tab}
          onChoose={(id) => chooseTab(id as ProjectTab)}
          items={[
            // No tab dot for news: a tab's dot means a problem (design-system Page tabs), and a project opens
            // on its Overview, where "Since you last looked" already sits.
            { id: 'overview', label: 'Overview' },
            { id: 'todos', label: 'To-dos', count: projectTodos.data?.count ?? card.openTodos },
            { id: 'updates', label: 'Updates' },
            { id: 'files', label: 'Files' },
          ]}
        />
        {tab === 'todos' && canAddTodo ? (
          <button type="button" className="btn" data-variant="primary" data-size="small" onClick={addTodo}>
            <Icon name="plus" size={14} />
            Add a to-do
          </button>
        ) : null}
        {tab === 'updates' && canAddUpdate ? (
          <button
            type="button"
            className="btn"
            data-variant="primary"
            data-size="small"
            data-focus="addupdate"
            onClick={() => setAddingUpdate(true)}
            aria-disabled={addingUpdate || undefined}
          >
            <Icon name="plus" size={14} />
            Add an update
          </button>
        ) : null}
        {tab === 'files' && editable ? (
          <button
            type="button"
            className="btn"
            data-variant="primary"
            data-size="small"
            data-focus="linkfiles"
            onClick={() => setLinking(true)}
            aria-disabled={linking || undefined}
          >
            <Icon name="plus" size={14} />
            Add files
          </button>
        ) : null}
        {tab === 'files' && canAddArtifact ? (
          <button
            type="button"
            className="btn"
            data-size="small"
            data-focus="addartifact"
            onClick={() => setAddingArtifact(true)}
            aria-disabled={addingArtifact || undefined}
          >
            <Icon name="plus" size={14} />
            Add a claude.ai page
          </button>
        ) : null}
      </div>
      <div className="proj-body">
        {tab === 'overview' ? (
          <Overview
            card={card}
            team={team}
            clients={clients}
            canChange={canChange}
            canMove={moveState(card, list)}
            list={list}
            removal={removal}
            activity={activity}
            meetings={meetings}
            business={business}
            onUpdates={() => chooseTabFromRow('updates')}
            onTodos={() => chooseTabFromRow('todos')}
            onAddCard={onAddCard}
            onMove={onMove}
          />
        ) : null}
        {tab === 'todos' ? (
          <ProjectTodos
            card={card}
            team={team}
            rows={projectTodos.data?.todos ?? null}
            failed={projectTodos.error}
            reload={projectTodos.reload}
          />
        ) : null}
        {tab === 'updates' ? (
          <ProjectUpdates
            card={card}
            canChange={canChange}
            adding={addingUpdate}
            onAdding={setAddingUpdate}
            onCanAdd={setCanAddUpdate}
          />
        ) : null}
        {tab === 'files' ? (
          <ProjectFiles
            card={card}
            canChange={editable}
            linking={linking}
            onLinking={setLinking}
            addingArtifact={addingArtifact && canAddArtifact}
            onAddingArtifact={setAddingArtifact}
          />
        ) : null}
      </div>
    </>
  );
}
