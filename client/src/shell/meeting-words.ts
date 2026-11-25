/** Words for a meeting's date, time and people, shared by Home and the Projects app (Home mustn't pull the lazy Projects chunk). */

function parts(date: Date, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', opts).formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** "Tue 25 Nov, 14:30" (the person's own time zone). */
export function meetingWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = parts(d, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = parts(d, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day.weekday} ${day.day} ${day.month}, ${time.hour}:${time.minute}`;
}

/** The meeting's date as YYYY-MM-DD in the person's own time zone (for ordering beside to-do dates). */
export function meetingDate(iso: string): string {
  const d = new Date(iso);
  const p = parts(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** "14:30", 24-hour, in the person's own time zone. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const t = parts(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${t.hour}:${t.minute}`;
}

/** Parses a plain YYYY-MM-DD by hand (never through `new Date(string)`, which reads it as UTC); null when it isn't one. */
export function parseDay(day: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** "Wed 26 Nov" for a plain YYYY-MM-DD. */
export function dayWords(day: string): string {
  const p = parseDay(day);
  if (!p) return '';
  const w = parts(new Date(p.y, p.m - 1, p.d), { weekday: 'short', day: 'numeric', month: 'short' });
  return `${w.weekday} ${w.day} ${w.month}`;
}

/** Today's local date as YYYY-MM-DD. */
export function localDay(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "With Jo Smith, Sam Lee +2"; `lower` writes "with" for use after other words. */
export function withWords(m: { people: string[]; others: number }, lower = false): string {
  const names = m.people.join(', ');
  const extra = Math.max(0, m.others - m.people.length);
  const word = lower ? 'with' : 'With';
  if (!names) return m.others > 0 ? `${word} ${m.others} ${m.others === 1 ? 'other' : 'others'}` : '';
  return `${word} ${names}${extra > 0 ? ` +${extra}` : ''}`;
}

/** The start (local midnight, ms) of the calendar week holding `d`; weeks start on Monday (UK). */
export function weekStart(d: Date): number {
  const day = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
}

function dayDate(day: string): Date | null {
  const p = parseDay(day);
  return p ? new Date(p.y, p.m - 1, p.d) : null;
}

/**
 * A day heading in two parts: the name to scan for, then its date. "Today" / "Wed 25 Nov",
 * "Tomorrow" / "Thu 26 Nov", else "Friday" / "27 Nov".
 */
export function dayParts(day: string, now: number): { name: string; date: string } {
  const d = dayDate(day);
  if (!d) return { name: day, date: '' };
  const today = new Date(now);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diff = Math.round((d.getTime() - t0) / (24 * 60 * 60 * 1000));
  if (diff === 0) return { name: 'Today', date: dayWords(day) };
  if (diff === 1) return { name: 'Tomorrow', date: dayWords(day) };
  const w = parts(d, { weekday: 'long', day: 'numeric', month: 'short' });
  return { name: w.weekday ?? '', date: `${w.day} ${w.month}` };
}

/** Which calendar week a day falls in, from now: "This week", "Next week", else "Week of 7 Dec" (its Monday). */
export function weekLabel(day: string, now: number): string {
  const d = dayDate(day);
  if (!d) return '';
  const start = weekStart(d);
  const thisWeek = weekStart(new Date(now));
  if (start <= thisWeek) return 'This week';
  const nextWeek = new Date(thisWeek);
  nextWeek.setDate(nextWeek.getDate() + 7);
  if (start === nextWeek.getTime()) return 'Next week';
  const m = parts(new Date(start), { day: 'numeric', month: 'short' });
  return `Week of ${m.day} ${m.month}`;
}
