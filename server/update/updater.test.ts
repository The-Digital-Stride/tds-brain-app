import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UPDATE_BLOCKED_TEXT,
  UPDATE_CHECK_EVERY_MS,
  UPDATE_FAILED_TEXT,
  UPDATE_FIRST_CHECK_AFTER_MS,
  UPDATE_MIN_FREE_BYTES,
  UPDATE_UNFINISHED_TEXT,
  type UpdateCommandResult,
  type UpdateCommandRunner,
  type UpdatePending,
  UpdateRefused,
  type Updater,
  type UpdaterDeps,
  type UpdateStatus,
} from '../../shared/update-contract.ts';
import { createRunner } from './run.ts';
import { compareVersions, createUpdater, PENDING_FILE } from './updater.ts';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const LATER = 'c'.repeat(40);

const CHANGELOG = `# Changelog

## v0.9.0 — 2026-11-12
- **feat**: In-app updates

## v0.8.3 — 2026-11-10
- **fix**: A fix

## v0.8.2 — 2026-11-09
- **fix**: Already have this

## v0.8.1 — 2026-11-08
- **fix**: Old
`;

interface Call {
  file: string;
  args: string[];
  opts: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv };
}
type Reply =
  | Partial<UpdateCommandResult>
  | ((call: Call) => Partial<UpdateCommandResult> | Promise<Partial<UpdateCommandResult>>);
type Rule = [RegExp, Reply];

const keyOf = (c: Pick<Call, 'file' | 'args'>): string => [c.file, ...c.args].join(' ');

/** Scripts a reply per command (the last matching rule wins) and records every call. */
function fakeRunner(rules: Rule[]) {
  const calls: Call[] = [];
  const run = (async (file, args, opts) => {
    const call = { file, args, opts };
    calls.push(call);
    const key = keyOf(call);
    for (let i = rules.length - 1; i >= 0; i--) {
      const [re, reply] = rules[i] as Rule;
      if (re.test(key)) {
        const r = typeof reply === 'function' ? await reply(call) : reply;
        return { code: 0, stdout: '', tail: '', timedOut: false, ...r };
      }
    }
    return { code: 0, stdout: '', tail: '', timedOut: false };
  }) as UpdateCommandRunner;
  run.killAll = vi.fn();
  return Object.assign(run, { calls, keys: () => calls.map(keyOf) });
}

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const exists = async (p: string): Promise<boolean> =>
  fs.access(p).then(
    () => true,
    () => false,
  );

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true });
});

interface SetupOptions {
  rules?: Rule[];
  deps?: Partial<UpdaterDeps>;
  marker?: UpdatePending | string;
  git?: boolean;
  npx?: boolean;
}

async function setup(o: SetupOptions = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'tds-update-'));
  roots.push(root);
  const appRoot = join(root, 'app');
  const clientDir = join(appRoot, 'dist', 'client');
  const nextDir = join(appRoot, 'dist', 'client.next');
  const prevDir = join(appRoot, 'dist', 'client.prev');
  const dataDir = join(root, 'data');
  const nodeBinDir = join(root, 'nodebin');
  await fs.mkdir(clientDir, { recursive: true });
  await fs.writeFile(join(clientDir, 'index.html'), 'old');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(nodeBinDir, { recursive: true });
  if (o.git !== false) await fs.mkdir(join(appRoot, '.git'));
  if (o.npx !== false) {
    await fs.writeFile(join(nodeBinDir, 'npx'), '#!/bin/sh\n');
    await fs.chmod(join(nodeBinDir, 'npx'), 0o755);
  }
  if (o.marker !== undefined) {
    const text = typeof o.marker === 'string' ? o.marker : JSON.stringify(o.marker);
    await fs.writeFile(join(dataDir, PENDING_FILE), text);
  }
  const rules: Rule[] = [
    [/^git rev-parse --git-dir$/, { stdout: '.git\n' }],
    [/^git symbolic-ref --quiet HEAD$/, { stdout: 'refs/heads/main\n' }],
    [/^git config --get branch\.main\.remote$/, { stdout: 'origin\n' }],
    [/^git config --get branch\.main\.merge$/, { stdout: 'refs/heads/main\n' }],
    [/^git status --porcelain$/, { stdout: '' }],
    [/^git fetch /, {}],
    [/^git rev-parse --verify --quiet refs\/remotes\/origin\/main\^\{commit\}$/, { stdout: `${NEW}\n` }],
    [new RegExp(`^git show ${NEW}:package.json$`), { stdout: '{ "name": "x", "version": "0.9.0" }' }],
    [new RegExp(`^git show ${NEW}:CHANGELOG.md$`), { stdout: CHANGELOG }],
    [/^git rev-parse HEAD$/, { stdout: `${OLD}\n` }],
    [/^git merge-base --is-ancestor /, {}],
    [/^git -c core.hooksPath=\/dev\/null merge --ff-only /, {}],
    [/^git diff --quiet /, { code: 0 }],
    [/\/npx --yes pnpm@10 install --frozen-lockfile$/, {}],
    [
      /vite\.js build/,
      async (c) => {
        const out = c.args[c.args.indexOf('--outDir') + 1] as string;
        await fs.mkdir(out, { recursive: true });
        await fs.writeFile(join(out, 'index.html'), 'new');
        return {};
      },
    ],
    [/\/bin\/node server\/index\.ts --check$/, {}],
    [/^git -c core.hooksPath=\/dev\/null reset --hard /, {}],
    ...(o.rules ?? []),
  ];
  const run = fakeRunner(rules);
  const restart = vi.fn();
  const logs: string[] = [];
  const deps: UpdaterDeps = {
    appRoot,
    clientDir,
    dataDir,
    currentVersion: '0.8.2',
    underService: true,
    run,
    nodeBinDir,
    nodePath: '/usr/local/bin/node',
    env: { PATH: '/usr/bin:/bin', HOME: '/Users/x' },
    freeBytes: vi.fn(async () => 10 * UPDATE_MIN_FREE_BYTES),
    openChats: async () => 2,
    restart,
    log: (line) => logs.push(line),
    now: () => new Date('2026-11-13T14:05:00Z'),
    ...o.deps,
  };
  const u = createUpdater(deps);
  return { u, run, rules, restart, logs, deps, appRoot, clientDir, nextDir, prevDir, dataDir, nodeBinDir };
}

/** Waits for the background update to stop (failed or restarting). */
async function settled(u: Updater): Promise<UpdateStatus> {
  let s: UpdateStatus | undefined;
  await vi.waitFor(
    async () => {
      s = await u.status();
      expect(['failed', 'restarting']).toContain(s.phase);
    },
    { timeout: 3000, interval: 5 },
  );
  return s as UpdateStatus;
}

/** Fails the first matching call only (so the rollback's own re-install succeeds). */
const failOnce = (tail: string): Reply => {
  let calls = 0;
  return () => (calls++ === 0 ? { code: 1, tail } : {});
};

const read = (p: string) => fs.readFile(p, 'utf8');
const MUTATING = /merge --ff-only|reset --hard|pnpm@10 install|vite\.js|--check/;

describe('compareVersions', () => {
  it('compares x.y.z as numbers', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.9.9', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });
});

describe('blocked', () => {
  it('is not-service for a copy started by hand, without running git', async () => {
    const { u, run } = await setup({ deps: { underService: false } });
    expect((await u.status()).blocked).toBe('not-service');
    expect(run.calls).toHaveLength(0);
  });

  it('is not-git without a .git folder', async () => {
    const { u } = await setup({ git: false });
    expect((await u.status()).blocked).toBe('not-git');
  });

  it('is not-git when git does not see a repository', async () => {
    const { u } = await setup({ rules: [[/^git rev-parse --git-dir$/, { code: 128 }]] });
    expect((await u.status()).blocked).toBe('not-git');
  });

  it('is not-on-main on another branch', async () => {
    const { u } = await setup({ rules: [[/symbolic-ref/, { stdout: 'refs/heads/feature\n' }]] });
    expect((await u.status()).blocked).toBe('not-on-main');
  });

  it('is not-on-main with a detached HEAD', async () => {
    const { u } = await setup({ rules: [[/symbolic-ref/, { code: 1 }]] });
    expect((await u.status()).blocked).toBe('not-on-main');
  });

  it('is not-on-main when main tracks something else', async () => {
    const { u } = await setup({ rules: [[/branch\.main\.remote/, { stdout: 'fork\n' }]] });
    expect((await u.status()).blocked).toBe('not-on-main');
    const other = await setup({ rules: [[/branch\.main\.merge/, { stdout: 'refs/heads/dev\n' }]] });
    expect((await other.u.status()).blocked).toBe('not-on-main');
  });

  it('is local-changes with a dirty tree', async () => {
    const { u } = await setup({ rules: [[/status --porcelain/, { stdout: ' M server/index.ts\n' }]] });
    expect((await u.status()).blocked).toBe('local-changes');
  });

  it('is null for a clean clone on main under the service', async () => {
    const { u } = await setup();
    const s = await u.status();
    expect(s.blocked).toBeNull();
    expect(UPDATE_BLOCKED_TEXT).toHaveProperty('local-changes');
  });
});

describe('status', () => {
  it('starts empty and includes open chats', async () => {
    const { u } = await setup();
    expect(await u.status()).toEqual({
      current: '0.8.2',
      latest: null,
      available: false,
      blocked: null,
      checkedAt: null,
      checkFailed: false,
      unfinished: false,
      phase: 'idle',
      error: null,
      notes: [],
      openChats: 2,
    });
  });

  it('reports 0 open chats when counting them fails', async () => {
    const { u } = await setup({
      deps: {
        openChats: async () => {
          throw new Error('no');
        },
      },
    });
    expect((await u.status()).openChats).toBe(0);
  });
});

describe('check', () => {
  it('fetches with prompts off and reads version and notes from the recorded SHA', async () => {
    const { u, run, appRoot } = await setup();
    const s = await u.check();
    expect(s).toMatchObject({
      latest: '0.9.0',
      available: true,
      checkFailed: false,
      checkedAt: '2026-11-13T14:05:00.000Z',
      phase: 'idle',
    });
    expect(s.notes.map((n) => n.version)).toEqual(['0.9.0', '0.8.3']);
    const fetch = run.calls.find(
      (c) => keyOf(c) === 'git fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main',
    );
    expect(fetch?.opts.env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(fetch?.opts.cwd).toBe(appRoot);
    expect(fetch?.opts.timeoutMs).toBe(60_000);
    expect(run.keys()).toContain(`git show ${NEW}:package.json`);
    expect(run.keys()).toContain(`git show ${NEW}:CHANGELOG.md`);
  });

  it('is not available when main has the same version', async () => {
    const { u } = await setup({ rules: [[/:package\.json$/, { stdout: '{"version":"0.8.2"}' }]] });
    const s = await u.check();
    expect(s.latest).toBe('0.8.2');
    expect(s.available).toBe(false);
    expect(s.notes).toEqual([]);
  });

  it('is not available when main has a lower version', async () => {
    const { u } = await setup({ rules: [[/:package\.json$/, { stdout: '{"version":"0.8.1"}' }]] });
    expect((await u.check()).available).toBe(false);
  });

  it('is available for 0.10.0 over 0.9.9', async () => {
    const { u } = await setup({
      deps: { currentVersion: '0.9.9' },
      rules: [[/:package\.json$/, { stdout: '{"version":"0.10.0"}' }]],
    });
    expect((await u.check()).available).toBe(true);
  });

  it('gives [] notes when the changelog cannot be read, and still succeeds', async () => {
    const { u } = await setup({ rules: [[/:CHANGELOG\.md$/, { code: 128 }]] });
    const s = await u.check();
    expect(s.available).toBe(true);
    expect(s.notes).toEqual([]);
  });

  it('a failed check sets checkFailed and keeps the last available and latest', async () => {
    const { u, rules } = await setup();
    await u.check();
    rules.push([/^git fetch/, { code: 128, tail: 'fatal: unable to access' }]);
    const s = await u.check();
    expect(s).toMatchObject({
      checkFailed: true,
      available: true,
      latest: '0.9.0',
      checkedAt: '2026-11-13T14:05:00.000Z',
      phase: 'idle',
      error: null,
    });
    expect(s.notes.map((n) => n.version)).toEqual(['0.9.0', '0.8.3']);
    rules.pop();
    expect((await u.check()).checkFailed).toBe(false);
  });

  it.each([
    ['a newline inside', '0.9.0\nmalicious'],
    ['a suffix over 64 characters', `0.9.0-${'x'.repeat(65)}`],
    ['two parts only', '0.9'],
    ['text before it', 'v0.9.0'],
  ])('treats a version with %s as a failed check', async (_n, version) => {
    const { u } = await setup({ rules: [[/:package\.json$/, { stdout: JSON.stringify({ version }) }]] });
    const s = await u.check();
    expect(s.checkFailed).toBe(true);
    expect(s.latest).toBeNull();
    expect(s.available).toBe(false);
  });

  it('accepts a short pre-release suffix', async () => {
    const { u } = await setup({ rules: [[/:package\.json$/, { stdout: '{"version":"0.9.0-beta.1"}' }]] });
    expect(await u.check()).toMatchObject({ checkFailed: false, latest: '0.9.0-beta.1', available: true });
  });

  it('treats an unreadable package.json on main as a failed check', async () => {
    const { u } = await setup({ rules: [[/:package\.json$/, { stdout: 'not json' }]] });
    const s = await u.check();
    expect(s.checkFailed).toBe(true);
    expect(s.latest).toBeNull();
  });

  it('shares one in-flight check between callers', async () => {
    const gate = deferred<void>();
    const { u, run } = await setup({
      rules: [
        [
          /^git fetch/,
          async () => {
            await gate.promise;
            return {};
          },
        ],
      ],
    });
    const a = u.check();
    const b = u.check();
    await vi.waitFor(() =>
      expect(run.keys()).toContain(
        'git fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main',
      ),
    );
    expect((await u.status()).phase).toBe('checking');
    gate.resolve();
    const [sa, sb] = await Promise.all([a, b]);
    expect(run.keys().filter((k) => k.startsWith('git fetch'))).toHaveLength(1);
    expect(sa.latest).toBe('0.9.0');
    expect(sb.latest).toBe('0.9.0');
  });

  it('refreshes blocked', async () => {
    const { u, rules } = await setup();
    expect((await u.status()).blocked).toBeNull();
    rules.push([/status --porcelain/, { stdout: '?? stray.txt\n' }]);
    expect((await u.check()).blocked).toBe('local-changes');
  });
});

describe('start refusals', () => {
  it('refuses when nothing is available', async () => {
    const { u, run } = await setup();
    await expect(u.start()).rejects.toEqual(new UpdateRefused('not-allowed'));
    await u.check();
    expect(run.keys().some((k) => MUTATING.test(k))).toBe(false);
  });

  it('refuses when main has the same version', async () => {
    const { u } = await setup({ rules: [[/:package\.json$/, { stdout: '{"version":"0.8.2"}' }]] });
    await u.check();
    await expect(u.start()).rejects.toMatchObject({ reason: 'not-allowed' });
  });

  it('refuses a copy started by hand', async () => {
    const { u, run } = await setup({ deps: { underService: false } });
    await u.check();
    await expect(u.start()).rejects.toMatchObject({ reason: 'not-allowed' });
    expect(run.keys().some((k) => MUTATING.test(k))).toBe(false);
  });

  it('re-checks blocked at start: local changes made after the check refuse', async () => {
    const { u, rules, run, dataDir } = await setup();
    await u.check();
    rules.push([/status --porcelain/, { stdout: ' M package.json\n' }]);
    await expect(u.start()).rejects.toMatchObject({ reason: 'not-allowed' });
    expect(run.keys().some((k) => MUTATING.test(k))).toBe(false);
    expect(await exists(join(dataDir, PENDING_FILE))).toBe(false);
  });

  it('refuses a second start, and a check, while one runs', async () => {
    const gate = deferred<void>();
    const { u } = await setup({
      rules: [
        [
          /merge --ff-only/,
          async () => {
            await gate.promise;
            return {};
          },
        ],
      ],
    });
    await u.check();
    const s = await u.start();
    expect(s.phase).toBe('downloading');
    await expect(u.start()).rejects.toMatchObject({ reason: 'busy' });
    await expect(u.check()).rejects.toMatchObject({ reason: 'busy' });
    gate.resolve();
    expect((await settled(u)).phase).toBe('restarting');
  });
});

describe('pre-flight', () => {
  const cases: [string, SetupOptions][] = [
    ['npx is missing', { npx: false }],
    ['HEAD is not an ancestor of the recorded SHA', { rules: [[/merge-base --is-ancestor/, { code: 1 }]] }],
    ['the disk is short of space', { deps: { freeBytes: async () => UPDATE_MIN_FREE_BYTES - 1 } }],
    [
      'free space cannot be read',
      {
        deps: {
          freeBytes: async () => {
            throw new Error('statfs');
          },
        },
      },
    ],
  ];
  it.each(cases)('refuses and changes nothing when %s', async (_name, opts) => {
    const { u, run, restart, dataDir, clientDir, nextDir } = await setup(opts);
    await u.check();
    await u.start();
    const s = await settled(u);
    expect(s.phase).toBe('failed');
    expect(s.error).toBe(UPDATE_FAILED_TEXT.preflight);
    expect(s.unfinished).toBe(false);
    expect(run.keys().some((k) => MUTATING.test(k))).toBe(false);
    expect(await exists(join(dataDir, PENDING_FILE))).toBe(false);
    expect(await read(join(clientDir, 'index.html'))).toBe('old');
    expect(await exists(nextDir)).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  });
});

describe('a successful update', () => {
  it('runs the fixed steps in order with fixed args, swaps dist and restarts once', async () => {
    const { u, run, rules, restart, appRoot, clientDir, prevDir, nextDir, dataDir, deps } = await setup();
    await fs.mkdir(prevDir, { recursive: true });
    await fs.writeFile(join(prevDir, 'index.html'), 'older');
    await u.check();
    // origin/main moving after the check must not change what is merged.
    rules.push([/refs\/remotes\/origin\/main/, { stdout: `${LATER}\n` }]);
    let marker: unknown = null;
    rules.push([
      /merge --ff-only/,
      async () => {
        marker = JSON.parse(await read(join(dataDir, PENDING_FILE)));
        return {};
      },
    ]);
    const before = run.calls.length;
    await u.start();
    const s = await settled(u);
    expect(s.phase).toBe('restarting');
    expect(s.error).toBeNull();
    expect(restart).toHaveBeenCalledTimes(1);

    const steps = run.calls.slice(before);
    const mutating = steps.filter((c) => MUTATING.test(keyOf(c)) || /diff --quiet/.test(keyOf(c)));
    expect(mutating.map((c) => [c.file, ...c.args])).toEqual([
      ['git', '-c', 'core.hooksPath=/dev/null', 'merge', '--ff-only', NEW],
      ['git', 'diff', '--quiet', OLD, NEW, '--', 'pnpm-lock.yaml', 'package.json'],
      [
        '/usr/local/bin/node',
        'node_modules/vite/bin/vite.js',
        'build',
        '--outDir',
        join(appRoot, 'dist', 'client.next'),
        '--emptyOutDir',
      ],
      [join(appRoot, 'bin', 'node'), 'server/index.ts', '--check'],
    ]);
    const vite = steps.find((c) => c.args.includes('--outDir')) as Call;
    expect(isAbsolute(vite.args[vite.args.indexOf('--outDir') + 1] as string)).toBe(true);
    expect(steps.find((c) => c.args.includes('merge'))?.opts.timeoutMs).toBe(30_000);
    expect(vite.opts.timeoutMs).toBe(5 * 60_000);
    expect(steps.find((c) => c.args.includes('--check'))?.opts.timeoutMs).toBe(60_000);
    // No shell anywhere: every command is one of the fixed programs, cwd the app folder.
    for (const c of run.calls) {
      expect(['git', join(deps.nodeBinDir, 'npx'), deps.nodePath, join(appRoot, 'bin', 'node')]).toContain(
        c.file,
      );
      expect(c.opts.cwd).toBe(appRoot);
      expect(c.opts.env.GIT_TERMINAL_PROMPT).toBe('0');
    }
    // Ancestor check against the recorded SHA, before the merge.
    const keys = steps.map(keyOf);
    expect(keys.indexOf(`git merge-base --is-ancestor ${OLD} ${NEW}`)).toBeGreaterThanOrEqual(0);
    expect(keys.indexOf(`git merge-base --is-ancestor ${OLD} ${NEW}`)).toBeLessThan(
      keys.findIndex((k) => k.includes('merge --ff-only')),
    );
    // Install skipped: the lockfile and package.json are unchanged.
    expect(keys.some((k) => k.includes('pnpm@10'))).toBe(false);
    // The marker was written before the merge and removed after the swap.
    expect(marker).toEqual({
      from: OLD,
      to: NEW,
      fromVersion: '0.8.2',
      toVersion: '0.9.0',
      startedAt: '2026-11-13T14:05:00.000Z',
    });
    expect(await exists(join(dataDir, PENDING_FILE))).toBe(false);
    expect(await fs.readdir(dataDir)).toEqual([]);
    // Swap.
    expect(await read(join(clientDir, 'index.html'))).toBe('new');
    expect(await read(join(prevDir, 'index.html'))).toBe('old');
    expect(await exists(nextDir)).toBe(false);
    expect(deps.freeBytes).toHaveBeenCalledWith(appRoot);
  });

  it('installs with CI and the node folder first on PATH when the lockfile changed', async () => {
    const { u, run, appRoot, nodeBinDir, restart } = await setup({
      rules: [[/^git diff --quiet /, { code: 1 }]],
    });
    await u.check();
    await u.start();
    expect((await settled(u)).phase).toBe('restarting');
    const installs = run.calls.filter((c) => c.args.includes('pnpm@10'));
    expect(installs).toHaveLength(1);
    const install = installs[0] as Call;
    expect(install.file).toBe(join(nodeBinDir, 'npx'));
    expect(install.args).toEqual(['--yes', 'pnpm@10', 'install', '--frozen-lockfile']);
    expect(install.opts.env.CI).toBe('true');
    expect(install.opts.env.PATH).toBe(`${nodeBinDir}:${join(appRoot, 'bin')}:/usr/bin:/bin`);
    expect(install.opts.env.HOME).toBe('/Users/x');
    expect(install.opts.timeoutMs).toBe(10 * 60_000);
    const keys = run.keys();
    expect(keys.findIndex((k) => k.includes('pnpm@10'))).toBeLessThan(
      keys.findIndex((k) => k.includes('vite.js')),
    );
    expect(restart).toHaveBeenCalledTimes(1);
  });
});

describe('a failed update rolls back', () => {
  const cases: [string, RegExp, keyof typeof UPDATE_FAILED_TEXT, boolean][] = [
    ['merge', /merge --ff-only/, 'download', false],
    ['install', /pnpm@10 install/, 'install', true],
    ['build', /vite\.js build/, 'build', true],
    ['boot check', /server\/index\.ts --check/, 'boot-check', true],
  ];
  it.each(cases)(
    'at %s: resets to the recorded HEAD, re-installs if installed, leaves dist alone',
    async (_n, step, text, lockChanged) => {
      const { u, run, restart, logs, clientDir, nextDir, dataDir } = await setup({
        rules: [
          [/^git diff --quiet /, { code: lockChanged ? 1 : 0 }],
          [step, failOnce('secret-free failure output')],
        ],
      });
      await u.check();
      await u.start();
      const s = await settled(u);
      expect(s.phase).toBe('failed');
      expect(s.error).toBe(UPDATE_FAILED_TEXT[text]);
      expect(s.unfinished).toBe(false);
      expect(restart).not.toHaveBeenCalled();
      const keys = run.keys();
      expect(keys).toContain(`git -c core.hooksPath=/dev/null reset --hard ${OLD}`);
      const installs = keys.filter((k) => k.includes('pnpm@10')).length;
      // Install ran in the update (when the lockfile changed and it got that far), then again in the rollback.
      expect(installs).toBe(lockChanged ? 2 : 0);
      expect(await read(join(clientDir, 'index.html'))).toBe('old');
      expect(await exists(nextDir)).toBe(false);
      expect(await exists(join(dataDir, PENDING_FILE))).toBe(false);
      expect(logs.join('\n')).toContain('secret-free failure output');
      expect(s.error).not.toContain('secret-free');
    },
  );

  it('does not re-install when the failure came before any install', async () => {
    const { u, run } = await setup({ rules: [[/vite\.js build/, { code: 1 }]] });
    await u.check();
    await u.start();
    expect((await settled(u)).error).toBe(UPDATE_FAILED_TEXT.build);
    expect(run.keys().some((k) => k.includes('pnpm@10'))).toBe(false);
  });

  it('removes a half-built client.next', async () => {
    const { u, nextDir, clientDir } = await setup({
      rules: [
        [
          /vite\.js build/,
          async (c) => {
            const out = c.args[c.args.indexOf('--outDir') + 1] as string;
            await fs.mkdir(out, { recursive: true });
            await fs.writeFile(join(out, 'half.js'), '');
            return { code: 1 };
          },
        ],
      ],
    });
    await u.check();
    await u.start();
    await settled(u);
    expect(await exists(nextDir)).toBe(false);
    expect(await read(join(clientDir, 'index.html'))).toBe('old');
  });

  it('restores dist/client when the swap fails, then rolls back', async () => {
    // The build "succeeds" without writing client.next, so renaming it into place throws.
    const { u, run, restart, clientDir, dataDir } = await setup({ rules: [[/vite\.js build/, {}]] });
    await u.check();
    await u.start();
    const s = await settled(u);
    expect(s.phase).toBe('failed');
    expect(s.error).toBe(UPDATE_FAILED_TEXT.build);
    expect(await read(join(clientDir, 'index.html'))).toBe('old');
    expect(run.keys()).toContain(`git -c core.hooksPath=/dev/null reset --hard ${OLD}`);
    expect(await exists(join(dataDir, PENDING_FILE))).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  });

  it('keeps the marker and says rollback-failed when the rollback fails', async () => {
    const { u, dataDir, restart } = await setup({
      rules: [
        [/merge --ff-only/, { code: 1 }],
        [/reset --hard/, { code: 128 }],
      ],
    });
    await u.check();
    await u.start();
    const s = await settled(u);
    expect(s.phase).toBe('failed');
    expect(s.error).toBe(UPDATE_FAILED_TEXT['rollback-failed']);
    expect(s.unfinished).toBe(true);
    expect(JSON.parse(await read(join(dataDir, PENDING_FILE)))).toMatchObject({ from: OLD, to: NEW });
    expect(restart).not.toHaveBeenCalled();
  });

  it('allows Try again after a clean rollback', async () => {
    const { u, rules } = await setup({ rules: [[/vite\.js build/, { code: 1 }]] });
    await u.check();
    await u.start();
    await settled(u);
    rules.pop();
    await u.start();
    expect((await settled(u)).phase).toBe('restarting');
  });
});

describe('an interrupted update', () => {
  const marker: UpdatePending = {
    from: OLD,
    to: NEW,
    fromVersion: '0.8.2',
    toVersion: '0.9.0',
    startedAt: '2026-11-13T13:00:00.000Z',
  };

  it('shows as unfinished at start-up', async () => {
    const { u } = await setup({ marker });
    expect(await u.status()).toMatchObject({
      unfinished: true,
      phase: 'failed',
      error: UPDATE_UNFINISHED_TEXT,
      available: false,
    });
  });

  it('stays unfinished across a check', async () => {
    const { u } = await setup({ marker });
    expect(await u.check()).toMatchObject({
      unfinished: true,
      phase: 'failed',
      error: UPDATE_UNFINISHED_TEXT,
    });
  });

  it('resumes against the marker without a check: reinstall always, build, boot check, swap', async () => {
    const { u, run, restart, clientDir, dataDir } = await setup({
      marker,
      rules: [[/^git rev-parse HEAD$/, { stdout: `${NEW}\n` }]],
    });
    const s = await u.start();
    expect(s.phase).toBe('downloading');
    const done = await settled(u);
    expect(done.phase).toBe('restarting');
    const keys = run.keys();
    expect(keys.some((k) => k.includes('merge --ff-only'))).toBe(false);
    expect(keys.some((k) => k.includes('diff --quiet'))).toBe(false);
    expect(keys.filter((k) => k.includes('pnpm@10'))).toHaveLength(1);
    const order = ['pnpm@10', 'vite.js', '--check'].map((p) => keys.findIndex((k) => k.includes(p)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(await read(join(clientDir, 'index.html'))).toBe('new');
    expect(await exists(join(dataDir, PENDING_FILE))).toBe(false);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('merges to the marker SHA first when the merge had not happened', async () => {
    const { u, run } = await setup({ marker });
    await u.start();
    expect((await settled(u)).phase).toBe('restarting');
    expect(run.keys()).toContain(`git -c core.hooksPath=/dev/null merge --ff-only ${NEW}`);
  });

  it('rolls back to the marker HEAD when the resume fails', async () => {
    const { u, run, dataDir } = await setup({
      marker,
      rules: [
        [/^git rev-parse HEAD$/, { stdout: `${NEW}\n` }],
        [/vite\.js build/, { code: 1 }],
      ],
    });
    await u.start();
    const s = await settled(u);
    expect(s).toMatchObject({ phase: 'failed', error: UPDATE_FAILED_TEXT.build, unfinished: false });
    expect(run.keys()).toContain(`git -c core.hooksPath=/dev/null reset --hard ${OLD}`);
    expect(run.keys().filter((k) => k.includes('pnpm@10'))).toHaveLength(2);
    expect(await exists(join(dataDir, PENDING_FILE))).toBe(false);
  });

  it('a dirty tree (a half-done merge) does not block it, and the resume first resets to HEAD', async () => {
    const { u, run } = await setup({
      marker,
      rules: [[/status --porcelain/, { stdout: ' M server/index.ts\n' }]],
    });
    expect(await u.status()).toMatchObject({ blocked: null, unfinished: true });
    const before = run.calls.length;
    await u.start();
    expect((await settled(u)).phase).toBe('restarting');
    const BLOCKED_CHECK = /rev-parse --git-dir|symbolic-ref|config --get|status --porcelain/;
    const steps = run.calls
      .slice(before)
      .map(keyOf)
      .filter((k) => !BLOCKED_CHECK.test(k));
    expect(steps[0]).toBe('git -c core.hooksPath=/dev/null reset --hard HEAD');
    // HEAD is still the marker's `from`: the merge to its `to` follows.
    expect(steps).toContain(`git -c core.hooksPath=/dev/null merge --ff-only ${NEW}`);
  });

  it('still says local-changes for a dirty tree without a marker', async () => {
    const { u } = await setup({ rules: [[/status --porcelain/, { stdout: ' M x\n' }]] });
    expect((await u.status()).blocked).toBe('local-changes');
  });

  it('finishes what is on disk when HEAD moved past the marker by hand', async () => {
    const { u, run, logs, restart, clientDir, dataDir } = await setup({
      marker,
      rules: [[/^git rev-parse HEAD$/, { stdout: `${LATER}\n` }]],
    });
    await u.start();
    expect((await settled(u)).phase).toBe('restarting');
    const keys = run.keys();
    expect(keys.some((k) => k.includes('merge --ff-only') || k.includes('merge-base'))).toBe(false);
    expect(keys.filter((k) => k.includes('pnpm@10'))).toHaveLength(1);
    expect(keys.some((k) => k.includes('vite.js'))).toBe(true);
    expect(keys.some((k) => k.includes('--check'))).toBe(true);
    expect(await read(join(clientDir, 'index.html'))).toBe('new');
    expect(await exists(join(dataDir, PENDING_FILE))).toBe(false);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(logs.join('\n')).toMatch(/finishing what is on disk/);
  });

  it('rolls back to the HEAD it found when finishing a hand update fails', async () => {
    const { u, run } = await setup({
      marker,
      rules: [
        [/^git rev-parse HEAD$/, { stdout: `${LATER}\n` }],
        [/vite\.js build/, { code: 1 }],
      ],
    });
    await u.start();
    expect((await settled(u)).error).toBe(UPDATE_FAILED_TEXT.build);
    expect(run.keys()).toContain(`git -c core.hooksPath=/dev/null reset --hard ${LATER}`);
    expect(run.keys()).not.toContain(`git -c core.hooksPath=/dev/null reset --hard ${OLD}`);
  });

  it('ignores an unreadable marker', async () => {
    const { u, logs } = await setup({ marker: '{ not json' });
    expect(await u.status()).toMatchObject({ unfinished: false, phase: 'idle', error: null });
    expect(logs.join('\n')).toMatch(/marker/);
  });
});

describe('timer', () => {
  it('does nothing unless under the service', async () => {
    const { u, run } = await setup({ deps: { underService: false } });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    u.startTimer();
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_AFTER_MS + 3 * UPDATE_CHECK_EVERY_MS);
    expect(run.calls).toHaveLength(0);
    u.stopTimer();
  });

  it('checks first after the start-up delay, then on the interval, until stopped', async () => {
    const { u, run } = await setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const fetches = () => run.keys().filter((k) => k.startsWith('git fetch')).length;
    u.startTimer();
    u.startTimer();
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_AFTER_MS - 1);
    expect(fetches()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetches()).toBe(1);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS);
    expect(fetches()).toBe(2);
    u.stopTimer();
    await vi.advanceTimersByTimeAsync(2 * UPDATE_CHECK_EVERY_MS);
    expect(fetches()).toBe(2);
  });
});

describe('abort', () => {
  it('during installing: kills, resets to the recorded HEAD, keeps the marker, then spawns nothing', async () => {
    const killed = deferred<void>();
    const { u, run, dataDir, restart } = await setup({
      rules: [
        [/^git diff --quiet /, { code: 1 }],
        [
          /pnpm@10 install/,
          async () => {
            await killed.promise;
            return { code: 143, tail: 'killed' };
          },
        ],
      ],
    });
    run.killAll = vi.fn(() => killed.resolve());
    await u.check();
    await u.start();
    await vi.waitFor(() => expect(run.keys().some((k) => k.includes('pnpm@10'))).toBe(true));
    expect((await u.status()).phase).toBe('installing');
    await u.abort();
    expect(run.killAll).toHaveBeenCalled();
    const after = run.calls.length;
    const keys = run.keys();
    const resets = run.calls.filter((c) => c.args.includes('reset'));
    expect(resets.map(keyOf)).toEqual([`git -c core.hooksPath=/dev/null reset --hard ${OLD}`]);
    expect(resets[0]?.opts.timeoutMs).toBeLessThanOrEqual(10_000);
    expect(keys.filter((k) => k.includes('pnpm@10'))).toHaveLength(1);
    expect(keys.some((k) => k.includes('vite.js'))).toBe(false);
    expect(JSON.parse(await read(join(dataDir, PENDING_FILE)))).toMatchObject({ from: OLD, to: NEW });
    await new Promise((r) => setTimeout(r, 50));
    expect(run.calls.length).toBe(after);
    expect(restart).not.toHaveBeenCalled();
    expect((await u.status()).unfinished).toBe(true);
    await expect(u.start()).rejects.toMatchObject({ reason: 'busy' });
    await expect(u.check()).rejects.toMatchObject({ reason: 'busy' });
  });

  it('during the merge: resets to the recorded HEAD (a cut-off merge changed the code), marker kept', async () => {
    const killed = deferred<void>();
    const { u, run, dataDir } = await setup({
      rules: [
        [
          /merge --ff-only/,
          async () => {
            await killed.promise;
            return { code: 143 };
          },
        ],
      ],
    });
    run.killAll = vi.fn(() => killed.resolve());
    await u.check();
    await u.start();
    await vi.waitFor(() => expect(run.keys().some((k) => k.includes('merge --ff-only'))).toBe(true));
    await u.abort();
    expect(run.keys().filter((k) => k.includes('reset --hard'))).toEqual([
      `git -c core.hooksPath=/dev/null reset --hard ${OLD}`,
    ]);
    expect(await exists(join(dataDir, PENDING_FILE))).toBe(true);
  });

  it('when idle is a no-op apart from stopping the timer, and never throws', async () => {
    const { u, run, dataDir } = await setup();
    await u.status();
    const before = run.calls.length;
    await expect(u.abort()).resolves.toBeUndefined();
    await expect(u.abort()).resolves.toBeUndefined();
    expect(run.calls.length).toBe(before);
    expect(await exists(join(dataDir, PENDING_FILE))).toBe(false);
  });
});

describe('check against a real git remote', () => {
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'tag.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        ...args,
      ],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  const commit = async (dir: string, version: string): Promise<void> => {
    await fs.writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x', version }));
    await fs.writeFile(join(dir, 'CHANGELOG.md'), `## v${version} — 2026-11-13\n- **feat**: ${version}\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', version);
  };

  it('ignores tags named main and origin/main', { timeout: 20_000 }, async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'tds-update-git-'));
    roots.push(root);
    const src = join(root, 'src');
    const remote = join(root, 'remote.git');
    const app = join(root, 'app');
    await fs.mkdir(src);
    git(src, 'init', '--quiet', '-b', 'main');
    await commit(src, '0.8.2');
    // A side commit claiming 6.6.6, tagged with names that shadow `main` and `origin/main` as short refs.
    git(src, 'checkout', '--quiet', '-b', 'evil');
    await commit(src, '6.6.6');
    git(src, 'tag', 'main');
    git(src, 'tag', 'origin/main');
    git(src, 'switch', '--quiet', 'main');
    git(root, 'clone', '--quiet', '--bare', src, remote);
    git(root, 'clone', '--quiet', remote, app);
    expect(git(app, 'tag', '--list')).toContain('origin/main');
    // main moves on after the install.
    git(src, 'switch', '--quiet', 'main');
    await commit(src, '0.9.0');
    git(src, 'push', '--quiet', remote, 'refs/heads/main:refs/heads/main');

    const u = createUpdater({
      appRoot: app,
      clientDir: join(root, 'dist', 'client'),
      dataDir: join(root, 'data'),
      currentVersion: '0.8.2',
      underService: true,
      run: createRunner(),
      nodeBinDir: join(root, 'nodebin'),
      nodePath: process.execPath,
      env: process.env,
      freeBytes: async () => 10 * UPDATE_MIN_FREE_BYTES,
      openChats: async () => 0,
      restart: () => {},
      log: () => {},
      now: () => new Date('2026-11-13T14:05:00Z'),
    });
    const s = await u.check();
    expect(s.blocked).toBeNull();
    expect(s.checkFailed).toBe(false);
    expect(s.latest).toBe('0.9.0');
    expect(s.available).toBe(true);
    expect(s.notes.map((n) => n.version)).toEqual(['0.9.0']);
  });
});
