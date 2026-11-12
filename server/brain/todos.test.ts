import {
  existsSync,
  promises as fsPromises,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { TODO_SCRIPT, type TodoAction, TodoChangeError } from '../../shared/contract.ts';
import { createBrainReaders } from './index.ts';
import { copyFixture, person } from './test-helpers.ts';

const sam = person('sam-example', 'scout');

describe('todos', () => {
  it('splits mine, open and others, soonest first, ignoring done and archive', async () => {
    const brain = createBrainReaders(copyFixture());
    const list = await brain.todos(person('sam-example', 'scout'));
    // due 2026-11-20, surface 2026-11-05, surface 2026-10-10 => undated-by-due items use surfaceDate
    expect(list.mine.map((t) => t.id)).toEqual([
      '20261010-undated-thing.md',
      '20261105-send-report.md',
      '20261101-renew-contract.md',
    ]);
    expect(list.open.map((t) => t.id)).toEqual(['20261103-open-task.md']);
    expect(list.othersCount).toBe(1);
  });

  it('reads fields and falls back for the title', async () => {
    const brain = createBrainReaders(copyFixture());
    const list = await brain.todos(person('sam-example', 'scout'));
    const byId = Object.fromEntries(list.mine.map((t) => [t.id, t]));
    expect(byId['20261101-renew-contract.md']).toEqual({
      id: '20261101-renew-contract.md',
      title: 'Renew the Acme contract',
      assignee: 'sam-example',
      due: '2026-11-20',
      surfaceDate: '2026-11-01',
      project: 'renewals',
      client: 'acme-heating',
      created: null,
      source: null,
      details: '',
    });
    expect(byId['20261105-send-report.md']?.title).toBe('Send the monthly report');
    expect(byId['20261010-undated-thing.md']?.title).toBe('Undated thing');
    expect(byId['20261010-undated-thing.md']?.due).toBeNull();
  });

  it('completeTodo moves the file to done/ and records who ticked it and when', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root, { now: () => new Date('2026-11-11T17:07:38Z') });
    await brain.completeTodo('20261105-send-report.md', {
      ...person('sam-example', 'scout'),
      name: 'Sam Example',
    });
    expect(existsSync(join(root, 'todo', '20261105-send-report.md'))).toBe(false);
    const done = readFileSync(join(root, 'todo', 'done', '20261105-send-report.md'), 'utf8');
    expect(done).toBe(
      [
        '---',
        'assignee: sam-example',
        'status: done',
        'completed: 2026-11-11',
        'completed_at: 2026-11-11T17:07:38+00:00',
        'completed_by: sam-example',
        'completed_via: TDS Brain App',
        '---',
        '# Send the monthly report',
        '',
        '## Done 2026-11-11',
        '',
        'Ticked off by Sam Example at 17:07 UK time (TDS Brain App).',
        '',
      ].join('\n'),
    );
    const list = await brain.todos(person('sam-example', 'scout'));
    expect(list.mine.map((t) => t.id)).not.toContain('20261105-send-report.md');
  });

  it('completeTodo rejects unknown, path-like and protected ids', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    for (const id of [
      'nope.md',
      '../clients/northwind/profile.md',
      'done/20260101-finished.md',
      'AGENTS.md',
      'README.md',
      '',
      'notes.txt',
      '/etc/passwd',
    ]) {
      await expect(brain.completeTodo(id, sam)).rejects.toThrow(/to-do/i);
    }
    expect(existsSync(join(root, 'todo', 'AGENTS.md'))).toBe(true);
  });

  it('completeTodo refuses to overwrite an existing finished file', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    writeFileSync(join(root, 'todo', 'done', '20261105-send-report.md'), 'older');
    await expect(brain.completeTodo('20261105-send-report.md', sam)).rejects.toThrow(/already/i);
    expect(existsSync(join(root, 'todo', '20261105-send-report.md'))).toBe(true);
    expect(readFileSync(join(root, 'todo', 'done', '20261105-send-report.md'), 'utf8')).toBe('older');
    expect(readFileSync(join(root, 'todo', '20261105-send-report.md'), 'utf8')).toBe(
      '---\nassignee: sam-example\n---\n# Send the monthly report\n',
    );
  });

  it('completeTodo leaves the to-do open, and nothing in done/, if the open copy cannot be removed', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    const unlink = vi.spyOn(fsPromises, 'unlink').mockRejectedValueOnce(new Error('EPERM'));
    try {
      await expect(brain.completeTodo('20261105-send-report.md', sam)).rejects.toThrow('EPERM');
    } finally {
      unlink.mockRestore();
    }
    expect(readFileSync(join(root, 'todo', '20261105-send-report.md'), 'utf8')).toBe(
      '---\nassignee: sam-example\n---\n# Send the monthly report\n',
    );
    expect(existsSync(join(root, 'todo', 'done', '20261105-send-report.md'))).toBe(false);
  });

  it('gives an empty list when todo/ is missing', async () => {
    const list = await createBrainReaders('/nonexistent/brain').todos(person('a', 'team'));
    expect(list).toEqual({ mine: [], open: [], othersCount: 0, team: [], changes: 'no-skill' });
  });
});

const madeLogs: string[] = [];
afterAll(() => {
  for (const d of madeLogs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Records argv and stdin in FAKE_TODO_LOG (outside the brain) and answers as FAKE_TODO_REPLY says. */
const FAKE_SCRIPT = `
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.FAKE_TODO_LOG, JSON.stringify({ command: process.argv[2], body: JSON.parse(input) }) + '\\n');
  const reply = JSON.parse(process.env.FAKE_TODO_REPLY || '{}');
  process.stdout.write(reply.out || '{"ok":true}');
  process.exitCode = reply.exit || 0;
});
`;

function addTodoSkill(root: string, roles = 'owner, scout', script: string | null = FAKE_SCRIPT): void {
  mkdirSync(join(root, '.claude', 'skills', 'todo', 'scripts'), { recursive: true });
  writeFileSync(
    join(root, '.claude', 'skills', 'todo', 'SKILL.md'),
    `---\ndescription: Add, edit, pass on, re-date or delete a to-do.\nroles: ${roles}\nmaturity: draft\n---\nBody.\n`,
  );
  if (script !== null) writeFileSync(join(root, TODO_SCRIPT), script);
}

function fakeEnv(reply: object = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tba-todo-log-'));
  madeLogs.push(dir);
  const log = join(dir, 'calls.jsonl');
  const env = { PATH: process.env.PATH, FAKE_TODO_LOG: log, FAKE_TODO_REPLY: JSON.stringify(reply) };
  const calls = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l) as { command: string; body: Record<string, unknown> })
      : [];
  return { env, calls };
}

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(TodoChangeError);
    return (err as TodoChangeError).code;
  }
}

describe('todos: what the editor needs', () => {
  it('reads created, source and the details below the frontmatter, trimmed', async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, 'todo', '20261112-call-ben.md'),
      '---\ntitle: Call Ben\nassignee: sam-example\ncreated: 2026-11-12\nsource: added from the Workbench\n---\n\n  First line.\n\nSecond line.\n\n',
    );
    const list = await createBrainReaders(root).todos(sam);
    const item = list.mine.find((t) => t.id === '20261112-call-ben.md');
    expect(item).toMatchObject({
      title: 'Call Ben',
      created: '2026-11-12',
      source: 'added from the Workbench',
      details: 'First line.\n\nSecond line.',
    });
    const report = list.mine.find((t) => t.id === '20261105-send-report.md');
    expect(report?.details).toBe('# Send the monthly report');
  });

  it('lists the team from roles.json in file order, with Workbench slugs', async () => {
    const list = await createBrainReaders(copyFixture()).todos(sam);
    expect(list.team).toEqual([
      { slug: 'sam-example', name: 'Sam Example' },
      { slug: 'alex-sample', name: 'Alex Sample' },
      { slug: 'jo-owner', name: 'Jo Owner' },
    ]);
  });

  it('skips team entries without a usable name, and slugs odd names the Workbench way', async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, '.team-config', 'roles.json'),
      JSON.stringify({
        members: [
          null,
          { name: '' },
          { name: '   ' },
          { name: 3 },
          { email: 'x@example.test' },
          { name: '!!!' },
          { name: "Jo O'Neil" },
          { name: '  Ben  McAdam ' },
          { name: 'Ben McAdam' },
        ],
      }),
    );
    expect((await createBrainReaders(root).todos(sam)).team).toEqual([
      { slug: 'jo-o-neil', name: "Jo O'Neil" },
      { slug: 'ben-mcadam', name: 'Ben  McAdam' },
    ]);
    writeFileSync(join(root, '.team-config', 'roles.json'), '{ not json');
    expect((await createBrainReaders(root).todos(sam)).team).toEqual([]);
  });

  it("says changes are 'on' for owners and scouts when the skill and its script are there", async () => {
    const root = copyFixture();
    addTodoSkill(root);
    const brain = createBrainReaders(root);
    expect((await brain.todos(person('jo-owner', 'owner'))).changes).toBe('on');
    expect((await brain.todos(sam)).changes).toBe('on');
  });

  it("says 'restricted' for a role the skill leaves out, including an unknown role", async () => {
    const root = copyFixture();
    addTodoSkill(root);
    const brain = createBrainReaders(root);
    expect((await brain.todos(person('alex-sample', 'team'))).changes).toBe('restricted');
    expect((await brain.todos(person('stranger', 'unknown'))).changes).toBe('restricted');
  });

  it("says 'no-skill' when the skill or its script is missing, or the script leads outside the brain", async () => {
    expect((await createBrainReaders(copyFixture()).todos(sam)).changes).toBe('no-skill');

    const noScript = copyFixture();
    addTodoSkill(noScript, 'owner, scout', null);
    expect((await createBrainReaders(noScript).todos(sam)).changes).toBe('no-skill');

    const linked = copyFixture();
    addTodoSkill(linked, 'owner, scout', null);
    const outside = mkdtempSync(join(tmpdir(), 'tba-outside-'));
    madeLogs.push(outside);
    writeFileSync(join(outside, 'todo.cjs'), FAKE_SCRIPT);
    symlinkSync(join(outside, 'todo.cjs'), join(linked, TODO_SCRIPT));
    expect((await createBrainReaders(linked).todos(sam)).changes).toBe('no-skill');
  });
});

describe('changeTodo', () => {
  function brainWithSkill(reply: object = {}, roles?: string) {
    const root = copyFixture();
    addTodoSkill(root, roles);
    const fake = fakeEnv(reply);
    return { root, brain: createBrainReaders(root, { todoSkill: { env: fake.env } }), calls: fake.calls };
  }

  it('runs the script for a listed to-do (mine or open) and for an add', async () => {
    const { brain, calls } = brainWithSkill();
    await brain.changeTodo(
      { kind: 'edit', id: '20261105-send-report.md', title: 'Send it', details: 'Soon' },
      sam,
    );
    await brain.changeTodo({ kind: 'assignee', id: '20261103-open-task.md', assignee: 'sam-example' }, sam);
    await brain.changeTodo(
      { kind: 'add', title: 'Call Ben', due: '2026-11-20', assignee: 'sam-example' },
      sam,
    );
    await brain.changeTodo({ kind: 'due', id: '20261101-renew-contract.md', due: null }, sam);
    await brain.changeTodo({ kind: 'delete', id: '20261010-undated-thing.md' }, sam);
    expect(calls()).toEqual([
      { command: 'edit', body: { file: '20261105-send-report.md', title: 'Send it', body: 'Soon' } },
      { command: 'assignee', body: { file: '20261103-open-task.md', assignee: 'sam-example' } },
      { command: 'add', body: { title: 'Call Ben', due: '2026-11-20', assignee: 'sam-example' } },
      { command: 'due', body: { file: '20261101-renew-contract.md', due: '' } },
      {
        command: 'delete',
        body: {
          file: '20261010-undated-thing.md',
          via: 'TDS Brain App',
          by: 'sam-example',
          by_name: 'sam-example',
        },
      },
    ]);
  });

  it("refuses with not-allowed, before anything runs, unless changes are 'on'", async () => {
    const restricted = brainWithSkill();
    const alex = person('alex-sample', 'team');
    expect(
      await codeOf(restricted.brain.changeTodo({ kind: 'delete', id: '20261102-alex-task.md' }, alex)),
    ).toBe('not-allowed');
    const noSkill = createBrainReaders(copyFixture());
    expect(
      await codeOf(noSkill.changeTodo({ kind: 'add', title: 'x', due: null, assignee: 'sam-example' }, sam)),
    ).toBe('not-allowed');
    expect(restricted.calls()).toEqual([]);
  });

  it("refuses an id that isn't listed for this person: someone else's, finished, protected or unknown", async () => {
    const { brain, calls } = brainWithSkill();
    for (const id of [
      '20261102-alex-task.md',
      '20260101-finished.md',
      'AGENTS.md',
      'README.md',
      'nope.md',
      'done/20260101-finished.md',
    ]) {
      const code = await codeOf(brain.changeTodo({ kind: 'delete', id }, sam));
      expect(code === 'not-found' || code === 'bad-request', id).toBe(true);
    }
    expect(await codeOf(brain.changeTodo({ kind: 'delete', id: '20261102-alex-task.md' }, sam))).toBe(
      'not-found',
    );
    expect(calls()).toEqual([]);
  });

  it('refuses bad titles, details, assignees, dates and ids without running anything', async () => {
    const { brain, calls } = brainWithSkill();
    const id = '20261105-send-report.md';
    const bad: TodoAction[] = [
      { kind: 'add', title: '', due: null, assignee: 'sam-example' },
      { kind: 'add', title: '   ', due: null, assignee: 'sam-example' },
      { kind: 'add', title: 'x'.repeat(201), due: null, assignee: 'sam-example' },
      { kind: 'add', title: 'ok', due: '2026-13-01', assignee: 'sam-example' },
      { kind: 'add', title: 'ok', due: '2026-02-30', assignee: 'sam-example' },
      { kind: 'add', title: 'ok', due: '20261120', assignee: 'sam-example' },
      { kind: 'add', title: 'ok', due: null, assignee: 'Sam Example' },
      { kind: 'add', title: 'ok', due: null, assignee: '' },
      { kind: 'add', title: 'ok', due: null, assignee: 'a'.repeat(41) },
      { kind: 'add', title: 'ok', due: null, assignee: '-sam' },
      { kind: 'edit', id, title: '' },
      { kind: 'edit', id, title: 'ok', details: 'x'.repeat(8001) },
      { kind: 'due', id, due: 'tomorrow' },
      { kind: 'assignee', id, assignee: 'sam--example' },
      { kind: 'delete', id: '../clients/northwind/profile.md' },
      { kind: 'delete', id: '.hidden.md' },
      { kind: 'delete', id: 'notes.txt' },
      { kind: 'nope' } as unknown as TodoAction,
      { kind: 'add', title: 7, due: null, assignee: 'sam-example' } as unknown as TodoAction,
    ];
    for (const action of bad) {
      expect(await codeOf(brain.changeTodo(action, sam)), JSON.stringify(action).slice(0, 80)).toBe(
        'bad-request',
      );
    }
    expect(calls()).toEqual([]);
  });

  it('accepts the limits exactly, and a title with spaces round it', async () => {
    const { brain, calls } = brainWithSkill();
    await brain.changeTodo(
      { kind: 'add', title: ` ${'x'.repeat(200)} `, due: null, assignee: 'a'.repeat(40) },
      sam,
    );
    await brain.changeTodo(
      { kind: 'edit', id: '20261105-send-report.md', title: 'ok', details: 'x'.repeat(8000) },
      sam,
    );
    expect(calls()).toHaveLength(2);
  });

  it("passes on the script's refusals as the app's own errors", async () => {
    const missing = brainWithSkill({ exit: 2, out: '{"error":"not found","status":404}' });
    expect(
      await codeOf(missing.brain.changeTodo({ kind: 'delete', id: '20261105-send-report.md' }, sam)),
    ).toBe('not-found');
    const bad = brainWithSkill({ exit: 2, out: '{"error":"bad due","status":400}' });
    expect(await codeOf(bad.brain.changeTodo({ kind: 'delete', id: '20261105-send-report.md' }, sam))).toBe(
      'bad-request',
    );
  });
});
