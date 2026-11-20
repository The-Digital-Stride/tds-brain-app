/**
 * The kept block as the editor shows it: its markdown rendered read-only through the app's sanitising
 * `renderMarkdown` (decision 6). Kept apart from ./extensions.ts so Node scripts never load the DOM code.
 */
import { renderMarkdown } from '../markdown.tsx';
import { KeptBlock } from './extensions.ts';

// Each block's hint has its own id, so `aria-describedby` can point at it.
let hints = 0;

/**
 * A kept block's task items shown as ☐ and ☑ (the sanitiser drops checkbox inputs, so done and not done would
 * look the same). For showing only: the block's source is kept as it was. Lines in code fences are left alone.
 */
export function showTicks(source: string): string {
  let fence: string | null = null;
  return source
    .split('\n')
    .map((line) => {
      const f = /^[ \t>]*?(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (f && f[0] === fence[0] && f.length >= fence.length) fence = null;
        return line;
      }
      if (f) {
        fence = f;
        return line;
      }
      return line.replace(
        /^([ \t>]*[-+*][ \t]+)\[([ xX])\](?=[ \t]|$)/,
        (_m, lead: string, mark: string) => `${lead}${mark === ' ' ? '☐' : '☑'}`,
      );
    })
    .join('\n');
}

/**
 * The ☐ and ☑ of `showTicks` are shapes only, and screen readers say them differently or not at all: each is
 * hidden from them and "Not done" or "Done" is said instead.
 */
function speakTicks(root: HTMLElement): void {
  for (const li of root.querySelectorAll('li')) {
    const first = li.firstChild;
    const text = first?.nodeType === Node.TEXT_NODE ? (first.textContent ?? '') : '';
    const mark = text.startsWith('☑') ? 'Done' : text.startsWith('☐') ? 'Not done' : null;
    if (!mark || !first) continue;
    const shape = document.createElement('span');
    shape.setAttribute('aria-hidden', 'true');
    shape.textContent = text[0] as string;
    const said = document.createElement('span');
    said.className = 'visually-hidden';
    said.textContent = `${mark}: `;
    first.textContent = text.slice(1);
    li.insertBefore(said, first);
    li.insertBefore(shape, said);
  }
}

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
      body.innerHTML = renderMarkdown(showTicks(source));
      speakTicks(body);
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
