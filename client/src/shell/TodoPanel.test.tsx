// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AskedTodo,
  AskedTodoList,
  TodoChangeAccess,
  TodoItem,
  TodoList,
} from '../../../shared/contract.ts';
import { lookedMark, type TodoLooked } from '../../../shared/todo-changes.ts';
import type { TodoUpdate } from '../../../shared/todo-updates-contract.ts';
import type { HeldTodo } from '../store.tsx';
import type { ShellApi } from './contract.ts';

// The real shell (its reducer, its guard for unsaved changes, its keys) with the real drawer and panel. Only the
// store, the editor and the converter are stand-ins: the editor and converter need a real browser.
const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const apiMock = vi.hoisted(() => ({ todoHistory: vi.fn() }));
vi.mock('../api.ts', () => ({ api: apiMock }));
vi.mock('../store.tsx', () => ({
  useStore: () => store.current,
  useToolSnapshot: () => ({ ads: store.current.ads ?? null }),
  TODO_UNDO_MS: 10_000,
}));
vi.mock('./TodoDetailsEditor.tsx', async () => ({
  default: (await import('./todo-test-kit.tsx')).FakeDetailsEditor,
}));
vi.mock('../todo-doc/index.ts', async () => (await import('./todo-test-kit.tsx')).todoDocFake);
const { askedStoreFields } = await import('./todo-test-kit.tsx');

const { ShellProvider, useShell } = await import('./ShellProvider.tsx');
const { TodosDrawer, PANEL_WAIT_MS } = await import('./TodosDrawer.tsx');

let api: ShellApi;
function Probe() {
  api = useShell();
  return null;
}

const todo = (id: string, title: string, over: Partial<TodoItem> = {}): TodoItem => ({
  id,
  scope: 'tds',
  key: id,
  path: `todo/${id}`,
  handover: null,
  createdBy: null,
  title,
  assignee: 'sam-example',
  due: '2999-01-01',
  surfaceDate: null,
  project: null,
  client: null,
  created: null,
  source: null,
  details: 'Some notes',
  version: 'v1',
  attachments: [],
  ...over,
});

const changeTodos = vi.fn();
const holdTodo = vi.fn();
const undoHeld = vi.fn();
const newChat = vi.fn();

function setStore(
  changes: TodoChangeAccess,
  mine: TodoItem[],
  { directWrites = true, held = [] as HeldTodo[] } = {},
) {
  store.current = {
    ...askedStoreFields,
    changeTodos,
    openView: vi.fn(),
    heldTodos: held,
    holdTodo,
    undoHeld,
    pauseHeld: vi.fn(),
    resumeHeld: vi.fn(),
    markTodosSeen: vi.fn(),
    toggleFavouriteTodo: vi.fn(),
    clearReveal: vi.fn(),
    reveal: null,
    newChat,
    openChat: vi.fn(),
    view: 'chat',
    activeChat: { kind: 'new', key: 1, draft: '', skill: null, todoId: null },
    chats: {},
    boot: {
      clients: [],
      identity: { slug: 'sam-example', role: 'owner' },
      prefs: { directWrites },
    },
    todos: {
      mine,
      open: [],
      othersCount: 0,
      team: [
        { slug: 'sam-example', name: 'Sam Example' },
        { slug: 'ben-mcadam', name: 'Ben McAdam' },
      ],
      changes,
      canAddOpen: false,
      canAttach: false,
      canUpload: false,
      canUsePersonal: false,
    } satisfies TodoList,
    sessions: { live: [], past: [] },
  };
}

const three = () => [todo('a.md', 'First'), todo('b.md', 'Second'), todo('c.md', 'Third')];

function mount() {
  const view = render(
    <ShellProvider>
      <Probe />
      <TodosDrawer />
    </ShellProvider>,
  );
  act(() => api.dispatch({ type: 'open-drawer', drawer: 'todos' }));
  return view;
}
/** The to-dos reloading: the store hands the drawer a new `todos` object. */
const reload = (view: ReturnType<typeof mount>) => {
  const s = store.current as { todos: TodoList };
  store.current = { ...s, todos: { ...s.todos } };
  view.rerender(
    <ShellProvider>
      <Probe />
      <TodosDrawer />
    </ShellProvider>,
  );
};
/** The row title buttons, in the order the drawer shows them. */
const rowKeys = () =>
  [...document.querySelectorAll<HTMLElement>('[data-panel-for]')].map((b) =>
    b.getAttribute('data-panel-for'),
  );
const titleButton = (title: string) => screen.getByRole('button', { name: title });
const dialog = () => screen.findByRole('dialog');
const open = async (title: string) => {
  fireEvent.click(titleButton(title));
  return dialog();
};
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.body, { key, ...init });
const heading = () => within(screen.getByRole('dialog')).getByRole('heading', { level: 2 }).textContent;
const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  window.localStorage.clear();
  window.innerWidth = 1280;
  changeTodos.mockReset();
  changeTodos.mockResolvedValue({ done: 1 });
  holdTodo.mockReset();
  undoHeld.mockReset();
  newChat.mockReset();
  setStore('on', three());
});
afterEach(cleanup);

describe('opening and reading', () => {
  it('opens in reading mode when a title is pressed, with the details shown and an Edit button', async () => {
    mount();
    const panel = await open('First');
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe('First');
    expect(within(panel).getByLabelText('Details').textContent).toContain('Some notes');
    expect(within(panel).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Details' })).toBeNull();
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'read' });
    expect(panel.getAttribute('aria-modal')).toBeNull();
  });

  it('says so when there are no details', async () => {
    setStore('on', [todo('a.md', 'First', { details: '' })]);
    mount();
    await open('First');
    expect(screen.getByText('No details yet.')).toBeTruthy();
  });

  it('is modal when the drawer floats over the sheet (a narrow window)', async () => {
    window.innerWidth = 700;
    mount();
    const panel = await open('First');
    expect(panel.getAttribute('aria-modal')).toBe('true');
  });

  it('opens with changes switched off, read only', async () => {
    setStore('switched-off', three(), { directWrites: false });
    mount();
    const panel = await open('First');
    for (const name of ['Edit', 'Delete', 'Mark as done', 'Save']) {
      expect(within(panel).queryByRole('button', { name })).toBeNull();
    }
    expect(within(panel).getByLabelText('Details').textContent).toContain('Some notes');
  });

  it('keeps the update log out of the details when changes are off and the task has no files (browser check R2)', async () => {
    const withLog = {
      ...todo('a.md', 'First'),
      details:
        'Some notes\n\n## Updates\n\n- 27 Nov 2026, 14:05 UK: Ben McAdam (ben-mcadam) wrote: Sent the quote.\n\n## Handover history\n\n- 25 Nov 2026, 10:00 UK: Ben McAdam passed it from ben-mcadam to sam-example (TDS Cortex).',
    };
    setStore('switched-off', [withLog], { directWrites: false });
    mount();
    const panel = await open('First');
    const details = within(panel).getByLabelText('Details').textContent ?? '';
    expect(details).toContain('Some notes');
    expect(details).not.toContain('Sent the quote');
    expect(details).not.toContain('Handover history');
  });

  it('shows someone who may only tick things off just "Mark as done" (no Edit, no Delete)', async () => {
    setStore('restricted', three(), { directWrites: true });
    mount();
    const panel = await open('First');
    expect(within(panel).getByRole('button', { name: 'Mark as done' })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Delete' })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Mark as done' }));
    expect(holdTodo).toHaveBeenCalledWith(expect.objectContaining({ todoId: 'a.md', kind: 'tick' }));
    expect(api.state.todoPanel).toBeNull();
    // They never get a tick box in the details either.
    expect(screen.queryByRole('button', { name: /^Tick/ })).toBeNull();
  });

  // The read-only "Options" (three dots) button is gone (plan 2026-11-22-ux-consistency, decision 10): the title
  // opens the same read view, so someone who may only tick things off uses that.
  it('someone who may only tick things off has no Options button; the title opens the same panel', async () => {
    setStore('restricted', three(), { directWrites: true });
    mount();
    expect(screen.queryByRole('button', { name: /^Options for/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    await dialog();
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'read' });
  });
});

describe('a task the drawer never gets', () => {
  afterEach(() => vi.useRealTimers());

  it('closes the panel after PANEL_WAIT_MS, so no empty panel is left over a locked sheet', () => {
    vi.useFakeTimers();
    mount();
    // A teammate's to-do (not on this person's lists): the panel can't show it.
    act(() => api.dispatch({ type: 'open-todo', key: 'someone-elses.md', mode: 'read' }));
    expect(api.state.todoPanel?.key).toBe('someone-elses.md');
    act(() => vi.advanceTimersByTime(PANEL_WAIT_MS - 1));
    expect(api.state.todoPanel).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(api.state.todoPanel).toBeNull();
  });

  it('also gives up when the task list never loaded (the panel was opened from a project page)', () => {
    vi.useFakeTimers();
    const s0 = store.current as { todos: TodoList | null };
    store.current = { ...s0, todos: null };
    mount();
    act(() => api.dispatch({ type: 'open-todo', key: 'a.md', mode: 'read' }));
    expect(api.state.todoPanel?.key).toBe('a.md');
    act(() => vi.advanceTimersByTime(PANEL_WAIT_MS));
    expect(api.state.todoPanel).toBeNull();
  });

  it('still waits for one that shows up in time (just added) and keeps it open', () => {
    vi.useFakeTimers();
    const view = mount();
    act(() => api.dispatch({ type: 'open-todo', key: 'new.md', mode: 'read' }));
    act(() => vi.advanceTimersByTime(PANEL_WAIT_MS / 2));
    const s = store.current as { todos: TodoList };
    store.current = { ...s, todos: { ...s.todos, mine: [...s.todos.mine, todo('new.md', 'Just added')] } };
    reload(view);
    act(() => vi.advanceTimersByTime(PANEL_WAIT_MS * 2));
    expect(api.state.todoPanel?.key).toBe('new.md');
  });
});

describe('editing and saving', () => {
  it('Edit switches to editing and Save sends only what changed, details as markdown', async () => {
    mount();
    await open('First');
    edit();
    type('Details', '## Plan\n\n- [ ] one');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(1));
    expect(changeTodos).toHaveBeenCalledWith([
      { kind: 'edit', id: 'a.md', title: 'First', details: '## Plan\n\n- [ ] one', expect: 'v1' },
    ]);
    // Saved: back to reading it.
    await waitFor(() => expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'read' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('sends no details when only the title changed', async () => {
    mount();
    await open('First');
    edit();
    type('Title', 'First, renamed');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos).toHaveBeenCalledWith([
      { kind: 'edit', id: 'a.md', title: 'First, renamed', expect: 'v1' },
    ]);
  });

  it('Cancel with changes asks "Discard your changes?"; Discard goes back to reading and drops them', async () => {
    mount();
    await open('First');
    edit();
    type('Title', 'Nope');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // Standard 9: Cancel asks once anything has changed (it used to leave without asking).
    expect(screen.queryByText('Discard your changes?')).not.toBeNull();
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'edit' });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByText('Discard your changes?')).toBeNull();
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'read' });
    expect(changeTodos).not.toHaveBeenCalled();
  });

  it('Keep editing after Cancel keeps the draft', async () => {
    mount();
    await open('First');
    edit();
    type('Title', 'Nope');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'edit' });
    expect(screen.getByLabelText('Title')).toHaveProperty('value', 'Nope');
  });

  it('Cancel with nothing changed just leaves, without asking', async () => {
    mount();
    await open('First');
    edit();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Discard your changes?')).toBeNull();
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'read' });
  });

  it('Delete is a standard button (it has an Undo), and the header runs star, previous, next, close', async () => {
    mount();
    const panel = await open('Second');
    expect(within(panel).getByRole('button', { name: 'Delete' }).getAttribute('data-variant')).toBeNull();
    const head = panel.querySelector('.todo-head') as HTMLElement;
    const labels = [...head.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Pin: Second', 'Previous task', 'Next task', 'Close task']);
  });

  it('the header star toggles the task as a favourite', async () => {
    mount();
    const panel = await open('Second');
    fireEvent.click(within(panel).getByRole('button', { name: 'Pin: Second' }));
    expect(
      (store.current as { toggleFavouriteTodo: ReturnType<typeof vi.fn> }).toggleFavouriteTodo,
    ).toHaveBeenCalledWith('b.md');
  });

  it('Ctrl+Enter saves', async () => {
    mount();
    await open('First');
    edit();
    type('Title', 'Quick');
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
  });

  it('the E key edits a task being read', async () => {
    mount();
    await open('First');
    press('e');
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'edit' });
  });

  it('blocks Save, with a note, when the details pass the limit', async () => {
    mount();
    await open('First');
    edit();
    type('Details', 'x'.repeat(8001));
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('alert').textContent).toMatch(/longer than 8,000 characters/);
    type('Details', 'x'.repeat(8000));
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('shows details read-only with the note when they would not come back unchanged, other fields stay editable', async () => {
    setStore('on', [todo('a.md', 'First', { details: 'UNFAITHFUL block' })]);
    mount();
    await open('First');
    edit();
    expect(screen.queryByRole('textbox', { name: 'Details' })).toBeNull();
    expect(screen.getByText(/can't be edited safely here/)).toBeTruthy();
    type('Title', 'Renamed');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos).toHaveBeenCalledWith([{ kind: 'edit', id: 'a.md', title: 'Renamed', expect: 'v1' }]);
  });

  it('shows over-long details read-only with the long note', async () => {
    setStore('on', [todo('a.md', 'First', { details: 'x'.repeat(8001) })]);
    mount();
    await open('First');
    expect(screen.getByText(/too long to edit here/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Tick/ })).toBeNull();
  });
});

describe('ticking while reading', () => {
  beforeEach(() => setStore('on', [todo('a.md', 'First', { details: '- [ ] one\n- [x] two' })]));

  it('sends one details change with the version it was read at, and stays in reading mode', async () => {
    mount();
    await open('First');
    fireEvent.click(screen.getByRole('button', { name: 'Tick 1' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(1));
    expect(changeTodos).toHaveBeenCalledWith([
      { kind: 'edit', id: 'a.md', title: 'First', details: '- [x] one\n- [x] two', expect: 'v1' },
    ]);
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'read' });
  });

  it('shows a tick at once, while it saves, and takes it off again if it is refused', async () => {
    let answer: (v: unknown) => void = () => {};
    changeTodos.mockImplementationOnce(
      () =>
        new Promise((r) => {
          answer = r;
        }),
    );
    mount();
    await open('First');
    fireEvent.click(screen.getByRole('button', { name: 'Tick 1' }));
    expect(screen.getByLabelText('Details').textContent).toContain('- [x] one\n- [x] two');
    expect(screen.getByText('Saving your tick…')).toBeTruthy();
    // A second press while the first saves is not sent.
    fireEvent.click(screen.getByRole('button', { name: 'Tick 2' }));
    answer({ done: 0, error: { code: 'internal', message: 'The change could not be made. Try again.' } });
    expect(await screen.findByText("Your tick wasn't saved. Try again.")).toBeTruthy();
    expect(screen.getByLabelText('Details').textContent).toContain('- [ ] one\n- [x] two');
    expect(changeTodos).toHaveBeenCalledTimes(1);
  });

  // Review finding: a saved tick was held on screen, so details later put back elsewhere showed the old tick and
  // every later press was ignored.
  it('a saved tick later undone elsewhere shows as undone, and can be ticked again', async () => {
    changeTodos.mockResolvedValue({ done: 1 });
    const view = mount();
    await open('First');
    fireEvent.click(screen.getByRole('button', { name: 'Tick 1' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(1));
    setStore('on', [todo('a.md', 'First', { details: '- [x] one\n- [x] two', version: 'v2' })]);
    await act(async () => reload(view));
    expect(screen.getByLabelText('Details').textContent).toContain('- [x] one');
    setStore('on', [todo('a.md', 'First', { details: '- [ ] one\n- [x] two', version: 'v3' })]);
    await act(async () => reload(view));
    expect(screen.getByLabelText('Details').textContent).toContain('- [ ] one');
    fireEvent.click(screen.getByRole('button', { name: 'Tick 2' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(2));
  });

  it('shows the refusal in the usual words and leaves the details as they were', async () => {
    changeTodos.mockResolvedValue({
      done: 0,
      error: { code: 'changed', message: 'Someone else changed this task.' },
    });
    mount();
    await open('First');
    fireEvent.click(screen.getByRole('button', { name: 'Tick 2' }));
    expect(await screen.findByText("Your tick wasn't saved. Someone else changed this task.")).toBeTruthy();
    expect(screen.getByLabelText('Details').textContent).toContain('- [ ] one\n- [x] two');
  });

  it('is not offered when the details would not come back unchanged', async () => {
    setStore('on', [todo('a.md', 'First', { details: '- [ ] one UNFAITHFUL' })]);
    mount();
    await open('First');
    expect(screen.queryByRole('button', { name: /^Tick/ })).toBeNull();
  });

  it('is not offered to someone who may not edit', async () => {
    setStore('restricted', [todo('a.md', 'First', { details: '- [ ] one' })]);
    mount();
    await open('First');
    expect(screen.queryByRole('button', { name: /^Tick/ })).toBeNull();
  });
});

describe('previous and next', () => {
  it('walk through the drawer in its order, and the keys P and N do the same', async () => {
    mount();
    const order = rowKeys();
    expect(order).toHaveLength(3);
    const titleOf = (k: string | null | undefined) => three().find((t) => t.key === k)?.title;
    await open(titleOf(order[0]) ?? '');
    const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next task' }));
    const prev = () => fireEvent.click(screen.getByRole('button', { name: 'Previous task' }));
    next();
    expect(heading()).toBe(titleOf(order[1]));
    press('n');
    expect(heading()).toBe(titleOf(order[2]));
    // At the end, Next does nothing.
    next();
    expect(heading()).toBe(titleOf(order[2]));
    expect(screen.getByRole('button', { name: 'Next task' }).getAttribute('aria-disabled')).toBe('true');
    press('p');
    expect(heading()).toBe(titleOf(order[1]));
    prev();
    expect(heading()).toBe(titleOf(order[0]));
  });

  it('skip a task waiting out its Undo', async () => {
    const held: HeldTodo = {
      todoId: 'b.md',
      title: 'Second',
      kind: 'delete',
      label: 'Deleted',
      action: { kind: 'delete', id: 'b.md', expect: 'v1' },
    };
    setStore('on', three(), { held: [held] });
    mount();
    const order = rowKeys();
    expect(order).not.toContain('b.md');
    const titleOf = (k: string | null | undefined) => three().find((t) => t.key === k)?.title ?? '';
    await open(titleOf(order[0]));
    fireEvent.click(screen.getByRole('button', { name: 'Next task' }));
    expect(heading()).toBe(titleOf(order[1]));
    expect(heading()).not.toBe('Second');
  });
});

describe('unsaved changes', () => {
  const dirty = async () => {
    mount();
    await open('First');
    edit();
    type('Title', 'Changed');
  };

  it('ask before closing, before the next task, and before a drawer swap; Keep editing drops the question', async () => {
    await dirty();
    expect(api.state.todoPanel?.dirty).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'edit' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Discard your changes?')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next task' }));
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    expect(api.state.todoPanel?.key).toBe('a.md');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    act(() => api.dispatch({ type: 'toggle-drawer', drawer: 'chats' }));
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    expect(api.state.drawer).toBe('todos');
    expect(screen.getByLabelText('Title')).toHaveProperty('value', 'Changed');
  });

  it('Esc and the single keys ask too', async () => {
    await dirty();
    press('Escape');
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    // Esc on the question keeps editing.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Keep editing' }), { key: 'Escape' });
    expect(screen.queryByText('Discard your changes?')).toBeNull();
    expect(api.state.todoPanel?.key).toBe('a.md');
    press('t');
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    expect(api.state.drawer).toBe('todos');
  });

  it('Discard does what was asked: a drawer swap closes the panel and changes the drawer', async () => {
    await dirty();
    act(() => api.dispatch({ type: 'toggle-drawer', drawer: 'chats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(api.state.drawer).toBe('chats');
    expect(api.state.todoPanel).toBeNull();
    expect(changeTodos).not.toHaveBeenCalled();
  });

  it('Discard on a close or next moves on, in reading mode', async () => {
    await dirty();
    fireEvent.click(screen.getByRole('button', { name: 'Next task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(api.state.todoPanel).toMatchObject({ mode: 'read', dirty: false });
    expect(api.state.todoPanel?.key).not.toBe('a.md');
  });

  it('a clean panel closes straight away on a drawer swap', async () => {
    mount();
    await open('First');
    act(() => api.dispatch({ type: 'toggle-drawer', drawer: 'chats' }));
    expect(api.state.drawer).toBe('chats');
    expect(api.state.todoPanel).toBeNull();
  });

  it('Mark as done and Delete close the panel without asking, and hold the change', async () => {
    mount();
    await open('First');
    edit();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByText('Discard your changes?')).toBeNull();
    expect(holdTodo).toHaveBeenCalledWith(expect.objectContaining({ todoId: 'a.md', kind: 'delete' }));
    expect(api.state.todoPanel).toBeNull();
  });
});

describe('closing and focus', () => {
  it('Esc closes the panel before the drawer, and the keyboard goes back to the row', async () => {
    mount();
    await open('First');
    press('Escape');
    expect(api.state.todoPanel).toBeNull();
    expect(api.state.drawer).toBe('todos');
    await waitFor(() => expect(document.activeElement).toBe(titleButton('First')));
  });

  it('the close button and the veil close it too', async () => {
    mount();
    await open('First');
    fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    expect(api.state.todoPanel).toBeNull();
    await open('Second');
    fireEvent.click(document.querySelector('.todo-veil') as HTMLElement);
    expect(api.state.todoPanel).toBeNull();
  });

  it('puts the keyboard on the heading when it opens, and on the title when editing', async () => {
    mount();
    await open('First');
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H2'));
    edit();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Title')));
  });

  it("on a project's page the chat opens in the drawer, beside the project", async () => {
    (store.current as { view: string }).view = 'app:projects';
    mount();
    await open('First');
    fireEvent.click(screen.getByRole('button', { name: 'Start a chat' }));
    expect(newChat).toHaveBeenCalledWith(expect.objectContaining({ todoId: 'a.md', in: 'drawer' }));
  });

  it("on a project's page a message saved for later renames the button; elsewhere it stays Start a chat", async () => {
    const { keptDrafts } = await import('../state/kept-drafts.ts');
    keptDrafts.save('todo:a.md', { text: 'Half a thought', picks: null });
    mount();
    await open('First');
    expect(screen.getByRole('button', { name: 'Start a chat' })).toBeTruthy();
    cleanup();
    (store.current as { view: string }).view = 'app:projects';
    mount();
    await open('First');
    fireEvent.click(screen.getByRole('button', { name: 'Open saved message' }));
    expect(newChat).toHaveBeenCalledWith(expect.objectContaining({ todoId: 'a.md', in: 'drawer' }));
    keptDrafts.drop('todo:a.md');
  });

  it('starts a chat from the panel and closes it', async () => {
    mount();
    await open('First');
    fireEvent.click(screen.getByRole('button', { name: 'Start a chat' }));
    expect(newChat).toHaveBeenCalledWith(expect.objectContaining({ todoId: 'a.md' }));
    expect(api.state.todoPanel).toBeNull();
  });
});

describe('adding', () => {
  it('opens the add form in the panel, and after adding one for you, stays on it in edit mode', async () => {
    const added = todo('n.md', 'Brand new', { details: '' });
    changeTodos.mockImplementation(async () => {
      const list = { ...(store.current.todos as TodoList), mine: [...three(), added] };
      store.current.todos = list;
      return { done: 1, todos: list };
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    const form = await screen.findByRole('form', { name: 'Add a task' });
    expect(api.state.todoPanel).toMatchObject({ key: null, mode: 'add' });
    fireEvent.change(within(form).getByLabelText('What needs doing?'), { target: { value: 'Brand new' } });
    expect(api.state.todoPanel?.dirty).toBe(true);
    fireEvent.submit(form);
    await waitFor(() => expect(api.state.todoPanel).toMatchObject({ key: 'n.md', mode: 'edit' }));
    expect(await screen.findByRole('form', { name: 'Edit "Brand new"' })).toBeTruthy();
  });

  it('asks before an add with a title typed is closed', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    const form = await screen.findByRole('form', { name: 'Add a task' });
    fireEvent.change(within(form).getByLabelText('What needs doing?'), { target: { value: 'Half typed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
  });
});

describe('another task while editing', () => {
  it('asks first when a different row is pressed, and keeps the draft', async () => {
    mount();
    await open('First');
    edit();
    type('Title', 'Changed');
    fireEvent.click(titleButton('Second'));
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'edit' });
    expect(screen.getByLabelText('Title')).toHaveProperty('value', 'Changed');
  });
});

describe('nothing is lost without asking', () => {
  const dirty = async () => {
    mount();
    await open('First');
    edit();
    type('Title', 'Changed');
  };
  const asked = () => screen.queryByText('Discard your changes?') !== null;

  it('Start a chat asks first when the draft is unsaved, and starts nothing', async () => {
    await dirty();
    fireEvent.click(screen.getByRole('button', { name: 'Start a chat' }));
    expect(asked()).toBe(true);
    expect(newChat).not.toHaveBeenCalled();
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'edit' });
  });

  it('a search that reopens the task being edited, in reading mode, asks first', async () => {
    await dirty();
    act(() => api.dispatch({ type: 'open-todo', key: 'a.md', mode: 'read' }));
    expect(asked()).toBe(true);
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'edit' });
    expect(screen.getByLabelText('Title')).toHaveProperty('value', 'Changed');
  });

  it('Cancel asks first when dirty (it is held like any other way out)', async () => {
    await dirty();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(asked()).toBe(true);
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'edit' });
  });

  it('Esc pressed inside the details editor asks when dirty, and closes when clean', async () => {
    await dirty();
    fireEvent.keyDown(screen.getByLabelText('Details'), { key: 'Escape' });
    expect(asked()).toBe(true);
    expect(api.state.todoPanel?.key).toBe('a.md');
    cleanup();
    mount();
    await open('First');
    edit();
    fireEvent.keyDown(screen.getByLabelText('Details'), { key: 'Escape' });
    expect(api.state.todoPanel).toBeNull();
  });

  it('Esc and Cancel in the Add form ask once a title is typed, and close when it is empty', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    let form = await screen.findByRole('form', { name: 'Add a task' });
    fireEvent.change(within(form).getByLabelText('What needs doing?'), { target: { value: 'Half typed' } });
    fireEvent.keyDown(within(form).getByLabelText('What needs doing?'), { key: 'Escape' });
    expect(asked()).toBe(true);
    expect(api.state.todoPanel?.mode).toBe('add');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    fireEvent.change(within(form).getByLabelText('What needs doing?'), { target: { value: '' } });
    // Handled (default prevented), so the shell's own Esc doesn't also close the drawer.
    expect(fireEvent.keyDown(within(form).getByLabelText('What needs doing?'), { key: 'Escape' })).toBe(
      false,
    );
    expect(api.state.todoPanel).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    form = await screen.findByRole('form', { name: 'Add a task' });
    fireEvent.change(within(form).getByLabelText('What needs doing?'), { target: { value: 'Again' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(asked()).toBe(true);
  });

  it('a new page closes the panel, and asks first when it holds unsaved changes', async () => {
    // A fresh element each time: the same one would let React skip the render.
    const tree = () => (
      <ShellProvider>
        <Probe />
        <TodosDrawer />
      </ShellProvider>
    );
    const r = render(tree());
    act(() => api.dispatch({ type: 'open-drawer', drawer: 'todos' }));
    await open('First');
    store.current = { ...store.current, view: 'settings' };
    r.rerender(tree());
    expect(api.state.todoPanel).toBeNull();

    await open('First');
    edit();
    type('Title', 'Changed');
    store.current = { ...store.current, view: 'home' };
    r.rerender(tree());
    expect(asked()).toBe(true);
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'edit' });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(api.state.todoPanel).toBeNull();
  });
});

describe('the panel itself', () => {
  it('covers the drawer when it floats: the layer says so, for the stylesheet to lift it', async () => {
    window.innerWidth = 700;
    mount();
    await open('First');
    expect(document.querySelector('.todo-layer')?.getAttribute('data-overlay')).toBe('true');
  });

  it('has one status region for every view', async () => {
    mount();
    await open('First');
    const panel = screen.getByRole('dialog');
    expect(within(panel).getAllByRole('status')).toHaveLength(1);
    edit();
    expect(within(panel).getAllByRole('status')).toHaveLength(1);
  });

  it('Save is aria-disabled, not disabled, when it cannot save, so the keyboard stays put', async () => {
    mount();
    await open('First');
    edit();
    type('Title', '');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(save.hasAttribute('disabled')).toBe(false);
    // It says why.
    const why = screen.getByText('Add a title to save.');
    expect(save.getAttribute('aria-describedby')).toBe(why.id);
    fireEvent.click(save);
    expect(changeTodos).not.toHaveBeenCalled();
    type('Title', 'Back');
    expect(screen.queryByText('Add a title to save.')).toBeNull();
  });
});

const asked = (id: string, title: string, over: Partial<AskedTodo> = {}): AskedTodo => ({
  key: `asked:todo/${id}`,
  id,
  state: 'waiting',
  path: `todo/${id}`,
  title,
  assignee: 'ben-mcadam',
  assigneeName: 'Ben McAdam',
  due: null,
  details: 'Their notes',
  asked: { slug: 'sam-example', name: 'Sam Example', at: '2026-11-13T12:00:00+00:00', source: 'stamp' },
  done: null,
  version: 'v1',
  attachments: [],
  ...over,
});

describe('asked of others', () => {
  const list = (): AskedTodoList => ({
    waiting: [asked('x.md', 'Send the quote'), asked('y.md', 'Book the venue', { due: '2999-01-01' })],
    done: [
      asked('z.md', 'Old job', {
        key: 'asked:todo/done/z.md',
        state: 'done',
        done: { slug: 'ben-mcadam', name: 'Ben McAdam', at: '2026-11-14T12:00:00+00:00', source: 'history' },
      }),
    ],
    historyRead: true,
  });
  const openAsked = async () => {
    store.current = { ...store.current, asked: list() };
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: 'Asked, 2' }));
    return screen.getByRole('button', { name: 'Send the quote' });
  };

  beforeEach(() => {
    apiMock.todoHistory.mockReset();
  });

  it('labels the tabs with counts and opens an asked row read only, with no actions', async () => {
    fireEvent.click(await openAsked());
    const panel = await dialog();
    expect(api.state.todoPanel).toMatchObject({ key: 'asked:todo/x.md', mode: 'read' });
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe('Send the quote');
    expect(within(panel).getByLabelText('Details').textContent).toContain('Their notes');
    expect(within(panel).getByText(/^With Ben McAdam since \d+ Nov$/)).toBeTruthy();
    for (const name of ['Edit', 'Delete', 'Mark as done', 'Start a chat', 'Save']) {
      expect(within(panel).queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: /^Tick/ })).toBeNull();
  });

  it('the E key does nothing for an asked task', async () => {
    fireEvent.click(await openAsked());
    await dialog();
    press('e');
    expect(api.state.todoPanel?.mode).toBe('read');
  });

  it('previous and next walk the asked order (waiting, then done)', async () => {
    fireEvent.click(await openAsked());
    await dialog();
    expect(api.state.todoPanel?.order).toEqual([
      'asked:todo/x.md',
      'asked:todo/y.md',
      'asked:todo/done/z.md',
    ]);
    press('n');
    expect(heading()).toBe('Book the venue');
    press('n');
    expect(heading()).toBe('Old job');
    expect(screen.getByText(/^Done by Ben McAdam, \d+ Nov \(git history\)$/)).toBeTruthy();
    press('p');
    expect(heading()).toBe('Book the venue');
  });

  it('loads History only when its fold is opened, for any task', async () => {
    apiMock.todoHistory.mockResolvedValue({ status: 'ok', events: [], more: false });
    mount();
    await open('First');
    expect(apiMock.todoHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => expect(apiMock.todoHistory).toHaveBeenCalledWith('a.md'));
  });

  it('says in the footer why a waiting or done asked task cannot be changed', async () => {
    fireEvent.click(await openAsked());
    const panel = await dialog();
    expect(
      within(panel).getByText("This is Ben's task now, so you can read it but not change it."),
    ).toBeTruthy();
    press('n');
    press('n');
    expect(heading()).toBe('Old job');
    expect(
      within(screen.getByRole('dialog')).getByText("Ben ticked this off, so it can't be changed here."),
    ).toBeTruthy();
  });

  it('opens the closed Done fold when next moves the panel into it, so closing returns to the row', async () => {
    fireEvent.click(await openAsked());
    await dialog();
    const fold = () => screen.getByRole('button', { name: /Done in the last 60 days/ });
    expect(fold().getAttribute('aria-expanded')).toBe('false');
    press('n');
    press('n');
    expect(fold().getAttribute('aria-expanded')).toBe('true');
    press('Escape');
    await waitFor(() => expect(document.activeElement).toBe(titleButton('Old job')));
  });

  it('keeps the rows shown, with a retry line, when a reload failed, and Try again asks the store', async () => {
    const reloadAsked = vi.fn();
    store.current = { ...store.current, asked: list(), askedState: 'failed', reloadAsked };
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: 'Asked, 2' }));
    const line = await screen.findByText(/Couldn't refresh this list/);
    expect(line.getAttribute('role')).toBe('status');
    expect(screen.getByRole('button', { name: 'Send the quote' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reloadAsked).toHaveBeenCalledTimes(1);
  });

  it('shows the loading state while the store has no list yet', async () => {
    store.current = { ...store.current, asked: null, askedState: 'loading' };
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: /^Asked/ }));
    await screen.findByText('Loading…');
  });

  it('closes History and fetches afresh for the next task', async () => {
    apiMock.todoHistory.mockResolvedValue({ status: 'ok', events: [], more: false });
    fireEvent.click(await openAsked());
    await dialog();
    const history = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'History' });
    fireEvent.click(history());
    await waitFor(() => expect(apiMock.todoHistory).toHaveBeenCalledWith('asked:todo/x.md'));
    expect(history().getAttribute('aria-expanded')).toBe('true');
    press('n');
    expect(history().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(history());
    await waitFor(() => expect(apiMock.todoHistory).toHaveBeenCalledWith('asked:todo/y.md'));
    expect(apiMock.todoHistory).toHaveBeenCalledTimes(2);
  });

  it('has no History for a personal task', async () => {
    setStore('on', [todo('p.md', 'Mine only', { scope: 'personal', key: 'personal/p.md' })]);
    mount();
    const panel = await open('Mine only');
    expect(within(panel).queryByRole('button', { name: 'History' })).toBeNull();
  });
});

describe('projects in the panel', () => {
  const withProjects = (mine: TodoItem[]) => {
    setStore('on', mine);
    const s = store.current as { todos: TodoList };
    store.current = { ...s, todos: { ...s.todos, canProject: true, canUsePersonal: true } };
  };
  const privateTodo = () =>
    todo('p.md', 'Diary job', {
      scope: 'personal',
      key: 'personal/p.md',
      project: 'personal/diary',
      projectMatch: { how: 'key', key: 'personal/diary' },
    });

  it('asks before moving a task out of a private project, then sends dropProject', async () => {
    withProjects([privateTodo()]);
    mount();
    await open('Diary job');
    edit();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'TDS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        "This task is in your private project 'diary'. Moving it to the team removes it from that project.",
      ),
    ).toBeTruthy();
    expect(changeTodos).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Move to the team' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(1));
    expect(changeTodos).toHaveBeenCalledWith([
      { kind: 'move', id: 'p.md', scope: 'personal', to: 'tds', dropProject: true, expect: 'v1' },
    ]);
  });

  it('Cancel on the question keeps the editor and sends nothing', async () => {
    withProjects([privateTodo()]);
    mount();
    await open('Diary job');
    edit();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'TDS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/private project/);
    const question = screen.getByText(/private project/).closest('fieldset') as HTMLElement;
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/private project/)).toBeNull();
    expect(changeTodos).not.toHaveBeenCalled();
    // The move is undone, and the keyboard is back on Save.
    expect(
      within(screen.getByRole('dialog'))
        .getByRole('radio', { name: 'Personal' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
  });

  it('switching to the team and back keeps the private project, so nothing is saved', async () => {
    withProjects([privateTodo()]);
    mount();
    await open('Diary job');
    edit();
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('radio', { name: 'TDS' }));
    fireEvent.click(dialog.getByRole('radio', { name: 'Personal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByText(/private project/)).toBeNull();
    expect(changeTodos).not.toHaveBeenCalled();
  });

  it('shows no Project field when the server cannot save one', async () => {
    setStore('on', [todo('a.md', 'First')]);
    mount();
    await open('First');
    edit();
    expect(screen.queryByLabelText('Project')).toBeNull();
  });
});

// Updates, hand back and a note with a pass-on (plan 2026-11-27-task-updates-handback, decision 12).
describe('updates and hand back', () => {
  const UPDATES = '## Updates\n\n- 27 Nov 2026, 14:05 UK: Ben McAdam (ben-mcadam) wrote: Sent the quote.';
  const handover = (over: Partial<NonNullable<TodoItem['handover']>> = {}) => ({
    by: 'ben-mcadam',
    byName: 'Ben McAdam',
    at: '2026-11-13T12:00:00+00:00',
    from: null,
    via: null,
    source: 'stamp' as const,
    ...over,
  });
  /** The same store, with updates (and files) switched on in the task list. */
  const withUpdates = (mine: TodoItem[], over: Partial<TodoList> = {}) => {
    setStore('on', mine);
    const s = store.current as { todos: TodoList };
    s.todos = { ...s.todos, canUpdate: true, canLink: true, canAttach: true, ...over };
  };
  const note = {
    kind: 'note' as const,
    at: '2026-11-27T14:05:00+00:00',
    by: 'ben-mcadam',
    byName: 'Ben McAdam',
    text: 'Sent the quote.',
    via: null,
    action: 'update' as const,
  };

  it('shows the Updates block and takes the section out of the details', async () => {
    withUpdates([todo('a.md', 'First', { details: `Some notes\n\n${UPDATES}`, updates: [note] })]);
    mount();
    const panel = await open('First');
    expect(within(panel).getByLabelText('Details').textContent).toBe('Some notes');
    expect(within(panel).getByRole('heading', { name: 'Updates' })).toBeTruthy();
    expect(within(panel).getByText('Sent the quote.')).toBeTruthy();
  });

  it('keeps the Files section when someone who can edit but not attach ticks a box', async () => {
    const details = '- [ ] one\n\n## Files\n\n- [Quote](https://example.com/q)';
    withUpdates(
      [todo('a.md', 'First', { details, links: [{ url: 'https://example.com/q', name: 'Quote' }] })],
      { canAttach: false },
    );
    mount();
    await open('First');
    fireEvent.click(screen.getByRole('button', { name: 'Tick 1' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(1));
    const sent = ((changeTodos.mock.calls[0]?.[0] ?? []) as { details: string }[])[0];
    expect(sent?.details).toContain('## Files');
    expect(sent?.details).toContain('https://example.com/q');
  });

  it('shows no Updates block, no box and no Hand back when updates are off', async () => {
    setStore('on', [todo('a.md', 'First', { createdBy: 'ben-mcadam' })]);
    mount();
    const panel = await open('First');
    expect(within(panel).queryByRole('heading', { name: 'Updates' })).toBeNull();
    expect(within(panel).queryByLabelText('Add an update')).toBeNull();
    expect(within(panel).queryByRole('button', { name: /Hand back/ })).toBeNull();
  });

  it('adds an update to the task', async () => {
    withUpdates([todo('a.md', 'First')]);
    mount();
    await open('First');
    fireEvent.change(screen.getByLabelText('Add an update'), { target: { value: 'Rang the client.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add an update' }));
    await waitFor(() =>
      expect(changeTodos).toHaveBeenCalledWith([{ kind: 'update', id: 'a.md', text: 'Rang the client.' }]),
    );
    expect(await screen.findByText('Update added.')).toBeTruthy();
  });

  it('says why when an update was not added, and keeps the text', async () => {
    withUpdates([todo('a.md', 'First')]);
    changeTodos.mockResolvedValue({ done: 0, error: { code: 'internal', message: 'Nope.' } });
    mount();
    await open('First');
    fireEvent.change(screen.getByLabelText('Add an update'), { target: { value: 'Keep this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add an update' }));
    expect(await screen.findByText("Your update wasn't added. Nope.")).toBeTruthy();
    expect((screen.getByLabelText('Add an update') as HTMLTextAreaElement).value).toBe('Keep this');
  });

  it('"Add an update and mark as done" holds one tick that carries the update', async () => {
    withUpdates([todo('a.md', 'First')]);
    mount();
    await open('First');
    fireEvent.change(screen.getByLabelText('Add an update'), { target: { value: 'Finished it.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add an update and mark as done' }));
    expect(holdTodo).toHaveBeenCalledWith(
      expect.objectContaining({ todoId: 'a.md', kind: 'tick', note: 'Finished it.' }),
    );
    expect(changeTodos).not.toHaveBeenCalled();
  });

  it('asks before closing with an update typed and not sent', async () => {
    withUpdates([todo('a.md', 'First')]);
    mount();
    await open('First');
    fireEvent.change(screen.getByLabelText('Add an update'), { target: { value: 'Half a thought' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
  });

  it('keeps an update typed when switching to editing and back', async () => {
    withUpdates([todo('a.md', 'First')]);
    mount();
    await open('First');
    fireEvent.change(screen.getByLabelText('Add an update'), { target: { value: 'Still here' } });
    edit();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByLabelText('Add an update') as HTMLTextAreaElement).value).toBe('Still here');
  });

  describe('Hand back', () => {
    it('hands the task back to who passed it on, with the note, held with an Undo', async () => {
      withUpdates([todo('a.md', 'First', { handover: handover() })]);
      mount();
      await open('First');
      fireEvent.click(screen.getByRole('button', { name: 'Hand back to Ben' }));
      fireEvent.change(screen.getByLabelText('Note for Ben (optional)'), {
        target: { value: 'Over to you for the signing.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Hand back' }));
      expect(holdTodo).toHaveBeenCalledWith(
        expect.objectContaining({
          todoId: 'a.md',
          kind: 'assignee',
          label: 'Handed back to Ben McAdam',
          action: {
            kind: 'assignee',
            id: 'a.md',
            assignee: 'ben-mcadam',
            back: true,
            expect: 'v1',
            note: 'Over to you for the signing.',
          },
        }),
      );
    });

    it('sends no note when none was typed, and falls back to who added the task', async () => {
      withUpdates([todo('a.md', 'First', { createdBy: 'ben-mcadam' })]);
      mount();
      await open('First');
      fireEvent.click(screen.getByRole('button', { name: 'Hand back to Ben' }));
      fireEvent.click(screen.getByRole('button', { name: 'Hand back' }));
      expect(holdTodo).toHaveBeenCalledWith(
        expect.objectContaining({
          action: { kind: 'assignee', id: 'a.md', assignee: 'ben-mcadam', back: true, expect: 'v1' },
        }),
      );
    });

    it('Cancel closes the form and puts the keyboard back on the button', async () => {
      withUpdates([todo('a.md', 'First', { createdBy: 'ben-mcadam' })]);
      mount();
      await open('First');
      fireEvent.click(screen.getByRole('button', { name: 'Hand back to Ben' }));
      const form = screen.getByRole('form', { name: 'Hand back to Ben' });
      fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('form', { name: 'Hand back to Ben' })).toBeNull();
      expect(holdTodo).not.toHaveBeenCalled();
    });

    it('is not offered when nobody passed the task on, or it was added by you', async () => {
      withUpdates([todo('a.md', 'First'), todo('b.md', 'Second', { createdBy: 'sam-example' })]);
      mount();
      await open('First');
      expect(screen.queryByRole('button', { name: /Hand back/ })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
      await open('Second');
      expect(screen.queryByRole('button', { name: /Hand back/ })).toBeNull();
    });

    it('is not offered on a task that was itself handed back to you', async () => {
      withUpdates([todo('a.md', 'First', { handover: handover({ back: true }) })]);
      mount();
      await open('First');
      expect(screen.queryByRole('button', { name: /Hand back/ })).toBeNull();
    });
  });

  // Typed text and the foot's buttons (Ian's UX gate, 2026-11-27): nothing typed is thrown away without a word.
  describe('typed text and the foot buttons', () => {
    /** A held change goes into the store the drawer reads, as the real one does; Undo takes it out again. */
    const heldIntoStore = () => {
      const s = store.current as { heldTodos: HeldTodo[] };
      holdTodo.mockImplementation((h: HeldTodo) => {
        s.heldTodos = [...s.heldTodos, h];
      });
      undoHeld.mockImplementation((id: string) => {
        s.heldTodos = s.heldTodos.filter((h) => h.todoId !== id);
      });
    };
    const typeUpdate = (value: string) =>
      fireEvent.change(screen.getByLabelText('Add an update'), { target: { value } });

    it('Mark as done with an update typed sends the text as the tick note', async () => {
      withUpdates([todo('a.md', 'First')]);
      mount();
      await open('First');
      typeUpdate('Finished it.');
      fireEvent.click(screen.getByRole('button', { name: 'Mark as done' }));
      expect(holdTodo).toHaveBeenCalledWith(
        expect.objectContaining({ todoId: 'a.md', kind: 'tick', note: 'Finished it.' }),
      );
    });

    it('Hand back opens its note form with the typed update, and the update stays until it is sent', async () => {
      withUpdates([todo('a.md', 'First', { handover: handover() })]);
      heldIntoStore();
      const view = mount();
      await open('First');
      typeUpdate('Over to you.');
      fireEvent.click(screen.getByRole('button', { name: 'Hand back to Ben' }));
      const noteBox = screen.getByLabelText('Note for Ben (optional)') as HTMLTextAreaElement;
      expect(noteBox.value).toBe('Over to you.');
      // Edited before sending.
      fireEvent.change(noteBox, { target: { value: 'Over to you, Ben.' } });
      fireEvent.click(screen.getByRole('button', { name: 'Hand back' }));
      expect(holdTodo).toHaveBeenCalledWith(
        expect.objectContaining({ action: expect.objectContaining({ note: 'Over to you, Ben.' }) }),
      );
      // Still held, so the update text is still kept: nothing has really been sent.
      expect(api.state.todoPanel).toBeNull();
      // The held change goes (sent): the text goes with it.
      (store.current as { heldTodos: HeldTodo[] }).heldTodos = [];
      reload(view);
      await open('First');
      expect((screen.getByLabelText('Add an update') as HTMLTextAreaElement).value).toBe('');
      expect(screen.queryByLabelText('Note for Ben (optional)')).toBeNull();
    });

    // Review round 2: a refused hand back ("Open it to see the latest, then try again") lost the note.
    it('keeps the typed note when the held hand back fails, so trying again needs no retyping', async () => {
      withUpdates([todo('a.md', 'First', { handover: handover() })]);
      heldIntoStore();
      const view = mount();
      await open('First');
      typeUpdate('Over to you.');
      fireEvent.click(screen.getByRole('button', { name: 'Hand back to Ben' }));
      fireEvent.click(screen.getByRole('button', { name: 'Hand back' }));
      const held = holdTodo.mock.calls[0]?.[0] as HeldTodo;
      // The send failed: the change leaves the held list and the store names the task.
      Object.assign(store.current as object, { heldTodos: [], failedHeld: [held.todoId] });
      reload(view);
      await open('First');
      expect((screen.getByLabelText('Note for Ben (optional)') as HTMLTextAreaElement).value).toBe(
        'Over to you.',
      );
    });

    it('Delete with text typed asks "Discard your changes?" first and holds nothing', async () => {
      withUpdates([todo('a.md', 'First')]);
      mount();
      await open('First');
      typeUpdate('Not sent yet');
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(screen.getByText('Discard your changes?')).toBeTruthy();
      expect(holdTodo).not.toHaveBeenCalled();
    });

    it('Delete with text typed, then "Discard changes", deletes the task with its usual Undo', async () => {
      withUpdates([todo('a.md', 'First')]);
      mount();
      await open('First');
      typeUpdate('Not sent yet');
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(holdTodo).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
      expect(holdTodo).toHaveBeenCalledTimes(1);
      expect(holdTodo.mock.calls[0]?.[0]).toMatchObject({ todoId: 'a.md', kind: 'delete', label: 'Deleted' });
      expect(api.state.todoPanel).toBeNull();
    });

    it('"Keep editing" after Delete with text typed deletes nothing, and a later discard does not either', async () => {
      withUpdates([todo('a.md', 'First')]);
      mount();
      await open('First');
      typeUpdate('Not sent yet');
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      // Closing the panel by another way asks again, and discarding that only closes.
      fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
      expect(holdTodo).not.toHaveBeenCalled();
      expect(api.state.todoPanel).toBeNull();
    });

    it('Undo after "Add an update and mark as done" brings the text back into the update box', async () => {
      withUpdates([todo('a.md', 'First')]);
      heldIntoStore();
      const view = mount();
      await open('First');
      typeUpdate('Finished it.');
      fireEvent.click(screen.getByRole('button', { name: 'Add an update and mark as done' }));
      expect(holdTodo).toHaveBeenCalled();
      fireEvent.click(await screen.findByRole('button', { name: /Undo/ }));
      reload(view);
      await open('First');
      expect((screen.getByLabelText('Add an update') as HTMLTextAreaElement).value).toBe('Finished it.');
    });

    it('Undo after a hand back with a note brings the note back into the form', async () => {
      withUpdates([todo('a.md', 'First', { handover: handover() })]);
      heldIntoStore();
      const view = mount();
      await open('First');
      fireEvent.click(screen.getByRole('button', { name: 'Hand back to Ben' }));
      fireEvent.change(screen.getByLabelText('Note for Ben (optional)'), { target: { value: 'Ta.' } });
      fireEvent.click(screen.getByRole('button', { name: 'Hand back' }));
      fireEvent.click(await screen.findByRole('button', { name: /Undo/ }));
      reload(view);
      await open('First');
      expect((screen.getByLabelText('Note for Ben (optional)') as HTMLTextAreaElement).value).toBe('Ta.');
    });

    // Browser check: a note kept from an earlier try went out in place of what was typed afterwards.
    it('keeps one text for the update box and the hand back note, so the last words typed are the ones sent', async () => {
      withUpdates([todo('a.md', 'First', { handover: handover() })]);
      mount();
      await open('First');
      typeUpdate('First thoughts.');
      const button = screen.getByRole('button', { name: 'Hand back to Ben' });
      fireEvent.click(button);
      // The form stands in for the update box while it is open.
      expect(screen.queryByLabelText('Add an update')).toBeNull();
      fireEvent.click(
        within(screen.getByRole('form', { name: 'Hand back to Ben' })).getByRole('button', {
          name: 'Cancel',
        }),
      );
      expect((screen.getByLabelText('Add an update') as HTMLTextAreaElement).value).toBe('First thoughts.');
      typeUpdate('All checked. Back to you.');
      fireEvent.click(button);
      expect((screen.getByLabelText('Note for Ben (optional)') as HTMLTextAreaElement).value).toBe(
        'All checked. Back to you.',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Hand back' }));
      expect(holdTodo).toHaveBeenCalledWith(
        expect.objectContaining({ action: expect.objectContaining({ note: 'All checked. Back to you.' }) }),
      );
    });

    it('a hand back note survives Cancel and pressing the button again, and closing asks first', async () => {
      withUpdates([todo('a.md', 'First', { handover: handover() })]);
      mount();
      await open('First');
      const button = screen.getByRole('button', { name: 'Hand back to Ben' });
      fireEvent.click(button);
      fireEvent.change(screen.getByLabelText('Note for Ben (optional)'), { target: { value: 'Keep me' } });
      fireEvent.click(
        within(screen.getByRole('form', { name: 'Hand back to Ben' })).getByRole('button', {
          name: 'Cancel',
        }),
      );
      expect(screen.queryByRole('form', { name: 'Hand back to Ben' })).toBeNull();
      fireEvent.click(button);
      expect((screen.getByLabelText('Note for Ben (optional)') as HTMLTextAreaElement).value).toBe('Keep me');
      // Closed again by pressing the button: still kept, and the panel asks before closing.
      fireEvent.click(button);
      expect(screen.queryByRole('form', { name: 'Hand back to Ben' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
      expect(screen.getByText('Discard your changes?')).toBeTruthy();
    });
  });

  describe('a note with a pass-on', () => {
    const passOn = async () => {
      await open('First');
      edit();
      fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: 'ben-mcadam' } });
    };

    it('sends the note on the assignee action', async () => {
      withUpdates([todo('a.md', 'First')]);
      mount();
      await passOn();
      fireEvent.change(screen.getByLabelText('Note for Ben (optional)'), {
        target: { value: 'Quote is in Drive.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(holdTodo).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'assignee',
          action: expect.objectContaining({
            kind: 'assignee',
            assignee: 'ben-mcadam',
            note: 'Quote is in Drive.',
          }),
        }),
      );
    });

    it('sends no note field when it is left empty', async () => {
      withUpdates([todo('a.md', 'First')]);
      mount();
      await passOn();
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      const held = holdTodo.mock.calls[0]?.[0] as HeldTodo;
      expect(held.action).not.toHaveProperty('note');
    });

    it('offers no note field when updates are off, or when it is not being passed on', async () => {
      setStore('on', [todo('a.md', 'First')]);
      mount();
      await passOn();
      expect(screen.queryByLabelText(/^Note for/)).toBeNull();
    });

    it('offers it only for a person, not for open to anyone', async () => {
      withUpdates([todo('a.md', 'First')], { canAddOpen: true });
      mount();
      await open('First');
      edit();
      expect(screen.queryByLabelText(/^Note for/)).toBeNull();
      fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: '' } });
      expect(screen.queryByLabelText(/^Note for/)).toBeNull();
    });
  });

  it('saves the details without the Updates section', async () => {
    withUpdates([todo('a.md', 'First', { details: `Some notes\n\n${UPDATES}`, updates: [note] })]);
    mount();
    await open('First');
    edit();
    fireEvent.change(screen.getByRole('textbox', { name: 'Details' }), {
      target: { value: 'Changed notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos).toHaveBeenCalledWith([
      { kind: 'edit', id: 'a.md', title: 'First', details: 'Changed notes', detailsOnly: true, expect: 'v1' },
    ]);
  });

  it('says a personal task takes its updates and links to the team when it moves', async () => {
    withUpdates(
      [todo('p.md', 'Mine', { scope: 'personal', key: 'personal/p.md', assignee: 'sam-example' })],
      {
        canUsePersonal: true,
      },
    );
    mount();
    await open('Mine');
    edit();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: 'TDS' }));
    expect(screen.getByText('Its updates and links go with it, and the team can read them.')).toBeTruthy();
  });
});

describe('updates on a task you passed on', () => {
  const askedList = (over: Partial<AskedTodo> = {}): AskedTodoList => ({
    waiting: [asked('x.md', 'Send the quote', over)],
    done: [],
    historyRead: true,
  });
  const openAsked = async (over: Partial<AskedTodo> = {}) => {
    store.current = { ...store.current, asked: askedList(over) };
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: /^Asked, 1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send the quote' }));
    return dialog();
  };
  beforeEach(() => {
    apiMock.todoHistory.mockReset();
  });

  it('lets the asker add an update, and says they cannot change anything else', async () => {
    const panel = await openAsked({ canUpdate: true });
    expect(within(panel).getByText(/you can't change it, but you can add an update/)).toBeTruthy();
    fireEvent.change(within(panel).getByLabelText('Add an update'), {
      target: { value: 'Please use the 2025 rates.' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add an update' }));
    await waitFor(() =>
      expect(changeTodos).toHaveBeenCalledWith([
        { kind: 'update', id: 'x.md', text: 'Please use the 2025 rates.' },
      ]),
    );
    // Nothing else is offered: no mark as done in the box, no hand back, no edit.
    for (const name of ['Add an update and mark as done', 'Edit', 'Delete', 'Mark as done']) {
      expect(within(panel).queryByRole('button', { name })).toBeNull();
    }
  });

  it('shows the updates read only, with no box, when the asker cannot add one', async () => {
    const panel = await openAsked({
      updates: [
        {
          kind: 'note',
          at: '2026-11-27T14:05:00+00:00',
          by: 'ben-mcadam',
          byName: 'Ben McAdam',
          text: 'On it.',
          via: null,
          action: 'update',
        },
      ],
    });
    expect(within(panel).getByText('On it.')).toBeTruthy();
    expect(within(panel).queryByLabelText('Add an update')).toBeNull();
    expect(within(panel).getByText(/so you can read it but not change it/)).toBeTruthy();
  });
});

// Task change notices (plan 2026-11-27-task-change-notices): the Updated folds, the Asked tab's dot, the looked marks
// and the "New" tags in the panel.
describe('task change notices', () => {
  /** An ISO time to the minute, `min` minutes ago. */
  const ago = (min: number): string =>
    `${new Date(Date.now() - min * 60_000).toISOString().slice(0, 16)}:00+00:00`;
  const entry = (text: string, min: number, over: Partial<TodoUpdate> = {}): TodoUpdate => ({
    kind: 'note',
    at: ago(min),
    by: 'ben-mcadam',
    byName: 'Ben McAdam',
    text,
    via: null,
    action: 'update',
    ...over,
  });
  const markLooked = vi.fn();
  /** The store with the markers the person has saved (`prefs.todoLooked`) and the call that writes new ones. */
  const withNotices = (mine: TodoItem[], looked: TodoLooked = {}, askedList: AskedTodoList | null = null) => {
    setStore('on', mine);
    const s = store.current as { boot: { prefs: Record<string, unknown> }; todos: TodoList };
    s.boot = { ...s.boot, prefs: { ...s.boot.prefs, todoLooked: looked, todoSeen: {} } };
    s.todos = { ...s.todos, canUpdate: true };
    store.current = { ...store.current, markTodosLooked: markLooked, asked: askedList };
  };
  /** Saves a marker for the task as the store would, then hands the drawer the new prefs. */
  const writeMarker = (view: ReturnType<typeof mount>, t: TodoItem) => {
    const s = store.current as { boot: { prefs: { todoLooked: TodoLooked } } };
    s.boot = {
      ...s.boot,
      prefs: {
        ...s.boot.prefs,
        todoLooked: {
          ...s.boot.prefs.todoLooked,
          [t.id]: lookedMark({ kind: 'held', todo: t }, { slug: 'sam-example', name: '' }, new Date()),
        },
      },
    };
    reload(view);
  };
  const me = { slug: 'sam-example', name: '' };
  const rowOf = (title: string) => titleButton(title).closest('li') as HTMLElement;
  const foldHeads = () => [...document.querySelectorAll('.fold-title')].map((e) => e.textContent);
  const askedTask = (id: string, title: string, over: Partial<AskedTodo> = {}) =>
    asked(id, title, { updates: [entry('On it.', 20)], ...over });

  beforeEach(() => markLooked.mockReset());

  describe('the Updated fold on Mine', () => {
    const two = () => [
      todo('a.md', 'First', { updates: [entry('Older note.', 30)] }),
      todo('b.md', 'Second', { updates: [entry('Newer note.', 5), entry('Another.', 8)] }),
      todo('c.md', 'Third'),
    ];

    it('lists the changed tasks under "New to you", newest change first, each with its line, and not again below', () => {
      withNotices(two());
      mount();
      expect(foldHeads()[0]).toBe('Updated');
      const updated = [...document.querySelectorAll('.fold')].find(
        (f) => f.querySelector('.fold-title')?.textContent === 'Updated',
      ) as HTMLElement;
      expect(within(updated).getByRole('heading', { name: /Updated/ }).textContent).toContain('2');
      const titles = within(updated)
        .getAllByRole('button', { name: /^(First|Second)$/ })
        .map((b) => b.textContent);
      expect(titles).toEqual(['Second', 'First']);
      expect(within(rowOf('Second')).getByText(/^Ben added an update · .+ and 1 more$/)).toBeTruthy();
      const single = within(rowOf('First')).getByText(/^Ben added an update · .+$/);
      expect(single.textContent).not.toContain('more');
      // Not repeated in the groups below.
      expect(screen.getAllByRole('button', { name: 'First' })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Third', hidden: true })).toHaveLength(1);
    });

    it('gives each row the dot a new row has, and says "Updated." to a screen reader', () => {
      withNotices(two());
      mount();
      const row = rowOf('First');
      expect(row.querySelector('.todo-new')).toBeTruthy();
      expect(within(row).getByText('Updated.').className).toContain('visually-hidden');
      expect(
        screen.getByRole('button', { name: 'Third', hidden: true }).closest('li')?.querySelector('.todo-new'),
      ).toBeNull();
    });

    it('has no Updated fold when nothing changed', () => {
      withNotices(three());
      mount();
      expect(foldHeads()).not.toContain('Updated');
    });

    it('"Mark all as seen" on Updated marks those tasks looked at, and says so', () => {
      const mine = two();
      withNotices(mine);
      mount();
      const updated = [...document.querySelectorAll('.fold')].find(
        (f) => f.querySelector('.fold-title')?.textContent === 'Updated',
      ) as HTMLElement;
      fireEvent.click(within(updated).getByRole('button', { name: 'Mark all as seen' }));
      expect(markLooked).toHaveBeenCalledTimes(1);
      expect(markLooked.mock.calls[0]?.[0]).toEqual([
        { kind: 'held', todo: mine[1] },
        { kind: 'held', todo: mine[0] },
      ]);
      expect(screen.getByText('Marked as seen.')).toBeTruthy();
    });

    it('"Mark all as seen" on New to you marks the tasks looked at too, so a new task with a note does not jump to Updated', () => {
      const fresh = todo('n.md', 'Newly passed', {
        handover: {
          by: 'ben-mcadam',
          byName: 'Ben McAdam',
          at: ago(60),
          from: null,
          via: null,
          source: 'stamp',
        },
        updates: [entry('Here is the background.', 30)],
      });
      withNotices([fresh]);
      mount();
      // New to you, not Updated.
      expect(foldHeads()).toContain('New to you');
      expect(foldHeads()).not.toContain('Updated');
      const fold = [...document.querySelectorAll('.fold')].find(
        (f) => f.querySelector('.fold-title')?.textContent === 'New to you',
      ) as HTMLElement;
      fireEvent.click(within(fold).getByRole('button', { name: 'Mark all as seen' }));
      expect(markLooked).toHaveBeenCalledWith([{ kind: 'held', todo: fresh }]);
    });
  });

  describe('looking at a task', () => {
    it('opening the panel marks the task looked at, and again when its updates change while it is open', async () => {
      const t = todo('a.md', 'First', { updates: [entry('One.', 30)] });
      withNotices([t]);
      const view = mount();
      await open('First');
      expect(markLooked).toHaveBeenCalledTimes(1);
      expect(markLooked).toHaveBeenLastCalledWith([{ kind: 'held', todo: t }]);
      // Nothing changed: no second call.
      reload(view);
      expect(markLooked).toHaveBeenCalledTimes(1);
      const later = { ...t, updates: [...(t.updates ?? []), entry('Two.', 1)] };
      store.current = {
        ...store.current,
        todos: { ...(store.current as { todos: TodoList }).todos, mine: [later] },
      };
      reload(view);
      await waitFor(() => expect(markLooked).toHaveBeenCalledTimes(2));
      expect(markLooked).toHaveBeenLastCalledWith([{ kind: 'held', todo: later }]);
    });

    it('opening an asked task marks it looked at as an asked task', async () => {
      const a = askedTask('x.md', 'Send the quote');
      withNotices([], {}, { waiting: [a], done: [], historyRead: true });
      mount();
      fireEvent.click(await screen.findByRole('radio', { name: /^Asked/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Send the quote' }));
      await dialog();
      expect(markLooked).toHaveBeenCalledWith([{ kind: 'asked', todo: a }]);
    });

    it('a task opened this visit stays in Updated once its marker is written, until the tab changes', async () => {
      const t = todo('a.md', 'First', { updates: [entry('One.', 30)] });
      withNotices([t, todo('c.md', 'Third')]);
      const view = mount();
      // Before it is opened, the row has its dot and its hidden word.
      expect(
        screen.getByRole('button', { name: 'First' }).closest('li')?.querySelector('.todo-new'),
      ).toBeTruthy();
      await open('First');
      writeMarker(view, t);
      press('Escape');
      const updated = [...document.querySelectorAll('.fold')].find(
        (f) => f.querySelector('.fold-title')?.textContent === 'Updated',
      ) as HTMLElement;
      const row = within(updated).getByRole('button', { name: 'First' }).closest('li') as HTMLElement;
      // It has been read, and the rail no longer counts it: the row stays, without the dot or "Updated." (UX gate R2).
      expect(row.querySelector('.todo-new')).toBeNull();
      expect(within(row).queryByText('Updated.')).toBeNull();
      expect(within(row).getByText(/added an update/)).toBeTruthy();
      // The tab changes: it is gone from Updated, as a looked-at task should be.
      fireEvent.click(screen.getByRole('radio', { name: /^Open/ }));
      fireEvent.click(screen.getByRole('radio', { name: /^Mine/ }));
      expect(foldHeads()).not.toContain('Updated');
    });
  });

  describe('the Asked tab', () => {
    const askedLists = (): AskedTodoList => ({
      waiting: [askedTask('x.md', 'Send the quote'), asked('y.md', 'Book the venue')],
      done: [],
      historyRead: true,
    });

    it('labels the tab with a dot and hidden words when a task you asked for has an update', () => {
      withNotices([], {}, askedLists());
      mount();
      const tab = screen.getByRole('radio', { name: /^Asked, 2/ });
      expect(tab.querySelector('.seg-dot')).toBeTruthy();
      expect(within(tab).getByText('with updates', { exact: false }).className).toContain('visually-hidden');
      expect(tab.textContent).toBe('Asked, 2, with updates');
    });

    it('has no dot when nothing has changed', () => {
      withNotices([], {}, { ...askedLists(), waiting: [asked('y.md', 'Book the venue')] });
      mount();
      expect(screen.getByRole('radio', { name: 'Asked, 1' }).querySelector('.seg-dot')).toBeNull();
    });

    it('shows an Updated fold at the top, with the row once, its line and a Mark all as seen', async () => {
      const list = askedLists();
      withNotices([], {}, list);
      mount();
      fireEvent.click(screen.getByRole('radio', { name: /^Asked/ }));
      expect(foldHeads()[0]).toBe('Updated');
      const updated = document.querySelector('.fold') as HTMLElement;
      expect(within(updated).getByText(/^Ben added an update · /)).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Send the quote' })).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Book the venue' })).toBeTruthy();
      fireEvent.click(within(updated).getByRole('button', { name: 'Mark all as seen' }));
      expect(markLooked).toHaveBeenCalledWith([{ kind: 'asked', todo: list.waiting[0] }]);
      expect(screen.getByText('Marked as seen.')).toBeTruthy();
    });

    it('says "Handed back to <name>, <date>" for a task you handed back', async () => {
      withNotices(
        [],
        {},
        {
          waiting: [asked('y.md', 'Book the venue', { handedBack: true })],
          done: [],
          historyRead: true,
        },
      );
      mount();
      fireEvent.click(await screen.findByRole('radio', { name: /^Asked/ }));
      const row = rowOf('Book the venue');
      expect(within(row).getByText(/^Handed back to Ben, \d+ Nov$/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Book the venue' }));
      const panel = await dialog();
      expect(within(panel).getByText(/^Handed back to Ben McAdam, \d+ Nov$/)).toBeTruthy();
    });
  });

  describe('"New" in the task panel', () => {
    const seenOnce = [entry('Old one.', 120)];
    const base = () => todo('a.md', 'First', { updates: [...seenOnce, entry('Fresh one.', 5)] });
    const markerFor = (t: TodoItem): TodoLooked => ({
      [t.id]: lookedMark(
        { kind: 'held', todo: { ...t, updates: seenOnce } },
        me,
        new Date(Date.now() - 60_000),
      ),
    });

    it('tags what the person had not seen and says how many, politely', async () => {
      const t = base();
      withNotices([t], markerFor(t));
      mount();
      const panel = await open('First');
      const line = within(panel).getByText('1 new since you last looked.');
      expect(line.getAttribute('role')).toBe('status');
      expect(line.getAttribute('aria-live')).toBe('polite');
      expect(within(panel).getAllByText('New')).toHaveLength(1);
      const card = within(panel).getByText('Fresh one.').closest('li') as HTMLElement;
      expect(within(card).getByText('New')).toBeTruthy();
    });

    it('says nothing when everything was seen', async () => {
      const t = base();
      withNotices([t], { [t.id]: lookedMark({ kind: 'held', todo: t }, me, new Date()) });
      mount();
      const panel = await open('First');
      expect(within(panel).queryByText(/new since you last looked/)).toBeNull();
      expect(within(panel).queryByText('New')).toBeNull();
    });

    it('keeps the tags while the task stays open, though its marker has been written, and tags what arrives', async () => {
      const t = base();
      withNotices([t], markerFor(t));
      const view = mount();
      const panel = await open('First');
      expect(within(panel).getByText('1 new since you last looked.')).toBeTruthy();
      writeMarker(view, t);
      expect(within(screen.getByRole('dialog')).getByText('1 new since you last looked.')).toBeTruthy();
      const later = { ...t, updates: [...(t.updates ?? []), entry('Arrived while open.', 1)] };
      store.current = {
        ...store.current,
        todos: { ...(store.current as { todos: TodoList }).todos, mine: [later] },
      };
      reload(view);
      const now = screen.getByRole('dialog');
      expect(within(now).getByText('2 new since you last looked.')).toBeTruthy();
      expect(within(now).getAllByText('New')).toHaveLength(2);
    });

    it('works the set out again for the next task, from its own marker', async () => {
      const t = base();
      const quiet = todo('b.md', 'Second', { updates: [entry('Seen.', 50)] });
      withNotices([t, quiet], {
        ...markerFor(t),
        [quiet.id]: lookedMark({ kind: 'held', todo: quiet }, me, new Date()),
      });
      mount();
      await open('First');
      press('n');
      expect(heading()).toBe('Second');
      expect(within(screen.getByRole('dialog')).queryByText(/new since you last looked/)).toBeNull();
    });

    it('tags on an asked task too', async () => {
      const a = askedTask('x.md', 'Send the quote');
      withNotices([], {}, { waiting: [a], done: [], historyRead: true });
      mount();
      fireEvent.click(await screen.findByRole('radio', { name: /^Asked/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Send the quote' }));
      const panel = await dialog();
      expect(within(panel).getByText('1 new since you last looked.')).toBeTruthy();
      expect(within(panel).getByText('New')).toBeTruthy();
    });
  });
});
