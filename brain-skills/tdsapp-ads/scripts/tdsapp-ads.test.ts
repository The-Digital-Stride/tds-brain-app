// Tests for the brain's `tdsapp-ads` bridge (plan docs/plans/2026-11-16-workbench-ad-manager.md, decisions 7-12).
// Each test builds a throwaway fixture brain: frozen copies of the brain's ads-manager libraries
// (test-fixtures/ads-manager), a STUB apply.cjs and client-draft.cjs (the real ones reach Google Ads and Gmail; this
// Mac holds live credentials, so they are never run here), a stub gads-access.cjs and PDF builder, and a copy of this
// skill's scripts. The bridge runs as a child process, exactly as the app runs it. When the Workbench folder is on
// this Mac, its own code is run against the same fixture to prove the copies agree. Stays in the app repo.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ADS_ACCOUNT_KEY,
  ADS_CAPABILITY,
  ADS_CLIENT_SLUG,
  ADS_MONTH,
  ADS_NOTE_MAX,
  ADS_OUTPUT_TAIL,
  ADS_PROPOSAL_ID,
  ADS_RECENT_DAYS,
  ADS_SKILL,
} from '../../../shared/ads-contract.ts';

const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(SKILL_DIR, 'test-fixtures');
const WORKBENCH = join(homedir(), 'agencybrain', 'tools', 'members', 'command-centre');
const BRAIN = join(homedir(), 'agencybrain');
const hasWorkbench = existsSync(join(WORKBENCH, 'lib', 'approvals-board.cjs'));

type Reply = { ok: boolean; code?: string; error?: string; [k: string]: unknown };
type Fm = Record<string, unknown>;
interface P {
  create(o: Record<string, unknown>): { id: string };
  approve(o: Record<string, unknown>): unknown;
  stamp(o: Record<string, unknown>, f: Record<string, unknown>): unknown;
  read(o: Record<string, unknown>): { fm: Fm; body: string };
}

const ROLES = {
  members: [
    { name: 'Olive Owner', email: 'olive@example.test', role: 'owner' },
    { name: 'Rita Reviewer', email: 'rita@example.test', role: 'team' },
    { name: 'Tess Team', email: 'tess@example.test', role: 'team' },
    { name: 'Sam Scout', email: 'sam@example.test', role: 'scout' },
  ],
};

let root: string;
let home: string;
let P: P;
const req = createRequire(import.meta.url);

const STUB_APPLY = `'use strict';
// STUB apply.cjs for tests: records its arguments and never reaches Google Ads.
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const P = require('./lib/proposals.cjs');
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(ROOT, 'apply-calls.log'), JSON.stringify(argv) + '\\n');
const mode = fs.existsSync(path.join(ROOT, 'apply-mode')) ? fs.readFileSync(path.join(ROOT, 'apply-mode'), 'utf8').trim() : 'ok';
const arg = (n) => { const a = argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : ''; };
console.log('proxy: token line that must not show');
console.log('STUB ' + (argv.includes('--confirmed') ? 'live' : 'dry run') + ' for ' + arg('id'));
if (mode === 'leak') console.log('Command failed: curl -sS -H x-proxy-secret: s3cret-value https://proxy.test');
if (mode === 'mismatch-stamped' && argv.includes('--confirmed')) {
  P.stamp({ clientDir: path.join(ROOT, 'clients', arg('client')), id: arg('id') }, { status: 'failed', applied_at: new Date().toISOString(), outcome: 'stub read-back disagreed' });
}
if (mode === 'ok' && argv.includes('--confirmed')) {
  P.stamp({ clientDir: path.join(ROOT, 'clients', arg('client')), id: arg('id') }, { status: 'applied', applied_at: new Date().toISOString(), outcome: 'stub applied' });
}
process.exit(mode === 'refuse' ? 2 : mode === 'mismatch' || mode === 'mismatch-stamped' ? 3 : mode === 'crash' ? 1 : 0);
`;

const STUB_CLIENT_DRAFT = `'use strict';
// STUB client-draft.cjs for tests: never reaches Gmail.
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const P = require('./lib/proposals.cjs');
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(ROOT, 'draft-calls.log'), JSON.stringify(argv) + '\\n');
const arg = (n) => { const a = argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : ''; };
const draft = 'clients/' + arg('client') + '/proposals/drafts/' + arg('id') + '-client-email.md';
P.stamp({ clientDir: path.join(ROOT, 'clients', arg('client')), id: arg('id') }, { client_request_at: new Date().toISOString(), client_request_draft: draft });
console.log(JSON.stringify({ id: arg('id'), draft, to: ['mark@acme.test'], missing: [], gmailDraftId: null, gmailError: null }));
`;

const STUB_GADS_ACCESS = `'use strict';
const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '../../../../..');
function loadProxyConfig() { try { const t = fs.readFileSync(path.join(ROOT, 'gads-proxy.yaml'), 'utf8'); return { url: (t.match(/url: (\\S+)/) || [])[1], secret: (t.match(/secret: (\\S+)/) || [])[1] }; } catch { return { url: '', secret: '' }; } }
function loadYamlCreds() { return fs.existsSync(path.join(ROOT, 'google-ads.yaml')) ? { clientId: 'x' } : null; }
module.exports = { loadProxyConfig, loadYamlCreds };
`;

// The PDF builder monthly.cjs runs: writes the PDF beside the HTML.
const STUB_BUILD = `'use strict';
const fs = require('fs');
const out = process.argv[3];
fs.writeFileSync(out, '<html></html>');
fs.writeFileSync(out.replace(/\\.html$/, '.pdf'), '%PDF-1.4 stub');
`;

function git(args: string[]) {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}
function actAs(name: string, email: string) {
  git(['config', 'user.name', name]);
  git(['config', 'user.email', email]);
}

const abs = (rel: string) => join(root, ...rel.split('/'));
function put(rel: string, text: string) {
  mkdirSync(dirname(abs(rel)), { recursive: true });
  writeFileSync(abs(rel), text);
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

function buildBrain() {
  mkdirSync(abs('.team-config'), { recursive: true });
  writeFileSync(abs('.team-config/roles.json'), JSON.stringify(ROLES));
  // The brain's ads-manager libraries (frozen copies) and the stubs.
  const am = abs('.claude/skills/ads-manager/scripts');
  mkdirSync(join(am, 'lib'), { recursive: true });
  cpSync(join(FIXTURES, 'ads-manager', 'lib', 'proposals.cjs'), join(am, 'lib', 'proposals.cjs'));
  cpSync(join(FIXTURES, 'ads-manager', 'lib', 'common.cjs'), join(am, 'lib', 'common.cjs'));
  cpSync(join(FIXTURES, 'ads-manager', 'monthly.cjs'), join(am, 'monthly.cjs'));
  writeFileSync(join(am, 'apply.cjs'), STUB_APPLY);
  writeFileSync(join(am, 'client-draft.cjs'), STUB_CLIENT_DRAFT);
  put('.claude/skills/gads-proxy/scripts/lib/gads-access.cjs', STUB_GADS_ACCESS);
  put('templates/tds-doc-system/build.cjs', STUB_BUILD);
  // This skill, where the app finds it.
  const skill = abs('.claude/skills/tdsapp-ads');
  mkdirSync(skill, { recursive: true });
  cpSync(join(SKILL_DIR, 'SKILL.md'), join(skill, 'SKILL.md'));
  cpSync(join(SKILL_DIR, 'scripts'), join(skill, 'scripts'), {
    recursive: true,
    filter: (src) => !src.endsWith('.test.ts'),
  });
  put(
    '.claude/accounts.json',
    JSON.stringify({ acme: { name: 'Acme Ltd', currency: 'GBP', id: '123-456-7890' } }),
  );

  // acme: supervised, reviewer Rita and owner Sam, so Tess (team) is neither.
  put('clients/acme/profile.md', '---\nclient: "Acme Ltd"\nowner: sam-scout\n---\n# Acme\n');
  put(
    'clients/acme/config/management.json',
    JSON.stringify({ client: 'acme', people: { owner: 'sam-scout', reviewer: 'rita-reviewer' } }),
  );
  // beta: supervised, reviewed by Sam only.
  put('clients/beta/profile.md', '---\nclient: Beta Co\n---\n');
  put(
    'clients/beta/config/management.json',
    JSON.stringify({ client: 'beta', people: { owner: 'sam-scout', reviewer: 'sam-scout' } }),
  );
  // An unsupervised client folder with board data only.
  put(
    'clients/Gamma_Co/context/google-ads/board/summary.csv',
    `Date,Campaign,Cost\n${ymd(daysAgo(1))},G1,10\n`,
  );

  // Operations files the change proposals name.
  put(
    'clients/acme/proposals/ops/pause.json',
    JSON.stringify({
      path: 'campaigns:mutate',
      operations: [{ update: { status: 'PAUSED' }, updateMask: 'status' }],
    }),
  );

  // Board CSVs for acme.
  const d1 = ymd(daysAgo(1));
  const d2 = ymd(daysAgo(2));
  put(
    'clients/acme/context/google-ads/board/summary.csv',
    `Date,Campaign,Cost,Conversions,Conv. value,Impressions,Clicks\n${d1},Brand,120.5,4,800,1000,90\n${d2},Brand,100,3,600,900,80\n${d1},Generic,300,2,200,5000,200\n`,
  );
  put(
    'clients/acme/context/google-ads/board/search80.csv',
    'Search term,Campaign,Cost,Conversions,Conv. value,Clicks,Impressions\nacme widgets,Brand,50,3,400,30,100\ncheap stuff,Generic,40,0,0,20,300\nfree things,Generic,3,0,0,4,50\n',
  );
  put(
    'clients/acme/context/google-ads/board/keyword80.csv',
    'Keyword,Match type,Cost,Conversions,Conv. value,Clicks,Quality Score\nwidgets,EXACT,60,2,300,40,7\ngadgets,PHRASE,30,0,0,15,3\n',
  );
  put(
    'clients/acme/context/google-ads/board/quality.csv',
    'Keyword,Quality Score\nwidgets,7\ngadgets,3\nthings,4\n',
  );
  put(
    'clients/acme/context/google-ads/board/campSettings.csv',
    'Campaign,Campaign ID,Status,Channel,Budget\nBrand,1,ENABLED,SEARCH,50\nGeneric,2,ENABLED,SEARCH,80\nOld,3,PAUSED,SEARCH,10\n',
  );
  put(
    'clients/acme/data/_fetch-status.json',
    JSON.stringify({ lastRun: new Date().toISOString(), errors: {}, tabs: { a: 1, b: 1 } }),
  );
  put(
    'clients/acme/standup/20261115/brief.json',
    JSON.stringify({
      headline: 'Generic is wasting spend',
      per_campaign_verdicts: [
        { campaign: 'Generic', action_category: 'ADD_NEGATIVES', reason_one_line: 'Junk terms', priority: 1 },
        { campaign: 'Brand', action_category: 'NONE', reason_one_line: 'Fine', priority: 3 },
      ],
      top_actions: [{ campaign: 'Generic', action_category: 'ADD_NEGATIVES' }],
      anomalies: [],
    }),
  );
  // Weekly pack and monthly close.
  put(
    'clients/acme/proposals/evidence/20261110/pack.json',
    JSON.stringify({
      date: '2026-11-10',
      counts: { act: 2, watch: 1 },
      provisional: false,
      verification: {
        items: [],
        findings: [{ section: 0, severity: 'info', title: 'X verified', detail: 'Fine.' }],
      },
    }),
  );
  put(
    'clients/acme/reports/monthly/2026-10-monthly-close.json',
    JSON.stringify({ name: 'Acme Ltd', monthName: 'October 2026', partial: false, dataTo: '2026-10-31' }),
  );
  put(
    'clients/acme/reports/monthly/Acme-Ltd-Google-Ads-Report-2026-10.body.html',
    '<div class="meta">x</div>',
  );
  put('clients/acme/reports/monthly/2026-10-monthly-close.md', '# close');

  git(['init', '-q']);
  actAs('Rita Reviewer', 'rita@example.test');
  P = req(join(am, 'lib', 'proposals.cjs')) as P;
}

function mkProposal(slug: string, opts: Record<string, unknown> = {}) {
  const {
    type = 'change',
    tier = 2,
    fields = {},
  } = opts as { type?: string; tier?: number; fields?: object };
  return P.create({
    clientDir: abs('clients/acme'),
    type,
    tier,
    slug,
    title: `Do ${slug}`,
    body: `## What\n${slug}\n\n## Why\nBecause.\n`,
    fields: type === 'change' ? { operations: 'proposals/ops/pause.json', ...fields } : fields,
  }).id;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ads-brain-')));
  home = realpathSync(mkdtempSync(join(tmpdir(), 'ads-home-')));
  buildBrain();
});
afterEach(() => {
  for (const dir of [root, home]) rmSync(dir, { recursive: true, force: true });
});

const SCRIPT = () => abs(ADS_SKILL.script);

function bridge(action: string, input: unknown = {}): { exit: number | null; reply: Reply } {
  const r = spawnSync(process.execPath, [SCRIPT(), action], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    cwd: root,
    encoding: 'utf8',
    // This node first: monthly.cjs runs `node` for the PDF builder, and a shell launcher may need the real home.
    env: {
      PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      BRAIN_ROOT: root,
    },
  });
  const lines = r.stdout.split('\n').filter(Boolean);
  expect(lines, r.stderr).toHaveLength(1);
  return { exit: r.status, reply: JSON.parse(lines[0] as string) as Reply };
}
function refused(r: { exit: number | null; reply: Reply }, code: string) {
  expect(r.reply.ok, JSON.stringify(r.reply)).toBe(false);
  expect(r.reply.code, JSON.stringify(r.reply)).toBe(code);
  expect(r.exit).toBe(code === 'internal' ? 1 : 2);
}
const calls = (file: string): string[][] =>
  existsSync(abs(file))
    ? readFileSync(abs(file), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const fmOf = (id: string) => P.read({ clientDir: abs('clients/acme'), id }).fm;

describe('the script and the contract agree', () => {
  it('exports the same constants as shared/ads-contract.ts and runs nothing when required', () => {
    const mod = req(join(SKILL_DIR, 'scripts', 'tdsapp-ads.cjs')) as Record<string, unknown>;
    expect(mod.ADS_CAPABILITY).toBe(ADS_CAPABILITY);
    expect(String(mod.ADS_PROPOSAL_ID)).toBe(String(ADS_PROPOSAL_ID));
    expect(String(mod.ADS_CLIENT_SLUG)).toBe(String(ADS_CLIENT_SLUG));
    expect(String(mod.ADS_ACCOUNT_KEY)).toBe(String(ADS_ACCOUNT_KEY));
    expect(String(mod.ADS_MONTH)).toBe(String(ADS_MONTH));
    expect(mod.ADS_NOTE_MAX).toBe(ADS_NOTE_MAX);
    expect(mod.ADS_RECENT_DAYS).toBe(ADS_RECENT_DAYS);
    expect(mod.ADS_OUTPUT_TAIL).toBe(ADS_OUTPUT_TAIL);
  });

  it('answers one JSON line; unknown actions and bad JSON are bad requests', () => {
    refused(bridge('nope'), 'bad-request');
    refused(bridge('capabilities', '{not json'), 'bad-request');
    refused(bridge('capabilities', '[]'), 'bad-request');
  });
});

describe('capabilities', () => {
  it('reports the feature, the ads-manager libraries and the roster person, not cached', () => {
    const r = bridge('capabilities');
    expect(r.exit).toBe(0);
    expect(r.reply).toMatchObject({
      ok: true,
      action: 'capabilities',
      features: [ADS_CAPABILITY],
      adsManager: true,
      adsAccess: false,
      me: { slug: 'rita-reviewer', name: 'Rita Reviewer', role: 'team' },
    });
    expect(typeof r.reply.version).toBe('string');
  });

  it("follows the Workbench's hasAdsAccess rule: a proxy url and secret, or google-ads.yaml", () => {
    put('gads-proxy.yaml', 'url: https://proxy.test\n');
    expect(bridge('capabilities').reply.adsAccess).toBe(false);
    put('gads-proxy.yaml', 'url: https://proxy.test\nsecret: s3cret\n');
    expect(bridge('capabilities').reply.adsAccess).toBe(true);
    rmSync(abs('gads-proxy.yaml'));
    put('google-ads.yaml', 'client_id: x\n');
    expect(bridge('capabilities').reply.adsAccess).toBe(true);
  });

  it('has me null for someone not on the roster', () => {
    actAs('Stranger Danger', 'stranger@example.test');
    expect(bridge('capabilities').reply.me).toBeNull();
  });

  it('says adsManager false, without failing, when the ads-manager skill or an export is missing', () => {
    writeFileSync(
      abs('.claude/skills/ads-manager/scripts/lib/proposals.cjs'),
      'module.exports = { list() {} };',
    );
    const r = bridge('capabilities');
    expect(r.reply).toMatchObject({ ok: true, adsManager: false });
    rmSync(abs('.claude/skills/ads-manager'), { recursive: true, force: true });
    const r2 = bridge('capabilities');
    expect(r2.reply).toMatchObject({ ok: true, features: [ADS_CAPABILITY], adsManager: false, me: null });
    refused(bridge('approvals'), 'unavailable');
  });
});

describe('approvals', () => {
  it("lists the person's clients with summaries (no bodies), flags, pack and monthly", () => {
    const a = mkProposal('pause-generic');
    const b = mkProposal('a-decision', { type: 'decision', tier: 1 });
    const r = bridge('approvals');
    expect(r.exit).toBe(0);
    const clients = r.reply.clients as Record<string, unknown>[];
    const acme = clients.find((c) => c.slug === 'acme') as Record<string, unknown>;
    const beta = clients.find((c) => c.slug === 'beta') as Record<string, unknown>;
    expect(acme).toMatchObject({
      name: 'Acme Ltd',
      reviewer: 'rita-reviewer',
      owner: 'sam-scout',
      mine: true,
    });
    expect(beta.mine).toBe(false);
    expect(r.reply.waiting).toBe(2);
    expect(r.reply.toApply).toBe(0);
    expect(r.reply.me).toEqual({ slug: 'rita-reviewer', name: 'Rita Reviewer', role: 'team' });
    const open = acme.open as Record<string, unknown>[];
    // Tier, then id.
    expect(open.map((p) => p.id)).toEqual([b, a]);
    expect(open[0]).not.toHaveProperty('body');
    expect(open[1]?.file).toBe(`clients/acme/proposals/${a}.md`);
    expect(open[1]?.flags).toEqual({
      canDecide: true,
      canDryRun: true,
      canApply: false,
      canClientDraft: false,
      canRecordClientApproval: false,
      canRecordDecision: false,
    });
    expect(acme.pack).toEqual({
      date: '2026-11-10',
      act: 2,
      watch: 1,
      provisional: false,
      report: 'clients/acme/reports/weekly-check/2026-11-10-weekly-check.md',
      verification: [{ section: 0, severity: 'info', title: 'X verified', detail: 'Fine.' }],
    });
    expect(acme.monthly).toMatchObject({
      month: '2026-10',
      monthName: 'October 2026',
      partial: false,
      signed: false,
      canSign: true,
      files: { body: 'clients/acme/reports/monthly/Acme-Ltd-Google-Ads-Report-2026-10.body.html' },
    });
  });

  it('lists recent decisions from the last 14 days only, newest first, and filters by client', () => {
    const a = mkProposal('old-one');
    const b = mkProposal('new-one');
    const clientDir = abs('clients/acme');
    P.stamp({ clientDir, id: a }, { status: 'void', voided_at: daysAgo(20).toISOString() });
    P.stamp({ clientDir, id: b }, { status: 'void', voided_at: daysAgo(2).toISOString() });
    const r = bridge('approvals', { client: 'acme' });
    const clients = r.reply.clients as Record<string, unknown>[];
    expect(clients.map((c) => c.slug)).toEqual(['acme']);
    expect(((clients[0]?.recent ?? []) as { id: string }[]).map((p) => p.id)).toEqual([b]);
  });

  it('gives someone who may not decide no buttons', () => {
    mkProposal('pause-generic');
    actAs('Tess Team', 'tess@example.test');
    const r = bridge('approvals');
    const acme = (r.reply.clients as Record<string, unknown>[]).find((c) => c.slug === 'acme') as {
      mine: boolean;
      open: { flags: Record<string, boolean> }[];
      monthly: { canSign: boolean };
    };
    expect(acme.mine).toBe(false);
    expect(Object.values(acme.open[0]?.flags ?? {}).some(Boolean)).toBe(false);
    expect(acme.monthly.canSign).toBe(false);
    expect(r.reply.waiting).toBe(0);
  });

  it.skipIf(!hasWorkbench)('matches the Workbench roll-up for the same files', () => {
    const a = mkProposal('pause-generic');
    mkProposal('a-decision', { type: 'decision', tier: 1 });
    const b = mkProposal('gone');
    P.stamp(
      { clientDir: abs('clients/acme'), id: b },
      { status: 'void', voided_at: daysAgo(1).toISOString() },
    );
    P.approve({ clientDir: abs('clients/acme'), id: a, by: 'rita-reviewer' });
    const lib = abs('tools/members/command-centre/lib');
    mkdirSync(lib, { recursive: true });
    cpSync(join(WORKBENCH, 'lib', 'approvals-board.cjs'), join(lib, 'approvals-board.cjs'));
    const me = { slug: 'rita-reviewer', name: 'Rita Reviewer', role: 'team' };
    const wb = spawnSync(
      process.execPath,
      [
        '-e',
        `console.log(JSON.stringify(require(${JSON.stringify(join(lib, 'approvals-board.cjs'))}).board(${JSON.stringify(me)})))`,
      ],
      { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } },
    );
    const theirs = JSON.parse(wb.stdout) as Record<string, unknown>;
    const ours = bridge('approvals').reply;
    expect(ours.waiting).toBe(theirs.waiting);
    expect(ours.toApply).toBe(theirs.toApply);
    const shape = (c: Record<string, unknown>) => ({
      slug: c.slug,
      name: c.name,
      reviewer: c.reviewer,
      owner: c.owner,
      mine: c.mine,
      open: (c.open as { id: string; fm: Fm }[]).map((p) => [p.id, p.fm]),
      recent: (c.recent as { id: string; fm: Fm }[]).map((p) => [p.id, p.fm]),
      pack: c.pack,
      monthly: c.monthly && { ...(c.monthly as object), canSign: undefined },
    });
    const strip = (c: Record<string, unknown>) => {
      const s = shape(c);
      if (s.monthly) delete (s.monthly as Record<string, unknown>).canSign;
      return s;
    };
    expect((ours.clients as Record<string, unknown>[]).map(strip)).toEqual(
      (theirs.clients as Record<string, unknown>[]).map(strip),
    );
  });
});

describe('proposal', () => {
  it('returns one proposal in full, and refuses bad or unknown ids and clients', () => {
    const a = mkProposal('pause-generic');
    const r = bridge('proposal', { client: 'acme', id: a });
    expect(r.reply.ok).toBe(true);
    const p = r.reply.proposal as Record<string, unknown>;
    expect(p.id).toBe(a);
    expect(p.body).toContain('## What');
    expect((p.fm as Fm).status).toBe('proposed');
    refused(bridge('proposal', { client: 'acme', id: '20261116-01-nope' }), 'not-found');
    refused(bridge('proposal', { client: 'acme', id: '../../etc' }), 'bad-request');
    refused(bridge('proposal', { client: 'Acme', id: a }), 'bad-request');
    refused(bridge('proposal', { client: 'nobody', id: a }), 'not-found');
    refused(bridge('proposal', { client: 'acme' }), 'bad-request');
  });
});

describe('accounts', () => {
  it('lists board accounts and supervised clients, with waiting counts for this person', () => {
    mkProposal('pause-generic');
    const r = bridge('accounts');
    const accounts = r.reply.accounts as Record<string, unknown>[];
    const byKey = Object.fromEntries(accounts.map((a) => [a.key, a]));
    expect(byKey.acme).toMatchObject({ name: 'Acme Ltd', currency: 'GBP', waiting: 1, supervised: true });
    expect(byKey.beta).toMatchObject({ name: 'Beta Co', waiting: 0, supervised: true });
    expect(byKey.Gamma_Co).toMatchObject({ name: 'Gamma_Co', waiting: 0, supervised: false });
  });
});

describe('board', () => {
  it('returns the health, tables, cards with badges and filled prompts, standup and triage', () => {
    const r = bridge('board', { account: 'acme' });
    expect(r.exit).toBe(0);
    const b = r.reply.board as Record<string, unknown>;
    expect(b).toMatchObject({ key: 'acme', name: 'Acme Ltd', currency: 'GBP' });
    const cards = b.cards as { id: string; prompt: string; badge: string | null; cadence: string }[];
    expect(cards).toHaveLength(16);
    const tasks = JSON.parse(readFileSync(join(SKILL_DIR, 'scripts', 'cadence-tasks.json'), 'utf8'));
    expect(cards[0]?.prompt).toBe(
      (tasks.cards[0].prompt as string)
        .replace(/\{\{account\}\}/g, 'Acme Ltd')
        .replace(/\{\{key\}\}/g, 'acme'),
    );
    expect(cards.find((c) => c.id === 'w-search')?.badge).toBe('2 to review');
    expect(cards.find((c) => c.id === 'w-negatives')?.badge).toBe('1 candidates');
    expect(cards.find((c) => c.id === 'm-rsa')?.badge).toBe('2 low-QS keywords');
    expect((b.tables as { id: string }[]).map((t) => t.id)).toEqual([
      'campaigns',
      'searchterms',
      'waste',
      'keywords',
      'quality',
    ]);
    const health = b.health as { dir: string; fetch: { problem: boolean } };
    expect(health.dir).toBe('clients/acme/context/google-ads/board');
    expect(health.fetch.problem).toBe(false);
    const standup = b.standup as Record<string, unknown>;
    expect(standup).toMatchObject({ hasStandup: false, enabledCampaigns: ['Generic', 'Brand'] });
    expect(standup.verdict).toMatchObject({ date: '2026-11-15', flagged: 1, topAction: 'ADD_NEGATIVES' });
    expect(standup.prompt).toContain('Google Ads account Acme Ltd (the folder clients/acme/)');
    expect((standup.actionLabels as Record<string, string>).ADD_NEGATIVES).toBe('Add negatives');
    expect(b.triage).toMatchObject({ key: 'acme', name: 'Acme Ltd', hasStandup: false });
    expect((b.setupPrompts as Record<string, string>).discover).toContain('.claude/skills/workbench/assets');
  });

  it('refuses a bad or unknown account key', () => {
    refused(bridge('board', { account: '../x' }), 'bad-request');
    refused(bridge('board', { account: 'nobody' }), 'not-found');
  });

  it.skipIf(!hasWorkbench)("matches the Workbench's buildBoardData for the fixture CSVs", () => {
    const lib = abs('tools/members/command-centre/lib');
    mkdirSync(lib, { recursive: true });
    for (const f of ['ads-board-data.cjs', 'ads-normalize.cjs', 'standup-board.cjs'])
      cpSync(join(WORKBENCH, 'lib', f), join(lib, f));
    const wb = spawnSync(
      process.execPath,
      [
        '-e',
        `console.log(JSON.stringify(require(${JSON.stringify(join(lib, 'ads-board-data.cjs'))}).buildBoardData('acme')))`,
      ],
      { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, BRAIN_ROOT: root } },
    );
    const theirs = JSON.parse(wb.stdout) as Record<string, unknown>;
    const b = bridge('board', { account: 'acme' }).reply.board as Record<string, unknown>;
    expect(b.tables).toEqual(theirs.topTens);
    expect(b.health).toEqual(theirs.dataHealth);
    expect(b.wastePct).toBe(theirs.wastePct);
    const badges = theirs.badges as Record<string, string | null>;
    for (const c of b.cards as { id: string; badge: string | null }[])
      expect(c.badge).toBe(badges[c.id] ?? null);
    expect((b.standup as Record<string, unknown>).verdict).toEqual(theirs.standup);
    expect((b.standup as Record<string, unknown>).enabledCampaigns).toEqual(theirs.enabledCampaigns);
  });
});

describe('who may act (decision 10)', () => {
  it('decide: the reviewer approves in their own name; someone else is refused', () => {
    const a = mkProposal('pause-generic');
    actAs('Tess Team', 'tess@example.test');
    refused(bridge('decide', { client: 'acme', id: a, action: 'approve' }), 'not-allowed');
    expect(fmOf(a).status).toBe('proposed');
    actAs('Rita Reviewer', 'rita@example.test');
    const r = bridge('decide', { client: 'acme', id: a, action: 'approve' });
    expect(r.reply.ok, JSON.stringify(r.reply)).toBe(true);
    expect(fmOf(a)).toMatchObject({ status: 'approved', approved_by: 'rita-reviewer' });
    const p = r.reply.proposal as { fm: Fm; flags: Record<string, boolean> };
    expect(p.fm.status).toBe('approved');
    expect(p.flags.canApply).toBe(true);
    expect(typeof r.reply.message).toBe('string');
  });

  it('ignores any actor named in stdin', () => {
    const a = mkProposal('pause-generic');
    actAs('Tess Team', 'tess@example.test');
    const sneaky = {
      client: 'acme',
      id: a,
      action: 'approve',
      by: 'rita-reviewer',
      as: 'olive-owner',
      me: 'olive-owner',
    };
    refused(bridge('decide', sneaky), 'not-allowed');
    expect(fmOf(a).status).toBe('proposed');
  });

  it('an owner (role) may decide for any client', () => {
    const a = mkProposal('pause-generic');
    actAs('Olive Owner', 'olive@example.test');
    expect(bridge('decide', { client: 'acme', id: a, action: 'approve' }).reply.ok).toBe(true);
    expect(fmOf(a).approved_by).toBe('olive-owner');
  });

  it('decided, dry-run, apply and client-draft refuse someone who is not the reviewer, owner or an owner', () => {
    const change = mkProposal('pause-generic', {
      fields: { needs_client_approval: true, client_approver: 'Mark' },
    });
    const decision = mkProposal('a-decision', { type: 'decision', tier: 1 });
    P.approve({ clientDir: abs('clients/acme'), id: change, by: 'rita-reviewer' });
    P.approve({ clientDir: abs('clients/acme'), id: decision, by: 'rita-reviewer' });
    actAs('Tess Team', 'tess@example.test');
    refused(bridge('decided', { client: 'acme', id: decision, note: 'We agreed' }), 'not-allowed');
    refused(bridge('dry-run', { client: 'acme', id: change }), 'not-allowed');
    refused(bridge('apply', { client: 'acme', id: change, confirmed: true }), 'not-allowed');
    refused(bridge('client-draft', { client: 'acme', id: change }), 'not-allowed');
    refused(bridge('client-approved', { client: 'acme', id: change, who: 'Mark' }), 'not-allowed');
    expect(calls('apply-calls.log')).toEqual([]);
    expect(calls('draft-calls.log')).toEqual([]);
    expect(fmOf(decision).status).toBe('approved');
  });

  it('refuses every change to a person not on the roster', () => {
    const a = mkProposal('pause-generic');
    actAs('Stranger Danger', 'stranger@example.test');
    const tries: [string, Record<string, unknown>][] = [
      ['decide', { client: 'acme', id: a, action: 'approve' }],
      ['dry-run', { client: 'acme', id: a }],
      ['apply', { client: 'acme', id: a, confirmed: true }],
      ['client-draft', { client: 'acme', id: a }],
      ['client-approved', { client: 'acme', id: a, who: 'Mark' }],
      ['decided', { client: 'acme', id: a, note: 'x' }],
      ['sign-monthly', { client: 'acme', month: '2026-10' }],
      ['standup-setup', { account: 'acme' }],
      [
        'standup-feedback',
        {
          account: 'acme',
          date: '20261115',
          campaign: 'Generic',
          action_category: 'ADD_NEGATIVES',
          score: 4,
        },
      ],
    ];
    for (const [action, input] of tries) refused(bridge(action, input), 'not-allowed');
    expect(calls('apply-calls.log')).toEqual([]);
    expect(existsSync(abs('clients/acme/standup/config.json'))).toBe(false);
  });
});

describe('decisions', () => {
  it('reject and request changes need a note; request changes returns the revise prompt', () => {
    const a = mkProposal('pause-generic');
    refused(bridge('decide', { client: 'acme', id: a, action: 'reject' }), 'bad-request');
    refused(
      bridge('decide', { client: 'acme', id: a, action: 'request-changes', note: '  ' }),
      'bad-request',
    );
    refused(bridge('decide', { client: 'acme', id: a, action: 'explode' }), 'bad-request');
    const r = bridge('decide', {
      client: 'acme',
      id: a,
      action: 'request-changes',
      note: 'Use "exact" match',
    });
    expect(r.reply.ok).toBe(true);
    // (proposals.cjs keeps the quotes escaped when it reads the note back: the brain's own behaviour, unchanged.)
    expect(fmOf(a)).toMatchObject({ status: 'changes-requested', changes_requested_by: 'rita-reviewer' });
    expect(r.reply.revisePrompt).toBe(
      `Revise ads-manager proposal ${a} for client acme. Rita Reviewer reviewed it on the Workbench and asked for this change:\n\n"Use 'exact' match"\n\nFollow the ads-manager skill, section "Revising a proposal after Request changes". Never approve, apply or post anything: the revised proposal goes back to Rita Reviewer on the Workbench Ads tab.`,
    );
  });

  it('a decision already taken is refused as changed', () => {
    const a = mkProposal('pause-generic');
    expect(bridge('decide', { client: 'acme', id: a, action: 'reject', note: 'No' }).reply.ok).toBe(true);
    refused(bridge('decide', { client: 'acme', id: a, action: 'approve' }), 'changed');
  });

  it('approving a proposal that needs the client drafts the client email, as the Workbench does', () => {
    const a = mkProposal('pause-generic', {
      fields: { needs_client_approval: true, client_approver: 'Mark' },
    });
    const r = bridge('decide', { client: 'acme', id: a, action: 'approve' });
    expect(r.reply.ok).toBe(true);
    expect(calls('draft-calls.log')).toEqual([['--client=acme', `--id=${a}`, '--json']]);
    const flags = (r.reply.proposal as { flags: Record<string, boolean> }).flags;
    expect(flags).toMatchObject({ canApply: false, canClientDraft: false, canRecordClientApproval: true });
    // Then the client's yes, recorded by the reviewer.
    const y = bridge('client-approved', { client: 'acme', id: a, who: 'Mark, email 29 Oct' });
    expect(y.reply.ok).toBe(true);
    expect(fmOf(a)).toMatchObject({
      client_approved_by: 'Mark, email 29 Oct',
      client_approval_recorded_by: 'rita-reviewer',
    });
    expect((y.reply.proposal as { flags: Record<string, boolean> }).flags.canApply).toBe(true);
  });

  it('flattens line breaks in the client approval fields so they cannot break the header', () => {
    const a = mkProposal('pause-generic', {
      fields: { needs_client_approval: true, client_approver: 'Mark' },
    });
    expect(bridge('decide', { client: 'acme', id: a, action: 'approve' }).reply.ok).toBe(true);
    const y = bridge('client-approved', { client: 'acme', id: a, who: 'Mark\n---\nx', note: 'By email\r\non 29 Oct' });
    expect(y.reply.ok).toBe(true);
    const fm = fmOf(a);
    expect(fm.client_approved_by).toBe('Mark --- x');
    expect(fm.client_approval_note).toBe('By email on 29 Oct');
    expect(fm.client_approved_at).toBeTruthy();
  });

  it('hides the gateway secret in apply and dry-run output', () => {
    put('gads-proxy.yaml', 'url: https://proxy.test\nsecret: s3cret-value\n');
    const a = mkProposal('pause-generic');
    put('apply-mode', 'leak');
    const dry = bridge('dry-run', { client: 'acme', id: a });
    expect(dry.reply.output).toContain('STUB dry run');
    expect(dry.reply.output).not.toContain('s3cret-value');
    expect(dry.reply.output).not.toMatch(/x-proxy-secret:\s*(?!\[hidden\])\S/);
  });

  it('records what was decided on an approved decision proposal', () => {
    const d = mkProposal('a-decision', { type: 'decision', tier: 1 });
    refused(bridge('decided', { client: 'acme', id: d, note: 'Yes' }), 'changed');
    P.approve({ clientDir: abs('clients/acme'), id: d, by: 'rita-reviewer' });
    refused(bridge('decided', { client: 'acme', id: d, note: '' }), 'bad-request');
    const r = bridge('decided', { client: 'acme', id: d, note: 'Keep the budget' });
    expect(r.reply.ok).toBe(true);
    expect(fmOf(d)).toMatchObject({
      status: 'applied',
      outcome: 'Decision recorded by rita-reviewer: Keep the budget',
    });
  });
});

describe('dry run and apply (decision 12)', () => {
  it('passes --confirmed only for apply, strips proxy lines and keeps the output tail', () => {
    const a = mkProposal('pause-generic');
    const dry = bridge('dry-run', { client: 'acme', id: a });
    expect(dry.reply.ok).toBe(true);
    expect(dry.reply.output).toContain(`STUB dry run for ${a}`);
    expect(dry.reply.output).not.toContain('proxy:');
    refused(bridge('apply', { client: 'acme', id: a, confirmed: true }), 'changed');
    P.approve({ clientDir: abs('clients/acme'), id: a, by: 'rita-reviewer' });
    refused(bridge('apply', { client: 'acme', id: a }), 'bad-request');
    refused(bridge('apply', { client: 'acme', id: a, confirmed: 'yes' }), 'bad-request');
    const live = bridge('apply', { client: 'acme', id: a, confirmed: true });
    expect(live.reply.ok, JSON.stringify(live.reply)).toBe(true);
    expect(live.reply.failed).toBeFalsy();
    expect((live.reply.proposal as { fm: Fm }).fm.status).toBe('applied');
    expect(calls('apply-calls.log')).toEqual([
      ['--client=acme', `--id=${a}`],
      ['--client=acme', `--id=${a}`, '--confirmed'],
    ]);
  });

  it('a refused or failed run says so; an exit it cannot explain is an unknown outcome', () => {
    const a = mkProposal('pause-generic');
    P.approve({ clientDir: abs('clients/acme'), id: a, by: 'rita-reviewer' });
    put('apply-mode', 'refuse');
    const r = bridge('apply', { client: 'acme', id: a, confirmed: true });
    expect(r.reply).toMatchObject({ ok: true, failed: true });
    // Exit 3 (written, read-back disagreed) while the proposal still reads approved and unapplied, as
    // apply.cjs leaves a gads-write change: it could be applied again, so the outcome is unknown and the
    // app keeps Apply locked until someone has checked the account.
    put('apply-mode', 'mismatch');
    refused(bridge('apply', { client: 'acme', id: a, confirmed: true }), 'unknown-outcome');
    // Exit 3 once the proposal is stamped failed (as apply.cjs does for RSA and PMax text): it can't be
    // applied again, so the plain read-back message stands.
    put('apply-mode', 'mismatch-stamped');
    const m = bridge('apply', { client: 'acme', id: a, confirmed: true });
    expect(m.reply).toMatchObject({ ok: true, failed: true });
    expect(m.reply.message).toContain('read-back');
    // `a` is now stamped failed, so the crash case needs a fresh approved proposal.
    const b = mkProposal('pause-brand');
    P.approve({ clientDir: abs('clients/acme'), id: b, by: 'rita-reviewer' });
    put('apply-mode', 'crash');
    refused(bridge('apply', { client: 'acme', id: b, confirmed: true }), 'unknown-outcome');
    // A crashed dry run changed nothing in Google Ads: just a failure.
    expect(bridge('dry-run', { client: 'acme', id: b }).reply).toMatchObject({ ok: true, failed: true });
  });

  it('refuses a proposal without an operations file, and apply before the client has agreed', () => {
    const d = mkProposal('a-decision', { type: 'decision', tier: 1 });
    refused(bridge('dry-run', { client: 'acme', id: d }), 'changed');
    const c = mkProposal('pause-generic', {
      fields: { needs_client_approval: true, client_approver: 'Mark' },
    });
    P.approve({ clientDir: abs('clients/acme'), id: c, by: 'rita-reviewer' });
    refused(bridge('apply', { client: 'acme', id: c, confirmed: true }), 'changed');
    expect(calls('apply-calls.log')).toEqual([]);
  });
});

describe('monthly sign-off', () => {
  it("signs in the person's name and builds the final PDF; others and bad months are refused", () => {
    refused(bridge('sign-monthly', { client: 'acme', month: '2026-13x' }), 'bad-request');
    actAs('Tess Team', 'tess@example.test');
    refused(bridge('sign-monthly', { client: 'acme', month: '2026-10' }), 'not-allowed');
    actAs('Rita Reviewer', 'rita@example.test');
    const r = bridge('sign-monthly', { client: 'acme', month: '2026-10', note: 'Read it' });
    expect(r.reply.ok, JSON.stringify(r.reply)).toBe(true);
    expect(r.reply.message).toContain('Rita Reviewer');
    const review = JSON.parse(readFileSync(abs('clients/acme/reports/monthly/2026-10-review.json'), 'utf8'));
    expect(review).toMatchObject({ reviewed_by: 'rita-reviewer', note: 'Read it' });
    expect(existsSync(abs('clients/acme/reports/monthly/Acme-Ltd-Google-Ads-Report-2026-10.pdf'))).toBe(true);
  });
});

describe('standup', () => {
  it('set-up writes a starter config and never overwrites one', () => {
    const r = bridge('standup-setup', { account: 'acme' });
    expect(r.reply).toMatchObject({ ok: true, created: true });
    const cfg = JSON.parse(readFileSync(abs('clients/acme/standup/config.json'), 'utf8'));
    expect(cfg.enabled_campaigns).toEqual(['Generic', 'Brand']);
    writeFileSync(abs('clients/acme/standup/config.json'), '{"mine":true}');
    const again = bridge('standup-setup', { account: 'acme' });
    expect(again.reply).toMatchObject({ ok: true, created: false });
    expect(readFileSync(abs('clients/acme/standup/config.json'), 'utf8')).toBe('{"mine":true}');
    // Never makes a client folder.
    refused(bridge('standup-setup', { account: 'nobody' }), 'not-found');
    expect(existsSync(abs('clients/nobody'))).toBe(false);
  });

  it('reads the latest brief and writes one rating per call', () => {
    const b = bridge('standup-brief', { account: 'acme' });
    expect(b.reply.brief).toMatchObject({
      ymd: '20261115',
      headline: 'Generic is wasting spend',
      recommendations: [
        { campaign: 'Generic', action_category: 'ADD_NEGATIVES', reason: 'Junk terms', priority: 1 },
        { campaign: 'Brand', action_category: 'NONE', reason: 'Fine', priority: 3 },
      ],
    });
    expect(bridge('standup-brief', { account: 'beta' }).reply.brief).toMatchObject({ recommendations: [] });
    const input = {
      account: 'acme',
      date: '2026-11-15',
      campaign: 'Generic',
      action_category: 'ADD_NEGATIVES',
      score: 4,
      note: 'Good call',
    };
    expect(bridge('standup-feedback', input).reply.ok).toBe(true);
    const fb = JSON.parse(readFileSync(abs('clients/acme/standup/20261115/feedback-generic.json'), 'utf8'));
    expect(fb).toMatchObject({ client: 'acme', campaign: 'Generic', rating: 4, quick_note: 'Good call' });
    refused(bridge('standup-feedback', { ...input, score: 6 }), 'bad-request');
    refused(bridge('standup-feedback', { ...input, date: '20261101' }), 'not-found');
    refused(bridge('standup-feedback', { ...input, account: 'a/b' }), 'bad-request');
  });
});

describe('copies from the Workbench (decision 9)', () => {
  const sources = (): { path: string; sha: string }[] =>
    [
      ...readFileSync(join(SKILL_DIR, 'SOURCES.md'), 'utf8').matchAll(
        /^\| `([^`]+)` \| `([0-9a-f]{64})` \|/gm,
      ),
    ].map((m) => ({ path: m[1] as string, sha: m[2] as string }));

  it('SOURCES.md names every copied file with a sha256', () => {
    const paths = sources().map((s) => s.path);
    for (const p of [
      'tools/members/command-centre/lib/approvals-board.cjs',
      'tools/members/command-centre/lib/ads-board-data.cjs',
      'tools/members/command-centre/lib/ads-normalize.cjs',
      'tools/members/command-centre/lib/standup-board.cjs',
      'tools/members/command-centre/server.cjs',
      'tools/members/command-centre/public/ads-command-board.html',
      '.claude/skills/ads-manager/scripts/lib/proposals.cjs',
      '.claude/skills/ads-manager/scripts/lib/common.cjs',
      '.claude/skills/ads-manager/scripts/monthly.cjs',
    ])
      expect(paths).toContain(p);
    for (const f of ['ads-normalize', 'ads-board-data', 'standup-board', 'approvals-board'])
      expect(readFileSync(join(SKILL_DIR, 'scripts', 'lib', `${f}.cjs`), 'utf8')).toMatch(
        new RegExp(`^// PORTED from the brain Workbench: tools/members/command-centre/lib/${f}\\.cjs`),
      );
  });

  it.skipIf(!hasWorkbench)("the hashes match the brain's files today (drift fails this)", () => {
    for (const s of sources()) {
      const file = join(BRAIN, s.path);
      if (!existsSync(file)) continue;
      const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(sha, `${s.path} changed: copy it again and update SOURCES.md`).toBe(s.sha);
    }
  });
});
