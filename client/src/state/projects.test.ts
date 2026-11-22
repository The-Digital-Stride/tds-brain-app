// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCard, ProjectList } from '../../../shared/projects-contract.ts';

const projectsApi = vi.hoisted(() => vi.fn());
vi.mock('../api.ts', () => ({ api: { projects: projectsApi } }));

const { chipLabel, filterOptions, projectsStore, todoPlaceParts, todoProjectOptions, useProjects } =
  await import('./projects.ts');

const card = (over: Partial<ProjectCard>): ProjectCard =>
  ({
    key: 'acme/site',
    space: 'client',
    slug: 'site',
    client: 'acme',
    title: 'Site',
    status: 'active',
    archived: false,
    stages: [],
    ...over,
  }) as ProjectCard;
const clients = [
  { slug: 'acme', name: 'Acme' },
  { slug: 'bolt', name: 'Bolt' },
];
const cards = [
  card({}),
  card({ key: 'acme/done', slug: 'done', title: 'Done', status: 'done' }),
  card({ key: 'bolt/seo', slug: 'seo', client: 'bolt', title: 'SEO' }),
  card({ key: 'personal/diary', space: 'personal', client: null, slug: 'diary', title: 'Diary' }),
];
const listOf = (projects: ProjectCard[]): ProjectList => ({
  projects,
  canChange: true,
  looseLabels: 0,
  duplicates: [],
  skippedFolders: 0,
});

beforeEach(() => {
  projectsStore.reset();
  projectsApi.mockReset();
});

describe('useProjects', () => {
  it('loads once for every user of it, and again on window focus', async () => {
    projectsApi.mockResolvedValue(listOf(cards));
    const a = renderHook(() => useProjects());
    const b = renderHook(() => useProjects());
    expect(a.result.current.list).toBeNull();
    await waitFor(() => expect(a.result.current.list?.projects).toHaveLength(4));
    expect(b.result.current.list).toBe(a.result.current.list);
    expect(projectsApi).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(projectsApi).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good list when a refresh fails, and says why', async () => {
    projectsApi.mockResolvedValueOnce(listOf(cards)).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.list).not.toBeNull());
    await act(() => result.current.refresh());
    expect(result.current.list?.projects).toHaveLength(4);
    expect(result.current.error).toBe('offline');
  });

  it('apply swaps in the list a change returned', async () => {
    projectsApi.mockResolvedValue(listOf(cards));
    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.list).not.toBeNull());
    act(() => result.current.apply(listOf([])));
    expect(result.current.list?.projects).toEqual([]);
  });
});

describe('todoProjectOptions', () => {
  const values = (o: { value: string }[]) => o.map((x) => x.value);

  it('never offers a personal project to a TDS to-do (privacy rule)', () => {
    expect(values(todoProjectOptions(cards, clients, { scope: 'tds', client: null }))).toEqual([
      'acme/site',
      'bolt/seo',
    ]);
    expect(values(todoProjectOptions(cards, clients, { scope: 'tds', client: 'acme' }))).toEqual([
      'acme/site',
    ]);
  });

  it('even keeps a personal project out when it is the current value of a TDS to-do', () => {
    const opts = todoProjectOptions(cards, clients, {
      scope: 'tds',
      client: null,
      current: 'personal/diary',
    });
    expect(values(opts)).not.toContain('personal/diary');
  });

  it("offers a personal to-do the person's own projects too, and leaves out closed ones", () => {
    const opts = todoProjectOptions(cards, clients, { scope: 'personal', client: 'acme' });
    expect(values(opts)).toEqual(['acme/site', 'personal/diary']);
  });

  it('keeps the current project even when it is closed, so it still shows', () => {
    const opts = todoProjectOptions(cards, clients, { scope: 'tds', client: 'acme', current: 'acme/done' });
    expect(values(opts)).toContain('acme/done');
  });
});

describe('filterOptions and todoPlaceParts', () => {
  it('groups filter options under the client, personal ones under Mine', () => {
    const groups = Object.fromEntries(filterOptions(cards, clients).map((o) => [o.value, o.group]));
    expect(groups).toMatchObject({ 'acme/site': 'Acme', 'bolt/seo': 'Bolt', 'personal/diary': 'Mine' });
  });

  it("finds a project by its client's name or alias (Working on is one project list now)", () => {
    const named = [{ slug: 'acme', name: 'Acme Heating', aliases: ['AH'] }];
    const site = filterOptions(cards, named).find((o) => o.value === 'acme/site');
    expect(site?.terms).toEqual(expect.arrayContaining(['Acme Heating', 'AH']));
  });

  it('says "Client · Project" for a known project and falls back to the old words otherwise', () => {
    const base = { client: 'acme', project: 'site' };
    expect(
      todoPlaceParts({ ...base, projectMatch: { how: 'key', key: 'acme/site' } }, cards, clients),
    ).toEqual(['Acme · Site']);
    // A loose label stays as text, as today.
    expect(
      todoPlaceParts(
        { client: 'acme', project: 'misc', projectMatch: { how: 'loose', label: 'misc' } },
        cards,
        clients,
      ),
    ).toEqual(['Acme', 'Misc']);
    // An older server sends no projectMatch at all.
    expect(todoPlaceParts({ client: 'acme', project: null }, undefined, clients)).toEqual(['Acme']);
  });
});

describe('chipLabel', () => {
  it("drops the client's name from the start of the project title", () => {
    expect(chipLabel('Weightmans', 'Weightmans PPC')).toBe('Weightmans · PPC');
    expect(chipLabel('H2O Restoration', 'H2O Restoration - Website')).toBe('H2O Restoration · Website');
    expect(chipLabel('Weightmans', 'weightmans: litigation')).toBe('Weightmans · litigation');
  });

  it('keeps the title when the name is only part of a word, or the whole title', () => {
    expect(chipLabel('Weightmans', 'Weightmansfield audit')).toBe('Weightmans · Weightmansfield audit');
    expect(chipLabel('Weightmans', 'Weightmans')).toBe('Weightmans · Weightmans');
    expect(chipLabel('Acme', 'Site rebuild')).toBe('Acme · Site rebuild');
  });
});
