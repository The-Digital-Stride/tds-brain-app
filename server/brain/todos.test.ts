import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  promises as fsPromises,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { TODO_SCRIPT, type TodoAction, TodoChangeError } from '../../shared/contract.ts';
import { TODO_PROJECT_CAPABILITY } from '../../shared/projects-contract.ts';
import { createBrainReaders } from './index.ts';
import type { ProjectsIndex } from './projects.ts';
import { copyFixture, person } from './test-helpers.ts';
import { TODO_ATTACH_CAPABILITY } from './todo-skill.ts';
import { changeTodo, listTodos } from './todos.ts';

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
    const fixtureRoot = copyFixture();
    const brain = createBrainReaders(fixtureRoot);
    const list = await brain.todos(person('sam-example', 'scout'));
    const byId = Object.fromEntries(list.mine.map((t) => [t.id, t]));
    expect(byId['20261101-renew-contract.md']).toEqual({
      id: '20261101-renew-contract.md',
      scope: 'tds',
      key: '20261101-renew-contract.md',
      path: 'todo/20261101-renew-contract.md',
      handover: null,
      createdBy: null,
      title: 'Renew the Acme contract',
      assignee: 'sam-example',
      due: '2026-11-20',
      surfaceDate: '2026-11-01',
      project: 'renewals',
      client: 'acme-heating',
      stage: null,
      projectMatch: expect.objectContaining({ how: expect.any(String) }),
      created: null,
      source: null,
      details: '',
      version: createHash('sha256')
        .update(readFileSync(join(fixtureRoot, 'todo', '20261101-renew-contract.md')))
        .digest('hex'),
      attachments: [],
      updates: [],
      updatesMore: false,
      updateExtras: [],
      links: [],
      lastChange: null,
      createdAt: null,
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
        'completed_via: TDS Cortex',
        '---',
        '# Send the monthly report',
        '',
        '## Done 2026-11-11',
        '',
        'Ticked off by Sam Example at 17:07 UK time (TDS Cortex).',
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
      await expect(brain.completeTodo(id, sam)).rejects.toThrow(/task/i);
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

  it('completeTodo leaves the task open, and nothing in done/, if the open copy cannot be removed', async () => {
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
    expect(list).toEqual({
      mine: [],
      open: [],
      othersCount: 0,
      team: [],
      changes: 'no-skill',
      canAddOpen: false,
      canUsePersonal: false,
      canAttach: false,
      canUpload: false,
      canProject: false,
      canUpdate: false,
      canLink: false,
    });
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
  if (process.argv[2] === 'capabilities') {
    if (process.env.FAKE_TODO_CAPS) { process.stdout.write(JSON.stringify({ version: '0.4', features: JSON.parse(process.env.FAKE_TODO_CAPS) })); return; }
    process.stdout.write('{"ok":false,"status":400,"error":"unknown command"}'); process.exitCode = 2; return;
  }
  fs.appendFileSync(process.env.FAKE_TODO_LOG, JSON.stringify({ command: process.argv[2], body: JSON.parse(input) }) + '\\n');
  const reply = JSON.parse(process.env.FAKE_TODO_REPLY || '{}');
  process.stdout.write(reply.out || '{"ok":true}');
  process.exitCode = reply.exit || 0;
});
`;

function addTodoSkill(
  root: string,
  roles = 'owner, scout',
  script: string | null = FAKE_SCRIPT,
  skill = 'tdsapp-todo',
): void {
  const scriptName = skill === 'tdsapp-todo' ? 'tdsapp-todo.cjs' : 'todo.cjs';
  mkdirSync(join(root, '.claude', 'skills', skill, 'scripts'), { recursive: true });
  writeFileSync(
    join(root, '.claude', 'skills', skill, 'SKILL.md'),
    `---\ndescription: Add, edit, pass on, re-date or delete a task.\nroles: ${roles}\nmaturity: draft\n---\nBody.\n`,
  );
  if (script !== null) writeFileSync(join(root, '.claude', 'skills', skill, 'scripts', scriptName), script);
}

function fakeEnv(reply: object = {}, caps?: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'tba-todo-log-'));
  madeLogs.push(dir);
  const log = join(dir, 'calls.jsonl');
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    FAKE_TODO_LOG: log,
    FAKE_TODO_REPLY: JSON.stringify(reply),
  };
  if (caps) env.FAKE_TODO_CAPS = JSON.stringify(caps);
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

  it('runs the script for a listed task (mine or open) and for an add', async () => {
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
      {
        command: 'edit',
        body: {
          file: '20261105-send-report.md',
          title: 'Send it',
          body: 'Soon',
          by: 'sam-example',
          by_name: 'sam-example',
          via: 'TDS Cortex',
        },
      },
      {
        command: 'assignee',
        body: {
          file: '20261103-open-task.md',
          assignee: 'sam-example',
          via: 'TDS Cortex',
          by: 'sam-example',
          by_name: 'sam-example',
        },
      },
      {
        command: 'add',
        body: {
          title: 'Call Ben',
          due: '2026-11-20',
          assignee: 'sam-example',
          via: 'TDS Cortex',
          by: 'sam-example',
          by_name: 'sam-example',
        },
      },
      {
        command: 'due',
        body: {
          file: '20261101-renew-contract.md',
          due: '',
          by: 'sam-example',
          by_name: 'sam-example',
          via: 'TDS Cortex',
        },
      },
      {
        command: 'delete',
        body: {
          file: '20261010-undated-thing.md',
          via: 'TDS Cortex',
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

describe('todos: version and the skill found', () => {
  const FILE = '20261105-send-report.md';

  it('version is the SHA-256 of the raw bytes, even when they are not valid UTF-8', async () => {
    const root = copyFixture();
    const bytes = Buffer.concat([
      Buffer.from('---\nassignee: sam-example\n---\n# Caf'),
      Buffer.from([0xe9, 0xff, 0xfe]),
      Buffer.from('\n'),
    ]);
    writeFileSync(join(root, 'todo', FILE), bytes);
    const item = (await createBrainReaders(root).todos(sam)).mine.find((t) => t.id === FILE);
    expect(item?.version).toBe(createHash('sha256').update(bytes).digest('hex'));
    // Hashing the decoded text would give a different answer: the bytes were not valid UTF-8.
    expect(item?.version).not.toBe(createHash('sha256').update(bytes.toString('utf8')).digest('hex'));
    expect(item?.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it('version changes when the file changes', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    const before = (await brain.todos(sam)).mine.find((t) => t.id === FILE)?.version;
    writeFileSync(join(root, 'todo', FILE), '---\nassignee: sam-example\n---\n# Changed\n');
    const after = (await brain.todos(sam)).mine.find((t) => t.id === FILE)?.version;
    expect(after).not.toBe(before);
  });

  it('canAddOpen is true only for tdsapp-todo with changes on', async () => {
    const newer = copyFixture();
    addTodoSkill(newer);
    expect(await createBrainReaders(newer).todos(sam)).toMatchObject({ changes: 'on', canAddOpen: true });

    const older = copyFixture();
    addTodoSkill(older, 'owner, scout', FAKE_SCRIPT, 'todo');
    expect(await createBrainReaders(older).todos(sam)).toMatchObject({ changes: 'on', canAddOpen: false });

    const none = copyFixture();
    expect(await createBrainReaders(none).todos(sam)).toMatchObject({
      changes: 'no-skill',
      canAddOpen: false,
    });
  });

  it('tdsapp-todo wins over todo, and a restricted tdsapp-todo does not fall back to todo', async () => {
    const both = copyFixture();
    addTodoSkill(both, 'owner', FAKE_SCRIPT, 'todo');
    addTodoSkill(both, 'owner, scout', FAKE_SCRIPT, 'tdsapp-todo');
    expect((await createBrainReaders(both).todos(sam)).changes).toBe('on');

    const restricted = copyFixture();
    addTodoSkill(restricted, 'owner', FAKE_SCRIPT, 'tdsapp-todo');
    addTodoSkill(restricted, 'owner, scout', FAKE_SCRIPT, 'todo');
    expect(await createBrainReaders(restricted).todos(sam)).toMatchObject({
      changes: 'restricted',
      canAddOpen: false,
    });
  });

  it('tdsapp-todo present without its script does not fall back to todo', async () => {
    const root = copyFixture();
    addTodoSkill(root, 'owner, scout', null, 'tdsapp-todo');
    addTodoSkill(root, 'owner, scout', FAKE_SCRIPT, 'todo');
    expect(await createBrainReaders(root).todos(sam)).toMatchObject({
      changes: 'no-skill',
      canAddOpen: false,
    });
  });
});

describe('changeTodo: expect, open adds and the older skill', () => {
  const FILE = '20261105-send-report.md';

  function setup(skill = 'tdsapp-todo', reply: object = {}) {
    const root = copyFixture();
    addTodoSkill(root, 'owner, scout', FAKE_SCRIPT, skill);
    const fake = fakeEnv(reply);
    const brain = createBrainReaders(root, { todoSkill: { env: fake.env } });
    const version = async () => (await brain.todos(sam)).mine.find((t) => t.id === FILE)?.version ?? '';
    return { root, brain, calls: fake.calls, version };
  }

  it('passes a matching expect to the script', async () => {
    const { brain, calls, version } = setup();
    const expectV = await version();
    await brain.changeTodo({ kind: 'due', id: FILE, due: '2026-12-01', expect: expectV }, sam);
    expect(calls()).toEqual([
      {
        command: 'due',
        body: {
          file: FILE,
          due: '2026-12-01',
          expect: expectV,
          by: 'sam-example',
          by_name: 'sam-example',
          via: 'TDS Cortex',
        },
      },
    ]);
  });

  it("refuses with 'changed' before anything runs when the version differs", async () => {
    const { root, brain, calls, version } = setup();
    const stale = await version();
    writeFileSync(join(root, 'todo', FILE), '---\nassignee: sam-example\n---\n# Edited by someone\n');
    expect(
      await codeOf(brain.changeTodo({ kind: 'edit', id: FILE, title: 'Mine', expect: stale }, sam)),
    ).toBe('changed');
    expect(calls()).toEqual([]);
  });

  it('refuses a malformed expect as bad-request', async () => {
    const { brain, calls } = setup();
    for (const expectV of ['', 'abc', 'A'.repeat(64), 'a'.repeat(63), 5 as unknown as string]) {
      expect(await codeOf(brain.changeTodo({ kind: 'delete', id: FILE, expect: expectV }, sam))).toBe(
        'bad-request',
      );
    }
    expect(calls()).toEqual([]);
  });

  it("maps the script's own 409 to 'changed'", async () => {
    const { brain, version } = setup('tdsapp-todo', {
      exit: 2,
      out: '{"error":"changed since read","status":409}',
    });
    expect(await codeOf(brain.changeTodo({ kind: 'delete', id: FILE, expect: await version() }, sam))).toBe(
      'changed',
    );
  });

  it('adds open to anyone only when canAddOpen', async () => {
    const newer = setup('tdsapp-todo');
    await newer.brain.changeTodo({ kind: 'add', title: 'Anyone', due: null, assignee: null }, sam);
    expect(newer.calls()).toEqual([
      {
        command: 'add',
        body: {
          title: 'Anyone',
          due: '',
          open: true,
          via: 'TDS Cortex',
          by: 'sam-example',
          by_name: 'sam-example',
        },
      },
    ]);

    const older = setup('todo');
    expect(
      await codeOf(older.brain.changeTodo({ kind: 'add', title: 'Anyone', due: null, assignee: null }, sam)),
    ).toBe('bad-request');
    expect(older.calls()).toEqual([]);
  });

  it('still works with the older todo skill: runs its script, and the server check still protects', async () => {
    const { root, brain, calls, version } = setup('todo');
    const v = await version();
    await brain.changeTodo({ kind: 'edit', id: FILE, title: 'New', expect: v }, sam);
    expect(calls()).toEqual([
      {
        command: 'edit',
        body: {
          file: FILE,
          title: 'New',
          expect: v,
          by: 'sam-example',
          by_name: 'sam-example',
          via: 'TDS Cortex',
        },
      },
    ]);
    writeFileSync(join(root, 'todo', FILE), '---\nassignee: sam-example\n---\n# Edited by someone\n');
    expect(await codeOf(brain.changeTodo({ kind: 'delete', id: FILE, expect: v }, sam))).toBe('changed');
    expect(calls()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Scope, handover and the personal gate (plan 2026-11-13-todo-handover-search-scope)
// ---------------------------------------------------------------------------

const EX = (root: string, folder: string, id: string) =>
  createHash('sha256')
    .update(readFileSync(join(root, folder, id)))
    .digest('hex');

function personalFile(root: string, id: string, text: string): void {
  mkdirSync(join(root, 'personal', 'todo'), { recursive: true });
  writeFileSync(join(root, 'personal', 'todo', id), text);
}

describe('personal tasks: listing', () => {
  it('lists personal files with scope, key and path, in mine only, never open or othersCount', async () => {
    const root = copyFixture();
    personalFile(
      root,
      '20261110-dentist.md',
      '---\ntitle: Book dentist\nassignee: sam-example\ncreated_by: sam-example\n---\n',
    );
    personalFile(root, 'notes.md', '# private notes, no frontmatter\n');
    personalFile(root, '20261110-open.md', '---\ntitle: Nobody\n---\n');
    personalFile(root, '20261110-alex.md', '---\nassignee: alex-sample\n---\n');
    const before = await createBrainReaders(copyFixture()).todos(sam);
    const list = await createBrainReaders(root).todos(sam);
    const p = list.mine.find((t) => t.scope === 'personal');
    expect(list.mine.filter((t) => t.scope === 'personal')).toHaveLength(1);
    expect(p).toMatchObject({
      id: '20261110-dentist.md',
      key: 'personal/20261110-dentist.md',
      path: 'personal/todo/20261110-dentist.md',
      title: 'Book dentist',
      createdBy: 'sam-example',
      handover: null,
    });
    expect(p?.version).toBe(EX(root, 'personal/todo', '20261110-dentist.md'));
    expect(list.open.every((t) => t.scope === 'tds')).toBe(true);
    expect(list.open).toEqual(before.open);
    expect(list.othersCount).toBe(before.othersCount);
  });

  it('does not read personal/ itself when it is a symlink', async () => {
    const root = copyFixture();
    const outside = mkdtempSync(join(tmpdir(), 'tba-outside-'));
    madeLogs.push(outside);
    mkdirSync(join(outside, 'todo'), { recursive: true });
    writeFileSync(join(outside, 'todo', 'x.md'), '---\nassignee: sam-example\n---\n# X\n');
    rmSync(join(root, 'personal'), { recursive: true, force: true });
    symlinkSync(outside, join(root, 'personal'));
    const list = await createBrainReaders(root).todos(sam);
    expect(list.mine.some((t) => t.scope === 'personal')).toBe(false);
  });

  it('does not read a personal/todo that is a symlink, and lists nothing without the folder', async () => {
    const root = copyFixture();
    const outside = mkdtempSync(join(tmpdir(), 'tba-outside-'));
    madeLogs.push(outside);
    writeFileSync(join(outside, 'x.md'), '---\nassignee: sam-example\n---\n# X\n');
    mkdirSync(join(root, 'personal'), { recursive: true });
    symlinkSync(outside, join(root, 'personal', 'todo'));
    const list = await createBrainReaders(root).todos(sam);
    expect(list.mine.some((t) => t.scope === 'personal')).toBe(false);
    expect((await createBrainReaders(copyFixture()).todos(sam)).mine.every((t) => t.scope === 'tds')).toBe(
      true,
    );
  });

  it('keeps TDS ids as bare keys and paths under todo/', async () => {
    const list = await createBrainReaders(copyFixture()).todos(sam);
    for (const t of [...list.mine, ...list.open]) {
      expect(t.key).toBe(t.id);
      expect(t.path).toBe(`todo/${t.id}`);
    }
  });
});

describe('handover', () => {
  const ben = '2026-11-12T10:30:00+00:00';
  const gitOf = (
    name: string,
    email: string,
    patch = '',
  ): { run: (...a: unknown[]) => Promise<string>; calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      run: async (args: unknown) => {
        calls.push((args as string[]).at(-1) as string);
        return `${name}\0${email}\0${ben}\n${patch}`;
      },
    };
  };

  it('uses the stamp when assigned_to is the current assignee, naming the roster name', async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, 'todo', '20261112-stamped.md'),
      '---\nassignee: sam-example\nassigned_to: sam-example\nassigned_at: 2026-11-12T09:00:00+00:00\nassigned_by: alex-sample\nassigned_from: open\nassigned_via: TDS Cortex\n---\n# S\n',
    );
    const git = gitOf(
      'Zed',
      'z@example.test',
      '+assignee: sam-example\n+assigned_at: 2026-11-12T09:00:00+00:00\n',
    );
    const list = await createBrainReaders(root, { todoGit: git.run }).todos(sam);
    expect(list.mine.find((t) => t.id === '20261112-stamped.md')?.handover).toEqual({
      by: 'alex-sample',
      byName: 'Alex Sample',
      at: '2026-11-12T09:00:00+00:00',
      from: 'open',
      via: 'TDS Cortex',
      source: 'stamp',
    });
    expect(git.calls).toContain('todo/20261112-stamped.md');
  });

  it('drops a stamp that the last assignee commit did not write (a Workbench round trip)', async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, 'todo', '20261112-roundtrip.md'),
      '---\nassignee: sam-example\nassigned_to: sam-example\nassigned_at: 2026-11-10T09:00:00+00:00\nassigned_by: alex-sample\n---\n# R\n',
    );
    const git = gitOf('Jo Owner', 'jo@example.test', '-assignee: jo-owner\n+assignee: sam-example\n');
    const list = await createBrainReaders(root, { todoGit: git.run }).todos(sam);
    expect(list.mine.find((t) => t.id === '20261112-roundtrip.md')?.handover).toMatchObject({
      by: 'jo-owner',
      source: 'history',
    });
  });

  it('keeps a stamp newer than the last assignee commit (not committed yet)', async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, 'todo', '20261112-fresh.md'),
      '---\nassignee: sam-example\nassigned_to: sam-example\nassigned_at: 2026-11-12T11:00:00+00:00\nassigned_by: alex-sample\n---\n# F\n',
    );
    const git = gitOf('Jo Owner', 'jo@example.test', '-assignee: jo-owner\n+assignee: sam-example\n');
    const list = await createBrainReaders(root, { todoGit: git.run }).todos(sam);
    expect(list.mine.find((t) => t.id === '20261112-fresh.md')?.handover).toMatchObject({
      by: 'alex-sample',
      source: 'stamp',
    });
  });

  it('keeps the stamp when git has no answer', async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, 'todo', '20261112-kept.md'),
      '---\nassignee: sam-example\nassigned_to: sam-example\nassigned_at: 2026-11-10T09:00:00+00:00\nassigned_by: alex-sample\n---\n# K\n',
    );
    const list = await createBrainReaders(root, {
      todoGit: async () => Promise.reject(new Error('x')),
    }).todos(sam);
    expect(list.mine.find((t) => t.id === '20261112-kept.md')?.handover?.source).toBe('stamp');
  });

  it('starts at most 30 uncached git lookups per list; the rest fill in on a later load', async () => {
    const root = copyFixture();
    for (let i = 0; i < 40; i++)
      writeFileSync(
        join(root, 'todo', `20261101-bulk-${i}.md`),
        `---\nassignee: sam-example\n---\n# B${i}\n`,
      );
    const git = gitOf('Alex Sample', 'alex@example.test');
    const brain = createBrainReaders(root, { todoGit: git.run });
    const first = await brain.todos(sam);
    expect(git.calls).toHaveLength(30);
    expect(first.mine.filter((t) => t.handover !== null)).toHaveLength(30);
    const second = await brain.todos(sam);
    expect(git.calls.length).toBeGreaterThan(30);
    expect(git.calls.length).toBeLessThanOrEqual(60);
    expect(second.mine.filter((t) => t.handover !== null).length).toBeGreaterThan(30);
  });

  it('reads an open stamp (assigned_to: open) for an open task', async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, 'todo', '20261112-released.md'),
      '---\nassigned_to: open\nassigned_at: 2026-11-12T09:00:00+00:00\nassigned_by: alex-sample\nassigned_from: sam-example\n---\n# R\n',
    );
    const list = await createBrainReaders(root).todos(sam);
    const h = list.open.find((t) => t.id === '20261112-released.md')?.handover;
    expect(h).toMatchObject({ by: 'alex-sample', from: 'sam-example', source: 'stamp' });
  });

  it('ignores a stale stamp and falls back to git, mapping the author by email first', async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, 'todo', '20261112-stale.md'),
      '---\nassignee: sam-example\nassigned_to: jo-owner\nassigned_at: 2026-11-01T09:00:00+00:00\nassigned_by: jo-owner\n---\n# S\n',
    );
    // The name says Jo, the email says Alex: the email wins.
    const git = gitOf('Jo Owner', 'alex@example.test');
    const list = await createBrainReaders(root, { todoGit: git.run }).todos(sam);
    expect(list.mine.find((t) => t.id === '20261112-stale.md')?.handover).toEqual({
      by: 'alex-sample',
      byName: 'Alex Sample',
      at: ben,
      from: null,
      via: null,
      source: 'history',
    });
  });

  it('maps by name slug when the email is unknown, and keeps an unmatched name as written', async () => {
    const root = copyFixture();
    const byName = await createBrainReaders(root, {
      todoGit: gitOf('Alex Sample', 'other@x.test').run,
    }).todos(sam);
    expect(byName.mine[0]?.handover).toMatchObject({ by: 'alex-sample', byName: 'Alex Sample' });
    const stranger = await createBrainReaders(root, { todoGit: gitOf('Zed Zed', 'z@x.test').run }).todos(sam);
    expect(stranger.mine[0]?.handover).toMatchObject({ by: null, byName: 'Zed Zed', source: 'history' });
  });

  it('is null when git resolves to the current person, on failure, and for open, others and personal tasks', async () => {
    const root = copyFixture();
    personalFile(root, '20261110-dentist.md', '---\nassignee: sam-example\n---\n');
    const self = gitOf('Sam Example', 'sam@example.test');
    const own = await createBrainReaders(root, { todoGit: self.run }).todos(sam);
    expect(own.mine.every((t) => t.handover === null)).toBe(true);
    const failing = await createBrainReaders(root, {
      todoGit: async () => Promise.reject(new Error('no git')),
    }).todos(sam);
    expect(failing.mine.every((t) => t.handover === null)).toBe(true);
    const asked = gitOf('Alex Sample', 'alex@example.test');
    const list = await createBrainReaders(root, { todoGit: asked.run }).todos(sam);
    // Only TDS tasks in mine are looked up.
    expect(asked.calls.every((c) => c.startsWith('todo/'))).toBe(true);
    expect(asked.calls).toHaveLength(list.mine.filter((t) => t.scope === 'tds').length);
    expect(list.open.every((t) => t.handover === null)).toBe(true);
    expect(list.mine.find((t) => t.scope === 'personal')?.handover).toBeNull();
  });

  it('matches the current person by email when the author is not in the roster', async () => {
    const root = copyFixture();
    const me = { ...sam, email: 'me@elsewhere.test' };
    const list = await createBrainReaders(root, { todoGit: gitOf('Someone', 'me@elsewhere.test').run }).todos(
      me,
    );
    expect(list.mine.every((t) => t.handover === null)).toBe(true);
  });
});

describe('changeTodo: personal scope', () => {
  function brain(caps: string[] | null = ['handover', 'scope'], reply: object = {}) {
    const root = copyFixture();
    addTodoSkill(root);
    personalFile(root, '20261110-dentist.md', '---\ntitle: Book dentist\nassignee: sam-example\n---\n');
    // The same file name in both folders, to prove scope + id decide.
    personalFile(root, '20261105-send-report.md', '---\ntitle: Private report\nassignee: sam-example\n---\n');
    const fake = fakeEnv(reply, caps ?? undefined);
    return { root, brain: createBrainReaders(root, { todoSkill: { env: fake.env } }), calls: fake.calls };
  }
  const dentist = (root: string) => EX(root, 'personal/todo', '20261110-dentist.md');

  it("sets canUsePersonal only when changes are on and the script advertises 'scope'", async () => {
    expect((await brain().brain.todos(sam)).canUsePersonal).toBe(true);
    expect((await brain(['handover']).brain.todos(sam)).canUsePersonal).toBe(false);
    expect((await brain(null).brain.todos(sam)).canUsePersonal).toBe(false);
    const root = copyFixture();
    expect((await createBrainReaders(root).todos(sam)).canUsePersonal).toBe(false);
  });

  it('refuses every personal action with not-allowed unless the gate is open, running nothing', async () => {
    const { root, brain: b, calls } = brain(['handover']);
    const x = dentist(root);
    for (const action of [
      { kind: 'edit', id: '20261110-dentist.md', title: 'T', scope: 'personal', expect: x },
      { kind: 'move', id: '20261110-dentist.md', scope: 'personal', to: 'tds', expect: x },
      { kind: 'add', title: 'T', due: null, assignee: 'sam-example', scope: 'personal' },
    ] as TodoAction[]) {
      expect(await codeOf(b.changeTodo(action, sam)), JSON.stringify(action)).toBe('not-allowed');
    }
    expect(calls()).toEqual([]);
  });

  it('on an older script, refuses moving a task in a personal project to TDS, running nothing', async () => {
    const { root, brain: b, calls } = brain(['handover', 'scope']);
    personalFile(
      root,
      '20261111-jev.md',
      '---\ntitle: Jev plan\nassignee: sam-example\nproject: personal/jev\n---\n',
    );
    const x = EX(root, 'personal/todo', '20261111-jev.md');
    const got = await codeOf(
      b.changeTodo({ kind: 'move', id: '20261111-jev.md', scope: 'personal', to: 'tds', expect: x }, sam),
    );
    expect(got).toBe('not-allowed');
    expect(calls()).toEqual([]);
    // A task in no project still moves on the older script.
    await b.changeTodo(
      { kind: 'move', id: '20261110-dentist.md', scope: 'personal', to: 'tds', expect: dentist(root) },
      sam,
    );
    expect(calls()).toHaveLength(1);
  });

  it('needs expect on personal actions with an id, and the right values', async () => {
    const { root, brain: b, calls } = brain();
    const x = dentist(root);
    const id = '20261110-dentist.md';
    const bad: TodoAction[] = [
      { kind: 'edit', id, title: 'T', scope: 'personal' },
      { kind: 'delete', id, scope: 'personal' },
      { kind: 'move', id, scope: 'personal', to: 'tds' },
      { kind: 'move', id, scope: 'personal', to: 'personal', expect: x },
      { kind: 'move', id, scope: 'nope' as never, to: 'tds', expect: x },
      { kind: 'edit', id, title: 'T', scope: 'elsewhere' as never, expect: x },
      { kind: 'assignee', id, assignee: 'alex-sample', scope: 'personal', expect: x },
      { kind: 'add', title: 'T', due: null, assignee: 'alex-sample', scope: 'personal' },
      { kind: 'add', title: 'T', due: null, assignee: null, scope: 'personal' },
    ];
    for (const action of bad)
      expect(await codeOf(b.changeTodo(action, sam)), JSON.stringify(action)).toBe('bad-request');
    expect(calls()).toEqual([]);
  });

  it('matches by scope and id: the same file name in both folders', async () => {
    const { root, brain: b, calls } = brain();
    const id = '20261105-send-report.md';
    const tdsVersion = EX(root, 'todo', id);
    const personalVersion = EX(root, 'personal/todo', id);
    expect(tdsVersion).not.toBe(personalVersion);
    // Absent scope = TDS: the personal version is a conflict, the TDS one goes through.
    expect(await codeOf(b.changeTodo({ kind: 'edit', id, title: 'T', expect: personalVersion }, sam))).toBe(
      'changed',
    );
    expect(
      await codeOf(
        b.changeTodo({ kind: 'edit', id, title: 'T', scope: 'personal', expect: tdsVersion }, sam),
      ),
    ).toBe('changed');
    expect(await codeOf(b.changeTodo({ kind: 'edit', id, title: 'T', expect: tdsVersion }, sam))).toBeNull();
    expect(
      await codeOf(
        b.changeTodo({ kind: 'edit', id, title: 'T', scope: 'personal', expect: personalVersion }, sam),
      ),
    ).toBeNull();
    expect(calls().map((c) => c.body.scope)).toEqual([undefined, 'personal']);
    // A personal id that is not in personal/todo is not found, even though a TDS file has that name.
    expect(
      await codeOf(
        b.changeTodo(
          {
            kind: 'delete',
            id: '20261101-renew-contract.md',
            scope: 'personal',
            expect: EX(root, 'todo', '20261101-renew-contract.md'),
          },
          sam,
        ),
      ),
    ).toBe('not-found');
  });

  it("answers a move with moved {from, to}, using the script's file name", async () => {
    const {
      root,
      brain: b,
      calls,
    } = brain(['handover', 'scope'], { out: '{"ok":true,"file":"20261110-dentist-2.md"}' });
    const result = await b.changeTodo(
      { kind: 'move', id: '20261110-dentist.md', scope: 'personal', to: 'tds', expect: dentist(root) },
      sam,
    );
    expect(result).toEqual({ moved: { from: 'personal/20261110-dentist.md', to: '20261110-dentist-2.md' } });
    expect(calls()[0]).toMatchObject({
      command: 'move',
      body: {
        file: '20261110-dentist.md',
        scope: 'personal',
        to: 'tds',
        expect: dentist(root),
        by: 'sam-example',
      },
    });
  });

  it('moves a TDS task to personal, keyed under personal/', async () => {
    const { root, brain: b } = brain();
    const id = '20261101-renew-contract.md';
    const result = await b.changeTodo(
      { kind: 'move', id, scope: 'tds', to: 'personal', expect: EX(root, 'todo', id) },
      sam,
    );
    expect(result).toEqual({ moved: { from: id, to: `personal/${id}` } });
  });

  it('runs a personal tick through the script with scope', async () => {
    const { root, brain: b, calls } = brain();
    await b.completePersonalTodo('20261110-dentist.md', dentist(root), sam);
    expect(calls()[0]).toMatchObject({
      command: 'tick',
      body: { file: '20261110-dentist.md', scope: 'personal' },
    });
  });
});

describe('changeTodo with the real v0.4 script', () => {
  const REAL = join(
    import.meta.dirname,
    '..',
    '..',
    'brain-skills',
    'tdsapp-todo',
    'scripts',
    'tdsapp-todo.cjs',
  );
  const me = { ...person('sam-example', 'scout'), name: 'Sam Example' };

  /** A git brain whose git user.name ("Sam") is not the identity's name ("Sam Example"). */
  function realBrain() {
    const root = copyFixture();
    const home = mkdtempSync(join(tmpdir(), 'tba-home-'));
    madeLogs.push(home);
    const git = (...args: string[]) =>
      spawnSync('git', args, { cwd: root, env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.name', 'Sam');
    git('config', 'user.email', 'sam@example.test');
    writeFileSync(join(root, '.gitignore'), 'personal/todo/\n');
    addTodoSkill(root, 'owner, scout', readFileSync(REAL, 'utf8'));
    const brain = createBrainReaders(root, {
      todoSkill: { env: { PATH: process.env.PATH, HOME: home } },
      todoGit: async () => Promise.reject(new Error('no history here')),
    });
    return { root, brain };
  }

  it('adds a personal task for the person using the app, whatever git calls them', async () => {
    const { root, brain } = realBrain();
    expect((await brain.todos(me)).canUsePersonal).toBe(true);
    await brain.changeTodo(
      { kind: 'add', title: 'Book dentist', due: null, assignee: 'sam-example', scope: 'personal' },
      me,
    );
    const files = readdirSync(join(root, 'personal', 'todo')).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(1);
    const text = readFileSync(join(root, 'personal', 'todo', files[0] as string), 'utf8');
    expect(text).toContain('assignee: sam-example');
    const list = await brain.todos(me);
    expect(list.mine.find((t) => t.scope === 'personal')?.title).toBe('Book dentist');
  });

  it('a TDS add for yourself is created_by you and is not "from" anyone else', async () => {
    const { root, brain } = realBrain();
    await brain.changeTodo({ kind: 'add', title: 'Self task', due: null, assignee: 'sam-example' }, me);
    const added = (await brain.todos(me)).mine.find((t) => t.title === 'Self task');
    expect(added?.createdBy).toBe('sam-example');
    const text = readFileSync(join(root, 'todo', added?.id as string), 'utf8');
    expect(text).not.toMatch(/assigned_by: (?!sam-example)/);
    expect(added?.handover === null || added?.handover?.by === 'sam-example').toBe(true);
  });

  it('passing a task on stamps the person and the app, not git', async () => {
    const { root, brain } = realBrain();
    const id = '20261103-open-task.md';
    await brain.changeTodo({ kind: 'assignee', id, assignee: 'alex-sample' }, me);
    const text = readFileSync(join(root, 'todo', id), 'utf8');
    expect(text).toContain('assigned_by: sam-example');
    expect(text).toContain('assigned_via: TDS Cortex');
  });
});

describe('todos and projects (projects R1, decisions 5, 6 and 15)', () => {
  const FILE = '20261105-send-report.md';
  const KEY = 'acme-heating/web';

  /** A fake index: `resolve` records what it was asked and answers a key for the one label. */
  function fakeIndex() {
    const asked: [string | null, string | null, string][] = [];
    const index: ProjectsIndex = {
      cards: [],
      byKey: () => null,
      keysForPath: () => [],
      resolve: (value, client, scope) => {
        asked.push([value, client, scope]);
        return value === KEY
          ? { how: 'key', key: KEY }
          : value
            ? { how: 'loose', label: value }
            : { how: 'none' };
      },
    };
    return { index, asked };
  }

  it('fills stage and projectMatch on every task, and asks with its client and place', async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, 'todo', FILE),
      `---\nassignee: sam-example\nproject: ${KEY}\nclient: acme-heating\nstage: Build\n---\n# Send the monthly report\n`,
    );
    const { index, asked } = fakeIndex();
    const list = await listTodos(root, sam, { projects: async () => index });
    const all = [...list.mine, ...list.open];
    const item = all.find((t) => t.id === FILE);
    expect(item).toMatchObject({ project: KEY, stage: 'Build', projectMatch: { how: 'key', key: KEY } });
    expect(asked).toContainEqual([KEY, 'acme-heating', 'tds']);
    for (const t of all) expect(t.projectMatch).toBeDefined();
    expect(all.find((t) => t.id !== FILE)?.stage).toBeNull();
    expect(all.find((t) => t.id !== FILE)?.projectMatch).toEqual({ how: 'none' });
  });

  it('gives a stage but no projectMatch without an index, or when it cannot be read', async () => {
    const root = copyFixture();
    writeFileSync(join(root, 'todo', FILE), `---\nassignee: sam-example\nstage: Build\n---\n# Send\n`);
    for (const projects of [
      undefined,
      async () => {
        throw new Error('no index');
      },
    ]) {
      const list = await listTodos(root, sam, { projects });
      const item = list.mine.find((t) => t.id === FILE);
      expect(item?.stage).toBe('Build');
      expect(item?.projectMatch).toBeUndefined();
    }
  });

  it('says canProject only when the script reports todo-project-v1 (and changes are on)', async () => {
    const root = copyFixture();
    addTodoSkill(root);
    const yes = createBrainReaders(root, {
      todoSkill: { env: fakeEnv({}, ['scope', TODO_PROJECT_CAPABILITY]).env },
    });
    expect((await yes.todos(sam)).canProject).toBe(true);
    const older = createBrainReaders(root, { todoSkill: { env: fakeEnv({}, ['scope']).env } });
    expect((await older.todos(sam)).canProject).toBe(false);
    expect((await createBrainReaders(copyFixture()).todos(sam)).canProject).toBe(false);
  });

  describe('changeTodo', () => {
    function setup(caps: string[] = ['scope', TODO_PROJECT_CAPABILITY]) {
      const root = copyFixture();
      addTodoSkill(root);
      const fake = fakeEnv({}, caps);
      const brain = createBrainReaders(root, { todoSkill: { env: fake.env } });
      const version = async () => (await brain.todos(sam)).mine.find((t) => t.id === FILE)?.version ?? '';
      return { brain, calls: fake.calls, version };
    }
    const set = (over: Record<string, unknown> = {}): TodoAction =>
      ({
        kind: 'project',
        id: FILE,
        client: 'acme-heating',
        project: KEY,
        stage: 'Build',
        ...over,
      }) as TodoAction;

    it('passes the project action to the script like the others, with the same expect', async () => {
      const { brain, calls, version } = setup();
      const v = await version();
      await brain.changeTodo(set({ expect: v }), sam);
      expect(calls()).toHaveLength(1);
      expect(calls()[0]?.command).toBe('project');
      expect(calls()[0]?.body).toMatchObject({ file: FILE, project: KEY, expect: v });
      // Clearing all three is allowed too.
      await brain.changeTodo(set({ client: null, project: null, stage: null }), sam);
      expect(calls()).toHaveLength(2);
    });

    it("refuses it without the capability, and for tasks that are not this person's or open", async () => {
      const older = setup(['scope']);
      expect(await codeOf(older.brain.changeTodo(set(), sam))).toBe('not-allowed');
      expect(older.calls()).toEqual([]);
      const { brain, calls, version } = setup();
      expect(await codeOf(brain.changeTodo(set({ id: '20261102-alex-task.md' }), sam))).toBe('not-found');
      expect(await codeOf(brain.changeTodo(set({ id: 'nope.md' }), sam))).toBe('not-found');
      expect(await codeOf(brain.changeTodo(set({ expect: 'f'.repeat(64) }), sam))).toBe('changed');
      expect(await version()).not.toBe('');
      expect(calls()).toEqual([]);
    });

    it('checks the values before anything runs', async () => {
      const { brain, calls } = setup();
      const bad: Record<string, unknown>[] = [
        { project: 'Not A Key' },
        { project: `${KEY}/extra` },
        { client: 'Acme' },
        { client: 'other-client' },
        { client: 'acme-heating', project: null, stage: 'Build' },
        { stage: 'x'.repeat(41) },
        { stage: ' padded ' },
        { stage: 'two\nlines' },
        { stage: '' },
        { id: '../x.md' },
        { expect: 'short' },
      ];
      for (const over of bad) {
        expect(await codeOf(brain.changeTodo(set(over), sam)), JSON.stringify(over)).toBe('bad-request');
      }
      expect(calls()).toEqual([]);
    });

    it('refuses a private project for a team task before the script is asked', async () => {
      const { brain, calls } = setup();
      expect(await codeOf(brain.changeTodo(set({ client: null, project: 'personal/plan' }), sam))).toBe(
        'not-allowed',
      );
      expect(calls()).toEqual([]);
    });

    it('needs expect for a personal task, as every personal change does', async () => {
      const { brain } = setup();
      expect(
        await codeOf(
          brain.changeTodo(set({ scope: 'personal', client: null, project: 'personal/plan' }), sam),
        ),
      ).toBe('bad-request');
    });

    it('passes client, project and stage on an add, and refuses them without the capability', async () => {
      const { brain, calls } = setup();
      const add = {
        kind: 'add',
        title: 'Scope the build',
        due: null,
        assignee: 'sam-example',
        client: 'acme-heating',
        project: KEY,
        stage: 'Build',
      } as TodoAction;
      await brain.changeTodo(add, sam);
      expect(calls()[0]).toMatchObject({ command: 'add', body: { project: KEY } });
      const older = setup(['scope']);
      expect(await codeOf(older.brain.changeTodo(add, sam))).toBe('not-allowed');
      expect(await codeOf(brain.changeTodo({ ...add, project: 'Bad Key' } as TodoAction, sam))).toBe(
        'bad-request',
      );
      expect(await codeOf(brain.changeTodo({ ...add, client: 'other-client' } as TodoAction, sam))).toBe(
        'bad-request',
      );
    });

    it('passes dropProject on a move only with the capability, and only as true', async () => {
      const { brain, calls, version } = setup();
      const v = await version();
      const move = { kind: 'move', id: FILE, scope: 'tds', to: 'personal', expect: v } as TodoAction;
      await brain.changeTodo({ ...move, dropProject: true } as TodoAction, sam);
      expect(calls()[0]?.command).toBe('move');
      expect(
        await codeOf(brain.changeTodo({ ...move, dropProject: false } as unknown as TodoAction, sam)),
      ).toBe('bad-request');
      const older = setup(['scope']);
      expect(await codeOf(older.brain.changeTodo({ ...move, dropProject: true } as TodoAction, sam))).toBe(
        'not-allowed',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Restricted projects (plan 2026-11-27-restricted-projects, decisions 6 and 7)
// ---------------------------------------------------------------------------

describe('restricted projects: the task rule and the assign block', () => {
  /** A project hidden from sam (resolve answers 'restricted'). */
  const SECRET = 'acme-heating/secret';
  /** A restricted project sam can see (resolve answers a key); the assign block decides who may take its tasks. */
  const TEAM_ONLY = 'acme-heating/launch';
  const MINE = '20261120-secret-mine.md';
  const ALEX = '20261121-secret-alex.md';
  const OPEN = '20261122-secret-open.md';
  const TEAM_MINE = '20261123-launch-mine.md';

  /** A stand-in for S1's index: SECRET is hidden, TEAM_ONLY is visible, anything else is loose. */
  const index: ProjectsIndex = {
    cards: [],
    byKey: () => null,
    keysForPath: () => [],
    resolve: (value) =>
      value === SECRET
        ? { how: 'restricted' }
        : value === TEAM_ONLY
          ? { how: 'key', key: TEAM_ONLY }
          : value
            ? { how: 'loose', label: value }
            : { how: 'none' },
    hiddenPath: (rel) => rel.startsWith('clients/acme-heating/projects/secret/'),
    hiddenKey: (key) => key === SECRET,
    hiddenCount: 1,
  };
  const unreadable = async (): Promise<ProjectsIndex> => {
    throw new Error('no index');
  };

  function task(assignee: string | null, project: string): string {
    return `---\n${assignee ? `assignee: ${assignee}\n` : ''}client: acme-heating\nproject: ${project}\nstage: Build\n---\n# A task\n`;
  }

  function brainRoot(): string {
    const root = copyFixture();
    writeFileSync(join(root, 'todo', MINE), task('sam-example', SECRET));
    writeFileSync(join(root, 'todo', ALEX), task('alex-sample', SECRET));
    writeFileSync(join(root, 'todo', OPEN), task(null, SECRET));
    writeFileSync(join(root, 'todo', TEAM_MINE), task('sam-example', TEAM_ONLY));
    return root;
  }

  describe('listTodos', () => {
    it("leaves out other people's and open tasks of a hidden project, uncounted, and masks sam's own", async () => {
      const root = brainRoot();
      const plain = await listTodos(root, sam);
      const list = await listTodos(root, sam, { projects: async () => index });
      const ids = [...list.mine, ...list.open].map((t) => t.id);
      expect(ids).not.toContain(ALEX);
      expect(ids).not.toContain(OPEN);
      expect(list.othersCount).toBe(plain.othersCount - 1);
      const own = list.mine.find((t) => t.id === MINE);
      expect(own).toMatchObject({ project: null, stage: null, projectMatch: { how: 'restricted' } });
      // A visible restricted project is shown as it always was.
      expect(list.mine.find((t) => t.id === TEAM_MINE)).toMatchObject({
        project: TEAM_ONLY,
        stage: 'Build',
        projectMatch: { how: 'key', key: TEAM_ONLY },
      });
    });

    it("fails closed when the index can't be read: project-labelled tasks that aren't sam's are left out", async () => {
      const root = brainRoot();
      const plain = await listTodos(root, sam);
      const list = await listTodos(root, sam, { projects: unreadable });
      const ids = [...list.mine, ...list.open].map((t) => t.id);
      expect(ids).not.toContain(ALEX);
      expect(ids).not.toContain(OPEN);
      // Sam's own, and tasks with no project label, are unaffected.
      expect(ids).toEqual(expect.arrayContaining([MINE, TEAM_MINE, '20261103-open-task.md']));
      expect(list.othersCount).toBe(plain.othersCount - 1);
    });

    it('is unchanged when nothing is hidden', async () => {
      const root = copyFixture();
      const visible: ProjectsIndex = { ...index, resolve: () => ({ how: 'none' }), hiddenCount: 0 };
      const withIndex = await listTodos(root, sam, { projects: async () => visible });
      const strip = (l: typeof withIndex) =>
        [...l.mine, ...l.open].map(({ projectMatch: _m, ...rest }) => rest);
      expect(strip(withIndex)).toEqual(strip(await listTodos(root, sam)));
      expect(withIndex.othersCount).toBe((await listTodos(root, sam)).othersCount);
    });
  });

  describe('completeTodo', () => {
    it("refuses to tick a hidden project's task that isn't sam's, and ticks sam's own", async () => {
      const root = brainRoot();
      const { completeTodo } = await import('./todos.ts');
      const at = new Date('2026-11-27T10:00:00Z');
      for (const id of [ALEX, OPEN]) {
        await expect(completeTodo(root, id, sam, at, { projects: async () => index })).rejects.toThrow(
          /could not be found/,
        );
        expect(existsSync(join(root, 'todo', id))).toBe(true);
      }
      await expect(completeTodo(root, ALEX, sam, at, { projects: unreadable })).rejects.toThrow(
        /could not be found/,
      );
      await completeTodo(root, MINE, sam, at, { projects: async () => index });
      expect(existsSync(join(root, 'todo', 'done', MINE))).toBe(true);
    });
  });

  describe('changeTodo', () => {
    function setup() {
      const root = brainRoot();
      addTodoSkill(root);
      const run = vi.fn(async () => ({ file: null }));
      const runner = {
        capabilities: async () => ['scope', TODO_PROJECT_CAPABILITY] as const,
        run,
      };
      const assignCheck = vi.fn(
        async (
          place: { project: string | null; client: string | null; scope: 'tds' | 'personal' },
          assignee: string | null,
        ) =>
          place.project === TEAM_ONLY && assignee === 'alex-sample'
            ? ({ ok: false, why: 'outside', name: 'Alex Sample' } as const)
            : ({ ok: true } as const),
      );
      const deps = { projects: async () => index, assignCheck };
      return { root, run, runner, assignCheck, deps };
    }
    const NOTE =
      "Alex Sample isn't on this restricted project. Add them to the project team first, then give them the task.";

    async function refusal(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
      try {
        await p;
        return null;
      } catch (err) {
        expect(err).toBeInstanceOf(TodoChangeError);
        return { code: (err as TodoChangeError).code, message: (err as TodoChangeError).message };
      }
    }

    it("answers not-found for every change to a hidden project's task that isn't sam's, before the script", async () => {
      const { root, run, runner, deps } = setup();
      const { changeTodo } = await import('./todos.ts');
      for (const id of [ALEX, OPEN]) {
        const actions: TodoAction[] = [
          { kind: 'edit', id, title: 'New' },
          { kind: 'due', id, due: null },
          { kind: 'assignee', id, assignee: 'sam-example' },
          { kind: 'delete', id },
          { kind: 'project', id, client: null, project: null, stage: null },
        ];
        for (const a of actions)
          expect(await codeOf(changeTodo(root, a, sam, runner, deps)), `${a.kind} ${id}`).toBe('not-found');
        expect(await codeOf(changeTodo(root, { kind: 'tick', id, scope: 'tds' }, sam, runner, deps))).toBe(
          'not-found',
        );
      }
      // The same when the index can't be read.
      expect(
        await codeOf(
          changeTodo(root, { kind: 'edit', id: ALEX, title: 'New' }, sam, runner, {
            ...deps,
            projects: unreadable,
          }),
        ),
      ).toBe('not-found');
      expect(run).not.toHaveBeenCalled();
      // Sam's own task in the hidden project can still be changed.
      await changeTodo(root, { kind: 'edit', id: MINE, title: 'Mine' }, sam, runner, deps);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('refuses an add that gives a restricted task to someone outside it, with the exact note', async () => {
      const { root, run, runner, assignCheck, deps } = setup();
      const { changeTodo } = await import('./todos.ts');
      const add = {
        kind: 'add',
        title: 'Plan the launch',
        due: null,
        assignee: 'alex-sample',
        client: 'acme-heating',
        project: TEAM_ONLY,
      } as TodoAction;
      expect(await refusal(changeTodo(root, add, sam, runner, deps))).toEqual({
        code: 'not-allowed',
        message: NOTE,
      });
      expect(assignCheck).toHaveBeenCalledWith(
        { project: TEAM_ONLY, client: 'acme-heating', scope: 'tds' },
        'alex-sample',
      );
      expect(run).not.toHaveBeenCalled();
      // Allowed when unassigned, and when the check says ok.
      await changeTodo(root, { ...add, assignee: null } as TodoAction, sam, runner, deps);
      await changeTodo(root, { ...add, assignee: 'jo-owner' } as TodoAction, sam, runner, deps);
      expect(run).toHaveBeenCalledTimes(2);
    });

    it('refuses passing a restricted task on to someone outside it, the place read from the file', async () => {
      const { root, run, runner, assignCheck, deps } = setup();
      const { changeTodo } = await import('./todos.ts');
      const pass = { kind: 'assignee', id: TEAM_MINE, assignee: 'alex-sample' } as TodoAction;
      expect(await refusal(changeTodo(root, pass, sam, runner, deps))).toEqual({
        code: 'not-allowed',
        message: NOTE,
      });
      expect(assignCheck).toHaveBeenLastCalledWith(
        { project: TEAM_ONLY, client: 'acme-heating', scope: 'tds' },
        'alex-sample',
      );
      // Sam's own hidden-project task: the check gets the real label, never the masked null.
      await changeTodo(root, { kind: 'assignee', id: MINE, assignee: 'jo-owner' }, sam, runner, deps);
      expect(assignCheck).toHaveBeenLastCalledWith(
        { project: SECRET, client: 'acme-heating', scope: 'tds' },
        'jo-owner',
      );
      expect(run).toHaveBeenCalledTimes(1);
      // Open to anyone is always allowed.
      await changeTodo(root, { kind: 'assignee', id: TEAM_MINE, assignee: null }, sam, runner, deps);
      expect(run).toHaveBeenCalledTimes(2);
    });

    it("refuses moving a task into a restricted project its person can't take, the person read from the file", async () => {
      const { root, run, runner, assignCheck, deps } = setup();
      const { changeTodo } = await import('./todos.ts');
      const move = {
        kind: 'project',
        id: '20261103-open-task.md',
        client: 'acme-heating',
        project: TEAM_ONLY,
        stage: null,
      } as TodoAction;
      // A task open to anyone may go into any project sam can see.
      await changeTodo(root, move, sam, runner, deps);
      expect(run).toHaveBeenCalledTimes(1);
      // Sam's own task into TEAM_ONLY: the person comes from the file.
      assignCheck.mockResolvedValueOnce({ ok: false, why: 'outside', name: 'Alex Sample' });
      expect(
        await refusal(
          changeTodo(root, { ...move, id: '20261105-send-report.md' } as TodoAction, sam, runner, deps),
        ),
      ).toEqual({ code: 'not-allowed', message: NOTE });
      expect(assignCheck).toHaveBeenLastCalledWith(
        { project: TEAM_ONLY, client: 'acme-heating', scope: 'tds' },
        'sam-example',
      );
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('refuses a move to TDS that would leave a restricted task with someone outside it', async () => {
      const { root, run, runner, assignCheck, deps } = setup();
      const { changeTodo } = await import('./todos.ts');
      personalFile(
        root,
        '20261126-own.md',
        `---\nassignee: sam-example\nproject: ${TEAM_ONLY}\nclient: acme-heating\n---\n`,
      );
      const expectV = EX(root, 'personal/todo', '20261126-own.md');
      assignCheck.mockResolvedValueOnce({ ok: false, why: 'outside', name: 'Alex Sample' });
      const move = {
        kind: 'move',
        id: '20261126-own.md',
        scope: 'personal',
        to: 'tds',
        expect: expectV,
      } as TodoAction;
      expect(await refusal(changeTodo(root, move, sam, runner, deps))).toEqual({
        code: 'not-allowed',
        message: NOTE,
      });
      expect(assignCheck).toHaveBeenLastCalledWith(
        { project: TEAM_ONLY, client: 'acme-heating', scope: 'tds' },
        'sam-example',
      );
      // Dropping the project on the way: nothing to check.
      assignCheck.mockClear();
      await changeTodo(root, { ...move, dropProject: true } as TodoAction, sam, runner, deps);
      expect(assignCheck).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("refuses pointing a task at a project sam can't see, as a missing project is refused", async () => {
      const { root, run, runner, deps } = setup();
      const { changeTodo } = await import('./todos.ts');
      const add = {
        kind: 'add',
        title: 'Snoop',
        due: null,
        assignee: 'sam-example',
        client: 'acme-heating',
        project: SECRET,
      } as TodoAction;
      expect(await codeOf(changeTodo(root, add, sam, runner, deps))).toBe('bad-request');
      const point = {
        kind: 'project',
        id: '20261105-send-report.md',
        client: 'acme-heating',
        project: SECRET,
        stage: null,
      } as TodoAction;
      expect(await codeOf(changeTodo(root, point, sam, runner, deps))).toBe('bad-request');
      expect(run).not.toHaveBeenCalled();
    });

    it('refuses rather than guesses when the assign check fails', async () => {
      const { root, run, runner, assignCheck, deps } = setup();
      const { changeTodo } = await import('./todos.ts');
      assignCheck.mockRejectedValueOnce(new Error('cards unreadable'));
      expect(
        await codeOf(
          changeTodo(root, { kind: 'assignee', id: TEAM_MINE, assignee: 'jo-owner' }, sam, runner, deps),
        ),
      ).toBe('internal');
      expect(run).not.toHaveBeenCalled();
    });

    describe("attach never confirms a hidden project's file", () => {
      const CARD = 'clients/acme-heating/projects/secret/project.md';
      const PLAN = 'clients/acme-heating/projects/secret/plan.md';
      const NOTE = 'clients/acme-heating/call-notes/2026-11-01-secret-kickoff.md';
      const PLAIN_NOTE = 'clients/acme-heating/call-notes/2026-11-02-catch-up.md';
      const REPORT = 'clients/acme-heating/reports/monthly.md';
      const OWN = '20261105-send-report.md';

      function attaching() {
        const s = setup();
        const runner = { ...s.runner, capabilities: async () => ['scope', TODO_ATTACH_CAPABILITY] as const };
        for (const [rel, text] of [
          [CARD, '---\ntitle: Secret\n---\n'],
          [PLAN, '# Plan'],
          [NOTE, `---\nproject: ${SECRET}\n---\n# Kickoff\n`],
          [PLAIN_NOTE, '# Catch-up\n'],
          [REPORT, '# Monthly'],
        ] as const) {
          mkdirSync(join(s.root, rel, '..'), { recursive: true });
          writeFileSync(join(s.root, rel), text);
        }
        return { ...s, runner };
      }
      const attach = (path: string): TodoAction => ({ kind: 'attach', id: OWN, path });

      it('answers a file in a hidden folder, or a hidden call note, exactly as a missing file', async () => {
        const { root, run, runner, deps } = attaching();
        const { changeTodo } = await import('./todos.ts');
        const missing = await refusal(
          changeTodo(root, attach('clients/acme-heating/projects/secret/nothing.md'), sam, runner, deps),
        );
        expect(missing?.code).toBe('bad-request');
        for (const path of [CARD, PLAN, NOTE])
          expect(await refusal(changeTodo(root, attach(path), sam, runner, deps)), path).toEqual(missing);
        // The same when the index can't be read: no project folder's file, and no tagged note, is confirmed.
        for (const path of [PLAN, NOTE])
          expect(
            await refusal(changeTodo(root, attach(path), sam, runner, { ...deps, projects: unreadable })),
            path,
          ).toEqual(missing);
        expect(run).not.toHaveBeenCalled();
      });

      it('still links a normal file and an untagged call note, and is unchanged with nothing restricted', async () => {
        const { root, run, runner, deps } = attaching();
        const { changeTodo } = await import('./todos.ts');
        await changeTodo(root, attach(REPORT), sam, runner, deps);
        await changeTodo(root, attach(PLAIN_NOTE), sam, runner, deps);
        const open: ProjectsIndex = { ...index, hiddenPath: () => false, hiddenCount: 0 };
        await changeTodo(root, attach(NOTE), sam, runner, { ...deps, projects: async () => open });
        expect(run).toHaveBeenCalledTimes(3);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Task updates (plan 2026-11-27-task-updates-handback, release 1, server side).
// ---------------------------------------------------------------------------

describe('task updates: what the server sends and lets through', () => {
  const ID = '20261120-quote.md';
  const SECRET = 'acme-heating/secret';
  const entry = (time: string, who: string, slug: string, what: string) =>
    `- 27 Nov 2026, ${time} UK: ${who} (${slug}) ${what}`;
  const LOG = [
    entry('14:05', 'Alex Sample', 'alex-sample', 'wrote: Sent the quote.'),
    '  They want it signed.',
    entry('14:09', 'Zed Stranger', 'zed-stranger', 'added a link: Quote on Drive (TDS Brain App).'),
  ].join('\n');
  const BODY = [
    '# Quote',
    '',
    'Send it today.',
    '',
    '## Files',
    '',
    '- [Quote on Drive](https://drive.google.com/file/d/abc/view)',
    '',
    '## Updates',
    '',
    LOG,
    '',
    '## Handover history',
    '',
    '- 26 Nov 2026, 09:00 UK: Alex Sample passed it from alex-sample to sam-example (TDS Brain App).',
    '',
  ].join('\n');
  const task = (lines: string[], body = BODY) => `---\n${lines.join('\n')}\n---\n${body}`;
  const MINE = [
    'assignee: sam-example',
    'created_by: alex-sample',
    'created: 2026-11-20',
    'created_at: 2026-11-20T09:00:00+00:00',
  ];

  function setup(files: Record<string, string>, caps: string[] = ['scope', 'updates-v1', 'links-v1']) {
    const root = copyFixture();
    addTodoSkill(root);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, 'todo', name), text);
    const run = vi.fn(async (_action: unknown) => ({ file: null }));
    const runner = { capabilities: async () => caps, run };
    return { root, run, runner };
  }

  it('sends the timeline on a listed task: entries by time, links, lastChange, createdAt', async () => {
    const { root } = setup({ [ID]: task(MINE) });
    const list = await listTodos(root, sam, { capabilities: async () => ['updates-v1', 'links-v1'] });
    const t = list.mine.find((x) => x.id === ID);
    expect(t?.createdAt).toBe('2026-11-20T09:00:00+00:00');
    expect(t?.links).toEqual([{ url: 'https://drive.google.com/file/d/abc/view', name: 'Quote on Drive' }]);
    expect(t?.updatesMore).toBe(false);
    expect(t?.updateExtras).toEqual([]);
    expect(t?.updates?.map((u) => [u.kind, u.by, u.byName])).toEqual([
      ['handover', null, 'Alex Sample'],
      ['note', 'alex-sample', 'Alex Sample'],
      ['auto', null, 'Zed Stranger'],
    ]);
    expect(t?.updates?.[1]?.text).toBe('Sent the quote.\nThey want it signed.');
    // A slug that isn't on the team is `by: null`; the name stays as written.
    expect(t?.lastChange).toMatchObject({ by: null, byName: 'Zed Stranger' });
    expect(list.canUpdate).toBe(true);
    expect(list.canLink).toBe(true);
  });

  it('has no update or link flags from an older script, and empty timeline fields for a plain task', async () => {
    const { root } = setup({ [ID]: task(['assignee: sam-example'], '# Quote\n') }, ['scope']);
    const list = await listTodos(root, sam, { capabilities: async () => ['scope'] });
    expect(list.canUpdate).toBe(false);
    expect(list.canLink).toBe(false);
    expect(list.mine.find((x) => x.id === ID)).toMatchObject({
      updates: [],
      updatesMore: false,
      updateExtras: [],
      links: [],
      lastChange: null,
      createdAt: null,
    });
  });

  it('keeps the newest TODO_UPDATES_SHOWN_MAX entries and says there are more', async () => {
    const lines = Array.from({ length: 205 }, (_, i) => {
      const minute = String(i % 60).padStart(2, '0');
      const hour = String(Math.floor(i / 60) + 8).padStart(2, '0');
      return entry(`${hour}:${minute}`, 'Alex Sample', 'alex-sample', `wrote: Note ${i}`);
    });
    const body = `# Quote\n\n## Updates\n\n${lines.join('\n')}\n`;
    const { root } = setup({ [ID]: task(['assignee: sam-example'], body) });
    const t = (await listTodos(root, sam)).mine.find((x) => x.id === ID);
    expect(t?.updates).toHaveLength(200);
    expect(t?.updatesMore).toBe(true);
    expect(t?.updates?.[0]?.text).toBe('Note 5');
    expect(t?.updates?.[199]?.text).toBe('Note 204');
    expect(t?.lastChange?.at).toBe(t?.updates?.[199]?.at);
  });

  it('reads the last copy of a key a union merge doubled, and the hand back mark', async () => {
    const { root } = setup({
      [ID]: task([
        'assignee: ben-mcadam',
        'title: Old title',
        'assignee: sam-example',
        'title: New title',
        'assigned_to: sam-example',
        'assigned_at: 2026-11-26T09:00:00+00:00',
        'assigned_by: alex-sample',
        'assigned_back: true',
      ]),
    });
    const t = (await listTodos(root, sam)).mine.find((x) => x.id === ID);
    expect(t).toMatchObject({ assignee: 'sam-example', title: 'New title' });
    expect(t?.handover).toMatchObject({ by: 'alex-sample', back: true, source: 'stamp' });
  });

  describe('completeTodoWithNote (Add update and mark as done)', () => {
    const FILE = '20261105-send-report.md';
    function wired(caps: string[]) {
      const root = copyFixture();
      addTodoSkill(root);
      const fake = fakeEnv({}, caps);
      const brain = createBrainReaders(root, { todoSkill: { env: fake.env } });
      return { root, brain, calls: fake.calls };
    }

    it("runs the script's tick with the note, and leaves the file where it is (the script moves it)", async () => {
      const { root, brain, calls } = wired(['scope', 'updates-v1']);
      await brain.completeTodoWithNote?.({ id: FILE, scope: 'tds', note: 'All done.' }, sam);
      expect(calls()).toEqual([
        {
          command: 'tick',
          body: {
            file: FILE,
            via: 'TDS Cortex',
            note: 'All done.',
            by: 'sam-example',
            by_name: 'sam-example',
          },
        },
      ]);
      expect(existsSync(join(root, 'todo', FILE))).toBe(true);
    });

    it('checks the version, the note and the capability like any change, before the script', async () => {
      const { brain, calls } = wired(['scope', 'updates-v1']);
      const tick = (note: string, expect?: string, scope: 'tds' | 'personal' = 'tds') =>
        codeOf(
          brain.completeTodoWithNote?.({ id: FILE, scope, note, ...(expect ? { expect } : {}) }, sam) ??
            Promise.resolve(),
        );
      expect(await tick('x', 'f'.repeat(64))).toBe('changed');
      expect(await tick('   ')).toBe('bad-request');
      expect(await tick('x', undefined, 'personal')).toBe('bad-request');
      expect(await tick('x', undefined)).toBeNull();
      expect(calls()).toHaveLength(1);
      const old = wired(['scope']);
      expect(
        await codeOf(
          old.brain.completeTodoWithNote?.({ id: FILE, scope: 'tds', note: 'x' }, sam) ?? Promise.resolve(),
        ),
      ).toBe('bad-request');
      expect(old.calls()).toEqual([]);
    });
  });

  describe('changeTodo', () => {
    const OTHER = 'alex-sample';
    const filed = () => ({ [ID]: task(MINE) });
    const go = (
      s: ReturnType<typeof setup>,
      action: TodoAction | { kind: 'tick'; id: string; scope: 'tds' | 'personal'; note?: string },
      deps: object = {},
    ) => changeTodo(s.root, action, sam, s.runner, deps);

    it('runs update, link and unlink for a listed task', async () => {
      const s = setup(filed());
      await go(s, { kind: 'update', id: ID, text: '  Sent it.  ' });
      await go(s, { kind: 'link', id: ID, url: 'https://example.com/a_(b)', name: 'Spec' });
      await go(s, { kind: 'link', id: ID, url: 'https://example.com/b' });
      await go(s, { kind: 'unlink', id: ID, url: 'https://example.com/b' });
      expect(s.run.mock.calls.map((c) => (c[0] as { kind: string }).kind)).toEqual([
        'update',
        'link',
        'link',
        'unlink',
      ]);
    });

    it('refuses update, link and unlink without the capability (not-allowed), before the script', async () => {
      const s = setup(filed(), ['scope']);
      expect(await codeOf(go(s, { kind: 'update', id: ID, text: 'Hi' }))).toBe('not-allowed');
      expect(await codeOf(go(s, { kind: 'link', id: ID, url: 'https://example.com' }))).toBe('not-allowed');
      expect(await codeOf(go(s, { kind: 'unlink', id: ID, url: 'https://example.com' }))).toBe('not-allowed');
      const links = setup(filed(), ['scope', 'updates-v1']);
      expect(await codeOf(go(links, { kind: 'link', id: ID, url: 'https://example.com' }))).toBe(
        'not-allowed',
      );
      expect(await codeOf(go(links, { kind: 'update', id: ID, text: 'Hi' }))).toBeNull();
      expect(s.run).not.toHaveBeenCalled();
    });

    it('checks the update text', async () => {
      const s = setup(filed());
      for (const text of [
        '',
        '   \n ',
        'x'.repeat(2001),
        'bad\u0000char',
        'bell\u0007',
        5 as unknown as string,
      ])
        expect(await codeOf(go(s, { kind: 'update', id: ID, text })), String(text).slice(0, 8)).toBe(
          'bad-request',
        );
      for (const text of ['x'.repeat(2000), 'two\nlines\twith a tab\r\n'])
        expect(await codeOf(go(s, { kind: 'update', id: ID, text }))).toBeNull();
    });

    it('checks the link URL and name', async () => {
      const s = setup(filed());
      const bad = [
        'javascript:alert(1)',
        'ftp://example.com/a',
        'example.com',
        'https://',
        'https://exa mple.com',
        'https://example.com/<b>',
        'https://example.com/\\a',
        `https://example.com/${'a'.repeat(2000)}`,
        '',
      ];
      for (const url of bad)
        expect(await codeOf(go(s, { kind: 'link', id: ID, url })), url.slice(0, 30)).toBe('bad-request');
      expect(await codeOf(go(s, { kind: 'unlink', id: ID, url: 'javascript:x' }))).toBe('bad-request');
      for (const name of ['', '  ', 'a'.repeat(121), 'two\nlines', 'a [b]', 'a]b'])
        expect(await codeOf(go(s, { kind: 'link', id: ID, url: 'https://example.com', name })), name).toBe(
          'bad-request',
        );
      expect(
        await codeOf(go(s, { kind: 'link', id: ID, url: 'https://example.com', name: 'a'.repeat(120) })),
      ).toBeNull();
    });

    it('needs canUpdate for a note or back on assignee and a note on tick (bad-request)', async () => {
      const s = setup(filed(), ['scope']);
      expect(await codeOf(go(s, { kind: 'assignee', id: ID, assignee: OTHER, note: 'Done.' }))).toBe(
        'bad-request',
      );
      expect(await codeOf(go(s, { kind: 'assignee', id: ID, assignee: OTHER, back: true }))).toBe(
        'bad-request',
      );
      expect(await codeOf(go(s, { kind: 'tick', id: ID, scope: 'tds', note: 'Done.' }))).toBe('bad-request');
      expect(await codeOf(go(s, { kind: 'assignee', id: ID, assignee: OTHER }))).toBeNull();
      expect(await codeOf(go(s, { kind: 'tick', id: ID, scope: 'tds' }))).toBeNull();
    });

    it('passes a note on assignee and on tick, and checks it like an update', async () => {
      const s = setup(filed());
      expect(
        await codeOf(go(s, { kind: 'assignee', id: ID, assignee: 'jo-owner', note: 'See notes.' })),
      ).toBeNull();
      expect(await codeOf(go(s, { kind: 'tick', id: ID, scope: 'tds', note: 'All done.' }))).toBeNull();
      expect(await codeOf(go(s, { kind: 'tick', id: ID, scope: 'tds', note: '  ' }))).toBe('bad-request');
      expect(
        await codeOf(go(s, { kind: 'assignee', id: ID, assignee: 'jo-owner', note: 'x'.repeat(2001) })),
      ).toBe('bad-request');
      // A note to the person who already has it passes nothing on: the script refuses, so the server does.
      expect(await codeOf(go(s, { kind: 'assignee', id: ID, assignee: 'sam-example', note: 'Hi' }))).toBe(
        'bad-request',
      );
    });

    it('lets back go only to the hand-back target', async () => {
      // alex-sample created it and is the pass-on stamp's `by`: the target.
      const stamped = [
        ...MINE,
        'assigned_to: sam-example',
        'assigned_at: 2026-11-26T09:00:00+00:00',
        'assigned_by: alex-sample',
      ];
      const s = setup({ [ID]: task(stamped) });
      const hand = (assignee: string | null, extra: object = {}) =>
        go(s, {
          kind: 'assignee',
          id: ID,
          assignee,
          back: true,
          note: 'Back to you.',
          ...extra,
        } as TodoAction);
      expect(await codeOf(hand('jo-owner'))).toBe('bad-request');
      expect(await codeOf(hand(null))).toBe('bad-request');
      expect(await codeOf(hand('sam-example'))).toBe('bad-request');
      expect(s.run).not.toHaveBeenCalled();
      expect(await codeOf(hand('alex-sample'))).toBeNull();
      expect(s.run).toHaveBeenCalledTimes(1);
      expect(s.run.mock.calls[0]?.[0]).toMatchObject({
        assignee: 'alex-sample',
        back: true,
        note: 'Back to you.',
      });
    });

    it('has no hand-back target for a task that was itself handed back, or one nobody passed on', async () => {
      const handedBack = setup({
        [ID]: task([
          'assignee: sam-example',
          'created_by: sam-example',
          'assigned_to: sam-example',
          'assigned_at: 2026-11-26T09:00:00+00:00',
          'assigned_by: alex-sample',
          'assigned_back: true',
        ]),
      });
      expect(
        await codeOf(go(handedBack, { kind: 'assignee', id: ID, assignee: 'alex-sample', back: true })),
      ).toBe('bad-request');
      const own = setup({ [ID]: task(['assignee: sam-example', 'created_by: sam-example']) });
      expect(await codeOf(go(own, { kind: 'assignee', id: ID, assignee: 'alex-sample', back: true }))).toBe(
        'bad-request',
      );
    });

    it('refuses an `## Updates` heading in typed details when the task has none on disk, mirroring Files', async () => {
      const s = setup({
        [ID]: task(['assignee: sam-example'], '# Quote\n\nPlain.\n'),
        '20261121-logged.md': task(MINE),
      });
      const heading = 'Notes.\n\n## Updates\n\n- mine';
      const edit = (id: string, details: string): TodoAction => ({
        kind: 'edit',
        id,
        title: 'Quote',
        details,
      });
      const refused = await go(s, edit(ID, heading)).catch((e: TodoChangeError) => e);
      expect(refused).toBeInstanceOf(TodoChangeError);
      expect((refused as TodoChangeError).code).toBe('bad-request');
      expect((refused as TodoChangeError).message).toMatch(/Updates/);
      // With a section on disk the script keeps its own, so an older app's whole details still go through.
      expect(await codeOf(go(s, edit('20261121-logged.md', heading)))).toBeNull();
      // An add has no section to keep.
      expect(
        await codeOf(
          go(s, { kind: 'add', title: 'T', due: null, assignee: 'sam-example', details: heading }),
        ),
      ).toBe('bad-request');
      // Without the capability the words are ordinary text, as before.
      const old = setup({ [ID]: task(['assignee: sam-example'], '# Quote\n') }, ['scope']);
      expect(await codeOf(go(old, edit(ID, heading)))).toBeNull();
    });

    describe('a task this person passed on (Asked)', () => {
      const ASKED = '20261122-asked.md';
      const askedFile = (extra: string[] = []) =>
        task(
          [
            'assignee: alex-sample',
            'assigned_to: alex-sample',
            'assigned_at: 2026-11-26T09:00:00+00:00',
            'assigned_by: sam-example',
            ...extra,
          ],
          '# Asked\n',
        );
      async function askedSetup(extra: string[] = [], caps?: string[]) {
        const s = setup({ [ASKED]: askedFile(extra) }, caps);
        const { createAskedTodos } = await import('./todo-asked.ts');
        const asked = createAskedTodos(async () => ({ stdout: '', cut: false }));
        const deps = {
          asked: (who: typeof sam) =>
            asked.list(s.root, who, new Date('2026-11-27T12:00:00Z'), undefined, true),
        };
        return { s, deps };
      }

      it('lets `update` through while it waits, and runs the script', async () => {
        const { s, deps } = await askedSetup();
        const version = createHash('sha256')
          .update(readFileSync(join(s.root, 'todo', ASKED)))
          .digest('hex');
        expect(
          await codeOf(go(s, { kind: 'update', id: ASKED, text: 'Any news?', expect: version }, deps)),
        ).toBeNull();
        expect(s.run).toHaveBeenCalledTimes(1);
        expect(
          await codeOf(go(s, { kind: 'update', id: ASKED, text: 'x', expect: 'f'.repeat(64) }, deps)),
        ).toBe('changed');
      });

      it('refuses every other kind, before the script', async () => {
        // Every capability on, so only the Asked rule can refuse.
        const { s, deps } = await askedSetup(
          [],
          ['scope', 'updates-v1', 'links-v1', TODO_ATTACH_CAPABILITY, TODO_PROJECT_CAPABILITY],
        );
        const actions: TodoAction[] = [
          { kind: 'edit', id: ASKED, title: 'New' },
          { kind: 'due', id: ASKED, due: null },
          { kind: 'assignee', id: ASKED, assignee: 'sam-example' },
          { kind: 'assignee', id: ASKED, assignee: 'sam-example', back: true, note: 'x' },
          { kind: 'delete', id: ASKED },
          { kind: 'link', id: ASKED, url: 'https://example.com' },
          { kind: 'unlink', id: ASKED, url: 'https://example.com' },
          { kind: 'attach', id: ASKED, path: 'clients/acme/files/a.pdf' },
          { kind: 'project', id: ASKED, client: null, project: null, stage: null },
        ];
        for (const a of actions) expect(await codeOf(go(s, a, deps)), a.kind).toBe('not-found');
        expect(await codeOf(go(s, { kind: 'tick', id: ASKED, scope: 'tds', note: 'x' }, deps))).toBe(
          'not-found',
        );
        expect(
          await codeOf(
            go(s, { kind: 'update', id: ASKED, text: 'x', scope: 'personal', expect: 'a'.repeat(64) }, deps),
          ),
        ).toBe('not-found');
        expect(s.run).not.toHaveBeenCalled();
      });

      it('is not reachable without the Asked list, without the capability, or once finished', async () => {
        const { s } = await askedSetup();
        expect(await codeOf(go(s, { kind: 'update', id: ASKED, text: 'x' }))).toBe('not-found');
        const old = await askedSetup([], ['scope']);
        expect(await codeOf(go(old.s, { kind: 'update', id: ASKED, text: 'x' }, old.deps))).toBe(
          'not-allowed',
        );
        const done = setup({});
        mkdirSync(join(done.root, 'todo', 'done'), { recursive: true });
        writeFileSync(join(done.root, 'todo', 'done', ASKED), askedFile(['status: done']));
        const { createAskedTodos } = await import('./todo-asked.ts');
        const asked = createAskedTodos(async () => ({ stdout: '', cut: false }));
        const deps = {
          asked: (who: typeof sam) =>
            asked.list(done.root, who, new Date('2026-11-27T12:00:00Z'), undefined, true),
        };
        expect(await codeOf(go(done, { kind: 'update', id: ASKED, text: 'x' }, deps))).toBe('not-found');
      });

      it("stays refused for a task in a project hidden from this person, and when the index can't be read", async () => {
        const hidden: ProjectsIndex = {
          cards: [],
          byKey: () => null,
          keysForPath: () => [],
          resolve: (value) => (value === SECRET ? { how: 'restricted' } : { how: 'none' }),
          hiddenPath: () => false,
          hiddenKey: (key) => key === SECRET,
          hiddenCount: 1,
        };
        const { s } = await askedSetup([`project: ${SECRET}`, 'client: acme-heating']);
        const { createAskedTodos } = await import('./todo-asked.ts');
        const asked = createAskedTodos(async () => ({ stdout: '', cut: false }));
        const withIndex = {
          projects: async () => hidden,
          asked: (who: typeof sam) =>
            asked.list(s.root, who, new Date('2026-11-27T12:00:00Z'), async () => hidden, true),
        };
        expect(await codeOf(go(s, { kind: 'update', id: ASKED, text: 'x' }, withIndex))).toBe('not-found');
        const unreadable = async (): Promise<ProjectsIndex> => {
          throw new Error('no index');
        };
        const noIndex = {
          projects: unreadable,
          asked: (who: typeof sam) =>
            asked.list(s.root, who, new Date('2026-11-27T12:00:00Z'), unreadable, true),
        };
        expect(await codeOf(go(s, { kind: 'update', id: ASKED, text: 'x' }, noIndex))).toBe('not-found');
        expect(s.run).not.toHaveBeenCalled();
      });
    });
  });
});
