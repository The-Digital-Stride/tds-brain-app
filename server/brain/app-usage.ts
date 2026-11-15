/**
 * Hands one chat's shadow record to the brain's `tdsapp-kits` script (plan 2026-11-15-startup-kits,
 * decisions 10-11). Run the way `skill-levels.ts` runs its script: no shell, a scrubbed environment,
 * a short timeout, capped output. First `capabilities` (once per app run, must list APP_USAGE_CAPABILITY),
 * then `usage` with one AppUsageEvent as JSON on stdin. The app never writes the brain itself.
 *
 * `chat` is sha256(salt + sdkSessionId), first 16 hex characters; the salt is random per install and
 * stays in the app's data folder, so the raw session id never leaves this Mac. A missing script is one
 * log line per app run and resolves 'not-installed'. Nothing here throws.
 */
import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, sep } from 'node:path';
import {
  APP_USAGE_CAPABILITY,
  APP_USAGE_SALT_FILE,
  APP_USAGE_SCRIPT,
  type AppUsageEvent,
  KITS_MODE,
  type KitShadowRecord,
} from '../../shared/kits-contract.ts';
import { scrubEnv } from '../engine/session-manager.ts';

/** 'sent': the script accepted it. 'not-installed': no script. 'failed': try again later. */
export type AppUsageResult = 'sent' | 'not-installed' | 'failed';

export type AppUsageSpawner = (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface AppUsageOptions {
  /** The brain's folder now (it can change); null = none yet. */
  brainRoot: () => string | null;
  /** The app's data folder, for the salt. Null = a random salt kept in memory only (tests). */
  dataDir: string | null;
  /** The app's version (`package.json`). */
  appVersion: string;
  spawn?: AppUsageSpawner;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** One short line at a time; never chat content. */
  log?: (line: string) => void;
}

export interface AppUsage {
  /** Sends one record. Never rejects. */
  send(sdkSessionId: string, record: KitShadowRecord): Promise<AppUsageResult>;
  /** `sha256(salt + id)`, first 16 hex characters. */
  chatHash(sdkSessionId: string): Promise<string>;
}

const TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 16_384;

const inside = (child: string, parent: string): boolean =>
  child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** The script's real path when it is a regular file inside the brain's real path, else null. */
async function findScript(root: string): Promise<{ script: string; realRoot: string } | null> {
  try {
    const realRoot = await fs.realpath(root);
    const real = await fs.realpath(join(realRoot, APP_USAGE_SCRIPT));
    if (!inside(real, realRoot)) return null;
    return (await fs.stat(real)).isFile() ? { script: real, realRoot } : null;
  } catch {
    return null;
  }
}

interface Outcome {
  code: number | null;
  stdout: string;
  failed: boolean;
}

function run(
  script: string,
  realRoot: string,
  command: string,
  input: string,
  opts: Required<Pick<AppUsageOptions, 'spawn' | 'env' | 'timeoutMs' | 'maxOutputBytes'>>,
): Promise<Outcome> {
  return new Promise((resolve) => {
    const env: Record<string, string> = { ...scrubEnv(opts.env), BRAIN_ROOT: realRoot };
    delete env.NODE_OPTIONS;
    let child: ChildProcess;
    try {
      child = opts.spawn(process.execPath, [script, command], {
        cwd: realRoot,
        env,
        shell: false,
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
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

/** `capabilities` answers `{"capabilities":["app-event-v1", ...]}` (a bare array is accepted too). */
function listsCapability(stdout: string): boolean {
  try {
    const j: unknown = JSON.parse(stdout.trim());
    const list = Array.isArray(j) ? j : (j as { capabilities?: unknown } | null)?.capabilities;
    return Array.isArray(list) && list.includes(APP_USAGE_CAPABILITY);
  } catch {
    return false;
  }
}

export function createAppUsage(options: AppUsageOptions): AppUsage {
  const log = options.log ?? (() => {});
  const opts = {
    spawn: options.spawn ?? nodeSpawn,
    env: options.env ?? process.env,
    timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes ?? MAX_OUTPUT_BYTES,
  };
  let saltPromise: Promise<string> | null = null;
  let loggedMissing = false;
  let loggedCapability = false;
  let capable: { script: string; ok: boolean } | null = null;
  let tail: Promise<unknown> = Promise.resolve();

  function salt(): Promise<string> {
    saltPromise ??= (async () => {
      const file = options.dataDir ? join(options.dataDir, APP_USAGE_SALT_FILE) : null;
      let invalid = false;
      if (file) {
        try {
          const text = (await fs.readFile(file, 'utf8')).trim();
          if (/^[0-9a-f]{32,}$/.test(text)) return text;
          invalid = true;
        } catch {
          // missing: make one below
        }
      }
      const fresh = randomBytes(32).toString('hex');
      if (file && options.dataDir) {
        try {
          await fs.mkdir(options.dataDir, { recursive: true });
          if (invalid) {
            // Replace a damaged file in one step, so every later run keeps this salt.
            const tmp = `${file}.${process.pid}.tmp`;
            await fs.writeFile(tmp, `${fresh}\n`, { mode: 0o600 });
            await fs.rename(tmp, file);
            log('The app usage salt file was invalid, so it was replaced.');
          } else {
            await fs.writeFile(file, `${fresh}\n`, { mode: 0o600, flag: 'wx' });
          }
        } catch {
          // another run may have made it first: use theirs when it reads, else keep ours in memory
          try {
            const text = (await fs.readFile(file, 'utf8')).trim();
            if (/^[0-9a-f]{32,}$/.test(text)) return text;
          } catch {
            // in memory only this run
          }
        }
      }
      return fresh;
    })();
    return saltPromise;
  }

  async function chatHash(id: string): Promise<string> {
    return createHash('sha256')
      .update((await salt()) + id)
      .digest('hex')
      .slice(0, 16);
  }

  async function sendOnce(id: string, record: KitShadowRecord): Promise<AppUsageResult> {
    const root = options.brainRoot();
    const found = root ? await findScript(root) : null;
    if (!found) {
      if (!loggedMissing) {
        loggedMissing = true;
        log('The brain has no tdsapp-kits script yet, so start-up kit records wait.');
      }
      return 'not-installed';
    }
    if (capable?.script !== found.script) {
      const out = await run(found.script, found.realRoot, 'capabilities', '', opts);
      capable = { script: found.script, ok: out.code === 0 && !out.failed && listsCapability(out.stdout) };
    }
    if (!capable.ok) {
      capable = null; // look again next time: the script may be updated while the app runs
      if (!loggedCapability) {
        loggedCapability = true;
        log('The brain tdsapp-kits script is too old for start-up kit records, so they wait.');
      }
      return 'failed';
    }
    const { handedOffSeq: _omit, ...rest } = record;
    const event: AppUsageEvent = {
      ...rest,
      event: 'app',
      chat: await chatHash(id),
      mode: KITS_MODE,
      app: options.appVersion,
    };
    const out = await run(found.script, found.realRoot, 'usage', JSON.stringify(event), opts);
    return out.code === 0 && !out.failed ? 'sent' : 'failed';
  }

  return {
    chatHash,
    send(id, record) {
      // One at a time, in order, so the script never runs twice at once.
      const next = tail.then(() => sendOnce(id, record)).catch((): AppUsageResult => 'failed');
      tail = next;
      return next;
    },
  };
}
