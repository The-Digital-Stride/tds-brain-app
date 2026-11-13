/**
 * Git-history fallback for "who passed this to-do on" (plan 2026-11-13-todo-handover-search-scope,
 * decision 5). Asks git who last changed the `assignee:` line of a TDS to-do file. Read-only: no shell,
 * the brain as the working folder, a scrubbed environment, a short timeout and a few runs at a time.
 * Any failure (not a git repo, git missing, timeout) is "not known".
 */
import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { scrubEnv } from '../engine/session-manager.ts';

/** Who made the commit, as git records them. */
export interface GitAuthor {
  name: string;
  email: string;
  /** Author date, ISO 8601. */
  at: string;
  /** Whether that commit's patch adds an `assigned_at:` line, i.e. it was a stamped hand-over. */
  addsStamp: boolean;
}

/** Runs git with these arguments in `cwd`; resolves with stdout, rejects on any failure. Tests inject one. */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<string>;

export const GIT_TIMEOUT_MS = 5000;
export const GIT_MAX_PARALLEL = 4;
/** The commit header and the start of its patch; a longer patch is cut, not refused. */
const GIT_MAX_OUTPUT = 65_536;

/** The scrubbed environment without any GIT_* variable (they can redirect git elsewhere or run programs). */
export function gitEnv(): Record<string, string> {
  const env = scrubEnv(process.env);
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('GIT_')) delete env[key];
  return { ...env, GIT_OPTIONAL_LOCKS: '0' };
}

export const defaultGitRunner: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = nodeSpawn('git', [...args], {
        cwd,
        env: gitEnv(),
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (err) {
      reject(err);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const end = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      end(() => reject(new Error('git timed out')));
    }, GIT_TIMEOUT_MS);
    child.stdout?.on('data', (c: Buffer) => {
      size += c.length;
      if (size > GIT_MAX_OUTPUT) {
        child.kill('SIGKILL');
        end(() => resolve(Buffer.concat(chunks).toString('utf8')));
      } else chunks.push(c);
    });
    child.on('error', (err) => end(() => reject(err)));
    child.on('close', (code) =>
      end(() =>
        code === 0 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error('git failed')),
      ),
    );
  });

export interface TodoHistory {
  /** The author of the last commit that touched the file's `assignee:` line, or null (cached, nulls too). */
  lastAssigneeEdit(root: string, id: string, version: string): Promise<GitAuthor | null>;
  /** Whether that lookup is already cached (so it costs no git run). */
  isCached(root: string, id: string, version: string): boolean;
}

/** The git arguments; the id has already been checked as a plain file name. */
export function historyArgs(id: string): string[] {
  return [
    'log',
    '-n',
    '1',
    '-G',
    '^assignee:',
    '-p',
    '--no-ext-diff',
    '--no-textconv',
    '--format=%an%x00%ae%x00%aI',
    '--',
    `todo/${id}`,
  ];
}

function parseAuthor(stdout: string): GitAuthor | null {
  const newline = stdout.indexOf('\n');
  const header = (newline === -1 ? stdout : stdout.slice(0, newline)).trim();
  const patch = newline === -1 ? '' : stdout.slice(newline + 1);
  const [name, email, at] = header.split('\0');
  if (!name || !at || Number.isNaN(Date.parse(at))) return null;
  return {
    name: name.trim(),
    email: (email ?? '').trim(),
    at,
    addsStamp: /^\+assigned_at:/m.test(patch),
  };
}

export function createTodoHistory(run: GitRunner = defaultGitRunner): TodoHistory {
  const cache = new Map<string, Promise<GitAuthor | null>>();
  let active = 0;
  const waiting: (() => void)[] = [];

  const slot = async <T>(job: () => Promise<T>): Promise<T> => {
    if (active >= GIT_MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await job();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };

  return {
    isCached: (root, id, version) => cache.has(`${root}\0${id}\0${version}`),
    lastAssigneeEdit(root, id, version) {
      const key = `${root}\0${id}\0${version}`;
      const hit = cache.get(key);
      if (hit) return hit;
      if (cache.size >= 2000) cache.clear();
      const lookup = slot(async () => {
        try {
          return parseAuthor(await run(historyArgs(id), root));
        } catch {
          return null;
        }
      });
      cache.set(key, lookup);
      return lookup;
    },
  };
}
