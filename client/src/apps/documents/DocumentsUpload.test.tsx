// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryUploadResponse } from '../../../../shared/library-upload-contract.ts';
import { card, projectList } from '../projects/testing.ts';
import { doc, listing, SCOPES } from '../shared/testing.ts';

const store = vi.hoisted(() => ({
  newChat: vi.fn(),
  libraryVersion: 0,
  deleteFile: vi.fn(),
  hiddenFileIds: new Set<string>() as ReadonlySet<string>,
  boot: {
    prefs: { lastClient: null as string | null },
    clients: [{ slug: 'acme', name: 'Acme Heating Ltd' }],
  },
}));
const shell = vi.hoisted(() => ({ dispatch: vi.fn(), state: { panelOpen: false } }));
const api = vi.hoisted(() => ({
  libraryScopes: vi.fn(),
  library: vi.fn(),
  projects: vi.fn(),
  projectFiles: vi.fn(),
  libraryUpload: vi.fn(),
}));
const uploadFile = vi.hoisted(() => vi.fn());
const discardUpload = vi.hoisted(() => vi.fn());
vi.mock('../../api.ts', () => ({ api, uploadFile, discardUpload }));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));
vi.mock('../../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ state: shell.state, dispatch: shell.dispatch, modes: {} }),
}));

const { DocumentsSheet } = await import('./DocumentsSheet.tsx');
const { docsStore } = await import('./store.ts');
const { projectsStore } = await import('../../state/projects.ts');

const audit = doc({ id: 'client:acme.d1', title: 'Audit', name: 'audit.pdf' });
const project = card({ client: 'acme', version: 'v1' });
const projectKey = 'acme/website-rebuild';

let flag = true;
let n = 0;
function saved(over: Partial<LibraryUploadResponse> = {}): LibraryUploadResponse {
  return {
    path: 'clients/acme/files/a.pdf',
    kind: 'document',
    scope: 'client:acme',
    personal: false,
    ...over,
  };
}
function pdf(name: string): File {
  return new File(['x'], name, { type: 'application/pdf' });
}
const input = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const pick = (...files: File[]) => fireEvent.change(input(), { target: { files } });

beforeEach(() => {
  docsStore.reset();
  projectsStore.reset();
  flag = true;
  n = 0;
  store.boot.prefs.lastClient = null;
  api.libraryScopes.mockResolvedValue(SCOPES);
  api.library.mockImplementation(async (scope: string) => ({
    ...listing(scope, [audit], ['Reports']),
    ...(flag ? { canUpload: true } : {}),
  }));
  api.projects.mockResolvedValue(projectList([project], { canUploadFiles: true }));
  api.projectFiles.mockResolvedValue({ items: [], hidden: 0 });
  api.libraryUpload.mockImplementation(async () => saved());
  uploadFile.mockImplementation(async (_f: File, name: string) => ({ id: `u${++n}`, name }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Upload in Documents', () => {
  it('has no button when the listing has no canUpload', async () => {
    flag = false;
    render(<DocumentsSheet />);
    await screen.findByRole('region', { name: 'Reports' });
    expect(screen.queryByRole('button', { name: /^Upload/ })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('is a primary button, last in the tools row, named for the library', async () => {
    const { container } = render(<DocumentsSheet />);
    const button = await screen.findByRole('button', { name: "Upload to Acme Heating Ltd's library" });
    expect(button.getAttribute('data-variant')).toBe('primary');
    expect(button.textContent).toBe("Upload to Acme Heating Ltd's library");
    const tools = container.querySelector('.lib-tools') as HTMLElement;
    expect(tools.querySelector('.btn[data-variant="primary"]')).toBe(button);
    expect(input().accept).toContain('.pdf');
    expect(input().multiple).toBe(true);
  });

  it('sends the library scope, says where the file went, and refreshes nothing by hand', async () => {
    render(<DocumentsSheet />);
    await screen.findByRole('button', { name: /^Upload/ });
    pick(pdf('a.pdf'));
    await waitFor(() =>
      expect(document.querySelector('.lib-note')?.textContent).toBe(
        "Added a.pdf to Acme Heating Ltd's Documents.",
      ),
    );
    expect(api.libraryUpload).toHaveBeenCalledWith({ upload: 'u1', scope: 'client:acme' });
  });

  it('marks the button aria-disabled, never disabled, while busy, and ignores a press', async () => {
    let release: () => void = () => {};
    api.libraryUpload.mockImplementation(
      () =>
        new Promise((r) => {
          release = () => r(saved());
        }),
    );
    render(<DocumentsSheet />);
    const button = await screen.findByRole('button', { name: /^Upload/ });
    pick(pdf('a.pdf'));
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.textContent).toBe("Upload to Acme Heating Ltd's library");
    const click = vi.spyOn(input(), 'click');
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBeNull());
  });

  it('chooses the uploaded file once the list has it, so the person sees where it went', async () => {
    const fresh = doc({ id: 'client:acme.d9', title: 'a', name: 'a.pdf', path: 'clients/acme/files/a.pdf' });
    api.library.mockImplementation(async (scope: string) => ({
      ...listing(scope, [audit, fresh], ['Reports']),
      canUpload: true,
    }));
    render(<DocumentsSheet />);
    await screen.findByRole('button', { name: /^Upload/ });
    expect(docsStore.get().current).toBeNull();
    pick(pdf('a.pdf'));
    await waitFor(() => expect(docsStore.get().current?.id).toBe('client:acme.d9'));
    // Once only: choosing another file afterwards is not undone.
    act(() => docsStore.set({ current: audit }));
    expect(docsStore.get().current?.id).toBe(audit.id);
  });

  it('leaves the choice alone when the person chose another file while the upload ran', async () => {
    const fresh = doc({ id: 'client:acme.d9', title: 'a', name: 'a.pdf', path: 'clients/acme/files/a.pdf' });
    api.library.mockImplementation(async (scope: string) => ({
      ...listing(scope, [audit, fresh], ['Reports']),
      canUpload: true,
    }));
    let release: () => void = () => {};
    api.libraryUpload.mockImplementation(
      () =>
        new Promise((r) => {
          release = () => r(saved());
        }),
    );
    render(<DocumentsSheet />);
    const button = await screen.findByRole('button', { name: /^Upload/ });
    pick(pdf('a.pdf'));
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
    act(() => docsStore.set({ current: audit }));
    await act(async () => release());
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBeNull());
    await waitFor(() =>
      expect(document.querySelector('.lib-note')?.textContent).toBe(
        "Added a.pdf to Acme Heating Ltd's Documents.",
      ),
    );
    expect(docsStore.get().current?.id).toBe(audit.id);
  });

  it('chooses nothing when the uploaded file is not in this list (a picture sent from Documents)', async () => {
    api.libraryUpload.mockResolvedValue(saved({ path: 'clients/acme/images/a.png', kind: 'image' }));
    render(<DocumentsSheet />);
    await screen.findByRole('button', { name: /^Upload/ });
    pick(new File(['x'], 'a.png', { type: 'image/png' }));
    await waitFor(() => expect(document.querySelector('.lib-note')?.textContent).toContain('Images'));
    expect(docsStore.get().current).toBeNull();
  });

  it('keeps sending to the library chosen when the files were picked, even if the picker moves', async () => {
    const releases: (() => void)[] = [];
    api.libraryUpload.mockImplementation(
      () =>
        new Promise((r) => {
          releases.push(() => r(saved()));
        }),
    );
    render(<DocumentsSheet />);
    await screen.findByRole('button', { name: /^Upload/ });
    pick(pdf('a.pdf'), pdf('b.pdf'));
    await waitFor(() => expect(releases.length).toBe(1));
    act(() => docsStore.set({ scope: 'client:northwind' }));
    await screen.findByRole('heading', { level: 2, name: 'Documents in Northwind' });
    await act(async () => releases[0]?.());
    await waitFor(() => expect(releases.length).toBe(2));
    await act(async () => releases[1]?.());
    expect(api.libraryUpload.mock.calls.map((c) => c[0])).toEqual([
      { upload: 'u1', scope: 'client:acme' },
      { upload: 'u2', scope: 'client:acme' },
    ]);
  });
});

describe('Documents narrowed to a project', () => {
  const narrow = () => act(() => docsStore.set({ project: projectKey }));

  it('sends the project shape with the card version, never the picker scope', async () => {
    api.libraryUpload.mockResolvedValue(
      saved({ linked: true, list: projectList([{ ...project, version: 'v2' }], { canUploadFiles: true }) }),
    );
    render(<DocumentsSheet />);
    narrow();
    const button = await screen.findByRole('button', { name: 'Upload to Website rebuild' });
    expect(button.getAttribute('data-variant')).toBe('primary');
    pick(pdf('a.pdf'));
    await waitFor(() => expect(api.libraryUpload).toHaveBeenCalled());
    expect(api.libraryUpload).toHaveBeenCalledWith({ upload: 'u1', project: projectKey, expect: 'v1' });
    expect(api.libraryUpload.mock.calls[0]?.[0]).not.toHaveProperty('scope');
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "Added a.pdf to Website rebuild. Saved in Acme Heating Ltd's Documents.",
      ),
    );
  });

  it.each([
    ['the server says no', { canUploadFiles: false }, {}],
    ['the project is archived', { canUploadFiles: true }, { archived: true }],
    ['the project has no card', { canUploadFiles: true }, { card: 'none' as const }],
    ['the project is in the old folder', { canUploadFiles: true }, { space: 'legacy' as const }],
    ['changes are not allowed', { canUploadFiles: true, canChange: false }, {}],
  ])('has no button when %s, though the library listing allows it', async (_why, listOver, cardOver) => {
    api.projects.mockResolvedValue(projectList([{ ...project, ...cardOver }], listOver));
    render(<DocumentsSheet />);
    narrow();
    await waitFor(() => expect(api.projectFiles).toHaveBeenCalled());
    await waitFor(() => expect(projectsStore.get().list).not.toBeNull());
    expect(screen.queryByRole('button', { name: /^Upload/ })).toBeNull();
  });
});
