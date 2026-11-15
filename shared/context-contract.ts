/**
 * Context management (plan 2026-11-14-context-management): the compaction notice, the context meter,
 * the Inspector's detail, and the pure policy the server builds on. Both sides build against this.
 */
import type { LevelTier } from './levels-contract.ts';

// ---------------------------------------------------------------------------
// Chat events (joined to `ChatEvent` in contract.ts)
// ---------------------------------------------------------------------------

/**
 * Decisions 1–3. Main chat only: status and boundaries from helpers are ignored.
 * - `started`: `status: 'compacting'`. Shows the state line.
 * - `done`: `compact_boundary`. Shows the divider; also replayed for a reopened chat.
 * - `failed`: `status` with `compact_result: 'failed'`. Warning, shown once until a compaction succeeds.
 * - `ended`: status left 'compacting' with no boundary or failure (e.g. `status: null`). Clears the line.
 * The client also clears the state line on `done`, `failed`, `turn-end` and any `state` event.
 */
export type CompactionEvent =
  | { type: 'compaction'; phase: 'started' }
  | {
      type: 'compaction';
      phase: 'done';
      /** Stable per compaction (`c:<boundary uuid>`), so live and replayed dividers never double. */
      id: string;
      trigger: 'auto' | 'manual';
      preTokens: number | null;
      postTokens: number | null;
      /** Epoch ms, or null on replay when unknown. */
      at: number | null;
    }
  | { type: 'compaction'; phase: 'failed' }
  | { type: 'compaction'; phase: 'ended' };

/** Where a reading came from: the engine's own count, the last response's usage, or the app's stored copy. */
export type ContextSource = 'engine' | 'usage' | 'stored';

/** Decisions 4 and 7. The server keeps only the newest in its replay log and in its per-chat store. */
export interface ContextEvent {
  type: 'context';
  usedTokens: number;
  /** The point the meter measures against: the auto-summarise threshold, else the window (decision 5). */
  limitTokens: number;
  /** The model's window, for the Inspector only. */
  windowTokens: number;
  /** usedTokens / limitTokens × 100, rounded; may exceed 100. */
  percent: number;
  /** False when Claude Code's auto-summarising is off (the meter then says "Chat 42% full" against the window). */
  autoCompact: boolean;
  source: ContextSource;
  /** Epoch ms of the reading. */
  at: number;
}

// ---------------------------------------------------------------------------
// Inspector detail (decisions 6 and 12)
// ---------------------------------------------------------------------------

/** One row of what a chat carries. Grouped from the engine's `id`/`kind`, never from `name`. */
export interface ContextItem {
  /** Display name, e.g. "Messages", "Gmail connector", "/seo-audit". */
  name: string;
  tokens: number;
  group: 'messages' | 'system' | 'tools' | 'connectors' | 'skills' | 'memory' | 'agents' | 'free' | 'buffer';
  /** Plain advice for a heavy person-owned item (decision 12), else absent. UK English. */
  advice?: string;
  /** True for tool schemas held outside the window until used (engine `kind: 'deferred'`). Never advised on. */
  deferred?: boolean;
}

/** `GET ROUTES.chatContext(id)` → this. */
export interface ChatContextDetail {
  /** null before the first reading. */
  reading: ContextEvent | null;
  /**
   * What fills the chat, largest first and at most 12, then the rows only loaded when used
   * (`deferred`), largest first. No zero rows, no free space or reserve rows. Empty when
   * `approximate` and no full read is cached.
   */
  items: ContextItem[];
  /** The last compaction in this chat, or null. */
  lastCompaction: Extract<CompactionEvent, { phase: 'done' }> | null;
  /** True when answered from the cached reading (rate limit, reply running, or engine closed). */
  approximate: boolean;
}

/**
 * `GET ROUTES.chatContext(id)`: ChatContextDetail for one open chat. 404 `not-found` for an unknown chat.
 * Asks the engine for `detail: 'full'` at most once per `CONTEXT_DETAIL_MIN_INTERVAL_MS` per chat and
 * never during a reply; otherwise answers from the newest reading with `approximate: true`. Goes
 * through `checkRequest`. The key lives in `ROUTES` (contract.ts, lead).
 */
export const chatContextPath = (sessionId: string): string =>
  `/api/sessions/${encodeURIComponent(sessionId)}/context`;

// ---------------------------------------------------------------------------
// Thresholds (one place only)
// ---------------------------------------------------------------------------

export const CONTEXT_THRESHOLDS = {
  /** Meter turns amber (decision 5). */
  warnPercent: 60,
  /** Meter turns red: "Nearly full" (decision 5). */
  fullPercent: 85,
  /** Decision 10: deny an automatic downward switch when re-caching is estimated at or above this. */
  keepModelMinUsd: 0.1,
  /** Decision 10: …unless the lower level has been wanted this many turns running. */
  keepModelMaxTurns: 3,
  /** Decision 10 fallback (spike S6 fails): app-side warm window and token floor. */
  fallbackWarmMs: 60 * 60 * 1000,
  fallbackMinTokens: 20_000,
  /** Re-anchor text cap after a compaction (decision 8). */
  reanchorMaxChars: 2_000,
} as const;

export const CONTEXT_DETAIL_MIN_INTERVAL_MS = 30_000;
export const CONTEXT_READ_TIMEOUT_MS = 2_000;

// ---------------------------------------------------------------------------
// Pure policy (server/engine/context-policy.ts implements; tests pin it)
// ---------------------------------------------------------------------------

export type MeterBand = 'ok' | 'warn' | 'full';

/** Decision 5. Shared so the client and the server agree on "nearly full". */
export type MeterBandFn = (percent: number) => MeterBand;

/** Decision 5, implemented once here so both sides use the same bands. */
export const meterBand: MeterBandFn = (percent) =>
  percent >= CONTEXT_THRESHOLDS.fullPercent
    ? 'full'
    : percent >= CONTEXT_THRESHOLDS.warnPercent
      ? 'warn'
      : 'ok';

/** Decision 10. What the `PreModelSwitch` hook (or the fallback) knows about one switch. */
export interface KeepModelInput {
  /** The person chose this (Settings, the chat's level menu). Always switches. */
  explicit: boolean;
  fromTier: LevelTier;
  toTier: LevelTier;
  /** From the hook (`prompt_cache_warm`); in the fallback, last response within `fallbackWarmMs`. */
  cacheWarm: boolean;
  /** From the hook (`estimated_cache_write_usd`); null in the fallback. */
  estimatedUsd: number | null;
  /** Fallback only: newest reading's `usedTokens`, or null. */
  usedTokens: number | null;
  /** Consecutive turns (this one included) whose resolved tier was at or below `toTier`. */
  lowerWantedTurns: number;
  /** The target model answered in this chat within the cache TTL, so its own cache is still warm (spike S6). */
  targetRecentlyUsed: boolean;
}

/**
 * Decision 10: true = deny this switch and stay on the current model. Never true for upward,
 * explicit or recently used targets. A denial makes `setModel` throw; the hook sets a flag so
 * `applyChoice` treats it as "kept", never by matching the error text.
 */
export type ShouldKeepModelFn = (input: KeepModelInput) => boolean;

export interface ReanchorInput {
  todo: { title: string; path: string } | null;
  /** Brain paths this chat read or produced, newest first. */
  files: readonly string[];
  workingHelpers: readonly string[];
}

/**
 * Decision 8: the `SessionStart` (`source: 'compact'`) `additionalContext`, capped at
 * `reanchorMaxChars`: to-do first, then newest files, then helpers, then the fixed line.
 */
export type ReanchorTextFn = (input: ReanchorInput) => string;

/** Decision 9: one line added to the system prompt `append` (spike S4 route c). No chat content. */
export const BRAIN_COMPACT_INSTRUCTIONS =
  'When summarising this conversation for compaction, keep: the client this chat is about; every decision made and who made it; every figure with its source; ' +
  'open questions and to-dos; the brain path of every file read or created; anything the user said not to do. ' +
  'Drop tool output that has already been used, and earlier drafts (keep only the latest).';

/** Decision 8: the fixed closing line of the re-anchor text. */
export const REANCHOR_CLOSING_LINE =
  "This chat was summarised. If a figure, decision or quote you need isn't in the summary, re-read the source file rather than guessing.";
