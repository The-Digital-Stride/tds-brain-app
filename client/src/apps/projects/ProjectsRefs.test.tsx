// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { card, projectList } from './testing.ts';

const store = vi.hoisted(() => ({
  libraryVersion: 0,
  hiddenFileIds: new Set<string>(),
  deleteFile: vi.fn(),
  toggleFavouriteFile: vi.fn(),
  newChat: vi.fn(),
  changeTodos: vi.fn(),
  boot: {
    identity: { slug: 'me' },
    clients: [] as { slug: string; name: string }[],
    prefs: { favouriteFiles: [] as string[] },
  },
  todos: { mine: [], open: [], othersCount: 0, team: [{ slug: 'me', name: 'Me Myself' }], canProject: true },
}));
const api = vi.hoisted(() => ({
  projects: vi.fn(),
  changeProject: vi.fn(),
  projectFiles: vi.fn(),
  projectTodos: vi.fn(),
  projectArtifact: vi.fn(),
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
vi.mock('../../shell/ShellProvider.tsx', () => ({ useShell: () => ({ dispatch: vi.fn() }) }));

const { ProjectsSheet } = await import('./ProjectsSheet.tsx');
const { projectsStore } = await import('../../state/projects.ts');
const { ApiFailure } = await import('../../api.ts');

const clip = vi.hoisted(() => ({ writeText: vi.fn(async (_: string) => {}) }));

const mk = (over = {}) =>
  card({ slug: 'site', title: 'Sky site', owner: 'me', ref: 'SKY4K7', refState: 'ok', ...over });

async function openProject(project = mk(), over: Parameters<typeof projectList>[1] = { canRef: true }) {
  const list = projectList([project], over);
  api.projects.mockResolvedValue(list);
  projectsStore.apply(list);
  render(<ProjectsSheet />);
  await screen.findByText(/of \d+ project/);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(project.title) }));
  await screen.findByRole('region', { name: 'Details' });
}

beforeEach(() => {
  store.boot.clients = [{ slug: 'skyseal', name: 'Skyseal' }];
  api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
  api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
  Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
});
afterEach(() => {
  cleanup();
  projectsStore.reset();
  vi.clearAllMocks();
});

describe('project code on the Overview', () => {
  it('shows the code and Copy copies it with brackets (ok)', async () => {
    await openProject();
    expect(screen.getByText('SKY4K7')).toBeTruthy();
    expect(screen.getByText(/Put this in the meeting invite or the email subject/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy code SKY4K7' }));
    await waitFor(() => expect(clip.writeText).toHaveBeenCalledWith('[SKY4K7]'));
    expect(await screen.findByRole('button', { name: 'Copy code SKY4K7' })).toHaveProperty(
      'textContent',
      'Copied',
    );
  });

  it('a duplicate shows plain text: no Copy, no help line, no buttons without canRef', async () => {
    await openProject(mk({ refState: 'duplicate', refDuplicateOf: ['skyseal/other'] }), {});
    expect(screen.getByText('SKY4K7')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull();
    expect(screen.queryByText(/Put this in the meeting invite/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make a new code' })).toBeNull();
  });

  it('missing: Make a code sends the ref action with the card version', async () => {
    api.changeProject.mockResolvedValue(projectList([mk()], { canRef: true }));
    await openProject(mk({ ref: null, refState: 'missing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make a code' }));
    await waitFor(() =>
      expect(api.changeProject).toHaveBeenCalledWith({ kind: 'ref', key: 'skyseal/site', expect: 'v1' }),
    );
  });

  it('missing: no button without canRef or when archived', async () => {
    await openProject(mk({ ref: null, refState: 'missing' }), {});
    expect(screen.queryByRole('button', { name: 'Make a code' })).toBeNull();
    cleanup();
    projectsStore.reset();
    api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
    api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
    const list = projectList([mk({ ref: null, refState: 'missing', archived: true })], { canRef: true });
    api.projects.mockResolvedValue(list);
    projectsStore.apply(list);
    render(<ProjectsSheet />);
    fireEvent.click(await screen.findByRole('button', { name: '1 archived' }));
    fireEvent.click(await screen.findByRole('button', { name: /Sky site/ }));
    await screen.findByRole('region', { name: 'Details' });
    expect(screen.queryByRole('button', { name: 'Make a code' })).toBeNull();
  });

  it('no-client-code: a plain note, no button', async () => {
    await openProject(mk({ ref: null, refState: 'no-client-code' }));
    expect(screen.getByText('Add a client code first')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /code/i })).toBeNull();
  });

  it('personal or no refState: nothing', async () => {
    await openProject(mk({ refState: 'personal' }));
    expect(screen.queryByText('Project code')).toBeNull();
    cleanup();
    projectsStore.reset();
    api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
    api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
    await openProject(card({ slug: 'site', title: 'Sky site', owner: 'me' }));
    expect(screen.queryByText('Project code')).toBeNull();
  });

  it('duplicate: names the other project and asks before replacing', async () => {
    const other = card({ slug: 'other', title: 'Other site', ref: 'SKY4K7', refState: 'duplicate' });
    const mine = mk({ refState: 'duplicate', refDuplicateOf: [other.key] });
    const list = projectList([mine, other], { canRef: true });
    api.projects.mockResolvedValue(list);
    api.changeProject.mockResolvedValue(list);
    projectsStore.apply(list);
    render(<ProjectsSheet />);
    fireEvent.click(await screen.findByRole('button', { name: /Sky site/ }));
    expect(await screen.findByText(/This code is also used by Other site\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make a new code' }));
    expect(screen.getByText('SKY4K7 will then mean Other site.')).toBeTruthy();
    expect(api.changeProject).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: 'Make a new code' });
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    await waitFor(() =>
      expect(api.changeProject).toHaveBeenCalledWith({
        kind: 'ref',
        key: 'skyseal/site',
        expect: 'v1',
        replace: true,
      }),
    );
  });

  it('shows a refusal in words', async () => {
    api.changeProject.mockRejectedValue(
      new ApiFailure('bad-request', "Add a client code to Skyseal's profile first.", 400),
    );
    await openProject(mk({ ref: null, refState: 'missing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make a code' }));
    expect(await screen.findByText("Add a client code to Skyseal's profile first.")).toBeTruthy();
  });
});

describe('Give projects codes', () => {
  const missing = (slug: string) => mk({ slug, title: `P ${slug}`, ref: null, refState: 'missing' });

  async function openList(over: Parameters<typeof projectList>[1]) {
    const list = projectList([missing('a'), missing('b')], over);
    api.projects.mockResolvedValue(list);
    projectsStore.apply(list);
    render(<ProjectsSheet />);
    await screen.findByText(/of \d+ project/);
    return list;
  }

  it('is hidden unless canRefAll', async () => {
    await openList({ canRef: true });
    expect(screen.queryByRole('button', { name: 'Give projects codes' })).toBeNull();
  });

  it('is hidden when nothing is missing a code', async () => {
    const list = projectList([mk()], { canRef: true, canRefAll: true });
    api.projects.mockResolvedValue(list);
    projectsStore.apply(list);
    render(<ProjectsSheet />);
    await screen.findByText(/of \d+ project/);
    expect(screen.queryByRole('button', { name: 'Give projects codes' })).toBeNull();
  });

  it('sends all:true and says how many got a code', async () => {
    await openList({ canRef: true, canRefAll: true });
    api.changeProject.mockResolvedValue(
      projectList([mk({ slug: 'a', title: 'P a' }), mk({ slug: 'b', title: 'P b', ref: 'SKY4K8' })], {
        canRef: true,
        canRefAll: true,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Give projects codes' }));
    await waitFor(() => expect(api.changeProject).toHaveBeenCalledWith({ kind: 'ref', all: true }));
    expect(await screen.findByText('2 projects were given a code.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Give projects codes' })).toBeNull();
  });
});

describe('Search by code', () => {
  it('finds a project by its code, any case, brackets ignored', async () => {
    const list = projectList([mk(), mk({ slug: 'other', title: 'Other site', ref: 'SKY5M2' })], {
      canRef: true,
    });
    api.projects.mockResolvedValue(list);
    projectsStore.apply(list);
    render(<ProjectsSheet />);
    await screen.findByText(/of \d+ project/);
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: '[sky5m2]' } });
    expect(screen.getByText('Other site')).toBeTruthy();
    expect(screen.queryByText('Sky site')).toBeNull();
  });

  it('offers "Did you mean" for a code one slip away, and picks it', async () => {
    const list = projectList([mk()], { canRef: true });
    api.projects.mockResolvedValue(list);
    projectsStore.apply(list);
    render(<ProjectsSheet />);
    await screen.findByText(/of \d+ project/);
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'SKY4K8' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Did you mean SKY4K7?' }));
    expect(screen.getByText('Sky site')).toBeTruthy();
  });

  it('picking a guess also clears the other filters', async () => {
    const list = projectList([mk({ owner: 'someone' })], { canRef: true });
    api.projects.mockResolvedValue(list);
    projectsStore.apply(list);
    render(<ProjectsSheet />);
    await screen.findByText(/of \d+ project/);
    fireEvent.click(screen.getByRole('radio', { name: 'Mine' }));
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'SKY4K8' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Did you mean SKY4K7?' }));
    expect(screen.getByText('Sky site')).toBeTruthy();
  });

  it('offers nothing for text that is not code-shaped', async () => {
    const list = projectList([mk()], { canRef: true });
    api.projects.mockResolvedValue(list);
    projectsStore.apply(list);
    render(<ProjectsSheet />);
    await screen.findByText(/of \d+ project/);
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'zzzz' } });
    expect(screen.queryByRole('button', { name: /Did you mean/ })).toBeNull();
  });
});
