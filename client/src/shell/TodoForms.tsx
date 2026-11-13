import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import {
  type TeamMember,
  TODO_DETAILS_MAX,
  TODO_TITLE_MAX,
  type TodoAction,
  type TodoItem,
  type TodoScope,
} from '../../../shared/contract.ts';
import { dueInWords } from '../format.ts';
import type { ChangeTodosResult } from '../store.tsx';
import { Icon } from './Icon.tsx';
import { Seg } from './Seg.tsx';
import { handoverLine } from './words.ts';

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

/** Who a to-do can go to: you first, then the team (not you). */
function people(me: string, team: TeamMember[]): TeamMember[] {
  return [{ slug: me, name: 'Me' }, ...team.filter((m) => m.slug !== me)];
}

function Assignee({
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
  startPersonal,
  onAdd,
  onCancel,
}: {
  me: string;
  team: TeamMember[];
  busy: boolean;
  /** TodoList.canAddOpen: offers "Open to anyone". */
  canAddOpen: boolean;
  /** TodoList.canUsePersonal: shows the personal (lock) toggle. */
  canUsePersonal: boolean;
  /** Start as personal (the Personal filter is showing). Ignored unless canUsePersonal. */
  startPersonal: boolean;
  onAdd: (action: TodoAction) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState(me);
  const [personalChoice, setPersonal] = useState(startPersonal && canUsePersonal);
  const [dateOpen, setDateOpen] = useState(false);
  const [whoOpen, setWhoOpen] = useState(false);
  const [full, setFull] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || busy) return;
    onAdd({
      kind: 'add',
      title: t,
      due: due || null,
      assignee: assignee === '' ? null : assignee,
      ...(personal ? { scope: 'personal' as const } : {}),
    });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <form className="todo-form" onSubmit={submit} onKeyDown={onKeyDown} aria-label="Add a to-do">
      <div className="todo-field">
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
        <div className="todo-field">
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
        <div className="todo-field">
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
      <div className="todo-actions">
        <button
          type="submit"
          className="btn"
          data-variant="primary"
          disabled={busy || title.trim() === ''}
          aria-describedby={personal ? `${uid}-personal` : undefined}
        >
          Add
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
 * Builds the actions for a save: only changed fields, in the order edit, due, move, assignee. Personal
 * to-dos send `scope: 'personal'` on every step; TDS steps keep the old shape. After a `move` the later
 * steps address the to-do where it now lives.
 */
export function buildEditActions(todo: TodoItem, draft: EditDraft, detailsEditable: boolean): TodoAction[] {
  const actions: TodoAction[] = [];
  const at = (scope: TodoScope) => (scope === 'personal' ? { scope } : {});
  const title = draft.title.trim();
  const titleChanged = title !== todo.title;
  const detailsChanged = detailsEditable && draft.details !== todo.details;
  if (titleChanged || detailsChanged) {
    actions.push({
      kind: 'edit',
      id: todo.id,
      title,
      ...(detailsChanged ? { details: draft.details } : {}),
      ...at(todo.scope),
    });
  }
  if (draft.due !== (todo.due ?? '')) {
    actions.push({ kind: 'due', id: todo.id, due: draft.due || null, ...at(todo.scope) });
  }
  if (draft.scope !== todo.scope) {
    actions.push({ kind: 'move', id: todo.id, scope: todo.scope, to: draft.scope });
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

/** The inline editor that replaces a to-do's row. */
export function TodoEditor({
  todo,
  draft,
  onDraft,
  me,
  team,
  busy,
  canUsePersonal,
  onSave,
  onDone,
  onDelete,
  onCancel,
}: {
  todo: TodoItem;
  draft: EditDraft;
  onDraft: (d: EditDraft) => void;
  me: string;
  team: TeamMember[];
  busy: boolean;
  /** TodoList.canUsePersonal: shows the TDS / Personal switch on to-dos that are yours. */
  canUsePersonal: boolean;
  onSave: (actions: TodoAction[]) => Promise<ChangeTodosResult>;
  onDone: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const detailsEditable = todo.details.length <= TODO_DETAILS_MAX;
  const { title, details, due, assignee } = draft;
  const setTitle = (v: string) => onDraft({ ...draft, title: v });
  const setDetails = (v: string) => onDraft({ ...draft, details: v });
  const setDue = (v: string) => onDraft({ ...draft, due: v });
  // Giving a personal to-do to someone else makes it a TDS one: they can't see a personal file.
  const setAssignee = (v: string) =>
    onDraft({
      ...draft,
      assignee: v,
      ...(draft.scope === 'personal' && v !== me ? { scope: 'tds' as const } : {}),
    });
  const setScope = (v: TodoScope) => onDraft({ ...draft, scope: v });
  const passing = todo.scope === 'personal' && draft.scope === 'tds' && draft.assignee !== me;
  const switchable = canUsePersonal && todo.assignee === me && draft.assignee === me;
  const handover = handoverLine(todo, me);
  const warnPersonal = switchable && draft.scope === 'personal' && todo.scope !== 'personal';
  const titleRef = useRef<HTMLInputElement>(null);
  const conflictRef = useRef<HTMLParagraphElement>(null);
  const hasConflict = draft.theirs !== undefined;
  // Bring the conflict note into view without moving focus off Save.
  useEffect(() => {
    if (hasConflict) conflictRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [hasConflict]);
  // Focus the title on opening.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const actions = buildEditActions(todo, draft, detailsEditable);
  const dirty = actions.length > 0;
  const canSave = !busy && title.trim() !== '';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (actions.length === 0) {
      onCancel();
      return;
    }
    void onSave(actions);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onCancel();
  };

  return (
    <form
      className="todo-form"
      onSubmit={submit}
      onKeyDown={onKeyDown}
      aria-label={`Edit "${todo.title}"`}
      aria-describedby={draft.theirs ? `${uid}-conflict` : undefined}
    >
      {handover ? <p className="todo-note todo-handover">{handover}</p> : null}
      <div className="todo-field">
        <label htmlFor={`${uid}-title`}>Title</label>
        <input
          id={`${uid}-title`}
          ref={titleRef}
          className="field"
          value={title}
          maxLength={TODO_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="todo-field">
        <label htmlFor={`${uid}-details`}>Details</label>
        {detailsEditable ? (
          <textarea
            id={`${uid}-details`}
            className="field"
            rows={5}
            value={details}
            maxLength={TODO_DETAILS_MAX}
            onChange={(e) => setDetails(e.target.value)}
          />
        ) : (
          <>
            <textarea
              id={`${uid}-details`}
              className="field"
              rows={5}
              value={todo.details}
              readOnly
              aria-describedby={`${uid}-long`}
            />
            <p className="todo-note" id={`${uid}-long`}>
              These details are too long to edit here. Change them in a chat instead.
            </p>
          </>
        )}
      </div>
      <div className="todo-field">
        <label htmlFor={`${uid}-due`}>Due date</label>
        <div className="todo-inline">
          <input
            id={`${uid}-due`}
            type="date"
            className="field"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            data-variant="quiet"
            disabled={due === ''}
            onClick={() => setDue('')}
          >
            Clear date
          </button>
        </div>
      </div>
      <div className="todo-field">
        <label htmlFor={`${uid}-who`}>Assigned to</label>
        <Assignee id={`${uid}-who`} value={assignee} onChange={setAssignee} me={me} team={team} allowOpen />
        {passing ? <p className="todo-note">{PASS_ON_NOTE}</p> : null}
      </div>
      {switchable ? (
        <div className="todo-field">
          <span className="todo-label">Where it's kept</span>
          <Seg<TodoScope>
            label="Where this to-do is kept"
            value={draft.scope}
            onChange={setScope}
            options={[
              { value: 'tds', label: 'TDS' },
              { value: 'personal', label: 'Personal' },
            ]}
          />
          {warnPersonal ? (
            <p className="todo-note" id={`${uid}-personal`}>
              {PERSONAL_WARNING}
            </p>
          ) : null}
        </div>
      ) : null}
      {draft.theirs ? (
        <p className="todo-note" id={`${uid}-conflict`} ref={conflictRef}>
          {conflictNote(draft.theirs, draft, team, me)}
        </p>
      ) : null}
      <div className="todo-actions">
        <button
          type="submit"
          className="btn"
          data-variant="primary"
          disabled={!canSave}
          aria-describedby={warnPersonal ? `${uid}-personal` : undefined}
        >
          Save
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {/* Finishing a to-do, on a row of its own. Both are held for a few seconds with an Undo on the
          row, so they ask nothing here. Mark as done waits for unsaved edits, so none are lost. */}
      <div className="todo-actions todo-finish">
        <button
          type="button"
          className="btn"
          disabled={busy || dirty}
          aria-describedby={dirty ? `${uid}-dirty` : undefined}
          onClick={onDone}
        >
          Mark as done
        </button>
        <button
          type="button"
          className="btn todo-delete"
          data-variant="danger"
          disabled={busy}
          onClick={onDelete}
        >
          Delete
        </button>
        {dirty ? (
          <p className="todo-note" id={`${uid}-dirty`}>
            Save or cancel your changes before marking it as done.
          </p>
        ) : null}
      </div>
    </form>
  );
}

/**
 * For someone who may tick to-dos off but not edit them (the `todo` skill isn't theirs yet): the
 * to-do opened, with only "Mark as done". Ticking needs this one deliberate step; the list has no tick box.
 */
export function TodoDonePanel({
  todo,
  onDone,
  onCancel,
}: {
  todo: TodoItem;
  onDone: () => void;
  onCancel: () => void;
}) {
  // Focus lands on the title, not on Mark as done, so finishing always takes a deliberate second step.
  const titleRef = useRef<HTMLLegendElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onCancel();
  };
  return (
    <fieldset className="todo-form todo-done" onKeyDown={onKeyDown}>
      <legend className="todo-done-title" ref={titleRef} tabIndex={-1}>
        {todo.title}
      </legend>
      {todo.details ? <p className="todo-note todo-done-details">{todo.details}</p> : null}
      <div className="todo-actions">
        <button type="button" className="btn" data-variant="primary" onClick={onDone}>
          Mark as done
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </fieldset>
  );
}
