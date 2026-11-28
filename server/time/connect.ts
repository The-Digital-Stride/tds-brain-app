/**
 * "Connect to Toolbox" (plan 2026-11-28-time-my-day, decisions 3 and 4): PKCE with a loopback callback.
 *
 * Pressing Connect makes a 32-byte verifier, its S256 challenge and a 32-byte `state`, kept in memory only,
 * one pending connect at a time (a new Connect replaces the old), for 10 minutes. Toolbox sends the browser
 * to `GET /toolbox-callback?code=&state=`; the state is compared in constant time and, when it matches, used
 * up on the spot whatever happens next. A wrong or missing state leaves the pending connect alone, so a
 * stray or forged link can't cancel a real one.
 *
 * Never logs the verifier, the state, the code or the token.
 */
import { createHash, randomBytes } from 'node:crypto';
import type {
  CallbackOutcome,
  ConnectAnswer,
  TokenAnswer,
  ToolboxClient,
} from '../../shared/time-contract.ts';
import { safeEqual } from '../http/security.ts';

export const CONNECT_TTL_MS = 10 * 60 * 1000;
export const CONNECT_PATH = '/time-connect';
export const MAX_DEVICE_LABEL = 60;
const MIN_PORT = 1024;
const MAX_PORT = 65535;
const CODE_PATTERN = /^[0-9a-f]{64}$/;
const LABEL_PREFIX = 'TDS Cortex on ';
const LABEL_SUFFIX = "'s Mac";
const LABEL_FALLBACK = 'TDS Cortex on this Mac';
/** Control characters and direction marks or overrides, which Toolbox refuses in a device label. */
const UNSAFE_LABEL_CHARS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
  /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g;

/** RFC 7636 verifier: 32 random bytes as base64url (43 characters). */
export function newVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** S256: base64url(sha256(verifier)), exactly 43 characters. */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function newState(): string {
  return randomBytes(32).toString('base64url');
}

/** `TDS Cortex on <first name>'s Mac`, at most 60 characters, with nothing that could disguise it. */
export function deviceLabel(name: string | null | undefined): string {
  const cleaned = (name ?? '').replace(UNSAFE_LABEL_CHARS, '').trim();
  const first = cleaned.split(/\s+/)[0] ?? '';
  if (first === '') return LABEL_FALLBACK;
  const room = MAX_DEVICE_LABEL - [...LABEL_PREFIX].length - [...LABEL_SUFFIX].length;
  const short = [...first].slice(0, room).join('');
  return `${LABEL_PREFIX}${short}${LABEL_SUFFIX}`;
}

export interface ConnectParams {
  port: number;
  state: string;
  codeChallenge: string;
  device: string;
}

/** `<origin>/time-connect?port=&state=&code_challenge=&device=`, each once, per Toolbox's rules. */
export function connectUrl(origin: string, params: ConnectParams): string {
  if (!Number.isInteger(params.port) || params.port < MIN_PORT || params.port > MAX_PORT) {
    throw new Error('connectUrl: the app port is outside 1024 to 65535');
  }
  const url = new URL(CONNECT_PATH, origin);
  url.searchParams.set('port', String(params.port));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('device', params.device);
  return url.toString();
}

export interface ConnectFlowDeps {
  /** The port Cortex listens on, where Toolbox sends the browser back. */
  port: number;
  exchange: ToolboxClient['exchange'];
  /** Saves the new token and the connection record (`Connection.save`). Throws if either fails. */
  save: (origin: string, answer: TokenAnswer) => Promise<void>;
  /** Best effort, for a token that couldn't be kept. */
  revokeToken: (origin: string, token: string) => Promise<unknown>;
  now?: () => number;
  log?: (line: string) => void;
}

export interface ConnectFlow {
  /** A new pending connect for `origin` (replacing any other) and the URL to open. */
  start(origin: string, personName: string | null): ConnectAnswer;
  hasPending(): boolean;
  cancel(): void;
  /** `GET /toolbox-callback` (decision 4). */
  callback(query: URLSearchParams): Promise<CallbackOutcome>;
}

interface Pending {
  origin: string;
  state: string;
  verifier: string;
  startedAt: number;
}

function single(query: URLSearchParams, name: string): string | null {
  const values = query.getAll(name);
  return values.length === 1 ? (values[0] as string) : null;
}

export function createConnectFlow(deps: ConnectFlowDeps): ConnectFlow {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  let pending: Pending | null = null;

  const fail = (reason: Extract<CallbackOutcome, { ok: false }>['reason']): CallbackOutcome => ({
    ok: false,
    reason,
  });

  return {
    start(origin, personName) {
      const verifier = newVerifier();
      const state = newState();
      const url = connectUrl(origin, {
        port: deps.port,
        state,
        codeChallenge: challengeFor(verifier),
        device: deviceLabel(personName),
      });
      pending = { origin, state, verifier, startedAt: now() };
      return { url };
    },

    hasPending() {
      return pending !== null && now() - pending.startedAt <= CONNECT_TTL_MS;
    },

    cancel() {
      pending = null;
    },

    async callback(query) {
      // Everything up to `pending = null` runs before the first await, so two callbacks can't both match.
      const state = single(query, 'state');
      const current = pending;
      if (state === null || state === '' || current === null || !safeEqual(state, current.state)) {
        return fail('state');
      }
      pending = null;
      if (now() - current.startedAt > CONNECT_TTL_MS) return fail('expired');
      if (query.has('error')) return fail('denied');
      const code = single(query, 'code');
      if (code === null || !CODE_PATTERN.test(code)) return fail('exchange');

      let result: Awaited<ReturnType<ToolboxClient['exchange']>>;
      try {
        result = await deps.exchange(current.origin, code, current.verifier);
      } catch {
        return fail('exchange');
      }
      if (!result.ok) {
        if (result.kind === 'error' && result.code === 'too_many_connections') return fail('too-many');
        if (result.kind === 'error' && result.code === 'access_denied') return fail('denied');
        log(`Connecting to Toolbox failed (${result.kind === 'error' ? result.code : result.kind}).`);
        return fail('exchange');
      }
      try {
        await deps.save(current.origin, result.value);
      } catch {
        log('Could not keep the Toolbox key in the Keychain, so the connection was undone.');
        try {
          await deps.revokeToken(current.origin, result.value.token);
        } catch {
          // Best effort: the token expires on its own.
        }
        return fail('storage');
      }
      log('Connected to Toolbox.');
      return { ok: true };
    },
  };
}
