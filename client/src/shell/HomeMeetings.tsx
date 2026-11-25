import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CALENDAR_HOME_URL,
  HOME_MEETINGS_REFRESH_MS,
  type HomeMeeting,
  type HomeMeetingsResponse,
} from '../../../shared/home-meetings-contract.ts';
import { api } from '../api.ts';
import { projectPageRequest } from '../state/client-choice.ts';
import { useStore } from '../store.tsx';
import { InviteIcon, JoinLink, joinOpen } from './MeetingActions.tsx';
import { clockTime, dayParts, dayWords, localDay, parseDay, weekLabel, withWords } from './meeting-words.ts';
import { ShowMore } from './ShowMore.tsx';
import { StateNote } from './StateNote.tsx';
import type { CardDragProps } from './useCardOrder.tsx';
import { useNow } from './useNow.ts';

const HOUR = 60 * 60 * 1000;
/** Rows shown before "Show N more meetings" when today has fewer. */
const MEETING_ROWS = 3;

/** The day after a plain YYYY-MM-DD, by hand. */
function nextDay(day: string): string {
  const p = parseDay(day);
  if (!p) return day;
  return localDay(new Date(p.y, p.m - 1, p.d + 1).getTime());
}

/** Ended between two re-reads. An all-day meeting ends when the local date reaches its (exclusive) end. */
function ended(m: HomeMeeting, now: number): boolean {
  if (m.allDay) return localDay(now) >= (m.end ?? nextDay(m.start));
  const stop = m.end ? new Date(m.end).getTime() : new Date(m.start).getTime() + HOUR;
  return !Number.isNaN(stop) && now >= stop;
}

function inProgress(m: HomeMeeting, now: number): boolean {
  if (m.allDay || !m.end) return false;
  return new Date(m.start).getTime() <= now && now < new Date(m.end).getTime();
}

/** A day's heading: the name in navy to scan for ("Today", "Friday"), its date quieter beside it. */
function DayHeading({ day, now }: { day: string; now: number }) {
  const { name, date } = dayParts(day, now);
  return (
    <h4 className="meet-day">
      <span className="meet-day-name">{name}</span>
      {date ? (
        <>
          <span className="visually-hidden">, </span>
          <span className="meet-day-date">{date}</span>
        </>
      ) : null}
    </h4>
  );
}

/** "Calendar checked today at 08:12", "yesterday at 17:40" or "22 Nov"; stale adds the nudge. */
function checkedWords(iso: string | null, now: number, stale: boolean): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = localDay(d.getTime());
  const today = localDay(now);
  const yesterday = localDay(now - 24 * HOUR);
  let when: string;
  if (day === today) when = `today at ${clockTime(iso)}`;
  else if (day === yesterday) when = `yesterday at ${clockTime(iso)}`;
  else when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `Calendar checked ${when}.${stale ? ' Run /gm to update.' : ''}`;
}

function MeetingRow({
  m,
  now,
  onProject,
}: {
  m: HomeMeeting;
  now: number;
  onProject: (key: string) => void;
}) {
  const live = inProgress(m, now);
  const place: React.ReactNode[] = [];
  if (m.client) place.push(m.client.name);
  if (m.project) {
    if (place.length) place.push(' · ');
    place.push(
      <button
        key="project"
        type="button"
        className="link-btn"
        aria-label={`Open project ${m.project.title}`}
        onClick={() => m.project && onProject(m.project.key)}
      >
        {m.project.title}
      </button>,
    );
  }
  const people = withWords(m, place.length > 0);
  const until = m.allDay && m.lastDay ? `until ${dayWords(m.lastDay)}` : '';
  const meta: React.ReactNode[] = [];
  const add = (part: React.ReactNode) => {
    if (meta.length) meta.push(', ');
    meta.push(part);
  };
  if (place.length) add(<span key="place">{place}</span>);
  if (people) add(<span key="people">{people}</span>);
  if (until) add(<span key="until">{until}</span>);

  return (
    <li className="line home-meeting">
      <span className="meet-when">
        {m.allDay ? (
          <span className="meet-all">All day</span>
        ) : (
          <>
            <span className="meet-start">
              {live ? <span className="dot" data-attention="working" aria-hidden="true" /> : null}
              {live ? 'Now' : clockTime(m.start)}
            </span>
            {m.end ? (
              <span className="meet-end">
                <span className="visually-hidden"> to </span>
                {clockTime(m.end)}
              </span>
            ) : null}
          </>
        )}
      </span>
      <span className="line-text">
        <span className="line-title" title={m.title}>
          {m.title}
        </span>
        {meta.length ? <span className="line-meta">{meta}</span> : null}
      </span>
      <span className="meet-actions">
        {m.join && joinOpen(m, now) ? <JoinLink href={m.join} title={m.title} /> : null}
        <InviteIcon meeting={m} title={m.title} day={m.day} />
      </span>
    </li>
  );
}

/** Home's Meetings card: what's coming up in this person's own calendar, project or not. */
export function HomeMeetings({
  grip,
  cardProps,
}: {
  grip?: React.ReactNode;
  cardProps?: CardDragProps;
} = {}) {
  const { openView } = useStore();
  const [data, setData] = useState<HomeMeetingsResponse | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const loaded = useRef(false);
  const now = useNow(60_000);

  const read = useCallback(() => {
    Promise.resolve()
      .then(() => api.homeMeetings())
      .then((res) => {
        loaded.current = true;
        setData(res);
        setError(false);
      })
      .catch(() => {
        // A failed refresh keeps the rows; only a first read with nothing to show is an error.
        if (!loaded.current) setError(true);
      });
  }, []);

  useEffect(() => {
    read();
    const id = setInterval(read, HOME_MEETINGS_REFRESH_MS);
    return () => clearInterval(id);
  }, [read]);

  const openProject = (key: string) => {
    projectPageRequest.set(key);
    openView('app:projects');
  };

  const retry = () => {
    setError(false);
    read();
  };

  let body: React.ReactNode;
  if (error && !data) {
    body = (
      <StateNote kind="error" onRetry={retry}>
        Couldn't read your meetings.
      </StateNote>
    );
  } else if (!data) {
    body = <StateNote kind="loading" />;
  } else if (data.cache === 'none') {
    body = <StateNote kind="empty">Your meetings show here after /gm has checked your calendar.</StateNote>;
  } else {
    const checked = checkedWords(data.checked, now, data.cache === 'stale');
    const rows = data.meetings.filter((m) => !ended(m, now));
    const today = localDay(now);
    const todayCount = rows.filter((m) => m.day === today).length;
    // All of today, topped up to MEETING_ROWS with what comes next (design review: compact by default).
    const limit = Math.max(MEETING_ROWS, todayCount);
    const shown = expanded ? rows : rows.slice(0, limit);
    // Calendar weeks (Monday on), each holding its days: weeks after this one get a visible label on a hairline.
    const weeks: { label: string; days: { day: string; rows: HomeMeeting[] }[] }[] = [];
    for (const m of shown) {
      const label = weekLabel(m.day, now);
      let week = weeks[weeks.length - 1];
      if (!week || week.label !== label) {
        week = { label, days: [] };
        weeks.push(week);
      }
      const last = week.days[week.days.length - 1];
      if (last && last.day === m.day) last.rows.push(m);
      else week.days.push({ day: m.day, rows: [m] });
    }
    body = (
      <>
        {checked ? <p className="hint">{checked}</p> : null}
        {rows.length === 0 ? (
          <StateNote kind="empty">No meetings coming up in your calendar.</StateNote>
        ) : (
          <>
            {weeks.map((w) => (
              <div key={w.label} className="meet-week-group">
                {/* "This week" is for screen readers only: Today and Tomorrow already say it. */}
                <h3 className={w.label === 'This week' ? 'visually-hidden' : 'meet-week'}>{w.label}</h3>
                {w.days.map((g) => (
                  <div key={g.day} className="meet-group">
                    <DayHeading day={g.day} now={now} />
                    <ul className="drawer-list">
                      {g.rows.map((m) => (
                        <MeetingRow key={`${m.id}\u0000${m.start}`} m={m} now={now} onProject={openProject} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
            {rows.length > limit ? (
              <ShowMore
                expanded={expanded}
                count={rows.length - limit}
                noun={{ one: 'meeting', many: 'meetings' }}
                wording="more"
                onToggle={() => setExpanded((v) => !v)}
              />
            ) : null}
          </>
        )}
      </>
    );
  }

  return (
    <section className="card home-meetings" aria-labelledby="home-meetings" {...cardProps}>
      <div className="card-head">
        {grip}
        <h2 id="home-meetings">Meetings</h2>
        <a
          className="btn"
          data-variant="quiet"
          data-size="small"
          href={CALENDAR_HOME_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Google Calendar <span className="visually-hidden">(opens in a new tab)</span>
        </a>
      </div>
      {body}
    </section>
  );
}
