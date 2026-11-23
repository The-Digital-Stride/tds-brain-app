// The Projects routes (plan 2026-11-20-projects-system, decisions 10, 7 and 13), sent over real HTTP to the real
// server, so every request passes the real security gate (checkRequest) first. Route tests that skip the gate once
// let a 415-on-every-delete bug through. The projects service is a fake: its own tests are Builder A's.
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type Identity,
  ROUTES,
  sessionCookieName,
  type TodoAction,
  type TodoList,
} from '../../shared/contract.ts';
import type { ProjectActivityResponse } from '../../shared/project-activity-contract.ts';
import type { ProjectUpdatesResponse } from '../../shared/project-updates-contract.ts';
import {
  type ProjectAction,
  type ProjectList,
  type ProjectMoveRequest,
  type ProjectRemoveRequest,
  ProjectsError,
  type ProjectsErrorCode,
  type ProjectTodosResponse,
  type TidyApply,
  type TidyList,
} from '../../shared/projects-contract.ts';
import { SessionError } from '../engine/session-manager.ts';
import { cookieValueFor, createAuthCodes } from './security.ts';
import { type AppServer, createAppServer } from './server.ts';

const PORT = 45911;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = 'launch-token-projects';
const COOKIE = `${sessionCookieName(PORT)}=${cookieValueFor(TOKEN)}`;
const KEY = 'acme-heating/web';
const VERSION = 'a'.repeat(64);

const sam: Identity = {
  name: 'Sam Example',
  slug: 'sam-example',
  email: null,
  role: 'scout',
  knownMember: true,
};
const LIST = { projects: [], looseLabels: [], skippedFolders: 0 } as unknown as ProjectList;
const TIDY = { rows: [], skipped: [] } satisfies TidyList;
const TODOS = {
  mine: [],
  open: [],
  othersCount: 0,
  team: [],
  changes: 'on',
  canAddOpen: true,
  canUsePersonal: true,
  canAttach: false,
  canUpload: false,
  canProject: true,
} satisfies TodoList;

// What the fake brain saw and how it answers.
const seen = {
  projects: 0,
  changes: [] as ProjectAction[],
  files: [] as [string, string][],
  tidy: 0,
  applies: [] as { apply: TidyApply; by: string }[],
  todoChanges: [] as TodoAction[],
  projectTodos: [] as [string, string][],
  updates: [] as [string, string | null, string][],
  activity: [] as [string, string][],
  marked: [] as [string, string, string][],
  access: [] as string[],
  moves: [] as { req: ProjectMoveRequest; by: string; todos: boolean | undefined }[],
  removes: [] as { req: ProjectRemoveRequest; by: string; todos: boolean | undefined }[],
};
type Access = 'allowed' | 'restricted' | 'unknown-skill';
let state: { has: boolean; directWrites: boolean; fail: unknown; access: Access; todos: TodoList } = {
  has: true,
  directWrites: true,
  fail: null,
  access: 'allowed',
  todos: TODOS,
};
const PROJECT_TODOS = {
  todos: [
    {
      key: 'a.md',
      id: 'a.md',
      scope: 'tds',
      title: 'Send it',
      assignee: 'ben-mcadam',
      due: null,
      stage: null,
      mine: false,
    },
  ],
  count: 1,
} satisfies ProjectTodosResponse;

const ACTIVITY = {
  since: '2026-11-20T09:00:00.000Z',
  token: 'abc123',
  items: [],
  more: 0,
  comingUp: [],
} satisfies ProjectActivityResponse;

const UPDATES = { updates: [], more: false, unreadable: 0, canAdd: true } satisfies ProjectUpdatesResponse;

const MOVE_CHECK = {
  check: {
    key: 'skyseal/web',
    files: [],
    fileCount: 0,
    ignoredCount: 0,
    personalLinks: [],
    filesVersion: 'e'.repeat(64),
  },
  todos: 2,
};

const maybeFail = () => {
  if (state.fail) throw state.fail;
};

let app: AppServer;
let listenPort: number;

beforeAll(async () => {
  const brain = {
    watch: () => () => {},
    identity: async () => sam,
    todos: async () => state.todos,
    skillAccess: async (_who: Identity, name: string) => {
      seen.access.push(name);
      return state.access;
    },
    changeTodo: async (action: TodoAction) => {
      seen.todoChanges.push(action);
      return {};
    },
    get projects() {
      return state.has
        ? async () => {
            seen.projects++;
            maybeFail();
            return LIST;
          }
        : undefined;
    },
    get changeProject() {
      return state.has
        ? async (action: ProjectAction) => {
            maybeFail();
            seen.changes.push(action);
            return LIST;
          }
        : undefined;
    },
    get moveProject() {
      return state.has
        ? async (req: ProjectMoveRequest, by: Identity, opts?: { todos?: boolean }) => {
            maybeFail();
            seen.moves.push({ req, by: by.slug, todos: opts?.todos });
            return req.check ? MOVE_CHECK : { list: LIST, key: 'skyseal/web', todosMoved: 1, todosLeft: 0 };
          }
        : undefined;
    },
    get removeProject() {
      return state.has
        ? async (req: ProjectRemoveRequest, by: Identity, opts?: { todos?: boolean }) => {
            maybeFail();
            seen.removes.push({ req, by: by.slug, todos: opts?.todos });
            return req.check
              ? { check: { key: req.key, allowed: false, allowedWho: 'The owner.' }, todos: [], doneTodos: 0 }
              : { list: LIST, key: req.key, todosChanged: 1, todosFailed: [] };
          }
        : undefined;
    },
    get projectFiles() {
      return state.has
        ? async (key: string, kind: string) => {
            maybeFail();
            seen.files.push([key, kind]);
            return { items: [], hidden: 0 };
          }
        : undefined;
    },
    get projectTodos() {
      return state.has
        ? async (key: string, by: Identity) => {
            maybeFail();
            seen.projectTodos.push([key, by.slug]);
            return PROJECT_TODOS;
          }
        : undefined;
    },
    get projectUpdates() {
      return state.has
        ? async (key: string, before: string | null, by: Identity) => {
            maybeFail();
            seen.updates.push([key, before, by.slug]);
            return UPDATES;
          }
        : undefined;
    },
    get projectActivity() {
      return state.has
        ? async (key: string, by: Identity) => {
            maybeFail();
            seen.activity.push([key, by.slug]);
            return ACTIVITY;
          }
        : undefined;
    },
    get projectSeen() {
      return state.has
        ? async (key: string, token: string, by: Identity) => {
            maybeFail();
            seen.marked.push([key, token, by.slug]);
          }
        : undefined;
    },
    get tidy() {
      return state.has
        ? async () => {
            seen.tidy++;
            maybeFail();
            return TIDY;
          }
        : undefined;
    },
    get applyTidy() {
      return state.has
        ? async (apply: TidyApply, by: Identity) => {
            maybeFail();
            seen.applies.push({ apply, by: by.slug });
            return TIDY;
          }
        : undefined;
    },
  };
  app = createAppServer({
    port: PORT,
    clientDir: '/nonexistent',
    launchToken: TOKEN,
    authCodes: createAuthCodes(TOKEN),
    appVersion: '0',
    underService: false,
    brain: brain as never,
    store: { get: async () => ({ directWrites: state.directWrites }) } as never,
    sessions: {
      onChange: () => () => {},
      subscribe: () => {
        throw new SessionError('not-found', 'no such chat');
      },
    } as never,
    thumbs: {} as never,
    uploads: {} as never,
    engineHealth: () => ({}) as never,
    appState: { kind: 'ready' },
    setup: {} as never,
  });
  await new Promise<void>((done) => app.server.listen(0, '127.0.0.1', done));
  listenPort = (app.server.address() as AddressInfo).port;
});
afterAll(async () => {
  app.stop();
  await new Promise((done) => app.server.close(done));
});
beforeEach(() => {
  state = { has: true, directWrites: true, fail: null, access: 'allowed', todos: TODOS };
  seen.projects = 0;
  seen.changes.length = 0;
  seen.files.length = 0;
  seen.tidy = 0;
  seen.applies.length = 0;
  seen.todoChanges.length = 0;
  seen.projectTodos.length = 0;
  seen.updates.length = 0;
  seen.activity.length = 0;
  seen.marked.length = 0;
  seen.access.length = 0;
  seen.moves.length = 0;
  seen.removes.length = 0;
});

interface Reply {
  status: number;
  json: Record<string, unknown> & { error?: { code: string; message: string } };
}
function send(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  return new Promise<Reply>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: listenPort,
        path,
        method: opts.method ?? 'GET',
        headers: { host: HOST, ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let json: Reply['json'] = {};
          try {
            json = JSON.parse(Buffer.concat(chunks).toString());
          } catch {}
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    req.end(opts.body === undefined ? undefined : JSON.stringify(opts.body));
  });
}
const get = (path: string) => send(path, { headers: { cookie: COOKIE } });
const post = (path: string, body: unknown) =>
  send(path, {
    method: 'POST',
    headers: { cookie: COOKIE, origin: `http://${HOST}`, 'content-type': 'application/json' },
    body,
  });

const filesPath = (key: string, kind: string) =>
  `${ROUTES.projectFiles}?key=${encodeURIComponent(key)}&kind=${kind}`;
const TIDY_APPROVE: TidyApply = {
  label: 'harvey-nash',
  do: 'approve',
  suggestion: { do: 'client-only', client: 'harvey-nash', why: 'is-a-client' },
};

const CHANGES: ProjectAction[] = [
  { kind: 'create', space: 'client', client: 'acme-heating', slug: 'web', fields: { title: 'Website' } },
  {
    kind: 'create',
    space: 'personal',
    slug: 'plan',
    fields: { title: 'Plan', status: 'active', kind: 'one-off', stages: ['A', 'B'], budgetHours: null },
  },
  { kind: 'card', key: KEY, fields: { title: 'Website' } },
  {
    kind: 'edit',
    key: KEY,
    fields: { health: 'amber', team: ['sam-example'], brief: 'Hello' },
    expect: VERSION,
  },
  { kind: 'link', key: KEY, path: 'clients/acme-heating/reports/r.md', expect: VERSION },
  { kind: 'unlink', key: KEY, path: 'clients/acme-heating/reports/r.md', expect: VERSION },
  { kind: 'update', key: KEY, entry: { kind: 'note', summary: 'Called Sam.', clientSafe: false } },
  { kind: 'update', key: KEY, entry: { kind: 'call', summary: 'Agreed the scope.', clientSafe: true } },
  {
    kind: 'update-remove',
    key: KEY,
    file: 'clients/acme-heating/projects/web/updates/2026-11-21-1004-sam-example-abc123.md',
    expect: VERSION,
  },
];

describe('the security gate', () => {
  it('every read needs the session, and refuses another site', async () => {
    for (const path of [
      ROUTES.projects,
      filesPath(KEY, 'image'),
      `${ROUTES.projectTodos}?key=${KEY}`,
      `${ROUTES.projectUpdates}?key=${KEY}`,
      `${ROUTES.projectActivity}?key=${KEY}`,
      ROUTES.projectsTidy,
    ]) {
      expect((await send(path)).status, path).toBe(401);
      const cross = await send(path, { headers: { cookie: COOKIE, 'sec-fetch-site': 'cross-site' } });
      expect(cross.status, path).toBe(403);
      expect((await get(path)).status, path).toBe(200);
    }
  });

  it('every change needs the session, the app origin and JSON', async () => {
    for (const [path, body] of [
      [ROUTES.projectsChange, CHANGES[0]],
      [ROUTES.projectsTidy, TIDY_APPROVE],
    ] as const) {
      const noCookie = await send(path, {
        method: 'POST',
        headers: { origin: `http://${HOST}`, 'content-type': 'application/json' },
        body,
      });
      expect(noCookie.status, path).toBe(401);
      const evil = await send(path, {
        method: 'POST',
        headers: { cookie: COOKIE, origin: 'https://evil.example', 'content-type': 'application/json' },
        body,
      });
      expect(evil.status, path).toBe(403);
      const form = await send(path, {
        method: 'POST',
        headers: { cookie: COOKIE, origin: `http://${HOST}`, 'content-type': 'text/plain' },
        body,
      });
      expect(form.status, path).toBe(415);
      expect((await post(path, body)).status, path).toBe(200);
    }
    expect(seen.changes).toHaveLength(1);
    expect(seen.applies).toHaveLength(1);
  });

  it('reads are GET and changes are POST only, and the to-do route is just as strict', async () => {
    expect((await post(ROUTES.projects, {})).status).toBe(405);
    expect((await post(filesPath(KEY, 'image'), {})).status).toBe(405);
    expect((await get(ROUTES.projectsChange)).status).toBe(405);
    expect((await send(ROUTES.projectsTidy, { method: 'PUT', headers: { cookie: COOKIE } })).status).not.toBe(
      200,
    );
    const todo = await send(ROUTES.changeTodo, {
      method: 'POST',
      headers: { cookie: COOKIE, origin: `http://${HOST}`, 'content-type': 'text/plain' },
      body: {},
    });
    expect(todo.status).toBe(415);
  });
});

describe('GET /api/projects/activity and POST /api/projects/seen', () => {
  const path = (q: string) => `${ROUTES.projectActivity}?${q}`;

  it('answers the brain reading with who asked', async () => {
    const r = await get(path(`key=${KEY}`));
    expect(r.status).toBe(200);
    expect(r.json).toEqual(ACTIVITY);
    expect(seen.activity).toEqual([[KEY, 'sam-example']]);
  });

  it('refuses a bad key, a POST, and a missing service', async () => {
    for (const q of ['', 'key=Bad%20Key']) expect((await get(path(q))).status, q).toBe(400);
    expect((await post(ROUTES.projectActivity, {})).status).toBe(405);
    expect(seen.activity).toEqual([]);
    state.has = false;
    expect((await get(path(`key=${KEY}`))).status).toBe(404);
  });

  it('seen needs the session, the app origin and JSON, like every change', async () => {
    const body = { key: KEY, token: 'abc123' };
    const noCookie = await send(ROUTES.projectSeen, {
      method: 'POST',
      headers: { origin: `http://${HOST}`, 'content-type': 'application/json' },
      body,
    });
    expect(noCookie.status).toBe(401);
    const evil = await send(ROUTES.projectSeen, {
      method: 'POST',
      headers: { cookie: COOKIE, origin: 'https://evil.example', 'content-type': 'application/json' },
      body,
    });
    expect(evil.status).toBe(403);
    const form = await send(ROUTES.projectSeen, {
      method: 'POST',
      headers: { cookie: COOKIE, origin: `http://${HOST}`, 'content-type': 'text/plain' },
      body,
    });
    expect(form.status).toBe(415);
    expect(seen.marked).toEqual([]);
  });

  it('seen answers 204 and passes key, token and who', async () => {
    const r = await post(ROUTES.projectSeen, { key: KEY, token: 'abc123' });
    expect(r.status).toBe(204);
    expect(seen.marked).toEqual([[KEY, 'abc123', 'sam-example']]);
  });

  it('seen refuses extra fields, a bad key, a missing or long token, a GET and a missing service', async () => {
    for (const body of [
      { key: KEY, token: 'abc123', extra: 1 },
      { key: 'Bad Key', token: 'abc123' },
      { key: KEY },
      { key: KEY, token: '' },
      { key: KEY, token: 5 },
      { key: KEY, token: 'x'.repeat(201) },
      [],
      null,
    ]) {
      const r = await post(ROUTES.projectSeen, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(seen.marked).toEqual([]);
    expect((await get(ROUTES.projectSeen)).status).toBe(405);
    state.has = false;
    expect((await post(ROUTES.projectSeen, { key: KEY, token: 'abc123' })).status).toBe(404);
  });

  it('an unknown project or token is still 204 (the brain decides nothing is saved)', async () => {
    expect((await post(ROUTES.projectSeen, { key: 'nobody/nothing', token: 'old' })).status).toBe(204);
  });

  it('answers a ProjectsError with its status', async () => {
    state.fail = new ProjectsError('not-found', 'That project is gone.');
    expect((await get(path(`key=${KEY}`))).status).toBe(404);
  });
});

describe('GET /api/projects/updates', () => {
  const path = (q: string) => `${ROUTES.projectUpdates}?${q}`;

  it('answers the brain reading, passing key, before and who asked', async () => {
    const first = await get(path(`key=${KEY}`));
    expect(first.status).toBe(200);
    expect(first.json).toEqual(UPDATES);
    const before = 'clients/acme-heating/projects/web/updates/2026-11-21-1004-sam-example-abc123.md';
    await get(path(`key=${KEY}&before=${encodeURIComponent(before)}`));
    expect(seen.updates).toEqual([
      [KEY, null, 'sam-example'],
      [KEY, before, 'sam-example'],
    ]);
  });

  it('refuses a bad key, an empty or long before, a POST, and a missing service', async () => {
    for (const q of ['', 'key=Bad%20Key', `key=${KEY}&before=`, `key=${KEY}&before=${'x'.repeat(1025)}`]) {
      const r = await get(path(q));
      expect(r.status, q).toBe(400);
      expect(r.json.error?.code).toBe('bad-request');
    }
    expect((await post(ROUTES.projectUpdates, {})).status).toBe(405);
    expect(seen.updates).toEqual([]);
    state.has = false;
    expect((await get(path(`key=${KEY}`))).status).toBe(404);
  });

  it('answers a ProjectsError with its status', async () => {
    state.fail = new ProjectsError('bad-request', 'That update list is not available.');
    const r = await get(path(`key=${KEY}&before=nope`));
    expect(r.status).toBe(400);
  });
});

describe('POST /api/projects/change', () => {
  it('passes each valid action on exactly as sent', async () => {
    for (const action of CHANGES) expect((await post(ROUTES.projectsChange, action)).status).toBe(200);
    expect(seen.changes).toEqual(CHANGES);
  });

  it('does not depend on the to-do switch in Settings', async () => {
    state.directWrites = false;
    expect((await post(ROUTES.projectsChange, CHANGES[0])).status).toBe(200);
    expect((await get(ROUTES.projects)).status).toBe(200);
  });

  it('refuses malformed bodies before the brain is asked', async () => {
    const bad: unknown[] = [
      null,
      [],
      'edit',
      {},
      { kind: 'explode' },
      { kind: 'capabilities' },
      { ...CHANGES[0], extra: 1 },
      { kind: 'create', space: 'client', client: 'acme-heating', slug: 'web' },
      { kind: 'create', space: 'client', client: 'acme-heating', slug: 'web', fields: {} },
      { kind: 'create', space: 'client', client: 'acme-heating', slug: 'web', fields: { title: '  ' } },
      { kind: 'create', space: 'shared', slug: 'web', fields: { title: 'T' } },
      { kind: 'create', space: 'client', client: 'Acme', slug: 'web', fields: { title: 'T' } },
      { kind: 'create', space: 'client', client: 'acme-heating', slug: 'Bad Slug', fields: { title: 'T' } },
      {
        kind: 'create',
        space: 'client',
        client: 'acme-heating',
        slug: 'a'.repeat(61),
        fields: { title: 'T' },
      },
      { kind: 'card', key: 'personal/../x', fields: {} },
      { kind: 'card', key: 'Acme/web', fields: {} },
      { kind: 'card', key: `${'a'.repeat(61)}/web`, fields: {} },
      { kind: 'card', key: KEY },
      { kind: 'card', key: KEY, fields: { colour: 'red' } },
      { kind: 'edit', key: KEY, fields: {} },
      { kind: 'edit', key: KEY, fields: {}, expect: 'short' },
      { kind: 'edit', key: KEY, fields: { status: 'finished' }, expect: VERSION },
      { kind: 'edit', key: KEY, fields: { status: null }, expect: VERSION },
      { kind: 'edit', key: KEY, fields: { health: 'blue' }, expect: VERSION },
      { kind: 'edit', key: KEY, fields: { title: 5 }, expect: VERSION },
      { kind: 'edit', key: KEY, fields: { title: 'x'.repeat(121) }, expect: VERSION },
      { kind: 'edit', key: KEY, fields: { brief: 'x'.repeat(20_001) }, expect: VERSION },
      { kind: 'edit', key: KEY, fields: { team: 'sam' }, expect: VERSION },
      { kind: 'edit', key: KEY, fields: { team: Array(21).fill('a') }, expect: VERSION },
      { kind: 'edit', key: KEY, fields: { stages: Array(13).fill('a') }, expect: VERSION },
      { kind: 'edit', key: KEY, fields: { stages: ['x'.repeat(41)] }, expect: VERSION },
      { kind: 'edit', key: KEY, fields: { budgetHours: '40' }, expect: VERSION },
      { kind: 'edit', key: KEY, fields: { billable: 'yes' }, expect: VERSION },
      { kind: 'edit', key: KEY, fields: {}, expect: VERSION, extra: true },
      { kind: 'link', key: KEY, path: '', expect: VERSION },
      { kind: 'link', key: KEY, path: 'x'.repeat(1025), expect: VERSION },
      { kind: 'link', key: KEY, expect: VERSION },
      { kind: 'unlink', key: KEY, path: 'a.md' },
      { kind: 'update', key: KEY },
      { kind: 'update', key: KEY, entry: { kind: 'status', summary: 'x', clientSafe: false } },
      { kind: 'update', key: KEY, entry: { kind: 'note', summary: 'x' } },
      { kind: 'update', key: KEY, entry: { kind: 'note', summary: 5, clientSafe: false } },
      { kind: 'update', key: KEY, entry: { kind: 'note', summary: '  ', clientSafe: false } },
      { kind: 'update', key: KEY, entry: { kind: 'note', summary: 'x'.repeat(5001), clientSafe: false } },
      { kind: 'update', key: KEY, entry: { kind: 'note', summary: 'x', clientSafe: 'no' } },
      { kind: 'update', key: KEY, entry: { kind: 'note', summary: 'x', clientSafe: false, by: 'me' } },
      { kind: 'update', key: KEY, entry: { kind: 'note', summary: 'x', clientSafe: false }, at: 'now' },
      { kind: 'update', key: 'Bad Key', entry: { kind: 'note', summary: 'x', clientSafe: false } },
      { kind: 'update-remove', key: KEY, file: 'a/updates/b.md' },
      { kind: 'update-remove', key: KEY, file: '', expect: VERSION },
      { kind: 'update-remove', key: KEY, file: 'a/updates/b.md', expect: 'short' },
      { kind: 'update-remove', key: KEY, file: 'a/updates/b.md', expect: VERSION, extra: 1 },
      { kind: 'update-remove', key: KEY, file: 'x'.repeat(1025), expect: VERSION },
    ];
    for (const body of bad) {
      const r = await post(ROUTES.projectsChange, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json.error?.code).toBe('bad-request');
    }
    expect(seen.changes).toEqual([]);
  });

  it('answers a ProjectsError with its status and plain message', async () => {
    const cases: [ProjectsErrorCode, number, string][] = [
      ['bad-request', 400, 'bad-request'],
      ['not-found', 404, 'not-found'],
      ['exists', 409, 'changed'],
      ['changed', 409, 'changed'],
      ['not-allowed', 403, 'not-allowed'],
      ['internal', 500, 'internal'],
    ];
    for (const [code, status, apiCode] of cases) {
      state.fail = new ProjectsError(code, `Plain words for ${code}.`);
      const r = await post(ROUTES.projectsChange, CHANGES[0]);
      expect(r.status, code).toBe(status);
      expect(r.json.error).toEqual({ code: apiCode, message: `Plain words for ${code}.` });
    }
    // Anything else is a 500 that leaks nothing.
    state.fail = new Error('/Users/someone/brain: ENOENT');
    const odd = await post(ROUTES.projectsChange, CHANGES[0]);
    expect(odd.status).toBe(500);
    expect(JSON.stringify(odd.json)).not.toContain('ENOENT');
  });
});

describe('GET /api/projects and /api/projects/files', () => {
  it('answers the list, and maps its errors', async () => {
    expect((await get(ROUTES.projects)).json).toEqual(LIST);
    state.fail = new ProjectsError('internal', 'The projects could not be read.');
    const r = await get(ROUTES.projects);
    expect(r.status).toBe(500);
    expect(r.json.error?.message).toBe('The projects could not be read.');
  });

  it('passes a valid key and kind on, and refuses anything else', async () => {
    expect((await get(filesPath(KEY, 'image'))).status).toBe(200);
    expect((await get(filesPath('personal/plan', 'document'))).status).toBe(200);
    expect(seen.files).toEqual([
      [KEY, 'image'],
      ['personal/plan', 'document'],
    ]);
    seen.files.length = 0;
    for (const path of [
      filesPath('personal/../x', 'image'),
      filesPath('Acme/web', 'image'),
      filesPath('acme', 'image'),
      filesPath(`${'a'.repeat(61)}/web`, 'image'),
      filesPath(`${KEY}/more`, 'image'),
      filesPath(KEY, 'video'),
      filesPath(KEY, ''),
      `${ROUTES.projectFiles}?kind=image`,
      `${ROUTES.projectFiles}?key=${KEY}`,
      ROUTES.projectFiles,
    ]) {
      expect((await get(path)).status, path).toBe(400);
    }
    expect(seen.files).toEqual([]);
  });

  it('answers 404 for a project the brain does not know', async () => {
    state.fail = new ProjectsError('not-found', "That project couldn't be found.");
    const r = await get(filesPath(KEY, 'image'));
    expect(r.status).toBe(404);
    expect(r.json.error?.code).toBe('not-found');
  });
});

describe('/api/projects/tidy (decision 13)', () => {
  it('reads without the to-do switch, and changes only with it', async () => {
    state.directWrites = false;
    expect((await get(ROUTES.projectsTidy)).json).toEqual(TIDY);
    const off = await post(ROUTES.projectsTidy, TIDY_APPROVE);
    expect(off.status).toBe(403);
    expect(off.json.error?.code).toBe('not-allowed');
    expect(seen.applies).toEqual([]);
  });

  it("applies an approval for the signed-in person, whoever's to-dos the row holds", async () => {
    // The service changes the teammate's to-dos through the script; the route's job is the gate, the
    // switch and the shape. Who is acting comes from this Mac, never from the body.
    const suggestions: TidyApply[] = [
      TIDY_APPROVE,
      { label: 'a', do: 'approve', suggestion: { do: 'link', key: KEY, why: 'same-slug' } },
      {
        label: 'bookvault',
        do: 'approve',
        suggestion: { do: 'merge', into: 'book-vault', why: 'near-spelling' },
      },
      { label: 'optional-project-slug', do: 'approve', suggestion: { do: 'clear', why: 'placeholder' } },
      {
        label: 'new',
        do: 'approve',
        suggestion: { do: 'new-project', client: null, slug: 'new-thing', why: 'no-match' },
      },
      { label: 'x', do: 'approve', suggestion: { do: 'skip', why: 'no-match' } },
      { label: 'x', do: 'skip' },
      { label: 'x', do: 'unskip' },
    ];
    for (const apply of suggestions)
      expect((await post(ROUTES.projectsTidy, apply)).json, JSON.stringify(apply)).toEqual(TIDY);
    expect(seen.applies.map((a) => a.apply)).toEqual(suggestions);
    expect(new Set(seen.applies.map((a) => a.by))).toEqual(new Set(['sam-example']));
  });

  it('refuses malformed bodies', async () => {
    const bad: unknown[] = [
      null,
      {},
      { label: 'x' },
      { label: '', do: 'skip' },
      { label: 'x'.repeat(201), do: 'skip' },
      { label: 'x', do: 'delete' },
      { label: 'x', do: 'skip', suggestion: { do: 'clear', why: 'placeholder' } },
      { label: 'x', do: 'approve' },
      { label: 'x', do: 'approve', suggestion: { do: 'erase', why: 'x' } },
      { label: 'x', do: 'approve', suggestion: { do: 'link', key: 'Bad Key', why: 'same-slug' } },
      { label: 'x', do: 'approve', suggestion: { do: 'link', key: KEY, why: 'because' } },
      {
        label: 'x',
        do: 'approve',
        suggestion: { do: 'client-only', client: 'Not A Slug', why: 'is-a-client' },
      },
      { label: 'x', do: 'approve', suggestion: { do: 'merge', into: '', why: 'near-spelling' } },
      { label: 'x', do: 'approve', suggestion: { do: 'clear', why: 'placeholder', extra: 1 } },
      { label: 'x', do: 'approve', suggestion: { do: 'new-project', client: 5, slug: 'a', why: 'no-match' } },
      {
        label: 'x',
        do: 'approve',
        suggestion: { do: 'new-project', client: null, slug: 'A b', why: 'no-match' },
      },
      { label: 'x', do: 'approve', suggestion: TIDY_APPROVE.suggestion, extra: 1 },
    ];
    for (const body of bad) {
      expect((await post(ROUTES.projectsTidy, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(seen.applies).toEqual([]);
  });

  it('maps the service errors', async () => {
    state.fail = new ProjectsError('not-allowed', 'You can only tidy your own personal to-dos.');
    const r = await post(ROUTES.projectsTidy, TIDY_APPROVE);
    expect(r.status).toBe(403);
    expect(r.json.error?.message).toBe('You can only tidy your own personal to-dos.');
    expect((await get(ROUTES.projectsTidy)).status).toBe(403);
  });
});

// Review fixes (release 1): who may change projects and approve tidy-ups, and a project's to-dos.
describe('permissions (review fix 4)', () => {
  it("refuses a project change unless the tdsapp-projects skill's roles allow this person", async () => {
    for (const access of ['restricted', 'unknown-skill'] as const) {
      state.access = access;
      const r = await post(ROUTES.projectsChange, CHANGES[0]);
      expect(r.status, access).toBe(403);
      expect(r.json.error).toEqual({
        code: 'not-allowed',
        message: "Changing projects isn't available to you in the app yet.",
      });
    }
    expect(seen.access).toEqual(['tdsapp-projects', 'tdsapp-projects']);
    expect(seen.changes).toEqual([]);
    state.access = 'allowed';
    expect((await post(ROUTES.projectsChange, CHANGES[0])).status).toBe(200);
  });

  it('refuses a tidy approval unless changing to-dos is on and can set projects', async () => {
    for (const todos of [
      { ...TODOS, changes: 'restricted' },
      { ...TODOS, changes: 'no-skill' },
      { ...TODOS, canProject: false },
    ] satisfies TodoList[]) {
      state.todos = todos;
      const r = await post(ROUTES.projectsTidy, TIDY_APPROVE);
      expect(r.status, JSON.stringify(todos)).toBe(403);
      expect(r.json.error).toEqual({
        code: 'not-allowed',
        message: "Changing to-dos isn't available to you in the app yet.",
      });
    }
    expect(seen.applies).toEqual([]);
  });

  it('skips and unskips with the to-do switch off and no to-do access: they only write the app’s data folder', async () => {
    state.directWrites = false;
    state.todos = { ...TODOS, changes: 'restricted', canProject: false };
    state.access = 'restricted';
    for (const apply of [
      { label: 'x', do: 'skip' },
      { label: 'x', do: 'unskip' },
    ] satisfies TidyApply[]) {
      expect((await post(ROUTES.projectsTidy, apply)).status, apply.do).toBe(200);
    }
    expect(seen.applies.map((a) => a.apply.do)).toEqual(['skip', 'unskip']);
    expect((await post(ROUTES.projectsTidy, TIDY_APPROVE)).status).toBe(403);
  });
});

describe('GET /api/projects/todos (UX B2)', () => {
  it("answers the project's to-dos for the signed-in person", async () => {
    const r = await get(`${ROUTES.projectTodos}?key=${encodeURIComponent('personal/plan')}`);
    expect(r).toEqual({ status: 200, json: PROJECT_TODOS });
    expect(seen.projectTodos).toEqual([['personal/plan', 'sam-example']]);
  });

  it('refuses a missing or malformed key before the brain is asked, and is GET only', async () => {
    for (const path of [
      ROUTES.projectTodos,
      `${ROUTES.projectTodos}?key=`,
      `${ROUTES.projectTodos}?key=acme`,
      `${ROUTES.projectTodos}?key=Acme/web`,
      `${ROUTES.projectTodos}?key=personal/../x`,
      `${ROUTES.projectTodos}?key=${'a'.repeat(61)}/web`,
    ]) {
      expect((await get(path)).status, path).toBe(400);
    }
    expect((await post(`${ROUTES.projectTodos}?key=${KEY}`, {})).status).toBe(405);
    expect(seen.projectTodos).toEqual([]);
  });

  it('maps a project the brain does not know to 404', async () => {
    state.fail = new ProjectsError('not-found', "That project couldn't be found. It may have been moved.");
    const r = await get(`${ROUTES.projectTodos}?key=${KEY}`);
    expect(r.status).toBe(404);
    expect(r.json.error?.code).toBe('not-found');
  });
});

describe('the to-do project action (decisions 5 and 6)', () => {
  const project = (over: Record<string, unknown> = {}) => ({
    kind: 'project',
    id: '20261105-send-report.md',
    client: 'acme-heating',
    project: KEY,
    stage: 'Build',
    expect: VERSION,
    ...over,
  });

  it('passes a valid action on, and a clearing one with nulls', async () => {
    expect((await post(ROUTES.changeTodo, project())).status).toBe(200);
    expect(
      (
        await post(
          ROUTES.changeTodo,
          project({ client: null, project: null, stage: null, scope: 'personal' }),
        )
      ).status,
    ).toBe(200);
    expect(seen.todoChanges).toHaveLength(2);
    expect(seen.todoChanges[0]).toEqual(project());
  });

  it('is validated like the other actions: exact fields, right types', async () => {
    for (const body of [
      project({ extra: 1 }),
      project({ id: undefined }),
      project({ client: undefined }),
      project({ project: undefined }),
      project({ stage: undefined }),
      project({ client: 5 }),
      project({ stage: ['a'] }),
      project({ scope: 'shared' }),
      project({ expect: 5 }),
    ]) {
      expect((await post(ROUTES.changeTodo, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(seen.todoChanges).toEqual([]);
  });

  it('follows the to-do switch in Settings', async () => {
    state.directWrites = false;
    const r = await post(ROUTES.changeTodo, project());
    expect(r.status).toBe(403);
    expect(seen.todoChanges).toEqual([]);
  });

  it('accepts the new add and move fields, and only as the contract has them', async () => {
    const add = { kind: 'add', title: 'T', due: null, assignee: 'sam-example' };
    expect(
      (await post(ROUTES.changeTodo, { ...add, client: 'acme-heating', project: KEY, stage: 'Build' }))
        .status,
    ).toBe(200);
    expect((await post(ROUTES.changeTodo, { ...add, client: null, project: null, stage: null })).status).toBe(
      200,
    );
    expect((await post(ROUTES.changeTodo, { ...add, project: 5 })).status).toBe(400);
    const move = { kind: 'move', id: 'a.md', scope: 'tds', to: 'personal', expect: VERSION };
    expect((await post(ROUTES.changeTodo, { ...move, dropProject: true })).status).toBe(200);
    expect((await post(ROUTES.changeTodo, { ...move, dropProject: false })).status).toBe(400);
    expect((await post(ROUTES.changeTodo, { ...move, dropProject: 'yes' })).status).toBe(400);
    expect(seen.todoChanges).toHaveLength(3);
  });
});

describe('a brain without the projects readers (older fakes)', () => {
  it('answers 404 not-found on every route, after the gate and the checks', async () => {
    state.has = false;
    for (const r of [
      await get(ROUTES.projects),
      await post(ROUTES.projectsChange, CHANGES[0]),
      await get(filesPath(KEY, 'image')),
      await get(`${ROUTES.projectTodos}?key=${KEY}`),
      await get(ROUTES.projectsTidy),
      await post(ROUTES.projectsTidy, TIDY_APPROVE),
    ]) {
      expect(r.status).toBe(404);
      expect(r.json.error?.code).toBe('not-found');
    }
    expect((await send(ROUTES.projects)).status).toBe(401);
  });
});

// Move plan (docs/plans/2026-11-21-project-move.md).
describe('POST /api/projects/move', () => {
  const MOVE: ProjectMoveRequest = { key: KEY, client: 'skyseal', expect: VERSION };

  it('needs the session, the app origin and JSON, and is POST only', async () => {
    const path = ROUTES.projectsMove;
    const headers = { origin: `http://${HOST}`, 'content-type': 'application/json' };
    expect((await send(path, { method: 'POST', headers, body: MOVE })).status).toBe(401);
    const evil = await send(path, {
      method: 'POST',
      headers: { ...headers, cookie: COOKIE, origin: 'https://evil.example' },
      body: MOVE,
    });
    expect(evil.status).toBe(403);
    const form = await send(path, {
      method: 'POST',
      headers: { ...headers, cookie: COOKIE, 'content-type': 'text/plain' },
      body: MOVE,
    });
    expect(form.status).toBe(415);
    expect((await get(path)).status).toBe(405);
    expect(seen.moves).toEqual([]);
    expect((await post(path, MOVE)).status).toBe(200);
  });

  it('passes exactly the move shape on, for the signed-in person, and answers the brain', async () => {
    const shapes: ProjectMoveRequest[] = [
      MOVE,
      { ...MOVE, check: true },
      { ...MOVE, dropPersonal: true },
      { ...MOVE, filesExpect: VERSION },
      {
        key: 'personal/plan',
        client: 'the-digital-stride',
        expect: VERSION,
        dropPersonal: true,
        check: true,
      },
    ];
    const answers = [];
    for (const body of shapes) {
      const r = await post(ROUTES.projectsMove, body);
      expect(r.status, JSON.stringify(body)).toBe(200);
      answers.push(r.json);
    }
    expect(seen.moves.map((m) => m.req)).toEqual(shapes);
    expect(seen.moves.every((m) => m.by === 'sam-example')).toBe(true);
    expect(answers[1]).toEqual(MOVE_CHECK);
    expect(answers[0]).toMatchObject({ key: 'skyseal/web', todosMoved: 1, todosLeft: 0 });
  });

  it('refuses any other shape before the brain is asked', async () => {
    const bad: unknown[] = [
      null,
      [],
      {},
      { key: KEY, client: 'skyseal' },
      { key: KEY, expect: VERSION },
      { client: 'skyseal', expect: VERSION },
      { ...MOVE, kind: 'move' },
      { ...MOVE, extra: 1 },
      { ...MOVE, client: 'personal' },
      { ...MOVE, client: 'Sky Seal' },
      { ...MOVE, client: '_archive' },
      { ...MOVE, client: 'a'.repeat(61) },
      { ...MOVE, client: 5 },
      { ...MOVE, key: 'Acme/web' },
      { ...MOVE, key: 'acme' },
      { ...MOVE, key: 'personal/../x' },
      { ...MOVE, expect: 'short' },
      { ...MOVE, expect: VERSION.toUpperCase() },
      { ...MOVE, dropPersonal: false },
      { ...MOVE, dropPersonal: 'yes' },
      { ...MOVE, check: false },
      { ...MOVE, check: 1 },
      { ...MOVE, filesExpect: 'short' },
      { ...MOVE, filesExpect: VERSION.toUpperCase() },
      { ...MOVE, filesExpect: 5 },
      { ...MOVE, filesExpect: null },
    ];
    for (const body of bad) {
      const r = await post(ROUTES.projectsMove, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json.error?.code).toBe('bad-request');
    }
    expect(seen.moves).toEqual([]);
  });

  it("refuses someone the tdsapp-projects skill's roles leave out", async () => {
    state.access = 'restricted';
    const r = await post(ROUTES.projectsMove, MOVE);
    expect(r.status).toBe(403);
    expect(r.json.error?.code).toBe('not-allowed');
    expect(seen.access).toEqual(['tdsapp-projects']);
    expect(seen.moves).toEqual([]);
  });

  it('lets the to-dos follow only where the app may change to-dos', async () => {
    expect((await post(ROUTES.projectsMove, MOVE)).status).toBe(200);
    state.directWrites = false;
    expect((await post(ROUTES.projectsMove, MOVE)).status).toBe(200);
    state.directWrites = true;
    state.todos = { ...TODOS, changes: 'restricted' };
    expect((await post(ROUTES.projectsMove, MOVE)).status).toBe(200);
    state.todos = { ...TODOS, canProject: false };
    expect((await post(ROUTES.projectsMove, MOVE)).status).toBe(200);
    expect(seen.moves.map((m) => m.todos)).toEqual([true, false, false, false]);
  });

  it('answers a ProjectsError with its status, and 404 without the brain', async () => {
    state.fail = new ProjectsError('exists', "There's already a project called web for that client.");
    const r = await post(ROUTES.projectsMove, MOVE);
    expect(r.status).toBe(409);
    expect(r.json.error).toEqual({
      code: 'changed',
      message: "There's already a project called web for that client.",
    });
    state.fail = null;
    state.has = false;
    expect((await post(ROUTES.projectsMove, MOVE)).status).toBe(404);
  });
});

// Archive plan (docs/plans/2026-11-21-project-archive-delete.md). Real HTTP, so the real request gate
// (checkRequest) runs first, as a 415 on every delete once slipped past tests that skipped it.
describe.each([
  [ROUTES.projectsArchive, 'archive', ['archive', 'unarchive']],
  [ROUTES.projectsDelete, 'delete', ['delete']],
] as const)('POST %s', (path, name, actions) => {
  const REQ: ProjectRemoveRequest = { key: KEY, action: actions[0] };
  const choice = (d: string) => ({ id: 'a.md', scope: 'tds', version: VERSION, do: d });

  it('goes through the real gate: needs the session, the app origin and JSON, and is POST only', async () => {
    const headers = { origin: `http://${HOST}`, 'content-type': 'application/json' };
    expect((await send(path, { method: 'POST', headers, body: REQ })).status).toBe(401);
    const evil = await send(path, {
      method: 'POST',
      headers: { ...headers, cookie: COOKIE, origin: 'https://evil.example' },
      body: REQ,
    });
    expect(evil.status).toBe(403);
    const form = await send(path, {
      method: 'POST',
      headers: { ...headers, cookie: COOKIE, 'content-type': 'text/plain' },
      body: REQ,
    });
    expect(form.status).toBe(415);
    expect((await get(path)).status).toBe(405);
    expect(seen.removes).toEqual([]);
    expect((await post(path, REQ)).status).toBe(200);
  });

  it('passes exactly the request shape on, for the signed-in person, and answers the brain', async () => {
    const shapes: ProjectRemoveRequest[] = [
      REQ,
      { ...REQ, check: true },
      { ...REQ, expect: VERSION, filesExpect: VERSION },
      ...actions.map((action) => ({ key: 'personal/plan', action, check: true as const })),
      {
        ...REQ,
        todos: [choice(name === 'archive' ? 'done' : 'delete'), { ...choice('keep'), id: 'b.md' }].filter(
          (c) => name === 'archive' || c.do !== 'keep',
        ) as never,
      },
    ];
    const answers = [];
    for (const body of shapes) {
      const r = await post(path, body);
      expect(r.status, JSON.stringify(body)).toBe(200);
      answers.push(r.json);
    }
    expect(seen.removes.map((m) => m.req)).toEqual(shapes);
    expect(seen.removes.every((m) => m.by === 'sam-example')).toBe(true);
    expect(answers[1]).toMatchObject({ check: { allowed: false, allowedWho: 'The owner.' }, doneTodos: 0 });
    expect(answers[0]).toMatchObject({ key: KEY, todosChanged: 1, todosFailed: [] });
  });

  it('refuses any other shape before the brain is asked', async () => {
    const other = name === 'archive' ? 'delete' : 'archive';
    const bad: unknown[] = [
      null,
      [],
      {},
      { key: KEY },
      { action: REQ.action },
      { ...REQ, extra: 1 },
      { ...REQ, action: other },
      { ...REQ, action: 'move' },
      { ...REQ, action: 5 },
      { ...REQ, key: 'Acme/web' },
      { ...REQ, key: 'personal/../x' },
      { ...REQ, expect: 'short' },
      { ...REQ, expect: VERSION.toUpperCase() },
      { ...REQ, filesExpect: 5 },
      { ...REQ, check: false },
      { ...REQ, check: 1 },
      { ...REQ, todos: 'all' },
      { ...REQ, check: true, todos: [] },
      { ...REQ, todos: [{ id: 'a.md', scope: 'tds', version: VERSION }] },
      { ...REQ, todos: [{ ...choice('done'), extra: 1 }] },
      { ...REQ, todos: [{ ...choice('done'), id: '../a.md' }] },
      { ...REQ, todos: [{ ...choice('done'), id: '' }] },
      { ...REQ, todos: [{ ...choice('done'), scope: 'team' }] },
      { ...REQ, todos: [{ ...choice('done'), version: 'short' }] },
      { ...REQ, todos: [choice('nope')] },
      // A choice that doesn't fit the action.
      { ...REQ, todos: [choice(name === 'archive' ? 'delete' : 'done')] },
      { ...REQ, todos: [choice(name === 'archive' ? 'unlink' : 'keep')] },
    ];
    for (const body of bad) {
      const r = await post(path, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json.error?.code).toBe('bad-request');
    }
    expect(seen.removes).toEqual([]);
  });

  it("refuses someone the tdsapp-projects skill's roles leave out", async () => {
    state.access = 'restricted';
    const r = await post(path, REQ);
    expect(r.status).toBe(403);
    expect(r.json.error?.code).toBe('not-allowed');
    expect(seen.access).toEqual(['tdsapp-projects']);
    expect(seen.removes).toEqual([]);
  });

  it('lets to-do choices run only where the app may change to-dos', async () => {
    expect((await post(path, REQ)).status).toBe(200);
    state.directWrites = false;
    expect((await post(path, REQ)).status).toBe(200);
    state.directWrites = true;
    state.todos = { ...TODOS, changes: 'restricted' };
    expect((await post(path, REQ)).status).toBe(200);
    expect(seen.removes.map((m) => m.todos)).toEqual([true, false, false]);
  });

  it('answers a ProjectsError with its status, and 404 without the brain', async () => {
    state.fail = new ProjectsError('not-allowed', 'Only the owner can delete this project.');
    const r = await post(path, REQ);
    expect(r.status).toBe(403);
    expect(r.json.error).toEqual({ code: 'not-allowed', message: 'Only the owner can delete this project.' });
    state.fail = new ProjectsError('changed', 'The files in this project changed since you checked.');
    expect((await post(path, REQ)).status).toBe(409);
    state.fail = null;
    state.has = false;
    expect((await post(path, REQ)).status).toBe(404);
  });
});

describe('archive routes keep their own actions apart', () => {
  it('unarchive is only on the archive route, delete only on the delete route', async () => {
    expect((await post(ROUTES.projectsArchive, { key: KEY, action: 'unarchive' })).status).toBe(200);
    expect((await post(ROUTES.projectsDelete, { key: KEY, action: 'unarchive' })).status).toBe(400);
    expect((await post(ROUTES.projectsArchive, { key: KEY, action: 'delete' })).status).toBe(400);
  });
});
