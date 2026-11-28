/**
 * The connection to TDS Toolbox (plan 2026-11-28-time-my-day, decisions 2 and 5): which address is in use,
 * the connection record `<dataDir>/time/connection.json` (never the token: that is in the Keychain), the
 * state the screen shows, disconnecting and losing the connection.
 *
 * Only a 401 marks the connection lost (overseer 25); every other failure leaves it alone.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppSettings } from '../../shared/install-contract.ts';
import {
  type ConnectionFile,
  type ConnectionState,
  TIME_CONNECTION_FILE,
  TIME_DIR,
  type TimeStatus,
  type TokenAnswer,
  type TokenStore,
} from '../../shared/time-contract.ts';

/** "Reconnect soon" shows from this many days before the token expires. */
export const RECONNECT_SOON_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ToolboxAddress = TimeStatus['address'];
export type LostReason = Extract<ConnectionState, { state: 'lost' }>['reason'];

/** The shape before `URL` sees it: a scheme, a host part with no path, query, fragment or user, and at most one `/`. */
const ORIGIN_SHAPE = /^https?:\/\/[^/?#@\\\s]+\/?$/i;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * A Toolbox address as an origin (decision 2), or null. Accepted: `https://<host>[:port]`, or
 * `http://localhost:<port>` / `http://127.0.0.1:<port>`. No path (one trailing `/` is dropped), query,
 * fragment or credentials.
 */
export function parseToolboxOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  // Control characters (including newlines and DEL) never belong in an address.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  if (text === '' || /[\u0000-\u001f\u007f-\u009f]/.test(text) || !ORIGIN_SHAPE.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null;
  if (url.pathname !== '/' || url.hostname === '') return null;
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) && url.port !== '') return url.origin;
  return null;
}

/** `TDS_TOOLBOX_URL` wins (even when it is not a valid address), then `settings.toolboxUrl`, then none. */
export function resolveToolboxAddress(
  env: Record<string, string | undefined>,
  settings: AppSettings,
): ToolboxAddress {
  const fromEnv = env.TDS_TOOLBOX_URL?.trim();
  if (fromEnv) return { url: parseToolboxOrigin(fromEnv), source: 'env' };
  const fromSettings = parseToolboxOrigin(settings.toolboxUrl);
  if (fromSettings) return { url: fromSettings, source: 'settings' };
  return { url: null, source: 'default' };
}

function connectionPath(dataDir: string): string {
  return join(dataDir, TIME_CONNECTION_FILE);
}

function isIsoInstant(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
}

/** `<dataDir>/time/connection.json`, or null when missing, unreadable or not a `ConnectionFile`. */
export function readConnectionFile(dataDir: string): ConnectionFile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(connectionPath(dataDir), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const f = parsed as Record<string, unknown>;
    if (f.version !== 1) return null;
    const origin = parseToolboxOrigin(f.origin);
    if (origin === null || origin !== f.origin) return null;
    if (typeof f.connectionId !== 'string' || f.connectionId === '' || f.connectionId.length > 200)
      return null;
    if (!isIsoInstant(f.expiresAt) || !isIsoInstant(f.connectedAt)) return null;
    return {
      version: 1,
      origin,
      connectionId: f.connectionId,
      expiresAt: f.expiresAt,
      connectedAt: f.connectedAt,
    };
  } catch {
    return null;
  }
}

/** Atomic (temp file renamed over the old one), like `server/settings.ts`. File 0600; `time/` 0700. */
export function writeConnectionFile(dataDir: string, file: ConnectionFile): void {
  const dir = join(dataDir, TIME_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const target = connectionPath(dataDir);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, target);
  chmodSync(target, 0o600);
}

export function removeConnectionFile(dataDir: string): void {
  rmSync(connectionPath(dataDir), { force: true });
}

export interface StateInput {
  /** The address in use, or null. */
  origin: string | null;
  file: ConnectionFile | null;
  pending: boolean;
  /** Set when a 401 (or a missing Keychain item) ended the connection in this run. */
  lost: { origin: string; reason: LostReason } | null;
  now: Date;
}

/** Pure: what the screen shows about the connection. */
export function connectionState(input: StateInput): ConnectionState {
  const { origin, file, pending, lost, now } = input;
  if (origin === null) return { state: 'no-address' };
  const ours = file !== null && file.origin === origin ? file : null;
  const expiresMs = ours ? Date.parse(ours.expiresAt) : Number.NaN;
  if (ours && expiresMs > now.getTime()) {
    return {
      state: 'connected',
      origin,
      expiresAt: ours.expiresAt,
      reconnectSoon: expiresMs - now.getTime() <= RECONNECT_SOON_DAYS * DAY_MS,
    };
  }
  if (pending) return { state: 'not-connected', origin, pending: true };
  if (lost && lost.origin === origin) return { state: 'lost', origin, reason: lost.reason };
  if (ours) return { state: 'lost', origin, reason: 'expired' };
  return { state: 'not-connected', origin, pending: false };
}

export interface ConnectionDeps {
  dataDir: string;
  env: Record<string, string | undefined>;
  /** Read afresh each time (Settings can change the address). */
  readSettings: () => AppSettings;
  mergeSettings: (patch: AppSettings) => void;
  tokens: TokenStore;
  /** `DELETE /api/time/token` with this token at this origin. Best effort: failures are ignored. */
  revokeToken: (origin: string, token: string) => Promise<unknown>;
  /** The connect flow's pending connect (`server/time/connect.ts`). */
  hasPending: () => boolean;
  cancelPending: () => void;
  now?: () => Date;
  log?: (line: string) => void;
}

export type SetAddressResult = 'ok' | 'invalid' | 'env';

export interface Connection {
  address(): ToolboxAddress;
  state(): ConnectionState;
  /** The origin to call: the address in use, when a live (unexpired) connection for it is on file. */
  connectedOrigin(): string | null;
  /** After a successful exchange: the token into the Keychain, then the record on disk. Throws if either fails. */
  save(origin: string, answer: TokenAnswer): Promise<void>;
  /** Revoke (best effort), then remove the Keychain item and the file, even offline. Cancels a pending connect. */
  disconnect(): Promise<void>;
  /** A 401 (or the Keychain item gone): the same clean-up, no revoke call. No-op when not connected. */
  markLost(reason?: LostReason): Promise<void>;
  /** Decision 2. `invalid`: refused; `env`: TDS_TOOLBOX_URL is set. A changed address disconnects first. */
  setAddress(url: string | null): Promise<SetAddressResult>;
}

export function createConnection(deps: ConnectionDeps): Connection {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  let lost: { origin: string; reason: LostReason } | null = null;
  let disconnecting = false;

  const address = (): ToolboxAddress => resolveToolboxAddress(deps.env, deps.readSettings());

  async function removeToken(origin: string): Promise<void> {
    try {
      await deps.tokens.remove(origin);
    } catch {
      log('Could not remove the Toolbox key from the Keychain.');
    }
  }

  /** Removes the record and its Keychain item. Never throws. */
  async function cleanUp(file: ConnectionFile | null): Promise<void> {
    if (file) await removeToken(file.origin);
    try {
      removeConnectionFile(deps.dataDir);
    } catch {
      log('Could not remove the Toolbox connection file.');
    }
  }

  async function disconnect(): Promise<void> {
    disconnecting = true;
    try {
      deps.cancelPending();
      const file = readConnectionFile(deps.dataDir);
      if (file) {
        let token: string | null = null;
        try {
          token = await deps.tokens.read(file.origin);
        } catch {
          log('Could not read the Toolbox key from the Keychain.');
        }
        if (token) {
          try {
            await deps.revokeToken(file.origin, token);
          } catch {
            // Offline or refused: the local clean-up below still happens.
          }
        }
      }
      await cleanUp(file);
      lost = null;
    } finally {
      disconnecting = false;
    }
  }

  return {
    address,

    state() {
      return connectionState({
        origin: address().url,
        file: readConnectionFile(deps.dataDir),
        pending: deps.hasPending(),
        lost,
        now: now(),
      });
    },

    connectedOrigin() {
      const origin = address().url;
      const file = readConnectionFile(deps.dataDir);
      if (origin === null || file === null || file.origin !== origin) return null;
      return Date.parse(file.expiresAt) > now().getTime() ? origin : null;
    },

    async save(origin, answer) {
      const previous = readConnectionFile(deps.dataDir);
      await deps.tokens.save(origin, answer.token);
      try {
        writeConnectionFile(deps.dataDir, {
          version: 1,
          origin,
          connectionId: answer.connectionId,
          expiresAt: answer.expiresAt,
          connectedAt: now().toISOString(),
        });
      } catch (err) {
        await removeToken(origin);
        throw err;
      }
      // A record for another address held a token there; it is no longer used.
      if (previous && previous.origin !== origin) await removeToken(previous.origin);
      lost = null;
    },

    disconnect,

    async markLost(reason) {
      if (disconnecting) return;
      const file = readConnectionFile(deps.dataDir);
      if (!file) return;
      const expired = Date.parse(file.expiresAt) <= now().getTime();
      lost = { origin: file.origin, reason: reason ?? (expired ? 'expired' : 'revoked') };
      await cleanUp(file);
      log('The Toolbox connection was lost.');
    },

    async setAddress(url) {
      if (deps.env.TDS_TOOLBOX_URL?.trim()) return 'env';
      let next: string | null = null;
      if (url !== null) {
        next = parseToolboxOrigin(url);
        if (next === null) return 'invalid';
      }
      const current = parseToolboxOrigin(deps.readSettings().toolboxUrl);
      if (next === current) return 'ok';
      await disconnect();
      deps.mergeSettings({ toolboxUrl: next ?? undefined });
      return 'ok';
    },
  };
}
