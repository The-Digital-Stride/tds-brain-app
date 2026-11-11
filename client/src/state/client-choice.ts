import { useSyncExternalStore } from 'react';

/**
 * The client the person is working on, shared by Home and every library app (Images, Documents), so
 * moving between them stays on the same client. It lives outside React because those screens are
 * mounted in different places and come and go.
 *
 * The value is a library scope id ("client:acme", "personal"), `NO_CLIENT` when "No client" was
 * picked on Home, or '' until the person chooses anything. It lasts until the page is reloaded.
 */
export const NO_CLIENT = 'none';

let chosen = '';
const listeners = new Set<() => void>();

export const clientChoice = {
  get: (): string => chosen,
  set(next: string): void {
    if (next === chosen) return;
    chosen = next;
    for (const l of [...listeners]) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useClientChoice(): string {
  return useSyncExternalStore(clientChoice.subscribe, clientChoice.get);
}

/** The client's folder name in a choice; '' when the choice is no client at all; null when nothing was chosen. */
export function clientSlugOf(choice: string): string | null {
  if (choice === '') return null;
  return choice.startsWith('client:') ? choice.slice('client:'.length) : '';
}

/** The choice for a client picked by folder name; '' is Home's "No client". */
export function scopeForClient(slug: string): string {
  return slug ? `client:${slug}` : NO_CLIENT;
}
