import { describe, expect, it } from 'vitest';
import { dueInWords, EFFORT_OPTION_WORDS, engineLine, modelName } from './format.ts';

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
