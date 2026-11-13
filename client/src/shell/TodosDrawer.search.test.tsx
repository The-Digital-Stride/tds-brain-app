// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoHandover, TodoItem, TodoList } from '../../../shared/contract.ts';

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../store.tsx', () => ({ useStore: () => store.current, TODO_UNDO_MS: 10_000 }));
vi.mock('./ShellProvider.tsx', () => ({
  useShell: () => ({ state: {}, dispatch: vi.fn(), modes: { drawerOverlays: false, panelOverlays: false } }),
}));

const { TodosDrawer } = await import('./TodosDrawer.tsx');

const recent = new Date(Date.now() - 86_400_000).toISOString();
const handover = (over: Partial<TodoHandover> = {}): TodoHandover => ({
  by: 'ben-mcadam',
  byName: 'Ben McAdam',
  at: recent,
  from: null,
  via: 'TDS Brain App',
  source: 'stamp',
  ...over,
});
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
  details: '',
  version: 'v1',
  ...over,
});
const personal = (id: string, title: string, over: Partial<TodoItem> = {}): TodoItem =>
  todo(id, title, { scope: 'personal', key: `personal/${id}`, path: `personal/todo/${id}`, ...over });

const fns = {
  changeTodos: vi.fn(),
  markTodosSeen: vi.fn(),
  openView: vi.fn(),
  holdTodo: vi.fn(),
  undoHeld: vi.fn(),
  newChat: vi.fn(),
  openChat: vi.fn(),
};

function setStore(mine: TodoItem[], over: Partial<TodoList> = {}, seen: Record<string, string> = {}) {
  store.current = {
    ...fns,
    heldTodos: [],
    completeTodo: vi.fn(),
    view: 'chat',
    activeChat: { kind: 'new', key: 1, draft: '', skill: null, todoId: null },
    boot: {
      clients: [
        { slug: 'acme', name: 'Acme' },
        { slug: 'bolt', name: 'Bolt' },
      ],
      identity: { slug: 'sam-example' },
      prefs: { directWrites: true, todoSeen: seen },
    },
    todos: {
      mine,
      open: [todo('o1.md', 'Open thing')],
      othersCount: 0,
      team: [
        { slug: 'sam-example', name: 'Sam Example' },
        { slug: 'ben-mcadam', name: 'Ben McAdam' },
      ],
      changes: 'on',
      canAddOpen: false,
      canUsePersonal: false,
      ...over,
    },
    sessions: { live: [], past: [] },
  };
}

beforeEach(() => {
  for (const f of Object.values(fns)) f.mockReset();
  fns.changeTodos.mockResolvedValue({ done: 1 });
  setStore([todo('a.md', 'Renew contract')]);
});
afterEach(cleanup);

describe('quick add', () => {
  it('opens a one-line add from the + button and Enter adds it to me with no date', async () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    expect(screen.queryByLabelText('Due date (optional)')).toBeNull();
    fireEvent.change(screen.getByLabelText('What needs doing?'), { target: { value: ' Ring Bob ' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add a to-do' }));
    await waitFor(() =>
      expect(fns.changeTodos).toHaveBeenCalledWith([
        { kind: 'add', title: 'Ring Bob', due: null, assignee: 'sam-example' },
      ]),
    );
  });

  it('shows the lock only when personal is available, and sends scope personal when on', async () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    expect(screen.queryByRole('button', { name: 'Keep it personal' })).toBeNull();
    cleanup();
    setStore([todo('a.md', 'Renew contract')], { canUsePersonal: true });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it personal' }));
    fireEvent.change(screen.getByLabelText('What needs doing?'), { target: { value: 'Private' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add a to-do' }));
    await waitFor(() =>
      expect(fns.changeTodos).toHaveBeenCalledWith([
        { kind: 'add', title: 'Private', due: null, assignee: 'sam-example', scope: 'personal' },
      ]),
    );
  });

  it('starts personal while the Personal filter is showing', () => {
    setStore([personal('p.md', 'Private note')], { canUsePersonal: true });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: 'Personal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    expect(screen.getByRole('button', { name: 'Keep it personal' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('choosing someone else turns personal off and disables it with the reason', () => {
    setStore([todo('a.md', 'Renew contract')], { canUsePersonal: true });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it personal' }));
    fireEvent.click(screen.getByRole('button', { name: "Choose who it's for" }));
    fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: 'ben-mcadam' } });
    const lock = screen.getByRole('button', { name: 'Keep it personal' });
    expect(lock.getAttribute('aria-disabled')).toBe('true');
    expect(lock.getAttribute('aria-pressed')).toBe('false');
    expect(lock.getAttribute('aria-describedby')).toBe(
      screen.getByText('A personal to-do can only be yours.').id,
    );
    fireEvent.click(lock);
    expect(lock.getAttribute('aria-pressed')).toBe('false');
    // The person toggle now names who it is for.
    expect(screen.getByRole('button', { name: 'For: Ben McAdam' }).getAttribute('data-on')).toBe('true');
  });

  it('names the date in its toggle and uses only aria-expanded', () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a due date' }));
    fireEvent.change(screen.getByLabelText('Due date (optional)'), { target: { value: '2030-11-14' } });
    const toggle = screen.getByRole('button', { name: 'Due date: 14 Nov' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-pressed')).toBeNull();
    expect(toggle.getAttribute('data-on')).toBe('true');
  });

  it('describes the Add button with the personal warning while it shows', () => {
    setStore([todo('a.md', 'Renew contract')], { canUsePersonal: true });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    expect(screen.getByRole('button', { name: 'Add' }).getAttribute('aria-describedby')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it personal' }));
    const warning = screen.getByText(/Personal to-dos stay on this Mac/);
    expect(screen.getByRole('button', { name: 'Add' }).getAttribute('aria-describedby')).toBe(warning.id);
  });

  it('More options moves focus to the first field it reveals', () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Due date (optional)'));
  });

  it('More options shows the date and assignee fields', () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a to-do' }));
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByLabelText('Due date (optional)')).toBeTruthy();
    expect(screen.getByLabelText('Assigned to')).toBeTruthy();
  });
});

describe('search and filters', () => {
  const items = [
    todo('a.md', 'Renew contract', { client: 'acme' }),
    todo('b.md', 'Ring Bob', { client: 'bolt', due: '2999-01-01' }),
    todo('c.md', 'Someday idea', { due: null }),
  ];

  it('filters by text and says when nothing matches, with a Clear filters button', () => {
    setStore(items);
    render(<TodosDrawer />);
    const search = screen.getByLabelText('Search to-dos');
    fireEvent.change(search, { target: { value: 'ring' } });
    expect(screen.getByText('Ring Bob', { exact: false })).toBeTruthy();
    expect(screen.queryByText('Renew contract', { exact: false })).toBeNull();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No to-dos match.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Renew contract', { exact: false })).toBeTruthy();
  });

  it('hints at matches in the other tab', () => {
    setStore(items);
    render(<TodosDrawer />);
    fireEvent.change(screen.getByLabelText('Search to-dos'), { target: { value: 'open thing' } });
    expect(screen.getByRole('button', { name: '1 in Open to anyone' })).toBeTruthy();
  });

  it('matches a project by the words the row shows', () => {
    setStore([todo('w.md', 'Plan', { project: 'website-rebuild' }), todo('x.md', 'Other')]);
    render(<TodosDrawer />);
    fireEvent.change(screen.getByLabelText('Search to-dos'), { target: { value: 'website rebuild' } });
    expect(screen.getByText('Plan', { exact: false })).toBeTruthy();
    expect(screen.queryByText('Other', { exact: false })).toBeNull();
  });

  it('focuses the search after jumping to the other tab', () => {
    setStore(items);
    render(<TodosDrawer />);
    fireEvent.change(screen.getByLabelText('Search to-dos'), { target: { value: 'open thing' } });
    fireEvent.click(screen.getByRole('button', { name: '1 in Open to anyone' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Search to-dos'));
  });

  it('announces the number of matches a moment after typing, and only while filtering', async () => {
    setStore(items);
    render(<TodosDrawer />);
    const live = () => screen.getAllByRole('status').map((n) => n.textContent);
    expect(live().join('')).toBe('');
    fireEvent.change(screen.getByLabelText('Search to-dos'), { target: { value: 'ring' } });
    await waitFor(() => expect(live()).toContain('1 to-do matches'), { timeout: 2000 });
    fireEvent.change(screen.getByLabelText('Search to-dos'), { target: { value: 'zzz' } });
    await waitFor(() => expect(live()).toContain('No to-dos match'), { timeout: 2000 });
  });

  it('Escape clears the search and keeps the event from closing the drawer', () => {
    setStore(items);
    render(<TodosDrawer />);
    const search = screen.getByLabelText('Search to-dos') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'ring' } });
    const notStopped = fireEvent.keyDown(search, { key: 'Escape' });
    expect(search.value).toBe('');
    expect(notStopped).toBe(false);
  });

  it('opens every group while a filter is on, even the closed "No date" one', () => {
    setStore(items);
    render(<TodosDrawer />);
    const noDate = () => screen.getByRole('button', { name: /No date/ });
    expect(noDate().getAttribute('aria-expanded')).toBe('false');
    fireEvent.change(screen.getByLabelText('Search to-dos'), { target: { value: 'idea' } });
    expect(noDate().getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the client select with two or more clients, and filters by it', () => {
    setStore(items);
    render(<TodosDrawer />);
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'bolt' } });
    expect(screen.getByText('Ring Bob', { exact: false })).toBeTruthy();
    expect(screen.queryByText('Renew contract', { exact: false })).toBeNull();
  });

  it('hides the kind switch with no personal to-dos, and filters by it when shown', () => {
    setStore(items);
    render(<TodosDrawer />);
    expect(screen.queryByRole('radiogroup', { name: 'Which kind of to-do' })).toBeNull();
    cleanup();
    setStore([...items, personal('p.md', 'Secret plan')], { canUsePersonal: true });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: 'Personal' }));
    expect(screen.getByText('Secret plan', { exact: false })).toBeTruthy();
    expect(screen.queryByText('Ring Bob', { exact: false })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    const row = screen.getByText('Secret plan', { exact: false }).closest('li') as HTMLElement;
    expect(within(row).getByText('Personal')).toBeTruthy();
  });
});

describe('New to you', () => {
  const passed = todo('n.md', 'Fresh from Ben', { handover: handover() });

  it('lists a recent handover in its own group above the date groups, once', () => {
    setStore([todo('a.md', 'Renew contract', { due: '2000-01-01' }), passed]);
    render(<TodosDrawer />);
    const group = screen.getByRole('heading', { name: /New to you/ }).closest('section') as HTMLElement;
    expect(within(group).getByText('Fresh from Ben', { exact: false })).toBeTruthy();
    expect(screen.getAllByText('Fresh from Ben', { exact: false })).toHaveLength(1);
    expect(within(group).getByText('from Ben, yesterday')).toBeTruthy();
  });

  it('has no group for seen, own or old handovers', () => {
    setStore(
      [
        todo('s.md', 'Seen', { handover: handover() }),
        todo('o.md', 'Own', { handover: handover({ by: 'sam-example' }) }),
        todo('d.md', 'Old', { handover: handover({ at: '2020-01-01T00:00:00Z' }) }),
      ],
      {},
      { 's.md': recent },
    );
    render(<TodosDrawer />);
    expect(screen.queryByRole('heading', { name: /New to you/ })).toBeNull();
  });

  it('marks a row seen when it is opened, and all of them with Mark all as seen', () => {
    setStore([passed, todo('m.md', 'Another', { handover: handover() })]);
    render(<TodosDrawer />);
    fireEvent.click(screen.getByText('Fresh from Ben', { exact: false }));
    expect(fns.markTodosSeen).toHaveBeenCalledWith([passed]);
    expect(fns.newChat).toHaveBeenCalledWith({
      draft: 'Help me with this to-do: todo/n.md (Fresh from Ben)',
      todoId: 'n.md',
    });
    fns.markTodosSeen.mockReset();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as seen' }));
    expect(fns.markTodosSeen.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('keeps an undated new to-do in view when its editor opens and the seen marker is saved', () => {
    const undated = todo('u.md', 'Undated from Ben', { due: null, handover: handover() });
    setStore([undated]);
    // A real update: saving the marker changes what the next render reads.
    fns.markTodosSeen.mockImplementation((list: TodoItem[]) => {
      const boot = store.current.boot as { prefs: { todoSeen: Record<string, string> } };
      for (const t of list) boot.prefs.todoSeen = { ...boot.prefs.todoSeen, [t.key]: t.handover?.at ?? '' };
    });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Undated from Ben"' }));
    expect(fns.markTodosSeen).toHaveBeenCalled();
    expect(screen.getByRole('form', { name: /^Edit/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /New to you/ })).toBeTruthy();
  });

  it('Mark all as seen says so and keeps the keyboard in the drawer', () => {
    setStore([passed]);
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as seen' }));
    expect(screen.getByText('Marked as seen.')).toBeTruthy();
    expect(document.activeElement?.className).toContain('drawer-scroll');
  });

  it('marks a row seen when its editor is opened', () => {
    setStore([passed]);
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Fresh from Ben"' }));
    expect(fns.markTodosSeen).toHaveBeenCalledWith([passed]);
    expect(
      screen.getByText(`Passed to you by Ben McAdam, ${new Date(recent).getDate()}`, { exact: false }),
    ).toBeTruthy();
  });

  it('says "git history" for a handover found there', () => {
    setStore([todo('h.md', 'Old news', { handover: handover({ source: 'history', via: null }) })]);
    render(<TodosDrawer />);
    expect(screen.getByText('from Ben (git history)')).toBeTruthy();
  });
});

describe('personal to-dos', () => {
  const mineP = personal('p.md', 'Secret plan', { version: 'vp' });

  it('sends personal ticks with scope and version, and deletes with scope', () => {
    setStore([mineP], { canUsePersonal: true });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Secret plan"' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as done' }));
    expect(fns.holdTodo).toHaveBeenCalledWith({
      todoId: 'personal/p.md',
      title: 'Secret plan',
      kind: 'tick',
      label: 'Marked as done',
      action: null,
      tick: { id: 'p.md', scope: 'personal', expect: 'vp' },
    });
  });

  it('moves a TDS to-do to Personal after the other edits, with the warning', async () => {
    setStore([todo('a.md', 'Renew contract', { due: '2030-01-01' })], { canUsePersonal: true });
    fns.changeTodos.mockResolvedValue({
      done: 3,
      todos: store.current.todos,
      moved: { from: 'a.md', to: 'personal/a.md' },
    });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Renew contract"' }));
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Where this to-do is kept' })).getByRole('radio', {
        name: 'Personal',
      }),
    );
    expect(
      screen.getByText(
        "Personal to-dos stay on this Mac. They aren't backed up, and the Workbench, Reminders and teammates stop seeing them.",
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renewed' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2030-02-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fns.changeTodos).toHaveBeenCalled());
    expect(fns.changeTodos).toHaveBeenCalledWith([
      { kind: 'edit', id: 'a.md', title: 'Renewed', expect: 'v1' },
      { kind: 'due', id: 'a.md', due: '2030-02-02' },
      { kind: 'move', id: 'a.md', scope: 'tds', to: 'personal' },
    ]);
  });

  it('passing a personal to-do on switches it back to TDS: edit, due, move, then assignee', async () => {
    setStore([mineP], { canUsePersonal: true });
    const after = todo('p.md', 'Secret plan', { version: 'v9' });
    fns.changeTodos.mockResolvedValue({
      done: 2,
      todos: { ...(store.current.todos as TodoList), mine: [after] },
      moved: { from: 'personal/p.md', to: 'p.md' },
    });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Secret plan"' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Secret plan 2' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2030-02-02' } });
    fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: 'ben-mcadam' } });
    expect(screen.getByText('Passing it on makes it a TDS to-do so they can see it.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fns.holdTodo).toHaveBeenCalled());
    expect(fns.changeTodos).toHaveBeenCalledWith([
      { kind: 'edit', id: 'p.md', title: 'Secret plan 2', scope: 'personal', expect: 'vp' },
      { kind: 'due', id: 'p.md', due: '2030-02-02', scope: 'personal' },
      { kind: 'move', id: 'p.md', scope: 'personal', to: 'tds' },
    ]);
    // The pass-on is held against the moved to-do's new key, id and version.
    expect(fns.holdTodo).toHaveBeenCalledWith(
      expect.objectContaining({
        todoId: 'p.md',
        action: { kind: 'assignee', id: 'p.md', assignee: 'ben-mcadam', expect: 'v9' },
      }),
    );
  });

  it('offers no edit on a personal to-do while personal changes are off', () => {
    setStore([personal('p.md', 'Secret plan')], { canUsePersonal: false });
    render(<TodosDrawer />);
    expect(screen.queryByRole('button', { name: 'Edit "Secret plan"' })).toBeNull();
    expect(screen.getByText('Secret plan', { exact: false })).toBeTruthy();
  });

  it('hides the switch without canUsePersonal and for to-dos that are not yours', () => {
    setStore([todo('a.md', 'Renew contract')]);
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Renew contract"' }));
    expect(screen.queryByRole('radiogroup', { name: 'Where this to-do is kept' })).toBeNull();
  });
});

describe('which sections start open', () => {
  const expanded = (name: RegExp) => screen.getByRole('button', { name }).getAttribute('aria-expanded');

  it('opens only the top date group when nothing is new', () => {
    setStore([
      todo('late.md', 'Late thing', { due: '2000-01-01' }),
      todo('later.md', 'Later thing', { due: '2999-01-01' }),
      todo('none.md', 'Undated thing', { due: null }),
    ]);
    render(<TodosDrawer />);
    expect(expanded(/^Overdue/)).toBe('true');
    expect(expanded(/^Later/)).toBe('false');
    expect(expanded(/^No date/)).toBe('false');
  });

  it('opens only "New to you" when there is something new, and the top date group once it is cleared', () => {
    setStore([
      todo('late.md', 'Late thing', { due: '2000-01-01' }),
      todo('new.md', 'Handed over', { due: null, handover: handover() }),
    ]);
    const { rerender } = render(<TodosDrawer />);
    expect(expanded(/^New to you\s*\d/)).toBe('true');
    expect(expanded(/^Overdue/)).toBe('false');
    // Seen elsewhere (another tab or Home): "New to you" goes, and Overdue becomes the top group.
    setStore(
      [
        todo('late.md', 'Late thing', { due: '2000-01-01' }),
        todo('new.md', 'Handed over', { due: null, handover: handover() }),
      ],
      {},
      { 'new.md': recent },
    );
    rerender(<TodosDrawer />);
    expect(screen.queryByRole('button', { name: /^New to you\s*\d/ })).toBeNull();
    expect(expanded(/^Overdue/)).toBe('true');
    expect(expanded(/^No date/)).toBe('false');
  });
});
