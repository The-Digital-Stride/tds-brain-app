/**
 * To-do details document (plan docs/plans/2026-11-16-todo-panel.md). Signatures follow ./contract.ts.
 * The pure parts live in ./convert.ts and ./tasks.ts (Node-safe); this module adds the kept block's view.
 */
import type { Extensions } from '@tiptap/core';
import { baseExtensions } from './extensions.ts';
import { KeptBlockView } from './kept-view.ts';

export type { TodoDetailsEditorProps, ToolbarAction } from './contract.ts';
export { isFaithful, isSafeHref, toDoc, toMarkdown } from './convert.ts';
export { countTasks, setTask } from './tasks.ts';

export function todoDocExtensions(): Extensions {
  return baseExtensions(KeptBlockView);
}
