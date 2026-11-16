/**
 * The kept block as the editor shows it: its markdown rendered read-only through the app's sanitising
 * `renderMarkdown` (decision 6). Kept apart from ./extensions.ts so Node scripts never load the DOM code.
 */
import { renderMarkdown } from '../markdown.tsx';
import { KeptBlock } from './extensions.ts';

// Each block's hint has its own id, so `aria-describedby` can point at it.
let hints = 0;

export const KeptBlockView = KeptBlock.extend({
  addNodeView() {
    return ({ node }) => {
      const source = String(node.attrs.source ?? '');
      const dom = document.createElement('div');
      dom.className = 'todo-kept';
      dom.setAttribute('data-todo-kept', '');
      dom.setAttribute('contenteditable', 'false');
      const update = (next: typeof node) => next.type === node.type && next.attrs.source === source;
      // Only an HTML comment, such as the `<!-- -->` that keeps two lists apart: it shows nothing in markdown,
      // so nothing shows here either. The node stays, so the comment is saved as it was.
      if (/^(?:<!--[\s\S]*?-->\s*)+$/.test(source.trim())) {
        dom.hidden = true;
        dom.setAttribute('aria-hidden', 'true');
        return { dom, ignoreMutation: () => true, update };
      }
      // Focusable, so a keyboard can scroll a wide table and hear the hint (shown only while editing).
      dom.setAttribute('tabindex', '0');
      dom.setAttribute('role', 'group');
      dom.setAttribute('aria-label', 'Part kept as it is');
      const body = document.createElement('div');
      body.className = 'markdown';
      // Sanitised by renderMarkdown: unsafe links come out as plain text.
      body.innerHTML = renderMarkdown(source);
      const hint = document.createElement('p');
      hint.className = 'todo-note todo-kept-hint';
      hint.id = `todo-kept-hint-${++hints}`;
      hint.textContent = 'Edit this part in a chat.';
      dom.setAttribute('aria-describedby', hint.id);
      dom.append(body, hint);
      return {
        dom,
        ignoreMutation: () => true,
        update: (next) => next.type === node.type && next.attrs.source === source,
      };
    };
  },
});
