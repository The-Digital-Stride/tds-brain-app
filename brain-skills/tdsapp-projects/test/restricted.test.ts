// Restricted projects in the `tdsapp-projects` script, 0.9.0 (plan docs/plans/2026-11-27-restricted-projects.md,
// decisions 1, 2, 8 and 14; contract section "script (Builder B)"). A card may carry `visibility: restricted`;
// the script then treats the project as missing for anyone who can't see it, lets only the Account Owner, an
// owner or a scout switch it, and mirrors shared/project-visibility.ts (pinned by the parity tests at the end).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../../server/brain/frontmatter.ts';
import {
  canSeeProject,
  isRestricted,
  onProject,
  PROJECTS_VISIBILITY_CAPABILITY,
  type ProjectViewer,
  parseVisibility,
  personSlugs,
  rawTextRestricted,
  seesEveryProject,
  slugForms,
  type VisibilityCard,
} from '../../../shared/project-visibility.ts';

type Reply = { ok: boolean; error?: string; message?: string; [k: string]: unknown };
interface Ctx {
  root: string;
  home: string;
  now: Date;
  keysDir?: string;
}
interface ProjectsModule {
  run(action: string, input: unknown, ctx: Ctx): { exit: number; reply: Reply };
  SCRIPT_VERSION: string;
  PROJECTS_VISIBILITY_CAPABILITY: string;
  parseVisibility(raw: unknown): string;
  rawTextRestricted(text: string): boolean;
  slugForms(name: string): string[];
  personSlugs(person: { slug: string; name?: string }): string[];
  onProject(card: { owner: string | null; team: string[] }, person: { slug: string; name?: string }): boolean;
  seesEveryProject(viewer: ProjectViewer): boolean;
  isRestricted(card: { space: string; visibility?: string }): boolean;
  canSeeProject(card: VisibilityCard, viewer: ProjectViewer): boolean;
  readCardAccess(space: string, text: string): VisibilityCard;
}

const require = createRequire(import.meta.url);
const projects = require('../scripts/tdsapp-projects.cjs') as ProjectsModule;

const ROLES = {
  members: [
    { name: 'Olive Owner', email: 'olive@example.test', role: 'owner' },
    { name: 'Sam Example', email: 'sam@example.test', role: 'scout' },
    { name: 'Tess Team', email: 'tess@example.test', role: 'team' },
    { name: 'Terry Team', email: 'terry@example.test', role: 'team' },
    // Two slug forms: mary-jane-oneil (the brain's member slug) and mary-jane-o-neil (the Workbench's).
    { name: "Mary-Jane O'Neil", email: 'mj@example.test', role: 'team' },
  ],
};
const T0 = new Date('2026-11-27T10:20:30.000Z');
const PITCH = 'clients/acme/projects/pitch';
const PITCH_CARD = `${PITCH}/project.md`;
const PITCH_TEXT =
  '---\nv: 1\ntitle: Secret pitch\nclient: acme\nref: ACM4K7\nstatus: active\nowner: tess-team\nteam:\n  - "mary-jane-o-neil"\nvisibility: restricted\n---\n\nThe brief.\n';
const OPEN = 'clients/acme/projects/site';
const OPEN_TEXT =
  '---\nv: 1\ntitle: Site\nclient: acme\nref: ACM5N3\nstatus: active\nowner: tess-team\n---\n\nThe brief.\n';

let root: string;
let home: string;

function git(args: string[], cwd = root) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
const as = (email: string) => git(['config', 'user.email', email]);
const abs = (rel: string) => join(root, ...rel.split('/'));
function put(rel: string, text = 'hello') {
  mkdirSync(dirname(abs(rel)), { recursive: true });
  writeFileSync(abs(rel), text);
}
const read = (rel: string) => readFileSync(abs(rel), 'utf8');
const sha = (rel: string) =>
  createHash('sha256')
    .update(readFileSync(abs(rel)))
    .digest('hex');
const call = (action: string, input: Record<string, unknown> = {}) =>
  projects.run(
    action,
    { kind: action, ...input },
    { root, home, now: T0, keysDir: join(home, 'email-keys') },
  );
const refusal = (r: { exit: number; reply: Reply }) => ({
  exit: r.exit,
  error: r.reply.error,
  message: r.reply.message,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'restricted-brain-'));
  home = mkdtempSync(join(tmpdir(), 'restricted-home-'));
  git(['init', '-q']);
  as('sam@example.test');
  mkdirSync(join(root, '.team-config'));
  writeFileSync(join(root, '.team-config', 'roles.json'), JSON.stringify(ROLES));
  writeFileSync(join(root, '.gitignore'), 'personal/\n*~\nbriefing/email-drafts/\n');
  for (const c of ['acme', 'skyseal']) mkdirSync(join(root, 'clients', c), { recursive: true });
  put(PITCH_CARD, PITCH_TEXT);
  put(`${OPEN}/project.md`, OPEN_TEXT);
  put('clients/acme/files/brief.pdf', 'pdf');
});

afterEach(() => {
  for (const dir of [root, home]) rmSync(dir, { recursive: true, force: true });
});

const create = (slug: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  call('create', {
    space: 'client',
    client: 'acme',
    slug,
    fields: { title: 'New one', ...fields },
    ...extra,
  });
const edit = (
  key: string,
  fields: Record<string, unknown>,
  card = `clients/${key.replace('/', '/projects/')}/project.md`,
) => call('edit', { key, fields, expect: sha(card) });

describe('the visibility field', () => {
  it('create writes `visibility: restricted` right after team, and nothing for everyone', () => {
    const r = create('secret', { team: ['tess-team'], service: ['seo'], visibility: 'restricted' });
    expect(r.reply).toMatchObject({ ok: true, key: 'acme/secret' });
    expect(read('clients/acme/projects/secret/project.md')).toContain(
      '\nteam:\n  - "tess-team"\nvisibility: restricted\nservice:\n  - "seo"\n',
    );
    expect(create('open', { visibility: 'everyone' }).reply).toMatchObject({ ok: true });
    expect(read('clients/acme/projects/open/project.md')).not.toContain('visibility');
  });

  it('create refuses a value that is not everyone or restricted, and writes nothing', () => {
    for (const visibility of ['secret', 'Restricted', null, true, ['restricted']]) {
      const r = create('bad', { visibility });
      expect(refusal(r), String(visibility)).toEqual({
        exit: 2,
        error: 'bad-request',
        message: 'visibility must be one of everyone, restricted',
      });
      expect(existsSync(abs('clients/acme/projects/bad'))).toBe(false);
    }
  });

  it('never restricts a personal project', () => {
    const r = call('create', {
      space: 'personal',
      slug: 'mine',
      fields: { title: 'Mine', visibility: 'restricted' },
    });
    expect(refusal(r)).toEqual({
      exit: 2,
      error: 'bad-request',
      message: "A personal project is yours alone already, so it can't be restricted.",
    });
    expect(existsSync(abs('personal/projects/mine'))).toBe(false);
    put('personal/projects/jev/project.md', '---\nv: 1\ntitle: Jev\nstatus: active\n---\n');
    expect(
      refusal(edit('personal/jev', { visibility: 'restricted' }, 'personal/projects/jev/project.md')),
    ).toMatchObject({
      error: 'bad-request',
      message: "A personal project is yours alone already, so it can't be restricted.",
    });
    expect(read('personal/projects/jev/project.md')).not.toContain('visibility');
  });

  it('card writes the line for an owner or a scout', () => {
    mkdirSync(abs('clients/acme/projects/bare'), { recursive: true });
    expect(call('card', { key: 'acme/bare', fields: { visibility: 'restricted' } }).reply).toMatchObject({
      ok: true,
    });
    expect(read('clients/acme/projects/bare/project.md')).toContain('\nvisibility: restricted\n');
    mkdirSync(abs('clients/acme/projects/bare-two'), { recursive: true });
    expect(call('card', { key: 'acme/bare-two', fields: { visibility: 'everyone' } }).reply).toMatchObject({
      ok: true,
    });
    expect(read('clients/acme/projects/bare-two/project.md')).not.toContain('visibility');
  });

  it('edit adds the line after team and everyone takes it out again, leaving every other byte', () => {
    const team = `${OPEN_TEXT.replace('owner: tess-team\n', 'owner: tess-team\nteam:\n  - "terry-team"\n')}`;
    put(`${OPEN}/project.md`, team);
    as('tess@example.test');
    expect(edit('acme/site', { visibility: 'restricted' }).reply).toMatchObject({ ok: true });
    expect(read(`${OPEN}/project.md`)).toBe(
      team.replace('  - "terry-team"\n', '  - "terry-team"\nvisibility: restricted\n'),
    );
    expect(edit('acme/site', { visibility: 'everyone' }).reply).toMatchObject({ ok: true });
    expect(read(`${OPEN}/project.md`)).toBe(team);
  });

  it('edit refuses a bad value', () => {
    for (const visibility of ['hidden', null, 1]) {
      expect(refusal(edit('acme/site', { visibility }))).toMatchObject({ exit: 2, error: 'bad-request' });
    }
    expect(read(`${OPEN}/project.md`)).toBe(OPEN_TEXT);
  });

  it('keeps a hand-written unknown value on an unrelated edit, and still reads it as restricted', () => {
    const odd = PITCH_TEXT.replace('visibility: restricted', 'visibility: team only');
    put(PITCH_CARD, odd);
    as('mj@example.test');
    expect(edit('acme/pitch', { title: 'Pitch' }).reply).toMatchObject({ ok: true });
    expect(read(PITCH_CARD)).toBe(odd.replace('title: Secret pitch', 'title: Pitch'));
    as('terry@example.test');
    expect(refusal(edit('acme/pitch', { title: 'Mine now' }))).toEqual({
      exit: 2,
      error: 'not-found',
      message: 'there is no project acme/pitch',
    });
  });

  it('setting visibility writes the one canonical line, whatever was there by hand', () => {
    put(PITCH_CARD, PITCH_TEXT.replace('visibility: restricted', 'Visibility: Restricted'));
    expect(edit('acme/pitch', { visibility: 'restricted' }).reply).toMatchObject({ ok: true });
    expect(read(PITCH_CARD)).toBe(PITCH_TEXT);
    expect(edit('acme/pitch', { visibility: 'everyone' }).reply).toMatchObject({ ok: true });
    expect(read(PITCH_CARD)).toBe(PITCH_TEXT.replace('visibility: restricted\n', ''));
  });
});

describe('who may switch it', () => {
  const switchTo = (visibility: string) => edit('acme/site', { visibility });

  it('lets the Account Owner, by either slug form, switch it both ways', () => {
    as('tess@example.test');
    expect(switchTo('restricted').reply).toMatchObject({ ok: true });
    expect(switchTo('everyone').reply).toMatchObject({ ok: true });
    for (const owner of ['mary-jane-oneil', 'mary-jane-o-neil']) {
      put(`${OPEN}/project.md`, OPEN_TEXT.replace('owner: tess-team', `owner: ${owner}`));
      as('mj@example.test');
      expect(switchTo('restricted').reply, owner).toMatchObject({ ok: true });
      expect(switchTo('everyone').reply, owner).toMatchObject({ ok: true });
    }
  });

  it('lets an owner and a scout switch it', () => {
    for (const email of ['olive@example.test', 'sam@example.test']) {
      as(email);
      expect(switchTo('restricted').reply, email).toMatchObject({ ok: true });
      expect(switchTo('everyone').reply, email).toMatchObject({ ok: true });
    }
  });

  it('refuses a team member on the team, with who can', () => {
    as('mj@example.test');
    expect(refusal(edit('acme/pitch', { visibility: 'everyone' }))).toEqual({
      exit: 2,
      error: 'not-allowed',
      message: 'Only Tess Team (the Account Owner), an owner or a scout can change who sees this project.',
    });
    expect(read(PITCH_CARD)).toBe(PITCH_TEXT);
    as('terry@example.test');
    expect(refusal(switchTo('restricted'))).toMatchObject({ error: 'not-allowed' });
    expect(read(`${OPEN}/project.md`)).toBe(OPEN_TEXT);
  });

  it('leaves a card with no Account Owner to an owner or a scout', () => {
    put(`${OPEN}/project.md`, OPEN_TEXT.replace('owner: tess-team\n', ''));
    as('tess@example.test');
    expect(refusal(switchTo('restricted'))).toEqual({
      exit: 2,
      error: 'not-allowed',
      message: 'Only an owner or a scout can change who sees this project.',
    });
    as('sam@example.test');
    expect(switchTo('restricted').reply).toMatchObject({ ok: true });
  });

  it('always lets the same value be sent back', () => {
    as('mj@example.test');
    expect(edit('acme/pitch', { visibility: 'restricted', status: 'on-hold' }).reply).toMatchObject({
      ok: true,
    });
    as('terry@example.test');
    expect(switchTo('everyone').reply).toMatchObject({ ok: true });
    expect(read(`${OPEN}/project.md`)).toBe(OPEN_TEXT);
  });

  it('refuses restricting a card-less folder unless an owner or a scout asks', () => {
    mkdirSync(abs('clients/acme/projects/bare'), { recursive: true });
    as('terry@example.test');
    expect(refusal(call('card', { key: 'acme/bare', fields: { visibility: 'restricted' } }))).toEqual({
      exit: 2,
      error: 'not-allowed',
      message: 'Only an owner or a scout can change who sees this project.',
    });
    expect(existsSync(abs('clients/acme/projects/bare/project.md'))).toBe(false);
  });
});

describe('creating a restricted project', () => {
  const teamOf = (slug: string) =>
    parseFrontmatter(read(`clients/acme/projects/${slug}/project.md`)).data.team;

  it('adds a team member who makes one to its team, so they keep seeing it', () => {
    as('terry@example.test');
    expect(create('a', { owner: 'tess-team', visibility: 'restricted' }).reply).toMatchObject({ ok: true });
    expect(teamOf('a')).toEqual(['terry-team']);
    expect(create('b', { team: ['tess-team'], visibility: 'restricted' }).reply).toMatchObject({ ok: true });
    expect(teamOf('b')).toEqual(['tess-team', 'terry-team']);
    expect(create('c', { team: ['terry-team'], visibility: 'restricted' }).reply).toMatchObject({ ok: true });
    expect(teamOf('c')).toEqual(['terry-team']);
    // And they can go on working on it.
    expect(edit('acme/a', { status: 'on-hold' }).reply).toMatchObject({ ok: true });
  });

  it('matches the creator by either slug form already on the team', () => {
    as('mj@example.test');
    expect(create('d', { team: ['mary-jane-oneil'], visibility: 'restricted' }).reply).toMatchObject({
      ok: true,
    });
    expect(teamOf('d')).toEqual(['mary-jane-oneil']);
  });

  it('adds nobody for an owner, a scout or the Account Owner named in the same call, or an open project', () => {
    for (const email of ['olive@example.test', 'sam@example.test']) {
      as(email);
      const slug = email.slice(0, 3);
      expect(create(slug, { visibility: 'restricted' }).reply).toMatchObject({ ok: true });
      expect(teamOf(slug)).toBeUndefined();
    }
    as('tess@example.test');
    expect(create('own', { owner: 'tess-team', visibility: 'restricted' }).reply).toMatchObject({ ok: true });
    expect(teamOf('own')).toBeUndefined();
    as('terry@example.test');
    expect(create('plain', { owner: 'tess-team' }).reply).toMatchObject({ ok: true });
    expect(teamOf('plain')).toBeUndefined();
  });
});

describe('outsiders are told the project is not there', () => {
  const DRAFT = {
    threadId: '18c2f0a1b2c3d4e5',
    subject: 'Re: Pitch [ACM4K7]',
    from: { name: 'Alex Smith', address: 'alex@client.example' },
    people: [],
    sentAt: '2026-11-26T16:30:12Z',
    summary: 'Alex liked the pitch.',
    newestText: 'Yes.',
  };
  const ENTRY = `${PITCH}/updates/2026-11-26-0900-tess-team-abc123.md`;
  const NOTE =
    '---\nv: 1\nkind: note\nby: tess-team\nat: 2026-11-26T09:00:00Z\nclient_safe: false\n---\n\nA note.\n';

  // Every key-taking action, built for a key; `rel` is that key's folder.
  const ACTIONS: [string, (key: string, rel: string) => Record<string, unknown>][] = [
    ['edit', (key) => ({ key, fields: { title: 'Mine' }, expect: sha(PITCH_CARD) })],
    ['card', (key) => ({ key, fields: {} })],
    ['link', (key) => ({ key, path: 'clients/acme/files/brief.pdf', expect: sha(PITCH_CARD) })],
    ['unlink', (key) => ({ key, path: 'clients/acme/files/brief.pdf', expect: sha(PITCH_CARD) })],
    ['ref', (key) => ({ key, expect: sha(PITCH_CARD), replace: true })],
    ['update', (key) => ({ key, entry: { kind: 'note', summary: 'Hello', clientSafe: false } })],
    [
      'update',
      (key) => ({
        key,
        entry: {
          kind: 'email',
          draft: 'aaaaaaaaaaaa',
          token: '0'.repeat(32),
          summary: 'x',
          subject: 'x',
          from: 'x',
          people: [],
          clientSafe: false,
        },
      }),
    ],
    [
      'update-remove',
      (key, rel) => ({ key, file: `${rel}/updates/2026-11-26-0900-tess-team-abc123.md`, expect: sha(ENTRY) }),
    ],
    ['archive', (key) => ({ key, expect: sha(PITCH_CARD) })],
    ['archive', (key) => ({ key, check: true })],
    ['unarchive', (key) => ({ key, check: true })],
    ['delete', (key) => ({ key, check: true })],
    ['delete', (key) => ({ key, filesExpect: '0'.repeat(64) })],
    ['delete', (key) => ({ key, check: true, leftover: true })],
    ['move', (key) => ({ key, client: 'skyseal', expect: sha(PITCH_CARD) })],
    ['move', (key) => ({ key, client: 'skyseal', expect: sha(PITCH_CARD), check: true })],
  ];

  const answer = (r: { exit: number; reply: Reply }, key: string) => ({
    exit: r.exit,
    reply: { ...r.reply, message: String(r.reply.message).replaceAll(key, '<key>') },
  });

  beforeEach(() => put(ENTRY, NOTE));

  for (const email of ['terry@example.test', 'nora@example.test']) {
    it(`answers ${email} exactly as for a project that doesn't exist, and changes nothing`, () => {
      as(email);
      for (const [action, input] of ACTIONS) {
        const missing = call(action, input('acme/nothing', 'clients/acme/projects/nothing'));
        const hidden = call(action, input('acme/pitch', PITCH));
        expect(missing.reply.error, `${action} missing`).toBe('not-found');
        expect(answer(hidden, 'acme/pitch'), `${action} ${JSON.stringify(input('k', 'r'))}`).toEqual(
          answer(missing, 'acme/nothing'),
        );
      }
      expect(read(PITCH_CARD)).toBe(PITCH_TEXT);
      expect(read(ENTRY)).toBe(NOTE);
      expect(existsSync(abs('clients/skyseal/projects/pitch'))).toBe(false);
    });
  }

  it('answers a link from an open project to a file in a hidden folder as for a missing file', () => {
    put(`${PITCH}/plan.pdf`, 'pdf');
    put('clients/acme/projects-archive/old-pitch/project.md', PITCH_TEXT.replace('Secret pitch', 'Old'));
    put('clients/acme/projects-archive/old-pitch/deck.pdf', 'pdf');
    const link = (path: string) =>
      call('link', { key: 'acme/site', path, expect: sha(`${OPEN}/project.md`) });
    const answer = (r: { exit: number; reply: Reply }, path: string) => ({
      exit: r.exit,
      reply: { ...r.reply, message: String(r.reply.message).replaceAll(path, '<path>') },
    });
    as('terry@example.test');
    for (const [hidden, missing] of [
      [`${PITCH}/plan.pdf`, 'clients/acme/projects/nothing/plan.pdf'],
      [PITCH_CARD, 'clients/acme/projects/nothing/project.md'],
      ['clients/acme/projects-archive/old-pitch/deck.pdf', 'clients/acme/projects-archive/gone/deck.pdf'],
    ] as const) {
      const gone = link(missing);
      expect(gone.reply).toMatchObject({ ok: false, error: 'bad-request' });
      expect(answer(link(hidden), hidden), hidden).toEqual(answer(gone, missing));
    }
    expect(read(`${OPEN}/project.md`)).toBe(OPEN_TEXT);
    // Someone on the project links it as before.
    as('mj@example.test');
    expect(link(`${PITCH}/plan.pdf`).reply).toMatchObject({ ok: true });
    expect(read(`${OPEN}/project.md`)).toContain('../../../../clients/acme/projects/pitch/plan.pdf');
  });

  it('answers an outsider the same for an archived restricted project and its leftover folder', () => {
    as('sam@example.test');
    expect(call('archive', { key: 'acme/pitch', expect: sha(PITCH_CARD) }).reply).toMatchObject({ ok: true });
    put(`${PITCH}/notes.txt`, 'left behind');
    as('terry@example.test');
    for (const [action, input] of [
      ['unarchive', { check: true }],
      ['delete', { check: true }],
      ['delete', { check: true, leftover: true }],
    ] as const) {
      const missing = call(action, { key: 'acme/nothing', ...input });
      const hidden = call(action, { key: 'acme/pitch', ...input });
      expect(answer(hidden, 'acme/pitch'), `${action} ${JSON.stringify(input)}`).toEqual(
        answer(missing, 'acme/nothing'),
      );
    }
    as('mj@example.test');
    expect(call('delete', { key: 'acme/pitch', check: true, leftover: true }).reply).toMatchObject({
      ok: true,
    });
  });

  it('lets the Account Owner, someone on the team (either slug form), an owner and a scout work on it', () => {
    for (const [email, team] of [
      ['tess@example.test', 'mary-jane-o-neil'],
      ['mj@example.test', 'mary-jane-o-neil'],
      ['mj@example.test', 'mary-jane-oneil'],
      ['olive@example.test', 'nobody'],
      ['sam@example.test', 'nobody'],
    ]) {
      put(PITCH_CARD, PITCH_TEXT.replace('mary-jane-o-neil', team as string));
      as(email as string);
      const who = `${email} ${team}`;
      expect(edit('acme/pitch', { status: 'on-hold' }).reply, who).toMatchObject({ ok: true });
      expect(
        call('update', { key: 'acme/pitch', entry: { kind: 'note', summary: 'Hi', clientSafe: false } })
          .reply,
        who,
      ).toMatchObject({ ok: true });
      expect(call('archive', { key: 'acme/pitch', check: true }).reply, who).toMatchObject({ ok: true });
    }
  }, 30_000);

  it('refuses email-draft for a requested restricted project as for a missing one', () => {
    const draft = (requested: string) =>
      call('email-draft', { ...DRAFT, inboxAddress: 'terry@example.test', requested });
    as('terry@example.test');
    const missing = draft('acme/nothing');
    expect(missing.reply).toMatchObject({
      error: 'not-found',
      message: 'there is no live project acme/nothing with a card',
    });
    expect(answer(draft('acme/pitch'), 'acme/pitch')).toEqual(answer(missing, 'acme/nothing'));
  });

  it('refuses email-draft-remove of a draft for a project its owner can no longer see, as for a gone draft', () => {
    as('mj@example.test');
    const made = call('email-draft', { ...DRAFT, inboxAddress: 'mj@example.test', requested: 'acme/pitch' });
    expect(made.reply).toMatchObject({ ok: true });
    as('sam@example.test');
    expect(edit('acme/pitch', { team: [] }).reply).toMatchObject({ ok: true });
    as('mj@example.test');
    const gone = call('email-draft-remove', { id: 'zzzzzzzzzzzz', dismiss: false });
    expect(gone.reply).toMatchObject({ error: 'not-found', message: "That draft isn't waiting any more." });
    expect(call('email-draft-remove', { id: made.reply.id, dismiss: false })).toEqual(gone);
  });

  it('lets a draft for a project its owner can see be removed as before', () => {
    as('mj@example.test');
    const made = call('email-draft', { ...DRAFT, inboxAddress: 'mj@example.test', requested: 'acme/pitch' });
    expect(call('email-draft-remove', { id: made.reply.id, dismiss: false }).reply).toMatchObject({
      ok: true,
    });
  });
});

describe('find-ref and email-check leave a hidden project out', () => {
  const find = (text: string) => call('find-ref', { text }).reply;

  it('find-ref finds the code for someone on it and nothing for an outsider', () => {
    as('mj@example.test');
    expect(find('see [ACM4K7]').found).toEqual([
      { ref: 'ACM4K7', key: 'acme/pitch', title: 'Secret pitch', client: 'acme' },
    ]);
    // One slip from the hidden code: suggested to someone on it.
    expect(find('ACM4K9').near).toEqual([{ candidate: 'ACM4K9', suggestions: ['ACM4K7'] }]);
    for (const email of ['terry@example.test', 'nora@example.test']) {
      as(email);
      expect(find('see [ACM4K7]'), email).toEqual({ ok: true, action: 'find-ref', found: [], near: [] });
      expect(find('ACM4K9').near, email).toEqual([]);
      // The open project's code is found as before.
      expect((find('ACM5N3').found as unknown[]).length, email).toBe(1);
    }
  });

  it('find-ref answers an outsider exactly as if the hidden card were not there', () => {
    as('terry@example.test');
    const texts = ['ACM4K7', 'ACM4K9', 'ACM5N3 and ACM4K7', 'ACM5N4'];
    const withIt = texts.map(find);
    rmSync(abs(PITCH), { recursive: true });
    expect(withIt).toEqual(texts.map(find));
  });

  it('email-check counts a message only a hidden project holds as fresh for an outsider', () => {
    const SELF = { from: 'alex@client.example', sentAt: '2026-11-26T16:30:12Z' };
    const key = `x:${createHash('sha256').update('alex@client.example\n2026-11-26T16:30\npitch [acm4k7]').digest('hex')}`;
    put(
      `${PITCH}/updates/2026-11-26-1700-tess-team-eee001.md`,
      `---\nv: 1\nkind: email\nby: tess-team\nat: 2026-11-26T17:00:00Z\nclient_safe: false\nemail_subject: Pitch\nemail_from: Alex\nemail_key: ${key}\nemail_inbox_owner: tess-team\n---\n\nHello.\n`,
    );
    const check = (inboxAddress: string) =>
      call('email-check', {
        inboxAddress,
        threadId: '18c2f0a1b2c3d4e5',
        subject: 'Re: Pitch [ACM4K7]',
        thread: [SELF],
      }).reply;
    as('mj@example.test');
    expect(check('mj@example.test')).toMatchObject({ covered: [0], fresh: [], project: 'acme/pitch' });
    as('terry@example.test');
    expect(check('terry@example.test')).toEqual({
      ok: true,
      action: 'email-check',
      covered: [],
      fresh: [{ index: 0, sentAt: SELF.sentAt }],
      project: null,
    });
    // email-draft still won't take the email twice, but doesn't name the hidden project.
    const r = call('email-draft', {
      threadId: '18c2f0a1b2c3d4e5',
      inboxAddress: 'terry@example.test',
      subject: 'Re: Pitch [ACM4K7]',
      from: { name: 'Alex Smith', address: 'alex@client.example' },
      people: [],
      sentAt: SELF.sentAt,
      summary: 'Alex liked it.',
      newestText: 'Yes.',
      thread: [SELF],
    });
    expect(r.reply).toEqual({
      ok: false,
      error: 'exists',
      message: 'That email is already in another project.',
    });
  });
});

describe('capabilities, version and the skill file', () => {
  it('answers projects-visibility-v1 from 0.9.0', () => {
    expect(projects.SCRIPT_VERSION).toBe('0.9.0');
    expect(projects.PROJECTS_VISIBILITY_CAPABILITY).toBe(PROJECTS_VISIBILITY_CAPABILITY);
    const r = call('capabilities').reply;
    expect(r.version).toBe('0.9.0');
    expect(r.features).toContain(PROJECTS_VISIBILITY_CAPABILITY);
  });

  it('documents the field, who may switch it and its honest limit', () => {
    const skill = readFileSync(fileURLToPath(new URL('../SKILL.md', import.meta.url)), 'utf8');
    expect(skill).toContain('version: 0.9.0');
    expect(skill).toContain('visibility: restricted');
    expect(skill).toContain(PROJECTS_VISIBILITY_CAPABILITY);
    expect(skill).toContain(
      'This hides a project in the Cortex app only; its folder still syncs to every Mac.',
    );
    expect(skill).toMatch(/0\.9\.0 [^\n]*restricted/);
  });

  it('has the brain rules text for the owner to paste, listed in the README', () => {
    const rules = readFileSync(
      fileURLToPath(new URL('../brain-rules/restricted-projects.md', import.meta.url)),
      'utf8',
    );
    expect(rules).toContain('clients/AGENTS.md');
    expect(rules).toContain('todo/AGENTS.md');
    expect(rules).toContain('visibility: restricted');
    const readme = readFileSync(fileURLToPath(new URL('../brain-rules/README.md', import.meta.url)), 'utf8');
    expect(readme).toContain('`restricted-projects.md`');
  });
});

// The script can't import shared/project-visibility.ts, so it copies the rule. These pin both to the same
// answers on one table of cases.
describe('parity with shared/project-visibility.ts', () => {
  const RAW: unknown[] = [
    undefined,
    null,
    '',
    '  ',
    'everyone',
    'Everyone',
    ' EVERYONE ',
    'everyone!',
    'restricted',
    'Restricted',
    'team only',
    'false',
    true,
    false,
    0,
    [],
    ['everyone'],
    {},
  ];
  it('parseVisibility', () => {
    for (const raw of RAW)
      expect(projects.parseVisibility(raw), JSON.stringify(raw)).toBe(parseVisibility(raw));
  });

  const TEXTS = [
    'visibility: restricted',
    'visibility: everyone',
    'visibility: "everyone"',
    "visibility: 'Restricted'",
    'Visibility: Team',
    'VISIBILITY :restricted',
    'visibility:',
    'visibility: ""',
    'title: x\nvisibility: everyone\nvisibility: restricted',
    'title: x\r\nvisibility: secret\r\n',
    '  visibility: restricted',
    'visibilityx: restricted',
    'title: no line',
  ];
  it('rawTextRestricted', () => {
    for (const t of TEXTS) expect(projects.rawTextRestricted(t), t).toBe(rawTextRestricted(t));
  });

  const NAMES = ["Mary-Jane O'Neil", 'Tess Team', '  Odd  Name ', 'Ünïcode Name', '', 'a.b c'];
  it('slugForms and personSlugs', () => {
    for (const n of NAMES) {
      expect(projects.slugForms(n), n).toEqual(slugForms(n));
      expect(projects.personSlugs({ slug: 'x', name: n }), n).toEqual(personSlugs({ slug: 'x', name: n }));
      expect(projects.personSlugs({ slug: '', name: n }), n).toEqual(personSlugs({ slug: '', name: n }));
    }
    expect(projects.personSlugs({ slug: 'x' })).toEqual(personSlugs({ slug: 'x' }));
  });

  const CARDS: VisibilityCard[] = [];
  for (const space of ['client', 'legacy', 'personal'] as const) {
    for (const visibility of [undefined, 'everyone', 'restricted'] as const) {
      for (const owner of [null, 'tess-team', 'mary-jane-oneil']) {
        for (const team of [[], ['mary-jane-o-neil'], ['terry-team', 'tess-team']]) {
          CARDS.push({ space, ...(visibility ? { visibility } : {}), owner, team });
        }
      }
    }
  }
  const VIEWERS: ProjectViewer[] = [];
  for (const [name, slug] of [
    ['Tess Team', 'tess-team'],
    ["Mary-Jane O'Neil", 'mary-jane-oneil'],
    ['Terry Team', 'terry-team'],
    ['', ''],
  ]) {
    for (const role of ['owner', 'scout', 'team', 'unknown'] as const) {
      for (const knownMember of [true, false])
        VIEWERS.push({ name: name as string, slug: slug as string, role, knownMember });
    }
  }
  it('onProject, seesEveryProject, isRestricted and canSeeProject', () => {
    for (const card of CARDS) {
      expect(projects.isRestricted(card), JSON.stringify(card)).toBe(isRestricted(card));
      for (const v of VIEWERS) {
        const at = `${JSON.stringify(card)} ${JSON.stringify(v)}`;
        expect(projects.onProject(card, v), at).toBe(onProject(card, v));
        expect(projects.canSeeProject(card, v), at).toBe(canSeeProject(card, v));
      }
    }
    for (const v of VIEWERS) expect(projects.seesEveryProject(v)).toBe(seesEveryProject(v));
  });

  // The script reads a card the way the app will (contract S5): parseVisibility on the parsed value, OR
  // rawTextRestricted on the frontmatter block.
  const CARD_TEXTS = [
    'title: A',
    'title: A\nvisibility: restricted',
    'title: A\nvisibility: everyone',
    'title: A\nvisibility: Everyone ',
    'title: A\nvisibility:',
    'title: A\nvisibility:\n  everyone',
    'title: A\nvisibility:\n  secret',
    'title: A\nvisibility:\n  - "everyone"',
    'title: A\nvisibility: []',
    'title: A\nvisibility: [everyone]',
    'title: A\nvisibility: >\n  everyone',
    'title: A\nvisibility: ~',
    'title: A\nVisibility: restricted',
    'title: A\nvisibility: everyone\nvisibility: restricted',
    'title: A\nvisibility: restricted\nvisibility: everyone',
    "title: A\nvisibility: 'everyone'",
  ];
  it('reads a card as the app does', () => {
    for (const fm of CARD_TEXTS) {
      const text = `---\n${fm}\nowner: tess-team\nteam:\n  - "terry-team"\n---\n\nBrief.\n`;
      const appSays =
        parseVisibility(parseFrontmatter(text).data.visibility) === 'restricted' || rawTextRestricted(fm);
      const card = projects.readCardAccess('client', text);
      expect(card.visibility === 'restricted', fm).toBe(appSays);
      expect(card).toMatchObject({ space: 'client', owner: 'tess-team', team: ['terry-team'] });
      expect(projects.isRestricted(projects.readCardAccess('personal', text)), fm).toBe(false);
    }
  });

  it('reads a card it cannot parse as restricted with nobody on it when it has the line', () => {
    const conflict =
      '---\nv: 1\ntitle: A\n<<<<<<< ours\nvisibility: restricted\n=======\nteam:\n  - "terry-team"\n>>>>>>> theirs\n---\n';
    expect(projects.readCardAccess('client', conflict)).toEqual({
      space: 'client',
      visibility: 'restricted',
      owner: null,
      team: [],
    });
    expect(projects.readCardAccess('client', conflict.replace('restricted', 'everyone')).visibility).toBe(
      'everyone',
    );
  });
});
