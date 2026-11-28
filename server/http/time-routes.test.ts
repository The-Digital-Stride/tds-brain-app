// My day's routes (plan 2026-11-28-time-my-day, decision 14), sent over real HTTP to `handleApi` with a fake
// TimeService. The request gate is tested elsewhere (security.test.ts); here only the routes' own rules.
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Identity } from '../../shared/contract.ts';
import { type DayView, TIME_ROUTES, type TimeService } from '../../shared/time-contract.ts';
import { handleApi, type RouteContext } from './routes.ts';

const ID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const DATE = '2026-11-27';

const DAY: DayView = {
  workDate: DATE,
  status: 'not-confirmed',
  revision: 0,
  entries: [],
  totalMinutes: 0,
  totals: [],
  gaps: [],
  dayProblems: [],
  confirmBlocked: null,
  captureNotes: [],
  privateAllowed: true,
};
const STATUS = {
  connection: { state: 'no-address' },
  address: { url: null, source: 'default' },
  earliest: '2026-09-26',
  today: '2026-11-28',
};

let role: Identity['role'];
let calls: Array<[string, ...unknown[]]>;
let failWith: unknown;
let withService: boolean;

function fake(): TimeService {
  const rec =
    <T>(name: string, answer: T) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      if (failWith) throw failWith;
      return answer;
    };
  return {
    status: rec('status', STATUS),
    connect: rec('connect', { url: 'http://localhost:3000/time-connect' }),
    disconnect: rec('disconnect', STATUS),
    setAddress: rec('setAddress', STATUS),
    callback: rec('callback', { ok: true }),
    workItems: rec('workItems', { items: [], fetchedAt: null }),
    day: rec('day', DAY),
    refresh: rec('refresh', DAY),
    addEntry: rec('addEntry', DAY),
    changeEntry: rec('changeEntry', DAY),
    deleteEntry: rec('deleteEntry', DAY),
    confirm: rec('confirm', { outcome: 'confirmed', day: DAY, repeated: false }),
  } as unknown as TimeService;
}

let server: Server;
let port: number;
const logged: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const ctx = {
      brain: {
        identity: async (): Promise<Identity> => ({
          name: 'Sam Example',
          slug: 'sam-example',
          email: null,
          role,
          knownMember: true,
        }),
      },
      time: withService ? fake() : undefined,
      log: (line: string) => logged.push(line),
    } as unknown as RouteContext;
    void handleApi(req, res, new URL(req.url ?? '/', 'http://127.0.0.1'), ctx);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise((done) => server.close(done));
});
beforeEach(() => {
  role = 'owner';
  calls = [];
  failWith = null;
  withService = true;
  logged.length = 0;
});

interface Reply {
  status: number;
  cache: string | undefined;
  json: Record<string, unknown> & { error?: { code: string; message: string } };
}
function send(path: string, method = 'GET', body?: unknown): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        let json: Reply['json'] = {};
        try {
          json = JSON.parse(Buffer.concat(chunks).toString());
        } catch {}
        resolve({ status: res.statusCode ?? 0, cache: res.headers['cache-control'], json });
      });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const VALUES = {
  startAt: '2026-11-27T09:00:00+00:00',
  minutes: 30,
  workItemId: 'wi-1',
  description: 'Planning',
  billable: true,
};

describe('who may use the time routes', () => {
  it.each(['team', 'unknown'] as const)('answers 404 for a %s', async (r) => {
    role = r;
    const reply = await send(TIME_ROUTES.status);
    expect(reply.status).toBe(404);
    expect(reply.json.error?.code).toBe('not-found');
    expect(calls).toEqual([]);
  });

  it('answers 404 when the build has no TimeService', async () => {
    withService = false;
    expect((await send(TIME_ROUTES.status)).status).toBe(404);
  });

  it.each(['owner', 'scout'] as const)('lets a %s in, with no caching', async (r) => {
    role = r;
    const reply = await send(TIME_ROUTES.status);
    expect(reply.status).toBe(200);
    expect(reply.cache).toBe('no-store');
    expect(reply.json.today).toBe('2026-11-28');
  });
});

describe('the happy paths', () => {
  it('connects, disconnects and sets the address', async () => {
    expect((await send(TIME_ROUTES.connect, 'POST', {})).json.url).toContain('time-connect');
    expect((await send(TIME_ROUTES.disconnect, 'POST', {})).status).toBe(200);
    expect((await send(TIME_ROUTES.address, 'POST', { url: ' https://toolbox.example ' })).status).toBe(200);
    expect((await send(TIME_ROUTES.address, 'POST', { url: null })).status).toBe(200);
    expect(calls.map((c) => c[0])).toEqual(['connect', 'disconnect', 'setAddress', 'setAddress']);
    expect(calls[2]?.[1]).toBe('https://toolbox.example');
    expect(calls[3]?.[1]).toBeNull();
  });

  it('lists work items, with refresh only on ?refresh=1', async () => {
    await send(TIME_ROUTES.workItems);
    await send(`${TIME_ROUTES.workItems}?refresh=1`);
    expect(calls).toEqual([
      ['workItems', false],
      ['workItems', true],
    ]);
  });

  it('reads, refreshes and confirms a day', async () => {
    expect((await send(TIME_ROUTES.day(DATE))).json.workDate).toBe(DATE);
    expect((await send(TIME_ROUTES.refresh(DATE), 'POST', {})).status).toBe(200);
    expect((await send(TIME_ROUTES.confirm(DATE), 'POST', {})).json.outcome).toBe('confirmed');
    expect(calls.map((c) => c[0])).toEqual(['day', 'refresh', 'confirm']);
  });

  it('adds, changes and deletes an entry', async () => {
    expect((await send(TIME_ROUTES.entries(DATE), 'POST', { values: VALUES })).status).toBe(200);
    const patch = { description: 'New', minutes: 45, remember: false, privateEdit: true };
    expect((await send(TIME_ROUTES.entry(DATE, ID), 'PATCH', patch)).status).toBe(200);
    expect((await send(TIME_ROUTES.entry(DATE, ID), 'DELETE')).status).toBe(200);
    expect((await send(`${TIME_ROUTES.entry(DATE, ID)}?private=1`, 'DELETE')).status).toBe(200);
    expect(calls).toEqual([
      ['addEntry', DATE, { values: VALUES }],
      ['changeEntry', DATE, ID, patch],
      ['deleteEntry', DATE, ID, { private: false }],
      ['deleteEntry', DATE, ID, { private: true }],
    ]);
  });

  it('accepts a null start time and a null work item', async () => {
    const values = { ...VALUES, startAt: null, workItemId: null };
    expect((await send(TIME_ROUTES.entries(DATE), 'POST', { values })).status).toBe(200);
    expect(
      (await send(TIME_ROUTES.entry(DATE, ID), 'PATCH', { startAt: null, workItemId: null })).status,
    ).toBe(200);
  });
});

describe('bad input', () => {
  it.each(['2026-13-01', '2026-02-30'])('refuses the date %s', async (d) => {
    const reply = await send(TIME_ROUTES.day(d));
    expect(reply.status).toBe(400);
    expect(reply.json.error?.code).toBe('bad-request');
  });

  it('refuses an entry id that is not a lower-case UUID', async () => {
    expect((await send(TIME_ROUTES.entry(DATE, 'nope'), 'PATCH', { minutes: 5 })).status).toBe(400);
    expect((await send(TIME_ROUTES.entry(DATE, ID.toUpperCase()), 'DELETE')).status).toBe(400);
  });

  it.each([
    ['minutes 0', { ...VALUES, minutes: 0 }],
    ['minutes 1441', { ...VALUES, minutes: 1441 }],
    ['minutes 1.5', { ...VALUES, minutes: 1.5 }],
    ['minutes as text', { ...VALUES, minutes: '30' }],
    ['description 1001 long', { ...VALUES, description: 'x'.repeat(1001) }],
    ['start with no offset', { ...VALUES, startAt: '2026-11-27T09:00:00' }],
    ['start that is not a date', { ...VALUES, startAt: 'yesterday' }],
    ['work item as a number', { ...VALUES, workItemId: 7 }],
    ['billable as text', { ...VALUES, billable: 'yes' }],
  ])('refuses a new entry with %s', async (_label, values) => {
    const reply = await send(TIME_ROUTES.entries(DATE), 'POST', { values });
    expect(reply.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('refuses a new entry with no values', async () => {
    expect((await send(TIME_ROUTES.entries(DATE), 'POST', {})).status).toBe(400);
  });

  it.each([
    ['nothing to change', {}],
    ['an unknown field', { colour: 'red' }],
    ['description over the limit', { description: 'x'.repeat(1001) }],
    ['minutes out of range', { minutes: 2000 }],
    ['remember as text', { remember: 'yes' }],
    ['privateEdit as text', { privateEdit: 1 }],
  ])('refuses a change with %s', async (_label, patch) => {
    expect((await send(TIME_ROUTES.entry(DATE, ID), 'PATCH', patch)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('refuses a delete query it does not know', async () => {
    expect((await send(`${TIME_ROUTES.entry(DATE, ID)}?private=2`, 'DELETE')).status).toBe(400);
  });

  it('refuses an address that is not text or null', async () => {
    expect((await send(TIME_ROUTES.address, 'POST', { url: 5 })).status).toBe(400);
    expect((await send(TIME_ROUTES.address, 'POST', {})).status).toBe(400);
  });

  it('refuses the wrong method', async () => {
    expect((await send(TIME_ROUTES.status, 'POST', {})).status).toBe(405);
    expect((await send(TIME_ROUTES.confirm(DATE), 'GET')).status).toBe(405);
  });

  it('answers 404 for an unknown time address', async () => {
    expect((await send('/api/time/nothing')).status).toBe(404);
    expect((await send(`/api/time/day/${DATE}/other`)).status).toBe(404);
  });
});

describe('errors from the service', () => {
  it('maps bad-request to 400 and not-found to 404, keeping the message', async () => {
    failWith = { code: 'bad-request', message: 'That day is too far back.' };
    const a = await send(TIME_ROUTES.day(DATE));
    expect(a.status).toBe(400);
    expect(a.json.error).toEqual({ code: 'bad-request', message: 'That day is too far back.' });
    failWith = { code: 'not-found', message: 'That entry is not on this day.' };
    const b = await send(TIME_ROUTES.entry(DATE, ID), 'PATCH', { minutes: 5 });
    expect(b.status).toBe(404);
    expect(b.json.error?.code).toBe('not-found');
  });

  it('answers 500 with no detail for anything else, and logs the route only', async () => {
    failWith = new Error('secret detail: token tds_time_abc');
    const reply = await send(TIME_ROUTES.day(DATE));
    expect(reply.status).toBe(500);
    expect(reply.json.error?.code).toBe('internal');
    expect(JSON.stringify(reply.json)).not.toContain('secret');
    expect(logged.join(' ')).not.toContain('secret');
    expect(logged.join(' ')).not.toContain(DATE);
  });
});
