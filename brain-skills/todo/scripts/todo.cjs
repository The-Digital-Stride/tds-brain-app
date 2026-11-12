#!/usr/bin/env node
// todo.cjs — change one loose to-do in todo/, exactly as the Workbench does.
//
// A faithful, dependency-free port of the Workbench's to-do routes
// (tools/members/command-centre/server.cjs: /api/todos/add, /edit, /due, /assignee,
// /delete, /tick, /roster and /api/misc-todos, with lib/todo-parser.cjs). Regexes,
// limits, frontmatter edits, success bodies and error texts are copied as they are,
// weak spots included: fixing them is the brain guardian's call, not this script's.
// One deliberate exception (BCR-05, at Ian's request): `delete` keeps the to-do in
// todo/deleted/ with who, when and from where, instead of removing it.
//
// Usage:
//   echo '<json>' | node .claude/skills/todo/scripts/todo.cjs <command>
//
//   <command>  add | edit | due | assignee | delete | tick | roster | list
//   stdin      one JSON object: the Workbench route's request body, same field names
//              (file, title, body, due, assignee; delete also takes via). roster and list need none ({}).
//   stdout     one JSON line.
//   exit 0     the Workbench route's success body (no `status`).
//   exit 2     the Workbench route's error body plus `status` (400, 404 or 500).
//              Invalid JSON, a non-object or an unknown command → 400.
//
// Brain root: BRAIN_ROOT, else four levels up (scripts → todo → skills → .claude → brain).
// `list` honours WORKBENCH_AS (as the Workbench's /api/misc-todos does); `add` does not.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BRAIN_ROOT = process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
const TODO_DIR = path.join(BRAIN_ROOT, 'todo');

// WORKBENCH_AS=<name-slug> previews another person's list (server.cjs VIEW_AS).
const VIEW_AS = /^[a-z0-9-]+$/.test(process.env.WORKBENCH_AS || '') ? process.env.WORKBENCH_AS : null;

// The response being built: mirrors Express's res.status(n).json(body).
class Reply {
  constructor() { this.code = 200; this.body = null; }
  status(code) { this.code = code; return this; }
  json(body) { this.body = body; return this; }
  // res.set('Cache-Control', ...) on the Workbench; nothing to set here.
  set() { return this; }
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
      const content = fs.readFileSync(abs, 'utf8');
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

// ---- server.cjs routes ------------------------------------------------------

// This machine's own slug, derived from `git config user.name` the same way
// the todo-creation endpoint stamps `assignee:`. Empty string if git identity isn't set.
function currentUserSlug() {
  if (VIEW_AS) return VIEW_AS;
  try {
    const out = spawnSync('git', ['config', 'user.name'], { cwd: BRAIN_ROOT, encoding: 'utf8', timeout: 3000 });
    return ((out && out.stdout) || '').trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  } catch {
    return '';
  }
}

// GET /api/misc-todos
function list(req, res) {
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
function roster(req, res) {
  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  try {
    const raw = fs.readFileSync(path.join(BRAIN_ROOT, '.team-config', 'roles.json'), 'utf8');
    const members = (JSON.parse(raw).members || [])
      .map(m => ({ slug: slugify(m.name), name: m.name }))
      .filter(m => m.slug);
    res.set('Cache-Control', 'no-store').json({ members });
  } catch {
    res.set('Cache-Control', 'no-store').json({ members: [] });
  }
}

// POST /api/todos/tick: moves todo/<file> into todo/done/.
function tick(req, res) {
  const file = String((req.body && req.body.file) || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.md$/.test(file)
      || file === 'CLAUDE.md' || file === 'README.md') {
    return res.status(400).json({ error: 'invalid todo file' });
  }
  const src = path.join(BRAIN_ROOT, 'todo', file);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'todo not found: ' + file });
  try {
    const doneDir = path.join(BRAIN_ROOT, 'todo', 'done');
    fs.mkdirSync(doneDir, { recursive: true });
    let dest = path.join(doneDir, file);
    if (fs.existsSync(dest)) dest = path.join(doneDir, file.replace(/\.md$/, `-${Date.now()}.md`));
    fs.renameSync(src, dest);
    res.json({ ok: true, file, moved: path.relative(BRAIN_ROOT, dest) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/todos/add: writes todo/YYYYMMDD-<slug>.md with the standard frontmatter.
// Assignee defaults to this machine's git user (slugified).
function add(req, res) {
  const title = String((req.body && req.body.title) || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: 'title is required' });
  const due = String((req.body && req.body.due) || '');
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ error: 'due must be YYYY-MM-DD' });

  let assignee = String((req.body && req.body.assignee) || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (!assignee) {
    try {
      const out = spawnSync('git', ['config', 'user.name'], { cwd: BRAIN_ROOT, encoding: 'utf8', timeout: 3000 });
      assignee = ((out && out.stdout) || '').trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    } catch { /* no git identity → leave the todo open */ }
  }

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'todo';
  const todoDir = path.join(BRAIN_ROOT, 'todo');
  try {
    fs.mkdirSync(todoDir, { recursive: true });
    let file = `${today.replace(/-/g, '')}-${slug}.md`;
    let n = 2;
    while (fs.existsSync(path.join(todoDir, file))) {
      file = `${today.replace(/-/g, '')}-${slug}-${n}.md`; n += 1;
    }
    const fm = ['---'];
    if (assignee) fm.push('assignee: ' + assignee);
    fm.push('title: ' + title, 'created: ' + today);
    if (due) fm.push('due: ' + due);
    fm.push('source: added from the Workbench', '---', '');
    fs.writeFileSync(path.join(todoDir, file), fm.join('\n'), 'utf8');
    res.json({ ok: true, file });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/todos/due: rewrites the `due:` line (adds a frontmatter block if none).
function due(req, res) {
  const file = String((req.body && req.body.file) || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.md$/.test(file)
      || file === 'CLAUDE.md' || file === 'README.md') {
    return res.status(400).json({ error: 'invalid todo file' });
  }
  const due = String((req.body && req.body.due) || '');
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ error: 'due must be YYYY-MM-DD' });
  const abs = path.join(BRAIN_ROOT, 'todo', file);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'todo not found: ' + file });
  try {
    let content = fs.readFileSync(abs, 'utf8');
    if (/^---\r?\n/.test(content)) {
      const lines = content.split(/\r?\n/);
      let close = -1;
      for (let i = 1; i < lines.length; i++) { if (lines[i] === '---') { close = i; break; } }
      if (close === -1) return res.status(500).json({ error: 'unterminated frontmatter in ' + file });
      let idx = -1;
      for (let i = 1; i < close; i++) { if (/^due:/.test(lines[i])) { idx = i; break; } }
      if (idx !== -1) { if (due) lines[idx] = 'due: ' + due; else lines.splice(idx, 1); }
      else if (due) lines.splice(close, 0, 'due: ' + due);
      content = lines.join('\n');
    } else if (due) {
      content = `---\ndue: ${due}\n---\n\n` + content;
    }
    fs.writeFileSync(abs, content, 'utf8');
    res.json({ ok: true, file, due: due || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/todos/assignee: rewrites the `assignee:` line (adds one if missing;
// clearing removes it, which leaves the todo open).
function assignee(req, res) {
  const file = String((req.body && req.body.file) || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.md$/.test(file)
      || file === 'CLAUDE.md' || file === 'README.md') {
    return res.status(400).json({ error: 'invalid todo file' });
  }
  const assignee = String((req.body && req.body.assignee) || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const abs = path.join(BRAIN_ROOT, 'todo', file);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'todo not found: ' + file });
  try {
    let content = fs.readFileSync(abs, 'utf8');
    if (/^---\r?\n/.test(content)) {
      const lines = content.split(/\r?\n/);
      let close = -1;
      for (let i = 1; i < lines.length; i++) { if (lines[i] === '---') { close = i; break; } }
      if (close === -1) return res.status(500).json({ error: 'unterminated frontmatter in ' + file });
      let idx = -1;
      for (let i = 1; i < close; i++) { if (/^assignee:/.test(lines[i])) { idx = i; break; } }
      if (idx !== -1) { if (assignee) lines[idx] = 'assignee: ' + assignee; else lines.splice(idx, 1); }
      else if (assignee) lines.splice(1, 0, 'assignee: ' + assignee);
      content = lines.join('\n');
    } else if (assignee) {
      content = `---\nassignee: ${assignee}\n---\n\n` + content;
    }
    fs.writeFileSync(abs, content, 'utf8');
    res.json({ ok: true, file, assignee: assignee || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/todos/edit: rewrites the `title:` line (adds one if missing; creates a
// frontmatter block if none). A string `body` replaces everything below the frontmatter.
function edit(req, res) {
  const file = String((req.body && req.body.file) || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.md$/.test(file)
      || file === 'CLAUDE.md' || file === 'README.md') {
    return res.status(400).json({ error: 'invalid todo file' });
  }
  const title = String((req.body && req.body.title) || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: 'title is required' });
  // Optional: the long description. Omit the field to leave the body alone.
  const hasBody = req.body && typeof req.body.body === 'string';
  const newBody = hasBody ? req.body.body.replace(/\r\n/g, '\n').trim().slice(0, 8000) : null;
  const abs = path.join(BRAIN_ROOT, 'todo', file);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'todo not found: ' + file });
  try {
    let content = fs.readFileSync(abs, 'utf8');
    if (/^---\r?\n/.test(content)) {
      const lines = content.split(/\r?\n/);
      let close = -1;
      for (let i = 1; i < lines.length; i++) { if (lines[i] === '---') { close = i; break; } }
      if (close === -1) return res.status(500).json({ error: 'unterminated frontmatter in ' + file });
      let idx = -1;
      for (let i = 1; i < close; i++) { if (/^title:/.test(lines[i])) { idx = i; break; } }
      if (idx !== -1) lines[idx] = 'title: ' + title;
      else { lines.splice(1, 0, 'title: ' + title); close++; }
      content = hasBody
        ? lines.slice(0, close + 1).join('\n') + (newBody ? '\n\n' + newBody + '\n' : '\n')
        : lines.join('\n');
    } else {
      content = `---\ntitle: ${title}\n---\n\n` + (hasBody ? newBody + '\n' : content);
    }
    fs.writeFileSync(abs, content, 'utf8');
    res.json({ ok: true, file, title, body: hasBody ? newBody : undefined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ---- delete: kept, not removed (a change from the Workbench; BCR-05) -------------------
//
// The Workbench's /api/todos/delete removed the file for good (server.cjs 1725-1738). Here it is
// moved to todo/deleted/ with who deleted it, when and from where, so there is a record for
// reporting and a deleted to-do can be brought back by moving the file. The record mirrors the one
// the TDS Brain App writes when a to-do is ticked off (status / completed_* in todo/done/).

const DELETED_KEYS = ['status', 'deleted', 'deleted_at', 'deleted_by', 'deleted_via'];
const DELETED_KEY_LINE = new RegExp(`^(?:${DELETED_KEYS.join('|')})\\s*:`);

// One line of plain text: control characters and line breaks become single spaces.
function oneLine(value) {
  return String(value == null ? '' : value).replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ').trim();
}
function slugOf(value) {
  return oneLine(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
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
// Who is deleting: the caller's `by` (slug) and `by_name` when sent (the app sends its signed-in
// identity, so deletes match its tick records), else this machine's git user.name, as `add` and
// `list` use for "me".
function deleter(body) {
  const slug = slugOf(body.by);
  if (slug) return { slug, name: oneLine(body.by_name).slice(0, 80) || slug };
  return currentUser();
}
function currentUser() {
  try {
    const out = spawnSync('git', ['config', 'user.name'], { cwd: BRAIN_ROOT, encoding: 'utf8', timeout: 3000 });
    const name = oneLine((out && out.stdout) || '');
    return { name: name || 'unknown', slug: slugOf(name) || 'unknown' };
  } catch {
    return { name: 'unknown', slug: 'unknown' };
  }
}

// The to-do's text with the deletion recorded: in the frontmatter (for tools and reports) and in a
// short "Deleted" section at the end (for people). Everything else is kept as written.
function stampDeleted(text, by, via, at) {
  const raw = String(text == null ? '' : text);
  const bom = raw.startsWith('﻿') ? '﻿' : '';
  const src = bom ? raw.slice(1) : raw;
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src === '' ? [] : src.split(/\r\n|\n/);
  const when = ukTime(at);
  const record = [
    'status: deleted',
    `deleted: ${when.date}`,
    `deleted_at: ${when.date}T${when.time}:${when.seconds}${when.offset}`,
    `deleted_by: ${by.slug}`,
    `deleted_via: ${yamlValue(via)}`,
  ];
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
      if (DELETED_KEY_LINE.test(line)) { dropping = true; continue; }
      if (dropping && (line.trim() === '' || /^\s/.test(line) || /^-\s/.test(line))) continue;
      dropping = false;
      head.push(line);
    }
    out = ['---', ...head, ...record, '---', ...lines.slice(close + 1)];
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  out.push('', `## Deleted ${when.date}`, '', `Deleted by ${by.name} at ${when.time} UK time (${via}).`, '');
  return bom + out.join(eol);
}

// delete: moves todo/<file> into todo/deleted/, stamped. Body: { file, via?, by?, by_name? } where
// `via` names the tool it was deleted from (e.g. "TDS Brain App"; "todo skill" when not given) and
// `by` / `by_name` the person (else git user.name).
function remove(req, res) {
  const file = String((req.body && req.body.file) || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.md$/.test(file)
      || file === 'CLAUDE.md' || file === 'README.md') {
    return res.status(400).json({ error: 'invalid todo file' });
  }
  const abs = path.join(BRAIN_ROOT, 'todo', file);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'todo not found: ' + file });
  const via = oneLine(req.body && req.body.via).slice(0, 60) || 'todo skill';
  try {
    const stamped = stampDeleted(fs.readFileSync(abs, 'utf8'), deleter(req.body), via, new Date());
    const deletedDir = path.join(BRAIN_ROOT, 'todo', 'deleted');
    fs.mkdirSync(deletedDir, { recursive: true });
    let dest = path.join(deletedDir, file);
    // 'wx' never overwrites an earlier deleted to-do of the same name.
    try {
      fs.writeFileSync(dest, stamped, { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      dest = path.join(deletedDir, file.replace(/\.md$/, `-${Date.now()}.md`));
      fs.writeFileSync(dest, stamped, { encoding: 'utf8', flag: 'wx' });
    }
    try {
      fs.unlinkSync(abs);
    } catch (err) {
      // Never leave the to-do both open and deleted.
      fs.rmSync(dest, { force: true });
      throw err;
    }
    res.json({ ok: true, file, moved: path.relative(BRAIN_ROOT, dest) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  COMMANDS[command]({ body }, res);
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
