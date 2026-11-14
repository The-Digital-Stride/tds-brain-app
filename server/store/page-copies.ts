/**
 * The app's own copy of each page version Claude published (plan docs/plans/2026-11-14-artifacts-in-app.md,
 * decision 2): `<dataDir>/pages/<sdkSessionId>/<key>/v<n>.html`, never in the brain.
 *
 * The source path comes from the model, so it is checked hard before a byte is read: absolute, `.html` /
 * `.htm`, no control characters, at most 1024 characters, its real path under Claude's temporary folder,
 * the brain or the session's folder, and not one of the app's own copies. The read follows the library's
 * `openChecked` pattern: open with O_RDONLY | O_NOFOLLOW | O_NONBLOCK, `fstat` the handle (a regular file,
 * the same one the real path names), take the size from the handle and read at most the cap + 1 bytes from
 * it. No check-then-open race, and a FIFO never hangs the read.
 *
 * Folders are 0o700. A copy is written to a 0o600 temporary file, made read-only (0o444) and linked into
 * place, so it is atomic and an existing copy is never rewritten. Moving a chat's folder away goes to the
 * macOS Bin; only the per-chat room rule removes copies itself (the app's own, older versions).
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { SESSION_UUID_PATTERN } from '../../shared/contract.ts';
import { pageTitle } from '../../shared/pages.ts';
import { PAGE_COPY_MAX_BYTES } from '../../shared/pages-contract.ts';

export const PAGES_DIR = 'pages';
/** Copies kept per chat; over it, the oldest versions lose their copy first (never a page's newest). */
export const PAGE_CHAT_MAX_BYTES = 200 * 1024 * 1024;
/** A folder touched this recently is never swept: its chat's history may not be on disk yet. */
const SWEEP_GRACE_MS = 60 * 60 * 1000;
const SOURCE_MAX_CHARS = 1024;
const VERSION_MAX = 99_999;
const TITLE_SCAN_BYTES = 64 * 1024;
const TRASH_BIN = '/usr/bin/trash';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION_FILE = /^v([1-9][0-9]{0,4})\.html$/;

/** A page key that is safe as one folder name (and in an address). */
export function isPageKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_RE.test(key);
}

const isChatId = (id: unknown): id is string => typeof id === 'string' && SESSION_UUID_PATTERN.test(id);
const isVersion = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= VERSION_MAX;

/** Absolute, a page by its name, one line and not over-long. */
export function sourceShapeOk(source: unknown): source is string {
  return (
    typeof source === 'string' &&
    source.length <= SOURCE_MAX_CHARS &&
    source.startsWith('/') &&
    /\.html?$/i.test(source) &&
    ![...source].some((c) => c.charCodeAt(0) <= 0x1f || c.charCodeAt(0) === 0x7f)
  );
}

export interface PageCopyInfo {
  title: string;
}

export interface PageCopyResult extends PageCopyInfo {
  /** Older versions whose copies were removed to keep the chat under its room. */
  evicted: { key: string; n: number }[];
}

export interface PageCopyStoreOptions {
  dataDir: string;
  /** Folders a source may sit in besides Claude's temporary folder: the brain (configured and real) and the session's folder. */
  roots: readonly string[];
  /** Claude's temporary folder. Default `/private/tmp/claude-<uid>`. */
  tmpRoot?: string;
  /** Moves one path to the macOS Bin. Default `/usr/bin/trash`, no shell. */
  trash?: (path: string) => Promise<void>;
  /** Short status lines only: never a path. */
  log?: (line: string) => void;
  /** Tests only. */
  chatMaxBytes?: number;
  now?: () => number;
}

export interface PageCopyStore {
  /**
   * Copies `source` as version `n` of page `key` in chat `chat` (an sdkSessionId). When that version
   * already has a copy, it is kept as it is and described. Null when the source is refused or unreadable.
   */
  copy(chat: string, key: string, n: number, source: string): Promise<PageCopyResult | null>;
  /** The stored copy's `<title>` ('' when it has none), or null when there is no copy. */
  held(chat: string, key: string, n: number): Promise<PageCopyInfo | null>;
  /** The stored copy's bytes (at most the cap), or null. */
  read(chat: string, key: string, n: number): Promise<Buffer | null>;
  /** The stored copy's absolute path when it is there. Server only: never sent to the browser. */
  copyPath(chat: string, key: string, n: number): Promise<string | null>;
  /** The source still passes every check `copy` makes (without reading it). */
  sourceOk(source: string): Promise<boolean>;
  /** The chat got a new id: its folder follows. Never throws. */
  rename(from: string, to: string): Promise<void>;
  /** The chat was moved to the Bin: its pages go too. Never throws. */
  trashChat(chat: string): Promise<void>;
  /**
   * Moves to the Bin the folders of chats not in `known` (and not touched in the last hour). Does
   * nothing when `known` is empty. Returns how many it moved.
   */
  sweep(known: ReadonlySet<string>): Promise<number>;
}

const defaultTrash = (path: string): Promise<void> =>
  new Promise((done, fail) => {
    execFile(TRASH_BIN, [path], { timeout: 30_000 }, (err) => (err ? fail(err) : done()));
  });

const defaultTmpRoot = (): string => `/private/tmp/claude-${process.getuid?.() ?? 0}`;

async function realOrResolved(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return resolve(p);
  }
}

const under = (path: string, root: string): boolean => root !== '' && path.startsWith(root + sep);

/** Reads at most `max + 1` bytes from an open handle. */
async function readUpTo(handle: fs.FileHandle, max: number): Promise<Buffer> {
  const buf = Buffer.alloc(max + 1);
  let got = 0;
  while (got < buf.length) {
    const { bytesRead } = await handle.read(buf, got, buf.length - got, got);
    if (bytesRead === 0) break;
    got += bytesRead;
  }
  return buf.subarray(0, got);
}

export function createPageCopies(opts: PageCopyStoreOptions): PageCopyStore {
  const pagesDir = join(resolve(opts.dataDir), PAGES_DIR);
  const trash = opts.trash ?? defaultTrash;
  const log = opts.log ?? (() => {});
  const chatMax = opts.chatMaxBytes ?? PAGE_CHAT_MAX_BYTES;
  const now = opts.now ?? Date.now;
  const tmpRoot = opts.tmpRoot ?? defaultTmpRoot();

  /** The allowed roots and the copies folder as real paths, worked out at each check (folders come and go). */
  async function realRoots(): Promise<{ roots: string[]; pages: string }> {
    const roots = await Promise.all([tmpRoot, ...opts.roots].filter(Boolean).map(realOrResolved));
    return { roots, pages: await realOrResolved(pagesDir) };
  }

  /** The source's real path when it passes every check that needs no read; else null. */
  async function checkedReal(source: string): Promise<string | null> {
    if (!sourceShapeOk(source)) return null;
    let real: string;
    try {
      real = await fs.realpath(source);
    } catch {
      return null;
    }
    if (!/\.html?$/i.test(real)) return null;
    const { roots, pages } = await realRoots();
    if (real === pages || under(real, pages) || under(real, resolve(pagesDir))) return null;
    return roots.some((r) => under(real, r)) ? real : null;
  }

  /** The source's bytes when it is an allowed regular file within the cap; else null. */
  async function readSource(source: string): Promise<Buffer | null> {
    const real = await checkedReal(source);
    if (!real) return null;
    let handle: fs.FileHandle | null = null;
    try {
      // O_NOFOLLOW: the name Claude gave must not itself be a link. O_NONBLOCK: a FIFO can't hang us.
      handle = await fs.open(source, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
      const st = await handle.stat({ bigint: true });
      if (!st.isFile() || st.size > BigInt(PAGE_COPY_MAX_BYTES)) return null;
      // The file opened is the one the checked real path names (no folder swapped in between).
      const named = await fs.stat(real, { bigint: true });
      if (named.dev !== st.dev || named.ino !== st.ino) return null;
      const data = await readUpTo(handle, PAGE_COPY_MAX_BYTES);
      return data.length > PAGE_COPY_MAX_BYTES ? null : data;
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  function chatDir(chat: string): string | null {
    return isChatId(chat) ? join(pagesDir, chat) : null;
  }

  function copyFile(chat: string, key: string, n: number): string | null {
    const d = chatDir(chat);
    return d && isPageKey(key) && isVersion(n) ? join(d, key, `v${n}.html`) : null;
  }

  /** Our own copy, read the same careful way (never through a link). */
  async function readCopy(path: string, max: number): Promise<Buffer | null> {
    let handle: fs.FileHandle | null = null;
    try {
      handle = await fs.open(path, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
      const st = await handle.stat();
      if (!st.isFile() || st.size > PAGE_COPY_MAX_BYTES) return null;
      const data = await readUpTo(handle, Math.min(max, st.size));
      return data.subarray(0, Math.min(max, data.length));
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async function isCopy(path: string): Promise<boolean> {
    try {
      return (await fs.lstat(path)).isFile();
    } catch {
      return false;
    }
  }

  async function makeDirs(dir: string): Promise<void> {
    for (const d of [pagesDir, join(dir, '..'), dir]) {
      await fs.mkdir(d, { recursive: true, mode: 0o700 });
      await fs.chmod(d, 0o700);
    }
  }

  /** Keeps the chat's copies under its room: oldest versions first, never a page's newest copy. */
  async function makeRoom(dir: string): Promise<{ key: string; n: number }[]> {
    const files: { key: string; n: number; path: string; size: number; mtime: number }[] = [];
    const newest = new Map<string, number>();
    for (const key of await fs.readdir(dir).catch(() => [] as string[])) {
      if (!isPageKey(key)) continue;
      for (const name of await fs.readdir(join(dir, key)).catch(() => [] as string[])) {
        const m = VERSION_FILE.exec(name);
        if (!m) continue;
        const path = join(dir, key, name);
        const st = await fs.lstat(path).catch(() => null);
        if (!st?.isFile()) continue;
        const n = Number(m[1]);
        files.push({ key, n, path, size: st.size, mtime: st.mtimeMs });
        newest.set(key, Math.max(newest.get(key) ?? 0, n));
      }
    }
    let total = files.reduce((sum, f) => sum + f.size, 0);
    const evicted: { key: string; n: number }[] = [];
    const candidates = files
      .filter((f) => newest.get(f.key) !== f.n)
      .sort((a, b) => a.mtime - b.mtime || a.n - b.n);
    for (const f of candidates) {
      if (total <= chatMax) break;
      try {
        await fs.unlink(f.path);
        total -= f.size;
        evicted.push({ key: f.key, n: f.n });
      } catch {
        // gone already, or not ours to remove
      }
    }
    return evicted;
  }

  const titleOf = (data: Buffer, source: string): string =>
    pageTitle(data.subarray(0, TITLE_SCAN_BYTES).toString('utf8'), source);

  return {
    async copy(chat, key, n, source) {
      const dest = copyFile(chat, key, n);
      if (!dest || !sourceShapeOk(source)) return null;
      try {
        if (await isCopy(dest)) {
          const kept = await readCopy(dest, TITLE_SCAN_BYTES);
          return kept ? { title: titleOf(kept, source), evicted: [] } : null;
        }
        const data = await readSource(source);
        if (!data) return null;
        const dir = join(dest, '..');
        await makeDirs(dir);
        const tmp = join(dir, `.v${n}.${randomBytes(6).toString('hex')}.tmp`);
        try {
          await fs.writeFile(tmp, data, { mode: 0o600, flag: 'wx' });
          await fs.chmod(tmp, 0o444);
          // A link never replaces a file that is already there: a copy is written once.
          await fs.link(tmp, dest).catch(async (err: NodeJS.ErrnoException) => {
            if (err.code === 'EEXIST') return;
            // A disk without hard links: a rename is still atomic, and this chat's jobs run one at a time.
            if (await isCopy(dest)) return;
            await fs.rename(tmp, dest);
          });
        } finally {
          await fs.unlink(tmp).catch(() => {});
        }
        const evicted = await makeRoom(join(dir, '..'));
        return { title: titleOf(data, source), evicted };
      } catch {
        log('Could not keep a copy of a page.');
        return null;
      }
    },

    async held(chat, key, n) {
      const path = copyFile(chat, key, n);
      const head = path ? await readCopy(path, TITLE_SCAN_BYTES) : null;
      // No file name to fall back on here: '' for an untitled page, and the caller names it.
      return head ? { title: titleOf(head, '') } : null;
    },

    async read(chat, key, n) {
      const path = copyFile(chat, key, n);
      return path ? readCopy(path, PAGE_COPY_MAX_BYTES) : null;
    },

    async copyPath(chat, key, n) {
      const path = copyFile(chat, key, n);
      return path && (await isCopy(path)) ? path : null;
    },

    async sourceOk(source) {
      const real = await checkedReal(source);
      if (!real) return false;
      try {
        const st = await fs.lstat(source);
        return st.isFile() && st.size <= PAGE_COPY_MAX_BYTES;
      } catch {
        return false;
      }
    },

    async rename(from, to) {
      const a = chatDir(from);
      const b = chatDir(to);
      if (!a || !b || a === b) return;
      try {
        const st = await fs.lstat(a).catch(() => null);
        if (!st?.isDirectory()) return;
        if (!(await fs.lstat(b).catch(() => null))) {
          await fs.rename(a, b);
          return;
        }
        // Both there: bring over the pages the new folder lacks; the rest stays for the sweep.
        for (const key of await fs.readdir(a)) {
          if (!isPageKey(key)) continue;
          if (await fs.lstat(join(b, key)).catch(() => null)) continue;
          await fs.rename(join(a, key), join(b, key));
        }
      } catch {
        log("Could not move a chat's pages to its new id.");
      }
    },

    async trashChat(chat) {
      const d = chatDir(chat);
      if (!d) return;
      try {
        const st = await fs.lstat(d).catch(() => null);
        if (!st?.isDirectory()) return;
        await trash(d);
      } catch {
        log("A chat's pages couldn't be moved to the Bin.");
      }
    },

    async sweep(known) {
      // No chats listed at all is more likely a history that couldn't be read than every chat deleted
      // (a delete moves its own pages): never sweep everything on that.
      if (known.size === 0) return 0;
      let moved = 0;
      const names = await fs.readdir(pagesDir).catch(() => [] as string[]);
      for (const name of names) {
        if (!isChatId(name) || known.has(name)) continue;
        const d = join(pagesDir, name);
        const st = await fs.lstat(d).catch(() => null);
        if (!st?.isDirectory() || now() - st.mtimeMs < SWEEP_GRACE_MS) continue;
        try {
          await trash(d);
          moved++;
        } catch {
          log("Pages of a deleted chat couldn't be moved to the Bin.");
          break;
        }
      }
      return moved;
    },
  };
}
