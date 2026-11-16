// The app's side of the tdsapp-ads bridge (plan 2026-11-16-workbench-ad-manager, decisions 11 and 12), against a
// fake bridge script whose replies, delays and exits a control file sets. Never runs the real bridge or apply.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ADS_CAPABILITY, ADS_INFLIGHT_FILE, ADS_SKILL } from '../../shared/ads-contract.ts';
import { AdsError, type AdsServiceOptions, createAdsService } from './ads-skill.ts';
import { runScriptDetached, withDefaults } from './skill-runner.ts';
import { isAdsPath, watchBrain } from './watch.ts';

const made: string[] = [];
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(d);
  return d;
}

// The fake bridge: `ctl.json` maps an action to { reply, exit, delayMs, out }; every run is logged with its
// start and end times, and `done-<action>` is written when a delayed run finishes.
const FAKE = `
const fs = require('fs'); const path = require('path');
const root = process.env.BRAIN_ROOT;
const action = process.argv[2];
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  let ctl = {};
  try { ctl = JSON.parse(fs.readFileSync(path.join(root, 'ctl.json'), 'utf8')); } catch {}
  const c = ctl[action] || {};
  const start = Date.now();
  const finish = () => {
    fs.appendFileSync(path.join(root, 'runs.log'), JSON.stringify({ action, input: JSON.parse(input || '{}'), pid: process.pid, start, end: Date.now() }) + '\\n');
    fs.writeFileSync(path.join(root, 'done-' + action), String(Date.now()));
    const reply = c.out !== undefined ? c.out : JSON.stringify(c.reply || (action === 'capabilities'
      ? { ok: true, action, version: '0.1', features: ['ads-v1'], adsAccess: true, adsManager: true, me: { slug: 'rita-reviewer', name: 'Rita Reviewer', role: 'team' } }
      : { ok: true, action, message: 'done ' + action })) + '\\n';
    process.stdout.write(reply);
    process.exitCode = c.exit || 0;
  };
  if (c.delayMs) setTimeout(finish, c.delayMs); else finish();
});
`;

interface Run {
  action: string;
  input: Record<string, unknown>;
  pid: number;
  start: number;
  end: number;
}

function brain(ctl: Record<string, unknown> = {}): { root: string; dataDir: string } {
  const root = tempDir('ads-svc-brain-');
  const dataDir = tempDir('ads-svc-data-');
  mkdirSync(join(root, '.claude', 'skills', 'tdsapp-ads', 'scripts'), { recursive: true });
  writeFileSync(join(root, ADS_SKILL.script), FAKE);
  writeFileSync(join(root, 'ctl.json'), JSON.stringify(ctl));
  return { root, dataDir };
}
const runs = (root: string): Run[] =>
  existsSync(join(root, 'runs.log'))
    ? readFileSync(join(root, 'runs.log'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Run)
    : [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(25);
  }
}
const opts = (dataDir: string, more: AdsServiceOptions = {}): AdsServiceOptions => ({
  env: { PATH: process.env.PATH },
  dataDir,
  ...more,
});
const APPLY = { client: 'acme', id: '20261116-01-pause', confirmed: true } as const;
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof AdsError ? err.code : `other: ${String(err)}`;
  }
}

describe('runScriptDetached (skill-runner)', () => {
  it('runs the script detached, reports its pid, and resolves when it exits without a time limit', async () => {
    const { root } = brain({ board: { delayMs: 300 } });
    const run = runScriptDetached(
      join(root, ADS_SKILL.script),
      root,
      'board',
      '{"account":"acme"}',
      withDefaults({ env: { PATH: process.env.PATH }, timeoutMs: 10 }, 10, 65_536),
    );
    expect(typeof run.pid).toBe('number');
    const out = await run.exited;
    expect(out.failed).toBe(false);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toMatchObject({ ok: true, action: 'board' });
    // The 10 ms limit was not applied: the run took 300 ms and finished.
    expect(runs(root)[0]?.input).toEqual({ account: 'acme' });
  });
});

describe('reads', () => {
  it("a slow apply doesn't block a board read", async () => {
    const { root, dataDir } = brain({ apply: { delayMs: 1500 } });
    const svc = createAdsService(root, opts(dataDir));
    const apply = svc.change('apply', APPLY);
    await sleep(100);
    const t0 = Date.now();
    await svc.read('board', { account: 'acme' });
    expect(Date.now() - t0).toBeLessThan(1000);
    await apply;
  });

  it("a task run is recorded at once, never held behind a slow apply's queue", async () => {
    const { root, dataDir } = brain({ apply: { delayMs: 1500 } });
    const svc = createAdsService(root, opts(dataDir));
    const apply = svc.change('apply', APPLY);
    await sleep(100);
    const t0 = Date.now();
    await svc.change('task-run', { account: 'acme', task: 'weekly-check' });
    expect(Date.now() - t0).toBeLessThan(1000);
    await apply;
  });

  it('identical reads in flight share one run; different ones do not', async () => {
    const { root, dataDir } = brain({ board: { delayMs: 300 } });
    const svc = createAdsService(root, opts(dataDir));
    const [a, b] = await Promise.all([
      svc.read('board', { account: 'acme' }),
      svc.read('board', { account: 'acme' }),
    ]);
    expect(a).toEqual(b);
    expect(runs(root).filter((r) => r.action === 'board')).toHaveLength(1);
    await Promise.all([svc.read('board', { account: 'acme' }), svc.read('board', { account: 'beta' })]);
    expect(runs(root).filter((r) => r.action === 'board')).toHaveLength(3);
  });

  it('a read past its time limit is stopped and is internal', async () => {
    const { root, dataDir } = brain({ board: { delayMs: 3000 } });
    const svc = createAdsService(root, opts(dataDir, { timeouts: { board: 200 } }));
    const t0 = Date.now();
    expect(await codeOf(svc.read('board', { account: 'acme' }))).toBe('internal');
    expect(Date.now() - t0).toBeLessThan(1500);
    await sleep(300);
    expect(existsSync(join(root, 'done-board'))).toBe(false);
  });

  it("passes the bridge's refusal codes through, and anything odd is internal", async () => {
    const { root, dataDir } = brain({
      proposal: { exit: 2, reply: { ok: false, code: 'not-found', error: 'x' } },
      board: { out: 'not json' },
      accounts: { exit: 2, reply: { ok: false, code: 'made-up', error: 'x' } },
    });
    const svc = createAdsService(root, opts(dataDir));
    expect(await codeOf(svc.read('proposal', { client: 'acme', id: '20261116-01-x' }))).toBe('not-found');
    expect(await codeOf(svc.read('board', { account: 'acme' }))).toBe('internal');
    expect(await codeOf(svc.read('accounts', {}))).toBe('internal');
  });
});

describe('changes (decision 12)', () => {
  it('run one at a time', async () => {
    const { root, dataDir } = brain({ decide: { delayMs: 300 }, decided: { delayMs: 10 } });
    const svc = createAdsService(root, opts(dataDir));
    await Promise.all([
      svc.change('decide', { client: 'acme', id: 'a', action: 'approve' }),
      svc.change('decided', { client: 'acme', id: 'b', note: 'x' }),
    ]);
    const [first, second] = runs(root);
    expect(first?.action).toBe('decide');
    expect((second?.start ?? 0) >= (first?.end ?? Infinity)).toBe(true);
  });

  it('on the apply limit: unknown-outcome, the process is NOT killed, the queue is held until it exits', async () => {
    const { root, dataDir } = brain({ apply: { delayMs: 1200 } });
    const svc = createAdsService(root, opts(dataDir, { timeouts: { apply: 200 } }));
    const t0 = Date.now();
    expect(await codeOf(svc.change('apply', APPLY))).toBe('unknown-outcome');
    expect(Date.now() - t0).toBeLessThan(1000);
    // Listed while it runs, so Apply stays off.
    const listed = await svc.inflight();
    expect(listed).toEqual([
      { client: 'acme', id: APPLY.id, pid: expect.any(Number), startedAt: expect.any(String) },
    ]);
    expect(JSON.parse(readFileSync(join(dataDir, ADS_INFLIGHT_FILE), 'utf8'))).toHaveLength(1);
    // The next change waits for the apply to finish.
    const next = svc.change('decide', { client: 'acme', id: 'b', action: 'approve' });
    await next;
    expect(existsSync(join(root, 'done-apply'))).toBe(true);
    const [apply, decide] = runs(root);
    expect(apply?.action).toBe('apply');
    expect(decide?.action).toBe('decide');
    expect((decide?.start ?? 0) >= (apply?.end ?? Infinity)).toBe(true);
    // The outcome is still unknown: the entry stays until the person checks.
    expect(await svc.inflight()).toHaveLength(1);
    await svc.clearInflight('acme', APPLY.id);
    expect(await svc.inflight()).toEqual([]);
  });

  it('refuses "I\'ve checked the account" while that apply\'s process is still running', async () => {
    const { dataDir, root } = brain();
    writeFileSync(
      join(dataDir, ADS_INFLIGHT_FILE),
      JSON.stringify([{ client: 'acme', id: APPLY.id, pid: 5555, startedAt: new Date().toISOString() }]),
    );
    let alive = true;
    const svc = createAdsService(root, opts(dataDir, { isAlive: (pid) => alive && pid === 5555 }));
    expect(await codeOf(svc.clearInflight('acme', APPLY.id))).toBe('unknown-outcome');
    expect(await svc.inflight()).toHaveLength(1);
    alive = false;
    await svc.clearInflight('acme', APPLY.id);
    expect(await svc.inflight()).toEqual([]);
  });

  it('lets "I\'ve checked" clear an entry older than any apply could run, even if its pid was reused', async () => {
    const { dataDir, root } = brain();
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(dataDir, ADS_INFLIGHT_FILE),
      JSON.stringify([{ client: 'acme', id: APPLY.id, pid: 6666, startedAt: old }]),
    );
    const svc = createAdsService(root, opts(dataDir, { isAlive: (pid) => pid === 6666 }));
    await svc.clearInflight('acme', APPLY.id);
    expect(await svc.inflight()).toEqual([]);
  });

  it('dry-run and sign-monthly limits end only the wait (internal), never the process', async () => {
    const { root, dataDir } = brain({ 'dry-run': { delayMs: 800 }, 'sign-monthly': { delayMs: 800 } });
    const svc = createAdsService(root, opts(dataDir, { timeouts: { 'dry-run': 100, 'sign-monthly': 100 } }));
    expect(await codeOf(svc.change('dry-run', { client: 'acme', id: 'a' }))).toBe('internal');
    expect(await codeOf(svc.change('sign-monthly', { client: 'acme', month: '2026-10' }))).toBe('internal');
    await until(() => existsSync(join(root, 'done-sign-monthly')));
    expect(existsSync(join(root, 'done-dry-run'))).toBe(true);
    expect(await svc.inflight()).toEqual([]);
  });

  it('a simple change past its limit is stopped (internal)', async () => {
    const { root, dataDir } = brain({ decide: { delayMs: 2000 } });
    const svc = createAdsService(root, opts(dataDir, { timeouts: { decide: 150 } }));
    expect(await codeOf(svc.change('decide', { client: 'acme', id: 'a', action: 'approve' }))).toBe(
      'internal',
    );
    await sleep(300);
    expect(existsSync(join(root, 'done-decide'))).toBe(false);
  });

  it('an apply that replies in time clears its entry; an unknown outcome keeps it; nothing retries', async () => {
    const { root, dataDir } = brain({ apply: { delayMs: 50 } });
    const svc = createAdsService(root, opts(dataDir));
    expect(await codeOf(svc.change('apply', APPLY))).toBe('ok');
    expect(await svc.inflight()).toEqual([]);

    writeFileSync(
      join(root, 'ctl.json'),
      JSON.stringify({ apply: { exit: 2, reply: { ok: false, code: 'unknown-outcome', error: 'exit 1' } } }),
    );
    expect(await codeOf(svc.change('apply', APPLY))).toBe('unknown-outcome');
    expect(await svc.inflight()).toHaveLength(1);
    // While listed, apply is refused without running the bridge.
    expect(await codeOf(svc.change('apply', APPLY))).toBe('unknown-outcome');
    expect(runs(root).filter((r) => r.action === 'apply')).toHaveLength(2);

    // A crash with no reply: one run only, never retried, and listed.
    await svc.clearInflight('acme', APPLY.id);
    writeFileSync(join(root, 'ctl.json'), JSON.stringify({ apply: { exit: 1, out: '' } }));
    expect(await codeOf(svc.change('apply', APPLY))).toBe('unknown-outcome');
    expect(runs(root).filter((r) => r.action === 'apply')).toHaveLength(3);
    expect(await svc.inflight()).toHaveLength(1);
  });

  it('an unknown outcome from the bridge keeps what the run printed, on the error', async () => {
    const out = 'gads-write: read-back MISMATCH';
    const { root, dataDir } = brain({
      apply: {
        exit: 2,
        reply: { ok: false, action: 'apply', code: 'unknown-outcome', error: 'x', output: out },
      },
    });
    const svc = createAdsService(root, opts(dataDir));
    const err = await svc.change('apply', APPLY).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdsError);
    expect((err as AdsError).code).toBe('unknown-outcome');
    expect((err as AdsError).output).toBe(out);
  });

  it('a refused apply (nothing ran) clears its entry', async () => {
    const { root, dataDir } = brain({
      apply: { exit: 2, reply: { ok: false, code: 'not-allowed', error: 'x' } },
    });
    const svc = createAdsService(root, opts(dataDir));
    expect(await codeOf(svc.change('apply', APPLY))).toBe('not-allowed');
    expect(await svc.inflight()).toEqual([]);
  });

  it('the in-flight file survives a restart and clears itself once the pid is gone and applied_at shows', async () => {
    const { root, dataDir } = brain();
    const startedAt = new Date().toISOString();
    writeFileSync(
      join(dataDir, ADS_INFLIGHT_FILE),
      JSON.stringify([
        { client: 'acme', id: '20261116-01-done', pid: 4242, startedAt },
        { client: 'acme', id: '20261116-02-unknown', pid: 4343, startedAt },
        { client: 'acme', id: '20261116-03-running', pid: 4444, startedAt },
      ]),
    );
    const dir = join(root, 'clients', 'acme', 'proposals');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '20261116-01-done.md'),
      '---\nid: 20261116-01-done\napplied_at: 2026-11-16T10:00:00Z\n---\nx\n',
    );
    writeFileSync(
      join(dir, '20261116-02-unknown.md'),
      '---\nid: 20261116-02-unknown\napplied_at: null\n---\nx\n',
    );
    writeFileSync(
      join(dir, '20261116-03-running.md'),
      '---\nid: 20261116-03-running\napplied_at: 2026-11-16T10:00:00Z\n---\nx\n',
    );
    // A new app (after a restart) reading the same data folder.
    const svc = createAdsService(root, opts(dataDir, { isAlive: (pid) => pid === 4444 }));
    expect((await svc.inflight()).map((e) => e.id)).toEqual(['20261116-02-unknown', '20261116-03-running']);
    expect(JSON.parse(readFileSync(join(dataDir, ADS_INFLIGHT_FILE), 'utf8'))).toHaveLength(2);
    // Apply stays refused for a listed proposal, without running the bridge.
    expect(await codeOf(svc.change('apply', { ...APPLY, id: '20261116-02-unknown' }))).toBe(
      'unknown-outcome',
    );
    expect(runs(root)).toEqual([]);
  });

  it('tells listeners when the in-flight list changes', async () => {
    const { root, dataDir } = brain({
      apply: { exit: 2, reply: { ok: false, code: 'unknown-outcome', error: 'x' } },
    });
    const svc = createAdsService(root, opts(dataDir));
    let told = 0;
    const stop = svc.onChange(() => {
      told += 1;
    });
    await codeOf(svc.change('apply', APPLY));
    expect(told).toBeGreaterThan(0);
    const before = told;
    await svc.clearInflight('acme', APPLY.id);
    expect(told).toBeGreaterThan(before);
    stop();
  });
});

describe('capabilities', () => {
  it('a missing bridge, or an old one that refuses capabilities, is not available', async () => {
    const none = tempDir('ads-svc-none-');
    expect(await createAdsService(none, opts(none)).capabilities()).toBeNull();
    const { root, dataDir } = brain({
      capabilities: { exit: 2, reply: { ok: false, code: 'bad-request', error: 'unknown action' } },
    });
    expect(await createAdsService(root, opts(dataDir)).capabilities()).toBeNull();
    expect(await codeOf(createAdsService(none, opts(none)).read('board', { account: 'acme' }))).toBe(
      'unavailable',
    );
  });

  it('caches the features but reads the person and access afresh', async () => {
    const { root, dataDir } = brain();
    const svc = createAdsService(root, opts(dataDir));
    const first = await svc.capabilities();
    expect(first).toMatchObject({
      features: [ADS_CAPABILITY],
      adsAccess: true,
      adsManager: true,
      me: { slug: 'rita-reviewer' },
    });
    const ctl = {
      capabilities: {
        reply: {
          ok: true,
          action: 'capabilities',
          version: '0.1',
          features: ['ads-v1'],
          adsAccess: false,
          adsManager: true,
          me: null,
        },
      },
    };
    writeFileSync(join(root, 'ctl.json'), JSON.stringify(ctl));
    expect(await svc.capabilities()).toMatchObject({ adsAccess: false, me: null });
  });
});

describe('watching ads files (decision 19)', () => {
  it('knows the ads paths, including ones the library never lists', () => {
    for (const rel of [
      'clients/acme/proposals/20261116-01-x.md',
      'clients/acme/proposals/evidence/20261110/pack.json',
      'clients/acme/reports/monthly/2026-10-review.json',
      'clients/Gamma_Co/context/google-ads/board/summary.csv',
      'clients/acme/data/_fetch-status.json',
      'clients/acme/standup/20261115/brief.json',
      'clients/acme/standup/config.json',
    ])
      expect(isAdsPath(rel), rel).toBe(true);
    for (const rel of [
      'clients/acme/profile.md',
      'clients/acme/reports/weekly/x.md',
      'clients/acme/data/other.json',
      'clients/acme/context/google-ads/data/x.csv',
      'todo/x.md',
      'clients/acme',
    ])
      expect(isAdsPath(rel), rel).toBe(false);
  });

  it('tells the ads hook, debounced, when an ads file changes under clients/', async () => {
    const root = tempDir('ads-watch-');
    mkdirSync(join(root, 'clients', 'acme', 'proposals'), { recursive: true });
    mkdirSync(join(root, 'clients', 'acme', 'config'), { recursive: true });
    let ads = 0;
    const areas: string[] = [];
    const stop = watchBrain(root, (a) => areas.push(a), {
      onAdsChange: () => {
        ads += 1;
      },
    });
    try {
      await sleep(100);
      writeFileSync(join(root, 'clients', 'acme', 'proposals', '20261116-01-x.md'), 'a');
      writeFileSync(join(root, 'clients', 'acme', 'proposals', '20261116-02-y.md'), 'b');
      await until(() => ads > 0, 3000);
      await sleep(600);
      expect(ads).toBe(1);
      // A never-listed file that isn't an ads path tells nobody about ads.
      ads = 0;
      writeFileSync(join(root, 'clients', 'acme', 'config', 'management.json'), '{}');
      await sleep(700);
      expect(ads).toBe(0);
    } finally {
      stop();
    }
  });
});
