import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyFixture } from './test-helpers.ts';
import { readTeamTodo } from './todo-team.ts';

const fm = (lines: string[], body = '') => `---\n${lines.join('\n')}\n---\n${body}`;

describe('readTeamTodo', () => {
  it('reads a TDS to-do with the roster name, due date and files', async () => {
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

  it('reports an unassigned to-do as open to anyone', async () => {
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
