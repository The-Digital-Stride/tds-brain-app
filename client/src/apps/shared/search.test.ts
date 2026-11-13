import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryScope } from '../../../../shared/contract.ts';
import type { SearchActions } from '../../shell/contract.ts';

const api = vi.hoisted(() => ({ librarySearch: vi.fn() }));
vi.mock('../../api.ts', () => ({ api }));

const { documentsSearch } = await import('../documents/search.ts');
const { imagesSearch } = await import('../images/search.ts');
const { openLibraryItem, warmLibrarySearch } = await import('./search.ts');
const { docsStore } = await import('../documents/store.ts');
const { imagesStore } = await import('../images/store.ts');
const { doc, item } = await import('./testing.ts');

const acme: LibraryScope = { id: 'client:acme', name: 'Acme Heating Ltd', kind: 'client' };
const mine: LibraryScope = { id: 'personal', name: 'My personal files', kind: 'personal' };

beforeEach(() => {
  api.librarySearch.mockReset();
  docsStore.reset();
  imagesStore.reset();
});

describe('library search sources', () => {
  it('declare themselves as async sources with the app title', () => {
    expect(documentsSearch).toMatchObject({ id: 'documents', title: 'Documents' });
    expect(imagesSearch).toMatchObject({ id: 'images', title: 'Images' });
    expect(documentsSearch.search).toBeUndefined();
    expect(documentsSearch.searchAsync).toBeTypeOf('function');
  });

  it('ask the server for their own kind and pass the abort signal on', async () => {
    api.librarySearch.mockResolvedValue({ hits: [], total: 0, partial: false });
    const signal = new AbortController().signal;
    await documentsSearch.searchAsync?.('report', signal);
    expect(api.librarySearch).toHaveBeenCalledWith('report', 'document', { signal });
    await imagesSearch.searchAsync?.('logo', signal);
    expect(api.librarySearch).toHaveBeenLastCalledWith('logo', 'image', { signal });
  });

  it('turn hits into rows hinted with the scope name, "My personal files" for personal ones', async () => {
    const report = doc({ id: 'client:acme.d1', title: 'October report' });
    const note = doc({ id: 'personal.d2', title: 'Private note' });
    api.librarySearch.mockResolvedValue({
      hits: [
        { item: report, scope: acme },
        { item: note, scope: mine },
      ],
      total: 31,
      partial: true,
    });
    const res = await documentsSearch.searchAsync?.('o', new AbortController().signal);
    expect(res?.total).toBe(31);
    expect(res?.partial).toBe(true);
    expect(res?.hits.map((h) => [h.id, h.label, h.hint, h.icon])).toEqual([
      ['client:acme.d1', 'October report', 'Acme Heating Ltd', 'doc'],
      ['personal.d2', 'Private note', 'My personal files', 'doc'],
    ]);
  });

  it('a hit opens the item in its app through the palette action', async () => {
    const logo = item({ id: 'client:acme.i1', title: 'Acme logo' });
    api.librarySearch.mockResolvedValue({ hits: [{ item: logo, scope: acme }], total: 1, partial: false });
    const res = await imagesSearch.searchAsync?.('logo', new AbortController().signal);
    const actions = { openLibraryItem: vi.fn() } as unknown as SearchActions;
    res?.hits[0]?.run(actions);
    expect(actions.openLibraryItem).toHaveBeenCalledWith('images', 'client:acme', logo);
  });

  it('openLibraryItem routes to the right app store', () => {
    const logo = item({ view: 'image' });
    const report = doc({ view: null });
    // The chosen client is shared, so each app is checked on its own.
    openLibraryItem('images', 'client:acme', logo);
    expect(imagesStore.get()).toMatchObject({ scope: 'client:acme', current: logo, viewing: logo });
    openLibraryItem('documents', 'client:northwind', report);
    expect(docsStore.get()).toMatchObject({ scope: 'client:northwind', current: report, viewing: null });
  });

  it('openLibraryItem ignores an app it does not know', () => {
    expect(() => openLibraryItem('nope', 'x', item())).not.toThrow();
  });
});

describe('warmLibrarySearch', () => {
  it('asks the server once, however often it is called, and shrugs off a failure', async () => {
    api.librarySearch.mockRejectedValue(new Error('down'));
    warmLibrarySearch();
    warmLibrarySearch();
    await Promise.resolve();
    await Promise.resolve();
    expect(api.librarySearch).toHaveBeenCalledTimes(1);
    expect(api.librarySearch).toHaveBeenCalledWith('zz', 'document');
  });
});
