import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LIBRARY_RECENT_MAX } from '../../shared/contract.ts';
import { listClients } from './clients.ts';
import { createLibrary, type LibraryOptions } from './library.ts';
import type { MyChanges } from './my-changes.ts';
import type { ProjectsIndex } from './projects.ts';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function brain(files: Record<string, number>): string {
  const root = mkdtempSync(join(tmpdir(), 'tba-recent-'));
  temps.push(root);
  mkdirSync(join(root, 'clients'), { recursive: true });
  for (const [rel, at] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, rel.endsWith('.md') ? `# ${rel}` : 'x');
    utimesSync(p, at, at);
  }
  return root;
}

function lib(root: string, over: Partial<LibraryOptions> = {}) {
  return createLibrary(root, { clients: () => listClients(root), ...over });
}

const index =
  (folder: string, key: string): (() => Promise<ProjectsIndex>) =>
  async () =>
    ({
      cards: [],
      byKey: () => null,
      keysForPath: (rel: string) => (rel.startsWith(`${folder}/`) ? [key] : []),
      resolve: () => ({ how: 'none' }),
    }) as unknown as ProjectsIndex;

const names = (r: { files: { item: { name: string } }[] }) => r.files.map((f) => f.item.name);

describe('library recent', () => {
  it('lists the newest first across scopes, of one kind only', async () => {
    const root = brain({
      'clients/acme/old.md': 1000,
      'clients/northwind/new.md': 3000,
      'clients/acme/mid.md': 2000,
      'clients/acme/pic.png': 5000,
    });
    const l = lib(root);
    const docs = await l.recent('document');
    expect(names(docs)).toEqual(['new.md', 'mid.md', 'old.md']);
    expect(docs.partial).toBe(false);
    expect(docs.files[0]?.scope.id).toBe('client:northwind');
    expect(names(await l.recent('image'))).toEqual(['pic.png']);
  });

  it('breaks ties by path', async () => {
    const root = brain({ 'clients/acme/b.md': 1000, 'clients/acme/a.md': 1000 });
    expect(names(await lib(root).recent('document'))).toEqual(['a.md', 'b.md']);
  });

  it('never lists personal files', async () => {
    const root = brain({ 'personal/me/diary.md': 9000, 'clients/acme/plan.md': 1000 });
    expect(names(await lib(root).recent('document'))).toEqual(['plan.md']);
  });

  it('filters by project before the cap, and carries projects', async () => {
    const files: Record<string, number> = {};
    for (let i = 0; i < 25; i++) files[`clients/acme/other/n${i}.md`] = 5000 + i;
    files['clients/acme/web/old.md'] = 100;
    const l = lib(brain(files), { projects: index('clients/acme/web', 'acme/web') });
    const r = await l.recent('document', 'acme/web');
    expect(names(r)).toEqual(['old.md']);
    expect(r.files[0]?.item.projects).toEqual(['acme/web']);
  });

  it('answers no files for a project when there is no project index', async () => {
    const l = lib(brain({ 'clients/acme/a.md': 1000 }));
    expect((await l.recent('document', 'acme/web')).files).toEqual([]);
    expect(names(await l.recent('document'))).toEqual(['a.md']);
  });

  it(`caps at ${LIBRARY_RECENT_MAX}`, async () => {
    const files: Record<string, number> = {};
    for (let i = 0; i < 30; i++) files[`clients/acme/f${i}.md`] = 1000 + i;
    const r = await lib(brain(files)).recent('document');
    expect(r.files).toHaveLength(LIBRARY_RECENT_MAX);
    expect(r.files[0]?.item.name).toBe('f29.md');
  });

  it('leaves out cold scopes past the budget (partial)', async () => {
    const root = brain({ 'clients/acme/a.md': 1000, 'clients/northwind/b.md': 2000 });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const l = lib(root, {
      search: { budgetMs: 30, concurrency: 3 },
      afterWalk: (s) => (s === 'client:northwind' ? gate : undefined),
    });
    const first = await l.recent('document');
    expect(first.partial).toBe(true);
    expect(names(first)).toEqual(['a.md']);
    release();
    await new Promise((d) => setTimeout(d, 50));
    const second = await l.recent('document');
    expect(second.partial).toBe(false);
    expect(names(second)).toEqual(['b.md', 'a.md']);
  });

  it('never builds the personal folder, so a slow one never makes the answer partial', async () => {
    const root = brain({ 'personal/me/diary.md': 9000, 'clients/acme/a.md': 1000 });
    const walked: string[] = [];
    const l = lib(root, {
      search: { budgetMs: 30, concurrency: 3 },
      afterWalk: (s) => {
        walked.push(s);
        return s.startsWith('personal') ? new Promise<void>(() => {}) : undefined;
      },
    });
    const r = await l.recent('document');
    expect(r.partial).toBe(false);
    expect(names(r)).toEqual(['a.md']);
    expect(walked.some((s) => s.startsWith('personal'))).toBe(false);
  });

  describe('mine', () => {
    const mine = (paths: Record<string, string>, readable = true): MyChanges => ({
      paths: new Map(Object.entries(paths)),
      readable,
    });
    const files = {
      'clients/acme/Old.md': 9000,
      'clients/acme/new.md': 1000,
      'clients/acme/theirs.md': 8000,
      'clients/acme/tie-b.md': 5,
      'clients/acme/tie-a.md': 5,
      'personal/me/diary.md': 7000,
      'clients/acme/web/x.md': 5,
    };

    it('keeps only my files, newest change of mine first, ties by path', async () => {
      const l = lib(brain(files));
      const r = await l.recent(
        'document',
        undefined,
        mine({
          'clients/acme/old.md': '2026-01-01T00:00:00Z',
          'clients/acme/new.md': '2026-02-01T00:00:00Z',
          'clients/acme/tie-b.md': '2026-01-15T00:00:00Z',
          'clients/acme/tie-a.md': '2026-01-15T00:00:00Z',
          'personal/me/diary.md': '2026-03-01T00:00:00Z',
        }),
      );
      expect(names(r)).toEqual(['new.md', 'tie-a.md', 'tie-b.md', 'Old.md']);
    });

    it('applies the project filter before the cap', async () => {
      const l = lib(brain(files), { projects: index('clients/acme/web', 'acme/web') });
      const r = await l.recent(
        'document',
        'acme/web',
        mine({
          'clients/acme/web/x.md': '2026-01-01T00:00:00Z',
          'clients/acme/new.md': '2026-02-01T00:00:00Z',
        }),
      );
      expect(names(r)).toEqual(['x.md']);
    });

    it('answers partial, never the team’s files, when the history is unreadable', async () => {
      const l = lib(brain(files));
      expect(await l.recent('document', undefined, mine({}, false))).toEqual({ files: [], partial: true });
    });

    it('is unchanged without it', async () => {
      const l = lib(brain(files));
      expect(names(await l.recent('document'))[0]).toBe('Old.md');
    });
  });

  it('never throws', async () => {
    const l = lib(brain({}), {
      clients: async () => {
        throw new Error('boom');
      },
    });
    expect(await l.recent('document')).toEqual({ files: [], partial: false });
  });
});

describe('library recent: restricted projects (plan 2026-11-27, decision 5)', () => {
  const SECRET = 'clients/acme/projects/secret';
  const hiding: () => Promise<ProjectsIndex> = async () => ({
    cards: [],
    byKey: () => null,
    // A stand-in that still names the hidden key: the library must drop it from the stamp.
    keysForPath: (rel: string) =>
      rel.startsWith(`${SECRET}/`) || rel === 'clients/acme/reports/linked.md' ? ['acme/secret'] : [],
    resolve: () => ({ how: 'none' }),
    hiddenPath: (rel) => rel.startsWith(`${SECRET}/`),
    hiddenKey: (key) => key === 'acme/secret',
    hiddenCount: 1,
  });

  it("leaves out a hidden project's files, and a linked file elsewhere stays without its stamp", async () => {
    const root = brain({
      [`${SECRET}/plan.md`]: 3_000,
      'clients/acme/reports/linked.md': 2_000,
      'clients/acme/reports/other.md': 1_000,
    });
    const l = lib(root, { projects: hiding });
    const recent = await l.recent('document');
    expect(names(recent)).toEqual(['linked.md', 'other.md']);
    expect(recent.files[0]?.item.projects).toEqual([]);
    // A project filter for the hidden key finds nothing.
    expect(names(await l.recent('document', 'acme/secret'))).toEqual([]);
  });

  it("leaves out every project folder's files when the index can't be read", async () => {
    const root = brain({ [`${SECRET}/plan.md`]: 3_000, 'clients/acme/reports/other.md': 1_000 });
    const l = lib(root, {
      projects: async () => {
        throw new Error('no index');
      },
    });
    expect(names(await l.recent('document'))).toEqual(['other.md']);
  });

  describe('call notes filed outside the project folder', () => {
    const SECRET_NOTE = 'clients/acme/call-notes/2026-11-01-secret.md';
    const WEB_NOTE = 'clients/acme/call-notes/2026-11-02-web.md';
    const PLAIN_NOTE = 'clients/acme/call-notes/2026-11-03-plain.md';
    function notesBrain(): string {
      const root = brain({ [SECRET_NOTE]: 3_000, [WEB_NOTE]: 2_000, [PLAIN_NOTE]: 1_000 });
      const tag = (rel: string, project: string | null, at: number) => {
        const p = join(root, rel);
        writeFileSync(p, `---\n${project ? `project: ${project}\n` : ''}---\n# ${rel}\n`);
        utimesSync(p, at, at);
      };
      tag(SECRET_NOTE, 'secret', 3_000);
      tag(WEB_NOTE, 'acme/web', 2_000);
      tag(PLAIN_NOTE, null, 1_000);
      return root;
    }
    const restricting =
      (restricted: boolean): (() => Promise<ProjectsIndex>) =>
      async () => ({
        ...(await hiding()),
        resolve: (value: string | null) =>
          restricted && value === 'secret' ? { how: 'restricted' as const } : { how: 'none' as const },
      });

    it("leaves out a hidden project's notes for an outsider, and keeps them for someone who can see it", async () => {
      const root = notesBrain();
      expect(names(await lib(root, { projects: restricting(true) }).recent('document'))).toEqual([
        '2026-11-02-web.md',
        '2026-11-03-plain.md',
      ]);
      expect(names(await lib(root, { projects: restricting(false) }).recent('document'))).toEqual([
        '2026-11-01-secret.md',
        '2026-11-02-web.md',
        '2026-11-03-plain.md',
      ]);
    });

    it("keeps only untagged notes when the index can't be read", async () => {
      const l = lib(notesBrain(), {
        projects: async () => {
          throw new Error('no index');
        },
      });
      expect(names(await l.recent('document'))).toEqual(['2026-11-03-plain.md']);
    });
  });
});
