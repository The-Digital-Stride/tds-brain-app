/**
 * Start-up kits in shadow mode and the token savings ledger (plan 2026-11-15-startup-kits).
 * Every builder builds against this file. Decision numbers refer to that plan.
 *
 * Shadow mode: the app picks and records a kit for each chat and switches nothing off. Nothing here
 * changes the engine's options (decision 13).
 */
import type { ChatKind } from './contract.ts';
import type { LevelTier } from './levels-contract.ts';

/** Decision 13. The only mode this release; the switch-on release adds 'on'. */
export const KITS_MODE = 'shadow' as const;
export type KitsMode = typeof KITS_MODE;

// ---------------------------------------------------------------------------
// Kits (decision 5)
// ---------------------------------------------------------------------------

export const KIT_IDS = ['core', 'ads', 'web', 'full'] as const;
export type KitId = (typeof KIT_IDS)[number];
/** No pick, a failed pick, an unknown id: keeps everything. */
export const KIT_FALLBACK: KitId = 'full';
/** In `connectors` or `plugins`: keeps every item of that kind. */
export const KEEP_ALL = '*';

export interface Kit {
  id: KitId;
  /** Shown to people (UK English). Fixed: the brain file can't change it. */
  label: string;
  /** For the picker's prompt and the review. Fixed: the brain file can't change it. */
  blurb: string;
  /**
   * Connector name patterns that stay on, compared after `normName` as substrings of the server's
   * normalised name (`gmail` keeps `claude.ai Gmail`). A plugin's own servers follow `plugins`.
   */
  connectors: readonly string[];
  /** Plugin names that stay on (the part before `@` in `init.plugins[].source`). */
  plugins: readonly string[];
}

const CORE_CONNECTORS = [
  'gmail',
  'googlecalendar',
  'googledrive',
  'googledocs',
  'googlesheets',
  'googleslides',
  'claudedocs',
  'slack',
  'monday',
  'wisprflow',
  'timelens',
  'xero',
  'tdsportal',
] as const;
const CORE_PLUGINS = ['document-skills', 'productivity'] as const;

/** Working set from the spike; the brain file and the review tune contents, never ids or blurbs. */
export const BUILT_IN_KITS: Readonly<Record<KitId, Kit>> = {
  core: {
    id: 'core',
    label: 'Everyday',
    blurb: 'everyday agency work: clients, notes, to-dos, email, calendar, documents and meetings',
    connectors: CORE_CONNECTORS,
    plugins: CORE_PLUGINS,
  },
  ads: {
    id: 'ads',
    label: 'Ads and search',
    blurb: 'paid ads, SEO and analytics: ad accounts, keywords, rankings, traffic and performance reports',
    connectors: [
      ...CORE_CONNECTORS,
      'semrush',
      'scrapingbee',
      'ahrefs',
      'similarweb',
      'supermetrics',
      'amplitude',
      'klaviyo',
      'googleads',
      'gads',
      'analytics',
      'searchconsole',
      'tdsmeta',
    ],
    plugins: [...CORE_PLUGINS, 'marketing'],
  },
  web: {
    id: 'web',
    label: 'Websites and code',
    blurb: 'websites, code and design: building or fixing sites, deployments, CMS work and design files',
    connectors: [
      ...CORE_CONNECTORS,
      'vercel',
      'figma',
      'stitch',
      'github',
      'context7',
      'playwright',
      'filesystem',
      'mermaid',
      'paper',
      'claudedesign',
      'payload',
      'tdsmeta',
    ],
    plugins: [
      ...CORE_PLUGINS,
      'superpowers',
      'vercel',
      'frontend-design',
      'feature-dev',
      'design',
      'engineering',
      'andrej-karpathy-skills',
    ],
  },
  full: {
    id: 'full',
    label: 'Everything',
    blurb: 'anything else, or when unsure',
    connectors: [KEEP_ALL],
    plugins: [KEEP_ALL],
  },
};

/**
 * The brain's `.claude/tdsapp-kits.json`, written only by the `tdsapp-kits` script. Changes contents
 * only. Unknown ids and keys are ignored; a missing or bad file means `BUILT_IN_KITS`, silently.
 * `full` can't be changed.
 */
export const KITS_FILE = '.claude/tdsapp-kits.json';
export interface KitsFile {
  version: 1;
  kits: Partial<Record<Exclude<KitId, 'full'>, { connectors?: string[]; plugins?: string[] }>>;
  updatedBy?: string;
  updatedAt?: string;
}

/**
 * Always kept, never a kit's to trim (decision 5): the brain's own project servers (names from the
 * brain's `.mcp.json`), its skills, agents and rules, and `@builtin` plugins.
 */
export interface KeepRules {
  projectServers: readonly string[];
}

/** One normaliser for kit patterns, reading rows, `mcpInstructions[].serverName` and tool names (decision 8). */
export type NormNameFn = (raw: string) => string;

// ---------------------------------------------------------------------------
// The pick (decision 6)
// ---------------------------------------------------------------------------

export type KitPickHow = 'auto' | 'rule' | 'fallback';
export interface KitPick {
  kit: KitId;
  how: KitPickHow;
}

// ---------------------------------------------------------------------------
// Start-up reading and would-save (decision 7)
// ---------------------------------------------------------------------------

export const STARTUP_GROUPS = ['system', 'skills', 'connectors', 'agents', 'memory', 'hooks', 'other'] as const;
export type StartupGroup = (typeof STARTUP_GROUPS)[number];

export interface StartupReading {
  /** `totalTokens` of the first `full` read (the start-up plus one tiny exchange). */
  total: number;
  byGroup: Record<StartupGroup, number>;
  /** `deferred_tools_delta`: the tool-name list, not split per server by the engine. */
  toolNameList: number;
  /** Per server: the engine's instruction figure and the server's share of tool-name characters. */
  connectors: { name: string; instructions: number; toolNameChars: number }[];
  /** Per plugin: its skills' and agents' listing tokens. */
  plugins: { name: string; skills: number; agents: number }[];
}

/** Both measured from one reading; `approx` ≥ `sure`. Hook text is in neither. Never the ledger. */
export interface WouldSave {
  /** The engine's per-item figures for what the kit drops: instructions, plugin skills, plugin agents. */
  sure: number;
  /** `sure` plus the kit's apportioned share of `toolNameList`. */
  approx: number;
}

export type StartupReadingFn = (res: unknown) => StartupReading | null;
export type WouldSaveFn = (reading: StartupReading, kit: Kit, keep: KeepRules) => WouldSave;

// ---------------------------------------------------------------------------
// What a chat used (decision 8)
// ---------------------------------------------------------------------------

export interface ChatUse {
  /** Skill names as used (`plugin:skill` for plugin skills), from `Skill` input and a typed `/name`. */
  skills: string[];
  /** Server names from `mcp__<server>__<tool>`, normalised. */
  connectors: string[];
}
/** Every kit (KIT_IDS order) that keeps everything in `use`. `full` is always in it. */
export type FitsFn = (use: ChatUse, kits: Readonly<Record<KitId, Kit>>, keep: KeepRules) => KitId[];
/** Caps on what one record holds. */
export const USE_MAX = { skills: 40, connectors: 40 } as const;

// ---------------------------------------------------------------------------
// Shadow record and the brain hand-off (decisions 9–11)
// ---------------------------------------------------------------------------

/** One per chat in the app's data folder (`kit-shadow.json`), keyed by `sdkSessionId`. */
export interface KitShadowRecord {
  v: 1;
  /** UTC `YYYY-MM-DD` of the chat's first turn. */
  day: string;
  kind: ChatKind;
  /** Rises with every change, so readers keep the newest copy of a chat. */
  seq: number;
  /** The `seq` the brain script last accepted; null = never. Pending while `handedOffSeq !== seq`. */
  handedOffSeq: number | null;
  turns: number;
  /** This chat's ledger counts (decision 4 of the overseer's review): kept for personal chats too. */
  compacted: number;
  cacheRead: number;
  /** Work chats only (left out of personal records). Never `LevelPick.reason`, never anything typed. */
  work?: {
    kit: KitId;
    how: KitPickHow;
    fits: KitId[];
    tier: LevelTier | null;
    startup: { total: number; byGroup: Record<StartupGroup, number> } | null;
    wouldSave: WouldSave | null;
    used: ChatUse;
    peakPercent: number | null;
    summaries: number;
  };
}

export const KIT_SHADOW_FILE = 'kit-shadow.json';
export const KIT_SHADOW_LIMITS = { maxChats: 2_000, keepDays: 35 } as const;
/** Random per install, in the app's data folder; salts the `chat` hash. Never leaves this Mac. */
export const APP_USAGE_SALT_FILE = 'app-usage-salt';

/** What the app sends `tdsapp-usage.cjs` on stdin: one JSON object per call. */
export interface AppUsageEvent extends Omit<KitShadowRecord, 'handedOffSeq'> {
  event: 'app';
  /** sha256(salt + sdkSessionId), hex, first 16 characters. Never the raw id. */
  chat: string;
  mode: KitsMode;
  /** The app's version (`package.json`). */
  app: string;
}

/** Relative to the brain root. */
export const APP_USAGE_SCRIPT = '.claude/skills/tdsapp-kits/scripts/tdsapp-usage.cjs';
/** `capabilities` must list this before the app sends events. */
export const APP_USAGE_CAPABILITY = 'app-event-v1';

// ---------------------------------------------------------------------------
// The ledger (decisions 1–3)
// ---------------------------------------------------------------------------

export type SavingsSource = 'summary' | 'cache' | 'kits';
export type SavingsMeasure = 'compacted' | 'reused' | 'switched-off';

/** `cache` / `reused` is shown on its own line and never added into "saved". */
export interface SavingsEntry {
  source: SavingsSource;
  measure: SavingsMeasure;
  tokens: number;
  kind: ChatKind;
  /**
   * Persisted only for summaries (`c:<boundary uuid>`), so a boundary counts once across app runs.
   * Cache entries dedupe in memory per session and pass null.
   */
  dedupeKey: string | null;
  /** Epoch ms; defaults to now. Its UTC day is the bucket. */
  at?: number;
}

export interface SavingsTotals {
  /** Every source except `cache`. */
  saved: number;
  /** `cache` only. */
  reused: number;
  bySource: Partial<Record<SavingsSource, number>>;
}

export interface SavingsSummary {
  /** UTC day counting began on this Mac, or null before anything was counted. */
  since: string | null;
  today: SavingsTotals;
  last7: SavingsTotals;
  last30: SavingsTotals;
  all: SavingsTotals;
  kitsMode: KitsMode;
  /** Always null this release (team view later). */
  team: null;
}

export const TOKEN_SAVINGS_FILE = 'token-savings.json';
/** Kept summary dedupe keys. */
export const TOKEN_SAVINGS_LIMITS = { maxKeys: 5_000 } as const;
export const USAGE_SAVINGS_PATH = '/api/usage/savings';

// ---------------------------------------------------------------------------
// The tracker facade Builder C provides and the session manager calls (decisions 2, 6–10)
// ---------------------------------------------------------------------------

/**
 * Every method is synchronous for the caller and never throws; writes and the hand-off run in the
 * background. `key` is the chat's `sdkSessionId` once known.
 */
export interface KitTracker {
  /** A chat's engine started. `resumed`: an existing session (no start-up read, no new day). */
  onStart(key: string, info: { kind: ChatKind; resumed: boolean }): void;
  onKind(key: string, kind: ChatKind): void;
  /** The session id changed at init: move the record. */
  onRekey(from: string, to: string): void;
  /** Set once per chat; later calls are ignored. */
  onPick(key: string, pick: KitPick, tier: LevelTier | null): void;
  /** A typed `/name` at the start of a message. */
  onTypedSkill(key: string, name: string): void;
  /**
   * Every engine message, live stream only (never replay). `helper`: from a helper agent
   * (`parent_tool_use_id` set): counts toward "used", never toward the ledger.
   */
  onMessage(key: string, raw: unknown, helper: boolean): void;
  /** The one `full` read after a new chat's first reply. */
  onStartup(key: string, res: unknown): void;
  onTurnEnd(key: string, info: { percent: number | null }): void;
  /** Close or idle close: hands off in the background; never awaited. */
  onClose(key: string): void;
  /** At app start: hand off every record whose `handedOffSeq !== seq`. */
  flushPending(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Picker prompt lines (decision 6): fixed ids and blurbs only.
// ---------------------------------------------------------------------------

export const KIT_PICK_LINES: string = KIT_IDS.map((id) => `- ${id}: ${BUILT_IN_KITS[id].blurb}.`).join('\n');
