import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AppSettings } from '../../shared/install-contract.ts';
import type { ConnectionFile, TokenAnswer, TokenStore } from '../../shared/time-contract.ts';
import {
  connectionState,
  createConnection,
  parseToolboxOrigin,
  RECONNECT_SOON_DAYS,
  readConnectionFile,
  removeConnectionFile,
  resolveToolboxAddress,
  writeConnectionFile,
} from './connection.ts';

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tba-time-conn-'));
  tempDirs.push(dir);
  return dir;
}

const TOKEN = `tds_time_${'a'.repeat(64)}`;
const ORIGIN = 'https://toolbox.example';
const NOW = new Date('2026-11-28T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function file(over: Partial<ConnectionFile> = {}): ConnectionFile {
  return {
    version: 1,
    origin: ORIGIN,
    connectionId: 'conn-1',
    expiresAt: new Date(NOW.getTime() + 60 * DAY).toISOString(),
    connectedAt: NOW.toISOString(),
    ...over,
  };
}

describe('parseToolboxOrigin', () => {
  it('accepts https origins, with or without a port, and one trailing slash', () => {
    expect(parseToolboxOrigin('https://toolbox.example')).toBe('https://toolbox.example');
    expect(parseToolboxOrigin('https://toolbox.example/')).toBe('https://toolbox.example');
    expect(parseToolboxOrigin('https://Toolbox.Example:8443')).toBe('https://toolbox.example:8443');
    expect(parseToolboxOrigin('  https://toolbox.example  ')).toBe('https://toolbox.example');
  });

  it('accepts http only for localhost and 127.0.0.1 with a port', () => {
    expect(parseToolboxOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(parseToolboxOrigin('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
    for (const bad of [
      'http://localhost',
      'http://127.0.0.1',
      'http://toolbox.example',
      'http://[::1]:3000',
    ]) {
      expect(parseToolboxOrigin(bad)).toBeNull();
    }
  });

  it('refuses paths, queries, fragments, credentials and other schemes', () => {
    for (const bad of [
      'https://toolbox.example/time',
      'https://toolbox.example//',
      'https://toolbox.example?x=1',
      'https://toolbox.example/?x=1',
      'https://toolbox.example#frag',
      'https://toolbox.example/#',
      'https://toolbox.example?',
      'https://user@toolbox.example',
      'https://user:pw@toolbox.example',
      'ftp://toolbox.example',
      'javascript:alert(1)',
      'toolbox.example',
      'https://',
      '',
      'https://tool\nbox.example',
      'https://tool box.example',
      'https://toolbox.example\\',
    ]) {
      expect(parseToolboxOrigin(bad), bad).toBeNull();
    }
    expect(parseToolboxOrigin(42)).toBeNull();
    expect(parseToolboxOrigin(null)).toBeNull();
  });
});

describe('resolveToolboxAddress', () => {
  it('TDS_TOOLBOX_URL wins over settings', () => {
    expect(
      resolveToolboxAddress({ TDS_TOOLBOX_URL: 'http://localhost:3000' }, { toolboxUrl: ORIGIN }),
    ).toEqual({ url: 'http://localhost:3000', source: 'env' });
  });

  it('a bad TDS_TOOLBOX_URL still wins, as no address', () => {
    expect(
      resolveToolboxAddress({ TDS_TOOLBOX_URL: 'https://x.example/path' }, { toolboxUrl: ORIGIN }),
    ).toEqual({ url: null, source: 'env' });
  });

  it('uses settings, then nothing', () => {
    expect(resolveToolboxAddress({ TDS_TOOLBOX_URL: '  ' }, { toolboxUrl: `${ORIGIN}/` })).toEqual({
      url: ORIGIN,
      source: 'settings',
    });
    expect(resolveToolboxAddress({}, { toolboxUrl: 'nonsense' })).toEqual({ url: null, source: 'default' });
    expect(resolveToolboxAddress({}, {})).toEqual({ url: null, source: 'default' });
  });
});

describe('connection file', () => {
  it('writes 0600 in a 0700 time folder, atomically, and reads back', () => {
    const dataDir = tempDir();
    writeConnectionFile(dataDir, file());
    expect(statSync(join(dataDir, 'time')).mode & 0o777).toBe(0o700);
    expect(statSync(join(dataDir, 'time', 'connection.json')).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(dataDir, 'time'))).toEqual(['connection.json']);
    expect(readConnectionFile(dataDir)).toEqual(file());
    expect(readFileSync(join(dataDir, 'time', 'connection.json'), 'utf8')).not.toContain('tds_time_');
  });

  it('reads a missing, broken or wrongly shaped file as null', () => {
    const dataDir = tempDir();
    expect(readConnectionFile(dataDir)).toBeNull();
    writeConnectionFile(dataDir, file());
    for (const raw of [
      '{',
      '[]',
      'null',
      JSON.stringify({ ...file(), version: 2 }),
      JSON.stringify({ ...file(), origin: 'https://a.example/x' }),
      JSON.stringify({ ...file(), expiresAt: 'soon' }),
    ]) {
      writeFileSync(join(dataDir, 'time', 'connection.json'), raw);
      expect(readConnectionFile(dataDir), raw).toBeNull();
    }
  });

  it('removes the file, and a missing one is fine', () => {
    const dataDir = tempDir();
    writeConnectionFile(dataDir, file());
    removeConnectionFile(dataDir);
    expect(existsSync(join(dataDir, 'time', 'connection.json'))).toBe(false);
    removeConnectionFile(dataDir);
  });
});

describe('connectionState', () => {
  const base = { origin: ORIGIN, file: null, pending: false, lost: null, now: NOW };

  it('no address', () => {
    expect(connectionState({ ...base, origin: null, file: file() })).toEqual({ state: 'no-address' });
  });

  it('not connected, with or without a pending connect', () => {
    expect(connectionState(base)).toEqual({ state: 'not-connected', origin: ORIGIN, pending: false });
    expect(connectionState({ ...base, pending: true })).toEqual({
      state: 'not-connected',
      origin: ORIGIN,
      pending: true,
    });
  });

  it('a file for another origin is not a connection', () => {
    expect(connectionState({ ...base, file: file({ origin: 'https://other.example' }) }).state).toBe(
      'not-connected',
    );
  });

  it('connected; reconnect soon from 14 days before expiry', () => {
    expect(RECONNECT_SOON_DAYS).toBe(14);
    const far = file();
    expect(connectionState({ ...base, file: far })).toEqual({
      state: 'connected',
      origin: ORIGIN,
      expiresAt: far.expiresAt,
      reconnectSoon: false,
    });
    const at14 = file({ expiresAt: new Date(NOW.getTime() + 14 * DAY).toISOString() });
    expect(connectionState({ ...base, file: at14 })).toMatchObject({
      state: 'connected',
      reconnectSoon: true,
    });
    const at15 = file({ expiresAt: new Date(NOW.getTime() + 15 * DAY).toISOString() });
    expect(connectionState({ ...base, file: at15 })).toMatchObject({ reconnectSoon: false });
  });

  it('an expired file is lost (expired), unless a new connect is pending', () => {
    const old = file({ expiresAt: new Date(NOW.getTime() - 1).toISOString() });
    expect(connectionState({ ...base, file: old })).toEqual({
      state: 'lost',
      origin: ORIGIN,
      reason: 'expired',
    });
    expect(connectionState({ ...base, file: old, pending: true }).state).toBe('not-connected');
  });

  it('a lost marker for this origin shows lost', () => {
    expect(connectionState({ ...base, lost: { origin: ORIGIN, reason: 'revoked' } })).toEqual({
      state: 'lost',
      origin: ORIGIN,
      reason: 'revoked',
    });
    expect(
      connectionState({ ...base, lost: { origin: 'https://other.example', reason: 'revoked' } }).state,
    ).toBe('not-connected');
  });
});

interface Harness {
  dataDir: string;
  settings: AppSettings;
  keychain: Map<string, string>;
  revokes: Array<{ origin: string; token: string }>;
  pendingCancelled: number;
  pending: boolean;
  revokeFails: boolean;
  keychainFails: boolean;
  env: Record<string, string | undefined>;
  now: Date;
}

function harness(over: Partial<Harness> = {}) {
  const h: Harness = {
    dataDir: tempDir(),
    settings: { toolboxUrl: ORIGIN },
    keychain: new Map(),
    revokes: [],
    pendingCancelled: 0,
    pending: false,
    revokeFails: false,
    keychainFails: false,
    env: {},
    now: NOW,
    ...over,
  };
  const tokens: TokenStore = {
    read: async (o) => {
      if (h.keychainFails) throw new Error('keychain');
      return h.keychain.get(o) ?? null;
    },
    save: async (o, t) => {
      if (h.keychainFails) throw new Error('keychain');
      h.keychain.set(o, t);
    },
    remove: async (o) => {
      if (h.keychainFails) throw new Error('keychain');
      h.keychain.delete(o);
    },
  };
  const conn = createConnection({
    dataDir: h.dataDir,
    env: h.env,
    readSettings: () => h.settings,
    mergeSettings: (patch) => {
      h.settings = { ...h.settings, ...patch };
      for (const [k, v] of Object.entries(h.settings)) if (v === undefined) delete (h.settings as never)[k];
    },
    tokens,
    revokeToken: async (origin, token) => {
      h.revokes.push({ origin, token });
      if (h.revokeFails) throw new Error('offline');
    },
    hasPending: () => h.pending,
    cancelPending: () => {
      h.pendingCancelled += 1;
      h.pending = false;
    },
    now: () => h.now,
  });
  return { h, conn };
}

const ANSWER: TokenAnswer = {
  token: TOKEN,
  tokenType: 'Bearer',
  expiresAt: new Date(NOW.getTime() + 90 * DAY).toISOString(),
  connectionId: 'conn-9',
};

describe('createConnection', () => {
  it('save stores the token in the Keychain and the record (never the token) on disk', async () => {
    const { h, conn } = harness();
    await conn.save(ORIGIN, ANSWER);
    expect(h.keychain.get(ORIGIN)).toBe(TOKEN);
    expect(readConnectionFile(h.dataDir)).toEqual({
      version: 1,
      origin: ORIGIN,
      connectionId: 'conn-9',
      expiresAt: ANSWER.expiresAt,
      connectedAt: NOW.toISOString(),
    });
    expect(conn.state()).toMatchObject({ state: 'connected', origin: ORIGIN });
    expect(conn.connectedOrigin()).toBe(ORIGIN);
  });

  it('save fails without a file when the Keychain fails', async () => {
    const { h, conn } = harness({ keychainFails: true });
    await expect(conn.save(ORIGIN, ANSWER)).rejects.toThrow();
    expect(readConnectionFile(h.dataDir)).toBeNull();
  });

  it('connectedOrigin is null when expired or for another address', async () => {
    const { h, conn } = harness();
    await conn.save(ORIGIN, ANSWER);
    h.now = new Date(Date.parse(ANSWER.expiresAt) + 1);
    expect(conn.connectedOrigin()).toBeNull();
    h.now = NOW;
    h.settings = { toolboxUrl: 'https://other.example' };
    expect(conn.connectedOrigin()).toBeNull();
  });

  it('disconnect revokes, then removes the Keychain item and the file', async () => {
    const { h, conn } = harness();
    await conn.save(ORIGIN, ANSWER);
    await conn.disconnect();
    expect(h.revokes).toEqual([{ origin: ORIGIN, token: TOKEN }]);
    expect(h.keychain.size).toBe(0);
    expect(readConnectionFile(h.dataDir)).toBeNull();
    expect(conn.state()).toEqual({ state: 'not-connected', origin: ORIGIN, pending: false });
    expect(h.pendingCancelled).toBe(1);
  });

  it('disconnect cleans up even when Toolbox cannot be reached', async () => {
    const { h, conn } = harness();
    await conn.save(ORIGIN, ANSWER);
    h.revokeFails = true;
    await conn.disconnect();
    expect(h.keychain.size).toBe(0);
    expect(readConnectionFile(h.dataDir)).toBeNull();
  });

  it('disconnect removes the file even when the Keychain fails', async () => {
    const { h, conn } = harness();
    await conn.save(ORIGIN, ANSWER);
    h.keychainFails = true;
    await conn.disconnect();
    expect(readConnectionFile(h.dataDir)).toBeNull();
    expect(h.revokes).toEqual([]);
  });

  it('markLost cleans up without a revoke call and shows lost (revoked)', async () => {
    const { h, conn } = harness();
    await conn.save(ORIGIN, ANSWER);
    await conn.markLost();
    expect(h.revokes).toEqual([]);
    expect(h.keychain.size).toBe(0);
    expect(readConnectionFile(h.dataDir)).toBeNull();
    expect(conn.state()).toEqual({ state: 'lost', origin: ORIGIN, reason: 'revoked' });
  });

  it('markLost after expiry says expired; a given reason wins', async () => {
    const a = harness();
    await a.conn.save(ORIGIN, ANSWER);
    a.h.now = new Date(Date.parse(ANSWER.expiresAt) + 1000);
    await a.conn.markLost();
    expect(a.conn.state()).toEqual({ state: 'lost', origin: ORIGIN, reason: 'expired' });
    const b = harness();
    await b.conn.save(ORIGIN, ANSWER);
    await b.conn.markLost('refused');
    expect(b.conn.state()).toEqual({ state: 'lost', origin: ORIGIN, reason: 'refused' });
  });

  it('markLost does nothing when not connected', async () => {
    const { conn } = harness();
    await conn.markLost();
    expect(conn.state().state).toBe('not-connected');
  });

  it('a new save clears lost', async () => {
    const { conn } = harness();
    await conn.save(ORIGIN, ANSWER);
    await conn.markLost();
    await conn.save(ORIGIN, ANSWER);
    expect(conn.state().state).toBe('connected');
  });

  it('a save for another origin clears the old Keychain item', async () => {
    const { h, conn } = harness();
    await conn.save(ORIGIN, ANSWER);
    h.settings = { toolboxUrl: 'https://other.example' };
    await conn.save('https://other.example', ANSWER);
    expect([...h.keychain.keys()]).toEqual(['https://other.example']);
  });

  it('setAddress validates, saves, and changing it disconnects', async () => {
    const { h, conn } = harness();
    await conn.save(ORIGIN, ANSWER);
    expect(await conn.setAddress('https://bad.example/path')).toBe('invalid');
    expect(conn.state().state).toBe('connected');
    expect(await conn.setAddress(`${ORIGIN}/`)).toBe('ok');
    expect(conn.state().state).toBe('connected');
    expect(h.revokes).toEqual([]);
    expect(await conn.setAddress('http://localhost:3000')).toBe('ok');
    expect(h.settings.toolboxUrl).toBe('http://localhost:3000');
    expect(h.revokes).toEqual([{ origin: ORIGIN, token: TOKEN }]);
    expect(readConnectionFile(h.dataDir)).toBeNull();
    expect(conn.state()).toEqual({ state: 'not-connected', origin: 'http://localhost:3000', pending: false });
    expect(await conn.setAddress(null)).toBe('ok');
    expect(h.settings.toolboxUrl).toBeUndefined();
    expect(conn.state()).toEqual({ state: 'no-address' });
  });

  it('setAddress is refused while TDS_TOOLBOX_URL is set', async () => {
    const { h, conn } = harness({ env: { TDS_TOOLBOX_URL: 'http://localhost:3000' } });
    expect(await conn.setAddress(ORIGIN)).toBe('env');
    expect(h.settings.toolboxUrl).toBe(ORIGIN);
    expect(conn.address()).toEqual({ url: 'http://localhost:3000', source: 'env' });
  });

  it('pending shows in the state', () => {
    const { h, conn } = harness();
    h.pending = true;
    expect(conn.state()).toEqual({ state: 'not-connected', origin: ORIGIN, pending: true });
  });
});
