import { describe, expect, it } from 'vitest';
import type { LiveSession } from '../../../shared/contract.ts';
import { chatForTodo, formatElapsed, initialSince } from './attention.ts';

const chat = (id: string, state: LiveSession['state'], todoId: string | null): LiveSession => ({
  id,
  sdkSessionId: null,
  title: id,
  client: null,
  todoId,
  state,
  startedAt: '',
  lastActivityAt: '',
});

describe('formatElapsed', () => {
  it('counts seconds precisely while working or asking', () => {
    expect(formatElapsed(7_000, 'asking')).toBe('7s');
    expect(formatElapsed(134_000, 'working')).toBe('2m 14s');
    expect(formatElapsed(3_900_000, 'working')).toBe('1h 5m');
  });
  it('is coarser when ready', () => {
    expect(formatElapsed(20_000, 'ready')).toBe('just now');
    expect(formatElapsed(6 * 60_000 + 30_000, 'ready')).toBe('6m');
    expect(formatElapsed(3_900_000, 'ready')).toBe('1h 5m');
  });
});

describe('chatForTodo', () => {
  it('finds the chat that belongs to a to-do, or null', () => {
    const live = [chat('a', 'idle', 't1')];
    expect(chatForTodo('t1', live)?.id).toBe('a');
    expect(chatForTodo('t2', live)).toBeNull();
  });
  it('prefers one needing an answer, then working, then ready', () => {
    const live = [chat('a', 'idle', 't1'), chat('b', 'working', 't1'), chat('c', 'waiting', 't1')];
    expect(chatForTodo('t1', live)?.id).toBe('c');
    expect(chatForTodo('t1', live.slice(0, 2))?.id).toBe('b');
  });
  it('ignores stopped chats', () => {
    expect(chatForTodo('t1', [chat('a', 'closed', 't1')])).toBeNull();
  });
});

describe('initialSince', () => {
  const now = Date.parse('2026-11-11T10:10:00Z');
  it('counts from the last activity when known', () => {
    expect(initialSince('2026-11-11T10:00:00Z', now)).toBe(Date.parse('2026-11-11T10:00:00Z'));
  });
  it('falls back to now when missing, invalid or in the future', () => {
    expect(initialSince(null, now)).toBe(now);
    expect(initialSince('nonsense', now)).toBe(now);
    expect(initialSince('2026-11-11T11:00:00Z', now)).toBe(now);
  });
});
