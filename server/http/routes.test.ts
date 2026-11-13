import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  type LibraryListing,
  type LibrarySearchResponse,
  MAX_ATTACHMENTS,
  ROUTES,
  SESSION_COOKIE,
  TODO_SCRIPT,
  type TodoList,
  UPLOAD_NAME_HEADER,
  type UploadResponse,
} from '../../shared/contract.ts';
import { type AppState, SETUP_ROUTES, type SetupService } from '../../shared/install-contract.ts';
import { createBrainReaders } from '../brain/index.ts';
import { copyFixture } from '../brain/test-helpers.ts';
import { createThumbnailer } from '../brain/thumbs.ts';
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
  parseStartRequest,
  parseTodoAction,
  type RouteContext,
  validatePrefsPatch,
} from './routes.ts';
import { cookieValueFor, PAGE_CSP, PDF_CSP, SECURITY_HEADERS, sessionSetCookie } from './security.ts';

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
    expect(done).toContain('Ticked off by Sam Example at 17:07 UK time (TDS Brain App).');
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
        "That change wasn't understood. Check the title and date, then try again.",
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
        `---\ndescription: Change to-dos.\nroles: ${opts.roles ?? 'owner, scout'}\nmaturity: draft\n---\n`,
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
        body: { file: MINE, via: 'TDS Brain App', by: 'sam-example', by_name: 'Sam Example' },
      },
    ]);
    expect(existsSync(join(root, 'todo', MINE))).toBe(false);
    const list = json as TodoList;
    expect(list.mine.map((t) => t.id)).not.toContain(MINE);
    expect(list.changes).toBe('on');
    expect(list.team.map((m) => m.slug)).toEqual(['sam-example', 'alex-sample', 'jo-owner']);
    expect(logs).toEqual(['Changed a to-do (delete).']);
  });

  describe('personal to-dos', () => {
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

    it('ticks a personal to-do through the script with scope, and never writes itself', async () => {
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
            via: 'TDS Brain App',
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
      message: "Adding and editing to-dos is switched off. Turn on 'Let the app change to-dos' in Settings.",
    });
    expect(calls()).toEqual([]);
    expect(existsSync(join(root, 'todo', MINE))).toBe(true);
  });

  it('refuses a body that is not a to-do change, and other methods', async () => {
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
        "That change wasn't understood. Check the title and date, then try again.",
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
      message: 'That to-do could not be found. It may have been finished, deleted or passed on.',
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
    expect(sent.json.error.message).toContain('Someone else changed this to-do');
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

  async function call(ctx: RouteContext, path: string, method = 'GET'): Promise<Sent> {
    const req = Object.assign(Readable.from([]), { method, headers: {} });
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

  it('sends an HTML page under its own sandboxed policy', async () => {
    const { root, ctx } = setup();
    const id = await idOf(ctx, 'page.html');
    const sent = await call(ctx, ROUTES.libraryPage(id));
    expect(sent.status).toBe(200);
    expect(sent.headers['content-security-policy']).toBe(PAGE_CSP);
    expect(sent.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(sent.headers['x-content-type-options']).toBe('nosniff');
    expect(
      sent.body.equals(readFileSync(join(root, 'clients/acme-heating/landing-pages/boiler/page.html'))),
    ).toBe(true);
    const personal = await call(ctx, ROUTES.libraryPage(await idOf(ctx, 'explainer.html', 'personal')));
    expect(personal.status).toBe(200);
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
      "TDS Brain can't pass on .exe files. Attach a document, spreadsheet, slide deck, text file or picture.",
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

describe('GET /api/changelog (owners and scouts only)', () => {
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

  it('gives owners and scouts every version', async () => {
    for (const role of ['owner', 'scout']) {
      const r = await get(role);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ versions: VERSIONS });
    }
  });

  it('refuses the team and anyone not recognised', async () => {
    for (const role of ['team', 'unknown']) {
      const r = await get(role);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('not-allowed');
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
