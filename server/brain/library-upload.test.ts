// Library uploads (plan docs/plans/2026-11-26-file-types-and-uploads.md, decisions 3-5, 7; overseer rulings 3-5, 7).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Identity, LibraryScope } from '../../shared/contract.ts';
import { FilesChangeError } from '../../shared/files-contract.ts';
import { LIBRARY_UPLOAD_MESSAGES } from '../../shared/library-upload-contract.ts';
import {
  LEGACY_PROJECTS_SCOPE,
  PROJECT_LINKS_MAX,
  type ProjectCard,
  type ProjectList,
} from '../../shared/projects-contract.ts';
import { savedOnlyRenamed } from './files-skill.ts';
import {
  createLibraryUpload,
  decideUpload,
  type LibraryUploadDeps,
  LibraryUploadError,
  type LibraryUploadInput,
} from './library-upload.ts';

const sam: Identity = {
  name: 'Sam Example',
  slug: 'sam-example',
  email: null,
  role: 'scout',
  knownMember: true,
};
const tess: Identity = { name: 'Tess Team', slug: 'tess-team', email: null, role: 'team', knownMember: true };
/** Someone this Mac's git identity doesn't match on the team list. */
const stranger: Identity = {
  name: 'Someone',
  slug: 'someone',
  email: null,
  role: 'unknown',
  knownMember: false,
};

const SCOPES: LibraryScope[] = [
  { id: 'personal', name: 'My personal files', kind: 'personal' },
  { id: 'shared:templates', name: 'Templates', kind: 'shared' },
  { id: LEGACY_PROJECTS_SCOPE, name: 'Older projects', kind: 'shared' },
  { id: 'client:acme-heating', name: 'Acme Heating', kind: 'client' },
  // A folder with capitals can be listed (listClients takes folder names as they are); uploads refuse it.
  { id: 'client:Acme', name: 'Acme caps', kind: 'client' },
];

const VERSION = 'a'.repeat(64);
const card = (over: Partial<ProjectCard>): ProjectCard =>
  ({
    key: 'acme-heating/web',
    space: 'client',
    slug: 'web',
    client: 'acme-heating',
    folder: 'clients/acme-heating/projects/web',
    card: 'ok',
    archived: false,
    links: [],
    version: VERSION,
    ...over,
  }) as ProjectCard;

const CARDS: ProjectCard[] = [
  card({}),
  // The card's `client:` text says another client: the folder wins.
  card({
    key: 'acme-heating/lies',
    slug: 'lies',
    client: 'skyseal',
    folder: 'clients/acme-heating/projects/lies',
  }),
  card({
    key: 'personal/plan',
    space: 'personal',
    client: null,
    slug: 'plan',
    folder: 'personal/projects/plan',
  }),
  card({
    key: 'acme-heating/nocard',
    slug: 'nocard',
    folder: 'clients/acme-heating/projects/nocard',
    card: 'none',
  }),
  card({ key: 'acme-heating/old', slug: 'old', archived: true, folder: 'clients/acme-heating/projects/old' }),
  card({ key: 'the-digital-stride/legacy', space: 'legacy', slug: 'legacy', folder: 'projects/legacy' }),
  card({ key: 'nobody/x', slug: 'x', client: 'nobody', folder: 'clients/nobody/projects/x' }),
  // A shared space whose folder says personal: never filed under personal/.
  card({ key: 'acme-heating/odd', space: 'client', slug: 'odd', folder: 'personal/projects/odd' }),
  card({
    key: 'acme-heating/full',
    slug: 'full',
    folder: 'clients/acme-heating/projects/full',
    links: Array.from({ length: PROJECT_LINKS_MAX }, (_, i) => `clients/acme-heating/files/f${i}.pdf`),
  }),
];

function fake(
  over: {
    may?: boolean;
    caps?: string[];
    canChange?: boolean;
    reply?: (path: string) => string;
    addFails?: unknown;
    linkFails?: unknown;
  } = {},
) {
  const added: { source: string; path: string; by?: { slug: string; name: string } }[] = [];
  const linked: unknown[] = [];
  const saved: string[] = [];
  const deps: LibraryUploadDeps = {
    files: {
      capabilities: async () => over.caps ?? ['files-delete-v1', 'files-add-v1'],
      add: async (r) => {
        if (over.addFails) throw over.addFails;
        added.push(r);
        return over.reply ? over.reply(r.path) : r.path;
      },
    },
    scopes: async () => SCOPES,
    projects: async () => ({ projects: CARDS, canChange: over.canChange ?? true }) as unknown as ProjectList,
    link: async (action) => {
      if (over.linkFails) throw over.linkFails;
      linked.push(action);
      return { projects: CARDS, canChange: true } as unknown as ProjectList;
    },
    onSaved: (p) => saved.push(p),
    mayUseFiles: async () => over.may ?? true,
  };
  return { service: createLibraryUpload('/nonexistent', deps), added, linked, saved };
}

const SOURCE = '/tmp/staged/abc/quote.pdf';
const scopeReq = (scope: string, name = 'quote.pdf'): LibraryUploadInput => ({
  stagedPath: SOURCE,
  name,
  scope,
});
const projectReq = (key: string, name = 'quote.pdf', expect = VERSION): LibraryUploadInput => ({
  stagedPath: SOURCE,
  name,
  project: key,
  expect,
});

async function refusal(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof LibraryUploadError) return { code: err.code, message: err.message };
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('decideUpload: the one rule for flags and requests', () => {
  const ok = { scopes: SCOPES, mayAdd: true };

  it('files a scope upload by the file own kind', () => {
    expect(decideUpload({ scope: 'client:acme-heating' }, 'quote.pdf', ok)).toEqual({
      ok: true,
      scope: 'client:acme-heating',
      personal: false,
      path: 'clients/acme-heating/files/quote.pdf',
      kind: 'document',
      where: "Acme Heating's Documents",
    });
    expect(decideUpload({ scope: 'client:acme-heating' }, 'Logo.PNG', ok)).toMatchObject({
      ok: true,
      path: 'clients/acme-heating/images/Logo.PNG',
      kind: 'image',
      where: "Acme Heating's Images",
    });
    expect(decideUpload({ scope: 'personal' }, 'notes.md', ok)).toMatchObject({
      ok: true,
      scope: 'personal',
      personal: true,
      path: 'personal/files/notes.md',
      where: 'your personal files',
    });
    expect(decideUpload({ scope: 'personal' }, 'me.jpg', ok)).toMatchObject({
      path: 'personal/images/me.jpg',
    });
  });

  it('cleans the name as a task upload does', () => {
    expect(decideUpload({ scope: 'personal' }, 'a/b:c?.pdf', ok)).toMatchObject({
      path: 'personal/files/abc.pdf',
    });
    expect(decideUpload({ scope: 'client:acme-heating' }, 'profile.md', ok)).toMatchObject({
      path: 'clients/acme-heating/files/profile (file).md',
    });
  });

  it('takes a project upload to the folder its card lives in, never its client: text', () => {
    expect(decideUpload({ card: CARDS[0] as ProjectCard }, 'quote.pdf', ok)).toMatchObject({
      ok: true,
      scope: 'client:acme-heating',
      path: 'clients/acme-heating/files/quote.pdf',
      personal: false,
    });
    expect(decideUpload({ card: CARDS[1] as ProjectCard }, 'quote.pdf', ok)).toMatchObject({
      path: 'clients/acme-heating/files/quote.pdf',
    });
    expect(decideUpload({ card: CARDS[2] as ProjectCard }, 'pic.webp', ok)).toMatchObject({
      ok: true,
      scope: 'personal',
      personal: true,
      path: 'personal/images/pic.webp',
    });
  });

  it.each([
    ['shared:templates', 'not-allowed'],
    [LEGACY_PROJECTS_SCOPE, 'not-allowed'],
    ['client:Acme', 'not-allowed'],
    ['client:nobody', 'no-such-place'],
    ['client:../x', 'no-such-place'],
    ['client:_archive', 'no-such-place'],
    ['client:ACME-HEATING', 'no-such-place'],
    ['Personal', 'no-such-place'],
    ['', 'no-such-place'],
  ])('refuses the scope %j (%s)', (scope, why) => {
    expect(decideUpload({ scope }, 'quote.pdf', ok)).toEqual({ ok: false, refusal: why });
    expect(decideUpload({ scope }, null, ok)).toEqual({ ok: false, refusal: why });
  });

  it('refuses a listed scope shaped like a path or an archive, even if a listing had it', () => {
    const odd: LibraryScope[] = [
      ...SCOPES,
      { id: 'client:../x', name: 'x', kind: 'client' },
      { id: 'client:_archive', name: 'Archive', kind: 'client' },
      { id: 'client:acme-heating', name: 'Twice', kind: 'shared' },
    ];
    for (const scope of ['client:../x', 'client:_archive'])
      expect(decideUpload({ scope }, 'quote.pdf', { scopes: odd, mayAdd: true })).toEqual({
        ok: false,
        refusal: 'not-allowed',
      });
  });

  it('refuses archived, card-less, legacy, unlisted-client and mismatched project folders', () => {
    const why = (key: string) =>
      decideUpload({ card: CARDS.find((c) => c.key === key) as ProjectCard }, 'quote.pdf', ok);
    expect(why('acme-heating/old')).toEqual({ ok: false, refusal: 'project-closed' });
    expect(why('acme-heating/nocard')).toEqual({ ok: false, refusal: 'project-closed' });
    expect(why('the-digital-stride/legacy')).toEqual({ ok: false, refusal: 'project-closed' });
    expect(why('nobody/x')).toEqual({ ok: false, refusal: 'not-allowed' });
    // A shared project never gets a personal/ destination.
    expect(why('acme-heating/odd')).toEqual({ ok: false, refusal: 'not-allowed' });
  });

  it('checks the type first, then permission, then the place', () => {
    expect(decideUpload({ scope: 'client:nobody' }, 'x.svg', { scopes: SCOPES, mayAdd: false })).toEqual({
      ok: false,
      refusal: 'bad-type',
    });
    for (const name of ['x.html', 'x.htm', 'x', '.pdf', 'x.exe'])
      expect(decideUpload({ scope: 'personal' }, name, ok), name).toEqual({ ok: false, refusal: 'bad-type' });
    expect(decideUpload({ scope: 'client:nobody' }, 'x.pdf', { scopes: SCOPES, mayAdd: false })).toEqual({
      ok: false,
      refusal: 'not-allowed',
    });
    expect(decideUpload({ scope: 'personal' }, null, { scopes: SCOPES, mayAdd: false })).toEqual({
      ok: false,
      refusal: 'not-allowed',
    });
  });

  it('without a name answers the place only (the flags)', () => {
    expect(decideUpload({ scope: 'client:acme-heating' }, null, ok)).toEqual({
      ok: true,
      scope: 'client:acme-heating',
      personal: false,
      path: null,
      kind: null,
      where: null,
    });
  });
});

describe('savedOnlyRenamed (files-skill helper)', () => {
  it('lets the script pick a free name in the same folder, nothing else', () => {
    const asked = 'clients/acme/files/quote.pdf';
    expect(savedOnlyRenamed(asked, asked)).toBe(true);
    expect(savedOnlyRenamed(asked, 'clients/acme/files/quote (2).pdf')).toBe(true);
    expect(savedOnlyRenamed(asked, 'clients/acme/images/quote.pdf')).toBe(false);
    expect(savedOnlyRenamed(asked, 'clients/acme/files/sub/quote.pdf')).toBe(false);
    expect(savedOnlyRenamed(asked, 'clients/acme/files/')).toBe(false);
    expect(savedOnlyRenamed(asked, 'clients/acme/files/..')).toBe(false);
    expect(savedOnlyRenamed(asked, 'clients/acme/files/.')).toBe(false);
    expect(savedOnlyRenamed(asked, 'clients/acme/files/a\\b.pdf')).toBe(false);
    expect(savedOnlyRenamed(asked, 'clients/other/files/quote.pdf')).toBe(false);
    expect(savedOnlyRenamed(asked, '')).toBe(false);
    expect(savedOnlyRenamed('quote.pdf', 'quote.pdf')).toBe(false);
  });
});

describe('createLibraryUpload: permission', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  function brain(opts: { skill?: boolean; script?: boolean; roles?: string }): string {
    const root = mkdtempSync(join(tmpdir(), 'tba-lib-upload-'));
    dirs.push(root);
    if (opts.skill === false) return root;
    const dir = join(root, '.claude', 'skills', 'tdsapp-files');
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nroles: ${opts.roles ?? 'owner, scout'}\n---\n`);
    if (opts.script !== false) writeFileSync(join(dir, 'scripts', 'tdsapp-files.cjs'), '');
    return root;
  }
  function real(root: string, caps = ['files-add-v1']) {
    const added: string[] = [];
    const service = createLibraryUpload(root, {
      files: {
        capabilities: async () => caps,
        add: async (r) => {
          added.push(r.path);
          return r.path;
        },
      },
      scopes: async () => SCOPES,
      projects: async () => ({ projects: CARDS, canChange: true }) as unknown as ProjectList,
      link: async () => ({ projects: CARDS, canChange: true }) as unknown as ProjectList,
    });
    return { service, added };
  }

  it('allows the skill, its roles and files-add-v1', async () => {
    const { service, added } = real(brain({}));
    expect(await service.canUpload('client:acme-heating', sam)).toBe(true);
    expect(await service.canUploadFiles(sam)).toBe(true);
    expect((await service.save(scopeReq('client:acme-heating'), sam)).path).toBe(
      'clients/acme-heating/files/quote.pdf',
    );
    expect(added).toEqual(['clients/acme-heating/files/quote.pdf']);
  });

  it.each([
    ['without the skill', { skill: false }, sam, ['files-add-v1']],
    ['without its script', { script: false }, sam, ['files-add-v1']],
    ['without the role', {}, tess, ['files-add-v1']],
    ["without 'files-add-v1'", {}, sam, ['files-delete-v1']],
  ] as const)('refuses %s, before anything runs', async (_, opts, who, caps) => {
    const { service, added } = real(brain(opts), [...caps]);
    expect(await service.canUpload('client:acme-heating', who)).toBe(false);
    expect(await service.canUpload('personal', who)).toBe(false);
    expect(await service.canUploadFiles(who)).toBe(false);
    expect(await refusal(service.save(scopeReq('client:acme-heating'), who))).toEqual({
      code: 'not-allowed',
      message: LIBRARY_UPLOAD_MESSAGES.notAllowed,
    });
    expect(await refusal(service.save(projectReq('acme-heating/web'), who))).toMatchObject({
      code: 'not-allowed',
    });
    expect(added).toEqual([]);
  });

  it('lets anyone the skill roles allow upload, the whole team included', async () => {
    const { service, added } = real(brain({ roles: 'owner, scout, team' }));
    expect(await service.canUpload('client:acme-heating', tess)).toBe(true);
    expect(await service.canUploadFiles(tess)).toBe(true);
    expect((await service.save(scopeReq('client:acme-heating'), tess)).path).toBe(
      'clients/acme-heating/files/quote.pdf',
    );
    expect(added).toEqual(['clients/acme-heating/files/quote.pdf']);
  });

  it('keeps someone not on the team list to their personal files, as the script does', async () => {
    // The skill's roles let an unknown person through (they count as team there), but the script refuses
    // them a client file, so no client or project upload is offered and none is tried.
    const { service, added } = real(brain({ roles: 'owner, scout, team' }));
    expect(await service.canUpload('client:acme-heating', stranger)).toBe(false);
    expect(await service.canUploadFiles(stranger)).toBe(false);
    expect(await refusal(service.save(scopeReq('client:acme-heating'), stranger))).toEqual({
      code: 'not-allowed',
      message: LIBRARY_UPLOAD_MESSAGES.notAllowed,
    });
    expect(await refusal(service.save(projectReq('acme-heating/web'), stranger))).toMatchObject({
      code: 'not-allowed',
    });
    expect(await refusal(service.save(projectReq('personal/plan', 'pic.webp'), stranger))).toMatchObject({
      code: 'not-allowed',
    });
    expect(added).toEqual([]);
    expect(await service.canUpload('personal', stranger)).toBe(true);
    expect((await service.save(scopeReq('personal'), stranger)).path).toBe('personal/files/quote.pdf');
  });
});

describe('createLibraryUpload: save', () => {
  it('saves a scope upload through add, then onSaved, with who it is by', async () => {
    const f = fake();
    const order: string[] = [];
    const out = await f.service.save(scopeReq('client:acme-heating'), sam, {
      onSaved: (p) => order.push(`route:${p}`),
    });
    expect(out).toEqual({
      path: 'clients/acme-heating/files/quote.pdf',
      kind: 'document',
      scope: 'client:acme-heating',
      personal: false,
    });
    expect(f.added).toEqual([
      {
        source: SOURCE,
        path: 'clients/acme-heating/files/quote.pdf',
        by: { slug: sam.slug, name: sam.name },
      },
    ]);
    expect(f.saved).toEqual(['clients/acme-heating/files/quote.pdf']);
    expect(order).toEqual(['route:clients/acme-heating/files/quote.pdf']);
    expect(f.linked).toEqual([]);
  });

  it('files by the kind whichever screen sent it: an image to a client is filed in images/', async () => {
    const f = fake();
    expect(await f.service.save(scopeReq('client:acme-heating', 'logo.png'), sam)).toMatchObject({
      path: 'clients/acme-heating/images/logo.png',
      kind: 'image',
    });
    expect(await f.service.save(scopeReq('personal', 'brief.docx'), sam)).toMatchObject({
      path: 'personal/files/brief.docx',
      kind: 'document',
      scope: 'personal',
      personal: true,
    });
  });

  it('keeps the name the script picked, and refuses as internal an answer in another folder', async () => {
    const renamed = fake({ reply: (p) => p.replace('quote.pdf', 'quote (2).pdf') });
    expect((await renamed.service.save(scopeReq('client:acme-heating'), sam)).path).toBe(
      'clients/acme-heating/files/quote (2).pdf',
    );
    for (const reply of [
      'clients/acme-heating/images/quote.pdf',
      'clients/skyseal/files/quote.pdf',
      'clients/acme-heating/files/x/quote.pdf',
      'clients/acme-heating/files/quote.exe',
      'personal/files/quote.pdf',
    ]) {
      const f = fake({ reply: () => reply });
      expect(await refusal(f.service.save(projectReq('acme-heating/web'), sam)), reply).toEqual({
        code: 'internal',
        message: LIBRARY_UPLOAD_MESSAGES.saveFailed,
      });
      expect(f.saved).toEqual([]);
      expect(f.linked).toEqual([]);
    }
  });

  it('saves then links a project upload, answering the fresh list', async () => {
    const f = fake();
    const order: string[] = [];
    const out = await f.service.save(projectReq('acme-heating/web', 'logo.png'), sam, {
      onSaved: () => order.push(`published:${f.linked.length}`),
    });
    expect(out).toMatchObject({
      path: 'clients/acme-heating/images/logo.png',
      kind: 'image',
      scope: 'client:acme-heating',
      personal: false,
      linked: true,
    });
    expect(out.list?.projects).toHaveLength(CARDS.length);
    expect(f.linked).toEqual([
      {
        kind: 'link',
        key: 'acme-heating/web',
        path: 'clients/acme-heating/images/logo.png',
        expect: VERSION,
      },
    ]);
    // The library is told before the link runs.
    expect(order).toEqual(['published:0']);
  });

  it('files a personal project upload under personal/', async () => {
    const f = fake();
    expect(await f.service.save(projectReq('personal/plan'), sam)).toMatchObject({
      path: 'personal/files/quote.pdf',
      scope: 'personal',
      personal: true,
      linked: true,
    });
  });

  it('answers linked: false with the problem and the saved path when the link fails', async () => {
    const f = fake({ linkFails: new Error('changed') });
    const out = await f.service.save(projectReq('acme-heating/web'), sam);
    expect(out).toEqual({
      path: 'clients/acme-heating/files/quote.pdf',
      kind: 'document',
      scope: 'client:acme-heating',
      personal: false,
      linked: false,
      problem: LIBRARY_UPLOAD_MESSAGES.savedNotLinked("Acme Heating's Documents"),
    });
    expect(f.saved).toEqual(['clients/acme-heating/files/quote.pdf']);
    const p = fake({ linkFails: new Error('x') });
    expect((await p.service.save(projectReq('personal/plan'), sam)).problem).toBe(
      LIBRARY_UPLOAD_MESSAGES.savedNotLinked('your personal files'),
    );
  });

  it('refuses a full project and a changed card BEFORE add runs', async () => {
    const full = fake();
    expect(await refusal(full.service.save(projectReq('acme-heating/full'), sam))).toEqual({
      code: 'not-allowed',
      message: LIBRARY_UPLOAD_MESSAGES.projectFull,
    });
    expect(full.added).toEqual([]);
    const changed = fake();
    expect(
      await refusal(changed.service.save(projectReq('acme-heating/web', 'q.pdf', 'b'.repeat(64)), sam)),
    ).toEqual({
      code: 'changed',
      message: LIBRARY_UPLOAD_MESSAGES.projectChanged,
    });
    expect(changed.added).toEqual([]);
  });

  it('refuses missing, closed and unchangeable projects before add', async () => {
    const f = fake();
    expect(await refusal(f.service.save(projectReq('acme-heating/gone'), sam))).toEqual({
      code: 'not-found',
      message: LIBRARY_UPLOAD_MESSAGES.noSuchProject,
    });
    for (const key of ['acme-heating/old', 'acme-heating/nocard', 'the-digital-stride/legacy'])
      expect(await refusal(f.service.save(projectReq(key), sam)), key).toEqual({
        code: 'not-allowed',
        message: LIBRARY_UPLOAD_MESSAGES.projectClosed,
      });
    for (const key of ['nobody/x', 'acme-heating/odd'])
      expect(await refusal(f.service.save(projectReq(key), sam)), key).toEqual({
        code: 'not-allowed',
        message: LIBRARY_UPLOAD_MESSAGES.notAllowed,
      });
    const locked = fake({ canChange: false });
    expect(await refusal(locked.service.save(projectReq('acme-heating/web'), sam))).toEqual({
      code: 'not-allowed',
      message: LIBRARY_UPLOAD_MESSAGES.notAllowed,
    });
    expect([...f.added, ...locked.added]).toEqual([]);
  });

  it('refuses scopes with the contract words, before add', async () => {
    const f = fake();
    expect(await refusal(f.service.save(scopeReq('client:nobody'), sam))).toEqual({
      code: 'not-found',
      message: LIBRARY_UPLOAD_MESSAGES.noSuchPlace,
    });
    expect(await refusal(f.service.save(scopeReq('shared:templates'), sam))).toEqual({
      code: 'not-allowed',
      message: LIBRARY_UPLOAD_MESSAGES.notAllowed,
    });
    expect(await refusal(f.service.save(scopeReq('personal', 'x.svg'), sam))).toEqual({
      code: 'bad-request',
      message: LIBRARY_UPLOAD_MESSAGES.badType,
    });
    expect(f.added).toEqual([]);
  });

  it("maps the script's refusals to the app's words, never the script's", async () => {
    const refused = fake({ addFails: new FilesChangeError('not-allowed', 'script words') });
    expect(await refusal(refused.service.save(scopeReq('client:acme-heating'), sam))).toEqual({
      code: 'not-allowed',
      message: LIBRARY_UPLOAD_MESSAGES.saveRefused,
    });
    const broken = fake({ addFails: new Error('boom') });
    expect(await refusal(broken.service.save(scopeReq('client:acme-heating'), sam))).toEqual({
      code: 'internal',
      message: LIBRARY_UPLOAD_MESSAGES.saveFailed,
    });
    const bad = fake({ addFails: new FilesChangeError('bad-request', 'script words') });
    expect(await refusal(bad.service.save(scopeReq('client:acme-heating'), sam))).toEqual({
      code: 'bad-request',
      message: LIBRARY_UPLOAD_MESSAGES.saveFailed,
    });
  });
});

describe('the flags and the request agree in every case', () => {
  const targets: ({ scope: string } | { project: string })[] = [
    ...SCOPES.map((s) => ({ scope: s.id })),
    { scope: 'client:nobody' },
    { scope: 'client:../x' },
    { scope: 'client:_archive' },
    ...CARDS.filter(
      (c) => c.key !== 'acme-heating/full' && c.key !== 'nobody/x' && c.key !== 'acme-heating/odd',
    ).map((c) => ({ project: c.key })),
  ];
  const people: { name: string; over: Parameters<typeof fake>[0]; who?: Identity }[] = [
    { name: 'allowed', over: {} },
    { name: 'no permission', over: { may: false } },
    { name: 'no add feature', over: { caps: ['files-delete-v1'] } },
    { name: 'projects locked', over: { canChange: false } },
    { name: 'not on the team list', over: {}, who: stranger },
  ];
  for (const p of people) {
    for (const t of targets) {
      it(`${p.name}: ${JSON.stringify(t)}`, async () => {
        const f = fake(p.over);
        const who = p.who ?? sam;
        let flag: boolean;
        if ('scope' in t) {
          flag = await f.service.canUpload(t.scope, who);
        } else {
          // The project flag (list level, as the route sets it) and the per-card rule the contract gives the client.
          const c = CARDS.find((x) => x.key === t.project) as ProjectCard;
          flag =
            ((p.over as { canChange?: boolean }).canChange ?? true) &&
            (await f.service.canUploadFiles(who)) &&
            !c.archived &&
            c.card === 'ok' &&
            c.space !== 'legacy';
        }
        let saved: boolean;
        try {
          await f.service.save('scope' in t ? scopeReq(t.scope) : projectReq(t.project), who);
          saved = true;
        } catch (err) {
          if (!(err instanceof LibraryUploadError)) throw err;
          saved = false;
        }
        expect(saved).toBe(flag);
      });
    }
  }
});
