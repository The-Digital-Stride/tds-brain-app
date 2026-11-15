import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { HELP_LINK_ATTR, type RenderHelp } from './contract.ts';
import { helpLibrary } from './library.ts';

const UNWRAP = 'data-unwrap';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Builds a renderer. `hasTopic` says which `help:<id>` links are real pages. Its own Marked and DOMPurify
 * instances are used, so markdown.tsx's global hooks never see help and help's never see chat text.
 */
export function createRenderHelp(hasTopic: (id: string) => boolean): RenderHelp {
  let purify: ReturnType<typeof DOMPurify> | null = null;
  // The render in progress: the links and pictures this render itself made (anything else is not trusted).
  let issued = { links: new Set<string>(), images: new Set<string>() };
  let mapImage: (src: string) => string | null = () => null;

  const md = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const level = Math.min(6, Math.max(4, depth + 2));
        return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (!href.startsWith('help:')) return false;
        const id = href.slice(5);
        if (!hasTopic(id)) return inner;
        issued.links.add(id);
        return `<a href="#help-${esc(id)}" ${HELP_LINK_ATTR}="${esc(id)}">${inner}</a>`;
      },
      image({ href, text }) {
        const url = mapImage(href);
        if (!url) return '';
        issued.images.add(url);
        return `<img src="${esc(url)}" alt="${esc(text)}" loading="lazy">`;
      },
    },
  });

  function instance() {
    if (purify) return purify;
    const p = DOMPurify(window);
    p.addHook('afterSanitizeAttributes', (node) => {
      const tag = node.nodeName.toLowerCase();
      if (tag === 'img') {
        if (!issued.images.has(node.getAttribute('src') ?? '')) node.remove();
        return;
      }
      if (tag !== 'a') return;
      const href = node.getAttribute('href') ?? '';
      const helpId = node.getAttribute(HELP_LINK_ATTR);
      node.removeAttribute('target');
      node.removeAttribute('rel');
      if (helpId !== null) {
        if (issued.links.has(helpId) && href === `#help-${helpId}`) return;
        node.removeAttribute(HELP_LINK_ATTR);
        node.removeAttribute('href');
        node.setAttribute(UNWRAP, '');
        return;
      }
      if (/^https?:/i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
        return;
      }
      node.removeAttribute('href');
      node.setAttribute(UNWRAP, '');
    });
    purify = p;
    return p;
  }

  return (body, imageUrl) => {
    issued = { links: new Set(), images: new Set() };
    mapImage = imageUrl;
    try {
      const html = md.parse(body, { async: false, gfm: true }) as string;
      const clean = instance().sanitize(html, {
        FORBID_TAGS: [
          'style',
          'form',
          'input',
          'button',
          'textarea',
          'select',
          'iframe',
          'object',
          'embed',
          'svg',
          'math',
        ],
        ALLOWED_ATTR: [
          'href',
          'title',
          'alt',
          'src',
          'start',
          'colspan',
          'rowspan',
          'loading',
          HELP_LINK_ATTR,
        ],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
      });
      return unwrapMarked(clean);
    } finally {
      mapImage = () => null;
    }
  };
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

export const renderHelp: RenderHelp = createRenderHelp((id) => helpLibrary.byId(id) !== undefined);
