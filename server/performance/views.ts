/**
 * Works out the 7, 30 and 90-day views from the stored history (plan decisions 5 and 11), so the browser never
 * sums rows. Sessions and agents are counted once per period with sets, never by adding up rows.
 */
import {
  type CodeModeSide,
  MODEL_PRICES,
  PERIODS,
  type PeriodDays,
  type PeriodFigures,
  type PeriodView,
  type UsageGroup,
  type UsageTotals,
} from '../../shared/performance-contract.ts';
import { localDate } from './reader.ts';
import type { Counts, PerformanceHistory } from './store.ts';

const GROUP_LIMIT = 30;

const zero = (): UsageTotals => ({
  requests: 0,
  input: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  output: 0,
  costUsd: 0,
  unpricedRequests: 0,
});

/** Cost of one cell of counts at the model's list price; null when the model has no price. */
function costOf(model: string, c: Counts): number | null {
  const p = MODEL_PRICES[model];
  if (!p) return null;
  return (c[1] * p.input + c[2] * p.write5m + c[3] * p.write1h + c[4] * p.read + c[5] * p.output) / 1e6;
}

function add(t: UsageTotals, model: string, c: Counts): void {
  t.requests += c[0];
  t.input += c[1];
  t.cacheWrite5m += c[2];
  t.cacheWrite1h += c[3];
  t.cacheRead += c[4];
  t.output += c[5];
  const cost = costOf(model, c);
  if (cost === null) t.unpricedRequests += c[0];
  else t.costUsd += cost;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const finish = (t: UsageTotals): UsageTotals => ({ ...t, costUsd: round(t.costUsd) });

/** Local dates `n` entries long ending at `end` (YYYY-MM-DD), oldest first. */
export function datesEndingAt(end: string, n: number): string[] {
  const [y, m, d] = end.split('-').map(Number) as [number, number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(localDate(new Date(y, m - 1, d - i, 12)));
  return out;
}

interface Group {
  label: string;
  ids: Set<string>;
  totals: UsageTotals;
}

function groupsOf(map: Map<string, Group>): UsageGroup[] {
  return [...map.entries()]
    .map(([key, g]) => ({ key, label: g.label, count: g.ids.size, totals: finish(g.totals) }))
    .sort((a, b) => b.totals.costUsd - a.totals.costUsd || b.totals.requests - a.totals.requests)
    .slice(0, GROUP_LIMIT);
}

function bump(
  map: Map<string, Group>,
  key: string,
  label: string,
  id: string,
  model: string,
  c: Counts,
): void {
  let g = map.get(key);
  if (!g) {
    g = { label, ids: new Set(), totals: zero() };
    map.set(key, g);
  }
  g.ids.add(id);
  add(g.totals, model, c);
}

function side(g: Group | undefined): CodeModeSide {
  const t = g?.totals ?? zero();
  const sessions = g?.ids.size ?? 0;
  const inputs = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
  return {
    sessions,
    requests: t.requests,
    inputPerRequest: t.requests > 0 ? Math.round(inputs / t.requests) : 0,
    costPerSession: sessions > 0 ? round(t.costUsd / sessions) : 0,
  };
}

export function figuresFor(history: PerformanceHistory, dates: string[]): PeriodFigures {
  const first = dates[0] as string;
  const last = dates[dates.length - 1] as string;
  const totals = zero();
  const daily = new Map(dates.map((d) => [d, { date: d, costUsd: 0, requests: 0 }]));
  const sessions = new Set<string>();
  const agents = new Set<string>();
  const byProject = new Map<string, Group>();
  const byModel = new Map<string, Group>();
  const byAgentType = new Map<string, Group>();
  const codeOn: Group = { label: '', ids: new Set(), totals: zero() };
  const codeOff: Group = { label: '', ids: new Set(), totals: zero() };

  for (const [fileKey, rec] of Object.entries(history.files)) {
    const project = rec.project ?? { key: 'unknown', label: 'Unknown' };
    const agentId = rec.agentId ?? fileKey;
    for (const [date, models] of Object.entries(rec.days)) {
      if (date < first || date > last) continue;
      const day = daily.get(date);
      for (const [model, c] of Object.entries(models)) {
        sessions.add(rec.sessionId);
        add(totals, model, c);
        if (day) {
          day.requests += c[0];
          day.costUsd += costOf(model, c) ?? 0;
        }
        bump(byProject, project.key, project.label, rec.sessionId, model, c);
        bump(byModel, model, MODEL_PRICES[model]?.label ?? model, rec.sessionId, model, c);
        if (rec.kind === 'agent') {
          agents.add(agentId);
          bump(byAgentType, rec.agentType ?? 'unknown', rec.agentType ?? 'Other agents', agentId, model, c);
        }
        const g = rec.codeMode ? codeOn : codeOff;
        g.ids.add(rec.sessionId);
        add(g.totals, model, c);
      }
    }
  }
  return {
    totals: finish(totals),
    sessions: sessions.size,
    agentsStarted: agents.size,
    byProject: groupsOf(byProject),
    byModel: groupsOf(byModel),
    byAgentType: groupsOf(byAgentType),
    codeMode: { on: side(codeOn), off: side(codeOff) },
    daily: [...daily.values()].map((d) => ({ ...d, costUsd: round(d.costUsd) })),
  };
}

/** First local date with any figures, or null. */
export function historyFrom(history: PerformanceHistory): string | null {
  let min: string | null = null;
  for (const rec of Object.values(history.files)) {
    for (const date of Object.keys(rec.days)) if (min === null || date < min) min = date;
  }
  return min;
}

/**
 * `previous` is filled only when it starts on or after `completeFrom`: an earliest date with figures says nothing
 * about whether the days around it are whole (Claude Code may have cleared logs before the first refresh).
 */
export function buildViews(history: PerformanceHistory, today: string): Record<`${PeriodDays}`, PeriodView> {
  const complete = history.completeFrom ?? null;
  const views = {} as Record<`${PeriodDays}`, PeriodView>;
  for (const days of PERIODS) {
    const dates = datesEndingAt(today, days);
    const prevDates = datesEndingAt(dates[0] as string, days + 1).slice(0, days);
    const covered = complete !== null && (prevDates[0] as string) >= complete;
    views[`${days}`] = {
      days,
      from: dates[0] as string,
      to: today,
      current: figuresFor(history, dates),
      previous: covered ? figuresFor(history, prevDates) : null,
    };
  }
  return views;
}
