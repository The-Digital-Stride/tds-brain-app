#!/usr/bin/env node
// tdsapp-todo.cjs (v0.3) — change one loose to-do in todo/, the way the Workbench does, with fixes.
//
// A dependency-free port of the Workbench's to-do routes (tools/members/command-centre/server.cjs:
// /api/todos/add, /edit, /due, /assignee, /delete, /tick, /roster and /api/misc-todos, with
// lib/todo-parser.cjs). File names, frontmatter lines, success bodies and error texts are the
// Workbench's. The plan behind v0.3 is the app repo's docs/plans/2026-11-13-todo-skill-fixes.md; the
// weak spots it fixes are in the brain's os/tds-brain-app/change-requests.md (BCR-xx below).
//
// Differences from the Workbench:
//   - delete keeps the to-do in todo/deleted/, stamped with who, when and from where (BCR-05).
//   - tick stamps the to-do as the TDS Brain App does: status: done, completed, completed_at,
//     completed_by, completed_via and a "## Done" note, from `by`, `by_name`, `via` (BCR-09).
//   - `expect` (edit, due, assignee, delete, tick): the hex SHA-256 of the file's bytes the caller
//     read; if the file differs now → 409 "changed since read", nothing written (BCR-01). `list`
//     entries carry that fingerprint as `version`.
//   - Over-long title (200), details (8000) or assignee (40) are refused, not cut (BCR-02).
//   - Titles that YAML would misread are quoted, when that needs no escapes (BCR-03).
//   - A real title change is recorded under "## Title history", and the first "#" heading follows
//     the title only when it matched the old one (BCR-04/16, todo/AGENTS.md).
//   - add: `open: true` adds it open to anyone (BCR-06); `via` names the tool, written as
//     `source: added from <via>`, else `source: added with the todo skill` (BCR-13); the new name
//     is also free in todo/done/ and todo/deleted/ (BCR-14).
//   - An explicit assignee must be on the team in .team-config/roles.json, by either slug rule,
//     unless that file is missing, unreadable or has no names (BCR-07).
//   - CRLF line endings (taken from the first line break) and a UTF-8 BOM are kept (BCR-11).
//   - CLAUDE.md, README.md and AGENTS.md are refused in any letter case (BCR-12).
//   - Writes go to `.tdsapp-todo-<pid>-<random>.tmp~` in the same folder (fsynced, the original's
//     mode kept), then rename over the original; new files are hard-linked into place, so they
//     never overwrite. Symbolic links and files without write permission are refused (BCR-15).
//   - Due dates must be real calendar dates (BCR-17).
//
// Usage:
//   echo '<json>' | node .claude/skills/tdsapp-todo/scripts/tdsapp-todo.cjs <command>
//
//   <command>  add | edit | due | assignee | delete | tick | roster | list
//   stdin      one JSON object: the Workbench route's request body, same field names (file, title,
//              body, due, assignee), plus the optional fields above. roster and list need none ({}).
//   stdout     one JSON line.
//   exit 0     the success body (no `status`).
//   exit 2     the error body plus `status` (400, 404, 409 or 500).
//              Invalid JSON, a non-object or an unknown command → 400.
//
// Brain root: BRAIN_ROOT, else four levels up from this file (scripts → tdsapp-todo → skills →
// .claude → brain), so the old `todo` shim that requires this file still finds the brain.
// `list` honours WORKBENCH_AS (as the Workbench's /api/misc-todos does); `add` does not.
//
// Test hook: with NODE_ENV=test, TDSAPP_TODO_TEST_FAIL="<op>:<CODE>[:<times>],..." makes `link` or
// `rename` fail with that error code (every time, or the first <times> times). It is ignored
// otherwise, and the app's scrubbed environment never sets it.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BRAIN_ROOT = process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
const TODO_DIR = path.join(BRAIN_ROOT, 'todo');

// WORKBENCH_AS=<name-slug> previews another person's list (server.cjs VIEW_AS).
const VIEW_AS = /^[a-z0-9-]+$/.test(process.env.WORKBENCH_AS || '') ? process.env.WORKBENCH_AS : null;

const TITLE_MAX = 200;
const DETAILS_MAX = 8000;
const ASSIGNEE_MAX = 40;
const VIA_MAX = 60;
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.md$/;
const RULES_FILES = new Set(['claude.md', 'readme.md', 'agents.md']);

// The response being built: mirrors Express's res.status(n).json(body).
class Reply {
  constructor() { this.code = 200; this.body = null; }
  status(code) { this.code = code; return this; }
  json(body) { this.body = body; return this; }
  // res.set('Cache-Control', ...) on the Workbench; nothing to set here.
  set() { return this; }
}

// A refusal with its HTTP-style status, thrown by the checks and turned into the error body.
class Refusal extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---- lib/todo-parser.cjs ----------------------------------------------------

function parseFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { frontmatter: {}, body: content };
  }
  const lines = content.split(/\r?\n/);
  // Find the closing --- (skip line 0 which is the opener).
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { closeIdx = i; break; }
  }
  if (closeIdx === -1) return { frontmatter: {}, body: content };

  const fm = {};
  for (let i = 1; i < closeIdx; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    // Strip surrounding quotes.
    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[m[1]] = value;
  }
  const body = lines.slice(closeIdx + 1).join('\n').replace(/^\n+/, '');
  return { frontmatter: fm, body };
}

function getMiscTodos() {
  if (!fs.existsSync(TODO_DIR)) return [];

  const entries = fs.readdirSync(TODO_DIR, { withFileTypes: true })
    .filter(e => e.isFile()
      && e.name.endsWith('.md')
      && e.name !== 'CLAUDE.md'
      && e.name !== 'AGENTS.md'
      && e.name !== 'README.md')
    .map(e => {
      const abs = path.join(TODO_DIR, e.name);
      const stat = fs.statSync(abs);
      if (stat.size === 0) return null;
      // One read: the fingerprint is of these bytes, the text is decoded from them (BCR-01).
      const bytes = fs.readFileSync(abs);
      const content = stripBom(bytes.toString('utf8'));
      const { frontmatter, body } = parseFrontmatter(content);

      // Title fallback chain: frontmatter.title → first H1 → file basename.
      let title = frontmatter.title;
      if (!title) {
        const h1 = body.match(/^#\s+(.+?)\s*$/m);
        title = h1 ? h1[1] : e.name.replace(/\.md$/, '');
      }

      return {
        title,
        created: frontmatter.created || null,
        due: frontmatter.due || null,
        source: frontmatter.source || null,
        assignee: frontmatter.assignee || null,
        project: frontmatter.project || null,
        body: body.trim(),
        file: e.name,
        mtime: stat.mtime.toISOString(),
        version: sha256(bytes),
      };
    })
    .filter(Boolean);

  // Sort: items with due dates first (soonest first), then by created desc.
  entries.sort((a, b) => {
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due && !b.due) return -1;
    if (!a.due && b.due) return 1;
    const ac = a.created || a.mtime;
    const bc = b.created || b.mtime;
    return bc.localeCompare(ac);
  });

  return entries;
}

// ---- shared helpers -----------------------------------------------------------

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function stripBom(text) {
  return text.startsWith('﻿') ? text.slice(1) : text;
}

// The line ending a file uses, from its first line break (BCR-11).
function detectEol(text) {
  const i = text.indexOf('\n');
  return i > 0 && text[i - 1] === '\r' ? '\r\n' : '\n';
}

// A file's text with its BOM and line ending set aside, so edits work on plain \n lines.
function decodeFile(bytes) {
  const raw = bytes.toString('utf8');
  const bom = raw.startsWith('﻿') ? '﻿' : '';
  const src = bom ? raw.slice(1) : raw;
  return { shape: { bom, eol: detectEol(src) }, text: src.replace(/\r\n/g, '\n') };
}

// Back to the file's own BOM and line ending.
function encodeFile(shape, text) {
  return shape.bom + (shape.eol === '\n' ? text : text.replace(/\n/g, shape.eol));
}

// The Workbench's slug rule: every run of other characters becomes one dash.
function workbenchSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The rule in todo/AGENTS.md and tools/whoami.cjs: spaces become dashes, other characters go.
function whoamiSlug(value) {
  return String(value).toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
}

function gitUserName() {
  try {
    const out = spawnSync('git', ['config', 'user.name'], { cwd: BRAIN_ROOT, encoding: 'utf8', timeout: 3000 });
    return ((out && out.stdout) || '').trim();
  } catch {
    return '';
  }
}

// This machine's own slug, derived from `git config user.name` the same way
// the todo-creation endpoint stamps `assignee:`. Empty string if git identity isn't set.
function currentUserSlug() {
  if (VIEW_AS) return VIEW_AS;
  return workbenchSlug(gitUserName());
}

// Every slug a team member can go by: each name by both slug rules (BCR-07, BCR-20).
// Null when roles.json is missing, unreadable or names nobody, so anything is accepted.
function teamSlugs() {
  try {
    const raw = fs.readFileSync(path.join(BRAIN_ROOT, '.team-config', 'roles.json'), 'utf8');
    const members = JSON.parse(raw).members;
    if (!Array.isArray(members)) return null;
    const slugs = new Set();
    for (const m of members) {
      if (!m || typeof m.name !== 'string') continue;
      slugs.add(workbenchSlug(m.name));
      slugs.add(whoamiSlug(m.name));
    }
    slugs.delete('');
    return slugs.size > 0 ? slugs : null;
  } catch {
    return null;
  }
}

// ---- request checks -------------------------------------------------------------

function fileOf(body) {
  const file = String(body.file || '');
  if (!FILE_PATTERN.test(file) || RULES_FILES.has(file.toLowerCase())) {
    throw new Refusal(400, 'invalid todo file');
  }
  return file;
}

function titleOf(body) {
  const title = String(body.title || '').replace(/[\r\n]+/g, ' ').trim();
  if (!title) throw new Refusal(400, 'title is required');
  if (title.length > TITLE_MAX) throw new Refusal(400, `title is too long (over ${TITLE_MAX} characters)`);
  return title;
}

function isRealDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days;
}

function dueOf(body) {
  const due = String(body.due || '');
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Refusal(400, 'due must be YYYY-MM-DD');
  if (due && !isRealDate(due)) throw new Refusal(400, 'due must be a real date');
  return due;
}

// An explicit assignee, slugged; '' for none.
function assigneeOf(body) {
  const slug = workbenchSlug(body.assignee);
  if (slug.length > ASSIGNEE_MAX) {
    throw new Refusal(400, `assignee is too long (over ${ASSIGNEE_MAX} characters)`);
  }
  if (slug) {
    const team = teamSlugs();
    if (team && !team.has(slug)) throw new Refusal(400, 'assignee is not on the team: ' + slug);
  }
  return slug;
}

// The fingerprint the caller read, lower-cased; null when not sent.
function expectOf(body) {
  const value = body.expect;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Refusal(400, 'expect must be a hex SHA-256');
  }
  return value.toLowerCase();
}

// One line of plain text: control characters and line breaks become single spaces.
function oneLine(value) {
  return String(value == null ? '' : value).replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ').trim();
}

function viaOf(body) {
  return oneLine(body.via).slice(0, VIA_MAX);
}

// ---- reading and writing files (BCR-15) ---------------------------------------------

// The to-do to change: checked, read once, and compared with `expect` before anything is written.
// `rewrite`: it will be replaced in place (edit, due, assignee), so it must be writable; tick and
// delete only remove it, which works on a read-only file today and still does.
function openTodo(file, expect, rewrite) {
  const abs = path.join(TODO_DIR, file);
  if (!fs.existsSync(abs)) throw new Refusal(404, 'todo not found: ' + file);
  const stat = fs.lstatSync(abs);
  // rename would replace a link or a read-only file, where the Workbench wrote through the link
  // or failed; refuse first. A link is refused for tick and delete too: never copy what it points at.
  if (stat.isSymbolicLink()) throw new Refusal(500, 'todo is a symbolic link: ' + file);
  if (rewrite) {
    try {
      fs.accessSync(abs, fs.constants.W_OK);
    } catch {
      throw new Refusal(500, 'todo is not writable: ' + file);
    }
  }
  const bytes = fs.readFileSync(abs);
  if (expect && sha256(bytes) !== expect) throw new Refusal(409, 'changed since read');
  return { abs, bytes, mode: stat.mode & 0o7777, ...decodeFile(bytes) };
}

const TEMP_PATTERN = /^\.tdsapp-todo-\d+-[0-9a-f]+\.tmp~$/;
const TEMP_MAX_AGE_MS = 10 * 60_000;

// The test hook (see the header). Each entry: { code, left }.
const FAILS = {};
if (process.env.NODE_ENV === 'test') {
  for (const part of String(process.env.TDSAPP_TODO_TEST_FAIL || '').split(',')) {
    const [op, code, times] = part.split(':');
    if (op && code) FAILS[op] = { code, left: times ? Number(times) : Infinity };
  }
}
function injectedFailure(op) {
  const fail = FAILS[op];
  if (!fail || fail.left <= 0) return;
  fail.left -= 1;
  const err = new Error(`${op} failed (test hook): ${fail.code}`);
  err.code = fail.code;
  throw err;
}
const io = {
  link(from, to) { injectedFailure('link'); fs.linkSync(from, to); },
  rename(from, to) { injectedFailure('rename'); fs.renameSync(from, to); },
};

// Removes this script's temporary files older than 10 minutes (left by a crash), once per folder.
const swept = new Set();
function sweepTemps(dir) {
  if (swept.has(dir)) return;
  swept.add(dir);
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  const cutoff = Date.now() - TEMP_MAX_AGE_MS;
  for (const name of names) {
    if (!TEMP_PATTERN.test(name)) continue;
    const p = path.join(dir, name);
    try {
      const stat = fs.lstatSync(p);
      if (stat.isFile() && stat.mtimeMs < cutoff) fs.unlinkSync(p);
    } catch { /* gone already, or not ours to remove */ }
  }
}

// Writes `data` to a new temporary file in `dir`, synced to disk. Removed again on failure.
function writeTemp(dir, data, mode) {
  sweepTemps(dir);
  const tmp = path.join(dir, `.tdsapp-todo-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp~`);
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'wx', 0o666);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (mode !== undefined) fs.chmodSync(tmp, mode);
    return tmp;
  } catch (err) {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* already failing */ } }
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function syncDir(dir) {
  let fd = null;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch { /* not supported everywhere; the rename is still all-or-nothing */ }
  if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
}

// Replaces an existing to-do all at once, keeping its permissions. Skips an unchanged file.
function replaceTodo(todo, text) {
  const data = encodeFile(todo.shape, text);
  if (Buffer.from(data, 'utf8').equals(todo.bytes)) return;
  const dir = path.dirname(todo.abs);
  const tmp = writeTemp(dir, data, todo.mode);
  try {
    io.rename(tmp, todo.abs);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  syncDir(dir);
}

// Creates a new file all at once. Fails with EEXIST rather than overwrite anything.
function createFile(abs, data) {
  const dir = path.dirname(abs);
  const tmp = writeTemp(dir, data);
  try {
    try {
      io.link(tmp, abs);
    } catch (err) {
      if (err.code === 'EEXIST') throw err;
      // No hard links here (some file systems): the Workbench's exclusive write, as before.
      fs.writeFileSync(abs, data, { encoding: 'utf8', flag: 'wx' });
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  syncDir(dir);
}

// The closing `---` of a frontmatter block (lines split on \n), or -1.
function closingLine(lines) {
  for (let i = 1; i < lines.length; i++) { if (lines[i] === '---') return i; }
  return -1;
}

// ---- titles (BCR-03, BCR-04/16) -------------------------------------------------------

const YAML_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;
const YAML_OTHER_TYPES = [
  /^(?:true|false|yes|no|on|off|null|~)$/i,
  /^[-+]?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][-+]?\d+)?$/,
  /^0[xob][0-9a-fA-F_]+$/i,
  /^[-+]?\.(?:inf|nan)$/i,
  /^[-+]?\d[\d_]*(?::[0-5]?\d)+(?:\.\d*)?$/,
  /^\d{4}-\d{1,2}-\d{1,2}(?:(?:[Tt]|\s+)\d.*)?$/,
];

function needsQuotes(value) {
  return YAML_INDICATOR.test(value)
    || value.includes(': ')
    || value.includes(' #')
    || value.endsWith(':')
    || YAML_OTHER_TYPES.some(re => re.test(value));
}

// A one-line frontmatter value. Quoted only when YAML would misread it, and only in a way that
// needs no escapes, since none of the brain's readers unescape. A value that starts with a quote
// mark is double-quoted even when it holds one, so every reader still strips the outer pair.
function yamlText(value) {
  if (!needsQuotes(value)) return value;
  if (!value.includes('"') && !value.includes('\\')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  if (value.startsWith('"') || value.startsWith("'")) return `"${value}"`;
  return value;
}

// A frontmatter value as the brain's readers see it: one pair of matching quotes stripped.
function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

// Indexes of the lines outside ``` and ~~~ code fences.
function linesOutsideFences(lines) {
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      continue;
    }
    if (m) { fence = m[1]; continue; }
    out.push(i);
  }
  return out;
}

function firstHeading(lines) {
  for (const i of linesOutsideFences(lines)) {
    const m = lines[i].match(/^#\s+(.+?)\s*$/);
    if (m) return { index: i, text: m[1] };
  }
  return null;
}

// Case, spaces and punctuation set aside: a change of only these is "small rewording".
function normalTitle(value) {
  return String(value).toLowerCase().replace(/[\p{P}\p{S}]+/gu, '').replace(/\s+/g, ' ').trim();
}

// Adds `entry` at the end of the "## Title history" section, making the section if needed.
function addTitleHistory(lines, entry) {
  const outside = linesOutsideFences(lines);
  const at = outside.find(i => /^##\s+Title history\s*$/i.test(lines[i]));
  if (at === undefined) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', '## Title history', '', entry, '');
    return;
  }
  let end = lines.length;
  for (const i of outside) {
    if (i > at && /^#{1,2}\s/.test(lines[i])) { end = i; break; }
  }
  let last = end - 1;
  while (last > at && lines[last].trim() === '') last--;
  if (last === at) lines.splice(at + 1, 0, '', entry);
  else lines.splice(last + 1, 0, entry);
}

// The body lines after a title change, following todo/AGENTS.md "Keeping the title accurate".
function retitleBody(lines, oldTitle, newTitle) {
  if (!oldTitle || newTitle === oldTitle) return lines;
  const out = lines.slice();
  const heading = firstHeading(out);
  if (heading && heading.text !== newTitle && normalTitle(heading.text) === normalTitle(oldTitle)) {
    out[heading.index] = '# ' + newTitle;
  }
  if (normalTitle(newTitle) !== normalTitle(oldTitle)) {
    addTitleHistory(out, `- ${ukTime(new Date()).date}: was "${oldTitle}"`);
  }
  return out;
}

// ---- server.cjs routes ------------------------------------------------------

// GET /api/misc-todos
function list(body, res) {
  try {
    const me = currentUserSlug();
    // The viewer's own todos plus any unassigned ("open") ones. If we can't
    // resolve an identity, fall back to showing everything.
    const all = getMiscTodos();
    const todos = me
      ? all.filter(t => !t.assignee || t.assignee === me)
      : all;
    res.set('Cache-Control', 'no-store').json({ todos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/todos/roster: slugified names from .team-config/roles.json. [] if absent.
function roster(body, res) {
  try {
    const raw = fs.readFileSync(path.join(BRAIN_ROOT, '.team-config', 'roles.json'), 'utf8');
    const members = (JSON.parse(raw).members || [])
      .map(m => ({ slug: workbenchSlug(m.name), name: m.name }))
      .filter(m => m.slug);
    res.set('Cache-Control', 'no-store').json({ members });
  } catch {
    res.set('Cache-Control', 'no-store').json({ members: [] });
  }
}

// POST /api/todos/add: writes todo/YYYYMMDD-<slug>.md with the standard frontmatter.
// Assignee defaults to this machine's git user (slugified); `open: true` leaves it open.
function add(body, res) {
  const title = titleOf(body);
  const due = dueOf(body);
  const open = body.open === true;
  let assignee = open ? '' : assigneeOf(body);
  const via = viaOf(body);

  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // No git identity → leave the todo open. The default is not checked against the team.
  if (!assignee && !open) assignee = workbenchSlug(gitUserName());

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'todo';
  fs.mkdirSync(TODO_DIR, { recursive: true });
  const fm = ['---'];
  if (assignee) fm.push('assignee: ' + assignee);
  fm.push('title: ' + yamlText(title), 'created: ' + today);
  if (due) fm.push('due: ' + due);
  fm.push('source: ' + yamlText(via ? `added from ${via}` : 'added with the todo skill'), '---', '');
  const text = fm.join('\n');

  const stem = `${today.replace(/-/g, '')}-${slug}`;
  for (let n = 1; ; n++) {
    const file = n === 1 ? `${stem}.md` : `${stem}-${n}.md`;
    // Free in todo/, todo/done/ and todo/deleted/, so it can be ticked or deleted later (BCR-14).
    if (['', 'done', 'deleted'].some(sub => fs.existsSync(path.join(TODO_DIR, sub, file)))) continue;
    try {
      createFile(path.join(TODO_DIR, file), text);
      return res.json({ ok: true, file });
    } catch (err) {
      // Another writer took the name between the check and the link: try the next one.
      if (err.code !== 'EEXIST' || n >= 1000) throw err;
    }
  }
}

// POST /api/todos/due: rewrites the `due:` line (adds a frontmatter block if none).
function due(body, res) {
  const file = fileOf(body);
  const due = dueOf(body);
  const todo = openTodo(file, expectOf(body), true);
  let content = todo.text;
  if (/^---\n/.test(content)) {
    const lines = content.split('\n');
    const close = closingLine(lines);
    if (close === -1) throw new Refusal(500, 'unterminated frontmatter in ' + file);
    let idx = -1;
    for (let i = 1; i < close; i++) { if (/^due:/.test(lines[i])) { idx = i; break; } }
    if (idx !== -1) { if (due) lines[idx] = 'due: ' + due; else lines.splice(idx, 1); }
    else if (due) lines.splice(close, 0, 'due: ' + due);
    content = lines.join('\n');
  } else if (due) {
    content = `---\ndue: ${due}\n---\n\n` + content;
  }
  replaceTodo(todo, content);
  res.json({ ok: true, file, due: due || null });
}

// POST /api/todos/assignee: rewrites the `assignee:` line (adds one if missing;
// clearing removes it, which leaves the todo open).
function assignee(body, res) {
  const file = fileOf(body);
  const assignee = assigneeOf(body);
  const todo = openTodo(file, expectOf(body), true);
  let content = todo.text;
  if (/^---\n/.test(content)) {
    const lines = content.split('\n');
    const close = closingLine(lines);
    if (close === -1) throw new Refusal(500, 'unterminated frontmatter in ' + file);
    let idx = -1;
    for (let i = 1; i < close; i++) { if (/^assignee:/.test(lines[i])) { idx = i; break; } }
    if (idx !== -1) { if (assignee) lines[idx] = 'assignee: ' + assignee; else lines.splice(idx, 1); }
    else if (assignee) lines.splice(1, 0, 'assignee: ' + assignee);
    content = lines.join('\n');
  } else if (assignee) {
    content = `---\nassignee: ${assignee}\n---\n\n` + content;
  }
  replaceTodo(todo, content);
  res.json({ ok: true, file, assignee: assignee || null });
}

// POST /api/todos/edit: rewrites the `title:` line (adds one if missing; creates a
// frontmatter block if none). A string `body` replaces everything below the frontmatter.
// A real title change also follows todo/AGENTS.md (see retitleBody). The reply's `body` is the
// details as written, title history included.
function edit(body, res) {
  const file = fileOf(body);
  const title = titleOf(body);
  // Optional: the long description. Omit the field to leave the body alone.
  const hasBody = typeof body.body === 'string';
  const newBody = hasBody ? body.body.replace(/\r\n/g, '\n').trim() : null;
  if (hasBody && newBody.length > DETAILS_MAX) {
    throw new Refusal(400, `details are too long (over ${DETAILS_MAX} characters)`);
  }
  const todo = openTodo(file, expectOf(body), true);
  const titleLine = 'title: ' + yamlText(title);
  let headLines = null; // the frontmatter lines, when the file has a block
  let prefix = ''; // else the new block put in front
  let oldBody;
  let newBodyLines;
  let oldTitle = '';
  if (/^---\n/.test(todo.text)) {
    const lines = todo.text.split('\n');
    let close = closingLine(lines);
    if (close === -1) throw new Refusal(500, 'unterminated frontmatter in ' + file);
    let idx = -1;
    for (let i = 1; i < close; i++) { if (/^title:/.test(lines[i])) { idx = i; break; } }
    if (idx !== -1) {
      oldTitle = unquote(lines[idx].slice('title:'.length));
      lines[idx] = titleLine;
    } else {
      lines.splice(1, 0, titleLine);
      close++;
    }
    headLines = lines.slice(0, close + 1);
    oldBody = lines.slice(close + 1);
    newBodyLines = newBody ? ['', ...newBody.split('\n'), ''] : [''];
  } else {
    prefix = `---\n${titleLine}\n---\n\n`;
    oldBody = todo.text.split('\n');
    newBodyLines = hasBody ? [...newBody.split('\n'), ''] : null;
  }
  if (!oldTitle) {
    const heading = firstHeading(oldBody);
    oldTitle = heading ? heading.text : '';
  }
  const bodyLines = retitleBody(hasBody ? newBodyLines : oldBody, oldTitle, title);
  replaceTodo(todo, headLines ? [...headLines, ...bodyLines].join('\n') : prefix + bodyLines.join('\n'));
  res.json({ ok: true, file, title, body: hasBody ? bodyLines.join('\n').trim() : undefined });
}

// ---- tick and delete: stamped, then moved (BCR-05, BCR-09) -----------------------------
//
// The Workbench's tick only moved the file to todo/done/, and its delete removed it for good.
// Here both write a stamped copy (todo/done/ or todo/deleted/) and then remove the original, so
// there is a record of who, when and from where. The tick record is the TDS Brain App's own
// (server/brain/done-record.ts stampDone); the delete record mirrors it.

const DONE_KEY_LINE = /^(?:status|completed|completed_at|completed_by|completed_via)\s*:/;
const DELETED_KEY_LINE = /^(?:status|deleted|deleted_at|deleted_by|deleted_via)\s*:/;

// A YAML value safe on one line: plain when simple, double-quoted otherwise.
function yamlValue(value) {
  if (/^[A-Za-z0-9][A-Za-z0-9 ._()/+-]*$/.test(value)) return value;
  return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}
// The date, clock time and UTC offset in the UK at that instant (GMT in winter, BST in summer).
function ukTime(at) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMin = Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  const abs = Math.abs(offsetMin);
  const two = (n) => String(n).padStart(2, '0');
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    seconds: p.second || '00',
    offset: `${offsetMin < 0 ? '-' : '+'}${two(Math.floor(abs / 60))}:${two(abs % 60)}`,
  };
}
// Who is acting: the caller's `by` (slug) and `by_name` when sent (the app sends its signed-in
// identity), else this machine's git user.name, as `add` and `list` use for "me".
function actor(body) {
  const slug = workbenchSlug(oneLine(body.by));
  if (slug) return { slug, name: oneLine(body.by_name).slice(0, 80) || slug };
  const name = oneLine(gitUserName());
  return { name: name || 'unknown', slug: workbenchSlug(name) || 'unknown' };
}

// The to-do's text with a record added: in the frontmatter (for tools, replacing earlier values of
// the same keys) and in a short section at the end (for people). Everything else is kept.
function stampRecord(text, keyLine, record, footer) {
  const raw = String(text == null ? '' : text);
  const bom = raw.startsWith('﻿') ? '﻿' : '';
  const src = bom ? raw.slice(1) : raw;
  const eol = detectEol(src);
  const lines = src === '' ? [] : src.split(/\r\n|\n/);
  let close = -1;
  if (lines.length > 0 && lines[0].trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') { close = i; break; }
    }
  }
  let out;
  if (close === -1) {
    out = ['---', ...record, '---', ...lines];
  } else {
    const head = [];
    let dropping = false;
    for (const line of lines.slice(1, close)) {
      if (keyLine.test(line)) { dropping = true; continue; }
      // ... and the rest of its value: indented lines, blank lines and "- item" lines.
      if (dropping && (line.trim() === '' || /^\s/.test(line) || /^-\s/.test(line))) continue;
      dropping = false;
      head.push(line);
    }
    out = ['---', ...head, ...record, '---', ...lines.slice(close + 1)];
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  out.push('', ...footer, '');
  return bom + out.join(eol);
}

function stampDone(text, by, via, at) {
  const when = ukTime(at);
  return stampRecord(text, DONE_KEY_LINE, [
    'status: done',
    `completed: ${when.date}`,
    `completed_at: ${when.date}T${when.time}:${when.seconds}${when.offset}`,
    `completed_by: ${workbenchSlug(by.slug) || 'unknown'}`,
    `completed_via: ${yamlValue(via)}`,
  ], [`## Done ${when.date}`, '', `Ticked off by ${by.name} at ${when.time} UK time (${via}).`]);
}

function stampDeleted(text, by, via, at) {
  const when = ukTime(at);
  return stampRecord(text, DELETED_KEY_LINE, [
    'status: deleted',
    `deleted: ${when.date}`,
    `deleted_at: ${when.date}T${when.time}:${when.seconds}${when.offset}`,
    `deleted_by: ${by.slug}`,
    `deleted_via: ${yamlValue(via)}`,
  ], [`## Deleted ${when.date}`, '', `Deleted by ${by.name} at ${when.time} UK time (${via}).`]);
}

// Writes the stamped copy into todo/<folder>/ (never over an earlier one: a clash gets a
// timestamp suffix), then removes the original. If that fails, the copy goes too.
function moveStamped(body, res, folder, stamp) {
  const file = fileOf(body);
  const todo = openTodo(file, expectOf(body), false);
  const via = viaOf(body) || 'todo skill';
  const stamped = stamp(todo.bytes.toString('utf8'), actor(body), via, new Date());
  const dir = path.join(TODO_DIR, folder);
  fs.mkdirSync(dir, { recursive: true });
  let dest = path.join(dir, file);
  try {
    createFile(dest, stamped);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    dest = path.join(dir, file.replace(/\.md$/, `-${Date.now()}.md`));
    createFile(dest, stamped);
  }
  try {
    fs.unlinkSync(todo.abs);
  } catch (err) {
    // Never leave the to-do both open and finished (or deleted).
    fs.rmSync(dest, { force: true });
    throw err;
  }
  res.json({ ok: true, file, moved: path.relative(BRAIN_ROOT, dest) });
}

// tick: { file, expect?, via?, by?, by_name? } → todo/done/, stamped as the app's own tick.
function tick(body, res) {
  moveStamped(body, res, 'done', stampDone);
}

// delete: { file, expect?, via?, by?, by_name? } → todo/deleted/, stamped.
function remove(body, res) {
  moveStamped(body, res, 'deleted', stampDeleted);
}

// ---- command line -----------------------------------------------------------

const COMMANDS = { add, edit, due, assignee, delete: remove, tick, roster, list };

function finish(code, body) {
  const out = code === 200 ? body : Object.assign({}, body, { status: code });
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exitCode = code === 200 ? 0 : 2;
}

function run(command, raw) {
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, command)) {
    return finish(400, { error: 'unknown command' });
  }
  let body;
  try {
    body = raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    return finish(400, { error: 'invalid JSON' });
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return finish(400, { error: 'invalid JSON' });
  }
  const res = new Reply();
  try {
    COMMANDS[command](body, res);
  } catch (err) {
    res.status(err instanceof Refusal ? err.status : 500).json({ error: err.message });
  }
  return finish(res.code, res.body);
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
