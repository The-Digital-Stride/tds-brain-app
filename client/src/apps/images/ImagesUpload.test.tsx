// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { item, listing, SCOPES } from '../shared/testing.ts';

const store = vi.hoisted(() => ({
  newChat: vi.fn(),
  libraryVersion: 0,
  deleteFile: vi.fn(),
  hiddenFileIds: new Set<string>() as ReadonlySet<string>,
  boot: { prefs: { lastClient: null as string | null }, clients: [] as { slug: string; name: string }[] },
}));
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
  useShell: () => ({ state: { panelOpen: false }, dispatch: vi.fn(), modes: {} }),
}));

const { ImagesSheet } = await import('./ImagesSheet.tsx');
const { imagesStore } = await import('./store.ts');
const { projectsStore } = await import('../../state/projects.ts');

let flag = true;
beforeEach(() => {
  imagesStore.reset();
  projectsStore.reset();
  flag = true;
  api.libraryScopes.mockResolvedValue(SCOPES);
  api.library.mockImplementation(async (scope: string) => ({
    ...listing(scope, [item({ id: 'client:acme.i1', group: 'Brand' })], ['Brand']),
    ...(flag ? { canUpload: true } : {}),
  }));
  api.projects.mockResolvedValue({
    projects: [],
    canChange: true,
    looseLabels: 0,
    duplicates: [],
    skippedFiles: 0,
  });
  api.libraryUpload.mockResolvedValue({
    path: 'clients/acme/files/quote.pdf',
    kind: 'document',
    scope: 'client:acme',
    personal: false,
  });
  uploadFile.mockImplementation(async (_f: File, name: string) => ({ id: 'u1', name }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Upload in Images', () => {
  it('has no button without canUpload', async () => {
    flag = false;
    render(<ImagesSheet />);
    await screen.findByRole('region', { name: 'Brand' });
    expect(screen.queryByRole('button', { name: /^Upload/ })).toBeNull();
  });

  it('is a primary button that sends the library scope, and says a PDF went to Documents', async () => {
    render(<ImagesSheet />);
    const button = await screen.findByRole('button', { name: "Upload to Acme Heating Ltd's library" });
    expect(button.getAttribute('data-variant')).toBe('primary');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain('.pdf');
    fireEvent.change(input, { target: { files: [new File(['x'], 'quote.pdf')] } });
    await waitFor(() =>
      expect(document.querySelector('.lib-note')?.textContent).toBe(
        "Added quote.pdf to Acme Heating Ltd's Documents.",
      ),
    );
    expect(api.libraryUpload).toHaveBeenCalledWith({ upload: 'u1', scope: 'client:acme' });
  });
});
