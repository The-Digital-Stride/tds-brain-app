/** Words for a chat's steps, shared by the thread's "What Claude did" folds. */
import type { ToolItem } from './chat-reducer.ts';

/** A helper's report's title in its fold. */
export function reportTitle(name: string | null): string {
  return name ? `Helper's report: ${name}` : "A helper's report";
}

/** A step's status in words. */
export const STEP_WORDS: Record<ToolItem['status'], string> = {
  running: 'working',
  ok: 'done',
  failed: 'did not work',
};
