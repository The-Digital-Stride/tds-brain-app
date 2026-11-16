#!/usr/bin/env node
'use strict';
/**
 * monthly.cjs — the monthly close and the client report (plan items 3.1 and 3.2).
 *
 *   node monthly.cjs --client=<slug> [--month=YYYY-MM] [--no-pdf] [--no-refresh] [--force] [--json]   the close
 *   node monthly.cjs render --client=<slug> [--month=YYYY-MM]      rebuild the PDF from the body
 *   node monthly.cjs sign --client=<slug> --month=YYYY-MM --as=<slug> [--note=...]
 *   node monthly.cjs status --client=<slug> [--month=YYYY-MM] [--json]
 *
 * Default month: the previous calendar month (the launchd job runs on the 3rd). For the current
 * month it produces a month-to-date DRAFT. Writes, under clients/<c>/reports/monthly/:
 *   <YYYY-MM>-monthly-close.md          internal close: month vs previous month vs targets, Google
 *                                       vs CRM reconciliation, campaign table, changes made,
 *                                       weekly packs, next month's targets to re-confirm
 *   <Client>-Google-Ads-Report-<YYYY-MM>.body.html     the report body (the narrative is edited here)
 *   <Client>-Google-Ads-Report-<YYYY-MM>-DRAFT.pdf     watermarked draft, built by every run
 *   <Client>-Google-Ads-Report-<YYYY-MM>.pdf           the FINAL, built only by `sign`
 *   <YYYY-MM>-review.json               the review stamp: reviewed_by, reviewed_at, body_hash
 *   <YYYY-MM>-email-draft.md            the covering email, for a human to send
 *
 * The review gate (same rule as the audit skills' draft → reviewed_by → render): the final PDF
 * exists only after a human on .team-config/roles.json who is this client's reviewer or owner (or
 * an owner of the brain) runs `sign` with their own name. `sign` refuses a month-to-date draft and
 * records a hash of the body it signed; `render` after `sign` rebuilds the final only while the
 * body still matches that hash, otherwise it falls back to a draft and says the sign-off is void.
 * Claude never runs `sign`: the reviewer runs it, or clicks "Sign off" on the Workbench.
 * A re-run of the close refuses to overwrite a hand-edited body or a signed month without --force.
 *
 * Nothing here sends anything. Read-only on Google Ads and the CRM. Before it builds, it refreshes
 * the CRM feed (reports/leads/refresh.cjs, skip with --no-refresh) and re-reads each month's spend
 * and conversions live, so late conversions and re-classified leads are counted. If either fails it
 * uses the last good data and says so in the close. Account changes come from Google's change
 * history, which only goes back 30 days, so a close run later than that cannot list them all.
 * Every £ figure names its basis.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('./lib/common.cjs');
const P = require('./lib/proposals.cjs');

const argv = process.argv.slice(2);
const CMD = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'close';
const arg = (n, d) => { const a = argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const has = (n) => argv.includes(`--${n}`);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const prevMonth = (ym) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1)); return d.toISOString().slice(0, 7); };
const nextMonth = (ym) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 1)); return d.toISOString().slice(0, 7); };
const lastYear = (ym) => `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;
// "an 800%", "an 11%", "a 500%": the article for a ROAS figure as it is read aloud.
const anRoas = (v) => { const t = C.fmtRoas(v); return `${/^(8|1[18]%|1[18]\d%)/.test(t) ? 'an' : 'a'} ${t}`; };
const pct = (a, b) => (b ? `${a - b >= 0 ? '+' : ''}${Math.round((a - b) / b * 100)}%` : 'n/a');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&rsquo;').replace(/—/g, '&mdash;');
const slugName = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const crypto = require('crypto');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const DRAFT_MARK = '<span class="draftmark">DRAFT, not reviewed &middot; </span>';
const KICKER_MARK = '<span class="draftmark pill soft">Draft, not reviewed</span>';
const MARK_RE = /<span class="draftmark[^"]*">[^<]*<\/span>/g;

// The files for one client month. `stem` needs the client's display name, read from the close
// JSON when there is one (so render/sign never need the live context).
function monthFiles(clientDir, month, clientName) {
  const repDir = path.join(clientDir, 'reports/monthly');
  let name = clientName;
  if (!name) { try { name = JSON.parse(fs.readFileSync(path.join(repDir, `${month}-monthly-close.json`), 'utf8')).name; } catch { /* none */ } }
  if (!name) throw new Error(`no close for ${month} in ${path.relative(C.ROOT, repDir)}; run the close first`);
  const stem = `${String(name).replace(/[^A-Za-z0-9]+/g, '-')}-Google-Ads-Report-${month}`;
  return { repDir, stem, name, json: path.join(repDir, `${month}-monthly-close.json`), close: path.join(repDir, `${month}-monthly-close.md`), body: path.join(repDir, `${stem}.body.html`), draftHtml: path.join(repDir, `${stem}-DRAFT.html`), draftPdf: path.join(repDir, `${stem}-DRAFT.pdf`), finalHtml: path.join(repDir, `${stem}.html`), finalPdf: path.join(repDir, `${stem}.pdf`), review: path.join(repDir, `${month}-review.json`), email: path.join(repDir, `${month}-email-draft.md`) };
}
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const rel = (p) => path.relative(C.ROOT, p);

// Who may sign this client's report: the management.json reviewer or owner, or an owner of the
// brain. Same rule as proposals.cjs mayDecide.
function signer(by, management) {
  const m = P.findMember(by);
  if (!m) throw new Error(`"${by}" is not a member in .team-config/roles.json; only a human on the roster can sign off a report`);
  const people = (management && management.people) || {};
  if (!(m.slug === people.reviewer || m.slug === people.owner || m.role === 'owner')) throw new Error(`${m.name} is neither the reviewer (${people.reviewer}) nor the owner (${people.owner}) of this client`);
  return m;
}

// The gate. A valid review = a stamp naming a roster member whose body_hash matches the body now.
function reviewState(F) {
  const rv = readJson(F.review); if (!rv) return { signed: false, reason: 'no review stamp' };
  const m = rv.reviewed_by ? P.findMember(rv.reviewed_by) : null;
  if (!m) return { signed: false, stale: true, reason: `reviewed_by "${rv.reviewed_by}" is not a member in .team-config/roles.json` };
  if (!fs.existsSync(F.body)) return { signed: false, stale: true, reason: 'report body missing' };
  if (sha(fs.readFileSync(F.body, 'utf8')) !== rv.body_hash) return { signed: false, stale: true, reason: `the report body changed after ${m.name} signed it on ${String(rv.reviewed_at).slice(0, 10)}; sign again`, review: rv };
  return { signed: true, by: m.name, slug: m.slug, at: rv.reviewed_at, note: rv.note || '', review: rv };
}

// Build the PDF from the body on disk: the FINAL (draft marks stripped) when the review stamp is
// valid, otherwise the watermarked DRAFT. Removes whichever of the two no longer applies, so a
// folder never offers a final PDF that was not signed.
function renderPdf(F, title) {
  if (!fs.existsSync(F.body)) throw new Error(`no report body at ${rel(F.body)}`);
  const st = reviewState(F);
  const body = fs.readFileSync(F.body, 'utf8');
  const build = (src, outHtml) => { fs.writeFileSync(outHtml.replace(/\.html$/, '.build.html'), src); execFileSync('node', [path.join(C.ROOT, 'templates/tds-doc-system/build.cjs'), outHtml.replace(/\.html$/, '.build.html'), outHtml, title], { stdio: 'pipe', encoding: 'utf8' }); fs.rmSync(outHtml.replace(/\.html$/, '.build.html'), { force: true }); return fs.existsSync(outHtml.replace(/\.html$/, '.pdf')); };
  const rmAll = (...ps) => ps.forEach((p) => fs.rmSync(p, { force: true }));
  if (st.signed) {
    const ok = build(body.replace(MARK_RE, ''), F.finalHtml);
    if (ok) rmAll(F.draftHtml, F.draftPdf);
    return { ...st, final: ok, pdf: ok ? F.finalPdf : null };
  }
  const ok = build(new RegExp(MARK_RE.source).test(body) ? body : body.replace(/<div class="meta">/g, `<div class="meta">${DRAFT_MARK}`), F.draftHtml);
  rmAll(F.finalHtml, F.finalPdf);
  return { ...st, final: false, pdf: ok ? F.draftPdf : null };
}

// What the Workbench and `status` show: one object per month on disk.
function monthStatus(clientDir, month) {
  const F = monthFiles(clientDir, month); const j = readJson(F.json); const st = reviewState(F);
  return { month, monthName: j ? j.monthName : monthName(month), partial: j ? !!j.partial : null, dataTo: j ? j.dataTo : null, generatedAt: j ? j.generatedAt : null, signed: st.signed, stale: !!st.stale, reason: st.reason || null, reviewedBy: st.signed ? st.by : null, reviewedAt: st.signed ? st.at : null, note: st.signed ? st.note : null, files: { close: fs.existsSync(F.close) ? rel(F.close) : null, body: fs.existsSync(F.body) ? rel(F.body) : null, draftPdf: fs.existsSync(F.draftPdf) ? rel(F.draftPdf) : null, pdf: fs.existsSync(F.finalPdf) ? rel(F.finalPdf) : null, email: fs.existsSync(F.email) ? rel(F.email) : null, review: fs.existsSync(F.review) ? rel(F.review) : null } };
}

// `sign`: the human review stamp. Refuses a month-to-date draft, refuses anyone not allowed to
// sign this client, then renders the final PDF and points the email draft at it.
function sign({ clientDir, month, by, note, management }) {
  const F = monthFiles(clientDir, month); const j = readJson(F.json);
  if (!j) throw new Error(`no close for ${month}; run the close first`);
  if (j.partial) throw new Error(`${j.monthName} is a month-to-date draft (data to ${j.dataTo}); a partial month cannot be signed off as final`);
  if (!fs.existsSync(F.body)) throw new Error(`no report body at ${rel(F.body)}`);
  const m = signer(by, management);
  const rv = { reviewed_by: m.slug, reviewed_by_name: m.name, reviewed_at: new Date().toISOString(), month, body_hash: sha(fs.readFileSync(F.body, 'utf8')), note: String(note || '').slice(0, 1000), _note: 'Written by monthly.cjs sign, run by the person named. Never written by Claude. The final PDF renders only while body_hash matches the report body.' };
  fs.writeFileSync(F.review, JSON.stringify(rv, null, 2) + '\n');
  const r = renderPdf(F, `Google Ads monthly report, ${j.monthName}`);
  if (!r.final) { fs.rmSync(F.review, { force: true }); throw new Error('the final PDF did not build; the sign-off was not recorded'); }
  j.review = { reviewed_by: m.slug, reviewed_at: rv.reviewed_at }; j.files = { ...(j.files || {}), pdf: rel(F.finalPdf), draftPdf: null, review: rel(F.review) };
  fs.writeFileSync(F.json, JSON.stringify(j, null, 2));
  try { if (fs.existsSync(F.email)) fs.writeFileSync(F.email, fs.readFileSync(F.email, 'utf8').replace(/^\*\*Attach:\*\* .*$/m, `**Attach:** ${rel(F.finalPdf)}`)); } catch { /* leave the email as is */ }
  return { ok: true, reviewed_by: m.slug, name: m.name, reviewed_at: rv.reviewed_at, pdf: rel(F.finalPdf) };
}

// Campaign names contain " | ", which also splits a Markdown table's columns.
const cell = (t) => String(t).replace(/\s*\|\s*/g, ' · ');
const shortDate = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}`;
// "UC | SE | tCPA | LDN | Competitor Campaign" -> "Competitor Campaign"; "UC | London | Enquire | PMax | Mar 24" -> "London Enquire PMax".
const shortCampaign = (n) => { const p = String(n).split('|').map((x) => x.trim()).filter((x) => !/^UCN?$/.test(x) && !/^(Restarted )?[A-Z][a-z]{2} \d{2}$/.test(x)); return p.includes('PMax') ? p.join(' ') : p[p.length - 1]; };
const micros = (v) => (v === undefined || v === null ? null : Number(v) / 1e6);

// One row of Google's change history -> a category a person would recognise, or null for
// housekeeping nobody needs told about (tracking templates, renames, network settings).
function classifyChange(r) {
  const c = r.changeEvent || {}; const type = c.changeResourceType; const fields = String(c.changedFields || '').split(',').map((x) => x.trim()).filter(Boolean);
  const creating = c.resourceChangeOperation === 'CREATE';
  const old = c.oldResource || {}, now = c.newResource || {};
  const has = (re) => fields.some((x) => re.test(x));
  if (type === 'CAMPAIGN_BUDGET') return has(/amountMicros/) ? { cat: 'budget', from: micros(old.campaignBudget?.amountMicros), to: micros(now.campaignBudget?.amountMicros) } : null;
  if (type === 'CAMPAIGN') {
    if (has(/targetCpaMicros/)) { const pick = (o) => o.campaign?.maximizeConversions?.targetCpaMicros ?? o.campaign?.targetCpa?.targetCpaMicros; return { cat: 'target', from: micros(pick(old)), to: micros(pick(now)) }; }
    if (has(/cpcBidCeilingMicros/)) return { cat: 'cpc', from: micros(old.campaign?.targetSpend?.cpcBidCeilingMicros), to: micros(now.campaign?.targetSpend?.cpcBidCeilingMicros) };
    if (has(/^status$/)) return { cat: now.campaign?.status === 'PAUSED' ? 'paused' : 'enabled' };
    if (has(/targetRoas/)) { const pick = (o) => o.campaign?.maximizeConversionValue?.targetRoas ?? o.campaign?.targetRoas?.targetRoas; const a = pick(old), b = pick(now); return { cat: 'roasTarget', from: a == null ? null : Number(a), to: b == null ? null : Number(b), roas: true }; }
    if (has(/bidding|maximize|targetSpend/i)) return { cat: 'bidding' };
    return null;
  }
  if (type === 'AD' || type === 'AD_GROUP_AD') return has(/responsiveSearchAd|^ad$|^status$|finalUrls/) ? { cat: 'ads' } : null;
  if (type === 'AD_GROUP') return creating || has(/^status$/) ? { cat: 'adGroups' } : null;
  if (type === 'AD_GROUP_CRITERION') return { cat: 'keywords' };
  if (type === 'ASSET') return has(/sitelinkAsset|calloutAsset|priceAsset|structuredSnippetAsset/) ? { cat: 'assets' } : null;
  return null;
}
const CHANGE_WORDS = { roasTarget: 'return-on-ad-spend targets', target: 'cost-per-conversion targets', budget: 'daily budgets', cpc: 'maximum cost-per-click limits', paused: 'which campaigns run', enabled: 'which campaigns run', bidding: 'bidding', ads: 'ad copy', adGroups: 'ad groups', keywords: 'keywords', assets: 'sitelinks, callouts and prices' };

// Group the rows into one line per day and kind of change. nameOf tidies a campaign name.
function groupChanges(rows, nameOf) {
  const groups = new Map();
  for (const r of [...rows].sort((a, b) => String(a.changeEvent.changeDateTime).localeCompare(String(b.changeEvent.changeDateTime)))) {
    const k = classifyChange(r); if (!k) continue;
    const date = String(r.changeEvent.changeDateTime).slice(0, 10); const key = `${date}|${k.cat}`;
    const g = groups.get(key) || { date, cat: k.cat, roas: !!k.roas, campaigns: new Map() }; groups.set(key, g);
    const name = r.campaign?.name ? nameOf(r.campaign.name) : ''; const e = g.campaigns.get(name) || { from: k.from, to: k.to }; e.to = k.to; g.campaigns.set(name, e);
  }
  let roasFmt = false; const money = (v) => (roasFmt ? C.fmtRoas(v) : C.gbp(v));
  const moved = (e) => (e.from != null && e.to != null ? ` from ${money(e.from)} to ${money(e.to)}` : '');
  const names = (g) => [...g.campaigns.keys()].filter(Boolean);
  // A budget row can carry no campaign name (a new or shared budget): never say "0 campaigns".
  const on = (g) => { const n = names(g); return n.length === 1 ? n[0] : n.length ? `${n.length} campaigns` : 'a campaign'; };
  const say = (g) => {
    roasFmt = g.roas; const one = g.campaigns.size === 1 ? [...g.campaigns.values()][0] : null;
    const v = {
      roasTarget: `Changed the target return on ad spend on ${on(g)}${one ? moved(one) : ''}`,
      target: `Changed the cost-per-conversion target on ${on(g)}${one ? moved(one) : ''}`,
      budget: `Changed the daily budget on ${on(g)}${one ? moved(one) : ''}`,
      cpc: `Changed the maximum cost per click on ${on(g)}${one ? moved(one) : ''}`,
      paused: `Paused ${on(g)}`, enabled: `Turned ${on(g)} back on`, bidding: `Changed the bidding on ${on(g)}`,
      ads: `Updated ads on ${on(g)}`, adGroups: `Changed ad groups on ${on(g)}`, keywords: `Changed keywords on ${on(g)}`,
      assets: 'Updated sitelinks, callouts or prices',
    };
    return v[g.cat];
  };
  return [...groups.values()].map((g) => ({ date: g.date, cat: g.cat, text: say(g), campaigns: names(g), detail: [...g.campaigns.entries()].filter(([n]) => n).map(([n, e]) => { roasFmt = g.roas; return `${n}${moved(e)}`; }) }));
}

function crmMonth(summary, ym, pm) {
  if (!summary) return null;
  const mi = summary.m.indexOf(ym); if (mi < 0) return null;
  const premium = new Set(pm?.premiumTypes || []), house = new Set(pm?.houseTypes || []);
  const o = { google: 0, all: 0, unattributed: 0, googlePremium: 0, googleHouse: 0, googleRecorded: 0, bySource: {} };
  for (const [m, si, pi, n] of summary.L) {
    if (m !== mi) continue; const src = summary.s[si], prop = summary.p[pi];
    o.all += n; o.bySource[src] = (o.bySource[src] || 0) + n;
    if (src === 'Not recorded' || src === 'Unknown') o.unattributed += n;
    if (src === 'Google Ads') { o.google += n; if (prop !== 'Not recorded') { o.googleRecorded += n; if (premium.has(prop)) o.googlePremium += n; else if (house.has(prop)) o.googleHouse += n; } }
  }
  return o;
}

async function main() {
  const client = arg('client'); if (!client) { console.error('usage: monthly.cjs [render|sign|status] --client=<slug> [--month=YYYY-MM] [--no-pdf] [--force] [--as=<slug>] [--note=...] [--json]'); process.exit(1); }
  const today = new Date().toISOString().slice(0, 10);
  const month = arg('month', prevMonth(today.slice(0, 7)));
  if (!/^\d{4}-\d{2}$/.test(month)) { console.error(`bad --month ${month}; use YYYY-MM`); process.exit(1); }
  if (CMD !== 'close') {
    const clientDir = P.resolveClientDir(client); const management = P.loadManagement(clientDir);
    if (CMD === 'status') { const st = monthStatus(clientDir, month); if (has('json')) console.log(JSON.stringify(st, null, 2)); else console.log(`${st.monthName}: ${st.partial ? 'month-to-date draft' : 'full month'} · ${st.signed ? `signed off by ${st.reviewedBy} ${String(st.reviewedAt).slice(0, 10)}` : `not signed off (${st.reason})`}${st.files.pdf ? ` · final ${st.files.pdf}` : st.files.draftPdf ? ` · draft ${st.files.draftPdf}` : ''}`); return; }
    if (CMD === 'render') { const F = monthFiles(clientDir, month); const j = readJson(F.json); const r = renderPdf(F, `Google Ads monthly report, ${j ? j.monthName : monthName(month)}`); if (j) { j.files = { ...(j.files || {}), pdf: r.final ? rel(F.finalPdf) : null, draftPdf: r.final ? null : (r.pdf ? rel(F.draftPdf) : null) }; if (!r.final) delete j.review; fs.writeFileSync(F.json, JSON.stringify(j, null, 2)); } console.log(r.final ? `final PDF ${rel(F.finalPdf)} (signed off by ${r.by} ${String(r.at).slice(0, 10)})` : `draft PDF ${r.pdf ? rel(r.pdf) : 'not built'}${r.stale ? ` · sign-off void: ${r.reason}` : ''}`); return; }
    if (CMD === 'sign') { const by = arg('as'); if (!by) { console.error('sign needs --as=<your slug>; the person signing runs this themselves'); process.exit(1); } const r = sign({ clientDir, month, by, note: arg('note', ''), management }); console.log(has('json') ? JSON.stringify(r) : `signed off ${client} ${month} as ${r.name}; final PDF ${r.pdf}`); return; }
    console.error(`unknown command ${CMD}`); process.exit(1);
  }
  // --client-dir points the close at a copy of a client folder (testing); default is clients/<client>.
  const ctx = C.loadContext(client, { live: false, clientDir: arg('client-dir') || undefined });
  // Refuse to wipe a reviewer's work: a signed month, or a body someone edited after the machine
  // wrote it (its hash no longer matches the one recorded in the close JSON).
  {
    const repDir0 = path.join(ctx.clientDir, 'reports/monthly'); const j0 = readJson(path.join(repDir0, `${month}-monthly-close.json`));
    if (j0 && !has('force')) {
      const F0 = monthFiles(ctx.clientDir, month, j0.name); const st0 = reviewState(F0);
      if (st0.signed) { console.error(`${j0.monthName} was signed off by ${st0.by} on ${String(st0.at).slice(0, 10)}. Re-running the close would void that. Use --force if you mean it.`); process.exit(2); }
      if (j0.bodyHash && fs.existsSync(F0.body) && sha(fs.readFileSync(F0.body, 'utf8')) !== j0.bodyHash) { console.error(`${rel(F0.body)} was edited after the machine wrote it (the narrative, most likely). Re-running the close would overwrite it. Use --force if you mean it, or \`monthly.cjs render\` to rebuild the PDF from the edited body.`); process.exit(2); }
    }
  }
  const m = ctx.management; const t = m.targets || {}; const mm = month.slice(5, 7);
  const daysIn = C.daysInMonth(month);
  const monthEnd = `${month}-${String(daysIn).padStart(2, '0')}`;
  const isPartial = ctx.maxDate < monthEnd;
  const to = isPartial ? ctx.maxDate : monthEnd;
  const range = { from: `${month}-01`, to };
  const pm = prevMonth(month); const pmRange = { from: `${pm}-01`, to: `${pm}-${String(C.daysInMonth(pm)).padStart(2, '0')}` };
  const perf = C.perfBy(ctx.dailyPerf, range); const perfPrev = C.perfBy(ctx.dailyPerf, pmRange);
  // Google keeps adding late conversions to a closed month, and the daily file is from 05:00. Use
  // the account's own figures for both months; the daily file is the fallback.
  const access = require(path.join(C.ROOT, '.claude/skills/gads-proxy/scripts/lib/gads-access.cjs'));
  const googleLive = { ok: true };
  for (const [p, r] of [[perf, range], [perfPrev, pmRange]]) {
    try {
      const q = await access.runQuery({ customerId: ctx.customerId, loginCustomerId: ctx.loginCustomerId, method: 'auto', query: `SELECT campaign.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${r.from}' AND '${r.to}' AND metrics.cost_micros > 0` });
      for (const row of q.rows || []) { const o = p[row.campaign.name] || (p[row.campaign.name] = { impr: 0, clicks: 0, value: 0 }); o.cost = Number(row.metrics.costMicros) / 1e6; o.conv = Number(row.metrics.conversions); o.value = Number(row.metrics.conversionsValue || 0); o.cpa = C.cpa(o.cost, o.conv); }
    } catch (e) { googleLive.ok = false; googleLive.error = String(e.message).slice(0, 200); }
  }
  const tot = C.totals(perf); const totPrev = C.totals(perfPrev);
  const dailyPerfFrom = ctx.dailyPerf.reduce((a, r) => (r.Date < a ? r.Date : a), '9999');
  const targets = { cpaGoogle: t.seasonalTargetCpaGoogleBasis?.[mm] ?? null, cplCrm: t.seasonalTargetCplCrmBasis?.[mm] ?? null, leads: t.volume?.crmLeadsPerMonthTarget ?? null, breakEven: ctx.targets.breakEvenGoogle, ratio: m.leadQuality?.expectedCrmPerGoogleConversion ?? null };
  // ROAS mode (ecommerce, ticket sales): judged on conversion value / cost, not CPA or CRM leads.
  const roasMode = ctx.kpi === 'roas';
  if (roasMode) Object.assign(targets, { roas: C.pickMonthOrSeason(t.targetRoas, mm), breakEvenRoas: C.pickMonthOrSeason(t.breakEvenRoas, mm), budget: m.budget?.monthlyBudget ?? null });
  const roasCaveat = m.reporting?.roasCaveat || '';
  // Client-facing wording from config, never from this file: what the CRM is called, what the
  // premium lead type is, which campaign prefix to strip, who signs.
  const crmName = m.leadQuality?.source && m.leadQuality.source !== 'none' ? m.leadQuality.source.charAt(0).toUpperCase() + m.leadQuality.source.slice(1) : 'CRM';
  const premiumLabel = m.leadQuality?.propertyMix?.premiumLabel || null; const premiumWhy = m.leadQuality?.propertyMix?.premiumWhy || '';
  const prefixRe = m.reporting?.campaignPrefixPattern ? new RegExp(m.reporting.campaignPrefixPattern) : null;
  const prefixAnyRe = prefixRe ? new RegExp(m.reporting.campaignPrefixPattern.replace(/^\^/, ''), 'g') : null; // the same prefix inside a proposal title
  const clientTitle = (t) => { const x = String(t).replace(/\s*\(.*$/, '').replace(/\s*->\s*/g, ' to '); return prefixAnyRe ? x.replace(prefixAnyRe, '') : x; };
  const signer = P.findMember(m.people?.reviewer || '') || P.gitUser(); const senderFirst = signer && signer.name ? signer.name.split(' ')[0] : 'The Digital Stride';
  const nm = nextMonth(month); const nextTargets = { month: nm, cpaGoogle: t.seasonalTargetCpaGoogleBasis?.[nm.slice(5, 7)] ?? null, cplCrm: t.seasonalTargetCplCrmBasis?.[nm.slice(5, 7)] ?? null, roas: roasMode ? C.pickMonthOrSeason(t.targetRoas, nm.slice(5, 7)) : null };

  // CRM: refresh first, so a lead re-classified since the morning's feed is counted.
  let crmRefresh = { ok: null };
  const refreshScript = path.join(ctx.clientDir, 'reports/leads/refresh.cjs');
  if (fs.existsSync(refreshScript) && !has('no-refresh')) {
    try { execFileSync('node', [refreshScript], { cwd: path.dirname(refreshScript), stdio: 'pipe', timeout: 300000 }); crmRefresh = { ok: true }; }
    catch (e) { crmRefresh = { ok: false, error: String(e.stderr || e.message).slice(0, 200) }; }
  }
  let summary = null; try { summary = JSON.parse(fs.readFileSync(path.join(ctx.clientDir, 'reports/leads/data/summary.json'), 'utf8')); } catch { /* no CRM feed */ }
  const crm = crmMonth(summary, month, m.leadQuality?.propertyMix), crmPrev = crmMonth(summary, pm, m.leadQuality?.propertyMix), crmLY = crmMonth(summary, lastYear(month), m.leadQuality?.propertyMix);
  const cplCrm = crm && crm.google ? tot.cost / crm.google : null; const cplCrmPrev = crmPrev && crmPrev.google ? totPrev.cost / crmPrev.google : null;
  const ratio = crm && tot.conv ? crm.google / tot.conv : null;
  const projectedLeads = crm && isPartial ? Math.round(crm.google / Number(to.slice(8, 10)) * daysIn) : (crm ? crm.google : null);

  // GA4: the website's own count of lead events, split by traffic source (three-way reconciliation)
  let ga4 = null;
  if (m.ga4?.propertyId && !has('no-ga4')) {
    try {
      const csv = execFileSync('node', [path.join(C.ROOT, '.claude/skills/gdata-proxy/scripts/ga4.cjs'), 'report', `--property=${m.ga4.propertyId}`, `--start=${range.from}`, `--end=${range.to}`, '--dimensions=eventName,sessionSourceMedium', '--metrics=keyEvents', '--limit=1000'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const rows = C.parseCsv(csv); const leadEv = new Set(m.ga4.leadEvents || []), secEv = new Set(m.ga4.secondaryEvents || []), paid = new Set(m.ga4.paidSourceMedium || ['google / cpc']);
      const agg = { paidLead: 0, allLead: 0, paidSecondary: 0, allSecondary: 0, byEventPaid: {}, byEventAll: {} };
      for (const r of rows) { const n = Number(r.keyEvents || 0); if (!n) continue; const isPaid = paid.has(r.sessionSourceMedium);
        if (leadEv.has(r.eventName)) { agg.allLead += n; agg.byEventAll[r.eventName] = (agg.byEventAll[r.eventName] || 0) + n; if (isPaid) { agg.paidLead += n; agg.byEventPaid[r.eventName] = (agg.byEventPaid[r.eventName] || 0) + n; } }
        else if (secEv.has(r.eventName)) { agg.allSecondary += n; if (isPaid) agg.paidSecondary += n; } }
      ga4 = { propertyId: m.ga4.propertyId, range, ...agg };
    } catch (e) { ga4 = { error: String(e.stderr || e.message).slice(0, 200) }; }
  }
  // Campaign table (every campaign that spent in the month)
  const camps = Object.entries(perf).filter(([, o]) => o.cost >= 1).sort((a, b) => b[1].cost - a[1].cost).map(([name, o]) => { const prev = perfPrev[name]; const tier = roasMode ? (targets.roas ? C.effTier(ctx, o, targets.roas) : null) : targets.cpaGoogle ? C.cpaTier(o.cpa, targets.cpaGoogle, o.conv, o.cost) : null; return { campaign: name, cost: C.r0(o.cost), conv: C.r1(o.conv), cpa: o.cpa ? C.r0(o.cpa) : null, value: C.r0(o.value || 0), roas: o.cost ? (o.value || 0) / o.cost : null, prevCost: prev ? C.r0(prev.cost) : null, prevConv: prev ? C.r1(prev.conv) : null, prevCpa: prev && prev.cpa ? C.r0(prev.cpa) : null, prevRoas: prev && prev.cost ? (prev.value || 0) / prev.cost : null, tier: tier ? (tier.tier || tier) : null, thin: o.conv < 5, inScope: ctx.scope.some((c) => c.campaign === name) }; });

  // Changes made in the month: live writes + proposals decided
  let writes = []; try { writes = fs.readFileSync(path.join(ctx.clientDir, 'context/writes-log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((w) => w.mode === 'live' && w.ts.slice(0, 7) === month); } catch { /* none */ }
  const proposals = P.list({ clientDir: ctx.clientDir }).filter((p) => [p.fm.applied_at, p.fm.approved_at, p.fm.rejected_at, p.fm.created_at].some((d) => d && String(d).slice(0, 7) === month));
  // Google's change history refuses a start more than 30 days back. IP exclusions (ClickCease, about
  // 300 a day) sit under CAMPAIGN_CRITERION and would swamp the row limit, so that type is left out.
  const historyFloor = C.ymd(C.addDays(today, -29));
  const changeLog = { from: range.from > historyFloor ? range.from : historyFloor, to: range.to, rows: 0, groups: [], error: null };
  changeLog.partial = changeLog.from > range.from;
  if (changeLog.from > range.to) { changeLog.error = `Google's change history only goes back 30 days, to ${historyFloor}`; }
  else {
    try {
      const q = await access.runQuery({ customerId: ctx.customerId, loginCustomerId: ctx.loginCustomerId, method: 'auto', query: `SELECT change_event.change_date_time, change_event.change_resource_type, change_event.resource_change_operation, change_event.changed_fields, change_event.old_resource, change_event.new_resource, campaign.name FROM change_event WHERE change_event.change_date_time >= '${changeLog.from}' AND change_event.change_date_time <= '${range.to} 23:59:59' AND change_event.change_resource_type NOT IN ('CAMPAIGN_CRITERION') ORDER BY change_event.change_date_time DESC LIMIT 10000` });
      changeLog.rows = (q.rows || []).length; changeLog.capped = changeLog.rows >= 10000;
      changeLog.groups = groupChanges(q.rows || [], shortCampaign);
    } catch (e) { changeLog.error = String(e.message).slice(0, 200); }
  }

  // Weekly packs in the month
  const evDir = path.join(ctx.clientDir, 'proposals/evidence');
  const packs = fs.existsSync(evDir) ? fs.readdirSync(evDir).filter((d) => /^\d{8}$/.test(d) && d.slice(0, 6) === month.replace('-', '')).map((d) => { try { const p = JSON.parse(fs.readFileSync(path.join(evDir, d, 'pack.json'), 'utf8')); return { date: p.date, act: p.counts.act, watch: p.counts.watch, provisional: p.provisional, report: `reports/weekly-check/${p.date}-weekly-check.md` }; } catch { return null; } }).filter(Boolean) : [];

  const out = { client: ctx.client, name: ctx.registry?.name || ctx.client, month, monthName: monthName(month), partial: isPartial, dataTo: to, daysIn, generatedAt: new Date().toISOString(),
    google: { spend: C.r0(tot.cost), conv: C.r1(tot.conv), cpa: tot.cpa ? C.r0(tot.cpa) : null, value: C.r0(tot.value), roas: tot.cost ? tot.value / tot.cost : null, clicks: tot.clicks, impr: tot.impr, prev: { month: pm, spend: C.r0(totPrev.cost), conv: C.r1(totPrev.conv), cpa: totPrev.cpa ? C.r0(totPrev.cpa) : null, value: C.r0(totPrev.value), roas: totPrev.cost ? totPrev.value / totPrev.cost : null }, lastYearAvailable: dailyPerfFrom <= `${lastYear(month)}-01` },
    crm: crm ? { googleLeads: crm.google, projectedLeads, allLeads: crm.all, unattributedPct: crm.all ? C.r1(crm.unattributed / crm.all * 100) : null, cplCrm: cplCrm ? C.r0(cplCrm) : null, housePct: crm.googleRecorded ? C.r0(crm.googleHouse / crm.googleRecorded * 100) : null, premiumPct: crm.googleRecorded ? C.r0(crm.googlePremium / crm.googleRecorded * 100) : null, prev: crmPrev ? { month: pm, googleLeads: crmPrev.google, cplCrm: cplCrmPrev ? C.r0(cplCrmPrev) : null, housePct: crmPrev.googleRecorded ? C.r0(crmPrev.googleHouse / crmPrev.googleRecorded * 100) : null, premiumPct: crmPrev.googleRecorded ? C.r0(crmPrev.googlePremium / crmPrev.googleRecorded * 100) : null, recorded: crmPrev.googleRecorded } : null, lastYear: crmLY ? { month: lastYear(month), googleLeads: crmLY.google, allLeads: crmLY.all } : null, ratio: ratio ? C.r1(ratio * 100) / 100 : null } : null,
    ga4, targets, nextTargets, campaigns: camps, writes: writes.map((w) => ({ ts: w.ts, who: w.who, path: w.mutatePath, proposal: w.proposal, adHoc: w.adHoc, outcome: w.outcome })), proposals: proposals.map((p) => ({ id: p.id, tier: p.fm.tier, type: p.fm.type, status: p.fm.status, title: p.fm.title, outcome: p.fm.outcome || null })), manualChanges: changeLog.rows, changeLog, sources: { crmRefresh, googleLive }, packs };

  // ---- internal close ----
  const repDir = path.join(ctx.clientDir, 'reports/monthly'); fs.mkdirSync(repDir, { recursive: true });
  const g = out.google, c = out.crm; const L = [];
  L.push(`# Monthly close — ${out.name} — ${out.monthName}${isPartial ? ` (DRAFT, month to date ${to})` : ''}`, '', `Generated ${today}. ${roasMode ? `ROAS mode: ROAS = Google Ads conversion value / cost (Google basis). ${t.basisRule || ''}` : 'Google basis = cost / Google Ads conversions. CRM basis = cost / Zoho leads marked Google Ads.'} Targets from config/management.json.`, '');
  if (crmRefresh.ok === false) L.push(`**Lead data could not be refreshed, so CRM figures are from the last good feed:** ${crmRefresh.error}`, '');
  if (!googleLive.ok) L.push(`**Google Ads could not be read live, so spend and conversions are from the daily file:** ${googleLive.error}`, '');
  L.push('## Headline', '', '| | ' + out.monthName + ' | ' + monthName(pm) + ' | change | target |', '|---|---|---|---|---|');
  L.push(`| Spend | ${C.gbp(g.spend)} | ${C.gbp(g.prev.spend)} | ${pct(g.spend, g.prev.spend)} | ${targets.budget ? C.gbp(targets.budget) + ' budget' : 'no fixed budget'} |`);
  if (roasMode) { L.push(`| Conversion value, Google basis | ${C.gbp(g.value)} | ${C.gbp(g.prev.value)} | ${pct(g.value, g.prev.value)} | |`); L.push(`| ROAS, Google basis | ${C.fmtRoas(g.roas)} | ${C.fmtRoas(g.prev.roas)} | ${g.roas && g.prev.roas ? pct(g.roas, g.prev.roas) : 'n/a'} | ${C.fmtRoas(targets.roas)}${targets.breakEvenRoas ? ` (break-even ${C.fmtRoas(targets.breakEvenRoas)})` : ''} |`); }
  L.push(`| Google conversions | ${g.conv} | ${g.prev.conv} | ${pct(g.conv, g.prev.conv)} | |`);
  L.push(`| CPA, Google basis | ${C.gbp(g.cpa)} | ${C.gbp(g.prev.cpa)} | ${g.cpa && g.prev.cpa ? pct(g.cpa, g.prev.cpa) : 'n/a'} | ${C.gbp(targets.cpaGoogle)} (${g.cpa && targets.cpaGoogle ? (g.cpa / targets.cpaGoogle).toFixed(2) + '×' : 'n/a'}) |`);
  if (c) { L.push(`| CRM leads from Google Ads | ${c.googleLeads}${isPartial ? ` (→ ~${c.projectedLeads})` : ''} | ${c.prev ? c.prev.googleLeads : 'n/a'} | ${c.prev ? pct(c.googleLeads, c.prev.googleLeads) : 'n/a'} | ${targets.leads ?? 'n/a'} |`); L.push(`| CPL, CRM basis | ${C.gbp(c.cplCrm)} | ${C.gbp(c.prev?.cplCrm)} | ${c.cplCrm && c.prev?.cplCrm ? pct(c.cplCrm, c.prev.cplCrm) : 'n/a'} | ${C.gbp(targets.cplCrm)} |`); if (premiumLabel) L.push(`| ${premiumLabel} share of Google Ads leads | ${c.premiumPct ?? 'n/a'}% | ${c.prev?.premiumPct ?? 'n/a'}% | | wanted leads |`); L.push(`| CRM leads per Google conversion | ${c.ratio ?? 'n/a'} | | | ${targets.ratio} ±${m.leadQuality?.ratioTolerancePct ?? 30}% |`); }
  L.push('', `Same month last year: ${g.lastYearAvailable ? 'in dailyPerf' : `Google Ads daily data only starts on ${dailyPerfFrom}, so there is no Google comparison with ${monthName(lastYear(month))}`}${c && c.lastYear ? `; CRM had ${c.lastYear.googleLeads} Google Ads leads of ${c.lastYear.allLeads} in ${monthName(c.lastYear.month)} (attribution then was far thinner)` : ''}.`, '');
  L.push('## Reconciliation: Google Ads vs GA4 vs CRM', '');
  if (!ga4) L.push('GA4 not configured for this client (management.json `ga4`).', '');
  else if (ga4.error) L.push(`GA4 pull failed: ${ga4.error}`, '');
  else {
    const a = g.conv, b = ga4.paidLead, cc = c ? c.googleLeads : null;
    L.push('| Layer | Count | What it is |', '|---|---|---|');
    L.push(`| 1. Google Ads conversions | ${C.r0(a)} | what Google claims (primary actions, click-attributed, 60/90-day lookback) |`);
    L.push(`| 2. GA4 lead events from paid Google traffic | ${C.r0(b)} | what the website recorded in sessions from ${[...(m.ga4.paidSourceMedium || ['google / cpc'])].join(', ')}: ${Object.entries(ga4.byEventPaid).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${C.r0(v)}`).join(', ')} |`);
    L.push(`| 3. ${crmName} leads marked Google Ads | ${cc ?? 'n/a'} | what the business received |`, '');
    const r12 = a ? b / a : null, r23 = b && cc !== null ? cc / b : null;
    L.push(`GA4 per Google conversion: **${r12 === null ? 'n/a' : r12.toFixed(2)}**. ${crmName} per GA4 event: **${r23 === null ? 'n/a' : r23.toFixed(2)}**. Reading: a gap between 1 and 2 is on the tag side (an action double-counting, an event not firing, or attribution-window timing); a gap between 2 and 3 is on the CRM side (duplicates, calls that are not enquiries, leads losing their source on the way in). Neither ratio should be 1.0; both should be steady month to month.`, '');
    L.push(`Site-wide, all traffic: ${C.r0(ga4.allLead)} lead events (${Object.entries(ga4.byEventAll).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${C.r0(v)}`).join(', ')}); ${C.r0(ga4.allSecondary)} guide downloads, ${C.r0(ga4.paidSecondary)} from paid Google.${m.ga4.uncountedNote ? ' ' + m.ga4.uncountedNote : ''}`, '');
  }
  if (roasMode) { L.push('## Campaigns', '', '| Campaign | Spend | Conv | Value (Google) | ROAS | vs target | Prev month ROAS | In scope |', '|---|---|---|---|---|---|---|---|'); for (const r of camps) L.push(`| ${cell(r.campaign)} | ${C.gbp(r.cost)} | ${r.conv} | ${C.gbp(r.value)} | ${C.fmtRoas(r.roas)} | ${r.tier ?? ''}${r.thin && r.tier ? ', thin data' : ''} | ${r.prevRoas !== null ? C.fmtRoas(r.prevRoas) : 'n/a'} | ${r.inScope ? 'yes' : 'no'} |`); }
  else L.push('## Campaigns', '', '| Campaign | Spend | Conv | CPA (Google) | vs target | Prev month CPA | In scope |', '|---|---|---|---|---|---|---|');
  if (!roasMode) for (const r of camps) L.push(`| ${cell(r.campaign)} | ${C.gbp(r.cost)} | ${r.conv} | ${C.gbp(r.cpa)} | ${r.tier ?? ''}${r.thin && r.tier ? ', thin data' : ''} | ${r.prevCpa ? C.gbp(r.prevCpa) : r.prevCost ? `${C.gbp(r.prevCost)} spent, no conv` : 'n/a'} | ${r.inScope ? 'yes' : 'no'} |`);
  L.push('', 'Thin data = under 5 conversions in the month, too few to judge on.');
  L.push('', '## Changes this month', '');
  if (!out.writes.length && !out.proposals.length) L.push('No changes through the brain this month.'); else { for (const w of out.writes) L.push(`- ${w.ts.slice(0, 16).replace('T', ' ')} live write ${w.path} by ${w.who} (${w.proposal || `ad hoc: ${w.adHoc}`}) — ${w.outcome}`); for (const p of out.proposals) L.push(`- proposal ${p.id} · T${p.tier} ${p.type} · **${p.status}** — ${p.title}${p.outcome ? ` — ${p.outcome}` : ''}`); }
  L.push('', '### Account changes (Google Ads change history)', '');
  if (changeLog.error) L.push(`Could not read the change history: ${changeLog.error}. Check the account by hand.`, '');
  else {
    L.push(`${changeLog.rows} change event(s) from ${changeLog.from} to ${changeLog.to}, leaving out campaign-level exclusions such as ClickCease's IP blocks and housekeeping such as tracking templates.${changeLog.partial ? ` **Google's history only goes back 30 days, so ${range.from} to ${C.ymd(C.addDays(changeLog.from, -1))} is not covered.**` : ''}${changeLog.capped ? ' **The 10,000-row limit was reached, so some changes may be missing.**' : ''}`, '');
    for (const g of changeLog.groups) L.push(`- ${g.date}: ${cell(g.text)}${g.campaigns.length > 1 ? ` (${g.detail.map(cell).join('; ')})` : ''}`);
    if (!changeLog.groups.length) L.push('- None.');
    L.push('');
  }
  L.push('## Weekly packs', '', ...(packs.length ? packs.map((p) => `- ${p.date}: ${p.act} act, ${p.watch} watch${p.provisional ? ' (provisional)' : ''} — ${p.report}`) : ['None this month.']), '');
  if (roasMode) L.push('## Next month: targets to re-confirm', '', `${monthName(nm)}: ROAS ${C.fmtRoas(nextTargets.roas)} Google basis${targets.budget ? ` · budget ${C.gbp(targets.budget)}` : ''}. **Reviewer: confirm or change these in management.json before the first pack of the month.**`, '');
  else L.push('## Next month: targets to re-confirm', '', `${monthName(nm)}: CPA ${C.gbp(nextTargets.cpaGoogle)} Google basis · CPL ${C.gbp(nextTargets.cplCrm)} CRM basis · ${targets.leads ?? 'n/a'} CRM leads from Google Ads. Break-even ${C.gbp(targets.breakEven)} Google basis. **Reviewer: confirm or change these in management.json before the first pack of the month.**`, '');
  L.push('_Status: machine draft. The reviewer adds the narrative and signs the client report before it is sent._', '');
  const closeFile = path.join(repDir, `${month}-monthly-close.md`); fs.writeFileSync(closeFile, L.join('\n'));

  // ---- client report (tds-doc) ----
  const clientName = out.name; const title = `Google Ads monthly report &mdash; ${esc(out.monthName)}`;
  const niceToday = `${Number(today.slice(8, 10))} ${MONTHS[Number(today.slice(5, 7)) - 1]} ${today.slice(0, 4)}`;
  const foot = (n, of) => `<div class="rfoot"><div class="meta">${DRAFT_MARK}${esc(niceToday)} &middot; Private &amp; Confidential${isPartial ? ' &middot; month to date' : ''}</div><div class="meta pg">Page 0${n}<span class="of"> / 0${of}</span></div></div>`;
  const head = `<div class="rhead"><svg class="logo"><use href="#tds"/></svg><div class="r"><div class="meta navy">${title}</div><div class="meta" style="margin-top:5px">${esc(clientName)}</div></div></div>`;
  const leadsLine = c ? `${c.googleLeads} enquiries from Google Ads reached the CRM${isPartial ? ` by ${to.slice(8, 10)} ${MONTHS[Number(mm) - 1]}, on course for about ${c.projectedLeads}` : ''}${targets.leads ? ` against a target of ${targets.leads}` : ''}, at ${C.gbp(c.cplCrm)} each${targets.cplCrm ? ` against the ${C.gbp(targets.cplCrm)} target` : ''}.` : 'CRM lead counts were not available for this month.';
  const mixLine = c && c.premiumPct != null && premiumLabel ? `${c.premiumPct}% of those enquiries were ${premiumLabel.toLowerCase()}${premiumWhy ? ', ' + premiumWhy : ''}${c.prev && c.prev.premiumPct != null && c.prev.recorded >= 20 ? ` (${c.prev.premiumPct}% in ${monthName(pm)})` : ''}.` : '';
  const roasLine = roasMode ? `Google Ads recorded ${C.gbp(g.value)} in sales value from ${C.gbp(g.spend)} of spend${isPartial ? ` by ${to.slice(8, 10)} ${MONTHS[Number(mm) - 1]}` : ''}, a return of ${C.fmtRoas(g.roas)}${targets.roas ? ` against ${anRoas(targets.roas)} target` : ''} (${C.fmtRoas(g.prev.roas)} in ${monthName(pm)}).` : '';
  const spendLine = `Google Ads spend was ${C.gbp(g.spend)} (${pct(g.spend, g.prev.spend)} on ${monthName(pm)}) for ${C.r0(g.conv)} tracked conversions at ${C.gbp(g.cpa)} each${targets.cpaGoogle ? ` against a ${C.gbp(targets.cpaGoogle)} target` : ''}.`;
  // What the client reads as "changed" is what changed in the account: from the change history, never
  // from proposals, which also hold internal settings and decisions to leave something alone.
  const changeDays = []; for (const g of changeLog.groups) { const d = changeDays[changeDays.length - 1]; if (d && d.date === g.date) d.items.push(g.text); else changeDays.push({ date: g.date, items: [g.text] }); }
  const changeCats = [...new Set(changeLog.groups.map((g) => CHANGE_WORDS[g.cat]))];
  const changeSummary = changeCats.length > 1 ? `${changeCats.slice(0, -1).join(', ')} and ${changeCats[changeCats.length - 1]}` : (changeCats[0] || '');
  const changeGap = changeLog.partial && !changeLog.error ? `Changes before ${shortDate(changeLog.from)} are not in Google's history any more.` : '';
  const held = out.proposals.filter((p) => p.status === 'rejected').map((p) => esc(clientTitle(p.title).replace(/:\s.*$/, '')));
  // Sheet budget: the campaigns table and the changes list do not both fit on one A4 sheet once
  // there are more than two changes, so the changes get a sheet of their own then (3 sheets).
  const heldBack = out.proposals.filter((p) => p.status === 'rejected');
  const changesOwnSheet = changeDays.length + heldBack.length > 2 || camps.length > 6; const SHEETS = changesOwnSheet ? 3 : 2;
  const top = camps; // every campaign that spent, so the table adds up to the spend above
  const changesBlock = `
    <div class="sd${changesOwnSheet ? '' : ' block'}"><div class="sd-row"><div class="sd-num">02</div><h2>Changes and plan</h2></div>${changesOwnSheet ? `<div class="sd-lede">What we changed, what we held back and the plan for next month.${changeGap ? ` ${esc(changeGap)}` : ''}</div>` : ''}</div>
    <figure class="block-sm"><table><thead><tr><th style="width:15%">Date</th><th>What we changed</th></tr></thead><tbody>
      ${changeLog.error ? '<tr><td colspan="2"><span class="pill soft">reviewer to add</span> Google Ads change history could not be read for this month.</td></tr>' : changeDays.length ? changeDays.map((d) => `<tr><td>${esc(shortDate(d.date))}</td><td>${esc(d.items.join('. '))}.</td></tr>`).join('\n      ') : '<tr><td colspan="2">No changes. The account ran unchanged this month.</td></tr>'}
      ${heldBack.length ? `<tr><td><strong>Held back</strong></td><td>${esc(heldBack.map((p) => clientTitle(p.title).replace(/:\s.*$/, '')).join('. '))}.</td></tr>` : ''}
    </tbody></table>    </figure>
    <div class="callout block"><p class="lead">Next month</p><p>Targets for ${esc(monthName(nm))}: ${roasMode ? `${C.fmtRoas(nextTargets.roas)} return on ad spend${targets.budget ? ` on a ${C.gbp(targets.budget)} budget` : ''}` : `${C.gbp(nextTargets.cplCrm)} per CRM enquiry${targets.leads ? ` and ${targets.leads} enquiries from Google Ads` : ''}`}. The reviewer adds the plan here before this report is sent.</p></div>`;
  const body = `
<div class="sheet">
  ${head}
  <div class="sheet-body">
    <div class="titleblock">
      <div class="kicker"><span class="dot"></span><span class="meta">Monthly report</span>${KICKER_MARK}</div>
      <h1>Google Ads, ${esc(out.monthName)}</h1>
      <p class="lede">${roasMode ? esc(roasLine) : `${esc(leadsLine)} ${esc(mixLine)}`}</p>
      <div class="facts"><div><div class="lbl">Client</div><div class="val">${esc(clientName)}</div></div><div><div class="lbl">Period</div><div class="val">${isPartial ? `1&ndash;${Number(to.slice(8, 10))} ${esc(MONTHS[Number(mm) - 1])} ${month.slice(0, 4)} (to date)` : esc(out.monthName)}</div></div><div><div class="lbl">Prepared by</div><div class="val">The Digital Stride</div></div></div>
    </div>
    ${roasMode ? `<div class="mcal c4 block">
      <div class="m"><div class="v">${C.gbp(g.value)}</div><div class="l">Sales value Google Ads tracked</div></div>
      <div class="m"><div class="v">${C.fmtRoas(g.roas)}</div><div class="l">Return on ad spend${targets.roas ? ` (target ${C.fmtRoas(targets.roas)})` : ''}</div></div>
      <div class="m"><div class="v">${C.gbp(g.spend)}</div><div class="l">Spend (${pct(g.spend, g.prev.spend)} vs ${esc(MONTHS[Number(pm.slice(5, 7)) - 1])})${targets.budget ? ` of ${C.gbp(targets.budget)}` : ''}</div></div>
      <div class="m"><div class="v">${C.r0(g.conv)}</div><div class="l">Sales Google Ads tracked (${C.gbp(g.value && g.conv ? g.value / g.conv : null)} each)</div></div>
    </div>` : `<div class="mcal c4 block">
      <div class="m"><div class="v">${c ? c.googleLeads : '&ndash;'}</div><div class="l">Enquiries in the CRM from Google Ads</div></div>
      <div class="m"><div class="v">${c ? C.gbp(c.cplCrm) : '&ndash;'}</div><div class="l">Cost per enquiry${targets.cplCrm ? ` (target ${C.gbp(targets.cplCrm)})` : ''}</div></div>
      <div class="m"><div class="v">${C.gbp(g.spend)}</div><div class="l">Spend (${pct(g.spend, g.prev.spend)} vs ${esc(MONTHS[Number(pm.slice(5, 7)) - 1])})</div></div>
      ${premiumLabel ? `<div class="m"><div class="v">${c && c.premiumPct != null ? c.premiumPct + '%' : '&ndash;'}</div><div class="l">${esc(premiumLabel)} share</div></div>` : `<div class="m"><div class="v">${C.r0(g.conv)}</div><div class="l">Conversions Google Ads tracked (${C.gbp(g.cpa)} each)</div></div>`}
    </div>`}
    <div class="exec block">
      <div class="eyebrow">Summary</div>
      <h2>How the month performed</h2>
      <p>${roasMode ? esc(`Spend was ${C.gbp(g.spend)}${targets.budget ? ` against a ${C.gbp(targets.budget)} monthly budget` : ''} (${pct(g.spend, g.prev.spend)} on ${monthName(pm)}), for ${C.r0(g.conv)} tracked sales worth ${C.gbp(g.value && g.conv ? g.value / g.conv : null)} on average.${targets.breakEvenRoas && g.roas ? ` Break-even is about ${C.fmtRoas(targets.breakEvenRoas)}, so the month ran ${g.roas >= targets.breakEvenRoas ? 'above' : 'below'} it.` : ''}${roasCaveat ? ' ' + roasCaveat : ''}`) : `${esc(spendLine)} ${c ? esc(`The CRM is the number that matters: it counts people, not clicks, and ${c.googleLeads} enquiries at ${C.gbp(c.cplCrm)} is ${targets.cplCrm && c.cplCrm ? (c.cplCrm <= targets.cplCrm ? 'inside' : 'over') : 'against'} the ${C.gbp(targets.cplCrm)} target for the month.`) : ''}`}</p>
      <div class="highlights">
        <div class="hl"><span class="dot"></span><div><div class="t">What we changed</div><p>${changeLog.error ? '<span class="pill soft">reviewer to add</span>' : changeSummary ? `We changed ${esc(changeSummary)}. The full list is under Changes and plan.` : 'No account changes this month.'}</p></div></div>
        <div class="hl"><span class="dot"></span><div><div class="t">What we held back</div><p>${held.length ? held.join('. ') + '.' : (roasMode ? 'Nothing was held back this month.' : 'Nothing was held back for lead-quality reasons this month.')}</p></div></div>
        <div class="hl"><span class="dot"></span><div><div class="t">Next month</div><p>Targets for ${esc(monthName(nm))}: ${roasMode ? `${C.fmtRoas(nextTargets.roas)} return on ad spend${targets.budget ? ` on a ${C.gbp(targets.budget)} budget` : ''}` : `${C.gbp(nextTargets.cplCrm)} per enquiry in the CRM${targets.leads ? `, ${targets.leads} enquiries` : ''}`}. <span class="pill soft">reviewer to confirm</span></p></div></div>
      </div>
    </div>
  </div>
  ${foot(1, SHEETS)}
</div>
<div class="sheet">
  ${head}
  <div class="sheet-body">
    <div class="sd"><div class="sd-row"><div class="sd-num">01</div><h2>Campaigns</h2></div><div class="sd-lede">${roasMode ? 'Spend, tracked sales and sales value by campaign, Google Ads basis. This table shows where the money went and what it returned.' : 'Spend and tracked conversions by campaign, Google Ads basis. The CRM figure above is the one to judge the month on; this table shows where the money went.'}</div></div>
    <figure class="block-sm"><figcaption>Campaigns that spent in ${esc(out.monthName)}</figcaption>
      ${roasMode ? `<table><thead><tr><th>Campaign</th><th class="num">Spend</th><th class="num">Sales</th><th class="num">Sales value</th><th class="num">Return</th><th class="num">${esc(MONTHS[Number(pm.slice(5, 7)) - 1])}</th></tr></thead><tbody>
      ${top.map((r) => `<tr><td>${esc(prefixRe ? r.campaign.replace(prefixRe, '') : r.campaign)}</td><td class="num">${C.gbp(r.cost)}</td><td class="num">${C.r0(r.conv)}</td><td class="num">${C.gbp(r.value)}</td><td class="num">${C.fmtRoas(r.roas)}${r.thin ? '*' : ''}</td><td class="num">${r.prevRoas !== null ? C.fmtRoas(r.prevRoas) : 'n/a'}</td></tr>`).join('\n      ')}
      <tr><td><strong>Total</strong></td><td class="num"><strong>${C.gbp(g.spend)}</strong></td><td class="num"><strong>${C.r0(g.conv)}</strong></td><td class="num"><strong>${C.gbp(g.value)}</strong></td><td class="num"><strong>${C.fmtRoas(g.roas)}</strong></td><td class="num"><strong>${C.fmtRoas(g.prev.roas)}</strong></td></tr>
      </tbody></table>
      <div class="tnote">* Fewer than 5 sales in the month, too few to judge on. Return = sales value Google Ads tracked &divide; spend.${roasCaveat ? ' ' + esc(roasCaveat) : ''}</div>` : `<table><thead><tr><th>Campaign</th><th class="num">Spend</th><th class="num">Conversions</th><th class="num">Cost per conversion</th><th class="num">${esc(MONTHS[Number(pm.slice(5, 7)) - 1])}</th></tr></thead><tbody>
      ${top.map((r) => `<tr><td>${esc(prefixRe ? r.campaign.replace(prefixRe, '') : r.campaign)}</td><td class="num">${C.gbp(r.cost)}</td><td class="num">${C.r0(r.conv)}</td><td class="num">${C.gbp(r.cpa)}${r.thin ? '*' : ''}</td><td class="num">${r.prevCpa ? C.gbp(r.prevCpa) : r.prevCost ? 'no conversions' : 'n/a'}</td></tr>`).join('\n      ')}
      <tr><td><strong>Total</strong></td><td class="num"><strong>${C.gbp(g.spend)}</strong></td><td class="num"><strong>${C.r0(g.conv)}</strong></td><td class="num"><strong>${C.gbp(g.cpa)}</strong></td><td class="num"><strong>${C.gbp(g.prev.cpa)}</strong></td></tr>
      </tbody></table>
      <div class="tnote">* Fewer than 5 conversions in the month, too few to judge on. Google Ads counts a conversion per form, call or booking it can see; the CRM counts a person.${targets.ratio ? ` On this account there are about ${targets.ratio} CRM enquiries per Google conversion.` : ''}</div>`}
    </figure>${changesOwnSheet ? '' : changesBlock}
  </div>
  ${foot(2, SHEETS)}
</div>${changesOwnSheet ? `
<div class="sheet">
  ${head}
  <div class="sheet-body">${changesBlock}
  </div>
  ${foot(3, SHEETS)}
</div>` : ''}`;
  const F = monthFiles(ctx.clientDir, month, clientName); const stem = F.stem;
  fs.writeFileSync(F.body, body); out.bodyHash = sha(body);
  // A fresh body voids any earlier sign-off (only reachable with --force).
  fs.rmSync(F.review, { force: true }); fs.rmSync(F.finalHtml, { force: true }); fs.rmSync(F.finalPdf, { force: true });
  let pdfOk = false;
  if (!has('no-pdf')) { try { pdfOk = !!renderPdf(F, `Google Ads monthly report, ${out.monthName}`).pdf; } catch (e) { console.error('pdf build failed: ' + (e.stderr || e.message)); } }

  // ---- covering email draft ----
  let roles = { members: [] }; try { roles = JSON.parse(fs.readFileSync(path.join(C.ROOT, '.team-config/roles.json'), 'utf8')); } catch { /* none */ }
  const recipients = (m.cadence?.monthlyReport?.recipients || []).map((slug) => { const mem = roles.members.find((x) => slugName(x.name) === slug); return mem ? `${mem.name} <${mem.email}>` : slug; });
  const E = [`# Covering email — ${out.name} Google Ads report, ${out.monthName}${isPartial ? ' (DRAFT, month to date)' : ''}`, '', `**To:** ${recipients.join(', ')}`, '', `**Attach:** ${rel(F.finalPdf)} (built when the report is signed off; until then only ${rel(F.draftPdf)} exists)`, '', `**Subject:** ${out.name} Google Ads, ${out.monthName}`, '', '---', '', 'Hi all,', '', `Attached is the Google Ads report for ${out.monthName}.`, '', ...(roasMode ? [roasLine, roasCaveat] : [leadsLine, mixLine, '', spendLine]), '', changeLog.error ? '[Reviewer to add what changed: the change history could not be read.]' : changeSummary ? `We changed ${changeSummary} this month; the report lists each change.` : 'No account changes were made this month.', held.length ? `Held back: ${held.join('; ')}.` : '', '', roasMode ? `The target for ${monthName(nm)} is ${anRoas(nextTargets.roas)} return on ad spend${targets.budget ? ` on a ${C.gbp(targets.budget)} budget` : ''}; shout if it should move.` : `Targets for ${monthName(nm)} are ${C.gbp(nextTargets.cplCrm)} per CRM enquiry and ${targets.leads ?? 'n/a'} enquiries; shout if either should move.`, '', senderFirst, '', '_Draft written by the brain. A human reads it, edits it and sends it; nothing is sent automatically._'];
  const emailFile = F.email; fs.writeFileSync(emailFile, E.filter((l) => l !== null).join('\n'));

  out.files = { close: rel(closeFile), body: rel(F.body), draftPdf: pdfOk ? rel(F.draftPdf) : null, pdf: null, email: rel(emailFile), review: null };
  fs.writeFileSync(F.json, JSON.stringify(out, null, 2));
  if (has('json')) console.log(JSON.stringify(out, null, 2));
  else { console.log(`monthly close ${out.name} ${out.monthName}${isPartial ? ' (DRAFT to ' + to + ')' : ''}: spend ${C.gbp(g.spend)}, ${g.conv} Google conv at ${C.gbp(g.cpa)}${roasMode ? `, value ${C.gbp(g.value)}, ROAS ${C.fmtRoas(g.roas)}` : ''}${c ? `, ${c.googleLeads} CRM leads at ${C.gbp(c.cplCrm)} CRM basis, ${c.premiumPct}% flats+listed` : ''}`); for (const [k, v] of Object.entries(out.files)) if (k !== 'pdf' && k !== 'review') console.log(`${k.padEnd(8)} ${v || 'not built'}`); console.log(`final    not built: the final PDF renders only after \`monthly.cjs sign --client=${client} --month=${month} --as=<you>\`${isPartial ? ' (and only for a complete month)' : ''}`); }
}
if (require.main === module) main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
module.exports = { monthFiles, monthStatus, reviewState, renderPdf, sign, DRAFT_MARK };
