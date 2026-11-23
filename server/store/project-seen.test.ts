import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PROJECT_SEEN_FILE,
  PROJECT_SEEN_LIST_MAX,
  PROJECT_SEEN_MAX,
  type ProjectSeen,
} from '../../shared/project-activity-contract.ts';
import { createProjectSeenStore } from './project-seen.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'tba-ps-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(join(d, PROJECT_SEEN_FILE), 0o600);
    } catch {}
    rmSync(d, { recursive: true, force: true });
  }
});

const saved = (dir: string) => JSON.parse(readFileSync(join(dir, PROJECT_SEEN_FILE), 'utf8'));
const seen = (over: Partial<ProjectSeen> = {}): ProjectSeen => ({
  at: '2026-11-20T10:00:00.000Z',
  folder: 'clients/acme/projects/web',
  todos: ['a.md'],
  links: ['clients/acme/notes.md'],
  files: ['brief.md'],
  ...over,
});

describe('project seen store', () => {
  it('saves, reads and survives a restart', async () => {
    const dir = tmp();
    const a = createProjectSeenStore(dir);
    await a.set('acme/web', seen({ todoTitles: { 'a.md': 'Send it' } }));
    expect(await a.get('acme/web')).toEqual(seen({ todoTitles: { 'a.md': 'Send it' } }));
    expect(await a.get('acme/other')).toBeNull();
    expect(await createProjectSeenStore(dir).get('acme/web')).toEqual(
      seen({ todoTitles: { 'a.md': 'Send it' } }),
    );
    expect(saved(dir).v).toBe(1);
  });

  it('is memory only with a null folder, and ignores bad keys and bad snapshots', async () => {
    const s = createProjectSeenStore(null);
    await s.set('acme/web', seen());
    await s.set('../etc', seen());
    await s.set('acme/bad', { ...seen(), todos: 'no' } as never);
    await s.set('acme/bad2', null as never);
    expect(await s.get('acme/web')).toEqual(seen());
    expect(await s.get('acme/bad')).toBeNull();
    expect(await s.get('acme/bad2')).toBeNull();
  });

  it('copies broken JSON to .broken once and reads empty', async () => {
    const dir = tmp();
    writeFileSync(join(dir, PROJECT_SEEN_FILE), '{nope');
    const lines: string[] = [];
    const s = createProjectSeenStore(dir, (l) => lines.push(l));
    expect(await s.get('acme/web')).toBeNull();
    expect(readFileSync(join(dir, `${PROJECT_SEEN_FILE}.broken`), 'utf8')).toBe('{nope');
    await s.set('acme/web', seen());
    expect(lines).toHaveLength(1);
    expect(saved(dir).projects['acme/web'].folder).toBe(seen().folder);
  });

  it('a read error other than a missing file does not overwrite the file', async () => {
    const dir = tmp();
    const path = join(dir, PROJECT_SEEN_FILE);
    const original = JSON.stringify({ v: 1, projects: { 'acme/keep': seen() } });
    writeFileSync(path, original);
    chmodSync(path, 0o000);
    const lines: string[] = [];
    const s = createProjectSeenStore(dir, (l) => lines.push(l));
    await s.set('acme/new', seen());
    expect(await s.get('acme/keep')).toBeNull();
    chmodSync(path, 0o600);
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(lines).toHaveLength(1);
    expect(await s.get('acme/keep')).toEqual(seen());
  });

  it('drops bad entries one by one', async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, PROJECT_SEEN_FILE),
      JSON.stringify({
        v: 1,
        projects: {
          'acme/good': seen(),
          'acme/badDate': seen({ at: 'nope' }),
          'acme/noFolder': { ...seen(), folder: '' },
          '../x': seen(),
          'acme/notObject': 'x',
        },
      }),
    );
    const s = createProjectSeenStore(dir);
    expect(await s.get('acme/good')).toEqual(seen());
    expect(await s.get('acme/badDate')).toBeNull();
    expect(await s.get('acme/noFolder')).toBeNull();
  });

  it(`caps at ${PROJECT_SEEN_MAX} projects, dropping the oldest at`, async () => {
    const dir = tmp();
    const projects: Record<string, ProjectSeen> = {};
    for (let i = 0; i < PROJECT_SEEN_MAX; i++)
      projects[`acme/p${i}`] = seen({ at: new Date(Date.UTC(2025, 0, 1) + i * 1000).toISOString() });
    writeFileSync(join(dir, PROJECT_SEEN_FILE), JSON.stringify({ v: 1, projects }));
    const s = createProjectSeenStore(dir);
    await s.set('acme/new-a', seen());
    await s.set('acme/new-b', seen());
    expect(Object.keys(saved(dir).projects)).toHaveLength(PROJECT_SEEN_MAX);
    expect(await s.get('acme/p0')).toBeNull();
    expect(await s.get('acme/p1')).toBeNull();
    expect(await s.get('acme/p2')).not.toBeNull();
    expect(await s.get('acme/new-b')).not.toBeNull();
  });

  it(`cuts a list over ${PROJECT_SEEN_LIST_MAX} (newest kept) and marks cut`, async () => {
    const s = createProjectSeenStore(null);
    const files = Array.from({ length: PROJECT_SEEN_LIST_MAX + 5 }, (_, i) => `f${i}.md`);
    await s.set('acme/web', seen({ files }));
    const got = (await s.get('acme/web')) as ProjectSeen;
    expect(got.files).toHaveLength(PROJECT_SEEN_LIST_MAX);
    expect(got.files[0]).toBe('f5.md');
    expect(got.files.at(-1)).toBe(`f${PROJECT_SEEN_LIST_MAX + 4}.md`);
    expect(got.cut).toBe(true);
    await s.set('acme/ok', seen());
    expect(((await s.get('acme/ok')) as ProjectSeen).cut).toBeUndefined();
  });

  it('never loses a snapshot when a first read and a save overlap', async () => {
    for (let run = 0; run < 15; run++) {
      const dir = tmp();
      writeFileSync(join(dir, PROJECT_SEEN_FILE), JSON.stringify({ v: 1, projects: {} }));
      const s = createProjectSeenStore(dir);
      await Promise.all([s.get('acme/x'), s.set('acme/first', seen())]);
      await s.set('acme/second', seen());
      expect(Object.keys(saved(dir).projects).sort()).toEqual(['acme/first', 'acme/second']);
    }
  });
});
