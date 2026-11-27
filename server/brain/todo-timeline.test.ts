import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type AskedTodo,
  type AskedTodoList,
  type Identity,
  TODO_HISTORY_MAX,
  TodoChangeError,
  type TodoEvent,
} from '../../shared/contract.ts';
import type { ProjectsIndex } from './projects.ts';
import { copyFixture } from './test-helpers.ts';
import { type GitLogRunner, type GitRunOptions, runGit } from './todo-history.ts';
import {
  createTodoTimeline,
  HISTORY_MAX_OUTPUT,
  historyArgs,
  historyEvents,
  parseHistoryKey,
  parseHistoryLog,
} from './todo-timeline.ts';

const sam: Identity = {
  name: 'Sam Example',
  slug: 'sam-example',
  email: 'sam@example.test',
  role: 'scout',
  knownMember: true,
};
const HEAD = 'c'.repeat(40);
const ID = '20261101-draft-plan.md';

// ---------------------------------------------------------------------------
// Hand-written `git log --no-renames -p -U0 --format=%x1e%an%x00%ae%x00%aI` output (invented tasks).
// ---------------------------------------------------------------------------

const commit = (author: readonly [string, string], at: string, ...diffs: string[]) =>
  `\x1e${author[0]}\0${author[1]}\0${at}\n\n${diffs.join('')}`;
const count = (n: number) => (n === 1 ? '' : `,${n}`);
const added = (path: string, lines: string[]) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1${count(lines.length)} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`;
const removed = (path: string, lines: string[]) =>
  `diff --git a/${path} b/${path}\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/${path}\n+++ /dev/null\n@@ -1${count(lines.length)} +0,0 @@\n${lines.map((l) => `-${l}`).join('\n')}\n`;
const modified = (path: string, hunks: string) =>
  `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n${hunks}`;

const SAM = ['Sam Example', 'sam@example.test'] as const;
const JO = ['Jo Owner', 'jo@example.test'] as const;
const ALEX = ['Alex Sample', 'alex@example.test'] as const;

const TOP = `todo/${ID}`;
const DONE = `todo/done/${ID}`;

const v1 = [
  '---',
  'title: Draft the plan',
  'assignee: jo-owner',
  'created: 2026-11-01',
  'created_by: jo-owner',
  '---',
  '',
  'Some notes.',
];
const v2 = [
  '---',
  'title: Draft the plan',
  'assignee: alex-sample',
  'assigned_to: alex-sample',
  'assigned_by: jo-owner',
  'assigned_at: 2026-11-02T09:59:00+00:00',
  'created: 2026-11-01',
  'created_by: jo-owner',
  '---',
  '',
  'Some notes.',
];
const v3 = [
  '---',
  'title: Draft the full plan',
  'assignee: alex-sample',
  'assigned_to: alex-sample',
  'assigned_by: jo-owner',
  'assigned_at: 2026-11-02T09:59:00+00:00',
  'created: 2026-11-01',
  'due: 2026-11-20',
  'created_by: jo-owner',
  '---',
  '',
  'Some better notes.',
];
const v4 = [
  ...v3.slice(0, 9),
  'status: done',
  'completed: 2026-11-04',
  'completed_at: 2026-11-04T08:00:00+00:00',
  'completed_by: alex-sample',
  ...v3.slice(9),
];

/** Newest first, as git prints them. */
const LIFE = [
  // c5: un-ticked by Jo (D done/ + A todo/).
  commit(JO, '2026-11-05T10:00:00Z', removed(DONE, v4), added(TOP, v4)),
  // c4: ticked; Sam's Mac synced it, the stamp says Alex.
  commit(SAM, '2026-11-04T08:05:00Z', removed(TOP, v3), added(DONE, v4)),
  // c3: Alex retitles, adds a due date and changes the details.
  commit(
    ALEX,
    '2026-11-03T10:00:00Z',
    modified(
      TOP,
      '@@ -2 +2 @@\n-title: Draft the plan\n+title: Draft the full plan\n@@ -7,0 +8 @@\n+due: 2026-11-20\n@@ -11 +12 @@\n-Some notes.\n+Some better notes.\n',
    ),
  ),
  // c2: passed on; Sam's Mac synced it, the stamp says Jo.
  commit(
    SAM,
    '2026-11-02T10:00:00Z',
    modified(
      TOP,
      '@@ -3 +3,4 @@\n-assignee: jo-owner\n+assignee: alex-sample\n+assigned_to: alex-sample\n+assigned_by: jo-owner\n+assigned_at: 2026-11-02T09:59:00+00:00\n',
    ),
  ),
  // c1: created by Jo.
  commit(JO, '2026-11-01T09:00:00Z', added(TOP, v1)),
];

const jo = (at: string, source: 'stamp' | 'history') => ({ slug: 'jo-owner', name: 'Jo Owner', at, source });
const alex = (at: string, source: 'stamp' | 'history') => ({
  slug: 'alex-sample',
  name: 'Alex Sample',
  at,
  source,
});

const EXPECTED: TodoEvent[] = [
  { kind: 'changed', actor: jo('2026-11-05T10:00:00Z', 'history') },
  { kind: 'done', actor: alex('2026-11-04T08:00:00+00:00', 'stamp') },
  {
    kind: 'retitled',
    from: 'Draft the plan',
    to: 'Draft the full plan',
    actor: alex('2026-11-03T10:00:00Z', 'history'),
  },
  { kind: 'due', from: null, to: '2026-11-20', actor: alex('2026-11-03T10:00:00Z', 'history') },
  { kind: 'details', actor: alex('2026-11-03T10:00:00Z', 'history') },
  { kind: 'passed-on', from: 'jo-owner', to: 'alex-sample', actor: jo('2026-11-02T09:59:00+00:00', 'stamp') },
  { kind: 'created', to: 'jo-owner', actor: jo('2026-11-01T09:00:00Z', 'stamp') },
];

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
    return { stdout: typeof log === 'string' ? log : await log(), cut: opts.cut ?? false };
  };
  return { run, calls, logCalls: () => calls.filter((c) => c.args[0] === 'log') };
}

function brainWith(files: Record<string, string> = {}): string {
  const root = copyFixture();
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('task history', () => {
  it('runs one read-only git log over the three paths, no --follow, with its own cap', async () => {
    const root = brainWith({ [TOP]: v1.join('\n') });
    const git = fakeGit('');
    await createTodoTimeline(git.run).history(root, ID, sam);
    const [log] = git.logCalls();
    expect(log?.args).toEqual(historyArgs(ID));
    expect(log?.cwd).toBe(root);
    expect(log?.opts?.maxOutput).toBe(HISTORY_MAX_OUTPUT);
    expect(HISTORY_MAX_OUTPUT).toBe(512 * 1024);
    const args = historyArgs(ID);
    for (const flag of ['--no-renames', '-p', '-U0', '--no-ext-diff', '--no-textconv'])
      expect(args).toContain(flag);
    expect(args).not.toContain('--follow');
    expect(args[args.indexOf('-n') + 1]).toBe(String(TODO_HISTORY_MAX + 1));
    expect(args.slice(-4)).toEqual(['--', TOP, DONE, `todo/deleted/${ID}`]);
    expect(git.calls[0]?.args).toEqual(['rev-parse', 'HEAD']);
  });

  it('turns each commit into events, newest first: a tick is one done event, an un-tick is changed', async () => {
    const root = brainWith({ [TOP]: v4.join('\n') });
    const res = await createTodoTimeline(fakeGit(LIFE.join('')).run).history(root, ID, sam);
    expect(res).toEqual({ status: 'ok', events: EXPECTED, more: false });
  });

  it('a tick (D todo/x + A todo/done/x) never shows as created or details', async () => {
    const root = brainWith({ [DONE]: v4.join('\n') });
    const res = await createTodoTimeline(fakeGit(LIFE.slice(1).join('')).run).history(root, ID, sam);
    expect(res.events.map((e) => e.kind)).toEqual([
      'done',
      'retitled',
      'due',
      'details',
      'passed-on',
      'created',
    ]);
    // A TodoItem key ticked since resolves to todo/done/<id>.
    expect(res.status).toBe('ok');
  });

  it('a deletion is one deleted event, its actor the deleted_by stamp', async () => {
    const root = brainWith({ [TOP]: v1.join('\n') });
    const gone = [
      ...v1.slice(0, 5),
      'deleted_by: sam-example',
      'deleted_at: 2026-11-06T09:00:00+00:00',
      ...v1.slice(5),
    ];
    const out = [
      commit(JO, '2026-11-06T09:05:00Z', removed(TOP, v1), added(`todo/deleted/${ID}`, gone)),
      commit(JO, '2026-11-01T09:00:00Z', added(TOP, v1)),
    ].join('');
    const res = await createTodoTimeline(fakeGit(out).run).history(root, ID, sam);
    expect(res.events).toEqual([
      {
        kind: 'deleted',
        actor: { slug: 'sam-example', name: 'Sam Example', at: '2026-11-06T09:00:00+00:00', source: 'stamp' },
      },
      { kind: 'created', to: 'jo-owner', actor: jo('2026-11-01T09:00:00Z', 'stamp') },
    ]);
  });

  it('without a stamp the actor is the commit author, matched by email then name', async () => {
    const root = brainWith({ [TOP]: v1.join('\n') });
    const plain = ['---', 'title: Plain', '---', ''];
    const out = [
      commit(
        ['Someone Else', 'nobody@x.test'],
        '2026-11-02T09:00:00Z',
        modified(TOP, '@@ -2 +2 @@\n-title: Plain\n+title: Plainer\n'),
      ),
      commit(['Laptop', 'alex@example.test'], '2026-11-01T09:00:00Z', added(TOP, plain)),
    ].join('');
    const res = await createTodoTimeline(fakeGit(out).run).history(root, ID, sam);
    expect(res.events).toEqual([
      {
        kind: 'retitled',
        from: 'Plain',
        to: 'Plainer',
        actor: { slug: null, name: 'Someone Else', at: '2026-11-02T09:00:00Z', source: 'history' },
      },
      { kind: 'created', to: 'open', actor: alex('2026-11-01T09:00:00Z', 'history') },
    ]);
  });

  it('reads frontmatter lines from the hunks when the file was created before the record starts', async () => {
    const root = brainWith({ [TOP]: v1.join('\n') });
    const out = commit(
      ALEX,
      '2026-11-03T10:00:00Z',
      modified(
        TOP,
        '@@ -3 +2,0 @@\n-assignee: alex-sample\n@@ -9 +8,2 @@\n-Old line.\n+New line.\n+Another.\n',
      ),
    );
    const res = await createTodoTimeline(fakeGit(out).run).history(root, ID, sam);
    expect(res.events.map((e) => [e.kind, e.from, e.to])).toEqual([
      ['passed-on', 'alex-sample', 'open'],
      ['details', undefined, undefined],
    ]);
  });

  it('other frontmatter lines are changed; the assigned_* stamps alone are not', async () => {
    const root = brainWith({ [TOP]: v2.join('\n') });
    const out = [
      commit(
        SAM,
        '2026-11-05T10:00:00Z',
        modified(
          TOP,
          '@@ -6 +6 @@\n-assigned_at: 2026-11-02T09:59:00+00:00\n+assigned_at: 2026-11-02T10:00:00+00:00\n',
        ),
      ),
      commit(
        ALEX,
        '2026-11-04T10:00:00Z',
        modified(TOP, '@@ -7 +7 @@\n-created: 2026-11-01\n+created: 2026-10-31\n'),
      ),
      commit(JO, '2026-11-01T09:00:00Z', added(TOP, v2)),
    ].join('');
    const res = await createTodoTimeline(fakeGit(out).run).history(root, ID, sam);
    expect(res.events.map((e) => e.kind)).toEqual(['changed', 'created']);
  });

  it('cut output: more, and no half-parsed commit', async () => {
    const root = brainWith({ [TOP]: v4.join('\n') });
    const whole = LIFE.slice(0, 3).join('');
    // Cut in the middle of c2's hunk.
    const partial = (LIFE[3] ?? '').slice(0, 120);
    const res = await createTodoTimeline(fakeGit(whole + partial, { cut: true }).run).history(root, ID, sam);
    expect(res.more).toBe(true);
    expect(res.events.map((e) => e.kind)).toEqual(['changed', 'done', 'retitled', 'due', 'details']);
  });

  it(`more when git returns ${TODO_HISTORY_MAX + 1} commits; only ${TODO_HISTORY_MAX} are read`, async () => {
    const root = brainWith({ [TOP]: v1.join('\n') });
    const many = Array.from({ length: TODO_HISTORY_MAX + 1 }, (_, i) =>
      commit(
        ALEX,
        `2026-10-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
        modified(TOP, `@@ -8 +8 @@\n-Line ${i}\n+Line ${i + 1}\n`),
      ),
    ).join('');
    const res = await createTodoTimeline(fakeGit(many).run).history(root, ID, sam);
    expect(res.more).toBe(true);
    expect(res.events).toHaveLength(TODO_HISTORY_MAX);
    const exactly = await createTodoTimeline(
      fakeGit(
        many
          .split('\x1e')
          .slice(0, TODO_HISTORY_MAX + 1)
          .join('\x1e'),
      ).run,
    ).history(root, ID, sam);
    expect(exactly.more).toBe(false);
  });

  it('personal keys answer personal without running git', async () => {
    const root = brainWith({ [`personal/todo/${ID}`]: '---\nassignee: sam-example\n---\n' });
    const git = fakeGit(LIFE.join(''));
    expect(await createTodoTimeline(git.run).history(root, `personal/${ID}`, sam)).toEqual({
      status: 'personal',
      events: [],
      more: false,
    });
    expect(git.calls).toEqual([]);
  });

  it('refuses keys of the wrong shape before any git run', async () => {
    const root = brainWith({ [TOP]: v1.join('\n') });
    const git = fakeGit(LIFE.join(''));
    const timeline = createTodoTimeline(git.run);
    for (const key of [
      '',
      '../secret.md',
      'todo/x.md',
      `asked:todo/deleted/${ID}`,
      'asked:todo/../x.md',
      'asked:x.md',
      'personal/../x.md',
      'personal/todo/x.md',
      'x.txt',
      '.hidden.md',
      'a b.md',
      '-n.md',
      `${'a'.repeat(300)}.md`,
    ]) {
      await expect(timeline.history(root, key, sam), key).rejects.toMatchObject({ code: 'bad-request' });
    }
    await expect(timeline.history(root, 42 as unknown as string, sam)).rejects.toBeInstanceOf(
      TodoChangeError,
    );
    expect(git.calls).toEqual([]);
    expect(parseHistoryKey(`asked:todo/done/${ID}`)).toEqual({ kind: 'asked', id: ID, folder: 'done' });
  });

  it('a missing file or a link is not found, before any git run', async () => {
    const root = brainWith({ [TOP]: v1.join('\n') });
    const outside = mkdtempSync(join(tmpdir(), 'tba-outside-'));
    dirs.push(outside);
    writeFileSync(join(outside, 'x.md'), 'secret');
    symlinkSync(join(outside, 'x.md'), join(root, 'todo', '20261101-link.md'));
    const git = fakeGit(LIFE.join(''));
    const timeline = createTodoTimeline(git.run);
    for (const key of [
      '20261101-missing.md',
      '20261101-link.md',
      `asked:todo/done/${ID}`,
      'personal/20261101-missing.md',
    ])
      await expect(timeline.history(root, key, sam), key).rejects.toMatchObject({ code: 'not-found' });
    expect(git.calls).toEqual([]);
    expect((await timeline.history(root, `asked:todo/${ID}`, sam)).status).toBe('ok');
  });

  it('git trouble is unavailable, never a throw', async () => {
    const root = brainWith({ [TOP]: v1.join('\n') });
    const failing = createTodoTimeline(async () => Promise.reject(new Error('not a git folder')));
    expect(await failing.history(root, ID, sam)).toEqual({ status: 'unavailable', events: [], more: false });
    const logFails = createTodoTimeline(fakeGit(() => Promise.reject(new Error('git timed out'))).run);
    expect((await logFails.history(root, ID, sam)).status).toBe('unavailable');
    const badHead = createTodoTimeline(fakeGit('', { head: () => 'fatal: not a repo' }).run);
    expect((await badHead.history(root, ID, sam)).status).toBe('unavailable');
  });

  it('caches by path and HEAD', async () => {
    const root = brainWith({ [TOP]: v4.join('\n'), 'todo/20261101-other.md': v1.join('\n') });
    let head = HEAD;
    const git = fakeGit(LIFE.join(''), { head: () => head });
    const timeline = createTodoTimeline(git.run);
    await timeline.history(root, ID, sam);
    await timeline.history(root, `asked:todo/${ID}`, sam);
    expect(git.logCalls()).toHaveLength(1);
    await timeline.history(root, '20261101-other.md', sam);
    expect(git.logCalls()).toHaveLength(2);
    head = 'd'.repeat(40);
    await timeline.history(root, ID, sam);
    expect(git.logCalls()).toHaveLength(3);
  });

  it('an empty record (added since the last sync) is ok with no events', async () => {
    const root = brainWith({ [TOP]: v1.join('\n') });
    expect(await createTodoTimeline(fakeGit('').run).history(root, ID, sam)).toEqual({
      status: 'ok',
      events: [],
      more: false,
    });
  });
});

describe('runGit', () => {
  it('says when it cut the output and honours its own limits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tba-git-'));
    dirs.push(dir);
    const whole = await runGit(['--version'], dir);
    expect(whole.cut).toBe(false);
    expect(whole.stdout).toMatch(/^git version/);
    const cut = await runGit(['help', '-a'], dir, { maxOutput: 16 });
    expect(cut.cut).toBe(true);
    expect(cut.stdout.length).toBeLessThanOrEqual(16);
    await expect(runGit(['rev-parse', 'HEAD'], dir)).rejects.toThrow();
  });
});

describe('task history: restricted projects (plan 2026-11-27, decision 6)', () => {
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
  const task = (assignee: string) =>
    ['---', `assignee: ${assignee}`, 'client: acme-heating', `project: ${SECRET}`, '---', '# Plan'].join(
      '\n',
    );
  const notFound = async (p: Promise<unknown>) => {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TodoChangeError);
    expect((err as TodoChangeError).code).toBe('not-found');
  };
  const none = async (): Promise<AskedTodoList> => ({ waiting: [], done: [], historyRead: true });

  it("is not found for a hidden project's task that isn't sam's, by any key, before git runs", async () => {
    const root = brainWith({ [TOP]: task('alex-sample'), [DONE]: task('alex-sample') });
    const git = fakeGit('');
    const timeline = createTodoTimeline(git.run);
    const deps = { projects: async () => index, asked: none };
    for (const key of [ID, `asked:todo/${ID}`, `asked:todo/done/${ID}`, `done:todo/done/${ID}`])
      await notFound(timeline.history(root, key, sam, deps));
    await notFound(
      timeline.history(root, ID, sam, {
        projects: async () => {
          throw new Error('no index');
        },
      }),
    );
    expect(git.logCalls()).toEqual([]);
    // Without the index, as before.
    expect((await timeline.history(root, ID, sam)).status).toBe('ok');
  });

  it("opens sam's own task, and one sam asked for from the Asked list", async () => {
    const root = brainWith({ [TOP]: task('sam-example') });
    const timeline = createTodoTimeline(fakeGit('').run);
    expect((await timeline.history(root, ID, sam, { projects: async () => index })).status).toBe('ok');
    const other = brainWith({ [TOP]: task('alex-sample') });
    const askedBySam = async (): Promise<AskedTodoList> => ({
      waiting: [{ id: ID, state: 'waiting' } as AskedTodo],
      done: [],
      historyRead: true,
    });
    const deps = { projects: async () => index, asked: askedBySam };
    expect((await timeline.history(other, `asked:todo/${ID}`, sam, deps)).status).toBe('ok');
    // Asked opens only the Asked key, never the plain one.
    await notFound(timeline.history(other, ID, sam, deps));
  });
});

// ---------------------------------------------------------------------------
// Task updates (plan 2026-11-27, decision 10): log-only commits are no History event.
// ---------------------------------------------------------------------------

describe('history: the ## Updates log and created_at', () => {
  const roster = {
    team: [
      { slug: 'sam-example', name: 'Sam Example' },
      { slug: 'jo-owner', name: 'Jo Owner' },
    ],
    members: [],
  };
  const events = (commits: string[]) =>
    historyEvents(parseHistoryLog(commits.join(''), false).commits, roster).map((e) => e.kind);
  const ENTRY = '- 27 Nov 2026, 14:05 UK: Sam Example (sam-example) wrote: Sent the quote.';
  const created = commit(JO, '2026-11-01T09:00:00Z', added(TOP, v1));
  /** Appends a new section after line 8 ("Some notes."). */
  const logHunk = `@@ -8,0 +9,4 @@\n+\n+## Updates\n+\n+${ENTRY}\n`;
  const createdAtHunk = '@@ -4,0 +5 @@\n+created_at: 2026-11-01T09:00:00+00:00\n';
  // git prints newest first.
  const log = (...newer: string[]) => [...newer, created];

  it('gives no event for a commit that only added log lines (the whole text is known)', () => {
    expect(events(log(commit(SAM, '2026-11-27T14:06:00Z', modified(TOP, logHunk))))).toEqual(['created']);
  });

  it('gives no event for a later entry added under an existing section', () => {
    const first = commit(SAM, '2026-11-27T14:06:00Z', modified(TOP, logHunk));
    const more = `@@ -12,0 +13,2 @@\n+- 27 Nov 2026, 15:00 UK: Sam Example (sam-example) wrote: First line.\n+  Second line.\n`;
    expect(events(log(commit(SAM, '2026-11-27T15:01:00Z', modified(TOP, more)), first))).toEqual(['created']);
  });

  it('gives no event for a created_at line alone', () => {
    expect(events(log(commit(JO, '2026-11-01T09:01:00Z', modified(TOP, createdAtHunk))))).toEqual([
      'created',
    ]);
  });

  it('gives no event for log lines when the hunks are all that is known', () => {
    // No creating commit in the log: the text before is unknown, so the hunks' own lines are read.
    const only = commit(SAM, '2026-11-27T14:06:00Z', modified(TOP, `${createdAtHunk}${logHunk}`));
    expect(events([only])).toEqual([]);
  });

  it('keeps the other events of a mixed commit and adds no details event for the log', () => {
    const mixed = modified(
      TOP,
      `@@ -4,0 +5 @@\n+due: 2026-11-20\n@@ -8,0 +10,4 @@\n+\n+## Updates\n+\n+${ENTRY}\n`,
    );
    expect(events(log(commit(SAM, '2026-11-27T14:06:00Z', mixed)))).toEqual(['due', 'created']);
    expect(events([commit(SAM, '2026-11-27T14:06:00Z', mixed)])).toEqual(['due']);
  });

  it('still reports a real change to the details beside the log', () => {
    const edit = modified(TOP, `@@ -8 +8,5 @@\n-Some notes.\n+Other notes.\n+\n+## Updates\n+\n+${ENTRY}\n`);
    expect(events(log(commit(SAM, '2026-11-27T14:06:00Z', edit)))).toEqual(['details', 'created']);
    expect(events([commit(SAM, '2026-11-27T14:06:00Z', edit)])).toEqual(['details']);
  });
});
