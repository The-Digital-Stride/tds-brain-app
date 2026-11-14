import { describe, expect, it } from 'vitest';
import { importJson, parseArgs, parseSuggestion, promptFor, reviewTable } from './suggest-skill-levels.ts';

describe('suggest-skill-levels', () => {
  it('parses the brain folder and the optional outputs', () => {
    const a = parseArgs(['/tmp/brain', '--out', '/tmp/x.json', '--review', '/tmp/x.md']);
    expect(a).toEqual({ brain: '/tmp/brain', out: '/tmp/x.json', review: '/tmp/x.md' });
    const d = parseArgs(['/tmp/brain']);
    expect(d.out.endsWith('/data/skill-level-suggestions.json')).toBe(true);
    expect(d.review.endsWith('/data/skill-level-suggestions.md')).toBe(true);
  });

  it('refuses bad arguments and any output inside the brain', () => {
    expect(() => parseArgs([])).toThrow(/Usage/);
    expect(() => parseArgs(['a', 'b'])).toThrow();
    expect(() => parseArgs(['/b', '--out'])).toThrow();
    expect(() => parseArgs(['/b', '--nope'])).toThrow();
    expect(() => parseArgs(['/b', '--out', '/b/x.json'])).toThrow(/outside the brain/);
    expect(() => parseArgs(['/b', '--review', '/b/sub/x.md'])).toThrow(/outside the brain/);
    expect(() => parseArgs(['/b', '--out', '/b/../elsewhere/x.json'])).not.toThrow();
  });

  it('reads a suggestion from a reply, tolerating a fence, and rejects the rest', () => {
    expect(parseSuggestion('```json\n{"tier":"Deep","reason":"Audits  need care"}\n```')).toEqual({
      tier: 'deep',
      reason: 'Audits need care',
    });
    expect(parseSuggestion('{"tier":"huge","reason":"x"}')).toBeNull();
    expect(parseSuggestion('{"tier":"quick"}')).toBeNull();
    expect(parseSuggestion('nothing')).toBeNull();
    expect(parseSuggestion('{ nope }')).toBeNull();
    expect(parseSuggestion(`{"tier":"quick","reason":"${'x'.repeat(300)}"}`)?.reason).toHaveLength(160);
  });

  it('wraps only the first 60 lines of a skill as data', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const p = promptFor('x', text);
    expect(p.startsWith('<skill name="x">')).toBe(true);
    expect(p).toContain('line 59');
    expect(p).not.toContain('line 60');
  });

  it('writes the import shape and a sorted review table', () => {
    const rows = [
      { name: 'b', tier: 'deep' as const, reason: 'Careful | work' },
      { name: 'a', tier: 'quick' as const, reason: 'Look-up', failed: true },
    ];
    expect(JSON.parse(importJson(rows))).toEqual({
      levels: { a: { tier: 'quick', note: 'Look-up' }, b: { tier: 'deep', note: 'Careful | work' } },
    });
    const md = reviewTable(rows);
    expect(md.indexOf('| a |')).toBeLessThan(md.indexOf('| b |'));
    expect(md).toContain('| b | Deep | Careful / work |');
    expect(md).toContain('(default)');
  });
});
