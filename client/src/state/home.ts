import type { HomeLogic } from '../shell/contract.ts';

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

export const needsYou: HomeLogic['needsYou'] = (mine, today) => {
  const t = dayNumber(today);
  const due = (d: string | null): number | null => (d === null ? null : dayNumber(d));
  const urgent =
    t === null
      ? []
      : mine
          .map((item) => ({ item, day: due(item.due) }))
          .filter((x): x is { item: (typeof mine)[number]; day: number } => x.day !== null && x.day <= t + 1)
          // Array.prototype.sort is stable, so equal dates keep the order given.
          .sort((a, b) => a.day - b.day)
          .map((x) => x.item);
  const rows = urgent.slice(0, 4);
  return { rows, count: urgent.length, more: mine.length - rows.length };
};

export const greeting: HomeLogic['greeting'] = (now, fullName) => {
  const hour = now.getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  return first ? `${hello}, ${first}` : hello;
};

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const summary: HomeLogic['summary'] = ({ overdue, dueToday, asking }) => {
  const parts: string[] = [];
  if (overdue > 0) parts.push(overdue === 1 ? 'one to-do is overdue' : `${overdue} to-dos are overdue`);
  if (dueToday > 0) {
    if (overdue > 0) parts.push(dueToday === 1 ? 'one is due today' : `${dueToday} are due today`);
    else parts.push(dueToday === 1 ? 'one to-do is due today' : `${dueToday} to-dos are due today`);
  }
  if (asking > 0)
    parts.push(asking === 1 ? 'one chat is waiting for you' : `${asking} chats are waiting for you`);
  if (parts.length === 0) return 'Nothing is waiting for you.';
  const joined =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${capital(joined ?? '')}.`;
};
