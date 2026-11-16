#!/usr/bin/env node
// tdsapp-ads.cjs (v0.1): the bridge TDS Cortex's Ad Manager runs for the Workbench's Ads tab, without the
// Workbench. Plan: the app repo's docs/plans/2026-11-16-workbench-ad-manager.md (decisions 7-12); shapes:
// its shared/ads-contract.ts (a test checks the constants here match).
//
// Usage:
//   echo '<json>' | node .claude/skills/tdsapp-ads/scripts/tdsapp-ads.cjs <action>
//
//   stdout  one JSON line: {ok: true, action, ...} or {ok: false, code, error}.
//   exit    0 ok; 2 refused (bad-request, not-found, not-allowed, changed, unknown-outcome, unavailable);
//           1 internal.
//
// Every rule about proposals lives in the brain's ads-manager skill and is loaded from the brain root at run
// time: proposals.cjs (read, list, approve, reject, requestChanges, recordClientApproval, stamp), monthly.cjs
// (monthStatus, sign), apply.cjs (dry run and live write) and client-draft.cjs. Nothing here copies them.
// The Workbench pieces this needs (board reader, approvals roll-up, standup) are ported into ./lib, and its
// prompts are in ./cadence-tasks.json, verbatim; ../SOURCES.md records each source's sha256.
//
// The caller is DISTRUSTED:
//   - The person is P.gitUser() matched against .team-config/roles.json; stdin never names the actor (any
//     `by`, `as` or `me` field is ignored). Every change needs a roster identity. The library checks who may
//     approve, reject and request changes; it does NOT check `decided` (P.stamp), dry-run, apply (falls back to
//     $USER) or client-draft, so this script checks the same rule (reviewer, owner, or the owner role) for
//     those, and for recording the client's yes, before running anything.
//   - Ids, client slugs, account keys and months must match the contract's patterns. A client must have
//     config/management.json; an account must be a folder under clients/. Nothing makes a client folder.
//   - `--confirmed` is passed to apply.cjs only for `apply`, and only when stdin says `"confirmed": true`.
//     apply.cjs re-checks the approval (checkApproved) itself.
//   - apply and dry-run run apply.cjs to the end (no time limit here); the app runs this script detached and
//     never kills it. An apply exit that doesn't say what happened (not 0, 2, 3 or 4) is `unknown-outcome`.
//
// When `require`d it runs nothing and exports its constants and run(). Plain Node, no dependencies.

'use strict';

const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_VERSION = '0.2';

// Mirrors shared/ads-contract.ts (a test checks they match).
const ADS_CAPABILITY = 'ads-v1';
const ADS_TASK_RUNS_CAPABILITY = 'task-runs-v1';
const ADS_ACCOUNT_KEY = /^[A-Za-z0-9_-]{1,80}$/;
const ADS_PROPOSAL_ID = /^\d{8}-\d{2}-[a-z0-9-]+$/;
const ADS_CLIENT_SLUG = /^[a-z0-9-]+$/;
const ADS_MONTH = /^\d{4}-\d{2}$/;
const ADS_NOTE_MAX = 1000;
const ADS_RECENT_DAYS = 14;
const ADS_OUTPUT_TAIL = 6000;

const INPUT_MAX = 65536;
const WHO_MAX = 200;
const CAMPAIGN_MAX = 300;
const CATEGORY_MAX = 80;
const SLUG_MAX = 80;
const RUN_SLUG = /^[a-z0-9-]{1,80}$/;
const RUN_NAME_MAX = 80;
const RUN_COMPACT_BYTES = 64 * 1024;
const RUN_READ_FILES = 200;
const RUN_READ_BYTES = 1024 * 1024;
const RUN_FUTURE_MS = 10 * 60 * 1000;
const RUNS_DIR = 'tdsapp-ads';
const ERRORS = new Set([
  'bad-request',
  'not-found',
  'not-allowed',
  'changed',
  'no-access',
  'unknown-outcome',
  'unavailable',
  'internal',
]);
// What the bridge needs from the brain's ads-manager (an older one without these is `adsManager: false`).
const NEEDS_P = ['list', 'read', 'approve', 'reject', 'requestChanges', 'recordClientApproval', 'stamp', 'findMember', 'gitUser', 'loadManagement', 'validate', 'proposalFile'];
const NEEDS_MONTHLY = ['monthStatus', 'sign'];
const OPEN = new Set(['proposed', 'changes-requested', 'approved']);

class Refusal extends Error {
  constructor(code, message) {
    super(message);
    this.code = ERRORS.has(code) ? code : 'internal';
  }
}
const refuse = (code, message) => new Refusal(code, message);

// ---- the brain ---------------------------------------------------------------------------------

function defaultRoot() {
  return process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
}

// The brain's ads-manager libraries, or null when they're missing or too old.
function brainLibs(root) {
  const dir = path.join(root, '.claude', 'skills', 'ads-manager', 'scripts');
  let P;
  let M;
  try {
    P = require(path.join(dir, 'lib', 'proposals.cjs'));
    M = require(path.join(dir, 'monthly.cjs'));
  } catch {
    return null;
  }
  if (!NEEDS_P.every((k) => typeof P[k] === 'function')) return null;
  if (!NEEDS_MONTHLY.every((k) => typeof M[k] === 'function')) return null;
  const apply = path.join(dir, 'apply.cjs');
  const draft = path.join(dir, 'client-draft.cjs');
  if (!fs.existsSync(apply) || !fs.existsSync(draft)) return null;
  return { P, M, apply, dir };
}

function needLibs(ctx) {
  const L = brainLibs(ctx.root);
  if (!L) throw refuse('unavailable', 'the ads-manager skill (or a function this needs) is missing');
  return L;
}

// The ported Workbench modules read BRAIN_ROOT when first required, so it is set to this brain first.
function ported(ctx, name) {
  process.env.BRAIN_ROOT = ctx.root;
  return require(path.join(__dirname, 'lib', name));
}

let tasksCache = null;
function cadenceTasks() {
  if (!tasksCache) tasksCache = JSON.parse(fs.readFileSync(path.join(__dirname, 'cadence-tasks.json'), 'utf8'));
  return tasksCache;
}

// The person at this Mac, on the roster, or null. Never from stdin.
function whoAmI(L, ctx) {
  let g = null;
  try {
    g = L.P.gitUser(ctx.root);
  } catch {
    return null;
  }
  if (!g || !g.slug) return null;
  const m = L.P.findMember(g.slug);
  if (!m || !m.slug) return null;
  return { slug: String(m.slug), name: String(m.name || m.slug), role: String(m.role || '') };
}

function requireMe(L, ctx) {
  const me = whoAmI(L, ctx);
  if (!me) throw refuse('not-allowed', "this Mac's git user is not on the roster in .team-config/roles.json");
  return me;
}

// The library's rule (proposals.cjs mayDecide, which it doesn't export; monthly.cjs signer is the same).
function mayDecide(L, me, fm) {
  if (typeof L.P.mayDecide === 'function') return Boolean(L.P.mayDecide(me, fm));
  return me.slug === fm.reviewer || me.slug === fm.owner || me.role === 'owner';
}

// The Workbench's `mine` for a client: an owner, or the client's reviewer or owner in management.json.
function mineFor(me, management) {
  const people = (management && management.people) || {};
  return Boolean(me && (me.role === 'owner' || me.slug === people.reviewer || me.slug === people.owner));
}

// The Workbench's hasAdsAccess(): a gads-proxy url and secret, or google-ads.yaml.
function hasAdsAccess(ctx) {
  try {
    const gads = require(path.join(ctx.root, '.claude', 'skills', 'gads-proxy', 'scripts', 'lib', 'gads-access.cjs'));
    const proxy = gads.loadProxyConfig();
    return Boolean((proxy.url && proxy.secret) || gads.loadYamlCreds());
  } catch {
    return false;
  }
}

// ---- input -------------------------------------------------------------------------------------

const isStr = (v) => typeof v === 'string';
function text(input, key, max, { required = false } = {}) {
  const v = input[key];
  if (v === undefined || v === null) {
    if (required) throw refuse('bad-request', `${key} is required`);
    return '';
  }
  if (!isStr(v) || v.length > max) throw refuse('bad-request', `${key} must be text of at most ${max} characters`);
  if (required && !v.trim()) throw refuse('bad-request', `${key} is required`);
  return v;
}
function clientSlug(input) {
  const v = input.client;
  if (!isStr(v) || v.length > SLUG_MAX || !ADS_CLIENT_SLUG.test(v)) throw refuse('bad-request', 'bad client');
  return v;
}
function proposalId(input) {
  const v = input.id;
  if (!isStr(v) || v.length > 120 || !ADS_PROPOSAL_ID.test(v)) throw refuse('bad-request', 'bad proposal id');
  return v;
}
function accountKey(input) {
  const v = input.account;
  if (!isStr(v) || !ADS_ACCOUNT_KEY.test(v)) throw refuse('bad-request', 'bad account');
  return v;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// A supervised client's folder (the Workbench's clientDirFor) and its management.json.
function supervised(L, ctx, slug) {
  const clientDir = path.join(ctx.root, 'clients', slug);
  if (!fs.existsSync(path.join(clientDir, 'config', 'management.json'))) throw refuse('not-found', 'unknown client');
  return { clientDir, management: L.P.loadManagement(clientDir) || {} };
}
function accountDir(ctx, key) {
  const dir = path.join(ctx.root, 'clients', key);
  if (!isDir(dir)) throw refuse('not-found', 'unknown account');
  return dir;
}

function readProposal(L, clientDir, id) {
  if (!fs.existsSync(L.P.proposalFile(clientDir, id))) throw refuse('not-found', 'no such proposal');
  try {
    return L.P.read({ clientDir, id });
  } catch (err) {
    throw refuse('internal', err && err.message ? String(err.message) : 'unreadable proposal');
  }
}

// ---- replies -----------------------------------------------------------------------------------

// What a person may press, as the Workbench's panel decides it (cc.js apprRows), for someone who may decide.
function flagsFor(L, me, mine, fm) {
  const may = Boolean(me) && mine && mayDecide(L, me, fm);
  const st = fm.status;
  const change = fm.type === 'change' && Boolean(fm.operations);
  const clientPending = st === 'approved' && Boolean(fm.needs_client_approval) && !fm.client_approved_at;
  return {
    canDecide: may && (st === 'proposed' || st === 'changes-requested'),
    canDryRun: may && change && (st === 'proposed' || st === 'changes-requested' || (st === 'approved' && !clientPending)),
    canApply: may && change && st === 'approved' && !clientPending && !fm.applied_at,
    canClientDraft: may && clientPending && !fm.client_request_at,
    canRecordClientApproval: may && clientPending,
    canRecordDecision: may && st === 'approved' && !clientPending && fm.type === 'decision',
  };
}

const relFile = (slug, id) => `clients/${slug}/proposals/${id}.md`;

function summary(L, me, mine, slug, p, warnings) {
  return { id: p.id, file: relFile(slug, p.id), fm: p.fm, warnings: warnings || [], flags: flagsFor(L, me, mine, p.fm) };
}

function fullProposal(L, me, ctx, slug, id) {
  const { clientDir, management } = supervised(L, ctx, slug);
  const p = readProposal(L, clientDir, id);
  let warnings = [];
  try {
    warnings = L.P.validate({ clientDir, fm: p.fm, body: p.body }).warnings || [];
  } catch {
    warnings = [];
  }
  return { ...summary(L, me, mineFor(me, management), slug, p, warnings), body: String(p.body || '') };
}

// Output shown in the app: the Workbench drops `proxy:` lines. Also hide the gateway secret, which a failed curl
// fallback in gads-access.cjs can print as part of its command line (security review, finding 3).
const tail = (out, secrets = []) => {
  let t = String(out || '').replace(/^proxy:.*\n/gm, '').replace(/(x-proxy-secret:\s*)\S+/gi, '$1[hidden]');
  for (const v of secrets) if (typeof v === 'string' && v.length >= 4) t = t.split(v).join('[hidden]');
  return t.slice(-ADS_OUTPUT_TAIL);
};
function proxySecrets(root) {
  try {
    const gads = require(path.join(root, '.claude', 'skills', 'gads-proxy', 'scripts', 'lib', 'gads-access.cjs'));
    const proxy = gads.loadProxyConfig();
    return proxy && proxy.secret ? [String(proxy.secret)] : [];
  } catch {
    return [];
  }
}
// Free text written into proposal frontmatter: one line, no control characters, so it can't end the header.
const flat = (s) => String(s).replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
const fill = (s, vars) => Object.keys(vars).reduce((t, k) => t.split(`{{${k}}}`).join(vars[k]), s);

// ---- reads -------------------------------------------------------------------------------------

function capabilities(_input, ctx) {
  const L = brainLibs(ctx.root);
  return {
    version: SCRIPT_VERSION,
    features: [ADS_CAPABILITY, ADS_TASK_RUNS_CAPABILITY],
    adsAccess: hasAdsAccess(ctx),
    adsManager: Boolean(L),
    me: L ? whoAmI(L, ctx) : null,
  };
}

function approvalsData(L, ctx, me) {
  return ported(ctx, 'approvals-board.cjs').board(me);
}

function approvals(input, ctx) {
  const only = input.client === undefined ? null : clientSlug(input);
  const L = needLibs(ctx);
  const me = whoAmI(L, ctx);
  const data = approvalsData(L, ctx, me);
  const clients = data.clients
    .filter((c) => !only || c.slug === only)
    .map((c) => {
      const mo = c.monthly;
      return {
        slug: c.slug,
        name: c.name,
        reviewer: c.reviewer || null,
        owner: c.owner || null,
        mine: c.mine,
        open: c.open.map((r) => summary(L, me, c.mine, c.slug, r, r.warnings)),
        recent: c.recent.map((r) => summary(L, me, c.mine, c.slug, r, [])),
        pack: c.pack || null,
        monthly: mo
          ? { ...mo, canSign: Boolean(c.mine && !mo.signed && !mo.partial && mo.files && mo.files.body) }
          : null,
      };
    });
  return { me: data.me, generatedAt: data.generatedAt, waiting: data.waiting, toApply: data.toApply, clients };
}

function proposal(input, ctx) {
  const slug = clientSlug(input);
  const id = proposalId(input);
  const L = needLibs(ctx);
  return { proposal: fullProposal(L, whoAmI(L, ctx), ctx, slug, id) };
}

function accountsConfig(ctx) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ctx.root, '.claude', 'accounts.json'), 'utf8')) || {};
  } catch {
    return {};
  }
}

function accounts(_input, ctx) {
  const L = needLibs(ctx);
  const me = whoAmI(L, ctx);
  const data = approvalsData(L, ctx, me);
  const bySlug = new Map(data.clients.map((c) => [c.slug, c]));
  const out = [];
  const seen = new Set();
  for (const a of ported(ctx, 'ads-board-data.cjs').listAccounts()) {
    const c = bySlug.get(a.key);
    seen.add(a.key);
    out.push({
      key: a.key,
      name: a.name,
      currency: a.currency,
      waiting: c && c.mine ? c.open.length : 0,
      supervised: Boolean(c),
    });
  }
  const cfg = accountsConfig(ctx);
  for (const c of data.clients) {
    if (seen.has(c.slug) || !ADS_ACCOUNT_KEY.test(c.slug)) continue;
    const entry = cfg[c.slug] || cfg[c.slug.replace(/-/g, '_')] || null;
    out.push({
      key: c.slug,
      name: c.name,
      currency: (entry && entry.currency) || 'USD',
      waiting: c.mine ? c.open.length : 0,
      supervised: true,
    });
  }
  return { accounts: out.filter((a) => ADS_ACCOUNT_KEY.test(a.key)) };
}

// ---- run log -----------------------------------------------------------------------------------
// tdsapp-ads/runs/<account>/<member-slug>.<machine-id>.jsonl: one line per task run, written by task-run only.
// A convenience record for "last run by Pete", not an audit trail: anyone who can write the brain can edit it.

const errCode = (err) => (err && typeof err === 'object' ? err.code : undefined);

function lstatOrNull(abs) {
  try {
    return fs.lstatSync(abs);
  } catch (err) {
    if (errCode(err) === 'ENOENT' || errCode(err) === 'ENOTDIR') return null;
    throw err;
  }
}

// Makes each missing folder of `segs` under `base`, one at a time; a link or a file along the way is refused.
function plainFolder(base, segs, code) {
  let cur = base;
  for (const seg of segs) {
    cur = path.join(cur, seg);
    let st = lstatOrNull(cur);
    if (!st) {
      try {
        fs.mkdirSync(cur);
      } catch (err) {
        if (errCode(err) !== 'EEXIST') throw err;
      }
      st = fs.lstatSync(cur);
    }
    if (st.isSymbolicLink() || !st.isDirectory()) throw refuse(code, `${seg} isn't a plain folder`);
  }
  return cur;
}

// This Mac's id: 6 hex characters in ~/.config/tdsapp/machine-id (same file and format as tdsapp-files).
function machineId(ctx) {
  const dir = path.join(ctx.home, '.config', 'tdsapp');
  const file = path.join(dir, 'machine-id');
  const read = () => {
    try {
      const id = fs.readFileSync(file, 'utf8').trim();
      return /^[0-9a-f]{6}$/.test(id) ? id : null;
    } catch {
      return null;
    }
  };
  const found = read();
  if (found) return found;
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomBytes(3).toString('hex');
  try {
    fs.writeFileSync(file, id + '\n', { flag: 'wx' });
    return id;
  } catch (err) {
    if (errCode(err) !== 'EEXIST') throw err;
  }
  const again = read();
  if (again) return again;
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, id + '\n');
  fs.renameSync(temp, file);
  return id;
}

const RUNS_README = `# Ad Manager run log

The TDS Brain app's record of when each Ad Manager task was last run, so everyone sees the same "last run" times.

- It is not a source: nothing here is evidence, and nothing should be edited by hand.
- One file per person, per Mac, per account: runs/<account>/<person>.<mac>.jsonl.
- Anyone who can write this brain could edit it; it is a convenience record, not an audit trail.
`;

function validTask(task) {
  if (!isStr(task)) return false;
  return task === 'standup:daily' || cadenceTasks().cards.some((c) => c.id === task);
}

function writeOnce(file, content) {
  if (lstatOrNull(file)) return;
  try {
    fs.writeFileSync(file, content, { flag: 'wx' });
  } catch (err) {
    if (errCode(err) !== 'EEXIST') throw err;
  }
}

// Keeps only the newest valid line per task, when the file has grown past the limit.
function compactRunLog(file) {
  const st = lstatOrNull(file);
  if (!st || !st.isFile() || st.size <= RUN_COMPACT_BYTES) return;
  const newest = new Map();
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    let line;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!line || typeof line !== 'object' || !isStr(line.task) || !isStr(line.ts)) continue;
    const t = Date.parse(line.ts);
    if (Number.isNaN(t)) continue;
    const have = newest.get(line.task);
    if (!have || t >= have.t) newest.set(line.task, { t, raw });
  }
  const keep = [...newest.values()].sort((a, b) => a.t - b.t).map((e) => e.raw);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, keep.join('\n') + '\n', { flag: 'w' });
  fs.renameSync(temp, file);
}

function taskRun(input, ctx) {
  const key = accountKey(input);
  const task = input.task;
  if (!validTask(task)) throw refuse('bad-request', 'bad task');
  const L = needLibs(ctx);
  const me = requireMe(L, ctx);
  if (!RUN_SLUG.test(me.slug)) throw refuse('not-allowed', 'your roster slug cannot be used in a file name');
  accountDir(ctx, key);
  const base = plainFolder(ctx.root, [RUNS_DIR], 'not-allowed');
  const dir = plainFolder(base, ['runs', key], 'not-allowed');
  writeOnce(path.join(base, 'README.md'), RUNS_README);
  writeOnce(path.join(base, '.gitattributes'), 'runs/**/*.jsonl merge=union\n');
  const file = path.join(dir, `${me.slug}.${machineId(ctx)}.jsonl`);
  const st = lstatOrNull(file);
  if (st && (st.isSymbolicLink() || !st.isFile())) throw refuse('not-allowed', 'the run log is not a plain file');
  const at = new Date().toISOString();
  const line = { v: 1, ts: at, account: key, task, by: me.slug, by_name: me.name };
  let fd;
  try {
    const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0);
    fd = fs.openSync(file, flags, 0o644);
    fs.writeSync(fd, JSON.stringify(line) + '\n');
  } catch (err) {
    throw refuse(errCode(err) === 'ELOOP' ? 'not-allowed' : 'internal', 'could not write the run log');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  try {
    compactRunLog(file);
  } catch {
    // The line is written; compaction can wait for the next run.
  }
  return { ok: true, run: { at, by: me.slug, byName: flat(me.name).slice(0, RUN_NAME_MAX) || me.slug } };
}

// The newest run per task for one account, from every log file there. Never writes anything.
function readRuns(ctx, key) {
  const out = new Map();
  let dir = ctx.root;
  for (const seg of [RUNS_DIR, 'runs', key]) {
    dir = path.join(dir, seg);
    let st;
    try {
      st = lstatOrNull(dir);
    } catch {
      return out;
    }
    if (!st || st.isSymbolicLink() || !st.isDirectory()) return out;
  }
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort().slice(0, RUN_READ_FILES);
  } catch {
    return out;
  }
  const limit = Date.now() + RUN_FUTURE_MS;
  for (const name of names) {
    const slug = name.split('.')[0];
    const file = path.join(dir, name);
    let text;
    try {
      const st = lstatOrNull(file);
      if (!st || st.isSymbolicLink() || !st.isFile() || st.size > RUN_READ_BYTES) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split('\n')) {
      if (!raw) continue;
      let l;
      try {
        l = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!l || typeof l !== 'object' || l.v !== 1 || l.account !== key || !isStr(l.task) || !isStr(l.ts)) continue;
      if (l.by !== slug) continue;
      const t = Date.parse(l.ts);
      if (Number.isNaN(t) || t > limit) continue;
      const have = out.get(l.task);
      if (have && have.t >= t) continue;
      const byName = isStr(l.by_name) ? flat(l.by_name).slice(0, RUN_NAME_MAX) : '';
      out.set(l.task, { t, run: { at: new Date(t).toISOString(), by: slug, byName: byName || slug } });
    }
  }
  return out;
}

function board(input, ctx) {
  const key = accountKey(input);
  accountDir(ctx, key);
  const data = ported(ctx, 'ads-board-data.cjs').buildBoardData(key);
  const tasks = cadenceTasks();
  const vars = { account: data.name, key };
  const badges = data.badges || {};
  const runs = readRuns(ctx, key);
  const lastRun = (id) => (runs.has(id) ? runs.get(id).run : null);
  return {
    board: {
      key,
      name: data.name,
      currency: data.currency,
      health: data.dataHealth,
      tables: data.topTens,
      wastePct: data.wastePct,
      cards: tasks.cards.map((t) => ({
        id: t.id,
        cadence: t.cadence,
        kind: t.kind,
        title: t.title,
        description: t.description,
        badge: badges[t.id] || null,
        prompt: fill(t.prompt, vars),
        lastRun: lastRun(t.id),
      })),
      standup: {
        hasStandup: Boolean(data.hasStandup),
        verdict: data.standup || null,
        enabledCampaigns: data.enabledCampaigns || [],
        prompt: fill(tasks.standupPrompt, vars),
        actionLabels: tasks.actionLabels,
        lastRun: lastRun('standup:daily'),
      },
      triage: { key, name: data.name, hasStandup: Boolean(data.hasStandup), verdict: data.standup || null },
      setupPrompts: { ...tasks.setupPrompts, contractPath: tasks.contractPath },
    },
  };
}

function standupBrief(input, ctx) {
  const key = accountKey(input);
  const recs = ported(ctx, 'standup-board.cjs').standupRecommendations(key);
  return {
    brief: recs
      ? { ymd: recs.ymd, date: recs.date, headline: recs.headline, recommendations: recs.recommendations }
      : { ymd: null, date: null, headline: null, recommendations: [] },
  };
}

// ---- changes -----------------------------------------------------------------------------------

// The checks every proposal change shares: a roster person, a supervised client, the proposal, and the
// decide rule (reviewer, owner, or the owner role). `rule` is the flag that must be true now.
function proposalChange(input, ctx, rule) {
  const slug = clientSlug(input);
  const id = proposalId(input);
  const L = needLibs(ctx);
  const me = requireMe(L, ctx);
  const { clientDir, management } = supervised(L, ctx, slug);
  const p = readProposal(L, clientDir, id);
  if (!mineFor(me, management) || !mayDecide(L, me, p.fm)) {
    throw refuse('not-allowed', `${me.name} is neither the reviewer nor the owner of ${id}, nor an owner`);
  }
  const flags = flagsFor(L, me, true, p.fm);
  if (rule && !flags[rule]) throw refuse('changed', `${id} is ${p.fm.status}; that can't be done now`);
  return { L, me, slug, id, clientDir, management, p, root: ctx.root };
}

// A library refusal as a contract code. The app shows its own words; `error` keeps the library's.
function libraryRefusal(err) {
  const msg = err && err.message ? String(err.message) : 'refused';
  if (/not a member|neither the reviewer|only a human/.test(msg)) return refuse('not-allowed', msg);
  if (/no close for|no report body|ENOENT/.test(msg)) return refuse('not-found', msg);
  if (/ is [a-z-]+;|expired|month-to-date|does not need client approval|already/.test(msg)) return refuse('changed', msg);
  if (/^say |needs a reason|bad /.test(msg)) return refuse('bad-request', msg);
  if (/not valid/.test(msg)) return refuse('changed', msg);
  return refuse('internal', msg);
}
function viaLibrary(fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof Refusal) throw err;
    throw libraryRefusal(err);
  }
}

const after = (c, ctx) => fullProposal(c.L, c.me, ctx, c.slug, c.id);

function draftLine(d) {
  return `${d.draft}${d.gmailDraftId ? ` · Gmail draft ${d.gmailDraftId} (not sent)` : d.gmailError ? ` · Gmail draft failed: ${d.gmailError}` : ''}`;
}

function decide(input, ctx) {
  const action = input.action;
  if (!['approve', 'request-changes', 'reject'].includes(action)) throw refuse('bad-request', 'unknown decision');
  const note = text(input, 'note', ADS_NOTE_MAX);
  if (action !== 'approve' && !note.trim()) {
    throw refuse('bad-request', action === 'reject' ? 'say why' : 'say what to change');
  }
  const c = proposalChange(input, ctx, 'canDecide');
  const r = viaLibrary(() =>
    ported(ctx, 'approvals-board.cjs').decide({ client: c.slug, id: c.id, action, by: c.me.slug, text: note }),
  );
  const reply = { proposal: after(c, ctx) };
  if (action === 'request-changes') {
    reply.message = 'Changes requested. A chat is revising the proposal; it comes back here as proposed when done.';
    reply.revisePrompt = fill(cadenceTasks().revisePrompt, {
      id: c.id,
      client: c.slug,
      name: c.me.name,
      note: String(input.note || '').replace(/"/g, "'"),
    });
  } else if (action === 'reject') {
    reply.message = 'Rejected.';
  } else {
    const d = r && r.clientDraft;
    if (!d) reply.message = 'Approved.';
    else if (d.ok) {
      reply.message = `Approved. Client request drafted: ${draftLine(d)}${d.to && d.to.length ? ` · to ${d.to.join(', ')}` : ' · no address on file, fill in To before sending'}`;
    } else {
      reply.message = `Approved, but the client request draft failed: ${d.error}`;
      reply.failed = true;
    }
  }
  return reply;
}

// apply.cjs to the end: no time limit (the app runs this script detached and never kills it).
function runApply(c, confirmed) {
  const args = [c.L.apply, `--client=${c.slug}`, `--id=${c.id}`];
  if (confirmed) args.push('--confirmed');
  const r = spawnSync(process.execPath, args, {
    cwd: c.root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: r.status, signal: r.signal, output: tail(`${r.stdout || ''}${r.stderr || ''}`, proxySecrets(c.root)) };
}

function dryRun(input, ctx) {
  const c = proposalChange(input, ctx, 'canDryRun');
  const r = runApply(c, false);
  const ok = r.code === 0;
  return {
    proposal: after(c, ctx),
    output: r.output,
    message: ok
      ? 'Dry run finished. Nothing was changed in Google Ads.'
      : "The dry run didn't pass. Nothing was changed in Google Ads. See the output.",
    ...(ok ? {} : { failed: true }),
  };
}

function apply(input, ctx) {
  if (input.confirmed !== true) throw refuse('bad-request', 'apply needs "confirmed": true');
  const c = proposalChange(input, ctx, 'canApply');
  const r = runApply(c, true);
  // apply.cjs exit codes: 0 done · 2 refused · 3 written but the read-back disagreed · 4 the executor failed
  // (nothing changed). Anything else (1 covers both "couldn't start" and a crash after the write) is unknown.
  const words = {
    0: 'Applied to Google Ads.',
    2: 'Apply was refused, so nothing was changed in Google Ads. See the output.',
    3: 'The change was written to Google Ads but the read-back disagreed. Stop and check the account before doing anything else.',
    4: 'The change failed, and nothing was changed in Google Ads. See the output.',
  };
  if (!(r.code in words)) {
    const err = refuse('unknown-outcome', `apply.cjs ended with ${r.signal || `exit ${r.code}`}`);
    err.output = r.output;
    throw err;
  }
  const proposal = after(c, ctx);
  // Exit 3 means something was written. apply.cjs stamps RSA and PMax runs as failed (no re-apply), but stops
  // before stamping a gads-write run, which then still passes checkApproved. Reported as unknown, so the app
  // keeps Apply locked until someone has checked the account: a second press must never write twice.
  const stillApplicable = proposal.fm.status === 'approved' && !proposal.fm.applied_at;
  // Exit 4 is "nothing changed" only if the live write never started: apply.cjs also maps a live gads-write that
  // crashed after writing (before its stamp) to 4. Fails closed: unless the output says the dry run failed (so the
  // live step never ran), a 4 on a proposal that could be applied again is an unknown outcome.
  if (r.code === 4 && stillApplicable && !/dry run failed/i.test(r.output)) {
    const err = refuse('unknown-outcome', 'the live write failed part-way, and the proposal could be applied again');
    err.output = r.output;
    throw err;
  }
  if (r.code === 3 && stillApplicable) {
    const err = refuse('unknown-outcome', 'written but the read-back disagreed, and the proposal could be applied again');
    err.output = r.output;
    throw err;
  }
  return {
    proposal,
    output: r.output,
    message: words[r.code],
    ...(r.code === 0 ? {} : { failed: true }),
  };
}

function clientDraft(input, ctx) {
  if (input.again !== undefined && typeof input.again !== 'boolean') throw refuse('bad-request', 'again must be true or false');
  const c = proposalChange(input, ctx, input.again ? 'canRecordClientApproval' : 'canClientDraft');
  const d = ported(ctx, 'approvals-board.cjs').clientDraft({ client: c.slug, id: c.id, again: input.again === true });
  return {
    proposal: after(c, ctx),
    message: d.ok ? `Client request drafted: ${draftLine(d)}` : `The client request draft failed: ${d.error}`,
    ...(d.ok ? {} : { failed: true }),
  };
}

function clientApproved(input, ctx) {
  const who = flat(text(input, 'who', WHO_MAX, { required: true }));
  const note = flat(text(input, 'note', ADS_NOTE_MAX));
  if (!who) throw refuse('bad-request', 'who is required');
  const c = proposalChange(input, ctx, 'canRecordClientApproval');
  const r = viaLibrary(() =>
    ported(ctx, 'approvals-board.cjs').recordClientApproval({ client: c.slug, id: c.id, by: c.me.slug, who, note }),
  );
  return { proposal: after(c, ctx), message: `Client approval recorded: ${r.client_approved_by}.` };
}

function decided(input, ctx) {
  const note = text(input, 'note', ADS_NOTE_MAX);
  const c = proposalChange(input, ctx, 'canRecordDecision');
  if (!note.trim()) throw refuse('bad-request', 'say what was decided');
  viaLibrary(() => ported(ctx, 'approvals-board.cjs').recordDecision({ client: c.slug, id: c.id, by: c.me.slug, text: note }));
  return { proposal: after(c, ctx), message: 'Decision recorded.' };
}

function signMonthly(input, ctx) {
  const slug = clientSlug(input);
  const month = input.month;
  if (!isStr(month) || !ADS_MONTH.test(month)) throw refuse('bad-request', 'bad month');
  const note = text(input, 'note', ADS_NOTE_MAX);
  const L = needLibs(ctx);
  const me = requireMe(L, ctx);
  supervised(L, ctx, slug);
  // monthly.cjs sign checks who may sign (reviewer, owner, or an owner) and refuses a month-to-date draft.
  const r = viaLibrary(() => ported(ctx, 'approvals-board.cjs').signMonthly({ client: slug, id: month, by: me.slug, note }));
  return { message: r.output, output: r.output };
}

function standupSetup(input, ctx) {
  const key = accountKey(input);
  const L = needLibs(ctx);
  requireMe(L, ctx);
  accountDir(ctx, key);
  const SB = ported(ctx, 'standup-board.cjs');
  if (SB.hasStandupConfig(key)) {
    return { created: false, hasStandup: true, message: 'This account already has a standup set up; nothing was changed.' };
  }
  const result = SB.scaffoldStandupConfig(key);
  return {
    created: Boolean(result.created),
    hasStandup: true,
    campaigns: result.campaigns || [],
    message: `Standup set up with ${(result.campaigns || []).length} campaigns, all weekly. Edit clients/${key}/standup/config.json to choose daily ones.`,
  };
}

function standupFeedback(input, ctx) {
  const key = accountKey(input);
  const date = input.date;
  if (!isStr(date) || !(/^\d{8}$/.test(date) || /^\d{4}-\d{2}-\d{2}$/.test(date))) throw refuse('bad-request', 'bad date');
  const campaign = text(input, 'campaign', CAMPAIGN_MAX, { required: true });
  const category = text(input, 'action_category', CATEGORY_MAX, { required: true });
  const score = input.score;
  if (!Number.isInteger(score) || score < 1 || score > 5) throw refuse('bad-request', 'score must be 1 to 5');
  const note = text(input, 'note', ADS_NOTE_MAX);
  const L = needLibs(ctx);
  requireMe(L, ctx);
  accountDir(ctx, key);
  let out;
  try {
    out = ported(ctx, 'standup-board.cjs').writeStandupFeedback(key, {
      date,
      campaign,
      action_category: category,
      rating: score,
      note,
    });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'refused';
    throw refuse(/no standup run/.test(msg) ? 'not-found' : 'bad-request', msg);
  }
  return { file: out.file, message: 'Rating saved.' };
}

// ---- command line ------------------------------------------------------------------------------

const ACTIONS = {
  capabilities,
  accounts,
  approvals,
  proposal,
  board,
  'standup-brief': standupBrief,
  decide,
  'dry-run': dryRun,
  apply,
  'client-draft': clientDraft,
  'client-approved': clientApproved,
  decided,
  'sign-monthly': signMonthly,
  'standup-setup': standupSetup,
  'standup-feedback': standupFeedback,
  'task-run': taskRun,
};

// Runs one action. Returns the exit code and the reply; never throws.
function run(action, input, ctx) {
  const fail = (code, error, extra) => ({
    exit: code === 'internal' ? 1 : 2,
    reply: { ok: false, code, error, ...(extra || {}) },
  });
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
    return fail('bad-request', 'unknown action');
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return fail('bad-request', 'stdin must be one JSON object');
  }
  const context = Object.assign({ root: defaultRoot(), home: os.homedir() }, ctx);
  try {
    return { exit: 0, reply: { ok: true, action, ...ACTIONS[action](input, context) } };
  } catch (err) {
    if (err instanceof Refusal) return fail(err.code, err.message, err.output ? { output: err.output } : null);
    return fail('internal', err && err.message ? String(err.message) : 'internal error');
  }
}

function main() {
  const chunks = [];
  let size = 0;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    let result;
    if (size > INPUT_MAX) {
      result = { exit: 2, reply: { ok: false, code: 'bad-request', error: 'stdin is too long' } };
    } else {
      const raw = Buffer.concat(chunks).toString('utf8');
      let input;
      try {
        input = raw.trim() === '' ? {} : JSON.parse(raw);
      } catch {
        input = undefined;
      }
      result =
        input === undefined
          ? { exit: 2, reply: { ok: false, code: 'bad-request', error: 'invalid JSON' } }
          : run(process.argv[2] || '', input, {});
    }
    process.stdout.write(JSON.stringify(result.reply) + '\n');
    process.exitCode = result.exit;
  };
  process.stdin.on('data', (c) => {
    size += c.length;
    if (size <= INPUT_MAX) chunks.push(c);
  });
  process.stdin.on('end', start);
  process.stdin.on('error', start);
}

if (require.main === module) main();

module.exports = {
  SCRIPT_VERSION,
  ADS_CAPABILITY,
  ADS_TASK_RUNS_CAPABILITY,
  ADS_ACCOUNT_KEY,
  ADS_PROPOSAL_ID,
  ADS_CLIENT_SLUG,
  ADS_MONTH,
  ADS_NOTE_MAX,
  ADS_RECENT_DAYS,
  ADS_OUTPUT_TAIL,
  run,
};
