import { describe, expect, it } from 'vitest';
import { day, entry } from './testing.ts';
import {
  addDays,
  certaintyWords,
  chatTitleWords,
  dateWords,
  dayTitle,
  durationWords,
  emptyDayWords,
  endClock,
  hoursWords,
  londonClock,
  londonIso,
  nextNeedingAttention,
  openChatLabel,
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

describe('spoken words', () => {
  it('says durations in words', () => {
    expect(durationWords(75)).toBe('1 hour 15 minutes');
    expect(durationWords(60)).toBe('1 hour');
    expect(durationWords(45)).toBe('45 minutes');
    expect(durationWords(1)).toBe('1 minute');
    expect(durationWords(0)).toBe('0 minutes');
  });

  it('titles today and drops this year', () => {
    expect(dayTitle('2026-11-28', '2026-11-28')).toBe('Today, Saturday 28 November');
    expect(dayTitle('2026-11-27', '2026-11-28')).toBe('Friday 27 November');
    expect(dayTitle('2025-12-31', '2026-11-28')).toBe('Wednesday 31 December 2025');
  });

  it('mentions Refresh only on a day that has it', () => {
    expect(emptyDayWords(false)).toMatch(/refresh/i);
    expect(emptyDayWords(true)).not.toMatch(/refresh/i);
  });

  it('finds the next entry needing attention, wrapping round, never the one just saved', () => {
    const a = entry({ id: 'a', values: { ...entry().values, startAt: '2026-11-27T09:00:00+00:00' } });
    const b = entry({
      id: 'b',
      values: { ...entry().values, startAt: '2026-11-27T10:00:00+00:00', description: '' },
    });
    const c = entry({
      id: 'c',
      values: { ...entry().values, startAt: '2026-11-27T11:00:00+00:00', workItemId: null },
    });
    const d = day({ entries: [c, a, b] });
    expect(nextNeedingAttention(d, 'a')).toBe('b');
    expect(nextNeedingAttention(d, 'b')).toBe('c');
    expect(nextNeedingAttention(d, 'c')).toBe('b');
    expect(nextNeedingAttention(day({ entries: [a] }), 'a')).toBeNull();
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

describe('chat title words (decisions 32 and A)', () => {
  it('names the chat when it has a title, and says where it came from when not', () => {
    expect(openChatLabel('Homepage audit')).toBe('Open chat: Homepage audit');
    expect(openChatLabel(null)).toBe('Open the chat this came from');
    expect(chatTitleWords('Homepage audit')).toBe('Chat title: Homepage audit');
  });
});
