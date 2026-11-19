/**
 * Pure rules for the Ads section (plan 2026-11-19-ads-workbench-sections, decisions 5, 6 and 8): account data
 * readiness, when a task is due, what needs the person on Ads Manager, and what is worth a look on the summary.
 * Types are in `ads-tools-contract.ts`. No React, no clock, no storage: the caller passes `now`.
 */
import type { AdsBoard, AdsHealthFile } from '../../../../shared/ads-contract.ts';
import type {
  DueState,
  DueStateFn,
  FileDot,
  NeedsYouFn,
  NeedsYouItem,
  Readiness,
  ReadinessFn,
  ReadinessGroup,
  ReadinessTone,
  WorthALookFn,
  WorthALookItem,
} from './ads-tools-contract.ts';
import { isLow } from './words.ts';

// ---------- Readiness ----------

const GROUP_ORDER = ['daily', 'search', 'products', 'deep'];
const GROUP_LABELS: Record<string, string> = {
  daily: 'Daily performance',
  search: 'Search',
  products: 'Shopping and products',
  deep: 'Deep dive',
};

function dotOf(status: string): FileDot {
  if (status === 'ok') return 'ok';
  if (status === 'na') return 'na';
  if (status === 'missing') return 'bad';
  // stale, wrong-shape and anything the app has not heard of: not red, but never green.
  return 'warn';
}

const toneOfDots = (dots: FileDot[]): ReadinessTone =>
  dots.includes('bad') ? 'bad' : dots.includes('warn') ? 'warn' : 'ok';

/**
 * The account's data state. `ok` only when every required file is ready (`na` counts as ready) and the daily fetch
 * has no problem. Null health, or no files at all (the set-up card shows then), gives null: no panel.
 */
export const readiness: ReadinessFn = (health) => {
  if (!health || !Array.isArray(health.files) || health.files.length === 0) return null;
  const byGroup = new Map<string, AdsHealthFile[]>();
  for (const f of health.files) byGroup.set(f.group, [...(byGroup.get(f.group) ?? []), f]);
  const names = [
    ...GROUP_ORDER.filter((g) => byGroup.has(g)),
    ...[...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g)),
  ];
  const groups: ReadinessGroup[] = names.map((group) => {
    const files = (byGroup.get(group) ?? []).map((file) => ({ file, dot: dotOf(file.status) }));
    const required = files.filter((f) => f.dot !== 'na');
    return {
      group,
      label: GROUP_LABELS[group] ?? group,
      tone: toneOfDots(files.map((f) => f.dot)),
      ready: required.filter((f) => f.dot === 'ok').length,
      required: required.length,
      files,
    };
  });
  const all = groups.flatMap((g) => g.files);
  let tone = toneOfDots(all.map((f) => f.dot));
  if (tone === 'ok' && health.fetch?.problem) tone = 'warn';
  const out: Readiness = {
    tone,
    ready: groups.reduce((n, g) => n + g.ready, 0),
    required: groups.reduce((n, g) => n + g.required, 0),
    notNeeded: all.filter((f) => f.dot === 'na').length,
    groups,
  };
  return out;
};

// ---------- Due state ----------

/** Whole local calendar days from the first to the second date (the clock time is ignored). */
const dayNumber = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

const ymd = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** A bare `YYYY-MM-DD` is a local day (`new Date` would read it as UTC midnight); anything else is an instant. */
function parseRun(at: string): Date | null {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(at);
  const d = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The first day of the month (or quarter) after the one `last` falls in. */
function nextPeriodStart(last: Date, monthsPer: 1 | 3): Date {
  const first = last.getMonth() - (last.getMonth() % monthsPer);
  return new Date(last.getFullYear(), first + monthsPer, 1);
}

/** Days from `due` to `today`, as a due state: due from the date, overdue from `overdueAfter` days later. */
function afterDue(sinceDue: number, overdueAfter: number | null): DueState {
  if (overdueAfter !== null && sinceDue >= overdueAfter) return { kind: 'overdue', days: sinceDue };
  return { kind: 'due' };
}

/**
 * When a task is due (decision 6). Local calendar days, thresholds inclusive; `days` on `overdue` counts from the
 * due date. Daily: due a day after the last run. Weekly: due at 7 days, overdue at 14. Fortnightly: due at 14,
 * overdue at 28. Monthly: due on the 1st after the last run, overdue 7 days later, `upcoming` before. Quarterly:
 * due on the next quarter's first day, `upcoming` before, never overdue (the plan sets no overdue point).
 * A last run in the future or unreadable gives null; never run (null) is due only for daily, and never overdue.
 */
export const dueState: DueStateFn = (cadence, lastRunAt, now) => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (lastRunAt === null) return cadence === 'daily' ? { kind: 'due' } : null;
  const last = parseRun(lastRunAt);
  if (!last) return null;
  const since = dayNumber(today) - dayNumber(last);
  if (since < 0) return null;
  switch (cadence) {
    case 'daily':
      return since >= 1 ? { kind: 'due' } : null;
    case 'weekly':
      return since >= 7 ? afterDue(since - 7, 7) : null;
    case 'fortnightly':
      return since >= 14 ? afterDue(since - 14, 14) : null;
    case 'monthly':
    case 'quarterly': {
      const due = nextPeriodStart(last, cadence === 'monthly' ? 1 : 3);
      const sinceDue = dayNumber(today) - dayNumber(due);
      if (sinceDue < 0)
        return { kind: 'upcoming', on: ymd(due.getFullYear(), due.getMonth(), due.getDate()) };
      return afterDue(sinceDue, cadence === 'monthly' ? 7 : null);
    }
    default:
      return null;
  }
};

/**
 * How many of a board's cards are due or overdue today (the drawer's "N due"). `localRunAt` is a run recorded in this
 * browser; the newer of it and the brain's `lastRun` counts.
 */
export function dueCount(
  cards: AdsBoard['cards'],
  now: Date,
  localRunAt?: (card: AdsBoard['cards'][number]) => string | null | undefined,
  standup?: { sharedAt: string | null | undefined; localAt: string | null | undefined } | null,
): number {
  const newer = (shared: string | null | undefined, local: string | null | undefined) =>
    shared && local ? (Date.parse(local) > Date.parse(shared) ? local : shared) : (local ?? shared ?? null);
  let n = 0;
  const count = (cadence: string, at: string | null) => {
    const s = dueState(cadence as Parameters<typeof dueState>[0], at, now);
    if (s && (s.kind === 'due' || s.kind === 'overdue')) n++;
  };
  for (const c of cards) count(c.cadence, newer(c.lastRun?.at ?? null, localRunAt?.(c) ?? null));
  // The Daily standup card is set up separately from `cards`, and is due on the daily rule.
  if (standup) count('daily', newer(standup.sharedAt, standup.localAt));
  return n;
}

// ---------- Needs you ----------

const TO_COMMAND = { kind: 'tool', tool: 'ads-command-centre', anchor: 'readiness' } as const;
const pluralOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What needs the person on Ads Manager (decision 5): verification findings of the latest pack (`act` is bad, `watch`
 * is warn, `info` is left out), account data problems from the board's health, and a month not yet signed off.
 * Bad before warn, each line with one target. Proposals (`open`) have their own tables, so they add no line here.
 */
export const needsYou: NeedsYouFn = ({ pack, monthly, health }) => {
  const items: NeedsYouItem[] = [];

  if (pack?.report) {
    (pack.verification ?? []).forEach((f, i) => {
      const tone = f.severity === 'act' ? 'bad' : f.severity === 'watch' ? 'warn' : null;
      if (!tone) return;
      items.push({
        id: `verify:${i}`,
        tone,
        text: f.title,
        sub: f.detail,
        action: 'Open report',
        target: { kind: 'report', path: pack.report },
      });
    });
  }

  if (health && Array.isArray(health.files)) {
    const missing = health.files.filter((f) => f.status === 'missing');
    const unsure = health.files.filter(
      (f) => f.status !== 'ok' && f.status !== 'na' && f.status !== 'missing',
    );
    const names = (fs: AdsHealthFile[]) => fs.map((f) => f.powers || f.file).join(', ');
    if (missing.length > 0)
      items.push({
        id: 'health:missing',
        tone: 'bad',
        text: `${pluralOf(missing.length, 'data file is', 'data files are')} missing`,
        sub: names(missing),
        action: 'Ads Command Centre',
        target: TO_COMMAND,
      });
    if (unsure.length > 0)
      items.push({
        id: 'health:stale',
        tone: 'warn',
        text: `${pluralOf(unsure.length, 'data file needs', 'data files need')} a look`,
        sub: names(unsure),
        action: 'Ads Command Centre',
        target: TO_COMMAND,
      });
    if (health.fetch?.problem)
      items.push({
        id: 'health:fetch',
        tone: 'warn',
        text: 'The daily data fetch has a problem',
        sub:
          health.fetch.errors > 0
            ? `It failed on ${health.fetch.errors} of ${health.fetch.total} datasets.`
            : `There has been no fetch for ${Math.round(health.fetch.ageHours / 24)} days.`,
        action: 'Ads Command Centre',
        target: TO_COMMAND,
      });
  }

  // A month still in progress can't be signed yet, so it isn't something to go and do.
  if (monthly && !monthly.signed && monthly.partial !== true)
    items.push({
      id: 'monthly',
      tone: 'warn',
      text: `${monthly.monthName || monthly.month} is not signed off`,
      sub: monthly.stale && monthly.reason ? monthly.reason : 'Read the report, then sign it off.',
      action: 'Go to monthly close',
      target: { kind: 'jump', anchor: 'close' },
    });

  return [...items.filter((i) => i.tone === 'bad'), ...items.filter((i) => i.tone === 'warn')];
};

// ---------- Worth a look ----------

/** Share of search spend with no conversions at which "Worth a look" says so (warn), and says so firmly (bad). */
export const WASTE_WARN_PCT = 10;
export const WASTE_BAD_PCT = 25;

/** What each deep-dive table lists, singular then plural; any other table says "rows". */
const NOUNS: Record<string, [string, string]> = {
  campaigns: ['campaign', 'campaigns'],
  searchterms: ['search term', 'search terms'],
  waste: ['search term', 'search terms'],
  keywords: ['keyword', 'keywords'],
  quality: ['keyword', 'keywords'],
  products: ['product', 'products'],
};

/**
 * What stands out in the deep-dive tables (decision 8), each line jumping to its table: wasted search spend,
 * rows that spent and returned under 1.00x, and Quality Scores of 4 or below. The same tests the tables use to flag
 * a cell (`isLow`). A table missing from the board gives no line. Bad before warn.
 */
export const worthALook: WorthALookFn = (board) => {
  const tables = Array.isArray(board.tables) ? board.tables : [];
  const items: WorthALookItem[] = [];

  const waste = tables.find((t) => t.id === 'waste');
  if (waste && typeof board.wastePct === 'number' && board.wastePct >= WASTE_WARN_PCT)
    items.push({
      id: 'waste',
      tone: board.wastePct >= WASTE_BAD_PCT ? 'bad' : 'warn',
      text: `${board.wastePct}% of search spend had no conversions`,
      table: waste.id,
      tableTitle: waste.title,
    });

  for (const t of tables) {
    const spendAt = t.cols.findIndex((c) => c.type === 'money' && (c.key === 'spend' || c.label === 'Spend'));
    const lowCount = (type: 'x' | 'qs') => {
      const at = t.cols.findIndex((c) => c.type === type);
      if (at < 0) return 0;
      const column = t.rows.map((r) => r[at] ?? null);
      return t.rows.filter((r) => {
        const spent = type === 'x' && spendAt >= 0 ? Number(r[spendAt]) > 0 : undefined;
        return isLow(r[at] ?? null, type, column, spent);
      }).length;
    };
    const noun = NOUNS[t.id] ?? ['row', 'rows'];
    const roas = lowCount('x');
    if (roas > 0)
      items.push({
        id: `roas:${t.id}`,
        tone: 'warn',
        text: `${roas} ${roas === 1 ? `${noun[0]} returns less than it` : `${noun[1]} return less than they`} cost (ROAS under 1.00x)`,
        table: t.id,
        tableTitle: t.title,
      });
    const qs = lowCount('qs');
    if (qs > 0)
      items.push({
        id: `qs:${t.id}`,
        tone: 'warn',
        text: `${qs} ${qs === 1 ? 'keyword has' : 'keywords have'} a Quality Score of 4 or below`,
        table: t.id,
        tableTitle: t.title,
      });
  }

  return [...items.filter((i) => i.tone === 'bad'), ...items.filter((i) => i.tone === 'warn')];
};
