import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTES, SESSION_COOKIE, sessionCookieName } from '../../shared/contract.ts';
import { AUTH_COOKIE_MAX_AGE_SECONDS, PUBLIC_PATHS } from '../../shared/install-contract.ts';
import {
  AUTH_CODE_TTL_MS,
  AUTH_PING_PATH,
  authExchange,
  checkRequest,
  codeProof,
  cookieValueFor,
  createAuthCodes,
  hasValidSession,
  isAllowedHost,
  isAllowedOrigin,
  isJsonContentType,
  isLibraryPagePath,
  MAX_BODY_BYTES,
  MAX_LIVE_CODES,
  PAGE_CSP,
  parseCookies,
  pingProof,
  SECURITY_HEADERS,
  safeEqual,
  sessionSetCookie,
} from './security.ts';

const PORT = 3877;
const TOKEN = 'launch-token-abc123';
const COOKIE = cookieValueFor(TOKEN);
const ORIGIN = `http://127.0.0.1:${PORT}`;

function req(over: {
  method?: string;
  path?: string;
  headers?: Record<string, string | undefined>;
}): Parameters<typeof checkRequest>[0] {
  return {
    method: over.method ?? 'GET',
    path: over.path ?? '/api/bootstrap',
    headers: {
      host: `127.0.0.1:${PORT}`,
      cookie: `${SESSION_COOKIE}=${COOKIE}`,
      ...over.headers,
    },
  };
}

const ctx = { port: PORT, launchToken: TOKEN };

describe('Host allow-list', () => {
  it('accepts 127.0.0.1 on the app port only', () => {
    expect(isAllowedHost(`127.0.0.1:${PORT}`, PORT)).toBe(true);
  });

  it('refuses localhost, other ports, other names and a missing host', () => {
    expect(isAllowedHost(`localhost:${PORT}`, PORT)).toBe(false);
    expect(isAllowedHost('127.0.0.1:3000', PORT)).toBe(false);
    expect(isAllowedHost('127.0.0.1', PORT)).toBe(false);
    expect(isAllowedHost(`evil.example:${PORT}`, PORT)).toBe(false);
    expect(isAllowedHost(`[::1]:${PORT}`, PORT)).toBe(false);
    expect(isAllowedHost(undefined, PORT)).toBe(false);
  });

  it('rejects a request with the wrong Host before anything else', () => {
    const d = checkRequest(req({ headers: { host: `localhost:${PORT}` } }), ctx);
    expect(d).toMatchObject({ action: 'reject', status: 403, code: 'forbidden' });
  });

  it('rejects a DNS-rebinding style host even with a good cookie', () => {
    const d = checkRequest(req({ headers: { host: `attacker.example:${PORT}` } }), ctx);
    expect(d).toMatchObject({ action: 'reject', status: 403, code: 'forbidden' });
  });
});

describe('session cookie', () => {
  it('is not the launch token itself', () => {
    expect(COOKIE).not.toBe(TOKEN);
    expect(COOKIE).not.toContain(TOKEN);
    expect(cookieValueFor(TOKEN)).toBe(COOKIE);
  });

  it('parses a cookie header', () => {
    expect(parseCookies(`a=1; ${SESSION_COOKIE}=xyz; b=2`)).toEqual({
      a: '1',
      [SESSION_COOKIE]: 'xyz',
      b: '2',
    });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('junk;;=;x')).toEqual({});
  });

  it('allows an API call with the right cookie', () => {
    expect(checkRequest(req({}), ctx)).toEqual({ action: 'allow' });
  });

  it('refuses an API call with no cookie or a wrong cookie', () => {
    expect(checkRequest(req({ headers: { cookie: undefined } }), ctx)).toMatchObject({
      action: 'reject',
      status: 401,
      code: 'unauthorised',
    });
    expect(checkRequest(req({ headers: { cookie: `${SESSION_COOKIE}=nope` } }), ctx)).toMatchObject({
      action: 'reject',
      status: 401,
      code: 'unauthorised',
    });
    // The raw launch token is not a valid cookie.
    expect(checkRequest(req({ headers: { cookie: `${SESSION_COOKIE}=${TOKEN}` } }), ctx)).toMatchObject({
      action: 'reject',
      status: 401,
    });
  });

  it('shows the launcher page to a page visit without a cookie', () => {
    expect(checkRequest(req({ path: '/', headers: { cookie: undefined } }), ctx)).toEqual({
      action: 'launcher',
    });
    expect(checkRequest(req({ path: '/assets/app.js', headers: { cookie: undefined } }), ctx)).toEqual({
      action: 'launcher',
    });
  });

  it('lets /auth through without a cookie (it is how the cookie is got)', () => {
    expect(checkRequest(req({ path: '/auth', headers: { cookie: undefined } }), ctx)).toEqual({
      action: 'auth',
    });
  });
});

describe('constant-time compare', () => {
  it('compares equal and unequal strings correctly, whatever their lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('', 'a')).toBe(false);
  });

  it('compares fixed-length digests with crypto.timingSafeEqual, never ===', () => {
    // ESM namespaces cannot be spied on, so check the implementation directly.
    const src = readFileSync(new URL('./security.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export function safeEqual'));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    expect(fn).toContain('timingSafeEqual');
    expect(fn).toContain('digest');
    expect(fn).not.toMatch(/[^=!]===?[^=]/);
  });
});

describe('changing requests', () => {
  const post = (headers: Record<string, string | undefined>) =>
    req({
      method: 'POST',
      path: '/api/sessions',
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    });

  it('allows a POST with matching Origin and JSON content type', () => {
    expect(checkRequest(post({}), ctx)).toEqual({ action: 'allow' });
    expect(checkRequest(post({ 'content-type': 'application/json; charset=utf-8' }), ctx)).toEqual({
      action: 'allow',
    });
  });

  it('refuses a POST with no Origin', () => {
    expect(checkRequest(post({ origin: undefined }), ctx)).toMatchObject({
      action: 'reject',
      status: 403,
      code: 'forbidden',
    });
  });

  it('refuses a POST from another local port (cookies ignore ports, Origin does not)', () => {
    expect(checkRequest(post({ origin: 'http://127.0.0.1:5173' }), ctx)).toMatchObject({
      action: 'reject',
      status: 403,
      code: 'forbidden',
    });
    expect(checkRequest(post({ origin: `http://localhost:${PORT}` }), ctx)).toMatchObject({
      action: 'reject',
      status: 403,
    });
    expect(checkRequest(post({ origin: 'null' }), ctx)).toMatchObject({ action: 'reject', status: 403 });
  });

  it('refuses a POST or PUT without a JSON content type', () => {
    expect(checkRequest(post({ 'content-type': 'text/plain' }), ctx)).toMatchObject({
      action: 'reject',
      status: 415,
      code: 'bad-request',
    });
    expect(checkRequest(post({ 'content-type': undefined }), ctx)).toMatchObject({
      action: 'reject',
      status: 415,
    });
    expect(
      checkRequest(
        req({
          method: 'PUT',
          path: '/api/prefs',
          headers: { origin: ORIGIN, 'content-type': 'multipart/form-data' },
        }),
        ctx,
      ),
    ).toMatchObject({ action: 'reject', status: 415 });
  });

  it('refuses a GET that carries a foreign Origin', () => {
    expect(checkRequest(req({ headers: { origin: 'http://127.0.0.1:9999' } }), ctx)).toMatchObject({
      action: 'reject',
      status: 403,
    });
  });

  it('refuses an API call the browser marks as cross-site or same-site', () => {
    expect(checkRequest(req({ headers: { 'sec-fetch-site': 'cross-site' } }), ctx)).toMatchObject({
      action: 'reject',
      status: 403,
    });
    expect(checkRequest(req({ headers: { 'sec-fetch-site': 'same-site' } }), ctx)).toMatchObject({
      action: 'reject',
      status: 403,
    });
    expect(checkRequest(req({ headers: { 'sec-fetch-site': 'same-origin' } }), ctx)).toEqual({
      action: 'allow',
    });
  });

  it('checks Origin and content type helpers directly', () => {
    expect(isAllowedOrigin(ORIGIN, PORT)).toBe(true);
    expect(isAllowedOrigin(`${ORIGIN}/`, PORT)).toBe(false);
    expect(isAllowedOrigin(undefined, PORT)).toBe(false);
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('Application/JSON ; charset=UTF-8')).toBe(true);
    expect(isJsonContentType('application/jsonp')).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
  });
});

describe('file uploads (octet-stream on exactly POST /api/uploads)', () => {
  const upload = (
    over: { method?: string; path?: string; headers?: Record<string, string | undefined> } = {},
  ) =>
    req({
      method: over.method ?? 'POST',
      path: over.path ?? ROUTES.uploads,
      headers: { origin: ORIGIN, 'content-type': 'application/octet-stream', ...over.headers },
    });

  it('allows raw bytes on the upload route with the cookie and the app’s own Origin', () => {
    expect(checkRequest(upload(), ctx)).toEqual({ action: 'allow' });
    expect(checkRequest(upload({ headers: { 'sec-fetch-site': 'same-origin' } }), ctx)).toEqual({
      action: 'allow',
    });
  });

  it('refuses octet-stream on every other changing path and method', () => {
    for (const path of [
      '/api/sessions',
      '/api/uploads/',
      '/api/uploads/x',
      ROUTES.uploadDiscard('abc'),
      '/api/uploadsx',
      '/api/prefs',
      '/API/uploads',
    ]) {
      expect(checkRequest(upload({ path }), ctx), path).toMatchObject({ action: 'reject', status: 415 });
    }
    expect(checkRequest(upload({ method: 'PUT' }), ctx)).toMatchObject({ action: 'reject', status: 415 });
  });

  it('still refuses other content types on the upload route', () => {
    for (const type of [
      'text/plain',
      'multipart/form-data; boundary=x',
      'application/x-www-form-urlencoded',
    ]) {
      expect(checkRequest(upload({ headers: { 'content-type': type } }), ctx), type).toMatchObject({
        action: 'reject',
        status: 415,
      });
    }
    expect(checkRequest(upload({ headers: { 'content-type': undefined } }), ctx)).toMatchObject({
      action: 'reject',
      status: 415,
    });
  });

  it('refuses a cross-site, cookie-less or foreign-Origin upload', () => {
    expect(checkRequest(upload({ headers: { 'sec-fetch-site': 'cross-site' } }), ctx)).toMatchObject({
      action: 'reject',
      status: 403,
    });
    expect(checkRequest(upload({ headers: { cookie: undefined } }), ctx)).toMatchObject({
      action: 'reject',
      status: 401,
    });
    expect(checkRequest(upload({ headers: { origin: 'http://evil.example' } }), ctx)).toMatchObject({
      action: 'reject',
      status: 403,
    });
    expect(checkRequest(upload({ headers: { origin: undefined } }), ctx)).toMatchObject({
      action: 'reject',
      status: 403,
    });
  });
});

describe('/auth exchange (A15: single-use, 60-second codes)', () => {
  function codes(start = 1_000_000) {
    let t = start;
    const c = createAuthCodes(TOKEN, () => t);
    return { c, tick: (ms: number) => (t += ms) };
  }

  it('swaps a fresh code for an HttpOnly, SameSite=Strict, 400-day cookie, once only', () => {
    const { c } = codes();
    const code = c.mint();
    expect(code).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const r = authExchange(code, c, TOKEN, PORT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.setCookie).toContain(`${SESSION_COOKIE}=${COOKIE}`);
    expect(r.setCookie).toContain('HttpOnly');
    expect(r.setCookie).toContain('SameSite=Strict');
    expect(r.setCookie).toContain('Path=/');
    expect(r.setCookie).toContain(`Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`);
    expect(AUTH_COOKIE_MAX_AGE_SECONDS).toBe(400 * 24 * 60 * 60);
    // Built in one place, shared with the bootstrap renewal, so the two can't drift apart.
    expect(r.setCookie).toBe(sessionSetCookie(TOKEN, PORT));
    expect(authExchange(code, c, TOKEN, PORT).ok).toBe(false);
  });

  it('refuses an expired code', () => {
    const { c, tick } = codes();
    const code = c.mint();
    tick(AUTH_CODE_TTL_MS + 1);
    expect(authExchange(code, c, TOKEN, PORT).ok).toBe(false);
  });

  it('refuses a wrong or missing code, and the old long-lived token', () => {
    const { c } = codes();
    c.mint();
    expect(authExchange('wrong', c, TOKEN, PORT).ok).toBe(false);
    expect(authExchange(null, c, TOKEN, PORT).ok).toBe(false);
    expect(authExchange('', c, TOKEN, PORT).ok).toBe(false);
    expect(authExchange(TOKEN, c, TOKEN, PORT).ok).toBe(false);
  });

  it('caps the number of live codes', () => {
    const { c, tick } = codes();
    for (let i = 0; i < MAX_LIVE_CODES; i++) expect(c.mint()).not.toBeNull();
    expect(c.mint()).toBeNull();
    tick(AUTH_CODE_TTL_MS + 1);
    expect(c.mint()).not.toBeNull();
  });
});

describe('/auth/code (launcher asks for a code by proving it knows the secret)', () => {
  const NONCE = 'n0nce-abcdefghijklmnop';

  it('gives a working code for a right proof', () => {
    const c = createAuthCodes(TOKEN, () => 5);
    const r = c.issueForLauncher(NONCE, codeProof(TOKEN, NONCE));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(authExchange(r.code, c, TOKEN, PORT).ok).toBe(true);
  });

  it('refuses a wrong proof, a ping proof, a short nonce and a replayed nonce', () => {
    const c = createAuthCodes(TOKEN, () => 5);
    expect(c.issueForLauncher(NONCE, codeProof('other', NONCE)).ok).toBe(false);
    expect(c.issueForLauncher(NONCE, pingProof(TOKEN, NONCE)).ok).toBe(false);
    expect(c.issueForLauncher('short', codeProof(TOKEN, 'short')).ok).toBe(false);
    const fresh = 'another-nonce-1234567';
    expect(c.issueForLauncher(fresh, codeProof(TOKEN, fresh)).ok).toBe(true);
    expect(c.issueForLauncher(fresh, codeProof(TOKEN, fresh)).ok).toBe(false);
  });

  it('uses a proof different from the ping proof and never the secret', () => {
    expect(codeProof(TOKEN, NONCE)).not.toBe(pingProof(TOKEN, NONCE));
    expect(codeProof(TOKEN, NONCE)).not.toContain(TOKEN);
  });

  it('is reachable without a cookie but refuses anything that looks like a browser', () => {
    const path = ROUTES.authCode;
    expect(checkRequest(req({ path, headers: { cookie: undefined } }), ctx)).toEqual({ action: 'auth-code' });
    expect(
      checkRequest(req({ path, headers: { cookie: `${SESSION_COOKIE}=${COOKIE}` } }), ctx),
    ).toMatchObject({
      action: 'reject',
      status: 403,
    });
    expect(checkRequest(req({ path, headers: { cookie: undefined, origin: ORIGIN } }), ctx)).toMatchObject({
      action: 'reject',
      status: 403,
    });
    expect(
      checkRequest(req({ path, headers: { cookie: undefined, 'sec-fetch-site': 'same-origin' } }), ctx),
    ).toMatchObject({ action: 'reject', status: 403 });
    expect(
      checkRequest(req({ path, headers: { cookie: undefined, host: `localhost:${PORT}` } }), ctx),
    ).toMatchObject({
      action: 'reject',
      status: 403,
    });
  });
});

describe('security headers', () => {
  it('carries the CSP from A2 and the other headers', () => {
    expect(SECURITY_HEADERS['Content-Security-Policy']).toBe(
      "default-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('no-referrer');
    const names = Object.keys(SECURITY_HEADERS).map((h) => h.toLowerCase());
    expect(names.some((h) => h.startsWith('access-control-'))).toBe(false);
  });

  it('keeps frames to the app itself: the library viewer relies on it to stop a page leaving', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy'] ?? '';
    const directives = new Map(
      csp.split(';').map((d) => {
        const [name = '', ...values] = d.trim().split(/\s+/);
        return [name.toLowerCase(), values] as const;
      }),
    );
    expect(directives.get('default-src')).toEqual(["'self'"]);
    const frameSrc = directives.get('frame-src') ?? directives.get('child-src');
    if (frameSrc) expect(frameSrc.every((v) => v === "'self'" || v === "'none'")).toBe(true);
  });

  it('gives the library page route its own sandboxed policy', () => {
    expect(PAGE_CSP).toBe(
      "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'",
    );
    expect(isLibraryPagePath(ROUTES.libraryPage('client:acme.0123'))).toBe(true);
    expect(isLibraryPagePath('/api/library/page/')).toBe(false);
    expect(isLibraryPagePath('/api/library/text/x')).toBe(false);
    expect(isLibraryPagePath('/api/library/pages/x')).toBe(false);
    // A PDF is shown in a frame too, so its errors are a page as well.
    expect(isLibraryPagePath(ROUTES.libraryPdf('client:acme.0123'))).toBe(true);
    expect(isLibraryPagePath('/api/library/pdf/')).toBe(false);
  });

  it('caps bodies at 64 KB', () => {
    expect(MAX_BODY_BYTES).toBe(64 * 1024);
  });
});

describe('/auth/ping (is the app on this port really TDS Brain?)', () => {
  it('lets the ping through without a cookie, but still checks Host', () => {
    expect(checkRequest(req({ path: AUTH_PING_PATH, headers: { cookie: undefined } }), ctx)).toEqual({
      action: 'ping',
    });
    expect(
      checkRequest(req({ path: AUTH_PING_PATH, headers: { host: `localhost:${PORT}` } }), ctx),
    ).toMatchObject({
      action: 'reject',
      status: 403,
    });
  });

  it('answers a nonce with a proof only the holder of the launch token can make', () => {
    const proof = pingProof(TOKEN, 'abc123');
    expect(proof).toBe(pingProof(TOKEN, 'abc123'));
    expect(proof).not.toBe(pingProof('other-token', 'abc123'));
    expect(proof).not.toBe(pingProof(TOKEN, 'abc124'));
    expect(proof).not.toContain(TOKEN);
    expect(proof).not.toBe(COOKIE);
  });
});

describe('session cookie header (decision 6a)', () => {
  it('is the same value with HttpOnly, SameSite=Strict, Path=/ and a 400-day Max-Age', () => {
    expect(sessionSetCookie(TOKEN, PORT)).toBe(
      `${SESSION_COOKIE}=${COOKIE}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${400 * 24 * 60 * 60}`,
    );
  });
});

describe('public allow-list (decision 5)', () => {
  const ICONS = ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/mark.svg'];
  const signedOut = { cookie: undefined };

  it('lets exactly the listed paths and matching icons through without a session, for GET and HEAD', () => {
    expect(PUBLIC_PATHS).toEqual(['/manifest.webmanifest', '/sw.js', '/offline.html', '/offline.css']);
    for (const path of [...PUBLIC_PATHS, ...ICONS]) {
      for (const method of ['GET', 'HEAD', 'get']) {
        expect(checkRequest(req({ method, path, headers: signedOut }), ctx), `${method} ${path}`).toEqual({
          action: 'public',
        });
      }
    }
  });

  it('serves them the same way with a session', () => {
    expect(checkRequest(req({ path: '/sw.js' }), ctx)).toEqual({ action: 'public' });
  });

  it('refuses any other method with 405', () => {
    for (const path of ['/sw.js', '/icons/icon-192.png']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        expect(
          checkRequest(
            req({
              method,
              path,
              headers: { ...signedOut, origin: ORIGIN, 'content-type': 'application/json' },
            }),
            ctx,
          ),
          `${method} ${path}`,
        ).toMatchObject({ action: 'reject', status: 405 });
      }
    }
  });

  it('still checks Host and a foreign Origin first', () => {
    expect(
      checkRequest(req({ path: '/sw.js', headers: { ...signedOut, host: `localhost:${PORT}` } }), ctx),
    ).toMatchObject({ action: 'reject', status: 403 });
    expect(
      checkRequest(
        req({ path: '/manifest.webmanifest', headers: { ...signedOut, host: `evil.example:${PORT}` } }),
        ctx,
      ),
    ).toMatchObject({ action: 'reject', status: 403 });
    expect(
      checkRequest(req({ path: '/sw.js', headers: { ...signedOut, origin: 'https://evil.example' } }), ctx),
    ).toMatchObject({ action: 'reject', status: 403 });
    expect(
      checkRequest(req({ path: '/icons/icon-192.png', headers: { ...signedOut, origin: 'null' } }), ctx),
    ).toMatchObject({ action: 'reject', status: 403 });
  });

  it('lets no lookalike through: they get the signed-out page or a 401, never a public file', () => {
    const lookalikes = [
      '/sw.js/',
      '/SW.JS',
      '/Sw.js',
      '/sw.js.map',
      '/sw.jsx',
      '//sw.js',
      '/x/sw.js',
      '/offline.html?x',
      '/offline.html/',
      '/offline.htm',
      '/manifest.json',
      '/manifest.webmanifest.bak',
      '/offline.css/',
      '/icons',
      '/icons/',
      '/icons/a/b',
      '/icons/a/b.png',
      '/icons/x',
      '/icons/x.',
      '/icons/x.PNG',
      '/icons/X.png',
      '/icons/x.jpg',
      '/icons/x.png/',
      '/icons/x.png.html',
      '/icons/.png',
      '/icons/x_y.png',
      '/icons/x.y.png',
      '/icons/x.png\n',
      '/icons/../api/x',
      '/icons/%2e%2e/x',
      '/icons/%2e%2e/api/x.png',
      '/icons/..%2fapi%2fx.png',
      '/icons/x%2epng',
      '/ICONS/x.png',
      '/api/sw.js',
      '/sw.js%00',
      '/sw.js;x',
    ];
    for (const path of lookalikes) {
      const d = checkRequest(req({ path, headers: signedOut }), ctx);
      expect(d.action, path).not.toBe('public');
      expect(['launcher', 'reject'], path).toContain(d.action);
    }
  });
});

describe('a planted service worker (Service-Worker: script)', () => {
  const sw = { 'service-worker': 'script' };

  it('gets the self-unregistering worker for any other path, with or without a session', () => {
    for (const path of [
      '/x.js',
      '/',
      '/api/x.js',
      '/assets/app.js',
      '/icons/icon-192.png',
      '/offline.html',
    ]) {
      expect(checkRequest(req({ path, headers: { ...sw, cookie: undefined } }), ctx), path).toEqual({
        action: 'unregister-worker',
      });
      expect(checkRequest(req({ path, headers: sw }), ctx), path).toEqual({ action: 'unregister-worker' });
    }
  });

  it('leaves /sw.js as it is', () => {
    expect(checkRequest(req({ path: '/sw.js', headers: { ...sw, cookie: undefined } }), ctx)).toEqual({
      action: 'public',
    });
  });

  it('without the header, still needs a session', () => {
    expect(checkRequest(req({ path: '/x.js', headers: { cookie: undefined } }), ctx)).toEqual({
      action: 'launcher',
    });
  });

  it('only for GET, and still behind the Host and Origin checks', () => {
    expect(
      checkRequest(req({ path: '/x.js', headers: { ...sw, host: `evil.example:${PORT}` } }), ctx),
    ).toMatchObject({ action: 'reject', status: 403 });
    expect(
      checkRequest(req({ path: '/x.js', headers: { ...sw, origin: 'https://evil.example' } }), ctx),
    ).toMatchObject({ action: 'reject', status: 403 });
    expect(
      checkRequest(req({ method: 'HEAD', path: '/x.js', headers: { ...sw, cookie: undefined } }), ctx),
    ).toEqual({ action: 'launcher' });
    expect(
      checkRequest(req({ path: '/x.js', headers: { 'service-worker': 'other', cookie: undefined } }), ctx),
    ).toEqual({
      action: 'launcher',
    });
  });
});

describe('session cookie name per port (a test copy never signs the live app out)', () => {
  it('keeps the original name on the default port and adds the port everywhere else', () => {
    expect(sessionCookieName(3877)).toBe(SESSION_COOKIE);
    expect(sessionCookieName(3899)).toBe(`${SESSION_COOKIE}_3899`);
    expect(sessionSetCookie(TOKEN, 3899)).toMatch(new RegExp(`^${SESSION_COOKIE}_3899=${COOKIE};`));
  });

  it('accepts only the cookie named for its own port', () => {
    const live = `${SESSION_COOKIE}=${COOKIE}`;
    const test = `${SESSION_COOKIE}_3899=${COOKIE}`;
    expect(hasValidSession(live, TOKEN, 3877)).toBe(true);
    expect(hasValidSession(live, TOKEN, 3899)).toBe(false);
    expect(hasValidSession(test, TOKEN, 3899)).toBe(true);
    expect(hasValidSession(test, TOKEN, 3877)).toBe(false);
    // The browser sends both when both copies have been signed into; each picks its own.
    expect(hasValidSession(`${test}; ${SESSION_COOKIE}=other`, TOKEN, 3899)).toBe(true);
    expect(hasValidSession(`${live}; ${SESSION_COOKIE}_3899=other`, TOKEN, 3877)).toBe(true);
  });

  it("signs in on another port with that port's cookie", () => {
    const c = createAuthCodes(TOKEN, () => 5);
    const r = authExchange(c.mint(), c, TOKEN, 3899);
    expect(r.ok && r.setCookie.startsWith(`${SESSION_COOKIE}_3899=`)).toBe(true);
  });
});
