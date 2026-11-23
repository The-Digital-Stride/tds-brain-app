// Tests for the brain's `tdsapp-files` skill script (plan docs/plans/2026-11-15-delete-library-files.md,
// decisions 1-5 and 9). Most cases call the script's exported functions in this process, with an
// injected brain root, home folder and clock; a few run it as a child process to pin the command line
// (stdin, one JSON line, exit codes). Every brain is a throwaway temp folder with `git init`.
// This test stays in the app repo; it is not copied into the brain.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { versionOf as libraryVersionOf } from '../../../server/brain/library.ts';
import { classify, isNeverListed as libraryNeverListed } from '../../../server/brain/library-rules.ts';
import { memberSlug as appMemberSlug } from '../../../server/brain/util.ts';
import { ARTIFACT_URL_CASES } from '../../../shared/artifact-url-cases.ts';
import { MAX_UPLOAD_BYTES, TODO_UPLOAD_TYPES } from '../../../shared/contract.ts';
import {
  ACTION_LOG_DIR,
  FILES_CAPABILITY,
  HOLDING_DIR,
  HOLDING_ID_PATTERN,
  PROTECTED_CLIENT_FILES,
  PROTECTED_NAMES,
  PURGE_AFTER_DAYS,
} from '../../../shared/files-contract.ts';
import { PROJECT_PROTECTED_NAMES } from '../../../shared/projects-contract.ts';

const SCRIPT = fileURLToPath(new URL('./tdsapp-files.cjs', import.meta.url));
const LIBRARY_RULES = fileURLToPath(new URL('../../../server/brain/library-rules.ts', import.meta.url));

type Reply = { ok: boolean; code?: string; error?: string; [k: string]: unknown };
interface Ctx {
  root: string;
  home: string;
  now: Date;
}
interface FilesModule {
  run(action: string, input: unknown, ctx: Ctx): { exit: number; reply: Reply };
  memberSlug(name: string): string;
  cleanArtifactUrl(input: unknown): string | null;
  isNeverListed(rel: string): boolean;
  versionOf(bytes: number, mtimeMs: number): string;
  PURGE_AFTER_DAYS: number;
  HOLDING_DIR: string;
  ACTION_LOG_DIR: string;
  HOLDING_ID_PATTERN: RegExp;
  PROTECTED_NAMES: string[];
  PROTECTED_CLIENT_FILES: string[];
  PROJECT_PROTECTED_NAMES: string[];
  FILES_CAPABILITY: string;
  ADD_CAPABILITY: string;
  ADD_MAX_BYTES: number;
  ADD_IMAGE_EXTENSIONS: string[];
  ADD_DOCUMENT_EXTENSIONS: string[];
  IMAGE_EXTENSIONS: string[];
  DOCUMENT_EXTENSIONS: string[];
  LIBRARY_EXTENSIONS: string[];
  SCRIPT_VERSION: string;
}

const require = createRequire(import.meta.url);
const files = require('./tdsapp-files.cjs') as FilesModule;

const ROLES = {
  members: [
    { name: 'Olive Owner', email: 'olive@example.test', role: 'owner' },
    { name: 'Sam Example', email: 'sam@example.test', role: 'scout' },
    { name: 'Tess Team', email: 'tess@example.test', role: 'team' },
    { name: 'Hal Head', email: 'hal@example.test', role: 'head-scout' },
    { email: 'nobody@example.test', role: 'owner' },
  ],
};

const T0 = new Date('2026-11-15T10:20:30.000Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(T0.getTime() + days * DAY);

let root: string;
let home: string;
let outside: string;

// git with no system or global config, so only the temp brain's own config counts.
function git(args: string[], cwd = root) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function setEmail(email: string | null) {
  if (email === null) spawnSync('git', ['config', '--unset', 'user.email'], { cwd: root });
  else git(['config', 'user.email', email]);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'files-brain-'));
  home = mkdtempSync(join(tmpdir(), 'files-home-'));
  outside = mkdtempSync(join(tmpdir(), 'files-outside-'));
  git(['init', '-q']);
  setEmail('sam@example.test');
  mkdirSync(join(root, '.team-config'));
  writeFileSync(join(root, '.team-config', 'roles.json'), JSON.stringify(ROLES));
  writeFileSync(
    join(root, '.gitignore'),
    '/clients/*/data/semrush-rankings.csv\n/clients/*/auction-insights/*.html\n/blueprint/research-inputs/raw/\n',
  );
});

afterEach(() => {
  for (const dir of [root, home, outside]) rmSync(dir, { recursive: true, force: true });
});

const abs = (rel: string) => join(root, ...rel.split('/'));
function put(rel: string, text = 'hello') {
  mkdirSync(dirname(abs(rel)), { recursive: true });
  writeFileSync(abs(rel), text);
}
const has = (rel: string) => existsSync(abs(rel));

function call(action: string, input: unknown = {}, now: Date = T0) {
  return files.run(action, input, { root, home, now });
}
function del(path: string, extra: Record<string, unknown> = {}, now: Date = T0) {
  return call('delete', { path, ...extra }, now);
}

const holdings = () =>
  existsSync(abs(HOLDING_DIR)) ? readdirSync(abs(HOLDING_DIR)).filter((n) => HOLDING_ID_PATTERN.test(n)) : [];
function record(holding: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(abs(HOLDING_DIR), holding, 'record.json'), 'utf8'));
}
function logFiles(): string[] {
  return existsSync(abs(ACTION_LOG_DIR)) ? readdirSync(abs(ACTION_LOG_DIR)) : [];
}
function logLines(): Record<string, unknown>[] {
  return logFiles().flatMap((f) =>
    readFileSync(join(abs(ACTION_LOG_DIR), f), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l)),
  );
}

function expectRefused(r: { exit: number; reply: Reply }, code: string) {
  expect(r.reply.ok, JSON.stringify(r.reply)).toBe(false);
  expect(r.reply.code, JSON.stringify(r.reply)).toBe(code);
  expect(r.exit).toBe(code === 'internal' ? 1 : 2);
  expect(typeof r.reply.error).toBe('string');
}

function cli(action: string, input: string, env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, action], {
    input,
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, BRAIN_ROOT: root, ...env },
  });
  const lines = r.stdout.split('\n').filter(Boolean);
  expect(lines, r.stderr).toHaveLength(1);
  return { code: r.status, json: JSON.parse(lines[0] as string) as Reply };
}

describe('delete', () => {
  it('moves the file into a new holding folder with a correct record.json', () => {
    put('clients/acme/reports/q3.pdf', 'report bytes');
    const r = del('clients/acme/reports/q3.pdf', {
      via: 'TDS Brain App',
      by: 'olive-owner',
      by_name: 'Someone',
    });
    expect(r.exit).toBe(0);
    expect(r.reply.ok).toBe(true);
    expect(r.reply.action).toBe('delete');
    const holding = r.reply.holding as string;
    expect(holding).toMatch(HOLDING_ID_PATTERN);
    expect(holding.startsWith('20261115-102030-')).toBe(true);
    expect(r.reply.purge_after).toBe(at(PURGE_AFTER_DAYS).toISOString());
    expect(has('clients/acme/reports/q3.pdf')).toBe(false);
    const held = join(abs(HOLDING_DIR), holding, 'clients', 'acme', 'reports', 'q3.pdf');
    expect(readFileSync(held, 'utf8')).toBe('report bytes');
    expect(record(holding)).toEqual({
      v: 1,
      path: 'clients/acme/reports/q3.pdf',
      scope: 'client',
      deleted_at: T0.toISOString(),
      // From this Mac's git identity, never from stdin `by`.
      deleted_by: 'sam-example',
      deleted_by_name: 'Sam Example',
      deleted_via: 'TDS Brain App',
      purge_after: at(30).toISOString(),
      bytes: 12,
    });
  });

  it('writes the holding README once and never changes it', () => {
    put('clients/acme/a.pdf');
    put('clients/acme/b.pdf');
    del('clients/acme/a.pdf');
    const readme = join(abs(HOLDING_DIR), 'README.md');
    expect(readFileSync(readme, 'utf8')).toContain("Deleted files, not sources. Don't quote them.");
    writeFileSync(readme, 'edited by hand\n');
    del('clients/acme/b.pdf');
    expect(readFileSync(readme, 'utf8')).toBe('edited by hand\n');
  });

  it('logs one line per delete in a file named for the member and this Mac', () => {
    put('clients/acme/a.png', 'png');
    const r = del('clients/acme/a.png', { via: 'TDS Brain App' });
    const names = logFiles();
    expect(names).toHaveLength(1);
    const machine = readFileSync(join(home, '.config', 'tdsapp', 'machine-id'), 'utf8').trim();
    expect(machine).toMatch(/^[0-9a-f]{6}$/);
    expect(names[0]).toBe(`sam-example.${machine}.jsonl`);
    expect(logLines()).toEqual([
      {
        v: 1,
        ts: T0.toISOString(),
        action: 'delete',
        by: 'sam-example',
        by_name: 'Sam Example',
        via: 'TDS Brain App',
        scope: 'client',
        path: 'clients/acme/a.png',
        bytes: 3,
        holding: r.reply.holding,
      },
    ]);
  });

  it('keeps one machine id per Mac and a separate log file on another Mac', () => {
    put('clients/acme/a.pdf');
    put('clients/acme/b.pdf');
    del('clients/acme/a.pdf');
    const first = readFileSync(join(home, '.config', 'tdsapp', 'machine-id'), 'utf8');
    del('clients/acme/b.pdf');
    expect(readFileSync(join(home, '.config', 'tdsapp', 'machine-id'), 'utf8')).toBe(first);
    expect(logFiles()).toHaveLength(1);
    const otherHome = mkdtempSync(join(tmpdir(), 'files-home2-'));
    try {
      put('clients/acme/c.pdf');
      files.run('delete', { path: 'clients/acme/c.pdf' }, { root, home: otherHome, now: T0 });
      const second = readFileSync(join(otherHome, '.config', 'tdsapp', 'machine-id'), 'utf8');
      expect(logFiles()).toHaveLength(second === first ? 1 : 2);
      for (const f of logFiles()) expect(f).toMatch(/^sam-example\.[0-9a-f]{6}\.jsonl$/);
    } finally {
      rmSync(otherHome, { recursive: true, force: true });
    }
  });

  it('gives not-found to a second delete of the same file', () => {
    put('clients/acme/a.pdf');
    expect(del('clients/acme/a.pdf').exit).toBe(0);
    expectRefused(del('clients/acme/a.pdf'), 'not-found');
    expectRefused(del('clients/acme/never-there.pdf'), 'not-found');
    expect(holdings()).toHaveLength(1);
    expect(logLines()).toHaveLength(1);
  });

  it('refuses with changed when expect no longer matches, and accepts the library version', () => {
    put('clients/acme/a.pdf', 'abc');
    expectRefused(del('clients/acme/a.pdf', { expect: '3-1' }), 'changed');
    expect(has('clients/acme/a.pdf')).toBe(true);
    expectRefused(del('clients/acme/a.pdf', { expect: 'not a version' }), 'bad-request');
    const st = lstatSync(abs('clients/acme/a.pdf'), { bigint: true });
    const version = libraryVersionOf(Number(st.size), Number(st.mtimeMs));
    expect(files.versionOf(Number(st.size), Number(st.mtimeMs))).toBe(version);
    expect(del('clients/acme/a.pdf', { expect: version }).exit).toBe(0);
  });

  it('cleans via and falls back to a default', () => {
    put('clients/acme/a.pdf');
    put('clients/acme/b.pdf');
    const r1 = del('clients/acme/a.pdf', { via: `TDS\nBrain\u0000 App${'x'.repeat(200)}` });
    const via = record(r1.reply.holding as string).deleted_via as string;
    expect(via.startsWith('TDS Brain App')).toBe(true);
    expect(via.length).toBeLessThanOrEqual(60);
    const r2 = del('clients/acme/b.pdf', { via: 42 });
    expect(record(r2.reply.holding as string).deleted_via).toBe('tdsapp-files skill');
  });

  it('refuses personal, to-do, holding and other paths outside client and template folders', () => {
    for (const rel of [
      'personal/notes/a.pdf',
      'personal/todo/a.md',
      'todo/a.md',
      'todo/deleted/a.md',
      `${HOLDING_DIR}/20261101-101010-abcdef/clients/acme/a.pdf`,
      'other/a.pdf',
      'a.pdf',
      'clients/a.pdf',
      'Clients/acme/a.pdf',
      'Templates/a.pdf',
      'TEMPLATES/x/a.pdf',
    ]) {
      if (!rel.startsWith(HOLDING_DIR)) {
        put(rel.replace(/^Clients/, 'clients').replace(/^Templates|^TEMPLATES/, 'templates'));
      }
      expectRefused(del(rel), 'not-allowed');
    }
    setEmail('olive@example.test');
    expectRefused(del('Templates/a.pdf'), 'not-allowed');
    expectRefused(del('personal/notes/a.pdf'), 'not-allowed');
    expect(has('personal/notes/a.pdf')).toBe(true);
    expect(holdings()).toHaveLength(0);
  });

  it('refuses never-listed paths, case variants included', () => {
    const paths = [
      'clients/_archive/a.pdf',
      'clients/acme/config/a.pdf',
      'Clients/acme/Config/a.pdf',
      'clients/acme/CONFIG/a.pdf',
      'clients/acme/crm/data/a.csv',
      'clients/acme/Crm/Data/a.csv',
      'clients/acme/context/google-ads/data/a.csv',
      'clients/acme/Context/Google-Ads/DATA/a.csv',
      'clients/acme/.hidden/a.pdf',
      'clients/acme/node_modules/a.pdf',
      'clients/acme/Node_Modules/a.pdf',
      'clients/.acme/a.pdf',
      'templates/.secret/a.pdf',
    ];
    for (const rel of paths) {
      expect(files.isNeverListed(rel) || rel.startsWith('Clients/')).toBe(true);
      put(rel.toLowerCase());
      expectRefused(del(rel), 'not-allowed');
      expect(has(rel.toLowerCase())).toBe(true);
    }
    setEmail('olive@example.test');
    for (const rel of paths) expectRefused(del(rel), 'not-allowed');
    expect(holdings()).toHaveLength(0);
  });

  it('agrees with the library on never-listed paths', () => {
    for (const rel of [
      '',
      'a\\b',
      'a\0b',
      'clients//a',
      'clients/./a',
      'clients/../a',
      '.git/x',
      'Personal/Todo/x.md',
      'personal/todo',
      'personal/notes/x.md',
      'clients/_x/y',
      'clients/x/config',
      'clients/x/CONFIG/y',
      'clients/x/crm/data/y',
      'clients/x/crm/notes/y',
      'clients/x/context/google-ads/data/y',
      'clients/x/context/google-ads/y',
      'clients/x/node_modules/y',
      'templates/x.md',
      'tdsapp-deleted/x',
    ]) {
      expect(files.isNeverListed(rel), rel).toBe(libraryNeverListed(rel));
    }
  });

  it('refuses malformed paths and escapes', () => {
    put('clients/acme/a.pdf');
    writeFileSync(join(outside, 'secret.pdf'), 'secret');
    for (const rel of [
      '../a.pdf',
      'clients/acme/../acme/a.pdf',
      'clients/acme/./a.pdf',
      'clients//acme/a.pdf',
      '/etc/hosts.pdf',
      `${outside}/secret.pdf`,
      'clients\\acme\\a.pdf',
      'clients/acme/a.pdf\0.pdf',
      'clients/acme/a.pdf/',
    ]) {
      expectRefused(del(rel), 'not-allowed');
    }
    for (const bad of [undefined, null, 42, '', ['clients/acme/a.pdf'], { p: 1 }]) {
      expectRefused(call('delete', { path: bad }), 'bad-request');
    }
    expectRefused(del(`clients/acme/${'a'.repeat(2000)}.pdf`), 'bad-request');
    expect(has('clients/acme/a.pdf')).toBe(true);
    expect(existsSync(join(outside, 'secret.pdf'))).toBe(true);
  });

  it('refuses a symlink, a path through a linked folder and a folder', () => {
    writeFileSync(join(outside, 'secret.pdf'), 'secret');
    mkdirSync(abs('clients/acme/reports'), { recursive: true });
    symlinkSync(join(outside, 'secret.pdf'), abs('clients/acme/link.pdf'));
    expectRefused(del('clients/acme/link.pdf'), 'not-allowed');
    symlinkSync(outside, abs('clients/acme/linked'));
    expectRefused(del('clients/acme/linked/secret.pdf'), 'not-allowed');
    put('clients/acme/reports/real.pdf');
    symlinkSync(abs('clients/acme/reports'), abs('clients/acme/inside'));
    expectRefused(del('clients/acme/inside/real.pdf'), 'not-allowed');
    symlinkSync(outside, abs('clients/linkedclient'));
    expectRefused(del('clients/linkedclient/secret.pdf'), 'not-allowed');
    mkdirSync(abs('clients/acme/folder.pdf'));
    expectRefused(del('clients/acme/folder.pdf'), 'not-allowed');
    expect(existsSync(join(outside, 'secret.pdf'))).toBe(true);
    expect(has('clients/acme/reports/real.pdf')).toBe(true);
    expect(holdings()).toHaveLength(0);
  });

  it('refuses a holding folder that is a link', () => {
    put('clients/acme/a.pdf');
    symlinkSync(outside, abs(HOLDING_DIR));
    const r = del('clients/acme/a.pdf');
    expect(r.reply.ok).toBe(false);
    expect(has('clients/acme/a.pdf')).toBe(true);
    expect(readdirSync(outside)).toHaveLength(0);
  });

  it('refuses protected names', () => {
    for (const rel of [
      'clients/acme/CLAUDE.md',
      'clients/acme/notes/claude.md',
      'clients/acme/notes/Readme.MD',
      'clients/acme/AGENTS.md',
      'clients/acme/profile.md',
      'clients/acme/Profile.MD',
    ]) {
      put(rel);
      expectRefused(del(rel), 'not-allowed');
      expect(has(rel)).toBe(true);
    }
    setEmail('olive@example.test');
    for (const rel of ['templates/AGENTS.md', 'templates/x/CLAUDE.md', 'templates/README.md']) {
      put(rel);
      expectRefused(del(rel), 'not-allowed');
    }
    put('clients/acme/notes/profile.md');
    expect(del('clients/acme/notes/profile.md').exit).toBe(0);
    put('templates/profile.md');
    expect(del('templates/profile.md').exit).toBe(0);
  });

  // v0.3 (plan 2026-11-20-projects-system, decision 27): a project's own record is never deleted.
  it("refuses a project's card, retainer terms, updates and months, in any letter case", () => {
    const folder = 'clients/acme/projects/website';
    for (const rel of [
      `${folder}/project.md`,
      `${folder}/Project.MD`,
      `${folder}/retainer.md`,
      `${folder}/updates/2026-11-21-1004-sam-example-a1b2c3.md`,
      `${folder}/updates/old/note.md`,
      `${folder}/months/2026-11.md`,
      `${folder}/Months/2026-11.r2.md`,
      `clients/acme/Projects/website/project.md`,
    ]) {
      put(rel);
      expectRefused(del(rel), 'not-allowed');
      expect(has(rel), rel).toBe(true);
    }
    expect(holdings()).toEqual([]);
  });

  it('still deletes other files in a project folder, and the same names elsewhere', () => {
    for (const rel of [
      'clients/acme/projects/website/brief.pdf',
      'clients/acme/projects/website/reports/2026-11.pdf',
      'clients/acme/projects/website/summary.md',
      'clients/acme/projects/website/notes/project.md',
      'clients/acme/projects/website/drafts/updates/a.md',
      'clients/acme/project.md',
      'clients/acme/updates/a.md',
      'clients/acme/months/2026-11.md',
      'clients/acme/projects/project.md',
    ]) {
      put(rel);
      expect(del(rel).exit, rel).toBe(0);
      expect(has(rel), rel).toBe(false);
    }
  });

  it('only deletes the image and document types the library lists', () => {
    for (const rel of [
      'clients/acme/a.json',
      'clients/acme/a.zip',
      'clients/acme/noext',
      'clients/acme/a.pdf.bak',
    ]) {
      put(rel);
      expectRefused(del(rel), 'not-allowed');
    }
    put('clients/acme/Shout.PDF');
    expect(del('clients/acme/Shout.PDF').exit).toBe(0);
    for (const ext of files.LIBRARY_EXTENSIONS) {
      put(`clients/acme/x.${ext}`);
      expect(del(`clients/acme/x.${ext}`).exit, ext).toBe(0);
    }
  });

  it('takes the role from git identity: clients for everyone on the team, templates for the owner', () => {
    put('templates/brief.docx');
    put('clients/acme/a.pdf');
    put('clients/acme/b.pdf');
    put('clients/acme/c.pdf');
    // A scout who claims to be the owner on stdin is still a scout.
    expectRefused(del('templates/brief.docx', { by: 'olive-owner', by_name: 'Olive Owner' }), 'not-allowed');
    setEmail('tess@example.test');
    expectRefused(del('templates/brief.docx'), 'not-allowed');
    expect(del('clients/acme/a.pdf').exit).toBe(0);
    setEmail('hal@example.test');
    expectRefused(del('templates/brief.docx'), 'not-allowed');
    expect(del('clients/acme/b.pdf').exit).toBe(0);
    setEmail('stranger@example.test');
    expectRefused(del('clients/acme/c.pdf'), 'not-allowed');
    setEmail('nobody@example.test');
    expectRefused(del('clients/acme/c.pdf'), 'not-allowed');
    setEmail('OLIVE@Example.Test');
    const r = del('templates/brief.docx');
    expect(r.exit).toBe(0);
    expect(record(r.reply.holding as string)).toMatchObject({
      scope: 'templates',
      deleted_by: 'olive-owner',
      deleted_by_name: 'Olive Owner',
    });
  });

  it('matches by name only when no email is set', () => {
    put('templates/a.pdf');
    setEmail(null);
    git(['config', 'user.name', 'Olive Owner']);
    expect(del('templates/a.pdf').exit).toBe(0);
    put('templates/b.pdf');
    setEmail('sam@example.test');
    expectRefused(del('templates/b.pdf'), 'not-allowed');
  });

  it('refuses everything when roles.json is missing or unreadable', () => {
    put('clients/acme/a.pdf');
    writeFileSync(join(root, '.team-config', 'roles.json'), '{ not json');
    expectRefused(del('clients/acme/a.pdf'), 'not-allowed');
    rmSync(join(root, '.team-config'), { recursive: true });
    expectRefused(del('clients/acme/a.pdf'), 'not-allowed');
    expect(has('clients/acme/a.pdf')).toBe(true);
  });

  it('refuses a git-ignored source', () => {
    put('clients/acme/data/semrush-rankings.csv');
    put('clients/acme/auction-insights/week.html');
    const r = del('clients/acme/data/semrush-rankings.csv');
    expectRefused(r, 'not-allowed');
    expect(r.reply.error).toContain('git ignores it');
    expectRefused(del('clients/acme/auction-insights/week.html'), 'not-allowed');
    expect(has('clients/acme/data/semrush-rankings.csv')).toBe(true);
    put('clients/acme/data/other.csv');
    expect(del('clients/acme/data/other.csv').exit).toBe(0);
  });

  it('refuses a file inside a separate git project in a client folder (security gate, 2026-11-15)', () => {
    // Before the brain's next sync, git sees the nested project's files as not ignored. Moved into
    // the holding folder they would leave that project and be committed to the whole team.
    put('clients/acme/site/notes.md');
    mkdirSync(join(root, 'clients', 'acme', 'site', '.git'));
    const r = del('clients/acme/site/notes.md');
    expectRefused(r, 'not-allowed');
    expect(r.reply.error).toContain('separate git project');
    expect(has('clients/acme/site/notes.md')).toBe(true);
    // A `.git` file (a worktree or submodule pointer) counts too.
    put('clients/acme/other/b.md');
    writeFileSync(join(root, 'clients', 'acme', 'other', '.git'), 'gitdir: ../../../elsewhere\n');
    expectRefused(del('clients/acme/other/b.md'), 'not-allowed');
  });

  it('refuses when the brain is not a git repository', () => {
    put('clients/acme/a.pdf');
    rmSync(join(root, '.git'), { recursive: true, force: true });
    // Identity can't come from the repo's config any more: give git a global one in this home.
    writeFileSync(join(home, '.gitconfig'), '[user]\n\temail = sam@example.test\n');
    const r = del('clients/acme/a.pdf');
    expectRefused(r, 'not-allowed');
    expect(r.reply.error).toContain("isn't a git repository");
    expect(has('clients/acme/a.pdf')).toBe(true);
  });

  it('refuses when git cannot answer the ignore check (command line)', () => {
    put('clients/acme/a.pdf');
    const bin = join(home, 'bin');
    mkdirSync(bin);
    const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = check-ignore ] && exit 128; done\nexec "${realGit}" "$@"\n`,
    );
    chmodSync(join(bin, 'git'), 0o755);
    const r = cli('delete', JSON.stringify({ path: 'clients/acme/a.pdf' }), {
      PATH: `${bin}:${process.env.PATH}`,
    });
    expect(r.code).toBe(2);
    expect(r.json.code).toBe('not-allowed');
    expect(r.json.error).toContain("git couldn't check");
    expect(has('clients/acme/a.pdf')).toBe(true);
  });
});

describe('restore', () => {
  function deleted(rel: string, text = 'hello', now = T0): string {
    put(rel, text);
    const r = del(rel, {}, now);
    expect(r.exit).toBe(0);
    return r.reply.holding as string;
  }

  it("still puts back a project's card deleted before v0.3 (decision 27 guards deletes only)", () => {
    const folder = 'clients/acme/projects/website';
    const holding = deleted(`${folder}/old.md`, 'card');
    // As an older script would have held it: the same record, naming project.md.
    const dir = join(abs(HOLDING_DIR), holding);
    renameSync(join(dir, ...`${folder}/old.md`.split('/')), join(dir, ...`${folder}/project.md`.split('/')));
    const rec = record(holding);
    writeFileSync(
      join(dir, 'record.json'),
      JSON.stringify({ ...rec, path: `${folder}/project.md` }, null, 2),
    );
    expect(call('restore', { holding }).exit).toBe(0);
    expect(readFileSync(abs(`${folder}/project.md`), 'utf8')).toBe('card');
  });

  it('puts the file back, logs it and removes the emptied holding folder', () => {
    const holding = deleted('clients/acme/reports/q3.pdf', 'q3');
    const r = call('restore', { holding, via: 'chat' }, at(1));
    expect(r.exit).toBe(0);
    expect(r.reply).toEqual({ ok: true, action: 'restore', path: 'clients/acme/reports/q3.pdf' });
    expect(readFileSync(abs('clients/acme/reports/q3.pdf'), 'utf8')).toBe('q3');
    expect(existsSync(join(abs(HOLDING_DIR), holding))).toBe(false);
    expect(existsSync(join(abs(HOLDING_DIR), 'README.md'))).toBe(true);
    const lines = logLines();
    expect(lines.map((l) => l.action)).toEqual(['delete', 'restore']);
    expect(lines[1]).toMatchObject({
      v: 1,
      ts: at(1).toISOString(),
      by: 'sam-example',
      via: 'chat',
      scope: 'client',
      path: 'clients/acme/reports/q3.pdf',
      bytes: 2,
      holding,
    });
  });

  it('refuses with exists when something is at the path, and overwrites nothing', () => {
    const holding = deleted('clients/acme/a.pdf', 'old');
    put('clients/acme/a.pdf', 'new');
    expectRefused(call('restore', { holding }), 'exists');
    expect(readFileSync(abs('clients/acme/a.pdf'), 'utf8')).toBe('new');
    expect(readFileSync(join(abs(HOLDING_DIR), holding, 'clients', 'acme', 'a.pdf'), 'utf8')).toBe('old');
    rmSync(abs('clients/acme/a.pdf'));
    symlinkSync(join(outside, 'nothing.pdf'), abs('clients/acme/a.pdf'));
    expectRefused(call('restore', { holding }), 'exists');
    expect(existsSync(join(outside, 'nothing.pdf'))).toBe(false);
  });

  it('recreates a parent folder that has gone', () => {
    const holding = deleted('clients/acme/reports/2026/q3.pdf');
    rmSync(abs('clients/acme/reports'), { recursive: true });
    expect(call('restore', { holding }).exit).toBe(0);
    expect(has('clients/acme/reports/2026/q3.pdf')).toBe(true);
  });

  it('refuses a parent folder that is now a link', () => {
    const holding = deleted('clients/acme/reports/q3.pdf');
    rmSync(abs('clients/acme/reports'), { recursive: true });
    symlinkSync(outside, abs('clients/acme/reports'));
    expectRefused(call('restore', { holding }), 'not-allowed');
    expect(readdirSync(outside)).toHaveLength(0);
  });

  it('ignores bytes: a file changed in holding still comes back', () => {
    const holding = deleted('clients/acme/a.pdf', 'short');
    writeFileSync(join(abs(HOLDING_DIR), holding, 'clients', 'acme', 'a.pdf'), 'a much longer edit');
    expect(call('restore', { holding }).exit).toBe(0);
    expect(readFileSync(abs('clients/acme/a.pdf'), 'utf8')).toBe('a much longer edit');
  });

  it('refuses malformed holding ids', () => {
    deleted('clients/acme/a.pdf');
    for (const holding of [
      undefined,
      42,
      '',
      '..',
      '../clients',
      '20261115-102030-ABCDEF',
      '20261115-102030-abcdef/..',
      'x/20261115-102030-abcdef',
      'log',
      'README.md',
    ]) {
      expectRefused(call('restore', { holding }), 'bad-request');
    }
    expectRefused(call('restore', { holding: '20990101-000000-abcdef' }), 'not-found');
  });

  it('re-checks a tampered record.path with the delete rules', () => {
    const holding = deleted('clients/acme/a.pdf');
    const dir = join(abs(HOLDING_DIR), holding);
    const tamper = (path: unknown, scope: unknown = 'client') => {
      const rec = record(holding);
      writeFileSync(join(dir, 'record.json'), JSON.stringify({ ...rec, path, scope }));
    };
    const tries: [unknown, unknown][] = [
      ['../outside.pdf', 'client'],
      ['clients/acme/../../escape.pdf', 'client'],
      [`${outside}/x.pdf`, 'client'],
      ['personal/a.pdf', 'client'],
      ['todo/a.md', 'client'],
      [`${HOLDING_DIR}/a.pdf`, 'client'],
      ['clients/acme/config/a.pdf', 'client'],
      ['clients/acme/CLAUDE.md', 'client'],
      ['clients/acme/a.sh', 'client'],
      ['templates/a.pdf', 'templates'],
      ['clients/acme/a.pdf', 'templates'],
      [42, 'client'],
    ];
    for (const [path, scope] of tries) {
      tamper(path, scope);
      const r = call('restore', { holding });
      expect(r.reply.ok, String(path)).toBe(false);
      expect(['not-allowed', 'bad-request']).toContain(r.reply.code);
    }
    writeFileSync(join(dir, 'record.json'), '{ broken');
    expectRefused(call('restore', { holding }), 'not-allowed');
    expect(readdirSync(outside)).toHaveLength(0);
    expect(existsSync(join(root, '..', 'escape.pdf'))).toBe(false);
    expect(has('personal/a.pdf')).toBe(false);
  });

  it('lets the owner restore a template but not a scout', () => {
    setEmail('olive@example.test');
    const holding = deleted('templates/brief.pdf');
    setEmail('sam@example.test');
    expectRefused(call('restore', { holding }), 'not-allowed');
    setEmail('olive@example.test');
    expect(call('restore', { holding }).exit).toBe(0);
  });
});

describe('purge', () => {
  function deleted(rel: string, now = T0): string {
    put(rel, 'bytes!');
    const r = del(rel, {}, now);
    expect(r.exit).toBe(0);
    return r.reply.holding as string;
  }
  const purge = (now: Date) => call('purge', {}, now);

  it('erases only entries past purge_after, logs each erased file, and is a no-op the second time', () => {
    const old = deleted('clients/acme/old.pdf', T0);
    const young = deleted('clients/acme/young.pdf', at(10));
    const before29 = purge(at(29));
    expect(before29.reply).toEqual({ ok: true, action: 'purge', erased: 0 });
    expect(holdings()).toHaveLength(2);

    const r = purge(at(30));
    expect(r.exit).toBe(0);
    expect(r.reply).toEqual({ ok: true, action: 'purge', erased: 1 });
    expect(holdings()).toEqual([young]);
    expect(existsSync(join(abs(HOLDING_DIR), old))).toBe(false);
    const purged = logLines().filter((l) => l.action === 'purge');
    expect(purged).toEqual([
      {
        v: 1,
        ts: at(30).toISOString(),
        action: 'purge',
        by: 'sam-example',
        by_name: 'Sam Example',
        via: 'tdsapp-files skill',
        scope: 'client',
        path: 'clients/acme/old.pdf',
        bytes: 6,
        holding: old,
      },
    ]);
    const logBefore = logLines().length;
    expect(purge(at(30)).reply).toEqual({ ok: true, action: 'purge', erased: 0 });
    expect(logLines()).toHaveLength(logBefore);
    expect(existsSync(join(abs(HOLDING_DIR), 'README.md'))).toBe(true);
    expect(logFiles()).toHaveLength(1);
  });

  it('needs the folder-name date 30 days past too, so an early purge_after erases nothing', () => {
    const holding = deleted('clients/acme/a.pdf', T0);
    const dir = join(abs(HOLDING_DIR), holding);
    writeFileSync(
      join(dir, 'record.json'),
      JSON.stringify({ ...record(holding), purge_after: at(-5).toISOString() }),
    );
    expect(purge(at(1)).reply.erased).toBe(0);
    expect(existsSync(dir)).toBe(true);
    expect(purge(at(30)).reply.erased).toBe(1);
  });

  it('never purges a malformed record or a folder with the wrong name', () => {
    const broken = deleted('clients/acme/a.pdf');
    writeFileSync(join(abs(HOLDING_DIR), broken, 'record.json'), 'not json');
    const v2 = deleted('clients/acme/b.pdf');
    writeFileSync(join(abs(HOLDING_DIR), v2, 'record.json'), JSON.stringify({ ...record(v2), v: 2 }));
    const noDate = deleted('clients/acme/c.pdf');
    writeFileSync(
      join(abs(HOLDING_DIR), noDate, 'record.json'),
      JSON.stringify({ ...record(noDate), purge_after: 'soon' }),
    );
    const missing = deleted('clients/acme/d.pdf');
    rmSync(join(abs(HOLDING_DIR), missing, 'record.json'));
    const odd = join(abs(HOLDING_DIR), 'old-stuff');
    mkdirSync(odd);
    writeFileSync(join(odd, 'record.json'), JSON.stringify(record(v2)));
    const badDate = join(abs(HOLDING_DIR), '20261341-999999-abcdef');
    mkdirSync(badDate);
    writeFileSync(join(badDate, 'record.json'), JSON.stringify({ ...record(v2), v: 1 }));
    expect(purge(at(400)).reply.erased).toBe(0);
    for (const h of [broken, v2, noDate, missing]) expect(existsSync(join(abs(HOLDING_DIR), h))).toBe(true);
    expect(existsSync(odd)).toBe(true);
    expect(existsSync(badDate)).toBe(true);
    expect(existsSync(abs(ACTION_LOG_DIR))).toBe(true);
  });

  it('never follows a link inside a holding entry', () => {
    const holding = deleted('clients/acme/a.pdf');
    writeFileSync(join(outside, 'keep.pdf'), 'keep');
    symlinkSync(outside, join(abs(HOLDING_DIR), holding, 'clients', 'acme', 'linked'));
    expect(purge(at(31)).reply.erased).toBe(1);
    expect(readFileSync(join(outside, 'keep.pdf'), 'utf8')).toBe('keep');
    expect(existsSync(join(abs(HOLDING_DIR), holding))).toBe(false);
  });

  for (const [what, make] of [
    ['a merge', () => writeFileSync(join(root, '.git', 'MERGE_HEAD'), 'x\n')],
    ['a rebase (merge)', () => mkdirSync(join(root, '.git', 'rebase-merge'))],
    ['a rebase (apply)', () => mkdirSync(join(root, '.git', 'rebase-apply'))],
    ['a sync lock', () => mkdirSync(join(root, '.claude', 'sync.lockdir'), { recursive: true })],
  ] as const) {
    it(`skips the whole run during ${what}`, () => {
      const holding = deleted('clients/acme/a.pdf');
      make();
      const r = purge(at(60));
      expect(r.reply.ok).toBe(true);
      expect(r.reply.erased).toBe(0);
      expect(existsSync(join(abs(HOLDING_DIR), holding))).toBe(true);
    });
  }

  it('does nothing when there is no holding folder', () => {
    expect(purge(at(60)).reply).toEqual({ ok: true, action: 'purge', erased: 0 });
    expect(existsSync(abs(HOLDING_DIR))).toBe(false);
  });
});

describe('list-deleted', () => {
  it('lists records newest first and flags a file changed after deletion', () => {
    put('clients/acme/a.pdf', 'aaa');
    put('clients/acme/b.pdf', 'bbb');
    const a = del('clients/acme/a.pdf', {}, T0).reply.holding as string;
    const b = del('clients/acme/b.pdf', {}, at(1)).reply.holding as string;
    writeFileSync(join(abs(HOLDING_DIR), a, 'clients', 'acme', 'a.pdf'), 'edited later');
    mkdirSync(join(abs(HOLDING_DIR), 'junk'));
    const r = call('list-deleted');
    expect(r.exit).toBe(0);
    expect(r.reply.action).toBe('list-deleted');
    const items = r.reply.items as Record<string, unknown>[];
    expect(items.map((i) => i.holding)).toEqual([b, a]);
    expect(items[0]).toEqual({ ...record(b), holding: b, changed_after_deletion: false });
    expect(items[1]).toMatchObject({ path: 'clients/acme/a.pdf', bytes: 3, changed_after_deletion: true });
  });

  it('is empty without a holding folder', () => {
    expect(call('list-deleted').reply).toEqual({ ok: true, action: 'list-deleted', items: [] });
  });
});

describe('command line', () => {
  it('answers capabilities', () => {
    const r = cli('capabilities', '');
    expect(r.code).toBe(0);
    expect(r.json).toEqual({
      ok: true,
      action: 'capabilities',
      version: '0.4',
      features: [FILES_CAPABILITY, 'files-add-v1', 'files-artifact-v1'],
    });
    expect(files.SCRIPT_VERSION).toBe('0.4');
  });

  it('deletes with exit 0 and refuses with exit 2', () => {
    put('clients/acme/a.pdf');
    const ok = cli('delete', JSON.stringify({ path: 'clients/acme/a.pdf', via: 'TDS Brain App' }));
    expect(ok.code).toBe(0);
    expect(ok.json.ok).toBe(true);
    const again = cli('delete', JSON.stringify({ path: 'clients/acme/a.pdf' }));
    expect(again.code).toBe(2);
    expect(again.json).toMatchObject({ ok: false, code: 'not-found' });
  });

  it('refuses bad JSON, a non-object, an over-long body and an unknown action', () => {
    for (const input of ['{', '[]', 'null', '"x"', JSON.stringify({ path: 'x'.repeat(70_000) })]) {
      const r = cli('delete', input);
      expect(r.code, input.slice(0, 10)).toBe(2);
      expect(r.json.code).toBe('bad-request');
    }
    const r = cli('erase-everything', '{}');
    expect(r.code).toBe(2);
    expect(r.json.code).toBe('bad-request');
    expect(cli('', '{}').json.code).toBe('bad-request');
  });
});

describe('constants', () => {
  it('protect the project names the contract reserves', () => {
    expect(files.PROJECT_PROTECTED_NAMES).toEqual([...PROJECT_PROTECTED_NAMES]);
  });

  it('match the contract', () => {
    expect(files.PURGE_AFTER_DAYS).toBe(PURGE_AFTER_DAYS);
    expect(files.HOLDING_DIR).toBe(HOLDING_DIR);
    expect(files.ACTION_LOG_DIR).toBe(ACTION_LOG_DIR);
    expect(files.HOLDING_ID_PATTERN.source).toBe(HOLDING_ID_PATTERN.source);
    expect(files.HOLDING_ID_PATTERN.flags).toBe(HOLDING_ID_PATTERN.flags);
    expect([...files.PROTECTED_NAMES]).toEqual([...PROTECTED_NAMES]);
    expect([...files.PROTECTED_CLIENT_FILES]).toEqual([...PROTECTED_CLIENT_FILES]);
    expect(files.FILES_CAPABILITY).toBe(FILES_CAPABILITY);
  });

  it('list the same image and document extensions as the library', () => {
    const source = readFileSync(LIBRARY_RULES, 'utf8');
    const block = source.slice(
      source.indexOf('const CLASSES'),
      source.indexOf('};', source.indexOf('const CLASSES')),
    );
    const libraryExts = [...block.matchAll(/^\s+([a-z0-9]+):/gm)].map((m) => m[1] as string);
    expect(libraryExts.length).toBeGreaterThan(10);
    expect([...files.LIBRARY_EXTENSIONS].sort()).toEqual([...libraryExts].sort());
    for (const ext of files.IMAGE_EXTENSIONS) expect(classify(ext)?.kind, ext).toBe('image');
    for (const ext of files.DOCUMENT_EXTENSIONS) expect(classify(ext)?.kind, ext).toBe('document');
    expect([...files.LIBRARY_EXTENSIONS].sort()).toEqual(
      [...files.IMAGE_EXTENSIONS, ...files.DOCUMENT_EXTENSIONS].sort(),
    );
    for (const ext of ['json', 'zip', 'heic', 'doc', 'xls', 'mov', 'js', 'sh']) {
      expect(files.LIBRARY_EXTENSIONS.includes(ext)).toBe(classify(ext) !== null);
    }
  });

  it('add only the to-do upload types, images to images/ and documents to files/', () => {
    expect(files.ADD_CAPABILITY).toBe('files-add-v1');
    expect(files.ADD_MAX_BYTES).toBe(MAX_UPLOAD_BYTES);
    expect([...files.ADD_IMAGE_EXTENSIONS, ...files.ADD_DOCUMENT_EXTENSIONS].sort()).toEqual(
      [...TODO_UPLOAD_TYPES].sort(),
    );
    for (const ext of files.ADD_IMAGE_EXTENSIONS) expect(classify(ext)?.kind, ext).toBe('image');
    for (const ext of files.ADD_DOCUMENT_EXTENSIONS) expect(classify(ext)?.kind, ext).toBe('document');
  });

  it('make member slugs by the brain rule', () => {
    for (const name of ['Sam Example', 'Ben McAdam', "Seán O'Neil", 'Anne-Marie  Smith', 'x_y.z', '']) {
      expect(files.memberSlug(name), name).toBe(appMemberSlug(name));
    }
    expect(files.memberSlug('Anne-Marie  Smith')).toBe('anne-marie--smith');
  });
});

// ---- add (v0.2, docs/plans/2026-11-16-todo-attachments.md, decision 3) ---------------------------

describe('add', () => {
  // A file outside the brain, as the app's upload staging holds it.
  function source(name: string, text = 'file bytes') {
    const p = join(outside, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
    return p;
  }
  function add(path: string, src: string, extra: Record<string, unknown> = {}) {
    return call('add', { source: src, path, ...extra });
  }
  const tempsIn = (rel: string) =>
    existsSync(abs(rel)) ? readdirSync(abs(rel)).filter((n) => n.includes('.tmp')) : [];
  // personal/ as the brain keeps it: everything but its two rules files is git-ignored.
  function personalBrain() {
    mkdirSync(abs('personal'));
    writeFileSync(abs('personal/CLAUDE.md'), 'rules');
    writeFileSync(join(root, '.gitignore'), 'personal/*\n!personal/CLAUDE.md\n!personal/AGENTS.md\n');
  }

  beforeEach(() => {
    mkdirSync(abs('clients/acme'), { recursive: true });
    put('clients/acme/profile.md', 'profile');
  });

  it("copies a client document into the client's files/ folder, making it, and logs it", () => {
    const src = source('quote.pdf', 'quote bytes');
    const r = add('clients/acme/files/quote.pdf', src, { via: 'TDS Brain App', by: 'olive-owner' });
    expect(r).toEqual({ exit: 0, reply: { ok: true, action: 'add', path: 'clients/acme/files/quote.pdf' } });
    expect(readFileSync(abs('clients/acme/files/quote.pdf'), 'utf8')).toBe('quote bytes');
    expect(readFileSync(src, 'utf8')).toBe('quote bytes');
    expect(readdirSync(abs('clients/acme/files'))).toEqual(['quote.pdf']);
    expect(logLines()).toEqual([
      {
        v: 1,
        ts: T0.toISOString(),
        action: 'add',
        by: 'sam-example',
        by_name: 'Sam Example',
        via: 'TDS Brain App',
        scope: 'client',
        path: 'clients/acme/files/quote.pdf',
        bytes: 11,
        holding: '',
      },
    ]);
    // Nothing else in the holding folder: no README, no holding entry.
    expect(holdings()).toEqual([]);
  });

  it("puts an image in the client's images/ folder", () => {
    const r = add('clients/acme/images/logo.png', source('logo.png'), {});
    expect(r.reply).toEqual({ ok: true, action: 'add', path: 'clients/acme/images/logo.png' });
    expect(has('clients/acme/images/logo.png')).toBe(true);
    expect(logLines()[0]?.via).toBe('tdsapp-files skill');
  });

  it('never overwrites: a name already taken gets (2), (3) …', () => {
    put('clients/acme/files/quote.pdf', 'first');
    put('clients/acme/files/quote (2).pdf', 'second');
    const r = add('clients/acme/files/quote.pdf', source('quote.pdf', 'third'));
    expect(r.reply.path).toBe('clients/acme/files/quote (3).pdf');
    expect(readFileSync(abs('clients/acme/files/quote.pdf'), 'utf8')).toBe('first');
    expect(readFileSync(abs('clients/acme/files/quote (2).pdf'), 'utf8')).toBe('second');
    expect(readFileSync(abs('clients/acme/files/quote (3).pdf'), 'utf8')).toBe('third');
    const again = add('clients/acme/files/quote.pdf', source('quote.pdf', 'fourth'));
    expect(again.reply.path).toBe('clients/acme/files/quote (4).pdf');
    expect(logLines().map((l) => l.path)).toEqual([
      'clients/acme/files/quote (3).pdf',
      'clients/acme/files/quote (4).pdf',
    ]);
    expect(tempsIn('clients/acme/files')).toEqual([]);
  });

  it('counts a name taken in another letter case as taken', () => {
    put('clients/acme/files/Quote.PDF', 'first');
    const r = add('clients/acme/files/quote.pdf', source('quote.pdf', 'second'));
    expect(r.exit).toBe(0);
    expect(readFileSync(abs('clients/acme/files/Quote.PDF'), 'utf8')).toBe('first');
    expect(readFileSync(abs(r.reply.path as string), 'utf8')).toBe('second');
  });

  it('copies into personal/files/ and personal/images/ when git ignores them, and logs nothing', () => {
    personalBrain();
    const a = add('personal/files/My notes.pdf', source('My notes.pdf', 'mine'));
    expect(a).toEqual({ exit: 0, reply: { ok: true, action: 'add', path: 'personal/files/My notes.pdf' } });
    const b = add('personal/images/a.png', source('a.png'));
    expect(b.reply.path).toBe('personal/images/a.png');
    expect(readFileSync(abs('personal/files/My notes.pdf'), 'utf8')).toBe('mine');
    expect(existsSync(abs(HOLDING_DIR))).toBe(false);
    const c = add('personal/files/My notes.pdf', source('My notes.pdf', 'again'));
    expect(c.reply.path).toBe('personal/files/My notes (2).pdf');
  });

  it('refuses a personal destination git does not ignore, writing and making nothing', () => {
    mkdirSync(abs('personal'));
    const r = add('personal/files/a.pdf', source('a.pdf'));
    expectRefused(r, 'not-allowed');
    expect(r.reply.error).toContain('would sync');
    expect(existsSync(abs('personal/files'))).toBe(false);
    // Ignored in general but one name let back in: still refused.
    writeFileSync(join(root, '.gitignore'), 'personal/*\n!personal/files/\n');
    expectRefused(add('personal/files/a.pdf', source('a.pdf')), 'not-allowed');
    expect(existsSync(abs('personal/files/a.pdf'))).toBe(false);
  });

  it('refuses a protected name written with a look-alike letter (the long s)', () => {
    const r = add('clients/acme/files/AGENT\u017f.md', source('AGENT\u017f.md'));
    expectRefused(r, 'not-allowed');
    expect(existsSync(abs('clients/acme/files'))).toBe(false);
    expect(logLines()).toEqual([]);
  });

  it('refuses a client destination git ignores', () => {
    writeFileSync(join(root, '.gitignore'), '/clients/acme/images/\n*.secret.pdf\n');
    const r = add('clients/acme/images/a.png', source('a.png'));
    expectRefused(r, 'not-allowed');
    expect(r.reply.error).toContain('git ignores it');
    expect(existsSync(abs('clients/acme/images'))).toBe(false);
    expectRefused(add('clients/acme/files/x.secret.pdf', source('x.secret.pdf')), 'not-allowed');
    expect(logLines()).toEqual([]);
  });

  it('checks the final name too, when a taken name becomes (2)', () => {
    writeFileSync(join(root, '.gitignore'), '*(2).pdf\n');
    put('clients/acme/files/a.pdf', 'first');
    const r = add('clients/acme/files/a.pdf', source('a.pdf'));
    expectRefused(r, 'not-allowed');
    expect(readdirSync(abs('clients/acme/files'))).toEqual(['a.pdf']);
  });

  it('refuses inside a separate git project, outside a git repository, and when git cannot check', () => {
    mkdirSync(abs('clients/inner/.git'), { recursive: true });
    const r = add('clients/inner/files/a.pdf', source('a.pdf'));
    expectRefused(r, 'not-allowed');
    expect(r.reply.error).toContain('separate git project');
    personalBrain();
    rmSync(join(root, '.git'), { recursive: true, force: true });
    writeFileSync(join(home, '.gitconfig'), '[user]\n\temail = sam@example.test\n');
    for (const path of ['clients/acme/files/a.pdf', 'personal/files/a.pdf']) {
      const nr = add(path, source('a.pdf'));
      expectRefused(nr, 'not-allowed');
      expect(nr.reply.error, path).toContain("isn't a git repository");
      expect(has(path)).toBe(false);
    }
  });

  it('refuses when git cannot answer the ignore check (command line)', () => {
    personalBrain();
    const bin = join(home, 'bin');
    mkdirSync(bin);
    const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = check-ignore ] && exit 128; done\nexec "${realGit}" "$@"\n`,
    );
    chmodSync(join(bin, 'git'), 0o755);
    for (const path of ['clients/acme/files/a.pdf', 'personal/files/a.pdf']) {
      const r = cli('add', JSON.stringify({ source: source('a.pdf'), path }), {
        PATH: `${bin}:${process.env.PATH}`,
      });
      expect(r.code, path).toBe(2);
      expect(r.json.code).toBe('not-allowed');
      expect(r.json.error).toContain("git couldn't check");
      expect(has(path)).toBe(false);
    }
  });

  it('only takes the four destination shapes', () => {
    const src = source('a.pdf');
    for (const path of [
      'clients/acme/a.pdf',
      'clients/acme/files/sub/a.pdf',
      'clients/acme/Files/a.pdf',
      'clients/acme/docs/a.pdf',
      'clients/files/a.pdf',
      'personal/a.pdf',
      'personal/files/sub/a.pdf',
      'personal/Files/a.pdf',
      'personal/todo/a.pdf',
      'templates/files/a.pdf',
      'templates/a.pdf',
      'todo/a.pdf',
      'projects/x/files/a.pdf',
      'tdsapp-deleted/files/a.pdf',
      'clients/_archive/files/a.pdf',
      'clients/.hidden/files/a.pdf',
      'clients/acme/files/.a.pdf',
      '../clients/acme/files/a.pdf',
      '/clients/acme/files/a.pdf',
      'clients/acme/files/../files/a.pdf',
      'clients/acme//files/a.pdf',
      'clients\\acme\\files\\a.pdf',
    ]) {
      const r = add(path, src);
      expect(r.reply.ok, path).toBe(false);
      expect(['not-allowed', 'bad-request'], path).toContain(r.reply.code);
    }
    for (const path of ['', 5, null]) expectRefused(call('add', { source: src, path }), 'bad-request');
    expect(readdirSync(abs('clients/acme')).sort()).toEqual(['profile.md']);
    expect(logLines()).toEqual([]);
  });

  it('refuses protected names', () => {
    for (const name of ['README.md', 'claude.MD', 'AGENTS.md']) {
      const r = add(`clients/acme/files/${name}`, source(name));
      expectRefused(r, 'not-allowed');
      expect(r.reply.error, name).toContain('protected');
    }
    expect(existsSync(abs('clients/acme/files'))).toBe(false);
  });

  it('takes images in images/ and documents in files/, only of the upload types, matching the source', () => {
    const cases: [string, string, boolean][] = [
      ['clients/acme/images/a.png', 'a.png', true],
      ['clients/acme/images/a.JPG', 'a.jpg', true],
      ['clients/acme/images/a.jpeg', 'a.jpeg', true],
      ['clients/acme/images/a.webp', 'a.webp', true],
      ['clients/acme/images/a.gif', 'a.gif', true],
      ['clients/acme/files/a.pdf', 'A.PDF', true],
      ['clients/acme/files/a.md', 'a.md', true],
      ['clients/acme/files/a.txt', 'a.txt', true],
      ['clients/acme/files/a.docx', 'a.docx', true],
      ['clients/acme/files/a.csv', 'a.csv', true],
      ['clients/acme/files/a.xlsx', 'a.xlsx', true],
      ['clients/acme/files/a.pptx', 'a.pptx', true],
      ['clients/acme/images/b.pdf', 'b.pdf', false],
      ['clients/acme/files/b.png', 'b.png', false],
      ['clients/acme/images/b.svg', 'b.svg', false],
      ['clients/acme/images/b.avif', 'b.avif', false],
      ['clients/acme/files/b.html', 'b.html', false],
      ['clients/acme/files/b.htm', 'b.htm', false],
      ['clients/acme/files/b.zip', 'b.zip', false],
      ['clients/acme/files/b', 'b', false],
      ['clients/acme/files/c.pdf', 'c.txt', false],
      ['clients/acme/files/c.pdf', 'c', false],
      ['clients/acme/images/c.png', 'c.jpg', false],
    ];
    for (const [path, name, ok] of cases) {
      const r = add(path, source(`${path.replace(/\//g, '_')}/${name}`));
      expect(r.reply.ok, `${path} from ${name}: ${JSON.stringify(r.reply)}`).toBe(ok);
      if (!ok) expect(has(path), path).toBe(false);
    }
  });

  it('refuses a client folder that is missing or a link, and a files/ folder that is a link', () => {
    const r = add('clients/newco/files/a.pdf', source('a.pdf'));
    expectRefused(r, 'not-found');
    expect(existsSync(abs('clients/newco'))).toBe(false);
    mkdirSync(join(outside, 'elsewhere'));
    symlinkSync(join(outside, 'elsewhere'), abs('clients/linked'));
    expectRefused(add('clients/linked/files/a.pdf', source('a.pdf')), 'not-allowed');
    expect(readdirSync(join(outside, 'elsewhere'))).toEqual([]);
    symlinkSync(join(outside, 'elsewhere'), abs('clients/acme/files'));
    expectRefused(add('clients/acme/files/a.pdf', source('a.pdf')), 'not-allowed');
    put('clients/acme/images', 'a file, not a folder');
    expectRefused(add('clients/acme/images/a.png', source('a.png')), 'not-allowed');
    put('clients/plain.pdf');
    expectRefused(add('clients/ACME/files/b.pdf', source('b.pdf')), 'not-allowed');
    expect(readdirSync(join(outside, 'elsewhere'))).toEqual([]);
    expect(logLines()).toEqual([]);
  });

  it('refuses a personal folder that is missing or a link, never making personal/', () => {
    writeFileSync(join(root, '.gitignore'), 'personal/*\n');
    expectRefused(add('personal/files/a.pdf', source('a.pdf')), 'not-found');
    expect(existsSync(abs('personal'))).toBe(false);
    mkdirSync(join(outside, 'mine'));
    symlinkSync(join(outside, 'mine'), abs('personal'));
    expectRefused(add('personal/files/a.pdf', source('a.pdf')), 'not-allowed');
    expect(readdirSync(join(outside, 'mine'))).toEqual([]);
  });

  it('refuses a source that is not a regular file outside the brain, or is over 32 MB', () => {
    put('clients/acme/files/inside.pdf', 'inside');
    const refused: [unknown, string][] = [
      ['relative/a.pdf', 'bad-request'],
      [join(outside, 'missing.pdf'), 'not-found'],
      [abs('clients/acme/files/inside.pdf'), 'not-allowed'],
      ['', 'bad-request'],
      [5, 'bad-request'],
      [undefined, 'bad-request'],
    ];
    mkdirSync(join(outside, 'folder.pdf'));
    refused.push([join(outside, 'folder.pdf'), 'not-allowed']);
    const real = source('real.pdf');
    symlinkSync(real, join(outside, 'link.pdf'));
    refused.push([join(outside, 'link.pdf'), 'not-allowed']);
    symlinkSync(abs('clients/acme/files'), join(outside, 'into-brain'));
    refused.push([join(outside, 'into-brain', 'inside.pdf'), 'not-allowed']);
    const big = join(outside, 'big.pdf');
    writeFileSync(big, '');
    truncateSync(big, 32 * 1024 * 1024 + 1);
    refused.push([big, 'bad-request']);
    for (const [src, code] of refused) {
      const r = call('add', { source: src, path: 'clients/acme/files/new.pdf' });
      expectRefused(r, code);
    }
    expect(has('clients/acme/files/new.pdf')).toBe(false);
    expect(logLines()).toEqual([]);
  });

  it('takes the person from git: anyone on the team for a client, anyone for personal', () => {
    setEmail('tess@example.test');
    expect(add('clients/acme/files/a.pdf', source('a.pdf')).exit).toBe(0);
    expect(logLines()[0]?.by).toBe('tess-team');
    setEmail('stranger@example.test');
    const r = add('clients/acme/files/b.pdf', source('b.pdf'), { by_name: 'Olive Owner' });
    expectRefused(r, 'not-allowed');
    personalBrain();
    expect(add('personal/files/b.pdf', source('b.pdf')).exit).toBe(0);
  });

  it('works from the command line', () => {
    const r = cli(
      'add',
      JSON.stringify({ source: source('a.pdf'), path: 'clients/acme/files/a.pdf', via: 'TDS Brain App' }),
    );
    expect(r).toEqual({ code: 0, json: { ok: true, action: 'add', path: 'clients/acme/files/a.pdf' } });
    const again = cli('add', JSON.stringify({ source: source('a.pdf'), path: 'clients/acme/images/a.pdf' }));
    expect(again.code).toBe(2);
    expect(again.json.code).toBe('not-allowed');
  });
});

// ---- add-artifact (v0.4, docs/plans/2026-11-23-claude-artifacts-in-projects.md, decisions 2, 6, 7) ----

describe('add-artifact', () => {
  const URL = 'https://claude.ai/artifact/AbC-123';
  const DIR = 'clients/acme/projects/site/files';
  const BLOCK = (kind = 'copy', extra = '') =>
    `<meta name="tds-artifact-source" content="${URL}">\n<meta name="tds-artifact-copied" content="2026-11-20">\n<meta name="tds-artifact-kind" content="${kind}">\n${extra}`;
  function source(name: string, content: string | Buffer = '<!doctype html><html></html>') {
    const p = join(outside, name);
    writeFileSync(p, content);
    return p;
  }
  function art(path: string, extra: Record<string, unknown> = {}) {
    return call('add-artifact', { url: URL, path, copied: '2026-11-20', ...extra });
  }
  const read = (rel: string) => readFileSync(abs(rel), 'utf8');

  beforeEach(() => {
    mkdirSync(abs('clients/acme/projects/site'), { recursive: true });
    put('clients/acme/projects/site/project.md', '# Site');
    put('clients/acme/profile.md', 'profile');
  });

  it('refuses a project folder that has no card (security review: a live project only)', () => {
    mkdirSync(abs('clients/acme/projects/bare'), { recursive: true });
    expectRefused(art('clients/acme/projects/bare/files/p.html', { title: 'T' }), 'not-found');
    mkdirSync(abs('clients/acme/projects/odd/project.md'), { recursive: true });
    expectRefused(art('clients/acme/projects/odd/files/p.html', { title: 'T' }), 'not-found');
  });

  it('writes the block once, straight after a doctype', () => {
    const r = art(`${DIR}/page.html`, {
      source: source('a.html', '<!doctype html>\n<html><head></head></html>'),
    });
    expect(r).toEqual({
      exit: 0,
      reply: { ok: true, action: 'add-artifact', path: `${DIR}/page.html`, kind: 'copy' },
    });
    const out = read(`${DIR}/page.html`);
    expect(out).toBe(`<!doctype html>${BLOCK()}\n<html><head></head></html>`);
    expect(out.split('tds-artifact-source').length).toBe(2);
    expect(logLines()[0]).toMatchObject({ action: 'add', scope: 'client', path: `${DIR}/page.html` });
  });

  it('writes it at the start without a doctype, and the live tag only when partial', () => {
    art(`${DIR}/p.html`, { source: source('b.html', '<p>hi</p>'), partial: true });
    expect(read(`${DIR}/p.html`)).toBe(
      `${BLOCK('copy', '<meta name="tds-artifact-live" content="partial">\n')}<p>hi</p>`,
    );
  });

  it('writes it after a BOM, and after comments before the doctype', () => {
    art(`${DIR}/bom.html`, { source: source('c.html', '\uFEFF<p>x</p>') });
    expect(read(`${DIR}/bom.html`)).toBe(`\uFEFF${BLOCK()}<p>x</p>`);
    art(`${DIR}/c.html`, { source: source('d.html', '<!-- hi -->\n<!DOCTYPE html><p>x</p>') });
    expect(read(`${DIR}/c.html`)).toBe(`<!-- hi -->\n<!DOCTYPE html>${BLOCK()}<p>x</p>`);
  });

  it('keeps the source bytes (non-UTF-8 included) and accepts a .htm source', () => {
    const bytes = Buffer.concat([Buffer.from('<p>'), Buffer.from([0xe9, 0xff]), Buffer.from('</p>')]);
    const r = art(`${DIR}/legacy.html`, { source: source('e.htm', bytes) });
    expect(r.exit).toBe(0);
    const out = readFileSync(abs(`${DIR}/legacy.html`));
    expect(out.subarray(out.length - bytes.length).equals(bytes)).toBe(true);
  });

  it('refuses UTF-16, over 5 MB, a bad extension and a source inside the brain', () => {
    expectRefused(
      art(`${DIR}/u.html`, { source: source('u.html', Buffer.from([0xff, 0xfe, 0x3c, 0x00])) }),
      'bad-request',
    );
    expectRefused(
      art(`${DIR}/u.html`, { source: source('u2.html', Buffer.from([0xfe, 0xff, 0x00, 0x3c])) }),
      'bad-request',
    );
    expectRefused(
      art(`${DIR}/big.html`, { source: source('big.html', Buffer.alloc(5 * 1024 * 1024 + 1, 0x61)) }),
      'bad-request',
    );
    expectRefused(art(`${DIR}/x.html`, { source: source('x.txt', 'hi') }), 'bad-request');
    put('clients/acme/inside.html', '<p>');
    expectRefused(art(`${DIR}/x.html`, { source: abs('clients/acme/inside.html') }), 'not-allowed');
    expect(has(`${DIR}/x.html`)).toBe(false);
  });

  it('files a link card without a source: escaped, no script, one external address', () => {
    const r = art(`${DIR}/card.html`, {
      title: 'Q4 <b>"plan"</b> & more',
      description: "Notes <script>alert(1)</script> it's",
    });
    expect(r.reply).toEqual({ ok: true, action: 'add-artifact', path: `${DIR}/card.html`, kind: 'link' });
    const out = read(`${DIR}/card.html`);
    expect(out.startsWith(`<!doctype html>\n${BLOCK('link')}`)).toBe(true);
    expect(out).toContain('<title>Q4 &lt;b&gt;&quot;plan&quot;&lt;/b&gt; &amp; more</title>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('<b>');
    expect(out).toContain(
      `<a class="button" href="${URL}" target="_blank" rel="noopener noreferrer">Open on claude.ai</a>`,
    );
    expect(out).toContain('This is a link to a page on claude.ai. Open it there to see it.');
    expect(out).toContain('Added 20 November 2026');
    expect(out).toContain('prefers-color-scheme: dark');
    expect(out.match(/https?:\/\/[^\s"'<>)]+/g)?.filter((u) => u !== URL)).toEqual([]);
  });

  it('defaults copied to today (local date)', () => {
    const r = call('add-artifact', { url: URL, path: `${DIR}/t.html`, title: 'T' });
    expect(r.exit).toBe(0);
    const d = T0;
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(read(`${DIR}/t.html`)).toContain(`name="tds-artifact-copied" content="${today}"`);
  });

  it('checks the title, description, partial and copied', () => {
    expectRefused(art(`${DIR}/n.html`), 'bad-request');
    expectRefused(art(`${DIR}/n.html`, { title: '' }), 'bad-request');
    expectRefused(art(`${DIR}/n.html`, { title: 'x'.repeat(201) }), 'bad-request');
    expectRefused(art(`${DIR}/n.html`, { title: 'a\nb' }), 'bad-request');
    expectRefused(art(`${DIR}/n.html`, { title: 'ok', description: 'x'.repeat(301) }), 'bad-request');
    expectRefused(art(`${DIR}/n.html`, { title: 'ok', partial: true }), 'bad-request');
    expectRefused(art(`${DIR}/n.html`, { title: 'ok', copied: '2026-02-30' }), 'bad-request');
    expectRefused(art(`${DIR}/n.html`, { title: 'ok', copied: '23/11/2026' }), 'bad-request');
    expect(has(`${DIR}/n.html`)).toBe(false);
  });

  it('cleans the address and refuses anything else', () => {
    const ok = call('add-artifact', {
      url: `  ${URL}/?x=1#frag `,
      path: `${DIR}/q.html`,
      title: 'T',
      copied: '2026-11-20',
    });
    expect(ok.exit).toBe(0);
    expect(read(`${DIR}/q.html`)).toContain(`content="${URL}/">`);
    for (const bad of [
      'http://claude.ai/artifact/abc',
      'https://claude.ai.evil.test/artifact/abc',
      'https://claude.ai/artifact/',
      'https://claude.ai/chat/abc',
      'https://claude.ai/artifact/abc/def',
      'https://user@claude.ai/artifact/abc',
      `https://claude.ai/artifact/${'a'.repeat(65)}`,
      'javascript:alert(1)',
      '',
    ]) {
      expectRefused(call('add-artifact', { url: bad, path: `${DIR}/r.html`, title: 'T' }), 'bad-request');
    }
    expect(files.cleanArtifactUrl('https://claude.ai/code/artifact/0a-1')).toBe(
      'https://claude.ai/code/artifact/0a-1',
    );
  });

  it('cleans addresses exactly as the shared reader does (one table for both copies)', () => {
    for (const c of ARTIFACT_URL_CASES) expect(files.cleanArtifactUrl(c.input), c.input).toBe(c.clean);
  });

  it('allows only the two files/ shapes', () => {
    mkdirSync(abs('personal/projects/mine'), { recursive: true });
    writeFileSync(abs('personal/projects/mine/project.md'), '# Mine');
    writeFileSync(join(root, '.gitignore'), 'personal/*\n');
    expect(art('personal/projects/mine/files/p.html', { title: 'T' }).exit).toBe(0);
    expect(logLines()).toEqual([]);
    for (const bad of [
      'clients/acme/files/x.html',
      'projects/site/files/x.html',
      'clients/acme/projects/site/x.html',
      'clients/acme/projects/site/files/deep/x.html',
      'clients/acme/projects/site/images/x.html',
      'personal/projects/mine/x.html',
      'personal/files/x.html',
      `${DIR}/x.htm`,
      `${DIR}/x.pdf`,
      `${DIR}/x`,
      `${DIR}/a\u0001.html`,
      `${DIR}/../x.html`,
    ]) {
      expect(art(bad, { title: 'T' }).exit, bad).toBe(2);
    }
  });

  it('needs the project folder to exist, and makes files/', () => {
    expectRefused(art('clients/acme/projects/nope/files/x.html', { title: 'T' }), 'not-found');
    expect(has('clients/acme/projects/site/files')).toBe(false);
    expect(art(`${DIR}/x.html`, { title: 'T' }).exit).toBe(0);
    expect(has(DIR)).toBe(true);
  });

  it('never overwrites: a taken name gets (2)', () => {
    put(`${DIR}/page.html`, 'mine');
    const r = art(`${DIR}/page.html`, { title: 'T' });
    expect(r.reply.path).toBe(`${DIR}/page (2).html`);
    expect(read(`${DIR}/page.html`)).toBe('mine');
    expect(readdirSync(abs(DIR)).filter((n) => n.includes('.tmp'))).toEqual([]);
  });

  it('refuses protected names and non-team people', () => {
    expectRefused(art(`${DIR}/README.md`, { title: 'T' }), 'not-allowed');
    setEmail('stranger@example.test');
    expectRefused(art(`${DIR}/x.html`, { title: 'T' }), 'not-allowed');
  });

  it('leaves add alone: the old target rule still applies', () => {
    expectRefused(call('add', { source: source('z.html', '<p>'), path: `${DIR}/z.html` }), 'not-allowed');
  });
});
