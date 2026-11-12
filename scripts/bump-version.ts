/**
 * Run by the post-commit, post-merge and pre-push hooks in .githooks. On `main` only, it looks at the commits
 * since the last release that haven't been pushed yet. If any is a feat, fix, perf or refactor (or
 * marked breaking), it bumps "version" in package.json, adds an entry to CHANGELOG.md and commits both
 * as `chore(release): vX.Y.Z`.
 *
 * Why main only: task branches never bump, so two branches can't both claim the same version and
 * conflict. Merging a branch into main (fast-forward or not) bumps once for everything it brings.
 * pre-push is the safety net for ways onto main that run no hook (cherry-pick, am, a skipped bump).
 * Why unpushed only: a `git pull` (for example in the installed copy) brings in commits that were
 * released elsewhere, so it never bumps.
 *
 * It does nothing (and says why) when:
 *   - SKIP_VERSION_BUMP=1 is set;
 *   - a rebase, cherry-pick or revert is still in progress (a skipped bump is picked up by the next one,
 *     because each release covers everything since the last). MERGE_HEAD isn't checked: git keeps it
 *     while post-merge runs, after the merge commit is already made.
 *   - package.json or CHANGELOG.md already has changes of its own, which the release commit
 *     would otherwise sweep up.
 * The release commit is made without running hooks, so it never triggers itself.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { addChangelogEntry, nextVersion, parseCommit, releaseBump, setPackageVersion } from './version.ts';

const RELEASE_BRANCH = 'main';
const FILES = ['package.json', 'CHANGELOG.md'];

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim();
const say = (text: string) => console.log(`[version] ${text}`);

function tryGit(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function inProgress(root: string): boolean {
  return ['rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].some((name) => {
    const p = git('rev-parse', '--git-path', name);
    return existsSync(isAbsolute(p) ? p : join(root, p));
  });
}

function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Full messages of the unreleased, unpushed commits on HEAD, oldest first. Merge commits are left out. */
function unreleasedMessages(): string[] {
  const lastRelease = git('log', '-1', '--format=%H', '-E', '--grep=^chore\\(release\\): ');
  const args = [
    'log',
    '--reverse',
    '--no-merges',
    '--format=%B%x00',
    lastRelease ? `${lastRelease}..HEAD` : 'HEAD',
  ];
  if (tryGit('rev-parse', '--verify', '--quiet', '@{u}')) args.push('--not', '@{u}');
  return git(...args)
    .split('\0')
    .map((m) => m.trim())
    .filter(Boolean);
}

/** Makes the release commit if one is due. Returns the new version, or null if it made none. */
function release(): string | null {
  if (process.env.SKIP_VERSION_BUMP === '1') return null;
  if (tryGit('symbolic-ref', '--quiet', '--short', 'HEAD') !== RELEASE_BRANCH) return null;
  const root = git('rev-parse', '--show-toplevel');
  process.chdir(root);
  if (inProgress(root)) return null;

  const commits = unreleasedMessages().map(parseCommit);
  const bump = releaseBump(commits);
  if (!bump) return null;

  if (git('status', '--porcelain', '--', ...FILES) !== '') {
    say('Skipped: package.json or CHANGELOG.md has uncommitted changes. Commit them, then bump by hand.');
    return null;
  }

  const pkgText = readFileSync('package.json', 'utf8');
  const current = (JSON.parse(pkgText) as { version?: unknown }).version;
  if (typeof current !== 'string') throw new Error('package.json has no version');
  const version = nextVersion(current, bump);

  const items = commits.flatMap((c) => (c?.bump ? [{ type: c.type, subject: c.subject }] : []));
  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  writeFileSync('package.json', setPackageVersion(pkgText, version));
  writeFileSync('CHANGELOG.md', addChangelogEntry(changelog, { version, date: localDate(), items }));
  try {
    commitRelease(`chore(release): v${version}`);
  } catch (err) {
    // No release commit was made, so put the files back as they were.
    writeFileSync('package.json', pkgText);
    writeFileSync('CHANGELOG.md', changelog);
    throw err;
  }
  say(`v${current} → v${version} (${bump}, ${items.length} change${items.length === 1 ? '' : 's'})`);
  // The release commit exists now, so the new files stay whatever happens next. The real index still
  // holds the old versions of the two files; bring it up to date.
  if (tryGit('reset', '--quiet', '--', ...FILES) === null) {
    say('Made the release commit, but git was busy so the staging area still shows the old version.');
    say('Run this before your next commit: git reset -- package.json CHANGELOG.md');
  }
  return version;
}

/**
 * Commits just package.json and CHANGELOG.md on top of HEAD, using a scratch index, so anything else
 * staged stays staged and it works while git still holds merge state (it does during post-merge).
 * It doesn't run the commit hooks, so it can't loop. Throws only if the commit wasn't made.
 */
function commitRelease(message: string) {
  const head = git('rev-parse', 'HEAD');
  const scratch = git('rev-parse', '--git-path', 'version-bump-index');
  const env = {
    ...process.env,
    GIT_INDEX_FILE: isAbsolute(scratch) ? scratch : join(process.cwd(), scratch),
  };
  const g = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', env }).trim();
  try {
    g('read-tree', head);
    g('update-index', '--add', '--', ...FILES);
    const tree = g('write-tree');
    const commit = g('commit-tree', tree, '-p', head, '-m', message);
    git('update-ref', '-m', message, 'HEAD', commit, head);
  } finally {
    rmSync(env.GIT_INDEX_FILE, { force: true });
  }
}

// With --pre-push (from .githooks/pre-push), exit code 3 means a release commit was just added, so the
// push must stop and be run again to include it. Every other outcome lets the push go ahead.
try {
  const made = release();
  if (made && process.argv.includes('--pre-push')) {
    say(`Added the release commit for v${made}, so this push stopped. Push again to include it.`);
    process.exitCode = 3;
  }
} catch (err) {
  say(`Skipped: ${err instanceof Error ? err.message : String(err)}`);
}
