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
