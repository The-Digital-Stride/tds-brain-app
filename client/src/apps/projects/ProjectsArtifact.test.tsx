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

const SKY = card({ slug: 'site', title: 'Sky site', owner: 'me' });

async function openFiles(project = SKY, over: Parameters<typeof projectList>[1] = {}) {
  const list = projectList([project], over);
  api.projects.mockResolvedValue(list);
  projectsStore.apply(list);
  render(<ProjectsSheet />);
  if (project.archived) fireEvent.click(await screen.findByRole('button', { name: '1 archived' }));
  else await screen.findByText(/of \d+ project/);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(project.title) }));
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  await waitFor(() => expect(api.projectFiles).toHaveBeenCalled());
}

beforeEach(() => {
  store.boot.clients = [{ slug: 'skyseal', name: 'Skyseal' }];
  api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
  api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
});
afterEach(() => {
  cleanup();
  projectsStore.reset();
  vi.clearAllMocks();
});

const ADD = 'Add a claude.ai page';

describe('Add a claude.ai page', () => {
  it('is hidden unless the server says it can be added', async () => {
    await openFiles();
    await screen.findByRole('button', { name: 'Add files' });
    expect(screen.queryByRole('button', { name: ADD })).toBeNull();
  });

  it('is hidden on an archived project, a project with no card, and a legacy one', async () => {
    for (const over of [{ archived: true }, { card: 'none' as const }, { space: 'legacy' as const }]) {
      await openFiles(card({ slug: 'site', title: 'Sky site', owner: 'me', ...over }), {
        canAddArtifact: true,
      });
      await waitFor(() => expect(api.projectFiles).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: ADD })).toBeNull();
      cleanup();
      projectsStore.reset();
      vi.clearAllMocks();
      api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
      api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
    }
  });

  it('shows on a live project when allowed, and opens a form with Link and Name', async () => {
    await openFiles(SKY, { canAddArtifact: true });
    fireEvent.click(await screen.findByRole('button', { name: ADD }));
    expect(screen.getByRole('form', { name: ADD })).toBeTruthy();
    expect(screen.getByLabelText('Link')).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Link'));
  });

  it('asks for both fields before it sends anything', async () => {
    await openFiles(SKY, { canAddArtifact: true });
    fireEvent.click(await screen.findByRole('button', { name: ADD }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Paste the artifact link first.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Link'), {
      target: { value: 'https://claude.ai/artifact/AbC123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Give the page a name.')).toBeTruthy();
    expect(api.projectArtifact).not.toHaveBeenCalled();
  });

  it('sends the link and name, reloads the files, announces it and returns focus to the button', async () => {
    api.projectArtifact.mockResolvedValue({
      path: 'clients/skyseal/projects/site/files/q4.html',
      kind: 'link',
    });
    await openFiles(SKY, { canAddArtifact: true });
    fireEvent.click(await screen.findByRole('button', { name: ADD }));
    fireEvent.change(screen.getByLabelText('Link'), {
      target: { value: ' https://claude.ai/artifact/AbC123 ' },
    });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Q4 plan' } });
    const loads = api.projectFiles.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('Added “Q4 plan” to the project.');
    expect(api.projectArtifact).toHaveBeenCalledWith({
      key: SKY.key,
      url: 'https://claude.ai/artifact/AbC123',
      title: 'Q4 plan',
    });
    expect(screen.queryByRole('form', { name: ADD })).toBeNull();
    await waitFor(() => expect(api.projectFiles.mock.calls.length).toBeGreaterThan(loads));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: ADD })));
  });

  it("shows the server's message next to the Link field and keeps what was typed", async () => {
    api.projectArtifact.mockRejectedValue(
      new ApiFailure(
        'bad-request',
        "That isn't a claude.ai artifact link. Copy it from the artifact's Share menu.",
        400,
      ),
    );
    await openFiles(SKY, { canAddArtifact: true });
    fireEvent.click(await screen.findByRole('button', { name: ADD }));
    fireEvent.change(screen.getByLabelText('Link'), {
      target: { value: 'https://claude.ai/artifact/AbC123' },
    });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Thing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const message = await screen.findByText(/isn't a claude\.ai artifact link/);
    const link = screen.getByLabelText('Link');
    expect(link.getAttribute('aria-invalid')).toBe('true');
    expect(link.getAttribute('aria-describedby')).toBe(message.id);
    expect(document.activeElement).toBe(link);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Thing');
  });
});
