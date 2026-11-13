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
      created: null,
      source: null,
      details: '',
      version: createHash('sha256')
        .update(readFileSync(join(fixtureRoot, 'todo', '20261101-renew-contract.md')))
        .digest('hex'),
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
    expect(list).toEqual({
      mine: [],
      open: [],
      othersCount: 0,
      team: [],
      changes: 'no-skill',
      canAddOpen: false,
      canUsePersonal: false,
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
    `---\ndescription: Add, edit, pass on, re-date or delete a to-do.\nroles: ${roles}\nmaturity: draft\n---\nBody.\n`,
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
      {
        command: 'assignee',
        body: {
          file: '20261103-open-task.md',
          assignee: 'sam-example',
          via: 'TDS Brain App',
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
          via: 'TDS Brain App',
          by: 'sam-example',
          by_name: 'sam-example',
        },
      },
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
    expect(calls()).toEqual([{ command: 'due', body: { file: FILE, due: '2026-12-01', expect: expectV } }]);
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
          via: 'TDS Brain App',
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
    expect(calls()).toEqual([{ command: 'edit', body: { file: FILE, title: 'New', expect: v } }]);
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

describe('personal to-dos: listing', () => {
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
      '---\nassignee: sam-example\nassigned_to: sam-example\nassigned_at: 2026-11-12T09:00:00+00:00\nassigned_by: alex-sample\nassigned_from: open\nassigned_via: TDS Brain App\n---\n# S\n',
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
      via: 'TDS Brain App',
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

  it('reads an open stamp (assigned_to: open) for an open to-do', async () => {
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

  it('is null when git resolves to the current person, on failure, and for open, others and personal to-dos', async () => {
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
    // Only TDS to-dos in mine are looked up.
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

  it('moves a TDS to-do to personal, keyed under personal/', async () => {
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

  it('adds a personal to-do for the person using the app, whatever git calls them', async () => {
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

  it('passing a to-do on stamps the person and the app, not git', async () => {
    const { root, brain } = realBrain();
    const id = '20261103-open-task.md';
    await brain.changeTodo({ kind: 'assignee', id, assignee: 'alex-sample' }, me);
    const text = readFileSync(join(root, 'todo', id), 'utf8');
    expect(text).toContain('assigned_by: sam-example');
    expect(text).toContain('assigned_via: TDS Brain App');
  });
});
