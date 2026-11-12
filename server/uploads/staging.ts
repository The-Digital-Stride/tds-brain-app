/**
 * The staging folder for chat attachments (docs/plans/2026-11-12-chat-attachments.md, decisions 3–5
 * and 9 as changed by the overseer's outcomes).
 *
 * Files wait in `<dataDir>/uploads/<uuid>/<safe name>` until they go with a message. The folder is
 * never inside the brain (nor the brain inside it); if it would be, uploads are switched off. The
 * browser only ever holds the opaque id; the path is only ever given to Claude.
 *
 * Lifetime: an unsent upload goes 1 hour after it arrived; a sent one 24 hours after it was sent.
 * "Sent" is written to disk (a `.sent` file in the upload's folder) so a restart keeps sent files;
 * unsent ones from before a restart are deleted, since the page's ids are gone anyway.
 */
import { randomUUID } from 'node:crypto';
import { chmodSync, createWriteStream, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  MAX_STAGED_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_TYPES,
  type UploadInfo,
  type UploadKind,
} from '../../shared/contract.ts';

export type StagedFile = UploadInfo & { path: string };

export interface UploadStaging {
  /** The real path of the staging folder; null when uploads are off. */
  readonly root: string | null;
  save(req: Readable, rawName: string | undefined, declaredBytes: number | null): Promise<UploadInfo>;
  /** Unknown or sent id: no error, and nothing is deleted if it was sent. */
  discard(id: string): Promise<void>;
  /** Synchronous. Throws UploadError('gone') if any id is unknown, already sent or expired. No change. */
  peek(ids: string[]): StagedFile[];
  /** Synchronous, all or nothing: marks the ids sent (on disk in the background) and returns them. */
  claim(ids: string[]): { files: StagedFile[]; release(): void };
  sweep(): Promise<void>;
  /**
   * The first sweep, then one every 10 minutes. Call it only once this process owns the app (after
   * `listen`): a second `pnpm start` that finds the port taken must never sweep the shared folder.
   */
  start(): void;
  /** Stops the sweep timer. */
  close(): void;
}

export type UploadErrorCode =
  | 'off'
  | 'bad-name'
  | 'bad-type'
  | 'no-length'
  | 'too-large'
  | 'full'
  | 'busy'
  | 'aborted'
  | 'no-space'
  | 'gone'
  | 'failed';

/** `message` is plain UK English, fit to show the person as it is. */
export class UploadError extends Error {
  readonly code: UploadErrorCode;
  constructor(code: UploadErrorCode, message: string) {
    super(message);
    this.name = 'UploadError';
    this.code = code;
  }
}

export const GONE_MESSAGE = 'That file is no longer attached. Add it again.';

const MESSAGES: Record<Exclude<UploadErrorCode, 'bad-type'>, string> = {
  off: "Attaching files is switched off on this computer, because the app's data folder can't be used for them safely. Tell whoever looks after the brain.",
  'bad-name': 'That file has no name, so it could not be attached.',
  'no-length': 'The app sent that file in a way it could not read. Reload the page and try again.',
  'too-large': `That file is too large to attach. Files can be up to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
  full: 'Too many files are waiting to be sent. Send or remove some, then try again.',
  busy: 'Too many files are being attached at once. Wait for them to finish, then try again.',
  aborted: 'That file did not arrive in full. Try attaching it again.',
  'no-space': 'Your Mac is out of space, so that file could not be attached.',
  gone: GONE_MESSAGE,
  failed: 'That file could not be attached. Try again.',
};

function fail(code: Exclude<UploadErrorCode, 'bad-type'>): UploadError {
  return new UploadError(code, MESSAGES[code]);
}

const UNSENT_MS = 60 * 60 * 1000;
const SENT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SWEEP_MS = 10 * 60 * 1000;
const MAX_AT_ONCE = 4;
const NAME_CHARS = 120;
const SENT_MARK = '.sent';
const PART_FILE = '.part';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The name shown and given to Claude: decoded, last path segment, NFC, with control, format (bidi)
 * and line characters and `/ \ : < > \`` removed, spaces collapsed, dots and spaces trimmed from the
 * ends, at most 120 characters keeping the extension. Never empty: `file`.
 */
export function safeName(raw: string): string {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // not valid encoding: take it as it is
  }
  const last =
    text
      .split(/[/\\]/)
      .filter((s) => s.length > 0)
      .pop() ?? '';
  let name = last
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/[:<>`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const chars = Array.from(name);
  if (chars.length > NAME_CHARS) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? Array.from(name.slice(dot)) : [];
    const keep = ext.length > 0 && ext.length <= 20 ? ext : [];
    const base = chars
      .slice(0, NAME_CHARS - keep.length)
      .join('')
      .replace(/[.\s]+$/, '');
    name = base + keep.join('');
  }
  return name || 'file';
}

/** The extension, lower case and without the dot, or '' when there is none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function kindOf(name: string): UploadKind | null {
  const ext = extensionOf(name);
  return Object.hasOwn(UPLOAD_TYPES, ext) ? (UPLOAD_TYPES[ext] ?? null) : null;
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

function realOrResolved(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Claude Code's permission rules are gitignore patterns and the app cannot escape them, so a path
 * with `[ ] * ? \\` anywhere, or a `!` starting a folder name, cannot be named safely in one.
 */
export function hasPatternCharacters(path: string): boolean {
  return /[[\]*?\\]/.test(path) || path.split('/').some((seg) => seg.startsWith('!'));
}

/** Makes `<dataDir>/uploads` and returns its real path, or null when it is not safe to use. */
function prepareRoot(dataDir: string, brainRoot: string, log: (line: string) => void): string | null {
  const dir = join(resolve(dataDir), 'uploads');
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) {
      log('Attaching files is off: the uploads folder is not a plain folder.');
      return null;
    }
    const uid = process.getuid?.();
    if (uid !== undefined && st.uid !== uid) {
      log('Attaching files is off: the uploads folder belongs to someone else.');
      return null;
    }
    chmodSync(dir, 0o700);
    const real = realpathSync.native(dir);
    if (hasPatternCharacters(real)) {
      log(
        "Attaching files is off: the app's data folder has characters in its path that Claude Code's permission rules would misread.",
      );
      return null;
    }
    const brain = realOrResolved(brainRoot);
    if (isInside(real, brain) || isInside(brain, real)) {
      log("Attaching files is off: the app's data folder and the brain folder overlap.");
      return null;
    }
    return real;
  } catch {
    log('Attaching files is off: the uploads folder could not be set up.');
    return null;
  }
}

interface Entry {
  info: UploadInfo;
  dir: string;
  path: string;
  uploadedAt: number;
  sentAt: number | null;
  /** Writes of the sent mark, in order. */
  disk: Promise<void>;
}

export interface UploadStagingOptions {
  dataDir: string;
  brainRoot: string;
  now?: () => number;
  /** How often the sweep runs; 0 for never (tests). Default 10 minutes. */
  sweepMs?: number;
  maxStagedBytes?: number;
  maxUploadBytes?: number;
  log?: (line: string) => void;
}

export function createUploadStaging(opts: UploadStagingOptions): UploadStaging {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const maxStaged = opts.maxStagedBytes ?? MAX_STAGED_BYTES;
  const maxUpload = opts.maxUploadBytes ?? MAX_UPLOAD_BYTES;
  const root = prepareRoot(opts.dataDir, opts.brainRoot, log);
  const entries = new Map<string, Entry>();
  /** Folders being written right now: the sweep never touches them. */
  const inFlight = new Set<string>();
  let reserved = 0;
  let sweeping: Promise<void> = Promise.resolve();

  function stagedBytes(): number {
    let total = reserved;
    for (const e of entries.values()) total += e.info.size;
    return total;
  }

  function isLiveUnsent(e: Entry, t: number): boolean {
    return e.sentAt === null && t - e.uploadedAt <= UNSENT_MS;
  }

  function markOnDisk(e: Entry): void {
    const sentAt = e.sentAt;
    const mark = join(e.dir, SENT_MARK);
    e.disk = e.disk
      .then(() =>
        sentAt === null ? rm(mark, { force: true }) : writeFile(mark, String(sentAt), { mode: 0o600 }),
      )
      .catch(() => {});
  }

  function lookup(ids: string[]): Entry[] {
    const t = now();
    const out: Entry[] = [];
    for (const id of ids) {
      const e = typeof id === 'string' ? entries.get(id) : undefined;
      if (!e || !isLiveUnsent(e, t)) throw fail('gone');
      out.push(e);
    }
    return out;
  }

  const staged = (e: Entry): StagedFile => ({ ...e.info, path: e.path });

  async function remove(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  /** A folder from an earlier run that was sent: kept (and counted) until 24 hours after sending. */
  async function adopt(id: string, dir: string, t: number): Promise<boolean> {
    try {
      const sentAt = Number((await readFile(join(dir, SENT_MARK), 'utf8')).trim());
      if (!Number.isFinite(sentAt) || sentAt <= 0 || t - sentAt > SENT_MS) return false;
      const names = (await readdir(dir)).filter((n) => n !== SENT_MARK);
      const name = names[0];
      if (names.length !== 1 || !name) return false;
      const path = join(dir, name);
      const st = await lstat(path);
      const kind = kindOf(name);
      if (!st.isFile() || !kind) return false;
      entries.set(id, {
        info: { id, name, size: st.size, kind },
        dir,
        path,
        uploadedAt: sentAt,
        sentAt,
        disk: Promise.resolve(),
      });
      return true;
    } catch {
      return false;
    }
  }

  async function sweepOnce(): Promise<void> {
    if (!root) return;
    const t = now();
    for (const [id, e] of [...entries]) {
      const expired = e.sentAt === null ? t - e.uploadedAt > UNSENT_MS : t - e.sentAt > SENT_MS;
      if (expired) {
        entries.delete(id);
        await e.disk;
        await remove(e.dir);
      }
    }
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      return;
    }
    for (const name of names) {
      if (inFlight.has(name) || entries.has(name)) continue;
      const path = join(root, name);
      let keep = false;
      try {
        const st = await lstat(path);
        keep = st.isDirectory() && UUID.test(name) && (await adopt(name, path, t));
      } catch {
        continue; // already gone
      }
      // Recheck: a save may have started with this name while we looked.
      if (!keep && !inFlight.has(name) && !entries.has(name)) await remove(path);
    }
  }

  function sweep(): Promise<void> {
    sweeping = sweeping.then(sweepOnce).catch(() => {});
    return sweeping;
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;

  async function write(req: Readable, dir: string, part: string, declared: number): Promise<void> {
    const limit = Math.min(declared, maxUpload);
    let count = 0;
    let tooLarge = false;
    // destroyOnReturn: false, so refusing a body never tears down the socket the reply goes on.
    const source = req.iterator({ destroyOnReturn: false });
    async function* counted() {
      for await (const chunk of source) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        count += buf.length;
        if (count > limit) {
          tooLarge = true;
          throw fail('too-large');
        }
        yield buf;
      }
    }
    try {
      await mkdir(dir, { mode: 0o700 });
      await pipeline(counted, createWriteStream(part, { flags: 'wx', mode: 0o600 }));
    } catch (err) {
      if (tooLarge) throw fail('too-large');
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === 'ENOSPC' || code === 'EDQUOT') throw fail('no-space');
      if (err instanceof UploadError) throw err;
      throw fail('aborted');
    }
    if (count !== declared) throw fail('aborted');
  }

  return {
    root,

    async save(req, rawName, declaredBytes) {
      // A cut-short request emits 'error' whether or not it is being read: never let that go unheard.
      req.on('error', () => {});
      if (!root) throw fail('off');
      if (typeof rawName !== 'string' || rawName.trim() === '') throw fail('bad-name');
      const name = safeName(rawName);
      const kind = kindOf(name);
      if (!kind) {
        const ext = extensionOf(name);
        throw new UploadError(
          'bad-type',
          ext && ext.length <= 12
            ? `TDS Brain can't pass on .${ext} files. Attach a document, spreadsheet, slide deck, text file or picture.`
            : "TDS Brain can't pass on that kind of file. Attach a document, spreadsheet, slide deck, text file or picture.",
        );
      }
      if (declaredBytes === null || !Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
        throw fail('no-length');
      }
      if (declaredBytes > maxUpload) throw fail('too-large');
      if (inFlight.size >= MAX_AT_ONCE) throw fail('busy');
      if (stagedBytes() + declaredBytes > maxStaged) throw fail('full');

      const id = randomUUID();
      const dir = join(root, id);
      const part = join(dir, PART_FILE);
      const path = join(dir, name);
      inFlight.add(id);
      reserved += declaredBytes;
      try {
        await write(req, dir, part, declaredBytes);
        await rename(part, path);
        const info: UploadInfo = { id, name, size: declaredBytes, kind };
        entries.set(id, { info, dir, path, uploadedAt: now(), sentAt: null, disk: Promise.resolve() });
        return info;
      } catch (err) {
        await remove(dir);
        if (err instanceof UploadError) throw err;
        const code = (err as NodeJS.ErrnoException | null)?.code;
        throw fail(code === 'ENOSPC' || code === 'EDQUOT' ? 'no-space' : 'failed');
      } finally {
        reserved -= declaredBytes;
        inFlight.delete(id);
      }
    },

    async discard(id) {
      const e = typeof id === 'string' ? entries.get(id) : undefined;
      if (!e || e.sentAt !== null) return;
      entries.delete(id);
      await e.disk; // a released claim may still be clearing its sent mark
      await remove(e.dir);
    },

    peek(ids) {
      return lookup(ids).map(staged);
    },

    claim(ids) {
      const claimed = lookup(ids);
      if (new Set(claimed).size !== claimed.length) throw fail('gone');
      const t = now();
      for (const e of claimed) {
        e.sentAt = t;
        markOnDisk(e);
      }
      let released = false;
      return {
        files: claimed.map(staged),
        release() {
          if (released) return;
          released = true;
          for (const e of claimed) {
            if (e.sentAt !== t) continue;
            e.sentAt = null;
            markOnDisk(e);
          }
        },
      };
    },

    async sweep() {
      await sweep();
      // Let any sent marks still being written reach the disk.
      await Promise.all([...entries.values()].map((e) => e.disk));
    },

    start() {
      if (started || !root) return;
      started = true;
      void sweep();
      const every = opts.sweepMs ?? DEFAULT_SWEEP_MS;
      if (every > 0) {
        timer = setInterval(() => void sweep(), every);
        timer.unref?.();
      }
    },

    close() {
      started = true; // a closed folder never starts sweeping
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
