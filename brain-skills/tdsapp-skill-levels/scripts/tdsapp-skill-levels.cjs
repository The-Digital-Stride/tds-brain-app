// tdsapp-skill-levels: the one writer of the team's skill levels file, .claude/tdsapp-skill-levels.json.
//
// Commands (the first argument), each reading one JSON object on stdin and printing one JSON line:
//   set           { skill, tier, note? }        set a skill's team level (tier: quick | standard | deep)
//   clear         { skill }                     remove a skill's team level
//   import        { levels: { <skill>: { tier, note? } } }
//                                               add a reviewed batch, setBy 'prefill'; never replaces a
//                                               level someone set themselves; all or nothing
//   capabilities  {}                            { version, features }
//
// Exit 0: worked. Exit 2: refused, with `status` 400 (bad input), 403 (not allowed) or 500.
//
// Who is asking is worked out here, read-only, from the brain's own identity: `git config
// user.email` (else user.name) looked up in .team-config/roles.json. Anything sent about who or
// what role (`role`, `by`, `setBy`) is ignored. Only the owner and scouts may change levels.
//
// The file is written whole to a hidden temporary file in .claude/ and swapped in, with skills in
// alphabetical order and one entry per line, so git merges it cleanly. If the write fails the
// temporary file is removed, because the brain's sync would otherwise share it.
//
// Test hook: with NODE_ENV=test, TDSAPP_SKILL_LEVELS_TEST_FAIL=write|rename makes that step fail.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BRAIN_ROOT = process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
const CLAUDE_DIR = path.join(BRAIN_ROOT, '.claude');
const LEVELS_FILE = path.join(CLAUDE_DIR, 'tdsapp-skill-levels.json');
const SCRIPT_VERSION = '0.1';

const TIERS = ['quick', 'standard', 'deep'];
const SETTER_ROLES = ['owner', 'scout'];
const NOTE_MAX = 160;
const SKILL_NAME = /^[A-Za-z0-9][\w.:-]{0,127}$/;
const IMPORT_MAX = 1000;

class Refusal extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---- who is asking ------------------------------------------------------------

function git(args) {
  try {
    const out = spawnSync('git', ['config', ...args], { cwd: BRAIN_ROOT, encoding: 'utf8', timeout: 3000 });
    return ((out && out.stdout) || '').trim();
  } catch {
    return '';
  }
}

// The brain's rule: lowercase, spaces to dashes, drop everything but a-z, 0-9 and dashes.
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

// { slug, role } of the person using this brain, or role 'unknown' when they can't be found.
function whoIsAsking() {
  const email = git(['user.email']).toLowerCase();
  const members = readMembers();
  let member = null;
  if (email !== '') {
    member = members.find((m) => typeof m.email === 'string' && m.email.toLowerCase() === email) || null;
  } else {
    const slug = memberSlug(git(['user.name']));
    if (slug !== '') {
      member = members.find((m) => typeof m.name === 'string' && memberSlug(m.name) === slug) || null;
    }
  }
  if (!member || typeof member.name !== 'string' || memberSlug(member.name) === '') {
    return { slug: '', role: 'unknown' };
  }
  return { slug: memberSlug(member.name), role: mapRole(member.role) };
}

function requireSetter() {
  const who = whoIsAsking();
  if (!SETTER_ROLES.includes(who.role)) {
    throw new Refusal(403, 'only the owner and scouts can change skill levels');
  }
  return who;
}

// ---- checks -------------------------------------------------------------------

function isRegularFile(p) {
  try {
    const st = fs.lstatSync(p);
    return st.isFile() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

function skillName(value) {
  if (typeof value !== 'string' || !SKILL_NAME.test(value)) throw new Refusal(400, 'skill must be a skill name');
  return value;
}

// The name of a skill folder (with a SKILL.md) or a command file in this brain.
function skillExists(name) {
  return (
    isRegularFile(path.join(CLAUDE_DIR, 'skills', name, 'SKILL.md')) ||
    isRegularFile(path.join(CLAUDE_DIR, 'commands', name + '.md'))
  );
}

function tierOf(value, who) {
  if (typeof value !== 'string' || !TIERS.includes(value)) {
    throw new Refusal(400, (who ? who + ': ' : '') + 'tier must be quick, standard or deep');
  }
  return value;
}

function noteOf(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Refusal(400, 'note must be text');
  const note = value.replace(/\s+/g, ' ').trim();
  if (note.length > NOTE_MAX) throw new Refusal(400, 'note is over ' + NOTE_MAX + ' characters');
  return note === '' ? undefined : note;
}

// ---- the file -----------------------------------------------------------------

// The levels now in the file, rows untouched (a row this version doesn't understand is kept, so a
// newer app's data isn't lost). A missing file is {}. A file that can't be read is refused rather
// than overwritten.
function readLevels() {
  let text;
  try {
    text = fs.readFileSync(LEVELS_FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw new Refusal(500, 'the levels file could not be read');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Refusal(500, 'the levels file is not valid JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1) {
    throw new Refusal(500, 'the levels file is not version 1');
  }
  const out = {};
  const levels = data.levels;
  if (levels && typeof levels === 'object' && !Array.isArray(levels)) {
    for (const key of Object.keys(levels)) out[key] = levels[key];
  }
  return out;
}

// One entry per line, skills in code-point order, fields in a fixed order.
function render(levels) {
  const names = Object.keys(levels).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rows = names.map((name) => {
    const row = levels[name];
    if (!row || typeof row !== 'object' || Array.isArray(row)) return '    ' + JSON.stringify(name) + ': ' + JSON.stringify(row);
    const ordered = {};
    for (const key of ['tier', 'setBy', 'at', 'note']) if (row && row[key] !== undefined) ordered[key] = row[key];
    if (row && typeof row === 'object') {
      for (const key of Object.keys(row)) if (!(key in ordered)) ordered[key] = row[key];
    }
    return '    ' + JSON.stringify(name) + ': ' + JSON.stringify(ordered);
  });
  const body = rows.length === 0 ? '{}' : '{\n' + rows.join(',\n') + '\n  }';
  return '{\n  "version": 1,\n  "levels": ' + body + '\n}\n';
}

function injectedFailure(step) {
  return process.env.NODE_ENV === 'test' && process.env.TDSAPP_SKILL_LEVELS_TEST_FAIL === step;
}

function writeLevels(levels) {
  try {
    if (fs.lstatSync(LEVELS_FILE).isSymbolicLink()) throw new Refusal(500, 'the levels file is a link');
  } catch (err) {
    if (err instanceof Refusal) throw err;
  }
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  const tmp = path.join(
    CLAUDE_DIR,
    '.tdsapp-skill-levels-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.tmp~',
  );
  try {
    if (injectedFailure('write')) throw new Error('injected write failure');
    const fd = fs.openSync(tmp, 'wx', 0o644);
    try {
      fs.writeSync(fd, render(levels));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (injectedFailure('rename')) throw new Error('injected rename failure');
    fs.renameSync(tmp, LEVELS_FILE);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // nothing more to do
    }
    if (err instanceof Refusal) throw err;
    throw new Refusal(500, 'the levels file could not be written');
  }
}

// ---- commands -----------------------------------------------------------------

function row(tier, setBy, note) {
  const r = { tier, setBy, at: new Date().toISOString() };
  if (note !== undefined) r.note = note;
  return r;
}

function set(body) {
  const who = requireSetter();
  const skill = skillName(body.skill);
  const tier = tierOf(body.tier);
  const note = noteOf(body.note);
  if (!skillExists(skill)) throw new Refusal(400, 'no skill or command is called ' + skill);
  const levels = readLevels();
  levels[skill] = row(tier, who.slug, note);
  writeLevels(levels);
  return { ok: true, skill, tier, setBy: who.slug };
}

function clear(body) {
  requireSetter();
  const skill = skillName(body.skill);
  const levels = readLevels();
  if (!Object.prototype.hasOwnProperty.call(levels, skill)) return { ok: true, skill, changed: false };
  delete levels[skill];
  writeLevels(levels);
  return { ok: true, skill, changed: true };
}

function importBatch(body) {
  requireSetter();
  const batch = body.levels;
  if (!batch || typeof batch !== 'object' || Array.isArray(batch)) throw new Refusal(400, 'levels must be an object');
  const names = Object.keys(batch);
  if (names.length === 0 || names.length > IMPORT_MAX) throw new Refusal(400, 'levels must hold 1 to ' + IMPORT_MAX + ' skills');
  // Everything is checked before anything is written.
  const checked = names.map((name) => {
    skillName(name);
    const entry = batch[name];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Refusal(400, name + ': not a level');
    if (!skillExists(name)) throw new Refusal(400, 'no skill or command is called ' + name);
    return { name, tier: tierOf(entry.tier, name), note: noteOf(entry.note) };
  });
  const levels = readLevels();
  const skipped = [];
  let imported = 0;
  for (const c of checked) {
    const existing = Object.prototype.hasOwnProperty.call(levels, c.name) ? levels[c.name] : null;
    // A level a person set stays; only a missing or earlier pre-fill row is filled in.
    if (existing && !(typeof existing === 'object' && existing.setBy === 'prefill')) {
      skipped.push(c.name);
      continue;
    }
    levels[c.name] = row(c.tier, 'prefill', c.note);
    imported += 1;
  }
  if (imported > 0) writeLevels(levels);
  return { ok: true, imported, skipped: skipped.sort() };
}

function capabilities() {
  return { version: SCRIPT_VERSION, features: ['set', 'clear', 'import'] };
}

// ---- command line -------------------------------------------------------------

const COMMANDS = { set, clear, import: importBatch, capabilities };

function finish(code, body) {
  const out = code === 200 ? body : Object.assign({}, body, { status: code });
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exitCode = code === 200 ? 0 : 2;
}

function run(command, raw) {
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, command)) return finish(400, { error: 'unknown command' });
  let body;
  try {
    body = raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    return finish(400, { error: 'invalid JSON' });
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return finish(400, { error: 'invalid JSON' });
  try {
    return finish(200, COMMANDS[command](body));
  } catch (err) {
    return finish(err instanceof Refusal ? err.status : 500, { error: err instanceof Refusal ? err.message : 'failed' });
  }
}

// Read stdin to the end first, so a caller writing a body never meets a closed pipe.
const chunks = [];
let started = false;
function start() {
  if (started) return;
  started = true;
  run(process.argv[2] || '', Buffer.concat(chunks).toString('utf8'));
}
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', start);
process.stdin.on('error', start);
