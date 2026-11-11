/**
 * Wording shared by the rail, drawers, Home, palette and panel, so a status or a date reads the same
 * everywhere. Contract: `Words` in client/src/shell/contract.ts.
 */
import { ATTENTION_LABEL, type LiveSession, type SkillInfo } from '../../../shared/contract.ts';
import type { Words } from './contract.ts';

export const STATE_WORDS: Words['STATE_WORDS'] = {
  starting: ATTENTION_LABEL.working,
  working: ATTENTION_LABEL.working,
  waiting: ATTENTION_LABEL.asking,
  idle: ATTENTION_LABEL.ready,
  error: 'Stopped by a problem',
  closed: 'Ended',
};

export const ROLE_WORDS: Words['ROLE_WORDS'] = {
  owner: 'Owner',
  scout: 'Scout',
  team: 'Team',
  unknown: 'Role not set',
};

export const todoChatDraft: Words['todoChatDraft'] = (todo) =>
  `Help me with this to-do: todo/${todo.id} (${todo.title})`;

export const whenWords: Words['whenWords'] = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const starterSkills: Words['starterSkills'] = (boot) => {
  const byName = (name: string) => boot.skills.find((s) => s.name === name);
  const known = (s: SkillInfo | undefined): s is SkillInfo => s !== undefined;
  const pinned = boot.prefs.pins.map(byName).filter(known);
  const often = boot.usedOften
    .map((u) => byName(u.name))
    .filter(known)
    .filter((s) => !boot.prefs.pins.includes(s.name));
  return { pinned, often };
};

/** The Chats rail button's accessible name: "Chats, 2 open, 1 needs your answer". */
export function chatsRailLabel(live: LiveSession[]): string {
  if (live.length === 0) return 'Chats';
  const asking = live.filter((s) => s.state === 'waiting').length;
  const open = `Chats, ${live.length} open`;
  if (asking === 0) return open;
  return `${open}, ${asking} ${asking === 1 ? 'needs' : 'need'} your answer`;
}

/** "SE" for "Sam Example": first and last names' first letters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}
