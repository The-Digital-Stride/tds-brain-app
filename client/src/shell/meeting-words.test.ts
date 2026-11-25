import { describe, expect, it } from 'vitest';
import { dayParts, weekLabel, weekStart } from './meeting-words.ts';

// Wed 25 Nov 2026, mid-morning, local time.
const NOW = new Date(2026, 10, 25, 10, 0).getTime();

describe('weekStart', () => {
  it('is the Monday of the week, Sunday included in the week before', () => {
    expect(weekStart(new Date(2026, 10, 25))).toBe(new Date(2026, 10, 23).getTime());
    expect(weekStart(new Date(2026, 10, 29))).toBe(new Date(2026, 10, 23).getTime());
    expect(weekStart(new Date(2026, 10, 30))).toBe(new Date(2026, 10, 30).getTime());
  });
});

describe('dayParts', () => {
  it('names today and tomorrow with their short date, later days with the full weekday', () => {
    expect(dayParts('2026-11-25', NOW)).toEqual({ name: 'Today', date: 'Wed 25 Nov' });
    expect(dayParts('2026-11-26', NOW)).toEqual({ name: 'Tomorrow', date: 'Thu 26 Nov' });
    expect(dayParts('2026-11-27', NOW)).toEqual({ name: 'Friday', date: '27 Nov' });
    expect(dayParts('2026-12-07', NOW)).toEqual({ name: 'Monday', date: '7 Dec' });
  });
  it('keeps a day that is not a date as it is', () => {
    expect(dayParts('soon', NOW)).toEqual({ name: 'soon', date: '' });
  });
});

describe('weekLabel', () => {
  it('splits by calendar week, Monday on', () => {
    expect(weekLabel('2026-11-25', NOW)).toBe('This week');
    expect(weekLabel('2026-11-29', NOW)).toBe('This week');
    expect(weekLabel('2026-11-30', NOW)).toBe('Next week');
    expect(weekLabel('2026-12-06', NOW)).toBe('Next week');
    expect(weekLabel('2026-12-07', NOW)).toBe('Week of 7 Dec');
  });
  it('on a Sunday, tomorrow is already next week', () => {
    const sunday = new Date(2026, 10, 29, 18, 0).getTime();
    expect(weekLabel('2026-11-30', sunday)).toBe('Next week');
  });
  it('crosses a year end', () => {
    const now = new Date(2026, 11, 30, 9, 0).getTime();
    expect(weekLabel('2027-01-04', now)).toBe('Next week');
    expect(weekLabel('2027-01-11', now)).toBe('Week of 11 Jan');
  });
});
