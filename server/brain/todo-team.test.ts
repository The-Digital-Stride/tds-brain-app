import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProjectsIndex } from './projects.ts';
import { copyFixture } from './test-helpers.ts';
import { readTeamTodo } from './todo-team.ts';

const fm = (lines: string[], body = '') => `---\n${lines.join('\n')}\n---\n${body}`;

describe('readTeamTodo', () => {
  it('reads a TDS task with the roster name, due date and files', async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, 'todo', '20261101-quote.md'),
      fm(
        ['title: Send the quote', 'assignee: alex-sample', 'due: 2026-12-01'],
        'Details here.\n\n[Brief](clients/acme/brief.md)\n',
      ),
    );
    const t = await readTeamTodo(root, '20261101-quote.md', 'sam-example');
    expect(t).toMatchObject({
      key: 'team:todo/20261101-quote.md',
      id: '20261101-quote.md',
      path: 'todo/20261101-quote.md',
      title: 'Send the quote',
      assignee: 'alex-sample',
      due: '2026-12-01',
    });
    expect(t?.assigneeName).toBeTruthy();
    expect(t?.details).toContain('Details here.');
    expect(t?.version).toMatch(/^[0-9a-f]{64}$/);
    expect(Array.isArray(t?.attachments)).toBe(true);
  });

  it('reports an unassigned task as open to anyone', async () => {
    const root = copyFixture();
    writeFileSync(join(root, 'todo', '20261101-open.md'), fm(['assignee: open'], 'Words\n'));
    const t = await readTeamTodo(root, '20261101-open.md', 'sam-example');
    expect(t).toMatchObject({ assignee: null, assigneeName: null });
  });

  it('refuses bad ids, personal paths, rule files and symlinks; null when missing', async () => {
    const root = copyFixture();
    mkdirSync(join(root, 'personal', 'todo'), { recursive: true });
    writeFileSync(join(root, 'personal', 'todo', 'mine.md'), fm(['assignee: sam-example']));
    writeFileSync(join(root, 'todo', 'AGENTS.md'), 'rules');
    writeFileSync(join(root, 'secret.md'), 'secret');
    symlinkSync(join(root, 'secret.md'), join(root, 'todo', 'link.md'));
    mkdirSync(join(root, 'todo', 'dir.md'));
    for (const id of [
      '../secret.md',
      '../personal/todo/mine.md',
      'personal/todo/mine.md',
      'done/x.md',
      '.hidden.md',
      'notmd.txt',
      '',
      'AGENTS.md',
      'link.md',
      'dir.md',
      'missing.md',
    ]) {
      expect(await readTeamTodo(root, id, 'sam-example'), id).toBeNull();
    }
  });
});

describe('readTeamTodo: restricted projects (plan 2026-11-27, decision 6)', () => {
  const SECRET = 'acme-heating/secret';
  const index: ProjectsIndex = {
    cards: [],
    byKey: () => null,
    keysForPath: () => [],
    resolve: (value) => (value === SECRET ? { how: 'restricted' } : { how: 'none' }),
    hiddenPath: (rel) => rel.startsWith('clients/acme-heating/projects/secret/'),
    hiddenKey: (key) => key === SECRET,
    hiddenCount: 1,
  };
  const task = (assignee: string) =>
    fm([`assignee: ${assignee}`, 'client: acme-heating', `project: ${SECRET}`, 'stage: Build'], 'Words\n');

  it("is not found for a teammate's task in a hidden project, and masked for one's own", async () => {
    const root = copyFixture();
    writeFileSync(join(root, 'todo', '20261120-alex.md'), task('alex-sample'));
    writeFileSync(join(root, 'todo', '20261120-sam.md'), task('sam-example'));
    const projects = async () => index;
    expect(await readTeamTodo(root, '20261120-alex.md', 'sam-example', { projects })).toBeNull();
    expect(await readTeamTodo(root, '20261120-sam.md', 'sam-example', { projects })).toMatchObject({
      project: null,
      stage: null,
      projectMatch: { how: 'restricted' },
    });
    // Without an index the task reads as before.
    expect(await readTeamTodo(root, '20261120-alex.md', 'sam-example')).toMatchObject({ project: SECRET });
  });

  it("is not found for a project-labelled teammate's task when the index can't be read", async () => {
    const root = copyFixture();
    writeFileSync(join(root, 'todo', '20261120-alex.md'), task('alex-sample'));
    writeFileSync(join(root, 'todo', '20261120-plain.md'), fm(['assignee: alex-sample'], 'Words\n'));
    const projects = async (): Promise<ProjectsIndex> => {
      throw new Error('no index');
    };
    expect(await readTeamTodo(root, '20261120-alex.md', 'sam-example', { projects })).toBeNull();
    expect(await readTeamTodo(root, '20261120-plain.md', 'sam-example', { projects })).not.toBeNull();
  });
});

describe('readTeamTodo: the timeline (task updates)', () => {
  it('sends updates, links, lastChange and createdAt', async () => {
    const root = copyFixture();
    writeFileSync(
      join(root, 'todo', '20261101-quote.md'),
      fm(
        ['assignee: alex-sample', 'created_at: 2026-11-01T09:00:00+00:00'],
        '# Quote\n\n## Files\n\n- [Spec](https://example.com/spec)\n\n## Updates\n\n- 27 Nov 2026, 14:05 UK: Alex Sample (alex-sample) wrote: Sent it.\n',
      ),
    );
    const t = await readTeamTodo(root, '20261101-quote.md', 'sam-example');
    expect(t).toMatchObject({
      createdAt: '2026-11-01T09:00:00+00:00',
      links: [{ url: 'https://example.com/spec', name: 'Spec' }],
      updatesMore: false,
      updateExtras: [],
      lastChange: { by: 'alex-sample', byName: 'Alex Sample', action: 'update' },
    });
    expect(t?.updates).toHaveLength(1);
    expect(t?.updates?.[0]).toMatchObject({ kind: 'note', by: 'alex-sample', text: 'Sent it.' });
  });
});
