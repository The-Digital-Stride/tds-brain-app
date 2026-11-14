import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../shared/contract.ts';
import { createEventMapper, type RawMessage, toolLabel } from './event-map.ts';

// Shapes copied from a real SDK 0.3.322 run (trimmed).
const SID = 'd6a2e8f8-af61-4b6d-8786-681766dbcb46';

const init = (over: Record<string, unknown> = {}): RawMessage => ({
  type: 'system',
  subtype: 'init',
  session_id: SID,
  model: 'claude-haiku-5-5',
  claude_code_version: '2.1.322',
  apiKeySource: 'none',
  ...over,
});

const se = (event: Record<string, unknown>, parent: string | null = null): RawMessage => ({
  type: 'stream_event',
  event,
  parent_tool_use_id: parent,
  session_id: SID,
});

const assistant = (id: string, content: unknown[], parent: string | null = null): RawMessage => ({
  type: 'assistant',
  message: { id, type: 'message', role: 'assistant', content },
  parent_tool_use_id: parent,
  session_id: SID,
});

const toolResult = (toolUseId: string, isError?: boolean, parent: string | null = null): RawMessage => ({
  type: 'user',
  message: {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: toolUseId, content: 'x', ...(isError ? { is_error: true } : {}) },
    ],
  },
  parent_tool_use_id: parent,
  session_id: SID,
});

function run(msgs: RawMessage[], opts?: { interrupted?: boolean }): ChatEvent[] {
  const m = createEventMapper();
  return msgs.flatMap((msg) => m.map(msg, opts));
}

describe('session-info', () => {
  it('comes from system:init, only when it changes', () => {
    const events = run([init(), init(), init({ model: 'claude-opus-5-5' })]);
    expect(events).toEqual([
      { type: 'session-info', sdkSessionId: SID, model: 'claude-haiku-5-5', claudeVersion: '2.1.322' },
      { type: 'session-info', sdkSessionId: SID, model: 'claude-opus-5-5', claudeVersion: '2.1.322' },
    ]);
  });

  it('ignores hook, status and other noise', () => {
    expect(
      run([
        { type: 'system', subtype: 'hook_started', session_id: SID },
        { type: 'system', subtype: 'hook_response', session_id: SID, output: 'secret' },
        { type: 'system', subtype: 'status', status: 'requesting' },
        { type: 'system', subtype: 'ui_status', text: 'Wordle' },
        { type: 'system', subtype: 'thinking_tokens' },
        { type: 'rate_limit_event', rate_limit_info: {} },
        se({ type: 'message_start', message: { id: 'm1' } }),
        se({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
        se({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }),
        se({ type: 'content_block_stop', index: 0 }),
        assistant('m1', [{ type: 'thinking', thinking: '', signature: 'x' }]),
        se({ type: 'message_stop' }),
      ]),
    ).toEqual([]);
  });
});

describe('text', () => {
  it('streams deltas then the finished block, sharing one messageId', () => {
    const events = run([
      se({ type: 'message_start', message: { id: 'msg_A' } }),
      se({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
      assistant('msg_A', [{ type: 'thinking', thinking: '' }]),
      se({ type: 'content_block_stop', index: 0 }),
      se({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
      se({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello ' } }),
      se({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'there.' } }),
      assistant('msg_A', [{ type: 'text', text: 'Hello there.' }]),
      se({ type: 'content_block_stop', index: 1 }),
    ]);
    expect(events).toHaveLength(3);
    const [d1, d2, done] = events;
    expect(d1).toMatchObject({ type: 'assistant-delta', text: 'Hello ', parentToolUseId: null });
    expect(d2).toMatchObject({ type: 'assistant-delta', text: 'there.' });
    expect(done).toMatchObject({ type: 'assistant-message', text: 'Hello there.', parentToolUseId: null });
    const ids = new Set(events.map((e) => (e as { messageId: string }).messageId));
    expect(ids.size).toBe(1);
  });

  it('gives each text block its own messageId', () => {
    const events = run([
      se({ type: 'message_start', message: { id: 'msg_B' } }),
      se({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'One' } }),
      assistant('msg_B', [{ type: 'text', text: 'One' }]),
      se({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 't1', name: 'Bash' },
      }),
      assistant('msg_B', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
      se({ type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } }),
      se({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Two' } }),
      assistant('msg_B', [{ type: 'text', text: 'Two' }]),
    ]);
    const text = events.filter(
      (e) => e.type === 'assistant-delta' || e.type === 'assistant-message',
    ) as Array<{
      messageId: string;
      text: string;
    }>;
    expect(text.map((e) => e.text)).toEqual(['One', 'One', 'Two', 'Two']);
    expect(text[0]?.messageId).toBe(text[1]?.messageId);
    expect(text[2]?.messageId).toBe(text[3]?.messageId);
    expect(text[0]?.messageId).not.toBe(text[2]?.messageId);
  });

  it('works without partial messages (finished blocks only)', () => {
    const events = run([assistant('msg_C', [{ type: 'text', text: 'Hi' }])]);
    expect(events).toEqual([
      { type: 'assistant-message', messageId: expect.any(String), text: 'Hi', parentToolUseId: null },
    ]);
  });

  it('skips empty text blocks', () => {
    expect(run([assistant('msg_D', [{ type: 'text', text: '' }])])).toEqual([]);
  });
});

describe('tools', () => {
  it('starts a tool from the finished tool_use block with a plain label, and ends it from the tool_result', () => {
    const events = run([
      assistant('m', [
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a/b/notes.txt' } },
      ]),
      toolResult('toolu_1'),
      assistant('m2', [
        { type: 'tool_use', id: 'toolu_2', name: 'Write', input: { file_path: '/a/out.txt' } },
      ]),
      toolResult('toolu_2', true),
    ]);
    expect(events).toEqual([
      {
        type: 'tool-start',
        toolUseId: 'toolu_1',
        tool: 'Read',
        label: 'Reading notes.txt',
        parentToolUseId: null,
      },
      { type: 'tool-end', toolUseId: 'toolu_1', ok: true },
      {
        type: 'tool-start',
        toolUseId: 'toolu_2',
        tool: 'Write',
        label: 'Editing out.txt',
        parentToolUseId: null,
      },
      { type: 'tool-end', toolUseId: 'toolu_2', ok: false },
    ]);
  });

  it('carries the helper agent parent id on its text and tools', () => {
    const events = run([
      assistant('m', [
        { type: 'tool_use', id: 'agent_1', name: 'Agent', input: { description: 'x', prompt: 'y' } },
      ]),
      assistant('sub', [{ type: 'text', text: 'Helper thinking' }], 'agent_1'),
      assistant(
        'sub',
        [{ type: 'tool_use', id: 'toolu_9', name: 'Grep', input: { pattern: 'x' } }],
        'agent_1',
      ),
      toolResult('toolu_9', false, 'agent_1'),
      toolResult('agent_1'),
    ]);
    expect(events[0]).toMatchObject({ type: 'tool-start', label: 'Asking a helper', parentToolUseId: null });
    expect(events[1]).toMatchObject({
      type: 'assistant-message',
      text: 'Helper thinking',
      parentToolUseId: 'agent_1',
    });
    expect(events[2]).toMatchObject({ type: 'tool-start', toolUseId: 'toolu_9', parentToolUseId: 'agent_1' });
    expect(events[3]).toEqual({ type: 'tool-end', toolUseId: 'toolu_9', ok: true });
    expect(events[4]).toEqual({ type: 'tool-end', toolUseId: 'agent_1', ok: true });
  });

  it('carries the parent id on streamed helper text too', () => {
    const events = run([
      se({ type: 'message_start', message: { id: 'sub1' } }, 'agent_1'),
      se({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'agent_1'),
      se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } }, 'agent_1'),
    ]);
    expect(events).toEqual([
      { type: 'assistant-delta', messageId: expect.any(String), text: 'x', parentToolUseId: 'agent_1' },
    ]);
  });

  it('labels tools in plain UK English', () => {
    expect(toolLabel('Read', { file_path: '/x/y/report.md' })).toBe('Reading report.md');
    expect(toolLabel('Edit', { file_path: 'a/b.ts' })).toBe('Editing b.ts');
    expect(toolLabel('Write', {})).toBe('Editing a file');
    expect(toolLabel('Bash', { command: 'rm -rf /' })).toBe('Running a command');
    expect(toolLabel('Skill', { skill: 'meeting-notes' })).toBe('Using the meeting-notes skill');
    expect(toolLabel('Agent', {})).toBe('Asking a helper');
    expect(toolLabel('Task', {})).toBe('Asking a helper');
    expect(toolLabel('WebFetch', { url: 'https://x' })).toBe('Looking on the web');
    expect(toolLabel('WebSearch', { query: 'x' })).toBe('Looking on the web');
    expect(toolLabel('mcp__claude_ai_Gmail__search_threads', {})).toBe('Using Gmail');
    expect(toolLabel('mcp__slack__slack_post_message', {})).toBe('Using slack');
    expect(toolLabel('SomethingNew', {})).toBe('SomethingNew');
  });
});

describe('helper reports', () => {
  const handBack = (from: string, parent: string | null = null): RawMessage => ({
    type: 'user',
    uuid: 'u-report',
    isSynthetic: true,
    message: {
      role: 'user',
      content: `Another Claude session sent a message:\n<agent-message from="${from}">\nThe report follows:\n  ## Found\n  It works.\n</agent-message>\n\nThat "other Claude session" is an agent.`,
    },
    parent_tool_use_id: parent,
    session_id: SID,
  });

  it('turns a hand-back into a named report, never a message from the person', () => {
    const started = assistant('m1', [
      { type: 'tool_use', id: 'ag1', name: 'Agent', input: { description: 'Audit memory', prompt: 'p' } },
    ]);
    const launched: RawMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'ag1', content: 'agentId: ab12' }],
      },
      parent_tool_use_id: null,
      session_id: SID,
    };
    expect(run([started, launched, handBack('ab12')]).filter((e) => e.type === 'helper-report')).toEqual([
      { type: 'helper-report', messageId: 'u-report', name: 'Audit memory', text: '## Found\nIt works.' },
    ]);
  });

  it('has no name for a helper it did not see start, and ignores a helper’s own inner turns', () => {
    expect(run([handBack('zz')])).toEqual([
      { type: 'helper-report', messageId: 'u-report', name: null, text: '## Found\nIt works.' },
    ]);
    expect(run([handBack('zz', 'parent-tool')])).toEqual([]);
  });

  it('shows nothing for a finish notice or other plain user text', () => {
    const plain = (content: string): RawMessage => ({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: SID,
    });
    expect(run([plain('<task-notification>\n</task-notification>'), plain('hello')])).toEqual([]);
  });
});

describe('turn-end', () => {
  it('maps a successful result', () => {
    expect(
      run([{ type: 'result', subtype: 'success', is_error: false, result: 'done', duration_ms: 6206 }]),
    ).toEqual([{ type: 'turn-end', ok: true, interrupted: false, durationMs: 6206, errorText: null }]);
  });

  it('maps errors to plain sentences, never the engine’s own error text', () => {
    const plain = (e: unknown) => {
      const text = (e as { errorText: string }).errorText;
      expect(text).toMatch(/^[A-Z][\s\S]*\.$/);
      expect(text).not.toMatch(/API Error|529|boom|error_|stack|exception/i);
      return text;
    };
    const [a] = run([
      {
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'API Error: 529 overloaded_error',
        duration_ms: 10,
      },
    ]);
    expect(a).toMatchObject({ type: 'turn-end', ok: false, interrupted: false, durationMs: 10 });
    expect(plain(a)).toMatch(/again/);
    const [b] = run([
      { type: 'result', subtype: 'error_max_turns', is_error: true, duration_ms: 5, errors: [] },
    ]);
    expect(b).toMatchObject({ type: 'turn-end', ok: false, interrupted: false, durationMs: 5 });
    expect(plain(b)).toMatch(/steps/);
    const [c] = run([
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        duration_ms: 5,
        errors: ['boom at x.js:1'],
      },
    ]);
    expect(c).toMatchObject({ ok: false });
    expect(plain(c)).toMatch(/again/);
    for (const subtype of [
      'error_max_budget_usd',
      'error_max_structured_output_retries',
      'error_something_new',
    ]) {
      plain(run([{ type: 'result', subtype, is_error: true, duration_ms: 1, errors: ['raw'] }])[0]);
    }
  });

  it('marks an interrupted turn and drops its error text', () => {
    const [e] = run(
      [
        {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          duration_ms: 5,
          errors: ['aborted'],
        },
      ],
      { interrupted: true },
    );
    expect(e).toEqual({ type: 'turn-end', ok: false, interrupted: true, durationMs: 5, errorText: null });
  });
});

describe('safety-check denials', () => {
  const denied = (over: Record<string, unknown> = {}): RawMessage => ({
    type: 'system',
    subtype: 'permission_denied',
    tool_name: 'Bash',
    tool_use_id: 'toolu_secret_id',
    decision_reason_type: 'classifier',
    message: 'Permission denied',
    session_id: SID,
    ...over,
  });

  it('becomes a plain notice naming the step, never the raw tool id', () => {
    const m = createEventMapper();
    m.map(
      assistant('m', [
        { type: 'tool_use', id: 'toolu_secret_id', name: 'Write', input: { file_path: '/a/notes.md' } },
      ]),
    );
    const [e] = m.map(denied({ tool_name: 'Write' }));
    expect(e).toEqual({
      type: 'notice',
      level: 'warning',
      text: "Claude Code's safety check stopped a step (editing notes.md). Claude has been told and may try another way.",
    });
    expect(JSON.stringify(e)).not.toContain('toolu_secret_id');
  });

  it('falls back to the tool name phrase, and adds a readable reason capped at 300 characters', () => {
    const [a] = run([denied()]);
    expect(a).toMatchObject({ text: expect.stringContaining('(running a command)') });
    const [b] = run([denied({ decision_reason: `Looks risky:\n${'z'.repeat(400)}` })]);
    const text = (b as { text: string }).text;
    expect(text).toContain('Looks risky:');
    expect(text).not.toContain('\n');
    const reason = text.slice(text.indexOf('Looks risky:'));
    expect(reason.length).toBeLessThanOrEqual(301);
  });

  it('stays quiet for a step the person refused on a card', () => {
    const m = createEventMapper();
    expect(m.map(denied(), { deniedByPerson: new Set(['toolu_secret_id']) })).toEqual([]);
  });
});
