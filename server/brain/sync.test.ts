import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createSyncReader, readSync } from './sync.ts';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'brain-sync-'));
  temps.push(d);
  return d;
}

const WHEN = new Date('2026-11-12T11:24:44.000Z');

describe('readSync', () => {
  it('reads the time FETCH_HEAD was last written', async () => {
    const root = temp();
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'FETCH_HEAD'), 'abc\t\tbranch main\n');
    utimesSync(join(root, '.git', 'FETCH_HEAD'), WHEN, WHEN);
    expect(await readSync(root)).toEqual({ lastSync: WHEN.toISOString() });
  });

  it('follows a .git file to a git folder kept elsewhere (a worktree or submodule)', async () => {
    const root = temp();
    const gitDir = join(temp(), 'real-git');
    mkdirSync(gitDir);
    writeFileSync(join(gitDir, 'FETCH_HEAD'), 'abc\n');
    utimesSync(join(gitDir, 'FETCH_HEAD'), WHEN, WHEN);
    writeFileSync(join(root, '.git'), `gitdir: ${gitDir}\n`);
    expect(await readSync(root)).toEqual({ lastSync: WHEN.toISOString() });
  });

  it('resolves a relative gitdir from the brain folder', async () => {
    const root = temp();
    mkdirSync(join(root, 'elsewhere'));
    writeFileSync(join(root, 'elsewhere', 'FETCH_HEAD'), 'abc\n');
    utimesSync(join(root, 'elsewhere', 'FETCH_HEAD'), WHEN, WHEN);
    writeFileSync(join(root, '.git'), 'gitdir: elsewhere\n');
    expect(await readSync(root)).toEqual({ lastSync: WHEN.toISOString() });
  });

  it('is null when the brain has never fetched', async () => {
    const root = temp();
    mkdirSync(join(root, '.git'));
    expect(await readSync(root)).toEqual({ lastSync: null });
  });

  it('is null when the folder is not a git folder, or is missing', async () => {
    expect(await readSync(temp())).toEqual({ lastSync: null });
    expect(await readSync(join(temp(), 'missing'))).toEqual({ lastSync: null });
  });

  it('is null for a .git file that does not name a folder', async () => {
    const root = temp();
    writeFileSync(join(root, '.git'), 'nonsense\n');
    expect(await readSync(root)).toEqual({ lastSync: null });
  });
});

describe('createSyncReader', () => {
  const LATER = new Date('2026-11-12T11:40:00.000Z');

  function brain() {
    const root = temp();
    mkdirSync(join(root, '.git'));
    const head = join(root, '.git', 'FETCH_HEAD');
    const write = (text: string, at: Date) => {
      writeFileSync(head, text);
      utimesSync(head, at, at);
    };
    return { root, write };
  }

  it('does not count a failed fetch: git empties FETCH_HEAD but still updates its time', async () => {
    const { root, write } = brain();
    const sync = createSyncReader(root);
    write('abc\t\tbranch main\n', WHEN);
    expect(await sync.read()).toEqual({ lastSync: WHEN.toISOString() });
    // Offline, or the GitHub login has expired: every attempt now leaves an empty file.
    write('', LATER);
    expect(await sync.read()).toEqual({ lastSync: WHEN.toISOString() });
    // Back online.
    write('def\t\tbranch main\n', LATER);
    expect(await sync.read()).toEqual({ lastSync: LATER.toISOString() });
  });

  it('has no sync to report when the first thing it sees is a failed fetch', async () => {
    const { root, write } = brain();
    write('', LATER);
    expect(await createSyncReader(root).read()).toEqual({ lastSync: null });
  });
});
