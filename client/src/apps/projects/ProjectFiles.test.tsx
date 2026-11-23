// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryItem } from '../../../../shared/contract.ts';
import { card } from './testing.ts';

const store = vi.hoisted(() => ({
  libraryVersion: 0,
  hiddenFileIds: new Set<string>(),
  deleteFile: vi.fn(),
  toggleFavouriteFile: vi.fn(),
  boot: { identity: { slug: 'me' }, clients: [], prefs: { favouriteFiles: [] as string[] } },
}));
const shell = vi.hoisted(() => ({ dispatch: vi.fn() }));
const api = vi.hoisted(() => ({
  projectFiles: vi.fn(),
  libraryItems: vi.fn(),
  changeProject: vi.fn(),
  librarySearch: vi.fn(),
}));
vi.mock('../../api.ts', () => ({ api, ApiFailure: class ApiFailure extends Error {} }));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));
vi.mock('../../shell/ShellProvider.tsx', () => ({ useShell: () => shell }));
// The removal goes through the page's change helper; the test decides how it answers.
const change = vi.hoisted(() => vi.fn());
vi.mock('./useChange.ts', () => ({ useProjectChange: () => change }));

const { ProjectFiles, placeIn } = await import('./ProjectFiles.tsx');
const { docsStore } = await import('../documents/store.ts');
const { imagesStore } = await import('../images/store.ts');

function file(name: string, over: Partial<LibraryItem> = {}): LibraryItem {
  const ext = name.slice(name.lastIndexOf('.') + 1);
  return {
    id: `tds.${name}`,
    kind: 'document',
    format: ext === 'pdf' ? 'pdf' : 'doc',
    ext,
    group: 'Projects',
    name,
    title: name,
    path: `clients/skyseal/projects/site/${name}`,
    bytes: 1000,
    modified: '2026-11-01T10:00:00Z',
    width: null,
    height: null,
    thumb: false,
    view: 'html',
    ...over,
  } as LibraryItem;
}

const PLAN = file('plan.docx', { modified: '2026-11-01T10:00:00Z' });
const BRIEF = file('brief.pdf', { modified: '2026-11-05T10:00:00Z' });
const ZED = file('zed.docx', { modified: '2026-11-03T10:00:00Z' });
const LOGO = file('logo.png', { kind: 'image', format: null, ext: 'png', width: 10, height: 10 });

function answer(docs: LibraryItem[], images: LibraryItem[]) {
  api.projectFiles.mockImplementation(async (_k: string, kind: string) => ({
    items: kind === 'document' ? docs : images,
    hidden: 0,
  }));
}

function show(over: Parameters<typeof card>[0] = {}, canChange = true) {
  return render(<ProjectFiles card={card(over)} canChange={canChange} linking={false} onLinking={vi.fn()} />);
}

const titles = () => [...document.querySelectorAll('.lib .line-title')].map((e) => e.textContent);

beforeEach(() => {
  api.libraryItems.mockResolvedValue({ files: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the Files tab, in the shared library browser', () => {
  it('switches between Documents and Images, each with its count', async () => {
    answer([PLAN, BRIEF], [LOGO]);
    show();
    await screen.findByRole('radio', { name: 'Documents, 2' });
    expect(screen.getByRole('radio', { name: 'Images, 1' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Documents, 2' }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(titles()).toContain('plan.docx'));
    fireEvent.click(screen.getByRole('radio', { name: 'Images, 1' }));
    await waitFor(() => expect(titles()).toEqual(['logo.png']));
  });

  it('keeps keyboard focus on the switch when the arrow keys change the kind', async () => {
    answer([PLAN, BRIEF], [LOGO]);
    show();
    const docs = await screen.findByRole('radio', { name: 'Documents, 2' });
    docs.focus();
    fireEvent.keyDown(docs, { key: 'ArrowRight' });
    await waitFor(() => expect(titles()).toEqual(['logo.png']));
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Images, 1' }));
  });

  it('opens on Images when the project has only images', async () => {
    answer([], [LOGO]);
    show();
    await waitFor(() => expect(titles()).toEqual(['logo.png']));
    expect(screen.getByRole('radio', { name: 'Images, 1' }).getAttribute('aria-checked')).toBe('true');
  });

  it('filters by type and sorts', async () => {
    answer([PLAN, BRIEF, ZED], []);
    show();
    await screen.findByRole('radio', { name: 'PDFs, 1' });
    fireEvent.click(screen.getByRole('radio', { name: 'PDFs, 1' }));
    await waitFor(() => expect(titles()).toEqual(['brief.pdf']));
    fireEvent.click(screen.getByRole('radio', { name: /^All, 3/ }));
    // Newest first, then A to Z.
    await waitFor(() => expect(titles()).toEqual(['brief.pdf', 'zed.docx', 'plan.docx']));
    fireEvent.click(screen.getByRole('radio', { name: 'A to Z' }));
    await waitFor(() => expect(titles()).toEqual(['brief.pdf', 'plan.docx', 'zed.docx']));
  });

  it('opens the viewer when a file is pressed, with no row left selected', async () => {
    answer([PLAN], []);
    api.libraryItems.mockResolvedValue({
      files: [{ item: PLAN, scope: { id: 'tds', name: 'The Digital Stride' } }],
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^plan\.docx/ }));
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'open-viewer', viewer: { item: PLAN } });
    await waitFor(() =>
      expect(shell.dispatch).toHaveBeenCalledWith({
        type: 'update-viewer',
        viewer: { item: PLAN, place: 'The Digital Stride', openIn: { app: 'documents', scope: 'tds' } },
      }),
    );
    expect(document.querySelector('[data-current="true"]')).toBeNull();
  });

  it('removes a linked file, says so, and leaves the folder files without a remove button', async () => {
    answer([PLAN, BRIEF], []);
    change.mockResolvedValue({ ok: true, list: { projects: [] } });
    show({ links: [PLAN.path] });
    await screen.findByText('From the library');
    expect(screen.queryByRole('button', { name: /^Remove brief\.pdf/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove plan.docx from this project' }));
    await waitFor(() =>
      expect(change).toHaveBeenCalledWith({
        kind: 'unlink',
        key: 'skyseal/website-rebuild',
        path: PLAN.path,
        expect: 'v1',
      }),
    );
    await screen.findByText('plan.docx removed from this project.');
  });

  it('shows the message when a removal fails', async () => {
    answer([PLAN], []);
    change.mockResolvedValue({ ok: false, message: 'Someone changed this project. Try again.' });
    show({ links: [PLAN.path] });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove plan.docx from this project' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Someone changed this project');
  });

  it('gives people who cannot change the project no remove button', async () => {
    answer([PLAN], []);
    show({ links: [PLAN.path] }, false);
    await screen.findByText('From the library');
    expect(screen.queryByRole('button', { name: /Remove plan\.docx/ })).toBeNull();
  });

  it('says so when a kind is empty, and counts links hidden from this person', async () => {
    api.projectFiles.mockImplementation(async (_k: string, kind: string) => ({
      items: kind === 'document' ? [PLAN] : [],
      hidden: kind === 'document' ? 2 : 0,
    }));
    show();
    await screen.findByText('2 linked files are not shown because you cannot see them.');
    fireEvent.click(screen.getByRole('radio', { name: 'Images, 0' }));
    await screen.findByText('No images in this project yet.');
  });

  it('leaves what the Documents and Images apps remember untouched', async () => {
    const docs = { ...docsStore.get() };
    const imgs = { ...imagesStore.get() };
    answer([PLAN, BRIEF], [LOGO]);
    show();
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Images/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^logo\.png/ }));
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'plan' } });
    expect(docsStore.get()).toEqual(docs);
    expect(imagesStore.get()).toEqual(imgs);
    expect(within(document.body).queryAllByRole('searchbox').length).toBeGreaterThan(0);
  });
});

describe('group order on the Files tab', () => {
  it('keeps the project folder, its subfolders, then the library, whatever the sort', async () => {
    const linked = file('q3.pdf', {
      path: 'clients/skyseal/reports/q3.pdf',
      modified: '2026-11-20T10:00:00Z',
    });
    const sub = file('draft.docx', {
      path: 'clients/skyseal/projects/site/zz_drafts/draft.docx',
      modified: '2026-11-10T10:00:00Z',
    });
    answer([PLAN, linked, sub], []);
    show({ slug: 'site', links: [linked.path] });
    await screen.findByText('From the library');
    const heads = () =>
      [...document.querySelectorAll('.lib h2, .lib h3')]
        .map((h) => h.textContent ?? '')
        .filter((t) =>
          ['In the project folder', 'Zz drafts', 'From the library'].some((g) => t.startsWith(g)),
        );
    expect(heads()).toEqual(['In the project folder', 'Zz drafts', 'From the library']);
    fireEvent.click(screen.getByRole('radio', { name: 'A to Z' }));
    expect(heads()).toEqual(['In the project folder', 'Zz drafts', 'From the library']);
  });
});

describe('placeIn: a file is grouped by where it sits in the project', () => {
  const at = { folder: 'clients/acme/projects/boiler', links: ['clients/acme/reports/q3.pdf'] };
  it('names the subfolder, the project folder itself, or the library for a linked file', () => {
    expect(placeIn(at, 'clients/acme/projects/boiler/brief.pdf')).toBe('In the project folder');
    expect(placeIn(at, 'clients/acme/projects/boiler/design_files/logo.png')).toBe('Design files');
    expect(placeIn(at, 'clients/acme/projects/boiler/files/a/b.pdf')).toBe('Files');
    expect(placeIn(at, 'clients/acme/reports/q3.pdf')).toBe('From the library');
  });
});
