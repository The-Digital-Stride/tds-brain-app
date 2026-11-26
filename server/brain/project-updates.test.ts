import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROJECTS_CHAT_SUMMARY_CAPABILITY } from '../../shared/chat-summary-contract.ts';
import type { Identity } from '../../shared/contract.ts';
import { PROJECTS_EMAIL_CAPABILITY } from '../../shared/project-email-contract.ts';
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
  opts: {
    cards?: ProjectCard[];
    caps?: string[];
    may?: boolean;
    run?: ProjectsSkillRunner['run'];
    holds?: (id: string) => boolean | Promise<boolean>;
  } = {},
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
    ...(opts.holds ? { holdsChat: opts.holds } : {}),
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

  it('nothing is removable while the card is missing or unreadable (the script would refuse)', async () => {
    seed();
    for (const state of ['none', 'unreadable'] as const) {
      const r = await setup({ cards: [card({ card: state })] }).svc.read(KEY, null, me('owner'));
      expect(r.canAdd).toBe(false);
      expect(r.updates.some((u) => u.canRemove)).toBe(false);
    }
  });

  it('a hand-made entry whose name the script would refuse is listed but not removable', async () => {
    put(`${FOLDER}/updates/call-with-alex.md`, entry(t(5), 'sam-example', 'call', 'Hand made'));
    const r = await setup().svc.read(KEY, null, me());
    const hand = r.updates.find((u) => u.path.endsWith('call-with-alex.md'));
    expect(hand?.summary).toBe('Hand made');
    expect(hand?.canRemove).toBe(false);
  });
});

describe('names and freshness', () => {
  it('names a person whose slug the script wrote differently from the task slug', async () => {
    put(
      '.team-config/roles.json',
      JSON.stringify({ members: [{ name: "Mary O'Brien", email: 'm@x.test' }] }),
    );
    add('2026-11-21T10:00:00Z', entry('2026-11-21T10:00:00Z', 'mary-obrien'), FOLDER, 'mob111');
    const r = await setup().svc.read(KEY, null, me());
    expect(r.updates[0]?.byName).toBe("Mary O'Brien");
  });

  it('sees an entry edited in place, so its version matches the file', async () => {
    const at = '2026-11-21T10:00:00Z';
    add(at, entry(at, 'sam-example', 'note', 'First words'));
    const s = setup();
    expect((await s.svc.read(KEY, null, me())).updates[0]?.summary).toBe('First words');
    add(at, entry(at, 'sam-example', 'note', 'Second, longer words'));
    expect((await s.svc.read(KEY, null, me())).updates[0]?.summary).toBe('Second, longer words');
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
          ? {
              key: KEY,
              version: 'f'.repeat(64),
              file: `${FOLDER}/updates/2026-11-21-1000-sam-example-abc123.md`,
            }
          : { key: KEY, version: 'f'.repeat(64) };
      },
    });
    const a = { kind: 'update', key: KEY, entry: entryAction } as const;
    expect(await svc.change(a, me())).toEqual({
      file: `${FOLDER}/updates/2026-11-21-1000-sam-example-abc123.md`,
    });
    const rm = {
      kind: 'update-remove',
      key: KEY,
      file: `${FOLDER}/updates/2026-11-21-1000-sam-example-abc123.md`,
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

  it('refuses removing from a card-less folder or a name the script would refuse', async () => {
    const rm = (file: string) => ({ kind: 'update-remove', key: KEY, file, expect: 'a'.repeat(64) }) as const;
    const ok = `${FOLDER}/updates/2026-11-21-1000-sam-example-abc123.md`;
    const noCard = setup({ cards: [card({ card: 'unreadable' })] });
    await expect(noCard.svc.change(rm(ok), me())).rejects.toMatchObject({ code: 'not-allowed' });
    const s = setup();
    await expect(s.svc.change(rm(`${FOLDER}/updates/call-with-alex.md`), me())).rejects.toMatchObject({
      code: 'bad-request',
    });
    expect([...noCard.runs, ...s.runs]).toEqual([]);
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

describe('email entries (phase 5)', () => {
  const EMAIL_CAPS = [PROJECTS_CAPABILITY, PROJECTS_UPDATES_CAPABILITY, PROJECTS_EMAIL_CAPABILITY];
  const emailEntry = (at: string, by: string, key: string, owner = 'sam-example') =>
    entry(
      at,
      by,
      'email',
      'They agreed.',
      `email_subject: Quote\nemail_from: Alex Smith\nemail_people: Jo\nemail_sent_at: ${at}\nemail_thread_id: 1a2b3c4d5e6f\nemail_key: ${key}\nemail_inbox_owner: ${owner}\n`,
    );

  it('reads email_key, and collapses the same key within a project to the earliest', async () => {
    add('2026-11-21T10:00:00Z', emailEntry('2026-11-21T10:00:00Z', 'ben-mcadam', '<k1@x>'), FOLDER, 'late11');
    add(
      '2026-11-20T10:00:00Z',
      emailEntry('2026-11-20T10:00:00Z', 'sam-example', '<k1@x>'),
      FOLDER,
      'early1',
    );
    add(
      '2026-11-22T10:00:00Z',
      emailEntry('2026-11-22T10:00:00Z', 'sam-example', '<k2@x>'),
      FOLDER,
      'other1',
    );
    // An old file with only email_message_id collapses with the new key's twin.
    add(
      '2026-11-23T10:00:00Z',
      entry('2026-11-23T10:00:00Z', 'sam-example', 'email', 'x', 'email_message_id: <k2@x>\n'),
      FOLDER,
      'oldfmt',
    );
    const r = await setup({ caps: EMAIL_CAPS }).svc.read(KEY, null, me());
    expect(r.updates.map((u) => u.path.split('-').pop()?.slice(0, 6))).toEqual(['other1', 'early1']);
    expect(r.updates[1]?.emailKey).toBe('<k1@x>');
  });

  it('does not collapse the same key in two different projects', async () => {
    add('2026-11-20T10:00:00Z', emailEntry('2026-11-20T10:00:00Z', 'sam-example', '<k1@x>'));
    put(
      file('clients/acme/projects/seo', '2026-11-21T10:00:00Z'),
      emailEntry('2026-11-21T10:00:00Z', 'sam-example', '<k1@x>'),
    );
    const cards = [card(), card({ key: 'acme/seo', slug: 'seo', folder: 'clients/acme/projects/seo' })];
    const s = setup({ cards, caps: EMAIL_CAPS });
    expect((await s.svc.read(KEY, null, me())).updates).toHaveLength(1);
    expect((await s.svc.read('acme/seo', null, me())).updates).toHaveLength(1);
  });

  it('gives Open in Gmail only to the inbox owner, from their roles.json email', async () => {
    add('2026-11-20T10:00:00Z', emailEntry('2026-11-20T10:00:00Z', 'sam-example', '<k1@x>'));
    const s = setup({ caps: EMAIL_CAPS });
    const mine = (await s.svc.read(KEY, null, me())).updates[0];
    expect(mine?.gmailUrl).toBe(
      `https://mail.google.com/mail/?authuser=${encodeURIComponent('s@x.test')}#all/thread-f:${BigInt('0x1a2b3c4d5e6f').toString(10)}`,
    );
    const ben = { ...me('team', 'ben-mcadam'), name: 'Ben McAdam' };
    const theirs = (await s.svc.read(KEY, null, ben)).updates[0];
    expect(theirs?.gmailUrl).toBeUndefined();
  });

  it('a bad thread id gives no link', async () => {
    add(
      '2026-11-20T10:00:00Z',
      emailEntry('2026-11-20T10:00:00Z', 'sam-example', '<k1@x>').replace('1a2b3c4d5e6f', 'not hex!'),
    );
    expect(
      (await setup({ caps: EMAIL_CAPS }).svc.read(KEY, null, me())).updates[0]?.gmailUrl,
    ).toBeUndefined();
  });

  it('canRemove: inbox owner, Owner or scout, with the email capability', async () => {
    add('2026-11-20T10:00:00Z', emailEntry('2026-11-20T10:00:00Z', 'ben-mcadam', '<k1@x>', 'sam-example'));
    const can = async (who: Identity, caps = EMAIL_CAPS) =>
      (await setup({ caps }).svc.read(KEY, null, who)).updates[0]?.canRemove;
    expect(await can(me())).toBe(true); // the inbox owner, though Ben saved it
    expect(await can({ ...me('owner', 'zed'), name: 'Zed' })).toBe(true);
    expect(await can({ ...me('scout', 'zed'), name: 'Zed' })).toBe(true);
    expect(await can({ ...me('team', 'ben-mcadam'), name: 'Ben McAdam' })).toBe(false);
    expect(await can(me(), [PROJECTS_CAPABILITY, PROJECTS_UPDATES_CAPABILITY])).toBe(false);
  });
});

describe('email conversations (project email threads)', () => {
  const EMAIL_CAPS = [PROJECTS_CAPABILITY, PROJECTS_UPDATES_CAPABILITY, PROJECTS_EMAIL_CAPABILITY];
  /** An email entry saved at `at` (file name `rand`), sent at `sent`, with optional join fields. */
  const mail = (
    at: string,
    rand: string,
    f: { key: string; keys?: string[]; link?: string; owner?: string; thread?: string; sent?: string },
  ) =>
    add(
      at,
      entry(
        at,
        'sam-example',
        'email',
        'x',
        `email_sent_at: ${f.sent ?? at}\nemail_key: ${f.key}\n${
          f.keys ? `email_thread_keys:\n${f.keys.map((k) => `  - ${k}\n`).join('')}` : ''
        }${f.link ? `email_thread_link: ${f.link}\n` : ''}${
          f.thread ? `email_thread_id: ${f.thread}\nemail_inbox_owner: ${f.owner ?? 'sam-example'}\n` : ''
        }`,
      ),
      FOLDER,
      rand,
    );
  const read = async (before: string | null = null) =>
    (await setup({ caps: EMAIL_CAPS }).svc.read(KEY, before, me())).updates;
  const rand = (path: string) => path.split('-').pop()?.slice(0, 6);

  it('entries sharing a key in email_thread_keys are one conversation named for the earliest', async () => {
    mail('2026-11-20T10:00:00Z', 'aaa111', { key: 'x:1', keys: ['x:2'] });
    mail('2026-11-22T10:00:00Z', 'bbb222', { key: 'x:2' });
    const u = await read();
    expect(u).toHaveLength(2);
    const name = (u[1] as { path: string }).path.split('/').pop();
    expect(u.map((x) => x.emailThread)).toEqual([name, name]);
  });

  it('entries sharing a thread link are one conversation', async () => {
    mail('2026-11-20T10:00:00Z', 'aaa111', { key: 'x:1' });
    mail('2026-11-22T10:00:00Z', 'bbb222', { key: 'x:9', link: 'x:1' });
    const u = await read();
    expect(u[0]?.emailThread).toBeDefined();
    expect(u[0]?.emailThread).toBe(u[1]?.emailThread);
  });

  it('the same owner and Gmail thread id are one conversation; another owner is not', async () => {
    mail('2026-11-20T10:00:00Z', 'aaa111', { key: 'x:1', thread: 'abc123', owner: 'sam-example' });
    mail('2026-11-21T10:00:00Z', 'bbb222', { key: 'x:2', thread: 'abc123', owner: 'sam-example' });
    mail('2026-11-22T10:00:00Z', 'ccc333', { key: 'x:3', thread: 'abc123', owner: 'ben-mcadam' });
    const u = await read();
    const by = (r: string) => u.find((x) => rand(x.path) === r)?.emailThread;
    expect(by('aaa111')).toBeDefined();
    expect(by('aaa111')).toBe(by('bbb222'));
    expect(by('ccc333')).toBeUndefined();
  });

  it('joins transitively: A and B share a key, B and C share a link', async () => {
    mail('2026-11-20T10:00:00Z', 'aaa111', { key: 'x:a', keys: ['x:b'] });
    mail('2026-11-21T10:00:00Z', 'bbb222', { key: 'x:b', link: 'x:c' });
    mail('2026-11-22T10:00:00Z', 'ccc333', { key: 'x:c2', link: 'x:c' });
    const u = await read();
    expect(new Set(u.map((x) => x.emailThread)).size).toBe(1);
    expect(u[0]?.emailThread).toBe((u.find((x) => rand(x.path) === 'aaa111')?.path ?? '').split('/').pop());
  });

  it('unrelated entries, notes and old entries get no emailThread', async () => {
    mail('2026-11-20T10:00:00Z', 'aaa111', { key: 'x:1', thread: 'abc123' });
    mail('2026-11-21T10:00:00Z', 'bbb222', { key: 'x:2', thread: 'def456' });
    add('2026-11-22T10:00:00Z');
    const u = await read();
    expect(u).toHaveLength(3);
    expect(u.every((x) => x.emailThread === undefined)).toBe(true);
  });

  it('places a conversation at its newest-saved part, ordered inside by email_sent_at', async () => {
    mail('2026-11-20T10:00:00Z', 'aaa111', {
      key: 'x:1',
      keys: ['x:2', 'x:3'],
      sent: '2026-11-19T09:00:00Z',
    });
    add('2026-11-21T10:00:00Z', entry('2026-11-21T10:00:00Z'), FOLDER, 'note11');
    // Saved later but its message was sent in the middle of the thread.
    mail('2026-11-23T10:00:00Z', 'bbb222', { key: 'x:2', sent: '2026-11-19T12:00:00Z' });
    add('2026-11-22T10:00:00Z', entry('2026-11-22T10:00:00Z'), FOLDER, 'note22');
    mail('2026-11-22T11:00:00Z', 'ccc333', { key: 'x:3', sent: '2026-11-19T15:00:00Z' });
    const u = await read();
    // newest-saved part is bbb222 (23 Nov): the conversation sits first; the notes follow in their order.
    expect(u.map((x) => rand(x.path))).toEqual(['ccc333', 'bbb222', 'aaa111', 'note22', 'note11']);
  });

  it('never splits a conversation across a page edge', async () => {
    const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}T10:00:00Z`;
    // 48 notes newer than a three-part conversation whose parts straddle position 50.
    for (let i = 0; i < 48; i++) {
      const at = `2026-11-${String(1 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:30:00Z`;
      add(at, entry(at), FOLDER, `n${String(i).padStart(5, '0')}`);
    }
    mail(day(1), 'aaa111', { key: 'x:1', keys: ['x:2', 'x:3'], sent: day(1) });
    mail(day(2), 'bbb222', { key: 'x:2', sent: day(2) });
    mail(day(3), 'ccc333', { key: 'x:3', sent: day(3) });
    add('2026-09-01T10:00:00Z', entry('2026-09-01T10:00:00Z'), FOLDER, 'last11');
    const svc = setup({ caps: EMAIL_CAPS }).svc;
    const first = await svc.read(KEY, null, me());
    // 48 notes + the 3 parts sit at 49..51: the page ends after the whole conversation.
    expect(first.updates).toHaveLength(51);
    expect(first.more).toBe(true);
    const next = await svc.read(KEY, first.updates[50]?.path ?? null, me());
    expect(next.updates.map((x) => rand(x.path))).toEqual(['last11']);
    expect(next.more).toBe(false);
  });
});

describe('chat entries', () => {
  const CHAT = '0b8f6c52-1a2b-4c3d-8e9f-0123456789ab';
  const OTHER = '11111111-2222-4333-8444-555555555555';
  const CAPS = [PROJECTS_CAPABILITY, PROJECTS_UPDATES_CAPABILITY, PROJECTS_CHAT_SUMMARY_CAPABILITY];
  const chatEntry = (at: string, by = 'sam-example', chat = CHAT, title = 'Fix: "checkout"') =>
    entry(at, by, 'chat', '**Objective:** x', `chat: ${chat}\nchat_title: '${title}'\n`);

  it('reads chat and chat_title, ignoring an id that is not a session id', async () => {
    add('2026-11-20T10:00:00Z', chatEntry('2026-11-20T10:00:00Z'));
    add('2026-11-21T10:00:00Z', chatEntry('2026-11-21T10:00:00Z', 'sam-example', 'not-an-id'));
    add('2026-11-19T10:00:00Z', entry('2026-11-19T10:00:00Z'));
    const r = await setup({ caps: CAPS }).svc.read(KEY, null, me());
    expect(r.updates[1]).toMatchObject({ kind: 'chat', chatId: CHAT, chatTitle: 'Fix: "checkout"' });
    expect(r.updates[0]?.chatId).toBeUndefined();
    expect(r.updates[2]?.chatId).toBeUndefined();
    expect(r.updates[2]?.chatTitle).toBeUndefined();
  });

  it('marks chatOpenable only when this Mac holds the chat', async () => {
    add('2026-11-20T10:00:00Z', chatEntry('2026-11-20T10:00:00Z', 'sam-example', CHAT), FOLDER, 'aaaaaa');
    add('2026-11-21T10:00:00Z', chatEntry('2026-11-21T10:00:00Z', 'sam-example', OTHER), FOLDER, 'bbbbbb');
    const held = await setup({ caps: CAPS, holds: async (id) => id === CHAT }).svc.read(KEY, null, me());
    expect(held.updates.map((u) => u.chatOpenable)).toEqual([undefined, true]);
    const none = await setup({ caps: CAPS }).svc.read(KEY, null, me());
    expect(none.updates.some((u) => u.chatOpenable)).toBe(false);
    const throws = await setup({
      caps: CAPS,
      holds: () => {
        throw new Error('x');
      },
    }).svc.read(KEY, null, me());
    expect(throws.updates.some((u) => u.chatOpenable)).toBe(false);
  });

  it('canRemove for a chat entry needs the chat capability', async () => {
    add('2026-11-20T10:00:00Z', chatEntry('2026-11-20T10:00:00Z'));
    expect((await setup({ caps: CAPS }).svc.read(KEY, null, me())).updates[0]?.canRemove).toBe(true);
    const old = await setup().svc.read(KEY, null, me());
    expect(old.updates[0]?.canRemove).toBe(false);
  });

  it('refuses a chat entry without the capability or with a bad shape, and passes a good one', async () => {
    const good = {
      kind: 'chat' as const,
      summary: '**Objective:** x',
      clientSafe: false,
      chat: CHAT,
      title: 'T',
    };
    const act = (entry: object) => ({ kind: 'update' as const, key: KEY, entry }) as never;
    const s = setup({ caps: CAPS });
    expect(await s.svc.change(act(good), me())).toEqual({});
    expect(s.runs).toHaveLength(1);
    for (const bad of [
      { ...good, chat: 'nope' },
      { ...good, title: '' },
      { ...good, title: 'a\nb' },
      { ...good, title: 'x'.repeat(121) },
      { ...good, summary: ' ' },
    ])
      await expect(s.svc.change(act(bad), me())).rejects.toMatchObject({ code: 'bad-request' });
    await expect(setup().svc.change(act(good), me())).rejects.toMatchObject({ code: 'not-allowed' });
  });

  it('chatEntries: this person, that chat, whole log, newest first', async () => {
    for (let i = 0; i < UPDATES_PAGE + 5; i++) {
      const at = `2026-11-20T10:${String(i).padStart(2, '0')}:00Z`;
      add(at, entry(at), FOLDER, `n${String(i).padStart(5, '0')}`);
    }
    add('2026-10-01T09:00:00Z', chatEntry('2026-10-01T09:00:00Z'), FOLDER, 'old111');
    add('2026-10-02T09:00:00Z', chatEntry('2026-10-02T09:00:00Z', 'ben-mcadam'), FOLDER, 'ben111');
    add('2026-10-03T09:00:00Z', chatEntry('2026-10-03T09:00:00Z', 'sam-example', OTHER), FOLDER, 'oth111');
    add('2026-10-04T09:00:00Z', chatEntry('2026-10-04T09:00:00Z'), FOLDER, 'new111');
    const got = await setup({ caps: CAPS }).svc.chatEntries(KEY, CHAT, me());
    expect(got.map((e) => e.at)).toEqual(['2026-10-04T09:00:00Z', '2026-10-01T09:00:00Z']);
    expect(got[0]).toEqual({
      path: file(FOLDER, '2026-10-04T09:00:00Z', 'new111'),
      at: '2026-10-04T09:00:00Z',
      summary: '**Objective:** x',
    });
    expect(await setup({ caps: CAPS }).svc.chatEntries('acme/none', CHAT, me())).toEqual([]);
  });

  it('myChatEntries: this person only, newest at per chat, empty for an unknown project', async () => {
    add('2026-10-01T09:00:00Z', chatEntry('2026-10-01T09:00:00Z'), FOLDER, 'old111');
    add('2026-10-04T09:00:00Z', chatEntry('2026-10-04T09:00:00Z'), FOLDER, 'new111');
    add('2026-10-05T09:00:00Z', chatEntry('2026-10-05T09:00:00Z', 'ben-mcadam'), FOLDER, 'ben111');
    add('2026-10-06T09:00:00Z', chatEntry('2026-10-06T09:00:00Z', 'sam-example', OTHER), FOLDER, 'oth111');
    add('2026-10-03T09:00:00Z', entry('2026-10-03T09:00:00Z'), FOLDER, 'not111');
    const got = await setup({ caps: CAPS }).svc.myChatEntries(KEY, me());
    expect(got.get(CHAT)).toBe('2026-10-04T09:00:00Z');
    expect(got.get(OTHER)).toBe('2026-10-06T09:00:00Z');
    expect(got.size).toBe(2);
    expect((await setup({ caps: CAPS }).svc.myChatEntries('acme/none', me())).size).toBe(0);
  });
});
