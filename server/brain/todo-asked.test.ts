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

  it('marks handedBack only on a waiting row this person handed back (the current stamp, made by them)', async () => {
    const stamp = (by: string, back: boolean) => [
      'assignee: alex-sample',
      'assigned_to: alex-sample',
      'assigned_at: 2026-11-10T09:00:00+00:00',
      `assigned_by: ${by}`,
      ...(back ? ['assigned_back: true'] : []),
    ];
    const root = brainWith({
      'todo/20261110-back.md': fm(stamp('sam-example', true), '# Back\n'),
      'todo/20261110-plain.md': fm(stamp('sam-example', false), '# Plain\n'),
      'todo/20261110-other.md': fm([...stamp('jo-owner', true), 'created_by: sam-example'], '# Other\n'),
      'todo/done/20261110-done.md': fm(
        [
          ...stamp('sam-example', true),
          'completed_by: alex-sample',
          'completed_at: 2026-11-15T09:00:00+00:00',
        ],
        '# Done\n',
      ),
    });
    const list = await createAskedTodos(fakeGit('').run).list(root, sam, NOW);
    const by = (id: string) => [...list.waiting, ...list.done].find((r) => r.id === id);
    expect(by('20261110-back.md')?.handedBack).toBe(true);
    expect(by('20261110-plain.md')).toBeDefined();
    expect(by('20261110-plain.md')).not.toHaveProperty('handedBack');
    expect(by('20261110-other.md') ?? {}).not.toHaveProperty('handedBack');
    expect(by('20261110-done.md')).toBeDefined();
    expect(by('20261110-done.md')).not.toHaveProperty('handedBack');
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

describe('asked of others: a task the holder passed on (change notices follow-ups)', () => {
  /** The holder now, from a stamp made by someone other than sam. */
  const held = (assignee: string, by: string, extra: string[] = []) => [
    `assignee: ${assignee}`,
    `assigned_to: ${assignee}`,
    'assigned_at: 2026-11-12T10:30:00+00:00',
    `assigned_by: ${by}`,
    ...extra,
  ];
  const line = (day: number, time: string, who: string, what: string) =>
    `- ${day} Nov 2026, ${time} UK: ${who} ${what} (TDS Cortex).`;
  const history = (...lines: string[]) => `# Task\n\n## Handover history\n\n${lines.join('\n')}\n`;
  const SAM_TO_ALEX = line(10, '09:00', 'Sam Example', 'passed it from sam-example to alex-sample');
  const ALEX_TO_JO = line(12, '10:30', 'Alex Sample', 'passed it from alex-sample to jo-owner');
  const list = (files: Record<string, string>, canUpdate = false) =>
    createAskedTodos(fakeGit('').run).list(brainWith(files), sam, NOW, undefined, canUpdate);

  it('stays in the list of the person who first asked, with who has it now and since when', async () => {
    const got = await list(
      { 'todo/20261110-chain.md': fm(held('jo-owner', 'alex-sample'), history(SAM_TO_ALEX, ALEX_TO_JO)) },
      true,
    );
    expect(got.waiting).toHaveLength(1);
    expect(got.waiting[0]).toMatchObject({
      id: '20261110-chain.md',
      assignee: 'jo-owner',
      assigneeName: 'Jo Owner',
      asked: { slug: 'sam-example', name: 'Sam Example', at: '2026-11-10T09:00:00+00:00', source: 'stamp' },
      passedOnAt: '2026-11-12T10:30:00+00:00',
      canUpdate: true,
    });
    expect(got.waiting[0]).not.toHaveProperty('handedBack');
  });

  it('shows in their Done list when the new holder finishes it', async () => {
    const got = await list({
      'todo/done/20261110-chain.md': fm(
        [
          ...held('jo-owner', 'alex-sample'),
          'completed_by: jo-owner',
          'completed_at: 2026-11-15T09:00:00+00:00',
        ],
        history(SAM_TO_ALEX, ALEX_TO_JO),
      ),
    });
    expect(got.done).toHaveLength(1);
    expect(got.done[0]).toMatchObject({ assignee: 'jo-owner', done: { slug: 'jo-owner' } });
    expect(got.done[0]?.asked.slug).toBe('sam-example');
  });

  it('a task sam asked for directly carries no passedOnAt', async () => {
    const got = await list({
      'todo/20261110-plain.md': fm(held('alex-sample', 'sam-example'), history(SAM_TO_ALEX)),
    });
    expect(got.waiting).toHaveLength(1);
    expect(got.waiting[0]).not.toHaveProperty('passedOnAt');
  });

  it('is not theirs without a pass-on of their own in the history', async () => {
    const got = await list({
      // No history at all: only the stamp, by someone else.
      'todo/20261110-none.md': fm(held('jo-owner', 'alex-sample'), '# Task\n'),
      // Sam only ever made it open; Jo picked it up.
      'todo/20261110-open.md': fm(
        held('jo-owner', 'jo-owner'),
        history(
          line(10, '09:00', 'Sam Example', 'made it open to anyone; it was with sam-example'),
          line(11, '09:00', 'Jo Owner', 'picked it up from the open list'),
        ),
      ),
      // Sam was given it and handed it back: a hand back is not an ask.
      'todo/20261110-back.md': fm(
        held('alex-sample', 'jo-owner'),
        history(
          line(9, '09:00', 'Jo Owner', 'passed it from jo-owner to sam-example'),
          line(10, '09:00', 'Sam Example', 'handed it back to jo-owner'),
          line(12, '10:30', 'Jo Owner', 'passed it from jo-owner to alex-sample'),
        ),
      ),
      // Someone else with a pass-on to the same person.
      'todo/20261110-other.md': fm(
        held('jo-owner', 'alex-sample'),
        history(line(10, '09:00', 'Jo Owner', 'passed it from jo-owner to alex-sample'), ALEX_TO_JO),
      ),
    });
    expect(got.waiting).toEqual([]);
  });

  it('is no longer theirs once it has come back to them, however it left again', async () => {
    const got = await list({
      'todo/20261110-returned.md': fm(
        held('jo-owner', 'jo-owner'),
        history(
          SAM_TO_ALEX,
          line(11, '09:00', 'Alex Sample', 'handed it back to sam-example'),
          line(11, '10:00', 'Sam Example', 'made it open to anyone; it was with sam-example'),
          line(12, '10:30', 'Jo Owner', 'picked it up from the open list'),
        ),
      ),
      'todo/20261110-took-back.md': fm(
        held('jo-owner', 'jo-owner'),
        history(
          SAM_TO_ALEX,
          line(11, '08:00', 'Alex Sample', 'made it open to anyone; it was with alex-sample'),
          line(11, '09:00', 'Sam Example', 'picked it up from the open list'),
          line(11, '10:00', 'Sam Example', 'made it open to anyone; it was with sam-example'),
          line(12, '10:30', 'Jo Owner', 'picked it up from the open list'),
        ),
      ),
    });
    expect(got.waiting).toEqual([]);
  });

  it("counts from sam's newest pass-on, and follows it through the open list", async () => {
    const got = await list({
      'todo/20261110-twice.md': fm(
        held('alex-sample', 'jo-owner'),
        history(
          SAM_TO_ALEX,
          line(10, '15:00', 'Alex Sample', 'handed it back to sam-example'),
          line(11, '09:00', 'Sam Example', 'passed it from sam-example to jo-owner'),
          line(12, '10:30', 'Jo Owner', 'passed it from jo-owner to alex-sample'),
        ),
      ),
      'todo/20261111-via-open.md': fm(
        held('jo-owner', 'jo-owner'),
        history(
          SAM_TO_ALEX,
          line(11, '09:00', 'Alex Sample', 'made it open to anyone; it was with alex-sample'),
          line(12, '10:30', 'Jo Owner', 'picked it up from the open list'),
        ),
      ),
      // Lines out of order in the file (a merge can do that): the times decide. Read top to bottom, the hand
      // back would come first and Sam's ask would stand.
      'todo/20261112-shuffled.md': fm(
        held('jo-owner', 'jo-owner'),
        history(
          line(11, '09:00', 'Alex Sample', 'handed it back to sam-example'),
          line(11, '10:00', 'Sam Example', 'made it open to anyone; it was with sam-example'),
          line(12, '10:30', 'Jo Owner', 'picked it up from the open list'),
          SAM_TO_ALEX,
        ),
      ),
      'todo/20261112-shuffled-ask.md': fm(
        held('jo-owner', 'alex-sample'),
        history(ALEX_TO_JO, SAM_TO_ALEX, line(9, '09:00', 'Alex Sample', 'handed it back to sam-example')),
      ),
    });
    const by = (id: string) => got.waiting.find((r) => r.id === id);
    expect(by('20261110-twice.md')?.asked.at).toBe('2026-11-11T09:00:00+00:00');
    expect(by('20261111-via-open.md')).toMatchObject({
      assignee: 'jo-owner',
      asked: { slug: 'sam-example' },
    });
    expect(by('20261112-shuffled.md')).toBeUndefined();
    expect(by('20261112-shuffled-ask.md')?.asked.at).toBe('2026-11-10T09:00:00+00:00');
  });

  it('takes "since when" from the task itself, never from a git sync date', async () => {
    // No stamp at all: git names Alex as the one who last changed the assignee, a day after the line says.
    const log = commit(
      ...ALEX,
      '2026-11-13T08:00:00Z',
      'M\ttodo/20261110-line.md',
      'M\ttodo/20261110-no-line.md',
    );
    const root = brainWith({
      'todo/20261110-line.md': fm(['assignee: jo-owner'], history(SAM_TO_ALEX, ALEX_TO_JO)),
      // The history never says how it reached Jo.
      'todo/20261110-no-line.md': fm(['assignee: jo-owner'], history(SAM_TO_ALEX)),
      // Jo had it, passed it back to Alex, and a hand edit (stamp, no line) gave it to Jo again.
      'todo/20261110-twice.md': fm(
        [
          'assignee: jo-owner',
          'assigned_to: jo-owner',
          'assigned_at: 2026-11-14T09:00:00+00:00',
          'assigned_by: alex-sample',
        ],
        history(
          SAM_TO_ALEX,
          ALEX_TO_JO,
          line(13, '09:00', 'Jo Owner', 'passed it from jo-owner to alex-sample'),
        ),
      ),
      // The same without a stamp: the old arrival is not when Jo got it this time.
      'todo/20261110-stale.md': fm(
        ['assignee: jo-owner'],
        history(
          SAM_TO_ALEX,
          ALEX_TO_JO,
          line(13, '09:00', 'Jo Owner', 'passed it from jo-owner to alex-sample'),
        ),
      ),
    });
    const got = await createAskedTodos(fakeGit(log).run).list(root, sam, NOW);
    const by = (id: string) => got.waiting.find((r) => r.id === id);
    expect(by('20261110-line.md')?.passedOnAt).toBe('2026-11-12T10:30:00+00:00');
    expect(by('20261110-no-line.md')).toMatchObject({ assignee: 'jo-owner', passedOnAt: null });
    expect(by('20261110-twice.md')?.passedOnAt).toBe('2026-11-14T09:00:00+00:00');
    expect(by('20261110-stale.md')).toMatchObject({ assignee: 'jo-owner', passedOnAt: null });
  });

  it('follows a task they added for someone, which has no history line of its own', async () => {
    const made = ['created_by: sam-example', 'created_at: 2026-11-09T08:15:00+00:00'];
    const got = await list({
      // Added for Alex (a stamp only, since replaced), then Alex passed it on.
      'todo/20261109-added.md': fm(held('jo-owner', 'alex-sample', made), history(ALEX_TO_JO)),
      // Added for Alex, who put it on the open list; Jo took it.
      'todo/20261109-released.md': fm(
        held('jo-owner', 'jo-owner', made),
        history(
          line(11, '09:00', 'Alex Sample', 'made it open to anyone; it was with alex-sample'),
          line(12, '10:30', 'Jo Owner', 'picked it up from the open list'),
        ),
      ),
      // Only a creation date, no time.
      'todo/20261109-dated.md': fm(
        held('jo-owner', 'alex-sample', ['created_by: sam-example', 'created: 2026-11-09']),
        history(ALEX_TO_JO),
      ),
    });
    const by = (id: string) => got.waiting.find((r) => r.id === id);
    expect(by('20261109-added.md')).toMatchObject({
      assignee: 'jo-owner',
      asked: { slug: 'sam-example', at: '2026-11-09T08:15:00+00:00', source: 'stamp' },
      passedOnAt: '2026-11-12T10:30:00+00:00',
    });
    expect(by('20261109-released.md')?.asked.slug).toBe('sam-example');
    expect(by('20261109-dated.md')?.asked.at).toBe('2026-11-09');
  });

  it('adding a task is not an ask when it was open to anyone, their own, or made by someone else', async () => {
    const got = await list({
      'todo/20261109-open.md': fm(
        held('jo-owner', 'alex-sample', ['created_by: sam-example']),
        history(line(11, '09:00', 'Alex Sample', 'picked it up from the open list'), ALEX_TO_JO),
      ),
      'todo/20261109-given-open.md': fm(
        held('jo-owner', 'alex-sample', ['created_by: sam-example']),
        history(line(11, '09:00', 'Jo Owner', 'passed it from the open list to alex-sample'), ALEX_TO_JO),
      ),
      // An older file says `assignee: open`, so the script writes "from open" when someone takes it.
      'todo/20261109-open-word.md': fm(
        held('jo-owner', 'jo-owner', ['created_by: sam-example']),
        history(line(11, '09:00', 'Jo Owner', 'passed it from open to jo-owner')),
      ),
      // It was Sam's own; someone else moved it on.
      'todo/20261109-own.md': fm(
        held('alex-sample', 'jo-owner', ['created_by: sam-example']),
        history(line(11, '09:00', 'Jo Owner', 'passed it from sam-example to alex-sample')),
      ),
      'todo/20261109-theirs.md': fm(
        held('jo-owner', 'alex-sample', ['created_by: jo-owner']),
        history(ALEX_TO_JO),
      ),
      // Added for Alex, who handed it back; then it left Sam by the open list.
      'todo/20261109-came-back.md': fm(
        held('jo-owner', 'jo-owner', ['created_by: sam-example']),
        history(
          line(10, '09:00', 'Alex Sample', 'handed it back to sam-example'),
          line(11, '09:00', 'Sam Example', 'made it open to anyone; it was with sam-example'),
          line(12, '10:30', 'Jo Owner', 'picked it up from the open list'),
        ),
      ),
    });
    expect(got.waiting).toEqual([]);
  });

  it('a line saying the task was with them ends their ask, even when how it came back cannot be read', async () => {
    const got = await list({
      // The pick-up is under a name nobody has, so it names no one; the next line says it was with Sam.
      'todo/20261110-unnamed.md': fm(
        held('jo-owner', 'jo-owner'),
        history(
          SAM_TO_ALEX,
          line(10, '15:00', 'Alex Sample', 'made it open to anyone; it was with alex-sample'),
          line(11, '09:00', 'S. Example', 'picked it up from the open list'),
          line(11, '10:00', 'S. Example', 'made it open to anyone; it was with sam-example'),
          line(12, '10:30', 'Jo Owner', 'picked it up from the open list'),
        ),
      ),
      'todo/20261110-moved.md': fm(
        held('jo-owner', 'alex-sample'),
        history(SAM_TO_ALEX, line(12, '10:30', 'Alex Sample', 'passed it from sam-example to jo-owner')),
      ),
    });
    expect(got.waiting).toEqual([]);
  });

  it("matches a line to them by the name's slug, whatever its capitals", async () => {
    const got = await list({
      'todo/20261110-case.md': fm(
        held('jo-owner', 'alex-sample'),
        history(line(10, '09:00', 'sam example', 'passed it from sam-example to alex-sample'), ALEX_TO_JO),
      ),
    });
    expect(got.waiting.map((r) => r.id)).toEqual(['20261110-case.md']);
  });

  it('never follows a task that is open to anyone, back with them, or passed on under a name that is not theirs', async () => {
    const got = await list({
      'todo/20261110-open-now.md': fm(
        ['assignee: open'],
        history(
          SAM_TO_ALEX,
          line(11, '09:00', 'Alex Sample', 'made it open to anyone; it was with alex-sample'),
        ),
      ),
      'todo/20261110-mine.md': fm(
        held('sam-example', 'alex-sample'),
        history(SAM_TO_ALEX, line(11, '09:00', 'Alex Sample', 'passed it from alex-sample to sam-example')),
      ),
      // A name that is nobody on the team and not sam's.
      'todo/20261110-stranger.md': fm(
        held('jo-owner', 'alex-sample'),
        history(line(10, '09:00', 'Sam Other', 'passed it from sam-other to alex-sample'), ALEX_TO_JO),
      ),
    });
    expect(got.waiting).toEqual([]);
  });

  it('masks a followed task in a project hidden from them, like any task they asked for', async () => {
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
      'todo/20261110-hidden.md': fm(
        held('jo-owner', 'alex-sample', [`project: ${SECRET}`, 'client: acme-heating']),
        history(SAM_TO_ALEX, ALEX_TO_JO),
      ),
    });
    const got = await createAskedTodos(fakeGit('').run).list(root, sam, NOW, async () => index, true);
    expect(got.waiting).toHaveLength(1);
    expect(got.waiting[0]?.canUpdate).toBe(false);
    expect(got.waiting[0]?.project).toBeNull();
    expect(JSON.stringify(got.waiting[0])).not.toContain('secret');
  });
});
