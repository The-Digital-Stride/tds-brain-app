import {
  promises as fsp,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import type { LibraryFile, ThumbWidth } from '../../shared/contract.ts';
import { createBrainReaders } from './index.ts';
import { copyFixture } from './test-helpers.ts';
import { createThumbnailer } from './thumbs.ts';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'tba-thumbs-'));
  temps.push(d);
  return d;
}

/** A tiny SVG that takes the image library many seconds to even measure (found in review). */
function slowSvg(): string {
  let s =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs>' +
    '<path id="a0" d="M0 0 L1 1 L0 1 Z" filter="url(#f)"/><filter id="f"><feGaussianBlur stdDeviation="50"/></filter>';
  for (let i = 1; i < 6; i++) {
    s += `<g id="a${i}">${Array.from({ length: 10 }, () => `<use xlink:href="#a${i - 1}"/>`).join('')}</g>`;
  }
  return `${s}</defs><use xlink:href="#a5"/></svg>`;
}

async function fileFor(root: string, name: string, docThumbs = false): Promise<LibraryFile> {
  const brain = createBrainReaders(root, { docThumbs });
  const listing = await brain.library('client:acme-heating');
  const item = listing?.items.find((i) => i.name === name);
  if (!item) throw new Error(`missing ${name}`);
  const file = await brain.libraryFile(item.id);
  if (!file) throw new Error(`no file for ${name}`);
  return file;
}

describe('thumbnails', () => {
  it('makes a WebP of the asked width from a PNG, and serves the second call from the cache', async () => {
    const root = copyFixture();
    const dataDir = tempDir();
    let made = 0;
    const thumbs = createThumbnailer(dataDir, { brainRoot: root, onGenerate: () => made++ });
    // 40 px wide: never enlarged
    const logo = await fileFor(root, 'logo.png');
    const small = await thumbs.get(logo, 96);
    expect(small).not.toBeNull();
    const meta = await sharp(readFileSync(small as string)).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(40);

    // 64 px wide jpeg asked at 96: stays 64; a bigger one is cut down to the width
    const wide = join(root, 'clients/acme-heating/media/wide.png');
    writeFileSync(
      wide,
      await sharp({ create: { width: 800, height: 400, channels: 3, background: '#336699' } })
        .png()
        .toBuffer(),
    );
    const wideFile = await fileFor(root, 'wide.png');
    const p96 = await thumbs.get(wideFile, 96);
    const p320 = await thumbs.get(wideFile, 320);
    expect((await sharp(readFileSync(p96 as string)).metadata()).width).toBe(96);
    expect((await sharp(readFileSync(p320 as string)).metadata()).width).toBe(320);
    expect(p96).not.toBe(p320);
    expect(p96?.startsWith(join(dataDir, 'thumbs'))).toBe(true);
    expect(p96?.endsWith('.webp')).toBe(true);

    const before = made;
    const again = await thumbs.get(wideFile, 96);
    expect(again).toBe(p96);
    expect(made).toBe(before);
    // nothing written into the brain, and no temp files left behind
    expect(readdirSync(join(dataDir, 'thumbs')).every((n) => n.endsWith('.webp'))).toBe(true);
  });

  it('draws an SVG to pixels from its bytes, never pulling in the neighbouring picture', async () => {
    const root = copyFixture();
    const thumbs = createThumbnailer(tempDir(), { brainRoot: root });
    const svg = await fileFor(root, 'mark.svg');
    const out = await thumbs.get(svg, 96);
    expect(out).not.toBeNull();
    const { data, info } = await sharp(readFileSync(out as string))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(96);
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };
    // left half is the blue square
    const left = px(10, 20);
    expect(left[2]).toBeGreaterThan(200);
    // right half is where logo.png (red) would be if the SVG could read files: it must be empty
    expect(px(72, 20)[3]).toBe(0);
  });

  it('gives up on a slow SVG at the time limit, without freezing the app, and remembers it', async () => {
    const root = copyFixture();
    writeFileSync(join(root, 'clients/acme-heating/media/slow.svg'), slowSvg());
    let made = 0;
    const thumbs = createThumbnailer(tempDir(), {
      brainRoot: root,
      svgTimeoutMs: 1500,
      onGenerate: () => made++,
    });
    const file = await fileFor(root, 'slow.svg');
    const started = Date.now();
    const pending = thumbs.get(file, 320);
    // while it draws, the app's own file reads and timers still run promptly
    await new Promise((r) => setTimeout(r, 300));
    const t0 = Date.now();
    await fsp.stat(join(root, 'clients/acme-heating/profile.md'));
    await new Promise((r) => setTimeout(r, 20));
    expect(Date.now() - t0).toBeLessThan(250);
    expect(await pending).toBeNull();
    expect(Date.now() - started).toBeLessThan(4000);
    expect(await thumbs.get(file, 96)).toBeNull();
    expect(made).toBe(1);
  }, 15_000);

  it('does not draw SVG text saved under a picture name, and remembers that', async () => {
    const root = copyFixture();
    writeFileSync(join(root, 'clients/acme-heating/media/sneaky.png'), slowSvg());
    let made = 0;
    const thumbs = createThumbnailer(tempDir(), { brainRoot: root, onGenerate: () => made++ });
    const file = await fileFor(root, 'sneaky.png');
    const started = Date.now();
    expect(await thumbs.get(file, 320)).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
    expect(await thumbs.get(file, 96)).toBeNull();
    expect(made).toBe(1);
    expect(await thumbs.get(await fileFor(root, 'logo.png'), 96)).not.toBeNull();
  });

  it('fits a very tall image inside the width and the height cap', async () => {
    const root = copyFixture();
    const tall = join(root, 'clients/acme-heating/media/tall.png');
    writeFileSync(
      tall,
      await sharp({ create: { width: 200, height: 20_000, channels: 3, background: '#000' } })
        .png()
        .toBuffer(),
    );
    const thumbs = createThumbnailer(tempDir(), { brainRoot: root });
    const out = await thumbs.get(await fileFor(root, 'tall.png'), 1600);
    expect(out).not.toBeNull();
    const meta = await sharp(readFileSync(out as string)).metadata();
    expect(meta.height).toBeLessThanOrEqual(16_000);
    expect(meta.width).toBeLessThanOrEqual(200);
  });

  it('gives null for a broken image and does not retry it until the file changes', async () => {
    const root = copyFixture();
    let made = 0;
    const thumbs = createThumbnailer(tempDir(), { brainRoot: root, onGenerate: () => made++ });
    const broken = await fileFor(root, 'broken.png');
    expect(await thumbs.get(broken, 96)).toBeNull();
    expect(await thumbs.get(broken, 320)).toBeNull();
    expect(made).toBe(1);

    const abs = join(root, 'clients/acme-heating/context/brand/broken.png');
    writeFileSync(
      abs,
      await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } })
        .png()
        .toBuffer(),
    );
    const fixed = await fileFor(root, 'broken.png');
    expect(fixed.version).not.toBe(broken.version);
    expect(await thumbs.get(fixed, 96)).not.toBeNull();
    expect(made).toBe(2);
  });

  it('refuses a width that is not allowed, a document, and an image over the size cap', async () => {
    const root = copyFixture();
    const thumbs = createThumbnailer(tempDir(), { brainRoot: root });
    const logo = await fileFor(root, 'logo.png');
    expect(await thumbs.get(logo, 97 as ThumbWidth)).toBeNull();
    expect(await thumbs.get(await fileFor(root, 'monthly-report.md'), 96)).toBeNull();
    const huge: LibraryFile = { ...logo, item: { ...logo.item, bytes: 50 * 1024 * 1024 + 1, thumb: false } };
    expect(await thumbs.get(huge, 96)).toBeNull();
  });

  it('never makes more than two at once', async () => {
    const root = copyFixture();
    let running = 0;
    let peak = 0;
    const thumbs = createThumbnailer(tempDir(), {
      brainRoot: root,
      onGenerate: () => {
        running++;
        peak = Math.max(peak, running);
      },
      onGenerated: () => {
        running--;
      },
    });
    const files: LibraryFile[] = [];
    for (let i = 0; i < 6; i++) {
      writeFileSync(
        join(root, `clients/acme-heating/media/p${i}.png`),
        await sharp({ create: { width: 900, height: 900, channels: 3, background: '#123456' } })
          .png()
          .toBuffer(),
      );
    }
    for (let i = 0; i < 6; i++) files.push(await fileFor(root, `p${i}.png`));
    const out = await Promise.all(files.map((f) => thumbs.get(f, 320)));
    expect(out.every((p) => p !== null)).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
  });

  describe('documents, through Quick Look', () => {
    /**
     * A stand-in for `qlmanage`, run by Node under an empty environment as the real one is. It
     * records its arguments and folder, then does what its mode says: copy a ready PNG to
     * `<out>/<name>.png`, write SVG markup there under the PNG's name (sharp would draw it), or hang.
     */
    const FAKE = `
const fs = require('node:fs');
const [mode, logPath, png, ...rest] = process.argv.slice(2);
fs.appendFileSync(logPath, JSON.stringify({ argv: rest, cwd: process.cwd(), env: Object.keys(process.env) }) + '\\n');
const out = rest[rest.indexOf('-o') + 1];
const name = rest[rest.length - 1];
if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'junk') fs.writeFileSync(out + '/' + name + '.png', '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60"/></svg>');
else if (mode === 'ok') fs.copyFileSync(png, out + '/' + name + '.png');
`;

    async function setup(mode: 'ok' | 'hang' | 'junk', extra: Record<string, unknown> = {}, page?: Buffer) {
      const root = copyFixture();
      const tools = tempDir();
      const script = join(tools, 'fake-qlmanage.cjs');
      writeFileSync(script, FAKE);
      const png = join(tools, 'page.png');
      // An A4-shaped page, as Quick Look draws one at 480 on the long side.
      writeFileSync(
        png,
        page ??
          (await sharp({ create: { width: 339, height: 480, channels: 3, background: '#ffffff' } })
            .png()
            .toBuffer()),
      );
      const log = join(tools, 'calls.log');
      let made = 0;
      const thumbs = createThumbnailer(tempDir(), {
        brainRoot: root,
        quickLook: { command: process.execPath, args: [script, mode, log, png] },
        onGenerate: () => made++,
        ...extra,
      });
      const calls = () => {
        try {
          return readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l) as { argv: string[]; cwd: string; env: string[] });
        } catch {
          return [];
        }
      };
      const doc = (name: string) => fileFor(root, name, true);
      return { root, thumbs, calls, made: () => made, doc };
    }

    it('makes a 320-wide WebP of a PDF from a private copy, and caches it', async () => {
      const { root, thumbs, calls, doc } = await setup('ok');
      const pdf = await doc('2026-10-summary.pdf');
      const out = await thumbs.get(pdf, 320);
      expect(out).not.toBeNull();
      const meta = await sharp(readFileSync(out as string)).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(320);
      expect(await thumbs.get(pdf, 320)).toBe(out);
      const [call, again] = calls();
      expect(again).toBeUndefined();
      // Drawn at 480 on the long side, from a copy named file.pdf in its own folder, never the brain's path.
      expect(call?.argv.slice(0, 4)).toEqual(['-t', '-s', '480', '-o']);
      expect(call?.argv.at(-1)).toBe('file.pdf');
      expect(call?.argv.join(' ')).not.toContain(root);
      expect(call?.cwd).not.toContain(root);
      expect(call?.env.filter((k) => k !== '__CF_USER_TEXT_ENCODING')).toEqual([]);
      // The private folder is gone afterwards.
      expect(() => statSync(call?.argv[4] as string)).toThrow();
    });

    it('makes documents at 320 only, and never without Quick Look', async () => {
      const { root, thumbs, calls, doc } = await setup('ok');
      const pdf = await doc('2026-10-summary.pdf');
      expect(await thumbs.get(pdf, 96)).toBeNull();
      expect(await thumbs.get(pdf, 1600)).toBeNull();
      expect(calls()).toEqual([]);
      const none = createThumbnailer(tempDir(), { brainRoot: root });
      expect(await none.get(pdf, 320)).toBeNull();
    });

    it('refuses a file whose first bytes do not match its type, without running Quick Look', async () => {
      const { root, thumbs, calls, doc } = await setup('ok');
      writeFileSync(join(root, 'clients/acme-heating/reports/junk.pdf'), 'garbage');
      writeFileSync(join(root, 'clients/acme-heating/reports/junk.docx'), '%PDF-1.4 not a zip');
      expect(await thumbs.get(await doc('junk.pdf'), 320)).toBeNull();
      expect(await thumbs.get(await doc('junk.docx'), 320)).toBeNull();
      expect(calls()).toEqual([]);
    });

    it('never gives a web page to Quick Look, even if the list offered it a picture', async () => {
      const { root, thumbs, calls, doc } = await setup('ok');
      writeFileSync(join(root, 'clients/acme-heating/reports/summary.html'), '<!doctype html><p>Summary</p>');
      const html = await doc('summary.html');
      // The same file object (its checked identity kept), as if the list had said yes.
      (html.item as { thumb: boolean }).thumb = true;
      expect(await thumbs.get(html, 320)).toBeNull();
      expect(calls()).toEqual([]);
    });

    it('refuses what Quick Look writes when it is not a PNG, and remembers it', async () => {
      const { thumbs, made, doc } = await setup('junk');
      const pdf = await doc('2026-10-summary.pdf');
      expect(await thumbs.get(pdf, 320)).toBeNull();
      expect(await thumbs.get(pdf, 320)).toBeNull();
      expect(made()).toBe(1);
    });

    it('kills a Quick Look that hangs at the limit, remembers it, and pictures are not held up', async () => {
      const { root, thumbs, made, doc } = await setup('hang', { quickLookTimeoutMs: 400 });
      const pdf = await doc('2026-10-summary.pdf');
      const started = Date.now();
      let hungDone = false;
      const hung = thumbs.get(pdf, 320).finally(() => {
        hungDone = true;
      });
      // A picture asked for meanwhile is made at once, not after the hung document.
      const logo = await thumbs.get(await fileFor(root, 'logo.png'), 96);
      expect(logo).not.toBeNull();
      expect(hungDone).toBe(false);
      expect(await hung).toBeNull();
      expect(Date.now() - started).toBeLessThan(3000);
      const before = made();
      expect(await thumbs.get(pdf, 320)).toBeNull();
      expect(made()).toBe(before);
    });
  });

  it('writes nothing when the data folder is inside the brain', async () => {
    const root = copyFixture();
    const thumbs = createThumbnailer(join(root, 'app-data'), { brainRoot: root });
    expect(await thumbs.get(await fileFor(root, 'logo.png'), 96)).toBeNull();
    expect(() => statSync(join(root, 'app-data'))).toThrow();
  });
});
