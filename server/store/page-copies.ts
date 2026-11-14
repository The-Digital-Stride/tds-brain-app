/**
 * The app's own copies of the pages Claude writes in a chat (plan docs/plans/2026-11-14-artifacts-in-app.md,
 * decision 2 and revision 2): `<dataDir>/pages/<brain>/<sdkSessionId>/<key>/…`, never in the brain.
 * `<brain>` is a hash of the brain's real path, so each brain's chats keep their own folders and a sweep
 * only ever looks at the current brain's.
 *
 * Each page has at most one in-progress copy (`d-<toolUseId>.html`, rewritten while the turn runs) and one
 * kept copy per version (`v-<toolUseId>.html`), named by the tool use that last touched the page, so a
 * replayed chat can never pair a version with another version's file.
 *
 * The source path comes from the model, so it is checked hard before a byte is read: absolute, `.html` /
 * `.htm`, no control characters, at most 1024 characters, its real path under Claude's temporary folder
 * (only when that folder is a plain one of this user's that nobody else can write to), the brain or the
 * session's folder, and not one of the app's own copies. The read follows the library's `openChecked`
 * pattern: open with O_RDONLY | O_NOFOLLOW | O_NONBLOCK, `fstat` the handle (a regular file, the same one
 * the real path names), take the size from the handle and read at most the cap + 1 bytes from it. No
 * check-then-open race, and a FIFO never hangs the read.
 *
 * Folders are 0o700. A copy is written to a 0o600 temporary file, made read-only (0o444) and moved into
 * place, so it is atomic; a kept copy is never rewritten. Moving a chat's folder away goes to the macOS
 * Bin; only the per-chat room rule (older kept versions) and a replaced in-progress copy are removed.
 */
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { SESSION_UUID_PATTERN } from '../../shared/contract.ts';
import { isRealPage, pageTitle } from '../../shared/pages.ts';
import { PAGE_COPY_MAX_BYTES } from '../../shared/pages-contract.ts';

export const PAGES_DIR = 'pages';
/** Copies kept per chat; over it, the oldest versions lose their copy first (never a page's newest). */
export const PAGE_CHAT_MAX_BYTES = 200 * 1024 * 1024;
/** A folder touched this recently is never swept: its chat's history may not be on disk yet. */
const SWEEP_GRACE_MS = 60 * 60 * 1000;
const SOURCE_MAX_CHARS = 1024;
const TITLE_SCAN_BYTES = 64 * 1024;
const TRASH_BIN = '/usr/bin/trash';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COPY_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const KEPT_FILE = /^v-([A-Za-z0-9_-]{1,128})\.html$/;
const DRAFT_FILE = /^d-([A-Za-z0-9_-]{1,128})\.html$/;

/** A page key that is safe as one folder name (and in an address). */
export function isPageKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_RE.test(key);
}

/** A tool use id that is safe in a copy's file name. */
export function isCopyId(id: unknown): id is string {
  return typeof id === 'string' && COPY_ID_RE.test(id);
}

const isChatId = (id: unknown): id is string => typeof id === 'string' && SESSION_UUID_PATTERN.test(id);

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

/** The folder for one brain's copies: a short hash of its real path. */
export function brainFolder(brainRealPath: string): string {
  return createHash('sha256').update(`brain:${brainRealPath}`).digest('base64url').slice(0, 16);
}

export interface PageCopyInfo {
  title: string;
}

export type Evicted = { key: string; id: string }[];

export interface PageDraftResult extends PageCopyInfo {
  /** `isRealPage` of the file's start (O8). */
  page: boolean;
}

export interface PageCopyStoreOptions {
  dataDir: string;
  /** The brain this store serves (configured path; its real path names the copies' folder). */
  brainRoot: string;
  /** Folders a source may sit in besides Claude's temporary folder: the brain (configured and real) and the session's folder. */
  roots: readonly string[];
  /** Claude's temporary folder. Default `/private/tmp/claude-<uid>`. Trusted only when it is safe (see the file comment). */
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
   * Where a written page really is: its real path (through the deepest folder that exists, so a file
   * since cleared away still has the same spelling) when its shape is right, it sits under an allowed
   * root and it is not one of the app's copies; else null. Reads nothing.
   */
  locate(source: string): Promise<string | null>;
  /**
   * Copies `source` as page `key`'s in-progress copy for tool use `id`, replacing the page's earlier
   * one. With `mustBePage`, a file that is not a real page (`isRealPage`) is not copied and comes back
   * with `page: false`. Null when the source is refused or unreadable.
   */
  draft(
    chat: string,
    key: string,
    id: string,
    source: string,
    mustBePage: boolean,
  ): Promise<PageDraftResult | null>;
  /**
   * The in-progress copy `id` becomes the kept copy of that version (read-only, never rewritten). Null
   * when there is no such in-progress copy and no kept one either.
   */
  keep(chat: string, key: string, id: string): Promise<{ evicted: Evicted } | null>;
  /** Copies `source` straight to kept copy `id`; an existing one is kept as it is. Null when refused. */
  copy(
    chat: string,
    key: string,
    id: string,
    source: string,
  ): Promise<(PageCopyInfo & { evicted: Evicted }) | null>;
  /** The kept copy's `<title>` ('' when it has none), or null when there is none. */
  held(chat: string, key: string, id: string): Promise<PageCopyInfo | null>;
  /** A copy's bytes (at most the cap), or null. */
  read(chat: string, key: string, id: string, which: 'kept' | 'draft'): Promise<Buffer | null>;
  /** Where kept copy `id` is (or will be once its in-progress copy is kept). Server only: never sent to the browser. */
  keptPath(chat: string, key: string, id: string): Promise<string | null>;
  /** `isRealPage` of the source as it is now, read with every check `draft` makes; null when unreadable. */
  isPage(source: string): Promise<boolean | null>;
  /** The source still passes every check `copy` makes (without reading it). */
  sourceOk(source: string): Promise<boolean>;
  /** The chat got a new id: its folder follows. Never throws. */
  rename(from: string, to: string): Promise<void>;
  /** The chat was moved to the Bin: its pages go too. Never throws. */
  trashChat(chat: string): Promise<void>;
  /**
   * Moves to the Bin this brain's folders of chats not in `known` (and not touched in the last hour).
   * Does nothing when `known` is empty. Returns how many it moved.
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

/** The real path of `p` through its deepest folder that exists (the rest as written, `..` already gone). */
async function realThrough(p: string): Promise<string> {
  const abs = resolve(p);
  let head = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(head);
      return tail.length > 0 ? join(real, ...tail.reverse()) : real;
    } catch {
      const up = dirname(head);
      if (up === head) return abs;
      tail.push(basename(head));
      head = up;
    }
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

/** Claude's temporary folder counts only when it is a plain folder of this user's that only they can write to. */
async function trustedTmp(tmpRoot: string): Promise<string | null> {
  try {
    const st = await fs.lstat(tmpRoot);
    const uid = process.getuid?.();
    if (!st.isDirectory() || (uid !== undefined && st.uid !== uid) || (st.mode & 0o022) !== 0) return null;
    return await fs.realpath(tmpRoot);
  } catch {
    return null;
  }
}

export function createPageCopies(opts: PageCopyStoreOptions): PageCopyStore {
  const pagesRoot = join(resolve(opts.dataDir), PAGES_DIR);
  const trash = opts.trash ?? defaultTrash;
  const log = opts.log ?? (() => {});
  const chatMax = opts.chatMaxBytes ?? PAGE_CHAT_MAX_BYTES;
  const now = opts.now ?? Date.now;
  const tmpRoot = opts.tmpRoot ?? defaultTmpRoot();
  let brainDir: Promise<string> | null = null;

  /** This brain's folder of chats (worked out once: the brain's real path doesn't change under a running app). */
  function brainBase(): Promise<string> {
    brainDir ??= realOrResolved(opts.brainRoot).then((real) => join(pagesRoot, brainFolder(real)));
    return brainDir;
  }

  /** The allowed roots and the copies folder as real paths, worked out at each check (folders come and go). */
  async function realRoots(): Promise<{ roots: string[]; pages: string }> {
    const [tmp, ...rest] = await Promise.all([
      trustedTmp(tmpRoot),
      ...opts.roots.filter(Boolean).map(realOrResolved),
    ]);
    const roots = [tmp, ...rest].filter((r): r is string => typeof r === 'string' && r !== '');
    return { roots, pages: await realOrResolved(pagesRoot) };
  }

  /** `real` is an allowed place for a page source. */
  async function allowed(real: string): Promise<boolean> {
    if (!/\.html?$/i.test(real)) return false;
    const { roots, pages } = await realRoots();
    if (real === pages || under(real, pages) || under(real, pagesRoot)) return false;
    return roots.some((r) => under(real, r));
  }

  /** The source's real path when it exists and passes every check that needs no read; else null. */
  async function checkedReal(source: string): Promise<string | null> {
    if (!sourceShapeOk(source)) return null;
    let real: string;
    try {
      real = await fs.realpath(source);
    } catch {
      return null;
    }
    return (await allowed(real)) ? real : null;
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
      // Sized to the file, not the cap: most pages are a few KB, and every Write of one is read here.
      const size = Number(st.size);
      const data = await readUpTo(handle, size);
      // Grown since it was checked: changing under us, so no copy rather than a cut one.
      return data.length > size ? null : data;
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async function chatDir(chat: string): Promise<string | null> {
    return isChatId(chat) ? join(await brainBase(), chat) : null;
  }

  async function pageDir(chat: string, key: string): Promise<string | null> {
    const d = await chatDir(chat);
    return d && isPageKey(key) ? join(d, key) : null;
  }

  async function fileFor(
    chat: string,
    key: string,
    id: string,
    which: 'kept' | 'draft',
  ): Promise<string | null> {
    const d = await pageDir(chat, key);
    return d && isCopyId(id) ? join(d, `${which === 'kept' ? 'v' : 'd'}-${id}.html`) : null;
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

  async function isFile(path: string): Promise<boolean> {
    try {
      return (await fs.lstat(path)).isFile();
    } catch {
      return false;
    }
  }

  async function makeDirs(dir: string): Promise<void> {
    const base = await brainBase();
    for (const d of [pagesRoot, base, dirname(dir), dir]) {
      await fs.mkdir(d, { recursive: true, mode: 0o700 });
      await fs.chmod(d, 0o700);
    }
  }

  /** Writes `data` read-only at `dest` through a temporary file. `replace`: an existing file there is replaced. */
  async function writeCopy(dest: string, data: Buffer, replace: boolean): Promise<void> {
    const dir = dirname(dest);
    await makeDirs(dir);
    const tmp = join(dir, `.${basename(dest)}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      await fs.writeFile(tmp, data, { mode: 0o600, flag: 'wx' });
      await fs.chmod(tmp, 0o444);
      if (replace) {
        await fs.rename(tmp, dest);
        return;
      }
      // A link never replaces a file that is already there: a kept copy is written once.
      await fs.link(tmp, dest).catch(async (err: NodeJS.ErrnoException) => {
        if (err.code === 'EEXIST') return;
        // A disk without hard links: a rename is still atomic, and this chat's jobs run one at a time.
        if (await isFile(dest)) return;
        await fs.rename(tmp, dest);
      });
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  }

  /** Removes the page's in-progress copies other than `keepName`. */
  async function dropDrafts(dir: string, keepName: string | null): Promise<void> {
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      if (name === keepName || !DRAFT_FILE.test(name)) continue;
      await fs.unlink(join(dir, name)).catch(() => {});
    }
  }

  /** Keeps the chat's copies under its room: oldest kept versions first, never a page's newest or an in-progress copy. */
  async function makeRoom(dir: string): Promise<Evicted> {
    const kept: { key: string; id: string; path: string; size: number; mtime: number }[] = [];
    let total = 0;
    const newest = new Map<string, { mtime: number; id: string }>();
    for (const key of await fs.readdir(dir).catch(() => [] as string[])) {
      if (!isPageKey(key)) continue;
      for (const name of await fs.readdir(join(dir, key)).catch(() => [] as string[])) {
        const k = KEPT_FILE.exec(name);
        if (!k && !DRAFT_FILE.test(name)) continue;
        const path = join(dir, key, name);
        const st = await fs.lstat(path).catch(() => null);
        if (!st?.isFile()) continue;
        total += st.size;
        if (!k?.[1]) continue;
        kept.push({ key, id: k[1], path, size: st.size, mtime: st.mtimeMs });
        const best = newest.get(key);
        if (!best || st.mtimeMs >= best.mtime) newest.set(key, { mtime: st.mtimeMs, id: k[1] });
      }
    }
    const evicted: Evicted = [];
    const candidates = kept.filter((f) => newest.get(f.key)?.id !== f.id).sort((a, b) => a.mtime - b.mtime);
    for (const f of candidates) {
      if (total <= chatMax) break;
      try {
        await fs.unlink(f.path);
        total -= f.size;
        evicted.push({ key: f.key, id: f.id });
      } catch {
        // gone already, or not ours to remove
      }
    }
    return evicted;
  }

  const titleOf = (data: Buffer, source: string): string =>
    pageTitle(data.subarray(0, TITLE_SCAN_BYTES).toString('utf8'), source);
  const pageOf = (data: Buffer): boolean => isRealPage(data.subarray(0, TITLE_SCAN_BYTES).toString('utf8'));

  return {
    async locate(source) {
      if (!sourceShapeOk(source)) return null;
      try {
        const real = await realThrough(source);
        return (await allowed(real)) ? real : null;
      } catch {
        return null;
      }
    },

    async draft(chat, key, id, source, mustBePage) {
      const dest = await fileFor(chat, key, id, 'draft');
      if (!dest || !sourceShapeOk(source)) return null;
      try {
        const data = await readSource(source);
        if (!data) return null;
        const page = pageOf(data);
        const title = titleOf(data, source);
        if (mustBePage && !page) return { title, page };
        await writeCopy(dest, data, true);
        await dropDrafts(dirname(dest), basename(dest));
        return { title, page };
      } catch {
        log('Could not keep a copy of a page.');
        return null;
      }
    },

    async keep(chat, key, id) {
      const kept = await fileFor(chat, key, id, 'kept');
      const draft = await fileFor(chat, key, id, 'draft');
      if (!kept || !draft) return null;
      try {
        if (await isFile(kept)) {
          await fs.unlink(draft).catch(() => {});
          return { evicted: [] };
        }
        if (!(await isFile(draft))) return null;
        await fs.chmod(draft, 0o444);
        await fs.link(draft, kept).catch(async (err: NodeJS.ErrnoException) => {
          if (err.code === 'EEXIST') return;
          if (await isFile(kept)) return;
          await fs.rename(draft, kept);
        });
        await fs.unlink(draft).catch(() => {});
        return { evicted: await makeRoom(dirname(dirname(kept))) };
      } catch {
        log('Could not keep a copy of a page.');
        return null;
      }
    },

    async copy(chat, key, id, source) {
      const dest = await fileFor(chat, key, id, 'kept');
      if (!dest || !sourceShapeOk(source)) return null;
      try {
        if (await isFile(dest)) {
          const head = await readCopy(dest, TITLE_SCAN_BYTES);
          return head ? { title: titleOf(head, source), evicted: [] } : null;
        }
        const data = await readSource(source);
        if (!data) return null;
        await writeCopy(dest, data, false);
        return { title: titleOf(data, source), evicted: await makeRoom(dirname(dirname(dest))) };
      } catch {
        log('Could not keep a copy of a page.');
        return null;
      }
    },

    async held(chat, key, id) {
      const path = await fileFor(chat, key, id, 'kept');
      const head = path ? await readCopy(path, TITLE_SCAN_BYTES) : null;
      // No file name to fall back on here: '' for an untitled page, and the caller names it.
      return head ? { title: titleOf(head, '') } : null;
    },

    async read(chat, key, id, which) {
      const path = await fileFor(chat, key, id, which);
      return path ? readCopy(path, PAGE_COPY_MAX_BYTES) : null;
    },

    keptPath(chat, key, id) {
      return fileFor(chat, key, id, 'kept');
    },

    async isPage(source) {
      const data = await readSource(source);
      return data ? pageOf(data) : null;
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
      const a = await chatDir(from);
      const b = await chatDir(to);
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
      const d = await chatDir(chat);
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
      const base = await brainBase();
      let moved = 0;
      const names = await fs.readdir(base).catch(() => [] as string[]);
      for (const name of names) {
        if (!isChatId(name) || known.has(name)) continue;
        const d = join(base, name);
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
