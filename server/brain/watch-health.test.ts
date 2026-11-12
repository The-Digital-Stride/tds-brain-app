import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BrainArea } from '../../shared/contract.ts';
import { createBrainReaders } from './index.ts';
import { copyFixture, FIXTURE } from './test-helpers.ts';
import { watchBrain } from './watch.ts';

describe('health', () => {
  it('is ok for the fixture and explains a missing brain', async () => {
    expect(await createBrainReaders(FIXTURE).health()).toEqual({ ok: true, path: FIXTURE, problems: [] });
    const bad = await createBrainReaders('/nonexistent/brain').health();
    expect(bad.ok).toBe(false);
    expect(bad.problems[0]).toBe('The brain folder was not found at /nonexistent/brain.');
  });
});

describe('watch', () => {
  it('reports a changed area once (debounced) and stops cleanly', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    const seen: BrainArea[] = [];
    const stop = brain.watch((a) => seen.push(a));
    await new Promise((r) => setTimeout(r, 500)); // let the OS watcher finish starting
    mkdirSync(join(root, 'todo'), { recursive: true });
    writeFileSync(join(root, 'todo', '20261201-new.md'), 'a');
    writeFileSync(join(root, 'todo', '20261201-new.md'), 'b');
    await new Promise((r) => setTimeout(r, 1200));
    stop();
    expect(seen.filter((a) => a === 'todos')).toHaveLength(1);
    expect(() => createBrainReaders('/nonexistent/brain').watch(() => {})()).not.toThrow();
  });
});

describe('watch: team profile', () => {
  it('reports identity when context/team-profile.md changes, however it is written, and ignores its neighbours', async () => {
    const root = copyFixture();
    const seen: BrainArea[] = [];
    const stop = createBrainReaders(root).watch((a) => seen.push(a));
    // Let the OS watcher start, and let late news of the fixture copy itself (roles.json) pass.
    await new Promise((r) => setTimeout(r, 1000));
    seen.length = 0;
    writeFileSync(join(root, 'context', 'notes.md'), 'not the profile');
    await new Promise((r) => setTimeout(r, 700));
    expect(seen).toEqual([]);
    // In place, as an editor saves it.
    writeFileSync(
      join(root, 'context', 'team-profile.md'),
      '| Name | Departments |\n|---|---|\n| Sam | SEO |\n',
    );
    await new Promise((r) => setTimeout(r, 700));
    expect(seen).toEqual(['identity']);
    // Removed and written afresh, as a git pull replaces a changed file.
    rmSync(join(root, 'context', 'team-profile.md'));
    writeFileSync(
      join(root, 'context', 'team-profile.md'),
      '| Name | Departments |\n|---|---|\n| Sam | PPC |\n',
    );
    await new Promise((r) => setTimeout(r, 700));
    stop();
    expect(seen).toEqual(['identity', 'identity']);
  });
});

describe('watch: library', () => {
  it('fires library once for a change in a client or personal folder, passing the changed path on', async () => {
    const root = copyFixture();
    const seen: BrainArea[] = [];
    const changed: (string | null)[] = [];
    const live: string[] = [];
    const stop = watchBrain(root, (a) => seen.push(a), {
      onLibraryChange: (rel) => changed.push(rel),
      onLibraryLive: (folder, on) => live.push(`${folder}:${on}`),
    });
    expect(live).toEqual(['clients:true', 'personal:true']);
    await new Promise((r) => setTimeout(r, 500));
    writeFileSync(join(root, 'clients', 'acme-heating', 'reports', 'new.pdf'), 'a');
    writeFileSync(join(root, 'personal', 'notes', 'new.md'), 'a');
    await new Promise((r) => setTimeout(r, 1200));
    stop();
    expect(seen.filter((a) => a === 'library')).toHaveLength(1);
    expect(changed).toContain('clients/acme-heating/reports/new.pdf');
    expect(changed).toContain('personal/notes/new.md');
    expect(live).toEqual(['clients:true', 'personal:true', 'clients:false', 'personal:false']);
  });

  it('ignores changes in never-listed places', async () => {
    const root = copyFixture();
    mkdirSync(join(root, 'clients', 'acme-heating', 'crm', 'data'), { recursive: true });
    const seen: BrainArea[] = [];
    const changed: (string | null)[] = [];
    const stop = watchBrain(root, (a) => seen.push(a), { onLibraryChange: (rel) => changed.push(rel) });
    await new Promise((r) => setTimeout(r, 500));
    seen.length = 0;
    changed.length = 0;
    writeFileSync(join(root, 'clients', 'acme-heating', 'crm', 'data', 'people.csv'), 'a');
    writeFileSync(join(root, 'clients', 'acme-heating', 'reports', '.draft.md'), 'b');
    await new Promise((r) => setTimeout(r, 1200));
    stop();
    expect(changed).toEqual([]);
    expect(seen).not.toContain('library');
  });

  it('a listing picks up a new file once the watcher has seen it', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    const stop = brain.watch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    const before = await brain.library('client:acme-heating');
    writeFileSync(join(root, 'clients', 'acme-heating', 'reports', 'added.pdf'), 'a');
    await new Promise((r) => setTimeout(r, 800));
    const after = await brain.library('client:acme-heating');
    stop();
    expect(before?.items.map((i) => i.name)).not.toContain('added.pdf');
    expect(after?.items.map((i) => i.name)).toContain('added.pdf');
  });
});
