/**
 * The one-off tidy-up of old `project:` labels (plan docs/plans/2026-11-20-projects-system.md, decision
 * 13; rules above TidyRow in shared/projects-contract.ts, overseer S4). Pure: the reader
 * (server/brain/projects.ts) gives it the open to-dos and the projects, and runs the approved changes
 * through the to-do and projects scripts.
 */
import { isProjectSlug, parseProjectKey, resolveTodoProject } from '../../shared/projects.ts';
import {
  INTERNAL_CLIENT,
  PROJECT_SLUG_MAX,
  type ProjectCard,
  type ProjectKey,
  ProjectsError,
  type TidyRow,
  type TidySuggestion,
} from '../../shared/projects-contract.ts';

/** One open to-do as the tidy-up sees it (TDS, or this person's own personal one). */
export interface TidyTodo {
  id: string;
  scope: 'tds' | 'personal';
  title: string;
  client: string | null;
  assignee: string | null;
  /** SHA-256 of the file's bytes, sent as `expect`. */
  version: string;
  /** Frontmatter `project:` as written. */
  project: string | null;
  stage: string | null;
}

export interface TidyContext {
  projects: Pick<ProjectCard, 'key' | 'slug' | 'client' | 'space'>[];
  /** Client folder slugs. */
  clients: string[];
}

/** Template placeholders: cleared, never turned into a project. */
export const PLACEHOLDER_LABELS: readonly string[] = ['optional-project-slug'];
/** Both labels at least this long before a near spelling counts (so `os` never merges). */
export const NEAR_MIN_LENGTH = 6;

function distanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** A plural (`s`/`es`), a hyphen difference, or one letter apart, with both labels long enough. */
export function nearSpelling(a: string, b: string): boolean {
  if (a === b || a.length < NEAR_MIN_LENGTH || b.length < NEAR_MIN_LENGTH) return false;
  if (a === `${b}s` || a === `${b}es` || b === `${a}s` || b === `${a}es`) return true;
  if (a.replace(/-/g, '') === b.replace(/-/g, '')) return true;
  return distanceAtMostOne(a, b);
}

/** A label as a folder name: lower case, every run of other characters one dash. */
function slugOf(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PROJECT_SLUG_MAX)
    .replace(/-+$/, '');
  return isProjectSlug(slug) ? slug : '';
}

/** The most common `client:` among the to-dos (ties: first alphabetically), or null. */
function mostCommonClient(todos: TidyTodo[]): string | null {
  const counts = new Map<string, number>();
  for (const t of todos) if (t.client) counts.set(t.client, (counts.get(t.client) ?? 0) + 1);
  let best: string | null = null;
  for (const [client, count] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (best === null || count > (counts.get(best) ?? 0)) best = client;
  }
  return best;
}

/** The project a key-shaped target names: its client ('personal' for a personal key). */
function keyClient(key: ProjectKey): string | null {
  return parseProjectKey(key)?.client ?? null;
}

/**
 * The `client:`, `project:` and `stage:` lines a to-do gets under a suggestion, or null when it must be
 * left alone: its `client:` names another client (never overwritten), or a TDS to-do would go into a
 * personal project. A stage is kept only when the to-do goes into a project.
 */
export function tidyTarget(
  todo: Pick<TidyTodo, 'scope' | 'client' | 'stage'>,
  s: TidySuggestion,
): { client: string | null; project: ProjectKey | null; stage: string | null } | null {
  const intoProject = (key: ProjectKey) => {
    const owner = keyClient(key);
    if (owner === null) return null;
    const client = owner === 'personal' ? null : owner;
    if (owner === 'personal' && todo.scope === 'tds') return null;
    if (todo.client && todo.client !== client) return null;
    return { client, project: key, stage: todo.stage };
  };
  const intoClient = (client: string) =>
    todo.client && todo.client !== client ? null : { client, project: null, stage: null };
  switch (s.do) {
    case 'link':
      return intoProject(s.key);
    case 'merge':
      return s.into.includes('/') ? intoProject(s.into) : intoClient(s.into);
    case 'client-only':
      return intoClient(s.client);
    case 'clear':
      return { client: todo.client, project: null, stage: null };
    case 'new-project':
      return intoProject(s.client === null ? `personal/${s.slug}` : `${s.client}/${s.slug}`);
    case 'skip':
      return null;
  }
}

/** The suggestion for one label, from the rules in the contract. */
function suggestionFor(label: string, todos: TidyTodo[], ctx: TidyContext): TidySuggestion {
  const anyTds = todos.some((t) => t.scope === 'tds');
  const eligible = anyTds ? ctx.projects.filter((p) => p.space !== 'personal') : ctx.projects;
  const rowClient = mostCommonClient(todos);
  if (ctx.clients.includes(label)) return { do: 'client-only', client: label, why: 'is-a-client' };
  const bySlug = eligible.filter((p) => p.slug === label);
  const pick =
    (rowClient !== null ? bySlug.find((p) => p.client === rowClient) : undefined) ??
    (bySlug.length === 1 ? bySlug[0] : undefined);
  if (pick) return { do: 'link', key: pick.key, why: 'same-slug' };
  if (bySlug.length > 1) return { do: 'skip', why: 'no-match' };
  if (PLACEHOLDER_LABELS.includes(label)) return { do: 'clear', why: 'placeholder' };
  const near = [
    ...ctx.clients.filter((c) => nearSpelling(label, c)),
    ...eligible.filter((p) => nearSpelling(label, p.slug)).map((p) => p.key),
  ];
  if (near.length === 1) return { do: 'merge', into: near[0] as string, why: 'near-spelling' };
  const slug = slugOf(label);
  if (slug === '') return { do: 'skip', why: 'no-match' };
  const client = rowClient ?? (anyTds ? INTERNAL_CLIENT : null);
  const existing = eligible.find(
    (p) => p.key === (client === null ? `personal/${slug}` : `${client}/${slug}`),
  );
  if (existing) return { do: 'link', key: existing.key, why: 'same-slug' };
  return { do: 'new-project', client, slug, why: 'no-match' };
}

/** One row: the suggestion, the to-dos it changes, and those left alone because of their `client:`. */
export function suggestTidy(label: string, todos: TidyTodo[], ctx: TidyContext): TidyRow {
  const suggestion = suggestionFor(label, todos, ctx);
  const rowTodos: TidyRow['todos'] = [];
  const conflicts: TidyRow['conflicts'] = [];
  for (const t of todos) {
    const target = suggestion.do === 'skip' ? t : tidyTarget(t, suggestion);
    if (target === null) {
      if (t.client) conflicts.push({ id: t.id, title: t.title, client: t.client });
      continue;
    }
    rowTodos.push({
      id: t.id,
      scope: t.scope,
      title: t.title,
      client: t.client,
      assignee: t.assignee,
      version: t.version,
    });
  }
  return { label, todos: rowTodos, conflicts, suggestion };
}

/**
 * Every label waiting: open to-dos whose `project:` reads as 'legacy', 'client' or 'loose' (never a
 * key, a missing key or none), grouped by label, most to-dos first. A personal to-do whose label
 * already reads as one of its own personal projects stays out of a row its TDS namesakes share.
 */
export function buildTidyRows(todos: TidyTodo[], ctx: TidyContext): TidyRow[] {
  const groups = new Map<string, { todo: TidyTodo; personalMatch: boolean }[]>();
  for (const t of todos) {
    const m = resolveTodoProject(t.project, t.client, t.scope, ctx.projects, ctx.clients);
    if (m.how !== 'legacy' && m.how !== 'client' && m.how !== 'loose') continue;
    const label = (t.project ?? '').trim();
    const personalMatch = m.how === 'legacy' && m.key.startsWith('personal/');
    const list = groups.get(label) ?? [];
    list.push({ todo: t, personalMatch });
    groups.set(label, list);
  }
  const rows: TidyRow[] = [];
  for (const [label, entries] of groups) {
    const anyTds = entries.some((e) => e.todo.scope === 'tds');
    const members = entries.filter((e) => !(anyTds && e.personalMatch)).map((e) => e.todo);
    rows.push(suggestTidy(label, members, ctx));
  }
  return rows.sort((a, b) => b.todos.length - a.todos.length || a.label.localeCompare(b.label));
}

/**
 * Checks a suggestion the person approved, which may not be the one offered ("Change"). Throws
 * ProjectsError: `not-allowed` for a personal project on a TDS to-do, `not-found` for a key with no
 * project, `bad-request` for an unknown client or a bad folder name.
 */
export function checkSuggestion(
  todos: Pick<TidyTodo, 'scope'>[],
  s: TidySuggestion,
  ctx: TidyContext,
): TidySuggestion {
  const anyTds = todos.some((t) => t.scope === 'tds');
  const bad = () =>
    new ProjectsError(
      'bad-request',
      "That change to the old label couldn't be made. Check it and try again.",
    );
  const privateProject = () =>
    new ProjectsError(
      'not-allowed',
      "A team to-do can't go into a personal project. Pick a shared project instead.",
    );
  const knownClient = (c: string) => ctx.clients.includes(c) || c === INTERNAL_CLIENT;
  const checkKey = (key: ProjectKey) => {
    const parsed = parseProjectKey(key);
    if (!parsed) throw bad();
    if (parsed.client === 'personal' && anyTds) throw privateProject();
    if (!ctx.projects.some((p) => p.key === key)) {
      throw new ProjectsError(
        'not-found',
        'That project could not be found. It may not have synced here yet.',
      );
    }
  };
  switch (s.do) {
    case 'link':
      checkKey(s.key);
      break;
    case 'merge':
      if (s.into.includes('/')) checkKey(s.into);
      else if (!knownClient(s.into)) throw bad();
      break;
    case 'client-only':
      if (!knownClient(s.client)) throw bad();
      break;
    case 'new-project':
      if (!isProjectSlug(s.slug)) throw bad();
      if (s.client === null) {
        if (anyTds) throw privateProject();
      } else if (!knownClient(s.client)) throw bad();
      break;
    case 'clear':
    case 'skip':
      break;
    default:
      throw bad();
  }
  return s;
}
