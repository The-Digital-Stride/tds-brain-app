import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  TODO_SCRIPT,
  TODO_SCRIPT_MAX_OUTPUT_BYTES,
  type TodoAction,
  TodoChangeError,
} from '../../shared/contract.ts';
import {
  createTodoSkillRunner,
  findTodoScript,
  scriptPayload,
  TODO_CHANGE_MESSAGES,
  type TodoSpawner,
} from './todo-skill.ts';

const made: string[] = [];
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/**
 * A stand-in for the brain's script. It records what it was given in FAKE_TODO_LOG (outside the
 * brain), then answers as FAKE_TODO_REPLY says: `{ exit, out, sleepMs, bytes, hang }`.
 */
const FAKE_SCRIPT = `
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const reply = JSON.parse(process.env.FAKE_TODO_REPLY || '{}');
  const log = process.env.FAKE_TODO_LOG;
  const record = (line) => { if (log) fs.appendFileSync(log, JSON.stringify(line) + '\\n'); };
  record({
    at: 'start',
    pid: process.pid,
    argv: process.argv.slice(1),
    stdin: input,
    cwd: process.cwd(),
    env: {
      BRAIN_ROOT: process.env.BRAIN_ROOT,
      WORKBENCH_AS: process.env.WORKBENCH_AS,
      NODE_OPTIONS: process.env.NODE_OPTIONS,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      KEEP_ME: process.env.KEEP_ME,
    },
  });
  if (reply.hang) { setInterval(() => {}, 1000); return; }
  if (reply.sleepMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, reply.sleepMs);
  record({ at: 'end', pid: process.pid });
  if (reply.bytes) process.stdout.write('x'.repeat(reply.bytes));
  else process.stdout.write(reply.out === undefined ? '{"ok":true}\\n' : reply.out);
  process.exitCode = reply.exit || 0;
});
`;

function makeBrain(script: string | null = FAKE_SCRIPT): string {
  const root = tempDir('tba-todo-skill-');
  mkdirSync(join(root, 'todo'), { recursive: true });
  writeFileSync(join(root, 'todo', '20261112-thing.md'), '---\nassignee: sam\n---\n# Thing\n');
  if (script !== null) {
    mkdirSync(join(root, '.claude', 'skills', 'todo', 'scripts'), { recursive: true });
    writeFileSync(join(root, TODO_SCRIPT), script);
  }
  return root;
}

interface Call {
  at: 'start' | 'end';
  pid: number;
  argv: string[];
  stdin: string;
  cwd: string;
  env: Record<string, string | undefined>;
}

function readLog(log: string): Call[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Call);
}

function setup(reply: object = {}, extraEnv: NodeJS.ProcessEnv = {}) {
  const root = makeBrain();
  const log = join(tempDir('tba-todo-log-'), 'calls.jsonl');
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    FAKE_TODO_LOG: log,
    FAKE_TODO_REPLY: JSON.stringify(reply),
    ...extraEnv,
  };
  return { root, log, env };
}

async function codeOf(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(TodoChangeError);
    const e = err as TodoChangeError;
    return { code: e.code, message: e.message };
  }
}

/** Every file in the brain with its size and modified time, to prove the app wrote nothing. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const s = statSync(p);
        out[p] = `${s.size}:${s.mtimeMs}`;
      }
    }
  };
  walk(root);
  return out;
}

describe('scriptPayload: the Workbench route bodies', () => {
  it('maps each action to the field names the script expects', () => {
    const cases: [TodoAction, object][] = [
      [
        { kind: 'add', title: 'Call Ben', due: '2026-11-20', assignee: 'sam' },
        { title: 'Call Ben', due: '2026-11-20', assignee: 'sam' },
      ],
      [
        { kind: 'add', title: 'Call Ben', due: null, assignee: 'sam' },
        { title: 'Call Ben', due: '', assignee: 'sam' },
      ],
      [
        { kind: 'edit', id: 'a.md', title: 'New' },
        { file: 'a.md', title: 'New' },
      ],
      [
        { kind: 'edit', id: 'a.md', title: 'New', details: '' },
        { file: 'a.md', title: 'New', body: '' },
      ],
      [
        { kind: 'due', id: 'a.md', due: '2026-12-01' },
        { file: 'a.md', due: '2026-12-01' },
      ],
      [
        { kind: 'due', id: 'a.md', due: null },
        { file: 'a.md', due: '' },
      ],
      [
        { kind: 'assignee', id: 'a.md', assignee: 'ben-mcadam' },
        { file: 'a.md', assignee: 'ben-mcadam' },
      ],
      [
        { kind: 'assignee', id: 'a.md', assignee: null },
        { file: 'a.md', assignee: '' },
      ],
      [
        { kind: 'delete', id: 'a.md' },
        { file: 'a.md', via: 'TDS Brain App' },
      ],
    ];
    for (const [action, payload] of cases)
      expect(scriptPayload(action), JSON.stringify(action)).toEqual(payload);
  });
});

describe('findTodoScript', () => {
  it("gives the script's real path when it is a file inside the brain", async () => {
    const root = makeBrain();
    expect(await findTodoScript(root)).toBe(realpathSync(join(root, TODO_SCRIPT)));
  });

  it('is null when the script is missing, or is a folder', async () => {
    expect(await findTodoScript(makeBrain(null))).toBeNull();
    const root = makeBrain(null);
    mkdirSync(join(root, TODO_SCRIPT), { recursive: true });
    expect(await findTodoScript(root)).toBeNull();
  });

  it('is null when the script, or a folder above it, leads outside the brain', async () => {
    const outside = tempDir('tba-outside-');
    writeFileSync(join(outside, 'todo.cjs'), FAKE_SCRIPT);
    const viaFile = makeBrain(null);
    mkdirSync(join(viaFile, '.claude', 'skills', 'todo', 'scripts'), { recursive: true });
    symlinkSync(join(outside, 'todo.cjs'), join(viaFile, TODO_SCRIPT));
    expect(await findTodoScript(viaFile)).toBeNull();

    const viaFolder = makeBrain(null);
    mkdirSync(join(outside, 'todo', 'scripts'), { recursive: true });
    writeFileSync(join(outside, 'todo', 'scripts', 'todo.cjs'), FAKE_SCRIPT);
    mkdirSync(join(viaFolder, '.claude', 'skills'), { recursive: true });
    symlinkSync(join(outside, 'todo'), join(viaFolder, '.claude', 'skills', 'todo'));
    expect(await findTodoScript(viaFolder)).toBeNull();
  });

  it('accepts a link that stays inside the brain', async () => {
    const root = makeBrain(null);
    writeFileSync(join(root, 'real.cjs'), FAKE_SCRIPT);
    mkdirSync(join(root, '.claude', 'skills', 'todo', 'scripts'), { recursive: true });
    symlinkSync(join(root, 'real.cjs'), join(root, TODO_SCRIPT));
    expect(await findTodoScript(root)).toBe(realpathSync(join(root, 'real.cjs')));
  });
});

describe('createTodoSkillRunner', () => {
  it('runs node on the real script path with the command, the brain as cwd and no shell', async () => {
    const { root, log, env } = setup();
    const calls: { file: string; args: readonly string[]; shell: unknown; cwd: unknown; stdio: unknown }[] =
      [];
    const spy: TodoSpawner = (file, args, options) => {
      calls.push({ file, args, shell: options.shell, cwd: options.cwd, stdio: options.stdio });
      return spawn(file, args, options);
    };
    await createTodoSkillRunner(root, { env, spawn: spy }).run({ kind: 'delete', id: '20261112-thing.md' });
    const realRoot = realpathSync(root);
    expect(calls).toEqual([
      {
        file: process.execPath,
        args: [join(realRoot, TODO_SCRIPT), 'delete'],
        shell: false,
        cwd: realRoot,
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    ]);
    const [start] = readLog(log);
    expect(start?.argv).toEqual([join(realRoot, TODO_SCRIPT), 'delete']);
    expect(start?.cwd).toBe(realRoot);
  });

  it('sends the payload as JSON on stdin, one command per kind', async () => {
    const { root, log, env } = setup();
    const runner = createTodoSkillRunner(root, { env });
    await runner.run({ kind: 'add', title: 'Call Ben', due: null, assignee: 'sam' });
    await runner.run({ kind: 'edit', id: 'a.md', title: 'T', details: 'D' });
    await runner.run({ kind: 'due', id: 'a.md', due: '2026-12-01' });
    await runner.run({ kind: 'assignee', id: 'a.md', assignee: null });
    await runner.run({ kind: 'delete', id: 'a.md' });
    const starts = readLog(log).filter((c) => c.at === 'start');
    expect(starts.map((c) => c.argv[1])).toEqual(['add', 'edit', 'due', 'assignee', 'delete']);
    expect(starts.map((c) => JSON.parse(c.stdin))).toEqual([
      { title: 'Call Ben', due: '', assignee: 'sam' },
      { file: 'a.md', title: 'T', body: 'D' },
      { file: 'a.md', due: '2026-12-01' },
      { file: 'a.md', assignee: '' },
      { file: 'a.md', via: 'TDS Brain App' },
    ]);
  });

  it('sends who is deleting when the app knows them', () => {
    expect(
      scriptPayload({ kind: 'delete', id: 'a.md' }, { name: "Mary O'Neil", slug: 'mary-oneil' }),
    ).toEqual({
      file: 'a.md',
      via: 'TDS Brain App',
      by: 'mary-oneil',
      by_name: "Mary O'Neil",
    });
  });

  it('passes BRAIN_ROOT and a scrubbed environment, without WORKBENCH_AS or NODE_OPTIONS', async () => {
    const { root, log, env } = setup(
      {},
      {
        WORKBENCH_AS: 'someone-else',
        NODE_OPTIONS: '--no-warnings',
        ANTHROPIC_API_KEY: 'sk-test',
        BRAIN_ROOT: '/somewhere/else',
        KEEP_ME: 'kept',
      },
    );
    await createTodoSkillRunner(root, { env }).run({ kind: 'delete', id: 'a.md' });
    expect(readLog(log)[0]?.env).toEqual({ BRAIN_ROOT: realpathSync(root), KEEP_ME: 'kept' });
  });

  it('writes nothing in the brain itself', async () => {
    const { root, env } = setup();
    const before = snapshot(root);
    await createTodoSkillRunner(root, { env }).run({ kind: 'delete', id: '20261112-thing.md' });
    expect(snapshot(root)).toEqual(before);
  });

  it('maps exit 2 with status 400 and 404 to its own plain messages, never the script text', async () => {
    const bad = setup({ exit: 2, out: '{"error":"title required","status":400}\n' });
    expect(
      await codeOf(createTodoSkillRunner(bad.root, { env: bad.env }).run({ kind: 'delete', id: 'a.md' })),
    ).toEqual({ code: 'bad-request', message: TODO_CHANGE_MESSAGES['bad-request'] });
    const gone = setup({ exit: 2, out: '{"error":"not found","status":404}\n' });
    expect(
      await codeOf(createTodoSkillRunner(gone.root, { env: gone.env }).run({ kind: 'delete', id: 'a.md' })),
    ).toEqual({ code: 'not-found', message: TODO_CHANGE_MESSAGES['not-found'] });
  });

  it('treats a 500, another exit code, a bad reply or a crash as internal', async () => {
    for (const reply of [
      { exit: 2, out: '{"error":"disk","status":500}\n' },
      { exit: 2, out: 'not json' },
      { exit: 2, out: '{"error":"x"}' },
      { exit: 1, out: '{"error":"boom","status":400}' },
      { exit: 0, out: 'not json' },
      { exit: 0, out: '' },
      { exit: 0, out: '[1]' },
    ]) {
      const { root, env } = setup(reply);
      expect(
        await codeOf(createTodoSkillRunner(root, { env }).run({ kind: 'delete', id: 'a.md' })),
        JSON.stringify(reply),
      ).toEqual({ code: 'internal', message: TODO_CHANGE_MESSAGES.internal });
    }
  });

  it('kills a script that runs too long', async () => {
    const { root, log, env } = setup({ hang: true });
    const started = Date.now();
    const result = await codeOf(
      createTodoSkillRunner(root, { env, timeoutMs: 300 }).run({ kind: 'delete', id: 'a.md' }),
    );
    expect(result?.code).toBe('internal');
    expect(Date.now() - started).toBeLessThan(5000);
    const pid = readLog(log)[0]?.pid as number;
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('refuses a reply larger than the cap', async () => {
    const { root, env } = setup({ bytes: TODO_SCRIPT_MAX_OUTPUT_BYTES + 10 });
    expect(
      (await codeOf(createTodoSkillRunner(root, { env }).run({ kind: 'delete', id: 'a.md' })))?.code,
    ).toBe('internal');
  });

  it('refuses, without running it, a script whose real path is outside the brain', async () => {
    const { root, log, env } = setup();
    const outside = tempDir('tba-outside-');
    writeFileSync(join(outside, 'todo.cjs'), FAKE_SCRIPT);
    rmSync(join(root, TODO_SCRIPT));
    symlinkSync(join(outside, 'todo.cjs'), join(root, TODO_SCRIPT));
    let spawned = false;
    const spy: TodoSpawner = (file, args, options) => {
      spawned = true;
      return spawn(file, args, options);
    };
    expect(
      (await codeOf(createTodoSkillRunner(root, { env, spawn: spy }).run({ kind: 'delete', id: 'a.md' })))
        ?.code,
    ).toBe('internal');
    expect(spawned).toBe(false);
    expect(readLog(log)).toEqual([]);
  });

  it('is internal when the script is missing or node cannot start', async () => {
    const missing = makeBrain(null);
    expect((await codeOf(createTodoSkillRunner(missing).run({ kind: 'delete', id: 'a.md' })))?.code).toBe(
      'internal',
    );
    const { root, env } = setup();
    const broken: TodoSpawner = (_file, args, options) => spawn('/nonexistent/node-binary', args, options);
    expect(
      (await codeOf(createTodoSkillRunner(root, { env, spawn: broken }).run({ kind: 'delete', id: 'a.md' })))
        ?.code,
    ).toBe('internal');
  });

  it('runs one change at a time, in the order asked, and carries on after a failure', async () => {
    const { root, log, env } = setup({ sleepMs: 150 });
    const runner = createTodoSkillRunner(root, { env });
    const results = await Promise.allSettled([
      runner.run({ kind: 'delete', id: 'a.md' }),
      runner.run({ kind: 'delete', id: 'b.md' }),
      runner.run({ kind: 'delete', id: 'c.md' }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    const lines = readLog(log);
    expect(lines.map((l) => l.at)).toEqual(['start', 'end', 'start', 'end', 'start', 'end']);
    expect(lines.filter((l) => l.at === 'start').map((l) => JSON.parse(l.stdin).file)).toEqual([
      'a.md',
      'b.md',
      'c.md',
    ]);

    const failing = setup({ exit: 2, out: '{"error":"x","status":404}' });
    const r2 = createTodoSkillRunner(failing.root, { env: failing.env });
    const [first, second] = await Promise.allSettled([
      r2.run({ kind: 'delete', id: 'a.md' }),
      r2.run({ kind: 'delete', id: 'b.md' }),
    ]);
    expect(first.status).toBe('rejected');
    expect(second.status).toBe('rejected');
    expect(readLog(failing.log).filter((l) => l.at === 'start')).toHaveLength(2);
  });
});
