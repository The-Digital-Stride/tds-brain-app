import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { TodoItem } from '../../../shared/contract.ts';
import {
  canTakeTask,
  isRestricted,
  outsideProjectNote,
  RESTRICTED_LABEL,
} from '../../../shared/project-visibility.ts';
import { matchedKey, projectLabel } from '../../../shared/projects.ts';
import type { ProjectCard, ProjectList, TodoProjectMatch } from '../../../shared/projects-contract.ts';
import { api } from '../api.ts';
import type { PickOption } from '../shell/search-select.ts';
import { todoPlaces } from '../shell/words.ts';

/**
 * One shared cache of the projects list for the whole page (like client-choice.ts, an external store so
 * every screen sees the same list). Loaded on first use, refreshed when the window gains focus.
 */
interface Snapshot {
  list: ProjectList | null;
  error: string | null;
}

let snap: Snapshot = { list: null, error: null };
let started = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: Snapshot): void {
  snap = next;
  for (const l of [...listeners]) l();
}

export const projectsStore = {
  get: (): Snapshot => snap,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** GET again. Overlapping calls share one request. Failures keep the last good list. */
  refresh(): Promise<void> {
    if (inflight) return inflight;
    inflight = Promise.resolve()
      .then(() => api.projects())
      .then((list) => emit({ list, error: null }))
      .catch((e: unknown) => emit({ list: snap.list, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },
  /** Starts the first load once; later loads come from focus and `refresh`. */
  ensure(): void {
    if (started) return;
    started = true;
    void projectsStore.refresh();
  },
  /** After a change returned a fresh list. */
  apply(next: ProjectList): void {
    emit({ list: next, error: null });
  },
  /** Tests only: forget everything. */
  reset(): void {
    snap = { list: null, error: null };
    started = false;
    inflight = null;
    listeners.clear();
  },
};

export function useProjects(): {
  list: ProjectList | null;
  error: string | null;
  refresh(): Promise<void>;
  apply(next: ProjectList): void;
} {
  const s = useSyncExternalStore(projectsStore.subscribe, projectsStore.get);
  useEffect(() => {
    projectsStore.ensure();
    const onFocus = () => void projectsStore.refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  const refresh = useCallback(() => projectsStore.refresh(), []);
  const apply = useCallback((next: ProjectList) => projectsStore.apply(next), []);
  return { list: s.list, error: s.error, refresh, apply };
}

// ─── Helpers for the pickers and filters ───────────────────────────────────────────────────────────

/** A project in a picker: "Client · Title", with the client's display name when the list of clients has it. */
export function projectText(
  card: Pick<ProjectCard, 'title' | 'client'>,
  clients: readonly { slug: string; name: string }[],
): string {
  if (!card.client) return card.title || 'Untitled project';
  return projectLabel(card, clients.find((c) => c.slug === card.client)?.name);
}

/** "Client · Project" for a key, from the cache; null when the project is not in the list. */
export function labelForKey(
  key: string,
  cards: readonly ProjectCard[] | undefined,
  clients: readonly { slug: string; name: string }[],
): string | null {
  const card = cards?.find((c) => c.key === key);
  return card ? projectText(card, clients) : null;
}

/** Closed or archived projects are left out of pickers for new work. */
export function isOpenProject(card: Pick<ProjectCard, 'status' | 'archived'>): boolean {
  return !card.archived && card.status !== 'done';
}

/** Options for an app's project filter: every live project, under its client. */
export function filterOptions(
  cards: readonly ProjectCard[],
  clients: readonly { slug: string; name: string; aliases?: string[] }[],
): PickOption[] {
  return cards.filter((c) => !c.archived).map((c) => projectOption(c, clients));
}

/**
 * One project as a picker option: its own name, under its client's heading ("Mine" for a personal
 * one), so a long name still fits the box once chosen.
 */
function projectOption(
  c: ProjectCard,
  clients: readonly { slug: string; name: string; aliases?: readonly string[] }[],
): PickOption {
  const client = clients.find((x) => x.slug === c.client);
  return {
    value: c.key,
    label: c.title || c.slug,
    ...(isRestricted(c) ? { restricted: true } : {}),
    group: c.space === 'personal' ? 'Mine' : (client?.name ?? c.client ?? 'Other'),
    // Typing the client's name (or an alias) finds its projects too.
    terms: [c.slug, c.title, c.client ?? '', client?.name ?? '', ...(client?.aliases ?? [])].filter(Boolean),
  };
}

/**
 * The project a to-do row can filter by: its matched key and that project's "Client · Project" label, or
 * null when it isn't in a known project (a client only, a loose label, a key not in the list yet).
 */
export function todoProjectChip(
  todo: { projectMatch?: TodoProjectMatch },
  cards: readonly ProjectCard[] | undefined,
  clients: readonly { slug: string; name: string }[],
): { key: string; label: string; short: string } | null {
  const key = matchedKey(todo.projectMatch ?? { how: 'none' });
  const card = key ? cards?.find((c) => c.key === key) : undefined;
  // An archived project isn't in the Project filter's list, so it can't be filtered by: it stays words.
  if (!key || !card || card.archived) return null;
  const label = projectText(card, clients);
  const client = card.client ? clients.find((c) => c.slug === card.client)?.name : undefined;
  return { key, label, short: client ? chipLabel(client, card.title) : label };
}

/**
 * A row chip's words: "Client · Project", without the client's name repeated at the start of the project
 * title ("Weightmans · Weightmans PPC" reads "Weightmans · PPC"). The full label stays the chip's name.
 */
export function chipLabel(client: string, title: string): string {
  const name = title || 'Untitled project';
  // Only a whole-word lead: "Weightmans PPC" drops it, "Weightmansfield" doesn't.
  if (client !== '' && name.toLowerCase().startsWith(client.toLowerCase())) {
    const after = name.slice(client.length);
    const rest = after.replace(/^[\s\-–—:·|]+/, '');
    if (rest !== '' && rest !== after) return `${client} · ${rest}`;
  }
  return `${client} · ${name}`;
}

/**
 * Projects a to-do may be put in. A TDS (shared) to-do is never offered a `personal/` project (decision 8).
 * With a client on the to-do, only that client's open projects; without one, every open shared project
 * (choosing one sets the client). A personal to-do also gets this person's personal projects. The
 * to-do's current project is always kept so it still shows.
 */
export function todoProjectOptions(
  cards: readonly ProjectCard[],
  clients: readonly { slug: string; name: string; aliases?: readonly string[] }[],
  opts: { scope: 'tds' | 'personal'; client: string | null; current?: string | null },
): PickOption[] {
  const out = cards.filter((c) => {
    if (c.key === opts.current) return opts.scope === 'personal' || c.space !== 'personal';
    if (!isOpenProject(c)) return false;
    if (c.space === 'personal') return opts.scope === 'personal';
    return !opts.client || c.client === opts.client;
  });
  return out.map((c) => projectOption(c, clients));
}

/**
 * What a to-do row says about where it belongs. A to-do in a known project says "Client · Project"
 * (`projectLabel`); anything else (a loose label, a client only, a key not in the list yet, an older
 * server) says what it always did, so nothing reads worse than before.
 */
export function todoPlaceParts(
  todo: Pick<TodoItem, 'client' | 'project' | 'projectMatch'>,
  cards: readonly ProjectCard[] | undefined,
  clients: readonly { slug: string; name: string }[],
): string[] {
  // A project hidden from this person: the one fixed label, never the folder or a client (decision 6).
  if (todo.projectMatch?.how === 'restricted') return [RESTRICTED_LABEL];
  const key = matchedKey(todo.projectMatch ?? { how: 'none' });
  const label = key ? labelForKey(key, cards, clients) : null;
  return label ? [label] : todoPlaces(todo, clients);
}

/**
 * Who a task in this project can't go to (decision 7): for a restricted project, the note for each person who is
 * neither on it nor an owner or scout; null for anyone who can take it. Without `seesAll` (an older server) nobody
 * is blocked here: the server still refuses.
 */
export function assignNote(
  card: Pick<ProjectCard, 'space' | 'visibility' | 'owner' | 'team'> | undefined,
  person: { slug: string; name: string },
  seesAll: readonly string[] | undefined,
): string | null {
  if (!card || !seesAll || !isRestricted(card)) return null;
  return canTakeTask(card, person, seesAll) ? null : outsideProjectNote(person.name);
}
