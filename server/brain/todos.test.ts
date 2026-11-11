import { existsSync, promises as fsPromises, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createBrainReaders } from './index.ts';
import { copyFixture, person } from './test-helpers.ts';

const sam = person('sam-example', 'scout');

describe('todos', () => {
  it('splits mine, open and others, soonest first, ignoring done and archive', async () => {
    const brain = createBrainReaders(copyFixture());
    const list = await brain.todos(person('sam-example', 'scout'));
    // due 2026-11-20, surface 2026-11-05, surface 2026-10-10 => undated-by-due items use surfaceDate
    expect(list.mine.map((t) => t.id)).toEqual([
      '20261010-undated-thing.md',
      '20261105-send-report.md',
      '20261101-renew-contract.md',
    ]);
    expect(list.open.map((t) => t.id)).toEqual(['20261103-open-task.md']);
    expect(list.othersCount).toBe(1);
  });

  it('reads fields and falls back for the title', async () => {
    const brain = createBrainReaders(copyFixture());
    const list = await brain.todos(person('sam-example', 'scout'));
    const byId = Object.fromEntries(list.mine.map((t) => [t.id, t]));
    expect(byId['20261101-renew-contract.md']).toEqual({
      id: '20261101-renew-contract.md',
      title: 'Renew the Acme contract',
      assignee: 'sam-example',
      due: '2026-11-20',
      surfaceDate: '2026-11-01',
      project: 'renewals',
      client: 'acme-heating',
    });
    expect(byId['20261105-send-report.md']?.title).toBe('Send the monthly report');
    expect(byId['20261010-undated-thing.md']?.title).toBe('Undated thing');
    expect(byId['20261010-undated-thing.md']?.due).toBeNull();
  });

  it('completeTodo moves the file to done/ and records who ticked it and when', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root, { now: () => new Date('2026-11-11T17:07:38Z') });
    await brain.completeTodo('20261105-send-report.md', {
      ...person('sam-example', 'scout'),
      name: 'Sam Example',
    });
    expect(existsSync(join(root, 'todo', '20261105-send-report.md'))).toBe(false);
    const done = readFileSync(join(root, 'todo', 'done', '20261105-send-report.md'), 'utf8');
    expect(done).toBe(
      [
        '---',
        'assignee: sam-example',
        'status: done',
        'completed: 2026-11-11',
        'completed_at: 2026-11-11T17:07:38+00:00',
        'completed_by: sam-example',
        'completed_via: TDS Brain App',
        '---',
        '# Send the monthly report',
        '',
        '## Done 2026-11-11',
        '',
        'Ticked off by Sam Example at 17:07 UK time (TDS Brain App).',
        '',
      ].join('\n'),
    );
    const list = await brain.todos(person('sam-example', 'scout'));
    expect(list.mine.map((t) => t.id)).not.toContain('20261105-send-report.md');
  });

  it('completeTodo rejects unknown, path-like and protected ids', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    for (const id of [
      'nope.md',
      '../clients/northwind/profile.md',
      'done/20260101-finished.md',
      'AGENTS.md',
      'README.md',
      '',
      'notes.txt',
      '/etc/passwd',
    ]) {
      await expect(brain.completeTodo(id, sam)).rejects.toThrow(/to-do/i);
    }
    expect(existsSync(join(root, 'todo', 'AGENTS.md'))).toBe(true);
  });

  it('completeTodo refuses to overwrite an existing finished file', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    writeFileSync(join(root, 'todo', 'done', '20261105-send-report.md'), 'older');
    await expect(brain.completeTodo('20261105-send-report.md', sam)).rejects.toThrow(/already/i);
    expect(existsSync(join(root, 'todo', '20261105-send-report.md'))).toBe(true);
    expect(readFileSync(join(root, 'todo', 'done', '20261105-send-report.md'), 'utf8')).toBe('older');
    expect(readFileSync(join(root, 'todo', '20261105-send-report.md'), 'utf8')).toBe(
      '---\nassignee: sam-example\n---\n# Send the monthly report\n',
    );
  });

  it('completeTodo leaves the to-do open, and nothing in done/, if the open copy cannot be removed', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    const unlink = vi.spyOn(fsPromises, 'unlink').mockRejectedValueOnce(new Error('EPERM'));
    try {
      await expect(brain.completeTodo('20261105-send-report.md', sam)).rejects.toThrow('EPERM');
    } finally {
      unlink.mockRestore();
    }
    expect(readFileSync(join(root, 'todo', '20261105-send-report.md'), 'utf8')).toBe(
      '---\nassignee: sam-example\n---\n# Send the monthly report\n',
    );
    expect(existsSync(join(root, 'todo', 'done', '20261105-send-report.md'))).toBe(false);
  });

  it('gives an empty list when todo/ is missing', async () => {
    const list = await createBrainReaders('/nonexistent/brain').todos(person('a', 'team'));
    expect(list).toEqual({ mine: [], open: [], othersCount: 0 });
  });
});
