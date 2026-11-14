/**
 * Makes a TDS-branded copy self-contained (plan docs/plans/2026-11-14-artifacts-in-app.md, R8): what a
 * page loads from the sources the preview allows is fetched once, kept in `<dataDir>/asset-cache/`, and
 * written into the page, so the copy a client gets works offline in any browser.
 *
 * - `<script src>` from cdnjs.cloudflare.com, cdn.jsdelivr.net/npm/, unpkg.com, code.jquery.com and
 *   cdn.tailwindcss.com becomes an inline `<script>` (any `</script` inside escaped). A `defer` or
 *   `async` one moves to the end of the body, where the browser would have run it.
 * - `<link rel="stylesheet">` from fonts.googleapis.com (and an `@import` of one in the page's own
 *   `<style>`) becomes `<style>`, each fonts.gstatic.com font in it a `data:` address.
 * - Anything else, or anything that fails, is left exactly as it was, and the page is reported as only
 *   partly self-contained.
 *
 * The fetch is the outbound edge of the app, so it is kept narrow: https only, exactly those hosts on
 * the default port, no user name or password in the address, no cookies, redirects followed by hand and
 * only within the same host, 10 seconds per file, 5 MB per file and 25 MB per page (and at most 100
 * files and 60 seconds per page, so a page can't stall the download). Cache files are named
 * by a hash of the address (never the address itself): folder 0o700, files 0o600, written atomically.
 */
import { createHash, randomBytes } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';

export const ASSET_CACHE_DIR = 'asset-cache';
export const ASSET_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const ASSET_PAGE_MAX_BYTES = 25 * 1024 * 1024;
export const ASSET_TIMEOUT_MS = 10_000;
/** Files one page may ask for, and how long one page may spend asking, so a page can't stall a download. */
export const ASSET_PAGE_MAX_FILES = 100;
export const ASSET_PAGE_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;

export type AssetKind = 'script' | 'style' | 'font';

/** `fetch`'s shape; tests pass a fake so no test touches the network. */
export type AssetFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface AssetCache {
  /** The file at an allowed address, from the cache or fetched (and then kept); null when refused or failed. */
  get(url: string, kind: AssetKind): Promise<Buffer | null>;
}

export interface AssetCacheOptions {
  dataDir: string;
  /** Defaults to the global `fetch`. */
  fetcher?: AssetFetcher;
  timeoutMs?: number;
  fileMaxBytes?: number;
}

/** Hosts per kind of file; `paths` limits a host to addresses under these path prefixes. */
const HOSTS: Record<AssetKind, { host: string; paths?: string[] }[]> = {
  script: [
    { host: 'cdnjs.cloudflare.com' },
    { host: 'cdn.jsdelivr.net', paths: ['/npm/'] },
    { host: 'unpkg.com' },
    { host: 'code.jquery.com' },
    { host: 'cdn.tailwindcss.com' },
  ],
  style: [{ host: 'fonts.googleapis.com' }],
  font: [{ host: 'fonts.gstatic.com' }],
};

/** The address as a URL when it may be fetched for `kind`, else null. Reads nothing. */
export function allowedAsset(raw: string, kind: AssetKind): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return null;
  const rule = HOSTS[kind].find((h) => h.host === url.hostname);
  if (!rule) return null;
  if (rule.paths && !rule.paths.some((p) => url.pathname.startsWith(p))) return null;
  url.hash = '';
  return url;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function createAssetCache(opts: AssetCacheOptions): AssetCache {
  const dir = join(resolve(opts.dataDir), ASSET_CACHE_DIR);
  const fetcher: AssetFetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? ASSET_TIMEOUT_MS;
  const maxBytes = opts.fileMaxBytes ?? ASSET_FILE_MAX_BYTES;
  const inFlight = new Map<string, Promise<Buffer | null>>();

  const fileFor = (href: string) => join(dir, `${createHash('sha256').update(href).digest('hex')}.bin`);

  async function readCached(path: string): Promise<Buffer | null> {
    let handle: fs.FileHandle | null = null;
    try {
      handle = await fs.open(path, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
      const st = await handle.stat();
      if (!st.isFile() || st.size > maxBytes) return null;
      const buf = Buffer.alloc(st.size);
      let got = 0;
      while (got < buf.length) {
        const { bytesRead } = await handle.read(buf, got, buf.length - got, got);
        if (bytesRead === 0) break;
        got += bytesRead;
      }
      return got === buf.length ? buf : null;
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async function writeCached(path: string, data: Buffer): Promise<void> {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(dir, 0o700);
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tmp, data, { mode: 0o600, flag: 'wx' });
      await fs.rename(tmp, path);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  }

  /** The body, read up to the cap, before the deadline; null when over either. */
  async function readBody(res: Response, signal: AbortSignal): Promise<Buffer | null> {
    const stated = Number(res.headers.get('content-length'));
    if (Number.isFinite(stated) && stated > maxBytes) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    if (!res.body) return Buffer.alloc(0);
    const reader = res.body.getReader();
    const onAbort = () => {
      reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (signal.aborted) return null;
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(Buffer.from(value));
      }
    } catch {
      return null;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    return Buffer.concat(chunks, total);
  }

  async function download(start: URL, kind: AssetKind): Promise<Buffer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let url = start;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const res = await fetcher(url.href, {
          redirect: 'manual',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
          headers: { accept: '*/*' },
        });
        if (REDIRECT_STATUSES.has(res.status)) {
          await res.body?.cancel().catch(() => {});
          const location = res.headers.get('location');
          if (!location) return null;
          let next: URL;
          try {
            next = new URL(location, url);
          } catch {
            return null;
          }
          const checked = allowedAsset(next.href, kind);
          if (!checked || checked.hostname !== start.hostname) return null;
          url = checked;
          continue;
        }
        if (res.status !== 200) {
          await res.body?.cancel().catch(() => {});
          return null;
        }
        return await readBody(res, controller.signal);
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function load(url: URL, kind: AssetKind): Promise<Buffer | null> {
    const path = fileFor(url.href);
    const cached = await readCached(path);
    if (cached) return cached;
    const data = await download(url, kind);
    if (!data) return null;
    await writeCached(path, data).catch(() => {});
    return data;
  }

  return {
    get(raw, kind) {
      const url = allowedAsset(raw, kind);
      if (!url) return Promise.resolve(null);
      const id = `${kind} ${url.href}`;
      const running = inFlight.get(id);
      if (running) return running;
      const job = load(url, kind).finally(() => inFlight.delete(id));
      inFlight.set(id, job);
      return job;
    },
  };
}

// -- inlining ------------------------------------------------------------------------------------

interface Attr {
  name: string;
  value: string | null;
}

interface Tag {
  name: string;
  attrs: Attr[];
  /** Index just past the tag's `>`. */
  end: number;
}

/** Elements whose content is raw text: nothing inside is a tag. */
const RAW_TEXT = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
]);
/** Dropped from an inlined script: they mean nothing (or something wrong) without `src`. */
const SCRIPT_DROPPED = new Set([
  'src',
  'integrity',
  'crossorigin',
  'defer',
  'async',
  'referrerpolicy',
  'fetchpriority',
  'charset',
]);
const JS_TYPE = /^(?:(?:text|application)\/(?:x-)?(?:java|ecma)script|text\/jscript|text\/livescript)$/i;
const REMOTE = /^\s*(?:https?:)?\/\//i;

/** Opening tag at `at` (`html[at] === '<'`), or null when it never closes. */
function parseTag(html: string, at: number): Tag | null {
  const m = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(html.slice(at, at + 64));
  if (!m?.[1]) return null;
  const attrs: Attr[] = [];
  let i = at + m[0].length;
  for (;;) {
    while (i < html.length && /[\s/]/.test(html[i] as string)) i++;
    if (i >= html.length) return null;
    if (html[i] === '>') return { name: m[1].toLowerCase(), attrs, end: i + 1 };
    const start = i;
    i++;
    while (i < html.length && !/[\s/>=]/.test(html[i] as string)) i++;
    const name = html.slice(start, i).toLowerCase();
    while (i < html.length && /\s/.test(html[i] as string)) i++;
    if (html[i] !== '=') {
      attrs.push({ name, value: null });
      continue;
    }
    i++;
    while (i < html.length && /\s/.test(html[i] as string)) i++;
    const q = html[i];
    let value: string;
    if (q === '"' || q === "'") {
      const close = html.indexOf(q, i + 1);
      if (close < 0) return null;
      value = html.slice(i + 1, close);
      i = close + 1;
    } else {
      const vs = i;
      while (i < html.length && !/[\s>]/.test(html[i] as string)) i++;
      value = html.slice(vs, i);
    }
    attrs.push({ name, value: decodeEntities(value) });
  }
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi, (all, dec, hex, name) => {
    if (dec || hex) {
      const code = Number.parseInt(dec ?? hex, dec ? 10 : 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return NAMED[(name as string).toLowerCase()] ?? all;
  });
}

const attrOf = (tag: Tag, name: string): string | null =>
  tag.attrs.find((a) => a.name === name)?.value ?? null;
const hasAttr = (tag: Tag, name: string): boolean => tag.attrs.some((a) => a.name === name);

function serializeAttrs(attrs: Attr[]): string {
  return attrs
    .map((a) =>
      a.value === null
        ? ` ${a.name}`
        : ` ${a.name}="${a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`,
    )
    .join('');
}

/** An address as written in the page, made absolute when it is protocol-relative. */
function absolute(raw: string): string {
  const t = raw.trim();
  return t.startsWith('//') ? `https:${t}` : t;
}

/** Script text that can't end its element early (`</script`) or open an escaped run (`<!--`). */
function escapeScript(text: string): string {
  return text.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '\\x3C!--');
}

const escapeStyle = (text: string): string => text.replace(/<\/(style)/gi, '<\\/$1');

const FONT_TYPES: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
};

function fontType(url: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase() ?? '';
  return FONT_TYPES[ext] ?? 'application/octet-stream';
}

/** Subresource integrity: passes when there is no usable value, or the strongest one listed matches. */
function integrityOk(value: string | null, data: Buffer): boolean {
  if (value === null) return true;
  const rank = { sha256: 1, sha384: 2, sha512: 3 } as const;
  const tokens = value
    .trim()
    .split(/\s+/)
    .map((t) => /^(sha256|sha384|sha512)-([A-Za-z0-9+/=_-]+)(?:\?.*)?$/.exec(t))
    .filter((m): m is RegExpExecArray => m !== null);
  if (tokens.length === 0) return true;
  const best = Math.max(...tokens.map((m) => rank[m[1] as keyof typeof rank]));
  const norm = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  return tokens
    .filter((m) => rank[m[1] as keyof typeof rank] === best)
    .some(
      (m) =>
        norm(
          createHash(m[1] as string)
            .update(data)
            .digest('base64'),
        ) === norm(m[2] as string),
    );
}

export interface InlineOptions {
  pageMaxBytes?: number;
  pageMaxFiles?: number;
  pageTimeoutMs?: number;
}

/**
 * The page with what it loads from the allowed sources written into it. `selfContained` is false when
 * a script or stylesheet (or a font in one) still comes from the internet. With no cache, the page is
 * unchanged and only checked.
 */
export async function inlinePageAssets(
  html: string,
  assets: AssetCache | null,
  opts: InlineOptions = {},
): Promise<{ html: string; selfContained: boolean }> {
  let budget = opts.pageMaxBytes ?? ASSET_PAGE_MAX_BYTES;
  let asks = opts.pageMaxFiles ?? ASSET_PAGE_MAX_FILES;
  const deadline = Date.now() + (opts.pageTimeoutMs ?? ASSET_PAGE_TIMEOUT_MS);
  let selfContained = true;

  async function fetchOne(url: string, kind: AssetKind): Promise<Buffer | null> {
    if (!assets || budget <= 0 || asks <= 0 || Date.now() > deadline || !allowedAsset(url, kind)) return null;
    asks--;
    const data = await assets.get(url, kind).catch(() => null);
    if (!data || data.length > budget) return null;
    budget -= data.length;
    return data;
  }

  /** CSS with each fonts.gstatic.com font made a `data:` address. */
  async function inlineFonts(css: string): Promise<string> {
    const re = /url\(\s*(['"]?)(https:\/\/fonts\.gstatic\.com\/[^'")\s]+)\1\s*\)/gi;
    const found = [...css.matchAll(re)];
    if (found.length === 0) return css;
    let out = '';
    let at = 0;
    for (const m of found) {
      const url = m[2] as string;
      const data = await fetchOne(url, 'font');
      out += css.slice(at, m.index);
      if (data) out += `url("data:${fontType(url)};base64,${data.toString('base64')}")`;
      else {
        selfContained = false;
        out += m[0];
      }
      at = (m.index ?? 0) + m[0].length;
    }
    return out + css.slice(at);
  }

  /** A Google Fonts stylesheet's text with its fonts inlined, or null. */
  async function fontSheet(href: string): Promise<string | null> {
    const data = await fetchOne(href, 'style');
    return data ? inlineFonts(data.toString('utf8')) : null;
  }

  /** A page's own style block: remote `@import`s of Google Fonts inlined (all or none), then its fonts. */
  async function inlineStyle(css: string): Promise<string> {
    const re = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;]*);/gi;
    const imports = [...css.matchAll(re)].filter((m) => REMOTE.test((m[2] ?? m[4]) as string));
    let out = css;
    if (imports.length > 0) {
      const sheets: (string | null)[] = [];
      for (const m of imports) {
        sheets.push(
          (m[5] as string).trim() === '' ? await fontSheet(absolute((m[2] ?? m[4]) as string)) : null,
        );
      }
      if (sheets.every((s) => s !== null)) {
        let rebuilt = '';
        let at = 0;
        imports.forEach((m, k) => {
          rebuilt += css.slice(at, m.index) + sheets[k];
          at = (m.index ?? 0) + m[0].length;
        });
        out = rebuilt + css.slice(at);
      } else selfContained = false;
    }
    return inlineFonts(out);
  }

  const edits: { start: number; end: number; text: string }[] = [];
  const deferred: string[] = [];
  let bodyClose = -1;

  async function onScript(tag: Tag, start: number, closeEnd: number): Promise<void> {
    const src = attrOf(tag, 'src');
    if (src === null || !REMOTE.test(src)) return;
    const type = (attrOf(tag, 'type') ?? '').trim();
    const classic = type === '' || JS_TYPE.test(type);
    const url = absolute(src);
    const data = classic && closeEnd > 0 ? await fetchOne(url, 'script') : null;
    if (!data || !integrityOk(attrOf(tag, 'integrity'), data)) {
      if (data) budget += data.length;
      selfContained = false;
      return;
    }
    const kept = tag.attrs.filter((a) => !SCRIPT_DROPPED.has(a.name));
    const inline = `<script${serializeAttrs(kept)}>${escapeScript(data.toString('utf8'))}</script>`;
    if (hasAttr(tag, 'defer') || hasAttr(tag, 'async')) {
      edits.push({ start, end: closeEnd, text: '' });
      deferred.push(inline);
    } else edits.push({ start, end: closeEnd, text: inline });
  }

  async function onLink(tag: Tag, start: number): Promise<void> {
    const rel = (attrOf(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = attrOf(tag, 'href');
    if (!rel.includes('stylesheet') || rel.includes('alternate') || href === null || !REMOTE.test(href))
      return;
    const css = await fontSheet(absolute(href));
    if (css === null) {
      selfContained = false;
      return;
    }
    const media = tag.attrs.filter((a) => a.name === 'media');
    edits.push({ start, end: tag.end, text: `<style${serializeAttrs(media)}>${escapeStyle(css)}</style>` });
  }

  let i = 0;
  for (;;) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      if (close < 0) break;
      i = close + 3;
      continue;
    }
    if (html.startsWith('</', lt)) {
      if (/^<\/body[\s/>]/i.test(html.slice(lt, lt + 8))) bodyClose = lt;
      i = lt + 2;
      continue;
    }
    if (!/[A-Za-z]/.test(html[lt + 1] ?? '')) {
      i = lt + 1;
      continue;
    }
    const tag = parseTag(html, lt);
    if (!tag) break;
    if (RAW_TEXT.has(tag.name)) {
      const closeRe = new RegExp(`</${tag.name}[\\s/>]`, 'ig');
      closeRe.lastIndex = tag.end;
      const close = closeRe.exec(html);
      const closeStart = close ? close.index : html.length;
      const closeGt = close ? html.indexOf('>', close.index) : -1;
      const closeEnd = closeGt < 0 ? -1 : closeGt + 1;
      if (tag.name === 'script') await onScript(tag, lt, closeEnd);
      else if (tag.name === 'style' && closeEnd > 0) {
        const css = html.slice(tag.end, closeStart);
        const next = await inlineStyle(css);
        if (next !== css) edits.push({ start: tag.end, end: closeStart, text: escapeStyle(next) });
      }
      if (closeEnd < 0) break;
      i = closeEnd;
      continue;
    }
    if (tag.name === 'link') await onLink(tag, lt);
    i = tag.end;
  }

  if (edits.length === 0 && deferred.length === 0) return { html, selfContained };
  let out = '';
  let at = 0;
  const insertAt = bodyClose >= 0 ? bodyClose : html.length;
  let inserted = false;
  for (const e of edits) {
    if (!inserted && insertAt <= e.start) {
      out += html.slice(at, insertAt) + deferred.join('');
      at = insertAt;
      inserted = true;
    }
    out += html.slice(at, e.start) + e.text;
    at = e.end;
  }
  if (!inserted) {
    out += html.slice(at, insertAt) + deferred.join('');
    at = insertAt;
  }
  return { html: out + html.slice(at), selfContained };
}
