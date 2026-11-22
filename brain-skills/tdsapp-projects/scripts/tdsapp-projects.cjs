#!/usr/bin/env node
// tdsapp-projects.cjs (v0.3.1): make and change project cards (`project.md`) the way TDS Cortex does,
// move a project to another client, and archive, unarchive or delete one. The plans are the app
// repo's docs/plans/2026-11-20-projects-system.md (decisions 1-4b, 8, 9 and 27),
// docs/plans/2026-11-21-project-move.md and docs/plans/2026-11-21-project-archive-delete.md; the
// shapes are in its shared/projects-contract.ts (a test checks the constants here match).
//
// Usage:
//   echo '<json>' | node .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs <action>
//
//   <action>  create | card | edit | link | unlink | move | archive | unarchive | delete | capabilities
//   stdin     one JSON object (at most 256 KB), the app's ProjectAction (camelCase field names):
//             create {space, client?, slug, fields}, card {key, fields}, edit {key, fields, expect},
//             link {key, path, expect}, unlink {key, path, expect},
//             move {key, client, expect, dropPersonal?: true, check?: true, filesExpect?},
//             archive / unarchive {key, expect?, check?: true, filesExpect?},
//             delete {key, expect?, check?: true, filesExpect?, leftover?: true}, capabilities {}.
//             A `kind` field, when sent, must name the same action.
//   stdout    one JSON line: {ok: true, action, key, version} or {ok: false, error, message}.
//             `version` is the hex SHA-256 of project.md's bytes after the change. `move` answers the
//             new key; with `check: true` it writes nothing and adds `check` (what the move would do,
//             with `filesVersion`, the fingerprint of the folder's files). Sent back as `filesExpect`,
//             the move is refused with `changed` when the folder's files are no longer those checked.
//             archive, unarchive and delete answer `version: ''`; with `check: true` they add `check`
//             (ProjectRemoveCheck: what would move or go, who may, and what else names the folder).
//   exit 0    ok; exit 2 refused (bad-request, not-found, exists, changed, not-allowed); exit 1 internal.
//
// Where projects live (every folder there is a project, card or not):
//   clients/<client>/projects/<slug>/            key <client>/<slug>
//   clients/<client>/projects-archive/<slug>/    key <client>/<slug> (archived)
//   projects/<slug>/                             key the-digital-stride/<slug> (legacy, read in place)
//   projects-archive/<slug>/                     key the-digital-stride/<slug> (archived)
//   clients/_archive/<client>/projects/<slug>/   key <client>/<slug> (an archived client's: read only)
//   personal/projects/<slug>/                    key personal/<slug> (never syncs)
//   personal/projects-archive/<slug>/            key personal/<slug> (archived; never syncs)
// A key resolves to the first folder found (LOCATIONS below): for the-digital-stride,
// clients/the-digital-stride/projects/, projects/, clients/the-digital-stride/projects-archive/, then
// projects-archive/; for any other client, its live folder, its archive, then clients/_archive/; for
// personal, the live folder then the archive. `create` refuses a slug found in ANY of them.
// Leftovers (archive plan decision 2) never win: a card-less live folder whose key has a carded
// archive twin, and a card-less shared folder holding nothing but files git ignores (`.DS_Store`),
// are what a sync left behind on this Mac. A key reads the next folder; a leftover is found only
// when there is nothing else, or by `delete` with `leftover: true`.
//
// `archive` renames a live folder to its archive folder beside it (same slug, same depth, so the
// card's relative links still work) and `unarchive` back; nothing else changes. `delete` hides the
// folder under a git-ignored name (`.tdsapp-projects-<slug>-<hex>.deleting~`) in the same parent, then
// removes it. Every action first sweeps such hidden folders left by a failed delete from the parents
// of the key's folders.
//
// `move` takes clients/<client>/projects/<slug>/ or personal/projects/<slug>/ to
// clients/<other client>/projects/<slug>/ (never to personal). The folder name stays; the key's client
// changes and the old key goes on the card's `moved_from:` list, so the app keeps resolving it. Every
// check runs before anything is written; then the new folder is claimed (an empty mkdir), the card is
// rewritten in place, and the folder is renamed onto the claim. A failed rename puts the card's old
// bytes back and lets go of the claim, so the project is wholly in one place or the other.
//
// The caller is DISTRUSTED and everything fails closed:
//   - Who did it comes from this Mac's `git config user.email` (else `user.name` when no email is set)
//     matched against .team-config/roles.json, as tdsapp-files. stdin never names the person. Only
//     people on the team may change shared projects; anyone may change their own personal ones.
//     `created_by` is written once, by create and card.
//   - edit, link and unlink need `expect` (the SHA-256 the caller read); a mismatch is `changed`.
//   - Archived projects, card-less ones (except `card`) and unreadable cards (no frontmatter block,
//     or git merge markers) are never changed.
//   - No link anywhere along the way: every folder written to must really be where it says.
//   - A personal project is written only where git ignores it (or the brain isn't a git repository),
//     and a shared project may never link a personal/ file (decision 8).
//   - Writes go to a hidden temp file in the same folder (synced), then rename over the card; a new
//     card is hard-linked into place, so it never overwrites anything. Unknown frontmatter keys, other
//     lines and the body's bytes are kept; CRLF line endings and a byte order mark too.
//
// The card (frontmatter keys in this order; empty fields left out, never written as null; lists as
// quoted `- ` items, so the brain's simple frontmatter readers take them):
//   v, title, client, kind, status, health, comms, owner, team, service, start, end, budget_hours,
//   billable, stages, monday_id, created, created_by, moved_from
// Body: the brief, then an optional `## Linked files` section of `- [name](path from the card)` lines.
//
// When `require`d it runs nothing and exports `run(action, input, ctx)`, so tests can pass a brain
// root, a home folder and a clock. The command line always uses the real clock. Plain Node, no
// dependencies.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_VERSION = '0.3.1';

// Mirrors shared/projects-contract.ts (a test checks they match).
const PROJECTS_CAPABILITY = 'projects-v1';
const PROJECTS_MOVE_CAPABILITY = 'projects-move-v1';
const PROJECTS_ARCHIVE_CAPABILITY = 'projects-archive-v1';
const PROJECT_MOVED_FROM_MAX = 10;
const INTERNAL_CLIENT = 'the-digital-stride';
const INTERNAL_PRECEDENCE = [
  'clients/the-digital-stride/projects/<slug>',
  'projects/<slug>',
  'clients/the-digital-stride/projects-archive/<slug>',
  'projects-archive/<slug>',
];
const PROJECT_CARD_FILE = 'project.md';
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY_PATTERN = /^(personal|[a-z0-9]+(-[a-z0-9]+)*)\/[a-z0-9]+(-[a-z0-9]+)*$/;
const LIMITS = {
  PROJECT_SLUG_MAX: 60,
  PROJECT_KEY_SEGMENT_MAX: 60,
  PROJECT_TITLE_MAX: 120,
  PROJECT_BRIEF_MAX: 20000,
  PROJECT_STAGES_MAX: 12,
  PROJECT_STAGE_MAX: 40,
  PROJECT_TEAM_MAX: 20,
  PROJECT_BUDGET_MAX_HOURS: 100000,
  PROJECT_LINKS_MAX: 200,
};
const KINDS = ['one-off', 'ongoing'];
const STATUSES = ['planned', 'active', 'on-hold', 'done'];
const LIGHTS = ['green', 'amber', 'red'];
const SERVICE_MAX = 10;
const SERVICE_ITEM_MAX = 40;

// Mirrors the library's rules (server/brain/library-rules.ts), as tdsapp-files has them.
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'];
const DOCUMENT_EXTENSIONS = ['pdf', 'md', 'txt', 'docx', 'html', 'htm', 'csv', 'xlsx', 'pptx'];
const LIBRARY_EXTENSIONS = [...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS];
// Mirrors LINKED_FILE_ROOTS in shared/projects.ts (a test checks they match).
const LINK_ROOTS = ['clients/', 'templates/', 'personal/', 'projects/', 'projects-archive/'];

const INPUT_MAX = 262144;
const PATH_MAX = 1024;
const NAME_MAX = 80;
const ERRORS = new Set(['bad-request', 'not-found', 'exists', 'changed', 'not-allowed', 'internal']);
const ACTION_NAMES = ['create', 'card', 'edit', 'link', 'unlink', 'move', 'archive', 'unarchive', 'delete', 'capabilities'];
// A move lists at most this many of the folder's files in its check, and walks at most this many entries.
const MOVE_FILES_SHOWN = 50;
const MOVE_WALK_MAX = 5000;

// Card frontmatter keys, in the order they are written.
const ORDER = [
  'v', 'title', 'client', 'kind', 'status', 'health', 'comms', 'owner', 'team', 'service', 'start', 'end',
  'budget_hours', 'billable', 'stages', 'monday_id', 'created', 'created_by', 'moved_from',
];
// ProjectFields (camelCase) → the card key on disk.
const FIELD_KEYS = {
  title: 'title',
  kind: 'kind',
  status: 'status',
  health: 'health',
  comms: 'comms',
  owner: 'owner',
  team: 'team',
  service: 'service',
  start: 'start',
  end: 'end',
  budgetHours: 'budget_hours',
  billable: 'billable',
  stages: 'stages',
};
const LIST_KEYS = new Set(['team', 'service', 'stages', 'moved_from']);

class Refusal extends Error {
  constructor(code, message) {
    super(message);
    this.code = ERRORS.has(code) ? code : 'internal';
  }
}
const refuse = (code, message) => new Refusal(code, message);

// ---- small helpers -------------------------------------------------------------------------------

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function errCode(err) {
  return err && typeof err === 'object' ? err.code : undefined;
}

function lstatOrNull(abs) {
  try {
    return fs.lstatSync(abs);
  } catch (err) {
    if (errCode(err) === 'ENOENT' || errCode(err) === 'ENOTDIR') return null;
    throw err;
  }
}

// The brain's member slug rule (tdsapp-files memberSlug): spaces become dashes, other characters go.
function memberSlug(name) {
  return String(name).toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
}

// The Workbench's slug rule (tdsapp-todo workbenchSlug): every run of other characters becomes one dash.
function workbenchSlug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function displayText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ').trim().slice(0, max).trim();
}

function isRealDate(ymd) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days;
}

// Today's date in the UK (GMT in winter, BST in summer), for `created`.
function ukDate(at) {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at)) {
    p[part.type] = part.value;
  }
  return `${p.year}-${p.month}-${p.day}`;
}

function isSlug(value) {
  return typeof value === 'string' && value.length <= LIMITS.PROJECT_SLUG_MAX && SLUG_PATTERN.test(value);
}

// ---- YAML values, written by hand (as tdsapp-todo) -----------------------------------------------

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

// A one-line value, quoted only when YAML would misread it, and only in a way that needs no escapes
// (none of the brain's readers unescape). Null when it can't be written that way. A backslash is
// never double-quoted: YAML reads `\` as an escape there (as tdsapp-todo's guard).
function yamlText(value) {
  if (!needsQuotes(value)) return value;
  if (!value.includes('"') && !value.includes('\\')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return null;
}

// A list item: always quoted, so commas and colons read back as written.
function yamlItem(value) {
  if (!value.includes('"') && !value.includes('\\')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return null;
}

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

// ---- git and identity (as tdsapp-files) ------------------------------------------------------------

// git, run in the brain with messages in English, none of the caller's GIT_* variables and this
// run's home. Null if it can't run.
function gitInBrain(ctx, args, input) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  env.HOME = ctx.home;
  env.LC_ALL = 'C';
  env.LANGUAGE = '';
  const out = spawnSync('git', args, {
    cwd: ctx.root, encoding: 'utf8', timeout: 5000, env, input, maxBuffer: 16 * 1024 * 1024,
  });
  return out.error ? null : out;
}

function gitValue(ctx, args) {
  const out = gitInBrain(ctx, args);
  return out && out.status === 0 ? (out.stdout || '').trim() : '';
}

function readMembers(root) {
  try {
    const members = JSON.parse(fs.readFileSync(path.join(root, '.team-config', 'roles.json'), 'utf8')).members;
    return Array.isArray(members) ? members.filter(m => m && typeof m === 'object') : [];
  } catch {
    return [];
  }
}

// Who runs this: an email, when set, must match roles.json; with no email set the name must.
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
    return {
      slug: memberSlug(member.name),
      name: displayText(member.name, NAME_MAX),
      known: true,
      member,
      role: typeof member.role === 'string' ? member.role.trim().toLowerCase() : '',
    };
  }
  return { slug: memberSlug(name), name: displayText(name, NAME_MAX), known: false, member: null, role: '' };
}

// Every slug a team member can go by (both slug rules); null when roles.json names nobody.
function teamSlugs(root) {
  const slugs = new Set();
  for (const m of readMembers(root)) {
    if (typeof m.name !== 'string') continue;
    slugs.add(memberSlug(m.name));
    slugs.add(workbenchSlug(m.name));
  }
  slugs.delete('');
  return slugs.size > 0 ? slugs : null;
}

// 'repo', 'none' (not a git repository) or null (git couldn't tell).
function brainRepo(ctx) {
  const out = gitInBrain(ctx, ['rev-parse', '--is-inside-work-tree']);
  if (!out) return null;
  if (out.status !== 0) return /not a git repository/i.test(out.stderr || '') ? 'none' : null;
  return (out.stdout || '').trim() === 'true' ? 'repo' : null;
}

// A personal card is written only where nothing syncs it: personal/ and personal/projects/ are real
// folders, and git ignores the card (or the brain isn't a git repository).
function requirePrivate(ctx, rel) {
  for (const dir of ['personal', 'personal/projects', 'personal/projects-archive']) {
    const st = lstatOrNull(path.join(ctx.root, ...dir.split('/')));
    if (st && st.isSymbolicLink()) throw refuse('not-allowed', `${dir} is a link to another folder, so it can't be kept private`);
  }
  const repo = brainRepo(ctx);
  if (repo === 'none') return;
  if (repo === null) throw refuse('not-allowed', "git couldn't check that this project stays on this Mac");
  const out = gitInBrain(ctx, ['check-ignore', '--stdin', '-z'], `${rel}\0`);
  if (!out || (out.status !== 0 && out.status !== 1)) {
    throw refuse('not-allowed', "git couldn't check that this project stays on this Mac");
  }
  const ignored = (out.stdout || '').split('\0').filter(Boolean);
  if (!ignored.includes(rel)) throw refuse('not-allowed', `${rel} would sync to the team: git doesn't ignore it`);
}

// What git ignores among `rels` (brain-relative), or an empty set when the brain isn't a git
// repository. Refuses when git can't tell.
function ignoredPaths(ctx, rels) {
  const repo = brainRepo(ctx);
  if (repo === 'none') return new Set();
  const fail = () => refuse('not-allowed', "git couldn't check what would sync to the team");
  if (repo === null) throw fail();
  const out = gitInBrain(ctx, ['check-ignore', '--stdin', '-z'], rels.map(r => `${r}\0`).join(''));
  if (!out || (out.status !== 0 && out.status !== 1)) throw fail();
  return new Set((out.stdout || '').split('\0').filter(Boolean));
}

function requireTeam(who) {
  if (!who.known) {
    throw refuse('not-allowed', 'only people on the team in .team-config/roles.json can change shared projects');
  }
}

// The brain's Owner: role `owner` in roles.json.
function isBrainOwner(who) {
  return who.known && who.role === 'owner';
}

// The people who run the brain: role `owner` or `scout` in roles.json.
function isOwnerOrScout(who) {
  return who.known && (who.role === 'owner' || who.role === 'scout');
}

// Brain compat decision 13 (Ian, 2026-11-22): who may change a shared card's Account Owner. The
// Account Owner (either slug form), or anyone with role owner or scout; on a card with none, an owner
// or scout. Deleting keeps ownerRule.
function ownerChangeRule(ctx, owner, who) {
  if (owner !== null) {
    return {
      allowed: isOwnerOrScout(who) || isPerson(who, owner),
      allowedWho: `${memberNamed(ctx.root, owner) || owner} (the Account Owner), an owner or a scout`,
    };
  }
  return { allowed: isOwnerOrScout(who), allowedWho: 'an owner or a scout' };
}

// Whether `who` is the team member a slug names, in either slug form (as personOf takes them).
function isPerson(who, slug) {
  if (!who.known || typeof slug !== 'string' || slug === '') return false;
  return memberSlug(who.member.name) === slug || workbenchSlug(who.member.name) === slug;
}

// A card's Account Owner as a slug, or null when it has none (or one no rule can match).
function cardOwner(values) {
  const owner = values ? values.owner : undefined;
  return typeof owner === 'string' && isSlug(owner) ? owner : null;
}

// Security review: who may change a shared card's Account Owner. The Account Owner (either slug
// form) or the brain's Owner; on a card with none, the brain's Owner only.
function ownerRule(ctx, owner, who) {
  if (owner !== null) {
    return {
      allowed: isBrainOwner(who) || isPerson(who, owner),
      allowedWho: `${memberNamed(ctx.root, owner) || owner} (the Account Owner) or the brain's Owner`,
    };
  }
  return { allowed: isBrainOwner(who), allowedWho: "the brain's Owner" };
}

// ---- where a project lives -----------------------------------------------------------------------------

function parseKey(value) {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) return null;
  const at = value.indexOf('/');
  const client = value.slice(0, at);
  const slug = value.slice(at + 1);
  if (client.length > LIMITS.PROJECT_KEY_SEGMENT_MAX || slug.length > LIMITS.PROJECT_KEY_SEGMENT_MAX) return null;
  return { client, slug };
}

// Every folder a key may name, in reader precedence (archive plan decision 1), each explicit about
// whether it is an archive location and which space it reads as. `readOnly`: an archived client's
// folder, which nothing here archives, unarchives or deletes.
function locationsOf(client, slug) {
  if (client === 'personal') {
    return [
      { rel: `personal/projects/${slug}`, archived: false, space: 'personal', readOnly: false },
      { rel: `personal/projects-archive/${slug}`, archived: true, space: 'personal', readOnly: false },
    ];
  }
  if (client === INTERNAL_CLIENT) {
    return [
      { rel: `clients/${INTERNAL_CLIENT}/projects/${slug}`, archived: false, space: 'client', readOnly: false },
      { rel: `projects/${slug}`, archived: false, space: 'legacy', readOnly: false },
      { rel: `clients/${INTERNAL_CLIENT}/projects-archive/${slug}`, archived: true, space: 'client', readOnly: false },
      { rel: `projects-archive/${slug}`, archived: true, space: 'legacy', readOnly: false },
    ];
  }
  return [
    { rel: `clients/${client}/projects/${slug}`, archived: false, space: 'client', readOnly: false },
    { rel: `clients/${client}/projects-archive/${slug}`, archived: true, space: 'client', readOnly: false },
    { rel: `clients/_archive/${client}/projects/${slug}`, archived: true, space: 'client', readOnly: true },
  ];
}

// Mirrors archiveFolderFor / liveFolderFor in shared/projects.ts: a live folder's archive folder
// beside it, and back. Null for anywhere else (an archived client's folder has neither).
function archiveFolderFor(rel) {
  const m = /^(clients\/(?!_)[^/]+\/|personal\/)?projects\/([^/]+)$/.exec(rel);
  return m ? `${m[1] || ''}projects-archive/${m[2]}` : null;
}

function liveFolderFor(rel) {
  const m = /^(clients\/(?!_)[^/]+\/|personal\/)?projects-archive\/([^/]+)$/.exec(rel);
  return m ? `${m[1] || ''}projects/${m[2]}` : null;
}

// Whether a folder has a card: true for anything called project.md (a link or a folder too, so such a
// folder is never taken for a leftover), 'plain' when it is a plain file.
function cardState(abs) {
  const st = lstatOrNull(path.join(abs, PROJECT_CARD_FILE));
  if (!st) return false;
  return st.isFile() && !st.isSymbolicLink() ? 'plain' : true;
}

// The files in a card-less folder, folder-relative, for the leftover rule; null when there are too
// many or anything isn't a plain file or folder (then it is never a leftover).
const LEFTOVER_FILES_MAX = 200;
function looseFiles(abs) {
  const files = [];
  const stack = [''];
  while (stack.length > 0) {
    const sub = stack.pop();
    let names;
    try {
      names = fs.readdirSync(sub === '' ? abs : path.join(abs, ...sub.split('/')));
    } catch {
      return null;
    }
    for (const name of names) {
      const rel = sub === '' ? name : `${sub}/${name}`;
      const st = lstatOrNull(path.join(abs, ...rel.split('/')));
      if (!st || st.isSymbolicLink()) return null;
      if (st.isDirectory()) stack.push(rel);
      else if (st.isFile()) files.push(rel);
      else return null;
      if (files.length + stack.length > LEFTOVER_FILES_MAX) return null;
    }
  }
  return files;
}

// Archive plan decision 2: a card-less shared folder holding at least one file, every one of which git
// ignores, never synced anything: it is what a sync left behind. False when git can't tell.
function onlyIgnored(ctx, loc) {
  if (loc.space === 'personal') return false;
  const files = looseFiles(loc.abs);
  if (!files || files.length === 0) return false;
  try {
    const ignored = ignoredPaths(ctx, files.map(f => `${loc.rel}/${f}`));
    return files.every(f => ignored.has(`${loc.rel}/${f}`));
  } catch {
    return false;
  }
}

// Every folder there for a key, in reader precedence, each marked `card` and `leftover`; and the
// symlinks met on the way, by position.
function foldersOf(ctx, key) {
  const found = [];
  const links = [];
  locationsOf(key.client, key.slug).forEach((loc, at) => {
    const abs = path.join(ctx.root, ...loc.rel.split('/'));
    const st = lstatOrNull(abs);
    if (!st) return;
    if (st.isSymbolicLink()) { links.push({ at, rel: loc.rel }); return; }
    if (!st.isDirectory()) return;
    found.push({ ...loc, at, abs, card: cardState(abs) });
  });
  const cardedArchive = found.some(f => f.archived && f.card === 'plain');
  for (const f of found) {
    f.leftover = f.card === false && ((!f.archived && cardedArchive) || onlyIgnored(ctx, f));
  }
  return { found, links };
}

// Removes the hidden folders a failed delete left (`.tdsapp-projects-<slug>-<12 hex>.deleting~`) from
// the parents of every folder a key may name, where the parent is a real folder. Never follows a link.
const DELETING = /^\.tdsapp-projects-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}\.deleting~$/;
function sweepDeleting(ctx, client, slug) {
  const parents = new Set(locationsOf(client, slug).map(l => l.rel.slice(0, l.rel.lastIndexOf('/'))));
  for (const parentRel of parents) {
    const parentAbs = path.join(ctx.root, ...parentRel.split('/'));
    const st = lstatOrNull(parentAbs);
    if (!st || st.isSymbolicLink() || !st.isDirectory()) continue;
    try {
      requireRealPath(ctx, parentAbs, parentRel);
    } catch {
      continue;
    }
    let names;
    try {
      names = fs.readdirSync(parentAbs);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!DELETING.test(name)) continue;
      const abs = path.join(parentAbs, name);
      const hst = lstatOrNull(abs);
      if (!hst || hst.isSymbolicLink() || !hst.isDirectory()) continue;
      try { removeTree(ctx, abs); } catch { /* still busy: the next call tries again */ }
    }
  }
}

function removeTree(ctx, abs) {
  (ctx.removeDir || (p => fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 })))(abs);
}

// The folder a key resolves to: the first one there that isn't a leftover, else the first leftover;
// with `leftover`, the first leftover only. A link met before it is refused, as it always was.
function locate(ctx, value, opts) {
  const key = parseKey(value);
  if (!key) throw refuse('bad-request', 'key must be <client>/<slug> or personal/<slug>');
  sweepDeleting(ctx, key.client, key.slug);
  const { found, links } = foldersOf(ctx, key);
  const wantLeftover = Boolean(opts && opts.leftover);
  const pick = wantLeftover
    ? found.find(f => f.leftover)
    : found.find(f => !f.leftover) || found.find(f => f.leftover);
  const link = links.find(l => !pick || l.at < pick.at);
  if (link && !wantLeftover) throw refuse('not-allowed', `${link.rel} is a link`);
  if (!pick) {
    if (wantLeftover) throw refuse('not-found', `there is no folder left behind for ${value}`);
    throw refuse('not-found', `there is no project ${value}`);
  }
  requireRealPath(ctx, pick.abs, pick.rel);
  const others = found.filter(f => f !== pick).map(f => f.rel);
  return {
    rel: pick.rel,
    archived: pick.archived,
    space: pick.space,
    readOnly: pick.readOnly,
    leftover: pick.leftover,
    key: value,
    client: key.client === 'personal' ? null : key.client,
    slug: key.slug,
    abs: pick.abs,
    others,
  };
}

// A live client's folder, clients/<client>, checked as a real folder. Its lstat for the same-disk check.
function requireClientFolder(ctx, client) {
  const clientAbs = path.join(ctx.root, 'clients', client);
  const st = lstatOrNull(clientAbs);
  if (!st) throw refuse('not-found', `there is no client folder clients/${client}`);
  if (st.isSymbolicLink()) throw refuse('not-allowed', `clients/${client} is a link`);
  if (!st.isDirectory()) throw refuse('not-found', `clients/${client} isn't a folder`);
  requireRealPath(ctx, clientAbs, `clients/${client}`);
  return st;
}

// Refuses a path whose real location isn't exactly where it says (a link along the way, or letters
// in a different case from the disk).
function requireRealPath(ctx, abs, rel) {
  let real;
  try {
    real = path.relative(fs.realpathSync.native(ctx.root), fs.realpathSync.native(abs)).split(path.sep).join('/');
  } catch {
    throw refuse('not-found', `${rel} isn't there`);
  }
  if (real !== rel) throw refuse('not-allowed', `${rel} goes through a link or doesn't match the folder names on disk`);
}

// ---- writing files (as tdsapp-todo) ----------------------------------------------------------------

function writeTemp(dir, data, mode) {
  const tmp = path.join(dir, `.tdsapp-projects-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp~`);
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

// Creates a new file all at once; EEXIST rather than overwrite anything.
function createFile(abs, data) {
  const dir = path.dirname(abs);
  const tmp = writeTemp(dir, data);
  try {
    try {
      fs.linkSync(tmp, abs);
    } catch (err) {
      if (errCode(err) === 'EEXIST') throw err;
      fs.writeFileSync(abs, data, { encoding: 'utf8', flag: 'wx' });
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  syncDir(dir);
}

// Replaces an existing card all at once, keeping its permissions.
function replaceFile(abs, data, mode) {
  const dir = path.dirname(abs);
  const tmp = writeTemp(dir, data, mode);
  try {
    fs.renameSync(tmp, abs);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  syncDir(dir);
}

// ---- the card --------------------------------------------------------------------------------------

function decodeFile(bytes) {
  const raw = bytes.toString('utf8');
  const bom = raw.startsWith('﻿') ? '﻿' : '';
  const src = bom ? raw.slice(1) : raw;
  const i = src.indexOf('\n');
  const eol = i > 0 && src[i - 1] === '\r' ? '\r\n' : '\n';
  return { bom, eol, text: src.replace(/\r\n/g, '\n') };
}

function encodeFile(shape, text) {
  return shape.bom + (shape.eol === '\n' ? text : text.replace(/\n/g, shape.eol));
}

// A git merge conflict: a `<<<<<<<` line, then a `=======` line, then a `>>>>>>>` line. One marker
// alone is not one, so a brief with a `=======` divider stays editable (the app reads it the same way).
function hasConflict(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => /^<{7}(?: |$)/.test(l));
  if (start === -1) return false;
  let mid = -1;
  for (let i = start + 1; i < lines.length; i++) if (/^={7}[ \t]*$/.test(lines[i])) { mid = i; break; }
  if (mid === -1) return false;
  for (let i = mid + 1; i < lines.length; i++) if (/^>{7}(?: |$)/.test(lines[i])) return true;
  return false;
}

// The card split into its frontmatter entries and body lines, or null when it can't be read (no
// frontmatter block, or a git merge conflict): such a card is never changed.
function cardParts(text) {
  if (hasConflict(text)) return null;
  const lines = text.split('\n');
  if (lines[0] !== '---') return null;
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) return null;
  // Each entry: a `key:` line with its continuation lines (indented or `- ` items); anything else
  // (blank lines, comments) is an entry with no key, kept where it is.
  const entries = [];
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    const m = /^([A-Za-z0-9_-]+)\s*:(.*)$/.exec(line);
    if (m) {
      entries.push({ key: m[1], lines: [line] });
    } else if (line.trim() !== '' && (/^\s/.test(line) || /^-\s/.test(line)) && entries.length > 0
      && entries[entries.length - 1].key !== null) {
      entries[entries.length - 1].lines.push(line);
    } else {
      entries.push({ key: null, lines: [line] });
    }
  }
  return { entries, body: lines.slice(close + 1) };
}

// An entry's value as text or a list of text (the app's frontmatter reader, for the keys this script knows).
function entryValue(entry) {
  const rest = entry.lines[0].slice(entry.lines[0].indexOf(':') + 1).trim();
  if (rest === '') {
    return entry.lines.slice(1).map(l => l.trim()).filter(l => /^-\s/.test(l)).map(l => unquote(l.slice(1)));
  }
  if (rest.startsWith('[') && rest.endsWith(']')) {
    return rest.slice(1, -1).split(',').map(s => unquote(s)).filter(s => s !== '');
  }
  return unquote(rest);
}

function cardValues(entries) {
  const out = {};
  for (const e of entries) if (e.key !== null) out[e.key] = entryValue(e);
  return out;
}

function joinCard(entries, body) {
  return ['---', ...entries.flatMap(e => e.lines), '---', ...body].join('\n');
}

// The lines a field is written as; [] leaves it out.
function renderField(key, value) {
  if (value === null || value === undefined) return [];
  if (LIST_KEYS.has(key)) {
    if (value.length === 0) return [];
    return [`${key}:`, ...value.map(v => `  - ${yamlItem(v)}`)];
  }
  if (key === 'title') return [`title: ${yamlText(value)}`];
  if (key === 'budget_hours') return [`budget_hours: ${String(value)}`];
  if (key === 'billable') return [`billable: ${value ? 'true' : 'false'}`];
  return [`${key}: ${value}`];
}

// `entries` with `key` set to `lines` ([] removes it): replaced in place (later copies of the key
// dropped), else inserted after the nearest key before it in ORDER, else before the nearest after it.
function setEntry(entries, key, lines) {
  const at = entries.findIndex(e => e.key === key);
  if (at !== -1) {
    const rest = entries.filter((e, i) => i <= at || e.key !== key);
    if (lines.length === 0) rest.splice(at, 1);
    else rest[at] = { key, lines };
    return rest;
  }
  if (lines.length === 0) return entries;
  const rank = ORDER.indexOf(key);
  let after = -1;
  entries.forEach((e, i) => {
    const r = ORDER.indexOf(e.key);
    if (r !== -1 && r < rank) after = i;
  });
  const out = entries.slice();
  if (after !== -1) {
    out.splice(after + 1, 0, { key, lines });
    return out;
  }
  const before = entries.findIndex(e => ORDER.indexOf(e.key) > rank);
  if (before !== -1) out.splice(before, 0, { key, lines });
  else out.push({ key, lines });
  return out;
}

// ---- fields --------------------------------------------------------------------------------------

function oneLineText(value, name, max, required) {
  if (typeof value !== 'string') throw refuse('bad-request', `${name} must be text`);
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) throw refuse('bad-request', `${name} must be one line`);
  const text = value.trim();
  if (required && text === '') throw refuse('bad-request', `${name} is required`);
  if (text.length > max) throw refuse('bad-request', `${name} is too long (over ${max} characters)`);
  return text;
}

function oneOf(value, name, allowed, nullable) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw refuse('bad-request', `${name} must be one of ${allowed.join(', ')}`);
  }
  return value;
}

function personOf(value, name, team) {
  if (typeof value !== 'string' || !isSlug(value)) throw refuse('bad-request', `${name} must be a team slug`);
  if (team && !team.has(value)) throw refuse('bad-request', `${value} isn't on the team`);
  return value;
}

function listOf(value, name, max, item) {
  if (!Array.isArray(value)) throw refuse('bad-request', `${name} must be a list`);
  if (value.length > max) throw refuse('bad-request', `${name} can have at most ${max} entries`);
  const out = [];
  const seen = new Set();
  for (const v of value) {
    const x = item(v);
    if (seen.has(x.toLowerCase())) throw refuse('bad-request', `${name} lists ${x} twice`);
    seen.add(x.toLowerCase());
    out.push(x);
  }
  return out;
}

// The ProjectFields sent, checked, as card keys → values (null clears). Unknown field names are refused.
function checkFields(fields, ctx, requireTitle) {
  if (fields === undefined) fields = {};
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    throw refuse('bad-request', 'fields must be an object');
  }
  const team = teamSlugs(ctx.root);
  const out = {};
  let brief;
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (name === 'brief') {
      if (typeof value !== 'string') throw refuse('bad-request', 'brief must be text');
      brief = value.replace(/\r\n?/g, '\n').trim();
      if (brief.length > LIMITS.PROJECT_BRIEF_MAX) {
        throw refuse('bad-request', `the brief is too long (over ${LIMITS.PROJECT_BRIEF_MAX} characters)`);
      }
      const lines = brief.split('\n');
      if (linesOutsideFences(lines).some(i => LINKED_HEADING.test(lines[i]))) {
        throw refuse('bad-request', "the brief can't hold a \"## Linked files\" section: files are linked with link");
      }
      // It would read back as a merge conflict, and the card could no longer be changed.
      if (hasConflict(brief)) throw refuse('bad-request', "the brief can't hold git's merge conflict lines");
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(FIELD_KEYS, name)) throw refuse('bad-request', `unknown field ${name}`);
    const key = FIELD_KEYS[name];
    switch (name) {
      case 'title': {
        const title = oneLineText(value, 'title', LIMITS.PROJECT_TITLE_MAX, true);
        if (yamlText(title) === null) throw refuse('bad-request', "the title can't hold both kinds of quote mark");
        out[key] = title;
        break;
      }
      case 'kind': out[key] = oneOf(value, 'kind', KINDS, true); break;
      case 'status': out[key] = oneOf(value, 'status', STATUSES, false); break;
      case 'health': out[key] = oneOf(value, 'health', LIGHTS, true); break;
      case 'comms': out[key] = oneOf(value, 'comms', LIGHTS, true); break;
      case 'owner': out[key] = value === null ? null : personOf(value, 'owner', team); break;
      case 'team': out[key] = listOf(value, 'team', LIMITS.PROJECT_TEAM_MAX, v => personOf(v, 'team', team)); break;
      case 'service':
        out[key] = listOf(value, 'service', SERVICE_MAX, (v) => {
          if (typeof v !== 'string' || v.length > SERVICE_ITEM_MAX || !SLUG_PATTERN.test(v)) {
            throw refuse('bad-request', 'each service must be a lower-case name such as ppc or seo');
          }
          return v;
        });
        break;
      case 'start':
      case 'end':
        if (value !== null && !isRealDate(value)) throw refuse('bad-request', `${name} must be a real date (YYYY-MM-DD)`);
        out[key] = value;
        break;
      case 'budgetHours':
        if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0
          || value > LIMITS.PROJECT_BUDGET_MAX_HOURS)) {
          throw refuse('bad-request', `budget hours must be a number from 0 to ${LIMITS.PROJECT_BUDGET_MAX_HOURS}`);
        }
        out[key] = value === null ? null : Math.round(value * 100) / 100;
        break;
      case 'billable':
        if (value !== null && typeof value !== 'boolean') throw refuse('bad-request', 'billable must be true or false');
        out[key] = value;
        break;
      case 'stages':
        out[key] = listOf(value, 'stages', LIMITS.PROJECT_STAGES_MAX, (v) => {
          const stage = oneLineText(v, 'a stage', LIMITS.PROJECT_STAGE_MAX, true);
          if (yamlItem(stage) === null) throw refuse('bad-request', "a stage can't hold both kinds of quote mark");
          return stage;
        });
        break;
    }
  }
  if (requireTitle && out.title === undefined) throw refuse('bad-request', 'title is required');
  return { values: out, brief };
}

// The dates and kind, once the change is made: `end` never before `start`, and none on an ongoing project.
function checkMerged(merged) {
  const start = typeof merged.start === 'string' ? merged.start : null;
  const end = typeof merged.end === 'string' ? merged.end : null;
  if (start && end && end < start) throw refuse('bad-request', "the end date can't be before the start date");
  if (end && merged.kind === 'ongoing') throw refuse('bad-request', "an ongoing project has no end date");
}

// ---- the brief and `## Linked files` (shared/projects.ts has the read side) -------------------------

const LINKED_HEADING = /^##[ \t]+linked[ \t]+files[ \t]*$/i;
const NEXT_HEADING = /^#{1,2}[ \t]/;
const LINK_ITEM = /^[ \t]*[-*][ \t]+\[([^\]\n]+)\]\((?:<([^>\n]+)>|([^\s()<>]+))\)[ \t]*$/;

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

function resolveLinkPath(target) {
  let rest = String(target).trim();
  while (rest.startsWith('../')) rest = rest.slice(3);
  if (!LINK_ROOTS.some(r => rest.startsWith(r))) return null;
  if (/[\\:%\0]/.test(rest)) return null;
  if (rest.split('/').some(p => p === '' || p === '.' || p === '..')) return null;
  return rest;
}

function linkedRange(lines) {
  const outside = linesOutsideFences(lines);
  const at = outside.findIndex(i => LINKED_HEADING.test(lines[i]));
  if (at === -1) return null;
  const start = outside[at];
  for (let k = at + 1; k < outside.length; k++) {
    if (NEXT_HEADING.test(lines[outside[k]])) return [start, outside[k]];
  }
  return [start, lines.length];
}

function linkOf(line) {
  const m = LINK_ITEM.exec(line);
  return m ? resolveLinkPath(m[2] !== undefined ? m[2] : m[3]) : null;
}

// A new body: the brief, then the section kept from the old body (its exact lines), if any.
function bodyWithBrief(oldBody, brief) {
  const range = linkedRange(oldBody);
  const section = range ? oldBody.slice(range[0], range[1]) : [];
  while (section.length > 0 && section[section.length - 1].trim() === '') section.pop();
  const out = [];
  if (brief) out.push('', ...brief.split('\n'));
  if (section.length > 0) out.push('', ...section);
  if (out.length > 0) out.push('');
  return out;
}

// The body without the `hits` lines of the `## Linked files` section at `range`; the section goes
// too once it is empty, blank lines either side collapsed.
function withoutLines(lines, range, hits) {
  let out = lines.filter((_, i) => !hits.has(i));
  const end = range[1] - hits.size;
  if (out.slice(range[0] + 1, end).every(l => l.trim() === '')) {
    const before = out.slice(0, range[0]);
    while (before.length > 0 && before[before.length - 1].trim() === '') before.pop();
    const after = out.slice(end);
    while (after.length > 0 && after[0].trim() === '') after.shift();
    if (after.length === 0) out = before.length > 0 ? [...before, ''] : [];
    else out = before.length > 0 ? [...before, '', ...after] : ['', ...after];
  }
  return out;
}

// The library's isNeverListed (server/brain/library-rules.ts), as tdsapp-files has it.
function isNeverListed(rel) {
  if (rel === '' || rel.includes('\\') || rel.includes('\0')) return true;
  const segs = rel.toLowerCase().split('/');
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

// The brain path a link request names, written exactly as a link would resolve.
function linkPathOf(input) {
  const rel = input.path;
  if (typeof rel !== 'string' || rel === '') throw refuse('bad-request', 'path is required');
  if (rel.length > PATH_MAX) throw refuse('bad-request', `path is too long (over ${PATH_MAX} characters)`);
  const minParts = rel.startsWith('clients/') || rel.startsWith('projects/') || rel.startsWith('projects-archive/') ? 3 : 2;
  if (resolveLinkPath(rel) !== rel || rel.split('/').length < minParts) {
    throw refuse('bad-request', 'path must be a file under clients/<client>/, projects/<project>/, projects-archive/<project>/, templates/ or personal/');
  }
  return rel;
}

// ---- reading a project for a change ----------------------------------------------------------------

// The card of a located project, checked and read once, compared with `expect`.
function openCard(ctx, loc, expect) {
  if (loc.archived) throw refuse('not-allowed', 'archived projects are read only');
  const abs = path.join(loc.abs, PROJECT_CARD_FILE);
  const st = lstatOrNull(abs);
  if (!st) throw refuse('not-found', `${loc.key} has no card yet: add one first`);
  if (st.isSymbolicLink() || !st.isFile()) throw refuse('not-allowed', `${loc.rel}/${PROJECT_CARD_FILE} isn't a plain file`);
  const bytes = fs.readFileSync(abs);
  const shape = decodeFile(bytes);
  const parts = cardParts(shape.text);
  if (!parts) {
    throw refuse('not-allowed', `${loc.rel}/${PROJECT_CARD_FILE} can't be read (it may hold a merge conflict), so it can't be changed until it's fixed`);
  }
  if (expect !== null && sha256(bytes) !== expect) throw refuse('changed', 'the card has changed since it was read');
  return { abs, bytes, shape, parts, mode: st.mode & 0o7777 };
}

function expectOf(input, required) {
  const value = input.expect;
  if (value === undefined || value === null) {
    if (required) throw refuse('bad-request', 'expect is required');
    return null;
  }
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) throw refuse('bad-request', 'expect must be a hex SHA-256');
  return value.toLowerCase();
}

// Shared projects need someone on the team; personal ones must stay on this Mac.
function checkWriter(ctx, loc, who) {
  if (loc.space === 'personal') requirePrivate(ctx, `${loc.rel}/${PROJECT_CARD_FILE}`);
  else requireTeam(who);
}

function writeCard(card, text) {
  const data = encodeFile(card.shape, text);
  const bytes = Buffer.from(data, 'utf8');
  if (!bytes.equals(card.bytes)) replaceFile(card.abs, data, card.mode);
  return sha256(bytes);
}

// The frontmatter lines of a new card.
function newCardEntries(values, client, created, who) {
  const all = Object.assign({ status: 'active' }, values);
  let entries = [{ key: 'v', lines: ['v: 1'] }];
  for (const key of ORDER) {
    if (key === 'v') continue;
    let lines;
    if (key === 'client') lines = client ? [`client: ${client}`] : [];
    else if (key === 'created') lines = [`created: ${created}`];
    else if (key === 'created_by') lines = who.slug ? [`created_by: ${who.slug}`] : [];
    else lines = renderField(key, all[key]);
    entries = setEntry(entries, key, lines);
  }
  return entries;
}

function createCard(abs, entries, brief) {
  const body = brief ? ['', ...brief.split('\n'), ''] : [];
  const text = joinCard(entries, body) + (body.length === 0 ? '\n' : '');
  createFile(abs, text);
  return sha256(Buffer.from(text, 'utf8'));
}

// A card-less folder's title: README.md's first heading, else the folder name tidied up.
function defaultTitle(folderAbs, slug) {
  try {
    const lines = fs.readFileSync(path.join(folderAbs, 'README.md'), 'utf8').replace(/\r\n?/g, '\n').split('\n');
    for (const i of linesOutsideFences(lines)) {
      const m = lines[i].match(/^#\s+(.+?)\s*#*\s*$/);
      if (!m) continue;
      const title = displayText(m[1], LIMITS.PROJECT_TITLE_MAX);
      if (title && yamlText(title) !== null) return title;
      break;
    }
  } catch { /* no README */ }
  const words = slug.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---- actions ---------------------------------------------------------------------------------------

function create(input, ctx) {
  const space = input.space;
  if (space !== 'client' && space !== 'personal') throw refuse('bad-request', 'space must be "client" or "personal"');
  const slug = input.slug;
  if (!isSlug(slug)) {
    throw refuse('bad-request', `the folder name must be lower-case letters, numbers and single dashes, at most ${LIMITS.PROJECT_SLUG_MAX} characters`);
  }
  const { values, brief } = checkFields(input.fields, ctx, true);
  checkMerged(values);
  const who = identity(ctx);
  let client = null;
  let rel;
  if (space === 'client') {
    client = input.client;
    if (typeof client !== 'string' || client === 'personal' || !isSlug(client)) {
      throw refuse('bad-request', 'client must be a client folder name');
    }
    requireTeam(who);
    requireClientFolder(ctx, client);
    rel = `clients/${client}/projects/${slug}`;
  } else {
    if (input.client !== undefined && input.client !== null) throw refuse('bad-request', 'a personal project has no client');
    rel = `personal/projects/${slug}`;
  }
  sweepDeleting(ctx, space === 'personal' ? 'personal' : client, slug);
  for (const loc of locationsOf(space === 'personal' ? 'personal' : client, slug)) {
    if (lstatOrNull(path.join(ctx.root, ...loc.rel.split('/')))) {
      throw refuse('exists', `there is already a project called ${slug} (${loc.rel})`);
    }
  }
  if (space === 'personal') requirePrivate(ctx, `${rel}/${PROJECT_CARD_FILE}`);

  const parentRel = rel.slice(0, rel.lastIndexOf('/'));
  const parentAbs = path.join(ctx.root, ...parentRel.split('/'));
  fs.mkdirSync(parentAbs, { recursive: true });
  requireRealPath(ctx, parentAbs, parentRel);
  const abs = path.join(ctx.root, ...rel.split('/'));
  try {
    fs.mkdirSync(abs);
  } catch (err) {
    if (errCode(err) === 'EEXIST') throw refuse('exists', `there is already a project called ${slug} (${rel})`);
    throw err;
  }
  let version;
  try {
    version = createCard(path.join(abs, PROJECT_CARD_FILE), newCardEntries(values, client, ukDate(ctx.now), who), brief);
  } catch (err) {
    try { fs.rmdirSync(abs); } catch { /* not empty or gone: leave it */ }
    throw err;
  }
  const key = space === 'personal' ? `personal/${slug}` : `${client}/${slug}`;
  return { ok: true, action: 'create', key, version };
}

function card(input, ctx) {
  const loc = locate(ctx, input.key);
  if (loc.archived) throw refuse('not-allowed', 'archived projects are read only');
  const { values, brief } = checkFields(input.fields, ctx, false);
  checkMerged(values);
  const who = identity(ctx);
  checkWriter(ctx, loc, who);
  const abs = path.join(loc.abs, PROJECT_CARD_FILE);
  if (lstatOrNull(abs)) throw refuse('exists', `${loc.key} already has a card`);
  if (values.title === undefined) values.title = defaultTitle(loc.abs, loc.slug);
  // Security review: a card-less shared folder has no Account Owner, so only an owner or a scout may
  // name one (decision 13). Anyone else's card is written without it (not refused), and the reply says so.
  let ownerDropped = false;
  if (loc.space !== 'personal' && typeof values.owner === 'string' && !isOwnerOrScout(who)) {
    delete values.owner;
    ownerDropped = true;
  }
  let version;
  try {
    version = createCard(abs, newCardEntries(values, loc.client, ukDate(ctx.now), who), brief);
  } catch (err) {
    if (errCode(err) === 'EEXIST') throw refuse('exists', `${loc.key} already has a card`);
    throw err;
  }
  return { ok: true, action: 'card', key: loc.key, version, ...(ownerDropped ? { ownerDropped: true } : {}) };
}

// edit, link and unlink: who, what and where are checked first; the card is read and compared with
// `expect` last, right before the write, so nothing slow sits between the fingerprint and the swap.
function edit(input, ctx) {
  const loc = locate(ctx, input.key);
  const expect = expectOf(input, true);
  const who = identity(ctx);
  checkWriter(ctx, loc, who);
  const { values, brief } = checkFields(input.fields, ctx, false);
  const cardFile = openCard(ctx, loc, expect);
  const current = cardValues(cardFile.parts.entries);
  checkMerged(Object.assign({}, current, values));
  // Security review: changing (or clearing) a shared card's Account Owner is for the Account Owner, an
  // owner or a scout (decision 13), since the Account Owner may delete it. The same value sent back
  // always passes (older apps send every field).
  if (loc.space !== 'personal' && values.owner !== undefined) {
    const owner = cardOwner(current);
    if (values.owner !== owner) {
      const rule = ownerChangeRule(ctx, owner, who);
      if (!rule.allowed) throw refuse('not-allowed', `Only ${rule.allowedWho} can change the Account Owner.`);
    }
  }
  let entries = cardFile.parts.entries;
  for (const [key, value] of Object.entries(values)) entries = setEntry(entries, key, renderField(key, value));
  const body = brief === undefined ? cardFile.parts.body : bodyWithBrief(cardFile.parts.body, brief);
  const version = writeCard(cardFile, joinCard(entries, body));
  return { ok: true, action: 'edit', key: loc.key, version };
}

function link(input, ctx) {
  const loc = locate(ctx, input.key);
  const expect = expectOf(input, true);
  const rel = linkPathOf(input);
  if (loc.space !== 'personal' && rel.startsWith('personal/')) {
    throw refuse('not-allowed', "a shared project can't link a personal file: it would show the team something private");
  }
  const who = identity(ctx);
  checkWriter(ctx, loc, who);
  if (isNeverListed(rel)) throw refuse('bad-request', 'that path is never listed in the library');
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  if (!LIBRARY_EXTENSIONS.includes(extOf(name))) {
    throw refuse('bad-request', 'only the image and document types the library lists can be linked');
  }
  const abs = path.join(ctx.root, ...rel.split('/'));
  const st = lstatOrNull(abs);
  if (!st) throw refuse('bad-request', `there is no file at ${rel}`);
  if (st.isSymbolicLink()) throw refuse('bad-request', `${rel} is a link`);
  if (!st.isFile()) throw refuse('bad-request', `${rel} isn't a file`);
  try {
    requireRealPath(ctx, abs, rel);
  } catch {
    throw refuse('bad-request', `${rel} goes through a link or doesn't match the folder names on disk`);
  }
  const target = '../'.repeat(loc.rel.split('/').length) + rel;
  const shown = name.replace(/\[/g, '(').replace(/\]/g, ')');
  const line = `- [${shown}](${/[\s()<>]/.test(target) ? `<${target}>` : target})`;
  if (/[\p{Cc}]/u.test(rel) || linkOf(line) !== rel) throw refuse('bad-request', `${rel} can't be written as a link`);

  const cardFile = openCard(ctx, loc, expect);
  const lines = cardFile.parts.body.slice();
  const range = linkedRange(lines);
  const linked = [];
  if (range) for (let i = range[0] + 1; i < range[1]; i++) { const p = linkOf(lines[i]); if (p && !linked.includes(p)) linked.push(p); }
  if (linked.includes(rel)) return { ok: true, action: 'link', key: loc.key, version: sha256(cardFile.bytes) };
  if (linked.length >= LIMITS.PROJECT_LINKS_MAX) {
    throw refuse('bad-request', `a project can link at most ${LIMITS.PROJECT_LINKS_MAX} files`);
  }
  let out;
  if (!range) {
    out = lines.slice();
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    out.push('', '## Linked files', '', line, '');
  } else {
    out = lines.slice();
    let last = range[1] - 1;
    while (last > range[0] && out[last].trim() === '') last--;
    const added = last === range[0] ? ['', line] : [line];
    out.splice(last + 1, 0, ...added);
    const next = last + 1 + added.length;
    if (next >= out.length) out.push('');
    else if (NEXT_HEADING.test(out[next])) out.splice(next, 0, '');
  }
  const version = writeCard(cardFile, joinCard(cardFile.parts.entries, out));
  return { ok: true, action: 'link', key: loc.key, version };
}

// A brain path inside a folder a key may name: that folder, its key and the path within it; or null.
const IN_PROJECT_FOLDER = /^(clients\/_archive\/([^/]+)\/projects\/([^/]+)|clients\/([^/]+)\/projects(?:-archive)?\/([^/]+)|personal\/projects(?:-archive)?\/([^/]+)|projects(?:-archive)?\/([^/]+))\/(.+)$/;
function projectFolderOf(rel) {
  const m = IN_PROJECT_FOLDER.exec(rel);
  if (!m) return null;
  let key;
  if (m[2] !== undefined) key = `${m[2]}/${m[3]}`;
  else if (m[4] !== undefined) key = `${m[4]}/${m[5]}`;
  else if (m[6] !== undefined) key = `personal/${m[6]}`;
  else key = `${INTERNAL_CLIENT}/${m[7]}`;
  const parsed = parseKey(key);
  return parsed ? { folder: m[1], key: parsed, rest: m[8] } : null;
}

// The folder a key reads (as locate, without refusing): the first one there that isn't a leftover.
function readFolderOf(ctx, key) {
  return foldersOf(ctx, key).found.find(f => !f.leftover) || null;
}

// The live folder a moved-from key named (liveFolderOf in shared/projects.ts).
function movedFromFolder(key) {
  return key.client === 'personal' ? `personal/projects/${key.slug}` : `clients/${key.client}/projects/${key.slug}`;
}

// Correctness review: the other card paths the app shows as brain path `rel`, mirroring
// archivedFolderPath and movedFolderPath in shared/projects.ts. A link into an archived project's
// live folder reads as into its archive folder, and one into a moved project's old folder (under an
// old key no folder holds now) as into its folder now; so unlink takes out the line the person saw.
function pathsShownAs(ctx, rel) {
  const inside = projectFolderOf(rel);
  if (!inside) return [];
  const pick = readFolderOf(ctx, inside.key);
  if (!pick || pick.rel !== inside.folder) return [];
  const out = [];
  if (pick.archived) {
    const live = liveFolderFor(pick.rel);
    if (live) out.push(`${live}/${inside.rest}`);
  }
  const olds = movedFromOf(pick);
  if (olds.length > 0) {
    let holders = null;
    for (const old of olds) {
      const oldKey = parseKey(old);
      if (!oldKey || readFolderOf(ctx, oldKey)) continue;
      // The app shows the old folder under the lowest key whose card holds the old key (movedFolderPath).
      if (holders === null) holders = movedFromHolders(ctx);
      if (holders.get(old) !== `${inside.key.client}/${inside.key.slug}`) continue;
      out.push(`${movedFromFolder(oldKey)}/${inside.rest}`);
    }
  }
  return out.filter(p => p !== rel);
}

// The moved_from keys on a folder's plain card; none when it has no plain card or can't be read.
function movedFromOf(f) {
  if (f.card !== 'plain') return [];
  let movedFrom;
  try {
    const parts = cardParts(decodeFile(fs.readFileSync(path.join(f.abs, PROJECT_CARD_FILE))).text);
    movedFrom = parts ? cardValues(parts.entries).moved_from : undefined;
  } catch {
    return [];
  }
  if (Array.isArray(movedFrom)) return movedFrom.filter(k => typeof k === 'string');
  return typeof movedFrom === 'string' && movedFrom !== '' ? [movedFrom] : [];
}

// Every project folder base the app lists (server/brain/projects.ts walk), brain-relative, with the
// client its keys go under.
function projectBases(ctx) {
  const dirsIn = rel => {
    try {
      return fs.readdirSync(path.join(ctx.root, ...rel.split('/')), { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => e.name);
    } catch {
      return [];
    }
  };
  const bases = [
    { rel: 'projects', client: INTERNAL_CLIENT },
    { rel: 'projects-archive', client: INTERNAL_CLIENT },
    { rel: 'personal/projects', client: 'personal' },
    { rel: 'personal/projects-archive', client: 'personal' },
  ];
  for (const c of dirsIn('clients')) {
    if (c.startsWith('_')) continue;
    bases.push({ rel: `clients/${c}/projects`, client: c }, { rel: `clients/${c}/projects-archive`, client: c });
  }
  for (const c of dirsIn('clients/_archive')) bases.push({ rel: `clients/_archive/${c}/projects`, client: c });
  return bases.map(b => ({ ...b, names: dirsIn(b.rel) }));
}

// For each old key on any project's moved_from, the lowest key holding it (as movedFolderPath picks).
function movedFromHolders(ctx) {
  const keys = new Set();
  for (const b of projectBases(ctx)) {
    for (const name of b.names) {
      const key = `${b.client}/${name}`;
      if (parseKey(key)) keys.add(key);
    }
  }
  const holders = new Map();
  for (const key of keys) {
    const pick = readFolderOf(ctx, parseKey(key));
    if (!pick) continue;
    for (const old of movedFromOf(pick)) {
      const best = holders.get(old);
      if (best === undefined || key < best) holders.set(old, key);
    }
  }
  return holders;
}

function unlink(input, ctx) {
  const loc = locate(ctx, input.key);
  const expect = expectOf(input, true);
  const rel = linkPathOf(input);
  const who = identity(ctx);
  checkWriter(ctx, loc, who);
  const shownAs = new Set([rel, ...pathsShownAs(ctx, rel)]);
  const cardFile = openCard(ctx, loc, expect);
  const lines = cardFile.parts.body;
  const range = linkedRange(lines);
  const hits = new Set();
  if (range) for (let i = range[0] + 1; i < range[1]; i++) if (shownAs.has(linkOf(lines[i]))) hits.add(i);
  if (hits.size === 0) return { ok: true, action: 'unlink', key: loc.key, version: sha256(cardFile.bytes) };
  const version = writeCard(cardFile, joinCard(cardFile.parts.entries, withoutLines(lines, range, hits)));
  return { ok: true, action: 'unlink', key: loc.key, version };
}

// ---- move (docs/plans/2026-11-21-project-move.md) ------------------------------------------------

// A `## Linked files` line in parts: everything up to the target, the target, and the rest.
const LINK_PARTS = /^([ \t]*[-*][ \t]+\[[^\]\n]+\]\()(?:<([^>\n]+)>|([^\s()<>]+))(\)[ \t]*)$/;

// Every file in a project folder (paths from the folder, sorted), walked once before anything is
// written. Refuses links, a git repository inside, hard-linked files, anything that isn't a plain
// file or folder, and anything on another disk: each would come out wrong after a rename.
function walkFolder(loc, dev, verb, sizes) {
  const done = verb || 'moved';
  const files = [];
  const stack = [''];
  let entries = 0;
  const no = (rel, why) => refuse('not-allowed', `${loc.rel}/${rel} ${why}, so the project can't be ${done}`);
  while (stack.length > 0) {
    const sub = stack.pop();
    const dirAbs = sub === '' ? loc.abs : path.join(loc.abs, ...sub.split('/'));
    let names;
    try {
      names = fs.readdirSync(dirAbs);
    } catch {
      throw no(sub, "can't be read");
    }
    for (const name of names) {
      entries++;
      if (entries > MOVE_WALK_MAX) {
        throw refuse('not-allowed', `${loc.rel} holds more than ${MOVE_WALK_MAX} files and folders, so it can't be ${done} here`);
      }
      const rel = sub === '' ? name : `${sub}/${name}`;
      if (name === '.git') throw no(rel, 'is a git repository inside the project');
      const st = fs.lstatSync(path.join(dirAbs, name));
      if (st.isSymbolicLink()) throw no(rel, 'is a link');
      if (st.dev !== dev) throw no(rel, 'is on another disk');
      if (st.isDirectory()) {
        stack.push(rel);
        continue;
      }
      if (!st.isFile()) throw no(rel, "isn't a plain file or folder");
      if (st.nlink > 1) throw no(rel, 'is hard-linked to another file');
      files.push(rel);
      if (sizes) sizes.set(rel, st.size);
    }
  }
  return files.sort();
}

// The fingerprint of a folder's files (walkFolder's list, ignored files included): hex SHA-256 of the
// sorted folder-relative paths joined with "\n". A file saved into the folder after the check changes it.
function filesVersionOf(files) {
  return sha256(Buffer.from([...files].sort().join('\n'), 'utf8'));
}

// The `## Linked files` lines of a body that resolve, as [line index, brain path].
function linkedLines(body) {
  const range = linkedRange(body);
  const out = [];
  if (range) for (let i = range[0] + 1; i < range[1]; i++) { const p = linkOf(body[i]); if (p) out.push([i, p]); }
  return { range, out };
}

// `personal/` files a personal card links from outside its own folder: moving would share them.
function personalLinksOf(body, folderRel) {
  const out = [];
  for (const [, p] of linkedLines(body).out) {
    if (p.startsWith('personal/') && !p.startsWith(`${folderRel}/`) && !out.includes(p)) out.push(p);
  }
  return out;
}

// The moved card's text: `moved_from` gains the old key (deduped, never the new key, the oldest
// dropping off past PROJECT_MOVED_FROM_MAX), a `client:` line follows the move when there is one, and
// every recognised `## Linked files` line is written from the new folder's depth, those inside the
// old folder pointing into the new one. With `drop`, the personal links outside the folder go.
// Every other line is kept byte for byte.
function movedCardText(cardFile, loc, newRel, newKey, client, drop) {
  const { entries } = cardFile.parts;
  const old = cardValues(entries).moved_from;
  const listed = Array.isArray(old) ? old : typeof old === 'string' && old !== '' ? [old] : [];
  const keys = [];
  for (const k of [...listed, loc.key]) {
    if (!parseKey(k) || k === newKey) continue;
    const at = keys.indexOf(k);
    if (at !== -1) keys.splice(at, 1);
    keys.push(k);
  }
  while (keys.length > PROJECT_MOVED_FROM_MAX) keys.shift();
  let next = setEntry(entries, 'moved_from', renderField('moved_from', keys));
  // Always: a personal card has no `client:` line, and a moved card should read like a created one.
  next = setEntry(next, 'client', [`client: ${client}`]);

  const body = cardFile.parts.body.slice();
  const { range, out } = linkedLines(body);
  const hits = new Set();
  const depth = '../'.repeat(newRel.split('/').length);
  for (const [i, p] of out) {
    if (drop && p.startsWith('personal/') && !p.startsWith(`${loc.rel}/`)) {
      hits.add(i);
      continue;
    }
    const m = LINK_PARTS.exec(body[i]);
    if (!m) continue;
    const target = depth + (p.startsWith(`${loc.rel}/`) ? newRel + p.slice(loc.rel.length) : p);
    body[i] = m[1] + (/[\s()<>]/.test(target) ? `<${target}>` : target) + m[4];
  }
  return joinCard(next, hits.size > 0 ? withoutLines(body, range, hits) : body);
}

// Every check first; then claim the new folder, rewrite the card, rename onto the claim.
function move(input, ctx) {
  const loc = locate(ctx, input.key);
  const expect = expectOf(input, true);
  const client = input.client;
  if (typeof client !== 'string' || client === 'personal' || !isSlug(client)) {
    throw refuse('bad-request', 'client must be a client folder name');
  }
  if (input.dropPersonal !== undefined && input.dropPersonal !== true) throw refuse('bad-request', 'dropPersonal can only be true');
  if (input.check !== undefined && input.check !== true) throw refuse('bad-request', 'check can only be true');
  const filesExpect = input.filesExpect;
  if (filesExpect !== undefined && (typeof filesExpect !== 'string' || !/^[0-9a-f]{64}$/.test(filesExpect))) {
    throw refuse('bad-request', "filesExpect must be a check's filesVersion");
  }
  if (loc.archived) throw refuse('not-allowed', 'archived projects are read only');
  if (loc.space === 'legacy') {
    throw refuse('not-allowed', `${loc.rel} is one of the older project folders other skills still write to, so it can't be moved yet`);
  }
  if (loc.client === client) throw refuse('bad-request', `${loc.key} is already in ${client}`);
  // The old key must stop resolving to a folder, or old links would land on its twin.
  const was = parseKey(loc.key);
  for (const other of locationsOf(was.client, was.slug)) {
    if (other.rel !== loc.rel && lstatOrNull(path.join(ctx.root, ...other.rel.split('/')))) {
      throw refuse('not-allowed', `there's another folder for ${loc.key} (${other.rel}): tidy that up first, or old links would point at it`);
    }
  }
  const who = identity(ctx);
  requireTeam(who);
  const clientSt = requireClientFolder(ctx, client);
  const newRel = `clients/${client}/projects/${loc.slug}`;
  const newKey = `${client}/${loc.slug}`;
  sweepDeleting(ctx, client, loc.slug);
  for (const other of locationsOf(client, loc.slug)) {
    if (lstatOrNull(path.join(ctx.root, ...other.rel.split('/')))) {
      throw refuse('exists', `there is already a project called ${loc.slug} (${other.rel})`);
    }
  }
  openCard(ctx, loc, null);
  const parentRel = `clients/${client}/projects`;
  const parentAbs = path.join(ctx.root, ...parentRel.split('/'));
  const parentSt = lstatOrNull(parentAbs);
  if (parentSt) {
    if (parentSt.isSymbolicLink() || !parentSt.isDirectory()) throw refuse('not-allowed', `${parentRel} isn't a plain folder`);
    requireRealPath(ctx, parentAbs, parentRel);
  }
  const dev = fs.lstatSync(loc.abs).dev;
  if ((parentSt || clientSt).dev !== dev) {
    throw refuse('not-allowed', `${loc.rel} and clients/${client} are on different disks, so the project can't be moved`);
  }
  const files = walkFolder(loc, dev);
  const filesVersion = filesVersionOf(files);
  if (filesExpect !== undefined && filesExpect !== filesVersion) {
    throw refuse('changed', 'the files in this project changed since you checked: check again');
  }
  const cardRel = `${newRel}/${PROJECT_CARD_FILE}`;
  const ignored = ignoredPaths(ctx, [cardRel, ...files.map(f => `${newRel}/${f}`)]);
  if (ignored.has(cardRel)) throw refuse('not-allowed', `${cardRel} wouldn't sync to the team: git ignores it`);

  // The fingerprint last, right before the write.
  const cardFile = openCard(ctx, loc, expect);
  const personalLinks = loc.space === 'personal' ? personalLinksOf(cardFile.parts.body, loc.rel) : [];
  if (input.check === true) {
    return {
      ok: true,
      action: 'move',
      key: newKey,
      version: sha256(cardFile.bytes),
      check: {
        key: newKey,
        files: files.slice(0, MOVE_FILES_SHOWN).map(f => `${loc.rel}/${f}`),
        fileCount: files.length,
        ignoredCount: files.filter(f => ignored.has(`${newRel}/${f}`)).length,
        personalLinks,
        filesVersion,
      },
    };
  }
  if (personalLinks.length > 0 && input.dropPersonal !== true) {
    throw refuse('not-allowed', `the card links ${personalLinks.length === 1 ? 'a personal file' : `${personalLinks.length} personal files`} from outside the project, which moving would share with the team: unlink ${personalLinks.length === 1 ? 'it' : 'them'} first`);
  }
  const text = movedCardText(cardFile, loc, newRel, newKey, client, input.dropPersonal === true);

  // Claim the new folder: an empty folder nothing else can take meanwhile.
  let madeParent = false;
  if (!parentSt) {
    try {
      fs.mkdirSync(parentAbs);
      madeParent = true;
    } catch (err) {
      if (errCode(err) !== 'EEXIST') throw err;
    }
  }
  const newAbs = path.join(ctx.root, ...newRel.split('/'));
  const letGo = () => {
    try { fs.rmdirSync(newAbs); } catch { /* not ours or not empty: leave it */ }
    if (madeParent) { try { fs.rmdirSync(parentAbs); } catch { /* not empty: leave it */ } }
  };
  try {
    requireRealPath(ctx, parentAbs, parentRel);
    fs.mkdirSync(newAbs);
  } catch (err) {
    if (madeParent) { try { fs.rmdirSync(parentAbs); } catch { /* leave it */ } }
    if (errCode(err) === 'EEXIST') throw refuse('exists', `there is already a project called ${loc.slug} (${newRel})`);
    throw err;
  }
  let version;
  try {
    version = writeCard(cardFile, text);
  } catch (err) {
    letGo();
    throw err;
  }
  try {
    (ctx.renameDir || fs.renameSync)(loc.abs, newAbs);
  } catch (err) {
    try { replaceFile(cardFile.abs, cardFile.bytes, cardFile.mode); } catch { /* the card keeps its extra lines */ }
    letGo();
    if (errCode(err) === 'EXDEV') throw refuse('internal', "the project's folder couldn't be moved to another disk");
    throw refuse('internal', `the project's folder couldn't be moved (${errCode(err) || 'error'}), so it stays where it was`);
  }
  syncDir(path.dirname(loc.abs));
  syncDir(parentAbs);
  return { ok: true, action: 'move', key: newKey, version };
}

// ---- archive, unarchive and delete (docs/plans/2026-11-21-project-archive-delete.md) ---------------

// A check lists at most this many of the folder's files and of the brain files that name it.
const REMOVE_FILES_SHOWN = 50;
const REFERENCES_SHOWN = 20;
// The reference search reads at most this many text files, none bigger than this, and stops after
// this long (the app gives the script 10 seconds in all), so its count is "at least".
const REFERENCE_WALK_MAX = 20000;
const REFERENCE_FILE_MAX = 1024 * 1024;
const REFERENCE_TIME_MS = 3000;
const REFERENCE_EXTENSIONS = new Set(['md', 'json', 'cjs', 'js', 'yaml', 'yml']);
const REFERENCE_SKIP_DIRS = new Set(['.git', 'node_modules', 'z-logs', 'z-backup']);
// What a skill or tool could be written in, for the legacy archive refusal.
const NAMING_EXTENSIONS = new Set([...REFERENCE_EXTENSIONS, 'mjs', 'ts', 'sh', 'py', 'txt']);
// Brain files that list paths without ever writing them, so they never block an archive.
// save-location-baseline.json is the save-location scan's list of findings it already knew about.
const NOT_WRITERS = new Set(['tools/save-location-baseline.json']);
const REMOVE_VERBS = { archive: 'archived', unarchive: 'unarchived', delete: 'deleted' };

// Whether `text` names brain path `p` on path boundaries (decision 8): after it a `/`, `)`, `>`, white
// space, a quote or the end; before it the start, a character that can't be in a path, or `../` or
// `agencybrain/` (a link from another folder, or the brain's own folder). So `projects/a` is never
// found in `clients/x/projects/a`, nor `clients/x/projects/a` in `clients/x/projects/a-old`.
function namesPath(text, p) {
  for (let at = text.indexOf(p); at !== -1; at = text.indexOf(p, at + 1)) {
    const after = text[at + p.length];
    if (after !== undefined && !/[/)>\s'"`]/.test(after)) continue;
    if (at === 0 || !/[A-Za-z0-9_.~/-]/.test(text[at - 1])) return true;
    if (text[at - 1] !== '/') continue;
    const seg = /([A-Za-z0-9_.~-]*)$/.exec(text.slice(0, at - 1))[1];
    if (seg === '..' || seg === 'agencybrain') return true;
  }
  return false;
}

// Brain text files under `dirs` (brain-relative, '' for the whole brain) that name `p`, sorted. Never
// inside `skipRel`, `.git`, `node_modules`, `z-logs`, `z-backup`, a `todo/done` or `todo/deleted`
// folder, or a hidden delete folder; links are never followed. With `timed`, stops after
// REFERENCE_WALK_MAX files or REFERENCE_TIME_MS, so the count is "at least".
function filesNaming(ctx, p, dirs, exts, skipRel, timed) {
  const hits = [];
  let read = 0;
  const stack = dirs.slice();
  const until = Date.now() + REFERENCE_TIME_MS;
  while (stack.length > 0 && (!timed || (read < REFERENCE_WALK_MAX && Date.now() < until))) {
    const sub = stack.pop();
    const dirAbs = sub === '' ? ctx.root : path.join(ctx.root, ...sub.split('/'));
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const rel = sub === '' ? e.name : `${sub}/${e.name}`;
      if (e.isDirectory()) {
        if (REFERENCE_SKIP_DIRS.has(e.name) || DELETING.test(e.name) || rel === skipRel) continue;
        if ((e.name === 'done' || e.name === 'deleted') && sub.split('/').pop() === 'todo') continue;
        stack.push(rel);
        continue;
      }
      if (!e.isFile() || !exts.has(extOf(e.name))) continue;
      if (++read > REFERENCE_WALK_MAX && timed) break;
      let text;
      try {
        const fileAbs = path.join(dirAbs, e.name);
        if (fs.lstatSync(fileAbs).size > REFERENCE_FILE_MAX) continue;
        text = fs.readFileSync(fileAbs, 'utf8');
      } catch {
        continue;
      }
      if (namesPath(text, p)) hits.push(rel);
    }
  }
  return hits.sort();
}

// "a, b and c", at most five named.
function listed(items) {
  if (items.length === 1) return items[0];
  const shown = items.slice(0, 5);
  const more = items.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

function removeOptions(input, kind) {
  if (input.check !== undefined && input.check !== true) throw refuse('bad-request', 'check can only be true');
  const filesExpect = input.filesExpect;
  if (filesExpect !== undefined && (typeof filesExpect !== 'string' || !/^[0-9a-f]{64}$/.test(filesExpect))) {
    throw refuse('bad-request', "filesExpect must be a check's filesVersion");
  }
  if (kind === 'delete') {
    if (input.leftover !== undefined && input.leftover !== true) throw refuse('bad-request', 'leftover can only be true');
    if (input.check !== true && filesExpect === undefined) {
      throw refuse('bad-request', "filesExpect is required to delete: check first and send its filesVersion");
    }
  }
  return {
    check: input.check === true,
    filesExpect,
    // A card-less project has no version: '' is the same as none.
    expect: input.expect === '' ? null : expectOf(input, false),
    leftover: kind === 'delete' && input.leftover === true,
  };
}

// The card of a project being archived, unarchived or deleted, read once and compared with `expect`
// (needed when `required` and there is a card); null when there is none. Archive never changes it.
function removeCard(loc, expect, required) {
  const abs = path.join(loc.abs, PROJECT_CARD_FILE);
  const st = lstatOrNull(abs);
  if (!st) {
    if (expect !== null) throw refuse('changed', 'the card has changed since it was read');
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile()) throw refuse('not-allowed', `${loc.rel}/${PROJECT_CARD_FILE} isn't a plain file`);
  const bytes = fs.readFileSync(abs);
  if (expect === null && required) throw refuse('bad-request', 'expect is required when the project has a card');
  if (expect !== null && sha256(bytes) !== expect) throw refuse('changed', 'the card has changed since it was read');
  return bytes;
}

// A team member's name for a slug in either slug form, or null.
function memberNamed(root, slug) {
  const m = readMembers(root).find(x => typeof x.name === 'string' && (memberSlug(x.name) === slug || workbenchSlug(x.name) === slug));
  return m ? displayText(m.name, NAME_MAX) : null;
}

// Who may delete (decision 5, overseer S1), decided here alone: a personal project, the person; a
// leftover holding only git-ignored files (nothing it holds ever synced), anyone on the team; a
// leftover holding anything git would sync (a teammate's work may be in it), as its archived twin's
// card says; a card with an Account Owner, that person or the brain's Owner (role `owner`); a
// card-less or owner-less project or twin, or an unreadable card, the brain's Owner.
function deleteRule(ctx, loc, bytes, who, files, ignored) {
  if (loc.space === 'personal') return { allowed: true, allowedWho: 'only you' };
  if (loc.leftover) {
    if (files.every(f => ignored.has(`${loc.rel}/${f}`))) return { allowed: who.known, allowedWho: 'anyone on the team' };
    return ownerRule(ctx, cardOwner(twinCardValues(ctx, loc)), who);
  }
  const parts = bytes ? cardParts(decodeFile(bytes).text) : null;
  return ownerRule(ctx, cardOwner(parts ? cardValues(parts.entries) : null), who);
}

// The card values of a leftover's archived twin (the first archive folder for its key with a plain
// card), or null when there is none or it can't be read.
function twinCardValues(ctx, loc) {
  const twin = foldersOf(ctx, parseKey(loc.key)).found.find(f => f.archived && f.card === 'plain');
  if (!twin) return null;
  try {
    requireRealPath(ctx, twin.abs, twin.rel);
    const parts = cardParts(decodeFile(fs.readFileSync(path.join(twin.abs, PROJECT_CARD_FILE))).text);
    return parts ? cardValues(parts.entries) : null;
  } catch {
    return null;
  }
}

// Security review: a personal project's folder is archived, unarchived or deleted only when git
// tracks nothing in it (else the change would sync to the team). Allowed when the brain isn't a
// git repository; refused when git can't tell.
function requireUntracked(ctx, rel, verb) {
  const repo = brainRepo(ctx);
  if (repo === 'none') return;
  const unchecked = () => refuse('not-allowed', "git couldn't check that this project stays on this Mac");
  if (repo === null) throw unchecked();
  const out = gitInBrain(ctx, ['ls-files', '-z', '--', rel]);
  if (!out || out.status !== 0) throw unchecked();
  if ((out.stdout || '') !== '') {
    throw refuse('not-allowed', `git already syncs files in ${rel} to the team, so it can't be ${verb} here`);
  }
}

// The folder a project would go to is checked as move's: its parent is a real folder or will be made
// one level down from one that must already be real (never a client folder), on the same disk.
function removeParent(ctx, to, dev) {
  const parentRel = to.slice(0, to.lastIndexOf('/'));
  const baseRel = parentRel.includes('/') ? parentRel.slice(0, parentRel.lastIndexOf('/')) : '';
  let baseSt;
  if (baseRel === '') {
    baseSt = fs.lstatSync(ctx.root);
  } else if (baseRel.startsWith('clients/')) {
    baseSt = requireClientFolder(ctx, baseRel.slice('clients/'.length));
  } else {
    const baseAbs = path.join(ctx.root, ...baseRel.split('/'));
    baseSt = lstatOrNull(baseAbs);
    if (!baseSt || baseSt.isSymbolicLink() || !baseSt.isDirectory()) throw refuse('not-allowed', `${baseRel} isn't a plain folder`);
    requireRealPath(ctx, baseAbs, baseRel);
  }
  const parentAbs = path.join(ctx.root, ...parentRel.split('/'));
  const parentSt = lstatOrNull(parentAbs);
  if (parentSt) {
    if (parentSt.isSymbolicLink() || !parentSt.isDirectory()) throw refuse('not-allowed', `${parentRel} isn't a plain folder`);
    requireRealPath(ctx, parentAbs, parentRel);
  }
  if ((parentSt || baseSt).dev !== dev) {
    throw refuse('not-allowed', `${to} would be on a different disk, so the project can't be moved there`);
  }
  return { rel: parentRel, abs: parentAbs, exists: Boolean(parentSt) };
}

// archive, unarchive and delete: every check first (as move), the card and its fingerprint last.
// Then one rename (archive, unarchive), or a rename to a hidden git-ignored name and a recursive
// remove (delete). A refusal leaves everything as it was.
function removeAction(kind, input, ctx) {
  const opts = removeOptions(input, kind);
  const loc = locate(ctx, input.key, { leftover: opts.leftover });
  const verb = REMOVE_VERBS[kind];
  if (loc.readOnly) {
    throw refuse('not-allowed', `${loc.key} belongs to an archived client (${loc.rel}), so it stays read only`);
  }
  let to = null;
  if (kind !== 'delete') {
    if (kind === 'archive' && loc.archived) throw refuse('bad-request', `${loc.key} is already archived`);
    if (kind === 'unarchive' && !loc.archived) throw refuse('bad-request', `${loc.key} isn't archived`);
    if (loc.leftover) {
      throw refuse('not-allowed', `${loc.rel} was left behind on this Mac (it has no card), so it can't be ${verb}: delete it instead`);
    }
    to = kind === 'archive' ? archiveFolderFor(loc.rel) : liveFolderFor(loc.rel);
    if (to === null) throw refuse('not-allowed', `${loc.rel} can't be ${verb}`);
    // Never renamed on a clash: any other folder for the key (decisions 3 and 4).
    const was = parseKey(loc.key);
    for (const other of locationsOf(was.client, was.slug)) {
      if (other.rel !== loc.rel && lstatOrNull(path.join(ctx.root, ...other.rel.split('/')))) {
        throw refuse('exists', `there is already a folder for ${loc.key} (${other.rel}), so it can't be ${verb}`);
      }
    }
  }
  const dev = fs.lstatSync(loc.abs).dev;
  const parent = to === null ? null : removeParent(ctx, to, dev);
  // A skill or tool that writes to an older projects/ folder would make it again (overseer S4).
  if (kind === 'archive' && loc.space === 'legacy') {
    const naming = filesNaming(ctx, loc.rel, ['.claude/skills', 'tools'], NAMING_EXTENSIONS, null, false).filter(
      (f) => !NOT_WRITERS.has(f),
    );
    if (naming.length > 0) {
      throw refuse('not-allowed', `${listed(naming)} ${naming.length === 1 ? 'names' : 'name'} ${loc.rel} and would make it again, so it can't be archived yet: change ${naming.length === 1 ? 'that file' : 'those files'} first`);
    }
  }
  if (loc.space === 'personal') {
    requirePrivate(ctx, `${to === null ? loc.rel : to}/${PROJECT_CARD_FILE}`);
    requireUntracked(ctx, loc.rel, verb);
  }

  const sizes = new Map();
  const files = walkFolder(loc, dev, verb, sizes);
  const empty = files.every(f => f === PROJECT_CARD_FILE);
  if (kind === 'delete' && !loc.archived && !loc.leftover && !empty) {
    throw refuse('not-allowed', `${loc.key} still holds files, so it can't be deleted: archive it first`);
  }
  const filesVersion = filesVersionOf(files);
  if (opts.filesExpect !== undefined && opts.filesExpect !== filesVersion) {
    throw refuse('changed', 'the files in this project changed since you checked: check again');
  }
  // Delete hides the folder first under a name git must ignore (`*~`), so a sync mid-remove can't
  // share half a project.
  let hidden = null;
  const rels = files.map(f => `${loc.rel}/${f}`);
  if (kind === 'delete') {
    const name = `.tdsapp-projects-${loc.slug}-${crypto.randomBytes(6).toString('hex')}.deleting~`;
    hidden = { rel: `${loc.rel.slice(0, loc.rel.lastIndexOf('/'))}/${name}`, abs: path.join(path.dirname(loc.abs), name) };
    rels.push(hidden.rel);
  }
  const ignored = ignoredPaths(ctx, rels);
  if (hidden && !ignored.has(hidden.rel) && brainRepo(ctx) !== 'none') {
    throw refuse('not-allowed', "git doesn't ignore files ending in ~ in this brain, so the folder can't be removed without the team seeing half of it: add *~ to the brain's .gitignore");
  }

  const who = identity(ctx);
  // The fingerprint last, right before the write.
  const bytes = removeCard(loc, opts.expect, kind !== 'delete' && !opts.check);
  let rule;
  if (kind === 'delete') rule = deleteRule(ctx, loc, bytes, who, files, ignored);
  else if (loc.space === 'personal') rule = { allowed: true, allowedWho: 'only you' };
  else rule = { allowed: who.known, allowedWho: 'anyone on the team' };

  if (opts.check) {
    const references = filesNaming(ctx, loc.rel, [''], REFERENCE_EXTENSIONS, loc.rel, true);
    let images = 0;
    let documents = 0;
    let other = 0;
    let total = 0;
    for (const f of files) {
      const ext = extOf(f.slice(f.lastIndexOf('/') + 1));
      if (IMAGE_EXTENSIONS.includes(ext)) images++;
      else if (DOCUMENT_EXTENSIONS.includes(ext)) documents++;
      else other++;
      total += sizes.get(f) || 0;
    }
    const ignoredCount = files.filter(f => ignored.has(`${loc.rel}/${f}`)).length;
    return {
      ok: true,
      action: kind,
      key: loc.key,
      version: bytes ? sha256(bytes) : '',
      check: {
        key: loc.key,
        from: loc.rel,
        to,
        files: rels.slice(0, Math.min(files.length, REMOVE_FILES_SHOWN)),
        fileCount: files.length,
        images,
        documents,
        other,
        bytes: total,
        ignoredCount,
        localOnlyCount: loc.space === 'personal' ? files.length : ignoredCount,
        references: references.slice(0, REFERENCES_SHOWN),
        referenceCount: references.length,
        filesVersion,
        empty,
        allowed: rule.allowed,
        allowedWho: rule.allowedWho,
      },
    };
  }
  if (!rule.allowed) {
    if (kind === 'delete') throw refuse('not-allowed', `only ${rule.allowedWho} can delete ${loc.key}`);
    requireTeam(who);
  }

  const rename = ctx.renameDir || fs.renameSync;
  const fromParent = path.dirname(loc.abs);
  if (kind === 'delete') {
    try {
      rename(loc.abs, hidden.abs);
    } catch (err) {
      throw refuse('internal', `the project's folder couldn't be deleted (${errCode(err) || 'error'}), so it stays where it was`);
    }
    syncDir(fromParent);
    try { removeTree(ctx, hidden.abs); } catch { /* checked next */ }
    // The project is gone either way: what's left is out of sight, on this Mac only (git ignores
    // it), and the next call for a project there tries again. The caller still applies its to-dos.
    if (lstatOrNull(hidden.abs)) return { ok: true, action: kind, key: loc.key, version: '', leftBehind: hidden.rel };
    return { ok: true, action: kind, key: loc.key, version: '' };
  }

  // One level only, under a folder already checked as real.
  let madeParent = false;
  if (!parent.exists) {
    try {
      fs.mkdirSync(parent.abs);
      madeParent = true;
    } catch (err) {
      if (errCode(err) !== 'EEXIST') throw err;
    }
  }
  const letGo = () => {
    if (madeParent) { try { fs.rmdirSync(parent.abs); } catch { /* not empty: leave it */ } }
  };
  const toAbs = path.join(ctx.root, ...to.split('/'));
  try {
    requireRealPath(ctx, parent.abs, parent.rel);
    if (lstatOrNull(toAbs)) throw refuse('exists', `there is already a folder for ${loc.key} (${to}), so it can't be ${verb}`);
  } catch (err) {
    letGo();
    throw err;
  }
  try {
    rename(loc.abs, toAbs);
  } catch (err) {
    letGo();
    throw refuse('internal', `the project's folder couldn't be ${verb} (${errCode(err) || 'error'}), so it stays where it was`);
  }
  syncDir(fromParent);
  syncDir(parent.abs);
  return { ok: true, action: kind, key: loc.key, version: '' };
}

function archive(input, ctx) {
  return removeAction('archive', input, ctx);
}

function unarchive(input, ctx) {
  return removeAction('unarchive', input, ctx);
}

function deleteProject(input, ctx) {
  return removeAction('delete', input, ctx);
}

function capabilities() {
  return {
    ok: true,
    action: 'capabilities',
    version: SCRIPT_VERSION,
    features: [PROJECTS_CAPABILITY, PROJECTS_MOVE_CAPABILITY, PROJECTS_ARCHIVE_CAPABILITY],
  };
}

// ---- command line --------------------------------------------------------------------------------

const ACTIONS = { create, card, edit, link, unlink, move, archive, unarchive, delete: deleteProject, capabilities };

function defaultCtx() {
  return {
    root: process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..'),
    home: os.homedir(),
    now: new Date(),
  };
}

// Runs one action. Returns the exit code and the reply; never throws.
function run(action, input, ctx) {
  const fail = (code, message) => ({ exit: code === 'internal' ? 1 : 2, reply: { ok: false, error: code, message } });
  if (typeof action !== 'string' || !ACTION_NAMES.includes(action)) return fail('bad-request', 'unknown action');
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return fail('bad-request', 'stdin must be one JSON object');
  }
  if (input.kind !== undefined && input.kind !== action) return fail('bad-request', 'kind must name the same action');
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
      result = { exit: 2, reply: { ok: false, error: 'bad-request', message: 'stdin is too long' } };
    } else {
      const raw = Buffer.concat(chunks).toString('utf8');
      let input;
      try {
        input = raw.trim() === '' ? {} : JSON.parse(raw);
      } catch {
        input = undefined;
      }
      result = input === undefined
        ? { exit: 2, reply: { ok: false, error: 'bad-request', message: 'invalid JSON' } }
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
  run,
  SCRIPT_VERSION,
  PROJECTS_CAPABILITY,
  PROJECTS_MOVE_CAPABILITY,
  PROJECTS_ARCHIVE_CAPABILITY,
  PROJECT_MOVED_FROM_MAX,
  INTERNAL_CLIENT,
  INTERNAL_PRECEDENCE,
  PROJECT_CARD_FILE,
  LIMITS,
  LINK_ROOTS,
};
