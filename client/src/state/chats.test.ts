import { describe, expect, it } from 'vitest';
import type { LiveSession } from '../../../shared/contract.ts';
import { mostUrgent, sortChats } from './chats.ts';

const chat = (id: string, state: LiveSession['state'], lastActivityAt: string): LiveSession => ({
  id,
  sdkSessionId: null,
  title: id,
  client: null,
  todoId: null,
  state,
  startedAt: '2026-11-11T09:00:00.000Z',
  lastActivityAt,
});

describe('sortChats', () => {
  it('puts needs-an-answer first, then working, then ready, then stopped; newest first within each', () => {
    const live = [
      chat('ready-old', 'idle', '2026-11-11T09:00:00.000Z'),
      chat('working-old', 'working', '2026-11-11T09:10:00.000Z'),
      chat('ended', 'closed', '2026-11-11T11:00:00.000Z'),
      chat('asking-old', 'waiting', '2026-11-11T09:05:00.000Z'),
      chat('ready-new', 'idle', '2026-11-11T10:00:00.000Z'),
      chat('starting', 'starting', '2026-11-11T10:30:00.000Z'),
      chat('asking-new', 'waiting', '2026-11-11T10:05:00.000Z'),
      chat('problem', 'error', '2026-11-11T10:45:00.000Z'),
    ];
    expect(sortChats(live).map((c) => c.id)).toEqual([
      'asking-new',
      'asking-old',
      'starting',
      'working-old',
      'ready-new',
      'ready-old',
      'ended',
      'problem',
    ]);
  });

  it('does not change the list it was given', () => {
    const live = [
      chat('a', 'idle', '2026-11-11T09:00:00.000Z'),
      chat('b', 'waiting', '2026-11-11T09:00:00.000Z'),
    ];
    sortChats(live);
    expect(live.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('keeps the given order when times are equal or unreadable', () => {
    const live = [chat('x', 'idle', 'not a date'), chat('y', 'idle', 'not a date')];
    expect(sortChats(live).map((c) => c.id)).toEqual(['x', 'y']);
  });
});

describe('mostUrgent', () => {
  it('is the attention of the most urgent open chat, or null', () => {
    expect(mostUrgent([])).toBeNull();
    expect(mostUrgent([chat('a', 'closed', '')])).toBeNull();
    expect(mostUrgent([chat('a', 'idle', ''), chat('b', 'working', '')])).toBe('working');
    expect(mostUrgent([chat('a', 'working', ''), chat('b', 'waiting', '')])).toBe('asking');
  });
});
