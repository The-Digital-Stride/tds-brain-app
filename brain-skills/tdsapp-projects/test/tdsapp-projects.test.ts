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
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../../server/brain/frontmatter.ts';
import { parseLinkedFiles, splitLinkedFiles } from '../../../shared/projects.ts';
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
}
interface ProjectsModule {
  run(action: string, input: unknown, ctx: Ctx): { exit: number; reply: Reply };
  SCRIPT_VERSION: string;
  PROJECTS_CAPABILITY: string;
  PROJECTS_MOVE_CAPABILITY: string;
  PROJECT_MOVED_FROM_MAX: number;
  INTERNAL_CLIENT: string;
  INTERNAL_PRECEDENCE: string[];
  PROJECT_CARD_FILE: string;
  LIMITS: Record<string, number>;
}

const require = createRequire(import.meta.url);
const projects = require('../scripts/tdsapp-projects.cjs') as ProjectsModule;

const ROLES = {
  members: [
    { name: 'Olive Owner', email: 'olive@example.test', role: 'owner' },
    { name: 'Sam Example', email: 'sam@example.test', role: 'scout' },
    { name: 'Tess Team', email: 'tess@example.test', role: 'team' },
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
  projects.run(action, input, { root, home, now: T0 });
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
        features: [PROJECTS_CAPABILITY, PROJECTS_MOVE_CAPABILITY],
      },
    });
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
    expect(projects.PROJECT_MOVED_FROM_MAX).toBe(PROJECT_MOVED_FROM_MAX);
    expect(projects.INTERNAL_CLIENT).toBe(INTERNAL_CLIENT);
    expect(projects.INTERNAL_PRECEDENCE).toEqual([...INTERNAL_PRECEDENCE]);
    expect(projects.PROJECT_CARD_FILE).toBe(PROJECT_CARD_FILE);
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
  it('is the script version for the owner and scouts, with USE WHEN triggers, matching the script', () => {
    const skill = parseFrontmatter(
      readFileSync(fileURLToPath(new URL('../SKILL.md', import.meta.url)), 'utf8'),
    ).data;
    expect(skill).toMatchObject({
      name: 'tdsapp-projects',
      version: projects.SCRIPT_VERSION,
      roles: 'owner, scout',
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
    expect(call('capabilities').reply.features).toEqual([PROJECTS_CAPABILITY, PROJECTS_MOVE_CAPABILITY]);
    const r = spawnSync(process.execPath, [SCRIPT, 'move'], {
      input: JSON.stringify({ kind: 'move', key: 'acme/website', client: 'skyseal', expect: sha(CARD) }),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, BRAIN_ROOT: root, GIT_CONFIG_NOSYSTEM: '1' },
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, action: 'move', key: 'skyseal/website' });
  });
});
