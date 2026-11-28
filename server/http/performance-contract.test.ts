/**
 * Settings → Performance through the server's real request gate (host, session cookie, origin, JSON content type)
 * and then the route, so a missing header or a role slip fails here. Route tests that skip `checkRequest` once
 * missed a 415 on every request.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ROUTES, SESSION_COOKIE } from '../../shared/contract.ts';
import type { PerformanceReport } from '../../shared/performance-contract.ts';
import { createDemoPerformance } from '../performance/demo.ts';
import type { PerformanceService } from '../performance/refresh.ts';
import { handleApi, type RouteContext } from './routes.ts';
import { checkRequest, cookieValueFor } from './security.ts';

const PORT = 3877;
const TOKEN = 'launch-token-abc123';

const REPORT: PerformanceReport = {
  status: 'never-run',
  refreshing: false,
  updatedAt: null,
  historyFrom: null,
  completeFrom: null,
  pricesChecked: '2026-11-28',
};

function fakeService() {
  let running = false;
  const calls = { report: 0, start: 0, refreshes: 0 };
  const service: PerformanceService = {
    report: async () => {
      calls.report++;
      return { ...REPORT, refreshing: running, status: running ? 'building' : 'never-run' };
    },
    start: async () => {
      calls.start++;
      if (!running) {
        running = true;
        calls.refreshes++;
      }
      return { ...REPORT, refreshing: true, status: 'building' };
    },
    refreshNow: async () => {},
    dueToday: async () => true,
  };
  return { service, calls };
}

async function call(method: string, path: string, role: string, service: PerformanceService | undefined) {
  const gate = checkRequest(
    {
      method,
      path,
      headers: {
        host: `127.0.0.1:${PORT}`,
        origin: `http://127.0.0.1:${PORT}`,
        'content-type': 'application/json',
        cookie: `${SESSION_COOKIE}=${cookieValueFor(TOKEN)}`,
      },
    },
    { port: PORT, launchToken: TOKEN },
  );
  expect(gate).toEqual({ action: 'allow' });
  const ctx = {
    brain: {
      root: '/x',
      identity: async () => ({
        name: 'Sam',
        slug: 'sam',
        email: null,
        role,
        knownMember: role !== 'unknown',
      }),
    },
    performance: service,
    log: () => {},
  };
  const req = Object.assign(Readable.from([]), { method, headers: { 'content-type': 'application/json' } });
  const sent = { status: 0, body: '' };
  const res = {
    headersSent: false,
    writeHead: (s: number) => {
      sent.status = s;
    },
    end: (t: string) => {
      sent.body = t;
    },
  };
  await handleApi(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    new URL(`http://127.0.0.1:${PORT}${path}`),
    ctx as unknown as RouteContext,
  );
  return { status: sent.status, json: sent.body ? JSON.parse(sent.body) : null };
}

describe('Performance routes through the real gate', () => {
  for (const role of ['owner', 'scout']) {
    it(`${role}: GET and POST are allowed`, async () => {
      const { service } = fakeService();
      const get = await call('GET', ROUTES.performance, role, service);
      expect(get.status).toBe(200);
      expect(get.json.status).toBe('never-run');
      const post = await call('POST', ROUTES.performanceRefresh, role, service);
      expect(post.status).toBe(200);
      expect(post.json).toMatchObject({ status: 'building', refreshing: true });
    });
  }

  for (const role of ['team', 'unknown']) {
    it(`${role}: 403 not-allowed on both, and nothing runs`, async () => {
      const { service, calls } = fakeService();
      const get = await call('GET', ROUTES.performance, role, service);
      const post = await call('POST', ROUTES.performanceRefresh, role, service);
      expect(get.status).toBe(403);
      expect(get.json.error.code).toBe('not-allowed');
      expect(post.status).toBe(403);
      expect(calls).toEqual({ report: 0, start: 0, refreshes: 0 });
    });
  }

  it('a second Update now press while one runs does not start another', async () => {
    const { service, calls } = fakeService();
    await call('POST', ROUTES.performanceRefresh, 'owner', service);
    const second = await call('POST', ROUTES.performanceRefresh, 'owner', service);
    expect(second.json.refreshing).toBe(true);
    expect(calls.refreshes).toBe(1);
  });

  it('wrong methods are refused, and no service answers 404', async () => {
    const { service } = fakeService();
    expect((await call('POST', ROUTES.performance, 'owner', service)).status).toBe(405);
    expect((await call('GET', ROUTES.performanceRefresh, 'owner', service)).status).toBe(405);
    expect((await call('GET', ROUTES.performance, 'owner', undefined)).status).toBe(404);
  });

  it('demo mode answers the made-up sample', async () => {
    const demo = createDemoPerformance(() => new Date(2026, 10, 28, 10));
    const r = await call('GET', ROUTES.performance, 'owner', demo);
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ready');
    expect(Object.keys(r.json.views)).toEqual(['7', '30', '90']);
    expect(r.json.completeFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
