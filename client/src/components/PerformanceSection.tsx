import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CODE_MODE_MIN_SESSIONS,
  type CodeModeSide,
  PERIODS,
  type PerformanceErrorCode,
  type PerformanceReport,
  type PeriodDays,
  type PeriodFigures,
  type PeriodView,
  type UsageGroup,
  type UsageTotals,
} from '../../../shared/performance-contract.ts';
import { api } from '../api.ts';
import { tokenWords } from '../format.ts';
import { HelpLink } from '../shell/HelpLink.tsx';
import { Seg } from '../shell/Seg.tsx';
import { StateNote } from '../shell/StateNote.tsx';
import { updateWhen } from '../shell/words.ts';
import '../styles/ad-manager.css';
import { AmTable } from '../tools/ad-manager/AmTable.tsx';
import type { Table } from '../tools/ad-manager/types.ts';
import { fmt } from '../tools/ad-manager/words.ts';

/** How often the report is asked for again while a refresh runs. */
export const POLL_MS = 3000;

const RANGE_LABELS: Record<`${PeriodDays}`, string> = {
  '7': '7 days',
  '30': '30 days',
  '90': '90 days',
};

const ERROR_WORDS: Record<PerformanceErrorCode, string> = {
  'logs-missing': "Claude Code's logs weren't found on this Mac",
  'read-failed': "the logs couldn't be read",
  'history-unreadable': "the saved history couldn't be read",
  'write-failed': "the new figures couldn't be saved",
};

/** Money as the report tables show it: US dollars, pence while small. */
const usd = (n: number) => fmt(n, 'money', 'USD', n < 100 ? 2 : 0);
/** Decimals for a whole column: chosen once from its largest figure, so the figures line up. */
const digitsFor = (max: number): 0 | 2 => (max < 100 ? 2 : 0);
const whole = (n: number) => Math.round(n).toLocaleString('en-GB');
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/** "12% less", "5% more" or "about the same". */
function compare(on: number, off: number): string {
  if (off <= 0) return 'about the same';
  const change = Math.round(((on - off) / off) * 100);
  if (Math.abs(change) < 2) return 'about the same';
  return `${Math.abs(change)}% ${change < 0 ? 'less' : 'more'}`;
}

/** The change against the previous period, in words; null when there is nothing to compare with. */
function changeWords(now: number, before: number, days: number, money = false): string {
  if (before === 0)
    return now === 0 ? 'No change on the previous period' : `None in the previous ${days} days`;
  const change = Math.round(((now - before) / before) * 100);
  const was = money ? usd(before) : whole(before);
  if (change === 0) return `No change from ${was} in the previous ${days} days`;
  return `${Math.abs(change)}% ${change < 0 ? 'down' : 'up'} from ${was} in the previous ${days} days`;
}

const share = (g: UsageGroup, total: number) => (total > 0 ? (g.totals.costUsd / total) * 100 : 0);

function projectTable(cur: PeriodFigures): Table {
  const total = cur.totals.costUsd;
  return {
    id: 'perf-projects',
    title: 'By project',
    subtitle: '',
    cols: [
      { key: 'project', label: 'Project', type: 'text' },
      { key: 'sessions', label: 'Sessions', type: 'int' },
      { key: 'requests', label: 'Requests', type: 'int' },
      { key: 'spend', label: 'Estimated cost', type: 'money' },
      { key: 'share', label: 'Share', type: 'pct' },
    ],
    rows: cur.byProject.map((g) => [g.label, g.count, g.totals.requests, g.totals.costUsd, share(g, total)]),
    defaultSort: 3,
  };
}

function modelTable(cur: PeriodFigures): Table {
  const total = cur.totals.costUsd;
  return {
    id: 'perf-models',
    title: 'By model',
    subtitle: '',
    cols: [
      { key: 'model', label: 'Model', type: 'text' },
      { key: 'sessions', label: 'Sessions', type: 'int' },
      { key: 'requests', label: 'Requests', type: 'int' },
      { key: 'spend', label: 'Estimated cost', type: 'money' },
      { key: 'share', label: 'Share', type: 'pct' },
    ],
    rows: cur.byModel.map((g) => [g.label, g.count, g.totals.requests, g.totals.costUsd, share(g, total)]),
    defaultSort: 3,
  };
}

function agentTable(cur: PeriodFigures): Table {
  const total = cur.totals.costUsd;
  return {
    id: 'perf-agents',
    title: 'Agents by type',
    subtitle: '',
    cols: [
      { key: 'type', label: 'Agent type', type: 'text' },
      { key: 'started', label: 'Started', type: 'int' },
      { key: 'requests', label: 'Requests', type: 'int' },
      { key: 'spend', label: 'Estimated cost', type: 'money' },
      { key: 'share', label: 'Share', type: 'pct' },
    ],
    rows: cur.byAgentType.map((g) => [
      g.label,
      g.count,
      g.totals.requests,
      g.totals.costUsd,
      share(g, total),
    ]),
    defaultSort: 3,
  };
}

function Summary({ view }: { view: PeriodView }) {
  const { current: cur, previous: prev, days } = view;
  const rows: { label: string; text: string; now: number; before: number | null; money?: boolean }[] = [
    {
      label: 'Estimated cost',
      text: usd(cur.totals.costUsd),
      now: cur.totals.costUsd,
      before: prev ? prev.totals.costUsd : null,
      money: true,
    },
    {
      label: 'Requests',
      text: whole(cur.totals.requests),
      now: cur.totals.requests,
      before: prev ? prev.totals.requests : null,
    },
    { label: 'Sessions', text: whole(cur.sessions), now: cur.sessions, before: prev ? prev.sessions : null },
    {
      label: 'Agents started',
      text: whole(cur.agentsStarted),
      now: cur.agentsStarted,
      before: prev ? prev.agentsStarted : null,
    },
  ];
  const unpriced = cur.totals.unpricedRequests;
  return (
    <section aria-labelledby="perf-summary-h">
      <div className="help-inline" data-heading="true">
        <h2 id="perf-summary-h">Summary</h2>
        <HelpLink page="performance" />
      </div>
      <dl className="kv">
        {rows.map((r) => (
          <SummaryRow key={r.label} {...r} days={days} />
        ))}
      </dl>
      {prev ? null : <p className="setting-help">No earlier figures yet</p>}
      <p className="setting-help">Estimated at API list prices; not your bill.</p>
      {unpriced > 0 ? (
        <p className="setting-help">
          {whole(unpriced)} {unpriced === 1 ? 'request' : 'requests'} on models with no price{' '}
          {unpriced === 1 ? "isn't" : "aren't"} in the cost.
        </p>
      ) : null}
    </section>
  );
}

function SummaryRow(r: {
  label: string;
  text: string;
  now: number;
  before: number | null;
  money?: boolean;
  days: number;
}) {
  return (
    <>
      <dt>{r.label}</dt>
      <dd>
        {r.text}
        {r.before === null ? null : (
          <span className="kv-note">{changeWords(r.now, r.before, r.days, r.money)}</span>
        )}
      </dd>
    </>
  );
}

interface DayRow {
  key: string;
  label: string;
  /** null: before the history is complete, so there is no figure to give. */
  cost: number | null;
}

/** 7 and 30 days stay daily; 90 days is one row per week (13 rows), each "Week of <first day>". */
function dailyRows(cur: PeriodFigures, days: PeriodDays, completeFrom: string | null): DayRow[] {
  const before = (date: string) => completeFrom !== null && date < completeFrom;
  if (days !== 90) {
    return cur.daily.map((d) => ({
      key: d.date,
      label: dayLabel(d.date),
      cost: before(d.date) ? null : d.costUsd,
    }));
  }
  const rows: DayRow[] = [];
  for (let i = 0; i < cur.daily.length; i += 7) {
    const week = cur.daily.slice(i, i + 7);
    const first = week[0];
    if (!first) continue;
    const empty = week.every((d) => before(d.date));
    rows.push({
      key: first.date,
      label: `Week of ${dayLabel(first.date)}`,
      cost: empty ? null : week.reduce((sum, d) => sum + d.costUsd, 0),
    });
  }
  return rows;
}

function Daily({
  cur,
  days,
  completeFrom,
}: {
  cur: PeriodFigures;
  days: PeriodDays;
  completeFrom: string | null;
}) {
  const rows = dailyRows(cur, days, completeFrom);
  const max = Math.max(0, ...rows.map((r) => r.cost ?? 0));
  const digits = digitsFor(max);
  return (
    <section aria-labelledby="perf-daily-h">
      <h2 id="perf-daily-h">{days === 90 ? 'Weekly' : 'Daily'}</h2>
      <p className="setting-help">
        {days === 90 ? 'Estimated cost for each week.' : 'Estimated cost for each day.'}
      </p>
      <ol className="perf-days">
        {rows.map((r) => (
          <li key={r.key} className="perf-day">
            <span className="perf-day-date">{r.label}</span>
            <span className="perf-day-track" aria-hidden="true">
              <span
                className="perf-day-bar"
                style={{ width: max > 0 && r.cost ? `${(r.cost / max) * 100}%` : '0%' }}
              />
            </span>
            <span className="perf-day-val" data-zero={!r.cost ? 'true' : undefined}>
              {r.cost === null ? '—' : fmt(r.cost, 'money', 'USD', digits)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Where({ cur }: { cur: PeriodFigures }) {
  const tables = [projectTable(cur), modelTable(cur), agentTable(cur)];
  return (
    <section aria-labelledby="perf-where-h">
      <h2 id="perf-where-h">Where it goes</h2>
      {tables.map((t) => (
        <div key={t.id} className="perf-table">
          <h3 className="setting-label">{t.title}</h3>
          {t.rows.length === 0 ? (
            <p className="setting-help">Nothing in this period.</p>
          ) : (
            <AmTable t={t} currency="USD" />
          )}
        </div>
      ))}
    </section>
  );
}

function SideFigures({ title, side }: { title: string; side: CodeModeSide }) {
  return (
    <>
      <h3 className="setting-label">{title}</h3>
      <dl className="kv">
        <dt>Sessions</dt>
        <dd>{whole(side.sessions)}</dd>
        <dt>Input per request</dt>
        <dd>{tokenWords(Math.round(side.inputPerRequest))} tokens</dd>
        <dt>Cost per session</dt>
        <dd>{usd(side.costPerSession)}</dd>
      </dl>
    </>
  );
}

function CodeMode({ cur }: { cur: PeriodFigures }) {
  const { on, off } = cur.codeMode;
  const enough = on.sessions >= CODE_MODE_MIN_SESSIONS && off.sessions >= CODE_MODE_MIN_SESSIONS;
  return (
    <section aria-labelledby="perf-code-h">
      <h2 id="perf-code-h">Code Mode</h2>
      <p className="setting-help">Sessions that used Code Mode, set beside those that didn't.</p>
      {enough ? (
        <p className="perf-verdict">
          Code Mode sessions averaged {compare(on.inputPerRequest, off.inputPerRequest)} input per request and{' '}
          {compare(on.costPerSession, off.costPerSession)} cost per session. The two groups did different
          work, so treat this as a rough guide.
        </p>
      ) : (
        <p className="setting-help">Too few Code Mode sessions to compare yet</p>
      )}
      <SideFigures title="Code Mode on" side={on} />
      <SideFigures title="Code Mode off" side={off} />
    </section>
  );
}

function Tokens({ totals }: { totals: UsageTotals }) {
  return (
    <section aria-labelledby="perf-tokens-h">
      <h2 id="perf-tokens-h">Tokens</h2>
      <p className="setting-help">
        Tokens are the small pieces of text Claude reads and writes. Reading again from memory costs far less
        than reading afresh.
      </p>
      <dl className="kv">
        <dt>Fresh input</dt>
        <dd>{tokenWords(totals.input)}</dd>
        <dt>Cache written</dt>
        <dd>{tokenWords(totals.cacheWrite5m + totals.cacheWrite1h)}</dd>
        <dt>Cache read</dt>
        <dd>{tokenWords(totals.cacheRead)}</dd>
        <dt>Output</dt>
        <dd>{tokenWords(totals.output)}</dd>
      </dl>
    </section>
  );
}

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; report: PerformanceReport };

/** Settings → Performance (plan 2026-11-28-settings-performance, decision 8). Owners and scouts only; the tab hides for others. */
export function PerformanceSection() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [days, setDays] = useState<PeriodDays>(30);
  const [asked, setAsked] = useState(false);
  const [updateFailed, setUpdateFailed] = useState(false);
  const live = useRef(true);
  const started = useRef(false);

  const take = useCallback((report: PerformanceReport) => {
    if (!live.current) return;
    setUpdateFailed(false);
    setLoad({ kind: 'ready', report });
  }, []);

  const refresh = useCallback(() => {
    setUpdateFailed(false);
    api
      .performanceRefresh()
      .then(take)
      .catch(() => {
        if (live.current) setUpdateFailed(true);
      });
  }, [take]);

  const first = useCallback(() => {
    setLoad({ kind: 'loading' });
    api
      .performance()
      .then((report) => {
        take(report);
        // Never run before: opening the tab starts the first build.
        if (report.status === 'never-run' && !report.refreshing) {
          setAsked(true);
          refresh();
        }
      })
      .catch(() => {
        if (live.current) setLoad({ kind: 'failed' });
      });
  }, [take, refresh]);

  useEffect(() => {
    live.current = true;
    if (!started.current) {
      started.current = true;
      first();
    }
    return () => {
      live.current = false;
    };
  }, [first]);

  const report = load.kind === 'ready' ? load.report : null;
  const busy = report ? report.refreshing || report.status === 'building' : false;

  // While a refresh runs, ask again every few seconds.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      api
        .performance()
        .then(take)
        .catch(() => {
          if (live.current) setUpdateFailed(true);
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [busy, take]);

  if (load.kind === 'loading') return <StateNote kind="loading" />;
  if (load.kind === 'failed' || !report) {
    return (
      <StateNote kind="error" onRetry={first}>
        Couldn't load the performance figures just now.
      </StateNote>
    );
  }

  const view = report.views?.[`${days}`];
  const building = (busy || (report.status === 'never-run' && asked)) && !report.views && !updateFailed;
  const failed = updateFailed || report.status === 'failed';
  const canUpdate = !busy || updateFailed;
  let statusText: string;
  if (building) {
    statusText = 'Building the first report…';
  } else if (updateFailed) {
    statusText = report.views ? "Couldn't start the update. Try again." : "Couldn't build the first report.";
  } else if (report.status === 'failed') {
    const why = `Couldn't update${report.error ? ` (${ERROR_WORDS[report.error]})` : ''}.`;
    const shown = report.updatedAt ? updateWhen(report.updatedAt) : '';
    statusText = report.views
      ? `This Mac only · ${why}${shown ? ` Showing figures from ${shown}.` : ''}`
      : why;
  } else {
    statusText = `This Mac only${report.updatedAt ? ` · Updated ${updateWhen(report.updatedAt)}` : ''}${busy ? ' · Updating…' : ''}`;
  }
  const noFigures = !report.views;
  return (
    <>
      <div className="perf-status">
        <p role="status" className="perf-status-text">
          {building ? <span className="spinner perf-spinner" aria-hidden="true" /> : null}
          {statusText}
        </p>
        {building ? null : (
          <button
            type="button"
            className="btn"
            data-variant="quiet"
            data-size="small"
            aria-disabled={canUpdate ? undefined : 'true'}
            onClick={() => {
              if (canUpdate) refresh();
            }}
          >
            {noFigures && failed ? 'Try again' : 'Update now'}
          </button>
        )}
      </div>

      {view ? (
        <>
          <Seg
            label="Period"
            value={`${days}` as `${PeriodDays}`}
            options={PERIODS.map((p) => ({ value: `${p}` as `${PeriodDays}`, label: RANGE_LABELS[`${p}`] }))}
            onChange={(v) => setDays(Number(v) as PeriodDays)}
          />
          {report.historyFrom === null ? null : (
            <p className="setting-help">
              {dayLabel(view.from)} to {dayLabel(view.to)}
            </p>
          )}
          {report.completeFrom !== null && report.completeFrom > view.from ? (
            <p className="setting-help">Figures start {dayLabel(report.completeFrom)}</p>
          ) : null}
          <Summary view={view} />
          <Daily cur={view.current} days={days} completeFrom={report.completeFrom} />
          <Where cur={view.current} />
          <CodeMode cur={view.current} />
          <Tokens totals={view.current.totals} />
          <p className="setting-help">Prices checked {dayLabel(report.pricesChecked)}.</p>
        </>
      ) : null}
    </>
  );
}
