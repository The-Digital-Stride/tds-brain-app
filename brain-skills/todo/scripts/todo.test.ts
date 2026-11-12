// Tests for the brain's `todo` skill script. Each case runs the real script as a child
// process against a throwaway brain, and checks the file text and JSON match what the
// Workbench routes (tools/members/command-centre/server.cjs) produce for the same input.
// This test stays in the app repo; it is not copied into the brain.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./todo.cjs', import.meta.url));

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'todo-skill-'));
  mkdirSync(join(root, 'todo'));
  mkdirSync(join(root, '.team-config'));
  writeFileSync(
    join(root, '.team-config', 'roles.json'),
    JSON.stringify({
      members: [
        { name: 'Sam Example', email: 'sam@example.test', role: 'scout' },
        { name: 'Ben McAdam', email: 'ben@example.test', role: 'team' },
        { email: 'nobody@example.test', role: 'team' },
      ],
    }),
  );
});

afterEach(() => {
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
  opts: { userName?: string | null; env?: NodeJS.ProcessEnv } = {},
): RunResult {
  const env = { ...gitEnv(opts.userName === undefined ? 'Sam Example' : opts.userName), ...opts.env };
  const r = spawnSync(process.execPath, [SCRIPT, command], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env,
    cwd: root,
    encoding: 'utf8',
  });
  const lines = r.stdout.split('\n').filter(Boolean);
  expect(lines).toHaveLength(1);
  return { code: r.status, json: JSON.parse(lines[0] as string) };
}

const todoPath = (file: string) => join(root, 'todo', file);
const read = (file: string) => readFileSync(todoPath(file), 'utf8');
const put = (file: string, text: string) => writeFileSync(todoPath(file), text);

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const stamp = () => today().replace(/-/g, '');

const SAMPLE =
  '---\nassignee: sam-example\ntitle: Old title\ncreated: 2026-11-01\n---\n\n# Old title\n\nSome details.\n';

describe('add', () => {
  it('writes the Workbench frontmatter, defaulting the assignee to git user.name', () => {
    const r = run('add', { title: 'Renew the contract' });
    const file = `${stamp()}-renew-the-contract.md`;
    expect(r).toEqual({ code: 0, json: { ok: true, file } });
    expect(read(file)).toBe(
      `---\nassignee: sam-example\ntitle: Renew the contract\ncreated: ${today()}\nsource: added from the Workbench\n---\n`,
    );
  });

  it('writes due after created when given', () => {
    const r = run('add', { title: 'Book venue', due: '2026-12-01', assignee: 'sam-example' });
    expect(read(r.json.file as string)).toBe(
      `---\nassignee: sam-example\ntitle: Book venue\ncreated: ${today()}\ndue: 2026-12-01\nsource: added from the Workbench\n---\n`,
    );
  });

  it('slugifies an explicit assignee and cuts it to 40 characters', () => {
    const a = run('add', { title: 'One', assignee: '  Ben McAdam!! ' });
    expect(read(a.json.file as string)).toContain('\nassignee: ben-mcadam\n');
    const long = `${'a'.repeat(39)}-bcd`;
    const b = run('add', { title: 'Two', assignee: long });
    expect(read(b.json.file as string)).toContain(`\nassignee: ${'a'.repeat(39)}-\n`);
  });

  it('leaves the to-do open when git has no user name and none is sent', () => {
    const r = run('add', { title: 'Open one' }, { userName: null });
    expect(r.code).toBe(0);
    expect(read(r.json.file as string)).toBe(
      `---\ntitle: Open one\ncreated: ${today()}\nsource: added from the Workbench\n---\n`,
    );
  });

  it('flattens new lines, trims and cuts the title to 200, slug to 60', () => {
    const title = `  Line one\r\nline two ${'x'.repeat(300)}`;
    const r = run('add', { title });
    const kept = `Line one line two ${'x'.repeat(300)}`.slice(0, 200);
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
});

describe('edit', () => {
  it('replaces the title only and leaves the body when body is not sent', () => {
    put('a.md', SAMPLE);
    expect(run('edit', { file: 'a.md', title: 'New title' })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', title: 'New title' },
    });
    expect(read('a.md')).toBe(SAMPLE.replace('title: Old title', 'title: New title'));
  });

  it('replaces the whole body when body is sent', () => {
    put('a.md', SAMPLE);
    const r = run('edit', { file: 'a.md', title: 'New', body: '\r\n  First line\r\nSecond  \n' });
    expect(r.json).toEqual({ ok: true, file: 'a.md', title: 'New', body: 'First line\nSecond' });
    expect(read('a.md')).toBe(
      '---\nassignee: sam-example\ntitle: New\ncreated: 2026-11-01\n---\n\nFirst line\nSecond\n',
    );
  });

  it('an empty body leaves only the frontmatter', () => {
    put('a.md', SAMPLE);
    const r = run('edit', { file: 'a.md', title: 'New', body: '' });
    expect(r.json).toEqual({ ok: true, file: 'a.md', title: 'New', body: '' });
    expect(read('a.md')).toBe('---\nassignee: sam-example\ntitle: New\ncreated: 2026-11-01\n---\n');
  });

  it('cuts the body to 8000 characters', () => {
    put('a.md', SAMPLE);
    const r = run('edit', { file: 'a.md', title: 'New', body: 'b'.repeat(9000) });
    expect(r.json.body).toBe('b'.repeat(8000));
  });

  it('adds a title line at the top when the frontmatter has none', () => {
    put('a.md', '---\ndue: 2026-12-01\n---\nBody\n');
    run('edit', { file: 'a.md', title: 'T' });
    expect(read('a.md')).toBe('---\ntitle: T\ndue: 2026-12-01\n---\nBody\n');
    run('edit', { file: 'a.md', title: 'T2', body: 'New body' });
    expect(read('a.md')).toBe('---\ntitle: T2\ndue: 2026-12-01\n---\n\nNew body\n');
  });

  it('adds a frontmatter block when the file has none', () => {
    put('a.md', '# Heading\n\nText\n');
    run('edit', { file: 'a.md', title: 'T' });
    expect(read('a.md')).toBe('---\ntitle: T\n---\n\n# Heading\n\nText\n');
    put('b.md', '# Heading\n');
    run('edit', { file: 'b.md', title: 'T', body: 'New' });
    expect(read('b.md')).toBe('---\ntitle: T\n---\n\nNew\n');
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

  it('rewrites CRLF files with LF line endings (as the Workbench does)', () => {
    put('a.md', '---\r\ntitle: Old\r\n---\r\nBody\r\n');
    run('edit', { file: 'a.md', title: 'New' });
    expect(read('a.md')).toBe('---\ntitle: New\n---\nBody\n');
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
    expect(read('a.md')).toBe(SAMPLE.replace('assignee: sam-example', 'assignee: ben-mcadam'));
    expect(run('assignee', { file: 'a.md', assignee: null }).json).toEqual({
      ok: true,
      file: 'a.md',
      assignee: null,
    });
    expect(read('a.md')).toBe(SAMPLE.replace('assignee: sam-example\n', ''));
    run('assignee', { file: 'a.md', assignee: 'sam-example' });
    expect(read('a.md')).toBe(SAMPLE);
  });

  it('cuts to 40 and adds a block to a file without frontmatter', () => {
    put('a.md', 'Plain\n');
    run('assignee', { file: 'a.md', assignee: 'x'.repeat(50) });
    expect(read('a.md')).toBe(`---\nassignee: ${'x'.repeat(40)}\n---\n\nPlain\n`);
  });
});

describe('delete', () => {
  it('removes the file', () => {
    put('a.md', SAMPLE);
    expect(run('delete', { file: 'a.md' })).toEqual({ code: 0, json: { ok: true, file: 'a.md' } });
    expect(existsSync(todoPath('a.md'))).toBe(false);
  });
});

describe('tick', () => {
  it('moves the file into todo/done/, with a suffix when the name is taken', () => {
    put('a.md', SAMPLE);
    expect(run('tick', { file: 'a.md' })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', moved: join('todo', 'done', 'a.md') },
    });
    expect(readFileSync(join(root, 'todo', 'done', 'a.md'), 'utf8')).toBe(SAMPLE);
    put('a.md', 'second');
    const r = run('tick', { file: 'a.md' });
    expect(r.json.moved).toMatch(/^todo\/done\/a-\d{13}\.md$/);
    expect(readFileSync(join(root, r.json.moved as string), 'utf8')).toBe('second');
    expect(existsSync(todoPath('a.md'))).toBe(false);
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
