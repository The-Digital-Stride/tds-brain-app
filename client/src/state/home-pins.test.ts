import { describe, expect, it } from 'vitest';
import type { LiveSession, PastSession, TodoItem } from '../../../shared/contract.ts';
import {
  pinnedChats,
  pinnedFileIds,
  pinnedTodos,
  recentChats,
  recentTodos,
  todoArrival,
} from './home-pins.ts';

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

const rt = (key: string, over: Partial<TodoItem> = {}) =>
  ({
    key,
    title: key,
    scope: 'tds',
    created: null,
    surfaceDate: null,
    handover: null,
    ...over,
  }) as TodoItem;
const TODAY = '2026-11-25';
const ME = 'me';

describe('todoArrival', () => {
  it('uses the created date, as "Added"', () => {
    expect(todoArrival(rt('a', { created: '2026-11-24T09:00:00Z' }), TODAY, ME)).toEqual({
      date: '2026-11-24',
      word: 'Added',
    });
  });
  it('uses the handover as "Passed to you" when it came after the task was made', () => {
    const t = rt('a', {
      created: '2026-11-20',
      assignee: ME,
      handover: {
        by: 'x',
        byName: 'X',
        at: '2026-11-24T10:00:00+00:00',
        from: null,
        via: null,
        source: 'stamp',
      },
    });
    expect(todoArrival(t, TODAY, ME)).toEqual({ date: '2026-11-24T10:00:00+00:00', word: 'Passed to you' });
  });
  it('keeps "Added" when the handover is on the day the task was made', () => {
    const t = rt('a', {
      created: '2026-11-24',
      assignee: ME,
      handover: {
        by: 'x',
        byName: 'X',
        at: '2026-11-24T10:00:00+00:00',
        from: null,
        via: null,
        source: 'stamp',
      },
    });
    expect(todoArrival(t, TODAY, ME)?.word).toBe('Added');
  });
  it('says "Added" for a task opened to anyone, whatever its handover stamp', () => {
    const t = rt('a', {
      created: '2026-11-20',
      assignee: null,
      handover: { by: 'x', byName: 'X', at: '2026-11-24T10:00:00Z', from: null, via: null, source: 'stamp' },
    });
    expect(todoArrival(t, TODAY, ME)).toEqual({ date: '2026-11-20', word: 'Added' });
  });
  it('says "Added" for a task the person took themselves', () => {
    const t = rt('a', {
      created: '2026-11-20',
      assignee: ME,
      handover: { by: ME, byName: 'Me', at: '2026-11-24T10:00:00Z', from: null, via: null, source: 'stamp' },
    });
    expect(todoArrival(t, TODAY, ME)).toEqual({ date: '2026-11-20', word: 'Added' });
  });
  it('falls back to a surface date that is not in the future, and ignores one that is', () => {
    expect(todoArrival(rt('a', { surfaceDate: '2026-11-22' }), TODAY, ME)).toEqual({
      date: '2026-11-22',
      word: 'Added',
    });
    expect(todoArrival(rt('a', { surfaceDate: '2026-12-01' }), TODAY, ME)).toBeNull();
  });
  it('ignores a created value that is not a date', () => {
    expect(todoArrival(rt('a', { created: 'yesterday' }), TODAY, ME)).toBeNull();
  });
});

describe('recentTodos', () => {
  it('lists the newest first, undated last, ties by title', () => {
    const got = recentTodos(
      [
        rt('old', { created: '2026-11-01' }),
        rt('none'),
        rt('b', { created: '2026-11-24' }),
        rt('a', { created: '2026-11-24' }),
      ],
      [rt('future', { surfaceDate: '2026-12-31' }), rt('new', { created: '2026-11-25' })],
      TODAY,
      ME,
    );
    expect(got.map((t) => t.key)).toEqual(['new', 'a', 'b', 'old', 'future', 'none']);
  });
  it('puts a task passed on later above one made later than it was made', () => {
    const passed = rt('passed', {
      created: '2026-11-01',
      assignee: ME,
      handover: {
        by: 'x',
        byName: 'X',
        at: '2026-11-24T10:00:00Z',
        from: null,
        via: null,
        source: 'stamp',
      },
    });
    const got = recentTodos([rt('made', { created: '2026-11-23' }), passed], [], TODAY, ME);
    expect(got.map((t) => t.key)).toEqual(['passed', 'made']);
  });
  it('leaves personal tasks out and lists a task in both lists once', () => {
    const got = recentTodos(
      [rt('a', { created: '2026-11-24' }), rt('p', { scope: 'personal', created: '2026-11-25' })],
      [rt('a', { created: '2026-11-24' })],
      TODAY,
      ME,
    );
    expect(got.map((t) => t.key)).toEqual(['a']);
  });
});

describe('recentChats', () => {
  const liveAt = (id: string, sdk: string | null, at: string) =>
    ({ ...live(id, sdk, 'working'), lastActivityAt: at }) as LiveSession;
  const pastAt = (sdk: string, at: string) => ({ ...past(sdk), lastModified: at }) as PastSession;
  it('mixes open and earlier chats, newest activity first', () => {
    const got = recentChats(
      [liveAt('l1', 's1', '2026-11-25T09:00:00Z'), liveAt('l2', null, '2026-11-25T11:00:00Z')],
      [pastAt('s3', '2026-11-25T10:00:00Z'), pastAt('s4', '2026-11-20T10:00:00Z')],
    );
    expect(got.map((r) => (r.kind === 'live' ? r.chat.id : r.chat.sdkSessionId))).toEqual([
      'l2',
      's3',
      'l1',
      's4',
    ]);
  });
  it('shows a chat open and earlier once, as open', () => {
    const got = recentChats(
      [liveAt('l1', 's1', '2026-11-25T09:00:00Z')],
      [pastAt('s1', '2026-11-25T12:00:00Z')],
    );
    expect(got.map((r) => r.kind)).toEqual(['live']);
  });
});
