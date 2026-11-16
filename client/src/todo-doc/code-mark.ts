/**
 * Inline code, as Tiptap's own `Code` mark (3.32.2) but able to sit inside bold, italic, strike and links.
 * Tiptap's mark excludes every other mark, so `**Run `pnpm test`**`, common in to-dos, would not fit the
 * schema. Markdown handling is Tiptap's, plus the padding that keeps spaces at the ends of the code.
 */
import { Mark, markInputRule, markPasteRule, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    todoCode: {
      toggleCode: () => ReturnType;
    };
  }
}

function lastCodeSpan(text: string) {
  const match = /`([^`]+)`(?!`)$/.exec(text);
  if (!match || (match.index > 0 && text[match.index - 1] === '`')) return null;
  return { index: match.index, text: match[0], replaceWith: match[1] };
}

function allCodeSpans(text: string) {
  const out: { index: number; text: string; replaceWith: string | undefined }[] = [];
  for (const match of text.matchAll(/`([^`]+)`(?!`)/g)) {
    if (match.index > 0 && text[match.index - 1] === '`') continue;
    out.push({ index: match.index, text: match[0], replaceWith: match[1] });
  }
  return out;
}

function shortestUnusedBacktickRun(text: string): number {
  const runs = new Set((text.match(/`+/g) ?? []).map((run) => run.length));
  let length = 1;
  while (runs.has(length)) length += 1;
  return length;
}

export const TodoCode = Mark.create({
  name: 'code',
  excludes: '',
  code: true,
  exitable: true,
  parseHTML() {
    return [{ tag: 'code' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['code', mergeAttributes(HTMLAttributes), 0];
  },
  markdownTokenName: 'codespan',
  parseMarkdown: (token, helpers) => helpers.applyMark('code', [{ type: 'text', text: token.text || '' }]),
  renderMarkdown: (node, h, context) => {
    if (!node.content) return '';
    const markText = typeof context?.meta?.markText === 'string' ? context.meta.markText : '';
    const fence = '`'.repeat(shortestUnusedBacktickRun(markText));
    // A reader strips one space from each end when both ends have one (and it isn't all spaces), so
    // " x " is written "`  x  `". The spaces themselves come through as `CODE_SPACE` (see convert.ts).
    const edgeSpaces =
      markText.length > 1 && markText.startsWith(' ') && markText.endsWith(' ') && /[^ ]/.test(markText);
    const padding = markText.startsWith('`') || markText.endsWith('`') || edgeSpaces ? ' ' : '';
    return `${fence}${padding}${h.renderChildren(node.content)}${padding}${fence}`;
  },
  addCommands() {
    return {
      toggleCode:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-e': () => this.editor.commands.toggleCode() };
  },
  addInputRules() {
    return [markInputRule({ find: lastCodeSpan, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: allCodeSpans, type: this.type })];
  },
});
