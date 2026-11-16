'use strict';
/**
 * common.cjs — shared plumbing for the weekly check analysts.
 * CSV reading, dates, money, the client context (management.json, serving scope, fetch
 * freshness), a GAQL runner, and the evidence writer. Analysts are deterministic: they
 * summarise, the model reasons. No raw rows leave here except as named top-N lists.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../../..');
const P = require('./proposals.cjs');

// ── CSV ──────────────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = []; let cur = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { cur.push(f); f = ''; }
    else if (c === '\n') { cur.push(f); rows.push(cur); cur = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || cur.length) { cur.push(f); rows.push(cur); }
  if (!rows.length) return [];
  const h = rows[0];
  return rows.slice(1).filter((r) => r.length > 1 || (r.length === 1 && r[0] !== '')).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}
function readCsv(dataDir, name) {
  const p = path.join(dataDir, name + '.csv');
  if (!fs.existsSync(p)) return null;
  return parseCsv(fs.readFileSync(p, 'utf8'));
}
const num = (v) => { const n = Number(String(v ?? '').replace(/[£,%]/g, '')); return isFinite(n) ? n : 0; };
const sum = (rows, k) => rows.reduce((a, r) => a + num(r[k]), 0);
const r1 = (n) => Math.round(n * 10) / 10;
const r0 = (n) => Math.round(n);
const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);
const gbp = (n) => (n === null || n === undefined || !isFinite(n)) ? 'n/a' : `£${Math.round(n).toLocaleString('en-GB')}`;
const gbp2 = (n) => (n === null || n === undefined || !isFinite(n)) ? 'n/a' : `£${n.toFixed(2)}`;
const pc = (n, d = 0) => (n === null || n === undefined || !isFinite(n)) ? 'n/a' : `${n > 0 ? '+' : ''}${n.toFixed(d)}%`;
const share = (n) => (n === null || !isFinite(n)) ? 'n/a' : `${n.toFixed(0)}%`;
const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); if (!a.length) return 0; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const cpa = (cost, conv) => (conv > 0 ? cost / conv : null);

// ── dates ────────────────────────────────────────────────────────────────────
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const parseYmd = (s) => new Date(s + 'T00:00:00Z');
function dateRange(toStr, days) { const to = parseYmd(toStr); return { from: ymd(addDays(to, -(days - 1))), to: toStr }; }
const inRange = (d, r) => d >= r.from && d <= r.to;
function monthOf(s) { return s.slice(0, 7); }
function daysInMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

// ── client context ───────────────────────────────────────────────────────────
function loadContext(clientArg, opts = {}) {
  const clientDir = opts.clientDir || P.resolveClientDir(clientArg, ROOT);
  if (!clientDir) throw new Error(`no client folder for "${clientArg}"`);
  const client = path.basename(clientDir);
  const dataDir = opts.dataDir || path.join(clientDir, 'data');
  const management = P.loadManagement(clientDir);
  if (!management) throw new Error(`${client} has no config/management.json; the weekly check needs it (see clients/urban-cooling/config/management.json for the shape)`);
  if (!management.confirmedBy) throw new Error(`${client}/config/management.json is not confirmed by a human (confirmedBy is null); refusing to analyse against unconfirmed targets`);

  let accounts = null;
  try { const A = require(path.join(ROOT, '.claude/skills/gads-proxy/scripts/lib/accounts.cjs')); const acc = A.loadAccountsFile(); accounts = acc && A.findAccount(acc.data, management.customerId || client); } catch { /* optional */ }
  let registry = null;
  try { const reg = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude/accounts.json'), 'utf8')); registry = Object.values(reg).find((a) => String(a.id || '').replace(/-/g, '') === String(management.customerId)) || null; } catch { /* optional */ }

  const fetchStatusPath = path.join(dataDir, '_fetch-status.json');
  const fetchStatus = fs.existsSync(fetchStatusPath) ? JSON.parse(fs.readFileSync(fetchStatusPath, 'utf8')) : null;

  const campSettings = readCsv(dataDir, 'campSettings') || [];
  const scopeMode = management.scope?.campaigns || 'serving';
  const serving = campSettings.filter((c) => c.status === 'ENABLED' && (scopeMode === 'all-enabled' || c.servingStatus === 'SERVING'));
  const exclusions = new Set(management.scope?.standingExclusions || []);
  const scope = serving.filter((c) => !exclusions.has(c.campaign));
  const byName = Object.fromEntries(campSettings.map((c) => [c.campaign, c]));

  const dailyPerf = readCsv(dataDir, 'dailyPerf') || [];
  const maxDate = dailyPerf.reduce((m, r) => (r.Date > m ? r.Date : m), '');
  const asOf = opts.asOf || maxDate; // last full day of data

  const month = monthOf(asOf);
  const mm = asOf.slice(5, 7);
  const t = management.targets || {};
  const targets = {
    month, mm,
    cpaGoogle: t.seasonalTargetCpaGoogleBasis?.[mm] ?? null,
    cplCrm: t.seasonalTargetCplCrmBasis?.[mm] ?? null,
    breakEvenGoogle: pickSeason(t.breakEvenCpaGoogleBasis, mm),
    scaleCeilingGoogle: t.scaleCeilingCpaGoogleBasis ?? null,
    crmPerGoogle: management.leadQuality?.expectedCrmPerGoogleConversion ?? (Number((String(t.basisRule || '').match(/Ratio\s+([\d.]+)/) || [])[1]) || null),
    crmRatioTolerancePct: Number(management.leadQuality?.ratioTolerancePct ?? 30),
    monthName: new Date(Date.UTC(2000, Number(mm) - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }),
    leadsTarget: t.volume?.crmLeadsPerMonthTarget ?? null,
  };
  // ROAS mode (targets.primaryKPI "roas", ecommerce and ticket sales). ROAS figures are ratios as
  // Google stores them (5 = 500%). Campaigns are judged on target ROAS ÷ actual ROAS, which sits on
  // the same scale as CPA ÷ target CPA (1 = on target, higher = worse), so the CPA tiers carry over.
  // Money floors (waste, zero-conversion spend) use the cost per sale the target allows: 30-day
  // value per conversion ÷ target ROAS.
  const kpi = String(t.primaryKPI || 'cpa').toLowerCase() === 'roas' ? 'roas' : 'cpa';
  if (kpi === 'roas') {
    targets.targetRoas = pickMonthOrSeason(t.targetRoas, mm);
    targets.breakEvenRoas = pickMonthOrSeason(t.breakEvenRoas, mm);
    targets.scaleFloorRoas = pickMonthOrSeason(t.scaleFloorRoas, mm);
    const names = new Set(scope.map((c) => c.campaign));
    const t30 = totals(perfBy(dailyPerf, dateRange(asOf, 30), names));
    targets.valuePerConv30 = t30.conv ? t30.value / t30.conv : null;
    targets.floorBase = targets.valuePerConv30 && targets.targetRoas ? targets.valuePerConv30 / targets.targetRoas : null;
  } else {
    targets.floorBase = targets.cpaGoogle;
  }
  return { ROOT, client, clientDir, dataDir, management, accounts, registry, fetchStatus, campSettings, serving, scope, exclusions, byName, dailyPerf, asOf, maxDate, targets, kpi,
    customerId: String(management.customerId || accounts?.id || ''), loginCustomerId: String(management.loginCustomerId || accounts?.login_customer_id || ''),
    live: opts.live !== false };
}
// A number, a month map {"11": 5}, or a season map {"sep-apr": 4}.
function pickMonthOrSeason(obj, mm) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'number') return obj;
  if (obj[mm] !== undefined) return Number(obj[mm]);
  return pickSeason(obj, mm);
}
function pickSeason(obj, mm) {
  if (!obj) return null;
  if (typeof obj === 'number') return obj;
  const m = Number(mm);
  for (const [k, v] of Object.entries(obj)) {
    const mt = k.match(/^([a-z]{3})-([a-z]{3})$/i);
    if (!mt) continue;
    const mons = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const a = mons.indexOf(mt[1].toLowerCase()) + 1, b = mons.indexOf(mt[2].toLowerCase()) + 1;
    const inside = a <= b ? (m >= a && m <= b) : (m >= a || m <= b);
    if (inside) return v;
  }
  return null;
}

// ── GAQL (reads only) ────────────────────────────────────────────────────────
async function gaql(ctx, query) {
  if (!ctx.live) return { skipped: true, rows: [] };
  const access = require(path.join(ROOT, '.claude/skills/gads-proxy/scripts/lib/gads-access.cjs'));
  const r = await access.runQuery({ customerId: ctx.customerId, query, loginCustomerId: ctx.loginCustomerId, method: 'auto' });
  return { rows: r.rows || [] };
}

// ── account changes ──────────────────────────────────────────────────────────
// Google's change history, not data/changeData.csv, which holds only a few recent rows. Leaves out
// CAMPAIGN_CRITERION (ClickCease adds and removes about 300 IP exclusions a day, confirmed by Pete
// 2 Nov 2026) and housekeeping fields. Without live access it falls back to the CSV and says so.
const HOUSEKEEPING = /^(budgetNetworkSettings\.settings|trackingUrlTemplate|finalUrlSuffix|name|id|resourceName)$/;
async function recentChanges(ctx, days) {
  const from = dateRange(ctx.asOf, days).from;
  if (ctx.live) {
    const q = await gaql(ctx, `SELECT change_event.change_date_time, change_event.user_email, change_event.change_resource_type, change_event.resource_change_operation, change_event.changed_fields, campaign.name FROM change_event WHERE change_event.change_date_time >= '${from}' AND change_event.change_date_time <= '${ymd(addDays(parseYmd(ctx.asOf), 1))} 23:59:59' AND change_event.change_resource_type NOT IN ('CAMPAIGN_CRITERION') ORDER BY change_event.change_date_time DESC LIMIT 10000`);
    const rows = (q.rows || []).map((r) => { const c = r.changeEvent; return { when: String(c.changeDateTime).slice(0, 16), who: String(c.userEmail || '').split('@')[0], campaign: r.campaign?.name || '', type: c.changeResourceType, op: c.resourceChangeOperation, fields: String(c.changedFields || '').split(',').map((x) => x.trim()).filter(Boolean) }; });
    return { source: 'change history', rows: rows.filter((r) => !r.fields.length || r.fields.some((x) => !HOUSEKEEPING.test(x))) };
  }
  const csv = readCsv(ctx.dataDir, 'changeData') || [];
  return { source: 'changeData.csv (partial)', rows: csv.filter((c) => c['Change Time'] >= from).map((c) => ({ when: c['Change Time'].slice(0, 16), who: String(c['User Email'] || '').split('@')[0], campaign: c.Campaign, type: c['Resource Type'], op: c.Operation, fields: String(c['Changed Fields'] || '').split(',').map((x) => x.trim()).filter(Boolean) })).filter((r) => !r.fields.length || r.fields.some((x) => !HOUSEKEEPING.test(x))) };
}

// Google's LIMITED status alone does not make budget the problem: Without External Unit was LIMITED
// while losing 4% to budget and 44% to rank. Search needs a real lost-to-budget share. PMax reports
// no impression share (zeros in the feed), so its status stands.
function budgetLimit(ctx, c) {
  if (!ctx._diag) { const d = readCsv(ctx.dataDir, 'diagnostic') || []; const w = d.reduce((m, r) => (r.week > m ? r.week : m), ''); ctx._diag = Object.fromEntries(d.filter((r) => r.week === w).map((r) => [r.campaign_name, r])); }
  const reported = c.primaryStatus === 'LIMITED' && /BUDGET_CONSTRAINED/.test(c.statusReasons || '');
  const i = ctx._diag[c.campaign]; const min = Number(ctx.management.budget?.minLostBudgetPct ?? 10);
  if (!reported || c.channel === 'PERFORMANCE_MAX' || !i) return { reported, limited: reported, lostBudget: null, lostRank: null };
  const lostBudget = r0(num(i.is_budget_lost) * 100), lostRank = r0(num(i.is_rank_lost) * 100);
  return { reported, limited: lostBudget >= min, lostBudget, lostRank };
}

// Campaigns a human has already decided to hold. The date comes from the recorded decision ("to
// 9 Nov"). On the pack where it falls due the hold stops, so the campaign is raised again.
function activeDecisions(ctx) {
  const P = require('./proposals.cjs'); const out = {};
  const packDate = ymd(addDays(parseYmd(ctx.asOf), 1));
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  for (const p of P.list({ clientDir: ctx.clientDir })) {
    if (p.fm.type !== 'decision' || !['approved', 'applied'].includes(p.fm.status)) continue;
    const m = String(p.fm.outcome || '').match(/\bto (\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?: (\d{4}))?/i); if (!m) continue;
    const until = `${m[3] || String(p.fm.approved_at || p.fm.created_at).slice(0, 4)}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (until <= packDate) continue;
    for (const c of p.fm.campaigns || []) out[c] = { id: p.id, until };
  }
  return out;
}

// ── findings and evidence ────────────────────────────────────────────────────
// severity: info (context) · watch (named, no action) · act (an "act when" trigger fired)
function finding(section, severity, title, detail, extra = {}) {
  return { section, severity, title, detail, ...extra };
}
function evidenceDir(ctx, date) {
  const d = path.join(ctx.clientDir, 'proposals', 'evidence', date.replace(/-/g, ''));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function writeEvidence(ctx, date, name, obj) {
  const f = path.join(evidenceDir(ctx, date), name + '.json');
  fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n');
  return path.relative(ctx.clientDir, f);
}
function snapshotPath(ctx, name) {
  const d = path.join(ctx.clientDir, 'proposals', 'evidence', 'snapshots');
  fs.mkdirSync(d, { recursive: true });
  return path.join(d, name + '.json');
}

// Per-campaign aggregates from dailyPerf over a range, restricted to a set of campaign names.
// CRM leads that are Google's. The dashboard's service line `ppc-google` also holds "Bing Ads"
// (os/dashboard/service-lines.json), so sum the exact labels from management.leadQuality.googleAdsValues
// instead. Month-to-date by label is not in leads-30d.json; take it from the lead-source summary
// behind reports/leads/ (refreshed daily) when present, else scale the line by the label share.
function crmGoogleLeads(ctx, leads) {
  const labels = ctx.management.leadQuality?.googleAdsValues || ['Google Ads'];
  const byLabel = leads.byLabel || null;
  const line = leads.byLine?.['ppc-google'] ?? null;
  const last30 = byLabel ? labels.reduce((a, l) => a + Number(byLabel[l] || 0), 0) : line;
  let mtd = null; const month = (leads.monthToDate?.month) || null;
  try {
    const sum = JSON.parse(require('fs').readFileSync(require('path').join(ctx.clientDir, 'reports/leads/data/summary.json'), 'utf8'));
    const mi = sum.m.indexOf(month);
    if (mi >= 0) { mtd = 0; for (const [m, si, , n] of sum.L) if (m === mi && labels.includes(sum.s[si])) mtd += n; }
  } catch { /* no summary */ }
  if (mtd === null) { const mline = leads.monthToDate?.byLine?.['ppc-google'] ?? null; mtd = mline !== null && line ? Math.round(mline * (last30 / line)) : mline; }
  return { last30, mtd, source: byLabel ? `labels ${labels.join('+')}` : 'service line ppc-google (labels unavailable)' };
}

function perfBy(dailyPerf, range, names) {
  const out = {};
  for (const r of dailyPerf) {
    if (!inRange(r.Date, range)) continue;
    if (names && !names.has(r.Campaign)) continue;
    const o = out[r.Campaign] || (out[r.Campaign] = { impr: 0, clicks: 0, cost: 0, conv: 0, value: 0, days: new Set() });
    o.impr += num(r.Impressions); o.clicks += num(r.Clicks); o.cost += num(r.Cost); o.conv += num(r.Conversions); o.value += num(r.ConvValue); o.days.add(r.Date);
  }
  for (const o of Object.values(out)) { o.days = o.days.size; o.cpa = cpa(o.cost, o.conv); o.ctr = o.impr ? (o.clicks / o.impr) * 100 : 0; o.cpc = o.clicks ? o.cost / o.clicks : 0; o.cvr = o.clicks ? (o.conv / o.clicks) * 100 : 0; }
  return out;
}
function totals(perf) {
  const t = { impr: 0, clicks: 0, cost: 0, conv: 0, value: 0 };
  for (const o of Object.values(perf)) { t.impr += o.impr; t.clicks += o.clicks; t.cost += o.cost; t.conv += o.conv; t.value += o.value; }
  t.cpa = cpa(t.cost, t.conv); t.ctr = t.impr ? (t.clicks / t.impr) * 100 : 0; t.cpc = t.clicks ? t.cost / t.clicks : 0; t.cvr = t.clicks ? (t.conv / t.clicks) * 100 : 0;
  return t;
}
// Digest §2 tiers on 30-day CPA ÷ target.
function cpaTier(cpaV, target, conv, cost) {
  if (!target) return { tier: 'no-target', ratio: null };
  if (conv === 0) return (cost >= 2 * target) ? { tier: 'severe', ratio: null, zeroConv: true } : { tier: 'thin', ratio: null };
  const ratio = cpaV / target;
  const tier = ratio <= 1 ? 'on target' : ratio <= 1.5 ? 'watch' : ratio <= 2.5 ? 'material' : 'severe';
  return { tier, ratio: r1(ratio * 100) / 100, provisional: conv < 5 };
}
// ── KPI-aware helpers (CPA or ROAS mode) ─────────────────────────────────────
const roasOf = (o) => (o && o.cost > 0 ? (o.value || 0) / o.cost : null);
const fmtRoas = (x) => (x === null || x === undefined || !isFinite(x)) ? 'n/a' : `${Math.round(x * 100)}%`;
// The month's target in words: "CPA £42" or "ROAS 500%".
function targetLabel(ctx, override) {
  if (ctx.kpi === 'roas') return `ROAS ${fmtRoas(override ?? ctx.targets.targetRoas)}`;
  return `CPA ${gbp(override ?? ctx.targets.cpaGoogle)}`;
}
// One performance figure in words: "CPA £72" or "ROAS 320%".
function kpiText(ctx, o) {
  if (ctx.kpi === 'roas') return `ROAS ${fmtRoas(roasOf(o))}`;
  return `CPA ${gbp(o.cpa ?? cpa(o.cost, o.conv))}`;
}
// How far off target, as a "badness" ratio: 1 = on target, 2 = twice as bad. CPA: actual ÷ target.
// ROAS: target ÷ actual. null when there is no target or nothing to judge; Infinity for cost with no value.
function gap(ctx, o, target) {
  if (ctx.kpi === 'roas') { const tr = target ?? ctx.targets.targetRoas; if (!tr || !o || !o.cost) return null; const r = roasOf(o); return r > 0 ? tr / r : Infinity; }
  const tc = target ?? ctx.targets.cpaGoogle; const c = o ? (o.cpa ?? cpa(o.cost, o.conv)) : null; if (!tc || !o || !o.cost) return null; return c === null ? Infinity : c / tc;
}
// Digest §2 tiers in either mode. In ROAS mode "no conversions" means no conversion value.
function effTier(ctx, o, target) {
  if (ctx.kpi !== 'roas') return cpaTier(o.cpa ?? cpa(o.cost, o.conv), target ?? ctx.targets.cpaGoogle, o.conv, o.cost);
  const tr = target ?? ctx.targets.targetRoas; if (!tr) return { tier: 'no-target', ratio: null };
  const base = ctx.targets.floorBase;
  if (!o.value) return (base && o.cost >= 2 * base) ? { tier: 'severe', ratio: null, zeroConv: true } : { tier: 'thin', ratio: null };
  const ratio = tr / roasOf(o);
  const tier = ratio <= 1 ? 'on target' : ratio <= 1.5 ? 'watch' : ratio <= 2.5 ? 'material' : 'severe';
  return { tier, ratio: Math.round(ratio * 100) / 100, provisional: o.conv < 5 };
}
// The money floor sentence: "2× the November target of £42" or "2× £18, the cost per sale a 500% ROAS allows".
function floorText(ctx, mult = 2) {
  const b = ctx.targets.floorBase;
  if (ctx.kpi === 'roas') return `${mult}× ${gbp(b)}, the cost per sale a ${fmtRoas(ctx.targets.targetRoas)} ROAS allows at ${gbp(ctx.targets.valuePerConv30)} per conversion`;
  return `${mult}× the ${ctx.targets.monthName} target of ${gbp(b)}`;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

module.exports = { ROOT, crmGoogleLeads, pickMonthOrSeason, roasOf, fmtRoas, targetLabel, kpiText, gap, effTier, floorText, parseCsv, readCsv, num, sum, r1, r0, pct, gbp, gbp2, pc, share, median, cpa, ymd, addDays, parseYmd, dateRange, inRange, monthOf, daysInMonth,
  loadContext, gaql, recentChanges, budgetLimit, activeDecisions, finding, evidenceDir, writeEvidence, snapshotPath, perfBy, totals, cpaTier, slug };
