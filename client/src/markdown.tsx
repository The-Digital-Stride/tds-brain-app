import DOMPurify from 'dompurify';
import { marked } from 'marked';

// Added once. Every link in assistant text opens in a new tab and cannot reach back to this page.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true }) as string;
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
    // An allow list: no class or id, so a reply cannot borrow the app's own look.
    ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'start', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

/**
 * The only place text from the server is shown as markup, and only assistant text goes through it.
 * Everything else the server sends is plain React text.
 */
export function Markdown({ text }: { text: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: the HTML is sanitised by renderMarkdown above.
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}
