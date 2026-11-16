// PORTED from the brain Workbench: tools/members/command-centre/lib/standup-board.cjs (sha256 in ../../SOURCES.md).
// Copied for tdsapp-ads so Cortex works on a Mac that never runs the Workbench (plan 2026-11-16-workbench-ad-manager,
// decision 9). Never edit the logic here: when the source changes, copy it again and update SOURCES.md.
// Changes from the source: BRAIN_ROOT falls back to five folders up (this file sits in .claude/skills/tdsapp-ads/scripts/lib).
'use strict';
/*
 * Ads Command Board — Daily Standup layer.
 *
 * The standup skill (.claude/skills/standup/) runs a multi-agent debate over an
 * account's campaigns and writes its verdict to
 * clients/<key>/standup/<YYYYMMDD>/brief.json. This lib lets the Ads Command
 * Board:
 *   - tell whether an account has a standup config yet (so the Daily Standup
 *     card shows its "set up" vs "run" state),
 *   - scaffold a starter config in ONE click from the account's enabled
 *     campaigns (create-if-missing, never overwrites),
 *   - read the latest brief's one-line verdict (for the board + the MCC triage),
 *   - read the latest brief's per-campaign calls (for the Rate-calls modal), and
 *   - write per-call feedback the standup pipeline aggregates next run.
 *
 * Self-contained: a tiny CSV parser + plain fs. Drop-in for the member Workbench
 * server (tools/members/command-centre/), the sibling of ads-board-data.cjs.
 * The standup is READ-ONLY — it never changes a Google Ads account; this lib only
 * reads cached files and writes the user's own config/feedback into clients/.
 */
const fs = require('fs');
const path = require('path');
const N = require('./ads-normalize.cjs');
const { readTable, num, FILE_ALIASES } = N;

// command-centre/lib → up 4 = brain root. The server sets BRAIN_ROOT in env
// before requiring this (takes precedence); this is the standalone fallback.
const BRAIN_ROOT = process.env.BRAIN_ROOT || path.resolve(__dirname, '..', '..', '..', '..', '..');
const CLIENTS_DIR = path.join(BRAIN_ROOT, 'clients');
const ACCOUNTS_PATH = path.join(BRAIN_ROOT, '.claude', 'accounts.json');

// TDS unified layout (matches ads-board-data.cjs): the board reads the derived
// "view" CSVs generated from the canonical gads-context pull, which live in the
// SHARED clients/<key>/context/google-ads/board/ folder (synced to the team since
// 2026-11-10; Pete's Mac refreshes it) — NOT the shipped clients/<key>/data/. Keep this in step with ads-board-data.cjs.
const DATA_SUBPATH = ['context', 'google-ads', 'board'];

// Resolve a clients/ folder name (e.g. "urban-cooling") to its accounts.json
// entry, whose key may use underscores (e.g. "urban_cooling"). Try as-is, then
// the hyphen→underscore variant. (Mirrors cfgFor in ads-board-data.cjs.)
function cfgFor(cfg, key) {
  return cfg[key] || cfg[key.replace(/-/g, '_')] || null;
}

// An account's data folder. The standup config's `data_path` wins when set
// (matches ads-board-data.cjs so both read the same place); the TDS `board/`
// view is the fallback.
function dataDirFor(key) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(CLIENTS_DIR, key, 'standup', 'config.json'), 'utf8'));
    const rel = String(cfg.data_path || '').trim();
    if (rel) return path.isAbsolute(rel) ? rel : path.join(BRAIN_ROOT, rel);
  } catch { /* no standup config — use the default */ }
  return path.join(CLIENTS_DIR, key, ...DATA_SUBPATH);
}

// Tolerant read of a dataset (canonical name) for an account: honors data_path,
// accepts filename + header + micros variance, returns rows keyed by canonical
// field.
function rowsFor(key, dataset) {
  return readTable(dataDirFor(key), FILE_ALIASES[dataset] || []).rows;
}
function loadAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8')); } catch { return {}; }
}

// ---- standup config --------------------------------------------------------
function standupConfigPath(key) {
  return path.join(CLIENTS_DIR, key, 'standup', 'config.json');
}
function hasStandupConfig(key) {
  try { return fs.existsSync(standupConfigPath(key)); } catch { return false; }
}

// The account's enabled campaigns, biggest first, for the starter config.
// Prefers campSettings.csv (has a Status + Budget column); falls back to the
// distinct campaigns present in summary.csv when settings weren't pulled.
function enabledCampaignsForKey(key) {
  const settings = rowsFor(key, 'campSettings');
  if (settings.length) {
    const enabled = settings
      .filter(r => String(r.status || '').toUpperCase() === 'ENABLED' && r.campaign)
      .sort((a, b) => num(b.budgetAmount) - num(a.budgetAmount))
      .map(r => r.campaign);
    if (enabled.length) return enabled;
    // No status column (or nothing enabled): fall back to every campaign named.
    const all = [...new Set(settings.map(r => r.campaign).filter(Boolean))];
    if (all.length) return all;
  }
  const seen = new Set();
  rowsFor(key, 'summary').forEach(r => { if (r.campaign) seen.add(r.campaign); });
  return Array.from(seen);
}

// Build a starter config from accounts.json metadata + the enabled campaigns.
// Tiers default to weekly (nothing fires daily until the user promotes one),
// capped to the top 15. No-op if a config already exists.
function scaffoldStandupConfig(key, enabledCampaigns) {
  const file = standupConfigPath(key);
  if (fs.existsSync(file)) return { created: false, path: file, reason: 'exists' };

  const cfg0 = loadAccounts();
  const account = cfgFor(cfg0, key) || {};
  const campaigns = (enabledCampaigns || enabledCampaignsForKey(key) || []).slice(0, 15);
  const tiers = {};
  campaigns.forEach(c => { tiers[c] = 'weekly'; });
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const cfg = {
    client_name: key,
    google_ads_account_id: String(account.id || '').replace(/\D/g, '') || null,
    data_path: `clients/${key}/context/google-ads/board`,
    enabled_campaigns: campaigns,
    campaign_tiers: tiers,
    constraints: {
      currency: account.currency || null,
      cpa_target: account.target_cpa ?? null,
      roas_target: account.target_roas ?? null,
      monthly_budget_ceiling: account.monthly_budget ?? null,
      do_not_bid_terms: [],
      brand_voice: 'professional, no slang, no emojis',
    },
    context_refs: [`clients/${key}/profile.md`],
    tier_mapping: { default: 'v0-flat' },
    _notes: `Scaffolded from the Ads Command Board on ${today}. Tiers default to weekly — promote priority campaigns to daily and prune the rest. Fill in cpa_target / roas_target / monthly_budget_ceiling and any do_not_bid_terms.`,
  };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return { created: true, path: file, campaigns };
}

// ---- reading the latest brief ----------------------------------------------
const DATE_DIR_RX = /^\d{8}$/;

// Newest dated run that actually has a parseable brief.json. Today's folder
// often holds only evidence/ (analysts ran, full debate didn't), so walk back to
// the most recent real brief. Returns { ymd, date, brief } or null.
function readLatestStandupBrief(key) {
  const base = path.join(CLIENTS_DIR, key, 'standup');
  let dates;
  try { dates = fs.readdirSync(base).filter(d => DATE_DIR_RX.test(d)).sort().reverse(); }
  catch { return null; }
  for (const d of dates) {
    let brief;
    try { brief = JSON.parse(fs.readFileSync(path.join(base, d, 'brief.json'), 'utf8')); }
    catch { continue; }
    if (brief && typeof brief === 'object') {
      return { ymd: d, date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, brief };
    }
  }
  return null;
}

// Compact verdict for the board's verdict band + the MCC triage cell.
function standupSummary(key) {
  const r = readLatestStandupBrief(key);
  if (!r) return null;
  const b = r.brief;
  const verdicts = Array.isArray(b.per_campaign_verdicts) ? b.per_campaign_verdicts : [];
  const actions = Array.isArray(b.top_actions) ? b.top_actions : [];
  const flagged = verdicts.length
    ? verdicts.filter(v => v && v.action_category && v.action_category !== 'NONE').length
    : actions.length;
  const top = actions[0] || null;
  return {
    date: r.date,
    headline: b.headline || null,
    flagged,
    anomalies: Array.isArray(b.anomalies) ? b.anomalies.length : 0,
    topCampaign: top ? (top.campaign || null) : null,
    topAction: top ? (top.action_category || null) : null,
  };
}

// The per-campaign calls from the latest brief, for the Rate-calls modal.
function standupRecommendations(key) {
  const r = readLatestStandupBrief(key);
  if (!r) return null;
  const b = r.brief;
  const recs = (Array.isArray(b.per_campaign_verdicts) ? b.per_campaign_verdicts : []).map(v => ({
    campaign: v.campaign || '',
    action_category: v.action_category || 'NONE',
    reason: v.reason_one_line || '',
    priority: v.priority ?? null,
  }));
  return { ymd: r.ymd, date: r.date, headline: b.headline || null, recommendations: recs };
}

// ---- writing feedback ------------------------------------------------------
function campaignSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// Write one call's 1-5 + note to clients/<key>/standup/<ymd>/feedback-<slug>.json
// — the file the standup pipeline aggregates (per campaign + action_category)
// into the strategist's rolling 30-day score.
function writeStandupFeedback(key, { date, campaign, action_category, rating, note }) {
  const ymd = String(date || '').replace(/\D/g, '');
  if (!DATE_DIR_RX.test(ymd)) throw new Error('valid date (YYYYMMDD) required');
  const slug = campaignSlug(campaign);
  if (!slug) throw new Error('campaign required');
  const dir = path.join(CLIENTS_DIR, key, 'standup', ymd);
  if (!fs.existsSync(dir)) throw new Error(`no standup run on ${ymd} for ${key}`);
  const n = (rating === 0 || rating) ? Number(rating) : null;
  const payload = {
    client: key,
    date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
    campaign_slug: slug,
    campaign: campaign || null,
    action_category: action_category || null,
    submitted_at: new Date().toISOString(),
    rating: Number.isFinite(n) ? n : null,
    quick_note: (note || '').toString().slice(0, 2000),
  };
  const file = path.join(dir, `feedback-${slug}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
  return { file: `clients/${key}/standup/${ymd}/feedback-${slug}.json`, slug };
}

module.exports = {
  hasStandupConfig, enabledCampaignsForKey, scaffoldStandupConfig,
  readLatestStandupBrief, standupSummary, standupRecommendations, writeStandupFeedback,
};
