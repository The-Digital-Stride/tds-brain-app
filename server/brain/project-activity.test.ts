import { describe, expect, it } from 'vitest';
import type { Identity } from '../../shared/contract.ts';
import {
  ACTIVITY_MAX,
  ACTIVITY_TOKEN_TTL_MS,
  PROJECT_SEEN_LIST_MAX,
  type ProjectSeen,
} from '../../shared/project-activity-contract.ts';
import type { ProjectUpdateItem } from '../../shared/project-updates-contract.ts';
import type { ProjectCard, ProjectTodoRow } from '../../shared/projects-contract.ts';
import { createProjectSeenStore } from '../store/project-seen.ts';
import { createProjectActivity, type DoneInfo } from './project-activity.ts';
import type { ProjectsIndex } from './projects.ts';

const KEY = 'acme/web';
const FOLDER = 'clients/acme/projects/web';
const me: Identity = { name: 'Sam Taylor', slug: 'sam-taylor', email: null, role: 'team', knownMember: true };
const NOW = new Date(2026, 10, 23, 12, 0, 0); // local, 23 Nov 2026
const SINCE = new Date(2026, 10, 20, 9, 0, 0).toISOString();

const card = (over: Partial<ProjectCard> = {}): ProjectCard =>
  ({
    key: KEY,
    space: 'client',
    slug: 'web',
    client: 'acme',
    folder: FOLDER,
    card: 'ok',
    archived: false,
    status: 'active',
    end: null,
    links: [],
    ...over,
  }) as ProjectCard;

const todo = (
  id: string,
  title = id,
  due: string | null = null,
  scope: 'tds' | 'personal' = 'tds',
): ProjectTodoRow => ({
  key: scope === 'personal' ? `personal/${id}` : id,
  id,
  scope,
  title,
  assignee: null,
  due,
  stage: null,
  mine: true,
});

const update = (
  kind: string,
  by: string,
  at: string,
  extra: Partial<ProjectUpdateItem> = {},
): ProjectUpdateItem =>
  ({
    v: 1,
    kind,
    by,
    at,
    clientSafe: false,
    summary: 'SECRET summary text',
    emailSubject: 'SECRET subject',
    path: `${FOLDER}/updates/${at}.md`,
    version: 'x',
    byName: by,
    canRemove: false,
    ...extra,
  }) as ProjectUpdateItem;

const item = (path: string) => ({ path }) as never;

interface World {
  card: ProjectCard | null;
  todos: ProjectTodoRow[];
  files: string[];
  updates: ProjectUpdateItem[];
  done: Record<string, DoneInfo>;
  now: Date;
}

function setup(seed: ProjectSeen | null, w: Partial<World> = {}) {
  const world: World = { card: card(), todos: [], files: [], updates: [], done: {}, now: NOW, ...w };
  const store = createProjectSeenStore(null);
  const ready = seed ? store.set(KEY, seed) : Promise.resolve();
  let n = 0;
  const svc = createProjectActivity({
    index: async () =>
      ({ byKey: (k: string) => (k === KEY ? world.card : null) }) as unknown as ProjectsIndex,
    todos: async () => ({ todos: world.todos, count: world.todos.length }),
    files: async () => ({ items: world.files.map(item), hidden: 0 }),
    updates: async () => ({ updates: world.updates, more: false, unreadable: 0, canAdd: true }),
    done: async (id) => world.done[id] ?? null,
    roster: async () =>
      new Map([
        ['ben-mcadam', 'Ben McAdam'],
        ['sam-taylor', 'Sam Taylor'],
      ]),
    store,
    now: () => world.now,
    token: () => `tok-${++n}`,
  });
  return { svc, store, world, ready };
}

const seed = (over: Partial<ProjectSeen> = {}): ProjectSeen => ({
  at: SINCE,
  folder: FOLDER,
  todos: [],
  links: [],
  files: [],
  ...over,
});

const texts = async (s: ReturnType<typeof setup>) => {
  await s.ready;
  return (await s.svc.read(KEY, me)).items.map((i) => i.text);
};

describe('project activity', () => {
  it('first visit: since null, no items, and a token that saves the snapshot', async () => {
    const s = setup(null, { todos: [todo('a.md', 'Send the quote')], files: [`${FOLDER}/brief.md`] });
    const r = await s.svc.read(KEY, me);
    expect(r.since).toBeNull();
    expect(r.items).toEqual([]);
    expect(r.token).toBe('tok-1');
    await s.svc.seen(KEY, 'tok-1', me);
    const saved = await s.store.get(KEY);
    expect(saved?.todos).toEqual(['a.md']);
    expect(saved?.files).toEqual(['brief.md']);
    expect(saved?.todoTitles).toEqual({ 'a.md': 'Send the quote' });
  });

  it('a different folder counts as a first visit', async () => {
    const s = setup(seed({ folder: 'clients/acme/projects/old-web' }), { todos: [todo('a.md')] });
    await s.ready;
    const r = await s.svc.read(KEY, me);
    expect(r.since).toBeNull();
    expect(r.items).toEqual([]);
  });

  it('lists a to-do added, done and gone, never a gone one with no known title', async () => {
    const s = setup(
      seed({
        todos: ['done.md', 'moved.md', 'untitled.md'],
        todoTitles: { 'done.md': 'Send the quote', 'moved.md': 'Book the venue' },
      }),
      {
        todos: [todo('new.md', 'Write the brief')],
        done: { 'done.md': { title: 'x', by: 'ben-mcadam', at: '2026-11-22T10:00:00.000Z' } },
      },
    );
    expect(await texts(s)).toEqual([
      'To-do done: Send the quote',
      'To-do added: Write the brief',
      'No longer in this project: Book the venue',
    ]);
    const r = await s.svc.read(KEY, me);
    expect(r.items[0]).toMatchObject({
      byName: 'Ben McAdam',
      at: '2026-11-22T10:00:00.000Z',
      target: { kind: 'todo', key: 'done.md' },
    });
  });

  it('a gone personal to-do is never listed (personal to-dos are always your own)', async () => {
    const s = setup(seed({ todos: ['personal/p.md'], todoTitles: { 'personal/p.md': 'Book dentist' } }), {
      todos: [],
    });
    expect(await texts(s)).toEqual([]);
  });

  it('an update written before your last look but synced in after it is listed once, then not again', async () => {
    const early = update('note', 'ben-mcadam', '2026-11-19T10:00:00.000Z'); // dated before SINCE
    const s = setup(seed({ updates: [] }), { updates: [early] });
    await s.ready;
    const r = await s.svc.read(KEY, me);
    expect(r.items.map((i) => i.text)).toEqual(['Ben McAdam added a note']);
    await s.svc.seen(KEY, r.token as string, me);
    expect((await s.store.get(KEY))?.updates).toEqual([early.path]);
    expect((await s.svc.read(KEY, me)).items).toEqual([]);
  });

  it('uses the done file title when the snapshot has none, and leaves out their own tick', async () => {
    const s = setup(seed({ todos: ['a.md', 'b.md'] }), {
      done: {
        'a.md': { title: 'From the file', by: 'ben-mcadam', at: null },
        'b.md': { title: 'Mine', by: 'sam-taylor', at: '2026-11-22T10:00:00.000Z' },
      },
    });
    expect(await texts(s)).toEqual(['To-do done: From the file']);
  });

  it('lists a link and a file added, with a path both linked and a file shown once as a file', async () => {
    const s = setup(seed({ files: ['old.md'] }), {
      card: card({ links: ['clients/acme/calls/2026-11-21.md', `${FOLDER}/both.md`] }),
      files: [`${FOLDER}/old.md`, `${FOLDER}/both.md`, `${FOLDER}/sub/new.pdf`],
    });
    await s.ready;
    const r = await s.svc.read(KEY, me);
    expect(r.items.map((i) => i.text)).toEqual([
      'New file: both.md',
      'New file: new.pdf',
      'Linked: 2026-11-21.md',
    ]);
    expect(r.items[1]?.target).toEqual({ kind: 'file', path: `${FOLDER}/sub/new.pdf` });
  });

  it('a linked file kept outside the folder reads as Linked, though the Files read lists it too', async () => {
    const s = setup(seed({ files: ['old.md'] }), {
      card: card({ links: ['clients/acme/notes/call.md'] }),
      files: [`${FOLDER}/old.md`, 'clients/acme/notes/call.md'],
    });
    expect(await texts(s)).toEqual(['Linked: call.md']);
  });

  it('file paths are relative to the folder, so a file outside it keeps its full path', async () => {
    const s = setup(seed({ files: ['brief.md', 'clients/acme/shared/x.md'] }), {
      files: [`${FOLDER}/brief.md`, 'clients/acme/shared/x.md'],
    });
    expect(await texts(s)).toEqual([]);
  });

  it('updates: after since only, who and kind only, auto entries as status, unknown kinds', async () => {
    const s = setup(seed(), {
      updates: [
        update('note', 'ben-mcadam', '2026-11-22T10:00:00.000Z'),
        update('call', 'ben-mcadam', '2026-11-21T10:00:00.000Z'),
        update('status', 'ben-mcadam', '2026-11-22T11:00:00.000Z', { change: 'health' }),
        update('status', 'ben-mcadam', '2026-11-22T11:30:00.000Z', { change: 'status' }),
        update('owner', 'ben-mcadam', '2026-11-22T12:00:00.000Z', { change: 'owner' }),
        update('email', 'ben-mcadam', '2026-11-22T13:00:00.000Z'),
        update('note', 'ben-mcadam', '2026-11-19T10:00:00.000Z'), // before since
      ],
    });
    await s.ready;
    const r = await s.svc.read(KEY, me);
    expect(r.items.map((i) => `${i.kind}|${i.text}`)).toEqual([
      'update|Ben McAdam added an update',
      'status|Account Owner changed',
      'status|Status changed',
      'status|Health changed',
      'update|Ben McAdam added a note',
      'update|Ben McAdam added a call',
    ]);
    const json = JSON.stringify(r);
    expect(json).not.toContain('SECRET');
    expect(r.items[0]?.target).toEqual({ kind: 'updates' });
  });

  it('leaves out their own updates (and "me" in a personal project)', async () => {
    const s = setup(seed(), {
      updates: [update('note', 'sam-taylor', '2026-11-22T10:00:00.000Z')],
    });
    expect(await texts(s)).toEqual([]);
    const p = setup(seed(), {
      card: card({ space: 'personal', key: KEY }),
      updates: [update('note', 'me', '2026-11-22T10:00:00.000Z')],
    });
    expect(await texts(p)).toEqual([]);
  });

  it('orders items with a time newest first, then the rest in kind order, and caps at ACTIVITY_MAX', async () => {
    const todos = Array.from({ length: 25 }, (_, i) => todo(`t${i}.md`, `T${i}`));
    const s = setup(seed(), {
      todos,
      files: [`${FOLDER}/f.md`],
      updates: [update('note', 'ben-mcadam', '2026-11-22T10:00:00.000Z')],
    });
    await s.ready;
    const r = await s.svc.read(KEY, me);
    expect(r.items).toHaveLength(ACTIVITY_MAX);
    expect(r.items[0]?.kind).toBe('update');
    expect(r.more).toBe(1 + 25 + 1 - ACTIVITY_MAX);
    expect(r.items[1]?.kind).toBe('todo-added');
  });

  it('does not list "added" from a list that was cut', async () => {
    const full = Array.from({ length: PROJECT_SEEN_LIST_MAX }, (_, i) => `t${i}.md`);
    const s = setup(seed({ todos: full, cut: true }), { todos: [todo('brand-new.md')] });
    expect((await texts(s)).filter((t) => t.startsWith('To-do added'))).toEqual([]);
  });

  it('coming up: overdue first, within 14 days, soonest next, and the end date', async () => {
    const s = setup(seed(), {
      card: card({ end: '2026-12-01' }),
      todos: [
        todo('later.md', 'Later', '2026-12-30'),
        todo('soon.md', 'Soon', '2026-11-25'),
        todo('late.md', 'Late', '2026-11-10'),
        todo('edge.md', 'Edge', '2026-12-07'),
        todo('none.md', 'None'),
      ],
    });
    await s.ready;
    const r = await s.svc.read(KEY, me);
    expect(r.comingUp.map((c) => [c.kind, c.text, c.date, c.overdue])).toEqual([
      ['todo-due', 'Late', '2026-11-10', true],
      ['todo-due', 'Soon', '2026-11-25', false],
      ['project-end', 'Project end date', '2026-12-01', false],
      ['todo-due', 'Edge', '2026-12-07', false],
    ]);
    expect(r.comingUp[3]?.target).toEqual({ kind: 'todo', key: 'edge.md' });
    expect(r.comingUp[2]?.target).toBeNull();
  });

  it('coming up: an end date in the past shows overdue while open, and nothing once the project is done', async () => {
    const open = setup(seed(), { card: card({ end: '2026-11-01' }) });
    await open.ready;
    expect((await open.svc.read(KEY, me)).comingUp).toMatchObject([{ kind: 'project-end', overdue: true }]);
    const done = setup(seed(), { card: card({ end: '2026-11-01', status: 'done' }) });
    await done.ready;
    expect((await done.svc.read(KEY, me)).comingUp).toEqual([]);
  });

  it('own personal to-dos follow what the To-dos read gives (key personal/<id>)', async () => {
    const s = setup(seed(), { todos: [todo('mine.md', 'My own', '2026-11-24', 'personal')] });
    await s.ready;
    const r = await s.svc.read(KEY, me);
    expect(r.items[0]).toMatchObject({ text: 'To-do added: My own', target: { key: 'personal/mine.md' } });
    expect(r.comingUp[0]?.target).toEqual({ kind: 'todo', key: 'personal/mine.md' });
  });

  it('an archived project answers empty with no token and holds nothing', async () => {
    const s = setup(seed(), { card: card({ archived: true }), todos: [todo('a.md')] });
    await s.ready;
    const r = await s.svc.read(KEY, me);
    expect(r).toMatchObject({ token: null, items: [], more: 0, comingUp: [] });
    await s.svc.seen(KEY, 'tok-1', me);
    expect((await s.store.get(KEY))?.todos).toEqual([]);
  });

  it('an unknown project is not-found', async () => {
    const s = setup(null);
    await expect(s.svc.read('acme/nope', me)).rejects.toMatchObject({ code: 'not-found' });
  });

  describe('token', () => {
    it("commits the READ's snapshot, not the project as it is now", async () => {
      const s = setup(seed(), { todos: [todo('a.md', 'A')] });
      await s.ready;
      const r = await s.svc.read(KEY, me);
      s.world.todos = [todo('a.md', 'A'), todo('synced-meanwhile.md')];
      await s.svc.seen(KEY, r.token as string, me);
      expect((await s.store.get(KEY))?.todos).toEqual(['a.md']);
      expect((await s.svc.read(KEY, me)).items.map((i) => i.text)).toEqual([
        'To-do added: synced-meanwhile.md',
      ]);
    });

    it('a superseded, unknown, other-person or reused token saves nothing; reading alone saves nothing', async () => {
      const s = setup(seed(), { todos: [todo('a.md')] });
      await s.ready;
      const first = await s.svc.read(KEY, me);
      const second = await s.svc.read(KEY, me);
      expect(await s.store.get(KEY)).toEqual(seed());
      await s.svc.seen(KEY, first.token as string, me);
      await s.svc.seen(KEY, 'nope', me);
      await s.svc.seen(KEY, second.token as string, { ...me, slug: 'ben-mcadam' });
      await s.svc.seen('acme/other', second.token as string, me);
      expect(await s.store.get(KEY)).toEqual(seed());
      await s.svc.seen(KEY, second.token as string, me);
      expect((await s.store.get(KEY))?.todos).toEqual(['a.md']);
      await s.store.set(KEY, seed());
      await s.svc.seen(KEY, second.token as string, me); // used once
      expect(await s.store.get(KEY)).toEqual(seed());
    });

    it('an expired token saves nothing', async () => {
      const s = setup(seed(), { todos: [todo('a.md')] });
      await s.ready;
      const r = await s.svc.read(KEY, me);
      s.world.now = new Date(NOW.getTime() + ACTIVITY_TOKEN_TTL_MS + 1);
      await s.svc.seen(KEY, r.token as string, me);
      expect(await s.store.get(KEY)).toEqual(seed());
    });
  });
});
