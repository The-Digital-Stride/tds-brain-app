import { describe, expect, it } from 'vitest';
import type { LiveHelper } from '../../shared/contract.ts';
import {
  dueInWords,
  EFFORT_OPTION_WORDS,
  elapsedWords,
  engineLine,
  helperMeta,
  keptLineText,
  levelLineText,
  modelName,
  tokenWords,
} from './format.ts';

describe('dueInWords', () => {
  const today = '2026-11-11'; // a Wednesday
  it('speaks plainly', () => {
    expect(dueInWords('2026-11-08', today)).toBe('overdue by 3 days');
    expect(dueInWords('2026-11-10', today)).toBe('overdue by 1 day');
    expect(dueInWords('2026-11-11', today)).toBe('due today');
    expect(dueInWords('2026-11-12', today)).toBe('due tomorrow');
    expect(dueInWords('2026-11-13', today)).toBe('due Friday');
    expect(dueInWords('2026-11-25', today)).toBe('due 25 Nov');
  });
});

describe('engineLine', () => {
  it('names the model and effort the way people say them', () => {
    expect(engineLine('claude-opus-5-5', 'high')).toBe('Opus 5.5 · High effort');
    expect(engineLine('claude-sonnet-4-5-20250929', 'xhigh')).toBe('Sonnet 4.5 · Extra-high effort');
    expect(engineLine('claude-fable-5-2', 'max')).toBe('Fable 5.2 · Max effort');
    expect(engineLine('claude-haiku-5', 'low')).toBe('Haiku 5 · Low effort');
    expect(engineLine('claude-opus-4-8[1m]', 'medium')).toBe('Opus 4.8 (1M context) · Medium effort');
    expect(engineLine('us.anthropic.claude-opus-5-5-v1:0', null)).toBe('Opus 5.5');
  });

  it('shows an unknown model as it is, and nothing when nothing is known', () => {
    expect(engineLine('some-custom-model', 'high')).toBe('some-custom-model · High effort');
    expect(engineLine(null, 'low')).toBe('Low effort');
    expect(engineLine(null, null)).toBeNull();
    expect(engineLine('  ', null)).toBeNull();
  });
});

describe('modelName and EFFORT_OPTION_WORDS', () => {
  it('names a model, and leaves an unknown one as it is', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelName('opus')).toBe('opus');
  });
  it('has a plain word for each effort', () => {
    expect(EFFORT_OPTION_WORDS.xhigh).toBe('Extra high');
    expect(Object.values(EFFORT_OPTION_WORDS)).toEqual(['Low', 'Medium', 'High', 'Extra high', 'Max']);
  });
});

describe('levelLineText', () => {
  it('says a pick was made for this chat, with the model and effort for Why?', () => {
    expect(
      levelLineText({ tier: 'standard', source: { kind: 'auto', reason: 'A short writing job' } }),
    ).toEqual({
      tier: 'Standard',
      note: 'picked by the app for this chat',
      why: 'A short writing job',
      engine: 'Sonnet · Medium effort',
    });
  });
  it('names the skill for a team level', () => {
    const t = levelLineText({ tier: 'deep', source: { kind: 'team', skill: 'google-ads-audit' } });
    expect(t?.tier).toBe('Deep');
    expect(t?.note).toBe('for /google-ads-audit · team level');
    expect(t?.engine).toBe('Opus · High effort');
  });
  it('says it was your choice after the chat menu', () => {
    expect(levelLineText({ tier: 'quick', source: { kind: 'chat' } })?.note).toBe(
      'your choice for this chat',
    );
    expect(levelLineText({ tier: 'quick', source: { kind: 'chat' } })?.engine).toBe('Haiku · Medium effort');
  });
  it('falls back to the plain pick wording', () => {
    const t = levelLineText({ tier: 'standard', source: { kind: 'fallback' } });
    expect(t?.tier).toBe('Standard');
    expect(t?.note).toBe("the app's usual level");
  });
  it('reads "Set by /name" for a skill with its own setting, and nothing for manual', () => {
    const t = levelLineText({ tier: null, source: { kind: 'skill-own', skill: 'deep-dive' } });
    expect(t).toMatchObject({ tier: null, note: 'Set by /deep-dive', engine: null });
    expect(levelLineText({ tier: null, source: { kind: 'manual' } })).toBeNull();
  });
});

describe('elapsedWords', () => {
  it('says seconds, minutes and hours plainly', () => {
    expect(elapsedWords(0)).toBe('0 s');
    expect(elapsedWords(900)).toBe('0 s');
    expect(elapsedWords(40_000)).toBe('40 s');
    expect(elapsedWords(60_000)).toBe('1 min');
    expect(elapsedWords(80_000)).toBe('1 min 20 s');
    expect(elapsedWords(3_780_000)).toBe('1 h 3 min');
    expect(elapsedWords(3_600_000)).toBe('1 h');
    expect(elapsedWords(-5)).toBe('0 s');
  });
});

describe('helperMeta', () => {
  const base: LiveHelper = {
    id: 'a',
    name: 'Scout',
    brief: '',
    tier: 'quick',
    model: 'haiku',
    status: 'working',
    startedAt: '2026-11-14T10:00:00.000Z',
    endedAt: null,
    steps: 3,
    lastStep: 'Reading files',
  };
  const now = Date.parse('2026-11-14T10:01:20.000Z');
  // The time is joined with non-breaking spaces; compare with plain ones.
  const meta = (h: LiveHelper) => helperMeta(h, now).replace(/\u00a0/g, ' ');
  it('keeps the time on one line', () => {
    expect(helperMeta(base, now)).toMatch(/1\u00a0min\u00a020\u00a0s$/);
  });
  it('says what it is doing, level, model and time while working', () => {
    expect(meta(base)).toBe('Reading files · Quick · Haiku · 1 min 20 s');
  });
  it('names a model id the way people say it', () => {
    expect(meta({ ...base, model: 'claude-haiku-5-5' })).toBe(
      'Reading files · Quick · Haiku 5.5 · 1 min 20 s',
    );
  });
  it('leaves out what is unknown, but always says it is working', () => {
    expect(meta({ ...base, lastStep: null, tier: null, model: null })).toBe('Working · 1 min 20 s');
  });
  it('says how it ended, with the time it took', () => {
    const ended = { endedAt: '2026-11-14T10:02:05.000Z' };
    expect(meta({ ...base, ...ended, status: 'done' })).toBe('Done · Quick · Haiku · 2 min 5 s');
    expect(helperMeta({ ...base, ...ended, status: 'failed' }, now)).toMatch(/^Failed · /);
    expect(helperMeta({ ...base, ...ended, status: 'stopped' }, now)).toMatch(/^Stopped · /);
  });
});

describe('keptLineText and tokenWords', () => {
  it('says once that the chat stays on its level', () => {
    expect(
      keptLineText({ tier: 'deep', kept: { wanted: 'quick' }, source: { kind: 'auto', reason: 'x' } }),
    ).toBe('Staying on Deep for now: it costs less than switching down and re-reading the whole chat.');
    expect(keptLineText({ tier: 'deep', source: { kind: 'auto', reason: 'x' } })).toBeNull();
  });
  it('shortens token counts', () => {
    expect([950, 9300, 150_000, 1_200_000].map(tokenWords)).toEqual(['950', '9.3k', '150k', '1.2M']);
  });
  it('rounds up to millions near a million, never "1000k"', () => {
    expect([999_950, 999_999, 967_000].map(tokenWords)).toEqual(['1M', '1M', '967k']);
  });
});
