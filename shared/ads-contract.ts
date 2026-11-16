/**
 * Contract for the Ad Manager and its bridge skill `tdsapp-ads` (brain-skills/tdsapp-ads).
 * Plan: docs/plans/2026-11-16-workbench-ad-manager.md, decisions 7 to 22.
 *
 * The app runs `node <brain>/.claude/skills/tdsapp-ads/scripts/tdsapp-ads.cjs <action>` through
 * `server/brain/skill-runner.ts`, writes one JSON object to stdin and reads one JSON line from stdout:
 * `{ ok: true, ...reply }` or `{ ok: false, code: AdsErrorCode, error: string }` (error text is for
 * developers; the app shows its own words from ADS_ERROR_MESSAGES).
 *
 * File formats and approval rules live in the brain's `.claude/skills/ads-manager/scripts/lib/proposals.cjs`,
 * `monthly.cjs`, `apply.cjs` and `client-draft.cjs`; the bridge loads them at run time and never copies
 * their logic. The brain library does NOT check who acts for `decided` (P.stamp), `dry-run`, `apply`
 * (falls back to $USER) or `client-draft`, so the bridge itself requires, for EVERY change action, that
 * `P.gitUser()` is on the roster (`not-allowed` otherwise), and additionally `P.mayDecide(me, fm)` for
 * `decided`, `dry-run`, `apply` and `client-draft` (decision 10). The actor is passed to the library as
 * `by: P.gitUser().slug`; no stdin field names the actor. A test checks the script's constants match this file.
 */

/** Folder and script, relative to the brain root. */
export const ADS_SKILL = { skill: 'tdsapp-ads', script: '.claude/skills/tdsapp-ads/scripts/tdsapp-ads.cjs' } as const;

/** The capability the app needs before it shows Ad Manager. */
export const ADS_CAPABILITY = 'ads-v1';

/**
 * Read actions run unqueued; identical reads in flight (same action and arguments) share one run.
 * Change actions run one at a time per Mac (`createQueue`). The app itself resolves `file` (no script run).
 */
export type AdsReadAction = 'capabilities' | 'accounts' | 'approvals' | 'proposal' | 'board' | 'standup-brief' | 'file';
export type AdsChangeAction =
  | 'decide'
  | 'dry-run'
  | 'apply'
  | 'client-draft'
  | 'client-approved'
  | 'decided'
  | 'sign-monthly'
  | 'standup-setup'
  | 'standup-feedback';
export type AdsAction = AdsReadAction | AdsChangeAction;

/**
 * Time limits in ms. For `apply`, `dry-run` and `sign-monthly` the limit only ends the WAIT: the script is
 * spawned detached and is NEVER killed (apply.cjs runs its executor with spawnSync, so killing the bridge
 * would orphan a live write). On the limit the app replies `unknown-outcome` (apply) or `internal`, keeps the
 * change queue held until the process exits, and records it in the in-flight file (ADS_INFLIGHT_FILE).
 * Nothing retries `apply`, anywhere.
 */
export const ADS_TIMEOUT_MS: Record<AdsAction, number> = {
  capabilities: 15_000,
  accounts: 15_000,
  approvals: 15_000,
  proposal: 15_000,
  board: 15_000,
  'standup-brief': 15_000,
  file: 15_000,
  decide: 30_000,
  'client-draft': 60_000,
  'client-approved': 30_000,
  decided: 30_000,
  'standup-setup': 30_000,
  'standup-feedback': 30_000,
  'sign-monthly': 120_000,
  'dry-run': 180_000,
  apply: 180_000,
};

/** stdout cap per run, bytes. */
export const ADS_MAX_OUTPUT_BYTES = 4_000_000;

/** Characters of apply/dry-run output kept (the tail), with `proxy:` lines removed, as the Workbench does. */
export const ADS_OUTPUT_TAIL = 6000;

/** Recent decisions window. The Workbench's RECENT_DAYS; Cortex labels it truthfully (decision 15). */
export const ADS_RECENT_DAYS = 14;

/** Note and reason text cap, characters. */
export const ADS_NOTE_MAX = 1000;

/**
 * In the app's own data folder (never the brain): `{ client, id, pid, startedAt }[]` for applies running or whose
 * outcome is unknown (timed out, or the app restarted mid-run). While a proposal is listed, its `canApply` is false
 * and the panel shows the unknown-outcome line with "I've checked the account" (POST ADS_ROUTES.clearInflight),
 * which removes the entry. An entry whose pid has exited and whose proposal now shows `applied_at` clears itself.
 */
export const ADS_INFLIGHT_FILE = 'ads-inflight.json';

/** An ads account key: the client folder name, which may hold capitals and underscores (ads-board-data.cjs). */
export const ADS_ACCOUNT_KEY = /^[A-Za-z0-9_-]{1,80}$/;

export const ADS_PROPOSAL_ID = /^\d{8}-\d{2}-[a-z0-9-]+$/;
export const ADS_CLIENT_SLUG = /^[a-z0-9-]+$/;
export const ADS_MONTH = /^\d{4}-\d{2}$/;

/**
 * Files Ad Manager may open (decision 18). The server checks the pattern, refuses `..`, then resolves the path with
 * the existing `libraryItemForPath` and returns that `LibraryItem` (404 when it isn't in the library); the client opens
 * it with the existing `{ kind: 'file', item }` viewer request, without delete. PDF, HTML (sandboxed as library pages
 * are) and markdown show; JSON and CSV offer Download only. No raw brain-file route exists.
 */
export const ADS_FILE_PATTERN = /^clients\/[a-z0-9-]+\/(reports|proposals)\/.+\.(pdf|html|md|json|csv|txt)$/;

export type AdsErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'not-allowed'
  | 'changed'
  | 'no-access'
  | 'unknown-outcome'
  | 'unavailable'
  | 'internal';

/** The app's words. UK English. */
export const ADS_ERROR_MESSAGES: Record<AdsErrorCode, string> = {
  'bad-request': "That request wasn't understood. Refresh and try again.",
  'not-found': 'That proposal or report could not be found. It may have been moved or expired.',
  'not-allowed': "You can't do that for this client. Only its reviewer, its owner or an owner can.",
  changed: 'This proposal changed since you opened it, so nothing was done. Check it and try again.',
  'no-access': "This Mac can't reach Google Ads, so this can't be done here.",
  'unknown-outcome':
    "We don't know whether this change reached Google Ads. Check the account before trying again.",
  unavailable: 'Ad Manager needs the tdsapp-ads skill. Ask Ian or Pete to add it.',
  internal: 'That could not be done. Try again, and tell Ian if it keeps happening.',
};

// ── Replies ────────────────────────────────────────────────────────────────────────────────────

export interface AdsCapabilities {
  /** Named `features` (not `capabilities`) so `createCapabilityProbe` can cache it; includes ADS_CAPABILITY. */
  features: string[];
  version: string;
  /** gads-proxy config or google-ads.yaml present (the Workbench's hasAdsAccess()). */
  adsAccess: boolean;
  /** ads-manager skill and the libraries the bridge needs are present. */
  adsManager: boolean;
  /**
   * The person at this Mac, from `P.gitUser()` and the roster, or null when not on the roster. NOT cached with
   * `features`. If its slug differs from the app's own identity (tools/whoami.cjs), Ad Manager hides every action and
   * says: "Ad Manager acts as <name> on this Mac, not you, so its buttons are off. Ask Ian to check the Mac's Git name."
   */
  me: { slug: string; name: string; role: string } | null;
}

export interface AdsAccount {
  /** Account key = client folder name (ADS_ACCOUNT_KEY). Also the client for chats and approvals. */
  key: string;
  name: string;
  currency: string;
  /** Proposals waiting for this person's decision on this account's client. */
  waiting: number;
  supervised: boolean; // client has config/management.json
}

/** Frontmatter as the brain wrote it. Known fields typed; unknown fields kept and shown as they are. */
export type ProposalFrontmatter = Record<string, string | number | boolean | string[] | null> & {
  id: string;
  client: string;
  type: 'decision' | 'change' | 'email' | 'info-request' | 'report' | string;
  tier: number;
  status: string;
  title: string;
};

/** What a person may press for a proposal, worked out by the bridge from the brain's rules. */
export interface ProposalFlags {
  canDecide: boolean; // approve, request changes, reject
  canDryRun: boolean;
  /** False while the proposal is in ADS_INFLIGHT_FILE (the app clears it; the bridge doesn't know). */
  canApply: boolean;
  canClientDraft: boolean;
  canRecordClientApproval: boolean;
  canRecordDecision: boolean;
}

export interface ProposalSummary {
  id: string;
  file: string; // brain-relative
  fm: ProposalFrontmatter;
  warnings: string[];
  flags: ProposalFlags;
}

export interface ProposalFull extends ProposalSummary {
  body: string; // markdown
}

export interface ClientApprovals {
  slug: string;
  name: string;
  reviewer: string | null;
  owner: string | null;
  mine: boolean;
  open: ProposalSummary[]; // tier, then id
  recent: ProposalSummary[]; // last ADS_RECENT_DAYS, newest first
  pack: unknown; // latest weekly pack, as the Workbench's latestPack(); builder B types it from the source
  monthly: unknown; // as latestMonthly() / monthly.cjs monthStatus(), plus canSign; builder B types it
}

export interface AdsApprovals {
  me: AdsCapabilities['me'];
  generatedAt: string;
  waiting: number;
  toApply: number;
  clients: ClientApprovals[];
}

/**
 * One account's board: the Workbench's buildBoardData(key) and dataHealth(key) output, unchanged,
 * plus the 16 cadence cards (scripts/cadence-tasks.json, verbatim) with their badges, and the
 * standup state. Builder B replaces `unknown` with exact types read from the source.
 */
export interface AdsBoard {
  key: string;
  health: unknown;
  tables: unknown;
  cards: { id: string; cadence: 'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'quarterly'; kind: 'report' | 'insight' | 'action'; title: string; description: string; badge: string | null; prompt: string }[];
  standup: unknown;
  triage: unknown;
}

/** Reply to any change action: the proposal's new state (so the screen needs no re-fetch) and output. */
export interface AdsChangeReply {
  proposal?: ProposalFull;
  /** Tail of the script output for dry-run, apply, sign-monthly, client-draft. */
  output?: string;
  /** Plain-English line for the status area, e.g. "Approved. Draft client email written." */
  message: string;
  /**
   * `request-changes` only: the app starts the revising chat in the background with the Workbench's revise prompt
   * (cadence-tasks.json `revisePrompt`) and returns its id, so the panel offers "Open chat".
   */
  chatId?: string;
}

// ── Requests (stdin) ───────────────────────────────────────────────────────────────────────────

export interface AdsRequests {
  capabilities: Record<string, never>;
  accounts: Record<string, never>;
  approvals: { client?: string };
  proposal: { client: string; id: string };
  board: { account: string };
  file: { path: string };
  'standup-brief': { account: string };
  decide: { client: string; id: string; action: 'approve' | 'request-changes' | 'reject'; note?: string };
  'dry-run': { client: string; id: string };
  apply: { client: string; id: string; confirmed: true };
  'client-draft': { client: string; id: string; again?: boolean };
  'client-approved': { client: string; id: string; who: string; note?: string };
  decided: { client: string; id: string; note: string };
  'sign-monthly': { client: string; month: string; note?: string };
  'standup-setup': { account: string };
  /** One campaign per call, as standup-board.cjs writes it. Builder B confirms field names against the source. */
  'standup-feedback': { account: string; date: string; campaign: string; action_category: string; score: 1 | 2 | 3 | 4 | 5; note?: string };
}

/** App routes. All go through checkRequest; changes are POST JSON with body AdsRequests[action]. */
export const ADS_ROUTES = {
  capabilities: '/api/ads/capabilities',
  accounts: '/api/ads/accounts',
  approvals: '/api/ads/approvals', // ?client=
  proposal: '/api/ads/proposal', // ?client=&id=
  board: '/api/ads/board', // ?account=
  standupBrief: '/api/ads/standup-brief', // ?account=
  /** `GET ?p=` → LibraryItem (see ADS_FILE_PATTERN). */
  file: '/api/ads/file',
  /** `POST /api/ads/do/<AdsChangeAction>`. */
  change: (action: AdsChangeAction) => `/api/ads/do/${action}`,
  /** `POST { client, id }`: the person checked the account after an unknown outcome. */
  clearInflight: '/api/ads/inflight/clear',
} as const;

/**
 * The ads summary the store loads at boot (when Ad Manager may be visible) and on `ads-changed`: what the rail
 * count, the drawer row, Home's card and the visibility check read. `GET ADS_ROUTES.capabilities` plus
 * `GET ADS_ROUTES.approvals` reduced to this.
 */
export interface AdsSummary {
  visible: boolean; // features has ADS_CAPABILITY && adsAccess && adsManager && skillAccess allowed
  me: AdsCapabilities['me'];
  /** Same person as the app's identity (see AdsCapabilities.me). */
  sameIdentity: boolean;
  waiting: number;
  clients: { slug: string; name: string; waiting: number }[];
}
