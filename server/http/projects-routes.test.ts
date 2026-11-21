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
import {
  type ProjectAction,
  type ProjectList,
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
  access: [] as string[],
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
  seen.access.length = 0;
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
];

describe('the security gate', () => {
  it('every read needs the session, and refuses another site', async () => {
    for (const path of [
      ROUTES.projects,
      filesPath(KEY, 'image'),
      `${ROUTES.projectTodos}?key=${KEY}`,
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
