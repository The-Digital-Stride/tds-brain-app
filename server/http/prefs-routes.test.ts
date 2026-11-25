// Saved Home settings (plan 2026-11-25-home-card-library), sent over real HTTP to the real server, so every request
// passes the real security gate (checkRequest) first: a PUT without a JSON content type would be a 415 here.
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppPrefs, sessionCookieName } from '../../shared/contract.ts';
import { createBrainReaders } from '../brain/index.ts';
import { copyFixture } from '../brain/test-helpers.ts';
import { createAppStore } from '../store/app-store.ts';
import { cookieValueFor, createAuthCodes } from './security.ts';
import { type AppServer, createAppServer } from './server.ts';

const PORT = 45881;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = 'launch-token-prefs';
const COOKIE = `${sessionCookieName(PORT)}=${cookieValueFor(TOKEN)}`;

let app: AppServer;
let listenPort: number;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'prefs-routes-'));
  app = createAppServer({
    port: PORT,
    clientDir: '/nonexistent',
    launchToken: TOKEN,
    authCodes: createAuthCodes(TOKEN),
    appVersion: '0',
    underService: false,
    brain: createBrainReaders(copyFixture()) as never,
    store: createAppStore(dir),
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
  rmSync(dir, { recursive: true, force: true });
});

interface Reply {
  status: number;
  json: { prefs?: AppPrefs; error?: { message: string } };
}
function send(method: string, body?: unknown, path = '/api/prefs') {
  return new Promise<Reply>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: listenPort,
        path,
        method,
        headers: {
          host: HOST,
          cookie: COOKIE,
          origin: `http://${HOST}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
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
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** The saved settings as the app reads them: the `prefs` part of the bootstrap. */
async function prefs() {
  const got = await send('GET', undefined, '/api/bootstrap');
  expect(got.status).toBe(200);
  return got.json.prefs as AppPrefs;
}

describe('PUT /api/prefs: Home hidden items and shortcuts, through the request gate', () => {
  it('sends both lists, empty, before anything is saved', async () => {
    const got = await prefs();
    expect(got.homeHidden).toEqual([]);
    expect(got.homeShortcuts).toEqual([]);
  });

  it('saves both and a following GET returns them', async () => {
    const homeHidden = ['files'];
    const homeShortcuts = [
      { kind: 'skill', name: 'meeting-notes' },
      { kind: 'tool', section: 'workbench', tool: 'ads' },
    ];
    const put = await send('PUT', { homeHidden, homeShortcuts });
    expect(put.status).toBe(200);
    const got = await prefs();
    expect(got.homeHidden).toEqual(homeHidden);
    expect(got.homeShortcuts).toEqual(homeShortcuts);
  });

  it('refuses seven shortcuts and leaves the saved ones alone', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ kind: 'skill', name: `skill-${i}` }));
    const put = await send('PUT', { homeShortcuts: seven });
    expect(put.status).toBe(400);
    expect(put.json.error?.message).toBe('The Home shortcuts were not understood.');
    expect((await prefs()).homeShortcuts).toHaveLength(2);
  });
});
