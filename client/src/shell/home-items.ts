import type { HomeItemId } from '../../../shared/contract.ts';

/** One thing on Home a person can hide (plan 2026-11-25-home-card-library). */
export interface HomeItemDef {
  id: HomeItemId;
  /** Shown in the panel and in status lines, e.g. 'Pinned files'. UK English; "tasks", never "to-dos". */
  title: string;
  kind: 'card' | 'button';
  /** Panel hint for items that show only sometimes. */
  hint?: string;
}

/** Every Home item, in the default order. The panel and Home both read this. */
export const HOME_ITEMS: readonly HomeItemDef[] = [
  {
    id: 'start-my-day',
    title: 'Start my day',
    kind: 'button',
    hint: 'Shows when the Start my day skill is in your Brain.',
  },
  { id: 'whats-new', title: "What's new", kind: 'button' },
  { id: 'meetings', title: 'Meetings', kind: 'card' },
  {
    id: 'ads',
    title: 'Ads approvals',
    kind: 'card',
    hint: "Shows only while an Ads change waits for you. You'll still find it in Ads Manager.",
  },
  { id: 'todos', title: 'Pinned tasks', kind: 'card' },
  {
    id: 'projects',
    title: 'Recent projects',
    kind: 'card',
    hint: 'Shows once a project has been worked on.',
  },
  { id: 'chats', title: 'Pinned chats', kind: 'card' },
  { id: 'files', title: 'Pinned files', kind: 'card' },
  { id: 'skills', title: 'Pinned skills', kind: 'card' },
];
