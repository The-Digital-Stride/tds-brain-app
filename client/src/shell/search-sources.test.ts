import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DoneTodo,
  LiveSession,
  PastSession,
  SkillInfo,
  TodoItem,
  TodoList,
} from '../../../shared/contract.ts';
import type { ProjectCard } from '../../../shared/projects-contract.ts';
import type { AppSlot, SearchActions, SearchContext, SearchHit, SearchSource } from './contract.ts';

const apps = vi.hoisted(() => [] as AppSlot[]);
vi.mock('./apps.ts', () => ({ APPS: apps }));
const sections = vi.hoisted(() => [] as { tools: { search: SearchSource | null }[] }[]);
vi.mock('./sections.ts', () => ({ SECTIONS: sections }));

const adsAccounts = vi.hoisted(() => vi.fn());
vi.mock('../api.ts', () => ({ api: { adsAccounts } }));

const searchFn = vi.hoisted(() => vi.fn());
vi.mock('../help/library.ts', () => ({ helpLibrary: { search: searchFn } }));

const { doneStore } = await import('../state/todo-done.ts');
const { SEARCH_GROUP_MAX, searchSources } = await import('./search-sources.ts');
const { projectPageRequest } = await import('../state/client-choice.ts');
const { adManagerSearch } = await import('../tools/ad-manager/search.ts');
const { commandSearch } = await import('../tools/ad-manager/command-search.ts');
const { summarySearch } = await import('../tools/ad-manager/summary-search.ts');
const { adStore } = await import('../tools/ad-manager/store.ts');

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
  kind: 'tds',
});
const past = (id: string, title: string, lastModified = '2026-11-01T10:00:00Z'): PastSession => ({
  sdkSessionId: id,
  title,
  lastModified,
  kind: 'tds',
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
  attachments: [],
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
  canAttach: false,
  canUpload: false,
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
  sections.length = 0;
});

describe('section tools in the sources', () => {
  it("adds each tool's search source after the apps', and skips a tool with none", () => {
    const own: SearchSource = { id: 'ads', title: 'Ad Manager', search: () => ({ hits: [], total: 0 }) };
    sections.push({ tools: [{ search: own }, { search: null }] });
    apps.push(
      fakeApp('notes', 'Notes', { id: 'notes', title: 'Notes', search: () => ({ hits: [], total: 0 }) }),
    );
    const ids = searchSources().map((x) => x.id);
    expect(ids.slice(-3)).toEqual(['notes', 'ads', 'done-todos']);
  });
});

describe('searchSources order', () => {
  it('is Go to, Tasks, Open chats, Skills, Clients, Projects, Earlier chats, Help, then apps and Done tasks', () => {
    apps.push(
      fakeApp('notes', 'Notes', { id: 'notes', title: 'Notes', search: () => ({ hits: [], total: 0 }) }),
    );
    expect(searchSources().map((s) => s.id)).toEqual([
      'go',
      'todos',
      'chats',
      'skills',
      'clients',
      'projects',
      'earlier',
      'help',
      'notes',
      'done-todos',
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
        .slice(-3),
    ).toEqual(['notes', 'done-todos', 'remote']);
    expect(searchSources().at(-1)?.id).toBe('remote');
  });

  it('skips an app that has no search source', () => {
    apps.push(fakeApp('quiet', 'Quiet', null));
    expect(searchSources().map((s) => s.id)).not.toContain('quiet');
  });
});

describe('Go to', () => {
  it('lists Home, Tasks, Chats, Skills, Settings and then every app, derived from APPS', () => {
    apps.push(fakeApp('images', 'Images', null), fakeApp('notes', 'Notes', null));
    const go = source('go').idle?.(ctx()) ?? [];
    expect(labels(go)).toEqual([
      'Home',
      'Tasks',
      'Chats',
      'Skills',
      'Settings',
      'Settings: General',
      'Settings: Claude',
      'Settings: Health',
      'Settings: About',
      'Images',
      'Notes',
    ]);
    expect(go.map((h) => h.hint)).toEqual([null, 'T', 'C', 'S', null, null, null, null, null, null, null]);
  });

  it('finds an app by its title and opens its view', () => {
    apps.push(fakeApp('notes', 'Team notes', null));
    const [hit] = hits('go', 'notes');
    expect(hit?.label).toBe('Team notes');
    const actions = { openView: vi.fn() } as unknown as SearchActions;
    hit?.run(actions);
    expect(actions.openView).toHaveBeenCalledWith('app:notes');
  });

  it('still finds the Tasks entry by its old name, to-do or todo', () => {
    for (const q of ['to-do', 'to-dos', 'todo', 'todos']) {
      expect(hits('go', q).map((h) => h.id)).toContain('go-todos');
    }
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

describe('Settings tabs in Go to', () => {
  it('lists Skill levels only when the person has levels', () => {
    const without = labels(source('go').idle?.(ctx()) ?? []);
    expect(without).not.toContain('Settings: Skill levels');
    const withLevels = labels(source('go').idle?.({ ...ctx(), hasSkillLevels: true }) ?? []);
    expect(withLevels).toContain('Settings: Skill levels');
  });

  it('finds a tab by its words and opens Settings on it', () => {
    const [hit] = hits('go', 'settings health');
    expect(hit?.label).toBe('Settings: Health');
    const actions = { openSettings: vi.fn(), openView: vi.fn() } as unknown as SearchActions;
    hit?.run(actions);
    expect(actions.openSettings).toHaveBeenCalledWith('health');
  });

  it('falls back to the plain Settings view when the action is missing', () => {
    const [hit] = hits('go', 'settings about');
    const actions = { openView: vi.fn() } as unknown as SearchActions;
    hit?.run(actions);
    expect(actions.openView).toHaveBeenCalledWith('settings');
  });
});

describe('Tasks', () => {
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

  it('includes open tasks and says so in the hint', () => {
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

  it('reveals the task when chosen', () => {
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

describe('Go to: Help', () => {
  const goLabels = (c: SearchContext) => labels(source('go').idle?.(c) ?? []);

  it('is listed with the H hint when Help is on for the person', () => {
    const on = ctx({ helpVisible: true });
    expect(goLabels(on)).toContain('Help');
    const hit = (source('go').idle?.(on) ?? []).find((h) => h.label === 'Help');
    expect(hit?.hint).toBe('H');
    const openDrawer = vi.fn();
    hit?.run({ openDrawer } as unknown as SearchActions);
    expect(openDrawer).toHaveBeenCalledWith('help');
    expect(labels(hits('go', 'help', on))).toEqual(['Help']);
  });

  it('is left out by default and when Help is off', () => {
    expect(goLabels(ctx())).not.toContain('Help');
    expect(goLabels(ctx({ helpVisible: false }))).not.toContain('Help');
    expect(hits('go', 'help')).toEqual([]);
  });
});

describe('Go to: Skills', () => {
  const goLabels = (c: SearchContext) => labels(source('go').idle?.(c) ?? []);

  it('is listed by default, and left out for someone the Skills drawer is not for', () => {
    expect(goLabels(ctx())).toContain('Skills');
    expect(goLabels(ctx({ skillsHidden: true }))).not.toContain('Skills');
  });
});

describe('Skills in search', () => {
  const c = (over: Partial<SearchContext> = {}) =>
    ctx({
      skills: [skill('seo-audit', 'SEO audit'), skill('report', 'Monthly report')],
      pins: ['report'],
      ...over,
    });

  it('finds and lists pinned skills for an owner or scout', () => {
    expect(labels(hits('skills', 'seo', c()))).toEqual(['SEO audit']);
    expect(labels(source('skills').idle?.(c()) ?? [])).toEqual(['Monthly report']);
  });
  it('finds nothing, and lists no pinned skills, for someone the Skills drawer is not for', () => {
    expect(hits('skills', 'seo', c({ skillsHidden: true }))).toEqual([]);
    expect(source('skills').search?.('seo', c({ skillsHidden: true })).total).toBe(0);
    expect(source('skills').idle?.(c({ skillsHidden: true })) ?? []).toEqual([]);
  });
});

describe('Go to: Cortex Guide', () => {
  const goLabels = (c: SearchContext) => labels(source('go').idle?.(c) ?? []);

  it('is listed after Help for owners and opens the guide view', () => {
    const on = ctx({ helpVisible: true });
    const names = goLabels(on);
    expect(names.indexOf('Cortex Guide')).toBe(names.indexOf('Help') + 1);
    const openView = vi.fn();
    (source('go').idle?.(on) ?? [])
      .find((h) => h.label === 'Cortex Guide')
      ?.run({
        openView,
      } as unknown as SearchActions);
    expect(openView).toHaveBeenCalledWith('guide');
    expect(labels(hits('go', 'guide', on))).toEqual(['Cortex Guide']);
  });

  it('is left out for everyone else', () => {
    expect(goLabels(ctx())).not.toContain('Cortex Guide');
    expect(goLabels(ctx({ helpVisible: false }))).not.toContain('Cortex Guide');
    expect(hits('go', 'guide')).toEqual([]);
  });
});

describe('Help source', () => {
  const page = (id: string, title: string, summary: string) => ({ id, title, summary });
  beforeEach(() => searchFn.mockReset());

  it('is owner-only: nothing for anyone else, and the library is not asked', () => {
    searchFn.mockReturnValue([page('home', 'Home', 'Where you start')]);
    expect(hits('help', 'home', ctx())).toEqual([]);
    expect(hits('help', 'home', ctx({ helpVisible: false }))).toEqual([]);
    expect(searchFn).not.toHaveBeenCalled();
  });

  it('shows up to five pages, in the library order, as title and summary', () => {
    searchFn.mockReturnValue([page('a', 'Alpha', 'First one'), page('b', 'Beta', 'Second one')]);
    const found = source('help').search?.('al', ctx({ helpVisible: true }));
    expect(searchFn).toHaveBeenCalledWith('al', 5);
    expect(labels(found?.hits ?? [])).toEqual(['Alpha', 'Beta']);
    expect(found?.hits.map((h) => h.hint)).toEqual(['First one', 'Second one']);
    expect(found?.hits[0]?.icon).toBe('help');
    expect(found?.total).toBe(2);
  });

  it('opens the Help drawer on the page', () => {
    searchFn.mockReturnValue([page('levels', 'Levels', 'Quick, Standard, Deep')]);
    const openHelp = vi.fn();
    hits('help', 'lev', ctx({ helpVisible: true }))[0]?.run({ openHelp } as unknown as SearchActions);
    expect(openHelp).toHaveBeenCalledWith('levels');
  });

  it('has no idle list', () => {
    expect(source('help').idle).toBeUndefined();
  });
});

describe('the Ads tools in the search', () => {
  const adsCtx = (visible = true) => ctx({ ads: { visible } as SearchContext['ads'] });
  const openTool = vi.fn();
  const actions = { openTool } as unknown as SearchActions;
  const board = {
    key: 'acme',
    cards: [
      {
        id: 'w-search',
        cadence: 'weekly',
        title: 'Search terms audit',
        description: 'Wasted spend in queries',
      },
      { id: 'q-review', cadence: 'quarterly', title: 'Quarterly strategy review', description: 'Look back' },
    ],
    tables: [
      { id: 'waste', title: 'Wasted spend', subtitle: 'Terms that cost but never converted' },
      { id: 'quality', title: 'Quality Score', subtitle: 'Keywords scoring 4 or lower' },
    ],
  };

  beforeEach(() => {
    openTool.mockClear();
    adsAccounts.mockReset();
    adStore.reset();
  });

  it('"ad manager" still finds Ads Manager, and "ads manager" too', async () => {
    adsAccounts.mockResolvedValue([]);
    const signal = new AbortController().signal;
    for (const q of ['ad manager', 'ads manager', 'proposals']) {
      const r = await adManagerSearch.searchAsync?.(q, signal);
      expect(labels(r?.hits ?? []), q).toEqual(['Ads Manager']);
    }
    const r = await adManagerSearch.searchAsync?.('ad manager', signal);
    r?.hits[0]?.run(actions);
    expect(openTool).toHaveBeenCalledWith('workbench', 'ad-manager', undefined);
  });

  it('each Ads tool has a source, with its own title', () => {
    expect([adManagerSearch.title, commandSearch.title, summarySearch.title]).toEqual([
      'Ads Manager',
      'Ads Command Centre',
      'Ads Account Summary',
    ]);
    for (const src of [commandSearch, summarySearch]) {
      expect(Boolean(src.search) !== Boolean(src.searchAsync)).toBe(true);
    }
  });

  it('with no board loaded, each offers just its tool', () => {
    expect(labels(commandSearch.search?.('command centre', adsCtx()).hits ?? [])).toEqual([
      'Ads Command Centre',
    ]);
    expect(labels(commandSearch.search?.('audit', adsCtx()).hits ?? [])).toEqual([]);
    expect(labels(summarySearch.search?.('account summary', adsCtx()).hits ?? [])).toEqual([
      'Ads Account Summary',
    ]);
    expect(labels(summarySearch.search?.('wasted', adsCtx()).hits ?? [])).toEqual([]);
  });

  it('offers nothing while the ads tools are hidden', () => {
    adStore.set({ account: 'acme', boardFor: 'acme', board: board as never });
    expect(commandSearch.search?.('audit', adsCtx(false)).hits).toEqual([]);
    expect(summarySearch.search?.('wasted', adsCtx(false)).hits).toEqual([]);
  });

  it('finds a task by title, and choosing it opens Ads Command Centre on the current account', () => {
    adStore.set({ account: 'acme', boardFor: 'acme', board: board as never });
    const r = commandSearch.search?.('audit', adsCtx());
    expect(labels(r?.hits ?? [])).toEqual(['Search terms audit']);
    expect(r?.hits[0]?.hint).toBe('Ads Command Centre, Weekly');
    r?.hits[0]?.run(actions);
    expect(openTool).toHaveBeenCalledWith('workbench', 'ads-command-centre', 'acme');
  });

  it('ignores a board that belongs to another account (the picker moved on)', () => {
    adStore.set({ account: 'other', boardFor: 'acme', board: board as never });
    expect(commandSearch.search?.('audit', adsCtx()).hits).toEqual([]);
  });

  it('finds a table by title, and choosing it opens Ads Account Summary on the current account', () => {
    adStore.set({ account: 'acme', boardFor: 'acme', board: board as never });
    const r = summarySearch.search?.('quality', adsCtx());
    expect(labels(r?.hits ?? [])).toEqual(['Quality Score']);
    r?.hits[0]?.run(actions);
    expect(openTool).toHaveBeenCalledWith('workbench', 'ads-account-summary', 'acme');
    expect(adStore.get().jump).toBe('table:quality');
  });

  it('never asks the bridge while you type', () => {
    adStore.set({ account: 'acme', boardFor: 'acme', board: board as never });
    commandSearch.search?.('audit', adsCtx());
    summarySearch.search?.('wasted', adsCtx());
    expect(adsAccounts).not.toHaveBeenCalled();
  });
});

const card = (over: Partial<ProjectCard> = {}): ProjectCard => ({
  key: 'acme-heating/website-rebuild',
  space: 'client',
  slug: 'website-rebuild',
  client: 'acme-heating',
  folder: 'clients/acme-heating/projects/website-rebuild',
  card: 'ok',
  archived: false,
  title: 'Website rebuild',
  kind: 'one-off',
  status: 'active',
  health: null,
  comms: null,
  owner: null,
  team: [],
  service: [],
  start: null,
  end: null,
  budgetHours: null,
  billable: null,
  stages: ['Build'],
  mondayId: null,
  created: null,
  createdBy: null,
  lastChanged: null,
  brief: '',
  links: [],
  version: 'v',
  openTodos: 2,
  teamFromTodos: [],
  checklist: null,
  ...over,
});

describe('the Projects group', () => {
  const projects = [
    card(),
    card({ key: 'northwind/seo-retainer', slug: 'seo-retainer', client: 'northwind', title: 'SEO retainer' }),
    card({ key: 'acme-heating/old', slug: 'old', title: 'Old site', archived: true }),
  ];
  const withProjects = (over: Partial<SearchContext> = {}) =>
    ctx({
      projects,
      clients: [
        { slug: 'acme-heating', name: 'Acme Heating', aliases: ['AH'] },
        { slug: 'northwind', name: 'Northwind' },
      ],
      ...over,
    });

  it('finds a project by title, client name, alias or slug, and skips archived ones', () => {
    expect(
      hits('projects', 'website', withProjects())
        .map((h) => h.id)
        .filter((id) => !id.endsWith('#filter')),
    ).toEqual(['acme-heating/website-rebuild']);
    expect(
      hits('projects', 'northwind', withProjects())
        .map((h) => h.id)
        .filter((id) => !id.endsWith('#filter')),
    ).toEqual(['northwind/seo-retainer']);
    expect(
      hits('projects', 'AH', withProjects())
        .map((h) => h.id)
        .filter((id) => !id.endsWith('#filter')),
    ).toEqual(['acme-heating/website-rebuild']);
    expect(
      hits('projects', 'seo-retainer', withProjects())
        .map((h) => h.id)
        .filter((id) => !id.endsWith('#filter')),
    ).toEqual(['northwind/seo-retainer']);
    expect(hits('projects', 'old site', withProjects())).toEqual([]);
  });

  it('finds a project by its code: any case, brackets ignored, O and 0 alike in the client part', () => {
    const coded = [
      card({ ref: 'H2O4K7', refState: 'ok' }),
      card({ key: 'northwind/seo-retainer', slug: 'seo-retainer', client: 'northwind', ref: 'NWD5M2' }),
    ];
    const ids = (q: string) =>
      hits('projects', q, withProjects({ projects: coded }))
        .map((h) => h.id)
        .filter((id) => !id.endsWith('#filter'));
    expect(ids('[nwd5m2]')).toEqual(['northwind/seo-retainer']);
    expect(ids('NWD5M2')).toEqual(['northwind/seo-retainer']);
    expect(ids('h204k7')).toEqual(['acme-heating/website-rebuild']);
  });

  it('opens the project page first, with "Filter to this project" as the second action', () => {
    const [open, filter] = hits('projects', 'website', withProjects());
    expect(open?.label).toBe('Acme Heating · Website rebuild');
    expect(open?.hint).toBe('Open project');
    const openView = vi.fn();
    open?.run({ openView } as unknown as SearchActions);
    expect(openView).toHaveBeenCalledWith('app:projects');
    expect(projectPageRequest.get()).toBe('acme-heating/website-rebuild');
    expect(filter?.hint).toBe('Filter to this project');
    const filterToProject = vi.fn();
    filter?.run({ filterToProject } as unknown as SearchActions);
    expect(filterToProject).toHaveBeenCalledWith('acme-heating/website-rebuild');
    projectPageRequest.set('');
  });

  it('has no hits before the list has loaded (an older server too)', () => {
    expect(hits('projects', 'website')).toEqual([]);
  });

  it('puts "Client · Project" on a task hit', () => {
    const t = todo('t1', 'Ship the build', {
      projectMatch: { how: 'key', key: 'acme-heating/website-rebuild' },
    });
    const [hit] = hits('todos', 'ship', withProjects({ todos: list([t]) }));
    expect(hit?.hint).toContain('Acme Heating · Website rebuild');
  });
});

describe('Done tasks', () => {
  const done = (id: string, title: string, over: Partial<DoneTodo> = {}): DoneTodo => ({
    key: `done:todo/done/${id}`,
    id,
    scope: 'tds',
    path: `todo/done/${id}`,
    title,
    assignee: null,
    assigneeName: null,
    due: null,
    details: '',
    done: { slug: 'sam', name: 'Sam Example', at: '2026-11-12T10:00:00Z', source: 'stamp' },
    version: 'v1',
    attachments: [],
    client: 'northwind',
    project: null,
    stage: null,
    ...over,
  });
  const load = (items: DoneTodo[]) => {
    // Seeds the shared store's list the way a finished load does.
    doneStore.reset();
    vi.spyOn(doneStore, 'get').mockReturnValue({
      list: { items, historyRead: true },
      loading: false,
      error: null,
    });
  };

  it('is its own group, with a title, and finds finished tasks by title and place', () => {
    load([done('a', 'Send the quote'), done('b', 'Book the van')]);
    const s = source('done-todos');
    expect(s.title).toBe('Done tasks');
    expect(s.idle).toBeUndefined();
    expect(labels(hits('done-todos', 'quote'))).toEqual(['Send the quote']);
    expect(labels(hits('done-todos', 'northwind'))).toHaveLength(2);
    expect(hits('done-todos', 'zzz')).toEqual([]);
  });

  it('caps the group and reports the full total', () => {
    load(Array.from({ length: 9 }, (_, i) => done(`t${i}`, `Quote ${i}`)));
    const res = source('done-todos').search?.('quote', ctx());
    expect(res?.hits).toHaveLength(SEARCH_GROUP_MAX);
    expect(res?.total).toBe(9);
  });

  it('hints when and where, and choosing one reveals it', () => {
    load([done('a', 'Send the quote'), done('b', 'Old thing', { done: null, client: null })]);
    const [first] = hits('done-todos', 'quote');
    expect(first?.hint).toMatch(/^Done 12 Nov/);
    expect(first?.hint).toContain('Northwind');
    expect(hits('done-todos', 'old')[0]?.hint).toBe('Done, date not known');
    const actions = { revealDone: vi.fn() } as unknown as SearchActions;
    first?.run(actions);
    expect(actions.revealDone).toHaveBeenCalledWith('done:todo/done/a');
  });
});
