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
import { PROJECTS_CHAT_SUMMARY_CAPABILITY } from '../../shared/chat-summary-contract.ts';
import type { ClientInfo, Identity, TodoItem } from '../../shared/contract.ts';
import { TodoChangeError } from '../../shared/contract.ts';
import { PROJECTS_REFS_CAPABILITY } from '../../shared/project-refs-contract.ts';
import { PROJECTS_VISIBILITY_CAPABILITY } from '../../shared/project-visibility.ts';
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
import { PROJECTS_CHANGE_MESSAGES, type ProjectsSkillRunner } from './projects-skill.ts';
import { createAskedLog } from './todo-asked.ts';
import { listDoneTodos } from './todo-done.ts';
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
    .join('\n')}\n---\n\n# Task\n`;

const CLIENTS: ClientInfo[] = ['acme', 'harvey-nash', INTERNAL_CLIENT].map((slug) => ({
  slug,
  name: slug,
  ...(slug === 'acme' ? { code: 'ACM' } : {}),
}));

interface Fakes {
  skillRuns: ProjectAction[];
  todoRuns: TodoRunAction[];
  caps: string[];
  gitCalls: string[][];
  /** Answers per git call; default: no output. */
  gitAnswer: (args: string[]) => string;
  /** Per task id: fail its tidy write with this code ('crash': a plain Error). */
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
    doneTodos?: ProjectsOptions['doneTodos'];
    viewer?: ProjectsOptions['viewer'];
    members?: ProjectsOptions['members'];
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
  // Stands in for the task script: really writes the project lines, so re-reads see them.
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
    ...(extra.doneTodos ? { doneTodos: extra.doneTodos } : {}),
    ...(extra.viewer ? { viewer: extra.viewer } : {}),
    ...(extra.members ? { members: extra.members } : {}),
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

  it("lists an old checklist's open ## Active items, as the Workbench shows them (brain compat 10)", async () => {
    put('projects/client-portal/README.md', '# Client Portal\n');
    put(
      'projects/client-portal/todo.md',
      [
        '# Client Portal — todo',
        '- [ ] above any heading',
        '## Active',
        '- [ ] Ship the login page',
        '- [x] Ticked already',
        '  - [ ]   Indented item  ',
        `- [ ] ${'x'.repeat(250)}`,
        '## Backlog',
        '- [ ] Later',
      ].join('\n'),
    );
    put('clients/acme/projects/website/project.md', card('Website rebuild', ''));
    const index = await service().index();
    const portal = index.byKey(`${INTERNAL_CLIENT}/client-portal`) as ProjectCard;
    expect(portal.checklistOpen).toEqual(['Ship the login page', 'Indented item', 'x'.repeat(200)]);
    expect(index.byKey('acme/website')).not.toHaveProperty('checklistOpen');
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

  it('resolves task labels, never a TDS task to a personal project', async () => {
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

describe('counts and the team from tasks', () => {
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

  it('counts open TDS tasks and this person’s personal ones, never done ones', async () => {
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

  it('never counts a personal task for the team, and gives personal projects none', async () => {
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

  // UX B2: every open task in the project, whoever has it, and this person's own personal ones.
  it("lists a project's open tasks, every assignee's, with count equal to openTodos", async () => {
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
      title: 'Task',
      assignee: 'simon-jones',
      due: '2026-11-25',
      stage: 'Build',
      mine: false,
    });
    // Never someone else's personal task, never a done one.
    expect(res.todos.map((t) => t.key)).not.toContain('personal/r.md');
    expect(res.todos.map((t) => t.key)).not.toContain('f.md');
    const jev = await s.projectTodos('personal/jev', ME);
    expect(jev).toEqual({ todos: [expect.objectContaining({ key: 'personal/q.md', mine: true })], count: 1 });
    expect(jev.count).toBe(byKey(list.projects, 'personal/jev')?.openTodos);
    await expect(s.projectTodos('acme/nothing', ME)).rejects.toMatchObject({ code: 'not-found' });
  });

  // Done-todos plan, decision 7: finished tasks fold under the open ones.
  it("lists a project's finished tasks newest first, personal ones only for their owner", async () => {
    put(
      'todo/done/dn-old.md',
      todoText({
        project: 'acme/site',
        completed_by: 'ian-hancock',
        completed_at: '2026-11-05T10:00:00+00:00',
      }),
    );
    put(
      'todo/done/dn-new.md',
      todoText({
        project: 'acme/site',
        stage: 'Build',
        assignee: 'simon-jones',
        completed_by: 'simon-jones',
        completed_at: '2026-11-18T10:00:00+00:00',
      }),
    );
    put('todo/done/dn-nodate.md', todoText({ project: 'acme/site' }));
    put(
      'todo/done/dn-other.md',
      todoText({
        project: 'client-portal',
        completed_by: 'ian-hancock',
        completed_at: '2026-11-19T10:00:00+00:00',
      }),
    );
    put(
      'personal/todo/done/dn-mine.md',
      todoText({
        project: 'personal/jev',
        assignee: 'ian-hancock',
        completed_by: 'ian-hancock',
        completed_at: '2026-11-17T10:00:00+00:00',
      }),
    );
    put(
      'personal/todo/done/dn-theirs.md',
      todoText({
        project: 'personal/jev',
        assignee: 'someone-else',
        completed_by: 'someone-else',
        completed_at: '2026-11-17T10:00:00+00:00',
      }),
    );
    const log = createAskedLog(async (args) => ({
      stdout: args[0] === 'rev-parse' ? `${'b'.repeat(40)}\n` : '',
      cut: false,
    }));
    const self: { s?: ReturnType<typeof service> } = {};
    self.s = service({
      doneTodos: (identity) =>
        listDoneTodos(root, identity, {
          log,
          projects: () => (self.s as ReturnType<typeof service>).index(),
        }),
    });
    const site = await self.s.projectTodos('acme/site', ME);
    expect(site.doneCount).toBe(site.done?.length);
    expect(site.done?.filter((d) => d.id.startsWith('dn-')).map((d) => [d.id, d.doneDate])).toEqual([
      ['dn-new.md', '2026-11-18'],
      ['dn-old.md', '2026-11-05'],
      ['dn-nodate.md', null],
    ]);
    expect(site.done?.find((d) => d.id === 'dn-new.md')).toEqual({
      key: 'done:todo/done/dn-new.md',
      id: 'dn-new.md',
      scope: 'tds',
      title: 'Task',
      assignee: 'simon-jones',
      stage: 'Build',
      doneDate: '2026-11-18',
      doneBy: 'Simon Jones',
    });
    const jev = await self.s.projectTodos('personal/jev', ME);
    expect(jev.done?.map((d) => d.key)).toEqual(['done:personal/todo/done/dn-mine.md']);
  });

  it('omits done when the reader is missing or fails (older behaviour)', async () => {
    expect(await service().projectTodos('acme/site', ME)).not.toHaveProperty('done');
    const s = service({
      doneTodos: async () => {
        throw new Error('boom');
      },
    });
    const res = await s.projectTodos('acme/site', ME);
    expect(res).not.toHaveProperty('done');
    expect(res.count).toBe(res.todos.length);
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

  it('lists the waiting labels from open tasks, a teammate’s included, never done or missing ones', async () => {
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

  it('approves a link through the task script, one project action per task with its own expect', async () => {
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

  it('refuses a changed suggestion that would put a TDS task in a personal project', async () => {
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

  it('only takes this person’s own personal tasks', async () => {
    put('personal/todo/m.md', todoText({ assignee: 'ian-hancock', project: 'notes-app' }));
    put('personal/todo/n.md', todoText({ assignee: 'someone-else', project: 'other-app' }));
    const labels = (await service().tidy(ME)).rows.map((r) => r.label);
    expect(labels).toContain('notes-app');
    expect(labels).not.toContain('other-app');
  });

  it('never touches a personal task that shares a file name with a TDS conflict (review fix 3)', async () => {
    // x.md (TDS) carries the label but names another client: a conflict. The personal x.md is a
    // different task with a different label; it must stay exactly as it is.
    put('todo/x.md', todoText({ assignee: 'ben-mcadam', project: 'harvey-nash', client: 'acme' }));
    put('personal/todo/x.md', todoText({ assignee: 'ian-hancock', project: 'my-notes' }));
    const personal = readFileSync(abs('personal/todo/x.md'), 'utf8');
    const tds = readFileSync(abs('todo/x.md'), 'utf8');
    const s = service();
    const row = (await s.tidy(ME)).rows.find((r) => r.label === 'harvey-nash');
    expect(row?.conflicts).toEqual([{ id: 'x.md', scope: 'tds', title: 'Task', client: 'acme' }]);
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

  it('checks first, counting the open tasks it would move and writing nothing', async () => {
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
    // Without the tasks (the Settings switch): none counted.
    const off = (await s.move({ key: 'acme/site', client: 'skyseal', expect: V, check: true }, ME, {
      todos: false,
    })) as ProjectMoveCheckResponse;
    expect(off.todos).toBe(0);
  });

  it('moves, then re-points only the open tasks chosen before the move, keeping their stage', async () => {
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

  it('moves a personal project, its own personal tasks and none of anyone else’s', async () => {
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

  it('counts a task it could not re-point as left, and still answers the move', async () => {
    const s = moving();
    fakes.todoFail = { 't.md': 'changed', 'u.md': 'crash' };
    const r = (await s.move({ key: 'acme/site', client: 'skyseal', expect: V }, ME)) as ProjectMoveResult;
    expect(r).toMatchObject({ key: 'skyseal/site', todosMoved: 1, todosLeft: 2 });
    // Those left still resolve to the project through its old key.
    expect(byKey(r.list.projects, 'skyseal/site')?.openTodos).toBe(3);
  });

  it('re-points nothing when told not to change tasks', async () => {
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

describe('project codes', () => {
  const V = 'c'.repeat(64);
  it('reads ref: onto each card with its state, and resolves through the index', async () => {
    put('clients/acme/projects/a/project.md', card('A', 'ref: acm4k7\n'));
    put('clients/acme/projects/b/project.md', card('B'));
    put('clients/harvey-nash/projects/c/project.md', card('C'));
    put('clients/acme/projects/d/project.md', card('D', 'ref: nonsense\n'));
    folder('personal/projects/p');
    put('personal/projects/p/project.md', card('P', 'ref: ACM5M2\n'));
    const s = service();
    const { projects } = await s.list(ME);
    const state = (k: string) => byKey(projects, k)?.refState;
    expect(byKey(projects, 'acme/a')).toMatchObject({ ref: 'ACM4K7', refState: 'ok' });
    expect(state('acme/b')).toBe('missing');
    expect(state('harvey-nash/c')).toBe('no-client-code');
    expect(byKey(projects, 'acme/d')).toMatchObject({ ref: null, refState: 'missing' });
    expect(state('personal/p')).toBe('personal');
    const idx = await s.index();
    expect(idx.refs?.resolve('ACM4K7')).toBe('acme/a');
    expect(idx.refs?.resolve('ACM5M2')).toBeNull();
  });

  it('marks the same ref on two cards as duplicate, and resolves neither', async () => {
    put('clients/acme/projects/a/project.md', card('A', 'ref: ACM4K7\n'));
    put('clients/harvey-nash/projects/b/project.md', card('B', 'ref: ACM4K7\n'));
    const s = service();
    const { projects } = await s.list(ME);
    expect(byKey(projects, 'acme/a')).toMatchObject({
      refState: 'duplicate',
      refDuplicateOf: ['harvey-nash/b'],
    });
    expect((await s.index()).refs?.resolve('ACM4K7')).toBeNull();
  });

  it('sets canRef from the capability and roles, and canRefAll for an owner or a scout', async () => {
    put('clients/acme/projects/a/project.md', card('A'));
    const s = service();
    expect((await s.list(ME)).canRef).toBe(false);
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_REFS_CAPABILITY];
    s.changed();
    expect(await s.list(ME)).toMatchObject({ canRef: true, canRefAll: true });
    expect(await s.list({ ...ME, role: 'team' })).toMatchObject({ canRef: true, canRefAll: false });
    expect(await s.list({ ...ME, role: 'scout' })).toMatchObject({ canRef: true, canRefAll: true });
    const denied = service({ mayChange: async () => false });
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_REFS_CAPABILITY];
    expect(await denied.list(ME)).toMatchObject({ canRef: false, canRefAll: false });
  });

  it('sets canSaveChat from the capability and roles', async () => {
    put('clients/acme/projects/a/project.md', card('A'));
    const s = service();
    expect((await s.list(ME)).canSaveChat).toBe(false);
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_CHAT_SUMMARY_CAPABILITY];
    s.changed();
    expect((await s.list(ME)).canSaveChat).toBe(true);
    const denied = service({ mayChange: async () => false });
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_CHAT_SUMMARY_CAPABILITY];
    expect((await denied.list(ME)).canSaveChat).toBe(false);
  });

  it('runs a ref change through the script, and refuses all for a team member or without the capability', async () => {
    put('clients/acme/projects/a/project.md', card('A'));
    const s = service();
    await expect(s.change({ kind: 'ref', key: 'acme/a', expect: V }, ME)).rejects.toMatchObject({
      code: 'not-allowed',
    });
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_REFS_CAPABILITY];
    await expect(s.change({ kind: 'ref', all: true }, { ...ME, role: 'team' })).rejects.toMatchObject({
      code: 'not-allowed',
    });
    expect(fakes.skillRuns).toEqual([]);
    await s.change({ kind: 'ref', key: 'acme/a', expect: V }, ME);
    await s.change({ kind: 'ref', all: true }, ME);
    expect(fakes.skillRuns).toEqual([
      { kind: 'ref', key: 'acme/a', expect: V },
      { kind: 'ref', all: true },
    ]);
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

  it('checks first: the script answers, open linked tasks are listed, done ones counted, nothing written', async () => {
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
    expect(r.todos.find((t) => t.id === 'mine.md')?.title).toBe('Task');
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

  it('unarchives with no tasks', async () => {
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

  it('deletes the folder, then deletes or unlinks each chosen task (client kept)', async () => {
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

  it('drops a choice for a task no longer open and linked, counting it neither way', async () => {
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

  it('applies the task choices and answers leftBehind when the deleted folder was only partly removed', async () => {
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

  it('refuses unlink choices without the task project capability, before touching the folder', async () => {
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
      message: "Update the brain's skills to unlink tasks.",
    });
    expect(fakes.skillRuns).toEqual([]);
    expect(fakes.todoRuns).toEqual([]);
    expect(existsSync(abs('clients/acme/projects/site/project.md'))).toBe(true);
    // Deleting a task needs no such capability.
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

  it('collects tasks that fail as ids and still answers (the folder change happened)', async () => {
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

  it('refuses task changes up front when the app may not change tasks, but still allows keep', async () => {
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

  it("passes the script's refusal on and changes no task", async () => {
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

describe('restricted projects (plan 2026-11-27)', () => {
  const person = (name: string, slug: string, role: Identity['role'], knownMember = true): Identity => ({
    name,
    slug,
    email: null,
    role,
    knownMember,
  });
  const OUTSIDER = person('Carol Team', 'carol-team', 'team');
  const ON_TEAM = person('Bob Team', 'bob-team', 'team');
  const ACCOUNT_OWNER = person('Alice Owner', 'alice-owner', 'team');
  const SCOUT = person('Sam Scout', 'sam-scout', 'scout');
  const MEMBERS = [
    { name: 'Ian Hancock', slug: 'ian-hancock', role: 'owner' },
    { name: "Dan O'Brien", slug: 'dan-obrien', role: 'head-scout' },
    { name: 'Carol Team', slug: 'carol-team', role: 'team' },
    { name: 'Bob Team', slug: 'bob-team', role: 'team' },
    { name: 'Sam Scout', slug: 'sam-scout', role: 'scout' },
  ];
  const SECRET = 'clients/acme/projects/secret';
  const restricted = (extra = '') =>
    card(
      'Secret pitch',
      `owner: alice-owner\nteam:\n  - "bob-team"\nvisibility: restricted\nmoved_from:\n  - "harvey-nash/secret-old"\n${extra}`,
    );

  /** One hidden project with a duplicate, a leftover at its old key, and an open look-alike beside it. */
  function brain() {
    put(`${SECRET}/project.md`, restricted('ref: ACM4K7\n'));
    put(`${SECRET}/plan.md`, 'the plan');
    // A second card for the same key in the archive: shadowed by the live one, so a duplicate.
    put('clients/acme/projects-archive/secret/project.md', card('Old secret'));
    // The folder it moved from, left on this Mac with only a file and no card: a leftover.
    put('clients/harvey-nash/projects/secret-old/notes.md', 'old notes');
    put('clients/acme/projects/secret-2/project.md', card('Secret two', 'ref: ACM5M3\n'));
    put(
      'clients/acme/projects/website/project.md',
      `${card('Website')}\n## Linked files\n\n- [plan](${SECRET}/plan.md)\n- [audit](clients/acme/reports/audit.md)\n`,
    );
  }
  const as = (viewer: Identity | null, extra: Parameters<typeof service>[0] = {}) =>
    service({
      viewer: viewer === null ? undefined : async () => viewer,
      members: async () => MEMBERS,
      ...extra,
    });

  it('reads visibility onto every card, failing closed on odd lines (decisions 1 and 4)', async () => {
    put('clients/acme/projects/open/project.md', card('Open'));
    put('clients/acme/projects/marked/project.md', card('Marked', 'visibility: restricted\n'));
    put('clients/acme/projects/everyone/project.md', card('Everyone', 'visibility: Everyone\n'));
    put('clients/acme/projects/capital/project.md', card('Capital', 'Visibility: restricted\n'));
    put(
      'clients/acme/projects/doubled/project.md',
      card('Doubled', 'visibility: restricted\nvisibility: everyone\n'),
    );
    put('clients/acme/projects/typo/project.md', card('Typo', 'visibility: secret\n'));
    put(
      'clients/acme/projects/broken/project.md',
      '---\n<<<<<<< HEAD\nvisibility: restricted\n=======\nteam:\n  - "carol-team"\n>>>>>>> x\n---\n',
    );
    put('personal/projects/mine/project.md', card('Mine', 'visibility: restricted\n'));
    const { cards } = await as(SCOUT).index();
    expect(Object.fromEntries(cards.map((c) => [c.key, c.visibility]))).toEqual({
      'acme/open': 'everyone',
      'acme/marked': 'restricted',
      'acme/everyone': 'everyone',
      'acme/capital': 'restricted',
      'acme/doubled': 'restricted',
      'acme/typo': 'restricted',
      'acme/broken': 'restricted',
      'personal/mine': 'everyone',
    });
    expect(byKey(cards, 'acme/broken')).toMatchObject({ card: 'unreadable', owner: null, team: [] });
    const seen = (await as(ON_TEAM).index()).cards.map((c) => c.key);
    expect(seen).toEqual(['acme/everyone', 'acme/open', 'personal/mine']);
  });

  it('a hidden project is nowhere in the index an outsider gets', async () => {
    brain();
    const index = await as(OUTSIDER).index();
    expect(index.cards.map((c) => c.key)).toEqual(['acme/secret-2', 'acme/website']);
    expect(index.byKey('acme/secret')).toBeNull();
    expect(index.byKey('harvey-nash/secret-old')).toBeNull();
    expect(index.keysForPath(`${SECRET}/plan.md`)).toEqual([]);
    expect(index.refs?.resolve('ACM4K7')).toBeNull();
    expect(index.refs?.resolve('ACM5M3')).toBe('acme/secret-2');
    expect(index.refs?.near('ACM4K8')).toEqual([]);
    expect(index.hiddenCount).toBe(1);
    // A visible card's links into the hidden folder are stripped; the rest stay.
    expect(index.byKey('acme/website')?.links).toEqual(['clients/acme/reports/audit.md']);
  });

  it('resolve answers restricted for a hidden label, never loose, client or missing', async () => {
    brain();
    put('clients/harvey-nash/projects/secret/project.md', card('Their secret'));
    const index = await as(OUTSIDER).index();
    const r = (v: string, client: string | null = null) => index.resolve(v, client, 'tds');
    expect(r('acme/secret')).toEqual({ how: 'restricted' });
    expect(r('secret', 'acme')).toEqual({ how: 'restricted' });
    expect(r('harvey-nash/secret-old')).toEqual({ how: 'restricted' });
    // Two projects share the slug and one is hidden: still no tidy-up row for the outsider.
    expect(r('secret')).toEqual({ how: 'restricted' });
    expect(r('secret', 'harvey-nash')).toEqual({ how: 'legacy', key: 'harvey-nash/secret' });
    expect(r('acme/secret-2')).toEqual({ how: 'key', key: 'acme/secret-2' });
    // The same labels read the same for someone who can see it (resolved from every card first).
    const scout = await as(SCOUT).index();
    expect(scout.resolve('acme/secret', null, 'tds')).toEqual({ how: 'key', key: 'acme/secret' });
    expect(scout.resolve('secret', null, 'tds')).toEqual({ how: 'loose', label: 'secret' });
  });

  it('hiddenPath covers the live, archived, duplicate, leftover and moved-from folders only', async () => {
    brain();
    const index = await as(OUTSIDER).index();
    const hidden = (p: string) => index.hiddenPath?.(p);
    expect(hidden(SECRET)).toBe(true);
    expect(hidden(`${SECRET}/`)).toBe(true);
    expect(hidden(`${SECRET}/plan.md`)).toBe(true);
    expect(hidden('clients/acme/projects/Secret/plan.md')).toBe(true);
    expect(hidden('clients/acme/projects-archive/secret/project.md')).toBe(true);
    expect(hidden('clients/harvey-nash/projects/secret-old/notes.md')).toBe(true);
    expect(hidden('clients/acme/projects/secret-2/project.md')).toBe(false);
    expect(hidden('clients/acme/projects/secretly/x.md')).toBe(false);
    expect(hidden('clients/acme/projects')).toBe(false);
    expect(hidden('clients/acme/reports/audit.md')).toBe(false);
    expect(index.hiddenKey?.('acme/secret')).toBe(true);
    expect(index.hiddenKey?.('harvey-nash/secret-old')).toBe(true);
    expect(index.hiddenKey?.('acme/secret-2')).toBe(false);
    expect(index.hiddenKey?.('acme/nothing')).toBe(false);
    const open = await as(SCOUT).index();
    expect(open.hiddenCount).toBe(0);
    expect(open.hiddenPath?.(`${SECRET}/plan.md`)).toBe(false);
    expect(open.hiddenKey?.('acme/secret')).toBe(false);
  });

  it('hides a restricted duplicate folder even when the card the key reads is open', async () => {
    put('clients/acme/projects/twin/project.md', card('Twin'));
    put('clients/acme/projects-archive/twin/project.md', card('Twin', 'visibility: restricted\n'));
    const index = await as(OUTSIDER).index();
    expect(index.byKey('acme/twin')?.folder).toBe('clients/acme/projects/twin');
    expect(index.hiddenPath?.('clients/acme/projects-archive/twin/a.md')).toBe(true);
    expect(index.hiddenPath?.('clients/acme/projects/twin/a.md')).toBe(false);
    expect(index.hiddenCount).toBe(1);
    expect((await as(OUTSIDER).list(OUTSIDER)).duplicates).toEqual([]);
  });

  it.each([
    ['the Account Owner', ACCOUNT_OWNER, true],
    ['a team member', ON_TEAM, true],
    ['an owner', ME, true],
    ['a scout', SCOUT, true],
    ['another team member', OUTSIDER, false],
    ['someone the roster does not know, even on the team', { ...ON_TEAM, knownMember: false }, false],
  ] as const)('%s sees it: %s', async (_who, viewer, sees) => {
    brain();
    const index = await as(viewer).index();
    expect(index.byKey('acme/secret') !== null).toBe(sees);
    expect(index.hiddenCount).toBe(sees ? 0 : 1);
  });

  it('a team member listed in either slug form sees it', async () => {
    const dan = person("Dan O'Brien", 'dan-obrien', 'team');
    put(
      'clients/acme/projects/a/project.md',
      card('A', 'team:\n  - "dan-o-brien"\nvisibility: restricted\n'),
    );
    put('clients/acme/projects/b/project.md', card('B', 'team:\n  - "dan-obrien"\nvisibility: restricted\n'));
    expect((await as(dan).index()).cards.map((c) => c.key)).toEqual(['acme/a', 'acme/b']);
  });

  it('no viewer, or one that fails, is an unknown viewer: no restricted project', async () => {
    brain();
    expect((await as(null).index()).byKey('acme/secret')).toBeNull();
    const failing = service({
      viewer: () => Promise.reject(new Error('no whoami')),
      members: async () => MEMBERS,
    });
    expect((await failing.index()).byKey('acme/secret')).toBeNull();
    // Old cards with no line behave exactly as before.
    expect((await failing.index()).byKey('acme/website')).not.toBeNull();
  });

  it('list leaves the hidden project out of projects, duplicates, leftovers, counts and the team', async () => {
    brain();
    put(
      'todo/20261120-a.md',
      todoText({ title: 'Pitch deck', project: 'acme/secret', assignee: 'zed-person' }),
    );
    put(
      'todo/20261120-b.md',
      todoText({ title: 'Old label', client: 'acme', project: 'secret', assignee: 'zed-person' }),
    );
    put(
      'todo/20261120-c.md',
      todoText({ title: 'Site copy', project: 'acme/website', assignee: 'carol-team' }),
    );
    const outsider = await as(OUTSIDER).list(OUTSIDER);
    expect(outsider.projects.map((p) => p.key)).toEqual(['acme/secret-2', 'acme/website']);
    expect(outsider.duplicates).toEqual([]);
    expect(outsider.leftovers).toEqual([]);
    expect(outsider.looseLabels).toBe(0);
    expect(JSON.stringify(outsider)).not.toContain('zed-person');
    expect(JSON.stringify(outsider)).not.toContain('secret-old');
    expect(byKey(outsider.projects, 'acme/website')?.openTodos).toBe(1);
    const scout = await as(SCOUT).list(SCOUT);
    expect(byKey(scout.projects, 'acme/secret')).toMatchObject({ openTodos: 2, visibility: 'restricted' });
    expect(scout.duplicates).toEqual(['clients/acme/projects-archive/secret']);
    expect(scout.leftovers).toEqual(['clients/harvey-nash/projects/secret-old']);
    // A legacy label of a project they can see is a tidy-up row as before.
    expect(scout.looseLabels).toBe(1);
  });

  it('change, move and remove on a hidden key are not found, before the script runs', async () => {
    brain();
    const s = as(OUTSIDER);
    fakes.caps = [
      PROJECTS_CAPABILITY,
      PROJECTS_MOVE_CAPABILITY,
      PROJECTS_ARCHIVE_CAPABILITY,
      PROJECTS_REFS_CAPABILITY,
    ];
    const notFound = {
      code: 'not-found',
      message: 'That project could not be found. It may have been moved, archived or not synced here yet.',
    };
    for (const key of ['acme/secret', 'harvey-nash/secret-old']) {
      await expect(
        s.change({ kind: 'card', key, fields: { title: 'Mine now' } }, OUTSIDER),
      ).rejects.toMatchObject(notFound);
      await expect(
        s.change(
          { kind: 'link', key, path: 'clients/acme/reports/audit.md', expect: 'v'.repeat(64) },
          OUTSIDER,
        ),
      ).rejects.toMatchObject(notFound);
      await expect(s.change({ kind: 'ref', key, expect: 'v'.repeat(64) }, OUTSIDER)).rejects.toMatchObject(
        notFound,
      );
      await expect(
        s.move({ key, client: 'harvey-nash', expect: 'v'.repeat(64) }, OUTSIDER),
      ).rejects.toMatchObject(notFound);
      await expect(
        s.move({ key, client: 'harvey-nash', expect: 'v'.repeat(64), check: true }, OUTSIDER),
      ).rejects.toMatchObject(notFound);
      for (const action of ['archive', 'unarchive', 'delete'] as const) {
        await expect(s.remove({ action, key }, OUTSIDER)).rejects.toMatchObject(notFound);
        await expect(s.remove({ action, key, check: true }, OUTSIDER)).rejects.toMatchObject(notFound);
      }
      await expect(s.projectTodos(key, OUTSIDER)).rejects.toMatchObject({ code: 'not-found' });
    }
    expect(fakes.skillRuns).toEqual([]);
    // Someone on the team still reaches the script.
    const team = as(ON_TEAM);
    await team.change({ kind: 'card', key: 'acme/secret', fields: { title: 'Ours' } }, ON_TEAM);
    expect(fakes.skillRuns).toHaveLength(1);
  });

  it('canRestrict needs the script feature and leave to change; seesAll lists owners and scouts', async () => {
    brain();
    const s = as(ON_TEAM);
    expect((await s.list(ON_TEAM)).canRestrict).toBe(false);
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_VISIBILITY_CAPABILITY];
    s.changed();
    const listed = await s.list(ON_TEAM);
    expect(listed.canRestrict).toBe(true);
    expect([...(listed.seesAll ?? [])].sort()).toEqual([
      'dan-o-brien',
      'dan-obrien',
      'ian-hancock',
      'sam-scout',
    ]);
    const refused = as(ON_TEAM, { mayChange: async () => false });
    fakes.caps = [PROJECTS_CAPABILITY, PROJECTS_VISIBILITY_CAPABILITY];
    expect((await refused.list(ON_TEAM)).canRestrict).toBe(false);
    // No roster reader: seesAll is left out, so the client blocks nobody (the server still does).
    const bare = service({ viewer: async () => ON_TEAM });
    expect(await bare.list(ON_TEAM)).not.toHaveProperty('seesAll');
  });

  it('assignCheck answers from every card, whoever is asking', async () => {
    brain();
    // The outsider can't see the project, yet gets the same answers as anyone.
    const s = as(OUTSIDER);
    const tds = (project: string | null, client: string | null = null) => ({
      project,
      client,
      scope: 'tds' as const,
    });
    expect(await s.assignCheck(tds('acme/secret'), null)).toEqual({ ok: true });
    expect(await s.assignCheck(tds(null), 'carol-team')).toEqual({ ok: true });
    expect(await s.assignCheck(tds('acme/website'), 'carol-team')).toEqual({ ok: true });
    expect(
      await s.assignCheck({ project: 'acme/secret', client: null, scope: 'personal' }, 'carol-team'),
    ).toEqual({ ok: true });
    expect(await s.assignCheck(tds('acme/secret'), 'bob-team')).toEqual({ ok: true });
    expect(await s.assignCheck(tds('acme/secret'), 'alice-owner')).toEqual({ ok: true });
    expect(await s.assignCheck(tds('acme/secret'), 'ian-hancock')).toEqual({ ok: true });
    expect(await s.assignCheck(tds('acme/secret'), 'dan-o-brien')).toEqual({ ok: true });
    expect(await s.assignCheck(tds('acme/secret'), 'carol-team')).toEqual({
      ok: false,
      why: 'outside',
      name: 'Carol Team',
    });
    expect(await s.assignCheck(tds('secret', 'acme'), 'carol-team')).toEqual({
      ok: false,
      why: 'outside',
      name: 'Carol Team',
    });
    expect(await s.assignCheck(tds('harvey-nash/secret-old'), 'carol-team')).toMatchObject({ ok: false });
    expect(await s.assignCheck(tds('acme/secret'), 'new-starter')).toEqual({
      ok: false,
      why: 'outside',
      name: 'new-starter',
    });
  });

  it('a code shared by a hidden and a visible project resolves the same for everyone', async () => {
    put(`${SECRET}/project.md`, restricted('ref: ACM4K7\n'));
    put('clients/acme/projects/website/project.md', card('Website', 'ref: ACM4K7\n'));
    const outsider = await as(OUTSIDER).index();
    const scout = await as(SCOUT).index();
    expect(outsider.refs?.resolve('ACM4K7')).toBeNull();
    expect(scout.refs?.resolve('ACM4K7')).toBeNull();
    const site = outsider.byKey('acme/website') as ProjectCard;
    expect(site.refState).toBe('duplicate');
    expect(site).not.toHaveProperty('refDuplicateOf');
    expect(scout.byKey('acme/website')?.refDuplicateOf).toEqual(['acme/secret']);
  });

  it('the tidy-up never offers a row for a hidden label, nor links into it', async () => {
    brain();
    put('todo/20261120-b.md', todoText({ title: 'Old label', client: 'acme', project: 'secret' }));
    const s = as(OUTSIDER);
    expect((await s.tidy(OUTSIDER)).rows).toEqual([]);
    await expect(
      s.applyTidy(
        { label: 'secret', do: 'approve', suggestion: { do: 'link', key: 'acme/secret', why: 'same-slug' } },
        OUTSIDER,
      ),
    ).resolves.toMatchObject({ rows: [] });
    expect(fakes.todoRuns).toEqual([]);
  });

  it('the tidy-up never moves a task into a restricted project when its assignee is outside it', async () => {
    brain();
    put(
      'todo/20261120-out.md',
      todoText({ title: 'Outsider task', client: 'acme', project: 'secret', assignee: 'carol-team' }),
    );
    put(
      'todo/20261120-in.md',
      todoText({ title: 'Team task', client: 'acme', project: 'secret', assignee: 'bob-team' }),
    );
    const s = as(ON_TEAM);
    expect((await s.tidy(ON_TEAM)).rows.map((r) => r.label)).toEqual(['secret']);
    const after = await s.applyTidy(
      { label: 'secret', do: 'approve', suggestion: { do: 'link', key: 'acme/secret', why: 'same-slug' } },
      ON_TEAM,
    );
    // Only the task whose assignee is on the project went through the task script.
    expect(fakes.todoRuns).toMatchObject([{ kind: 'project', id: '20261120-in.md', project: 'acme/secret' }]);
    expect(fakes.todoRuns).toHaveLength(1);
    // The other stays where it was, so the row is still there to sort out.
    expect(after.rows.find((r) => r.label === 'secret')?.todos.map((t) => t.id)).toContain('20261120-out.md');
  });

  it('a new project the tidy-up names over a hidden key is refused as "exists", writing nothing', async () => {
    brain();
    put('todo/20261120-x.md', todoText({ title: 'Old label', project: 'pitch-stuff' }));
    const s = as(OUTSIDER);
    for (const [client, slug] of [
      ['acme', 'secret'],
      ['harvey-nash', 'secret-old'],
    ] as const) {
      await expect(
        s.applyTidy(
          {
            label: 'pitch-stuff',
            do: 'approve',
            suggestion: { do: 'new-project', client, slug, why: 'no-match' },
          },
          OUTSIDER,
        ),
      ).rejects.toMatchObject({ code: 'exists', message: PROJECTS_CHANGE_MESSAGES.exists });
    }
    expect(fakes.skillRuns).toEqual([]);
    expect(fakes.todoRuns).toEqual([]);
  });

  it('linking a path in a hidden folder to an open project is answered as a missing file', async () => {
    brain();
    put(
      `${SECRET}/project.md`,
      `${restricted()}\n## Linked files\n\n- [deck](clients/acme/files/deck.pdf)\n`,
    );
    put('clients/acme/files/deck.pdf', 'pdf');
    const s = as(OUTSIDER);
    const expect64 = sha('clients/acme/projects/website/project.md');
    // The script refuses a missing path with "there is no file at <path>", which the runner shows as a
    // sentence; a hidden one gets those very words, before the script runs.
    for (const path of [
      `${SECRET}/plan.md`,
      `${SECRET}/nothing-here.md`,
      'clients/acme/projects/Secret/plan.md',
      'clients/harvey-nash/projects/secret-old/notes.md',
      'clients/acme/files/deck.pdf',
    ]) {
      await expect(
        s.change({ kind: 'link', key: 'acme/website', path, expect: expect64 }, OUTSIDER),
      ).rejects.toMatchObject({ code: 'bad-request', message: `There is no file at ${path}.` });
    }
    expect(fakes.skillRuns).toEqual([]);
    // Someone on the project, and any open path, still reach the script.
    await as(ON_TEAM).change(
      { kind: 'link', key: 'acme/website', path: `${SECRET}/plan.md`, expect: expect64 },
      ON_TEAM,
    );
    await s.change(
      { kind: 'link', key: 'acme/website', path: 'clients/acme/reports/audit.md', expect: expect64 },
      OUTSIDER,
    );
    expect(fakes.skillRuns.map((a) => ('path' in a ? a.path : ''))).toEqual([
      `${SECRET}/plan.md`,
      'clients/acme/reports/audit.md',
    ]);
  });

  it("leaves the script's earlier link refusals first, so a hidden folder answers as any other does", async () => {
    brain();
    put(`${SECRET}/project.md`, restricted());
    const s = as(OUTSIDER);
    const expect64 = sha('clients/acme/projects/website/project.md');
    // The script refuses a bad path shape, a never-listed path and a file type the library doesn't list
    // before it looks for the file. Answering "no file" first for a hidden folder would tell the two apart.
    const early = [
      `${SECRET}/a.exe`,
      `${SECRET}/../x.md`,
      `${SECRET}/.git/config.md`,
      `${SECRET}/${'a'.repeat(1100)}.md`,
    ];
    for (const path of early) {
      await s.change({ kind: 'link', key: 'acme/website', path, expect: expect64 }, OUTSIDER);
    }
    expect(fakes.skillRuns.map((a) => ('path' in a ? a.path : ''))).toEqual(early);
  });

  it('hides a client file that only hidden projects link, and nothing else', async () => {
    brain();
    put(
      `${SECRET}/project.md`,
      `${restricted()}\n## Linked files\n\n- [deck](clients/acme/files/deck.pdf)\n- [both](clients/acme/images/both.png)\n- [report](clients/acme/reports/x.pdf)\n- [nested](clients/acme/files/sub/y.pdf)\n`,
    );
    put(
      'clients/acme/projects/website/project.md',
      `${card('Website')}\n## Linked files\n\n- [both](clients/acme/images/both.png)\n`,
    );
    const outsider = await as(OUTSIDER).index();
    const hidden = (p: string) => outsider.hiddenPath?.(p);
    expect(hidden('clients/acme/files/deck.pdf')).toBe(true);
    expect(hidden('clients/acme/files/Deck.PDF')).toBe(true);
    // A visible project links it too: it stays.
    expect(hidden('clients/acme/images/both.png')).toBe(false);
    // Linked from elsewhere than files/ or images/ (decision 5): it stays.
    expect(hidden('clients/acme/reports/x.pdf')).toBe(false);
    expect(hidden('clients/acme/files/sub/y.pdf')).toBe(false);
    expect(hidden('clients/acme/files/other.pdf')).toBe(false);
    expect(hidden('clients/acme/files')).toBe(false);
    expect(outsider.hiddenPaths).toContain('clients/acme/files/deck.pdf');
    expect(outsider.hiddenPaths).not.toContain('clients/acme/images/both.png');
    expect(outsider.keysForPath('clients/acme/files/deck.pdf')).toEqual([]);
    const member = await as(ON_TEAM).index();
    expect(member.hiddenPath?.('clients/acme/files/deck.pdf')).toBe(false);
    expect(member.hiddenPaths).toEqual([]);
    expect(member.keysForPath('clients/acme/files/deck.pdf')).toEqual(['acme/secret']);
  });

  it('caches the masked index for 30 seconds; changed() drops it', async () => {
    brain();
    let viewer: Identity = OUTSIDER;
    const s = service({ viewer: async () => viewer, members: async () => MEMBERS });
    expect((await s.index()).byKey('acme/secret')).toBeNull();
    viewer = SCOUT;
    expect((await s.index()).byKey('acme/secret')).toBeNull();
    s.changed();
    expect((await s.index()).byKey('acme/secret')).not.toBeNull();
  });
});
