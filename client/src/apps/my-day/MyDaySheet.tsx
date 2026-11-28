import { useEffect, useMemo, useRef } from 'react';
import type { DayView, WorkItemOption } from '../../../../shared/time-contract.ts';
import { Icon } from '../../shell/Icon.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { CONNECT_NOTICE_ID, ConnectPanel } from './ConnectPanel.tsx';
import { Duration } from './Duration.tsx';
import { EntryRow, workItemName } from './EntryRow.tsx';
import { myDay, useMyDay } from './store.ts';
import {
  addDays,
  dayTitle,
  emptyDayWords,
  endClock,
  londonClock,
  needsAttention,
  needWords,
  STATUS_TONE,
  STATUS_WORDS,
} from './words.ts';

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
              <Duration minutes={t.minutes} />
              {t.billableMinutes > 0 ? (
                <>
                  {' ('}
                  <Duration minutes={t.billableMinutes} />
                  {' billable)'}
                </>
              ) : null}
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

  // The window narrowed so the panel would float over the day: with nothing in it, it closes rather than
  // turn into an empty modal. Only on the change, so opening the panel deliberately still works.
  const overlays = modes.panelOverlays;
  const editing = s.editing;
  const panelOpen = state.panelOpen;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only when the panel starts to overlay.
  useEffect(() => {
    if (overlays && editing === null && panelOpen) dispatch({ type: 'set-panel', open: false });
  }, [overlays]);

  const lines = useMemo(() => (s.day ? timeline(s.day) : []), [s.day]);
  const status = s.status;
  const date = s.date;
  const day = s.day;
  const root = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const { guardPanel } = useShell();

  // Focus goes where the closed form asked for (its row, or the Add button) once the screen has drawn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `day` is here so the row exists when focus is asked for.
  useEffect(() => {
    if (!s.focusTo) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-focus="${CSS.escape(s.focusTo)}"]`);
    if (el) {
      el.focus();
      myDay.clearFocus();
    }
  }, [s.focusTo, s.day]);

  const showPanel = () => {
    if (!state.panelOpen) dispatch({ type: 'set-panel', open: true });
  };
  const open = (id: string) => {
    if (id === s.editing) return;
    guardPanel(() => {
      myDay.edit(id);
      showPanel();
    });
  };
  const closeDock = modes.panelOverlays;
  const go = (to: string) =>
    guardPanel(() => {
      if (closeDock) dispatch({ type: 'set-panel', open: false });
      void myDay.loadDay(to);
    });

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

  const connected = status.connection.state === 'connected';
  const confirmed = day?.status === 'confirmed';
  const blocked =
    day?.confirmBlocked ?? (confirmed ? 'This day is confirmed. Change an entry to send it again.' : null);
  // Not connected, the connect notice already says why the day can't be confirmed.
  const reason = connected ? blocked : null;
  const atEarliest = !date || date <= status.earliest;
  const atToday = !date || date >= status.today;
  const reasonId = 'myday-reason';
  const disabled = s.busy || !day || blocked !== null || confirmed;
  const describedBy = reason ? reasonId : connected ? undefined : CONNECT_NOTICE_ID;
  const needing = day ? day.entries.filter(needsAttention).length : 0;
  const plainStatus = day?.status === 'not-confirmed' && date === status.today;
  // A past day that was never confirmed is time that has not been sent: warn, not the quiet grey.
  const statusTone = !day
    ? 'muted'
    : day.status === 'not-confirmed' && date !== null && date < status.today
      ? 'warn'
      : STATUS_TONE[day.status];

  return (
    <div className="lib myday" ref={root}>
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
          <h2 className="myday-title" ref={title} tabIndex={-1} aria-live="polite">
            {date ? dayTitle(date, status.today) : ''}
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
          {atToday ? null : (
            <button
              type="button"
              className="btn"
              data-size="small"
              onClick={() => {
                // The button goes once the day is today, so focus moves to the date it opened.
                title.current?.focus();
                go(status.today);
              }}
            >
              Today
            </button>
          )}
        </div>
        {day ? (
          <div className="myday-summary">
            {plainStatus ? (
              <span className="myday-sum">{STATUS_WORDS[day.status]}</span>
            ) : (
              <span className="badge" data-tone={statusTone}>
                {STATUS_WORDS[day.status]}
              </span>
            )}
            <span className="todo-sep" aria-hidden="true">
              {' · '}
            </span>
            <span className="myday-sum">
              Day total{' '}
              <strong>
                <Duration minutes={day.totalMinutes} />
              </strong>
            </span>
            {needing > 0 ? (
              <>
                <span className="todo-sep" aria-hidden="true">
                  {' · '}
                </span>
                <span className="myday-sum">{needWords(needing, day.entries.length)}</span>
              </>
            ) : null}
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
          <button
            type="button"
            className="btn"
            data-variant="primary"
            aria-disabled={disabled || undefined}
            aria-describedby={describedBy}
            onClick={() => {
              if (!disabled) void myDay.confirm();
            }}
          >
            Confirm day
          </button>
        </div>
      </div>

      <ConnectPanel status={status} connectUrl={s.connectUrl} />

      {reason ? (
        <p className="myday-reason" id={reasonId}>
          {reason}
        </p>
      ) : null}

      {/* The live region is always here; the notice is put into it, so it is announced. */}
      <div className="myday-live" role="status">
        {s.notice ? (
          <p className="notice" data-shape="box" data-level={s.notice.tone}>
            {s.notice.text}
          </p>
        ) : null}
      </div>
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
              <button
                type="button"
                className="icon-btn"
                data-variant="primary"
                data-focus="myday:add"
                aria-label="Add an entry"
                data-tip="Add an entry"
                aria-disabled={s.busy || undefined}
                onClick={() =>
                  guardPanel(() => {
                    myDay.edit('new');
                    showPanel();
                  })
                }
              >
                <Icon name="plus" size={18} />
              </button>
            </div>
            {lines.length === 0 ? (
              <p className="myday-note">{emptyDayWords(confirmed)}</p>
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
                      {londonClock(line.startAt)}–{endClock(line.startAt, line.minutes)}
                      <span className="todo-sep" aria-hidden="true">
                        {' · '}
                      </span>
                      Nothing recorded (<Duration minutes={line.minutes} />)
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
