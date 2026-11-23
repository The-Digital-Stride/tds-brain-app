import { useSyncExternalStore } from 'react';
import type { LibraryItem } from '../../../../shared/contract.ts';
import { clientChoice, NO_CLIENT } from '../../state/client-choice.ts';

/** What every library app keeps: whose library, the item in the panel, the file open, the items ticked. */
export interface LibraryState {
  /**
   * A scope id the person chose, or '' until they do (the screen then picks one itself). Every
   * library app and Home share it (`clientChoice`), so moving between them stays on one client.
   */
  scope: string;
  /** The item shown in the panel. Held whole, so the panel needs no listing of its own. */
  current: LibraryItem | null;
  /** The items ticked for a bulk action. */
  ticked: ReadonlySet<string>;
  /** This app's own project filter (a ProjectKey), '' or absent for none. The app-wide picker's project overrides it. */
  project?: string;
}

export interface LibraryStore<S extends LibraryState> {
  get(): S;
  set(patch: Partial<S>): void;
  /**
   * The screen fell back to a library (nothing chosen, "No client", or one no longer listed): hold it
   * as the scope, so choosing that same client later changes nothing. Drops nothing and tells no one.
   */
  settle(scope: string): void;
  /**
   * Opens `item` in its library (`scope`) in one update (global search): chosen in the panel, open in the
   * sheet when the app can view it (`item.view`), and the app's search and format filters cleared so the
   * item shows in the list when the person goes back. Ticks stay unless the library changes.
   */
  openItem(scope: string, item: LibraryItem): void;
  toggleTick(id: string): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

/**
 * A small store for an app whose sheet and panel are mounted in different places in the shell and
 * both need the same state, so it lives outside React.
 */
export function createLibraryStore<S extends LibraryState>(initial: () => S): LibraryStore<S> {
  // An app opened after a client was chosen elsewhere starts on that client.
  const start = (): S => {
    const s = initial();
    return clientChoice.get() ? { ...s, scope: clientChoice.get() } : s;
  };
  let state = start();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  // Another library is a different one: nothing stays picked or open.
  const moved = (scope: string): S => ({
    ...state,
    scope,
    current: null,
    ticked: new Set<string>(),
  });
  const set = (patch: Partial<S>) => {
    const moving = patch.scope !== undefined && patch.scope !== state.scope;
    state = { ...(moving ? moved(patch.scope as string) : state), ...patch };
    emit();
    // Tell Home and the other apps. This store already holds the scope, so it is not told twice.
    if (moving) clientChoice.set(state.scope);
  };
  // The client was chosen somewhere else: follow it. "No client" (or nothing yet) names no library,
  // so the app stays where it is, with what is picked and open.
  clientChoice.subscribe(() => {
    const scope = clientChoice.get();
    if (scope === state.scope || scope === NO_CLIENT || scope === '') return;
    state = moved(scope);
    emit();
  });
  return {
    get: () => state,
    set,
    settle(scope) {
      if (scope === state.scope) return;
      state = { ...state, scope };
      emit();
    },
    openItem(scope, item) {
      const base = initial() as unknown as Record<string, unknown>;
      const cleared: Record<string, unknown> = {};
      for (const key of ['query', 'format']) if (key in base) cleared[key] = base[key];
      // The app's own project filter goes too unless the item is in that project, or the list would leave it out.
      const projects: readonly string[] = item.projects ?? [];
      if (state.project && !projects.includes(state.project)) cleared.project = '';
      set({
        scope,
        current: item,
        ...cleared,
      } as unknown as Partial<S>);
    },
    toggleTick(id) {
      const ticked = new Set(state.ticked);
      if (!ticked.delete(id)) ticked.add(id);
      state = { ...state, ticked };
      emit();
    },
    reset() {
      state = initial();
      emit();
      clientChoice.set(state.scope);
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
