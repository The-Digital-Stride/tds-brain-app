import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { memo, useMemo } from 'react';
import { CHAT_FILE_HREF_PREFIX } from '../../shared/chat-files.ts';

/** Maps a raw path from reply text to a chat file's key, or null when it is not one of the chat's files. */
export type FileLinker = (raw: string) => string | null;

// The render in progress. DOMPurify hooks are global, so the hook reads this; set and cleared by renderMarkdown.
interface RenderContext {
  link: FileLinker;
  issued: Set<string>;
}
let current: RenderContext | null = null;

const UNWRAP = 'data-unwrap';

// Added once. After sanitising, so raw HTML in a reply cannot skip it:
// - a chat-file link survives only if this render issued exactly that href (and has no target);
// - http, https and mailto links open in a new tab and cannot reach back to this page;
// - every other link is marked, and renderMarkdown unwraps it to its text.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'A') return;
  const href = node.getAttribute('href') ?? '';
  node.removeAttribute('target');
  node.removeAttribute('rel');
  if (current?.issued.has(href)) return;
  if (/^(https?:|mailto:)/i.test(href)) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
    return;
  }
  node.removeAttribute('href');
  node.setAttribute(UNWRAP, '');
});

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fileHref(ctx: RenderContext, raw: string): string | null {
  const key = ctx.link(raw);
  if (key === null) return null;
  const href = `${CHAT_FILE_HREF_PREFIX}${encodeURIComponent(key)}`;
  ctx.issued.add(href);
  return href;
}

// Local instance: the global `marked` is left alone. Returning false falls back to the default renderer.
let inLink = false;
const md = new Marked({
  renderer: {
    link({ href, tokens }) {
      const ctx = current;
      const target = ctx ? fileHref(ctx, href) : null;
      if (!target) return false;
      inLink = true;
      try {
        return `<a href="${esc(target)}">${this.parser.parseInline(tokens)}</a>`;
      } finally {
        inLink = false;
      }
    },
    codespan({ text }) {
      const ctx = current;
      const target = ctx && !inLink ? fileHref(ctx, text) : null;
      if (!target) return false;
      return `<a href="${esc(target)}"><code>${esc(text)}</code></a>`;
    },
  },
});

export function renderMarkdown(text: string, link?: FileLinker): string {
  const ctx: RenderContext = { link: link ?? (() => null), issued: new Set() };
  current = ctx;
  try {
    const html = md.parse(text, { async: false, gfm: true }) as string;
    const clean = DOMPurify.sanitize(html, {
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
      // An allow list: no class or id, so a reply cannot borrow the app's own look.
      ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'start', 'colspan', 'rowspan'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    });
    return unwrapMarked(clean);
  } finally {
    current = null;
  }
}

// Replaces each link the hook marked with its children. Only removes elements, so the result stays clean.
function unwrapMarked(html: string): string {
  if (!html.includes(UNWRAP)) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  for (const a of Array.from(tpl.content.querySelectorAll(`a[${UNWRAP}]`)))
    a.replaceWith(...Array.from(a.childNodes));
  return tpl.innerHTML;
}

/**
 * The only place text from the server is shown as markup, and only assistant text goes through it.
 * Everything else the server sends is plain React text.
 * `link` turns a path in the text into a chat file key; clicking such a link calls `onFile` with the key.
 */
export const Markdown = memo(function Markdown({
  text,
  link,
  onFile,
}: {
  text: string;
  link?: FileLinker;
  onFile?: (key: string) => void;
}) {
  const html = useMemo(() => renderMarkdown(text, link), [text, link]);
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = (e.target as Element).closest?.(`a[href^="${CHAT_FILE_HREF_PREFIX}"]`);
    if (!a) return;
    e.preventDefault();
    const raw = (a.getAttribute('href') ?? '').slice(CHAT_FILE_HREF_PREFIX.length);
    let key = raw;
    try {
      key = decodeURIComponent(raw);
    } catch {
      // Keep the text as it is.
    }
    onFile?.(key);
  };
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: the HTML is sanitised by renderMarkdown above.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the links inside are real anchors, which handle the keyboard.
    // biome-ignore lint/a11y/noStaticElementInteractions: click delegation for those anchors.
    <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} onClick={onClick} />
  );
});
