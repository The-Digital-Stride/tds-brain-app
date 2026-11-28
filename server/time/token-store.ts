/**
 * The Toolbox token in the macOS Keychain (plan 2026-11-28-time-my-day, decision 5 and overseer 29).
 *
 * A generic password, service `KEYCHAIN_SERVICE`, account = the Toolbox origin. The token is written with
 * `security -i`, which reads its command from stdin, so the token is never in any process's argv. Reading
 * and deleting carry only the service and the origin in argv. Every value is checked first and must be
 * safe to put inside double quotes (the `-i` parser accepts an unterminated quote, so a `"`, `\`, newline
 * or control character is refused rather than escaped). Each save is read back and compared.
 *
 * Never logs or throws the token.
 */
import { type ChildProcess, spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { KEYCHAIN_SERVICE, type TokenStore } from '../../shared/time-contract.ts';
import { safeEqual } from '../http/security.ts';
import { parseToolboxOrigin } from './connection.ts';

export const SECURITY_PATH = '/usr/bin/security';
export const KEYCHAIN_TIMEOUT_MS = 5_000;
export const TIME_TOKEN_PATTERN = /^tds_time_[0-9a-f]{64}$/;
/** `security` exits with this when the item isn't there. */
const NOT_FOUND = 44;
const MAX_OUTPUT_BYTES = 16 * 1024;

export type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

/** Safe inside a double-quoted `security -i` argument: printable, no `"` or `\`. */
export function keychainSafe(value: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  return value !== '' && !/["\\\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value);
}

interface RunResult {
  code: number | null;
  stdout: string;
  timedOut: boolean;
}

/** Runs `security` once. Stderr is drained and dropped (it can quote the command). Never rejects. */
function runSecurity(
  spawnFn: SpawnFn,
  securityPath: string,
  args: readonly string[],
  input: string | null,
  timeoutMs: number,
): Promise<RunResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn(securityPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      resolve({ code: null, stdout: '', timedOut: false });
      return;
    }
    let done = false;
    let timedOut = false;
    const out: Buffer[] = [];
    let outBytes = 0;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, stdout: Buffer.concat(out).toString('utf8'), timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
      finish(null);
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes <= MAX_OUTPUT_BYTES) out.push(chunk);
    });
    child.stderr?.on('data', () => {});
    child.on('error', () => finish(null));
    child.on('close', (code: number | null) => finish(code));
    child.stdin?.on('error', () => {});
    if (input === null) child.stdin?.end();
    else child.stdin?.end(input, 'utf8');
  });
}

export interface KeychainDeps {
  spawn?: SpawnFn;
  timeoutMs?: number;
  securityPath?: string;
}

/** A plain origin only (letters, digits, dots, hyphens, a port): nothing the `-i` parser could read twice. */
const KEYCHAIN_ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;

function checkedOrigin(origin: string): string | null {
  const parsed = parseToolboxOrigin(origin);
  return parsed !== null && parsed === origin && KEYCHAIN_ORIGIN.test(parsed) && keychainSafe(parsed)
    ? parsed
    : null;
}

export function createKeychainTokenStore(deps: KeychainDeps = {}): TokenStore {
  const spawnFn = deps.spawn ?? (nodeSpawn as SpawnFn);
  const timeoutMs = deps.timeoutMs ?? KEYCHAIN_TIMEOUT_MS;
  const securityPath = deps.securityPath ?? SECURITY_PATH;
  const cache = new Map<string, string>();
  const run = (args: readonly string[], input: string | null) =>
    runSecurity(spawnFn, securityPath, args, input, timeoutMs);

  /** The stored token, null when there is none (or it isn't a time token). Throws when the Keychain fails. */
  async function find(origin: string): Promise<string | null> {
    const result = await run(['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', origin, '-w'], null);
    if (result.code === NOT_FOUND) return null;
    if (result.code !== 0) throw new Error('The Keychain could not be read.');
    const value = result.stdout.endsWith('\n') ? result.stdout.slice(0, -1) : result.stdout;
    return TIME_TOKEN_PATTERN.test(value) ? value : null;
  }

  return {
    async read(origin) {
      const safe = checkedOrigin(origin);
      if (safe === null) return null;
      const cached = cache.get(safe);
      if (cached !== undefined) return cached;
      const token = await find(safe);
      if (token !== null) cache.set(safe, token);
      return token;
    },

    async save(origin, token) {
      const safe = checkedOrigin(origin);
      if (safe === null || !TIME_TOKEN_PATTERN.test(token) || !keychainSafe(KEYCHAIN_SERVICE)) {
        throw new Error('That key or address cannot be saved in the Keychain.');
      }
      cache.delete(safe);
      const command = `add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${safe}" -w "${token}"\n`;
      const added = await run(['-i'], command);
      if (added.code !== 0) throw new Error('The Keychain did not save the key.');
      const back = await find(safe);
      if (back === null || !safeEqual(back, token)) throw new Error('The Keychain did not save the key.');
      cache.set(safe, token);
    },

    async remove(origin) {
      const safe = checkedOrigin(origin);
      if (safe === null) return;
      cache.delete(safe);
      const result = await run(['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', safe], null);
      if (result.code !== 0 && result.code !== NOT_FOUND)
        throw new Error('The Keychain item was not removed.');
    },
  };
}
