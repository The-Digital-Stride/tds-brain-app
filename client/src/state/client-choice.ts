import { useEffect, useSyncExternalStore } from 'react';
import type { ProjectChoice } from '../../../shared/projects-contract.ts';
import { projectsStore } from './projects.ts';

/**
 * The client the person is working on, shared by Home and every library app (Images, Documents), so
 * moving between them stays on the same client. It lives outside React because those screens are
 * mounted in different places and come and go.
 *
 * The value is a library scope id ("client:acme", "personal"), `NO_CLIENT` when "No client" was
 * picked on Home, or '' until the person chooses anything. It lasts until the page is reloaded.
 */
export const NO_CLIENT = 'none';

interface Choice {
  client: string;
  project: ProjectChoice;
}

// One snapshot, replaced whole on every change, so a reader never sees a client and a project that
// disagree (decision 11). `get`/`set` below are the client-only view of it and keep working as before.
let state: Choice = { client: '', project: '' };
const listeners = new Set<() => void>();

/** The client choice a project implies: its client folder, or "personal" for a personal project. */
export function clientForProject(key: string): string {
  const client = key.split('/')[0] ?? '';
  return client === 'personal' ? 'personal' : `client:${client}`;
}

function publish(next: Choice): void {
  if (next.client === state.client && next.project === state.project) return;
  state = next;
  for (const l of [...listeners]) l();
}

/** Sets client and project together. A project must belong to the client: otherwise the client wins and the project clears. */
export function setChoice(next: { client: string; project: ProjectChoice }): void {
  const project = next.project && clientForProject(next.project) === next.client ? next.project : '';
  publish({ client: next.client, project });
}

export const clientChoice = {
  get: (): string => state.client,
  /** Choosing a different client clears the project; choosing the same one keeps it. */
  set(next: string): void {
    publish({ client: next, project: next === state.client ? state.project : '' });
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const projectChoice = {
  get: (): Choice => state,
  /** A project always sets its client with it; '' clears the project only. */
  set(key: ProjectChoice): void {
    publish(key ? { client: clientForProject(key), project: key } : { client: state.client, project: '' });
  },
  subscribe: clientChoice.subscribe,
};

export function useClientChoice(): string {
  return useSyncExternalStore(clientChoice.subscribe, clientChoice.get);
}

/**
 * The chosen project key ('' for none). While one is chosen it clears itself if the projects list
 * loads without it (closed out of existence, or the folder went), so no screen filters to nothing.
 */
export function useProjectChoice(): ProjectChoice {
  const { project } = useSyncExternalStore(projectChoice.subscribe, projectChoice.get);
  const { list } = useSyncExternalStore(projectsStore.subscribe, projectsStore.get);
  useEffect(() => {
    if (project) projectsStore.ensure();
  }, [project]);
  useEffect(() => {
    if (project && list && !list.projects.some((p) => p.key === project)) projectChoice.set('');
  }, [project, list]);
  return project;
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

/**
 * The client a chat about a to-do starts with, as `newChat`'s `client` option: a personal to-do has
 * none (null); a TDS to-do keeps its client while that client is still in the brain; otherwise
 * undefined, so the client is worked out from the message like any new chat.
 */
export function todoChatClient(
  todo: { key: string; client: string | null },
  clients: readonly { slug: string }[],
): string | null | undefined {
  if (todo.key.startsWith('personal/')) return null;
  const slug = todo.client;
  return slug && clients.some((c) => c.slug === slug) ? slug : undefined;
}
