// GET /api/library/recent sent over real HTTP to the real server, so the request passes the real gate (checkRequest).

import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTES, sessionCookieName } from '../../shared/contract.ts';
import { createBrainReaders } from '../brain/index.ts';
import { copyFixture } from '../brain/test-helpers.ts';
import { cookieValueFor, createAuthCodes } from './security.ts';
import { type AppServer, createAppServer } from './server.ts';

const PORT = 45881;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = 'launch-token-recent';
const COOKIE = `${sessionCookieName(PORT)}=${cookieValueFor(TOKEN)}`;

let app: AppServer;
let listenPort = 0;

beforeAll(async () => {
  app = createAppServer({
    port: PORT,
    clientDir: '/nonexistent',
    launchToken: TOKEN,
    authCodes: createAuthCodes(TOKEN),
    appVersion: '0',
    underService: false,
    brain: createBrainReaders(copyFixture()) as never,
    store: {} as never,
    sessions: { onChange: () => () => {} } as never,
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

function get(path: string, headers: Record<string, string>) {
  return new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: listenPort, path, method: 'GET', headers: { host: HOST, ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(Buffer.concat(chunks).toString());
          } catch {}
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('GET /api/library/recent through the request gate', () => {
  it('answers 200 for a signed-in request (history unread in a brain that is not a git repo)', async () => {
    const r = await get(`${ROUTES.libraryRecent}?kind=image`, { cookie: COOKIE });
    expect(r.status).toBe(200);
    expect(r.json.files).toEqual([]);
    expect(r.json.partial).toBe(true);
  });

  it('is refused without the session cookie', async () => {
    const r = await get(`${ROUTES.libraryRecent}?kind=image`, {});
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('answers 400 for a bad kind', async () => {
    expect((await get(`${ROUTES.libraryRecent}?kind=video`, { cookie: COOKIE })).status).toBe(400);
  });
});
