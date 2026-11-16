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
import type { HeldTodo } from '../store.tsx';
import type { ShellApi } from './contract.ts';

// The real shell (its reducer, its guard for unsaved changes, its keys) with the real drawer and panel. Only the
// store, the editor and the converter are stand-ins: the editor and converter need a real browser.
const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const apiMock = vi.hoisted(() => ({ askedTodos: vi.fn(), todoHistory: vi.fn() }));
vi.mock('../api.ts', () => ({ api: apiMock }));
vi.mock('../store.tsx', () => ({ useStore: () => store.current, TODO_UNDO_MS: 10_000 }));
vi.mock('./TodoDetailsEditor.tsx', async () => ({
  default: (await import('./todo-test-kit.tsx')).FakeDetailsEditor,
}));
vi.mock('../todo-doc/index.ts', async () => (await import('./todo-test-kit.tsx')).todoDocFake);

const { ShellProvider, useShell } = await import('./ShellProvider.tsx');
const { TodosDrawer } = await import('./TodosDrawer.tsx');

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
const newChat = vi.fn();

function setStore(
  changes: TodoChangeAccess,
  mine: TodoItem[],
  { directWrites = true, held = [] as HeldTodo[] } = {},
) {
  store.current = {
    changeTodos,
    openView: vi.fn(),
    heldTodos: held,
    holdTodo,
    undoHeld: vi.fn(),
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

  it('the Options button opens the same panel for someone who may only tick things off', async () => {
    setStore('restricted', three(), { directWrites: true });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Options for "First"' }));
    await dialog();
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'read' });
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

  it('Cancel goes back to reading without asking, dropping the changes', async () => {
    mount();
    await open('First');
    edit();
    type('Title', 'Nope');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Discard your changes?')).toBeNull();
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'read' });
    expect(changeTodos).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter saves', async () => {
    mount();
    await open('First');
    edit();
    type('Title', 'Quick');
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
  });

  it('the E key edits a to-do being read', async () => {
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

  it('shows the refusal in the usual words and leaves the details as they were', async () => {
    changeTodos.mockResolvedValue({
      done: 0,
      error: { code: 'changed', message: 'Someone else changed this to-do.' },
    });
    mount();
    await open('First');
    fireEvent.click(screen.getByRole('button', { name: 'Tick 2' }));
    expect(await screen.findByText('Someone else changed this to-do.')).toBeTruthy();
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
    const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next to-do' }));
    const prev = () => fireEvent.click(screen.getByRole('button', { name: 'Previous to-do' }));
    next();
    expect(heading()).toBe(titleOf(order[1]));
    press('n');
    expect(heading()).toBe(titleOf(order[2]));
    // At the end, Next does nothing.
    next();
    expect(heading()).toBe(titleOf(order[2]));
    expect(screen.getByRole('button', { name: 'Next to-do' }).getAttribute('aria-disabled')).toBe('true');
    press('p');
    expect(heading()).toBe(titleOf(order[1]));
    prev();
    expect(heading()).toBe(titleOf(order[0]));
  });

  it('skip a to-do waiting out its Undo', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Next to-do' }));
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

  it('ask before closing, before the next to-do, and before a drawer swap; Keep editing drops the question', async () => {
    await dirty();
    expect(api.state.todoPanel?.dirty).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close to-do' }));
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'edit' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Discard your changes?')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next to-do' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Next to-do' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Close to-do' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    const form = await screen.findByRole('form', { name: 'Add a to-do' });
    expect(api.state.todoPanel).toMatchObject({ key: null, mode: 'add' });
    fireEvent.change(within(form).getByLabelText('What needs doing?'), { target: { value: 'Brand new' } });
    expect(api.state.todoPanel?.dirty).toBe(true);
    fireEvent.submit(form);
    await waitFor(() => expect(api.state.todoPanel).toMatchObject({ key: 'n.md', mode: 'edit' }));
    expect(await screen.findByRole('form', { name: 'Edit "Brand new"' })).toBeTruthy();
  });

  it('asks before an add with a title typed is closed', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    const form = await screen.findByRole('form', { name: 'Add a to-do' });
    fireEvent.change(within(form).getByLabelText('What needs doing?'), { target: { value: 'Half typed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close to-do' }));
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
  });
});

describe('another to-do while editing', () => {
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

  it('a search that reopens the to-do being edited, in reading mode, asks first', async () => {
    await dirty();
    act(() => api.dispatch({ type: 'open-todo', key: 'a.md', mode: 'read' }));
    expect(asked()).toBe(true);
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'edit' });
    expect(screen.getByLabelText('Title')).toHaveProperty('value', 'Changed');
  });

  it('Cancel (set-todo-mode) is never held back', async () => {
    await dirty();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(asked()).toBe(false);
    expect(api.state.todoPanel).toMatchObject({ key: 'a.md', mode: 'read' });
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
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    let form = await screen.findByRole('form', { name: 'Add a to-do' });
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
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    form = await screen.findByRole('form', { name: 'Add a to-do' });
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
    fireEvent.click(save);
    expect(changeTodos).not.toHaveBeenCalled();
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
    apiMock.askedTodos.mockResolvedValue(list());
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: 'Asked, 2' }));
    return screen.getByRole('button', { name: 'Send the quote' });
  };

  beforeEach(() => {
    apiMock.askedTodos.mockReset();
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

  it('the E key does nothing for an asked to-do', async () => {
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

  it('loads History only when its fold is opened, for any to-do', async () => {
    apiMock.todoHistory.mockResolvedValue({ status: 'ok', events: [], more: false });
    mount();
    await open('First');
    expect(apiMock.todoHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => expect(apiMock.todoHistory).toHaveBeenCalledWith('a.md'));
  });

  it('says in the footer why a waiting or done asked to-do cannot be changed', async () => {
    fireEvent.click(await openAsked());
    const panel = await dialog();
    expect(
      within(panel).getByText("This is Ben's to-do now, so you can read it but not change it."),
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

  it('asks for the asked list again when the to-dos reload, and ignores an older answer landing late', async () => {
    let late: (l: AskedTodoList) => void = () => {};
    apiMock.askedTodos.mockResolvedValueOnce(list());
    const view = mount();
    fireEvent.click(await screen.findByRole('radio', { name: 'Asked, 2' }));
    expect(apiMock.askedTodos).toHaveBeenCalledTimes(1);
    apiMock.askedTodos.mockReturnValueOnce(new Promise<AskedTodoList>((r) => (late = r)));
    reload(view);
    await waitFor(() => expect(apiMock.askedTodos).toHaveBeenCalledTimes(2));
    apiMock.askedTodos.mockResolvedValueOnce({ ...list(), waiting: [asked('n.md', 'Newer job')] });
    reload(view);
    await screen.findByRole('button', { name: 'Newer job' });
    await act(async () => late(list()));
    expect(screen.getByRole('button', { name: 'Newer job' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send the quote' })).toBeNull();
  });

  it('keeps the rows shown, with a retry line, when a reload fails', async () => {
    apiMock.askedTodos.mockResolvedValueOnce(list());
    const view = mount();
    fireEvent.click(await screen.findByRole('radio', { name: 'Asked, 2' }));
    apiMock.askedTodos.mockRejectedValueOnce(new Error('x'));
    reload(view);
    const line = await screen.findByText(/Couldn't refresh this list/);
    expect(line.getAttribute('role')).toBe('status');
    expect(screen.getByRole('button', { name: 'Send the quote' })).toBeTruthy();
  });

  it('Try again shows the loading state again while it asks', async () => {
    apiMock.askedTodos.mockRejectedValueOnce(new Error('x'));
    mount();
    fireEvent.click(await screen.findByRole('radio', { name: /^Asked/ }));
    const retry = await screen.findByRole('button', { name: 'Try again' });
    apiMock.askedTodos.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(retry);
    await screen.findByText("Loading what you've asked of others.");
  });

  it('closes History and fetches afresh for the next to-do', async () => {
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

  it('has no History for a personal to-do', async () => {
    setStore('on', [todo('p.md', 'Mine only', { scope: 'personal', key: 'personal/p.md' })]);
    mount();
    const panel = await open('Mine only');
    expect(within(panel).queryByRole('button', { name: 'History' })).toBeNull();
  });
});
