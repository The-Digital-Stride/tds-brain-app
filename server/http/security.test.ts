import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTES, SESSION_COOKIE } from '../../shared/contract.ts';
import {
  AUTH_CODE_TTL_MS,
  AUTH_COOKIE_MAX_AGE,
  AUTH_PING_PATH,
  authExchange,
  checkRequest,
  codeProof,
  cookieValueFor,
  createAuthCodes,
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

describe('/auth exchange (A15: single-use, 60-second codes)', () => {
  function codes(start = 1_000_000) {
    let t = start;
    const c = createAuthCodes(TOKEN, () => t);
    return { c, tick: (ms: number) => (t += ms) };
  }

  it('swaps a fresh code for an HttpOnly, SameSite=Strict, 30-day cookie, once only', () => {
    const { c } = codes();
    const code = c.mint();
    expect(code).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const r = authExchange(code, c, TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.setCookie).toContain(`${SESSION_COOKIE}=${COOKIE}`);
    expect(r.setCookie).toContain('HttpOnly');
    expect(r.setCookie).toContain('SameSite=Strict');
    expect(r.setCookie).toContain('Path=/');
    expect(r.setCookie).toContain(`Max-Age=${AUTH_COOKIE_MAX_AGE}`);
    expect(AUTH_COOKIE_MAX_AGE).toBe(30 * 24 * 60 * 60);
    expect(authExchange(code, c, TOKEN).ok).toBe(false);
  });

  it('refuses an expired code', () => {
    const { c, tick } = codes();
    const code = c.mint();
    tick(AUTH_CODE_TTL_MS + 1);
    expect(authExchange(code, c, TOKEN).ok).toBe(false);
  });

  it('refuses a wrong or missing code, and the old long-lived token', () => {
    const { c } = codes();
    c.mint();
    expect(authExchange('wrong', c, TOKEN).ok).toBe(false);
    expect(authExchange(null, c, TOKEN).ok).toBe(false);
    expect(authExchange('', c, TOKEN).ok).toBe(false);
    expect(authExchange(TOKEN, c, TOKEN).ok).toBe(false);
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
    expect(authExchange(r.code, c, TOKEN).ok).toBe(true);
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
