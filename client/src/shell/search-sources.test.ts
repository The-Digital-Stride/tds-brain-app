import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSession, PastSession, SkillInfo, TodoItem, TodoList } from '../../../shared/contract.ts';
import type { AppSlot, SearchActions, SearchContext, SearchHit, SearchSource } from './contract.ts';

const apps = vi.hoisted(() => [] as AppSlot[]);
vi.mock('./apps.ts', () => ({ APPS: apps }));

const { SEARCH_GROUP_MAX, searchSources } = await import('./search-sources.ts');

const skill = (name: string, title: string, description = ''): SkillInfo => ({
  name,
  title,
  description,
  kind: 'skill',
  maturity: 'live',
  argumentHint: null,
  restrictedTo: null,
});
const live = (
  id: string,
  title: string,
  client: string | null = null,
  at = '2026-11-10T10:00:00Z',
): LiveSession => ({
  id,
  sdkSessionId: null,
  title,
  client,
  todoId: null,
  state: 'idle',
  startedAt: '',
  lastActivityAt: at,
});
const past = (id: string, title: string, lastModified = '2026-11-01T10:00:00Z'): PastSession => ({
  sdkSessionId: id,
  title,
  lastModified,
});
const todo = (id: string, title: string, over: Partial<TodoItem> = {}): TodoItem => ({
  id,
  scope: 'tds',
  key: id,
  path: `todo/${id}`,
  handover: null,
  createdBy: null,
  title,
  created: null,
  source: null,
  details: '',
  version: 'v1',
  assignee: 'sam',
  due: null,
  surfaceDate: null,
  project: null,
  client: null,
  ...over,
});
const list = (mine: TodoItem[], open: TodoItem[] = []): TodoList => ({
  mine,
  open,
  othersCount: 0,
  team: [],
  changes: 'on',
  canAddOpen: false,
  canUsePersonal: true,
});

const ctx = (over: Partial<SearchContext> = {}): SearchContext => ({
  me: 'sam',
  todos: list([]),
  live: [],
  past: [],
  skills: [],
  pins: [],
  clients: [
    { slug: 'acme-heating', name: 'Acme Heating' },
    { slug: 'northwind', name: 'Northwind' },
  ],
  ...over,
});

const source = (id: string): SearchSource => {
  const s = searchSources().find((x) => x.id === id);
  if (!s) throw new Error(`no source ${id}`);
  return s;
};
const hits = (id: string, q: string, c = ctx()) => source(id).search?.(q, c).hits ?? [];
const labels = (hs: SearchHit[]) => hs.map((h) => h.label);

const Nothing = () => null;
const fakeApp = (id: string, title: string, search: SearchSource | null): AppSlot => ({
  id,
  title,
  icon: 'sheet',
  Sheet: Nothing,
  search,
});

beforeEach(() => {
  apps.length = 0;
});

describe('searchSources order', () => {
  it('is Go to, To-dos, Open chats, Skills, Clients, Earlier chats, then apps', () => {
    apps.push(
      fakeApp('notes', 'Notes', { id: 'notes', title: 'Notes', search: () => ({ hits: [], total: 0 }) }),
    );
    expect(searchSources().map((s) => s.id)).toEqual([
      'go',
      'todos',
      'chats',
      'skills',
      'clients',
      'earlier',
      'notes',
    ]);
  });

  it('puts async sources last, whatever their place', () => {
    apps.push(
      fakeApp('remote', 'Remote', {
        id: 'remote',
        title: 'Remote',
        searchAsync: async () => ({ hits: [], total: 0 }),
      }),
      fakeApp('notes', 'Notes', { id: 'notes', title: 'Notes', search: () => ({ hits: [], total: 0 }) }),
    );
    expect(
      searchSources()
        .map((s) => s.id)
        .slice(-2),
    ).toEqual(['notes', 'remote']);
    expect(searchSources().at(-1)?.id).toBe('remote');
  });

  it('skips an app that has no search source', () => {
    apps.push(fakeApp('quiet', 'Quiet', null));
    expect(searchSources().map((s) => s.id)).not.toContain('quiet');
  });
});

describe('Go to', () => {
  it('lists Home, To-dos, Chats, Skills, Settings and then every app, derived from APPS', () => {
    apps.push(fakeApp('images', 'Images', null), fakeApp('notes', 'Notes', null));
    const go = source('go').idle?.(ctx()) ?? [];
    expect(labels(go)).toEqual(['Home', 'To-dos', 'Chats', 'Skills', 'Settings', 'Images', 'Notes']);
    expect(go.map((h) => h.hint)).toEqual([null, 'T', 'C', 'S', null, null, null]);
  });

  it('finds an app by its title and opens its view', () => {
    apps.push(fakeApp('notes', 'Team notes', null));
    const [hit] = hits('go', 'notes');
    expect(hit?.label).toBe('Team notes');
    const actions = { openView: vi.fn() } as unknown as SearchActions;
    hit?.run(actions);
    expect(actions.openView).toHaveBeenCalledWith('app:notes');
  });

  it('runs Home, a drawer and Settings through the palette actions', () => {
    const actions = { goHome: vi.fn(), openDrawer: vi.fn(), openView: vi.fn() };
    const go = source('go').idle?.(ctx()) ?? [];
    for (const label of ['Home', 'Chats', 'Settings']) {
      go.find((h) => h.label === label)?.run(actions as unknown as SearchActions);
    }
    expect(actions.goHome).toHaveBeenCalledTimes(1);
    expect(actions.openDrawer).toHaveBeenCalledWith('chats');
    expect(actions.openView).toHaveBeenCalledWith('settings');
  });
});

describe('To-dos', () => {
  const mine = [
    todo('a.md', 'Renew contract', { client: 'acme-heating', due: '2999-01-02' }),
    todo('b.md', 'Ring Bob', { details: 'About the boiler', due: '2999-01-01' }),
    todo('c.md', 'Website plan', { project: 'website-rebuild' }),
  ];
  const c = ctx({ todos: list(mine, [todo('o.md', 'Open thing', { assignee: null })]) });

  it('matches title, details, client name and project words', () => {
    expect(labels(hits('todos', 'renew', c))).toEqual(['Renew contract']);
    expect(labels(hits('todos', 'boiler', c))).toEqual(['Ring Bob']);
    expect(labels(hits('todos', 'acme heating', c))).toEqual(['Renew contract']);
    expect(labels(hits('todos', 'website rebuild', c))).toEqual(['Website plan']);
  });

  it('includes open to-dos and says so in the hint', () => {
    const [hit] = hits('todos', 'open thing', c);
    expect(hit?.hint).toBe('Open to anyone');
  });

  it('hints the client name and the due date', () => {
    expect(hits('todos', 'renew', c)[0]?.hint).toMatch(/^Acme Heating, /);
  });

  it('ranks the title above details, then soonest due first', () => {
    const items = [
      todo('x.md', 'Something else', { details: 'ring the bell', due: '2999-01-01' }),
      todo('y.md', 'Ring later', { due: '2999-05-01' }),
      todo('z.md', 'Ring sooner', { due: '2999-02-01' }),
      todo('u.md', 'Ring undated'),
    ];
    expect(labels(hits('todos', 'ring', ctx({ todos: list(items) })))).toEqual([
      'Ring sooner',
      'Ring later',
      'Ring undated',
      'Something else',
    ]);
  });

  it('reveals the to-do when chosen', () => {
    const actions = { revealTodo: vi.fn() } as unknown as SearchActions;
    hits('todos', 'renew', c)[0]?.run(actions);
    expect(actions.revealTodo).toHaveBeenCalledWith(mine[0]);
  });

  it('with an empty query shows the first five of mine, soonest due first', () => {
    const many = ['1', '2', '3', '4', '5', '6', '7'].map((n) =>
      todo(`${n}.md`, `Thing ${n}`, { due: `2999-01-0${n}` }),
    );
    const idle = source('todos').idle?.(ctx({ todos: list([...many].reverse()) })) ?? [];
    expect(labels(idle)).toEqual(['Thing 1', 'Thing 2', 'Thing 3', 'Thing 4', 'Thing 5']);
  });

  it('is empty with no list yet', () => {
    expect(hits('todos', 'a', ctx({ todos: null }))).toEqual([]);
  });
});

describe('limits', () => {
  it('shows six per group and counts them all', () => {
    const many = Array.from({ length: 10 }, (_, i) => todo(`t${i}.md`, `Thing ${i}`));
    const res = source('todos').search?.('thing', ctx({ todos: list(many) }));
    expect(SEARCH_GROUP_MAX).toBe(6);
    expect(res?.hits).toHaveLength(6);
    expect(res?.total).toBe(10);
  });
});

describe('chats, skills, clients, earlier chats', () => {
  it('finds open chats by title or client name, newest first within a rank', () => {
    const c = ctx({
      live: [
        live('1', 'Reports check', 'northwind', '2026-11-01T00:00:00Z'),
        live('2', 'Reports review', null, '2026-11-09T00:00:00Z'),
        live('3', 'Other', 'acme-heating'),
      ],
    });
    expect(labels(hits('chats', 'reports', c))).toEqual(['Reports review', 'Reports check']);
    expect(labels(hits('chats', 'acme', c))).toEqual(['Other']);
    const actions = { openChat: vi.fn() } as unknown as SearchActions;
    hits('chats', 'review', c)[0]?.run(actions);
    expect(actions.openChat).toHaveBeenCalledWith('2');
    expect(hits('chats', 'check', c)[0]?.hint).toBe('Northwind');
  });

  it('finds skills by title or description, pinned first among equals, and starts the skill', () => {
    const skills = [
      skill('audit', 'Audit tool', 'Checks things'),
      skill('pinned', 'Audit pinned'),
      skill('notes', 'Notes', 'Writes an audit trail'),
    ];
    const c = ctx({ skills, pins: ['pinned'] });
    expect(labels(hits('skills', 'audit', c))).toEqual(['Audit pinned', 'Audit tool', 'Notes']);
    const actions = { startSkill: vi.fn() } as unknown as SearchActions;
    hits('skills', 'audit', c)[0]?.run(actions);
    expect(actions.startSkill).toHaveBeenCalledWith(skills[1]);
  });

  it('shows pinned skills in pin order and open chats when idle', () => {
    const skills = [skill('a', 'A'), skill('b', 'B'), skill('c', 'C')];
    const idle = source('skills').idle?.(ctx({ skills, pins: ['c', 'a', 'gone'] })) ?? [];
    expect(labels(idle)).toEqual(['C', 'A']);
    const chats = source('chats').idle?.(ctx({ live: [live('1', 'One'), live('2', 'Two')] })) ?? [];
    expect(labels(chats)).toEqual(['One', 'Two']);
  });

  it('finds a client by name or folder name and shows Home on it', () => {
    expect(labels(hits('clients', 'north'))).toEqual(['Northwind']);
    expect(labels(hits('clients', 'acme heat'))).toEqual(['Acme Heating']);
    const actions = { chooseClient: vi.fn() } as unknown as SearchActions;
    hits('clients', 'acme')[0]?.run(actions);
    expect(actions.chooseClient).toHaveBeenCalledWith('acme-heating');
    expect(source('clients').idle).toBeUndefined();
  });

  it('finds earlier chats by title only and reopens them', () => {
    const c = ctx({
      past: [past('s1', 'Old audit chat'), past('s2', 'Other', '2026-11-05T00:00:00Z'), past('s3', '')],
    });
    expect(labels(hits('earlier', 'audit', c))).toEqual(['Old audit chat']);
    expect(hits('earlier', 'zzz', c)).toEqual([]);
    const actions = { openPast: vi.fn() } as unknown as SearchActions;
    hits('earlier', 'audit', c)[0]?.run(actions);
    expect(actions.openPast).toHaveBeenCalledWith('s1');
    expect(source('earlier').idle).toBeUndefined();
  });
});
