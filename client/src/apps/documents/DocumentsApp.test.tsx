// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ newChat: vi.fn() }));
const shell = vi.hoisted(() => ({ dispatch: vi.fn(), state: { panelOpen: false } }));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));
vi.mock('../../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ state: shell.state, dispatch: shell.dispatch, modes: {} }),
}));

const { DocumentsSheet } = await import('./DocumentsSheet.tsx');
const { DocumentsPanel } = await import('./DocumentsPanel.tsx');
const { docsStore } = await import('./store.ts');

beforeEach(() => {
  docsStore.reset();
  shell.state = { panelOpen: false };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const folder = (name: string) => screen.getByRole('region', { name });
const titles = (region: HTMLElement) =>
  [...region.querySelectorAll('.line-title')].map((el) => el.textContent);

describe('DocumentsSheet', () => {
  it('shows the first client’s documents by folder, with a count on each', () => {
    render(<DocumentsSheet />);
    expect(screen.getByRole('heading', { level: 2, name: 'Acme Heating Ltd documents' })).toBeTruthy();
    expect(screen.getByText(/^18 documents, /)).toBeTruthy();
    expect(folder('Reports').textContent).toContain('5');
    expect(folder('Call notes').textContent).toContain('3');
    const row = screen.getByRole('button', { name: /^Google Ads audit/ });
    expect(row.textContent).toContain('PDF, 24 pages, 2.3 MB');
    expect(row.textContent).toContain('Final');
    expect(row.textContent).toContain('Updated 15 Sep 2026');
    expect(row.textContent).toContain('By Sam Example');
  });

  it('lists the newest first, or A to Z', () => {
    render(<DocumentsSheet />);
    expect(titles(folder('Reports'))[0]).toBe('Lead quality by campaign');
    fireEvent.click(screen.getByRole('radio', { name: 'A to Z' }));
    expect(titles(folder('Reports'))).toEqual([
      'Google Ads audit',
      'Lead quality by campaign',
      'October performance report',
      'Quarter three review',
      'September performance report',
    ]);
  });

  it('a folder card hides and shows its documents', () => {
    render(<DocumentsSheet />);
    const plans = folder('Plans');
    fireEvent.click(within(plans).getByRole('button', { name: 'Hide Plans' }));
    expect(within(plans).queryByRole('button', { name: /^Tracking rebuild/ })).toBeNull();
    fireEvent.click(within(plans).getByRole('button', { name: 'Show Plans' }));
    expect(within(plans).getByRole('button', { name: /^Tracking rebuild/ })).toBeTruthy();
  });

  it('switching client shows that client’s documents and drops what was picked', () => {
    render(<DocumentsSheet />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Google Ads audit' }));
    expect(screen.getByRole('group', { name: 'Selected documents' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'northwind' } });
    expect(screen.getByText('Website audit')).toBeTruthy();
    expect(screen.queryByText('Google Ads audit')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Selected documents' })).toBeNull();
  });

  it('narrows by search and by type, and says when nothing matches', () => {
    render(<DocumentsSheet />);
    fireEvent.change(screen.getByLabelText('Search documents'), { target: { value: 'winter' } });
    expect(screen.getByText(/^3 documents, /)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Sheets, 1' }));
    expect(screen.getByText(/^1 document, /)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'PDFs, 0' }));
    expect(screen.getByText('No documents match. Try another search or type.')).toBeTruthy();
  });

  it('choosing a document marks it current and opens the panel once', () => {
    const view = render(<DocumentsSheet />);
    const row = screen.getByRole('button', { name: /^Winter boiler campaign/ });
    fireEvent.click(row);
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'set-panel', open: true });

    shell.dispatch.mockClear();
    shell.state = { panelOpen: true };
    view.rerender(<DocumentsSheet />);
    fireEvent.click(screen.getByRole('button', { name: /^Tracking rebuild/ }));
    expect(shell.dispatch).not.toHaveBeenCalled();
    expect(docsStore.get().currentId).toBe('acme-heating/2026-09-22-tracking-rebuild.md');
  });

  it('ticked documents get a bar that starts a chat naming each file', () => {
    render(<DocumentsSheet />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Winter boiler campaign' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Winter budget split' }));
    const bar = screen.getByRole('group', { name: 'Selected documents' });
    expect(within(bar).getByText('2 documents selected')).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Ask Claude about them' }));
    expect(store.newChat).toHaveBeenCalledWith({
      draft:
        'Help me with these 2 documents:\n- clients/acme-heating/plans/2026-10-20-winter-boiler-campaign.md\n- clients/acme-heating/plans/2026-10-21-winter-budget-split.xlsx',
    });
    fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('group', { name: 'Selected documents' })).toBeNull();
    expect(document.activeElement?.textContent).toMatch(/^18 documents, /);
  });

  it('says when the filter is hiding part of the selection', () => {
    render(<DocumentsSheet />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Winter boiler campaign' }));
    fireEvent.click(screen.getByRole('radio', { name: 'PDFs, 4' }));
    const bar = screen.getByRole('group', { name: 'Selected documents' });
    expect(within(bar).getByText('1 document selected, 1 hidden by the filter')).toBeTruthy();
  });
});

describe('DocumentsPanel', () => {
  it('asks for a choice until a document is chosen', () => {
    render(<DocumentsPanel />);
    expect(screen.getByText('Choose a document to see its details.')).toBeTruthy();
  });

  it('shows the chosen document, its facts, its contents and what it goes with', () => {
    docsStore.set({ currentId: 'acme-heating/2026-10-20-winter-boiler-campaign.md' });
    render(<DocumentsPanel />);
    expect(screen.getByRole('heading', { level: 3, name: 'Winter boiler campaign' })).toBeTruthy();
    expect(screen.getByText('2026-10-20-winter-boiler-campaign.md')).toBeTruthy();
    expect(screen.getByText('clients/acme-heating/plans/2026-10-20-winter-boiler-campaign.md')).toBeTruthy();
    expect(screen.getByText('1,840 words')).toBeTruthy();
    expect(screen.getByText('28 Oct 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Contents/ })).toBeTruthy();
    expect(screen.getByText('Campaign structure')).toBeTruthy();
    expect(screen.getByText('Brief: Winter offer landing page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Claude about it' }));
    expect(store.newChat).toHaveBeenCalledWith({
      draft: 'Help me with this document: clients/acme-heating/plans/2026-10-20-winter-boiler-campaign.md',
    });
  });

  it('calls a sheet’s headings its columns', () => {
    docsStore.set({ currentId: 'acme-heating/2026-10-21-winter-budget-split.xlsx' });
    render(<DocumentsPanel />);
    expect(screen.getByRole('button', { name: /Columns/ })).toBeTruthy();
    expect(screen.getByText('36 rows')).toBeTruthy();
  });
});
