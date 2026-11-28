import { useEffect, useMemo } from 'react';
import type { DayView, WorkItemOption } from '../../../../shared/time-contract.ts';
import { Icon } from '../../shell/Icon.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { ConnectPanel } from './ConnectPanel.tsx';
import { EntryRow, workItemName } from './EntryRow.tsx';
import { myDay, useMyDay } from './store.ts';
import { addDays, dateWords, hoursWords, londonClock, STATUS_TONE, STATUS_WORDS } from './words.ts';

/** How long Cortex keeps asking whether Toolbox has been allowed (plan 2026-11-28-time-my-day, decision 12). */
export const POLL_EVERY_MS = 2000;
export const POLL_FOR_MS = 10 * 60 * 1000;

type Line =
  | { kind: 'entry'; key: string; entry: DayView['entries'][number] }
  | { kind: 'gap'; key: string; minutes: number; startAt: string };

/** Entries in time order with the quiet gaps between them; entries with no clock time come last. */
export function timeline(day: DayView): Line[] {
  const timed: { at: number; line: Line }[] = [];
  const untimed: Line[] = [];
  for (const entry of day.entries) {
    const line: Line = { kind: 'entry', key: entry.id, entry };
    const at = entry.values.startAt ? Date.parse(entry.values.startAt) : Number.NaN;
    if (Number.isNaN(at)) untimed.push(line);
    else timed.push({ at, line });
  }
  for (const g of day.gaps) {
    const at = Date.parse(g.startAt);
    if (!Number.isNaN(at))
      timed.push({
        at: at + 0.5,
        line: { kind: 'gap', key: `gap-${g.startAt}`, minutes: g.minutes, startAt: g.startAt },
      });
  }
  timed.sort((a, b) => a.at - b.at);
  return [...timed.map((t) => t.line), ...untimed];
}

function Totals({ day, items }: { day: DayView; items: readonly WorkItemOption[] }) {
  if (day.totals.length === 0) return null;
  return (
    <section className="card" aria-labelledby="myday-totals-h">
      <div className="card-head">
        <h3 id="myday-totals-h">Totals by work item</h3>
      </div>
      <dl className="kv myday-totals">
        {day.totals.map((t) => (
          <div className="myday-total-row" key={t.workItemId ?? 'none'}>
            <dt>
              {workItemName(t.workItemId, items) ?? (t.workItemId ? 'Work item not loaded' : 'No work item')}
            </dt>
            <dd>
              {hoursWords(t.minutes)}
              {t.billableMinutes > 0 ? ` (${hoursWords(t.billableMinutes)} billable)` : ''}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** My day: one day of time, built from chats, edited here and confirmed into Toolbox. Owners and scouts only. */
export function MyDaySheet() {
  const s = useMyDay();
  const { state, dispatch, modes } = useShell();

  // Opening: the status first (it says whether Toolbox is connected), then the day.
  useEffect(() => {
    let live = true;
    void (async () => {
      const loaded = await myDay.loadStatus();
      const date = myDay.get().date;
      if (live && !loaded && date) await myDay.loadDay(date);
    })();
    return () => {
      live = false;
    };
  }, []);

  // Waiting for Allow in Toolbox: ask every 2 seconds, for up to 10 minutes.
  const pending = s.status?.connection.state === 'not-connected' && s.status.connection.pending;
  useEffect(() => {
    if (!pending) return;
    const until = Date.now() + POLL_FOR_MS;
    const timer = setInterval(() => {
      if (Date.now() > until) clearInterval(timer);
      else void myDay.loadStatus();
    }, POLL_EVERY_MS);
    return () => clearInterval(timer);
  }, [pending]);

  const lines = useMemo(() => (s.day ? timeline(s.day) : []), [s.day]);
  const status = s.status;
  const date = s.date;
  const day = s.day;

  const open = (id: string) => {
    myDay.edit(id);
    if (!state.panelOpen) dispatch({ type: 'set-panel', open: true });
  };
  const closeDock = modes.panelOverlays;
  const go = (to: string) => {
    if (closeDock) dispatch({ type: 'set-panel', open: false });
    void myDay.loadDay(to);
  };

  if (!status) {
    return (
      <div className="lib myday">
        {s.statusError ? (
          <p className="notice" data-shape="box" data-level="error" role="alert">
            My day can't be loaded right now. {s.statusError}{' '}
            <button type="button" className="btn" data-size="small" onClick={() => void myDay.loadStatus()}>
              Try again
            </button>
          </p>
        ) : (
          <p className="myday-note" role="status">
            Loading your day…
          </p>
        )}
      </div>
    );
  }

  const confirmed = day?.status === 'confirmed';
  const blocked =
    day?.confirmBlocked ?? (confirmed ? 'This day is confirmed. Change an entry to send it again.' : null);
  const atEarliest = !date || date <= status.earliest;
  const atToday = !date || date >= status.today;
  const reasonId = 'myday-reason';
  const disabled = s.busy || !day || blocked !== null || confirmed;

  return (
    <div className="lib myday">
      <div className="myday-head">
        <div className="myday-nav">
          <button
            type="button"
            className="icon-btn myday-prev"
            aria-label="Previous day"
            data-tip="Previous day"
            aria-disabled={atEarliest || undefined}
            onClick={() => {
              if (date && !atEarliest) go(addDays(date, -1));
            }}
          >
            <Icon name="chevron" size={18} />
          </button>
          <h2 className="myday-title" aria-live="polite">
            {date ? dateWords(date) : ''}
          </h2>
          <button
            type="button"
            className="icon-btn myday-next"
            aria-label="Next day"
            data-tip="Next day"
            aria-disabled={atToday || undefined}
            onClick={() => {
              if (date && !atToday) go(addDays(date, 1));
            }}
          >
            <Icon name="chevron" size={18} />
          </button>
          <button
            type="button"
            className="btn"
            data-size="small"
            aria-disabled={atToday || undefined}
            onClick={() => {
              if (!atToday) go(status.today);
            }}
          >
            Today
          </button>
        </div>
        {day ? (
          <div className="myday-summary">
            <span className="badge" data-tone={STATUS_TONE[day.status]}>
              {STATUS_WORDS[day.status]}
            </span>
            <span className="myday-sum">
              Day total <strong>{hoursWords(day.totalMinutes)}</strong>
            </span>
          </div>
        ) : null}
        <div className="myday-actions">
          {day && !confirmed ? (
            <button
              type="button"
              className="btn"
              aria-disabled={s.busy || undefined}
              onClick={() => void myDay.refresh()}
            >
              Refresh
            </button>
          ) : null}
          {day ? (
            <button
              type="button"
              className="btn"
              aria-disabled={s.busy || undefined}
              onClick={() => {
                myDay.edit('new');
                if (!state.panelOpen) dispatch({ type: 'set-panel', open: true });
              }}
            >
              Add entry
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            data-variant="primary"
            aria-disabled={disabled || undefined}
            aria-describedby={blocked ? reasonId : undefined}
            onClick={() => {
              if (!disabled) void myDay.confirm();
            }}
          >
            Confirm day
          </button>
        </div>
      </div>
      {blocked ? (
        <p className="myday-reason" id={reasonId}>
          {blocked}
        </p>
      ) : null}

      {s.notice ? (
        <p className="notice" data-shape="box" data-level={s.notice.tone} role="status">
          {s.notice.text}
        </p>
      ) : null}
      {day?.dayProblems.map((p) => (
        <p className="notice" data-shape="box" data-level="warn" key={p}>
          {p}
        </p>
      ))}
      {day?.captureNotes.map((n) => (
        <p className="myday-note" key={n}>
          {n}
        </p>
      ))}

      <ConnectPanel status={status} connectUrl={s.connectUrl} />

      {s.dayState === 'loading' && !day ? (
        <p className="myday-note" role="status">
          Loading your day…
        </p>
      ) : null}
      {s.dayState === 'error' ? (
        <p className="notice" data-shape="box" data-level="error" role="alert">
          This day can't be loaded right now. {s.dayError}{' '}
          <button
            type="button"
            className="btn"
            data-size="small"
            onClick={() => date && void myDay.loadDay(date)}
          >
            Try again
          </button>
        </p>
      ) : null}

      {day ? (
        <div className="tray lib-tray">
          <section className="card" aria-labelledby="myday-entries-h">
            <div className="card-head">
              <h3 id="myday-entries-h">Entries</h3>
              <span className="count">{day.entries.length}</span>
            </div>
            {lines.length === 0 ? (
              <p className="myday-note">
                Nothing recorded for this day yet. Add an entry, or refresh to read your chats again.
              </p>
            ) : (
              <ul className="lib-list">
                {lines.map((line) =>
                  line.kind === 'entry' ? (
                    <EntryRow
                      key={line.key}
                      entry={line.entry}
                      items={s.workItems}
                      current={s.editing === line.entry.id}
                      onOpen={() => open(line.entry.id)}
                    />
                  ) : (
                    <li className="myday-gap" key={line.key}>
                      {hoursWords(line.minutes)} with nothing recorded from {londonClock(line.startAt)}
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>
          <Totals day={day} items={s.workItems} />
        </div>
      ) : null}
    </div>
  );
}
