import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientInfo, Identity, TodoItem } from '../../shared/contract.ts';
import { TodoChangeError } from '../../shared/contract.ts';
import {
  INTERNAL_CLIENT,
  PROJECTS_CAPABILITY,
  type ProjectAction,
  type ProjectCard,
  ProjectsError,
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
  /** Per to-do id: fail its tidy write with this code. */
  todoFail: Record<string, 'changed' | 'not-found'>;
  createExists: boolean;
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
      return { key: 'key' in action ? action.key : '', version: 'v'.repeat(64) };
    },
    capabilities: async () => fakes.caps,
  };
  // Stands in for the to-do script: really writes the project lines, so re-reads see them.
  const todoSkill: TodoSkillRunner = {
    async run(action) {
      fakes.todoRuns.push(action);
      if (action.kind !== 'project') return { file: null };
      const fail = fakes.todoFail[action.id];
      if (fail) throw new TodoChangeError(fail, 'no');
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
    capabilities: async () => ['todo-project-v1'],
  };
  return createProjects(root, {
    skill,
    todoSkill,
    clients: async () => CLIENTS,
    dataDir: extra.dataDir === undefined ? data : extra.dataDir,
    ...(extra.mayChange ? { mayChange: extra.mayChange } : {}),
    ...(extra.todoList ? { todoList: extra.todoList } : {}),
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
