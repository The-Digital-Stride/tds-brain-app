import { describe, expect, it } from 'vitest';
import { addChangelogEntry, nextVersion, parseCommit, releaseBump, setPackageVersion } from './version.ts';

describe('parseCommit', () => {
  it('bumps minor for a feature, patch for a fix, perf or refactor', () => {
    expect(parseCommit('feat: brain icon')).toEqual({ type: 'feat', subject: 'brain icon', bump: 'minor' });
    expect(parseCommit('fix(rail): logo size')?.bump).toBe('patch');
    expect(parseCommit('perf: faster load')?.bump).toBe('patch');
    expect(parseCommit('refactor: tidy')?.bump).toBe('patch');
  });

  it('bumps major for a ! or a BREAKING CHANGE footer', () => {
    expect(parseCommit('feat!: new data folder')?.bump).toBe('major');
    expect(parseCommit('fix(api)!: drop old route')?.bump).toBe('major');
    expect(parseCommit('refactor: x\n\nBREAKING CHANGE: settings move')?.bump).toBe('major');
    expect(parseCommit('chore!: drop old node')?.bump).toBe('major');
    expect(parseCommit('build: x\n\nBREAKING CHANGE: needs node 24')?.bump).toBe('major');
  });

  it('does not bump for housekeeping, releases, merges or free-form messages', () => {
    for (const m of [
      'chore: deps',
      'docs: readme',
      'style: format',
      'test: more',
      'ci: x',
      'build: x',
      'chore(release): v0.3.0',
      "Merge branch 'x'",
      'Revert "feat: thing"',
      'just some words',
    ]) {
      expect(parseCommit(m)?.bump ?? null).toBeNull();
    }
  });

  it('takes the subject from the first line only', () => {
    expect(parseCommit('feat: one line\n\nmore detail here')?.subject).toBe('one line');
  });
});

describe('releaseBump', () => {
  const c = (m: string) => parseCommit(m);

  it('takes the largest bump among the commits', () => {
    expect(releaseBump([c('fix: a'), c('docs: b')])).toBe('patch');
    expect(releaseBump([c('fix: a'), c('feat: b'), c('refactor: c')])).toBe('minor');
    expect(releaseBump([c('feat: a'), c('fix!: b')])).toBe('major');
  });

  it('is null when nothing needs a bump', () => {
    expect(releaseBump([])).toBeNull();
    expect(releaseBump([c('docs: a'), c('chore: b'), c('words'), null])).toBeNull();
  });
});

describe('nextVersion', () => {
  it('bumps and resets the lower parts', () => {
    expect(nextVersion('0.2.0', 'minor')).toBe('0.3.0');
    expect(nextVersion('0.2.5', 'minor')).toBe('0.3.0');
    expect(nextVersion('0.2.5', 'patch')).toBe('0.2.6');
    expect(nextVersion('1.4.2', 'major')).toBe('2.0.0');
  });

  it('refuses a version it cannot read', () => {
    expect(() => nextVersion('1.2', 'patch')).toThrow();
    expect(() => nextVersion('1.2.3-beta.1', 'patch')).toThrow();
  });
});

describe('addChangelogEntry', () => {
  const entry = {
    version: '0.3.0',
    date: '2026-11-13',
    items: [
      { type: 'feat', subject: 'a thing' },
      { type: 'fix', subject: 'another' },
    ],
  };

  it('puts the new entry above the newest one, under the heading, one line per change', () => {
    const before = '# Changelog\n\nIntro.\n\n## v0.2.0 — 2026-11-12\n\n- **feat**: old\n';
    expect(addChangelogEntry(before, entry)).toBe(
      '# Changelog\n\nIntro.\n\n## v0.3.0 — 2026-11-13\n\n- **feat**: a thing\n- **fix**: another\n\n## v0.2.0 — 2026-11-12\n\n- **feat**: old\n',
    );
  });

  it('adds the first entry after the heading', () => {
    expect(addChangelogEntry('# Changelog\n', { ...entry, items: [{ type: 'feat', subject: 'x' }] })).toBe(
      '# Changelog\n\n## v0.3.0 — 2026-11-13\n\n- **feat**: x\n',
    );
  });
});

describe('setPackageVersion', () => {
  it('changes only the version line, keeping the rest of package.json as it was', () => {
    const pkg = '{\n  "name": "x",\n  "version": "0.2.0",\n  "dependencies": { "a": "0.2.0" }\n}\n';
    expect(setPackageVersion(pkg, '0.3.0')).toBe(
      '{\n  "name": "x",\n  "version": "0.3.0",\n  "dependencies": { "a": "0.2.0" }\n}\n',
    );
  });

  it('refuses a package.json without a top-level version', () => {
    expect(() => setPackageVersion('{\n  "name": "x"\n}\n', '0.3.0')).toThrow();
  });
});
