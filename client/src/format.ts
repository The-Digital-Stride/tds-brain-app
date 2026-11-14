import type { EffortLevel } from '../../shared/contract.ts';

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

const EFFORT_WORDS: Record<EffortLevel, string> = {
  low: 'Low effort',
  medium: 'Medium effort',
  high: 'High effort',
  xhigh: 'Extra-high effort',
  max: 'Max effort',
};

/** "claude-opus-5-5" → "Opus 5.5". A model id it does not recognise is shown as it is. */
function modelName(id: string): string {
  const m = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(id);
  if (!m?.[1] || !m[2]) return id;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  const version = m[3] ? `${m[2]}.${m[3]}` : m[2];
  return `${family} ${version}${/\[1m\]/i.test(id) ? ' (1M context)' : ''}`;
}

/** The quiet line under a chat's message box, e.g. "Opus 5.5 · High effort"; null when nothing is known. */
export function engineLine(model: string | null, effort: EffortLevel | null): string | null {
  const parts: string[] = [];
  const id = model?.trim();
  if (id) parts.push(modelName(id));
  if (effort) parts.push(EFFORT_WORDS[effort]);
  return parts.length > 0 ? parts.join(' · ') : null;
}
