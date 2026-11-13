import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createRunner } from './run.ts';

const node = process.execPath;
const base = { cwd: process.cwd(), env: process.env };

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const runners: ReturnType<typeof createRunner>[] = [];
const make = (opts?: Parameters<typeof createRunner>[0]) => {
  const r = createRunner(opts);
  runners.push(r);
  return r;
};
afterEach(() => {
  for (const r of runners.splice(0)) r.killAll();
});

describe('createRunner', () => {
  it('uses spawn, detached, with no shell', async () => {
    const calls: { file: string; args: readonly string[]; opts: Record<string, unknown> }[] = [];
    const fakeSpawn = ((file: string, args: readonly string[], opts: Record<string, unknown>) => {
      calls.push({ file, args, opts });
      const child = Object.assign(new EventEmitter(), {
        pid: 999_999,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      setImmediate(() => {
        child.stdout.end('hello\n');
        child.stderr.end();
        child.emit('exit', 0, null);
        child.emit('close', 0, null);
      });
      return child;
    }) as unknown as typeof spawn;
    const run = make({ spawn: fakeSpawn });
    const r = await run('git', ['status', '--porcelain'], { ...base, timeoutMs: 5_000 });
    expect(r).toEqual({ code: 0, stdout: 'hello\n', tail: 'hello', timedOut: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe('git');
    expect(calls[0]?.args).toEqual(['status', '--porcelain']);
    expect(calls[0]?.opts.detached).toBe(true);
    expect(calls[0]?.opts.shell).toBeFalsy();
    expect(calls[0]?.opts.cwd).toBe(base.cwd);
  });

  it('keeps stdout past the 1 MB execFile buffer', async () => {
    const run = make();
    const r = await run(node, ['-e', "process.stdout.write('x'.repeat(1_500_000))"], {
      ...base,
      timeoutMs: 20_000,
    });
    expect(r.code).toBe(0);
    expect(r.stdout.length).toBe(1_500_000);
  });

  it('caps stdout at the limit', async () => {
    const run = make({ maxStdoutBytes: 1000 });
    const r = await run(node, ['-e', "process.stdout.write('y'.repeat(5000))"], {
      ...base,
      timeoutMs: 20_000,
    });
    expect(r.code).toBe(0);
    expect(r.stdout.length).toBe(1000);
  });

  it('gives a non-zero code for a failing command', async () => {
    const run = make();
    const r = await run(node, ['-e', 'process.exit(3)'], { ...base, timeoutMs: 20_000 });
    expect(r).toMatchObject({ code: 3, timedOut: false });
  });

  it('never rejects when the command cannot be started', async () => {
    const run = make();
    const r = await run('/no/such/command-here', [], { ...base, timeoutMs: 5_000 });
    expect(r.code).not.toBe(0);
    expect(r.timedOut).toBe(false);
  });

  it('keeps the last 20 lines of output in tail', async () => {
    const run = make();
    const r = await run(node, ['-e', 'for (let i = 1; i <= 30; i++) console.log("line " + i)'], {
      ...base,
      timeoutMs: 20_000,
    });
    const lines = r.tail.split('\n');
    expect(lines).toHaveLength(20);
    expect(lines[0]).toBe('line 11');
    expect(lines[19]).toBe('line 30');
  });

  it('includes stderr in tail but not in stdout', async () => {
    const run = make();
    const r = await run(node, ['-e', 'console.error("went wrong"); process.exit(1)'], {
      ...base,
      timeoutMs: 20_000,
    });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.tail).toBe('went wrong');
  });

  it('on timeout kills the whole process group, child processes too', async () => {
    const run = make();
    const script = `
      const { spawn } = require('node:child_process');
      const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
      console.log(c.pid);
      setInterval(() => {}, 1000);
    `;
    const started = Date.now();
    const r = await run(node, ['-e', script], { ...base, timeoutMs: 800 });
    expect(r.timedOut).toBe(true);
    expect(r.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(8_000);
    const grandchild = Number(r.stdout.trim());
    expect(grandchild).toBeGreaterThan(0);
    await new Promise((res) => setTimeout(res, 200));
    expect(alive(grandchild)).toBe(false);
  });

  it('uses SIGKILL when SIGTERM is ignored', async () => {
    const run = make({ killGraceMs: 300 });
    const r = await run(
      node,
      ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"],
      { ...base, timeoutMs: 500 },
    );
    expect(r.timedOut).toBe(true);
    expect(r.code).not.toBe(0);
  });

  it('killAll kills every running group', async () => {
    const run = make();
    const opts = { ...base, timeoutMs: 60_000 };
    const a = run(node, ['-e', 'setInterval(() => {}, 1000)'], opts);
    const b = run(node, ['-e', 'setInterval(() => {}, 1000)'], opts);
    await new Promise((res) => setTimeout(res, 300));
    run.killAll();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.code).not.toBe(0);
    expect(rb.code).not.toBe(0);
    expect(ra.timedOut).toBe(false);
  });
});
