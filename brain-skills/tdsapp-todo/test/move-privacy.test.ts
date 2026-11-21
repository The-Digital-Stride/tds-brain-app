// v0.6 `move` (plan 2026-11-20-projects-system, decision 8, overseer B2): a personal to-do in a
// personal project never reaches todo/ (and so git) with its private project name on it.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Brain, makeBrain } from './helpers.ts';

let b: Brain;
beforeEach(() => {
  b = makeBrain();
  b.folder('personal/projects/jev');
});
afterEach(() => b.remove());

const MINE = [
  '---',
  'assignee: sam-example',
  'title: Train the bot',
  'created: 2026-11-01',
  'project: personal/jev',
  'stage: Ideas',
  'x_other: kept',
  '---',
  '',
  'Details.',
  '',
].join('\n');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('move to TDS from a personal project', () => {
  it('is refused without dropProject, leaving the to-do where it was', () => {
    b.put('personal/todo/a.md', MINE);
    expect(b.run('move', { file: 'a.md', scope: 'personal', to: 'tds', by: 'sam-example' })).toEqual({
      code: 2,
      json: {
        error: 'this to-do is in a personal project: moving it to the team takes it out of that project',
        status: 403,
      },
    });
    expect(b.read('personal/todo/a.md')).toBe(MINE);
    expect(existsSync(join(b.root, 'todo', 'a.md'))).toBe(false);
  });

  it('with dropProject, moves a copy without its project: and stage: lines', () => {
    b.put('personal/todo/a.md', MINE);
    const r = b.run('move', {
      file: 'a.md',
      scope: 'personal',
      to: 'tds',
      by: 'sam-example',
      dropProject: true,
    });
    expect(r).toEqual({ code: 0, json: { ok: true, file: 'a.md', moved: join('todo', 'a.md') } });
    expect(b.read('todo/a.md')).toBe(MINE.replace('project: personal/jev\nstage: Ideas\n', ''));
    expect(existsSync(join(b.root, 'personal', 'todo', 'a.md'))).toBe(false);
  });

  it('drops a quoted personal key too', () => {
    b.put('personal/todo/a.md', MINE.replace('project: personal/jev', 'project: "personal/jev"'));
    expect(b.run('move', { file: 'a.md', scope: 'personal', to: 'tds', by: 'sam-example' }).json.status).toBe(
      403,
    );
  });

  it('refuses a dropProject that is not true', () => {
    b.put('personal/todo/a.md', MINE);
    expect(
      b.run('move', { file: 'a.md', scope: 'personal', to: 'tds', by: 'sam-example', dropProject: 'yes' })
        .json.status,
    ).toBe(400);
    expect(b.read('personal/todo/a.md')).toBe(MINE);
  });
});

describe('moves that keep every byte', () => {
  it('a personal to-do in a shared project, or with no project, even with dropProject', () => {
    const shared = MINE.replace('project: personal/jev', 'project: acme/website');
    b.put('personal/todo/a.md', shared);
    expect(b.run('move', { file: 'a.md', scope: 'personal', to: 'tds', by: 'sam-example' }).code).toBe(0);
    expect(sha(b.read('todo/a.md'))).toBe(sha(shared));
    const plain = MINE.replace('project: personal/jev\nstage: Ideas\n', '');
    b.put('personal/todo/b.md', plain);
    expect(
      b.run('move', { file: 'b.md', scope: 'personal', to: 'tds', by: 'sam-example', dropProject: true })
        .code,
    ).toBe(0);
    expect(b.read('todo/b.md')).toBe(plain);
  });

  it('a TDS to-do made personal', () => {
    const tds = MINE.replace('project: personal/jev', 'project: acme/website');
    b.put('todo/a.md', tds);
    expect(b.run('move', { file: 'a.md', to: 'personal', by: 'sam-example' }).code).toBe(0);
    expect(b.read('personal/todo/a.md')).toBe(tds);
  });
});

// Review fix (release 1): the app's reader is lenient, so the script must be too, and a link into a
// personal project leaks its name as surely as a `project:` line.
describe('move to TDS: every form of a personal project, and its files', () => {
  const plain = MINE.replace('project: personal/jev\nstage: Ideas\n', '');
  const withProject = (lines: string) => plain.replace('x_other: kept\n', `x_other: kept\n${lines}`);
  const move = (extra: Record<string, unknown> = {}) =>
    b.run('move', { file: 'a.md', scope: 'personal', to: 'tds', by: 'sam-example', ...extra });

  it.each([
    ['a space before the colon', 'project : personal/jev\n'],
    ['a bare slug of a personal project', 'project: jev\n'],
    ['a bare slug in capitals', 'project: Jev\n'],
    ['a block list', 'project:\n  - personal/jev\n'],
    ['a block list with a blank line', 'project:\n\n  - "jev"\n'],
    ['an inline list', 'project: [acme/website, personal/jev]\n'],
    ['spaces round the slash', 'project: personal / jev\n'],
  ])('refuses %s without dropProject, and drops every line of it with', (_, lines) => {
    b.put('personal/todo/a.md', withProject(`${lines}stage: Ideas\n`));
    expect(move().json.status).toBe(403);
    expect(existsSync(join(b.root, 'todo', 'a.md'))).toBe(false);
    expect(move({ dropProject: true }).code).toBe(0);
    expect(b.read('todo/a.md')).toBe(plain);
  });

  it('lets a bare slug that is no personal project through, bytes kept', () => {
    const text = withProject('project: website\n');
    b.put('personal/todo/a.md', text);
    expect(move().code).toBe(0);
    expect(b.read('todo/a.md')).toBe(text);
  });

  it('with dropProject, drops project: and stage: whatever they hold, a shared key included', () => {
    b.put('personal/todo/a.md', withProject('project:   acme/website \nStage :  Build\n'));
    expect(move({ dropProject: true }).code).toBe(0);
    expect(b.read('todo/a.md')).toBe(plain);
  });

  const FILES = [
    '## Files',
    '',
    "- [plan.md](../../personal/projects/jev/plan.md) (only on sam-example's Mac)",
    '- [quote.pdf](../../clients/acme/files/quote.pdf)',
    "- [My notes.pdf](<../../personal/files/My notes.pdf>) (only on sam-example's Mac)",
    '',
  ].join('\n');

  it('refuses a to-do linking a file in a personal project, and drops only that line with dropProject', () => {
    b.put('personal/todo/a.md', `${plain}\n${FILES}`);
    const r = move();
    expect(r.json).toEqual({
      error: 'this to-do links a file in a personal project: moving it to the team takes that link off',
      status: 403,
    });
    expect(move({ dropProject: true }).code).toBe(0);
    expect(b.read('todo/a.md')).toBe(
      `${plain}\n${FILES.replace("- [plan.md](../../personal/projects/jev/plan.md) (only on sam-example's Mac)\n", '')}`,
    );
  });

  it('drops the Files section once nothing is left in it', () => {
    const only =
      '## Files\n\n- [plan.md](<../../personal/projects/jev/My plan.md>)\n\n## Title history\n\n- old\n';
    b.put('personal/todo/a.md', `${plain}\n${only}`);
    expect(move({ dropProject: true }).code).toBe(0);
    expect(b.read('todo/a.md')).toBe(`${plain}\n## Title history\n\n- old\n`);
  });

  it('keeps a CRLF to-do CRLF when it drops lines', () => {
    b.put('personal/todo/a.md', MINE.replace(/\n/g, '\r\n'));
    expect(move({ dropProject: true }).code).toBe(0);
    expect(b.read('todo/a.md')).toBe(plain.replace(/\n/g, '\r\n'));
  });
});
