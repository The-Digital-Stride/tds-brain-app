import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { KEYCHAIN_SERVICE } from '../../shared/time-contract.ts';
import { createKeychainTokenStore, keychainSafe, type SpawnFn } from './token-store.ts';

const TOKEN = `tds_time_${'0123456789abcdef'.repeat(4)}`;
const ORIGIN = 'https://toolbox.example';

interface Call {
  command: string;
  args: string[];
  stdin: string;
}

/**
 * A pretend `security`: keeps items in a Map, understands the `-i` add command on stdin and the argv
 * find and delete commands, and records every spawn.
 */
function fakeSecurity(opts: { hang?: boolean; addFails?: boolean; readBackWrong?: boolean } = {}) {
  const items = new Map<string, string>();
  const calls: Call[] = [];
  const spawn: SpawnFn = (command, args) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: (signal?: string) => boolean;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      setImmediate(() => child.emit('close', null, 'SIGKILL'));
      return true;
    };
    const call: Call = { command, args: [...args], stdin: '' };
    calls.push(call);
    const chunks: Buffer[] = [];
    child.stdin.on('data', (c: Buffer) => chunks.push(c));
    child.stdin.on('end', () => {
      call.stdin = Buffer.concat(chunks).toString('utf8');
      if (opts.hang) return;
      let code = 0;
      if (args[0] === '-i') {
        const m = /^add-generic-password -U -s "([^"]*)" -a "([^"]*)" -w "([^"]*)"\n$/.exec(call.stdin);
        if (!m || opts.addFails) code = 1;
        else items.set(`${m[1]}|${m[2]}`, m[3] as string);
      } else if (args[0] === 'find-generic-password') {
        const key = `${args[2]}|${args[4]}`;
        const v = items.get(key);
        if (v === undefined) code = 44;
        else child.stdout.write(`${opts.readBackWrong ? `${v.slice(0, -1)}0` : v}\n`);
      } else if (args[0] === 'delete-generic-password') {
        const key = `${args[2]}|${args[4]}`;
        code = items.delete(key) ? 0 : 44;
      }
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', code, null));
    });
    return child as never;
  };
  return { spawn, items, calls };
}

describe('keychainSafe', () => {
  it('refuses quotes, backslashes, newlines and control characters', () => {
    expect(keychainSafe('https://toolbox.example')).toBe(true);
    expect(keychainSafe(KEYCHAIN_SERVICE)).toBe(true);
    for (const bad of ['a"b', 'a\\b', 'a\nb', 'a\rb', 'a\tb', 'a\u0000b', 'a\u007fb', 'a\u0085b', '']) {
      expect(keychainSafe(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('createKeychainTokenStore', () => {
  it('writes with security -i, the command on stdin and never in argv', async () => {
    const fake = fakeSecurity();
    const store = createKeychainTokenStore({ spawn: fake.spawn });
    await store.save(ORIGIN, TOKEN);
    expect(fake.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of fake.calls) {
      expect(call.command).toBe('/usr/bin/security');
      expect(call.args.join(' ')).not.toContain(TOKEN);
      expect(call.args.join(' ')).not.toContain('tds_time_');
    }
    const add = fake.calls[0] as Call;
    expect(add.args).toEqual(['-i']);
    expect(add.stdin).toBe(`add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${ORIGIN}" -w "${TOKEN}"\n`);
    // Read back with find-generic-password -w.
    expect(fake.calls[1]?.args).toEqual([
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      ORIGIN,
      '-w',
    ]);
    expect(fake.items.get(`${KEYCHAIN_SERVICE}|${ORIGIN}`)).toBe(TOKEN);
  });

  it('refuses a token that is not a time token, or a bad origin, before running anything', async () => {
    const fake = fakeSecurity();
    const store = createKeychainTokenStore({ spawn: fake.spawn });
    for (const token of ['nope', `${TOKEN}0`, `tds_time_${'A'.repeat(64)}`, `${TOKEN}"`, `${TOKEN}\n`]) {
      await expect(store.save(ORIGIN, token)).rejects.toThrow();
    }
    for (const origin of [
      'https://toolbox.example/x',
      'https://a"b.example',
      "https://a'b.example",
      'https://toolbox.example/',
      'http://evil.example',
      'x',
    ]) {
      await expect(store.save(origin, TOKEN)).rejects.toThrow();
      expect(await store.read(origin)).toBeNull();
    }
    expect(fake.calls).toEqual([]);
  });

  it('fails the save when the add fails or the read back differs', async () => {
    const a = fakeSecurity({ addFails: true });
    await expect(createKeychainTokenStore({ spawn: a.spawn }).save(ORIGIN, TOKEN)).rejects.toThrow();
    const b = fakeSecurity({ readBackWrong: true });
    await expect(createKeychainTokenStore({ spawn: b.spawn }).save(ORIGIN, TOKEN)).rejects.toThrow();
  });

  it('times out after the limit and fails', async () => {
    const fake = fakeSecurity({ hang: true });
    const store = createKeychainTokenStore({ spawn: fake.spawn, timeoutMs: 20 });
    await expect(store.save(ORIGIN, TOKEN)).rejects.toThrow();
    await expect(store.read(ORIGIN)).rejects.toThrow();
  });

  it('reads the token, null when there is none, and caches it in memory', async () => {
    const fake = fakeSecurity();
    const store = createKeychainTokenStore({ spawn: fake.spawn });
    expect(await store.read(ORIGIN)).toBeNull();
    fake.items.set(`${KEYCHAIN_SERVICE}|${ORIGIN}`, TOKEN);
    expect(await store.read(ORIGIN)).toBe(TOKEN);
    const before = fake.calls.length;
    expect(await store.read(ORIGIN)).toBe(TOKEN);
    expect(fake.calls.length).toBe(before);
  });

  it('reads anything that is not a time token as none', async () => {
    const fake = fakeSecurity();
    fake.items.set(`${KEYCHAIN_SERVICE}|${ORIGIN}`, 'something else');
    expect(await createKeychainTokenStore({ spawn: fake.spawn }).read(ORIGIN)).toBeNull();
  });

  it('removes the item and the cached copy; a missing item is fine', async () => {
    const fake = fakeSecurity();
    const store = createKeychainTokenStore({ spawn: fake.spawn });
    await store.save(ORIGIN, TOKEN);
    await store.remove(ORIGIN);
    expect(fake.items.size).toBe(0);
    expect(fake.calls.at(-1)?.args).toEqual([
      'delete-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      ORIGIN,
    ]);
    expect(await store.read(ORIGIN)).toBeNull();
    await store.remove(ORIGIN);
  });
});
