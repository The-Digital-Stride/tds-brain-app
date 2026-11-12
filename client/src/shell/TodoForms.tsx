import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import {
  type TeamMember,
  TODO_DETAILS_MAX,
  TODO_TITLE_MAX,
  type TodoAction,
  type TodoItem,
} from '../../../shared/contract.ts';
import type { ChangeTodosResult } from '../store.tsx';

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

/** The "Add a to-do" form: one column. Enter adds, Esc cancels. */
export function AddTodoForm({
  me,
  team,
  busy,
  onAdd,
  onCancel,
}: {
  me: string;
  team: TeamMember[];
  busy: boolean;
  onAdd: (action: TodoAction) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState(me);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || busy) return;
    onAdd({ kind: 'add', title: t, due: due || null, assignee });
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
        <label htmlFor={`${uid}-title`}>What needs doing?</label>
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
        <label htmlFor={`${uid}-due`}>Due date (optional)</label>
        <input
          id={`${uid}-due`}
          type="date"
          className="field"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </div>
      <div className="todo-field">
        <label htmlFor={`${uid}-who`}>Assigned to</label>
        <Assignee
          id={`${uid}-who`}
          value={assignee}
          onChange={setAssignee}
          me={me}
          team={team}
          allowOpen={false}
        />
      </div>
      <div className="todo-actions">
        <button type="submit" className="btn" data-variant="primary" disabled={busy || title.trim() === ''}>
          Add
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Builds the actions for a save: only changed fields, in the order edit, due, assignee. */
export function buildEditActions(
  todo: TodoItem,
  draft: { title: string; details: string; due: string; assignee: string },
  detailsEditable: boolean,
): TodoAction[] {
  const actions: TodoAction[] = [];
  const title = draft.title.trim();
  const titleChanged = title !== todo.title;
  const detailsChanged = detailsEditable && draft.details !== todo.details;
  if (titleChanged || detailsChanged) {
    actions.push({
      kind: 'edit',
      id: todo.id,
      title,
      ...(detailsChanged ? { details: draft.details } : {}),
    });
  }
  if (draft.due !== (todo.due ?? '')) {
    actions.push({ kind: 'due', id: todo.id, due: draft.due || null });
  }
  if (draft.assignee !== (todo.assignee ?? '')) {
    actions.push({ kind: 'assignee', id: todo.id, assignee: draft.assignee || null });
  }
  return actions;
}

export interface EditDraft {
  title: string;
  details: string;
  due: string;
  assignee: string;
}

/** The inline editor that replaces a to-do's row. */
export function TodoEditor({
  todo,
  draft,
  onDraft,
  me,
  team,
  busy,
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
  const setAssignee = (v: string) => onDraft({ ...draft, assignee: v });
  const titleRef = useRef<HTMLInputElement>(null);
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
    <form className="todo-form" onSubmit={submit} onKeyDown={onKeyDown} aria-label={`Edit "${todo.title}"`}>
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
      </div>
      <div className="todo-actions">
        <button type="submit" className="btn" data-variant="primary" disabled={!canSave}>
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
          data-variant="quiet"
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
