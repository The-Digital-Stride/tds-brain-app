import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Identity } from '../../shared/contract.ts';
import { createMyChanges, parseMyLog, parseStatus } from './my-changes.ts';
import type { GitLogRunner } from './todo-history.ts';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ME: Identity = {
  name: 'Ian Hancock',
  slug: 'ian-hancock',
  email: 'ian@example.com',
  role: 'owner',
  knownMember: true,
};
const HEAD = 'a'.repeat(40);

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'tba-mine-'));
  temps.push(root);
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'Ian Hancock');
  git('config', 'user.email', 'ian@example.com');
  git('config', 'commit.gpgsign', 'false');
  return root;
}
function put(root: string, rel: string, text = 'x') {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}
function commit(
  root: string,
  msg: string,
  who = 'Ian Hancock <ian@example.com>',
  date = '2026-01-01T10:00:00Z',
) {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', msg, `--author=${who}`], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

describe('parsers', () => {
  it('parseMyLog keeps the newest time per path and drops a cut last record', () => {
    const log =
      '\x1eIan\0i@x\x002026-02-01T00:00:00+00:00\0clients/a/Doc.md\0\x1eIan\0i@x\x002026-01-01T00:00:00+00:00\0clients/a/doc.md\0clients/a/b.md\0\x1eIan\0i@x\x002025-01-01T00:00:00+00:00\0clients/a/half';
    const kept = parseMyLog(log, true, () => true);
    expect([...kept]).toEqual([
      ['clients/a/doc.md', '2026-02-01T00:00:00+00:00'],
      ['clients/a/b.md', '2026-01-01T00:00:00+00:00'],
    ]);
    expect(parseMyLog(log, false, () => true).has('clients/a/half')).toBe(true);
  });

  it('parseStatus skips deletes and conflicts and keeps a rename’s new path', () => {
    const out = [
      '?? clients/new/file.md',
      ' M clients/a/m.md',
      ' D clients/a/gone.md',
      'D  clients/a/gone2.md',
      'UU clients/a/clash.md',
      'AA clients/a/clash2.md',
      'DD clients/a/clash3.md',
      'R  clients/a/new name.md',
      'clients/a/old name.md',
      '?? other/outside.md',
      '',
    ].join('\0');
    expect(parseStatus(out)).toEqual(['clients/new/file.md', 'clients/a/m.md', 'clients/a/new name.md']);
  });
});

describe('createMyChanges (real git)', () => {
  it('lists my commits by email or name, not someone else’s, with -z paths', async () => {
    const root = repo();
    put(root, 'clients/acme/Café notes.md');
    put(root, 'clients/acme/mine-by-name.md');
    commit(root, 'mine', 'Ian Hancock <ian@example.com>', '2026-01-01T10:00:00Z');
    put(root, 'clients/acme/theirs.md');
    commit(root, 'theirs', 'Ian Hancocks <someone@else.com>', '2026-01-02T10:00:00Z');
    put(root, 'clients/acme/by-name.md');
    commit(root, 'name only', 'Ian Hancock <old@example.org>', '2026-01-03T10:00:00Z');
    put(root, 'clients/acme/Café notes.md', 'changed');
    commit(root, 'again', 'Ian Hancock <ian@example.com>', '2026-01-04T10:00:00Z');
    put(root, 'notes/outside.md');
    commit(root, 'outside', 'Ian Hancock <ian@example.com>', '2026-01-05T10:00:00Z');
    const r = await createMyChanges().read(root, ME);
    expect(r.readable).toBe(true);
    // The old email isn't on the roster, so by name that commit isn't confirmed as mine.
    expect([...r.paths.keys()].sort()).toEqual([
      'clients/acme/café notes.md',
      'clients/acme/mine-by-name.md',
    ]);
    expect(Date.parse(r.paths.get('clients/acme/café notes.md') ?? '')).toBe(
      Date.parse('2026-01-04T10:00:00Z'),
    );
  });

  it('skips deletions, and adds uncommitted files by mtime, including a new folder and a rename', async () => {
    const root = repo();
    put(root, 'clients/acme/gone.md');
    put(root, 'clients/acme/old name.md');
    put(root, 'clients/acme/kept.md');
    commit(root, 'one', undefined, '2026-01-01T10:00:00Z');
    execFileSync('git', ['rm', '-q', 'clients/acme/gone.md'], { cwd: root });
    commit(root, 'del', undefined, '2026-01-02T10:00:00Z');
    execFileSync('git', ['mv', 'clients/acme/old name.md', 'clients/acme/new name.md'], { cwd: root });
    put(root, 'projects/fresh/doc.md');
    const t = new Date('2026-03-01T12:00:00Z');
    utimesSync(join(root, 'projects/fresh/doc.md'), t, t);
    const r = await createMyChanges().read(root, ME);
    // The deleting commit adds nothing: the file keeps the time of the commit that last wrote it.
    expect(Date.parse(r.paths.get('clients/acme/gone.md') ?? '')).toBe(Date.parse('2026-01-01T10:00:00Z'));
    expect(r.paths.has('clients/acme/new name.md')).toBe(true);
    expect(r.paths.has('clients/acme/old name.md')).toBe(true); // from its earlier commit
    expect(r.paths.get('projects/fresh/doc.md')).toBe(t.toISOString());
  });

  it('a folder that is not the repo top, or no repo, is unreadable', async () => {
    const root = repo();
    put(root, 'clients/a/x.md');
    commit(root, 'one');
    const sub = join(root, 'clients');
    expect((await createMyChanges().read(sub, ME)).readable).toBe(false);
    const bare = mkdtempSync(join(tmpdir(), 'tba-mine-none-'));
    temps.push(bare);
    expect(await createMyChanges().read(bare, ME)).toEqual({ paths: new Map(), readable: false });
  });
});

describe('createMyChanges (fake runner)', () => {
  const fake = (over: Partial<Record<string, string | Error>> = {}) => {
    const calls: string[][] = [];
    const run: GitLogRunner = async (args) => {
      calls.push([...args]);
      const key = args[0] === 'log' ? 'log' : args[0] === 'status' ? 'status' : (args[1] ?? '');
      const v = over[key];
      if (v instanceof Error) throw v;
      if (key === '--show-toplevel') return { stdout: `${over.top ?? ROOT}\n`, cut: false };
      if (key === 'HEAD') return { stdout: `${over.HEAD ?? HEAD}\n`, cut: false };
      return { stdout: typeof v === 'string' ? v : '', cut: false };
    };
    return { run, calls };
  };
  const ROOT = mkdtempSync(join(tmpdir(), 'tba-mine-fake-'));
  temps.push(ROOT);
  const LOG = '\x1eIan Hancock\0ian@example.com\x002026-01-01T10:00:00+00:00\0clients/a/x.md\0';

  it('uses the right log arguments', async () => {
    const { run, calls } = fake({ log: LOG });
    await createMyChanges(run).read(ROOT, ME);
    const args = calls.find((c) => c[0] === 'log') ?? [];
    expect(args).toEqual(
      expect.arrayContaining(['-z', '--no-merges', '--no-renames', '--diff-filter=d', '-i', '-F']),
    );
    expect(args).toContain('--author=ian@example.com');
    expect(args).toContain('--author=Ian Hancock');
    expect(args).toContain('--max-count=400');
    expect(args.slice(-3)).toEqual(['clients', 'templates', 'projects']);
  });

  it('caches the log per HEAD and identity, and shares the status in flight', async () => {
    const { run, calls } = fake({ log: LOG });
    const reader = createMyChanges(run);
    await Promise.all([reader.read(ROOT, ME), reader.read(ROOT, ME)]);
    await reader.read(ROOT, ME);
    expect(calls.filter((c) => c[0] === 'log')).toHaveLength(1);
    expect(calls.filter((c) => c[0] === 'status')).toHaveLength(1);
    await reader.read(ROOT, { ...ME, slug: 'other', name: 'Other', email: 'o@x.com' });
    expect(calls.filter((c) => c[0] === 'log')).toHaveLength(2);
  });

  it('re-reads the log when HEAD moves', async () => {
    let head = HEAD;
    const calls: string[][] = [];
    const run: GitLogRunner = async (args) => {
      calls.push([...args]);
      if (args[1] === 'HEAD') return { stdout: head, cut: false };
      if (args[1] === '--show-toplevel') return { stdout: ROOT, cut: false };
      return { stdout: args[0] === 'log' ? LOG : '', cut: false };
    };
    const reader = createMyChanges(run);
    await reader.read(ROOT, ME);
    head = 'b'.repeat(40);
    await reader.read(ROOT, ME);
    expect(calls.filter((c) => c[0] === 'log')).toHaveLength(2);
  });

  it('does not keep a failed log: the next read tries again at the same HEAD', async () => {
    let fail = true;
    const run: GitLogRunner = async (args) => {
      if (args[1] === 'HEAD') return { stdout: HEAD, cut: false };
      if (args[1] === '--show-toplevel') return { stdout: ROOT, cut: false };
      if (args[0] === 'log') {
        if (fail) throw new Error('timed out');
        return { stdout: LOG, cut: false };
      }
      return { stdout: '', cut: false };
    };
    const reader = createMyChanges(run);
    expect((await reader.read(ROOT, ME)).readable).toBe(false);
    fail = false;
    const again = await reader.read(ROOT, ME);
    expect(again.readable).toBe(true);
    expect(again.paths.has('clients/a/x.md')).toBe(true);
  });

  it("counts no uncommitted files while a merge is under way (they may be a teammate's)", async () => {
    mkdirSync(join(ROOT, 'clients/a'), { recursive: true });
    writeFileSync(join(ROOT, 'clients/a/merged.md'), 'x');
    const merging = await createMyChanges(
      fake({ log: LOG, '-q': `${'c'.repeat(40)}\n`, status: 'M  clients/a/merged.md\0' }).run,
    ).read(ROOT, ME);
    expect(merging.paths.has('clients/a/merged.md')).toBe(false);
    expect(merging.paths.has('clients/a/x.md')).toBe(true);
    const calm = await createMyChanges(
      fake({ log: LOG, '-q': new Error('no MERGE_HEAD'), status: 'M  clients/a/merged.md\0' }).run,
    ).read(ROOT, ME);
    expect(calm.paths.has('clients/a/merged.md')).toBe(true);
  });

  it('refreshes the status after its cache time', async () => {
    let t = 0;
    const { run, calls } = fake({ log: LOG });
    const reader = createMyChanges(run, () => t);
    await reader.read(ROOT, ME);
    t = 6000;
    await reader.read(ROOT, ME);
    expect(calls.filter((c) => c[0] === 'status')).toHaveLength(2);
  });

  it('keeps whole records of a cut log and stays readable', async () => {
    const half = `${LOG}\x1eIan Hancock\0ian@example.com\x002026-01-01T09:00:00+00:00\0clients/a/y.md\0clients/a/z`;
    const run: GitLogRunner = async (args) => {
      if (args[1] === 'HEAD') return { stdout: HEAD, cut: false };
      if (args[1] === '--show-toplevel') return { stdout: ROOT, cut: false };
      return { stdout: args[0] === 'log' ? half : '', cut: args[0] === 'log' };
    };
    const r = await createMyChanges(run).read(ROOT, ME);
    expect(r.readable).toBe(true);
    expect([...r.paths.keys()]).toEqual(['clients/a/x.md']);
  });

  it('a failed log, or no author value, is unreadable and never throws', async () => {
    const failed = await createMyChanges(fake({ log: new Error('boom') }).run).read(ROOT, ME);
    expect(failed.readable).toBe(false);
    const nohead = await createMyChanges(fake({ HEAD: new Error('x') }).run).read(ROOT, ME);
    expect(nohead.readable).toBe(false);
    const nobody = await createMyChanges(fake({ log: LOG }).run).read(ROOT, {
      ...ME,
      name: '',
      email: null,
    });
    expect(nobody.readable).toBe(false);
  });

  it('a failed status leaves the committed changes', async () => {
    const r = await createMyChanges(fake({ log: LOG, status: new Error('x') }).run).read(ROOT, ME);
    expect(r.readable).toBe(true);
    expect(r.paths.size).toBe(1);
  });

  it('another person’s commit that the loose filter matched is dropped', async () => {
    const other = '\x1eIan Hancocks\0someone@else.com\x002026-01-02T10:00:00+00:00\0clients/a/theirs.md\0';
    const r = await createMyChanges(fake({ log: other + LOG }).run).read(ROOT, ME);
    expect([...r.paths.keys()]).toEqual(['clients/a/x.md']);
  });
});
