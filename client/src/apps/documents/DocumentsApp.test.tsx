// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '../../../../shared/contract.ts';
import { doc, item, listing, SCOPES } from '../shared/testing.ts';

const store = vi.hoisted(() => ({
  newChat: vi.fn(),
  libraryVersion: 0,
  deleteFile: vi.fn(),
  undoDeleteFile: vi.fn(),
  heldFiles: [] as { id: string; title: string; phase: 'waiting' | 'sending' }[],
  hiddenFileIds: new Set<string>() as ReadonlySet<string>,
  fileDeleteBusy: false,
  boot: { prefs: { lastClient: null as string | null } },
}));
const shell = vi.hoisted(() => ({ dispatch: vi.fn(), state: { panelOpen: false } }));
const api = vi.hoisted(() => ({ libraryScopes: vi.fn(), library: vi.fn(), libraryText: vi.fn() }));
vi.mock('../../api.ts', () => ({ api }));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));
vi.mock('../../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ state: shell.state, dispatch: shell.dispatch, modes: {} }),
}));

const { DocumentsSheet } = await import('./DocumentsSheet.tsx');
const { DocumentsPanel } = await import('./DocumentsPanel.tsx');
const { docsStore } = await import('./store.ts');

const audit = doc({
  id: 'client:acme.d1',
  title: 'Google Ads audit',
  name: 'audit.pdf',
  modified: '2026-09-15T09:00:00.000Z',
});
const lead = doc({
  id: 'client:acme.d2',
  title: 'Lead quality',
  name: 'lead.pdf',
  modified: '2026-11-03T09:00:00.000Z',
  view: 'pdf',
  thumb: true,
});
const plan = doc({
  id: 'client:acme.d3',
  group: 'Plans',
  format: 'doc',
  ext: 'md',
  title: 'Winter boiler campaign',
  name: 'winter.md',
  path: 'clients/acme/plans/winter.md',
  bytes: 3000,
  modified: '2026-10-28T09:00:00.000Z',
  view: 'text',
});
const prices = doc({
  id: 'client:acme.d4',
  group: 'Plans',
  format: 'sheet',
  ext: 'xlsx',
  title: 'Winter budget split',
  name: 'split.xlsx',
  path: 'clients/acme/plans/split.xlsx',
  modified: '2026-10-21T09:00:00.000Z',
});
const page = doc({
  id: 'client:acme.d5',
  group: 'Plans',
  format: 'doc',
  ext: 'html',
  title: 'Explainer',
  name: 'explainer.html',
  path: 'clients/acme/plans/explainer.html',
  modified: '2026-10-01T09:00:00.000Z',
  view: 'page',
});
const picture = item({ id: 'client:acme.i1', group: 'Brand' });

beforeEach(() => {
  docsStore.reset();
  store.libraryVersion = 0;
  store.heldFiles = [];
  store.hiddenFileIds = new Set();
  store.fileDeleteBusy = false;
  store.boot.prefs.lastClient = null;
  shell.state = { panelOpen: false };
  api.libraryScopes.mockResolvedValue(SCOPES);
  api.library.mockImplementation(async (scope: string) =>
    listing(scope, [audit, lead, plan, prices, page, picture], ['Reports', 'Plans', 'Brand']),
  );
  api.libraryText.mockResolvedValue({ text: '# Hello\n\nSome *words*.', truncated: false });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const card = (name: string) => screen.findByRole('region', { name });
const titles = (region: HTMLElement) =>
  [...region.querySelectorAll('.line-title')].map((el) => el.textContent);

describe('DocumentsSheet', () => {
  it('lists only documents, by card, with type, size and a changed date on each row', async () => {
    render(<DocumentsSheet />);
    expect((await card('Reports')).textContent).toContain('2');
    expect(screen.getByRole('heading', { level: 2, name: 'Documents in Acme Heating Ltd' })).toBeTruthy();
    expect(screen.getByText(/^5 documents, /)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Brand' })).toBeNull();
    const row = screen.getByRole('button', { name: /^Google Ads audit/ });
    expect(row.textContent).toContain('PDF, 840 KB');
    expect(row.textContent).toContain('Changed 15 Sep 2026');
    expect(row.textContent).not.toMatch(/Final|By |Draft/);
    expect(row.querySelector('.line-title')?.getAttribute('title')).toBe('audit.pdf');
  });

  it('keeps the Type filter, counted from the format, and the search hint', async () => {
    render(<DocumentsSheet />);
    await card('Reports');
    expect(screen.getByLabelText('Search documents').getAttribute('placeholder')).toBe(
      'Search by name or folder',
    );
    expect(screen.getByRole('radio', { name: 'All, 5' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'PDFs, 2' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Docs, 2' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Sheets, 1' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Decks, 0' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Sheets, 1' }));
    expect(screen.getByText(/^1 document, /)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Decks, 0' }));
    expect(screen.getByText('No documents match. Try another search or type.')).toBeTruthy();
  });

  it('lists the newest first, or A to Z', async () => {
    render(<DocumentsSheet />);
    const reports = await card('Reports');
    expect(titles(reports)).toEqual(['Lead quality', 'Google Ads audit']);
    fireEvent.click(screen.getByRole('radio', { name: 'A to Z' }));
    expect(titles(reports)).toEqual(['Google Ads audit', 'Lead quality']);
  });

  it('searches the title, the file name and the card', async () => {
    render(<DocumentsSheet />);
    await card('Reports');
    const search = screen.getByLabelText('Search documents');
    fireEvent.change(search, { target: { value: 'split.xlsx' } });
    expect(screen.getByText(/^1 document, /)).toBeTruthy();
    fireEvent.change(search, { target: { value: 'plans winter' } });
    expect(screen.getByText(/^2 documents, /)).toBeTruthy();
  });

  it('has the Library picker with Mine and Clients, and shows the failure with Try again', async () => {
    api.libraryScopes.mockRejectedValueOnce(new Error('Could not reach TDS Cortex.'));
    render(<DocumentsSheet />);
    expect(await screen.findByText('Could not reach TDS Cortex.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await card('Reports');
    fireEvent.click(screen.getByRole('combobox', { name: 'Library' }));
    expect(
      screen
        .getAllByRole('group')
        .map((g) => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent),
    ).toEqual(['Mine', 'Clients']);
  });

  it('says so when the library has no documents', async () => {
    api.library.mockResolvedValue(listing('client:acme', [picture]));
    render(<DocumentsSheet />);
    expect(
      await screen.findByText(
        "Nothing here yet. Documents saved in this library's folders will appear here.",
      ),
    ).toBeTruthy();
  });

  it('choosing a document marks it current and opens the panel', async () => {
    render(<DocumentsSheet />);
    await card('Reports');
    const row = screen.getByRole('button', { name: /^Lead quality/ });
    fireEvent.click(row);
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'set-panel', open: true });
    expect(docsStore.get().current?.id).toBe(lead.id);
  });
  it('has no ticks: one document at a time, through its row or the panel', async () => {
    render(<DocumentsSheet />);
    await card('Plans');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('group', { name: 'Selected documents' })).toBeNull();
  });
  it('Open on a row shows the document in the viewer drawer; one the app cannot show has no Open', async () => {
    render(<DocumentsSheet />);
    await card('Plans');
    expect(screen.queryByRole('button', { name: 'Open Winter budget split' })).toBeNull();
    // Its row keeps the same room at the end, so the dates still line up.
    const split = screen.getByRole('button', { name: /^Winter budget split/ }).closest('li') as HTMLElement;
    expect(split.querySelector('.lib-view-gap')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Winter boiler campaign' }));
    expect(docsStore.get().current).toBe(plan);
    expect(shell.dispatch).toHaveBeenCalledWith({
      type: 'open-viewer',
      viewer: { item: plan, place: 'Acme Heating Ltd' },
    });
    // The list stays: the drawer slides over it.
    expect(screen.getByRole('region', { name: 'Plans' })).toBeTruthy();
  });
  it('opens as a list; Grid shows each document as a tile with its page picture, or its icon', async () => {
    const { container } = render(<DocumentsSheet />);
    await card('Reports');
    expect(container.querySelector('.docs')?.getAttribute('data-layout')).toBe('list');
    expect(container.querySelector('.img-tile')).toBeNull();
    // Rows keep the small icon box and ask for no pictures.
    expect(container.querySelector('.lib-row img')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Grid' }));
    expect(container.querySelector('.docs')?.getAttribute('data-layout')).toBe('grid');
    const tile = screen.getByRole('button', { name: /^Lead quality/ }).closest('.img-tile') as HTMLElement;
    const img = tile.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(
      `/api/library/thumb/${encodeURIComponent(lead.id)}?w=320&v=${encodeURIComponent(lead.modified)}`,
    );
    expect(tile.textContent).toContain('PDF, 840 KB');
    const note = screen
      .getByRole('button', { name: /^Winter boiler campaign/ })
      .closest('.img-tile') as HTMLElement;
    expect(note.querySelector('img')).toBeNull();
    expect(note.querySelector('.img-thumb[data-plain="true"] svg.icon')).not.toBeNull();
    // A tile has Open too, for a document the app can show.
    fireEvent.click(within(tile).getByRole('button', { name: 'Open Lead quality' }));
    expect(docsStore.get().current).toBe(lead);
    expect(shell.dispatch).toHaveBeenCalledWith({
      type: 'open-viewer',
      viewer: { item: lead, place: 'Acme Heating Ltd' },
    });
  });
});

describe('DocumentsPanel', () => {
  it('shows the page picture above the title when there is one, and the icon if it fails', () => {
    docsStore.set({ current: lead });
    const { container } = render(<DocumentsPanel />);
    const img = container.querySelector('.lib-preview img') as HTMLImageElement;
    expect(img.getAttribute('alt')).toBe('Preview of Lead quality');
    expect(img.getAttribute('src')).toContain('w=320');
    expect(screen.getByRole('heading', { level: 3, name: 'Lead quality' })).toBeTruthy();
    expect(screen.getByText('lead.pdf')).toBeTruthy();
    fireEvent.error(img);
    expect(container.querySelector('.lib-preview img')).toBeNull();
    expect(container.querySelector('.lib-preview svg.icon')).not.toBeNull();
  });

  it('asks for a choice until a document is chosen', () => {
    render(<DocumentsPanel />);
    expect(screen.getByText('Choose a document to see its details.')).toBeTruthy();
  });

  it('shows a cover card and the facts the file holds, with no sketch, tags or status', () => {
    docsStore.set({ current: plan });
    const { container } = render(<DocumentsPanel />);
    expect(screen.getByRole('heading', { level: 3, name: 'Winter boiler campaign' })).toBeTruthy();
    expect(screen.getByText('winter.md')).toBeTruthy();
    // No picture of a note: the format's icon stands in, in the preview box.
    expect(container.querySelector('.lib-preview .img-thumb[data-plain="true"] svg.icon')).not.toBeNull();
    expect(container.querySelector('.lib-preview img')).toBeNull();
    expect(container.querySelector('.doc-sketch')).toBeNull();
    expect(screen.getByText('Markdown')).toBeTruthy();
    expect(screen.getByText('3 KB')).toBeTruthy();
    expect(screen.getByText('Plans')).toBeTruthy();
    expect(screen.getByText('28 Oct 2026')).toBeTruthy();
    expect(screen.getByText('clients/acme/plans/winter.md')).toBeTruthy();
    for (const gone of ['Status', 'Length', 'Updated', 'Contents', 'Goes with', 'Tags']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Ask Claude about it' }));
    expect(store.newChat).toHaveBeenCalledWith({
      draft: 'Help me with this document: clients/acme/plans/winter.md',
    });
  });

  it('has no Open for a file the app cannot open, but can still download it', () => {
    docsStore.set({ current: audit });
    render(<DocumentsPanel />);
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    const save = screen.getByRole('link', { name: `Download ${audit.name}` });
    expect(save.getAttribute('href')).toBe(ROUTES.libraryFile(audit.id));
    expect(save.getAttribute('download')).toBe(audit.name);
  });
});

describe('a claude.ai artifact among the documents', () => {
  const artifactPage = {
    ...page,
    id: 'client:acme.d6',
    title: 'Campaign page',
    artifact: {
      url: 'https://claude.ai/artifact/AbC123',
      copied: '2026-11-23',
      kind: 'copy',
      partial: false,
    },
  } as typeof page;

  it('says "from claude.ai" in the row, and only for an artifact', async () => {
    api.library.mockImplementation(async (scope: string) => listing(scope, [page, artifactPage], ['Plans']));
    render(<DocumentsSheet />);
    await card('Plans');
    expect(screen.getByRole('button', { name: /^Campaign page/ }).textContent).toContain(
      'HTML page, 840 KB, from claude.ai',
    );
    expect(screen.getByRole('button', { name: /^Explainer/ }).textContent).not.toContain('claude.ai');
  });

  it('calls a link card a link in the row, not a page with a size (UX review)', async () => {
    const card = {
      ...artifactPage,
      id: 'client:acme.d7',
      title: 'Budget sheet',
      artifact: { ...artifactPage.artifact!, kind: 'link' as const },
    } as typeof page;
    api.library.mockImplementation(async (scope: string) => listing(scope, [page, card], ['Plans']));
    render(<DocumentsSheet />);
    await screen.findByRole('button', { name: /^Budget sheet/ });
    const row = screen.getByRole('button', { name: /^Budget sheet/ }).textContent ?? '';
    expect(row).toContain('Link to a claude.ai page');
    expect(row).not.toContain('KB');
  });

  it('gives the panel one Source row, and none for an ordinary page', () => {
    docsStore.set({ current: artifactPage });
    const { unmount } = render(<DocumentsPanel />);
    expect(screen.getByText('Source')).toBeTruthy();
    expect(screen.getByText('Copied from claude.ai on 23 November 2026')).toBeTruthy();
    unmount();
    docsStore.set({ current: page });
    render(<DocumentsPanel />);
    expect(screen.queryByText('Source')).toBeNull();
  });
});

describe('opening a document from the panel', () => {
  it('Open shows it in the viewer drawer, and a floating panel closes so it is not under the drawer', async () => {
    docsStore.set({ current: plan });
    render(<DocumentsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'open-viewer', viewer: { item: plan } });
    expect(shell.dispatch).not.toHaveBeenCalledWith({ type: 'set-panel', open: false });
  });
});

describe('the details pane actions (UX consistency, release 2B)', () => {
  it('has the bin after the star, only where canDelete is true, and deletes through the same hold', () => {
    docsStore.set({ current: { ...audit, canDelete: true } });
    render(<DocumentsPanel />);
    const row = screen.getByRole('button', { name: 'Ask Claude about it' }).parentElement as HTMLElement;
    const names = within(row)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    // Open isn't offered for a file that can't be shown; Ask, the star, then the bin.
    expect(names).toEqual([
      'Ask Claude about it',
      'Favourite: Google Ads audit',
      'Delete file: Google Ads audit',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file: Google Ads audit' }));
    expect(store.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ id: audit.id }));
    cleanup();
    docsStore.set({ current: { ...audit, canDelete: false } });
    render(<DocumentsPanel />);
    expect(screen.queryByRole('button', { name: /^Delete file/ })).toBeNull();
  });
});

describe('deleting a document', () => {
  it('shows a bin only where canDelete is true, and holds the delete when it is pressed', async () => {
    api.library.mockImplementation(async (scope: string) =>
      listing(
        scope,
        [{ ...audit, canDelete: true }, { ...lead, canDelete: false }, plan],
        ['Reports', 'Plans', 'Brand'],
      ),
    );
    store.deleteFile.mockImplementation((i: { id: string }) => {
      store.hiddenFileIds = new Set([...store.hiddenFileIds, i.id]);
    });
    render(<DocumentsSheet />);
    await card('Reports');
    expect(screen.getAllByRole('button', { name: /^Delete file: / })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file: Google Ads audit' }));
    expect(store.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ id: audit.id }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete file: Google Ads audit' })).toBeNull(),
    );
  });

  it('keeps the bin\u2019s place in a list row that has none, so the rows line up', async () => {
    api.library.mockImplementation(async (scope: string) =>
      listing(scope, [{ ...audit, canDelete: true }, { ...lead, canDelete: false }, plan], ['Reports']),
    );
    const { container } = render(<DocumentsSheet />);
    await card('Reports');
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    await waitFor(() => expect(container.querySelector('.lib-row')).not.toBeNull());
    expect(container.querySelectorAll('.lib-row .lib-delete')).toHaveLength(1);
    expect(container.querySelectorAll('.lib-row .lib-delete-gap')).toHaveLength(
      container.querySelectorAll('.lib-row').length - 1,
    );
  });
});
