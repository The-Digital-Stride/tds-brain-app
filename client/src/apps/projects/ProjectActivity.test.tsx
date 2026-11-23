// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectActivityResponse } from '../../../../shared/project-activity-contract.ts';
import { card, projectList } from './testing.ts';

const store = vi.hoisted(() => ({
  newChat: vi.fn(),
  changeTodos: vi.fn(),
  toggleFavouriteTodo: vi.fn(),
  boot: {
    identity: { slug: 'me' },
    clients: [] as { slug: string; name: string }[],
    prefs: { favouriteTodos: [] as string[] },
  },
  todos: { mine: [], open: [], othersCount: 0, team: [{ slug: 'me', name: 'Me' }], canProject: true },
}));
const dispatch = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => ({
  projects: vi.fn(),
  changeProject: vi.fn(),
  projectFiles: vi.fn(),
  projectTodos: vi.fn(),
  projectUpdates: vi.fn(),
  projectActivity: vi.fn(),
  projectSeen: vi.fn(),
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
vi.mock('../../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ dispatch, state: { todoPanel: null }, modes: { drawerOverlays: false } }),
}));

const { ProjectsSheet } = await import('./ProjectsSheet.tsx');
const { projectsStore } = await import('../../state/projects.ts');
const { ShellContext } = await import('../../shell/shell-context.ts');
const shellValue = { dispatch, sheetHold: { dirty: false }, guardLeave: (go: () => void) => go() } as never;

const SKY = card({ slug: 'site', title: 'Sky site', owner: 'me', version: 'v1' });
const OTHER = card({ slug: 'other', title: 'Other site', owner: 'me', version: 'v2' });

const reply = (over: Partial<ProjectActivityResponse> = {}): ProjectActivityResponse => ({
  since: '2026-11-20T09:00:00Z',
  token: 'tok-1',
  items: [],
  more: 0,
  comingUp: [],
  ...over,
});

beforeEach(() => {
  api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
  api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
  api.projectUpdates.mockResolvedValue({ updates: [], more: false, unreadable: 0, canAdd: true });
  api.projectActivity.mockResolvedValue(reply());
  api.projectSeen.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  projectsStore.reset();
  vi.clearAllMocks();
});

async function openProject(c = SKY, others = [OTHER]) {
  const list = projectList([c, ...others]);
  api.projects.mockResolvedValue(list);
  projectsStore.apply(list);
  render(
    <ShellContext.Provider value={shellValue}>
      <ProjectsSheet />
    </ShellContext.Provider>,
  );
  await screen.findByText(/of \d+ project/);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(c.title) }));
}

describe('activity on the Overview', () => {
  it('shows both cards with their empty lines', async () => {
    await openProject();
    expect(await screen.findByRole('heading', { name: 'Since you last looked' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Coming up' })).toBeTruthy();
    expect(await screen.findByText('Nothing new since you last looked.')).toBeTruthy();
    expect(screen.getByText('Nothing due in the next two weeks.')).toBeTruthy();
    expect(api.projectActivity).toHaveBeenCalledWith(SKY.key);
  });

  it('says changes will show from the next visit on a first visit', async () => {
    api.projectActivity.mockResolvedValue(reply({ since: null }));
    await openProject();
    expect(await screen.findByText('Changes will show here from your next visit.')).toBeTruthy();
  });

  it('opens a to-do in the panel and an update on the Updates tab', async () => {
    api.projectActivity.mockResolvedValue(
      reply({
        items: [
          {
            kind: 'todo-added',
            text: 'To-do added: Send the quote',
            at: null,
            byName: null,
            target: { kind: 'todo', key: 'todo/a.md' },
          },
          {
            kind: 'update',
            text: 'Sam Taylor added a note',
            at: '2026-11-22T10:00:00Z',
            byName: 'Sam Taylor',
            target: { kind: 'updates' },
          },
        ],
        more: 3,
        comingUp: [
          {
            kind: 'todo-due',
            text: 'Send the invoice',
            date: '2026-11-21',
            overdue: true,
            target: { kind: 'todo', key: 'todo/b.md' },
          },
        ],
      }),
    );
    await openProject();
    await screen.findByText('Send the invoice');
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('21 Nov 2026')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Send the quote/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'open-todo', key: 'todo/a.md', mode: 'read' });

    fireEvent.click(screen.getByRole('button', { name: /Sam Taylor added a note/ }));
    expect(await screen.findByText('No updates yet.')).toBeTruthy();
  });

  it('shows five changes, then the shared Show more, and says where the rest are', async () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      kind: 'todo-added' as const,
      text: `To-do added: Task ${i + 1}`,
      at: null,
      byName: null,
      target: { kind: 'todo' as const, key: `todo/${i}.md` },
    }));
    api.projectActivity.mockResolvedValue(reply({ items, more: 3 }));
    await openProject();
    await screen.findByText('To-do added: Task 5');
    expect(screen.queryByText('To-do added: Task 6')).toBeNull();
    expect(screen.queryByText(/more changes are on/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more changes' }));
    expect(screen.getByText('To-do added: Task 7')).toBeTruthy();
    expect(screen.getByText('3 more changes are on the To-dos, Updates and Files tabs.')).toBeTruthy();
  });

  it('the end date row is not a button and does not lift; Coming up hides when the read fails', async () => {
    api.projectActivity.mockResolvedValueOnce(
      reply({
        comingUp: [
          { kind: 'project-end', text: 'Project end date', date: '2026-12-02', overdue: false, target: null },
        ],
      }),
    );
    await openProject();
    const row = (await screen.findByText('Project end date')).closest('.line');
    expect(row?.tagName).toBe('DIV');
    expect(row?.classList.contains('proj-static')).toBe(true);
    cleanup();
    api.projectActivity.mockRejectedValue(new Error('nope'));
    await openProject();
    await screen.findByText("Couldn't read what's changed.");
    expect(screen.queryByRole('heading', { name: 'Coming up' })).toBeNull();
  });

  it('never puts a dot on the Overview tab (a tab dot means a problem)', async () => {
    await openProject();
    await screen.findByText('Nothing new since you last looked.');
    expect(screen.getByRole('button', { name: /^Overview/ }).querySelector('.dot')).toBeNull();
  });
});

describe('marking it seen', () => {
  it('posts the token when the person leaves, never on open', async () => {
    await openProject();
    await screen.findByText('Nothing new since you last looked.');
    expect(api.projectSeen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    await waitFor(() => expect(api.projectSeen).toHaveBeenCalledWith({ key: SKY.key, token: 'tok-1' }));
    expect(api.projectSeen).toHaveBeenCalledTimes(1);
  });

  it('keeps the token across tab switches: one read, and that read is the one marked seen', async () => {
    await openProject();
    await screen.findByText('Nothing new since you last looked.');
    fireEvent.click(screen.getByRole('button', { name: 'Updates' }));
    await screen.findByText('No updates yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    await screen.findByText('Nothing new since you last looked.');
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    await waitFor(() => expect(api.projectSeen).toHaveBeenCalledWith({ key: SKY.key, token: 'tok-1' }));
    expect(api.projectActivity).toHaveBeenCalledTimes(1);
  });

  it('does not post when the card was never shown', async () => {
    let resolve: (r: ProjectActivityResponse) => void = () => {};
    api.projectActivity.mockReturnValue(new Promise((r) => (resolve = r)));
    await openProject();
    fireEvent.click(await screen.findByRole('button', { name: 'Updates' }));
    resolve(reply());
    await screen.findByText('No updates yet.');
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.projectSeen).not.toHaveBeenCalled();
  });
});
