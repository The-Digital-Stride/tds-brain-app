// Tests for project codes ("refs") in the `tdsapp-projects` script (plan
// docs/plans/2026-11-24-projects-r2-project-codes.md, decisions 1-8; contract shared/project-refs-contract.ts).
// Every brain is a throwaway temp folder with `git init`; randomness is injected (`refPick`) so the picks are
// deterministic. The script's copies of the rules run the shared vectors file, as shared/project-refs.ts does.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_CODE_PATTERN,
  PROJECTS_REFS_CAPABILITY,
  REF_CANDIDATE_SOURCE,
  REF_CANDIDATES_MAX,
  REF_DIGITS,
  REF_LETTERS,
  REF_PATTERN,
  REF_PROJECT_PART,
} from '../../../shared/project-refs-contract.ts';
import vectors from '../../../shared/project-refs-vectors.json' with { type: 'json' };
import { INTERNAL_CLIENT } from '../../../shared/projects-contract.ts';

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
  /** Test only: picks an index below n in place of crypto.randomInt. */
  refPick?: (n: number) => number;
}
interface RefsModule {
  run(action: string, input: unknown, ctx: Ctx): { exit: number; reply: Reply };
  SCRIPT_VERSION: string;
  PROJECTS_REFS_CAPABILITY: string;
  REF_DIGITS: string;
  REF_LETTERS: string;
  CLIENT_CODE_PATTERN: RegExp;
  REF_PATTERN: RegExp;
  REF_PROJECT_PART: number;
  REF_CANDIDATE_SOURCE: string;
  REF_CANDIDATES_MAX: number;
  refCandidates(text: string): string[];
  isValidRef(s: string): boolean;
  foldRef(ref: string): string;
  foldClientCode(code: string): string;
  nearRefs(candidate: string, refs: readonly string[]): string[];
}

const require = createRequire(import.meta.url);
const projects = require('../scripts/tdsapp-projects.cjs') as RefsModule;

const ROLES = {
  members: [
    { name: 'Olive Owner', email: 'olive@example.test', role: 'owner' },
    { name: 'Sam Example', email: 'sam@example.test', role: 'scout' },
    { name: 'Tess Team', email: 'tess@example.test', role: 'team' },
  ],
};
const T0 = new Date('2026-11-24T10:20:30.000Z');

let root: string;
let home: string;
let extra: string[];
let pick: (n: number) => number;

function git(args: string[], cwd = root) {
  const r = spawnSync('git', ['-c', 'user.name=Test', ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
const commit = (message: string) => {
  git(['add', '-A']);
  git(['commit', '-q', '--allow-empty', '-m', message]);
};

const abs = (rel: string) => join(root, ...rel.split('/'));
function put(rel: string, text: string = 'hello') {
  mkdirSync(dirname(abs(rel)), { recursive: true });
  writeFileSync(abs(rel), text);
}
const read = (rel: string) => readFileSync(abs(rel), 'utf8');
const sha = (rel: string) =>
  createHash('sha256')
    .update(readFileSync(abs(rel)))
    .digest('hex');
const call = (action: string, input: Record<string, unknown> = {}) =>
  projects.run(action, input, { root, home, now: T0, refPick: pick });
const refusal = (r: { exit: number; reply: Reply }) => ({ exit: r.exit, error: r.reply.error });
const refLine = (rel: string) =>
  read(rel)
    .split('\n')
    .find((l) => l.startsWith('ref:')) ?? null;
const asOwner = () => git(['config', 'user.email', 'olive@example.test']);

function create(client: string, slug: string, fields: Record<string, unknown> = {}) {
  return call('create', {
    kind: 'create',
    space: 'client',
    client,
    slug,
    fields: { title: 'Website rebuild', ...fields },
  });
}
// A hand-made card, as the brain might hold one.
function card(rel: string, lines: string[]) {
  put(`${rel}/project.md`, ['---', 'v: 1', ...lines, '---', '', 'Brief.', ''].join('\n'));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'refs-brain-'));
  home = mkdtempSync(join(tmpdir(), 'refs-home-'));
  extra = [];
  pick = () => 0;
  git(['init', '-q']);
  git(['config', 'user.email', 'sam@example.test']);
  put('.team-config/roles.json', JSON.stringify(ROLES));
  put('.gitignore', 'personal/\n*~\n');
  put('clients/acme/profile.md', '---\nclient: Acme Ltd\ncode: ACM\n---\n\n# Acme\n');
  put('clients/skyseal/profile.md', '---\nclient: Skyseal\n---\n');
  put(`clients/${INTERNAL_CLIENT}/profile.md`, '---\nclient: The Digital Stride\ncode: "tds"\n---\n');
  commit('start');
});

afterEach(() => {
  for (const dir of [root, home, ...extra]) rmSync(dir, { recursive: true, force: true });
});

describe('the rules, copied from the contract', () => {
  it('match the constants', () => {
    expect(projects.REF_DIGITS).toBe(REF_DIGITS);
    expect(projects.REF_LETTERS).toBe(REF_LETTERS);
    expect(projects.CLIENT_CODE_PATTERN.source).toBe(CLIENT_CODE_PATTERN.source);
    expect(projects.CLIENT_CODE_PATTERN.flags).toBe(CLIENT_CODE_PATTERN.flags);
    expect(projects.REF_PATTERN.source).toBe(REF_PATTERN.source);
    expect(projects.REF_PATTERN.flags).toBe(REF_PATTERN.flags);
    expect(projects.REF_PROJECT_PART).toBe(REF_PROJECT_PART);
    expect(projects.REF_CANDIDATE_SOURCE).toBe(REF_CANDIDATE_SOURCE);
    expect(projects.REF_CANDIDATES_MAX).toBe(REF_CANDIDATES_MAX);
    expect(projects.PROJECTS_REFS_CAPABILITY).toBe(PROJECTS_REFS_CAPABILITY);
  });

  it('pass every case in the shared vectors file', () => {
    for (const c of vectors.candidates) expect(projects.refCandidates(c.text), c.text).toEqual(c.expect);
    for (const c of vectors.valid) expect(projects.isValidRef(c.ref), c.ref).toBe(c.expect);
    for (const c of vectors.foldRef) expect(projects.foldRef(c.in), c.in).toBe(c.out);
    for (const c of vectors.foldClientCode) expect(projects.foldClientCode(c.in), c.in).toBe(c.out);
    for (const c of vectors.near) {
      expect(projects.nearRefs(c.candidate, c.refs), `${c.candidate} ${c.refs}`).toEqual(c.expect);
    }
  });
});

describe('create and card write a ref', () => {
  it('writes ref after the client line, from the client code', () => {
    expect(create('acme', 'website').exit).toBe(0);
    const text = read('clients/acme/projects/website/project.md');
    expect(text.split('\n').slice(0, 5)).toEqual([
      '---',
      'v: 1',
      'title: Website rebuild',
      'client: acme',
      'ref: ACM2A2',
    ]);
  });

  it('gives internal projects the-digital-stride code, upper-cased, and card writes one too', () => {
    expect(create(INTERNAL_CLIENT, 'ops').exit).toBe(0);
    expect(refLine(`clients/${INTERNAL_CLIENT}/projects/ops/project.md`)).toBe('ref: TDS2A2');
    // A card-less legacy folder: its card gets a TDS code spaced from the first.
    put('projects/client-portal/README.md', '# Client portal\n');
    const r = call('card', { kind: 'card', key: `${INTERNAL_CLIENT}/client-portal`, fields: {} });
    expect(r.exit).toBe(0);
    expect(refLine('projects/client-portal/project.md')).toBe('ref: TDS2C3');
  });

  it('writes no ref without a client code, or with one that fails the pattern', () => {
    expect(create('skyseal', 'site').exit).toBe(0);
    expect(refLine('clients/skyseal/projects/site/project.md')).toBeNull();
    put('clients/bad/profile.md', '---\ncode: TOOLONG\n---\n');
    expect(create('bad', 'site').exit).toBe(0);
    expect(refLine('clients/bad/projects/site/project.md')).toBeNull();
  });

  it('never gives a personal project a ref', () => {
    const r = call('create', { kind: 'create', space: 'personal', slug: 'mine', fields: { title: 'Mine' } });
    expect(r.exit).toBe(0);
    expect(refLine('personal/projects/mine/project.md')).toBeNull();
  });

  it('picks at random among the options when nothing is injected', () => {
    const r = projects.run(
      'create',
      { kind: 'create', space: 'client', client: 'acme', slug: 'rand', fields: { title: 'Rand' } },
      { root, home, now: T0 },
    );
    expect(r.exit).toBe(0);
    const line = refLine('clients/acme/projects/rand/project.md');
    expect(line).toMatch(/^ref: ACM[2-9][ACDEFGHJKMNPQRTUVWXY][2-9]$/);
  });
});

describe('picking a code', () => {
  it('never reuses a code on any card on disk, and spaces it from every used code of any client', () => {
    card('clients/acme/projects-archive/old', ['title: Old', 'client: acme', 'ref: ACM2A2']);
    expect(create('acme', 'website').exit).toBe(0);
    // Not ACM2A2 (used), nor ACM2A3…ACM2A9 or ACM2C2 (one slip from it).
    expect(refLine('clients/acme/projects/website/project.md')).toBe('ref: ACM2C3');
  });

  it('counts refs in frontmatter only, conflicted cards included, never a line in a brief', () => {
    put('clients/acme/projects/brief/project.md', '---\nv: 1\ntitle: B\n---\n\nref: ACM2A2\n');
    put(
      'clients/acme/projects/clash/project.md',
      '---\nv: 1\n<<<<<<< HEAD\nref: ACM2C3\n=======\nref: ACM2D4\n>>>>>>> other\n---\n',
    );
    expect(create('acme', 'website').exit).toBe(0);
    // ACM2A2 is free (only a brief names it); ACM2C3 and ACM2D4 are used, and ACM2A2 isn't one slip
    // from either, so it is the first option.
    expect(refLine('clients/acme/projects/website/project.md')).toBe('ref: ACM2A2');
    expect(create('acme', 'second').exit).toBe(0);
    // Next: ACM2A*, ACM2C* and ACM2D* are one slip from ACM2A2, ACM2C3 and ACM2D4; so are ACM2E2,
    // ACM2E3 and ACM2E4. ACM2E5 is two characters from each.
    expect(refLine('clients/acme/projects/second/project.md')).toBe('ref: ACM2E5');
  });

  it("spaces codes from another client's refs too (one slip across client codes)", () => {
    put('clients/acn/profile.md', '---\ncode: ACN\n---\n');
    card('clients/acn/projects/x', ['title: X', 'client: acn', 'ref: ACN2A2']);
    expect(create('acme', 'website').exit).toBe(0);
    // ACM2A2 is one substitution from ACN2A2.
    expect(refLine('clients/acme/projects/website/project.md')).toBe('ref: ACM2A3');
  });

  it('compares after folding O/0 and I/1 in the client part', () => {
    put('clients/h2o/profile.md', '---\ncode: H2O\n---\n');
    card('clients/other/projects/x', ['title: X', 'client: other', 'ref: H202A2']);
    expect(create('h2o', 'ppc').exit).toBe(0);
    expect(refLine('clients/h2o/projects/ppc/project.md')).toBe('ref: H2O2C3');
  });

  it("never reuses a code from a card deleted in the brain's git history", () => {
    card('clients/acme/projects/gone', ['title: Gone', 'client: acme', 'ref: ACM2A2']);
    commit('add gone');
    rmSync(abs('clients/acme/projects/gone'), { recursive: true });
    commit('delete gone');
    expect(create('acme', 'website').exit).toBe(0);
    expect(refLine('clients/acme/projects/website/project.md')).toBe('ref: ACM2C3');
  });

  it('reads the deleted card as it was just before it went, even when it was changed first', () => {
    card('clients/acme/projects/gone', ['title: Gone', 'client: acme']);
    commit('add gone');
    card('clients/acme/projects/gone', ['title: Gone', 'client: acme', 'ref: ACM2A2']);
    commit('give it a code');
    card('legacy-ish/unrelated', ['ref: ACM2C3']);
    commit('not a card path');
    rmSync(abs('clients/acme/projects/gone'), { recursive: true });
    rmSync(abs('legacy-ish'), { recursive: true });
    commit('delete both');
    expect(create('acme', 'website').exit).toBe(0);
    expect(refLine('clients/acme/projects/website/project.md')).toBe('ref: ACM2C3');
  });

  it('takes any unused code once no spaced one is left', () => {
    // Every ACM2xx code is used, so every other ACM code is one substitution from one of them: no spaced
    // code is left, and the pick falls back to any unused one (here the last).
    const refs: string[] = [];
    for (const l of REF_LETTERS) for (const d of REF_DIGITS) refs.push(`ACM2${l}${d}`);
    refs.forEach((ref, i) => {
      card(`clients/acme/projects-archive/a${i}`, ['title: A', 'client: acme', `ref: ${ref}`]);
    });
    pick = (n) => n - 1;
    expect(create('acme', 'website').exit).toBe(0);
    expect(refLine('clients/acme/projects/website/project.md')).toBe('ref: ACM9Y9');
  });
});

describe("when git can't say which codes deleted cards used", () => {
  it('still writes the card from a shallow clone, without a ref', () => {
    const clone = mkdtempSync(join(tmpdir(), 'refs-clone-'));
    extra.push(clone);
    rmSync(clone, { recursive: true });
    git(['clone', '-q', '--depth', '1', `file://${root}`, clone], tmpdir());
    git(['config', 'user.email', 'sam@example.test'], clone);
    extra.push(root);
    root = clone;
    const r = create('acme', 'website');
    expect(r.exit).toBe(0);
    expect(refLine('clients/acme/projects/website/project.md')).toBeNull();
  });

  it('still writes the card when the brain is not a git repository, without a ref', () => {
    rmSync(abs('.git'), { recursive: true });
    writeFileSync(join(home, '.gitconfig'), '[user]\n\temail = sam@example.test\n');
    const r = create('acme', 'website');
    expect(r.exit).toBe(0);
    expect(refLine('clients/acme/projects/website/project.md')).toBeNull();
  });

  it('refuses the ref action with internal', () => {
    create('skyseal', 'site');
    put('clients/skyseal/profile.md', '---\ncode: SKY\n---\n');
    rmSync(abs('.git'), { recursive: true });
    writeFileSync(join(home, '.gitconfig'), '[user]\n\temail = sam@example.test\n');
    const rel = 'clients/skyseal/projects/site/project.md';
    const r = call('ref', { kind: 'ref', key: 'skyseal/site', expect: sha(rel) });
    expect(r).toEqual({
      exit: 1,
      reply: {
        ok: false,
        error: 'internal',
        message: "Couldn't check old codes just now. Try again in a moment.",
      },
    });
    expect(refLine(rel)).toBeNull();
  });

  it('writes a ref in a brain with no commits yet (no history to read)', () => {
    rmSync(abs('.git'), { recursive: true });
    git(['init', '-q']);
    git(['config', 'user.email', 'sam@example.test']);
    expect(create('acme', 'website').exit).toBe(0);
    expect(refLine('clients/acme/projects/website/project.md')).toBe('ref: ACM2A2');
  });
});

describe('every other change keeps the ref line byte for byte', () => {
  const CARD = 'clients/acme/projects/website/project.md';
  beforeEach(() => {
    card('clients/acme/projects/website', [
      'title: Website',
      'client: acme',
      'ref: "ACM4K7"',
      'status: active',
    ]);
    put('clients/acme/files/brief.pdf');
  });

  it('edit, link, unlink and update leave it where it is', () => {
    const before = read(CARD).split('\n');
    let r = call('edit', {
      kind: 'edit',
      key: 'acme/website',
      expect: sha(CARD),
      fields: { title: 'New title', kind: 'one-off', health: 'green', team: ['tess-team'], brief: 'New.' },
    });
    expect(r.exit).toBe(0);
    let after = read(CARD).split('\n');
    expect(after[3]).toBe('client: acme');
    expect(after[4]).toBe('ref: "ACM4K7"');
    expect(after.filter((l) => l.startsWith('ref')).length).toBe(1);
    r = call('link', {
      kind: 'link',
      key: 'acme/website',
      path: 'clients/acme/files/brief.pdf',
      expect: sha(CARD),
    });
    expect(r.exit).toBe(0);
    r = call('unlink', {
      kind: 'unlink',
      key: 'acme/website',
      path: 'clients/acme/files/brief.pdf',
      expect: sha(CARD),
    });
    expect(r.exit).toBe(0);
    r = call('update', {
      kind: 'update',
      key: 'acme/website',
      entry: { kind: 'note', summary: 'Hi', clientSafe: false },
    });
    expect(r.exit).toBe(0);
    after = read(CARD).split('\n');
    expect(after[4]).toBe('ref: "ACM4K7"');
    expect(before[4]).toBe(after[4]);
  });

  it('a move between clients keeps it untouched', () => {
    const r = call('move', { kind: 'move', key: 'acme/website', client: 'skyseal', expect: sha(CARD) });
    expect(r.exit).toBe(0);
    const moved = read('clients/skyseal/projects/website/project.md').split('\n');
    expect(moved.slice(0, 6)).toEqual([
      '---',
      'v: 1',
      'title: Website',
      'client: skyseal',
      'ref: "ACM4K7"',
      'status: active',
    ]);
  });

  it('edit refuses a ref field', () => {
    const r = call('edit', {
      kind: 'edit',
      key: 'acme/website',
      expect: sha(CARD),
      fields: { ref: 'ACM9Y9' },
    });
    expect(refusal(r)).toEqual({ exit: 2, error: 'bad-request' });
    expect(refLine(CARD)).toBe('ref: "ACM4K7"');
  });
});

describe('move from personal into a client', () => {
  const P = 'personal/projects/jev';
  const move = (client = 'acme') =>
    call('move', { kind: 'move', key: 'personal/jev', client, expect: sha(`${P}/project.md`) });

  it('gives a project with no ref one from the new client', () => {
    card(P, ['title: Jev', 'status: active']);
    expect(move().exit).toBe(0);
    const text = read('clients/acme/projects/jev/project.md').split('\n');
    expect(text.slice(0, 6)).toEqual([
      '---',
      'v: 1',
      'title: Jev',
      'client: acme',
      'ref: ACM2A2',
      'status: active',
    ]);
  });

  it('keeps a valid ref no other card holds', () => {
    card(P, ['title: Jev', 'ref: GAP4K7', 'status: active']);
    expect(move().exit).toBe(0);
    expect(refLine('clients/acme/projects/jev/project.md')).toBe('ref: GAP4K7');
  });

  it('picks a new one when another card holds its ref (after folding), or it is invalid', () => {
    card('clients/skyseal/projects/twin', ['title: Twin', 'client: skyseal', 'ref: H2O4K7']);
    card(P, ['title: Jev', 'ref: H204K7', 'status: active']);
    expect(move().exit).toBe(0);
    expect(refLine('clients/acme/projects/jev/project.md')).toBe('ref: ACM2A2');
    card('personal/projects/bad', ['title: Bad', 'ref: acm4k1']);
    const r = call('move', {
      kind: 'move',
      key: 'personal/bad',
      client: 'acme',
      expect: sha('personal/projects/bad/project.md'),
    });
    expect(r.exit).toBe(0);
    expect(refLine('clients/acme/projects/bad/project.md')).toBe('ref: ACM2C3');
  });

  it('moves without a ref when the client has no code, and a check writes nothing', () => {
    card(P, ['title: Jev', 'status: active']);
    const check = call('move', {
      kind: 'move',
      key: 'personal/jev',
      client: 'acme',
      check: true,
      expect: sha(`${P}/project.md`),
    });
    expect(check.exit).toBe(0);
    expect(refLine(`${P}/project.md`)).toBeNull();
    expect(move('skyseal').exit).toBe(0);
    expect(refLine('clients/skyseal/projects/jev/project.md')).toBeNull();
  });
});

describe('the ref action', () => {
  const SITE = 'clients/acme/projects/site/project.md';
  beforeEach(() => {
    card('clients/acme/projects/site', ['title: Site', 'client: acme', 'status: active']);
  });

  it('gives one card a code, answering given and skipped', () => {
    const r = call('ref', { kind: 'ref', key: 'acme/site', expect: sha(SITE) });
    expect(r).toEqual({
      exit: 0,
      reply: {
        ok: true,
        action: 'ref',
        key: 'acme/site',
        version: sha(SITE),
        given: [{ key: 'acme/site', ref: 'ACM2A2' }],
        skipped: [],
      },
    });
    expect(read(SITE).split('\n').slice(3, 5)).toEqual(['client: acme', 'ref: ACM2A2']);
  });

  it('replaces an invalid ref line in place', () => {
    card('clients/acme/projects/site', ['title: Site', 'client: acme', 'status: active', 'ref: nope']);
    const r = call('ref', { kind: 'ref', key: 'acme/site', expect: sha(SITE) });
    expect(r.exit).toBe(0);
    expect(read(SITE).split('\n').slice(3, 6)).toEqual(['client: acme', 'status: active', 'ref: ACM2A2']);
  });

  it('refuses a card that has one, a stale expect, personal and archived cards and a client with no code', () => {
    call('ref', { kind: 'ref', key: 'acme/site', expect: sha(SITE) });
    let r = call('ref', { kind: 'ref', key: 'acme/site', expect: sha(SITE) });
    expect(r.reply).toMatchObject({ error: 'exists', message: 'This project already has a code.' });
    card('clients/acme/projects/two', ['title: Two', 'client: acme']);
    r = call('ref', { kind: 'ref', key: 'acme/two', expect: 'f'.repeat(64) });
    expect(refusal(r)).toEqual({ exit: 2, error: 'changed' });
    card('personal/projects/mine', ['title: Mine']);
    r = call('ref', { kind: 'ref', key: 'personal/mine', expect: sha('personal/projects/mine/project.md') });
    expect(r.reply).toMatchObject({ error: 'bad-request', message: "Personal projects don't get codes." });
    card('clients/acme/projects-archive/old', ['title: Old', 'client: acme']);
    r = call('ref', {
      kind: 'ref',
      key: 'acme/old',
      expect: sha('clients/acme/projects-archive/old/project.md'),
    });
    expect(r.reply).toMatchObject({ error: 'bad-request' });
    card('clients/skyseal/projects/s', ['title: S', 'client: skyseal']);
    r = call('ref', { kind: 'ref', key: 'skyseal/s', expect: sha('clients/skyseal/projects/s/project.md') });
    expect(r.reply).toMatchObject({
      error: 'bad-request',
      message: "Add a client code to Skyseal's profile first.",
    });
  });

  it('refuses both key and all, neither, and bad flags', () => {
    for (const input of [
      { all: true, key: 'acme/site', expect: sha(SITE) },
      {},
      { key: 'acme/site', expect: sha(SITE), replace: false },
      { all: 'yes' },
      { all: true, replace: true },
      { key: 'acme/site' },
    ]) {
      expect(refusal(call('ref', { kind: 'ref', ...input })), JSON.stringify(input)).toEqual({
        exit: 2,
        error: 'bad-request',
      });
    }
  });

  it('refuses someone not on the team', () => {
    git(['config', 'user.email', 'stranger@example.test']);
    expect(refusal(call('ref', { kind: 'ref', key: 'acme/site', expect: sha(SITE) }))).toEqual({
      exit: 2,
      error: 'not-allowed',
    });
  });

  it('replaces only a ref another card on disk holds', () => {
    card('clients/acme/projects/site', ['title: Site', 'client: acme', 'ref: ACM4K7']);
    let r = call('ref', { kind: 'ref', key: 'acme/site', expect: sha(SITE), replace: true });
    expect(r.reply).toMatchObject({ error: 'changed' });
    card('clients/acme/projects/copy', ['title: Copy', 'client: acme', 'ref: ACM4K7']);
    r = call('ref', { kind: 'ref', key: 'acme/site', expect: sha(SITE), replace: true });
    expect(r.exit).toBe(0);
    // Not ACM4K7 (used) and spaced from it.
    expect(r.reply.given).toEqual([{ key: 'acme/site', ref: 'ACM2A2' }]);
    expect(refLine(SITE)).toBe('ref: ACM2A2');
    expect(refLine('clients/acme/projects/copy/project.md')).toBe('ref: ACM4K7');
  });

  it("all: for the brain's Owner only", () => {
    expect(call('ref', { kind: 'ref', all: true }).reply).toMatchObject({ ok: false, error: 'not-allowed' });
    expect(refLine(SITE)).toBeNull();
  });

  it('all: gives every live client and internal card lacking one a code, skipping the rest with reasons', () => {
    asOwner();
    card('clients/acme/projects/has', ['title: Has', 'client: acme', 'ref: ACM9Y9']);
    card('clients/acme/projects-archive/old', ['title: Old', 'client: acme']);
    card('clients/skyseal/projects/s', ['title: S', 'client: skyseal']);
    card('projects/legacy', ['title: Legacy', 'client: the-digital-stride']);
    card('personal/projects/mine', ['title: Mine']);
    put('clients/acme/projects/bare/notes.md', 'no card');
    const r = call('ref', { kind: 'ref', all: true });
    expect(r.exit).toBe(0);
    expect(r.reply).toEqual({
      ok: true,
      action: 'ref',
      given: [
        { key: 'acme/site', ref: 'ACM2A2' },
        { key: `${INTERNAL_CLIENT}/legacy`, ref: 'TDS2A2' },
      ],
      skipped: [
        { key: 'acme/bare', reason: 'no-card' },
        { key: 'acme/has', reason: 'has-ref' },
        { key: 'acme/old', reason: 'archived' },
        { key: 'personal/mine', reason: 'personal' },
        { key: 'skyseal/s', reason: 'no-client-code' },
      ],
    });
    expect(refLine(SITE)).toBe('ref: ACM2A2');
    expect(refLine('projects/legacy/project.md')).toBe('ref: TDS2A2');
    expect(refLine('clients/acme/projects/has/project.md')).toBe('ref: ACM9Y9');
  });

  it('all: spaces the codes it gives from one another', () => {
    asOwner();
    card('clients/acme/projects/two', ['title: Two', 'client: acme']);
    const r = call('ref', { kind: 'ref', all: true });
    expect(r.reply.given).toEqual([
      { key: 'acme/site', ref: 'ACM2A2' },
      { key: 'acme/two', ref: 'ACM2C3' },
    ]);
  });
});

describe('find-ref', () => {
  beforeEach(() => {
    card('clients/acme/projects/site', ['title: Site rebuild', 'client: acme', 'ref: ACM4K7']);
    card('clients/h2o/projects/ppc', ['title: PPC', 'client: h2o', 'ref: H2O4K7']);
    card('clients/acme/projects-archive/old', ['title: Old', 'client: acme', 'ref: ACM5K7']);
    // Moved to skyseal: the client comes from the card, never the letters.
    card('clients/skyseal/projects/moved', ['title: Moved', 'client: skyseal', 'ref: ACM6K7']);
    card('clients/acme/projects/a', ['title: A', 'client: acme', 'ref: ACM7K7']);
    card('clients/acme/projects/b', ['title: B', 'client: acme', 'ref: ACM7K7']);
    card('personal/projects/mine', ['title: Mine', 'ref: ACM8K7']);
  });
  const find = (text: string) => call('find-ref', { kind: 'find-ref', text });

  it('finds refs on live and archived cards, folded, with the client from the card', () => {
    expect(find('Re: [acm4k7] and H204K7 and ACM5K7, ACM6K7').reply).toEqual({
      ok: true,
      action: 'find-ref',
      found: [
        { ref: 'ACM4K7', key: 'acme/site', title: 'Site rebuild', client: 'acme' },
        { ref: 'H2O4K7', key: 'h2o/ppc', title: 'PPC', client: 'h2o' },
        { ref: 'ACM5K7', key: 'acme/old', title: 'Old', client: 'acme' },
        { ref: 'ACM6K7', key: 'skyseal/moved', title: 'Moved', client: 'skyseal' },
      ],
      near: [],
    });
  });

  it('resolves a duplicate or a personal ref to nothing, and offers near misses', () => {
    const r = find('ACM7K7 ACM8K7 ACM4K8 ZZ9Q9');
    expect(r.reply.found).toEqual([]);
    // A duplicate is a real code, so it gets no "did you mean" either; a personal one does.
    expect(r.reply.near).toEqual([
      { candidate: 'ACM8K7', suggestions: ['ACM4K7', 'ACM5K7', 'ACM6K7'] },
      { candidate: 'ACM4K8', suggestions: ['ACM4K7'] },
    ]);
  });

  it('caps found after lookup, so junk words never push a real code out', () => {
    const junk = ['AA2C2', 'AA2C3', 'AA2C4', 'AA2C5', 'AA2C6', 'AA2C7'].join(' ');
    for (const n of [2, 3, 9])
      card(`clients/acme/projects/n${n}`, ['title: N', 'client: acme', `ref: ACM${n}C${n}`]);
    const r = find(`${junk} ACM4K7 H2O4K7 ACM5K7 ACM6K7 ACM2C2 ACM3C3 ACM9C9`);
    expect((r.reply.found as { ref: string }[]).map((f) => f.ref)).toEqual([
      'ACM4K7',
      'H2O4K7',
      'ACM5K7',
      'ACM6K7',
      'ACM2C2',
    ]);
  });

  it('refuses text over 200,000 characters and text that is not text', () => {
    expect(refusal(find('x'.repeat(200_001)))).toEqual({ exit: 2, error: 'bad-request' });
    expect(refusal(call('find-ref', { kind: 'find-ref', text: 5 }))).toEqual({
      exit: 2,
      error: 'bad-request',
    });
    expect(find('x'.repeat(200_000)).exit).toBe(0);
  });

  it('never runs git (works where git is gone)', () => {
    rmSync(abs('.git'), { recursive: true });
    expect(find('ACM4K7').reply.found).toHaveLength(1);
  });
});

describe('capabilities', () => {
  it('answers projects-refs-v1 at 0.5.0', () => {
    const r = call('capabilities');
    expect(r.reply.version).toBe('0.5.0');
    expect(r.reply.features).toContain(PROJECTS_REFS_CAPABILITY);
  });
});

describe('duplicates', () => {
  it('copies a card between folders the way a person would, and the duplicate is seen', () => {
    // A copied folder is the likelier cause of a duplicate (decision 6): find-ref resolves neither.
    card('clients/acme/projects/site', ['title: Site', 'client: acme', 'ref: ACM4K7']);
    cpSync(abs('clients/acme/projects/site'), abs('clients/acme/projects/site-copy'), { recursive: true });
    expect(call('find-ref', { kind: 'find-ref', text: 'ACM4K7' }).reply.found).toEqual([]);
  });
});

describe('the skill file', () => {
  it('documents ref, find-ref and the rules for codes', () => {
    const skill = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8');
    expect(skill).toContain('| `ref` |');
    expect(skill).toContain('| `find-ref` |');
    expect(skill).toContain(PROJECTS_REFS_CAPABILITY);
    expect(skill).toContain('never in signatures');
    expect(skill).toContain('A code points at a project; it never gives permission.');
    expect(skill).toContain('last_updated: 2026-11-24');
  });
});
