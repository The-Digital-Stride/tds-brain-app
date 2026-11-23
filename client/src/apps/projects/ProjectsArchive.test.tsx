// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRemoveCheck, ProjectRemoveCheckResponse } from '../../../../shared/projects-contract.ts';
import { card, projectList } from './testing.ts';

const store = vi.hoisted(() => ({
  newChat: vi.fn(),
  changeTodos: vi.fn(),
  boot: { identity: { slug: 'me' }, clients: [] as { slug: string; name: string }[] },
  todos: { mine: [], open: [], othersCount: 0, team: [{ slug: 'me', name: 'Me Myself' }], canProject: true },
}));
const api = vi.hoisted(() => ({
  projects: vi.fn(),
  changeProject: vi.fn(),
  checkProjectMove: vi.fn(),
  moveProject: vi.fn(),
  checkProjectRemove: vi.fn(),
  removeProject: vi.fn(),
  projectFiles: vi.fn(),
  projectTodos: vi.fn(),
}));
vi.mock('../../api.ts', () => ({
  api,
  ApiFailure: class ApiFailure extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
}));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));

const { ProjectsSheet } = await import('./ProjectsSheet.tsx');
const { projectsStore } = await import('../../state/projects.ts');
const { ApiFailure } = await import('../../api.ts');

const LIVE = card({ slug: 'site', title: 'Sky site', owner: 'me', version: 'v1' });
const OLD = card({ slug: 'old', title: 'Old job', archived: true, status: 'active', version: 'v2' });

function check(over: Partial<ProjectRemoveCheck> = {}): ProjectRemoveCheck {
  return {
    key: 'skyseal/site',
    from: 'clients/skyseal/projects/site',
    to: 'clients/skyseal/projects-archive/site',
    files: ['project.md'],
    fileCount: 4,
    images: 1,
    documents: 2,
    other: 1,
    bytes: 2048,
    ignoredCount: 0,
    localOnlyCount: 0,
    references: [],
    referenceCount: 0,
    filesVersion: 'fv1',
    empty: false,
    allowed: true,
    allowedWho: '',
    ...over,
  };
}
function answer(over: Partial<ProjectRemoveCheck> = {}, rest: Partial<ProjectRemoveCheckResponse> = {}) {
  return { check: check(over), todos: [], doneTodos: 0, ...rest };
}
const TODOS = [
  { id: 'mine', title: 'My to-do', scope: 'tds' as const, assignee: 'me', version: 'a' },
  { id: 'nobody', title: 'Loose to-do', scope: 'tds' as const, assignee: null, version: 'b' },
  { id: 'theirs', title: 'Their to-do', scope: 'tds' as const, assignee: 'sam', version: 'c' },
];

beforeEach(() => {
  store.boot.clients = [{ slug: 'skyseal', name: 'Skyseal' }];
  api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
  api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
  api.checkProjectRemove.mockResolvedValue(answer());
});
afterEach(() => {
  cleanup();
  projectsStore.reset();
  vi.clearAllMocks();
});

async function show(list: ReturnType<typeof projectList>) {
  api.projects.mockResolvedValue(list);
  projectsStore.apply(list);
  render(<ProjectsSheet />);
  await screen.findByText(/of \d+ (archived )?project/);
}
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const btn = (name: string | RegExp) => screen.queryByRole('button', { name });
const filter = (value: string) => fireEvent.change(screen.getByLabelText('Status'), { target: { value } });

describe('the Projects list and archived projects', () => {
  const list = projectList([LIVE, OLD, card({ slug: 'fin', title: 'Finished', status: 'done' })]);

  it('leaves archived projects out of the list and its count', async () => {
    await show(list);
    expect(screen.getByText('2 of 2 projects')).toBeTruthy();
    expect(screen.queryByText('Old job')).toBeNull();
  });

  it('shows only archived ones under Archived, and Done leaves them out', async () => {
    await show(list);
    filter('archived');
    expect(screen.getByText('Old job')).toBeTruthy();
    expect(screen.queryByText('Sky site')).toBeNull();
    expect(screen.getByText('1 of 1 archived project')).toBeTruthy();
    filter('done');
    expect(screen.getByText('Finished')).toBeTruthy();
    expect(screen.queryByText('Old job')).toBeNull();
  });

  it('counts live projects in the empty state and offers the archived ones', async () => {
    await show(projectList([OLD]));
    expect(screen.getByText(/No projects yet/)).toBeTruthy();
    press('1 archived');
    expect(screen.getByText('Old job')).toBeTruthy();
  });
});

describe('buttons on a project page', () => {
  it('offers Archive on a live project when the brain can archive', async () => {
    await show(projectList([LIVE], { canArchive: true }));
    press(/Sky site/);
    expect(await screen.findByRole('button', { name: 'Archive Sky site' })).toBeTruthy();
    expect(btn(/^Delete/)).toBeNull();
  });

  it('shows nothing without canArchive', async () => {
    await show(projectList([LIVE]));
    press(/Sky site/);
    expect(btn(/^Archive/)).toBeNull();
    expect(api.checkProjectRemove).not.toHaveBeenCalled();
  });

  it('adds Delete when the live project is empty', async () => {
    api.checkProjectRemove.mockResolvedValue(answer({ empty: true }));
    await show(projectList([LIVE], { canArchive: true }));
    press(/Sky site/);
    expect(await screen.findByRole('button', { name: 'Delete Sky site' })).toBeTruthy();
  });

  it('shows the banner, Unarchive and Delete on an archived page when allowed', async () => {
    api.checkProjectRemove.mockResolvedValue(answer({ allowed: true }));
    await show(projectList([OLD], { canArchive: true }));
    press('1 archived');
    press(/Old job/);
    expect(screen.getByText(/This project is archived/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('says who can delete when this person may not', async () => {
    api.checkProjectRemove.mockResolvedValue(answer({ allowed: false, allowedWho: 'Ian Hancock' }));
    await show(projectList([OLD], { canArchive: true }));
    press('1 archived');
    press(/Old job/);
    expect(await screen.findByText(/Only Ian Hancock can delete this project/)).toBeTruthy();
    expect(btn('Delete')).toBeNull();
  });

  it('unarchives after a check, and shows a refusal as it comes', async () => {
    await show(projectList([OLD], { canArchive: true }));
    press('1 archived');
    press(/Old job/);
    api.removeProject.mockRejectedValueOnce(
      new ApiFailure('changed', 'A live project with this folder name already exists.', 409),
    );
    press('Unarchive');
    expect(await screen.findByText('A live project with this folder name already exists.')).toBeTruthy();
    api.removeProject.mockResolvedValue({
      list: projectList([{ ...OLD, archived: false }], { canArchive: true }),
      key: OLD.key,
      todosChanged: 0,
      todosFailed: [],
    });
    press('Unarchive');
    await waitFor(() =>
      expect(api.removeProject).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: 'unarchive', key: OLD.key, filesExpect: 'fv1' }),
      ),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Old job' })),
    );
  });
});

describe('the archive panel', () => {
  it('lists references and open to-dos, keeps them open by default, and sends the choices', async () => {
    api.checkProjectRemove.mockResolvedValue(
      answer(
        { references: ['clients/skyseal/notes.md'], referenceCount: 1 },
        { todos: TODOS.slice(0, 2), doneTodos: 3 },
      ),
    );
    await show(projectList([LIVE], { canArchive: true }));
    press(/Sky site/);
    press('Archive Sky site');
    expect(await screen.findByText('These files point into this folder:')).toBeTruthy();
    expect(screen.getByText('clients/skyseal/notes.md')).toBeTruthy();
    expect(screen.getByText('3 finished to-dos stay as they are.')).toBeTruthy();
    const keep = within(screen.getByRole('group', { name: 'My to-do' })).getByRole('radio', {
      name: 'Keep open',
    }) as HTMLInputElement;
    expect(keep.checked).toBe(true);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Loose to-do' })).getByRole('radio', { name: 'Mark as done' }),
    );
    api.removeProject.mockResolvedValue({
      list: projectList([{ ...LIVE, archived: true }], { canArchive: true }),
      key: LIVE.key,
      todosChanged: 1,
      todosFailed: [],
    });
    press('Archive');
    await waitFor(() =>
      expect(api.removeProject).toHaveBeenCalledWith({
        key: LIVE.key,
        action: 'archive',
        expect: 'v1',
        filesExpect: 'fv1',
        todos: [
          { id: 'mine', scope: 'tds', version: 'a', do: 'keep' },
          { id: 'nobody', scope: 'tds', version: 'b', do: 'done' },
        ],
      }),
    );
    expect(await screen.findByText(/Archived\. It has left the Projects list/)).toBeTruthy();
    expect(await screen.findByText(/This project is archived/)).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByText(/Archived\. It has left the Projects list/)),
    );
  });

  it('cancels with Escape and puts focus on Cancel', async () => {
    await show(projectList([LIVE], { canArchive: true }));
    press(/Sky site/);
    press('Archive Sky site');
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: /Archive Sky site/ })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Archive Sky site' })),
    );
    expect(api.removeProject).not.toHaveBeenCalled();
  });
});

describe('the delete panel', () => {
  async function open(
    over: Partial<ProjectRemoveCheck> = {},
    rest: Partial<ProjectRemoveCheckResponse> = {},
  ) {
    api.checkProjectRemove.mockResolvedValue(answer(over, rest));
    await show(projectList([OLD], { canArchive: true }));
    press('1 archived');
    press(/Old job/);
    await screen.findByRole('button', { name: 'Delete' });
    press('Delete');
  }

  it('states what is lost, defaults the to-dos, and needs the title typed', async () => {
    await open({ localOnlyCount: 3, references: ['skills/x.md'], referenceCount: 1 }, { todos: TODOS });
    expect(await screen.findByText("3 files exist only on this Mac and can't be recovered.")).toBeTruthy();
    expect(screen.getByText(/recovered from the brain's history/)).toBeTruthy();
    expect(screen.getByText('These links will break:')).toBeTruthy();
    expect(screen.getByText('Chats are kept.')).toBeTruthy();
    expect(screen.getByText(/go to the deleted folder and can be brought back/)).toBeTruthy();
    const on = (todo: string, n: string) =>
      (within(screen.getByRole('group', { name: todo })).getByRole('radio', { name: n }) as HTMLInputElement)
        .checked;
    expect(on('My to-do', 'Delete')).toBe(true);
    expect(on('Loose to-do', 'Delete')).toBe(true);
    expect(on('Their to-do', 'Keep the to-do, remove it from the project')).toBe(true);
    const del = screen.getByRole('button', { name: 'Delete' });
    // aria-disabled, never disabled, until the title is typed (Actions rule 12).
    expect(del.getAttribute('aria-disabled')).toBe('true');
    expect(del.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    const box = screen.getByLabelText('Type the project name to delete it');
    fireEvent.change(box, { target: { value: 'old' } });
    expect(del.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(box, { target: { value: '  OLD JOB ' } });
    expect(del.getAttribute('aria-disabled')).toBeNull();
  });

  it('deletes, names to-dos that failed, and returns to the list', async () => {
    await open({}, { todos: TODOS.slice(0, 1) });
    fireEvent.change(await screen.findByLabelText('Type the project name to delete it'), {
      target: { value: 'Old job' },
    });
    api.removeProject.mockResolvedValue({
      list: projectList([LIVE], { canArchive: true }),
      key: OLD.key,
      todosChanged: 0,
      todosFailed: ['mine'],
    });
    press('Delete');
    await waitFor(() =>
      expect(api.removeProject).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'delete',
          key: OLD.key,
          filesExpect: 'fv1',
          todos: [{ id: 'mine', scope: 'tds', version: 'a', do: 'delete' }],
        }),
      ),
    );
    expect(await screen.findByText(/Deleted Old job\./)).toBeTruthy();
    expect(screen.getByText(/1 to-do couldn't be changed \(mine\)/)).toBeTruthy();
  });

  it('cancels with Escape', async () => {
    await open();
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(screen.queryByLabelText('Type the project name to delete it')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' })));
    expect(api.removeProject).not.toHaveBeenCalled();
  });

  it('mentions files left behind after a delete', async () => {
    await open();
    fireEvent.change(await screen.findByLabelText('Type the project name to delete it'), {
      target: { value: 'Old job' },
    });
    api.removeProject.mockResolvedValue({
      list: projectList([LIVE], { canArchive: true }),
      key: OLD.key,
      todosChanged: 0,
      todosFailed: [],
      leftBehind: '.trash/old',
    });
    press('Delete');
    expect(
      await screen.findByText(/couldn't be removed and are hidden in \.trash\/old on this Mac/),
    ).toBeTruthy();
  });

  it('checks again when a listed to-do changed', async () => {
    await open({}, { todos: TODOS.slice(0, 1) });
    fireEvent.change(await screen.findByLabelText('Type the project name to delete it'), {
      target: { value: 'Old job' },
    });
    api.removeProject.mockRejectedValueOnce(new ApiFailure('bad-request', 'A to-do changed.', 400));
    const calls = api.checkProjectRemove.mock.calls.length;
    press('Delete');
    expect(await screen.findByText('Something changed, so the list has been checked again.')).toBeTruthy();
    await waitFor(() => expect(api.checkProjectRemove.mock.calls.length).toBeGreaterThan(calls));
  });
});
