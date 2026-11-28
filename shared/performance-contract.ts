/**
 * Settings → Performance (plan docs/plans/2026-11-28-settings-performance.md).
 *
 * This Mac's Claude Code use, read from the session logs under `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`)
 * and summed per day. Numbers only: the reader takes token counts, model, time, message id, whether the session ran
 * Code Mode, a subagent's type, and the session's `cwd`/`gitBranch` (only to name its project). It never keeps or sends message text, tool input or tool output.
 *
 * Owners and scouts only (decision 2); the timer only runs for them (decision 6). Costs are estimates at API list
 * prices, never a bill (decision 7). The server works out the 7/30/90-day views (decision 11).
 */

// ─── Who can see it ─────────────────────────────────────────────────────────────────────────────

/** The roles that see the tab and may call the route. Anyone else gets 403 `not-allowed`. */
export const PERFORMANCE_VIEWERS = ['owner', 'scout'] as const;

// ─── When it runs ───────────────────────────────────────────────────────────────────────────────

/** How often the server checks whether today's refresh has run. The refresh itself runs at most once per local day. */
export const PERFORMANCE_CHECK_EVERY_MS = 60 * 60 * 1000;
/** Wait after the server starts before the first check, so start-up stays quick. */
export const PERFORMANCE_FIRST_CHECK_AFTER_MS = 2 * 60 * 1000;
/** Days of daily totals kept. Older days are dropped at the next refresh. */
export const PERFORMANCE_KEEP_DAYS = 400;

// ─── Prices (decision 7) ───────────────────────────────────────────────────────────────────────

/** When the price table was last checked. Shown on the page. */
export const PRICES_CHECKED = '2026-11-28';

export interface ModelPrice {
  /** Plain label people know, e.g. "Opus 5.5". */
  label: string;
  /** US dollars per million tokens. */
  input: number;
  write5m: number;
  write1h: number;
  read: number;
  output: number;
}

/**
 * By exact model id (decision 7). Source: the claude-api reference (2026-11-28), except Fable 5.2, which it doesn't
 * list: agent-workforce's agent-usage.sh table (checked 2026-11-14). Haiku 5.5 uses its up-to-100K-prompt rate.
 * A model not listed here is counted in `unpricedRequests`, never priced at zero silently.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-2': { label: 'Fable 5.2', input: 8, write5m: 10, write1h: 16, read: 0.2, output: 40 },
  'claude-fable-5-1': { label: 'Fable 5.1', input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 },
  'claude-opus-5-5': { label: 'Opus 5.5', input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 },
  'claude-opus-5': { label: 'Opus 5', input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 },
  'claude-opus-4-8': { label: 'Opus 4.8', input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 },
  'claude-haiku-5-5': {
    label: 'Haiku 5.5',
    input: 0.1,
    write5m: 0.125,
    write1h: 0.2,
    read: 0.01,
    output: 0.5,
  },
  'claude-haiku-4-5': { label: 'Haiku 4.5', input: 1, write5m: 1.25, write1h: 2, read: 0.1, output: 5 },
};

// ─── The data (decision 11: the server works out the views) ─────────────────────────────────────

/** Token sums for a group of model requests. */
export interface UsageTotals {
  /** Model requests: one per message id (the last line of that id wins); `<synthetic>` entries never count. */
  requests: number;
  /** Fresh (uncached) input tokens. */
  input: number;
  /** Input written to the cache, 5-minute and 1-hour. */
  cacheWrite5m: number;
  cacheWrite1h: number;
  /** Input read back from the cache. Always shown apart from fresh input. */
  cacheRead: number;
  output: number;
  /** Estimated cost at `MODEL_PRICES`, in US dollars. */
  costUsd: number;
  /** Requests on a model with no price; their cost isn't in `costUsd`. */
  unpricedRequests: number;
}

/** One line of a "Where it goes" table. */
export interface UsageGroup {
  /** Stable key (a short hash for projects, never a folder path; model id; agent type). */
  key: string;
  /** What people read: "tds-brain-app", "Brain", "Temporary folders", "Opus 5.5", "reviewer". */
  label: string;
  /** Main sessions (projects, models) or agents started (agent types) with a request in the period. Never summed. */
  count: number;
  totals: UsageTotals;
}

/** One side of the Code Mode comparison. Main sessions only; their subagents inherit the session's side. */
export interface CodeModeSide {
  sessions: number;
  requests: number;
  /** (input + cache read + cache writes) / requests. 0 when no requests. */
  inputPerRequest: number;
  /** costUsd / sessions. 0 when no sessions. */
  costPerSession: number;
}

export interface PeriodFigures {
  totals: UsageTotals;
  /** Main sessions with a request in the period, each counted once. */
  sessions: number;
  /** Subagents with a request in the period, each counted once. */
  agentsStarted: number;
  byProject: UsageGroup[];
  byModel: UsageGroup[];
  byAgentType: UsageGroup[];
  codeMode: { on: CodeModeSide; off: CodeModeSide };
  /** One entry per day in the period, oldest first, zero-filled. */
  daily: { date: string; costUsd: number; requests: number }[];
}

/** Below this many sessions on either side, the page shows the counts but no verdict. */
export const CODE_MODE_MIN_SESSIONS = 20;

export type PeriodDays = 7 | 30 | 90;
export const PERIODS: readonly PeriodDays[] = [7, 30, 90];

export interface PeriodView {
  days: PeriodDays;
  /** Local dates, inclusive. `to` is today. */
  from: string;
  to: string;
  current: PeriodFigures;
  /** The same length just before; null unless the history fully covers it (then the page says "No earlier figures yet"). */
  previous: PeriodFigures | null;
}

export type PerformanceStatus = 'ready' | 'building' | 'never-run' | 'failed';

/** Never `err.message` (Node errors carry full paths). */
export type PerformanceErrorCode = 'logs-missing' | 'read-failed' | 'history-unreadable' | 'write-failed';

/** GET `ROUTES.performance` reply. Owners and scouts only. */
export interface PerformanceReport {
  status: PerformanceStatus;
  /** True while a refresh runs (first build or "Update now"). */
  refreshing: boolean;
  /** ISO time of the last finished refresh, or null if none yet. */
  updatedAt: string | null;
  error?: PerformanceErrorCode;
  /** First local date with any figures, or null. */
  historyFrom: string | null;
  /**
   * First local date the history is complete from, or null before the first refresh. Set once, at the first
   * refresh: the local date of the oldest log file's last change then on disk (anything before it may already
   * have been cleared by Claude Code). Periods starting earlier show "Figures start <date>"; `previous` is null
   * unless it starts on or after this date.
   */
  completeFrom: string | null;
  pricesChecked: string;
  /** Present once a refresh has finished. */
  views?: Record<`${PeriodDays}`, PeriodView>;
}

/** POST `ROUTES.performanceRefresh`: starts a refresh unless one is running. Replies with the report as it now is. */
export type PerformanceRefreshReply = PerformanceReport;

// ─── Stored history (decision 6) ───────────────────────────────────────────────────────────────

/** Bump when the stored shape changes; an unknown version reads as `history-unreadable`, never as empty. */
export const PERFORMANCE_STORE_VERSION = 1;
