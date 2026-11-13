import { describe, expect, it } from 'vitest';
import type { AssistantItem, ChatItem, ToolItem } from './chat-reducer.ts';
import { stepsOf } from './steps.ts';

const tool = (
  id: string,
  status: ToolItem['status'] = 'ok',
  children: ToolItem['children'] = [],
): ToolItem => ({ kind: 'tool', id, tool: 'Read', label: `Step ${id}`, status, children });
const text = (id: string): AssistantItem => ({ kind: 'assistant', id, text: 'x', done: true });

describe('stepsOf', () => {
  it('is empty for a chat with no steps', () => {
    expect(stepsOf([])).toEqual([]);
    expect(stepsOf([{ kind: 'user', id: 'u', text: 'hi' }, text('a')])).toEqual([]);
  });

  it('flattens every tool step in order, across turns, with its label and status', () => {
    const items: ChatItem[] = [
      { kind: 'user', id: 'u1', text: 'hi' },
      tool('1'),
      text('a'),
      tool('2', 'failed'),
      { kind: 'user', id: 'u2', text: 'again' },
      tool('3', 'running'),
    ];
    expect(stepsOf(items)).toEqual([
      { id: '1', label: 'Step 1', status: 'ok', depth: 0 },
      { id: '2', label: 'Step 2', status: 'failed', depth: 0 },
      { id: '3', label: 'Step 3', status: 'running', depth: 0 },
    ]);
  });

  it("puts a helper's steps straight after their parent, one level deeper per helper", () => {
    const items: ChatItem[] = [
      tool('1', 'ok', [text('h'), tool('1a', 'ok', [tool('1a-i', 'running')]), tool('1b', 'failed')]),
      tool('2'),
    ];
    expect(stepsOf(items).map((s) => [s.id, s.depth])).toEqual([
      ['1', 0],
      ['1a', 1],
      ['1a-i', 2],
      ['1b', 1],
      ['2', 0],
    ]);
  });

  it('skips cards, notices and turn ends', () => {
    const items: ChatItem[] = [
      {
        kind: 'permission',
        requestId: 'r',
        tool: 'Write',
        title: 't',
        detail: '',
        warning: null,
        sessionAllowLabel: null,
        change: null,
        outcome: null,
      },
      { kind: 'notice', id: 'n', level: 'info', text: 'x' },
      tool('1'),
      { kind: 'turn-end', id: 't', ok: true, interrupted: false, errorText: null, durationMs: 1 },
    ];
    expect(stepsOf(items).map((s) => s.id)).toEqual(['1']);
  });
});
