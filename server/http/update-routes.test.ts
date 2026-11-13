import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES, SESSION_COOKIE } from '../../shared/contract.ts';
import { UpdateRefused, type Updater, type UpdateStatus } from '../../shared/update-contract.ts';
import { createBrainReaders } from '../brain/index.ts';
import { copyFixture } from '../brain/test-helpers.ts';
import { cookieValueFor, createAuthCodes } from './security.ts';
import { type AppServer, createAppServer } from './server.ts';

const PORT = 45878;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = 'launch-token-update-123';
const GOOD = { cookie: `${SESSION_COOKIE}=${cookieValueFor(TOKEN)}`, origin: `http://${HOST}` };

const NOTES = [{ version: '0.9.0', date: '2026-11-13', changes: [{ kind: 'feat', text: 'x' }] }];

function statusOf(over: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    current: '0.8.2',
    latest: '0.9.0',
    available: true,
    blocked: null,
    checkedAt: new Date().toISOString(),
    checkFailed: false,
    unfinished: false,
    phase: 'idle',
    error: null,
    notes: NOTES,
    openChats: 0,
    ...over,
  };
}

const calls = { status: 0, check: 0, start: 0 };
let current: UpdateStatus;
let refuse: 'busy' | 'not-allowed' | null = null;
const updater: Updater = {
  status: async () => {
    calls.status += 1;
    return current;
  },
  check: async () => {
    calls.check += 1;
    if (refuse) throw new UpdateRefused(refuse);
    return current;
  },
  start: async () => {
    calls.start += 1;
    if (refuse) throw new UpdateRefused(refuse);
    return { ...current, phase: 'downloading' };
  },
  startTimer: () => {},
  stopTimer: () => {},
  abort: async () => {},
};

let role = 'owner';
let root: string;
let clientDir: string;
let app: AppServer;
let listenPort: number;

function build(withUpdater: boolean) {
  return createAppServer({
    port: PORT,
    clientDir,
    launchToken: TOKEN,
    authCodes: createAuthCodes(TOKEN),
    appVersion: '0.8.2',
    underService: false,
    updater: withUpdater ? updater : undefined,
    brain: {
      ...createBrainReaders(copyFixture()),
      identity: async () => ({ name: 'Sam', slug: 'sam', role, knownMember: true }),
    } as never,
    store: {} as never,
    sessions: { onChange: () => () => {} } as never,
    thumbs: {} as never,
    uploads: {} as never,
    engineHealth: () => ({}) as never,
    appState: { kind: 'ready' },
    setup: {} as never,
  });
}

async function listen(a: AppServer): Promise<number> {
  await new Promise<void>((done) => a.server.listen(0, '127.0.0.1', done));
  return (a.server.address() as AddressInfo).port;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'tba-update-'));
  clientDir = join(root, 'client');
  mkdirSync(join(clientDir, 'assets'), { recursive: true });
  writeFileSync(join(clientDir, 'index.html'), '<!doctype html><title>new</title>');
  writeFileSync(join(clientDir, 'assets', 'new.js'), 'new');
  mkdirSync(join(root, 'client.prev', 'assets'), { recursive: true });
  writeFileSync(join(root, 'client.prev', 'assets', 'old.js'), 'old chunk');
  writeFileSync(join(root, 'client.prev', 'secret.txt'), 'not an asset');
  app = build(true);
  listenPort = await listen(app);
});

afterAll(async () => {
  app.stop();
  await new Promise((done) => app.server.close(done));
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  calls.status = calls.check = calls.start = 0;
  current = statusOf();
  refuse = null;
  role = 'owner';
});

type Body = UpdateStatus & { error: { code: string } };

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => Body;
}

function send(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; port?: number } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: opts.port ?? listenPort,
        path,
        method: opts.method ?? 'GET',
        headers: { host: HOST, ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body) });
        });
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

const post = (path: string, body: unknown, headers = GOOD) =>
  send(path, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const get = (path: string, headers: Record<string, string> = GOOD) => send(path, { headers });

describe('update routes', () => {
  it('GET gives the status, never cached', async () => {
    const r = await get(ROUTES.updateStatus);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toEqual(current);
  });

  it('POST check answers the status after a fresh check', async () => {
    const r = await post(ROUTES.updateCheck, {});
    expect(r.status).toBe(200);
    expect(r.json().latest).toBe('0.9.0');
    expect(calls.check).toBe(1);
  });

  it('POST start needs exactly { confirm: true }', async () => {
    for (const body of [
      {},
      { confirm: false },
      { confirm: 'true' },
      { confirm: true, extra: 1 },
      [],
      'x',
      'not json',
    ]) {
      const r = await post(ROUTES.updateStart, body);
      expect(r.status).toBe(400);
      expect(r.json().error.code).toBe('bad-request');
    }
    expect(calls.start).toBe(0);
    const ok = await post(ROUTES.updateStart, { confirm: true });
    expect(ok.status).toBe(202);
    expect(ok.json().phase).toBe('downloading');
    expect(calls.start).toBe(1);
  });

  it('maps UpdateRefused: busy to 409, not-allowed to 403', async () => {
    refuse = 'busy';
    for (const path of [ROUTES.updateStart, ROUTES.updateCheck]) {
      const r = await post(path, { confirm: true });
      expect(r.status).toBe(409);
      expect(r.json().error.code).toBe('busy');
    }
    refuse = 'not-allowed';
    const r = await post(ROUTES.updateStart, { confirm: true });
    expect(r.status).toBe(403);
    expect(r.json().error.code).toBe('not-allowed');
  });

  it('refuses a wrong method', async () => {
    expect((await post(ROUTES.updateStatus, {})).status).toBe(405);
    expect((await get(ROUTES.updateStart)).status).toBe(405);
  });

  it('is behind the cookie and Origin gate', async () => {
    expect((await get(ROUTES.updateStatus, {})).status).toBe(401);
    expect((await post(ROUTES.updateStart, { confirm: true }, { cookie: GOOD.cookie } as never)).status).toBe(
      403,
    );
    expect(
      (
        await post(
          ROUTES.updateStart,
          { confirm: true },
          { cookie: GOOD.cookie, origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
    expect(calls.start).toBe(0);
  });

  it('sends notes to owners and scouts only; every role gets the rest', async () => {
    for (const r of ['owner', 'scout']) {
      role = r;
      expect((await get(ROUTES.updateStatus)).json().notes).toEqual(NOTES);
    }
    for (const r of ['team', 'unknown']) {
      role = r;
      for (const reply of [await get(ROUTES.updateStatus), await post(ROUTES.updateCheck, {})]) {
        expect(reply.status).toBe(200);
        expect(reply.json().notes).toEqual([]);
        expect(reply.json().latest).toBe('0.9.0');
      }
      const started = await post(ROUTES.updateStart, { confirm: true });
      expect(started.status).toBe(202);
      expect(started.json().notes).toEqual([]);
    }
  });

  it('starts a background check when checkedAt is missing or stale, not when fresh or blocked', async () => {
    await get(ROUTES.updateStatus);
    expect(calls.check).toBe(0);

    current = statusOf({ checkedAt: null });
    await get(ROUTES.updateStatus);
    expect(calls.check).toBe(1);

    current = statusOf({ checkedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() });
    await get(ROUTES.updateStatus);
    expect(calls.check).toBe(2);

    current = statusOf({ checkedAt: null, blocked: 'not-service' });
    await get(ROUTES.updateStatus);
    expect(calls.check).toBe(2);
  });

  it('answers at once and survives a failing background check', async () => {
    current = statusOf({ checkedAt: null });
    refuse = 'busy';
    const r = await get(ROUTES.updateStatus);
    expect(r.status).toBe(200);
    expect(calls.check).toBe(1);
  });
});

describe('update routes without an updater', () => {
  it('says the copy is not a service; start is refused', async () => {
    const bare = build(false);
    const port = await listen(bare);
    try {
      const s = await send(ROUTES.updateStatus, { headers: GOOD, port });
      expect(s.status).toBe(200);
      expect(s.json()).toMatchObject({
        current: '0.8.2',
        available: false,
        blocked: 'not-service',
        notes: [],
      });
      const c = await send(ROUTES.updateCheck, {
        method: 'POST',
        headers: { ...GOOD, 'content-type': 'application/json' },
        body: '{}',
        port,
      });
      expect(c.json().blocked).toBe('not-service');
      const st = await send(ROUTES.updateStart, {
        method: 'POST',
        headers: { ...GOOD, 'content-type': 'application/json' },
        body: '{"confirm":true}',
        port,
      });
      expect(st.status).toBe(403);
      expect(st.json().error.code).toBe('not-allowed');
    } finally {
      bare.stop();
      await new Promise((done) => bare.server.close(done));
    }
  });
});

describe('/assets fallback to client.prev', () => {
  it('serves a chunk only the previous build has, as immutable', async () => {
    const r = await get('/assets/old.js');
    expect(r.status).toBe(200);
    expect(r.body).toBe('old chunk');
    expect(r.headers['cache-control']).toContain('immutable');
    expect((await get('/assets/new.js')).body).toBe('new');
  });

  it('404s a missing chunk and never leaves the assets folder', async () => {
    expect((await get('/assets/none.js')).status).toBe(404);
    expect((await get('/assets/..%2Fsecret.txt')).status).toBe(404);
    expect((await get('/assets/%2e%2e/secret.txt')).status).toBe(404);
    expect((await get('/assets/sub/..%5C..%5Csecret.txt')).status).toBe(404);
    expect((await get('/secret.txt')).status).toBe(404);
  });
});

describe('server/index.ts --check', () => {
  it('exits 0 straight after the imports load, before any config is read', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tba-check-'));
    try {
      const r = spawnSync(process.execPath, ['server/index.ts', '--check'], {
        env: { ...process.env, TDS_BRAIN_APP_DATA: dataDir, TDS_BRAIN_APP_PORT: '45879' },
        timeout: 30_000,
        encoding: 'utf8',
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
