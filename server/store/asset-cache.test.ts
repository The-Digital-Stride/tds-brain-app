import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ASSET_CACHE_DIR,
  ASSET_FILE_MAX_BYTES,
  type AssetCache,
  type AssetFetcher,
  allowedAsset,
  createAssetCache,
  inlinePageAssets,
} from './asset-cache.ts';

const temp: string[] = [];
afterAll(() => {
  for (const d of temp.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dataDir(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'tba-assets-')));
  temp.push(d);
  return d;
}

/** A fake network: each address answers from `routes`; every request is logged. */
function fakeNet(routes: Record<string, () => Response | Promise<Response>>) {
  const log: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: AssetFetcher = async (url, init) => {
    log.push({ url, init });
    const r = routes[url];
    if (!r) return new Response('missing', { status: 404 });
    return r();
  };
  return { fetcher, log };
}

const ok =
  (body: string, headers: Record<string, string> = {}) =>
  () =>
    new Response(body, { status: 200, headers });
const redirect =
  (location: string, status = 302) =>
  () =>
    new Response(null, { status, headers: { location } });

describe('allowedAsset', () => {
  it('takes only https addresses on the listed hosts, on the default port, with no user name', () => {
    for (const url of [
      'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
      'https://cdn.jsdelivr.net/npm/chart.js@4',
      'https://unpkg.com/react@18/umd/react.production.min.js',
      'https://code.jquery.com/jquery-3.7.1.min.js',
      'https://cdn.tailwindcss.com',
      'https://cdn.tailwindcss.com:443/3.4.1',
    ]) {
      expect(allowedAsset(url, 'script')?.protocol, url).toBe('https:');
    }
    expect(allowedAsset('https://fonts.googleapis.com/css2?family=Inter', 'style')).not.toBeNull();
    expect(allowedAsset('https://fonts.gstatic.com/s/inter/v13/x.woff2', 'font')).not.toBeNull();
    for (const url of [
      'http://cdnjs.cloudflare.com/x.js',
      'https://cdnjs.cloudflare.com:8443/x.js',
      'https://user:pw@cdnjs.cloudflare.com/x.js',
      'https://user@unpkg.com/x.js',
      'https://cdn.jsdelivr.net/gh/someone/repo/x.js',
      'https://cdn.jsdelivr.net/npm/../gh/someone/x.js',
      'https://cdn.jsdelivr.net/npm/%2e%2e/gh/x.js',
      'https://cdnjs.cloudflare.com.evil.example/x.js',
      'https://evil.example/cdnjs.cloudflare.com/x.js',
      'https://127.0.0.1/x.js',
      'file:///etc/passwd',
      'data:text/javascript,alert(1)',
      'not a url',
      // The right host for another kind of file.
      'https://fonts.googleapis.com/css2?family=Inter',
    ]) {
      expect(allowedAsset(url, 'script'), url).toBeNull();
    }
    expect(allowedAsset('https://cdnjs.cloudflare.com/x.css', 'style')).toBeNull();
    expect(allowedAsset('https://fonts.googleapis.com/x.woff2', 'font')).toBeNull();
  });
});

describe('createAssetCache', () => {
  const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/lib/1.0/lib.min.js';

  it('fetches an address once, then answers from its own folder (0o700, files 0o600)', async () => {
    const dir = dataDir();
    const net = fakeNet({ [LIB]: ok('window.lib = 1;') });
    const cache = createAssetCache({ dataDir: dir, fetcher: net.fetcher });
    expect((await cache.get(LIB, 'script'))?.toString()).toBe('window.lib = 1;');
    expect(net.log).toHaveLength(1);
    expect(net.log[0]?.init?.redirect).toBe('manual');
    expect(net.log[0]?.init?.credentials).toBe('omit');
    expect(net.log[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    // A new cache on the same folder (the app restarted) with no network at all.
    const offline = createAssetCache({
      dataDir: dir,
      fetcher: async () => {
        throw new Error('offline');
      },
    });
    expect((await offline.get(LIB, 'script'))?.toString()).toBe('window.lib = 1;');
    const folder = join(dir, ASSET_CACHE_DIR);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    const files = readdirSync(folder);
    expect(files).toEqual([`${createHash('sha256').update(LIB).digest('hex')}.bin`]);
    expect(statSync(join(folder, files[0] as string)).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(folder, files[0] as string), 'utf8')).toBe('window.lib = 1;');
  });

  it('shares one fetch between two asks for the same address at once', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const net = fakeNet({
      [LIB]: async () => {
        await gate;
        return new Response('x');
      },
    });
    const cache = createAssetCache({ dataDir: dataDir(), fetcher: net.fetcher });
    const both = Promise.all([cache.get(LIB, 'script'), cache.get(LIB, 'script')]);
    release();
    expect((await both).map((b) => b?.toString())).toEqual(['x', 'x']);
    expect(net.log).toHaveLength(1);
  });

  it('refuses an address that is not allowed without asking the network', async () => {
    const net = fakeNet({});
    const cache = createAssetCache({ dataDir: dataDir(), fetcher: net.fetcher });
    expect(await cache.get('https://evil.example/x.js', 'script')).toBeNull();
    expect(await cache.get('http://unpkg.com/x.js', 'script')).toBeNull();
    expect(net.log).toEqual([]);
  });

  it('follows redirects only within the same host, and only a few', async () => {
    const pinned = 'https://unpkg.com/lib@1.2.3/dist/lib.js';
    const net = fakeNet({
      'https://unpkg.com/lib': redirect('/lib@1.2.3/dist/lib.js'),
      [pinned]: ok('pinned()'),
      'https://unpkg.com/away': redirect('https://cdnjs.cloudflare.com/x.js'),
      'https://cdnjs.cloudflare.com/x.js': ok('should not be reached'),
      'https://unpkg.com/plain': redirect('http://unpkg.com/plain'),
      'https://unpkg.com/loop': redirect('https://unpkg.com/loop', 301),
      'https://unpkg.com/nowhere': () => new Response(null, { status: 302 }),
    });
    const cache = createAssetCache({ dataDir: dataDir(), fetcher: net.fetcher });
    expect((await cache.get('https://unpkg.com/lib', 'script'))?.toString()).toBe('pinned()');
    expect(await cache.get('https://unpkg.com/away', 'script')).toBeNull();
    expect(await cache.get('https://unpkg.com/plain', 'script')).toBeNull();
    expect(await cache.get('https://unpkg.com/loop', 'script')).toBeNull();
    expect(await cache.get('https://unpkg.com/nowhere', 'script')).toBeNull();
    expect(net.log.map((l) => l.url)).not.toContain('https://cdnjs.cloudflare.com/x.js');
    expect(net.log.filter((l) => l.url === 'https://unpkg.com/loop').length).toBeLessThanOrEqual(6);
  });

  it('gives up after the timeout, and on an error answer, and keeps neither', async () => {
    const dir = dataDir();
    const net = fakeNet({
      'https://unpkg.com/slow': () => new Promise<Response>(() => {}),
      'https://unpkg.com/hang': () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('partial'));
            },
          }),
        ),
      'https://unpkg.com/gone': () => new Response('nope', { status: 500 }),
    });
    const fetcher: AssetFetcher = (url, init) =>
      url === 'https://unpkg.com/slow'
        ? new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          })
        : net.fetcher(url, init);
    const cache = createAssetCache({ dataDir: dir, fetcher, timeoutMs: 50 });
    const started = Date.now();
    expect(await cache.get('https://unpkg.com/slow', 'script')).toBeNull();
    expect(await cache.get('https://unpkg.com/hang', 'script')).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await cache.get('https://unpkg.com/gone', 'script')).toBeNull();
    let files: string[] = [];
    try {
      files = readdirSync(join(dir, ASSET_CACHE_DIR));
    } catch {}
    expect(files).toEqual([]);
  });

  it('refuses a file over the size cap, by its stated length or as it streams', async () => {
    const big = 'https://unpkg.com/big';
    const sneaky = 'https://unpkg.com/sneaky';
    const fits = 'https://unpkg.com/fits';
    const net = fakeNet({
      [big]: () => new Response('x', { headers: { 'content-length': String(ASSET_FILE_MAX_BYTES + 1) } }),
      [sneaky]: ok('y'.repeat(101)),
      [fits]: ok('z'.repeat(100)),
    });
    const cache = createAssetCache({ dataDir: dataDir(), fetcher: net.fetcher, fileMaxBytes: 100 });
    expect(await cache.get(big, 'script')).toBeNull();
    expect(await cache.get(sneaky, 'script')).toBeNull();
    expect((await cache.get(fits, 'script'))?.length).toBe(100);
  });

  it('carries on when the folder can’t be written', async () => {
    const net = fakeNet({ [LIB]: ok('still()') });
    const cache = createAssetCache({ dataDir: '/dev/null/nowhere', fetcher: net.fetcher });
    expect((await cache.get(LIB, 'script'))?.toString()).toBe('still()');
  });
});

describe('inlinePageAssets', () => {
  const CHART = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
  const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap';
  const WOFF = 'https://fonts.gstatic.com/s/inter/v13/inter-400.woff2';
  const TTF = 'https://fonts.gstatic.com/s/inter/v13/inter-700.ttf';
  const FONT_CSS = `@font-face{font-family:'Inter';font-weight:400;src:url(${WOFF}) format('woff2')}
@font-face{font-family:'Inter';font-weight:700;src:url("${TTF}") format('truetype')}`;

  /** A cache answering from `files`; every ask is logged. */
  function fakeCache(files: Record<string, string | Buffer>) {
    const asked: string[] = [];
    const cache: AssetCache = {
      async get(url) {
        asked.push(url);
        const f = files[url];
        return f === undefined ? null : Buffer.isBuffer(f) ? f : Buffer.from(f);
      },
    };
    return { cache, asked };
  }

  it('inlines an allowed script, escaping a closing tag inside it, and keeps its other attributes', async () => {
    const { cache } = fakeCache({ [CHART]: 'var s = "</script><!--<script>"; window.Chart = 1;' });
    const html = `<!doctype html><html><head><script id="lib" src="${CHART}" crossorigin="anonymous" referrerpolicy="no-referrer"></script></head><body><canvas></canvas><script>new Chart()</script></body></html>`;
    const out = await inlinePageAssets(html, cache);
    expect(out.selfContained).toBe(true);
    expect(out.html).toBe(
      '<!doctype html><html><head><script id="lib">var s = "<\\/script>\\x3C!--<script>"; window.Chart = 1;</script></head><body><canvas></canvas><script>new Chart()</script></body></html>',
    );
  });

  it('accepts a protocol-relative address and entities in the address', async () => {
    const url = 'https://unpkg.com/lib@1/x.js?a=1&b=2';
    const { cache, asked } = fakeCache({ [url]: 'x()' });
    const out = await inlinePageAssets(`<script src='//unpkg.com/lib@1/x.js?a=1&amp;b=2'></script>`, cache);
    expect(asked).toEqual([url]);
    expect(out.html).toBe('<script>x()</script>');
  });

  it('moves a deferred or async script to the end of the body, in order, as the browser would run it', async () => {
    const a = 'https://unpkg.com/a.js';
    const b = 'https://unpkg.com/b.js';
    const { cache } = fakeCache({ [a]: 'A()', [b]: 'B()' });
    const out = await inlinePageAssets(
      `<html><head><script defer src="${a}"></script><script async src="${b}"></script></head><body><div x-data></div></body></html>`,
      cache,
    );
    expect(out.html).toBe(
      '<html><head></head><body><div x-data></div><script>A()</script><script>B()</script></body></html>',
    );
    const noBody = await inlinePageAssets(`<script defer src="${a}"></script><p>x</p>`, cache);
    expect(noBody.html).toBe('<p>x</p><script>A()</script>');
  });

  it('leaves every later deferred script alone once one could not be inlined, so they still run in order', async () => {
    const a = 'https://unpkg.com/a.js';
    const b = 'https://unpkg.com/b.js';
    const c = 'https://unpkg.com/c.js';
    // a is in the cache; b is not (offline, budget spent); c, which may need b, must not jump ahead of it.
    const { cache } = fakeCache({ [a]: 'A()', [c]: 'C()' });
    const html = `<html><head><script defer src="${a}"></script><script defer src="${b}"></script><script defer src="${c}"></script></head><body></body></html>`;
    const out = await inlinePageAssets(html, cache);
    expect(out.html).toBe(
      `<html><head><script defer src="${b}"></script><script defer src="${c}"></script></head><body><script>A()</script></body></html>`,
    );
    expect(out.selfContained).toBe(false);
  });

  it('checks a script against its integrity value, and leaves it when it doesn’t match', async () => {
    const body = 'lib()';
    const good = `sha384-${createHash('sha384').update(body).digest('base64')}`;
    const { cache } = fakeCache({ [CHART]: body });
    const kept = await inlinePageAssets(
      `<script src="${CHART}" integrity="sha256-bad ${good}"></script>`,
      cache,
    );
    expect(kept.html).toBe('<script>lib()</script>');
    const tag = `<script src="${CHART}" integrity="sha384-AAAA"></script>`;
    const refused = await inlinePageAssets(tag, cache);
    expect(refused.html).toBe(tag);
    expect(refused.selfContained).toBe(false);
  });

  it('leaves what it may not or could not inline as it was, and says the page is only partly self-contained', async () => {
    const { cache, asked } = fakeCache({});
    const tags = [
      '<script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>',
      `<script src="${CHART}"></script>`,
      `<script type="module" src="https://unpkg.com/lit?module"></script>`,
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css">',
      `<link rel="stylesheet" href="${FONTS}">`,
      // Loaded later as a stylesheet or script (the preload-then-swap trick): still needs the internet.
      `<link rel="preload" as="style" href="${FONTS}" onload="this.rel='stylesheet'">`,
      `<link rel="modulepreload" href="https://unpkg.com/lit?module">`,
    ];
    for (const tag of tags) {
      const out = await inlinePageAssets(`<head>${tag}</head>`, cache);
      expect(out.html, tag).toBe(`<head>${tag}</head>`);
      expect(out.selfContained, tag).toBe(false);
    }
    // Only allowed addresses are ever asked for; a module script is never inlined.
    expect(asked).toEqual([CHART, FONTS]);
  });

  it('leaves local files, inline scripts and links that are not stylesheets alone, and calls that self-contained', async () => {
    const { cache, asked } = fakeCache({});
    const html =
      '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="icon" href="https://example.com/i.png">' +
      '<script src="local.js"></script><script>var u = "https://unpkg.com/x.js"</script><img src="https://example.com/a.png">';
    const out = await inlinePageAssets(html, cache);
    expect(out).toEqual({ html, selfContained: true });
    expect(asked).toEqual([]);
  });

  it('ignores tags inside comments and inside other scripts', async () => {
    const { cache, asked } = fakeCache({ [CHART]: 'c()' });
    const html = `<!-- <script src="${CHART}"></script> --><script>document.write('<script src="${CHART}"><\\/script>')</script>`;
    const out = await inlinePageAssets(html, cache);
    expect(out.html).toBe(html);
    expect(asked).toEqual([]);
  });

  it('turns a Google Fonts stylesheet into a style block with its fonts as data addresses', async () => {
    const woff = Buffer.from([1, 2, 3]);
    const ttf = Buffer.from([4, 5]);
    const { cache } = fakeCache({ [FONTS]: FONT_CSS, [WOFF]: woff, [TTF]: ttf });
    const out = await inlinePageAssets(
      `<head><link href="${FONTS.replace(/&/g, '&amp;')}" rel="stylesheet" media="screen"></head>`,
      cache,
    );
    expect(out.selfContained).toBe(true);
    expect(out.html).toBe(
      `<head><style media="screen">@font-face{font-family:'Inter';font-weight:400;src:url("data:font/woff2;base64,${woff.toString('base64')}") format('woff2')}
@font-face{font-family:'Inter';font-weight:700;src:url("data:font/ttf;base64,${ttf.toString('base64')}") format('truetype')}</style></head>`,
    );
  });

  it('inlines a Google Fonts @import in the page’s own style block', async () => {
    const woff = Buffer.from([9]);
    const { cache } = fakeCache({ [FONTS]: FONT_CSS, [WOFF]: woff, [TTF]: Buffer.from([8]) });
    const out = await inlinePageAssets(
      `<style>@import url('${FONTS}');\nbody{font-family:Inter}</style>`,
      cache,
    );
    expect(out.selfContained).toBe(true);
    expect(out.html).not.toContain('@import');
    expect(out.html).toContain(`data:font/woff2;base64,${woff.toString('base64')}`);
    expect(out.html).toContain('body{font-family:Inter}</style>');
  });

  it('keeps a font it could not fetch as its address, and says so', async () => {
    const { cache } = fakeCache({ [FONTS]: FONT_CSS, [WOFF]: Buffer.from([1]) });
    const out = await inlinePageAssets(`<link rel="stylesheet" href="${FONTS}">`, cache);
    expect(out.selfContained).toBe(false);
    expect(out.html).toContain('<style>');
    expect(out.html).toContain(`url("${TTF}")`);
  });

  it('stops inlining once the page budget is spent', async () => {
    const a = 'https://unpkg.com/a.js';
    const b = 'https://unpkg.com/b.js';
    const { cache } = fakeCache({ [a]: 'a'.repeat(60), [b]: 'b'.repeat(60) });
    const out = await inlinePageAssets(`<script src="${a}"></script><script src="${b}"></script>`, cache, {
      pageMaxBytes: 100,
    });
    expect(out.html).toBe(`<script>${'a'.repeat(60)}</script><script src="${b}"></script>`);
    expect(out.selfContained).toBe(false);
  });

  it('asks for at most a set number of files per page, and stops asking after the page’s time is up', async () => {
    const urls = ['a', 'b', 'c'].map((x) => `https://unpkg.com/${x}.js`);
    const { cache, asked } = fakeCache(Object.fromEntries(urls.map((u) => [u, 'x()'])));
    const html = urls.map((u) => `<script src="${u}"></script>`).join('');
    const capped = await inlinePageAssets(html, cache, { pageMaxFiles: 2 });
    expect(asked).toEqual(urls.slice(0, 2));
    expect(capped.html).toBe(`<script>x()</script><script>x()</script><script src="${urls[2]}"></script>`);
    expect(capped.selfContained).toBe(false);
    const late = await inlinePageAssets(html, cache, { pageTimeoutMs: -1 });
    expect(late).toEqual({ html, selfContained: false });
  });

  it('without a cache, changes nothing and says whether the page needs the internet', async () => {
    expect(await inlinePageAssets(`<script src="${CHART}"></script>`, null)).toEqual({
      html: `<script src="${CHART}"></script>`,
      selfContained: false,
    });
    expect(await inlinePageAssets('<p>Plain</p>', null)).toEqual({
      html: '<p>Plain</p>',
      selfContained: true,
    });
  });

  it('copes with broken markup without throwing', async () => {
    const { cache } = fakeCache({ [CHART]: 'c()' });
    for (const html of [
      '<script src="',
      '<script src=x',
      '<!-- open',
      '<style>',
      `<script src="${CHART}">`,
      '<',
    ]) {
      const out = await inlinePageAssets(html, cache);
      expect(typeof out.html).toBe('string');
    }
  });
});
