/**
 * Every tool step of a chat as one flat, ordered list, for the "This chat" panel's Steps tab.
 * Contract: `StepRow` and `StepsOf` in client/src/shell/contract.ts.
 */
import type { StepRow, StepsOf } from '../shell/contract.ts';
import type { ChatItem, ChildItem } from './chat-reducer.ts';

function collect(items: (ChatItem | ChildItem)[], depth: number, out: StepRow[]): void {
  for (const item of items) {
    if (item.kind !== 'tool') continue;
    out.push({ id: item.id, label: item.label, status: item.status, depth });
    collect(item.children, depth + 1, out);
  }
}

export const stepsOf: StepsOf = (items) => {
  const out: StepRow[] = [];
  collect(items, 0, out);
  return out;
};

/** A step's status in words, the same in the thread and the panel. */
export const STEP_WORDS: Record<StepRow['status'], string> = {
  running: 'working',
  ok: 'done',
  failed: 'did not work',
};
