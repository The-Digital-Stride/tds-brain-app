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

/** Each block as a short code: the item's id, or `[...]` for a fold of steps and notes. */
const shape = (blocks: Block[]) =>
  blocks.map((b) =>
    b.kind === 'tools'
      ? `[${b.entries.map((e) => e.id).join(' ')}]`
      : 'id' in b.item
        ? b.item.id
        : b.item.kind,
  );

describe('toBlocks', () => {
  it('folds text followed by a step in the same turn in with the steps, and leaves the answer out', () => {
    const blocks = toBlocks([user, text('a'), tool('1'), text('b'), turnEnd]);
    expect(shape(blocks)).toEqual(['u', '[a 1]', 'b', 't']);
  });

  it('makes one fold of a whole turn of notes and steps, in order', () => {
    const blocks = toBlocks([
      user,
      text('a'),
      tool('1'),
      text('b'),
      text('c'),
      tool('2'),
      tool('3'),
      text('d'),
    ]);
    expect(shape(blocks)).toEqual(['u', '[a 1 b c 2 3]', 'd']);
    const fold = blocks[1];
    expect(fold?.kind === 'tools' && fold.tools.map((t) => t.id)).toEqual(['1', '2', '3']);
    expect(fold?.kind === 'tools' && fold.id).toBe('a');
  });

  it('does not let a tool in a later turn fold the earlier answer', () => {
    const blocks = toBlocks([user, text('a'), turnEnd, user, tool('1')]);
    expect(shape(blocks)).toEqual(['u', 'a', 't', 'u', '[1]']);
  });

  it('leaves text that is still being written out until a step follows it', () => {
    const writing: ChatItem = { kind: 'assistant', id: 'w', text: 'Let me', done: false };
    expect(shape(toBlocks([user, tool('1'), writing]))).toEqual(['u', '[1]', 'w']);
    expect(shape(toBlocks([user, tool('1'), writing, tool('2')]))).toEqual(['u', '[1 w 2]']);
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
