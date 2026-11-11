import { describe, expect, it, vi } from 'vitest';
import { createLibraryStore, type LibraryState } from './store.ts';
import { matchesWords, plural } from './words.ts';

describe('plural', () => {
  it('picks the form of the noun and groups thousands', () => {
    expect(plural(0, 'row', 'rows')).toBe('0 rows');
    expect(plural(1, 'row', 'rows')).toBe('1 row');
    expect(plural(1840, 'word', 'words')).toBe('1,840 words');
  });
});

describe('matchesWords', () => {
  it('needs every word, in any order and any case', () => {
    expect(matchesWords('Winter boiler campaign', 'BOILER winter')).toBe(true);
    expect(matchesWords('Winter boiler campaign', 'boiler summer')).toBe(false);
    expect(matchesWords('anything', '   ')).toBe(true);
  });
});

describe('createLibraryStore', () => {
  interface S extends LibraryState {
    query: string;
  }
  const make = () =>
    createLibraryStore<S>(() => ({ client: 'a', query: '', currentId: null, ticked: new Set() }));

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

  it('moving to another client drops the chosen item and the ticks, and nothing else', () => {
    const store = make();
    store.set({ currentId: 'x', query: 'van' });
    store.toggleTick('x');
    store.set({ client: 'a' });
    expect(store.get().currentId).toBe('x');
    store.set({ client: 'b' });
    expect(store.get()).toMatchObject({ client: 'b', currentId: null, query: 'van' });
    expect(store.get().ticked.size).toBe(0);
  });

  it('reset goes back to the start', () => {
    const store = make();
    store.set({ client: 'b', query: 'x' });
    store.reset();
    expect(store.get()).toMatchObject({ client: 'a', query: '' });
  });
});
