import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE, sessionCookieName } from '../../shared/contract.ts';
import { SETUP_ROUTES } from '../../shared/install-contract.ts';
import { createBrainReaders } from '../brain/index.ts';
import { copyFixture } from '../brain/test-helpers.ts';
import { cookieValueFor, createAuthCodes, SECURITY_HEADERS, sessionSetCookie } from './security.ts';
import { type AppServer, createAppServer, LAUNCHER_PAGE, SIGNED_OUT_COPY } from './server.ts';

// Only ever sent as the Host header; the server listens on a free port the OS picks.
const PORT = 45877;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = 'launch-token-abc123';
const GOOD_COOKIE = `${sessionCookieName(PORT)}=${cookieValueFor(TOKEN)}`;

const SW = 'self.addEventListener("fetch", () => {});\n';
const INDEX = '<!doctype html><title>the app</title>';
const SW_OFF = '// test sw-off\nself.registration.unregister();\n';

let clientDir: string;
let app: AppServer;
let listenPort: number;
const setupCalls = { candidates: 0, save: [] as string[], restart: 0 };

beforeAll(async () => {
  clientDir = mkdtempSync(join(tmpdir(), 'tba-client-'));
  writeFileSync(join(clientDir, 'index.html'), INDEX);
  writeFileSync(join(clientDir, 'sw.js'), SW);
  writeFileSync(join(clientDir, 'sw-off.js'), SW_OFF);
  writeFileSync(join(clientDir, 'offline.html'), '<!doctype html><title>offline</title>');
  writeFileSync(join(clientDir, 'manifest.webmanifest'), '{"id":"/"}');
  mkdirSync(join(clientDir, 'icons'));
  writeFileSync(join(clientDir, 'icons', 'icon-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  // Files that exist but must never be public.
  mkdirSync(join(clientDir, 'icons', 'a'));
  writeFileSync(join(clientDir, 'icons', 'a', 'b'), 'nested');
  writeFileSync(join(clientDir, 'icons', 'x'), 'no extension');
  // offline.css is left out on purpose: a listed file that is missing must 404.

  app = createAppServer({
    port: PORT,
    clientDir,
    launchToken: TOKEN,
    authCodes: createAuthCodes(TOKEN),
    appVersion: '0',
    underService: false,
    brain: createBrainReaders(copyFixture()),
    store: {
      get: async () => ({ pins: [], lastClient: null, todoPanelOpen: false, directWrites: false }),
    } as never,
    sessions: { onChange: () => () => {} } as never,
    thumbs: {} as never,
    uploads: {} as never,
    engineHealth: () =>
      ({ ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' }) as never,
    appState: { kind: 'ready' },
    setup: {
      candidates: async () => {
        setupCalls.candidates += 1;
        return { candidates: [], current: null, openChats: 0, envOverride: false };
      },
      save: async (p) => {
        setupCalls.save.push(p);
        return { ok: true, path: p, restarting: true };
      },
      restart: () => {
        setupCalls.restart += 1;
      },
    },
  });
  await new Promise<void>((done) => app.server.listen(0, '127.0.0.1', done));
  listenPort = (app.server.address() as AddressInfo).port;
});

afterAll(async () => {
  app.stop();
  await new Promise((done) => app.server.close(done));
  rmSync(clientDir, { recursive: true, force: true });
});

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Sends `path` byte for byte, so the server's own URL parsing is what gets tested. */
function send(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
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
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

function expectSecurityHeaders(reply: Reply): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(reply.headers[name.toLowerCase()], name).toBe(value);
  }
}

describe('public files (decision 5)', () => {
  it('serves the listed files and icons without a session, with the security headers', async () => {
    const sw = await send('/sw.js');
    expect(sw.status).toBe(200);
    expect(sw.body).toBe(SW);
    expect(sw.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(sw.headers['set-cookie']).toBeUndefined();
    expectSecurityHeaders(sw);

    const manifest = await send('/manifest.webmanifest');
    expect(manifest.status).toBe(200);
    expect(manifest.headers['content-type']).toBe('application/manifest+json');
    expectSecurityHeaders(manifest);

    const icon = await send('/icons/icon-192.png');
    expect(icon.status).toBe(200);
    expect(icon.headers['content-type']).toBe('image/png');
    expectSecurityHeaders(icon);
  });

  it('answers HEAD with no body', async () => {
    const head = await send('/offline.html', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  it('drops the query string before the gate, so the file is still served', async () => {
    const r = await send('/offline.html?x');
    expect(r.status).toBe(200);
    expect(r.body).toContain('offline');
  });

  it('gives a listed file that is missing a 404, never the home page', async () => {
    for (const cookie of [undefined, GOOD_COOKIE]) {
      const r = await send('/offline.css', cookie ? { headers: { cookie } } : {});
      expect(r.status).toBe(404);
      expect(r.body).not.toContain(INDEX);
      expectSecurityHeaders(r);
    }
    const icon = await send('/icons/missing.svg');
    expect(icon.status).toBe(404);
    expect(icon.body).not.toContain(INDEX);
  });

  it('refuses another method with 405', async () => {
    const r = await send('/sw.js', {
      method: 'POST',
      headers: { origin: `http://${HOST}`, 'content-type': 'application/json' },
    });
    expect(r.status).toBe(405);
    expectSecurityHeaders(r);
  });

  it('still refuses a wrong Host or a foreign Origin', async () => {
    expect((await send('/sw.js', { headers: { host: `localhost:${PORT}` } })).status).toBe(403);
    expect((await send('/sw.js', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('lets no lookalike through to a file while signed out', async () => {
    for (const path of [
      '/sw.js/',
      '/SW.JS',
      '/icons/',
      '/icons/a/b',
      '/icons/x',
      '/icons/../api/x',
      '/icons/%2e%2e/x',
      '/icons/%2e%2e/icons/x',
      '/icons/..%2fx',
    ]) {
      const r = await send(path);
      expect(r.status, path).toBe(401);
      expect(r.body, path).not.toContain('nested');
      expect(r.body, path).not.toContain('no extension');
      expect(r.body, path).not.toContain(SW);
    }
  });
});

describe('a planted service worker (Service-Worker: script)', () => {
  const sw = { 'service-worker': 'script' };

  it('gets the self-unregistering worker, uncached, without a session', async () => {
    const r = await send('/x.js', { headers: sw });
    expect(r.status).toBe(200);
    expect(r.body).toBe(SW_OFF);
    expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(r.headers['cache-control']).toBe('no-store');
    expectSecurityHeaders(r);
  });

  it('falls back to a built-in script that unregisters and clears the caches', async () => {
    rmSync(join(clientDir, 'sw-off.js'));
    try {
      const r = await send('/x.js', { headers: sw });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
      expect(r.body).toMatch(/registration\s*\.unregister\(\)/);
      expect(r.body).toContain('caches.delete');
    } finally {
      writeFileSync(join(clientDir, 'sw-off.js'), SW_OFF);
    }
  });

  it('without the header, /x.js still needs a session', async () => {
    expect((await send('/x.js')).status).toBe(401);
  });

  it('/sw.js with the header gets the real worker', async () => {
    const r = await send('/sw.js', { headers: sw });
    expect(r.status).toBe(200);
    expect(r.body).toBe(SW);
  });

  it('a bad Host with the header is still refused', async () => {
    const r = await send('/x.js', { headers: { ...sw, host: `evil.example:${PORT}` } });
    expect(r.status).toBe(403);
    expect(r.body).not.toContain(SW_OFF);
  });
});

describe('signed-out page (decision 6c)', () => {
  it('says how to sign in and reloads every 5 seconds', async () => {
    const r = await send('/');
    expect(r.status).toBe(401);
    expect(r.body).toBe(LAUNCHER_PAGE);
    expect(r.body).toContain('<meta http-equiv="refresh" content="5">');
    expect(r.body).toContain('<h1>Sign in to TDS Brain</h1>');
    expect(r.body).toContain('<title>Sign in to TDS Brain</title>');
    expect(r.body).toContain('<link rel="icon" href="/icons/brain.svg">');
    expectSecurityHeaders(r);
  });

  it('keeps its wording in one place', () => {
    expect(SIGNED_OUT_COPY).toEqual({
      heading: 'Sign in to TDS Brain',
      paragraphs: [
        "Press Command and Space, type TDS Brain Sign-in, then press Return. This page checks every few seconds and opens TDS Brain once you're signed in.",
        'If Chrome opens with the wrong profile, close that window, switch to the Chrome profile you use for work, then open TDS Brain Sign-in again.',
      ],
    });
    for (const p of SIGNED_OUT_COPY.paragraphs) expect(LAUNCHER_PAGE).toContain(p.replace("'", '&#39;'));
  });

  it('after a used or wrong code, reloads the home page, not the dead sign-in link', async () => {
    const r = await send('/auth?code=nope');
    expect(r.status).toBe(403);
    expect(r.body).toContain('<h1>Sign in to TDS Brain</h1>');
    expect(r.body).toContain('<meta http-equiv="refresh" content="5; url=/">');
  });
});

describe('GET /api/bootstrap over HTTP (decision 6a)', () => {
  it('renews the cookie with a valid session', async () => {
    const r = await send('/api/bootstrap', { headers: { cookie: GOOD_COOKIE } });
    expect(r.status).toBe(200);
    expect(r.headers['set-cookie']).toEqual([sessionSetCookie(TOKEN, PORT)]);
  });

  it('sends no cookie without one', async () => {
    for (const cookie of [
      undefined,
      `${sessionCookieName(PORT)}=nope`,
      `${SESSION_COOKIE}=${cookieValueFor(TOKEN)}`,
    ]) {
      const r = await send('/api/bootstrap', cookie ? { headers: { cookie } } : {});
      expect(r.status).toBe(401);
      expect(r.headers['set-cookie']).toBeUndefined();
    }
  });
});

describe('setup routes behind the gate (setup-screen decision 4)', () => {
  const ORIGIN = `http://${HOST}`;
  const body = JSON.stringify({ path: '/Users/a/brain' });

  it('need a session, both of them', async () => {
    const list = await send(SETUP_ROUTES.candidates);
    expect(list.status).toBe(401);
    const save = await send(SETUP_ROUTES.brain, {
      method: 'PUT',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body,
    });
    expect(save.status).toBe(401);
    expect(setupCalls.candidates).toBe(0);
    expect(setupCalls.save).toEqual([]);
  });

  it('lists the candidates with a session', async () => {
    const r = await send(SETUP_ROUTES.candidates, { headers: { cookie: GOOD_COOKIE } });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ candidates: [], openChats: 0 });
  });

  it('saves only from the app itself, as JSON', async () => {
    const noOrigin = await send(SETUP_ROUTES.brain, {
      method: 'PUT',
      headers: { cookie: GOOD_COOKIE, 'content-type': 'application/json' },
      body,
    });
    expect(noOrigin.status).toBe(403);
    const foreign = await send(SETUP_ROUTES.brain, {
      method: 'PUT',
      headers: { cookie: GOOD_COOKIE, origin: 'https://evil.example', 'content-type': 'application/json' },
      body,
    });
    expect(foreign.status).toBe(403);
    const notJson = await send(SETUP_ROUTES.brain, {
      method: 'PUT',
      headers: { cookie: GOOD_COOKIE, origin: ORIGIN, 'content-type': 'text/plain' },
      body,
    });
    expect(notJson.status).toBe(415);
    expect(setupCalls.save).toEqual([]);

    const ok = await send(SETUP_ROUTES.brain, {
      method: 'PUT',
      headers: { cookie: GOOD_COOKIE, origin: ORIGIN, 'content-type': 'application/json' },
      body,
    });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ ok: true, path: '/Users/a/brain', restarting: true });
    expect(setupCalls.save).toEqual(['/Users/a/brain']);
    // The answer has been read in full, so the response has finished and the restart has run.
    await new Promise((r) => setImmediate(r));
    expect(setupCalls.restart).toBe(1);
  });
});
