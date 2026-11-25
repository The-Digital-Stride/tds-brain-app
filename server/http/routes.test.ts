import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  type AskedTodoList,
  type DoneTodoList,
  type LibraryListing,
  type LibraryRecentResponse,
  type LibrarySearchResponse,
  MAX_ATTACHMENTS,
  ROUTES,
  SESSION_COOKIE,
  sessionCookieName,
  type TeamTodo,
  TODO_SCRIPT,
  type TodoHistoryResponse,
  type TodoList,
  type TodoUploadResponse,
  UPLOAD_NAME_HEADER,
  type UploadResponse,
} from '../../shared/contract.ts';
import {
  FILES_CHANGE_MESSAGES,
  FILES_CHANGE_STATUS,
  FilesChangeError,
  type FilesErrorCode,
} from '../../shared/files-contract.ts';
import { type AppState, SETUP_ROUTES, type SetupService } from '../../shared/install-contract.ts';
import { USAGE_SAVINGS_PATH } from '../../shared/kits-contract.ts';
import { LINK_SCRIPT_TAG } from '../../shared/page-links.ts';
import { PAGE_NOTE_MAX } from '../../shared/pages-contract.ts';
import { createBrainReaders } from '../brain/index.ts';
import { SkillLevelError } from '../brain/skill-levels.ts';
import { copyFixture } from '../brain/test-helpers.ts';
import { createThumbnailer } from '../brain/thumbs.ts';
import type { GitLogRunner } from '../brain/todo-history.ts';
import { SessionError } from '../engine/session-manager.ts';
import {
  createEngineHealth,
  createSetupBrain,
  createSetupSessions,
  createSetupThumbs,
  createSetupUploads,
} from '../setup-mode.ts';
import { createUploadStaging, type UploadStaging } from '../uploads/staging.ts';
import {
  HttpError,
  handleApi,
  parseChatSummaryDraft,
  parseProjectAction,
  parseStartRequest,
  parseTodoAction,
  type RouteContext,
  validatePrefsPatch,
} from './routes.ts';
import {
  checkRequest,
  cookieValueFor,
  createAuthCodes,
  PAGE_CSP,
  PAGE_PREVIEW_CSP,
  PDF_CSP,
  SECURITY_HEADERS,
  sessionSetCookie,
} from './security.ts';
import { createAppServer } from './server.ts';

const tempDirs: string[] = [];
const stagings: UploadStaging[] = [];
afterAll(() => {
  for (const s of stagings.splice(0)) s.close();
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('parseStartRequest', () => {
  it('passes prompt, client, resume and todoId through', () => {
    expect(
      parseStartRequest({ prompt: 'hi', client: 'acme', resume: null, todoId: '20261111-x.md' }),
    ).toEqual({
      prompt: 'hi',
      client: 'acme',
      resume: null,
      todoId: '20261111-x.md',
    });
    expect(parseStartRequest({ prompt: 'hi', todoId: null })).toEqual({ prompt: 'hi', todoId: null });
    expect(parseStartRequest({ prompt: 'hi' })).toEqual({ prompt: 'hi' });
  });

  it('refuses a todoId that is not text or null', () => {
    for (const todoId of [42, true, ['a'], { id: 'a' }]) {
      expect(() => parseStartRequest({ prompt: 'hi', todoId })).toThrow(HttpError);
    }
  });

  it('passes a list of attachment ids through', () => {
    expect(parseStartRequest({ prompt: '', attachments: ['a', 'b'] })).toEqual({
      prompt: '',
      attachments: ['a', 'b'],
    });
    expect(parseStartRequest({ attachments: [] })).toEqual({ attachments: [] });
    expect(parseStartRequest({ prompt: 'hi', attachments: null })).toEqual({ prompt: 'hi', attachments: [] });
  });

  it('refuses attachments that are not a short list of ids', () => {
    for (const attachments of [
      'a',
      {},
      [1],
      [''],
      ['a', null],
      ['x'.repeat(200)],
      Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => `id-${i}`),
    ]) {
      expect(() => parseStartRequest({ prompt: 'hi', attachments }), JSON.stringify(attachments)).toThrow(
        HttpError,
      );
    }
  });

  it('passes a project through, and null clears it (Projects R2 phase 1)', () => {
    expect(parseStartRequest({ prompt: 'hi', client: 'acme', project: 'acme/web' })).toEqual({
      prompt: 'hi',
      client: 'acme',
      project: 'acme/web',
    });
    expect(parseStartRequest({ prompt: 'hi', project: null })).toEqual({ prompt: 'hi', project: null });
    for (const project of [42, true, ['acme/web'], { key: 'acme/web' }]) {
      expect(() => parseStartRequest({ prompt: 'hi', project })).toThrow(HttpError);
    }
  });

  it('refuses other fields of the wrong type, and a body that is not an object', () => {
    expect(() => parseStartRequest({ prompt: 7 })).toThrow(HttpError);
    expect(() => parseStartRequest({ client: 7 })).toThrow(HttpError);
    expect(() => parseStartRequest({ resume: 7 })).toThrow(HttpError);
    expect(() => parseStartRequest([])).toThrow(HttpError);
  });
});

describe('POST /api/todos/complete', () => {
  const TODO = '20261105-send-report.md';

  async function tick(directWrites: boolean) {
    const root = copyFixture();
    const whoami = { name: 'Sam Example', slug: 'sam-example', role: 'scout', knownMember: true };
    const brain = createBrainReaders(root, {
      run: async () => ({ stdout: JSON.stringify(whoami) }),
      now: () => new Date('2026-11-11T17:07:38Z'),
    });
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ id: TODO }))]), {
      method: 'POST',
      headers: {},
    });
    const sent = { status: 0, body: '' };
    const res = {
      headersSent: false,
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    const ctx = { brain, store: { get: async () => ({ directWrites }) }, log: () => {} };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL('http://127.0.0.1:3877/api/todos/complete'),
      ctx as unknown as RouteContext,
    );
    return { root, sent };
  }

  it('records the person using the app as the one who ticked it', async () => {
    const { root, sent } = await tick(true);
    expect(sent.status).toBe(200);
    expect(existsSync(join(root, 'todo', TODO))).toBe(false);
    const done = readFileSync(join(root, 'todo', 'done', TODO), 'utf8');
    expect(done).toContain('\ncompleted_at: 2026-11-11T17:07:38+00:00\ncompleted_by: sam-example\n');
    expect(done).toContain('Ticked off by Sam Example at 17:07 UK time (TDS Cortex).');
    expect(JSON.parse(sent.body).mine.map((t: { id: string }) => t.id)).not.toContain(TODO);
  });

  it('changes nothing while changes to the shared brain are switched off', async () => {
    const { root, sent } = await tick(false);
    expect(sent.status).toBe(403);
    expect(existsSync(join(root, 'todo', TODO))).toBe(true);
    expect(existsSync(join(root, 'todo', 'done', TODO))).toBe(false);
  });
});

describe('parseTodoAction', () => {
  it('passes each action shape through', () => {
    const good = [
      { kind: 'add', title: 'Call Ben', due: null, assignee: 'sam-example' },
      { kind: 'add', title: 'Call Ben', due: '2026-11-20', assignee: 'sam-example' },
      { kind: 'edit', id: 'a.md', title: 'T' },
      { kind: 'edit', id: 'a.md', title: 'T', details: '' },
      { kind: 'due', id: 'a.md', due: null },
      { kind: 'due', id: 'a.md', due: '2026-11-20' },
      { kind: 'assignee', id: 'a.md', assignee: null },
      { kind: 'assignee', id: 'a.md', assignee: 'ben-mcadam' },
      { kind: 'delete', id: 'a.md' },
      { kind: 'add', title: 'Anyone', due: null, assignee: null },
      { kind: 'edit', id: 'a.md', title: 'T', expect: 'a'.repeat(64) },
      { kind: 'due', id: 'a.md', due: null, expect: 'a'.repeat(64) },
      { kind: 'assignee', id: 'a.md', assignee: null, expect: 'a'.repeat(64) },
      { kind: 'delete', id: 'a.md', expect: 'a'.repeat(64) },
      { kind: 'add', title: 'T', due: null, assignee: 'sam-example', scope: 'personal' },
      { kind: 'edit', id: 'a.md', title: 'T', scope: 'tds', expect: 'a'.repeat(64) },
      { kind: 'due', id: 'a.md', due: null, scope: 'personal', expect: 'a'.repeat(64) },
      { kind: 'delete', id: 'a.md', scope: 'personal', expect: 'a'.repeat(64) },
      { kind: 'move', id: 'a.md', scope: 'personal', to: 'tds', expect: 'a'.repeat(64) },
      { kind: 'move', id: 'a.md', scope: 'tds', to: 'personal' },
    ];
    for (const body of good) expect(parseTodoAction(body), JSON.stringify(body)).toEqual(body);
  });

  it('refuses anything that is not exactly one of the shapes', () => {
    const bad: unknown[] = [
      null,
      [],
      'delete',
      {},
      { kind: 'tick', id: 'a.md' },
      { kind: 'toString', id: 'a.md' },
      { kind: 'delete' },
      { kind: 'delete', id: 7 },
      { kind: 'delete', id: 'a.md', extra: 1 },
      { kind: 'add', title: 'x', assignee: 'sam' },
      { kind: 'add', title: 'x', due: null },
      { kind: 'add', title: 7, due: null, assignee: 'sam' },
      { kind: 'add', title: 'x', due: 20261120, assignee: 'sam' },
      { kind: 'add', title: 'x', due: null, assignee: 5 },
      { kind: 'delete', id: 'a.md', expect: null },
      { kind: 'delete', id: 'a.md', expect: 5 },
      { kind: 'add', id: 'a.md', title: 'x', due: null, assignee: 'sam' },
      { kind: 'edit', id: 'a.md' },
      { kind: 'edit', id: 'a.md', title: 'x', details: null },
      { kind: 'edit', id: 'a.md', title: 'x', body: 'y' },
      { kind: 'due', id: 'a.md' },
      { kind: 'due', id: 'a.md', due: false },
      { kind: 'assignee', id: 'a.md' },
      { kind: 'assignee', id: 'a.md', assignee: ['sam'] },
      { kind: 'delete', id: 'a.md', scope: 'secret' },
      { kind: 'delete', id: 'a.md', scope: null },
      { kind: 'move', id: 'a.md', scope: 'tds' },
      { kind: 'move', id: 'a.md', to: 'personal' },
      { kind: 'move', id: 'a.md', scope: 'tds', to: 'elsewhere' },
      { kind: 'move', id: 'a.md', scope: 'tds', to: 'personal', title: 'x' },
    ];
    for (const body of bad) {
      expect(() => parseTodoAction(body), JSON.stringify(body)).toThrow(
        "That change couldn't be saved. Try again, or make it in a chat instead.",
      );
    }
  });
});

describe('POST /api/todos/change', () => {
  const MINE = '20261105-send-report.md';
  /** Records each call outside the brain; with FAKE_TODO_APPLY it really deletes, as the brain's script would. */
  const FAKE_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const body = JSON.parse(input);
  if (process.argv[2] === 'capabilities') {
    if (process.env.FAKE_TODO_CAPS) { process.stdout.write(JSON.stringify({ version: '0.4', features: JSON.parse(process.env.FAKE_TODO_CAPS) })); return; }
    process.stdout.write('{"ok":false,"status":400,"error":"unknown command"}'); process.exitCode = 2; return;
  }
  fs.appendFileSync(process.env.FAKE_TODO_LOG, JSON.stringify({ command: process.argv[2], body }) + '\\n');
  if (process.env.FAKE_TODO_APPLY && process.argv[2] === 'delete') {
    fs.unlinkSync(path.join(process.env.BRAIN_ROOT, 'todo', body.file));
  }
  const reply = JSON.parse(process.env.FAKE_TODO_REPLY || '{}');
  process.stdout.write(reply.out || '{"ok":true}');
  process.exitCode = reply.exit || 0;
});
`;

  function makeBrain(opts: { roles?: string; reply?: object; skill?: boolean; caps?: string[] } = {}) {
    const root = copyFixture();
    if (opts.skill !== false) {
      mkdirSync(join(root, '.claude', 'skills', 'tdsapp-todo', 'scripts'), { recursive: true });
      writeFileSync(
        join(root, '.claude', 'skills', 'tdsapp-todo', 'SKILL.md'),
        `---\ndescription: Change tasks.\nroles: ${opts.roles ?? 'owner, scout'}\nmaturity: draft\n---\n`,
      );
      writeFileSync(join(root, TODO_SCRIPT), FAKE_SCRIPT);
    }
    const logDir = mkdtempSync(join(tmpdir(), 'tba-todo-log-'));
    tempDirs.push(logDir);
    const log = join(logDir, 'calls.jsonl');
    const whoami = { name: 'Sam Example', slug: 'sam-example', role: 'scout', knownMember: true };
    const brain = createBrainReaders(root, {
      run: async () => ({ stdout: JSON.stringify(whoami) }),
      todoSkill: {
        env: {
          PATH: process.env.PATH,
          FAKE_TODO_LOG: log,
          FAKE_TODO_APPLY: '1',
          FAKE_TODO_REPLY: JSON.stringify(opts.reply ?? {}),
          ...(opts.caps ? { FAKE_TODO_CAPS: JSON.stringify(opts.caps) } : {}),
        },
      },
    });
    const calls = () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l))
        : [];
    return { root, brain, calls };
  }

  async function send(
    brain: RouteContext['brain'],
    opts: { body?: unknown; directWrites?: boolean; method?: string; path?: string } = {},
  ) {
    const raw = opts.body === undefined ? [] : [Buffer.from(JSON.stringify(opts.body))];
    const req = Object.assign(Readable.from(raw), { method: opts.method ?? 'POST', headers: {} });
    const sent = { status: 0, body: '' };
    const res = {
      headersSent: false,
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    const logs: string[] = [];
    const ctx = {
      brain,
      store: { get: async () => ({ directWrites: opts.directWrites ?? true }) },
      log: (line: string) => logs.push(line),
    };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${opts.path ?? ROUTES.changeTodo}`),
      ctx as unknown as RouteContext,
    );
    return { status: sent.status, json: sent.body ? JSON.parse(sent.body) : null, logs };
  }

  it('runs the change and answers with the fresh list', async () => {
    const { root, brain, calls } = makeBrain();
    const { status, json, logs } = await send(brain, { body: { kind: 'delete', id: MINE } });
    expect(status).toBe(200);
    expect(calls()).toEqual([
      {
        command: 'delete',
        body: { file: MINE, via: 'TDS Cortex', by: 'sam-example', by_name: 'Sam Example' },
      },
    ]);
    expect(existsSync(join(root, 'todo', MINE))).toBe(false);
    const list = json as TodoList;
    expect(list.mine.map((t) => t.id)).not.toContain(MINE);
    expect(list.changes).toBe('on');
    expect(list.team.map((m) => m.slug)).toEqual(['sam-example', 'alex-sample', 'jo-owner']);
    expect(logs).toEqual(['Changed a task (delete).']);
  });

  describe('personal tasks', () => {
    const PID = '20261110-dentist.md';
    const withPersonal = (extra: Parameters<typeof makeBrain>[0] = {}) => {
      const made = makeBrain({ caps: ['handover', 'scope'], ...extra });
      mkdirSync(join(made.root, 'personal', 'todo'), { recursive: true });
      writeFileSync(
        join(made.root, 'personal', 'todo', PID),
        '---\ntitle: Book dentist\nassignee: sam-example\n---\n',
      );
      const version = createHash('sha256')
        .update(readFileSync(join(made.root, 'personal', 'todo', PID)))
        .digest('hex');
      return { ...made, version };
    };

    it('answers a move with the fresh list and moved {from, to}', async () => {
      const { brain, calls, version } = withPersonal({
        reply: { out: '{"ok":true,"file":"20261110-dentist-2.md"}' },
      });
      const { status, json } = await send(brain, {
        body: { kind: 'move', id: PID, scope: 'personal', to: 'tds', expect: version },
      });
      expect(status).toBe(200);
      expect(json.moved).toEqual({ from: `personal/${PID}`, to: '20261110-dentist-2.md' });
      expect((json as TodoList).canUsePersonal).toBe(true);
      expect(calls()[0]).toMatchObject({
        command: 'move',
        body: { file: PID, scope: 'personal', to: 'tds' },
      });
    });

    it('sends no moved for other changes', async () => {
      const { brain, version } = withPersonal();
      const { json } = await send(brain, {
        body: { kind: 'edit', id: PID, title: 'T', scope: 'personal', expect: version },
      });
      expect(json.moved).toBeUndefined();
    });

    it('ticks a personal task through the script with scope, and never writes itself', async () => {
      const { root, brain, calls, version } = withPersonal();
      const { status } = await send(brain, {
        path: ROUTES.completeTodo,
        body: { id: PID, scope: 'personal', expect: version },
      });
      expect(status).toBe(200);
      expect(calls()).toEqual([
        {
          command: 'tick',
          body: {
            file: PID,
            via: 'TDS Cortex',
            by: 'sam-example',
            by_name: 'Sam Example',
            expect: version,
            scope: 'personal',
          },
        },
      ]);
      expect(existsSync(join(root, 'personal', 'todo', 'done'))).toBe(false);
    });

    it('refuses a personal tick without expect, without the capability, or with the switch off', async () => {
      const on = withPersonal();
      const noExpect = await send(on.brain, {
        path: ROUTES.completeTodo,
        body: { id: PID, scope: 'personal' },
      });
      expect(noExpect.status).toBe(400);
      const off = withPersonal({ caps: [] });
      const noGate = await send(off.brain, {
        path: ROUTES.completeTodo,
        body: { id: PID, scope: 'personal', expect: off.version },
      });
      expect(noGate.status).toBe(403);
      const switched = await send(on.brain, {
        path: ROUTES.completeTodo,
        body: { id: PID, scope: 'personal', expect: on.version },
        directWrites: false,
      });
      expect(switched.status).toBe(403);
      const badScope = await send(on.brain, { path: ROUTES.completeTodo, body: { id: PID, scope: 'x' } });
      expect(badScope.status).toBe(400);
      expect(on.calls()).toEqual([]);
      expect(off.calls()).toEqual([]);
    });

    it("a tick with scope tds (or none) still uses the app's own direct tick", async () => {
      const { root, brain, calls } = withPersonal();
      const { status } = await send(brain, {
        path: ROUTES.completeTodo,
        body: { id: '20261105-send-report.md', scope: 'tds' },
      });
      expect(status).toBe(200);
      expect(calls()).toEqual([]);
      expect(existsSync(join(root, 'todo', 'done', '20261105-send-report.md'))).toBe(true);
    });

    it('reports canUsePersonal false while the switch is off', async () => {
      const { brain } = withPersonal();
      const { json } = await send(brain, {
        path: ROUTES.todos,
        method: 'GET',
        directWrites: false,
      });
      expect(json.changes).toBe('switched-off');
      expect(json.canUsePersonal).toBe(false);
    });

    it('refuses a personal move without the capability, and without expect', async () => {
      const off = withPersonal({ caps: [] });
      const refused = await send(off.brain, {
        body: { kind: 'move', id: PID, scope: 'personal', to: 'tds', expect: off.version },
      });
      expect(refused.status).toBe(403);
      expect(refused.json.error.code).toBe('not-allowed');
      const on = withPersonal();
      const noExpect = await send(on.brain, {
        body: { kind: 'move', id: PID, scope: 'personal', to: 'tds' },
      });
      expect(noExpect.status).toBe(400);
      expect(on.calls()).toEqual([]);
      expect(off.calls()).toEqual([]);
    });
  });

  it('changes nothing while the Settings switch is off', async () => {
    const { root, brain, calls } = makeBrain();
    const { status, json } = await send(brain, { body: { kind: 'delete', id: MINE }, directWrites: false });
    expect(status).toBe(403);
    expect(json.error).toEqual({
      code: 'not-allowed',
      message: "Adding and editing tasks is switched off. Turn on 'Let the app change tasks' in Settings.",
    });
    expect(calls()).toEqual([]);
    expect(existsSync(join(root, 'todo', MINE))).toBe(true);
  });

  it('refuses a body that is not a task change, and other methods', async () => {
    const { brain, calls } = makeBrain();
    for (const body of [
      { kind: 'delete' },
      { kind: 'tick', id: MINE },
      { kind: 'delete', id: MINE, x: 1 },
      [],
    ]) {
      const { status, json } = await send(brain, { body });
      expect(status, JSON.stringify(body)).toBe(400);
      expect(json.error.code).toBe('bad-request');
      expect(json.error.message).toBe(
        "That change couldn't be saved. Try again, or make it in a chat instead.",
      );
    }
    expect((await send(brain, { method: 'GET' })).status).toBe(405);
    expect(calls()).toEqual([]);
  });

  it("maps refusals to statuses, with the app's own words", async () => {
    const { brain } = makeBrain();
    const other = await send(brain, { body: { kind: 'delete', id: '20261102-alex-task.md' } });
    expect(other.status).toBe(404);
    expect(other.json.error).toEqual({
      code: 'not-found',
      message: 'That task could not be found. It may have been finished, deleted or passed on.',
    });
    const badDate = await send(brain, { body: { kind: 'due', id: MINE, due: '2026-02-30' } });
    expect(badDate.status).toBe(400);

    const restricted = makeBrain({ roles: 'owner' });
    expect((await send(restricted.brain, { body: { kind: 'delete', id: MINE } })).json.error.code).toBe(
      'not-allowed',
    );
    expect((await send(restricted.brain, { body: { kind: 'delete', id: MINE } })).status).toBe(403);
    expect(restricted.calls()).toEqual([]);

    const noSkill = makeBrain({ skill: false });
    expect((await send(noSkill.brain, { body: { kind: 'delete', id: MINE } })).status).toBe(403);
  });

  it("passes on the script's own refusals and failures as plain errors", async () => {
    const refused = makeBrain({ reply: { exit: 2, out: '{"error":"title required","status":400}' } });
    const r400 = await send(refused.brain, { body: { kind: 'edit', id: MINE, title: 'x' } });
    expect(r400.status).toBe(400);
    expect(r400.json.error.message).not.toContain('title required');

    const gone = makeBrain({ reply: { exit: 2, out: '{"error":"not found","status":404}' } });
    expect((await send(gone.brain, { body: { kind: 'delete', id: MINE } })).status).toBe(404);

    const crashed = makeBrain({ reply: { exit: 1, out: 'boom' } });
    const r500 = await send(crashed.brain, { body: { kind: 'delete', id: MINE } });
    expect(r500.status).toBe(500);
    expect(r500.json.error).toEqual({
      code: 'internal',
      message: 'The change could not be made. Try again.',
    });
  });

  it("answers 409 'changed' when the version is stale, and sends no script call", async () => {
    const { brain, calls } = makeBrain();
    const sent = await send(brain, { body: { kind: 'delete', id: MINE, expect: 'f'.repeat(64) } });
    expect(sent.status).toBe(409);
    expect(sent.json.error.code).toBe('changed');
    expect(sent.json.error.message).toContain('Someone else changed this task');
    expect(calls()).toEqual([]);
  });

  it('is refused in setup mode', async () => {
    expect((await send(createSetupBrain(), { body: { kind: 'delete', id: MINE } })).status).toBe(403);
  });
});

describe('GET /api/todos', () => {
  it("says 'switched-off' in place of 'on' while the Settings switch is off", async () => {
    const root = copyFixture();
    mkdirSync(join(root, '.claude', 'skills', 'tdsapp-todo', 'scripts'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'skills', 'tdsapp-todo', 'SKILL.md'),
      '---\nroles: owner, scout\n---\n',
    );
    writeFileSync(join(root, TODO_SCRIPT), '');
    const whoami = { name: 'Sam Example', slug: 'sam-example', role: 'scout', knownMember: true };
    const brain = createBrainReaders(root, { run: async () => ({ stdout: JSON.stringify(whoami) }) });
    const get = async (directWrites: boolean) => {
      const req = Object.assign(Readable.from([]), { method: 'GET', headers: {} });
      let body = '';
      const res = { headersSent: false, writeHead: () => {}, end: (t: string) => (body = t) };
      await handleApi(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        new URL(`http://127.0.0.1:3877${ROUTES.todos}`),
        { brain, store: { get: async () => ({ directWrites }) }, log: () => {} } as unknown as RouteContext,
      );
      return JSON.parse(body) as TodoList;
    };
    expect((await get(true)).changes).toBe('on');
    expect((await get(false)).changes).toBe('switched-off');
    const restricted = createBrainReaders(root, {
      run: async () => ({ stdout: JSON.stringify({ ...whoami, role: 'team' }) }),
    });
    const req = Object.assign(Readable.from([]), { method: 'GET', headers: {} });
    let body = '';
    await handleApi(
      req as unknown as IncomingMessage,
      {
        headersSent: false,
        writeHead: () => {},
        end: (t: string) => (body = t),
      } as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${ROUTES.todos}`),
      {
        brain: restricted,
        store: { get: async () => ({ directWrites: false }) },
        log: () => {},
      } as unknown as RouteContext,
    );
    expect((JSON.parse(body) as TodoList).changes).toBe('restricted');
  });
});

describe('GET ROUTES.askedTodos and ROUTES.todoHistory (plan 2026-11-16-asked-of-others)', () => {
  const whoami = { name: 'Sam Example', slug: 'sam-example', role: 'scout', knownMember: true };
  const ID = '20261101-asked-thing.md';

  function makeBrain(log: GitLogRunner) {
    const root = copyFixture();
    writeFileSync(
      join(root, 'todo', ID),
      '---\nassignee: alex-sample\nassigned_to: alex-sample\nassigned_by: sam-example\nassigned_at: 2026-11-10T09:00:00+00:00\n---\n',
    );
    return createBrainReaders(root, { run: async () => ({ stdout: JSON.stringify(whoami) }), todoLog: log });
  }

  async function get(brain: RouteContext['brain'], path: string, method = 'GET') {
    const req = Object.assign(Readable.from([]), { method, headers: {} });
    const sent = { status: 0, body: '', headers: {} as Record<string, unknown> };
    const res = {
      headersSent: false,
      writeHead: (status: number, headers: Record<string, unknown>) => {
        sent.status = status;
        sent.headers = headers;
      },
      end: (t: string) => {
        sent.body = t;
      },
    };
    const logs: string[] = [];
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${path}`),
      {
        brain,
        store: { get: async () => ({ directWrites: false }) },
        log: (l: string) => logs.push(l),
      } as unknown as RouteContext,
    );
    return {
      status: sent.status,
      headers: sent.headers,
      json: sent.body ? JSON.parse(sent.body) : null,
      logs,
    };
  }

  const gitOk: GitLogRunner = async (args) =>
    args[0] === 'rev-parse' ? { stdout: `${'e'.repeat(40)}\n`, cut: false } : { stdout: '', cut: false };

  it('lists what this person asked of others, no-store, even with the Settings switch off', async () => {
    const { status, headers, json } = await get(makeBrain(gitOk), ROUTES.askedTodos);
    expect(status).toBe(200);
    expect(headers['Cache-Control']).toBe('no-store');
    const list = json as AskedTodoList;
    expect(list.historyRead).toBe(true);
    expect(list.waiting.map((t) => [t.key, t.assignee, t.asked.slug])).toEqual([
      [`asked:todo/${ID}`, 'alex-sample', 'sam-example'],
    ]);
  });

  it('answers the history of a task, no-store', async () => {
    const res = await get(
      makeBrain(gitOk),
      `${ROUTES.todoHistory}?key=${encodeURIComponent(`asked:todo/${ID}`)}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.json as TodoHistoryResponse).toEqual({ status: 'ok', events: [], more: false });
  });

  it('400 for a missing or bad key, 404 for no such file, with no git run', async () => {
    const calls: string[] = [];
    const brain = makeBrain(async (args) => {
      calls.push(args[0] ?? '');
      return gitOk(args, '');
    });
    for (const q of ['', '?key=', '?key=..%2Fsecret.md', '?key=todo%2Fx.md', `?key=${'a'.repeat(400)}.md`]) {
      const res = await get(brain, `${ROUTES.todoHistory}${q}`);
      expect(res.status, q).toBe(400);
      expect(res.json.error.code).toBe('bad-request');
      expect(res.headers['Cache-Control']).toBe('no-store');
    }
    const missing = await get(brain, `${ROUTES.todoHistory}?key=20261101-missing.md`);
    expect(missing.status).toBe(404);
    expect(missing.json.error.code).toBe('not-found');
    expect(calls).toEqual([]);
  });

  it('git trouble is an ordinary answer, not an error', async () => {
    const brain = makeBrain(async () => Promise.reject(new Error('not a git folder')));
    const history = await get(brain, `${ROUTES.todoHistory}?key=${ID}`);
    expect(history.status).toBe(200);
    expect(history.json).toEqual({ status: 'unavailable', events: [], more: false });
    const asked = await get(brain, ROUTES.askedTodos);
    expect(asked.status).toBe(200);
    expect((asked.json as AskedTodoList).historyRead).toBe(false);
    expect((asked.json as AskedTodoList).waiting).toHaveLength(1);
  });

  it('lists finished tasks through the gate: own personal only, no-store, GET only', async () => {
    const brain = makeBrain(gitOk);
    const root = (brain as unknown as { root: string }).root;
    mkdirSync(join(root, 'personal', 'todo', 'done'), { recursive: true });
    writeFileSync(join(root, 'personal', 'todo', 'done', 'mine.md'), '---\nassignee: sam-example\n---\n');
    writeFileSync(join(root, 'personal', 'todo', 'done', 'theirs.md'), '---\nassignee: alex-sample\n---\n');
    mkdirSync(join(root, 'todo', 'done'), { recursive: true });
    writeFileSync(
      join(root, 'todo', 'done', '20261101-shared.md'),
      '---\ncompleted_by: alex-sample\ncompleted_at: 2026-11-12T09:00:00+00:00\n---\n',
    );
    const { status, headers, json } = await get(brain, ROUTES.doneTodos);
    expect(status).toBe(200);
    expect(headers['Cache-Control']).toBe('no-store');
    const keys = (json as DoneTodoList).items.map((i) => i.key);
    expect(keys).toContain('done:todo/done/20261101-shared.md');
    expect(keys).toContain('done:personal/todo/done/mine.md');
    expect(keys).not.toContain('done:personal/todo/done/theirs.md');
    expect((await get(brain, ROUTES.doneTodos, 'POST')).status).toBe(405);
    const history = await get(
      brain,
      `${ROUTES.todoHistory}?key=${encodeURIComponent('done:todo/done/20261101-shared.md')}`,
    );
    expect(history.status).toBe(200);
    const bad = await get(
      brain,
      `${ROUTES.todoHistory}?key=${encodeURIComponent('done:todo/done/..%2Fx.md')}`,
    );
    expect(bad.status).toBe(400);
  });

  it('reads one teammate task through the gate: 200, 400, 404, no-store, GET only', async () => {
    const brain = makeBrain(gitOk);
    const base = `${ROUTES.teamTodo}?id=`;
    const ok = await get(brain, `${base}${ID}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['Cache-Control']).toBe('no-store');
    expect((ok.json as TeamTodo).key).toBe(`team:todo/${ID}`);
    for (const bad of ['', '..%2Fx.md', 'personal%2Ftodo%2Fa.md', 'a.txt']) {
      expect((await get(brain, `${base}${bad}`)).status, bad).toBe(400);
    }
    expect((await get(brain, ROUTES.teamTodo)).status).toBe(400);
    const gone = await get(brain, `${base}20261101-gone.md`);
    expect(gone.status).toBe(404);
    expect(JSON.stringify(gone.json)).toContain('could not be found');
    expect((await get(brain, `${base}${ID}`, 'POST')).status).toBe(405);
  });

  it('setup mode answers a teammate task with 404', async () => {
    expect((await get(createSetupBrain(), `${ROUTES.teamTodo}?id=${ID}`)).status).toBe(404);
  });

  it('setup mode answers done empty', async () => {
    expect((await get(createSetupBrain(), ROUTES.doneTodos)).json).toEqual({ items: [], historyRead: false });
  });

  it('only GET', async () => {
    const brain = makeBrain(gitOk);
    expect((await get(brain, ROUTES.askedTodos, 'POST')).status).toBe(405);
    expect((await get(brain, `${ROUTES.todoHistory}?key=${ID}`, 'DELETE')).status).toBe(405);
  });

  it('setup mode answers empty, never an error', async () => {
    const setup = createSetupBrain();
    expect((await get(setup, ROUTES.askedTodos)).json).toEqual({ waiting: [], done: [], historyRead: false });
    expect((await get(setup, `${ROUTES.todoHistory}?key=${ID}`)).json).toEqual({
      status: 'unavailable',
      events: [],
      more: false,
    });
  });
});

describe('GET /api/bootstrap', () => {
  const TOKEN = 'launch-token-abc123';
  const GOOD_COOKIE = `${SESSION_COOKIE}=${cookieValueFor(TOKEN)}`;

  async function call(
    cookie: string | undefined,
    method = 'GET',
    underService = false,
    appState: AppState = { kind: 'ready' },
  ) {
    const req = Object.assign(Readable.from([]), { method, headers: cookie === undefined ? {} : { cookie } });
    const sent = { status: 0, headers: {} as Record<string, unknown>, body: '' };
    const res = {
      headersSent: false,
      setHeader: (name: string, value: unknown) => {
        sent.headers[name] = value;
      },
      writeHead: (status: number, headers: Record<string, unknown> = {}) => {
        sent.status = status;
        Object.assign(sent.headers, headers);
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    const ctx = {
      brain: createBrainReaders(copyFixture()),
      store: { get: async () => ({ pins: [], lastClient: null, todoPanelOpen: false, directWrites: false }) },
      engineHealth: () => ({ ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' }),
      appVersion: '0',
      appState,
      underService,
      launchToken: TOKEN,
      port: 3877,
      log: () => {},
    };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${ROUTES.bootstrap}`),
      ctx as unknown as RouteContext,
    );
    return sent;
  }

  it('re-sends the same 400-day session cookie on every signed-in load (decision 6a)', async () => {
    for (let i = 0; i < 2; i++) {
      const sent = await call(`other=1; ${GOOD_COOKIE}`);
      expect(sent.status).toBe(200);
      expect(sent.headers['Set-Cookie']).toBe(sessionSetCookie(TOKEN, 3877));
      expect(sent.headers['Set-Cookie']).toBe(
        `${GOOD_COOKIE}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${400 * 24 * 60 * 60}`,
      );
    }
  });

  it('sends no cookie without a valid session, nor for another method', async () => {
    for (const cookie of [undefined, '', `${SESSION_COOKIE}=nope`, `${SESSION_COOKIE}=${TOKEN}`]) {
      const sent = await call(cookie);
      expect(sent.headers['Set-Cookie'], String(cookie)).toBeUndefined();
    }
    const post = await call(GOOD_COOKIE, 'POST');
    expect(post.status).toBe(405);
    expect(post.headers['Set-Cookie']).toBeUndefined();
  });

  it('says whether this copy runs as the login service, for the Settings health panel', async () => {
    expect(JSON.parse((await call(GOOD_COOKIE)).body).service).toEqual({ underService: false });
    expect(JSON.parse((await call(GOOD_COOKIE, 'GET', true)).body).service).toEqual({ underService: true });
  });

  it('says the app is ready, or in setup with what it tried (setup-screen decision 3)', async () => {
    expect(JSON.parse((await call(GOOD_COOKIE)).body).appState).toEqual({ kind: 'ready' });
    const setup: AppState = {
      kind: 'setup',
      tried: '/Users/a/gone',
      source: 'settings',
      reason: 'not-found',
    };
    expect(JSON.parse((await call(GOOD_COOKIE, 'GET', false, setup)).body).appState).toEqual(setup);
  });

  it("sends the person's profile from the brain's team profile alongside who they are", async () => {
    const { body } = await call(GOOD_COOKIE);
    const boot = JSON.parse(body);
    expect(boot.identity.name).toBe('Sam Example');
    expect(boot.profile).toEqual({
      title: 'Head of Search',
      departments: ['SEO', 'Content'],
      owns: 'Runs search delivery and the content calendar.',
    });
  });
});

describe('bootstrap in setup mode (setup-screen decision 2)', () => {
  it('reads no folder: empty lists, default permission mode, resolvePermissionMode never called', async () => {
    const resolveMode = vi.fn(() => 'acceptEdits' as const);
    const appState: AppState = { kind: 'setup', tried: null, source: null, reason: null };
    const ctx = {
      brain: createSetupBrain(),
      sessions: createSetupSessions(),
      thumbs: createSetupThumbs(),
      uploads: createSetupUploads(),
      store: { get: async () => ({ pins: [], lastClient: null, todoPanelOpen: false, directWrites: false }) },
      engineHealth: createEngineHealth(null, '/bin/claude', '/Users/a', resolveMode),
      appVersion: '0',
      appState,
      underService: true,
      launchToken: 'launch-token-abc123',
      port: 3877,
      log: () => {},
    };
    const sent = { status: 0, body: '' };
    const res = {
      headersSent: false,
      setHeader: () => {},
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    await handleApi(
      Object.assign(Readable.from([]), { method: 'GET', headers: {} }) as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${ROUTES.bootstrap}`),
      ctx as unknown as RouteContext,
    );
    expect(sent.status).toBe(200);
    const boot = JSON.parse(sent.body);
    expect(boot.appState).toEqual(appState);
    expect(boot.brain.ok).toBe(false);
    expect(boot.skills).toEqual([]);
    expect(boot.clients).toEqual([]);
    expect(boot.usedOften).toEqual([]);
    expect(boot.identity.role).toBe('unknown');
    expect(boot.engine.permissionMode).toBe('default');
    expect(resolveMode).not.toHaveBeenCalled();
  });
});

describe('setup routes (setup-screen decision 4)', () => {
  type Sent = { status: number; body: string };

  function fakeSetup(saveResult: Awaited<ReturnType<SetupService['save']>>) {
    const calls = { save: [] as string[], restart: 0 };
    const setup: SetupService = {
      candidates: async () => ({
        candidates: ['/Users/a/agencybrain'],
        current: null,
        openChats: 2,
        envOverride: false,
      }),
      save: async (p) => {
        calls.save.push(p);
        return saveResult;
      },
      restart: () => {
        calls.restart += 1;
      },
    };
    return { setup, calls };
  }

  async function call(setup: SetupService, path: string, method: string, body?: string) {
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(body)]), {
      method,
      headers: {},
    });
    const sent: Sent = { status: 0, body: '' };
    const res = Object.assign(new EventEmitter(), {
      headersSent: false,
      setHeader: () => {},
      writeHead(status: number) {
        sent.status = status;
        res.headersSent = true;
      },
      end(text?: string) {
        if (text !== undefined) sent.body = text;
      },
    });
    const ctx = { setup, log: () => {} } as unknown as RouteContext;
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${path}`),
      ctx,
    );
    return { sent, res };
  }

  it('lists the candidates on GET only', async () => {
    const { setup } = fakeSetup({ ok: false, reason: 'not-found' });
    const { sent } = await call(setup, SETUP_ROUTES.candidates, 'GET');
    expect(sent.status).toBe(200);
    expect(JSON.parse(sent.body)).toEqual({
      candidates: ['/Users/a/agencybrain'],
      current: null,
      openChats: 2,
      envOverride: false,
    });
    expect((await call(setup, SETUP_ROUTES.candidates, 'POST', '{}')).sent.status).toBe(405);
  });

  it('saves on PUT only, passing the path as sent', async () => {
    const { setup, calls } = fakeSetup({ ok: false, reason: 'missing-roles' });
    const { sent } = await call(setup, SETUP_ROUTES.brain, 'PUT', JSON.stringify({ path: " '~/b' " }));
    expect(sent.status).toBe(200);
    expect(JSON.parse(sent.body)).toEqual({ ok: false, reason: 'missing-roles' });
    expect(calls.save).toEqual([" '~/b' "]);
    expect((await call(setup, SETUP_ROUTES.brain, 'POST', '{"path":"/a"}')).sent.status).toBe(405);
    expect((await call(setup, SETUP_ROUTES.brain, 'GET')).sent.status).toBe(405);
    expect(calls.save).toHaveLength(1);
  });

  it('answers bad-request for a body that is not an object, a path that is not text, or one over 4 KB', async () => {
    const { setup, calls } = fakeSetup({ ok: true, path: '/a', restarting: true });
    for (const body of [
      '[]',
      '"x"',
      '{}',
      '{"path":42}',
      '{"path":null}',
      '{"path":["/a"]}',
      '{ broken',
      JSON.stringify({ path: `/${'a'.repeat(4096)}` }),
    ]) {
      const { sent } = await call(setup, SETUP_ROUTES.brain, 'PUT', body);
      expect(sent.status, body.slice(0, 20)).toBe(400);
      expect(JSON.parse(sent.body).error.code).toBe('bad-request');
    }
    expect(calls.save).toEqual([]);
    expect(calls.restart).toBe(0);
  });

  it("restarts only once the answer has gone out (the response's finish event)", async () => {
    const { setup, calls } = fakeSetup({ ok: true, path: '/Users/a/brain', restarting: true });
    const { sent, res } = await call(
      setup,
      SETUP_ROUTES.brain,
      'PUT',
      JSON.stringify({ path: '/Users/a/brain' }),
    );
    expect(JSON.parse(sent.body)).toEqual({ ok: true, path: '/Users/a/brain', restarting: true });
    expect(calls.restart).toBe(0);
    res.emit('finish');
    expect(calls.restart).toBe(1);
  });

  it('never restarts when not restarting, nor after a refusal', async () => {
    for (const result of [
      { ok: true, path: '/Users/a/brain', restarting: false } as const,
      { ok: false, reason: 'env-override' } as const,
    ]) {
      const { setup, calls } = fakeSetup(result);
      const { res } = await call(
        setup,
        SETUP_ROUTES.brain,
        'PUT',
        JSON.stringify({ path: '/Users/a/brain' }),
      );
      res.emit('finish');
      expect(calls.restart).toBe(0);
    }
  });
});

describe('GET /api/brain/sync', () => {
  async function call(path: string, method = 'GET') {
    const root = copyFixture();
    mkdirSync(join(root, '.git'), { recursive: true });
    const when = new Date('2026-11-12T11:24:44.000Z');
    writeFileSync(join(root, '.git', 'FETCH_HEAD'), 'abc\n');
    utimesSync(join(root, '.git', 'FETCH_HEAD'), when, when);
    const req = Object.assign(Readable.from([]), { method, headers: {} });
    const sent = { status: 0, headers: {} as Record<string, unknown>, body: '' };
    const res = {
      headersSent: false,
      writeHead: (status: number, headers: Record<string, unknown> = {}) => {
        sent.status = status;
        sent.headers = headers;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    const ctx = { brain: createBrainReaders(root), log: () => {} };
    try {
      await handleApi(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        new URL(`http://127.0.0.1:3877${path}`),
        ctx as unknown as RouteContext,
      );
    } catch (err) {
      if (err instanceof HttpError) sent.status = err.status;
      else throw err;
    }
    return sent;
  }

  it('says when the brain last synced, never cached', async () => {
    const sent = await call(ROUTES.sync);
    expect(sent.status).toBe(200);
    expect(sent.headers['Cache-Control']).toBe('no-store');
    expect(JSON.parse(sent.body)).toEqual({ lastSync: '2026-11-12T11:24:44.000Z' });
  });

  it('only answers GET', async () => {
    expect((await call(ROUTES.sync, 'POST')).status).toBe(405);
  });
});

describe('library routes', () => {
  type Sent = { status: number; headers: Record<string, string | number>; body: Buffer };

  function setup() {
    const root = copyFixture();
    const dataDir = mkdtempSync(join(tmpdir(), 'tba-routes-'));
    tempDirs.push(dataDir);
    const ctx = {
      brain: createBrainReaders(root),
      thumbs: createThumbnailer(dataDir, { brainRoot: root }),
      log: () => {},
    } as unknown as RouteContext;
    return { root, ctx };
  }

  async function call(ctx: RouteContext, path: string, method = 'GET', body?: unknown): Promise<Sent> {
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
      method,
      headers: {},
    });
    const sent: Sent = { status: 0, headers: {}, body: Buffer.alloc(0) };
    const res = {
      headersSent: false,
      setHeader(name: string, value: string | number) {
        sent.headers[name.toLowerCase()] = value;
      },
      writeHead(status: number, headers: Record<string, string | number> = {}) {
        sent.status = status;
        for (const [k, v] of Object.entries(headers)) sent.headers[k.toLowerCase()] = v;
        res.headersSent = true;
      },
      end(body?: string | Buffer) {
        if (body !== undefined) sent.body = Buffer.isBuffer(body) ? body : Buffer.from(body);
      },
    };
    // as the server does for every reply
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${path}`),
      ctx,
    );
    return sent;
  }

  const json = (s: Sent) => JSON.parse(s.body.toString('utf8'));

  async function idOf(ctx: RouteContext, name: string, scope = 'client:acme-heating'): Promise<string> {
    const listing = json(await call(ctx, ROUTES.library(scope))) as LibraryListing;
    const id = listing.items.find((i) => i.name === name)?.id;
    if (!id) throw new Error(`missing ${name}`);
    return id;
  }

  it('searches the library', async () => {
    const { ctx } = setup();
    const ok = await call(ctx, `${ROUTES.librarySearch}?q=${encodeURIComponent('  acme logo ')}&kind=image`);
    expect(ok.status).toBe(200);
    const body = json(ok) as LibrarySearchResponse;
    expect(body.total).toBe(body.hits.length);
    expect(body.hits.every((h) => h.item.kind === 'image' && h.scope.id.length > 0)).toBe(true);
    expect(body.hits.some((h) => h.item.name === 'logo.png' && h.scope.id === 'client:acme-heating')).toBe(
      true,
    );
    const docs = json(await call(ctx, `${ROUTES.librarySearch}?q=logo&kind=doc`)) as LibrarySearchResponse;
    expect(docs.hits.every((h) => h.item.kind === 'document')).toBe(true);
  });

  it('lists the recent files of one kind', async () => {
    const { ctx } = setup();
    const ok = await call(ctx, `${ROUTES.libraryRecent}?kind=image`);
    expect(ok.status).toBe(200);
    const body = json(ok) as LibraryRecentResponse;
    expect(body.partial).toBe(false);
    expect(body.files.length).toBeGreaterThan(0);
    expect(body.files.every((f) => f.item.kind === 'image' && f.scope.kind !== 'personal')).toBe(true);
    const docs = json(await call(ctx, `${ROUTES.libraryRecent}?kind=doc`)) as LibraryRecentResponse;
    expect(docs.files.every((f) => f.item.kind === 'document')).toBe(true);
    const none = json(await call(ctx, `${ROUTES.libraryRecent}?kind=doc&project=acme/nothing`));
    expect(none.files).toEqual([]);
  });

  it('refuses a bad recent kind or project, and any method but GET', async () => {
    const { ctx } = setup();
    for (const qs of ['', 'kind=video', 'kind=document', 'kind=doc&project=..%2Fx', 'kind=doc&project=']) {
      const sent = await call(ctx, `${ROUTES.libraryRecent}?${qs}`);
      expect(sent.status, qs).toBe(400);
      expect(json(sent).error.code).toBe('bad-request');
    }
    expect(json(await call(ctx, `${ROUTES.libraryRecent}?kind=x`)).error.message).toBe(
      'Choose whether to show images or documents.',
    );
    expect(json(await call(ctx, `${ROUTES.libraryRecent}?kind=doc&project=%20`)).error.message).toBe(
      'That project was not understood.',
    );
    expect((await call(ctx, `${ROUTES.libraryRecent}?kind=image`, 'POST')).status).toBe(405);
  });

  it('answers an empty list when the brain has no recent method', async () => {
    const ctx = { brain: {}, log: () => {} } as unknown as RouteContext;
    const sent = await call(ctx, `${ROUTES.libraryRecent}?kind=doc`);
    expect(sent.status).toBe(200);
    expect(json(sent)).toEqual({ files: [], partial: false });
  });

  it('refuses a bad search query or kind, and any method but GET', async () => {
    const { ctx } = setup();
    for (const qs of [
      '',
      'kind=image',
      'q=a&kind=image',
      `q=${'a'.repeat(81)}&kind=image`,
      'q=%20%20a%20%20&kind=image',
      'q=logo',
      'q=logo&kind=video',
      'q=logo&kind=document',
    ]) {
      const sent = await call(ctx, `${ROUTES.librarySearch}?${qs}`);
      expect(sent.status, qs).toBe(400);
      expect(json(sent).error.code).toBe('bad-request');
    }
    expect((await call(ctx, `${ROUTES.librarySearch}?q=logo&kind=image`, 'POST')).status).toBe(405);
  });

  it('answers the listed files for some ids, in the order sent, leaving out unknown ones', async () => {
    const { ctx } = setup();
    const a = await idOf(ctx, 'logo.png');
    const listing = json(await call(ctx, ROUTES.library('client:acme-heating'))) as LibraryListing;
    const other = listing.items.find((i) => i.id !== a)?.id as string;
    const gone = 'client:acme-heating.000000000000000000000000';
    const sent = await call(ctx, ROUTES.libraryItems, 'POST', { ids: [other, gone, a, other, 'nope'] });
    expect(sent.status).toBe(200);
    const files = json(sent).files as { item: { id: string }; scope: { id: string } }[];
    expect(files.map((f) => f.item.id)).toEqual([other, a]);
    expect(files[0]?.scope.id).toBe('client:acme-heating');
    // Never where the file is on this machine.
    // (`version` is the library version a delete sends back as `expect`: public on purpose.)
    expect(JSON.stringify(json(sent))).not.toMatch(/absPath/);
  });

  it('refuses a files lookup that is not a list of ids, or too many, or not a POST', async () => {
    const { ctx } = setup();
    const many = Array.from({ length: 101 }, (_, i) => `client:acme-heating.${String(i).padStart(24, '0')}`);
    for (const body of [
      {},
      { ids: 'x' },
      { ids: [3] },
      { ids: [''] },
      { ids: ['x'.repeat(401)] },
      { ids: many },
    ]) {
      const sent = await call(ctx, ROUTES.libraryItems, 'POST', body);
      expect(sent.status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await call(ctx, ROUTES.libraryItems)).status).toBe(405);
  });

  it('lists the scopes, and a scope', async () => {
    const { ctx } = setup();
    const scopes = await call(ctx, ROUTES.libraryScopes);
    expect(scopes.status).toBe(200);
    expect(json(scopes).map((s: { id: string }) => s.id)).toEqual([
      'personal',
      'client:acme-heating',
      'client:northwind',
    ]);
    const listing = await call(ctx, ROUTES.library('client:acme-heating'));
    expect(listing.status).toBe(200);
    expect(json(listing).groups[0]).toBe('Reports');
    expect(listing.headers['cache-control']).toBe('no-store');
  });

  it('answers 404 for a scope that is not listed and 400 when none is given', async () => {
    const { ctx } = setup();
    const missing = await call(ctx, ROUTES.library('client:../acme-heating'));
    expect(missing.status).toBe(404);
    expect(json(missing).error.code).toBe('not-found');
    expect((await call(ctx, '/api/library')).status).toBe(400);
    expect((await call(ctx, ROUTES.libraryScopes, 'POST')).status).toBe(405);
  });

  it('sends a WebP picture, cached for a year, for an image', async () => {
    const { ctx } = setup();
    const id = await idOf(ctx, 'logo.png');
    const sent = await call(ctx, ROUTES.libraryThumb(id, 96, '2026-11-11T00:00:00.000Z'));
    expect(sent.status).toBe(200);
    expect(sent.headers['content-type']).toBe('image/webp');
    expect(sent.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(sent.body.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('refuses a bad width, an unknown id, a document and a broken image', async () => {
    const { ctx } = setup();
    const logo = await idOf(ctx, 'logo.png');
    for (const w of ['97', '', '96abc', '0x60', '96.0', '-96']) {
      const sent = await call(ctx, `/api/library/thumb/${encodeURIComponent(logo)}?w=${w}`);
      expect(sent.status, w).toBe(400);
      expect(json(sent).error.code).toBe('bad-request');
      expect(sent.headers['cache-control']).toBe('no-store');
    }
    expect((await call(ctx, `/api/library/thumb/${encodeURIComponent(logo)}`)).status).toBe(400);
    const unknown = await call(
      ctx,
      ROUTES.libraryThumb('client:acme-heating.000000000000000000000000', 96, 'x'),
    );
    expect(unknown.status).toBe(404);
    expect((await call(ctx, '/api/library/thumb/%E0%A4%A?w=96')).status).toBe(404);
    const doc = await idOf(ctx, 'monthly-report.md');
    expect((await call(ctx, ROUTES.libraryThumb(doc, 96, 'x'))).status).toBe(400);
    const broken = await idOf(ctx, 'broken.png');
    const b = await call(ctx, ROUTES.libraryThumb(broken, 96, 'x'));
    expect(b.status).toBe(404);
    expect(b.headers['cache-control']).toBe('no-store');
  });

  it('sends a note as text without its frontmatter, and refuses other views', async () => {
    const { ctx } = setup();
    const note = await idOf(ctx, '2026-11-01-call-follow-up.md');
    const sent = await call(ctx, ROUTES.libraryText(note));
    expect(sent.status).toBe(200);
    expect(json(sent)).toEqual({ text: '# Not this heading\n\nBody text.\n', truncated: false });
    expect(sent.headers['cache-control']).toBe('no-store');
    const loose = json(await call(ctx, ROUTES.libraryText(await idOf(ctx, 'loose-note.txt'))));
    expect(loose).toEqual({ text: 'A loose note in the client root.\n', truncated: false });
    expect((await call(ctx, ROUTES.libraryText(await idOf(ctx, 'logo.png')))).status).toBe(400);
    expect((await call(ctx, ROUTES.libraryText(await idOf(ctx, 'page.html')))).status).toBe(400);
    expect((await call(ctx, ROUTES.libraryText('personal.000000000000000000000000'))).status).toBe(404);
  });

  it('sends long text cut at 1 MB on a character boundary, marked truncated', async () => {
    const { root, ctx } = setup();
    // 'é' is two bytes: 1 MB + 1 byte in, so the cut falls inside a character
    writeFileSync(join(root, 'clients/acme-heating/notes/long.md'), `x${'é'.repeat(600_000)}`);
    const sent = await call(ctx, ROUTES.libraryText(await idOf(ctx, 'long.md')));
    expect(sent.status).toBe(200);
    const body = json(sent) as { text: string; truncated: boolean };
    expect(body.truncated).toBe(true);
    expect(body.text).not.toContain('\uFFFD');
    expect(Buffer.byteLength(body.text)).toBe(1024 * 1024 - 1);
  });

  it('sends an HTML page under the script-running preview policy, replacing the app’s (R7)', async () => {
    const { root, ctx } = setup();
    const id = await idOf(ctx, 'page.html');
    const sent = await call(ctx, ROUTES.libraryPage(id));
    expect(sent.status).toBe(200);
    expect(sent.headers['content-security-policy']).toBe(PAGE_PREVIEW_CSP);
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(sent.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(sent.headers['x-content-type-options']).toBe('nosniff');
    // As stored, with only the link script added right after the doctype (hardening decision 1).
    const file = join(root, 'clients/acme-heating/landing-pages/boiler/page.html');
    const stored = readFileSync(file);
    expect(sent.body.toString('utf8')).toBe(
      `<!doctype html>${LINK_SCRIPT_TAG}${stored.toString('utf8').slice('<!doctype html>'.length)}`,
    );
    expect(sent.headers['content-length']).toBe(sent.body.length);
    const personal = await call(ctx, ROUTES.libraryPage(await idOf(ctx, 'explainer.html', 'personal')));
    expect(personal.status).toBe(200);
    expect(personal.body.toString('utf8').startsWith(`<!doctype html>${LINK_SCRIPT_TAG}<title>`)).toBe(true);
  });

  it('adds the link script to a served page byte for byte, never to the stored file', async () => {
    const { root, ctx } = setup();
    const file = join(root, 'clients/acme-heating/landing-pages/boiler/page.html');
    // A BOM, a comment and a byte that isn't valid UTF-8 all pass through untouched.
    const stored = Buffer.concat([
      Buffer.from('\uFEFF<!-- made --> <!DOCTYPE html>', 'utf8'),
      Buffer.from([0xff, 0xfe]),
      Buffer.from('<p>caf\u00e9</p>', 'utf8'),
    ]);
    writeFileSync(file, stored);
    const id = await idOf(ctx, 'page.html');
    const sent = await call(ctx, ROUTES.libraryPage(id));
    const at = Buffer.byteLength('\uFEFF<!-- made --> <!DOCTYPE html>');
    expect(
      sent.body.equals(
        Buffer.concat([stored.subarray(0, at), Buffer.from(LINK_SCRIPT_TAG), stored.subarray(at)]),
      ),
    ).toBe(true);
    expect(readFileSync(file).equals(stored)).toBe(true);
    // A page with no doctype starts with the script.
    writeFileSync(file, '<h1>Bare</h1>');
    const bare = await call(ctx, ROUTES.libraryPage(id));
    expect(bare.body.toString('utf8')).toBe(`${LINK_SCRIPT_TAG}<h1>Bare</h1>`);
    expect(readFileSync(file, 'utf8')).toBe('<h1>Bare</h1>');
    // A UTF-16 page (either byte order) is served as stored: bytes in front of its mark would garble it.
    for (const bom of [Buffer.from([0xfe, 0xff]), Buffer.from([0xff, 0xfe])]) {
      const wide = Buffer.concat([bom, Buffer.from('<!DOCTYPE html><p>x</p>', 'utf16le')]);
      writeFileSync(file, wide);
      expect((await call(ctx, ROUTES.libraryPage(id))).body.equals(wide)).toBe(true);
    }
  });

  it('answers page errors as a small HTML page under the same policy, never JSON', async () => {
    const { ctx } = setup();
    const cases: [string, number, string][] = [
      [ROUTES.libraryPage(await idOf(ctx, 'monthly-report.md')), 400, 'GET'],
      [ROUTES.libraryPage('client:acme-heating.000000000000000000000000'), 404, 'GET'],
      ['/api/library/page/%E0%A4%A', 404, 'GET'],
      [ROUTES.libraryPage(await idOf(ctx, 'page.html')), 405, 'POST'],
    ];
    for (const [path, status, method] of cases) {
      const sent = await call(ctx, path, method);
      expect(sent.status, path).toBe(status);
      expect(sent.headers['content-security-policy']).toBe(PAGE_CSP);
      expect(sent.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(sent.headers['cache-control']).toBe('no-store');
      expect(sent.body.toString('utf8')).toMatch(/^<!doctype html>/);
    }
  });

  /** Like `call`, but the reply is a real stream, as a download is piped into it. */
  async function download(ctx: RouteContext, path: string, method = 'GET'): Promise<Sent> {
    const req = Object.assign(Readable.from([]), { method, headers: {} });
    const sent: Sent = { status: 0, headers: {}, body: Buffer.alloc(0) };
    const chunks: Buffer[] = [];
    const res = Object.assign(
      new Writable({
        write(chunk: Buffer, _enc, done) {
          chunks.push(chunk);
          done();
        },
      }),
      {
        headersSent: false,
        setHeader(name: string, value: string | number) {
          sent.headers[name.toLowerCase()] = value;
        },
        writeHead(status: number, headers: Record<string, string | number> = {}) {
          sent.status = status;
          for (const [k, v] of Object.entries(headers)) sent.headers[k.toLowerCase()] = v;
          res.headersSent = true;
        },
      },
    );
    const end = res.end.bind(res);
    res.end = ((body?: string | Buffer) => {
      if (body !== undefined) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
      return end();
    }) as typeof res.end;
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${path}`),
      ctx,
    );
    sent.body = Buffer.concat(chunks);
    return sent;
  }

  it('sends any listed file as a download, byte for byte, never shown in the app', async () => {
    const { root, ctx } = setup();
    const cases: [string, string, string][] = [
      ['logo.png', 'client:acme-heating', 'clients/acme-heating/context/brand/logo.png'],
      ['page.html', 'client:acme-heating', 'clients/acme-heating/landing-pages/boiler/page.html'],
      ['explainer.html', 'personal', 'personal/explainer.html'],
    ];
    for (const [name, scope, rel] of cases) {
      const sent = await download(ctx, ROUTES.libraryFile(await idOf(ctx, name, scope)));
      expect(sent.status, name).toBe(200);
      expect(sent.headers['content-type']).toBe('application/octet-stream');
      expect(sent.headers['content-disposition']).toBe(
        `attachment; filename="${name}"; filename*=UTF-8''${name}`,
      );
      expect(sent.headers['x-content-type-options']).toBe('nosniff');
      expect(sent.headers['cache-control']).toBe('no-store');
      expect(sent.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
      const disk = readFileSync(join(root, rel));
      expect(sent.headers['content-length']).toBe(disk.length);
      expect(sent.body.equals(disk), name).toBe(true);
    }
  });

  it('names a download safely when the file name has quotes or letters outside plain ASCII', async () => {
    const { root, ctx } = setup();
    writeFileSync(join(root, 'clients/acme-heating/notes/Café "plan" 100%.md'), 'x');
    const sent = await download(ctx, ROUTES.libraryFile(await idOf(ctx, 'Café "plan" 100%.md')));
    expect(sent.status).toBe(200);
    expect(sent.headers['content-disposition']).toBe(
      `attachment; filename="Caf_ _plan_ 100%.md"; filename*=UTF-8''Caf%C3%A9%20%22plan%22%20100%25.md`,
    );
    expect(sent.body.toString('utf8')).toBe('x');
  });

  it('sends an empty file as an empty download', async () => {
    const { root, ctx } = setup();
    writeFileSync(join(root, 'clients/acme-heating/notes/empty.txt'), '');
    const sent = await download(ctx, ROUTES.libraryFile(await idOf(ctx, 'empty.txt')));
    expect(sent.status).toBe(200);
    expect(sent.headers['content-length']).toBe(0);
    expect(sent.body.length).toBe(0);
  });

  it('sends a PDF to be shown in the browser’s own reader, under its own policy', async () => {
    const { root, ctx } = setup();
    const sent = await download(ctx, ROUTES.libraryPdf(await idOf(ctx, '2026-10-summary.pdf')));
    expect(sent.status).toBe(200);
    expect(sent.headers['content-type']).toBe('application/pdf');
    expect(sent.headers['content-disposition']).toBe(
      `inline; filename="2026-10-summary.pdf"; filename*=UTF-8''2026-10-summary.pdf`,
    );
    expect(sent.headers['x-content-type-options']).toBe('nosniff');
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(sent.headers['content-security-policy']).toBe(PDF_CSP);
    const disk = readFileSync(join(root, 'clients/acme-heating/reports/2026-10-summary.pdf'));
    expect(sent.headers['content-length']).toBe(disk.length);
    expect(sent.body.equals(disk)).toBe(true);
  });

  it('refuses to show a file named .pdf that is not a PDF, and anything that is not a PDF', async () => {
    const { root, ctx } = setup();
    writeFileSync(
      join(root, 'clients/acme-heating/reports/fake.pdf'),
      '<!doctype html><script>alert(1)</script>',
    );
    const cases: [string, number, string][] = [
      [ROUTES.libraryPdf(await idOf(ctx, 'fake.pdf')), 400, 'GET'],
      [ROUTES.libraryPdf(await idOf(ctx, 'page.html')), 400, 'GET'],
      [ROUTES.libraryPdf('client:acme-heating.000000000000000000000000'), 404, 'GET'],
      ['/api/library/pdf/%E0%A4%A', 404, 'GET'],
      [ROUTES.libraryPdf(await idOf(ctx, '2026-10-summary.pdf')), 405, 'POST'],
    ];
    for (const [path, status, method] of cases) {
      const sent = await download(ctx, path, method);
      expect(sent.status, path).toBe(status);
      // The frame shows the error, so it is a small page under the sandboxed page policy.
      expect(sent.headers['content-security-policy']).toBe(PAGE_CSP);
      expect(sent.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(sent.body.toString('utf8')).not.toContain('<script>');
    }
  });

  it('refuses a download for an unknown id, a bad id, a file gone since listing, and a POST', async () => {
    const { root, ctx } = setup();
    const unknown = await download(ctx, ROUTES.libraryFile('client:acme-heating.000000000000000000000000'));
    expect(unknown.status).toBe(404);
    expect(unknown.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(unknown.body.toString('utf8')).error.code).toBe('not-found');
    expect((await download(ctx, '/api/library/file/%E0%A4%A')).status).toBe(404);
    const id = await idOf(ctx, 'loose-note.txt');
    expect((await download(ctx, ROUTES.libraryFile(id), 'POST')).status).toBe(405);
    rmSync(join(root, 'clients/acme-heating/loose-note.txt'));
    expect((await download(ctx, ROUTES.libraryFile(id))).status).toBe(404);
  });

  it('refuses a page that has grown past its cap since it was listed', async () => {
    const { root, ctx } = setup();
    const id = await idOf(ctx, 'page.html');
    writeFileSync(
      join(root, 'clients/acme-heating/landing-pages/boiler/page.html'),
      Buffer.alloc(5 * 1024 * 1024 + 1, 0x61),
    );
    const sent = await call(ctx, ROUTES.libraryPage(id));
    expect(sent.status).toBe(400);
    expect(sent.headers['content-security-policy']).toBe(PAGE_CSP);
  });
});

describe('uploads', () => {
  type Sent = { status: number; headers: Record<string, string | number>; body: string };

  function setup(opts: { off?: boolean; maxUploadBytes?: number } = {}) {
    const dataDir = mkdtempSync(join(tmpdir(), 'tba-routes-up-'));
    tempDirs.push(dataDir);
    const brainRoot = opts.off ? dataDir : mkdtempSync(join(tmpdir(), 'tba-routes-brain-'));
    if (!opts.off) tempDirs.push(brainRoot);
    const uploads = createUploadStaging({
      dataDir: opts.off ? join(brainRoot, 'data') : dataDir,
      brainRoot,
      sweepMs: 0,
      maxUploadBytes: opts.maxUploadBytes,
    });
    stagings.push(uploads);
    const calls: { start: unknown[]; send: unknown[][] } = { start: [], send: [] };
    const sessions = {
      start: async (req: unknown) => {
        calls.start.push(req);
        return { id: 'chat-1' };
      },
      send: async (...args: unknown[]) => {
        calls.send.push(args);
      },
    };
    const ctx = { uploads, sessions, log: () => {} } as unknown as RouteContext;
    return { ctx, uploads, calls };
  }

  async function call(
    ctx: RouteContext,
    path: string,
    opts: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {},
  ): Promise<Sent> {
    const data = opts.body === undefined ? [] : [Buffer.from(opts.body)];
    const req = Object.assign(Readable.from(data), {
      method: opts.method ?? 'POST',
      headers: opts.headers ?? {},
    });
    const sent: Sent = { status: 0, headers: {}, body: '' };
    const res = {
      headersSent: false,
      setHeader(name: string, value: string | number) {
        sent.headers[name.toLowerCase()] = value;
      },
      writeHead(status: number, headers: Record<string, string | number> = {}) {
        sent.status = status;
        for (const [k, v] of Object.entries(headers)) sent.headers[k.toLowerCase()] = v;
        res.headersSent = true;
      },
      end(body?: string | Buffer) {
        if (body !== undefined) sent.body = body.toString();
      },
    };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${path}`),
      ctx,
    );
    return sent;
  }

  it('sends a held message again through the resend route, for the chat named', async () => {
    const asked: string[] = [];
    const ctx = {
      sessions: { resend: async (id: string) => void asked.push(id) },
      log: () => {},
    } as unknown as RouteContext;
    const sent = await call(ctx, '/api/sessions/chat%201/resend', { body: '{}' });
    expect(sent.status).toBe(200);
    expect(asked).toEqual(['chat 1']);
    const get = await call(ctx, '/api/sessions/chat-1/resend', { method: 'GET' });
    expect(get.status).toBe(405);
  });

  const upload = (ctx: RouteContext, name: string | null, body: string, length?: number | null) => {
    const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
    if (name !== null) headers[UPLOAD_NAME_HEADER] = encodeURIComponent(name);
    const len = length === undefined ? Buffer.byteLength(body) : length;
    if (len !== null) headers['content-length'] = String(len);
    return call(ctx, ROUTES.uploads, { headers, body });
  };

  const json = (s: Sent) => JSON.parse(s.body);

  it('stages a file and answers with what it is, never a path', async () => {
    const { ctx, uploads } = setup();
    const sent = await upload(ctx, 'Brief – final.pdf', '%PDF-1.4 x');
    expect(sent.status).toBe(200);
    const { upload: info } = json(sent) as UploadResponse;
    expect(info).toEqual({ id: expect.any(String), name: 'Brief – final.pdf', size: 10, kind: 'document' });
    expect(sent.body).not.toContain(uploads.root as string);
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(uploads.peek([info.id])).toHaveLength(1);
  });

  it('answers 411 without a length, and 413 with Connection: close over the cap', async () => {
    const { ctx } = setup({ maxUploadBytes: 10 });
    const none = await upload(ctx, 'a.txt', 'abc', null);
    expect(none.status).toBe(411);
    expect(json(none).error.code).toBe('bad-request');
    const declared = await upload(ctx, 'a.txt', 'x'.repeat(11));
    expect(declared.status).toBe(413);
    expect(declared.headers.connection).toBe('close');
    expect(json(declared).error).toEqual({
      code: 'bad-request',
      message: 'That file is too large to attach. Files can be up to 32 MB.',
    });
    // more bytes arrive than were promised
    const streamed = await upload(ctx, 'a.txt', 'x'.repeat(9), 5);
    expect(streamed.status).toBe(413);
    expect(streamed.headers.connection).toBe('close');
  });

  it('answers 400 for a missing name or a type it will not pass on', async () => {
    const { ctx } = setup();
    const noName = await upload(ctx, null, 'abc');
    expect(noName.status).toBe(400);
    expect(json(noName).error.code).toBe('bad-request');
    const exe = await upload(ctx, 'tool.exe', 'abc');
    expect(exe.status).toBe(400);
    expect(json(exe).error.message).toBe(
      "TDS Cortex can't pass on .exe files. Attach a document, spreadsheet, slide deck, text file or picture.",
    );
  });

  it('refuses a body that is not raw bytes, and anything but POST', async () => {
    const { ctx } = setup();
    const asJson = await call(ctx, ROUTES.uploads, {
      headers: { 'content-type': 'application/json', 'content-length': '2', [UPLOAD_NAME_HEADER]: 'a.txt' },
      body: '{}',
    });
    expect(asJson.status).toBe(415);
    expect((await call(ctx, ROUTES.uploads, { method: 'GET' })).status).toBe(405);
  });

  it('answers 409 busy when the folder is full', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tba-routes-up-'));
    const brainRoot = mkdtempSync(join(tmpdir(), 'tba-routes-brain-'));
    tempDirs.push(dataDir, brainRoot);
    const uploads = createUploadStaging({ dataDir, brainRoot, sweepMs: 0, maxStagedBytes: 4 });
    stagings.push(uploads);
    const ctx = { uploads, log: () => {} } as unknown as RouteContext;
    expect((await upload(ctx, 'a.txt', 'abc')).status).toBe(200);
    const full = await upload(ctx, 'b.txt', 'abc');
    expect(full.status).toBe(409);
    expect(json(full).error.code).toBe('busy');
  });

  it('refuses plainly with not-allowed when uploads are switched off', async () => {
    const { ctx } = setup({ off: true });
    const sent = await upload(ctx, 'a.txt', 'abc');
    expect(sent.status).toBe(403);
    expect(json(sent).error.code).toBe('not-allowed');
    expect(json(sent).error.message).toMatch(/switched off/);
  });

  it('discards an upload, and is fine with an unknown id', async () => {
    const { ctx, uploads } = setup();
    const { upload: info } = json(await upload(ctx, 'a.txt', 'abc')) as UploadResponse;
    const jsonHeaders = { 'content-type': 'application/json' };
    const sent = await call(ctx, ROUTES.uploadDiscard(info.id), { headers: jsonHeaders, body: '{}' });
    expect(sent.status).toBe(200);
    expect(json(sent)).toEqual({ ok: true });
    expect(() => uploads.peek([info.id])).toThrow();
    expect((await call(ctx, ROUTES.uploadDiscard('nope'), { headers: jsonHeaders, body: '{}' })).status).toBe(
      200,
    );
    expect((await call(ctx, ROUTES.uploadDiscard(info.id), { method: 'GET' })).status).toBe(405);
  });

  it('passes attachments from a new chat and a message to the session manager, and refuses bad shapes', async () => {
    const { ctx, calls } = setup();
    const headers = { 'content-type': 'application/json' };
    const started = await call(ctx, ROUTES.sessions, {
      headers,
      body: JSON.stringify({ prompt: '', attachments: ['u1'] }),
    });
    expect(started.status).toBe(200);
    expect(calls.start).toEqual([{ prompt: '', attachments: ['u1'] }]);
    const sent = await call(ctx, ROUTES.sessionMessages('chat-1'), {
      headers,
      body: JSON.stringify({ text: '', attachments: ['u2', 'u3'] }),
    });
    expect(sent.status).toBe(200);
    expect(calls.send).toEqual([['chat-1', '', ['u2', 'u3']]]);
    await call(ctx, ROUTES.sessionMessages('chat-1'), { headers, body: JSON.stringify({ text: 'hi' }) });
    expect(calls.send[1]).toEqual(['chat-1', 'hi', []]);
    await call(ctx, ROUTES.sessionMessages('chat-1'), {
      headers,
      body: JSON.stringify({ text: 'hi', attachments: null }),
    });
    expect(calls.send[2]).toEqual(['chat-1', 'hi', []]);
    for (const attachments of ['u1', [3], [''], Array.from({ length: MAX_ATTACHMENTS + 1 }, () => 'x')]) {
      const bad = await call(ctx, ROUTES.sessionMessages('chat-1'), {
        headers,
        body: JSON.stringify({ text: 'hi', attachments }),
      });
      expect(bad.status, JSON.stringify(attachments)).toBe(400);
      const badStart = await call(ctx, ROUTES.sessions, {
        headers,
        body: JSON.stringify({ prompt: 'hi', attachments }),
      });
      expect(badStart.status).toBe(400);
    }
    expect(calls.send).toHaveLength(3);
    expect(calls.start).toHaveLength(1);
  });
});

describe('GET /api/changelog (open to everyone)', () => {
  const VERSIONS = [{ version: '0.6.0', date: '2026-11-13', changes: [{ kind: 'feat', text: 'x' }] }];
  async function get(role: string, method = 'GET', changelog = async () => VERSIONS) {
    const req = Object.assign(Readable.from([]), { method, headers: {} });
    const sent = { status: 0, body: '' };
    const res = {
      headersSent: false,
      setHeader: () => {},
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    const brain = {
      identity: async () => ({ name: 'Sam Example', slug: 'sam-example', role, knownMember: true }),
    };
    const ctx = { brain, changelog, log: () => {} } as unknown as RouteContext;
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${ROUTES.changelog}`),
      ctx,
    );
    return { status: sent.status, body: JSON.parse(sent.body || '{}') };
  }

  it('gives every role every version', async () => {
    for (const role of ['owner', 'scout', 'team', 'unknown']) {
      const r = await get(role);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ versions: VERSIONS });
    }
  });

  it('answers an empty list when the history cannot be read, and only to GET', async () => {
    expect((await get('owner', 'GET', async () => Promise.reject(new Error('gone')))).body).toEqual({
      versions: [],
    });
    expect((await get('owner', 'POST')).status).toBe(405);
  });
});

describe('validatePrefsPatch: todoSeen', () => {
  const brain = { clients: async () => [] };

  it('accepts a map of keys to markers', async () => {
    const todoSeen = {
      '20261112-a.md': '2026-11-12T10:30:00+00:00',
      'personal/b.md': '2026-11-13T08:00:00Z',
    };
    expect(await validatePrefsPatch({ todoSeen }, brain)).toEqual({ todoSeen });
    expect(await validatePrefsPatch({ todoSeen: {} }, brain)).toEqual({ todoSeen: {} });
  });

  it('refuses anything else, and too many entries or too-long keys and markers', async () => {
    const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`k${i}`, '2026-11-13']));
    const bad: unknown[] = [
      null,
      [],
      'x',
      many,
      { [`${'k'.repeat(301)}`]: '2026-11-13' },
      { a: 'x'.repeat(41) },
      { a: 5 },
      { a: '' },
      { '': '2026-11-13' },
    ];
    for (const todoSeen of bad) {
      await expect(
        validatePrefsPatch({ todoSeen }, brain),
        JSON.stringify(todoSeen).slice(0, 60),
      ).rejects.toThrow(HttpError);
    }
    const max = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, '2026-11-13']));
    expect(await validatePrefsPatch({ todoSeen: max }, brain)).toEqual({ todoSeen: max });
  });
});

describe('validatePrefsPatch: Home hidden items and shortcuts', () => {
  const brain = { clients: async () => [] };
  const place = { kind: 'place', place: 'projects' };
  const tool = { kind: 'tool', section: 'workbench', tool: 'ads' };

  it('accepts valid lists and removes repeats, first wins', async () => {
    expect(await validatePrefsPatch({ homeHidden: ['files', 'due-this-week', 'files'] }, brain)).toEqual({
      homeHidden: ['files', 'due-this-week'],
    });
    expect(await validatePrefsPatch({ homeHidden: [], homeShortcuts: [] }, brain)).toEqual({
      homeHidden: [],
      homeShortcuts: [],
    });
    expect(
      await validatePrefsPatch({ homeShortcuts: [place, tool, { ...place }, { ...tool }] }, brain),
    ).toEqual({
      homeShortcuts: [place, tool],
    });
  });

  it('refuses a skill shortcut: Home shortcuts never hold a skill', async () => {
    await expect(
      validatePrefsPatch({ homeShortcuts: [{ kind: 'skill', name: 'seo-audit' }] }, brain),
    ).rejects.toThrow('The Home shortcuts were not understood.');
  });

  it('accepts place and drawer shortcuts from the fixed lists, and refuses any other', async () => {
    const place = { kind: 'place', place: 'images' };
    const drawer = { kind: 'drawer', drawer: 'todos' };
    expect(await validatePrefsPatch({ homeShortcuts: [place, drawer, { ...place }] }, brain)).toEqual({
      homeShortcuts: [place, drawer],
    });
    for (const bad of [
      { kind: 'place', place: 'settings' },
      { kind: 'place', place: 'app:projects' },
      { kind: 'place' },
      { kind: 'drawer', drawer: 'skills' },
      { kind: 'drawer', drawer: 'section' },
      { kind: 'drawer' },
    ]) {
      await expect(validatePrefsPatch({ homeShortcuts: [bad] }, brain), JSON.stringify(bad)).rejects.toThrow(
        'The Home shortcuts were not understood.',
      );
    }
  });

  it('refuses each bad hidden list with a clear message', async () => {
    const bad: unknown[] = [
      'files',
      { 0: 'files' },
      [3],
      [''],
      ['Files'],
      ['has space'],
      ['x'.repeat(41)],
      Array.from({ length: 41 }, (_, i) => `item-${i}`),
    ];
    for (const homeHidden of bad) {
      await expect(
        validatePrefsPatch({ homeHidden }, brain),
        JSON.stringify(homeHidden).slice(0, 40),
      ).rejects.toThrow('The hidden Home items were not understood.');
    }
    const max = Array.from({ length: 40 }, (_, i) => `item-${i}`);
    expect(await validatePrefsPatch({ homeHidden: max }, brain)).toEqual({ homeHidden: max });
  });

  it('refuses each bad shortcut list with a clear message', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      kind: 'tool',
      section: 'workbench',
      tool: `tool-${i}`,
    }));
    const bad: unknown[] = [
      'nope',
      [null],
      ['skill:gm'],
      [{ kind: 'file', name: 'x' }],
      [{ name: 'gm' }],
      [{ kind: 'skill' }],
      [{ kind: 'skill', name: '' }],
      [{ kind: 'skill', name: '-bad' }],
      [{ kind: 'skill', name: 'x'.repeat(129) }],
      [{ kind: 'skill', name: 3 }],
      [{ kind: 'tool', section: 'workbench' }],
      [{ kind: 'tool', tool: 'ads' }],
      [{ kind: 'tool', section: 'Work Bench', tool: 'ads' }],
      [{ kind: 'tool', section: 'workbench', tool: 'ads!' }],
      [{ kind: 'tool', section: 'workbench', tool: 3 }],
      seven,
    ];
    for (const homeShortcuts of bad) {
      await expect(
        validatePrefsPatch({ homeShortcuts }, brain),
        JSON.stringify(homeShortcuts).slice(0, 60),
      ).rejects.toThrow('The Home shortcuts were not understood.');
    }
    expect(await validatePrefsPatch({ homeShortcuts: seven.slice(0, 6) }, brain)).toEqual({
      homeShortcuts: seven.slice(0, 6),
    });
  });
});

describe('validatePrefsPatch: model and effort', () => {
  const brain = { clients: async () => [] };

  it('accepts null, an alias, an id and every effort level', async () => {
    expect(await validatePrefsPatch({ model: null, effort: null }, brain)).toEqual({
      model: null,
      effort: null,
    });
    expect(await validatePrefsPatch({ model: 'opus' }, brain)).toEqual({ model: 'opus' });
    expect(await validatePrefsPatch({ model: 'claude-opus-5-5[1m]' }, brain)).toEqual({
      model: 'claude-opus-5-5[1m]',
    });
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(await validatePrefsPatch({ effort }, brain)).toEqual({ effort });
    }
    expect(await validatePrefsPatch({ model: 'a'.repeat(100) }, brain)).toEqual({ model: 'a'.repeat(100) });
  });

  it('refuses a bad pattern, a long model, a non-string, and an unknown effort', async () => {
    const bad: Record<string, unknown>[] = [
      { model: 'has space' },
      { model: '-opus' },
      { model: 'opus; rm -rf' },
      { model: '' },
      { model: 'a'.repeat(101) },
      { model: 5 },
      { effort: 'turbo' },
      { effort: 'HIGH' },
      { effort: 3 },
      { effort: '' },
    ];
    for (const patch of bad) {
      const err = await validatePrefsPatch(patch, brain).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, JSON.stringify(patch)).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(400);
    }
  });
});

describe('PUT /api/prefs and GET /api/engine/choices', () => {
  async function call(path: string, method: string, body: unknown, ctxOver: Record<string, unknown> = {}) {
    const choices: unknown[] = [];
    const saved = { model: 'sonnet', effort: 'high' };
    const ctx = {
      brain: { clients: async () => [] },
      store: { update: async (patch: object) => ({ ...saved, ...patch }) },
      sessions: {
        setEngineChoice: async (c: unknown) => {
          choices.push(c);
        },
        engineChoices: async () => ({ models: [], claudeCode: { model: null } }),
      },
      log: () => {},
      ...ctxOver,
    };
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
      method,
      headers: { 'content-type': 'application/json' },
    });
    const sent = { status: 0, headers: {} as Record<string, unknown>, body: '' };
    const res = {
      headersSent: false,
      writeHead: (status: number, headers: Record<string, unknown> = {}) => {
        sent.status = status;
        sent.headers = headers;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${path}`),
      ctx as unknown as RouteContext,
    );
    return { ...sent, choices, json: sent.body ? JSON.parse(sent.body) : null };
  }

  it('saves a model and effort and hands the saved choice to the sessions', async () => {
    const sent = await call('/api/prefs', 'PUT', { model: 'opus' });
    expect(sent.status).toBe(200);
    expect(sent.choices).toEqual([{ model: 'opus', effort: 'high' }]);
  });

  it("saves the tour and What's new markers through the real route, and refuses bad ones", async () => {
    const sent = await call('/api/prefs', 'PUT', { tourSeen: 1, whatsNewSeen: '0.40.0' });
    expect(sent.status).toBe(200);
    expect(sent.json).toMatchObject({ tourSeen: 1, whatsNewSeen: '0.40.0' });
    expect((await call('/api/prefs', 'PUT', { tourSeen: null, whatsNewSeen: null })).status).toBe(200);
    for (const patch of [
      { tourSeen: 0 },
      { tourSeen: 1.5 },
      { tourSeen: '1' },
      { tourSeen: 1001 },
      { whatsNewSeen: 'v1' },
      { whatsNewSeen: 4 },
    ]) {
      expect((await call('/api/prefs', 'PUT', patch)).status).toBe(400);
    }
  });

  it('saves folded drawer groups through the real route, and refuses bad ones', async () => {
    const sent = await call('/api/prefs', 'PUT', { foldedGroups: { workbench: ['Ads'] } });
    expect(sent.status).toBe(200);
    expect(sent.json).toMatchObject({ foldedGroups: { workbench: ['Ads'] } });
    expect((await call('/api/prefs', 'PUT', { foldedGroups: {} })).status).toBe(200);
    for (const patch of [
      { foldedGroups: ['Ads'] },
      { foldedGroups: { workbench: 'Ads' } },
      { foldedGroups: { workbench: [1] } },
      { foldedGroups: { workbench: ['x'.repeat(61)] } },
      { foldedGroups: null },
    ]) {
      expect((await call('/api/prefs', 'PUT', patch)).status).toBe(400);
    }
  });

  it('does not touch the sessions when the patch has neither', async () => {
    const sent = await call('/api/prefs', 'PUT', { pins: [] });
    expect(sent.status).toBe(200);
    expect(sent.choices).toEqual([]);
  });

  it('saves favourite chats as a list of session ids, once each', async () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const sent = await call('/api/prefs', 'PUT', { favouriteChats: [id, id] });
    expect(sent.status).toBe(200);
    expect(sent.json.favouriteChats).toEqual([id]);
  });

  it('refuses favourite chats that are not a list of session ids, or too many', async () => {
    const ids = Array.from(
      { length: 201 },
      (_, i) => `0f8fad5b-d9cb-469f-a165-${String(i).padStart(12, '0')}`,
    );
    for (const favouriteChats of ['nope', ['not-a-uuid'], [3], ids]) {
      const sent = await call('/api/prefs', 'PUT', { favouriteChats });
      expect(sent.status).toBe(400);
      expect(sent.json.error.message).toBe('The pinned chats were not understood.');
    }
  });

  it('saves starred files as a list of ids, once each, and refuses a bad list', async () => {
    const sent = await call('/api/prefs', 'PUT', {
      favouriteFiles: ['client:a.0123', 'p.9', 'client:a.0123'],
    });
    expect(sent.status).toBe(200);
    expect(sent.json.favouriteFiles).toEqual(['client:a.0123', 'p.9']);
    const files = Array.from({ length: 101 }, (_, i) => `f${i}`);
    for (const favouriteFiles of ['nope', [''], [3], ['x'.repeat(401)], files]) {
      const bad = await call('/api/prefs', 'PUT', { favouriteFiles });
      expect(bad.status).toBe(400);
      expect(bad.json.error.message).toBe('The starred files were not understood.');
    }
  });

  it('saves favourite tasks as a list of task keys, once each', async () => {
    const sent = await call('/api/prefs', 'PUT', { favouriteTodos: ['a1', 'personal/b2', 'a1'] });
    expect(sent.status).toBe(200);
    expect(sent.json.favouriteTodos).toEqual(['a1', 'personal/b2']);
  });

  it('refuses favourite tasks that are not a list of task keys, or too many', async () => {
    const keys = Array.from({ length: 201 }, (_, i) => `t${i}`);
    for (const favouriteTodos of ['nope', [''], [3], ['x'.repeat(301)], keys]) {
      const sent = await call('/api/prefs', 'PUT', { favouriteTodos });
      expect(sent.status).toBe(400);
      expect(sent.json.error.message).toBe('The pinned tasks were not understood.');
    }
  });

  it('answers a bad value with 400 and does not touch the sessions', async () => {
    const sent = await call('/api/prefs', 'PUT', { model: 'no no' });
    expect(sent.status).toBe(400);
    expect(sent.choices).toEqual([]);
  });

  it('answers 200 even when the sessions reject or throw', async () => {
    const rejecting = await call(
      '/api/prefs',
      'PUT',
      { effort: 'low' },
      {
        sessions: { setEngineChoice: () => Promise.reject(new Error('boom')) },
      },
    );
    expect(rejecting.status).toBe(200);
    const throwing = await call(
      '/api/prefs',
      'PUT',
      { effort: 'low' },
      {
        sessions: {
          setEngineChoice: () => {
            throw new Error('boom');
          },
        },
      },
    );
    expect(throwing.status).toBe(200);
  });

  it('answers the choices, never cached, and refuses other methods', async () => {
    const sent = await call(ROUTES.engineChoices, 'GET', undefined);
    expect(sent.status).toBe(200);
    expect(sent.headers['Cache-Control']).toBe('no-store');
    expect(sent.json).toEqual({ models: [], claudeCode: { model: null } });
    expect((await call(ROUTES.engineChoices, 'POST', {})).status).toBe(405);
  });
});

describe('GET file changes of a chat (chat files)', () => {
  const CHANGES = {
    changes: [
      {
        at: null,
        tool: 'Edit',
        change: { kind: 'edit', path: 'clients/acme/plan.md', hunks: [] },
        cut: null,
        hiddenChars: false,
      },
    ],
    truncated: false,
  };

  async function call(path: string, method = 'GET') {
    const asked: [string, string][] = [];
    const sessions = {
      fileChanges(id: string, key: string) {
        asked.push([id, key]);
        if (id === 'gone')
          throw new SessionError('session-closed', 'That chat has been closed. Start a new one.');
        if (id !== 'chat-1') throw new SessionError('not-found', 'That chat could not be found.');
        return key === 'client:acme.abc/1' ? CHANGES : null;
      },
    };
    const req = Object.assign(Readable.from([]), { method, headers: {} });
    const sent = { status: 0, headers: {} as Record<string, unknown>, body: '' };
    const res = {
      headersSent: false,
      writeHead: (status: number, headers: Record<string, unknown> = {}) => {
        sent.status = status;
        sent.headers = headers;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${path}`),
      { sessions, log: () => {} } as unknown as RouteContext,
    );
    return { ...sent, asked, json: sent.body ? JSON.parse(sent.body) : null };
  }

  it('answers the changes, never cached, with the key decoded', async () => {
    const sent = await call(ROUTES.sessionFileChanges('chat-1', 'client:acme.abc/1'));
    expect(sent.status).toBe(200);
    expect(sent.headers['Cache-Control']).toBe('no-store');
    expect(sent.json).toEqual(CHANGES);
    expect(sent.asked).toEqual([['chat-1', 'client:acme.abc/1']]);
  });

  it('is not found for a key with no changes or an unknown chat, and gone for a closed one', async () => {
    const none = await call(ROUTES.sessionFileChanges('chat-1', 'other'));
    expect(none.status).toBe(404);
    expect(none.json).toEqual({ error: { code: 'not-found', message: 'Those changes could not be found.' } });
    expect((await call(ROUTES.sessionFileChanges('nope', 'k'))).status).toBe(404);
    const gone = await call(ROUTES.sessionFileChanges('gone', 'k'));
    expect(gone.status).toBe(410);
    expect(gone.json.error.code).toBe('session-closed');
  });

  it('refuses a badly encoded key and anything but GET', async () => {
    const bad = await call('/api/sessions/chat-1/file-changes/%E0%A4%A');
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('bad-request');
    expect(bad.asked).toEqual([]);
    expect((await call(ROUTES.sessionFileChanges('chat-1', 'client:acme.abc/1'), 'POST')).status).toBe(405);
  });
});

describe('GET /api/usage/savings', () => {
  const PORT = 45879;
  const TOKEN = 'launch-token-savings';
  const full = {
    since: '2026-11-15',
    today: { saved: 100, reused: 5, bySource: { summary: 100, cache: 5 } },
    last7: { saved: 100, reused: 5, bySource: { summary: 100, cache: 5 } },
    last30: { saved: 100, reused: 5, bySource: { summary: 100, cache: 5 } },
    all: { saved: 100, reused: 5, bySource: { summary: 100, cache: 5 } },
    kitsMode: 'shadow',
    team: null,
  };

  async function call(method: string, ctx: Record<string, unknown>) {
    const sent = { status: 0, body: '' };
    const res = {
      headersSent: false,
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    const req = Object.assign(Readable.from([]), { method, headers: {} });
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:${PORT}${USAGE_SAVINGS_PATH}`),
      { log: () => {}, ...ctx } as unknown as RouteContext,
    );
    return { ...sent, json: JSON.parse(sent.body) };
  }

  it('answers the ledger summary, with team null', async () => {
    const r = await call('GET', { savings: { summary: async () => full } });
    expect(r.status).toBe(200);
    expect(r.json).toEqual(full);
    expect(r.json.team).toBeNull();
  });

  it('answers an empty summary when there is no ledger (older contexts)', async () => {
    const r = await call('GET', {});
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      since: null,
      team: null,
      kitsMode: 'shadow',
      all: { saved: 0, reused: 0 },
    });
  });

  it('is GET only', async () => {
    expect((await call('POST', { savings: { summary: async () => full } })).status).toBe(405);
  });

  it('goes through the request gate: no session cookie is refused, a valid one is allowed', () => {
    const ctx = { port: PORT, launchToken: TOKEN };
    const base = { method: 'GET', path: USAGE_SAVINGS_PATH, headers: { host: `127.0.0.1:${PORT}` } };
    expect(checkRequest(base, ctx)).toMatchObject({ action: 'reject', status: 401 });
    const cookie = `${sessionCookieName(PORT)}=${cookieValueFor(TOKEN)}`;
    expect(checkRequest({ ...base, headers: { ...base.headers, cookie } }, ctx)).toEqual({ action: 'allow' });
  });
});

describe('skill levels and chat levels', () => {
  const rec = (tier: string) => ({ tier, setBy: 'sam-example', at: '2026-11-14T10:00:00.000Z' });

  async function call(path: string, method: string, body: unknown, over: Record<string, unknown> = {}) {
    const changes: unknown[][] = [];
    const levelCalls: unknown[][] = [];
    const prewarmed: string[] = [];
    let stored: Record<string, unknown> = { a: rec('deep') };
    const ctx = {
      brain: {
        root: '/x',
        identity: async () => ({ name: 'Sam', slug: 'sam', email: null, role: 'scout', knownMember: true }),
        clients: async () => [],
      },
      store: {
        update: async (patch: object) => ({ model: null, effort: null, levelMode: 'auto', ...patch }),
      },
      skillLevels: {
        read: async () => stored,
        writable: async () => true,
        change: async (...args: unknown[]) => {
          changes.push(args);
          stored = { ...stored, [args[0] as string]: rec(String(args[1])) };
        },
      },
      sessions: {
        setChatLevel: async (...args: unknown[]) => {
          levelCalls.push(args);
          return { tier: args[1], source: { kind: 'chat' } };
        },
        prewarmPick: (text: string) => {
          prewarmed.push(text);
        },
        setEngineChoice: async () => {},
      },
      clientGuess: async () => ({ kind: 'none' }),
      log: () => {},
      ...over,
    };
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
      method,
      headers: { 'content-type': 'application/json' },
    });
    const sent = { status: 0, body: '' };
    const res = {
      headersSent: false,
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${path}`),
      ctx as unknown as RouteContext,
    );
    return { ...sent, changes, levelCalls, prewarmed, json: sent.body ? JSON.parse(sent.body) : null };
  }

  const member = {
    brain: {
      root: '/x',
      identity: async () => ({ name: 'Ben', slug: 'ben', email: null, role: 'team', knownMember: true }),
      clients: async () => [],
    },
  };

  it('GET answers the levels with canSet and writable, for everyone', async () => {
    const sent = await call(ROUTES.skillLevels, 'GET', undefined);
    expect(sent.status).toBe(200);
    expect(sent.json).toEqual({ levels: { a: rec('deep') }, canSet: true, writable: true });
    const team = await call(ROUTES.skillLevels, 'GET', undefined, member);
    expect(team.json.canSet).toBe(false);
    const none = await call(ROUTES.skillLevels, 'GET', undefined, { skillLevels: undefined });
    expect(none.json).toEqual({ levels: {}, canSet: false, writable: false });
  });

  it('POST sets or clears through the skill service and answers the fresh levels', async () => {
    const set = await call(ROUTES.skillLevels, 'POST', { skill: 'b', tier: 'quick', note: 'Short' });
    expect(set.status).toBe(200);
    expect(set.changes).toEqual([['b', 'quick', 'Short']]);
    expect(set.json.levels.b.tier).toBe('quick');
    const clear = await call(ROUTES.skillLevels, 'POST', { skill: 'a', tier: null });
    expect(clear.status).toBe(200);
    expect(clear.changes).toEqual([['a', null, undefined]]);
  });

  it('POST is 403 for team members, and when the brain has no skill yet, without running anything', async () => {
    const team = await call(ROUTES.skillLevels, 'POST', { skill: 'b', tier: 'quick' }, member);
    expect(team.status).toBe(403);
    expect(team.changes).toEqual([]);
    const notWritable = await call(
      ROUTES.skillLevels,
      'POST',
      { skill: 'b', tier: 'quick' },
      { skillLevels: { read: async () => ({}), writable: async () => false, change: async () => {} } },
    );
    expect(notWritable.status).toBe(403);
    const absent = await call(
      ROUTES.skillLevels,
      'POST',
      { skill: 'b', tier: 'quick' },
      { skillLevels: undefined },
    );
    expect(absent.status).toBe(403);
  });

  it('POST is 400 for a bad skill, tier or note, and passes the script’s refusals on', async () => {
    for (const body of [
      {},
      { skill: 'b' },
      { skill: 'b', tier: 'huge' },
      { skill: '../x', tier: 'deep' },
      { skill: 7, tier: 'deep' },
      { skill: 'b', tier: 'deep', note: 'x'.repeat(161) },
      { skill: 'b', tier: 'deep', note: 3 },
      [],
    ]) {
      const sent = await call(ROUTES.skillLevels, 'POST', body);
      expect(sent.status).toBe(400);
      expect(sent.changes).toEqual([]);
    }
    const unknown = await call(
      ROUTES.skillLevels,
      'POST',
      { skill: 'b', tier: 'deep' },
      {
        skillLevels: {
          read: async () => ({}),
          writable: async () => true,
          change: async () => {
            throw new SkillLevelError('bad-request', 'x');
          },
        },
      },
    );
    expect(unknown.status).toBe(400);
    const broken = await call(
      ROUTES.skillLevels,
      'POST',
      { skill: 'b', tier: 'deep' },
      {
        skillLevels: {
          read: async () => ({}),
          writable: async () => true,
          change: async () => {
            throw new Error('boom');
          },
        },
      },
    );
    expect(broken.status).toBe(500);
  });

  it('refuses other methods', async () => {
    expect((await call(ROUTES.skillLevels, 'PUT', {})).status).toBe(405);
  });

  it('POST chat level hands the tier to the session and answers { level: TurnLevel }', async () => {
    const sent = await call(ROUTES.chatLevel('s 1'), 'POST', { tier: 'deep' });
    expect(sent.status).toBe(200);
    expect(sent.levelCalls).toEqual([['s 1', 'deep']]);
    expect(sent.json).toEqual({ level: { tier: 'deep', source: { kind: 'chat' } } });
    const auto = await call(ROUTES.chatLevel('s1'), 'POST', { tier: null });
    expect(auto.levelCalls).toEqual([['s1', null]]);
    for (const body of [{}, { tier: 'huge' }, { tier: 3 }]) {
      expect((await call(ROUTES.chatLevel('s1'), 'POST', body)).status).toBe(400);
    }
    expect((await call(ROUTES.chatLevel('s1'), 'GET', undefined)).status).toBe(405);
  });

  it('POST chat level passes a SessionError on as its status', async () => {
    const sent = await call(
      ROUTES.chatLevel('gone'),
      'POST',
      { tier: 'deep' },
      {
        sessions: {
          setChatLevel: async () => {
            throw new SessionError('not-found', 'That chat has closed.');
          },
        },
      },
    );
    expect(sent.status).toBe(404);
  });

  it('the client guess pre-warms the pick, and still answers when that throws', async () => {
    const sent = await call('/api/client-guess', 'POST', { text: 'audit acme ads' });
    expect(sent.status).toBe(200);
    expect(sent.prewarmed).toEqual(['audit acme ads']);
    const broken = await call(
      '/api/client-guess',
      'POST',
      { text: 'hi' },
      {
        sessions: {
          prewarmPick: () => {
            throw new Error('boom');
          },
        },
      },
    );
    expect(broken.status).toBe(200);
  });

  it('saving levelMode passes it, with the saved model and effort, to the sessions', async () => {
    const choices: unknown[] = [];
    const sessions = { setEngineChoice: async (c: unknown) => void choices.push(c) };
    const sent = await call('/api/prefs', 'PUT', { levelMode: 'manual' }, { sessions });
    expect(sent.status).toBe(200);
    expect(choices).toEqual([{ model: null, effort: null, levelMode: 'manual' }]);
    expect((await call('/api/prefs', 'PUT', { levelMode: 'turbo' }, { sessions })).status).toBe(400);
  });

  it('bootstrap carries the skill levels', async () => {
    const sent = await call(ROUTES.bootstrap, 'GET', undefined, {
      brain: {
        ...member.brain,
        health: async () => ({ ok: true, path: '/x', problems: [] }),
        profile: async () => ({}),
        skills: async () => [],
        usedOften: async () => [],
      },
      store: { get: async () => ({}) },
      engineHealth: () => ({ ok: true }),
      launchToken: 't',
      port: 3877,
    });
    expect(sent.json.skillLevels).toEqual({ levels: { a: rec('deep') }, canSet: false, writable: true });
  });

  it('bootstrap clients carry their codes from clients/map.json, for the client pickers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tba-boot-aliases-'));
    try {
      mkdirSync(join(root, 'clients'));
      writeFileSync(
        join(root, 'clients', 'map.json'),
        JSON.stringify({ 'urban-cooling': { name: 'Urban Cooling', aliases: ['UC', 'urban_cooling'] } }),
      );
      const sent = await call(ROUTES.bootstrap, 'GET', undefined, {
        brain: {
          ...member.brain,
          root,
          health: async () => ({ ok: true, path: root, problems: [] }),
          profile: async () => ({}),
          skills: async () => [],
          usedOften: async () => [],
          clients: async () => [
            { slug: 'astrum', name: 'Astrum' },
            { slug: 'urban-cooling', name: 'Urban Cooling' },
          ],
        },
        store: { get: async () => ({}) },
        engineHealth: () => ({ ok: true }),
        launchToken: 't',
        port: 3877,
      });
      expect(sent.json.clients).toEqual([
        { slug: 'astrum', name: 'Astrum' },
        { slug: 'urban-cooling', name: 'Urban Cooling', aliases: ['UC'] },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('POST /api/sessions/:id/kind', () => {
  async function post(path: string, body: unknown, setKind: (id: string, kind: string) => Promise<unknown>) {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const sent = { status: 0, body: '' };
    const res = {
      headersSent: false,
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${path}`),
      { sessions: { setKind }, log: () => {} } as unknown as RouteContext,
    );
    return { status: sent.status, json: JSON.parse(sent.body) };
  }

  it('accepts tds and personal and replies with the session', async () => {
    const calls: unknown[] = [];
    const setKind = async (id: string, kind: string) => {
      calls.push([id, kind]);
      return { id, kind };
    };
    for (const kind of ['tds', 'personal']) {
      const sent = await post('/api/sessions/abc%20d/kind', { kind }, setKind);
      expect(sent.status).toBe(200);
      expect(sent.json).toEqual({ session: { id: 'abc d', kind } });
    }
    expect(calls).toEqual([
      ['abc d', 'tds'],
      ['abc d', 'personal'],
    ]);
  });

  it('refuses anything else with bad-request, without calling the sessions', async () => {
    let called = false;
    const setKind = async () => {
      called = true;
      return {};
    };
    for (const body of [{ kind: 'work' }, { kind: 5 }, {}, { kind: null }]) {
      const sent = await post('/api/sessions/abc/kind', body, setKind);
      expect(sent.status).toBe(400);
      expect(sent.json.error?.code ?? sent.json.code).toBe('bad-request');
    }
    expect(called).toBe(false);
  });

  it('maps an unknown chat to 404', async () => {
    const sent = await post('/api/sessions/zzz/kind', { kind: 'tds' }, async () => {
      throw new SessionError('not-found', 'That chat could not be found.');
    });
    expect(sent.status).toBe(404);
  });
});

describe('DELETE /api/sessions/past/:id', () => {
  const ID = '11111111-2222-4333-8444-555555555555';
  async function send(method: string, path: string, deletePast: (id: string) => Promise<void>) {
    const req = Object.assign(Readable.from([]), { method, headers: {} });
    const sent = { status: 0, body: '' };
    const res = {
      headersSent: false,
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${path}`),
      { sessions: { deletePast }, log: () => {} } as unknown as RouteContext,
    );
    return { status: sent.status, json: sent.body ? JSON.parse(sent.body) : null };
  }

  it('answers 200 with an empty object and passes the decoded id on', async () => {
    const seen: string[] = [];
    const sent = await send('DELETE', ROUTES.pastSession(ID), async (id) => {
      seen.push(id);
    });
    expect(sent).toEqual({ status: 200, json: {} });
    expect(seen).toEqual([ID]);
  });

  it.each([
    ['bad-request', 400],
    ['not-found', 404],
    ['already-open', 409],
    ['internal', 500],
  ] as const)('maps %s to %i', async (code, status) => {
    const sent = await send('DELETE', ROUTES.pastSession(ID), async () => {
      throw new SessionError(code, 'Plain message.');
    });
    expect(sent.status).toBe(status);
    expect(sent.json.error.code).toBe(code);
  });

  it('refuses other methods with 405, without deleting', async () => {
    let called = false;
    for (const method of ['GET', 'POST', 'PUT']) {
      const sent = await send(method, ROUTES.pastSession(ID), async () => {
        called = true;
      }).catch((e: { status?: number }) => ({ status: e.status ?? 0 }));
      expect(sent.status).toBe(405);
    }
    expect(called).toBe(false);
  });

  it('refuses a badly encoded id', async () => {
    const sent = await send('DELETE', '/api/sessions/past/%E0%A4%A', async () => {});
    expect(sent.status).toBe(400);
  });
});

describe('the chat context detail (plan 2026-11-14-context-management, decision 6)', () => {
  const PORT = 3877;
  const TOKEN = 'context-route-token';
  const DETAIL = {
    reading: null,
    items: [{ name: 'Messages', tokens: 10, group: 'messages' }],
    lastCompaction: null,
    approximate: false,
  };

  /** Through the real gate first, as server.ts runs it, then the route. */
  async function call(
    method: string,
    path: string,
    sessions: Record<string, unknown>,
    headers: Record<string, string | undefined> = {},
  ) {
    const sent = { status: 0, body: '', gate: '' };
    const all = {
      host: `127.0.0.1:${PORT}`,
      cookie: `${SESSION_COOKIE}=${cookieValueFor(TOKEN)}`,
      'sec-fetch-site': 'same-origin',
      ...headers,
    };
    const gate = checkRequest({ method, path, headers: all }, { port: PORT, launchToken: TOKEN });
    sent.gate = gate.action;
    if (gate.action !== 'allow') {
      if (gate.action === 'reject') sent.status = gate.status;
      return { ...sent, json: null };
    }
    const req = Object.assign(Readable.from([]), { method, headers: all });
    const res = {
      headersSent: false,
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:${PORT}${path}`),
      { sessions, log: () => {} } as unknown as RouteContext,
    );
    return { ...sent, json: sent.body ? JSON.parse(sent.body) : null };
  }

  it('a plain GET from the page passes the gate and answers the session manager’s detail', async () => {
    const asked: string[] = [];
    const sent = await call('GET', ROUTES.chatContext('chat 1'), {
      contextDetail: async (id: string) => {
        asked.push(id);
        return DETAIL;
      },
    });
    expect(sent.gate).toBe('allow');
    expect(sent.status).toBe(200);
    expect(asked).toEqual(['chat 1']);
    expect(sent.json).toEqual(DETAIL);
  });

  it('is refused by the gate without a session, and from another site', async () => {
    const sessions = { contextDetail: async () => DETAIL };
    expect((await call('GET', ROUTES.chatContext('c1'), sessions, { cookie: undefined })).status).toBe(401);
    expect(
      (await call('GET', ROUTES.chatContext('c1'), sessions, { 'sec-fetch-site': 'cross-site' })).status,
    ).toBe(403);
  });

  it('is GET only, 404 for an unknown chat, and 404 where the manager has no detail (setup mode)', async () => {
    const sessions = {
      contextDetail: async () => {
        throw new SessionError('not-found', 'That chat could not be found.');
      },
    };
    const post = await call('POST', ROUTES.chatContext('c1'), sessions, {
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${PORT}`,
    });
    expect(post.status).toBe(405);
    expect((await call('GET', ROUTES.chatContext('gone'), sessions)).status).toBe(404);
    expect((await call('GET', ROUTES.chatContext('c1'), createSetupSessions() as never)).status).toBe(404);
    expect((await call('GET', '/api/sessions/%E0%A4%A/context', sessions)).status).toBe(400);
  });
});

describe('a chat’s pages (plan 2026-11-14-artifacts-in-app, decisions 3, 6 and 7)', () => {
  type Sent = { status: number; headers: Record<string, string | number>; cspSets: number; body: Buffer };
  const SID = 'live-chat-1';
  const KEY = 'pAgEkEy_0123-ab';

  function sessions(over: Record<string, unknown> = {}) {
    const asks: unknown[] = [];
    return {
      asks,
      fake: {
        pageCopy: async (id: string, key: string, n: number) => {
          if (id !== SID) throw new SessionError('not-found', 'That chat could not be found.');
          if (key !== KEY) return null;
          if (n === 1) return Buffer.from('<h1>Fragment</h1><script>1</script>');
          if (n === 2) return Buffer.from('﻿  <!DOCTYPE html><html><body>Whole</body></html>');
          return null;
        },
        brandedCopy: async (id: string, key: string, n: number) => {
          if (id !== SID) throw new SessionError('not-found', 'That chat could not be found.');
          if (key !== KEY || n > 1) return null;
          return {
            name: 'budget “q3”-tds-2026-11-14.html',
            html: `<!DOCTYPE html><p>Branded ${n}</p>`,
            selfContained: n === 1,
          };
        },
        askPage: async (id: string, key: string, req: unknown) => {
          asks.push({ id, key, req });
        },
        ...over,
      },
    };
  }

  async function call(
    path: string,
    o: { method?: string; body?: unknown; sessions?: Record<string, unknown> } = {},
  ): Promise<Sent> {
    const raw =
      o.body === undefined ? [] : [Buffer.from(typeof o.body === 'string' ? o.body : JSON.stringify(o.body))];
    const req = Object.assign(Readable.from(raw), { method: o.method ?? 'GET', headers: {} });
    const sent: Sent = { status: 0, headers: {}, cspSets: 0, body: Buffer.alloc(0) };
    const res = {
      headersSent: false,
      setHeader(name: string, value: string | number) {
        if (name.toLowerCase() === 'content-security-policy') sent.cspSets++;
        sent.headers[name.toLowerCase()] = value;
      },
      writeHead(status: number, headers: Record<string, string | number> = {}) {
        sent.status = status;
        for (const [k, v] of Object.entries(headers)) sent.headers[k.toLowerCase()] = v;
        res.headersSent = true;
      },
      end(body?: string | Buffer) {
        if (body !== undefined) sent.body = Buffer.isBuffer(body) ? body : Buffer.from(body);
      },
    };
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${path}`),
      { sessions: o.sessions ?? sessions().fake, log: () => {} } as unknown as RouteContext,
    );
    return sent;
  }

  it('sends a page under the preview policy, replacing the app’s, wrapped in the page skeleton', async () => {
    const sent = await call(ROUTES.chatPage(SID, KEY, 1));
    expect(sent.status).toBe(200);
    expect(sent.headers['content-security-policy']).toBe(PAGE_PREVIEW_CSP);
    expect(sent.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(sent.headers['x-content-type-options']).toBe('nosniff');
    expect(sent.headers['cache-control']).toBe('no-store');
    const html = sent.body.toString('utf8');
    expect(html.startsWith(`<!doctype html>${LINK_SCRIPT_TAG}\n<html>`)).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('body{margin:0;font:14px system-ui');
    expect(html).toContain('img{max-width:100%}');
    expect(html).toContain('[hidden]{display:none}');
    expect(html).toContain('<h1>Fragment</h1><script>1</script>');
    expect(sent.headers['content-length']).toBe(sent.body.length);
  });

  it('leaves a page that starts with a doctype as stored, but for the link script after it', async () => {
    const stored = Buffer.from('﻿  <!DOCTYPE html><html><body>Whole</body></html>');
    const copy = Buffer.from(stored);
    const sent = await call(ROUTES.chatPage(SID, KEY, 2), {
      sessions: sessions({ pageCopy: async () => copy }).fake,
    });
    expect(sent.status).toBe(200);
    expect(sent.body.toString('utf8')).toBe(
      `﻿  <!DOCTYPE html>${LINK_SCRIPT_TAG}<html><body>Whole</body></html>`,
    );
    expect(sent.headers['content-length']).toBe(sent.body.length);
    // The copy the store handed over is not changed.
    expect(copy.equals(stored)).toBe(true);
  });

  it('keeps error pages free of the link script', async () => {
    for (const path of [ROUTES.chatPage(SID, 'unknown', 1), ROUTES.chatPage(SID, KEY, 3)]) {
      const sent = await call(path);
      expect(sent.body.toString('utf8')).not.toContain('<script');
    }
  });

  it('answers every miss as a small page under the same policy, never JSON', async () => {
    const cases: [string, number, string][] = [
      [ROUTES.chatPage('other-chat', KEY, 1), 404, 'GET'],
      [ROUTES.chatPage(SID, 'unknown', 1), 404, 'GET'],
      [ROUTES.chatPage(SID, KEY, 3), 404, 'GET'],
      [ROUTES.chatPage(SID, 'a.b', 1), 404, 'GET'],
      [ROUTES.chatPage(SID, 'a b', 1), 404, 'GET'],
      [`/api/sessions/${SID}/pages/${KEY}/00`, 404, 'GET'],
      [`/api/sessions/${SID}/pages/${KEY}/1.5`, 404, 'GET'],
      [`/api/sessions/${SID}/pages/%E0%A4%A/1`, 404, 'GET'],
      [ROUTES.chatPage(SID, KEY, 1), 405, 'POST'],
    ];
    for (const [path, status, method] of cases) {
      const sent = await call(path, { method });
      expect(sent.status, path).toBe(status);
      expect(sent.headers['content-security-policy'], path).toBe(PAGE_PREVIEW_CSP);
      expect(sent.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(sent.headers['x-content-type-options']).toBe('nosniff');
      expect(sent.body.toString('utf8')).toMatch(/^<!doctype html>/);
    }
    // A server whose chats can't hold pages (setup mode) says the same.
    const none = await call(ROUTES.chatPage(SID, KEY, 1), { sessions: {} });
    expect(none.status).toBe(404);
    expect(none.headers['content-security-policy']).toBe(PAGE_PREVIEW_CSP);
    const broken = await call(ROUTES.chatPage(SID, KEY, 1), {
      sessions: { pageCopy: async () => Promise.reject(new Error('boom /secret/path')) },
    });
    expect(broken.status).toBe(500);
    expect(broken.body.toString('utf8')).not.toContain('/secret/path');
  });

  it('serves the copy Claude is still working on as version 0, and says when it isn’t kept', async () => {
    const draft = await call(ROUTES.chatPage(SID, KEY, 0), {
      sessions: sessions({
        pageCopy: async (_i: string, _k: string, n: number) => (n === 0 ? Buffer.from('<p>Draft</p>') : null),
      }).fake,
    });
    expect(draft.status).toBe(200);
    expect(draft.body.toString('utf8')).toContain('<p>Draft</p>');
    const none = await call(ROUTES.chatPage(SID, KEY, 0));
    expect(none.status).toBe(404);
    expect(none.body.toString('utf8')).toContain('couldn&#39;t keep a copy');
  });

  it('sends the TDS-branded copy as a download, never shown in place (R5, O1)', async () => {
    const sent = await call(ROUTES.chatPageBranded(SID, KEY, 1));
    expect(sent.status).toBe(200);
    expect(sent.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    expect(sent.cspSets).toBe(2);
    expect(sent.headers['content-type']).toBe('application/octet-stream');
    expect(sent.headers['content-disposition']).toBe(
      `attachment; filename="budget _q3_-tds-2026-11-14.html"; filename*=UTF-8''budget%20%E2%80%9Cq3%E2%80%9D-tds-2026-11-14.html`,
    );
    expect(sent.headers['x-content-type-options']).toBe('nosniff');
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(sent.body.toString('utf8')).toBe('<!DOCTYPE html><p>Branded 1</p>');
    expect(sent.headers['content-length']).toBe(sent.body.length);
    expect(sent.headers['x-page-self-contained']).toBe('yes');
    const partly = await call(ROUTES.chatPageBranded(SID, KEY, 0));
    expect(partly.status).toBe(200);
    // R8: the viewer words its status line from this.
    expect(partly.headers['x-page-self-contained']).toBe('partial');
  });

  it('answers every miss on the branded download as the same small page', async () => {
    const cases: [string, number, string][] = [
      [ROUTES.chatPageBranded('other-chat', KEY, 1), 404, 'GET'],
      [ROUTES.chatPageBranded(SID, 'unknown', 1), 404, 'GET'],
      [ROUTES.chatPageBranded(SID, KEY, 3), 404, 'GET'],
      [ROUTES.chatPageBranded(SID, 'a.b', 1), 404, 'GET'],
      [`/api/sessions/${SID}/pages/${KEY}/x/branded`, 404, 'GET'],
      [ROUTES.chatPageBranded(SID, KEY, 1), 405, 'POST'],
    ];
    for (const [path, status, method] of cases) {
      const sent = await call(path, { method });
      expect(sent.status, path).toBe(status);
      expect(sent.headers['content-security-policy'], path).toBe(PAGE_PREVIEW_CSP);
      expect(sent.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(sent.body.toString('utf8')).toMatch(/^<!doctype html>/);
    }
    expect((await call(ROUTES.chatPageBranded(SID, KEY, 1), { sessions: {} })).status).toBe(404);
    const broken = await call(ROUTES.chatPageBranded(SID, KEY, 1), {
      sessions: { brandedCopy: async () => Promise.reject(new Error('boom /secret/path')) },
    });
    expect(broken.status).toBe(500);
    expect(broken.body.toString('utf8')).not.toContain('/secret/path');
  });

  it('passes a change or a branding ask to the chat', async () => {
    const s = sessions();
    const ok = await call(ROUTES.chatPageAsk(SID, KEY), {
      method: 'POST',
      body: { kind: 'change', note: 'Bigger title' },
      sessions: s.fake,
    });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body.toString('utf8'))).toEqual({ ok: true });
    await call(ROUTES.chatPageAsk(SID, KEY), { method: 'POST', body: { kind: 'brand' }, sessions: s.fake });
    expect(s.asks).toEqual([
      { id: SID, key: KEY, req: { kind: 'change', note: 'Bigger title' } },
      { id: SID, key: KEY, req: { kind: 'brand' } },
    ]);
  });

  it('refuses an ask that is not understood, before the chat sees it', async () => {
    const s = sessions();
    for (const body of [
      { kind: 'change', note: '' },
      { kind: 'change', note: '   ' },
      { kind: 'change', note: 'x'.repeat(PAGE_NOTE_MAX + 1) },
      { kind: 'change' },
      { kind: 'change', note: 5 },
      { kind: 'brand', note: 'x' },
      { kind: 'other' },
      [],
      'not json',
    ]) {
      const sent = await call(ROUTES.chatPageAsk(SID, KEY), { method: 'POST', body, sessions: s.fake });
      expect(sent.status, JSON.stringify(body)).toBe(400);
      expect(JSON.parse(sent.body.toString('utf8')).error.code).toBe('bad-request');
    }
    expect(s.asks).toEqual([]);
    expect(
      (
        await call(ROUTES.chatPageAsk(SID, KEY), {
          method: 'POST',
          body: { kind: 'change', note: 'x'.repeat(PAGE_NOTE_MAX) },
          sessions: s.fake,
        })
      ).status,
    ).toBe(200);
    expect((await call(ROUTES.chatPageAsk(SID, KEY), { sessions: s.fake })).status).toBe(405);
  });

  it('says busy, not-found and not-allowed as the chat does', async () => {
    for (const [code, status] of [
      ['busy', 409],
      ['not-found', 404],
      ['not-allowed', 403],
      ['session-closed', 410],
    ] as const) {
      const sent = await call(ROUTES.chatPageAsk(SID, KEY), {
        method: 'POST',
        body: { kind: 'brand' },
        sessions: {
          askPage: async () => {
            throw new SessionError(code, 'Nope.');
          },
        },
      });
      expect(sent.status, code).toBe(status);
      expect(JSON.parse(sent.body.toString('utf8')).error.code).toBe(code);
    }
    const none = await call(ROUTES.chatPageAsk(SID, KEY), {
      method: 'POST',
      body: { kind: 'brand' },
      sessions: {},
    });
    expect(none.status).toBe(404);
  });
});

describe('DELETE ROUTES.libraryItem (plan 2026-11-15-delete-library-files)', () => {
  const PORT = 3877;
  const TOKEN = 'delete-file-token';
  const ID = 'client:acme-heating.0123456789abcdef01234567';
  const OTHER = 'client:acme-heating.aaaaaaaaaaaaaaaaaaaaaaaa';

  function setup(deleteLibraryFile: unknown, starred: string[] = [ID, OTHER]) {
    const state = { starred, published: [] as unknown[], logs: [] as string[] };
    const ctx = {
      brain: deleteLibraryFile === undefined ? {} : { deleteLibraryFile },
      store: {
        get: async () => ({ favouriteFiles: state.starred }),
        update: async (patch: { favouriteFiles?: string[] }) => {
          if (patch.favouriteFiles) state.starred = patch.favouriteFiles;
          return {};
        },
      },
      hub: { publish: (e: unknown) => state.published.push(e) },
      log: (l: string) => state.logs.push(l),
    } as unknown as RouteContext;
    return { ctx, state };
  }

  /** Through the real gate first, as server.ts runs it, then the route. */
  async function call(
    ctx: RouteContext,
    opts: { id?: string; rawPath?: string; body?: string; method?: string; contentType?: string | null } = {},
  ) {
    const method = opts.method ?? 'DELETE';
    const path = opts.rawPath ?? ROUTES.libraryItem(opts.id ?? ID);
    const headers: Record<string, string | undefined> = {
      host: `127.0.0.1:${PORT}`,
      cookie: `${SESSION_COOKIE}=${cookieValueFor(TOKEN)}`,
      'sec-fetch-site': 'same-origin',
      origin: `http://127.0.0.1:${PORT}`,
      'content-type': opts.contentType === null ? undefined : (opts.contentType ?? 'application/json'),
    };
    const gate = checkRequest({ method, path, headers }, { port: PORT, launchToken: TOKEN });
    if (gate.action !== 'allow')
      return { gate: gate.action, status: gate.action === 'reject' ? gate.status : 0, json: null };
    const req = Object.assign(Readable.from(opts.body === undefined ? [] : [Buffer.from(opts.body)]), {
      method,
      headers,
    });
    const sent = { status: 0, body: '' };
    const res = {
      headersSent: false,
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text?: string) => {
        sent.body = text ?? '';
      },
    };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:${PORT}${path}`),
      ctx,
    );
    return { gate: gate.action, status: sent.status, json: sent.body ? JSON.parse(sent.body) : null };
  }

  it('passes the real gate with a JSON body, deletes, answers 204, clears the star and tells the pages', async () => {
    const seen: { id: string; opts: { expect?: string } }[] = [];
    const { ctx, state } = setup(async (id: string, opts: { expect?: string }) => {
      seen.push({ id, opts });
    });
    const sent = await call(ctx, { body: '{"expect":"12-345"}' });
    expect(sent).toMatchObject({ gate: 'allow', status: 204, json: null });
    expect(seen).toEqual([{ id: ID, opts: { expect: '12-345' } }]);
    expect(state.starred).toEqual([OTHER]);
    expect(state.published).toEqual([{ type: 'brain-changed', area: 'library' }]);
  });

  it('accepts an empty body and a body with no expect', async () => {
    const seen: unknown[] = [];
    const { ctx } = setup(async (_id: string, opts: unknown) => {
      seen.push(opts);
    });
    expect((await call(ctx)).status).toBe(204);
    expect((await call(ctx, { body: '{}' })).status).toBe(204);
    expect(seen).toEqual([{}, {}]);
  });

  it('is refused by the gate without a JSON content type (415), and with no session (401)', async () => {
    let called = false;
    const { ctx } = setup(async () => {
      called = true;
    });
    expect((await call(ctx, { contentType: null })).status).toBe(415);
    expect((await call(ctx, { contentType: 'text/plain' })).status).toBe(415);
    expect(called).toBe(false);
  });

  it.each(Object.entries(FILES_CHANGE_STATUS).filter(([c]) => c !== 'exists') as [FilesErrorCode, number][])(
    'maps %s to %i with the app’s own message, and keeps the star',
    async (code, status) => {
      const { ctx, state } = setup(async () => {
        throw new FilesChangeError(code);
      });
      const sent = await call(ctx, { body: '{}' });
      expect(sent.status).toBe(status);
      expect(sent.json.error.message).toBe(FILES_CHANGE_MESSAGES[code]);
      expect(sent.json.error.code).toBe(code);
      expect(state.starred).toEqual([ID, OTHER]);
      expect(state.published).toEqual([]);
    },
  );

  it('answers 500 with the app’s words when something unexpected fails, and keeps the star', async () => {
    const { ctx, state } = setup(async () => {
      throw new Error('/Users/secret/path exploded');
    });
    const sent = await call(ctx, { body: '{}' });
    expect(sent.status).toBe(500);
    expect(JSON.stringify(sent.json)).not.toContain('secret');
    expect(sent.json.error.message).toBe(FILES_CHANGE_MESSAGES.internal);
    expect(state.starred).toEqual([ID, OTHER]);
  });

  it('answers 404 not-found when the brain cannot delete files (an older fake)', async () => {
    const { ctx } = setup(undefined);
    const sent = await call(ctx, { body: '{}' });
    expect(sent.status).toBe(404);
    expect(sent.json.error.code).toBe('not-found');
  });

  it('refuses a body that is not what it expects, without deleting', async () => {
    let called = false;
    const { ctx } = setup(async () => {
      called = true;
    });
    for (const body of ['{"expect":5}', '{"expect":""}', '{"expect":["a"]}', '{not json']) {
      expect((await call(ctx, { body })).status, body).toBe(400);
    }
    expect(called).toBe(false);
  });

  it('does not fail the delete when the star cannot be cleared', async () => {
    const { ctx, state } = setup(async () => {});
    (ctx.store as unknown as { update: () => Promise<never> }).update = async () => {
      throw new Error('disk full');
    };
    expect((await call(ctx, { body: '{}' })).status).toBe(204);
    expect(state.published).toHaveLength(1);
  });

  it('leaves the stars alone when the file was not starred, and refuses other methods', async () => {
    let updates = 0;
    const { ctx } = setup(async () => {}, [OTHER]);
    (ctx.store as unknown as { update: () => Promise<unknown> }).update = async () => {
      updates++;
      return {};
    };
    expect((await call(ctx, { body: '{}' })).status).toBe(204);
    expect(updates).toBe(0);
    for (const method of ['GET', 'POST', 'PUT']) {
      const sent = await call(ctx, { method, body: '{}' }).catch((e: { status?: number }) => ({
        status: e.status ?? 0,
      }));
      expect(sent.status, method).toBe(405);
    }
  });

  it('decodes the id and refuses a badly encoded one', async () => {
    const seen: string[] = [];
    const { ctx } = setup(async (id: string) => {
      seen.push(id);
    });
    expect((await call(ctx, { body: '{}' })).status).toBe(204);
    expect(seen).toEqual([ID]);
    const bad = await call(ctx, { rawPath: '/api/library/items/%E0%A4%A', body: '{}' }).catch(
      (e: { status?: number }) => ({
        status: e.status ?? 0,
      }),
    );
    expect(bad.status).toBe(404);
  });
});

describe('POST ROUTES.todoUpload (plan 2026-11-16-todo-attachments, decision 3)', () => {
  const PORT = 3877;
  const TOKEN = 'todo-upload-token';
  const MINE = '20261101-renew-contract.md';
  const SCRIPT = `
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const cmd = process.argv[2];
  const which = process.argv[1].includes('tdsapp-files') ? 'files' : 'todo';
  if (cmd === 'capabilities') {
    const features = which === 'files' ? ['files-delete-v1', 'files-add-v1'] : JSON.parse(process.env.FAKE_TODO_CAPS);
    process.stdout.write(JSON.stringify({ ok: true, version: '0.5', features }));
    return;
  }
  fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ which, cmd, body: JSON.parse(input) }) + '\\n');
  const r = JSON.parse(process.env.FAKE_REPLIES || '{}')[which + ':' + cmd] || {};
  process.stdout.write(r.out || '{"ok":true}');
  process.exitCode = r.exit || 0;
});
`;

  function setup(opts: { caps?: string[]; replies?: Record<string, { out?: string; exit?: number }> } = {}) {
    const root = copyFixture();
    for (const skill of ['tdsapp-todo', 'tdsapp-files']) {
      mkdirSync(join(root, '.claude', 'skills', skill, 'scripts'), { recursive: true });
      writeFileSync(join(root, '.claude', 'skills', skill, 'SKILL.md'), '---\nroles: owner, scout\n---\n');
      writeFileSync(join(root, '.claude', 'skills', skill, 'scripts', `${skill}.cjs`), SCRIPT);
    }
    const dir = mkdtempSync(join(tmpdir(), 'tba-todo-upload-'));
    tempDirs.push(dir);
    const log = join(dir, 'calls.jsonl');
    const env = {
      PATH: process.env.PATH,
      FAKE_LOG: log,
      FAKE_TODO_CAPS: JSON.stringify(opts.caps ?? ['handover', 'scope', 'attach']),
      FAKE_REPLIES: JSON.stringify(
        opts.replies ?? {
          'files:add': { out: JSON.stringify({ ok: true, path: 'clients/acme-heating/images/logo.png' }) },
        },
      ),
    };
    const whoami = { name: 'Sam Example', slug: 'sam-example', role: 'scout', knownMember: true };
    const brain = createBrainReaders(root, {
      run: async () => ({ stdout: JSON.stringify(whoami) }),
      todoSkill: { env },
      filesSkill: { env },
    });
    const uploads = createUploadStaging({ dataDir: join(dir, 'data'), brainRoot: root, sweepMs: 0 });
    stagings.push(uploads);
    const logs: string[] = [];
    const ctx = (directWrites = true) =>
      ({
        brain,
        uploads,
        store: { get: async () => ({ directWrites }) },
        log: (l: string) => logs.push(l),
      }) as unknown as RouteContext;
    const calls = () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l) as { which: string; cmd: string; body: Record<string, unknown> })
        : [];
    const version = () =>
      createHash('sha256')
        .update(readFileSync(join(root, 'todo', MINE)))
        .digest('hex');
    const stage = (name = 'logo.png') => uploads.save(Readable.from([Buffer.from('bytes')]), name, 5);
    return { root, brain, uploads, ctx, calls, version, stage, logs };
  }

  /** Through the real gate first, as server.ts runs it, then the route. */
  async function call(
    ctx: RouteContext,
    body: unknown,
    opts: { method?: string; contentType?: string } = {},
  ): Promise<{ gate: string; status: number; json: unknown }> {
    const method = opts.method ?? 'POST';
    const headers: Record<string, string | undefined> = {
      host: `127.0.0.1:${PORT}`,
      cookie: `${SESSION_COOKIE}=${cookieValueFor(TOKEN)}`,
      'sec-fetch-site': 'same-origin',
      origin: `http://127.0.0.1:${PORT}`,
      'content-type': opts.contentType ?? 'application/json',
    };
    const gate = checkRequest(
      { method, path: ROUTES.todoUpload, headers },
      { port: PORT, launchToken: TOKEN },
    );
    if (gate.action !== 'allow')
      return { gate: gate.action, status: gate.action === 'reject' ? gate.status : 0, json: null };
    const raw =
      body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
    const req = Object.assign(Readable.from(raw), { method, headers });
    const sent = { status: 0, body: '' };
    const res = {
      headersSent: false,
      setHeader: () => {},
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:${PORT}${ROUTES.todoUpload}`),
      ctx,
    );
    return { gate: 'allow', status: sent.status, json: sent.body ? JSON.parse(sent.body) : null };
  }

  it('saves, attaches and answers with the fresh list, the path and personal; the upload is used up', async () => {
    const s = setup();
    const info = await s.stage();
    const expectV = s.version();
    const out = await call(s.ctx(), { upload: info.id, id: MINE, expect: expectV });
    expect(out.status).toBe(200);
    const body = out.json as TodoUploadResponse;
    expect(body.path).toBe('clients/acme-heating/images/logo.png');
    expect(body.personal).toBe(false);
    expect(body.list.canUpload).toBe(true);
    expect(body.list.mine.some((t) => t.id === MINE)).toBe(true);
    const calls = s.calls();
    expect(calls.map((c) => `${c.which}:${c.cmd}`)).toEqual(['files:add', 'todo:attach']);
    expect(calls[0]?.body).toMatchObject({ path: 'clients/acme-heating/images/logo.png', via: 'TDS Cortex' });
    expect(String(calls[0]?.body.source)).toMatch(/logo\.png$/);
    expect(calls[1]?.body).toMatchObject({
      file: MINE,
      path: 'clients/acme-heating/images/logo.png',
      expect: expectV,
    });
    expect(() => s.uploads.peek([info.id])).toThrow();
    expect(s.logs).toEqual(['Added a file to a task.']);
  });

  it('answers 409 with the saved-but-not-linked message when attach fails after add', async () => {
    const s = setup({
      replies: {
        'files:add': { out: JSON.stringify({ ok: true, path: 'clients/acme-heating/images/logo (2).png' }) },
        'todo:attach': { exit: 2, out: '{"ok":false,"status":409,"error":"changed"}' },
      },
    });
    const info = await s.stage();
    const out = await call(s.ctx(), { upload: info.id, id: MINE, expect: s.version() });
    expect(out.status).toBe(409);
    expect((out.json as { error: { message: string } }).error.message).toContain(
      'saved to the library at clients/acme-heating/images/logo (2).png',
    );
    expect(() => s.uploads.peek([info.id])).toThrow();
  });

  it('refuses with 403 unless canUpload, still using the upload up, and running nothing', async () => {
    const s = setup({ caps: ['handover', 'scope'] });
    const info = await s.stage();
    const out = await call(s.ctx(), { upload: info.id, id: MINE, expect: s.version() });
    expect(out.status).toBe(403);
    expect(s.calls()).toEqual([]);
    expect(() => s.uploads.peek([info.id])).toThrow();
  });

  it('refuses with 403 while the Settings switch is off, leaving the upload', async () => {
    const s = setup();
    const info = await s.stage();
    const out = await call(s.ctx(false), { upload: info.id, id: MINE, expect: s.version() });
    expect(out.status).toBe(403);
    expect(s.uploads.peek([info.id])).toHaveLength(1);
  });

  it('refuses with 400 a bad shape, an unknown or used upload, and a type tasks never take', async () => {
    const s = setup();
    const info = await s.stage();
    for (const body of [
      null,
      { upload: info.id, id: MINE },
      { upload: info.id, id: MINE, expect: s.version(), extra: 1 },
      { upload: info.id, id: MINE, expect: s.version(), scope: 'shared' },
      { upload: 7, id: MINE, expect: s.version() },
    ]) {
      expect((await call(s.ctx(), body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(s.uploads.peek([info.id])).toHaveLength(1);
    expect((await call(s.ctx(), { upload: 'not-an-id', id: MINE, expect: s.version() })).status).toBe(400);
    const page = await s.stage('page.html');
    expect((await call(s.ctx(), { upload: page.id, id: MINE, expect: s.version() })).status).toBe(400);
    expect(() => s.uploads.peek([page.id])).toThrow();
    expect((await call(s.ctx(), { upload: info.id, id: MINE, expect: s.version() })).status).toBe(200);
    expect((await call(s.ctx(), { upload: info.id, id: MINE, expect: s.version() })).status).toBe(400);
  });

  it('refuses a staged kind that is not the library kind for its extension', async () => {
    const s = setup();
    const uploads = {
      claim: () => ({
        files: [{ id: 'x', name: 'logo.png', size: 1, kind: 'document', path: '/tmp/logo.png' }],
        release() {},
      }),
    };
    const ctx = { ...s.ctx(), uploads } as unknown as RouteContext;
    expect((await call(ctx, { upload: 'x', id: MINE, expect: s.version() })).status).toBe(400);
    expect(s.calls()).toEqual([]);
  });

  it('maps not-found and changed as changeTodo does', async () => {
    const s = setup();
    const a = await s.stage();
    expect((await call(s.ctx(), { upload: a.id, id: 'nope.md', expect: s.version() })).status).toBe(404);
    const b = await s.stage();
    expect((await call(s.ctx(), { upload: b.id, id: MINE, expect: 'a'.repeat(64) })).status).toBe(409);
    expect(s.calls()).toEqual([]);
  });

  it('goes through the request gate: JSON only, signed in, POST only', async () => {
    const s = setup();
    expect((await call(s.ctx(), '{}', { contentType: 'text/plain' })).status).toBe(415);
    expect((await call(s.ctx(), undefined, { method: 'GET' })).status).toBe(405);
    const ctx = { port: PORT, launchToken: TOKEN };
    const anon = { method: 'POST', path: ROUTES.todoUpload, headers: { host: `127.0.0.1:${PORT}` } };
    expect(checkRequest(anon, ctx)).toMatchObject({ action: 'reject', status: 401 });
  });
});

describe('parseTodoAction: release 3 shapes', () => {
  it('passes add details, attach and detach through', () => {
    const good = [
      { kind: 'add', title: 'T', due: null, assignee: 'sam-example', details: 'More' },
      { kind: 'attach', id: 'a.md', path: 'clients/acme/images/logo.png' },
      { kind: 'attach', id: 'a.md', path: 'personal/files/x.pdf', scope: 'personal', expect: 'a'.repeat(64) },
      { kind: 'detach', id: 'a.md', path: 'templates/x.md', expect: 'a'.repeat(64) },
    ];
    for (const body of good) expect(parseTodoAction(body), JSON.stringify(body)).toEqual(body);
  });

  it('refuses attach and detach without a text path, or with extra fields', () => {
    for (const body of [
      { kind: 'attach', id: 'a.md' },
      { kind: 'attach', id: 'a.md', path: null },
      { kind: 'detach', id: 'a.md', path: ['x'] },
      { kind: 'attach', id: 'a.md', path: 'templates/x.md', title: 'x' },
      { kind: 'add', title: 'T', due: null, assignee: 'sam-example', details: null },
    ]) {
      expect(() => parseTodoAction(body), JSON.stringify(body)).toThrow();
    }
  });

  // The browser sends `detailsOnly: true` with every details change once files are on (a Save or a tick in the
  // panel). The route refused it, so every such save failed with "That change wasn't understood".
  it('passes an edit that says it sent the details alone', () => {
    const body = {
      kind: 'edit',
      id: 'a.md',
      title: 'T',
      details: '- [x] One',
      detailsOnly: true,
      expect: 'v1',
    };
    expect(parseTodoAction(body)).toEqual(body);
  });

  it('refuses detailsOnly with any value but true, or on any action but edit', () => {
    for (const body of [
      { kind: 'edit', id: 'a.md', title: 'T', details: 'x', detailsOnly: false },
      { kind: 'edit', id: 'a.md', title: 'T', details: 'x', detailsOnly: 'true' },
      { kind: 'edit', id: 'a.md', title: 'T', details: 'x', detailsOnly: null },
      { kind: 'due', id: 'a.md', due: null, detailsOnly: true },
      { kind: 'add', title: 'T', due: null, assignee: 'sam-example', detailsOnly: true },
    ]) {
      expect(() => parseTodoAction(body), JSON.stringify(body)).toThrow();
    }
  });
});

// Sent over real HTTP to the real server, so the request passes the real security gate (checkRequest) and the
// real body reader first: route tests that skipped the gate once let a 415-on-every-request bug through.
describe('POST /api/sessions with a project, through the real gate (Projects R2 phase 1)', () => {
  const PORT = 45923;
  const TOKEN = 'launch-token-chat-project';
  const COOKIE = `${sessionCookieName(PORT)}=${cookieValueFor(TOKEN)}`;

  async function withServer(
    run: (post: (body: unknown) => Promise<{ status: number; json: unknown }>) => Promise<void>,
  ) {
    const started: unknown[] = [];
    const app = createAppServer({
      port: PORT,
      clientDir: '/nonexistent',
      launchToken: TOKEN,
      authCodes: createAuthCodes(TOKEN),
      appVersion: '0',
      underService: false,
      brain: { watch: () => () => {} } as never,
      store: {} as never,
      sessions: {
        onChange: () => () => {},
        start: async (req: unknown) => {
          started.push(req);
          if ((req as { project?: unknown }).project === 'acme/gone')
            throw new SessionError(
              'bad-request',
              "That project isn't open any more. Pick another from Working on.",
            );
          return { id: 'chat-1' };
        },
      } as never,
      thumbs: {} as never,
      uploads: {} as never,
      engineHealth: () => ({}) as never,
      appState: { kind: 'ready' },
      setup: {} as never,
    });
    await new Promise<void>((done) => app.server.listen(0, '127.0.0.1', done));
    const port = (app.server.address() as AddressInfo).port;
    const post = (body: unknown) =>
      new Promise<{ status: number; json: unknown }>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path: ROUTES.sessions,
            method: 'POST',
            headers: {
              host: `127.0.0.1:${PORT}`,
              cookie: COOKIE,
              origin: `http://127.0.0.1:${PORT}`,
              'content-type': 'application/json',
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              let json: unknown = null;
              try {
                json = JSON.parse(Buffer.concat(chunks).toString());
              } catch {}
              resolve({ status: res.statusCode ?? 0, json });
            });
          },
        );
        req.on('error', reject);
        req.end(JSON.stringify(body));
      });
    try {
      await run(post);
    } finally {
      app.stop();
      await new Promise((done) => app.server.close(done));
    }
    return started;
  }

  it('hands the project to the session manager, and answers its refusal as 400', async () => {
    let started: unknown[] = [];
    started = await withServer(async (post) => {
      const ok = await post({ prompt: 'hi', client: 'acme', project: 'acme/web' });
      expect(ok.status).toBe(200);
      const gone = await post({ prompt: 'hi', project: 'acme/gone' });
      expect(gone.status).toBe(400);
      expect(gone.json).toEqual({
        error: {
          code: 'bad-request',
          message: "That project isn't open any more. Pick another from Working on.",
        },
      });
    });
    expect(started).toEqual([
      { prompt: 'hi', client: 'acme', project: 'acme/web' },
      { prompt: 'hi', project: 'acme/gone' },
    ]);
  });

  it('refuses a project of the wrong type with 400, before the session manager sees it', async () => {
    const started = await withServer(async (post) => {
      const bad = await post({ prompt: 'hi', project: 42 });
      expect(bad.status).toBe(400);
      expect((bad.json as { error: { code: string } }).error.code).toBe('bad-request');
    });
    expect(started).toEqual([]);
  });
});

describe('chat summaries: parsing (plan 2026-11-24-chat-summary-updates)', () => {
  const CHAT = '11111111-2222-4333-8444-555555555555';

  it('parseChatSummaryDraft takes exactly a chat id and a project key', () => {
    expect(parseChatSummaryDraft({ chat: CHAT, project: 'acme/web' })).toEqual({
      chat: CHAT,
      project: 'acme/web',
    });
    for (const bad of [
      null,
      [],
      {},
      { chat: CHAT },
      { chat: 'x', project: 'acme/web' },
      { chat: CHAT, project: 'a/b/c' },
    ])
      expect(() => parseChatSummaryDraft(bad)).toThrow(HttpError);
    expect(() => parseChatSummaryDraft({ chat: CHAT, project: 'acme/web', more: 1 })).toThrow(HttpError);
  });

  it('parseProjectAction takes a chat entry with its id and one-line title, trimmed', () => {
    expect(
      parseProjectAction({
        kind: 'update',
        key: 'acme/web',
        entry: {
          kind: 'chat',
          summary: '**Objective:** x',
          clientSafe: false,
          chat: CHAT,
          title: '  Launch  ',
        },
      }),
    ).toEqual({
      kind: 'update',
      key: 'acme/web',
      entry: { kind: 'chat', summary: '**Objective:** x', clientSafe: false, chat: CHAT, title: 'Launch' },
    });
    const entry = { kind: 'chat', summary: 's', clientSafe: true, chat: CHAT, title: 'T' };
    for (const over of [
      { chat: 'AAAAAAAA-2222-4333-8444-555555555555' },
      { title: ' ' },
      { title: 'a\nb' },
      { title: 'x'.repeat(121) },
      { clientSafe: 'no' },
      { summary: '' },
      { extra: true },
    ])
      expect(() =>
        parseProjectAction({ kind: 'update', key: 'acme/web', entry: { ...entry, ...over } }),
      ).toThrow(HttpError);
    // A note still may not carry chat fields.
    expect(() =>
      parseProjectAction({
        kind: 'update',
        key: 'acme/web',
        entry: { kind: 'note', summary: 's', clientSafe: false, chat: CHAT },
      }),
    ).toThrow(HttpError);
  });
});
