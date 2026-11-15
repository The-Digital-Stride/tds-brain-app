// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isLoopbackHost,
  LINK_SCRIPT_TAG,
  linkScriptOffset,
  openableLink,
  PAGE_LINK_SCRIPT,
  PAGE_WRAPPER_LINK_SCRIPT,
  withLinkScript,
} from './page-links.ts';
import { PAGE_LINK_URL_MAX } from './pages-contract.ts';

const TAG = LINK_SCRIPT_TAG;

/** Runs a script in a window the way a page does: as an inline script element. */
function runIn(win: Window, source: string): void {
  const el = win.document.createElement('script');
  el.textContent = source;
  win.document.head.append(el);
}

describe('withLinkScript', () => {
  it('puts the script right after a leading doctype', () => {
    expect(withLinkScript('<!DOCTYPE html><html><body>x</body></html>')).toBe(
      `<!DOCTYPE html>${TAG}<html><body>x</body></html>`,
    );
    expect(withLinkScript('<!doctype html>\n<p>x</p>')).toBe(`<!doctype html>${TAG}\n<p>x</p>`);
  });

  it('skips a BOM, spaces and comments before the doctype', () => {
    const before = '\uFEFF \n\t<!-- made by Claude --><!--x-->\r\n<!---->';
    expect(withLinkScript(`${before}<!DOCTYPE html><p>x</p>`)).toBe(`${before}<!DOCTYPE html>${TAG}<p>x</p>`);
  });

  it('knows the odd comment endings and bogus comments the tokenizer allows', () => {
    for (const before of [
      '<!-->',
      '<!--->',
      '<!-- a -- b --!>',
      '<?xml version="1.0"?>\n',
      '<!-- <!DOCTYPE x> -->',
    ]) {
      expect(withLinkScript(`${before}<!DOCTYPE html><p>`), before).toBe(`${before}<!DOCTYPE html>${TAG}<p>`);
    }
    // An unclosed comment hides the doctype.
    expect(linkScriptOffset('<!-- open <!DOCTYPE html>')).toBe(0);
  });

  it('keeps a doctype with a public identifier whole', () => {
    const dt = '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">';
    expect(withLinkScript(`${dt}<p>x</p>`)).toBe(`${dt}${TAG}<p>x</p>`);
  });

  it('starts a page without a doctype with the script (after a BOM)', () => {
    expect(withLinkScript('<h1>Fragment</h1>')).toBe(`${TAG}<h1>Fragment</h1>`);
    expect(withLinkScript('\uFEFF<h1>x</h1>')).toBe(`\uFEFF${TAG}<h1>x</h1>`);
    // A doctype after content is no longer a leading one.
    expect(withLinkScript('<p>a</p><!DOCTYPE html>')).toBe(`${TAG}<p>a</p><!DOCTYPE html>`);
    expect(withLinkScript('')).toBe(TAG);
  });

  it('stays quick on long runs of spaces or comments with no doctype after them', () => {
    const started = performance.now();
    expect(linkScriptOffset(`${' '.repeat(64 * 1024)}<p>`)).toBe(0);
    expect(linkScriptOffset(`${'<!-- -->\n'.repeat(6000)}<p>`)).toBe(0);
    expect(linkScriptOffset(`<!-- ${'-'.repeat(64 * 1024)}`)).toBe(0);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('finds the offset in a byte-for-byte (latin1) reading too, BOM included', () => {
    const page = '\u00EF\u00BB\u00BF <!DOCTYPE html><p>x</p>';
    expect(linkScriptOffset(page)).toBe(page.indexOf('<p>'));
    expect(linkScriptOffset('\u00EF\u00BB\u00BF<p>')).toBe(3);
  });
});

describe('the link script', () => {
  it('holds no closing script tag or address, so it can sit inline anywhere', () => {
    for (const s of [PAGE_LINK_SCRIPT, PAGE_WRAPPER_LINK_SCRIPT]) {
      expect(s).not.toMatch(/<\/script/i);
      expect(s).not.toMatch(/https?:\/\/|\/\/[a-z]/i);
    }
  });

  it('posts only the one message type, and nothing else', () => {
    expect(PAGE_LINK_SCRIPT.match(/postMessage\(/g)).toHaveLength(1);
    expect(PAGE_LINK_SCRIPT).toContain("type: 'tds-page-open-link'");
    expect(PAGE_LINK_SCRIPT).not.toMatch(/fetch\(|XMLHttpRequest|window\.open|location\s*=/);
  });
});

describe('the link script in a page', () => {
  let posted: { data: unknown; target: string }[];
  let frame: HTMLIFrameElement;
  let win: Window & typeof globalThis;
  let doc: Document;

  beforeEach(() => {
    posted = [];
    frame = document.createElement('iframe');
    document.body.append(frame);
    win = frame.contentWindow as Window & typeof globalThis;
    doc = win.document;
    // Catch what the frame sends its parent (jsdom's own window, not the test's global).
    vi.spyOn(win.parent, 'postMessage').mockImplementation(((data: unknown, target: string) => {
      posted.push({ data, target });
    }) as typeof window.postMessage);
    runIn(win, PAGE_LINK_SCRIPT);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    frame.remove();
  });

  function click(html: string, init: MouseEventInit = {}): MouseEvent {
    doc.body.innerHTML = html;
    const target = doc.querySelector('[data-hit]') ?? doc.body.firstElementChild;
    const e = new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    target?.dispatchEvent(e);
    return e;
  }

  it('sends a plain or target="_blank" link to the parent and stops the frame moving', () => {
    const e = click('<a href="https://example.com/a?b=1">x</a>');
    expect(e.defaultPrevented).toBe(true);
    expect(posted).toEqual([
      { data: { type: 'tds-page-open-link', url: 'https://example.com/a?b=1' }, target: '*' },
    ]);
    click('<a target="_blank" href="http://example.org"><span data-hit>y</span></a>');
    expect(posted[1]?.data).toEqual({ type: 'tds-page-open-link', url: 'http://example.org/' });
  });

  it('takes an image-map area and a modified click (opened by the app, not the frame)', () => {
    click('<map name="m"><area data-hit href="https://example.com/area"></map>');
    click('<a href="https://example.com/ctrl">x</a>', { ctrlKey: true });
    click('<a href="https://example.com/meta">x</a>', { metaKey: true });
    expect(posted.map((p) => (p.data as { url: string }).url)).toEqual([
      'https://example.com/area',
      'https://example.com/ctrl',
      'https://example.com/meta',
    ]);
  });

  it('leaves # links, other schemes, the page’s own site and non-primary buttons alone', () => {
    const cases = [
      '<a href="#top">x</a>',
      '<a href="  #x">x</a>',
      '<a href="">x</a>',
      '<a href="javascript:void 0">x</a>',
      '<a href="mailto:a@b.com">x</a>',
      '<a href="data:text/html,hi">x</a>',
      '<a>no href</a>',
      `<a href="${window.location.origin}/elsewhere">same site</a>`,
    ];
    for (const html of cases) {
      const e = click(html);
      expect(e.defaultPrevented, html).toBe(false);
    }
    expect(click('<a href="https://example.com">x</a>', { button: 1 }).defaultPrevented).toBe(false);
    expect(posted).toEqual([]);
  });

  it('does nothing for a click another handler already cancelled', () => {
    doc.body.innerHTML = '<a href="https://example.com">x</a>';
    win.addEventListener('click', (ev) => ev.preventDefault(), true);
    doc.querySelector('a')?.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(posted).toEqual([]);
  });
});

describe('openableLink', () => {
  const APP = 'http://127.0.0.1:3878';
  const msg = (url: unknown) => ({ type: 'tds-page-open-link', url });

  it('accepts an http(s) address and gives back the parsed one', () => {
    expect(openableLink(msg('https://example.com/a b'), APP)?.href).toBe('https://example.com/a%20b');
    expect(openableLink(msg('http://example.org'), APP)?.href).toBe('http://example.org/');
  });

  it('refuses everything else', () => {
    const bad: unknown[] = [
      null,
      'https://example.com',
      { url: 'https://example.com' },
      { type: 'other', url: 'https://example.com' },
      msg(42),
      msg('javascript:alert(1)'),
      msg('data:text/html,hi'),
      msg('file:///etc/passwd'),
      msg('/relative'),
      msg('not a url'),
      msg(`${APP}/api/bootstrap`),
      msg('https://user:pass@example.com/'),
      msg('https://user@example.com/'),
      msg(`https://example.com/${'a'.repeat(PAGE_LINK_URL_MAX)}`),
      msg('http://localhost:3878/'),
      msg('http://LOCALHOST./'),
      msg('http://app.localhost/'),
      msg('http://127.0.0.1/'),
      msg('http://127.1/'),
      msg('http://2130706433/'),
      msg('http://0x7f.0.0.1/'),
      msg('http://[::1]/'),
      msg('http://[0:0:0:0:0:0:0:1]/'),
      msg('http://[::ffff:127.0.0.1]/'),
      msg('http://0.0.0.0/'),
      msg('http://0/'),
    ];
    for (const d of bad) expect(openableLink(d, APP), JSON.stringify(d)).toBeNull();
  });

  it('allows an address of exactly the limit', () => {
    const base = 'https://example.com/';
    const url = base + 'a'.repeat(PAGE_LINK_URL_MAX - base.length);
    expect(openableLink(msg(url), APP)?.href).toBe(url);
  });

  it('knows loopback names', () => {
    for (const h of ['localhost', 'a.localhost', '127.9.9.9', '[::1]', '[::]', '0.0.0.0'])
      expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ['example.com', 'localhost.example.com', '128.0.0.1', '[2001:db8::1]', '10.0.0.1'])
      expect(isLoopbackHost(h), h).toBe(false);
  });
});

describe('the branded wrapper’s listener', () => {
  // jsdom's own top window, where an inline script runs (the test's global only mirrors it).
  const top = document.defaultView as Window & typeof globalThis;
  let inner: HTMLIFrameElement;
  let opened: unknown[][];
  let forwarded: unknown[];

  beforeEach(() => {
    opened = [];
    forwarded = [];
    document.body.innerHTML = '<iframe class="page"></iframe>';
    inner = document.querySelector('iframe.page') as HTMLIFrameElement;
    vi.spyOn(top, 'open').mockImplementation((...args: unknown[]) => {
      opened.push(args);
      return null;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function run(): void {
    // Each test runs the script fresh against the frame in place. jsdom runs no script elements in
    // the top document, so the test evaluates the wrapper's fixed script itself.
    top.eval(PAGE_WRAPPER_LINK_SCRIPT);
  }
  function send(data: unknown, source: Window | null = inner.contentWindow): void {
    top.dispatchEvent(new top.MessageEvent('message', { data, source }));
  }

  it('opens a checked link in a new tab when it is a file on its own', () => {
    run();
    send({ type: 'tds-page-open-link', url: 'https://example.com/x' });
    expect(opened).toEqual([['https://example.com/x', '_blank', 'noopener,noreferrer']]);
  });

  it('ignores other windows, bad data and refused addresses', () => {
    run();
    send({ type: 'tds-page-open-link', url: 'https://example.com/x' }, top);
    for (const url of [
      'javascript:alert(1)',
      'https://u:p@example.com/',
      'http://localhost/',
      'http://[::1]/',
      `https://example.com/${'a'.repeat(PAGE_LINK_URL_MAX)}`,
    ])
      send({ type: 'tds-page-open-link', url });
    send({ type: 'other', url: 'https://example.com/' });
    send('https://example.com/');
    expect(opened).toEqual([]);
  });

  it('forwards to its own parent when it is itself framed', () => {
    const outer = document.createElement('iframe');
    document.body.append(outer);
    const w = outer.contentWindow as Window & typeof globalThis;
    w.document.body.innerHTML = '<iframe class="page"></iframe>';
    const innerWin = (w.document.querySelector('iframe.page') as HTMLIFrameElement).contentWindow;
    const winOpen = vi.spyOn(w, 'open');
    vi.spyOn(w.parent, 'postMessage').mockImplementation(((data: unknown) => {
      forwarded.push(data);
    }) as typeof window.postMessage);
    runIn(w, PAGE_WRAPPER_LINK_SCRIPT);
    w.dispatchEvent(
      new w.MessageEvent('message', {
        data: { type: 'tds-page-open-link', url: 'https://example.com' },
        source: innerWin,
      }),
    );
    expect(forwarded).toEqual([{ type: 'tds-page-open-link', url: 'https://example.com/' }]);
    expect(winOpen).not.toHaveBeenCalled();
  });
});
