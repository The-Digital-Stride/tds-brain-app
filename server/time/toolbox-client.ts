/**
 * Calls to TDS Toolbox's time routes (plan 2026-11-28-time-my-day, overseer 25; Toolbox
 * `docs/architecture/time-tool.md`). Server-side only: the token never leaves this process.
 *
 * Every call: `redirect: 'error'`, a 10 s timeout, a 2 MB cap on the answer (read from the stream),
 * `Accept: application/json`, no cookies. Authenticated calls send `Authorization: Bearer` from the
 * `TokenStore`. Only a 401 reports the connection lost; 404 (the tool is off), 403, 429 and 5xx leave it.
 *
 * Never logs bodies, tokens, codes or verifiers.
 */
import type {
  DayErrorCode,
  DayProblem,
  DayResult,
  StoredDay,
  StoredEntry,
  TokenAnswer,
  TokenStore,
  ToolboxCall,
  ToolboxClient,
  ToolboxErrorCode,
  WireWorkItem,
} from '../../shared/time-contract.ts';

export const TOOLBOX_TIMEOUT_MS = 10_000;
export const TOOLBOX_MAX_ANSWER_BYTES = 2 * 1024 * 1024;

const TOKEN_PATTERN = /^tds_time_[0-9a-f]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_ERRORS: ReadonlySet<string> = new Set<ToolboxErrorCode>([
  'invalid_request',
  'invalid_grant',
  'access_denied',
  'too_many_connections',
  'too_large',
  'rate_limited',
  'unauthorised',
  'forbidden',
  'not_found',
  'server_error',
]);
const DAY_ERROR_CODES: ReadonlySet<string> = new Set<DayErrorCode>([
  'invalid',
  'forbidden',
  'conflict',
  'locked',
]);
/** Statuses whose `{ ok }` body is a `DayResult` (Toolbox `POST /api/time/days`). */
const DAY_RESULT_STATUSES = new Set([200, 400, 403, 409, 423]);
const WORK_ITEM_KINDS = new Set(['retainer', 'project', 'internal']);

/** Why the client reports the connection lost: a 401, or no token in the Keychain for a live connection. */
export type UnauthorisedCause = 'unauthorised' | 'missing-token';

export interface ToolboxClientDeps {
  fetch?: typeof fetch;
  tokens: TokenStore;
  /** The connected Toolbox origin (`Connection.connectedOrigin`), or null when not connected. */
  origin: () => string | null;
  /** Called (and awaited) on a 401 from an authenticated call, or when the token is missing. */
  onUnauthorised?: (cause: UnauthorisedCause) => void | Promise<void>;
  timeoutMs?: number;
  maxBytes?: number;
  log?: (line: string) => void;
}

/** `ToolboxClient` plus a revoke for a token the caller names (Disconnect, and undoing a connect). */
export interface TimeToolboxClient extends ToolboxClient {
  revokeToken(origin: string, token: string): Promise<ToolboxCall<void>>;
}

type Failure = Extract<ToolboxCall<never>, { ok: false }>;
/** An HTTP answer that was read in full (`answered`), or a failure before one. */
type Answer = { answered: true; status: number; body: unknown } | Failure;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function errorCode(v: unknown): ToolboxErrorCode {
  return typeof v === 'string' && KNOWN_ERRORS.has(v) ? (v as ToolboxErrorCode) : 'server_error';
}

/** The usual mapping for a status that isn't the success the caller wanted. */
function failureFor(status: number, body: unknown): Failure {
  if (status === 401) return { ok: false, kind: 'unauthorised' };
  if (status === 404) return { ok: false, kind: 'off' };
  if (status === 403) return { ok: false, kind: 'forbidden' };
  if (status === 429) return { ok: false, kind: 'rate-limited' };
  if (status === 413) return { ok: false, kind: 'too-large' };
  if (status >= 500) return { ok: false, kind: 'server' };
  if (status >= 400 && isRecord(body)) {
    if (typeof body.error === 'string')
      return { ok: false, kind: 'error', code: errorCode(body.error), status };
    if (body.ok === false && typeof body.code === 'string') {
      const code: ToolboxErrorCode =
        body.code === 'invalid'
          ? 'invalid_request'
          : body.code === 'forbidden'
            ? 'forbidden'
            : 'server_error';
      return { ok: false, kind: 'error', code, status };
    }
  }
  return { ok: false, kind: 'server' };
}

function isIsoInstant(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
}

function nullableString(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

function tokenAnswer(body: unknown): TokenAnswer | null {
  if (!isRecord(body)) return null;
  const { token, tokenType, expiresAt, connectionId } = body;
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token) || tokenType !== 'Bearer') return null;
  if (!isIsoInstant(expiresAt)) return null;
  if (typeof connectionId !== 'string' || connectionId === '' || connectionId.length > 200) return null;
  return { token, tokenType, expiresAt, connectionId };
}

function workItem(v: unknown): WireWorkItem | null {
  if (!isRecord(v)) return null;
  const { id, name, kind, cortexKey, clientId } = v;
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') return null;
  if (typeof kind !== 'string' || !WORK_ITEM_KINDS.has(kind)) return null;
  if (!nullableString(cortexKey) || !nullableString(clientId)) return null;
  return { id, name, kind: kind as WireWorkItem['kind'], cortexKey, clientId };
}

function storedEntry(v: unknown): StoredEntry | null {
  if (!isRecord(v)) return null;
  const e = v;
  if (typeof e.id !== 'string' || !nullableString(e.startAt) || typeof e.minutes !== 'number') return null;
  if (!Number.isInteger(e.minutes) || !nullableString(e.workItemId) || typeof e.description !== 'string') {
    return null;
  }
  if (typeof e.billable !== 'boolean' || typeof e.source !== 'string' || typeof e.certainty !== 'string')
    return null;
  if (typeof e.personId !== 'string' || typeof e.workDate !== 'string' || typeof e.deleted !== 'boolean')
    return null;
  return {
    id: e.id,
    startAt: e.startAt,
    minutes: e.minutes,
    workItemId: e.workItemId,
    description: e.description,
    billable: e.billable,
    source: e.source as StoredEntry['source'],
    certainty: e.certainty as StoredEntry['certainty'],
    personId: e.personId,
    workDate: e.workDate,
    deleted: e.deleted,
  };
}

function storedDay(body: unknown): StoredDay | null {
  const day = isRecord(body) && body.ok === true ? body.day : null;
  if (!isRecord(day)) return null;
  const { personId, workDate, revision, entries } = day;
  if (typeof personId !== 'string' || typeof workDate !== 'string' || !Array.isArray(entries)) return null;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return null;
  const parsed: StoredEntry[] = [];
  for (const e of entries) {
    const one = storedEntry(e);
    if (one === null) return null;
    parsed.push(one);
  }
  return { personId, workDate, revision, entries: parsed };
}

function dayResult(body: unknown): DayResult | null {
  if (!isRecord(body)) return null;
  if (body.ok === true) {
    const { revision, repeated } = body;
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) return null;
    if (typeof repeated !== 'boolean') return null;
    return { ok: true, revision, repeated };
  }
  if (body.ok === false) {
    if (typeof body.code !== 'string' || !DAY_ERROR_CODES.has(body.code)) return null;
    const problems: DayProblem[] = [];
    if (Array.isArray(body.problems)) {
      for (const p of body.problems) {
        if (isRecord(p) && typeof p.path === 'string' && typeof p.message === 'string') {
          problems.push({ path: p.path, message: p.message });
        }
      }
    }
    return { ok: false, code: body.code as DayErrorCode, problems };
  }
  return null;
}

/** The body as text, or null when it passes `max` bytes. Throws on a network error or timeout. */
async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = res.headers.get('content-length');
  if (declared !== null && Number(declared) > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createToolboxClient(deps: ToolboxClientDeps): TimeToolboxClient {
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? TOOLBOX_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? TOOLBOX_MAX_ANSWER_BYTES;
  const log = deps.log ?? (() => {});

  async function send(
    name: string,
    origin: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    token: string | null,
    body?: unknown,
  ): Promise<Answer> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const res = await doFetch(new URL(path, origin), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await readCapped(res, maxBytes);
      if (text === null) {
        log(`Toolbox ${name}: the answer was too large.`);
        return { ok: false, kind: 'too-large' };
      }
      let parsed: unknown = null;
      try {
        parsed = text === '' ? null : JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      return { answered: true, status: res.status, body: parsed };
    } catch {
      log(`Toolbox ${name}: could not be reached.`);
      return { ok: false, kind: 'network' };
    }
  }

  async function lostBy(cause: UnauthorisedCause): Promise<void> {
    try {
      await deps.onUnauthorised?.(cause);
    } catch {
      log('Could not mark the Toolbox connection lost.');
    }
  }

  /** An authenticated call with the stored token; a 401 marks the connection lost. */
  async function authed(
    name: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<Answer> {
    const origin = deps.origin();
    if (origin === null) return { ok: false, kind: 'unauthorised' };
    let token: string | null;
    try {
      token = await deps.tokens.read(origin);
    } catch {
      // The Keychain didn't answer: nothing left this Mac, and the connection stays.
      log(`Toolbox ${name}: the Keychain could not be read.`);
      return { ok: false, kind: 'network' };
    }
    if (token === null) {
      await lostBy('missing-token');
      return { ok: false, kind: 'unauthorised' };
    }
    const answer = await send(name, origin, method, path, token, body);
    if ('answered' in answer && answer.status === 401) {
      log(`Toolbox ${name}: the connection was refused.`);
      await lostBy('unauthorised');
      return { ok: false, kind: 'unauthorised' };
    }
    return answer;
  }

  async function revokeWith(origin: string, token: string): Promise<ToolboxCall<void>> {
    const answer = await send('revoke', origin, 'DELETE', '/api/time/token', token);
    if (!('answered' in answer)) return answer;
    if (answer.status >= 200 && answer.status < 300) return { ok: true, value: undefined };
    return failureFor(answer.status, answer.body);
  }

  return {
    async exchange(origin, code, codeVerifier) {
      const answer = await send('exchange', origin, 'POST', '/api/time/token', null, { code, codeVerifier });
      if (!('answered' in answer)) return answer;
      if (answer.status === 200) {
        const value = tokenAnswer(answer.body);
        return value ? { ok: true, value } : { ok: false, kind: 'server' };
      }
      // Unauthenticated: a 4xx `{ error }` is the exchange's own refusal (invalid_grant, access_denied, …).
      if (answer.status !== 404 && answer.status >= 400 && answer.status < 500) {
        if (isRecord(answer.body) && typeof answer.body.error === 'string') {
          return { ok: false, kind: 'error', code: errorCode(answer.body.error), status: answer.status };
        }
      }
      return failureFor(answer.status, answer.body);
    },

    async revoke() {
      const answer = await authed('revoke', 'DELETE', '/api/time/token');
      if (!('answered' in answer)) return answer;
      if (answer.status >= 200 && answer.status < 300) return { ok: true, value: undefined };
      return failureFor(answer.status, answer.body);
    },

    revokeToken: revokeWith,

    async workItems() {
      const answer = await authed('work-items', 'GET', '/api/time/work-items');
      if (!('answered' in answer)) return answer;
      if (answer.status !== 200) return failureFor(answer.status, answer.body);
      const items = isRecord(answer.body) ? answer.body.items : null;
      if (!Array.isArray(items)) return { ok: false, kind: 'server' };
      const value: WireWorkItem[] = [];
      for (const raw of items) {
        const item = workItem(raw);
        if (item) value.push(item);
      }
      return { ok: true, value };
    },

    async readDay(workDate) {
      if (!DATE_PATTERN.test(workDate))
        return { ok: false, kind: 'error', code: 'invalid_request', status: 0 };
      const answer = await authed('read-day', 'GET', `/api/time/days/${workDate}`);
      if (!('answered' in answer)) return answer;
      if (answer.status !== 200) return failureFor(answer.status, answer.body);
      const value = storedDay(answer.body);
      return value ? { ok: true, value } : { ok: false, kind: 'server' };
    },

    async submitDay(body) {
      const answer = await authed('submit-day', 'POST', '/api/time/days', body);
      if (!('answered' in answer)) return answer;
      if (
        DAY_RESULT_STATUSES.has(answer.status) &&
        isRecord(answer.body) &&
        typeof answer.body.ok === 'boolean'
      ) {
        const value = dayResult(answer.body);
        return value ? { ok: true, value } : { ok: false, kind: 'server' };
      }
      return failureFor(answer.status, answer.body);
    },
  };
}
