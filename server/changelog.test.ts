import { promises as fs, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChangelogReader, parseChangelog } from './changelog.ts';

const SAMPLE = `# Changelog

Written automatically. See \`scripts/bump-version.ts\`.

## v0.6.0 — 2026-11-13

- **feat**: tdsapp-todo skill v0.3 with 13 backward-compatible fixes
- **fix**: after a to-do conflict, keep a teammate's untouched fields

## v0.10.0 - 2026-12-01

- **perf**: faster lists

## v0.5.0

- plain line without a kind
- **refactor**: tidy
`;

describe('parseChangelog', () => {
  it('reads every version, newest first by version number, with its date and changes', () => {
    const versions = parseChangelog(SAMPLE);
    expect(versions.map((v) => v.version)).toEqual(['0.10.0', '0.6.0', '0.5.0']);
    expect(versions[1]).toEqual({
      version: '0.6.0',
      date: '2026-11-13',
      changes: [
        { kind: 'feat', text: 'tdsapp-todo skill v0.3 with 13 backward-compatible fixes' },
        { kind: 'fix', text: "after a to-do conflict, keep a teammate's untouched fields" },
      ],
    });
    expect(versions[0]?.date).toBe('2026-12-01');
  });

  it('keeps a version without a date, and a change without a kind', () => {
    const v = parseChangelog(SAMPLE).find((x) => x.version === '0.5.0');
    expect(v?.date).toBeNull();
    expect(v?.changes).toEqual([
      { kind: '', text: 'plain line without a kind' },
      { kind: 'refactor', text: 'tidy' },
    ]);
  });

  it('ignores the preamble, other headings and CRLF line ends', () => {
    expect(parseChangelog('# Changelog\r\n\r\n- **feat**: before any version\r\n## Notes\r\n')).toEqual([]);
    expect(parseChangelog('## v1.2.3 — 2026-01-02\r\n\r\n- **fix**: a\r\n')).toEqual([
      { version: '1.2.3', date: '2026-01-02', changes: [{ kind: 'fix', text: 'a' }] },
    ]);
  });

  it('reads any commit type the version script writes, in lower case', () => {
    expect(
      parseChangelog('## v1.0.0 — 2026-01-01\n\n- **Fix**: crash on start\n- **build_2**: x\n')[0]?.changes,
    ).toEqual([
      { kind: 'fix', text: 'crash on start' },
      { kind: 'build_2', text: 'x' },
    ]);
  });

  it('stops adding to a version at the next heading that is not a version', () => {
    const v = parseChangelog('## v1.0.0 — 2026-01-01\n\n- **feat**: one\n\n## Notes\n\n- not a change\n');
    expect(v[0]?.changes).toEqual([{ kind: 'feat', text: 'one' }]);
  });

  it('gives nothing for empty or non-text input', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog(undefined as unknown as string)).toEqual([]);
  });
});

describe('createChangelogReader', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it("reads the app's CHANGELOG.md, and again only when the file changes", async () => {
    dir = mkdtempSync(join(tmpdir(), 'tba-changelog-'));
    const file = join(dir, 'CHANGELOG.md');
    writeFileSync(file, '## v0.1.0 — 2026-11-11\n\n- **feat**: first\n');
    const read = createChangelogReader(dir);
    expect((await read()).map((v) => v.version)).toEqual(['0.1.0']);
    writeFileSync(file, '## v0.2.0 — 2026-11-12\n\n- **feat**: second\n\n## v0.1.0 — 2026-11-11\n');
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect((await read()).map((v) => v.version)).toEqual(['0.2.0', '0.1.0']);
  });

  it('does not read the file again while it is unchanged', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tba-changelog-'));
    writeFileSync(join(dir, 'CHANGELOG.md'), '## v0.1.0 — 2026-11-11\n\n- **feat**: first\n');
    const spy = vi.spyOn(fs, 'readFile');
    try {
      const read = createChangelogReader(dir);
      await read();
      await read();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('gives an empty list when the file is missing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tba-changelog-'));
    expect(await createChangelogReader(dir)()).toEqual([]);
  });
});
