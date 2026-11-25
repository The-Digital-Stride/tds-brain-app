import { describe, expect, it } from 'vitest';
import type { ProjectUpdateItem } from '../../../../shared/project-updates-contract.ts';
import {
  changedFields,
  EMPTY_VALUES,
  errorWords,
  filterProjects,
  groupByStage,
  groupProjects,
  groupUpdates,
  isMine,
  LIGHT_WORDS,
  NO_FILTERS,
  slugFromTitle,
  teamRows,
  threadLine,
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
  it('counts the owner, the team and people from tasks', () => {
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
  it('lists the owner, then the team, then people from tasks', () => {
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

describe('tasks', () => {
  it('finds the tasks for a project and groups them by stage', () => {
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

describe('the health words', () => {
  it('say what the light means; the stored values stay colours', () => {
    expect(LIGHT_WORDS).toEqual({ green: 'On track', amber: 'At risk', red: 'Off track' });
    expect(valuesFromCard(card({ health: 'amber' })).health).toBe('amber');
  });
});

describe('groupUpdates', () => {
  const u = (path: string, over: Partial<ProjectUpdateItem> = {}): ProjectUpdateItem => ({
    v: 1,
    kind: 'email',
    by: 'me',
    at: '2026-11-23T14:05:00Z',
    clientSafe: false,
    summary: 's',
    path,
    version: `h-${path}`,
    byName: 'Me',
    canRemove: false,
    ...over,
  });

  it('leaves entries without a conversation as single rows, in order', () => {
    const rows = groupUpdates([u('a', { kind: 'note' }), u('b'), u('c', { emailThread: undefined })]);
    expect(rows.map((r) => r.parts.map((p) => p.path))).toEqual([['a'], ['b'], ['c']]);
    expect(rows.every((r) => !r.thread)).toBe(true);
  });

  it('joins parts sharing emailThread into one row at the first part, newest sent first', () => {
    const rows = groupUpdates([
      u('a', { kind: 'note' }),
      u('p1', { emailThread: 't', emailSentAt: '2026-11-20T10:00:00Z' }),
      u('b', { kind: 'note' }),
      u('p2', { emailThread: 't', emailSentAt: '2026-11-24T09:00:00Z' }),
      u('p3', { emailThread: 't', emailSentAt: '2026-11-22T09:00:00Z' }),
    ]);
    expect(rows.map((r) => r.parts.map((p) => p.path))).toEqual([['a'], ['p2', 'p3', 'p1'], ['b']]);
    expect(rows[1]?.thread).toBe(true);
  });

  it('falls back to the saved time when a part has no sent time', () => {
    const rows = groupUpdates([
      u('old', { emailThread: 't', at: '2026-11-01T00:00:00Z' }),
      u('new', { emailThread: 't', at: '2026-11-05T00:00:00Z' }),
    ]);
    expect(rows[0]?.parts.map((p) => p.path)).toEqual(['new', 'old']);
  });

  it('keeps a conversation with one part visible as a thread row of one', () => {
    const rows = groupUpdates([u('x', { emailThread: 't' })]);
    expect(rows[0]?.parts).toHaveLength(1);
    expect(rows[0]?.thread).toBe(true);
  });

  it('with a filter, a row shows when any part passes and only passing parts show', () => {
    const rows = groupUpdates(
      [
        u('p1', { emailThread: 't', clientSafe: true }),
        u('p2', { emailThread: 't', clientSafe: false }),
        u('n', { kind: 'note', clientSafe: false }),
      ],
      (x) => x.clientSafe,
    );
    expect(rows.map((r) => r.parts.map((p) => p.path))).toEqual([['p1']]);
  });
});

describe('threadLine', () => {
  it('counts the updates and names the latest date', () => {
    expect(threadLine(3, '2026-11-24T09:00:00Z')).toBe('3 updates · latest 24 Nov 2026');
    expect(threadLine(1, '2026-11-24T09:00:00Z')).toBe('1 update · latest 24 Nov 2026');
  });
});
