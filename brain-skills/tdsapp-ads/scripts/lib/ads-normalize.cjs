// PORTED from the brain Workbench: tools/members/command-centre/lib/ads-normalize.cjs (sha256 in ../../SOURCES.md).
// Copied for tdsapp-ads so Cortex works on a Mac that never runs the Workbench (plan 2026-11-16-workbench-ad-manager,
// decision 9). Never edit the logic here: when the source changes, copy it again and update SOURCES.md.
// Changes from the source: none (verbatim).
'use strict';
/*
 * Ads Command Board — data tolerance layer.
 *
 * Members feed the board Google Ads data in whatever shape their setup produces:
 *   - the 8020 script → Google Sheets → CSVs (clean headers: Cost, Conv, Value)
 *   - the Google Ads proxy / google-ads.yaml → query.cjs raw output
 *     (snake_case dotted headers: metrics.cost_micros, and cost in MICROS)
 *   - their own dated exports from some other tool (different names again)
 *
 * Rather than force everyone to reshape their data into one rigid contract
 * (which meant hand-building a wrapper), the board + Daily Standup READ
 * tolerantly: this module maps any reasonable header spelling to the canonical
 * field the code needs, auto-converts micros to currency, and resolves common
 * filename variants. The exact contract names are the primary aliases, so a
 * setup that already matches the contract keeps working unchanged.
 *
 * No dependencies. Shared by ads-board-data.cjs and standup-board.cjs.
 */
const fs = require('fs');
const path = require('path');

// ---- tiny CSV parser (quoted fields + commas inside quotes) ----------------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Normalize a header to bare lowercase alphanumerics: "Search Term" -> "searchterm",
// "metrics.cost_micros" -> "metricscostmicros", "ConvValue" -> "convvalue".
function normHeader(h) {
  return String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Canonical field -> the normalized header spellings we accept. Includes the
// clean contract names AND the raw GAQL/API names (so proxy output works as-is).
// Money fields additionally divide by 1e6 whenever the matched header contains
// "micros". Matching prefers an exact hit, then the LONGEST token that the
// header ends with (so "metricsconversionsvalue" resolves to convValue, not
// conversions, and "convvalue" never resolves to conversions).
const FIELD_TOKENS = {
  date:         ['date', 'day', 'segmentsdate'],
  campaign:     ['campaign', 'campaignname'],
  campaignId:   ['campaignid'],
  adGroup:      ['adgroup', 'adgroupname'],
  keyword:      ['keyword', 'keywordtext', 'criteria', 'adgroupcriterionkeywordtext'],
  matchType:    ['matchtype', 'keywordmatchtype', 'adgroupcriterionkeywordmatchtype'],
  searchTerm:   ['searchterm', 'searchtermviewsearchterm', 'segmentssearchterm', 'query'],
  productId:    ['productid', 'productitemid', 'segmentsproductitemid'],
  productTitle: ['producttitle', 'productname', 'segmentsproducttitle', 'producttypel1'],
  url:          ['url', 'landingpage', 'unexpandedfinalurl', 'finalurl', 'page', 'landingpageviewunexpandedfinalurl'],
  location:     ['location', 'locationname', 'geo', 'country', 'countrycriterionid'],
  type:         ['type', 'locationtype'],
  state:        ['state', 'region'],
  status:       ['status', 'campaignstatus', 'adgroupstatus'],
  channel:      ['channel', 'advertisingchanneltype', 'campaignadvertisingchanneltype'],
  subChannel:   ['subchannel', 'advertisingchannelsubtype'],
  bidStrategy:  ['bidstrategy', 'biddingstrategytype', 'campaignbiddingstrategytype', 'strategy'],
  // Bid targets: the portal-contract CSVs spell these targetCpa/targetRoas on
  // campSettings and tcpaTarget/troasTarget on on_settings; fetch.py wrote
  // "Target CPA"/"Target ROAS". All four spellings mean the same number.
  targetCpa:    ['targetcpa', 'tcpatarget', 'targetcpamicros'],
  targetRoas:   ['targetroas', 'troastarget'],
  // Quality sub-scores. "Landing Page Exp" (fetch.py) → "Landing Exp" (contract).
  landingExp:   ['landingexp', 'landingpageexp', 'landingpageexperience'],
  adRelevance:  ['adrelevance', 'creativequalityscore'],
  expectedCtr:  ['expectedctr', 'searchpredictedctr'],
  qualityScore: ['qualityscore', 'qs', 'metricsqualityscore', 'adgroupcriterionqualityinfoqualityscore', 'historicalqualityscore'],
  week:         ['week', 'segmentsweek'],
  fieldType:    ['fieldtype', 'assetfieldtype'],
  asset:        ['asset', 'assetresource', 'assetid', 'text'],
  categoryLabel:['categorylabel', 'category', 'label'],
  budgetName:   ['budgetname'],
  impressions:  ['impressions', 'impr', 'imprs', 'metricsimpressions'],
  clicks:       ['clicks', 'click', 'metricsclicks'],
  conversions:  ['conversions', 'conv', 'convs', 'metricsconversions'],
  cost:         ['cost', 'spend', 'costmicros', 'metricscostmicros'],
  convValue:    ['convvalue', 'value', 'conversionsvalue', 'conversionvalue', 'convervalue', 'metricsconversionsvalue', 'allconversionsvalue'],
  budgetAmount: ['budgetamount', 'budget', 'amountmicros', 'budgetamountmicros', 'campaignbudgetamountmicros'],
};

// Fields whose value is money and should be divided by 1e6 when the source
// header is in micros.
const MONEY_FIELDS = new Set(['cost', 'convValue', 'budgetAmount', 'targetCpa']);

// Resolve a header array to { field: { index, micros } }. First/longest wins.
function resolveHeaders(header) {
  const norm = header.map(normHeader);
  const resolved = {};
  const claimed = {}; // field -> matched token length, so a better header can win
  norm.forEach((h, index) => {
    if (!h) return;
    let best = null; // { field, len }
    for (const [field, tokens] of Object.entries(FIELD_TOKENS)) {
      for (const t of tokens) {
        const exact = h === t;
        const suffix = h.length > t.length && t.length >= 4 && h.endsWith(t);
        if (!exact && !suffix) continue;
        const len = exact ? 1000 + t.length : t.length; // exact always beats suffix
        if (!best || len > best.len) best = { field, len, token: t };
      }
    }
    if (!best) return;
    // Only claim if this header is a better match for the field than a prior one.
    if (claimed[best.field] === undefined || best.len > claimed[best.field]) {
      claimed[best.field] = best.len;
      resolved[best.field] = { index, micros: MONEY_FIELDS.has(best.field) && /micros/.test(h) };
    }
  });
  return resolved;
}

// Given a data dir and an ordered list of candidate filenames, return the path
// of the first one that exists (case-insensitively).
function resolveFile(dir, candidates) {
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return null; }
  const lc = new Map(entries.map(e => [e.toLowerCase(), e]));
  for (const cand of candidates) {
    const hit = lc.get(String(cand).toLowerCase());
    if (hit) return path.join(dir, hit);
  }
  return null;
}

// Read a table from `dir`, trying each filename in `candidates`. Returns
// { file, header, resolved, rows } where every row is an object keyed by
// CANONICAL field name (money already converted out of micros), plus `_raw`
// keyed by the original headers. Missing file → { file:null, rows:[] }.
function readTable(dir, candidates) {
  const p = resolveFile(dir, candidates);
  if (!p) return { file: null, header: [], resolved: {}, rows: [] };
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return { file: p, header: [], resolved: {}, rows: [] }; }
  const grid = parseCsv(raw);
  if (grid.length < 2) return { file: p, header: grid[0] || [], resolved: {}, rows: [] };
  const header = grid[0].map(h => String(h).trim());
  const resolved = resolveHeaders(header);
  const rows = grid.slice(1)
    .filter(r => r.length >= header.length - 1)
    .map(r => {
      const o = { _raw: {} };
      header.forEach((h, i) => { o._raw[h] = r[i]; });
      for (const [field, info] of Object.entries(resolved)) {
        let v = r[info.index];
        if (info.micros && v != null && v !== '') {
          const f = parseFloat(String(v).replace(/[^0-9eE.+-]/g, ''));
          if (Number.isFinite(f)) v = String(f / 1e6);
        }
        o[field] = v;
      }
      return o;
    });
  return { file: p, header, resolved, rows };
}

// Which canonical fields does this header carry? (for tolerant health checks)
function fieldsPresent(header) {
  return new Set(Object.keys(resolveHeaders(header)));
}

const num = (x) => {
  if (x == null) return 0;
  const n = parseFloat(String(x).trim().replace(/[$£€,%]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// Canonical dataset -> filename spellings we accept (case-insensitive), most
// specific first. The exact contract filename is always first, so an existing
// setup is unaffected; the rest catch the common variants members produce.
const FILE_ALIASES = {
  dailyPerf:  ['dailyPerf.csv', 'daily_perf.csv', 'daily.csv', 'performance.csv', 'perf.csv'],
  summary:    ['summary.csv', 'campaigns.csv', 'campaign.csv', 'campaign_daily.csv', 'campaign_performance.csv'],
  search80:   ['search80.csv', 'search_terms.csv', 'searchterms.csv', 'search_term.csv', 'search_term_view.csv', 'searchquery.csv'],
  keyword80:  ['keyword80.csv', 'keywords.csv', 'keyword.csv', 'keyword_view.csv'],
  quality:    ['quality.csv', 'quality_score.csv', 'quality_scores.csv', 'qualityscore.csv'],
  productID:  ['productID.csv', 'productId.csv', 'products.csv', 'product.csv', 'shopping.csv', 'shopping_products.csv', 'shopping_performance.csv'],
  geo:        ['geo_locations.csv', 'geo.csv', 'geographic.csv', 'locations.csv', 'geo_location.csv', 'geographic_view.csv'],
  pages:      ['pages.csv', 'landing_pages.csv', 'landingpages.csv', 'landing_page.csv', 'landing_page_view.csv'],
  assetFatigue: ['assetFatigue.csv', 'asset_fatigue.csv', 'assets.csv', 'asset_performance.csv', 'rsa_assets.csv'],
  campSettings: ['campSettings.csv', 'camp_settings.csv', 'campaign_settings.csv', 'settings.csv'],
  budgets:    ['campaign_budgets.csv', 'budgets.csv', 'campaignBudgets.csv', 'budget.csv'],
  pmaxCat:    ['im_pmax_categories.csv', 'pmax_categories.csv', 'pmaxCategories.csv'],
  pmaxST:     ['im_pmax_search_terms.csv', 'pmax_search_terms.csv', 'pmaxSearchTerms.csv'],
};

// Human labels for canonical fields, for "wrong shape — missing X" messages.
const FIELD_LABELS = {
  date: 'Date', campaign: 'Campaign', adGroup: 'Ad Group', keyword: 'Keyword',
  matchType: 'Match Type', searchTerm: 'Search Term', productId: 'Product ID',
  productTitle: 'Product Title', url: 'URL', location: 'Location',
  qualityScore: 'Quality Score', impressions: 'Impressions', clicks: 'Clicks',
  conversions: 'Conversions', cost: 'Cost', convValue: 'Conv value', budgetAmount: 'Budget',
};

module.exports = {
  parseCsv, normHeader, resolveHeaders, resolveFile, readTable, fieldsPresent,
  num, FIELD_TOKENS, FILE_ALIASES, FIELD_LABELS,
};
