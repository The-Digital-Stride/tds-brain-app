const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** "due Friday", "due tomorrow", "overdue by 3 days" and so on, from a YYYY-MM-DD date. */
export function dueInWords(due: string, today: string = todayIso()): string {
  const d = dayNumber(due);
  const t = dayNumber(today);
  if (d === null || t === null) return '';
  const diff = d - t;
  if (diff < 0) return `overdue by ${-diff} ${diff === -1 ? 'day' : 'days'}`;
  if (diff === 0) return 'due today';
  if (diff === 1) return 'due tomorrow';
  if (diff < 7) return `due ${WEEKDAYS[new Date(d * DAY_MS).getUTCDay()]}`;
  const date = new Date(d * DAY_MS);
  return `due ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function isOverdue(due: string, today: string = todayIso()): boolean {
  const d = dayNumber(due);
  const t = dayNumber(today);
  return d !== null && t !== null && d < t;
}
