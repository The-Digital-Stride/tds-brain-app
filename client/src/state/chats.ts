import { type Attention, attentionFor, type LiveSession } from '../../../shared/contract.ts';
import type { SortChats } from '../shell/contract.ts';

const RANK: Record<Attention, number> = { asking: 3, working: 2, ready: 1 };

function rank(s: LiveSession): number {
  const a = attentionFor(s.state);
  return a ? RANK[a] : 0;
}

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Needs an answer first, then working, then ready, then stopped; newest activity first within each. */
export const sortChats: SortChats = (live) =>
  [...live].sort((a, b) => rank(b) - rank(a) || time(b.lastActivityAt) - time(a.lastActivityAt));

/** The attention colour of the most urgent open chat, or null when none has one. */
export function mostUrgent(live: LiveSession[]): Attention | null {
  let best: Attention | null = null;
  for (const s of live) {
    const a = attentionFor(s.state);
    if (a && (best === null || RANK[a] > RANK[best])) best = a;
  }
  return best;
}
