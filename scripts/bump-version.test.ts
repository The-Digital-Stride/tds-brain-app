import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, 'bump-version.ts');

// A git with no user or system config, so a developer's signing or hooks settings can't leak in.
const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};
delete ENV.SKIP_VERSION_BUMP;

let dir: string;
let repo: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo,
    env: ENV,
    encoding: 'utf8',
  }).trim();
const bump = (...args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, env: ENV, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const version = () =>
  (JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { version: string }).version;
const subject = () => git('log', '-1', '--format=%s');
const commitFile = (name: string, message: string) => {
  writeFileSync(join(repo, name), name);
  git('add', name);
  git('commit', '-q', '-m', message);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bump-version-'));
  repo = join(dir, 'repo');
  mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'package.json'), '{\n  "name": "t",\n  "version": "0.2.0"\n}\n');
  writeFileSync(join(repo, 'CHANGELOG.md'), '# Changelog\n\n## v0.2.0 — 2026-11-12\n\n- **feat**: old\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore(release): v0.2.0');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('bump-version', () => {
  it('releases the unreleased changes on main in one commit holding only the two files', () => {
    commitFile('a', 'feat: A');
    commitFile('b', 'fix: B');
    commitFile('c', 'docs: C');
    expect(bump().out).toContain('v0.2.0 → v0.3.0 (minor, 2 changes)');
    expect(subject()).toBe('chore(release): v0.3.0');
    expect(version()).toBe('0.3.0');
    expect(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual([
      'CHANGELOG.md',
      'package.json',
    ]);
    expect(readFileSync(join(repo, 'CHANGELOG.md'), 'utf8')).toContain('- **feat**: A\n- **fix**: B\n');
    expect(git('status', '--porcelain')).toBe('');
    expect(bump().out).toBe('');
    expect(subject()).toBe('chore(release): v0.3.0');
  });

  it('never bumps on a task branch', () => {
    git('checkout', '-q', '-b', 'task');
    commitFile('a', 'feat: A');
    bump();
    expect(subject()).toBe('feat: A');
    expect(version()).toBe('0.2.0');
  });

  it('leaves other staged changes staged and out of the release', () => {
    commitFile('a', 'feat: A');
    writeFileSync(join(repo, 'staged'), 'x');
    git('add', 'staged');
    bump();
    expect(subject()).toBe('chore(release): v0.3.0');
    expect(git('show', '--name-only', '--format=', 'HEAD')).not.toContain('staged');
    expect(git('status', '--porcelain')).toBe('A  staged');
  });

  it('skips when package.json already has changes of its own', () => {
    commitFile('a', 'feat: A');
    writeFileSync(join(repo, 'package.json'), '{\n  "name": "edited",\n  "version": "0.2.0"\n}\n');
    expect(bump().out).toContain('Skipped: package.json or CHANGELOG.md has uncommitted changes');
    expect(subject()).toBe('feat: A');
  });

  it('skips while a rebase is in progress', () => {
    commitFile('a', 'feat: A');
    mkdirSync(join(repo, '.git', 'rebase-merge'));
    bump();
    expect(subject()).toBe('feat: A');
  });

  it('ignores commits already pushed, so a pull never bumps', () => {
    const remote = join(dir, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { env: ENV });
    git('remote', 'add', 'origin', remote);
    commitFile('a', 'feat: released elsewhere');
    git('push', '-q', '-u', 'origin', 'main');
    bump();
    expect(subject()).toBe('feat: released elsewhere');
    commitFile('b', 'fix: local');
    expect(bump().out).toContain('(patch, 1 change)');
  });

  it('puts the files back when the release commit could not be made', () => {
    commitFile('a', 'feat: A');
    writeFileSync(join(repo, '.git', 'refs', 'heads', 'main.lock'), '');
    expect(bump().out).toContain('Skipped');
    expect(subject()).toBe('feat: A');
    expect(version()).toBe('0.2.0');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('keeps the new files once the release commit exists, even if refreshing the index fails', () => {
    commitFile('a', 'feat: A');
    writeFileSync(join(repo, '.git', 'index.lock'), '');
    const { out } = bump();
    rmSync(join(repo, '.git', 'index.lock'));
    expect(subject()).toBe('chore(release): v0.3.0');
    expect(version()).toBe('0.3.0');
    expect(out).toContain('git reset -- package.json CHANGELOG.md');
    git('reset', '-q', '--', 'package.json', 'CHANGELOG.md');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('before a push, adds a missing release and says to push again', () => {
    commitFile('a', 'fix: cherry-picked');
    const first = bump('--pre-push');
    expect(first.code).toBe(3);
    expect(first.out).toContain('Push again');
    expect(subject()).toBe('chore(release): v0.2.1');
    expect(bump('--pre-push').code).toBe(0);
  });
});
