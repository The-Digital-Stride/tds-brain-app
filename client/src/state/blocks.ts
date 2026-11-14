import type { AssistantItem, ChatItem, ToolItem } from './chat-reducer.ts';

/** One line in a "What Claude did" fold: a step, or a note Claude wrote between steps. */
export type ActivityEntry = ToolItem | AssistantItem;

export type Block =
  /** `id` is the first entry's, so a fold keeps its key (and its open state) as it grows. */
  | { kind: 'tools'; id: string; entries: ActivityEntry[]; tools: ToolItem[] }
  | { kind: 'item'; item: ChatItem };

/**
 * The ids of Claude's working notes: its own text that a step follows in the same turn. They
 * fold away with the steps (and show in the Steps tab), leaving the answer that ends the turn.
 * Text still being written counts once a step follows it.
 */
export function noteIds(items: ChatItem[]): Set<string> {
  const notes = new Set<string>();
  let toolAhead = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item) continue;
    if (item.kind === 'user' || item.kind === 'turn-end') toolAhead = false;
    else if (item.kind === 'tool') toolAhead = true;
    else if (item.kind === 'assistant' && toolAhead) notes.add(item.id);
  }
  return notes;
}

export function toBlocks(items: ChatItem[]): Block[] {
  const notes = noteIds(items);
  const blocks: Block[] = [];
  for (const item of items) {
    // A turn that ended well shows nothing, so it must not split a fold either (a helper waking
    // Claude between two runs of steps). It still ends the turn for `noteIds`.
    if (item.kind === 'turn-end' && item.ok && !item.interrupted) continue;
    const isNote = item.kind === 'assistant' && notes.has(item.id);
    if (item.kind !== 'tool' && !isNote) {
      blocks.push({ kind: 'item', item });
      continue;
    }
    let fold = blocks.at(-1);
    if (fold?.kind !== 'tools') {
      fold = { kind: 'tools', id: item.id, entries: [], tools: [] };
      blocks.push(fold);
    }
    fold.entries.push(item);
    if (item.kind === 'tool') fold.tools.push(item);
  }
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
