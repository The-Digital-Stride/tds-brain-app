/**
 * Contract for the Ad Manager and its bridge skill `tdsapp-ads` (brain-skills/tdsapp-ads).
 * Plan: docs/plans/2026-11-16-workbench-ad-manager.md, decisions 7 to 22.
 *
 * The app runs `node <brain>/.claude/skills/tdsapp-ads/scripts/tdsapp-ads.cjs <action>` through
 * `server/brain/skill-runner.ts`, writes one JSON object to stdin and reads one JSON line from stdout:
 * `{ ok: true, ...reply }` or `{ ok: false, code: AdsErrorCode, error: string }` (error text is for
 * developers; the app shows its own words from ADS_ERROR_MESSAGES).
 *
 * Every rule (who may decide, what may be applied, file formats) lives in the brain's
 * `.claude/skills/ads-manager/scripts/lib/proposals.cjs`, `monthly.cjs`, `apply.cjs` and
 * `client-draft.cjs`. The bridge loads them at run time and never copies their logic.
 * Who acts always comes from this Mac's git identity matched against the roster; no stdin field
 * names the actor. A test checks the script's constants match this file.
 */

/** Folder and script, relative to the brain root. */
export const ADS_SKILL = { skill: 'tdsapp-ads', script: '.claude/skills/tdsapp-ads/scripts/tdsapp-ads.cjs' } as const;

/** The capability the app needs before it shows Ad Manager. */
export const ADS_CAPABILITY = 'ads-v1';

/** Read actions run in their own queue (several at once); change actions run one at a time per Mac. */
export type AdsReadAction = 'capabilities' | 'accounts' | 'approvals' | 'proposal' | 'board' | 'standup-brief';
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

/** Time limits in ms. `apply` is never retried by anyone; a time-out is reported as `unknown-outcome`. */
export const ADS_TIMEOUT_MS: Record<AdsAction, number> = {
  capabilities: 15_000,
  accounts: 15_000,
  approvals: 15_000,
  proposal: 15_000,
  board: 15_000,
  'standup-brief': 15_000,
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

export const ADS_PROPOSAL_ID = /^\d{8}-\d{2}-[a-z0-9-]+$/;
export const ADS_CLIENT_SLUG = /^[a-z0-9-]+$/;
export const ADS_MONTH = /^\d{4}-\d{2}$/;

/** Files the app may open from Ad Manager (read directly by the app; decision 18). No `..`, inside the brain's real path. */
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
  capabilities: string[]; // includes ADS_CAPABILITY
  version: string;
  /** gads-proxy config or google-ads.yaml present (the Workbench's hasAdsAccess()). */
  adsAccess: boolean;
  /** ads-manager skill and the libraries the bridge needs are present. */
  adsManager: boolean;
  /** The person at this Mac, from git identity and the roster, or null when not on the roster. */
  me: { slug: string; name: string; role: string } | null;
}

export interface AdsAccount {
  key: string; // account key, as in .claude/accounts.json
  name: string;
  /** Client folder slug, for chats and approvals. null when the account has no client folder. */
  client: string | null;
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
}

// ── Requests (stdin) ───────────────────────────────────────────────────────────────────────────

export interface AdsRequests {
  capabilities: Record<string, never>;
  accounts: Record<string, never>;
  approvals: { client?: string };
  proposal: { client: string; id: string };
  board: { account: string };
  'standup-brief': { account: string };
  decide: { client: string; id: string; action: 'approve' | 'request-changes' | 'reject'; note?: string };
  'dry-run': { client: string; id: string };
  apply: { client: string; id: string; confirmed: true };
  'client-draft': { client: string; id: string; again?: boolean };
  'client-approved': { client: string; id: string; who: string; note?: string };
  decided: { client: string; id: string; note: string };
  'sign-monthly': { client: string; month: string; note?: string };
  'standup-setup': { account: string };
  'standup-feedback': { account: string; date: string; ratings: { campaign: string; score: 1 | 2 | 3 | 4 | 5; note?: string }[] };
}

/**
 * App routes (all through checkRequest; changes are POST JSON):
 *   GET  /api/ads/capabilities
 *   GET  /api/ads/accounts
 *   GET  /api/ads/approvals[?client=]
 *   GET  /api/ads/proposal?client=&id=
 *   GET  /api/ads/board?account=
 *   GET  /api/ads/standup-brief?account=
 *   POST /api/ads/<AdsChangeAction>   body: AdsRequests[action]
 *   GET  /api/brain-file?p=<path matching ADS_FILE_PATTERN>
 * Server-sent event on the existing app stream when watched ads folders change: { type: 'ads-changed' }.
 */
