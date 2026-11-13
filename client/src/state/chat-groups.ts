import type { PastSession } from '../../../shared/contract.ts';

export type ChatGroupKey = 'today' | 'week' | 'earlier';
export interface ChatGroup {
  key: ChatGroupKey;
  title: string;
  items: PastSession[];
}

const DAY_MS = 86_400_000;
const TITLES: Record<ChatGroupKey, string> = { today: 'Today', week: 'This week', earlier: 'Earlier' };
const ORDER: ChatGroupKey[] = ['today', 'week', 'earlier'];

const dayNumber = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);

/**
 * Groups earlier chats by the calendar day of their last activity: today, the 6 days before (this week),
 * the rest. Keeps the order given; empty groups are left out; a date that can't be read goes to Earlier.
 */
export function groupChatsByDay(past: PastSession[], now: Date): ChatGroup[] {
  const today = dayNumber(now);
  const buckets: Record<ChatGroupKey, PastSession[]> = { today: [], week: [], earlier: [] };
  for (const s of past) {
    const t = new Date(s.lastModified);
    const age = Number.isNaN(t.getTime()) ? Number.POSITIVE_INFINITY : today - dayNumber(t);
    buckets[age <= 0 ? 'today' : age <= 6 ? 'week' : 'earlier'].push(s);
  }
  return ORDER.filter((k) => buckets[k].length > 0).map((key) => ({
    key,
    title: TITLES[key],
    items: buckets[key],
  }));
}
