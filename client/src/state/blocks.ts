import type { ChatItem, ToolItem } from './chat-reducer.ts';

export type Block =
  | { kind: 'tools'; id: string; tools: ToolItem[] }
  /** `note` is true for assistant text that is followed by a tool step in the same turn. */
  | { kind: 'item'; item: ChatItem; note: boolean };

export function toBlocks(items: ChatItem[]): Block[] {
  const notes = new Set<number>();
  let toolAhead = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item) continue;
    if (item.kind === 'user' || item.kind === 'turn-end') toolAhead = false;
    else if (item.kind === 'tool') toolAhead = true;
    else if (item.kind === 'assistant' && toolAhead) notes.add(i);
  }
  const blocks: Block[] = [];
  items.forEach((item, i) => {
    if (item.kind === 'tool') {
      const last = blocks.at(-1);
      if (last?.kind === 'tools') last.tools.push(item);
      else blocks.push({ kind: 'tools', id: item.id, tools: [item] });
    } else {
      blocks.push({ kind: 'item', item, note: notes.has(i) });
    }
  });
  return blocks;
}

/** The label of the single step running now (deepest, latest), or null. */
export function currentStep(tools: ToolItem[]): string | null {
  for (let i = tools.length - 1; i >= 0; i--) {
    const t = tools[i];
    if (!t) continue;
    const inner = currentStep(t.children.filter((c): c is ToolItem => c.kind === 'tool'));
    if (inner) return inner;
    if (t.status === 'running') return t.label;
  }
  return null;
}
