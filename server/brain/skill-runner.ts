/**
 * The generic part of running a brain skill's script: spawn node on it without a shell, pipe one JSON
 * object in, read one JSON line out, with a timeout and an output cap, plus the capabilities probe
 * cached by script real path and mtime. Shared by `todo-skill.ts` and `files-skill.ts`.
 */
import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, sep } from 'node:path';
import { scrubEnv } from '../engine/session-manager.ts';
import { isDir } from './util.ts';

/** Starts a child process. Tests inject one to see the arguments or to fail the start. */
export type ScriptSpawner = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface ScriptOptions {
  spawn?: ScriptSpawner;
  /** The environment to scrub and pass on. Default: this process's. */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

/** Variables the script must not inherit: `WORKBENCH_AS` would act as someone else, `NODE_OPTIONS` could load code. */
export const DROPPED_ENV = ['WORKBENCH_AS', 'NODE_OPTIONS'];

export interface Outcome {
  code: number | null;
  stdout: string;
  failed: boolean;
}

export function inside(child: string, parent: string): boolean {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * The real path of a skill's script when its folder exists and the script is a regular file inside the
 * brain's real path. `folder: false` means the skill isn't there at all; `script: null` means it is,
 * but unusable.
 */
export async function locateScript(
  root: string,
  skill: string,
  script: string,
): Promise<{ folder: boolean; script: string | null }> {
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    return { folder: false, script: null };
  }
  if (!(await isDir(join(realRoot, '.claude', 'skills', skill)))) return { folder: false, script: null };
  try {
    const real = await fs.realpath(join(realRoot, script));
    if (!inside(real, realRoot)) return { folder: true, script: null };
    return { folder: true, script: (await fs.stat(real)).isFile() ? real : null };
  } catch {
    return { folder: true, script: null };
  }
}

export function runScript(
  script: string,
  realRoot: string,
  command: string,
  input: string,
  opts: Required<ScriptOptions>,
): Promise<Outcome> {
  return new Promise((resolve) => {
    const env: Record<string, string> = { ...scrubEnv(opts.env), BRAIN_ROOT: realRoot };
    for (const key of DROPPED_ENV) delete env[key];
    let child: ChildProcess;
    try {
      child = opts.spawn(process.execPath, [script, command], {
        cwd: realRoot,
        env,
        shell: false,
        // stderr is ignored by the agreement; not piping it means a chatty script can't fill a pipe and stall.
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      resolve({ code: null, stdout: '', failed: true });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    let settled = false;
    const kill = () => {
      failed = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(kill, opts.timeoutMs);
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks).toString('utf8'), failed });
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > opts.maxOutputBytes) kill();
      else chunks.push(chunk);
    });
    child.on('error', () => {
      failed = true;
      finish(null);
    });
    child.on('close', (code) => finish(code));
    // A script that exits without reading stdin makes this write fail; the exit code tells the story.
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

export function parseReply(stdout: string): Record<string, unknown> | null {
  try {
    const j: unknown = JSON.parse(stdout.trim());
    return typeof j === 'object' && j !== null && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Runs jobs one at a time, in the order they were asked for; one job's failure never stops the next. */
export function createQueue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (job) => {
    const next = tail.then(job);
    tail = next.catch(() => {});
    return next;
  };
}

/**
 * A `capabilities` probe, cached per script real path and mtime. `settledNone(reply)` says a refusal
 * (exit 2) is a settled "no features" answer (an older script that doesn't know the command), which is
 * cached too. A crash or timeout is not: try again next time.
 */
export function createCapabilityProbe(
  root: string,
  findScript: () => Promise<string | null>,
  opts: Required<ScriptOptions>,
  settledNone: (reply: Record<string, unknown>) => boolean,
): () => Promise<readonly string[]> {
  let probed: { key: string; features: readonly string[] } | null = null;
  return async () => {
    let script: string | null;
    let realRoot: string;
    let key: string;
    try {
      script = await findScript();
      if (!script) return [];
      realRoot = await fs.realpath(root);
      key = `${script}\0${(await fs.stat(script)).mtimeMs}`;
    } catch {
      return [];
    }
    if (probed?.key === key) return probed.features;
    const outcome = await runScript(script, realRoot, 'capabilities', '{}', opts);
    const reply = outcome.failed ? null : parseReply(outcome.stdout);
    let features: string[] | null = null;
    if (reply !== null && outcome.code === 0 && Array.isArray(reply.features))
      features = reply.features.filter((f): f is string => typeof f === 'string');
    else if (reply !== null && outcome.code === 2 && settledNone(reply)) features = [];
    if (features === null) return [];
    probed = { key, features };
    return features;
  };
}

export function withDefaults(
  options: ScriptOptions,
  timeoutMs: number,
  maxOutputBytes: number,
): Required<ScriptOptions> {
  return {
    spawn: options.spawn ?? nodeSpawn,
    env: options.env ?? process.env,
    timeoutMs: options.timeoutMs ?? timeoutMs,
    maxOutputBytes: options.maxOutputBytes ?? maxOutputBytes,
  };
}
