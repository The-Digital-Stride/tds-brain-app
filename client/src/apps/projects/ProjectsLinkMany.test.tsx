// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarySearchHit } from '../../../../shared/contract.ts';
import { PROJECT_LINKS_MAX } from '../../../../shared/projects-contract.ts';
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
  fireEvent.click(await screen.findByRole('button', { name: 'Add files' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search files to add' }), {
    target: { value: 'sky' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByRole('checkbox', { name: /^a\.md/ });
}

/** The list the server answers after a link: the card with its new version. */
const answered = (version: string) =>
  projectList([card({ slug: 'site', title: 'Sky site', owner: 'me', version })]);

describe('Add files: several at once', () => {
  it('links every ticked file in one go, each building on the card the last one wrote', async () => {
    await openPicker();
    api.changeProject.mockResolvedValueOnce(answered('v2')).mockResolvedValueOnce(answered('v3'));
    fireEvent.click(box('a'));
    fireEvent.click(box('b'));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 files' }));
    await screen.findByText('Added 2 files.');
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
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 files' }));
    await screen.findByText(/^Added 1 of 2\./);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add file' })).toBeTruthy());
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
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search files to add' }), {
      target: { value: 'dee' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /^d\.md/ }));
    api.changeProject.mockResolvedValueOnce(answered('v2')).mockResolvedValueOnce(answered('v3'));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 files' }));
    await screen.findByText('Added 2 files.');
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
    expect(screen.getByRole('button', { name: 'Add file' })).toBeTruthy();
  });
});

describe('a file row on the Files tab', () => {
  const item = {
    id: 'tds.f1',
    kind: 'document',
    name: 'plan.docx',
    title: 'Launch plan',
    path: 'clients/skyseal/projects/site/plan.docx',
    format: 'doc',
    ext: 'docx',
    bytes: 1000,
    group: 'Projects',
    view: 'html',
    thumb: false,
    modified: 1,
  };

  it('has an X icon button named for the file, with a tooltip, and focus moves on after removal', async () => {
    const linked = card({ slug: 'site', title: 'Sky site', owner: 'me', links: [item.path] });
    api.projectFiles.mockImplementation(async (_k: string, kind: string) =>
      kind === 'document' ? { items: [item], hidden: 0 } : { items: [], hidden: 0 },
    );
    const list = projectList([linked]);
    api.projects.mockResolvedValue(list);
    projectsStore.apply(list);
    render(<ProjectsSheet />);
    await screen.findByText(/of \d+ project/);
    fireEvent.click(screen.getByRole('button', { name: /Sky site/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    const remove = await screen.findByRole('button', { name: 'Remove Launch plan from this project' });
    expect(remove.className).toBe('icon-btn lib-delete');
    expect(remove.getAttribute('data-tip')).toBe('Remove from this project. The file stays in the library.');
    expect(remove.textContent).toBe('');
    api.changeProject.mockResolvedValueOnce(
      projectList([card({ slug: 'site', title: 'Sky site', owner: 'me', version: 'v2', links: [] })]),
    );
    api.projectFiles.mockImplementation(async () => ({ items: [], hidden: 0 }));
    fireEvent.click(remove);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Remove Launch plan/ })).toBeNull());
    // The list is now empty, so focus falls back to the summary line above it.
    await waitFor(() => expect(document.activeElement?.hasAttribute('data-lib-summary')).toBe(true));
  });
});
