import { matchedKey } from '../../../shared/projects.ts';
import type { ProjectCard, ProjectKey } from '../../../shared/projects-contract.ts';
import { placeName } from '../shell/words.ts';

/**
 * The project a to-do's chat is for: its matched key, when that is a live (not archived) card in the list.
 * Null when it matches none, or the list isn't loaded yet.
 */
export function todoChatProject(
  todo: { projectMatch?: Parameters<typeof matchedKey>[0] },
  cards: readonly Pick<ProjectCard, 'key' | 'archived'>[] | undefined,
): ProjectKey | null {
  const key = matchedKey(todo.projectMatch);
  if (!key) return null;
  const card = cards?.find((c) => c.key === key);
  return card && !card.archived ? key : null;
}

/** What a new chat for a project page is opened with: the project and its client (null when personal or not listed). */
export function projectChatPlace(
  card: Pick<ProjectCard, 'key' | 'client' | 'space'>,
  clients: readonly { slug: string }[],
): { project: ProjectKey; client: string | null } {
  const client =
    card.space !== 'personal' && card.client && clients.some((c) => c.slug === card.client)
      ? card.client
      : null;
  return { project: card.key, client };
}

/**
 * The project a chat may send: only while the chat's final client is still the project's own (decision 2c). Needs the
 * project's card (from the loaded list), so a key the list doesn't know is never sent.
 */
export function projectIfClientMatches(
  key: ProjectKey | null | undefined,
  cards: readonly Pick<ProjectCard, 'key' | 'client' | 'space' | 'archived'>[] | undefined,
  clients: readonly { slug: string }[],
  client: string | null,
): ProjectKey | null {
  const card = key ? cards?.find((c) => c.key === key) : undefined;
  if (!card || card.archived) return null;
  return projectChatPlace(card, clients).client === client ? card.key : null;
}

/**
 * A chat's place in words for the Chats drawer: "Client · Project", the client alone, or the project alone
 * (a personal project). Empty when the chat has neither. A project the list doesn't know adds nothing.
 */
export function chatPlaceWords(
  client: string | null | undefined,
  project: ProjectKey | null | undefined,
  clients: readonly { slug: string; name: string }[],
  cards:
    | readonly (Pick<ProjectCard, 'key' | 'title' | 'slug'> & {
        client?: string | null;
        movedFrom?: string[];
      })[]
    | undefined,
): string {
  // A project that moved since the chat was saved is found by its old key, and shown under its client now.
  const card = project
    ? cards?.find((c) => c.key === project || (c.movedFrom ?? []).includes(project))
    : undefined;
  const now = card && card.key !== project && card.client !== undefined ? card.client : client;
  const clientName = now ? placeName(now, clients) : '';
  const title = card ? card.title || card.slug : '';
  return [clientName, title].filter(Boolean).join(' · ');
}
