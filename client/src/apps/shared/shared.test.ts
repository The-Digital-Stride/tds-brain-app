import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clientChoice, NO_CLIENT } from '../../state/client-choice.ts';
import { groupItems, pickScope, pictureWords } from './library.ts';
import { createLibraryStore, type LibraryState } from './store.ts';
import { doc, item, SCOPES } from './testing.ts';
import { dateWords, matchesWords, plural, selectionWords, sizeWords } from './words.ts';

describe('words', () => {
  it('writes sizes in KB below a megabyte and MB above', () => {
    expect(sizeWords(900)).toBe('1 KB');
    expect(sizeWords(184_000)).toBe('184 KB');
    expect(sizeWords(2_400_000)).toBe('2.4 MB');
    expect(sizeWords(999_400)).toBe('999 KB');
    expect(sizeWords(999_500)).toBe('1.0 MB');
  });

  it('writes a date the UK way, from a day or a full time', () => {
    expect(dateWords('2026-11-03')).toBe('3 Nov 2026');
    expect(dateWords('2026-11-05T10:00:00.000Z')).toBe('5 Nov 2026');
    expect(dateWords('2026-09-15T08:00:00.000Z')).toBe('15 Sep 2026');
    expect(dateWords('not a date')).toBe('');
  });

  it('reads the day as it is in London, not in UTC', () => {
    // 23:30 UTC in summer is already the next day in London.
    expect(dateWords('2026-07-01T23:30:00.000Z')).toBe('2 Jul 2026');
  });

  it('picks the form of the noun and groups thousands', () => {
    expect(plural(0, 'row', 'rows')).toBe('0 rows');
    expect(plural(1, 'row', 'rows')).toBe('1 row');
    expect(plural(1840, 'word', 'words')).toBe('1,840 words');
  });

  it('says when the filter is hiding part of the selection', () => {
    expect(selectionWords('3 images', 0)).toBe('3 images selected');
    expect(selectionWords('3 images', 2)).toBe('3 images selected, 2 hidden by your search');
    expect(selectionWords('3 documents', 2, 'your search or filter')).toBe(
      '3 documents selected, 2 hidden by your search or filter',
    );
  });

  it('matches every word of a search, in any order and any case', () => {
    expect(matchesWords('Winter boiler campaign', 'BOILER winter')).toBe(true);
    expect(matchesWords('Winter boiler campaign', 'boiler summer')).toBe(false);
    expect(matchesWords('anything', '   ')).toBe(true);
  });
});

describe('pictureWords', () => {
  it('gives the size when known and nothing when not', () => {
    expect(pictureWords(item())).toBe('1200 × 628');
    expect(pictureWords(item({ width: null, height: null }))).toBeNull();
  });
});

describe('pickScope', () => {
  it('keeps what was chosen while it is still listed', () => {
    expect(pickScope(SCOPES, 'acme', 'client:northwind')).toBe('client:northwind');
    expect(pickScope(SCOPES, null, 'personal')).toBe('personal');
  });

  it('otherwise opens on the last client used', () => {
    expect(pickScope(SCOPES, 'northwind', '')).toBe('client:northwind');
    expect(pickScope(SCOPES, 'northwind', 'client:gone')).toBe('client:northwind');
  });

  it('otherwise the first client, and never the personal files while a client exists', () => {
    expect(pickScope(SCOPES, null, '')).toBe('client:acme');
    expect(pickScope(SCOPES, 'removed-client', '')).toBe('client:acme');
  });

  it('uses the personal files only when there is no client at all', () => {
    expect(
      pickScope(
        [SCOPES[0]].filter((s) => s !== undefined),
        'acme',
        '',
      ),
    ).toBe('personal');
    expect(pickScope([], null, '')).toBe('');
  });
});

describe('groupItems', () => {
  it('follows the server’s card order and leaves empty cards out', () => {
    const items = [
      item({ id: 'b', group: 'Photos' }),
      item({ id: 'a', group: 'Brand' }),
      item({ id: 'c', group: 'Brand' }),
    ];
    const groups = groupItems(items, ['Brand', 'Reports', 'Photos']);
    expect(groups.map((g) => g.group)).toEqual(['Brand', 'Photos']);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('puts a card the order does not name last rather than losing it', () => {
    const groups = groupItems([doc({ group: 'Odd' }), doc({ id: 'x', group: 'Reports' })], ['Reports']);
    expect(groups.map((g) => g.group)).toEqual(['Reports', 'Odd']);
  });
});

describe('createLibraryStore', () => {
  interface S extends LibraryState {
    query: string;
  }
  beforeEach(() => clientChoice.set(''));

  const make = () =>
    createLibraryStore<S>(() => ({ scope: 'a', query: '', current: null, viewing: null, ticked: new Set() }));

  it('ticks and unticks, and tells whoever is listening', () => {
    const store = make();
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    store.toggleTick('x');
    expect([...store.get().ticked]).toEqual(['x']);
    store.toggleTick('x');
    expect(store.get().ticked.size).toBe(0);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    store.toggleTick('y');
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('moving to another library drops the chosen item, the open file and the ticks, and nothing else', () => {
    const store = make();
    store.set({ current: item(), viewing: item(), query: 'van' });
    store.toggleTick('x');
    store.set({ scope: 'a' });
    expect(store.get().current).not.toBeNull();
    store.set({ scope: 'b' });
    expect(store.get()).toMatchObject({ scope: 'b', current: null, viewing: null, query: 'van' });
    expect(store.get().ticked.size).toBe(0);
  });

  it('reset goes back to the start', () => {
    const store = make();
    store.set({ scope: 'b', query: 'x' });
    store.reset();
    expect(store.get()).toMatchObject({ scope: 'a', query: '' });
  });

  it('every app is on the same library: choosing one in an app moves the others', () => {
    const images = make();
    const docs = make();
    images.set({ scope: 'client:acme' });
    expect(docs.get().scope).toBe('client:acme');
    // An app opened later starts on it too.
    expect(make().get().scope).toBe('client:acme');
  });

  it('an app moved from elsewhere drops its chosen item, open file and ticks, keeps its search, and says so', () => {
    const images = make();
    const docs = make();
    docs.set({ current: item(), viewing: item(), query: 'van' });
    docs.toggleTick('x');
    const heard = vi.fn();
    docs.subscribe(heard);
    images.set({ scope: 'client:acme' });
    expect(docs.get()).toMatchObject({ scope: 'client:acme', current: null, viewing: null, query: 'van' });
    expect(docs.get().ticked.size).toBe(0);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('a client chosen outside the apps (on Home) moves them too', () => {
    const docs = make();
    clientChoice.set('client:northwind');
    expect(docs.get().scope).toBe('client:northwind');
  });

  it('choosing the client already on screen keeps what is picked and open', () => {
    const docs = createLibraryStore<S>(() => ({
      scope: '',
      query: '',
      current: null,
      viewing: null,
      ticked: new Set(),
    }));
    // Nothing chosen yet: the screen fell back to the last client and says so.
    docs.settle('client:northwind');
    docs.set({ current: item(), viewing: item() });
    docs.toggleTick('x');
    clientChoice.set('client:northwind');
    expect(docs.get().current).not.toBeNull();
    expect(docs.get().viewing).not.toBeNull();
    expect([...docs.get().ticked]).toEqual(['x']);
  });

  it('settling on the library the screen fell back to tells nobody and drops nothing', () => {
    const images = make();
    const docs = make();
    docs.set({ current: item() });
    docs.toggleTick('x');
    const heard = vi.fn();
    images.subscribe(heard);
    docs.settle('client:acme');
    expect(docs.get()).toMatchObject({ scope: 'client:acme' });
    expect(docs.get().current).not.toBeNull();
    expect(docs.get().ticked.size).toBe(1);
    expect(clientChoice.get()).toBe('');
    expect(images.get().scope).toBe('a');
    expect(heard).not.toHaveBeenCalled();
  });

  it('"No client" on Home leaves the apps where they are', () => {
    const docs = make();
    docs.set({ scope: 'client:acme' });
    docs.set({ current: item() });
    docs.toggleTick('x');
    clientChoice.set(NO_CLIENT);
    expect(docs.get().scope).toBe('client:acme');
    expect(docs.get().current).not.toBeNull();
    expect(docs.get().ticked.size).toBe(1);
  });
});
