import { describe, expect, it } from 'vitest';
import { createProjectResolver } from './projects.ts';

const HOME = '/Users/ian';
function resolver(extra: { repoRoots?: string[]; known?: string[] } = {}) {
  const roots = new Set(extra.repoRoots ?? ['/Users/ian/My Repos/app']);
  return createProjectResolver({
    home: HOME,
    brainPaths: ['/Users/ian/agencybrain', '/Users/ian/Brains/tds'],
    tempDirs: ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders'],
    isRepoRoot: (p) => roots.has(p),
    knownCwds: new Set(extra.known ?? ['/Users/ian/My Repos/app']),
  });
}
const label = (cwd: string | undefined, branch: string | undefined, r = resolver()) =>
  r.resolve(cwd, branch).label;

describe('project names from the session folder', () => {
  it('names a repo by its last folder, spaces in the path or not', () => {
    expect(label('/Users/ian/My Repos/app', 'main')).toBe('app');
    expect(label('/Users/ian/My Repos/app/client', 'main')).toBe('app');
  });
  it('home, brain and temporary folders', () => {
    expect(label('/Users/ian', undefined)).toBe('Home folder');
    expect(label('/Users/ian/agencybrain', 'main')).toBe('Brain');
    expect(label('/Users/ian/agencybrain/clients/x', 'main')).toBe('Brain');
    expect(label('/Users/ian/Brains/tds', 'main')).toBe('Brain');
    expect(label('/private/tmp/claude-501/-Users-ian/abc/scratchpad', 'HEAD')).toBe('Temporary folders');
    expect(label('/tmp/x', undefined)).toBe('Temporary folders');
    expect(label('/private/var/folders/ab/T/zzz', undefined)).toBe('Temporary folders');
  });
  it('folds a sibling worktree whose suffix equals the branch into the repo', () => {
    const r = resolver();
    expect(r.resolve('/Users/ian/My Repos/app-settings-performance', 'settings-performance')).toEqual(
      r.resolve('/Users/ian/My Repos/app', 'main'),
    );
    expect(label('/Users/ian/My Repos/app-other', 'something-else', r)).toBe('app-other');
  });
  it('folds only when the repo is also a project', () => {
    const r = resolver({ repoRoots: [], known: [] });
    expect(label('/Users/ian/My Repos/app-x', 'x', r)).toBe('app-x');
  });
  it('folds a worktree inside the repo', () => {
    expect(label('/Users/ian/My Repos/app/.claude/worktrees/x', 'x')).toBe('app');
  });
  it('a missing cwd is Unknown', () => {
    expect(label(undefined, undefined)).toBe('Unknown');
  });
});
