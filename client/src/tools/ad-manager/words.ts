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

/** The decision column of Recent decisions, as the Workbench words it. */
export function decisionWords(fm: ProposalSummary['fm']): {
  decision: string;
  note: string;
  when: string;
  by: string;
} {
  const f = fm as Record<string, unknown>;
  const when = dayOf(
    f.verified_at || f.applied_at || f.rejected_at || f.approved_at || f.voided_at || f.changes_requested_at,
  );
  const by = String(f.rejected_by || f.approved_by || f.changes_requested_by || '');
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

/** The key/value rows of a proposal's details, empty ones dropped (cc.js apprRows). */
export function proposalFacts(p: ProposalSummary): [string, string][] {
  const fm = p.fm as Record<string, unknown>;
  const s = (v: unknown) => (v == null ? '' : String(v));
  let client = '';
  if (fm.needs_client_approval) {
    const who = s(fm.client_approver) || 'the client';
    if (fm.client_approved_at)
      client = `Yes from ${s(fm.client_approved_by)} (${dayOf(fm.client_approved_at)}, recorded by ${s(fm.client_approval_recorded_by)})`;
    else if (fm.client_request_at)
      client = `Needed from ${who}. Request drafted ${dayOf(fm.client_request_at)}${fm.client_request_gmail_draft_id ? ' (in Gmail drafts, not sent)' : ' (markdown only)'}. Waiting for their yes.`;
    else client = `Needed from ${who}. Request not drafted yet.`;
  }
  const evidence = Array.isArray(fm.evidence) ? (fm.evidence as unknown[]).join(', ') : s(fm.evidence);
  const rows: [string, string][] = [
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
    ['Proposed by', `${s(fm.created_by)} ${dayOf(fm.created_at)}`.trim()],
    ['Approved', fm.approved_by ? `${s(fm.approved_by)} ${dayOf(fm.approved_at)}` : ''],
    [
      'Changes requested',
      fm.changes_requested_by
        ? `${s(fm.changes_requested_by)} ${dayOf(fm.changes_requested_at)}: ${s(fm.changes_note)}`
        : '',
    ],
    ['Warnings', (p.warnings ?? []).join('; ')],
  ];
  return rows.filter(([, v]) => v);
}
