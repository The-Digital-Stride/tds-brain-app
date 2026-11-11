import { useSyncExternalStore } from 'react';

/** What every library app keeps: whose library, the item in the panel, the items ticked. */
export interface LibraryState {
  client: string;
  /** The item shown in the panel. */
  currentId: string | null;
  /** The items ticked for a bulk action. */
  ticked: ReadonlySet<string>;
}

export interface LibraryStore<S extends LibraryState> {
  get(): S;
  set(patch: Partial<S>): void;
  toggleTick(id: string): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

/**
 * A small store for an app whose sheet and panel are mounted in different places in the shell and
 * both need the same state, so it lives outside React.
 */
export function createLibraryStore<S extends LibraryState>(initial: () => S): LibraryStore<S> {
  let state = initial();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  const set = (patch: Partial<S>) => {
    // Another client's library is a different one: nothing stays picked.
    const moved = patch.client !== undefined && patch.client !== state.client;
    state = { ...state, ...(moved ? { currentId: null, ticked: new Set<string>() } : null), ...patch };
    emit();
  };
  return {
    get: () => state,
    set,
    toggleTick(id) {
      const ticked = new Set(state.ticked);
      if (!ticked.delete(id)) ticked.add(id);
      state = { ...state, ticked };
      emit();
    },
    reset() {
      state = initial();
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useLibrary<S extends LibraryState>(store: LibraryStore<S>): S {
  return useSyncExternalStore(store.subscribe, store.get);
}
