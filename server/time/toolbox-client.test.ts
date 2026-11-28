import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DaySubmission, TokenStore } from '../../shared/time-contract.ts';
import { createToolboxClient, TOOLBOX_MAX_ANSWER_BYTES, TOOLBOX_TIMEOUT_MS } from './toolbox-client.ts';

const ORIGIN = 'https://toolbox.example';
const TOKEN = `tds_time_${'d'.repeat(64)}`;
const CODE = 'e'.repeat(64);
const VERIFIER = 'v'.repeat(43);

interface Seen {
  url: string;
  init: RequestInit;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function tokens(token: string | null = TOKEN, fails = false): TokenStore {
  return {
    read: async () => {
      if (fails) throw new Error('keychain');
      return token;
    },
    save: async () => {},
    remove: async () => {},
  };
}

function client(
  answer: (url: string, init: RequestInit) => Response | Promise<Response>,
  over: { token?: string | null; origin?: string | null; keychainFails?: boolean } = {},
) {
  const seen: Seen[] = [];
  const lost: string[] = [];
  const c = createToolboxClient({
    fetch: (async (url: string | URL, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return answer(String(url), init ?? {});
    }) as typeof fetch,
    tokens: tokens(over.token === undefined ? TOKEN : over.token, over.keychainFails),
    origin: () => (over.origin === undefined ? ORIGIN : over.origin),
    onUnauthorised: (cause) => {
      lost.push(cause);
    },
  });
  return { c, seen, lost };
}

function headersOf(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init.headers).entries());
}

const SUBMISSION: DaySubmission = {
  version: 1,
  submissionId: '6f1c2f9e-1d2c-4a43-9a51-7d7d3c1f0a11',
  workDate: '2026-11-27',
  baseRevision: 0,
  entries: [],
  changes: [],
};

describe('limits', () => {
  it('10 s timeout and 2 MB answer cap', () => {
    expect(TOOLBOX_TIMEOUT_MS).toBe(10_000);
    expect(TOOLBOX_MAX_ANSWER_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe('every call', () => {
  it('refuses redirects, sends Bearer and Accept, never cookies, and a timeout signal', async () => {
    const { c, seen } = client(() => json(200, { items: [] }));
    await c.workItems();
    const call = seen[0] as Seen;
    expect(call.url).toBe(`${ORIGIN}/api/time/work-items`);
    expect(call.init.redirect).toBe('error');
    expect(call.init.credentials).toBe('omit');
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    const h = headersOf(call.init);
    expect(h.authorization).toBe(`Bearer ${TOKEN}`);
    expect(h.accept).toBe('application/json');
    expect(h.cookie).toBeUndefined();
  });

  it('exchange sends no Authorization', async () => {
    const { c, seen } = client(() =>
      json(200, {
        token: TOKEN,
        tokenType: 'Bearer',
        expiresAt: '2027-02-26T00:00:00.000Z',
        connectionId: 'x',
      }),
    );
    await c.exchange(ORIGIN, CODE, VERIFIER);
    const call = seen[0] as Seen;
    expect(call.url).toBe(`${ORIGIN}/api/time/token`);
    expect(call.init.method).toBe('POST');
    expect(call.init.redirect).toBe('error');
    expect(headersOf(call.init).authorization).toBeUndefined();
    expect(headersOf(call.init)['content-type']).toBe('application/json');
    expect(JSON.parse(String(call.init.body))).toEqual({ code: CODE, codeVerifier: VERIFIER });
  });

  it('not connected: unauthorised without a call or a lost mark', async () => {
    const { c, seen, lost } = client(() => json(200, {}), { origin: null });
    expect(await c.workItems()).toEqual({ ok: false, kind: 'unauthorised' });
    expect(seen).toEqual([]);
    expect(lost).toEqual([]);
  });

  it('no token in the Keychain: unauthorised, marked lost as missing-token', async () => {
    const { c, seen, lost } = client(() => json(200, {}), { token: null });
    expect(await c.workItems()).toEqual({ ok: false, kind: 'unauthorised' });
    expect(seen).toEqual([]);
    expect(lost).toEqual(['missing-token']);
  });

  it('the Keychain failing is not a lost connection', async () => {
    const { c, lost } = client(() => json(200, {}), { keychainFails: true });
    expect(await c.workItems()).toEqual({ ok: false, kind: 'network' });
    expect(lost).toEqual([]);
  });
});

describe('status mapping', () => {
  const cases: Array<[number, unknown, string]> = [
    [401, { error: 'unauthorised' }, 'unauthorised'],
    [404, { error: 'Not found' }, 'off'],
    [403, { error: 'forbidden' }, 'forbidden'],
    [429, { error: 'rate_limited' }, 'rate-limited'],
    [413, { error: 'too_large' }, 'too-large'],
    [500, { error: 'server_error' }, 'server'],
    [503, 'not json', 'server'],
  ];
  for (const [status, body, kind] of cases) {
    it(`${status} → ${kind}`, async () => {
      const { c, lost } = client(() => json(status, body));
      expect(await c.workItems()).toEqual({ ok: false, kind });
      expect(lost).toEqual(status === 401 ? ['unauthorised'] : []);
    });
  }

  it('other 4xx with { error } is an error with its code; unknown codes are server_error', async () => {
    expect(await client(() => json(400, { error: 'invalid_request' })).c.workItems()).toEqual({
      ok: false,
      kind: 'error',
      code: 'invalid_request',
      status: 400,
    });
    expect(await client(() => json(400, { error: 'weird' })).c.workItems()).toEqual({
      ok: false,
      kind: 'error',
      code: 'server_error',
      status: 400,
    });
  });

  it('a network failure or a bad answer', async () => {
    const down = client(() => {
      throw new TypeError('fetch failed');
    });
    expect(await down.c.workItems()).toEqual({ ok: false, kind: 'network' });
    expect(await client(() => new Response('<html>', { status: 200 })).c.workItems()).toEqual({
      ok: false,
      kind: 'server',
    });
    expect(await client(() => json(200, { items: 'no' })).c.workItems()).toEqual({
      ok: false,
      kind: 'server',
    });
  });

  it('a Content-Length over the cap is too-large without reading', async () => {
    const { c } = client(
      () =>
        new Response('{}', {
          status: 200,
          headers: { 'Content-Length': String(TOOLBOX_MAX_ANSWER_BYTES + 1) },
        }),
    );
    expect(await c.workItems()).toEqual({ ok: false, kind: 'too-large' });
  });
});

describe('exchange', () => {
  it('validates the token answer', async () => {
    const good = {
      token: TOKEN,
      tokenType: 'Bearer',
      expiresAt: '2027-02-26T00:00:00.000Z',
      connectionId: 'c1',
    };
    expect(await client(() => json(200, good)).c.exchange(ORIGIN, CODE, VERIFIER)).toEqual({
      ok: true,
      value: good,
    });
    for (const bad of [
      { ...good, token: 'tds_time_short' },
      { ...good, tokenType: 'Basic' },
      { ...good, expiresAt: 'later' },
      { ...good, connectionId: '' },
      [],
    ]) {
      expect(await client(() => json(200, bad)).c.exchange(ORIGIN, CODE, VERIFIER)).toEqual({
        ok: false,
        kind: 'server',
      });
    }
  });

  it('maps { error } codes to kind error', async () => {
    for (const [status, code] of [
      [400, 'invalid_request'],
      [400, 'invalid_grant'],
      [403, 'access_denied'],
      [409, 'too_many_connections'],
      [413, 'too_large'],
      [429, 'rate_limited'],
    ] as const) {
      const { c, lost } = client(() => json(status, { error: code, message: 'x' }));
      expect(await c.exchange(ORIGIN, CODE, VERIFIER)).toEqual({ ok: false, kind: 'error', code, status });
      expect(lost).toEqual([]);
    }
    expect(await client(() => json(404, { error: 'Not found' })).c.exchange(ORIGIN, CODE, VERIFIER)).toEqual({
      ok: false,
      kind: 'off',
    });
    expect(await client(() => json(502, {})).c.exchange(ORIGIN, CODE, VERIFIER)).toEqual({
      ok: false,
      kind: 'server',
    });
  });
});

describe('revoke', () => {
  it('DELETE /api/time/token with the stored token', async () => {
    const { c, seen } = client(() => json(200, { ok: true }));
    expect(await c.revoke()).toEqual({ ok: true, value: undefined });
    expect(seen[0]?.init.method).toBe('DELETE');
    expect(seen[0]?.url).toBe(`${ORIGIN}/api/time/token`);
  });

  it('revokeToken uses the token given and never marks lost', async () => {
    const other = `tds_time_${'f'.repeat(64)}`;
    const { c, seen, lost } = client(() => json(401, { error: 'unauthorised' }), { token: null });
    expect(await c.revokeToken('http://localhost:3000', other)).toEqual({ ok: false, kind: 'unauthorised' });
    expect(seen[0]?.url).toBe('http://localhost:3000/api/time/token');
    expect(headersOf(seen[0]?.init as RequestInit).authorization).toBe(`Bearer ${other}`);
    expect(lost).toEqual([]);
  });
});

describe('workItems', () => {
  it('returns valid items and skips broken ones', async () => {
    const item = {
      id: 'w1',
      name: 'Acme retainer',
      kind: 'retainer',
      cortexKey: 'acme/retainer',
      clientId: null,
    };
    const { c } = client(() =>
      json(200, {
        items: [item, { id: 'w2', name: 'x', kind: 'odd', cortexKey: null, clientId: null }, null],
      }),
    );
    expect(await c.workItems()).toEqual({ ok: true, value: [item] });
  });
});

describe('readDay', () => {
  const stored = {
    personId: 'p1',
    workDate: '2026-11-27',
    revision: 3,
    entries: [
      {
        id: '6f1c2f9e-1d2c-4a43-9a51-7d7d3c1f0a11',
        startAt: '2026-11-27T09:00:00.000Z',
        minutes: 30,
        workItemId: 'w1',
        description: 'Work',
        billable: true,
        source: 'cortex-chat',
        certainty: 'certain',
        personId: 'p1',
        workDate: '2026-11-27',
        deleted: false,
      },
    ],
  };

  it('reads { ok: true, day }', async () => {
    const { c, seen } = client(() => json(200, { ok: true, day: stored }));
    expect(await c.readDay('2026-11-27')).toEqual({ ok: true, value: stored });
    expect(seen[0]?.url).toBe(`${ORIGIN}/api/time/days/2026-11-27`);
  });

  it('refuses a bad date without calling', async () => {
    const { c, seen } = client(() => json(200, {}));
    expect(await c.readDay('2026-11-27/../x')).toMatchObject({
      ok: false,
      kind: 'error',
      code: 'invalid_request',
    });
    expect(seen).toEqual([]);
  });

  it('maps { ok:false } answers and a broken day', async () => {
    expect(
      await client(() => json(400, { ok: false, code: 'invalid', problems: [] })).c.readDay('2026-11-27'),
    ).toEqual({ ok: false, kind: 'error', code: 'invalid_request', status: 400 });
    expect(
      await client(() => json(403, { ok: false, code: 'forbidden', problems: [] })).c.readDay('2026-11-27'),
    ).toEqual({ ok: false, kind: 'forbidden' });
    expect(
      await client(() => json(200, { ok: true, day: { ...stored, revision: -1 } })).c.readDay('2026-11-27'),
    ).toEqual({ ok: false, kind: 'server' });
  });
});

describe('submitDay', () => {
  it('posts the body as JSON', async () => {
    const { c, seen } = client(() => json(200, { ok: true, revision: 1, repeated: false }));
    expect(await c.submitDay(SUBMISSION)).toEqual({
      ok: true,
      value: { ok: true, revision: 1, repeated: false },
    });
    expect(seen[0]?.url).toBe(`${ORIGIN}/api/time/days`);
    expect(seen[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual(SUBMISSION);
  });

  it('reads { ok:false, code } on 400, 403, 409 and 423 as a DayResult', async () => {
    for (const [status, code] of [
      [400, 'invalid'],
      [403, 'forbidden'],
      [409, 'conflict'],
      [423, 'locked'],
    ] as const) {
      const problems = [{ path: 'entries[0].minutes', message: 'Too long.' }];
      const { c, lost } = client(() => json(status, { ok: false, code, problems }));
      expect(await c.submitDay(SUBMISSION)).toEqual({ ok: true, value: { ok: false, code, problems } });
      expect(lost).toEqual([]);
    }
  });

  it('reads the { error } shape too', async () => {
    expect(await client(() => json(400, { error: 'invalid_request' })).c.submitDay(SUBMISSION)).toEqual({
      ok: false,
      kind: 'error',
      code: 'invalid_request',
      status: 400,
    });
    expect(await client(() => json(403, { error: 'forbidden' })).c.submitDay(SUBMISSION)).toEqual({
      ok: false,
      kind: 'forbidden',
    });
    const { c, lost } = client(() => json(401, { error: 'unauthorised' }));
    expect(await c.submitDay(SUBMISSION)).toEqual({ ok: false, kind: 'unauthorised' });
    expect(lost).toEqual(['unauthorised']);
    expect(await client(() => json(413, { error: 'too_large' })).c.submitDay(SUBMISSION)).toEqual({
      ok: false,
      kind: 'too-large',
    });
  });

  it('a broken DayResult is server', async () => {
    expect(await client(() => json(200, { ok: true, revision: 'one' })).c.submitDay(SUBMISSION)).toEqual({
      ok: false,
      kind: 'server',
    });
    expect(
      await client(() => json(409, { ok: false, code: 'nonsense', problems: [] })).c.submitDay(SUBMISSION),
    ).toEqual({ ok: false, kind: 'server' });
  });
});

describe('against a real socket', () => {
  let server: Server;
  let origin: string;
  let redirectTargetHit = 0;
  const hanging: Array<() => void> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/api/time/work-items') {
        res.writeHead(302, { Location: '/elsewhere' });
        res.end();
        return;
      }
      if (req.url === '/elsewhere') {
        redirectTargetHit += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"items":[]}');
        return;
      }
      if (req.url === '/api/time/days/2026-11-27') {
        // Never answers.
        hanging.push(() => res.destroy());
        return;
      }
      if (req.url === '/api/time/token') {
        // Streams more than the cap with no Content-Length.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const chunk = Buffer.alloc(64 * 1024, 0x20);
        let sent = 0;
        const pump = () => {
          while (sent <= TOOLBOX_MAX_ANSWER_BYTES + chunk.length) {
            sent += chunk.length;
            if (!res.write(chunk)) {
              res.once('drain', pump);
              return;
            }
          }
          res.end();
        };
        pump();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const h of hanging) h();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });

  it('a redirect is refused and never followed', async () => {
    const c = createToolboxClient({ tokens: tokens(), origin: () => origin });
    expect(await c.workItems()).toEqual({ ok: false, kind: 'network' });
    expect(redirectTargetHit).toBe(0);
  });

  it('a Toolbox that never answers times out as network', async () => {
    const c = createToolboxClient({ tokens: tokens(), origin: () => origin, timeoutMs: 100 });
    const started = Date.now();
    expect(await c.readDay('2026-11-27')).toEqual({ ok: false, kind: 'network' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('an answer over the cap, streamed, is too-large', async () => {
    const c = createToolboxClient({ tokens: tokens(), origin: () => origin });
    expect(await c.exchange(origin, CODE, VERIFIER)).toEqual({ ok: false, kind: 'too-large' });
  });
});
