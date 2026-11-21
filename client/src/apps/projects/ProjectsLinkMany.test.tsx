// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarySearchHit } from '../../../../shared/contract.ts';
import { PROJECT_LINKS_MAX } from '../../../../shared/projects-contract.ts';
import { card, projectList } from './testing.ts';

const store = vi.hoisted(() => ({
  newChat: vi.fn(),
  changeTodos: vi.fn(),
  boot: { identity: { slug: 'me' }, clients: [] as { slug: string; name: string }[] },
  todos: {
    mine: [],
    open: [],
    othersCount: 0,
    team: [{ slug: 'me', name: 'Me Myself' }],
    canProject: true,
  } as unknown,
}));
const api = vi.hoisted(() => ({
  projects: vi.fn(),
  changeProject: vi.fn(),
  projectFiles: vi.fn(),
  projectTodos: vi.fn(),
  tidy: vi.fn(),
  applyTidy: vi.fn(),
  librarySearch: vi.fn(),
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
vi.mock('../../shell/ShellProvider.tsx', () => ({ useShell: () => ({ dispatch: vi.fn() }) }));

const { ProjectsSheet } = await import('./ProjectsSheet.tsx');
const { projectsStore } = await import('../../state/projects.ts');
const { ApiFailure } = await import('../../api.ts');

const SKY = card({ slug: 'site', title: 'Sky site', owner: 'me' });

function hit(path: string): LibrarySearchHit {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return {
    item: { id: `s.${path}`, kind: 'document', path, name, title: name } as LibrarySearchHit['item'],
    scope: { id: 's', name: 'Skyseal' } as LibrarySearchHit['scope'],
  };
}

beforeEach(() => {
  store.boot.clients = [{ slug: 'skyseal', name: 'Skyseal' }];
  api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
  api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
  api.librarySearch.mockImplementation(async (_q: string, kind: string) => ({
    hits:
      kind === 'document'
        ? [hit('clients/skyseal/a.md'), hit('clients/skyseal/b.md'), hit('personal/notes/c.md')]
        : [],
    total: 3,
    partial: false,
  }));
});
afterEach(() => {
  cleanup();
  projectsStore.reset();
  vi.clearAllMocks();
});

/** A result's tick box: its name is the file's title, then its path. */
const box = (letter: string) => screen.getByRole('checkbox', { name: new RegExp(`^${letter}\\.md`) });

async function openPicker(project = SKY) {
  const list = projectList([project]);
  api.projects.mockResolvedValue(list);
  projectsStore.apply(list);
  render(<ProjectsSheet />);
  await screen.findByText(/of \d+ project/);
  fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Link files' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search files to link' }), {
    target: { value: 'sky' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByRole('checkbox', { name: /^a\.md/ });
}

/** The list the server answers after a link: the card with its new version. */
const answered = (version: string) =>
  projectList([card({ slug: 'site', title: 'Sky site', owner: 'me', version })]);

describe('Link files: several at once', () => {
  it('links every ticked file in one go, each building on the card the last one wrote', async () => {
    await openPicker();
    api.changeProject.mockResolvedValueOnce(answered('v2')).mockResolvedValueOnce(answered('v3'));
    fireEvent.click(box('a'));
    fireEvent.click(box('b'));
    fireEvent.click(screen.getByRole('button', { name: 'Link 2 files' }));
    await screen.findByText('Linked 2 files.');
    expect(api.changeProject.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'link', key: SKY.key, path: 'clients/skyseal/a.md', expect: 'v1' },
      { kind: 'link', key: SKY.key, path: 'clients/skyseal/b.md', expect: 'v2' },
    ]);
  });

  it("won't tick a personal file for a shared project, and says why", async () => {
    await openPicker();
    expect((box('c') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Personal: can't be shared")).toBeTruthy();
  });

  it('keeps the files still to link chosen when one is refused, and says how far it got', async () => {
    await openPicker();
    api.changeProject
      .mockResolvedValueOnce(answered('v2'))
      .mockRejectedValueOnce(
        new ApiFailure('bad-request' as never, 'there is no file at clients/skyseal/b.md', 400),
      );
    fireEvent.click(box('a'));
    fireEvent.click(box('b'));
    fireEvent.click(screen.getByRole('button', { name: 'Link 2 files' }));
    await screen.findByText(/^Linked 1 of 2\./);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Link file' })).toBeTruthy());
    expect(screen.getByRole('list', { name: 'Chosen files' }).textContent).toContain('b.md');
  });

  it('keeps ticks from an earlier search and links them with the new ones', async () => {
    await openPicker();
    fireEvent.click(box('a'));
    api.librarySearch.mockImplementation(async (_q: string, kind: string) => ({
      hits: kind === 'document' ? [hit('clients/skyseal/d.md')] : [],
      total: 1,
      partial: false,
    }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search files to link' }), {
      target: { value: 'dee' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /^d\.md/ }));
    api.changeProject.mockResolvedValueOnce(answered('v2')).mockResolvedValueOnce(answered('v3'));
    fireEvent.click(screen.getByRole('button', { name: 'Link 2 files' }));
    await screen.findByText('Linked 2 files.');
    expect(api.changeProject.mock.calls.map((c) => c[0].path)).toEqual([
      'clients/skyseal/a.md',
      'clients/skyseal/d.md',
    ]);
  });

  it('lets only as many files be ticked as the project has room for', async () => {
    const links = Array.from({ length: PROJECT_LINKS_MAX - 1 }, (_, i) => `clients/skyseal/x${i}.md`);
    await openPicker(card({ slug: 'site', title: 'Sky site', owner: 'me', links }));
    fireEvent.click(box('a'));
    expect((box('b') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(box('b'));
    expect(screen.getByRole('button', { name: 'Link file' })).toBeTruthy();
  });
});
