// tdsapp-usage: takes one `app` event from the TDS Brain app on stdin and files it in the brain's logs.
//
//   usage         one AppUsageEvent as JSON on stdin; exit 0 filed, exit 2 refused
//   capabilities  prints { version, features, capabilities } as JSON
//
// The app is DISTRUSTED: only known keys and nested keys survive, every value is type-checked, names
// are cleaned by the tracker's cleanSkill rule, arrays are capped and a line is never over 4 KB.
// Nothing typed is ever added. No role check: any copy of the app may report its own chats.
//
//   z-logs/app-usage/<name>.jsonl   plain line. z-logs is git-ignored, so it stays on this computer.
//   z-logs/team-usage/<name>.jsonl  a locked line ({"v":1,...}), ONLY when Observe is on AND
//                                   SYNC_APP_EVENTS below is true. It ships false, until Pete confirms
//                                   the Command Centre skips events it doesn't know.
//
// The locking and the cleaning rules are copied from .claude/hooks/log-team-usage.cjs. Plain Node,
// no dependencies. Tests flip SYNC_APP_EVENTS in a temporary copy; nothing in the environment can.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SYNC_APP_EVENTS = false;

const BRAIN_ROOT = process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
const SCRIPT_VERSION = '0.1';
// Mirrors shared/kits-contract.ts (a test checks they match).
const APP_USAGE_CAPABILITY = 'app-event-v1';
const KIT_IDS = ['core', 'ads', 'web', 'full'];
const PICK_HOWS = ['auto', 'rule', 'fallback'];
const TIERS = ['quick', 'standard', 'deep'];
const KINDS = ['tds', 'personal'];
const GROUPS = ['system', 'skills', 'connectors', 'agents', 'memory', 'hooks', 'other'];
const USE_MAX = 40;
const LINE_MAX = 4096;

class Refusal extends Error {}

function syncOn() {
  // No environment override: only this constant turns sharing on.
  return SYNC_APP_EVENTS === true;
}

// ---- cleaning (same rule as the tracker hook) ---------------------------------

function cleanSkill(name) {
  const last = String(name || '').split(/[/:\\]/).pop();
  return last.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// A `plugin:skill` name keeps its prefix: each side is cleaned by cleanSkill on its own.
function cleanName(v) {
  const i = v.indexOf(':');
  if (i < 0) return cleanSkill(v);
  const plugin = cleanSkill(v.slice(0, i));
  const skill = cleanSkill(v.slice(i + 1));
  return plugin && skill ? plugin + ':' + skill : skill || plugin;
}

function names(value, keepPrefix) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const c = keepPrefix ? cleanName(v) : cleanSkill(v);
    if (c && !out.includes(c)) out.push(c);
    if (out.length >= USE_MAX) break;
  }
  return out;
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function count(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12 ? Math.round(v) : null;
}
function need(v, what) {
  if (v === null) throw new Refusal('bad ' + what);
  return v;
}
function oneOf(v, list, what) {
  if (typeof v !== 'string' || !list.includes(v)) throw new Refusal('bad ' + what);
  return v;
}

// The whitelist. Anything not named here is dropped.
function clean(body) {
  if (body.event !== 'app') throw new Refusal('not an app event');
  if (body.v !== 1) throw new Refusal('bad v');
  if (typeof body.chat !== 'string' || !/^[0-9a-f]{16}$/.test(body.chat)) throw new Refusal('bad chat');
  if (typeof body.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.day)) throw new Refusal('bad day');
  const out = {
    v: 1,
    event: 'app',
    chat: body.chat,
    mode: 'shadow',
    app: typeof body.app === 'string' ? body.app.replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 24) : '',
    day: body.day,
    kind: oneOf(body.kind, KINDS, 'kind'),
    seq: need(count(body.seq), 'seq'),
    turns: need(count(body.turns), 'turns'),
    compacted: need(count(body.compacted), 'compacted'),
    cacheRead: need(count(body.cacheRead), 'cacheRead'),
  };
  const w = body.work;
  if (isObj(w) && out.kind === 'tds') {
    const work = {
      kit: oneOf(w.kit, KIT_IDS, 'kit'),
      how: oneOf(w.how, PICK_HOWS, 'how'),
      fits: [],
      tier: TIERS.includes(w.tier) ? w.tier : null,
      startup: null,
      wouldSave: null,
      used: { skills: [], connectors: [] },
      peakPercent: null,
      summaries: count(w.summaries) || 0,
    };
    if (Array.isArray(w.fits)) {
      for (const f of KIT_IDS) if (w.fits.includes(f)) work.fits.push(f);
    }
    if (isObj(w.startup)) {
      const total = count(w.startup.total);
      if (total !== null && isObj(w.startup.byGroup)) {
        const byGroup = {};
        for (const g of GROUPS) byGroup[g] = count(w.startup.byGroup[g]) || 0;
        work.startup = { total, byGroup };
      }
    }
    if (isObj(w.wouldSave)) {
      const sure = count(w.wouldSave.sure);
      const approx = count(w.wouldSave.approx);
      if (sure !== null && approx !== null) work.wouldSave = { sure, approx };
    }
    if (isObj(w.used)) work.used = { skills: names(w.used.skills, true), connectors: names(w.used.connectors) };
    if (typeof w.peakPercent === 'number' && Number.isFinite(w.peakPercent) && w.peakPercent >= 0 && w.peakPercent <= 1000) {
      work.peakPercent = Math.round(w.peakPercent * 10) / 10;
    }
    out.work = work;
  }
  return out;
}

// Keep a line under the cap by dropping the bulkiest parts first.
function fit(rec) {
  const tries = [
    () => {},
    () => { if (rec.work) rec.work.startup = null; },
    () => { if (rec.work) rec.work.used = { skills: [], connectors: [] }; },
    () => { delete rec.work; },
  ];
  for (const t of tries) {
    t();
    const line = JSON.stringify(rec);
    if (Buffer.byteLength(line) <= LINE_MAX) return rec;
  }
  throw new Refusal('too big');
}

// ---- who and where ------------------------------------------------------------

function git(key) {
  try {
    const out = spawnSync('git', ['config', key], { cwd: BRAIN_ROOT, encoding: 'utf8', timeout: 3000 });
    return ((out && out.stdout) || '').trim();
  } catch {
    return '';
  }
}

// ---- the lock (same as the tracker hook's seal()) -----------------------------

function seal(toPub, text) {
  const pubKey = (x) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x }, format: 'jwk' });
  const eph = crypto.generateKeyPairSync('x25519');
  const e = eph.publicKey.export({ format: 'jwk' }).x;
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: pubKey(toPub) });
  const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from(e + '.' + toPub), 'observe-v1', 32));
  const n = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, n);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final(), c.getAuthTag()]);
  return { e, n: n.toString('base64url'), c: ct.toString('base64url') };
}

function observeKey() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(BRAIN_ROOT, '.team-config', 'observe.json'), 'utf8'));
    if (c && c.on === true && c.publicKey && c.keyId) return { pub: c.publicKey, id: c.keyId };
  } catch {
    // off, or no file
  }
  return null;
}

// Keep the own file to about five weeks, as the tracker does.
function trimOwn(file) {
  try {
    if (fs.statSync(file).size < 256 * 1024) return;
    const cut = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);
    const keep = fs.readFileSync(file, 'utf8').split('\n')
      .filter((l) => { try { return JSON.parse(l).day >= cut; } catch { return false; } });
    fs.writeFileSync(file, keep.map((l) => l + '\n').join(''));
  } catch {
    // best effort
  }
}

// ---- commands -----------------------------------------------------------------

function usage(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Refusal('invalid JSON');
  }
  if (!isObj(body)) throw new Refusal('invalid JSON');
  const rec = fit(clean(body));

  const userName = git('user.name');
  if (!userName || userName === 'unknown') throw new Refusal('no git user name');
  const who = git('user.email').toLowerCase();
  const safeName = userName.toLowerCase().replace(/ /g, '-').replace(/[^\p{L}\p{N}-]/gu, '');
  if (!safeName) throw new Refusal('no git user name');

  const ownDir = path.join(BRAIN_ROOT, 'z-logs', 'app-usage');
  const ownFile = path.join(ownDir, safeName + '.jsonl');
  fs.mkdirSync(ownDir, { recursive: true });
  fs.appendFileSync(ownFile, JSON.stringify(rec) + '\n');
  trimOwn(ownFile);

  let synced = false;
  const key = observeKey();
  if (syncOn() && key && who) {
    const syncedDir = path.join(BRAIN_ROOT, 'z-logs', 'team-usage');
    const out = { who, date: rec.day, event: 'app' };
    for (const k of Object.keys(rec)) if (k !== 'event') out[k] = rec[k];
    const line = JSON.stringify({ v: 1, k: key.id, ...seal(key.pub, JSON.stringify(out)) });
    fs.mkdirSync(syncedDir, { recursive: true });
    fs.appendFileSync(path.join(syncedDir, safeName + '.jsonl'), line + '\n');
    synced = true;
  }
  return { ok: true, synced };
}

function capabilities() {
  return { version: SCRIPT_VERSION, features: ['usage', 'capabilities'], capabilities: [APP_USAGE_CAPABILITY] };
}

function reply(code, body) {
  process.stdout.write(JSON.stringify(body) + '\n');
  process.exitCode = code;
}

function run(command, raw) {
  try {
    if (command === 'capabilities') return reply(0, capabilities());
    if (command === 'usage') return reply(0, usage(raw));
    return reply(2, { error: 'unknown command' });
  } catch (err) {
    return reply(2, { error: err instanceof Refusal ? err.message : 'failed' });
  }
}

// Read stdin without ever hanging: give up after 1.5 seconds of silence. A terminal counts as empty.
const STDIN_MAX = 64 * 1024;

function readStdin(done) {
  let raw = '';
  let finished = false;
  let tooBig = false;
  let timer = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try { process.stdin.destroy(); } catch { /* already closed */ }
    done(raw, tooBig);
  };
  const arm = () => { clearTimeout(timer); timer = setTimeout(finish, 1500); };
  try {
    if (process.stdin.isTTY) return done('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > STDIN_MAX) { tooBig = true; finish(); return; }
      arm();
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    arm();
  } catch {
    finish();
  }
}

readStdin((raw, tooBig) => {
  if (tooBig) return reply(2, { error: 'input too large' });
  run(process.argv[2] || '', raw);
});
