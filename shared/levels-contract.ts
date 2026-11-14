/**
 * Levels and helpers (plan docs/plans/2026-11-14-skill-levels-and-helpers.md).
 *
 * A "level" is how hard Claude works on something: a tier (Quick, Standard, Deep) that maps to a
 * model and an effort in ONE table, LEVEL_TIERS, so a new model generation is a one-line change.
 * Team levels, the automatic pick and the app's helpers all speak in tiers.
 *
 * Small additive edits to existing types live in `shared/contract.ts` and are listed in the plan's
 * Contract section (AppPrefs.levelMode, SkillInfo.ownLevel, Bootstrap.skillLevels, ChatEvent 'level',
 * ROUTES.skillLevels).
 */
import type { EffortLevel } from './contract.ts';

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export const LEVEL_TIERS_ORDER = ['quick', 'standard', 'deep'] as const;
export type LevelTier = (typeof LEVEL_TIERS_ORDER)[number];

export interface TierSpec {
  /** Model alias passed to Claude Code (`setModel`, `AgentDefinition.model`). */
  model: string;
  effort: EffortLevel;
  /** UK English, shown in the app, e.g. "Quick". */
  label: string;
  /** One plain line for menus, e.g. "Look-ups, short answers and simple edits". */
  blurb: string;
}

/** The only place tiers become models. */
export const LEVEL_TIERS: Record<LevelTier, TierSpec> = {
  quick: {
    model: 'haiku',
    effort: 'medium',
    label: 'Quick',
    blurb: 'Look-ups, short answers and simple edits',
  },
  standard: {
    model: 'sonnet',
    effort: 'medium',
    label: 'Standard',
    blurb: 'Most writing, reports and everyday work',
  },
  deep: {
    model: 'opus',
    effort: 'high',
    label: 'Deep',
    blurb: 'Audits, strategy and anything that needs careful judgement',
  },
};

export function isLevelTier(v: unknown): v is LevelTier {
  return typeof v === 'string' && (LEVEL_TIERS_ORDER as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Team skill levels (brain file, written only by the tdsapp-skill-levels brain skill)
// ---------------------------------------------------------------------------

/** Brain-relative path of the team file. The app only reads it. */
/** In `.claude/` because scouts may write there and `.team-config/` is owner-only (brain policy). */
export const SKILL_LEVELS_FILE = '.claude/tdsapp-skill-levels.json';

export interface SkillLevel {
  tier: LevelTier;
  /** Member slug of who set it, e.g. "ian-hancock". 'prefill' for the reviewed first batch. */
  setBy: string;
  /** ISO timestamp. */
  at: string;
  /** Optional one-line reason, at most SKILL_LEVEL_NOTE_MAX characters. */
  note?: string;
}

export const SKILL_LEVEL_NOTE_MAX = 160;

/** On disk: `{ "version": 1, "levels": { "<skill-name>": SkillLevel } }`. Unknown tiers and junk rows are skipped. */
export interface SkillLevelsFile {
  version: 1;
  levels: Record<string, SkillLevel>;
}

/** Roles that may set or clear a team level (user decision). */
export const SKILL_LEVEL_SETTERS = ['owner', 'scout'] as const;

/**
 * `POST ROUTES.skillLevels`: set (`tier`) or clear (`tier: null`) one skill's team level.
 * 403 `not-allowed` unless the person's role is in SKILL_LEVEL_SETTERS; 400 `bad-request` for an
 * unknown skill or tier. Runs the brain skill's script; never writes the file itself.
 * Answers with the fresh `SkillLevels`.
 */
export interface SetSkillLevelRequest {
  skill: string;
  tier: LevelTier | null;
  note?: string;
}

/** What `GET ROUTES.skillLevels` (and `Bootstrap.skillLevels`) returns. */
export interface SkillLevels {
  levels: Record<string, SkillLevel>;
  /** True when this person may change them. */
  canSet: boolean;
  /** False when the brain has no tdsapp-skill-levels skill yet (setting is then unavailable). */
  writable: boolean;
}

/** A skill's own frontmatter `model` / `effort`, read only. When either is set the app never switches for it. */
export interface OwnLevel {
  model: string | null;
  effort: EffortLevel | null;
}

// ---------------------------------------------------------------------------
// Which level a turn runs at
// ---------------------------------------------------------------------------

/** `AppPrefs.levelMode`. 'manual' = Settings' model and effort as in v0.19.0 (null = Same as Claude Code). */
export type LevelMode = 'auto' | 'manual';

export type LevelSource =
  /** Person chose it in Settings ("Choose myself"). */
  | { kind: 'manual' }
  /** The skill's own frontmatter; Claude Code applies it, the app leaves it alone. */
  | { kind: 'skill-own'; skill: string }
  /** The team level for this skill. */
  | { kind: 'team'; skill: string }
  /** Picked automatically for this chat at its first message (or re-picked). */
  | { kind: 'auto'; reason: string }
  /** The person changed it for this chat from the line under the message box. */
  | { kind: 'chat' }
  /** The picker failed, timed out or is backing off: FALLBACK_TIER. */
  | { kind: 'fallback' };

/** ChatEvent `{ type: 'level'; level: TurnLevel }`: sent on streams opened with `levels=1` only. */
export interface TurnLevel {
  /** null when the source is 'manual' or 'skill-own' (no tier applies). */
  tier: LevelTier | null;
  source: LevelSource;
}

/** `POST ROUTES.chatLevel(sessionId)`: the person picks a tier for the rest of this chat, or null to go back to automatic. */
export interface ChatLevelRequest {
  tier: LevelTier | null;
}

// ---------------------------------------------------------------------------
// The automatic pick
// ---------------------------------------------------------------------------

export interface LevelPick {
  tier: LevelTier;
  /** Hint for the main chat: the job splits into independent parts (phase 2). */
  helpers: boolean;
  /** Plain, at most 80 characters, shown as "Why?" under the message box. */
  reason: string;
}

export const LEVEL_PICK = {
  /** Only this much of the message is read. */
  maxChars: 4_000,
  /** The pick gets this long; then FALLBACK_TIER applies. Measured: median 2.3 s, p90 5.0 s (20 runs). */
  timeoutMs: 4_000,
  /** After a hard failure (engine missing, bad reply, error), skip the picker for this long. A timeout never starts it. */
  backoffMs: 60_000,
} as const;

// ---------------------------------------------------------------------------
// Helpers (phase 2)
// ---------------------------------------------------------------------------

export const HELPER_NAMES = ['tdsapp-scout', 'tdsapp-worker', 'tdsapp-expert'] as const;
export type HelperName = (typeof HELPER_NAMES)[number];

export interface HelperSpec {
  tier: LevelTier;
  /** Shown in the chat, e.g. "Scout". */
  label: string;
  /**
   * Tools the helper may use (AgentDefinition.tools). Never Write, Edit, MultiEdit, NotebookEdit,
   * Skill (deprecated in `tools`) or Agent. Only the worker gets Bash and connectors (mcp__*), and
   * those still ask. The definitions never set `permissionMode` or `background`.
   */
  /** null = inherit the chat's tools and rely on the disallow list (fallback if `mcp__*` in `tools` isn't honoured). */
  tools: string[] | null;
  disallowedTools: string[];
  maxTurns: number;
}

/** At most this many helpers at once, and per reply. Enforced in the Agent hook. */
export const HELPERS_AT_ONCE_MAX = 4;
export const HELPERS_PER_REPLY_MAX = 8;

/**
 * The tier given to a built-in helper (no `subagent_type`, or general-purpose / Explore / Plan) that
 * names no model, in automatic mode only, when the chat is on Deep. Agents with their own model
 * (brain or personal agent files) keep it.
 */
export const OTHER_HELPER_TIER: LevelTier = 'standard';

/** When the pick can't be made. */
export const FALLBACK_TIER: LevelTier = 'standard';

/** A follow-up re-picks a chat on Quick only when it is at least this long, has attachments or names a skill with no level. */
export const QUICK_REPICK_MIN_CHARS = 200;

// ---------------------------------------------------------------------------
// Chat levels kept across resume (app data folder, never the brain)
// ---------------------------------------------------------------------------

/** One chat's level, stored by `sdkSessionId` so a resumed chat keeps it. */
export interface ChatLevelRecord {
  tier: LevelTier;
  /** 'auto' = the pick; 'chat' = the person chose it from the line under the message box. */
  source: 'auto' | 'chat';
  /** ISO timestamp of the last change; the oldest are pruned first. */
  at: string;
}

/** At most this many chats are remembered (`Record<sdkSessionId, ChatLevelRecord>`). */
export const CHAT_LEVELS_MAX = 500;

// ---------------------------------------------------------------------------
// Hand-off between the engine (Builder A) and the server wiring (Builder B)
// ---------------------------------------------------------------------------

/**
 * What the session manager reads to resolve a level. Builder B implements it in
 * `server/brain/skill-levels.ts` + `server/brain/skills.ts` and passes it as
 * `SessionManagerOptions.levels`. Without it the manager behaves as v0.19.0 (manual).
 */
export interface LevelSources {
  /** Fresh team levels from SKILL_LEVELS_FILE; {} when missing or unreadable. Never throws. */
  teamLevels(): Promise<Record<string, SkillLevel>>;
  /**
   * A skill's (or command's) own frontmatter `model` / `effort`, by name, for any skill on disk
   * including hidden ones. null when neither is set or nothing has that name. Never throws.
   */
  ownLevel(skill: string): Promise<OwnLevel | null>;
}

/** Chat levels kept across resume (Builder B: `server/store/chat-levels.ts`, in the app's data folder). */
export interface ChatLevelStore {
  get(sdkSessionId: string): Promise<ChatLevelRecord | null>;
  /** Caps at CHAT_LEVELS_MAX, pruning the oldest `at` first. Never throws. */
  set(sdkSessionId: string, record: ChatLevelRecord): Promise<void>;
}

/**
 * Session manager additions (Builder A), called by Builder B's routes and `server/index.ts`:
 * - `setEngineChoice(choice)` now takes `EngineChoice & { levelMode?: LevelMode }`; an absent
 *   `levelMode` means 'manual' (v0.19.0 behaviour, so older callers and tests are unchanged).
 * - `setChatLevel(sessionId, tier)` → `TurnLevel` for `POST ROUTES.chatLevel`.
 * - `prewarmPick(text)`: called by the client-guess route with the message text; fire and forget.
 */
export interface LevelSessionApi {
  setChatLevel(sessionId: string, tier: LevelTier | null): Promise<TurnLevel>;
  prewarmPick(text: string): void;
}
