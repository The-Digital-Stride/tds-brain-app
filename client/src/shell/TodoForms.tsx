import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import {
  type TeamMember,
  TODO_DETAILS_MAX,
  TODO_TITLE_MAX,
  type TodoAction,
  type TodoItem,
  type TodoScope,
} from '../../../shared/contract.ts';
import { parseProjectKey } from '../../../shared/projects.ts';
import { splitTodoFiles } from '../../../shared/todo-files.ts';
import { dueInWords } from '../format.ts';
import { useProjectChoice } from '../state/client-choice.ts';
import { todoProjectOptions, useProjects } from '../state/projects.ts';
import { useStore } from '../store.tsx';
import { Icon } from './Icon.tsx';
import { SearchSelect } from './SearchSelect.tsx';
import TodoDetailsEditor from './TodoDetailsEditor.tsx';

/** Said when a to-do is set to Personal in the editor (plan decision 9). */
export const PERSONAL_WARNING =
  "Personal to-dos stay on this Mac. They aren't backed up, and the Workbench, Reminders and teammates stop seeing them.";
/** Said when a personal to-do is given to someone else. */
export const PASS_ON_NOTE = 'Passing it on makes it a TDS to-do so they can see it.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "14 Nov" from YYYY-MM-DD. */
function shortDate(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1] ?? ''}`.trim() : iso;
}

/**
 * The details the panel shows and the editor edits. With `canAttach` that is the body without its
 * `## Files` section (the section is shown as a Files block and kept by the skill); otherwise the whole body.
 */
export function detailsText(todo: { details: string }, canAttach: boolean): string {
  return canAttach ? splitTodoFiles(todo.details).details : todo.details;
}

/** Said before moving a personal to-do that sits in a private project to the team (decision 8). */
export function dropProjectQuestion(name: string | null): string {
  return `This to-do is in your private project${name ? ` '${name}'` : ''}. Moving it to the team removes it from that project.`;
}

const NO_PROJECT = 'none';

/** The ProjectKey a to-do sits in now ('' for none): a key, a legacy match or a key whose folder is missing. */
export function todoProjectValue(todo: Pick<TodoItem, 'projectMatch'>): string {
  const m = todo.projectMatch;
  return m && (m.how === 'key' || m.how === 'legacy' || m.how === 'missing') ? m.key : '';
}

/** The client a key belongs to: its folder name, or null for a personal project. */
function clientOfKey(key: string): string | null {
  const parsed = parseProjectKey(key);
  return parsed && parsed.client !== 'personal' ? parsed.client : null;
}

/**
 * The Project and Stage fields (decisions 5 and 6). Only drawn when the server can save them
 * (`TodoList.canProject`). A TDS to-do is never offered a personal project. Choosing another project
 * clears the stage, since stages belong to the project.
 */
export function ProjectFields({
  id,
  scope,
  client,
  project,
  stage,
  onChange,
}: {
  id: string;
  scope: TodoScope;
  client: string | null;
  project: string;
  stage: string;
  onChange: (next: { project: string; stage: string }) => void;
}) {
  const { list } = useProjects();
  const clients = useStore().boot?.clients ?? [];
  const cards = list?.projects ?? [];
  const options = [
    { value: NO_PROJECT, label: 'No project' },
    ...todoProjectOptions(cards, clients, { scope, client, current: project || null }),
  ];
  const card = cards.find((c) => c.key === project);
  const stages = card?.stages ?? [];
  const stageKnown = stage === '' || stages.includes(stage);
  return (
    <>
      <div className="form-field">
        <label htmlFor={`${id}-project`}>Project</label>
        <SearchSelect
          id={`${id}-project`}
          value={project || NO_PROJECT}
          options={options}
          recentKey="todo-projects"
          onChange={(v) => onChange({ project: v === NO_PROJECT ? '' : v, stage: '' })}
        />
      </div>
      {project && (stages.length > 0 || stage !== '') ? (
        <div className="form-field">
          <label htmlFor={`${id}-stage`}>Stage</label>
          <select
            id={`${id}-stage`}
            className="field"
            value={stage}
            onChange={(e) => onChange({ project, stage: e.target.value })}
          >
            <option value="">No stage</option>
            {stages.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
            {stageKnown ? null : <option value={stage}>{stage}</option>}
          </select>
        </div>
      ) : null}
    </>
  );
}

/** Who a to-do can go to: you first, then the team (not you). */
function people(me: string, team: TeamMember[]): TeamMember[] {
  return [{ slug: me, name: 'Me' }, ...team.filter((m) => m.slug !== me)];
}

export function Assignee({
  id,
  value,
  onChange,
  me,
  team,
  allowOpen,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  me: string;
  team: TeamMember[];
  allowOpen: boolean;
}) {
  const options = people(me, team);
  // A to-do held by someone the roster doesn't list still shows who it is with.
  const known = value === '' || options.some((o) => o.slug === value);
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.slug} value={o.slug}>
          {o.name}
        </option>
      ))}
      {known ? null : <option value={value}>{value}</option>}
      {allowOpen ? <option value="">Open to anyone</option> : null}
    </select>
  );
}

/**
 * The "Add a to-do" line: type, press Enter, done (it goes to you, with no date). Icon toggles on the line
 * add a personal flag, a date and a person; "More options" opens the full fields. Esc cancels.
 */
export function AddTodoForm({
  me,
  team,
  busy,
  canAddOpen,
  canUsePersonal,
  canAttach = false,
  canProject = false,
  startPersonal,
  startProject = '',
  onAdd,
  onCancel,
  onDirty,
}: {
  me: string;
  team: TeamMember[];
  busy: boolean;
  /** TodoList.canAddOpen: offers "Open to anyone". */
  canAddOpen: boolean;
  /** TodoList.canUsePersonal: shows the personal (lock) toggle. */
  canUsePersonal: boolean;
  /** TodoList.canAttach: shows a details field and sends it with the new to-do. */
  canAttach?: boolean;
  /** TodoList.canProject: shows Project and Stage, and sends them with the new to-do. */
  canProject?: boolean;
  /** Start as personal (the Personal filter is showing). Ignored unless canUsePersonal. */
  startPersonal: boolean;
  /** The drawer's project filter: a new to-do starts in it. Else the app-wide picker's project. */
  startProject?: string;
  onAdd: (action: TodoAction) => void;
  onCancel: () => void;
  /** Told when there is something typed that Cancel would lose (a title), so the panel can ask first. */
  onDirty?: (dirty: boolean) => void;
}) {
  const uid = useId();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState(me);
  const [personalChoice, setPersonal] = useState(startPersonal && canUsePersonal);
  const [dateOpen, setDateOpen] = useState(false);
  const [whoOpen, setWhoOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [details, setDetails] = useState('');
  // A new to-do starts in the project the drawer is filtered to (that is the app-wide picker's while it holds one).
  const picked = useProjectChoice();
  const [project, setProject] = useState(canProject ? startProject || picked : '');
  const [stage, setStage] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  const hasTitle = title.trim() !== '';
  const hasDetails = canAttach && details.trim() !== '';
  const overLimit = canAttach && details.length > TODO_DETAILS_MAX;
  useEffect(() => onDirty?.(hasTitle || hasDetails), [hasTitle, hasDetails, onDirty]);
  // "More options" removes itself: put the keyboard on the first field it reveals.
  useEffect(() => {
    if (full) dueRef.current?.focus();
  }, [full]);

  // Someone else, or open to anyone, can't be personal: it turns off and the toggle is disabled.
  const mine = assignee === me;
  const personal = canUsePersonal && personalChoice && mine;
  const whoName =
    assignee === '' ? 'Open to anyone' : (team.find((m) => m.slug === assignee)?.name ?? assignee);
  const showDate = full || dateOpen;
  const showWho = full || whoOpen;
  // A TDS to-do is never put in a personal project, so a preset one falls away when it isn't personal.
  const projectKey = canProject && (personal || !project.startsWith('personal/')) ? project : '';
  const showProject = canProject && (full || projectKey !== '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || busy || overLimit) return;
    onAdd({
      kind: 'add',
      title: t,
      due: due || null,
      assignee: assignee === '' ? null : assignee,
      ...(personal ? { scope: 'personal' as const } : {}),
      ...(hasDetails ? { details: details.trim() } : {}),
      ...(projectKey
        ? { client: clientOfKey(projectKey), project: projectKey, ...(stage ? { stage } : {}) }
        : {}),
    });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    // The details editor takes its own Esc (the panel then closes through the shell).
    if (e.key === 'Escape' && !e.defaultPrevented) {
      // preventDefault too: the shell's own Esc (close the drawer) skips a handled key, so one Esc closes one thing.
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <form className="todo-form" onSubmit={submit} onKeyDown={onKeyDown} aria-label="Add a to-do">
      <div className="form-field">
        <label htmlFor={`${uid}-title`} className={full ? undefined : 'visually-hidden'}>
          What needs doing?
        </label>
        <div className="todo-quick">
          <input
            id={`${uid}-title`}
            ref={titleRef}
            className="field"
            value={title}
            placeholder="What needs doing?"
            maxLength={TODO_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
          />
          {canUsePersonal ? (
            <button
              type="button"
              className="icon-btn"
              aria-label="Keep it personal"
              aria-pressed={personal}
              aria-describedby={mine ? undefined : `${uid}-why`}
              aria-disabled={mine ? undefined : true}
              onClick={() => {
                if (mine) setPersonal(!personalChoice);
              }}
            >
              <Icon name="lock" size={16} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            aria-label={due ? `Due date: ${shortDate(due)}` : 'Add a due date'}
            aria-expanded={showDate}
            data-on={due !== '' ? 'true' : undefined}
            onClick={() => setDateOpen(!dateOpen)}
          >
            <Icon name="calendar" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={mine ? "Choose who it's for" : `For: ${whoName}`}
            aria-expanded={showWho}
            data-on={!mine ? 'true' : undefined}
            onClick={() => setWhoOpen(!whoOpen)}
          >
            <Icon name="person" size={16} />
          </button>
        </div>
      </div>
      {canUsePersonal && !mine ? (
        <p className="todo-note" id={`${uid}-why`}>
          A personal to-do can only be yours.
        </p>
      ) : null}
      {personal ? (
        <p className="todo-note" id={`${uid}-personal`}>
          {PERSONAL_WARNING}
        </p>
      ) : null}
      {showDate ? (
        <div className="form-field">
          <label htmlFor={`${uid}-due`}>Due date (optional)</label>
          <input
            id={`${uid}-due`}
            ref={dueRef}
            type="date"
            className="field"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
      ) : null}
      {showWho ? (
        <div className="form-field">
          <label htmlFor={`${uid}-who`}>Assigned to</label>
          <Assignee
            id={`${uid}-who`}
            value={assignee}
            onChange={setAssignee}
            me={me}
            team={team}
            allowOpen={canAddOpen}
          />
        </div>
      ) : null}
      {showProject ? (
        <ProjectFields
          id={`${uid}-add`}
          scope={personal ? 'personal' : 'tds'}
          client={null}
          project={projectKey}
          stage={stage}
          onChange={(n) => {
            setProject(n.project);
            setStage(n.stage);
          }}
        />
      ) : null}
      {canAttach ? (
        <div className="form-field">
          <span className="label">Details (optional)</span>
          <TodoDetailsEditor
            markdown={details}
            editable
            onChange={setDetails}
            label="Details"
            describedBy={overLimit ? `${uid}-over` : undefined}
          />
          {overLimit ? (
            <p className="error" id={`${uid}-over`} role="alert">
              These details are longer than {TODO_DETAILS_MAX.toLocaleString('en-GB')} characters, so they
              can't be saved. Shorten them.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="todo-actions">
        <button
          type="submit"
          className="btn"
          data-variant="primary"
          aria-disabled={busy || title.trim() === '' || overLimit || undefined}
          aria-describedby={personal ? `${uid}-personal` : undefined}
          onClick={(e) => {
            // aria-disabled keeps focus on the button, so the press itself must do nothing.
            if (busy || title.trim() === '' || overLimit) e.preventDefault();
          }}
        >
          Add a to-do
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        {full ? null : (
          <button
            type="button"
            className="btn todo-more"
            data-variant="quiet"
            data-size="small"
            onClick={() => setFull(true)}
          >
            More options
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Builds the actions for a save: only changed fields, in the order edit, due, move, project, assignee. Personal
 * to-dos send `scope: 'personal'` on every step; TDS steps keep the old shape. After a `move` the later
 * steps address the to-do where it now lives.
 */
export function buildEditActions(
  todo: TodoItem,
  draft: EditDraft,
  detailsEditable: boolean,
  canAttach = false,
  canProject = false,
): TodoAction[] {
  const actions: TodoAction[] = [];
  const at = (scope: TodoScope) => (scope === 'personal' ? { scope } : {});
  const title = draft.title.trim();
  const titleChanged = title !== todo.title;
  // With canAttach the draft holds only the details part: that is what is compared and what is sent, so
  // saving never touches the `## Files` section.
  const detailsChanged = detailsEditable && draft.details !== detailsText(todo, canAttach);
  if (titleChanged || detailsChanged) {
    actions.push({
      kind: 'edit',
      id: todo.id,
      title,
      ...(detailsChanged ? { details: draft.details } : {}),
      ...(detailsChanged && canAttach ? { detailsOnly: true as const } : {}),
      ...at(todo.scope),
    });
  }
  if (draft.due !== (todo.due ?? '')) {
    actions.push({ kind: 'due', id: todo.id, due: draft.due || null, ...at(todo.scope) });
  }
  // Moving a personal to-do that is in a private project to the team takes it out of the project: the
  // panel asked first, and the script wants `dropProject` to allow it.
  const here = todoProjectValue(todo);
  const toTeam = todo.scope === 'personal' && draft.scope === 'tds';
  const drop = canProject && toTeam && here.startsWith('personal/');
  if (draft.scope !== todo.scope) {
    actions.push({
      kind: 'move',
      id: todo.id,
      scope: todo.scope,
      to: draft.scope,
      ...(drop ? { dropProject: true as const } : {}),
    });
  }
  if (canProject) {
    const stageHere = todo.stage ?? '';
    let want = draft.project ?? here;
    let wantStage = want ? (draft.stage ?? stageHere) : '';
    // A team save never sends a personal key (decision 8). The draft keeps one picked before switching
    // back to the team (fix-round review): a moved to-do leaves the project; a team one keeps its own.
    if (draft.scope === 'tds' && want.startsWith('personal/')) {
      want = toTeam || here.startsWith('personal/') ? '' : here;
      wantStage = want ? stageHere : '';
    }
    const nowKey = drop ? '' : here;
    const nowStage = drop ? '' : stageHere;
    if (want !== nowKey || wantStage !== nowStage) {
      actions.push({
        kind: 'project',
        id: todo.id,
        client: want ? clientOfKey(want) : todo.client,
        project: want || null,
        stage: wantStage || null,
        ...at(draft.scope),
      });
    }
  }
  if (draft.assignee !== (todo.assignee ?? '')) {
    actions.push({ kind: 'assignee', id: todo.id, assignee: draft.assignee || null, ...at(draft.scope) });
  }
  // Only the first step carries the version the editor opened with; the store gives each later step
  // the version the one before it left behind.
  const [first] = actions;
  if (first && first.kind !== 'add' && draft.version) actions[0] = { ...first, expect: draft.version };
  return actions;
}

export interface EditDraft {
  title: string;
  details: string;
  due: string;
  assignee: string;
  /** TDS or personal: where the to-do will live after saving. */
  scope: TodoScope;
  /**
   * Projects R1: a ProjectKey ('' for none) and a stage. Absent until the person touches the fields, which
   * reads as "unchanged" (the drawer that opens the editor does not know about them).
   */
  project?: string;
  stage?: string;
  /** TodoItem.version when the editor opened (or the fresh one adopted after a 'changed' refusal). */
  version: string;
  /** The field values the editor opened with (or last rebased on), to tell what the person edited. */
  base: { title: string; details: string; due: string; assignee: string; scope: TodoScope };
  /** After a 'changed' refusal: what the other person's version says, to show beside the draft. */
  theirs?: { title: string; due: string; assignee: string; details: string };
}

/** The sentence describing how the other person's version differs from the draft, or null if it doesn't. */
export function conflictNote(
  theirs: NonNullable<EditDraft['theirs']>,
  draft: EditDraft,
  team: TeamMember[],
  me: string,
): string {
  const parts: string[] = [];
  if (theirs.title !== draft.title.trim()) parts.push(`\u201c${theirs.title}\u201d`);
  if (theirs.due !== draft.due) parts.push(theirs.due ? `due ${dueInWords(theirs.due)}` : 'with no due date');
  if (theirs.assignee !== draft.assignee) {
    const name = theirs.assignee === me ? 'you' : team.find((m) => m.slug === theirs.assignee)?.name;
    parts.push(theirs.assignee === '' ? 'open to anyone' : `assigned to ${name ?? theirs.assignee}`);
  }
  if (theirs.details !== draft.details) parts.push('with different details');
  const theirsText = parts.length > 0 ? ` Their version: ${parts.join(', ')}.` : '';
  return `Someone else changed this to-do while you were editing.${theirsText} Press Save to replace it with yours, or Cancel to keep theirs.`;
}
