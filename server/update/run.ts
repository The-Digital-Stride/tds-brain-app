/**
 * The command runner for in-app updates (docs/plans/2026-11-13-in-app-updates.md, decisions 1 and 5).
 * `spawn` with no shell and fixed arguments, `detached` so each command leads its own process group:
 * a timeout or `killAll()` then kills the whole group (pnpm and its children outlive npx otherwise).
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { constants } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import type { UpdateCommandResult, UpdateCommandRunner } from '../../shared/update-contract.ts';

/** Lines of combined stdout and stderr kept for the server log. */
export const TAIL_LINES = 20;
/** stdout is kept whole (for `git show`) up to this size; the rest is dropped. */
export const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
/** After SIGTERM, how long a group gets before SIGKILL. */
export const KILL_GRACE_MS = 5_000;

/** The combined output kept for `tail` is trimmed back to this many characters when it grows past twice it. */
const TAIL_KEEP_CHARS = 32 * 1024;

export interface RunnerOptions {
  /** Injectable for tests. */
  spawn?: typeof nodeSpawn;
  maxStdoutBytes?: number;
  killGraceMs?: number;
}

const killGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
};

const lastLines = (text: string, n: number): string => {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
  return lines.slice(-n).join('\n');
};

export function createRunner(options: RunnerOptions = {}): UpdateCommandRunner {
  const spawn = options.spawn ?? nodeSpawn;
  const maxStdout = options.maxStdoutBytes ?? MAX_STDOUT_BYTES;
  const grace = options.killGraceMs ?? KILL_GRACE_MS;
  const live = new Set<number>();

  /** SIGTERM now, SIGKILL after the grace period. The timer never holds the process open. */
  const terminate = (pid: number): void => {
    killGroup(pid, 'SIGTERM');
    setTimeout(() => killGroup(pid, 'SIGKILL'), grace).unref();
  };

  const run = ((file, args, opts) =>
    new Promise<UpdateCommandResult>((resolve) => {
      const out: Buffer[] = [];
      let outBytes = 0;
      let combined = '';
      let timedOut = false;
      let done = false;
      let timer: NodeJS.Timeout | undefined;
      let backstop: NodeJS.Timeout | undefined;
      let pid: number | undefined;

      const finish = (code: number): void => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (backstop) clearTimeout(backstop);
        if (pid !== undefined) live.delete(pid);
        const nonZero = timedOut && code === 0 ? 124 : code;
        resolve({
          code: nonZero,
          stdout: Buffer.concat(out).toString('utf8'),
          tail: lastLines(combined, TAIL_LINES),
          timedOut,
        });
      };

      const addCombined = (text: string): void => {
        combined += text;
        if (combined.length > TAIL_KEEP_CHARS * 2) combined = combined.slice(-TAIL_KEEP_CHARS);
      };

      let child: ReturnType<typeof nodeSpawn>;
      try {
        child = spawn(file, args, {
          cwd: opts.cwd,
          env: opts.env,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        addCombined(err instanceof Error ? err.message : String(err));
        finish(1);
        return;
      }
      pid = child.pid;
      if (pid !== undefined) live.add(pid);

      const outText = new StringDecoder('utf8');
      const errText = new StringDecoder('utf8');
      child.stdout?.on('data', (chunk: Buffer) => {
        if (outBytes < maxStdout) {
          const keep = chunk.subarray(0, maxStdout - outBytes);
          out.push(keep);
          outBytes += keep.length;
        }
        addCombined(outText.write(chunk));
      });
      child.stderr?.on('data', (chunk: Buffer) => addCombined(errText.write(chunk)));

      child.on('error', (err) => {
        addCombined(err.message);
        finish(1);
      });
      child.on('close', (code, signal) => {
        addCombined(outText.end() + errText.end());
        if (code !== null) finish(code);
        else finish(signal ? 128 + (constants.signals[signal] ?? 0) : 1);
      });

      timer = setTimeout(() => {
        timedOut = true;
        if (pid === undefined) return finish(1);
        terminate(pid);
        // If something still holds the pipes open after SIGKILL, give up waiting for them.
        backstop = setTimeout(() => finish(1), grace * 2 + 1_000);
        backstop.unref();
      }, opts.timeoutMs);
    })) as UpdateCommandRunner;

  run.killAll = () => {
    for (const pid of live) terminate(pid);
  };
  return run;
}
