import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { TokenAnswer, ToolboxCall } from '../../shared/time-contract.ts';
import {
  CONNECT_TTL_MS,
  challengeFor,
  connectUrl,
  createConnectFlow,
  deviceLabel,
  newState,
  newVerifier,
} from './connect.ts';

const ORIGIN = 'https://toolbox.example';
const CODE = 'c'.repeat(64);
const TOKEN = `tds_time_${'b'.repeat(64)}`;
const ANSWER: TokenAnswer = {
  token: TOKEN,
  tokenType: 'Bearer',
  expiresAt: '2027-02-26T12:00:00.000Z',
  connectionId: 'conn-1',
};

describe('PKCE values', () => {
  it('verifier: 32 random bytes as base64url, 43 characters', () => {
    const v = newVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(v, 'base64url')).toHaveLength(32);
    expect(newVerifier()).not.toBe(v);
  });

  it('challenge: base64url(sha256(verifier)), 43 characters', () => {
    const v = newVerifier();
    const c = challengeFor(v);
    expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(c).toBe(createHash('sha256').update(v, 'ascii').digest('base64url'));
    // A fixed vector, worked out separately with openssl dgst -sha256 | base64url.
    expect(challengeFor('dBjftJeZ4CVP-mJ92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'ngF5GsXcbwljx6u133FFr3Xht9xooA_DuaX_3QwODtc',
    );
  });

  it('state: 32 random bytes as base64url', () => {
    const s = newState();
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newState()).not.toBe(s);
  });
});

describe('deviceLabel', () => {
  it("uses the first name: TDS Cortex on <first name>'s Mac", () => {
    expect(deviceLabel('Ian Hancock')).toBe("TDS Cortex on Ian's Mac");
    expect(deviceLabel('  Ben  ')).toBe("TDS Cortex on Ben's Mac");
  });

  it('falls back when there is no usable name', () => {
    expect(deviceLabel(null)).toBe('TDS Cortex on this Mac');
    expect(deviceLabel('')).toBe('TDS Cortex on this Mac');
    expect(deviceLabel('‮\u0007')).toBe('TDS Cortex on this Mac');
  });

  it('strips control and direction-override characters and keeps to 60 characters', () => {
    const label = deviceLabel('Ia‮n\u0000 X');
    expect(label).toBe("TDS Cortex on Ian's Mac");
    const long = deviceLabel('A'.repeat(100));
    expect([...long].length).toBeLessThanOrEqual(60);
    expect(long.endsWith("'s Mac")).toBe(true);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: checking they are gone
    expect(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/.test(long)).toBe(false);
  });
});

describe('connectUrl', () => {
  it('builds /time-connect with each parameter once, in order', () => {
    const url = new URL(
      connectUrl(ORIGIN, {
        port: 3877,
        state: 'st',
        codeChallenge: 'x'.repeat(43),
        device: "TDS Cortex on Ian's Mac",
      }),
    );
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe('/time-connect');
    expect([...url.searchParams.keys()]).toEqual(['port', 'state', 'code_challenge', 'device']);
    expect(url.searchParams.get('port')).toBe('3877');
    expect(url.searchParams.get('device')).toBe("TDS Cortex on Ian's Mac");
  });

  it('refuses a port Toolbox would refuse', () => {
    expect(() =>
      connectUrl(ORIGIN, { port: 80, state: 's', codeChallenge: 'x'.repeat(43), device: 'd' }),
    ).toThrow();
    expect(() =>
      connectUrl(ORIGIN, { port: 70000, state: 's', codeChallenge: 'x'.repeat(43), device: 'd' }),
    ).toThrow();
  });
});

function flow(
  over: {
    exchange?: (origin: string, code: string, verifier: string) => Promise<ToolboxCall<TokenAnswer>>;
    saveFails?: boolean;
  } = {},
) {
  let clock = 1_000_000;
  const exchanges: Array<{ origin: string; code: string; verifier: string }> = [];
  const saved: Array<{ origin: string; answer: TokenAnswer }> = [];
  const revoked: Array<{ origin: string; token: string }> = [];
  const f = createConnectFlow({
    port: 3877,
    exchange: async (origin, code, verifier) => {
      exchanges.push({ origin, code, verifier });
      return over.exchange ? over.exchange(origin, code, verifier) : { ok: true, value: ANSWER };
    },
    save: async (origin, answer) => {
      if (over.saveFails) throw new Error('keychain');
      saved.push({ origin, answer });
    },
    revokeToken: async (origin, token) => {
      revoked.push({ origin, token });
    },
    now: () => clock,
  });
  return {
    f,
    exchanges,
    saved,
    revoked,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function stateOf(url: string): string {
  return new URL(url).searchParams.get('state') as string;
}

function q(params: Record<string, string | string[]>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const one of [v].flat()) out.append(k, one);
  return out;
}

describe('createConnectFlow', () => {
  it('start makes a pending connect and a URL whose challenge matches the verifier used later', async () => {
    const t = flow();
    const { url } = t.f.start(ORIGIN, 'Ian Hancock');
    expect(t.f.hasPending()).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('device')).toBe("TDS Cortex on Ian's Mac");
    const outcome = await t.f.callback(q({ code: CODE, state: stateOf(url) }));
    expect(outcome).toEqual({ ok: true });
    expect(t.exchanges).toHaveLength(1);
    const used = t.exchanges[0] as { origin: string; code: string; verifier: string };
    expect(used.origin).toBe(ORIGIN);
    expect(used.code).toBe(CODE);
    expect(challengeFor(used.verifier)).toBe(parsed.searchParams.get('code_challenge'));
    expect(t.saved).toEqual([{ origin: ORIGIN, answer: ANSWER }]);
    expect(t.f.hasPending()).toBe(false);
  });

  it('a new Connect replaces the old one', async () => {
    const t = flow();
    const first = t.f.start(ORIGIN, null);
    const second = t.f.start(ORIGIN, null);
    expect(await t.f.callback(q({ code: CODE, state: stateOf(first.url) }))).toEqual({
      ok: false,
      reason: 'state',
    });
    expect(await t.f.callback(q({ code: CODE, state: stateOf(second.url) }))).toEqual({ ok: true });
  });

  it('a wrong, missing or repeated state fails and leaves the pending connect alone', async () => {
    const t = flow();
    const { url } = t.f.start(ORIGIN, null);
    const good = stateOf(url);
    for (const bad of [
      q({ code: CODE }),
      q({ code: CODE, state: 'nope' }),
      q({ code: CODE, state: `${good}x` }),
      q({ code: CODE, state: good.slice(1) }),
      q({ code: CODE, state: [good, good] }),
      q({ code: CODE, state: '' }),
    ]) {
      expect(await t.f.callback(bad)).toEqual({ ok: false, reason: 'state' });
    }
    expect(t.exchanges).toEqual([]);
    expect(t.f.hasPending()).toBe(true);
    expect(await t.f.callback(q({ code: CODE, state: good }))).toEqual({ ok: true });
  });

  it('with no pending connect, any state fails', async () => {
    const t = flow();
    expect(await t.f.callback(q({ code: CODE, state: 'x' }))).toEqual({ ok: false, reason: 'state' });
  });

  it('a matching state is used once, whatever happens next', async () => {
    const t = flow({ exchange: async () => ({ ok: false, kind: 'network' }) });
    const { url } = t.f.start(ORIGIN, null);
    const s = stateOf(url);
    expect(await t.f.callback(q({ code: CODE, state: s }))).toEqual({ ok: false, reason: 'exchange' });
    expect(t.f.hasPending()).toBe(false);
    expect(await t.f.callback(q({ code: CODE, state: s }))).toEqual({ ok: false, reason: 'state' });
    expect(t.exchanges).toHaveLength(1);
  });

  it('two callbacks at once: only one exchanges', async () => {
    const t = flow();
    const { url } = t.f.start(ORIGIN, null);
    const s = stateOf(url);
    const [a, b] = await Promise.all([
      t.f.callback(q({ code: CODE, state: s })),
      t.f.callback(q({ code: CODE, state: s })),
    ]);
    expect([a, b]).toContainEqual({ ok: true });
    expect([a, b]).toContainEqual({ ok: false, reason: 'state' });
    expect(t.exchanges).toHaveLength(1);
  });

  it('expires after 10 minutes', async () => {
    expect(CONNECT_TTL_MS).toBe(10 * 60 * 1000);
    const t = flow();
    const { url } = t.f.start(ORIGIN, null);
    t.advance(CONNECT_TTL_MS + 1);
    expect(t.f.hasPending()).toBe(false);
    expect(await t.f.callback(q({ code: CODE, state: stateOf(url) }))).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(t.exchanges).toEqual([]);
    expect(await t.f.callback(q({ code: CODE, state: stateOf(url) }))).toEqual({
      ok: false,
      reason: 'state',
    });
  });

  it('an error from Toolbox, or access_denied, is denied', async () => {
    for (const params of [{ error: 'access_denied' }, { error: 'anything' }]) {
      const t = flow();
      const { url } = t.f.start(ORIGIN, null);
      expect(await t.f.callback(q({ ...params, state: stateOf(url) }))).toEqual({
        ok: false,
        reason: 'denied',
      });
      expect(t.exchanges).toEqual([]);
    }
    const t = flow({
      exchange: async () => ({ ok: false, kind: 'error', code: 'access_denied', status: 403 }),
    });
    const { url } = t.f.start(ORIGIN, null);
    expect(await t.f.callback(q({ code: CODE, state: stateOf(url) }))).toEqual({
      ok: false,
      reason: 'denied',
    });
  });

  it('too_many_connections is too-many; other exchange failures are exchange', async () => {
    const tooMany = flow({
      exchange: async () => ({ ok: false, kind: 'error', code: 'too_many_connections', status: 409 }),
    });
    const a = tooMany.f.start(ORIGIN, null);
    expect(await tooMany.f.callback(q({ code: CODE, state: stateOf(a.url) }))).toEqual({
      ok: false,
      reason: 'too-many',
    });
    for (const result of [
      { ok: false, kind: 'error', code: 'invalid_grant', status: 400 },
      { ok: false, kind: 'off' },
      { ok: false, kind: 'server' },
      { ok: false, kind: 'rate-limited' },
    ] as ToolboxCall<TokenAnswer>[]) {
      const t = flow({ exchange: async () => result });
      const { url } = t.f.start(ORIGIN, null);
      expect(await t.f.callback(q({ code: CODE, state: stateOf(url) }))).toEqual({
        ok: false,
        reason: 'exchange',
      });
    }
  });

  it('a malformed code is exchange, without calling Toolbox', async () => {
    for (const code of ['short', 'C'.repeat(64), `${CODE}0`]) {
      const t = flow();
      const { url } = t.f.start(ORIGIN, null);
      expect(await t.f.callback(q({ code, state: stateOf(url) }))).toEqual({ ok: false, reason: 'exchange' });
      expect(t.exchanges).toEqual([]);
    }
    const t = flow();
    const { url } = t.f.start(ORIGIN, null);
    expect(await t.f.callback(q({ state: stateOf(url) }))).toEqual({ ok: false, reason: 'exchange' });
  });

  it('a Keychain failure revokes the new token and is storage', async () => {
    const t = flow({ saveFails: true });
    const { url } = t.f.start(ORIGIN, null);
    expect(await t.f.callback(q({ code: CODE, state: stateOf(url) }))).toEqual({
      ok: false,
      reason: 'storage',
    });
    expect(t.revoked).toEqual([{ origin: ORIGIN, token: TOKEN }]);
  });

  it('cancel drops the pending connect', async () => {
    const t = flow();
    const { url } = t.f.start(ORIGIN, null);
    t.f.cancel();
    expect(t.f.hasPending()).toBe(false);
    expect(await t.f.callback(q({ code: CODE, state: stateOf(url) }))).toEqual({
      ok: false,
      reason: 'state',
    });
  });
});
