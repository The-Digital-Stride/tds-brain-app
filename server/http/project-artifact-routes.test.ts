// POST /api/projects/artifact (plan 2026-11-23-claude-artifacts-in-projects, decision 8), sent over real HTTP to the
// real server so every request passes the real request gate (checkRequest) first. The brain is a fake.
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ARTIFACT_URL_CASES } from '../../shared/artifact-url-cases.ts';
import { type Identity, ROUTES, sessionCookieName } from '../../shared/contract.ts';
import { FilesChangeError } from '../../shared/files-contract.ts';
import type { ProjectCard, ProjectList } from '../../shared/projects-contract.ts';
import { createProjectArtifact } from '../brain/project-artifact.ts';
import { SessionError } from '../engine/session-manager.ts';
import { cookieValueFor, createAuthCodes } from './security.ts';
import { type AppServer, createAppServer } from './server.ts';

const PORT = 45913;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = 'launch-token-artifact';
const COOKIE = `${sessionCookieName(PORT)}=${cookieValueFor(TOKEN)}`;
const URL_OK = 'https://claude.ai/artifact/AbC123';

const sam: Identity = {
  name: 'Sam Example',
  slug: 'sam-example',
  email: null,
  role: 'scout',
  knownMember: true,
};

const card = (over: Partial<ProjectCard>): ProjectCard =>
  ({
    key: 'acme/web',
    space: 'client',
    slug: 'web',
    client: 'acme',
    folder: 'clients/acme/projects/web',
    card: 'ok',
    archived: false,
    ...over,
  }) as ProjectCard;

const CARDS = [
  card({}),
  card({
    key: 'personal/plan',
    space: 'personal',
    client: null,
    slug: 'plan',
    folder: 'personal/projects/plan',
  }),
  card({ key: 'acme/nocard', slug: 'nocard', folder: 'clients/acme/projects/nocard', card: 'none' }),
  card({ key: 'acme/old', slug: 'old', folder: 'clients/acme/projects/old', archived: true }),
  card({
    key: 'the-digital-stride/legacy',
    slug: 'legacy',
    client: 'the-digital-stride',
    folder: 'projects/legacy',
  }),
];

const seen = {
  added: [] as { path: string; url: string; title: string; description?: string; by: string }[],
};
let state: {
  has: boolean;
  canChange: boolean;
  canAdd: boolean;
  fail: unknown;
  hasService: boolean;
  reply: string | null;
  access: string;
} = {
  has: true,
  canChange: true,
  canAdd: true,
  fail: null,
  hasService: true,
  reply: null,
  access: 'allowed',
};

let app: AppServer;
let listenPort: number;

beforeAll(async () => {
  const files = {
    capabilities: async () => (state.canAdd ? ['files-artifact-v1'] : []),
    addArtifact: async (r: {
      url: string;
      path: string;
      title: string;
      description?: string;
      by?: { slug: string };
    }) => {
      if (state.fail) throw state.fail;
      seen.added.push({ ...r, by: r.by?.slug ?? '' });
      return { path: state.reply ?? r.path, kind: 'link' as const };
    },
  };
  // The real service; only the "skill folder and roles" check is stood in for (it reads a real brain).
  const service = createProjectArtifact('/nonexistent', { files, mayUseFiles: async () => true });
  const brain = {
    watch: () => () => {},
    identity: async () => sam,
    skillAccess: async () => state.access,
    get projects() {
      return state.has
        ? async () => ({ projects: CARDS, canChange: state.canChange }) as unknown as ProjectList
        : undefined;
    },
    get projectArtifact() {
      return state.hasService ? service : undefined;
    },
    // The change, move and archive answers carry the list the page then shows (review: correctness 2).
    changeProject: async () => ({ projects: CARDS, canChange: state.canChange }) as unknown as ProjectList,
    moveProject: async () => ({
      key: 'skyseal/web',
      list: { projects: CARDS, canChange: state.canChange } as unknown as ProjectList,
    }),
    removeProject: async () => ({
      list: { projects: CARDS, canChange: state.canChange } as unknown as ProjectList,
    }),
  };
  app = createAppServer({
    port: PORT,
    clientDir: '/nonexistent',
    launchToken: TOKEN,
    authCodes: createAuthCodes(TOKEN),
    appVersion: '0',
    underService: false,
    brain: brain as never,
    store: { get: async () => ({}) } as never,
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
  state = {
    has: true,
    canChange: true,
    canAdd: true,
    fail: null,
    hasService: true,
    reply: null,
    access: 'allowed',
  };
  seen.added.length = 0;
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
const headers = { origin: `http://${HOST}`, 'content-type': 'application/json' };
const post = (body: unknown) =>
  send(ROUTES.projectArtifact, { method: 'POST', headers: { cookie: COOKIE, ...headers }, body });

const GOOD = { key: 'acme/web', url: URL_OK, title: 'Pricing page' };

describe('POST /api/projects/artifact', () => {
  it('goes through the request gate: session, app origin, JSON, POST only', async () => {
    const path = ROUTES.projectArtifact;
    expect((await send(path, { method: 'POST', headers, body: GOOD })).status).toBe(401);
    const evil = await send(path, {
      method: 'POST',
      headers: { ...headers, cookie: COOKIE, origin: 'https://evil.example' },
      body: GOOD,
    });
    expect(evil.status).toBe(403);
    const form = await send(path, {
      method: 'POST',
      headers: { ...headers, cookie: COOKIE, 'content-type': 'text/plain' },
      body: GOOD,
    });
    expect(form.status).toBe(415);
    expect((await send(path, { headers: { cookie: COOKIE } })).status).toBe(405);
    expect(seen.added).toEqual([]);
    expect((await post(GOOD)).status).toBe(200);
  });

  it('files a link card at a server-built target and returns the saved path and kind', async () => {
    const r = await post({ ...GOOD, description: 'The live pricing page.' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ path: 'clients/acme/projects/web/files/pricing-page.html', kind: 'link' });
    expect(seen.added).toEqual([
      {
        url: URL_OK,
        path: 'clients/acme/projects/web/files/pricing-page.html',
        title: 'Pricing page',
        description: 'The live pricing page.',
        by: 'sam-example',
      },
    ]);
    const p = await post({ key: 'personal/plan', url: URL_OK, title: '!!!' });
    expect(p.json.path).toBe('personal/projects/plan/files/claude-page.html');
  });

  it('answers with the path the script chose (a number added)', async () => {
    state.reply = 'clients/acme/projects/web/files/pricing-page (2).html';
    expect((await post(GOOD)).json.path).toBe('clients/acme/projects/web/files/pricing-page (2).html');
  });

  it('trims the address and drops ?query and #fragment, refusing the bad ones (shared table)', async () => {
    for (const c of ARTIFACT_URL_CASES) {
      seen.added.length = 0;
      const r = await post({ ...GOOD, url: c.input });
      if (c.clean === null) {
        expect(r.status, c.input).toBe(400);
        expect(r.json.error).toEqual({
          code: 'bad-request',
          message:
            "That isn't a link to a claude.ai page. Open the page on claude.ai, press Share and copy its link.",
        });
        expect(seen.added).toEqual([]);
      } else {
        expect(r.status, c.input).toBe(200);
        expect(seen.added[0]?.url).toBe(c.clean);
      }
    }
  });

  it('refuses a bad title or description, and any other shape, before the brain is asked', async () => {
    const bad: unknown[] = [
      null,
      [],
      {},
      { key: 'acme/web', url: URL_OK },
      { ...GOOD, title: '' },
      { ...GOOD, title: '   ' },
      { ...GOOD, title: 'a'.repeat(201) },
      { ...GOOD, title: 'two\nlines' },
      { ...GOOD, title: 'bell\u0007' },
      { ...GOOD, title: 5 },
      { ...GOOD, description: 'd'.repeat(301) },
      { ...GOOD, description: 'two\nlines' },
      { ...GOOD, description: 5 },
      { ...GOOD, key: 'Acme/Web' },
      { ...GOOD, path: 'clients/x/files/y.html' },
      { ...GOOD, source: '/etc/passwd' },
    ];
    for (const body of bad) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json.error?.code).toBe('bad-request');
    }
    expect(seen.added).toEqual([]);
    expect((await post({ ...GOOD, title: 'a'.repeat(200), description: 'd'.repeat(300) })).status).toBe(200);
  });

  it('refuses a project with no card, an archived one, an older one, and an unknown one', async () => {
    const cases: [string, number, string][] = [
      ['acme/nocard', 403, 'This project needs a card before pages can be added to it.'],
      ['acme/old', 403, "Pages can't be added to an archived project."],
      ['the-digital-stride/legacy', 403, "Pages can't be added to this older project from the app yet."],
      ['acme/unknown', 404, 'Projects are not available in this copy of the brain yet.'],
    ];
    for (const [key, status, message] of cases) {
      const r = await post({ ...GOOD, key });
      expect(r.status, key).toBe(status);
      expect(r.json.error?.message, key).toBe(message);
    }
    expect(seen.added).toEqual([]);
  });

  it('refuses without the capability, without change rights, and for someone the roles leave out', async () => {
    state.canAdd = false;
    const noCap = await post(GOOD);
    expect(noCap.status).toBe(403);
    expect(noCap.json.error?.code).toBe('not-allowed');
    state.canAdd = true;
    state.canChange = false;
    expect((await post(GOOD)).status).toBe(403);
    state.canChange = true;
    state.access = 'restricted';
    expect((await post(GOOD)).status).toBe(403);
    expect(seen.added).toEqual([]);
  });

  it('refuses a result path outside the project files folder', async () => {
    state.reply = 'clients/other/projects/web/files/x.html';
    const r = await post(GOOD);
    expect(r.status).toBe(500);
    expect(r.json.error?.code).toBe('internal');
  });

  it('maps the skill refusals to the files messages and codes', async () => {
    state.fail = new FilesChangeError('exists');
    const r = await post(GOOD);
    expect(r.status).toBe(409);
    expect(r.json.error?.code).toBe('changed');
    state.fail = new Error('boom');
    expect((await post(GOOD)).status).toBe(500);
  });

  it('answers 404 without the projects readers or the service', async () => {
    state.hasService = false;
    expect((await post(GOOD)).status).toBe(404);
    state.hasService = true;
    state.has = false;
    expect((await post(GOOD)).status).toBe(404);
  });
});

describe('canAddArtifact on the projects list', () => {
  const list = () => send(ROUTES.projects, { headers: { cookie: COOKIE } });
  it('is true only when changes are allowed and the files skill can add pages', async () => {
    expect((await list()).json.canAddArtifact).toBe(true);
    state.canAdd = false;
    expect('canAddArtifact' in (await list()).json).toBe(false);
    state.canAdd = true;
    state.canChange = false;
    expect('canAddArtifact' in (await list()).json).toBe(false);
    state.canChange = true;
    state.hasService = false;
    expect('canAddArtifact' in (await list()).json).toBe(false);
  });
});

describe('canAddArtifact on every answer that carries the projects list', () => {
  const VERSION = 'a'.repeat(64);
  const call = (path: string, body: unknown) =>
    send(path, { method: 'POST', headers: { cookie: COOKIE, ...headers }, body });
  const answers: [string, string, unknown, (j: Reply['json']) => unknown][] = [
    [
      'a change',
      ROUTES.projectsChange,
      { kind: 'create', space: 'client', client: 'acme', slug: 'new', fields: { title: 'New' } },
      (j) => j.canAddArtifact,
    ],
    [
      'a move',
      ROUTES.projectsMove,
      { key: 'acme/web', client: 'skyseal', expect: VERSION },
      (j) => (j.list as Record<string, unknown>).canAddArtifact,
    ],
    [
      'an archive',
      ROUTES.projectsArchive,
      { key: 'acme/web', action: 'archive', expect: VERSION },
      (j) => (j.list as Record<string, unknown>).canAddArtifact,
    ],
  ];
  for (const [name, path, body, flag] of answers) {
    it(`keeps the Add action after ${name}`, async () => {
      const r = await call(path, body);
      expect(r.status).toBe(200);
      expect(flag(r.json)).toBe(true);
      state.canAdd = false;
      expect(flag((await call(path, body)).json)).toBeUndefined();
    });
  }
});
