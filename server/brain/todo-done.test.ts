import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Identity } from '../../shared/contract.ts';
import type { ProjectsIndex } from './projects.ts';
import { copyFixture } from './test-helpers.ts';
import { createAskedLog, doneLogArgs } from './todo-asked.ts';
import { listDoneTodos } from './todo-done.ts';
import type { GitLogRunner } from './todo-history.ts';
import { parseHistoryKey } from './todo-timeline.ts';

const sam: Identity = {
  name: 'Sam Example',
  slug: 'sam-example',
  email: 'sam@example.test',
  role: 'scout',
  knownMember: true,
};
const HEAD = 'a'.repeat(40);
const commit = (name: string, email: string, at: string, ...entries: string[]) =>
  `\x1e${name}\0${email}\0${at}\n\n${entries.join('\n')}\n`;

function fakeLog(log: string, opts: { fail?: boolean } = {}) {
  let logCalls = 0;
  const run: GitLogRunner = async (args) => {
    if (args[0] === 'rev-parse') {
      if (opts.fail) throw new Error('not a git folder');
      return { stdout: `${HEAD}\n`, cut: false };
    }
    logCalls += 1;
    return { stdout: log, cut: false };
  };
  return { log: createAskedLog(run), logCalls: () => logCalls };
}

function brainWith(files: Record<string, string>): string {
  const root = copyFixture();
  // Start with no done files: the fixture has one.
  rmSync(join(root, 'todo', 'done'), { recursive: true, force: true });
  rmSync(join(root, 'personal', 'todo', 'done'), { recursive: true, force: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const fm = (lines: string[], body = '') => `---\n${lines.join('\n')}\n---\n${body}`;

describe('listDoneTodos', () => {
  it('lists TDS done tasks with their stamps, newest first, unknown last', async () => {
    const root = brainWith({
      'todo/done/20261101-a.md': fm(
        [
          'title: Alpha',
          'assignee: alex-sample',
          'completed_by: alex-sample',
          'completed_at: 2026-11-10T09:00:00+00:00',
        ],
        'Alpha words.\n',
      ),
      'todo/done/20261102-b.md': fm([
        'title: Bravo',
        'completed_by: sam-example',
        'completed_at: 2026-11-12T09:00:00+00:00',
      ]),
      'todo/done/20261103-c.md': fm(['title: Charlie']),
      'todo/done/20261104-d.md': fm(['title: Delta']),
    });
    const { log } = fakeLog('');
    const list = await listDoneTodos(root, sam, { log });
    expect(list.historyRead).toBe(true);
    expect(list.items.map((i) => i.id)).toEqual([
      '20261102-b.md',
      '20261101-a.md',
      '20261103-c.md',
      '20261104-d.md',
    ]);
    const a = list.items.find((i) => i.id === '20261101-a.md');
    expect(a).toMatchObject({
      key: 'done:todo/done/20261101-a.md',
      path: 'todo/done/20261101-a.md',
      scope: 'tds',
      title: 'Alpha',
      assignee: 'alex-sample',
      assigneeName: 'Alex Sample',
      details: 'Alpha words.',
      done: { slug: 'alex-sample', name: 'Alex Sample', at: '2026-11-10T09:00:00+00:00', source: 'stamp' },
    });
    expect(a?.version).toMatch(/^[0-9a-f]{64}$/);
    expect(list.items[2]?.done).toBeNull();
  });

  it("never lists another person's personal done file, but lists your own", async () => {
    const root = brainWith({
      'personal/todo/done/20261101-mine.md': fm([
        'title: Mine',
        'assignee: sam-example',
        'completed_by: sam-example',
        'completed_at: 2026-11-11T09:00:00+00:00',
      ]),
      'personal/todo/done/20261101-theirs.md': fm([
        'title: Theirs',
        'assignee: alex-sample',
        'completed_by: alex-sample',
        'completed_at: 2026-11-11T09:00:00+00:00',
      ]),
      'personal/todo/done/20261101-nobody.md': fm(['title: Nobody']),
    });
    const list = await listDoneTodos(root, sam, { log: fakeLog('').log });
    expect(list.items.map((i) => [i.key, i.scope])).toEqual([
      ['done:personal/todo/done/20261101-mine.md', 'personal'],
    ]);
    const nobody: Identity = { ...sam, slug: '' };
    expect((await listDoneTodos(root, nobody, { log: fakeLog('').log })).items).toEqual([]);
  });

  it('refuses a personal folder that is a link', async () => {
    const root = brainWith({
      'elsewhere/20261101-x.md': fm(['title: X', 'assignee: sam-example']),
    });
    mkdirSync(join(root, 'personal', 'todo'), { recursive: true });
    symlinkSync(join(root, 'elsewhere'), join(root, 'personal', 'todo', 'done'));
    const list = await listDoneTodos(root, sam, { log: fakeLog('').log });
    expect(list.items).toEqual([]);
  });

  it('gives a stamp-less TDS file the git date and author, from one log pass', async () => {
    const root = brainWith({
      'todo/done/20261101-old.md': fm(['title: Old']),
      'todo/done/20261102-older.md': fm(['title: Older']),
    });
    const fake = fakeLog(
      commit('Alex Sample', 'alex@example.test', '2026-11-05T10:00:00Z', 'A\ttodo/done/20261101-old.md') +
        commit('Jo Owner', 'jo@example.test', '2026-11-03T10:00:00Z', 'A\ttodo/done/20261102-older.md'),
    );
    const list = await listDoneTodos(root, sam, { log: fake.log });
    expect(list.items.map((i) => [i.id, i.done?.name, i.done?.at, i.done?.source])).toEqual([
      ['20261101-old.md', 'Alex Sample', '2026-11-05T10:00:00Z', 'history'],
      ['20261102-older.md', 'Jo Owner', '2026-11-03T10:00:00Z', 'history'],
    ]);
    expect(fake.logCalls()).toBe(1);
    await listDoneTodos(root, sam, { log: fake.log });
    expect(fake.logCalls()).toBe(1);
  });

  it('a stamp beats git, and a personal file never takes a git actor', async () => {
    const root = brainWith({
      'todo/done/20261101-s.md': fm(['completed_by: sam-example', 'completed_at: 2026-11-09T08:00:00+00:00']),
      'personal/todo/done/20261101-p.md': fm(['assignee: sam-example']),
    });
    const fake = fakeLog(
      commit(
        'Jo Owner',
        'jo@example.test',
        '2026-11-05T10:00:00Z',
        'A\ttodo/done/20261101-s.md',
        'A\ttodo/done/20261101-p.md',
      ),
    );
    const list = await listDoneTodos(root, sam, { log: fake.log });
    expect(list.items.find((i) => i.scope === 'tds')?.done).toMatchObject({
      name: 'Sam Example',
      source: 'stamp',
    });
    expect(list.items.find((i) => i.scope === 'personal')?.done).toBeNull();
  });

  it('with no readable git, historyRead is false and unstamped files have no date (not mtime)', async () => {
    const root = brainWith({
      'todo/done/20261101-old.md': fm(['title: Old']),
      'todo/done/20261102-s.md': fm(['completed_by: sam-example', 'completed_at: 2026-11-09T08:00:00+00:00']),
    });
    const list = await listDoneTodos(root, sam, { log: fakeLog('', { fail: true }).log });
    expect(list.historyRead).toBe(false);
    expect(list.items.map((i) => [i.id, i.done?.at ?? null])).toEqual([
      ['20261102-s.md', '2026-11-09T08:00:00+00:00'],
      ['20261101-old.md', null],
    ]);
  });

  it('skips rule files and unsafe names', async () => {
    const root = brainWith({
      'todo/done/AGENTS.md': 'x',
      'todo/done/README.md': 'x',
      'todo/done/CLAUDE.md': 'x',
      'todo/done/notes.txt': 'x',
      'todo/done/.hidden.md': 'x',
      'todo/done/20261101-ok.md': fm(['title: Ok']),
    });
    const list = await listDoneTodos(root, sam, { log: fakeLog('').log });
    expect(list.items.map((i) => i.id)).toEqual(['20261101-ok.md']);
  });

  it('fills projectMatch from the projects index, and survives it failing', async () => {
    const root = brainWith({
      'todo/done/20261101-p.md': fm(['title: P', 'client: acme', 'project: acme/site']),
    });
    const index = {
      cards: [],
      byKey: () => null,
      keysForPath: () => [],
      resolve: () => ({ how: 'key' as const, key: 'acme/site' }),
    };
    const ok = await listDoneTodos(root, sam, { log: fakeLog('').log, projects: async () => index });
    expect(ok.items[0]?.projectMatch).toEqual({ how: 'key', key: 'acme/site' });
    const bad = await listDoneTodos(root, sam, {
      log: fakeLog('').log,
      projects: async () => {
        throw new Error('no');
      },
    });
    expect(bad.items[0]?.projectMatch).toBeUndefined();
  });
});

describe('parseHistoryKey done: keys', () => {
  it('accepts TDS and personal done keys', () => {
    expect(parseHistoryKey('done:todo/done/20261101-a.md')).toEqual({
      kind: 'asked',
      id: '20261101-a.md',
      folder: 'done',
    });
    expect(parseHistoryKey('done:personal/todo/done/20261101-a.md')).toEqual({
      kind: 'personal',
      id: '20261101-a.md',
    });
  });
  it('refuses malformed ones', () => {
    for (const k of [
      'done:todo/20261101-a.md',
      'done:todo/done/../x.md',
      'done:todo/done/a/b.md',
      'done:todo/done/',
      'done:todo/done/notes.txt',
      'done:personal/todo/20261101-a.md',
      'done:other/todo/done/a.md',
      'done:',
      'done:personal/todo/done/.md',
    ])
      expect(parseHistoryKey(k), k).toBeNull();
  });
});

describe('listDoneTodos with a real git record', () => {
  it('dates a ticked task that was open to anyone (no assignee line) from the commit that moved it', async () => {
    const root = brainWith({ 'todo/20261101-open.md': fm(['title: Open to anyone']) });
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Alex Sample',
      GIT_AUTHOR_EMAIL: 'alex@example.test',
      GIT_COMMITTER_NAME: 'Alex Sample',
      GIT_COMMITTER_EMAIL: 'alex@example.test',
    };
    const git = (args: string[], date: string) =>
      execFileSync('git', args, {
        cwd: root,
        env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      });
    git(['init', '-q'], '2026-11-01T09:00:00+00:00');
    git(['add', '-A'], '2026-11-01T09:00:00+00:00');
    git(['commit', '-q', '-m', 'add'], '2026-11-01T09:00:00+00:00');
    mkdirSync(join(root, 'todo', 'done'), { recursive: true });
    renameSync(join(root, 'todo', '20261101-open.md'), join(root, 'todo', 'done', '20261101-open.md'));
    git(['add', '-A'], '2026-11-15T10:30:00+00:00');
    git(['commit', '-q', '-m', 'tick'], '2026-11-15T10:30:00+00:00');

    const list = await listDoneTodos(root, sam, { log: createAskedLog(undefined, doneLogArgs) });
    expect(list.historyRead).toBe(true);
    const item = list.items.find((i) => i.id === '20261101-open.md');
    expect(item?.done?.at.slice(0, 10)).toBe('2026-11-15');
    expect(item?.done?.source).toBe('history');
  });
});

describe('listDoneTodos: restricted projects (plan 2026-11-27, decision 6)', () => {
  const SECRET = 'acme-heating/secret';
  const index: ProjectsIndex = {
    cards: [],
    byKey: () => null,
    keysForPath: () => [],
    resolve: (value) => (value === SECRET ? { how: 'restricted' } : { how: 'none' }),
    hiddenPath: (rel) => rel.startsWith('clients/acme-heating/projects/secret/'),
    hiddenKey: (key) => key === SECRET,
    hiddenCount: 1,
  };
  const done = (assignee: string | null) =>
    fm(
      [
        ...(assignee ? [`assignee: ${assignee}`] : []),
        'client: acme-heating',
        `project: ${SECRET}`,
        'stage: Build',
        'completed_by: alex-sample',
        'completed_at: 2026-11-10T09:00:00+00:00',
      ],
      'Words.\n',
    );
  const files = {
    'todo/done/20261101-alex.md': done('alex-sample'),
    'todo/done/20261101-open.md': done(null),
    'todo/done/20261101-sam.md': done('sam-example'),
    'todo/done/20261101-plain.md': fm(['assignee: alex-sample', 'completed_at: 2026-11-10'], 'Plain.\n'),
  };

  it("leaves out someone else's finished task in a hidden project, and masks sam's own", async () => {
    const root = brainWith(files);
    const { items } = await listDoneTodos(root, sam, { log: fakeLog('').log, projects: async () => index });
    expect(items.map((t) => t.id).sort()).toEqual(['20261101-plain.md', '20261101-sam.md']);
    expect(items.find((t) => t.id === '20261101-sam.md')).toMatchObject({
      project: null,
      stage: null,
      projectMatch: { how: 'restricted' },
    });
  });

  it("leaves out project-labelled tasks that aren't sam's when the index can't be read", async () => {
    const root = brainWith(files);
    const projects = async (): Promise<ProjectsIndex> => {
      throw new Error('no index');
    };
    const { items } = await listDoneTodos(root, sam, { log: fakeLog('').log, projects });
    expect(items.map((t) => t.id).sort()).toEqual(['20261101-plain.md', '20261101-sam.md']);
    // Sam's own keeps its label: nothing says it is hidden.
    expect(items.find((t) => t.id === '20261101-sam.md')?.project).toBe(SECRET);
  });
});

describe('listDoneTodos: the timeline (task updates)', () => {
  it('sends updates, links, lastChange and createdAt on a finished task', async () => {
    const root = brainWith({
      'todo/done/20261101-a.md': fm(
        [
          'assignee: alex-sample',
          'completed_by: alex-sample',
          'completed_at: 2026-11-10T09:00:00+00:00',
          'created_at: 2026-11-01T09:00:00+00:00',
        ],
        '# Alpha\n\n## Files\n\n- [Spec](https://example.com/spec)\n\n## Updates\n\n- 27 Nov 2026, 14:05 UK: Alex Sample (alex-sample) wrote: All done.\n',
      ),
    });
    const { items } = await listDoneTodos(root, sam, { log: fakeLog('').log });
    expect(items[0]).toMatchObject({
      createdAt: '2026-11-01T09:00:00+00:00',
      links: [{ url: 'https://example.com/spec', name: 'Spec' }],
      updatesMore: false,
      lastChange: { by: 'alex-sample', action: 'update' },
    });
    expect(items[0]?.updates?.map((u) => u.text)).toEqual(['All done.']);
  });
});
