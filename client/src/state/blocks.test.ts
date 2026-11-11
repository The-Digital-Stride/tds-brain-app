import { describe, expect, it } from 'vitest';
import { type Block, currentStep, toBlocks } from './blocks.ts';
import type { ChatItem, ToolItem } from './chat-reducer.ts';

const text = (id: string, t = 'x'): ChatItem => ({ kind: 'assistant', id, text: t, done: true });
const tool = (
  id: string,
  status: ToolItem['status'] = 'ok',
  children: ToolItem['children'] = [],
): ToolItem => ({
  kind: 'tool',
  id,
  tool: 'Read',
  label: `Step ${id}`,
  status,
  children,
});
const user: ChatItem = { kind: 'user', id: 'u', text: 'hi' };
const turnEnd: ChatItem = {
  kind: 'turn-end',
  id: 't',
  ok: true,
  interrupted: false,
  errorText: null,
  durationMs: 1,
};

const noteFlags = (blocks: Block[]) =>
  blocks.flatMap((b) => (b.kind === 'item' && b.item.kind === 'assistant' ? [b.note] : []));

describe('toBlocks', () => {
  it('treats text followed by a tool step in the same turn as a working note', () => {
    const blocks = toBlocks([user, text('a'), tool('1'), text('b'), turnEnd]);
    expect(noteFlags(blocks)).toEqual([true, false]);
  });

  it('does not let a tool in a later turn turn the earlier answer into a note', () => {
    const blocks = toBlocks([user, text('a'), turnEnd, user, tool('1')]);
    expect(noteFlags(blocks)).toEqual([false]);
  });

  it('groups consecutive tools into one block', () => {
    const blocks = toBlocks([tool('1'), tool('2'), text('a')]);
    expect(blocks.map((b) => b.kind)).toEqual(['tools', 'item']);
  });
});

describe('currentStep', () => {
  it('names the one step that is running, deepest first', () => {
    const inner = tool('2', 'running');
    expect(currentStep([tool('1', 'running', [inner])])).toBe('Step 2');
  });
  it('is null when nothing is running', () => {
    expect(currentStep([tool('1', 'ok')])).toBeNull();
  });
});
