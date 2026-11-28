import { describe, expect, it } from 'vitest';
import {
  addDays,
  certaintyWords,
  dateWords,
  endClock,
  hoursWords,
  londonClock,
  londonIso,
  sourceWords,
} from './words.ts';

describe('hoursWords', () => {
  it('shows minutes as h:mm', () => {
    expect(hoursWords(5)).toBe('0:05');
    expect(hoursWords(75)).toBe('1:15');
    expect(hoursWords(1440)).toBe('24:00');
  });
});

describe('London clock times', () => {
  it('reads winter and summer times', () => {
    expect(londonClock('2026-11-27T09:30:00+00:00')).toBe('09:30');
    expect(londonClock('2026-07-01T08:30:00Z')).toBe('09:30');
    expect(londonClock(null)).toBeNull();
  });

  it('builds an ISO time with the London offset, winter and summer', () => {
    expect(londonIso('2026-11-27', '09:30')).toBe('2026-11-27T09:30:00+00:00');
    expect(londonIso('2026-07-01', '09:30')).toBe('2026-07-01T09:30:00+01:00');
    expect(londonIso('2026-07-01', '25:00')).toBeNull();
    expect(londonIso('2026-07-01', '')).toBeNull();
  });

  it('round-trips through the clock', () => {
    const iso = londonIso('2026-07-01', '23:15');
    expect(londonClock(iso)).toBe('23:15');
  });

  it('finds the end of an entry', () => {
    expect(endClock('2026-11-27T09:30:00+00:00', 45)).toBe('10:15');
    expect(endClock(null, 45)).toBeNull();
  });
});

describe('dates', () => {
  it('moves by days and words a date', () => {
    expect(addDays('2026-11-28', -1)).toBe('2026-11-27');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(dateWords('2026-11-27')).toBe('Friday 27 November 2026');
  });
});

describe('chips', () => {
  it('words the source and certainty', () => {
    expect(sourceWords('cortex-chat', false)).toBe('From chat');
    expect(sourceWords('manual', false)).toBe('Added by you');
    expect(sourceWords('manual', true)).toBe('From Toolbox');
    expect(sourceWords('import-tracket', false)).toBe('From Toolbox');
    expect(certaintyWords('suggested')).toBe('Check');
    expect(certaintyWords('manual')).toBeNull();
  });
});
