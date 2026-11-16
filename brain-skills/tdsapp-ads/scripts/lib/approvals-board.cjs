// PORTED from the brain Workbench: tools/members/command-centre/lib/approvals-board.cjs (sha256 in ../../SOURCES.md).
// Copied for tdsapp-ads so Cortex works on a Mac that never runs the Workbench (plan 2026-11-16-workbench-ad-manager,
// decision 9). Never edit the logic here: when the source changes, copy it again and update SOURCES.md.
// Changes from the source: BRAIN_ROOT is process.env.BRAIN_ROOT, else five folders up (this file sits in .claude/skills/tdsapp-ads/scripts/lib). The bridge (tdsapp-ads.cjs) uses board(), decide(), clientDraft(), recordClientApproval(), recordDecision() and signMonthly(); it runs apply.cjs itself, detached and never killed, so apply() below is unused.
'use strict';
/**
 * Approvals board — the ads-manager proposals waiting for a human, for the Workbench
 * (plans/20261025-automated-google-ads-management.md, item 2.1).
 *
 * Reads every clients/<c>/config/management.json that names a reviewer, lists that client's
 * proposals through the ads-manager library (never by hand), and decides them through the same
 * library's human-only approve / reject / request-changes, so the Workbench and the CLI write
 * exactly the same frontmatter. Who may decide is the library's rule (reviewer, owner, or the
 * owner role); the server only says who is sitting at this machine.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { spawn } = require('child_process');

const BRAIN_ROOT = process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..', '..');
const P = require(path.join(BRAIN_ROOT, '.claude', 'skills', 'ads-manager', 'scripts', 'lib', 'proposals.cjs'));
const MONTHLY = require(path.join(BRAIN_ROOT, '.claude', 'skills', 'ads-manager', 'scripts', 'monthly.cjs'));
const OPEN = new Set(['proposed', 'changes-requested', 'approved']);
const RECENT_DAYS = 14;

function clientsWithManagement() {
  const dir = path.join(BRAIN_ROOT, 'clients'); const out = [];
  for (const slug of fs.readdirSync(dir)) {
    if (slug.startsWith('_') || slug.startsWith('.')) continue;
    const f = path.join(dir, slug, 'config', 'management.json');
    if (!fs.existsSync(f)) continue;
    try { const m = JSON.parse(fs.readFileSync(f, 'utf8')); out.push({ slug, clientDir: path.join(dir, slug), management: m, name: displayName(path.join(dir, slug), slug) }); } catch { /* skip */ }
  }
  return out;
}

// The client's proper name from profile.md's `client:` frontmatter (management.json's `client`
// field is the slug). Falls back to the slug in title case.
function displayName(clientDir, slug) {
  try { const m = fs.readFileSync(path.join(clientDir, 'profile.md'), 'utf8').match(/^client:\s*"?([^"\n]+?)"?\s*$/m); if (m) return m[1].trim(); } catch { /* no profile */ }
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function latestPack(clientDir) {
  const ev = path.join(clientDir, 'proposals', 'evidence');
  if (!fs.existsSync(ev)) return null;
  const dates = fs.readdirSync(ev).filter((d) => /^\d{8}$/.test(d)).sort().reverse();
  for (const d of dates) { try { const p = JSON.parse(fs.readFileSync(path.join(ev, d, 'pack.json'), 'utf8')); return { date: p.date, act: p.counts.act, watch: p.counts.watch, provisional: p.provisional, report: `clients/${path.basename(clientDir)}/reports/weekly-check/${p.date}-weekly-check.md`, verification: (p.verification && p.verification.findings) || [] }; } catch { /* next */ } }
  return null;
}

// The latest monthly close and where it stands in the review gate (monthly.cjs monthStatus):
// draft or signed, by whom, which PDF exists. A complete, unsigned month is what the Sign off
// button acts on.
function latestMonthly(clientDir) {
  const dir = path.join(clientDir, 'reports', 'monthly'); if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => /^\d{4}-\d{2}-monthly-close\.json$/.test(x)).sort().pop(); if (!f) return null;
  try { return MONTHLY.monthStatus(clientDir, f.slice(0, 7)); } catch { return null; }
}

// Everything the panel shows, for the person at this machine (`me` = roster entry or null).
function board(me) {
  const since = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString();
  const clients = [];
  for (const c of clientsWithManagement()) {
    const reviewer = c.management.people && c.management.people.reviewer;
    const owner = c.management.people && c.management.people.owner;
    const mine = Boolean(me && (me.role === 'owner' || me.slug === reviewer || me.slug === owner));
    let all = []; try { all = P.list({ clientDir: c.clientDir }); } catch { /* no proposals folder */ }
    const rows = all.map((p) => ({ id: p.id, file: path.relative(BRAIN_ROOT, p.file), fm: p.fm, body: p.body, warnings: p.warnings || [] }));
    const open = rows.filter((r) => OPEN.has(r.fm.status)).sort((a, b) => (a.fm.tier - b.fm.tier) || String(a.id).localeCompare(b.id));
    const recent = rows.filter((r) => !OPEN.has(r.fm.status) && [r.fm.applied_at, r.fm.approved_at, r.fm.rejected_at, r.fm.verified_at, r.fm.voided_at].some((d) => d && String(d) >= since)).sort((a, b) => String(b.id).localeCompare(a.id));
    clients.push({ slug: c.slug, name: c.name, reviewer, owner, mine, canDecide: mine, open: open.map((r) => ({ ...r, body: r.body })), recent: recent.map((r) => ({ id: r.id, fm: r.fm })), pack: latestPack(c.clientDir), monthly: latestMonthly(c.clientDir) });
  }
  return { me: me ? { slug: me.slug, name: me.name, role: me.role } : null, generatedAt: new Date().toISOString(), waiting: clients.reduce((a, c) => a + (c.mine ? c.open.filter((r) => r.fm.status !== 'approved').length : 0), 0), toApply: clients.reduce((a, c) => a + (c.mine ? c.open.filter((r) => r.fm.status === 'approved').length : 0), 0), clients };
}

const ID_RE = /^[0-9]{8}-[0-9]{2}-[a-z0-9-]+$/;
function checkId(id) { if (!ID_RE.test(String(id || ''))) throw new Error('bad proposal id'); return id; }
function clientDirFor(slug) {
  if (!/^[a-z0-9-]+$/.test(String(slug || ''))) throw new Error('bad client');
  const d = path.join(BRAIN_ROOT, 'clients', slug); if (!fs.existsSync(path.join(d, 'config', 'management.json'))) throw new Error('unknown client'); return d;
}

// The three human decisions, through the library (same checks as the CLI's --as).
function decide({ client, id, action, by, text }) {
  if (!by) throw new Error('no identity for this machine; the Workbench cannot tell who you are');
  const clientDir = clientDirFor(client);
  checkId(id);
  const note = String(text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 1000);
  if (action === 'approve') {
    const p = P.approve({ clientDir, id, by });
    // A proposal the client has to agree to: write the request email now (Gmail draft + markdown),
    // so the approver finds it in Drafts straight away. Failure here never undoes the approval.
    if (p.fm.needs_client_approval) p.clientDraft = clientDraft({ client, id });
    return p;
  }
  if (action === 'reject') { if (!note) throw new Error('say why'); return P.reject({ clientDir, id, by, reason: note }); }
  if (action === 'request-changes') { if (!note) throw new Error('say what to change'); return P.requestChanges({ clientDir, id, by, note }); }
  throw new Error('unknown action');
}

// Runs scripts/client-draft.cjs for a proposal (needs_client_approval). Returns its last lines.
function clientDraft({ client, id, again }) {
  const clientDir = clientDirFor(client); checkId(id);
  const script = path.join(BRAIN_ROOT, '.claude', 'skills', 'ads-manager', 'scripts', 'client-draft.cjs');
  const args = [script, `--client=${path.basename(clientDir)}`, `--id=${id}`, '--json']; if (again) args.push('--again');
  const r = spawnSync(process.execPath, args, { cwd: BRAIN_ROOT, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) return { ok: false, error: String(r.stderr || r.stdout || '').trim().split('\n').pop() };
  try { return { ok: true, ...JSON.parse(String(r.stdout).trim().split('\n').pop()) }; } catch { return { ok: true, output: r.stdout }; }
}

// The client said yes: a human records who said it and how. gads-write needs this on file
// before it will apply a needs_client_approval proposal.
function recordClientApproval({ client, id, by, who, note }) {
  if (!by) throw new Error('no identity for this machine');
  const clientDir = clientDirFor(client); checkId(id);
  const p = P.recordClientApproval({ clientDir, id, by, who: String(who || '').slice(0, 200), note: String(note || '').slice(0, 1000) });
  return { ok: true, client_approved_by: p.fm.client_approved_by, client_approved_at: p.fm.client_approved_at };
}

// The reviewer signs off a month's client report: monthly.cjs writes the review stamp in their
// name and renders the final PDF. Who may sign is the script's rule (reviewer, owner, or the owner
// role); a month-to-date draft is refused there too.
function signMonthly({ client, id: month, by, note }) {
  if (!by) throw new Error('no identity for this machine; the Workbench cannot tell who you are');
  const clientDir = clientDirFor(client);
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw new Error('bad month');
  const management = P.loadManagement(clientDir);
  const r = MONTHLY.sign({ clientDir, month, by, note, management });
  return { ok: true, output: `Signed off as ${r.name}. Final PDF: ${r.pdf}. Attach it to the covering email draft when you send it.`, ...r };
}

// A decision-type proposal is "applied" when the human records what was decided.
function recordDecision({ client, id, by, text }) {
  const clientDir = clientDirFor(client); checkId(id);
  const p = P.read({ clientDir, id });
  if (p.fm.type !== 'decision') throw new Error('not a decision proposal');
  if (p.fm.status !== 'approved') throw new Error(`${id} is ${p.fm.status}; approve it first`);
  const outcome = String(text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 1000); if (!outcome) throw new Error('say what was decided');
  P.stamp({ clientDir, id }, { status: 'applied', applied_at: new Date().toISOString(), outcome: `Decision recorded by ${by}: ${outcome}` });
  return { ok: true };
}

// Attended apply and dry run, through the ads-manager apply wrapper (scripts/apply.cjs), which
// picks the executor from the operations file (gads-write for REST operations, update-rsa for RSA
// text), re-validates the approval, saves the dry run beside the proposal and, only with
// confirmed, runs the live write with the executor's read-back, log and stamp. Returns the
// wrapper's output; nothing here touches Google directly.
function apply({ client, id, confirmed }, cb) {
  const clientDir = clientDirFor(client); checkId(id);
  const p = P.read({ clientDir, id });
  if (p.fm.type !== 'change' || !p.fm.operations) return cb(null, { ok: false, output: `${id} has no operations file to apply` });
  if (confirmed && p.fm.status !== 'approved') return cb(null, { ok: false, output: `${id} is ${p.fm.status}; only an approved proposal can be applied` });
  const args = [path.join(BRAIN_ROOT, '.claude', 'skills', 'ads-manager', 'scripts', 'apply.cjs'), `--client=${client}`, `--id=${id}`];
  if (confirmed) args.push('--confirmed');
  const child = spawn('node', args, { cwd: BRAIN_ROOT, env: process.env });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => cb(null, { ok: code === 0, code, output: out.replace(/^proxy:.*\n/gm, '').slice(-6000) }));
  child.on('error', (e) => cb(e));
}

module.exports = { board, decide, recordDecision, apply, clientDraft, recordClientApproval, signMonthly };
