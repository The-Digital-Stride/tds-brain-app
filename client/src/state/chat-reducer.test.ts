import { describe, expect, it } from 'vitest';
import type { ChatEvent, SequencedEvent } from '../../../shared/contract.ts';
import { type ChatState, chatReducer, initialChatState, pendingCard } from './chat-reducer.ts';

function seq(n: number, event: ChatEvent): SequencedEvent {
  return { seq: n, at: '2026-11-11T10:00:00.000Z', event };
}

function apply(events: SequencedEvent[], from: ChatState = initialChatState): ChatState {
  return events.reduce((s, item) => chatReducer(s, { type: 'event', item }), from);
}

describe('chatReducer', () => {
  it('keeps a helper’s report as its own item, in order', () => {
    const s = apply([
      seq(1, { type: 'helper-report', messageId: 'r1', name: 'Audit memory', text: '## Found' }),
      seq(2, { type: 'helper-report', messageId: 'r2', name: null, text: 'More.' }),
    ]);
    expect(s.items).toEqual([
      { kind: 'report', id: 'r1', name: 'Audit memory', text: '## Found' },
      { kind: 'report', id: 'r2', name: null, text: 'More.' },
    ]);
  });

  it('builds one assistant block from deltas, then replaces it with the finished text', () => {
    const s = apply([
      seq(1, { type: 'assistant-delta', messageId: 'm1', text: 'Hel', parentToolUseId: null }),
      seq(2, { type: 'assistant-delta', messageId: 'm1', text: 'lo wor', parentToolUseId: null }),
      seq(3, { type: 'assistant-message', messageId: 'm1', text: 'Hello world.', parentToolUseId: null }),
    ]);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: 'assistant', id: 'm1', text: 'Hello world.', done: true });
  });

  it('shows the deltas as they arrive, before the finished message', () => {
    const s = apply([
      seq(1, { type: 'assistant-delta', messageId: 'm1', text: 'Hel', parentToolUseId: null }),
      seq(2, { type: 'assistant-delta', messageId: 'm1', text: 'lo', parentToolUseId: null }),
    ]);
    expect(s.items[0]).toMatchObject({ text: 'Hello', done: false });
  });

  it('changes nothing when already-seen events are replayed', () => {
    const events = [
      seq(1, { type: 'user-message', messageId: 'u1', text: 'Hi' }),
      seq(2, { type: 'assistant-delta', messageId: 'm1', text: 'Hey', parentToolUseId: null }),
    ];
    const once = apply(events);
    const twice = apply(events, once);
    expect(twice).toBe(once);
    expect(twice.items).toHaveLength(2);
    expect(twice.lastSeq).toBe(2);
  });

  it('nests a helper agent under the tool that started it, never as a reply', () => {
    const s = apply([
      seq(1, {
        type: 'tool-start',
        toolUseId: 't1',
        tool: 'Task',
        label: 'Researching',
        parentToolUseId: null,
      }),
      seq(2, { type: 'assistant-message', messageId: 'h1', text: 'Helper notes', parentToolUseId: 't1' }),
      seq(3, {
        type: 'tool-start',
        toolUseId: 't2',
        tool: 'Read',
        label: 'Reading a file',
        parentToolUseId: 't1',
      }),
      seq(4, { type: 'tool-end', toolUseId: 't2', ok: true }),
    ]);
    expect(s.items).toHaveLength(1);
    const tool = s.items[0];
    expect(tool?.kind).toBe('tool');
    if (tool?.kind !== 'tool') return;
    expect(tool.children).toHaveLength(2);
    expect(tool.children[0]).toMatchObject({ kind: 'assistant', text: 'Helper notes' });
    expect(tool.children[1]).toMatchObject({ kind: 'tool', id: 't2', status: 'ok' });
  });

  it('marks a tool as ok or failed when it ends', () => {
    const s = apply([
      seq(1, { type: 'tool-start', toolUseId: 't1', tool: 'Bash', label: 'Running', parentToolUseId: null }),
      seq(2, { type: 'tool-end', toolUseId: 't1', ok: false }),
    ]);
    expect(s.items[0]).toMatchObject({ kind: 'tool', status: 'failed' });
  });

  it('shows a permission card until request-resolved, then keeps a record of the outcome', () => {
    const asked = apply([
      seq(1, {
        type: 'permission-request',
        requestId: 'r1',
        tool: 'Write',
        title: 'Claude wants to save a file',
        detail: 'clients/x/notes.md',
        warning: 'Not all of it is shown.',
        sessionAllowLabel: null,
      }),
    ]);
    expect(pendingCard(asked)).toMatchObject({
      kind: 'permission',
      requestId: 'r1',
      warning: 'Not all of it is shown.',
      // An older server sends no change: the card simply has none.
      change: null,
    });
    const done = apply([seq(2, { type: 'request-resolved', requestId: 'r1', outcome: 'allowed' })], asked);
    expect(pendingCard(done)).toBeNull();
    expect(done.items[0]).toMatchObject({ kind: 'permission', outcome: 'allowed' });
  });

  it('keeps the change a file tool will make on its permission card', () => {
    const change = {
      kind: 'edit' as const,
      parts: [{ everyMatch: false, lines: [{ kind: 'removed' as const, text: 'a' }] }],
    };
    const asked = apply([
      seq(1, {
        type: 'permission-request',
        requestId: 'r1',
        tool: 'Edit',
        title: 'Claude wants to change a file',
        detail: 'clients/x/notes.md',
        warning: null,
        sessionAllowLabel: null,
        change,
      }),
    ]);
    expect(pendingCard(asked)).toMatchObject({ kind: 'permission', change });
  });

  it('handles a question card the same way', () => {
    const asked = apply([
      seq(1, { type: 'question-request', requestId: 'q1', questions: [] }),
      seq(2, { type: 'request-resolved', requestId: 'q1', outcome: 'cancelled' }),
    ]);
    expect(pendingCard(asked)).toBeNull();
    expect(asked.items[0]).toMatchObject({ kind: 'question', outcome: 'cancelled' });
  });

  it('records an interrupted turn end and tracks the session state', () => {
    const s = apply([
      seq(1, { type: 'state', state: 'working' }),
      seq(2, { type: 'turn-end', ok: false, interrupted: true, durationMs: 1200, errorText: null }),
      seq(3, { type: 'state', state: 'idle' }),
    ]);
    expect(s.sessionState).toBe('idle');
    expect(s.items.at(-1)).toMatchObject({ kind: 'turn-end', interrupted: true, ok: false });
  });

  it('keeps notices and the engine session id', () => {
    const s = apply([
      seq(1, { type: 'session-info', sdkSessionId: 'abc', model: null, claudeVersion: null }),
      seq(2, { type: 'notice', level: 'warning', text: 'Careful' }),
    ]);
    expect(s.sdkSessionId).toBe('abc');
    expect(s.items[0]).toMatchObject({ kind: 'notice', level: 'warning', text: 'Careful' });
  });

  it('keeps the model and effort, the newest report winning', () => {
    expect(apply([]).model).toBeNull();
    expect(apply([]).effort).toBeNull();
    const s = apply([
      seq(1, { type: 'session-info', sdkSessionId: 'abc', model: 'claude-opus-5-5', claudeVersion: null }),
    ]);
    expect([s.model, s.effort]).toEqual(['claude-opus-5-5', null]);
    const t = apply([
      seq(1, { type: 'session-info', sdkSessionId: 'abc', model: 'claude-opus-5-5', claudeVersion: null }),
      seq(2, { type: 'engine-settings', model: 'claude-opus-5-5', effort: 'high' }),
      seq(3, { type: 'session-info', sdkSessionId: 'abc', model: null, claudeVersion: null }),
      seq(4, { type: 'engine-settings', model: 'claude-sonnet-5-5', effort: 'low' }),
    ]);
    expect([t.model, t.effort]).toEqual(['claude-sonnet-5-5', 'low']);
    expect(t.items).toEqual([]);
  });

  it('keeps the known model when a later report has none', () => {
    const info = (n: number, model: string | null) =>
      seq(n, { type: 'session-info', sdkSessionId: 'abc', model, claudeVersion: null });
    const s = apply([info(1, 'claude-opus-5-5'), info(2, null)]);
    expect(s.model).toBe('claude-opus-5-5');
    const t = apply([
      info(1, 'claude-opus-5-5'),
      seq(2, { type: 'engine-settings', model: null, effort: 'high' }),
    ]);
    expect([t.model, t.effort]).toEqual(['claude-opus-5-5', 'high']);
  });

  describe('stateSince', () => {
    const at = (n: number, event: ChatEvent): SequencedEvent => ({
      seq: n,
      at: new Date(Date.UTC(2026, 10, 11, 10, 0, n)).toISOString(),
      event,
    });
    const t = (n: number) => Date.UTC(2026, 10, 11, 10, 0, n);

    it('takes the time of the latest change of attention, whatever the clock says', () => {
      const s = apply([
        at(1, { type: 'state', state: 'working' }),
        at(2, { type: 'state', state: 'waiting' }),
      ]);
      expect(s.stateSince).toBe(t(2));
    });
    it('keeps the first time when the same attention repeats', () => {
      const s = apply([
        at(1, { type: 'state', state: 'working' }),
        at(2, { type: 'state', state: 'working' }),
      ]);
      expect(s.stateSince).toBe(t(1));
    });
    it('treats starting then working as one stretch', () => {
      const s = apply([
        at(1, { type: 'state', state: 'starting' }),
        at(2, { type: 'state', state: 'working' }),
      ]);
      expect(s.stateSince).toBe(t(1));
    });
    it('is null until a state event has been seen', () => {
      expect(apply([at(1, { type: 'notice', level: 'info', text: 'x' })]).stateSince).toBeNull();
    });
  });

  it('keeps attachments on a user message, live or replayed', () => {
    const attachments = [{ name: 'report.pdf', size: 2048, kind: 'document' as const }];
    const s = apply([seq(1, { type: 'user-message', messageId: 'u1', text: 'See this', attachments })]);
    expect(s.items[0]).toMatchObject({ kind: 'user', text: 'See this', attachments });
    const plain = apply([seq(1, { type: 'user-message', messageId: 'u2', text: 'Hi' })]);
    expect(plain.items[0]).not.toHaveProperty('attachments');
  });

  it('replaces the files snapshot when a files event arrives', () => {
    const link = { url: 'https://example.com/' };
    const s = apply([seq(1, { type: 'files', files: [], attachments: [], links: [link] } as ChatEvent)]);
    expect(s.files.links).toHaveLength(1);
    const again = apply([seq(2, { type: 'files', files: [], attachments: [], links: [] })], s);
    expect(again.files).toEqual({ files: [], attachments: [], links: [] });
  });

  it("keeps the snapshot's pages, and leaves them out when an older server sends none", () => {
    const pg = {
      key: 'k',
      title: 'Page',
      url: null,
      versions: [],
      draft: true,
      fileKey: null,
      live: false,
      multiFile: false,
      toolUseIds: ['t1'],
      order: 1,
    };
    const s = apply([seq(1, { type: 'files', files: [], attachments: [], links: [], pages: [pg] })]);
    expect(s.files.pages).toEqual([pg]);
    const older = apply([seq(2, { type: 'files', files: [], attachments: [], links: [] })], s);
    expect(older.files).not.toHaveProperty('pages');
  });

  it('starts with an empty files snapshot', () => {
    expect(initialChatState.files).toEqual({ files: [], attachments: [], links: [] });
  });

  it('keeps the chat as it is for an unknown event, only moving lastSeq', () => {
    const before = apply([seq(1, { type: 'user-message', messageId: 'u', text: 'Hi' })]);
    const after = apply([seq(2, { type: 'from-the-future' } as unknown as ChatEvent)], before);
    expect(after).toEqual({ ...before, lastSeq: 2 });
  });
});

describe('level events', () => {
  const std = { tier: 'standard' as const, source: { kind: 'auto' as const, reason: 'Short job' } };
  it('starts with no level, so an older server keeps the v0.19.0 line', () => {
    expect(initialChatState.level).toBeNull();
    expect(initialChatState.unlevelledSkill).toBeNull();
  });
  it('keeps the newest level only', () => {
    const s = apply([
      seq(1, { type: 'level', level: std }),
      seq(2, { type: 'level', level: { tier: 'deep', source: { kind: 'chat' } } }),
    ]);
    expect(s.level).toEqual({ tier: 'deep', source: { kind: 'chat' } });
  });
  it('keeps the latest offer until it is cleared', () => {
    let s = apply([seq(1, { type: 'level', level: std, unlevelledSkill: 'x-skill' })]);
    expect(s.unlevelledSkill).toBe('x-skill');
    s = apply([seq(2, { type: 'level', level: std })], s);
    expect(s.unlevelledSkill).toBe('x-skill');
    s = apply([seq(3, { type: 'level', level: std, unlevelledSkill: 'y-skill' })], s);
    expect(s.unlevelledSkill).toBe('y-skill');
    s = chatReducer(s, { type: 'clear-offer' });
    expect(s.unlevelledSkill).toBeNull();
  });
  it('applies the chat-menu answer at once', () => {
    const s = chatReducer(initialChatState, {
      type: 'level',
      level: { tier: 'quick', source: { kind: 'chat' } },
    });
    expect(s.level?.tier).toBe('quick');
  });
  it('does not touch the items', () => {
    const s = apply([
      seq(1, { type: 'user-message', messageId: 'u', text: 'Hi' }),
      seq(2, { type: 'level', level: std }),
    ]);
    expect(s.items).toHaveLength(1);
  });
});

describe('chatReducer: context management', () => {
  const done = (id: string, at: number | null = 1000) =>
    ({
      type: 'compaction',
      phase: 'done',
      id,
      trigger: 'auto',
      preTokens: 150_000,
      postTokens: 20_000,
      at,
    }) as const;
  const reading = (percent: number): ChatEvent => ({
    type: 'context',
    usedTokens: percent * 1000,
    limitTokens: 100_000,
    windowTokens: 200_000,
    percent,
    autoCompact: true,
    source: 'engine',
    at: 1,
  });

  it('shows the state line when summarising starts, and clears it on every way out', () => {
    const started = apply([seq(1, { type: 'compaction', phase: 'started' })]);
    expect(started.compacting).toBe(true);
    const clearing: ChatEvent[] = [
      done('c:1'),
      { type: 'compaction', phase: 'failed' },
      { type: 'compaction', phase: 'ended' },
      { type: 'turn-end', ok: true, interrupted: false, errorText: null, durationMs: 1 },
      { type: 'state', state: 'idle' },
    ];
    for (const [i, event] of clearing.entries()) {
      expect(apply([seq(2 + i, event)], started).compacting).toBe(false);
    }
  });

  it('adds one divider per compaction id, however often it arrives', () => {
    const s = apply([
      seq(1, { type: 'user-message', messageId: 'u', text: 'Hi' }),
      seq(2, done('c:1')),
      seq(3, done('c:1')),
    ]);
    expect(s.items.filter((i) => i.kind === 'summary')).toHaveLength(1);
    expect(s.items[1]).toMatchObject({
      kind: 'summary',
      id: 'c:1',
      text: 'Earlier messages were summarised to make room. Claude keeps the key points but may have lost some detail.',
    });
    expect(s.lastCompaction).toMatchObject({ id: 'c:1', preTokens: 150_000, postTokens: 20_000 });
  });

  it('words the first replayed divider of a reopened chat differently', () => {
    const s = apply([
      seq(1, done('c:1', null)),
      seq(2, { type: 'user-message', messageId: 'u', text: 'Hi' }),
    ]);
    expect(s.items[0]).toMatchObject({
      kind: 'summary',
      text: "Earlier messages in this chat were summarised to make room, so they aren't shown here.",
    });
  });

  it('warns once when summarising fails, until a later one works', () => {
    const failed = { type: 'compaction', phase: 'failed' } as const;
    const s = apply([seq(1, failed), seq(2, failed)]);
    const warnings = s.items.filter((i) => i.kind === 'notice');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      level: 'warning',
      text: "Claude couldn't summarise this chat. If replies start failing, start a new chat.",
    });
    const again = apply([seq(3, done('c:2')), seq(4, failed)], s);
    expect(again.items.filter((i) => i.kind === 'notice')).toHaveLength(2);
  });

  it('keeps the newest context reading', () => {
    const s = apply([seq(1, reading(42)), seq(2, reading(61))]);
    expect(s.context?.percent).toBe(61);
  });
});
