import { describe, expect, it } from 'vitest';
import { dueInWords } from './format.ts';

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
