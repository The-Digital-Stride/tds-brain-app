import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LibraryItem, LibraryKind, LibraryScope } from '../../../../shared/contract.ts';
import { api } from '../../api.ts';
import { useStore } from '../../store.tsx';
import { pickScope } from './library.ts';
import { type LibraryState, type LibraryStore, useLibrary } from './store.ts';

export type Loaded<T> =
  | { status: 'loading'; data: null; message: null; retry: () => void }
  | { status: 'failed'; data: null; message: string; retry: () => void }
  | { status: 'ready'; data: T; message: null; retry: () => void };

interface Slot<T> {
  key: string;
  data: T | null;
  message: string;
}

function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.';
}

/**
 * Loads one thing for a key. A new key starts again from "loading"; a new `version` with the same key
 * fetches quietly and swaps the answer in, so the screen does not flash. A null key loads nothing.
 */
export function useLoaded<T>(key: string | null, version: number, load: () => Promise<T>): Loaded<T> {
  const [slot, setSlot] = useState<Slot<T> | null>(null);
  const [tries, setTries] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (key === null) return;
    let live = true;
    // `version` and `tries` only re-run this effect; the answer does not depend on them.
    void version;
    void tries;
    loadRef.current().then(
      (data) => {
        if (live) setSlot({ key, data, message: '' });
      },
      (err: unknown) => {
        // A refresh that fails keeps what is already on screen.
        if (live)
          setSlot((prev) =>
            prev?.key === key && prev.data !== null ? prev : { key, data: null, message: messageOf(err) },
          );
      },
    );
    return () => {
      live = false;
    };
  }, [key, version, tries]);

  const retry = useCallback(() => {
    setSlot(null);
    setTries((n) => n + 1);
  }, []);

  const mine = slot && slot.key === key ? slot : null;
  if (!mine) return { status: 'loading', data: null, message: null, retry };
  if (mine.data === null) return { status: 'failed', data: null, message: mine.message, retry };
  return { status: 'ready', data: mine.data, message: null, retry };
}

export interface LibraryData {
  status: 'loading' | 'failed' | 'ready';
  message: string | null;
  retry: () => void;
  scopes: LibraryScope[];
  /** The library on screen: what was chosen, else the default. */
  scope: string;
  scopeName: string;
  /** Every item of this app's kind in the scope, before any search. */
  items: LibraryItem[];
  /** The server's card order, for the whole scope. */
  order: string[];
  truncated: boolean;
}

const NONE: LibraryItem[] = [];

/**
 * Everything a library sheet needs from the server: the scopes, the one on screen and its items of
 * this app's kind. Refetches when the store says the library changed.
 */
export function useLibraryData<S extends LibraryState>(
  store: LibraryStore<S>,
  kind: LibraryKind,
): LibraryData {
  const s = useLibrary(store);
  const { libraryVersion, boot } = useStore();
  const scopesLoad = useLoaded('scopes', libraryVersion, () => api.libraryScopes());
  const scopes = scopesLoad.data ?? [];
  const scope = pickScope(scopes, boot?.prefs.lastClient ?? null, s.scope);
  const listing = useLoaded(scopesLoad.status === 'ready' && scope ? scope : null, libraryVersion, () =>
    api.library(scope),
  );

  // Hold the library the screen fell back to, so choosing that same client later drops nothing.
  const ready = scopesLoad.status === 'ready';
  useEffect(() => {
    if (ready && scope && scope !== store.get().scope) store.settle(scope);
  }, [ready, scope, store]);

  const own = listing.data;
  const items = own ? own.items.filter((i) => i.kind === kind) : NONE;
  const base = { scopes, scope, scopeName: scopes.find((x) => x.id === scope)?.name ?? '' };
  const done = { items, order: own?.groups ?? [], truncated: own?.truncated ?? false };

  if (scopesLoad.status !== 'ready') {
    return {
      ...base,
      ...done,
      status: scopesLoad.status,
      message: scopesLoad.message,
      retry: scopesLoad.retry,
    };
  }
  // Nothing listed at all: the screen is simply empty.
  if (!scope) return { ...base, ...done, status: 'ready', message: null, retry: scopesLoad.retry };
  return { ...base, ...done, status: listing.status, message: listing.message, retry: listing.retry };
}

/**
 * Keeps the panel's item and the open file honest as the listing refreshes: a changed file is
 * swapped for its new details, and one that has gone is dropped.
 */
export function useKeepCurrent<S extends LibraryState>(store: LibraryStore<S>, data: LibraryData) {
  const { items, status } = data;
  useEffect(() => {
    if (status !== 'ready') return;
    const { current, viewing } = store.get();
    const patch: Partial<LibraryState> = {};
    if (current) {
      const fresh = items.find((i) => i.id === current.id) ?? null;
      if (fresh !== current) patch.current = fresh;
    }
    if (viewing) {
      const fresh = items.find((i) => i.id === viewing.id) ?? null;
      if (fresh !== viewing) patch.viewing = fresh;
    }
    if (patch.current !== undefined || patch.viewing !== undefined) store.set(patch as Partial<S>);
  }, [items, status, store]);
}

/** The element that scrolls the sheet, found from anything inside it. */
function scrollerOf(root: RefObject<HTMLElement | null>): HTMLElement | null {
  return root.current?.closest<HTMLElement>('.sheet-scroll') ?? null;
}

/**
 * Opening a file swaps the list for the viewer. Going back puts the list's scroll position and the
 * focus (on that item's open button) where they were. The list stays mounted but hidden, so
 * nothing else about it is lost.
 */
export function useViewerReturn<S extends LibraryState>(
  store: LibraryStore<S>,
  root: RefObject<HTMLElement | null>,
  fallback: RefObject<HTMLElement | null>,
) {
  const { viewing } = useLibrary(store);
  const saved = useRef(0);
  const lastId = useRef<string | null>(null);

  // The list is still on screen when the store changes, so the position is read here, not after.
  useEffect(() => {
    let was = store.get().viewing;
    return store.subscribe(() => {
      const now = store.get().viewing;
      if (now && !was) saved.current = scrollerOf(root)?.scrollTop ?? 0;
      was = now;
    });
  }, [store, root]);

  useLayoutEffect(() => {
    if (viewing) {
      lastId.current = viewing.id;
      return;
    }
    const id = lastId.current;
    if (!id) return;
    lastId.current = null;
    const bar = scrollerOf(root);
    if (bar) bar.scrollTop = saved.current;
    const button = [...(root.current?.querySelectorAll<HTMLElement>('[data-open-id]') ?? [])].find(
      (el) => el.dataset.openId === id,
    );
    button?.focus({ preventScroll: true });
    if (!button || document.activeElement !== button) fallback.current?.focus({ preventScroll: true });
  }, [viewing, root, fallback]);
}
