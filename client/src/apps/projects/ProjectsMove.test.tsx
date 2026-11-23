// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectChoice } from '../../state/client-choice.ts';
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
  projectFiles: vi.fn(),
  projectTodos: vi.fn(),
}));
vi.mock('../../api.ts', () => ({
  api,
  ApiFailure: class ApiFailure extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));

const { ProjectsSheet } = await import('./ProjectsSheet.tsx');
const { projectsStore } = await import('../../state/projects.ts');
const { ApiFailure } = await import('../../api.ts');

const SKY = card({ slug: 'site', title: 'Sky site', owner: 'me', version: 'v1' });
const MINE = card({ slug: 'taxes', client: null, title: 'Taxes', owner: 'me', version: 'v9' });

beforeEach(() => {
  store.boot.clients = [
    { slug: 'skyseal', name: 'Skyseal' },
    { slug: 'acme', name: 'Acme Heating' },
  ];
  api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
  api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
});
afterEach(() => {
  cleanup();
  projectsStore.reset();
  projectChoice.set('');
  vi.clearAllMocks();
});

async function show(list: ReturnType<typeof projectList>) {
  api.projects.mockResolvedValue(list);
  projectsStore.apply(list);
  render(<ProjectsSheet />);
  await screen.findByText(/of \d+ project/);
}
const open = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const pickClient = (label: string, name: string) => {
  const box = screen.getByRole('combobox', { name: label });
  fireEvent.mouseDown(box);
  fireEvent.click(box);
  fireEvent.click(screen.getByRole('option', { name: new RegExp(name) }));
};

describe('the create form: who is it for', () => {
  it('starts on A client, hides the picker for Just me, and sends personal', async () => {
    await show(projectList([SKY]));
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    const client = screen.getByRole('radio', { name: 'A client' });
    expect(client.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('The team can see it.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Choose a client.')).toBeTruthy();
    expect(api.changeProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: 'Just me' }));
    expect(screen.queryByRole('combobox', { name: 'Client' })).toBeNull();
    expect(screen.getByText('Only you can see it. You can move it to a client later.')).toBeTruthy();
    expect(screen.queryByText('Choose a client.')).toBeNull();
    api.changeProject.mockResolvedValue(projectList([SKY, MINE]));
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() =>
      expect(api.changeProject).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'create', space: 'personal', slug: 'my-notes' }),
      ),
    );
    expect(api.changeProject.mock.calls[0]?.[0]).not.toHaveProperty('client');
  });

  it('offers clients only, and sends the chosen client', async () => {
    await show(projectList([SKY]));
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Boiler' } });
    const box = screen.getByRole('combobox', { name: 'Client' });
    fireEvent.mouseDown(box);
    fireEvent.click(box);
    expect(screen.queryByRole('option', { name: /Personal/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Acme Heating/ }));
    api.changeProject.mockResolvedValue(projectList([SKY]));
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() =>
      expect(api.changeProject).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'create', space: 'client', client: 'acme', slug: 'boiler' }),
      ),
    );
  });
});

describe('the edit form: client is read-only', () => {
  it('shows the client and Move when the brain can move projects', async () => {
    await show(projectList([SKY], { canMove: true }));
    open(/Sky site/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Skyseal')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Client' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move' })).toBeTruthy();
  });

  it('says to update the skills without canMove', async () => {
    await show(projectList([SKY]));
    open(/Sky site/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
    expect(screen.getByText("Update the brain's skills to move projects.")).toBeTruthy();
  });

  it('explains a legacy project and says Just me for a personal one', async () => {
    const legacy = card({ slug: 'old', title: 'Old one', owner: 'me', space: 'legacy', client: null });
    await show(projectList([legacy, MINE], { canMove: true }));
    open(/Old one/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
    expect(
      screen.getByText("This project is in the old projects folder, so it can't be moved."),
    ).toBeTruthy();
    cleanup();
    projectsStore.reset();
    await show(projectList([MINE], { canMove: true }));
    open(/Taxes/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Just me')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move' })).toBeTruthy();
  });

  it('asks before leaving a changed form for the move screen', async () => {
    await show(projectList([SKY], { canMove: true }));
    open(/Sky site/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Sky site 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('heading', { name: 'Move Sky site' })).toBeTruthy();
  });
});

describe('the Overview Client row', () => {
  it('has a Move button only when the project can move', async () => {
    await show(projectList([SKY], { canMove: true }));
    open(/Sky site/);
    expect(screen.getByRole('button', { name: /Move Sky site to another client/ })).toBeTruthy();
    cleanup();
    projectsStore.reset();
    await show(projectList([SKY]));
    open(/Sky site/);
    expect(screen.queryByRole('button', { name: /Move Sky site/ })).toBeNull();
  });
});

describe('the move screen', () => {
  const FILES = 'a'.repeat(64);
  const CLEAN_CHECK = {
    key: 'acme/site',
    files: [],
    fileCount: 0,
    ignoredCount: 0,
    personalLinks: [],
    filesVersion: FILES,
  };
  const toMove = async (c: ReturnType<typeof card>) => {
    await show(projectList([c], { canMove: true }));
    open(new RegExp(c.title));
    fireEvent.click(screen.getByRole('button', { name: /Move .* to another client/ }));
    expect(screen.getByRole('heading', { name: `Move ${c.title}` })).toBeTruthy();
  };

  it('offers other clients only, never personal', async () => {
    await toMove(SKY);
    const box = screen.getByRole('combobox', { name: 'Move to' });
    fireEvent.mouseDown(box);
    fireEvent.click(box);
    expect(screen.getByRole('option', { name: /Acme Heating/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Skyseal/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Personal/ })).toBeNull();
  });

  it('confirms personal to client, lists files, and sends dropPersonal', async () => {
    await toMove(MINE);
    api.checkProjectMove.mockResolvedValue({
      todos: 1,
      check: {
        key: 'acme/taxes',
        files: Array.from({ length: 12 }, (_, i) => `personal/projects/taxes/f${i + 1}.md`),
        fileCount: 12,
        ignoredCount: 2,
        personalLinks: ['personal/notes/a.md'],
        filesVersion: FILES,
      },
    });
    pickClient('Move to', 'Acme Heating');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const ask = await screen.findByRole('group', { name: 'Move this project to Acme Heating?' });
    expect(api.checkProjectMove).toHaveBeenCalledWith({
      key: 'personal/taxes',
      client: 'acme',
      expect: 'v9',
    });
    expect(within(ask).getByText(/shared with the team: 12 files\./)).toBeTruthy();
    expect(within(ask).getByText('f1.md')).toBeTruthy();
    expect(within(ask).getByText('f10.md')).toBeTruthy();
    expect(within(ask).queryByText('f11.md')).toBeNull();
    expect(within(ask).getByText('and 2 more')).toBeTruthy();
    expect(
      within(ask).getByText(/^2 files won't be shared, because the brain doesn't sync files of that type/),
    ).toBeTruthy();
    expect(within(ask).getByText(/You can't make it personal again/)).toBeTruthy();
    expect(
      within(ask).getByText(/1 personal file added from outside this project will be removed from it/),
    ).toBeTruthy();
    expect(within(ask).getByText(/Ask the team to sync first/)).toBeTruthy();
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Cancel' }));

    const moved = card({ slug: 'taxes', client: 'acme', title: 'Taxes', owner: 'me', version: 'v10' });
    api.moveProject.mockResolvedValue({
      list: projectList([moved], { canMove: true }),
      key: 'acme/taxes',
      todosMoved: 1,
      todosLeft: 0,
    });
    fireEvent.click(within(ask).getByRole('button', { name: 'Move to Acme Heating' }));
    await waitFor(() =>
      expect(api.moveProject).toHaveBeenCalledWith({
        key: 'personal/taxes',
        client: 'acme',
        expect: 'v9',
        dropPersonal: true,
        filesExpect: FILES,
      }),
    );
  });

  it('confirms client to client with the to-do count, then opens the new key and announces it', async () => {
    projectChoice.set('skyseal/site');
    await toMove(SKY);
    api.checkProjectMove.mockResolvedValue({
      todos: 3,
      check: CLEAN_CHECK,
    });
    pickClient('Move to', 'Acme Heating');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const ask = await screen.findByRole('group', { name: 'Move this project to Acme Heating?' });
    expect(
      within(ask).getByText('Its folder moves from Skyseal to Acme Heating. 3 open to-dos move with it.'),
    ).toBeTruthy();
    const moved = card({ slug: 'site', client: 'acme', title: 'Sky site', owner: 'me', version: 'v2' });
    api.moveProject.mockResolvedValue({
      list: projectList([moved], { canMove: true }),
      key: 'acme/site',
      todosMoved: 3,
      todosLeft: 0,
    });
    fireEvent.click(within(ask).getByRole('button', { name: 'Move to Acme Heating' }));
    expect(await screen.findByRole('heading', { name: 'Sky site' })).toBeTruthy();
    expect(api.moveProject.mock.calls[0]?.[0]).not.toHaveProperty('dropPersonal');
    expect(api.moveProject.mock.calls[0]?.[0]).toMatchObject({ filesExpect: FILES });
    // The sheet sets the words a moment later, so a repeat of the same words is still read out.
    await waitFor(() =>
      expect(screen.getByRole('status', { name: '' }).textContent).toBe(
        'Moved to Acme Heating. 3 to-dos moved with it.',
      ),
    );
    expect(projectChoice.get().project).toBe('acme/site');
  });

  it('says plainly when the client already has that folder name', async () => {
    await toMove(SKY);
    api.checkProjectMove.mockRejectedValue(new ApiFailure('exists' as never, 'x', 409));
    pickClient('Move to', 'Acme Heating');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Acme Heating already has a project with the folder name site.',
    );
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('Esc cancels the confirm and goes back to the project', async () => {
    await toMove(SKY);
    api.checkProjectMove.mockResolvedValue({
      todos: 0,
      check: CLEAN_CHECK,
    });
    pickClient('Move to', 'Acme Heating');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const ask = await screen.findByRole('group', { name: /Move this project/ });
    fireEvent.keyDown(within(ask).getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(await screen.findByRole('heading', { name: 'Sky site' })).toBeTruthy();
    expect(api.moveProject).not.toHaveBeenCalled();
  });

  it('Esc on the picker cancels and goes back to the project', async () => {
    await toMove(SKY);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Continue' }), { key: 'Escape' });
    expect(await screen.findByRole('heading', { name: 'Sky site' })).toBeTruthy();
    expect(api.checkProjectMove).not.toHaveBeenCalled();
  });

  it("says 1 file won't be shared, in the singular", async () => {
    await toMove(MINE);
    api.checkProjectMove.mockResolvedValue({
      todos: 0,
      check: { ...CLEAN_CHECK, key: 'acme/taxes', fileCount: 3, ignoredCount: 1 },
    });
    pickClient('Move to', 'Acme Heating');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const ask = await screen.findByRole('group', { name: /Move this project/ });
    expect(within(ask).getByText(/^1 file won't be shared/)).toBeTruthy();
  });

  it("drops the stale check when the move is refused as changed, so it's checked again", async () => {
    await toMove(SKY);
    api.checkProjectMove.mockResolvedValue({ todos: 0, check: CLEAN_CHECK });
    pickClient('Move to', 'Acme Heating');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const ask = await screen.findByRole('group', { name: /Move this project/ });
    const words = 'The files in this project changed since you checked. Check again.';
    api.moveProject.mockRejectedValue(new ApiFailure('changed' as never, words, 409));
    fireEvent.click(within(ask).getByRole('button', { name: 'Move to Acme Heating' }));
    expect((await screen.findByRole('alert')).textContent).toBe(words);
    expect(screen.queryByRole('group')).toBeNull();
    const again = screen.getByRole('button', { name: 'Continue' });
    expect(document.activeElement).toBe(again);
    // The client stays chosen: Continue checks again.
    api.checkProjectMove.mockResolvedValue({
      todos: 0,
      check: { ...CLEAN_CHECK, filesVersion: 'b'.repeat(64) },
    });
    fireEvent.click(again);
    const next = await screen.findByRole('group', { name: 'Move this project to Acme Heating?' });
    expect(api.checkProjectMove).toHaveBeenCalledTimes(2);
    api.moveProject.mockResolvedValue({
      list: projectList([card({ slug: 'site', client: 'acme', title: 'Sky site', owner: 'me' })], {
        canMove: true,
      }),
      key: 'acme/site',
      todosMoved: 0,
      todosLeft: 0,
    });
    fireEvent.click(within(next).getByRole('button', { name: 'Move to Acme Heating' }));
    await waitFor(() => expect(api.moveProject).toHaveBeenCalledTimes(2));
    expect(api.moveProject.mock.calls[1]?.[0]).toMatchObject({ filesExpect: 'b'.repeat(64) });
  });

  it('keeps the usual words for a card that changed', async () => {
    await toMove(SKY);
    api.checkProjectMove.mockRejectedValue(
      new ApiFailure('changed' as never, 'Someone else changed it.', 409),
    );
    pickClient('Move to', 'Acme Heating');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Someone changed this project while you were looking at it. Reload to see the latest version.',
    );
    expect(screen.queryByRole('group')).toBeNull();
  });
});
