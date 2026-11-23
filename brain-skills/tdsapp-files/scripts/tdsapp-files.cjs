#!/usr/bin/env node
// tdsapp-files.cjs (v0.4): delete library files into a holding folder, put them back, erase them
// after 30 days, and keep a team action log. The plan is the app repo's
// docs/plans/2026-11-15-delete-library-files.md (decisions 1-5 and 9); the shapes are in its
// shared/files-contract.ts (a test checks the constants here match). v0.2 adds `add`, which copies
// an uploaded file into the library (docs/plans/2026-11-16-todo-attachments.md, decision 3). v0.3
// refuses to delete a project's own record inside clients/<client>/projects/<slug>/: project.md,
// retainer.md and anything in updates/ or months/ (docs/plans/2026-11-20-projects-system.md,
// decision 27). Other files there delete as before. v0.4 adds `add-artifact`, which files a claude.ai
// artifact in a project's files/ folder, as a copy of its page or a link card
// (docs/plans/2026-11-23-claude-artifacts-in-projects.md, decisions 2, 6 and 7).
//
// Usage:
//   echo '<json>' | node .claude/skills/tdsapp-files/scripts/tdsapp-files.cjs <action>
//
//   <action>  delete | restore | purge | list-deleted | add | add-artifact | capabilities
//   stdin     one JSON object (at most 64 KB): delete {path, expect?, via?, by_name?},
//             restore {holding, via?, by_name?}, purge {via?}, list-deleted {}, capabilities {},
//             add {source, path, via?, by_name?}, add-artifact {url, path, source?, title?, description?,
//             partial?, copied?, via?, by_name?}.
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
// add (v0.2) copies `source` (an absolute path to a regular file, not a link, whose real path is
// outside the brain, at most 32 MB) to `path`, which must be exactly clients/<client>/files/<name>,
// clients/<client>/images/<name>, personal/files/<name> or personal/images/<name>. The client folder
// (or personal/) must already be a real folder; files/ or images/ is made if missing. Images go in
// images/ (png, jpg, jpeg, webp, gif), documents in files/ (pdf, md, txt, docx, csv, xlsx, pptx),
// and the source's extension must be the same. Delete's guards apply (protected names, never-listed
// places, no link on the way, no separate git project). A client file must NOT be git-ignored (it
// has to reach the team); a personal file MUST be (it must never sync); either is refused when the
// brain isn't a git repository or git can't check. Nothing is overwritten: a taken name becomes
// "name (2).ext", "name (3).ext"… The copy is written to a hidden temp file in the same folder and
// hard-linked into place (an exclusive write where links aren't supported). Client adds are logged
// (`holding: ''`); personal adds never are, since the log syncs.
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

const SCRIPT_VERSION = '0.4';

// Mirrors shared/files-contract.ts (a test checks they match).
const PURGE_AFTER_DAYS = 30;
const HOLDING_DIR = 'tdsapp-deleted';
const ACTION_LOG_DIR = 'tdsapp-deleted/log';
const HOLDING_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{6}$/;
const PROTECTED_NAMES = ['claude.md', 'agents.md', 'readme.md'];
const PROTECTED_CLIENT_FILES = ['profile.md'];
// Mirrors PROJECT_PROTECTED_NAMES in shared/projects-contract.ts (plan 2026-11-20-projects-system,
// decision 27): inside any project folder (clients/<client>/projects/<slug>/), the card, the retainer
// terms and everything in updates/ and months/ are never deleted. A name ending in / is a folder.
const PROJECT_PROTECTED_NAMES = ['project.md', 'retainer.md', 'updates/', 'months/'];
const FILES_CAPABILITY = 'files-delete-v1';
// v0.2: `add`, for uploads (the app's TODO_UPLOAD_TYPES and MAX_UPLOAD_BYTES; a test checks).
const ADD_CAPABILITY = 'files-add-v1';
const ADD_MAX_BYTES = 32 * 1024 * 1024;
const ADD_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const ADD_DOCUMENT_EXTENSIONS = ['pdf', 'md', 'txt', 'docx', 'csv', 'xlsx', 'pptx'];
const ADD_FOLDERS = { images: ADD_IMAGE_EXTENSIONS, files: ADD_DOCUMENT_EXTENSIONS };
const ADD_NAME_TRIES = 1000;
// v0.4: `add-artifact`.
const ARTIFACT_CAPABILITY = 'files-artifact-v1';
const ARTIFACT_MAX_BYTES = 5 * 1024 * 1024;
const ARTIFACT_URL_PATTERN = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]{1,64}\/?$/;
const ARTIFACT_TITLE_MAX = 200;
const ARTIFACT_DESCRIPTION_MAX = 300;

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

// True for a path inside a project folder (clients/<client>/projects/<slug>/...) that names one of
// PROJECT_PROTECTED_NAMES: the file itself, or anything inside the protected folder. Case and
// look-alike letters (NFKC) are ignored, as for the other protected names.
function isProjectProtected(segs) {
  if (segs.length < 5 || segs[0] !== 'clients' || segs[2].normalize('NFKC').toLowerCase() !== 'projects') return false;
  const name = segs[4].normalize('NFKC').toLowerCase();
  return PROJECT_PROTECTED_NAMES.some(p => (p.endsWith('/')
    ? segs.length > 5 && name === p.slice(0, -1)
    : segs.length === 5 && name === p));
}

// 'client' or 'templates' for a path this role may delete or restore; otherwise a refusal. A project's
// protected files can't be deleted, but one deleted before v0.3 can still be put back (`restoring`).
function scopeOf(rel, role, restoring) {
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
  if (scope === 'client' && !restoring && isProjectProtected(segs)) {
    throw refuse('not-allowed', `${segs.slice(4).join('/')} is part of the project's own record, so it can't be deleted`);
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
  const ignored = ignoredOf(ctx, rels);
  if (ignored.length > 0) throw refuse('not-allowed', `${ignored[0]} is kept on this Mac only (git ignores it)`);
}

// v0.2: refuses unless the brain is a git repository and git ignores every one of these paths, so
// nothing written there ever syncs.
function requireIgnored(ctx, rels) {
  const ignored = new Set(ignoredOf(ctx, rels));
  const missed = rels.find(rel => !ignored.has(rel));
  if (missed !== undefined) throw refuse('not-allowed', `${missed} would sync to the team: git doesn't ignore it`);
}

// Which of these paths git ignores, after the checks both rules share. Refuses when the brain isn't a
// git repository, a path is inside a separate git project, or git can't answer.
function ignoredOf(ctx, rels) {
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
  return (out.stdout || '').split('\0').filter(Boolean);
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
  const scope = scopeOf(rel, who.role, true);
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

// ---- add (v0.2) --------------------------------------------------------------------------------

// The destination's scope ('client' or 'personal') and parts, or a refusal. Exactly
// clients/<client>/(files|images)/<name> or personal/(files|images)/<name>, of the right type.
function addTargetOf(rel) {
  const segs = pathSegments(rel);
  let scope = null;
  if (segs.length === 4 && segs[0] === 'clients' && Object.hasOwn(ADD_FOLDERS, segs[2])) scope = 'client';
  else if (segs.length === 3 && segs[0] === 'personal' && Object.hasOwn(ADD_FOLDERS, segs[1])) scope = 'personal';
  if (!scope) {
    throw refuse('not-allowed', 'a file can only be added to clients/<client>/files/, clients/<client>/images/, personal/files/ or personal/images/');
  }
  if (isNeverListed(rel)) throw refuse('not-allowed', 'that path is never listed in the library');
  const name = segs[segs.length - 1];
  if (/[\p{Cc}]/u.test(name)) throw refuse('bad-request', 'the file name has a control character in it');
  // NFKC first: the Mac's disk treats look-alikes such as the long s (U+017F) as the plain letter, so
  // "AGENTſ.md" would land as AGENTS.md (security review, release 3).
  if (PROTECTED_NAMES.includes(name.normalize('NFKC').toLowerCase())) throw refuse('not-allowed', `${name} is protected`);
  const folder = segs[segs.length - 2];
  const ext = extOf(name);
  if (!ADD_FOLDERS[folder].includes(ext)) {
    throw refuse('not-allowed', folder === 'images'
      ? `only ${ADD_IMAGE_EXTENSIONS.join(', ')} files go in images/`
      : `only ${ADD_DOCUMENT_EXTENSIONS.join(', ')} files go in files/`);
  }
  // The folder that must already be there (the client's, or personal/), and the one made if missing.
  const home = scope === 'client' ? segs.slice(0, 2) : segs.slice(0, 1);
  return { scope, name, ext, home, folder: segs.slice(0, -1) };
}

// The source's bytes: an absolute path to a regular file (not a link) whose real path is outside the
// brain, at most ADD_MAX_BYTES. Read through one descriptor, so what is checked is what is copied.
function readSource(ctx, source, ext) {
  if (typeof source !== 'string' || source === '' || source.includes('\0') || !path.isAbsolute(source)) {
    throw refuse('bad-request', 'source must be an absolute path');
  }
  if (extOf(path.basename(source)) !== ext) {
    throw refuse('bad-request', `source must be a .${ext} file, like the name it's added under`);
  }
  const st = lstatOrNull(source);
  if (!st) throw refuse('not-found', "source isn't there");
  if (st.isSymbolicLink() || !st.isFile()) throw refuse('not-allowed', "source isn't a regular file");
  const real = fs.realpathSync.native(source);
  const brain = fs.realpathSync.native(ctx.root);
  if (real === brain || real.startsWith(brain + path.sep)) throw refuse('not-allowed', 'source is already in the brain');
  let fd;
  try {
    fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const fst = fs.fstatSync(fd);
    if (!fst.isFile()) throw refuse('not-allowed', "source isn't a regular file");
    if (fst.size > ADD_MAX_BYTES) throw refuse('bad-request', `source is over ${ADD_MAX_BYTES / 1024 / 1024} MB`);
    return fs.readFileSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// The folder `segs` under the brain, there already as a real folder: no link or file on the way,
// and the letters' case as on the disk. Never made here.
function existingFolder(ctx, segs) {
  const rel = segs.join('/');
  for (let i = 1; i <= segs.length; i++) {
    const st = lstatOrNull(path.join(ctx.root, ...segs.slice(0, i)));
    if (!st) throw refuse('not-found', `${rel} isn't there`);
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw refuse('not-allowed', `${segs.slice(0, i).join('/')} isn't a plain folder`);
    }
  }
  requireRealPath(ctx.root, path.join(ctx.root, ...segs), rel);
}

// "name (n).ext" for the nth try (the first is the name itself).
function nameFor(name, n) {
  if (n === 1) return name;
  const dot = name.lastIndexOf('.');
  return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}

// Writes `data` to a hidden temp file in `dir`, then hard-links it to the first free name: `name`, then
// "name (2).ext"… Never over anything. Returns the brain-relative path, or null when no name is free.
function writeNew(ctx, dir, folder, name0, data, gitRule) {
  const tmp = path.join(dir, `.tdsapp-files-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp~`);
  let finalRel = null;
  try {
    const fd = fs.openSync(tmp, 'wx', 0o644);
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    for (let n = 1; n <= ADD_NAME_TRIES && finalRel === null; n++) {
      const name = nameFor(name0, n);
      const candidate = [...folder, name].join('/');
      if (n > 1) {
        if (candidate.length > PATH_MAX) break;
        gitRule(ctx, [candidate]);
      }
      const dest = path.join(dir, name);
      // Never over anything: a hard link fails when the name is taken (in any letter case the disk
      // treats as the same). Where links aren't supported, an exclusive write does the same.
      try {
        fs.linkSync(tmp, dest);
        finalRel = candidate;
      } catch (err) {
        if (errCode(err) === 'EEXIST') continue;
        try {
          fs.writeFileSync(dest, data, { flag: 'wx', mode: 0o644 });
          finalRel = candidate;
        } catch (err2) {
          if (errCode(err2) !== 'EEXIST') throw err2;
        }
      }
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* never made */ }
  }
  return finalRel;
}

function addFile(input, ctx) {
  const rel = input.path;
  const target = addTargetOf(rel);
  const via = displayText(input.via, VIA_MAX) || DEFAULT_VIA;
  const who = whoFor(ctx, input);
  if (target.scope === 'client' && !ROLE_CAN.client.has(who.role)) {
    throw refuse('not-allowed', 'only people on the team in .team-config/roles.json can add client files');
  }
  const data = readSource(ctx, input.source, target.ext);
  existingFolder(ctx, target.home);
  // Checked before anything is made: a client file must reach the team, a personal one never may.
  const gitRule = target.scope === 'client' ? requireNotIgnored : requireIgnored;
  gitRule(ctx, [rel]);
  const dir = plainFolder(path.join(ctx.root, ...target.home), target.folder.slice(target.home.length), 'not-allowed');
  requireRealPath(ctx.root, dir, target.folder.join('/'));
  // Before any change, so a log that can't be written stops the add instead of leaving it unrecorded.
  const logFile = target.scope === 'client' ? logFileFor(ctx, who) : null;

  const finalRel = writeNew(ctx, dir, target.folder, target.name, data, gitRule);
  if (finalRel === null) throw refuse('exists', `no free name for ${rel}`);
  const reply = { ok: true, action: 'add', path: finalRel };
  if (logFile && !appendLog(logFile, logLine(ctx.now, 'add', who, via, 'client', finalRel, data.length, ''))) {
    reply.logged = false;
  }
  return reply;
}

// ---- add-artifact (v0.4) -----------------------------------------------------------------------

// The destination: exactly clients/<client>/projects/<slug>/files/<name>.html or
// personal/projects/<slug>/files/<name>.html. Its own rule; `add`'s is unchanged.
function artifactTargetOf(rel) {
  const segs = pathSegments(rel);
  let scope = null;
  if (segs.length === 6 && segs[0] === 'clients' && segs[2] === 'projects' && segs[4] === 'files') scope = 'client';
  else if (segs.length === 5 && segs[0] === 'personal' && segs[1] === 'projects' && segs[3] === 'files') scope = 'personal';
  if (!scope) {
    throw refuse('not-allowed', 'an artifact can only be added to clients/<client>/projects/<project>/files/ or personal/projects/<project>/files/');
  }
  if (isNeverListed(rel)) throw refuse('not-allowed', 'that path is never listed in the library');
  const name = segs[segs.length - 1];
  if (/[\p{Cc}]/u.test(name)) throw refuse('bad-request', 'the file name has a control character in it');
  if (PROTECTED_NAMES.includes(name.normalize('NFKC').toLowerCase())) throw refuse('not-allowed', `${name} is protected`);
  if (extOf(name) !== 'html') throw refuse('not-allowed', 'an artifact is saved as a .html file');
  // The project folder must already be there; files/ is made if missing.
  return { scope, name, home: segs.slice(0, -2), folder: segs.slice(0, -1) };
}

// Trim, drop any ?query or #fragment, then the claude.ai artifact address pattern. Null otherwise.
function cleanArtifactUrl(input) {
  if (typeof input !== 'string') return null;
  const url = input.trim().split(/[?#]/)[0];
  return ARTIFACT_URL_PATTERN.test(url) ? url : null;
}

// YYYY-MM-DD, a real date.
function isRealDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const pad2 = (n) => String(n).padStart(2, '0');
function localDate(now) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Byte-identical to artifactMetaBlock in the app's shared/pages.ts.
function artifactMetaBlock(meta) {
  return (
    `<meta name="tds-artifact-source" content="${meta.url}">\n` +
    `<meta name="tds-artifact-copied" content="${meta.copied}">\n` +
    `<meta name="tds-artifact-kind" content="${meta.kind}">\n` +
    (meta.partial ? '<meta name="tds-artifact-live" content="partial">\n' : '')
  );
}

// A port of linkScriptOffset in the app's shared/page-links.ts: after a leading doctype (past a BOM,
// whitespace, comments and <?…> bogus comments), else after the BOM. Works on a latin1 reading, where
// the offset is a byte offset.
const BOMS = ['﻿', 'ï»¿'];
const HTML_SPACE = /[\t\n\f\r ]/;
const DOCTYPE = /^<!doctype\b[^>]*>/i;
function commentEnd(html, i) {
  if (html.startsWith('<!-->', i)) return i + 5;
  if (html.startsWith('<!--->', i)) return i + 6;
  const close = html.indexOf('--', i + 4);
  for (let at = close; at !== -1; at = html.indexOf('--', at + 1)) {
    if (html.startsWith('-->', at)) return at + 3;
    if (html.startsWith('--!>', at)) return at + 4;
  }
  return -1;
}
function metaOffset(html) {
  const found = BOMS.find((b) => html.startsWith(b));
  const bom = found ? found.length : 0;
  let i = bom;
  while (i < html.length) {
    const c = html[i];
    if (HTML_SPACE.test(c)) {
      i += 1;
    } else if (html.startsWith('<!--', i)) {
      const end = commentEnd(html, i);
      if (end === -1) return bom;
      i = end;
    } else if (html.startsWith('<?', i)) {
      const end = html.indexOf('>', i);
      if (end === -1) return bom;
      i = end + 1;
    } else {
      const doctype = DOCTYPE.exec(html.slice(i, i + 4096));
      return doctype ? i + doctype[0].length : bom;
    }
  }
  return bom;
}

// The source page's bytes: .html or .htm, outside the brain, a regular file, at most 5 MB (checked by
// size before anything is read), not UTF-16.
function readArtifactSource(ctx, source) {
  if (typeof source !== 'string' || source === '' || source.includes('\0') || !path.isAbsolute(source)) {
    throw refuse('bad-request', 'source must be an absolute path');
  }
  const ext = extOf(path.basename(source));
  if (ext !== 'html' && ext !== 'htm') throw refuse('bad-request', 'source must be a .html or .htm file');
  const st = lstatOrNull(source);
  if (!st) throw refuse('not-found', "source isn't there");
  if (st.isSymbolicLink() || !st.isFile()) throw refuse('not-allowed', "source isn't a regular file");
  if (st.size > ARTIFACT_MAX_BYTES) throw refuse('bad-request', `source is over ${ARTIFACT_MAX_BYTES / 1024 / 1024} MB`);
  const real = fs.realpathSync.native(source);
  const brain = fs.realpathSync.native(ctx.root);
  if (real === brain || real.startsWith(brain + path.sep)) throw refuse('not-allowed', 'source is already in the brain');
  let fd;
  try {
    fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const fst = fs.fstatSync(fd);
    if (!fst.isFile()) throw refuse('not-allowed', "source isn't a regular file");
    if (fst.size > ARTIFACT_MAX_BYTES) throw refuse('bad-request', `source is over ${ARTIFACT_MAX_BYTES / 1024 / 1024} MB`);
    const data = fs.readFileSync(fd);
    if (data.length >= 2 && ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff))) {
      throw refuse('bad-request', 'source is UTF-16; save it as UTF-8 first');
    }
    return data;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function plainText(value, max, what, required) {
  if (value === undefined || value === null || value === '') {
    if (required) throw refuse('bad-request', `${what} is required`);
    return '';
  }
  if (typeof value !== 'string') throw refuse('bad-request', `${what} must be text`);
  if (/[\p{Cc}]/u.test(value)) throw refuse('bad-request', `${what} has a control character in it`);
  const text = value.trim();
  if (required && text === '') throw refuse('bad-request', `${what} is required`);
  if (text.length > max) throw refuse('bad-request', `${what} is over ${max} characters`);
  return text;
}

function linkCard(meta, title, description) {
  const block = artifactMetaBlock({ ...meta, kind: 'link', partial: false });
  const t = escapeHtml(title);
  return `<!doctype html>
${block}<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<style>
:root { color-scheme: light dark; --bg: #f5f7fb; --card: #ffffff; --text: #021B43; --muted: #4a5a78; --line: #d5dbe8; --btn: #021B43; --btn-text: #ffffff; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #021B43; --card: #0b2a5c; --text: #f2f5fb; --muted: #b6c2dc; --line: #27427a; --btn: #f2f5fb; --btn-text: #021B43; }
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { width: 100%; max-width: 32rem; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 24px; }
h1 { margin: 0 0 8px; font-size: 1.5rem; line-height: 1.25; overflow-wrap: anywhere; }
p { margin: 0 0 16px; overflow-wrap: anywhere; }
.muted { color: var(--muted); }
.button { display: inline-block; padding: 12px 20px; border-radius: 8px; background: var(--btn); color: var(--btn-text); font-weight: 600; text-decoration: none; }
.button:focus-visible { outline: 3px solid currentColor; outline-offset: 3px; }
.added { margin: 16px 0 0; font-size: 0.875rem; }
</style>
</head>
<body>
<main>
<h1>${t}</h1>
${description ? `<p>${escapeHtml(description)}</p>\n` : ''}<p class="muted">This is a link to a page on claude.ai. Open it there to see it.</p>
<p><a class="button" href="${meta.url}" target="_blank" rel="noopener noreferrer">Open on claude.ai</a></p>
<p class="added muted">Added ${longDate(meta.copied)}</p>
</main>
</body>
</html>
`;
}

function addArtifact(input, ctx) {
  const rel = input.path;
  const target = artifactTargetOf(rel);
  const url = cleanArtifactUrl(input.url);
  if (!url) throw refuse('bad-request', 'url must be a claude.ai artifact address, such as https://claude.ai/artifact/<id>');
  const hasSource = input.source !== undefined && input.source !== null && input.source !== '';
  const title = plainText(input.title, ARTIFACT_TITLE_MAX, 'title', !hasSource);
  const description = plainText(input.description, ARTIFACT_DESCRIPTION_MAX, 'description', false);
  const partial = input.partial === undefined ? false : input.partial;
  if (typeof partial !== 'boolean') throw refuse('bad-request', 'partial must be true or false');
  if (partial && !hasSource) throw refuse('bad-request', 'partial only goes with a source');
  let copied = localDate(ctx.now);
  if (input.copied !== undefined && input.copied !== null && input.copied !== '') {
    if (typeof input.copied !== 'string' || !isRealDate(input.copied)) throw refuse('bad-request', 'copied must be a real date, YYYY-MM-DD');
    copied = input.copied;
  }
  const via = displayText(input.via, VIA_MAX) || DEFAULT_VIA;
  const who = whoFor(ctx, input);
  if (target.scope === 'client' && !ROLE_CAN.client.has(who.role)) {
    throw refuse('not-allowed', 'only people on the team in .team-config/roles.json can add client files');
  }
  let data;
  if (hasSource) {
    const source = readArtifactSource(ctx, input.source).toString('latin1');
    const at = metaOffset(source);
    const block = artifactMetaBlock({ url, copied, kind: 'copy', partial });
    data = Buffer.from(source.slice(0, at) + block + source.slice(at), 'latin1');
  } else {
    data = Buffer.from(linkCard({ url, copied }, title, description), 'utf8');
  }
  existingFolder(ctx, target.home);
  // A live project only: the folder must have its card (a plain project.md, never a link or a folder).
  const card = lstatOrNull(path.join(ctx.root, ...target.home, 'project.md'));
  if (!card || !card.isFile()) throw refuse('not-found', `${target.home.join('/')} has no project card (project.md)`);
  const gitRule = target.scope === 'client' ? requireNotIgnored : requireIgnored;
  gitRule(ctx, [rel]);
  const dir = plainFolder(path.join(ctx.root, ...target.home), target.folder.slice(target.home.length), 'not-allowed');
  requireRealPath(ctx.root, dir, target.folder.join('/'));
  const logFile = target.scope === 'client' ? logFileFor(ctx, who) : null;
  const finalRel = writeNew(ctx, dir, target.folder, target.name, data, gitRule);
  if (finalRel === null) throw refuse('exists', `no free name for ${rel}`);
  const reply = { ok: true, action: 'add-artifact', path: finalRel, kind: hasSource ? 'copy' : 'link' };
  if (logFile && !appendLog(logFile, logLine(ctx.now, 'add', who, via, 'client', finalRel, data.length, ''))) {
    reply.logged = false;
  }
  return reply;
}

function capabilities() {
  return { ok: true, action: 'capabilities', version: SCRIPT_VERSION, features: [FILES_CAPABILITY, ADD_CAPABILITY, ARTIFACT_CAPABILITY] };
}

// ---- command line ------------------------------------------------------------------------------

const ACTIONS = { delete: deleteFile, restore, purge, 'list-deleted': listDeleted, add: addFile, 'add-artifact': addArtifact, capabilities };

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
  addFile,
  addArtifact,
  cleanArtifactUrl,
  artifactMetaBlock,
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
  PROJECT_PROTECTED_NAMES,
  FILES_CAPABILITY,
  ADD_CAPABILITY,
  ARTIFACT_CAPABILITY,
  ARTIFACT_MAX_BYTES,
  ADD_MAX_BYTES,
  ADD_IMAGE_EXTENSIONS,
  ADD_DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  LIBRARY_EXTENSIONS,
};
