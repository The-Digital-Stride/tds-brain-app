// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskedTodo, AskedTodoList, TodoItem } from '../../../shared/contract.ts';
import { card, projectList } from '../apps/projects/testing.ts';

// The drawer's project filter across Mine, Open and Asked, and the row chips that set it (Ian, 2026-11-21).

const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const api = vi.hoisted(() => ({ askedTodos: vi.fn(), projects: vi.fn(), todoHistory: vi.fn() }));
vi.mock('../api.ts', () => ({ api }));
vi.mock('../store.tsx', () => ({ useStore: () => store.current, TODO_UNDO_MS: 10_000 }));
vi.mock('./ShellProvider.tsx', async () => ({
  useShell: (await import('./todo-test-kit.tsx')).useFakeShell,
}));
vi.mock('./TodoDetailsEditor.tsx', async () => ({
  default: (await import('./todo-test-kit.tsx')).FakeDetailsEditor,
}));
vi.mock('../todo-doc/index.ts', async () => (await import('./todo-test-kit.tsx')).todoDocFake);

const { fakeShell } = await import('./todo-test-kit.tsx');
const { projectsStore } = await import('../state/projects.ts');
const { projectChoice, clientChoice } = await import('../state/client-choice.ts');
const { TodosDrawer } = await import('./TodosDrawer.tsx');
const { looseProjectLabel, todoProjectKey } = await import('../state/todo-filter.ts');
const { todoPlaceParts, todoProjectChip } = await import('../state/projects.ts');
const { todoChatProject } = await import('../state/chat-project.ts');

const SITE = card({ slug: 'site', client: 'acme', title: 'Website' });
const SEO = card({ slug: 'seo', client: 'bolt', title: 'SEO audit' });
const inProject = (key: string) => ({ projectMatch: { how: 'key' as const, key } });

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
  attachments: [],
  ...over,
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
  details: '',
  asked: { slug: 'sam-example', name: 'Sam Example', at: '2026-11-10T09:00:00Z', source: 'stamp' },
  done: null,
  version: 'v1',
  attachments: [],
  ...over,
});

function setStore(mine: TodoItem[], open: TodoItem[] = []) {
  store.current = {
    changeTodos: vi.fn().mockResolvedValue({ done: 1 }),
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
      mine,
      open,
      othersCount: 3,
      team: [
        { slug: 'sam-example', name: 'Sam Example' },
        { slug: 'ben-mcadam', name: 'Ben McAdam' },
      ],
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
  };
}

const ASKED: AskedTodoList = {
  waiting: [
    asked('a1.md', 'Chase the logo', { client: 'acme', project: 'acme/site', ...inProject('acme/site') }),
    asked('a2.md', 'Send SEO notes', { client: 'bolt', project: 'bolt/seo', ...inProject('bolt/seo') }),
  ],
  done: [],
  historyRead: true,
};

beforeEach(() => {
  fakeShell.reset();
  api.projects.mockResolvedValue(projectList([SITE, SEO]));
  api.askedTodos.mockResolvedValue(ASKED);
  projectsStore.apply(projectList([SITE, SEO]));
  setStore(
    [
      todo('m1.md', 'Fix the header', { client: 'acme', project: 'acme/site', ...inProject('acme/site') }),
      todo('m2.md', 'Write the brief', { client: 'bolt', project: 'bolt/seo', ...inProject('bolt/seo') }),
      todo('m3.md', 'Ring the bank', { client: 'acme' }),
    ],
    [todo('o1.md', 'Open SEO thing', { client: 'bolt', project: 'bolt/seo', ...inProject('bolt/seo') })],
  );
});
afterEach(() => {
  cleanup();
  projectsStore.reset();
  act(() => projectChoice.set(''));
  clientChoice.set('');
});

const tabs = () => screen.getAllByRole('radio').map((r) => r.textContent);

describe('project chips on rows', () => {
  it('shows a known project as a chip that filters the drawer by it; a client alone stays words', async () => {
    render(<TodosDrawer />);
    const chip = screen.getByRole('button', { name: 'Filter by project: Acme · Website' });
    expect(chip.getAttribute('data-tip')).toBe('Filter by Acme · Website');
    // Ring the bank is in no project: its client is plain words, not a button.
    expect(screen.queryByRole('button', { name: /Filter by project: Acme$/ })).toBeNull();
    fireEvent.click(chip);
    expect(screen.queryByText('Write the brief', { exact: false })).toBeNull();
    expect(screen.getByText('Fix the header', { exact: false })).toBeTruthy();
    // Filtered to one project, no row names it at all (they would all say the same): the select says it once.
    expect(screen.queryByRole('button', { name: /^Filter by project/ })).toBeNull();
    expect(screen.queryByText('Acme · Website', { exact: false })).toBeNull();
    // The chip went with the filter: the keyboard is on the Project select, which now shows it.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Project' })),
    );
    // The client select steps aside while a project (which names its client) is on.
    expect(screen.queryByRole('combobox', { name: 'Client' })).toBeNull();
  });

  it('counts each tab as it would show, and leaves out the everyone count while filtering', async () => {
    render(<TodosDrawer />);
    await waitFor(() => expect(tabs()).toEqual(['Mine, 3', 'Open, 1', 'Asked, 2', 'Done']));
    expect(screen.getByText('3 more belong to other people.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Filter by project: Acme · Website' }));
    expect(tabs()).toEqual(['Mine, 1', 'Open, 0', 'Asked, 1', 'Done']);
    expect(screen.queryByText(/more belong to other people/)).toBeNull();
  });
});

describe('a task in a project this person cannot see', () => {
  it('says "Restricted project" in plain words: not a chip, button or link, and never a loose label', () => {
    setStore([
      todo('r1.md', 'Quiet job', { client: 'acme', projectMatch: { how: 'restricted' } }),
      todo('m3.md', 'Ring the bank', { client: 'acme' }),
    ]);
    render(<TodosDrawer />);
    const row = screen.getByText('Quiet job').closest('li') as HTMLElement;
    expect(within(row).getByText('Restricted project')).toBeTruthy();
    // The client is not named beside it, and nothing about the row can be pressed to filter by it.
    expect(within(row).queryByText(/Acme/)).toBeNull();
    expect(within(row).queryByRole('button', { name: /Restricted project/ })).toBeNull();
    expect(within(row).queryByRole('link')).toBeNull();
    expect(within(row).queryByRole('button', { name: /^Filter by project/ })).toBeNull();
  });

  it('reads as no project to the tidy-up and the chip rules', () => {
    const t = { projectMatch: { how: 'restricted' as const }, project: null };
    expect(looseProjectLabel(t)).toBeNull();
    expect(todoProjectKey(t)).toBeNull();
    expect(todoProjectChip(t, [SITE], [])).toBeNull();
    expect(todoChatProject(t, [SITE])).toBeNull();
    expect(todoPlaceParts({ client: 'acme', ...t }, [SITE], [{ slug: 'acme', name: 'Acme' }])).toEqual([
      'Restricted project',
    ]);
  });

  it('shows the same words on an Asked row', async () => {
    api.askedTodos.mockResolvedValue({
      waiting: [asked('a9.md', 'Hidden ask', { projectMatch: { how: 'restricted' } })],
      done: [],
      historyRead: true,
    });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: /^Asked/ }));
    const row = (await screen.findByText('Hidden ask')).closest('li') as HTMLElement;
    expect(within(row).getByText('Restricted project')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /Restricted project|Filter by project/ })).toBeNull();
  });
});

describe('the Asked tab', () => {
  it('follows the app-wide project, and says when nothing there matches', async () => {
    projectChoice.set('acme/site');
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: /^Asked/ }));
    await screen.findByText('Chase the logo');
    expect(screen.queryByText('Send SEO notes')).toBeNull();
    act(() => projectChoice.set('bolt/seo'));
    expect(screen.getByText('Send SEO notes')).toBeTruthy();
    expect(screen.queryByText('Chase the logo')).toBeNull();
  });

  it('filters by a chip on its own rows', async () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('radio', { name: /^Asked/ }));
    const row = (await screen.findByText('Chase the logo')).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Filter by project: Acme · Website' }));
    expect(screen.getByText('Chase the logo')).toBeTruthy();
    expect(screen.queryByText('Send SEO notes')).toBeNull();
  });

  it('says why it is empty when nothing asked of others is in the project, with Clear filters', async () => {
    api.askedTodos.mockResolvedValue({ ...ASKED, waiting: [ASKED.waiting[0] as AskedTodo] });
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter by project: Bolt · SEO audit' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Asked/ }));
    expect(
      await screen.findByText("None of the tasks you've asked of others are in Bolt · SEO audit."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Chase the logo')).toBeTruthy();
  });
});

describe('review fixes', () => {
  it("doesn't repeat the filtered project on Asked rows (the Mine tab does the same)", async () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter by project: Acme · Website' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Asked/ }));
    const row = (await screen.findByText('Chase the logo')).closest('li') as HTMLElement;
    expect(within(row).queryByRole('button', { name: /^Filter by project/ })).toBeNull();
    expect(row.textContent).not.toContain('Acme · Website');
  });

  it('gives an archived project no chip: the Project filter cannot show it', () => {
    projectsStore.apply(projectList([{ ...SITE, archived: true }, SEO]));
    render(<TodosDrawer />);
    expect(screen.queryByRole('button', { name: 'Filter by project: Acme · Website' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Filter by project: Bolt · SEO audit' })).toBeTruthy();
  });

  it('moves the keyboard to the Project select when Clear lets the Working on project go', async () => {
    projectChoice.set('acme/site');
    render(<TodosDrawer />);
    const why = screen.getByText(/Set by Working on/);
    fireEvent.click(within(why).getByRole('button', { name: 'Clear' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Project' })),
    );
  });
});

describe('adding while filtered', () => {
  it('starts the new task in the project the drawer is filtered to', async () => {
    render(<TodosDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter by project: Acme · Website' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    await screen.findByRole('form', { name: 'Add a task' });
    fireEvent.change(screen.getByLabelText('What needs doing?'), { target: { value: 'New bit' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add a task' }));
    const changeTodos = store.current.changeTodos as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(changeTodos).toHaveBeenCalled());
    expect(changeTodos.mock.calls[0]?.[0]?.[0]).toMatchObject({ kind: 'add', project: 'acme/site' });
  });
});
