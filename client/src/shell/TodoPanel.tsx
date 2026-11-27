import {
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type SetStateAction,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type AskedTodo,
  type DoneTodo,
  type TeamMember,
  type TeamTodo,
  TODO_DETAILS_MAX,
  TODO_TITLE_MAX,
  type TodoAction,
  type TodoItem,
  type TodoScope,
} from '../../../shared/contract.ts';
import { splitTodoFiles, todoFileExtras } from '../../../shared/todo-files.ts';
import { dueInWords, isOverdue } from '../format.ts';
import { chatForTodo } from '../state/attention.ts';
import { todoChatProject } from '../state/chat-project.ts';
import { todoChatClient } from '../state/client-choice.ts';
import { keptDraftKey, keptDrafts, useKeptDraft } from '../state/kept-drafts.ts';
import { todoPlaceParts, useProjects } from '../state/projects.ts';
import { type ChangeTodosResult, useStore } from '../store.tsx';
import { isFaithful, setTask } from '../todo-doc/index.ts';
import { Confirm } from './Confirm.tsx';
import type { TodoPanelMode } from './contract.ts';
import { Icon } from './Icon.tsx';
import { Seg } from './Seg.tsx';
import { useShell } from './ShellProvider.tsx';
import { NO_FAVOURITES, StarButton } from './StarButton.tsx';
import TodoDetailsEditor from './TodoDetailsEditor.tsx';
import { TodoFiles } from './TodoFiles.tsx';
import {
  AddTodoForm,
  Assignee,
  buildEditActions,
  conflictNote,
  detailsText,
  dropProjectQuestion,
  type EditDraft,
  PASS_ON_NOTE,
  PERSONAL_WARNING,
  ProjectFields,
  todoProjectValue,
  useAssignGate,
} from './TodoForms.tsx';
import { TodoHistory } from './TodoHistory.tsx';
import {
  askedStatusLine,
  doneStatusLine,
  handoverLine,
  teamNote,
  teamStatusLine,
  todoChatDraft,
} from './words.ts';

const LONG_NOTE = 'These details are too long to edit here. Change them in a chat instead.';
const UNFAITHFUL_NOTE =
  "These details have formatting that can't be edited safely here. Change them in a chat instead.";

export interface TodoPanelProps {
  /** The to-do shown, or null while adding (or when `asked` is shown). */
  todo: TodoItem | null;
  /** A to-do you passed on, shown read only (then `todo` is null). */
  asked?: AskedTodo | null;
  /** A finished to-do, shown read only (then `todo` and `asked` are null). */
  done?: DoneTodo | null;
  /** A teammate's open to-do, shown read only (then `todo`, `asked` and `done` are null). */
  teamTodo?: TeamTodo | null;
  mode: TodoPanelMode;
  /** The drawer's status line, said here while the panel is open (it may cover the drawer). */
  message: string;
  isError: boolean;
  draft: EditDraft;
  setDraft: Dispatch<SetStateAction<EditDraft>>;
  busy: boolean;
  /** Changes are on: edit, delete, add. */
  canEdit: boolean;
  /** The person may tick to-dos off (`prefs.directWrites`). */
  canTick: boolean;
  me: string;
  team: TeamMember[];
  canUsePersonal: boolean;
  canAddOpen: boolean;
  /** TodoList.canAttach: details are shown and edited without the Files section, which has its own block. */
  canAttach: boolean;
  /** TodoList.canUpload: "Add a file" offers Upload. */
  canUpload: boolean;
  /** Says a line in the panel's status region (the drawer's status line, shown while the panel is open). */
  onStatus: (text: string, isError?: boolean) => void;
  /** Add form: start personal (the Personal filter is showing). */
  startPersonal: boolean;
  /** Add form: start in this project (the drawer's project filter). */
  startProject?: string;
  onEdit: (todo: TodoItem) => void;
  /** Back to reading, dropping the draft. The panel asks first when anything changed. */
  onCancelEdit: () => void;
  onSave: (todo: TodoItem, actions: TodoAction[]) => Promise<ChangeTodosResult>;
  /** A tick box pressed while reading: the whole new details, sent as one change. True when it was saved. */
  onTick: (todo: TodoItem, markdown: string) => Promise<boolean>;
  onDone: (todo: TodoItem) => void;
  onDelete: (todo: TodoItem) => void;
  onAdd: (action: TodoAction) => void;
  onCancelAdd: () => void;
}

/** Windows: `E` edits while reading. A key typed into a field is never a shortcut. */
function isTypingTarget(el: Element | null): boolean {
  return el instanceof HTMLElement && (el.matches('input, textarea, select') || el.isContentEditable);
}

/**
 * The to-do panel: a wide glass panel that slides out from the To-dos drawer's right edge. It reads a to-do
 * formatted, switches to editing (a small rich-text editor for the details) and adds new ones. Whatever is
 * edited is saved back as markdown (`TodoDetailsEditor`). Plan: docs/plans/2026-11-16-todo-panel.md.
 */
export default function TodoPanel(props: TodoPanelProps) {
  const { todo, mode, message, isError } = props;
  const asked = props.asked ?? null;
  const done = props.done ?? null;
  const teamTodo = props.teamTodo ?? null;
  const { state, dispatch, modes } = useShell();
  const panel = state.todoPanel;
  const addStart = panel?.mode === 'add' ? (panel.start ?? null) : null;
  const overlays = modes.drawerOverlays;
  const headId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);

  const [addDirty, setAddDirty] = useState(false);
  // Older servers send no `canProject`: the Project and Stage fields stay hidden.
  const { todos: todoData, boot, toggleFavouriteTodo } = useStore();
  const canProject = todoData?.canProject === true;
  const favouriteTodos = boot?.prefs.favouriteTodos ?? NO_FAVOURITES;

  const draft = props.draft;
  // With canAttach the panel works on the details part only: the Files section is its own block.
  const body = todo !== null ? detailsText(todo, props.canAttach) : '';
  const tooLong = todo !== null && body.length > TODO_DETAILS_MAX;
  const faithful = useMemo(() => todo !== null && !tooLong && isFaithful(body), [todo, tooLong, body]);
  const detailsEditable = faithful;
  const actions =
    todo !== null && mode === 'edit'
      ? buildEditActions(todo, draft, detailsEditable, props.canAttach, canProject)
      : [];
  const dirty = mode === 'add' ? addDirty : mode === 'edit' && actions.length > 0;
  const overLimit = mode === 'edit' && detailsEditable && draft.details.length > TODO_DETAILS_MAX;

  // The shell asks before anything that would lose the draft (close, previous, next, a drawer swap).
  useEffect(() => {
    dispatch({ type: 'set-todo-dirty', dirty });
  }, [dirty, dispatch]);

  const ask = panel?.ask ?? null;

  // Where the keyboard starts: the heading when reading, the title when editing or adding (its own field).
  const key = todo?.key ?? asked?.key ?? done?.key ?? teamTodo?.key ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart when the to-do or mode changes only.
  useEffect(() => {
    if (mode === 'edit') titleInput.current?.focus();
    else if (mode === 'read') heading.current?.focus({ preventScroll: true });
  }, [key, mode]);
  // Back from editing (Save or Cancel): the Edit button, the way the row's button used to.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && mode === 'read') editButton.current?.focus({ preventScroll: true });
    wasEditing.current = mode === 'edit';
  }, [mode]);

  // `E` edits a to-do being read.
  const canEditThis = props.canEdit && todo !== null;
  useEffect(() => {
    if (mode !== 'read' || !canEditThis || todo === null || !state.singleKeys) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'e' || isTypingTarget(document.activeElement)) return;
      if (state.paletteOpen || state.viewer) return;
      e.preventDefault();
      props.onEdit(todo);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, canEditThis, todo, state.singleKeys, state.paletteOpen, state.viewer, props.onEdit]);

  const order = panel?.order ?? [];
  const at = key ? order.indexOf(key) : -1;
  const hasPrev = at > 0;
  const hasNext = at >= 0 && at < order.length - 1;
  const step = (dir: -1 | 1) => {
    if (dir === -1 ? hasPrev : hasNext) dispatch({ type: 'todo-step', dir });
  };
  const close = () => dispatch({ type: 'close-todo' });

  const title =
    mode === 'add' ? 'Add a task' : (todo?.title ?? asked?.title ?? done?.title ?? teamTodo?.title ?? '');
  const keys = state.singleKeys;

  return (
    <div className="todo-layer" data-overlay={overlays ? 'true' : 'false'}>
      {/* A pointer shortcut only: Esc and the close button do the same. */}
      <div className="todo-veil" aria-hidden="true" onClick={close} />
      <section
        className="todo-panel glass"
        role="dialog"
        aria-modal={overlays ? 'true' : undefined}
        aria-labelledby={headId}
        onKeyDown={(e) => {
          // The editor takes Esc itself (and marks it handled), so the shell's own key listener never sees it:
          // close through the shell, which asks first when there are unsaved changes. The link field and the
          // "Discard your changes?" strip stop their own Esc before it gets here.
          if (e.key !== 'Escape' || !(e.target instanceof Element) || !e.target.closest('.todo-prose'))
            return;
          e.preventDefault();
          close();
        }}
      >
        <header className="panel-head todo-head">
          <h2 id={headId} ref={heading} tabIndex={-1}>
            {title}
          </h2>
          {todo !== null && mode !== 'add' ? (
            <StarButton
              id={todo.key}
              title={todo.title}
              on={favouriteTodos.includes(todo.key)}
              onPress={(id) => void toggleFavouriteTodo(id)}
            />
          ) : null}
          {mode === 'add' ? null : (
            <>
              <button
                type="button"
                className="icon-btn"
                aria-label="Previous task"
                data-tip={keys ? 'Previous task (P)' : 'Previous task'}
                aria-disabled={hasPrev ? undefined : true}
                onClick={() => step(-1)}
              >
                <Icon name="up" size={18} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Next task"
                data-tip={keys ? 'Next task (N)' : 'Next task'}
                aria-disabled={hasNext ? undefined : true}
                onClick={() => step(1)}
              >
                <Icon name="chevron" size={18} />
              </button>
            </>
          )}
          <button type="button" className="icon-btn" aria-label="Close task" data-tip="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        {ask ? (
          <Confirm
            label="Discard your changes"
            text="Discard your changes?"
            action="Discard changes"
            safe="Keep editing"
            variant="danger"
            busy={false}
            onConfirm={() => dispatch({ type: 'discard-todo' })}
            onCancel={() => dispatch({ type: 'keep-todo' })}
          />
        ) : null}
        {/* One status line for every view, so "Added." and the like are announced across view changes. */}
        <Status message={message} isError={isError} />
        {mode === 'add' ? (
          <div className="todo-body todo-add-body">
            <AddTodoForm
              // Opened from a page (a project) it starts where that page says; a new start is a new form.
              key={addStart ? `${addStart.personal ? 'personal' : 'tds'}:${addStart.project}` : 'drawer'}
              me={props.me}
              team={props.team}
              busy={props.busy}
              canAddOpen={props.canAddOpen}
              canUsePersonal={props.canUsePersonal}
              canAttach={props.canAttach}
              canProject={canProject}
              startPersonal={addStart ? addStart.personal : props.startPersonal}
              startProject={addStart ? addStart.project : props.startProject}
              onAdd={props.onAdd}
              onCancel={props.onCancelAdd}
              onDirty={setAddDirty}
            />
          </div>
        ) : asked ? (
          <AskedReadView asked={asked} team={props.team} me={props.me} onStatus={props.onStatus} />
        ) : done ? (
          <DoneReadView done={done} team={props.team} me={props.me} onStatus={props.onStatus} />
        ) : teamTodo ? (
          <TeamReadView team={teamTodo} roster={props.team} me={props.me} onStatus={props.onStatus} />
        ) : todo === null ? null : mode === 'edit' ? (
          <EditView
            {...props}
            todo={todo}
            actions={actions}
            canProject={canProject}
            dirty={dirty}
            detailsEditable={detailsEditable}
            tooLong={tooLong}
            overLimit={overLimit}
            titleInput={titleInput}
          />
        ) : (
          <ReadView {...props} todo={todo} faithful={faithful} tooLong={tooLong} editButton={editButton} />
        )}
      </section>
    </div>
  );
}

function Status({ message, isError }: { message: string; isError: boolean }) {
  return (
    <p className="todo-status" role="status" data-tone={isError ? 'error' : undefined}>
      {message}
    </p>
  );
}

/** The side strip: the to-do's facts. */
function Facts({
  todo,
  me,
  team,
  canUsePersonal,
}: {
  todo: TodoItem;
  me: string;
  team: TeamMember[];
  canUsePersonal: boolean;
}) {
  const { boot, sessions } = useStore();
  const { list } = useProjects();
  const due = todo.due ? dueInWords(todo.due) : '';
  const places = todoPlaceParts(todo, list?.projects, boot?.clients ?? []);
  const who =
    todo.assignee === null
      ? 'Open to anyone'
      : todo.assignee === me
        ? 'You'
        : (team.find((m) => m.slug === todo.assignee)?.name ?? todo.assignee);
  const handover = handoverLine(todo, me);
  const chat = sessions ? chatForTodo(todo.key, sessions.live) : null;
  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: 'Due',
      value: due ? (
        <span className={todo.due && isOverdue(todo.due) ? 'late' : undefined}>{due}</span>
      ) : (
        'No date'
      ),
    },
    { label: 'Assigned to', value: who },
    ...(canUsePersonal || todo.scope === 'personal'
      ? [
          {
            label: 'Kept as',
            value:
              todo.scope === 'personal' ? (
                <>
                  <span className="todo-lock">
                    <Icon name="lock" size={12} />
                  </span>
                  Personal
                </>
              ) : (
                'TDS'
              ),
          },
        ]
      : []),
    ...(places.length > 0 ? [{ label: 'For', value: places.join(', ') }] : []),
    ...(todo.stage ? [{ label: 'Stage', value: todo.stage }] : []),
    ...(handover ? [{ label: 'Handed over', value: handover }] : []),
    ...(chat ? [{ label: 'Chat', value: 'Has a chat' }] : []),
  ];
  return (
    <dl className="todo-facts">
      {rows.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Start or open the chat for a to-do, as the row's chat button does; the panel then closes. */
function useChat(todo: TodoItem) {
  const { boot, newChat, openChat, sessions, view } = useStore();
  const { state, dispatch, modes } = useShell();
  // Opened from a project's page: its chat stays beside it.
  const place = view === 'app:projects' ? ({ in: 'drawer' } as const) : undefined;
  const { list: projectList } = useProjects();
  const chat = sessions ? chatForTodo(todo.key, sessions.live) : null;
  // A message saved for later from this task's chat (only a chat beside a project's page can be kept).
  const keepKey = keptDraftKey({ todoId: todo.key });
  const waiting = useKeptDraft(place ? keepKey : null) !== null && !chat;
  return {
    has: chat !== null,
    /** The button's words: its chat, a message saved for later, or a new chat. */
    label: chat ? 'Open chat' : waiting ? 'Open saved message' : 'Start a chat',
    go: () => {
      // Unsaved changes: the panel asks first and the press is dropped (as the row's chat button does).
      if (state.todoPanel?.dirty) return dispatch({ type: 'close-todo' });
      if (chat) keptDrafts.drop(keepKey);
      if (chat) place ? openChat(chat.id, place) : openChat(chat.id);
      else {
        const client = todoChatClient(todo, boot?.clients ?? []);
        const project = todoChatProject(todo, projectList?.projects);
        newChat({
          draft: todoChatDraft(todo),
          todoId: todo.key,
          ...(client !== undefined ? { client } : {}),
          ...(project ? { project } : {}),
          ...place,
        });
      }
      dispatch({ type: 'close-todo', force: true });
      if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
    },
  };
}

function ReadView({
  todo,
  faithful,
  tooLong,
  editButton,
  ...p
}: TodoPanelProps & {
  todo: TodoItem;
  faithful: boolean;
  tooLong: boolean;
  editButton: React.RefObject<HTMLButtonElement | null>;
}) {
  const chat = useChat(todo);
  const uid = useId();
  // The Files block shows whenever files can be added, and read only to anyone who can't edit here (a
  // teammate on the team role, or with changes switched off), so linked files can still be opened. Only a
  // person who edits without the attach capability sees the whole body, section included (overseer).
  const filesBlock = p.canAttach || (!p.canEdit && splitTodoFiles(todo.details).files !== '');
  const shown = detailsText(todo, filesBlock);
  const canTickDetails = p.canEdit && faithful && !tooLong;
  const note = tooLong ? LONG_NOTE : faithful ? null : UNFAITHFUL_NOTE;
  // A tick shows at once, while it saves, and only while the details it was made on are still the ones shown.
  const [ticked, setTicked] = useState<{ key: string; from: string; md: string } | null>(null);
  const tickedNow = ticked && ticked.key === todo.key && ticked.from === shown ? ticked.md : null;
  const onToggleTask = canTickDetails
    ? (index: number, checked: boolean) => {
        if (p.busy || tickedNow !== null) return;
        const next = setTask(shown, index, checked);
        if (next === shown || next.length > TODO_DETAILS_MAX) return;
        setTicked({ key: todo.key, from: shown, md: next });
        // Saved or not, it is done: a saved tick comes back in the details themselves (review finding: held on,
        // it showed again, and blocked every press, if the details later went back to what they were).
        void p.onTick(todo, next).finally(() => setTicked(null));
      }
    : undefined;
  return (
    <>
      <div className="todo-body">
        <div className="todo-main-col" aria-busy={p.busy}>
          {shown ? (
            <TodoDetailsEditor
              markdown={tickedNow ?? shown}
              editable={false}
              onToggleTask={onToggleTask}
              pending={p.busy || tickedNow !== null}
              label="Details"
              describedBy={note ? `${uid}-note` : undefined}
            />
          ) : (
            <p className="todo-empty">No details yet.</p>
          )}
          {note && p.canEdit ? (
            <p className="todo-note" id={`${uid}-note`}>
              {note}
            </p>
          ) : null}
          {filesBlock ? (
            <TodoFiles
              key={`files:${todo.key}`}
              attachments={todo.attachments}
              todo={p.canEdit && p.canAttach ? todo : null}
              canAttach={p.canEdit && p.canAttach}
              extras={todoFileExtras(todo.details)}
              canUpload={p.canUpload}
              me={p.me}
              team={p.team}
              busy={p.busy}
              onStatus={p.onStatus}
            />
          ) : null}
          {todo.scope !== 'personal' ? <TodoHistory key={todo.key} todoKey={todo.key} team={p.team} /> : null}
        </div>
        <Facts todo={todo} me={p.me} team={p.team} canUsePersonal={p.canUsePersonal} />
      </div>
      <footer className="todo-foot">
        <div className="todo-foot-group">
          <button type="button" className="btn" data-variant="primary" onClick={chat.go}>
            {chat.label}
          </button>
          {p.canEdit || p.canTick ? (
            <button
              type="button"
              className="btn"
              aria-disabled={p.busy || undefined}
              onClick={() => {
                if (!p.busy) p.onDone(todo);
              }}
            >
              Mark as done
            </button>
          ) : null}
          {/* Delete is a standard button: it has an Undo, so it isn't red (rule 5). */}
          {p.canEdit ? (
            <button
              type="button"
              className="btn"
              aria-disabled={p.busy || undefined}
              onClick={() => {
                if (!p.busy) p.onDelete(todo);
              }}
            >
              Delete
            </button>
          ) : null}
        </div>
        {p.canEdit ? (
          <div className="todo-foot-group">
            <button type="button" className="btn" ref={editButton} onClick={() => p.onEdit(todo)}>
              <Icon name="edit" size={14} />
              Edit
            </button>
          </div>
        ) : null}
      </footer>
    </>
  );
}

/** What the read-only panel shows for a to-do that isn't the person's to change (passed on, or finished). */
interface ReadOnlyItem {
  key: string;
  /** The history key, when it isn't `key` (a teammate's to-do is panelled as `team:todo/<id>`, kept as `<id>`). */
  historyKey?: string;
  details: string;
  attachments: AskedTodo['attachments'];
  due: string | null;
  /** The due date is shown as late. */
  overdue: boolean;
  status: string;
  /** Who it was with, as a fact row; omitted for none. */
  assigned?: string;
  /** The footer line saying why it can't be changed. */
  note: string;
}

/** Read only: no Edit, tick, pass on, delete or chat. Used for to-dos passed on (Asked) and finished ones (Done). */
function ReadOnlyView({
  item,
  team,
  me,
  onStatus,
}: {
  item: ReadOnlyItem;
  team: TeamMember[];
  me: string;
  onStatus: (text: string, isError?: boolean) => void;
}) {
  // The Files section is shown as a list below the details, so it is left out of the text.
  const details = splitTodoFiles(item.details).details;
  const due = item.due ? dueInWords(item.due) : '';
  return (
    <>
      <div className="todo-body">
        <div className="todo-main-col">
          {details ? (
            <TodoDetailsEditor markdown={details} editable={false} label="Details" />
          ) : (
            <p className="todo-empty">No details yet.</p>
          )}
          <TodoFiles
            attachments={item.attachments}
            todo={null}
            canAttach={false}
            extras={todoFileExtras(item.details)}
            canUpload={false}
            me={me}
            team={team}
            busy={false}
            onStatus={onStatus}
          />
          <TodoHistory key={item.historyKey ?? item.key} todoKey={item.historyKey ?? item.key} team={team} />
        </div>
        <dl className="todo-facts">
          <div>
            <dt>Status</dt>
            <dd>{item.status}</dd>
          </div>
          {item.assigned ? (
            <div>
              <dt>Assigned to</dt>
              <dd>{item.assigned}</dd>
            </div>
          ) : null}
          <div>
            <dt>Due</dt>
            <dd>{due ? <span className={item.overdue ? 'late' : undefined}>{due}</span> : 'No date'}</dd>
          </div>
        </dl>
      </div>
      <footer className="todo-foot">
        <p className="todo-note todo-foot-note">{item.note}</p>
      </footer>
    </>
  );
}

/** A to-do you passed on: read only. It is someone else's now. */
function AskedReadView({
  asked,
  ...rest
}: {
  asked: AskedTodo;
  team: TeamMember[];
  me: string;
  onStatus: (text: string, isError?: boolean) => void;
}) {
  const first =
    asked.state === 'done' ? asked.done?.name?.split(/\s+/)[0] : asked.assigneeName.split(/\s+/)[0];
  const note =
    asked.state === 'done'
      ? `${first ? `${first} ticked this off` : 'This task was ticked off'}, so it can't be changed here.`
      : `This is ${first || asked.assigneeName}'s task now, so you can read it but not change it.`;
  return (
    <ReadOnlyView
      {...rest}
      item={{
        key: asked.key,
        details: asked.details,
        attachments: asked.attachments,
        due: asked.due,
        overdue: asked.state === 'waiting' && asked.due !== null && isOverdue(asked.due),
        status: askedStatusLine(asked),
        note,
      }}
    />
  );
}

/** A finished to-do: read only, with its history. Nothing on it can be changed from here. */
function DoneReadView({
  done,
  ...rest
}: {
  done: DoneTodo;
  team: TeamMember[];
  me: string;
  onStatus: (text: string, isError?: boolean) => void;
}) {
  return (
    <ReadOnlyView
      {...rest}
      item={{
        key: done.key,
        details: done.details,
        attachments: done.attachments,
        due: done.due,
        overdue: false,
        status: doneStatusLine(done),
        assigned: done.assigneeName ?? undefined,
        note: 'This task is finished, so it can only be read here.',
      }}
    />
  );
}

/** A teammate's open to-do: read only, with its history (kept under the plain file name). */
function TeamReadView({
  team,
  roster,
  ...rest
}: {
  team: TeamTodo;
  roster: TeamMember[];
  me: string;
  onStatus: (text: string, isError?: boolean) => void;
}) {
  return (
    <ReadOnlyView
      {...rest}
      team={roster}
      item={{
        key: team.key,
        historyKey: team.id,
        details: team.details,
        attachments: team.attachments,
        due: team.due,
        overdue: team.due !== null && isOverdue(team.due),
        status: teamStatusLine(team),
        note: teamNote(team),
      }}
    />
  );
}

function EditView({
  todo,
  actions,
  dirty,
  detailsEditable,
  tooLong,
  overLimit,
  titleInput,
  ...p
}: TodoPanelProps & {
  todo: TodoItem;
  actions: TodoAction[];
  dirty: boolean;
  detailsEditable: boolean;
  tooLong: boolean;
  overLimit: boolean;
  canProject: boolean;
  titleInput: React.RefObject<HTMLInputElement | null>;
}) {
  const uid = useId();
  const { dispatch } = useShell();
  const chat = useChat(todo);
  const [askDrop, setAskDrop] = useState(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const { list: projectList } = useProjects();
  const { draft, setDraft, me, team } = p;
  const set = (patch: Partial<EditDraft>) => setDraft((d) => ({ ...d, ...patch }));
  // Giving a personal to-do to someone else makes it a TDS one: they can't see a personal file.
  const setAssignee = (v: string) =>
    setDraft((d) => ({
      ...d,
      assignee: v,
      ...(d.scope === 'personal' && v !== me ? { scope: 'tds' as const } : {}),
    }));
  const passing = todo.scope === 'personal' && draft.scope === 'tds' && draft.assignee !== me;
  const switchable = p.canUsePersonal && todo.assignee === me && draft.assignee === me;
  const handover = handoverLine(todo, me);
  const warnPersonal = switchable && draft.scope === 'personal' && todo.scope !== 'personal';
  const conflictRef = useRef<HTMLParagraphElement>(null);
  const hasConflict = draft.theirs !== undefined;
  // Bring the conflict note into view without moving focus off Save.
  useEffect(() => {
    if (hasConflict) conflictRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [hasConflict]);

  const noTitle = draft.title.trim() === '';
  const canSave = !p.busy && !noTitle && !overLimit;
  // Moving a to-do out of a private project removes it from the project: ask before saving (decision 8).
  const dropping = actions.some((a) => a.kind === 'move' && a.dropProject === true);
  useEffect(() => {
    if (!dropping) setAskDrop(false);
  }, [dropping]);
  const save = (confirmed = false) => {
    if (!canSave) return;
    if (actions.length === 0) return p.onCancelEdit();
    if (dropping && !confirmed) return setAskDrop(true);
    setAskDrop(false);
    void p.onSave(todo, actions);
  };
  const projectNow = draft.project ?? todoProjectValue(todo);
  const assignGate = useAssignGate(draft.scope === 'tds' ? projectNow : '');
  const stageNow = draft.stage ?? todo.stage ?? '';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  };
  // Moving to the team: a private project can't come along, so it shows as none and is left out of the save,
  // but the draft keeps it: switching back to Personal restores the project and stage as they were.
  const setScope = (scope: TodoScope) => set({ scope });
  // The question was dismissed (Cancel or Escape): the move is undone, so the scope returns with its
  // project and stage, and the keyboard goes back to Save.
  const closeAsk = () => {
    setAskDrop(false);
    set({ scope: todo.scope });
    saveButton.current?.focus();
  };
  const privateKey = todoProjectValue(todo);
  const privateName =
    projectList?.projects.find((c) => c.key === privateKey)?.title || privateKey.split('/')[1] || null;
  const detailsNote = tooLong ? LONG_NOTE : detailsEditable ? null : UNFAITHFUL_NOTE;

  return (
    <form
      className="todo-edit-form"
      onSubmit={submit}
      onKeyDown={onKeyDown}
      aria-label={`Edit "${todo.title}"`}
      aria-describedby={draft.theirs ? `${uid}-conflict` : undefined}
    >
      <div className="todo-body">
        <div className="todo-main-col">
          {handover ? <p className="todo-note todo-handover">{handover}</p> : null}
          <div className="form-field">
            <label htmlFor={`${uid}-title`}>Title</label>
            <input
              id={`${uid}-title`}
              ref={titleInput}
              className="field"
              value={draft.title}
              maxLength={TODO_TITLE_MAX}
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>
          <div className="form-field">
            <span className="label" id={`${uid}-details-label`}>
              Details
            </span>
            {detailsEditable ? (
              <TodoDetailsEditor
                markdown={draft.details}
                editable
                onChange={(md) => set({ details: md })}
                label="Details"
                describedBy={overLimit ? `${uid}-over` : undefined}
              />
            ) : (
              <>
                <TodoDetailsEditor
                  markdown={detailsText(todo, p.canAttach)}
                  editable={false}
                  label="Details"
                  describedBy={`${uid}-long`}
                />
                <p className="hint" id={`${uid}-long`}>
                  {detailsNote}
                </p>
              </>
            )}
            {overLimit ? (
              <p className="error" id={`${uid}-over`} role="alert">
                These details are longer than {TODO_DETAILS_MAX.toLocaleString('en-GB')} characters, so they
                can't be saved here. Shorten them, or change them in a chat.
              </p>
            ) : null}
          </div>
        </div>
        <div className="todo-side-edit">
          <div className="form-field">
            <label htmlFor={`${uid}-due`}>Due date</label>
            <div className="todo-inline">
              <input
                id={`${uid}-due`}
                type="date"
                className="field"
                value={draft.due}
                onChange={(e) => set({ due: e.target.value })}
              />
              <button
                type="button"
                className="btn"
                data-variant="quiet"
                disabled={draft.due === ''}
                onClick={() => set({ due: '' })}
              >
                Clear date
              </button>
            </div>
          </div>
          <div className="form-field">
            <label htmlFor={`${uid}-who`}>Assigned to</label>
            <Assignee
              id={`${uid}-who`}
              value={draft.assignee}
              onChange={setAssignee}
              me={me}
              team={team}
              allowOpen
              blocked={assignGate}
            />
            {passing ? <p className="todo-note">{PASS_ON_NOTE}</p> : null}
          </div>
          {p.canProject ? (
            <ProjectFields
              id={uid}
              scope={draft.scope}
              client={todo.client}
              project={projectNow.startsWith('personal/') && draft.scope === 'tds' ? '' : projectNow}
              stage={stageNow}
              onChange={(n) => set({ project: n.project, stage: n.stage })}
            />
          ) : null}
          {p.canProject && todo.projectMatch?.how === 'restricted' ? (
            <p className="hint" id={`${uid}-restricted`}>
              This task is in a restricted project that isn't shown here. Choosing a project above moves it
              out of that project.
            </p>
          ) : null}
          {switchable ? (
            <div className="form-field">
              <span className="label">Where it's kept</span>
              <Seg<TodoScope>
                label="Where this task is kept"
                value={draft.scope}
                onChange={setScope}
                options={[
                  { value: 'tds', label: 'TDS' },
                  { value: 'personal', label: 'Personal' },
                ]}
              />
              {warnPersonal ? (
                <p className="hint" id={`${uid}-personal`}>
                  {PERSONAL_WARNING}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {askDrop ? (
        <Confirm
          label="Move to the team"
          text={dropProjectQuestion(privateName)}
          action="Move to the team"
          variant="primary"
          busy={false}
          onConfirm={() => save(true)}
          onCancel={closeAsk}
        />
      ) : null}
      {draft.theirs ? (
        <p className="todo-note" id={`${uid}-conflict`} ref={conflictRef}>
          {conflictNote(draft.theirs, draft, team, me)}
        </p>
      ) : null}
      <footer className="todo-foot">
        <div className="todo-foot-group">
          <button type="button" className="btn" onClick={chat.go}>
            {chat.label}
          </button>
          <button
            type="button"
            className="btn"
            aria-disabled={p.busy || dirty || undefined}
            aria-describedby={dirty ? `${uid}-dirty` : undefined}
            onClick={() => {
              if (!p.busy && !dirty) p.onDone(todo);
            }}
          >
            Mark as done
          </button>
          <button
            type="button"
            className="btn"
            aria-disabled={p.busy || undefined}
            onClick={() => {
              if (!p.busy) p.onDelete(todo);
            }}
          >
            Delete
          </button>
        </div>
        <div className="todo-foot-group">
          <button
            type="submit"
            className="btn"
            data-variant="primary"
            ref={saveButton}
            aria-disabled={canSave ? undefined : true}
            aria-describedby={
              [noTitle ? `${uid}-no-title` : '', warnPersonal ? `${uid}-personal` : '']
                .filter(Boolean)
                .join(' ') || undefined
            }
          >
            Save
          </button>
          {/* Anything changed asks "Discard your changes?" in the strip under the header; nothing changed just leaves. */}
          <button
            type="button"
            className="btn"
            onClick={() =>
              dirty
                ? dispatch({ type: 'ask-todo', after: { type: 'set-todo-mode', mode: 'read' } })
                : p.onCancelEdit()
            }
          >
            Cancel
          </button>
        </div>
        {noTitle ? (
          <p className="todo-note todo-foot-note" id={`${uid}-no-title`}>
            Add a title to save.
          </p>
        ) : null}
        {dirty ? (
          <p className="todo-note todo-foot-note" id={`${uid}-dirty`}>
            Save or cancel your changes before marking it as done.
          </p>
        ) : null}
      </footer>
    </form>
  );
}
