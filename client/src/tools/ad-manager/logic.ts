/**
 * Pure rules for the Ads section (plan 2026-11-19-ads-workbench-sections, decisions 5 and 8): account data
 * readiness, what needs the person on Ads Manager, and what is worth a look on the summary.
 * Types are in `ads-tools-contract.ts`. No React, no clock, no storage: the caller passes `now`.
 */
import type { AdsBoard, AdsHealthFile, AdsMonthly } from '../../../../shared/ads-contract.ts';
import type {
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
import { datesInWords, isLow } from './words.ts';

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

// ---------- Needs you ----------

const TO_COMMAND = { kind: 'tool', tool: 'ads-command-centre', anchor: 'readiness' } as const;
const pluralOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What needs the person on Ads Manager (decision 5): verification findings of the latest pack (`act` is bad, `watch`
 * is warn, `info` is left out), account data problems from the board's health, and a month not yet signed off.
 * Bad before warn, each line with one target. Proposals (`open`) have their own tables, so they add no line here.
 */
export const needsYou = ({
  pack,
  monthly,
  health,
  open,
  earlier,
}: Parameters<NeedsYouFn>[0] & {
  /** The months before `monthly` (ClientApprovals.earlierMonths). Absent from older skills. */
  earlier?: AdsMonthly[];
}): NeedsYouItem[] => {
  /** Machine text in words: ISO dates as "Mon 9 Nov", and a proposal's id as its title when it is open. */
  const plain = (t: string) => {
    let out = t;
    for (const p of open ?? []) if (p.id && p.fm?.title) out = out.split(p.id).join(p.fm.title);
    return datesInWords(out);
  };
  const items: NeedsYouItem[] = [];

  if (pack?.report) {
    (pack.verification ?? []).forEach((f, i) => {
      const tone = f.severity === 'act' ? 'bad' : f.severity === 'watch' ? 'warn' : null;
      if (!tone) return;
      items.push({
        id: `verify:${i}`,
        tone,
        text: plain(f.title),
        sub: plain(f.detail),
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

  // An earlier month nobody signed would otherwise be hidden in the Earlier months fold.
  for (const m of Array.isArray(earlier) ? earlier : [])
    if (m?.canSign === true && !m.signed && m.partial !== true)
      items.push({
        id: `monthly:${m.month}`,
        tone: 'warn',
        text: `${m.monthName || m.month} is not signed off`,
        sub: m.stale && m.reason ? m.reason : 'Read the report, then sign it off.',
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
const lowKeywords = (t: AdsBoard['tables'][number]): number => {
  const at = t.cols.findIndex((c) => c.type === 'qs');
  const kwAt = t.cols.findIndex((c) => c.key === 'kw');
  if (at < 0 || kwAt < 0) return 0;
  const column = t.rows.map((r) => r[at] ?? null);
  return t.rows
    .filter((r) => isLow(r[at] ?? null, 'qs', column))
    .reduce((n, r) => n + (Number(r[kwAt]) || 0), 0);
};

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
    // One Quality Score line, from the spread table: its rows are score bands with a Keywords count, so add up
    // the keywords in the low bands. Other tables' QS cells (Top keywords) would only repeat a subset of it.
    const qs = t.id === 'quality' ? lowKeywords(t) : 0;
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
