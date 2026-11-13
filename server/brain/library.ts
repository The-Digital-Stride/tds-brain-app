/**
 * The library index (plan decisions 4 to 6): finds the images and documents in one scope, keeps the
 * listing in memory until the watcher says that scope changed, and maps opaque ids back to files.
 *
 * Read-only towards the brain. Image sizes and Markdown titles are kept in the app's own data folder
 * (`<dataDir>/library-meta.json`), never under the brain root.
 */
import { createHash } from 'node:crypto';
import { constants, type Dirent, promises as fs } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import sharp from 'sharp';
import type {
  ClientInfo,
  LibraryFile,
  LibraryItem,
  LibraryKind,
  LibraryListing,
  LibraryScope,
  LibrarySearchHit,
  LibrarySearchResponse,
  LibraryView,
} from '../../shared/contract.ts';
import { LIBRARY_SEARCH_MAX } from '../../shared/contract.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import {
  classify,
  extOf,
  type FileClass,
  groupFor,
  isNeverListed,
  orderGroups,
  tidyFileName,
} from './library-rules.ts';

export const LIMITS = { depth: 8, listed: 5000, visited: 50_000 } as const;
export const THUMB_MAX_BYTES = 50 * 1024 * 1024;
export const TEXT_MAX_BYTES = 1024 * 1024;
export const PAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Without a live watcher, a listing older than this is walked again. */
export const STALE_AFTER_MS = 30_000;

const TITLE_BYTES = 8 * 1024;
const IMAGE_HEAD_BYTES = 64 * 1024;
/** An SVG over this size gets no picture: drawing one can take a long time. */
export const SVG_MAX_BYTES = 1024 * 1024;
const SVG_HEAD_BYTES = 8 * 1024;
const META_CONCURRENCY = 8;
const MAX_ID_LENGTH = 400;
const HASH_LENGTH = 24;
const META_FILE = 'library-meta.json';

export type WatchFolder = 'clients' | 'personal';

export interface LibraryOptions {
  /** The brain's clients, as `BrainReaders.clients()` gives them. */
  clients: () => Promise<ClientInfo[]>;
  /** The app's data folder. Null or missing: sizes and titles are kept in memory only. */
  dataDir?: string | null;
  now?: () => number;
  /** Tests lower the caps. */
  limits?: Partial<{ depth: number; listed: number; visited: number }>;
  /** Tests count walks. */
  onWalk?: (scope: string) => void;
  /** Tests hold a build after its walk, to change things while it is in flight. */
  afterWalk?: (scope: string) => Promise<void> | void;
  /**
   * True where Quick Look can draw documents (`quickLookAvailable()`), so PDFs and Office files are
   * offered a picture (never web pages: see `DOC_THUMB_EXTS`). Must match what the thumbnailer was given. Default false.
   */
  docThumbs?: boolean;
  /** Search limits. Tests lower them. */
  search?: Partial<{ budgetMs: number; concurrency: number }>;
}

/** How long a search waits for scopes that have never been listed, and how many it builds at once. */
export const SEARCH_BUDGET_MS = 1500;
export const SEARCH_CONCURRENCY = 3;

/** Lower case, accents stripped: what search compares. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const FOLDER_SPLIT = /[/\-_.\s]+/;
const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** 0 title starts with the query, 1 title has every word and a title word starts with one, 2 title has every word, 3 other fields; null: no match. */
function searchTier(item: LibraryItem, scopeName: string, q: string, qWords: string[]): number | null {
  const title = fold(item.title);
  const dir = item.path.split('/').slice(0, -1).join(' ');
  const folderWords = dir.split(FOLDER_SPLIT).join(' ');
  const all = `${title} ${fold(item.name)} ${fold(item.group)} ${fold(folderWords)} ${fold(scopeName)}`;
  if (!qWords.every((w) => all.includes(w))) return null;
  if (title.startsWith(q)) return 0;
  if (qWords.every((w) => title.includes(w))) {
    const titleWords = title.split(FOLDER_SPLIT).filter(Boolean);
    return qWords.some((w) => titleWords.some((t) => t.startsWith(w))) ? 1 : 2;
  }
  return 3;
}

export interface Library {
  /**
   * Items of one kind whose title, name, group, folder words or scope name hold every word of `q`,
   * best first, across every scope. Listing metadata only: file contents are never read.
   */
  search(q: string, kind: LibraryKind): Promise<LibrarySearchResponse>;
  scopes(): Promise<LibraryScope[]>;
  list(scope: string): Promise<LibraryListing | null>;
  file(id: string): Promise<LibraryFile | null>;
  /**
   * The watcher saw a change. `rel` is the changed path from the brain's root (forward slashes), or
   * null when the platform did not say, in which case every scope under `folder` is marked stale.
   */
  changed(rel: string | null, folder?: WatchFolder): void;
  /** Whether a live watcher covers this folder. Without one, listings expire after 30 seconds. */
  setLive(folder: WatchFolder, live: boolean): void;
}

interface ScopeDef extends LibraryScope {
  /** From the brain's root: "personal" or "clients/<slug>". */
  folder: string;
}

interface Entry {
  listing: LibraryListing;
  paths: Map<string, LibraryItem>;
  gen: number;
  builtAt: number;
}

interface MetaEntry {
  version: string;
  width: number | null;
  height: number | null;
  title: string | null;
}

interface Found {
  rel: string;
  relInScope: string;
  name: string;
  ext: string;
  cls: FileClass;
  bytes: number;
  mtimeMs: number;
}

const PERSONAL_NAME = 'My personal files';
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;

/** `<scope id>.<hash of the path from the brain's root>`. */
export function idFor(scopeId: string, rel: string): string {
  return `${scopeId}.${createHash('sha256').update(rel, 'utf8').digest('hex').slice(0, HASH_LENGTH)}`;
}

/** The scope part of a well-formed id, or null. Never trusted on its own: it must match a listed scope. */
export function scopeOfId(id: unknown): string | null {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) return null;
  const dot = id.lastIndexOf('.');
  if (dot <= 0) return null;
  if (!new RegExp(`^[0-9a-f]{${HASH_LENGTH}}$`).test(id.slice(dot + 1))) return null;
  return id.slice(0, dot);
}

export function versionOf(bytes: number, mtimeMs: number): string {
  return `${bytes}-${Math.trunc(mtimeMs)}`;
}

function viewFor(cls: FileClass, ext: string, bytes: number): LibraryView | null {
  switch (cls.view) {
    case 'image':
      return canThumb(cls, ext, bytes) ? 'image' : null;
    case 'text':
      // Long text still opens: the text route sends the first TEXT_MAX_BYTES, marked truncated.
      return 'text';
    case 'page':
      return bytes <= PAGE_MAX_BYTES ? 'page' : null;
    case 'pdf':
      // Streamed to the browser's own reader, so any size opens.
      return 'pdf';
    default:
      return null;
  }
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Reads at most `max` bytes of a regular file without following a symbolic link at the last step.
 * `truncated` is true when the file is longer. Null when it cannot be read or is not a regular file.
 */
export async function readCapped(
  absPath: string,
  max: number,
  expect?: FileIdentity,
): Promise<{ data: Buffer; truncated: boolean } | null> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(absPath, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
    const st = await handle.stat({ bigint: true });
    if (!st.isFile()) return null;
    // A folder swapped between the check and this read would give another file: refuse it.
    if (expect && (st.dev !== expect.dev || st.ino !== expect.ino)) return null;
    const size = Number(st.size);
    const want = Math.min(size, max + 1);
    const buf = Buffer.alloc(want);
    let got = 0;
    while (got < want) {
      const { bytesRead } = await handle.read(buf, got, want - got, got);
      if (bytesRead === 0) break;
      got += bytesRead;
    }
    const truncated = got > max || size > max;
    return { data: buf.subarray(0, Math.min(got, max)), truncated };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export interface FileIdentity {
  dev: bigint;
  ino: bigint;
}

/** Server only, never sent anywhere: which file on disk each checked `LibraryFile` is. */
const identities = new WeakMap<LibraryFile, FileIdentity>();

/**
 * Reads a file `libraryFile` returned, refusing it unless it is still the very file that was
 * checked (same device and inode). Null for a `LibraryFile` the library did not make.
 */
export function readChecked(
  file: LibraryFile,
  max: number,
): Promise<{ data: Buffer; truncated: boolean } | null> {
  const id = identities.get(file);
  return id ? readCapped(file.absPath, max, id) : Promise.resolve(null);
}

/**
 * Opens a file `libraryFile` returned, to be streamed whole, refusing it unless it is still the very
 * file that was checked (same device and inode) and a regular file. The caller owns the handle and
 * must close it. Null for a `LibraryFile` the library did not make, or a file that cannot be opened.
 */
export async function openChecked(
  file: LibraryFile,
): Promise<{ handle: fs.FileHandle; size: number } | null> {
  const id = identities.get(file);
  if (!id) return null;
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(file.absPath, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
    const st = await handle.stat({ bigint: true });
    if (st.isFile() && st.dev === id.dev && st.ino === id.ino) return { handle, size: Number(st.size) };
  } catch {
    // falls through to close and refuse
  }
  await handle?.close().catch(() => {});
  return null;
}

/**
 * An SVG's size from its root tag, read as text (an SVG is never handed to the image library while
 * listing: a tiny one can take it many seconds). Plain or px `width` and `height`, else the viewBox.
 */
export function svgSize(head: string): [number, number] | null {
  const tag = /<svg(?=[\s>/])([^>]*)>/i.exec(head);
  if (!tag) return null;
  const attrs = tag[1] ?? '';
  const attr = (name: string): string | null => {
    const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs);
    return m ? (m[1] ?? m[2] ?? '') : null;
  };
  const len = (v: string | null): number | null => {
    const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(?:px)?\s*$/i.exec(v ?? '');
    return m ? Number(m[1]) : null;
  };
  const sized = (w: number | null | undefined, h: number | null | undefined): [number, number] | null =>
    w && h && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && w < 1e6 && h < 1e6
      ? [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))]
      : null;
  const direct = sized(len(attr('width')), len(attr('height')));
  if (direct) return direct;
  const box = (attr('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return box.length === 4 ? sized(box[2], box[3]) : null;
}

/**
 * Documents Quick Look draws well. Not md, txt or csv: it draws them as small grey text or tiny
 * tables, and their icons say more. Never html or htm: Quick Look's web view loads `file://` and
 * relative addresses, so a page in the brain could draw any local file (a token, an `.env`) into its
 * picture.
 */
export const DOC_THUMB_EXTS: ReadonlySet<string> = new Set(['pdf', 'docx', 'xlsx', 'pptx']);

/**
 * Whether a picture can be made: an image under 50 MB, an SVG under 1 MB, or (where Quick Look is
 * there, `docThumbs`) a PDF or Office file under 50 MB.
 */
export function canThumb(cls: FileClass, ext: string, bytes: number, docThumbs = false): boolean {
  if (cls.kind === 'document') return docThumbs && DOC_THUMB_EXTS.has(ext) && bytes <= THUMB_MAX_BYTES;
  // Any kind added later gets no picture until someone decides it should.
  if (cls.kind !== 'image') return false;
  return bytes <= (ext === 'svg' ? SVG_MAX_BYTES : THUMB_MAX_BYTES);
}

/** A Markdown title: frontmatter `title:`, else the first heading. Null when neither is there. */
export function markdownTitle(head: string): string | null {
  const { data, body } = parseFrontmatter(head);
  const fromFront = asString(data.title).trim();
  if (fromFront) return fromFront.slice(0, 200);
  const m = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(body);
  const heading = m?.[1]?.trim();
  return heading ? heading.slice(0, 200) : null;
}

/**
 * False when bytes named as a raster picture are really markup (SVG, XML, HTML) or gzip (a
 * compressed SVG). The image library decides by the bytes, not the name, so such a file would skip
 * the SVG safeguards: it is simply not measured or drawn. Used before every raster read by `sharp`.
 */
export function looksLikeRaster(data: Buffer): boolean {
  if (data.length === 0) return false;
  if (data[0] === 0x1f && data[1] === 0x8b) return false;
  let i = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? 3 : 0;
  while (i < data.length && (data[i] === 0x20 || data[i] === 0x09 || data[i] === 0x0a || data[i] === 0x0d))
    i++;
  return i < data.length && data[i] !== 0x3c; // '<'
}

/** A raster picture's size from its bytes. Never given an SVG (see `looksLikeRaster`). */
async function sizeFromBytes(data: Buffer): Promise<[number, number] | null> {
  if (!looksLikeRaster(data)) return null;
  try {
    // From bytes, never a path: an SVG opened by path can pull in neighbouring files.
    const m = await sharp(data).metadata();
    const w = m.autoOrient?.width ?? m.width;
    const h = m.autoOrient?.height ?? m.height;
    return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 ? [w, h] : null;
  } catch {
    return null;
  }
}

async function imageSize(absPath: string, ext: string, bytes: number): Promise<[number, number] | null> {
  if (ext !== 'svg' && bytes > THUMB_MAX_BYTES) return null;
  if (ext === 'svg') {
    // Read as text, never drawn, and never re-read whole.
    const head = await readCapped(absPath, SVG_HEAD_BYTES);
    return head ? svgSize(head.data.toString('utf8')) : null;
  }
  // The head is enough for most files; big metadata blocks (EXIF, XMP) can push a JPEG's frame
  // header past it, so try once more with the whole file (still under the 50 MB cap).
  const head = await readCapped(absPath, IMAGE_HEAD_BYTES);
  if (!head) return null;
  const size = await sizeFromBytes(head.data);
  if (size || !head.truncated) return size;
  const whole = await readCapped(absPath, THUMB_MAX_BYTES);
  return whole && !whole.truncated ? sizeFromBytes(whole.data) : null;
}

function cleanMeta(raw: unknown): Map<string, MetaEntry> {
  const out = new Map<string, MetaEntry>();
  const entries =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { entries?: unknown }).entries : null;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return out;
  const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
  for (const [rel, v] of Object.entries(entries)) {
    if (!v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    if (typeof e.version !== 'string') continue;
    out.set(rel, {
      version: e.version,
      width: num(e.width),
      height: num(e.height),
      title: typeof e.title === 'string' ? e.title.slice(0, 200) : null,
    });
  }
  return out;
}

async function pool<T>(items: T[], size: number, job: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await job(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

export function createLibrary(root: string, opts: LibraryOptions): Library {
  const now = opts.now ?? Date.now;
  const limits = { ...LIMITS, ...opts.limits };
  const docThumbs = opts.docThumbs ?? false;
  const cache = new Map<string, Entry>();
  const gens = new Map<string, number>();
  /** One build per scope at a time, with the generation it started at. */
  const inflight = new Map<string, { gen: number; promise: Promise<Entry> }>();
  const live: Record<WatchFolder, boolean> = { clients: false, personal: false };

  let meta: Map<string, MetaEntry> | null = null;
  let metaLoad: Promise<Map<string, MetaEntry>> | null = null;
  let saveQueue: Promise<void> = Promise.resolve();

  async function rootReal(): Promise<string | null> {
    try {
      return await fs.realpath(root);
    } catch {
      return null;
    }
  }

  /** The data folder, unless it is missing or would put anything under the brain. */
  async function safeDataDir(): Promise<string | null> {
    if (!opts.dataDir) return null;
    const dir = resolve(opts.dataDir);
    const real = await rootReal();
    let dirReal = dir;
    try {
      dirReal = await fs.realpath(dir);
    } catch {
      // not made yet
    }
    for (const r of [resolve(root), real]) {
      if (r && (isInside(dir, r) || isInside(dirReal, r))) return null;
    }
    return dir;
  }

  function loadMeta(): Promise<Map<string, MetaEntry>> {
    if (meta) return Promise.resolve(meta);
    metaLoad ??= (async () => {
      const dir = await safeDataDir();
      let loaded = new Map<string, MetaEntry>();
      if (dir) {
        try {
          loaded = cleanMeta(JSON.parse(await fs.readFile(join(dir, META_FILE), 'utf8')));
        } catch {
          // missing or broken: start again
        }
      }
      meta = loaded;
      return loaded;
    })();
    return metaLoad;
  }

  function saveMeta(): Promise<void> {
    const job = async () => {
      const dir = await safeDataDir();
      if (!dir || !meta) return;
      const file = join(dir, META_FILE);
      const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      try {
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        const entries = Object.fromEntries(meta);
        await fs.writeFile(tmp, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
        await fs.rename(tmp, file);
      } catch {
        await fs.rm(tmp, { force: true }).catch(() => {});
      }
    };
    saveQueue = saveQueue.then(job, job);
    return saveQueue;
  }

  async function scopeDefs(): Promise<ScopeDef[]> {
    try {
      if (!(await fs.stat(root)).isDirectory()) return [];
    } catch {
      return [];
    }
    const out: ScopeDef[] = [{ id: 'personal', name: PERSONAL_NAME, kind: 'personal', folder: 'personal' }];
    // `clients/` itself must be the real folder in the brain: if it is a link elsewhere, no names
    // from there may appear.
    if (!(await isRealFolder('clients'))) return out;
    let clients: ClientInfo[] = [];
    try {
      clients = await opts.clients();
    } catch {
      clients = [];
    }
    for (const c of clients) {
      const folder = `clients/${c.slug}`;
      if (c.slug.includes('/') || c.slug.includes('\\') || isNeverListed(folder)) continue;
      try {
        // A client folder that is a symbolic link is not followed.
        if (!(await fs.lstat(join(root, 'clients', c.slug))).isDirectory()) continue;
      } catch {
        continue;
      }
      out.push({ id: `client:${c.slug}`, name: c.name, kind: 'client', folder });
    }
    return out;
  }

  /** True when `folder` (from the brain's root) resolves to exactly that place inside the real brain. */
  async function isRealFolder(folder: string): Promise<boolean> {
    try {
      const base = await rootReal();
      if (!base) return false;
      const real = await fs.realpath(join(root, ...folder.split('/')));
      return real.toLowerCase() === join(base, ...folder.split('/')).toLowerCase();
    } catch {
      return false;
    }
  }

  async function findScope(id: string): Promise<ScopeDef | null> {
    if (typeof id !== 'string' || id === '') return null;
    return (await scopeDefs()).find((s) => s.id === id) ?? null;
  }

  function folderOf(scope: ScopeDef): WatchFolder {
    return scope.kind === 'personal' ? 'personal' : 'clients';
  }

  async function walk(scope: ScopeDef): Promise<{ found: Found[]; truncated: boolean }> {
    const found: Found[] = [];
    const base = join(root, ...scope.folder.split('/'));
    try {
      const st = await fs.lstat(base);
      if (!st.isDirectory()) return { found, truncated: false };
    } catch {
      return { found, truncated: false };
    }
    // The scope folder (and every folder above it) must be where it says, inside the real brain.
    if (!(await isRealFolder(scope.folder))) return { found, truncated: false };
    const stack: { abs: string; rel: string; depth: number }[] = [{ abs: base, rel: '', depth: 0 }];
    let visited = 0;
    let truncated = false;
    outer: while (stack.length > 0) {
      const dir = stack.pop();
      if (!dir) break;
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir.abs, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const subdirs: { abs: string; rel: string; depth: number }[] = [];
      for (const d of entries) {
        if (visited >= limits.visited) {
          truncated = true;
          break outer;
        }
        visited++;
        const name = d.name;
        if (name.startsWith('.')) continue;
        const relInScope = dir.rel ? `${dir.rel}/${name}` : name;
        const rel = `${scope.folder}/${relInScope}`;
        if (isNeverListed(rel)) continue;
        let isDir = d.isDirectory();
        let isFile = d.isFile();
        if (d.isSymbolicLink()) continue;
        if (!isDir && !isFile) {
          // Some file systems do not say: ask, still without following a link.
          try {
            const st = await fs.lstat(join(dir.abs, name));
            isDir = st.isDirectory();
            isFile = st.isFile();
          } catch {
            continue;
          }
        }
        if (isDir) {
          if (dir.depth + 1 <= limits.depth) {
            subdirs.push({ abs: join(dir.abs, name), rel: relInScope, depth: dir.depth + 1 });
          }
          continue;
        }
        if (!isFile) continue;
        const ext = extOf(name);
        const cls = classify(ext);
        if (!cls) continue;
        if (found.length >= limits.listed) {
          truncated = true;
          break outer;
        }
        try {
          const st = await fs.lstat(join(dir.abs, name));
          if (!st.isFile()) continue;
          found.push({ rel, relInScope, name, ext, cls, bytes: st.size, mtimeMs: st.mtimeMs });
        } catch {
          // gone while walking
        }
      }
      for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i] as (typeof subdirs)[number]);
    }
    return { found, truncated };
  }

  async function describe(f: Found, store: Map<string, MetaEntry>): Promise<boolean> {
    const needsMeta = f.cls.kind === 'image' || f.ext === 'md';
    if (!needsMeta) return false;
    const version = versionOf(f.bytes, f.mtimeMs);
    const known = store.get(f.rel);
    if (known && known.version === version) return false;
    const abs = join(root, ...f.rel.split('/'));
    const entry: MetaEntry = { version, width: null, height: null, title: null };
    if (f.cls.kind === 'image') {
      const size = await imageSize(abs, f.ext, f.bytes);
      if (size) [entry.width, entry.height] = size;
    } else {
      const read = await readCapped(abs, TITLE_BYTES);
      if (read) entry.title = markdownTitle(read.data.toString('utf8'));
    }
    store.set(f.rel, entry);
    return true;
  }

  function itemFor(scope: ScopeDef, f: Found, m: MetaEntry | undefined): LibraryItem {
    const thumb = canThumb(f.cls, f.ext, f.bytes, docThumbs);
    return {
      id: idFor(scope.id, f.rel),
      kind: f.cls.kind,
      format: f.cls.format,
      ext: f.ext,
      group: groupFor(f.relInScope, scope.kind),
      name: f.name,
      title: (f.ext === 'md' ? m?.title : null) || tidyFileName(f.name),
      path: f.rel,
      bytes: f.bytes,
      modified: new Date(f.mtimeMs).toISOString(),
      width: f.cls.kind === 'image' ? (m?.width ?? null) : null,
      height: f.cls.kind === 'image' ? (m?.height ?? null) : null,
      thumb,
      view: viewFor(f.cls, f.ext, f.bytes),
    };
  }

  async function build(scope: ScopeDef, gen: number): Promise<Entry> {
    opts.onWalk?.(scope.id);
    const { found, truncated } = await walk(scope);
    await opts.afterWalk?.(scope.id);
    const store = await loadMeta();
    let dirty = false;
    await pool(found, META_CONCURRENCY, async (f) => {
      if (await describe(f, store)) dirty = true;
    });
    if (!truncated) {
      const seen = new Set(found.map((f) => f.rel));
      const prefix = `${scope.folder}/`;
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix) && !seen.has(key)) {
          store.delete(key);
          dirty = true;
        }
      }
    }
    if (dirty) await saveMeta();

    const items = found.map((f) => itemFor(scope, f, store.get(f.rel)));
    const groups = orderGroups(
      items.map((i) => i.group),
      scope.kind,
    );
    const rank = new Map(groups.map((g, i) => [g, i]));
    items.sort(
      (a, b) =>
        (rank.get(a.group) ?? 0) - (rank.get(b.group) ?? 0) ||
        a.path.localeCompare(b.path, 'en', { sensitivity: 'base' }),
    );
    const entry: Entry = {
      listing: { scope: scope.id, groups, items, truncated },
      paths: new Map(items.map((i) => [i.id, i])),
      gen,
      builtAt: now(),
    };
    // A build that started before a change may finish after a newer one: never let it replace that.
    const current = cache.get(scope.id);
    if (!current || current.gen <= gen) cache.set(scope.id, entry);
    return entry;
  }

  function isFresh(scope: ScopeDef, e: Entry): boolean {
    if (e.gen !== (gens.get(scope.id) ?? 0)) return false;
    return live[folderOf(scope)] || now() - e.builtAt < STALE_AFTER_MS;
  }

  async function entryFor(scope: ScopeDef): Promise<Entry> {
    const e = cache.get(scope.id);
    if (e && isFresh(scope, e)) return e;
    const gen = gens.get(scope.id) ?? 0;
    const running = inflight.get(scope.id);
    // Join a build only if nothing changed since it started; else it may have missed the change.
    if (running && running.gen === gen) return running.promise;
    const promise: Promise<Entry> = build(scope, gen).finally(() => {
      if (inflight.get(scope.id)?.promise === promise) inflight.delete(scope.id);
    });
    inflight.set(scope.id, { gen, promise });
    return promise;
  }

  function bump(scopeId: string): void {
    gens.set(scopeId, (gens.get(scopeId) ?? 0) + 1);
  }

  function bumpFolder(folder: WatchFolder): void {
    const ids = new Set([...cache.keys(), ...inflight.keys(), ...gens.keys()]);
    for (const id of ids) {
      if (folder === 'personal' ? id === 'personal' : id.startsWith('client:')) bump(id);
    }
  }

  /** Re-checks the file on disk: a real file, inside the brain and the scope, that the rules allow. */
  async function check(scope: ScopeDef, item: LibraryItem): Promise<LibraryFile | null> {
    const rel = item.path;
    const prefix = `${scope.folder}/`.toLowerCase();
    if (isNeverListed(rel) || !rel.toLowerCase().startsWith(prefix)) return null;
    const abs = join(root, ...rel.split('/'));
    try {
      const l = await fs.lstat(abs);
      if (!l.isFile()) return null;
      const base = await rootReal();
      if (!base) return null;
      const real = await fs.realpath(abs);
      if (!isInside(real, base) || real === base) return null;
      const relReal = relative(base, real).split(sep).join('/');
      if (isNeverListed(relReal) || !relReal.toLowerCase().startsWith(prefix)) return null;
      const ext = extOf(basename(real));
      const cls = classify(ext);
      if (!cls || ext !== item.ext) return null;
      const st = await fs.stat(real, { bigint: true });
      if (!st.isFile()) return null;
      const bytes = Number(st.size);
      const mtimeMs = Number(st.mtimeMs);
      const file: LibraryFile = {
        item: {
          ...item,
          bytes,
          modified: new Date(mtimeMs).toISOString(),
          thumb: canThumb(cls, ext, bytes, docThumbs),
          view: viewFor(cls, ext, bytes),
        },
        absPath: real,
        version: versionOf(bytes, mtimeMs),
      };
      identities.set(file, { dev: st.dev, ino: st.ino });
      return file;
    } catch {
      return null;
    }
  }

  const refreshing = new Set<string>();
  const refreshQueue: ScopeDef[] = [];
  let refreshRunning = 0;
  /** Refreshes a stale scope without waiting, a few at a time however many are stale. */
  function refreshBehind(scope: ScopeDef, limit: number): void {
    if (refreshing.has(scope.id)) return;
    refreshing.add(scope.id);
    refreshQueue.push(scope);
    const pump = (): void => {
      while (refreshRunning < limit) {
        const next = refreshQueue.shift();
        if (!next) return;
        refreshRunning++;
        entryFor(next)
          .catch(() => {})
          .finally(() => {
            refreshing.delete(next.id);
            refreshRunning--;
            pump();
          });
      }
    };
    pump();
  }

  async function search(q: string, kind: LibraryKind): Promise<LibrarySearchResponse> {
    const query = fold(q).trim().replace(/\s+/g, ' ');
    const qWords = words(query);
    if (qWords.length === 0) return { hits: [], total: 0, partial: false };
    const budgetMs = opts.search?.budgetMs ?? SEARCH_BUDGET_MS;
    const concurrency = Math.max(1, opts.search?.concurrency ?? SEARCH_CONCURRENCY);
    const defs = await scopeDefs();
    const listings: { scope: ScopeDef; items: LibraryItem[] }[] = [];
    const cold: ScopeDef[] = [];
    for (const scope of defs) {
      const e = cache.get(scope.id);
      if (!e) {
        cold.push(scope);
        continue;
      }
      listings.push({ scope, items: e.listing.items });
      // Stale is fine to answer from: refresh behind it for the next search.
      if (!isFresh(scope, e)) refreshBehind(scope, concurrency);
    }
    let closed = false;
    let finished = 0;
    const queue = [...cold];
    const worker = async (): Promise<void> => {
      for (let scope = queue.shift(); scope; scope = queue.shift()) {
        try {
          const e = await entryFor(scope);
          if (!closed) listings.push({ scope, items: e.listing.items });
        } catch {
          // left out; a retry builds it again
        }
        finished++;
      }
    };
    if (cold.length > 0) {
      const pool = Promise.all(Array.from({ length: Math.min(concurrency, cold.length) }, worker));
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<void>((done) => {
        timer = setTimeout(done, budgetMs);
      });
      await Promise.race([pool, late]);
      clearTimeout(timer);
    }
    closed = true;
    const partial = finished < cold.length;

    const found: { hit: LibrarySearchHit; tier: number; at: number }[] = [];
    for (const { scope, items } of listings) {
      const info: LibraryScope = { id: scope.id, name: scope.name, kind: scope.kind };
      for (const item of items) {
        if (item.kind !== kind) continue;
        const tier = searchTier(item, scope.name, query, qWords);
        if (tier === null) continue;
        found.push({ hit: { item, scope: info }, tier, at: Date.parse(item.modified) || 0 });
      }
    }
    found.sort(
      (a, b) =>
        a.tier - b.tier ||
        b.at - a.at ||
        a.hit.item.path.localeCompare(b.hit.item.path, 'en', { sensitivity: 'base' }),
    );
    return {
      hits: found.slice(0, LIBRARY_SEARCH_MAX).map((f) => f.hit),
      total: found.length,
      partial,
    };
  }

  return {
    async search(q, kind) {
      try {
        return await search(q, kind);
      } catch {
        return { hits: [], total: 0, partial: false };
      }
    },

    async scopes() {
      try {
        return (await scopeDefs()).map(({ id, name, kind }) => ({ id, name, kind }));
      } catch {
        return [];
      }
    },

    async list(scopeId) {
      try {
        const scope = await findScope(scopeId);
        if (!scope) return null;
        return (await entryFor(scope)).listing;
      } catch {
        return null;
      }
    },

    async file(id) {
      try {
        const scopeId = scopeOfId(id);
        if (!scopeId) return null;
        const scope = await findScope(scopeId);
        if (!scope) return null;
        let item = cache.get(scope.id)?.paths.get(id);
        if (!item) {
          // Not known (after a restart, or a new file): list that one scope, then give up.
          item = (await entryFor(scope)).paths.get(id);
        }
        return item ? await check(scope, item) : null;
      } catch {
        return null;
      }
    },

    changed(rel, folder) {
      if (rel === null) {
        if (folder) bumpFolder(folder);
        return;
      }
      const segs = rel.split('/');
      if (segs[0] === 'personal') bump('personal');
      else if (segs[0] === 'clients') {
        if (segs[1]) bump(`client:${segs[1]}`);
        else bumpFolder('clients');
      }
    },

    setLive(folder, on) {
      live[folder] = on;
    },
  };
}
