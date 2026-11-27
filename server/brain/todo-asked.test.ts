import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Identity } from '../../shared/contract.ts';
import type { ProjectsIndex } from './projects.ts';
import { copyFixture } from './test-helpers.ts';
import { ASKED_LOG_MAX_OUTPUT, ASKED_LOG_TIMEOUT_MS, askedLogArgs, createAskedTodos } from './todo-asked.ts';
import type { GitLogRunner, GitRunOptions } from './todo-history.ts';

const sam: Identity = {
  name: 'Sam Example',
  slug: 'sam-example',
  email: 'sam@example.test',
  role: 'scout',
  knownMember: true,
};
const NOW = new Date('2026-11-16T12:00:00Z');
const HEAD = 'a'.repeat(40);

/** One commit of `git log --name-status --format=%x1e%an%x00%ae%x00%aI`, as git prints it. */
const commit = (name: string, email: string, at: string, ...entries: string[]) =>
  `\x1e${name}\0${email}\0${at}\n\n${entries.join('\n')}\n`;
const SAM = ['Sam Example', 'sam@example.test'] as const;
const JO = ['Jo Owner', 'jo@example.test'] as const;
const ALEX = ['Alex Sample', 'alex@example.test'] as const;

interface Call {
  args: readonly string[];
  cwd: string;
  opts?: GitRunOptions;
}

function fakeGit(log: string | (() => Promise<string>), opts: { cut?: boolean; head?: () => string } = {}) {
  const calls: Call[] = [];
  const run: GitLogRunner = async (args, cwd, o) => {
    calls.push({ args, cwd, opts: o });
    if (args[0] === 'rev-parse') return { stdout: `${opts.head ? opts.head() : HEAD}\n`, cut: false };
    const stdout = typeof log === 'string' ? log : await log();
    return { stdout, cut: opts.cut ?? false };
  };
  return { run, calls, logCalls: () => calls.filter((c) => c.args[0] === 'log').length };
}

function brainWith(files: Record<string, string>): string {
  const root = copyFixture();
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const fm = (lines: string[], body = '') => `---\n${lines.join('\n')}\n---\n${body}`;

describe('asked of others', () => {
  it('runs one read-only git log over todo/ with its own cap and timeout', async () => {
    const root = brainWith({});
    const git = fakeGit('');
    await createAskedTodos(git.run).list(root, sam, NOW);
    const log = git.calls.find((c) => c.args[0] === 'log');
    expect(log?.args).toEqual(askedLogArgs());
    expect(log?.cwd).toBe(root);
    expect(log?.opts).toEqual({ maxOutput: ASKED_LOG_MAX_OUTPUT, timeoutMs: ASKED_LOG_TIMEOUT_MS });
    expect(ASKED_LOG_MAX_OUTPUT).toBe(2 * 1024 * 1024);
    expect(ASKED_LOG_TIMEOUT_MS).toBe(10_000);
    const args = askedLogArgs();
    for (const flag of [
      '-G',
      '^assignee:',
      '--no-renames',
      '--name-status',
      '--no-ext-diff',
      '--no-textconv',
    ])
      expect(args).toContain(flag);
    expect(args.slice(-2)).toEqual(['--', 'todo']);
    expect(args).not.toContain('--follow');
    expect(git.calls.map((c) => c.args[0])).toEqual(['rev-parse', 'log']);
  });

  it('lists a stamped hand-over with every field, the stamp beating git', async () => {
    const text = fm(
      [
        'title: Send the draft quote',
        'assignee: alex-sample',
        'assigned_to: alex-sample',
        'assigned_by: sam-example',
        'assigned_at: 2026-11-10T09:00:00+00:00',
        'due: 2026-11-20',
      ],
      '\nSome words.\n',
    );
    const root = brainWith({ 'todo/20261110-quote.md': text });
    const git = fakeGit(commit(...JO, '2026-11-12T10:00:00Z', 'M\ttodo/20261110-quote.md'));
    const list = await createAskedTodos(git.run).list(root, sam, NOW);
    expect(list.historyRead).toBe(true);
    expect(list.done).toEqual([]);
    expect(list.waiting).toEqual([
      {
        key: 'asked:todo/20261110-quote.md',
        id: '20261110-quote.md',
        state: 'waiting',
        path: 'todo/20261110-quote.md',
        title: 'Send the draft quote',
        assignee: 'alex-sample',
        assigneeName: 'Alex Sample',
        due: '2026-11-20',
        details: 'Some words.',
        asked: { slug: 'sam-example', name: 'Sam Example', at: '2026-11-10T09:00:00+00:00', source: 'stamp' },
        done: null,
        version: createHash('sha256')
          .update(readFileSync(join(root, 'todo', '20261110-quote.md')))
          .digest('hex'),
        attachments: [],
        client: null,
        project: null,
        updates: [],
        updatesMore: false,
        updateExtras: [],
        links: [],
        lastChange: null,
        createdAt: null,
        canUpdate: false,
      },
    ]);
  });

  it('carries client and project, resolved as TDS by the projects index (projects filter on Asked)', async () => {
    const text = fm([
      'title: Send the draft quote',
      'assignee: alex-sample',
      'assigned_to: alex-sample',
      'assigned_by: sam-example',
      'assigned_at: 2026-11-10T09:00:00+00:00',
      'client: acme',
      'project: acme/relaunch',
    ]);
    const root = brainWith({ 'todo/20261110-quote.md': text });
    const seen: unknown[] = [];
    const index = {
      cards: [],
      byKey: () => null,
      keysForPath: () => [],
      resolve: (value: string | null, client: string | null, scope: 'tds' | 'personal') => {
        seen.push([value, client, scope]);
        return { how: 'key' as const, key: 'acme/relaunch' };
      },
    };
    const list = await createAskedTodos(fakeGit('').run).list(root, sam, NOW, async () => index);
    expect(seen).toEqual([['acme/relaunch', 'acme', 'tds']]);
    expect(list.waiting[0]).toMatchObject({
      client: 'acme',
      project: 'acme/relaunch',
      projectMatch: { how: 'key', key: 'acme/relaunch' },
    });
    // A failing index leaves the match out; the list still loads.
    const failed = await createAskedTodos(fakeGit('').run).list(root, sam, NOW, async () => {
      throw new Error('no index');
    });
    expect(failed.waiting[0]?.project).toBe('acme/relaunch');
    expect(failed.waiting[0]).not.toHaveProperty('projectMatch');
  });

  it('a stamp naming someone else means not asked by me, whatever git says', async () => {
    const root = brainWith({
      'todo/20261110-theirs.md': fm([
        'assignee: alex-sample',
        'assigned_to: alex-sample',
        'assigned_by: jo-owner',
        'assigned_at: 2026-11-10T09:00:00+00:00',
      ]),
    });
    const git = fakeGit(commit(...SAM, '2026-11-12T10:00:00Z', 'M\ttodo/20261110-theirs.md'));
    const list = await createAskedTodos(git.run).list(root, sam, NOW);
    expect(list.waiting).toEqual([]);
  });

  it('falls back to the newest A or M commit on todo/<id>, matched by email then name', async () => {
    const root = brainWith({
      'todo/20261101-by-git.md': fm(['assignee: alex-sample']),
      'todo/20261101-stale.md': fm([
        'assignee: alex-sample',
        'assigned_to: jo-owner',
        'assigned_by: jo-owner',
        'assigned_at: 2026-11-01T09:00:00+00:00',
      ]),
      'todo/20261101-by-name.md': fm(['assignee: jo-owner']),
      'todo/20261101-later-jo.md': fm(['assignee: alex-sample']),
    });
    const log = [
      commit(...JO, '2026-11-09T10:00:00Z', 'M\ttodo/20261101-later-jo.md'),
      commit(...SAM, '2026-11-08T10:00:00Z', 'M\ttodo/20261101-by-git.md', 'M\ttodo/20261101-stale.md'),
      commit('Sam Example', 'old-laptop@x.test', '2026-11-07T10:00:00Z', 'A\ttodo/20261101-by-name.md'),
      commit(...SAM, '2026-11-02T10:00:00Z', 'A\ttodo/20261101-later-jo.md'),
    ].join('');
    const list = await createAskedTodos(fakeGit(log).run).list(root, sam, NOW);
    expect(list.waiting.map((t) => [t.id, t.asked])).toEqual([
      [
        '20261101-by-name.md',
        { slug: 'sam-example', name: 'Sam Example', at: '2026-11-07T10:00:00Z', source: 'history' },
      ],
      [
        '20261101-by-git.md',
        { slug: 'sam-example', name: 'Sam Example', at: '2026-11-08T10:00:00Z', source: 'history' },
      ],
      [
        '20261101-stale.md',
        { slug: 'sam-example', name: 'Sam Example', at: '2026-11-08T10:00:00Z', source: 'history' },
      ],
    ]);
  });

  it('uses created_by only when there is no assigned_to line and no git assignee commit', async () => {
    const root = brainWith({
      'todo/20261103-created.md': fm([
        'assignee: alex-sample',
        'created: 2026-11-03',
        'created_by: sam-example',
      ]),
      'todo/20261103-moved-on.md': fm([
        'assignee: alex-sample',
        'created: 2026-11-03',
        'created_by: sam-example',
      ]),
      'todo/20261103-stale-stamp.md': fm([
        'assignee: alex-sample',
        'created: 2026-11-03',
        'created_by: sam-example',
        'assigned_to: jo-owner',
        'assigned_by: jo-owner',
        'assigned_at: 2026-11-04T09:00:00+00:00',
      ]),
    });
    const log = commit(...JO, '2026-11-05T10:00:00Z', 'M\ttodo/20261103-moved-on.md');
    const list = await createAskedTodos(fakeGit(log).run).list(root, sam, NOW);
    expect(list.waiting.map((t) => [t.id, t.asked])).toEqual([
      [
        '20261103-created.md',
        { slug: 'sam-example', name: 'Sam Example', at: '2026-11-03', source: 'stamp' },
      ],
    ]);
  });

  it('never counts the tick (D on todo/<id>, A on todo/done/<id>) as the ask', async () => {
    const recent = '2026-11-14T08:00:00+00:00';
    const root = brainWith({
      'todo/done/20261101-asked.md': fm([
        'assignee: alex-sample',
        'status: done',
        'completed: 2026-11-14',
        'completed_by: alex-sample',
        `completed_at: ${recent}`,
      ]),
      'todo/done/20261101-not-asked.md': fm(['assignee: alex-sample', 'completed: 2026-11-14']),
    });
    const log = [
      // Sam's Mac synced both ticks.
      commit(
        ...SAM,
        '2026-11-14T08:05:00Z',
        'D\ttodo/20261101-asked.md',
        'A\ttodo/done/20261101-asked.md',
        'D\ttodo/20261101-not-asked.md',
        'A\ttodo/done/20261101-not-asked.md',
      ),
      commit(...JO, '2026-11-02T10:00:00Z', 'A\ttodo/20261101-not-asked.md'),
      commit(...SAM, '2026-11-01T10:00:00Z', 'A\ttodo/20261101-asked.md'),
    ].join('');
    const list = await createAskedTodos(fakeGit(log).run).list(root, sam, NOW);
    expect(list.waiting).toEqual([]);
    expect(list.done.map((t) => [t.key, t.state, t.path, t.asked, t.done])).toEqual([
      [
        'asked:todo/done/20261101-asked.md',
        'done',
        'todo/done/20261101-asked.md',
        { slug: 'sam-example', name: 'Sam Example', at: '2026-11-01T10:00:00Z', source: 'history' },
        { slug: 'alex-sample', name: 'Alex Sample', at: recent, source: 'stamp' },
      ],
    ]);
  });

  it('finds who finished: the stamp, else the commit that added todo/done/<id>, else the completed date', async () => {
    const stamp = (id: string) => [
      'assignee: alex-sample',
      'assigned_to: alex-sample',
      'assigned_by: sam-example',
      `assigned_at: 2026-11-0${id}T09:00:00+00:00`,
    ];
    const root = brainWith({
      'todo/done/20261101-one.md': fm([
        ...stamp('1'),
        'completed: 2026-11-10',
        'completed_by: jo-owner',
        'completed_at: 2026-11-10T09:00:00+00:00',
      ]),
      'todo/done/20261101-two.md': fm([...stamp('2'), 'completed: 2026-11-12']),
      'todo/done/20261101-three.md': fm([...stamp('3'), 'completed: 2026-11-11']),
    });
    const log = commit(
      ...ALEX,
      '2026-11-12T16:00:00Z',
      'D\ttodo/20261101-two.md',
      'A\ttodo/done/20261101-two.md',
    );
    const list = await createAskedTodos(fakeGit(log).run).list(root, sam, NOW);
    expect(list.done.map((t) => [t.id, t.done])).toEqual([
      [
        '20261101-two.md',
        { slug: 'alex-sample', name: 'Alex Sample', at: '2026-11-12T16:00:00Z', source: 'history' },
      ],
      ['20261101-three.md', { slug: null, name: null, at: '2026-11-11', source: 'stamp' }],
      [
        '20261101-one.md',
        { slug: 'jo-owner', name: 'Jo Owner', at: '2026-11-10T09:00:00+00:00', source: 'stamp' },
      ],
    ]);
  });

  it(`leaves out done tasks finished more than 60 days ago`, async () => {
    const stamp = [
      'assignee: alex-sample',
      'assigned_to: alex-sample',
      'assigned_by: sam-example',
      'assigned_at: 2026-08-01T09:00:00+01:00',
    ];
    const root = brainWith({
      'todo/done/20260801-old.md': fm([...stamp, 'completed: 2026-09-16']),
      'todo/done/20260801-recent.md': fm([...stamp, 'completed: 2026-09-18']),
    });
    const list = await createAskedTodos(fakeGit('').run).list(root, sam, NOW);
    expect(list.done.map((t) => t.id)).toEqual(['20260801-recent.md']);
  });

  it('leaves out open, personal and my own tasks', async () => {
    const mine = ['created_by: sam-example', 'assigned_by: sam-example', 'assigned_at: 2026-11-01T09:00:00Z'];
    const root = brainWith({
      'todo/20261101-open.md': fm(['title: Anyone', ...mine, 'assigned_to: open']),
      'todo/20261101-mine.md': fm(['assignee: sam-example', ...mine, 'assigned_to: sam-example']),
      'todo/done/20261101-mine-done.md': fm(['assignee: sam-example', ...mine, 'completed: 2026-11-14']),
      'personal/todo/20261101-personal.md': fm([
        'assignee: alex-sample',
        ...mine,
        'assigned_to: alex-sample',
      ]),
    });
    const log = [
      commit(
        ...SAM,
        '2026-11-02T10:00:00Z',
        'A\ttodo/20261101-open.md',
        'A\ttodo/20261101-mine.md',
        'A\ttodo/20261102-alex-task.md',
      ),
    ].join('');
    const list = await createAskedTodos(fakeGit(log).run).list(root, sam, NOW);
    // The fixture's own alex task, added by Sam's commit, is the only one listed.
    expect(list.waiting.map((t) => t.id)).toEqual(['20261102-alex-task.md']);
    expect(list.done).toEqual([]);
  });

  it('git failure or cut output: stamps only, historyRead false', async () => {
    const root = brainWith({
      'todo/20261101-stamped.md': fm([
        'assignee: alex-sample',
        'assigned_to: alex-sample',
        'assigned_by: sam-example',
        'assigned_at: 2026-11-01T09:00:00Z',
      ]),
      'todo/20261101-created.md': fm([
        'assignee: alex-sample',
        'created: 2026-11-02',
        'created_by: sam-example',
      ]),
      'todo/20261101-git-only.md': fm(['assignee: alex-sample']),
    });
    const log = commit(...SAM, '2026-11-08T10:00:00Z', 'M\ttodo/20261101-git-only.md');
    const failed = await createAskedTodos(async () => Promise.reject(new Error('not a git folder'))).list(
      root,
      sam,
      NOW,
    );
    const cut = await createAskedTodos(fakeGit(log, { cut: true }).run).list(root, sam, NOW);
    const logFails = await createAskedTodos(
      fakeGit(() => Promise.reject(new Error('git timed out'))).run,
    ).list(root, sam, NOW);
    // Two calls at once share one git run; when it fails, both get stamps only (neither throws).
    const shared = createAskedTodos(
      fakeGit(() => new Promise((_, reject) => setTimeout(() => reject(new Error('git timed out')), 20))).run,
    );
    const both = await Promise.all([shared.list(root, sam, NOW), shared.list(root, sam, NOW)]);
    for (const list of [failed, cut, logFails, ...both]) {
      expect(list.historyRead).toBe(false);
      expect(list.waiting.map((t) => t.id)).toEqual(['20261101-stamped.md', '20261101-created.md']);
    }
  });

  it('reuses the parsed log for the same HEAD but re-reads the files every call', async () => {
    const root = brainWith({ 'todo/20261101-a.md': fm(['assignee: alex-sample']) });
    let head = HEAD;
    const git = fakeGit(commit(...SAM, '2026-11-08T10:00:00Z', 'M\ttodo/20261101-a.md'), {
      head: () => head,
    });
    const asked = createAskedTodos(git.run);
    expect((await asked.list(root, sam, NOW)).waiting.map((t) => t.id)).toEqual(['20261101-a.md']);
    writeFileSync(
      join(root, 'todo', '20261115-new.md'),
      fm([
        'assignee: jo-owner',
        'assigned_to: jo-owner',
        'assigned_by: sam-example',
        'assigned_at: 2026-11-15T09:00:00Z',
      ]),
    );
    const second = await asked.list(root, sam, NOW);
    expect(second.waiting.map((t) => t.id)).toEqual(['20261101-a.md', '20261115-new.md']);
    expect(git.logCalls()).toBe(1);
    head = 'b'.repeat(40);
    await asked.list(root, sam, NOW);
    expect(git.logCalls()).toBe(2);
  });

  it('sorts waiting by oldest ask first and done by most recent finish first', async () => {
    const asked = (at: string) => [
      'assignee: alex-sample',
      'assigned_to: alex-sample',
      'assigned_by: sam-example',
      `assigned_at: ${at}`,
    ];
    const root = brainWith({
      'todo/20261101-b.md': fm(asked('2026-11-05T09:00:00Z')),
      'todo/20261101-a.md': fm(asked('2026-11-07T09:00:00Z')),
      'todo/20261101-c.md': fm(asked('2026-11-03T09:00:00Z')),
      'todo/done/20261101-d.md': fm([...asked('2026-11-01T09:00:00Z'), 'completed: 2026-11-08']),
      'todo/done/20261101-e.md': fm([...asked('2026-11-01T09:00:00Z'), 'completed: 2026-11-12']),
    });
    const list = await createAskedTodos(fakeGit('').run).list(root, sam, NOW);
    expect(list.waiting.map((t) => t.id)).toEqual(['20261101-c.md', '20261101-b.md', '20261101-a.md']);
    expect(list.done.map((t) => t.id)).toEqual(['20261101-e.md', '20261101-d.md']);
  });

  it('runs no git for someone the app cannot name', async () => {
    const git = fakeGit('');
    const nobody: Identity = { name: '', slug: '', email: null, role: 'unknown', knownMember: false };
    const list = await createAskedTodos(git.run).list(brainWith({}), nobody, NOW);
    expect(list).toEqual({ waiting: [], done: [], historyRead: true });
    expect(git.calls).toEqual([]);
  });

  it('is empty (history read) for a brain with no todo folder', async () => {
    const root = brainWith({});
    const { rmSync } = await import('node:fs');
    rmSync(join(root, 'todo'), { recursive: true, force: true });
    const list = await createAskedTodos(fakeGit('').run).list(root, sam, NOW);
    expect(list).toEqual({ waiting: [], done: [], historyRead: true });
  });
});

describe('asked of others: restricted projects (plan 2026-11-27, decision 6)', () => {
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
  const asked = (by: string) =>
    fm(
      [
        'assignee: alex-sample',
        'assigned_to: alex-sample',
        'assigned_at: 2026-11-10T09:00:00+00:00',
        `assigned_by: ${by}`,
        'client: acme-heating',
        `project: ${SECRET}`,
      ],
      'Words.\n',
    );

  it('shows a hidden project task only when sam asked for it, with nothing naming the project', async () => {
    const root = brainWith({
      'todo/20261110-by-sam.md': asked('sam-example'),
      'todo/20261110-by-jo.md': asked('jo-owner'),
    });
    const list = await createAskedTodos(fakeGit('').run).list(root, sam, NOW, async () => index);
    expect(list.waiting.map((t) => t.id)).toEqual(['20261110-by-sam.md']);
    expect(list.waiting[0]).toMatchObject({ project: null, projectMatch: { how: 'restricted' } });
    // The label never leaves the server, whatever the field.
    expect(JSON.stringify(list)).not.toContain('secret');
  });

  it("keeps sam's own asks when the index can't be read", async () => {
    const root = brainWith({ 'todo/20261110-by-sam.md': asked('sam-example') });
    const list = await createAskedTodos(fakeGit('').run).list(root, sam, NOW, async () => {
      throw new Error('no index');
    });
    expect(list.waiting.map((t) => t.id)).toEqual(['20261110-by-sam.md']);
  });
});

describe('asked of others: the timeline and canUpdate (task updates)', () => {
  const asked = (extra: string[] = [], body = '# Asked\n') =>
    fm(
      [
        'assignee: alex-sample',
        'assigned_to: alex-sample',
        'assigned_at: 2026-11-10T09:00:00+00:00',
        'assigned_by: sam-example',
        ...extra,
      ],
      body,
    );
  const LOGGED =
    '# Asked\n\n## Files\n\n- [Spec](https://example.com/spec)\n\n## Updates\n\n- 27 Nov 2026, 14:05 UK: Alex Sample (alex-sample) wrote: On it.\n';

  it('sends the timeline fields on waiting and done rows', async () => {
    const root = brainWith({
      'todo/20261110-waiting.md': asked(['created_at: 2026-11-10T09:00:00+00:00'], LOGGED),
      'todo/done/20261110-done.md': asked(
        ['completed_by: alex-sample', 'completed_at: 2026-11-15T09:00:00+00:00'],
        LOGGED,
      ),
    });
    const list = await createAskedTodos(fakeGit('').run).list(root, sam, NOW);
    for (const row of [list.waiting[0], list.done[0]]) {
      expect(row).toMatchObject({
        links: [{ url: 'https://example.com/spec', name: 'Spec' }],
        updatesMore: false,
        lastChange: { by: 'alex-sample', action: 'update' },
      });
      expect(row?.updates?.map((u) => u.text)).toContain('On it.');
    }
    expect(list.waiting[0]?.createdAt).toBe('2026-11-10T09:00:00+00:00');
    expect(list.done[0]?.createdAt).toBeNull();
  });

  it('sets canUpdate on a waiting row only when the caller says updates are on', async () => {
    const root = brainWith({
      'todo/20261110-waiting.md': asked(),
      'todo/done/20261110-done.md': asked([
        'completed_by: alex-sample',
        'completed_at: 2026-11-15T09:00:00+00:00',
      ]),
    });
    const on = await createAskedTodos(fakeGit('').run).list(root, sam, NOW, undefined, true);
    expect(on.waiting[0]?.canUpdate).toBe(true);
    expect(on.done[0]?.canUpdate).toBe(false);
    const off = await createAskedTodos(fakeGit('').run).list(root, sam, NOW);
    expect(off.waiting[0]?.canUpdate).toBe(false);
  });

  it('never sets canUpdate on a row in a project hidden from this person', async () => {
    const SECRET = 'acme-heating/secret';
    const index: ProjectsIndex = {
      cards: [],
      byKey: () => null,
      keysForPath: () => [],
      resolve: (value) => (value === SECRET ? { how: 'restricted' } : { how: 'none' }),
      hiddenPath: () => false,
      hiddenKey: (key) => key === SECRET,
      hiddenCount: 1,
    };
    const root = brainWith({
      'todo/20261110-secret.md': asked([`project: ${SECRET}`, 'client: acme-heating']),
    });
    const list = await createAskedTodos(fakeGit('').run).list(root, sam, NOW, async () => index, true);
    expect(list.waiting[0]?.canUpdate).toBe(false);
  });
});
