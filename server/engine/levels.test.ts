import { describe, expect, it } from 'vitest';
import {
  LEVEL_TIERS,
  type LevelPick,
  QUICK_REPICK_MIN_CHARS,
  type SkillLevel,
} from '../../shared/levels-contract.ts';
import {
  isHigherTier,
  type LevelInputs,
  maxTier,
  resolveLevel,
  shouldRepickQuick,
  tierChoice,
} from './levels.ts';

const team = (tier: SkillLevel['tier']): SkillLevel => ({
  tier,
  setBy: 'ian-hancock',
  at: '2026-11-14T00:00:00Z',
});
const PICK: LevelPick = { tier: 'quick', helpers: false, reason: 'A short look-up' };

function inputs(over: Partial<LevelInputs> = {}): LevelInputs {
  return {
    mode: 'auto',
    manual: { model: null, effort: null },
    skill: null,
    ownLevel: null,
    teamLevels: {},
    chatTier: null,
    pick: null,
    ...over,
  };
}

describe('resolveLevel (decision 3)', () => {
  it('row 1: manual mode uses the Settings choice and ignores team levels, chat level and pick', () => {
    const r = resolveLevel(
      inputs({
        mode: 'manual',
        manual: { model: 'opus', effort: 'max' },
        skill: 'audit',
        teamLevels: { audit: team('quick') },
        chatTier: 'quick',
        pick: PICK,
      }),
    );
    expect(r.level).toEqual({ tier: null, source: { kind: 'manual' } });
    expect(r.choice).toEqual({ model: 'opus', effort: 'max' });
  });

  it('row 1: manual "Same as Claude Code" stays null', () => {
    const r = resolveLevel(inputs({ mode: 'manual' }));
    expect(r.choice).toEqual({ model: null, effort: null });
  });

  it("row 2: a skill's own setting applies the chat's base level, ignoring its team level", () => {
    const r = resolveLevel(
      inputs({
        skill: 'own',
        ownLevel: { model: 'haiku', effort: null },
        teamLevels: { own: team('deep') },
        pick: { ...PICK, tier: 'standard' },
      }),
    );
    expect(r.level).toEqual({ tier: null, source: { kind: 'skill-own', skill: 'own' } });
    expect(r.choice).toEqual(tierChoice('standard'));
  });

  it('row 2: an own level with only the effort set still counts, and the base is the chat level', () => {
    const r = resolveLevel(
      inputs({ skill: 'own', ownLevel: { model: null, effort: 'low' }, chatTier: 'deep', pick: PICK }),
    );
    expect(r.level.source).toEqual({ kind: 'skill-own', skill: 'own' });
    expect(r.choice).toEqual(tierChoice('deep'));
  });

  it('row 2: with no chat level or pick the base is the fallback', () => {
    const r = resolveLevel(inputs({ skill: 'own', ownLevel: { model: 'opus', effort: null } }));
    expect(r.choice).toEqual(tierChoice('standard'));
  });

  it('an own level with neither field set is no own level', () => {
    const r = resolveLevel(
      inputs({ skill: 'x', ownLevel: { model: null, effort: null }, teamLevels: { x: team('deep') } }),
    );
    expect(r.level).toEqual({ tier: 'deep', source: { kind: 'team', skill: 'x' } });
  });

  it("row 3: the person's chat level beats the team level and the pick", () => {
    const r = resolveLevel(
      inputs({ skill: 'x', teamLevels: { x: team('deep') }, chatTier: 'quick', pick: PICK }),
    );
    expect(r.level).toEqual({ tier: 'quick', source: { kind: 'chat' } });
    expect(r.choice).toEqual({ model: 'haiku', effort: 'medium' });
  });

  it("row 4: a team level for the skill being run beats the chat's pick", () => {
    const r = resolveLevel(inputs({ skill: 'x', teamLevels: { x: team('deep') }, pick: PICK }));
    expect(r.level).toEqual({ tier: 'deep', source: { kind: 'team', skill: 'x' } });
    expect(r.choice).toEqual({ model: 'opus', effort: 'high' });
  });

  it("row 4: another skill's team level does not apply", () => {
    const r = resolveLevel(inputs({ skill: 'y', teamLevels: { x: team('deep') }, pick: PICK }));
    expect(r.level).toEqual({ tier: 'quick', source: { kind: 'auto', reason: 'A short look-up' } });
  });

  it("row 5: the chat's automatic pick", () => {
    const r = resolveLevel(inputs({ pick: { tier: 'deep', helpers: true, reason: 'Audit' } }));
    expect(r.level).toEqual({ tier: 'deep', source: { kind: 'auto', reason: 'Audit' } });
    expect(r.choice).toEqual(tierChoice('deep'));
  });

  it('row 6: no pick is the fallback tier (Standard)', () => {
    const r = resolveLevel(inputs());
    expect(r.level).toEqual({ tier: 'standard', source: { kind: 'fallback' } });
    expect(r.choice).toEqual({ model: LEVEL_TIERS.standard.model, effort: LEVEL_TIERS.standard.effort });
  });
});

describe('tiers', () => {
  it('compares by order, never lowering', () => {
    expect(isHigherTier('deep', 'standard')).toBe(true);
    expect(isHigherTier('standard', 'quick')).toBe(true);
    expect(isHigherTier('quick', 'standard')).toBe(false);
    expect(isHigherTier('standard', 'standard')).toBe(false);
    expect(isHigherTier('quick', null)).toBe(true);
    expect(maxTier('quick', 'deep')).toBe('deep');
    expect(maxTier('standard', 'quick')).toBe('standard');
  });

  it('turns a tier into the model and effort from the one table', () => {
    for (const t of ['quick', 'standard', 'deep'] as const) {
      expect(tierChoice(t)).toEqual({ model: LEVEL_TIERS[t].model, effort: LEVEL_TIERS[t].effort });
    }
  });
});

describe('the Quick re-pick rule (decision 6)', () => {
  const base = { tier: 'quick' as const, textLength: 10, attachments: 0, unlevelledSkill: false };

  it('re-picks a Quick chat for a long follow-up, attachments or an unlevelled skill', () => {
    expect(shouldRepickQuick(base)).toBe(false);
    expect(shouldRepickQuick({ ...base, textLength: QUICK_REPICK_MIN_CHARS - 1 })).toBe(false);
    expect(shouldRepickQuick({ ...base, textLength: QUICK_REPICK_MIN_CHARS })).toBe(true);
    expect(shouldRepickQuick({ ...base, attachments: 1 })).toBe(true);
    expect(shouldRepickQuick({ ...base, unlevelledSkill: true })).toBe(true);
  });

  it('never re-picks a chat that is not on Quick (upward only)', () => {
    for (const tier of ['standard', 'deep'] as const) {
      expect(shouldRepickQuick({ tier, textLength: 5000, attachments: 3, unlevelledSkill: true })).toBe(
        false,
      );
    }
  });
});
