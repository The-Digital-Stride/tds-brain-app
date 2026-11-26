// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIBRARY_UPLOAD_MESSAGES,
  type LibraryUploadResponse,
} from '../../../../shared/library-upload-contract.ts';
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
  libraryUpload: vi.fn(),
}));
const uploadFile = vi.hoisted(() => vi.fn());
const discardUpload = vi.hoisted(() => vi.fn());
vi.mock('../../api.ts', () => ({
  api,
  uploadFile,
  discardUpload,
  ApiFailure: class ApiFailure extends Error {},
}));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));
vi.mock('../../shell/ShellProvider.tsx', () => ({ useShell: () => ({ dispatch: vi.fn() }) }));

const { ProjectsSheet } = await import('./ProjectsSheet.tsx');
const { projectsStore } = await import('../../state/projects.ts');

const SKY = card({ slug: 'site', title: 'Sky site', owner: 'me', version: 'v1' });
const KEY = 'skyseal/site';

async function openFiles(project = SKY, over: Parameters<typeof projectList>[1] = { canUploadFiles: true }) {
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

function saved(over: Partial<LibraryUploadResponse> = {}): LibraryUploadResponse {
  return {
    path: 'clients/skyseal/files/a.pdf',
    kind: 'document',
    scope: 'client:skyseal',
    personal: false,
    ...over,
  };
}
const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' });
const input = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const pick = (...files: File[]) => fireEvent.change(input(), { target: { files } });
const UPLOAD = 'Upload to Sky site';
let n = 0;

beforeEach(() => {
  n = 0;
  store.boot.clients = [{ slug: 'skyseal', name: 'Skyseal' }];
  api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
  api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
  uploadFile.mockImplementation(async (_f: File, name: string) => ({ id: `u${++n}`, name }));
});
afterEach(() => {
  cleanup();
  projectsStore.reset();
  vi.clearAllMocks();
});

describe("Upload on a project's Files tab", () => {
  it('is hidden unless the server says files can be uploaded', async () => {
    await openFiles(SKY, {});
    await screen.findByRole('button', { name: 'Add files' });
    expect(screen.queryByRole('button', { name: /^Upload/ })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('is hidden on an archived project, a project with no card, a legacy one and a read-only list', async () => {
    const cases: [Partial<ReturnType<typeof card>>, Parameters<typeof projectList>[1]][] = [
      [{ archived: true }, { canUploadFiles: true }],
      [{ card: 'none' }, { canUploadFiles: true }],
      [{ space: 'legacy' }, { canUploadFiles: true }],
      [{}, { canUploadFiles: true, canChange: false }],
    ];
    for (const [cardOver, listOver] of cases) {
      await openFiles(card({ slug: 'site', title: 'Sky site', owner: 'me', ...cardOver }), listOver);
      await waitFor(() => expect(api.projectFiles).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: /^Upload/ })).toBeNull();
      cleanup();
      projectsStore.reset();
      vi.clearAllMocks();
      api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
      api.projectTodos.mockResolvedValue({ todos: [], count: 0 });
    }
  });

  it('is a standard small button between Add files and Add a claude.ai page, with its input after the last button', async () => {
    await openFiles(SKY, { canUploadFiles: true, canAddArtifact: true });
    const upload = await screen.findByRole('button', { name: UPLOAD });
    expect(upload.getAttribute('data-size')).toBe('small');
    expect(upload.getAttribute('data-variant')).toBeNull();
    const row = document.querySelector('.proj-tabrow') as HTMLElement;
    const buttons = [...row.querySelectorAll(':scope > .btn')].map((b) => b.textContent);
    expect(buttons).toEqual(['Add files', 'Upload to Sky site', 'Add a claude.ai page']);
    expect(row.lastElementChild).toBe(input());
    expect(input().accept).toContain('.png');
  });

  it('sends the project and its version, applies the list, and says where it went in the status line', async () => {
    const fresh = projectList([{ ...SKY, version: 'v2' }], { canUploadFiles: true });
    api.libraryUpload.mockResolvedValue(saved({ linked: true, list: fresh }));
    await openFiles();
    await screen.findByRole('button', { name: UPLOAD });
    pick(pdf('a.pdf'));
    await waitFor(() =>
      expect(document.querySelector('.lib-note[role="status"]')?.textContent).toBe(
        "Added a.pdf to Sky site. Saved in Skyseal's Documents.",
      ),
    );
    expect(api.libraryUpload).toHaveBeenCalledWith({ upload: 'u1', project: KEY, expect: 'v1' });
    expect(projectsStore.get().list).toBe(fresh);
    expect(document.querySelector('.lib-note[role="status"]')?.getAttribute('role')).toBe('status');
  });

  it('keeps the button aria-disabled while it works, and keeps focus there', async () => {
    let release: () => void = () => {};
    api.libraryUpload.mockImplementation(
      () =>
        new Promise((r) => {
          release = () =>
            r(
              saved({
                linked: true,
                list: projectList([{ ...SKY, version: 'v2' }], { canUploadFiles: true }),
              }),
            );
        }),
    );
    await openFiles();
    const button = await screen.findByRole('button', { name: UPLOAD });
    button.focus();
    pick(pdf('a.pdf'));
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
    expect(document.querySelector('.lib-note[role="status"]')?.textContent).toBe('Adding a.pdf…');
    expect(document.activeElement).toBe(button);
    await act(async () => release());
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it('shows saved-but-not-linked as a warning notice and stops', async () => {
    const problem = LIBRARY_UPLOAD_MESSAGES.savedNotLinked("Skyseal's Documents");
    api.libraryUpload.mockResolvedValue(saved({ linked: false, problem }));
    await openFiles();
    await screen.findByRole('button', { name: UPLOAD });
    pick(pdf('a.pdf'), pdf('b.pdf'));
    const warn = await screen.findByRole('alert');
    expect(warn.getAttribute('data-level')).toBe('warn');
    expect(warn.textContent).toBe(problem);
    expect(api.libraryUpload).toHaveBeenCalledTimes(1);
  });

  it('shows a failure as an error notice that names the file', async () => {
    api.libraryUpload.mockRejectedValue(new Error('No.'));
    await openFiles();
    await screen.findByRole('button', { name: UPLOAD });
    pick(pdf('x.pdf'));
    const err = await screen.findByRole('alert');
    expect(err.getAttribute('data-level')).toBe('error');
    expect(err.textContent).toBe('"x.pdf" couldn\'t be added: No.');
    expect(discardUpload).toHaveBeenCalledWith('u1');
  });
});
