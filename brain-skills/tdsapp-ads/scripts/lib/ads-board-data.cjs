// PORTED from the brain Workbench: tools/members/command-centre/lib/ads-board-data.cjs (sha256 in ../../SOURCES.md).
// Copied for tdsapp-ads so Cortex works on a Mac that never runs the Workbench (plan 2026-11-16-workbench-ad-manager,
// decision 9). Never edit the logic here: when the source changes, copy it again and update SOURCES.md.
// Changes from the source: BRAIN_ROOT falls back to five folders up (this file sits in .claude/skills/tdsapp-ads/scripts/lib).
'use strict';
/*
 * Ads Command Board — optional data layer.
 *
 * Reads the cached Google Ads exports in clients/<account>/data/ (or the path a
 * standup config names) and returns the dense "top ten" tables + the task-card
 * badges for one account. The board works WITHOUT this — every task still
 * dispatches a Claude session — so this only lights up the tables for members
 * who have pulled their account data.
 *
 * Reads TOLERANTLY via ads-normalize.cjs: whatever shape the data arrives in
 * (clean 8020-script CSVs, raw proxy/API output with snake_case headers and
 * micros, or the member's own exports), the reader maps it to the canonical
 * fields and converts micros. Members never have to reshape their data by hand.
 *
 * No dependencies beyond the sibling ads-normalize.cjs. Drop-in for the member
 * Workbench server (tools/members/command-centre/).
 */
const fs = require('fs');
const path = require('path');
const N = require('./ads-normalize.cjs');
const { readTable, resolveFile, fieldsPresent, parseCsv, num, FILE_ALIASES, FIELD_LABELS } = N;

// The Daily Standup layer (sibling lib). Optional: if it isn't installed the
// board still renders its tables, just without the standup verdict + card state.
const standup = (() => { try { return require('./standup-board.cjs'); } catch { return null; } })();

// command-centre/lib → up 4 = brain root. (The server sets BRAIN_ROOT in env
// before requiring this, which takes precedence; this is the standalone fallback.)
const BRAIN_ROOT = process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..', '..');
const CLIENTS_DIR = path.join(BRAIN_ROOT, 'clients');
const ACCOUNTS_PATH = path.join(BRAIN_ROOT, '.claude', 'accounts.json');

// TDS: board reads a derived "view" generated from the canonical gads-context
// pull. That folder (clients/*/context/google-ads/data/) is already gitignored,
// so nothing client-specific syncs. The 'board' subfolder holds the view CSVs.
const DATA_SUBPATH = ['context', 'google-ads', 'board'];

// An account's data folder. The standup config's `data_path` wins when set
// (board + standup then read the same folder, which is the point of the
// contract); the TDS `board/` view above is the fallback.
function dataDirFor(key) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(CLIENTS_DIR, key, 'standup', 'config.json'), 'utf8'));
    const rel = String(cfg.data_path || '').trim();
    if (rel) return path.isAbsolute(rel) ? rel : path.join(BRAIN_ROOT, rel);
  } catch { /* no standup config — use the default */ }
  return path.join(CLIENTS_DIR, key, ...DATA_SUBPATH);
}

// Read a dataset by canonical name (e.g. 'summary') from an account's data dir,
// tolerating filename + header + micros variance. Returns rows keyed by
// canonical field.
function rowsFor(key, dataset) {
  return readTable(dataDirFor(key), FILE_ALIASES[dataset] || []).rows;
}

const div = (a, b) => (b ? Math.round((a / b) * 10000) / 10000 : 0);

function loadAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8')); } catch { return {}; }
}

// Resolve a clients/ folder name (e.g. "urban-cooling") to its accounts.json
// entry, whose key may use underscores (e.g. "urban_cooling"). Try the folder
// name as-is, then the hyphen→underscore variant.
function cfgFor(cfg, key) {
  return cfg[key] || cfg[key.replace(/-/g, '_')] || null;
}

// ---- the data contract (health view) ----------------------------------------
// One row per dataset the board + Daily Standup read: the filename variants it
// accepts, the canonical fields it genuinely can't work without, and whether it
// is conditional (only applies to some account types — a lead-gen account never
// has Shopping products, so its absence is "not applicable", not "missing").
// Human doc for members: assets/ads-data-contract.md — keep the two in sync.
const HEALTH = [
  { file: 'dailyPerf.csv', dataset: 'dailyPerf', group: 'daily', need: ['date', 'campaign', 'cost'], dateField: 'date',
    powers: 'Daily Standup (performance + anomaly) · Spend & anomaly check' },
  { file: 'summary.csv', dataset: 'summary', group: 'daily', need: ['date', 'campaign', 'cost'], dateField: 'date',
    powers: 'Top campaigns table · trend baselines' },
  { file: 'search80.csv', dataset: 'search80', group: 'search', need: ['searchTerm', 'cost'],
    powers: 'Search terms + wasted spend · standup search-term analyst' },
  { file: 'keyword80.csv', dataset: 'keyword80', group: 'search', need: ['keyword', 'cost'],
    powers: 'Top keywords table' },
  { file: 'quality.csv', dataset: 'quality', group: 'search', need: ['qualityScore'], search: true,
    powers: 'Quality Score spread · standup quality + landing analysts' },
  { file: 'productID.csv', dataset: 'productID', group: 'products', need: ['cost'], shopping: true,
    powers: 'Top products table · pause zero-sale products' },
  { file: 'geo_locations.csv', dataset: 'geo', group: 'deep', need: ['location'], powers: 'Standup geo analyst' },
  { file: 'pages.csv', dataset: 'pages', group: 'deep', need: ['url'], powers: 'Standup landing-page analyst' },
  { file: 'assetFatigue.csv', dataset: 'assetFatigue', group: 'deep', need: ['campaign'], adAssets: true, powers: 'Asset & RSA fatigue · standup creative analyst' },
  { file: 'campSettings.csv', dataset: 'campSettings', group: 'deep', need: ['campaign'], powers: 'Bid-strategy check · standup campaign context' },
  { file: 'campaign_budgets.csv', dataset: 'budgets', group: 'deep', need: ['campaign'], powers: 'Budget pacing vs target' },
  { file: 'im_pmax_categories.csv', dataset: 'pmaxCat', group: 'deep', need: ['campaign'], shopping: true, powers: 'Standup PMax categories analyst' },
  { file: 'im_pmax_search_terms.csv', dataset: 'pmaxST', group: 'deep', need: ['searchTerm'], shopping: true, powers: 'Standup PMax search-terms analyst' },
];

const STALE_AFTER_DAYS = 3;

// Does this account run Shopping/retail? Explicit accounts.json `type` wins
// ('ecommerce'/'shopping'/'retail' => yes, 'leadgen'/'lead-gen'/'search'/
// 'services' => no); otherwise inferred from whether any product data exists.
function accountRunsShopping(key, cfg) {
  const t = String((cfg && (cfg.type || cfg.accountType)) || '').toLowerCase();
  if (/ecom|shop|retail|commerce/.test(t)) return true;
  if (/lead|search|service|b2b/.test(t)) return false;
  return !!resolveFile(dataDirFor(key), FILE_ALIASES.productID); // infer: product file present
}

// Which advertising channels does this account currently RUN? Read from the
// account's own campSettings.csv (Campaign, Campaign ID, Status, Channel, ...),
// counting only ENABLED campaigns. Returns null when the file can't be read, so
// callers fall back to the old behaviour rather than guessing.
//
// This is the Search-side mirror of accountRunsShopping(): a PMax-only or
// Shopping-only account has no keywords and no ad-group ads, so quality.csv and
// assetFatigue.csv can only ever be header-only. That is "not applicable", not
// "missing" — and the moment a Search campaign is enabled again, campSettings
// says so and the files go back to being genuinely required.
function enabledChannels(key) {
  const p = resolveFile(dataDirFor(key), FILE_ALIASES.campSettings || ['campSettings.csv']);
  if (!p) return null;
  let grid = [];
  try { grid = parseCsv(fs.readFileSync(p, 'utf8')); } catch { return null; }
  if (grid.length < 2) return null;
  const header = grid[0].map(h => String(h).trim().toLowerCase());
  const ci = header.findIndex(h => /channel/.test(h));
  const si = header.findIndex(h => /status/.test(h));
  if (ci < 0 || si < 0) return null;
  const out = new Set();
  for (let i = 1; i < grid.length; i++) {
    if (String(grid[i][si] || '').trim().toUpperCase() !== 'ENABLED') continue;
    const ch = String(grid[i][ci] || '').trim().toUpperCase();
    if (ch) out.add(ch);
  }
  return out;
}

// Channels whose creative lives on ad-group ads, i.e. the only ones that ever
// appear in ad_group_ad_asset_view (what feeds assetFatigue.csv). PMax and
// Shopping assets live on asset groups instead and are not reported per-asset.
const AD_ASSET_CHANNELS = ['SEARCH', 'DISPLAY', 'VIDEO', 'DEMAND_GEN', 'DISCOVERY', 'MULTI_CHANNEL'];

// Per-file health for one account: does each dataset exist (under any accepted
// filename), does it carry the fields the cards need, and is dated data fresh?
// A conditional Shopping dataset that's absent on a non-Shopping account is
// reported "n/a" (not applicable), never "missing" — so lead-gen setups don't
// see a wall of red for files they'll never have.
function dataHealth(key) {
  const dir = dataDirFor(key);
  const cfg = cfgFor(loadAccounts(), key) || {};
  const runsShopping = accountRunsShopping(key, cfg);
  const channels = enabledChannels(key);
  // Unknown channels (no readable campSettings.csv) => never mark n/a.
  const notApplicable = (c) => (c.shopping && !runsShopping)
    || (c.search && channels && !channels.has('SEARCH'))
    || (c.adAssets && channels && !AD_ASSET_CHANNELS.some(ch => channels.has(ch)));
  // When the last successful proxy pull ran (ads-board-ingest.cjs writes it). A recent pull
  // with no rows for the last few days means the account didn't serve (ad schedule, paused),
  // so those files are quiet, not stale.
  let refreshed = null;
  try { refreshed = JSON.parse(fs.readFileSync(path.join(dir, '_refreshed.json'), 'utf8')); } catch { /* older board: date rule only */ }
  const pulledRecently = Boolean(refreshed && refreshed.at && (Date.now() - Date.parse(refreshed.at)) / 86400000 <= STALE_AFTER_DAYS);
  const files = HEALTH.map(c => {
    const out = { file: c.file, group: c.group, powers: c.powers, status: 'missing', latest: null, missingCols: [] };
    const na = notApplicable(c);
    const p = resolveFile(dir, FILE_ALIASES[c.dataset] || [c.file]);
    if (!p) {
      if (na) out.status = 'na'; // not applicable (CSS-safe token)
      return out;
    }
    let grid = [];
    try { grid = parseCsv(fs.readFileSync(p, 'utf8')); } catch { /* unreadable = missing */ }
    // Header-only file: the pull ran and the account genuinely has no rows.
    // "n/a" when the dataset can't apply to this account's channel mix.
    if (grid.length < 2) { if (na && grid.length) out.status = 'na'; return out; }
    const header = grid[0].map(h => String(h).trim());
    const present = fieldsPresent(header);
    out.missingCols = c.need.filter(f => !present.has(f)).map(f => FIELD_LABELS[f] || f);
    if (out.missingCols.length) { out.status = 'wrong-shape'; return out; }
    if (c.dateField) {
      const idx = dateIndex(header, c.dateField);
      let latest = null;
      for (let i = 1; i < grid.length; i++) {
        const d = String((idx >= 0 ? grid[i][idx] : '') || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!latest || d > latest)) latest = d;
      }
      out.latest = latest;
      if (latest && (Date.now() - Date.parse(latest)) / 86400000 > STALE_AFTER_DAYS) {
        if (!pulledRecently) { out.status = 'stale'; return out; }
        out.quiet = true; // pulled fine, the account simply had no activity since `latest`
      }
    }
    out.status = 'ok';
    return out;
  });
  const ok = files.filter(f => f.status === 'ok').length;
  const na = files.filter(f => f.status === 'na').length;
  const applicable = files.length - na;
  const freshThrough = (pulledRecently && refreshed.through) || files.filter(f => f.status === 'ok' && f.latest).map(f => f.latest).sort().pop() || null;
  let relDir = dir;
  if (dir.startsWith(BRAIN_ROOT)) relDir = dir.slice(BRAIN_ROOT.length).replace(/^\/+/, '');
  return { dir: relDir, files, ok, na, applicable, total: files.length, freshThrough, fetch: fetchStatus(key) };
}

// The daily fetch's own record for this account (clients/<key>/data/_fetch-status.json):
// when it last ran, how many datasets failed, and whether that is old news. The banner
// shows it so a failed 05:00 run is visible the same morning (27 Oct 2026).
function fetchStatus(key) {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(CLIENTS_DIR, key, 'data', '_fetch-status.json'), 'utf8'));
    const errors = Object.keys(st.errors || {}).length, tabs = Object.keys(st.tabs || {}).length;
    const ageHours = Math.round((Date.now() - Date.parse(st.lastRun)) / 3600000);
    return { lastRun: st.lastRun, errors, total: errors + tabs, ageHours, problem: errors > 0 || ageHours > 36 };
  } catch { return null; }
}

// Resolve the index of a canonical field within a raw header row.
function dateIndex(header, field) {
  const r = N.resolveHeaders(header);
  return r[field] ? r[field].index : -1;
}

function hasAnyData(key) {
  const dir = dataDirFor(key);
  return HEALTH.some(c => resolveFile(dir, FILE_ALIASES[c.dataset] || [c.file]));
}

// ---- account list ----------------------------------------------------------
function listAccounts() {
  if (!fs.existsSync(CLIENTS_DIR)) return [];
  const cfg = loadAccounts();
  return fs.readdirSync(CLIENTS_DIR)
    .filter(k => {
      try { if (!fs.statSync(path.join(CLIENTS_DIR, k)).isDirectory()) return false; } catch { return false; }
      return hasAnyData(k) || (standup ? standup.hasStandupConfig(k) : false);
    })
    .map(k => {
      const c = cfgFor(cfg, k);
      return {
        key: k,
        name: (c && c.name) || k,
        currency: (c && c.currency) || 'USD',
        hasStandup: standup ? standup.hasStandupConfig(k) : false,
        standup: standup ? standup.standupSummary(k) : null,
      };
    });
}

const col = (key, label, type) => ({ key, label, type });

// ---- one account: top-ten tables + badges ----------------------------------
function buildBoardData(key) {
  const cfg = loadAccounts();
  const c = cfgFor(cfg, key);
  const currency = (c && c.currency) || 'USD';
  const name = (c && c.name) || key;

  const top = [];

  // campaigns (from summary.csv, last 30 days by spend)
  const summ = rowsFor(key, 'summary').map(r => ({
    d: String(r.date || '').slice(0, 10), camp: r.campaign,
    cost: num(r.cost), conv: num(r.conversions), value: num(r.convValue), impr: num(r.impressions), clicks: num(r.clicks),
  }));
  if (summ.length) {
    const dates = summ.map(r => r.d).filter(Boolean).sort();
    const d0 = dates[dates.length - 1] || '';
    const lo = new Date(new Date(d0).getTime() - 29 * 86400000).toISOString().slice(0, 10);
    const cmap = {};
    summ.forEach(r => {
      if (r.d >= lo && r.d <= d0) {
        const c = cmap[r.camp] || (cmap[r.camp] = { cost: 0, conv: 0, value: 0, clicks: 0 });
        c.cost += r.cost; c.conv += r.conv; c.value += r.value; c.clicks += r.clicks;
      }
    });
    const totCost = Object.values(cmap).reduce((s, c) => s + c.cost, 0) || 1;
    const camps = Object.entries(cmap).sort((a, b) => b[1].cost - a[1].cost).slice(0, 10);
    if (camps.length) top.push({
      id: 'campaigns', title: 'Top campaigns', subtitle: 'last 30 days, by spend',
      cols: [col('campaign', 'Campaign', 'text'), col('cost', 'Spend', 'money'), col('conv', 'Conv', 'num1'),
             col('value', 'Value', 'money'), col('roas', 'ROAS', 'x'), col('share', 'Share', 'pct')],
      rows: camps.map(([c, v]) => [c, Math.round(v.cost * 100) / 100, Math.round(v.conv * 10) / 10,
             Math.round(v.value * 100) / 100, div(v.value, v.cost), Math.round(v.cost / totCost * 1000) / 10]),
      defaultSort: 1,
    });
  }

  // search terms (search80.csv)
  const st = rowsFor(key, 'search80').map(r => ({
    term: r.searchTerm, camp: r.campaign, cost: num(r.cost), conv: num(r.conversions),
    value: num(r.convValue), clicks: num(r.clicks), impr: num(r.impressions),
  })).sort((a, b) => b.cost - a.cost);
  if (st.length) top.push({
    id: 'searchterms', title: 'Top search terms', subtitle: 'by spend',
    cols: [col('term', 'Search term', 'text'), col('clicks', 'Clicks', 'int'), col('cost', 'Spend', 'money'),
           col('conv', 'Conv', 'num1'), col('value', 'Value', 'money'), col('roas', 'ROAS', 'x')],
    rows: st.slice(0, 10).map(r => [r.term, Math.round(r.clicks), Math.round(r.cost * 100) / 100,
           Math.round(r.conv * 10) / 10, Math.round(r.value * 100) / 100, div(r.value, r.cost)]),
    defaultSort: 2,
  });
  const waste = st.filter(r => r.conv < 1 && r.cost > 0);
  const wasteCost = waste.reduce((s, r) => s + r.cost, 0);
  const stCost = st.reduce((s, r) => s + r.cost, 0) || 1;
  if (waste.length) top.push({
    id: 'waste', title: 'Wasted spend', subtitle: 'search terms, zero conversions', tone: 'warn',
    cols: [col('term', 'Search term', 'text'), col('impr', 'Impr', 'int'), col('clicks', 'Clicks', 'int'), col('cost', 'Spend', 'money')],
    rows: waste.slice(0, 10).map(r => [r.term, Math.round(r.impr), Math.round(r.clicks), Math.round(r.cost * 100) / 100]),
    defaultSort: 3,
  });

  // keywords (keyword80.csv)
  const kw = rowsFor(key, 'keyword80').map(r => ({
    kw: r.keyword, match: r.matchType, cost: num(r.cost), conv: num(r.conversions),
    value: num(r.convValue), clicks: num(r.clicks), qs: num(r.qualityScore),
  })).sort((a, b) => b.cost - a.cost);
  if (kw.length) top.push({
    id: 'keywords', title: 'Top keywords', subtitle: 'by spend',
    cols: [col('kw', 'Keyword', 'text'), col('match', 'Match', 'text'), col('clicks', 'Clicks', 'int'),
           col('cost', 'Spend', 'money'), col('conv', 'Conv', 'num1'), col('roas', 'ROAS', 'x'), col('qs', 'QS', 'qs')],
    rows: kw.slice(0, 10).map(r => [r.kw, r.match || '', Math.round(r.clicks), Math.round(r.cost * 100) / 100,
           Math.round(r.conv * 10) / 10, div(r.value, r.cost), r.qs ? Math.round(r.qs) : null]),
    defaultSort: 3,
  });

  // products (productID.csv)
  const prodRows = rowsFor(key, 'productID');
  const prod = prodRows.map(r => ({
    p: r.productTitle || r.productId, cost: num(r.cost), conv: num(r.conversions), value: num(r.convValue), clicks: num(r.clicks),
  })).sort((a, b) => b.cost - a.cost);
  const zeroConvProducts = prodRows.filter(r => num(r.conversions) < 1 && num(r.cost) > 0).length;
  if (prod.length) top.push({
    id: 'products', title: 'Top products', subtitle: 'by spend',
    cols: [col('p', 'Product', 'text'), col('clicks', 'Clicks', 'int'), col('cost', 'Spend', 'money'),
           col('conv', 'Conv', 'num1'), col('value', 'Value', 'money'), col('roas', 'ROAS', 'x')],
    rows: prod.slice(0, 10).map(r => [r.p, Math.round(r.clicks), Math.round(r.cost * 100) / 100,
           Math.round(r.conv * 10) / 10, Math.round(r.value * 100) / 100, div(r.value, r.cost)]),
    defaultSort: 2,
  });

  // quality score spread (quality.csv)
  const qs = rowsFor(key, 'quality').map(r => num(r.qualityScore)).filter(v => v > 0);
  const lowQs = qs.filter(v => v <= 4).length;
  if (qs.length) {
    const buckets = {}; qs.forEach(v => { const b = Math.round(v); buckets[b] = (buckets[b] || 0) + 1; });
    const n = qs.length;
    top.push({
      id: 'quality', title: 'Quality Score spread',
      subtitle: `${n} keywords, avg ${Math.round(qs.reduce((s, v) => s + v, 0) / n * 10) / 10}`,
      cols: [col('qs', 'Quality Score', 'qs'), col('kw', 'Keywords', 'int'), col('pct', 'Share', 'pct')],
      rows: Array.from({ length: 10 }, (_, i) => 10 - i).filter(b => buckets[b])
        .map(b => [b, buckets[b], Math.round(buckets[b] / n * 1000) / 10]),
      defaultSort: 0,
    });
  }

  // badges for the cadence cards
  const badges = {
    'd-spend': null,
    'w-search': waste.length ? `${waste.length} to review` : null,
    'w-negatives': waste.filter(r => r.cost > 5).length ? `${waste.filter(r => r.cost > 5).length} candidates` : null,
    'f-products': zeroConvProducts ? `${zeroConvProducts} products` : null,
    'm-rsa': lowQs ? `${lowQs} low-QS keywords` : null,
  };
  const wastePct = Math.round(wasteCost / stCost * 1000) / 10;

  // Standup layer: the latest multi-agent verdict + whether a config exists yet
  // + the enabled campaigns a one-click set-up would scaffold from.
  const hasStandup = standup ? standup.hasStandupConfig(key) : false;
  const standupVerdict = standup ? standup.standupSummary(key) : null;
  const enabledCampaigns = standup ? standup.enabledCampaignsForKey(key) : [];

  return {
    account: key, name, currency, topTens: top, badges, wastePct,
    hasStandup, standup: standupVerdict, enabledCampaigns,
    dataHealth: dataHealth(key),
  };
}

module.exports = { listAccounts, buildBoardData, dataHealth, dataDirFor };
