// Tests for the brain's `tdsapp-todo` skill script. Each case runs the real script as a child
// process against a throwaway brain, and checks the file text and JSON. Where v0.3 keeps the
// Workbench's behaviour (tools/members/command-centre/server.cjs), the tests pin it; where it
// deliberately differs (docs/plans/2026-11-13-todo-skill-fixes.md, decisions 2-14), the tests pin
// the new behaviour. The compatibility tests read every file the script writes with frozen copies
// of the Workbench's and the Reminders sync's parsers, and with the app's own parser.
// This test stays in the app repo; it is not copied into the brain.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stampDone } from '../../../server/brain/done-record.ts';
import { parseFrontmatter as appParse } from '../../../server/brain/frontmatter.ts';
import { classify, isNeverListed as libraryNeverListed } from '../../../server/brain/library-rules.ts';
import { parseTodoFiles, splitTodoFiles } from '../../../shared/todo-files.ts';

const SCRIPT = fileURLToPath(new URL('./tdsapp-todo.cjs', import.meta.url));
const SHIM = fileURLToPath(new URL('../../todo/scripts/todo.cjs', import.meta.url));

const require = createRequire(import.meta.url);
const workbench = require('../test-fixtures/workbench-parser.cjs') as {
  parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string };
};
const reminders = require('../test-fixtures/reminders-sync-parser.cjs') as {
  parse(content: string): { fm: Record<string, string> };
  cleanTitle(s: string): string;
  titleOf(content: string, file: string): string;
};

let root: string;

const ROLES = {
  members: [
    { name: 'Sam Example', email: 'sam@example.test', role: 'scout' },
    { name: 'Ben McAdam', email: 'ben@example.test', role: 'team' },
    { email: 'nobody@example.test', role: 'team' },
  ],
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'todo-skill-'));
  mkdirSync(join(root, 'todo'));
  mkdirSync(join(root, '.team-config'));
  writeFileSync(join(root, '.team-config', 'roles.json'), JSON.stringify(ROLES));
});

afterEach(() => {
  if (existsSync(join(root, 'todo'))) chmodSync(join(root, 'todo'), 0o755);
  rmSync(root, { recursive: true, force: true });
});

// git reads only this env's config: no system or global file, user.name fixed (or unset).
function gitEnv(userName: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: root,
    BRAIN_ROOT: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
  if (userName !== null) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'user.name';
    env.GIT_CONFIG_VALUE_0 = userName;
  }
  return env;
}

interface RunResult {
  code: number | null;
  json: Record<string, unknown>;
}

function run(
  command: string,
  input: unknown = {},
  opts: { userName?: string | null; env?: NodeJS.ProcessEnv; script?: string } = {},
): RunResult {
  const env = { ...gitEnv(opts.userName === undefined ? 'Sam Example' : opts.userName), ...opts.env };
  const r = spawnSync(process.execPath, [opts.script ?? SCRIPT, command], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env,
    cwd: root,
    encoding: 'utf8',
  });
  const lines = r.stdout.split('\n').filter(Boolean);
  expect(lines, r.stderr).toHaveLength(1);
  return { code: r.status, json: JSON.parse(lines[0] as string) };
}

const todoPath = (file: string) => join(root, 'todo', file);
const read = (file: string) => readFileSync(todoPath(file), 'utf8');
const put = (file: string, text: string | Buffer) => writeFileSync(todoPath(file), text);
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const versionOf = (file: string) => sha(readFileSync(todoPath(file)));
const temps = (dir = join(root, 'todo')) => readdirSync(dir).filter((f) => f.startsWith('.tdsapp-todo-'));

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const stamp = () => today().replace(/-/g, '');

// Today's date in the UK, as the title history line and the done/deleted records write it.
function ukDate(): string {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())) {
    p[part.type] = part.value;
  }
  return `${p.year}-${p.month}-${p.day}`;
}
const history = (old: string) => `\n## Title history\n\n- ${ukDate()}: was "${old}"\n`;

const SAMPLE =
  '---\nassignee: sam-example\ntitle: Old title\ncreated: 2026-11-01\n---\n\n# Old title\n\nSome details.\n';

const titleLine = (file: string) => read(file).match(/^title: .*$/m)?.[0];

// v0.4: the personal folder, and the handover record that `assignee` adds.
const personalPath = (file: string) => join(root, 'personal', 'todo', file);
const readPersonal = (file: string) => readFileSync(personalPath(file), 'utf8');
function putPersonal(file: string, text: string | Buffer) {
  mkdirSync(join(root, 'personal', 'todo'), { recursive: true });
  writeFileSync(personalPath(file), text);
}
// The text without the v0.4 handover record: what v0.3 would have written.
function withoutHandover(text: string): string {
  return text
    .replace(/^assigned_[a-z]+: .*\r?\n/gm, '')
    .replace(/\r?\n## Handover history\r?\n\r?\n(?:- .*\r?\n)+/, '');
}
const fmValue = (text: string, key: string) => text.match(new RegExp(`^${key}: (.*?)\\r?$`, 'm'))?.[1];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "13 Nov 2026, 14:05 UK" from an `assigned_at` value.
function ukWhen(at: string): string {
  const [, y, m, d, hm] = at.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}):\d{2}[+-]\d{2}:\d{2}$/) ?? [];
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}, ${hm} UK`;
}
// Makes the throwaway brain a git repository, with or without the rule that keeps personal/ out.
function gitInit(ignorePersonal: boolean) {
  const r = spawnSync('git', ['init', '-q'], { cwd: root, env: gitEnv('Sam Example'), encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  if (ignorePersonal) writeFileSync(join(root, '.gitignore'), 'personal/\n');
}

describe('add', () => {
  it('writes the Workbench frontmatter, defaulting the assignee to git user.name', () => {
    const r = run('add', { title: 'Renew the contract' });
    const file = `${stamp()}-renew-the-contract.md`;
    expect(r).toEqual({ code: 0, json: { ok: true, file } });
    expect(read(file)).toBe(
      `---\nassignee: sam-example\ntitle: Renew the contract\ncreated: ${today()}\ncreated_by: sam-example\nsource: added with the todo skill\n---\n`,
    );
  });

  it('writes due after created when given', () => {
    const r = run('add', { title: 'Book venue', due: '2026-12-01', assignee: 'sam-example' });
    expect(read(r.json.file as string)).toBe(
      `---\nassignee: sam-example\ntitle: Book venue\ncreated: ${today()}\ncreated_by: sam-example\ndue: 2026-12-01\nsource: added with the todo skill\n---\n`,
    );
  });

  it('slugifies an explicit assignee', () => {
    const a = run('add', { title: 'One', assignee: '  Ben McAdam!! ' });
    expect(read(a.json.file as string)).toContain('\nassignee: ben-mcadam\n');
  });

  it('leaves the to-do open when git has no user name and none is sent', () => {
    const r = run('add', { title: 'Open one' }, { userName: null });
    expect(r.code).toBe(0);
    expect(read(r.json.file as string)).toBe(
      `---\ntitle: Open one\ncreated: ${today()}\nsource: added with the todo skill\n---\n`,
    );
  });

  it('flattens new lines and trims the title, and cuts the file name slug to 60', () => {
    const title = `  Line one\r\nline two ${'x'.repeat(150)}  `;
    const r = run('add', { title });
    const kept = `Line one line two ${'x'.repeat(150)}`;
    const slug = kept
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 60);
    expect(r.json.file).toBe(`${stamp()}-${slug}.md`);
    expect(read(r.json.file as string)).toContain(`\ntitle: ${kept}\n`);
  });

  it("falls back to 'todo' when the title has no letters or digits", () => {
    expect(run('add', { title: '!!!' }).json.file).toBe(`${stamp()}-todo.md`);
  });

  it('adds -2, -3 on a name clash', () => {
    expect(run('add', { title: 'Same' }).json.file).toBe(`${stamp()}-same.md`);
    expect(run('add', { title: 'Same' }).json.file).toBe(`${stamp()}-same-2.md`);
    expect(run('add', { title: 'Same' }).json.file).toBe(`${stamp()}-same-3.md`);
  });

  it('refuses a missing title and a malformed due date', () => {
    expect(run('add', {})).toEqual({ code: 2, json: { error: 'title is required', status: 400 } });
    expect(run('add', { title: ' \n ' })).toEqual({
      code: 2,
      json: { error: 'title is required', status: 400 },
    });
    expect(run('add', { title: 'x', due: '12/01/2026' })).toEqual({
      code: 2,
      json: { error: 'due must be YYYY-MM-DD', status: 400 },
    });
    expect(readdirSync(join(root, 'todo'))).toEqual([]);
  });

  it('accepts due null as no date (as the Workbench does)', () => {
    const r = run('add', { title: 'No date', due: null, assignee: 'sam-example' });
    expect(read(r.json.file as string)).not.toContain('due:');
  });

  it('leaves no temporary files behind', () => {
    run('add', { title: 'Tidy' });
    expect(temps()).toEqual([]);
  });
});

describe('edit', () => {
  it('replaces the title only and leaves the body when body is not sent', () => {
    put('a.md', SAMPLE.replace('# Old title', '# A heading of its own'));
    expect(run('edit', { file: 'a.md', title: 'New title' })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', title: 'New title' },
    });
    expect(read('a.md')).toBe(
      SAMPLE.replace('title: Old title', 'title: New title').replace(
        '# Old title',
        '# A heading of its own',
      ) + history('Old title'),
    );
  });

  it('replaces the whole body when body is sent', () => {
    put('a.md', SAMPLE);
    const r = run('edit', { file: 'a.md', title: 'New', body: '\r\n  First line\r\nSecond  \n' });
    expect(r.json).toEqual({
      ok: true,
      file: 'a.md',
      title: 'New',
      body: `First line\nSecond\n${history('Old title').trimEnd()}`,
    });
    expect(read('a.md')).toBe(
      `---\nassignee: sam-example\ntitle: New\ncreated: 2026-11-01\n---\n\nFirst line\nSecond\n${history('Old title')}`,
    );
  });

  it('an empty body leaves only the frontmatter', () => {
    put('a.md', SAMPLE);
    const r = run('edit', { file: 'a.md', title: 'Old title', body: '' });
    expect(r.json).toEqual({ ok: true, file: 'a.md', title: 'Old title', body: '' });
    expect(read('a.md')).toBe('---\nassignee: sam-example\ntitle: Old title\ncreated: 2026-11-01\n---\n');
  });

  it('adds a title line at the top when the frontmatter has none', () => {
    put('a.md', '---\ndue: 2026-12-01\n---\nBody\n');
    run('edit', { file: 'a.md', title: 'T' });
    expect(read('a.md')).toBe('---\ntitle: T\ndue: 2026-12-01\n---\nBody\n');
    run('edit', { file: 'a.md', title: 'T2', body: 'New body' });
    expect(read('a.md')).toBe(`---\ntitle: T2\ndue: 2026-12-01\n---\n\nNew body\n${history('T')}`);
  });

  it('adds a frontmatter block when the file has none', () => {
    put('a.md', '# Heading\n\nText\n');
    run('edit', { file: 'a.md', title: 'T' });
    expect(read('a.md')).toBe(`---\ntitle: T\n---\n\n# T\n\nText\n${history('Heading')}`);
    put('b.md', '# Heading\n');
    run('edit', { file: 'b.md', title: 'T', body: 'New' });
    expect(read('b.md')).toBe(`---\ntitle: T\n---\n\nNew\n${history('Heading')}`);
  });

  it('refuses unterminated frontmatter with 500 and leaves the file', () => {
    put('a.md', '---\ntitle: Broken\nno close\n');
    expect(run('edit', { file: 'a.md', title: 'X' })).toEqual({
      code: 2,
      json: { error: 'unterminated frontmatter in a.md', status: 500 },
    });
    expect(read('a.md')).toBe('---\ntitle: Broken\nno close\n');
  });

  it('refuses a missing title', () => {
    put('a.md', SAMPLE);
    expect(run('edit', { file: 'a.md' })).toEqual({
      code: 2,
      json: { error: 'title is required', status: 400 },
    });
  });
});

describe('due', () => {
  it('replaces, inserts before the closing line, and clears', () => {
    put('a.md', SAMPLE);
    expect(run('due', { file: 'a.md', due: '2026-12-01' })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', due: '2026-12-01' },
    });
    expect(read('a.md')).toBe(
      SAMPLE.replace('created: 2026-11-01\n', 'created: 2026-11-01\ndue: 2026-12-01\n'),
    );
    run('due', { file: 'a.md', due: '2026-12-25' });
    expect(read('a.md')).toContain('\ndue: 2026-12-25\n---\n');
    expect(run('due', { file: 'a.md', due: null })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', due: null },
    });
    expect(read('a.md')).toBe(SAMPLE);
  });

  it('adds a frontmatter block to a file without one, and leaves it alone when clearing', () => {
    put('a.md', 'Plain\n');
    run('due', { file: 'a.md', due: '' });
    expect(read('a.md')).toBe('Plain\n');
    run('due', { file: 'a.md', due: '2026-12-01' });
    expect(read('a.md')).toBe('---\ndue: 2026-12-01\n---\n\nPlain\n');
  });

  it('refuses a malformed date and unterminated frontmatter', () => {
    put('a.md', SAMPLE);
    expect(run('due', { file: 'a.md', due: '2026-1-1' })).toEqual({
      code: 2,
      json: { error: 'due must be YYYY-MM-DD', status: 400 },
    });
    put('b.md', '---\ndue: 2026-01-01\n');
    expect(run('due', { file: 'b.md', due: '2026-02-02' }).json).toEqual({
      error: 'unterminated frontmatter in b.md',
      status: 500,
    });
  });
});

describe('assignee', () => {
  it('replaces, inserts at the top, slugifies and clears', () => {
    put('a.md', SAMPLE);
    expect(run('assignee', { file: 'a.md', assignee: 'Ben McAdam' })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', assignee: 'ben-mcadam' },
    });
    // v0.4 adds the handover record (see "v0.4: assignee"); the rest is v0.3's change.
    expect(withoutHandover(read('a.md'))).toBe(
      SAMPLE.replace('assignee: sam-example', 'assignee: ben-mcadam'),
    );
    expect(run('assignee', { file: 'a.md', assignee: null }).json).toEqual({
      ok: true,
      file: 'a.md',
      assignee: null,
    });
    expect(withoutHandover(read('a.md'))).toBe(SAMPLE.replace('assignee: sam-example\n', ''));
    run('assignee', { file: 'a.md', assignee: 'sam-example' });
    expect(withoutHandover(read('a.md'))).toBe(SAMPLE);
  });

  it('adds a block to a file without frontmatter', () => {
    put('a.md', 'Plain\n');
    run('assignee', { file: 'a.md', assignee: 'ben-mcadam' });
    expect(withoutHandover(read('a.md'))).toBe('---\nassignee: ben-mcadam\n---\n\nPlain\n');
  });
});

describe('delete', () => {
  const deletedPath = (file: string) => join(root, 'todo', 'deleted', file);
  const UK_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

  it('moves the file into todo/deleted/, stamped with when, by whom and from where', () => {
    put('a.md', SAMPLE);
    const r = run('delete', { file: 'a.md', via: 'TDS Brain App' });
    expect(r).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', moved: join('todo', 'deleted', 'a.md') },
    });
    expect(existsSync(todoPath('a.md'))).toBe(false);
    const text = readFileSync(deletedPath('a.md'), 'utf8');
    const [, head = '', rest = ''] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
    const fm = Object.fromEntries(
      head.split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]),
    );
    expect(fm).toMatchObject({
      assignee: 'sam-example',
      title: 'Old title',
      created: '2026-11-01',
      status: 'deleted',
      deleted_by: 'sam-example',
      deleted_via: 'TDS Brain App',
    });
    expect(fm.deleted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fm.deleted_at).toMatch(UK_STAMP);
    expect(fm.deleted_at?.startsWith(fm.deleted as string)).toBe(true);
    // The body is kept, and a line for people says who deleted it and when.
    expect(rest).toContain('# Old title\n\nSome details.\n');
    expect(rest).toMatch(
      new RegExp(
        `\\n## Deleted ${fm.deleted}\\n\\nDeleted by Sam Example at \\d{2}:\\d{2} UK time \\(TDS Brain App\\)\\.\\n$`,
      ),
    );
    expect(temps(join(root, 'todo', 'deleted'))).toEqual([]);
  });

  it('says it came from the todo skill when no tool is named, and adds frontmatter to a plain file', () => {
    put('a.md', 'Plain\n');
    run('delete', { file: 'a.md' });
    const text = readFileSync(deletedPath('a.md'), 'utf8');
    expect(text).toMatch(
      /^---\nstatus: deleted\ndeleted: \S+\ndeleted_at: \S+\ndeleted_by: sam-example\ndeleted_via: todo skill\n---\nPlain\n/,
    );
  });

  it('records "unknown" when git has no user name', () => {
    put('a.md', SAMPLE);
    run('delete', { file: 'a.md' }, { userName: null });
    const text = readFileSync(deletedPath('a.md'), 'utf8');
    expect(text).toContain('\ndeleted_by: unknown\n');
    expect(text).toMatch(/Deleted by unknown at /);
  });

  it('replaces an earlier status line instead of adding a second one', () => {
    put('a.md', '---\ntitle: T\nstatus: open\n---\nBody\n');
    run('delete', { file: 'a.md' });
    const text = readFileSync(deletedPath('a.md'), 'utf8');
    expect(text.match(/^status:/gm)).toHaveLength(1);
    expect(text).toContain('\nstatus: deleted\n');
  });

  it('keeps an earlier deleted to-do of the same name, adding a suffix', () => {
    put('a.md', SAMPLE);
    run('delete', { file: 'a.md' });
    put('a.md', 'second\n');
    const r = run('delete', { file: 'a.md' });
    expect(r.json.moved).toMatch(/^todo\/deleted\/a-\d{13}\.md$/);
    expect(readFileSync(join(root, r.json.moved as string), 'utf8')).toContain('second');
    expect(readFileSync(deletedPath('a.md'), 'utf8')).toContain('Some details.');
  });

  it('writes a tool name only as one safe line', () => {
    put('a.md', SAMPLE);
    run('delete', { file: 'a.md', via: 'Bad\ndeleted_by: someone-else' });
    const text = readFileSync(deletedPath('a.md'), 'utf8');
    expect(text.match(/^deleted_by:/gm)).toHaveLength(1);
    expect(text).toContain('\ndeleted_by: sam-example\n');
    expect(text).toContain('\ndeleted_via: "Bad deleted_by: someone-else"\n');
  });

  it("records the caller's person when sent, so the app's deletes match its ticks", () => {
    put('a.md', SAMPLE);
    run('delete', { file: 'a.md', via: 'TDS Brain App', by: 'Mary-ONeil', by_name: "Mary O'Neil\nx" });
    const text = readFileSync(deletedPath('a.md'), 'utf8');
    expect(text).toContain('\ndeleted_by: mary-oneil\n');
    expect(text).toMatch(/Deleted by Mary O'Neil x at \d{2}:\d{2} UK time \(TDS Brain App\)\.\n$/);
  });

  it('keeps a byte order mark and Windows line endings', () => {
    put('a.md', '﻿---\r\ntitle: T\r\n---\r\nBody\r\n');
    run('delete', { file: 'a.md' });
    const text = readFileSync(deletedPath('a.md'), 'utf8');
    expect(text.startsWith('﻿---\r\ntitle: T\r\nstatus: deleted\r\n')).toBe(true);
    expect(text).not.toMatch(/[^\r]\n/);
  });

  it('cuts the tool name to 60 characters', () => {
    put('a.md', SAMPLE);
    run('delete', { file: 'a.md', via: 'v'.repeat(80) });
    expect(readFileSync(deletedPath('a.md'), 'utf8')).toContain(`\ndeleted_via: ${'v'.repeat(60)}\n`);
  });

  it('drops every line of an earlier multi-line deleted key, keeping the fields after it', () => {
    put('a.md', '---\ntitle: T\ndeleted_by:\n  - someone\n  - else\ntags:\n  - a\n---\nBody\n');
    run('delete', { file: 'a.md' });
    const text = readFileSync(deletedPath('a.md'), 'utf8');
    expect(text).not.toContain('someone');
    expect(text).toContain('\ntags:\n  - a\n');
  });

  it('leaves the to-do open, and nothing in todo/deleted/, when it cannot be moved', () => {
    put('a.md', SAMPLE);
    // todo/deleted/ can be written, todo/ can't: the copy is made, then removing the open one fails.
    mkdirSync(join(root, 'todo', 'deleted'));
    chmodSync(join(root, 'todo'), 0o555);
    try {
      const r = run('delete', { file: 'a.md' });
      expect(r.code).toBe(2);
      expect(r.json.status).toBe(500);
    } finally {
      chmodSync(join(root, 'todo'), 0o755);
    }
    expect(read('a.md')).toBe(SAMPLE);
    expect(readdirSync(join(root, 'todo', 'deleted'))).toEqual([]);
  });

  it('leaves deleted to-dos out of the list', () => {
    put('a.md', SAMPLE);
    put('b.md', SAMPLE.replace('Old title', 'Other'));
    run('delete', { file: 'a.md' });
    const files = (run('list').json.todos as { file: string }[]).map((t) => t.file);
    expect(files).toEqual(['b.md']);
  });
});

describe('tick', () => {
  const donePath = (file: string) => join(root, 'todo', 'done', file);

  it('moves the file into todo/done/, with a suffix when the name is taken', () => {
    put('a.md', SAMPLE);
    expect(run('tick', { file: 'a.md' })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', moved: join('todo', 'done', 'a.md') },
    });
    expect(readFileSync(donePath('a.md'), 'utf8')).toContain('# Old title\n\nSome details.\n');
    put('a.md', 'second');
    const r = run('tick', { file: 'a.md' });
    expect(r.json.moved).toMatch(/^todo\/done\/a-\d{13}\.md$/);
    expect(readFileSync(join(root, r.json.moved as string), 'utf8')).toContain('second');
    expect(existsSync(todoPath('a.md'))).toBe(false);
    expect(temps(join(root, 'todo', 'done'))).toEqual([]);
  });
});

describe('roster', () => {
  it('lists slugified names from roles.json, skipping members without a name', () => {
    expect(run('roster')).toEqual({
      code: 0,
      json: {
        members: [
          { slug: 'sam-example', name: 'Sam Example' },
          { slug: 'ben-mcadam', name: 'Ben McAdam' },
        ],
      },
    });
  });

  it('gives [] when roles.json is missing or unreadable', () => {
    rmSync(join(root, '.team-config', 'roles.json'));
    expect(run('roster')).toEqual({ code: 0, json: { members: [] } });
    writeFileSync(join(root, '.team-config', 'roles.json'), '{ nope');
    expect(run('roster', '')).toEqual({ code: 0, json: { members: [] } });
  });
});

describe('list', () => {
  beforeEach(() => {
    put(
      '20261101-mine.md',
      '---\nassignee: sam-example\ntitle: Mine\ncreated: 2026-11-01\n---\n\n  Details  \n',
    );
    put('20261102-ben.md', '---\nassignee: ben-mcadam\ntitle: Ben\ncreated: 2026-11-02\n---\n');
    put('20261103-open.md', '---\ntitle: Open\ncreated: 2026-11-03\ndue: 2026-12-01\n---\n');
    put('20261104-heading.md', '# From heading\n\nText\n');
    put('AGENTS.md', '# Rules\n');
    put('README.md', '# Readme\n');
    put('CLAUDE.md', '# Claude\n');
    put('empty.md', '');
    mkdirSync(join(root, 'todo', 'done'));
    writeFileSync(join(root, 'todo', 'done', 'old.md'), '---\ntitle: Old\n---\n');
  });

  const files = (r: RunResult) => (r.json.todos as { file: string }[]).map((t) => t.file);

  it("shows this person's to-dos and open ones, due first then newest created", () => {
    const r = run('list');
    expect(r.code).toBe(0);
    expect(files(r)).toEqual(['20261103-open.md', '20261104-heading.md', '20261101-mine.md']);
    const mine = (r.json.todos as Record<string, unknown>[]).find((t) => t.file === '20261101-mine.md');
    expect(mine).toMatchObject({
      title: 'Mine',
      created: '2026-11-01',
      due: null,
      source: null,
      assignee: 'sam-example',
      project: null,
      body: 'Details',
    });
    expect(typeof mine?.mtime).toBe('string');
    const heading = (r.json.todos as Record<string, unknown>[]).find((t) => t.file === '20261104-heading.md');
    expect(heading?.title).toBe('From heading');
  });

  it('honours WORKBENCH_AS', () => {
    const r = run('list', {}, { env: { WORKBENCH_AS: 'ben-mcadam' } });
    expect(files(r).sort()).toEqual(['20261102-ben.md', '20261103-open.md', '20261104-heading.md']);
  });

  it('shows everything when git has no user name', () => {
    expect(files(run('list', {}, { userName: null })).sort()).toEqual([
      '20261101-mine.md',
      '20261102-ben.md',
      '20261103-open.md',
      '20261104-heading.md',
    ]);
  });

  it('gives [] when there is no todo folder', () => {
    rmSync(join(root, 'todo'), { recursive: true });
    expect(run('list')).toEqual({ code: 0, json: { todos: [] } });
  });
});

describe('refusals', () => {
  const fileCommands: [string, Record<string, unknown>][] = [
    ['edit', { title: 'X' }],
    ['due', { due: '2026-12-01' }],
    ['assignee', { assignee: 'sam-example' }],
    ['delete', {}],
    ['tick', {}],
  ];

  it.each(fileCommands)('%s refuses bad file names with 400', (command, extra) => {
    put('CLAUDE.md', SAMPLE);
    put('README.md', SAMPLE);
    for (const file of [
      '',
      '../x.md',
      'a/b.md',
      '.hidden.md',
      '-x.md',
      'x.txt',
      'CLAUDE.md',
      'README.md',
      5,
    ]) {
      expect(run(command, { file, ...extra })).toEqual({
        code: 2,
        json: { error: 'invalid todo file', status: 400 },
      });
    }
    expect(read('CLAUDE.md')).toBe(SAMPLE);
  });

  it.each(fileCommands)('%s gives 404 for a missing file', (command, extra) => {
    expect(run(command, { file: 'Gone file.md', ...extra })).toEqual({
      code: 2,
      json: { error: 'todo not found: Gone file.md', status: 404 },
    });
  });

  it('refuses invalid JSON and non-objects', () => {
    for (const input of ['{', 'null', '[]', '"text"', '42']) {
      expect(run('add', input)).toEqual({ code: 2, json: { error: 'invalid JSON', status: 400 } });
    }
  });

  it('treats empty stdin as {}', () => {
    expect(run('add', '')).toEqual({ code: 2, json: { error: 'title is required', status: 400 } });
  });

  it('refuses an unknown or missing command', () => {
    for (const command of ['nope', 'toString', '__proto__', '']) {
      expect(run(command)).toEqual({ code: 2, json: { error: 'unknown command', status: 400 } });
    }
  });
});

// ---- v0.3 (docs/plans/2026-11-13-todo-skill-fixes.md) ------------------------------------------

describe('BCR-01: expect (decision 2)', () => {
  const commands: [string, Record<string, unknown>][] = [
    ['edit', { title: 'New title' }],
    ['due', { due: '2026-12-01' }],
    ['assignee', { assignee: 'ben-mcadam' }],
    ['delete', {}],
    ['tick', {}],
  ];

  it('list gives each to-do a version: the SHA-256 of its bytes', () => {
    put('a.md', SAMPLE);
    const [entry] = run('list').json.todos as { file: string; version: string }[];
    expect(entry?.version).toBe(sha(SAMPLE));
  });

  it.each(commands)('%s runs when expect matches the file', (command, extra) => {
    put('a.md', SAMPLE);
    const r = run(command, { file: 'a.md', expect: versionOf('a.md'), ...extra });
    expect(r.code).toBe(0);
  });

  it.each(commands)('%s refuses with 409 and writes nothing when the file changed', (command, extra) => {
    put('a.md', SAMPLE);
    const stale = versionOf('a.md');
    put('a.md', `${SAMPLE}A teammate's line.\n`);
    expect(run(command, { file: 'a.md', expect: stale, ...extra })).toEqual({
      code: 2,
      json: { error: 'changed since read', status: 409 },
    });
    expect(read('a.md')).toBe(`${SAMPLE}A teammate's line.\n`);
    expect(existsSync(join(root, 'todo', 'done'))).toBe(false);
    expect(existsSync(join(root, 'todo', 'deleted'))).toBe(false);
  });

  it('refuses a malformed expect with 400', () => {
    put('a.md', SAMPLE);
    for (const bad of ['abc', 42, 'g'.repeat(64)]) {
      expect(run('due', { file: 'a.md', due: '2026-12-01', expect: bad })).toEqual({
        code: 2,
        json: { error: 'expect must be a hex SHA-256', status: 400 },
      });
    }
    expect(read('a.md')).toBe(SAMPLE);
  });

  it('hashes the raw bytes, so a file with invalid UTF-8 still matches', () => {
    const bytes = Buffer.concat([Buffer.from('---\ntitle: Odd \xff\n---\n', 'latin1')]);
    put('a.md', bytes);
    const [entry] = run('list').json.todos as { version: string }[];
    expect(entry?.version).toBe(sha(bytes));
    expect(run('due', { file: 'a.md', due: '2026-12-01', expect: sha(bytes) }).code).toBe(0);
  });

  it('accepts an upper-case expect', () => {
    put('a.md', SAMPLE);
    expect(
      run('due', { file: 'a.md', due: '2026-12-01', expect: versionOf('a.md').toUpperCase() }).code,
    ).toBe(0);
  });
});

describe('BCR-02: refuse, do not cut (decision 3)', () => {
  it('refuses a title over 200 characters on add and edit, and accepts exactly 200', () => {
    put('a.md', SAMPLE);
    const tooLong = { code: 2, json: { error: 'title is too long (over 200 characters)', status: 400 } };
    expect(run('add', { title: 'x'.repeat(201) })).toEqual(tooLong);
    expect(run('edit', { file: 'a.md', title: `  ${'x'.repeat(201)}  ` })).toEqual(tooLong);
    expect(read('a.md')).toBe(SAMPLE);
    expect(readdirSync(join(root, 'todo'))).toEqual(['a.md']);
    expect(run('add', { title: `\n${'x'.repeat(200)}\n` }).code).toBe(0);
  });

  it('refuses details over 8000 characters after trimming, and accepts exactly 8000', () => {
    put('a.md', SAMPLE);
    expect(run('edit', { file: 'a.md', title: 'Old title', body: 'b'.repeat(8001) })).toEqual({
      code: 2,
      json: { error: 'details are too long (over 8000 characters)', status: 400 },
    });
    expect(read('a.md')).toBe(SAMPLE);
    const ok = run('edit', { file: 'a.md', title: 'Old title', body: `\r\n ${'b'.repeat(8000)} \r\n` });
    expect(ok.json.body).toBe('b'.repeat(8000));
  });

  it('counts a CRLF line break in details as one character', () => {
    put('a.md', SAMPLE);
    const body = `${'b'.repeat(3999)}\r\n${'b'.repeat(4000)}`;
    expect(run('edit', { file: 'a.md', title: 'Old title', body }).code).toBe(0);
  });

  it('refuses an assignee over 40 characters after slugging, on add and assignee', () => {
    put('a.md', SAMPLE);
    const tooLong = { code: 2, json: { error: 'assignee is too long (over 40 characters)', status: 400 } };
    expect(run('add', { title: 'x', assignee: 'y'.repeat(41) })).toEqual(tooLong);
    expect(run('assignee', { file: 'a.md', assignee: 'y'.repeat(41) })).toEqual(tooLong);
    expect(read('a.md')).toBe(SAMPLE);
  });
});

describe('BCR-03: quoting titles (decision 4)', () => {
  const cases: [string, string][] = [
    ['Plain title', 'title: Plain title'],
    ['ON HOLD: Work up quote', 'title: "ON HOLD: Work up quote"'],
    ['Fix #12', 'title: "Fix #12"'],
    ['C# guide', 'title: C# guide'],
    ['Ratio 3:1 check', 'title: Ratio 3:1 check'],
    ['Note:', 'title: "Note:"'],
    ['- bullet', 'title: "- bullet"'],
    ['@mention', 'title: "@mention"'],
    ['`code` thing', 'title: "`code` thing"'],
    ['% done', 'title: "% done"'],
    ['true', 'title: "true"'],
    ['Yes', 'title: "Yes"'],
    ['null', 'title: "null"'],
    ['~', 'title: "~"'],
    ['42', 'title: "42"'],
    ['3.5', 'title: "3.5"'],
    ['12:30', 'title: "12:30"'],
    ['2026-12-01', 'title: "2026-12-01"'],
    ['Say "hi": now', `title: 'Say "hi": now'`],
    ['Back\\slash: x', "title: 'Back\\slash: x'"],
    [`It's: "x"`, `title: It's: "x"`],
    [`"Quoted" and it's`, `title: ""Quoted" and it's"`],
    [`'Single' start`, `title: "'Single' start"`],
    [`"Only double"`, `title: '"Only double"'`],
  ];

  it.each(cases)('add writes %j as %s', (title, line) => {
    const r = run('add', { title });
    expect(titleLine(r.json.file as string)).toBe(line);
  });

  it.each(cases)('edit writes %j as %s', (title, line) => {
    put('a.md', '---\ntitle: Start\n---\n');
    run('edit', { file: 'a.md', title });
    expect(titleLine('a.md')).toBe(line);
  });
});

describe('BCR-04/16: title history (decision 5)', () => {
  it('updates a matching H1 and adds the old title under ## Title history', () => {
    put('a.md', SAMPLE);
    run('edit', { file: 'a.md', title: 'New title' });
    expect(read('a.md')).toBe(
      `${SAMPLE.replace('title: Old title', 'title: New title').replace('# Old title', '# New title')}${history('Old title')}`,
    );
  });

  it('treats a heading as matching after normalising case, spaces and punctuation', () => {
    put('a.md', SAMPLE.replace('# Old title', '#  OLD   title!'));
    run('edit', { file: 'a.md', title: 'Brand new' });
    expect(read('a.md')).toContain('\n# Brand new\n');
  });

  it('leaves a heading that differs on purpose alone, but still records the history', () => {
    put('a.md', SAMPLE.replace('# Old title', '# Background'));
    run('edit', { file: 'a.md', title: 'New title' });
    expect(read('a.md')).toContain('\n# Background\n');
    expect(read('a.md')).toContain(history('Old title'));
  });

  it('only rewords the heading, with no history, for a change of case, spaces or punctuation', () => {
    put('a.md', SAMPLE);
    run('edit', { file: 'a.md', title: 'old  Title!' });
    expect(read('a.md')).toBe(
      SAMPLE.replace('title: Old title', 'title: old  Title!').replace('# Old title', '# old  Title!'),
    );
  });

  it('changes nothing in the body when the title is the same', () => {
    put('a.md', SAMPLE);
    run('edit', { file: 'a.md', title: 'Old title' });
    expect(read('a.md')).toBe(SAMPLE);
  });

  it('adds to the end of an existing ## Title history section, before the next section', () => {
    put('a.md', `${SAMPLE}\n## Title history\n\n- 2026-11-02: was "Older"\n\n## Notes\n\nKeep this.\n`);
    run('edit', { file: 'a.md', title: 'New title' });
    expect(read('a.md')).toContain(
      `\n## Title history\n\n- 2026-11-02: was "Older"\n- ${ukDate()}: was "Old title"\n\n## Notes\n\nKeep this.\n`,
    );
    expect(read('a.md').match(/## Title history/g)).toHaveLength(1);
  });

  it('skips headings inside code fences', () => {
    put('a.md', '---\ntitle: Old title\n---\n\n```\n# Old title\n## Title history\n```\n');
    run('edit', { file: 'a.md', title: 'New title' });
    expect(read('a.md')).toBe(
      `---\ntitle: New title\n---\n\n\`\`\`\n# Old title\n## Title history\n\`\`\`\n${history('Old title')}`,
    );
  });

  it('takes the old title from the H1 when the frontmatter has none', () => {
    put('a.md', '---\ndue: 2026-12-01\n---\n# Heading\n');
    run('edit', { file: 'a.md', title: 'T' });
    expect(read('a.md')).toBe(`---\ntitle: T\ndue: 2026-12-01\n---\n# T\n${history('Heading')}`);
  });

  it('unquotes a quoted old title for the history line', () => {
    put('a.md', '---\ntitle: "ON HOLD: quote"\n---\n');
    run('edit', { file: 'a.md', title: 'Quote sent' });
    expect(read('a.md')).toBe(`---\ntitle: Quote sent\n---\n${history('ON HOLD: quote')}`);
  });

  it('applies the rules to a new body when one is sent', () => {
    put('a.md', SAMPLE);
    run('edit', { file: 'a.md', title: 'New title', body: '# Old title\n\nRewritten.' });
    expect(read('a.md')).toBe(
      `---\nassignee: sam-example\ntitle: New title\ncreated: 2026-11-01\n---\n\n# New title\n\nRewritten.\n${history('Old title')}`,
    );
  });
});

describe('BCR-06: open to-dos (decision 6)', () => {
  it('open: true adds it with no assignee line, even with a git name', () => {
    const r = run('add', { title: 'For anyone', open: true });
    expect(read(r.json.file as string)).toBe(
      `---\ntitle: For anyone\ncreated: ${today()}\ncreated_by: sam-example\nsource: added with the todo skill\n---\n`,
    );
  });

  it('open: true wins over an assignee sent alongside it', () => {
    const r = run('add', { title: 'For anyone', open: true, assignee: 'ben-mcadam' });
    expect(read(r.json.file as string)).not.toContain('assignee:');
  });
});

describe('BCR-07: assignees must be on the team (decision 7)', () => {
  it('refuses a slug that is not a member, on add and assignee, writing nothing', () => {
    put('a.md', SAMPLE);
    const refused = { code: 2, json: { error: 'assignee is not on the team: ben-mcadum', status: 400 } };
    expect(run('add', { title: 'x', assignee: 'ben-mcadum' })).toEqual(refused);
    expect(run('assignee', { file: 'a.md', assignee: 'Ben McAdum' })).toEqual(refused);
    expect(readdirSync(join(root, 'todo'))).toEqual(['a.md']);
    expect(read('a.md')).toBe(SAMPLE);
  });

  it("accepts either slug rule for a member's name", () => {
    writeFileSync(
      join(root, '.team-config', 'roles.json'),
      JSON.stringify({ members: [{ name: "Jo O'Neil" }] }),
    );
    put('a.md', SAMPLE);
    expect(run('assignee', { file: 'a.md', assignee: 'jo-o-neil' }).code).toBe(0);
    expect(run('assignee', { file: 'a.md', assignee: 'jo-oneil' }).code).toBe(0);
    expect(read('a.md')).toContain('\nassignee: jo-oneil\n');
  });

  it('accepts anything when roles.json is missing, unreadable or has no names', () => {
    put('a.md', SAMPLE);
    const rolesPath = join(root, '.team-config', 'roles.json');
    rmSync(rolesPath);
    expect(run('assignee', { file: 'a.md', assignee: 'anyone-1' }).code).toBe(0);
    writeFileSync(rolesPath, '{ nope');
    expect(run('assignee', { file: 'a.md', assignee: 'anyone-2' }).code).toBe(0);
    writeFileSync(rolesPath, JSON.stringify({ members: [{ email: 'x@example.test' }] }));
    expect(run('assignee', { file: 'a.md', assignee: 'anyone-3' }).code).toBe(0);
    writeFileSync(rolesPath, '{}');
    expect(run('add', { title: 'x', assignee: 'anyone-4' }).code).toBe(0);
  });

  it('does not check the default assignee from git', () => {
    const r = run('add', { title: 'Mine' }, { userName: 'Not A Member' });
    expect(read(r.json.file as string)).toContain('\nassignee: not-a-member\n');
  });

  it('still lets an existing to-do with an unknown assignee be changed', () => {
    put('a.md', SAMPLE.replace('sam-example', 'left-the-team'));
    expect(run('due', { file: 'a.md', due: '2026-12-01' }).code).toBe(0);
    expect(run('edit', { file: 'a.md', title: 'Old title' }).code).toBe(0);
  });
});

describe('BCR-09: tick records who and when (decision 8)', () => {
  const donePath = (file: string) => join(root, 'todo', 'done', file);

  it("writes exactly the app's own tick record", () => {
    put('a.md', SAMPLE);
    run('tick', { file: 'a.md', via: 'TDS Brain App', by: 'ben-mcadam', by_name: 'Ben McAdam' });
    const text = readFileSync(donePath('a.md'), 'utf8');
    const at = text.match(/^completed_at: (.+)$/m)?.[1] as string;
    expect(
      stampDone(SAMPLE, {
        by: { slug: 'ben-mcadam', name: 'Ben McAdam' },
        at: new Date(at),
        via: 'TDS Brain App',
      }),
    ).toBe(text);
    expect(text).toMatch(
      /\n## Done \d{4}-\d{2}-\d{2}\n\nTicked off by Ben McAdam at \d{2}:\d{2} UK time \(TDS Brain App\)\.\n$/,
    );
  });

  it('defaults to the git name and "todo skill"', () => {
    put('a.md', '---\ntitle: T\nstatus: open\n---\nBody\n');
    run('tick', { file: 'a.md' });
    const text = readFileSync(donePath('a.md'), 'utf8');
    expect(text).toMatch(
      /^---\ntitle: T\nstatus: done\ncompleted: \S+\ncompleted_at: \S+\ncompleted_by: sam-example\ncompleted_via: todo skill\n---\nBody\n/,
    );
    expect(text).toMatch(/Ticked off by Sam Example at \d{2}:\d{2} UK time \(todo skill\)\.\n$/);
    expect(text.match(/^status:/gm)).toHaveLength(1);
  });

  it('keeps a byte order mark and Windows line endings', () => {
    put('a.md', '﻿---\r\ntitle: T\r\n---\r\nBody\r\n');
    run('tick', { file: 'a.md' });
    const text = readFileSync(donePath('a.md'), 'utf8');
    expect(text.startsWith('﻿---\r\ntitle: T\r\nstatus: done\r\n')).toBe(true);
    expect(text).not.toMatch(/[^\r]\n/);
  });

  it('leaves the to-do open, and nothing in todo/done/, when it cannot be moved', () => {
    put('a.md', SAMPLE);
    mkdirSync(join(root, 'todo', 'done'));
    chmodSync(join(root, 'todo'), 0o555);
    try {
      const r = run('tick', { file: 'a.md' });
      expect(r.code).toBe(2);
      expect(r.json.status).toBe(500);
    } finally {
      chmodSync(join(root, 'todo'), 0o755);
    }
    expect(read('a.md')).toBe(SAMPLE);
    expect(readdirSync(join(root, 'todo', 'done'))).toEqual([]);
  });
});

describe('BCR-11: line endings and byte order marks (decision 9)', () => {
  const CRLF = SAMPLE.replace(/\n/g, '\r\n');

  it('keeps CRLF on edit, due and assignee', () => {
    put('a.md', CRLF);
    run('due', { file: 'a.md', due: '2026-12-01' });
    run('assignee', { file: 'a.md', assignee: 'ben-mcadam' });
    run('edit', { file: 'a.md', title: 'Old title', body: 'One\nTwo' });
    expect(read('a.md')).not.toMatch(/[^\r]\n/);
    expect(withoutHandover(read('a.md'))).toBe(
      '---\r\nassignee: ben-mcadam\r\ntitle: Old title\r\ncreated: 2026-11-01\r\ndue: 2026-12-01\r\n---\r\n\r\nOne\r\nTwo\r\n',
    );
  });

  it('keeps CRLF in a title history and a new frontmatter block', () => {
    put('a.md', '# Heading\r\n\r\nText\r\n');
    run('edit', { file: 'a.md', title: 'T' });
    expect(read('a.md')).toBe(
      `---\ntitle: T\n---\n\n# T\n\nText\n${history('Heading')}`.replace(/\n/g, '\r\n'),
    );
    put('b.md', 'Plain\r\n');
    run('due', { file: 'b.md', due: '2026-12-01' });
    expect(read('b.md')).toBe('---\r\ndue: 2026-12-01\r\n---\r\n\r\nPlain\r\n');
  });

  it('takes the line ending from the first line break', () => {
    put('a.md', '---\ntitle: T\r\n---\r\nBody\r\n');
    run('due', { file: 'a.md', due: '2026-12-01' });
    expect(read('a.md')).toBe('---\ntitle: T\ndue: 2026-12-01\n---\nBody\n');
  });

  it('keeps a byte order mark and finds the frontmatter after it', () => {
    put('a.md', '﻿---\ntitle: T\ndue: 2026-01-01\n---\nBody\n');
    run('due', { file: 'a.md', due: '2026-12-01' });
    expect(read('a.md')).toBe('﻿---\ntitle: T\ndue: 2026-12-01\n---\nBody\n');
    run('assignee', { file: 'a.md', assignee: 'ben-mcadam' });
    run('edit', { file: 'a.md', title: 'T' });
    expect(withoutHandover(read('a.md'))).toBe(
      '﻿---\nassignee: ben-mcadam\ntitle: T\ndue: 2026-12-01\n---\nBody\n',
    );
  });

  it('reads the title after a byte order mark in list', () => {
    put('a.md', '﻿---\ntitle: T\n---\n');
    const [entry] = run('list').json.todos as { title: string }[];
    expect(entry?.title).toBe('T');
  });
});

describe('BCR-12: the rules files are refused (decision 10)', () => {
  it.each(['edit', 'due', 'assignee', 'delete', 'tick'])('%s refuses them in any letter case', (command) => {
    for (const file of ['AGENTS.md', 'agents.md', 'Claude.md', 'readme.MD', 'ReadMe.md']) {
      put(file, SAMPLE);
      expect(run(command, { file, title: 'X', due: '2026-12-01', assignee: 'sam-example' })).toEqual({
        code: 2,
        json: { error: 'invalid todo file', status: 400 },
      });
      expect(read(file)).toBe(SAMPLE);
    }
  });
});

describe('BCR-13: the caller names the source (decision 11)', () => {
  it('writes source: added from <via>', () => {
    const r = run('add', { title: 'From the app', via: 'TDS Brain App' });
    expect(read(r.json.file as string)).toContain('\nsource: added from TDS Brain App\n');
  });

  it('keeps via to one safe line', () => {
    const r = run('add', { title: 'x', via: 'Odd: tool\nassignee: someone' });
    const text = read(r.json.file as string);
    expect(text).toContain('\nsource: "added from Odd: tool assignee: someone"\n');
    expect(text.match(/^assignee:/gm)).toHaveLength(1);
  });
});

describe('BCR-14: a new name avoids finished and deleted to-dos (decision 12)', () => {
  it('skips names taken in todo/done/ and todo/deleted/', () => {
    mkdirSync(join(root, 'todo', 'done'));
    mkdirSync(join(root, 'todo', 'deleted'));
    writeFileSync(join(root, 'todo', 'done', `${stamp()}-same.md`), 'done');
    writeFileSync(join(root, 'todo', 'deleted', `${stamp()}-same-2.md`), 'deleted');
    expect(run('add', { title: 'Same' }).json.file).toBe(`${stamp()}-same-3.md`);
  });
});

describe('BCR-15: all-or-nothing writes (decision 13)', () => {
  const fail = (spec: string) => ({ env: { NODE_ENV: 'test', TDSAPP_TODO_TEST_FAIL: spec } });

  it('keeps the file mode and leaves no temporary file', () => {
    put('a.md', SAMPLE);
    chmodSync(todoPath('a.md'), 0o640);
    run('due', { file: 'a.md', due: '2026-12-01' });
    expect(statSync(todoPath('a.md')).mode & 0o777).toBe(0o640);
    expect(temps()).toEqual([]);
  });

  it('refuses a symbolic link with 500 and leaves it and its target alone', () => {
    const outside = join(root, 'outside.md');
    writeFileSync(outside, SAMPLE);
    symlinkSync(outside, todoPath('link.md'));
    for (const [command, extra] of [
      ['edit', { title: 'X' }],
      ['due', { due: '2026-12-01' }],
      ['assignee', { assignee: 'ben-mcadam' }],
      ['delete', {}],
      ['tick', {}],
    ] as const) {
      expect(run(command, { file: 'link.md', ...extra })).toEqual({
        code: 2,
        json: { error: 'todo is a symbolic link: link.md', status: 500 },
      });
    }
    expect(lstatSync(todoPath('link.md')).isSymbolicLink()).toBe(true);
    expect(readFileSync(outside, 'utf8')).toBe(SAMPLE);
  });

  it('refuses a file without write permission with 500', () => {
    put('a.md', SAMPLE);
    chmodSync(todoPath('a.md'), 0o444);
    expect(run('due', { file: 'a.md', due: '2026-12-01' })).toEqual({
      code: 2,
      json: { error: 'todo is not writable: a.md', status: 500 },
    });
    expect(read('a.md')).toBe(SAMPLE);
  });

  it('still ticks and deletes a read-only to-do, as before (they move it, not rewrite it)', () => {
    put('a.md', SAMPLE);
    put('b.md', SAMPLE);
    chmodSync(todoPath('a.md'), 0o444);
    chmodSync(todoPath('b.md'), 0o444);
    expect(run('tick', { file: 'a.md' }).code).toBe(0);
    expect(run('delete', { file: 'b.md' }).code).toBe(0);
    expect(readdirSync(join(root, 'todo')).filter((f) => f.endsWith('.md'))).toEqual([]);
  });

  it('leaves the original and no temporary file when the rename fails', () => {
    put('a.md', SAMPLE);
    const r = run('edit', { file: 'a.md', title: 'New title' }, fail('rename:EIO'));
    expect(r.code).toBe(2);
    expect(r.json.status).toBe(500);
    expect(read('a.md')).toBe(SAMPLE);
    expect(temps()).toEqual([]);
  });

  it('falls back to an exclusive write when hard links are not supported', () => {
    put('a.md', SAMPLE);
    const added = run('add', { title: 'Linkless' }, fail('link:EPERM'));
    expect(added.code).toBe(0);
    expect(read(added.json.file as string)).toContain('title: Linkless');
    expect(run('tick', { file: 'a.md' }, fail('link:ENOTSUP')).code).toBe(0);
    expect(readFileSync(join(root, 'todo', 'done', 'a.md'), 'utf8')).toContain('status: done');
    expect(temps()).toEqual([]);
    expect(temps(join(root, 'todo', 'done'))).toEqual([]);
  });

  it('takes the next name when another writer took this one first', () => {
    expect(run('add', { title: 'Race' }, fail('link:EEXIST:1')).json.file).toBe(`${stamp()}-race-2.md`);
    expect(temps()).toEqual([]);
  });

  it('removes its own temporary files older than 10 minutes, and nothing else', () => {
    put('a.md', SAMPLE);
    const old = join(root, 'todo', '.tdsapp-todo-123-abcdef.tmp~');
    const fresh = join(root, 'todo', '.tdsapp-todo-456-abcdef.tmp~');
    const other = join(root, 'todo', '.other-123.tmp~');
    for (const f of [old, fresh, other]) writeFileSync(f, 'x');
    const longAgo = new Date(Date.now() - 11 * 60_000);
    utimesSync(old, longAgo, longAgo);
    utimesSync(other, longAgo, longAgo);
    run('due', { file: 'a.md', due: '2026-12-01' });
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it('ignores the test hook outside tests', () => {
    put('a.md', SAMPLE);
    const r = run(
      'due',
      { file: 'a.md', due: '2026-12-01' },
      { env: { TDSAPP_TODO_TEST_FAIL: 'rename:EIO' } },
    );
    expect(r.code).toBe(0);
  });
});

describe('BCR-17: real dates only (decision 14)', () => {
  it.each(['2026-02-31', '2026-13-01', '2026-00-10', '2026-04-31', '2027-02-29'])(
    'refuses %s on add and due',
    (date) => {
      put('a.md', SAMPLE);
      const refused = { code: 2, json: { error: 'due must be a real date', status: 400 } };
      expect(run('add', { title: 'x', due: date })).toEqual(refused);
      expect(run('due', { file: 'a.md', due: date })).toEqual(refused);
      expect(read('a.md')).toBe(SAMPLE);
    },
  );

  it('accepts a leap day', () => {
    expect(run('add', { title: 'x', due: '2028-02-29' }).code).toBe(0);
  });
});

// ---- compatibility --------------------------------------------------------------------------

interface View {
  title: string;
  due: string | null;
  assignee: string | null;
}

const h1Of = (body: string) => body.match(/^#\s+(.+?)\s*$/m)?.[1];
const base = (file: string) => file.replace(/^.*\//, '').replace(/\.md$/, '');

// What the Workbench shows (lib/todo-parser.cjs + getMiscTodos' title rule).
function workbenchView(text: string, file: string): View {
  const { frontmatter: fm, body } = workbench.parseFrontmatter(text);
  return { title: fm.title || h1Of(body) || base(file), due: fm.due || null, assignee: fm.assignee || null };
}
// What Ian's Reminders sync shows.
function remindersView(text: string, file: string): View {
  const { fm } = reminders.parse(text);
  return { title: reminders.titleOf(text, file), due: fm.due || null, assignee: fm.assignee || null };
}
// What the app shows (server/brain/frontmatter.ts).
function appView(text: string, file: string): View {
  const { data, body } = appParse(text);
  const s = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  return { title: s(data.title) ?? h1Of(body) ?? base(file), due: s(data.due), assignee: s(data.assignee) };
}

// Every reader sees what the script meant. The Workbench and the Reminders sync never handled a
// byte order mark (they read no frontmatter after one, before and after v0.3), so for those files
// they are given the text after it, which shows the file itself is laid out right.
function expectReadersAgree(path: string, intended: View) {
  const text = readFileSync(path, 'utf8');
  const noBom = text.replace(/^﻿/, '');
  expect(appView(text, path)).toEqual(intended);
  expect(workbenchView(noBom, path)).toEqual(intended);
  expect(remindersView(noBom, path)).toEqual({ ...intended, title: reminders.cleanTitle(intended.title) });
}

describe('compatibility: files the script writes read the same everywhere', () => {
  const titles = [
    'Plain title',
    'ON HOLD: Work up quote',
    'Fix #12 then ship',
    'Say "hi": now',
    `It's: "x"`,
    `"Quoted" and it's`,
    `'Single' start`,
    'true',
    '2026-12-01',
    'Back\\slash: x',
  ];

  it.each(titles)('add %j', (title) => {
    const r = run('add', { title, due: '2026-12-01', assignee: 'ben-mcadam', via: 'TDS Brain App' });
    expectReadersAgree(todoPath(r.json.file as string), { title, due: '2026-12-01', assignee: 'ben-mcadam' });
  });

  it.each(titles)('edit to %j, with and without a body, LF, CRLF and BOM', (title) => {
    for (const [file, text] of [
      ['lf.md', SAMPLE],
      ['crlf.md', SAMPLE.replace(/\n/g, '\r\n')],
      ['bom.md', `﻿${SAMPLE}`],
      ['bomcrlf.md', `﻿${SAMPLE.replace(/\n/g, '\r\n')}`],
      ['plain.md', '# Old title\n\nText\n'],
    ] as const) {
      put(file, text);
      expect(run('edit', { file, title }).code).toBe(0);
      const assignee = file === 'plain.md' ? null : 'sam-example';
      expectReadersAgree(todoPath(file), { title, due: null, assignee });
      expect(run('edit', { file, title: 'Second', body: '# Second\n\nNew details.' }).code).toBe(0);
      expectReadersAgree(todoPath(file), { title: 'Second', due: null, assignee });
    }
  });

  it('due, assignee, tick and delete, LF, CRLF and BOM', () => {
    for (const [file, text] of [
      ['lf.md', SAMPLE],
      ['crlf.md', SAMPLE.replace(/\n/g, '\r\n')],
      ['bom.md', `﻿${SAMPLE}`],
      ['quoted.md', SAMPLE.replace('title: Old title', 'title: "ON HOLD: Old title"')],
    ] as const) {
      put(file, text);
      const title = file === 'quoted.md' ? 'ON HOLD: Old title' : 'Old title';
      run('due', { file, due: '2026-12-01' });
      expectReadersAgree(todoPath(file), { title, due: '2026-12-01', assignee: 'sam-example' });
      run('assignee', { file, assignee: 'ben-mcadam' });
      expectReadersAgree(todoPath(file), { title, due: '2026-12-01', assignee: 'ben-mcadam' });
      run('assignee', { file, assignee: null });
      expectReadersAgree(todoPath(file), { title, due: '2026-12-01', assignee: null });
      run('due', { file, due: null });
      expectReadersAgree(todoPath(file), { title, due: null, assignee: null });
      const copy = `${file.replace('.md', '')}-2.md`;
      put(copy, text);
      const ticked = run('tick', { file, by: 'ben-mcadam', by_name: 'Ben McAdam', via: 'TDS Brain App' });
      expectReadersAgree(join(root, ticked.json.moved as string), { title, due: null, assignee: null });
      const deleted = run('delete', { file: copy });
      expectReadersAgree(join(root, deleted.json.moved as string), {
        title,
        due: null,
        assignee: 'sam-example',
      });
    }
  });

  it('due and assignee on a file without frontmatter', () => {
    put('a.md', '# Heading\r\n\r\nText\r\n');
    run('due', { file: 'a.md', due: '2026-12-01' });
    run('assignee', { file: 'a.md', assignee: 'ben-mcadam' });
    expectReadersAgree(todoPath('a.md'), { title: 'Heading', due: '2026-12-01', assignee: 'ben-mcadam' });
  });

  it('the title history is never taken for the title', () => {
    put('a.md', '---\ndue: 2026-12-01\n---\n');
    run('edit', { file: 'a.md', title: 'First' });
    run('edit', { file: 'a.md', title: 'Second' });
    expect(read('a.md')).toContain('## Title history');
    expectReadersAgree(todoPath('a.md'), { title: 'Second', due: '2026-12-01', assignee: null });
  });
});

describe('compatibility: older callers and older files', () => {
  it("a request with only the Workbench's fields works, giving the Workbench's bodies", () => {
    const added = run('add', { title: 'Old caller', due: '2026-12-01', assignee: 'ben-mcadam' });
    expect(added).toEqual({ code: 0, json: { ok: true, file: `${stamp()}-old-caller.md` } });
    const file = added.json.file as string;
    expect(run('edit', { file, title: 'Old caller', body: 'Details' })).toEqual({
      code: 0,
      json: { ok: true, file, title: 'Old caller', body: 'Details' },
    });
    expect(run('edit', { file, title: 'Old caller' })).toEqual({
      code: 0,
      json: { ok: true, file, title: 'Old caller' },
    });
    expect(run('due', { file, due: '' })).toEqual({ code: 0, json: { ok: true, file, due: null } });
    expect(run('assignee', { file, assignee: '' })).toEqual({
      code: 0,
      json: { ok: true, file, assignee: null },
    });
    expect(run('tick', { file })).toEqual({
      code: 0,
      json: { ok: true, file, moved: join('todo', 'done', file) },
    });
  });

  it('a Workbench-written file round-trips', () => {
    const text = `---\nassignee: sam-example\ntitle: Workbench one\ncreated: 2026-11-01\ndue: 2026-11-20\nsource: added from the Workbench\n---\n`;
    put('20261101-workbench-one.md', text);
    run('due', { file: '20261101-workbench-one.md', due: '2026-11-21' });
    run('due', { file: '20261101-workbench-one.md', due: '2026-11-20' });
    run('edit', { file: '20261101-workbench-one.md', title: 'Workbench one' });
    expect(read('20261101-workbench-one.md')).toBe(text);
  });
});

describe('the todo shim (decision 1)', () => {
  it('runs the new script and finds the brain from where it is installed', () => {
    const skills = join(root, '.claude', 'skills');
    mkdirSync(join(skills, 'tdsapp-todo', 'scripts'), { recursive: true });
    mkdirSync(join(skills, 'todo', 'scripts'), { recursive: true });
    copyFileSync(SCRIPT, join(skills, 'tdsapp-todo', 'scripts', 'tdsapp-todo.cjs'));
    copyFileSync(SHIM, join(skills, 'todo', 'scripts', 'todo.cjs'));
    // BRAIN_ROOT unset: the script finds the brain four folders up from where it is installed.
    const r = run(
      'add',
      { title: 'Through the shim', via: 'Old app' },
      { script: join(skills, 'todo', 'scripts', 'todo.cjs'), env: { BRAIN_ROOT: '' } },
    );
    expect(r.code).toBe(0);
    expect(read(r.json.file as string)).toContain('\nsource: added from Old app\n');
  });
});

describe('the skill files', () => {
  const skill = (rel: string) =>
    appParse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')).data;

  it('tdsapp-todo is v0.6, open to the whole team, and keeps its USE WHEN triggers', () => {
    expect(skill('../SKILL.md')).toMatchObject({
      name: 'tdsapp-todo',
      version: '0.6',
      roles: 'owner, scout, team',
      maturity: 'draft',
      members: 'false',
      agency: 'true',
    });
    expect(skill('../SKILL.md').description).toContain('USE WHEN');
  });

  it('the todo shim keeps its roles but sends Claude to tdsapp-todo', () => {
    const shim = skill('../../todo/SKILL.md');
    expect(shim).toMatchObject({ name: 'todo', version: '0.3', roles: 'owner, scout', maturity: 'draft' });
    expect(shim.description).toMatch(/^Deprecated: use tdsapp-todo\./);
    expect(shim.description).not.toContain('USE WHEN');
  });
});

// ---- v0.4 (docs/plans/2026-11-13-todo-handover-search-scope.md, decision 2) ----------------------

describe('v0.4: capabilities', () => {
  it('offers handover and scope in a brain that is not a git repository', () => {
    expect(run('capabilities')).toEqual({
      code: 0,
      json: { version: '0.6', features: ['handover', 'attach', 'todo-project-v1', 'scope'] },
    });
  });

  it('offers scope in a git brain only when git ignores personal/todo/', () => {
    gitInit(false);
    expect(run('capabilities').json).toEqual({
      version: '0.6',
      features: ['handover', 'attach', 'todo-project-v1'],
    });
    writeFileSync(join(root, '.gitignore'), 'personal/\n');
    expect(run('capabilities').json).toEqual({
      version: '0.6',
      features: ['handover', 'attach', 'todo-project-v1', 'scope'],
    });
  });

  it('does not offer scope when personal/todo is a symbolic link', () => {
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(elsewhere);
    mkdirSync(join(root, 'personal'));
    symlinkSync(elsewhere, join(root, 'personal', 'todo'));
    expect(run('capabilities').json).toEqual({
      version: '0.6',
      features: ['handover', 'attach', 'todo-project-v1'],
    });
  });
});

describe('v0.4: scope', () => {
  const commands: [string, Record<string, unknown>][] = [
    ['edit', { title: 'X' }],
    ['due', { due: '2026-12-01' }],
    ['assignee', { assignee: 'ben-mcadam' }],
    ['delete', {}],
    ['tick', {}],
    ['move', { to: 'personal' }],
  ];

  it.each(commands)('%s refuses a scope other than "tds" or "personal" with 400', (command, extra) => {
    put('a.md', SAMPLE);
    for (const scope of ['Personal', 'work', 5, true, '']) {
      expect(run(command, { file: 'a.md', scope, ...extra })).toEqual({
        code: 2,
        json: { error: 'scope must be "tds" or "personal"', status: 400 },
      });
    }
    expect(read('a.md')).toBe(SAMPLE);
  });

  it('treats scope "tds" as todo/, the same as no scope', () => {
    put('a.md', SAMPLE);
    expect(run('due', { file: 'a.md', due: '2026-12-01', scope: 'tds' })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', due: '2026-12-01' },
    });
    expect(read('a.md')).toContain('\ndue: 2026-12-01\n');
  });

  it('edits and re-dates a personal to-do in personal/todo/, leaving a TDS one of the same name alone', () => {
    put('a.md', SAMPLE);
    putPersonal('a.md', SAMPLE);
    expect(run('edit', { file: 'a.md', title: 'New title', scope: 'personal' })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', title: 'New title' },
    });
    expect(run('due', { file: 'a.md', due: '2026-12-01', scope: 'personal' }).code).toBe(0);
    expect(readPersonal('a.md')).toBe(
      `${SAMPLE.replace('title: Old title', 'title: New title')
        .replace('# Old title', '# New title')
        .replace('created: 2026-11-01\n', 'created: 2026-11-01\ndue: 2026-12-01\n')}${history('Old title')}`,
    );
    expect(read('a.md')).toBe(SAMPLE);
    expect(temps(join(root, 'personal', 'todo'))).toEqual([]);
  });

  it('ticks and deletes a personal to-do into personal/todo/done/ and personal/todo/deleted/', () => {
    putPersonal('a.md', SAMPLE);
    putPersonal('b.md', SAMPLE);
    expect(run('tick', { file: 'a.md', scope: 'personal' })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', moved: join('personal', 'todo', 'done', 'a.md') },
    });
    expect(run('delete', { file: 'b.md', scope: 'personal' })).toEqual({
      code: 0,
      json: { ok: true, file: 'b.md', moved: join('personal', 'todo', 'deleted', 'b.md') },
    });
    expect(readFileSync(join(root, 'personal', 'todo', 'done', 'a.md'), 'utf8')).toContain(
      '\nstatus: done\n',
    );
    expect(readFileSync(join(root, 'personal', 'todo', 'deleted', 'b.md'), 'utf8')).toContain(
      '\nstatus: deleted\n',
    );
    expect(readdirSync(join(root, 'personal', 'todo')).sort()).toEqual(['deleted', 'done']);
    expect(existsSync(join(root, 'todo', 'done'))).toBe(false);
  });

  it('checks expect on a personal to-do', () => {
    putPersonal('a.md', SAMPLE);
    expect(run('due', { file: 'a.md', due: '2026-12-01', scope: 'personal', expect: sha('other') })).toEqual({
      code: 2,
      json: { error: 'changed since read', status: 409 },
    });
    expect(readPersonal('a.md')).toBe(SAMPLE);
  });

  it('gives 404 for a personal to-do that is only in todo/', () => {
    put('a.md', SAMPLE);
    expect(run('due', { file: 'a.md', due: '2026-12-01', scope: 'personal' })).toEqual({
      code: 2,
      json: { error: 'todo not found: a.md', status: 404 },
    });
  });

  it('refuses every personal request when git does not ignore personal/todo/, writing nothing', () => {
    gitInit(false);
    put('a.md', SAMPLE);
    putPersonal('p.md', SAMPLE);
    const requests: [string, Record<string, unknown>][] = [
      ['add', { title: 'Private', scope: 'personal' }],
      ['edit', { file: 'p.md', title: 'X', scope: 'personal' }],
      ['due', { file: 'p.md', due: '2026-12-01', scope: 'personal' }],
      ['tick', { file: 'p.md', scope: 'personal' }],
      ['delete', { file: 'p.md', scope: 'personal' }],
      ['move', { file: 'p.md', scope: 'personal', to: 'tds' }],
      ['move', { file: 'a.md', to: 'personal' }],
    ];
    for (const [command, input] of requests) {
      const r = run(command, input);
      expect(r.code).toBe(2);
      expect(r.json.status).toBe(400);
      expect(r.json.error).toMatch(/^personal to-dos aren't available/);
    }
    expect(readPersonal('p.md')).toBe(SAMPLE);
    expect(read('a.md')).toBe(SAMPLE);
    expect(readdirSync(join(root, 'personal', 'todo'))).toEqual(['p.md']);
    expect(readdirSync(join(root, 'todo'))).toEqual(['a.md']);
  });

  it('works in a git brain that ignores personal/', () => {
    gitInit(true);
    putPersonal('p.md', SAMPLE);
    expect(run('due', { file: 'p.md', due: '2026-12-01', scope: 'personal' }).code).toBe(0);
  });

  it('refuses a symbolically linked personal/todo, leaving what it points at alone', () => {
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, 'p.md'), SAMPLE);
    mkdirSync(join(root, 'personal'));
    symlinkSync(elsewhere, join(root, 'personal', 'todo'));
    for (const [command, input] of [
      ['due', { file: 'p.md', due: '2026-12-01', scope: 'personal' }],
      ['add', { title: 'Private', scope: 'personal' }],
    ] as const) {
      const r = run(command, input);
      expect(r.json.status).toBe(400);
    }
    expect(readdirSync(elsewhere)).toEqual(['p.md']);
    expect(readFileSync(join(elsewhere, 'p.md'), 'utf8')).toBe(SAMPLE);
  });

  it('refuses to pass on a personal to-do', () => {
    putPersonal('a.md', SAMPLE);
    expect(run('assignee', { file: 'a.md', assignee: 'ben-mcadam', scope: 'personal' })).toEqual({
      code: 2,
      json: { error: "a personal to-do can't be passed on: move it to TDS first", status: 400 },
    });
    expect(readPersonal('a.md')).toBe(SAMPLE);
  });
});

describe('v0.4: add', () => {
  it('writes created_by from by, else the git user, and nothing when neither is known', () => {
    const byCaller = run('add', { title: 'From the app', assignee: 'ben-mcadam', by: 'Ben McAdam' });
    expect(read(byCaller.json.file as string)).toBe(
      `---\nassignee: ben-mcadam\ntitle: From the app\ncreated: ${today()}\ncreated_by: ben-mcadam\nsource: added with the todo skill\n---\n`,
    );
    const byGit = run('add', { title: 'From git' });
    expect(fmValue(read(byGit.json.file as string), 'created_by')).toBe('sam-example');
    const unknown = run('add', { title: 'Nobody', assignee: 'ben-mcadam' }, { userName: null });
    expect(read(unknown.json.file as string)).not.toMatch(/^(?:created_by|assigned_\w+):/m);
  });

  it('stamps the handover when the to-do is for someone other than the adder', () => {
    const r = run('add', {
      title: 'For Ben',
      assignee: 'ben-mcadam',
      by: 'sam-example',
      by_name: 'Sam Example',
      via: 'TDS Brain App',
    });
    const text = read(r.json.file as string);
    const at = fmValue(text, 'assigned_at') as string;
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(text).toBe(
      `---\nassignee: ben-mcadam\ntitle: For Ben\ncreated: ${today()}\ncreated_by: sam-example\nsource: added from TDS Brain App\nassigned_to: ben-mcadam\nassigned_at: ${at}\nassigned_by: sam-example\nassigned_via: TDS Brain App\n---\n`,
    );
  });

  it('stamps no handover for your own to-do or an open one', () => {
    const own = run('add', { title: 'Mine', assignee: 'sam-example' });
    const open = run('add', { title: 'Anyone', open: true });
    expect(read(own.json.file as string)).not.toContain('assigned_');
    expect(read(open.json.file as string)).not.toContain('assigned_');
  });

  it('defaults the handover tool to "todo skill" and the adder to the git user', () => {
    const r = run('add', { title: 'For Ben', assignee: 'ben-mcadam' });
    const text = read(r.json.file as string);
    expect(fmValue(text, 'assigned_by')).toBe('sam-example');
    expect(fmValue(text, 'assigned_via')).toBe('todo skill');
    expect(text).not.toContain('assigned_from');
  });

  it('adds a personal to-do to personal/todo/, for the adder, making the folder', () => {
    const r = run('add', {
      title: 'Dentist',
      due: '2026-12-01',
      scope: 'personal',
      by: 'ben-mcadam',
      via: 'TDS Brain App',
    });
    const file = `${stamp()}-dentist.md`;
    expect(r).toEqual({ code: 0, json: { ok: true, file } });
    expect(readPersonal(file)).toBe(
      `---\nassignee: ben-mcadam\ntitle: Dentist\ncreated: ${today()}\ncreated_by: ben-mcadam\ndue: 2026-12-01\nsource: added from TDS Brain App\n---\n`,
    );
    expect(readdirSync(join(root, 'todo'))).toEqual([]);
    expect(temps(join(root, 'personal', 'todo'))).toEqual([]);
  });

  it('takes the git user as the adder of a personal to-do, and accepts their own slug as assignee', () => {
    const a = run('add', { title: 'One', scope: 'personal' });
    expect(fmValue(readPersonal(a.json.file as string), 'assignee')).toBe('sam-example');
    const b = run('add', { title: 'Two', scope: 'personal', assignee: 'Sam Example' });
    expect(b.code).toBe(0);
    expect(fmValue(readPersonal(b.json.file as string), 'assignee')).toBe('sam-example');
  });

  it('refuses a personal to-do that is open, for someone else, or has no known adder', () => {
    const cases: [Record<string, unknown>, string, string | null][] = [
      [{ open: true }, "a personal to-do can't be open to anyone", 'Sam Example'],
      [{ assignee: 'ben-mcadam' }, 'a personal to-do can only be for the person adding it', 'Sam Example'],
      [
        { assignee: 'ben-mcadam', by: 'sam-example' },
        'a personal to-do can only be for the person adding it',
        null,
      ],
      [{}, 'a personal to-do needs to know who is adding it: send by', null],
    ];
    for (const [extra, error, userName] of cases) {
      expect(run('add', { title: 'Private', scope: 'personal', ...extra }, { userName })).toEqual({
        code: 2,
        json: { error, status: 400 },
      });
    }
    expect(existsSync(join(root, 'personal'))).toBe(false);
  });

  it('refuses a scope other than "tds" or "personal"', () => {
    expect(run('add', { title: 'x', scope: 'home' })).toEqual({
      code: 2,
      json: { error: 'scope must be "tds" or "personal"', status: 400 },
    });
  });

  it('picks a name free in all six folders, for TDS and personal to-dos alike', () => {
    const taken = [
      ['todo'],
      ['todo', 'done'],
      ['todo', 'deleted'],
      ['personal', 'todo'],
      ['personal', 'todo', 'done'],
      ['personal', 'todo', 'deleted'],
    ];
    taken.forEach((parts, i) => {
      mkdirSync(join(root, ...parts), { recursive: true });
      writeFileSync(
        join(root, ...parts, i === 0 ? `${stamp()}-same.md` : `${stamp()}-same-${i + 1}.md`),
        'x',
      );
    });
    expect(run('add', { title: 'Same' }).json.file).toBe(`${stamp()}-same-7.md`);
    expect(run('add', { title: 'Same', scope: 'personal' }).json.file).toBe(`${stamp()}-same-8.md`);
  });
});

describe('v0.4: assignee records the handover', () => {
  it('stamps who passed it on, when and from where, and adds a line under ## Handover history', () => {
    put('a.md', SAMPLE);
    const r = run('assignee', {
      file: 'a.md',
      assignee: 'ben-mcadam',
      by: 'sam-example',
      by_name: 'Sam Example',
      via: 'TDS Brain App',
    });
    expect(r).toEqual({ code: 0, json: { ok: true, file: 'a.md', assignee: 'ben-mcadam' } });
    const text = read('a.md');
    const at = fmValue(text, 'assigned_at') as string;
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(text).toBe(
      `---\nassignee: ben-mcadam\ntitle: Old title\ncreated: 2026-11-01\nassigned_to: ben-mcadam\nassigned_at: ${at}\nassigned_by: sam-example\nassigned_from: sam-example\nassigned_via: TDS Brain App\n---\n\n# Old title\n\nSome details.\n\n## Handover history\n\n- ${ukWhen(at)}: Sam Example passed it from sam-example to ben-mcadam (TDS Brain App).\n`,
    );
  });

  it('replaces the earlier stamp and adds to the same history section', () => {
    put('a.md', SAMPLE);
    run('assignee', { file: 'a.md', assignee: 'ben-mcadam', by: 'sam-example', by_name: 'Sam Example' });
    run('assignee', { file: 'a.md', assignee: null, by: 'ben-mcadam', by_name: 'Ben McAdam' });
    const text = read('a.md');
    expect(text.match(/^assigned_\w+:/gm)).toEqual([
      'assigned_to:',
      'assigned_at:',
      'assigned_by:',
      'assigned_from:',
      'assigned_via:',
    ]);
    expect(fmValue(text, 'assigned_to')).toBe('open');
    expect(fmValue(text, 'assigned_from')).toBe('ben-mcadam');
    expect(fmValue(text, 'assigned_by')).toBe('ben-mcadam');
    expect(fmValue(text, 'assigned_via')).toBe('todo skill');
    expect(text.match(/## Handover history/g)).toHaveLength(1);
    expect(text).toMatch(
      /\n## Handover history\n\n- .+: Sam Example passed it from sam-example to ben-mcadam \(todo skill\)\.\n- .+: Ben McAdam made it open to anyone; it was with ben-mcadam \(todo skill\)\.\n$/,
    );
  });

  it('words picking up an open to-do, and passing one on from open', () => {
    put('a.md', '---\ntitle: T\n---\n');
    run('assignee', { file: 'a.md', assignee: 'sam-example' });
    expect(fmValue(read('a.md'), 'assigned_from')).toBe('open');
    expect(read('a.md')).toMatch(/: Sam Example picked it up from the open list \(todo skill\)\.\n$/);
    put('b.md', '---\ntitle: T\n---\n');
    run('assignee', { file: 'b.md', assignee: 'ben-mcadam' });
    expect(read('b.md')).toMatch(
      /: Sam Example passed it from the open list to ben-mcadam \(todo skill\)\.\n$/,
    );
  });

  it('writes nothing when the assignee is unchanged', () => {
    put('a.md', SAMPLE);
    put('b.md', '---\ntitle: T\n---\n');
    put('c.md', 'Plain\n');
    const before = statSync(todoPath('a.md')).mtimeMs;
    expect(run('assignee', { file: 'a.md', assignee: 'Sam Example' })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', assignee: 'sam-example' },
    });
    expect(run('assignee', { file: 'b.md', assignee: null }).json).toEqual({
      ok: true,
      file: 'b.md',
      assignee: null,
    });
    run('assignee', { file: 'c.md', assignee: '' });
    expect(read('a.md')).toBe(SAMPLE);
    expect(statSync(todoPath('a.md')).mtimeMs).toBe(before);
    expect(read('b.md')).toBe('---\ntitle: T\n---\n');
    expect(read('c.md')).toBe('Plain\n');
  });

  it('adds the history at the end of an existing section, before the next one', () => {
    put(
      'a.md',
      `${SAMPLE}\n## Handover history\n\n- 1 Nov 2026, 09:00 UK: older line.\n\n## Notes\n\nKeep.\n`,
    );
    run('assignee', { file: 'a.md', assignee: 'ben-mcadam' });
    expect(read('a.md')).toMatch(
      /\n## Handover history\n\n- 1 Nov 2026, 09:00 UK: older line\.\n- .+ \(todo skill\)\.\n\n## Notes\n\nKeep\.\n$/,
    );
  });

  it('stamps a file without frontmatter, keeping CRLF and a byte order mark', () => {
    put('a.md', '﻿# Heading\r\n\r\nText\r\n');
    run('assignee', { file: 'a.md', assignee: 'ben-mcadam' });
    const text = read('a.md');
    expect(text.startsWith('﻿---\r\nassignee: ben-mcadam\r\nassigned_to: ben-mcadam\r\n')).toBe(true);
    expect(text).not.toMatch(/[^\r]\n/);
    expect(text).toMatch(/\r\n\r\n## Handover history\r\n\r\n- .+\(todo skill\)\.\r\n$/);
    expectReadersAgree(todoPath('a.md'), { title: 'Heading', due: null, assignee: 'ben-mcadam' });
  });

  it('writes the tool name as one safe line', () => {
    put('a.md', SAMPLE);
    run('assignee', { file: 'a.md', assignee: 'ben-mcadam', via: 'Odd: tool\nassignee: x' });
    const text = read('a.md');
    expect(fmValue(text, 'assigned_via')).toBe('"Odd: tool assignee: x"');
    expect(text.match(/^assignee:/gm)).toHaveLength(1);
  });
});

describe('v0.4: move', () => {
  it('moves your own to-do to personal/todo/ byte for byte, so its version is unchanged', () => {
    const bytes = `﻿${SAMPLE.replace(/\n/g, '\r\n')}`;
    put('a.md', bytes);
    const version = versionOf('a.md');
    expect(run('move', { file: 'a.md', to: 'personal', expect: version, by: 'sam-example' })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', moved: join('personal', 'todo', 'a.md') },
    });
    expect(existsSync(todoPath('a.md'))).toBe(false);
    expect(sha(readFileSync(personalPath('a.md')))).toBe(version);
    expect(temps(join(root, 'personal', 'todo'))).toEqual([]);
  });

  it('moves a personal to-do back to todo/', () => {
    putPersonal('a.md', SAMPLE);
    expect(run('move', { file: 'a.md', scope: 'personal', to: 'tds' })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', moved: join('todo', 'a.md') },
    });
    expect(read('a.md')).toBe(SAMPLE);
    expect(existsSync(personalPath('a.md'))).toBe(false);
  });

  it('adds -2, -3 when the name is taken where it goes', () => {
    putPersonal('a.md', 'taken');
    putPersonal('a-2.md', 'taken too');
    put('a.md', SAMPLE);
    expect(run('move', { file: 'a.md', to: 'personal' }).json).toEqual({
      ok: true,
      file: 'a-3.md',
      moved: join('personal', 'todo', 'a-3.md'),
    });
    expect(readPersonal('a-3.md')).toBe(SAMPLE);
    expect(readPersonal('a.md')).toBe('taken');
  });

  it("refuses someone else's to-do and an open one, both ways", () => {
    put('ben.md', SAMPLE.replace('sam-example', 'ben-mcadam'));
    put('open.md', SAMPLE.replace('assignee: sam-example\n', ''));
    putPersonal('ben.md', SAMPLE.replace('sam-example', 'ben-mcadam'));
    const toPersonal = { code: 2, json: { error: 'only your own to-dos can be made personal', status: 400 } };
    const toTds = {
      code: 2,
      json: { error: 'only your own personal to-dos can be moved to TDS', status: 400 },
    };
    expect(run('move', { file: 'ben.md', to: 'personal' })).toEqual(toPersonal);
    expect(run('move', { file: 'open.md', to: 'personal' })).toEqual(toPersonal);
    expect(run('move', { file: 'a.md', to: 'personal' }).json.status).toBe(404);
    put('mine.md', SAMPLE);
    expect(run('move', { file: 'mine.md', to: 'personal', by: 'ben-mcadam' })).toEqual(toPersonal);
    expect(run('move', { file: 'mine.md', to: 'personal' }, { userName: null })).toEqual(toPersonal);
    expect(run('move', { file: 'ben.md', scope: 'personal', to: 'tds' })).toEqual(toTds);
    expect(existsSync(personalPath('mine.md'))).toBe(false);
    expect(readdirSync(join(root, 'personal', 'todo'))).toEqual(['ben.md']);
  });

  it('refuses a missing or unknown to, and to the same place', () => {
    put('a.md', SAMPLE);
    for (const to of [undefined, 'home', 5]) {
      expect(run('move', { file: 'a.md', to })).toEqual({
        code: 2,
        json: { error: 'to must be "tds" or "personal"', status: 400 },
      });
    }
    expect(run('move', { file: 'a.md', to: 'tds' })).toEqual({
      code: 2,
      json: { error: 'to must differ from scope', status: 400 },
    });
    expect(run('move', { file: '../a.md', to: 'personal' }).json).toEqual({
      error: 'invalid todo file',
      status: 400,
    });
    expect(read('a.md')).toBe(SAMPLE);
  });

  it('refuses with 409 when the file changed since it was read', () => {
    put('a.md', SAMPLE);
    expect(run('move', { file: 'a.md', to: 'personal', expect: sha('older') })).toEqual({
      code: 2,
      json: { error: 'changed since read', status: 409 },
    });
    expect(read('a.md')).toBe(SAMPLE);
    expect(existsSync(personalPath('a.md'))).toBe(false);
  });

  it('refuses a symbolic link', () => {
    writeFileSync(join(root, 'outside.md'), SAMPLE);
    symlinkSync(join(root, 'outside.md'), todoPath('link.md'));
    expect(run('move', { file: 'link.md', to: 'personal' })).toEqual({
      code: 2,
      json: { error: 'todo is a symbolic link: link.md', status: 500 },
    });
    expect(existsSync(personalPath('link.md'))).toBe(false);
  });

  it('leaves the to-do where it was, and no copy, when the original cannot be removed', () => {
    put('a.md', SAMPLE);
    mkdirSync(join(root, 'personal', 'todo'), { recursive: true });
    chmodSync(join(root, 'todo'), 0o555);
    try {
      const r = run('move', { file: 'a.md', to: 'personal' });
      expect(r.code).toBe(2);
      expect(r.json.status).toBe(500);
    } finally {
      chmodSync(join(root, 'todo'), 0o755);
    }
    expect(read('a.md')).toBe(SAMPLE);
    expect(readdirSync(join(root, 'personal', 'todo'))).toEqual([]);
  });
});

describe('v0.4: personal to-dos never land where git syncs them (review fix)', () => {
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: root, env: gitEnv('Sam Example'), encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  };
  const noScope = () =>
    expect(run('capabilities').json).toEqual({
      version: '0.6',
      features: ['handover', 'attach', 'todo-project-v1'],
    });
  const refused = (r: RunResult) => {
    expect(r.code).toBe(2);
    expect(r.json.status).toBe(400);
    expect(r.json.error).toMatch(/^personal to-dos aren't available/);
  };

  it.each([
    ['done', 'tick'],
    ['deleted', 'delete'],
  ])('refuses a personal/todo/%s that links into todo/, in a git brain and outside one', (sub, command) => {
    for (const inGit of [false, true]) {
      rmSync(join(root, 'personal'), { recursive: true, force: true });
      if (inGit && !existsSync(join(root, '.git'))) gitInit(true);
      putPersonal('p.md', SAMPLE);
      mkdirSync(join(root, 'todo', sub), { recursive: true });
      symlinkSync(join('..', '..', 'todo', sub), join(root, 'personal', 'todo', sub));
      noScope();
      refused(run(command, { file: 'p.md', scope: 'personal' }));
      expect(readdirSync(join(root, 'todo', sub))).toEqual([]);
      expect(readPersonal('p.md')).toBe(SAMPLE);
    }
  });

  it('refuses when personal itself is a symbolic link', () => {
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(join(elsewhere, 'todo'), { recursive: true });
    symlinkSync(elsewhere, join(root, 'personal'));
    noScope();
    refused(run('add', { title: 'Private', scope: 'personal' }));
    expect(readdirSync(join(elsewhere, 'todo'))).toEqual([]);
  });

  it('refuses when anything in personal/todo is tracked by git', () => {
    gitInit(true);
    putPersonal('tracked.md', SAMPLE);
    putPersonal('p.md', SAMPLE);
    git('add', '-f', 'personal/todo/tracked.md');
    noScope();
    refused(run('due', { file: 'p.md', due: '2026-12-01', scope: 'personal' }));
    refused(run('add', { title: 'Private', scope: 'personal' }));
    expect(readPersonal('p.md')).toBe(SAMPLE);
  });

  it('refuses when git ignores personal/todo/*.md but not its done/ and deleted/ folders', () => {
    gitInit(false);
    writeFileSync(join(root, '.gitignore'), 'personal/todo/*.md\n');
    putPersonal('p.md', SAMPLE);
    noScope();
    refused(run('tick', { file: 'p.md', scope: 'personal' }));
    expect(existsSync(join(root, 'personal', 'todo', 'done'))).toBe(false);
  });

  it('checks the real file names, not only the folder', () => {
    gitInit(false);
    writeFileSync(
      join(root, '.gitignore'),
      'personal/*\n!personal/todo/\npersonal/todo/*\n!personal/todo/*share*.md\n',
    );
    expect(run('capabilities').json).toEqual({
      version: '0.6',
      features: ['handover', 'attach', 'todo-project-v1', 'scope'],
    });
    putPersonal('share-a.md', SAMPLE);
    put('share-b.md', SAMPLE);
    refused(run('due', { file: 'share-a.md', due: '2026-12-01', scope: 'personal' }));
    refused(run('move', { file: 'share-b.md', to: 'personal' }));
    refused(run('add', { title: 'Share it', scope: 'personal' }));
    expect(readPersonal('share-a.md')).toBe(SAMPLE);
    expect(read('share-b.md')).toBe(SAMPLE);
    expect(readdirSync(join(root, 'personal', 'todo'))).toEqual(['share-a.md']);
    // A name the rules do ignore still works.
    putPersonal('p.md', SAMPLE);
    expect(run('due', { file: 'p.md', due: '2026-12-01', scope: 'personal' }).code).toBe(0);
  });

  it("ignores the caller's GIT_* variables when checking", () => {
    const other = join(root, 'other-repo');
    mkdirSync(other);
    const r = spawnSync('git', ['init', '-q'], { cwd: other, env: gitEnv('Sam Example') });
    expect(r.status).toBe(0);
    // Pointed at another repository, git would say personal/todo/ isn't ignored; the brain is no repo.
    const env = { GIT_DIR: join(other, '.git'), GIT_WORK_TREE: root };
    expect(run('capabilities', {}, { env }).json).toEqual({
      version: '0.6',
      features: ['handover', 'attach', 'todo-project-v1', 'scope'],
    });
  });

  it('move keeps the file mode', () => {
    put('a.md', SAMPLE);
    chmodSync(todoPath('a.md'), 0o640);
    expect(run('move', { file: 'a.md', to: 'personal' }).code).toBe(0);
    expect(statSync(personalPath('a.md')).mode & 0o777).toBe(0o640);
    chmodSync(personalPath('a.md'), 0o600);
    expect(run('move', { file: 'a.md', scope: 'personal', to: 'tds' }).code).toBe(0);
    expect(statSync(todoPath('a.md')).mode & 0o777).toBe(0o600);
  });
});

// v0.3 calls give byte-identical results: the v0.3 script (as released in v0.9.0) and this one are
// run side by side on the same brain contents, and every reply and file must match, apart from the
// clock (stamp times and list mtimes).
describe('v0.4: v0.3 calls give the same results as v0.3', () => {
  const V03_COMMIT = '1c16fc0';
  const repo = fileURLToPath(new URL('../../..', import.meta.url));
  const shown = spawnSync('git', ['show', `${V03_COMMIT}:brain-skills/tdsapp-todo/scripts/tdsapp-todo.cjs`], {
    cwd: repo,
    encoding: 'utf8',
  });
  const v03 = shown.status === 0 ? shown.stdout : null;

  // Every file under a brain, path → text, with clock values set aside.
  function snapshot(dir: string, prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
      const rel = join(prefix, entry.name);
      if (entry.isDirectory()) Object.assign(out, snapshot(dir, rel));
      else out[rel] = calm(readFileSync(join(dir, rel), 'utf8'));
    }
    return out;
  }
  const calm = (text: string) =>
    text
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+Z|[+-]\d{2}:\d{2})/g, '<at>')
      .replace(/ at \d{2}:\d{2} UK time/g, ' at <time> UK time');

  it.skipIf(v03 === null)('edit, due, tick, delete, roster and list', () => {
    const brains = ['old', 'new'].map((name) => {
      const brain = join(root, name);
      mkdirSync(join(brain, 'todo'), { recursive: true });
      mkdirSync(join(brain, '.team-config'));
      writeFileSync(join(brain, '.team-config', 'roles.json'), JSON.stringify(ROLES));
      const files: [string, string][] = [
        ['lf.md', SAMPLE],
        ['crlf.md', SAMPLE.replace(/\n/g, '\r\n')],
        ['bom.md', `﻿${SAMPLE}`],
        ['plain.md', '# Heading\n\nText\n'],
        ['quoted.md', SAMPLE.replace('title: Old title', 'title: "ON HOLD: Old title"')],
        ['tick-me.md', SAMPLE],
        ['delete-me.md', '﻿---\r\ntitle: T\r\n---\r\nBody\r\n'],
        ['open.md', '---\ntitle: Open\ncreated: 2026-11-03\ndue: 2026-12-01\n---\n'],
      ];
      for (const [file, text] of files) writeFileSync(join(brain, 'todo', file), text);
      return brain;
    });
    const scripts = [join(root, 'v03.cjs'), SCRIPT];
    writeFileSync(scripts[0] as string, v03 as string);
    const calls: [string, Record<string, unknown>][] = [
      ['edit', { file: 'lf.md', title: 'New title' }],
      ['edit', { file: 'crlf.md', title: 'Say "hi": now', body: 'One\r\nTwo' }],
      ['edit', { file: 'plain.md', title: 'T' }],
      ['edit', { file: 'bom.md', title: 'Old title', body: '' }],
      ['due', { file: 'quoted.md', due: '2026-12-01' }],
      ['due', { file: 'bom.md', due: '2026-12-01' }],
      ['due', { file: 'plain.md', due: null }],
      ['due', { file: 'lf.md', due: '2026-02-31' }],
      ['tick', { file: 'tick-me.md', by: 'ben-mcadam', by_name: 'Ben McAdam', via: 'TDS Brain App' }],
      ['delete', { file: 'delete-me.md' }],
      ['tick', { file: 'gone.md' }],
      ['edit', { file: 'crlf.md', title: 'X', expect: sha('stale') }],
      ['roster', {}],
      ['list', {}],
    ];
    for (const [command, input] of calls) {
      const replies = brains.map((brain, i) => {
        const r = spawnSync(process.execPath, [scripts[i] as string, command], {
          input: JSON.stringify(input),
          env: { ...gitEnv('Sam Example'), BRAIN_ROOT: brain },
          cwd: brain,
          encoding: 'utf8',
        });
        return { code: r.status, out: calm(r.stdout) };
      });
      expect(replies[1], `${command} ${JSON.stringify(input)}`).toEqual(replies[0]);
    }
    expect(snapshot(brains[1] as string)).toEqual(snapshot(brains[0] as string));
  });
});

// ---- v0.5 (docs/plans/2026-11-16-todo-attachments.md, decisions 1, 2 and 8) ----------------------

// The script's own `## Files` reader, loaded in this process without running a command.
(globalThis as Record<string, unknown>).TDSAPP_TODO_LIBRARY = true;
const todoLib = require('./tdsapp-todo.cjs') as {
  parseFiles(body: string): { path: string; name: string; holder: string | null }[];
  splitFiles(body: string): { details: string; files: string };
  isNeverListed(rel: string): boolean;
  LIBRARY_EXTENSIONS: string[];
};
const FIXTURES = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../shared/todo-files.fixtures.json', import.meta.url)), 'utf8'),
) as {
  parse: { name: string; body: string; files: { path: string; name: string; holder: string | null }[] }[];
  split: { name: string; body: string; details: string; files: string }[];
};

// A file in the throwaway brain, its folders made.
function brainFile(rel: string, text = 'x') {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}
const Q = 'clients/acme/files/quote.pdf';
const LOGO = 'clients/acme/images/logo.png';
const Q_LINE = '- [quote.pdf](../clients/acme/files/quote.pdf)';
const LOGO_LINE = '- [logo.png](../clients/acme/images/logo.png)';
const linked = (text: string) => parseTodoFiles(text).map((f) => f.path);

describe('v0.5: attach', () => {
  beforeEach(() => {
    brainFile(Q);
    brainFile(LOGO);
    brainFile('templates/brief.docx');
  });

  it('adds a ## Files section at the end, the path relative to todo/', () => {
    put('a.md', SAMPLE);
    expect(run('attach', { file: 'a.md', path: Q })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', path: Q, changed: true },
    });
    expect(read('a.md')).toBe(`${SAMPLE}\n## Files\n\n${Q_LINE}\n`);
    expect(parseTodoFiles(read('a.md'))).toEqual([{ path: Q, name: 'quote.pdf', holder: null }]);
    expect(temps()).toEqual([]);
  });

  it('adds to the section in order, and a file already linked is a no-op that writes nothing', () => {
    put('a.md', SAMPLE);
    run('attach', { file: 'a.md', path: Q });
    run('attach', { file: 'a.md', path: LOGO });
    run('attach', { file: 'a.md', path: 'templates/brief.docx' });
    expect(read('a.md')).toBe(
      `${SAMPLE}\n## Files\n\n${Q_LINE}\n${LOGO_LINE}\n- [brief.docx](../templates/brief.docx)\n`,
    );
    const before = readFileSync(todoPath('a.md'));
    const past = new Date('2026-01-01T00:00:00Z');
    utimesSync(todoPath('a.md'), past, past);
    expect(run('attach', { file: 'a.md', path: LOGO })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', path: LOGO, changed: false },
    });
    expect(readFileSync(todoPath('a.md'))).toEqual(before);
    expect(statSync(todoPath('a.md')).mtimeMs).toBe(past.getTime());
  });

  it('counts a hand-written link to the same file as linked', () => {
    const text = `${SAMPLE}\n## Files\n\n* [The quote](<../../clients/acme/files/quote.pdf>)\n`;
    put('a.md', text);
    expect(run('attach', { file: 'a.md', path: Q }).json.changed).toBe(false);
    expect(read('a.md')).toBe(text);
  });

  it.each([
    ['## Title history', '- 2026-11-01: was "S"'],
    [
      '## Handover history',
      '- 13 Nov 2026, 14:05 UK: Sam Example passed it from sam-example to ben-mcadam (TDS Brain App).',
    ],
    ['## Done 2026-11-14', 'Ticked off by Sam Example at 10:00 UK time (TDS Brain App).'],
    ['## Deleted 2026-11-14', 'Deleted by Sam Example at 10:00 UK time (todo skill).'],
  ])('places a new section before %s', (heading, entry) => {
    put('a.md', `---\ntitle: T\n---\n\nDetails here.\n\n${heading}\n\n${entry}\n`);
    run('attach', { file: 'a.md', path: Q });
    expect(read('a.md')).toBe(
      `---\ntitle: T\n---\n\nDetails here.\n\n## Files\n\n${Q_LINE}\n\n${heading}\n\n${entry}\n`,
    );
  });

  it('places it before the first of several, and skips headings inside a code fence', () => {
    const tail = '## Handover history\n\n- one\n\n## Title history\n\n- two\n';
    put('a.md', `---\ntitle: T\n---\n\nDetails.\n\n\`\`\`\n## Title history\n\`\`\`\n\n${tail}`);
    run('attach', { file: 'a.md', path: Q });
    expect(read('a.md')).toBe(
      `---\ntitle: T\n---\n\nDetails.\n\n\`\`\`\n## Title history\n\`\`\`\n\n## Files\n\n${Q_LINE}\n\n${tail}`,
    );
  });

  it('places it straight after the frontmatter when there are no details, and works without frontmatter', () => {
    put('a.md', '---\ntitle: T\n---\n');
    run('attach', { file: 'a.md', path: Q });
    expect(read('a.md')).toBe(`---\ntitle: T\n---\n\n## Files\n\n${Q_LINE}\n`);
    put('b.md', '---\ntitle: T\n---\n\n## Title history\n\n- 2026-11-01: was "S"\n');
    run('attach', { file: 'b.md', path: Q });
    expect(read('b.md')).toBe(
      `---\ntitle: T\n---\n\n## Files\n\n${Q_LINE}\n\n## Title history\n\n- 2026-11-01: was "S"\n`,
    );
    put('c.md', 'Just text');
    run('attach', { file: 'c.md', path: Q });
    expect(read('c.md')).toBe(`Just text\n\n## Files\n\n${Q_LINE}\n`);
  });

  it('adds to an existing section wherever it is, keeping what else it holds', () => {
    put('a.md', `---\ntitle: T\n---\n\n## Files\n\nSome words.\n\n${Q_LINE}\n\n## Notes\n\nMore.\n`);
    run('attach', { file: 'a.md', path: LOGO });
    expect(read('a.md')).toBe(
      `---\ntitle: T\n---\n\n## Files\n\nSome words.\n\n${Q_LINE}\n${LOGO_LINE}\n\n## Notes\n\nMore.\n`,
    );
    put('b.md', 'Details.\n\n## files\n');
    run('attach', { file: 'b.md', path: LOGO });
    expect(read('b.md')).toBe(`Details.\n\n## files\n\n${LOGO_LINE}\n`);
  });

  it('wraps a path holding a space, a bracket, < or > ... in <…>, and keeps the link text readable', () => {
    const cases: [string, string][] = [
      ['clients/acme/files/Q3 report.pdf', '- [Q3 report.pdf](<../clients/acme/files/Q3 report.pdf>)'],
      ['clients/acme/files/plan(v2).pdf', '- [plan(v2).pdf](<../clients/acme/files/plan(v2).pdf>)'],
      ['clients/acme/files/a<b.pdf', '- [a<b.pdf](<../clients/acme/files/a<b.pdf>)'],
      ['clients/acme/files/v[2].pdf', '- [v(2).pdf](../clients/acme/files/v[2].pdf)'],
      [
        'clients/acme/files/Report [final].pdf',
        '- [Report (final).pdf](<../clients/acme/files/Report [final].pdf>)',
      ],
    ];
    put('a.md', SAMPLE);
    for (const [rel] of cases) {
      brainFile(rel);
      expect(run('attach', { file: 'a.md', path: rel }).code, rel).toBe(0);
    }
    expect(read('a.md')).toBe(`${SAMPLE}\n## Files\n\n${cases.map((c) => c[1]).join('\n')}\n`);
    expect(linked(read('a.md'))).toEqual(cases.map((c) => c[0]));
  });

  it('refuses a name with > in it, which no link can hold', () => {
    brainFile('clients/acme/files/a>b.pdf');
    put('a.md', SAMPLE);
    expect(run('attach', { file: 'a.md', path: 'clients/acme/files/a>b.pdf' })).toMatchObject({
      code: 2,
      json: { status: 400 },
    });
    expect(read('a.md')).toBe(SAMPLE);
  });

  it("writes a personal file with whose Mac has it, relative to the to-do's folder", () => {
    brainFile('personal/files/My notes.pdf');
    brainFile('personal/images/b.png');
    brainFile('personal/c.txt');
    put('a.md', SAMPLE);
    run('attach', { file: 'a.md', path: 'personal/files/My notes.pdf' });
    run('attach', { file: 'a.md', path: 'personal/images/b.png', by: 'Ben McAdam' });
    run('attach', { file: 'a.md', path: 'personal/c.txt' }, { userName: null });
    expect(read('a.md')).toBe(
      `${SAMPLE}\n## Files\n\n` +
        "- [My notes.pdf](<../personal/files/My notes.pdf>) (only on sam-example's Mac)\n" +
        "- [b.png](../personal/images/b.png) (only on ben-mcadam's Mac)\n" +
        '- [c.txt](../personal/c.txt)\n',
    );
    expect(parseTodoFiles(read('a.md'))).toEqual([
      { path: 'personal/files/My notes.pdf', name: 'My notes.pdf', holder: 'sam-example' },
      { path: 'personal/images/b.png', name: 'b.png', holder: 'ben-mcadam' },
      { path: 'personal/c.txt', name: 'c.txt', holder: null },
    ]);
  });

  it('writes the path relative to personal/todo/ for a personal to-do', () => {
    brainFile('personal/files/n.pdf');
    putPersonal('p.md', SAMPLE);
    expect(run('attach', { file: 'p.md', path: Q, scope: 'personal' }).code).toBe(0);
    expect(run('attach', { file: 'p.md', path: 'personal/files/n.pdf', scope: 'personal' }).code).toBe(0);
    expect(readPersonal('p.md')).toBe(
      `${SAMPLE}\n## Files\n\n- [quote.pdf](../../clients/acme/files/quote.pdf)\n` +
        "- [n.pdf](../../personal/files/n.pdf) (only on sam-example's Mac)\n",
    );
    expect(linked(readPersonal('p.md'))).toEqual([Q, 'personal/files/n.pdf']);
  });

  it('refuses a personal to-do when personal to-dos are not safe here', () => {
    gitInit(false);
    putPersonal('p.md', SAMPLE);
    expect(run('attach', { file: 'p.md', path: Q, scope: 'personal' })).toMatchObject({
      code: 2,
      json: { status: 400 },
    });
    expect(readPersonal('p.md')).toBe(SAMPLE);
  });

  it('refuses anything but a real library file under clients/<client>/, projects/<project>/, templates/ or personal/', () => {
    put('a.md', SAMPLE);
    put('other.md', SAMPLE);
    for (const rel of [
      'projects/a.pdf',
      'clients/acme.pdf',
      'clients/_archive/a.pdf',
      'clients/acme/.hidden/a.pdf',
      'clients/acme/config/a.pdf',
      'clients/acme/crm/data/a.csv',
      'personal/todo/x.md',
      'clients/acme/files/a.zip',
      'clients/acme/files/noext',
      'clients/acme/files/a%20b.pdf',
      'clients/acme/files/a:b.pdf',
      'elsewhere/a.pdf',
    ]) {
      brainFile(rel);
    }
    mkdirSync(join(root, 'clients', 'acme', 'files', 'folder.pdf'));
    symlinkSync(join(root, Q), join(root, 'clients', 'acme', 'files', 'link.pdf'));
    symlinkSync(join(root, 'elsewhere'), join(root, 'clients', 'acme', 'linked'));
    symlinkSync(join(root, 'clients', 'acme'), join(root, 'clients', 'alias'));
    const paths: unknown[] = [
      'clients/acme/files/missing.pdf',
      'todo/other.md',
      'projects/a.pdf',
      'clients/acme.pdf',
      'clients/_archive/a.pdf',
      'clients/acme/.hidden/a.pdf',
      'clients/acme/config/a.pdf',
      'clients/acme/crm/data/a.csv',
      'personal/todo/x.md',
      'clients/acme/files/a.zip',
      'clients/acme/files/noext',
      'clients/acme/files/a%20b.pdf',
      'clients/acme/files/a:b.pdf',
      'clients/acme/files/folder.pdf',
      'clients/acme/files/link.pdf',
      'clients/acme/linked/a.pdf',
      'clients/alias/files/quote.pdf',
      'clients/ACME/files/quote.pdf',
      '../clients/acme/files/quote.pdf',
      '/clients/acme/files/quote.pdf',
      `${root}/clients/acme/files/quote.pdf`,
      'clients/acme/./files/quote.pdf',
      'clients/acme/files//quote.pdf',
      'clients/acme/files/../files/quote.pdf',
      'clients\\acme\\files\\quote.pdf',
      ' clients/acme/files/quote.pdf',
      '',
      5,
      null,
      undefined,
    ];
    for (const path of paths) {
      expect(run('attach', { file: 'a.md', path }), String(path)).toMatchObject({
        code: 2,
        json: { status: 400 },
      });
    }
    expect(read('a.md')).toBe(SAMPLE);
  });

  it(`refuses more than 20 files, and still answers a file already linked`, () => {
    const lines = Array.from({ length: 20 }, (_, i) => `- [f${i}.pdf](../clients/acme/files/f${i}.pdf)`);
    const text = `${SAMPLE}\n## Files\n\n${lines.join('\n')}\n`;
    put('a.md', text);
    brainFile('clients/acme/files/f0.pdf');
    expect(run('attach', { file: 'a.md', path: Q })).toEqual({
      code: 2,
      json: { error: 'a to-do can have at most 20 files', status: 400 },
    });
    expect(run('attach', { file: 'a.md', path: 'clients/acme/files/f0.pdf' }).json.changed).toBe(false);
    expect(read('a.md')).toBe(text);
    put('b.md', `${SAMPLE}\n## Files\n\n${lines.slice(1).join('\n')}\n`);
    expect(run('attach', { file: 'b.md', path: Q }).code).toBe(0);
    expect(linked(read('b.md'))).toHaveLength(20);
  });

  it('checks expect, gives 404 for a missing to-do and refuses the rules files', () => {
    put('a.md', SAMPLE);
    expect(run('attach', { file: 'a.md', path: Q, expect: sha('other') })).toEqual({
      code: 2,
      json: { error: 'changed since read', status: 409 },
    });
    expect(read('a.md')).toBe(SAMPLE);
    expect(run('attach', { file: 'a.md', path: Q, expect: versionOf('a.md') }).code).toBe(0);
    expect(run('attach', { file: 'gone.md', path: Q })).toEqual({
      code: 2,
      json: { error: 'todo not found: gone.md', status: 404 },
    });
    expect(run('attach', { file: 'CLAUDE.md', path: Q }).json.status).toBe(400);
  });

  it('refuses a to-do that is a symbolic link', () => {
    put('real.md', SAMPLE);
    symlinkSync(todoPath('real.md'), todoPath('a.md'));
    expect(run('attach', { file: 'a.md', path: Q }).json.status).toBe(500);
    expect(read('real.md')).toBe(SAMPLE);
  });

  it('keeps Windows line endings and a byte order mark', () => {
    put('a.md', `﻿${SAMPLE.replace(/\n/g, '\r\n')}`);
    run('attach', { file: 'a.md', path: Q });
    expect(read('a.md')).toBe(`﻿${`${SAMPLE}\n## Files\n\n${Q_LINE}\n`.replace(/\n/g, '\r\n')}`);
    run('detach', { file: 'a.md', path: Q });
    expect(read('a.md')).toBe(`﻿${SAMPLE.replace(/\n/g, '\r\n')}`);
  });

  it('leaves the frontmatter reading the same in the Workbench, the Reminders sync and the app', () => {
    for (const [file, text] of [
      ['lf.md', SAMPLE],
      ['crlf.md', SAMPLE.replace(/\n/g, '\r\n')],
      ['bare.md', '---\nassignee: sam-example\ntitle: Old title\n---\n'],
    ] as const) {
      put(file, text);
      run('attach', { file, path: Q });
      expectReadersAgree(todoPath(file), { title: 'Old title', due: null, assignee: 'sam-example' });
      run('detach', { file, path: Q });
      expectReadersAgree(todoPath(file), { title: 'Old title', due: null, assignee: 'sam-example' });
    }
  });
});

describe('v0.5: detach', () => {
  beforeEach(() => {
    brainFile(Q);
    brainFile(LOGO);
  });

  it.each([
    ['details', SAMPLE],
    ['only frontmatter', '---\ntitle: T\n---\n'],
    ['no frontmatter', 'Just text\n'],
    ['history after it', `---\ntitle: T\n---\n\nDetails.\n\n## Title history\n\n- 2026-11-01: was "S"\n`],
    ['CRLF', SAMPLE.replace(/\n/g, '\r\n')],
  ])('drops the emptied section, giving back the bytes from before (%s)', (_, text) => {
    put('a.md', text);
    run('attach', { file: 'a.md', path: Q });
    run('attach', { file: 'a.md', path: LOGO });
    expect(run('detach', { file: 'a.md', path: Q })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', path: Q, changed: true },
    });
    expect(linked(read('a.md'))).toEqual([LOGO]);
    run('detach', { file: 'a.md', path: LOGO });
    expect(read('a.md')).toBe(text);
    expect(temps()).toEqual([]);
  });

  it('removes every line that leads to that file, hand-written ones too, and nothing else', () => {
    put(
      'a.md',
      `Details.\n\n## Files\n\n${Q_LINE}\n${LOGO_LINE}\n* [Again](<../../clients/acme/files/quote.pdf>)\n`,
    );
    run('detach', { file: 'a.md', path: Q });
    expect(read('a.md')).toBe(`Details.\n\n## Files\n\n${LOGO_LINE}\n`);
  });

  it('keeps a section that still holds other text', () => {
    put('a.md', `Details.\n\n## Files\n\nKeep these together.\n${Q_LINE}\n`);
    run('detach', { file: 'a.md', path: Q });
    expect(read('a.md')).toBe('Details.\n\n## Files\n\nKeep these together.\n');
  });

  it('is a no-op for a file not linked or a to-do with no section, and does not need the file', () => {
    put('a.md', SAMPLE);
    expect(run('detach', { file: 'a.md', path: Q }).json).toEqual({
      ok: true,
      file: 'a.md',
      path: Q,
      changed: false,
    });
    put('b.md', `${SAMPLE}\n## Files\n\n${LOGO_LINE}\n`);
    expect(run('detach', { file: 'b.md', path: Q }).json.changed).toBe(false);
    expect(read('a.md')).toBe(SAMPLE);
    expect(read('b.md')).toBe(`${SAMPLE}\n## Files\n\n${LOGO_LINE}\n`);
    rmSync(join(root, LOGO));
    expect(run('detach', { file: 'b.md', path: LOGO }).json.changed).toBe(true);
    expect(read('b.md')).toBe(SAMPLE);
  });

  it('refuses a path that is not a brain path, checks expect and gives 404', () => {
    put('a.md', `${SAMPLE}\n## Files\n\n${Q_LINE}\n`);
    for (const path of ['', '../clients/acme/files/quote.pdf', 'projects/a.pdf', 'clients//a.pdf', 5, null]) {
      expect(run('detach', { file: 'a.md', path }).json.status, String(path)).toBe(400);
    }
    expect(run('detach', { file: 'a.md', path: Q, expect: sha('x') }).json.status).toBe(409);
    expect(run('detach', { file: 'gone.md', path: Q }).json.status).toBe(404);
    expect(linked(read('a.md'))).toEqual([Q]);
  });
});

describe('v0.5: edit with keep_files', () => {
  const HANDOVER =
    '## Handover history\n\n- 13 Nov 2026, 14:05 UK: Sam Example passed it on (TDS Brain App).';
  const ON_DISK = `---\ntitle: T\n---\n\nOld details.\n\n## Files\n\n${Q_LINE}\n\n${HANDOVER}\n`;

  it('puts the section on disk back before the history, whatever details are sent', () => {
    put('a.md', ON_DISK);
    const r = run('edit', {
      file: 'a.md',
      title: 'T',
      body: `New details.\n\n${HANDOVER}`,
      keep_files: true,
    });
    const want = `New details.\n\n## Files\n\n${Q_LINE}\n\n${HANDOVER}`;
    expect(r).toEqual({ code: 0, json: { ok: true, file: 'a.md', title: 'T', body: want } });
    expect(read('a.md')).toBe(`---\ntitle: T\n---\n\n${want}\n`);
  });

  it('keeps it before a new title history too', () => {
    put('a.md', ON_DISK);
    run('edit', { file: 'a.md', title: 'U', body: `New details.\n\n${HANDOVER}`, keep_files: true });
    expect(read('a.md')).toBe(
      `---\ntitle: U\n---\n\nNew details.\n\n## Files\n\n${Q_LINE}\n\n${HANDOVER}\n${history('T')}`,
    );
  });

  it('carries a section at the end, with empty details, and without frontmatter', () => {
    put('a.md', `${SAMPLE}\n## Files\n\n${Q_LINE}\n`);
    run('edit', { file: 'a.md', title: 'Old title', body: '# Old title\n\nChanged.', keep_files: true });
    expect(read('a.md')).toBe(`${SAMPLE.replace('Some details.', 'Changed.')}\n## Files\n\n${Q_LINE}\n`);
    run('edit', { file: 'a.md', title: 'Old title', body: '', keep_files: true });
    expect(read('a.md')).toBe(
      `---\nassignee: sam-example\ntitle: Old title\ncreated: 2026-11-01\n---\n\n## Files\n\n${Q_LINE}\n`,
    );
    put('b.md', `Old.\n\n## Files\n\n${Q_LINE}\n`);
    run('edit', { file: 'b.md', title: 'T', body: 'New.', keep_files: true });
    expect(read('b.md')).toBe(`---\ntitle: T\n---\n\nNew.\n\n## Files\n\n${Q_LINE}\n`);
  });

  it('refuses details holding a ## Files heading, writing nothing', () => {
    put('a.md', ON_DISK);
    for (const body of ['## Files', 'x\n\n##   files  \n\n- y', 'x\r\n## FILES\r\n']) {
      expect(run('edit', { file: 'a.md', title: 'T', body, keep_files: true }), body).toEqual({
        code: 2,
        json: {
          error: 'details can\'t hold a "## Files" section: files are linked with attach',
          status: 400,
        },
      });
    }
    expect(read('a.md')).toBe(ON_DISK);
    for (const body of ['### Files', '# Files', '## Files to send']) {
      expect(run('edit', { file: 'a.md', title: 'T', body, keep_files: true }).code, body).toBe(0);
      expect(linked(read('a.md'))).toEqual([Q]);
    }
  });

  // The app's own reader (shared/todo-files.ts) skips headings in code fences, so it let these through and the
  // script refused every tick and Save on them with a 400 (2026-11-20).
  it('accepts a ## Files line inside a code fence, on edit and add', () => {
    put('a.md', ON_DISK);
    for (const body of ['- [ ] a\n\n```\n## Files\n```', 'x\n\n~~~md\n## Files\n- y\n~~~\n\nAfter.']) {
      expect(splitTodoFiles(body).files, body).toBe('');
      expect(run('edit', { file: 'a.md', title: 'T', body, keep_files: true }).code, body).toBe(0);
      expect(linked(read('a.md'))).toEqual([Q]);
      expect(run('add', { title: 'Fenced', assignee: 'sam-example', body }).code, body).toBe(0);
    }
  });

  it('counts only the details sent against the 8,000 limit', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `- [f${i}.pdf](../clients/acme/files/f${i}.pdf)`);
    put('a.md', `---\ntitle: T\n---\n\nOld.\n\n## Files\n\n${lines.join('\n')}\n`);
    expect(run('edit', { file: 'a.md', title: 'T', body: 'x'.repeat(8000), keep_files: true }).code).toBe(0);
    expect(linked(read('a.md'))).toHaveLength(20);
    expect(
      run('edit', { file: 'a.md', title: 'T', body: 'x'.repeat(8001), keep_files: true }).json.status,
    ).toBe(400);
  });

  it('leaves the section alone when no body is sent, and changes nothing when there is none on disk', () => {
    put('a.md', ON_DISK);
    run('edit', { file: 'a.md', title: 'T', keep_files: true });
    expect(read('a.md')).toBe(ON_DISK);
    put('b.md', SAMPLE);
    run('edit', { file: 'b.md', title: 'Old title', body: 'New.', keep_files: true });
    expect(read('b.md')).toBe(SAMPLE.replace('# Old title\n\nSome details.', 'New.'));
  });

  it('keeps Windows line endings', () => {
    put('a.md', ON_DISK.replace(/\n/g, '\r\n'));
    run('edit', { file: 'a.md', title: 'T', body: `New details.\r\n\r\n${HANDOVER}`, keep_files: true });
    expect(read('a.md')).toBe(
      `---\ntitle: T\n---\n\nNew details.\n\n## Files\n\n${Q_LINE}\n\n${HANDOVER}\n`.replace(/\n/g, '\r\n'),
    );
  });

  it('without keep_files, still replaces the whole body, a ## Files heading included', () => {
    put('a.md', ON_DISK);
    run('edit', { file: 'a.md', title: 'T', body: 'New details.' });
    expect(read('a.md')).toBe('---\ntitle: T\n---\n\nNew details.\n');
    run('edit', { file: 'a.md', title: 'T', body: `Two.\n\n## Files\n\n${LOGO_LINE}` });
    expect(linked(read('a.md'))).toEqual([LOGO]);
    run('edit', { file: 'a.md', title: 'T', body: 'Three.', keep_files: false });
    expect(read('a.md')).toBe('---\ntitle: T\n---\n\nThree.\n');
  });
});

describe('v0.5: add with body', () => {
  it('writes the details below the frontmatter, for anyone', () => {
    const mine = run('add', { title: 'Renew', body: '  Ring them first.\r\n\r\nThen send it.  ' });
    expect(read(mine.json.file as string)).toBe(
      `---\nassignee: sam-example\ntitle: Renew\ncreated: ${today()}\ncreated_by: sam-example\nsource: added with the todo skill\n---\n\nRing them first.\n\nThen send it.\n`,
    );
    const theirs = run('add', { title: 'For Ben', assignee: 'ben-mcadam', body: 'Details for Ben.' });
    const text = read(theirs.json.file as string);
    expect(text).toMatch(/\nassigned_to: ben-mcadam\n[\s\S]*\n---\n\nDetails for Ben\.\n$/);
    expectReadersAgree(todoPath(theirs.json.file as string), {
      title: 'For Ben',
      due: null,
      assignee: 'ben-mcadam',
    });
    const open = run('add', { title: 'Open one', open: true, body: 'Anyone.' });
    expect(read(open.json.file as string)).toMatch(/\n---\n\nAnyone\.\n$/);
    const personal = run('add', { title: 'Private', scope: 'personal', body: 'Only me.' });
    expect(readPersonal(personal.json.file as string)).toMatch(/\n---\n\nOnly me\.\n$/);
  });

  it('writes no details for an empty body, and ignores a body that is not text', () => {
    for (const body of ['', '  \n ', 5, null]) {
      const r = run('add', { title: `Plain ${String(body).trim()}`, body });
      expect(read(r.json.file as string), String(body)).toMatch(
        /\nsource: added with the todo skill\n---\n$/,
      );
    }
  });

  it('refuses details over 8,000 characters or holding a ## Files heading, writing nothing', () => {
    expect(run('add', { title: 'Long', body: 'x'.repeat(8001) })).toEqual({
      code: 2,
      json: { error: 'details are too long (over 8000 characters)', status: 400 },
    });
    expect(run('add', { title: 'Files', body: `Hi.\n\n## Files\n\n${Q_LINE}` }).json.status).toBe(400);
    expect(readdirSync(join(root, 'todo'))).toEqual([]);
    expect(run('add', { title: 'Exactly', body: 'x'.repeat(8000) }).code).toBe(0);
  });
});

describe('v0.5: the ## Files rules match the app (shared/todo-files.fixtures.json)', () => {
  it.each(FIXTURES.parse.map((c) => [c.name, c] as const))('parse: %s', (_, c) => {
    expect(todoLib.parseFiles(c.body)).toEqual(c.files);
    expect(parseTodoFiles(c.body)).toEqual(c.files);
  });

  it.each(FIXTURES.split.map((c) => [c.name, c] as const))('split: %s', (_, c) => {
    expect(todoLib.splitFiles(c.body)).toEqual({ details: c.details, files: c.files });
    expect(splitTodoFiles(c.body)).toEqual({ details: c.details, files: c.files });
  });

  it.each(FIXTURES.parse.map((c) => [c.name, c] as const))(
    'attach and detach agree with the app: %s',
    (_, c) => {
      put('a.md', c.body);
      for (const f of c.files) {
        brainFile(f.path);
        expect(run('attach', { file: 'a.md', path: f.path }).json.changed, f.path).toBe(false);
      }
      expect(read('a.md')).toBe(c.body);
      for (const f of c.files)
        expect(run('detach', { file: 'a.md', path: f.path }).json.changed, f.path).toBe(true);
      expect(parseTodoFiles(read('a.md'))).toEqual([]);
      brainFile('clients/acme/files/new.pdf');
      expect(run('attach', { file: 'a.md', path: 'clients/acme/files/new.pdf' }).json.changed).toBe(true);
      expect(linked(read('a.md'))).toEqual(['clients/acme/files/new.pdf']);
    },
  );
});

describe('v0.5: attach uses the library rules', () => {
  it('lists the same types and never-listed places as the library', () => {
    for (const ext of todoLib.LIBRARY_EXTENSIONS) expect(classify(ext), ext).not.toBeNull();
    for (const ext of ['json', 'zip', 'heic', 'doc', 'xls', 'mov', 'js', 'sh', 'png', 'svg', 'pptx']) {
      expect(todoLib.LIBRARY_EXTENSIONS.includes(ext), ext).toBe(classify(ext) !== null);
    }
    for (const rel of [
      'clients/acme/files/a.pdf',
      'clients/_old/a.pdf',
      'clients/acme/Config/a.pdf',
      'clients/acme/crm/data/a.csv',
      'clients/acme/context/google-ads/data/a.csv',
      'clients/acme/.git/a.md',
      'clients/acme/node_modules/a.md',
      'personal/todo/a.md',
      'personal/TODO/done/a.md',
      'personal/files/a.pdf',
      'templates/a.docx',
      'templates//a.docx',
    ]) {
      expect(todoLib.isNeverListed(rel), rel).toBe(libraryNeverListed(rel));
    }
  });
});
