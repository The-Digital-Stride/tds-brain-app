import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LIBRARY_SEARCH_MAX } from '../../shared/contract.ts';
import { listClients } from './clients.ts';
import { createLibrary, type LibraryOptions } from './library.ts';
import type { ProjectsIndex } from './projects.ts';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function brain(files: Record<string, string | { at: number; body?: string }>): string {
  const root = mkdtempSync(join(tmpdir(), 'tba-search-'));
  temps.push(root);
  mkdirSync(join(root, 'clients'), { recursive: true });
  for (const [rel, v] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, typeof v === 'string' ? v : (v.body ?? 'x'));
    if (typeof v !== 'string') utimesSync(p, v.at, v.at);
  }
  return root;
}

function lib(root: string, over: Partial<LibraryOptions> = {}) {
  return createLibrary(root, { clients: () => listClients(root), ...over });
}

const ids = async (l: ReturnType<typeof lib>, q: string, kind: 'image' | 'document' = 'document') =>
  (await l.search(q, kind)).hits.map((h) => h.item.name);

describe('library search', () => {
  it('filters by kind', async () => {
    const root = brain({ 'clients/acme/logo.png': 'x', 'clients/acme/logo-notes.md': '# Logo notes' });
    const l = lib(root);
    expect(await ids(l, 'logo', 'image')).toEqual(['logo.png']);
    expect(await ids(l, 'logo', 'document')).toEqual(['logo-notes.md']);
  });

  it('matches every word in any order, across fields and the scope name', async () => {
    const root = brain({
      'clients/acme-heating/brand/logo.png': 'x',
      'clients/northwind/brand/logo.png': 'x',
      'clients/acme-heating/brand/other.png': 'x',
    });
    const l = lib(root);
    const r = await l.search('acme logo', 'image');
    expect(r.hits.map((h) => h.scope.id)).toEqual(['client:acme-heating']);
    expect((await l.search('logo ACME', 'image')).total).toBe(1);
    expect((await l.search('brand logo', 'image')).total).toBe(2);
    expect((await l.search('logo nonsense', 'image')).total).toBe(0);
  });

  it('matches group and folder words', async () => {
    const root = brain({ 'clients/acme/q4_plans/final-v2.md': '# Plan' });
    const l = lib(root);
    expect(await ids(l, 'q4 plans')).toEqual(['final-v2.md']);
  });

  it('ignores case and accents', async () => {
    const root = brain({ 'clients/acme/Café menu.md': '# Café Menu' });
    const l = lib(root);
    expect(await ids(l, 'cafe')).toEqual(['Café menu.md']);
    expect(await ids(l, 'CAFÉ')).toEqual(['Café menu.md']);
  });

  it('ranks title-start, word-start, contains, then other fields; ties newest first', async () => {
    const root = brain({
      'clients/acme/a-other.md': { at: 4000, body: '# Budget plan' }, // title starts with query
      'clients/acme/b-old.md': { at: 1000, body: '# Budget old' }, // starts, older
      'clients/acme/c-word.md': { at: 3000, body: '# Annual budget' }, // word start
      'clients/acme/d-in.md': { at: 3000, body: '# Rebudgeting' }, // contains
      'clients/acme/budget/e-fields.md': { at: 5000, body: '# Notes' }, // folder only
    });
    const l = lib(root);
    expect(await ids(l, 'budget')).toEqual(['a-other.md', 'b-old.md', 'c-word.md', 'd-in.md', 'e-fields.md']);
  });

  it('caps hits and reports the total', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < LIBRARY_SEARCH_MAX + 5; i++) files[`clients/acme/report-${i}.md`] = `# Report ${i}`;
    const r = await lib(brain(files)).search('report', 'document');
    expect(r.hits).toHaveLength(LIBRARY_SEARCH_MAX);
    expect(r.total).toBe(LIBRARY_SEARCH_MAX + 5);
    expect(r.partial).toBe(false);
  });

  it('never reads file contents', async () => {
    const root = brain({ 'clients/acme/notes.md': '# Notes\n\nzebrafish secret' });
    const l = lib(root);
    expect((await l.search('zebrafish', 'document')).total).toBe(0);
  });

  it('includes personal files, and not what a listing would hide', async () => {
    const root = brain({
      'personal/me/diary.md': '# Diary',
      'personal/.git/diary-hidden.md': '# Diary hidden',
    });
    const l = lib(root);
    const r = await l.search('diary', 'document');
    expect(r.hits.map((h) => [h.item.name, h.scope.id])).toEqual([['diary.md', 'personal']]);
  });

  it('answers from a stale listing and refreshes behind it', async () => {
    const root = brain({ 'clients/acme/one.md': '# One' });
    let t = 0;
    const walks: string[] = [];
    const l = lib(root, { now: () => t, onWalk: (s) => walks.push(s) });
    await l.list('client:acme');
    const acmeWalks = () => walks.filter((w) => w === 'client:acme').length;
    const before = acmeWalks();
    writeFileSync(join(root, 'clients/acme/two.md'), '# Two');
    t = 10 * 60_000;
    const r = await l.search('two', 'document');
    expect(r.total).toBe(0); // stale answer, no waiting
    await new Promise((d) => setTimeout(d, 50));
    expect(acmeWalks()).toBe(before + 1);
    expect((await l.search('two', 'document')).total).toBe(1);
  });

  it('leaves out cold scopes past the budget (partial) and a retry finds them', async () => {
    const root = brain({ 'clients/acme/plan.md': '# Plan', 'clients/northwind/plan.md': '# Plan' });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const l = lib(root, {
      search: { budgetMs: 30, concurrency: 3 },
      afterWalk: (s) => (s === 'client:northwind' ? gate : undefined),
    });
    const first = await l.search('plan', 'document');
    expect(first.partial).toBe(true);
    expect(first.hits.map((h) => h.scope.id)).toEqual(['client:acme']);
    release();
    await new Promise((d) => setTimeout(d, 50));
    const second = await l.search('plan', 'document');
    expect(second.partial).toBe(false);
    expect(second.total).toBe(2);
  });

  it('builds at most the given number of cold scopes at once', async () => {
    const root = brain({
      'clients/a/x.md': '# x',
      'clients/b/x.md': '# x',
      'clients/c/x.md': '# x',
      'clients/d/x.md': '# x',
    });
    let running = 0;
    let peak = 0;
    const l = lib(root, {
      search: { concurrency: 2, budgetMs: 5000 },
      afterWalk: async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((d) => setTimeout(d, 10));
        running--;
      },
    });
    const r = await l.search('x', 'document');
    expect(r.total).toBe(4);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('ranks a title holding every word above a folder-only word', async () => {
    const root = brain({
      'clients/acme/2024/Report.md': { at: 9000, body: '# Report' },
      'clients/acme/misc/MyReport2024.md': { at: 1000, body: '# MyReport2024' },
      'clients/acme/misc/2024 Report summary.md': { at: 500, body: '# 2024 Report summary' },
    });
    const l = lib(root);
    expect(await ids(l, 'report 2024')).toEqual(['2024 Report summary.md', 'MyReport2024.md', 'Report.md']);
  });

  it('refreshes stale scopes a few at a time', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 8; i++) files[`clients/c${i}/x.md`] = '# x';
    const root = brain(files);
    let t = 0;
    let armed = false;
    let running = 0;
    let peak = 0;
    let walked = 0;
    const l = lib(root, {
      now: () => t,
      search: { concurrency: 3, budgetMs: 5000 },
      afterWalk: async () => {
        if (!armed) return;
        walked++;
        running++;
        peak = Math.max(peak, running);
        await new Promise((d) => setTimeout(d, 10));
        running--;
      },
    });
    await l.search('x', 'document');
    armed = true;
    t = 10 * 60_000;
    await l.search('x', 'document');
    await new Promise((d) => setTimeout(d, 200));
    expect(walked).toBe(9);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe('library search: restricted projects (plan 2026-11-27, decision 5)', () => {
  const SECRET = 'clients/acme/projects/secret';
  const hiding =
    (folder: string): (() => Promise<ProjectsIndex>) =>
    async () => ({
      cards: [],
      byKey: () => null,
      keysForPath: () => [],
      resolve: () => ({ how: 'none' }),
      hiddenPath: (rel) => rel.toLowerCase().startsWith(`${folder}/`),
      hiddenKey: () => false,
      hiddenCount: 1,
    });
  const files = {
    [`${SECRET}/launch-plan.md`]: '# Launch plan',
    'clients/acme/projects/web/launch-notes.md': '# Launch notes',
    'clients/acme/reports/launch-report.md': '# Launch report',
    'projects/old-site/launch-old.md': '# Launch old',
  };

  it("never finds a hidden project's files, and doesn't count them", async () => {
    const root = brain(files);
    const found = await lib(root, { projects: hiding(SECRET) }).search('launch', 'document');
    expect(found.hits.map((h) => h.item.name).sort()).toEqual([
      'launch-notes.md',
      'launch-old.md',
      'launch-report.md',
    ]);
    expect(found.total).toBe(3);
  });

  it("finds no project folder's files when the index can't be read", async () => {
    const root = brain(files);
    const l = lib(root, {
      projects: async () => {
        throw new Error('no index');
      },
    });
    expect(await ids(l, 'launch')).toEqual(['launch-report.md']);
  });

  it('finds the same as before when nothing is hidden', async () => {
    const root = brain(files);
    const none = await lib(root).search('launch', 'document');
    const open = await lib(root, { projects: hiding('nowhere') }).search('launch', 'document');
    expect(open.hits.map((h) => h.item.path)).toEqual(none.hits.map((h) => h.item.path));
  });

  describe('call notes filed outside the project folder', () => {
    const notes = {
      'clients/acme/call-notes/2026-11-01-launch-secret.md': '---\nproject: secret\n---\n# Launch secret\n',
      'clients/acme/call-notes/2026-11-02-launch-web.md': '---\nproject: acme/web\n---\n# Launch web\n',
      'clients/acme/call-notes/2026-11-03-launch-plain.md': '# Launch plain\n',
    };
    const index =
      (restricted: boolean): (() => Promise<ProjectsIndex>) =>
      async () => ({
        ...(await hiding(SECRET)()),
        resolve: (value, client) =>
          restricted && (value === 'secret' || value === `${client}/secret`)
            ? { how: 'restricted' }
            : { how: 'none' },
      });

    it("never finds a hidden project's notes for an outsider, and finds them for someone who can see it", async () => {
      const root = brain(notes);
      expect((await ids(lib(root, { projects: index(true) }), 'launch')).sort()).toEqual([
        '2026-11-02-launch-web.md',
        '2026-11-03-launch-plain.md',
      ]);
      expect(await ids(lib(root, { projects: index(false) }), 'launch')).toHaveLength(3);
    });

    it("finds only untagged notes when the index can't be read", async () => {
      const root = brain(notes);
      const l = lib(root, {
        projects: async () => {
          throw new Error('no index');
        },
      });
      expect(await ids(l, 'launch')).toEqual(['2026-11-03-launch-plain.md']);
    });
  });
});
