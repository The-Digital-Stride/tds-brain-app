// tdsapp-kits: show, change and review the TDS Brain app's start-up kits.
//
//   show [--json]                                   the kits as the app sees them
//   set <kit> [--connectors a,b] [--plugins c,d]    change a kit's lists (owner and scouts only)
//   review [--days N] [--json]                      how the shadow picks went (your own record)
//   capabilities                                    { version, features }
//
// Exit 0: worked. Exit 2: refused, with a plain reason.
//
// The kits file, .claude/tdsapp-kits.json, is written whole to a hidden temporary file and swapped in.
// `full` can't be changed. Who is asking is read-only, from `git config user.email` (else user.name)
// looked up in .team-config/roles.json. In shadow mode nothing is switched off.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BRAIN_ROOT = process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
const CLAUDE_DIR = path.join(BRAIN_ROOT, '.claude');
// Mirrors shared/kits-contract.ts (a test checks they match).
const KITS_FILE = path.join(CLAUDE_DIR, 'tdsapp-kits.json');
const SCRIPT_VERSION = '0.1';
const KIT_IDS = ['core', 'ads', 'web', 'full'];
const KEEP_ALL = '*';
const CORE_CONNECTORS = ['gmail', 'googlecalendar', 'googledrive', 'googledocs', 'googlesheets', 'googleslides', 'claudedocs', 'slack', 'monday', 'wisprflow', 'timelens', 'xero', 'tdsportal'];
const CORE_PLUGINS = ['document-skills', 'productivity'];
const BUILT_IN_KITS = {
  core: {
    id: 'core',
    label: 'Everyday',
    blurb: 'everyday agency work: clients, notes, to-dos, email, calendar, documents and meetings',
    connectors: CORE_CONNECTORS,
    plugins: CORE_PLUGINS,
  },
  ads: {
    id: 'ads',
    label: 'Ads and search',
    blurb: 'paid ads, SEO and analytics: ad accounts, keywords, rankings, traffic and performance reports',
    connectors: [...CORE_CONNECTORS, 'semrush', 'scrapingbee', 'ahrefs', 'similarweb', 'supermetrics', 'amplitude', 'klaviyo', 'googleads', 'gads', 'analytics', 'searchconsole', 'tdsmeta'],
    plugins: [...CORE_PLUGINS, 'marketing'],
  },
  web: {
    id: 'web',
    label: 'Websites and code',
    blurb: 'websites, code and design: building or fixing sites, deployments, CMS work and design files',
    connectors: [...CORE_CONNECTORS, 'vercel', 'figma', 'stitch', 'github', 'context7', 'playwright', 'filesystem', 'mermaid', 'paper', 'claudedesign', 'payload', 'tdsmeta'],
    plugins: [...CORE_PLUGINS, 'superpowers', 'vercel', 'frontend-design', 'feature-dev', 'design', 'engineering', 'andrej-karpathy-skills'],
  },
  full: { id: 'full', label: 'Everything', blurb: 'anything else, or when unsure', connectors: [KEEP_ALL], plugins: [KEEP_ALL] },
};
const SETTER_ROLES = ['owner', 'scout'];
const LIST_MAX = 200;
const DEFAULT_DAYS = 30;

class Refusal extends Error {}

// ---- who is asking ------------------------------------------------------------

function git(key) {
  try {
    const out = spawnSync('git', ['config', key], { cwd: BRAIN_ROOT, encoding: 'utf8', timeout: 3000 });
    return ((out && out.stdout) || '').trim();
  } catch {
    return '';
  }
}

function memberSlug(name) {
  return String(name).toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
}

function mapRole(raw) {
  const r = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (r === 'owner') return 'owner';
  if (r === 'scout' || r === 'head-scout' || r === 'agency') return 'scout';
  if (r === 'team') return 'team';
  return 'unknown';
}

function readMembers() {
  try {
    const members = JSON.parse(fs.readFileSync(path.join(BRAIN_ROOT, '.team-config', 'roles.json'), 'utf8')).members;
    return Array.isArray(members) ? members.filter((m) => m && typeof m === 'object') : [];
  } catch {
    return [];
  }
}

function whoIsAsking() {
  const email = git('user.email').toLowerCase();
  const members = readMembers();
  let member = null;
  if (email !== '') {
    member = members.find((m) => typeof m.email === 'string' && m.email.toLowerCase() === email) || null;
  } else {
    const slug = memberSlug(git('user.name'));
    if (slug !== '') member = members.find((m) => typeof m.name === 'string' && memberSlug(m.name) === slug) || null;
  }
  if (!member || typeof member.name !== 'string' || memberSlug(member.name) === '') return { slug: '', role: 'unknown' };
  return { slug: memberSlug(member.name), role: mapRole(member.role) };
}

// ---- the kits ------------------------------------------------------------------

// The file as written, or null when there is none. A file that can't be read or isn't valid is
// refused (by set) rather than overwritten; show and review fall back to the built-ins.
function readFile(strict) {
  let text;
  try {
    text = fs.readFileSync(KITS_FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    if (strict) throw new Refusal('the kits file could not be read');
    return null;
  }
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1) throw new Error('bad');
    return data;
  } catch {
    if (strict) throw new Refusal('the kits file is not valid, so it was left alone');
    return null;
  }
}

function strings(v) {
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? v : null;
}

// Built-ins with the file's connector and plugin lists laid over them. `full` and unknown ids are ignored.
function mergedKits() {
  const data = readFile(false);
  const out = {};
  for (const id of KIT_IDS) out[id] = { ...BUILT_IN_KITS[id] };
  const rows = data && data.kits && typeof data.kits === 'object' && !Array.isArray(data.kits) ? data.kits : {};
  for (const id of KIT_IDS) {
    if (id === 'full') continue;
    const row = rows[id];
    if (!row || typeof row !== 'object') continue;
    const c = strings(row.connectors);
    const p = strings(row.plugins);
    if (c) out[id].connectors = c;
    if (p) out[id].plugins = p;
  }
  return out;
}

const normConnector = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

function listArg(value, kind) {
  if (typeof value !== 'string') throw new Refusal('--' + kind + ' needs a comma-separated list');
  const items = [];
  for (const part of value.split(',')) {
    const item = kind === 'connectors' ? normConnector(part) : part.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!item) continue;
    if (item.length > 60) throw new Refusal('a ' + kind + ' name is too long');
    if (!items.includes(item)) items.push(item);
  }
  if (items.length > LIST_MAX) throw new Refusal('too many ' + kind);
  return items;
}

function render(data) {
  const ids = Object.keys(data.kits).sort();
  const rows = ids.map((id) => '    ' + JSON.stringify(id) + ': ' + JSON.stringify(data.kits[id]));
  const body = rows.length === 0 ? '{}' : '{\n' + rows.join(',\n') + '\n  }';
  let head = '{\n  "version": 1,\n  "kits": ' + body;
  if (data.updatedBy) head += ',\n  "updatedBy": ' + JSON.stringify(data.updatedBy);
  if (data.updatedAt) head += ',\n  "updatedAt": ' + JSON.stringify(data.updatedAt);
  return head + '\n}\n';
}

function writeFile(data) {
  try {
    if (fs.lstatSync(KITS_FILE).isSymbolicLink()) throw new Refusal('the kits file is a link');
  } catch (err) {
    if (err instanceof Refusal) throw err;
  }
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  const tmp = path.join(CLAUDE_DIR, '.tdsapp-kits-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.tmp~');
  try {
    const fd = fs.openSync(tmp, 'wx', 0o644);
    try {
      fs.writeSync(fd, render(data));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, KITS_FILE);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing more to do */ }
    if (err instanceof Refusal) throw err;
    throw new Refusal('the kits file could not be written');
  }
}

// ---- commands ------------------------------------------------------------------

function parseArgs(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') flags.json = true;
    else if (a === '--connectors' || a === '--plugins' || a === '--days') {
      flags[a.slice(2)] = args[i + 1];
      i += 1;
    } else if (a.startsWith('--')) throw new Refusal('unknown option ' + a);
    else rest.push(a);
  }
  return { flags, rest };
}

function show(args) {
  const { flags } = parseArgs(args);
  const kits = mergedKits();
  if (flags.json) return { json: { kits } };
  const lines = [];
  for (const id of KIT_IDS) {
    const k = kits[id];
    lines.push(`${k.id} (${k.label}): ${k.blurb}`);
    lines.push('  connectors: ' + (k.connectors.includes(KEEP_ALL) ? 'everything' : k.connectors.join(', ')));
    lines.push('  plugins: ' + (k.plugins.includes(KEEP_ALL) ? 'everything' : k.plugins.join(', ')));
  }
  lines.push('', 'Shadow mode: the app only notes which kit it would pick; nothing is switched off.');
  return { text: lines.join('\n') };
}

function set(args) {
  const { flags, rest } = parseArgs(args);
  const who = whoIsAsking();
  if (!SETTER_ROLES.includes(who.role)) throw new Refusal('only the owner and scouts can change the kits');
  const kit = rest[0];
  if (rest.length !== 1) throw new Refusal('name one kit: core, ads or web');
  if (kit === 'full') throw new Refusal('the full kit keeps everything and cannot be changed');
  if (!KIT_IDS.includes(kit)) throw new Refusal('no kit is called ' + String(kit).slice(0, 40));
  if (flags.connectors === undefined && flags.plugins === undefined) throw new Refusal('give --connectors and/or --plugins');
  const data = readFile(true) || { version: 1, kits: {} };
  if (!data.kits || typeof data.kits !== 'object' || Array.isArray(data.kits)) data.kits = {};
  const row = data.kits[kit] && typeof data.kits[kit] === 'object' ? { ...data.kits[kit] } : {};
  if (flags.connectors !== undefined) row.connectors = listArg(flags.connectors, 'connectors');
  if (flags.plugins !== undefined) row.plugins = listArg(flags.plugins, 'plugins');
  data.kits[kit] = row;
  data.updatedBy = who.slug;
  data.updatedAt = new Date().toISOString();
  writeFile(data);
  return { json: { ok: true, kit, connectors: row.connectors, plugins: row.plugins, updatedBy: who.slug }, text: `Updated the ${kit} kit.` };
}

// The records for this person, the highest `seq` per chat, from the last `days` days.
function readRecords(days) {
  const userName = git('user.name');
  const safeName = userName.toLowerCase().replace(/ /g, '-').replace(/[^\p{L}\p{N}-]/gu, '');
  if (!safeName) return [];
  let raw;
  try {
    raw = fs.readFileSync(path.join(BRAIN_ROOT, 'z-logs', 'app-usage', safeName + '.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const cut = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const best = new Map();
  for (const line of raw.split('\n')) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (!r || r.event !== 'app' || typeof r.chat !== 'string' || typeof r.seq !== 'number' || typeof r.day !== 'string') continue;
    if (r.day < cut) continue;
    const old = best.get(r.chat);
    if (!old || r.seq > old.seq) best.set(r.chat, r);
  }
  return [...best.values()];
}

function review(args) {
  const { flags } = parseArgs(args);
  let days = DEFAULT_DAYS;
  if (flags.days !== undefined) {
    days = Number(flags.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Refusal('--days must be a whole number from 1 to 365');
  }
  const kits = mergedKits();
  const records = readRecords(days);
  const work = records.filter((r) => r.work && typeof r.work === 'object');

  const byHow = {};
  const misses = [];
  const perKit = {};
  const usedConnectors = new Set();
  const usedPlugins = new Set();
  for (const id of KIT_IDS) perKit[id] = { chats: 0, wouldSave: { sure: 0, approx: 0 }, unusedConnectors: [], unusedPlugins: [] };
  for (const r of work) {
    const w = r.work;
    const how = String(w.how);
    const h = (byHow[how] = byHow[how] || { chats: 0, hits: 0 });
    const fits = Array.isArray(w.fits) ? w.fits : [];
    h.chats += 1;
    if (fits.includes(w.kit)) h.hits += 1;
    else misses.push({ day: r.day, chat: r.chat, kit: w.kit, how, fits });
    const k = perKit[w.kit];
    if (k) {
      k.chats += 1;
      if (w.wouldSave && typeof w.wouldSave.sure === 'number') {
        k.wouldSave.sure += w.wouldSave.sure;
        k.wouldSave.approx += w.wouldSave.approx || 0;
      }
    }
    if (w.used && Array.isArray(w.used.skills)) {
      for (const sk of w.used.skills) if (typeof sk === 'string' && sk.includes(':')) usedPlugins.add(sk.split(':')[0]);
    }
    if (w.used && Array.isArray(w.used.connectors)) for (const c of w.used.connectors) usedConnectors.add(normConnector(c));
  }
  // Connectors a kit keeps that none of this person's work chats used and the same for plugins, from the `plugin:` prefix of used skills (the log holds no weights).
  for (const id of KIT_IDS) {
    if (id === 'full' || perKit[id].chats === 0) continue;
    perKit[id].unusedPlugins = kits[id].plugins.filter((p) => p !== KEEP_ALL && !usedPlugins.has(p));
    perKit[id].unusedConnectors = kits[id].connectors.filter((c) => c !== KEEP_ALL && ![...usedConnectors].some((u) => u.includes(c)));
  }
  const hitRate = {};
  for (const how of Object.keys(byHow)) {
    const h = byHow[how];
    hitRate[how] = { chats: h.chats, hits: h.hits, percent: h.chats ? Math.round((h.hits / h.chats) * 100) : 0 };
  }
  const sum = (key) => records.reduce((n, r) => n + (typeof r[key] === 'number' ? r[key] : 0), 0);
  const result = {
    days,
    chats: records.length,
    workChats: work.length,
    hitRate,
    misses,
    kits: perKit,
    summaries: work.reduce((n, r) => n + (typeof r.work.summaries === 'number' ? r.work.summaries : 0), 0),
    compacted: sum('compacted'),
    cacheRead: sum('cacheRead'),
  };
  if (flags.json) return { json: result };

  const lines = [`Kit review, last ${days} days: ${records.length} chats, ${work.length} work chats.`];
  if (work.length === 0) lines.push('No kit picks recorded yet.');
  for (const how of Object.keys(hitRate)) {
    const h = hitRate[how];
    lines.push(`Picked by ${how}: ${h.hits} of ${h.chats} would have been enough (${h.percent}%).`);
  }
  if (misses.length) {
    lines.push('Misses (the picked kit lacked something the chat used):');
    for (const m of misses.slice(0, 20)) lines.push(`  ${m.day} ${m.kit} (${m.how}); would have fitted: ${m.fits.join(', ') || 'none'}`);
  }
  for (const id of KIT_IDS) {
    const k = perKit[id];
    if (k.chats === 0) continue;
    lines.push(`${id}: ${k.chats} chats, would have saved about ${k.wouldSave.sure} to ${k.wouldSave.approx} tokens at start-up.`);
    if (k.unusedConnectors.length) lines.push(`  connectors never used in these chats: ${k.unusedConnectors.join(', ')}`);
    if (k.unusedPlugins.length) lines.push(`  plugins never used in these chats: ${k.unusedPlugins.join(', ')}`);
  }
  lines.push(`Summaries: ${result.summaries}. Compactions: ${result.compacted}. Cache read: ${result.cacheRead} tokens.`);
  return { text: lines.join('\n'), json: result };
}

function capabilities() {
  return { json: { version: SCRIPT_VERSION, features: ['show', 'set', 'review'] } };
}

// ---- command line --------------------------------------------------------------

const COMMANDS = { show, set, review, capabilities };

function main() {
  const command = process.argv[2] || '';
  const args = process.argv.slice(3);
  try {
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, command)) throw new Refusal('unknown command');
    const out = COMMANDS[command](args);
    const wantJson = args.includes('--json') || command === 'capabilities' || (command === 'set' && !out.text);
    process.stdout.write((wantJson && out.json ? JSON.stringify(out.json) : out.text) + '\n');
    process.exitCode = 0;
  } catch (err) {
    const msg = err instanceof Refusal ? err.message : 'failed';
    process.stdout.write((args.includes('--json') ? JSON.stringify({ error: msg }) : 'Not done: ' + msg) + '\n');
    process.exitCode = 2;
  }
}

main();
