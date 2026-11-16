/**
 * Tick items in to-do details (plan decision 8). Counts and toggles only the task items the panel shows:
 * those in editable blocks, found with the same reader as `toDoc`, so indexes match the document's
 * `taskItem` nodes in order. Tasks inside kept blocks (code, quotes, tables) are not counted.
 */
import { analyse, taskMarkers } from './convert.ts';

/** Absolute offsets of each shown task's `[ ]`/`[x]` character, in document order. */
function markers(markdown: string): { offset: number; checked: boolean }[] {
  const { blocks, fallback } = analyse(markdown);
  if (fallback) return [];
  return blocks.flatMap((b) =>
    b.node ? taskMarkers(b.source).map((m) => ({ offset: b.start + m.offset, checked: m.checked })) : [],
  );
}

export function countTasks(markdown: string): number {
  return markers(markdown).length;
}

export function setTask(markdown: string, index: number, checked: boolean): string {
  if (!Number.isInteger(index) || index < 0) return markdown;
  const m = markers(markdown)[index];
  if (!m || m.checked === checked) return markdown;
  return `${markdown.slice(0, m.offset)}${checked ? 'x' : ' '}${markdown.slice(m.offset + 1)}`;
}
