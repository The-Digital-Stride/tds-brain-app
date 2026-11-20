/**
 * The to-do details document: the contract between the converter (Builder A) and the panel (Builder B).
 * Plan: docs/plans/2026-11-16-todo-panel.md, decisions 4 to 8 and 14.
 *
 * Details are stored as markdown in the to-do file. The panel shows and edits them as a Tiptap document.
 * The round trip must be exact: `toMarkdown(toDoc(md))` returns `md` unchanged, and editing one block
 * changes only that block's markdown.
 */
import type { Extensions, JSONContent } from '@tiptap/core';

/** What the toolbar offers (decision 5). Inline code, italic and strike are kept but have no button. */
export type ToolbarAction = 'heading' | 'body' | 'bullets' | 'numbers' | 'ticks' | 'bold' | 'link';

/** The Tiptap extensions for to-do details: the allowed schema plus `keptBlock` (decision 6). */
export declare function todoDocExtensions(): Extensions;

/**
 * Markdown (the trimmed `TodoItem.details`) to a Tiptap document. Every top-level block remembers its
 * exact source so an unchanged block is written back byte for byte. Never throws: anything it can't
 * map becomes a `keptBlock`.
 */
export declare function toDoc(markdown: string): JSONContent;

/**
 * A Tiptap document back to markdown. Unchanged top-level blocks are written from their source; changed
 * or new ones in brain style (decision 7). The result is trimmed, like `TodoItem.details`.
 */
export declare function toMarkdown(doc: JSONContent): string;

/**
 * True when `toMarkdown(toDoc(md)) === md` AND every editable block, force-re-serialised, re-parses to
 * the same node. False = the panel opens these details read-only (overseer blocking 1).
 */
export declare function isFaithful(markdown: string): boolean;

/** How many task items the markdown has, in document order (nested ones included). */
export declare function countTasks(markdown: string): number;

/**
 * Ticks or unticks the task item at `index` (document order) and returns the new markdown; every other
 * byte stays the same. Returns `markdown` unchanged if there is no such item.
 */
export declare function setTask(markdown: string, index: number, checked: boolean): string;

/** Decision 14: the only hrefs shown as links. Anything else stays in the markdown as plain text. */
export declare function isSafeHref(href: string): boolean;

/** Props of `TodoDetailsEditor` (Builder B), which wraps Tiptap with `todoDocExtensions()`. */
export interface TodoDetailsEditorProps {
  /** The markdown to show. A change from outside (another person's version) resets the document. */
  markdown: string;
  /** Read mode (false) or edit mode (true). */
  editable: boolean;
  /** Edit mode: called with the new markdown on every change. */
  onChange?: (markdown: string) => void;
  /** Read mode: a tick item was pressed. Absent = tick items are not pressable. */
  onToggleTask?: (index: number, checked: boolean) => void;
  /** Read mode: a tick is being saved. The boxes show it but can't be pressed again until it is done. */
  pending?: boolean;
  /** Accessible name of the editing area, e.g. "Details". */
  label: string;
  /** Id for `aria-describedby` notes. */
  describedBy?: string;
}
