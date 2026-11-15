/**
 * Links in a page open in a new tab (plan 2026-11-15-pages-hardening, decision 1). A page runs in a
 * sandboxed frame that may not move to another site, so a plain link click used to trip the frame's
 * policy and show the stop notice. The server adds PAGE_LINK_SCRIPT to every page it serves (never to
 * the stored bytes); the script turns a click on an http(s) link into one `PageOpenLinkMessage` to the
 * frame's parent, and the app opens it after its own checks (`usePageLinks`, `openableLink`).
 *
 * No node: imports: this file is shared with the browser.
 */
import { PAGE_LINK_URL_MAX, type PageOpenLinkMessage } from './pages-contract.ts';

const OPEN_LINK: PageOpenLinkMessage['type'] = 'tds-page-open-link';

/**
 * A loopback host name as `URL` gives it (lowercased, IPv4 numbers normalised, IPv6 in brackets and
 * compressed), with any trailing dots taken off first: `localhost` and `*.localhost`, `127.0.0.0/8`,
 * `0.0.0.0/8`, `[::1]`, `[::]`, and those IPv4 ranges written as IPv6 (`[::ffff:7f00:1]`, `[::7f00:1]`).
 */
const LOOPBACK =
  /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|0(?:\.\d{1,3}){3}|\[(?:::1?|::ffff:(?:7f[0-9a-f]{2}|[0-9a-f]{1,2}):[0-9a-f]{1,4}|::7f[0-9a-f]{2}:[0-9a-f]{1,4})\])$/;

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.test(hostname.toLowerCase().replace(/\.+$/, ''));
}

/**
 * The app's check on a link message's content (the caller checks who sent it and that it came from a
 * click): a `PageOpenLinkMessage` whose address parses on its own, is `http:` or `https:`, has no user
 * name or password, is at most PAGE_LINK_URL_MAX characters (as sent and as parsed), and is neither the
 * app's own origin nor a loopback host. Gives back the parsed address to open, or null.
 */
export function openableLink(data: unknown, appOrigin: string): URL | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, url } = data as Partial<Record<keyof PageOpenLinkMessage, unknown>>;
  if (type !== OPEN_LINK || typeof url !== 'string' || url.length > PAGE_LINK_URL_MAX) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password || parsed.href.length > PAGE_LINK_URL_MAX) return null;
  if (parsed.origin === appOrigin || isLoopbackHost(parsed.hostname)) return null;
  return parsed;
}

/**
 * Runs in the page. One capture-phase `click` listener on the document: for a primary-button click on
 * an `a[href]` or `area[href]` (inside shadow roots too) whose address resolves to `http:`/`https:`
 * on another site, it stops the frame moving and posts `{ type, url }` to the parent. Modified clicks
 * (Ctrl, Cmd, Shift) are taken too, so they still open a tab, through the app rather than as a
 * sandboxed pop-up. Left alone: `#` and empty links, other schemes (`javascript:`, `mailto:`), links
 * to the page's own site, other buttons, and a page shown on its own (not framed). It listens on the
 * window in the bubble phase, after the page's own handlers: a click the page cancels is left to the
 * page, and one it stops from bubbling falls back to the frame's stop notice (review: correctness). No comments or addresses inside: it is served inline.
 */
export const PAGE_LINK_SCRIPT = `(function () {
  if (window.parent === window) return;
  var own = '';
  try { own = new URL(document.baseURI).origin; } catch (err) {}
  window.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    var path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    var a = null;
    for (var i = 0; i < path.length; i++) {
      var n = path[i];
      if (n && n.nodeType === 1 && (n.localName === 'a' || n.localName === 'area') && n.hasAttribute('href')) { a = n; break; }
    }
    if (!a) return;
    var raw = String(a.getAttribute('href')).trim();
    if (raw === '' || raw.charAt(0) === '#') return;
    var u;
    try { u = new URL(raw, document.baseURI); } catch (err) { return; }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.origin === own) return;
    e.preventDefault();
    window.parent.postMessage({ type: '${OPEN_LINK}', url: u.href }, '*');
  });
})();`;

export const LINK_SCRIPT_TAG = `<script>${PAGE_LINK_SCRIPT}</script>`;

/**
 * Runs in the branded copy's wrapper (`brandedPage`). It takes a link message only from its own page
 * frame, makes the same address checks as `openableLink` (the wrapper has no app origin of its own),
 * then passes the message up when the wrapper is itself framed (in the app, whose own checks decide)
 * or, as a file opened on its own, opens the address in a new tab after a click.
 */
export const PAGE_WRAPPER_LINK_SCRIPT = String.raw`(function () {
  var frame = document.querySelector('iframe.page');
  var loopback = new RegExp(${JSON.stringify(LOOPBACK.source)});
  window.addEventListener('message', function (e) {
    if (!frame || !e.source || e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || typeof d !== 'object' || d.type !== '${OPEN_LINK}' || typeof d.url !== 'string' || d.url.length > ${PAGE_LINK_URL_MAX}) return;
    var u;
    try { u = new URL(d.url); } catch (err) { return; }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || u.href.length > ${PAGE_LINK_URL_MAX}) return;
    if (loopback.test(u.hostname.toLowerCase().replace(/\.+$/, ''))) return;
    if (window.parent !== window) {
      window.parent.postMessage({ type: '${OPEN_LINK}', url: u.href }, '*');
      return;
    }
    var act = navigator.userActivation;
    if (act && !act.isActive) return;
    window.open(u.href, '_blank', 'noopener,noreferrer');
  });
})();`;

/** A BOM as one character, or as its three bytes read as latin1. */
const BOMS = ['\uFEFF', '\u00EF\u00BB\u00BF'];
const SPACE = /[\t\n\f\r ]/;
const DOCTYPE = /^<!doctype\b[^>]*>/i;

/** Where a comment that starts at `i` ends (just past it), or -1 if it never does. */
function commentEnd(html: string, i: number): number {
  // `<!-->` and `<!--->` are whole (if odd) comments.
  if (html.startsWith('<!-->', i)) return i + 5;
  if (html.startsWith('<!--->', i)) return i + 6;
  const close = html.indexOf('--', i + 4);
  for (let at = close; at !== -1; at = html.indexOf('--', at + 1)) {
    if (html.startsWith('-->', at)) return at + 3;
    if (html.startsWith('--!>', at)) return at + 4;
  }
  return -1;
}

/**
 * Where the link script goes: right after a leading doctype, so the page stays in standards mode,
 * otherwise at the start (after a BOM). Before the doctype the HTML tokenizer's initial state allows a
 * BOM, ASCII whitespace, comments (`<!-->`, `<!--->` and `--!>` endings included) and `<?…>` bogus
 * comments; anything else means there is no leading doctype. Works on a latin1 reading of the bytes
 * too, where the offset is then a byte offset. Linear in the length.
 */
export function linkScriptOffset(html: string): number {
  const bom = BOMS.find((b) => html.startsWith(b))?.length ?? 0;
  let i = bom;
  while (i < html.length) {
    const c = html[i] ?? '';
    if (SPACE.test(c)) {
      i += 1;
    } else if (html.startsWith('<!--', i)) {
      const end = commentEnd(html, i);
      if (end === -1) return bom;
      i = end;
    } else if (html.startsWith('<?', i)) {
      const end = html.indexOf('>', i);
      if (end === -1) return bom;
      i = end + 1;
    } else {
      const doctype = DOCTYPE.exec(html.slice(i, i + 4096));
      return doctype ? i + doctype[0].length : bom;
    }
  }
  return bom;
}

/** The page as served: the link script added at `linkScriptOffset`. Call only when serving a page. */
export function withLinkScript(html: string): string {
  const at = linkScriptOffset(html);
  return html.slice(0, at) + LINK_SCRIPT_TAG + html.slice(at);
}
