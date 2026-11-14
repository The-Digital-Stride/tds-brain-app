/**
 * Every tool step of a chat as one flat, ordered list, for the "This chat" panel's Steps tab,
 * with the notes Claude wrote between them (the same ones the thread folds into "What Claude did").
 * Contract: `StepEntry` and `StepsOf` in client/src/shell/contract.ts.
 */
import type { StepEntry, StepRow, StepsOf } from '../shell/contract.ts';
import { noteIds } from './blocks.ts';
import type { ChatItem, ChildItem } from './chat-reducer.ts';

function collect(items: (ChatItem | ChildItem)[], depth: number, out: StepEntry[]): void {
  for (const item of items) {
    if (item.kind !== 'tool') continue;
    out.push({ kind: 'step', id: item.id, label: item.label, status: item.status, depth });
    collect(item.children, depth + 1, out);
  }
}

export const stepsOf: StepsOf = (items) => {
  const notes = noteIds(items);
  const out: StepEntry[] = [];
  for (const item of items) {
    // Claude's own notes only: a helper's text is its report, shown under its step in the thread.
    if (item.kind === 'assistant' && notes.has(item.id) && item.text.trim())
      out.push({ kind: 'note', id: item.id, text: item.text });
    else collect([item], 0, out);
  }
  return out;
};

/** A step's status in words, the same in the thread and the panel. */
export const STEP_WORDS: Record<StepRow['status'], string> = {
  running: 'working',
  ok: 'done',
  failed: 'did not work',
};
