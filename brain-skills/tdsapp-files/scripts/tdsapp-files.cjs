#!/usr/bin/env node
// tdsapp-files.cjs (v0.1): delete library files into a holding folder, put them back, erase them
// after 30 days, and keep a team action log. The plan is the app repo's
// docs/plans/2026-11-15-delete-library-files.md (decisions 1-5 and 9); the shapes are in its
// shared/files-contract.ts (a test checks the constants here match).
//
// Usage:
//   echo '<json>' | node .claude/skills/tdsapp-files/scripts/tdsapp-files.cjs <action>
//
//   <action>  delete | restore | purge | list-deleted | capabilities
//   stdin     one JSON object (at most 64 KB): delete {path, expect?, via?, by_name?},
//             restore {holding, via?, by_name?}, purge {via?}, list-deleted {}, capabilities {}.
//   stdout    one JSON line: {ok: true, action, ...} or {ok: false, code, error}.
//   exit 0    ok; exit 2 refused (bad-request, not-found, not-allowed, changed, exists);
//             exit 1 internal.
//
// The caller is DISTRUSTED and everything fails closed:
//   - `path` is relative, forward slashes, no empty, `.` or `..` segment, no NUL or backslash. Only
//     `clients/<slug>/...` (owner, scout, team) and `templates/...` (owner only). Never-listed paths
//     (the library's isNeverListed, any case), CLAUDE.md, AGENTS.md, README.md anywhere and
//     clients/<slug>/profile.md are refused. Only the image and document types the library lists.
//   - A regular file only: no folder, no link, and its real path must be exactly the path asked for
//     (so no link anywhere along the way, and the letters' case must match the disk).
//   - The role comes from this Mac's `git config user.email` (else `user.name` when no email is set)
//     matched against .team-config/roles.json. stdin `by` is never read; `via` and `by_name` are
//     display text only, cleaned and capped.
//   - The brain must be a git repository, and git must say the file isn't ignored: a Mac-only file
//     moved into the synced holding folder would otherwise be published.
//   - `expect` (optional) must equal the library's version, `<bytes>-<whole mtime ms>`.
//
// Files:
//   tdsapp-deleted/<YYYYMMDD-HHMMSS>-<6 hex>/<original path>   the deleted file (UTC stamp)
//   tdsapp-deleted/<id>/record.json                            HoldingRecord
//   tdsapp-deleted/README.md                                   written once, never changed
//   tdsapp-deleted/log/<member-slug>.<machine-id>.jsonl         ActionLogLine, appended only
//   ~/.config/tdsapp/machine-id                                 6 hex, made once, never synced
//
// When `require`d it runs nothing and exports its functions, so tests can pass a brain root, a home
// folder and a clock. The command line always uses the real clock: never stdin, never a variable.
// Plain Node, no dependencies.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_VERSION = '0.1';

// Mirrors shared/files-contract.ts (a test checks they match).
const PURGE_AFTER_DAYS = 30;
const HOLDING_DIR = 'tdsapp-deleted';
const ACTION_LOG_DIR = 'tdsapp-deleted/log';
const HOLDING_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{6}$/;
const PROTECTED_NAMES = ['claude.md', 'agents.md', 'readme.md'];
const PROTECTED_CLIENT_FILES = ['profile.md'];
const FILES_CAPABILITY = 'files-delete-v1';

// Mirrors CLASSES in the app's server/brain/library-rules.ts (a test checks they match).
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'];
const DOCUMENT_EXTENSIONS = ['pdf', 'md', 'txt', 'docx', 'html', 'htm', 'csv', 'xlsx', 'pptx'];
const LIBRARY_EXTENSIONS = [...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS];

const DAY_MS = 86400000;
const INPUT_MAX = 65536;
const PATH_MAX = 1024;
const VIA_MAX = 60;
const NAME_MAX = 80;
const RECORD_MAX = 16384;
const DEFAULT_VIA = 'tdsapp-files skill';
const ERRORS = new Set(['bad-request', 'not-found', 'not-allowed', 'changed', 'exists', 'internal']);
const ROLE_CAN = { client: new Set(['owner', 'scout', 'team']), templates: new Set(['owner']) };
const README_TEXT = [
  '# Deleted files',
  '',
  "Deleted files, not sources. Don't quote them.",
  '',
  'Each folder here holds one file deleted from the library, under its original path, with a',
  '`record.json` saying who deleted it and when. It is erased for good 30 days after it was deleted.',
  'To put one back, ask Claude ("put back the file I deleted"). Only the `tdsapp-files` skill changes',
  'this folder. `log/` is the team\'s record of every delete, put-back and erase.',
  '',
].join('\n');

// A refusal (or an internal failure) with its contract code.
class Refusal extends Error {
  constructor(code, message) {
    super(message);
    this.code = ERRORS.has(code) ? code : 'internal';
  }
}
const refuse = (code, message) => new Refusal(code, message);

// ---- rules shared with the app ------------------------------------------------------

// The library's isNeverListed (server/brain/library-rules.ts), line for line. Case is ignored.
function isNeverListed(relFromRoot) {
  if (relFromRoot === '' || relFromRoot.includes('\\') || relFromRoot.includes('\0')) return true;
  const segs = relFromRoot.toLowerCase().split('/');
  for (const s of segs) {
    if (s === '' || s.startsWith('.') || s === 'node_modules') return true;
  }
  if (segs[0] === 'personal' && segs[1] === 'todo') return true;
  if (segs[0] === 'clients') {
    if (segs[1] && segs[1].startsWith('_')) return true;
    const [a, b, c] = segs.slice(2);
    if (a === 'config') return true;
    if (a === 'crm' && b === 'data') return true;
    if (a === 'context' && b === 'google-ads' && c === 'data') return true;
  }
  return false;
}

// The library's extOf: "Report.PDF" gives "pdf"; no dot, or only a leading one, gives ''.
function extOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

// The library's versionOf (server/brain/library.ts).
function versionOf(bytes, mtimeMs) {
  return `${bytes}-${Math.trunc(mtimeMs)}`;
}

// The brain's member slug rule (log-team-usage.sh, the app's memberSlug): lowercase, spaces become
// dashes, everything but a-z, 0-9 and dashes goes.
function memberSlug(name) {
  return String(name).toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
}

// The app's mapRole (server/brain/util.ts).
function mapRole(raw) {
  const r = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (r === 'owner') return 'owner';
  if (r === 'scout' || r === 'head-scout' || r === 'agency') return 'scout';
  if (r === 'team') return 'team';
  return 'unknown';
}

// ---- input cleaning ---------------------------------------------------------------------

// One line of display text: control characters and line breaks become single spaces, then capped.
function displayText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ').trim().slice(0, max).trim();
}

function expectOf(input) {
  const value = input.expect;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{1,20}-\d{1,20}$/.test(value)) {
    throw refuse('bad-request', 'expect must be a library version (<bytes>-<mtime ms>)');
  }
  return value;
}

// The path's segments, or a refusal. Shape only: scope, role and the rest are checked by scopeOf.
function pathSegments(rel) {
  if (typeof rel !== 'string' || rel === '') throw refuse('bad-request', 'path is required');
  if (rel.length > PATH_MAX) throw refuse('bad-request', `path is too long (over ${PATH_MAX} characters)`);
  if (rel.includes('\0') || rel.includes('\\') || rel.startsWith('/')) {
    throw refuse('not-allowed', 'path must be relative, with forward slashes');
  }
  const segs = rel.split('/');
  if (segs.some(s => s === '' || s === '.' || s === '..')) {
    throw refuse('not-allowed', 'path has an empty, "." or ".." part');
  }
  return segs;
}

// 'client' or 'templates' for a path this role may delete or restore; otherwise a refusal.
function scopeOf(rel, role) {
  const segs = pathSegments(rel);
  if (isNeverListed(rel)) throw refuse('not-allowed', 'that path is never listed in the library');
  let scope = null;
  if (segs[0] === 'clients' && segs.length >= 3) scope = 'client';
  else if (segs[0] === 'templates' && segs.length >= 2) scope = 'templates';
  if (!scope) throw refuse('not-allowed', 'only files in clients/<slug>/ and templates/ can be deleted');
  const base = segs[segs.length - 1].toLowerCase();
  if (PROTECTED_NAMES.includes(base)) throw refuse('not-allowed', `${segs[segs.length - 1]} is protected`);
  if (scope === 'client' && segs.length === 3 && PROTECTED_CLIENT_FILES.includes(base)) {
    throw refuse('not-allowed', "a client's profile.md is protected");
  }
  if (!LIBRARY_EXTENSIONS.includes(extOf(segs[segs.length - 1]))) {
    throw refuse('not-allowed', 'only the image and document types the library lists can be deleted');
  }
  if (!ROLE_CAN[scope].has(role)) {
    throw refuse('not-allowed', scope === 'templates'
      ? 'only the owner can delete templates'
      : 'only people on the team in .team-config/roles.json can delete client files');
  }
  return scope;
}

// ---- git and identity --------------------------------------------------------------------

// git, run in the brain with messages in English and none of the caller's GIT_* variables (they
// could point git at another repository). HOME is this run's home. Null if it can't run.
function gitInBrain(ctx, args, input) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  env.HOME = ctx.home;
  env.LC_ALL = 'C';
  env.LANGUAGE = '';
  const out = spawnSync('git', args, { cwd: ctx.root, encoding: 'utf8', timeout: 5000, env, input });
  return out.error ? null : out;
}

function gitValue(ctx, args) {
  const out = gitInBrain(ctx, args);
  return out && out.status === 0 ? (out.stdout || '').trim() : '';
}

// True only when the brain's root is itself the top of a git work tree.
function isBrainRepo(ctx) {
  const out = gitInBrain(ctx, ['rev-parse', '--show-toplevel']);
  if (!out || out.status !== 0) return false;
  try {
    return fs.realpathSync.native((out.stdout || '').trim()) === fs.realpathSync.native(ctx.root);
  } catch {
    return false;
  }
}

// Refuses unless the brain is a git repository and git says none of these paths is ignored.
// check-ignore treats a tracked file as not ignored. Names go in and out NUL-separated.
function requireNotIgnored(ctx, rels) {
  if (!isBrainRepo(ctx)) throw refuse('not-allowed', "the brain isn't a git repository, so it can't be checked");
  // A file inside a separate git project (a `.git` folder or pointer file in any folder between the
  // brain and the file) is refused: until the brain's next sync check-ignore calls it not ignored,
  // and moved into the holding folder its contents would leave that project and reach the team.
  for (const rel of rels) {
    const parts = rel.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      let found = true;
      try {
        fs.lstatSync(path.join(ctx.root, ...parts.slice(0, i), '.git'));
      } catch (err) {
        found = !(err && (err.code === 'ENOENT' || err.code === 'ENOTDIR'));
      }
      if (found) throw refuse('not-allowed', `${rel} is inside a separate git project`);
    }
  }
  const out = gitInBrain(ctx, ['check-ignore', '--stdin', '-z'], rels.map(rel => rel + '\0').join(''));
  if (!out || (out.status !== 0 && out.status !== 1)) {
    throw refuse('not-allowed', "git couldn't check whether that file is kept on this Mac only");
  }
  const ignored = (out.stdout || '').split('\0').filter(Boolean);
  if (ignored.length > 0) throw refuse('not-allowed', `${ignored[0]} is kept on this Mac only (git ignores it)`);
}

function readMembers(root) {
  try {
    const members = JSON.parse(fs.readFileSync(path.join(root, '.team-config', 'roles.json'), 'utf8')).members;
    return Array.isArray(members) ? members.filter(m => m && typeof m === 'object') : [];
  } catch {
    return [];
  }
}

// Who runs this, from this Mac's git identity and roles.json. An email, when set, must match;
// with no email set the name must. Anyone else is 'unknown', who may only purge and list.
function identity(ctx) {
  const email = gitValue(ctx, ['config', 'user.email']);
  const name = gitValue(ctx, ['config', 'user.name']);
  const members = readMembers(ctx.root);
  let member = null;
  if (email) {
    member = members.find(m => typeof m.email === 'string' && m.email.toLowerCase() === email.toLowerCase());
  } else if (memberSlug(name)) {
    member = members.find(m => typeof m.name === 'string' && memberSlug(m.name) === memberSlug(name));
  }
  if (member && typeof member.name === 'string' && memberSlug(member.name)) {
    return { slug: memberSlug(member.name), name: displayText(member.name, NAME_MAX), role: mapRole(member.role) };
  }
  return { slug: memberSlug(name) || 'unknown', name: displayText(name, NAME_MAX), role: 'unknown' };
}

// ---- file system helpers -----------------------------------------------------------------------

function errCode(err) {
  return err && typeof err === 'object' ? err.code : undefined;
}

function lstatOrNull(abs, opts) {
  try {
    return fs.lstatSync(abs, opts);
  } catch (err) {
    if (errCode(err) === 'ENOENT' || errCode(err) === 'ENOTDIR') return null;
    throw err;
  }
}

// Refuses unless `abs` really is `base`/`rel`: no link along the way, letters' case as on the disk.
function requireRealPath(base, abs, rel) {
  const real = fs.realpathSync.native(abs);
  const realBase = fs.realpathSync.native(base);
  const realRel = path.relative(realBase, real).split(path.sep).join('/');
  if (realRel !== rel) throw refuse('not-allowed', `${rel} goes through a link or doesn't match the folder names on disk`);
}

// Makes each missing folder of `segs` under `base`, one at a time. Every one that is there must be a
// plain folder: a link or a file along the way is refused with `code`. Returns the folder.
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

// Removes empty folders from `dir` down, deepest first. Anything not empty stays.
function removeEmptyFolders(dir) {
  const st = lstatOrNull(dir);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyFolders(path.join(dir, entry.name));
  }
  try {
    fs.rmdirSync(dir);
  } catch { /* not empty: keep it */ }
}

// ---- holding folder, records and the log -------------------------------------------------------

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

// `YYYYMMDD-HHMMSS` in UTC.
function stampOf(now) {
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-`
    + `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

// The UTC time in a holding id, or null when the id or its date isn't real.
function dateOfId(id) {
  if (typeof id !== 'string' || !HOLDING_ID_PATTERN.test(id)) return null;
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/.exec(id);
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return stampOf(date) === id.slice(0, 15) ? date : null;
}

function isoOrNull(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// tdsapp-deleted/ as a plain folder (made if missing), with its README written once.
function holdingRoot(ctx) {
  const dir = plainFolder(ctx.root, [HOLDING_DIR], 'internal');
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), README_TEXT, { flag: 'wx' });
  } catch (err) {
    if (errCode(err) !== 'EEXIST') throw err;
  }
  return dir;
}

// tdsapp-deleted/ if it is there as a plain folder; null if it isn't there; a refusal if it's a link.
function existingHoldingRoot(ctx) {
  const dir = path.join(ctx.root, HOLDING_DIR);
  const st = lstatOrNull(dir);
  if (!st) return null;
  if (st.isSymbolicLink() || !st.isDirectory()) throw refuse('internal', `${HOLDING_DIR} isn't a plain folder`);
  return dir;
}

// A record that can be trusted to the letter, cleaned to the known fields; null otherwise.
function readRecord(dir) {
  const file = path.join(dir, 'record.json');
  const st = lstatOrNull(file);
  if (!st || !st.isFile() || st.size > RECORD_MAX) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1) return null;
  if (typeof raw.path !== 'string' || raw.path === '' || raw.path.length > PATH_MAX) return null;
  if (raw.scope !== 'client' && raw.scope !== 'templates') return null;
  if (isoOrNull(raw.deleted_at) === null || isoOrNull(raw.purge_after) === null) return null;
  if (typeof raw.bytes !== 'number' || !Number.isSafeInteger(raw.bytes) || raw.bytes < 0) return null;
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    v: 1,
    path: raw.path,
    scope: raw.scope,
    deleted_at: raw.deleted_at,
    deleted_by: text(raw.deleted_by, NAME_MAX),
    deleted_by_name: text(raw.deleted_by_name, NAME_MAX),
    deleted_via: text(raw.deleted_via, VIA_MAX),
    purge_after: raw.purge_after,
    bytes: raw.bytes,
  };
}

// This Mac's id: 6 hex characters kept in ~/.config/tdsapp/machine-id, made once.
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
  // Another run made it first, or the file there is unreadable: use a good one, else replace it.
  const again = read();
  if (again) return again;
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, id + '\n');
  fs.renameSync(temp, file);
  return id;
}

// The log file for this person on this Mac, its folder made as a plain folder. Done before any
// change, so a log that can't be written stops the action instead of leaving it unrecorded.
function logFileFor(ctx, who) {
  const dir = plainFolder(ctx.root, ACTION_LOG_DIR.split('/'), 'internal');
  return path.join(dir, `${who.slug}.${machineId(ctx)}.jsonl`);
}

// Appends one line, never following a link. True when written.
function appendLog(file, line) {
  let fd;
  try {
    const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0);
    fd = fs.openSync(file, flags, 0o644);
    fs.writeSync(fd, JSON.stringify(line) + '\n');
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function logLine(now, action, who, via, scope, rel, bytes, holding) {
  return { v: 1, ts: now.toISOString(), action, by: who.slug, by_name: who.name, via, scope, path: rel, bytes, holding };
}

// The display name: the team list's, else the caller's cleaned `by_name`, else git's.
function whoFor(ctx, input) {
  const who = identity(ctx);
  if (who.role === 'unknown') who.name = displayText(input.by_name, NAME_MAX) || who.name || who.slug;
  return who;
}

// ---- actions ---------------------------------------------------------------------------------

function deleteFile(input, ctx) {
  const rel = input.path;
  pathSegments(rel);
  const expect = expectOf(input);
  const via = displayText(input.via, VIA_MAX) || DEFAULT_VIA;
  const who = whoFor(ctx, input);
  const scope = scopeOf(rel, who.role);
  const segs = rel.split('/');
  const abs = path.join(ctx.root, ...segs);

  const st = lstatOrNull(abs, { bigint: true });
  if (!st) throw refuse('not-found', `${rel} isn't there`);
  if (st.isSymbolicLink()) throw refuse('not-allowed', `${rel} is a link`);
  if (!st.isFile()) throw refuse('not-allowed', `${rel} isn't a file`);
  requireRealPath(ctx.root, abs, rel);
  requireNotIgnored(ctx, [rel]);
  const bytes = Number(st.size);
  if (expect !== null && expect !== versionOf(bytes, Number(st.mtimeMs))) {
    throw refuse('changed', `${rel} has changed since it was listed`);
  }

  const holdRoot = holdingRoot(ctx);
  const logFile = logFileFor(ctx, who);
  const now = ctx.now;
  let id = null;
  let dir = null;
  for (let i = 0; i < 8 && !id; i++) {
    const candidate = `${stampOf(now)}-${crypto.randomBytes(3).toString('hex')}`;
    try {
      fs.mkdirSync(path.join(holdRoot, candidate));
      id = candidate;
      dir = path.join(holdRoot, candidate);
    } catch (err) {
      if (errCode(err) !== 'EEXIST') throw err;
    }
  }
  if (!id) throw refuse('internal', "couldn't make a holding folder");

  const record = {
    v: 1,
    path: rel,
    scope,
    deleted_at: now.toISOString(),
    deleted_by: who.slug,
    deleted_by_name: who.name,
    deleted_via: via,
    purge_after: new Date(now.getTime() + PURGE_AFTER_DAYS * DAY_MS).toISOString(),
    bytes,
  };
  try {
    fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    plainFolder(dir, segs.slice(0, -1), 'internal');
    // A move, never a copy: if the rename can't be done, nothing is deleted.
    fs.renameSync(abs, path.join(dir, ...segs));
  } catch (err) {
    try { fs.unlinkSync(path.join(dir, 'record.json')); } catch { /* not written */ }
    removeEmptyFolders(dir);
    if (errCode(err) === 'ENOENT') throw refuse('not-found', `${rel} isn't there`);
    throw err;
  }
  const reply = { ok: true, action: 'delete', holding: id, purge_after: record.purge_after };
  if (!appendLog(logFile, logLine(now, 'delete', who, via, scope, rel, bytes, id))) reply.logged = false;
  return reply;
}

function restore(input, ctx) {
  const id = input.holding;
  if (typeof id !== 'string' || !HOLDING_ID_PATTERN.test(id)) throw refuse('bad-request', 'holding must be a holding id');
  const via = displayText(input.via, VIA_MAX) || DEFAULT_VIA;
  const who = whoFor(ctx, input);
  const holdRoot = existingHoldingRoot(ctx);
  if (!holdRoot) throw refuse('not-found', `${id} isn't in ${HOLDING_DIR}`);
  const dir = path.join(holdRoot, id);
  const dirSt = lstatOrNull(dir);
  if (!dirSt) throw refuse('not-found', `${id} isn't in ${HOLDING_DIR}`);
  if (dirSt.isSymbolicLink() || !dirSt.isDirectory()) throw refuse('not-allowed', `${id} isn't a plain folder`);
  const record = readRecord(dir);
  if (!record) throw refuse('not-allowed', `${id}/record.json is missing or can't be trusted`);

  // record.json syncs from every Mac, so its path gets every delete rule again.
  const rel = record.path;
  const scope = scopeOf(rel, who.role);
  if (scope !== record.scope) throw refuse('not-allowed', `${id}/record.json names the wrong scope`);
  const segs = rel.split('/');
  const held = path.join(dir, ...segs);
  const heldSt = lstatOrNull(held);
  if (!heldSt) throw refuse('not-found', `${id} no longer holds ${rel}`);
  if (heldSt.isSymbolicLink() || !heldSt.isFile()) throw refuse('not-allowed', `${id} holds a link or a folder, not a file`);
  requireRealPath(dir, held, rel);
  requireNotIgnored(ctx, [rel]);

  const target = path.join(ctx.root, ...segs);
  if (lstatOrNull(target)) throw refuse('exists', `something is already at ${rel}`);
  const parent = plainFolder(ctx.root, segs.slice(0, -1), 'not-allowed');
  requireRealPath(ctx.root, parent, segs.slice(0, -1).join('/'));
  const logFile = logFileFor(ctx, who);

  // A move that can't overwrite: link the held file into place (fails if anything is there), then
  // drop the held name. No copy: if linking fails, nothing changes.
  try {
    fs.linkSync(held, target);
  } catch (err) {
    if (errCode(err) === 'EEXIST') throw refuse('exists', `something is already at ${rel}`);
    if (errCode(err) === 'ENOENT') throw refuse('not-found', `${id} no longer holds ${rel}`);
    throw err;
  }
  fs.unlinkSync(held);
  const bytes = Number(fs.lstatSync(target).size);
  const reply = { ok: true, action: 'restore', path: rel };
  if (!appendLog(logFile, logLine(ctx.now, 'restore', who, via, scope, rel, bytes, id))) reply.logged = false;

  // The holding folder goes once it holds nothing but its record.
  removeEmptyFolders(dir);
  if (lstatOrNull(dir)) {
    const left = fs.readdirSync(dir);
    if (left.length === 1 && left[0] === 'record.json') {
      fs.unlinkSync(path.join(dir, 'record.json'));
      removeEmptyFolders(dir);
    }
  }
  return reply;
}

// True while git or the brain's sync is in the middle of something: purge then skips its whole run.
function syncBusy(ctx) {
  if (lstatOrNull(path.join(ctx.root, '.claude', 'sync.lockdir'))) return true;
  const gitPaths = [path.join(ctx.root, '.git')];
  const dotGit = lstatOrNull(gitPaths[0]);
  if (dotGit && !dotGit.isDirectory()) {
    // A linked work tree: ask git where its folder is, and stay out if it can't say.
    const dir = gitValue(ctx, ['rev-parse', '--absolute-git-dir']);
    if (!dir) return true;
    gitPaths.push(dir);
  }
  for (const gitDir of gitPaths) {
    for (const name of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply']) {
      if (lstatOrNull(path.join(gitDir, name))) return true;
    }
  }
  return false;
}

// Erases everything in one holding folder without following a link. Returns the files really erased.
function eraseHolding(dir) {
  const erased = [];
  const walk = (folder, relParts) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const abs = path.join(folder, entry.name);
      const parts = [...relParts, entry.name];
      if (relParts.length === 0 && entry.name === 'record.json') continue;
      if (entry.isDirectory()) {
        walk(abs, parts);
        try { fs.rmdirSync(abs); } catch { /* something left: keep it */ }
        continue;
      }
      const st = lstatOrNull(abs);
      if (!st) continue;
      try {
        fs.unlinkSync(abs);
      } catch {
        continue;
      }
      if (st.isFile()) erased.push({ rel: parts.join('/'), bytes: st.size });
    }
  };
  walk(dir, []);
  try { fs.unlinkSync(path.join(dir, 'record.json')); } catch { /* already gone */ }
  try { fs.rmdirSync(dir); } catch { /* something left: keep it */ }
  return erased;
}

function purge(input, ctx) {
  const done = { ok: true, action: 'purge', erased: 0 };
  if (syncBusy(ctx)) return done;
  const holdRoot = existingHoldingRoot(ctx);
  if (!holdRoot) return done;
  const now = ctx.now.getTime();
  const due = [];
  for (const entry of fs.readdirSync(holdRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !HOLDING_ID_PATTERN.test(entry.name)) continue;
    const made = dateOfId(entry.name);
    if (!made || made.getTime() + PURGE_AFTER_DAYS * DAY_MS > now) continue;
    const dir = path.join(holdRoot, entry.name);
    const record = readRecord(dir);
    if (!record || isoOrNull(record.purge_after) > now) continue;
    due.push({ id: entry.name, dir, record });
  }
  if (due.length === 0) return done;
  const via = displayText(input.via, VIA_MAX) || DEFAULT_VIA;
  const who = whoFor(ctx, input);
  const logFile = logFileFor(ctx, who);
  for (const { id, dir, record } of due) {
    for (const file of eraseHolding(dir)) {
      const scope = file.rel.startsWith('templates/') ? 'templates' : file.rel.startsWith('clients/') ? 'client' : record.scope;
      appendLog(logFile, logLine(ctx.now, 'purge', who, via, scope, file.rel, file.bytes, id));
      done.erased += 1;
    }
  }
  return done;
}

function listDeleted(input, ctx) {
  const items = [];
  const holdRoot = existingHoldingRoot(ctx);
  if (holdRoot) {
    for (const entry of fs.readdirSync(holdRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !HOLDING_ID_PATTERN.test(entry.name)) continue;
      const dir = path.join(holdRoot, entry.name);
      const record = readRecord(dir);
      if (!record) continue;
      let segs;
      try {
        segs = pathSegments(record.path);
      } catch {
        continue;
      }
      const st = lstatOrNull(path.join(dir, ...segs));
      if (!st) continue;
      items.push({ ...record, holding: entry.name, changed_after_deletion: !st.isFile() || st.size !== record.bytes });
    }
  }
  items.sort((a, b) => (a.holding < b.holding ? 1 : a.holding > b.holding ? -1 : 0));
  return { ok: true, action: 'list-deleted', items };
}

function capabilities() {
  return { ok: true, action: 'capabilities', version: SCRIPT_VERSION, features: [FILES_CAPABILITY] };
}

// ---- command line ------------------------------------------------------------------------------

const ACTIONS = { delete: deleteFile, restore, purge, 'list-deleted': listDeleted, capabilities };

function defaultCtx() {
  return {
    root: process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..'),
    home: os.homedir(),
    now: new Date(),
  };
}

// Runs one action. Returns the exit code and the reply; never throws.
function run(action, input, ctx) {
  const fail = (code, error) => ({ exit: code === 'internal' ? 1 : 2, reply: { ok: false, code, error } });
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
    return fail('bad-request', 'unknown action');
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return fail('bad-request', 'stdin must be one JSON object');
  }
  const context = Object.assign(defaultCtx(), ctx);
  try {
    return { exit: 0, reply: ACTIONS[action](input, context) };
  } catch (err) {
    if (err instanceof Refusal) return fail(err.code, err.message);
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
      result = input === undefined
        ? { exit: 2, reply: { ok: false, code: 'bad-request', error: 'invalid JSON' } }
        : run(process.argv[2] || '', input, {});
    }
    process.stdout.write(JSON.stringify(result.reply) + '\n');
    process.exitCode = result.exit;
  };
  // Read stdin to the end first, so a caller writing a body never meets a closed pipe.
  process.stdin.on('data', (c) => {
    size += c.length;
    if (size <= INPUT_MAX) chunks.push(c);
  });
  process.stdin.on('end', start);
  process.stdin.on('error', start);
}

if (require.main === module) main();

module.exports = {
  run,
  deleteFile,
  restore,
  purge,
  listDeleted,
  capabilities,
  isNeverListed,
  extOf,
  versionOf,
  memberSlug,
  mapRole,
  SCRIPT_VERSION,
  PURGE_AFTER_DAYS,
  HOLDING_DIR,
  ACTION_LOG_DIR,
  HOLDING_ID_PATTERN,
  PROTECTED_NAMES,
  PROTECTED_CLIENT_FILES,
  FILES_CAPABILITY,
  IMAGE_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  LIBRARY_EXTENSIONS,
};
