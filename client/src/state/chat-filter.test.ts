import { describe, expect, it } from 'vitest';
import type { ChatKind } from '../../../shared/contract.ts';
import { filterChats } from './chat-filter.ts';

const chat = (id: string, kind?: ChatKind) => ({ id, ...(kind ? { kind } : {}) });

describe('filterChats', () => {
  const list = [chat('a', 'tds'), chat('b', 'personal'), chat('c')];

  it('returns the list itself for all', () => {
    expect(filterChats(list, 'all')).toBe(list);
  });

  it('keeps only personal chats', () => {
    expect(filterChats(list, 'personal').map((c) => c.id)).toEqual(['b']);
  });

  it('counts a missing kind as TDS', () => {
    expect(filterChats(list, 'tds').map((c) => c.id)).toEqual(['a', 'c']);
  });
});
