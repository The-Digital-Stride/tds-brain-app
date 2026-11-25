// Projects R2 phase 5: the email-drafts route, sent over real HTTP to the real server so every request passes
// the real security gate (checkRequest) first (route tests that skip the gate once let a 415-on-every-delete
// bug through). The drafts service is a fake: its own tests are in server/brain/email-drafts.test.ts.
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Identity, ROUTES, sessionCookieName } from '../../shared/contract.ts';
import type {
  EmailDraftApproveRequest,
  EmailDraftDismissRequest,
  EmailDraftsResponse,
} from '../../shared/project-email-contract.ts';
import { ProjectsError } from '../../shared/projects-contract.ts';
import type { EmailApproveAnswer } from '../brain/email-drafts.ts';
import { SessionError } from '../engine/session-manager.ts';
import { cookieValueFor, createAuthCodes } from './security.ts';
import { type AppServer, createAppServer } from './server.ts';

const PORT = 45917;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = 'launch-token-email';
const COOKIE = `${sessionCookieName(PORT)}=${cookieValueFor(TOKEN)}`;

const sam: Identity = {
  name: 'Sam Example',
  slug: 'sam-example',
  email: null,
  role: 'scout',
  knownMember: true,
};
const LIST: EmailDraftsResponse = {
  drafts: [
    {
      id: 'aaaaaaaaaaaa',
      subject: 'Quote',
      from: 'Alex Smith',
      people: ['Jo'],
      sentAt: '2026-11-20T16:30:00Z',
      summary: 'Agreed.',
      route: { key: 'acme/web', why: 'thread', overruled: 'ZET1A2' },
      // The thread facts pass through the real gate unchanged.
      thread: {
        total: 3,
        fresh: 1,
        partOf: { key: 'acme/web', byName: 'Ben McAdam', at: '2026-11-21T09:00:00Z' },
        overlap: true,
      },
    },
  ],
  unreadable: 0,
  canApprove: true,
};

const seen = {
  lists: [] as (string | null)[],
  approved: [] as EmailDraftApproveRequest[],
  dismissed: [] as string[],
  access: [] as string[],
};
let state: { has: boolean; fail: unknown; access: 'allowed' | 'restricted'; answer: EmailApproveAnswer } = {
  has: true,
  fail: null,
  access: 'allowed',
  answer: { ok: true, key: 'acme/web', file: 'clients/acme/projects/web/updates/x.md' },
};

let app: AppServer;
let listenPort: number;

beforeAll(async () => {
  const brain = {
    watch: () => () => {},
    identity: async () => sam,
    skillAccess: async (_who: Identity, name: string) => {
      seen.access.push(name);
      return state.access;
    },
    get emailDrafts() {
      return state.has
        ? {
            list: async (key: string | null) => {
              if (state.fail) throw state.fail;
              seen.lists.push(key);
              return LIST;
            },
            approve: async (req: EmailDraftApproveRequest) => {
              if (state.fail) throw state.fail;
              seen.approved.push(req);
              return state.answer;
            },
            dismiss: async (id: string) => {
              if (state.fail) throw state.fail;
              seen.dismissed.push(id);
            },
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
    store: { get: async () => ({ directWrites: true }) } as never,
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
    fail: null,
    access: 'allowed',
    answer: { ok: true, key: 'acme/web', file: 'clients/acme/projects/web/updates/x.md' },
  };
  seen.lists.length = 0;
  seen.approved.length = 0;
  seen.dismissed.length = 0;
  seen.access.length = 0;
});

interface Reply {
  status: number;
  text: string;
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
          const text = Buffer.concat(chunks).toString();
          let json: Reply['json'] = {};
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode ?? 0, text, json });
        });
      },
    );
    req.on('error', reject);
    req.end(opts.body === undefined ? undefined : JSON.stringify(opts.body));
  });
}
const get = (path: string) => send(path, { headers: { cookie: COOKIE } });
const post = (body: unknown) =>
  send(ROUTES.projectEmailDrafts, {
    method: 'POST',
    headers: { cookie: COOKIE, origin: `http://${HOST}`, 'content-type': 'application/json' },
    body,
  });

const APPROVE: EmailDraftApproveRequest = {
  action: 'approve',
  id: 'aaaaaaaaaaaa',
  key: 'acme/web',
  summary: 'Agreed the quote.',
  subject: 'Quote',
  from: 'Alex Smith',
  people: ['Jo Bloggs'],
  clientSafe: false,
};
const DISMISS: EmailDraftDismissRequest = { action: 'dismiss', id: 'aaaaaaaaaaaa' };

describe('the security gate', () => {
  it('refuses a request with no session cookie', async () => {
    expect((await send(ROUTES.projectEmailDrafts)).status).toBe(401);
  });
  it('refuses a POST without the origin header or JSON content type', async () => {
    const noOrigin = await send(ROUTES.projectEmailDrafts, {
      method: 'POST',
      headers: { cookie: COOKIE, 'content-type': 'application/json' },
      body: DISMISS,
    });
    expect(noOrigin.status).toBe(403);
    const wrongType = await send(ROUTES.projectEmailDrafts, {
      method: 'POST',
      headers: { cookie: COOKIE, origin: `http://${HOST}`, 'content-type': 'text/plain' },
      body: DISMISS,
    });
    expect(wrongType.status).toBe(415);
    expect(seen.dismissed).toEqual([]);
  });
});

describe('GET /api/projects/email-drafts', () => {
  it('lists, with and without a project key', async () => {
    const all = await get(ROUTES.projectEmailDrafts);
    expect(all.status).toBe(200);
    expect(all.json).toEqual(LIST);
    await get(`${ROUTES.projectEmailDrafts}?key=${encodeURIComponent('acme/web')}`);
    expect(seen.lists).toEqual([null, 'acme/web']);
  });
  it('refuses a bad key with 400', async () => {
    expect((await get(`${ROUTES.projectEmailDrafts}?key=..%2Fx`)).status).toBe(400);
    expect(seen.lists).toEqual([]);
  });
  it('404s when this copy has no drafts reader', async () => {
    state.has = false;
    expect((await get(ROUTES.projectEmailDrafts)).status).toBe(404);
  });
  it('turns a service failure into the app’s words, not a stack', async () => {
    state.fail = new Error('boom /Users/x/secret');
    const r = await get(ROUTES.projectEmailDrafts);
    expect(r.status).toBe(500);
    expect(r.text).not.toContain('secret');
  });
});

describe('POST /api/projects/email-drafts', () => {
  it('approves with exactly the edited fields and answers the service’s reply', async () => {
    const r = await post(APPROVE);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, key: 'acme/web', file: 'clients/acme/projects/web/updates/x.md' });
    expect(seen.approved).toEqual([APPROVE]);
    expect(seen.access).toContain('tdsapp-projects');
  });

  it('approves an email with no subject, as the script saves it (correctness review)', async () => {
    const r = await post({ ...APPROVE, subject: '' });
    expect(r.status).toBe(200);
    expect(seen.approved).toEqual([{ ...APPROVE, subject: '' }]);
  });

  it('answers exists as a normal reply', async () => {
    state.answer = { ok: false, code: 'exists', key: 'acme/seo', byName: 'Ben McAdam' };
    const r = await post(APPROVE);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: false, code: 'exists', key: 'acme/seo', byName: 'Ben McAdam' });
  });

  it('dismisses by id', async () => {
    const r = await post(DISMISS);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
    expect(seen.dismissed).toEqual(['aaaaaaaaaaaa']);
  });

  const bad: [string, unknown][] = [
    ['not an object', 'x'],
    ['unknown action', { ...APPROVE, action: 'remove' }],
    ['a token from the browser', { ...APPROVE, token: 'a'.repeat(32) }],
    ['a thread id from the browser', { ...APPROVE, threadId: 'abc12345' }],
    ['an extra field on dismiss', { ...DISMISS, dismiss: false }],
    ['a bad id', { ...APPROVE, id: '../etc/passwd' }],
    ['a short id', { ...DISMISS, id: 'abc' }],
    ['a bad key', { ...APPROVE, key: 'nope' }],
    ['an empty summary', { ...APPROVE, summary: '   ' }],
    ['an over-long summary', { ...APPROVE, summary: 'x'.repeat(5001) }],
    ['a subject with a newline', { ...APPROVE, subject: 'a\nb' }],
    ['an over-long subject', { ...APPROVE, subject: 'x'.repeat(301) }],
    ['an empty from', { ...APPROVE, from: '' }],
    ['people not a list', { ...APPROVE, people: 'Jo' }],
    ['too many people', { ...APPROVE, people: Array.from({ length: 31 }, () => 'Jo') }],
    ['an over-long name', { ...APPROVE, people: ['x'.repeat(121)] }],
    ['clientSafe not a boolean', { ...APPROVE, clientSafe: 'no' }],
    ['a missing field', { action: 'approve', id: 'aaaaaaaaaaaa', key: 'acme/web' }],
  ];
  it.each(bad)('400s on %s', async (_n, body) => {
    const r = await post(body);
    expect(r.status).toBe(400);
    expect(seen.approved).toEqual([]);
    expect(seen.dismissed).toEqual([]);
  });

  it('403s when the skill’s roles do not allow this person', async () => {
    state.access = 'restricted';
    expect((await post(APPROVE)).status).toBe(403);
    expect(seen.approved).toEqual([]);
  });

  it('maps the service’s refusals to statuses with the app’s words', async () => {
    state.fail = new ProjectsError('not-found', 'No longer waiting.');
    const gone = await post(DISMISS);
    expect(gone.status).toBe(404);
    expect(gone.json.error?.message).toBe('No longer waiting.');
    state.fail = new ProjectsError('not-allowed', 'Nope.');
    expect((await post(APPROVE)).status).toBe(403);
  });

  it('refuses an unsupported method', async () => {
    const r = await send(ROUTES.projectEmailDrafts, {
      method: 'DELETE',
      headers: { cookie: COOKIE, origin: `http://${HOST}`, 'content-type': 'application/json' },
      body: {},
    });
    expect([400, 405]).toContain(r.status);
    expect(seen.approved).toEqual([]);
  });
});
