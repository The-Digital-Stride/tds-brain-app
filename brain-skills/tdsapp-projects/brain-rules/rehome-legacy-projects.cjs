#!/usr/bin/env node
// One-off migration: moves the old top-level project folders into their new homes.
// Plan: docs/plans/2026-11-22-rehome-legacy-projects.md, decision 2 (sync 2).
//
//   node rehome-legacy-projects.cjs --brain <path> [--apply] [--by "Ian Hancock"] [--skip-workbench-check]
//
// - Default is a dry run: prints a numbered list of what it would do and writes nothing in the brain.
//   (Preflight checks each to-do payload with the brain's own tdsapp-todo script in a throwaway
//   folder under the system temp folder, never in the brain.)
// - --apply does it. Each step checks the current state first, so a rerun after a crash finishes
//   the job without doubling anything, and a rerun after success changes nothing.
// - Never runs git. To-dos are only made through <brain>/.claude/skills/tdsapp-todo (never written
//   here). Folders move with fs.renameSync; edited files keep their bytes apart from the edit and are
//   written atomically (temp file, then rename).
// - The last line of output is a JSON summary. Exit 0 on success, 2 on a preflight refusal (each
//   reason listed), 1 on an unexpected failure part-way (rerun to resume).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// ---- the fixed facts of this move (plan, decision 2) --------------------------------------------

const INTERNAL_CLIENT = 'the-digital-stride';
const NEW_BASE = `clients/${INTERNAL_CLIENT}/projects`;
const LIVE = [
  'agency-brian-google-ads-manager',
  'ai-blueprint',
  'ai-in-your-stride',
  'ai-search-outreach',
  'brain-map',
  'client-portal',
  'gads-api-writes',
  'supermetrics-studio',
];
// Files git doesn't share stay at the old path on every Mac (decision 2, "Move the folders").
const STAY_BEHIND = {
  'ai-search-outreach': ['inbox', 'shortlists'],
  'brain-map': ['node_modules'],
};
const ARCHIVES = [
  {
    slug: 'uc-multiple-condenser-functionality',
    from: 'projects-archive/uc-multiple-condenser-functionality',
    to: 'clients/urban-cooling/projects-archive/uc-multiple-condenser-functionality',
  },
  {
    slug: 'aesop-funnel-report',
    from: 'projects-archive/aesop-funnel-report',
    to: `clients/${INTERNAL_CLIENT}/projects-archive/aesop-funnel-report`,
  },
];
// Checklist items that already name their to-do: ticked with that pointer, never added.
const POINTERS = {
  'agency-brian-google-ads-manager': ['todo/20261116-ads-manager-gate-closes-the-loop.md'],
};
const STEVE = {
  slug: 'ai-search-outreach',
  assignee: 'steve-blassberg',
  title: 'Move your own AI Search Outreach files into the new project folder',
  body:
    'Once your Mac has synced, anything still in `projects/ai-search-outreach/` on your Mac is private to you: '
    + 'files git does not share, such as `inbox/`, `shortlists/`, prospect screenshots and approval lists. '
    + 'The project move left them where they were and touched nothing of yours. Move them into the same '
    + 'folders under `clients/the-digital-stride/projects/ai-search-outreach/`, where they stay private.\n\n'
    + 'Leave these four files where they are, and keep the old folder while they are in it: '
    + '`inbox/test.json` and `shortlists/2026-08-14/findings.json`, `qualified.json` and `review.html`. '
    + 'Git shares those four, so moving or deleting them removes them from everyone\'s Mac. '
    + '`todo/20261118-ask-steve-about-untracking-four-ai-search-outreach-files.md` says what to do with them.',
};

const VIA = 'project move';
const SOURCE = `added from ${VIA}`;
const TODO_SCRIPT = '.claude/skills/tdsapp-todo/scripts/tdsapp-todo.cjs';
const WORKBENCH_FILE = 'tools/members/command-centre/lib/todo-parser.cjs';
const WORKBENCH_MARKER = 'cardProjectsV2';
const IGNORE_LINE = '/projects/ai-search-outreach/';
const TITLE_MAX = 200;
const BODY_MAX = 8000;
const NOTE_PREFIX = 'Moved to to-dos on ';

// Relative paths that are one level deeper now (two folders deeper, in fact).
const DEPTH_FIXES = [
  { slug: 'ai-in-your-stride', file: 'build-kit.cjs', from: "path.resolve(HERE, '../..')", to: "path.resolve(HERE, '../../../..')" },
  { slug: 'ai-search-outreach', file: 'scripts/qualify.cjs', from: "path.resolve(__dirname, '../../..')", to: "path.resolve(__dirname, '../../../../..')" },
  { slug: 'ai-search-outreach', file: 'scripts/visibility-check.cjs', from: "path.resolve(__dirname, '../../..')", to: "path.resolve(__dirname, '../../../../..')" },
  { slug: 'ai-blueprint', file: 'README.md', from: '`../../plans/', to: '`../../../../plans/' },
  { slug: 'ai-blueprint', file: 'README.md', from: '`../../templates/', to: '`../../../../templates/' },
];
// Listed code edits outside the moved folders.
const CODE_EDITS = [
  {
    file: '.claude/skills/brainmap/scripts/open.cjs',
    from: "path.join(ROOT, 'projects', 'brain-map')",
    to: "path.join(ROOT, 'clients', 'the-digital-stride', 'projects', 'brain-map')",
  },
];

// ---- path matching ------------------------------------------------------------------------------

const SLUG_ALT = LIVE.join('|');
const ARCHIVE_ALT = ARCHIVES.map((a) => a.slug).join('|');
// `projects/<slug>` on a path boundary, not already under clients/<x>/ or personal/.
const BEFORE = '(?<![A-Za-z0-9_.-])(?<!clients/[^/\\s]+/)(?<!personal/)';
const AFTER = '(?![A-Za-z0-9_-])';
const rewriteRe = () => new RegExp(`${BEFORE}projects/(${SLUG_ALT})${AFTER}`, 'g');
const MENTION_RES = [
  new RegExp(`${BEFORE}projects/(${SLUG_ALT})${AFTER}`),
  new RegExp(`${BEFORE}projects-archive/(${ARCHIVE_ALT})${AFTER}`),
  new RegExp(`'projects',\\s*'(${SLUG_ALT})'`),
];

function mentionsMovedPath(text) {
  return MENTION_RES.some((re) => re.test(text));
}

// Rewrites `projects/<slug>` to its new place. In `.gitignore` only comment lines change: its
// rules for the old path (the leftovers) must stay as they are.
function rewriteText(rel, text) {
  if (path.posix.basename(rel) === '.gitignore') {
    const parts = text.split(/(\r?\n)/);
    for (let i = 0; i < parts.length; i += 2) {
      if (/^\s*#/.test(parts[i])) parts[i] = parts[i].replace(rewriteRe(), `${NEW_BASE}/$1`);
    }
    return parts.join('');
  }
  return text.replace(rewriteRe(), `${NEW_BASE}/$1`);
}

// Which moved folder a brain path is in, at either place: { slug, inner, at: 'old' | 'new' }.
function movedOf(rel) {
  for (const slug of LIVE) {
    for (const [at, base] of [['old', `projects/${slug}`], ['new', `${NEW_BASE}/${slug}`]]) {
      if (rel.startsWith(base + '/')) return { slug, inner: rel.slice(base.length + 1), at };
    }
  }
  return null;
}

const OUTSIDE_REWRITE = [
  /^\.claude\/skills\/(blueprint-builder|blueprint-intake|brainmap|gads-write)\//,
  /^templates\/blueprint\//,
  /^\.gitignore$/,
  /^brain-overrides\.md$/,
  /^context\/business\/services\/ai-blueprint-planning-progress\.md$/,
  /^clients\/urban-apothecary\/context\/business\.md$/,
  /^todo\/20261125-gads-write-[^/]*\.md$/,
];
const OUTSIDE_HISTORY_EXACT = new Set([
  'todo/20261118-ask-steve-about-untracking-four-ai-search-outreach-files.md',
  'tools/save-location-baseline.json',
]);
const MOVED_HISTORY_DIRS = new Set(['call-notes', 'notes', 'benchmarks', 'output']);
const MOVED_HISTORY_FILES = new Set(['graph.js', 'project.md']);

// 'rewrite', 'history' or null (on neither list). `ctx.ownTodos` holds the to-dos this migration
// made (Steve's names the old path on purpose); `ctx.self` is this script when it sits in the brain.
function classify(rel, ctx) {
  if (ctx && ctx.self && rel === ctx.self) return 'history';
  const moved = movedOf(rel);
  if (moved) {
    const segs = moved.inner.split('/');
    if (MOVED_HISTORY_DIRS.has(segs[0]) || MOVED_HISTORY_FILES.has(moved.inner)) return 'history';
    if ((STAY_BEHIND[moved.slug] || []).includes(segs[0])) return 'history';
    const base = segs[segs.length - 1];
    if (moved.inner === 'todo.md' || moved.inner === 'build-kit.cjs' || moved.inner === 'scan.cjs') return 'rewrite';
    if (base === 'README.md') return 'rewrite';
    if (segs[0] === 'scripts' && /\.c?js$/.test(base)) return 'rewrite';
    // Not in the plan's list: brain-map's page shows the scan command as usage text.
    if (moved.slug === 'brain-map' && moved.inner === 'index.html') return 'rewrite';
    return null;
  }
  for (const a of ARCHIVES) {
    if (rel.startsWith(a.from + '/') || rel.startsWith(a.to + '/')) return 'history';
  }
  const segs = rel.split('/');
  const base = segs[segs.length - 1];
  if (/changelog/i.test(base) || base === 'MYCHANGES.md') return 'history';
  if (rel.startsWith('.team-config/feedback/')) return 'history';
  if (segs[0] === 'clients' && segs.length > 3 && segs[2] === 'created') return 'history';
  // Client deliverables (the blueprint runs).
  if (segs[0] === 'clients' && segs.length > 3 && segs[2] === 'blueprint') return 'history';
  const dirs = segs.slice(0, -1);
  if (dirs.some((s) => s === 'call-notes' || s === 'notes' || s === 'plans' || s === '_archive')) return 'history';
  if (rel.startsWith('todo/done/') || rel.startsWith('todo/deleted/')) return 'history';
  // Dated daily briefings: records, like call notes (not named in the plan's list).
  if (segs[0] === 'briefing' && segs.length > 1) return 'history';
  if (OUTSIDE_HISTORY_EXACT.has(rel)) return 'history';
  if (ctx && ctx.ownTodos && ctx.ownTodos.has(rel)) return 'history';
  if (OUTSIDE_REWRITE.some((re) => re.test(rel))) return 'rewrite';
  return null;
}

// ---- small helpers ------------------------------------------------------------------------------

const abs = (brain, rel) => path.join(brain, ...rel.split('/'));
const exists = (p) => {
  try { fs.lstatSync(p); return true; } catch { return false; }
};
const isDir = (p) => {
  try { return fs.lstatSync(p).isDirectory(); } catch { return false; }
};
const TEMP_RE = /^\.rehome-.*\.tmp~$/;

function readUtf8(file) {
  const buf = fs.readFileSync(file);
  const text = buf.toString('utf8');
  return { buf, text, clean: Buffer.from(text, 'utf8').equals(buf) };
}

// Writes the whole file through a temp file in the same folder, keeping its mode.
function writeAtomic(file, text) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.rehome-${path.basename(file)}.${process.pid}.tmp~`);
  let mode;
  try { mode = fs.statSync(file).mode & 0o7777; } catch { mode = 0o644; }
  const fd = fs.openSync(tmp, 'wx', mode);
  try {
    fs.writeSync(fd, Buffer.from(text, 'utf8'));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function countOf(text, needle) {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
}

function frontmatter(text) {
  const t = text.replace(/^﻿/, '');
  if (!t.startsWith('---\n') && !t.startsWith('---\r\n')) return {};
  const lines = t.split(/\r?\n/);
  const fm = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') break;
    const m = lines[i].match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1);
    fm[m[1]] = v;
  }
  return fm;
}

function ukDate(d) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

const slugify = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The title as plain words (bold marks and backticks dropped, since to-do titles show as typed),
// cut at a word boundary to 200 characters with an ellipsis. `cut` says whether the title differs
// from the item's text, so the full text then goes in the details.
function cutTitle(text) {
  const spaced = String(text).replace(/\s+/g, ' ').trim();
  const clean = spaced.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`/g, '');
  if (clean.length <= TITLE_MAX) return { title: clean, cut: clean !== spaced };
  const room = TITLE_MAX - 1;
  let at = clean.lastIndexOf(' ', room);
  if (at <= 0) at = room;
  if (/[\uD800-\uDBFF]/.test(clean[at - 1])) at -= 1;
  const title = clean.slice(0, at).replace(/[\s,;:.–—-]+$/, '') + '…';
  return { title, cut: true };
}

// Test hook: REHOME_TEST_CRASH=after-add:3 stops the process straight after the third to-do is
// made, before its item is ticked (as a crash would).
const crashCounts = {};
function crashPoint(name) {
  const spec = process.env.REHOME_TEST_CRASH;
  if (!spec) return;
  const [point, n] = spec.split(':');
  if (point !== name) return;
  crashCounts[name] = (crashCounts[name] || 0) + 1;
  if (crashCounts[name] === Number(n || 1)) {
    process.stdout.write(`(test) crashed at ${name}:${n}\n`);
    process.exit(70);
  }
}

// ---- the brain's to-do script -------------------------------------------------------------------

function todoEnv(root) {
  const env = { ...process.env };
  for (const k of ['BRAIN_ROOT', 'WORKBENCH_AS', 'TDSAPP_TODO_TEST_FAIL', 'NODE_ENV']) delete env[k];
  env.BRAIN_ROOT = root;
  return env;
}

function runTodo(brain, root, command, payload) {
  const r = spawnSync(process.execPath, [abs(brain, TODO_SCRIPT), command], {
    input: JSON.stringify(payload || {}),
    env: todoEnv(root),
    encoding: 'utf8',
    timeout: 60000,
  });
  const lines = String(r.stdout || '').trim().split('\n');
  let reply = null;
  try { reply = JSON.parse(lines[lines.length - 1]); } catch { /* reported below */ }
  return { exit: r.status, reply, stderr: String(r.stderr || '').trim() };
}

// ---- reading the current state ------------------------------------------------------------------

// Where a live folder's file is now: the new place if it's there, else the old one.
function locate(brain, slug, inner) {
  const nu = `${NEW_BASE}/${slug}/${inner}`;
  const old = `projects/${slug}/${inner}`;
  if (exists(abs(brain, nu))) return nu;
  if (exists(abs(brain, old))) return old;
  return null;
}

// The `## Active` section of a todo.md: its line parts (text at even indexes, line breaks at odd).
function activeSection(text) {
  const parts = text.split(/(\r?\n)/);
  let start = -1;
  let end = parts.length;
  for (let i = 0; i < parts.length; i += 2) {
    if (start === -1) {
      if (/^##\s+Active\s*$/.test(parts[i])) start = i;
    } else if (/^#{1,2}\s/.test(parts[i])) {
      end = i;
      break;
    }
  }
  return { parts, start, end };
}

function openItems(text) {
  const { parts, start, end } = activeSection(text);
  const items = [];
  if (start === -1) return { items, hasSection: false, continuation: [] };
  const continuation = [];
  for (let i = start + 2; i < end; i += 2) {
    const m = parts[i].match(/^- \[ \] (.*\S)\s*$/);
    if (!m) continue;
    const next = parts[i + 2];
    if (i + 2 < end && next !== undefined && /^\s+\S/.test(next) && !/^\s*- \[/.test(next)) continuation.push(i / 2 + 1);
    items.push({ text: m[1], line: i / 2 + 1, partIndex: i });
  }
  return { items, hasSection: true, continuation };
}

// Ticks the first open item with this exact text, adding the pointer.
function tickItem(text, itemText, pointer) {
  const { parts, start, end } = activeSection(text);
  for (let i = start + 2; i < end; i += 2) {
    const m = parts[i].match(/^- \[ \] (.*\S)\s*$/);
    if (m && m[1] === itemText) {
      parts[i] = `- [x] ${itemText} → ${pointer}`;
      return parts.join('');
    }
  }
  return null;
}

function hasNote(text) {
  const { parts, start, end } = activeSection(text);
  if (start === -1) return true;
  for (let i = start + 2; i < end; i += 2) if (parts[i].startsWith(NOTE_PREFIX)) return true;
  return false;
}

function hasPointerLine(text) {
  const { parts, start, end } = activeSection(text);
  if (start === -1) return false;
  for (let i = start + 2; i < end; i += 2) if (/^- \[x\] .* → todo\/\S+\.md$/.test(parts[i])) return true;
  return false;
}

function addNote(text, note) {
  const { parts, start } = activeSection(text);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (start + 1 >= parts.length) {
    parts.push(eol, '', eol, note);
  } else if (parts[start + 2] === '' && start + 3 < parts.length) {
    parts.splice(start + 4, 0, note, eol, '', eol);
  } else {
    parts.splice(start + 2, 0, '', eol, note, eol, '', eol);
  }
  return parts.join('');
}

// The to-dos this migration made: "<title>\0<project>" → todo/<file> (todo/ and todo/done/).
function madeTodos(brain) {
  const map = new Map();
  // Deleted ones count too, so a rerun never brings back a to-do someone deleted in between.
  for (const sub of ['todo', 'todo/done', 'todo/deleted']) {
    let names = [];
    try { names = fs.readdirSync(abs(brain, sub)); } catch { continue; }
    for (const name of names.sort()) {
      if (!name.endsWith('.md') || TEMP_RE.test(name)) continue;
      const file = abs(brain, `${sub}/${name}`);
      let text;
      try {
        if (!fs.lstatSync(file).isFile()) continue;
        text = fs.readFileSync(file, 'utf8');
      } catch { continue; }
      const fm = frontmatter(text);
      if (fm.source !== SOURCE || !fm.title || !fm.project) continue;
      const key = `${fm.title}\u0000${fm.project}`;
      if (!map.has(key)) map.set(key, `${sub}/${name}`);
    }
  }
  return map;
}

// Every text file in the brain that mentions a moved path (skipping .git, node_modules, z-logs,
// z-backup and personal). Binary files and this script's own temp files are skipped.
const BINARY_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.heic', '.mp4', '.mov',
  '.m4a', '.mp3', '.wav', '.zip', '.gz', '.woff', '.woff2', '.ttf', '.otf', '.docx', '.xlsx', '.pptx', '.psd',
  '.sqlite', '.db']);
function scanMentions(brain) {
  const hits = [];
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(rel ? abs(brain, rel) : brain, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        if (!rel && (e.name === 'z-logs' || e.name === 'z-backup' || e.name === 'personal')) continue;
        walk(r);
      } else if (e.isFile()) {
        if (TEMP_RE.test(e.name) || BINARY_EXT.has(path.extname(e.name).toLowerCase())) continue;
        let buf;
        try { buf = fs.readFileSync(abs(brain, r)); } catch { continue; }
        if (buf.subarray(0, 8192).includes(0)) continue;
        if (mentionsMovedPath(buf.toString('utf8'))) hits.push(r);
      }
    }
  };
  walk('');
  return hits.sort();
}

// ---- planning -----------------------------------------------------------------------------------

function plan(brain, opts) {
  const refusals = [];
  const warnings = [];
  const self = path.relative(brain, __filename).split(path.sep).join('/');
  const ctx = { self: self.startsWith('..') ? null : self, ownTodos: new Set() };

  if (!isDir(brain)) return { refusals: [`no brain folder at ${brain}`] };
  if (!exists(abs(brain, TODO_SCRIPT))) return { refusals: [`the brain has no to-do script (${TODO_SCRIPT})`] };

  // The Workbench v2 patch.
  if (!opts.skipWorkbenchCheck) {
    let wb = '';
    try { wb = fs.readFileSync(abs(brain, WORKBENCH_FILE), 'utf8'); } catch { /* refused below */ }
    if (!wb.includes(WORKBENCH_MARKER)) {
      refusals.push(`the Workbench v2 patch isn't in place (${WORKBENCH_FILE} has no ${WORKBENCH_MARKER})`);
    }
  }

  // Edit H: the root .gitignore keeps the private files left at the old AI Search Outreach path out of
  // the sync's `git add -A`. A file read only; nothing here runs git.
  {
    let ignore = '';
    try { ignore = fs.readFileSync(abs(brain, '.gitignore'), 'utf8'); } catch { /* refused below */ }
    if (!ignore.split(/\r?\n/).some((l) => l.trim() === IGNORE_LINE)) {
      refusals.push(`the root .gitignore has no ${IGNORE_LINE} line (rehome-rules.md edit H): apply it first`);
    }
  }

  // The team, from the to-do script's own roster.
  const rosterReply = runTodo(brain, brain, 'roster', {});
  const roster = new Set(((rosterReply.reply && rosterReply.reply.members) || []).map((m) => m.slug));
  if (roster.size === 0) refusals.push('the to-do script\'s roster is empty (.team-config/roles.json)');
  const by = slugify(opts.by);
  if (!by) refusals.push('--by must name the person running the move');
  else if (roster.size && !roster.has(by)) refusals.push(`--by "${opts.by}" (${by}) isn't in the roster`);
  if (roster.size && !roster.has(STEVE.assignee)) refusals.push(`Steve's to-do: ${STEVE.assignee} isn't in the roster`);

  // Cards and owners.
  const cards = {};
  for (const slug of LIVE) {
    const card = locate(brain, slug, 'project.md');
    if (!card) {
      refusals.push(`projects/${slug} has no project.md card`);
      continue;
    }
    const fm = frontmatter(fs.readFileSync(abs(brain, card), 'utf8'));
    cards[slug] = { title: fm.title || slug, owner: slugify(fm.owner), card };
  }

  // Moves.
  const moves = [];
  const moveSpecs = [
    ...LIVE.map((slug) => ({ label: slug, from: `projects/${slug}`, to: `${NEW_BASE}/${slug}`, stay: STAY_BEHIND[slug] || [] })),
    ...ARCHIVES.map((a) => ({ label: a.slug, from: a.from, to: a.to, stay: [] })),
  ];
  for (const m of moveSpecs) {
    const from = abs(brain, m.from);
    const to = abs(brain, m.to);
    const parentClient = m.to.split('/').slice(0, 2).join('/');
    if (!isDir(abs(brain, parentClient))) {
      refusals.push(`${m.label}: the client folder ${parentClient}/ isn't there`);
      continue;
    }
    if (!isDir(from)) {
      if (isDir(to)) continue; // moved already
      refusals.push(`${m.label}: neither ${m.from}/ nor ${m.to}/ is there`);
      continue;
    }
    const entries = fs.readdirSync(from).filter((n) => !m.stay.includes(n) && !TEMP_RE.test(n)).sort();
    if (entries.length === 0) {
      if (isDir(to)) continue; // only the leftovers are at the old path
      refusals.push(`${m.label}: ${m.from}/ has nothing to move`);
      continue;
    }
    if (exists(to) && !isDir(to)) {
      refusals.push(`${m.label}: ${m.to} exists and isn't a folder`);
      continue;
    }
    const pending = [];
    for (const name of entries) {
      const src = path.join(from, name);
      const dst = path.join(to, name);
      if (!exists(dst)) {
        pending.push(name);
      } else if (sameTree(src, dst)) {
        warnings.push(`${m.from}/${name} is already at ${m.to}/${name} (identical); the old copy is left`);
      } else {
        refusals.push(`${m.label}: a target exists with different contents: ${m.to}/${name}`);
      }
    }
    if (pending.length) {
      const whole = !exists(to) && m.stay.every((n) => !exists(path.join(from, n)));
      moves.push({ ...m, pending, whole });
    }
  }

  // Checklists.
  const made = madeTodos(brain);
  for (const file of made.values()) ctx.ownTodos.add(file);
  const conversions = [];
  const notes = [];
  for (const slug of LIVE) {
    const rel = locate(brain, slug, 'todo.md');
    if (!rel) continue;
    const r = readUtf8(abs(brain, rel));
    if (!r.clean) {
      refusals.push(`${rel} isn't plain UTF-8 text`);
      continue;
    }
    const { items, hasSection, continuation } = openItems(r.text);
    if (!hasSection) continue;
    for (const line of continuation) {
      refusals.push(`${rel}:${line}: an open item runs over more than one line; convert it by hand first`);
    }
    for (const item of items) {
      const pointer = (POINTERS[slug] || []).find((p) => item.text.includes(p));
      if (pointer) {
        const done = pointer.replace(/^todo\//, 'todo/done/');
        if (!exists(abs(brain, pointer)) && !exists(abs(brain, done))) warnings.push(`${rel}:${item.line}: ${pointer} isn't there; ticked with the pointer anyway`);
        conversions.push({ slug, rel, item, kind: 'pointer', pointer });
        continue;
      }
      const full = rewriteText(rel, item.text);
      const { title, cut } = cutTitle(full);
      const project = `${INTERNAL_CLIENT}/${slug}`;
      const already = made.get(`${title}\u0000${project}`);
      if (already) {
        conversions.push({ slug, rel, item, kind: 'tick-only', pointer: already, title });
        continue;
      }
      const card = cards[slug] || { owner: '' };
      const payload = { title, client: INTERNAL_CLIENT, project, via: VIA, by };
      const bodyParts = [];
      if (cut) bodyParts.push(full);
      if (!card.owner) {
        payload.open = true;
      } else if (!roster.has(card.owner)) {
        payload.open = true;
        bodyParts.push(`The project's Account Owner, ${card.owner}, isn't on the team list, so this to-do is open to anyone.`);
      } else {
        payload.assignee = card.owner;
      }
      if (bodyParts.length) payload.body = bodyParts.join('\n\n');
      conversions.push({ slug, rel, item, kind: 'add', payload, title });
    }
    const willPoint = hasPointerLine(r.text) || items.length > 0;
    if (willPoint && !hasNote(r.text)) notes.push({ slug, rel });
  }

  // Steve's to-do.
  let steve = null;
  {
    const project = `${INTERNAL_CLIENT}/${STEVE.slug}`;
    if (!made.has(`${STEVE.title}\u0000${project}`)) {
      steve = { title: STEVE.title, body: STEVE.body, assignee: STEVE.assignee, client: INTERNAL_CLIENT, project, via: VIA, by };
    }
  }

  // Each new to-do through the to-do script's own checks, in a throwaway brain.
  const payloads = conversions.filter((c) => c.kind === 'add').map((c) => ({ where: `${c.rel}:${c.item.line}`, payload: c.payload }));
  if (steve) payloads.push({ where: "Steve's to-do", payload: steve });
  if (payloads.length && by) {
    for (const p of payloads) {
      if (p.payload.title.length > TITLE_MAX) refusals.push(`${p.where}: title over ${TITLE_MAX} characters`);
      if ((p.payload.body || '').length > BODY_MAX) refusals.push(`${p.where}: details over ${BODY_MAX} characters`);
    }
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rehome-check-'));
    try {
      fs.mkdirSync(path.join(sandbox, '.team-config'), { recursive: true });
      const roles = abs(brain, '.team-config/roles.json');
      if (exists(roles)) fs.copyFileSync(roles, path.join(sandbox, '.team-config', 'roles.json'));
      fs.mkdirSync(path.join(sandbox, 'todo'), { recursive: true });
      for (const slug of LIVE) fs.mkdirSync(path.join(sandbox, ...NEW_BASE.split('/'), slug), { recursive: true });
      for (const p of payloads) {
        const r = runTodo(brain, sandbox, 'add', p.payload);
        if (r.exit !== 0 || !r.reply || !r.reply.ok) {
          refusals.push(`${p.where}: the to-do script refuses it: ${(r.reply && r.reply.error) || r.stderr || 'no reply'}`);
        }
      }
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  }

  // Depth fixes and code edits must find their text (or the fixed text, when done).
  const depth = [];
  for (const f of DEPTH_FIXES) {
    const rel = locate(brain, f.slug, f.file);
    if (!rel) {
      refusals.push(`${f.slug}/${f.file} isn't there for its depth fix`);
      continue;
    }
    const text = fs.readFileSync(abs(brain, rel), 'utf8');
    const n = countOf(text, f.from);
    if (n === 1) depth.push({ ...f, rel });
    else if (n === 0 && text.includes(f.to)) continue;
    else refusals.push(`${rel}: expected ${JSON.stringify(f.from)} once for the depth fix, found it ${n} times`);
  }
  const code = [];
  for (const e of CODE_EDITS) {
    const p = abs(brain, e.file);
    if (!exists(p)) {
      refusals.push(`${e.file} isn't there for its code edit`);
      continue;
    }
    const text = fs.readFileSync(p, 'utf8');
    const n = countOf(text, e.from);
    if (n === 1) code.push({ ...e, rel: e.file });
    else if (n === 0 && text.includes(e.to)) continue;
    else refusals.push(`${e.file}: expected ${JSON.stringify(e.from)} once, found it ${n} times`);
  }

  // Every mention of a moved path is on the rewrite list or the history list.
  const hits = scanMentions(brain);
  const rewrites = [];
  for (const rel of hits) {
    const kind = classify(rel, ctx);
    if (kind === null) {
      const lines = fs.readFileSync(abs(brain, rel), 'utf8').split(/\r?\n/);
      const at = lines.findIndex((l) => mentionsMovedPath(l));
      refusals.push(`${rel}:${at + 1}: mentions a moved path but is on neither the rewrite nor the history list`);
    } else if (kind === 'rewrite') {
      const r = readUtf8(abs(brain, rel));
      if (!r.clean) {
        refusals.push(`${rel} isn't plain UTF-8 text, so it can't be rewritten safely`);
        continue;
      }
      const next = rewriteText(rel, r.text);
      const matches = (t) => (t.match(rewriteRe()) || []).length;
      if (next !== r.text) rewrites.push({ rel, count: matches(r.text) - matches(next) });
    }
  }

  return { refusals, warnings, cards, roster, by, moves, conversions, notes, steve, depth, code, rewrites, ctx };
}

// Where a path will be once its folder has moved.
function afterMove(rel) {
  const moved = movedOf(rel);
  if (moved && moved.at === 'old') return `${NEW_BASE}/${moved.slug}/${moved.inner}`;
  return rel;
}

function sameTree(a, b) {
  const sa = fs.lstatSync(a);
  const sb = fs.lstatSync(b);
  if (sa.isDirectory() !== sb.isDirectory()) return false;
  if (sa.isSymbolicLink() || sb.isSymbolicLink()) {
    return sa.isSymbolicLink() && sb.isSymbolicLink() && fs.readlinkSync(a) === fs.readlinkSync(b);
  }
  if (!sa.isDirectory()) return sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
  const na = fs.readdirSync(a).sort();
  const nb = fs.readdirSync(b).sort();
  if (na.join('\0') !== nb.join('\0')) return false;
  return na.every((n) => sameTree(path.join(a, n), path.join(b, n)));
}

// ---- the dry-run list ---------------------------------------------------------------------------

function describe(p) {
  const out = [];
  for (const c of p.conversions) {
    const card = p.cards[c.slug] || { title: c.slug };
    if (c.kind === 'pointer') out.push(`Tick ${c.rel}:${c.item.line} (${card.title}) with its existing to-do: → ${c.pointer}`);
    else if (c.kind === 'tick-only') out.push(`Tick ${c.rel}:${c.item.line} (${card.title}): its to-do is already made: → ${c.pointer}`);
    else {
      const who = c.payload.assignee ? `for ${c.payload.assignee}` : 'open to anyone';
      const cut = c.payload.body ? ' (title cut, full text in the details)' : '';
      out.push(`Add a to-do ${who} in ${c.payload.project} (${card.title})${cut}: "${c.title}", then tick ${c.rel}:${c.item.line}`);
    }
  }
  for (const n of p.notes) out.push(`Add "${NOTE_PREFIX}<date>: open the project in TDS Cortex or the Workbench." under ## Active in ${n.rel}`);
  if (p.steve) out.push(`Add Steve's to-do for ${p.steve.assignee} in ${p.steve.project}: "${p.steve.title}"`);
  for (const m of p.moves) {
    const left = m.stay.length ? ` (${m.stay.join(' and ')} stay at the old path)` : '';
    out.push(`Move ${m.from}/ → ${m.to}/${m.whole ? '' : ` (${m.pending.length} entries)`}${left}`);
  }
  for (const d of p.depth) out.push(`Depth fix in ${afterMove(d.rel)}: ${d.from} → ${d.to}`);
  for (const e of p.code) out.push(`Code edit in ${e.rel}: ${e.from} → ${e.to}`);
  for (const r of p.rewrites) out.push(`Rewrite ${r.count} reference${r.count === 1 ? '' : 's'} in ${afterMove(r.rel)}`);
  return out;
}

// ---- applying -----------------------------------------------------------------------------------

function apply(brain, p, counts) {
  const fail = (msg) => {
    const err = new Error(msg);
    err.partial = true;
    throw err;
  };
  // 1. Checklists, one item at a time: make the to-do, then tick its item.
  for (const c of p.conversions) {
    let pointer = c.pointer;
    if (c.kind === 'add') {
      const r = runTodo(brain, brain, 'add', c.payload);
      if (r.exit !== 0 || !r.reply || !r.reply.ok || !r.reply.file) {
        fail(`the to-do script refused ${c.rel}:${c.item.line}: ${(r.reply && r.reply.error) || r.stderr || 'no reply'}`);
      }
      pointer = `todo/${r.reply.file}`;
      counts.todosMade++;
      crashPoint('after-add');
    }
    const file = abs(brain, c.rel);
    const text = fs.readFileSync(file, 'utf8');
    const next = tickItem(text, c.item.text, pointer);
    if (next === null) fail(`${c.rel}: the item "${c.item.text.slice(0, 60)}" is no longer open`);
    writeAtomic(file, next);
    counts.itemsTicked++;
    crashPoint('after-tick');
  }
  const note = `${NOTE_PREFIX}${ukDate(new Date())}: open the project in TDS Cortex or the Workbench.`;
  for (const n of p.notes) {
    const file = abs(brain, n.rel);
    const text = fs.readFileSync(file, 'utf8');
    if (hasNote(text)) continue;
    writeAtomic(file, addNote(text, note));
    counts.notesAdded++;
  }
  if (p.steve) {
    const r = runTodo(brain, brain, 'add', p.steve);
    if (r.exit !== 0 || !r.reply || !r.reply.ok) fail(`the to-do script refused Steve's to-do: ${(r.reply && r.reply.error) || r.stderr}`);
    counts.todosMade++;
  }

  // 2. Folders.
  for (const m of p.moves) {
    const from = abs(brain, m.from);
    const to = abs(brain, m.to);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (m.whole && !exists(to)) {
      fs.renameSync(from, to);
    } else {
      fs.mkdirSync(to, { recursive: true });
      for (const name of m.pending) {
        if (!exists(path.join(to, name))) fs.renameSync(path.join(from, name), path.join(to, name));
        crashPoint('after-entry');
      }
      if (fs.readdirSync(from).length === 0) fs.rmdirSync(from);
    }
    counts.foldersMoved++;
    crashPoint('after-move');
  }

  // 3. Depth fixes and code edits (at the files' new places).
  for (const d of p.depth) {
    const file = abs(brain, afterMove(d.rel));
    const text = fs.readFileSync(file, 'utf8');
    if (countOf(text, d.from) !== 1) continue;
    writeAtomic(file, text.replace(d.from, d.to));
    counts.depthFixes++;
  }
  for (const e of p.code) {
    const file = abs(brain, e.rel);
    const text = fs.readFileSync(file, 'utf8');
    if (countOf(text, e.from) !== 1) continue;
    writeAtomic(file, text.replace(e.from, e.to));
    counts.codeEdits++;
  }

  // 4. References, from a fresh scan (the moved files are at their new places now).
  for (const rel of scanMentions(brain)) {
    if (classify(rel, p.ctx) !== 'rewrite') continue;
    const file = abs(brain, rel);
    const r = readUtf8(file);
    if (!r.clean) continue;
    const next = rewriteText(rel, r.text);
    if (next === r.text) continue;
    writeAtomic(file, next);
    counts.filesRewritten++;
  }
}

// ---- command line -------------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { brain: null, apply: false, by: 'Ian Hancock', skipWorkbenchCheck: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opts.apply = true;
    else if (a === '--skip-workbench-check') opts.skipWorkbenchCheck = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--brain') opts.brain = argv[++i];
    else if (a.startsWith('--brain=')) opts.brain = a.slice(8);
    else if (a === '--by') opts.by = argv[++i];
    else if (a.startsWith('--by=')) opts.by = a.slice(5);
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.log(err.message);
    console.log(JSON.stringify({ ok: false, error: err.message }));
    return 2;
  }
  if (opts.help || !opts.brain) {
    console.log('Usage: node rehome-legacy-projects.cjs --brain <path> [--apply] [--by "Ian Hancock"] [--skip-workbench-check]');
    if (!opts.brain && !opts.help) {
      console.log(JSON.stringify({ ok: false, error: '--brain is required' }));
      return 2;
    }
    return 0;
  }
  const brain = path.resolve(opts.brain.replace(/^~(?=\/|$)/, os.homedir()));
  const mode = opts.apply ? 'apply' : 'dry-run';
  const p = plan(brain, opts);
  if (p.refusals.length) {
    console.log(`Refused: nothing was changed. ${p.refusals.length} problem${p.refusals.length === 1 ? '' : 's'}:`);
    p.refusals.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
    console.log(JSON.stringify({ ok: false, mode, refused: p.refusals }));
    return 2;
  }
  const actions = describe(p);
  console.log(`${opts.apply ? 'Doing' : 'Dry run: would do'} ${actions.length} action${actions.length === 1 ? '' : 's'} in ${brain}${opts.apply ? '' : ' (nothing is written)'}:`);
  actions.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
  for (const w of p.warnings) console.log(`  Note: ${w}`);
  const counts = { todosMade: 0, itemsTicked: 0, notesAdded: 0, foldersMoved: 0, depthFixes: 0, codeEdits: 0, filesRewritten: 0 };
  if (!opts.apply) {
    const planned = {
      todosMade: p.conversions.filter((c) => c.kind === 'add').length + (p.steve ? 1 : 0),
      itemsTicked: p.conversions.length,
      notesAdded: p.notes.length,
      foldersMoved: p.moves.length,
      depthFixes: p.depth.length,
      codeEdits: p.code.length,
      filesRewritten: p.rewrites.length,
    };
    console.log(JSON.stringify({ ok: true, mode, changes: 0, planned: actions.length, ...planned, warnings: p.warnings }));
    return 0;
  }
  try {
    apply(brain, p, counts);
  } catch (err) {
    const changes = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`Stopped part-way: ${err.message}. Run it again to finish; done steps are skipped.`);
    console.log(JSON.stringify({ ok: false, mode, error: err.message, changes, ...counts, warnings: p.warnings }));
    return 1;
  }
  const changes = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(changes ? `Done: ${changes} change${changes === 1 ? '' : 's'}.` : 'Nothing to do: everything is already in place.');
  console.log(JSON.stringify({ ok: true, mode, changes, ...counts, warnings: p.warnings }));
  return 0;
}

module.exports = { cutTitle, rewriteText, classify, mentionsMovedPath, scanMentions, LIVE, NEW_BASE, SOURCE };

if (require.main === module) process.exitCode = main();
