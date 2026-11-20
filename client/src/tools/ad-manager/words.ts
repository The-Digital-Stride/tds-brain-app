import {
  ADS_ERROR_MESSAGES,
  type AdsErrorCode,
  type ProposalSummary,
} from '../../../../shared/ads-contract.ts';
import { ApiFailure } from '../../api.ts';
import type { ColType } from './types.ts';

/** Statuses the Workbench lists as open (approvals-board.cjs OPEN). */
export const OPEN_STATUSES = new Set(['proposed', 'changes-requested', 'approved']);
export const isWaiting = (p: ProposalSummary) =>
  p.fm.status === 'proposed' || p.fm.status === 'changes-requested';

/** A status in plain words, sentence case: "changes-requested" reads "Changes requested". */
export const statusWords = (status: unknown): string => {
  const t = String(status ?? '')
    .replace(/[-_]/g, ' ')
    .trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
};

export const dayOf = (d: unknown): string => (d ? String(d).slice(0, 10) : '');

const ACTION_LABELS: Record<string, string> = {
  NONE: 'Hold',
  INVESTIGATE_ANOMALY: 'Investigate anomaly',
  AUDIT_SEARCH_TERMS: 'Audit search terms',
  ADD_NEGATIVES: 'Add negatives',
  REWRITE_RSAS: 'Rewrite RSAs',
  REFRESH_ASSETS: 'Refresh assets',
  REVIEW_KEYWORD_BIDS: 'Review bids',
  SHIFT_BUDGET_UP: 'Raise budget',
  SHIFT_BUDGET_DOWN: 'Cut budget',
  AUDIT_LANDING_PAGE: 'Audit landing page',
  PAUSE_CAMPAIGN: 'Pause campaign',
  RESTRUCTURE_AD_GROUPS: 'Restructure ad groups',
  REVIEW_FEED: 'Review feed',
  ADJUST_BIDDING_STRATEGY: 'Adjust bidding',
  DAYPARTING_ADJUSTMENT: 'Dayparting',
  GEO_ADJUSTMENT: 'Geo bids',
  DEVICE_ADJUSTMENT: 'Device bids',
  REVIEW_AUDIENCES: 'Review audiences',
  REVIEW_CONVERSION_TRACKING: 'Check tracking',
  OTHER: 'Other',
};
export function actionLabel(cat: string | null | undefined, labels: Record<string, string> = {}): string {
  if (!cat) return '';
  return (
    labels[cat] ??
    ACTION_LABELS[cat] ??
    cat
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}

/** Whole days since a YYYY-MM-DD date, or null. */
export function ageDays(date: string, now = Date.now()): number | null {
  const t = Date.parse(`${date}T00:00:00`);
  return Number.isNaN(t) ? null : Math.floor((now - t) / 86_400_000);
}

type Cell = string | number | null | undefined;
const isNum = (v: Cell): v is number | string =>
  v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));

/** Money decimals for a whole column: pence while its largest figure is under 100, else whole pounds. */
export function moneyDigits(values: Cell[]): 0 | 2 {
  let max = 0;
  for (const v of values) if (isNum(v)) max = Math.max(max, Math.abs(Number(v)));
  return max < 100 ? 2 : 0;
}

/** A currency amount in the account's own currency; a bad code falls back to a plain number with the code. */
function money(n: number, currency: string, digits: number): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    const num = n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return currency ? `${currency} ${num}` : num;
  }
}

/**
 * A cell as the Workbench shows it (column types: text, money, int, num1, x, pct, qs).
 * `digits` is the column's money decimals (see `moneyDigits`); a single value defaults to whole units.
 */
export function fmt(v: Cell, type: ColType, currency: string, digits: 0 | 2 = 0): string {
  if (v === null || v === undefined || v === '') return '—';
  if (type !== 'text' && !isNum(v)) return String(v);
  switch (type) {
    case 'money':
      return money(Number(v), currency, digits);
    case 'int':
      return Number(v).toLocaleString('en-GB');
    case 'num1':
      return Number(v).toFixed(1);
    case 'pct':
      return `${Number(v).toFixed(1)}%`;
    case 'x':
      return `${Number(v).toFixed(2)}x`;
    case 'qs': {
      const n = Number(v);
      return Number.isInteger(n) ? String(n) : n.toFixed(1);
    }
    default:
      return String(v);
  }
}

/** A true zero ("0.0", "£0") reads quieter. A ROAS of 0.00x is a result, so it keeps its colour. */
export function isQuietZero(v: Cell, type: ColType): boolean {
  return type !== 'text' && type !== 'x' && isNum(v) && Number(v) === 0;
}

/**
 * A value worth a second look: ROAS under 1.00x (once the column has any return) and Quality Score 4 or below.
 * `spent` is whether the row spent anything, when the table has a Spend column: a row that spent nothing has
 * a 0.00x ROAS with no return to judge, so it is never low.
 */
export function isLow(v: Cell, type: ColType, column: Cell[], spent?: boolean): boolean {
  if (!isNum(v)) return false;
  const n = Number(v);
  if (type === 'x') return spent !== false && n < 1 && column.some((c) => isNum(c) && Number(c) > 0);
  if (type === 'qs') return n <= 4;
  return false;
}

/** Sorts rows by column `idx`, as the board does: numbers by value, text A to Z, empty last. */
export function sortRows<T extends (string | number | null)[]>(
  rows: T[],
  idx: number,
  dir: 'asc' | 'desc',
): T[] {
  const s = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const va = a[idx];
    const vb = b[idx];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * s;
    return String(va).localeCompare(String(vb)) * s;
  });
}

/** What a failed ads call says to the person: the app's own words by code, else the server's sentence. */
export function adsErrorText(err: unknown): string {
  if (err instanceof ApiFailure) {
    const known = ADS_ERROR_MESSAGES[err.code as AdsErrorCode];
    if (known) return known;
    return err.message;
  }
  return ADS_ERROR_MESSAGES.internal;
}

/** slug -> name, from the bridge's `approvals.people` (Release 3). Absent from older skills. */
export type People = Readonly<Record<string, string>> | null | undefined;

/**
 * A person as the brain writes them (`pete-tyler`, a roster slug, or already a name) in words: their roster name when
 * the bridge sent one, else exactly as written. Only the map's own string values count, so a slug such as
 * `constructor` can't pick up an inherited property.
 */
export function personName(who: unknown, people?: People): string {
  const w = who == null ? '' : String(who).trim();
  if (!w || !people) return w;
  const key = w.toLowerCase();
  const name = Object.hasOwn(people, key) ? people[key] : undefined;
  return typeof name === 'string' && name.trim() ? name : w;
}

/** The decision column of Recent decisions, as the Workbench words it. */
export function decisionWords(
  fm: ProposalSummary['fm'],
  people?: People,
): {
  decision: string;
  note: string;
  when: string;
  by: string;
} {
  const f = fm as Record<string, unknown>;
  const when = dayOf(
    f.verified_at || f.applied_at || f.rejected_at || f.approved_at || f.voided_at || f.changes_requested_at,
  );
  const by = personName(f.rejected_by || f.approved_by || f.changes_requested_by || '', people);
  let decision = fm.status;
  let note = '';
  if (fm.status === 'rejected') note = String(f.rejection_reason ?? '');
  else if (fm.status === 'applied' || fm.status === 'verified' || fm.status === 'failed') {
    decision =
      fm.status === 'applied' ? (fm.type === 'decision' ? 'decided' : 'approved, applied') : fm.status;
    note = String(
      f.outcome ||
        (fm.status === 'applied'
          ? `Applied ${dayOf(f.applied_at)}; verification due after ${f.learning_window_days || 0} days`
          : ''),
    );
  } else if (fm.status === 'void') decision = 'expired unanswered';
  return { decision: statusWords(decision), note, when, by };
}

/** The key/value rows of a proposal's details, empty ones dropped (cc.js apprRows). Dates are in words. */
export function proposalFacts(
  p: ProposalSummary,
  now: Date = new Date(),
  people?: People,
): [string, string][] {
  const fm = p.fm as Record<string, unknown>;
  const s = (v: unknown) => (v == null ? '' : String(v));
  const named = (v: unknown) => personName(v, people);
  // "Pete Tyler, Tue 17 Nov": either part may be missing.
  const byOn = (by: unknown, at: unknown) => [named(by), day(at)].filter(Boolean).join(', ');
  const day = (v: unknown) => dateWords(v, now) || dayOf(v);
  let client = '';
  if (fm.needs_client_approval) {
    const who = s(fm.client_approver) || 'the client';
    if (fm.client_approved_at)
      client = `Yes from ${s(fm.client_approved_by)} (${day(fm.client_approved_at)}, recorded by ${named(fm.client_approval_recorded_by)})`;
    else if (fm.client_request_at)
      client = `Needed from ${who}. Request drafted ${day(fm.client_request_at)}${fm.client_request_gmail_draft_id ? ' (in Gmail drafts, not sent)' : ' (markdown only)'}. Waiting for their yes.`;
    else client = `Needed from ${who}. Request not drafted yet.`;
  }
  const evidence = Array.isArray(fm.evidence) ? (fm.evidence as unknown[]).join(', ') : s(fm.evidence);
  const campaigns = Array.isArray(fm.campaigns) ? (fm.campaigns as unknown[]).join(', ') : s(fm.campaigns);
  const expiry = dateWords(fm.expires, now);
  const rel = relativeWords(fm.expires, now);
  const rows: [string, string][] = [
    ['Status', statusWords(fm.status)],
    ['Tier', s(fm.tier)],
    ['Campaigns', campaigns],
    ['Section', s(fm.framework_section)],
    ['Type', s(fm.type)],
    ['Expires', expiry ? `${expiry}, ${rel}` : ''],
    ['Expected effect', s(fm.expected_effect)],
    ['Risk and rollback', s(fm.risk_notes)],
    [
      'Learning window',
      fm.learning_window_days
        ? `${fm.learning_window_days} days${fm.lock_type ? ` (${fm.lock_type} lock)` : ''}`
        : '',
    ],
    ['Operations file', s(fm.operations)],
    ['Executor', s(fm.executor)],
    ['Dry run', s(fm.dry_run)],
    ['Evidence', evidence],
    ['Client approval', client],
    ['Proposed', byOn(fm.created_by, fm.created_at)],
    ['Approved', fm.approved_by ? byOn(fm.approved_by, fm.approved_at) : ''],
    [
      'Changes requested',
      fm.changes_requested_by
        ? `${byOn(fm.changes_requested_by, fm.changes_requested_at)}: ${s(fm.changes_note)}`
        : '',
    ],
    ['Warnings', (p.warnings ?? []).join('; ')],
    ['Proposal ID', s(p.id || fm.id)],
  ];
  return rows.filter(([, v]) => v);
}

// ---------- Dates in words (Ads Manager, plan 2026-11-19 decision 5) ----------

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A YYYY-MM-DD (or longer ISO) date as a local calendar day, or null. */
function localDay(d: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d ?? ''));
  if (!m) return null;
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(day.getTime()) || day.getMonth() !== Number(m[2]) - 1 ? null : day;
}

/** Whole local calendar days from `now` to the date: 0 today, 1 tomorrow, -1 yesterday. Null for no date. */
export function daysFromNow(d: unknown, now: Date = new Date()): number | null {
  const day = localDay(d);
  if (!day) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((day.getTime() - today.getTime()) / DAY_MS);
}

/** "Mon 17 Nov", with the year only when it isn't this year. Empty for no date. */
export function dateWords(d: unknown, now: Date = new Date()): string {
  const day = localDay(d);
  if (!day) return '';
  const base = `${WEEKDAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]}`;
  return day.getFullYear() === now.getFullYear() ? base : `${base} ${day.getFullYear()}`;
}

/** "today", "tomorrow", "yesterday", "in 3 days", "3 days ago". Empty for no date. */
export function relativeWords(d: unknown, now: Date = new Date()): string {
  const n = daysFromNow(d, now);
  if (n === null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** "Today", "Tomorrow", "Yesterday", else "Mon 17 Nov". */
export function whenWords(d: unknown, now: Date = new Date()): string {
  const n = daysFromNow(d, now);
  if (n !== null && Math.abs(n) <= 1) {
    const r = relativeWords(d, now);
    return r.charAt(0).toUpperCase() + r.slice(1);
  }
  return dateWords(d, now);
}

/** Machine text made readable: every YYYY-MM-DD becomes "Mon 9 Nov". Anything else is left as it is. */
export function datesInWords(text: string, now: Date = new Date()): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (m) => dateWords(m, now) || m);
}

/** What an approved proposal needs next, in a few words, with the badge tone it takes. */
export function nextStepWords(p: ProposalSummary): { text: string; tone: 'ok' | 'draft' | 'waiting' | null } {
  const f = p.flags;
  const dry = String((p.fm as Record<string, unknown>).dry_run ?? '');
  if (f.inflight) return { text: 'Apply outcome unknown', tone: 'waiting' };
  if (/^(true|pass|passed|ok)/i.test(dry)) return { text: 'Dry run passed', tone: 'ok' };
  if (f.canClientDraft) return { text: 'Draft the email', tone: 'draft' };
  if (f.canDryRun) return { text: 'Dry run first', tone: 'draft' };
  if (f.canApply) return { text: 'Ready to apply', tone: 'ok' };
  if (f.canRecordDecision) return { text: 'Record the decision', tone: 'draft' };
  return { text: 'Waiting on someone else', tone: null };
}

// ---------- Release 2 ----------

/** "8 Nov", with the year only when it isn't this year. Empty for no date. */
export function shortDate(d: unknown, now: Date = new Date()): string {
  const day = localDay(d);
  if (!day) return '';
  const base = `${day.getDate()} ${MONTHS[day.getMonth()]}`;
  return day.getFullYear() === now.getFullYear() ? base : `${base} ${day.getFullYear()}`;
}

/** "10 Oct to 8 Nov": a totals range in words. */
export const rangeWords = (from: string, to: string, now: Date = new Date()): string =>
  `${shortDate(from, now) || from} to ${shortDate(to, now) || to}`;

const pounds = (n: number, currency: string, digits: 0 | 2) => {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(digits)}`;
  }
};

export type TotalsKey = 'spend' | 'conversions' | 'value' | 'roas' | 'cpa';
/** One totals figure as text. ROAS with nothing to divide, and CPA with no conversions, read "n/a". */
export function totalsValue(key: TotalsKey, n: number | null, currency: string): string {
  if (n === null) return 'n/a';
  if (key === 'conversions') return String(Math.round(n * 10) / 10);
  if (key === 'roas') return `${n.toFixed(2)}x`;
  return pounds(n, currency, key === 'cpa' ? 2 : 0);
}

export type ChangeTone = 'good' | 'bad' | 'neutral';
export interface TotalsChange {
  text: string;
  tone: ChangeTone;
  /** For screen readers, so colour isn't the only cue: ", better", ", worse" or "". */
  hidden: string;
}

/**
 * How a figure compares with the period before: "+12% vs £1,204". A previous figure of 0 has no percentage, so
 * it reads "vs £0". No previous range at all reads "No earlier data to compare". The tone says better or worse:
 * a lower CPA is better; spend going up or down is neither.
 */
export function totalsChange(
  key: TotalsKey,
  now: number | null,
  was: { value: number | null } | null,
  currency: string,
): TotalsChange {
  if (!was) return { text: 'No earlier data to compare', tone: 'neutral', hidden: '' };
  const before = totalsValue(key, was.value, currency);
  if (now === null || was.value === null || was.value === 0)
    return { text: `vs ${before}`, tone: 'neutral', hidden: '' };
  const pct = Math.round(((now - was.value) / was.value) * 100);
  const text = `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}% vs ${before}`;
  if (pct === 0 || key === 'spend') return { text, tone: 'neutral', hidden: '' };
  const better = key === 'cpa' ? pct < 0 : pct > 0;
  return { text, tone: better ? 'good' : 'bad', hidden: better ? ', better' : ', worse' };
}

/** A past month's status in words, for the Earlier months list. */
export function earlierMonthWords(
  m: {
    signed: boolean;
    stale: boolean;
    partial: boolean | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
    reason?: string | null;
  },
  people?: People,
): string {
  // monthly.cjs reviewState: a stamp that no longer matches the body is `signed: false, stale: true`.
  if (!m.signed && m.stale) {
    const why = m.reason?.trim().replace(/\.$/, '');
    return why ? `${why}, sign again` : 'Changed after sign-off, sign again';
  }
  if (m.signed) {
    const day = shortDate(m.reviewedAt);
    return `Signed off by ${personName(m.reviewedBy, people) || 'someone'}${day ? ` on ${day}` : ''}`;
  }
  if (m.partial) return 'Month-to-date draft';
  return 'Not signed off';
}

/** A triage row's second line: what the account's standup says. */
export function triageWords(row: {
  hasStandup: boolean;
  verdict: { headline: string | null } | null;
}): string {
  if (!row.hasStandup) return 'No standup set up';
  if (!row.verdict) return 'Not run yet';
  return row.verdict.headline?.trim() || 'Standup run';
}
