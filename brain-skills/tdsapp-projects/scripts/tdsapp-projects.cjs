#!/usr/bin/env node
// tdsapp-projects.cjs (v0.6.0): make and change project cards (`project.md`) the way TDS Cortex does,
// move a project to another client, archive, unarchive or delete one, keep its updates log, and give
// projects their codes ("refs", docs/plans/2026-11-24-projects-r2-project-codes.md), and keep email
// drafts for their inbox owner's approval (docs/plans/2026-11-24-projects-r2-email-entries.md). The
// plans are the app repo's docs/plans/2026-11-20-projects-system.md (decisions 1-4b, 8, 9 and 27),
// docs/plans/2026-11-21-project-move.md, docs/plans/2026-11-21-project-archive-delete.md and
// docs/plans/2026-11-23-projects-r2-updates-log.md; the shapes are in its shared/projects-contract.ts
// and shared/project-updates-contract.ts (a test checks the constants here match).
//
// Usage:
//   echo '<json>' | node .claude/skills/tdsapp-projects/scripts/tdsapp-projects.cjs <action>
//
//   <action>  create | card | edit | link | unlink | move | archive | unarchive | delete | update |
//             update-remove | ref | find-ref | email-draft | email-draft-remove | capabilities
//   stdin     one JSON object (at most 256 KB), the app's ProjectAction (camelCase field names):
//             create {space, client?, slug, fields}, card {key, fields}, edit {key, fields, expect},
//             link {key, path, expect}, unlink {key, path, expect},
//             move {key, client, expect, dropPersonal?: true, check?: true, filesExpect?},
//             archive / unarchive {key, expect?, check?: true, filesExpect?},
//             delete {key, expect?, check?: true, filesExpect?, leftover?: true},
//             update {key, entry: {kind: note|call, summary, clientSafe}}, update-remove {key, file, expect},
//             ref {key, expect, replace?: true} or {all: true}, find-ref {text},
//             email-draft {EmailDraftInput}, email-draft-remove {id, dismiss},
//             update {key, entry: {kind: email, draft, token, summary, subject, from, people, clientSafe}}
//             (the app only, on the inbox owner's Save), capabilities {}.
//             A `kind` field, when sent, must name the same action.
//   stdout    one JSON line: {ok: true, action, key, version} or {ok: false, error, message}.
//             `version` is the hex SHA-256 of project.md's bytes after the change. `move` answers the
//             new key; with `check: true` it writes nothing and adds `check` (what the move would do,
//             with `filesVersion`, the fingerprint of the folder's files). Sent back as `filesExpect`,
//             the move is refused with `changed` when the folder's files are no longer those checked.
//             archive, unarchive and delete answer `version: ''`; with `check: true` they add `check`
//             (ProjectRemoveCheck: what would move or go, who may, and what else names the folder).
//             `update` adds `file`, the new entry's brain path; `edit` adds `updatesFailed: true` when
//             the card changed but an automatic log entry couldn't be written. `ref` answers `given`
//             and `skipped` (plus key and version for one card); `find-ref` answers `found` and `near`.
//             `email-draft` and `email-draft-remove` answer `id` (never the draft's token); an
//             `exists` refusal for an email adds `file` and `key`, the entry that already holds it.
//   exit 0    ok; exit 2 refused (bad-request, not-found, exists, changed, not-allowed, dismissed);
//             exit 1 internal.
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
//   v, title, client, ref, kind, status, health, comms, owner, team, service, start, end, budget_hours,
//   billable, stages, monday_id, created, created_by, moved_from
// Body: the brief, then an optional `## Linked files` section of `- [name](path from the card)` lines.
//
// The updates log (R2 phase 2): one file per entry in `<project folder>/updates/`, named
// `<YYYY-MM-DD>-<HHmm>-<person>-<random6>.md` (UK time), flat frontmatter `v, kind, by, at,
// client_safe` (auto entries add `change, from, to`), body the summary. `by` and `at` are this Mac's
// identity and clock. A file is only ever created (never overwritten: a clash retries a new suffix)
// or removed by `update-remove`. `edit` writes one entry per changed status, health or Account Owner,
// after the card; a failure there never undoes the card.
//
// Project codes: `ref:` is written by create, card, ref and a move from personal, never by edit,
// and kept byte for byte by everything else. Picking reads every card on disk plus the cards deleted
// in git history (two git calls); when git can't say, create, card and move write no code, and only
// ref refuses. find-ref is read only and never runs git.
//
// When `require`d it runs nothing and exports `run(action, input, ctx)`, so tests can pass a brain
// root, a home folder and a clock (and `refPick`, standing in for the code's random pick). The command line always uses the real clock. Plain Node, no
// dependencies.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_VERSION = '0.6.0';

// Mirrors shared/projects-contract.ts (a test checks they match).
const PROJECTS_CAPABILITY = 'projects-v1';
const PROJECTS_MOVE_CAPABILITY = 'projects-move-v1';
const PROJECTS_ARCHIVE_CAPABILITY = 'projects-archive-v1';
// Mirrors shared/project-updates-contract.ts (a test checks they match).
const PROJECTS_UPDATES_CAPABILITY = 'projects-updates-v1';
// Mirrors shared/project-refs-contract.ts (a test checks they match): project codes ("refs").
const PROJECTS_REFS_CAPABILITY = 'projects-refs-v1';
// Projects R2 phase 5 (docs/plans/2026-11-24-projects-r2-email-entries.md): email drafts and email
// entries, as shared/project-email-contract.ts (a test checks these match).
const PROJECTS_EMAIL_CAPABILITY = 'projects-email-v1';
const EMAIL_DRAFT_FILE_PATTERN = /^[a-z0-9]{12}\.json$/;
const EMAIL = {
  EMAIL_DRAFTS_DIR: 'briefing/email-drafts',
  DISMISSED_DAYS: 90,
  DRAFT_MAX_AGE_DAYS: 30,
  EMAIL_SUBJECT_MAX: 300,
  EMAIL_PERSON_MAX: 320,
  EMAIL_PEOPLE_MAX: 30,
  EMAIL_THREAD_IDS_MAX: 20,
  EMAIL_NEWEST_TEXT_MAX: 4000,
  MESSAGE_ID_MAX: 300,
  EMAIL_NAME_MAX: 120,
};
const EMAIL_DRAFTS_DIR_MODE = 0o700;
const EMAIL_DRAFT_FILE_MODE = 0o600;
const EMAIL_DRAFT_MAX_BYTES = 64 * 1024;
const GMAIL_THREAD_ID_PATTERN = /^[0-9a-f]{8,32}$/i;
// The whole `email-draft` call, as JSON, so it always fits Cortex's 20,000-character command limit
// with the command around it (overseer 4): every field at its own limit together would not.
const EMAIL_DRAFT_INPUT_MAX = 19000;
// An entry file this big is no entry this script wrote: skipped when looking for an email.
const ENTRY_READ_MAX = 256 * 1024;
const REF_DIGITS = '23456789';
const REF_LETTERS = 'ACDEFGHJKMNPQRTUVWXY';
const CLIENT_CODE_PATTERN = /^[A-Z0-9]{2,4}$/;
const REF_PATTERN = /^[A-Z0-9]{2,4}[2-9][ACDEFGHJKMNPQRTUVWXY][2-9]$/;
const REF_PROJECT_PART = 3;
const REF_CANDIDATE_SOURCE = '[A-Z0-9]{2,4}[0-9][A-Z][0-9]';
const REF_CANDIDATES_MAX = 5;
// find-ref reads at most this much text.
const FIND_REF_TEXT_MAX = 200000;
// The history scan's git calls share this much time, well inside the app's 10 second script timeout.
const REF_HISTORY_BUDGET_MS = 5000;
// Where a deleted card could have been, for the history scan (git's `*` matches `/` too, so deeper
// folders are read as well: stricter, never looser).
const REF_HISTORY_PATHS = [
  'clients/*/projects/*/project.md',
  'clients/*/projects-archive/*/project.md',
  'projects/*/project.md',
  'projects-archive/*/project.md',
  'personal/projects/*/project.md',
  'personal/projects-archive/*/project.md',
];
const UPDATES_DIR = 'updates';
const UPDATE_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{6}\.md$/;
const UPDATE_SUMMARY_MAX = 5000;
// Kinds a person may add, and remove again; every other kind is the script's own or a later phase's.
const MANUAL_UPDATE_KINDS = ['note', 'call'];
// Names tried for a new entry before giving up (each with a new random suffix).
const UPDATE_NAME_TRIES = 5;
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
const ERRORS = new Set(['bad-request', 'not-found', 'exists', 'changed', 'not-allowed', 'dismissed', 'internal']);
const ACTION_NAMES = [
  'create', 'card', 'edit', 'link', 'unlink', 'move', 'archive', 'unarchive', 'delete', 'update', 'update-remove',
  'ref', 'find-ref', 'email-draft', 'email-draft-remove', 'capabilities',
];
// A move lists at most this many of the folder's files in its check, and walks at most this many entries.
const MOVE_FILES_SHOWN = 50;
const MOVE_WALK_MAX = 5000;

// Card frontmatter keys, in the order they are written. `ref` (the project code) sits right after
// `client` and is only ever written by create, card, ref and a move from personal.
const ORDER = [
  'v', 'title', 'client', 'ref', 'kind', 'status', 'health', 'comms', 'owner', 'team', 'service', 'start', 'end',
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
  constructor(code, message, extra) {
    super(message);
    this.code = ERRORS.has(code) ? code : 'internal';
    // More facts for the reply (such as where an email already is). Never a draft's token.
    this.extra = extra && typeof extra === 'object' ? extra : null;
  }
}
const refuse = (code, message, extra) => new Refusal(code, message, extra);

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
// run's home. Null if it can't run. `opts.timeout` shortens the 5 second limit; `opts.raw` answers
// stdout as bytes.
function gitInBrain(ctx, args, input, opts) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  env.HOME = ctx.home;
  env.LC_ALL = 'C';
  env.LANGUAGE = '';
  const out = spawnSync('git', args, {
    cwd: ctx.root,
    encoding: opts && opts.raw ? 'buffer' : 'utf8',
    timeout: opts && opts.timeout ? Math.min(5000, opts.timeout) : 5000,
    env,
    input,
    maxBuffer: 16 * 1024 * 1024,
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
    if (name === 'ref') throw refuse('bad-request', "A project's code can't be set or changed here.");
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
function newCardEntries(values, client, created, who, ref) {
  const all = Object.assign({ status: 'active' }, values);
  let entries = [{ key: 'v', lines: ['v: 1'] }];
  for (const key of ORDER) {
    if (key === 'v') continue;
    let lines;
    if (key === 'client') lines = client ? [`client: ${client}`] : [];
    else if (key === 'created') lines = [`created: ${created}`];
    else if (key === 'created_by') lines = who.slug ? [`created_by: ${who.slug}`] : [];
    else if (key === 'ref') lines = ref ? refLines(ref) : [];
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
  // The project code, picked before anything is written. Never a reason to refuse: none when the
  // client has no code or git can't say which codes deleted cards used.
  const ref = space === 'client' ? newRefFor(ctx, client) : null;

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
    version = createCard(path.join(abs, PROJECT_CARD_FILE), newCardEntries(values, client, ukDate(ctx.now), who, ref), brief);
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
  // As create: a client or internal card gets a code when one can be picked, else none.
  const ref = loc.space === 'personal' ? null : newRefFor(ctx, loc.client);
  let version;
  try {
    version = createCard(abs, newCardEntries(values, loc.client, ukDate(ctx.now), who, ref), brief);
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
  // The card change stands whatever happens to its log entries (updates log decision 4).
  let updatesFailed = false;
  try {
    writeAutoEntries(ctx, loc, who, current, values);
  } catch {
    updatesFailed = true;
  }
  return { ok: true, action: 'edit', key: loc.key, version, ...(updatesFailed ? { updatesFailed: true } : {}) };
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
function movedCardText(cardFile, loc, newRel, newKey, client, drop, newRef) {
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
  // A move from personal may give the card a code (move()); otherwise `ref:` stays as it is.
  if (newRef) next = setEntry(next, 'ref', refLines(newRef));

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

  // Project codes: a personal project joining a client gets one, unless its own ref is valid and no
  // other card holds it. Picked here, so nothing slow sits between the fingerprint and the write;
  // none when the client has no code or git can't say.
  const spareRef = loc.space === 'personal' && input.check !== true ? newRefFor(ctx, client) : null;

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
  let newRef = null;
  if (spareRef) {
    const own = cardRefOf(cardValues(cardFile.parts.entries));
    if (!own || heldElsewhere(ctx, loc.rel, own)) newRef = spareRef;
  }
  const text = movedCardText(cardFile, loc, newRel, newKey, client, input.dropPersonal === true, newRef);

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
// What a skill or tool could be written in, for the archive refusal.
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
  // A skill or tool that writes to the folder would make it again (overseer S4). Every shared
  // project since 0.3.2: the older projects/ folders moved into clients/, and their tools with them.
  if (kind === 'archive' && loc.space !== 'personal') {
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

// ---- the updates log (docs/plans/2026-11-23-projects-r2-updates-log.md) ---------------------------

// The UK local date and time of `at` for an entry's file name: YYYY-MM-DD-HHmm (GMT or BST).
function ukStamp(at) {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at)) {
    p[part.type] = part.value;
  }
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`;
}

// `at` as written: ISO 8601 in UTC to the second.
function isoSecond(at) {
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Six characters of [a-z0-9] for an entry's file name.
const SUFFIX_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
function randomSuffix() {
  let out = '';
  for (let i = 0; i < 6; i++) out += SUFFIX_CHARS[crypto.randomInt(SUFFIX_CHARS.length)];
  return out;
}

// Who an entry is by: this Mac's team slug, or `me` on a personal project when there is none.
// Shared projects only ever get here for someone on the team (checkWriter).
function entryBy(loc, who) {
  if (who.known && who.slug) return who.slug;
  if (loc.space === 'personal') return 'me';
  throw refuse('not-allowed', 'only people on the team in .team-config/roles.json can add to shared projects');
}

// Whether `who` wrote an entry whose `by` is `by`.
function isAuthor(loc, who, by) {
  if (typeof by !== 'string' || by === '') return false;
  if (isPerson(who, by) || (who.known && who.slug === by)) return true;
  return loc.space === 'personal' && by === 'me';
}

// A located project that may take or lose entries: live, with a card that can be read. A card-less
// folder may be a moved or archived project's leftover, and an entry would turn it into a ghost project.
function requireLiveCard(ctx, loc) {
  if (loc.archived) throw refuse('not-allowed', 'archived projects are read only');
  try {
    return openCard(ctx, loc, null);
  } catch (err) {
    if (err instanceof Refusal && err.code === 'not-found') {
      throw refuse('not-allowed', `${loc.key} has no card, so it can't keep updates: add a card first`);
    }
    throw err;
  }
}

// The project's updates/ folder, checked as a real folder (made when `make` and it isn't there yet).
function updatesFolder(ctx, loc, make) {
  const rel = `${loc.rel}/${UPDATES_DIR}`;
  const abs = path.join(loc.abs, UPDATES_DIR);
  const check = (st) => {
    if (st.isSymbolicLink()) throw refuse('not-allowed', `${rel} is a link, so its updates can't be changed here`);
    if (!st.isDirectory()) throw refuse('not-allowed', `${rel} isn't a folder, so its updates can't be changed here`);
  };
  let st = lstatOrNull(abs);
  if (!st) {
    if (!make) throw refuse('not-found', `${loc.key} has no updates yet`);
    try {
      fs.mkdirSync(abs);
    } catch (err) {
      if (errCode(err) !== 'EEXIST') throw err;
    }
    st = lstatOrNull(abs);
    if (!st) throw refuse('internal', `${rel} couldn't be made`);
  }
  check(st);
  requireRealPath(ctx, abs, rel);
  return { rel, abs };
}

// A frontmatter value for an entry: `""` when empty, else quoted only when YAML would misread it.
function factValue(value) {
  if (value === '') return '""';
  const text = yamlText(value);
  return text === null ? '""' : text;
}

// Writes one entry file, created all at once and never over another: a clash tries a new suffix.
// Answers its brain-relative path.
function writeEntry(ctx, loc, who, folder, front, summary) {
  const by = entryBy(loc, who);
  const person = workbenchSlug(by) || 'me';
  const lines = [
    '---',
    'v: 1',
    `kind: ${front.kind}`,
    `by: ${by}`,
    `at: ${isoSecond(ctx.now)}`,
    `client_safe: ${front.clientSafe ? 'true' : 'false'}`,
  ];
  if (front.change !== undefined) {
    lines.push(`change: ${front.change}`, `from: ${factValue(front.from)}`, `to: ${factValue(front.to)}`);
  }
  if (front.email !== undefined) lines.push(...emailLines(front.email));
  const text = [...lines, '---', '', summary, ''].join('\n');
  const stamp = ukStamp(ctx.now);
  const suffix = ctx.updateSuffix || randomSuffix;
  for (let i = 0; i < UPDATE_NAME_TRIES; i++) {
    const name = `${stamp}-${person}-${suffix()}.md`;
    if (!UPDATE_FILE_PATTERN.test(name)) throw refuse('internal', `${name} isn't an update file name`);
    const rel = `${folder.rel}/${name}`;
    if (loc.space === 'personal') requirePrivate(ctx, rel);
    try {
      createFile(path.join(folder.abs, name), text);
      return rel;
    } catch (err) {
      if (errCode(err) !== 'EEXIST') throw err;
    }
  }
  throw refuse('internal', "a free name for the update couldn't be found: try again");
}

// A summary as written: line ends made \n and trimmed; one that is empty, too long, holds control
// characters or a whole merge conflict (it would read back as unreadable) is refused.
function checkSummary(value) {
  if (typeof value !== 'string') throw refuse('bad-request', 'the summary must be text');
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (text === '') throw refuse('bad-request', 'the summary is empty');
  if (text.length > UPDATE_SUMMARY_MAX) {
    throw refuse('bad-request', `the summary is too long (over ${UPDATE_SUMMARY_MAX} characters)`);
  }
  if (/[\p{Cc}]/u.test(text.replace(/[\n\t]/g, ''))) throw refuse('bad-request', "the summary can't hold control characters");
  if (hasConflict(text)) throw refuse('bad-request', "the summary can't hold git's merge conflict lines");
  return text;
}

function update(input, ctx) {
  const loc = locate(ctx, input.key);
  const entry = input.entry;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw refuse('bad-request', 'entry must be an object');
  }
  if (entry.kind === 'email') return emailUpdate(input, entry, loc, ctx);
  if (!MANUAL_UPDATE_KINDS.includes(entry.kind)) throw refuse('bad-request', 'entry kind must be note, call or email');
  const summary = checkSummary(entry.summary);
  if (typeof entry.clientSafe !== 'boolean') throw refuse('bad-request', 'clientSafe must be true or false');
  const who = identity(ctx);
  checkWriter(ctx, loc, who);
  const cardFile = requireLiveCard(ctx, loc);
  const folder = updatesFolder(ctx, loc, true);
  const file = writeEntry(ctx, loc, who, folder, { kind: entry.kind, clientSafe: entry.clientSafe }, summary);
  return { ok: true, action: 'update', key: loc.key, version: sha256(cardFile.bytes), file };
}

function updateRemove(input, ctx) {
  const loc = locate(ctx, input.key);
  const expect = expectOf(input, true);
  const file = input.file;
  const prefix = `${loc.rel}/${UPDATES_DIR}/`;
  const name = typeof file === 'string' && file.length <= PATH_MAX && file.startsWith(prefix)
    ? file.slice(prefix.length)
    : '';
  if (!UPDATE_FILE_PATTERN.test(name)) throw refuse('bad-request', `file must be one of ${loc.key}'s updates`);
  const who = identity(ctx);
  checkWriter(ctx, loc, who);
  const cardFile = requireLiveCard(ctx, loc);
  const folder = updatesFolder(ctx, loc, false);
  const abs = path.join(folder.abs, name);
  const st = lstatOrNull(abs);
  if (!st) throw refuse('not-found', `there is no update ${file}`);
  if (st.isSymbolicLink() || !st.isFile()) throw refuse('not-allowed', `${file} isn't a plain file`);
  requireRealPath(ctx, abs, file);
  const bytes = fs.readFileSync(abs);
  if (sha256(bytes) !== expect) throw refuse('changed', 'the update has changed since it was read');
  const parts = cardParts(decodeFile(bytes).text);
  if (!parts) throw refuse('not-allowed', `${file} can't be read, so it can't be removed here`);
  const values = cardValues(parts.entries);
  if (values.kind === 'email') {
    // Overseer ruling d: an email entry is for its inbox owner, the brain's Owner or a scout.
    const owner = values.email_inbox_owner;
    const isOwner = typeof owner === 'string' && owner !== '' && (isPerson(who, owner) || (who.known && who.slug === owner));
    if (!isOwner && !isOwnerOrScout(who)) {
      throw refuse('not-allowed', "only the person whose inbox it came from, the brain's Owner or a scout can remove an email");
    }
  } else if (!MANUAL_UPDATE_KINDS.includes(values.kind)) {
    throw refuse('not-allowed', 'only notes, calls and emails can be removed: the log keeps its other entries');
  } else if (!isAuthor(loc, who, values.by) && !isOwnerOrScout(who)) {
    throw refuse('not-allowed', "only the person who added it, the brain's Owner or a scout can remove an update");
  }
  fs.unlinkSync(abs);
  syncDir(folder.abs);
  return { ok: true, action: 'update-remove', key: loc.key, version: sha256(cardFile.bytes) };
}

// The words the app shows for a status and a light (updates log decision 4).
const STATUS_WORDS = { planned: 'Planned', active: 'Active', 'on-hold': 'On hold', done: 'Done' };
const LIGHT_WORDS = { green: 'On track', amber: 'At risk', red: 'Off track' }; // as the app shows them (client logic.ts)

// A card value as raw one-line text, '' when there is none.
function rawValue(value) {
  return typeof value === 'string' ? displayText(value, NAME_MAX) : '';
}

// One entry per changed status, health or Account Owner (AUTO_UPDATE_FIELDS), after the card is
// written. A value sent back unchanged writes nothing. Throws when any can't be written.
function writeAutoEntries(ctx, loc, who, current, values) {
  const changes = [];
  for (const field of ['status', 'health', 'owner']) {
    if (values[field] === undefined) continue;
    const from = rawValue(current[field]);
    const to = values[field] === null ? '' : values[field];
    if (from === to) continue;
    let summary;
    if (field === 'status') {
      const word = v => (v === '' ? 'not set' : STATUS_WORDS[v] || v);
      summary = `Status: ${word(from)} → ${word(to)}.`;
    } else if (field === 'health') {
      const word = v => (v === '' ? 'not set' : LIGHT_WORDS[v] || v);
      summary = `Health: ${word(from)} → ${word(to)}.`;
    } else {
      const word = v => (v === '' ? 'nobody' : memberNamed(ctx.root, v) || v);
      summary = `Account Owner: ${word(from)} → ${word(to)}.`;
    }
    changes.push({ kind: field === 'owner' ? 'owner' : 'status', change: field, from, to, summary });
  }
  if (changes.length === 0) return;
  const folder = updatesFolder(ctx, loc, true);
  let failed = null;
  for (const c of changes) {
    try {
      writeEntry(ctx, loc, who, folder, { kind: c.kind, clientSafe: false, change: c.change, from: c.from, to: c.to }, c.summary);
    } catch (err) {
      failed = failed || err;
    }
  }
  if (failed) throw failed;
}

// ---- project codes (docs/plans/2026-11-24-projects-r2-project-codes.md) ---------------------------
//
// A ref is the client's profile `code:` then digit, letter, digit (`AST4K7`), written as `ref:` right
// after `client:` by create, card, ref and a move from personal; every other change keeps the line
// byte for byte. A ref is a pointer, never a permission. The pure rules below copy shared/project-refs.ts
// (a test runs shared/project-refs-vectors.json against both).

const REF_CANDIDATE = new RegExp(`^${REF_CANDIDATE_SOURCE}$`);
const REF_WORD = /[A-Za-z0-9]+/g;

// Code-shaped words in `text`, upper-cased, de-duplicated, in order. No cap: callers cap after lookup.
function refCandidates(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text).matchAll(REF_WORD)) {
    const word = m[0];
    if (word.length < 5 || word.length > 7) continue;
    const up = word.toUpperCase();
    if (!REF_CANDIDATE.test(up) || seen.has(up)) continue;
    seen.add(up);
    out.push(up);
  }
  return out;
}

function isValidRef(s) {
  return typeof s === 'string' && REF_PATTERN.test(s);
}

// Client codes compared with O→0 and I→1, so H2O and H20 are the same client code.
function foldClientCode(code) {
  return String(code).toUpperCase().replace(/O/g, '0').replace(/I/g, '1');
}

// The lookup key: upper-cased, client part folded, project part (the last 3) unchanged.
function foldRef(ref) {
  const up = String(ref).toUpperCase();
  const cut = up.length - REF_PROJECT_PART;
  if (cut <= 0) return up;
  return foldClientCode(up.slice(0, cut)) + up.slice(cut);
}

// True when `a` and `b` (already folded) differ by one substitution or one neighbouring swap.
function oneSlip(a, b) {
  if (a.length !== b.length || a === b) return false;
  const diff = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      diff.push(i);
      if (diff.length > 2) return false;
    }
  }
  if (diff.length === 1) return true;
  const [i, j] = diff;
  return j === i + 1 && a[i] === b[j] && a[j] === b[i];
}

// The refs one slip from `candidate` (compared folded), never the exact ref, in the order given, de-duplicated.
function nearRefs(candidate, refs) {
  const c = foldRef(candidate);
  const out = [];
  for (const ref of refs) {
    if (out.includes(ref)) continue;
    if (oneSlip(c, foldRef(ref))) out.push(ref);
  }
  return out;
}

// One memo per run: the disk walk, the index and the used codes are worked out once and reused.
const REF_MEMO = new WeakMap();
function refMemo(ctx) {
  let memo = REF_MEMO.get(ctx);
  if (!memo) {
    memo = {};
    REF_MEMO.set(ctx, memo);
  }
  return memo;
}

// A client profile's frontmatter text (clients/<client>/profile.md), read as server/brain/clients.ts
// reads it; null when there is none.
function profileHead(ctx, client) {
  if (!isSlug(client)) return null;
  let text;
  try {
    text = fs.readFileSync(path.join(ctx.root, 'clients', client, 'profile.md'), 'utf8');
  } catch {
    return null;
  }
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  return end === -1 ? '' : text.slice(3, end);
}

// A client's code: its profile's `code:` upper-cased, or null when there is none or it fails the
// pattern (a bad code reads as none, never an error). Internal projects use the-digital-stride's.
function clientCode(ctx, client) {
  const head = profileHead(ctx, client);
  const m = head === null ? null : /^code:[ \t]*(.*)$/m.exec(head);
  if (!m || !m[1]) return null;
  const code = m[1].replace(/\s+#.*$/, '').trim().replace(/^(["'])(.*)\1$/, '$2').trim().toUpperCase();
  return CLIENT_CODE_PATTERN.test(code) ? code : null;
}

// A client's name for a message: its profile's `client:` line, else its folder name with capitals.
function clientName(ctx, client) {
  const head = profileHead(ctx, client);
  const m = head ? /^client:[ \t]*(.+)$/m.exec(head) : null;
  if (m) {
    const name = m[1].trim().replace(/^(["'])(.*)\1$/, '$2').replace(/\s*\([^)]*\)$/, '').trim();
    if (name !== '' && name.length <= NAME_MAX) return displayText(name, NAME_MAX);
  }
  return String(client).split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// A card's ref as the app reads it: upper-cased, or null when there is none or it isn't valid.
function cardRefOf(values) {
  const v = values ? values.ref : undefined;
  if (typeof v !== 'string') return null;
  const up = v.trim().toUpperCase();
  return isValidRef(up) ? up : null;
}

function refLines(ref) {
  return [`ref: ${yamlText(ref)}`];
}

// Every `ref:` value in a card's frontmatter block, folded. Read line by line, so a card that can't
// be parsed (a merge conflict holding two refs) still counts; a brief's own lines never do.
function rawRefsOf(text) {
  const out = [];
  const lines = text.split('\n');
  if (lines[0] !== '---') return out;
  let close = lines.indexOf('---', 1);
  if (close === -1) close = lines.length;
  for (const line of lines.slice(1, close)) {
    const m = /^ref[ \t]*:(.*)$/.exec(line);
    if (!m) continue;
    const value = unquote(m[1]).toUpperCase();
    if (value !== '') out.push(foldRef(value));
  }
  return out;
}

// Every card file on disk in a project folder (live, archived, every space and client, shadowed
// folders too), read once per run. Never runs git.
function diskCards(ctx) {
  const memo = refMemo(ctx);
  if (memo.cards) return memo.cards;
  const cards = [];
  for (const b of projectBases(ctx)) {
    for (const name of b.names) {
      const key = `${b.client}/${name}`;
      const parsed = parseKey(key);
      if (!parsed) continue;
      const rel = `${b.rel}/${name}`;
      const at = locationsOf(parsed.client, parsed.slug).findIndex(l => l.rel === rel);
      if (at === -1) continue;
      const loc = locationsOf(parsed.client, parsed.slug)[at];
      const fileAbs = path.join(ctx.root, ...rel.split('/'), PROJECT_CARD_FILE);
      const st = lstatOrNull(fileAbs);
      if (!st || st.isSymbolicLink() || !st.isFile()) continue;
      let text;
      try {
        text = decodeFile(fs.readFileSync(fileAbs)).text;
      } catch {
        continue;
      }
      const parts = cardParts(text);
      const values = parts ? cardValues(parts.entries) : null;
      const raw = rawRefsOf(text);
      cards.push({ key, slug: parsed.slug, rel, at, space: loc.space, archived: loc.archived, values, ref: cardRefOf(values), raw });
    }
  }
  memo.cards = cards;
  return cards;
}

// The lookup the app builds (server/brain/project-refs.ts): one card per key (the first folder with a
// card, in reader precedence), personal cards left out; a folded ref held by two keys resolves to none.
function refIndex(ctx) {
  const memo = refMemo(ctx);
  if (memo.index) return memo.index;
  const byKey = new Map();
  for (const c of diskCards(ctx)) {
    const best = byKey.get(c.key);
    if (!best || c.at < best.at) byKey.set(c.key, c);
  }
  const cards = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const byFold = new Map();
  for (const c of cards) {
    if (c.space === 'personal' || !c.ref) continue;
    const f = foldRef(c.ref);
    if (!byFold.has(f)) byFold.set(f, []);
    byFold.get(f).push(c);
  }
  memo.index = { cards, byFold };
  return memo.index;
}

// Whether a card file other than the one in folder `rel` holds `ref` (folded).
function heldElsewhere(ctx, rel, ref) {
  const f = foldRef(ref);
  return diskCards(ctx).some(c => c.rel !== rel && c.raw.includes(f));
}

// The folded `ref:` values of cards deleted in the brain's git history, or null when git can't say
// (not a repository, a shallow clone, a timeout or any error). Two git calls after the shallow check,
// never a search through every change: the deleted card paths, then one batch read of each as it was
// just before it went.
function historyRefs(ctx) {
  const until = Date.now() + REF_HISTORY_BUDGET_MS;
  const git = (args, input, raw) => {
    const left = until - Date.now();
    return left > 0 ? gitInBrain(ctx, args, input, { timeout: left, raw }) : null;
  };
  const head = git(['rev-parse', '--is-inside-work-tree', '--is-shallow-repository']);
  if (!head || head.status !== 0) return null;
  const [inside, shallow] = (head.stdout || '').split('\n').map(s => s.trim());
  if (inside !== 'true' || shallow !== 'false') return null;
  // --full-history: without it git follows one parent at a merge, so a card made and deleted on another Mac
  // before a sync would be missed and its code handed out again.
  const log = git([
    '-c', 'core.quotePath=false', 'log', '--full-history', '--diff-filter=D', '--no-renames', '--name-only',
    '--format=%H', '--',
    ...REF_HISTORY_PATHS,
  ]);
  if (!log) return null;
  // A brain with no commits yet has no history to read.
  if (log.status !== 0) return /does not have any commits yet/.test(log.stderr || '') ? new Set() : null;
  const wanted = [];
  let commit = null;
  for (const line of (log.stdout || '').split('\n')) {
    if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(line)) {
      commit = line;
      continue;
    }
    // A quoted path holds characters no project folder name can, so it was never a card.
    if (line === '' || commit === null || line.startsWith('"')) continue;
    wanted.push(`${commit}^:${line}`);
  }
  const used = new Set();
  if (wanted.length === 0) return used;
  // Bytes in as well as out: spawnSync reads a string input in the output encoding.
  const batch = git(['cat-file', '--batch'], Buffer.from(wanted.map(w => `${w}\n`).join(''), 'utf8'), true);
  if (!batch || batch.status !== 0 || !Buffer.isBuffer(batch.stdout)) return null;
  const out = batch.stdout;
  let at = 0;
  while (at < out.length) {
    const nl = out.indexOf(10, at);
    if (nl === -1) return null;
    const header = out.subarray(at, nl).toString('utf8');
    at = nl + 1;
    if (/ missing$/.test(header)) continue;
    const m = /^[0-9a-f]+ ([a-z]+) (\d+)$/.exec(header);
    if (!m) return null;
    const size = Number(m[2]);
    if (at + size > out.length) return null;
    if (m[1] === 'blob') for (const r of rawRefsOf(decodeFile(out.subarray(at, at + size)).text)) used.add(r);
    at += size + 1;
  }
  return used;
}

// Every code in use (folded): on any card on disk, or on a card deleted in git history. Null when git
// can't say. Worked out once per run; `ref` with `all` adds each code it gives.
function usedRefs(ctx) {
  const memo = refMemo(ctx);
  if (memo.used === undefined) {
    const history = historyRefs(ctx);
    memo.used = history === null ? null : new Set([...history, ...diskCards(ctx).flatMap(c => c.raw)]);
  }
  return memo.used;
}

// A new code for client code `code`: at random (crypto) from the 1,280 options, never one in use,
// preferring one that isn't one slip from any code in use (any client); else any unused one. Null
// when every option is used.
function pickRef(ctx, code, used) {
  const options = [];
  for (const d1 of REF_DIGITS) {
    for (const l of REF_LETTERS) {
      for (const d2 of REF_DIGITS) {
        const ref = `${code}${d1}${l}${d2}`;
        const folded = foldRef(ref);
        if (isValidRef(ref) && !used.has(folded)) options.push({ ref, folded });
      }
    }
  }
  if (options.length === 0) return null;
  const sameLength = [...used].filter(u => u.length === options[0].folded.length);
  const spaced = options.filter(o => !sameLength.some(u => oneSlip(o.folded, u)));
  const pool = spaced.length > 0 ? spaced : options;
  const at = (ctx.refPick || (n => crypto.randomInt(n)))(pool.length);
  return pool[Number.isInteger(at) && at >= 0 && at < pool.length ? at : 0].ref;
}

// A new code for a card in `client`, or null: no client code, git can't say, or anything else going
// wrong. Never a reason to refuse create, card or move (overseer blocker 1).
function newRefFor(ctx, client) {
  try {
    const code = client ? clientCode(ctx, client) : null;
    if (!code) return null;
    const used = usedRefs(ctx);
    return used ? pickRef(ctx, code, used) : null;
  } catch {
    return null;
  }
}

const CANT_CHECK_REFS = "Couldn't check old codes just now. Try again in a moment.";

// `ref`: one card (`key`, `expect`, optional `replace`), or every live client and internal card
// without one (`all`, the brain's Owner only).
function refAction(input, ctx) {
  for (const flag of ['all', 'replace']) {
    if (input[flag] !== undefined && input[flag] !== true) throw refuse('bad-request', `${flag} can only be true`);
  }
  const all = input.all === true;
  if (all === (input.key !== undefined)) throw refuse('bad-request', 'send either key or all');
  if (all) {
    if (input.replace !== undefined || input.expect !== undefined) {
      throw refuse('bad-request', 'all takes no key, expect or replace');
    }
    return refAll(ctx);
  }
  const replace = input.replace === true;
  const loc = locate(ctx, input.key);
  const expect = expectOf(input, true);
  if (loc.space === 'personal') throw refuse('bad-request', "Personal projects don't get codes.");
  if (loc.archived) throw refuse('bad-request', "Archived projects don't get codes.");
  const who = identity(ctx);
  requireTeam(who);
  const code = clientCode(ctx, loc.client);
  if (!code) throw refuse('bad-request', `Add a client code to ${clientName(ctx, loc.client)}'s profile first.`);
  // What the card holds now, so a card with a code is refused before git is asked anything.
  const had = cardRefOf(cardValues(openCard(ctx, loc, null).parts.entries));
  if (had && !replace) throw refuse('exists', 'This project already has a code.');
  if (replace && (!had || !heldElsewhere(ctx, loc.rel, had))) {
    throw refuse('changed', "No other project uses this project's code now.");
  }
  const used = usedRefs(ctx);
  if (!used) throw refuse('internal', CANT_CHECK_REFS);
  const ref = pickRef(ctx, code, used);
  if (!ref) throw refuse('internal', `Every code for ${clientName(ctx, loc.client)} is used.`);
  // The fingerprint last, right before the write.
  const cardFile = openCard(ctx, loc, expect);
  const now = cardRefOf(cardValues(cardFile.parts.entries));
  if (now && !replace) throw refuse('exists', 'This project already has a code.');
  if (replace && (!now || foldRef(now) !== foldRef(had))) throw refuse('changed', 'the card has changed since it was read');
  const entries = setEntry(cardFile.parts.entries, 'ref', refLines(ref));
  const version = writeCard(cardFile, joinCard(entries, cardFile.parts.body));
  return { ok: true, action: 'ref', key: loc.key, version, given: [{ key: loc.key, ref }], skipped: [] };
}

// Overseer blocker 3: two backfills before a sync would write different codes into the same cards.
function refAll(ctx) {
  const who = identity(ctx);
  if (!isBrainOwner(who)) throw refuse('not-allowed', "Only the brain's Owner can give every project a code.");
  const used = usedRefs(ctx);
  if (!used) throw refuse('internal', CANT_CHECK_REFS);
  const keys = new Set();
  for (const b of projectBases(ctx)) {
    for (const name of b.names) {
      const key = `${b.client}/${name}`;
      if (parseKey(key)) keys.add(key);
    }
  }
  const codes = new Map();
  const given = [];
  const skipped = [];
  for (const key of [...keys].sort()) {
    if (key.startsWith('personal/')) {
      skipped.push({ key, reason: 'personal' });
      continue;
    }
    let loc;
    try {
      loc = locate(ctx, key);
    } catch (err) {
      if (err instanceof Refusal) {
        skipped.push({ key, reason: 'no-card' });
        continue;
      }
      throw err;
    }
    if (loc.archived) {
      skipped.push({ key, reason: 'archived' });
      continue;
    }
    let cardFile;
    try {
      cardFile = openCard(ctx, loc, null);
    } catch (err) {
      if (err instanceof Refusal) {
        skipped.push({ key, reason: 'no-card' });
        continue;
      }
      throw err;
    }
    if (cardRefOf(cardValues(cardFile.parts.entries))) {
      skipped.push({ key, reason: 'has-ref' });
      continue;
    }
    if (!codes.has(loc.client)) codes.set(loc.client, clientCode(ctx, loc.client));
    const code = codes.get(loc.client);
    // A client with every one of its 1,280 codes used is as good as one with no code.
    const ref = code ? pickRef(ctx, code, used) : null;
    if (!ref) {
      skipped.push({ key, reason: 'no-client-code' });
      continue;
    }
    used.add(foldRef(ref));
    writeCard(cardFile, joinCard(setEntry(cardFile.parts.entries, 'ref', refLines(ref)), cardFile.parts.body));
    given.push({ key, ref });
  }
  return { ok: true, action: 'ref', given, skipped };
}

// `find-ref`: the codes in `text` that belong to a real project, and near misses. Read only, no git.
function findRef(input, ctx) {
  const text = input.text;
  if (typeof text !== 'string') throw refuse('bad-request', 'text must be text');
  if (text.length > FIND_REF_TEXT_MAX) {
    throw refuse('bad-request', `text is too long (over ${FIND_REF_TEXT_MAX} characters)`);
  }
  const candidates = refCandidates(text);
  const found = [];
  const near = [];
  if (candidates.length === 0) return { ok: true, action: 'find-ref', found, near };
  const { byFold } = refIndex(ctx);
  const resolvable = [...byFold.values()].filter(h => h.length === 1).map(h => h[0].ref).sort();
  const keys = new Set();
  for (const candidate of candidates) {
    const holders = byFold.get(foldRef(candidate));
    if (holders && holders.length === 1) {
      const c = holders[0];
      if (found.length >= REF_CANDIDATES_MAX || keys.has(c.key)) continue;
      keys.add(c.key);
      const title = c.values && typeof c.values.title === 'string' ? displayText(c.values.title, LIMITS.PROJECT_TITLE_MAX) : '';
      const cardClient = c.values && typeof c.values.client === 'string' && isSlug(c.values.client) ? c.values.client : null;
      found.push({
        ref: c.ref,
        key: c.key,
        title: title || defaultTitle(path.join(ctx.root, ...c.rel.split('/')), c.slug),
        // Decision 8: the client the card says now, never the letters.
        client: cardClient || c.key.slice(0, c.key.indexOf('/')),
      });
      continue;
    }
    // A duplicate is a real code (just held twice), so it gets no "did you mean" either.
    if (holders || near.length >= REF_CANDIDATES_MAX) continue;
    const suggestions = nearRefs(candidate, resolvable).slice(0, REF_CANDIDATES_MAX);
    if (suggestions.length > 0) near.push({ candidate, suggestions });
  }
  return { ok: true, action: 'find-ref', found, near };
}

function capabilities() {
  return {
    ok: true,
    action: 'capabilities',
    version: SCRIPT_VERSION,
    features: [
      PROJECTS_CAPABILITY,
      PROJECTS_MOVE_CAPABILITY,
      PROJECTS_ARCHIVE_CAPABILITY,
      PROJECTS_UPDATES_CAPABILITY,
      PROJECTS_REFS_CAPABILITY,
      PROJECTS_EMAIL_CAPABILITY,
    ],
  };
}

// ---- email entries (docs/plans/2026-11-24-projects-r2-email-entries.md) ----------------------------
//
// Nothing from an email reaches a project until the owner of the inbox it came from approves exactly
// what is saved. `email-draft` writes one draft into briefing/email-drafts/ (git-ignored, folder 0700,
// files 0600, so it never syncs): the facts, Claude's summary, the codes found and a random
// `approve_token`. The newest message's text is read for codes and dropped. No reply ever holds the
// token: only the app's server reads it from the file when the inbox owner clicks Save, and passes it
// to `update` with an `email` entry. That entry takes its thread id, key, sent time and inbox owner
// from the draft and the rest (as edited on screen) from the request, and is never written twice for
// one email (`email_key`, across every project). Entries hold names, never addresses.

const ONE_LINE_BAD = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const SPACE_BAD = /[\s\p{Cc}\p{Zl}\p{Zp}]/u;
const DRAFT_ID_PATTERN = /^[a-z0-9]{12}$/;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;
const ISO_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const NEVER_BCC = 'bcc is never accepted: leave out anyone who was blind-copied';

// Whether a `bcc` key (any case) is anywhere in `value`. Walked without recursion: stdin is distrusted.
function hasBcc(value) {
  const stack = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
      continue;
    }
    for (const [k, x] of Object.entries(v)) {
      if (k.toLowerCase() === 'bcc') return true;
      stack.push(x);
    }
  }
  return false;
}

// One line of text, trimmed: no line breaks or control characters, at most `max`.
function emailLine(value, name, max, allowEmpty) {
  if (typeof value !== 'string') throw refuse('bad-request', `${name} must be text`);
  if (ONE_LINE_BAD.test(value)) throw refuse('bad-request', `${name} must be one line`);
  const text = value.trim();
  if (!allowEmpty && text === '') throw refuse('bad-request', `${name} is empty`);
  if (text.length > max) throw refuse('bad-request', `${name} is too long (over ${max} characters)`);
  return text;
}

function emailAddress(value, name) {
  if (typeof value !== 'string' || value === '' || SPACE_BAD.test(value)) {
    throw refuse('bad-request', `${name} must be an email address`);
  }
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) throw refuse('bad-request', `${name} must be an email address`);
  if (value.length + 2 > EMAIL.EMAIL_PERSON_MAX) throw refuse('bad-request', `${name} is too long`);
  return value;
}

// An EmailPerson: `{name: text or null, address}`, together at most EMAIL_PERSON_MAX as "Name <address>".
function emailPerson(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw refuse('bad-request', `${name} must be {name, address}`);
  }
  const address = emailAddress(value.address, `${name}'s address`);
  let personName = null;
  if (value.name !== null && value.name !== undefined) {
    personName = emailLine(value.name, `${name}'s name`, EMAIL.EMAIL_NAME_MAX, true) || null;
  }
  const whole = personName === null ? `<${address}>` : `${personName} <${address}>`;
  if (whole.length > EMAIL.EMAIL_PERSON_MAX) throw refuse('bad-request', `${name} is too long`);
  return { name: personName, address };
}

// An RFC 822 Message-ID, always written with its angle brackets (so `abc@x` and `<abc@x>` are one key).
function messageIdOf(value, name) {
  if (typeof value !== 'string') throw refuse('bad-request', `${name} must be a Message-ID`);
  const inner = value.length >= 2 && value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value;
  if (inner === '' || SPACE_BAD.test(inner) || /[<>]/.test(inner)) {
    throw refuse('bad-request', `${name} must be a Message-ID with no spaces`);
  }
  const id = `<${inner}>`;
  if (id.length > EMAIL.MESSAGE_ID_MAX) throw refuse('bad-request', `${name} is too long (over ${EMAIL.MESSAGE_ID_MAX} characters)`);
  if (yamlText(id) === null) throw refuse('bad-request', `${name} can't be written as it is`);
  return id;
}

function sentTime(value) {
  const m = typeof value === 'string' ? ISO_TIME.exec(value) : null;
  const t = m && isRealDate(m[1]) ? new Date(value) : null;
  if (!t || Number.isNaN(t.getTime())) throw refuse('bad-request', 'sentAt must be an ISO time, such as 2026-11-20T16:30:00Z');
  return t;
}

// The subject as the key reads it: lower case, spaces collapsed, leading Re:/Fwd:/Fw: taken off repeatedly.
function keySubject(subject) {
  let s = subject.toLowerCase().replace(/\s+/g, ' ').trim();
  for (;;) {
    const next = s.replace(/^(?:re|fwd|fw):\s*/, '');
    if (next === s) return s;
    s = next;
  }
}

// One email, one entry, across inboxes (contract EmailKey): the Message-ID, else `x:` + a hash of
// the sender, the minute it was sent (UTC) and the subject.
function emailKeyOf(messageId, from, sent, subject) {
  if (messageId !== null) return messageId;
  const minute = sent.toISOString().slice(0, 16);
  return `x:${sha256(`${from.address.toLowerCase()}\n${minute}\n${keySubject(subject)}`)}`;
}

// The newest message's own words: quoted lines (`>`) skipped, and everything after a `-- ` line.
function ownText(text) {
  const out = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line === '-- ') break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n');
}

// Distinct valid project codes in `text` (the shared code rules), upper case, in order.
function codesIn(text) {
  return refCandidates(text).filter(isValidRef);
}

function draftsRel(name) {
  return `${EMAIL.EMAIL_DRAFTS_DIR}/${name}`;
}

function dismissedName(slug) {
  return `dismissed-${slug}.json`;
}

// The drafts folder, checked: briefing/ and briefing/email-drafts/ real folders (never links), and git
// ignoring every one of `rels` (not a git repository, or git can't tell: refused). Made, and its mode
// set to 0700, when `make`; else null when it isn't there.
function draftsFolder(ctx, make, rels) {
  const dirRel = EMAIL.EMAIL_DRAFTS_DIR;
  const parentRel = dirRel.slice(0, dirRel.lastIndexOf('/'));
  const dirAbs = path.join(ctx.root, ...dirRel.split('/'));
  const parentAbs = path.join(ctx.root, ...parentRel.split('/'));
  for (const [rel, abs] of [[parentRel, parentAbs], [dirRel, dirAbs]]) {
    const st = lstatOrNull(abs);
    if (st && st.isSymbolicLink()) throw refuse('not-allowed', `${rel} is a link, so email drafts can't be kept private there`);
    if (st && !st.isDirectory()) throw refuse('not-allowed', `${rel} isn't a folder`);
  }
  const cant = () => refuse('not-allowed', `git couldn't check that ${dirRel} stays on this Mac, so email drafts can't be kept there`);
  const repo = brainRepo(ctx);
  if (repo !== 'repo') throw cant();
  const out = gitInBrain(ctx, ['check-ignore', '--stdin', '-z'], rels.map(r => `${r}\0`).join(''));
  if (!out || (out.status !== 0 && out.status !== 1)) throw cant();
  const ignored = new Set((out.stdout || '').split('\0').filter(Boolean));
  if (!rels.every(r => ignored.has(r))) {
    throw refuse('not-allowed', `${dirRel} would sync to the team: git doesn't ignore it, so email drafts can't be kept there`);
  }
  if (!lstatOrNull(dirAbs)) {
    if (!make) return null;
    if (!lstatOrNull(parentAbs)) {
      try { fs.mkdirSync(parentAbs); } catch (err) { if (errCode(err) !== 'EEXIST') throw err; }
    }
    try { fs.mkdirSync(dirAbs, EMAIL_DRAFTS_DIR_MODE); } catch (err) { if (errCode(err) !== 'EEXIST') throw err; }
  }
  const st = lstatOrNull(dirAbs);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) throw refuse('not-allowed', `${dirRel} isn't a folder`);
  requireRealPath(ctx, dirAbs, dirRel);
  if ((st.mode & 0o777) !== EMAIL_DRAFTS_DIR_MODE) {
    try {
      fs.chmodSync(dirAbs, EMAIL_DRAFTS_DIR_MODE);
    } catch {
      throw refuse('not-allowed', `${dirRel} can't be made private to you`);
    }
  }
  return { rel: dirRel, abs: dirAbs };
}

// A file in the drafts folder, written all at once with mode 0600. `replace` swaps it in; else EEXIST
// rather than overwrite anything.
function writePrivate(folder, name, data, replace) {
  const abs = path.join(folder.abs, name);
  const tmp = writeTemp(folder.abs, data, EMAIL_DRAFT_FILE_MODE);
  try {
    if (replace) {
      fs.renameSync(tmp, abs);
    } else {
      try {
        fs.linkSync(tmp, abs);
      } catch (err) {
        if (errCode(err) === 'EEXIST') throw err;
        fs.writeFileSync(abs, data, { encoding: 'utf8', flag: 'wx', mode: EMAIL_DRAFT_FILE_MODE });
        fs.chmodSync(abs, EMAIL_DRAFT_FILE_MODE);
      }
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  syncDir(folder.abs);
}

function removeQuietly(abs) {
  try {
    fs.unlinkSync(abs);
    return true;
  } catch {
    return false;
  }
}

const isText = v => typeof v === 'string';
const isPersonShape = p => p !== null && typeof p === 'object' && (p.name === null || isText(p.name)) && isText(p.address);

// One draft file: `missing`, `bad` (not a draft this script wrote) or `ok` with the draft.
function readDraft(folder, name) {
  const abs = path.join(folder.abs, name);
  const st = lstatOrNull(abs);
  if (!st) return { state: 'missing', abs, st };
  if (st.isSymbolicLink() || !st.isFile() || st.size > EMAIL_DRAFT_MAX_BYTES) return { state: 'bad', abs, st };
  let d;
  try {
    d = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return { state: 'bad', abs, st };
  }
  const ok = d !== null && typeof d === 'object' && !Array.isArray(d)
    && d.v === 1
    && `${d.id}.json` === name
    && isText(d.inbox_owner) && isSlug(d.inbox_owner)
    && isText(d.created_at) && Number.isFinite(Date.parse(d.created_at))
    && isText(d.thread_id) && GMAIL_THREAD_ID_PATTERN.test(d.thread_id)
    && isText(d.email_key) && d.email_key !== '' && d.email_key.length <= EMAIL.MESSAGE_ID_MAX + 2
    && !SPACE_BAD.test(d.email_key) && yamlText(d.email_key) !== null
    && isText(d.sent_at) && ISO_TIME.test(d.sent_at)
    && isPersonShape(d.from)
    && Array.isArray(d.people) && d.people.every(isPersonShape)
    && isText(d.approve_token) && TOKEN_PATTERN.test(d.approve_token);
  return ok ? { state: 'ok', abs, st, draft: d } : { state: 'bad', abs, st };
}

// Whether a draft (or, when it can't be read, its file) is older than DRAFT_MAX_AGE_DAYS.
function draftExpired(ctx, r) {
  const made = r.state === 'ok' ? Date.parse(r.draft.created_at) : r.st.mtimeMs;
  return ctx.now.getTime() - made > EMAIL.DRAFT_MAX_AGE_DAYS * DAY_MS;
}

// Every draft file in the folder (names), never a link.
function draftNames(folder) {
  let names;
  try {
    names = fs.readdirSync(folder.abs);
  } catch {
    return [];
  }
  return names.filter(n => EMAIL_DRAFT_FILE_PATTERN.test(n)).sort();
}

// Deletes drafts older than DRAFT_MAX_AGE_DAYS, whoever's they are (overseer 6).
function sweepDrafts(ctx, folder) {
  for (const name of draftNames(folder)) {
    const r = readDraft(folder, name);
    if (r.state === 'missing' || r.st.isSymbolicLink() || !r.st.isFile()) continue;
    if (draftExpired(ctx, r)) removeQuietly(r.abs);
  }
}

// Whole days from `ymd` to today (UK), or null when `ymd` isn't a date.
function daysSince(ctx, ymd) {
  if (!isRealDate(ymd)) return null;
  return Math.round((Date.parse(`${ukDate(ctx.now)}T00:00:00Z`) - Date.parse(`${ymd}T00:00:00Z`)) / DAY_MS);
}

// This owner's dismissals still in force: `{ email_key: date }`, older than DISMISSED_DAYS left out.
function readDismissed(ctx, folder, slug) {
  const abs = path.join(folder.abs, dismissedName(slug));
  const st = lstatOrNull(abs);
  if (!st || st.isSymbolicLink() || !st.isFile() || st.size > 4 * 1024 * 1024) return {};
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return {};
  }
  const out = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, date] of Object.entries(raw)) {
    const age = isText(date) ? daysSince(ctx, date) : null;
    if (age !== null && age <= EMAIL.DISMISSED_DAYS) out[key] = date;
  }
  return out;
}

// The earliest `email` entry in any project (every folder, archives and old folders too) for this
// key, or an old file's `email_message_id` equal to it: `{file, key}`, or null.
function emailHeld(ctx, emailKey) {
  const messageId = emailKey.startsWith('<') ? emailKey : null;
  let best = null;
  for (const b of projectBases(ctx)) {
    for (const name of b.names) {
      const projectKey = `${b.client}/${name}`;
      if (!parseKey(projectKey)) continue;
      const dirRel = `${b.rel}/${name}/${UPDATES_DIR}`;
      const dirAbs = path.join(ctx.root, ...dirRel.split('/'));
      const st = lstatOrNull(dirAbs);
      if (!st || st.isSymbolicLink() || !st.isDirectory()) continue;
      let files;
      try {
        files = fs.readdirSync(dirAbs);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!UPDATE_FILE_PATTERN.test(f)) continue;
        const fileAbs = path.join(dirAbs, f);
        const fst = lstatOrNull(fileAbs);
        if (!fst || fst.isSymbolicLink() || !fst.isFile() || fst.size > ENTRY_READ_MAX) continue;
        let text;
        try {
          text = decodeFile(fs.readFileSync(fileAbs)).text;
        } catch {
          continue;
        }
        if (!text.includes('email')) continue;
        const parts = cardParts(text);
        if (!parts) continue;
        const v = cardValues(parts.entries);
        if (v.kind !== 'email') continue;
        const same = v.email_key === emailKey
          || (messageId !== null && (v.email_message_id === messageId || v.email_message_id === messageId.slice(1, -1)));
        if (!same) continue;
        const found = { file: `${dirRel}/${f}`, key: projectKey, at: isText(v.at) ? v.at : '' };
        if (!best || found.at < best.at || (found.at === best.at && found.file < best.file)) best = found;
      }
    }
  }
  return best ? { file: best.file, key: best.key } : null;
}

function alreadyIn(held) {
  return refuse('exists', `That email is already in ${held.key}.`, { file: held.file, key: held.key });
}

// This Mac's team member, with the email roles.json gives them; refused when there is none.
function inboxOwner(ctx) {
  const who = identity(ctx);
  if (!who.known || !who.slug || !isText(who.member.email) || who.member.email.trim() === '') {
    throw refuse('not-allowed', 'only people on the team in .team-config/roles.json, with an email there, can keep email drafts');
  }
  return who;
}

// A `requested` project: a live project with a card, else not-found.
function requireRequested(ctx, key) {
  const gone = () => refuse('not-found', `there is no live project ${key} with a card`);
  let loc;
  try {
    loc = locate(ctx, key);
  } catch (err) {
    if (err instanceof Refusal) throw gone();
    throw err;
  }
  if (loc.archived || loc.leftover) throw gone();
  try {
    openCard(ctx, loc, null);
  } catch (err) {
    if (err instanceof Refusal) throw gone();
    throw err;
  }
}

// Twelve random characters of [a-z0-9]. The file is created without overwriting, so a clash (36^12
// to one) fails rather than replace another draft.
function newDraftId() {
  let id = '';
  for (let j = 0; j < 12; j++) id += SUFFIX_CHARS[crypto.randomInt(SUFFIX_CHARS.length)];
  return id;
}

// `email-draft` (EmailDraftInput): one waiting draft for this Mac's inbox owner.
function emailDraft(input, ctx) {
  if (hasBcc(input)) throw refuse('bad-request', NEVER_BCC);
  if (JSON.stringify(input).length > EMAIL_DRAFT_INPUT_MAX) {
    throw refuse('bad-request', `the draft is too long (over ${EMAIL_DRAFT_INPUT_MAX} characters): shorten the summary or the newest text`);
  }
  if (!isText(input.threadId) || !GMAIL_THREAD_ID_PATTERN.test(input.threadId)) {
    throw refuse('bad-request', "threadId must be the Gmail thread id (8 to 32 hex characters)");
  }
  const threadId = input.threadId.toLowerCase();
  const inboxAddress = emailAddress(input.inboxAddress, 'inboxAddress');
  const messageId = input.messageId === undefined || input.messageId === null ? null : messageIdOf(input.messageId, 'messageId');
  let threadMessageIds = [];
  if (input.threadMessageIds !== undefined && input.threadMessageIds !== null) {
    if (!Array.isArray(input.threadMessageIds) || input.threadMessageIds.length > EMAIL.EMAIL_THREAD_IDS_MAX) {
      throw refuse('bad-request', `threadMessageIds must be a list of at most ${EMAIL.EMAIL_THREAD_IDS_MAX} Message-IDs`);
    }
    threadMessageIds = [...new Set(input.threadMessageIds.map(m => messageIdOf(m, 'a thread Message-ID')))];
  }
  const subject = emailLine(input.subject, 'subject', EMAIL.EMAIL_SUBJECT_MAX, true);
  const from = emailPerson(input.from, 'from');
  if (!Array.isArray(input.people) || input.people.length > EMAIL.EMAIL_PEOPLE_MAX) {
    throw refuse('bad-request', `people must be a list of at most ${EMAIL.EMAIL_PEOPLE_MAX} people (to and cc)`);
  }
  const people = input.people.map(p => emailPerson(p, 'a person'));
  const sent = sentTime(input.sentAt);
  const summary = checkSummary(input.summary);
  if (!isText(input.newestText)) throw refuse('bad-request', 'newestText must be text');
  if (input.newestText.length > EMAIL.EMAIL_NEWEST_TEXT_MAX) {
    throw refuse('bad-request', `newestText is too long (over ${EMAIL.EMAIL_NEWEST_TEXT_MAX} characters)`);
  }
  let requested = null;
  if (input.requested !== undefined && input.requested !== null) {
    if (!parseKey(input.requested)) throw refuse('bad-request', 'requested must be <client>/<slug> or personal/<slug>');
    requested = input.requested;
  }

  const who = inboxOwner(ctx);
  if (who.member.email.trim().toLowerCase() !== inboxAddress.toLowerCase()) {
    throw refuse('not-allowed', "that inbox isn't yours: only its owner, on their own Mac, can draft its emails for a project");
  }
  if (requested !== null) requireRequested(ctx, requested);

  // Git must ignore the very files written: the new draft and this owner's dismissals.
  const id = newDraftId();
  const folder = draftsFolder(ctx, true, [draftsRel(`${id}.json`), draftsRel(dismissedName(who.slug))]);
  sweepDrafts(ctx, folder);

  const emailKey = emailKeyOf(messageId, from, sent, subject);
  if (Object.prototype.hasOwnProperty.call(readDismissed(ctx, folder, who.slug), emailKey)) {
    throw refuse('dismissed', 'You said this email is not for a project, so it is not suggested again.');
  }
  const held = emailHeld(ctx, emailKey);
  if (held) throw alreadyIn(held);

  for (const name of draftNames(folder)) {
    const r = readDraft(folder, name);
    if (r.state === 'ok' && r.draft.inbox_owner === who.slug && r.draft.email_key === emailKey) removeQuietly(r.abs);
  }
  const draft = {
    v: 1,
    id,
    inbox_owner: who.slug,
    created_at: isoSecond(ctx.now),
    thread_id: threadId,
    email_key: emailKey,
    thread_message_ids: threadMessageIds,
    subject: fitQuotes(subject),
    from: fitName(from),
    from_domain: from.address.slice(from.address.lastIndexOf('@') + 1).toLowerCase(),
    people: people.map(fitName),
    sent_at: isoSecond(sent),
    summary,
    codes_subject: codesIn(subject),
    codes_body: codesIn(ownText(input.newestText)),
    requested,
    approve_token: crypto.randomBytes(16).toString('hex'),
  };
  writePrivate(folder, `${id}.json`, `${JSON.stringify(draft, null, 2)}\n`, false);
  return { ok: true, action: 'email-draft', id };
}

function draftIdOf(value) {
  if (!isText(value) || !DRAFT_ID_PATTERN.test(value)) throw refuse('bad-request', 'draft must be a draft id (12 letters and numbers)');
  return value;
}

// The draft `id`, for its inbox owner only: refused when missing, unreadable, someone else's or expired.
function ownDraft(ctx, folder, id, who) {
  const gone = () => refuse('not-found', "That draft isn't waiting any more.");
  if (!folder) throw gone();
  const r = readDraft(folder, `${id}.json`);
  if (r.state === 'missing') throw gone();
  if (r.state === 'bad') throw refuse('not-allowed', "that draft can't be read, so it can't be used");
  if (r.draft.inbox_owner !== who.slug) throw refuse('not-allowed', 'only the person whose inbox it came from can use that draft');
  if (draftExpired(ctx, r)) {
    removeQuietly(r.abs);
    throw gone();
  }
  return r;
}

// `email-draft-remove` {id, dismiss}: the inbox owner takes a draft away; `dismiss` records its key.
function emailDraftRemove(input, ctx) {
  const id = draftIdOf(input.id);
  if (typeof input.dismiss !== 'boolean') throw refuse('bad-request', 'dismiss must be true or false');
  const who = inboxOwner(ctx);
  const dismissedRel = draftsRel(dismissedName(who.slug));
  const folder = draftsFolder(ctx, false, [draftsRel(`${id}.json`), dismissedRel]);
  if (folder) sweepDrafts(ctx, folder);
  const r = ownDraft(ctx, folder, id, who);
  if (input.dismiss) {
    const kept = readDismissed(ctx, folder, who.slug);
    kept[r.draft.email_key] = ukDate(ctx.now);
    writePrivate(folder, dismissedName(who.slug), `${JSON.stringify(kept, null, 2)}\n`, true);
  }
  removeQuietly(r.abs);
  syncDir(folder.abs);
  return { ok: true, action: 'email-draft-remove', id };
}

// Email text comes from outsiders, so it is never refused for its quote marks: when a value can't be
// written without escapes (both ' and ", or a backslash with '), straight double quotes become curly ones
// and backslashes slashes. Done when the draft is made, so the owner approves the words that are saved.
function fitQuotes(text) {
  if (yamlItem(text) !== null && yamlText(text) !== null) return text;
  let open = true;
  const curly = text.replace(/"/g, () => {
    const q = open ? '\u201c' : '\u201d';
    open = !open;
    return q;
  });
  return curly.replace(/\\/g, '/');
}

// The draft keeps what the sheet will show, in a form the entry can hold (the key uses the original).
function fitName(p) {
  return p.name === null ? p : { ...p, name: fitQuotes(p.name) };
}

// A display name for an entry (overseer 3): one line, at most EMAIL_NAME_MAX, written as a list item.
function entryName(value, name) {
  const text = fitQuotes(emailLine(value, name, EMAIL.EMAIL_NAME_MAX, false));
  if (yamlItem(text) === null) throw refuse('bad-request', `${name} can't be written as it is`);
  return text;
}

// An entry stores names, never addresses: an address only for someone on the draft with no name.
function requireNames(names, draft) {
  const nameless = new Set([draft.from, ...draft.people]
    .filter(p => p.name === null || p.name.trim() === '')
    .map(p => p.address.toLowerCase()));
  for (const n of names) {
    if (n.includes('@') && !nameless.has(n.toLowerCase())) {
      throw refuse('bad-request', `use the person's name, not an email address (${n})`);
    }
  }
}

function sameToken(given, wanted) {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(wanted, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// `update` with an `email` entry (ProjectEmailEntryInput), only on the inbox owner's Save.
function emailUpdate(input, entry, loc, ctx) {
  if (hasBcc(input)) throw refuse('bad-request', NEVER_BCC);
  const id = draftIdOf(entry.draft);
  const notApproved = () => refuse('not-allowed', "only the inbox owner's Save in TDS Cortex can add an email to a project");
  if (!isText(entry.token) || !TOKEN_PATTERN.test(entry.token)) throw notApproved();
  const summary = checkSummary(entry.summary);
  const subject = fitQuotes(emailLine(entry.subject, 'subject', EMAIL.EMAIL_SUBJECT_MAX, true));
  if (yamlText(subject) === null) throw refuse('bad-request', "the subject can't be written as it is");
  const from = entryName(entry.from, 'from');
  if (!Array.isArray(entry.people) || entry.people.length > EMAIL.EMAIL_PEOPLE_MAX) {
    throw refuse('bad-request', `people must be a list of at most ${EMAIL.EMAIL_PEOPLE_MAX} names`);
  }
  const people = entry.people.map(p => entryName(p, 'a name'));
  if (typeof entry.clientSafe !== 'boolean') throw refuse('bad-request', 'clientSafe must be true or false');

  const who = identity(ctx);
  checkWriter(ctx, loc, who);
  const cardFile = requireLiveCard(ctx, loc);
  if (!who.known || !who.slug) throw notApproved();
  const folder = draftsFolder(ctx, false, [draftsRel(`${id}.json`)]);
  const r = ownDraft(ctx, folder, id, who);
  if (!sameToken(entry.token, r.draft.approve_token)) throw notApproved();
  requireNames([from, ...people], r.draft);

  const held = emailHeld(ctx, r.draft.email_key);
  if (held) {
    removeQuietly(r.abs);
    throw alreadyIn(held);
  }
  const updates = updatesFolder(ctx, loc, true);
  const file = writeEntry(ctx, loc, who, updates, {
    kind: 'email',
    clientSafe: entry.clientSafe,
    email: {
      subject,
      from,
      people,
      sentAt: isoSecond(new Date(r.draft.sent_at)),
      threadId: r.draft.thread_id,
      key: r.draft.email_key,
      inboxOwner: r.draft.inbox_owner,
    },
  }, summary);
  removeQuietly(r.abs);
  syncDir(folder.abs);
  return { ok: true, action: 'update', key: loc.key, version: sha256(cardFile.bytes), file };
}

// An email entry's frontmatter lines, after `client_safe` (contract ProjectEmailEntryInput).
function emailLines(e) {
  const lines = [`email_subject: ${factValue(e.subject)}`, `email_from: ${factValue(e.from)}`];
  if (e.people.length === 0) lines.push('email_people: []');
  else lines.push('email_people:', ...e.people.map(p => `  - ${yamlItem(p)}`));
  lines.push(
    `email_sent_at: ${e.sentAt}`,
    `email_thread_id: ${factValue(e.threadId)}`,
    `email_key: ${factValue(e.key)}`,
    `email_inbox_owner: ${e.inboxOwner}`,
  );
  return lines;
}

// ---- command line --------------------------------------------------------------------------------

const ACTIONS = {
  create, card, edit, link, unlink, move, archive, unarchive, delete: deleteProject, update,
  'update-remove': updateRemove, ref: refAction, 'find-ref': findRef, 'email-draft': emailDraft,
  'email-draft-remove': emailDraftRemove, capabilities,
};

function defaultCtx() {
  return {
    root: process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..'),
    home: os.homedir(),
    now: new Date(),
  };
}

// Runs one action. Returns the exit code and the reply; never throws.
function run(action, input, ctx) {
  const fail = (code, message, extra) => ({
    exit: code === 'internal' ? 1 : 2,
    reply: { ...(extra || {}), ok: false, error: code, message },
  });
  if (typeof action !== 'string' || !ACTION_NAMES.includes(action)) return fail('bad-request', 'unknown action');
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return fail('bad-request', 'stdin must be one JSON object');
  }
  if (input.kind !== undefined && input.kind !== action) return fail('bad-request', 'kind must name the same action');
  const context = Object.assign(defaultCtx(), ctx);
  try {
    return { exit: 0, reply: ACTIONS[action](input, context) };
  } catch (err) {
    if (err instanceof Refusal) return fail(err.code, err.message, err.extra);
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
  PROJECTS_UPDATES_CAPABILITY,
  PROJECTS_REFS_CAPABILITY,
  PROJECTS_EMAIL_CAPABILITY,
  EMAIL,
  EMAIL_DRAFT_FILE_PATTERN,
  REF_DIGITS,
  REF_LETTERS,
  CLIENT_CODE_PATTERN,
  REF_PATTERN,
  REF_PROJECT_PART,
  REF_CANDIDATE_SOURCE,
  REF_CANDIDATES_MAX,
  refCandidates,
  isValidRef,
  foldRef,
  foldClientCode,
  nearRefs,
  UPDATES_DIR,
  UPDATE_FILE_PATTERN,
  UPDATE_SUMMARY_MAX,
  PROJECT_MOVED_FROM_MAX,
  INTERNAL_CLIENT,
  INTERNAL_PRECEDENCE,
  PROJECT_CARD_FILE,
  LIMITS,
  LINK_ROOTS,
};
