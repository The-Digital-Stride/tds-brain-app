/**
 * Small pictures of images (plan decision 7). Always re-made as WebP by `sharp`, never passed
 * through, and cached in `<dataDir>/thumbs/`, never in the brain.
 *
 * The checked file is read into memory and given to `sharp` as bytes: an SVG opened by path can draw
 * neighbouring files, from bytes it draws none. SVGs are drawn in a child process that is killed at
 * a hard time limit (`svg-render.ts`): a tiny SVG can take many seconds, and `sharp`'s own timeout
 * does not stop it.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { type LibraryFile, THUMB_WIDTHS, type Thumbnailer, type ThumbWidth } from '../../shared/contract.ts';
import { looksLikeRaster, readChecked, SVG_MAX_BYTES, THUMB_MAX_BYTES } from './library.ts';

/** Fits inside the asked width and this height: a width-only resize of a very long image fails. */
export const THUMB_MAX_HEIGHT = 16_000;
const DEFAULT_MAX_PIXELS = 100_000_000;
const DEFAULT_TIMEOUT_SECONDS = 20;
const DEFAULT_SVG_TIMEOUT_MS = 5000;
const DEFAULT_CONCURRENCY = 2;
const MAX_REMEMBERED_FAILURES = 5000;
const MAX_SVG_OUTPUT = 32 * 1024 * 1024;
const SVG_RENDERER = join(import.meta.dirname, 'svg-render.ts');

export interface ThumbOptions {
  /** The brain's root: nothing is ever written under it, even if the data folder is put there. */
  brainRoot?: string;
  maxConcurrent?: number;
  timeoutSeconds?: number;
  /** Wall-clock limit for one SVG, after which its process is killed. */
  svgTimeoutMs?: number;
  maxPixels?: number;
  /** Tests count generations. */
  onGenerate?: () => void;
  onGenerated?: () => void;
}

type DrawResult = Buffer | 'failed' | 'unavailable';

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** At most `n` at once; the rest wait their turn. */
function limiter(n: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return {
    async acquire(): Promise<void> {
      if (running < n) {
        running++;
        return;
      }
      await new Promise<void>((r) => waiting.push(r));
    },
    release(): void {
      const next = waiting.shift();
      if (next) next();
      else running--;
    },
  };
}

/** Draws an SVG's bytes in a child process, killed at the time limit (a timeout is a failure). */
function renderSvg(data: Buffer, width: number, maxPixels: number, timeoutMs: number): Promise<DrawResult> {
  return new Promise((done) => {
    let settled = false;
    const chunks: Buffer[] = [];
    let size = 0;
    const child = spawn(
      process.execPath,
      [SVG_RENDERER, String(width), String(THUMB_MAX_HEIGHT), String(maxPixels)],
      // No inherited options or environment, and nothing in the working folder to read.
      { stdio: ['pipe', 'pipe', 'ignore'], cwd: tmpdir(), env: {}, windowsHide: true },
    );
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish('failed');
    }, timeoutMs);
    function finish(r: DrawResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(r);
    }
    child.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_SVG_OUTPUT) {
        child.kill('SIGKILL');
        finish('failed');
        return;
      }
      chunks.push(c);
    });
    child.on('error', () => finish('unavailable'));
    child.on('close', (code) => finish(code === 0 && size > 0 ? Buffer.concat(chunks) : 'failed'));
    child.stdin.on('error', () => {});
    child.stdin.end(data);
  });
}

export function createThumbnailer(dataDir: string, opts: ThumbOptions = {}): Thumbnailer {
  const cacheDir = join(resolve(dataDir), 'thumbs');
  const slots = limiter(Math.max(1, opts.maxConcurrent ?? DEFAULT_CONCURRENCY));
  const svgSlot = limiter(1);
  const maxPixels = opts.maxPixels ?? DEFAULT_MAX_PIXELS;
  const failed = new Map<string, true>();
  const inflight = new Map<string, Promise<string | null>>();
  let allowed: Promise<boolean> | null = null;

  /** False when the data folder sits inside the brain. */
  function writable(): Promise<boolean> {
    allowed ??= (async () => {
      if (!opts.brainRoot) return true;
      const dir = resolve(dataDir);
      const roots = [resolve(opts.brainRoot)];
      try {
        roots.push(await fs.realpath(opts.brainRoot));
      } catch {}
      let dirReal = dir;
      try {
        dirReal = await fs.realpath(dir);
      } catch {}
      return !roots.some((r) => isInside(dir, r) || isInside(dirReal, r));
    })();
    return allowed;
  }

  function remember(failKey: string): void {
    if (failed.size >= MAX_REMEMBERED_FAILURES) {
      const oldest = failed.keys().next().value;
      if (oldest !== undefined) failed.delete(oldest);
    }
    failed.set(failKey, true);
  }

  async function exists(path: string): Promise<boolean> {
    try {
      const st = await fs.lstat(path);
      return st.isFile() && st.size > 0;
    } catch {
      return false;
    }
  }

  /** The WebP bytes, 'failed' (remembered for this version) or 'unavailable' (tried again later). */
  async function draw(file: LibraryFile, width: ThumbWidth): Promise<DrawResult> {
    const svg = file.item.ext === 'svg';
    const read = await readChecked(file, svg ? SVG_MAX_BYTES : THUMB_MAX_BYTES);
    if (!read || read.truncated || read.data.length === 0) return 'failed';
    if (svg) return renderSvg(read.data, width, maxPixels, opts.svgTimeoutMs ?? DEFAULT_SVG_TIMEOUT_MS);
    // Markup or gzip under a picture's name would be drawn as SVG in this process: refuse it.
    if (!looksLikeRaster(read.data)) return 'failed';
    try {
      return await sharp(read.data, { limitInputPixels: maxPixels, failOn: 'error' })
        .autoOrient()
        .resize({ width, height: THUMB_MAX_HEIGHT, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .timeout({ seconds: opts.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS })
        .toBuffer();
    } catch {
      return 'failed';
    }
  }

  async function make(file: LibraryFile, width: ThumbWidth, dest: string, failKey: string) {
    const svg = file.item.ext === 'svg';
    // One SVG at a time, and never more than the overall limit at once.
    if (svg) await svgSlot.acquire();
    await slots.acquire();
    try {
      if (await exists(dest)) return dest;
      if (failed.has(failKey)) return null;
      opts.onGenerate?.();
      const out = await draw(file, width);
      opts.onGenerated?.();
      if (out === 'failed') remember(failKey);
      if (!Buffer.isBuffer(out)) return null;
      const tmp = `${dest}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
        await fs.writeFile(tmp, out, { mode: 0o600 });
        await fs.rename(tmp, dest);
        return dest;
      } catch {
        // a full disk is not the picture's fault: try again next time
        await fs.rm(tmp, { force: true }).catch(() => {});
        return null;
      }
    } finally {
      slots.release();
      if (svg) svgSlot.release();
    }
  }

  return {
    async get(file, width) {
      if (!(THUMB_WIDTHS as readonly number[]).includes(width)) return null;
      const { item } = file;
      const cap = item.ext === 'svg' ? SVG_MAX_BYTES : THUMB_MAX_BYTES;
      if (item.kind !== 'image' || !item.thumb || item.bytes > cap) return null;
      if (!(await writable())) return null;
      const failKey = hash(`fail\0${item.path}\0${file.version}`);
      if (failed.has(failKey)) return null;
      // The name comes from a hash of the path, version and width, never from what the browser sent.
      const key = hash(`thumb/v1\0${item.path}\0${file.version}\0${width}`);
      const dest = join(cacheDir, `${key}.webp`);
      if (await exists(dest)) return dest;
      let p = inflight.get(key);
      if (!p) {
        p = make(file, width, dest, failKey).finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      return p;
    },
  };
}
