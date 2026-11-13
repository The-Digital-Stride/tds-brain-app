import { describe, expect, it } from 'vitest';
import type { PastSession } from '../../../shared/contract.ts';
import { groupChatsByDay } from './chat-groups.ts';

const NOW = new Date(2026, 10, 13, 15, 0);
const chat = (id: string, when: Date | string): PastSession => ({
  sdkSessionId: id,
  title: id,
  lastModified: typeof when === 'string' ? when : when.toISOString(),
});
const day = (back: number, hour = 9) => new Date(2026, 10, 13 - back, hour, 0);
const shape = (past: PastSession[]) =>
  groupChatsByDay(past, NOW).map((g) => [g.key, g.items.map((i) => i.sdkSessionId)]);

describe('groupChatsByDay', () => {
  it('splits by calendar day into today, this week and earlier, keeping the order', () => {
    expect(
      shape([
        chat('a', day(0)),
        chat('b', day(0, 1)),
        chat('c', day(1)),
        chat('d', day(6)),
        chat('e', day(7)),
      ]),
    ).toEqual([
      ['today', ['a', 'b']],
      ['week', ['c', 'd']],
      ['earlier', ['e']],
    ]);
  });
  it('leaves out empty groups', () => {
    expect(shape([chat('e', day(30))])).toEqual([['earlier', ['e']]]);
    expect(shape([])).toEqual([]);
  });
  it('puts an unreadable or future date sensibly', () => {
    expect(shape([chat('x', 'nonsense')])).toEqual([['earlier', ['x']]]);
    expect(shape([chat('f', day(-1))])).toEqual([['today', ['f']]]);
  });
  it('titles the groups', () => {
    expect(
      groupChatsByDay([chat('a', day(0)), chat('c', day(2)), chat('e', day(20))], NOW).map((g) => g.title),
    ).toEqual(['Today', 'This week', 'Earlier']);
  });
});
