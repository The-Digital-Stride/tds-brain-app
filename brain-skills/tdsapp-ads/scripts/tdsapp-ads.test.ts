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
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
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
  ADS_DRAFT_CHANGE_CAPABILITY,
  ADS_EARLIER_MONTHS_CAPABILITY,
  ADS_EARLIER_MONTHS_MAX,
  ADS_FILE_PATTERN,
  ADS_MONTH,
  ADS_NOTE_MAX,
  ADS_OUTPUT_TAIL,
  ADS_PROPOSAL_ID,
  ADS_RECENT_DAYS,
  ADS_SKILL,
  ADS_TASK_RESULTS_CAPABILITY,
  ADS_TASK_RUNS_CAPABILITY,
  ADS_TOTALS_CAPABILITY,
  ADS_TOTALS_DAYS,
  ADS_TRIAGE_CAPABILITY,
  ADS_TRIAGE_STALE_DAYS,
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
if (mode === 'leak') console.log('{"x-proxy-secret":"s3cret-value"}');
if (mode === 'mismatch-stamped' && argv.includes('--confirmed')) {
  P.stamp({ clientDir: path.join(ROOT, 'clients', arg('client')), id: arg('id') }, { status: 'failed', applied_at: new Date().toISOString(), outcome: 'stub read-back disagreed' });
}
if (mode === 'ok' && argv.includes('--confirmed')) {
  P.stamp({ clientDir: path.join(ROOT, 'clients', arg('client')), id: arg('id') }, { status: 'applied', applied_at: new Date().toISOString(), outcome: 'stub applied' });
}
if (mode === 'live-crash' && argv.includes('--confirmed')) { console.error('live write failed (exit 1)'); process.exit(4); }
if (mode === 'odd-4' && argv.includes('--confirmed')) { console.error('something new went wrong'); process.exit(4); }
if (mode === 'dry-fail') { console.error('dry run failed (exit 1); see proposals/dry-runs/x.md'); process.exit(4); }
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
    // Release 2.
    expect(mod.ADS_TRIAGE_CAPABILITY).toBe(ADS_TRIAGE_CAPABILITY);
    expect(mod.ADS_TOTALS_CAPABILITY).toBe(ADS_TOTALS_CAPABILITY);
    expect(mod.ADS_EARLIER_MONTHS_CAPABILITY).toBe(ADS_EARLIER_MONTHS_CAPABILITY);
    expect(mod.ADS_DRAFT_CHANGE_CAPABILITY).toBe(ADS_DRAFT_CHANGE_CAPABILITY);
    expect(mod.ADS_TASK_RESULTS_CAPABILITY).toBe(ADS_TASK_RESULTS_CAPABILITY);
    expect(mod.ADS_TOTALS_DAYS).toEqual([...ADS_TOTALS_DAYS]);
    expect(mod.ADS_EARLIER_MONTHS_MAX).toBe(ADS_EARLIER_MONTHS_MAX);
    expect(mod.ADS_TRIAGE_STALE_DAYS).toBe(ADS_TRIAGE_STALE_DAYS);
    expect(String(mod.ADS_FILE_PATTERN)).toBe(String(ADS_FILE_PATTERN));
  });

  it('answers one JSON line; unknown actions and bad JSON are bad requests', () => {
    refused(bridge('nope'), 'bad-request');
    refused(bridge('capabilities', '{not json'), 'bad-request');
    refused(bridge('capabilities', '[]'), 'bad-request');
  });
});

const FEATURES = [
  ADS_CAPABILITY,
  ADS_TASK_RUNS_CAPABILITY,
  ADS_TRIAGE_CAPABILITY,
  ADS_TOTALS_CAPABILITY,
  ADS_EARLIER_MONTHS_CAPABILITY,
  ADS_DRAFT_CHANGE_CAPABILITY,
  ADS_TASK_RESULTS_CAPABILITY,
];

describe('capabilities', () => {
  it('reports the feature, the ads-manager libraries and the roster person, not cached', () => {
    const r = bridge('capabilities');
    expect(r.exit).toBe(0);
    expect(r.reply).toMatchObject({
      ok: true,
      action: 'capabilities',
      features: FEATURES,
      version: '0.4',
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
    expect(r2.reply).toMatchObject({
      ok: true,
      features: FEATURES,
      adsManager: false,
      me: null,
    });
    refused(bridge('approvals'), 'unavailable');
  });
});

describe('approvals', () => {
  it('carries people: each roster member by name slug (as proposals and configs write them), to their name', () => {
    writeFileSync(
      abs('.team-config/roles.json'),
      JSON.stringify({
        members: [
          ...ROLES.members,
          { name: 'Pete Tyler', email: 'pete@example.test', role: 'owner', slug: 'owner' },
          { name: '', email: 'blank@example.test', role: 'team' },
        ],
      }),
    );
    const people = bridge('approvals').reply.people as Record<string, string>;
    expect(people['rita-reviewer']).toBe('Rita Reviewer');
    expect(people['sam-scout']).toBe('Sam Scout');
    expect(people['pete-tyler']).toBe('Pete Tyler');
    // The roster's own slug field also names them, and emails never leave the bridge.
    expect(people.owner).toBe('Pete Tyler');
    expect(JSON.stringify(people)).not.toContain('@');
    expect(Object.values(people)).not.toContain('');
  });

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

  it('leaves approved proposals out of the waiting count, as the rail does (they wait for Apply)', () => {
    mkProposal('pause-generic');
    const approved = mkProposal('raise-brand');
    const file = abs(`clients/acme/proposals/${approved}.md`);
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^status: proposed$/m, 'status: approved'));
    expect(fmOf(approved).status).toBe('approved');
    const r = bridge('accounts');
    const acme = (r.reply.accounts as Record<string, unknown>[]).find((a) => a.key === 'acme');
    expect(acme).toMatchObject({ waiting: 1 });
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
    const y = bridge('client-approved', {
      client: 'acme',
      id: a,
      who: 'Mark\n---\nx',
      note: 'By email\r\non 29 Oct',
    });
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

  it('exit 4 after the live write started is an unknown outcome; before it, a plain failure', () => {
    const a = mkProposal('pause-generic');
    P.approve({ clientDir: abs('clients/acme'), id: a, by: 'rita-reviewer' });
    // apply.cjs turns any live gads-write failure (even a crash after the write, before the stamp) into 4.
    put('apply-mode', 'live-crash');
    const r = bridge('apply', { client: 'acme', id: a, confirmed: true });
    refused(r, 'unknown-outcome');
    expect(r.reply.output).toContain('live write failed');
    // The dry run inside apply failed: nothing was sent, so the plain message stands.
    // Fails closed: a 4 whose wording it doesn't recognise also keeps Apply locked.
    put('apply-mode', 'odd-4');
    refused(bridge('apply', { client: 'acme', id: a, confirmed: true }), 'unknown-outcome');
    put('apply-mode', 'dry-fail');
    const d = bridge('apply', { client: 'acme', id: a, confirmed: true });
    expect(d.reply).toMatchObject({ ok: true, failed: true });
    expect(d.reply.message).toContain('nothing was changed');
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
      '.claude/skills/ads-manager/scripts/apply.cjs',
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

describe('task-run and lastRun', () => {
  const runsDir = () => abs('tdsapp-ads/runs/acme');
  const logs = () => (existsSync(runsDir()) ? readdirSync(runsDir()) : []);
  const logLine = (o: Record<string, unknown>) =>
    `${JSON.stringify({
      v: 1,
      ts: new Date().toISOString(),
      account: 'acme',
      task: 'w-search',
      by: 'tess-team',
      by_name: 'Tess Team',
      ...o,
    })}\n`;
  const cards = () =>
    bridge('board', { account: 'acme' }).reply.board as {
      cards: { id: string; lastRun: unknown }[];
      standup: { lastRun: unknown };
    };
  const lastOf = (id: string) => cards().cards.find((c) => c.id === id)?.lastRun;
  // A byte-level listing of a tree, to prove a read changed nothing.
  const snapshot = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const f = join(dir, e.name);
      if (e.name === '.git') return [];
      return e.isDirectory() ? [f, ...snapshot(f)] : [`${f}:${readFileSync(f, 'utf8')}`];
    });

  it('appends the right line, and writes the README and .gitattributes once', () => {
    const r = bridge('task-run', { account: 'acme', task: 'w-search' });
    expect(r.exit, JSON.stringify(r.reply)).toBe(0);
    const run = r.reply.run as { at: string; by: string; byName: string };
    expect(run).toMatchObject({ by: 'rita-reviewer', byName: 'Rita Reviewer' });
    const id = readFileSync(join(home, '.config', 'tdsapp', 'machine-id'), 'utf8').trim();
    expect(logs()).toEqual([`rita-reviewer.${id}.jsonl`]);
    const lines = readFileSync(join(runsDir(), logs()[0] as string), 'utf8')
      .trim()
      .split('\n');
    expect(JSON.parse(lines[0] as string)).toEqual({
      v: 1,
      ts: run.at,
      account: 'acme',
      task: 'w-search',
      by: 'rita-reviewer',
      by_name: 'Rita Reviewer',
    });
    writeFileSync(abs('tdsapp-ads/README.md'), 'edited');
    bridge('task-run', { account: 'acme', task: 'standup:daily' });
    expect(readFileSync(abs('tdsapp-ads/README.md'), 'utf8')).toBe('edited');
    expect(readFileSync(abs('tdsapp-ads/.gitattributes'), 'utf8')).toBe('runs/**/*.jsonl merge=union\n');
    expect(
      readFileSync(join(runsDir(), logs()[0] as string), 'utf8')
        .trim()
        .split('\n'),
    ).toHaveLength(2);
  });

  it('refuses an unknown task, a bad account, an off-roster user and a bad slug', () => {
    refused(bridge('task-run', { account: 'acme', task: 'nope' }), 'bad-request');
    refused(bridge('task-run', { account: 'acme' }), 'bad-request');
    refused(bridge('task-run', { account: '../x', task: 'w-search' }), 'bad-request');
    refused(bridge('task-run', { account: 'nobody', task: 'w-search' }), 'not-found');
    actAs('Stranger Danger', 'stranger@example.test');
    refused(bridge('task-run', { account: 'acme', task: 'w-search' }), 'not-allowed');
    actAs('Rita Reviewer', 'rita@example.test');
    // A roster slug too long to be a file name part.
    const long = 'a'.repeat(100);
    writeFileSync(
      abs('.team-config/roles.json'),
      JSON.stringify({ members: [{ name: long, email: 'rita@example.test', role: 'team' }] }),
    );
    refused(bridge('task-run', { account: 'acme', task: 'w-search' }), 'not-allowed');
    expect(existsSync(abs('tdsapp-ads/runs'))).toBe(false);
  });

  it('refuses a symlinked tdsapp-ads, runs or log file when writing', () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'ads-else-')));
    try {
      symlinkSync(elsewhere, abs('tdsapp-ads'));
      refused(bridge('task-run', { account: 'acme', task: 'w-search' }), 'not-allowed');
      rmSync(abs('tdsapp-ads'));
      mkdirSync(abs('tdsapp-ads'));
      symlinkSync(elsewhere, abs('tdsapp-ads/runs'));
      refused(bridge('task-run', { account: 'acme', task: 'w-search' }), 'not-allowed');
      rmSync(abs('tdsapp-ads/runs'));
      mkdirSync(runsDir(), { recursive: true });
      bridge('task-run', { account: 'acme', task: 'w-search' });
      const file = join(runsDir(), logs()[0] as string);
      rmSync(file);
      writeFileSync(join(elsewhere, 'target'), '');
      symlinkSync(join(elsewhere, 'target'), file);
      refused(bridge('task-run', { account: 'acme', task: 'w-search' }), 'not-allowed');
      expect(readFileSync(join(elsewhere, 'target'), 'utf8')).toBe('');
      expect(readdirSync(elsewhere)).toEqual(['target']);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('skips a symlinked folder or log file when reading', () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'ads-else-')));
    try {
      writeFileSync(join(elsewhere, 'tess-team.aaaaaa.jsonl'), logLine({}));
      mkdirSync(abs('tdsapp-ads/runs'), { recursive: true });
      symlinkSync(elsewhere, runsDir());
      expect(lastOf('w-search')).toBeNull();
      rmSync(runsDir());
      mkdirSync(runsDir());
      symlinkSync(join(elsewhere, 'tess-team.aaaaaa.jsonl'), join(runsDir(), 'tess-team.aaaaaa.jsonl'));
      expect(lastOf('w-search')).toBeNull();
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('compacts to the newest line per task, and a quarterly run survives 3,000 later lines', () => {
    const quarterly = JSON.parse(
      readFileSync(join(SKILL_DIR, 'scripts', 'cadence-tasks.json'), 'utf8'),
    ).cards.find((c: { cadence: string }) => c.cadence === 'quarterly').id as string;
    bridge('task-run', { account: 'acme', task: quarterly });
    const file = join(runsDir(), logs()[0] as string);
    const old = new Date(Date.now() - 60_000).toISOString();
    const filler = Array.from({ length: 3000 }, (_, i) =>
      logLine({
        task: 'w-search',
        by: 'rita-reviewer',
        by_name: 'Rita Reviewer',
        ts: new Date(Date.now() - 50_000 + i).toISOString(),
      }),
    ).join('');
    writeFileSync(file, readFileSync(file, 'utf8') + filler);
    expect(lstatSync(file).size).toBeGreaterThan(64 * 1024);
    bridge('task-run', { account: 'acme', task: 'w-search' });
    const kept = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(kept.map((l) => l.task).sort()).toEqual([quarterly, 'w-search'].sort());
    expect(lastOf(quarterly)).toMatchObject({ by: 'rita-reviewer' });
    expect(old < new Date().toISOString()).toBe(true);
  });

  it('compaction never follows a link planted beside the log, and leaves no temp file', () => {
    bridge('task-run', { account: 'acme', task: 'w-search' });
    const name = logs()[0] as string;
    const file = join(runsDir(), name);
    const outside = join(home, 'precious.txt');
    writeFileSync(outside, 'keep me');
    for (let i = 0; i < 50; i++) symlinkSync(outside, `${file}.${i}.tmp`);
    writeFileSync(file, readFileSync(file, 'utf8') + logLine({ by: 'rita-reviewer' }).repeat(800));
    expect(bridge('task-run', { account: 'acme', task: 'w-search' }).exit).toBe(0);
    expect(readFileSync(outside, 'utf8')).toBe('keep me');
    expect(lstatSync(file).isFile()).toBe(true);
    expect(lstatSync(file).size).toBeLessThan(64 * 1024);
    expect(logs().filter((n) => n.endsWith('.tmp') && !/\.\d+\.tmp$/.test(n))).toEqual([]);
  });

  it('compaction drops lines for tasks that are not on the list', () => {
    bridge('task-run', { account: 'acme', task: 'w-search' });
    const file = join(runsDir(), logs()[0] as string);
    const junk = Array.from({ length: 800 }, (_, i) =>
      logLine({ by: 'rita-reviewer', task: `junk-${i}` }),
    ).join('');
    writeFileSync(file, readFileSync(file, 'utf8') + junk);
    bridge('task-run', { account: 'acme', task: 'w-search' });
    const tasks = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l).task);
    expect(tasks).toEqual(['w-search']);
  });

  it('a log padded past 4 MB is left alone, and recording still works', () => {
    bridge('task-run', { account: 'acme', task: 'w-search' });
    const file = join(runsDir(), logs()[0] as string);
    writeFileSync(file, `${readFileSync(file, 'utf8') + 'x'.repeat(4 * 1024 * 1024 + 10)}\n`);
    const before = lstatSync(file).size;
    expect(bridge('task-run', { account: 'acme', task: 'w-search' }).exit).toBe(0);
    expect(lstatSync(file).size).toBeGreaterThan(before);
  });

  it('only files named like a run log count, so junk files never crowd out real ones', () => {
    mkdirSync(runsDir(), { recursive: true });
    for (let i = 0; i < 210; i++)
      writeFileSync(join(runsDir(), `aaa-${i}.jsonl`), logLine({ by: `aaa-${i}` }));
    writeFileSync(join(runsDir(), 'Bad Name.aaaaaa.jsonl'), logLine({ by: 'Bad Name' }));
    writeFileSync(join(runsDir(), 'zed-real.cccccc.jsonl'), logLine({ by: 'zed-real', by_name: 'Zed Real' }));
    expect(lastOf('w-search')).toMatchObject({ by: 'zed-real', byName: 'Zed Real' });
  });

  it('board returns the newest run across two people, with byName', () => {
    mkdirSync(runsDir(), { recursive: true });
    writeFileSync(join(runsDir(), 'tess-team.aaaaaa.jsonl'), logLine({ ts: '2026-11-10T10:00:00.000Z' }));
    writeFileSync(
      join(runsDir(), 'sam-scout.bbbbbb__from-remote.jsonl'),
      logLine({ ts: '2026-11-12T09:30:00.000Z', by: 'sam-scout', by_name: 'Sam Scout' }) +
        logLine({
          ts: '2026-11-11T09:30:00.000Z',
          by: 'sam-scout',
          by_name: 'Sam Scout',
          task: 'standup:daily',
        }),
    );
    expect(lastOf('w-search')).toEqual({
      at: '2026-11-12T09:30:00.000Z',
      by: 'sam-scout',
      byName: 'Sam Scout',
    });
    expect(cards().standup.lastRun).toEqual({
      at: '2026-11-11T09:30:00.000Z',
      by: 'sam-scout',
      byName: 'Sam Scout',
    });
    expect(lastOf('m-rsa')).toBeNull();
  });

  it('board skips bad JSON, wrong account, far-future ts and a by/filename mismatch', () => {
    mkdirSync(runsDir(), { recursive: true });
    const future = new Date(Date.now() + 3_600_000).toISOString();
    writeFileSync(
      join(runsDir(), 'tess-team.aaaaaa.jsonl'),
      [
        '{not json\n',
        logLine({ account: 'beta' }),
        logLine({ ts: future }),
        logLine({ ts: 'nonsense' }),
        logLine({ v: 2 }),
        logLine({ by: 'sam-scout' }),
      ].join(''),
    );
    expect(lastOf('w-search')).toBeNull();
    writeFileSync(
      join(runsDir(), 'tess-team.aaaaaa.jsonl'),
      logLine({ ts: '2026-11-09T08:00:00.000Z', by_name: `T\nes${'x'.repeat(200)}` }),
    );
    const got = lastOf('w-search') as { by: string; byName: string };
    expect(got.by).toBe('tess-team');
    expect(got.byName.length).toBeLessThanOrEqual(80);
    expect(got.byName).not.toContain('\n');
  });

  it('board on a brain with no tdsapp-ads leaves the tree byte-identical and every lastRun null', () => {
    const before = snapshot(root);
    const b = cards();
    expect(snapshot(root)).toEqual(before);
    expect(existsSync(abs('tdsapp-ads'))).toBe(false);
    expect(existsSync(join(home, '.config'))).toBe(false);
    expect(b.cards.every((c) => c.lastRun === null)).toBe(true);
    expect(b.standup.lastRun).toBeNull();
  });
});

// ── Release 2 ────────────────────────────────────────────────────────────────────────────────

const localYmd = (daysBack: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};
const dashed = (y: string) => `${y.slice(0, 4)}-${y.slice(4, 6)}-${y.slice(6, 8)}`;

describe('triage', () => {
  const standup = (key: string, daysBack: number | null, flagged: number, anomalies = 0, config = true) => {
    if (config) put(`clients/${key}/standup/config.json`, JSON.stringify({ campaigns: [] }));
    if (daysBack === null) return;
    const verdicts = Array.from({ length: flagged }, (_, i) => ({
      campaign: `C${i}`,
      action_category: 'ADD_NEGATIVES',
    }));
    put(
      `clients/${key}/standup/${localYmd(daysBack)}/brief.json`,
      JSON.stringify({
        headline: `${key} headline`,
        per_campaign_verdicts: verdicts,
        anomalies: Array.from({ length: anomalies }, () => ({})),
      }),
    );
  };
  const dataFor = (key: string) =>
    put(`clients/${key}/context/google-ads/board/summary.csv`, 'Date,Campaign,Cost\n2026-11-01,X,1\n');
  type Row = {
    key: string;
    name: string;
    hasStandup: boolean;
    verdict: { date: string } | null;
    stale: boolean;
  };
  const rows = () => bridge('triage').reply.rows as Row[];

  it('orders fresh by flagged then anomalies, then stale, then not run, then no standup, ties by name', () => {
    rmSync(abs('clients/acme/standup/20261115'), { recursive: true });
    standup('acme', 0, 1, 0);
    standup('bravo', 1, 3, 0);
    standup('charlie', 0, 3, 2);
    standup('delta', 0, 3, 2);
    standup('stale-big', ADS_TRIAGE_STALE_DAYS, 9, 9);
    standup('stale-small', ADS_TRIAGE_STALE_DAYS + 5, 1, 0);
    standup('no-verdict', null, 0);
    dataFor('no-standup');
    const out = rows();
    expect(out.map((r) => r.key)).toEqual([
      'charlie',
      'delta',
      'bravo',
      'acme',
      'stale-big',
      'stale-small',
      'no-verdict',
      'Gamma_Co',
      'no-standup',
    ]);
    const by = Object.fromEntries(out.map((r) => [r.key, r]));
    expect(by.charlie).toMatchObject({ name: 'charlie', hasStandup: true, stale: false });
    expect(by.charlie?.verdict).toMatchObject({ date: dashed(localYmd(0)), flagged: 3, anomalies: 2 });
    expect(by.bravo?.stale).toBe(false);
    expect(by['stale-big']?.stale).toBe(true);
    expect(by['no-verdict']).toMatchObject({ hasStandup: true, verdict: null, stale: false });
    expect(by['no-standup']).toMatchObject({ hasStandup: false, verdict: null, stale: false });
    expect(by.acme?.name).toBe('Acme Ltd');
  });

  it('counts local calendar days: one day old is fresh, ADS_TRIAGE_STALE_DAYS is stale', () => {
    standup('one', 1, 1);
    standup('limit', ADS_TRIAGE_STALE_DAYS, 1);
    const by = Object.fromEntries(rows().map((r) => [r.key, r]));
    expect(by.one?.stale).toBe(ADS_TRIAGE_STALE_DAYS <= 1);
    expect(by.limit?.stale).toBe(true);
  });

  it('only lists keys that match the account pattern, and changes nothing', () => {
    put('clients/bad key/context/google-ads/board/summary.csv', 'Date,Campaign,Cost\n2026-11-01,X,1\n');
    expect(rows().map((r) => r.key)).not.toContain('bad key');
    const r = bridge('triage');
    expect(r.exit).toBe(0);
    expect(r.reply.action).toBe('triage');
  });
});

describe('board totalRanges', () => {
  const END = '2026-11-15';
  const dayStr = (back: number) =>
    new Date(Date.parse(`${END}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
  // One Brand row a day (cost 10, 1 conversion, value 40) for `n` days ending END; the last day also has a
  // Generic row (cost 5, no conversions).
  const daily = (n: number) =>
    `Date,Campaign,Cost,Conversions,Conv. value,Impressions,Clicks\n${[
      ...Array.from({ length: n }, (_, i) => `${dayStr(n - 1 - i)},Brand,10,1,40,100,10`),
      `${END},Generic,5,0,0,50,5`,
    ].join('\n')}\n`;
  const ranges = (account = 'acme') =>
    (
      bridge('board', { account }).reply.board as {
        totalRanges: { ranges: Range[]; wastedSpend: number | null };
      }
    ).totalRanges;
  type Fig = { spend: number; conversions: number; value: number; roas: number | null; cpa: number | null };
  type Range = {
    days: number;
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
    current: Fig;
    previous: Fig | null;
    partial: boolean;
    dataFrom: string | null;
  };
  const csv = (rel: string, text: string) => put(`clients/acme/context/google-ads/board/${rel}`, text);

  it('has one range per ADS_TOTALS_DAYS ending on the newest date, with the period before', () => {
    csv('summary.csv', daily(100));
    const t = ranges();
    expect(t.ranges.map((r) => r.days)).toEqual([...ADS_TOTALS_DAYS]);
    const [r7, r30, r90] = t.ranges as [Range, Range, Range];
    expect(r7).toMatchObject({
      from: dayStr(6),
      to: END,
      previousFrom: dayStr(13),
      previousTo: dayStr(7),
      partial: false,
    });
    expect(r7.current).toEqual({ spend: 75, conversions: 7, value: 280, roas: 3.7333, cpa: 10.71 });
    expect(r7.previous).toEqual({ spend: 70, conversions: 7, value: 280, roas: 4, cpa: 10 });
    expect(r30.current.spend).toBe(305);
    expect(r30.previous).toMatchObject({ spend: 300, conversions: 30 });
    expect(r30.previousTo).toBe(dayStr(30));
    // 90 days: the file (100 days) doesn't reach 180 back.
    expect(r90.partial).toBe(false);
    expect(r90.previous).toBeNull();
    expect(r90.previousFrom).toBe(dayStr(179));
  });

  it('is partial when the file starts inside the range, and has no previous when it cannot reach', () => {
    csv('summary.csv', daily(20));
    const [r7, r30, r90] = ranges().ranges as [Range, Range, Range];
    expect(r7.partial).toBe(false);
    expect(r7.previous).not.toBeNull();
    expect(r30.partial).toBe(true);
    expect(r30.dataFrom).toBe(dayStr(19));
    expect(r7.dataFrom).toBe(dayStr(19));
    expect(r30.previous).toBeNull();
    expect(r30.current.spend).toBe(205);
    expect(r90.partial).toBe(true);
    expect(r90.previous).toBeNull();
  });

  it('ends on the pull date and covers the whole pull when early days had no rows (account not serving)', () => {
    // 175 days of rows ending 3 days before the pull's `through`: the pull asked for 180 days to END.
    const rows = Array.from({ length: 175 }, (_, i) => `${dayStr(177 - i)},Brand,10,1,40,100,10`);
    csv('summary.csv', `Date,Campaign,Cost,Conversions,Conv. value\n${rows.join('\n')}\n`);
    csv('_refreshed.json', JSON.stringify({ at: '2026-11-16T06:00:00.000Z', through: END }));
    const [r7, , r90] = ranges().ranges as [Range, Range, Range];
    expect(r7).toMatchObject({ from: dayStr(6), to: END, partial: false, dataFrom: dayStr(179) });
    expect(r7.current.spend).toBe(40); // 4 days with rows, 3 quiet days at the end
    expect(r90.partial).toBe(false);
    expect(r90.previous).toMatchObject({ spend: 880 }); // 88 of its 90 days have rows
  });

  it('ignores a pull date older than the newest row, and keeps short files partial', () => {
    csv('summary.csv', daily(20));
    csv('_refreshed.json', JSON.stringify({ at: '2026-11-01T06:00:00.000Z', through: dayStr(30) }));
    const [r7, r30] = ranges().ranges as [Range, Range, Range];
    expect(r7.to).toBe(END);
    expect(r30).toMatchObject({ partial: true, previous: null, dataFrom: dayStr(19) });
    // A current pull date still doesn't stretch a file that starts long after the pull's first day.
    csv('_refreshed.json', JSON.stringify({ at: '2026-11-16T06:00:00.000Z', through: END }));
    expect(ranges().ranges[1]).toMatchObject({ partial: true, previous: null, dataFrom: dayStr(19) });
  });

  it('gives roas null for zero value or spend and cpa null for zero conversions', () => {
    const t = ranges('Gamma_Co');
    const r = t.ranges[1] as Range;
    expect(r.current).toEqual({ spend: 10, conversions: 0, value: 0, roas: null, cpa: null });
    csv('summary.csv', 'Date,Campaign,Cost,Conversions,Conv. value\n2026-11-15,A,0,2,50\n');
    expect((ranges().ranges[1] as Range).current).toEqual({
      spend: 0,
      conversions: 2,
      value: 50,
      roas: null,
      cpa: 0,
    });
  });

  it('wastedSpend sums every search term with no conversions, not just the top ten', () => {
    csv(
      'search80.csv',
      `Search term,Campaign,Cost,Conversions,Conv. value,Clicks,Impressions\n${[
        ...Array.from({ length: 12 }, (_, i) => `junk ${i},G,1.5,0,0,1,10`),
        'free,G,0,0,0,1,10',
        'half,G,9,0.5,0,1,10',
        'good,B,20,3,90,5,50',
      ].join('\n')}\n`,
    );
    expect(ranges().wastedSpend).toBe(27);
  });

  it('has empty ranges and null wastedSpend without data, and never a `totals` key', () => {
    const t = ranges('beta');
    expect(t).toEqual({ ranges: [], wastedSpend: null });
    expect(bridge('board', { account: 'beta' }).reply.board).not.toHaveProperty('totals');
    expect(bridge('board', { account: 'acme' }).reply.board).not.toHaveProperty('totals');
    expect(bridge('board', { account: 'acme' }).reply.board).toHaveProperty('totalRanges');
  });
});

describe('earlierMonths', () => {
  const close = (month: string, extra: Record<string, unknown> = {}, body = true) => {
    put(
      `clients/acme/reports/monthly/${month}-monthly-close.json`,
      JSON.stringify({
        name: 'Acme Ltd',
        monthName: `M ${month}`,
        partial: false,
        dataTo: `${month}-28`,
        ...extra,
      }),
    );
    if (body)
      put(`clients/acme/reports/monthly/Acme-Ltd-Google-Ads-Report-${month}.body.html`, '<div>x</div>');
  };
  const acme = (who?: string) => {
    if (who) actAs(who, `${who.split(' ')[0]?.toLowerCase()}@example.test`);
    const cs = bridge('approvals').reply.clients as Record<string, unknown>[];
    return cs.find((c) => c.slug === 'acme') as {
      monthly: { month: string } | null;
      earlierMonths: { month: string; canSign: boolean; signed: boolean }[];
    };
  };

  it('lists the months before the latest, newest first, with the same canSign rule', () => {
    close('2026-11', { partial: true });
    close('2026-09');
    close('2026-08', { partial: true });
    close('2026-07', {}, false);
    const a = acme();
    expect(a.monthly?.month).toBe('2026-11');
    expect(a.earlierMonths.map((m) => m.month)).toEqual(['2026-10', '2026-09', '2026-08', '2026-07']);
    expect(a.earlierMonths.map((m) => m.canSign)).toEqual([true, true, false, false]);
    expect(a.earlierMonths[0]).toMatchObject({ monthName: 'October 2026', signed: false });
    expect(a.earlierMonths[0]).toHaveProperty('files');
  });

  it('is capped at ADS_EARLIER_MONTHS_MAX, and canSign is false for someone who is not on the client', () => {
    for (let m = 1; m <= 9; m++) close(`2025-0${m}`);
    for (let m = 10; m <= 12; m++) close(`2025-${m}`);
    for (let m = 1; m <= 5; m++) close(`2026-0${m}`);
    const a = acme();
    expect(a.monthly?.month).toBe('2026-10');
    expect(a.earlierMonths).toHaveLength(ADS_EARLIER_MONTHS_MAX);
    expect(a.earlierMonths[0]?.month).toBe('2026-05');
    const t = acme('Tess Team');
    expect(t.earlierMonths.every((m) => m.canSign === false)).toBe(true);
  });

  it('is empty for a client with no month files, and leaves approvals-board output otherwise as it was', () => {
    const cs = bridge('approvals').reply.clients as {
      slug: string;
      earlierMonths: unknown[];
      monthly: unknown;
    }[];
    const beta = cs.find((c) => c.slug === 'beta');
    expect(beta?.monthly).toBeNull();
    expect(beta?.earlierMonths).toEqual([]);
    expect(acme().earlierMonths).toEqual([]);
  });
});

describe('decided with draftChange', () => {
  const approvedDecision = (slug = 'a-decision') => {
    const d = mkProposal(slug, { type: 'decision', tier: 1 });
    P.approve({ clientDir: abs('clients/acme'), id: d, by: 'rita-reviewer' });
    return d;
  };

  it('replies the filled draft prompt only when asked, and records the decision either way', () => {
    const d = approvedDecision();
    const r = bridge('decided', { client: 'acme', id: d, note: 'Keep "the" budget', draftChange: true });
    expect(r.reply.ok, JSON.stringify(r.reply)).toBe(true);
    expect(r.reply.message).toBe(
      'Decision recorded. A chat is drafting the change proposal: open it to follow along. It may ask you a question, or stop if no change is needed.',
    );
    expect(r.reply.draftPrompt).toBe(
      `Draft a change proposal from an ads-manager decision. Decision proposal ${d} for client acme. Rita Reviewer recorded this decision on the Workbench:\n\n"Keep 'the' budget"\n\nFollow the ads-manager skill, section "Turning a decision into a change proposal". Never approve, apply or post anything: the new change proposal goes to Rita Reviewer on the Workbench Ads tab as proposed.`,
    );
    expect(fmOf(d)).toMatchObject({ status: 'applied' });
    const e = approvedDecision('another-decision');
    const plain = bridge('decided', { client: 'acme', id: e, note: 'Fine' });
    expect(plain.reply).toMatchObject({ ok: true, message: 'Decision recorded.' });
    expect(plain.reply).not.toHaveProperty('draftPrompt');
    const off = approvedDecision('third-decision');
    const no = bridge('decided', { client: 'acme', id: off, note: 'Fine', draftChange: false });
    expect(no.reply).toMatchObject({ ok: true, message: 'Decision recorded.' });
    expect(no.reply).not.toHaveProperty('draftPrompt');
  });

  it('refuses a draftChange that is not a boolean, recording nothing', () => {
    const d = approvedDecision();
    for (const bad of ['true', 1, null, {}, []])
      refused(bridge('decided', { client: 'acme', id: d, note: 'Yes', draftChange: bad }), 'bad-request');
    expect(fmOf(d).status).toBe('approved');
  });

  it('keeps the prompt in cadence-tasks.json and says so in _source', () => {
    const tasks = JSON.parse(readFileSync(join(SKILL_DIR, 'scripts', 'cadence-tasks.json'), 'utf8'));
    expect(tasks.draftChangePrompt).toContain('{{id}}');
    expect(tasks._source).toContain('draftChangePrompt');
    expect(readFileSync(join(SKILL_DIR, 'SOURCES.md'), 'utf8')).toContain('draftChangePrompt');
  });
});

describe('task-result', () => {
  const runsDir = () => abs('tdsapp-ads/runs/acme');
  const logFile = () => join(runsDir(), readdirSync(runsDir())[0] as string);
  const lines = () =>
    readFileSync(logFile(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  const REPORT = 'clients/acme/reports/weekly/search.md';
  const run = (task = 'w-search') =>
    bridge('task-run', { account: 'acme', task }).reply.run as { at: string };
  const result = (at: string, path: unknown, task: unknown = 'w-search', account: unknown = 'acme') =>
    bridge('task-result', { account, task, at, result: path });
  const lastRunOf = (id: string) =>
    (
      bridge('board', { account: 'acme' }).reply.board as {
        cards: { id: string; lastRun: { at: string; result?: string } | null }[];
      }
    ).cards.find((c) => c.id === id)?.lastRun;
  beforeEach(() => put(REPORT, '# report'));

  it('appends one v2 line per run and a second call writes nothing', () => {
    const { at } = run();
    const r = result(at, REPORT);
    expect(r.exit, JSON.stringify(r.reply)).toBe(0);
    expect(r.reply.result).toBe(REPORT);
    expect(lines()).toHaveLength(2);
    const l = lines()[1] as Record<string, unknown>;
    expect(l).toMatchObject({
      v: 2,
      kind: 'result',
      run_ts: at,
      account: 'acme',
      task: 'w-search',
      by: 'rita-reviewer',
      by_name: 'Rita Reviewer',
      result: REPORT,
    });
    expect(typeof l.ts).toBe('string');
    put('clients/acme/reports/weekly/other.md', 'x');
    expect(result(at, 'clients/acme/reports/weekly/other.md').reply).toMatchObject({
      ok: true,
      result: REPORT,
    });
    expect(lines()).toHaveLength(2);
  });

  it('refuses bad paths and records nothing', () => {
    const { at } = run();
    put('clients/beta/reports/x.md', 'x');
    put('clients/acme/notes/x.md', 'x');
    mkdirSync(abs('clients/acme/reports/dir.md'), { recursive: true });
    for (const bad of [
      'clients/beta/reports/x.md',
      'clients/acme/notes/x.md',
      'clients/acme/reports/../reports/weekly/search.md',
      'clients/acme/reports/./weekly/search.md',
      'clients/acme/reports/weekly/missing.md',
      'clients/acme/reports/dir.md',
      '/etc/passwd',
      `${REPORT}\n`,
      'clients/acme/reports/x.exe',
      `clients/acme/reports/${'a'.repeat(400)}.md`,
      7,
      null,
      undefined,
    ])
      refused(result(at, bad), 'bad-request');
    expect(lines()).toHaveLength(1);
  });

  it('refuses a symlinked file or folder along the path', () => {
    const { at } = run();
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'ads-else-')));
    try {
      writeFileSync(join(elsewhere, 'secret.md'), 's');
      symlinkSync(join(elsewhere, 'secret.md'), abs('clients/acme/reports/link.md'));
      symlinkSync(elsewhere, abs('clients/acme/reports/linkdir'));
      refused(result(at, 'clients/acme/reports/link.md'), 'bad-request');
      refused(result(at, 'clients/acme/reports/linkdir/secret.md'), 'bad-request');
      expect(lines()).toHaveLength(1);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('refuses unknown runs, tasks, accounts and people', () => {
    const { at } = run();
    refused(result(new Date().toISOString(), REPORT), 'bad-request');
    refused(result(at, REPORT, 'm-rsa'), 'bad-request');
    refused(result(at, REPORT, 'nope'), 'bad-request');
    refused(result(7 as unknown as string, REPORT), 'bad-request');
    refused(result(at, REPORT, 'w-search', '../x'), 'bad-request');
    refused(result(at, REPORT, 'w-search', 'nobody'), 'not-found');
    actAs('Stranger Danger', 'stranger@example.test');
    refused(result(at, REPORT), 'not-allowed');
    expect(lines()).toHaveLength(1);
  });

  it("refuses another person's run, and a log that is a link", () => {
    mkdirSync(runsDir(), { recursive: true });
    const at = '2026-11-10T10:00:00.000Z';
    writeFileSync(
      join(runsDir(), 'tess-team.aaaaaa.jsonl'),
      `${JSON.stringify({ v: 1, ts: at, account: 'acme', task: 'w-search', by: 'tess-team', by_name: 'Tess Team' })}\n`,
    );
    // Rita has no log of her own yet: nothing to attach to.
    refused(result(at, REPORT), 'bad-request');
    expect(readdirSync(runsDir())).toEqual(['tess-team.aaaaaa.jsonl']);
    const { at: mine } = run();
    const file = logFile();
    const text = readFileSync(file, 'utf8');
    rmSync(file);
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'ads-else-')));
    try {
      writeFileSync(join(elsewhere, 'target'), text);
      symlinkSync(join(elsewhere, 'target'), file);
      refused(result(mine, REPORT), 'not-allowed');
      expect(readFileSync(join(elsewhere, 'target'), 'utf8')).toBe(text);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('attaches the result to its own run only, and a v2 line never counts as a run', () => {
    const first = run();
    result(first.at, REPORT);
    expect(lastRunOf('w-search')).toMatchObject({ at: first.at, result: REPORT });
    const second = run();
    expect(second.at).not.toBe(first.at);
    expect(lastRunOf('w-search')?.at).toBe(second.at);
    expect(lastRunOf('w-search')).not.toHaveProperty('result');
    // A log holding only a result line has no run.
    mkdirSync(runsDir(), { recursive: true });
    writeFileSync(
      join(runsDir(), 'tess-team.aaaaaa.jsonl'),
      `${JSON.stringify({ v: 2, kind: 'result', ts: new Date().toISOString(), run_ts: '2026-11-01T00:00:00.000Z', account: 'acme', task: 'm-rsa', by: 'tess-team', by_name: 'Tess', result: REPORT })}\n`,
    );
    expect(lastRunOf('m-rsa')).toBeNull();
  });

  it('ignores a result line from another file or person, and a hand-edited bad path', () => {
    const { at } = run();
    result(at, REPORT);
    const file = logFile();
    const good = readFileSync(file, 'utf8');
    for (const bad of [
      '../../etc/passwd',
      'clients/beta/reports/x.md',
      'clients/acme/reports/../reports/weekly/search.md',
      'clients/acme/notes/x.md',
      `clients/acme/reports/${'a'.repeat(400)}.md`,
      42,
    ]) {
      writeFileSync(file, good.replace(JSON.stringify(REPORT), JSON.stringify(bad)));
      expect(lastRunOf('w-search')).toEqual({ at, by: 'rita-reviewer', byName: 'Rita Reviewer' });
    }
    // The same result line, in someone else's file, doesn't attach to Rita's run.
    writeFileSync(file, `${good.split('\n')[0]}\n`);
    writeFileSync(
      join(runsDir(), 'tess-team.aaaaaa.jsonl'),
      `${JSON.stringify({ v: 2, kind: 'result', ts: new Date().toISOString(), run_ts: at, account: 'acme', task: 'w-search', by: 'tess-team', by_name: 'Tess', result: REPORT })}\n`,
    );
    expect(lastRunOf('w-search')).toEqual({ at, by: 'rita-reviewer', byName: 'Rita Reviewer' });
    // A result line whose by isn't the file's person is ignored too.
    writeFileSync(
      file,
      good.replace(
        '"by":"rita-reviewer","by_name":"Rita Reviewer","result"',
        '"by":"tess-team","by_name":"Rita Reviewer","result"',
      ),
    );
    expect(lastRunOf('w-search')).toEqual({ at, by: 'rita-reviewer', byName: 'Rita Reviewer' });
    writeFileSync(file, good);
    expect(lastRunOf('w-search')?.result).toBe(REPORT);
  });

  it('compaction keeps each task newest v1 line and its result line, and drops stale result lines', () => {
    const old = run('w-search');
    result(old.at, REPORT);
    const newest = run('w-search');
    const other = run('m-rsa');
    result(other.at, REPORT, 'm-rsa');
    result(newest.at, REPORT);
    const file = logFile();
    const filler = Array.from({ length: 3000 }, (_, i) =>
      JSON.stringify({
        v: 1,
        ts: new Date(Date.now() - 50_000 + i).toISOString(),
        account: 'acme',
        task: 'standup:daily',
        by: 'rita-reviewer',
        by_name: 'Rita Reviewer',
      }),
    ).join('\n');
    writeFileSync(file, `${readFileSync(file, 'utf8')}${filler}\n`);
    run('standup:daily');
    const kept = lines();
    const v1 = kept.filter((l) => l.v === 1);
    const v2 = kept.filter((l) => l.v === 2);
    expect(v1.map((l) => l.task).sort()).toEqual(['m-rsa', 'standup:daily', 'w-search']);
    expect(v1.find((l) => l.task === 'w-search')?.ts).toBe(newest.at);
    expect(v2.map((l) => l.run_ts).sort()).toEqual([other.at, newest.at].sort());
    expect(lastRunOf('w-search')).toMatchObject({ at: newest.at, result: REPORT });
    expect(lastRunOf('m-rsa')).toMatchObject({ at: other.at, result: REPORT });
  });
});
