import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createUploadStaging, safeName, UploadError, type UploadStaging } from './staging.ts';

const HOUR = 60 * 60 * 1000;
const temps: string[] = [];
const stagings: UploadStaging[] = [];

afterEach(async () => {
  // sweep() also waits for sent marks still being written, so nothing lands in a folder being removed
  for (const s of stagings.splice(0)) {
    s.close();
    await s.sweep();
  }
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return realpathSync(d);
}

function setup(over: { maxStagedBytes?: number; maxUploadBytes?: number } = {}) {
  const dataDir = tempDir('tba-staging-data-');
  const brainRoot = tempDir('tba-staging-brain-');
  const clock = { t: 1_800_000_000_000 };
  const make = () => {
    const s = createUploadStaging({ dataDir, brainRoot, now: () => clock.t, sweepMs: 0, ...over });
    stagings.push(s);
    return s;
  };
  return { dataDir, brainRoot, clock, staging: make(), make };
}

const body = (text: string | Buffer) => Readable.from([Buffer.from(text)]);

async function codeOf(p: Promise<unknown> | (() => unknown)): Promise<string | null> {
  try {
    await (typeof p === 'function' ? p() : p);
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(UploadError);
    return (err as UploadError).code;
  }
}

/** Everything left in the root, as relative paths. */
function contents(root: string): string[] {
  return readdirSync(root, { recursive: true }).map(String).sort();
}

/** A stream that records whether anything ever read from it. */
function untouched(): { stream: Readable; wasRead: () => boolean } {
  let read = false;
  const stream = new Readable({
    read() {
      read = true;
      this.push(Buffer.from('x'));
      this.push(null);
    },
  });
  return { stream, wasRead: () => read };
}

describe('safeName', () => {
  it('keeps the last path segment only', () => {
    expect(safeName('../../x.pdf')).toBe('x.pdf');
    expect(safeName('a/b\\c.pdf')).toBe('c.pdf');
    expect(safeName(encodeURIComponent('../../etc/passwd.txt'))).toBe('passwd.txt');
    expect(safeName('/abs/path/report.pdf')).toBe('report.pdf');
  });

  it('decodes the header form, and keeps a name that is not valid encoding as it is', () => {
    expect(safeName(encodeURIComponent('Café plan.docx'))).toBe('Café plan.docx');
    expect(safeName('100%.txt')).toBe('100%.txt');
  });

  it('normalises to NFC', () => {
    expect(safeName('Café.md')).toBe('Café.md');
  });

  it('drops control, bidi and format characters, newlines, colons, angle brackets and backticks', () => {
    expect(safeName('a\u0000b\u0007c.txt')).toBe('abc.txt');
    expect(safeName('invoice‮fdp.exe.txt')).toBe('invoicefdp.exe.txt');
    expect(safeName('a⁦b⁩‏c.txt')).toBe('abc.txt');
    expect(safeName('line\none\r\ntwo.md')).toBe('lineonetwo.md');
    expect(safeName('a:b<c>d`e.md')).toBe('abcde.md');
  });

  it('collapses spaces and trims dots and spaces from the ends', () => {
    expect(safeName('  my    report  \u00a0.pdf  ')).toBe('my report .pdf');
    expect(safeName('tab\tgone.pdf')).toBe('tabgone.pdf');
    expect(safeName('...hidden.txt...')).toBe('hidden.txt');
    expect(safeName('..')).toBe('file');
    expect(safeName('. . .')).toBe('file');
  });

  it('caps a long name at 120 characters, keeping its extension', () => {
    const name = safeName(`${'a'.repeat(300)}.pdf`);
    expect(name.length).toBe(120);
    expect(name.endsWith('.pdf')).toBe(true);
    // a surrogate pair is never cut in half
    const emoji = safeName(`${'😀'.repeat(200)}.png`);
    expect(emoji.endsWith('.png')).toBe(true);
    expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('falls back to file', () => {
    expect(safeName('')).toBe('file');
    expect(safeName('///')).toBe('file');
    expect(safeName('\u0000\u0001')).toBe('file');
  });
});

describe('the staging folder', () => {
  it('is <data>/uploads, private, and given as its real path', () => {
    const { dataDir, staging } = setup();
    expect(staging.root).toBe(realpathSync(join(dataDir, 'uploads')));
    expect(statSync(join(dataDir, 'uploads')).mode & 0o777).toBe(0o700);
  });

  it('is off when it would sit inside the brain folder', () => {
    const brainRoot = tempDir('tba-staging-brain-');
    const s = createUploadStaging({ dataDir: join(brainRoot, 'data'), brainRoot, sweepMs: 0 });
    stagings.push(s);
    expect(s.root).toBeNull();
  });

  it('is off when the brain folder is inside it, even through a link', () => {
    const dataDir = tempDir('tba-staging-data-');
    const elsewhere = tempDir('tba-staging-links-');
    mkdirSync(join(dataDir, 'uploads', 'brain'), { recursive: true });
    writeFileSync(join(dataDir, 'uploads', 'brain', 'keep.md'), 'x');
    const link = join(elsewhere, 'brain-link');
    symlinkSync(join(dataDir, 'uploads', 'brain'), link);
    const s = createUploadStaging({ dataDir, brainRoot: link, sweepMs: 0 });
    stagings.push(s);
    expect(s.root).toBeNull();
    // and nothing in it is swept away
    expect(existsSync(join(dataDir, 'uploads', 'brain', 'keep.md'))).toBe(true);
  });

  it('is off when its real path has characters a permission rule would read as a pattern', () => {
    for (const name of ['data[1]', 'da*ta', 'what?', 'back\\slash', '!data']) {
      const parent = tempDir('tba-staging-odd-');
      const dataDir = join(parent, name, 'inner');
      const s = createUploadStaging({ dataDir, brainRoot: tempDir('tba-staging-brain-'), sweepMs: 0 });
      stagings.push(s);
      expect(s.root, name).toBeNull();
    }
    // `!` only counts at the start of a folder name
    const parent = tempDir('tba-staging-odd-');
    const ok = createUploadStaging({
      dataDir: join(parent, 'da!ta'),
      brainRoot: tempDir('tba-b-'),
      sweepMs: 0,
    });
    stagings.push(ok);
    expect(ok.root).not.toBeNull();
  });

  it('is off when the uploads folder is a link', () => {
    const dataDir = tempDir('tba-staging-data-');
    const target = tempDir('tba-staging-target-');
    symlinkSync(target, join(dataDir, 'uploads'));
    const s = createUploadStaging({ dataDir, brainRoot: tempDir('tba-staging-brain-'), sweepMs: 0 });
    stagings.push(s);
    expect(s.root).toBeNull();
  });

  it('refuses every upload while off, before reading anything', async () => {
    const brainRoot = tempDir('tba-staging-brain-');
    const s = createUploadStaging({ dataDir: join(brainRoot, 'data'), brainRoot, sweepMs: 0 });
    stagings.push(s);
    const src = untouched();
    expect(await codeOf(s.save(src.stream, 'a.pdf', 1))).toBe('off');
    expect(src.wasRead()).toBe(false);
  });
});

describe('save', () => {
  it('writes the file 0600 in its own 0700 folder and says what it is', async () => {
    const { staging } = setup();
    const info = await staging.save(body('hello pdf'), encodeURIComponent('Q3 report.pdf'), 9);
    expect(info).toEqual({ id: expect.any(String), name: 'Q3 report.pdf', size: 9, kind: 'document' });
    const root = staging.root as string;
    const folder = join(root, info.id);
    expect(lstatSync(folder).isDirectory()).toBe(true);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    const file = join(folder, 'Q3 report.pdf');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toBe('hello pdf');
    expect(contents(root)).toEqual([info.id, `${info.id}/Q3 report.pdf`]);
    const img = await staging.save(body('png'), 'logo.PNG', 3);
    expect(img.kind).toBe('image');
  });

  it('refuses a type that is not allowed, or a missing name, before writing anything', async () => {
    const { staging } = setup();
    for (const name of ['setup.exe', 'archive.zip', 'noextension', '.pdf']) {
      const src = untouched();
      const err = await staging.save(src.stream, name, 1).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UploadError);
      expect((err as UploadError).code, name).toBe('bad-type');
      expect(src.wasRead()).toBe(false);
    }
    const err = (await staging.save(untouched().stream, 'tool.exe', 1).catch((e) => e)) as UploadError;
    expect(err.message).toBe(
      "TDS Brain can't pass on .exe files. Attach a document, spreadsheet, slide deck, text file or picture.",
    );
    expect(await codeOf(staging.save(untouched().stream, undefined, 1))).toBe('bad-name');
    expect(await codeOf(staging.save(untouched().stream, '', 1))).toBe('bad-name');
    expect(contents(staging.root as string)).toEqual([]);
  });

  it('refuses a missing length and a declared length over the cap before writing', async () => {
    const { staging } = setup({ maxUploadBytes: 10 });
    expect(await codeOf(staging.save(untouched().stream, 'a.txt', null))).toBe('no-length');
    expect(await codeOf(staging.save(untouched().stream, 'a.txt', 11))).toBe('too-large');
    expect(contents(staging.root as string)).toEqual([]);
  });

  it('refuses a stream that runs past its length or the cap, and leaves nothing', async () => {
    const { staging } = setup({ maxUploadBytes: 10 });
    expect(await codeOf(staging.save(body('x'.repeat(8)), 'a.txt', 5))).toBe('too-large');
    expect(await codeOf(staging.save(body('x'.repeat(11)), 'a.txt', 10))).toBe('too-large');
    expect(contents(staging.root as string)).toEqual([]);
  });

  it('leaves nothing when the request is cut short', async () => {
    const { staging } = setup();
    const src = new PassThrough();
    const saving = staging.save(src, 'a.txt', 100);
    src.write(Buffer.from('part'));
    setImmediate(() => src.destroy(new Error('aborted')));
    expect(await codeOf(saving)).toBe('aborted');
    expect(contents(staging.root as string)).toEqual([]);
    // fewer bytes than promised is cut short too
    expect(await codeOf(staging.save(body('abc'), 'a.txt', 10))).toBe('aborted');
    expect(contents(staging.root as string)).toEqual([]);
  });

  it('says plainly when the Mac is out of space, and leaves nothing', async () => {
    const { staging } = setup();
    const src = new PassThrough();
    const saving = staging.save(src, 'a.txt', 100);
    src.write(Buffer.from('part'));
    setImmediate(() => src.destroy(Object.assign(new Error('no space'), { code: 'ENOSPC' })));
    const err = (await saving.catch((e: unknown) => e)) as UploadError;
    expect(err.code).toBe('no-space');
    expect(err.message).toBe('Your Mac is out of space, so that file could not be attached.');
    expect(contents(staging.root as string)).toEqual([]);
  });

  it('refuses an upload that would take the folder past its total, counting ones in progress', async () => {
    const { staging } = setup({ maxStagedBytes: 100 });
    await staging.save(body('x'.repeat(60)), 'a.txt', 60);
    expect(await codeOf(staging.save(untouched().stream, 'b.txt', 50))).toBe('full');
    await staging.save(body('x'.repeat(40)), 'b.txt', 40);

    const second = setup({ maxStagedBytes: 100 }).staging;
    const slow = new PassThrough();
    const first = second.save(slow, 'a.txt', 60);
    // the first has not written a byte yet, but its 60 are reserved
    expect(await codeOf(second.save(untouched().stream, 'b.txt', 60))).toBe('full');
    slow.end(Buffer.from('x'.repeat(60)));
    expect((await first).size).toBe(60);
  });

  it('takes at most four at once', async () => {
    const { staging } = setup();
    const streams = [0, 1, 2, 3].map(() => new PassThrough());
    const saving = streams.map((s, i) => staging.save(s, `${i}.txt`, 1));
    expect(await codeOf(staging.save(untouched().stream, 'five.txt', 1))).toBe('busy');
    for (const s of streams) s.end(Buffer.from('x'));
    await Promise.all(saving);
    await staging.save(body('x'), 'five.txt', 1);
  });
});

describe('peek and claim', () => {
  it('peek gives each file with its path and changes nothing; an unknown id is gone', async () => {
    const { staging } = setup();
    const a = await staging.save(body('aaa'), 'a.pdf', 3);
    const files = staging.peek([a.id]);
    expect(files).toEqual([{ ...a, path: join(staging.root as string, a.id, 'a.pdf') }]);
    expect(staging.peek([a.id])).toHaveLength(1);
    expect(await codeOf(() => staging.peek([a.id, 'nope']))).toBe('gone');
    const err = (() => {
      try {
        staging.peek(['nope']);
      } catch (e) {
        return e as UploadError;
      }
    })();
    expect(err?.message).toBe('That file is no longer attached. Add it again.');
  });

  it('claim is all or nothing, and each id goes once', async () => {
    const { staging } = setup();
    const a = await staging.save(body('aaa'), 'a.pdf', 3);
    const b = await staging.save(body('bb'), 'b.md', 2);
    expect(await codeOf(() => staging.claim([a.id, 'nope']))).toBe('gone');
    const claimed = staging.claim([a.id, b.id]);
    expect(claimed.files.map((f) => f.name)).toEqual(['a.pdf', 'b.md']);
    expect(await codeOf(() => staging.claim([a.id]))).toBe('gone');
    expect(await codeOf(() => staging.peek([b.id]))).toBe('gone');
  });

  it('release puts the files back, still attached', async () => {
    const { staging } = setup();
    const a = await staging.save(body('aaa'), 'a.pdf', 3);
    staging.claim([a.id]).release();
    expect(staging.claim([a.id]).files).toHaveLength(1);
  });

  it('discard deletes an unsent file, but never one that has been sent', async () => {
    const { staging } = setup();
    const root = staging.root as string;
    const a = await staging.save(body('aaa'), 'a.pdf', 3);
    const b = await staging.save(body('bbb'), 'b.pdf', 3);
    await staging.discard(a.id);
    expect(existsSync(join(root, a.id))).toBe(false);
    expect(await codeOf(() => staging.peek([a.id]))).toBe('gone');
    staging.claim([b.id]);
    await staging.discard(b.id);
    expect(existsSync(join(root, b.id, 'b.pdf'))).toBe(true);
    await staging.discard('not-a-real-id');
    await staging.discard('../../etc');
  });

  it('an unsent upload expires after an hour, even before a sweep', async () => {
    const { staging, clock } = setup();
    const a = await staging.save(body('aaa'), 'a.pdf', 3);
    clock.t += HOUR + 1;
    expect(await codeOf(() => staging.peek([a.id]))).toBe('gone');
  });
});

describe('sweep', () => {
  it('deletes unsent uploads after an hour and sent ones 24 hours after sending', async () => {
    const { staging, clock } = setup();
    const root = staging.root as string;
    const unsent = await staging.save(body('u'), 'u.txt', 1);
    const sent = await staging.save(body('s'), 's.txt', 1);
    clock.t += 30 * 60 * 1000;
    staging.claim([sent.id]);
    await staging.sweep();
    expect(existsSync(join(root, unsent.id))).toBe(true);
    clock.t += 31 * 60 * 1000;
    await staging.sweep();
    expect(existsSync(join(root, unsent.id))).toBe(false);
    expect(existsSync(join(root, sent.id))).toBe(true);
    clock.t += 23 * HOUR;
    await staging.sweep();
    expect(existsSync(join(root, sent.id))).toBe(true);
    clock.t += HOUR;
    await staging.sweep();
    expect(existsSync(join(root, sent.id))).toBe(false);
  });

  it('frees the space of what it deletes', async () => {
    const { staging, clock } = setup({ maxStagedBytes: 10 });
    await staging.save(body('x'.repeat(10)), 'a.txt', 10);
    expect(await codeOf(staging.save(untouched().stream, 'b.txt', 1))).toBe('full');
    clock.t += HOUR + 1;
    await staging.sweep();
    await staging.save(body('x'), 'b.txt', 1);
  });

  it('after a restart keeps sent files until 24 hours after sending and deletes unsent ones', async () => {
    const { staging, clock, make } = setup();
    const root = staging.root as string;
    const unsent = await staging.save(body('u'), 'u.txt', 1);
    const sent = await staging.save(body('s'), 's.txt', 1);
    staging.claim([sent.id]);
    await staging.sweep(); // lets the sent mark reach the disk
    staging.close();

    clock.t += 2 * HOUR;
    const again = make();
    await again.sweep();
    expect(existsSync(join(root, unsent.id))).toBe(false);
    expect(existsSync(join(root, sent.id, 's.txt'))).toBe(true);
    expect(await codeOf(() => again.peek([sent.id]))).toBe('gone');
    clock.t += 22 * HOUR + 1;
    await again.sweep();
    expect(existsSync(join(root, sent.id))).toBe(false);
  });

  it('a released claim is unsent again on disk, so a restart deletes it', async () => {
    const { staging, make } = setup();
    const root = staging.root as string;
    const a = await staging.save(body('a'), 'a.txt', 1);
    staging.claim([a.id]).release();
    await staging.sweep();
    staging.close();
    const again = make();
    await again.sweep();
    expect(existsSync(join(root, a.id))).toBe(false);
  });

  it('deletes anything in the folder it did not make, without following links', async () => {
    const { staging } = setup();
    const root = staging.root as string;
    const kept = await staging.save(body('k'), 'k.txt', 1);
    const outside = tempDir('tba-staging-outside-');
    writeFileSync(join(outside, 'precious.md'), 'keep me');
    writeFileSync(join(root, 'stray.txt'), 'x');
    mkdirSync(join(root, 'not-ours'));
    writeFileSync(join(root, 'not-ours', 'x.txt'), 'x');
    mkdirSync(join(root, '6a1f6f3e-0000-4000-8000-000000000000'));
    symlinkSync(outside, join(root, 'link'));
    await staging.sweep();
    expect(contents(root)).toEqual([kept.id, `${kept.id}/k.txt`]);
    expect(readFileSync(join(outside, 'precious.md'), 'utf8')).toBe('keep me');
  });

  it('runs first when started, not when made', async () => {
    const { dataDir, brainRoot } = setup();
    const root = join(dataDir, 'uploads');
    writeFileSync(join(root, 'stray.txt'), 'x');
    const s = createUploadStaging({ dataDir, brainRoot, sweepMs: 0 });
    stagings.push(s);
    await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(join(root, 'stray.txt'))).toBe(true);
    s.start();
    await s.sweep();
    expect(existsSync(join(root, 'stray.txt'))).toBe(false);
  });

  it('a second app on the same data folder, made but not started, leaves the first one’s uploads alone', async () => {
    const { staging, make } = setup();
    const root = staging.root as string;
    staging.start();
    const unsent = await staging.save(body('u'), 'u.txt', 1);
    const second = make(); // as a second `pnpm start` does before finding the port taken
    await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(join(root, unsent.id, 'u.txt'))).toBe(true);
    expect(staging.peek([unsent.id])).toHaveLength(1);
    // once started, it sweeps as usual
    writeFileSync(join(root, 'stale.txt'), 'x');
    second.start();
    await second.sweep();
    expect(existsSync(join(root, 'stale.txt'))).toBe(false);
  });
});
