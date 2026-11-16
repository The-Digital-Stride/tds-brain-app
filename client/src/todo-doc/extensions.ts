/**
 * The to-do details schema (plan decisions 5 and 6), with no DOM work so Node scripts can load it.
 * The editor uses `todoDocExtensions()` from ./index.ts, which adds the kept block's formatted view.
 */
import { Extension, type Extensions, mergeAttributes, Node } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import StarterKit from '@tiptap/starter-kit';
import { TodoCode } from './code-mark.ts';
import { isSafeHref } from './links.ts';

export const KEPT_BLOCK = 'keptBlock';

/** Node types that can sit at the top level and carry the `md` attr. */
export const TOP_TYPES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', KEPT_BLOCK];

/**
 * Where a top-level block came from: its exact markdown, its position among the original blocks and the
 * whitespace that came before it. Never rendered, never parsed from HTML, dropped on split and paste.
 */
export interface BlockOrigin {
  source: string;
  index: number;
  before: string;
}

const BlockOriginAttr = Extension.create({
  name: 'todoBlockOrigin',
  addGlobalAttributes() {
    return [{ types: TOP_TYPES, attributes: { md: { default: null, rendered: false, keepOnSplit: false } } }];
  },
});

/**
 * A block the editor doesn't offer (table, code, quote, HTML, anything unknown), held as its exact markdown.
 * An atom: shown whole, moved or deleted whole, never edited. Its own group keeps it out of list items.
 */
export const KeptBlock = Node.create({
  name: KEPT_BLOCK,
  group: 'kept',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      source: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-source') ?? '',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-source': String(attrs.source ?? '') }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-todo-kept]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'todo-kept', 'data-todo-kept': '' })];
  },
  renderText({ node }) {
    return String(node.attrs.source ?? '');
  },
});

// The document allows kept blocks at the top level only.
const TodoDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: '(block | kept)+',
  renderMarkdown: (node, h) => (node.content ? h.renderChildren(node.content, '\n\n') : ''),
});

export function baseExtensions(kept: typeof KeptBlock = KeptBlock): Extensions {
  return [
    TodoDocument,
    StarterKit.configure({
      document: false,
      code: false,
      blockquote: false,
      codeBlock: false,
      horizontalRule: false,
      underline: false,
      trailingNode: false,
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        isAllowedUri: (url: string) => isSafeHref(url),
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      },
    }),
    TodoCode,
    TaskList,
    TaskItem.configure({ nested: true }),
    kept,
    BlockOriginAttr,
  ];
}
