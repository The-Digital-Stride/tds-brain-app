#!/usr/bin/env node
// tdsapp-todo.cjs (v0.6) — change one loose to-do in todo/ (or personal/todo/), the way the
// Workbench does, with fixes.
//
// A dependency-free port of the Workbench's to-do routes (tools/members/command-centre/server.cjs:
// /api/todos/add, /edit, /due, /assignee, /delete, /tick, /roster and /api/misc-todos, with
// lib/todo-parser.cjs). File names, frontmatter lines, success bodies and error texts are the
// Workbench's. The plan behind v0.3 is the app repo's docs/plans/2026-11-13-todo-skill-fixes.md; the
// weak spots it fixes are in the brain's os/tds-brain-app/change-requests.md (BCR-xx below). v0.4
// follows docs/plans/2026-11-13-todo-handover-search-scope.md (decision 2); v0.5 follows
// docs/plans/2026-11-16-todo-attachments.md (decisions 1, 2 and 8); v0.6 follows
// docs/plans/2026-11-20-projects-system.md (decisions 5, 6, 7 and 8).
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
// v0.4 differences (every new field optional; v0.3 calls to edit, due, tick, delete, roster and list
// give byte-identical results):
//   - capabilities: {} → {"version":"0.4","features":["handover","scope"?]}. "scope" only when the
//     brain isn't a git repo or git ignores personal/todo/, and personal/todo isn't a symbolic link.
//   - `scope: "personal"` on edit, due, delete, tick, assignee and move works in personal/todo/ (its
//     done/ and deleted/ too); absent or "tds" is todo/; anything else → 400. Personal requests are
//     refused (400) whenever "scope" isn't offered, so a private to-do never lands where git syncs it.
//     Offered = no link among personal/, personal/todo/ and its done/ and deleted/; and, in a git
//     repo, nothing tracked in personal/todo/ and all three folders ignored. Each personal file read
//     to change or written must also be ignored by its real name and really be under personal/todo/.
//     git runs without the caller's GIT_* variables.
//   - add: `scope: "personal"` writes to personal/todo/, assigned to the adder (`by`, else the git
//     user); `open` or someone else → 400. `created_by: <adder>` when the adder is known; a to-do for
//     someone else is stamped as handed over (assigned_to, _at, _by, _via). New names are free in
//     todo/, personal/todo/ and the done/ and deleted/ folders of both.
//   - assignee: a real change stamps assigned_to (slug or "open"), assigned_at (UK offset),
//     assigned_by, assigned_from (slug or "open") and assigned_via, replacing earlier ones, and adds a
//     line under "## Handover history" for people. No change → nothing written. Personal → 400.
//   - move: {file, scope?, to, expect?, by?, by_name?, via?} copies the bytes (and mode) unchanged to
//     the other folder (a clash gets -<n>), then removes the original. Only the assignee may move it, either way.
//
// v0.5 differences (every new field optional; earlier calls give the same results):
//   - capabilities: features add "attach"; version "0.5".
//   - attach {file, path, expect?, scope?, by?} links a library file in the body's "## Files"
//     section: `- [<name>](<path from the to-do's folder>)`, in <…> when the path holds a space,
//     bracket, < or >, plus ` (only on <slug>'s Mac)` for a personal/ file (`by`, else the git user).
//     `path` is brain-relative and must be a real file (no link anywhere on the way) of a type the
//     library lists, under clients/<client>/, templates/ or personal/, and not a place the library
//     never lists. A file already linked is a no-op (nothing written); more than 20 → 400. A new
//     section goes after the details, before the first "## Title history", "## Handover history",
//     "## Done <date>" or "## Deleted <date>" heading (outside code fences), else at the end.
//   - detach {file, path, expect?, scope?} removes every line linking that file and drops the
//     section once nothing is left in it. A file not linked is a no-op.
//   - edit `keep_files: true`: `body` is the details only (the 8,000 limit counts just that); a body
//     with a "## Files" heading → 400; the section on disk is put back by the same placement rule.
//   - add takes an optional `body` (at most 8,000, no "## Files" heading) as the new to-do's details.
//   The section's read rules mirror the app's shared/todo-files.ts; the app's tests and this
//   script's run the same fixtures (shared/todo-files.fixtures.json).
//
// v0.6 differences (every new field optional; earlier calls give the same results):
//   - capabilities: features add "todo-project-v1"; version "0.6".
//   - project {file, scope?, client, project, stage, expect?} sets a to-do's client, project and
//     stage together: each `client:`, `project:` and `stage:` line is replaced where it is, removed for
//     null (or ''), or added before the closing `---`; every other byte is kept. `project` is a project
//     key (<client>/<slug> or personal/<slug>) whose folder is there (clients/<client>/projects/<slug>,
//     for the-digital-stride also projects/<slug> and projects-archive/<slug>, then
//     clients/_archive/<client>/projects/<slug>; personal/projects/<slug>); `client` must be the key's
//     client (none for a personal key); a stage needs a project. A TDS to-do can't take a personal/
//     key: refused with 403 (the privacy rule), as is everything below that would leak one.
//   - add takes optional `client`, `project` and `stage`, with the same checks, written after `due`.
//   - move to TDS of a to-do whose `project:` names a personal project (a personal/ key, or the bare
//     name of a personal/projects/<slug>/ folder; read as leniently as the app reads it: spaces before
//     the colon, any case, `- ` items) or whose "## Files" section links anything under
//     personal/projects/ is refused (403) unless the request sends `dropProject: true`. With it, the
//     moved copy always loses its `project:` and `stage:` lines, whatever they hold, and those
//     "## Files" lines. Any other move still copies the bytes unchanged.
//   - attach and detach also take files under projects/<project>/ (the legacy project folders).
//   - attach of a file under personal/projects/ to a TDS to-do is refused (403). Other personal/
//     files stay allowed there, as in v0.5.
//
// v0.7 differences (docs/plans/2026-11-27-task-updates-handback.md, decisions 1-7, 5a, 11 and 14; the
// format is the app's shared/todo-updates-contract.ts). Every new field is optional, but results are no
// longer byte-identical to v0.6: a real change now also appends a line under "## Updates".
//   - capabilities: features add "updates-v1" and "links-v1"; version "0.7".
//   - A "## Updates" section, written only by this script and only ever appended to: one entry per
//     line, `- D Mon YYYY, HH:mm UK: Name (slug) <what> (<via>).` A note is `… (slug) wrote: <text>`,
//     its further lines indented by two spaces. A new section goes after the details and "## Files",
//     before the first "## Title history", "## Handover history", "## Done <date>" or
//     "## Deleted <date>" heading, else at the end; a new "## Files" section goes before it.
//   - Every command that really changes an open to-do appends exactly one entry: edit ("changed the
//     title" / "the details" / "the title and the details"), due, attach, detach, link, unlink,
//     project ("changed the project", never naming it) and update. Nothing changed → nothing written.
//     In a personal to-do the file and link entries leave the name out. assignee keeps its
//     "## Handover history" line instead; add writes `created_at:` (UK offset) after `created:`.
//     Who: `by` and `by_name`, else the git user; the tool: `via`, else "todo skill" (edit, due,
//     attach, detach and project now read them too).
//   - update {file, text, scope?, expect?, by?, by_name?, via?} adds a note. assignee and tick take an
//     optional `note`, written in the same file write; assignee with a note to whoever has it already
//     → 400. assignee `back: true` is a hand back: `assigned_back: true` in the record and "handed it
//     back to <slug>" in the history line.
//   - link {file, url, name?, …} adds `- [name](url)` (`<url>` when it holds a bracket) to "## Files":
//     http(s) only; the name defaults to the host. An URL already linked is a no-op; a 21st link →
//     400. unlink {file, url, …} removes every line linking that exact URL (the section once empty).
//   - edit never changes "## Updates": with one on disk, a section in `body` is dropped and the one on
//     disk kept (the 8,000 limit counts the body without it); with none on disk, a body holding that
//     heading → 400, as on add.
//   - Built for the brain's `todo/*.md merge=union`: readers read every "## Updates" and "## Files"
//     section and take the last copy of a frontmatter key; every write first folds later sections
//     into the first (exact duplicate entries dropped) and removes every copy of a key it sets.
//   The log's read rules mirror the app's shared/todo-updates.ts and web links mirror
//   shared/todo-files.ts; both test suites run shared/todo-updates.fixtures.json and
//   shared/todo-files.fixtures.json.
//
// Usage:
//   echo '<json>' | node .claude/skills/tdsapp-todo/scripts/tdsapp-todo.cjs <command>
//
//   <command>  add | edit | due | assignee | delete | tick | move | attach | detach | project | update |
//              link | unlink | roster | list | capabilities
//   stdin      one JSON object: the Workbench route's request body, same field names (file, title,
//              body, due, assignee), plus the optional fields above. roster and list need none ({}).
//   stdout     one JSON line.
//   exit 0     the success body (no `status`).
//   exit 2     the error body plus `status` (400, 403, 404, 409 or 500).
//              Invalid JSON, a non-object or an unknown command → 400.
//
// Brain root: BRAIN_ROOT, else four levels up from this file (scripts → tdsapp-todo → skills →
// .claude → brain), so the old `todo` shim that requires this file still finds the brain.
// `list` honours WORKBENCH_AS (as the Workbench's /api/misc-todos does); `add` does not.
//
// Test hooks: with NODE_ENV=test, TDSAPP_TODO_TEST_FAIL="<op>:<CODE>[:<times>],..." makes `link` or
// `rename` fail with that error code (every time, or the first <times> times), and (v0.7)
// TDSAPP_TODO_TEST_NOW=<ISO time> sets the clock. Both are ignored otherwise, and the app's scrubbed
// environment never sets them.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BRAIN_ROOT = process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
const TODO_DIR = path.join(BRAIN_ROOT, 'todo');
// v0.4: personal to-dos, kept out of git by the brain's own ignore rules.
const PERSONAL_DIR = path.join(BRAIN_ROOT, 'personal', 'todo');
const SCRIPT_VERSION = '0.7';
// v0.6: the capability the app looks for before it offers Project and Stage fields.
const PROJECT_CAPABILITY = 'todo-project-v1';
// v0.7: update, note and back on assignee, note on tick, and the "## Updates" log (TODO_UPDATES_CAPABILITY).
const UPDATES_CAPABILITY = 'updates-v1';
// v0.7: link and unlink (TODO_LINKS_CAPABILITY).
const LINKS_CAPABILITY = 'links-v1';

// WORKBENCH_AS=<name-slug> previews another person's list (server.cjs VIEW_AS).
const VIEW_AS = /^[a-z0-9-]+$/.test(process.env.WORKBENCH_AS || '') ? process.env.WORKBENCH_AS : null;

const TITLE_MAX = 200;
const DETAILS_MAX = 8000;
const ASSIGNEE_MAX = 40;
const VIA_MAX = 60;
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.md$/;
const RULES_FILES = new Set(['claude.md', 'readme.md', 'agents.md']);
// v0.5: most files one to-do's "## Files" section may hold (the app's TODO_ATTACHMENTS_MAX).
const FILES_MAX = 20;
const FILE_PATH_MAX = 1024;
// v0.7: the app's TODO_UPDATE_MAX, TODO_LINK_URL_MAX, TODO_LINK_NAME_MAX and TODO_LINKS_MAX.
const UPDATE_MAX = 2000;
const LINK_URL_MAX = 2000;
const LINK_NAME_MAX = 120;
const LINKS_MAX = 20;

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

// ---- scope (v0.4) ---------------------------------------------------------------------

const SCOPES = new Set(['tds', 'personal']);

// 'tds' or 'personal' from a field that may be absent (absent = 'tds').
function scopeValue(value, name) {
  if (value === undefined || value === null) return 'tds';
  if (typeof value !== 'string' || !SCOPES.has(value)) {
    throw new Refusal(400, `${name} must be "tds" or "personal"`);
  }
  return value;
}

// git, run in the brain with messages in English so they can be recognised, and with none of the
// caller's GIT_* variables (they could point git at another repository). Null if it can't run.
function gitInBrain(args, input) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  env.LC_ALL = 'C';
  env.LANGUAGE = '';
  const out = spawnSync('git', args, { cwd: BRAIN_ROOT, encoding: 'utf8', timeout: 5000, env, input });
  return out.error ? null : out;
}

const UNAVAILABLE = "personal to-dos aren't available: ";
const UNCHECKED = UNAVAILABLE + "git couldn't check that personal/todo/ stays private";
// Folders that must be real folders, not links, or a personal write could land anywhere.
const PERSONAL_FOLDERS = ['personal', 'personal/todo', 'personal/todo/done', 'personal/todo/deleted'];

// 'repo', 'none' (the brain isn't a git repository) or null (git couldn't tell). Asked once.
let repoState;
function brainRepo() {
  if (repoState !== undefined) return repoState;
  const repo = gitInBrain(['rev-parse', '--is-inside-work-tree']);
  if (!repo) repoState = null;
  else if (repo.status !== 0) repoState = /not a git repository/i.test(repo.stderr || '') ? 'none' : null;
  else repoState = (repo.stdout || '').trim() === 'true' ? 'repo' : null;
  return repoState;
}

// Which of these brain-relative paths git doesn't ignore ([] = all ignored); null if git couldn't tell.
// check-ignore says a tracked file isn't ignored, so a force-added file fails here too.
function notIgnored(rels) {
  // Names go in and out NUL-separated, so git never quotes them.
  const out = gitInBrain(['check-ignore', '--stdin', '-z'], rels.map(rel => rel + '\0').join(''));
  if (!out || (out.status !== 0 && out.status !== 1)) return null;
  const ignored = new Set((out.stdout || '').split('\0').filter(Boolean));
  return rels.filter(rel => !ignored.has(rel));
}

// Why personal to-dos can't be used here, or null when they can. The folder-level checks: no link
// among personal/, personal/todo/ and its done/ and deleted/; and, in a git repository, nothing in
// personal/todo/ tracked and all three folders ignored, so nothing there ever syncs.
function personalProblem() {
  for (const rel of PERSONAL_FOLDERS) {
    try {
      if (fs.lstatSync(path.join(BRAIN_ROOT, rel)).isSymbolicLink()) {
        return UNAVAILABLE + `${rel} is a link to another folder`;
      }
    } catch { /* not there yet: it is made as a real folder when needed */ }
  }
  const repo = brainRepo();
  if (repo === 'none') return null;
  if (repo === null) return UNCHECKED;
  const tracked = gitInBrain(['ls-files', '-z', '--', 'personal/todo']);
  if (!tracked || tracked.status !== 0) return UNCHECKED;
  if (tracked.stdout !== '') return UNAVAILABLE + 'git already tracks files in personal/todo/';
  const missed = notIgnored(['personal/todo/x.md', 'personal/todo/done/x.md', 'personal/todo/deleted/x.md']);
  if (missed === null) return UNCHECKED;
  if (missed.length > 0) return UNAVAILABLE + `the brain's git doesn't ignore ${missed[0].replace(/x\.md$/, '')}`;
  return null;
}

// Refuses unless git ignores each of these files (absolute paths) by its real name.
function requireIgnored(absPaths) {
  const repo = brainRepo();
  if (repo === 'none') return;
  if (repo === null) throw new Refusal(400, UNCHECKED);
  const missed = notIgnored(absPaths.map(abs => path.relative(BRAIN_ROOT, abs).split(path.sep).join('/')));
  if (missed === null) throw new Refusal(400, UNCHECKED);
  if (missed.length > 0) throw new Refusal(400, UNAVAILABLE + `the brain's git doesn't ignore ${missed[0]}`);
}

// Refuses a folder that really is somewhere outside `root` (a link along the way).
function requireInside(dir, root) {
  const real = fs.realpathSync(dir);
  const base = fs.realpathSync(root);
  if (real !== base && !real.startsWith(base + path.sep)) {
    const prefix = root === PERSONAL_DIR ? UNAVAILABLE : '';
    throw new Refusal(400, `${prefix}${path.relative(BRAIN_ROOT, dir)} leads outside ${path.relative(BRAIN_ROOT, root)}`);
  }
}

// Every personal file read to change or written: in personal/todo/ for real, and ignored by git.
function requirePrivate(abs) {
  requireInside(path.dirname(abs), PERSONAL_DIR);
  requireIgnored([abs]);
}

// The folder a request works in. Personal requests are refused unless personal/todo is private.
function dirOfScope(scope) {
  if (scope === 'tds') return TODO_DIR;
  const problem = personalProblem();
  if (problem) throw new Refusal(400, problem);
  return PERSONAL_DIR;
}

function dirOf(body) {
  return dirOfScope(scopeValue(body.scope, 'scope'));
}

// ---- reading and writing files (BCR-15) ---------------------------------------------

// The to-do to change: checked, read once, and compared with `expect` before anything is written.
// `rewrite`: it will be replaced in place (edit, due, assignee), so it must be writable; tick and
// delete only remove it, which works on a read-only file today and still does.
function openTodo(dir, file, expect, rewrite) {
  const abs = path.join(dir, file);
  if (!fs.existsSync(abs)) throw new Refusal(404, 'todo not found: ' + file);
  if (dir === PERSONAL_DIR) requirePrivate(abs);
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
// v0.7: the test clock (see the header); the real time otherwise.
const TEST_NOW = process.env.NODE_ENV === 'test' && process.env.TDSAPP_TODO_TEST_NOW
  ? Date.parse(process.env.TDSAPP_TODO_TEST_NOW)
  : NaN;
function now() {
  return Number.isNaN(TEST_NOW) ? new Date() : new Date(TEST_NOW);
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

// Creates a new file all at once. Fails with EEXIST rather than overwrite anything. `mode` (move
// only) keeps the original's permissions; otherwise the default applies, as before.
function createFile(abs, data, mode) {
  const dir = path.dirname(abs);
  const tmp = writeTemp(dir, data, mode);
  try {
    try {
      io.link(tmp, abs);
    } catch (err) {
      if (err.code === 'EEXIST') throw err;
      // No hard links here (some file systems): the Workbench's exclusive write, as before.
      fs.writeFileSync(abs, data, { encoding: 'utf8', flag: 'wx' });
      if (mode !== undefined) fs.chmodSync(abs, mode);
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

// Adds `entry` at the end of the "## <name>" section (Title history, Handover history), making the
// section at the end of the body if needed.
function addToSection(lines, name, entry) {
  const outside = linesOutsideFences(lines);
  const heading = new RegExp(`^##\\s+${name}\\s*$`, 'i');
  const at = outside.find(i => heading.test(lines[i]));
  if (at === undefined) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', `## ${name}`, '', entry, '');
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
    addToSection(out, 'Title history', `- ${ukTime(now()).date}: was "${oldTitle}"`);
  }
  return out;
}

// ---- the "## Files" section (v0.5) ---------------------------------------------------------
//
// Read rules, line for line from the app's shared/todo-files.ts (both test suites run
// shared/todo-files.fixtures.json, so they can't drift). This script is the section's only writer.

// The section starts at a level-2 heading that says exactly "Files" (any case)...
const FILES_HEADING = /^##[ \t]+files[ \t]*$/i;
// ... and ends at the next level-1 or level-2 heading.
const FILES_NEXT_HEADING = /^#{1,2}[ \t]/;
// `- [name](path)` or `- [name](<path>)`, optionally followed by ` (only on <slug>'s Mac)`.
const FILE_ITEM = /^[ \t]*[-*][ \t]+\[([^\]\n]+)\]\((?:<([^>\n]+)>|([^\s()<>]+))\)(?:[ \t]+\(only on ([a-z0-9]+(?:-[a-z0-9]+)*)'s Mac\))?[ \t]*$/;
// v0.6: projects/ too, for the legacy project folders.
const FILE_ROOTS = ['clients/', 'templates/', 'personal/', 'projects/'];
// Where a new "## Updates" section goes (v0.7): before the first of the sections this script writes
// after the details and "## Files".
const UPDATES_ANCHOR = /^##[ \t]+(?:title history|handover history|done \d{4}-\d{2}-\d{2}|deleted \d{4}-\d{2}-\d{2})[ \t]*$/i;
// Where a new "## Files" section goes: the same, and before "## Updates" too (v0.7).
const FILES_ANCHOR = /^##[ \t]+(?:updates|title history|handover history|done \d{4}-\d{2}-\d{2}|deleted \d{4}-\d{2}-\d{2})[ \t]*$/i;

// A link target as a brain path, or null: every leading `../` dropped, then it must start with
// clients/, templates/ or personal/ and have no empty, `.` or `..` segment, backslash, colon or `%`.
function resolveFilePath(target) {
  let rest = String(target).trim();
  while (rest.startsWith('../')) rest = rest.slice(3);
  if (!FILE_ROOTS.some(r => rest.startsWith(r))) return null;
  if (/[\\:%\0]/.test(rest)) return null;
  if (rest.split('/').some(p => p === '' || p === '.' || p === '..')) return null;
  return rest;
}

// v0.7: the [start, end) line range of EVERY section whose heading matches, outside code fences, in
// order (the app's todoSectionRanges). A union merge can leave two.
function sectionRanges(lines, heading) {
  const out = [];
  let start = -1;
  for (const i of linesOutsideFences(lines)) {
    if (!FILES_NEXT_HEADING.test(lines[i])) continue;
    if (start !== -1) out.push([start, i]);
    start = heading.test(lines[i]) ? i : -1;
  }
  if (start !== -1) out.push([start, lines.length]);
  return out;
}

// Every line index inside a section (headings left out), in order.
function sectionLineIndexes(lines, heading) {
  const out = [];
  for (const [start, end] of sectionRanges(lines, heading)) for (let i = start + 1; i < end; i++) out.push(i);
  return out;
}

// The [start, end) line range of the first "## Files" section, or null. Writers use it after
// foldSections, when there is only one. Headings inside ``` or ~~~ code fences don't count.
function filesRange(lines) {
  return sectionRanges(lines, FILES_HEADING)[0] || null;
}

// One section line as a link, or null when it isn't a well-formed item with a brain path.
function fileLinkOf(line) {
  const m = FILE_ITEM.exec(line);
  if (!m) return null;
  const path = resolveFilePath(m[2] !== undefined ? m[2] : m[3]);
  if (path === null) return null;
  return { path, name: m[1].trim(), holder: path.startsWith('personal/') ? (m[4] || null) : null };
}

// The files linked in the body's sections (every one, v0.7), in written order, each path once.
function parseFiles(body) {
  const lines = String(body == null ? '' : body).split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const i of sectionLineIndexes(lines, FILES_HEADING)) {
    const link = fileLinkOf(lines[i]);
    if (!link || seen.has(link.path)) continue;
    seen.add(link.path);
    out.push(link);
  }
  return out;
}

// v0.7: the body with every section matching one of `headings` taken out (`details`, trimmed, the
// pieces either side joined by one blank line) and each heading's sections as written (joined by a
// blank line). The app's cutTodoSections.
function cutSections(body, headings) {
  const text = String(body == null ? '' : body);
  const lines = text.split(/\r?\n/);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const perHeading = headings.map(h => sectionRanges(lines, h));
  const all = perHeading.flat().sort((a, b) => a[0] - b[0]);
  if (all.length === 0) return { details: text.trim(), sections: headings.map(() => '') };
  const pieces = [];
  let cursor = 0;
  for (const [start, end] of all) {
    pieces.push(lines.slice(cursor, start).join(eol).trim());
    cursor = end;
  }
  pieces.push(lines.slice(cursor).join(eol).trim());
  const sections = perHeading.map(ranges =>
    ranges.map(([start, end]) => lines.slice(start, end).join(eol).trimEnd()).join(eol + eol));
  return { details: pieces.filter(p => p !== '').join(eol + eol).trim(), sections };
}

// The body without its sections (`details`, trimmed) and their source (`files`).
function splitFiles(body) {
  const { details, sections } = cutSections(body, [FILES_HEADING]);
  return { details, files: sections[0] };
}

// Details sent by a caller may not hold the section: only attach and detach change it. A heading inside a
// code fence is not one, the same as filesRange and shared/todo-files.ts.
function refuseFilesHeading(text) {
  const lines = text.split('\n');
  if (linesOutsideFences(lines).some(i => FILES_HEADING.test(lines[i]))) {
    throw new Refusal(400, 'details can\'t hold a "## Files" section: files are linked with attach');
  }
}

// `lines` (a body, no frontmatter) with a section added: after the details, before the first
// updates, history, done or deleted heading outside a code fence (else at the end), one blank line
// either side. `afterHead`: a frontmatter block comes first, so a section at the top still gets its
// blank line. v0.7: `anchor` and `from` (the first line an anchor may be on) for "## Updates".
function placeSection(lines, section, afterHead, anchor = FILES_ANCHOR, from = 0) {
  let at = lines.length;
  for (const i of linesOutsideFences(lines)) {
    if (i >= from && anchor.test(lines[i])) { at = i; break; }
  }
  const before = lines.slice(0, at);
  while (before.length > 0 && before[before.length - 1].trim() === '') before.pop();
  const lead = before.length > 0 || afterHead ? [''] : [];
  return [...before, ...lead, ...section, '', ...lines.slice(at)];
}

// `lines` with the section [start, end) taken out, blank lines either side collapsed to one.
function dropSection(lines, start, end, afterHead) {
  const before = lines.slice(0, start);
  while (before.length > 0 && before[before.length - 1].trim() === '') before.pop();
  const after = lines.slice(end);
  while (after.length > 0 && after[0].trim() === '') after.shift();
  if (before.length === 0 && after.length === 0) return [''];
  if (after.length === 0) return [...before, ''];
  if (before.length === 0) return afterHead ? ['', ...after] : after;
  return [...before, '', ...after];
}

// The to-do's text as frontmatter lines (or none) and body lines (plain \n).
function todoParts(todo, file) {
  return textParts(todo.text, file);
}

// v0.7: as textParts, but frontmatter that never closes is read as body (tick and delete take such a file).
function looseParts(text) {
  try {
    return textParts(text, '');
  } catch {
    return { head: [], body: text.split('\n') };
  }
}

// v0.7: any text (plain \n lines) as frontmatter lines (or none) and body lines.
function textParts(text, file) {
  const lines = text.split('\n');
  if (!/^---\n/.test(text)) return { head: [], body: lines };
  const close = closingLine(lines);
  if (close === -1) throw new Refusal(500, 'unterminated frontmatter in ' + file);
  return { head: lines.slice(0, close + 1), body: lines.slice(close + 1) };
}

// ---- the "## Updates" log and web links (v0.7) ------------------------------------------------
//
// Read rules, line for line from the app's shared/todo-updates.ts and (for links) shared/todo-files.ts;
// both test suites run shared/todo-updates.fixtures.json and shared/todo-files.fixtures.json, so they
// can't drift. This script is the log's only writer, and only ever appends to it.

// The log starts at a level-2 heading that says exactly "Updates" (any case).
const UPDATES_HEADING = /^##[ \t]+updates[ \t]*$/i;
const HANDOVER_HEADING = /^##[ \t]+handover history[ \t]*$/i;
// `- D Mon YYYY, HH:mm UK: ` at column 0, then the rest of the line.
const ENTRY_STAMP = /^- (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}), (\d{2}):(\d{2}) UK: (.+)$/;
// After the stamp in "## Updates": `Name (slug) ` and the rest. The name never holds "(" or ")".
const ENTRY_ACTOR = /^([^()]+) \(([a-z0-9]+(?:-[a-z0-9]+)*)\) (.+)$/;
// After the stamp in "## Handover history": the name, then what happened.
const HANDOVER_WHAT = /^(.+?) ((?:passed|made|picked|handed) it\b.*)$/;
// The tool at the end of an auto or handover line: ` (<via>).`
const ENTRY_VIA = /^(.*) \(([^()]+)\)\.$/;
const NOTE_MARK = 'wrote: ';
// A note's further lines: indented by two spaces, straight after it. The two are dropped.
const NOTE_CONTINUATION = /^ {2}/;
const ENTRY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The UK wall clock at `ms`, as "YYYY-MM-DD HH:mm".
let londonFormat = null;
function londonWall(ms) {
  londonFormat = londonFormat || new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = {};
  for (const part of londonFormat.formatToParts(new Date(ms))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// UK wall time ("2026-11-27", "14:05") → ISO with the UK offset, seconds 00; null for an impossible
// time (the hour the clocks skip). In the hour that happens twice, the first one (BST).
function ukWallToIso(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  const t = /^(\d{2}):(\d{2})$/.exec(String(time));
  if (!d || !t) return null;
  const [y, m, day, h, min] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  if (h > 23 || min > 59 || m < 1 || m > 12 || day < 1) return null;
  const wall = Date.UTC(y, m - 1, day, h, min);
  if (new Date(wall).getUTCDate() !== day) return null;
  for (const offset of [1, 0]) {
    if (londonWall(wall - offset * 3600000) === `${date} ${time}`) return `${date}T${time}:00+0${offset}:00`;
  }
  return null;
}

// An entry line's stamp as ISO, and the rest of the line; null when it isn't one or isn't a real time.
function entryStampOf(line) {
  const m = ENTRY_STAMP.exec(line);
  if (!m) return null;
  const month = String(ENTRY_MONTHS.indexOf(m[2]) + 1).padStart(2, '0');
  const at = ukWallToIso(`${m[3]}-${month}-${m[1].padStart(2, '0')}`, `${m[4]}:${m[5]}`);
  return at === null ? null : { at, rest: m[6] };
}

// "what (via)." → its words and the tool; without a tool, the words less a final full stop.
function viaParts(rest) {
  const m = ENTRY_VIA.exec(rest);
  if (m) return { text: m[1], via: m[2] };
  return { text: rest.replace(/\.$/, ''), via: null };
}

// The action an auto entry's wording stands for (the wordings this script writes), or null.
function autoAction(text) {
  if (/^(?:set the due date to |changed the due date from |cleared the due date(?: |$))/.test(text)) return 'due';
  if (text === 'changed the title' || text === 'changed the title and the details') return 'title';
  if (text === 'changed the details') return 'details';
  if (/^(?:added|removed) a file(?:: .+)?$/.test(text)) return 'files';
  if (/^(?:added|removed) a link(?:: .+)?$/.test(text)) return 'links';
  if (text === 'changed the project') return 'project';
  return null;
}

// Notes and auto entries from every "## Updates" section, in written order, and the other lines.
function parseUpdates(body) {
  const lines = String(body == null ? '' : body).split(/\r?\n/);
  const entries = [];
  const extras = [];
  for (const [start, end] of sectionRanges(lines, UPDATES_HEADING)) {
    let note = null;
    for (let i = start + 1; i < end; i++) {
      const line = lines[i].trimEnd();
      if (line === '') { note = null; continue; }
      if (note && NOTE_CONTINUATION.test(line)) { note.text += '\n' + line.slice(2); continue; }
      note = null;
      const stamp = entryStampOf(line);
      const who = stamp ? ENTRY_ACTOR.exec(stamp.rest) : null;
      if (!stamp || !who) { extras.push(line.trim()); continue; }
      const base = { at: stamp.at, by: who[2], byName: who[1].trim() };
      if (who[3].startsWith(NOTE_MARK)) {
        note = { kind: 'note', ...base, text: who[3].slice(NOTE_MARK.length), via: null, action: 'update' };
        entries.push(note);
      } else {
        const { text, via } = viaParts(who[3]);
        entries.push({ kind: 'auto', ...base, text, via, action: autoAction(text) });
      }
    }
  }
  return { entries, extras };
}

// The lines of every "## Handover history" section as entries, in written order.
function parseHandovers(body) {
  const lines = String(body == null ? '' : body).split(/\r?\n/);
  const out = [];
  for (const [start, end] of sectionRanges(lines, HANDOVER_HEADING)) {
    for (let i = start + 1; i < end; i++) {
      const stamp = entryStampOf(lines[i].trimEnd());
      const what = stamp ? HANDOVER_WHAT.exec(stamp.rest) : null;
      if (!stamp || !what) continue;
      const { text, via } = viaParts(what[2]);
      out.push({
        kind: 'handover', at: stamp.at, by: null, byName: what[1].trim(), text, via,
        action: /^handed it back to /.test(text) ? 'handback' : 'assignee',
      });
    }
  }
  return out;
}

// Both, oldest first; equal minutes keep file order, "## Updates" first (sort is stable).
function timeline(body) {
  const { entries, extras } = parseUpdates(body);
  const updates = [...entries, ...parseHandovers(body)].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { updates, extras };
}

// The body without its "## Files" and "## Updates" sections, and those sections as written.
function splitSections(body) {
  const { details, sections } = cutSections(body, [FILES_HEADING, UPDATES_HEADING]);
  return { details, files: sections[0], updates: sections[1] };
}

// A web link's URL: http(s) with `//` and a host, at most LINK_URL_MAX characters, and no
// whitespace, control character, "<", ">" or backslash (the app's isTodoLinkUrl).
function isLinkUrl(url) {
  if (typeof url !== 'string' || url === '' || url.length > LINK_URL_MAX) return false;
  if (/[\s\p{Cc}<>\\]/u.test(url) || !/^https?:\/\//i.test(url)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
}

// One "## Files" line as a web link, or null: an item with no "(only on …'s Mac)" and a good URL.
function webLinkOf(line) {
  const m = FILE_ITEM.exec(line);
  if (!m || m[4] !== undefined) return null;
  const url = m[2] !== undefined ? m[2] : m[3];
  const name = m[1].trim();
  return name !== '' && isLinkUrl(url) ? { url, name } : null;
}

// The web links in every "## Files" section, in written order, each URL once.
function parseLinks(body) {
  const lines = String(body == null ? '' : body).split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const i of sectionLineIndexes(lines, FILES_HEADING)) {
    const link = webLinkOf(lines[i]);
    if (!link || seen.has(link.url)) continue;
    seen.add(link.url);
    out.push(link);
  }
  return out;
}

// The other non-blank lines of every "## Files" section, trimmed (the app's todoFileExtras).
function fileExtras(body) {
  const lines = String(body == null ? '' : body).split(/\r?\n/);
  return sectionLineIndexes(lines, FILES_HEADING)
    .filter(i => lines[i].trim() !== '' && !fileLinkOf(lines[i]) && !webLinkOf(lines[i]))
    .map(i => lines[i].trim());
}

// ---- writing the log, and folding what a union merge doubled (v0.7) ---------------------------

// A section's lines as blocks: a line at column 0 with the indented lines straight after it.
function sectionBlocks(lines, range) {
  const blocks = [];
  let current = null;
  for (let i = range[0] + 1; i < range[1]; i++) {
    const line = lines[i];
    if (line.trim() === '') { current = null; continue; }
    if (current && /^\s/.test(line)) { current.push(line); continue; }
    current = [line];
    blocks.push(current);
  }
  return blocks;
}

// `lines` with `added` after the section's last line that isn't blank (after a blank line when the
// section is only a heading), and a blank line kept before a heading that follows.
function appendToSection(lines, range, added) {
  const out = lines.slice();
  let last = range[1] - 1;
  while (last > range[0] && out[last].trim() === '') last--;
  const insert = last === range[0] ? ['', ...added] : added;
  out.splice(last + 1, 0, ...insert);
  const next = last + 1 + insert.length;
  if (next < out.length && FILES_NEXT_HEADING.test(out[next])) out.splice(next, 0, '');
  return out;
}

// Body lines with every later "## Files" and "## Updates" section folded into the first of its kind:
// its blocks appended there, exact duplicates dropped, the later section removed.
function foldSections(lines) {
  let out = lines;
  for (const heading of [FILES_HEADING, UPDATES_HEADING]) {
    const ranges = sectionRanges(out, heading);
    if (ranges.length < 2) continue;
    const seen = new Set(sectionBlocks(out, ranges[0]).map(b => b.join('\n')));
    const moved = [];
    for (const range of ranges.slice(1)) {
      for (const block of sectionBlocks(out, range)) {
        const key = block.join('\n');
        if (seen.has(key)) continue;
        seen.add(key);
        moved.push(...block);
      }
    }
    for (const [start, end] of ranges.slice(1).reverse()) out = dropSection(out, start, end, false);
    if (moved.length > 0) out = appendToSection(out, sectionRanges(out, heading)[0], moved);
  }
  return out;
}

// The to-do's text (plain \n lines) with its doubled sections folded.
function foldText(text, file) {
  const { head, body } = textParts(text, file);
  const folded = foldSections(body);
  return folded === body ? text : [...head, ...folded].join('\n');
}

// Body lines with `entry` (its lines) appended to the first "## Updates" section, or in a new one:
// after the details and the last "## Files" section, before the first history, done or deleted heading.
function addEntry(bodyLines, entry, afterHead) {
  const ranges = sectionRanges(bodyLines, UPDATES_HEADING);
  if (ranges.length > 0) return appendToSection(bodyLines, ranges[0], entry);
  return placeUpdates(bodyLines, ['## Updates', '', ...entry], afterHead);
}

// Body lines with an "## Updates" section (its lines, heading first) placed by the rule above.
function placeUpdates(bodyLines, section, afterHead) {
  const files = sectionRanges(bodyLines, FILES_HEADING);
  const from = files.length > 0 ? files[files.length - 1][1] : 0;
  return placeSection(bodyLines, section, afterHead, UPDATES_ANCHOR, from);
}

// `text` (plain \n lines) with `entry` logged.
function withEntry(text, file, entry) {
  const { head, body } = textParts(text, file);
  return [...head, ...addEntry(body, entry, head.length > 0)].join('\n');
}

// Writes `text` with `entry` logged, unless it is still `before` (nothing really changed: nothing is
// written). True when written.
function writeLogged(todo, file, before, text, entry) {
  if (text === before) return false;
  replaceTodo(todo, withEntry(text, file, entry));
  return true;
}

// Who acted and with which tool, as the log writes them: the name without "(" or ")", the slug, and
// the tool (`via`, else "todo skill").
function logActor(body) {
  const who = actor(body);
  const name = who.name.replace(/[()]/g, '').replace(/\s+/g, ' ').trim() || who.slug;
  const via = viaOf(body).replace(/[()]/g, '').trim() || 'todo skill';
  return { name, slug: who.slug, via };
}

// "- 27 Nov 2026, 14:05 UK"
function entryStamp(at) {
  const when = ukTime(at);
  const [y, m, d] = when.date.split('-');
  return `- ${Number(d)} ${ENTRY_MONTHS[Number(m) - 1]} ${y}, ${when.time} UK`;
}

// One auto entry: "- … UK: Name (slug) <words> (<via>)."
function autoEntry(who, words) {
  return [`${entryStamp(now())}: ${who.name} (${who.slug}) ${words} (${who.via}).`];
}

// One note: "- … UK: Name (slug) wrote: <first line>", then "  <line>" for each further line.
function noteEntry(who, text) {
  const [first, ...rest] = text.split('\n');
  return [`${entryStamp(now())}: ${who.name} (${who.slug}) wrote: ${first}`, ...rest.map(l => '  ' + l)];
}

// "1 Dec 2026" for a YYYY-MM-DD date; anything else as one line of text.
function shortDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m || !isRealDate(value)) return oneLine(value);
  return `${Number(m[3])} ${ENTRY_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// An update's text (`text` on update, `note` on assignee and tick), normalised: CR and CRLF become
// LF, tabs spaces; each line loses its trailing spaces, blank lines go, and the whole is trimmed.
function updateTextOf(value, name) {
  if (typeof value !== 'string') throw new Refusal(400, `${name} must be text`);
  const text = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
    .split('\n').map(l => l.trimEnd()).filter(l => l !== '').join('\n').trim();
  if (!text) throw new Refusal(400, `${name} is required`);
  if (text.length > UPDATE_MAX) throw new Refusal(400, `${name} is too long (over ${UPDATE_MAX} characters)`);
  if (/\p{Cc}/u.test(text.replace(/\n/g, ''))) throw new Refusal(400, `${name} can't hold control characters`);
  if (text.split('\n').some(l => /^\s*(?:```|~~~)/.test(l))) throw new Refusal(400, "an update can't hold a code block");
  return text;
}

// The optional `note` of assignee and tick: null when not sent.
function noteOf(body) {
  return body.note === undefined || body.note === null ? null : updateTextOf(body.note, 'note');
}

// Details sent by a caller may not hold the log: only this script writes it.
function hasUpdatesHeading(text) {
  const lines = text.split('\n');
  return linesOutsideFences(lines).some(i => UPDATES_HEADING.test(lines[i]));
}
const UPDATES_IN_DETAILS = 'details can\'t hold an "## Updates" section: updates are added with update';

// The library's rules (the app's server/brain/library-rules.ts), as tdsapp-files has them.
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'];
const DOCUMENT_EXTENSIONS = ['pdf', 'md', 'txt', 'docx', 'html', 'htm', 'csv', 'xlsx', 'pptx'];
const LIBRARY_EXTENSIONS = [...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS];

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

function extOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

// The brain path a request names: under clients/<client>/, projects/<project>/, templates/ or personal/, written exactly
// as a link would resolve (so no `..`, `.`, empty part, backslash, colon, `%` or outer spaces).
function filePathOf(body) {
  const rel = body.path;
  if (typeof rel !== 'string' || rel === '') throw new Refusal(400, 'path is required');
  if (rel.length > FILE_PATH_MAX) throw new Refusal(400, `path is too long (over ${FILE_PATH_MAX} characters)`);
  const deep = rel.startsWith('clients/') || rel.startsWith('projects/');
  if (resolveFilePath(rel) !== rel || (deep && rel.split('/').length < 3)) {
    throw new Refusal(400, 'path must be a file under clients/<client>/, projects/<project>/, templates/ or personal/');
  }
  return rel;
}

// The section line linking `rel` from a to-do in `dir`, after checking `rel` is a real library file.
function fileLineFor(rel, dir, holder) {
  if (isNeverListed(rel)) throw new Refusal(400, 'that path is never listed in the library');
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  if (!LIBRARY_EXTENSIONS.includes(extOf(name))) {
    throw new Refusal(400, 'only the image and document types the library lists can be linked');
  }
  const abs = path.join(BRAIN_ROOT, ...rel.split('/'));
  let stat;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    throw new Refusal(400, 'no file at ' + rel);
  }
  if (stat.isSymbolicLink()) throw new Refusal(400, rel + ' is a link');
  if (!stat.isFile()) throw new Refusal(400, rel + " isn't a file");
  // No link anywhere on the way, and the letters' case as on the disk.
  const real = path.relative(fs.realpathSync.native(BRAIN_ROOT), fs.realpathSync.native(abs)).split(path.sep).join('/');
  if (real !== rel) throw new Refusal(400, rel + " goes through a link or doesn't match the folder names on disk");
  const target = (dir === PERSONAL_DIR ? '../../' : '../') + rel;
  const shown = name.replace(/\[/g, '(').replace(/\]/g, ')');
  let line = `- [${shown}](${/[\s()<>]/.test(target) ? `<${target}>` : target})`;
  if (rel.startsWith('personal/') && holder) line += ` (only on ${holder}'s Mac)`;
  // What the app will read back must be this very file.
  const link = /[\p{Cc}]/u.test(rel) ? null : fileLinkOf(line);
  if (!link || link.path !== rel) throw new Refusal(400, rel + " can't be written as a link");
  return line;
}

// attach: { file, path, scope?, expect?, by? } → the file linked in the "## Files" section.
function attach(body, res) {
  const file = fileOf(body);
  const rel = filePathOf(body);
  const dir = dirOf(body);
  // v0.6 (decision 8): a team to-do never links into a personal project. Other personal/ files stay
  // allowed, as in v0.5 (each line says whose Mac has it).
  if (dir === TODO_DIR && rel.toLowerCase().startsWith(PERSONAL_PROJECTS_PREFIX)) {
    throw new Refusal(403, "a team to-do can't link a file from a personal project");
  }
  const todo = openTodo(dir, file, expectOf(body), true);
  const line = fileLineFor(rel, dir, rel.startsWith('personal/') ? adderOf(body) : '');
  const before = foldText(todo.text, file);
  const { head, body: lines } = textParts(before, file);
  const links = parseFiles(lines.join('\n'));
  if (links.some(l => l.path === rel)) return res.json({ ok: true, file, path: rel, changed: false });
  if (links.length >= FILES_MAX) throw new Refusal(400, `a to-do can have at most ${FILES_MAX} files`);
  const out = addToFiles(lines, line, head.length > 0);
  // v0.7: a personal to-do's entry never names the file.
  const words = dir === PERSONAL_DIR ? 'added a file' : `added a file: ${fileLinkOf(line).name}`;
  writeLogged(todo, file, before, [...head, ...out].join('\n'), autoEntry(logActor(body), words));
  res.json({ ok: true, file, path: rel, changed: true });
}

// Body lines with `line` added to the "## Files" section, or in a new one (see placeSection).
function addToFiles(lines, line, afterHead) {
  const range = filesRange(lines);
  if (!range) return placeSection(lines, ['## Files', '', line], afterHead);
  return appendToSection(lines, range, [line]);
}

// Body lines with the "## Files" lines at `hits` removed, and the section once nothing is left in it.
function removeFromFiles(lines, range, hits, afterHead) {
  let out = lines.filter((_, i) => !hits.has(i));
  const end = range[1] - hits.size;
  if (out.slice(range[0] + 1, end).every(l => l.trim() === '')) out = dropSection(out, range[0], end, afterHead);
  return out;
}

// detach: { file, path, scope?, expect? } → every line linking that file removed; the section goes
// once nothing is left in it. The file itself is never touched, and needn't be there.
function detach(body, res) {
  const file = fileOf(body);
  const rel = filePathOf(body);
  const dir = dirOf(body);
  const todo = openTodo(dir, file, expectOf(body), true);
  const before = foldText(todo.text, file);
  const { head, body: lines } = textParts(before, file);
  const range = filesRange(lines);
  const hits = new Set();
  let name = '';
  if (range) {
    for (let i = range[0] + 1; i < range[1]; i++) {
      const link = fileLinkOf(lines[i]);
      if (link && link.path === rel) {
        hits.add(i);
        name = name || link.name;
      }
    }
  }
  if (hits.size === 0) return res.json({ ok: true, file, path: rel, changed: false });
  const out = removeFromFiles(lines, range, hits, head.length > 0);
  const words = dir === PERSONAL_DIR ? 'removed a file' : `removed a file: ${name}`;
  writeLogged(todo, file, before, [...head, ...out].join('\n'), autoEntry(logActor(body), words));
  res.json({ ok: true, file, path: rel, changed: true });
}

// ---- update, link and unlink (v0.7) -------------------------------------------------------------

// update: { file, text, scope?, expect?, by?, by_name?, via? } → a note added to "## Updates".
function update(body, res) {
  const file = fileOf(body);
  const text = updateTextOf(body.text, 'text');
  const todo = openTodo(dirOf(body), file, expectOf(body), true);
  replaceTodo(todo, withEntry(foldText(todo.text, file), file, noteEntry(logActor(body), text)));
  res.json({ ok: true, file });
}

// The URL a link or unlink names, checked.
function linkUrlOf(body) {
  const url = body.url;
  if (typeof url !== 'string' || url === '') throw new Refusal(400, 'url is required');
  if (!isLinkUrl(url)) {
    throw new Refusal(400, `url must be an http:// or https:// web address of at most ${LINK_URL_MAX} characters, with no spaces`);
  }
  return url;
}

// The link's name: `name` when sent (one line, at most LINK_NAME_MAX characters, no "[" or "]"),
// else the URL's host name without a leading "www.".
function linkNameOf(body, url) {
  const value = body.name;
  if (value !== undefined && value !== null) {
    if (typeof value !== 'string') throw new Refusal(400, 'name must be text');
    if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) throw new Refusal(400, 'name must be one line');
    const name = value.trim();
    if (name !== '') {
      if (name.length > LINK_NAME_MAX) throw new Refusal(400, `name is too long (over ${LINK_NAME_MAX} characters)`);
      if (/[[\]]/.test(name)) throw new Refusal(400, 'name can\'t hold "[" or "]"');
      return name;
    }
  }
  return new URL(url).hostname.replace(/^www\./i, '').replace(/[[\]]/g, '').slice(0, LINK_NAME_MAX);
}

// link: { file, url, name?, scope?, expect?, by?, by_name?, via? } → the web link added to "## Files".
function link(body, res) {
  const file = fileOf(body);
  const url = linkUrlOf(body);
  const name = linkNameOf(body, url);
  const line = `- [${name}](${/[()]/.test(url) ? `<${url}>` : url})`;
  const read = webLinkOf(line);
  if (!read || read.url !== url || read.name !== name) throw new Refusal(400, "that link can't be written");
  const dir = dirOf(body);
  const todo = openTodo(dir, file, expectOf(body), true);
  const before = foldText(todo.text, file);
  const { head, body: lines } = textParts(before, file);
  const links = parseLinks(lines.join('\n'));
  const there = links.find(l => l.url === url);
  if (there) return res.json({ ok: true, file, url, name: there.name, changed: false });
  if (links.length >= LINKS_MAX) throw new Refusal(400, `a to-do can have at most ${LINKS_MAX} links`);
  const out = addToFiles(lines, line, head.length > 0);
  const words = dir === PERSONAL_DIR ? 'added a link' : `added a link: ${name}`;
  writeLogged(todo, file, before, [...head, ...out].join('\n'), autoEntry(logActor(body), words));
  res.json({ ok: true, file, url, name, changed: true });
}

// unlink: { file, url, scope?, expect?, by?, by_name?, via? } → every line linking that exact URL
// removed, and the section once nothing is left in it. A URL not linked is a no-op.
function unlink(body, res) {
  const file = fileOf(body);
  const url = linkUrlOf(body);
  const dir = dirOf(body);
  const todo = openTodo(dir, file, expectOf(body), true);
  const before = foldText(todo.text, file);
  const { head, body: lines } = textParts(before, file);
  const range = filesRange(lines);
  const hits = new Set();
  let name = '';
  if (range) {
    for (let i = range[0] + 1; i < range[1]; i++) {
      const found = webLinkOf(lines[i]);
      if (found && found.url === url) {
        hits.add(i);
        name = name || found.name;
      }
    }
  }
  if (hits.size === 0) return res.json({ ok: true, file, url, changed: false });
  const out = removeFromFiles(lines, range, hits, head.length > 0);
  const words = dir === PERSONAL_DIR ? 'removed a link' : `removed a link: ${name}`;
  writeLogged(todo, file, before, [...head, ...out].join('\n'), autoEntry(logActor(body), words));
  res.json({ ok: true, file, url, changed: true });
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

// Every folder a to-do of a given name may be in: a new name is free in all of them (BCR-14), so it
// can be ticked, deleted or moved between TDS and personal later (v0.4).
const NAME_FOLDERS = [TODO_DIR, PERSONAL_DIR].flatMap(dir => ['', 'done', 'deleted'].map(sub => path.join(dir, sub)));

// POST /api/todos/add: writes todo/YYYYMMDD-<slug>.md with the standard frontmatter.
// Assignee defaults to this machine's git user (slugified); `open: true` leaves it open.
// v0.4: `scope: "personal"` writes personal/todo/ instead, always for the adder.
// v0.5: a string `body` becomes the new to-do's details.
function add(body, res) {
  const title = titleOf(body);
  const due = dueOf(body);
  const details = typeof body.body === 'string' ? body.body.replace(/\r\n/g, '\n').trim() : '';
  if (details.length > DETAILS_MAX) {
    throw new Refusal(400, `details are too long (over ${DETAILS_MAX} characters)`);
  }
  refuseFilesHeading(details);
  // v0.7: only this script writes the log.
  if (hasUpdatesHeading(details)) throw new Refusal(400, UPDATES_IN_DETAILS);
  const scope = scopeValue(body.scope, 'scope');
  const open = body.open === true;
  const adder = adderOf(body);
  let assignee;
  if (scope === 'personal') {
    if (open) throw new Refusal(400, "a personal to-do can't be open to anyone");
    const asked = workbenchSlug(body.assignee);
    if (asked && asked !== adder) throw new Refusal(400, 'a personal to-do can only be for the person adding it');
    if (!adder) throw new Refusal(400, 'a personal to-do needs to know who is adding it: send by');
    assignee = adder;
  } else {
    assignee = open ? '' : assigneeOf(body);
  }
  const via = viaOf(body);
  const placed = projectFieldsOf(body, scope);
  const dir = dirOfScope(scope);

  const d = now();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // No git identity → leave the todo open. The default is not checked against the team.
  if (!assignee && !open) assignee = workbenchSlug(gitUserName());

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'todo';
  fs.mkdirSync(dir, { recursive: true });
  if (scope === 'personal') requireInside(dir, PERSONAL_DIR);
  const fm = ['---'];
  if (assignee) fm.push('assignee: ' + assignee);
  // v0.7: created_at, the moment in UK time with its offset, like assigned_at.
  const made = ukTime(d);
  fm.push('title: ' + yamlText(title), 'created: ' + today, `created_at: ${made.date}T${made.time}:${made.seconds}${made.offset}`);
  if (adder) fm.push('created_by: ' + adder);
  if (due) fm.push('due: ' + due);
  for (const [key, value] of projectLines(placed)) if (value !== null) fm.push(`${key}: ${value}`);
  fm.push('source: ' + yamlText(via ? `added from ${via}` : 'added with the todo skill'));
  // Made for someone else: a handover, with nobody it came from.
  if (adder && assignee && assignee !== adder) {
    fm.push(...handoverRecord({ to: assignee, by: adder, via: via || 'todo skill', at: d }));
  }
  fm.push('---', '');
  const text = fm.join('\n') + (details ? `\n${details}\n` : '');

  const stem = `${today.replace(/-/g, '')}-${slug}`;
  for (let n = 1; ; n++) {
    const file = n === 1 ? `${stem}.md` : `${stem}-${n}.md`;
    if (NAME_FOLDERS.some(folder => fs.existsSync(path.join(folder, file)))) continue;
    if (scope === 'personal') requireIgnored([path.join(dir, file)]);
    try {
      createFile(path.join(dir, file), text);
      return res.json({ ok: true, file });
    } catch (err) {
      // Another writer took the name between the check and the link: try the next one.
      if (err.code !== 'EEXIST' || n >= 1000) throw err;
    }
  }
}

// POST /api/todos/due: rewrites the `due:` line (adds a frontmatter block if none).
// v0.7: every copy of the line goes before one is written; a real change is logged, none writes nothing.
function due(body, res) {
  const file = fileOf(body);
  const due = dueOf(body);
  const todo = openTodo(dirOf(body), file, expectOf(body), true);
  const before = foldText(todo.text, file);
  // The last copy, as every reader takes it.
  const old = String(parseFrontmatter(before).frontmatter.due || '');
  if (old === due) return res.json({ ok: true, file, due: due || null });
  let words;
  if (!old) words = `set the due date to ${shortDate(due)}`;
  else if (!due) words = `cleared the due date (it was ${shortDate(old)})`;
  else words = `changed the due date from ${shortDate(old)} to ${shortDate(due)}`;
  writeLogged(todo, file, before, setFrontmatterLines(before, [['due', due || null]]), autoEntry(logActor(body), words));
  res.json({ ok: true, file, due: due || null });
}

// POST /api/todos/assignee: rewrites the `assignee:` line (adds one if missing;
// clearing removes it, which leaves the todo open).
// v0.4: a real change is stamped as a handover (see stampHandover); no change writes nothing.
// v0.7: `note` is logged in the same write (a note with no change → 400); `back: true` is a hand back.
// The last `assignee:` copy is the one read, and every other copy goes.
function assignee(body, res) {
  const file = fileOf(body);
  const scope = scopeValue(body.scope, 'scope');
  if (scope === 'personal') throw new Refusal(400, "a personal to-do can't be passed on: move it to TDS first");
  const assignee = assigneeOf(body);
  const note = noteOf(body);
  if (body.back !== undefined && body.back !== true) throw new Refusal(400, 'back must be true');
  const back = body.back === true;
  if (back && !assignee) throw new Refusal(400, 'a to-do can only be handed back to a person');
  const todo = openTodo(TODO_DIR, file, expectOf(body), true);
  let content = foldText(todo.text, file);
  let from = '';
  const unchanged = () => {
    if (note) {
      throw new Refusal(400, assignee
        ? `nothing to pass on: the to-do is already with ${assignee}`
        : 'nothing to pass on: the to-do is already open to anyone');
    }
    return res.json({ ok: true, file, assignee: assignee || null });
  };
  if (/^---\n/.test(content)) {
    const lines = content.split('\n');
    const close = closingLine(lines);
    const copies = [];
    for (let i = 1; i < close; i++) { if (/^assignee:/.test(lines[i])) copies.push(i); }
    if (copies.length > 0) from = workbenchSlug(unquote(lines[copies[copies.length - 1]].slice('assignee:'.length)));
    if (from === assignee) return unchanged();
    for (const i of copies.slice(1).reverse()) lines.splice(i, 1);
    const idx = copies.length > 0 ? copies[0] : -1;
    if (idx !== -1) { if (assignee) lines[idx] = 'assignee: ' + assignee; else lines.splice(idx, 1); }
    else if (assignee) lines.splice(1, 0, 'assignee: ' + assignee);
    content = lines.join('\n');
  } else if (assignee) {
    content = `---\nassignee: ${assignee}\n---\n\n` + content;
  } else {
    return unchanged();
  }
  content = stampHandover(content, {
    to: assignee,
    from,
    by: actor(body),
    via: viaOf(body) || 'todo skill',
    at: now(),
    back,
  });
  if (note) content = withEntry(content, file, noteEntry(logActor(body), note));
  replaceTodo(todo, content);
  res.json({ ok: true, file, assignee: assignee || null });
}

// POST /api/todos/edit: rewrites the `title:` line (adds one if missing; creates a
// frontmatter block if none). A string `body` replaces everything below the frontmatter.
// A real title change also follows todo/AGENTS.md (see retitleBody). The reply's `body` is the
// details as written, title history included (v0.7: without the "## Updates" log).
// v0.5: with `keep_files: true`, `body` is the details only: the "## Files" section on disk is put
// back (see placeSection), and a body holding that heading is refused.
// v0.7: the "## Updates" section on disk is always kept (an incoming one is dropped; with none on
// disk, a body holding that heading is refused), the last `title:` copy is the one read and every
// other copy goes, and a real change is logged.
function edit(body, res) {
  const file = fileOf(body);
  const title = titleOf(body);
  // Optional: the long description. Omit the field to leave the body alone.
  const hasBody = typeof body.body === 'string';
  const sent = hasBody ? body.body.replace(/\r\n/g, '\n').trim() : null;
  // An "## Updates" section sent back (an older app shows it in the details) never reaches the file,
  // so the limit counts the body without it.
  const sentLog = hasBody && hasUpdatesHeading(sent);
  const newBody = sentLog ? cutSections(sent, [UPDATES_HEADING]).details : sent;
  if (hasBody && newBody.length > DETAILS_MAX) {
    throw new Refusal(400, `details are too long (over ${DETAILS_MAX} characters)`);
  }
  const keepFiles = hasBody && body.keep_files === true;
  if (keepFiles) refuseFilesHeading(newBody);
  const todo = openTodo(dirOf(body), file, expectOf(body), true);
  const before = foldText(todo.text, file);
  const titleLine = 'title: ' + yamlText(title);
  let headLines = null; // the frontmatter lines, when the file has a block
  let prefix = ''; // else the new block put in front
  let oldBody;
  let newBodyLines;
  let oldTitle = '';
  if (/^---\n/.test(before)) {
    const lines = before.split('\n');
    let close = closingLine(lines);
    const copies = [];
    for (let i = 1; i < close; i++) { if (/^title:/.test(lines[i])) copies.push(i); }
    if (copies.length > 0) {
      oldTitle = unquote(lines[copies[copies.length - 1]].slice('title:'.length));
      for (const i of copies.slice(1).reverse()) { lines.splice(i, 1); close--; }
      lines[copies[0]] = titleLine;
    } else {
      lines.splice(1, 0, titleLine);
      close++;
    }
    headLines = lines.slice(0, close + 1);
    oldBody = lines.slice(close + 1);
    newBodyLines = newBody ? ['', ...newBody.split('\n'), ''] : [''];
  } else {
    prefix = `---\n${titleLine}\n---\n\n`;
    oldBody = before.split('\n');
    newBodyLines = hasBody ? [...newBody.split('\n'), ''] : null;
  }
  const oldText = oldBody.join('\n');
  const log = cutSections(oldText, [UPDATES_HEADING]).sections[0];
  // Told rather than losing text: with no log on disk, the heading can only be the person's own.
  if (sentLog && !log) throw new Refusal(400, UPDATES_IN_DETAILS);
  if (!oldTitle) {
    const heading = firstHeading(oldBody);
    oldTitle = heading ? heading.text : '';
  }
  let bodyLines = retitleBody(hasBody ? newBodyLines : oldBody, oldTitle, title);
  const kept = keepFiles ? splitFiles(oldText).files : '';
  if (kept) bodyLines = placeSection(bodyLines, kept.split('\n'), headLines !== null);
  if (hasBody && log) bodyLines = placeUpdates(bodyLines, log.split('\n'), headLines !== null);
  const titleChanged = oldTitle !== title;
  const oldDetails = (keepFiles ? splitSections(oldText) : cutSections(oldText, [UPDATES_HEADING])).details;
  const detailsChanged = hasBody && newBody !== oldDetails;
  let words = 'changed the details';
  if (titleChanged) words = detailsChanged ? 'changed the title and the details' : 'changed the title';
  const text = headLines ? [...headLines, ...bodyLines].join('\n') : prefix + bodyLines.join('\n');
  // Only a real change is written (and logged): the same title and details write nothing, even when
  // the bytes would differ (a doubled title: line, quoting).
  const real = (titleChanged || detailsChanged) && text !== before;
  const written = real ? withEntry(text, file, autoEntry(logActor(body), words)) : before;
  if (real) replaceTodo(todo, written);
  // The details as written, as before: the log is left out, as an older app never sent it.
  const reply = hasBody ? cutSections(textParts(written, file).body.join('\n'), [UPDATES_HEADING]).details : undefined;
  res.json({ ok: true, file, title, body: reply });
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

// Who is adding or moving a to-do, as a slug: `by`, else the git user; '' when neither is known.
function adderOf(body) {
  return workbenchSlug(oneLine(body.by)) || workbenchSlug(gitUserName());
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
// v0.7: `note` (tick only) is logged in the same write; doubled sections are folded first.
function moveStamped(body, res, folder, stamp, note) {
  const file = fileOf(body);
  const home = dirOf(body);
  const todo = openTodo(home, file, expectOf(body), false);
  const via = viaOf(body) || 'todo skill';
  // A file with frontmatter that never closes is still ticked or deleted, as before: its text is all body.
  const { head, body: lines } = looseParts(todo.text);
  let bodyLines = foldSections(lines);
  if (note) bodyLines = addEntry(bodyLines, noteEntry(logActor(body), note), head.length > 0);
  // Untouched otherwise, so its bytes (line endings and all) are stamped as before.
  const source = bodyLines === lines ? todo.bytes.toString('utf8') : encodeFile(todo.shape, [...head, ...bodyLines].join('\n'));
  const stamped = stamp(source, actor(body), via, now());
  const dir = path.join(home, folder);
  fs.mkdirSync(dir, { recursive: true });
  // A personal one stays private: its done/ or deleted/ folder is real and every name is ignored.
  const create = (dest) => {
    if (home === PERSONAL_DIR) requirePrivate(dest);
    createFile(dest, stamped);
  };
  let dest = path.join(dir, file);
  try {
    create(dest);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    dest = path.join(dir, file.replace(/\.md$/, `-${Date.now()}.md`));
    create(dest);
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

// tick: { file, scope?, expect?, via?, by?, by_name? } → todo/done/ (or personal/todo/done/),
// stamped as the app's own tick.
// v0.7: an optional `note` is logged under "## Updates" in the done copy.
function tick(body, res) {
  const note = noteOf(body);
  moveStamped(body, res, 'done', stampDone, note);
}

// delete: { file, scope?, expect?, via?, by?, by_name? } → todo/deleted/ (or personal/todo/deleted/),
// stamped.
function remove(body, res) {
  moveStamped(body, res, 'deleted', stampDeleted);
}

// ---- handover (v0.4) ----------------------------------------------------------------------
//
// Passing a to-do on records who passed it, when, from whom and with which tool: in the frontmatter
// for tools (the app shows "Passed to you by …"), replacing an earlier record, and as one line under
// "## Handover history" for people. Readers that don't know these keys skip them.

const HANDOVER_KEY_LINE = /^assigned_[A-Za-z0-9_-]*\s*:/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The frontmatter lines. `from` is left out when undefined (a new to-do came from nobody).
// v0.7: `back` (a hand back) adds `assigned_back: true`.
function handoverRecord({ to, from, by, via, at, back }) {
  const when = ukTime(at);
  const lines = [
    `assigned_to: ${to || 'open'}`,
    `assigned_at: ${when.date}T${when.time}:${when.seconds}${when.offset}`,
    `assigned_by: ${by}`,
  ];
  if (from !== undefined) lines.push(`assigned_from: ${from || 'open'}`);
  if (back) lines.push('assigned_back: true');
  lines.push(`assigned_via: ${yamlValue(via)}`);
  return lines;
}

// "- 13 Nov 2026, 14:05 UK: Ben McAdam passed it from ben-mcadam to ian-hancock (TDS Brain App)."
// v0.7: a hand back reads "handed it back to <slug>".
function handoverLine({ to, from, by, via, at, back }) {
  const when = ukTime(at);
  const [y, m, d] = when.date.split('-');
  let what;
  if (back) what = `handed it back to ${to}`;
  else if (!to) what = `made it open to anyone; it was with ${from}`;
  else if (!from && to === by.slug) what = 'picked it up from the open list';
  else if (!from) what = `passed it from the open list to ${to}`;
  else what = `passed it from ${from} to ${to}`;
  return `- ${Number(d)} ${MONTHS[Number(m) - 1]} ${y}, ${when.time} UK: ${by.name} ${what} (${via}).`;
}

// `text` (plain \n lines, starting with a frontmatter block) with the handover recorded.
function stampHandover(text, change) {
  const lines = text.split('\n');
  const close = closingLine(lines);
  const head = [];
  let dropping = false;
  for (const line of lines.slice(1, close)) {
    if (HANDOVER_KEY_LINE.test(line)) { dropping = true; continue; }
    // ... and the rest of an earlier multi-line value, as stampRecord does.
    if (dropping && (line.trim() === '' || /^\s/.test(line) || /^-\s/.test(line))) continue;
    dropping = false;
    head.push(line);
  }
  const record = handoverRecord({ ...change, by: change.by.slug });
  const bodyLines = lines.slice(close + 1);
  addToSection(bodyLines, 'Handover history', handoverLine(change));
  return ['---', ...head, ...record, '---', ...bodyLines].join('\n');
}

// ---- move (v0.4) ---------------------------------------------------------------------------

// move: { file, scope?, to, expect?, by?, by_name?, via? } → the same bytes in the other folder
// (todo/ ↔ personal/todo/), nothing stamped, so its version is unchanged. Only the person it's
// assigned to may move it. A name taken there gets -2, -3, …
function move(body, res) {
  const file = fileOf(body);
  const scope = scopeValue(body.scope, 'scope');
  // Unlike scope, `to` has no default.
  const to = scopeValue(body.to == null ? '' : body.to, 'to');
  if (to === scope) throw new Refusal(400, 'to must differ from scope');
  const fromDir = dirOfScope(scope);
  const toDir = dirOfScope(to);
  const todo = openTodo(fromDir, file, expectOf(body), false);
  const owner = workbenchSlug(parseFrontmatter(stripBom(todo.text)).frontmatter.assignee);
  const mover = adderOf(body);
  if (!owner || !mover || owner !== mover) {
    throw new Refusal(400, to === 'personal'
      ? 'only your own to-dos can be made personal'
      : 'only your own personal to-dos can be moved to TDS');
  }
  // v0.6 (overseer B2): a private project name never goes to todo/, where git syncs it.
  if (body.dropProject !== undefined && body.dropProject !== true) throw new Refusal(400, 'dropProject must be true');
  let data = todo.bytes;
  if (to === 'tds') {
    if (body.dropProject === true) {
      const text = withoutProjectTraces(todo.text);
      if (text !== todo.text) data = Buffer.from(encodeFile(todo.shape, text), 'utf8');
    } else {
      const trace = personalProjectTrace(todo.text);
      if (trace) throw new Refusal(403, trace);
    }
  }
  fs.mkdirSync(toDir, { recursive: true });
  requireInside(toDir, to === 'personal' ? PERSONAL_DIR : TODO_DIR);
  let name = file;
  for (let n = 2; ; n++) {
    try {
      if (to === 'personal') requireIgnored([path.join(toDir, name)]);
      createFile(path.join(toDir, name), data, todo.mode);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST' || n >= 1000) throw err;
      name = file.replace(/\.md$/, `-${n}.md`);
    }
  }
  const dest = path.join(toDir, name);
  try {
    fs.unlinkSync(todo.abs);
  } catch (err) {
    // Never leave it in both lists.
    fs.rmSync(dest, { force: true });
    throw err;
  }
  res.json({ ok: true, file: name, moved: path.relative(BRAIN_ROOT, dest) });
}

// ---- move to TDS: nothing from a personal project goes with it (v0.6 review fix) -----------------
//
// The app's reader (server/brain/frontmatter.ts) is lenient: `project : x` is a project line, and so
// is `project:` with `- x` items under it. These helpers read the same way, so nothing it would show
// as a project is missed, and they read a little more widely still (any letter case).

const PERSONAL_PROJECTS_PREFIX = 'personal/projects/';

// The closing `---` as the app's reader finds it (a line that is `---` once trimmed), or -1.
function readerClose(lines) {
  if (lines.length === 0 || lines[0].trim() !== '---') return -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') return i;
  return -1;
}

// Each `<key>:` frontmatter entry as [its line, the line after its last continuation line].
// Continuation lines are indented or `- ` items, with any blank lines between them.
function entrySpans(lines, close, key) {
  const keyLine = new RegExp(`^${key}\\s*:`, 'i');
  const spans = [];
  for (let i = 1; i < close; i++) {
    if (!keyLine.test(lines[i])) continue;
    let end = i + 1;
    for (let j = i + 1; j < close; j++) {
      if (lines[j].trim() === '') continue;
      if (!/^\s/.test(lines[j]) && !/^-\s/.test(lines[j])) break;
      end = j + 1;
    }
    spans.push([i, end]);
    i = end - 1;
  }
  return spans;
}

// Every value the `project:` entries hold, lower case: inline, `[a, b]` lists and `- ` items.
function projectTokens(lines, close) {
  const out = [];
  for (const [start, end] of entrySpans(lines, close, 'project')) {
    const parts = [lines[start].slice(lines[start].indexOf(':') + 1)];
    for (let j = start + 1; j < end; j++) parts.push(lines[j].trim().replace(/^-\s*/, ''));
    for (const part of parts) {
      let value = unquote(part);
      if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
      for (const item of value.split(',')) {
        const token = unquote(item).replace(/\s*\/\s*/g, '/').toLowerCase();
        if (token !== '') out.push(token);
      }
    }
  }
  return out;
}

// The names of this Mac's personal project folders, lower case.
function personalProjectNames() {
  try {
    return new Set(fs.readdirSync(path.join(BRAIN_ROOT, 'personal', 'projects')).map(n => n.toLowerCase()));
  } catch {
    return new Set();
  }
}

// The lines of the body's "## Files" section that point under personal/projects/, and the section.
// v0.7: every "## Files" section is checked (`range` is the first, the only one once folded).
function personalFileLines(bodyLines) {
  const range = filesRange(bodyLines);
  const hits = new Set();
  for (const i of sectionLineIndexes(bodyLines, FILES_HEADING)) {
    if (bodyLines[i].toLowerCase().includes(PERSONAL_PROJECTS_PREFIX)) hits.add(i);
  }
  return { range, hits };
}

// Why this to-do can't go to the team as it is, or null: its `project:` names a personal project
// (a personal/ key, or the bare name of one of this Mac's personal projects), or its "## Files"
// section links something in one.
function personalProjectTrace(text) {
  const lines = text.split('\n');
  const close = readerClose(lines);
  if (close !== -1) {
    const names = personalProjectNames();
    if (projectTokens(lines, close).some(t => t.startsWith('personal/') || names.has(t))) {
      return 'this to-do is in a personal project: moving it to the team takes it out of that project';
    }
  }
  if (personalFileLines(lines.slice(close + 1)).hits.size > 0) {
    return 'this to-do links a file in a personal project: moving it to the team takes that link off';
  }
  return null;
}

// The to-do without its `project:` and `stage:` entries, whatever they hold, and without the
// "## Files" lines under personal/projects/ (the section goes once nothing is left in it).
function withoutProjectTraces(text) {
  let lines = text.split('\n');
  const close = readerClose(lines);
  let bodyStart = 0;
  if (close !== -1) {
    const drop = new Set();
    for (const key of ['project', 'stage']) {
      for (const [start, end] of entrySpans(lines, close, key)) for (let i = start; i < end; i++) drop.add(i);
    }
    lines = lines.filter((_, i) => !drop.has(i));
    bodyStart = close - drop.size + 1;
  }
  const head = lines.slice(0, bodyStart);
  // v0.7: doubled "## Files" sections folded first, so every such line is in the one section.
  let body = foldSections(lines.slice(bodyStart));
  const { range, hits } = personalFileLines(body);
  if (hits.size > 0) {
    body = body.filter((_, i) => !hits.has(i));
    const end = range[1] - hits.size;
    if (body.slice(range[0] + 1, end).every(l => l.trim() === '')) body = dropSection(body, range[0], end, head.length > 0);
  }
  return [...head, ...body].join('\n');
}

// ---- projects (v0.6) ---------------------------------------------------------------------------
//
// The app's shared/projects-contract.ts has the key format and the folders; tdsapp-projects writes
// the cards. This script only writes a to-do's own `client:`, `project:` and `stage:` lines.

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY_PATTERN = /^(personal|[a-z0-9]+(-[a-z0-9]+)*)\/[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY_SEGMENT_MAX = 60;
const STAGE_MAX = 40;
const INTERNAL_CLIENT = 'the-digital-stride';
const PRIVATE_PROJECT = "a team to-do can't be in a personal project";

// Every folder a key may name, in the app's reader order.
function projectFolders(client, slug) {
  if (client === 'personal') return [`personal/projects/${slug}`];
  const live = [`clients/${client}/projects/${slug}`];
  if (client === INTERNAL_CLIENT) live.push(`projects/${slug}`, `projects-archive/${slug}`);
  return [...live, `clients/_archive/${client}/projects/${slug}`];
}

function projectExists(client, slug) {
  return projectFolders(client, slug).some((rel) => {
    try {
      return fs.statSync(path.join(BRAIN_ROOT, ...rel.split('/'))).isDirectory();
    } catch {
      return false;
    }
  });
}

// '' or null → null; otherwise the value, which must be text.
function optionalText(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Refusal(400, `${name} must be text`);
  return value;
}

// The client, project and stage a request sets, checked; all null when none are sent. A personal
// key on a TDS to-do is refused with 403 (decision 8).
function projectFieldsOf(body, scope) {
  const client = optionalText(body.client, 'client');
  const key = optionalText(body.project, 'project');
  const rawStage = optionalText(body.stage, 'stage');
  if (client !== null && (client === 'personal' || client.length > KEY_SEGMENT_MAX || !SLUG_PATTERN.test(client))) {
    throw new Refusal(400, 'client must be a client folder name');
  }
  let stage = null;
  if (rawStage !== null) {
    if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(rawStage)) throw new Refusal(400, 'stage must be one line');
    stage = rawStage.trim();
    if (!stage) throw new Refusal(400, 'stage must not be blank');
    if (stage.length > STAGE_MAX) throw new Refusal(400, `stage is too long (over ${STAGE_MAX} characters)`);
    if (needsQuotes(stage) && stage.includes('"') && stage.includes("'")) {
      throw new Refusal(400, "stage can't hold both kinds of quote mark");
    }
  }
  if (key === null) {
    if (stage !== null) throw new Refusal(400, 'a stage needs a project');
    return { client, project: null, stage: null };
  }
  const at = key.indexOf('/');
  if (!KEY_PATTERN.test(key) || at > KEY_SEGMENT_MAX || key.length - at - 1 > KEY_SEGMENT_MAX) {
    throw new Refusal(400, 'project must be <client>/<project> or personal/<project>');
  }
  const owner = key.slice(0, at);
  const slug = key.slice(at + 1);
  if (owner === 'personal') {
    if (scope === 'tds') throw new Refusal(403, PRIVATE_PROJECT);
    if (client !== null) throw new Refusal(400, 'a personal project has no client');
  } else if (client !== owner) {
    throw new Refusal(400, `client must be the project's client (${owner})`);
  }
  if (!projectExists(owner, slug)) throw new Refusal(400, 'there is no project ' + key);
  return { client, project: key, stage };
}

// The three lines as [key, written value or null].
function projectLines(placed) {
  return [
    ['client', placed.client],
    ['project', placed.project],
    ['stage', placed.stage === null ? null : yamlText(placed.stage)],
  ];
}

// `text` (plain \n lines) with each [key, value] frontmatter line set: replaced where it is (with any
// continuation lines and later copies dropped), removed for null, or added after the line set just
// before it, else before the closing `---`. No frontmatter block: one is added when there is a value.
function setFrontmatterLines(text, pairs) {
  if (!/^---\n/.test(text)) {
    const set = pairs.filter(([, v]) => v !== null);
    if (set.length === 0) return text;
    return `---\n${set.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n` + text;
  }
  const lines = text.split('\n');
  if (closingLine(lines) === -1) throw new Refusal(500, 'unterminated frontmatter');
  let after = -1;
  for (const [key, value] of pairs) {
    const keyLine = new RegExp(`^${key}\\s*:`);
    let close = closingLine(lines);
    let idx = -1;
    for (let i = 1; i < close; i++) {
      if (!keyLine.test(lines[i])) continue;
      // The line and its continuation lines (indented or "- item"), as stampRecord drops them.
      let end = i + 1;
      while (end < close && lines[end].trim() !== '' && (/^\s/.test(lines[end]) || /^-\s/.test(lines[end]))) end++;
      if (idx === -1) {
        idx = i;
        lines.splice(i + 1, end - i - 1);
      } else {
        lines.splice(i, end - i);
        i--;
      }
      close = closingLine(lines);
    }
    if (idx !== -1) {
      if (value === null) {
        lines.splice(idx, 1);
        if (after >= idx) after--;
        continue;
      }
      lines[idx] = `${key}: ${value}`;
      after = idx;
    } else if (value !== null) {
      const at = after !== -1 ? after + 1 : close;
      lines.splice(at, 0, `${key}: ${value}`);
      after = at;
    }
  }
  return lines.join('\n');
}

// project: { file, scope?, client, project, stage, expect? } → the three lines set together.
function project(body, res) {
  const file = fileOf(body);
  const scope = scopeValue(body.scope, 'scope');
  const placed = projectFieldsOf(body, scope);
  const todo = openTodo(dirOfScope(scope), file, expectOf(body), true);
  const before = foldText(todo.text, file);
  // v0.7: logged without naming the project, its client or its stage.
  writeLogged(todo, file, before, setFrontmatterLines(before, projectLines(placed)), autoEntry(logActor(body), 'changed the project'));
  res.json({ ok: true, file, client: placed.client, project: placed.project, stage: placed.stage });
}

// capabilities: {} → what this script can do, so a caller can tell v0.4 from v0.3 (which answers
// "unknown command"), v0.5 ("attach") from v0.4, v0.6 ("todo-project-v1") from v0.5, v0.7
// ("updates-v1", "links-v1") from v0.6, and whether
// personal to-dos are safe to use here.
function capabilities(body, res) {
  const features = ['handover', 'attach', PROJECT_CAPABILITY, UPDATES_CAPABILITY, LINKS_CAPABILITY];
  if (!personalProblem()) features.push('scope');
  res.json({ version: SCRIPT_VERSION, features });
}

// ---- command line -----------------------------------------------------------

const COMMANDS = {
  add, edit, due, assignee, delete: remove, tick, move, attach, detach, project, update, link, unlink, roster,
  list, capabilities,
};

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

// The "## Files" and (v0.7) "## Updates" read rules, for the app repo's tests (they set
// globalThis.TDSAPP_TODO_LIBRARY before requiring this file, so no command runs). Run directly or
// through the `todo` shim, as before.
module.exports = {
  parseFiles, splitFiles, resolveFilePath, isNeverListed, LIBRARY_EXTENSIONS,
  parseLinks, fileExtras, parseUpdates, parseHandovers, timeline, splitSections, isLinkUrl, ukWallToIso,
};

if (!globalThis.TDSAPP_TODO_LIBRARY) {
  // Read stdin to the end first, so a caller writing a body never meets a closed pipe.
  const chunks = [];
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    run(process.argv[2] || '', Buffer.concat(chunks).toString('utf8'));
  };
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', start);
  process.stdin.on('error', start);
}
