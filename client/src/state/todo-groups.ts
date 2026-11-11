import type { TodoItem } from '../../../shared/contract.ts';
import type { GroupTodos, TodoGroup, TodoGroupKey } from '../shell/contract.ts';

const DAY_MS = 86_400_000;
const TITLES: Record<TodoGroupKey, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  later: 'Later',
  none: 'No date',
};
const ORDER: TodoGroupKey[] = ['overdue', 'today', 'week', 'later', 'none'];

function dayNumber(iso: string | null): number | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

function keyFor(due: string | null, today: number | null): TodoGroupKey {
  const d = dayNumber(due);
  if (d === null || today === null) return 'none';
  const diff = d - today;
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  return diff <= 7 ? 'week' : 'later';
}

/** Groups by due date against `today`, keeping the order given. Empty groups are left out. */
export const groupTodos: GroupTodos = (items, today) => {
  const t = dayNumber(today);
  const buckets: Record<TodoGroupKey, TodoItem[]> = { overdue: [], today: [], week: [], later: [], none: [] };
  for (const item of items) buckets[keyFor(item.due, t)].push(item);
  return ORDER.filter((key) => buckets[key].length > 0).map(
    (key): TodoGroup => ({ key, title: TITLES[key], items: buckets[key] }),
  );
};
