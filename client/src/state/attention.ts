import { type Attention, attentionFor, type LiveSession } from '../../../shared/contract.ts';

/** "7s", "2m 14s", "1h 5m" while working or asking; coarser ("6m", "just now") when ready. */
export function formatElapsed(ms: number, attention: Attention): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (attention === 'ready') return m === 0 ? 'just now' : `${m}m`;
  return m === 0 ? `${s}s` : `${m}m ${s}s`;
}

/**
 * Where to start counting from when this page first learns a chat's state without having seen it
 * change (a reload, or switching to the chat): the chat's last activity, never later than now.
 */
export function initialSince(lastActivityAt: string | null | undefined, now: number): number {
  const t = lastActivityAt ? Date.parse(lastActivityAt) : Number.NaN;
  return Number.isNaN(t) ? now : Math.min(t, now);
}

const PRIORITY: Record<Attention, number> = { asking: 3, working: 2, ready: 1 };

/**
 * The open chat that belongs to a to-do, by its `key` (a bare id for TDS, `personal/<id>` for personal; a
 * stored session's `todoId` is the same). If several do: needs an answer, then working, then ready.
 */
export function chatForTodo(todoKey: string, live: LiveSession[]): LiveSession | null {
  let best: LiveSession | null = null;
  let bestRank = 0;
  for (const s of live) {
    if (s.todoId !== todoKey) continue;
    const a = attentionFor(s.state);
    const rank = a ? PRIORITY[a] : 0;
    if (rank > bestRank) {
      best = s;
      bestRank = rank;
    }
  }
  return best;
}
