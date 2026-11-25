/**
 * The library index (plan decisions 4 to 6): finds the images and documents in one scope, keeps the
 * listing in memory until the watcher says that scope changed, and maps opaque ids back to files.
 *
 * Read-only towards the brain. Image sizes and Markdown titles are kept in the app's own data folder
 * (`<dataDir>/library-meta.json`), never under the brain root.
 */
import { execFile } from 'node:child_process';
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
  Role,
} from '../../shared/contract.ts';
import { LIBRARY_SEARCH_MAX } from '../../shared/contract.ts';
import { PROTECTED_CLIENT_FILES, PROTECTED_NAMES } from '../../shared/files-contract.ts';
import {
  ARTIFACT_HEAD_BYTES,
  type ArtifactSource,
  artifactSource,
  isArtifactUrl,
} from '../../shared/pages.ts';
import {
  LEGACY_PROJECTS_SCOPE,
  type ProjectCard,
  type ProjectFilesResponse,
  type ProjectKey,
} from '../../shared/projects-contract.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import {
  classify,
  extOf,
  type FileClass,
  groupFor,
  isHiddenInTemplates,
  isNeverListed,
  orderGroups,
  tidyFileName,
} from './library-rules.ts';
import type { ProjectsIndex } from './projects.ts';

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

export type WatchFolder = 'clients' | 'personal' | 'templates' | 'projects';

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
  /**
   * Whether this person may delete library files at all (plan 2026-11-15-delete-library-files): the
   * `tdsapp-files` skill reports its capability and its `roles:` allow them. Returns their role, or
   * null for no. Missing: nothing is deletable, so older fakes and brains show no bin.
   */
  deletion?: () => Promise<{ role: Role } | null>;
  /**
   * The paths (from the brain's root) git ignores, out of those asked about, or null when git can't
   * answer. Default: one `git check-ignore --stdin -z` in the brain. Tests inject a fake.
   */
  ignored?: (rels: string[]) => Promise<Set<string> | null>;
  /**
   * The projects index (projects R1, decision 7). Each item served gets `projects` from it, worked out
   * at serve time and never cached with the listing: a card edit changes items cached in another scope.
   * Missing, or failing: items carry no `projects`.
   */
  projects?: () => Promise<ProjectsIndex>;
}

/** Names and paths the script refuses to delete (shared/files-contract.ts), checked case-insensitively. */
export function isProtectedFile(rel: string): boolean {
  const parts = rel.toLowerCase().split('/');
  const name = parts[parts.length - 1] ?? '';
  if ((PROTECTED_NAMES as readonly string[]).includes(name)) return true;
  return (
    parts.length === 3 &&
    parts[0] === 'clients' &&
    (PROTECTED_CLIENT_FILES as readonly string[]).includes(name)
  );
}

const CHECK_IGNORE_TIMEOUT_MS = 10_000;

/** Which of `rels` git ignores, from one `git check-ignore --stdin -z`; null when git can't say. */
export function gitIgnored(root: string, rels: string[]): Promise<Set<string> | null> {
  if (rels.length === 0) return Promise.resolve(new Set());
  return new Promise((resolve) => {
    try {
      const child = execFile(
        'git',
        ['check-ignore', '--stdin', '-z'],
        { cwd: root, timeout: CHECK_IGNORE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout) => {
          const code = (err as { code?: unknown } | null)?.code;
          // Exit 0: some are ignored. Exit 1: none are. Anything else (128, a missing git): no answer.
          if (!err) resolve(new Set(String(stdout).split('\0').filter(Boolean)));
          else if (code === 1) resolve(new Set());
          else resolve(null);
        },
      );
      child.stdin?.on('error', () => {});
      child.stdin?.end(`${rels.join('\0')}\0`);
    } catch {
      resolve(null);
    }
  });
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
   * The listed scope a path from the brain's root falls in, the key the file has (or would have)
   * there, and the item when it is listed now (chat files). A file made since the scope was listed
   * is found by walking that scope once more. Null outside every scope, for a path the rules never
   * list, or for a file that is there but not listed (a symbolic link, too deep). Never throws.
   */
  itemForPath(rel: string): Promise<{ key: string; scope: LibraryScope; item: LibraryItem | null } | null>;
  /**
   * Every listed file of `kind` in a project's folder (whatever scope the folder falls in) plus each of
   * the card's `links` that resolves to a listed item now. A link that is gone, or that would show a
   * personal file in a shared project, is left out and counted in `hidden`. Never throws.
   */
  projectFiles(card: ProjectCard, kind: LibraryKind): Promise<ProjectFilesResponse>;
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
  /** By lower-case path from the brain's root. */
  byPath: Map<string, LibraryItem>;
  gen: number;
  builtAt: number;
}

interface MetaEntry {
  version: string;
  width: number | null;
  height: number | null;
  title: string | null;
  /** html/htm only: the claude.ai artifact the file says it came from (decision 4). Null when it says none. */
  artifact?: ArtifactSource | null;
}

/** An `.html`/`.htm` file small enough to open as a page: its head is read for the artifact tags. */
function readsArtifact(ext: string, bytes: number): boolean {
  return (ext === 'html' || ext === 'htm') && bytes <= PAGE_MAX_BYTES;
}

/** A stored artifact value, checked again on load: the same rules as `artifactSource`, or null. */
function cleanArtifact(raw: unknown): ArtifactSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.url !== 'string' || !isArtifactUrl(a.url)) return null;
  const copied = typeof a.copied === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.copied) ? a.copied : null;
  return { url: a.url, copied, kind: a.kind === 'link' ? 'link' : 'copy', partial: a.partial === true };
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
      ...(e.artifact !== undefined ? { artifact: cleanArtifact(e.artifact) } : {}),
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
  const live: Record<WatchFolder, boolean> = {
    clients: false,
    personal: false,
    templates: false,
    projects: false,
  };

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
    // The shared Templates area stands on its own: it needs `templates/` to be a real folder, not `clients/`.
    if (await isRealFolder('templates')) {
      out.push({ id: 'shared:templates', name: 'Templates', kind: 'shared', folder: 'templates' });
    }
    // The older `projects/` folders: read-only, with their own watch folder (projects R1, decision 27).
    if (await isRealFolder('projects')) {
      out.push({ id: LEGACY_PROJECTS_SCOPE, name: 'Older projects', kind: 'shared', folder: 'projects' });
    }
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
    if (scope.id === LEGACY_PROJECTS_SCOPE) return 'projects';
    return scope.kind === 'personal' ? 'personal' : scope.kind === 'shared' ? 'templates' : 'clients';
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
        if (isNeverListed(rel) || (scope.kind === 'shared' && isHiddenInTemplates(rel))) continue;
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
          // Whole milliseconds from a bigint stat, as `file()` and the tdsapp-files script read it: a
          // plain stat's fractional mtimeMs can round up a millisecond (x.999999999 s), and then the
          // listed `version` never matches the script's and every delete of that file is "changed".
          const st = await fs.lstat(join(dir.abs, name), { bigint: true });
          if (!st.isFile()) continue;
          found.push({
            rel,
            relInScope,
            name,
            ext,
            cls,
            bytes: Number(st.size),
            mtimeMs: Number(st.mtimeMs),
          });
        } catch {
          // gone while walking
        }
      }
      for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i] as (typeof subdirs)[number]);
    }
    return { found, truncated };
  }

  async function describe(f: Found, store: Map<string, MetaEntry>): Promise<boolean> {
    const needsMeta = f.cls.kind === 'image' || f.ext === 'md' || readsArtifact(f.ext, f.bytes);
    if (!needsMeta) return false;
    const version = versionOf(f.bytes, f.mtimeMs);
    const known = store.get(f.rel);
    // An html entry with no `artifact` at all was saved by a version that never read the tags (null means
    // "read, none"), so it is read once more (overseer sign-off follow-up).
    const unread = readsArtifact(f.ext, f.bytes) && known?.artifact === undefined;
    if (known && known.version === version && !unread) return false;
    const abs = join(root, ...f.rel.split('/'));
    const entry: MetaEntry = { version, width: null, height: null, title: null };
    if (f.cls.kind === 'image') {
      const size = await imageSize(abs, f.ext, f.bytes);
      if (size) [entry.width, entry.height] = size;
    } else if (f.ext === 'md') {
      const read = await readCapped(abs, TITLE_BYTES);
      if (read) entry.title = markdownTitle(read.data.toString('utf8'));
    } else {
      // A read error leaves `artifact` null (and so off the item); the file is read again only when its version changes.
      const read = await readCapped(abs, ARTIFACT_HEAD_BYTES);
      entry.artifact = read ? artifactSource(read.data.toString('utf8')) : null;
    }
    store.set(f.rel, entry);
    return true;
  }

  /** The grouping rules a scope uses: the older projects folder groups by project, as personal files do. */
  const groupKind = (scope: ScopeDef): LibraryScope['kind'] =>
    scope.id === LEGACY_PROJECTS_SCOPE ? 'personal' : scope.kind;

  function itemFor(scope: ScopeDef, f: Found, m: MetaEntry | undefined): LibraryItem {
    const thumb = canThumb(f.cls, f.ext, f.bytes, docThumbs);
    return {
      id: idFor(scope.id, f.rel),
      kind: f.cls.kind,
      format: f.cls.format,
      ext: f.ext,
      group: groupFor(f.relInScope, groupKind(scope)),
      name: f.name,
      title: (f.ext === 'md' ? m?.title : null) || tidyFileName(f.name),
      path: f.rel,
      bytes: f.bytes,
      modified: new Date(f.mtimeMs).toISOString(),
      width: f.cls.kind === 'image' ? (m?.width ?? null) : null,
      height: f.cls.kind === 'image' ? (m?.height ?? null) : null,
      thumb,
      view: viewFor(f.cls, f.ext, f.bytes),
      version: versionOf(f.bytes, f.mtimeMs),
      ...(m?.artifact && readsArtifact(f.ext, f.bytes) ? { artifact: m.artifact } : {}),
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
      groupKind(scope),
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
      byPath: new Map(items.map((i) => [i.path.toLowerCase(), i])),
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
      const own =
        folder === 'personal'
          ? id === 'personal'
          : folder === 'templates'
            ? id === 'shared:templates'
            : folder === 'projects'
              ? id === LEGACY_PROJECTS_SCOPE
              : id.startsWith('client:');
      if (own) bump(id);
    }
  }

  /** Re-checks the file on disk: a real file, inside the brain and the scope, that the rules allow. */
  async function check(scope: ScopeDef, item: LibraryItem): Promise<LibraryFile | null> {
    const rel = item.path;
    const prefix = `${scope.folder}/`.toLowerCase();
    if (isNeverListed(rel) || !rel.toLowerCase().startsWith(prefix)) return null;
    if (scope.kind === 'shared' && isHiddenInTemplates(rel)) return null;
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
      if (scope.kind === 'shared' && isHiddenInTemplates(relReal)) return null;
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
          version: versionOf(bytes, mtimeMs),
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

  /**
   * The listing with `canDelete` on each item (plan 2026-11-15-delete-library-files). True only when
   * deleting is available to this person, the scope is a client's (any role) or Templates (owner or scout), the
   * name isn't protected and git doesn't ignore the file. One batched git call per built listing; if
   * git can't answer, nothing is deletable. The cached listing itself is never changed.
   */
  async function withDeletable(scope: ScopeDef, entry: Entry): Promise<LibraryListing> {
    const listing = entry.listing;
    if (!(await mayDeleteIn(scope))) return listing;
    const ok = await deletableIds(entry);
    if (ok === null) return listing;
    return { ...listing, items: listing.items.map((i) => (ok.has(i.id) ? { ...i, canDelete: true } : i)) };
  }

  /** Whether this person may delete in this scope right now (any known role for a client, an owner or scout for Templates). */
  async function mayDeleteIn(scope: ScopeDef): Promise<boolean> {
    if (!opts.deletion || scope.kind === 'personal' || scope.id === LEGACY_PROJECTS_SCOPE) return false;
    let who: { role: Role } | null = null;
    try {
      who = await opts.deletion();
    } catch {
      who = null;
    }
    // Someone not on the team (`unknown`) gets no bin anywhere: the route and the script refuse them too.
    if (who === null || who.role === 'unknown') return false;
    return scope.kind === 'client' || who.role === 'owner' || who.role === 'scout';
  }

  /**
   * The ids in a built listing that aren't protected names or git-ignored, worked out once per listing
   * (one git call, one Set), so a gallery's many single-file requests don't each redo it. Null when git
   * can't answer: then nothing is deletable.
   */
  const deletableFor = new WeakMap<Entry, Promise<Set<string> | null>>();
  function deletableIds(entry: Entry): Promise<Set<string> | null> {
    let ids = deletableFor.get(entry);
    if (!ids) {
      const candidates = entry.listing.items.filter((i) => !isProtectedFile(i.path));
      const ask = opts.ignored ?? ((rels: string[]) => gitIgnored(root, rels));
      ids = Promise.resolve(ask(candidates.map((i) => i.path)))
        .then((hidden) =>
          hidden === null ? null : new Set(candidates.filter((i) => !hidden.has(i.path)).map((i) => i.id)),
        )
        .catch(() => null);
      deletableFor.set(entry, ids);
    }
    return ids;
  }

  /**
   * One item with the `canDelete` its listing gives it, for the routes that hand out a single file
   * (starred files on Home, a chat's files): without it the file viewer opened from there never shows
   * the bin. Reuses the listing's cached answer, so a file costs a Set lookup, not a git call.
   */
  async function deletableItem(scope: ScopeDef, item: LibraryItem): Promise<LibraryItem> {
    if (!(await mayDeleteIn(scope))) return item;
    const entry = cache.get(scope.id) ?? (await entryFor(scope));
    const ok = await deletableIds(entry);
    return ok?.has(item.id) ? { ...item, canDelete: true } : item;
  }

  /** `keysForPath` of the projects index now, or null when there is none (or it can't be read). */
  async function projectKeysFor(): Promise<((rel: string) => ProjectKey[]) | null> {
    if (!opts.projects) return null;
    try {
      const index = await opts.projects();
      return (rel) => index.keysForPath(rel);
    } catch {
      return null;
    }
  }

  /** `item` with the projects it belongs to, as of now. The cached item is never changed. */
  async function withProjects(item: LibraryItem): Promise<LibraryItem> {
    const keys = await projectKeysFor();
    return keys ? { ...item, projects: keys(item.path) } : item;
  }

  async function withProjectsAll(items: LibraryItem[]): Promise<LibraryItem[]> {
    const keys = await projectKeysFor();
    return keys ? items.map((i) => ({ ...i, projects: keys(i.path) })) : items;
  }

  let defsInFlight: Promise<ScopeDef[]> | null = null;
  /** Many paths are looked up at once at a turn's end: they share one read of the scopes. */
  function sharedScopeDefs(): Promise<ScopeDef[]> {
    if (!defsInFlight) {
      const p = scopeDefs().finally(() => {
        if (defsInFlight === p) defsInFlight = null;
      });
      defsInFlight = p;
    }
    return defsInFlight;
  }

  /**
   * Paths found on disk that a listing still left out (a symbolic link, too deep, past the cap), by
   * listing. Asked again while that listing is current, they answer null without another walk.
   */
  const unlistedIn = new WeakMap<Entry, Set<string>>();
  /** One re-list per scope at a time: concurrent lookups share it rather than bumping again. */
  const relisting = new Map<string, Promise<Entry>>();

  function relist(scope: ScopeDef): Promise<Entry> {
    const running = relisting.get(scope.id);
    if (running) return running;
    bump(scope.id);
    const p = entryFor(scope).finally(() => {
      if (relisting.get(scope.id) === p) relisting.delete(scope.id);
    });
    relisting.set(scope.id, p);
    return p;
  }

  /** The listed item at `lower` and its fresh check; `file` is null when the check fails. */
  async function lookup(
    scope: ScopeDef,
    entry: Entry,
    lower: string,
  ): Promise<{ item: LibraryItem; file: LibraryFile | null } | null> {
    const item = entry.byPath.get(lower);
    return item ? { item, file: await check(scope, item) } : null;
  }

  async function itemForPath(
    rel: string,
  ): Promise<{ key: string; scope: LibraryScope; item: LibraryItem | null } | null> {
    if (typeof rel !== 'string' || isNeverListed(rel)) return null;
    const lower = rel.toLowerCase();
    const scope = (await sharedScopeDefs()).find((s) => lower.startsWith(`${s.folder.toLowerCase()}/`));
    if (!scope || !classify(extOf(basename(rel)))) return null;
    const info: LibraryScope = { id: scope.id, name: scope.name, kind: scope.kind };
    const before = cache.get(scope.id);
    const entry = await entryFor(scope);
    const first = await lookup(scope, entry, lower);
    if (first?.file) return { key: first.item.id, scope: info, item: first.file.item };
    const key = first?.item.id ?? idFor(scope.id, rel);
    try {
      // Not followed: a link is never listed, so it is "there but not listed", not missing.
      await fs.lstat(join(root, ...rel.split('/')));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return code === 'ENOENT' || code === 'ENOTDIR' ? { key, scope: info, item: null } : null;
    }
    if (unlistedIn.get(entry)?.has(lower)) return null;
    // There but not in the listing: made since it was walked, so walk that scope once more, unless
    // the listing was walked just now for this lookup.
    const latest = entry === before ? await relist(scope) : entry;
    const second = latest === entry ? first : await lookup(scope, latest, lower);
    if (second?.file) return { key: second.item.id, scope: info, item: second.file.item };
    const seen = unlistedIn.get(latest) ?? new Set<string>();
    seen.add(lower);
    unlistedIn.set(latest, seen);
    return null;
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
    const top = found.slice(0, LIBRARY_SEARCH_MAX).map((f) => f.hit);
    const keys = await projectKeysFor();
    return {
      hits: keys ? top.map((h) => ({ ...h, item: { ...h.item, projects: keys(h.item.path) } })) : top,
      total: found.length,
      partial,
    };
  }

  /** `itemForPath` with the delete flag and projects an item is served with. */
  async function servedItemForPath(
    rel: string,
  ): Promise<{ key: string; scope: LibraryScope; item: LibraryItem | null } | null> {
    try {
      const hit = await itemForPath(rel);
      if (!hit?.item) return hit;
      const scope = await findScope(hit.scope.id);
      return scope ? { ...hit, item: await withProjects(await deletableItem(scope, hit.item)) } : hit;
    } catch {
      return null;
    }
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
        const entry = await entryFor(scope);
        const listing = await withDeletable(scope, entry);
        const keys = await projectKeysFor();
        return keys
          ? { ...listing, items: listing.items.map((i) => ({ ...i, projects: keys(i.path) })) }
          : listing;
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
        // `canDelete` goes on before `check`, never on a copy after: readChecked/openChecked trust only
        // the very object `check` returned.
        return item ? await check(scope, await withProjects(await deletableItem(scope, item))) : null;
      } catch {
        return null;
      }
    },

    itemForPath: servedItemForPath,

    async projectFiles(card, kind) {
      const out: ProjectFilesResponse = { items: [], hidden: 0 };
      try {
        const seen = new Set<string>();
        const add = (item: LibraryItem) => {
          if (item.kind !== kind || seen.has(item.id)) return;
          seen.add(item.id);
          out.items.push(item);
        };
        // The folder's own files, from whichever scope the folder falls in.
        const folder = `${card.folder.toLowerCase()}/`;
        const scope = (await scopeDefs()).find((s) => folder.startsWith(`${s.folder.toLowerCase()}/`));
        if (scope && !isNeverListed(card.folder)) {
          const entry = await entryFor(scope);
          for (const item of await withProjectsAll(
            (await withDeletable(scope, entry)).items.filter((i) => i.path.toLowerCase().startsWith(folder)),
          ))
            add(item);
        }
        // Each linked file that is listed now. Others are left out and counted.
        for (const link of card.links) {
          if (classify(extOf(basename(link)))?.kind !== kind) continue;
          // A shared project never shows a personal file: it would be this Mac's own, not the linker's.
          const hit =
            card.space !== 'personal' && link.toLowerCase().startsWith('personal/')
              ? null
              : await servedItemForPath(link);
          if (hit?.item) add(hit.item);
          else out.hidden += 1;
        }
      } catch {
        // what was found so far is still right
      }
      return out;
    },

    changed(rel, folder) {
      if (rel === null) {
        if (folder) bumpFolder(folder);
        return;
      }
      const segs = rel.split('/');
      if (segs[0] === 'personal') bump('personal');
      else if (segs[0] === 'templates') bump('shared:templates');
      else if (segs[0] === 'projects') bump(LEGACY_PROJECTS_SCOPE);
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
