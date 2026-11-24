import { describe, expect, it } from 'vitest';
import type { LiveSession, PastSession, TodoItem } from '../../../shared/contract.ts';
import { pinnedChats, pinnedFileIds, pinnedTodos } from './home-pins.ts';

const todo = (key: string) => ({ key, title: key }) as TodoItem;
const live = (id: string, sdk: string | null, state: LiveSession['state']) =>
  ({ id, sdkSessionId: sdk, state, title: id, lastActivityAt: '2026-11-11T10:00:00.000Z' }) as LiveSession;
const past = (sdk: string) =>
  ({ sdkSessionId: sdk, title: sdk, lastModified: '', kind: 'tds' }) as PastSession;

describe('pinnedTodos', () => {
  it('lists starred tasks from mine, then open ones, and no others', () => {
    const got = pinnedTodos([todo('a'), todo('b')], [todo('c'), todo('d')], ['d', 'a']);
    expect(got.map((t) => t.key)).toEqual(['a', 'd']);
  });
  it('is empty when nothing is starred', () => {
    expect(pinnedTodos([todo('a')], [], [])).toEqual([]);
  });
});

describe('pinnedChats', () => {
  it('lists open starred chats first, then earlier ones, and skips chats that are not starred', () => {
    const got = pinnedChats(
      [live('l1', 's1', 'working'), live('l2', 's2', 'working'), live('l3', null, 'working')],
      [past('s3'), past('s4')],
      ['s1', 's3', 's9'],
    );
    expect(got.map((r) => `${r.kind}:${r.chat.sdkSessionId}`)).toEqual(['live:s1', 'past:s3']);
  });
  it('shows a chat that is open and earlier once, as open', () => {
    const got = pinnedChats([live('l1', 's1', 'working')], [past('s1')], ['s1']);
    expect(got.map((r) => r.kind)).toEqual(['live']);
  });
  it('is empty when nothing is starred', () => {
    expect(pinnedChats([live('l1', 's1', 'working')], [past('s2')], [])).toEqual([]);
  });
});

describe('pinnedFileIds', () => {
  it('puts the newest pin first and leaves the saved list alone', () => {
    const saved = ['a', 'b', 'c'];
    expect(pinnedFileIds(saved)).toEqual(['c', 'b', 'a']);
    expect(saved).toEqual(['a', 'b', 'c']);
  });
});
