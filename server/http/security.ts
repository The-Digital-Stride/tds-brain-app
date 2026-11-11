/**
 * The app's request gate (decision 12, amendments A2 and A7). Pure functions only, so every rule
 * can be tested without a socket.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { APP_HOST, type ApiErrorCode, ROUTES, SESSION_COOKIE } from '../../shared/contract.ts';

export const MAX_BODY_BYTES = 64 * 1024;
export const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
/** Launcher-only: lets `pnpm start` check that the app already on the port is really this one. */
export const AUTH_PING_PATH = '/auth/ping';

/** Sent on every page and API reply. No CORS headers are ever sent. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export type HeaderBag = Record<string, string | string[] | undefined>;

export interface GateRequest {
  method: string;
  /** The path only, without the query string. */
  path: string;
  headers: HeaderBag;
}

export interface GateContext {
  port: number;
  launchToken: string;
}

export type GateDecision =
  | { action: 'allow' }
  /** `/auth`: the handler checks the token itself. */
  | { action: 'auth' }
  /** `/auth/ping?nonce=…`: answer with `pingProof`, so the launcher never sends the token to another app. */
  | { action: 'ping' }
  /** `/auth/code?nonce=…&proof=…`: the launcher asks for a one-time code (A15). */
  | { action: 'auth-code' }
  /** A page visit without a session: show the plain "open it from the launcher" page. */
  | { action: 'launcher' }
  | { action: 'reject'; status: number; code: ApiErrorCode; message: string };

const CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function header(headers: HeaderBag, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `${APP_HOST}:${port}`;
}

export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  return origin === `http://${APP_HOST}:${port}`;
}

export function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const media = contentType.split(';')[0]?.trim().toLowerCase();
  return media === 'application/json';
}

/**
 * The cookie value is derived from the launch token, so the token in the launch URL (which can sit in
 * browser history) is never itself a working cookie.
 */
export function cookieValueFor(launchToken: string): string {
  return createHash('sha256').update(`tds-brain-app/session-cookie/v1:${launchToken}`).digest('base64url');
}

/** Constant-time string compare: both sides are hashed to fixed-length digests first. */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name || !value) continue;
    out[name] = value;
  }
  return out;
}

export function hasValidSession(cookieHeader: string | undefined, launchToken: string): boolean {
  const got = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!got) return false;
  return safeEqual(got, cookieValueFor(launchToken));
}

function reject(status: number, code: ApiErrorCode, message: string): GateDecision {
  return { action: 'reject', status, code, message };
}

/**
 * Decide what to do with a request before any route runs. Order matters: Host first (defeats DNS
 * rebinding), then any foreign Origin, then the session cookie, then the rules for changing requests.
 */
export function checkRequest(req: GateRequest, ctx: GateContext): GateDecision {
  const method = req.method.toUpperCase();
  const isApi = req.path === '/api' || req.path.startsWith('/api/');

  if (!isAllowedHost(header(req.headers, 'host'), ctx.port)) {
    return reject(403, 'forbidden', `Open TDS Brain at http://${APP_HOST}:${ctx.port} from its launcher.`);
  }

  const origin = header(req.headers, 'origin');
  if (origin !== undefined && !isAllowedOrigin(origin, ctx.port)) {
    return reject(403, 'forbidden', 'That request came from another website or app, so it was refused.');
  }

  const fetchSite = header(req.headers, 'sec-fetch-site');
  if (isApi && fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return reject(403, 'forbidden', 'That request came from another website or app, so it was refused.');
  }

  if (req.path === AUTH_PING_PATH) {
    return method === 'GET'
      ? { action: 'ping' }
      : reject(405, 'bad-request', 'That is not something this page does.');
  }

  if (req.path === ROUTES.authCode) {
    // Launcher only: a browser always sends one of these, the launcher never does.
    const cookie = header(req.headers, 'cookie');
    if (origin !== undefined || fetchSite !== undefined || cookie !== undefined) {
      return reject(403, 'forbidden', 'That request came from another website or app, so it was refused.');
    }
    return method === 'GET'
      ? { action: 'auth-code' }
      : reject(405, 'bad-request', 'That is not something this page does.');
  }

  if (req.path === ROUTES.auth) {
    return method === 'GET'
      ? { action: 'auth' }
      : reject(405, 'bad-request', 'That is not something this page does.');
  }

  if (!hasValidSession(header(req.headers, 'cookie'), ctx.launchToken)) {
    if (!isApi && (method === 'GET' || method === 'HEAD')) return { action: 'launcher' };
    return reject(401, 'unauthorised', 'Open TDS Brain from its launcher to sign in to the app.');
  }

  if (CHANGING_METHODS.has(method)) {
    if (!isAllowedOrigin(origin, ctx.port)) {
      return reject(403, 'forbidden', 'That request came from another website or app, so it was refused.');
    }
    if (!isJsonContentType(header(req.headers, 'content-type'))) {
      return reject(
        415,
        'bad-request',
        'The app sent that in the wrong format. Reload the page and try again.',
      );
    }
  }

  return { action: 'allow' };
}

export const AUTH_CODE_TTL_MS = 60_000;
export const MAX_LIVE_CODES = 20;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_SEEN_NONCES = 200;

/** The launcher's proof for `/auth/code`: an HMAC of the secret over the nonce, never the secret itself. */
export function codeProof(secret: string, nonce: string): string {
  return createHmac('sha256', secret).update(`tds-brain-app/auth-code/v1:${nonce}`).digest('base64url');
}

export type IssueResult =
  | { ok: true; code: string }
  | { ok: false; status: number; code: ApiErrorCode; message: string };

/** Single-use sign-in codes, held in memory only (A15). */
export interface AuthCodes {
  /** A new code valid for 60 seconds, or null when too many are already live. */
  mint(): string | null;
  /** True once for a live code; the code is used up either way it matches. */
  redeem(code: string | null | undefined): boolean;
  /** `/auth/code`: a code for a launcher that proves it knows the secret with a fresh nonce. */
  issueForLauncher(nonce: string | null | undefined, proof: string | null | undefined): IssueResult;
}

export function createAuthCodes(secret: string, now: () => number = Date.now): AuthCodes {
  const live = new Map<string, number>();
  const seenNonces = new Map<string, number>();

  function prune(): void {
    const t = now();
    for (const [code, expires] of live) if (expires <= t) live.delete(code);
    for (const [nonce, seen] of seenNonces) if (seen + AUTH_CODE_TTL_MS <= t) seenNonces.delete(nonce);
  }

  function mint(): string | null {
    prune();
    if (live.size >= MAX_LIVE_CODES) return null;
    const code = randomBytes(24).toString('base64url');
    live.set(code, now() + AUTH_CODE_TTL_MS);
    return code;
  }

  return {
    mint,
    redeem(code) {
      if (!code) return false;
      prune();
      // Compare against every live code in constant time; no early exit.
      let match: string | null = null;
      for (const candidate of live.keys()) {
        if (safeEqual(code, candidate)) match = candidate;
      }
      if (match === null) return false;
      live.delete(match);
      return true;
    },
    issueForLauncher(nonce, proof) {
      const refuse = (status: number, code: ApiErrorCode, message: string): IssueResult => ({
        ok: false,
        status,
        code,
        message,
      });
      prune();
      if (!nonce || !proof || !NONCE_PATTERN.test(nonce)) {
        return refuse(400, 'bad-request', 'That sign-in request was not understood.');
      }
      if (!safeEqual(proof, codeProof(secret, nonce))) {
        return refuse(403, 'forbidden', 'That sign-in request was refused.');
      }
      if (seenNonces.has(nonce) || seenNonces.size >= MAX_SEEN_NONCES) {
        return refuse(403, 'forbidden', 'That sign-in request was refused.');
      }
      seenNonces.set(nonce, now());
      const code = mint();
      if (!code) return refuse(429, 'busy', 'Too many sign-in requests. Wait a minute and try again.');
      return { ok: true, code };
    },
  };
}

export type AuthResult = { ok: true; setCookie: string } | { ok: false };

/** `/auth?code=…`: swap a single-use code for the session cookie. The cookie is unchanged from before. */
export function authExchange(code: string | null | undefined, codes: AuthCodes, secret: string): AuthResult {
  if (!codes.redeem(code)) return { ok: false };
  const setCookie = `${SESSION_COOKIE}=${cookieValueFor(secret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${AUTH_COOKIE_MAX_AGE}`;
  return { ok: true, setCookie };
}

/** Proves knowledge of the launch token for a nonce, without revealing the token or the cookie. */
export function pingProof(launchToken: string, nonce: string): string {
  return createHmac('sha256', launchToken).update(`tds-brain-app/ping/v1:${nonce}`).digest('base64url');
}
