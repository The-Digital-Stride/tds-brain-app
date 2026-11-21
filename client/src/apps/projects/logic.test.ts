import { describe, expect, it } from 'vitest';
import {
  changedFields,
  EMPTY_VALUES,
  errorWords,
  filterProjects,
  groupByStage,
  groupProjects,
  isMine,
  NO_FILTERS,
  slugFromTitle,
  teamRows,
  todosForProject,
  validate,
  valuesFromCard,
} from './logic.ts';
import { card } from './testing.ts';

const clients = [
  { slug: 'skyseal', name: 'Skyseal' },
  { slug: 'acme', name: 'Acme Heating' },
];

describe('groupProjects', () => {
  it('groups by client name, personal last, open projects before done ones', () => {
    const groups = groupProjects(
      [
        card({ slug: 'p', client: null, title: 'Taxes' }),
        card({ slug: 'a', client: 'skyseal', title: 'Zed', status: 'done' }),
        card({ slug: 'b', client: 'skyseal', title: 'Alpha' }),
        card({ slug: 'c', client: 'acme', title: 'Boiler' }),
      ],
      clients,
    );
    expect(groups.map((g) => g.title)).toEqual(['Acme Heating', 'Skyseal', 'Personal']);
    expect(groups[1]?.items.map((i) => i.title)).toEqual(['Alpha', 'Zed']);
  });
});

describe('isMine and the filters', () => {
  const owner = card({ slug: 'o', owner: 'me' });
  const onTeam = card({ slug: 't', owner: 'x', team: ['me'] });
  const fromTodos = card({
    slug: 'f',
    owner: 'x',
    teamFromTodos: [{ person: 'me', openTodos: 1, lastActive: '2026-11-20' }],
  });
  const other = card({ slug: 'n', owner: 'x' });
  it('counts the owner, the team and people from to-dos', () => {
    expect([owner, onTeam, fromTodos, other].map((c) => isMine(c, 'me'))).toEqual([true, true, true, false]);
    expect(isMine(owner, '')).toBe(false);
  });
  it('filters by status, owner and service', () => {
    const all = [owner, onTeam, fromTodos, other, card({ slug: 'd', status: 'done', service: ['ppc'] })];
    expect(filterProjects(all, { ...NO_FILTERS, mine: true }, 'me')).toHaveLength(3);
    expect(filterProjects(all, { ...NO_FILTERS, status: 'done' }, 'me')).toHaveLength(1);
    expect(filterProjects(all, { ...NO_FILTERS, service: 'ppc' }, 'me')).toHaveLength(1);
    expect(filterProjects(all, { ...NO_FILTERS, owner: 'x' }, 'me')).toHaveLength(3);
  });
});

describe('the team', () => {
  it('lists the owner, then the team, then people from to-dos', () => {
    const c = card({
      owner: 'a',
      team: ['b'],
      teamFromTodos: [{ person: 'c', openTodos: 2, lastActive: '2026-11-20' }],
    });
    expect(teamRows(c)).toEqual([
      { person: 'a', role: 'owner' },
      { person: 'b', role: 'team' },
      { person: 'c', role: 'from-todos', openTodos: 2 },
    ]);
  });
});

describe('to-dos', () => {
  it('finds the to-dos for a project and groups them by stage', () => {
    const todos = [
      { projectMatch: { how: 'key' as const, key: 'skyseal/website-rebuild' }, stage: 'Build' },
      { projectMatch: { how: 'legacy' as const, key: 'skyseal/website-rebuild' }, stage: null },
      { projectMatch: { how: 'key' as const, key: 'acme/x' }, stage: 'Build' },
      { projectMatch: undefined, stage: 'Build' },
    ];
    const mine = todosForProject(todos, 'skyseal/website-rebuild');
    expect(mine).toHaveLength(2);
    expect(groupByStage(mine, ['Discovery', 'Build']).map((g) => g.title)).toEqual(['Build', 'No stage']);
  });
});

describe('the form rules', () => {
  const ok = { ...EMPTY_VALUES, title: 'Site', slug: 'site', client: 'skyseal' };
  it('accepts a good form', () => {
    expect(validate(ok, 'create')).toEqual({});
  });
  it('refuses an end date before the start', () => {
    expect(validate({ ...ok, start: '2026-12-01', end: '2026-11-01' }, 'create').end).toBeTruthy();
  });
  it('refuses a bad folder name and a missing title', () => {
    expect(validate({ ...ok, slug: 'Bad Name' }, 'create').slug).toBeTruthy();
    expect(validate({ ...ok, title: ' ' }, 'edit').title).toBeTruthy();
  });
  it('makes a folder name from a title', () => {
    expect(slugFromTitle('Website & Rebuild 2027!')).toBe('website-and-rebuild-2027');
  });
  it('sends only what changed, and clears with null', () => {
    const c = card();
    expect(changedFields(c, valuesFromCard(c))).toEqual({});
    const v = { ...valuesFromCard(c), health: '' as const, title: 'New name' };
    expect(changedFields(c, v)).toEqual({ title: 'New name', health: null });
  });
});

describe('errorWords', () => {
  it('has plain words for every code, and offers a reload for changed', () => {
    for (const code of ['bad-request', 'not-found', 'exists', 'changed', 'not-allowed', 'internal'])
      expect(errorWords(code).length).toBeGreaterThan(10);
    expect(errorWords('changed')).toMatch(/Reload/);
  });
});
