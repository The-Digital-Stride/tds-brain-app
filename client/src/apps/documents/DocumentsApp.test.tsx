// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '../../../../shared/contract.ts';
import { doc, item, listing, SCOPES } from '../shared/testing.ts';

const store = vi.hoisted(() => ({
  newChat: vi.fn(),
  libraryVersion: 0,
  boot: { prefs: { lastClient: null as string | null } },
}));
const shell = vi.hoisted(() => ({ dispatch: vi.fn(), state: { panelOpen: false } }));
const api = vi.hoisted(() => ({ libraryScopes: vi.fn(), library: vi.fn(), libraryText: vi.fn() }));
vi.mock('../../api.ts', () => ({ api }));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));
vi.mock('../../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ state: shell.state, dispatch: shell.dispatch, modes: {} }),
}));

const { DocumentsSheet, DocumentsBar } = await import('./DocumentsSheet.tsx');
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
    api.libraryScopes.mockRejectedValueOnce(new Error('Could not reach TDS Brain.'));
    render(<DocumentsSheet />);
    expect(await screen.findByText('Could not reach TDS Brain.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await card('Reports');
    const picker = screen.getByLabelText('Library') as HTMLSelectElement;
    expect([...picker.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Mine', 'Clients']);
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

  it('ticked documents get a bar that starts a chat naming each real path', async () => {
    render(<DocumentsSheet />);
    await card('Plans');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Winter boiler campaign' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Winter budget split' }));
    const bar = screen.getByRole('group', { name: 'Selected documents' });
    expect(within(bar).getByText('2 documents selected')).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Ask Claude about them' }));
    expect(store.newChat).toHaveBeenCalledWith({
      draft:
        'Help me with these 2 documents:\n- clients/acme/plans/winter.md\n- clients/acme/plans/split.xlsx',
    });
    fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(document.activeElement?.textContent).toMatch(/^5 documents, /);
  });

  it('says when the Type filter is hiding part of the selection', async () => {
    render(<DocumentsSheet />);
    await card('Plans');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Winter boiler campaign' }));
    fireEvent.click(screen.getByRole('radio', { name: 'PDFs, 2' }));
    const bar = screen.getByRole('group', { name: 'Selected documents' });
    expect(within(bar).getByText('1 document selected, 1 hidden by your search or filter')).toBeTruthy();
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
});

describe('DocumentsPanel', () => {
  it('asks for a choice until a document is chosen', () => {
    render(<DocumentsPanel />);
    expect(screen.getByText('Choose a document to see its details.')).toBeTruthy();
  });

  it('shows a cover card and the facts the file holds, with no sketch, tags or status', () => {
    docsStore.set({ current: plan });
    const { container } = render(<DocumentsPanel />);
    expect(screen.getByRole('heading', { level: 3, name: 'Winter boiler campaign' })).toBeTruthy();
    expect(screen.getByText('winter.md')).toBeTruthy();
    expect(container.querySelector('.doc-cover svg.icon')).not.toBeNull();
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

describe('opening a document', () => {
  const all = () => (
    <div className="sheet-scroll">
      <DocumentsBar />
      <DocumentsSheet />
      <DocumentsPanel />
    </div>
  );
  const openFrom = async (name: RegExp) => {
    await card('Plans');
    fireEvent.click(screen.getByRole('button', { name }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  };

  it('renders a Markdown file with the safe renderer inside a card, and Back returns focus', async () => {
    const { container } = render(all());
    const row = (await card('Plans')) && screen.getByRole('button', { name: /^Winter boiler campaign/ });
    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Hello' })).toBeTruthy();
    expect(api.libraryText).toHaveBeenCalledWith(plan.id);
    expect(container.querySelector('.lib-doc.card .markdown')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Documents' }));
    expect(screen.queryByRole('heading', { level: 1, name: 'Hello' })).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it('says when a long file was cut short', async () => {
    api.libraryText.mockResolvedValue({ text: 'Start of it', truncated: true });
    render(all());
    await openFrom(/^Winter boiler campaign/);
    expect(await screen.findByText('This file is long, so only the start is shown.')).toBeTruthy();
  });

  it('shows plain text as pre-wrapped text, not Markdown', async () => {
    const txt = { ...plan, ext: 'txt', title: 'Notes file' };
    api.library.mockResolvedValue(listing('client:acme', [txt], ['Plans']));
    api.libraryText.mockResolvedValue({ text: '# not a heading', truncated: false });
    const { container } = render(all());
    await openFrom(/^Notes file/);
    await screen.findByText('# not a heading');
    expect(container.querySelector('pre.lib-text')).not.toBeNull();
    expect(container.querySelector('.markdown')).toBeNull();
  });

  it('shows a failure to read the file with Try again', async () => {
    api.libraryText.mockRejectedValueOnce(new Error('That file is no longer there.'));
    render(all());
    await openFrom(/^Winter boiler campaign/);
    expect(await screen.findByText('That file is no longer there.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Hello' })).toBeTruthy();
  });

  it('opens an HTML page in a frame whose sandbox is present and empty', async () => {
    const { container } = render(all());
    await openFrom(/^Explainer/);
    const frame = container.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.hasAttribute('sandbox')).toBe(true);
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('title')).toBe('Explainer');
    expect(frame.getAttribute('src')).toBe(`/api/library/page/${encodeURIComponent(page.id)}`);
    expect(frame.closest('.card')).not.toBeNull();
    // The text route is not used for a page.
    expect(api.libraryText).not.toHaveBeenCalled();
  });

  it('opens a PDF in the browser’s own reader, in a frame without a sandbox', async () => {
    const { container } = render(all());
    await openFrom(/^Lead quality/);
    const frame = container.querySelector('iframe') as HTMLIFrameElement;
    // A sandboxed frame makes the browser refuse to show a PDF at all.
    expect(frame.hasAttribute('sandbox')).toBe(false);
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('title')).toBe('Lead quality');
    expect(frame.getAttribute('src')).toBe(
      `/api/library/pdf/${encodeURIComponent(lead.id)}#navpanes=0&view=FitH`,
    );
    expect(frame.closest('.card.lib-page.lib-pdf')).not.toBeNull();
    expect(api.libraryText).not.toHaveBeenCalled();
  });

  it('a changed HTML page reloads its frame, but another file changing does not', async () => {
    const view = render(all());
    await openFrom(/^Explainer/);
    const frame = view.container.querySelector('iframe');
    const items = (modified: string) => [audit, lead, plan, prices, { ...page, modified }, picture];
    api.library.mockResolvedValue(
      listing('client:acme', items(page.modified), ['Reports', 'Plans', 'Brand']),
    );
    store.libraryVersion = 1;
    view.rerender(all());
    await waitFor(() => expect(api.library).toHaveBeenCalledTimes(2));
    expect(view.container.querySelector('iframe')).toBe(frame);

    api.library.mockResolvedValue(
      listing('client:acme', items('2026-11-08T09:00:00.000Z'), ['Reports', 'Plans', 'Brand']),
    );
    store.libraryVersion = 2;
    view.rerender(all());
    await waitFor(() => expect(view.container.querySelector('iframe')).not.toBe(frame));
  });

  it('a blocked link remounts the page frame and says so; other violations do nothing', async () => {
    const { container } = render(all());
    await openFrom(/^Explainer/);
    const frame = container.querySelector('iframe');
    const violate = (violatedDirective: string) => {
      const e = new Event('securitypolicyviolation');
      Object.defineProperty(e, 'violatedDirective', { value: violatedDirective });
      act(() => {
        document.dispatchEvent(e);
      });
    };
    violate('img-src');
    expect(container.querySelector('iframe')).toBe(frame);
    expect(screen.queryByText('Links to other sites are switched off here.')).toBeNull();
    violate('frame-src https://example.com');
    expect(container.querySelector('iframe')).not.toBe(frame);
    expect(screen.getByText('Links to other sites are switched off here.').getAttribute('role')).toBe(
      'status',
    );
  });

  it('an open note is not fetched again when other files change', async () => {
    const view = render(all());
    await openFrom(/^Winter boiler campaign/);
    await screen.findByRole('heading', { level: 1, name: 'Hello' });
    store.libraryVersion = 1;
    view.rerender(all());
    await waitFor(() => expect(api.library).toHaveBeenCalledTimes(2));
    expect(api.libraryText).toHaveBeenCalledTimes(1);
  });

  it('Escape in the viewer goes back and puts focus on the item', async () => {
    render(all());
    await openFrom(/^Explainer/);
    const viewer = screen.getByRole('region', { name: 'Explainer' });
    expect(document.activeElement).toBe(viewer);
    fireEvent.keyDown(viewer, { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Explainer/ }));
  });
});
