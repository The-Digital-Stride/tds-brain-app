import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientInfo, Identity, TodoItem } from '../../shared/contract.ts';
import { TodoChangeError } from '../../shared/contract.ts';
import {
  INTERNAL_CLIENT,
  PROJECTS_ARCHIVE_CAPABILITY,
  PROJECTS_CAPABILITY,
  PROJECTS_MOVE_CAPABILITY,
  type ProjectAction,
  type ProjectCard,
  type ProjectMoveCheckResponse,
  type ProjectMoveResult,
  type ProjectRemoveCheck,
  type ProjectRemoveCheckResponse,
  type ProjectRemoveResult,
  ProjectsError,
  type ProjectsErrorCode,
} from '../../shared/projects-contract.ts';
import { createProjects, type ProjectsOptions } from './projects.ts';
import type { ProjectsSkillRunner } from './projects-skill.ts';
import type { TodoRunAction, TodoSkillRunner } from './todo-skill.ts';

const NOW = new Date('2026-11-21T12:00:00Z');
const ME: Identity = {
  name: 'Ian Hancock',
  slug: 'ian-hancock',
  email: 'ian@example.test',
  role: 'owner',
  knownMember: true,
};

let root: string;
let data: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'projects-reader-'));
  data = mkdtempSync(join(tmpdir(), 'projects-data-'));
  put(
    '.team-config/roles.json',
    JSON.stringify({ members: [{ name: 'Simon Jones', email: 'simon@example.test', role: 'team' }] }),
  );
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(data, { recursive: true, force: true });
});

const abs = (rel: string) => join(root, ...rel.split('/'));
function put(rel: string, text = '') {
  mkdirSync(dirname(abs(rel)), { recursive: true });
  writeFileSync(abs(rel), text);
}
const folder = (rel: string) => mkdirSync(abs(rel), { recursive: true });
const sha = (rel: string) =>
  createHash('sha256')
    .update(readFileSync(abs(rel)))
    .digest('hex');
const card = (title: string, extra = '') =>
  `---\nv: 1\ntitle: ${title}\nstatus: active\n${extra}---\n\nThe brief.\n`;
const todoText = (fields: Record<string, string>) =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n\n# To-do\n`;

const CLIENTS: ClientInfo[] = ['acme', 'harvey-nash', INTERNAL_CLIENT].map((slug) => ({ slug, name: slug }));

interface Fakes {
  skillRuns: ProjectAction[];
  todoRuns: TodoRunAction[];
  caps: string[];
  gitCalls: string[][];
  /** Answers per git call; default: no output. */
  gitAnswer: (args: string[]) => string;
  /** Per to-do id: fail its tidy write with this code ('crash': a plain Error). */
  todoFail: Record<string, 'changed' | 'not-found' | 'crash'>;
  createExists: boolean;
  todoCaps: string[];
  /** A move's script refusal. */
  moveFail: ProjectsErrorCode | null;
  moved: [string, string][];
  /** The script's refusal of archive, unarchive or delete. */
  removeFail: ProjectsErrorCode | null;
  /** A delete whose hidden folder the script couldn't remove: its answer's `leftBehind`. */
  leftBehind: string | null;
}
let fakes: Fakes;

function service(
  extra: {
    dataDir?: string | null;
    mayChange?: ProjectsOptions['mayChange'];
    todoList?: ProjectsOptions['todoList'];
  } = {},
) {
  fakes = {
    skillRuns: [],
    todoRuns: [],
    caps: [PROJECTS_CAPABILITY],
    gitCalls: [],
    gitAnswer: () => '',
    todoFail: {},
    createExists: false,
    todoCaps: ['todo-project-v1'],
    moveFail: null,
    moved: [],
    removeFail: null,
    leftBehind: null,
  };
  const skill: ProjectsSkillRunner = {
    async run(action) {
      fakes.skillRuns.push(action);
      if (action.kind === 'create') {
        if (fakes.createExists) throw new ProjectsError('exists', 'There is already a project called that.');
        const rel =
          action.space === 'personal'
            ? `personal/projects/${action.slug}`
            : `clients/${action.client}/projects/${action.slug}`;
        put(`${rel}/project.md`, card(action.fields.title));
        return {
          key: action.space === 'personal' ? `personal/${action.slug}` : `${action.client}/${action.slug}`,
          version: 'x',
        };
      }
      if (action.kind === 'move') {
        // Stands in for the script's move: renames the folder and adds moved_from.
        if (fakes.moveFail) throw new ProjectsError(fakes.moveFail, 'The script said no.');
        const [client, slug] = action.key.split('/') as [string, string];
        const key = `${action.client}/${slug}`;
        if (action.check) {
          const check = {
            key,
            files: [],
            fileCount: 0,
            ignoredCount: 0,
            personalLinks: [],
            filesVersion: 'f'.repeat(64),
          };
          return { key, version: 'v'.repeat(64), check };
        }
        const from =
          client === 'personal' ? `personal/projects/${slug}` : `clients/${client}/projects/${slug}`;
        const to = `clients/${action.client}/projects/${slug}`;
        mkdirSync(dirname(abs(to)), { recursive: true });
        renameSync(abs(from), abs(to));
        const text = readFileSync(abs(`${to}/project.md`), 'utf8');
        writeFileSync(
          abs(`${to}/project.md`),
          text.replace('\n---\n', `\nmoved_from:\n  - "${action.key}"\n---\n`),
        );
        return { key, version: 'w'.repeat(64) };
      }
      if (action.kind === 'archive' || action.kind === 'unarchive' || action.kind === 'delete') {
        // Stands in for the script: renames or removes the folder, as the plan's decisions 3 to 5 say.
        if (fakes.removeFail) throw new ProjectsError(fakes.removeFail, 'The script said no.');
        const [client, slug] = action.key.split('/') as [string, string];
        const live =
          client === 'personal' ? `personal/projects/${slug}` : `clients/${client}/projects/${slug}`;
        const arch =
          client === 'personal'
            ? `personal/projects-archive/${slug}`
            : `clients/${client}/projects-archive/${slug}`;
        if (action.check) {
          const removeCheck: ProjectRemoveCheck = {
            key: action.key,
            from: action.kind === 'unarchive' ? arch : live,
            to: action.kind === 'delete' ? null : action.kind === 'archive' ? arch : live,
            files: [],
            fileCount: 0,
            images: 0,
            documents: 0,
            other: 0,
            bytes: 0,
            ignoredCount: 0,
            localOnlyCount: 0,
            references: [],
            referenceCount: 0,
            filesVersion: 'f'.repeat(64),
            empty: true,
            allowed: true,
            allowedWho: '',
          };
          return { key: action.key, version: '', removeCheck };
        }
        if (action.kind === 'archive') {
          mkdirSync(dirname(abs(arch)), { recursive: true });
          renameSync(abs(live), abs(arch));
        } else if (action.kind === 'unarchive') renameSync(abs(arch), abs(live));
        else rmSync(abs(client === 'personal' || existsSync(abs(arch)) ? arch : live), { recursive: true });
        if (action.kind === 'delete' && fakes.leftBehind) {
          return { key: action.key, version: '', leftBehind: fakes.leftBehind };
        }
        return { key: action.key, version: '' };
      }
      return { key: 'key' in action ? action.key : '', version: 'v'.repeat(64) };
    },
    capabilities: async () => fakes.caps,
  };
  // Stands in for the to-do script: really writes the project lines, so re-reads see them.
  const todoSkill: TodoSkillRunner = {
    async run(action) {
      fakes.todoRuns.push(action);
      const fail = 'id' in action ? fakes.todoFail[action.id] : undefined;
      if (fail === 'crash') throw new Error('the script crashed');
      if (fail) throw new TodoChangeError(fail, 'no');
      if (action.kind !== 'project') return { file: null };
      const rel = action.scope === 'personal' ? `personal/todo/${action.id}` : `todo/${action.id}`;
      const lines = readFileSync(abs(rel), 'utf8')
        .split('\n')
        .filter((l) => !/^(client|project|stage):/.test(l));
      const add = [
        action.client ? `client: ${action.client}` : null,
        action.project ? `project: ${action.project}` : null,
        action.stage ? `stage: ${action.stage}` : null,
      ].filter((l): l is string => l !== null);
      lines.splice(1, 0, ...add);
      writeFileSync(abs(rel), lines.join('\n'));
      return { file: action.id };
    },
    capabilities: async () => fakes.todoCaps,
  };
  return createProjects(root, {
    skill,
    todoSkill,
    clients: async () => CLIENTS,
    dataDir: extra.dataDir === undefined ? data : extra.dataDir,
    ...(extra.mayChange ? { mayChange: extra.mayChange } : {}),
    ...(extra.todoList ? { todoList: extra.todoList } : {}),
    onMoved: (from, to) => fakes.moved.push([from, to]),
    now: () => NOW,
    git: async (args) => {
      fakes.gitCalls.push([...args]);
      return fakes.gitAnswer([...args]);
    },
  });
}
const byKey = (cards: ProjectCard[], key: string) => cards.find((c) => c.key === key);

describe('walking the projects locations', () => {
  it('finds client, personal, legacy, archive and archived-client projects, card or not', async () => {
    put(
      'clients/acme/projects/website/project.md',
      card('Website rebuild', 'client: acme\nhealth: green\nteam:\n  - "simon-jones"\n'),
    );
    folder('personal/projects/jev');
    put('projects/client-portal/README.md', '# Client Portal — productisation\n');
    put('projects/client-portal/todo.md', '- [ ] a\n');
    folder('projects-archive/old-funnel');
    put('clients/_archive/zed/projects/old-site/project.md', card('Old site'));
    put('projects/README.md', 'not a project');
    const index = await service().index();
    expect(index.cards.map((c) => [c.key, c.space, c.card, c.archived, c.folder])).toEqual([
      ['acme/website', 'client', 'ok', false, 'clients/acme/projects/website'],
      [`${INTERNAL_CLIENT}/client-portal`, 'legacy', 'none', false, 'projects/client-portal'],
      [`${INTERNAL_CLIENT}/old-funnel`, 'legacy', 'none', true, 'projects-archive/old-funnel'],
      ['zed/old-site', 'client', 'ok', true, 'clients/_archive/zed/projects/old-site'],
      ['personal/jev', 'personal', 'none', false, 'personal/projects/jev'],
    ]);
    const site = index.byKey('acme/website') as ProjectCard;
    expect(site).toMatchObject({
      title: 'Website rebuild',
      client: 'acme',
      status: 'active',
      health: 'green',
      team: ['simon-jones'],
      brief: 'The brief.',
      version: sha('clients/acme/projects/website/project.md'),
      checklist: null,
    });
    expect(index.byKey(`${INTERNAL_CLIENT}/client-portal`)).toMatchObject({
      title: 'Client Portal — productisation',
      client: INTERNAL_CLIENT,
      version: '',
      checklist: 'projects/client-portal/todo.md',
    });
    expect(index.byKey('personal/jev')).toMatchObject({ title: 'Jev', client: null });
    expect(index.byKey(`${INTERNAL_CLIENT}/old-funnel`)?.status).toBe('done');
    expect(index.byKey('zed/old-site')?.status).toBe('done');
  });

  it('reads a brief with a ======= divider, and only a full conflict as unreadable (review fix 6)', async () => {
    put(
      'clients/acme/projects/divided/project.md',
      card('Divided', '').replace('The brief.', 'One\n=======\nTwo'),
    );
    put(
      'clients/acme/projects/merged/project.md',
      `${card('Merged')}<<<<<<< HEAD\na\n=======\nb\n>>>>>>> main\n`,
    );
    const { cards } = await service().index();
    expect(byKey(cards, 'acme/divided')?.card).toBe('ok');
    expect(byKey(cards, 'acme/divided')?.brief).toBe('One\n=======\nTwo');
    expect(byKey(cards, 'acme/merged')?.card).toBe('unreadable');
  });

  it('keeps an unreadable card as a project, titled from its folder', async () => {
    put(
      'clients/acme/projects/brand-refresh/project.md',
      '---\n<<<<<<< HEAD\ntitle: A\n=======\ntitle: B\n>>>>>>> x\n---\n',
    );
    put('clients/acme/projects/no-block/project.md', 'Just text.\n');
    const index = await service().index();
    expect(index.byKey('acme/brand-refresh')).toMatchObject({
      card: 'unreadable',
      title: 'Brand refresh',
      version: '',
    });
    expect(index.byKey('acme/no-block')?.card).toBe('unreadable');
  });

  it('follows INTERNAL_PRECEDENCE and lists shadowed folders as duplicates', async () => {
    put(`clients/${INTERNAL_CLIENT}/projects/portal/project.md`, card('Portal'));
    folder('projects/portal');
    folder('projects-archive/portal');
    folder('projects/brain-map');
    folder('projects-archive/brain-map');
    folder('clients/acme/projects/site');
    folder('clients/_archive/acme/projects/site');
    const list = await service().list(ME);
    expect(list.projects.filter((p) => p.key === `${INTERNAL_CLIENT}/portal`)).toHaveLength(1);
    expect(byKey(list.projects, `${INTERNAL_CLIENT}/portal`)?.folder).toBe(
      `clients/${INTERNAL_CLIENT}/projects/portal`,
    );
    expect(byKey(list.projects, `${INTERNAL_CLIENT}/brain-map`)).toMatchObject({
      folder: 'projects/brain-map',
      archived: false,
    });
    expect(byKey(list.projects, 'acme/site')?.archived).toBe(false);
    expect([...list.duplicates].sort()).toEqual([
      'clients/_archive/acme/projects/site',
      'projects-archive/brain-map',
      'projects-archive/portal',
      'projects/portal',
    ]);
  });

  it('skips and counts folders whose names are not slugs', async () => {
    folder('projects/Bad Name');
    folder('clients/acme/projects/UPPER');
    folder('clients/acme/projects/.hidden');
    folder('projects/ok-one');
    const list = await service().list(ME);
    expect(list.projects.map((p) => p.key)).toEqual([`${INTERNAL_CLIENT}/ok-one`]);
    expect(list.skippedFolders).toBe(2);
  });

  it("never reads personal projects that git tracks (another person's) or that sit behind a link", async () => {
    folder('personal/projects/mine');
    put('personal/projects/synced/project.md', card('Synced'));
    const s = service();
    fakes.gitAnswer = (args) => (args[0] === 'ls-files' ? 'personal/projects/synced/project.md\0' : '');
    expect((await s.index()).cards.map((c) => c.key)).toEqual(['personal/mine']);

    rmSync(abs('personal'), { recursive: true });
    const elsewhere = mkdtempSync(join(tmpdir(), 'projects-elsewhere-'));
    mkdirSync(join(elsewhere, 'projects', 'linked'), { recursive: true });
    folder('personal');
    symlinkSync(join(elsewhere, 'projects'), abs('personal/projects'));
    expect((await service().index()).cards).toEqual([]);
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it("drops a shared project's link to a personal/ file on read", async () => {
    const section =
      '\n## Linked files\n\n- [a](../../../../clients/acme/a.pdf)\n- [mine](../../../../personal/files/x.pdf)\n';
    put('clients/acme/projects/site/project.md', card('Site') + section);
    put('personal/projects/mine/project.md', card('Mine') + section);
    const index = await service().index();
    expect(index.byKey('acme/site')?.links).toEqual(['clients/acme/a.pdf']);
    expect(index.byKey('personal/mine')?.links).toEqual(['clients/acme/a.pdf', 'personal/files/x.pdf']);
    expect(index.keysForPath('clients/acme/a.pdf').sort()).toEqual(['acme/site', 'personal/mine']);
    expect(index.keysForPath('personal/files/x.pdf')).toEqual(['personal/mine']);
    expect(index.keysForPath('clients/acme/projects/site/brief.pdf')).toEqual(['acme/site']);
    expect(index.keysForPath('clients/acme/projects/site-two/x.pdf')).toEqual([]);
  });

  it('reads lastChanged from git for shared folders, by team slug, and never for personal ones', async () => {
    put('clients/acme/projects/site/project.md', card('Site'));
    folder('personal/projects/mine');
    const s = service();
    fakes.gitAnswer = (args) =>
      args[0] === 'log' ? 'Simon J\0simon@example.test\0' + '2026-11-20T10:00:00+00:00\n' : '';
    const index = await s.index();
    expect(index.byKey('acme/site')?.lastChanged).toEqual({
      by: 'simon-jones',
      at: '2026-11-20T10:00:00+00:00',
    });
    expect(index.byKey('personal/mine')?.lastChanged).toBeNull();
    expect(fakes.gitCalls.filter((c) => c[0] === 'log').map((c) => c[c.length - 1])).toEqual([
      'clients/acme/projects/site',
    ]);
  });

  it('resolves to-do labels, never a TDS to-do to a personal project', async () => {
    folder('clients/acme/projects/site');
    folder('personal/projects/tds-brain-app');
    const index = await service().index();
    expect(index.resolve('acme/site', 'acme', 'tds')).toEqual({ how: 'key', key: 'acme/site' });
    expect(index.resolve('tds-brain-app', null, 'tds')).toEqual({ how: 'loose', label: 'tds-brain-app' });
    expect(index.resolve('tds-brain-app', null, 'personal')).toEqual({
      how: 'legacy',
      key: 'personal/tds-brain-app',
    });
    expect(index.resolve('harvey-nash', null, 'tds')).toEqual({ how: 'client', client: 'harvey-nash' });
  });
});

describe('counts and the team from to-dos', () => {
  beforeEach(() => {
    put(
      'clients/acme/projects/site/project.md',
      card('Site', 'client: acme\nowner: ian-hancock\nteam:\n  - "ben-mcadam"\n'),
    );
    put('projects/client-portal/README.md', '# Portal\n');
    folder('personal/projects/jev');
    put(
      'todo/a.md',
      todoText({ assignee: 'simon-jones', project: 'acme/site', client: 'acme', created: '2026-11-02' }),
    );
    put('todo/b.md', todoText({ assignee: 'simon-jones', project: 'acme/site', created: '2026-11-10' }));
    put('todo/c.md', todoText({ assignee: 'ben-mcadam', project: 'acme/site' }));
    put('todo/d.md', todoText({ assignee: 'ian-hancock', project: 'acme/site' }));
    put('todo/e.md', todoText({ assignee: 'pete-tyler', project: 'client-portal', created: '2026-11-01' }));
    put(
      'todo/done/f.md',
      todoText({ assignee: 'jo-done', project: 'acme/site', completed_at: '2026-11-15T10:00:00+00:00' }),
    );
    put(
      'todo/done/g.md',
      todoText({ assignee: 'kim-old', project: 'acme/site', completed_at: '2026-10-01T10:00:00+00:00' }),
    );
    put('todo/done/h.md', todoText({ assignee: 'lee-plain', project: 'acme/site', completed: '2026-11-19' }));
    put('todo/done/i.md', todoText({ assignee: 'max-undated', project: 'acme/site' }));
    put('personal/todo/p.md', todoText({ assignee: 'ian-hancock', project: 'acme/site' }));
    put('personal/todo/q.md', todoText({ assignee: 'ian-hancock', project: 'personal/jev' }));
    put('personal/todo/r.md', todoText({ assignee: 'someone-else', project: 'acme/site' }));
  });

  it('counts open TDS to-dos and this person’s personal ones, never done ones', async () => {
    const list = await service().list(ME);
    expect(byKey(list.projects, 'acme/site')?.openTodos).toBe(5);
    expect(byKey(list.projects, `${INTERNAL_CLIENT}/client-portal`)?.openTodos).toBe(1);
    expect(byKey(list.projects, 'personal/jev')?.openTodos).toBe(1);
  });

  it('takes open and 30-day-done assignees, minus owner and team, by completed_at else completed', async () => {
    const list = await service().list(ME);
    expect(byKey(list.projects, 'acme/site')?.teamFromTodos).toEqual([
      { person: 'simon-jones', openTodos: 2, lastActive: '2026-11-10' },
      { person: 'lee-plain', openTodos: 0, lastActive: '2026-11-19' },
      { person: 'jo-done', openTodos: 0, lastActive: '2026-11-15' },
    ]);
    expect(byKey(list.projects, `${INTERNAL_CLIENT}/client-portal`)?.teamFromTodos).toEqual([
      { person: 'pete-tyler', openTodos: 1, lastActive: '2026-11-01' },
    ]);
  });

  it('never counts a personal to-do for the team, and gives personal projects none', async () => {
    const list = await service().list(ME);
    const people = byKey(list.projects, 'acme/site')?.teamFromTodos.map((t) => t.person);
    expect(people).not.toContain('ian-hancock');
    expect(people).not.toContain('someone-else');
    expect(byKey(list.projects, 'personal/jev')?.teamFromTodos).toEqual([]);
  });

  it('reports canChange from the script capabilities', async () => {
    const s = service();
    expect((await s.list(ME)).canChange).toBe(true);
    fakes.caps = [];
    expect((await s.list(ME)).canChange).toBe(false);
  });

  it("reports canChange false when the skill's roles leave this person out (review fix 4)", async () => {
    let allowed = false;
    const s = service({ mayChange: async () => allowed });
    expect((await s.list(ME)).canChange).toBe(false);
    allowed = true;
    expect((await s.list(ME)).canChange).toBe(true);
  });

  // UX B2: every open to-do in the project, whoever has it, and this person's own personal ones.
  it("lists a project's open to-dos, every assignee's, with count equal to openTodos", async () => {
    put(
      'todo/b.md',
      todoText({ assignee: 'simon-jones', project: 'acme/site', due: '2026-11-25', stage: 'Build' }),
    );
    put('todo/o.md', todoText({ project: 'acme/site' }));
    const item = (key: string) => ({ key }) as TodoItem;
    const s = service({
      todoList: async () => ({
        mine: [item('d.md'), item('personal/p.md'), item('personal/q.md')],
        open: [item('o.md')],
      }),
    });
    const list = await s.list(ME);
    const res = await s.projectTodos('acme/site', ME);
    expect(res.count).toBe(byKey(list.projects, 'acme/site')?.openTodos);
    expect(res.count).toBe(res.todos.length);
    expect(res.todos.map((t) => [t.key, t.mine])).toEqual([
      ['b.md', false],
      ['a.md', false],
      ['c.md', false],
      ['d.md', true],
      ['o.md', true],
      ['personal/p.md', true],
    ]);
    expect(res.todos[0]).toEqual({
      key: 'b.md',
      id: 'b.md',
      scope: 'tds',
      title: 'To-do',
      assignee: 'simon-jones',
      due: '2026-11-25',
      stage: 'Build',
      mine: false,
    });
    // Never someone else's personal to-do, never a done one.
    expect(res.todos.map((t) => t.key)).not.toContain('personal/r.md');
    expect(res.todos.map((t) => t.key)).not.toContain('f.md');
    const jev = await s.projectTodos('personal/jev', ME);
    expect(jev).toEqual({ todos: [expect.objectContaining({ key: 'personal/q.md', mine: true })], count: 1 });
    expect(jev.count).toBe(byKey(list.projects, 'personal/jev')?.openTodos);
    await expect(s.projectTodos('acme/nothing', ME)).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('change', () => {
  beforeEach(() => {
    put('clients/acme/projects/site/project.md', card('Site'));
    folder('projects-archive/old');
  });

  it('runs the script, then answers a fresh list', async () => {
    const s = service();
    await s.list(ME);
    const action: ProjectAction = {
      kind: 'edit',
      key: 'acme/site',
      fields: { title: 'New' },
      expect: sha('clients/acme/projects/site/project.md'),
    };
    put('clients/acme/projects/site/project.md', card('New'));
    const list = await s.change(action, ME);
    expect(fakes.skillRuns).toEqual([action]);
    expect(byKey(list.projects, 'acme/site')?.title).toBe('New');
  });

  it('refuses archived projects, a personal file on a shared project, and a script without projects-v1', async () => {
    const s = service();
    const codeOf = async (action: ProjectAction) => {
      try {
        await s.change(action, ME);
        return null;
      } catch (err) {
        expect(err).toBeInstanceOf(ProjectsError);
        return (err as ProjectsError).code;
      }
    };
    expect(await codeOf({ kind: 'card', key: `${INTERNAL_CLIENT}/old`, fields: {} })).toBe('not-allowed');
    expect(
      await codeOf({ kind: 'link', key: 'acme/site', path: 'personal/files/x.pdf', expect: 'a'.repeat(64) }),
    ).toBe('not-allowed');
    expect(await codeOf({ kind: 'capabilities' })).toBe('bad-request');
    fakes.caps = [];
    expect(await codeOf({ kind: 'card', key: 'acme/site', fields: {} })).toBe('not-allowed');
    expect(fakes.skillRuns).toEqual([]);
  });

  it("refuses not-allowed when the tdsapp-projects skill's roles leave this person out (review fix 4)", async () => {
    const s = service({ mayChange: async () => false });
    await expect(s.change({ kind: 'card', key: 'acme/site', fields: {} }, ME)).rejects.toMatchObject({
      code: 'not-allowed',
      message: "Changing projects isn't available to you in the app yet.",
    });
    expect(fakes.skillRuns).toEqual([]);
  });
});

describe('tidy', () => {
  beforeEach(() => {
    folder('projects/client-portal');
    put('todo/a.md', todoText({ assignee: 'simon-jones', project: 'harvey-nash' }));
    put('todo/b.md', todoText({ assignee: 'ben-mcadam', project: 'harvey-nash', client: 'harvey-nash' }));
    put('todo/c.md', todoText({ assignee: 'ben-mcadam', project: 'client-portal' }));
    put('todo/d.md', todoText({ assignee: 'ben-mcadam', project: 'ad-manager-cortex' }));
    put('todo/done/z.md', todoText({ assignee: 'ben-mcadam', project: 'never-in-a-row' }));
    put('todo/e.md', todoText({ assignee: 'ben-mcadam', project: 'acme/new-thing' }));
  });

  it('lists the waiting labels from open to-dos, a teammate’s included, never done or missing ones', async () => {
    const s = service();
    const tidy = await s.tidy(ME);
    expect(tidy.rows.map((r) => r.label)).toEqual(['harvey-nash', 'ad-manager-cortex', 'client-portal']);
    expect(tidy.rows[0]?.todos.map((t) => t.id).sort()).toEqual(['a.md', 'b.md']);
    expect(tidy.rows[0]?.todos[0]?.version).toBe(sha('todo/a.md'));
    expect((await s.list(ME)).looseLabels).toBe(3);
  });

  it('keeps skips in the data folder, out of the rows and the count', async () => {
    const s = service();
    const after = await s.applyTidy({ label: 'client-portal', do: 'skip' }, ME);
    expect(after.skipped).toEqual(['client-portal']);
    expect(after.rows.map((r) => r.label)).not.toContain('client-portal');
    expect(JSON.parse(readFileSync(join(data, 'tidy-skips.json'), 'utf8'))).toMatchObject({
      labels: ['client-portal'],
    });
    expect((await service().list(ME)).looseLabels).toBe(2);
    expect((await s.applyTidy({ label: 'client-portal', do: 'unskip' }, ME)).skipped).toEqual([]);
  });

  it('approves a link through the to-do script, one project action per to-do with its own expect', async () => {
    const s = service();
    const version = sha('todo/c.md');
    const after = await s.applyTidy(
      {
        label: 'client-portal',
        do: 'approve',
        suggestion: { do: 'link', key: `${INTERNAL_CLIENT}/client-portal`, why: 'same-slug' },
      },
      ME,
    );
    expect(fakes.todoRuns).toEqual([
      {
        kind: 'project',
        id: 'c.md',
        scope: 'tds',
        client: INTERNAL_CLIENT,
        project: `${INTERNAL_CLIENT}/client-portal`,
        stage: null,
        expect: version,
      },
    ]);
    expect(after.rows.map((r) => r.label)).not.toContain('client-portal');
  });

  it('re-reads after a partial failure, so only what is left shows', async () => {
    const s = service();
    fakes.todoFail['b.md'] = 'changed';
    const after = await s.applyTidy(
      {
        label: 'harvey-nash',
        do: 'approve',
        suggestion: { do: 'client-only', client: 'harvey-nash', why: 'is-a-client' },
      },
      ME,
    );
    expect(fakes.todoRuns.map((r) => ('id' in r ? r.id : '')).sort()).toEqual(['a.md', 'b.md']);
    expect(after.rows.find((r) => r.label === 'harvey-nash')?.todos.map((t) => t.id)).toEqual(['b.md']);
  });

  it("refuses a new project when the projects skill's roles don't allow this person, writing nothing", async () => {
    const s = service({ mayChange: async () => false });
    const suggestion = {
      do: 'new-project',
      client: INTERNAL_CLIENT,
      slug: 'x-new',
      why: 'no-match',
    } as const;
    await expect(
      s.applyTidy({ label: 'ad-manager-cortex', do: 'approve', suggestion }, ME),
    ).rejects.toMatchObject({
      code: 'not-allowed',
    });
    expect(fakes.skillRuns).toEqual([]);
    expect(fakes.todoRuns).toEqual([]);
  });

  it('creates a new project then links, and an exists becomes a link', async () => {
    const s = service();
    const suggestion = {
      do: 'new-project',
      client: INTERNAL_CLIENT,
      slug: 'ad-manager-cortex',
      why: 'no-match',
    } as const;
    await s.applyTidy({ label: 'ad-manager-cortex', do: 'approve', suggestion }, ME);
    expect(fakes.skillRuns).toEqual([
      {
        kind: 'create',
        space: 'client',
        client: INTERNAL_CLIENT,
        slug: 'ad-manager-cortex',
        fields: { title: 'Ad manager cortex' },
      },
    ]);
    expect(fakes.todoRuns).toMatchObject([
      { kind: 'project', id: 'd.md', project: `${INTERNAL_CLIENT}/ad-manager-cortex` },
    ]);

    put('todo/f.md', todoText({ assignee: 'ben-mcadam', project: 'os' }));
    const again = service();
    fakes.createExists = true;
    folder(`clients/${INTERNAL_CLIENT}/projects/os-two`);
    await again.applyTidy(
      {
        label: 'os',
        do: 'approve',
        suggestion: { do: 'new-project', client: INTERNAL_CLIENT, slug: 'os-two', why: 'no-match' },
      },
      ME,
    );
    expect(fakes.todoRuns).toMatchObject([
      { kind: 'project', id: 'f.md', project: `${INTERNAL_CLIENT}/os-two` },
    ]);
  });

  it('refuses a changed suggestion that would put a TDS to-do in a personal project', async () => {
    folder('personal/projects/jev');
    const s = service();
    await expect(
      s.applyTidy(
        {
          label: 'client-portal',
          do: 'approve',
          suggestion: { do: 'link', key: 'personal/jev', why: 'same-slug' },
        },
        ME,
      ),
    ).rejects.toMatchObject({ code: 'not-allowed' });
    expect(fakes.todoRuns).toEqual([]);
  });

  it('only takes this person’s own personal to-dos', async () => {
    put('personal/todo/m.md', todoText({ assignee: 'ian-hancock', project: 'notes-app' }));
    put('personal/todo/n.md', todoText({ assignee: 'someone-else', project: 'other-app' }));
    const labels = (await service().tidy(ME)).rows.map((r) => r.label);
    expect(labels).toContain('notes-app');
    expect(labels).not.toContain('other-app');
  });

  it('never touches a personal to-do that shares a file name with a TDS conflict (review fix 3)', async () => {
    // x.md (TDS) carries the label but names another client: a conflict. The personal x.md is a
    // different to-do with a different label; it must stay exactly as it is.
    put('todo/x.md', todoText({ assignee: 'ben-mcadam', project: 'harvey-nash', client: 'acme' }));
    put('personal/todo/x.md', todoText({ assignee: 'ian-hancock', project: 'my-notes' }));
    const personal = readFileSync(abs('personal/todo/x.md'), 'utf8');
    const tds = readFileSync(abs('todo/x.md'), 'utf8');
    const s = service();
    const row = (await s.tidy(ME)).rows.find((r) => r.label === 'harvey-nash');
    expect(row?.conflicts).toEqual([{ id: 'x.md', scope: 'tds', title: 'To-do', client: 'acme' }]);
    await s.applyTidy(
      {
        label: 'harvey-nash',
        do: 'approve',
        suggestion: { do: 'client-only', client: 'harvey-nash', why: 'is-a-client' },
      },
      ME,
    );
    expect(fakes.todoRuns.map((r) => ('id' in r ? `${r.scope}:${r.id}` : ''))).toEqual([
      'tds:a.md',
      'tds:b.md',
    ]);
    expect(readFileSync(abs('personal/todo/x.md'), 'utf8')).toBe(personal);
    expect(readFileSync(abs('todo/x.md'), 'utf8')).toBe(tds);
  });

  it('keeps skips in memory without a data folder', async () => {
    const s = service({ dataDir: null });
    expect((await s.applyTidy({ label: 'os', do: 'skip' }, ME)).skipped).toEqual(['os']);
  });
});

// Move plan (docs/plans/2026-11-21-project-move.md).
describe('moved projects', () => {
  beforeEach(() => {
    put(
      'clients/skyseal/projects/jev/project.md',
      card(
        'Jev',
        'client: skyseal\nmoved_from:\n  - "personal/jev"\n  - "Not A Key"\n  - "acme/jev"\n  - "skyseal/jev"\n',
      ),
    );
    // Left behind on a teammate's Mac: ignored files only, no card (B1).
    put('clients/acme/projects/jev/.DS_Store', 'x');
    // A live carded folder at an old key wins over the alias.
    put('clients/acme/projects/live/project.md', card('Live here'));
    put('clients/harvey-nash/projects/live/project.md', card('Moved', 'moved_from:\n  - "acme/live"\n'));
    put(
      'clients/acme/projects/other/project.md',
      card('Other').replace(
        'The brief.\n',
        'The brief.\n\n## Linked files\n\n- [b.pdf](../../../../clients/acme/projects/jev/b.pdf)\n- [c.pdf](../../../../clients/acme/files/c.pdf)\n',
      ),
    );
    put('todo/a.md', todoText({ project: 'acme/jev', client: 'acme' }));
    put('todo/done/b.md', todoText({ project: 'acme/jev', completed: '2026-11-19' }));
  });

  it('reads moved_from, resolves old keys to where the project went, and leaves leftovers out (B1)', async () => {
    const s = service();
    const list = await s.list(ME);
    expect(list.projects.map((p) => p.key)).not.toContain('acme/jev');
    expect(list.leftovers).toEqual(['clients/acme/projects/jev']);
    expect(byKey(list.projects, 'skyseal/jev')?.movedFrom).toEqual(['personal/jev', 'acme/jev']);
    expect(byKey(list.projects, 'skyseal/jev')?.openTodos).toBe(1);
    expect(byKey(list.projects, 'acme/live')).toMatchObject({ title: 'Live here' });
    expect(byKey(list.projects, 'acme/live')?.movedFrom).toBeUndefined();
    const index = await s.index();
    expect(index.byKey('acme/jev')?.key).toBe('skyseal/jev');
    expect(index.byKey('personal/jev')?.key).toBe('skyseal/jev');
    expect(index.byKey('acme/live')?.key).toBe('acme/live');
    expect(index.byKey('acme/none')).toBeNull();
    expect(index.resolve('acme/jev', 'acme', 'tds')).toEqual({ how: 'key', key: 'skyseal/jev' });
    expect(index.resolve('personal/jev', null, 'tds')).toEqual({ how: 'missing', key: 'personal/jev' });
    expect(index.resolve('personal/jev', null, 'personal')).toEqual({ how: 'key', key: 'skyseal/jev' });
    expect((await s.projectTodos('acme/jev', ME)).count).toBe(1);
  });

  it("never treats this Mac's own personal folder as a leftover of a teammate's personal/ alias", async () => {
    // skyseal/jev (synced from a teammate) lists personal/jev: on THIS Mac, personal/ is this person's own.
    put('personal/projects/jev/notes.md', 'mine');
    put('personal/todo/mine.md', todoText({ assignee: 'ian-hancock', project: 'personal/jev' }));
    put(
      'personal/projects/diary/project.md',
      card('Diary').replace(
        'The brief.\n',
        'The brief.\n\n## Linked files\n\n- [notes.md](../../../personal/projects/jev/notes.md)\n',
      ),
    );
    const s = service();
    const list = await s.list(ME);
    expect(list.leftovers).toEqual(['clients/acme/projects/jev']);
    expect(byKey(list.projects, 'personal/jev')).toMatchObject({ card: 'none', openTodos: 1 });
    expect(byKey(list.projects, 'skyseal/jev')?.openTodos).toBe(1);
    expect(byKey(list.projects, 'personal/diary')?.links).toEqual(['personal/projects/jev/notes.md']);
    const index = await s.index();
    expect(index.byKey('personal/jev')?.key).toBe('personal/jev');
    expect(index.resolve('personal/jev', null, 'personal')).toEqual({ how: 'key', key: 'personal/jev' });
    expect((await s.projectTodos('personal/jev', ME)).count).toBe(1);
    // A shared old key's leftover is still a leftover.
    expect(index.byKey('acme/jev')?.key).toBe('skyseal/jev');
  });

  it("maps other cards' links into an old folder to the new one (S8)", async () => {
    const s = service();
    const other = byKey((await s.list(ME)).projects, 'acme/other');
    expect(other?.links).toEqual(['clients/skyseal/projects/jev/b.pdf', 'clients/acme/files/c.pdf']);
    expect((await s.index()).keysForPath('clients/skyseal/projects/jev/b.pdf')).toEqual([
      'acme/other',
      'skyseal/jev',
    ]);
  });

  it('reports canMove only with both scripts able and this person allowed', async () => {
    let allowed = true;
    const s = service({ mayChange: async () => allowed });
    expect((await s.list(ME)).canMove).toBe(false);
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_MOVE_CAPABILITY];
    expect((await s.list(ME)).canMove).toBe(true);
    fakes.todoCaps = [];
    expect((await s.list(ME)).canMove).toBe(false);
    fakes.todoCaps = ['todo-project-v1'];
    allowed = false;
    expect((await s.list(ME)).canMove).toBe(false);
  });
});

describe('move', () => {
  const V = 'c'.repeat(64);
  beforeEach(() => {
    put('personal/projects/jev/project.md', card('Jev', 'stages:\n  - "Build"\n'));
    put('clients/acme/projects/site/project.md', card('Site'));
    put('clients/_archive/acme/projects/old/project.md', card('Old'));
    put('clients/harvey-nash/projects/moved/project.md', card('Moved', 'moved_from:\n  - "acme/moved"\n'));
    folder('clients/acme/projects/moved-x');
    put('personal/todo/p.md', todoText({ assignee: 'ian-hancock', project: 'personal/jev', stage: 'Build' }));
    put('personal/todo/q.md', todoText({ project: 'jev' }));
    put('personal/todo/r.md', todoText({ assignee: 'someone-else', project: 'personal/jev' }));
    put('personal/todo/s.md', todoText({ assignee: 'ian-hancock', project: 'acme/site' }));
    put(
      'todo/t.md',
      todoText({ assignee: 'simon-jones', project: 'acme/site', client: 'acme', stage: 'Build' }),
    );
    put('todo/u.md', todoText({ assignee: 'simon-jones', project: 'site', client: 'acme' }));
    put('todo/done/v.md', todoText({ assignee: 'simon-jones', project: 'acme/site' }));
  });
  const moving = () => {
    const s = service();
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_MOVE_CAPABILITY];
    return s;
  };
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectsError);
      return (err as ProjectsError).code;
    }
  };

  it('checks first, counting the open to-dos it would move and writing nothing', async () => {
    const s = moving();
    const r = (await s.move(
      { key: 'personal/jev', client: 'skyseal', expect: V, check: true },
      ME,
    )) as ProjectMoveCheckResponse;
    expect(r).toEqual({
      check: {
        key: 'skyseal/jev',
        files: [],
        fileCount: 0,
        ignoredCount: 0,
        personalLinks: [],
        filesVersion: 'f'.repeat(64),
      },
      todos: 2,
    });
    expect(fakes.skillRuns).toEqual([
      { kind: 'move', key: 'personal/jev', client: 'skyseal', expect: V, check: true },
    ]);
    expect(fakes.todoRuns).toEqual([]);
    expect(fakes.moved).toEqual([]);
    const tds = (await s.move(
      { key: 'acme/site', client: 'skyseal', expect: V, check: true },
      ME,
    )) as ProjectMoveCheckResponse;
    expect(tds.todos).toBe(3);
    // Without the to-dos (the Settings switch): none counted.
    const off = (await s.move({ key: 'acme/site', client: 'skyseal', expect: V, check: true }, ME, {
      todos: false,
    })) as ProjectMoveCheckResponse;
    expect(off.todos).toBe(0);
  });

  it('moves, then re-points only the open to-dos chosen before the move, keeping their stage', async () => {
    const s = moving();
    const before = { t: sha('todo/t.md'), u: sha('todo/u.md'), s: sha('personal/todo/s.md') };
    const r = (await s.move({ key: 'acme/site', client: 'skyseal', expect: V }, ME)) as ProjectMoveResult;
    expect(fakes.skillRuns).toEqual([{ kind: 'move', key: 'acme/site', client: 'skyseal', expect: V }]);
    expect(fakes.moved).toEqual([['clients/acme/projects/site', 'clients/skyseal/projects/site']]);
    const runs = fakes.todoRuns.map((a) => a as Extract<TodoRunAction, { kind: 'project' }>);
    expect(runs.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      {
        kind: 'project',
        id: 's.md',
        scope: 'personal',
        client: 'skyseal',
        project: 'skyseal/site',
        stage: null,
        expect: before.s,
      },
      {
        kind: 'project',
        id: 't.md',
        scope: 'tds',
        client: 'skyseal',
        project: 'skyseal/site',
        stage: 'Build',
        expect: before.t,
      },
      {
        kind: 'project',
        id: 'u.md',
        scope: 'tds',
        client: 'skyseal',
        project: 'skyseal/site',
        stage: null,
        expect: before.u,
      },
    ]);
    expect(r.key).toBe('skyseal/site');
    expect(r.todosMoved).toBe(3);
    expect(r.todosLeft).toBe(0);
    expect(byKey(r.list.projects, 'skyseal/site')).toMatchObject({ movedFrom: ['acme/site'], openTodos: 3 });
    expect(byKey(r.list.projects, 'acme/site')).toBeUndefined();
    // The done one is never rewritten.
    expect(readFileSync(abs('todo/done/v.md'), 'utf8')).toContain('project: acme/site');
  });

  it("passes the check's file fingerprint on to the script, and refuses a malformed one", async () => {
    const s = moving();
    const F = 'f'.repeat(64);
    await s.move({ key: 'acme/site', client: 'skyseal', expect: V, filesExpect: F }, ME);
    expect(fakes.skillRuns).toEqual([
      { kind: 'move', key: 'acme/site', client: 'skyseal', expect: V, filesExpect: F },
    ]);
    fakes.skillRuns.length = 0;
    for (const bad of ['short', F.toUpperCase(), 5]) {
      const req = { key: 'skyseal/site', client: 'acme', expect: V, filesExpect: bad as string };
      expect(await codeOf(s.move(req, ME)), String(bad)).toBe('bad-request');
    }
    expect(fakes.skillRuns).toEqual([]);
  });

  it('moves a personal project, its own personal to-dos and none of anyone else’s', async () => {
    const s = moving();
    const r = (await s.move(
      { key: 'personal/jev', client: 'skyseal', expect: V, dropPersonal: true },
      ME,
    )) as ProjectMoveResult;
    expect(fakes.skillRuns).toEqual([
      { kind: 'move', key: 'personal/jev', client: 'skyseal', expect: V, dropPersonal: true },
    ]);
    expect(fakes.moved).toEqual([['personal/projects/jev', 'clients/skyseal/projects/jev']]);
    expect(fakes.todoRuns.map((a) => ('id' in a ? a.id : '')).sort()).toEqual(['p.md', 'q.md']);
    expect(r).toMatchObject({ key: 'skyseal/jev', todosMoved: 2, todosLeft: 0 });
  });

  it('counts a to-do it could not re-point as left, and still answers the move', async () => {
    const s = moving();
    fakes.todoFail = { 't.md': 'changed', 'u.md': 'crash' };
    const r = (await s.move({ key: 'acme/site', client: 'skyseal', expect: V }, ME)) as ProjectMoveResult;
    expect(r).toMatchObject({ key: 'skyseal/site', todosMoved: 1, todosLeft: 2 });
    // Those left still resolve to the project through its old key.
    expect(byKey(r.list.projects, 'skyseal/site')?.openTodos).toBe(3);
  });

  it('re-points nothing when told not to change to-dos', async () => {
    const s = moving();
    const r = (await s.move({ key: 'acme/site', client: 'skyseal', expect: V }, ME, {
      todos: false,
    })) as ProjectMoveResult;
    expect(fakes.todoRuns).toEqual([]);
    expect(r).toMatchObject({ todosMoved: 0, todosLeft: 0 });
  });

  it('refuses without both scripts, this person, an archived project, a taken old key or a bad shape', async () => {
    const s = moving();
    const req = { key: 'acme/site', client: 'skyseal', expect: V };
    fakes.caps = [PROJECTS_CAPABILITY];
    expect(await codeOf(s.move(req, ME))).toBe('not-allowed');
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_MOVE_CAPABILITY];
    fakes.todoCaps = [];
    expect(await codeOf(s.move(req, ME))).toBe('not-allowed');
    fakes.todoCaps = ['todo-project-v1'];
    expect(await codeOf(s.move({ ...req, key: 'acme/old' }, ME))).toBe('not-allowed');
    // acme/moved answers for harvey-nash/moved, so nothing else may take it.
    put('clients/skyseal/projects/moved/project.md', card('Another'));
    expect(await codeOf(s.move({ key: 'skyseal/moved', client: 'acme', expect: V }, ME))).toBe('exists');
    // ...but the project that moved may go back.
    expect(
      await codeOf(s.move({ key: 'harvey-nash/moved', client: 'acme', expect: V, check: true }, ME)),
    ).toBeNull();
    for (const bad of [
      { ...req, client: 'personal' },
      { ...req, client: 'Sky Seal' },
      { ...req, key: 'nope' },
      { key: 'acme/site', client: 'skyseal' },
    ]) {
      expect(await codeOf(s.move(bad as never, ME)), JSON.stringify(bad)).toBe('bad-request');
    }
    expect(fakes.skillRuns.filter((a) => !('check' in a))).toEqual([]);
    const denied = service({ mayChange: async () => false });
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_MOVE_CAPABILITY];
    expect(await codeOf(denied.move(req, ME))).toBe('not-allowed');
    expect(fakes.skillRuns).toEqual([]);
  });

  it("passes the script's refusal on and re-points nothing", async () => {
    const s = moving();
    fakes.moveFail = 'changed';
    expect(await codeOf(s.move({ key: 'acme/site', client: 'skyseal', expect: V }, ME))).toBe('changed');
    expect(fakes.todoRuns).toEqual([]);
    expect(fakes.moved).toEqual([]);
  });
});

describe('archive locations in the walk', () => {
  const twinCheck = async () => (await service().list(ME)).duplicates;
  // git check-ignore, as if `.DS_Store` were the only ignored name: answers the ignored paths it was given.
  const ignoreDsStore = () => {
    fakes.gitAnswer = (args) =>
      args[0] === 'check-ignore'
        ? args
            .slice(args.indexOf('--') + 1)
            .filter((p) => p.endsWith('/.DS_Store'))
            .map((p) => `${p}\0`)
            .join('')
        : '';
  };

  it('reads clients/<c>/projects-archive, personal/projects-archive and the TDS archive, explicitly archived', async () => {
    put('clients/acme/projects-archive/site/project.md', card('Site'));
    put(`clients/${INTERNAL_CLIENT}/projects-archive/portal/project.md`, card('Portal'));
    put('personal/projects-archive/jev/project.md', card('Jev'));
    const { cards } = await service().index();
    expect(cards.map((c) => [c.key, c.space, c.archived, c.status, c.folder])).toEqual([
      [
        `${INTERNAL_CLIENT}/portal`,
        'client',
        true,
        'done',
        `clients/${INTERNAL_CLIENT}/projects-archive/portal`,
      ],
      ['acme/site', 'client', true, 'done', 'clients/acme/projects-archive/site'],
      ['personal/jev', 'personal', true, 'done', 'personal/projects-archive/jev'],
    ]);
  });

  it('never reads a personal archive that git tracks, or one behind a link', async () => {
    put('personal/projects-archive/mine/project.md', card('Mine'));
    put('personal/projects-archive/synced/project.md', card('Synced'));
    const s = service();
    fakes.gitAnswer = (args) =>
      args[0] === 'ls-files' && args.includes('personal/projects-archive')
        ? 'personal/projects-archive/synced/project.md\0'
        : '';
    expect((await s.index()).cards.map((c) => c.key)).toEqual(['personal/mine']);
  });

  it('puts a twin under the same key in duplicates, the live folder winning', async () => {
    put('clients/acme/projects/site/project.md', card('Live'));
    put('clients/acme/projects-archive/site/project.md', card('Archived'));
    put('projects-archive/old/project.md', card('Old legacy'));
    put('clients/_archive/acme/projects/site/project.md', card('Gone client'));
    const list = await service().list(ME);
    expect(byKey(list.projects, 'acme/site')).toMatchObject({ title: 'Live', archived: false });
    expect(list.duplicates.sort()).toEqual([
      'clients/_archive/acme/projects/site',
      'clients/acme/projects-archive/site',
    ]);
    expect(list.leftovers).toEqual([]);
    expect(await twinCheck()).toHaveLength(2);
  });

  it('makes a card-less live folder with a carded archive twin a leftover, the archive winning (B1)', async () => {
    folder('clients/acme/projects/site');
    put('clients/acme/projects-archive/site/project.md', card('Archived site'));
    folder('personal/projects/jev');
    put('personal/projects-archive/jev/project.md', card('Jev'));
    const list = await service().list(ME);
    expect(byKey(list.projects, 'acme/site')).toMatchObject({ archived: true, title: 'Archived site' });
    expect(byKey(list.projects, 'personal/jev')?.archived).toBe(true);
    expect([...(list.leftovers ?? [])].sort()).toEqual([
      'clients/acme/projects/site',
      'personal/projects/jev',
    ]);
    expect(list.duplicates).toEqual([]);
  });

  it('makes a card-less live folder holding only git-ignored files a leftover (B1)', async () => {
    put('clients/acme/projects/ghost/.DS_Store', 'x');
    put('clients/acme/projects/real/notes.txt', 'x');
    put('clients/acme/projects/carded/project.md', card('Carded'));
    const s = service();
    ignoreDsStore();
    const list = await s.list(ME);
    expect(list.leftovers).toEqual(['clients/acme/projects/ghost']);
    expect(list.projects.map((p) => p.key).sort()).toEqual(['acme/carded', 'acme/real']);
  });

  // The script's `locate` is the source of truth: a leftover never wins, so the key reads the next folder.
  it('skips a card-less live folder holding only git-ignored files, so the next folder is the project', async () => {
    put(`clients/${INTERNAL_CLIENT}/projects/portal/.DS_Store`, 'x');
    put('projects/portal/project.md', card('Legacy portal'));
    const s = service();
    ignoreDsStore();
    const list = await s.list(ME);
    expect(byKey(list.projects, `${INTERNAL_CLIENT}/portal`)).toMatchObject({
      folder: 'projects/portal',
      title: 'Legacy portal',
      archived: false,
    });
    expect(list.leftovers).toEqual([`clients/${INTERNAL_CLIENT}/projects/portal`]);
    expect(list.duplicates).not.toContain('projects/portal');
    expect(list.duplicates).toEqual([]);
  });

  it('applies the ignored-files rule to archive folders too', async () => {
    put('clients/acme/projects-archive/site/.DS_Store', 'x');
    put('clients/_archive/acme/projects/site/project.md', card('Gone client site'));
    put('projects-archive/lone/.DS_Store', 'x');
    const s = service();
    ignoreDsStore();
    const list = await s.list(ME);
    expect(byKey(list.projects, 'acme/site')).toMatchObject({
      folder: 'clients/_archive/acme/projects/site',
      archived: true,
    });
    expect(byKey(list.projects, `${INTERNAL_CLIENT}/lone`)).toBeUndefined();
    expect([...(list.leftovers ?? [])].sort()).toEqual([
      'clients/acme/projects-archive/site',
      'projects-archive/lone',
    ]);
    expect(list.duplicates).not.toContain('clients/_archive/acme/projects/site');
    expect(list.duplicates).toEqual([]);
  });

  it('reads a carded projects/<s> over its carded archive when the TDS live folder is a card-less leftover', async () => {
    folder(`clients/${INTERNAL_CLIENT}/projects/site`);
    put('projects/site/project.md', card('Legacy site'));
    put(`clients/${INTERNAL_CLIENT}/projects-archive/site/project.md`, card('Archived site'));
    const list = await service().list(ME);
    expect(byKey(list.projects, `${INTERNAL_CLIENT}/site`)).toMatchObject({
      folder: 'projects/site',
      title: 'Legacy site',
      archived: false,
    });
    expect(list.leftovers).toEqual([`clients/${INTERNAL_CLIENT}/projects/site`]);
    expect(list.duplicates).not.toContain('projects/site');
    expect(list.duplicates).toEqual([`clients/${INTERNAL_CLIENT}/projects-archive/site`]);
  });

  it("maps links into an archived project's old live folder to its archive folder", async () => {
    put(
      'clients/acme/projects-archive/site/project.md',
      card('Site').replace(
        'The brief.',
        'The brief.\n\n## Linked files\n\n- [notes.md](../../../../clients/acme/projects/site/notes.md)\n',
      ),
    );
    const { cards } = await service().index();
    expect(cards[0]?.links).toEqual(['clients/acme/projects-archive/site/notes.md']);
  });

  it('sets canArchive from the script capability and the roles check', async () => {
    put('clients/acme/projects/site/project.md', card('Site'));
    const s = service();
    expect((await s.list(ME)).canArchive).toBe(false);
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_ARCHIVE_CAPABILITY];
    s.changed();
    expect((await s.list(ME)).canArchive).toBe(true);
    const denied = service({ mayChange: async () => false });
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_ARCHIVE_CAPABILITY];
    expect((await denied.list(ME)).canArchive).toBe(false);
  });
});

describe('archive, unarchive and delete', () => {
  const V = 'c'.repeat(64);
  const sha = (rel: string) =>
    createHash('sha256')
      .update(readFileSync(abs(rel)))
      .digest('hex');
  beforeEach(() => {
    put('clients/acme/projects/site/project.md', card('Site'));
    put('clients/acme/projects/site/notes.md', 'notes');
    put('clients/acme/projects-archive/old/project.md', card('Old', 'owner: ian-hancock\n'));
    put('personal/projects/jev/project.md', card('Jev'));
    put('todo/mine.md', todoText({ assignee: 'ian-hancock', project: 'acme/site', client: 'acme' }));
    put('todo/nobody.md', todoText({ project: 'acme/site', client: 'acme' }));
    put('todo/simon.md', todoText({ assignee: 'simon-jones', project: 'site', client: 'acme' }));
    put('todo/elsewhere.md', todoText({ assignee: 'ian-hancock', project: 'acme/other', client: 'acme' }));
    put('todo/done/finished.md', todoText({ assignee: 'simon-jones', project: 'acme/site' }));
    put('personal/todo/p.md', todoText({ assignee: 'ian-hancock', project: 'acme/site', client: 'acme' }));
    put('personal/todo/q.md', todoText({ assignee: 'someone-else', project: 'acme/site', client: 'acme' }));
  });
  const removing = () => {
    const s = service();
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_ARCHIVE_CAPABILITY];
    return s;
  };
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectsError);
      return (err as ProjectsError).code;
    }
  };

  it('checks first: the script answers, open linked to-dos are listed, done ones counted, nothing written', async () => {
    const s = removing();
    const r = (await s.remove(
      { key: 'acme/site', action: 'archive', check: true },
      ME,
    )) as ProjectRemoveCheckResponse;
    expect(r.check).toMatchObject({ key: 'acme/site', allowed: true, from: 'clients/acme/projects/site' });
    expect(r.doneTodos).toBe(1);
    expect(r.todos.map((t) => [t.id, t.scope, t.assignee, t.version]).sort()).toEqual([
      ['mine.md', 'tds', 'ian-hancock', sha('todo/mine.md')],
      ['nobody.md', 'tds', null, sha('todo/nobody.md')],
      ['p.md', 'personal', 'ian-hancock', sha('personal/todo/p.md')],
      ['simon.md', 'tds', 'simon-jones', sha('todo/simon.md')],
    ]);
    expect(r.todos.find((t) => t.id === 'mine.md')?.title).toBe('To-do');
    expect(fakes.skillRuns).toEqual([{ kind: 'archive', key: 'acme/site', check: true }]);
    expect(fakes.todoRuns).toEqual([]);
    expect(fakes.moved).toEqual([]);
  });

  it('relays allowed and allowedWho from the script, adding no rule of its own', async () => {
    const s = service({ mayChange: async () => true });
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_ARCHIVE_CAPABILITY];
    const r = (await s.remove(
      { key: 'acme/old', action: 'delete', check: true },
      { ...ME, role: 'scout' },
    )) as ProjectRemoveCheckResponse;
    // The fake script says yes whoever asks: the server passes it on unchanged.
    expect(r.check.allowed).toBe(true);
  });

  it('archives the folder first, then applies each choice: done ticks, keep does nothing', async () => {
    const s = removing();
    const r = (await s.remove(
      {
        key: 'acme/site',
        action: 'archive',
        expect: V,
        todos: [
          { id: 'mine.md', scope: 'tds', version: sha('todo/mine.md'), do: 'done' },
          { id: 'simon.md', scope: 'tds', version: sha('todo/simon.md'), do: 'keep' },
          { id: 'p.md', scope: 'personal', version: sha('personal/todo/p.md'), do: 'done' },
        ],
      },
      ME,
    )) as ProjectRemoveResult;
    expect(fakes.skillRuns).toEqual([{ kind: 'archive', key: 'acme/site', expect: V }]);
    expect(existsSync(abs('clients/acme/projects-archive/site/project.md'))).toBe(true);
    expect(fakes.moved).toEqual([['clients/acme/projects/site', 'clients/acme/projects-archive/site']]);
    expect(fakes.todoRuns).toEqual([
      { kind: 'tick', id: 'mine.md', scope: 'tds', expect: sha('todo/mine.md') },
      { kind: 'tick', id: 'p.md', scope: 'personal', expect: sha('personal/todo/p.md') },
    ]);
    expect(r).toMatchObject({ key: 'acme/site', todosChanged: 2, todosFailed: [] });
    expect(byKey(r.list.projects, 'acme/site')?.archived).toBe(true);
  });

  it('unarchives with no to-dos', async () => {
    const s = removing();
    await s.remove({ key: 'acme/old', action: 'unarchive' }, ME);
    expect(existsSync(abs('clients/acme/projects/old/project.md'))).toBe(true);
    expect(fakes.moved).toEqual([['clients/acme/projects-archive/old', 'clients/acme/projects/old']]);
    const r = (await s.remove(
      { key: 'acme/old', action: 'unarchive', check: true },
      ME,
    )) as ProjectRemoveCheckResponse;
    expect(r.todos).toEqual([]);
    expect(
      await codeOf(
        s.remove(
          {
            key: 'acme/old',
            action: 'unarchive',
            todos: [{ id: 'mine.md', scope: 'tds', version: V, do: 'done' }],
          },
          ME,
        ),
      ),
    ).toBe('bad-request');
  });

  it('deletes the folder, then deletes or unlinks each chosen to-do (client kept)', async () => {
    const s = removing();
    const before = { mine: sha('todo/mine.md'), simon: sha('todo/simon.md') };
    const r = (await s.remove(
      {
        key: 'acme/site',
        action: 'delete',
        filesExpect: V,
        todos: [
          { id: 'mine.md', scope: 'tds', version: before.mine, do: 'delete' },
          { id: 'simon.md', scope: 'tds', version: before.simon, do: 'unlink' },
        ],
      },
      ME,
    )) as ProjectRemoveResult;
    expect(existsSync(abs('clients/acme/projects/site'))).toBe(false);
    expect(fakes.skillRuns).toEqual([{ kind: 'delete', key: 'acme/site', filesExpect: V }]);
    expect(fakes.todoRuns).toEqual([
      { kind: 'delete', id: 'mine.md', scope: 'tds', expect: before.mine },
      {
        kind: 'project',
        id: 'simon.md',
        scope: 'tds',
        client: 'acme',
        project: null,
        stage: null,
        expect: before.simon,
      },
    ]);
    expect(r).toMatchObject({ todosChanged: 2, todosFailed: [] });
    expect(byKey(r.list.projects, 'acme/site')).toBeUndefined();
  });

  it('rejects a choice that does not fit the action before touching the folder', async () => {
    const s = removing();
    const mine = { id: 'mine.md', scope: 'tds' as const, version: sha('todo/mine.md') };
    for (const [action, todos] of [
      ['archive', [{ ...mine, do: 'delete' }]],
      ['archive', [{ ...mine, do: 'unlink' }]],
      ['delete', [{ ...mine, do: 'done' }]],
      ['delete', [{ ...mine, do: 'keep' }]],
      [
        'archive',
        [
          { ...mine, do: 'done' },
          { ...mine, do: 'keep' },
        ],
      ],
    ] as const) {
      expect(
        await codeOf(s.remove({ key: 'acme/site', action, todos: [...todos] } as never, ME)),
        `${action} ${JSON.stringify(todos)}`,
      ).toBe('bad-request');
    }
    expect(await codeOf(s.remove({ key: 'acme/site', action: 'move' } as never, ME))).toBe('bad-request');
    expect(await codeOf(s.remove({ key: 'nope', action: 'archive' } as never, ME))).toBe('bad-request');
    expect(fakes.skillRuns.filter((a) => !('check' in a))).toEqual([]);
    expect(existsSync(abs('clients/acme/projects/site/project.md'))).toBe(true);
  });

  it('drops a choice for a to-do no longer open and linked, counting it neither way', async () => {
    const s = removing();
    // A teammate ticked simon.md between the check and the confirm; the others were never listed.
    rmSync(abs('todo/simon.md'));
    put('todo/done/simon.md', todoText({ assignee: 'simon-jones', project: 'acme/site', client: 'acme' }));
    const r = (await s.remove(
      {
        key: 'acme/site',
        action: 'archive',
        todos: [
          { id: 'mine.md', scope: 'tds', version: sha('todo/mine.md'), do: 'done' },
          { id: 'simon.md', scope: 'tds', version: V, do: 'done' },
          { id: 'elsewhere.md', scope: 'tds', version: V, do: 'done' },
          { id: 'q.md', scope: 'personal', version: V, do: 'done' },
          { id: 'finished.md', scope: 'tds', version: V, do: 'done' },
        ],
      },
      ME,
    )) as ProjectRemoveResult;
    expect(existsSync(abs('clients/acme/projects-archive/site'))).toBe(true);
    expect(fakes.todoRuns).toEqual([
      { kind: 'tick', id: 'mine.md', scope: 'tds', expect: sha('todo/mine.md') },
    ]);
    expect(r).toMatchObject({ key: 'acme/site', todosChanged: 1, todosFailed: [] });
    expect(r).not.toHaveProperty('leftBehind');
  });

  it('applies the to-do choices and answers leftBehind when the deleted folder was only partly removed', async () => {
    const s = removing();
    fakes.leftBehind = 'clients/acme/projects/.tdsapp-projects-site-0123456789ab.deleting~';
    const r = (await s.remove(
      {
        key: 'acme/site',
        action: 'delete',
        filesExpect: V,
        todos: [{ id: 'mine.md', scope: 'tds', version: sha('todo/mine.md'), do: 'delete' }],
      },
      ME,
    )) as ProjectRemoveResult;
    expect(fakes.todoRuns).toEqual([
      { kind: 'delete', id: 'mine.md', scope: 'tds', expect: expect.any(String) },
    ]);
    expect(r).toMatchObject({
      key: 'acme/site',
      todosChanged: 1,
      todosFailed: [],
      leftBehind: 'clients/acme/projects/.tdsapp-projects-site-0123456789ab.deleting~',
    });
    expect(byKey(r.list.projects, 'acme/site')).toBeUndefined();
  });

  it('refuses unlink choices without the to-do project capability, before touching the folder', async () => {
    const s = removing();
    fakes.todoCaps = [];
    const unlink = {
      id: 'simon.md',
      scope: 'tds' as const,
      version: sha('todo/simon.md'),
      do: 'unlink' as const,
    };
    const err = await s
      .remove({ key: 'acme/site', action: 'delete', filesExpect: V, todos: [unlink] }, ME)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(ProjectsError);
    expect(err).toMatchObject({
      code: 'not-allowed',
      message: "Update the brain's skills to unlink to-dos.",
    });
    expect(fakes.skillRuns).toEqual([]);
    expect(fakes.todoRuns).toEqual([]);
    expect(existsSync(abs('clients/acme/projects/site/project.md'))).toBe(true);
    // Deleting a to-do needs no such capability.
    const r = (await s.remove(
      {
        key: 'acme/site',
        action: 'delete',
        filesExpect: V,
        todos: [{ ...unlink, do: 'delete' }],
      },
      ME,
    )) as ProjectRemoveResult;
    expect(r).toMatchObject({ todosChanged: 1, todosFailed: [] });
  });

  it('collects to-dos that fail as ids and still answers (the folder change happened)', async () => {
    const s = removing();
    const r = await (async () => {
      fakes.todoFail = { 'mine.md': 'changed', 'nobody.md': 'crash' };
      return (await s.remove(
        {
          key: 'acme/site',
          action: 'archive',
          todos: ['mine.md', 'nobody.md', 'simon.md'].map((id) => ({
            id,
            scope: 'tds' as const,
            version: sha(`todo/${id}`),
            do: 'done' as const,
          })),
        },
        ME,
      )) as ProjectRemoveResult;
    })();
    expect(r.todosChanged).toBe(1);
    expect(r.todosFailed.sort()).toEqual(['mine.md', 'nobody.md']);
    expect(existsSync(abs('clients/acme/projects-archive/site'))).toBe(true);
  });

  it('refuses to-do changes up front when the app may not change to-dos, but still allows keep', async () => {
    const s = removing();
    const todos = [
      { id: 'mine.md', scope: 'tds' as const, version: sha('todo/mine.md'), do: 'done' as const },
    ];
    expect(await codeOf(s.remove({ key: 'acme/site', action: 'archive', todos }, ME, { todos: false }))).toBe(
      'not-allowed',
    );
    expect(fakes.skillRuns).toEqual([]);
    fakes.todoCaps = [];
    expect(
      await codeOf(
        s.remove(
          {
            key: 'acme/site',
            action: 'delete',
            todos: [{ ...(todos[0] as (typeof todos)[0]), do: 'unlink' as const }],
          },
          ME,
        ),
      ),
    ).toBe('not-allowed');
    await s.remove(
      {
        key: 'acme/site',
        action: 'archive',
        todos: [{ ...(todos[0] as (typeof todos)[0]), do: 'keep' as const }],
      },
      ME,
      { todos: false },
    );
    expect(fakes.skillRuns).toHaveLength(1);
  });

  it("passes the script's refusal on and changes no to-do", async () => {
    const s = removing();
    for (const code of ['not-allowed', 'changed', 'exists'] as const) {
      fakes.removeFail = code;
      expect(
        await codeOf(
          s.remove(
            {
              key: 'acme/site',
              action: 'delete',
              todos: [{ id: 'mine.md', scope: 'tds', version: sha('todo/mine.md'), do: 'delete' }],
            },
            ME,
          ),
        ),
      ).toBe(code);
    }
    expect(fakes.todoRuns).toEqual([]);
    expect(fakes.moved).toEqual([]);
  });

  it('needs the script capability and the roles check', async () => {
    const s = service();
    expect(await codeOf(s.remove({ key: 'acme/site', action: 'archive', check: true }, ME))).toBe(
      'not-allowed',
    );
    const denied = service({ mayChange: async () => false });
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_ARCHIVE_CAPABILITY];
    expect(await codeOf(denied.remove({ key: 'acme/site', action: 'archive', check: true }, ME))).toBe(
      'not-allowed',
    );
    expect(fakes.skillRuns).toEqual([]);
  });
});
