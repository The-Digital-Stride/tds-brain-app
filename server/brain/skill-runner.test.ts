import type { SpawnOptions } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createCapabilityProbe,
  createQueue,
  locateScript,
  runScript,
  type ScriptOptions,
  withDefaults,
} from './skill-runner.ts';

const made: string[] = [];
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'tba-runner-'));
  made.push(d);
  return d;
}

const SCRIPT = `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const r = JSON.parse(process.env.REPLY || '{}');
  if (process.env.COUNT) require('node:fs').appendFileSync(process.env.COUNT, process.argv[2] + '\\n');
  if (r.hang) { setInterval(() => {}, 1000); return; }
  if (r.bytes) { process.stdout.write('x'.repeat(r.bytes)); return; }
  process.stdout.write(r.out === undefined ? JSON.stringify({ argv: process.argv.slice(2), input, root: process.env.BRAIN_ROOT }) : r.out);
  process.exitCode = r.exit || 0;
});
`;

function brain(): { root: string; script: string } {
  const root = tempDir();
  mkdirSync(join(root, '.claude', 'skills', 'demo', 'scripts'), { recursive: true });
  const script = join(root, '.claude', 'skills', 'demo', 'scripts', 'demo.cjs');
  writeFileSync(script, SCRIPT);
  return { root, script };
}

const opts = (env: NodeJS.ProcessEnv = {}, more: ScriptOptions = {}) =>
  withDefaults({ env: { PATH: process.env.PATH, ...env }, ...more }, 5000, 65_536);

describe('runScript', () => {
  it('sends one JSON object on stdin and the fixed command as the only argument', async () => {
    const { root, script } = brain();
    const out = await runScript(script, root, 'delete', '{"a":1}', opts({ REPLY: '{}' }));
    expect(out.failed).toBe(false);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toMatchObject({ argv: ['delete'], input: '{"a":1}' });
  });

  it('starts node without a shell, with a scrubbed environment and no stderr pipe', async () => {
    const { root, script } = brain();
    const seen: { file: string; args: readonly string[]; options: SpawnOptions }[] = [];
    const fake = ((file: string, args: readonly string[], options: SpawnOptions) => {
      seen.push({ file, args, options });
      throw new Error('stop');
    }) as unknown as ScriptOptions['spawn'];
    const out = await runScript(
      script,
      root,
      'purge',
      '{}',
      opts(
        { NODE_OPTIONS: '--require x', WORKBENCH_AS: 'sam', ANTHROPIC_API_KEY: 'k', KEEP: '1' },
        { spawn: fake },
      ),
    );
    expect(out.failed).toBe(true);
    const call = seen[0];
    expect(call?.file).toBe(process.execPath);
    expect(call?.args).toEqual([script, 'purge']);
    expect(call?.options.shell).toBe(false);
    expect(call?.options.cwd).toBe(root);
    expect(call?.options.stdio).toEqual(['pipe', 'pipe', 'ignore']);
    const env = call?.options.env ?? {};
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.WORKBENCH_AS).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.BRAIN_ROOT).toBe(root);
  });

  it('fails a script that makes more output than the cap', async () => {
    const { root, script } = brain();
    const out = await runScript(
      script,
      root,
      'x',
      '{}',
      opts({ REPLY: '{"bytes":5000}' }, { maxOutputBytes: 100 }),
    );
    expect(out.failed).toBe(true);
  });

  it('kills a script that runs past the timeout', async () => {
    const { root, script } = brain();
    const out = await runScript(
      script,
      root,
      'x',
      '{}',
      opts({ REPLY: '{"hang":true}' }, { timeoutMs: 200 }),
    );
    expect(out.failed).toBe(true);
  });
});

describe('locateScript', () => {
  it('finds a regular file inside the brain', async () => {
    const { root, script } = brain();
    const found = await locateScript(root, 'demo', '.claude/skills/demo/scripts/demo.cjs');
    expect(found.folder).toBe(true);
    expect(found.script).toBe(await import('node:fs/promises').then((f) => f.realpath(script)));
  });

  it('says the skill is missing, or unusable when the script is missing or links outside', async () => {
    const { root } = brain();
    expect(await locateScript(root, 'nope', '.claude/skills/nope/s.cjs')).toEqual({
      folder: false,
      script: null,
    });
    expect(await locateScript(root, 'demo', '.claude/skills/demo/scripts/missing.cjs')).toEqual({
      folder: true,
      script: null,
    });
    const outside = tempDir();
    writeFileSync(join(outside, 'evil.cjs'), SCRIPT);
    symlinkSync(join(outside, 'evil.cjs'), join(root, '.claude', 'skills', 'demo', 'scripts', 'link.cjs'));
    expect(await locateScript(root, 'demo', '.claude/skills/demo/scripts/link.cjs')).toEqual({
      folder: true,
      script: null,
    });
  });
});

describe('createQueue', () => {
  it('runs jobs one at a time in order, and a failure does not stop the next', async () => {
    const q = createQueue();
    const order: string[] = [];
    const slow = q(async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push('a');
    });
    const bad = q(async () => {
      order.push('b');
      throw new Error('x');
    });
    const last = q(async () => {
      order.push('c');
      return 3;
    });
    await slow;
    await expect(bad).rejects.toThrow();
    expect(await last).toBe(3);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});

describe('createCapabilityProbe', () => {
  function probeFor(root: string, script: string, env: NodeJS.ProcessEnv) {
    return createCapabilityProbe(
      root,
      async () => script,
      opts(env),
      (r) => r.status === 400,
    );
  }

  it('reads the features once per script version and asks again when the file changes', async () => {
    const { root, script } = brain();
    const count = join(tempDir(), 'count.txt');
    const reply = JSON.stringify({ out: '{"ok":true,"features":["a","b",3]}' });
    const probe = probeFor(root, script, { REPLY: reply, COUNT: count });
    expect(await probe()).toEqual(['a', 'b']);
    expect(await probe()).toEqual(['a', 'b']);
    expect(readFileSync(count, 'utf8').trim().split('\n')).toEqual(['capabilities']);
    const later = new Date(Date.now() + 5000);
    utimesSync(script, later, later);
    await probe();
    expect(readFileSync(count, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('caches a settled refusal but not a crash', async () => {
    const { root, script } = brain();
    const count = join(tempDir(), 'count.txt');
    const refused = probeFor(root, script, {
      REPLY: JSON.stringify({ out: '{"status":400}', exit: 2 }),
      COUNT: count,
    });
    expect(await refused()).toEqual([]);
    expect(await refused()).toEqual([]);
    expect(readFileSync(count, 'utf8').trim().split('\n')).toHaveLength(1);
    const crashDir = tempDir();
    const crash = probeFor(root, script, {
      REPLY: JSON.stringify({ out: 'not json', exit: 1 }),
      COUNT: join(crashDir, 'c'),
    });
    await crash();
    await crash();
    expect(readFileSync(join(crashDir, 'c'), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('gives no features when there is no script', async () => {
    const probe = createCapabilityProbe(
      tempDir(),
      async () => null,
      opts(),
      () => true,
    );
    expect(await probe()).toEqual([]);
  });
});
