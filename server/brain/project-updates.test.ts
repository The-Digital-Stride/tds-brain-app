import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Identity } from '../../shared/contract.ts';
import { PROJECTS_UPDATES_CAPABILITY, UPDATES_PAGE } from '../../shared/project-updates-contract.ts';
import { PROJECTS_CAPABILITY, type ProjectCard, ProjectsError } from '../../shared/projects-contract.ts';
import { createProjectUpdates } from './project-updates.ts';
import type { ProjectsIndex } from './projects.ts';
import type { ProjectsSkillRunner } from './projects-skill.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tds-updates-'));
  put('.team-config/roles.json', JSON.stringify({ members: [{ name: 'Sam Example', email: 's@x.test' }] }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function put(rel: string, text: string) {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const KEY = 'acme/web';
const FOLDER = 'clients/acme/projects/web';
const me = (role: Identity['role'] = 'team', slug = 'sam-example'): Identity => ({
  name: 'Sam Example',
  slug,
  email: null,
  role,
  knownMember: true,
});

function entry(
  at: string,
  by = 'sam-example',
  kind = 'note',
  summary = 'Hello',
  extra = '',
  clientSafe = false,
): string {
  return `---\nv: 1\nkind: ${kind}\nby: ${by}\nat: ${at}\nclient_safe: ${clientSafe}\n${extra}---\n${summary}\n`;
}
const file = (folder: string, at: string, rand = 'abc123', by = 'sam-example') =>
  `${folder}/updates/${at.slice(0, 10)}-${at.slice(11, 13)}${at.slice(14, 16)}-${by}-${rand}.md`;

function card(over: Partial<ProjectCard> = {}): ProjectCard {
  return {
    key: KEY,
    space: 'client',
    slug: 'web',
    client: 'acme',
    folder: FOLDER,
    card: 'ok',
    archived: false,
    ...over,
  } as ProjectCard;
}
function indexOf(...cards: ProjectCard[]): ProjectsIndex {
  return {
    cards,
    byKey: (k) => cards.find((c) => c.key === k) ?? null,
    keysForPath: () => [],
    resolve: () => ({}) as never,
  };
}
function setup(
  opts: { cards?: ProjectCard[]; caps?: string[]; may?: boolean; run?: ProjectsSkillRunner['run'] } = {},
) {
  const runs: unknown[] = [];
  const skill: ProjectsSkillRunner = {
    run:
      opts.run ??
      (async (a) => {
        runs.push(a);
        return { key: KEY, version: 'f'.repeat(64) };
      }),
    capabilities: async () => opts.caps ?? [PROJECTS_CAPABILITY, PROJECTS_UPDATES_CAPABILITY],
  };
  const svc = createProjectUpdates(root, {
    index: async () => indexOf(...(opts.cards ?? [card()])),
    skill,
    mayChange: async () => opts.may ?? true,
  });
  return { svc, runs };
}
const add = (at: string, text = entry(at), folder = FOLDER, rand = 'abc123') =>
  put(file(folder, at, rand), text);

describe('reading the log', () => {
  it('lists newest first, ties by file name descending, with the file hash as version', async () => {
    const t = '2026-11-20T10:00:00Z';
    const text = entry(t);
    add(t, text, FOLDER, 'aaaaaa');
    add(t, text, FOLDER, 'bbbbbb');
    add('2026-11-21T09:00:00Z');
    add('2026-11-19T09:00:00Z');
    const r = await setup().svc.read(KEY, null, me());
    expect(r.updates.map((u) => u.path.split('/').pop())).toEqual([
      '2026-11-21-0900-sam-example-abc123.md',
      '2026-11-20-1000-sam-example-bbbbbb.md',
      '2026-11-20-1000-sam-example-aaaaaa.md',
      '2026-11-19-0900-sam-example-abc123.md',
    ]);
    expect(r.updates[1]?.version).toBe(sha(text));
    expect(r).toMatchObject({ more: false, unreadable: 0 });
    expect(r.updates[0]).toMatchObject({
      v: 1,
      kind: 'note',
      by: 'sam-example',
      byName: 'Sam Example',
      clientSafe: false,
      summary: 'Hello',
    });
  });

  it('pages with before, and refuses a before that is not listed', async () => {
    for (let i = 0; i < UPDATES_PAGE + 2; i++) {
      const at = `2026-11-20T10:${String(i).padStart(2, '0')}:00Z`;
      add(at, entry(at), FOLDER, `r${String(i).padStart(5, '0')}`);
    }
    const { svc } = setup();
    const first = await svc.read(KEY, null, me());
    expect(first.updates).toHaveLength(UPDATES_PAGE);
    expect(first.more).toBe(true);
    const last = first.updates.at(-1)?.path as string;
    const second = await svc.read(KEY, last, me());
    expect(second.updates).toHaveLength(2);
    expect(second.more).toBe(false);
    await expect(svc.read(KEY, `${FOLDER}/updates/nope.md`, me())).rejects.toMatchObject({
      code: 'bad-request',
    });
    await expect(svc.read(KEY, 'x', me())).rejects.toBeInstanceOf(ProjectsError);
  });

  it('counts unreadable files, keeps unknown kinds as text, keeps change/from/to', async () => {
    add('2026-11-20T10:00:00Z', 'no frontmatter at all');
    add('2026-11-20T10:01:00Z', entry('not-a-date'), FOLDER, 'bad111');
    add('2026-11-20T10:02:00Z', '<<<<<<< HEAD\n---\nv: 1\n---\n', FOLDER, 'bad222');
    add('2026-11-20T10:03:00Z', entry('2026-11-20T10:03:00Z', 'sam-example', 'hologram'), FOLDER, 'ok1111');
    add(
      '2026-11-20T10:04:00Z',
      entry(
        '2026-11-20T10:04:00Z',
        'sam-example',
        'status',
        'Status: Planned → Active.',
        'change: status\nfrom: planned\nto: active\n',
      ),
      FOLDER,
      'ok2222',
    );
    put(`${FOLDER}/updates/readme.txt`, 'ignored');
    const r = await setup().svc.read(KEY, null, me());
    expect(r.unreadable).toBe(3);
    expect(r.updates.map((u) => u.kind)).toEqual(['status', 'hologram']);
    expect(r.updates[0]).toMatchObject({ change: 'status', from: 'planned', to: 'active' });
  });

  it('falls back to by when the roster does not know the person', async () => {
    add('2026-11-20T10:00:00Z', entry('2026-11-20T10:00:00Z', 'zed-unknown'));
    expect((await setup().svc.read(KEY, null, me())).updates[0]?.byName).toBe('zed-unknown');
  });

  it('ignores an updates folder that is a link', async () => {
    mkdirSync(join(root, 'elsewhere'), { recursive: true });
    put('elsewhere/2026-11-20-1000-sam-example-abc123.md', entry('2026-11-20T10:00:00Z'));
    mkdirSync(join(root, ...FOLDER.split('/')), { recursive: true });
    symlinkSync(join(root, 'elsewhere'), join(root, ...FOLDER.split('/'), 'updates'));
    const r = await setup().svc.read(KEY, null, me());
    expect(r.updates).toEqual([]);
  });

  it('answers not-found for an unknown project', async () => {
    await expect(setup().svc.read('acme/none', null, me())).rejects.toMatchObject({ code: 'not-found' });
  });

  it('lists an archived project read-only', async () => {
    const folder = 'clients/acme/projects-archive/web';
    add('2026-11-20T10:00:00Z', entry('2026-11-20T10:00:00Z'), folder);
    const r = await setup({ cards: [card({ folder, archived: true })] }).svc.read(KEY, null, me('owner'));
    expect(r.updates).toHaveLength(1);
    expect(r.canAdd).toBe(false);
    expect(r.updates[0]?.canRemove).toBe(false);
  });

  it('reads old folders (moved_from and a leftover at the key) read-only and marked', async () => {
    const moved = card({
      key: 'new/web',
      client: 'new',
      folder: 'clients/new/projects/web',
      movedFrom: [KEY],
    });
    add('2026-11-20T10:00:00Z', entry('2026-11-20T10:00:00Z'), 'clients/acme/projects/web', 'old111');
    add('2026-11-21T10:00:00Z', entry('2026-11-21T10:00:00Z'), 'clients/new/projects/web', 'new111');
    add('2026-11-22T10:00:00Z', entry('2026-11-22T10:00:00Z'), 'clients/new/projects-archive/web', 'lft111');
    // A folder that still has a card is another project's, never an old folder.
    put('clients/other/projects/web/project.md', '---\ntitle: x\n---\n');
    add('2026-11-23T10:00:00Z', entry('2026-11-23T10:00:00Z'), 'clients/other/projects/web', 'oth111');
    const r = await setup({ cards: [moved] }).svc.read('new/web', null, me('owner'));
    expect(r.updates.map((u) => [u.path.split('/').pop(), u.fromOldFolder, u.canRemove])).toEqual([
      ['2026-11-22-1000-sam-example-lft111.md', true, false],
      ['2026-11-21-1000-sam-example-new111.md', undefined, true],
      ['2026-11-20-1000-sam-example-old111.md', true, false],
    ]);
  });

  it('skips an old folder that holds a project card', async () => {
    const moved = card({
      key: 'new/web',
      client: 'new',
      folder: 'clients/new/projects/web',
      movedFrom: [KEY],
    });
    put('clients/acme/projects/web/project.md', '---\ntitle: x\n---\n');
    add('2026-11-20T10:00:00Z', entry('2026-11-20T10:00:00Z'), 'clients/acme/projects/web');
    expect((await setup({ cards: [moved] }).svc.read('new/web', null, me())).updates).toEqual([]);
  });
});

describe('canAdd and canRemove', () => {
  const t = (n: number) => `2026-11-2${n}T10:00:00Z`;
  function seed() {
    add(t(1), entry(t(1), 'sam-example'), FOLDER, 'mine11');
    add(t(2), entry(t(2), 'ben-mcadam'), FOLDER, 'ben222');
    add(t(3), entry(t(3), 'sam-example', 'status', 'Status: a → b.'), FOLDER, 'aut333');
    add(t(4), entry(t(4), 'sam-example', 'email', 'x'), FOLDER, 'eml444');
  }
  const removable = async (s: ReturnType<typeof setup>, who: Identity) =>
    Object.fromEntries(
      (await s.svc.read(KEY, null, who)).updates.map((u) => [
        u.path.split('-').pop()?.slice(0, 6),
        u.canRemove,
      ]),
    );

  it('an author may remove their own note or call only; auto and later kinds never', async () => {
    seed();
    expect(await removable(setup(), me())).toEqual({
      mine11: true,
      ben222: false,
      aut333: false,
      eml444: false,
    });
  });

  it('the Owner and a scout may remove anyone note or call', async () => {
    seed();
    for (const role of ['owner', 'scout'] as const) {
      expect(await removable(setup(), me(role, 'someone-else'))).toEqual({
        mine11: true,
        ben222: true,
        aut333: false,
        eml444: false,
      });
    }
  });

  it('a personal project counts "me" as the author', async () => {
    const folder = 'personal/projects/plan';
    add(t(1), entry(t(1), 'me'), folder, 'me1111');
    const s = setup({ cards: [card({ key: 'personal/plan', space: 'personal', client: null, folder })] });
    expect((await s.svc.read('personal/plan', null, me())).updates[0]?.canRemove).toBe(true);
  });

  it('needs the capability and the right to change projects', async () => {
    seed();
    const noCap = await setup({ caps: [PROJECTS_CAPABILITY] }).svc.read(KEY, null, me('owner'));
    expect(noCap.canAdd).toBe(false);
    expect(noCap.updates.some((u) => u.canRemove)).toBe(false);
    const noRole = await setup({ may: false }).svc.read(KEY, null, me('owner'));
    expect(noRole.canAdd).toBe(false);
    expect(noRole.updates.some((u) => u.canRemove)).toBe(false);
    expect((await setup().svc.read(KEY, null, me())).canAdd).toBe(true);
  });

  it('canAdd is false for a project with no readable card', async () => {
    const r = await setup({ cards: [card({ card: 'none' })] }).svc.read(KEY, null, me());
    expect(r.canAdd).toBe(false);
  });
});

describe('changing the log', () => {
  const entryAction = { kind: 'note', summary: 'Hi', clientSafe: false } as const;

  it('runs update and update-remove through the script and returns its answer', async () => {
    const ran: unknown[] = [];
    const { svc } = setup({
      run: async (a) => {
        ran.push(a);
        return a.kind === 'update'
          ? { key: KEY, version: 'f'.repeat(64), file: `${FOLDER}/updates/x.md` }
          : { key: KEY, version: 'f'.repeat(64) };
      },
    });
    const a = { kind: 'update', key: KEY, entry: entryAction } as const;
    expect(await svc.change(a, me())).toEqual({ file: `${FOLDER}/updates/x.md` });
    const rm = {
      kind: 'update-remove',
      key: KEY,
      file: `${FOLDER}/updates/x.md`,
      expect: 'a'.repeat(64),
    } as const;
    expect(await svc.change(rm, me())).toEqual({});
    expect(ran).toEqual([a, rm]);
  });

  it('refuses an archived project, a card-less folder, an old script and a person who may not', async () => {
    const a = { kind: 'update', key: KEY, entry: entryAction } as const;
    const cases: [ReturnType<typeof setup>, string][] = [
      [setup({ cards: [card({ archived: true })] }), 'not-allowed'],
      [setup({ cards: [card({ card: 'none' })] }), 'not-allowed'],
      [setup({ cards: [] }), 'not-found'],
      [setup({ caps: [PROJECTS_CAPABILITY] }), 'not-allowed'],
      [setup({ may: false }), 'not-allowed'],
    ];
    for (const [s, code] of cases) {
      await expect(s.svc.change(a, me())).rejects.toMatchObject({ code });
      expect(s.runs).toEqual([]);
    }
  });

  it('refuses removing a file outside this project updates folder', async () => {
    const s = setup();
    for (const file of [
      `${FOLDER}/updates/../project.md`,
      'clients/other/projects/x/updates/a.md',
      `${FOLDER}/a.md`,
    ]) {
      await expect(
        s.svc.change({ kind: 'update-remove', key: KEY, file, expect: 'a'.repeat(64) }, me()),
      ).rejects.toMatchObject({ code: 'bad-request' });
    }
    expect(s.runs).toEqual([]);
  });
});
