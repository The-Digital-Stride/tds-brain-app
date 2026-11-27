// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoneTodo, DoneTodoList, TeamTodo } from '../../../shared/contract.ts';
import { card, projectList } from '../apps/projects/testing.ts';
import { pickOption } from '../test/pick.ts';

// The drawer's Done tab: lazy load, search, project filter, the read-only panel, and the panel's wait for the
// shared done store (done-todos plan 2026-11-24, decisions 5, 6 and 8a).

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const api = vi.hoisted(() => ({
  doneTodos: vi.fn(),
  projects: vi.fn(),
  todoHistory: vi.fn(),
  teamTodo: vi.fn(),
}));
vi.mock('../api.ts', () => ({ api }));
vi.mock('../store.tsx', () => ({ useStore: () => store.current, TODO_UNDO_MS: 10_000 }));
vi.mock('./ShellProvider.tsx', async () => ({
  useShell: (await import('./todo-test-kit.tsx')).useFakeShell,
}));
vi.mock('./TodoDetailsEditor.tsx', async () => ({
  default: (await import('./todo-test-kit.tsx')).FakeDetailsEditor,
}));
vi.mock('../todo-doc/index.ts', async () => (await import('./todo-test-kit.tsx')).todoDocFake);
const { askedStoreFields } = await import('./todo-test-kit.tsx');

const { fakeShell, sent } = await import('./todo-test-kit.tsx');
const { projectsStore } = await import('../state/projects.ts');
const { doneStore } = await import('../state/todo-done.ts');
const { teamTodoStore } = await import('../state/team-todo.ts');
const { TodosDrawer, PANEL_WAIT_MS } = await import('./TodosDrawer.tsx');

const SITE = card({ slug: 'site', client: 'acme', title: 'Website' });
const SEO = card({ slug: 'seo', client: 'bolt', title: 'SEO audit' });

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const done = (id: string, title: string, over: Partial<DoneTodo> = {}): DoneTodo => ({
  key: `done:todo/done/${id}`,
  id,
  scope: 'tds',
  path: `todo/done/${id}`,
  title,
  assignee: 'ben-mcadam',
  assigneeName: 'Ben McAdam',
  due: null,
  details: '',
  done: { slug: 'ben-mcadam', name: 'Ben McAdam', at: daysAgo(0), source: 'stamp' },
  version: 'v1',
  attachments: [],
  client: null,
  project: null,
  stage: null,
  ...over,
});

const LIST: DoneTodoList = {
  historyRead: true,
  items: [
    done('a.md', 'Send the quote', {
      client: 'acme',
      project: 'acme/site',
      projectMatch: { how: 'key', key: 'acme/site' },
      details: 'Include boiler options',
    }),
    done('b.md', 'Audit the titles', {
      client: 'bolt',
      project: 'bolt/seo',
      projectMatch: { how: 'key', key: 'bolt/seo' },
      done: { slug: null, name: null, at: daysAgo(90), source: 'history' },
    }),
    done('c.md', 'Old chore', { done: null }),
  ],
};

function setStore() {
  store.current = {
    ...askedStoreFields,
    changeTodos: vi.fn(),
    markTodosSeen: vi.fn(),
    openView: vi.fn(),
    holdTodo: vi.fn(),
    undoHeld: vi.fn(),
    newChat: vi.fn(),
    openChat: vi.fn(),
    toggleFavouriteTodo: vi.fn(),
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
      prefs: { directWrites: true, todoSeen: {} },
    },
    todos: {
      mine: [],
      open: [],
      othersCount: 0,
      team: [{ slug: 'ben-mcadam', name: 'Ben McAdam' }],
      changes: 'on',
      canAddOpen: false,
      canAttach: false,
      canUpload: false,
      canUsePersonal: false,
      canProject: true,
    },
    sessions: { live: [], past: [] },
    reveal: null,
    clearReveal: vi.fn(),
    doneReveal: null,
    clearDoneReveal: vi.fn(),
  };
}

beforeEach(() => {
  fakeShell.reset();
  setStore();
  api.doneTodos.mockResolvedValue(LIST);
  api.projects.mockResolvedValue(projectList([SITE, SEO]));
  api.todoHistory.mockResolvedValue({ status: 'ok', events: [], more: false });
  projectsStore.apply(projectList([SITE, SEO]));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  projectsStore.reset();
  doneStore.reset();
  teamTodoStore.reset();
  for (const f of Object.values(api)) f.mockReset();
});

const openDone = () => fireEvent.click(screen.getByRole('radio', { name: 'Done' }));

describe('the Done tab', () => {
  it('loads only when opened, then lists finished tasks with who and when', async () => {
    render(<TodosDrawer />);
    expect(api.doneTodos).not.toHaveBeenCalled();
    openDone();
    await screen.findByText('Send the quote');
    expect(api.doneTodos).toHaveBeenCalledTimes(1);
    const row = screen.getByText('Send the quote').closest('li') as HTMLElement;
    expect(within(row).getByText(/^Done by Ben, \d+ \w+$/)).toBeTruthy();
    // No star, edit, tick or chat buttons on a finished row.
    expect(within(row).queryByRole('button', { name: /Edit|Start a chat|Pin|Mark/ })).toBeNull();
    expect(screen.getByText('This week')).toBeTruthy();
    expect(screen.getAllByText('Date not known')).toHaveLength(2);
    // The kind switch isn't shown; the search box is.
    expect(screen.queryByRole('radio', { name: 'Personal' })).toBeNull();
    expect(screen.getByLabelText('Search done tasks')).toBeTruthy();
  });

  it('has its search box on this tab only, and searches title and details', async () => {
    render(<TodosDrawer />);
    expect(screen.queryByLabelText('Search done tasks')).toBeNull();
    openDone();
    await screen.findByText('Send the quote');
    fireEvent.change(screen.getByLabelText('Search done tasks'), { target: { value: 'boiler' } });
    expect(screen.getByText('Send the quote')).toBeTruthy();
    expect(screen.queryByText('Audit the titles')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search done tasks'), { target: { value: 'zzz' } });
    expect(screen.getByText('No finished tasks match “zzz”.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /^Mine/ }));
    expect(screen.queryByLabelText('Search done tasks')).toBeNull();
  });

  it('filters by project', async () => {
    render(<TodosDrawer />);
    openDone();
    await screen.findByText('Send the quote');
    pickOption('Project', 'SEO audit');
    expect(screen.queryByText('Send the quote')).toBeNull();
    expect(screen.getByText('Audit the titles')).toBeTruthy();
  });

  it('says so when nothing is finished, and offers Try again when the load fails', async () => {
    api.doneTodos.mockResolvedValueOnce({ items: [], historyRead: false });
    render(<TodosDrawer />);
    openDone();
    expect(await screen.findByText('No finished tasks yet.')).toBeTruthy();
    expect(screen.getByText(/git history couldn't be read/)).toBeTruthy();
    cleanup();
    doneStore.reset();
    api.doneTodos.mockRejectedValueOnce(new Error('404'));
    render(<TodosDrawer />);
    openDone();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByText('Send the quote');
  });

  it('opens a row in the read-only panel: details, status and history, no edit buttons', async () => {
    render(<TodosDrawer />);
    openDone();
    fireEvent.click(await screen.findByRole('button', { name: 'Send the quote' }));
    const panel = await screen.findByRole('dialog');
    expect(fakeShell.state.todoPanel).toMatchObject({ key: 'done:todo/done/a.md', mode: 'read' });
    expect(within(panel).getByLabelText('Details').textContent).toContain('Include boiler options');
    expect(within(panel).getByText(/^Done by Ben McAdam on \d+ \w+ \d{4}$/)).toBeTruthy();
    for (const name of ['Edit', 'Mark as done', 'Delete'])
      expect(within(panel).queryByRole('button', { name })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /chat/i })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'History' }));
    await waitFor(() => expect(api.todoHistory).toHaveBeenCalledWith('done:todo/done/a.md'));
  });

  it('walks previous and next through the Done tab in the order shown', async () => {
    render(<TodosDrawer />);
    openDone();
    fireEvent.click(await screen.findByRole('button', { name: 'Send the quote' }));
    await screen.findByRole('dialog');
    expect(fakeShell.state.todoPanel?.order).toEqual([
      'done:todo/done/a.md',
      'done:todo/done/b.md',
      'done:todo/done/c.md',
    ]);
  });
});

describe('a done: panel key', () => {
  it('waits for a slow store load instead of closing after the give-up time', async () => {
    let finish: (l: DoneTodoList) => void = () => {};
    api.doneTodos.mockReturnValue(new Promise<DoneTodoList>((r) => (finish = r)));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<TodosDrawer />);
    act(() => fakeShell.dispatch({ type: 'open-todo', key: 'done:todo/done/a.md', mode: 'read' }));
    await act(async () => {
      vi.advanceTimersByTime(PANEL_WAIT_MS + 1000);
    });
    expect(sent.some((a) => a.type === 'close-todo')).toBe(false);
    expect(fakeShell.state.todoPanel?.key).toBe('done:todo/done/a.md');
    vi.useRealTimers();
    await act(async () => finish(LIST));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getAllByText('Send the quote').length).toBeGreaterThan(0);
  });

  it('closes once the list has loaded and the task is not in it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<TodosDrawer />);
    act(() => fakeShell.dispatch({ type: 'open-todo', key: 'done:todo/done/gone.md', mode: 'read' }));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(PANEL_WAIT_MS + 100);
    });
    expect(fakeShell.state.todoPanel).toBeNull();
  });
});

const TEAM_KEY = 'team:todo/t.md';
const team = (over: Partial<TeamTodo> = {}): TeamTodo => ({
  key: TEAM_KEY,
  id: 't.md',
  path: 'todo/t.md',
  title: 'Ring the supplier',
  assignee: 'ben-mcadam',
  assigneeName: 'Ben McAdam',
  due: null,
  details: 'Ask about lead times',
  version: 'v1',
  attachments: [],
  client: null,
  project: null,
  stage: null,
  ...over,
});

describe("a team: panel key (a teammate's open task)", () => {
  it('switches to my own key when the task turns out to be mine (passed to me)', async () => {
    api.teamTodo.mockResolvedValue(team({ assignee: 'sam-example', assigneeName: 'Sam Example' }));
    render(<TodosDrawer />);
    act(() => fakeShell.dispatch({ type: 'open-todo', key: TEAM_KEY, mode: 'read' }));
    await waitFor(() =>
      expect(sent).toContainEqual({ type: 'open-todo', key: 't.md', mode: 'read', force: true }),
    );
  });

  it('waits for a slow load past the give-up time, then reads it with no edit buttons', async () => {
    let finish: (t: TeamTodo) => void = () => {};
    api.teamTodo.mockReturnValue(new Promise<TeamTodo>((r) => (finish = r)));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<TodosDrawer />);
    act(() => fakeShell.dispatch({ type: 'open-todo', key: TEAM_KEY, mode: 'read' }));
    await act(async () => {
      vi.advanceTimersByTime(PANEL_WAIT_MS + 1000);
    });
    expect(sent.some((a) => a.type === 'close-todo')).toBe(false);
    expect(api.teamTodo).toHaveBeenCalledWith('t.md');
    vi.useRealTimers();
    await act(async () => finish(team()));
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByLabelText('Details').textContent).toContain('Ask about lead times');
    expect(within(panel).getByText('With Ben McAdam')).toBeTruthy();
    expect(within(panel).getByText("This is Ben's task, so you can read it but not change it.")).toBeTruthy();
    for (const name of ['Edit', 'Mark as done', 'Delete'])
      expect(within(panel).queryByRole('button', { name })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /chat/i })).toBeNull();
    expect(fakeShell.state.todoPanel?.order).toEqual([TEAM_KEY]);
    fireEvent.click(within(panel).getByRole('button', { name: 'History' }));
    await waitFor(() => expect(api.todoHistory).toHaveBeenCalledWith('t.md'));
  });

  it('says so for a task open to anyone', async () => {
    api.teamTodo.mockResolvedValue(team({ assignee: null, assigneeName: null }));
    render(<TodosDrawer />);
    act(() => fakeShell.dispatch({ type: 'open-todo', key: TEAM_KEY, mode: 'read' }));
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('Open to anyone')).toBeTruthy();
    expect(
      within(panel).getByText('This task is open to anyone. Pick it up from the Open tab to change it.'),
    ).toBeTruthy();
  });

  it('closes when the task has gone', async () => {
    api.teamTodo.mockRejectedValue(
      Object.assign(new Error('That task could not be found.'), { status: 404 }),
    );
    render(<TodosDrawer />);
    act(() => fakeShell.dispatch({ type: 'open-todo', key: TEAM_KEY, mode: 'read' }));
    await waitFor(() => expect(fakeShell.state.todoPanel).toBeNull());
  });
});

describe('revealDoneTodo', () => {
  // As the real store: clearing the request really clears it, so a dropped reveal can't come back on a re-render.
  const reveal = (key: string) => {
    const clearDoneReveal = vi.fn(() => {
      store.current = { ...store.current, doneReveal: null };
    });
    store.current = { ...store.current, doneReveal: { key, n: 1 }, clearDoneReveal };
  };

  it('refreshes a stale list once and opens a task ticked since it last loaded', async () => {
    api.doneTodos.mockResolvedValueOnce(LIST);
    await doneStore.refresh();
    const fresh = done('new.md', 'Just finished');
    api.doneTodos.mockResolvedValue({ ...LIST, items: [fresh, ...LIST.items] });
    reveal(fresh.key);
    render(<TodosDrawer />);
    await waitFor(() => expect(fakeShell.state.todoPanel?.key).toBe(fresh.key));
    expect(api.doneTodos.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('radio', { name: 'Done' }).getAttribute('aria-checked')).toBe('true');
  });

  it('gives up when the task is still missing after the refresh', async () => {
    api.doneTodos.mockResolvedValue(LIST);
    await doneStore.refresh();
    reveal('done:todo/done/gone.md');
    render(<TodosDrawer />);
    await waitFor(() => expect(store.current.clearDoneReveal).toHaveBeenCalled());
    expect(api.doneTodos.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(sent.some((a) => a.type === 'open-todo')).toBe(false);
  });
});
