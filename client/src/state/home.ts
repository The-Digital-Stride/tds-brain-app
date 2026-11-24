import type { HomeLogic } from '../shell/contract.ts';

export const greeting: HomeLogic['greeting'] = (now, fullName) => {
  const hour = now.getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  return first ? `${hello}, ${first}` : hello;
};

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const summary: HomeLogic['summary'] = ({ overdue, dueToday, asking }) => {
  const parts: string[] = [];
  if (overdue > 0) parts.push(overdue === 1 ? 'one task is overdue' : `${overdue} tasks are overdue`);
  if (dueToday > 0) {
    if (overdue > 0) parts.push(dueToday === 1 ? 'one is due today' : `${dueToday} are due today`);
    else parts.push(dueToday === 1 ? 'one task is due today' : `${dueToday} tasks are due today`);
  }
  if (asking > 0)
    parts.push(asking === 1 ? 'one chat is waiting for you' : `${asking} chats are waiting for you`);
  if (parts.length === 0) return 'Nothing is waiting for you.';
  const joined =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${capital(joined ?? '')}.`;
};
