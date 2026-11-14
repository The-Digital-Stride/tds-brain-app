/**
 * Which level a reply runs at (plan 2026-11-14-skill-levels-and-helpers, decision 3), and the small
 * tier rules around it. Pure: no I/O, no clock.
 */
import type { EngineChoice } from '../../shared/contract.ts';
import {
  FALLBACK_TIER,
  LEVEL_TIERS,
  LEVEL_TIERS_ORDER,
  type LevelMode,
  type LevelPick,
  type LevelTier,
  type OwnLevel,
  QUICK_REPICK_MIN_CHARS,
  type SkillLevel,
  type TurnLevel,
} from '../../shared/levels-contract.ts';

export interface LevelInputs {
  mode: LevelMode;
  /** The Settings choice ("Choose myself"); null parts = Same as Claude Code. */
  manual: EngineChoice;
  /** The skill this turn runs (a typed `/name`, or the one Claude just ran), or null. */
  skill: string | null;
  /** That skill's own frontmatter `model` / `effort`, or null. */
  ownLevel: OwnLevel | null;
  teamLevels: Record<string, SkillLevel>;
  /** The tier the person chose for this chat, or null for automatic. */
  chatTier: LevelTier | null;
  /** The chat's automatic pick, or null when there is none yet. */
  pick: LevelPick | null;
}

export interface ResolvedLevel {
  level: TurnLevel;
  /** What to apply to the engine (`setModel` + `applyFlagSettings`). */
  choice: EngineChoice;
}

export function tierChoice(tier: LevelTier): EngineChoice {
  const spec = LEVEL_TIERS[tier];
  return { model: spec.model, effort: spec.effort };
}

function rank(tier: LevelTier | null): number {
  return tier === null ? -1 : LEVEL_TIERS_ORDER.indexOf(tier);
}

/** True when `a` is strictly higher than `b` (null = nothing applied yet, lower than any tier). */
export function isHigherTier(a: LevelTier, b: LevelTier | null): boolean {
  return rank(a) > rank(b);
}

export function maxTier(a: LevelTier, b: LevelTier): LevelTier {
  return isHigherTier(b, a) ? b : a;
}

/** Either field set counts: the app then never switches for that skill. */
export function hasOwnLevel(own: OwnLevel | null | undefined): own is OwnLevel {
  return !!own && (own.model !== null || own.effort !== null);
}

/** Rows 3, 5 and 6: the chat's own level, without any skill. */
function baseLevel(i: Pick<LevelInputs, 'chatTier' | 'pick'>): TurnLevel & { tier: LevelTier } {
  if (i.chatTier) return { tier: i.chatTier, source: { kind: 'chat' } };
  if (i.pick) return { tier: i.pick.tier, source: { kind: 'auto', reason: i.pick.reason } };
  return { tier: FALLBACK_TIER, source: { kind: 'fallback' } };
}

/**
 * Decision 3, in order: manual; the skill's own setting (on the chat's base level, ignoring any team
 * level); the person's chat level; the skill's team level; the automatic pick; the fallback.
 */
export function resolveLevel(i: LevelInputs): ResolvedLevel {
  if (i.mode === 'manual') {
    return { level: { tier: null, source: { kind: 'manual' } }, choice: { ...i.manual } };
  }
  if (i.skill && hasOwnLevel(i.ownLevel)) {
    const base = baseLevel(i);
    return {
      level: { tier: null, source: { kind: 'skill-own', skill: i.skill } },
      choice: tierChoice(base.tier),
    };
  }
  if (i.chatTier) return { level: baseLevel(i), choice: tierChoice(i.chatTier) };
  const team = i.skill && Object.hasOwn(i.teamLevels, i.skill) ? i.teamLevels[i.skill] : undefined;
  if (i.skill && team) {
    return {
      level: { tier: team.tier, source: { kind: 'team', skill: i.skill } },
      choice: tierChoice(team.tier),
    };
  }
  const base = baseLevel(i);
  return { level: base, choice: tierChoice(base.tier) };
}

/**
 * Decision 6: a chat on Quick re-picks (upward only) when a follow-up is long, has attachments or
 * names a skill with no level. A chat on any other tier never re-picks.
 */
export function shouldRepickQuick(i: {
  tier: LevelTier;
  textLength: number;
  attachments: number;
  unlevelledSkill: boolean;
}): boolean {
  if (i.tier !== 'quick') return false;
  return i.textLength >= QUICK_REPICK_MIN_CHARS || i.attachments > 0 || i.unlevelledSkill;
}
