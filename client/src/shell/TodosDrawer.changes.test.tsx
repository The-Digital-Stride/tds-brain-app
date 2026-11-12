// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoChangeAccess, TodoItem, TodoList } from '../../../shared/contract.ts';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../store.tsx', () => ({ useStore: () => store.current }));
vi.mock('./ShellProvider.tsx', () => ({
  useShell: () => ({ state: {}, dispatch: vi.fn(), modes: { drawerOverlays: false, panelOverlays: false } }),
}));

const { TodosDrawer } = await import('./TodosDrawer.tsx');

const todo = (over: Partial<TodoItem> = {}): TodoItem => ({
  id: 't1.md',
  title: 'Renew contract',
  assignee: 'sam-example',
  due: '2030-01-01',
  surfaceDate: null,
  project: null,
  client: null,
  created: null,
  source: null,
  details: 'Some notes',
  ...over,
});
const list = (changes: TodoChangeAccess, items: TodoItem[] = [todo()]): TodoList => ({
  mine: items,
  open: [],
  othersCount: 0,
  team: [
    { slug: 'sam-example', name: 'Sam Example' },
    { slug: 'ben-mcadam', name: 'Ben McAdam' },
  ],
  changes,
});

const changeTodos = vi.fn();
const openView = vi.fn();

function setStore(changes: TodoChangeAccess, items?: TodoItem[]) {
  store.current = {
    changeTodos,
    openView,
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

beforeEach(() => {
  changeTodos.mockReset();
  changeTodos.mockResolvedValue({ done: 1 });
  openView.mockReset();
  setStore('on');
});
afterEach(cleanup);

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('To-dos drawer, changing to-dos', () => {
  it('shows the controls only when changes are on', () => {
    render(<TodosDrawer />);
    expect(screen.getByRole('button', { name: 'Add a to-do' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit "Renew contract"' })).toBeTruthy();
    cleanup();
    for (const c of ['restricted', 'no-skill', 'switched-off'] as const) {
      setStore(c);
      render(<TodosDrawer />);
      expect(screen.queryByRole('button', { name: 'Add a to-do' })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
      cleanup();
    }
  });

  it('shows the switched-off line with a Settings link, and nothing for restricted', () => {
    setStore('switched-off');
    render(<TodosDrawer />);
    expect(screen.getByText(/Adding and editing to-dos is switched off/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(openView).toHaveBeenCalledWith('settings');
    cleanup();
    setStore('restricted');
    render(<TodosDrawer />);
    expect(screen.queryByText(/switched off/)).toBeNull();
  });

  it('adds with the person themselves as the default assignee', async () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
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

  it('cancels the add form with Escape', () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    fireEvent.keyDown(screen.getByLabelText('What needs doing?'), { key: 'Escape' });
    expect(screen.queryByLabelText('What needs doing?')).toBeNull();
    expect(changeTodos).not.toHaveBeenCalled();
  });

  it('sends only the changed fields, in order edit, due, assignee, without unchanged details', async () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Renew contract"' }));
    type('Assigned to', 'ben-mcadam');
    type('Due date', '2030-02-02');
    type('Title', 'Renew the contract');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos).toHaveBeenCalledWith([
      { kind: 'edit', id: 't1.md', title: 'Renew the contract' },
      { kind: 'due', id: 't1.md', due: '2030-02-02' },
      { kind: 'assignee', id: 't1.md', assignee: 'ben-mcadam' },
    ]);
    expect(await screen.findByText("Passed to Ben McAdam. It's on their list now.")).toBeTruthy();
    expect(screen.queryByRole('form', { name: /^Edit/ })).toBeNull();
  });

  it('sends details only when they changed, and Clear date sends null', async () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Renew contract"' }));
    type('Details', 'New notes');
    fireEvent.click(screen.getByRole('button', { name: 'Clear date' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos).toHaveBeenCalledWith([
      { kind: 'edit', id: 't1.md', title: 'Renew contract', details: 'New notes' },
      { kind: 'due', id: 't1.md', due: null },
    ]);
  });

  it('keeps the editor open and says so when only part of a save went through', async () => {
    changeTodos.mockResolvedValue({
      done: 1,
      error: { code: 'internal', message: 'The change could not be made.' },
    });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Renew contract"' }));
    type('Title', 'Renew it');
    type('Due date', '2030-03-03');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Some changes were saved, but not all. Check the to-do and save again.'),
    ).toBeTruthy();
    expect(screen.getByRole('form', { name: /^Edit/ })).toBeTruthy();
  });

  it('shows the server message and keeps the editor when nothing was saved', async () => {
    changeTodos.mockResolvedValue({
      done: 0,
      error: { code: 'not-found', message: 'That to-do could not be found.' },
    });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Renew contract"' }));
    type('Title', 'Renew it');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('That to-do could not be found.')).toBeTruthy();
    expect(screen.getByRole('form', { name: /^Edit/ })).toBeTruthy();
  });

  it('asks a second time before deleting, then sends delete', async () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Renew contract"' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(changeTodos).not.toHaveBeenCalled();
    expect(screen.getByText("Delete this to-do for good? It can't be undone.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(changeTodos).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete for good' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledWith([{ kind: 'delete', id: 't1.md' }]));
  });

  it('shows over-long details read-only and never sends them', async () => {
    setStore('on', [todo({ details: 'x'.repeat(8001) })]);
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Renew contract"' }));
    const details = screen.getByLabelText('Details') as HTMLTextAreaElement;
    expect(details.readOnly).toBe(true);
    expect(
      screen.getByText('These details are too long to edit here. Change them in a chat instead.'),
    ).toBeTruthy();
    type('Title', 'Renew it');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos).toHaveBeenCalledWith([{ kind: 'edit', id: 't1.md', title: 'Renew it' }]);
  });
});

describe('To-dos drawer, edge cases', () => {
  it('after a part-saved edit keeps the unsaved date and sends only that next', async () => {
    changeTodos.mockImplementationOnce(async () => {
      store.current.todos = list('on', [todo({ title: 'Renew it' })]);
      return { done: 1, error: { code: 'internal', message: 'The change could not be made.' } };
    });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Renew contract"' }));
    type('Title', 'Renew it');
    type('Due date', '2030-03-03');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Some changes were saved/);
    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toBe('2030-03-03');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Renew it');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(changeTodos).toHaveBeenCalledTimes(2));
    expect(changeTodos).toHaveBeenLastCalledWith([{ kind: 'due', id: 't1.md', due: '2030-03-03' }]);
  });

  it('marks errors in the status line', async () => {
    changeTodos.mockResolvedValue({ done: 0, error: { code: 'internal', message: 'Nope.' } });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Renew contract"' }));
    type('Title', 'x');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByText('Nope.')).getAttribute('data-tone')).toBe('error');
  });

  it('names the warning for the delete group', () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Renew contract"' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('group', { name: /Delete this to-do for good/ })).toBeTruthy();
  });

  it('puts focus on the Add button when the passed-on row has left the list', async () => {
    changeTodos.mockImplementationOnce(async () => {
      store.current.todos = list('on', []);
      return { done: 1 };
    });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Renew contract"' }));
    type('Assigned to', 'ben-mcadam');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Passed to Ben McAdam/);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a to-do' })),
    );
  });
});
