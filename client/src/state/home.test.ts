import { describe, expect, it } from 'vitest';
import { greeting, summary } from './home.ts';

describe('greeting', () => {
  const at = (h: number, m: number) => new Date(2026, 10, 11, h, m);
  it('changes at 12:00 and 18:00', () => {
    expect(greeting(at(11, 59), 'Sam Example')).toBe('Good morning, Sam');
    expect(greeting(at(12, 0), 'Sam Example')).toBe('Good afternoon, Sam');
    expect(greeting(at(17, 59), 'Sam Example')).toBe('Good afternoon, Sam');
    expect(greeting(at(18, 0), 'Sam Example')).toBe('Good evening, Sam');
  });
  it('uses the first name only, and copes with an empty name', () => {
    expect(greeting(at(9, 0), '  Ian   Hancock ')).toBe('Good morning, Ian');
    expect(greeting(at(9, 0), '')).toBe('Good morning');
  });
});

describe('summary', () => {
  const s = (overdue: number, dueToday: number, asking: number) => summary({ overdue, dueToday, asking });
  it('says nothing is waiting when all are zero', () => {
    expect(s(0, 0, 0)).toBe('Nothing is waiting for you.');
  });
  it('reads singular and plural naturally', () => {
    expect(s(1, 0, 0)).toBe('One task is overdue.');
    expect(s(3, 0, 0)).toBe('3 tasks are overdue.');
    expect(s(0, 1, 0)).toBe('One task is due today.');
    expect(s(0, 2, 0)).toBe('2 tasks are due today.');
    expect(s(0, 0, 1)).toBe('One chat is waiting for you.');
    expect(s(0, 0, 3)).toBe('3 chats are waiting for you.');
  });
  it('joins two and three parts', () => {
    expect(s(1, 0, 1)).toBe('One task is overdue and one chat is waiting for you.');
    expect(s(3, 2, 0)).toBe('3 tasks are overdue and 2 are due today.');
    expect(s(1, 1, 0)).toBe('One task is overdue and one is due today.');
    expect(s(3, 2, 1)).toBe('3 tasks are overdue, 2 are due today and one chat is waiting for you.');
  });
});
