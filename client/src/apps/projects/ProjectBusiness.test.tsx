// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectBusinessResponse } from '../../../../shared/project-business-contract.ts';

const store = vi.hoisted(() => ({ openView: vi.fn() }));
const dispatch = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => ({ library: vi.fn(), projectBusiness: vi.fn() }));
const openLibraryItem = vi.hoisted(() => vi.fn());
vi.mock('../shared/search.ts', () => ({ openLibraryItem }));
vi.mock('../../api.ts', () => ({ api }));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));

const { ProjectBusiness, showsBusiness } = await import('./ProjectBusiness.tsx');
const { ShellContext } = await import('../../shell/shell-context.ts');

const clients = [{ slug: 'skyseal', name: 'Skyseal' }];
const PATH = 'clients/skyseal/context/business.md';
const reply = (over: Partial<ProjectBusinessResponse> = {}): ProjectBusinessResponse => ({
  state: 'ok',
  client: { slug: 'skyseal', name: 'Skyseal', status: null },
  path: PATH,
  facts: [],
  sections: [],
  ...over,
});

const retry = vi.fn();
function show(data: ProjectBusinessResponse | null, error = false) {
  return render(
    <ShellContext.Provider value={{ dispatch } as never}>
      <ProjectBusiness card={{ client: 'skyseal' }} clients={clients} business={{ data, error, retry }} />
    </ShellContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectBusiness', () => {
  it('shows no card for a project without a client file', () => {
    const { container } = show(reply({ state: 'none', client: null, path: null }));
    expect(container.textContent).toBe('');
  });

  it('shows only the facts that are present, and only "Where they stand" open', () => {
    show(
      reply({
        facts: [{ id: 'contact', words: 'Main contact', value: 'Jo Smith', from: 'business' }],
        sections: [
          {
            title: 'Where they stand',
            heading: 'Where they stand',
            markdown: 'Going well.',
            cut: false,
            open: true,
            from: 'profile',
          },
          {
            title: 'What they sell',
            heading: 'What We Sell',
            markdown: 'Roof sealant.',
            cut: true,
            open: false,
            from: 'business',
          },
        ],
      }),
    );
    expect(screen.getByRole('heading', { name: 'About Skyseal' })).toBeTruthy();
    expect(screen.getByText('Main contact')).toBeTruthy();
    expect(screen.queryByText('Monthly budget')).toBeNull();
    const open = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-expanded');
    expect(open('Where they stand')).toBe('true');
    expect(open('What they sell')).toBe('false');
    expect(screen.getByText('Shortened here. Open the business file for the rest.')).toBeTruthy();
    expect(screen.getByText(/It's changed there, not here\./)).toBeTruthy();
  });

  it('has no edit, update or ask control', () => {
    show(reply({ facts: [{ id: 'kpi', words: 'Judged on', value: 'Leads', from: 'business' }] }));
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Open the business file']);
  });

  it('says so when there is no business file', () => {
    show(reply({ state: 'missing', path: null }));
    expect(
      screen.getByText("There's no business file for Skyseal yet. It's made in the brain with client-setup."),
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says so when the file cannot be read', () => {
    show(reply({ state: 'unreadable', path: null }));
    expect(screen.getByText("The business file for Skyseal can't be read.")).toBeTruthy();
  });

  it('says so when the file is not in the usual layout, and still offers it', () => {
    show(reply());
    expect(
      screen.getByText(
        "Skyseal's business file isn't laid out in the usual way, so nothing is picked out here.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open the business file' })).toBeTruthy();
  });

  it('names the profile when only profile.md had something', () => {
    show(
      reply({ path: null, facts: [{ id: 'contact', words: 'Main contact', value: 'Pat', from: 'profile' }] }),
    );
    expect(
      screen.getByText("From the client's profile in the brain. It's changed there, not here."),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open the business file' })).toBeNull();
  });

  it('says when the request failed and offers Try again', () => {
    show(null, true);
    expect(screen.getByText("Couldn't read the client background just now.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('puts the section titles under the card title in the heading outline', () => {
    show(
      reply({
        sections: [
          {
            title: 'Where they stand',
            heading: 'Where they stand',
            markdown: 'Doing well.',
            cut: false,
            open: true,
            from: 'profile',
          },
        ],
      }),
    );
    expect(screen.getByRole('heading', { level: 3, name: 'About Skyseal' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: /Where they stand/ })).toBeTruthy();
  });

  it('opens the business file in Documents by its path', async () => {
    const item = { id: 'x', path: PATH };
    api.library.mockResolvedValue({ items: [{ id: 'y', path: 'clients/skyseal/other.md' }, item] });
    show(reply());
    fireEvent.click(screen.getByRole('button', { name: 'Open the business file' }));
    await waitFor(() => expect(openLibraryItem).toHaveBeenCalledWith('documents', 'client:skyseal', item));
    expect(api.library).toHaveBeenCalledWith('client:skyseal');
    expect(store.openView).toHaveBeenCalledWith('app:documents');
  });

  it('says where to look when the file is not in the library', async () => {
    api.library.mockResolvedValue({ items: [] });
    show(reply());
    fireEvent.click(screen.getByRole('button', { name: 'Open the business file' }));
    await screen.findByText("The business file can't be opened from here. Look for it in Documents.");
    expect(openLibraryItem).not.toHaveBeenCalled();
  });
});

describe('showsBusiness', () => {
  it('is for live client projects only', () => {
    expect(showsBusiness({ archived: false, space: 'client', client: 'skyseal' })).toBe(true);
    expect(showsBusiness({ archived: true, space: 'client', client: 'skyseal' })).toBe(false);
    expect(showsBusiness({ archived: false, space: 'personal', client: null })).toBe(false);
    expect(showsBusiness({ archived: false, space: 'client', client: 'the-digital-stride' })).toBe(false);
  });
});
