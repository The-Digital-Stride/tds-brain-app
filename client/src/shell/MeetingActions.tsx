import type { MeetingLinks } from '../../../shared/home-meetings-contract.ts';
import { Icon } from './Icon.tsx';
import { dayWords } from './meeting-words.ts';

const JOIN_LEAD_MS = 15 * 60 * 1000;
const FALLBACK_LENGTH_MS = 60 * 60 * 1000;

/** Join shows from 15 minutes before a timed meeting starts until it ends (an hour after, with no end given). */
export function joinOpen(
  m: { start: string; end: string | null; allDay?: boolean; join: string | null },
  now: number,
): boolean {
  if (!m.join || m.allDay) return false;
  const start = new Date(m.start).getTime();
  if (Number.isNaN(start)) return false;
  const end = m.end ? new Date(m.end).getTime() : Number.NaN;
  const until = Number.isNaN(end) ? start + FALLBACK_LENGTH_MS : end;
  return now >= start - JOIN_LEAD_MS && now < until;
}

/** "Open invite" (the event's own page), or "Open calendar" when all we have is the day view. A quiet small outside link. */
export function InviteLink({
  meeting,
  title,
  day,
}: {
  meeting: MeetingLinks;
  title: string;
  /** The meeting's local date (YYYY-MM-DD), named for the day-view link. */
  day: string;
}) {
  const isDay = meeting.calendarKind === 'day';
  return (
    <a
      className="btn"
      data-variant="quiet"
      data-size="small"
      href={meeting.calendar}
      target="_blank"
      rel="noopener noreferrer"
    >
      {isDay ? 'Open calendar' : 'Open invite'}{' '}
      <span className="visually-hidden">for {isDay ? dayWords(day) : title} (opens in a new tab)</span>
    </a>
  );
}

/** The video call link: a standard small outside link. */
export function JoinLink({ href, title }: { href: string; title: string }) {
  return (
    <a className="btn" data-size="small" href={href} target="_blank" rel="noopener noreferrer">
      Join <span className="visually-hidden">{title} (opens in a new tab)</span>
    </a>
  );
}

/**
 * Home's compact invite link (design review 2026-11-24): a 28px calendar icon, always last in the row. Same names as
 * InviteLink, given as aria-label, with a tooltip of the short label.
 */
export function InviteIcon({ meeting, title, day }: { meeting: MeetingLinks; title: string; day: string }) {
  const isDay = meeting.calendarKind === 'day';
  const label = isDay ? 'Open calendar' : 'Open invite';
  return (
    <a
      className="icon-btn"
      href={meeting.calendar}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} for ${isDay ? dayWords(day) : title} (opens in a new tab)`}
      data-tip={label}
    >
      <Icon name="calendar" />
    </a>
  );
}
