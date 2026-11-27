// v0.7 (plan docs/plans/2026-11-27-task-updates-handback.md, decisions 1-7, 5a, 11 and 14; contract
// shared/todo-updates-contract.ts): the "## Updates" log, update, link and unlink, note and back on
// assignee, note on tick, one entry per real change, created_at on add, and union-merge robustness.
// Each case runs the real script against a throwaway brain. This stays in the app repo.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseTodoFiles,
  parseTodoLinks,
  splitTodoFiles,
  todoFileExtras,
} from '../../../shared/todo-files.ts';
import {
  isTodoLinkUrl,
  linesOutsideFences,
  parseTodoHandovers,
  parseTodoUpdates,
  splitTodoSections,
  todoTimeline,
  ukWallToIso,
} from '../../../shared/todo-updates.ts';
import type { TodoUpdate } from '../../../shared/todo-updates-contract.ts';
import {
  TODO_LINK_NAME_MAX,
  TODO_LINKS_CAPABILITY,
  TODO_LINKS_MAX,
  TODO_UPDATE_MAX,
  TODO_UPDATES_CAPABILITY,
} from '../../../shared/todo-updates-contract.ts';
import { type Brain, makeBrain, SCRIPT, withoutLog } from './helpers.ts';

const require = createRequire(import.meta.url);
const workbench = require('../test-fixtures/workbench-parser.cjs') as {
  parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string };
};
const reminders = require('../test-fixtures/reminders-sync-parser.cjs') as {
  parse(content: string): { fm: Record<string, string> };
  titleOf(content: string, file: string): string;
};

// The script's own readers, loaded in this process without running a command.
(globalThis as Record<string, unknown>).TDSAPP_TODO_LIBRARY = true;
const lib = require('../scripts/tdsapp-todo.cjs') as {
  parseUpdates(body: string): { entries: TodoUpdate[]; extras: string[] };
  parseHandovers(body: string): TodoUpdate[];
  timeline(body: string): { updates: TodoUpdate[]; extras: string[] };
  splitSections(body: string): { details: string; handover: string; files: string; updates: string };
  isLinkUrl(url: string): boolean;
  ukWallToIso(date: string, time: string): string | null;
  parseLinks(body: string): { url: string; name: string }[];
  fileExtras(body: string): string[];
  parseFiles(body: string): unknown[];
  splitFiles(body: string): { details: string; files: string };
};

const fixture = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const UPDATES = fixture('../../../shared/todo-updates.fixtures.json') as {
  updates: { name: string; body: string; entries: TodoUpdate[]; extras: string[] }[];
  handovers: { name: string; body: string; entries: TodoUpdate[] }[];
  timeline: { name: string; body: string; updates: TodoUpdate[]; extras: string[] }[];
  split: { name: string; body: string; details: string; handover: string; files: string; updates: string }[];
  linkUrl: { url: string; ok: boolean }[];
  ukWall: { date: string; time: string; iso: string | null }[];
};
const FILES = fixture('../../../shared/todo-files.fixtures.json') as {
  parse: { name: string; body: string; files: unknown[] }[];
  split: { name: string; body: string; details: string; files: string }[];
  links: { name: string; body: string; links: { url: string; name: string }[]; extras: string[] }[];
};

// A fixed clock: 14:05 UK on 27 Nov 2026 (GMT) unless a case says otherwise.
const clock = (iso = '2026-11-27T14:05:00Z') => ({ NODE_ENV: 'test', TDSAPP_TODO_TEST_NOW: iso });
const NOW = '27 Nov 2026, 14:05 UK';
const SAM = 'Sam Example (sam-example)';
const BEN = 'Ben McAdam (ben-mcadam)';
const APP = { by: 'sam-example', by_name: 'Sam Example', via: 'TDS Cortex' };

const TASK = [
  '---',
  'assignee: sam-example',
  'title: Send the quote',
  'created: 2026-11-01',
  'created_by: ben-mcadam',
  '---',
  '',
  'Ring the client.',
  '',
].join('\n');

let b: Brain;
beforeEach(() => {
  b = makeBrain();
});
afterEach(() => b.remove());

const run = (command: string, input: Record<string, unknown>, env = clock()) => b.run(command, input, env);
const raw = (rel = 'todo/a.md') => b.raw(rel);
const entries = (rel = 'todo/a.md') => parseTodoUpdates(raw(rel)).entries;
const updatesSection = (rel = 'todo/a.md') =>
  splitTodoSections(raw(rel).replace(/^---\n[\s\S]*?\n---\n/, '')).updates;

describe('v0.7: both readers agree (shared/todo-updates.fixtures.json, shared/todo-files.fixtures.json)', () => {
  it.each(UPDATES.updates.map((c) => [c.name, c] as const))('updates: %s', (_, c) => {
    expect(lib.parseUpdates(c.body)).toEqual({ entries: c.entries, extras: c.extras });
    expect(parseTodoUpdates(c.body)).toEqual({ entries: c.entries, extras: c.extras });
  });
  it.each(UPDATES.handovers.map((c) => [c.name, c] as const))('handovers: %s', (_, c) => {
    expect(lib.parseHandovers(c.body)).toEqual(c.entries);
    expect(parseTodoHandovers(c.body)).toEqual(c.entries);
  });
  it.each(UPDATES.timeline.map((c) => [c.name, c] as const))('timeline: %s', (_, c) => {
    expect(lib.timeline(c.body)).toEqual({ updates: c.updates, extras: c.extras });
    expect(todoTimeline(c.body)).toEqual({ updates: c.updates, extras: c.extras });
  });
  it.each(UPDATES.split.map((c) => [c.name, c] as const))('split: %s', (_, c) => {
    const want = { details: c.details, handover: c.handover, files: c.files, updates: c.updates };
    expect(lib.splitSections(c.body)).toEqual(want);
    expect(splitTodoSections(c.body)).toEqual(want);
  });
  it('link URLs', () => {
    for (const c of UPDATES.linkUrl) {
      expect(lib.isLinkUrl(c.url), c.url).toBe(c.ok);
      expect(isTodoLinkUrl(c.url), c.url).toBe(c.ok);
    }
  });
  it('UK wall times', () => {
    for (const c of UPDATES.ukWall) {
      expect(lib.ukWallToIso(c.date, c.time), `${c.date} ${c.time}`).toBe(c.iso);
      expect(ukWallToIso(c.date, c.time), `${c.date} ${c.time}`).toBe(c.iso);
    }
  });
  it.each(FILES.links.map((c) => [c.name, c] as const))('links: %s', (_, c) => {
    expect(lib.parseLinks(c.body)).toEqual(c.links);
    expect(parseTodoLinks(c.body)).toEqual(c.links);
    expect(lib.fileExtras(c.body)).toEqual(c.extras);
    expect(todoFileExtras(c.body)).toEqual(c.extras);
  });
  it('files and split (every ## Files section)', () => {
    for (const c of FILES.parse) {
      expect(lib.parseFiles(c.body), c.name).toEqual(c.files);
      expect(parseTodoFiles(c.body), c.name).toEqual(c.files);
    }
    for (const c of FILES.split) {
      expect(lib.splitFiles(c.body), c.name).toEqual({ details: c.details, files: c.files });
      expect(splitTodoFiles(c.body), c.name).toEqual({ details: c.details, files: c.files });
    }
  });
});

describe('v0.7: capabilities', () => {
  it('lists updates-v1 and links-v1, version 0.7', () => {
    const r = run('capabilities', {});
    expect(r.json.version).toBe('0.7');
    expect(r.json.features).toEqual(
      expect.arrayContaining([TODO_UPDATES_CAPABILITY, TODO_LINKS_CAPABILITY, 'handover', 'attach']),
    );
  });
});

describe('v0.7: update', () => {
  it('appends a note at the end of the details, with the UK time, name and slug', () => {
    b.put('todo/a.md', TASK);
    expect(run('update', { file: 'a.md', text: 'Sent the quote.', ...APP })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md' },
    });
    expect(raw()).toBe(`${TASK}\n## Updates\n\n- ${NOW}: ${SAM} wrote: Sent the quote.\n`);
  });

  it('writes further lines indented by two spaces, normalising the text first', () => {
    b.put('todo/a.md', TASK);
    run('update', { file: 'a.md', text: '\r\n  First line  \r\n\r\n\tindented\rlast \n', ...APP });
    expect(updatesSection()).toBe(`## Updates\n\n- ${NOW}: ${SAM} wrote: First line\n   indented\n  last`);
    expect(entries()[0]?.text).toBe('First line\n indented\nlast');
  });

  it('appends to the section that is there, in BST in summer', () => {
    b.put('todo/a.md', TASK);
    run('update', { file: 'a.md', text: 'One', ...APP });
    run(
      'update',
      { file: 'a.md', text: 'Two', by: 'ben-mcadam', by_name: 'Ben (McAdam)' },
      clock('2027-06-01T08:30:00Z'),
    );
    expect(updatesSection()).toBe(
      `## Updates\n\n- ${NOW}: ${SAM} wrote: One\n- 1 Jun 2027, 09:30 UK: ${BEN} wrote: Two`,
    );
    expect(entries().map((e) => [e.at, e.byName, e.text])).toEqual([
      ['2026-11-27T14:05:00+00:00', 'Sam Example', 'One'],
      ['2027-06-01T09:30:00+01:00', 'Ben McAdam', 'Two'],
    ]);
  });

  it('uses the git user when no by is sent, and works on a personal to-do', () => {
    b.put('personal/todo/a.md', TASK);
    expect(run('update', { file: 'a.md', scope: 'personal', text: 'Mine.' }).code).toBe(0);
    expect(entries('personal/todo/a.md')).toMatchObject([{ kind: 'note', by: 'sam-example', text: 'Mine.' }]);
  });

  it.each([
    ['not text', { text: 42 }, 'text must be text'],
    ['missing', {}, 'text must be text'],
    ['empty after normalising', { text: ' \n\t\r\n ' }, 'text is required'],
    [
      'too long',
      { text: 'x'.repeat(TODO_UPDATE_MAX + 1) },
      `text is too long (over ${TODO_UPDATE_MAX} characters)`,
    ],
    ['a control character', { text: 'bell\u0007' }, "text can't hold control characters"],
    ['a code fence', { text: 'Look:\n  ```\ncode' }, "an update can't hold a code block"],
    ['a tilde fence', { text: '~~~' }, "an update can't hold a code block"],
  ])('refuses %s (400), writing nothing', (_, extra, error) => {
    b.put('todo/a.md', TASK);
    expect(run('update', { file: 'a.md', ...extra })).toEqual({ code: 2, json: { error, status: 400 } });
    expect(raw()).toBe(TASK);
  });

  it('takes exactly the limit, and refuses a missing to-do (404) and a stale expect (409)', () => {
    b.put('todo/a.md', TASK);
    expect(run('update', { file: 'a.md', text: 'x'.repeat(TODO_UPDATE_MAX) }).code).toBe(0);
    expect(run('update', { file: 'gone.md', text: 'x' }).json.status).toBe(404);
    expect(run('update', { file: 'a.md', text: 'x', expect: 'a'.repeat(64) }).json.status).toBe(409);
  });
});

describe('v0.7: link and unlink', () => {
  it('adds a link to ## Files, named after the host, and logs it', () => {
    b.put('todo/a.md', TASK);
    expect(run('link', { file: 'a.md', url: 'https://www.example.com/spec', ...APP })).toEqual({
      code: 0,
      json: {
        ok: true,
        file: 'a.md',
        url: 'https://www.example.com/spec',
        name: 'example.com',
        changed: true,
      },
    });
    expect(raw()).toBe(
      `${TASK}\n## Files\n\n- [example.com](https://www.example.com/spec)\n\n## Updates\n\n- ${NOW}: ${SAM} added a link: example.com (TDS Cortex).\n`,
    );
    expect(parseTodoLinks(raw())).toEqual([{ url: 'https://www.example.com/spec', name: 'example.com' }]);
  });

  it('puts a URL holding a bracket in <…>, keeps the name sent, and reads back the same', () => {
    b.put('todo/a.md', TASK);
    run('link', { file: 'a.md', url: 'https://example.com/spec_(v2)', name: '  Spec (v2)  ' });
    expect(raw()).toContain('\n- [Spec (v2)](<https://example.com/spec_(v2)>)\n');
    expect(parseTodoLinks(raw())).toEqual([{ url: 'https://example.com/spec_(v2)', name: 'Spec (v2)' }]);
    expect(entries()[0]?.text).toBe('added a link: Spec (v2)');
  });

  it('sits beside files: a new ## Files section goes before the ## Updates section', () => {
    b.put('todo/a.md', TASK);
    run('update', { file: 'a.md', text: 'First.' });
    run('link', { file: 'a.md', url: 'https://example.com/a' });
    expect(raw().indexOf('## Files')).toBeLessThan(raw().indexOf('## Updates'));
    expect(raw().match(/## /g)).toHaveLength(2);
  });

  it('is a no-op for a URL already linked, writing nothing', () => {
    b.put('todo/a.md', TASK);
    run('link', { file: 'a.md', url: 'https://example.com/a', name: 'A' });
    const before = b.sha('todo/a.md');
    expect(run('link', { file: 'a.md', url: 'https://example.com/a', name: 'Other' }).json).toEqual({
      ok: true,
      file: 'a.md',
      url: 'https://example.com/a',
      name: 'A',
      changed: false,
    });
    expect(b.sha('todo/a.md')).toBe(before);
  });

  it(`refuses link ${TODO_LINKS_MAX + 1}, whatever files there are`, () => {
    b.put('clients/acme/files/q.pdf', 'x');
    b.put('todo/a.md', TASK);
    run('attach', { file: 'a.md', path: 'clients/acme/files/q.pdf' });
    for (let i = 0; i < TODO_LINKS_MAX; i++) {
      expect(run('link', { file: 'a.md', url: `https://example.com/${i}` }).code).toBe(0);
    }
    const before = b.sha('todo/a.md');
    expect(run('link', { file: 'a.md', url: 'https://example.com/more' }).json).toEqual({
      error: `a to-do can have at most ${TODO_LINKS_MAX} links`,
      status: 400,
    });
    expect(b.sha('todo/a.md')).toBe(before);
  });

  it.each([
    ['no url', {}, 'url is required'],
    ['a web address that is not http(s)', { url: 'ftp://example.com/a' }, 'BAD_URL'],
    ['a URL with a space', { url: 'https://example.com/a b' }, 'BAD_URL'],
    ['a URL without //', { url: 'http:example.com' }, 'BAD_URL'],
    [
      'a name with a square bracket',
      { url: 'https://example.com/a', name: 'a [b]' },
      'name can\'t hold "[" or "]"',
    ],
    ['a name on two lines', { url: 'https://example.com/a', name: 'a\nb' }, 'name must be one line'],
    ['a name that is not text', { url: 'https://example.com/a', name: 7 }, 'name must be text'],
    [
      'a name that is too long',
      { url: 'https://example.com/a', name: 'n'.repeat(TODO_LINK_NAME_MAX + 1) },
      `name is too long (over ${TODO_LINK_NAME_MAX} characters)`,
    ],
  ])('link refuses %s (400), writing nothing', (_, extra, error) => {
    b.put('todo/a.md', TASK);
    const r = run('link', { file: 'a.md', ...extra });
    expect(r.code).toBe(2);
    expect(r.json.status).toBe(400);
    if (error === 'BAD_URL')
      expect(r.json.error).toMatch(/^url must be an http:\/\/ or https:\/\/ web address/);
    else expect(r.json.error).toBe(error);
    expect(raw()).toBe(TASK);
  });

  it('unlink removes every line linking that exact URL, the section once empty, and logs once', () => {
    b.put(
      'todo/a.md',
      `${TASK}\n## Files\n\n- [A](https://example.com/a)\n* [A again](https://example.com/a)\n`,
    );
    expect(run('unlink', { file: 'a.md', url: 'https://example.com/a', ...APP })).toEqual({
      code: 0,
      json: { ok: true, file: 'a.md', url: 'https://example.com/a', changed: true },
    });
    expect(raw()).toBe(`${TASK}\n## Updates\n\n- ${NOW}: ${SAM} removed a link: A (TDS Cortex).\n`);
  });

  it('unlink keeps other links, files and notes, and is a no-op for a URL not linked', () => {
    const text = `${TASK}\n## Files\n\n- [A](https://example.com/a)\n- [B](https://example.com/b)\nA note.\n`;
    b.put('todo/a.md', text);
    expect(run('unlink', { file: 'a.md', url: 'https://example.com/c' }).json.changed).toBe(false);
    expect(raw()).toBe(text);
    run('unlink', { file: 'a.md', url: 'https://example.com/a' });
    expect(parseTodoLinks(raw())).toEqual([{ url: 'https://example.com/b', name: 'B' }]);
    expect(todoFileExtras(raw())).toEqual(['A note.']);
    expect(run('unlink', { file: 'a.md', url: 'not a url' }).json.status).toBe(400);
  });
});

describe('v0.7: note and back on assignee, note on tick', () => {
  it('passes it on with a note, in the same write: a handover line and a note entry', () => {
    b.put('todo/a.md', TASK);
    expect(run('assignee', { file: 'a.md', assignee: 'ben-mcadam', note: 'Over to you.', ...APP }).code).toBe(
      0,
    );
    const text = raw();
    expect(text).toContain('\nassigned_to: ben-mcadam\n');
    expect(text).not.toContain('assigned_back');
    expect(text).toContain(`\n## Updates\n\n- ${NOW}: ${SAM} wrote: Over to you.\n\n## Handover history\n`);
    expect(text).toContain(`- ${NOW}: Sam Example passed it from sam-example to ben-mcadam (TDS Cortex).`);
  });

  it('hands it back: assigned_back: true and "handed it back to"; a later pass-on drops the mark', () => {
    b.put('todo/a.md', TASK.replace('assignee: sam-example', 'assignee: ben-mcadam'));
    const back = { file: 'a.md', assignee: 'sam-example', back: true, note: 'Done my part.' };
    expect(
      run('assignee', { ...back, by: 'ben-mcadam', by_name: 'Ben McAdam', via: 'TDS Cortex' }).code,
    ).toBe(0);
    let text = raw();
    expect(text).toContain('\nassigned_from: ben-mcadam\nassigned_back: true\nassigned_via: TDS Cortex\n');
    expect(parseTodoHandovers(text)).toMatchObject([
      { text: 'handed it back to sam-example', action: 'handback' },
    ]);
    expect(parseTodoUpdates(text).entries).toMatchObject([
      { kind: 'note', by: 'ben-mcadam', text: 'Done my part.' },
    ]);
    run('assignee', { file: 'a.md', assignee: 'ben-mcadam', ...APP });
    text = raw();
    expect(text).not.toContain('assigned_back');
    expect(text.match(/^assigned_to:/gm)).toHaveLength(1);
  });

  it('a hand back with no change is a no-op, like any pass-on', () => {
    b.put('todo/a.md', TASK);
    expect(run('assignee', { file: 'a.md', assignee: 'sam-example', back: true }).code).toBe(0);
    expect(raw()).toBe(TASK);
  });

  it.each([
    [
      'a note to whoever has it already',
      { assignee: 'sam-example', note: 'Hi' },
      'nothing to pass on: the to-do is already with sam-example',
    ],
    ['back that is not true', { assignee: 'ben-mcadam', back: 'yes' }, 'back must be true'],
    ['a hand back to nobody', { assignee: '', back: true }, 'a to-do can only be handed back to a person'],
    ['an empty note', { assignee: 'ben-mcadam', note: '  ' }, 'note is required'],
    [
      'a note with a code block',
      { assignee: 'ben-mcadam', note: '```' },
      "an update can't hold a code block",
    ],
  ])('assignee refuses %s (400), writing nothing', (_, extra, error) => {
    b.put('todo/a.md', TASK);
    expect(run('assignee', { file: 'a.md', ...extra })).toEqual({ code: 2, json: { error, status: 400 } });
    expect(raw()).toBe(TASK);
  });

  it('a note to an open to-do that stays open is refused too', () => {
    const open = TASK.replace('assignee: sam-example\n', '');
    b.put('todo/a.md', open);
    expect(run('assignee', { file: 'a.md', assignee: '', note: 'Hi' }).json).toEqual({
      error: 'nothing to pass on: the to-do is already open to anyone',
      status: 400,
    });
    expect(raw()).toBe(open);
  });

  it('tick with a note writes it under ## Updates in the done copy, before the done record', () => {
    b.put('todo/a.md', TASK);
    const r = run('tick', { file: 'a.md', note: 'All sent.', ...APP });
    expect(r.code).toBe(0);
    const done = raw('todo/done/a.md');
    expect(done).toContain(`\n## Updates\n\n- ${NOW}: ${SAM} wrote: All sent.\n\n## Done 2026-11-27\n`);
    expect(done).toContain('\ncompleted_by: sam-example\n');
    expect(existsSync(join(b.root, 'todo', 'a.md'))).toBe(false);
  });

  it('tick refuses a bad note, leaving the to-do where it was; without a note it is unchanged from 0.6', () => {
    b.put('todo/a.md', TASK);
    expect(run('tick', { file: 'a.md', note: '' }).json).toEqual({ error: 'note is required', status: 400 });
    expect(raw()).toBe(TASK);
    run('tick', { file: 'a.md' });
    expect(raw('todo/done/a.md')).not.toContain('## Updates');
  });
});

describe('v0.7: exactly one entry per real change, and nothing written for a no-op', () => {
  beforeEach(() => {
    b.put('clients/acme/files/quote.pdf', 'x');
    b.folder('clients/acme/projects/website');
    b.put('todo/a.md', TASK);
  });

  const steps: [string, Record<string, unknown>, string][] = [
    ['edit', { title: 'Send the quote today' }, 'changed the title'],
    ['edit', { title: 'Send the quote today', body: 'Ring them first.' }, 'changed the details'],
    ['edit', { title: 'Quote', body: 'Ring them first, then email.' }, 'changed the title and the details'],
    ['due', { due: '2026-12-01' }, 'set the due date to 1 Dec 2026'],
    ['due', { due: '2026-12-03' }, 'changed the due date from 1 Dec 2026 to 3 Dec 2026'],
    ['due', { due: null }, 'cleared the due date (it was 3 Dec 2026)'],
    ['attach', { path: 'clients/acme/files/quote.pdf' }, 'added a file: quote.pdf'],
    ['link', { url: 'https://example.com/a', name: 'Spec' }, 'added a link: Spec'],
    ['unlink', { url: 'https://example.com/a' }, 'removed a link: Spec'],
    ['detach', { path: 'clients/acme/files/quote.pdf' }, 'removed a file: quote.pdf'],
    ['project', { client: 'acme', project: 'acme/website', stage: 'Build' }, 'changed the project'],
    ['project', { client: null, project: null, stage: null }, 'changed the project'],
    ['update', { text: 'Done.' }, 'Done.'],
  ];

  it('each command adds one entry with its own words, then the same call again adds none', () => {
    let count = 0;
    for (const [command, input, words] of steps) {
      const r = run(command, { file: 'a.md', ...input, ...APP });
      expect(r.code, `${command} ${JSON.stringify(input)}`).toBe(0);
      count++;
      const list = entries();
      expect(list, command).toHaveLength(count);
      expect(list[count - 1], command).toMatchObject({
        by: 'sam-example',
        byName: 'Sam Example',
        text: words,
        via: command === 'update' ? null : 'TDS Cortex',
        at: '2026-11-27T14:05:00+00:00',
      });
      if (command === 'update') continue;
      const before = b.sha('todo/a.md');
      // An app sends back the details it was given (the title history in them).
      const again = command === 'edit' && 'body' in input ? { ...input, body: r.json.body } : input;
      run(command, { file: 'a.md', ...again, ...APP });
      expect(b.sha('todo/a.md'), `${command} again`).toBe(before);
    }
    expect(updatesSection().match(/^## Updates$/gm)).toHaveLength(1);
  });

  it('a pass-on and an add write no ## Updates entry (their own records instead)', () => {
    run('assignee', { file: 'a.md', assignee: 'ben-mcadam' });
    expect(raw()).not.toContain('## Updates');
    const added = run('add', { title: 'New one', body: 'Details.' });
    expect(raw(`todo/${added.json.file}`)).not.toContain('## Updates');
  });

  it('the old callers (no by, by_name or via) are logged as the git user and the todo skill', () => {
    run('due', { file: 'a.md', due: '2026-12-01' });
    expect(raw()).toContain(`- ${NOW}: ${SAM} set the due date to 1 Dec 2026 (todo skill).`);
  });
});

describe('v0.7: a personal to-do never names a file or a link; the project entry never names anything', () => {
  it('logs the action only', () => {
    b.put('personal/files/secret plan.pdf', 'x');
    b.folder('personal/projects/jev');
    b.put('personal/todo/a.md', TASK);
    const p = { file: 'a.md', scope: 'personal', ...APP };
    run('attach', { ...p, path: 'personal/files/secret plan.pdf' });
    run('link', { ...p, url: 'https://example.com/private', name: 'Private doc' });
    run('project', { ...p, client: null, project: 'personal/jev', stage: 'Ideas' });
    run('unlink', { ...p, url: 'https://example.com/private' });
    run('detach', { ...p, path: 'personal/files/secret plan.pdf' });
    const log = updatesSection('personal/todo/a.md');
    expect(parseTodoUpdates(raw('personal/todo/a.md')).entries.map((e) => e.text)).toEqual([
      'added a file',
      'added a link',
      'changed the project',
      'removed a link',
      'removed a file',
    ]);
    for (const secret of ['secret', 'Private', 'private', 'jev', 'Ideas', 'example.com']) {
      expect(log, secret).not.toContain(secret);
    }
  });

  it('a TDS project entry does not name it either', () => {
    b.folder('clients/acme/projects/website');
    b.put('todo/a.md', TASK);
    run('project', { file: 'a.md', client: 'acme', project: 'acme/website', stage: 'Build' });
    for (const name of ['acme', 'website', 'Build']) expect(updatesSection(), name).not.toContain(name);
  });

  it('move to TDS with dropProject leaves no trace of the personal project, the log included', () => {
    b.put('personal/projects/jev/brief.md', 'x');
    b.put('personal/todo/a.md', TASK);
    const p = { file: 'a.md', scope: 'personal', ...APP };
    run('project', { ...p, client: null, project: 'personal/jev', stage: 'Ideas' });
    run('attach', { ...p, path: 'personal/projects/jev/brief.md' });
    run('update', { ...p, text: 'Keep this note.' });
    const r = run('move', { ...p, to: 'tds', dropProject: true });
    expect(r.code).toBe(0);
    const moved = raw('todo/a.md');
    expect(moved).not.toMatch(/jev|Ideas|brief\.md|personal\/projects/);
    expect(parseTodoUpdates(moved).entries.map((e) => e.text)).toEqual([
      'changed the project',
      'added a file',
      'Keep this note.',
    ]);
  });
});

describe('v0.7: edit never changes ## Updates', () => {
  const HISTORY = '## Title history\n\n- 2026-11-01: was "Old"';
  const KEEP = `- 1 Dec 2026, 10:00 UK: ${BEN} wrote: Keep me.`;
  const LOGGED = `${TASK}\n## Updates\n\n${KEEP}\n\n${HISTORY}\n`;

  it.each([
    ['a body without the section', `New details.\n\n${HISTORY}`],
    ['the section sent back as the details showed it', `New details.\n\n## Updates\n\n${KEEP}\n\n${HISTORY}`],
    [
      'the section sent back with spacing, list marker and heading case changed',
      `New details.\n\n## updates  \n\n\n*   ${KEEP.slice(2).replace(': ', ':   ')}   \n\n${HISTORY}`,
    ],
  ])('keeps the section on disk for %s, with and without keep_files', (_, body) => {
    for (const keep of [false, true]) {
      b.put('todo/a.md', LOGGED);
      const r = run('edit', { file: 'a.md', title: 'Send the quote', body, keep_files: keep });
      expect(r.code).toBe(0);
      expect(r.json.body).toBe('New details.\n\n## Title history\n\n- 2026-11-01: was "Old"');
      const text = raw();
      expect(text).not.toContain('forged');
      expect(parseTodoUpdates(text).entries.map((e) => e.text)).toEqual(['Keep me.', 'changed the details']);
      expect(splitTodoSections(text.split('---\n')[2] as string).details).toBe(
        'New details.\n\n## Title history\n\n- 2026-11-01: was "Old"',
      );
      expect(text.indexOf('## Updates')).toBeLessThan(text.indexOf('## Title history'));
    }
  });

  const CHANGED =
    'the "## Updates" section can\'t be changed with edit: put new details above the "## Updates" heading (updates are added with update)';

  it.each([
    [
      'text typed below the log (an older app sends the whole body)',
      `New details.\n\n## Updates\n\n${KEEP}\n\nA paragraph typed after the log.\n\n${HISTORY}`,
    ],
    [
      'a changed entry',
      `New details.\n\n## Updates\n\n${KEEP.replace('Keep me.', 'Keep me!')}\n\n${HISTORY}`,
    ],
    ['a forged entry', `New details.\n\n## Updates\n\n${KEEP}\n- forged line\n\n${HISTORY}`],
    ['an entry taken out', `New details.\n\n## Updates\n\n${HISTORY}`],
  ])('refuses %s (400), writing nothing, with and without keep_files', (_, body) => {
    for (const keep of [false, true]) {
      b.put('todo/a.md', LOGGED);
      expect(run('edit', { file: 'a.md', title: 'Send the quote', body, keep_files: keep }).json).toEqual({
        error: CHANGED,
        status: 400,
      });
      expect(raw()).toBe(LOGGED);
    }
  });

  it('accepts both copies an older app read before a union merge was folded', () => {
    const log = `## Updates\n\n${KEEP}\n\n## Updates\n\n${KEEP}\n- 1 Dec 2026, 10:01 UK: ${SAM} wrote: Two.\n`;
    b.put('todo/a.md', `${TASK}\n${log}`);
    expect(run('edit', { file: 'a.md', title: 'Send the quote', body: `New details.\n\n${log}` }).code).toBe(
      0,
    );
    expect(parseTodoUpdates(raw()).entries.map((e) => e.text)).toEqual([
      'Keep me.',
      'Two.',
      'changed the details',
    ]);
  });

  it('counts the details limit without the section sent back', () => {
    b.put('todo/a.md', LOGGED);
    const body = `${'d'.repeat(8000)}\n\n## Updates\n\n${KEEP}`;
    expect(run('edit', { file: 'a.md', title: 'Send the quote', body }).code).toBe(0);
  });

  it('refuses a body holding the heading when there is no section on disk, writing nothing', () => {
    b.put('todo/a.md', TASK);
    expect(
      run('edit', { file: 'a.md', title: 'Send the quote', body: 'x\n\n## Updates\n\nmine' }).json,
    ).toEqual({
      error: 'details can\'t hold an "## Updates" section: updates are added with update',
      status: 400,
    });
    expect(raw()).toBe(TASK);
    expect(
      run('edit', { file: 'a.md', title: 'Send the quote', body: 'x\n\n```\n## Updates\n```' }).code,
    ).toBe(0);
  });

  it('add refuses the heading in its body, but not inside a code fence', () => {
    expect(run('add', { title: 'x', body: '## Updates\n\n- mine' }).json).toEqual({
      error: 'details can\'t hold an "## Updates" section: updates are added with update',
      status: 400,
    });
    expect(run('add', { title: 'y', body: '~~~\n## Updates\n~~~' }).code).toBe(0);
  });
});

describe('v0.7: add writes created_at', () => {
  it.each([
    ['2026-11-27T14:05:09Z', '2026-11-27T14:05:09+00:00'],
    ['2026-07-01T23:30:00Z', '2026-07-02T00:30:00+01:00'],
  ])('at %s → %s, after created:', (now, at) => {
    const r = run('add', { title: 'Stamped' }, clock(now));
    const text = raw(`todo/${r.json.file}`);
    expect(text).toMatch(
      new RegExp(`\\ncreated: \\d{4}-\\d{2}-\\d{2}\\ncreated_at: ${at.replace(/\+/g, '\\+')}\\n`),
    );
  });
});

describe('v0.7: section placement', () => {
  it('a new ## Updates goes after the details and ## Files, before the history, done and deleted headings', () => {
    for (const anchor of [
      '## Title history',
      '## Handover history',
      '## Done 2026-11-14',
      '## Deleted 2026-11-14',
    ]) {
      b.put('todo/a.md', `${TASK}\n## Files\n\n- [a](https://example.com/a)\n\n${anchor}\n\n- x\n`);
      run('update', { file: 'a.md', text: 'Hi' });
      expect(raw(), anchor).toBe(
        `${TASK}\n## Files\n\n- [a](https://example.com/a)\n\n## Updates\n\n- ${NOW}: ${SAM} wrote: Hi\n\n${anchor}\n\n- x\n`,
      );
    }
  });

  it('after a ## Files section that comes after a history heading, and straight after bare frontmatter', () => {
    b.put('todo/a.md', `${TASK}\n## Title history\n\n- x\n\n## Files\n\n- [a](https://example.com/a)\n`);
    run('update', { file: 'a.md', text: 'Hi' });
    expect(raw()).toMatch(
      /## Files\n\n- \[a\]\(https:\/\/example\.com\/a\)\n\n## Updates\n\n- .* wrote: Hi\n$/,
    );
    b.put('todo/b.md', '---\ntitle: T\n---\n');
    run('update', { file: 'b.md', text: 'Hi' });
    expect(raw('todo/b.md')).toBe(`---\ntitle: T\n---\n\n## Updates\n\n- ${NOW}: ${SAM} wrote: Hi\n`);
    b.put('todo/c.md', 'No frontmatter.\r\n');
    run('update', { file: 'c.md', text: 'Hi' });
    expect(raw('todo/c.md')).toBe(`No frontmatter.\r\n\r\n## Updates\r\n\r\n- ${NOW}: ${SAM} wrote: Hi\r\n`);
  });
});

describe('v0.7: what a union merge doubles is folded on the next write', () => {
  const DOUBLED = [
    '---',
    'assignee: sam-example',
    'assignee: ben-mcadam',
    'title: Old',
    'title: Newer',
    'due: 2026-12-01',
    'due: 2026-12-02',
    '---',
    '',
    'Details.',
    '',
    '## Files',
    '',
    '- [A](https://example.com/a)',
    '',
    '## Updates',
    '',
    `- 1 Dec 2026, 10:00 UK: ${SAM} wrote: From Sam.`,
    '  Two lines.',
    '',
    '## Files',
    '',
    '- [B](https://example.com/b)',
    '- [A](https://example.com/a)',
    '',
    '## Updates',
    '',
    `- 1 Dec 2026, 10:00 UK: ${SAM} wrote: From Sam.`,
    '  Two lines.',
    `- 1 Dec 2026, 10:01 UK: ${BEN} wrote: From Ben.`,
    '  Two lines.',
    '',
  ].join('\n');

  it('due folds the sections (exact duplicates dropped) and every due: copy, reading the last', () => {
    b.put('todo/a.md', DOUBLED);
    run('due', { file: 'a.md', due: '2026-12-05' });
    const text = raw();
    expect(text.match(/^## Updates$/gm)).toHaveLength(1);
    expect(text.match(/^## Files$/gm)).toHaveLength(1);
    expect(text.match(/^due:/gm)).toEqual(['due:']);
    expect(text).toContain('\ndue: 2026-12-05\n');
    expect(parseTodoLinks(text).map((l) => l.name)).toEqual(['A', 'B']);
    expect(parseTodoUpdates(text).entries.map((e) => e.text)).toEqual([
      'From Sam.\nTwo lines.',
      'From Ben.\nTwo lines.',
      'changed the due date from 2 Dec 2026 to 5 Dec 2026',
    ]);
    // Keys this write doesn't set are left for the write that does.
    expect(text.match(/^title:/gm)).toHaveLength(2);
  });

  it('edit keeps one title: line and reads the last; assignee keeps one assignee: line and reads the last', () => {
    b.put('todo/a.md', DOUBLED);
    // The same title as the last copy: nothing really changes, so nothing is written.
    const before = b.sha('todo/a.md');
    run('edit', { file: 'a.md', title: 'Newer' });
    expect(b.sha('todo/a.md')).toBe(before);
    run('edit', { file: 'a.md', title: 'Newest' });
    expect(raw().match(/^title: .*$/gm)).toEqual(['title: Newest']);
    expect(raw()).toContain('was "Newer"');
    expect(entries()).toHaveLength(3);
    run('assignee', { file: 'a.md', assignee: 'sam-example' });
    expect(raw().match(/^assignee: .*$/gm)).toEqual(['assignee: sam-example']);
    expect(raw()).toContain('passed it from ben-mcadam to sam-example');
  });

  it('readers read both copies before any write', () => {
    expect(parseTodoUpdates(DOUBLED).entries).toHaveLength(3);
    expect(lib.parseUpdates(DOUBLED).entries).toHaveLength(3);
    expect(parseTodoLinks(DOUBLED)).toHaveLength(2);
  });
});

describe('v0.7: two clones of a git brain merged under todo/*.md merge=union', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'todo-union-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const gitEnv = {
    PATH: process.env.PATH ?? '',
    HOME: '',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.test',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.test',
  };
  function git(cwd: string, ...args: string[]) {
    const r = spawnSync('git', ['-c', 'init.defaultBranch=main', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...gitEnv, HOME: dir },
    });
    expect(r.status, `git ${args.join(' ')}: ${r.stderr}`).toBe(0);
    return r.stdout;
  }
  function script(clone: string, command: string, input: Record<string, unknown>, now: string) {
    const r = spawnSync(process.execPath, [SCRIPT, command], {
      input: JSON.stringify(input),
      env: { ...gitEnv, HOME: dir, BRAIN_ROOT: clone, ...clock(now) },
      cwd: clone,
      encoding: 'utf8',
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  }
  function clones(start: string) {
    git(dir, 'init', '--bare', 'origin.git');
    git(dir, 'clone', 'origin.git', 'a');
    const a = join(dir, 'a');
    writeFileSync(join(a, '.gitattributes'), 'todo/*.md merge=union\n');
    mkdirSync(join(a, 'todo'));
    mkdirSync(join(a, '.team-config'));
    writeFileSync(
      join(a, '.team-config', 'roles.json'),
      JSON.stringify({ members: [{ name: 'Sam Example' }] }),
    );
    writeFileSync(join(a, 'todo', 't.md'), start);
    git(a, 'add', '-A');
    git(a, 'commit', '-m', 'start');
    git(a, 'push', 'origin', 'HEAD:main');
    git(dir, 'clone', 'origin.git', 'b');
    return { a, b: join(dir, 'b') };
  }

  it.each([
    ['the task had no log yet (both make the section)', TASK],
    [
      'the task had a log (both append to it)',
      `${TASK}\n## Updates\n\n- 1 Dec 2026, 09:00 UK: ${SAM} wrote: Start.\n`,
    ],
  ])('%s: one file holds both entries, folded to one section on the next write', (_, start) => {
    const { a, b: other } = clones(start);
    script(
      a,
      'update',
      { file: 't.md', text: 'From A.', by: 'sam-example', by_name: 'Sam Example' },
      '2026-12-01T10:00:00Z',
    );
    git(a, 'commit', '-am', 'a');
    git(a, 'push', 'origin', 'HEAD:main');
    script(
      other,
      'update',
      { file: 't.md', text: 'From B.', by: 'ben-mcadam', by_name: 'Ben McAdam' },
      '2026-12-01T10:01:00Z',
    );
    git(other, 'commit', '-am', 'b');
    git(other, 'pull', '--no-rebase', '--no-edit', 'origin', 'main');
    const merged = readFileSync(join(other, 'todo', 't.md'), 'utf8');
    expect(merged).not.toMatch(/^(?:<<<<<<<|=======|>>>>>>>)/m);
    const texts = (t: string) => parseTodoUpdates(t).entries.map((e) => e.text);
    expect(texts(merged)).toEqual(expect.arrayContaining(['From A.', 'From B.']));
    expect(
      todoTimeline(merged)
        .updates.map((e) => e.text)
        .slice(-2),
    ).toEqual(['From A.', 'From B.']);
    script(other, 'due', { file: 't.md', due: '2026-12-09' }, '2026-12-01T10:02:00Z');
    const folded = readFileSync(join(other, 'todo', 't.md'), 'utf8');
    expect(folded.match(/^## Updates$/gm)).toHaveLength(1);
    expect(
      todoTimeline(folded)
        .updates.map((e) => e.text)
        .slice(-3),
    ).toEqual(['From A.', 'From B.', 'set the due date to 9 Dec 2026']);
  });

  // Contract, "Known limit" (accepted, review round 1): pinned so a change in it is noticed. The merge
  // keeps the shared last line once, so one of the two notes (here the second, B's) loses it.
  const KNOWN_LIMIT_TEXTS = ['From A.\nSee you.', 'From B.'];
  it('known limit: two multi-line notes ending in the same line keep that line once', () => {
    const { a, b: other } = clones(TASK);
    script(
      a,
      'update',
      { file: 't.md', text: 'From A.\nSee you.', by: 'sam-example', by_name: 'Sam Example' },
      '2026-12-01T10:00:00Z',
    );
    git(a, 'commit', '-am', 'a');
    git(a, 'push', 'origin', 'HEAD:main');
    script(
      other,
      'update',
      { file: 't.md', text: 'From B.\nSee you.', by: 'ben-mcadam', by_name: 'Ben McAdam' },
      '2026-12-01T10:01:00Z',
    );
    git(other, 'commit', '-am', 'b');
    git(other, 'pull', '--no-rebase', '--no-edit', 'origin', 'main');
    const merged = readFileSync(join(other, 'todo', 't.md'), 'utf8');
    expect(merged.match(/^ {2}See you\.$/gm)).toHaveLength(1);
    expect(
      parseTodoUpdates(merged)
        .entries.map((e) => e.text)
        .sort(),
    ).toEqual(KNOWN_LIMIT_TEXTS);
  });
});

describe('v0.7: 0.6 callers still succeed', () => {
  it('each old command with only its 0.6 fields', () => {
    b.put('clients/acme/files/q.pdf', 'x');
    b.folder('clients/acme/projects/website');
    const added = run('add', { title: 'Old caller', due: '2026-12-01', assignee: 'ben-mcadam', body: 'Hi' });
    expect(added.code).toBe(0);
    const file = added.json.file as string;
    const calls: [string, Record<string, unknown>, Record<string, unknown>][] = [
      [
        'edit',
        { title: 'Old caller', body: 'Details' },
        { ok: true, file, title: 'Old caller', body: 'Details' },
      ],
      ['due', { due: '2026-12-02' }, { ok: true, file, due: '2026-12-02' }],
      ['assignee', { assignee: 'sam-example' }, { ok: true, file, assignee: 'sam-example' }],
      [
        'attach',
        { path: 'clients/acme/files/q.pdf' },
        { ok: true, file, path: 'clients/acme/files/q.pdf', changed: true },
      ],
      [
        'detach',
        { path: 'clients/acme/files/q.pdf' },
        { ok: true, file, path: 'clients/acme/files/q.pdf', changed: true },
      ],
      [
        'project',
        { client: 'acme', project: 'acme/website', stage: null },
        { ok: true, file, client: 'acme', project: 'acme/website', stage: null },
      ],
    ];
    for (const [command, input, json] of calls) {
      expect(run(command, { file, ...input }), command).toEqual({ code: 0, json });
    }
    expect(entries(`todo/${file}`)).toHaveLength(5);
    expect(run('list', {}).json.todos).toHaveLength(1);
    expect(run('roster', {}).code).toBe(0);
    const moved = run('move', { file, to: 'personal' });
    expect(moved.code).toBe(0);
    expect(run('tick', { file, scope: 'personal' }).code).toBe(0);
    b.put('todo/d.md', TASK);
    expect(run('delete', { file: 'd.md' }).code).toBe(0);
  });
});

describe('v0.7: the Workbench and the Reminders sync still read the same', () => {
  it.each([
    ['LF', TASK],
    ['CRLF', TASK.replace(/\n/g, '\r\n')],
  ])('%s: title, due, assignee and body text, apart from the added lines', (_, start) => {
    b.put('clients/acme/files/q.pdf', 'x');
    b.put('todo/a.md', start);
    const steps: [string, Record<string, unknown>][] = [
      ['update', { text: 'Note one\nline two' }],
      ['link', { url: 'https://example.com/spec_(v2)', name: 'Spec' }],
      ['attach', { path: 'clients/acme/files/q.pdf' }],
      ['due', { due: '2026-12-01' }],
      ['assignee', { assignee: 'ben-mcadam', note: 'Yours' }],
      ['assignee', { assignee: 'sam-example', back: true, note: 'Back', by: 'ben-mcadam' }],
    ];
    for (const [command, input] of steps)
      expect(run(command, { file: 'a.md', ...input }).code, command).toBe(0);
    const text = raw();
    const wb = workbench.parseFrontmatter(text);
    expect(wb.frontmatter).toMatchObject({
      title: 'Send the quote',
      due: '2026-12-01',
      assignee: 'sam-example',
    });
    expect(reminders.titleOf(text, 'a.md')).toBe('Send the quote');
    expect(reminders.parse(text).fm).toMatchObject({ due: '2026-12-01', assignee: 'sam-example' });
    // The body: the details, then only lines the script added (files, log, handover history).
    const body = wb.body.replace(/\r\n/g, '\n');
    expect(body.startsWith('Ring the client.\n\n## Files\n')).toBe(true);
    expect(splitTodoSections(body).details).toBe('Ring the client.');
    expect(splitTodoSections(body).handover).toMatch(/^## Handover history\n\n- .* passed it from /);
    expect(withoutLog(text)).not.toContain('## Updates');
  });
});

// ---- review round 1 (contract: "edit never changes…", "fences", "text", "Known limit") ----------

describe('v0.7 (review round 1): edit never changes ## Handover history either', () => {
  const KEEP = `- 1 Dec 2026, 10:00 UK: ${BEN} wrote: Keep me.`;
  const HANDED = '- 26 Nov 2026, 09:00 UK: Ben McAdam passed it from ben-mcadam to sam-example (TDS Cortex).';
  const WITH = `${TASK}\n## Updates\n\n${KEEP}\n\n## Handover history\n\n${HANDED}\n`;
  const BACK = '- 27 Nov 2026, 10:00 UK: Ben McAdam handed it back to sam-example (TDS Cortex).';
  const CHANGED =
    'the "## Handover history" section can\'t be changed with edit: put new details above the "## Updates" and "## Handover history" headings';
  const IN_DETAILS =
    'details can\'t hold a "## Handover history" section: it is written when a to-do is passed on';

  it('carries the section on disk over when the body leaves it out, with and without keep_files', () => {
    for (const keep of [false, true]) {
      b.put('todo/a.md', WITH);
      const r = run('edit', {
        file: 'a.md',
        title: 'Send the quote',
        body: 'New details.',
        keep_files: keep,
      });
      expect(r.code).toBe(0);
      const text = raw();
      expect(text.match(/^## Handover history$/gm)).toHaveLength(1);
      expect(parseTodoHandovers(text).map((e) => e.text)).toEqual([
        'passed it from ben-mcadam to sam-example',
      ]);
      expect(splitTodoSections(text.split('---\n')[2] as string)).toMatchObject({
        details: 'New details.',
        handover: `## Handover history\n\n${HANDED}`,
      });
      expect(text.indexOf('## Updates')).toBeLessThan(text.indexOf('## Handover history'));
    }
  });

  it('accepts it sent back as an older app showed it, compared tolerantly', () => {
    b.put('todo/a.md', WITH);
    const body = `New details.\n\n## Updates\n\n${KEEP}\n\n## handover history\n\n*  ${HANDED.slice(2)}  \n`;
    expect(run('edit', { file: 'a.md', title: 'Send the quote', body }).code).toBe(0);
    expect(raw().match(/^## Handover history$/gm)).toHaveLength(1);
    expect(raw()).toContain(`\n${HANDED}\n`);
  });

  it.each([
    ['a typed "handed it back" line', `New details.\n\n## Handover history\n\n${HANDED}\n${BACK}`],
    ['text typed below it', `New details.\n\n## Handover history\n\n${HANDED}\n\nMore notes.`],
    ['a changed line', `New details.\n\n## Handover history\n\n${HANDED.replace('ben-mcadam to', 'jo to')}`],
  ])('refuses %s (400), writing nothing', (_, body) => {
    for (const keep of [false, true]) {
      b.put('todo/a.md', WITH);
      expect(run('edit', { file: 'a.md', title: 'Send the quote', body, keep_files: keep }).json).toEqual({
        error: CHANGED,
        status: 400,
      });
      expect(raw()).toBe(WITH);
    }
  });

  it('refuses the heading when there is none on disk, on edit and on add, but not inside a code fence', () => {
    b.put('todo/a.md', TASK);
    const body = `x\n\n## Handover history\n\n${BACK}`;
    expect(run('edit', { file: 'a.md', title: 'Send the quote', body }).json).toEqual({
      error: IN_DETAILS,
      status: 400,
    });
    expect(raw()).toBe(TASK);
    expect(run('add', { title: 'x', body }).json).toEqual({ error: IN_DETAILS, status: 400 });
    expect(
      run('edit', { file: 'a.md', title: 'Send the quote', body: 'x\n\n```\n## Handover history\n```' }).code,
    ).toBe(0);
    expect(run('add', { title: 'y', body: '~~~\n## Handover history\n~~~' }).code).toBe(0);
  });

  it('assignee still appends to the section an edit carried over', () => {
    b.put('todo/a.md', WITH);
    run('edit', { file: 'a.md', title: 'Send the quote', body: 'New details.' });
    run('assignee', { file: 'a.md', assignee: 'ben-mcadam', ...APP });
    const text = raw();
    expect(text.match(/^## Handover history$/gm)).toHaveLength(1);
    expect(parseTodoHandovers(text).map((e) => e.text)).toEqual([
      'passed it from ben-mcadam to sam-example',
      'passed it from sam-example to ben-mcadam',
    ]);
  });
});

describe('v0.7 (review round 1): an unclosed code fence never swallows a section', () => {
  const open = (fence = '```') => TASK.replace('Ring the client.\n', `Run this:\n\n${fence}\nnpm test\n`);
  /** The level-2 headings outside code fences, in order. */
  const headings = (text: string) => {
    const lines = text.split('\n');
    return linesOutsideFences(lines)
      .map((i) => lines[i] as string)
      .filter((l) => l.startsWith('## '));
  };

  it('two updates: the fence is closed once, before one ## Updates section both entries are in', () => {
    b.put('todo/a.md', open());
    run('update', { file: 'a.md', text: 'One', ...APP });
    run('update', { file: 'a.md', text: 'Two', ...APP });
    expect(raw()).toBe(
      `${open()}\`\`\`\n\n## Updates\n\n- ${NOW}: ${SAM} wrote: One\n- ${NOW}: ${SAM} wrote: Two\n`,
    );
    expect(entries().map((e) => e.text)).toEqual(['One', 'Two']);
  });

  it.each([
    ['link (## Files)', 'link', { url: 'https://example.com/a' }, ['## Files', '## Updates']],
    ['attach (## Files)', 'attach', { path: 'clients/acme/files/q.pdf' }, ['## Files', '## Updates']],
    ['a new title (## Title history)', 'edit', { title: 'Send it' }, ['## Updates', '## Title history']],
    ['a pass-on (## Handover history)', 'assignee', { assignee: 'ben-mcadam' }, ['## Handover history']],
  ])('%s closes it first, with a longer tilde fence too', (_, command, input, want) => {
    b.put('clients/acme/files/q.pdf', 'x');
    for (const fence of ['```', '~~~~']) {
      b.put('todo/a.md', open(fence));
      expect(run(command, { file: 'a.md', ...input }).code, `${command} ${fence}`).toBe(0);
      expect(headings(raw()), fence).toEqual(want);
      expect(raw()).toContain(`\nnpm test\n${fence}\n\n## `);
    }
  });

  it('tick with a note and delete close it before their own records', () => {
    b.put('todo/a.md', open());
    expect(run('tick', { file: 'a.md', note: 'Done.' }).code).toBe(0);
    expect(headings(raw('todo/done/a.md'))).toEqual(['## Updates', '## Done 2026-11-27']);
    b.put('todo/b.md', open('~~~'));
    expect(run('delete', { file: 'b.md' }).code).toBe(0);
    expect(headings(raw('todo/deleted/b.md'))).toEqual(['## Deleted 2026-11-27']);
  });

  it('a closed fence is left as it is', () => {
    const closed = TASK.replace('Ring the client.\n', 'Run this:\n\n```\nnpm test\n```\n');
    b.put('todo/a.md', closed);
    run('update', { file: 'a.md', text: 'One', ...APP });
    expect(raw()).toBe(`${closed}\n## Updates\n\n- ${NOW}: ${SAM} wrote: One\n`);
  });
});

describe('v0.7 (review round 1): line and paragraph separators in an update', () => {
  it('U+2028 and U+2029 count as line breaks, so the entry reads back as a note', () => {
    b.put('todo/a.md', TASK);
    expect(run('update', { file: 'a.md', text: 'One\u2028Two\u2029\u2029Three', ...APP }).code).toBe(0);
    expect(entries()).toMatchObject([{ kind: 'note', text: 'One\nTwo\nThree' }]);
    expect(raw()).not.toMatch(/[\u2028\u2029]/);
  });
});

describe('v0.7 (review round 1): tick and delete', () => {
  it('still take a file whose frontmatter never closes, with or without a note', () => {
    const broken = '---\ntitle: Broken\nRing the client.\n';
    b.put('todo/a.md', broken);
    expect(run('tick', { file: 'a.md', note: 'Done.' }).code).toBe(0);
    expect(raw('todo/done/a.md')).toContain('## Done 2026-11-27');
    expect(parseTodoUpdates(raw('todo/done/a.md')).entries.map((e) => e.text)).toEqual(['Done.']);
    b.put('todo/b.md', broken);
    expect(run('delete', { file: 'b.md' }).code).toBe(0);
    expect(raw('todo/deleted/b.md')).toContain('## Deleted 2026-11-27');
  });

  it('fold what a union merge doubled before stamping', () => {
    const doubled = `${TASK}\n## Updates\n\n- 1 Dec 2026, 10:00 UK: ${SAM} wrote: A.\n\n## Updates\n\n- 1 Dec 2026, 10:00 UK: ${SAM} wrote: A.\n- 1 Dec 2026, 10:01 UK: ${BEN} wrote: B.\n`;
    for (const [command, folder] of [
      ['tick', 'done'],
      ['delete', 'deleted'],
    ] as const) {
      b.put('todo/a.md', doubled);
      expect(run(command, { file: 'a.md' }).code).toBe(0);
      const text = raw(`todo/${folder}/a.md`);
      expect(text.match(/^## Updates$/gm), command).toHaveLength(1);
      expect(parseTodoUpdates(text).entries.map((e) => e.text)).toEqual(['A.', 'B.']);
    }
  });
});
