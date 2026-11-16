/**
 * Files on to-dos (plan 2026-11-16-todo-attachments, release 3): attachments on the list, the
 * canAttach / canUpload gates, the attach/detach/edit/add payloads and the upload sequence. All content
 * is invented; every brain is a temp copy of the test fixture.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  TODO_ATTACHMENTS_MAX,
  TODO_SCRIPT,
  type TodoAction,
  TodoChangeError,
  type TodoItem,
} from '../../shared/contract.ts';
import { FILES_SCRIPT } from './files-skill.ts';
import { createBrainReaders } from './index.ts';
import { copyFixture, person } from './test-helpers.ts';
import { cleanUploadName, uploadDestination } from './todos.ts';

const sam = person('sam-example', 'scout');
const made: string[] = [];
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(prefix = 'tba-attach-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

const MINE = '20261105-send-report.md';
const CLIENTS = [{ slug: 'acme-heating' }, { slug: 'northwind' }];

/** The to-do script: logs every change; answers capabilities from FAKE_TODO_CAPS; per command from FAKE_TODO_REPLIES. */
const TODO_FAKE = `
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const cmd = process.argv[2];
  if (cmd === 'capabilities') {
    if (process.env.FAKE_TODO_CAPS) { process.stdout.write(JSON.stringify({ version: '0.5', features: JSON.parse(process.env.FAKE_TODO_CAPS) })); return; }
    process.stdout.write('{"ok":false,"status":400,"error":"unknown command"}'); process.exitCode = 2; return;
  }
  fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ script: 'todo', command: cmd, body: JSON.parse(input) }) + '\\n');
  const r = JSON.parse(process.env.FAKE_TODO_REPLIES || '{}')[cmd] || {};
  process.stdout.write(r.out || '{"ok":true}');
  process.exitCode = r.exit || 0;
});
`;

/** The files script: logs every call but capabilities; answers per command from FAKE_FILES_REPLIES. */
const FILES_FAKE = `
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const cmd = process.argv[2];
  if (cmd === 'capabilities') {
    process.stdout.write(JSON.stringify({ ok: true, action: 'capabilities', version: '0.2', features: JSON.parse(process.env.FAKE_FILES_CAPS || '[]') }));
    return;
  }
  fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ script: 'files', command: cmd, body: JSON.parse(input) }) + '\\n');
  const r = JSON.parse(process.env.FAKE_FILES_REPLIES || '{}')[cmd] || {};
  process.stdout.write(r.out || '{"ok":true}');
  process.exitCode = r.exit || 0;
});
`;

interface Setup {
  /** The to-do script's capabilities; null: an older script that refuses the command. */
  todoCaps?: string[] | null;
  /** Install tdsapp-files; null leaves it out. */
  filesCaps?: string[] | null;
  filesRoles?: string;
  todoRoles?: string;
  todoReplies?: Record<string, { out?: string; exit?: number }>;
  filesReplies?: Record<string, { out?: string; exit?: number }>;
}

function setup(opts: Setup = {}) {
  const root = copyFixture();
  const skill = join(root, '.claude', 'skills', 'tdsapp-todo');
  mkdirSync(join(skill, 'scripts'), { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), `---\nroles: ${opts.todoRoles ?? 'owner, scout'}\n---\n`);
  writeFileSync(join(root, TODO_SCRIPT), TODO_FAKE);
  if (opts.filesCaps !== null) {
    const files = join(root, '.claude', 'skills', 'tdsapp-files');
    mkdirSync(join(files, 'scripts'), { recursive: true });
    writeFileSync(join(files, 'SKILL.md'), `---\nroles: ${opts.filesRoles ?? 'owner, scout'}\n---\n`);
    writeFileSync(join(root, FILES_SCRIPT), FILES_FAKE);
  }
  const log = join(tempDir('tba-attach-log-'), 'calls.jsonl');
  const todoCaps = opts.todoCaps === undefined ? ['handover', 'scope', 'attach'] : opts.todoCaps;
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    FAKE_LOG: log,
    FAKE_TODO_REPLIES: JSON.stringify(opts.todoReplies ?? {}),
    FAKE_FILES_REPLIES: JSON.stringify(opts.filesReplies ?? {}),
    FAKE_FILES_CAPS: JSON.stringify(opts.filesCaps ?? ['files-delete-v1', 'files-add-v1']),
  };
  if (todoCaps !== null) env.FAKE_TODO_CAPS = JSON.stringify(todoCaps);
  const brain = createBrainReaders(root, {
    todoSkill: { env },
    filesSkill: { env },
    libraryIgnored: async () => new Set(),
  });
  const calls = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l) as { script: string; command: string; body: Record<string, unknown> })
      : [];
  return { root, brain, calls };
}

const versionOf = (root: string, rel: string) =>
  createHash('sha256')
    .update(readFileSync(join(root, rel)))
    .digest('hex');

function writeTodo(root: string, rel: string, text: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function put(root: string, rel: string, text = 'x'): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}

async function codeOf(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(TodoChangeError);
    return { code: (err as TodoChangeError).code, message: (err as TodoChangeError).message };
  }
}

const todo = (over: Partial<Pick<TodoItem, 'scope' | 'client'>>): Pick<TodoItem, 'scope' | 'client'> => ({
  scope: 'tds',
  client: null,
  ...over,
});

describe('uploadDestination (decision 3)', () => {
  it("files a client's to-do under that client, images and documents apart", () => {
    expect(uploadDestination(todo({ client: 'acme-heating' }), CLIENTS, 'logo.png')).toEqual({
      path: 'clients/acme-heating/images/logo.png',
      personal: false,
    });
    expect(uploadDestination(todo({ client: 'acme-heating' }), CLIENTS, 'Brief v2.docx')).toEqual({
      path: 'clients/acme-heating/files/Brief v2.docx',
      personal: false,
    });
    expect(uploadDestination(todo({ client: 'northwind' }), CLIENTS, 'notes.MD')).toEqual({
      path: 'clients/northwind/files/notes.MD',
      personal: false,
    });
  });

  it('needs an exact slug match; anything else, and every personal to-do, goes to personal files', () => {
    for (const client of [null, 'Acme-Heating', 'acme heating', 'acme', 'Acme Heating', 'unknown-co']) {
      expect(uploadDestination(todo({ client }), CLIENTS, 'shot.jpg'), String(client)).toEqual({
        path: 'personal/images/shot.jpg',
        personal: true,
      });
    }
    expect(uploadDestination(todo({ client: ' acme-heating ' }), CLIENTS, 'a.pdf')?.path).toBe(
      'clients/acme-heating/files/a.pdf',
    );
    expect(uploadDestination(todo({ scope: 'personal', client: 'acme-heating' }), CLIENTS, 'a.pdf')).toEqual({
      path: 'personal/files/a.pdf',
      personal: true,
    });
  });

  it('refuses types outside TODO_UPLOAD_TYPES, script-carrying ones included', () => {
    for (const name of ['page.html', 'page.htm', 'icon.svg', 'pic.avif', 'run.exe', 'noext', 'mail.eml']) {
      expect(uploadDestination(todo({ client: 'acme-heating' }), CLIENTS, name), name).toBeNull();
    }
  });

  it('cleans the name so the link always parses, keeping the extension', () => {
    expect(cleanUploadName('Q4 [draft] 50% #2?.pdf')).toBe('Q4 (draft) 50 2.pdf');
    expect(cleanUploadName('...hidden.png')).toBe('hidden.png');
    expect(cleanUploadName('%%%.png')).toBe('file.png');
    expect(cleanUploadName('README.md')).toBe('README (file).md');
    expect(cleanUploadName('profile.MD')).toBe('profile (file).MD');
    expect(cleanUploadName('AGENT\u017f.md')).toBe('AGENT\u017f (file).md');
    expect(cleanUploadName('a\u0000b‮.txt')).toBe('ab.txt');
  });
});

describe('attachments on the list (decision 7)', () => {
  function withFiles(lines: string[], rel = `todo/${MINE}`, extra = '') {
    const s = setup();
    put(s.root, 'clients/acme-heating/images/logo.png');
    put(s.root, 'personal/files/My notes.pdf');
    put(s.root, 'templates/brief.md');
    writeTodo(
      s.root,
      rel,
      `---\nassignee: sam-example\n${extra}---\n# Send the monthly report\n\nSome details.\n\n## Files\n\n${lines.join('\n')}\n`,
    );
    return s;
  }

  it('parses the section, with kind, libraryId (the library’s own id), personal and holder', async () => {
    const { brain } = withFiles([
      '- [logo.png](../clients/acme-heating/images/logo.png)',
      '- [Q1 plan](../clients/acme-heating/plans/q1-plan.docx)',
      "- [My notes.pdf](<../personal/files/My notes.pdf>) (only on sam-example's Mac)",
      "- [Their notes.pdf](<../personal/files/My notes.pdf>) (only on alex-sample's Mac)",
      '- [brief.md](../templates/brief.md)',
      '- [gone.png](../clients/acme-heating/images/gone.png)',
      '- [data.bin](../clients/acme-heating/data.bin)',
    ]);
    const item = (await brain.todos(sam)).mine.find((t) => t.id === MINE);
    const keyOf = async (p: string) => (await brain.libraryItemForPath?.(p))?.key ?? null;
    expect(item?.attachments).toEqual([
      {
        path: 'clients/acme-heating/images/logo.png',
        name: 'logo.png',
        kind: 'image',
        libraryId: await keyOf('clients/acme-heating/images/logo.png'),
        personal: false,
        holder: null,
      },
      {
        path: 'clients/acme-heating/plans/q1-plan.docx',
        name: 'Q1 plan',
        kind: 'document',
        libraryId: await keyOf('clients/acme-heating/plans/q1-plan.docx'),
        personal: false,
        holder: null,
      },
      {
        path: 'personal/files/My notes.pdf',
        name: 'My notes.pdf',
        kind: 'document',
        libraryId: await keyOf('personal/files/My notes.pdf'),
        personal: true,
        holder: 'sam-example',
      },
      {
        path: 'templates/brief.md',
        name: 'brief.md',
        kind: 'document',
        libraryId: await keyOf('templates/brief.md'),
        personal: false,
        holder: null,
      },
      {
        path: 'clients/acme-heating/images/gone.png',
        name: 'gone.png',
        kind: 'image',
        libraryId: null,
        personal: false,
        holder: null,
      },
      {
        path: 'clients/acme-heating/data.bin',
        name: 'data.bin',
        kind: null,
        libraryId: null,
        personal: false,
        holder: null,
      },
    ]);
    // The same path held by someone else was dropped as a duplicate; every id that is set is listed.
    expect(item?.attachments.filter((a) => a.libraryId !== null)).toHaveLength(4);
    for (const a of item?.attachments ?? []) {
      if (a.libraryId) expect((await brain.libraryFile(a.libraryId))?.item.path).toBe(a.path);
    }
  });

  it("never gives an id for someone else's personal file, or one with no holder", async () => {
    const { brain } = withFiles([
      "- [Theirs](<../personal/files/My notes.pdf>) (only on alex-sample's Mac)",
      '- [No holder](../personal/screens/shot.png)',
    ]);
    const item = (await brain.todos(sam)).mine.find((t) => t.id === MINE);
    expect(item?.attachments.map((a) => [a.path, a.holder, a.libraryId])).toEqual([
      ['personal/files/My notes.pdf', 'alex-sample', null],
      ['personal/screens/shot.png', null, null],
    ]);
  });

  it('gives no id for places the library never lists, links, or a symlinked folder', async () => {
    const s = setup();
    put(s.root, 'clients/acme-heating/config/secret.md');
    put(s.root, 'templates/AGENTS.md');
    const outside = tempDir();
    put(outside, 'x.png');
    mkdirSync(join(s.root, 'clients/acme-heating/images'), { recursive: true });
    symlinkSync(join(outside, 'x.png'), join(s.root, 'clients/acme-heating/images/link.png'));
    symlinkSync(outside, join(s.root, 'clients/acme-heating/linked'));
    put(s.root, 'clients/_archive/files/old.pdf');
    writeTodo(
      s.root,
      `todo/${MINE}`,
      [
        '---',
        'assignee: sam-example',
        '---',
        '## Files',
        '- [a](../clients/acme-heating/config/secret.md)',
        '- [b](../templates/AGENTS.md)',
        '- [c](../clients/acme-heating/images/link.png)',
        '- [d](../clients/acme-heating/linked/x.png)',
        '- [e](../clients/_archive/files/old.pdf)',
        '',
      ].join('\n'),
    );
    const item = (await s.brain.todos(sam)).mine.find((t) => t.id === MINE);
    expect(item?.attachments).toHaveLength(5);
    expect(item?.attachments.every((a) => a.libraryId === null)).toBe(true);
  });

  it('is [] without a section, and on open and personal to-dos too', async () => {
    const s = setup();
    put(s.root, 'personal/files/plan.pdf');
    writeTodo(
      s.root,
      'personal/todo/20261110-dentist.md',
      "---\nassignee: sam-example\n---\n## Files\n\n- [plan.pdf](../../personal/files/plan.pdf) (only on sam-example's Mac)\n",
    );
    const list = await s.brain.todos(sam);
    expect(list.open.every((t) => Array.isArray(t.attachments) && t.attachments.length === 0)).toBe(true);
    expect(list.mine.find((t) => t.id === MINE)?.attachments).toEqual([]);
    const personal = list.mine.find((t) => t.scope === 'personal');
    expect(personal?.attachments.map((a) => [a.path, a.libraryId !== null])).toEqual([
      ['personal/files/plan.pdf', true],
    ]);
  });

  it('reads asked-of-others to-dos the same way', async () => {
    const s = setup();
    put(s.root, 'clients/acme-heating/images/logo.png');
    writeTodo(
      s.root,
      'todo/20261112-ask-alex.md',
      '---\ntitle: Ask Alex\nassignee: alex-sample\ncreated_by: sam-example\n---\n## Files\n\n- [logo.png](../clients/acme-heating/images/logo.png)\n',
    );
    const asked = await s.brain.askedTodos(sam);
    const item = asked.waiting.find((t) => t.id === '20261112-ask-alex.md');
    expect(item?.attachments).toEqual([
      {
        path: 'clients/acme-heating/images/logo.png',
        name: 'logo.png',
        kind: 'image',
        libraryId: (await s.brain.libraryItemForPath?.('clients/acme-heating/images/logo.png'))?.key,
        personal: false,
        holder: null,
      },
    ]);
  });
});

describe('canAttach and canUpload', () => {
  it('are both true with changes on, "attach", and tdsapp-files allowed with "files-add-v1"', async () => {
    const list = await setup().brain.todos(sam);
    expect([list.changes, list.canAttach, list.canUpload]).toEqual(['on', true, true]);
  });

  it('canAttach needs the to-do script to list "attach"', async () => {
    for (const caps of [['handover', 'scope'], null]) {
      const list = await setup({ todoCaps: caps }).brain.todos(sam);
      expect([list.canAttach, list.canUpload], String(caps)).toEqual([false, false]);
    }
  });

  it('canAttach needs changes on: a restricted person gets neither', async () => {
    const list = await setup().brain.todos(person('alex-sample', 'team'));
    expect([list.changes, list.canAttach, list.canUpload]).toEqual(['restricted', false, false]);
  });

  it('canUpload needs tdsapp-files there, allowed for this person, with "files-add-v1"', async () => {
    const cases: [Setup, boolean][] = [
      [{ filesCaps: null }, false],
      [{ filesCaps: ['files-delete-v1'] }, false],
      [{ filesRoles: 'owner' }, false],
      [{ filesCaps: ['files-add-v1'] }, true],
    ];
    for (const [opts, want] of cases) {
      const list = await setup(opts).brain.todos(sam);
      expect([list.canAttach, list.canUpload], JSON.stringify(opts)).toEqual([true, want]);
    }
  });
});

describe('changeTodo with canAttach (decisions 2 and 6)', () => {
  it('edit always sends keep_files: true, and the details alone', async () => {
    const { brain, calls } = setup();
    await brain.changeTodo({ kind: 'edit', id: MINE, title: 'Send it', details: 'Only details' }, sam);
    await brain.changeTodo({ kind: 'edit', id: MINE, title: 'Send it' }, sam);
    expect(calls().map((c) => c.body)).toEqual([
      { file: MINE, title: 'Send it', body: 'Only details', keep_files: true },
      { file: MINE, title: 'Send it', keep_files: true },
    ]);
  });

  it('refuses details holding a ## Files heading, running nothing', async () => {
    const { brain, calls } = setup();
    for (const details of [
      'Intro\n\n## Files\n\n- [a](../templates/a.md)',
      '## files',
      'x\r\n##   Files  \r\n',
    ]) {
      expect(
        (await codeOf(brain.changeTodo({ kind: 'edit', id: MINE, title: 'T', details }, sam)))?.code,
      ).toBe('bad-request');
    }
    // A Files heading at another level, or words after it, is ordinary text.
    await brain.changeTodo(
      { kind: 'edit', id: MINE, title: 'T', details: '### Files\n## Files to send' },
      sam,
    );
    expect(calls()).toHaveLength(1);
  });

  it('without canAttach, refuses as changed an edit that would drop the on-disk Files section', async () => {
    const { root, brain, calls } = setup({ todoCaps: ['handover', 'scope'] });
    put(root, 'templates/brief.md');
    writeTodo(
      root,
      `todo/${MINE}`,
      '---\nassignee: sam-example\n---\nOld.\n\n## Files\n\n- [brief.md](../templates/brief.md)\n',
    );
    const r = await codeOf(
      brain.changeTodo({ kind: 'edit', id: MINE, title: 'T', details: 'New.', detailsOnly: true }, sam),
    );
    expect(r?.code).toBe('changed');
    expect(calls()).toHaveLength(0);
    // Without the flag it is the whole body, as on main: removing a hand-written heading still saves.
    await brain.changeTodo({ kind: 'edit', id: MINE, title: 'T', details: 'New.' }, sam);
    // The whole body, section kept, still goes through.
    await brain.changeTodo(
      {
        kind: 'edit',
        id: MINE,
        title: 'T',
        details: 'New.\n\n## Files\n\n- [brief.md](../templates/brief.md)',
      },
      sam,
    );
    expect(calls()).toHaveLength(2);
  });

  it('without canAttach, edit is unchanged and a ## Files heading is allowed (the whole body)', async () => {
    const { brain, calls } = setup({ todoCaps: ['handover', 'scope'] });
    await brain.changeTodo({ kind: 'edit', id: MINE, title: 'T', details: 'A\n\n## Files\n' }, sam);
    expect(calls().map((c) => c.body)).toEqual([{ file: MINE, title: 'T', body: 'A\n\n## Files\n' }]);
  });

  it('add passes details as body with canAttach, and drops them without', async () => {
    const on = setup();
    const add: TodoAction = {
      kind: 'add',
      title: 'Call Ben',
      due: null,
      assignee: 'alex-sample',
      details: 'Ask about the brief.',
    };
    await on.brain.changeTodo(add, sam);
    expect(on.calls()[0]?.body).toMatchObject({ title: 'Call Ben', body: 'Ask about the brief.' });
    const off = setup({ todoCaps: ['handover', 'scope'] });
    await off.brain.changeTodo(add, sam);
    expect(off.calls()[0]?.body).not.toHaveProperty('body');
    expect(
      (await codeOf(on.brain.changeTodo({ ...add, details: 'x'.repeat(8001) } as TodoAction, sam)))?.code,
    ).toBe('bad-request');
  });

  it('attach and detach send file, path, expect and scope with who and the app', async () => {
    const { root, brain, calls } = setup();
    put(root, 'clients/acme-heating/images/logo.png');
    const expectV = versionOf(root, `todo/${MINE}`);
    await brain.changeTodo(
      { kind: 'attach', id: MINE, path: 'clients/acme-heating/images/logo.png', expect: expectV },
      sam,
    );
    await brain.changeTodo({ kind: 'detach', id: MINE, path: 'clients/acme-heating/images/gone.png' }, sam);
    expect(calls()).toEqual([
      {
        script: 'todo',
        command: 'attach',
        body: {
          file: MINE,
          path: 'clients/acme-heating/images/logo.png',
          expect: expectV,
          via: 'TDS Cortex',
          by: 'sam-example',
          by_name: 'sam-example',
        },
      },
      {
        script: 'todo',
        command: 'detach',
        body: {
          file: MINE,
          path: 'clients/acme-heating/images/gone.png',
          via: 'TDS Cortex',
          by: 'sam-example',
          by_name: 'sam-example',
        },
      },
    ]);
  });

  it('refuses attach and detach with not-allowed without canAttach', async () => {
    const { root, brain, calls } = setup({ todoCaps: ['handover', 'scope'] });
    put(root, 'clients/acme-heating/images/logo.png');
    for (const kind of ['attach', 'detach'] as const) {
      const action = { kind, id: MINE, path: 'clients/acme-heating/images/logo.png' };
      expect((await codeOf(brain.changeTodo(action, sam)))?.code).toBe('not-allowed');
    }
    expect(calls()).toEqual([]);
  });

  it('refuses an attach path that is not a real, listable file under the three roots', async () => {
    const { root, brain, calls } = setup();
    put(root, 'clients/acme-heating/config/secret.md');
    put(root, 'todo/other.md');
    const outside = tempDir();
    put(outside, 'x.png');
    mkdirSync(join(root, 'clients/acme-heating/images'), { recursive: true });
    symlinkSync(join(outside, 'x.png'), join(root, 'clients/acme-heating/images/link.png'));
    for (const path of [
      'clients/acme-heating/images/missing.png',
      'clients/acme-heating/images/link.png',
      'clients/acme-heating/config/secret.md',
      'clients/acme-heating/images',
      '../clients/acme-heating/plans/q1-plan.docx',
      'clients/acme-heating/../acme-heating/plans/q1-plan.docx',
      '/clients/acme-heating/plans/q1-plan.docx',
      'todo/other.md',
      'clients\\acme-heating\\plans\\q1-plan.docx',
      'clients/acme-heating/plans/q1%2Dplan.docx',
      '',
      'x'.repeat(2000),
    ]) {
      const got = await codeOf(brain.changeTodo({ kind: 'attach', id: MINE, path }, sam));
      expect(got?.code, path).toBe('bad-request');
    }
    for (const path of ['../templates/a.md', 'todo/x.md', '']) {
      const got = await codeOf(brain.changeTodo({ kind: 'detach', id: MINE, path }, sam));
      expect(got?.code, path).toBe('bad-request');
    }
    expect(calls()).toEqual([]);
  });

  it(`refuses a new attach past TODO_ATTACHMENTS_MAX (${TODO_ATTACHMENTS_MAX}), but not one already linked`, async () => {
    const { root, brain, calls } = setup();
    const lines: string[] = [];
    for (let i = 0; i < TODO_ATTACHMENTS_MAX; i++) {
      put(root, `templates/f${i}.md`);
      lines.push(`- [f${i}.md](../templates/f${i}.md)`);
    }
    put(root, 'templates/one-more.md');
    writeTodo(root, `todo/${MINE}`, `---\nassignee: sam-example\n---\n## Files\n\n${lines.join('\n')}\n`);
    const full = await codeOf(
      brain.changeTodo({ kind: 'attach', id: MINE, path: 'templates/one-more.md' }, sam),
    );
    expect(full?.code).toBe('bad-request');
    expect(full?.message).toMatch(/20 files/);
    await brain.changeTodo({ kind: 'attach', id: MINE, path: 'templates/f3.md' }, sam);
    expect(calls().map((c) => c.command)).toEqual(['attach']);
  });
});

describe('uploadTodoFile (decision 3)', () => {
  function staged(name = 'logo.png'): string {
    const dir = tempDir('tba-staged-');
    writeFileSync(join(dir, name), 'png bytes');
    return join(dir, name);
  }

  it('saves to the client through tdsapp-files, then attaches with expect', async () => {
    const saved = 'clients/acme-heating/images/logo (2).png';
    const { root, brain, calls } = setup({
      filesReplies: { add: { out: JSON.stringify({ ok: true, action: 'add', path: saved }) } },
    });
    const expectV = versionOf(root, 'todo/20261101-renew-contract.md');
    const source = staged();
    const out = await brain.uploadTodoFile(
      {
        stagedPath: source,
        name: 'logo.png',
        id: '20261101-renew-contract.md',
        scope: 'tds',
        expect: expectV,
      },
      sam,
    );
    expect(out).toEqual({ path: saved, personal: false });
    expect(calls()).toEqual([
      {
        script: 'files',
        command: 'add',
        body: {
          source,
          path: 'clients/acme-heating/images/logo.png',
          via: 'TDS Cortex',
          by_name: 'sam-example',
        },
      },
      {
        script: 'todo',
        command: 'attach',
        body: {
          file: '20261101-renew-contract.md',
          path: saved,
          expect: expectV,
          via: 'TDS Cortex',
          by: 'sam-example',
          by_name: 'sam-example',
        },
      },
    ]);
  });

  it('goes to personal files for a to-do with no client, and says so', async () => {
    const { root, brain, calls } = setup({
      filesReplies: { add: { out: JSON.stringify({ ok: true, path: 'personal/files/brief.pdf' }) } },
    });
    const out = await brain.uploadTodoFile(
      {
        stagedPath: staged('brief.pdf'),
        name: 'brief.pdf',
        id: MINE,
        scope: 'tds',
        expect: versionOf(root, `todo/${MINE}`),
      },
      sam,
    );
    expect(out).toEqual({ path: 'personal/files/brief.pdf', personal: true });
    expect(calls()[0]?.body.path).toBe('personal/files/brief.pdf');
  });

  it('says the file was saved but not linked when attach fails after add, keeping the code', async () => {
    const saved = 'personal/files/brief.pdf';
    const { root, brain, calls } = setup({
      filesReplies: { add: { out: JSON.stringify({ ok: true, path: saved }) } },
      todoReplies: { attach: { exit: 2, out: '{"ok":false,"status":409,"error":"changed"}' } },
    });
    const got = await codeOf(
      brain.uploadTodoFile(
        {
          stagedPath: staged('brief.pdf'),
          name: 'brief.pdf',
          id: MINE,
          scope: 'tds',
          expect: versionOf(root, `todo/${MINE}`),
        },
        sam,
      ),
    );
    expect(got?.code).toBe('changed');
    expect(got?.message).toContain(`saved to the library at ${saved}`);
    expect(got?.message).toMatch(/couldn.t be linked/);
    expect(calls().map((c) => c.command)).toEqual(['add', 'attach']);
  });

  it('never attaches when add fails, or when its reply names somewhere else', async () => {
    const failed = setup({
      filesReplies: { add: { exit: 2, out: '{"ok":false,"code":"bad-request","error":"x"}' } },
    });
    const req = (root: string) => ({
      stagedPath: staged('brief.pdf'),
      name: 'brief.pdf',
      id: MINE,
      scope: 'tds' as const,
      expect: versionOf(root, `todo/${MINE}`),
    });
    expect((await codeOf(failed.brain.uploadTodoFile(req(failed.root), sam)))?.code).toBe('bad-request');
    expect(failed.calls().map((c) => c.command)).toEqual(['add']);
    const odd = setup({
      filesReplies: { add: { out: JSON.stringify({ ok: true, path: 'templates/brief.pdf' }) } },
    });
    expect((await codeOf(odd.brain.uploadTodoFile(req(odd.root), sam)))?.code).toBe('internal');
    expect(odd.calls().map((c) => c.command)).toEqual(['add']);
  });

  it('refuses before anything runs: no canUpload, a bad type, a stale version, an unknown to-do, a full one', async () => {
    const base = (root: string, over: Record<string, unknown> = {}) => ({
      stagedPath: staged('brief.pdf'),
      name: 'brief.pdf',
      id: MINE,
      scope: 'tds' as const,
      expect: versionOf(root, `todo/${MINE}`),
      ...over,
    });
    const noFiles = setup({ filesCaps: ['files-delete-v1'] });
    expect((await codeOf(noFiles.brain.uploadTodoFile(base(noFiles.root), sam)))?.code).toBe('not-allowed');
    const s = setup();
    const cases: [Record<string, unknown>, string][] = [
      [{ name: 'page.html' }, 'bad-request'],
      [{ name: 'icon.svg' }, 'bad-request'],
      [{ expect: 'a'.repeat(64) }, 'changed'],
      [{ expect: 'nope' }, 'bad-request'],
      [{ id: '20261102-alex-task.md' }, 'not-found'],
      [{ id: '../x.md' }, 'bad-request'],
      [{ scope: 'personal' }, 'not-found'],
      [{ scope: 'elsewhere' }, 'bad-request'],
      [{ stagedPath: 'relative/brief.pdf' }, 'bad-request'],
    ];
    for (const [over, code] of cases) {
      expect(
        (await codeOf(s.brain.uploadTodoFile(base(s.root, over) as never, sam)))?.code,
        JSON.stringify(over),
      ).toBe(code);
    }
    const lines: string[] = [];
    for (let i = 0; i < TODO_ATTACHMENTS_MAX; i++) lines.push(`- [f${i}.md](../templates/f${i}.md)`);
    writeTodo(s.root, `todo/${MINE}`, `---\nassignee: sam-example\n---\n## Files\n\n${lines.join('\n')}\n`);
    expect((await codeOf(s.brain.uploadTodoFile(base(s.root), sam)))?.code).toBe('bad-request');
    expect(noFiles.calls()).toEqual([]);
    expect(s.calls()).toEqual([]);
  });
});
