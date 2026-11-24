// Tests for the brain's `tdsapp-projects` skill script (plan docs/plans/2026-11-20-projects-system.md,
// decisions 1-4b, 8, 9 and 27). Most cases call the script's exported `run` in this process with an
// injected brain root, home folder and clock; a few run it as a child process to pin the command line.
// Every brain is a throwaway temp folder with `git init`. This test stays in the app repo; copy the
// skill into the brain without `test/`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../../server/brain/frontmatter.ts';
import {
  DISMISSED_DAYS,
  DRAFT_MAX_AGE_DAYS,
  EMAIL_DRAFT_FILE_PATTERN,
  EMAIL_DRAFTS_DIR,
  EMAIL_KEYS_SUBDIR,
  EMAIL_NAME_MAX,
  EMAIL_NEWEST_TEXT_MAX,
  EMAIL_PEOPLE_MAX,
  EMAIL_PERSON_MAX,
  EMAIL_SUBJECT_MAX,
  EMAIL_THREAD_IDS_MAX,
  emailDismissedFile,
  MESSAGE_ID_MAX,
  PROJECTS_EMAIL_CAPABILITY,
} from '../../../shared/project-email-contract.ts';
import { PROJECTS_REFS_CAPABILITY } from '../../../shared/project-refs-contract.ts';
import {
  PROJECTS_UPDATES_CAPABILITY,
  UPDATE_FILE_PATTERN,
  UPDATE_SUMMARY_MAX,
  UPDATES_DIR,
} from '../../../shared/project-updates-contract.ts';
import {
  archivedFolderPath,
  LINKED_FILE_ROOTS,
  movedFolderPath,
  parseLinkedFiles,
  splitLinkedFiles,
} from '../../../shared/projects.ts';
import {
  INTERNAL_CLIENT,
  INTERNAL_PRECEDENCE,
  PROJECT_BRIEF_MAX,
  PROJECT_CARD_FILE,
  PROJECT_KEY_SEGMENT_MAX,
  PROJECT_LINKS_MAX,
  PROJECT_MOVED_FROM_MAX,
  PROJECT_SLUG_MAX,
  PROJECT_STAGE_MAX,
  PROJECT_STAGES_MAX,
  PROJECT_TEAM_MAX,
  PROJECT_TITLE_MAX,
  PROJECTS_ARCHIVE_CAPABILITY,
  PROJECTS_CAPABILITY,
  PROJECTS_MOVE_CAPABILITY,
} from '../../../shared/projects-contract.ts';

const SCRIPT = fileURLToPath(new URL('../scripts/tdsapp-projects.cjs', import.meta.url));

type Reply = {
  ok: boolean;
  error?: string;
  message?: string;
  key?: string;
  version?: string;
  [k: string]: unknown;
};
interface Ctx {
  root: string;
  home: string;
  now: Date;
  /** Test only: stands in for the folder rename. */
  renameDir?: (from: string, to: string) => void;
  /** Test only: stands in for the recursive remove of a deleted project's hidden folder. */
  removeDir?: (dir: string) => void;
  /** Test only: stands in for an update file name's random six characters. */
  updateSuffix?: () => string;
  /** Test only, in-process: the approve keys folder (else the Mac account's TDS Brain data folder). */
  keysDir?: string;
}
interface ProjectsModule {
  run(action: string, input: unknown, ctx: Ctx): { exit: number; reply: Reply };
  EMAIL_KEYS_SUBDIR: string;
  emailKeysDir(ctx: Partial<Ctx>): string;
  SCRIPT_VERSION: string;
  PROJECTS_CAPABILITY: string;
  PROJECTS_MOVE_CAPABILITY: string;
  PROJECTS_ARCHIVE_CAPABILITY: string;
  PROJECTS_UPDATES_CAPABILITY: string;
  PROJECTS_EMAIL_CAPABILITY: string;
  EMAIL: Record<string, number | string>;
  EMAIL_DRAFT_FILE_PATTERN: RegExp;
  UPDATES_DIR: string;
  UPDATE_FILE_PATTERN: RegExp;
  UPDATE_SUMMARY_MAX: number;
  PROJECT_MOVED_FROM_MAX: number;
  INTERNAL_CLIENT: string;
  INTERNAL_PRECEDENCE: string[];
  PROJECT_CARD_FILE: string;
  LIMITS: Record<string, number>;
  LINK_ROOTS: string[];
}

const require = createRequire(import.meta.url);
const projects = require('../scripts/tdsapp-projects.cjs') as ProjectsModule;

const ROLES = {
  members: [
    { name: 'Olive Owner', email: 'olive@example.test', role: 'owner' },
    { name: 'Sam Example', email: 'sam@example.test', role: 'scout' },
    { name: 'Tess Team', email: 'tess@example.test', role: 'team' },
    { name: 'Terry Team', email: 'terry@example.test', role: 'team' },
  ],
};
const T0 = new Date('2026-11-20T10:20:30.000Z');

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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'projects-brain-'));
  home = mkdtempSync(join(tmpdir(), 'projects-home-'));
  git(['init', '-q']);
  git(['config', 'user.email', 'sam@example.test']);
  mkdirSync(join(root, '.team-config'));
  writeFileSync(join(root, '.team-config', 'roles.json'), JSON.stringify(ROLES));
  writeFileSync(join(root, '.gitignore'), 'personal/\n');
  for (const c of ['acme', 'skyseal', INTERNAL_CLIENT])
    mkdirSync(join(root, 'clients', c), { recursive: true });
});

afterEach(() => {
  for (const dir of [root, home]) rmSync(dir, { recursive: true, force: true });
});

const abs = (rel: string) => join(root, ...rel.split('/'));
function put(rel: string, text: string | Buffer = 'hello') {
  mkdirSync(dirname(abs(rel)), { recursive: true });
  writeFileSync(abs(rel), text);
}
const read = (rel: string) => readFileSync(abs(rel), 'utf8');
const sha = (rel: string) =>
  createHash('sha256')
    .update(readFileSync(abs(rel)))
    .digest('hex');
const call = (action: string, input: Record<string, unknown> = {}) =>
  projects.run(action, input, { root, home, now: T0, keysDir: join(home, 'email-keys') });
const refusal = (r: { exit: number; reply: Reply }) => ({ exit: r.exit, error: r.reply.error });

function create(slug: string, fields: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return call('create', {
    kind: 'create',
    space: 'client',
    client: 'acme',
    slug,
    fields: { title: 'Website rebuild', ...fields },
    ...extra,
  });
}
const CARD = 'clients/acme/projects/website/project.md';

describe('create', () => {
  it('writes a flat card in field order, stamped with who from git, and answers its key and version', () => {
    const r = create('website', {
      kind: 'one-off',
      status: 'active',
      health: 'green',
      comms: 'amber',
      owner: 'olive-owner',
      team: ['tess-team', 'sam-example'],
      service: ['ppc', 'seo'],
      start: '2026-11-20',
      end: '2027-02-28',
      budgetHours: 40,
      billable: true,
      stages: ['Discovery', 'Build, then test'],
      brief: 'Rebuild the site.\n\nIn two phases.',
    });
    expect(r).toEqual({
      exit: 0,
      reply: { ok: true, action: 'create', key: 'acme/website', version: sha(CARD) },
    });
    expect(read(CARD)).toBe(
      [
        '---',
        'v: 1',
        'title: Website rebuild',
        'client: acme',
        'kind: one-off',
        'status: active',
        'health: green',
        'comms: amber',
        'owner: olive-owner',
        'team:',
        '  - "tess-team"',
        '  - "sam-example"',
        'service:',
        '  - "ppc"',
        '  - "seo"',
        'start: 2026-11-20',
        'end: 2027-02-28',
        'budget_hours: 40',
        'billable: true',
        'stages:',
        '  - "Discovery"',
        '  - "Build, then test"',
        'created: 2026-11-20',
        'created_by: sam-example',
        '---',
        '',
        'Rebuild the site.',
        '',
        'In two phases.',
        '',
      ].join('\n'),
    );
    // The app's frontmatter reader takes it as text and lists of text.
    expect(parseFrontmatter(read(CARD)).data).toMatchObject({
      title: 'Website rebuild',
      team: ['tess-team', 'sam-example'],
      stages: ['Discovery', 'Build, then test'],
      budget_hours: '40',
      billable: 'true',
    });
  });

  it('leaves empty fields out and defaults the status to active', () => {
    expect(create('website', { health: null, team: [], brief: '' }).exit).toBe(0);
    expect(read(CARD)).toBe(
      '---\nv: 1\ntitle: Website rebuild\nclient: acme\nstatus: active\ncreated: 2026-11-20\ncreated_by: sam-example\n---\n',
    );
  });

  it('quotes a title YAML would misread', () => {
    expect(create('website', { title: 'Phase 2: launch' }).exit).toBe(0);
    expect(read(CARD)).toContain('\ntitle: "Phase 2: launch"\n');
    expect(parseFrontmatter(read(CARD)).data.title).toBe('Phase 2: launch');
  });

  it('refuses a bad slug', () => {
    for (const slug of [
      'Website',
      'web site',
      'web--site',
      '-web',
      '',
      'a'.repeat(PROJECT_SLUG_MAX + 1),
      7,
    ]) {
      expect(refusal(create(slug as string)), String(slug)).toEqual({ exit: 2, error: 'bad-request' });
    }
    expect(existsSync(abs('clients/acme/projects'))).toBe(false);
  });

  it('refuses a clash, never overwriting', () => {
    expect(create('website').exit).toBe(0);
    const before = read(CARD);
    expect(refusal(create('website', { title: 'Another' }))).toEqual({ exit: 2, error: 'exists' });
    expect(read(CARD)).toBe(before);
    // A folder with no card is a project too.
    mkdirSync(abs('clients/acme/projects/cardless'), { recursive: true });
    expect(refusal(create('cardless'))).toEqual({ exit: 2, error: 'exists' });
    // An archived client's project of the same slug.
    mkdirSync(abs('clients/_archive/acme/projects/old-site'), { recursive: true });
    expect(refusal(create('old-site'))).toEqual({ exit: 2, error: 'exists' });
  });

  it('refuses an internal slug already used in projects/ or projects-archive/ (INTERNAL_PRECEDENCE)', () => {
    mkdirSync(abs('projects/client-portal'), { recursive: true });
    mkdirSync(abs('projects-archive/old-funnel'), { recursive: true });
    const internal = (slug: string) => create(slug, {}, { client: INTERNAL_CLIENT });
    expect(refusal(internal('client-portal'))).toEqual({ exit: 2, error: 'exists' });
    expect(refusal(internal('old-funnel'))).toEqual({ exit: 2, error: 'exists' });
    expect(internal('new-thing').reply).toMatchObject({ ok: true, key: `${INTERNAL_CLIENT}/new-thing` });
    expect(existsSync(abs(`clients/${INTERNAL_CLIENT}/projects/new-thing/project.md`))).toBe(true);
    // Another client may use the same slug.
    expect(create('client-portal').exit).toBe(0);
  });

  it('refuses end before start, and an end on an ongoing project', () => {
    expect(refusal(create('website', { start: '2026-11-20', end: '2026-11-19' }))).toEqual({
      exit: 2,
      error: 'bad-request',
    });
    expect(refusal(create('website', { kind: 'ongoing', end: '2027-01-01' }))).toEqual({
      exit: 2,
      error: 'bad-request',
    });
    expect(refusal(create('website', { start: '2026-02-30' }))).toEqual({ exit: 2, error: 'bad-request' });
    expect(create('website', { start: '2026-11-20', end: '2026-11-20' }).exit).toBe(0);
  });

  it('checks every field against the contract limits', () => {
    const bad: Record<string, unknown>[] = [
      { title: '' },
      { title: 'x'.repeat(PROJECT_TITLE_MAX + 1) },
      { title: 'two\nlines' },
      { kind: 'retainer' },
      { status: 'closed' },
      { health: 'blue' },
      { owner: 'nobody-here' },
      { team: ['tess-team', 'tess-team'] },
      { team: Array.from({ length: PROJECT_TEAM_MAX + 1 }, (_, i) => `p${i}`) },
      { service: ['PPC'] },
      { budgetHours: -1 },
      { budgetHours: 100_001 },
      { budgetHours: '40' },
      { billable: 'yes' },
      { stages: ['A', 'a'] },
      { stages: ['x'.repeat(PROJECT_STAGE_MAX + 1)] },
      { stages: Array.from({ length: PROJECT_STAGES_MAX + 1 }, (_, i) => `S${i}`) },
      { stages: ['Both " and \''] },
      { brief: 'x'.repeat(PROJECT_BRIEF_MAX + 1) },
      { brief: 'Brief\n\n## Linked files\n\n- [a](../a.pdf)' },
    ];
    for (const fields of bad) {
      expect(refusal(create('website', fields)), JSON.stringify(fields).slice(0, 80)).toEqual({
        exit: 2,
        error: 'bad-request',
      });
    }
    expect(existsSync(abs('clients/acme/projects'))).toBe(false);
  });

  it('refuses a client folder that is missing, a link, or named personal', () => {
    expect(refusal(create('website', {}, { client: 'nobody' }))).toEqual({ exit: 2, error: 'not-found' });
    expect(refusal(create('website', {}, { client: 'personal' }))).toEqual({ exit: 2, error: 'bad-request' });
    expect(refusal(create('website', {}, { client: '_archive' }))).toEqual({ exit: 2, error: 'bad-request' });
    const elsewhere = mkdtempSync(join(tmpdir(), 'projects-elsewhere-'));
    symlinkSync(elsewhere, abs('clients/linked'));
    expect(refusal(create('website', {}, { client: 'linked' }))).toEqual({ exit: 2, error: 'not-allowed' });
    expect(readdirSync(elsewhere)).toEqual([]);
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it('refuses someone not on the team for a shared project', () => {
    git(['config', 'user.email', 'stranger@example.test']);
    expect(refusal(create('website'))).toEqual({ exit: 2, error: 'not-allowed' });
  });

  it('makes a personal project with no client line, only where git ignores it', () => {
    const r = call('create', { kind: 'create', space: 'personal', slug: 'jev', fields: { title: 'Jev' } });
    expect(r.reply).toMatchObject({ ok: true, key: 'personal/jev' });
    expect(read('personal/projects/jev/project.md')).toBe(
      '---\nv: 1\ntitle: Jev\nstatus: active\ncreated: 2026-11-20\ncreated_by: sam-example\n---\n',
    );
    writeFileSync(join(root, '.gitignore'), '');
    const r2 = call('create', {
      kind: 'create',
      space: 'personal',
      slug: 'other',
      fields: { title: 'Other' },
    });
    expect(refusal(r2)).toEqual({ exit: 2, error: 'not-allowed' });
    expect(existsSync(abs('personal/projects/other'))).toBe(false);
    // A personal project takes no client.
    expect(
      refusal(
        call('create', {
          kind: 'create',
          space: 'personal',
          client: 'acme',
          slug: 'x',
          fields: { title: 'X' },
        }),
      ),
    ).toEqual({ exit: 2, error: 'bad-request' });
  });
});

const EDITABLE = [
  '---',
  'v: 1',
  'title: Website rebuild',
  'client: acme',
  'status: active',
  'health: green',
  'x_custom: keep me  # exactly',
  'team:',
  '  - "tess-team"',
  'monday_id: 1234567890',
  'created: 2026-11-01',
  'created_by: olive-owner',
  '---',
  '',
  'The brief,  with odd   spacing.',
  '',
  '## Linked files',
  '',
  '- [logo.png](../../../../clients/acme/images/logo.png)',
  '',
  '## Notes by hand',
  '',
  'Kept.',
  '',
].join('\n');

describe('edit', () => {
  beforeEach(() => put(CARD, EDITABLE));
  const edit = (fields: Record<string, unknown>, expect = sha(CARD)) =>
    call('edit', { kind: 'edit', key: 'acme/website', fields, expect });

  it('changes only the fields sent, keeping unknown keys and the body byte for byte', () => {
    const r = edit({ title: 'New site', health: null, comms: 'red', team: ['sam-example'] });
    expect(r).toEqual({
      exit: 0,
      reply: { ok: true, action: 'edit', key: 'acme/website', version: sha(CARD) },
    });
    expect(read(CARD)).toBe(
      EDITABLE.replace('title: Website rebuild', 'title: New site')
        .replace('health: green\n', 'comms: red\n')
        .replace('  - "tess-team"', '  - "sam-example"'),
    );
  });

  it('replaces the brief and keeps the linked files section', () => {
    expect(edit({ brief: 'A new brief.' }).exit).toBe(0);
    const text = read(CARD);
    expect(text.split('---\n')[1]).toBe(EDITABLE.split('---\n')[1]);
    // The brief is everything but the section, hand-written headings after it included: the form edits it whole.
    expect(splitLinkedFiles(parseFrontmatter(text).body).brief).toBe('A new brief.');
    expect(parseFrontmatter(text).body).toBe(
      '\nA new brief.\n\n## Linked files\n\n- [logo.png](../../../../clients/acme/images/logo.png)\n',
    );
    expect(parseLinkedFiles(parseFrontmatter(text).body)).toEqual(['clients/acme/images/logo.png']);
  });

  it('keeps CRLF line endings and a byte order mark', () => {
    put(CARD, `﻿${EDITABLE.replace(/\n/g, '\r\n')}`);
    expect(edit({ status: 'on-hold' }).exit).toBe(0);
    expect(read(CARD)).toBe(
      `﻿${EDITABLE.replace('status: active', 'status: on-hold').replace(/\n/g, '\r\n')}`,
    );
  });

  it('refuses with changed when expect no longer matches, and needs expect', () => {
    expect(refusal(edit({ status: 'done' }, 'a'.repeat(64)))).toEqual({ exit: 2, error: 'changed' });
    expect(refusal(call('edit', { kind: 'edit', key: 'acme/website', fields: { status: 'done' } }))).toEqual({
      exit: 2,
      error: 'bad-request',
    });
    expect(read(CARD)).toBe(EDITABLE);
  });

  it('checks end against the start already on the card', () => {
    expect(edit({ start: '2026-12-01' }).exit).toBe(0);
    expect(refusal(edit({ end: '2026-11-30' }))).toEqual({ exit: 2, error: 'bad-request' });
  });

  it('writes nothing when nothing changes', () => {
    const version = sha(CARD);
    expect(edit({ status: 'active' }).reply).toMatchObject({ ok: true, version });
    expect(read(CARD)).toBe(EDITABLE);
  });

  it('refuses a card-less project, an unreadable card, an archived project and an unknown key', () => {
    mkdirSync(abs('clients/acme/projects/bare'), { recursive: true });
    expect(
      refusal(call('edit', { kind: 'edit', key: 'acme/bare', fields: {}, expect: 'a'.repeat(64) })),
    ).toEqual({
      exit: 2,
      error: 'not-found',
    });
    put(
      'clients/acme/projects/merge/project.md',
      '---\n<<<<<<< HEAD\ntitle: A\n=======\ntitle: B\n>>>>>>> x\n---\n',
    );
    const v = sha('clients/acme/projects/merge/project.md');
    expect(
      refusal(call('edit', { kind: 'edit', key: 'acme/merge', fields: { title: 'C' }, expect: v })),
    ).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    put('clients/_archive/skyseal/projects/old/project.md', '---\nv: 1\ntitle: Old\nstatus: done\n---\n');
    const v2 = sha('clients/_archive/skyseal/projects/old/project.md');
    expect(
      refusal(call('edit', { kind: 'edit', key: 'skyseal/old', fields: { title: 'C' }, expect: v2 })),
    ).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    expect(refusal(call('edit', { kind: 'edit', key: 'acme/nothing', fields: {}, expect: v2 }))).toEqual({
      exit: 2,
      error: 'not-found',
    });
    expect(refusal(call('edit', { kind: 'edit', key: 'Acme/x', fields: {}, expect: v2 }))).toEqual({
      exit: 2,
      error: 'bad-request',
    });
  });

  it('edits a card in a legacy projects/ folder under its internal key', () => {
    put('projects/client-portal/project.md', '---\nv: 1\ntitle: Portal\nstatus: active\n---\n');
    const r = call('edit', {
      kind: 'edit',
      key: `${INTERNAL_CLIENT}/client-portal`,
      fields: { health: 'amber' },
      expect: sha('projects/client-portal/project.md'),
    });
    expect(r.exit).toBe(0);
    expect(read('projects/client-portal/project.md')).toBe(
      '---\nv: 1\ntitle: Portal\nstatus: active\nhealth: amber\n---\n',
    );
  });
});

describe('card', () => {
  it('adds only project.md to a card-less legacy folder, titled from its README', () => {
    put('projects/client-portal/README.md', '# Client Portal — productisation\n\nText.\n');
    put('projects/client-portal/todo.md', '- [ ] a\n');
    const r = call('card', {
      kind: 'card',
      key: `${INTERNAL_CLIENT}/client-portal`,
      fields: { health: 'green' },
    });
    expect(r.reply).toMatchObject({ ok: true, key: `${INTERNAL_CLIENT}/client-portal` });
    expect(readdirSync(abs('projects/client-portal')).sort()).toEqual(['README.md', 'project.md', 'todo.md']);
    expect(read('projects/client-portal/README.md')).toBe('# Client Portal — productisation\n\nText.\n');
    expect(read('projects/client-portal/project.md')).toBe(
      [
        '---',
        'v: 1',
        'title: Client Portal — productisation',
        `client: ${INTERNAL_CLIENT}`,
        'status: active',
        'health: green',
        'created: 2026-11-20',
        'created_by: sam-example',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('titles from the folder name when there is no README, and takes a sent title first', () => {
    mkdirSync(abs('clients/acme/projects/brand-refresh'), { recursive: true });
    expect(call('card', { kind: 'card', key: 'acme/brand-refresh', fields: {} }).exit).toBe(0);
    expect(read('clients/acme/projects/brand-refresh/project.md')).toContain(
      '\ntitle: Brand refresh\nclient: acme\n',
    );
    mkdirSync(abs('personal/projects/jev'), { recursive: true });
    expect(call('card', { kind: 'card', key: 'personal/jev', fields: { title: 'Jev the bot' } }).exit).toBe(
      0,
    );
    expect(read('personal/projects/jev/project.md')).toContain('\ntitle: Jev the bot\nstatus: active\n');
  });

  it('refuses when a card is already there, the folder is missing, or it is archived', () => {
    put(CARD, EDITABLE);
    expect(refusal(call('card', { kind: 'card', key: 'acme/website', fields: {} }))).toEqual({
      exit: 2,
      error: 'exists',
    });
    expect(read(CARD)).toBe(EDITABLE);
    expect(refusal(call('card', { kind: 'card', key: 'acme/none', fields: {} }))).toEqual({
      exit: 2,
      error: 'not-found',
    });
    mkdirSync(abs('projects-archive/old-funnel'), { recursive: true });
    expect(refusal(call('card', { kind: 'card', key: `${INTERNAL_CLIENT}/old-funnel`, fields: {} }))).toEqual(
      {
        exit: 2,
        error: 'not-allowed',
      },
    );
  });

  it('follows INTERNAL_PRECEDENCE: the TDS client folder shadows projects/', () => {
    mkdirSync(abs(`clients/${INTERNAL_CLIENT}/projects/portal`), { recursive: true });
    mkdirSync(abs('projects/portal'), { recursive: true });
    expect(call('card', { kind: 'card', key: `${INTERNAL_CLIENT}/portal`, fields: {} }).exit).toBe(0);
    expect(existsSync(abs(`clients/${INTERNAL_CLIENT}/projects/portal/project.md`))).toBe(true);
    expect(existsSync(abs('projects/portal/project.md'))).toBe(false);
  });
});

describe('link and unlink', () => {
  beforeEach(() => {
    put(CARD, '---\nv: 1\ntitle: Website rebuild\nclient: acme\nstatus: active\n---\n\nThe brief.\n');
    put('clients/acme/files/quote.pdf');
    put('clients/acme/images/My logo.png');
    put('projects/client-portal/spec.md');
    put('personal/files/notes.pdf');
  });
  const link = (path: string, kind = 'link', key = 'acme/website', rel = CARD) =>
    call(kind, { kind, key, path, expect: sha(rel) });

  it('adds a ## Linked files section after the brief, relative to the card', () => {
    expect(link('clients/acme/files/quote.pdf').exit).toBe(0);
    expect(link('clients/acme/images/My logo.png').exit).toBe(0);
    expect(link('projects/client-portal/spec.md').exit).toBe(0);
    expect(read(CARD)).toBe(
      [
        '---',
        'v: 1',
        'title: Website rebuild',
        'client: acme',
        'status: active',
        '---',
        '',
        'The brief.',
        '',
        '## Linked files',
        '',
        '- [quote.pdf](../../../../clients/acme/files/quote.pdf)',
        '- [My logo.png](<../../../../clients/acme/images/My logo.png>)',
        '- [spec.md](../../../../projects/client-portal/spec.md)',
        '',
      ].join('\n'),
    );
    expect(parseLinkedFiles(parseFrontmatter(read(CARD)).body)).toEqual([
      'clients/acme/files/quote.pdf',
      'clients/acme/images/My logo.png',
      'projects/client-portal/spec.md',
    ]);
  });

  it('is a no-op for a file already linked, and unlink drops the emptied section', () => {
    link('clients/acme/files/quote.pdf');
    const once = read(CARD);
    expect(link('clients/acme/files/quote.pdf').reply).toMatchObject({ ok: true, version: sha(CARD) });
    expect(read(CARD)).toBe(once);
    expect(link('clients/acme/files/quote.pdf', 'unlink').exit).toBe(0);
    expect(read(CARD)).toBe(
      '---\nv: 1\ntitle: Website rebuild\nclient: acme\nstatus: active\n---\n\nThe brief.\n',
    );
    expect(link('clients/acme/files/quote.pdf', 'unlink').exit).toBe(0);
  });

  it('refuses a personal/ file on a shared project (privacy rule), but not on a personal one', () => {
    expect(refusal(link('personal/files/notes.pdf'))).toEqual({ exit: 2, error: 'not-allowed' });
    expect(read(CARD)).not.toContain('notes.pdf');
    put('personal/projects/jev/project.md', '---\nv: 1\ntitle: Jev\nstatus: active\n---\n');
    const rel = 'personal/projects/jev/project.md';
    expect(link('personal/files/notes.pdf', 'link', 'personal/jev', rel).exit).toBe(0);
    expect(read(rel)).toContain('- [notes.pdf](../../../personal/files/notes.pdf)');
  });

  it('refuses a missing file, a folder, a link, a never-listed place and other types', () => {
    put('clients/acme/files/run.sh');
    put('clients/acme/config/a.pdf');
    symlinkSync(abs('clients/acme/files/quote.pdf'), abs('clients/acme/files/alias.pdf'));
    for (const path of [
      'clients/acme/files/none.pdf',
      'clients/acme/files',
      'clients/acme/files/alias.pdf',
      'clients/acme/config/a.pdf',
      'clients/acme/files/run.sh',
      'todo/a.md',
      '../outside.pdf',
      'clients/acme/../acme/files/quote.pdf',
    ]) {
      expect(refusal(link(path)), path).toEqual({ exit: 2, error: 'bad-request' });
    }
    expect(read(CARD)).not.toContain('Linked files');
  });

  it(`refuses more than ${PROJECT_LINKS_MAX} links`, () => {
    const lines = Array.from(
      { length: PROJECT_LINKS_MAX },
      (_, i) => `- [f${i}.pdf](../../../../clients/acme/files/f${i}.pdf)`,
    );
    put(CARD, `---\nv: 1\ntitle: W\nstatus: active\n---\n\n## Linked files\n\n${lines.join('\n')}\n`);
    expect(refusal(link('clients/acme/files/quote.pdf'))).toEqual({ exit: 2, error: 'bad-request' });
  });

  it('refuses with changed when expect no longer matches', () => {
    expect(
      refusal(
        call('link', {
          kind: 'link',
          key: 'acme/website',
          path: 'clients/acme/files/quote.pdf',
          expect: 'b'.repeat(64),
        }),
      ),
    ).toEqual({
      exit: 2,
      error: 'changed',
    });
  });
});

describe('capabilities and the command line', () => {
  it('answers capabilities', () => {
    expect(call('capabilities')).toEqual({
      exit: 0,
      reply: {
        ok: true,
        action: 'capabilities',
        version: projects.SCRIPT_VERSION,
        features: [
          PROJECTS_CAPABILITY,
          PROJECTS_MOVE_CAPABILITY,
          PROJECTS_ARCHIVE_CAPABILITY,
          PROJECTS_UPDATES_CAPABILITY,
          PROJECTS_REFS_CAPABILITY,
          PROJECTS_EMAIL_CAPABILITY,
        ],
      },
    });
    expect(projects.SCRIPT_VERSION).toBe('0.6.0');
  });

  it('runs from the command line: one JSON line, exit 0, 2 and 1', () => {
    const cli = (action: string, input: string) =>
      spawnSync(process.execPath, [SCRIPT, action], {
        input,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: home, BRAIN_ROOT: root, GIT_CONFIG_NOSYSTEM: '1' },
      });
    const ok = cli(
      'create',
      JSON.stringify({
        kind: 'create',
        space: 'client',
        client: 'acme',
        slug: 'site',
        fields: { title: 'Site' },
      }),
    );
    expect(ok.status).toBe(0);
    expect(ok.stdout.split('\n').filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(ok.stdout)).toMatchObject({ ok: true, key: 'acme/site' });
    const clash = cli(
      'create',
      JSON.stringify({
        kind: 'create',
        space: 'client',
        client: 'acme',
        slug: 'site',
        fields: { title: 'Site' },
      }),
    );
    expect(clash.status).toBe(2);
    expect(JSON.parse(clash.stdout)).toMatchObject({ ok: false, error: 'exists' });
    for (const [action, input] of [
      ['create', 'not json'],
      ['create', '[1]'],
      ['rename', '{}'],
      ['edit', JSON.stringify({ kind: 'create' })],
    ]) {
      const r = cli(action as string, input as string);
      expect(r.status, `${action} ${input}`).toBe(2);
      expect(JSON.parse(r.stdout).error).toBe('bad-request');
    }
  });
});

describe('constants', () => {
  it('match the contract', () => {
    expect(projects.PROJECTS_CAPABILITY).toBe(PROJECTS_CAPABILITY);
    expect(projects.PROJECTS_MOVE_CAPABILITY).toBe(PROJECTS_MOVE_CAPABILITY);
    expect(projects.PROJECTS_ARCHIVE_CAPABILITY).toBe(PROJECTS_ARCHIVE_CAPABILITY);
    expect(projects.PROJECTS_UPDATES_CAPABILITY).toBe(PROJECTS_UPDATES_CAPABILITY);
    expect(projects.PROJECTS_EMAIL_CAPABILITY).toBe(PROJECTS_EMAIL_CAPABILITY);
    expect(projects.EMAIL_DRAFT_FILE_PATTERN.source).toBe(EMAIL_DRAFT_FILE_PATTERN.source);
    expect(projects.EMAIL_KEYS_SUBDIR).toBe(EMAIL_KEYS_SUBDIR);
    expect(projects.EMAIL).toEqual({
      EMAIL_DRAFTS_DIR,
      DISMISSED_DAYS,
      DRAFT_MAX_AGE_DAYS,
      EMAIL_SUBJECT_MAX,
      EMAIL_PERSON_MAX,
      EMAIL_PEOPLE_MAX,
      EMAIL_THREAD_IDS_MAX,
      EMAIL_NEWEST_TEXT_MAX,
      MESSAGE_ID_MAX,
      EMAIL_NAME_MAX,
    });
    expect(projects.UPDATES_DIR).toBe(UPDATES_DIR);
    expect(projects.UPDATE_FILE_PATTERN.source).toBe(UPDATE_FILE_PATTERN.source);
    expect(projects.UPDATE_SUMMARY_MAX).toBe(UPDATE_SUMMARY_MAX);
    expect(projects.PROJECT_MOVED_FROM_MAX).toBe(PROJECT_MOVED_FROM_MAX);
    expect(projects.INTERNAL_CLIENT).toBe(INTERNAL_CLIENT);
    expect(projects.INTERNAL_PRECEDENCE).toEqual([...INTERNAL_PRECEDENCE]);
    expect(projects.PROJECT_CARD_FILE).toBe(PROJECT_CARD_FILE);
    expect(projects.LINK_ROOTS).toEqual([...LINKED_FILE_ROOTS]);
    expect(projects.LIMITS).toEqual({
      PROJECT_SLUG_MAX,
      PROJECT_KEY_SEGMENT_MAX,
      PROJECT_TITLE_MAX,
      PROJECT_BRIEF_MAX,
      PROJECT_STAGES_MAX,
      PROJECT_STAGE_MAX,
      PROJECT_TEAM_MAX,
      PROJECT_BUDGET_MAX_HOURS: 100_000,
      PROJECT_LINKS_MAX,
    });
  });
});

describe('the skill file', () => {
  it('is the script version for the whole team, with USE WHEN triggers, matching the script', () => {
    const skill = parseFrontmatter(
      readFileSync(fileURLToPath(new URL('../SKILL.md', import.meta.url)), 'utf8'),
    ).data;
    expect(skill).toMatchObject({
      name: 'tdsapp-projects',
      version: projects.SCRIPT_VERSION,
      roles: 'owner, scout, team',
      maturity: 'draft',
      members: 'false',
      agency: 'true',
    });
    expect(skill.description).toContain('USE WHEN');
  });
});

// Review fixes (release 1): merge-conflict detection, backslashes in quoted values, and the order of
// the checks before a write.
describe('review fixes', () => {
  it('keeps a card with a ======= divider in its brief editable, but not one with a full conflict', () => {
    const divided =
      '---\nv: 1\ntitle: Website rebuild\nclient: acme\nstatus: active\n---\n\nPart one\n=======\nPart two\n';
    put(CARD, divided);
    expect(
      call('edit', { kind: 'edit', key: 'acme/website', fields: { status: 'done' }, expect: sha(CARD) }).exit,
    ).toBe(0);
    expect(read(CARD)).toBe(divided.replace('status: active', 'status: done'));
    put(CARD, `${divided}<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> main\n`);
    expect(
      refusal(
        call('edit', { kind: 'edit', key: 'acme/website', fields: { status: 'done' }, expect: sha(CARD) }),
      ),
    ).toEqual({ exit: 2, error: 'not-allowed' });
  });

  it('writes a brief with a ======= divider, and refuses one holding a whole conflict', () => {
    expect(create('website', { brief: 'Part one\n=======\nPart two' }).exit).toBe(0);
    expect(
      call('edit', { kind: 'edit', key: 'acme/website', fields: { status: 'done' }, expect: sha(CARD) }).exit,
    ).toBe(0);
    expect(refusal(create('other', { brief: '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> main' }))).toEqual({
      exit: 2,
      error: 'bad-request',
    });
  });

  it('never double-quotes a value holding a backslash, so it reads back as written', () => {
    expect(create('website', { title: 'Fix: C:\\temp', stages: ['C:\\build'] }).exit).toBe(0);
    const text = read(CARD);
    expect(text).toContain("\ntitle: 'Fix: C:\\temp'\n");
    expect(text).toContain("\n  - 'C:\\build'\n");
    expect(parseFrontmatter(text).data.title).toBe('Fix: C:\\temp');
    expect(parseFrontmatter(text).data.stages).toEqual(['C:\\build']);
  });

  it('checks the writer, the fields and the file before the fingerprint, which comes last', () => {
    put(CARD, EDITABLE);
    put('clients/acme/files/quote.pdf');
    const stale = 'c'.repeat(64);
    expect(
      refusal(call('edit', { kind: 'edit', key: 'acme/website', fields: { status: 'nope' }, expect: stale })),
    ).toEqual({ exit: 2, error: 'bad-request' });
    expect(
      refusal(
        call('link', {
          kind: 'link',
          key: 'acme/website',
          path: 'clients/acme/files/none.pdf',
          expect: stale,
        }),
      ),
    ).toEqual({ exit: 2, error: 'bad-request' });
    git(['config', 'user.email', 'stranger@example.test']);
    git(['config', 'user.name', 'A Stranger']);
    for (const [kind, extra] of [
      ['edit', { fields: { status: 'done' } }],
      ['link', { path: 'clients/acme/files/quote.pdf' }],
      ['unlink', { path: 'clients/acme/files/quote.pdf' }],
    ] as const) {
      expect(refusal(call(kind, { kind, key: 'acme/website', expect: stale, ...extra })), kind).toEqual({
        exit: 2,
        error: 'not-allowed',
      });
    }
    expect(read(CARD)).toBe(EDITABLE);
  });
});

// Move plan (docs/plans/2026-11-21-project-move.md): `move` takes a project's folder to another client.
describe('move', () => {
  const PERSONAL_CARD = 'personal/projects/jev/project.md';
  const JEV = [
    '---',
    'v: 1',
    'title: Jev',
    'status: active',
    'created: 2026-11-01',
    'created_by: sam-example',
    '---',
    '',
    'The brief links [a file](../../../personal/files/keep-as-is.pdf) in prose.',
    '',
    '## Linked files',
    '',
    '- [spec.pdf](../../../personal/projects/jev/spec.pdf)',
    '- [quote.pdf](../../../clients/acme/files/quote.pdf)',
    '* [My notes.md](<../../../personal/projects/jev/sub/My notes.md>)',
    'A line by hand.',
    '',
    '## After',
    '',
    '- [spec.pdf](../../../personal/projects/jev/spec.pdf)',
    '',
  ].join('\n');
  const WEBSITE = EDITABLE.replace(
    '- [logo.png](../../../../clients/acme/images/logo.png)',
    '- [logo.png](../../../../clients/acme/images/logo.png)\n- [brief.pdf](../../../../clients/acme/projects/website/brief.pdf)',
  );
  const move = (key: string, client: string, extra: Record<string, unknown> = {}, rel?: string) =>
    call('move', {
      kind: 'move',
      key,
      client,
      expect: rel ? sha(rel) : 'f'.repeat(64),
      ...extra,
    });
  // The check's fingerprint of the folder's files: SHA-256 of the sorted folder-relative paths, one a line.
  const filesVersion = (files: string[]) =>
    createHash('sha256')
      .update([...files].sort().join('\n'))
      .digest('hex');
  // Every file under a folder, brain-relative, sorted (to show nothing else was written).
  const tree = (rel: string): string[] => {
    if (!existsSync(abs(rel))) return [];
    return readdirSync(abs(rel), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => `${join(e.parentPath, e.name).slice(root.length + 1)}`)
      .sort();
  };

  beforeEach(() => {
    put(PERSONAL_CARD, JEV);
    put('personal/projects/jev/spec.pdf');
    put('personal/projects/jev/sub/My notes.md');
    put('clients/acme/files/quote.pdf');
    put(CARD, WEBSITE);
    put('clients/acme/projects/website/brief.pdf');
  });

  it('checks a personal project first, writing nothing, then moves it to a client', () => {
    const before = { personal: tree('personal'), clients: tree('clients') };
    const check = move('personal/jev', 'skyseal', { check: true }, PERSONAL_CARD);
    expect(check).toEqual({
      exit: 0,
      reply: {
        ok: true,
        action: 'move',
        key: 'skyseal/jev',
        version: sha(PERSONAL_CARD),
        check: {
          key: 'skyseal/jev',
          files: [
            'personal/projects/jev/project.md',
            'personal/projects/jev/spec.pdf',
            'personal/projects/jev/sub/My notes.md',
          ],
          fileCount: 3,
          ignoredCount: 0,
          personalLinks: [],
          filesVersion: filesVersion(['project.md', 'spec.pdf', 'sub/My notes.md']),
        },
      },
    });
    expect({ personal: tree('personal'), clients: tree('clients') }).toEqual(before);
    expect(existsSync(abs('clients/skyseal/projects'))).toBe(false);

    const r = move('personal/jev', 'skyseal', {}, PERSONAL_CARD);
    const moved = 'clients/skyseal/projects/jev/project.md';
    expect(r).toEqual({
      exit: 0,
      reply: { ok: true, action: 'move', key: 'skyseal/jev', version: sha(moved) },
    });
    expect(existsSync(abs('personal/projects/jev'))).toBe(false);
    expect(tree('clients/skyseal')).toEqual([
      'clients/skyseal/projects/jev/project.md',
      'clients/skyseal/projects/jev/spec.pdf',
      'clients/skyseal/projects/jev/sub/My notes.md',
    ]);
    // moved_from added; every recognised link line one folder deeper, those inside the folder following
    // it; the brief, hand-written lines and later sections byte for byte; a client line added after the title.
    expect(read(moved)).toBe(
      JEV.replace('title: Jev\n', 'title: Jev\nclient: skyseal\n')
        .replace('created_by: sam-example\n', 'created_by: sam-example\nmoved_from:\n  - "personal/jev"\n')
        .replace(
          '- [spec.pdf](../../../personal/projects/jev/spec.pdf)\n- [quote.pdf](../../../clients/acme/files/quote.pdf)\n* [My notes.md](<../../../personal/projects/jev/sub/My notes.md>)',
          '- [spec.pdf](../../../../clients/skyseal/projects/jev/spec.pdf)\n- [quote.pdf](../../../../clients/acme/files/quote.pdf)\n* [My notes.md](<../../../../clients/skyseal/projects/jev/sub/My notes.md>)',
        ),
    );
    expect(parseFrontmatter(read(moved)).data.moved_from).toEqual(['personal/jev']);
    expect(parseLinkedFiles(parseFrontmatter(read(moved)).body)).toEqual([
      'clients/skyseal/projects/jev/spec.pdf',
      'clients/acme/files/quote.pdf',
      'clients/skyseal/projects/jev/sub/My notes.md',
    ]);
  });

  it('refuses with changed when the files differ from the ones checked (filesExpect), writing nothing', () => {
    writeFileSync(join(root, '.gitignore'), 'personal/\n*.mov\n');
    put('personal/projects/jev/video.mov');
    const check = move('personal/jev', 'skyseal', { check: true }, PERSONAL_CARD);
    const seen = (check.reply.check as { filesVersion: string }).filesVersion;
    // Ignored files count too: they move with the folder.
    expect(seen).toBe(filesVersion(['project.md', 'spec.pdf', 'sub/My notes.md', 'video.mov']));
    // A file saved into the folder after the check.
    put('personal/projects/jev/secret.txt');
    const before = { personal: tree('personal'), clients: tree('clients') };
    const r = move('personal/jev', 'skyseal', { filesExpect: seen }, PERSONAL_CARD);
    expect(refusal(r)).toEqual({ exit: 2, error: 'changed' });
    expect(r.reply.message).toMatch(/^the files in this project changed since you checked/);
    expect(
      refusal(move('personal/jev', 'skyseal', { filesExpect: seen, check: true }, PERSONAL_CARD)),
    ).toEqual({
      exit: 2,
      error: 'changed',
    });
    expect({ personal: tree('personal'), clients: tree('clients') }).toEqual(before);
    // A malformed fingerprint is a bad request.
    for (const bad of ['nope', 'F'.repeat(64), 5, null]) {
      expect(
        refusal(move('personal/jev', 'skyseal', { filesExpect: bad }, PERSONAL_CARD)),
        String(bad),
      ).toEqual({
        exit: 2,
        error: 'bad-request',
      });
    }
    // Checked again, it moves.
    const again = move('personal/jev', 'skyseal', { check: true }, PERSONAL_CARD);
    const now = (again.reply.check as { filesVersion: string }).filesVersion;
    expect(now).not.toBe(seen);
    expect(move('personal/jev', 'skyseal', { filesExpect: now }, PERSONAL_CARD).reply).toMatchObject({
      ok: true,
      key: 'skyseal/jev',
    });
    expect(existsSync(abs('clients/skyseal/projects/jev/secret.txt'))).toBe(true);
  });

  it('moves a client project to another client, setting its client line and keeping everything else', () => {
    const r = move('acme/website', 'skyseal', {}, CARD);
    const moved = 'clients/skyseal/projects/website/project.md';
    expect(r.reply).toEqual({ ok: true, action: 'move', key: 'skyseal/website', version: sha(moved) });
    expect(existsSync(abs('clients/acme/projects/website'))).toBe(false);
    expect(existsSync(abs('clients/skyseal/projects/website/brief.pdf'))).toBe(true);
    expect(read(moved)).toBe(
      WEBSITE.replace('client: acme', 'client: skyseal')
        .replace('created_by: olive-owner\n', 'created_by: olive-owner\nmoved_from:\n  - "acme/website"\n')
        .replace(
          '(../../../../clients/acme/projects/website/brief.pdf)',
          '(../../../../clients/skyseal/projects/website/brief.pdf)',
        ),
    );
    // And back again: its own key leaves moved_from, which never names the card's own key.
    const back = move('skyseal/website', 'acme', {}, moved);
    expect(back.reply).toMatchObject({ ok: true, key: 'acme/website' });
    expect(parseFrontmatter(read(CARD)).data.moved_from).toEqual(['skyseal/website']);
  });

  it(`keeps moved_from deduped, newest last, at most ${PROJECT_MOVED_FROM_MAX}`, () => {
    const keys = Array.from({ length: PROJECT_MOVED_FROM_MAX }, (_, i) => `old-${i}/website`);
    const withMoved = (list: string[]) =>
      WEBSITE.replace(
        'created_by: olive-owner\n',
        `created_by: olive-owner\nmoved_from:\n${list.map((k) => `  - "${k}"`).join('\n')}\n`,
      );
    put(CARD, withMoved(keys));
    expect(move('acme/website', 'skyseal', {}, CARD).exit).toBe(0);
    const moved = 'clients/skyseal/projects/website/project.md';
    expect(parseFrontmatter(read(moved)).data.moved_from).toEqual([...keys.slice(1), 'acme/website']);
    // A retry after a failed move (the old key already listed) and the new key listed: neither twice.
    rmSync(abs('clients/skyseal/projects'), { recursive: true });
    put(CARD, withMoved(['acme/website', 'old-1/website', 'skyseal/website']));
    expect(move('acme/website', 'skyseal', {}, CARD).exit).toBe(0);
    expect(parseFrontmatter(read(moved)).data.moved_from).toEqual(['old-1/website', 'acme/website']);
  });

  it('refuses a personal project that links personal files from outside its folder, unless told to drop them', () => {
    put('personal/files/notes.pdf');
    const card = JEV.replace(
      '- [quote.pdf](../../../clients/acme/files/quote.pdf)',
      '- [quote.pdf](../../../clients/acme/files/quote.pdf)\n- [notes.pdf](../../../personal/files/notes.pdf)',
    );
    put(PERSONAL_CARD, card);
    const check = move('personal/jev', 'skyseal', { check: true }, PERSONAL_CARD);
    expect(check.reply.check).toMatchObject({ personalLinks: ['personal/files/notes.pdf'] });
    expect(refusal(move('personal/jev', 'skyseal', {}, PERSONAL_CARD))).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    expect(read(PERSONAL_CARD)).toBe(card);
    expect(existsSync(abs('clients/skyseal/projects'))).toBe(false);
    expect(move('personal/jev', 'skyseal', { dropPersonal: true }, PERSONAL_CARD).exit).toBe(0);
    const moved = read('clients/skyseal/projects/jev/project.md');
    expect(moved).not.toContain('notes.pdf');
    expect(moved).toContain('(../../../personal/files/keep-as-is.pdf) in prose.');
  });

  it('takes the linked files section out when dropping leaves it empty', () => {
    put('personal/files/notes.pdf');
    const card =
      '---\nv: 1\ntitle: Jev\nstatus: active\n---\n\nBrief.\n\n## Linked files\n\n- [notes.pdf](../../../personal/files/notes.pdf)\n';
    put(PERSONAL_CARD, card);
    expect(move('personal/jev', 'skyseal', { dropPersonal: true }, PERSONAL_CARD).exit).toBe(0);
    expect(read('clients/skyseal/projects/jev/project.md')).toBe(
      '---\nv: 1\ntitle: Jev\nclient: skyseal\nstatus: active\nmoved_from:\n  - "personal/jev"\n---\n\nBrief.\n',
    );
  });

  it('counts files git would ignore at the destination, and refuses when it would ignore the card', () => {
    writeFileSync(join(root, '.gitignore'), 'personal/\n*.mov\n');
    put('personal/projects/jev/video.mov');
    const check = move('personal/jev', 'skyseal', { check: true }, PERSONAL_CARD);
    expect(check.reply.check).toMatchObject({ fileCount: 4, ignoredCount: 1 });
    writeFileSync(join(root, '.gitignore'), 'personal/\nclients/skyseal/projects/\n');
    expect(refusal(move('personal/jev', 'skyseal', { check: true }, PERSONAL_CARD))).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    expect(refusal(move('personal/jev', 'skyseal', {}, PERSONAL_CARD))).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    expect(read(PERSONAL_CARD)).toBe(JEV);
  });

  it('refuses what may not move, writing nothing', () => {
    put('clients/_archive/acme/projects/old/project.md', '---\nv: 1\ntitle: Old\nstatus: done\n---\n');
    mkdirSync(abs('clients/acme/projects/bare'), { recursive: true });
    put(
      'clients/acme/projects/merge/project.md',
      '---\n<<<<<<< HEAD\ntitle: A\n=======\ntitle: B\n>>>>>>> x\n---\n',
    );
    put('clients/acme/projects/nofront/project.md', 'Just text.\n');
    put('projects/client-portal/project.md', '---\nv: 1\ntitle: Portal\nstatus: active\n---\n');
    const cases: [string, string, Record<string, unknown>, string | undefined, string][] = [
      ['acme/old', 'skyseal', {}, 'clients/_archive/acme/projects/old/project.md', 'not-allowed'],
      ['acme/bare', 'skyseal', {}, undefined, 'not-found'],
      ['acme/merge', 'skyseal', {}, 'clients/acme/projects/merge/project.md', 'not-allowed'],
      ['acme/nofront', 'skyseal', {}, 'clients/acme/projects/nofront/project.md', 'not-allowed'],
      [`${INTERNAL_CLIENT}/client-portal`, 'acme', {}, 'projects/client-portal/project.md', 'not-allowed'],
      ['acme/website', 'acme', {}, CARD, 'bad-request'],
      ['acme/website', 'personal', {}, CARD, 'bad-request'],
      ['acme/website', 'Sky Seal', {}, CARD, 'bad-request'],
      ['acme/website', 'nobody', {}, CARD, 'not-found'],
      ['acme/website', 'skyseal', {}, undefined, 'changed'],
      ['acme/website', 'skyseal', { expect: undefined }, undefined, 'bad-request'],
      ['acme/website', 'skyseal', { dropPersonal: false }, CARD, 'bad-request'],
      ['acme/website', 'skyseal', { check: 'yes' }, CARD, 'bad-request'],
      ['acme/nothing', 'skyseal', {}, CARD, 'not-found'],
      ['acme', 'skyseal', {}, CARD, 'bad-request'],
    ];
    const before = { clients: tree('clients'), projects: tree('projects') };
    for (const [key, client, extra, rel, code] of cases) {
      expect(refusal(move(key, client, extra, rel)), `${key} → ${client} ${JSON.stringify(extra)}`).toEqual({
        exit: 2,
        error: code,
      });
    }
    expect({ clients: tree('clients'), projects: tree('projects') }).toEqual(before);
    expect(existsSync(abs('clients/skyseal/projects'))).toBe(false);
  });

  it('refuses a destination client folder that is a link, and someone not on the team', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'projects-elsewhere-'));
    symlinkSync(elsewhere, abs('clients/linked'));
    expect(refusal(move('acme/website', 'linked', {}, CARD))).toEqual({ exit: 2, error: 'not-allowed' });
    expect(readdirSync(elsewhere)).toEqual([]);
    rmSync(elsewhere, { recursive: true, force: true });
    git(['config', 'user.email', 'stranger@example.test']);
    expect(refusal(move('personal/jev', 'skyseal', {}, PERSONAL_CARD))).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    expect(read(PERSONAL_CARD)).toBe(JEV);
  });

  it('refuses with exists when the new key already names a folder anywhere, archives included', () => {
    for (const rel of ['clients/skyseal/projects/website', 'clients/_archive/skyseal/projects/website']) {
      mkdirSync(abs(rel), { recursive: true });
      expect(refusal(move('acme/website', 'skyseal', {}, CARD)), rel).toEqual({ exit: 2, error: 'exists' });
      rmSync(abs(rel), { recursive: true });
    }
    for (const rel of ['projects/website', 'projects-archive/website']) {
      mkdirSync(abs(rel), { recursive: true });
      expect(refusal(move('acme/website', INTERNAL_CLIENT, {}, CARD)), rel).toEqual({
        exit: 2,
        error: 'exists',
      });
      rmSync(abs(rel), { recursive: true });
    }
    expect(read(CARD)).toBe(WEBSITE);
    // With every clash gone, The Digital Stride takes it.
    expect(move('acme/website', INTERNAL_CLIENT, {}, CARD).reply).toMatchObject({
      ok: true,
      key: `${INTERNAL_CLIENT}/website`,
    });
  });

  it('refuses when the old key has a twin the old name would fall through to', () => {
    mkdirSync(abs('clients/_archive/acme/projects/website'), { recursive: true });
    expect(refusal(move('acme/website', 'skyseal', {}, CARD))).toEqual({ exit: 2, error: 'not-allowed' });
    put(
      `clients/${INTERNAL_CLIENT}/projects/portal/project.md`,
      '---\nv: 1\ntitle: P\nstatus: active\n---\n',
    );
    mkdirSync(abs('projects/portal'), { recursive: true });
    const rel = `clients/${INTERNAL_CLIENT}/projects/portal/project.md`;
    expect(refusal(move(`${INTERNAL_CLIENT}/portal`, 'acme', {}, rel))).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    expect(read(CARD)).toBe(WEBSITE);
  });

  it('refuses a folder holding a link, its own git repository, a hard link or something that is not a file', () => {
    const tries: [string, () => void, () => void][] = [
      [
        'link',
        () =>
          symlinkSync(abs('clients/acme/files/quote.pdf'), abs('clients/acme/projects/website/alias.pdf')),
        () => rmSync(abs('clients/acme/projects/website/alias.pdf')),
      ],
      [
        'nested .git',
        () => mkdirSync(abs('clients/acme/projects/website/code/.git'), { recursive: true }),
        () => rmSync(abs('clients/acme/projects/website/code'), { recursive: true }),
      ],
      [
        'hard link',
        () => linkSync(abs('clients/acme/files/quote.pdf'), abs('clients/acme/projects/website/quote.pdf')),
        () => rmSync(abs('clients/acme/projects/website/quote.pdf')),
      ],
      [
        'fifo',
        () => {
          const r = spawnSync('mkfifo', [abs('clients/acme/projects/website/pipe')]);
          if (r.status !== 0) throw new Error('mkfifo failed');
        },
        () => rmSync(abs('clients/acme/projects/website/pipe')),
      ],
    ];
    for (const [what, make, undo] of tries) {
      make();
      expect(refusal(move('acme/website', 'skyseal', { check: true }, CARD)), what).toEqual({
        exit: 2,
        error: 'not-allowed',
      });
      expect(refusal(move('acme/website', 'skyseal', {}, CARD)), what).toEqual({
        exit: 2,
        error: 'not-allowed',
      });
      undo();
    }
    expect(read(CARD)).toBe(WEBSITE);
    expect(existsSync(abs('clients/skyseal/projects'))).toBe(false);
  });

  it('puts the card back and lets go of the new folder when the rename fails', () => {
    const failing = (code: string) => () => {
      throw Object.assign(new Error(`${code}: rename failed`), { code });
    };
    for (const code of ['EXDEV', 'EACCES']) {
      const r = projects.run(
        'move',
        { kind: 'move', key: 'acme/website', client: 'skyseal', expect: sha(CARD) },
        { root, home, now: T0, renameDir: failing(code) } as Ctx,
      );
      expect(refusal(r), code).toEqual({ exit: 1, error: 'internal' });
      expect(read(CARD)).toBe(WEBSITE);
      expect(readdirSync(abs('clients/acme/projects/website')).sort()).toEqual(['brief.pdf', 'project.md']);
      expect(existsSync(abs('clients/skyseal/projects'))).toBe(false);
    }
    // An existing projects folder stays; only the claimed one goes.
    mkdirSync(abs('clients/skyseal/projects'));
    const r = projects.run(
      'move',
      { kind: 'move', key: 'acme/website', client: 'skyseal', expect: sha(CARD) },
      { root, home, now: T0, renameDir: failing('EIO') } as Ctx,
    );
    expect(r.exit).toBe(1);
    expect(readdirSync(abs('clients/skyseal/projects'))).toEqual([]);
    expect(read(CARD)).toBe(WEBSITE);
  });

  it('answers the move capability and runs move from the command line', () => {
    expect(call('capabilities').reply.features).toEqual([
      PROJECTS_CAPABILITY,
      PROJECTS_MOVE_CAPABILITY,
      PROJECTS_ARCHIVE_CAPABILITY,
      PROJECTS_UPDATES_CAPABILITY,
      PROJECTS_REFS_CAPABILITY,
      PROJECTS_EMAIL_CAPABILITY,
    ]);
    const r = spawnSync(process.execPath, [SCRIPT, 'move'], {
      input: JSON.stringify({ kind: 'move', key: 'acme/website', client: 'skyseal', expect: sha(CARD) }),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, BRAIN_ROOT: root, GIT_CONFIG_NOSYSTEM: '1' },
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, action: 'move', key: 'skyseal/website' });
  });
});

// Archive plan (docs/plans/2026-11-21-project-archive-delete.md, decisions 1-5 and 8): `archive` and
// `unarchive` move a project's folder beside its live one and back; `delete` removes it for good.
describe('archive, unarchive and delete', () => {
  const OWNED = [
    '---',
    'v: 1',
    'title: Website rebuild',
    'client: acme',
    'status: active',
    'owner: tess-team',
    'created: 2026-11-01',
    'created_by: olive-owner',
    '---',
    '',
    'The brief.',
    '',
  ].join('\n');
  const LIVE = 'clients/acme/projects/website';
  const ARCHIVED = 'clients/acme/projects-archive/website';
  const HIDDEN = /^\.tdsapp-projects-website-[0-9a-f]{12}\.deleting~$/;
  type Check = {
    from: string;
    to: string | null;
    files: string[];
    fileCount: number;
    filesVersion: string;
    allowed: boolean;
    allowedWho: string;
    references: string[];
    referenceCount: number;
    empty: boolean;
    [k: string]: unknown;
  };
  const act = (kind: string, key: string, extra: Record<string, unknown> = {}, ctx: Partial<Ctx> = {}) =>
    projects.run(kind, { kind, key, ...extra }, { root, home, now: T0, ...ctx } as Ctx);
  const checkOf = (kind: string, key: string, extra: Record<string, unknown> = {}) => {
    const r = act(kind, key, { check: true, ...extra });
    expect(r.reply, JSON.stringify(r.reply)).toMatchObject({ ok: true });
    return r.reply.check as Check;
  };
  const as = (email: string) => git(['config', 'user.email', email]);
  const filesVersion = (files: string[]) =>
    createHash('sha256')
      .update([...files].sort().join('\n'))
      .digest('hex');
  const tree = (rel: string): string[] => {
    if (!existsSync(abs(rel))) return [];
    return readdirSync(abs(rel), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => `${join(e.parentPath, e.name).slice(root.length + 1)}`)
      .sort();
  };
  const size = (rel: string) => statSync(abs(rel)).size;

  beforeEach(() => {
    writeFileSync(join(root, '.gitignore'), 'personal/\n*~\n*.mov\n.DS_Store\n');
    put(`${LIVE}/project.md`, OWNED);
    put(`${LIVE}/brief.pdf`, 'pdf bytes');
    put(`${LIVE}/images/logo.png`, 'png');
    put(`${LIVE}/data.bin`, 'binary!');
    put(`${LIVE}/video.mov`, 'a video');
  });

  it('checks an archive first, writing nothing, then archives and unarchives under the same key', () => {
    const before = tree('clients');
    const files = ['brief.pdf', 'data.bin', 'images/logo.png', 'project.md', 'video.mov'];
    const r = act('archive', 'acme/website', { check: true, expect: sha(`${LIVE}/project.md`) });
    expect(r).toEqual({
      exit: 0,
      reply: {
        ok: true,
        action: 'archive',
        key: 'acme/website',
        version: sha(`${LIVE}/project.md`),
        check: {
          key: 'acme/website',
          from: LIVE,
          to: ARCHIVED,
          files: files.map((f) => `${LIVE}/${f}`),
          fileCount: 5,
          images: 1,
          documents: 2,
          other: 2,
          bytes: files.reduce((n, f) => n + size(`${LIVE}/${f}`), 0),
          ignoredCount: 1,
          localOnlyCount: 1,
          references: [],
          referenceCount: 0,
          filesVersion: filesVersion(files),
          empty: false,
          allowed: true,
          allowedWho: 'anyone on the team',
        },
      },
    });
    expect(tree('clients')).toEqual(before);
    expect(existsSync(abs('clients/acme/projects-archive'))).toBe(false);

    const check = r.reply.check as Check;
    const done = act('archive', 'acme/website', {
      expect: sha(`${LIVE}/project.md`),
      filesExpect: check.filesVersion,
    });
    expect(done).toEqual({
      exit: 0,
      reply: { ok: true, action: 'archive', key: 'acme/website', version: '' },
    });
    expect(existsSync(abs(LIVE))).toBe(false);
    expect(tree(ARCHIVED)).toEqual(files.map((f) => `${ARCHIVED}/${f}`));
    // The card isn't touched.
    expect(read(`${ARCHIVED}/project.md`)).toBe(OWNED);
    // Archived means read only.
    expect(
      refusal(
        act('edit', 'acme/website', { fields: { status: 'done' }, expect: sha(`${ARCHIVED}/project.md`) }),
      ),
    ).toEqual({ exit: 2, error: 'not-allowed' });
    expect(refusal(act('archive', 'acme/website', { expect: sha(`${ARCHIVED}/project.md`) }))).toEqual({
      exit: 2,
      error: 'bad-request',
    });

    const back = checkOf('unarchive', 'acme/website');
    expect(back).toMatchObject({ from: ARCHIVED, to: LIVE, fileCount: 5, allowed: true });
    expect(
      act('unarchive', 'acme/website', {
        expect: sha(`${ARCHIVED}/project.md`),
        filesExpect: back.filesVersion,
      }).reply,
    ).toEqual({ ok: true, action: 'unarchive', key: 'acme/website', version: '' });
    expect(tree(LIVE)).toEqual(files.map((f) => `${LIVE}/${f}`));
    expect(existsSync(abs(ARCHIVED))).toBe(false);
    expect(refusal(act('unarchive', 'acme/website', { expect: sha(`${LIVE}/project.md`) }))).toEqual({
      exit: 2,
      error: 'bad-request',
    });
  });

  it('archives and unarchives personal, legacy and The Digital Stride projects beside their live folders', () => {
    const cases: [string, string, string][] = [
      ['personal/jev', 'personal/projects/jev', 'personal/projects-archive/jev'],
      [`${INTERNAL_CLIENT}/portal`, 'projects/portal', 'projects-archive/portal'],
      [
        `${INTERNAL_CLIENT}/ops`,
        `clients/${INTERNAL_CLIENT}/projects/ops`,
        `clients/${INTERNAL_CLIENT}/projects-archive/ops`,
      ],
    ];
    for (const [key, live, archived] of cases) {
      put(`${live}/project.md`, '---\nv: 1\ntitle: T\nstatus: active\n---\n');
      put(`${live}/notes.md`, 'notes');
      const c = checkOf('archive', key);
      expect(c, key).toMatchObject({ from: live, to: archived, fileCount: 2 });
      expect(act('archive', key, { expect: sha(`${live}/project.md`) }).reply, key).toMatchObject({
        ok: true,
        key,
        version: '',
      });
      expect(tree(archived), key).toEqual([`${archived}/notes.md`, `${archived}/project.md`]);
      expect(existsSync(abs(live)), key).toBe(false);
      expect(act('unarchive', key, { expect: sha(`${archived}/project.md`) }).reply, key).toMatchObject({
        ok: true,
        key,
      });
      expect(tree(live), key).toEqual([`${live}/notes.md`, `${live}/project.md`]);
    }
    // Every file of a personal project is only on this Mac.
    expect(checkOf('archive', 'personal/jev')).toMatchObject({ localOnlyCount: 2, allowed: true });
  });

  it('archives a card-less folder without expect, and needs expect when there is a card', () => {
    put('clients/acme/projects/bare/notes.md', 'x');
    expect(act('archive', 'acme/bare').reply).toMatchObject({ ok: true, key: 'acme/bare' });
    expect(existsSync(abs('clients/acme/projects-archive/bare/notes.md'))).toBe(true);
    expect(refusal(act('archive', 'acme/website'))).toEqual({ exit: 2, error: 'bad-request' });
    expect(refusal(act('archive', 'acme/website', { expect: 'a'.repeat(64) }))).toEqual({
      exit: 2,
      error: 'changed',
    });
    expect(refusal(act('archive', 'acme/website', { expect: 'nope' }))).toEqual({
      exit: 2,
      error: 'bad-request',
    });
    expect(refusal(act('archive', 'acme/website', { check: 'yes' }))).toEqual({
      exit: 2,
      error: 'bad-request',
    });
    expect(existsSync(abs(`${LIVE}/project.md`))).toBe(true);
  });

  it('refuses with exists when another folder holds the key, never renaming', () => {
    mkdirSync(abs(ARCHIVED), { recursive: true });
    expect(refusal(act('archive', 'acme/website', { expect: sha(`${LIVE}/project.md`) }))).toEqual({
      exit: 2,
      error: 'exists',
    });
    expect(refusal(act('archive', 'acme/website', { check: true }))).toEqual({ exit: 2, error: 'exists' });
    expect(readdirSync(abs('clients/acme/projects-archive'))).toEqual(['website']);
    expect(readdirSync(abs(ARCHIVED))).toEqual([]);
    rmSync(abs(ARCHIVED), { recursive: true });
    // An archived client's twin counts too.
    mkdirSync(abs('clients/_archive/acme/projects/website'), { recursive: true });
    expect(refusal(act('archive', 'acme/website', { expect: sha(`${LIVE}/project.md`) }))).toEqual({
      exit: 2,
      error: 'exists',
    });
    rmSync(abs('clients/_archive'), { recursive: true });
    // Unarchive: an internal key held by the other archive folder.
    put(`clients/${INTERNAL_CLIENT}/projects-archive/ops/project.md`, '---\nv: 1\ntitle: O\n---\n');
    mkdirSync(abs('projects-archive/ops'), { recursive: true });
    const card = `clients/${INTERNAL_CLIENT}/projects-archive/ops/project.md`;
    expect(refusal(act('unarchive', `${INTERNAL_CLIENT}/ops`, { expect: sha(card) }))).toEqual({
      exit: 2,
      error: 'exists',
    });
    expect(existsSync(abs(card))).toBe(true);
    expect(existsSync(abs(`clients/${INTERNAL_CLIENT}/projects/ops`))).toBe(false);
  });

  it('refuses with changed when the files differ from the ones checked, writing nothing', () => {
    const seen = checkOf('archive', 'acme/website').filesVersion;
    put(`${LIVE}/late.txt`, 'saved after the check');
    const v = sha(`${LIVE}/project.md`);
    const r = act('archive', 'acme/website', { expect: v, filesExpect: seen });
    expect(refusal(r)).toEqual({ exit: 2, error: 'changed' });
    expect(r.reply.message).toMatch(/^the files in this project changed since you checked/);
    expect(existsSync(abs(ARCHIVED))).toBe(false);
    expect(refusal(act('archive', 'acme/website', { expect: v, filesExpect: 'F'.repeat(64) }))).toEqual({
      exit: 2,
      error: 'bad-request',
    });
  });

  it('refuses a folder holding a link, its own git repository or a hard link', () => {
    const tries: [string, () => void, () => void][] = [
      [
        'link',
        () => symlinkSync(abs(`${LIVE}/brief.pdf`), abs(`${LIVE}/alias.pdf`)),
        () => rmSync(abs(`${LIVE}/alias.pdf`)),
      ],
      [
        'nested .git',
        () => mkdirSync(abs(`${LIVE}/code/.git`), { recursive: true }),
        () => rmSync(abs(`${LIVE}/code`), { recursive: true }),
      ],
      [
        'hard link',
        () => linkSync(abs(`${LIVE}/brief.pdf`), abs('clients/acme/twin.pdf')),
        () => rmSync(abs('clients/acme/twin.pdf')),
      ],
    ];
    for (const [what, make, undo] of tries) {
      make();
      const r = act('archive', 'acme/website', { expect: sha(`${LIVE}/project.md`) });
      expect(refusal(r), what).toEqual({ exit: 2, error: 'not-allowed' });
      expect(r.reply.message, what).toMatch(/so the project can't be archived$/);
      undo();
    }
    expect(existsSync(abs(ARCHIVED))).toBe(false);
  });

  it('makes the archive folder one level only, under a real folder', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'projects-elsewhere-'));
    symlinkSync(elsewhere, abs('clients/acme/projects-archive'));
    expect(refusal(act('archive', 'acme/website', { expect: sha(`${LIVE}/project.md`) }))).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    expect(readdirSync(elsewhere)).toEqual([]);
    rmSync(abs('clients/acme/projects-archive'));
    rmSync(elsewhere, { recursive: true, force: true });
    // A personal archive folder that is a link is never written to.
    put('personal/projects/jev/project.md', '---\nv: 1\ntitle: Jev\n---\n');
    const away = mkdtempSync(join(tmpdir(), 'projects-elsewhere-'));
    symlinkSync(away, abs('personal/projects-archive'));
    expect(
      refusal(act('archive', 'personal/jev', { expect: sha('personal/projects/jev/project.md') })),
    ).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    expect(readdirSync(away)).toEqual([]);
    rmSync(away, { recursive: true, force: true });
  });

  it('never unarchives a project of an archived client, and never makes a client folder', () => {
    put('clients/_archive/skyseal/projects/old/project.md', '---\nv: 1\ntitle: Old\nstatus: done\n---\n');
    const v = sha('clients/_archive/skyseal/projects/old/project.md');
    expect(refusal(act('unarchive', 'skyseal/old', { expect: v }))).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    expect(refusal(act('unarchive', 'skyseal/old', { check: true }))).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    expect(refusal(act('delete', 'skyseal/old', { check: true }))).toEqual({ exit: 2, error: 'not-allowed' });
    expect(existsSync(abs('clients/skyseal/projects'))).toBe(false);
    // A client folder that is a link: refused before anything is written.
    put('clients/kept/projects-archive/site/project.md', '---\nv: 1\ntitle: Site\n---\n');
    symlinkSync(abs('clients/kept'), abs('clients/gone'));
    const card = sha('clients/kept/projects-archive/site/project.md');
    expect(refusal(act('unarchive', 'gone/site', { expect: card }))).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    expect(existsSync(abs('clients/kept/projects'))).toBe(false);
  });

  it('refuses to archive a legacy folder while a skill or tool names it, naming them', () => {
    put('projects/portal/project.md', '---\nv: 1\ntitle: Portal\nstatus: active\n---\n');
    put('.claude/skills/portal-sync/SKILL.md', 'Writes to projects/portal/status.md every day.\n');
    put('tools/portal.cjs', "const dir = 'projects/portal';\n");
    // Not the folder: a longer name, and another client's projects folder of the same slug.
    put('.claude/skills/other/SKILL.md', 'See projects/portal-old/ and clients/acme/projects/portal/.\n');
    const v = sha('projects/portal/project.md');
    const r = act('archive', `${INTERNAL_CLIENT}/portal`, { expect: v });
    expect(refusal(r)).toEqual({ exit: 2, error: 'not-allowed' });
    expect(r.reply.message).toContain('.claude/skills/portal-sync/SKILL.md');
    expect(r.reply.message).toContain('tools/portal.cjs');
    expect(r.reply.message).not.toContain('skills/other');
    expect(refusal(act('archive', `${INTERNAL_CLIENT}/portal`, { check: true }))).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    rmSync(abs('.claude/skills/portal-sync'), { recursive: true });
    rmSync(abs('tools'), { recursive: true });
    expect(act('archive', `${INTERNAL_CLIENT}/portal`, { expect: v }).reply).toMatchObject({ ok: true });
    expect(existsSync(abs('projects-archive/portal/project.md'))).toBe(true);
  });

  it('refuses to archive a client-folder project while a skill names it (0.3.2: every shared project)', () => {
    put('.claude/skills/site-sync/SKILL.md', `Writes to ${LIVE}/status.md every day.\n`);
    const v = sha(`${LIVE}/project.md`);
    const r = act('archive', 'acme/website', { expect: v });
    expect(refusal(r)).toEqual({ exit: 2, error: 'not-allowed' });
    expect(r.reply.message).toContain('.claude/skills/site-sync/SKILL.md');
    rmSync(abs('.claude/skills/site-sync'), { recursive: true });
    expect(act('archive', 'acme/website', { expect: v }).reply).toMatchObject({ ok: true });
  });

  it("doesn't count the save-location scan's findings list as a file that writes the folder", () => {
    put('projects/portal/project.md', '---\nv: 1\ntitle: Portal\nstatus: active\n---\n');
    put('tools/save-location-baseline.json', '{"paths": ["projects/portal/notes/old.md"]}\n');
    const r = act('archive', `${INTERNAL_CLIENT}/portal`, { expect: sha('projects/portal/project.md') });
    expect(r.reply).toMatchObject({ ok: true });
    expect(existsSync(abs('projects-archive/portal/project.md'))).toBe(true);
  });

  it('lets only people on the team archive a shared project', () => {
    as('stranger@example.test');
    expect(checkOf('archive', 'acme/website')).toMatchObject({
      allowed: false,
      allowedWho: 'anyone on the team',
    });
    expect(refusal(act('archive', 'acme/website', { expect: sha(`${LIVE}/project.md`) }))).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
    expect(existsSync(abs(LIVE))).toBe(true);
  });

  it('lists the brain files that name the folder, on path boundaries, skipping the record folders', () => {
    put(
      'clients/acme/projects/other/project.md',
      '- [brief.pdf](../../../../clients/acme/projects/website/brief.pdf)\n',
    );
    put('todo/fix-the-site.md', 'See clients/acme/projects/website for the copy.\n');
    put('clients/acme/notes.json', '{"folder":"clients/acme/projects/website"}');
    put('todo/done/old.md', 'clients/acme/projects/website\n');
    put('todo/deleted/gone.md', 'clients/acme/projects/website\n');
    put('z-logs/log.md', 'clients/acme/projects/website\n');
    put('clients/acme/near.md', 'clients/acme/projects/website-old and xclients/acme/projects/website\n');
    put('clients/acme/image.png', 'clients/acme/projects/website');
    put(`${LIVE}/self.md`, 'clients/acme/projects/website/brief.pdf');
    const c = checkOf('archive', 'acme/website');
    expect(c.references).toEqual([
      'clients/acme/notes.json',
      'clients/acme/projects/other/project.md',
      'todo/fix-the-site.md',
    ]);
    expect(c.referenceCount).toBe(3);
  });

  describe('delete', () => {
    const hiddenIn = (parent: string) => readdirSync(abs(parent)).filter((n) => HIDDEN.test(n));
    const archiveIt = () => {
      expect(act('archive', 'acme/website', { expect: sha(`${LIVE}/project.md`) }).exit).toBe(0);
    };
    const del = (key = 'acme/website', extra: Record<string, unknown> = {}, ctx: Partial<Ctx> = {}) => {
      const c = act('delete', key, { check: true, ...extra });
      const filesExpect = (c.reply.check as Check | undefined)?.filesVersion ?? 'e'.repeat(64);
      return act('delete', key, { filesExpect, ...extra }, ctx);
    };

    it('lets the Account Owner and the brain Owner delete an archived project, and no one else', () => {
      archiveIt();
      expect(checkOf('delete', 'acme/website')).toMatchObject({
        from: ARCHIVED,
        to: null,
        allowed: false,
        allowedWho: "Tess Team (the Account Owner) or the brain's Owner",
        empty: false,
      });
      const r = del();
      expect(refusal(r)).toEqual({ exit: 2, error: 'not-allowed' });
      expect(r.reply.message).toContain('Tess Team');
      expect(existsSync(abs(`${ARCHIVED}/project.md`))).toBe(true);
      as('tess@example.test');
      expect(checkOf('delete', 'acme/website')).toMatchObject({ allowed: true });
      expect(del()).toEqual({
        exit: 0,
        reply: { ok: true, action: 'delete', key: 'acme/website', version: '' },
      });
      expect(existsSync(abs(ARCHIVED))).toBe(false);
      expect(hiddenIn('clients/acme/projects-archive')).toEqual([]);
      // The brain's Owner may delete anyone's.
      put(`${ARCHIVED}/project.md`, OWNED);
      as('olive@example.test');
      expect(del().reply).toMatchObject({ ok: true });
      expect(existsSync(abs(ARCHIVED))).toBe(false);
    });

    it('matches the Account Owner by either slug form', () => {
      writeFileSync(
        join(root, '.team-config', 'roles.json'),
        JSON.stringify({
          members: [...ROLES.members, { name: "Pete O'Neil", email: 'pete@example.test', role: 'scout' }],
        }),
      );
      put(`${ARCHIVED}/project.md`, OWNED.replace('owner: tess-team', 'owner: pete-o-neil'));
      rmSync(abs(LIVE), { recursive: true });
      as('pete@example.test');
      expect(checkOf('delete', 'acme/website')).toMatchObject({ allowed: true });
      put(`${ARCHIVED}/project.md`, OWNED.replace('owner: tess-team', 'owner: pete-oneil'));
      expect(checkOf('delete', 'acme/website')).toMatchObject({ allowed: true });
    });

    it("leaves a card-less or owner-less shared project to the brain's Owner, and personal ones to the person", () => {
      put('clients/acme/projects-archive/bare/notes.md', 'x');
      put('clients/acme/projects-archive/nobody/project.md', '---\nv: 1\ntitle: Nobody\n---\n');
      for (const key of ['acme/bare', 'acme/nobody']) {
        expect(checkOf('delete', key), key).toMatchObject({
          allowed: false,
          allowedWho: "the brain's Owner",
        });
        expect(refusal(del(key)), key).toEqual({ exit: 2, error: 'not-allowed' });
      }
      as('olive@example.test');
      for (const key of ['acme/bare', 'acme/nobody']) expect(del(key).reply, key).toMatchObject({ ok: true });
      as('sam@example.test');
      put('personal/projects-archive/jev/project.md', '---\nv: 1\ntitle: Jev\nowner: olive-owner\n---\n');
      put('personal/projects-archive/jev/notes.md', 'mine');
      expect(checkOf('delete', 'personal/jev')).toMatchObject({ allowed: true, localOnlyCount: 2 });
      expect(del('personal/jev').reply).toMatchObject({ ok: true });
      expect(existsSync(abs('personal/projects-archive/jev'))).toBe(false);
    });

    it('deletes only an archived project, a live one holding only its card, or a leftover', () => {
      as('tess@example.test');
      expect(refusal(act('delete', 'acme/website', { check: true }))).toEqual({
        exit: 2,
        error: 'not-allowed',
      });
      expect(refusal(del())).toEqual({ exit: 2, error: 'not-allowed' });
      expect(existsSync(abs(`${LIVE}/brief.pdf`))).toBe(true);
      for (const f of ['brief.pdf', 'images/logo.png', 'data.bin', 'video.mov']) rmSync(abs(`${LIVE}/${f}`));
      rmSync(abs(`${LIVE}/images`), { recursive: true });
      expect(checkOf('delete', 'acme/website')).toMatchObject({ empty: true, allowed: true, fileCount: 1 });
      expect(del().reply).toMatchObject({ ok: true });
      expect(existsSync(abs(LIVE))).toBe(false);
    });

    it('needs the check fingerprint, and refuses when the files changed since', () => {
      archiveIt();
      as('tess@example.test');
      expect(refusal(act('delete', 'acme/website'))).toEqual({ exit: 2, error: 'bad-request' });
      const seen = checkOf('delete', 'acme/website').filesVersion;
      put(`${ARCHIVED}/late.txt`, 'late');
      expect(refusal(act('delete', 'acme/website', { filesExpect: seen }))).toEqual({
        exit: 2,
        error: 'changed',
      });
      expect(refusal(act('delete', 'acme/website', { filesExpect: seen, expect: 'a'.repeat(64) }))).toEqual({
        exit: 2,
        error: 'changed',
      });
      expect(existsSync(abs(`${ARCHIVED}/late.txt`))).toBe(true);
    });

    it('hides the folder under a git-ignored name first, then removes it', () => {
      archiveIt();
      as('tess@example.test');
      const seen: { dir: string; archivedThere: boolean; files: string[] }[] = [];
      const r = del(
        'acme/website',
        {},
        {
          removeDir: (dir: string) => {
            seen.push({
              dir,
              archivedThere: existsSync(abs(ARCHIVED)),
              files: readdirSync(dir).sort(),
            });
            rmSync(dir, { recursive: true, force: true });
          },
        },
      );
      expect(r.reply).toMatchObject({ ok: true });
      expect(seen).toHaveLength(1);
      const [first] = seen as [(typeof seen)[number]];
      const name = first.dir.slice(dirname(first.dir).length + 1);
      expect(dirname(first.dir)).toBe(abs('clients/acme/projects-archive'));
      expect(name).toMatch(HIDDEN);
      expect(first).toMatchObject({ archivedThere: false });
      expect(first.files).toEqual(['brief.pdf', 'data.bin', 'images', 'project.md', 'video.mov']);
      expect(git(['check-ignore', `clients/acme/projects-archive/${name}`]).trim()).not.toBe('');
    });

    it('answers ok with leftBehind, naming the hidden folder, when the remove fails; the next call sweeps it', () => {
      archiveIt();
      as('tess@example.test');
      const r = del(
        'acme/website',
        {},
        {
          removeDir: () => {
            throw Object.assign(new Error('EBUSY: busy'), { code: 'EBUSY' });
          },
        },
      );
      const left = hiddenIn('clients/acme/projects-archive');
      expect(left).toHaveLength(1);
      // The project is gone (out of sight, git-ignored), so the caller still applies its to-dos.
      expect(r).toEqual({
        exit: 0,
        reply: {
          ok: true,
          action: 'delete',
          key: 'acme/website',
          version: '',
          leftBehind: `clients/acme/projects-archive/${left[0]}`,
        },
      });
      expect(existsSync(abs(ARCHIVED))).toBe(false);
      // Any later call on a project there sweeps it; other hidden things stay.
      put('clients/acme/projects-archive/.keep~', 'mine');
      put('clients/acme/projects-archive/other/project.md', '---\nv: 1\ntitle: O\n---\n');
      act('unarchive', 'acme/other', { check: true });
      expect(hiddenIn('clients/acme/projects-archive')).toEqual([]);
      expect(existsSync(abs('clients/acme/projects-archive/.keep~'))).toBe(true);
    });

    it('sweeps a stale hidden folder left in a live projects folder too', () => {
      put('clients/acme/projects/.tdsapp-projects-old-0123456789ab.deleting~/sub/file.md', 'x');
      put('clients/acme/projects/.tdsapp-projects-old.deleting~/kept.md', 'not ours: no hex');
      expect(
        act('edit', 'acme/website', { fields: { status: 'done' }, expect: sha(`${LIVE}/project.md`) }).exit,
      ).toBe(0);
      expect(readdirSync(abs('clients/acme/projects')).sort()).toEqual([
        '.tdsapp-projects-old.deleting~',
        'website',
      ]);
    });

    it("refuses when git wouldn't ignore the hidden name", () => {
      archiveIt();
      writeFileSync(join(root, '.gitignore'), 'personal/\n');
      as('tess@example.test');
      expect(refusal(act('delete', 'acme/website', { check: true }))).toEqual({
        exit: 2,
        error: 'not-allowed',
      });
      expect(existsSync(abs(`${ARCHIVED}/project.md`))).toBe(true);
    });

    it('treats a card-less live folder with a carded archive twin as a leftover: the archive wins', () => {
      archiveIt();
      put(`${LIVE}/stray.txt`, 'left on this Mac');
      // The key reads the archive.
      expect(checkOf('delete', 'acme/website')).toMatchObject({ from: ARCHIVED });
      expect(refusal(act('unarchive', 'acme/website', { expect: sha(`${ARCHIVED}/project.md`) }))).toEqual({
        exit: 2,
        error: 'exists',
      });
      // It holds a file git would sync (a teammate's work may be in it), so only the archived twin's
      // Account Owner or the brain's Owner may delete it.
      const c = checkOf('delete', 'acme/website', { leftover: true });
      expect(c).toMatchObject({
        from: LIVE,
        to: null,
        allowed: false,
        allowedWho: "Tess Team (the Account Owner) or the brain's Owner",
        fileCount: 1,
      });
      expect(refusal(act('delete', 'acme/website', { leftover: true, filesExpect: c.filesVersion }))).toEqual(
        { exit: 2, error: 'not-allowed' },
      );
      expect(existsSync(abs(`${LIVE}/stray.txt`))).toBe(true);
      as('tess@example.test');
      expect(checkOf('delete', 'acme/website', { leftover: true })).toMatchObject({ allowed: true });
      expect(
        act('delete', 'acme/website', { leftover: true, filesExpect: c.filesVersion }).reply,
      ).toMatchObject({
        ok: true,
      });
      expect(existsSync(abs(LIVE))).toBe(false);
      expect(existsSync(abs(`${ARCHIVED}/project.md`))).toBe(true);
      expect(refusal(act('delete', 'acme/website', { leftover: true, check: true }))).toEqual({
        exit: 2,
        error: 'not-found',
      });
      expect(refusal(act('delete', 'acme/website', { leftover: 'yes', check: true }))).toEqual({
        exit: 2,
        error: 'bad-request',
      });
    });

    it('lets anyone on the team delete a leftover beside a carded archive when git ignores all it holds', () => {
      archiveIt();
      put(`${LIVE}/.DS_Store`, 'finder');
      put(`${LIVE}/cut.mov`, 'video');
      const c = checkOf('delete', 'acme/website', { leftover: true });
      expect(c).toMatchObject({ from: LIVE, allowed: true, allowedWho: 'anyone on the team', fileCount: 2 });
      expect(
        act('delete', 'acme/website', { leftover: true, filesExpect: c.filesVersion }).reply,
      ).toMatchObject({ ok: true });
      expect(existsSync(abs(LIVE))).toBe(false);
      expect(existsSync(abs(`${ARCHIVED}/project.md`))).toBe(true);
    });

    it("leaves a leftover holding synced files beside an owner-less archive to the brain's Owner", () => {
      archiveIt();
      put(`${ARCHIVED}/project.md`, OWNED.replace('owner: tess-team\n', ''));
      put(`${LIVE}/stray.txt`, 'left on this Mac');
      as('tess@example.test');
      expect(checkOf('delete', 'acme/website', { leftover: true })).toMatchObject({
        allowed: false,
        allowedWho: "the brain's Owner",
      });
      as('olive@example.test');
      expect(checkOf('delete', 'acme/website', { leftover: true })).toMatchObject({ allowed: true });
    });

    it('treats a card-less folder holding only git-ignored files as a leftover', () => {
      put(`clients/${INTERNAL_CLIENT}/projects/portal/.DS_Store`, 'finder');
      put(`clients/${INTERNAL_CLIENT}/projects/portal/cut.mov`, 'video');
      put('projects/portal/project.md', '---\nv: 1\ntitle: Portal\nstatus: active\n---\n');
      // The legacy folder wins over the stray TDS one.
      const v = sha('projects/portal/project.md');
      expect(
        act('edit', `${INTERNAL_CLIENT}/portal`, { fields: { status: 'done' }, expect: v }).reply,
      ).toMatchObject({ ok: true });
      expect(read('projects/portal/project.md')).toContain('status: done');
      // Alone, it is still found, and anyone on the team may delete it.
      rmSync(abs('projects/portal'), { recursive: true });
      expect(checkOf('delete', `${INTERNAL_CLIENT}/portal`)).toMatchObject({
        from: `clients/${INTERNAL_CLIENT}/projects/portal`,
        allowed: true,
        ignoredCount: 2,
        localOnlyCount: 2,
      });
      expect(del(`${INTERNAL_CLIENT}/portal`).reply).toMatchObject({ ok: true });
      as('stranger@example.test');
      put('clients/acme/projects/stray/.DS_Store', 'finder');
      expect(refusal(del('acme/stray'))).toEqual({ exit: 2, error: 'not-allowed' });
    });
  });

  it('leaves the folder where it was when the rename fails, letting go of a folder it made', () => {
    const failing = () => {
      throw Object.assign(new Error('EACCES: rename failed'), { code: 'EACCES' });
    };
    const v = sha(`${LIVE}/project.md`);
    const r = act('archive', 'acme/website', { expect: v }, { renameDir: failing });
    expect(refusal(r)).toEqual({ exit: 1, error: 'internal' });
    expect(r.reply.message).toMatch(/stays where it was$/);
    expect(existsSync(abs('clients/acme/projects-archive'))).toBe(false);
    expect(read(`${LIVE}/project.md`)).toBe(OWNED);
    expect(act('archive', 'acme/website', { expect: v }).exit).toBe(0);
    as('tess@example.test');
    const c = checkOf('delete', 'acme/website');
    const d = act('delete', 'acme/website', { filesExpect: c.filesVersion }, { renameDir: failing });
    expect(refusal(d)).toEqual({ exit: 1, error: 'internal' });
    expect(readdirSync(abs('clients/acme/projects-archive'))).toEqual(['website']);
    expect(tree(ARCHIVED)).toHaveLength(5);
  });

  it('refuses a new project whose slug any archive folder holds', () => {
    mkdirSync(abs('clients/acme/projects-archive/old-site'), { recursive: true });
    expect(refusal(create('old-site'))).toEqual({ exit: 2, error: 'exists' });
    mkdirSync(abs(`clients/${INTERNAL_CLIENT}/projects-archive/old-ops`), { recursive: true });
    expect(refusal(create('old-ops', {}, { client: INTERNAL_CLIENT }))).toEqual({ exit: 2, error: 'exists' });
    mkdirSync(abs('personal/projects-archive/old-jev'), { recursive: true });
    expect(
      refusal(call('create', { kind: 'create', space: 'personal', slug: 'old-jev', fields: { title: 'J' } })),
    ).toEqual({ exit: 2, error: 'exists' });
  });

  it('runs archive from the command line', () => {
    const r = spawnSync(process.execPath, [SCRIPT, 'archive'], {
      input: JSON.stringify({ kind: 'archive', key: 'acme/website', expect: sha(`${LIVE}/project.md`) }),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, BRAIN_ROOT: root, GIT_CONFIG_NOSYSTEM: '1' },
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, action: 'archive', key: 'acme/website', version: '' });
  });
});

describe('brain rules for archive and delete', () => {
  const rule = (name: string) =>
    readFileSync(fileURLToPath(new URL(`../brain-rules/${name}`, import.meta.url)), 'utf8');

  it('notes that the hidden delete folder relies on the brain ignoring `*~`', () => {
    expect(rule('README.md')).toContain('`*~`');
  });

  it('tells sessions to archive and delete with the skill, and lists the archive folders', () => {
    for (const f of ['clients-AGENTS.md', 'personal-AGENTS.md', 'projects-AGENTS.md']) {
      expect(rule(f), f).toMatch(
        /archive and delete\s[\s\S]{0,40}?with the\s+`tdsapp-projects` skill, never by hand/i,
      );
    }
    expect(rule('save-locations.md')).toContain('projects-archive/');
    expect(rule('save-locations-cjs.md')).toMatch(/CLIENT_ROOT_ALLOWED/);
    expect(rule('save-locations-cjs.md')).toContain("'projects-archive'");
  });
});

describe('security and correctness review', () => {
  const OWNED =
    '---\nv: 1\ntitle: Website rebuild\nclient: acme\nstatus: active\nowner: tess-team\n---\n\nThe brief.\n';
  const LIVE = 'clients/acme/projects/website';
  const as = (email: string) => git(['config', 'user.email', email]);
  const act = (kind: string, key: string, extra: Record<string, unknown> = {}) =>
    call(kind, { kind, key, ...extra });
  const editOwner = (owner: string | null, extra: Record<string, unknown> = {}) =>
    act('edit', 'acme/website', { fields: { owner, ...extra }, expect: sha(`${LIVE}/project.md`) });

  beforeEach(() => {
    writeFileSync(join(root, '.gitignore'), 'personal/\n*~\n');
    put(`${LIVE}/project.md`, OWNED);
  });

  describe("who may change a shared card's Account Owner", () => {
    it('refuses a team-role teammate claiming the Account Owner, so they can never go on to delete it', () => {
      as('terry@example.test');
      const r = editOwner('terry-team');
      expect(refusal(r)).toEqual({ exit: 2, error: 'not-allowed' });
      expect(r.reply.message).toBe(
        'Only Tess Team (the Account Owner), an owner or a scout can change the Account Owner.',
      );
      expect(read(`${LIVE}/project.md`)).toBe(OWNED);
      expect(refusal(editOwner(null))).toEqual({ exit: 2, error: 'not-allowed' });
      expect(read(`${LIVE}/project.md`)).toBe(OWNED);
      // The rest of the old bypass: anyone on the team may archive, but the delete stays Tess's.
      expect(act('archive', 'acme/website', { expect: sha(`${LIVE}/project.md`) }).exit).toBe(0);
      const c = act('delete', 'acme/website', { check: true });
      expect(c.reply.check).toMatchObject({ allowed: false });
      const filesExpect = (c.reply.check as { filesVersion: string }).filesVersion;
      expect(refusal(act('delete', 'acme/website', { filesExpect }))).toEqual({
        exit: 2,
        error: 'not-allowed',
      });
      expect(existsSync(abs('clients/acme/projects-archive/website/project.md'))).toBe(true);
    });

    it('lets a scout change or clear the Account Owner (decision 13), ', () => {
      as('sam@example.test');
      expect(editOwner('terry-team').reply).toMatchObject({ ok: true });
      expect(read(`${LIVE}/project.md`)).toContain('\nowner: terry-team\n');
      expect(editOwner(null).reply).toMatchObject({ ok: true });
      expect(read(`${LIVE}/project.md`)).not.toContain('owner:');
    });

    it('lets a team-role teammate who is not the Account Owner rename the project (decision 12)', () => {
      as('terry@example.test');
      const r = act('edit', 'acme/website', {
        fields: { title: 'Website relaunch' },
        expect: sha(`${LIVE}/project.md`),
      });
      expect(r.reply).toMatchObject({ ok: true });
      expect(read(`${LIVE}/project.md`)).toContain('\ntitle: Website relaunch\n');
      expect(read(`${LIVE}/project.md`)).toContain('\nowner: tess-team\n');
      expect(existsSync(abs(LIVE))).toBe(true);
    });

    it('always lets the same Account Owner be sent back, as older apps do with every field', () => {
      expect(editOwner('tess-team', { status: 'on-hold' }).reply).toMatchObject({ ok: true });
      expect(read(`${LIVE}/project.md`)).toContain('\nstatus: on-hold\nowner: tess-team\n');
      put(`${LIVE}/project.md`, OWNED.replace('owner: tess-team\n', ''));
      expect(editOwner(null, { health: 'green' }).reply).toMatchObject({ ok: true });
    });

    it('lets the Account Owner hand over, and the brain Owner change or clear it', () => {
      as('tess@example.test');
      expect(editOwner('sam-example').reply).toMatchObject({ ok: true });
      expect(read(`${LIVE}/project.md`)).toContain('\nowner: sam-example\n');
      as('olive@example.test');
      expect(editOwner('tess-team').reply).toMatchObject({ ok: true });
      expect(editOwner(null).reply).toMatchObject({ ok: true });
      expect(read(`${LIVE}/project.md`)).not.toContain('owner:');
    });

    it('leaves naming an Account Owner on a card with none to an owner or a scout', () => {
      put(`${LIVE}/project.md`, OWNED.replace('owner: tess-team\n', ''));
      as('tess@example.test');
      const r = editOwner('tess-team');
      expect(refusal(r)).toEqual({ exit: 2, error: 'not-allowed' });
      expect(r.reply.message).toBe('Only an owner or a scout can change the Account Owner.');
      expect(read(`${LIVE}/project.md`)).not.toContain('owner:');
      as('sam@example.test');
      expect(editOwner('tess-team').reply).toMatchObject({ ok: true });
      expect(read(`${LIVE}/project.md`)).toContain('\nowner: tess-team\n');
    });

    it("writes a card-less folder's card without an Account Owner unless an owner or a scout names one", () => {
      mkdirSync(abs('clients/acme/projects/bare'), { recursive: true });
      as('tess@example.test');
      const r = act('card', 'acme/bare', { fields: { owner: 'sam-example', health: 'green' } });
      expect(r.reply).toMatchObject({ ok: true, key: 'acme/bare', ownerDropped: true });
      expect(r.reply.version).toBe(sha('clients/acme/projects/bare/project.md'));
      expect(read('clients/acme/projects/bare/project.md')).not.toContain('owner:');
      expect(read('clients/acme/projects/bare/project.md')).toContain('\nhealth: green\n');
      mkdirSync(abs('clients/acme/projects/bare-two'), { recursive: true });
      as('sam@example.test');
      const kept = act('card', 'acme/bare-two', { fields: { owner: 'sam-example' } });
      expect(kept.reply).toMatchObject({ ok: true });
      expect(kept.reply).not.toHaveProperty('ownerDropped');
      expect(read('clients/acme/projects/bare-two/project.md')).toContain('\nowner: sam-example\n');
    });
  });

  describe('personal projects git tracks', () => {
    const JEV = 'personal/projects/jev';
    beforeEach(() => put(`${JEV}/project.md`, '---\nv: 1\ntitle: Jev\nstatus: active\n---\n'));

    it('refuses to archive, unarchive or delete one while git tracks a file in it', () => {
      // Not the card (that is checked already): any other file in the folder.
      put(`${JEV}/notes.md`, 'synced by mistake');
      git(['add', '-f', `${JEV}/notes.md`]);
      for (const kind of ['archive', 'delete']) {
        const r = act(kind, 'personal/jev', { check: true });
        expect(refusal(r), kind).toEqual({ exit: 2, error: 'not-allowed' });
        expect(r.reply.message, kind).toContain(`git already syncs files in ${JEV}`);
      }
      expect(existsSync(abs(`${JEV}/project.md`))).toBe(true);
      git(['rm', '-q', '--cached', `${JEV}/notes.md`]);
      expect(act('archive', 'personal/jev', { expect: sha(`${JEV}/project.md`) }).exit).toBe(0);
      git(['add', '-f', 'personal/projects-archive/jev/notes.md']);
      const r = act('unarchive', 'personal/jev', {
        expect: sha('personal/projects-archive/jev/project.md'),
      });
      expect(refusal(r)).toEqual({ exit: 2, error: 'not-allowed' });
      expect(existsSync(abs('personal/projects-archive/jev/project.md'))).toBe(true);
    });

    it("refuses when git can't tell, and allows it when the brain isn't a git repository", () => {
      writeFileSync(join(root, '.git', 'index'), 'not an index');
      const r = act('archive', 'personal/jev', { check: true });
      expect(refusal(r)).toEqual({ exit: 2, error: 'not-allowed' });
      expect(r.reply.message).toContain("git couldn't check");
      rmSync(join(root, '.git'), { recursive: true, force: true });
      expect(act('archive', 'personal/jev', { expect: sha(`${JEV}/project.md`) }).exit).toBe(0);
      expect(existsSync(abs('personal/projects-archive/jev/project.md'))).toBe(true);
    });
  });

  describe('links into archived and moved folders', () => {
    const BRAND = 'clients/acme/projects/brand';
    const BRAND_CARD = '---\nv: 1\ntitle: Brand\nclient: acme\nstatus: active\n---\n';
    const linked = () => parseLinkedFiles(parseFrontmatter(read(`${LIVE}/project.md`)).body);
    beforeEach(() => {
      put(`${BRAND}/project.md`, BRAND_CARD);
      put(`${BRAND}/logo.png`, 'png');
      put('clients/acme/files/quote.pdf', 'pdf');
      for (const p of [`${BRAND}/logo.png`, 'clients/acme/files/quote.pdf']) {
        expect(act('link', 'acme/website', { path: p, expect: sha(`${LIVE}/project.md`) }).exit).toBe(0);
      }
    });

    it('unlinks a link into a project archived since, by the path the app shows', () => {
      expect(act('archive', 'acme/brand', { expect: sha(`${BRAND}/project.md`) }).exit).toBe(0);
      const shown = archivedFolderPath(`${BRAND}/logo.png`, [
        { folder: 'clients/acme/projects-archive/brand', archived: true },
        { folder: LIVE, archived: false },
      ]);
      expect(shown).toBe('clients/acme/projects-archive/brand/logo.png');
      const r = act('unlink', 'acme/website', { path: shown, expect: sha(`${LIVE}/project.md`) });
      expect(r.reply).toMatchObject({ ok: true });
      expect(linked()).toEqual(['clients/acme/files/quote.pdf']);
    });

    it('unlinks a link into a project moved since, by the path the app shows', () => {
      expect(
        act('move', 'acme/brand', { client: 'skyseal', expect: sha(`${BRAND}/project.md`) }).reply,
      ).toMatchObject({ ok: true, key: 'skyseal/brand' });
      const r = act('unlink', 'acme/website', {
        path: 'clients/skyseal/projects/brand/logo.png',
        expect: sha(`${LIVE}/project.md`),
      });
      expect(r.reply).toMatchObject({ ok: true });
      expect(linked()).toEqual(['clients/acme/files/quote.pdf']);
    });

    it('unlinks an old-folder link only by the path the app shows when two projects moved from that key', () => {
      const OLD = 'clients/acme/projects/a';
      put(`${OLD}/a.md`, 'a');
      expect(
        act('link', 'acme/website', { path: `${OLD}/a.md`, expect: sha(`${LIVE}/project.md`) }).exit,
      ).toBe(0);
      rmSync(abs(OLD), { recursive: true });
      const moved = (title: string) => `---\nv: 1\ntitle: ${title}\nmoved_from:\n  - "acme/a"\n---\n`;
      for (const slug of ['b', 'c']) {
        put(`clients/acme/projects/${slug}/project.md`, moved(slug));
        put(`clients/acme/projects/${slug}/a.md`, slug);
      }
      // The app shows the old path under the lowest key holding it: acme/b.
      const cards = ['b', 'c'].map((slug) => ({
        key: `acme/${slug}` as const,
        folder: `clients/acme/projects/${slug}`,
        movedFrom: ['acme/a' as const],
      }));
      expect(movedFolderPath(`${OLD}/a.md`, cards)).toBe('clients/acme/projects/b/a.md');
      const before = read(`${LIVE}/project.md`);
      const c = act('unlink', 'acme/website', {
        path: 'clients/acme/projects/c/a.md',
        expect: sha(`${LIVE}/project.md`),
      });
      expect(c.reply).toMatchObject({ ok: true });
      expect(read(`${LIVE}/project.md`)).toBe(before);
      const b = act('unlink', 'acme/website', {
        path: 'clients/acme/projects/b/a.md',
        expect: sha(`${LIVE}/project.md`),
      });
      expect(b.reply).toMatchObject({ ok: true });
      expect(linked()).not.toContain(`${OLD}/a.md`);
    });

    it('never maps a path into a folder the key does not read, and links files in projects-archive/', () => {
      expect(act('archive', 'acme/brand', { expect: sha(`${BRAND}/project.md`) }).exit).toBe(0);
      // Someone remade the live folder with a card: links into it are its own again.
      put(`${BRAND}/project.md`, BRAND_CARD);
      const before = read(`${LIVE}/project.md`);
      const r = act('unlink', 'acme/website', {
        path: 'clients/acme/projects-archive/brand/logo.png',
        expect: sha(`${LIVE}/project.md`),
      });
      expect(r.reply).toMatchObject({ ok: true });
      expect(read(`${LIVE}/project.md`)).toBe(before);
      put('projects-archive/old/spec.md', 'spec');
      expect(
        act('link', 'acme/website', {
          path: 'projects-archive/old/spec.md',
          expect: sha(`${LIVE}/project.md`),
        }).exit,
      ).toBe(0);
      expect(linked()).toContain('projects-archive/old/spec.md');
    });
  });

  it("refuses to archive what is already archived, and to unarchive what isn't", () => {
    expect(act('archive', 'acme/website', { expect: sha(`${LIVE}/project.md`) }).exit).toBe(0);
    const again = act('archive', 'acme/website', { check: true });
    expect(refusal(again)).toEqual({ exit: 2, error: 'bad-request' });
    expect(again.reply.message).toBe('acme/website is already archived');
    put(`${LIVE.replace('website', 'live')}/project.md`, OWNED);
    const live = act('unarchive', 'acme/live', { check: true });
    expect(refusal(live)).toEqual({ exit: 2, error: 'bad-request' });
    expect(live.reply.message).toBe("acme/live isn't archived");
  });
});

// Projects R2 phase 2 (docs/plans/2026-11-23-projects-r2-updates-log.md): the updates log. `update`
// and `update-remove` (script 0.4), and the automatic entries `edit` writes.
describe('updates log', () => {
  const LIVE = 'clients/acme/projects/website';
  const UPDATES = `${LIVE}/updates`;
  const CARD_TEXT =
    '---\nv: 1\ntitle: Website rebuild\nclient: acme\nstatus: active\nhealth: green\nowner: tess-team\n---\n\nThe brief.\n';
  const as = (email: string) => git(['config', 'user.email', email]);
  const runAt = (action: string, input: Record<string, unknown>, extra: Partial<Ctx> = {}) =>
    projects.run(
      action,
      { kind: action, ...input },
      { root, home, now: T0, keysDir: join(home, 'email-keys'), ...extra },
    );
  const add = (
    entry: Record<string, unknown> = { kind: 'note', summary: 'Sent the quote.', clientSafe: false },
    key = 'acme/website',
    extra: Partial<Ctx> = {},
  ) => runAt('update', { key, entry }, extra);
  const entries = (dir = UPDATES) => (existsSync(abs(dir)) ? readdirSync(abs(dir)).sort() : []);
  const fm = (rel: string) => parseFrontmatter(read(rel));
  const remove = (file: string, expectHash = sha(file), key = 'acme/website') =>
    runAt('update-remove', { key, file, expect: expectHash });
  const editCard = (fields: Record<string, unknown>, extra: Partial<Ctx> = {}) =>
    runAt('edit', { key: 'acme/website', fields, expect: sha(`${LIVE}/project.md`) }, extra);

  beforeEach(() => {
    writeFileSync(join(root, '.gitignore'), 'personal/\n*~\n');
    put(`${LIVE}/project.md`, CARD_TEXT);
  });

  describe('update', () => {
    it('writes one entry in the reserved layout, with who and when from this Mac, never the request', () => {
      const r = runAt('update', {
        key: 'acme/website',
        by: 'olive-owner',
        at: '2020-01-01T00:00:00Z',
        entry: {
          kind: 'call',
          summary: '  Call with Alex:\r\nbudget agreed.  \n',
          clientSafe: true,
          by: 'olive-owner',
          at: '2020-01-01T00:00:00Z',
        },
      });
      expect(r.exit).toBe(0);
      const names = entries();
      expect(names).toHaveLength(1);
      const name = names[0] as string;
      expect(name).toMatch(UPDATE_FILE_PATTERN);
      expect(name).toMatch(/^2026-11-20-1020-sam-example-[a-z0-9]{6}\.md$/);
      expect(r.reply).toEqual({
        ok: true,
        action: 'update',
        key: 'acme/website',
        version: sha(`${LIVE}/project.md`),
        file: `${UPDATES}/${name}`,
      });
      expect(read(`${UPDATES}/${name}`)).toBe(
        '---\nv: 1\nkind: call\nby: sam-example\nat: 2026-11-20T10:20:30Z\nclient_safe: true\n---\n\nCall with Alex:\nbudget agreed.\n',
      );
      expect(fm(`${UPDATES}/${name}`).data).toEqual({
        v: '1',
        kind: 'call',
        by: 'sam-example',
        at: '2026-11-20T10:20:30Z',
        client_safe: 'true',
      });
      expect(read(`${LIVE}/project.md`)).toBe(CARD_TEXT);
    });

    it('names the file by the UK date and time of `at` (BST in summer), and writes client_safe false', () => {
      const r = add(undefined, 'acme/website', { now: new Date('2026-07-01T23:30:00.000Z') });
      expect(r.exit).toBe(0);
      const name = entries()[0] as string;
      expect(name).toMatch(/^2026-07-02-0030-sam-example-[a-z0-9]{6}\.md$/);
      expect(fm(`${UPDATES}/${name}`).data).toMatchObject({
        kind: 'note',
        at: '2026-07-01T23:30:00Z',
        client_safe: 'false',
      });
      expect(fm(`${UPDATES}/${name}`).body).toBe('\nSent the quote.\n');
    });

    it('retries a name that already exists with a new suffix, never overwriting', () => {
      put(`${UPDATES}/2026-11-20-1020-sam-example-aaaaaa.md`, 'theirs');
      const suffixes = ['aaaaaa', 'bbbbbb'];
      const r = add(undefined, 'acme/website', { updateSuffix: () => suffixes.shift() as string });
      expect(r.reply).toMatchObject({ ok: true, file: `${UPDATES}/2026-11-20-1020-sam-example-bbbbbb.md` });
      expect(read(`${UPDATES}/2026-11-20-1020-sam-example-aaaaaa.md`)).toBe('theirs');
      // Every try clashing is an internal failure, and still overwrites nothing.
      const stuck = add(undefined, 'acme/website', { updateSuffix: () => 'aaaaaa' });
      expect(refusal(stuck)).toEqual({ exit: 1, error: 'internal' });
      expect(read(`${UPDATES}/2026-11-20-1020-sam-example-aaaaaa.md`)).toBe('theirs');
      expect(entries().filter((n) => !n.endsWith('.md'))).toEqual([]);
    });

    it('allows a personal project, writing by: me when this Mac has no team slug', () => {
      put('personal/projects/jev/project.md', '---\nv: 1\ntitle: Jev\nstatus: active\n---\n');
      expect(add(undefined, 'personal/jev').reply).toMatchObject({ ok: true });
      expect(entries('personal/projects/jev/updates')[0]).toMatch(/-sam-example-[a-z0-9]{6}\.md$/);
      as('stranger@example.test');
      const r = add({ kind: 'note', summary: 'Mine.', clientSafe: false }, 'personal/jev');
      expect(r.reply).toMatchObject({ ok: true });
      const mine = String(r.reply.file);
      expect(mine).toMatch(/^personal\/projects\/jev\/updates\/2026-11-20-1020-me-[a-z0-9]{6}\.md$/);
      expect(fm(mine).data.by).toBe('me');
      // Someone not on the team can't add to a shared project.
      expect(refusal(add())).toEqual({ exit: 2, error: 'not-allowed' });
      // A personal project git wouldn't ignore is refused, as every personal write is.
      writeFileSync(join(root, '.gitignore'), '*~\n');
      expect(refusal(add(undefined, 'personal/jev'))).toEqual({ exit: 2, error: 'not-allowed' });
      expect(entries('personal/projects/jev/updates')).toHaveLength(2);
    });

    it('refuses an archived project, a folder with no card or an unreadable one, and an unknown key', () => {
      put('clients/acme/projects-archive/old/project.md', '---\nv: 1\ntitle: Old\nstatus: done\n---\n');
      expect(refusal(add(undefined, 'acme/old'))).toEqual({ exit: 2, error: 'not-allowed' });
      mkdirSync(abs('clients/acme/projects/bare'), { recursive: true });
      put('clients/acme/projects/bare/notes.md', 'notes');
      expect(refusal(add(undefined, 'acme/bare'))).toEqual({ exit: 2, error: 'not-allowed' });
      put(
        'clients/acme/projects/merge/project.md',
        '---\n<<<<<<< HEAD\ntitle: A\n=======\ntitle: B\n>>>>>>> x\n---\n',
      );
      expect(refusal(add(undefined, 'acme/merge'))).toEqual({ exit: 2, error: 'not-allowed' });
      expect(refusal(add(undefined, 'acme/nothing'))).toEqual({ exit: 2, error: 'not-found' });
      for (const dir of [
        'clients/acme/projects-archive/old',
        'clients/acme/projects/bare',
        'clients/acme/projects/merge',
      ]) {
        expect(existsSync(abs(`${dir}/updates`)), dir).toBe(false);
      }
    });

    it('refuses an updates folder that is a link or not a folder', () => {
      mkdirSync(abs('clients/acme/elsewhere'), { recursive: true });
      symlinkSync(abs('clients/acme/elsewhere'), abs(UPDATES));
      expect(refusal(add())).toEqual({ exit: 2, error: 'not-allowed' });
      expect(readdirSync(abs('clients/acme/elsewhere'))).toEqual([]);
      rmSync(abs(UPDATES));
      put(UPDATES, 'a file');
      expect(refusal(add())).toEqual({ exit: 2, error: 'not-allowed' });
      expect(read(UPDATES)).toBe('a file');
    });

    it('refuses an empty or over-long summary, and any kind but note or call', () => {
      const bad = [
        undefined,
        null,
        'note',
        { kind: 'note', summary: '   \n ', clientSafe: false },
        { kind: 'note', summary: 'x'.repeat(UPDATE_SUMMARY_MAX + 1), clientSafe: false },
        { kind: 'note', summary: 42, clientSafe: false },
        { kind: 'note', summary: 'Hi', clientSafe: 'yes' },
        { kind: 'note', summary: 'Hi' },
        { kind: 'status', summary: 'Status: Active → Done.', clientSafe: false },
        { kind: 'owner', summary: 'Hi', clientSafe: false },
        { kind: 'email', summary: 'Hi', clientSafe: false },
        { summary: 'Hi', clientSafe: false },
        { kind: 'note', summary: 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> x\n', clientSafe: false },
        { kind: 'note', summary: 'nul\u0000inside', clientSafe: false },
      ];
      for (const entry of bad) {
        const r = runAt('update', { key: 'acme/website', entry });
        expect(refusal(r), JSON.stringify(entry)).toEqual({ exit: 2, error: 'bad-request' });
      }
      expect(entries()).toEqual([]);
      // Exactly the limit, after trimming, is fine.
      const r = add({ kind: 'note', summary: ` ${'x'.repeat(UPDATE_SUMMARY_MAX)} `, clientSafe: false });
      expect(r.reply).toMatchObject({ ok: true });
    });
  });

  describe('update-remove', () => {
    // An entry file as another Mac would have written it.
    const entry = (by: string, kind = 'note', name = `2026-11-19-0900-${by}-abc123.md`) => {
      const rel = `${UPDATES}/${name}`;
      put(
        rel,
        `---\nv: 1\nkind: ${kind}\nby: ${by}\nat: 2026-11-19T09:00:00Z\nclient_safe: false\n---\n\nHello.\n`,
      );
      return rel;
    };

    it('lets the author remove their own note, answering the card version', () => {
      const r = add();
      const file = String(r.reply.file);
      expect(remove(file)).toEqual({
        exit: 0,
        reply: { ok: true, action: 'update-remove', key: 'acme/website', version: sha(`${LIVE}/project.md`) },
      });
      expect(existsSync(abs(file))).toBe(false);
      expect(read(`${LIVE}/project.md`)).toBe(CARD_TEXT);
    });

    it("lets the brain's Owner and a scout remove anyone's note or call, and nobody else", () => {
      const tess = entry('tess-team');
      const call2 = entry('tess-team', 'call', '2026-11-19-0901-tess-team-def456.md');
      as('terry@example.test');
      const r = remove(tess);
      expect(refusal(r)).toEqual({ exit: 2, error: 'not-allowed' });
      expect(existsSync(abs(tess))).toBe(true);
      as('olive@example.test');
      expect(remove(tess).reply).toMatchObject({ ok: true });
      as('sam@example.test');
      expect(remove(call2).reply).toMatchObject({ ok: true });
      as('tess@example.test');
      const own = entry('tess-team', 'note', '2026-11-19-0902-tess-team-ghi789.md');
      expect(remove(own).reply).toMatchObject({ ok: true });
      // Someone not on the team can't remove even their own from a shared project.
      as('stranger@example.test');
      const theirs = entry('stranger');
      expect(refusal(remove(theirs))).toEqual({ exit: 2, error: 'not-allowed' });
    });

    it('never removes an automatic entry or a later kind, even for the Owner', () => {
      as('olive@example.test');
      for (const [kind, name] of [
        ['status', '2026-11-19-0900-olive-owner-aaa111.md'],
        ['owner', '2026-11-19-0900-olive-owner-aaa222.md'],
        ['digest', '2026-11-19-0900-olive-owner-aaa444.md'],
      ] as const) {
        const file = entry('olive-owner', kind, name);
        expect(refusal(remove(file)), kind).toEqual({ exit: 2, error: 'not-allowed' });
        expect(existsSync(abs(file))).toBe(true);
      }
      put(`${UPDATES}/2026-11-19-0900-olive-owner-bad000.md`, 'no frontmatter');
      expect(refusal(remove(`${UPDATES}/2026-11-19-0900-olive-owner-bad000.md`))).toEqual({
        exit: 2,
        error: 'not-allowed',
      });
    });

    it('refuses with changed when the entry differs from the one read, and needs expect', () => {
      const file = entry('sam-example');
      expect(refusal(remove(file, 'a'.repeat(64)))).toEqual({ exit: 2, error: 'changed' });
      expect(refusal(runAt('update-remove', { key: 'acme/website', file }))).toEqual({
        exit: 2,
        error: 'bad-request',
      });
      expect(existsSync(abs(file))).toBe(true);
    });

    it("refuses anything but a file in this project's own updates folder", () => {
      const file = entry('sam-example');
      put('clients/acme/projects/other/project.md', CARD_TEXT);
      const otherFile = `clients/acme/projects/other/updates/2026-11-19-0900-sam-example-abc123.md`;
      put(otherFile, read(file));
      put(`${UPDATES}/notes.md`, 'x');
      const h = sha(file);
      for (const bad of [
        `${LIVE}/project.md`,
        otherFile,
        `${UPDATES}/notes.md`,
        `${UPDATES}/../updates/2026-11-19-0900-sam-example-abc123.md`,
        `${UPDATES}/sub/2026-11-19-0900-sam-example-abc123.md`,
        `/${file}`,
        file.toUpperCase(),
        '',
        42,
      ]) {
        expect(
          refusal(runAt('update-remove', { key: 'acme/website', file: bad, expect: h })),
          String(bad),
        ).toEqual({
          exit: 2,
          error: 'bad-request',
        });
      }
      expect(refusal(remove(`${UPDATES}/2026-11-19-0900-sam-example-zzz999.md`, h))).toEqual({
        exit: 2,
        error: 'not-found',
      });
      expect(existsSync(abs(file))).toBe(true);
      expect(existsSync(abs(otherFile))).toBe(true);
    });

    it('refuses an entry that is a link, an updates folder that is a link, and an archived project', () => {
      put('clients/acme/target.md', '---\nv: 1\nkind: note\nby: sam-example\n---\n\nx\n');
      mkdirSync(abs(UPDATES), { recursive: true });
      const linkName = `${UPDATES}/2026-11-19-0900-sam-example-lnk111.md`;
      symlinkSync(abs('clients/acme/target.md'), abs(linkName));
      expect(refusal(remove(linkName, sha('clients/acme/target.md')))).toEqual({
        exit: 2,
        error: 'not-allowed',
      });
      expect(existsSync(abs('clients/acme/target.md'))).toBe(true);
      rmSync(abs(UPDATES), { recursive: true });
      mkdirSync(abs('clients/acme/elsewhere'), { recursive: true });
      put('clients/acme/elsewhere/2026-11-19-0900-sam-example-abc123.md', 'x');
      symlinkSync(abs('clients/acme/elsewhere'), abs(UPDATES));
      expect(
        refusal(
          remove(
            `${UPDATES}/2026-11-19-0900-sam-example-abc123.md`,
            sha('clients/acme/elsewhere/2026-11-19-0900-sam-example-abc123.md'),
          ),
        ),
      ).toEqual({ exit: 2, error: 'not-allowed' });
      expect(existsSync(abs('clients/acme/elsewhere/2026-11-19-0900-sam-example-abc123.md'))).toBe(true);
      // Archived: read only.
      put('clients/acme/projects-archive/old/project.md', '---\nv: 1\ntitle: Old\nstatus: done\n---\n');
      const old = 'clients/acme/projects-archive/old/updates/2026-11-19-0900-sam-example-abc123.md';
      put(
        old,
        '---\nv: 1\nkind: note\nby: sam-example\nat: 2026-11-19T09:00:00Z\nclient_safe: false\n---\n\nx\n',
      );
      expect(refusal(remove(old, sha(old), 'acme/old'))).toEqual({ exit: 2, error: 'not-allowed' });
      expect(existsSync(abs(old))).toBe(true);
    });

    it("lets a personal project's entries by me be removed", () => {
      put('personal/projects/jev/project.md', '---\nv: 1\ntitle: Jev\nstatus: active\n---\n');
      as('stranger@example.test');
      const file = String(add(undefined, 'personal/jev').reply.file);
      expect(remove(file, sha(file), 'personal/jev').reply).toMatchObject({
        ok: true,
        action: 'update-remove',
      });
      expect(existsSync(abs(file))).toBe(false);
    });
  });

  describe('automatic entries on edit', () => {
    const autoEntries = () =>
      entries().map((n) => {
        const f = fm(`${UPDATES}/${n}`);
        return { ...f.data, body: f.body } as Record<string, unknown>;
      });

    it('writes one internal entry per changed status, health and Account Owner, with the fixed wording and facts', () => {
      const r = editCard({ status: 'on-hold', health: 'amber', owner: 'olive-owner', title: 'Relaunch' });
      expect(r).toEqual({
        exit: 0,
        reply: { ok: true, action: 'edit', key: 'acme/website', version: sha(`${LIVE}/project.md`) },
      });
      const names = entries();
      expect(names).toHaveLength(3);
      for (const n of names) expect(n).toMatch(/^2026-11-20-1020-sam-example-[a-z0-9]{6}\.md$/);
      const got = autoEntries().sort((a, b) => String(a.change).localeCompare(String(b.change)));
      const base = { v: '1', by: 'sam-example', at: '2026-11-20T10:20:30Z', client_safe: 'false' };
      expect(got).toEqual([
        {
          ...base,
          kind: 'status',
          change: 'health',
          from: 'green',
          to: 'amber',
          body: '\nHealth: On track → At risk.\n',
        },
        {
          ...base,
          kind: 'owner',
          change: 'owner',
          from: 'tess-team',
          to: 'olive-owner',
          body: '\nAccount Owner: Tess Team → Olive Owner.\n',
        },
        {
          ...base,
          kind: 'status',
          change: 'status',
          from: 'active',
          to: 'on-hold',
          body: '\nStatus: Active → On hold.\n',
        },
      ]);
      expect(read(`${UPDATES}/${names[0]}`)).toMatch(
        /^---\nv: 1\nkind: (status|owner)\nby: sam-example\nat: 2026-11-20T10:20:30Z\nclient_safe: false\nchange: \w+\nfrom: [a-z-]+\nto: [a-z-]+\n---\n\n.+\n$/,
      );
    });

    it('writes "not set" and "nobody" for cleared values, with empty raw values', () => {
      expect(editCard({ health: null, owner: null }).reply).toMatchObject({ ok: true });
      const got = autoEntries().sort((a, b) => String(a.change).localeCompare(String(b.change)));
      expect(got.map((e) => [e.change, e.from, e.to, e.body])).toEqual([
        ['health', 'green', '', '\nHealth: On track → not set.\n'],
        ['owner', 'tess-team', '', '\nAccount Owner: Tess Team → nobody.\n'],
      ]);
      for (const n of entries()) expect(read(`${UPDATES}/${n}`)).toContain('\nto: ""\n');
      rmSync(abs(UPDATES), { recursive: true });
      expect(editCard({ health: 'red', status: 'done' }).reply).toMatchObject({ ok: true });
      const again = autoEntries().sort((a, b) => String(a.change).localeCompare(String(b.change)));
      expect(again.map((e) => [e.change, e.from, e.to, e.body])).toEqual([
        ['health', '', 'red', '\nHealth: not set → Off track.\n'],
        ['status', 'active', 'done', '\nStatus: Active → Done.\n'],
      ]);
    });

    it('writes nothing when the values are sent back unchanged, or for other fields', () => {
      const r = editCard({
        status: 'active',
        health: 'green',
        owner: 'tess-team',
        comms: 'red',
        start: '2026-11-01',
        title: 'Same project',
        brief: 'New brief.',
      });
      expect(r.reply).toMatchObject({ ok: true });
      expect(r.reply.updatesFailed).toBeUndefined();
      expect(existsSync(abs(UPDATES))).toBe(false);
      // A card with no status line yet gains one: that is a change.
      put(`${LIVE}/project.md`, CARD_TEXT.replace('status: active\n', ''));
      expect(editCard({ status: 'planned' }).reply).toMatchObject({ ok: true });
      expect(autoEntries().map((e) => e.body)).toEqual(['\nStatus: not set → Planned.\n']);
    });

    it('keeps the card change when an entry cannot be written, answering updatesFailed', () => {
      put(UPDATES, 'a file');
      const r = editCard({ status: 'done' });
      expect(r).toEqual({
        exit: 0,
        reply: {
          ok: true,
          action: 'edit',
          key: 'acme/website',
          version: sha(`${LIVE}/project.md`),
          updatesFailed: true,
        },
      });
      expect(read(`${LIVE}/project.md`)).toContain('\nstatus: done\n');
      rmSync(abs(UPDATES));
      mkdirSync(abs('clients/acme/elsewhere'), { recursive: true });
      symlinkSync(abs('clients/acme/elsewhere'), abs(UPDATES));
      const r2 = editCard({ status: 'active' });
      expect(r2.reply).toMatchObject({ ok: true, updatesFailed: true });
      expect(read(`${LIVE}/project.md`)).toContain('\nstatus: active\n');
      expect(readdirSync(abs('clients/acme/elsewhere'))).toEqual([]);
    });

    it('writes them for a personal project too', () => {
      put('personal/projects/jev/project.md', '---\nv: 1\ntitle: Jev\nstatus: active\n---\n');
      as('stranger@example.test');
      const r = runAt('edit', {
        key: 'personal/jev',
        fields: { status: 'on-hold' },
        expect: sha('personal/projects/jev/project.md'),
      });
      expect(r.reply).toMatchObject({ ok: true });
      expect(r.reply.updatesFailed).toBeUndefined();
      const names = entries('personal/projects/jev/updates');
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(/^2026-11-20-1020-me-[a-z0-9]{6}\.md$/);
      expect(fm(`personal/projects/jev/updates/${names[0]}`).data).toMatchObject({
        kind: 'status',
        by: 'me',
        change: 'status',
        from: 'active',
        to: 'on-hold',
      });
    });
  });

  it('runs update from the command line', () => {
    const out = spawnSync(process.execPath, [SCRIPT, 'update'], {
      input: JSON.stringify({
        kind: 'update',
        key: 'acme/website',
        entry: { kind: 'note', summary: 'From the shell.', clientSafe: false },
      }),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, BRAIN_ROOT: root, GIT_CONFIG_NOSYSTEM: '1' },
    });
    expect(out.status).toBe(0);
    const reply = JSON.parse(out.stdout);
    expect(reply).toMatchObject({ ok: true, action: 'update', key: 'acme/website' });
    expect(read(reply.file)).toContain('\n\nFrom the shell.\n');
  });

  it('is documented in the skill file', () => {
    const skill = readFileSync(fileURLToPath(new URL('../SKILL.md', import.meta.url)), 'utf8');
    expect(skill).toContain('| `update` |');
    expect(skill).toContain('| `update-remove` |');
    expect(skill).toContain(PROJECTS_UPDATES_CAPABILITY);
  });
});

// Projects R2 phase 5 (docs/plans/2026-11-24-projects-r2-email-entries.md, contract
// shared/project-email-contract.ts): email drafts wait on the inbox owner's Mac, and only their
// approval (the draft's token, read by the server on Save) writes an `email` entry.
describe('email entries', () => {
  const LIVE = 'clients/acme/projects/website';
  const UPDATES = `${LIVE}/updates`;
  const OTHER = 'clients/skyseal/projects/roof';
  const DRAFTS = EMAIL_DRAFTS_DIR;
  const CARD_TEXT =
    '---\nv: 1\ntitle: Website rebuild\nclient: acme\nref: ACM4K7\nstatus: active\n---\n\nThe brief.\n';
  const DAY = 24 * 60 * 60 * 1000;
  const as = (email: string) => git(['config', 'user.email', email]);
  const replies: Reply[] = [];
  const runAt = (action: string, input: Record<string, unknown>, extra: Partial<Ctx> = {}) => {
    const r = projects.run(
      action,
      { kind: action, ...input },
      { root, home, now: T0, keysDir: join(home, 'email-keys'), ...extra },
    );
    replies.push(r.reply);
    return r;
  };
  const DRAFT = {
    threadId: '18c2f0a1b2c3d4e5',
    inboxAddress: 'sam@example.test',
    subject: 'Re: Budget for December [ACM4K7]',
    from: { name: 'Alex Smith', address: 'Alex@Client.Example' },
    people: [
      { name: 'Sam Example', address: 'sam@example.test' },
      { name: null, address: 'ops@client.example' },
    ],
    sentAt: '2026-11-19T16:30:12Z',
    summary: 'Alex agreed the December budget.',
    newestText:
      'Yes, go ahead with sky4k7 please.\n> On Monday you wrote ACM2C3\n  > and ACM3D4\n\n-- \nAlex Smith ACM9X9',
  };
  const KEY = `x:${createHash('sha256')
    .update('alex@client.example\n2026-11-19T16:30\nbudget for december [acm4k7]')
    .digest('hex')}`;
  const draft = (over: Record<string, unknown> = {}, extra: Partial<Ctx> = {}) =>
    runAt('email-draft', { ...DRAFT, ...over }, extra);
  const draftFiles = () =>
    existsSync(abs(DRAFTS))
      ? readdirSync(abs(DRAFTS))
          .filter((n) => EMAIL_DRAFT_FILE_PATTERN.test(n))
          .sort()
      : [];
  const tokens = new Set<string>();
  const keyPath = (id: string) => join(home, 'email-keys', `${id}.key`);
  const keyOf = (id: string) => {
    const key = JSON.parse(readFileSync(keyPath(id), 'utf8')) as {
      token: string;
      draft_sha256: string;
      brain: string;
    };
    tokens.add(key.token);
    return key;
  };
  const draftOf = (id: string) => {
    const file = JSON.parse(read(`${DRAFTS}/${id}.json`));
    if (existsSync(keyPath(id))) keyOf(id);
    return file;
  };
  const newDraft = (over: Record<string, unknown> = {}, extra: Partial<Ctx> = {}) => {
    const r = draft(over, extra);
    expect(r.reply, JSON.stringify(r.reply)).toMatchObject({ ok: true });
    const id = String(r.reply.id);
    draftOf(id);
    return id;
  };
  const approve = (
    id: string,
    over: Record<string, unknown> = {},
    key = 'acme/website',
    extra: Partial<Ctx> = {},
  ) =>
    runAt(
      'update',
      {
        key,
        entry: {
          kind: 'email',
          draft: id,
          token: existsSync(keyPath(id)) ? keyOf(id).token : '0'.repeat(32),
          summary: 'Alex agreed the December budget.',
          subject: 'Budget for December',
          from: 'Alex Smith',
          people: ['Sam Example', 'ops'],
          clientSafe: false,
          ...over,
        },
      },
      extra,
    );
  const entries = (dir = UPDATES) => (existsSync(abs(dir)) ? readdirSync(abs(dir)).sort() : []);
  // An email entry as another Mac would have written it.
  const emailEntry = (
    dir: string,
    by: string,
    key: string,
    name = `2026-11-19-0900-${by}-eee111.md`,
    extra = '',
  ) => {
    const rel = `${dir}/${name}`;
    put(
      rel,
      `---\nv: 1\nkind: email\nby: ${by}\nat: 2026-11-19T09:00:00Z\nclient_safe: false\nemail_subject: Hi\nemail_from: Alex\nemail_key: ${key}\nemail_inbox_owner: ${by}\n${extra}---\n\nHello.\n`,
    );
    return rel;
  };
  const mode = (rel: string) => statSync(abs(rel)).mode & 0o777;

  beforeEach(() => {
    replies.length = 0;
    writeFileSync(join(root, '.gitignore'), 'personal/\n*~\nbriefing/email-drafts/\n');
    put(`${LIVE}/project.md`, CARD_TEXT);
    put(`${OTHER}/project.md`, '---\nv: 1\ntitle: Roof\nclient: skyseal\n---\n');
  });

  afterEach(() => {
    // No reply, ever, holds a draft's approve_token.
    for (const name of draftFiles()) {
      try {
        draftOf(name.replace(/\.json$/, ''));
      } catch {
        // not a draft
      }
    }
    for (const token of tokens) for (const r of replies) expect(JSON.stringify(r)).not.toContain(token);
    tokens.clear();
  });

  describe('email-draft', () => {
    it('writes one private draft with the facts, the codes and a token, and answers only its id', () => {
      const r = draft({
        inboxOwner: 'olive-owner',
        inbox_owner: 'olive-owner',
        approve_token: 'f'.repeat(32),
      });
      expect(r.exit).toBe(0);
      const id = String(r.reply.id);
      expect(id).toMatch(/^[a-z0-9]{12}$/);
      expect(r.reply).toEqual({ ok: true, action: 'email-draft', id });
      expect(draftFiles()).toEqual([`${id}.json`]);
      const file = draftOf(id);
      expect(file).toEqual({
        v: 1,
        id,
        inbox_owner: 'sam-example',
        created_at: '2026-11-20T10:20:30Z',
        thread_id: '18c2f0a1b2c3d4e5',
        email_key: KEY,
        thread_message_ids: [],
        subject: 'Re: Budget for December [ACM4K7]',
        from: { name: 'Alex Smith', address: 'Alex@Client.Example' },
        from_domain: 'client.example',
        people: DRAFT.people,
        sent_at: '2026-11-19T16:30:12Z',
        summary: 'Alex agreed the December budget.',
        codes_subject: ['ACM4K7'],
        codes_body: ['SKY4K7'],
        requested: null,
      });
      // The token lives outside the brain, with the SHA-256 of the draft's bytes and the brain it belongs to.
      const key = keyOf(id);
      expect(key.token).toMatch(/^[0-9a-f]{32}$/);
      expect(key.token).not.toBe('f'.repeat(32));
      expect(key.draft_sha256).toBe(
        createHash('sha256')
          .update(readFileSync(abs(`${DRAFTS}/${id}.json`)))
          .digest('hex'),
      );
      expect(key.brain).toBe(realpathSync.native(root));
      expect(read(`${DRAFTS}/${id}.json`)).not.toContain(key.token);
      expect(statSync(join(home, 'email-keys')).mode & 0o777).toBe(0o700);
      expect(statSync(keyPath(id)).mode & 0o777).toBe(0o600);
      // The newest message's text is read for codes and dropped.
      const text = read(`${DRAFTS}/${id}.json`);
      expect(text).not.toContain('go ahead');
      expect(text).not.toContain('newest');
      expect(mode(DRAFTS)).toBe(0o700);
      expect(mode(`${DRAFTS}/${id}.json`)).toBe(0o600);
      // Nothing else lands in the folder (no temp files left behind).
      expect(readdirSync(abs(DRAFTS))).toEqual([`${id}.json`]);
    });

    it('keys an email by its Message-ID when given, angle brackets or not, and keeps the thread ids', () => {
      const a = newDraft({
        messageId: '<abc.123@mail.client.example>',
        threadMessageIds: ['older@x.example'],
      });
      expect(draftOf(a)).toMatchObject({
        email_key: '<abc.123@mail.client.example>',
        thread_message_ids: ['<older@x.example>'],
      });
      const b = newDraft({ messageId: 'abc.123@mail.client.example' });
      // The same key replaces the waiting draft.
      expect(draftFiles()).toEqual([`${b}.json`]);
      expect(draftOf(b).email_key).toBe('<abc.123@mail.client.example>');
    });

    it('derives the same key whatever the Re:/Fwd: prefixes, case, spacing and seconds', () => {
      const a = newDraft();
      expect(draftOf(a).email_key).toBe(KEY);
      const b = newDraft({
        subject: 'RE: Fwd: fw:  budget for   DECEMBER [acm4k7] ',
        sentAt: '2026-11-19T16:30:59.900Z',
        from: { name: 'Alex', address: 'alex@client.example' },
      });
      expect(draftOf(b).email_key).toBe(KEY);
      expect(draftFiles()).toEqual([`${b}.json`]);
      // A different minute is a different email.
      const c = newDraft({ sentAt: '2026-11-19T16:31:00Z' });
      expect(draftOf(c).email_key).not.toBe(KEY);
      expect(draftFiles()).toHaveLength(2);
      // In another time zone, the same minute in UTC.
      const d = newDraft({ sentAt: '2026-11-19T17:30:12+01:00' });
      expect(draftOf(d).email_key).toBe(KEY);
    });

    it('finds codes only in the newest text itself: quoted lines and the signature skipped, distinct, upper case', () => {
      const id = newDraft({
        subject: 'Two codes ACM4K7 and acm4k7, and SKY4K7 [ACM1X1] ACM',
        newestText:
          'About SKY4K7 and sky4k7 and ACM4K7.\r\n>ACM2C3\r\n--\r\nACM3D4 still body\r\n-- \r\nACM5E5',
      });
      expect(draftOf(id)).toMatchObject({
        codes_subject: ['ACM4K7', 'SKY4K7'],
        codes_body: ['SKY4K7', 'ACM4K7', 'ACM3D4'],
      });
    });

    it('records who from this Mac, and refuses an inbox that is not theirs', () => {
      expect(draft({ inboxAddress: 'SAM@Example.TEST' }).reply).toMatchObject({ ok: true });
      expect(refusal(draft({ inboxAddress: 'olive@example.test' }))).toEqual({
        exit: 2,
        error: 'not-allowed',
      });
      as('tess@example.test');
      expect(refusal(draft())).toEqual({ exit: 2, error: 'not-allowed' });
      const id = newDraft({ inboxAddress: 'tess@example.test' });
      expect(draftOf(id).inbox_owner).toBe('tess-team');
      as('stranger@example.test');
      expect(refusal(draft({ inboxAddress: 'stranger@example.test' }))).toEqual({
        exit: 2,
        error: 'not-allowed',
      });
    });

    it('refuses when git does not ignore the drafts folder, or it is a link, or git cannot tell', () => {
      writeFileSync(join(root, '.gitignore'), 'personal/\n');
      expect(refusal(draft())).toEqual({ exit: 2, error: 'not-allowed' });
      expect(existsSync(abs(DRAFTS))).toBe(false);
      writeFileSync(
        join(root, '.gitignore'),
        'personal/\nbriefing/email-drafts/*\n!briefing/email-drafts/dismissed-*\n',
      );
      expect(refusal(draft())).toEqual({ exit: 2, error: 'not-allowed' });
      writeFileSync(join(root, '.gitignore'), 'briefing/\n');
      const elsewhere = mkdtempSync(join(tmpdir(), 'drafts-elsewhere-'));
      try {
        mkdirSync(abs('briefing'));
        symlinkSync(elsewhere, abs(DRAFTS));
        expect(refusal(draft())).toEqual({ exit: 2, error: 'not-allowed' });
        expect(readdirSync(elsewhere)).toEqual([]);
        rmSync(abs(DRAFTS));
        rmSync(abs('briefing'), { recursive: true });
        symlinkSync(elsewhere, abs('briefing'));
        expect(refusal(draft())).toEqual({ exit: 2, error: 'not-allowed' });
        expect(readdirSync(elsewhere)).toEqual([]);
      } finally {
        rmSync(abs('briefing'), { force: true });
        rmSync(elsewhere, { recursive: true, force: true });
      }
      // Not a git repository: nothing can say it stays on this Mac.
      writeFileSync(join(root, '.gitignore'), 'briefing/email-drafts/\n');
      rmSync(abs('.git'), { recursive: true });
      expect(refusal(draft())).toEqual({ exit: 2, error: 'not-allowed' });
    });

    it('tightens the folder and file modes it finds', () => {
      mkdirSync(abs(DRAFTS), { recursive: true, mode: 0o755 });
      const id = newDraft();
      expect(mode(DRAFTS)).toBe(0o700);
      expect(mode(`${DRAFTS}/${id}.json`)).toBe(0o600);
    });

    it('refuses bad or over-long fields and any bcc', () => {
      const bad: Record<string, unknown>[] = [
        { bcc: [{ name: null, address: 'x@y.example' }] },
        { from: { name: 'A', address: 'a@b.example', bcc: 'x@y.example' } },
        { people: [{ name: 'A', address: 'a@b.example', BCC: true }] },
        { extra: { deep: [{ bcc: null }] } },
        { threadId: 'not-hex!' },
        { threadId: '12ab' },
        { threadId: 'a'.repeat(33) },
        { threadId: undefined },
        { inboxAddress: undefined },
        { subject: 'Line one\nline two' },
        { subject: 'x'.repeat(EMAIL_SUBJECT_MAX + 1) },
        { subject: 5 },
        { from: { name: 'Alex\nSmith', address: 'alex@client.example' } },
        { from: { name: 'A'.repeat(EMAIL_NAME_MAX + 1), address: 'alex@client.example' } },
        { from: { name: 'Alex', address: 'not an address' } },
        { from: { name: 'Alex', address: 'alex@' } },
        { from: { name: 'Alex', address: `${'a'.repeat(EMAIL_PERSON_MAX)}@client.example` } },
        { from: 'Alex <alex@client.example>' },
        { people: 'everyone' },
        { people: [{ name: 'A', address: 'no-at-sign' }] },
        {
          people: Array.from({ length: EMAIL_PEOPLE_MAX + 1 }, (_, i) => ({
            name: null,
            address: `p${i}@x.example`,
          })),
        },
        { messageId: '<has space@x.example>' },
        { messageId: `<${'a'.repeat(MESSAGE_ID_MAX)}@x>` },
        { messageId: '' },
        { messageId: '<>' },
        { threadMessageIds: Array.from({ length: EMAIL_THREAD_IDS_MAX + 1 }, (_, i) => `<m${i}@x.example>`) },
        { threadMessageIds: ['<a b@x>'] },
        { sentAt: 'yesterday' },
        { sentAt: '2026-02-30T10:00:00Z' },
        { summary: '   ' },
        { summary: 'x'.repeat(UPDATE_SUMMARY_MAX + 1) },
        { newestText: 'x'.repeat(EMAIL_NEWEST_TEXT_MAX + 1) },
        { newestText: undefined },
        { requested: 'not a key' },
      ];
      for (const over of bad) {
        expect(refusal(draft(over)), JSON.stringify(over).slice(0, 80)).toEqual({
          exit: 2,
          error: 'bad-request',
        });
      }
      expect(draftFiles()).toEqual([]);
      // At the limits is fine.
      expect(
        draft({
          subject: 'x'.repeat(EMAIL_SUBJECT_MAX),
          threadId: 'a'.repeat(32),
          newestText: 'x'.repeat(EMAIL_NEWEST_TEXT_MAX),
          people: Array.from({ length: EMAIL_PEOPLE_MAX }, (_, i) => ({
            name: null,
            address: `p${i}@x.example`,
          })),
        }).reply,
      ).toMatchObject({ ok: true });
    });

    it('keeps the largest call it accepts under the 20,000-character command limit', () => {
      const person = (i: number) => ({
        name: `N${i}`.padEnd(EMAIL_NAME_MAX, 'n'),
        address: `${String(i).padStart(3, '0')}@${'d'.repeat(EMAIL_PERSON_MAX - EMAIL_NAME_MAX - 20)}.example`,
      });
      const big = (summaryLength: number, threadIds = EMAIL_THREAD_IDS_MAX) => ({
        ...DRAFT,
        threadId: 'a'.repeat(32),
        messageId: `<${'m'.repeat(MESSAGE_ID_MAX - 15)}@mail.example>`,
        threadMessageIds: Array.from(
          { length: threadIds },
          (_, i) => `<${String(i).padStart(2, '0')}${'t'.repeat(MESSAGE_ID_MAX - 17)}@mail.example>`,
        ),
        subject: 's'.repeat(EMAIL_SUBJECT_MAX),
        from: person(999),
        people: Array.from({ length: EMAIL_PEOPLE_MAX }, (_, i) => person(i)),
        summary: 'y'.repeat(summaryLength),
        newestText: 'z'.repeat(EMAIL_NEWEST_TEXT_MAX),
        requested: 'acme/website',
      });
      // Every field at its own limit together is too long for one command, so it is refused.
      expect(refusal(runAt('email-draft', big(UPDATE_SUMMARY_MAX)))).toEqual({
        exit: 2,
        error: 'bad-request',
      });
      expect(refusal(runAt('email-draft', big(1)))).toEqual({ exit: 2, error: 'bad-request' });
      // The largest summary accepted beside the other fields at their limits (no thread ids).
      let lo = 0;
      let hi = UPDATE_SUMMARY_MAX;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (runAt('email-draft', big(mid, 0)).exit === 0) lo = mid;
        else hi = mid - 1;
      }
      expect(lo).toBeGreaterThan(1000);
      expect(lo).toBeLessThan(UPDATE_SUMMARY_MAX);
      expect(runAt('email-draft', big(lo, 0)).exit).toBe(0);
      expect(runAt('email-draft', big(lo + 1, 0)).exit).toBe(2);
      // As the command would send it, with its kind.
      expect(JSON.stringify({ kind: 'email-draft', ...big(lo, 0) }).length).toBeLessThan(20_000);
    });

    it('stores a requested project only when it is live with a card', () => {
      const id = newDraft({ requested: 'skyseal/roof' });
      expect(draftOf(id).requested).toBe('skyseal/roof');
      put('clients/acme/projects-archive/old/project.md', '---\nv: 1\ntitle: Old\n---\n');
      put('clients/acme/projects/bare/notes.md', 'no card');
      for (const requested of ['acme/old', 'acme/bare', 'acme/nothing']) {
        expect(refusal(draft({ requested })), requested).toEqual({ exit: 2, error: 'not-found' });
      }
    });

    it('replaces a waiting draft of the same email from the same owner, never another owner', () => {
      as('tess@example.test');
      const tess = newDraft({ inboxAddress: 'tess@example.test' });
      as('sam@example.test');
      const a = newDraft();
      const b = newDraft({ summary: 'A better summary.' });
      expect(b).not.toBe(a);
      expect(draftFiles().sort()).toEqual([`${b}.json`, `${tess}.json`].sort());
      expect(draftOf(b).summary).toBe('A better summary.');
    });

    it('deletes drafts older than 30 days, any owner, and keeps younger ones', () => {
      as('tess@example.test');
      const old = newDraft({ inboxAddress: 'tess@example.test' });
      const young = newDraft(
        { inboxAddress: 'tess@example.test', subject: 'Another' },
        { now: new Date(T0.getTime() + 2 * DAY) },
      );
      as('sam@example.test');
      put(`${DRAFTS}/zzzzzzzzzzzz.json`, 'not json');
      const later = new Date(T0.getTime() + (DRAFT_MAX_AGE_DAYS + 1) * DAY);
      const mine = newDraft({}, { now: later });
      expect(draftFiles().sort()).toEqual([`${mine}.json`, `${young}.json`, 'zzzzzzzzzzzz.json'].sort());
      expect(existsSync(abs(`${DRAFTS}/${old}.json`))).toBe(false);
    });

    it('refuses an email already in any project, answering where', () => {
      const file = emailEntry(`${OTHER}/updates`, 'tess-team', KEY);
      const r = draft();
      expect(r.exit).toBe(2);
      expect(r.reply).toMatchObject({ ok: false, error: 'exists', file, key: 'skyseal/roof' });
      expect(draftFiles()).toEqual([]);
      // An old file's email_message_id counts for a Message-ID too.
      const old = emailEntry(
        `${LIVE}/updates`,
        'terry-team',
        'x:other',
        '2026-11-18-0900-terry-team-eee222.md',
        'email_message_id: <old@mail.example>\n',
      );
      expect(draft({ messageId: '<old@mail.example>' }).reply).toMatchObject({
        error: 'exists',
        file: old,
        key: 'acme/website',
      });
      // A note mentioning the key is not an email entry.
      put(
        `${LIVE}/updates/2026-11-18-0900-terry-team-nnn333.md`,
        '---\nv: 1\nkind: note\nby: terry-team\nat: 2026-11-18T09:00:00Z\nclient_safe: false\nemail_key: <new@mail.example>\n---\n\nHi.\n',
      );
      expect(draft({ messageId: '<new@mail.example>' }).reply).toMatchObject({ ok: true });
    });

    it('runs from the command line: one JSON line (a refusal, so no key is written outside the test)', () => {
      const id = newDraft();
      expect(runAt('email-draft-remove', { id, dismiss: true }).reply).toMatchObject({ ok: true });
      const again = spawnSync(process.execPath, [SCRIPT, 'email-draft'], {
        input: JSON.stringify(DRAFT),
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: home, BRAIN_ROOT: root, GIT_CONFIG_NOSYSTEM: '1' },
      });
      expect(again.status).toBe(2);
      expect(again.stdout.split('\n').filter(Boolean)).toHaveLength(1);
      expect(JSON.parse(again.stdout)).toMatchObject({ ok: false, error: 'dismissed' });
    });
  });

  describe('email-draft-remove', () => {
    it("removes the owner's draft; dismissing records the key with today's date, for this owner only", () => {
      const id = newDraft();
      expect(runAt('email-draft-remove', { id, dismiss: true })).toEqual({
        exit: 0,
        reply: { ok: true, action: 'email-draft-remove', id },
      });
      expect(draftFiles()).toEqual([]);
      const dismissedRel = emailDismissedFile('sam-example');
      expect(JSON.parse(read(dismissedRel))).toEqual({ [KEY]: '2026-11-20' });
      expect(mode(dismissedRel)).toBe(0o600);
      expect(draft().reply).toMatchObject({ ok: false, error: 'dismissed' });
      expect(draft().exit).toBe(2);
      // Another owner's inbox isn't dismissed by it.
      as('tess@example.test');
      expect(draft({ inboxAddress: 'tess@example.test' }).reply).toMatchObject({ ok: true });
    });

    it('without dismiss, just removes it, so the email can be drafted again', () => {
      const id = newDraft();
      expect(runAt('email-draft-remove', { id, dismiss: false }).reply).toMatchObject({ ok: true });
      expect(existsSync(abs(emailDismissedFile('sam-example')))).toBe(false);
      expect(draft().reply).toMatchObject({ ok: true });
    });

    it('drops dismissals older than 90 days when it writes, and an old one no longer refuses', () => {
      put(
        emailDismissedFile('sam-example'),
        JSON.stringify({ 'x:ancient': '2026-01-01', 'x:recent': '2026-11-01', 'x:bad': 'soon' }),
      );
      const id = newDraft();
      runAt('email-draft-remove', { id, dismiss: true });
      expect(JSON.parse(read(emailDismissedFile('sam-example')))).toEqual({
        'x:recent': '2026-11-01',
        [KEY]: '2026-11-20',
      });
      const later = new Date(T0.getTime() + (DISMISSED_DAYS + 1) * DAY);
      expect(draft({}, { now: later }).reply).toMatchObject({ ok: true });
    });

    it("refuses another owner's draft, an unknown one and a bad id", () => {
      const id = newDraft();
      as('tess@example.test');
      expect(refusal(runAt('email-draft-remove', { id, dismiss: true }))).toEqual({
        exit: 2,
        error: 'not-allowed',
      });
      as('olive@example.test');
      expect(refusal(runAt('email-draft-remove', { id, dismiss: false }))).toEqual({
        exit: 2,
        error: 'not-allowed',
      });
      expect(draftFiles()).toEqual([`${id}.json`]);
      as('sam@example.test');
      expect(refusal(runAt('email-draft-remove', { id: 'aaaaaaaaaaaa', dismiss: false }))).toEqual({
        exit: 2,
        error: 'not-found',
      });
      for (const input of [{ id: '../x', dismiss: false }, { id }, { id, dismiss: 'yes' }]) {
        expect(refusal(runAt('email-draft-remove', input)), JSON.stringify(input)).toEqual({
          exit: 2,
          error: 'bad-request',
        });
      }
    });

    it('also deletes drafts older than 30 days', () => {
      const old = newDraft();
      const later = new Date(T0.getTime() + (DRAFT_MAX_AGE_DAYS + 1) * DAY);
      expect(refusal(runAt('email-draft-remove', { id: old, dismiss: false }, { now: later }))).toEqual({
        exit: 2,
        error: 'not-found',
      });
      expect(draftFiles()).toEqual([]);
    });
  });

  describe('update with an email entry', () => {
    it("never refuses an outsider's quote marks: both kinds become curly double quotes, in the draft and the entry", () => {
      const id = newDraft({
        subject: `Re: "Budget" for Pete's team`,
        from: { name: `Alex "AJ" O'Neil`, address: 'Alex@Client.Example' },
      });
      const d = draftOf(id);
      expect(d.subject).toBe(`Re: \u201cBudget\u201d for Pete's team`);
      expect(d.from.name).toBe(`Alex \u201cAJ\u201d O'Neil`);
      const r = approve(id, { subject: `Re: "Budget" for Pete's team`, from: `Alex "AJ" O'Neil` });
      expect(r.exit, JSON.stringify(r.reply)).toBe(0);
      const text = read(`${UPDATES}/${entries()[0]}`);
      expect(text).toContain(`email_subject: "Re: \u201cBudget\u201d for Pete's team"`);
      expect(text).toContain(`\u201cAJ\u201d O'Neil`);
    });

    it('writes the entry from the draft and the approved words, never an address, then deletes the draft', () => {
      const id = newDraft();
      const r = approve(id, {
        // Ignored: these come from the draft.
        threadId: 'ffffffffffffffff',
        emailKey: 'x:forged',
        sentAt: '2020-01-01T00:00:00Z',
        inboxOwner: 'olive-owner',
        by: 'olive-owner',
        clientSafe: true,
        summary: 'Edited: Alex agreed the budget.',
      });
      expect(r.exit).toBe(0);
      const names = entries();
      expect(names).toHaveLength(1);
      const name = names[0] as string;
      expect(name).toMatch(/^2026-11-20-1020-sam-example-[a-z0-9]{6}\.md$/);
      expect(r.reply).toEqual({
        ok: true,
        action: 'update',
        key: 'acme/website',
        version: sha(`${LIVE}/project.md`),
        file: `${UPDATES}/${name}`,
      });
      const text = read(`${UPDATES}/${name}`);
      expect(text).toBe(
        [
          '---',
          'v: 1',
          'kind: email',
          'by: sam-example',
          'at: 2026-11-20T10:20:30Z',
          'client_safe: true',
          'email_subject: Budget for December',
          'email_from: Alex Smith',
          'email_people:',
          '  - "Sam Example"',
          '  - "ops"',
          'email_sent_at: 2026-11-19T16:30:12Z',
          'email_thread_id: 18c2f0a1b2c3d4e5',
          `email_key: ${KEY}`,
          'email_inbox_owner: sam-example',
          '---',
          '',
          'Edited: Alex agreed the budget.',
          '',
        ].join('\n'),
      );
      expect(text).not.toContain('Alex@Client.Example');
      expect(text).not.toContain('sam@example.test');
      expect(parseFrontmatter(text).data).toMatchObject({
        kind: 'email',
        email_people: ['Sam Example', 'ops'],
        email_key: KEY,
      });
      expect(draftFiles()).toEqual([]);
      // Now the same email can't be drafted again.
      expect(draft().reply).toMatchObject({ error: 'exists', key: 'acme/website' });
    });

    it('quotes what YAML would misread, writes no people as an empty list, and curls quotes it cannot write straight', () => {
      const id = newDraft({ threadId: '1234567890123456', people: [] });
      const r = approve(id, { subject: 'Re: "quote" #1', from: "O'Brien: Alex", people: [] });
      expect(r.exit).toBe(0);
      const data = parseFrontmatter(read(String(r.reply.file))).data;
      expect(data).toMatchObject({
        email_subject: 'Re: "quote" #1',
        email_from: "O'Brien: Alex",
        email_thread_id: '1234567890123456',
      });
      expect(read(String(r.reply.file))).toContain('email_people: []\n');
      // Both kinds of quote mark: written with curly double quotes, never refused (lead's fix).
      const id2 = newDraft({ subject: 'Second' });
      const r2 = approve(id2, { subject: `It's "both": here` });
      expect(r2.exit, JSON.stringify(r2.reply)).toBe(0);
      expect(parseFrontmatter(read(String(r2.reply.file))).data.email_subject).toBe(
        `It's \u201cboth\u201d: here`,
      );
      expect(draftFiles()).toEqual([]);
    });

    it('refuses a hand-written draft with no key file, even with a matching hash (overseer ruling)', () => {
      const id = newDraft();
      const token = keyOf(id).token;
      rmSync(keyPath(id));
      expect(refusal(approve(id, { token }))).toEqual({ exit: 2, error: 'not-allowed' });
      expect(entries()).toEqual([]);
    });

    it('refuses a draft changed since the script wrote it', () => {
      const id = newDraft();
      const file = draftOf(id);
      put(`${DRAFTS}/${id}.json`, `${JSON.stringify({ ...file, summary: 'Changed by hand.' }, null, 2)}\n`);
      expect(refusal(approve(id))).toEqual({ exit: 2, error: 'not-allowed' });
      expect(entries()).toEqual([]);
    });

    it("the key folder is the Mac account's own: HOME and TDS_BRAIN_APP_DATA never move it", () => {
      const was = { HOME: process.env.HOME, DATA: process.env.TDS_BRAIN_APP_DATA };
      process.env.HOME = home;
      process.env.TDS_BRAIN_APP_DATA = join(home, 'data');
      try {
        expect(projects.emailKeysDir({ root, home, now: T0 })).toBe(
          join(userInfo().homedir, ...projects.EMAIL_KEYS_SUBDIR.split('/')),
        );
      } finally {
        if (was.HOME === undefined) delete process.env.HOME;
        else process.env.HOME = was.HOME;
        if (was.DATA === undefined) delete process.env.TDS_BRAIN_APP_DATA;
        else process.env.TDS_BRAIN_APP_DATA = was.DATA;
      }
      expect(projects.EMAIL_KEYS_SUBDIR).toBe('Library/Application Support/TDS Brain/data/email-keys');
    });

    it("removes the key with the draft, and sweeps this brain's orphan keys but not another brain's", () => {
      const id = newDraft();
      expect(approve(id).reply).toMatchObject({ ok: true });
      expect(existsSync(keyPath(id))).toBe(false);
      const gone = newDraft({ threadId: '18c2f0a1b2c3d4ff', subject: 'Other' });
      rmSync(abs(`${DRAFTS}/${gone}.json`));
      writeFileSync(
        join(home, 'email-keys', 'zzzzzzzzzzzz.key'),
        JSON.stringify({ v: 1, token: 'a'.repeat(32), draft_sha256: 'b'.repeat(64), brain: '/elsewhere' }),
      );
      newDraft({ threadId: '18c2f0a1b2c3d4aa', subject: 'Third' });
      expect(existsSync(keyPath(gone))).toBe(false);
      expect(existsSync(join(home, 'email-keys', 'zzzzzzzzzzzz.key'))).toBe(true);
    });

    it("refuses without a draft or token, with a wrong token, and for a draft that is not this owner's", () => {
      const id = newDraft();
      const token = keyOf(id).token;
      const entry = {
        kind: 'email',
        summary: 'S.',
        subject: 'Budget',
        from: 'Alex Smith',
        people: [],
        clientSafe: false,
      };
      const up = (e: Record<string, unknown>) =>
        runAt('update', { key: 'acme/website', entry: { ...entry, ...e } });
      expect(refusal(up({ token }))).toEqual({ exit: 2, error: 'bad-request' });
      expect(refusal(up({ draft: '../../x', token }))).toEqual({ exit: 2, error: 'bad-request' });
      expect(refusal(up({ draft: id }))).toEqual({ exit: 2, error: 'not-allowed' });
      expect(refusal(up({ draft: id, token: '0'.repeat(32) }))).toEqual({ exit: 2, error: 'not-allowed' });
      expect(refusal(up({ draft: id, token: token.toUpperCase() }))).toEqual({
        exit: 2,
        error: 'not-allowed',
      });
      expect(refusal(up({ draft: 'aaaaaaaaaaaa', token }))).toEqual({ exit: 2, error: 'not-found' });
      // Another owner, even with the right token and as the brain's Owner.
      as('olive@example.test');
      expect(refusal(up({ draft: id, token }))).toEqual({ exit: 2, error: 'not-allowed' });
      as('tess@example.test');
      expect(refusal(up({ draft: id, token }))).toEqual({ exit: 2, error: 'not-allowed' });
      expect(entries()).toEqual([]);
      expect(draftFiles()).toEqual([`${id}.json`]);
      as('sam@example.test');
      expect(up({ draft: id, token }).reply).toMatchObject({ ok: true });
    });

    it("refuses bcc, bad names and any email address, even a nameless person's (UX review)", () => {
      const id = newDraft();
      const bad: Record<string, unknown>[] = [
        { bcc: ['x@y.example'] },
        { people: ['Sam Example', { bcc: 'x' }] },
        { from: 'Alex\nSmith' },
        { from: '' },
        { from: 'A'.repeat(EMAIL_NAME_MAX + 1) },
        { from: 'Alex@Client.Example' },
        { from: 'Alex Smith <alex@client.example>' },
        { people: ['sam@example.test'] },
        { people: ['OPS@client.example'] },
        { people: ['Sam\nExample'] },
        { people: 'Sam' },
        { people: Array.from({ length: EMAIL_PEOPLE_MAX + 1 }, (_, i) => `P${i}`) },
        { subject: 'a\nb' },
        { subject: 'x'.repeat(EMAIL_SUBJECT_MAX + 1) },
        { summary: '' },
        { clientSafe: 'no' },
      ];
      for (const over of bad) {
        expect(refusal(approve(id, over)), JSON.stringify(over).slice(0, 60)).toEqual({
          exit: 2,
          error: 'bad-request',
        });
      }
      expect(entries()).toEqual([]);
      expect(draftFiles()).toEqual([`${id}.json`]);
      // A nameless person is saved by the part of the address the app shows: no @.
      expect(approve(id, { people: ['ops'] }).reply).toMatchObject({ ok: true });
    });

    it('refuses an email already in any project with exists, answering where, and clears the draft', () => {
      const id = newDraft();
      const file = emailEntry(`${OTHER}/updates`, 'tess-team', KEY);
      const r = approve(id);
      expect(r.exit).toBe(2);
      expect(r.reply).toMatchObject({ ok: false, error: 'exists', file, key: 'skyseal/roof' });
      expect(entries()).toEqual([]);
      expect(draftFiles()).toEqual([]);
    });

    it('follows the note and call rules for the project', () => {
      const id = newDraft();
      put('clients/acme/projects-archive/old/project.md', '---\nv: 1\ntitle: Old\n---\n');
      expect(refusal(approve(id, {}, 'acme/old'))).toEqual({ exit: 2, error: 'not-allowed' });
      put('clients/acme/projects/bare/notes.md', 'no card');
      expect(refusal(approve(id, {}, 'acme/bare'))).toEqual({ exit: 2, error: 'not-allowed' });
      expect(refusal(approve(id, {}, 'acme/nothing'))).toEqual({ exit: 2, error: 'not-found' });
      expect(draftFiles()).toEqual([`${id}.json`]);
      // Any live project, not only the one the draft was routed to.
      expect(approve(id, {}, 'skyseal/roof').reply).toMatchObject({ ok: true, key: 'skyseal/roof' });
    });

    it('refuses when the drafts folder stops being ignored', () => {
      const id = newDraft();
      const token = keyOf(id).token;
      writeFileSync(join(root, '.gitignore'), 'personal/\n');
      const r = runAt('update', {
        key: 'acme/website',
        entry: {
          kind: 'email',
          draft: id,
          token,
          summary: 'S.',
          subject: 'B',
          from: 'Alex',
          people: [],
          clientSafe: false,
        },
      });
      expect(refusal(r)).toEqual({ exit: 2, error: 'not-allowed' });
      expect(entries()).toEqual([]);
    });
  });

  describe('update-remove of an email entry', () => {
    const remove = (file: string) => runAt('update-remove', { key: 'acme/website', file, expect: sha(file) });

    it("is for the entry's inbox owner, the brain's Owner or a scout", () => {
      const a = emailEntry(UPDATES, 'tess-team', '<a@x>', '2026-11-19-0900-tess-team-aaa001.md');
      const b = emailEntry(UPDATES, 'tess-team', '<b@x>', '2026-11-19-0900-tess-team-aaa002.md');
      const c = emailEntry(UPDATES, 'tess-team', '<c@x>', '2026-11-19-0900-tess-team-aaa003.md');
      as('terry@example.test');
      expect(refusal(remove(a))).toEqual({ exit: 2, error: 'not-allowed' });
      expect(existsSync(abs(a))).toBe(true);
      as('tess@example.test');
      expect(remove(a).reply).toMatchObject({ ok: true, action: 'update-remove' });
      as('olive@example.test');
      expect(remove(b).reply).toMatchObject({ ok: true });
      as('sam@example.test');
      expect(remove(c).reply).toMatchObject({ ok: true });
    });

    it('goes by email_inbox_owner, not by', () => {
      const rel = `${UPDATES}/2026-11-19-0900-terry-team-aaa004.md`;
      put(
        rel,
        '---\nv: 1\nkind: email\nby: tess-team\nat: 2026-11-19T09:00:00Z\nclient_safe: false\nemail_key: <d@x>\nemail_inbox_owner: terry-team\n---\n\nHi.\n',
      );
      as('tess@example.test');
      expect(refusal(remove(rel))).toEqual({ exit: 2, error: 'not-allowed' });
      as('terry@example.test');
      expect(remove(rel).reply).toMatchObject({ ok: true });
    });
  });

  it('is documented in the skill file, with the rule that only the app saves an email', () => {
    const skill = readFileSync(fileURLToPath(new URL('../SKILL.md', import.meta.url)), 'utf8');
    expect(skill).toContain('| `email-draft` |');
    expect(skill).toContain('| `email-draft-remove` |');
    expect(skill).toContain(PROJECTS_EMAIL_CAPABILITY);
    expect(skill).toContain('0.6.0');
    expect(skill).toMatch(/never call `update` with `kind` `"email"`/i);
    expect(skill).toContain('briefing/email-drafts');
  });
});
