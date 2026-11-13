/**
 * The update engine (docs/plans/2026-11-13-in-app-updates.md, decisions 2–5). Checks the installed
 * clone's GitHub `main` for a newer version and, when asked, merges the SHA recorded at the check,
 * installs, builds, boot-checks, swaps the client build and restarts. Every command is a fixed program
 * with fixed arguments, run with no shell and cwd the app folder; no request data reaches a command.
 * A failure after the merge resets to the recorded HEAD. A pending marker in the data folder lets an
 * interrupted update be finished with one click.
 */
import { existsSync, promises as fs, constants as fsConstants, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { VersionNotes } from '../../shared/contract.ts';
import {
  UPDATE_CHECK_EVERY_MS,
  UPDATE_FAILED_TEXT,
  UPDATE_FIRST_CHECK_AFTER_MS,
  UPDATE_MIN_FREE_BYTES,
  UPDATE_UNFINISHED_TEXT,
  type UpdateBlocked,
  type UpdateCommandResult,
  type UpdateFailedStep,
  type UpdatePending,
  type UpdatePhase,
  UpdateRefused,
  type Updater,
  type UpdaterDeps,
  type UpdateStatus,
} from '../../shared/update-contract.ts';
import { parseChangelog } from '../changelog.ts';

/** The marker's file name in the data folder. */
export const PENDING_FILE = 'update-pending.json';

/** Decision 5, plus a short limit for the quick local git reads. */
export const UPDATE_TIMEOUTS = {
  gitLocal: 15_000,
  fetch: 60_000,
  merge: 30_000,
  install: 10 * 60_000,
  build: 5 * 60_000,
  bootCheck: 60_000,
} as const;

/** Lenient: the x.y.z at the start, for comparing. */
const VERSION_PREFIX = /^(\d+)\.(\d+)\.(\d+)/;
/** Strict: what a version on `main` must look like (whole string, short pre-release or build suffix). */
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]{1,64})?$/;
/** Full ref names, so a tag called `main` or `origin/main` can never shadow them. */
const MAIN_BRANCH = 'refs/heads/main';
const ORIGIN_MAIN = 'refs/remotes/origin/main';
/** How long `abort()` waits for a running update to stop, and gives its reset. */
const ABORT_WAIT_MS = 10_000;
const SHA = /^[0-9a-f]{40,64}$/;

/** Compares x.y.z as numbers (0.10.0 > 0.9.9). Anything after x.y.z is ignored; unreadable counts as 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const pa = VERSION_PREFIX.exec(a.trim());
  const pb = VERSION_PREFIX.exec(b.trim());
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa?.[i] ?? 0) - Number(pb?.[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** A step of the update failed; `step` picks the sentence. */
/** `abort()` was called: the update stops where it is, with no rollback of its own. */
class Aborted extends Error {}

class StepFailed extends Error {
  readonly step: UpdateFailedStep;
  constructor(step: UpdateFailedStep) {
    super(step);
    this.step = step;
  }
}

/** Hides credentials in URLs (`https://user:token@host`) before a line reaches the log. */
const scrub = (line: string): string => line.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@');

function isPending(v: unknown): v is UpdatePending {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.from === 'string' &&
    SHA.test(p.from) &&
    typeof p.to === 'string' &&
    SHA.test(p.to) &&
    typeof p.fromVersion === 'string' &&
    typeof p.toVersion === 'string' &&
    typeof p.startedAt === 'string'
  );
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const { appRoot, clientDir, dataDir, currentVersion } = deps;
  const markerPath = join(dataDir, PENDING_FILE);
  const nextDir = join(dirname(clientDir), 'client.next');
  const prevDir = join(dirname(clientDir), 'client.prev');
  const npx = join(deps.nodeBinDir, 'npx');
  const bootNode = join(appRoot, 'bin', 'node');

  // One environment for every command: no git prompts, CI for pnpm, the running node's folder first on PATH.
  const env: NodeJS.ProcessEnv = {
    ...deps.env,
    GIT_TERMINAL_PROMPT: '0',
    CI: 'true',
    PATH: [deps.nodeBinDir, join(appRoot, 'bin'), deps.env.PATH].filter(Boolean).join(':'),
  };

  const log = (line: string): void => deps.log(`update: ${line}`);
  const logFailure = (what: string, r: UpdateCommandResult): void => {
    log(`${what} failed (exit ${r.code}${r.timedOut ? ', timed out' : ''})`);
    for (const line of r.tail.split('\n')) if (line.trim()) log(`  ${scrub(line)}`);
  };

  /** Set by `abort()`: from then on no command is started (only abort's own reset gets through). */
  let aborted = false;
  const refused: UpdateCommandResult = { code: 1, stdout: '', tail: 'aborted', timedOut: false };
  const exec = async (file: string, args: string[], timeoutMs: number): Promise<UpdateCommandResult> =>
    aborted ? refused : deps.run(file, args, { cwd: appRoot, timeoutMs, env });
  const git = (args: string[], timeoutMs: number = UPDATE_TIMEOUTS.gitLocal) => exec('git', args, timeoutMs);
  const install = () =>
    exec(npx, ['--yes', 'pnpm@10', 'install', '--frozen-lockfile'], UPDATE_TIMEOUTS.install);

  // --- State ---------------------------------------------------------------------------------
  let latest: string | null = null;
  let available = false;
  let checkedAt: string | null = null;
  let checkFailed = false;
  let notes: VersionNotes[] = [];
  /** The `origin/main` SHA read at the last good check: the one an update merges. */
  let recordedSha: string | null = null;
  let phase: UpdatePhase = 'idle';
  let error: string | null = null;
  let unfinished = false;
  let pending: UpdatePending | null = null;
  let blocked: UpdateBlocked | null = null;
  let running = false;
  let inflight: Promise<UpdateStatus> | null = null;
  let firstTimer: NodeJS.Timeout | undefined;
  let interval: NodeJS.Timeout | undefined;
  /** The background update, while one runs. */
  let updateRun: Promise<void> | null = null;
  /** HEAD before the update while the code on disk differs from it and the swap isn't done. */
  let changedFrom: string | null = null;
  let aborting: Promise<void> | null = null;

  // An interrupted update (or a failed rollback) left its marker: offer to finish it.
  if (existsSync(markerPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(markerPath, 'utf8'));
      if (!isPending(parsed)) throw new Error('bad shape');
      pending = parsed;
      unfinished = true;
      phase = 'failed';
      error = UPDATE_UNFINISHED_TEXT;
      log(`found an unfinished update ${parsed.fromVersion} -> ${parsed.toVersion}`);
    } catch {
      log(`ignored an unreadable ${PENDING_FILE} marker`);
    }
  }

  // --- Blocked (decision 3) --------------------------------------------------------------------
  async function computeBlocked(): Promise<UpdateBlocked | null> {
    if (!deps.underService) return 'not-service';
    if (!existsSync(join(appRoot, '.git'))) return 'not-git';
    if ((await git(['rev-parse', '--git-dir'])).code !== 0) return 'not-git';
    const branch = await git(['symbolic-ref', '--quiet', 'HEAD']);
    if (branch.code !== 0 || branch.stdout.trim() !== MAIN_BRANCH) return 'not-on-main';
    // Tracking read from config, not `@{u}`, so no short ref name is ever resolved.
    const remote = await git(['config', '--get', 'branch.main.remote']);
    const merge = await git(['config', '--get', 'branch.main.merge']);
    if (remote.stdout.trim() !== 'origin' || merge.stdout.trim() !== MAIN_BRANCH) return 'not-on-main';
    // With an unfinished update's marker, a dirty tree is that update's half-done merge (the tree was
    // verified clean before the marker was written), and the resume's `reset --hard HEAD` cleans it.
    if (pending) return null;
    const st = await git(['status', '--porcelain']);
    if (st.code !== 0 || st.stdout.trim() !== '') return 'local-changes';
    return null;
  }
  const refreshBlocked = (): Promise<void> =>
    computeBlocked().then(
      (b) => {
        blocked = b;
      },
      () => {
        blocked = 'not-git';
      },
    );
  /** `status()` waits only for this first reading; later refreshes update `blocked` when they finish. */
  const initialBlocked = refreshBlocked();

  // --- Status ----------------------------------------------------------------------------------
  const snapshot = (): UpdateStatus => ({
    current: currentVersion,
    latest,
    available,
    blocked,
    checkedAt,
    checkFailed,
    unfinished,
    phase,
    error,
    notes,
    openChats: 0,
  });
  const countChats = async (): Promise<number> => {
    try {
      const n = await deps.openChats();
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  };
  async function status(): Promise<UpdateStatus> {
    await initialBlocked;
    const s = snapshot();
    s.openChats = await countChats();
    return s;
  }

  // --- Check (decision 2) ----------------------------------------------------------------------
  async function readMain(): Promise<void> {
    const failed = (what: string, r?: UpdateCommandResult): void => {
      checkFailed = true;
      if (r) logFailure(`check: ${what}`, r);
      else log(`check: ${what} failed`);
    };
    const fetched = await git(
      ['fetch', '--quiet', '--no-tags', 'origin', `+${MAIN_BRANCH}:${ORIGIN_MAIN}`],
      UPDATE_TIMEOUTS.fetch,
    );
    if (fetched.code !== 0) return failed('fetch', fetched);
    const ref = await git(['rev-parse', '--verify', '--quiet', `${ORIGIN_MAIN}^{commit}`]);
    const sha = ref.stdout.trim();
    if (ref.code !== 0 || !SHA.test(sha)) return failed('reading origin/main', ref);
    const pkg = await git(['show', `${sha}:package.json`]);
    if (pkg.code !== 0) return failed('reading package.json', pkg);
    let version: unknown;
    try {
      version = (JSON.parse(pkg.stdout) as { version?: unknown }).version;
    } catch {
      version = null;
    }
    if (typeof version !== 'string' || !VERSION.test(version.trim())) return failed('reading the version');
    const found = version.trim();
    const changelog = await git(['show', `${sha}:CHANGELOG.md`]);
    notes =
      changelog.code === 0
        ? parseChangelog(changelog.stdout).filter(
            (v) => compareVersions(v.version, currentVersion) > 0 && compareVersions(v.version, found) <= 0,
          )
        : [];
    latest = found;
    available = compareVersions(found, currentVersion) > 0;
    recordedSha = sha;
    checkedAt = deps.now().toISOString();
    checkFailed = false;
    log(`check: main has ${found} (running ${currentVersion})`);
  }

  async function runCheck(): Promise<UpdateStatus> {
    // An unfinished update keeps its failed phase and sentence; anything else shows the check.
    if (!unfinished) {
      phase = 'checking';
      error = null;
    }
    try {
      await refreshBlocked();
      if (blocked !== 'not-git') await readMain();
    } catch (e) {
      checkFailed = true;
      log(`check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (phase === 'checking') phase = 'idle';
    }
    return status();
  }

  function check(): Promise<UpdateStatus> {
    if (running || aborted) return Promise.reject(new UpdateRefused('busy'));
    if (!inflight) {
      inflight = runCheck().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  // --- Update (decision 4) ---------------------------------------------------------------------
  /**
   * (a) Nothing changes here, except that a resume first cleans a half-done merge. Works out what to
   * build (`target`) and what to go back to on failure (`from`), or throws with the reason for the log.
   */
  async function preflight(
    resume: UpdatePending | null,
    recorded: string,
  ): Promise<{ head: string; target: string; from: string }> {
    if (resume) {
      const clean = await git(
        ['-c', 'core.hooksPath=/dev/null', 'reset', '--hard', 'HEAD'],
        UPDATE_TIMEOUTS.merge,
      );
      if (clean.code !== 0) {
        logFailure('resume reset', clean);
        throw new Error('could not clean the working tree');
      }
    }
    try {
      await fs.access(npx, fsConstants.X_OK);
    } catch {
      throw new Error(`npx not found next to node (${deps.nodeBinDir})`);
    }
    const read = await git(['rev-parse', 'HEAD']);
    const head = read.stdout.trim();
    if (read.code !== 0 || !SHA.test(head)) throw new Error('could not read HEAD');
    let target: string;
    let from: string;
    if (resume && head !== resume.from) {
      // Merged already, or finished by hand (`/update-brain-app`): finish what is on disk, no merge.
      target = head;
      from = head === resume.to ? resume.from : head;
      log(
        `resume: HEAD ${head.slice(0, 8)} is not the marker's ${resume.from.slice(0, 8)}; finishing what is on disk`,
      );
    } else {
      target = resume ? resume.to : recorded;
      from = head;
      if (resume) log(`resume: HEAD is still ${head.slice(0, 8)}; merging ${target.slice(0, 8)}`);
      const ancestor = await git(['merge-base', '--is-ancestor', head, target]);
      if (ancestor.code !== 0)
        throw new Error(`HEAD ${head.slice(0, 8)} is not an ancestor of ${target.slice(0, 8)}`);
    }
    const free = await deps.freeBytes(appRoot);
    if (!(free >= UPDATE_MIN_FREE_BYTES)) throw new Error(`only ${Math.floor(free / 1e6)} MB free`);
    return { head, target, from };
  }

  async function writeMarker(marker: UpdatePending): Promise<void> {
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${markerPath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(tmp, `${JSON.stringify(marker, null, 2)}\n`);
      await fs.rename(tmp, markerPath);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
  }

  async function must(step: UpdateFailedStep, what: string, r: Promise<UpdateCommandResult>): Promise<void> {
    const result = await r;
    if (aborted) throw new Aborted();
    if (result.code !== 0) {
      logFailure(what, result);
      throw new StepFailed(step);
    }
  }

  /** (f) `ok` false when the swap failed; `restored` false when dist/client could not then be put back. */
  async function swap(): Promise<{ ok: boolean; restored: boolean }> {
    let moved = false;
    try {
      await fs.rm(prevDir, { recursive: true, force: true });
      try {
        await fs.rename(clientDir, prevDir);
        moved = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      await fs.rename(nextDir, clientDir);
      return { ok: true, restored: true };
    } catch (e) {
      log(`swap failed: ${(e as NodeJS.ErrnoException).code ?? 'error'}`);
      if (!moved) return { ok: false, restored: true };
      try {
        await fs.rename(prevDir, clientDir);
        return { ok: false, restored: true };
      } catch {
        log('could not put dist/client back');
        return { ok: false, restored: false };
      }
    }
  }

  async function rollback(from: string, installRan: boolean, step: UpdateFailedStep, clientOk: boolean) {
    log(`rolling back to ${from.slice(0, 8)} after ${step}`);
    let ok = clientOk;
    const reset = await git(
      ['-c', 'core.hooksPath=/dev/null', 'reset', '--hard', from],
      UPDATE_TIMEOUTS.merge,
    );
    if (reset.code !== 0) {
      logFailure('rollback reset', reset);
      ok = false;
    } else {
      changedFrom = null;
    }
    if (installRan) {
      const again = await install();
      if (again.code !== 0) {
        logFailure('rollback install', again);
        ok = false;
      }
    }
    try {
      await fs.rm(nextDir, { recursive: true, force: true });
    } catch {
      ok = false;
    }
    if (ok) {
      try {
        await fs.rm(markerPath, { force: true });
        pending = null;
        unfinished = false;
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      unfinished = true;
      log('rollback failed; the marker stays');
    }
    phase = 'failed';
    error = ok ? UPDATE_FAILED_TEXT[step] : UPDATE_FAILED_TEXT['rollback-failed'];
  }

  async function runUpdate(resume: UpdatePending | null, recorded: string, toVersion: string): Promise<void> {
    log(`${resume ? 'finishing' : 'starting'} update ${currentVersion} -> ${toVersion}`);
    let head: string;
    let target: string;
    let from: string;
    try {
      ({ head, target, from } = await preflight(resume, recorded));
      if (!resume) {
        pending = {
          from: head,
          to: target,
          fromVersion: currentVersion,
          toVersion,
          startedAt: deps.now().toISOString(),
        };
        await writeMarker(pending);
      }
    } catch (e) {
      log(`pre-flight refused: ${e instanceof Error ? e.message : String(e)}`);
      if (!resume) pending = null;
      phase = 'failed';
      error = UPDATE_FAILED_TEXT.preflight;
      return;
    }
    if (head !== from) changedFrom = from;

    let step: UpdateFailedStep = 'download';
    let installRan = false;
    let clientOk = true;
    try {
      // (b) Merge the recorded SHA, never the moving origin/main, with hooks off.
      if (head !== target) {
        phase = 'downloading';
        // Set before the merge: a merge cut off half-way has changed the code too.
        changedFrom = from;
        await must(
          'download',
          'merge',
          git(['-c', 'core.hooksPath=/dev/null', 'merge', '--ff-only', target], UPDATE_TIMEOUTS.merge),
        );
      }
      // (c) Install only when the lockfile or package.json changed; a resume always reinstalls.
      step = 'install';
      phase = 'installing';
      const changed = resume
        ? true
        : (await git(['diff', '--quiet', head, target, '--', 'pnpm-lock.yaml', 'package.json'])).code !== 0;
      if (changed) {
        installRan = true;
        await must('install', 'install', install());
      }
      // (d) Build beside the served folder. Vite resolves a relative outDir against client/, so absolute.
      step = 'build';
      phase = 'building';
      await must(
        'build',
        'build',
        exec(
          deps.nodePath,
          ['node_modules/vite/bin/vite.js', 'build', '--outDir', nextDir, '--emptyOutDir'],
          UPDATE_TIMEOUTS.build,
        ),
      );
      // (e) The new server code must at least load.
      step = 'boot-check';
      await must(
        'boot-check',
        'boot check',
        exec(bootNode, ['server/index.ts', '--check'], UPDATE_TIMEOUTS.bootCheck),
      );
      // (f) Swap the client build.
      if (aborted) throw new Aborted();
      const swapped = await swap();
      clientOk = swapped.restored;
      if (!swapped.ok) throw new StepFailed('build');
      changedFrom = null;
    } catch (e) {
      if (aborted || e instanceof Aborted) {
        // Shutting down: abort() resets the code if needed and the marker stays for a resume.
        log(`stopped during ${step}; the marker stays`);
        phase = 'failed';
        unfinished = pending !== null;
        error = unfinished ? UPDATE_UNFINISHED_TEXT : UPDATE_FAILED_TEXT[step];
        return;
      }
      if (!(e instanceof StepFailed)) log(`${step} failed: ${e instanceof Error ? e.message : String(e)}`);
      await rollback(from, installRan, e instanceof StepFailed ? e.step : step, clientOk);
      return;
    }

    try {
      await fs.rm(markerPath, { force: true });
    } catch {
      log(`could not remove ${PENDING_FILE}`);
    }
    pending = null;
    unfinished = false;
    error = null;
    // (g) launchd starts the server again on the new code.
    phase = 'restarting';
    log(`updated to ${toVersion}; restarting`);
    // Already shutting down after abort(): launchd starts the new code anyway.
    if (!aborted) deps.restart();
  }

  async function start(): Promise<UpdateStatus> {
    if (running || aborted) throw new UpdateRefused('busy');
    running = true;
    let resume: UpdatePending | null;
    let target: string;
    let toVersion: string;
    try {
      if (inflight) await inflight.catch(() => undefined);
      await refreshBlocked();
      if (blocked) throw new UpdateRefused('not-allowed');
      resume = unfinished ? pending : null;
      if (resume) {
        target = resume.to;
        toVersion = resume.toVersion;
      } else if (available && recordedSha && latest) {
        target = recordedSha;
        toVersion = latest;
      } else {
        throw new UpdateRefused('not-allowed');
      }
    } catch (e) {
      running = false;
      throw e;
    }
    phase = 'downloading';
    error = null;
    const s = snapshot();
    updateRun = runUpdate(resume, target, toVersion)
      .catch((e) => {
        log(`update stopped: ${e instanceof Error ? e.message : String(e)}`);
        phase = 'failed';
        error = UPDATE_FAILED_TEXT['rollback-failed'];
        unfinished = pending !== null;
      })
      .finally(() => {
        // After a successful update the process is restarting: stay busy until it goes.
        if (phase !== 'restarting') running = false;
        updateRun = null;
      });
    s.openChats = await countChats();
    return s;
  }

  // --- Timer -----------------------------------------------------------------------------------
  const tick = (): void => {
    if (running) return;
    check().catch((e) => log(`timed check failed: ${e instanceof Error ? e.message : String(e)}`));
  };

  function stopTimer(): void {
    if (firstTimer) clearTimeout(firstTimer);
    if (interval) clearInterval(interval);
    firstTimer = undefined;
    interval = undefined;
  }

  /** Waits for `p` to settle, or `ms`, whichever comes first. Never rejects. */
  const settleWithin = (p: Promise<unknown>, ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref();
      p.then(
        () => resolve(),
        () => resolve(),
      ).finally(() => clearTimeout(t));
    });

  function abort(): Promise<void> {
    aborting ??= (async () => {
      try {
        stopTimer();
        aborted = true;
        deps.run.killAll();
        if (updateRun) await settleWithin(updateRun, ABORT_WAIT_MS);
        if (changedFrom) {
          const from = changedFrom;
          // The one command allowed after abort: put the code back; the marker stays for a resume.
          const r = await deps.run('git', ['-c', 'core.hooksPath=/dev/null', 'reset', '--hard', from], {
            cwd: appRoot,
            timeoutMs: ABORT_WAIT_MS,
            env,
          });
          if (r.code === 0) {
            changedFrom = null;
            log(`abort: reset to ${from.slice(0, 8)}; the marker stays`);
          } else {
            logFailure('abort reset', r);
          }
        }
      } catch (e) {
        log(`abort: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return aborting;
  }

  return {
    status,
    check,
    start,
    abort,
    stopTimer,
    startTimer() {
      if (!deps.underService || firstTimer || interval) return;
      firstTimer = setTimeout(() => {
        firstTimer = undefined;
        tick();
        interval = setInterval(tick, UPDATE_CHECK_EVERY_MS);
        interval.unref();
      }, UPDATE_FIRST_CHECK_AFTER_MS);
      firstTimer.unref();
    },
  };
}
