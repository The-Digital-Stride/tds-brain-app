import { describe, expect, it } from 'vitest';
import { createTodoHistory, GIT_MAX_PARALLEL, type GitRunner, gitEnv, historyArgs } from './todo-history.ts';

const OUT = 'Ben McAdam\0ben@example.test\x002026-11-12T10:30:00+00:00\n';

describe('todo history', () => {
  it('asks git for the last commit that touched the assignee line, in the brain, no shell', async () => {
    const seen: { args: readonly string[]; cwd: string }[] = [];
    const run: GitRunner = async (args, cwd) => {
      seen.push({ args, cwd });
      return OUT;
    };
    const author = await createTodoHistory(run).lastAssigneeEdit('/brain', 'a.md', 'v1');
    expect(author).toEqual({
      name: 'Ben McAdam',
      email: 'ben@example.test',
      at: '2026-11-12T10:30:00+00:00',
      addsStamp: false,
    });
    expect(seen).toEqual([{ args: historyArgs('a.md'), cwd: '/brain' }]);
    expect(historyArgs('a.md')).toEqual([
      'log',
      '-n',
      '1',
      '-G',
      '^assignee:',
      '-p',
      '--no-ext-diff',
      '--no-textconv',
      '--format=%an%x00%ae%x00%aI',
      '--',
      'todo/a.md',
    ]);
  });

  it('caches by id and version, including nulls, and asks again for a new version', async () => {
    let calls = 0;
    const run: GitRunner = async () => {
      calls += 1;
      if (calls === 1) throw new Error('not a git repo');
      return OUT;
    };
    const h = createTodoHistory(run);
    expect(await h.lastAssigneeEdit('/b', 'a.md', 'v1')).toBeNull();
    expect(await h.lastAssigneeEdit('/b', 'a.md', 'v1')).toBeNull();
    expect(calls).toBe(1);
    expect((await h.lastAssigneeEdit('/b', 'a.md', 'v2'))?.name).toBe('Ben McAdam');
    expect(calls).toBe(2);
  });

  it('is null for empty or unreadable output', async () => {
    for (const out of ['', '\n', 'Ben\0b@x\0not-a-date', '\0\0']) {
      expect(await createTodoHistory(async () => out).lastAssigneeEdit('/b', 'a.md', 'v')).toBeNull();
    }
  });

  it('runs at most four at a time', async () => {
    let active = 0;
    let peak = 0;
    const run: GitRunner = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return OUT;
    };
    const h = createTodoHistory(run);
    await Promise.all(Array.from({ length: 12 }, (_, i) => h.lastAssigneeEdit('/b', `f${i}.md`, 'v')));
    expect(peak).toBe(GIT_MAX_PARALLEL);
  });

  it('sees whether the commit patch adds an assigned_at line', async () => {
    const patch = `${OUT}\ndiff --git a/todo/a.md b/todo/a.md\n--- a/todo/a.md\n+++ b/todo/a.md\n@@ -1 +1,2 @@\n-assignee: x\n+assignee: y\n+assigned_at: 2026-11-12T10:30:00+00:00\n`;
    expect((await createTodoHistory(async () => patch).lastAssigneeEdit('/b', 'a.md', 'v'))?.addsStamp).toBe(
      true,
    );
  });

  it('removes every GIT_ variable from the environment git runs with', () => {
    process.env.GIT_DIR = '/elsewhere';
    process.env.git_ssh_command = 'evil';
    try {
      const env = gitEnv();
      expect(Object.keys(env).filter((k) => k.toUpperCase().startsWith('GIT_'))).toEqual([
        'GIT_OPTIONAL_LOCKS',
      ]);
    } finally {
      delete process.env.GIT_DIR;
      delete process.env.git_ssh_command;
    }
  });

  it('says what is cached', async () => {
    const h = createTodoHistory(async () => OUT);
    expect(h.isCached('/b', 'a.md', 'v')).toBe(false);
    await h.lastAssigneeEdit('/b', 'a.md', 'v');
    expect(h.isCached('/b', 'a.md', 'v')).toBe(true);
  });
});
