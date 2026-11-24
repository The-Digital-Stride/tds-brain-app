// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoChangeAccess, TodoItem, TodoList } from '../../../shared/contract.ts';
import type { HeldTodo } from '../store.tsx';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../store.tsx', () => ({ useStore: () => store.current, TODO_UNDO_MS: 10_000 }));
vi.mock('./ShellProvider.tsx', async () => ({
  useShell: (await import('./todo-test-kit.tsx')).useFakeShell,
}));
vi.mock('./TodoDetailsEditor.tsx', async () => ({
  default: (await import('./todo-test-kit.tsx')).FakeDetailsEditor,
}));
vi.mock('../todo-doc/index.ts', async () => (await import('./todo-test-kit.tsx')).todoDocFake);

const { fakeShell, sent } = await import('./todo-test-kit.tsx');

const { TodosDrawer } = await import('./TodosDrawer.tsx');

const todo = (over: Partial<TodoItem> = {}): TodoItem => ({
  id: 't1.md',
  scope: 'tds',
  key: 't1.md',
  path: 'todo/t1.md',
  handover: null,
  createdBy: null,
  title: 'Renew contract',
  assignee: 'sam-example',
  due: '2030-01-01',
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
let canAddOpen = false;
let canUsePersonal = false;
const list = (changes: TodoChangeAccess, items: TodoItem[] = [todo()]): TodoList => ({
  mine: items,
  open: [],
  othersCount: 0,
  team: [
    { slug: 'sam-example', name: 'Sam Example' },
    { slug: 'ben-mcadam', name: 'Ben McAdam' },
  ],
  changes,
  canAddOpen,
  canAttach: false,
  canUpload: false,
  canUsePersonal,
});

const changeTodos = vi.fn();
const openView = vi.fn();
const openSettings = vi.fn();
const holdTodo = vi.fn();
const undoHeld = vi.fn();

function setStore(changes: TodoChangeAccess, items?: TodoItem[], heldTodos: HeldTodo[] = []) {
  store.current = {
    changeTodos,
    openView,
    openSettings,
    heldTodos,
    holdTodo,
    undoHeld,
    pauseHeld: vi.fn(),
    resumeHeld: vi.fn(),
    completeTodo: vi.fn(),
    newChat: vi.fn(),
    openChat: vi.fn(),
    view: 'chat',
    activeChat: { kind: 'new', key: 1, draft: '', skill: null, todoId: null },
    boot: { clients: [], identity: { slug: 'sam-example' }, prefs: { directWrites: true } },
    todos: list(changes, items),
    sessions: { live: [], past: [] },
  };
}

/** Opens the panel's add form (the panel loads the first time, hence the wait). */
const openAdd = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
  await screen.findByRole('form', { name: 'Add a to-do' });
};
/** Opens a to-do in the panel, already editing. */
const openEdit = async (title = 'Renew contract') => {
  fireEvent.click(screen.getByRole('button', { name: `Edit "${title}"` }));
  await screen.findByRole('form', { name: /^Edit/ });
};

beforeEach(() => {
  canAddOpen = false;
  canUsePersonal = false;
  changeTodos.mockReset();
  changeTodos.mockResolvedValue({ done: 1, todos: list('on', [todo({ version: 'v2' })]) });
  openView.mockReset();
  openSettings.mockReset();
  holdTodo.mockReset();
  undoHeld.mockReset();
  setStore('on');
});
afterEach(cleanup);
beforeEach(() => fakeShell.reset());

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('To-dos drawer, changing to-dos', () => {
  it('shows the controls only when changes are on', () => {
    render(<TodosDrawer />);
    expect(screen.getByRole('button', { name: 'Add a to-do' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit "Renew contract"' })).toBeTruthy();
    cleanup();
    fakeShell.reset();
    for (const c of ['restricted', 'no-skill', 'switched-off'] as const) {
      setStore(c);
      render(<TodosDrawer />);
      expect(screen.queryByRole('button', { name: 'Add a to-do' })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
      cleanup();
      fakeShell.reset();
    }
  });

  it('shows the switched-off line with a Settings link, and nothing for restricted', () => {
    setStore('switched-off');
    render(<TodosDrawer />);
    expect(screen.getByText(/Adding and editing to-dos is switched off/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(openSettings).toHaveBeenCalledWith('general', 'set-direct');
    cleanup();
    fakeShell.reset();
    setStore('restricted');
    render(<TodosDrawer />);
    expect(screen.queryByText(/switched off/)).toBeNull();
  });

  it('the Settings link closes a floating drawer first, so the sheet is not inert', () => {
    setStore('switched-off');
    fakeShell.reset({}, true);
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(sent.map((a) => a.type)).toContain('close-drawer');
    expect(openSettings).toHaveBeenCalledWith('general', 'set-direct');
  });

  it('with the drawer floating, the link closes only the drawer (which closes the panel), never asking twice', async () => {
    setStore('switched-off');
    (store.current as { view: string }).view = 'settings';
    fakeShell.reset({}, true);
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Renew contract' }));
    await waitFor(() => expect(fakeShell.state.todoPanel).not.toBeNull());
    sent.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    // Other actions (the panel's list order) may arrive while it loads; what matters is one close, no second question.
    const types = sent.map((a) => a.type);
    expect(types).toContain('close-drawer');
    expect(types).not.toContain('close-todo');
    expect(types).not.toContain('ask-todo');
  });

  it('already on Settings, the link closes an open to-do panel without putting focus back on its row', async () => {
    setStore('switched-off');
    (store.current as { view: string }).view = 'settings';
    render(<TodosDrawer />);
    const row = screen.getByRole('button', { name: 'Renew contract' });
    fireEvent.click(row);
    await waitFor(() => expect(fakeShell.state.todoPanel).not.toBeNull());
    const link = screen.getByRole('button', { name: 'Settings' });
    link.focus();
    fireEvent.click(link);
    expect(fakeShell.state.todoPanel).toBeNull();
    expect(openSettings).toHaveBeenCalledWith('general', 'set-direct');
    // Give the drawer's focus-return effects a chance to run: the row must not take focus.
    await new Promise((r) => setTimeout(r, 20));
    expect(document.activeElement).not.toBe(row);
  });

  it('adds with the person themselves as the default assignee', async () => {
    render(<TodosDrawer />);
    await openAdd();
    type('What needs doing?', '  Ring the client ');
    const who = screen.getByLabelText('Assigned to') as HTMLSelectElement;
    expect(who.value).toBe('sam-example');
    expect([...who.options].map((o) => o.text)).toEqual(['Me', 'Ben McAdam']);
    fireEvent.submit(screen.getByRole('form', { name: 'Add a to-do' }));
    await waitFor(() =>
      expect(changeTodos).toHaveBeenCalledWith([
        { kind: 'add', title: 'Ring the client', due: null, assignee: 'sam-example' },
      ]),
    );
  });

  it('cancels the add form with Escape', async () => {
    render(<TodosDrawer />);
    await openAdd();
    fireEvent.keyDown(screen.getByLabelText('What needs doing?'), { key: 'Escape' });
    expect(screen.queryByLabelText('What needs doing?')).toBeNull();
    expect(changeTodos).not.toHaveBeenCalled();
  });

  it('saves title and date now, in order, and holds the pass-on with an Undo', async () => {
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Assigned to', 'ben-mcadam');
    type('Due date', '2030-02-02');
    type('Title', 'Renew the contract');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(holdTodo).toHaveBeenCalled());
    expect(changeTodos).toHaveBeenCalledWith([
      { kind: 'edit', id: 't1.md', title: 'Renew the contract', expect: 'v1' },
      { kind: 'due', id: 't1.md', due: '2030-02-02' },
    ]);
    expect(holdTodo).toHaveBeenCalledWith({
      todoId: 't1.md',
      title: 'Renew the contract',
      kind: 'assignee',
      label: 'Passed to Ben McAdam',
      action: { kind: 'assignee', id: 't1.md', assignee: 'ben-mcadam', expect: 'v2' },
    });
    expect(await screen.findByText('Passed to Ben McAdam. You can undo this for 10 seconds.')).toBeTruthy();
    expect(screen.queryByRole('form', { name: /^Edit/ })).toBeNull();
  });

  it('holds a pass-on alone without sending anything yet', async () => {
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Assigned to', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(holdTodo).toHaveBeenCalled());
    expect(changeTodos).not.toHaveBeenCalled();
    expect(holdTodo.mock.calls[0]?.[0]).toMatchObject({ label: 'Made open to anyone' });
  });

  it('sends details only when they changed, and Clear date sends null', async () => {
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Details', 'New notes');
    fireEvent.click(screen.getByRole('button', { name: 'Clear date' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos).toHaveBeenCalledWith([
      { kind: 'edit', id: 't1.md', title: 'Renew contract', details: 'New notes', expect: 'v1' },
      { kind: 'due', id: 't1.md', due: null },
    ]);
  });

  it('keeps the editor open and says so when only part of a save went through', async () => {
    changeTodos.mockResolvedValue({
      done: 1,
      error: { code: 'internal', message: 'The change could not be made.' },
    });
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Title', 'Renew it');
    type('Due date', '2030-03-03');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'Some of your changes were saved, but not all. Your other changes are still here. Press Save to try again.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('form', { name: /^Edit/ })).toBeTruthy();
  });

  it('shows the server message and keeps the editor when nothing was saved', async () => {
    changeTodos.mockResolvedValue({
      done: 0,
      error: { code: 'not-found', message: 'That to-do could not be found.' },
    });
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Title', 'Renew it');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('That to-do could not be found. Your changes are still here.'),
    ).toBeTruthy();
    expect(screen.getByRole('form', { name: /^Edit/ })).toBeTruthy();
  });

  it('deletes without a second question, held with an Undo and nothing sent yet', async () => {
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    // Delete has an Undo, so it is a standard button, not red (design-system.md rule 5).
    expect(screen.getByRole('button', { name: 'Delete' }).getAttribute('data-variant')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(holdTodo).toHaveBeenCalled());
    expect(holdTodo).toHaveBeenCalledWith({
      todoId: 't1.md',
      title: 'Renew contract',
      kind: 'delete',
      label: 'Deleted',
      action: { kind: 'delete', id: 't1.md', expect: 'v1' },
    });
    expect(changeTodos).not.toHaveBeenCalled();
    expect(screen.getByText('Deleted. You can undo this for 10 seconds.')).toBeTruthy();
    expect(screen.queryByRole('form', { name: /^Edit/ })).toBeNull();
  });

  it('has no tick box: Mark as done in the opened to-do holds it instead of sending it', async () => {
    render(<TodosDrawer />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    await openEdit('Renew contract');
    fireEvent.click(screen.getByRole('button', { name: 'Mark as done' }));
    expect(holdTodo).toHaveBeenCalledWith({
      todoId: 't1.md',
      title: 'Renew contract',
      kind: 'tick',
      label: 'Marked as done',
      action: null,
    });
    expect(changeTodos).not.toHaveBeenCalled();
    expect(screen.queryByRole('form', { name: /^Edit/ })).toBeNull();
  });

  it('waits for unsaved edits before Mark as done, and says so', async () => {
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Title', 'Renew it');
    // Busy and held-back buttons are aria-disabled, never disabled (rule 12).
    const done = screen.getByRole('button', { name: 'Mark as done' });
    expect(done.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Save or cancel your changes before marking it as done.')).toBeTruthy();
    type('Title', 'Renew contract');
    expect(done.getAttribute('aria-disabled')).toBeNull();
  });

  // A held row is the shared Undo line now (plan 2026-11-22-ux-consistency, decision 12): a sentence saying what
  // happened in place of the struck-through title and its label.
  it('shows a held to-do as an Undo line, and Undo puts it back', () => {
    const held: HeldTodo = {
      todoId: 't1.md',
      title: 'Renew contract',
      kind: 'delete',
      label: 'Deleted',
      action: { kind: 'delete', id: 't1.md', expect: 'v1' },
    };
    setStore('on', undefined, [held]);
    render(<TodosDrawer />);
    expect(screen.queryByRole('button', { name: 'Edit "Renew contract"' })).toBeNull();
    const line = screen.getByText('"Renew contract" deleted.').closest('li') as HTMLElement;
    expect(line.classList.contains('undo-line')).toBe(true);
    expect(line.querySelector('.undo-line-bar')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo deleting "Renew contract"' }));
    expect(undoHeld).toHaveBeenCalledWith('t1.md');
    expect(screen.getByText('Undone.')).toBeTruthy();
  });

  it('says who a held to-do was passed to', () => {
    setStore('on', undefined, [
      {
        todoId: 't1.md',
        title: 'Renew contract',
        kind: 'assignee',
        label: 'Passed to Ben McAdam',
        action: { kind: 'assignee', id: 't1.md', assignee: 'ben-mcadam' },
      },
    ]);
    render(<TodosDrawer />);
    expect(screen.getByText('"Renew contract" passed to Ben McAdam.')).toBeTruthy();
  });

  it('does not hold the pass-on when the title or date part of the save fails', async () => {
    changeTodos.mockResolvedValue({ done: 0, error: { code: 'internal', message: 'Nope.' } });
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Title', 'Renew it');
    type('Assigned to', 'ben-mcadam');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Nope. Your changes are still here.');
    expect(holdTodo).not.toHaveBeenCalled();
    expect(screen.getByRole('form', { name: /^Edit/ })).toBeTruthy();
  });

  it('shows Sending… in place of Undo once the change is on its way', () => {
    setStore('on', undefined, [
      {
        todoId: 't1.md',
        title: 'Renew contract',
        kind: 'delete',
        label: 'Deleted',
        action: { kind: 'delete', id: 't1.md', expect: 'v1' },
        sending: true,
      },
    ]);
    render(<TodosDrawer />);
    expect(screen.getByText('Sending…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();
  });

  it('shows over-long details read-only and never sends them', async () => {
    setStore('on', [todo({ details: 'x'.repeat(8001) })]);
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    // Read only: shown, but with no text box to type in.
    expect(screen.getByLabelText('Details').getAttribute('role')).toBe('group');
    expect(screen.queryByRole('textbox', { name: 'Details' })).toBeNull();
    expect(
      screen.getByText('These details are too long to edit here. Change them in a chat instead.'),
    ).toBeTruthy();
    type('Title', 'Renew it');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos).toHaveBeenCalledWith([
      { kind: 'edit', id: 't1.md', title: 'Renew it', expect: 'v1' },
    ]);
  });
});

describe('To-dos drawer, conflict check and open adds', () => {
  it('sends the version captured when the editor opened, not a refreshed one', async () => {
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    // The list refreshes behind the open editor.
    (store.current.todos as TodoList).mine[0] = todo({ version: 'v9' });
    type('Title', 'Renew it');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos.mock.calls[0]?.[0][0]).toMatchObject({ kind: 'edit', expect: 'v1' });
  });

  it('carries the opened version on a pass-on that is the only change', async () => {
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Assigned to', 'ben-mcadam');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(holdTodo).toHaveBeenCalled());
    expect(holdTodo.mock.calls[0]?.[0].action).toMatchObject({ kind: 'assignee', expect: 'v1' });
  });

  it('does not hold the pass-on when the to-do is missing after the save', async () => {
    changeTodos.mockResolvedValue({ done: 1, todos: list('on', []) });
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Assigned to', 'ben-mcadam');
    type('Title', 'Renew it');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/no longer in your list/)).toBeTruthy();
    expect(holdTodo).not.toHaveBeenCalled();
  });

  it('on a changed refusal keeps the editor and draft, shows the message and adopts the new version', async () => {
    changeTodos.mockResolvedValueOnce({
      done: 0,
      error: { code: 'changed', message: 'Someone else changed this.' },
      todos: list('on', [todo({ title: 'Theirs', version: 'v7' })]),
    });
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Title', 'Mine');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const msg = await screen.findByText('Someone else changed this. Your changes are still here.');
    expect(msg.getAttribute('role')).toBe('status');
    expect(msg.getAttribute('data-tone')).toBe('error');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Mine');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(2));
    expect(changeTodos.mock.calls[1]?.[0][0]).toMatchObject({ kind: 'edit', title: 'Mine', expect: 'v7' });
  });

  it('rebases on a changed refusal: only what the person edited is sent, and the note lists the differences', async () => {
    const fresh = list('on', [
      todo({ title: 'Theirs', due: '2031-05-05', details: 'Ben notes', version: 'v7' }),
    ]);
    changeTodos.mockImplementationOnce(async () => {
      store.current.todos = fresh; // the store reloads the list
      return { done: 0, error: { code: 'changed', message: 'Someone else changed this.' }, todos: fresh };
    });
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Title', 'Mine');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Your changes are still here/);
    expect((screen.getByLabelText('Details') as HTMLTextAreaElement).value).toBe('Ben notes');
    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toBe('2031-05-05');
    const note = screen.getByText(/Someone else changed this to-do while you were editing/);
    expect(note.textContent).toContain('\u201cTheirs\u201d');
    expect(note.textContent).not.toContain('different details');
    expect(note.textContent).toContain('Press Save to replace it with yours, or Cancel to keep theirs.');
    expect(screen.getByRole('form', { name: /^Edit/ }).getAttribute('aria-describedby')).toBe(note.id);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(2));
    expect(changeTodos.mock.calls[1]?.[0]).toEqual([
      { kind: 'edit', id: 't1.md', title: 'Mine', expect: 'v7' },
    ]);
  });

  // The title and details step went through (the script added a title history line) and the date step failed:
  // pressing Save again must send only the date, never the typed details without that line.
  it('after a save that half went through, Save again sends only what is still unsaved', async () => {
    const fresh = list('on', [
      todo({
        title: 'Renew it',
        details: 'New notes\n\n## Title history\n\n- 2030-01-01: was "Renew contract"',
        version: 'v2',
      }),
    ]);
    changeTodos.mockImplementationOnce(async () => {
      store.current.todos = fresh;
      return { done: 1, error: { code: 'internal', message: 'Nope.' }, todos: fresh };
    });
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Title', 'Renew it ');
    type('Details', 'New notes');
    type('Due date', '2030-02-02');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Some of your changes were saved, but not all/);
    expect((screen.getByLabelText('Details') as HTMLTextAreaElement).value).toContain('## Title history');
    changeTodos.mockResolvedValueOnce({ done: 1, todos: fresh });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(2));
    expect(changeTodos.mock.calls[1]?.[0]).toEqual([
      { kind: 'due', id: 't1.md', due: '2030-02-02', expect: 'v2' },
    ]);
  });

  it('keeps text typed while a failing save is in flight', async () => {
    let fail: (v: unknown) => void = () => {};
    changeTodos.mockImplementationOnce(
      () =>
        new Promise((r) => {
          fail = r;
        }),
    );
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Title', 'Mine');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    type('Details', 'typed meanwhile');
    fail({
      done: 0,
      error: { code: 'changed', message: 'Someone else changed this.' },
      todos: list('on', [todo({ title: 'Theirs', version: 'v7' })]),
    });
    await screen.findByText(/Your changes are still here/);
    expect((screen.getByLabelText('Details') as HTMLTextAreaElement).value).toBe('typed meanwhile');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Mine');
  });

  it('Cancel after a conflict asks, and on Discard closes the editor and the row shows the fresh title', async () => {
    const fresh = list('on', [todo({ title: 'Theirs', version: 'v7' })]);
    changeTodos.mockImplementationOnce(async () => {
      store.current.todos = fresh;
      return { done: 0, error: { code: 'changed', message: 'Someone else changed this.' }, todos: fresh };
    });
    const view = render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Title', 'Mine');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Your changes are still here/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // Cancel asks first now (rule 9); do what the real shell does on Discard: drop the dirt, then go on.
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    const after = fakeShell.state.todoPanel?.ask;
    fakeShell.dispatch({ type: 'set-todo-dirty', dirty: false });
    if (after) fakeShell.dispatch(after);
    view.rerender(<TodosDrawer />);
    expect(screen.queryByRole('form', { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit "Theirs"' })).toBeTruthy();
  });

  it('offers Open to anyone when adding only with canAddOpen, and sends assignee null', async () => {
    render(<TodosDrawer />);
    await openAdd();
    expect(screen.queryByRole('option', { name: 'Open to anyone' })).toBeNull();
    cleanup();
    fakeShell.reset();
    canAddOpen = true;
    setStore('on');
    render(<TodosDrawer />);
    await openAdd();
    type('What needs doing?', 'Anyone can do this');
    type('Assigned to', '');
    fireEvent.submit(screen.getByRole('form', { name: 'Add a to-do' }));
    await waitFor(() =>
      expect(changeTodos).toHaveBeenCalledWith([
        { kind: 'add', title: 'Anyone can do this', due: null, assignee: null },
      ]),
    );
  });
});

describe('To-dos drawer, edge cases', () => {
  it('after a part-saved edit keeps the unsaved date and sends only that next', async () => {
    changeTodos.mockImplementationOnce(async () => {
      const fresh = list('on', [todo({ title: 'Renew it', version: 'v2' })]);
      store.current.todos = fresh;
      return { done: 1, todos: fresh, error: { code: 'internal', message: 'The change could not be made.' } };
    });
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Title', 'Renew it');
    type('Due date', '2030-03-03');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Some of your changes were saved/);
    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toBe('2030-03-03');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Renew it');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(2));
    expect(changeTodos).toHaveBeenLastCalledWith([
      { kind: 'due', id: 't1.md', due: '2030-03-03', expect: 'v2' },
    ]);
  });

  it('marks errors in the status line', async () => {
    changeTodos.mockResolvedValue({ done: 0, error: { code: 'internal', message: 'Nope.' } });
    render(<TodosDrawer />);
    await openEdit('Renew contract');
    type('Title', 'x');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByText('Nope. Your changes are still here.')).getAttribute('data-tone')).toBe(
      'error',
    );
  });

  it('drops the "You can undo" line once the held change is sent, but keeps "Undone."', async () => {
    const held: HeldTodo = {
      todoId: 't1.md',
      title: 'Renew contract',
      kind: 'tick',
      label: 'Marked as done',
      action: null,
    };
    const { rerender } = render(<TodosDrawer />);
    await openEdit('Renew contract');
    fireEvent.click(screen.getByRole('button', { name: 'Mark as done' }));
    setStore('on', undefined, [held]);
    rerender(<TodosDrawer />);
    expect(screen.getByText('Marked as done. You can undo this for 10 seconds.')).toBeTruthy();
    setStore('on', [], []);
    rerender(<TodosDrawer />);
    expect(screen.queryByText(/You can undo this/)).toBeNull();

    cleanup();
    fakeShell.reset();
    setStore('on', undefined, [held]);
    const second = render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo marking as done "Renew contract"' }));
    setStore('on', undefined, []);
    second.rerender(<TodosDrawer />);
    expect(screen.getByText('Undone.')).toBeTruthy();
  });

  it('puts focus on the Add button when a held row is sent and leaves the list', () => {
    const held: HeldTodo = {
      todoId: 't1.md',
      title: 'Renew contract',
      kind: 'tick',
      label: 'Marked as done',
      action: null,
    };
    setStore('on', undefined, [held]);
    const { rerender } = render(<TodosDrawer />);
    const undoButton = screen.getByRole('button', { name: /^Undo/ });
    undoButton.focus();
    setStore('on', [], []);
    rerender(<TodosDrawer />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a to-do' }));
  });
});
