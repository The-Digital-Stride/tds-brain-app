#!/usr/bin/env node
/**
 * proposals.cjs — the proposal library for supervised Google Ads management.
 *
 * A proposal is the unit everything flows through (plan: plans/20261025-automated-google-ads-
 * management.md §3.2; schema: .claude/skills/ads-manager/references/proposal-schema.md). It is
 * a Markdown file, clients/<client>/proposals/<YYYYMMDD>-<nn>-<slug>.md, with YAML frontmatter
 * (a subset: scalars and flat lists) and a human-readable body.
 *
 * Who writes what:
 *   create / validate / expire / stamp / lock   — the system (ads-manager runs, gads-write)
 *   approve / reject / requestChanges           — HUMANS ONLY. The Workbench Approvals panel calls
 *                                                 these with the signed-in member from /api/me; the
 *                                                 CLI needs --as=<your slug> and it must match this
 *                                                 machine's git user. Claude never runs them.
 *
 * Library:  const P = require('.../proposals.cjs')
 * CLI:      node .claude/skills/ads-manager/scripts/lib/proposals.cjs <command> --client=<slug> ...
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../../../..');

const TYPES = ['decision', 'change', 'email', 'info-request', 'report'];
const STATUSES = ['draft', 'proposed', 'approved', 'rejected', 'changes-requested', 'applied', 'verified', 'failed', 'void'];
const TIERS = [0, 1, 2, 3];
const LOCK_TYPES = ['budget', 'target'];
const TARGET_FIELDS = ['target_cpa.target_cpa_micros', 'maximize_conversions.target_cpa_micros', 'target_roas.target_roas', 'maximize_conversion_value.target_roas'];

// Field order in the frontmatter. Unknown fields are kept after these.
const FIELD_ORDER = [
  'id', 'client', 'type', 'tier', 'status', 'title', 'owner', 'reviewer', 'framework_section',
  'created_at', 'created_by', 'campaigns', 'evidence', 'operations', 'dry_run', 'expected_effect',
  'risk_notes', 'needs_client_approval', 'client_approver', 'learning_window_days', 'lock_type', 'expires',
  'approved_by', 'approved_at', 'approval_hash',
  'rejected_by', 'rejected_at', 'rejection_reason',
  'changes_requested_by', 'changes_requested_at', 'changes_note',
  'client_request_at', 'client_request_draft', 'client_request_gmail_draft_id',
  'client_approved_by', 'client_approved_at', 'client_approval_recorded_by', 'client_approval_note',
  'executor', 'follows',
  'applied_at', 'verified_at', 'outcome', 'voided_at',
];
// client_request_* are system stamps (the draft was written); client_approved_* are written only
// by recordClientApproval(), a human attesting what the client said.
const STAMPABLE = new Set(['status', 'applied_at', 'verified_at', 'outcome', 'voided_at', 'dry_run', 'executor', 'client_request_at', 'client_request_draft', 'client_request_gmail_draft_id']);

// ── small helpers ─────────────────────────────────────────────────────────────
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const today = (d = new Date()) => d.toISOString().slice(0, 10);
const bodyHash = (body) => crypto.createHash('sha256').update(String(body).replace(/\r\n/g, '\n').trim()).digest('hex');
const isDate = (s) => /^\d{4}-\d{2}-\d{2}/.test(String(s || ''));
const endOfDay = (s) => new Date(String(s).length <= 10 ? `${s}T23:59:59` : String(s));

function loadRoster(root = ROOT) {
  try { const j = JSON.parse(fs.readFileSync(path.join(root, '.team-config', 'roles.json'), 'utf8')); return Array.isArray(j.members) ? j.members : []; } catch { return []; }
}
// A human in roles.json, named any of the ways the brain names people. Returns the member with
// a normalised `slug` = slugified name (the todo/assignee convention), not the app's slug field.
function findMember(who, root = ROOT) {
  const w = String(who || '').trim().toLowerCase();
  if (!w) return null;
  const m = loadRoster(root).find((x) => slugify(x.name) === w || String(x.slug || '').toLowerCase() === w || String(x.email || '').toLowerCase() === w || String(x.name || '').toLowerCase() === w);
  return m ? { ...m, slug: slugify(m.name) } : null;
}
function gitUser(root = ROOT) {
  const g = (k) => { try { return execSync(`git config ${k}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
  const email = g('user.email'), name = g('user.name');
  return findMember(email, root) || findMember(name, root) || (name ? { name, email, slug: slugify(name), role: null } : null);
}

// ── YAML subset: scalars and flat lists ───────────────────────────────────────
function parseScalar(raw) {
  let v = String(raw).trim();
  if (v === '' || v === '~' || v === 'null') return null;
  if (/^(['"]).*\1$/s.test(v)) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v.replace(/\s+#.*$/, '');
}
function parseFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const fm = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!kv) continue;
    const key = kv[1], rest = kv[2];
    if (rest === '' && /^\s+-\s/.test(lines[i + 1] || '')) {
      const arr = [];
      while (/^\s+-\s/.test(lines[i + 1] || '')) { i++; arr.push(parseScalar(lines[i].replace(/^\s+-\s*/, ''))); }
      fm[key] = arr;
    } else if (/^\[.*\]$/.test(rest)) {
      fm[key] = rest.slice(1, -1).split(',').map((s) => parseScalar(s)).filter((x) => x !== null);
    } else {
      fm[key] = parseScalar(rest);
    }
  }
  return { fm, body: m[2] };
}
function yamlScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (s === '' || /[:#\[\]{}&*!|>'"%@`]|^\s|\s$|^-\s|^(true|false|null|~)$|^-?\d+(\.\d+)?$/.test(s) || s.includes(': ')) return JSON.stringify(s);
  return s;
}
function serialize(fm, body) {
  const keys = [...FIELD_ORDER.filter((k) => k in fm), ...Object.keys(fm).filter((k) => !FIELD_ORDER.includes(k))];
  const lines = keys.map((k) => Array.isArray(fm[k])
    ? (fm[k].length ? `${k}:\n${fm[k].map((x) => `  - ${yamlScalar(x)}`).join('\n')}` : `${k}: []`)
    : `${k}: ${yamlScalar(fm[k])}`);
  return `---\n${lines.join('\n')}\n---\n${String(body || '').replace(/^\n+/, '')}`;
}

// ── paths and config ─────────────────────────────────────────────────────────
function resolveClientDir(client, root = ROOT) {
  if (!client) return null;
  const direct = path.resolve(root, client);
  if (fs.existsSync(path.join(direct, 'profile.md')) || fs.existsSync(path.join(direct, 'config'))) return direct;
  let accounts = null;
  try { accounts = require(path.join(root, '.claude/skills/gads-proxy/scripts/lib/accounts.cjs')); } catch { /* no gads-proxy */ }
  const acc = accounts && accounts.loadAccountsFile();
  const entry = acc && accounts.findAccount(acc.data, client);
  const folder = (acc && acc.data._meta && acc.data._meta.dataFolder) || 'clients';
  const keys = entry ? [entry.key, entry.key.replace(/_/g, '-'), entry.key.replace(/-/g, '_')] : [client, client.replace(/_/g, '-')];
  for (const k of keys) { const p = path.join(root, folder, k); if (fs.existsSync(p)) return p; }
  return null;
}
const proposalsDir = (clientDir) => path.join(clientDir, 'proposals');
const proposalFile = (clientDir, id) => path.join(proposalsDir(clientDir), `${id}.md`);
const locksFile = (clientDir) => path.join(proposalsDir(clientDir), 'locks.json');
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
const loadManagement = (clientDir) => readJson(path.join(clientDir, 'config', 'management.json'), null);
function profileOwner(clientDir) {
  const p = parseFrontmatter(fs.existsSync(path.join(clientDir, 'profile.md')) ? fs.readFileSync(path.join(clientDir, 'profile.md'), 'utf8') : '');
  return p && p.fm.owner ? String(p.fm.owner) : null;
}
const validId = (id) => /^\d{8}-\d{2}-[a-z0-9][a-z0-9-]*$/.test(String(id || ''));

// ── read / list ──────────────────────────────────────────────────────────────
function read({ clientDir, id, file }) {
  const f = file || proposalFile(clientDir, id);
  const text = fs.readFileSync(f, 'utf8');
  const parsed = parseFrontmatter(text);
  if (!parsed) throw new Error(`${path.basename(f)} has no YAML frontmatter`);
  return { file: f, id: parsed.fm.id || path.basename(f, '.md'), fm: parsed.fm, body: parsed.body };
}
function list({ clientDir, status, tier, type, reviewer } = {}) {
  const dir = proposalsDir(clientDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    try { return read({ file: path.join(dir, f) }); } catch { return null; }
  }).filter(Boolean).filter((p) =>
    (!status || [].concat(status).includes(p.fm.status)) &&
    (tier === undefined || Number(p.fm.tier) === Number(tier)) &&
    (!type || p.fm.type === type) &&
    (!reviewer || p.fm.reviewer === reviewer));
}
const summarize = (p) => `[T${p.fm.tier}] ${p.id} — ${p.fm.title || '(untitled)'} · ${p.fm.status}${p.fm.approved_by ? ` by ${p.fm.approved_by}` : ''}${p.fm.expires ? ` · expires ${p.fm.expires}` : ''}`;

// ── operations file inspection (for lock_type and validation) ────────────────
function inspectOperations(clientDir, rel) {
  if (!rel) return { exists: false };
  const candidates = [path.resolve(clientDir, rel), path.resolve(ROOT, rel)];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) return { exists: false };
  const j = readJson(file, null);
  if (!j) return { exists: true, file, error: 'not valid JSON' };
  // RSA text edits run through update-rsa (apply.cjs picks it from this shape): a list of its
  // flags, not REST operations. Never a budget or target, so no lock.
  if (!Array.isArray(j) && (j.executor === 'update-rsa' || (Array.isArray(j.args) && !j.operations))) {
    if (!Array.isArray(j.args) || !j.args.length) return { exists: true, file, error: 'update-rsa operations need an "args" list' };
    return { exists: true, file, executor: 'update-rsa', mutatePath: 'ads:mutate', count: j.args.length, lockType: null };
  }
  // PMax text swaps run through update-pmax-text (apply.cjs picks it from this shape). Copy only,
  // so no lock.
  if (!Array.isArray(j) && j.executor === 'pmax-text') {
    if (!Array.isArray(j.swaps) || !j.swaps.length) return { exists: true, file, error: 'pmax-text operations need a "swaps" list' };
    return { exists: true, file, executor: 'pmax-text', mutatePath: 'googleAds:mutate', count: j.swaps.length, lockType: null };
  }
  const ops = Array.isArray(j) ? j : j.operations;
  const mutatePath = Array.isArray(j) ? null : j.path;
  if (!Array.isArray(ops) || !ops.length) return { exists: true, file, error: 'no operations array' };
  const masks = ops.flatMap((op) => { const m = op.updateMask ?? op.update_mask; return Array.isArray(m) ? m : typeof m === 'string' ? m.split(',').map((s) => s.trim()) : []; });
  let lockType = null;
  if (mutatePath === 'campaignBudgets:mutate' || masks.includes('amount_micros')) lockType = 'budget';
  if (masks.some((f) => TARGET_FIELDS.includes(f))) lockType = lockType ? 'budget+target' : 'target';
  return { exists: true, file, mutatePath, count: ops.length, lockType };
}

// ── validate ─────────────────────────────────────────────────────────────────
function validate({ clientDir, fm, body }) {
  const errors = [], warnings = [];
  const req = ['id', 'client', 'type', 'tier', 'status', 'title', 'owner', 'reviewer', 'created_at', 'expires'];
  for (const k of req) if (fm[k] === null || fm[k] === undefined || fm[k] === '') errors.push(`${k} is required`);
  if (fm.id && !validId(fm.id)) errors.push(`id "${fm.id}" must look like 20261027-03-slug`);
  if (fm.client && clientDir && fm.client !== path.basename(clientDir)) errors.push(`client "${fm.client}" is not ${path.basename(clientDir)}`);
  if (fm.type && !TYPES.includes(fm.type)) errors.push(`type "${fm.type}" is not one of ${TYPES.join(', ')}`);
  if (fm.tier !== undefined && !TIERS.includes(Number(fm.tier))) errors.push(`tier "${fm.tier}" must be 0-3`);
  if (fm.status && !STATUSES.includes(fm.status)) errors.push(`status "${fm.status}" is not one of ${STATUSES.join(', ')}`);
  for (const k of ['owner', 'reviewer']) if (fm[k] && !findMember(fm[k])) errors.push(`${k} "${fm[k]}" is not a member in .team-config/roles.json`);
  if (fm.expires && !isDate(fm.expires)) errors.push(`expires "${fm.expires}" is not a date`);
  if (fm.framework_section !== undefined && fm.framework_section !== null && !(Number(fm.framework_section) >= 1 && Number(fm.framework_section) <= 9)) errors.push('framework_section must be 1-9');
  if (fm.type === 'change') {
    if (!fm.operations) errors.push('a change proposal needs an operations file');
    else {
      const ins = inspectOperations(clientDir, fm.operations);
      if (!ins.exists) errors.push(`operations file not found: ${fm.operations}`);
      else if (ins.error) errors.push(`operations file ${fm.operations}: ${ins.error}`);
      else {
        if (ins.lockType && !(Number(fm.learning_window_days) >= 7)) errors.push(`a ${ins.lockType} change needs learning_window_days of at least 7 (has ${fm.learning_window_days ?? 'none'})`);
        if (ins.lockType && !(Array.isArray(fm.campaigns) && fm.campaigns.length)) errors.push(`a ${ins.lockType} change must list the campaigns it touches in "campaigns" (used for the learning-window lock)`);
        if (fm.lock_type && ins.lockType && fm.lock_type !== ins.lockType) warnings.push(`lock_type "${fm.lock_type}" disagrees with the operations file (${ins.lockType})`);
      }
    }
    if (Number(fm.tier) === 0) errors.push('a change proposal cannot be tier 0 (tier 0 is internal notes only)');
  }
  if (fm.type === 'change' && Number(fm.tier) >= 2 && !fm.expected_effect) warnings.push('tier 2+ change with no expected_effect');
  if (Array.isArray(fm.evidence)) for (const e of fm.evidence) if (!fs.existsSync(path.resolve(clientDir, String(e))) && !fs.existsSync(path.resolve(ROOT, String(e)))) warnings.push(`evidence not found on disk: ${e}`);
  if (fm.needs_client_approval === true && !fm.client_approver) warnings.push('needs_client_approval is true but client_approver is empty');
  if (!String(body || '').trim()) errors.push('body is empty; the reviewer needs the what, why, expected effect and rollback');
  if (/£\s?\d/.test(String(body)) && !/\b(google|crm|zoho)[- ]?basis\b/i.test(String(body))) warnings.push('the body quotes a £ figure without naming its basis (Google basis vs CRM basis)');
  if (fm.approved_by && !fm.approval_hash) errors.push('approved_by is set without approval_hash; approvals must go through approve()');
  return { ok: !errors.length, errors, warnings };
}

// ── create ───────────────────────────────────────────────────────────────────
function nextId(clientDir, slug, date = new Date()) {
  const d = date.toISOString().slice(0, 10).replace(/-/g, '');
  const dir = proposalsDir(clientDir);
  const n = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(d + '-') && f.endsWith('.md')).length + 1 : 1;
  return `${d}-${String(n).padStart(2, '0')}-${slugify(slug).slice(0, 40).replace(/-$/, '')}`;
}
function create({ clientDir, type, tier, slug, title, body, status = 'proposed', createdBy, fields = {} }) {
  if (!clientDir || !fs.existsSync(clientDir)) throw new Error('clientDir does not exist');
  const mg = loadManagement(clientDir) || {};
  const owner = fields.owner || mg.people?.owner || profileOwner(clientDir) || null;
  const reviewer = fields.reviewer || mg.people?.reviewer || owner;
  const expiresDays = Number(fields.expiresDays ?? mg.proposals?.expiresDays ?? 7);
  const now = new Date();
  const id = nextId(clientDir, slug, now);
  const ins = type === 'change' ? inspectOperations(clientDir, fields.operations) : { lockType: null };
  const defaultWindow = ins.lockType ? Number(mg.budget?.learningWindowDays ?? 14) : 0;
  const fm = {
    id, client: path.basename(clientDir), type, tier: Number(tier), status, title,
    owner, reviewer,
    framework_section: fields.framework_section ?? null,
    created_at: now.toISOString(), created_by: createdBy || 'ads-manager',
    campaigns: fields.campaigns || [],
    evidence: fields.evidence || [],
    operations: fields.operations || null,
    dry_run: fields.dry_run || null,
    expected_effect: fields.expected_effect || null,
    risk_notes: fields.risk_notes || null,
    needs_client_approval: !!fields.needs_client_approval,
    client_approver: fields.client_approver || null,
    learning_window_days: fields.learning_window_days ?? defaultWindow,
    lock_type: ins.lockType || null,
    expires: new Date(now.getTime() + expiresDays * 86400000).toISOString().slice(0, 10),
    approved_by: null, approved_at: null, approval_hash: null,
    applied_at: null, verified_at: null, outcome: null,
  };
  for (const [k, v] of Object.entries(fields)) if (!(k in fm) && !['expiresDays'].includes(k)) fm[k] = v;
  const v = validate({ clientDir, fm, body });
  if (!v.ok) throw new Error(`proposal not valid:\n  - ${v.errors.join('\n  - ')}`);
  fs.mkdirSync(proposalsDir(clientDir), { recursive: true });
  const file = proposalFile(clientDir, id);
  if (fs.existsSync(file)) throw new Error(`${file} already exists`);
  fs.writeFileSync(file, serialize(fm, body));
  return { id, file, fm, warnings: v.warnings };
}

// ── human-only transitions ───────────────────────────────────────────────────
function requireHuman(by) {
  const m = findMember(by);
  if (!m) throw new Error(`"${by}" is not a member in .team-config/roles.json; only a human on the roster can approve, reject or request changes`);
  return m;
}
function mayDecide(member, fm) {
  return member.slug === fm.reviewer || member.slug === fm.owner || member.role === 'owner';
}
function writeBack(p) { fs.writeFileSync(p.file, serialize(p.fm, p.body)); return p; }

function approve({ clientDir, id, by, at = new Date() }) {
  const m = requireHuman(by);
  const p = read({ clientDir, id });
  if (!['proposed', 'changes-requested'].includes(p.fm.status)) throw new Error(`${id} is ${p.fm.status}; only a proposed or changes-requested proposal can be approved`);
  if (!mayDecide(m, p.fm)) throw new Error(`${m.name} is neither the reviewer (${p.fm.reviewer}) nor the owner (${p.fm.owner}) of ${id}`);
  if (p.fm.expires && endOfDay(p.fm.expires) < at) throw new Error(`${id} expired on ${p.fm.expires}; it has to be re-raised, not approved`);
  const v = validate({ clientDir, fm: p.fm, body: p.body });
  if (!v.ok) throw new Error(`${id} is not valid, fix it before approving:\n  - ${v.errors.join('\n  - ')}`);
  Object.assign(p.fm, { status: 'approved', approved_by: m.slug, approved_at: at.toISOString(), approval_hash: bodyHash(p.body) });
  return writeBack(p);
}
// The client said yes. A human on the roster records it (who said it, how); the system never
// infers it from an email. gads-write refuses a needs_client_approval proposal without this.
function recordClientApproval({ clientDir, id, by, who, note, at = new Date() }) {
  const m = requireHuman(by);
  const p = read({ clientDir, id });
  if (!p.fm.needs_client_approval) throw new Error(`${id} does not need client approval`);
  if (p.fm.status !== 'approved') throw new Error(`${id} is ${p.fm.status}; approve it internally first, then record the client's yes`);
  if (!mayDecide(m, p.fm)) throw new Error(`${m.name} is neither the reviewer (${p.fm.reviewer}) nor the owner (${p.fm.owner}) of ${id}`);
  const w = String(who || '').trim(); if (!w) throw new Error('say who at the client said yes (e.g. "Mark, email 29 Oct")');
  Object.assign(p.fm, { client_approved_by: w, client_approved_at: at.toISOString(), client_approval_recorded_by: m.slug, client_approval_note: String(note || '').trim() || null });
  return writeBack(p);
}
// Batch approval is tier 1 only (plan §3.2: no "approve all" at tier 2 or 3).
function approveMany({ clientDir, ids, by, at = new Date() }) {
  const out = [];
  for (const id of ids) {
    const p = read({ clientDir, id });
    if (Number(p.fm.tier) > 1) { out.push({ id, ok: false, error: `tier ${p.fm.tier}: approve it on its own` }); continue; }
    try { approve({ clientDir, id, by, at }); out.push({ id, ok: true }); } catch (e) { out.push({ id, ok: false, error: e.message }); }
  }
  return out;
}
function reject({ clientDir, id, by, reason, at = new Date() }) {
  const m = requireHuman(by);
  const p = read({ clientDir, id });
  if (!['proposed', 'changes-requested', 'approved'].includes(p.fm.status)) throw new Error(`${id} is ${p.fm.status}; cannot reject`);
  if (!mayDecide(m, p.fm)) throw new Error(`${m.name} is neither the reviewer nor the owner of ${id}`);
  if (!reason) throw new Error('a rejection needs a reason; it feeds the learning loop');
  Object.assign(p.fm, { status: 'rejected', rejected_by: m.slug, rejected_at: at.toISOString(), rejection_reason: reason });
  if (p.fm.status === 'approved') Object.assign(p.fm, { approved_by: null, approved_at: null, approval_hash: null });
  return writeBack(p);
}
function requestChanges({ clientDir, id, by, note, at = new Date() }) {
  const m = requireHuman(by);
  const p = read({ clientDir, id });
  if (!['proposed', 'approved'].includes(p.fm.status)) throw new Error(`${id} is ${p.fm.status}; cannot request changes`);
  if (!mayDecide(m, p.fm)) throw new Error(`${m.name} is neither the reviewer nor the owner of ${id}`);
  if (!note) throw new Error('say what should change');
  Object.assign(p.fm, { status: 'changes-requested', changes_requested_by: m.slug, changes_requested_at: at.toISOString(), changes_note: note, approved_by: null, approved_at: null, approval_hash: null });
  return writeBack(p);
}

// The system's answer to "Request changes": rewrite a changes-requested proposal as the reviewer
// asked and put it back as proposed, so it returns to the Workbench for a fresh decision. The
// approval fields stay empty (requestChanges cleared them); the reviewer still has to approve.
const REVISABLE = new Set(['title', 'tier', 'operations', 'campaigns', 'evidence', 'expected_effect', 'risk_notes', 'learning_window_days', 'expires', 'needs_client_approval', 'client_approver']);
function revise({ clientDir, id, body, fields = {}, by = 'ads-manager', at = new Date() }) {
  const p = read({ clientDir, id });
  if (p.fm.status !== 'changes-requested') throw new Error(`${id} is ${p.fm.status}; only a changes-requested proposal can be revised`);
  if (!body || !String(body).trim()) throw new Error('the revised body is empty');
  for (const k of Object.keys(fields)) if (!REVISABLE.has(k)) throw new Error(`refusing to revise "${k}"`);
  Object.assign(p.fm, fields, {
    status: 'proposed', revised_at: at.toISOString(), revised_by: by,
    revision: Number(p.fm.revision || 0) + 1, last_changes_note: p.fm.changes_note,
    changes_note: null, approved_by: null, approved_at: null, approval_hash: null,
  });
  p.body = String(body);
  const v = validate({ clientDir, fm: p.fm, body: p.body });
  if (!v.ok) throw new Error(`the revision is not valid:\n  - ${v.errors.join('\n  - ')}`);
  return writeBack(p);
}

// ── the apply-side check (what gads-write asks) ──────────────────────────────
function checkApproved({ clientDir, id, today: now = new Date() }) {
  if (!validId(id)) return { ok: false, reason: `"${id}" is not a valid proposal id` };
  const file = proposalFile(clientDir, id);
  if (!fs.existsSync(file)) return { ok: false, reason: `no proposal file at ${path.relative(ROOT, file)}`, file };
  let p;
  try { p = read({ file }); } catch (e) { return { ok: false, reason: e.message, file }; }
  const { fm, body } = p;
  const fail = (reason) => ({ ok: false, reason, file, fm, body });
  if (fm.id !== id) return fail(`frontmatter id "${fm.id}" does not match the file name`);
  if (fm.client !== path.basename(clientDir)) return fail(`proposal is for "${fm.client}", not ${path.basename(clientDir)}`);
  if (fm.type !== 'change') return fail(`type is "${fm.type}"; only change proposals carry operations`);
  if (fm.status !== 'approved') return fail(`status is "${fm.status}", not approved`);
  if (fm.applied_at) return fail(`already applied at ${fm.applied_at}`);
  if (!fm.approved_by) return fail('approved_by is empty');
  const m = findMember(fm.approved_by);
  if (!m) return fail(`approved_by "${fm.approved_by}" is not a member in .team-config/roles.json`);
  if (!fm.approved_at) return fail('approved_at is empty');
  if (!fm.approval_hash) return fail('approval_hash is missing; approvals must go through approve()');
  if (bodyHash(body) !== String(fm.approval_hash)) return fail('body changed since approval (approval_hash mismatch); re-approve it');
  if (fm.expires && endOfDay(fm.expires) < now) return fail(`expired on ${fm.expires}; data is stale, re-raise it`);
  if (fm.needs_client_approval && !fm.client_approved_at) return fail(`needs the client's agreement (${fm.client_approver || 'client approver'}) and none is recorded; when they say yes run proposals.cjs client-approved --id=${id} --as=<you> --who="..."`);
  return { ok: true, reason: `approved by ${m.name} on ${String(fm.approved_at).slice(0, 10)}${fm.client_approved_at ? `, client (${fm.client_approved_by}) ${String(fm.client_approved_at).slice(0, 10)}` : ''}`, file, fm, body, approver: m };
}

// System-side stamps. Approval fields can never be written through here.
function stamp({ clientDir, id, file }, fields) {
  const p = read({ clientDir, id, file });
  for (const k of Object.keys(fields)) if (!STAMPABLE.has(k)) throw new Error(`refusing to stamp "${k}"`);
  Object.assign(p.fm, fields);
  return writeBack(p);
}

function expire({ clientDir, today: now = new Date() }) {
  const out = [];
  for (const p of list({ clientDir, status: ['draft', 'proposed', 'changes-requested'] })) {
    if (p.fm.expires && endOfDay(p.fm.expires) < now) { stamp({ file: p.file }, { status: 'void', voided_at: now.toISOString() }); out.push(p.id); }
  }
  return out;
}

// ── learning-window locks ────────────────────────────────────────────────────
const lockKey = (campaign, type) => `${campaign}::${type}`;
const locks = (clientDir) => readJson(locksFile(clientDir), {});
function lock({ clientDir, campaign, type, days, proposal, from = new Date() }) {
  if (!LOCK_TYPES.includes(type)) throw new Error(`lock type must be ${LOCK_TYPES.join(' or ')}`);
  if (!(Number(days) > 0)) return null;
  const all = locks(clientDir);
  const until = new Date(from.getTime() + Number(days) * 86400000).toISOString().slice(0, 10);
  all[lockKey(campaign, type)] = { campaign, type, since: from.toISOString().slice(0, 10), until, proposal: proposal || null };
  fs.mkdirSync(proposalsDir(clientDir), { recursive: true });
  fs.writeFileSync(locksFile(clientDir), JSON.stringify(all, null, 2) + '\n');
  return all[lockKey(campaign, type)];
}
function checkLock({ clientDir, campaign, type, today: now = new Date() }) {
  const l = locks(clientDir)[lockKey(campaign, type)];
  if (!l) return { locked: false };
  return endOfDay(l.until) >= now ? { locked: true, ...l } : { locked: false, expired: l };
}

module.exports = {
  ROOT, TYPES, STATUSES, TIERS, LOCK_TYPES, FIELD_ORDER,
  slugify, bodyHash, parseFrontmatter, serialize, findMember, loadRoster, gitUser,
  resolveClientDir, proposalsDir, proposalFile, loadManagement,
  read, list, summarize, validate, create, inspectOperations,
  approve, approveMany, reject, requestChanges, revise, recordClientApproval,
  checkApproved, stamp, expire,
  locks, lock, checkLock,
};

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const arg = (n) => { const p = `--${n}=`; const a = argv.find((x) => x.startsWith(p)); return a ? a.slice(p.length) : ''; };
  const args = (n) => argv.filter((x) => x.startsWith(`--${n}=`)).map((x) => x.slice(n.length + 3)).filter(Boolean);
  const has = (n) => argv.includes(`--${n}`);
  const out = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2));
  const die = (msg, code = 1) => { console.error(`✗ ${msg}`); process.exit(code); };
  const usage = () => {
    console.error([
      'proposals.cjs <command> --client=<slug|alias|id> [--client-dir=<path>]',
      '  list [--status=a,b] [--tier=N] [--type=T] [--reviewer=slug] [--json]',
      '  show --id=<id>',
      '  new --type=<change|decision|email|info-request|report> --tier=<0-3> --slug=<s> --title="..." --body-file=<md> [--follows=<decision id>]',
      '      [--operations=<rel path>] [--campaign="name" ...repeatable] [--evidence=a,b] [--section=1-9] [--expected="..."] [--risk="..."]',
      '      [--window=<days>] [--expires-days=N] [--needs-client-approval --client-approver="..."] [--status=draft|proposed]',
      '      [--created-by=<slug>]  default ads-manager; a person raising one by hand passes their own slug',
      '  validate [--id=<id>]           all proposals, or one',
      '  expire                         mark proposals past their expiry as void',
      '  locks                          show learning-window locks',
      '  approve | reject | request-changes --id=<id> --as=<your slug> [--reason="..."] [--note="..."]',
      '  revise --id=<id> --body-file=<md> [--title= --operations= --tier= ...]   (system: answer a changes request)',
      '  client-approved --id=<id> --as=<your slug> --who="Mark, email 29 Oct" [--note="..."]   (records the client\'s yes on a needs_client_approval proposal)',
      '      HUMAN ONLY. --as must be this machine\'s git user. Claude never runs these three.',
    ].join('\n'));
    process.exit(1);
  };
  if (!cmd || has('help')) usage();
  const clientDir = arg('client-dir') ? path.resolve(ROOT, arg('client-dir')) : resolveClientDir(arg('client'));
  if (!clientDir) die('pass --client=<slug> (a folder under clients/ or an accounts.json key/alias) or --client-dir=<path>');
  try {
    switch (cmd) {
      case 'list': {
        const items = list({ clientDir, status: arg('status') ? arg('status').split(',') : undefined, tier: arg('tier') ? Number(arg('tier')) : undefined, type: arg('type') || undefined, reviewer: arg('reviewer') || undefined });
        if (has('json')) out(items.map((p) => ({ id: p.id, file: path.relative(ROOT, p.file), ...p.fm })));
        else { items.forEach((p) => out(summarize(p))); if (!items.length) out('(no proposals)'); }
        break;
      }
      case 'show': { const p = read({ clientDir, id: arg('id') }); out(has('json') ? { id: p.id, file: path.relative(ROOT, p.file), fm: p.fm, body: p.body } : fs.readFileSync(p.file, 'utf8')); break; }
      case 'new': {
        if (!arg('body-file')) die('--body-file=<markdown> is required: the reviewer reads the body');
        const body = fs.readFileSync(path.resolve(ROOT, arg('body-file')), 'utf8');
        const r = create({
          clientDir, type: arg('type'), tier: arg('tier'), slug: arg('slug'), title: arg('title'), body,
          status: arg('status') || 'proposed', createdBy: arg('created-by') || 'ads-manager',
          fields: {
            operations: arg('operations') || undefined,
            campaigns: args('campaign').length ? args('campaign') : undefined,
            evidence: arg('evidence') ? arg('evidence').split(',').map((s) => s.trim()).filter(Boolean) : undefined,
            framework_section: arg('section') ? Number(arg('section')) : undefined,
            expected_effect: arg('expected') || undefined, risk_notes: arg('risk') || undefined,
            learning_window_days: arg('window') ? Number(arg('window')) : undefined,
            expiresDays: arg('expires-days') ? Number(arg('expires-days')) : undefined,
            needs_client_approval: has('needs-client-approval'), client_approver: arg('client-approver') || undefined,
            follows: arg('follows') || undefined,
          },
        });
        r.warnings.forEach((w) => console.error(`  ! ${w}`));
        out(`created ${path.relative(ROOT, r.file)}`);
        break;
      }
      case 'validate': {
        const items = arg('id') ? [read({ clientDir, id: arg('id') })] : list({ clientDir });
        let bad = 0;
        for (const p of items) {
          const v = validate({ clientDir, fm: p.fm, body: p.body });
          if (!v.ok) bad++;
          out(`${v.ok ? 'ok    ' : 'INVALID'} ${p.id}${v.errors.map((e) => `\n    ✗ ${e}`).join('')}${v.warnings.map((w) => `\n    ! ${w}`).join('')}`);
        }
        if (!items.length) out('(no proposals)');
        process.exit(bad ? 2 : 0);
      }
      // eslint-disable-next-line no-fallthrough
      case 'expire': { const ids = expire({ clientDir }); out(ids.length ? `voided: ${ids.join(', ')}` : 'nothing to expire'); break; }
      case 'locks': { out(locks(clientDir)); break; }
      case 'revise': {
        if (!arg('body-file')) die('--body-file=<markdown> is required: the full revised body');
        const body = fs.readFileSync(path.resolve(ROOT, arg('body-file')), 'utf8');
        const fields = {};
        for (const k of ['title', 'operations', 'expected_effect', 'risk_notes', 'expires', 'client_approver']) if (arg(k.replace(/_/g, '-'))) fields[k] = arg(k.replace(/_/g, '-'));
        if (arg('tier')) fields.tier = Number(arg('tier'));
        const p = revise({ clientDir, id: arg('id'), body, fields, by: arg('by') || 'ads-manager' });
        out(`${p.id}: revised (revision ${p.fm.revision}), back to proposed for ${p.fm.reviewer}`);
        break;
      }
      case 'client-approved': {
        const me = gitUser(); const as = arg('as');
        if (!as) die('--as=<your slug> is required');
        if (!me || slugify(as) !== me.slug) die(`--as=${as} is not this machine's git user (${me ? me.slug : 'unknown'})`, 2);
        const p = recordClientApproval({ clientDir, id: arg('id'), by: me.slug, who: arg('who'), note: arg('note') });
        out(`${p.id}: client approval recorded (${p.fm.client_approved_by}) by ${me.slug}`);
        break;
      }
      case 'approve': case 'reject': case 'request-changes': {
        const me = gitUser();
        const as = arg('as');
        if (!as) die(`--as=<your slug> is required (this machine's git user is ${me ? me.slug : 'unknown'})`);
        if (!me || slugify(as) !== me.slug) die(`--as=${as} is not this machine's git user (${me ? me.slug : 'unknown'}). You can only decide as yourself.`, 2);
        const common = { clientDir, id: arg('id'), by: me.slug };
        const p = cmd === 'approve' ? approve(common) : cmd === 'reject' ? reject({ ...common, reason: arg('reason') }) : requestChanges({ ...common, note: arg('note') });
        out(`${p.id} → ${p.fm.status} by ${me.slug}`);
        break;
      }
      default: usage();
    }
  } catch (e) { die(e.message, 2); }
}
