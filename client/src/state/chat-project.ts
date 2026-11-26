import { matchedKey, movedKey } from '../../../shared/projects.ts';
import type { ProjectCard, ProjectKey } from '../../../shared/projects-contract.ts';
import { placeName } from '../shell/words.ts';
import { clientForProject, clientSlugOf } from './client-choice.ts';

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
  // A live project at the key always wins (as on the server); else one that moved away from it since the chat was
  // saved, shown under its client now. `movedKey` keeps a teammate's moved card off my own personal key.
  const exact = project ? cards?.find((c) => c.key === project) : undefined;
  const moved = project && !exact && cards ? movedKey(project, [...cards]) : null;
  const card = exact ?? (moved ? cards?.find((c) => c.key === moved) : undefined);
  const now = card && card.key !== project && card.client !== undefined ? card.client : client;
  const clientName = now ? placeName(now, clients) : '';
  const title = card ? card.title || card.slug : '';
  return [clientName, title].filter(Boolean).join(' · ');
}

// ---- The scope row (plan 2026-11-26-project-chat-in-place, decisions 3 and 4) -------------------------------------

/** Chat for's values that are not a client: guess it from the message, or no client. */
export const AUTO = '@auto';
export const NONE = '@none';
/** The Project picker's "No project" value in a chat-bound row. */
export const NO_PROJECT = '';

type Cards =
  | readonly Pick<ProjectCard, 'key' | 'client' | 'space' | 'archived' | 'title' | 'slug'>[]
  | undefined;
type Clients = readonly { slug: string }[];
export interface ScopePicks {
  project: ProjectKey | '';
  client: string;
}

export interface ChatScopeInput {
  /** The project the chat was opened with; null when none. */
  presetProject: ProjectKey | null;
  /** The client the chat was opened with: a slug, null for no client, undefined when it wasn't given. */
  presetClient: string | null | undefined;
  /** Home's app-wide Working on ('' when none). Read only in an app-bound row. */
  workingOn: ProjectKey | '';
  /** 'chat' or 'app', from `NewChat.scope` (fixed when the chat was made). */
  bound: 'app' | 'chat';
  /**
   * The row's picks, or undefined until the person touches a picker. Chat-bound: always a consistent pair, written
   * only by `pickProject` / `pickClient`. App-bound: only `client` is read (Working on is app-wide).
   */
  picks: ScopePicks | undefined;
  cards: Cards;
  clients: Clients;
}

export interface ChatScopeView {
  /** 'app': "Working on", writes `projectChoice`. 'chat': "Project", writes this chat's pick only. */
  bound: 'app' | 'chat';
  projectLabel: 'Working on' | 'Project';
  /** The project picker's value: a key, or ''. */
  project: ProjectKey | '';
  /** Chat for's value: AUTO, NONE or a client slug. */
  client: string;
  /** True when Chat for's value came from the project, not a hand pick (the "Set by …" screen-reader note). */
  clientSetByProject: boolean;
  /** The project to send once the final client is known (Auto resolves later). */
  projectFor: (finalClient: string | null) => ProjectKey | null;
}

function liveCard<T extends Pick<ProjectCard, 'key' | 'archived'>>(
  key: ProjectKey | '' | null | undefined,
  cards: readonly T[] | undefined,
): T | undefined {
  const card = key ? cards?.find((c) => c.key === key) : undefined;
  return card && !card.archived ? card : undefined;
}

/** A project's own client as Chat for shows it: its slug, or NONE (personal, or a client not in the list). */
function ownChoice(card: Pick<ProjectCard, 'key' | 'client' | 'space'>, clients: Clients): string {
  return projectChatPlace(card, clients).client ?? NONE;
}

/**
 * What the scope row shows and sends. App-bound (Home's own chat) is today's Home logic, unchanged. Chat-bound (a chat
 * opened for a project, or in the drawer): the project is this chat's own, the client follows it, and what is sent is
 * what is shown. An archived or unknown key is never shown and never sent.
 */
export function chatScope(input: ChatScopeInput): ChatScopeView {
  const { presetProject, presetClient, workingOn, bound, picks, cards, clients } = input;
  if (bound === 'app') {
    // Working on's project starts Chat for on its client (a personal project on No client); a client not in the list
    // leaves it on Auto.
    const fromProject = (() => {
      if (!workingOn) return null;
      const slug = clientSlugOf(clientForProject(workingOn));
      if (slug === '') return NONE;
      return slug && clients.some((c) => c.slug === slug) ? slug : null;
    })();
    const initial = presetClient !== undefined ? (presetClient ?? NONE) : (fromProject ?? AUTO);
    const byHand = picks !== undefined;
    const candidate = presetProject ?? (workingOn || null);
    return {
      bound,
      projectLabel: 'Working on',
      project: workingOn,
      client: byHand ? picks.client : initial,
      clientSetByProject: !byHand && presetClient === undefined && fromProject !== null,
      projectFor: (finalClient) => projectIfClientMatches(candidate, cards, clients, finalClient),
    };
  }

  let project: ProjectKey | '' = NO_PROJECT;
  let client: string;
  let setByProject = false;
  if (picks) {
    project = liveCard(picks.project, cards) ? picks.project : NO_PROJECT;
    client = picks.client;
    setByProject = project !== NO_PROJECT;
  } else {
    const card = liveCard(presetProject, cards);
    if (card) {
      const own = ownChoice(card, clients);
      // A client that isn't the project's own (a personal task on a client project) wins, with no project.
      if (presetClient !== undefined && (presetClient ?? NONE) !== own) {
        client = presetClient ?? NONE;
      } else {
        project = card.key;
        client = own;
        setByProject = presetClient === undefined;
      }
    } else {
      client = presetClient !== undefined ? (presetClient ?? NONE) : AUTO;
    }
  }
  return {
    bound,
    projectLabel: 'Project',
    project,
    client,
    clientSetByProject: setByProject,
    projectFor: (finalClient) => projectIfClientMatches(project || null, cards, clients, finalClient),
  };
}

/** Picking a project sets both: the project and its own client (NONE for personal; NO_PROJECT keeps the client). */
export function pickProject(
  key: ProjectKey | '',
  current: ScopePicks,
  cards: Cards,
  clients: Clients,
): ScopePicks {
  const card = liveCard(key, cards);
  return card
    ? { project: card.key, client: ownChoice(card, clients) }
    : { project: NO_PROJECT, client: current.client };
}

/** Picking a client sets both: the client, and NO_PROJECT unless it is the shown project's own client (AUTO clears it). */
export function pickClient(client: string, current: ScopePicks, cards: Cards, clients: Clients): ScopePicks {
  const card = liveCard(current.project, cards);
  return { project: card && ownChoice(card, clients) === client ? card.key : NO_PROJECT, client };
}
