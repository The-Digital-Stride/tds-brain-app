// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIBRARY_UPLOAD_MESSAGES,
  type LibraryUploadResponse,
} from '../../../../shared/library-upload-contract.ts';
import {
  PROJECT_LINKS_MAX,
  type ProjectCard,
  type ProjectList,
} from '../../../../shared/projects-contract.ts';
import { card as makeCard, projectList } from '../projects/testing.ts';

const store = vi.hoisted(() => ({
  boot: { clients: [{ slug: 'acme', name: 'Acme Heating' }] } as {
    clients: { slug: string; name: string }[];
  },
}));
const api = vi.hoisted(() => ({ libraryUpload: vi.fn() }));
const uploadFile = vi.hoisted(() => vi.fn());
const discardUpload = vi.hoisted(() => vi.fn());
const apply = vi.hoisted(() => vi.fn());
vi.mock('../../api.ts', () => ({ api, uploadFile, discardUpload }));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));
vi.mock('../../state/projects.ts', () => ({
  useProjects: () => ({ list: null, error: null, refresh: vi.fn(), apply }),
}));

const { useLibraryUpload, LIBRARY_ACCEPT } = await import('./upload.tsx');

const LIB = { kind: 'library' as const, scope: 'client:acme', name: 'Acme Heating' };
const PERSONAL = { kind: 'library' as const, scope: 'personal', name: 'My personal files' };

function f(name: string, size = 100): File {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function saved(over: Partial<LibraryUploadResponse> = {}): LibraryUploadResponse {
  return {
    path: 'clients/acme/files/a.pdf',
    kind: 'document',
    scope: 'client:acme',
    personal: false,
    ...over,
  };
}

function setup() {
  return renderHook(() => useLibraryUpload());
}

let n = 0;
beforeEach(() => {
  n = 0;
  uploadFile.mockImplementation(async (_f: File, name: string) => ({ id: `u${++n}`, name }));
  api.libraryUpload.mockImplementation(async () => saved());
  discardUpload.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the files a person may choose', () => {
  it('accepts every type the contract lists, with dots', () => {
    expect(LIBRARY_ACCEPT).toContain('.pdf');
    expect(LIBRARY_ACCEPT).toContain('.png');
    expect(LIBRARY_ACCEPT).not.toContain('.svg');
  });
});

describe('checks before sending', () => {
  it('names a type that is not allowed, says the types, and still sends the allowed file', async () => {
    const { result } = setup();
    await act(() => result.current.upload([f('x.svg'), f('ok.pdf')], LIB));
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(result.current.status.text).toContain('"x.svg" wasn\'t added: that type can\'t be added.');
    expect(result.current.status.text).toContain('Only PNG, JPG, WebP, GIF, PDF, Word');
    expect(result.current.status.text).toContain("Added a.pdf to Acme Heating's Documents.");
  });

  it('names a file over 32 MB and sends the rest', async () => {
    const { result } = setup();
    await act(() => result.current.upload([f('big.pdf', 33 * 1024 * 1024), f('ok.pdf')], LIB));
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(result.current.status.text).toContain('"big.pdf" wasn\'t added: it is over 32 MB.');
  });

  it('sends nothing when every file is refused, as an error', async () => {
    const { result } = setup();
    await act(() => result.current.upload([f('x.svg')], LIB));
    expect(uploadFile).not.toHaveBeenCalled();
    expect(result.current.status.level).toBe('error');
  });

  it('sends nothing for more than 10 files', async () => {
    const { result } = setup();
    const files = Array.from({ length: 11 }, (_, i) => f(`f${i}.pdf`));
    await act(() => result.current.upload(files, LIB));
    expect(uploadFile).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({ text: 'Choose up to 10 files at a time.', level: 'error' });
  });

  it('sends nothing to a project that would be full', async () => {
    const { result } = setup();
    const full = makeCard({
      links: Array.from({ length: PROJECT_LINKS_MAX - 1 }, (_, i) => `clients/acme/files/${i}.pdf`),
    });
    await act(() => result.current.upload([f('a.pdf'), f('b.pdf')], { kind: 'project', card: full }));
    expect(uploadFile).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({ text: LIBRARY_UPLOAD_MESSAGES.projectFull, level: 'error' });
  });
});

describe('sending', () => {
  it('goes one at a time, in order, and says how far it is', async () => {
    const { result } = setup();
    const seen: string[] = [];
    let release: () => void = () => {};
    api.libraryUpload.mockImplementation(async () => {
      seen.push(result.current.status.text);
      await new Promise<void>((r) => {
        release = r;
      });
      return saved();
    });
    let p: Promise<void> = Promise.resolve();
    act(() => {
      p = result.current.upload([f('a.pdf'), f('b.pdf')], LIB);
    });
    await vi.waitFor(() => expect(api.libraryUpload).toHaveBeenCalledTimes(1));
    expect(result.current.busy).toBe(true);
    expect(result.current.status.text).toBe('Adding 1 of 2…');
    expect(uploadFile).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await vi.waitFor(() => expect(api.libraryUpload).toHaveBeenCalledTimes(2));
    expect(result.current.status.text).toBe('Adding 2 of 2…');
    await act(async () => {
      release();
      await p;
    });
    expect(uploadFile.mock.calls.map((c) => (c[0] as File).name)).toEqual(['a.pdf', 'b.pdf']);
    expect(result.current.busy).toBe(false);
  });

  it('names one file while it works', async () => {
    const { result } = setup();
    let release: () => void = () => {};
    api.libraryUpload.mockImplementation(
      () =>
        new Promise((r) => {
          release = () => r(saved());
        }),
    );
    let p: Promise<void> = Promise.resolve();
    act(() => {
      p = result.current.upload([f('quote.pdf')], LIB);
    });
    await vi.waitFor(() => expect(result.current.status.text).toBe('Adding quote.pdf…'));
    await act(async () => {
      release();
      await p;
    });
  });

  it('sends the library scope for a library', async () => {
    const { result } = setup();
    await act(() => result.current.upload([f('a.pdf')], LIB));
    expect(api.libraryUpload).toHaveBeenCalledWith({ upload: 'u1', scope: 'client:acme' });
  });

  it('says a library upload went to Documents, and what name it was saved under', async () => {
    const { result } = setup();
    api.libraryUpload.mockResolvedValue(saved({ path: 'clients/acme/files/quote (2).pdf' }));
    await act(() => result.current.upload([f('quote.pdf')], LIB));
    expect(result.current.status).toEqual({
      text: "Added quote (2).pdf to Acme Heating's Documents.",
      level: 'info',
    });
  });

  it('names both apps when files went to both', async () => {
    const { result } = setup();
    api.libraryUpload
      .mockResolvedValueOnce(saved())
      .mockResolvedValueOnce(saved({ path: 'clients/acme/images/b.png', kind: 'image' }))
      .mockResolvedValueOnce(saved({ path: 'clients/acme/files/c.pdf' }));
    await act(() => result.current.upload([f('a.pdf'), f('b.png'), f('c.pdf')], LIB));
    expect(result.current.status.text).toBe("Added 3 files to Acme Heating's Documents and Images.");
  });

  it('says a personal upload is only on this Mac', async () => {
    const { result } = setup();
    api.libraryUpload.mockResolvedValue(
      saved({ path: 'personal/files/quote.pdf', scope: 'personal', personal: true }),
    );
    await act(() => result.current.upload([f('quote.pdf')], PERSONAL));
    expect(api.libraryUpload).toHaveBeenCalledWith({ upload: 'u1', scope: 'personal' });
    expect(result.current.status.text).toBe('Added quote.pdf to your personal files. Only this Mac has it.');
  });

  it('says an image uploaded from Images was saved in Documents when it was a PDF', async () => {
    const { result } = setup();
    await act(() => result.current.upload([f('a.pdf')], LIB));
    expect(result.current.status.text).toContain('Documents');
  });
});

describe('a failure', () => {
  it('names the file, counts what was added, stops, and discards the staged upload', async () => {
    const { result } = setup();
    api.libraryUpload
      .mockResolvedValueOnce(saved())
      .mockRejectedValueOnce(new Error('The file could not be saved here.'));
    await act(() => result.current.upload([f('a.pdf'), f('x.pdf'), f('c.pdf')], LIB));
    expect(api.libraryUpload).toHaveBeenCalledTimes(2);
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(discardUpload).toHaveBeenCalledWith('u2');
    expect(result.current.status).toEqual({
      text: '1 of 3 added. "x.pdf" couldn\'t be added: The file could not be saved here.',
      level: 'error',
    });
  });

  it('says only the failure when nothing was added', async () => {
    const { result } = setup();
    api.libraryUpload.mockRejectedValue(new Error('No.'));
    await act(() => result.current.upload([f('x.pdf')], LIB));
    expect(result.current.status.text).toBe('"x.pdf" couldn\'t be added: No.');
  });

  it('discards and stops when the staging itself fails', async () => {
    const { result } = setup();
    uploadFile.mockRejectedValue(new Error('Could not reach TDS Cortex.'));
    await act(() => result.current.upload([f('a.pdf'), f('b.pdf')], LIB));
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(api.libraryUpload).not.toHaveBeenCalled();
    expect(result.current.status.text).toBe('"a.pdf" couldn\'t be added: Could not reach TDS Cortex.');
  });
});

describe('a project upload', () => {
  const key = 'acme/website-rebuild';
  const base: ProjectCard = makeCard({ client: 'acme', version: 'v1' });
  const listWith = (version: string): ProjectList => projectList([{ ...base, version }]);

  it('sends the project and its version, then the fresh version to the next file, and applies each list', async () => {
    const { result } = setup();
    api.libraryUpload
      .mockResolvedValueOnce(saved({ linked: true, list: listWith('v2') }))
      .mockResolvedValueOnce(saved({ linked: true, list: listWith('v3') }));
    await act(() => result.current.upload([f('a.pdf'), f('b.pdf')], { kind: 'project', card: base }));
    expect(api.libraryUpload.mock.calls.map((c) => c[0])).toEqual([
      { upload: 'u1', project: key, expect: 'v1' },
      { upload: 'u2', project: key, expect: 'v2' },
    ]);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith(listWith('v3'));
    expect(result.current.status.text).toBe(
      "Added 2 files to this project. Saved in Acme Heating's Documents.",
    );
  });

  it('never sends a scope for a project', async () => {
    const { result } = setup();
    api.libraryUpload.mockResolvedValue(saved({ linked: true, list: listWith('v2') }));
    await act(() => result.current.upload([f('a.pdf')], { kind: 'project', card: base }));
    expect(api.libraryUpload.mock.calls[0]?.[0]).not.toHaveProperty('scope');
  });

  it('shows a saved-but-not-linked answer as a warning, stops, and never retries', async () => {
    const { result } = setup();
    const problem = LIBRARY_UPLOAD_MESSAGES.savedNotLinked("Acme Heating's Documents");
    api.libraryUpload.mockResolvedValue(saved({ linked: false, problem }));
    await act(() => result.current.upload([f('a.pdf'), f('b.pdf')], { kind: 'project', card: base }));
    expect(api.libraryUpload).toHaveBeenCalledTimes(1);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(discardUpload).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({ text: problem, level: 'warn' });
    expect(result.current.busy).toBe(false);
  });

  it('stops when the project is not in the fresh list', async () => {
    const { result } = setup();
    api.libraryUpload.mockResolvedValue(saved({ linked: true, list: projectList([]) }));
    await act(() => result.current.upload([f('a.pdf'), f('b.pdf')], { kind: 'project', card: base }));
    expect(api.libraryUpload).toHaveBeenCalledTimes(1);
    expect(result.current.status.level).toBe('error');
    expect(result.current.status.text).toContain('"b.pdf"');
  });
});
