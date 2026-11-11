import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import type { ClientInfo, LibraryItem } from '../../shared/contract.ts';
import { listClients } from './clients.ts';
import { createBrainReaders } from './index.ts';
import { createLibrary, type LibraryOptions, looksLikeRaster, readChecked, svgSize } from './library.ts';
import { copyFixture, FIXTURE } from './test-helpers.ts';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'tba-lib-'));
  temps.push(d);
  return d;
}

function put(root: string, rel: string, data: string | Buffer = 'x'): void {
  const p = join(root, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, data);
}

function lib(root: string, over: Partial<LibraryOptions> = {}) {
  return createLibrary(root, { clients: () => listClients(root), ...over });
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

const byPath = (items: LibraryItem[]) => new Map(items.map((i) => [i.path, i]));
const ACME = 'clients/acme-heating/';

describe('libraryScopes', () => {
  it('lists personal first, then each client', async () => {
    expect(await createBrainReaders(FIXTURE).libraryScopes()).toEqual([
      { id: 'personal', name: 'My personal files', kind: 'personal' },
      { id: 'client:acme-heating', name: 'Acme Heating Ltd', kind: 'client' },
      { id: 'client:northwind', name: 'Northwind', kind: 'client' },
    ]);
  });

  it('is empty for a missing brain, and nothing throws', async () => {
    const brain = createBrainReaders('/nonexistent/brain');
    expect(await brain.libraryScopes()).toEqual([]);
    expect(await brain.library('personal')).toBeNull();
    expect(await brain.libraryFile('personal.0123456789abcdef01234567')).toBeNull();
  });

  it('leaves out a client folder that is a symbolic link', async () => {
    const root = copyFixture();
    const outside = tempDir();
    put(outside, 'reports/x.pdf');
    symlinkSync(outside, join(root, 'clients', 'linked'));
    const ids = (await lib(root).scopes()).map((s) => s.id);
    expect(ids).not.toContain('client:linked');
    expect(await lib(root).list('client:linked')).toBeNull();
  });
});

describe('library listing', () => {
  it("lists a client's images and documents in their cards, in order", async () => {
    const listing = await createBrainReaders(FIXTURE).library('client:acme-heating');
    expect(listing).not.toBeNull();
    if (!listing) return;
    expect(listing.scope).toBe('client:acme-heating');
    expect(listing.truncated).toBe(false);
    expect(listing.groups).toEqual([
      'Reports',
      'Plans',
      'Notes',
      'Brand',
      'Landing pages',
      'Ad builds',
      'Media',
      'Other',
    ]);
    expect(listing.items.map((i) => i.path).sort()).toEqual(
      [
        'context/brand/broken.png',
        'context/brand/logo.png',
        'context/brand/mark.svg',
        'created/2026-11-02-keywords.csv',
        'landing-pages/boiler/hero.jpg',
        'landing-pages/boiler/page.html',
        'loose-note.txt',
        'media/van.webp',
        'notes/2026-11-01-call-follow-up.md',
        'plans/q1-plan.docx',
        'profile.md',
        'reports/2026-10-summary.pdf',
        'reports/monthly-report.md',
      ].map((p) => ACME + p),
    );
    // items follow the card order
    const order = listing.items.map((i) => listing.groups.indexOf(i.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));

    const items = byPath(listing.items);
    const logo = items.get(`${ACME}context/brand/logo.png`);
    expect(logo).toMatchObject({
      kind: 'image',
      format: null,
      ext: 'png',
      group: 'Brand',
      name: 'logo.png',
      title: 'Logo',
      width: 40,
      height: 20,
      thumb: true,
      view: 'image',
    });
    expect(logo?.id).toMatch(/^client:acme-heating\.[0-9a-f]{24}$/);
    expect(logo?.bytes).toBeGreaterThan(0);
    expect(new Date(logo?.modified ?? '').toISOString()).toBe(logo?.modified);
    expect(items.get(`${ACME}context/brand/mark.svg`)).toMatchObject({ width: 200, height: 100 });
    expect(items.get(`${ACME}context/brand/broken.png`)).toMatchObject({
      width: null,
      height: null,
      thumb: true,
    });
    expect(items.get(`${ACME}reports/monthly-report.md`)).toMatchObject({
      format: 'doc',
      title: 'October performance',
      view: 'text',
      thumb: false,
      width: null,
    });
    expect(items.get(`${ACME}notes/2026-11-01-call-follow-up.md`)?.title).toBe('Follow-up from the call');
    expect(items.get(`${ACME}reports/2026-10-summary.pdf`)).toMatchObject({
      format: 'pdf',
      title: '2026 10 summary',
      view: 'pdf',
    });
    expect(items.get(`${ACME}landing-pages/boiler/page.html`)).toMatchObject({
      view: 'page',
      format: 'doc',
      thumb: false,
    });
    expect(items.get(`${ACME}created/2026-11-02-keywords.csv`)).toMatchObject({
      format: 'sheet',
      group: 'Ad builds',
      title: 'Keywords',
    });
    expect(items.get(`${ACME}loose-note.txt`)?.group).toBe('Other');
    expect(items.get(`${ACME}media/van.webp`)?.group).toBe('Media');
  });

  it('offers a picture of a PDF or Office file only where Quick Look is there, never a web page', async () => {
    const root = copyFixture();
    put(root, `${ACME}reports/big.pdf`, Buffer.alloc(50 * 1024 * 1024 + 1));
    const thumbOf = async (docThumbs: boolean) => {
      const listing = await lib(root, { docThumbs }).list('client:acme-heating');
      const items = byPath(listing?.items ?? []);
      return (rel: string) => items.get(ACME + rel)?.thumb;
    };
    const on = await thumbOf(true);
    expect(on('reports/2026-10-summary.pdf')).toBe(true);
    expect(on('plans/q1-plan.docx')).toBe(true);
    // A web page could draw local files into its picture: it keeps its icon.
    expect(on('landing-pages/boiler/page.html')).toBe(false);
    // Notes and data files keep their icons; so does anything over the size cap.
    expect(on('reports/monthly-report.md')).toBe(false);
    expect(on('loose-note.txt')).toBe(false);
    expect(on('created/2026-11-02-keywords.csv')).toBe(false);
    expect(on('reports/big.pdf')).toBe(false);
    const off = await thumbOf(false);
    expect(off('reports/2026-10-summary.pdf')).toBe(false);
    expect(off('plans/q1-plan.docx')).toBe(false);
  });

  it('lists the personal folder by folder, with Other last', async () => {
    const listing = await createBrainReaders(FIXTURE).library('personal');
    expect(listing?.groups).toEqual(['Notes', 'Screens', 'Other']);
    expect(listing?.items.map((i) => i.path).sort()).toEqual([
      'personal/explainer.html',
      'personal/notes/idea.md',
      'personal/screens/shot.png',
    ]);
  });

  it('refuses a scope that is not listed, with no path reaching the disk', async () => {
    const brain = createBrainReaders(FIXTURE);
    for (const scope of [
      'client:nope',
      'client:_archive',
      'client:.hidden',
      'client:../acme-heating',
      'client:acme-heating/reports',
      'client:',
      'personal/..',
      'shared:x',
      '',
      'Client:acme-heating',
    ]) {
      expect(await brain.library(scope), scope).toBeNull();
    }
  });

  it('leaves out symbolic links, dot names, config, crm/data, google-ads data, node_modules and other types', async () => {
    const root = copyFixture();
    const outside = tempDir();
    put(outside, 'secret.png', readFileSync(join(FIXTURE, ACME, 'context/brand/logo.png')));
    put(outside, 'docs/inside.md', '# outside');
    put(root, `${ACME}crm/data/customers.csv`);
    put(root, `${ACME}crm/data/photo.png`);
    put(root, `${ACME}CRM/import-map.csv`); // same folder as crm/ on macOS; a plain crm file is fine
    put(root, `${ACME}context/google-ads/data/export.csv`);
    put(root, `${ACME}context/google-ads/summary.md`, '# Summary');
    put(root, `${ACME}node_modules/pkg/readme.md`);
    symlinkSync(join(outside, 'secret.png'), join(root, ACME, 'reports', 'link.png'));
    symlinkSync(join(outside, 'docs'), join(root, ACME, 'reports', 'linked-folder'));
    symlinkSync(join(root, ACME, 'reports', '2026-10-summary.pdf'), join(root, ACME, 'reports', 'alias.pdf'));
    const listing = await lib(root).list('client:acme-heating');
    const paths = listing?.items.map((i) => i.path) ?? [];
    expect(paths).toContain(`${ACME}context/google-ads/summary.md`);
    for (const p of paths) {
      expect(p, p).not.toMatch(/\/(config|crm\/data|context\/google-ads\/data|node_modules)\//i);
      expect(p, p).not.toMatch(/\/\./);
      expect(p, p).not.toMatch(/link|alias|inside|run\.js|secret/);
    }
  });

  it('marks the listing truncated when a cap is hit', async () => {
    const listed = await lib(FIXTURE, { limits: { listed: 2 } }).list('client:acme-heating');
    expect(listed?.truncated).toBe(true);
    expect(listed?.items).toHaveLength(2);
    const visited = await lib(FIXTURE, { limits: { visited: 3 } }).list('client:acme-heating');
    expect(visited?.truncated).toBe(true);
    const full = await lib(FIXTURE).list('client:acme-heating');
    expect(full?.truncated).toBe(false);
  });

  it('does not go deeper than the depth cap', async () => {
    const root = copyFixture();
    put(root, `${ACME}media/a/b/c/d/e/f/g/deep8.png`);
    put(root, `${ACME}media/a/b/c/d/e/f/g/h/deep9.png`);
    const paths = (await lib(root).list('client:acme-heating'))?.items.map((i) => i.name) ?? [];
    expect(paths).toContain('deep8.png');
    expect(paths).not.toContain('deep9.png');
    const shallow = (await lib(root, { limits: { depth: 1 } }).list('client:acme-heating'))?.items ?? [];
    expect(shallow.map((i) => i.name)).not.toContain('logo.png'); // two folders down
    expect(shallow.map((i) => i.name)).toContain('van.webp');
  });

  it('keeps long text openable, gives a page over its cap no view, and a picture over 50 MB no thumbnail', async () => {
    const root = copyFixture();
    put(root, `${ACME}notes/big.md`, Buffer.alloc(1024 * 1024 + 1, 0x61));
    put(root, `${ACME}notes/ok.md`, Buffer.alloc(1024 * 1024, 0x61));
    put(root, `${ACME}landing-pages/big.html`, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
    put(root, `${ACME}media/huge.png`, Buffer.alloc(50 * 1024 * 1024 + 1));
    const items = byPath((await lib(root).list('client:acme-heating'))?.items ?? []);
    expect(items.get(`${ACME}notes/big.md`)?.view).toBe('text'); // served cut at 1 MB
    expect(items.get(`${ACME}notes/ok.md`)?.view).toBe('text');
    expect(items.get(`${ACME}landing-pages/big.html`)?.view).toBeNull();
    expect(items.get(`${ACME}media/huge.png`)).toMatchObject({ thumb: false, view: null });
  });

  it('reads the size of a JPEG whose frame header sits past the first 64 KB', async () => {
    const root = copyFixture();
    const base = await sharp({ create: { width: 1200, height: 628, channels: 3, background: '#c33' } })
      .jpeg()
      .toBuffer();
    const seg = (marker: number, n: number) => {
      const b = Buffer.alloc(4 + n, 0x20);
      b[0] = 0xff;
      b[1] = marker;
      b.writeUInt16BE(n + 2, 2);
      return b;
    };
    // As a design tool saves it: big XMP and Photoshop blocks before the frame header.
    put(
      root,
      `${ACME}media/hero.jpg`,
      Buffer.concat([base.subarray(0, 2), seg(0xe1, 40_000), seg(0xed, 40_000), base.subarray(2)]),
    );
    const items = byPath((await lib(root).list('client:acme-heating'))?.items ?? []);
    expect(items.get(`${ACME}media/hero.jpg`)).toMatchObject({ width: 1200, height: 628 });
  });

  it('never hands an SVG to the image library while listing: its size is read from the tag', async () => {
    const root = copyFixture();
    put(root, `${ACME}media/slow.svg`, slowSvg());
    put(
      root,
      `${ACME}media/box.svg`,
      '<?xml version="1.0"?>\n<!-- c --><svg viewBox="0 0 300 150" xmlns="http://www.w3.org/2000/svg"/>',
    );
    const started = Date.now();
    const items = byPath((await lib(root).list('client:acme-heating'))?.items ?? []);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(items.get(`${ACME}media/slow.svg`)).toMatchObject({ width: null, height: null, thumb: true });
    expect(items.get(`${ACME}media/box.svg`)).toMatchObject({ width: 300, height: 150 });
    expect(items.get(`${ACME}context/brand/mark.svg`)).toMatchObject({ width: 200, height: 100 });
  });

  it('keeps ids stable for a path across readers', async () => {
    const a = await createBrainReaders(FIXTURE).library('client:acme-heating');
    const b = await createBrainReaders(FIXTURE).library('client:acme-heating');
    expect(a?.items.map((i) => i.id)).toEqual(b?.items.map((i) => i.id));
    expect(new Set(a?.items.map((i) => i.id)).size).toBe(a?.items.length);
  });
});

describe('libraryFile', () => {
  async function idOf(root: string, path: string): Promise<string> {
    const scope = path.startsWith('personal/') ? 'personal' : `client:${path.split('/')[1]}`;
    const listing = await lib(root).list(scope);
    const id = listing?.items.find((i) => i.path === path)?.id;
    if (!id) throw new Error(`no id for ${path}`);
    return id;
  }

  it('finds a listed file, even in a fresh reader that has not listed yet (after a restart)', async () => {
    const root = copyFixture();
    const id = await idOf(root, `${ACME}context/brand/logo.png`);
    const file = await createBrainReaders(root).libraryFile(id);
    expect(file?.item.path).toBe(`${ACME}context/brand/logo.png`);
    expect(file?.absPath).toBe(realpathSync(join(root, ACME, 'context/brand/logo.png')));
    expect(file?.version).toMatch(/\S/);
  });

  it('refuses unknown and malformed ids', async () => {
    const brain = createBrainReaders(FIXTURE);
    for (const id of [
      'client:acme-heating.000000000000000000000000',
      'client:nope.000000000000000000000000',
      'personal.zz',
      '../../etc/passwd',
      'client:acme-heating/../../x.000000000000000000000000',
      '',
      'x'.repeat(1000),
    ]) {
      expect(await brain.libraryFile(id), id).toBeNull();
    }
  });

  it('refuses a file that has gone, and notices a changed version', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    const listing = await brain.library('client:acme-heating');
    const item = listing?.items.find((i) => i.name === 'monthly-report.md');
    if (!item) throw new Error('missing');
    const first = await brain.libraryFile(item.id);
    writeFileSync(join(root, item.path), '# Changed and longer than before\n');
    const second = await brain.libraryFile(item.id);
    expect(second?.version).not.toBe(first?.version);
    rmSync(join(root, item.path));
    expect(await brain.libraryFile(item.id)).toBeNull();
  });

  it('refuses a file that became a symbolic link, or now resolves outside the brain', async () => {
    const root = copyFixture();
    const outside = tempDir();
    put(outside, 'brand/logo.png', 'outside');
    const brain = createBrainReaders(root);
    const id = await idOf(root, `${ACME}context/brand/logo.png`);
    expect(await brain.libraryFile(id)).not.toBeNull();

    // the file itself swapped for a link
    const file = join(root, ACME, 'context/brand/logo.png');
    renameSync(file, `${file}.bak`);
    symlinkSync(join(outside, 'brand/logo.png'), file);
    expect(await brain.libraryFile(id)).toBeNull();
    rmSync(file);
    renameSync(`${file}.bak`, file);
    expect(await brain.libraryFile(id)).not.toBeNull();

    // a parent folder swapped for a link to outside the brain
    const folder = join(root, ACME, 'context/brand');
    renameSync(folder, `${folder}-real`);
    symlinkSync(join(outside, 'brand'), folder);
    expect(await brain.libraryFile(id)).toBeNull();
  });

  it('refuses a path that now resolves into a never-listed place inside the brain', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    const id = await idOf(root, `${ACME}context/brand/logo.png`);
    expect(await brain.libraryFile(id)).not.toBeNull(); // now in this reader's index
    const folder = join(root, ACME, 'context/brand');
    const hidden = join(root, ACME, 'crm/data');
    mkdirSync(join(hidden, '..'), { recursive: true });
    renameSync(folder, hidden); // logo.png now lives in crm/data
    symlinkSync(hidden, folder);
    expect(await brain.libraryFile(id)).toBeNull();
  });

  it('refuses a path that now resolves into another scope', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    const id = await idOf(root, `${ACME}context/brand/logo.png`);
    expect(await brain.libraryFile(id)).not.toBeNull(); // now in this reader's index
    const folder = join(root, ACME, 'context/brand');
    const other = join(root, 'clients/northwind/brand');
    renameSync(folder, other);
    symlinkSync(other, folder);
    expect(await brain.libraryFile(id)).toBeNull();
  });
});

describe('svgSize', () => {
  it('reads plain or px sizes, else the viewBox, else nothing', () => {
    expect(svgSize('<svg width="64px" height="32" xmlns="http://www.w3.org/2000/svg">')).toEqual([64, 32]);
    expect(svgSize("<svg width='10cm' height='5cm' viewBox='0 0 30 15'>")).toEqual([30, 15]);
    expect(svgSize('<svg width="100%" height="100%" viewBox="-5,-5 40.4,20.6">')).toEqual([40, 21]);
    expect(svgSize('<svg><rect width="10" height="10"/></svg>')).toBeNull();
    expect(svgSize('<svg width="0" height="0">')).toBeNull();
    expect(svgSize('<html><body>no svg here</body></html>')).toBeNull();
    expect(svgSize('<svgx width="1" height="1">')).toBeNull();
  });
});

describe('looksLikeRaster', () => {
  it('refuses markup and gzip, whatever the name, and passes real pictures', async () => {
    for (const text of [
      '<svg/>',
      '<?xml version="1.0"?><svg/>',
      '\uFEFF \n\t<!DOCTYPE svg>',
      '<!-- x --><svg/>',
    ]) {
      expect(looksLikeRaster(Buffer.from(text)), text).toBe(false);
    }
    expect(looksLikeRaster(Buffer.from([0x1f, 0x8b, 8, 0]))).toBe(false);
    expect(looksLikeRaster(Buffer.alloc(0))).toBe(false);
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    expect(looksLikeRaster(png)).toBe(true);
    expect(looksLikeRaster(readFileSync(join(FIXTURE, ACME, 'landing-pages/boiler/hero.jpg')))).toBe(true);
  });

  it('lists SVG text saved as .png quickly, with no size', async () => {
    const root = copyFixture();
    put(root, `${ACME}media/sneaky.png`, slowSvg());
    const started = Date.now();
    const items = byPath((await lib(root).list('client:acme-heating'))?.items ?? []);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(items.get(`${ACME}media/sneaky.png`)).toMatchObject({ width: null, height: null });
    expect(items.get(`${ACME}context/brand/logo.png`)).toMatchObject({ width: 40, height: 20 });
  });
});

describe('readChecked', () => {
  it('reads the file that was checked, and refuses one swapped in at the same path since', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    const item = (await brain.library('client:acme-heating'))?.items.find(
      (i) => i.name === 'monthly-report.md',
    );
    const file = item ? await brain.libraryFile(item.id) : null;
    if (!file) throw new Error('missing');
    expect((await readChecked(file, 1024))?.data.toString('utf8')).toContain('October performance');
    rmSync(file.absPath);
    writeFileSync(file.absPath, '# October performance\n\nLeads were up.\n'); // a new file, same path
    expect(await readChecked(file, 1024)).toBeNull();
    expect(await readChecked({ ...file }, 1024)).toBeNull(); // only files the library checked
  });
});

describe('scope roots', () => {
  it('lists nothing from outside the brain when clients/ or personal/ is a symbolic link', async () => {
    const root = copyFixture();
    const outside = tempDir();
    renameSync(join(root, 'clients'), join(outside, 'clients'));
    symlinkSync(join(outside, 'clients'), join(root, 'clients'));
    renameSync(join(root, 'personal'), join(outside, 'personal'));
    symlinkSync(join(outside, 'personal'), join(root, 'personal'));
    const library = lib(root);
    expect(await library.scopes()).toEqual([{ id: 'personal', name: 'My personal files', kind: 'personal' }]);
    expect(await library.list('client:acme-heating')).toBeNull();
    expect((await library.list('personal'))?.items).toEqual([]);
  });
});

describe('freshness', () => {
  it('reuses a listing while a live watcher says nothing changed, and re-walks only the changed scope', async () => {
    const root = copyFixture();
    const walks: string[] = [];
    const library = lib(root, { onWalk: (scope) => walks.push(scope) });
    library.setLive('clients', true);
    library.setLive('personal', true);
    await library.list('client:acme-heating');
    await library.list('personal');
    put(root, `${ACME}reports/new.pdf`);
    expect((await library.list('client:acme-heating'))?.items.map((i) => i.name)).not.toContain('new.pdf');
    library.changed(`${ACME}reports/new.pdf`);
    expect((await library.list('client:acme-heating'))?.items.map((i) => i.name)).toContain('new.pdf');
    await library.list('personal');
    expect(walks).toEqual(['client:acme-heating', 'personal', 'client:acme-heating']);
  });

  it('does not hand out a build that started before a change, nor let it replace a newer one', async () => {
    const root = copyFixture();
    const walks: string[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    let walked: () => void = () => {};
    const firstWalked = new Promise<void>((r) => {
      walked = r;
    });
    let first = true;
    const library = lib(root, {
      onWalk: (s) => walks.push(s),
      afterWalk: async () => {
        if (!first) return;
        first = false;
        walked();
        await held; // the first walk has read the folders but not finished
      },
    });
    library.setLive('clients', true);
    const p1 = library.list('client:acme-heating');
    await firstWalked;
    put(root, `${ACME}reports/landed.pdf`);
    library.changed(`${ACME}reports/landed.pdf`);
    const p2 = library.list('client:acme-heating');
    const early = await Promise.race([p2, new Promise<null>((r) => setTimeout(() => r(null), 1000))]);
    release();
    const names = (l: Awaited<typeof p2>) => l?.items.map((i) => i.name) ?? [];
    expect(early).not.toBeNull();
    expect(names(early)).toContain('landed.pdf');
    expect(names(await p1)).not.toContain('landed.pdf');
    // the old build finished last, but the cache keeps the newer listing
    expect(names(await library.list('client:acme-heating'))).toContain('landed.pdf');
    expect(walks).toEqual(['client:acme-heating', 'client:acme-heating']);
  });

  it('marks every scope under a folder stale when the platform does not say which file changed', async () => {
    const root = copyFixture();
    const walks: string[] = [];
    const library = lib(root, { onWalk: (scope) => walks.push(scope) });
    library.setLive('clients', true);
    library.setLive('personal', true);
    await library.list('client:acme-heating');
    await library.list('personal');
    library.changed(null, 'clients');
    await library.list('client:acme-heating');
    await library.list('personal');
    expect(walks).toEqual(['client:acme-heating', 'personal', 'client:acme-heating']);
  });

  it('re-walks a listing older than 30 seconds when there is no live watcher', async () => {
    const root = copyFixture();
    let t = 1_000_000;
    const walks: string[] = [];
    const library = lib(root, { now: () => t, onWalk: (s) => walks.push(s) });
    await library.list('personal');
    t += 29_000;
    await library.list('personal');
    t += 2_000;
    await library.list('personal');
    expect(walks).toEqual(['personal', 'personal']);
  });

  it('keeps sizes and titles in the data folder, never in the brain', async () => {
    const root = copyFixture();
    const dataDir = tempDir();
    const before = readdirSync(root, { recursive: true }).length;
    await lib(root, { dataDir }).list('client:acme-heating');
    await new Promise((r) => setTimeout(r, 50));
    const meta = JSON.parse(readFileSync(join(dataDir, 'library-meta.json'), 'utf8'));
    expect(JSON.stringify(meta)).toContain('October performance');
    expect(readdirSync(root, { recursive: true }).length).toBe(before);

    // a restart reads them back rather than re-reading the file
    const entry = meta.entries[`${ACME}reports/monthly-report.md`];
    entry.title = 'From the saved notes';
    writeFileSync(join(dataDir, 'library-meta.json'), JSON.stringify(meta));
    const again = await lib(root, { dataDir }).list('client:acme-heating');
    expect(again?.items.find((i) => i.name === 'monthly-report.md')?.title).toBe('From the saved notes');
  });

  it('does not save anything when the data folder is inside the brain', async () => {
    const root = copyFixture();
    await lib(root, { dataDir: join(root, 'app-data') }).list('personal');
    await new Promise((r) => setTimeout(r, 50));
    expect(readdirSync(root)).not.toContain('app-data');
  });

  it('copes with a broken saved-notes file', async () => {
    const root = copyFixture();
    const dataDir = tempDir();
    writeFileSync(join(dataDir, 'library-meta.json'), '{not json');
    const listing = await lib(root, { dataDir }).list('client:acme-heating');
    expect(listing?.items.length).toBeGreaterThan(0);
  });

  it('degrades to an empty listing when the scope folder is missing', async () => {
    const root = copyFixture();
    rmSync(join(root, 'personal'), { recursive: true });
    const clients = async (): Promise<ClientInfo[]> => [];
    expect(await lib(root, { clients }).list('personal')).toEqual({
      scope: 'personal',
      groups: [],
      items: [],
      truncated: false,
    });
  });
});
