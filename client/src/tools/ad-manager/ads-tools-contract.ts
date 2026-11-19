/**
 * Contract for plan 2026-11-19-ads-workbench-sections: the Ads section's three tools. Builders build against these
 * types and signatures; the implementing modules (`logic.ts`, `task-runs.ts`, `store.tsx`, `sections-contract.ts`)
 * re-export or implement them. Types only, no runtime code, so it costs nothing in the bundle.
 *
 * User-facing words are UK English; identifiers are US English.
 */
import type {
  AdsBoard,
  AdsHealthFile,
  AdsMonthly,
  AdsPack,
  AdsStandupVerdict,
  ProposalSummary,
} from '../../../../shared/ads-contract.ts';

// ---------- Tools and the drawer (decisions 1, 2, 4) ----------

/** The Ads group's name in the Workbench drawer. */
export const ADS_GROUP = 'Ads';

/** Tool ids. `ad-manager` is kept for Ads Manager so saved views, lastTool and search results keep opening. */
export const ADS_TOOL_IDS = {
  manager: 'ad-manager',
  command: 'ads-command-centre',
  summary: 'ads-account-summary',
} as const;
export type AdsToolId = (typeof ADS_TOOL_IDS)[keyof typeof ADS_TOOL_IDS];

/** Titles shown in the drawer, the sheet bar ("Workbench · <title>") and search. */
export const ADS_TOOL_TITLES: Record<AdsToolId, string> = {
  'ad-manager': 'Ads Manager',
  'ads-command-centre': 'Ads Command Centre',
  'ads-account-summary': 'Ads Account Summary',
};

/**
 * Additions to `ToolSlot` (sections-contract.ts). Optional, so existing tools compile unchanged.
 * - `rowNote`: a short line for the drawer row that is not a waiting count (e.g. "3 due"); never summed into the rail.
 */
export interface ToolSlotAdditions {
  rowNote?: (snap: ToolSnapshotAdditions) => string | null;
}

/**
 * Additions to `ToolSnapshot`. `adsDue` is the current account's due-or-overdue task count. The ad store copies it
 * into a main-store field when a board loads; null until then (the row then shows no note).
 */
export interface ToolSnapshotAdditions {
  adsDue?: number | null;
}

/** One hook (store.tsx) replaces the five places that build `{ ads }` by hand (decision 4). */
export type UseToolSnapshot = () => { ads: unknown } & ToolSnapshotAdditions;

/**
 * Shared account loading (decision 3), moved out of `AdManagerSheet.tsx`: the caller's account (`toolArg`), else the
 * saved one, else the first with something waiting; then loads that account's board. Every Ads sheet calls it.
 */
export type UseAdsAccount = () => { account: string | null; loading: boolean };

/**
 * Additions to the ad store (store.ts). `jump` names a place on the target sheet (decision 5): set before `openTool`,
 * read by that sheet once it has drawn (focus the heading), then cleared.
 */
export type AdsJump = 'readiness' | 'close' | `table:${string}`;
export interface AdStoreAdditions {
  jump?: AdsJump | null;
}

/**
 * Addition to `AppPrefs` (shared/contract.ts): folded group names per section id. Optional: older settings still
 * load. Needs a `parsePrefsPatch` case (routes.ts) and a cleaner in `sanitise` (app-store.ts), or it is refused.
 */
export interface AppPrefsAdditions {
  foldedGroups?: Record<string, string[]>;
}

// ---------- Pure logic (logic.ts; tests first) ----------

/**
 * Overall account data state (decision 6). `ok` only when every required file is ready (`na` counts as ready) and
 * there is no `health.fetch.problem`. A fetch problem or an unknown status gives `warn`; a missing file gives `bad`.
 */
export type ReadinessTone = 'ok' | 'warn' | 'bad';
export type FileDot = 'ok' | 'na' | 'warn' | 'bad';

export interface ReadinessGroup {
  group: AdsHealthFile['group'];
  /** Display name: "Daily performance", "Search", "Shopping and products", "Deep dive" (others: the raw group). */
  label: string;
  tone: ReadinessTone;
  ready: number;
  required: number;
  files: { file: AdsHealthFile; dot: FileDot }[];
}

export interface Readiness {
  tone: ReadinessTone;
  ready: number;
  required: number;
  notNeeded: number;
  groups: ReadinessGroup[];
}

/** Null health (no board yet) gives null: no panel. */
export type ReadinessFn = (health: AdsBoard['health'] | null) => Readiness | null;

/**
 * Due state of a task card (decision 6). `stopped` is set by the caller from task-runs, not by dueState.
 * - Local calendar days; thresholds inclusive. `days` counts from the due date.
 * - `upcoming` (monthly and quarterly only): `on` is the local due date as YYYY-MM-DD, shown as "Due Mon 1 Dec".
 * - A future or invalid `lastRunAt` gives null. Never run (null): daily is `due`; others null; never `overdue`.
 */
export type DueState =
  | { kind: 'due' }
  | { kind: 'overdue'; days: number }
  | { kind: 'upcoming'; on: string }
  | null;
export type DueStateFn = (
  cadence: AdsBoard['cards'][number]['cadence'],
  lastRunAt: string | null,
  now: Date,
) => DueState;

/** One "Needs you" line on Ads Manager (decision 5). Ordered bad, then warn. */
export type NeedsYouTarget =
  | { kind: 'report'; path: string }
  | { kind: 'tool'; tool: AdsToolId; anchor?: string }
  | { kind: 'jump'; anchor: 'close' };

export interface NeedsYouItem {
  id: string;
  tone: 'bad' | 'warn';
  text: string;
  sub: string;
  /** Button label, e.g. "Open report", "Ads Command Centre", "Go to monthly close". */
  action: string;
  target: NeedsYouTarget;
}

export type NeedsYouFn = (input: {
  pack: AdsPack | null;
  monthly: AdsMonthly | null;
  health: AdsBoard['health'] | null;
  open: ProposalSummary[];
}) => NeedsYouItem[];

/**
 * One "Worth a look" line on Ads Account Summary (decision 8); `table` is the deep-dive table id to jump to.
 * A table missing from the board gives no line.
 */
export interface WorthALookItem {
  id: string;
  tone: 'bad' | 'warn';
  text: string;
  table: string;
  /** The table's title, used as the button label. */
  tableTitle: string;
}
export type WorthALookFn = (board: AdsBoard) => WorthALookItem[];

// ---------- Task runs and their chats (decisions 9, 10) ----------

/**
 * `TaskRun` (task-runs.ts) gains two optional fields; the storage key stays `tds.adManager.taskRuns.v1`.
 * `readRuns` and `recordRun` must carry them through (they rebuild `{ at, chat }` today).
 * - `sdk`: the run's chat `sdkSessionId`, once the sessions list shows it.
 * - `good`: the last run of this task on this account that finished: set the first time its chat shows
 *   `lastTurn: 'ok'`. Reconciled in store.tsx from the sessions list, not in the lazy screen.
 */
export interface TaskRunAdditions {
  sdk?: string | null;
  good?: { at: string; sdk: string } | null;
}

/**
 * Addition to `LiveSession` (shared/contract.ts), set by session-manager.ts at each `turn-end`. Optional: an older
 * server leaves it out, and the client then records no `good`.
 */
export interface LiveSessionAdditions {
  lastTurn?: 'ok' | 'stopped' | 'failed';
}

/**
 * `openPast` (store.tsx) gains `opts`; default is the chat screen, so existing callers don't change. Resolves to
 * whether the chat opened, so a run card can say when an old chat can't be found. Callers that ignore the result
 * are unaffected.
 */
export type OpenPast = (sdkSessionId: string, opts?: { in?: 'sheet' | 'drawer' }) => Promise<boolean>;

// ---------- Release 2 (bridge, add-only; moves to shared/ads-contract.ts when Release 2 starts) ----------

/** Capability flags the bridge adds to `features`. The client never sees `features`: it gates on the field. */
export const ADS_TRIAGE_ALL_CAPABILITY = 'triage-all-v1';
export const ADS_TOTALS_CAPABILITY = 'totals-v1';

/** One row of the cross-account triage pop-up (decision 13), worst first. */
export interface AdsTriageRow {
  key: string;
  name: string;
  hasStandup: boolean;
  verdict: AdsStandupVerdict | null;
  /** The verdict is older than the latest data. */
  stale: boolean;
}

/** Account totals for the period and the one before (decision 14). Money in the account currency. */
export interface AdsTotals {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  current: AdsTotalsFigures;
  previous: AdsTotalsFigures;
}
export interface AdsTotalsFigures {
  spend: number;
  conversions: number;
  value: number;
  roas: number | null;
  cpa: number | null;
  wastedSpend: number;
}

/** Release 2 additions to `AdsBoard`, both optional. The client shows the triage button or totals strip only when present. */
export interface AdsBoardRelease2 {
  triageAll?: AdsTriageRow[];
  totals?: AdsTotals;
}
