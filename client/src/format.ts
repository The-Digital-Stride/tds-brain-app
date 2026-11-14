import type { EffortLevel, LiveHelper } from '../../shared/contract.ts';
import { LEVEL_TIERS, type TurnLevel } from '../../shared/levels-contract.ts';

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

/** Effort as a list option under a label that already says "Effort": "Low", "Extra high". */
export const EFFORT_OPTION_WORDS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

/** "claude-opus-5-5" → "Opus 5.5". A model id it does not recognise is shown as it is. */
export function modelName(id: string): string {
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

/** A tier's model alias, said the way people say it: "sonnet" → "Sonnet". */
export function aliasName(alias: string): string {
  return alias.charAt(0).toUpperCase() + alias.slice(1);
}

/** Everything the level line under the message box says, from the newest `level` event. */
export interface LevelLineText {
  /** "Standard" (bold), or null when no tier applies. */
  tier: string | null;
  /** What follows it, e.g. "picked by the app for this chat". */
  note: string;
  /** One plain sentence for "Why?". */
  why: string;
  /** "Sonnet · Medium effort" for the tier, or null when no tier applies. */
  engine: string | null;
}

/**
 * The line for automatic mode, or null when the v0.19.0 engine line should stay (manual mode: the
 * person's own choice). A skill's own setting reads "Set by /name".
 */
export function levelLineText(level: TurnLevel): LevelLineText | null {
  const { tier, source } = level;
  const spec = tier ? LEVEL_TIERS[tier] : null;
  const engine = spec ? `${aliasName(spec.model)} · ${EFFORT_WORDS[spec.effort]}` : null;
  const label = spec?.label ?? null;
  switch (source.kind) {
    case 'manual':
      return null;
    case 'skill-own':
      return {
        tier: null,
        note: `Set by /${source.skill}`,
        why: `/${source.skill} sets its own model and effort, so the app leaves it alone.`,
        engine: null,
      };
    case 'team':
      return {
        tier: label,
        note: `for /${source.skill} · team level`,
        why: `Your team set ${label ?? 'a level'} for /${source.skill}.`,
        engine,
      };
    case 'chat':
      return { tier: label, note: 'your choice for this chat', why: 'You chose this for this chat.', engine };
    case 'fallback':
      return {
        tier: label,
        note: "the app's usual level",
        why: "The app couldn't pick in time, so it used Standard.",
        engine,
      };
    default:
      return { tier: label, note: 'picked by the app for this chat', why: source.reason, engine };
  }
}

/** Elapsed time in words: "40 s", "1 min 20 s", "1 h 3 min". Under a second, or negative, is "0 s". */
export function elapsedWords(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return s > 0 ? `${m} min ${s} s` : `${m} min`;
  return `${s} s`;
}

const HELPER_ENDED_WORDS = { done: 'Done', failed: 'Failed', stopped: 'Stopped' } as const;

/** A helper's quiet line: "Reading files · Quick · Haiku 5.5 · 1 min 20 s". Unknown parts are left out. */
export function helperMeta(h: LiveHelper, now: number): string {
  const parts: string[] = [];
  if (h.status === 'working') {
    // Said in words as well as by the dot, which screen readers skip.
    parts.push(h.lastStep || 'Working');
  } else {
    parts.push(HELPER_ENDED_WORDS[h.status]);
  }
  if (h.tier) parts.push(LEVEL_TIERS[h.tier].label);
  const model = h.model?.trim();
  if (model) parts.push(model.startsWith('claude-') ? modelName(model) : aliasName(model));
  const start = Date.parse(h.startedAt);
  const end = h.endedAt ? Date.parse(h.endedAt) : now;
  // Non-breaking spaces keep "1 min 20 s" on one line when the meta wraps.
  if (!Number.isNaN(start) && !Number.isNaN(end))
    parts.push(elapsedWords(end - start).replace(/ /g, '\u00a0'));
  return parts.join(' · ');
}
