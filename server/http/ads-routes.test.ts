// Ad Manager's routes (plan 2026-11-16-workbench-ad-manager, decisions 11, 12 and 18), sent over real HTTP to the
// real server, so every request passes the real security gate (checkRequest) first. The bridge is a stub service.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADS_ERROR_MESSAGES,
  ADS_ROUTES,
  type AdsCapabilities,
  type AdsChangeAction,
} from '../../shared/ads-contract.ts';
import {
  ADS_FOLDS_MAX,
  ADS_PREF_KEY_MAX,
  type Identity,
  SECTIONS_MAX,
  sessionCookieName,
} from '../../shared/contract.ts';
import { AdsError, type AdsInflightEntry, type AdsService } from '../brain/ads-skill.ts';
import { createBrainReaders } from '../brain/index.ts';
import { copyFixture } from '../brain/test-helpers.ts';
import { createAppStore } from '../store/app-store.ts';
import { type HttpError, validatePrefsPatch } from './routes.ts';
import { cookieValueFor, createAuthCodes } from './security.ts';
import { type AppServer, createAppServer } from './server.ts';

const PORT = 45879;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = 'launch-token-ads';
const COOKIE = `${sessionCookieName(PORT)}=${cookieValueFor(TOKEN)}`;
const ID = '20261116-01-pause-generic';

const CAPS: AdsCapabilities = {
  features: ['ads-v1'],
  version: '0.1',
  adsAccess: true,
  adsManager: true,
  me: { slug: 'rita-reviewer', name: 'Rita Reviewer', role: 'scout' },
};
const flags = {
  canDecide: false,
  canDryRun: true,
  canApply: true,
  canClientDraft: false,
  canRecordClientApproval: false,
  canRecordDecision: false,
};
const proposal = (id: string) => ({
  id,
  file: `clients/acme/proposals/${id}.md`,
  fm: { id },
  warnings: [],
  flags,
});

const rita: Identity = {
  name: 'Rita Reviewer',
  slug: 'rita-reviewer',
  email: null,
  role: 'scout',
  knownMember: true,
};
// What the stub saw, and what it answers.
const seen = {
  reads: [] as [string, unknown][],
  changes: [] as [string, unknown][],
  cleared: [] as string[],
};
let state: {
  caps: AdsCapabilities | null;
  access: 'allowed' | 'restricted' | 'unknown-skill';
  identity: Identity;
  inflight: AdsInflightEntry[];
  changeError: AdsError | null;
  hasAds: boolean;
} = { caps: CAPS, access: 'allowed', identity: rita, inflight: [], changeError: null, hasAds: true };

const stub: AdsService = {
  capabilities: async () => state.caps,
  read: async (action, input) => {
    seen.reads.push([action, input]);
    if (action === 'approvals')
      return {
        me: CAPS.me,
        generatedAt: 'now',
        waiting: 1,
        toApply: 1,
        clients: [{ slug: 'acme', open: [proposal(ID)], recent: [] }],
      };
    if (action === 'proposal') return { proposal: { ...proposal(String(input.id)), body: 'b' } };
    if (action === 'accounts')
      return { accounts: [{ key: 'acme', name: 'Acme', currency: 'GBP', waiting: 1, supervised: true }] };
    if (action === 'board') return { board: { key: input.account } };
    return { brief: { ymd: null, date: null, headline: null, recommendations: [] } };
  },
  change: async (action, input) => {
    seen.changes.push([action, input]);
    if (state.changeError) throw state.changeError;
    return { message: 'done', proposal: { ...proposal(ID), body: 'b' } };
  },
  inflight: async () => state.inflight,
  clearInflight: async (client, id) => {
    seen.cleared.push(`${client}/${id}`);
  },
  onChange: () => () => {},
  changed: () => {},
};

let app: AppServer;
let listenPort: number;

beforeAll(async () => {
  const real = createBrainReaders(copyFixture());
  const brain = {
    ...real,
    identity: async () => state.identity,
    skillAccess: async (_i: Identity, name: string) => (name === 'tdsapp-ads' ? state.access : 'allowed'),
    get ads() {
      return state.hasAds ? stub : undefined;
    },
  };
  app = createAppServer({
    port: PORT,
    clientDir: '/nonexistent',
    launchToken: TOKEN,
    authCodes: createAuthCodes(TOKEN),
    appVersion: '0',
    underService: false,
    brain: brain as never,
    store: {} as never,
    sessions: { onChange: () => () => {} } as never,
    thumbs: {} as never,
    uploads: {} as never,
    engineHealth: () => ({}) as never,
    appState: { kind: 'ready' },
    setup: {} as never,
  });
  await new Promise<void>((done) => app.server.listen(0, '127.0.0.1', done));
  listenPort = (app.server.address() as AddressInfo).port;
});
afterAll(async () => {
  app.stop();
  await new Promise((done) => app.server.close(done));
});
beforeEach(() => {
  state = { caps: CAPS, access: 'allowed', identity: rita, inflight: [], changeError: null, hasAds: true };
  seen.reads.length = 0;
  seen.changes.length = 0;
  seen.cleared.length = 0;
});

interface Reply {
  status: number;
  json: Record<string, unknown> & { error?: { code: string; message: string; output?: string } };
}
function send(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  return new Promise<Reply>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: listenPort,
        path,
        method: opts.method ?? 'GET',
        headers: { host: HOST, ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let json: Reply['json'] = {};
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    req.end(opts.body === undefined ? undefined : JSON.stringify(opts.body));
  });
}
const get = (path: string) => send(path, { headers: { cookie: COOKIE } });
const post = (path: string, body: unknown) =>
  send(path, {
    method: 'POST',
    headers: { cookie: COOKIE, origin: `http://${HOST}`, 'content-type': 'application/json' },
    body,
  });

const READS = [
  ADS_ROUTES.capabilities,
  ADS_ROUTES.accounts,
  `${ADS_ROUTES.approvals}?client=acme`,
  `${ADS_ROUTES.proposal}?client=acme&id=${ID}`,
  `${ADS_ROUTES.board}?account=acme`,
  `${ADS_ROUTES.standupBrief}?account=acme`,
  `${ADS_ROUTES.file}?p=clients/acme-heating/reports/2026-10-summary.pdf`,
];
const CHANGES: [AdsChangeAction, Record<string, unknown>][] = [
  ['decide', { client: 'acme', id: ID, action: 'approve' }],
  ['dry-run', { client: 'acme', id: ID }],
  ['apply', { client: 'acme', id: ID, confirmed: true }],
  ['client-draft', { client: 'acme', id: ID }],
  ['client-approved', { client: 'acme', id: ID, who: 'Mark' }],
  ['decided', { client: 'acme', id: ID, note: 'x' }],
  ['sign-monthly', { client: 'acme', month: '2026-10' }],
  ['standup-setup', { account: 'acme' }],
  [
    'standup-feedback',
    { account: 'acme', date: '20261115', campaign: 'G', action_category: 'NONE', score: 3 },
  ],
];

describe('the security gate', () => {
  it('every ads read needs the session, and refuses another site', async () => {
    for (const path of READS) {
      expect((await send(path)).status, path).toBe(401);
      const cross = await send(path, { headers: { cookie: COOKIE, 'sec-fetch-site': 'cross-site' } });
      expect(cross.status, path).toBe(403);
      expect((await get(path)).status, path).toBe(200);
    }
  });

  it('every ads change needs the session, the app origin and JSON', async () => {
    const paths = [...CHANGES.map(([a]) => ADS_ROUTES.change(a)), ADS_ROUTES.clearInflight];
    for (const path of paths) {
      const noCookie = await send(path, {
        method: 'POST',
        headers: { origin: `http://${HOST}`, 'content-type': 'application/json' },
        body: {},
      });
      expect(noCookie.status, path).toBe(401);
      const evil = await send(path, {
        method: 'POST',
        headers: { cookie: COOKIE, origin: 'https://evil.example', 'content-type': 'application/json' },
        body: {},
      });
      expect(evil.status, path).toBe(403);
      const form = await send(path, {
        method: 'POST',
        headers: { cookie: COOKIE, origin: `http://${HOST}`, 'content-type': 'text/plain' },
        body: {},
      });
      expect(form.status, path).toBe(415);
    }
    expect(seen.changes).toEqual([]);
    for (const [action, body] of CHANGES)
      expect((await post(ADS_ROUTES.change(action), body)).status, action).toBe(200);
    expect(seen.changes.map(([a]) => a)).toEqual(CHANGES.map(([a]) => a));
  });

  it('reads are GET and changes are POST only', async () => {
    expect((await post(ADS_ROUTES.approvals, {})).status).toBe(405);
    expect((await get(ADS_ROUTES.change('apply'))).status).toBe(405);
    expect((await post('/api/ads/do/explode', {})).status).toBe(404);
  });
});

describe('who sees Ad Manager (decision 11)', () => {
  it('capabilities are empty unless the skill is allowed for this person and the bridge is there', async () => {
    expect((await get(ADS_ROUTES.capabilities)).json).toEqual(CAPS);
    const empty = { features: [], version: '', adsAccess: false, adsManager: false, me: null };
    state.access = 'restricted';
    expect((await get(ADS_ROUTES.capabilities)).json).toEqual(empty);
    state.access = 'unknown-skill';
    expect((await get(ADS_ROUTES.capabilities)).json).toEqual(empty);
    state.access = 'allowed';
    state.caps = null;
    expect((await get(ADS_ROUTES.capabilities)).json).toEqual(empty);
    state.hasAds = false;
    expect((await get(ADS_ROUTES.capabilities)).json).toEqual(empty);
  });

  it('every other route refuses when the skill is restricted or missing', async () => {
    state.access = 'restricted';
    const r = await get(`${ADS_ROUTES.board}?account=acme`);
    expect(r.status).toBe(403);
    expect(r.json.error).toEqual({ code: 'not-allowed', message: ADS_ERROR_MESSAGES['not-allowed'] });
    expect((await post(ADS_ROUTES.change('decide'), CHANGES[0]?.[1])).status).toBe(403);
    state.access = 'unknown-skill';
    const u = await get(ADS_ROUTES.accounts);
    expect(u.status).toBe(503);
    expect(u.json.error?.code).toBe('unavailable');
    state.access = 'allowed';
    state.hasAds = false;
    expect((await get(ADS_ROUTES.accounts)).status).toBe(503);
    expect(seen.reads).toEqual([]);
    expect(seen.changes).toEqual([]);
  });
});

describe('changes', () => {
  it("are refused when the bridge's person isn't the app's person (decision 10)", async () => {
    state.identity = { ...rita, slug: 'sam-scout', name: 'Sam Scout' };
    const r = await post(ADS_ROUTES.change('approve' as never), {});
    expect(r.status).toBe(404);
    const d = await post(ADS_ROUTES.change('decide'), CHANGES[0]?.[1]);
    expect(d.status).toBe(403);
    expect(d.json.error?.code).toBe('not-allowed');
    state.caps = { ...CAPS, me: null };
    state.identity = rita;
    expect((await post(ADS_ROUTES.change('decide'), CHANGES[0]?.[1])).status).toBe(403);
    expect(seen.changes).toEqual([]);
  });

  it('pass on only the fields the action takes, never an actor', async () => {
    await post(ADS_ROUTES.change('decide'), {
      client: 'acme',
      id: ID,
      action: 'reject',
      note: 'No',
      by: 'olive-owner',
      as: 'olive-owner',
    });
    expect(seen.changes[0]).toEqual(['decide', { client: 'acme', id: ID, action: 'reject', note: 'No' }]);
    expect((await post(ADS_ROUTES.change('decide'), [])).status).toBe(400);
  });

  it("an apply with an unknown outcome says so in the bridge's code, with the app's words", async () => {
    state.changeError = new AdsError('unknown-outcome', 'still running');
    const r = await post(ADS_ROUTES.change('apply'), { client: 'acme', id: ID, confirmed: true });
    expect(r.status).toBe(504);
    expect(r.json.error).toEqual({ code: 'unknown-outcome', message: ADS_ERROR_MESSAGES['unknown-outcome'] });
    expect(seen.changes).toHaveLength(1);
  });

  it('an unknown outcome passes on what the run printed, so the person can see what the read-back found', async () => {
    state.changeError = new AdsError('unknown-outcome', 'read-back disagreed', 'gads-write: read-back MISMATCH');
    const r = await post(ADS_ROUTES.change('apply'), { client: 'acme', id: ID, confirmed: true });
    expect(r.status).toBe(504);
    expect(r.json.error).toEqual({
      code: 'unknown-outcome',
      message: ADS_ERROR_MESSAGES['unknown-outcome'],
      output: 'gads-write: read-back MISMATCH',
    });
    // Other refusals never carry output.
    state.changeError = new AdsError('changed', 'x', 'secret-ish output');
    const c = await post(ADS_ROUTES.change('apply'), { client: 'acme', id: ID, confirmed: true });
    expect(c.json.error?.output).toBeUndefined();
  });

  it('the accounts list is refused on a Mac without Google Ads access, so search offers nothing', async () => {
    state.caps = { ...CAPS, adsAccess: false };
    const r = await get(ADS_ROUTES.accounts);
    expect(r.status).toBe(403);
    expect(r.json.error?.code).toBe('no-access');
    expect(seen.reads.filter(([a]) => a === 'accounts')).toHaveLength(0);
  });

  it('the reply marks a proposal still in flight', async () => {
    state.inflight = [{ client: 'acme', id: ID, pid: 1, startedAt: 'x' }];
    const r = await post(ADS_ROUTES.change('dry-run'), { client: 'acme', id: ID });
    const p = r.json.proposal as { flags: Record<string, boolean> };
    expect(p.flags).toMatchObject({ canApply: false, inflight: true });
  });
});

describe('reads', () => {
  it('approvals and proposal turn Apply off for a proposal in flight', async () => {
    const ok = await get(`${ADS_ROUTES.approvals}?client=acme`);
    const open = (ok.json.clients as { open: { flags: Record<string, unknown> }[] }[])[0]?.open[0];
    expect(open?.flags.canApply).toBe(true);
    expect(open?.flags.inflight).toBeUndefined();
    state.inflight = [{ client: 'acme', id: ID, pid: null, startedAt: 'x' }];
    const held = await get(`${ADS_ROUTES.approvals}`);
    const flagsHeld = (held.json.clients as { open: { flags: Record<string, unknown> }[] }[])[0]?.open[0]
      ?.flags;
    expect(flagsHeld).toMatchObject({ canApply: false, inflight: true });
    const one = await get(`${ADS_ROUTES.proposal}?client=acme&id=${ID}`);
    expect((one.json as { flags: Record<string, unknown> }).flags).toMatchObject({
      canApply: false,
      inflight: true,
    });
    expect(seen.reads.map(([a]) => a)).toEqual(['approvals', 'approvals', 'proposal']);
    expect(seen.reads[1]?.[1]).toEqual({});
  });

  it('return the shapes the contract names, and refuse bad arguments before the bridge runs', async () => {
    expect((await get(ADS_ROUTES.accounts)).json).toEqual([
      { key: 'acme', name: 'Acme', currency: 'GBP', waiting: 1, supervised: true },
    ]);
    expect((await get(`${ADS_ROUTES.board}?account=acme`)).json).toEqual({ key: 'acme' });
    expect((await get(`${ADS_ROUTES.standupBrief}?account=acme`)).json).toMatchObject({
      recommendations: [],
    });
    seen.reads.length = 0;
    for (const path of [
      `${ADS_ROUTES.board}?account=../x`,
      `${ADS_ROUTES.board}`,
      `${ADS_ROUTES.proposal}?client=acme&id=nope`,
      `${ADS_ROUTES.proposal}?client=Acme&id=${ID}`,
      `${ADS_ROUTES.approvals}?client=a/b`,
      `${ADS_ROUTES.standupBrief}?account=`,
    ]) {
      const r = await get(path);
      expect(r.status, path).toBe(400);
      expect(r.json.error?.code, path).toBe('bad-request');
    }
    expect(seen.reads).toEqual([]);
  });
});

describe('clearing an unknown outcome', () => {
  it('forgets the entry; bad ids are refused', async () => {
    expect((await post(ADS_ROUTES.clearInflight, { client: 'acme', id: ID })).json).toEqual({ ok: true });
    expect(seen.cleared).toEqual([`acme/${ID}`]);
    expect((await post(ADS_ROUTES.clearInflight, { client: 'acme', id: '../x' })).status).toBe(400);
    expect((await post(ADS_ROUTES.clearInflight, { client: 'acme' })).status).toBe(400);
  });
});

describe('the file route (decision 18)', () => {
  it('returns the library item for an ads file', async () => {
    const r = await get(
      `${ADS_ROUTES.file}?p=${encodeURIComponent('clients/acme-heating/reports/2026-10-summary.pdf')}`,
    );
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      path: 'clients/acme-heating/reports/2026-10-summary.pdf',
      kind: 'document',
    });
    expect(typeof r.json.id).toBe('string');
  });

  it('refuses .., other folders, other extensions and files outside the library', async () => {
    const bad = [
      'clients/acme-heating/reports/../profile.md',
      'clients/acme-heating/reports/./x.pdf',
      'clients/acme-heating/notes/2026-11-01-call-follow-up.md',
      'clients/acme-heating/reports/run.js',
      'clients/Acme/reports/x.pdf',
      '/etc/passwd',
      'personal/reports/x.pdf',
      '',
    ];
    for (const p of bad) {
      const r = await get(`${ADS_ROUTES.file}?p=${encodeURIComponent(p)}`);
      expect(r.status, p).toBe(400);
    }
    for (const p of ['clients/acme-heating/reports/.draft.md', 'clients/acme-heating/reports/missing.pdf']) {
      const r = await get(`${ADS_ROUTES.file}?p=${encodeURIComponent(p)}`);
      expect(r.status, p).toBe(404);
      expect(r.json.error?.code).toBe('not-found');
    }
  });
});

describe('prefs for the Workbench and Ad Manager (decision 21)', () => {
  const brainClients = { clients: async () => [] };
  const ok = (body: unknown) => validatePrefsPatch(body, brainClients as never);
  async function refused(body: unknown): Promise<number> {
    try {
      await ok(body);
      return 200;
    } catch (err) {
      return (err as HttpError).status;
    }
  }

  it('accepts valid lastTool, adsAccount and adsFolds', async () => {
    expect(
      await ok({
        lastTool: { workbench: 'ad-manager' },
        adsAccount: 'Gamma_Co',
        adsFolds: { 'acme:recent': true },
      }),
    ).toEqual({
      lastTool: { workbench: 'ad-manager' },
      adsAccount: 'Gamma_Co',
      adsFolds: { 'acme:recent': true },
    });
    expect(await ok({ adsAccount: null })).toEqual({ adsAccount: null });
  });

  it('refuses bad values and too many entries', async () => {
    const many = (n: number, v: unknown) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, v]));
    for (const body of [
      { lastTool: { Workbench: 'x' } },
      { lastTool: { workbench: 'Ad Manager' } },
      { lastTool: ['workbench'] },
      { lastTool: many(SECTIONS_MAX + 1, 'x') },
      { adsAccount: '../acme' },
      { adsAccount: 'x'.repeat(ADS_PREF_KEY_MAX + 1) },
      { adsAccount: 3 },
      { adsFolds: { 'acme:open': 'yes' } },
      { adsFolds: { ['x'.repeat(ADS_PREF_KEY_MAX + 1)]: true } },
      { adsFolds: many(ADS_FOLDS_MAX + 1, true) },
    ])
      expect(await refused(body), JSON.stringify(body).slice(0, 80)).toBe(400);
  });

  it('the store keeps them, drops bad entries from a hand-edited file, and an old file reads as before', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ads-prefs-'));
    try {
      const store = createAppStore(dir);
      const before = await store.get();
      expect(before).not.toHaveProperty('lastTool');
      expect(before).not.toHaveProperty('adsFolds');
      const after = await store.update({
        lastTool: { workbench: 'ad-manager' },
        adsAccount: 'acme',
        adsFolds: { 'acme:open': false },
      });
      expect(after).toMatchObject({
        lastTool: { workbench: 'ad-manager' },
        adsAccount: 'acme',
        adsFolds: { 'acme:open': false },
      });
      expect(await store.update({ pins: [] })).toMatchObject({ adsAccount: 'acme' });
      writeFileSync(
        join(dir, 'prefs.json'),
        JSON.stringify({
          lastTool: { workbench: 'ad-manager', 'BAD KEY': 'x' },
          adsAccount: '../x',
          adsFolds: { a: true, b: 'no' },
        }),
      );
      const read = await createAppStore(dir).get();
      expect(read.lastTool).toEqual({ workbench: 'ad-manager' });
      expect(read).not.toHaveProperty('adsAccount');
      expect(read.adsFolds).toEqual({ a: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
