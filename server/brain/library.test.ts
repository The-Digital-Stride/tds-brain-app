import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import type { ClientInfo, LibraryItem, Role } from '../../shared/contract.ts';
import { ARTIFACT_HEAD_BYTES, artifactMetaBlock, artifactSource } from '../../shared/pages.ts';
import { LEGACY_PROJECTS_SCOPE, type ProjectCard } from '../../shared/projects-contract.ts';
import { listClients } from './clients.ts';
import { createBrainReaders } from './index.ts';
import {
  createLibrary,
  gitIgnored,
  idFor,
  isProtectedFile,
  type LibraryOptions,
  looksLikeRaster,
  readChecked,
  svgSize,
  versionOf,
} from './library.ts';
import type { ProjectsIndex } from './projects.ts';
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

describe('itemForPath', () => {
  const ACME_SCOPE = { id: 'client:acme-heating', name: 'Acme Heating Ltd', kind: 'client' };
  const PERSONAL_SCOPE = { id: 'personal', name: 'My personal files', kind: 'personal' };

  it('resolves client and personal paths with key = the listed item id', async () => {
    const root = copyFixture();
    const brain = createBrainReaders(root);
    const listing = await brain.library('client:acme-heating');
    const report = listing?.items.find((i) => i.path === `${ACME}reports/monthly-report.md`);
    const got = await brain.libraryItemForPath?.(`${ACME}reports/monthly-report.md`);
    expect(got?.key).toBe(report?.id);
    expect(got?.scope).toEqual(ACME_SCOPE);
    expect(got?.item).toMatchObject({ id: report?.id, path: `${ACME}reports/monthly-report.md` });

    const personal = await brain.libraryItemForPath?.('personal/notes/idea.md');
    const idea = (await brain.library('personal'))?.items.find((i) => i.path === 'personal/notes/idea.md');
    expect(personal?.key).toBe(idea?.id);
    expect(personal?.scope).toEqual(PERSONAL_SCOPE);
    expect(personal?.item?.id).toBe(idea?.id);
  });

  it('matches the listing without regard to case, keeping the listed id', async () => {
    const root = copyFixture();
    const library = lib(root);
    const listed = (await library.list('client:acme-heating'))?.items.find((i) => i.name === 'logo.png');
    const got = await library.itemForPath(`${ACME}CONTEXT/Brand/Logo.PNG`);
    expect(got?.key).toBe(listed?.id);
    expect(got?.item?.path).toBe(`${ACME}context/brand/logo.png`);
  });

  it('gives a fresh size and date from the disk for a listed file', async () => {
    const root = copyFixture();
    const library = lib(root);
    library.setLive('clients', true);
    const before = (await library.list('client:acme-heating'))?.items.find((i) => i.name === 'profile.md');
    writeFileSync(join(root, ACME, 'profile.md'), '# Longer than it was before, by quite a lot of text\n');
    const got = await library.itemForPath(`${ACME}profile.md`);
    expect(got?.item?.bytes).not.toBe(before?.bytes);
  });

  it('refuses never-listed paths, unlisted types and paths outside every scope', async () => {
    const root = copyFixture();
    const library = lib(root);
    for (const rel of [
      '.env',
      '.claude/settings.json',
      '.claude/skills/x/SKILL.md',
      'os/README.md',
      'todo/x.md',
      'CLAUDE.md',
      'clients/README.md',
      `${ACME}config/secret.png`,
      `${ACME}config/.env`,
      `${ACME}.private/hidden.md`,
      `${ACME}reports/.draft.md`,
      `${ACME}scripts/run.js`,
      'clients/_archive/x.md',
      'clients/.hidden/x.md',
      'clients/nope/report.md',
      'personal/todo/x.md',
      'personal',
      'personal/',
      'personal/../.env',
      '/etc/passwd',
      `${ACME}reports\\monthly-report.md`,
      '',
    ]) {
      expect(await library.itemForPath(rel), rel).toBeNull();
    }
  });

  it('keeps the id scheme fixed, because starred files are saved by id', () => {
    // Changing how an id is made would silently drop every starred file. If this fails, migrate the saved ids.
    expect(idFor('client:acme-heating', 'clients/acme-heating/reports/x.pdf')).toBe(
      'client:acme-heating.0b5557aed2c2892ca3891e32',
    );
  });

  it('gives a key and no item for a missing file in a scope', async () => {
    const root = copyFixture();
    const library = lib(root);
    const rel = `${ACME}reports/not-yet.md`;
    const got = await library.itemForPath(rel);
    expect(got).toEqual({ key: idFor('client:acme-heating', rel), scope: ACME_SCOPE, item: null });
    const gone = await library.itemForPath('personal/deep/er/gone.pdf');
    expect(gone).toEqual({
      key: idFor('personal', 'personal/deep/er/gone.pdf'),
      scope: PERSONAL_SCOPE,
      item: null,
    });
  });

  it('finds a file made since the scope was listed, and its key is the id it would have', async () => {
    const root = copyFixture();
    const walks: string[] = [];
    const library = lib(root, { onWalk: (s) => walks.push(s) });
    library.setLive('clients', true);
    const rel = `${ACME}reports/new-audit.md`;
    // Asked first while missing, so the key is known before the file exists.
    const before = await library.itemForPath(rel);
    expect(before?.item).toBeNull();
    put(root, rel, '# New audit\n');
    const got = await library.itemForPath(rel);
    expect(got?.key).toBe(before?.key);
    expect(got?.item).toMatchObject({ id: before?.key, path: rel, title: 'New audit' });
    expect(walks).toEqual(['client:acme-heating', 'client:acme-heating']);
  });

  it('refuses a present file the listing leaves out (a symbolic link, too deep), walking once more only', async () => {
    const root = copyFixture();
    const outside = tempDir();
    put(outside, 'x.md', '# outside');
    const linked = `${ACME}reports/linked.md`;
    symlinkSync(join(outside, 'x.md'), join(root, linked));
    const walks: string[] = [];
    const library = lib(root, { onWalk: (s) => walks.push(s), limits: { depth: 1 } });
    library.setLive('clients', true);
    // Cold: the walk made for this lookup is the re-list.
    expect(await library.itemForPath(linked)).toBeNull();
    expect(walks).toHaveLength(1);
    // Asked again (and at once, as at a turn's end) while the listing is current: no more walks.
    await Promise.all([library.itemForPath(linked), library.itemForPath(linked)]);
    expect(await library.itemForPath(linked)).toBeNull();
    expect(walks).toHaveLength(1);
    put(root, `${ACME}a/b/c/deep.md`);
    expect(await library.itemForPath(`${ACME}a/b/c/deep.md`)).toBeNull();
  });

  it('walks once more for a left-out file in a listed scope, then not again until the watcher says so', async () => {
    const root = copyFixture();
    const walks: string[] = [];
    const library = lib(root, { onWalk: (s) => walks.push(s) });
    library.setLive('clients', true);
    await library.list('client:acme-heating');
    const linked = `${ACME}reports/linked.md`;
    const outside = tempDir();
    put(outside, 'x.md', '# outside');
    symlinkSync(join(outside, 'x.md'), join(root, linked));
    // Concurrent lookups share one re-list.
    const both = await Promise.all([library.itemForPath(linked), library.itemForPath(linked)]);
    expect(both).toEqual([null, null]);
    expect(walks).toHaveLength(2);
    expect(await library.itemForPath(linked)).toBeNull();
    expect(walks).toHaveLength(2);
    // A change in that scope: the next lookup lists it again.
    library.changed(`${ACME}reports/other.md`);
    expect(await library.itemForPath(linked)).toBeNull();
    expect(walks).toHaveLength(3);
    expect(await library.itemForPath(linked)).toBeNull();
    expect(walks).toHaveLength(3);
  });

  it('is wired into the brain readers and never throws for a missing brain', async () => {
    const brain = createBrainReaders('/nonexistent/brain');
    expect(await brain.libraryItemForPath?.('personal/x.md')).toBeNull();
  });
});

describe('the Templates area', () => {
  function brain(): string {
    const root = tempDir();
    put(root, 'personal/note.md');
    return root;
  }

  it('is listed after personal when templates/ is a real folder, even with no clients/', async () => {
    const root = brain();
    put(root, 'templates/readme.md');
    const l = lib(root);
    const all = await l.scopes();
    expect(all.map((s) => s.id)).toEqual(['personal', 'shared:templates']);
    expect(all[1]).toMatchObject({ name: 'Templates', kind: 'shared' });
  });

  it('is absent when templates/ is missing or a symbolic link', async () => {
    const root = brain();
    expect((await lib(root).scopes()).map((s) => s.id)).toEqual(['personal']);
    const outside = tempDir();
    put(outside, 'x.md');
    symlinkSync(outside, join(root, 'templates'));
    expect((await lib(root).scopes()).map((s) => s.id)).toEqual(['personal']);
  });

  it('groups loose files under "Templates" first, then folders, with no client rules', async () => {
    const root = brain();
    put(root, 'templates/readme.md');
    put(root, 'templates/reports/r.md');
    put(root, 'templates/emails/e.md');
    const listing = await lib(root).list('shared:templates');
    expect(listing?.groups).toEqual(['Templates', 'Emails', 'Reports']);
  });

  it('hides AGENTS.md and CLAUDE.md in templates (listing and by id) but not in personal', async () => {
    const root = brain();
    put(root, 'templates/AGENTS.md');
    put(root, 'templates/sub/claude.md');
    put(root, 'templates/ok.md');
    put(root, 'personal/CLAUDE.md');
    const l = lib(root);
    const t = await l.list('shared:templates');
    expect(t?.items.map((i) => i.path)).toEqual(['templates/ok.md']);
    const p = await l.list('personal');
    expect(p?.items.map((i) => i.path).sort()).toEqual(['personal/CLAUDE.md', 'personal/note.md']);
    // An id built by hand for a hidden file cannot fetch it.
    expect(await l.file(idFor('shared:templates', 'templates/AGENTS.md'))).toBeNull();
    expect(await l.file(idFor('personal', 'personal/CLAUDE.md'))).not.toBeNull();
  });

  it('refreshes on a change under templates/ and leaves the client areas alone', async () => {
    const root = brain();
    put(root, 'templates/a.md');
    put(root, `${ACME}reports/r.md`);
    const l = lib(root);
    l.setLive('templates', true);
    l.setLive('clients', true);
    await l.list('shared:templates');
    await l.list('client:acme-heating');
    put(root, 'templates/b.md');
    put(root, `${ACME}reports/s.md`);
    l.changed('templates/b.md');
    expect((await l.list('shared:templates'))?.items.map((i) => i.name)).toEqual(['a.md', 'b.md']);
    expect((await l.list('client:acme-heating'))?.items.map((i) => i.name)).not.toContain('s.md');
    put(root, 'templates/c.md');
    l.changed(null, 'templates');
    expect((await l.list('shared:templates'))?.items.map((i) => i.name)).toContain('c.md');
  });
});

describe('version and canDelete (plan 2026-11-15-delete-library-files)', () => {
  const noneIgnored = async () => new Set<string>();
  const as = (role: Role) => async () => ({ role });
  /** Of the files `deletable()` adds (the fixture has others), the ones with a bin. */
  const MINE = new Set([
    `${ACME}reports/r.md`,
    `${ACME}logo.png`,
    `${ACME}profile.md`,
    `${ACME}README.md`,
    `${ACME}data/semrush.csv`,
    'templates/t.md',
    'templates/CLAUDE.md',
    'personal/p.md',
  ]);
  const ids = (items: LibraryItem[] | undefined) =>
    items
      ?.filter((i) => i.canDelete && MINE.has(i.path))
      .map((i) => i.path)
      .sort();

  function deletable() {
    const root = copyFixture();
    put(root, `${ACME}reports/r.md`);
    put(root, `${ACME}logo.png`);
    put(root, `${ACME}profile.md`);
    put(root, `${ACME}README.md`);
    put(root, `${ACME}data/semrush.csv`);
    put(root, 'templates/t.md');
    put(root, 'templates/CLAUDE.md');
    put(root, 'personal/p.md');
    return root;
  }

  it('gives every item the same version versionOf gives its bytes and mtime', async () => {
    const root = deletable();
    const l = lib(root);
    const listing = await l.list('client:acme-heating');
    for (const item of listing?.items ?? []) {
      const st = statSync(join(root, item.path));
      expect(item.version).toBe(versionOf(st.size, st.mtimeMs));
      const file = await l.file(item.id);
      expect(file?.item.version).toBe(file?.version);
      expect(file?.item.version).toBe(item.version);
    }
  });

  it('lists the version in whole milliseconds even when the time stamp ends in .999999999 s', async () => {
    const root = deletable();
    const rel = `${ACME}reports/r.md`;
    // Node's own utimes can't set nanoseconds, so python3 does (present on every Mac this runs on).
    const ns = 1763200000999999999n;
    try {
      execFileSync('python3', [
        '-c',
        `import os,sys; os.utime(sys.argv[1], ns=(${ns}, ${ns}))`,
        join(root, rel),
      ]);
    } catch {
      return; // no python3: nothing to pin
    }
    const listing = await lib(root).list('client:acme-heating');
    const item = listing?.items.find((i) => i.path === rel);
    const bytes = statSync(join(root, rel)).size;
    // The script's rule: bigint stat, whole milliseconds. A plain stat gives ...1000 (rounded up).
    expect(item?.version).toBe(`${bytes}-${ns / 1_000_000n}`);
  });

  it('shows no bin without the capability or when deletion is not offered', async () => {
    const root = deletable();
    expect(ids((await lib(root).list('client:acme-heating'))?.items)).toEqual([]);
    const none = lib(root, { deletion: async () => null, ignored: noneIgnored });
    expect(ids((await none.list('client:acme-heating'))?.items)).toEqual([]);
  });

  it('lets any known role delete client files, but not protected names', async () => {
    const root = deletable();
    for (const role of ['owner', 'scout', 'team'] as const) {
      const l = lib(root, { deletion: as(role), ignored: noneIgnored });
      expect(ids((await l.list('client:acme-heating'))?.items)).toEqual([
        `${ACME}data/semrush.csv`,
        `${ACME}logo.png`,
        `${ACME}reports/r.md`,
      ]);
    }
  });

  it('gives a single file the same canDelete as its listing (Home stars, chat files)', async () => {
    const root = deletable();
    // A fresh library each time, so file() and itemForPath() can't lean on an earlier list().
    const fresh = () => lib(root, { deletion: as('team'), ignored: noneIgnored });
    const listed = (await fresh().list('client:acme-heating'))?.items ?? [];
    const report = listed.find((i) => i.path === `${ACME}reports/r.md`);
    const profile = listed.find((i) => i.path === `${ACME}profile.md`);
    expect(report?.canDelete).toBe(true);
    expect((await fresh().file(report?.id ?? ''))?.item.canDelete).toBe(true);
    expect((await fresh().file(profile?.id ?? ''))?.item.canDelete).not.toBe(true);
    expect((await fresh().itemForPath(`${ACME}reports/r.md`))?.item?.canDelete).toBe(true);
    expect((await fresh().itemForPath(`${ACME}profile.md`))?.item?.canDelete).not.toBe(true);
    // Without deletion offered, a single file has no bin either.
    expect((await lib(root).file(report?.id ?? ''))?.item.canDelete).not.toBe(true);
    // A deletable file still reads: `canDelete` went on before check(), not on a copy readChecked won't trust.
    const opened = await fresh().file(report?.id ?? '');
    if (!opened) throw new Error('missing');
    expect((await readChecked(opened, 1024))?.data.toString('utf8')).toBeTruthy();
  });

  it('works out what may be deleted once per listing, however many single files are asked for', async () => {
    const root = deletable();
    let asked = 0;
    const l = lib(root, {
      deletion: as('team'),
      ignored: async () => {
        asked += 1;
        return new Set<string>();
      },
    });
    const items = (await l.list('client:acme-heating'))?.items ?? [];
    for (const item of items) await l.file(item.id);
    expect(asked).toBe(1);
  });

  it('shows no client bins to someone who is not on the team', async () => {
    const root = deletable();
    const l = lib(root, { deletion: as('unknown'), ignored: noneIgnored });
    expect(ids((await l.list('client:acme-heating'))?.items)).toEqual([]);
  });

  it('lets only the owner delete templates, and never personal files', async () => {
    const root = deletable();
    for (const role of ['scout', 'team', 'unknown'] as const) {
      const l = lib(root, { deletion: as(role), ignored: noneIgnored });
      expect(ids((await l.list('shared:templates'))?.items)).toEqual([]);
    }
    const owner = lib(root, { deletion: as('owner'), ignored: noneIgnored });
    expect(ids((await owner.list('shared:templates'))?.items)).toEqual(['templates/t.md']);
    expect(ids((await owner.list('personal'))?.items)).toEqual([]);
  });

  it('leaves out files git ignores, and everything when git cannot answer', async () => {
    const root = deletable();
    const asked: string[][] = [];
    const l = lib(root, {
      deletion: as('team'),
      ignored: async (rels) => {
        asked.push(rels);
        return new Set([`${ACME}data/semrush.csv`]);
      },
    });
    expect(ids((await l.list('client:acme-heating'))?.items)).toEqual([
      `${ACME}logo.png`,
      `${ACME}reports/r.md`,
    ]);
    await l.list('client:acme-heating');
    // One batched question, kept for the same built listing; protected names are not even asked about.
    expect(asked).toHaveLength(1);
    expect(asked[0]).not.toContain(`${ACME}profile.md`);
    const broken = lib(root, { deletion: as('team'), ignored: async () => null });
    expect(ids((await broken.list('client:acme-heating'))?.items)).toEqual([]);
    const throws = lib(root, {
      deletion: as('team'),
      ignored: async () => {
        throw new Error('no git');
      },
    });
    expect(ids((await throws.list('client:acme-heating'))?.items)).toEqual([]);
  });

  it('asks a real git repository which files it ignores', async () => {
    const root = deletable();
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, '.gitignore'), 'clients/*/data/\n');
    const l = lib(root, { deletion: as('team') });
    expect(ids((await l.list('client:acme-heating'))?.items)).toEqual([
      `${ACME}logo.png`,
      `${ACME}reports/r.md`,
    ]);
    expect(await gitIgnored(root, [`${ACME}data/semrush.csv`, `${ACME}logo.png`])).toEqual(
      new Set([`${ACME}data/semrush.csv`]),
    );
    expect(await gitIgnored(root, [`${ACME}logo.png`])).toEqual(new Set());
  });

  it('gets no answer from git outside a repository', async () => {
    const root = tempDir();
    put(root, 'a.md');
    expect(await gitIgnored(root, ['a.md'])).toBeNull();
  });

  it('recognises protected names', () => {
    expect(isProtectedFile('clients/x/CLAUDE.md')).toBe(true);
    expect(isProtectedFile('templates/sub/readme.MD')).toBe(true);
    expect(isProtectedFile('clients/x/profile.md')).toBe(true);
    expect(isProtectedFile('clients/x/notes/profile.md')).toBe(false);
    expect(isProtectedFile('clients/x/logo.png')).toBe(false);
  });
});

describe('projects in the library (projects R1, decisions 7 and 27)', () => {
  /** A fake index over `cards`: by folder prefix or link, read afresh each time so a test can edit them. */
  function fakeIndex(cards: Partial<ProjectCard>[]): () => Promise<ProjectsIndex> {
    return async () => ({
      cards: cards as ProjectCard[],
      byKey: (key) => (cards.find((c) => c.key === key) as ProjectCard | undefined) ?? null,
      keysForPath: (rel) =>
        cards
          .filter(
            (c) =>
              rel.toLowerCase().startsWith(`${c.folder?.toLowerCase()}/`) ||
              (c.links ?? []).some((l) => l.toLowerCase() === rel.toLowerCase()),
          )
          .map((c) => c.key as string),
      resolve: () => ({ how: 'none' }),
    });
  }
  const web: Partial<ProjectCard> = {
    key: 'acme-heating/web',
    space: 'client',
    client: 'acme-heating',
    folder: `${ACME}projects/web`,
    links: [],
  };

  function projectRoot() {
    const root = copyFixture();
    put(root, `${ACME}projects/web/brief.md`, '# Brief');
    put(root, `${ACME}projects/web/mock.png`);
    put(root, `${ACME}reports/r.md`, '# R');
    put(root, 'templates/logo.png');
    put(root, 'personal/secret.pdf');
    put(root, 'projects/old-site/notes.md', '# Notes');
    put(root, 'projects/old-site/hero.png');
    return root;
  }

  it('fills projects by folder and by link when serving, never in the cached listing', async () => {
    const root = projectRoot();
    const cards = [{ ...web }];
    let walks = 0;
    const l = lib(root, { projects: fakeIndex(cards), onWalk: () => walks++ });
    const first = await l.list('client:acme-heating');
    const at = byPath(first?.items ?? []);
    expect(at.get(`${ACME}projects/web/brief.md`)?.projects).toEqual(['acme-heating/web']);
    expect(at.get(`${ACME}reports/r.md`)?.projects).toEqual([]);
    // A card edit (a new link) shows at once, with no walk of that scope.
    cards[0] = { ...web, links: [`${ACME}reports/r.md`] };
    const second = await l.list('client:acme-heating');
    expect(byPath(second?.items ?? []).get(`${ACME}reports/r.md`)?.projects).toEqual(['acme-heating/web']);
    expect(walks).toBe(1);
    // The one-file lookups and search are served the same way.
    const hit = await l.itemForPath(`${ACME}reports/r.md`);
    expect(hit?.item?.projects).toEqual(['acme-heating/web']);
    const id = at.get(`${ACME}reports/r.md`)?.id as string;
    expect((await l.file(id))?.item.projects).toEqual(['acme-heating/web']);
    const found = await l.search('brief', 'document');
    expect(found.hits.map((h) => h.item.projects)).toEqual([['acme-heating/web']]);
  });

  it('adds no projects when there is no index, or it fails', async () => {
    const root = projectRoot();
    const plain = await lib(root).list('client:acme-heating');
    expect(plain?.items.every((i) => i.projects === undefined)).toBe(true);
    const broken = lib(root, {
      projects: async () => {
        throw new Error('no index');
      },
    });
    expect((await broken.list('client:acme-heating'))?.items.every((i) => i.projects === undefined)).toBe(
      true,
    );
  });

  it('lists the older projects folders as a read-only scope with no bin', async () => {
    const root = projectRoot();
    const l = lib(root, { deletion: async () => ({ role: 'owner' }), ignored: async () => new Set() });
    expect(await l.scopes()).toContainEqual({
      id: LEGACY_PROJECTS_SCOPE,
      name: 'Older projects',
      kind: 'shared',
    });
    const listing = await l.list(LEGACY_PROJECTS_SCOPE);
    expect(listing?.items.map((i) => i.path).sort()).toEqual([
      'projects/old-site/hero.png',
      'projects/old-site/notes.md',
    ]);
    expect(listing?.groups).toEqual(['Old site']);
    expect(listing?.items.some((i) => i.canDelete)).toBe(false);
    // The same setup does give a client's files a bin.
    const client = await l.list('client:acme-heating');
    expect(client?.items.some((i) => i.canDelete)).toBe(true);
    const id = listing?.items[0]?.id as string;
    expect((await l.file(id))?.item.canDelete).toBeUndefined();
  });

  it('has no older projects scope when projects/ is missing, and marks it stale when it changes', async () => {
    const root = copyFixture();
    const l = lib(root);
    expect((await l.scopes()).map((s) => s.id)).not.toContain(LEGACY_PROJECTS_SCOPE);
    put(root, 'projects/a/x.md');
    put(root, 'projects/b/y.md');
    let walks = 0;
    const live = lib(root, { onWalk: () => walks++ });
    live.setLive('projects', true);
    await live.list(LEGACY_PROJECTS_SCOPE);
    await live.list(LEGACY_PROJECTS_SCOPE);
    expect(walks).toBe(1);
    live.changed('projects/a/z.md');
    await live.list(LEGACY_PROJECTS_SCOPE);
    expect(walks).toBe(2);
    live.changed(null, 'projects');
    await live.list(LEGACY_PROJECTS_SCOPE);
    expect(walks).toBe(3);
  });

  it('never lists or finds the files a card keeps for itself', async () => {
    const root = copyFixture();
    for (const folder of ['projects/old', 'personal/projects/mine', `${ACME}projects/web`]) {
      put(root, `${folder}/notes.md`, '# Notes');
      put(root, `${folder}/project.md`, '# Card');
      put(root, `${folder}/retainer.md`, '# Retainer');
      put(root, `${folder}/updates/2026-11-20.md`, '# Update');
      put(root, `${folder}/months/2026-11.md`, '# Month');
      put(root, `${folder}/docs/project.md`, '# Kept: not at the top');
    }
    const l = lib(root);
    const own: [string, string][] = [
      [LEGACY_PROJECTS_SCOPE, 'projects/old'],
      ['personal', 'personal/projects/mine'],
      ['client:acme-heating', `${ACME}projects/web`],
    ];
    for (const [scope, folder] of own) {
      const paths = ((await l.list(scope))?.items.map((i) => i.path) ?? []).filter((p) =>
        p.startsWith(`${folder}/`),
      );
      expect(paths.sort(), scope).toEqual([`${folder}/docs/project.md`, `${folder}/notes.md`]);
    }
    const hits = (await l.search('project', 'document')).hits.map((h) => h.item.path);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((p) => /\/(retainer|project)\.md$/.test(p) && !p.includes('/docs/'))).toBe(false);
    expect(hits.some((p) => p.includes('/updates/') || p.includes('/months/'))).toBe(false);
    expect(await l.itemForPath('projects/old/project.md')).toBeNull();
    expect(await l.itemForPath(`${ACME}projects/web/updates/2026-11-20.md`)).toBeNull();
  });

  describe('projectFiles', () => {
    const card = (over: Partial<ProjectCard> = {}) => ({ ...web, ...over }) as ProjectCard;

    it('spans scopes: the folder, plus each link that is listed now', async () => {
      const root = projectRoot();
      const l = lib(root, { projects: fakeIndex([web]) });
      const out = await l.projectFiles(
        card({ links: ['templates/logo.png', `${ACME}reports/r.md`, 'templates/gone.png'] }),
        'image',
      );
      expect(out.items.map((i) => i.path).sort()).toEqual([
        `${ACME}projects/web/mock.png`,
        'templates/logo.png',
      ]);
      // The missing image is counted; the document link is simply not an image.
      expect(out.hidden).toBe(1);
      const docs = await l.projectFiles(
        card({ links: [`${ACME}reports/r.md`, 'templates/logo.png'] }),
        'document',
      );
      expect(docs.items.map((i) => i.path).sort()).toEqual([
        `${ACME}projects/web/brief.md`,
        `${ACME}reports/r.md`,
      ]);
      expect(docs.hidden).toBe(0);
    });

    it('serves the files with their projects, and each file once', async () => {
      const root = projectRoot();
      const c = card({ links: [`${ACME}projects/web/mock.png`] });
      const l = lib(root, { projects: fakeIndex([c]) });
      const out = await l.projectFiles(c, 'image');
      expect(out.items).toHaveLength(1);
      expect(out.items[0]?.projects).toEqual(['acme-heating/web']);
    });

    it("leaves out links that are gone or that would show someone's personal file, and counts them", async () => {
      const root = projectRoot();
      const l = lib(root);
      const shared = await l.projectFiles(
        card({ links: ['personal/secret.pdf', `${ACME}reports/gone.pdf`] }),
        'document',
      );
      expect(shared.items.map((i) => i.path)).toEqual([`${ACME}projects/web/brief.md`]);
      expect(shared.hidden).toBe(2);
      // A personal project may link its own file.
      const mine = card({
        key: 'personal/plan',
        space: 'personal',
        client: null,
        folder: 'personal/projects/plan',
        links: ['personal/secret.pdf'],
      });
      const own = await l.projectFiles(mine, 'document');
      expect(own.items.map((i) => i.path)).toEqual(['personal/secret.pdf']);
      expect(own.hidden).toBe(0);
    });

    it('lists a legacy project folder from the older projects scope, and nothing for an archived folder', async () => {
      const root = projectRoot();
      put(root, 'projects-archive/done/old.md');
      const l = lib(root);
      const legacy = card({
        key: 'the-digital-stride/old-site',
        space: 'legacy',
        folder: 'projects/old-site',
        links: [],
      });
      expect((await l.projectFiles(legacy, 'image')).items.map((i) => i.path)).toEqual([
        'projects/old-site/hero.png',
      ]);
      const archived = card({ folder: 'projects-archive/done', archived: true, links: [] });
      expect(await l.projectFiles(archived, 'document')).toEqual({ items: [], hidden: 0 });
    });
  });
});

describe('claude artifacts in the library (plan 2026-11-23-claude-artifacts-in-projects, decision 4)', () => {
  const URL = 'https://claude.ai/artifact/AbC123';
  const tagged = (extra = '') =>
    `<!doctype html>\n${artifactMetaBlock({ url: URL, copied: '2026-11-23', kind: 'copy', partial: false })}<html><head><title>T</title></head><body>${extra}</body></html>`;
  const setup = () => {
    const root = tempDir();
    put(root, 'clients/acme/profile.md', '# Acme');
    return root;
  };
  const items = async (root: string, over: Partial<LibraryOptions> = {}) =>
    (await lib(root, over).list('client:acme'))?.items ?? [];

  it('adds `artifact` to html and htm files that carry the tags, and to nothing else', async () => {
    const root = setup();
    put(root, 'clients/acme/projects/site/files/page.html', tagged());
    put(root, 'clients/acme/projects/site/files/old.htm', tagged());
    put(root, 'clients/acme/projects/site/files/plain.html', '<!doctype html><title>x</title>');
    put(root, 'clients/acme/projects/site/files/note.md', `# Note\n${tagged()}`);
    const by = byPath(await items(root));
    const base = 'clients/acme/projects/site/files/';
    expect(by.get(`${base}page.html`)?.artifact).toEqual({
      url: URL,
      copied: '2026-11-23',
      kind: 'copy',
      partial: false,
    });
    expect(by.get(`${base}old.htm`)?.artifact?.url).toBe(URL);
    expect('artifact' in (by.get(`${base}plain.html`) ?? {})).toBe(false);
    expect('artifact' in (by.get(`${base}note.md`) ?? {})).toBe(false);
  });

  it('leaves it off a page over PAGE_MAX_BYTES, and ignores tags past the head limit', async () => {
    const root = setup();
    put(root, 'clients/acme/projects/site/files/huge.html', tagged('x'.repeat(5 * 1024 * 1024)));
    put(
      root,
      'clients/acme/projects/site/files/late.html',
      `<!doctype html><!-- ${'x'.repeat(ARTIFACT_HEAD_BYTES)} -->\n${tagged()}`,
    );
    for (const i of await items(root)) expect('artifact' in i).toBe(false);
  });

  it('leaves it off when the file cannot be read', async () => {
    const root = setup();
    put(root, 'clients/acme/projects/site/files/a.html', tagged());
    const lister = lib(root);
    // an unreadable file is listed but gets no artifact: a symbolic link is refused by the capped read
    rmSync(join(root, 'clients/acme/projects/site/files/a.html'));
    symlinkSync('/nonexistent', join(root, 'clients/acme/projects/site/files/a.html'));
    const listing = await lister.list('client:acme');
    for (const i of listing?.items ?? []) expect('artifact' in i).toBe(false);
  });

  it('reads the head again only when the file changes', async () => {
    const root = setup();
    const dataDir = tempDir();
    const rel = 'clients/acme/projects/site/files/page.html';
    put(root, rel, tagged());
    const first = await items(root, { dataDir });
    expect(first.find((i) => i.path === rel)?.artifact?.url).toBe(URL);
    await new Promise((r) => setTimeout(r, 50));
    // the saved value is used while the version matches: change it on disk-store only
    const metaFile = join(dataDir, 'library-meta.json');
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    meta.entries[rel].artifact.copied = '2020-01-01';
    writeFileSync(metaFile, JSON.stringify(meta));
    const cached = await items(root, { dataDir });
    expect(cached.find((i) => i.path === rel)?.artifact?.copied).toBe('2020-01-01');
    // a changed file (new size) is read again
    put(root, rel, tagged('<p>more</p>'));
    const reread = await items(root, { dataDir });
    expect(reread.find((i) => i.path === rel)?.artifact?.copied).toBe('2026-11-23');
  });

  it('refuses a saved artifact whose address is not a claude.ai one', async () => {
    const root = setup();
    const dataDir = tempDir();
    const rel = 'clients/acme/projects/site/files/page.html';
    put(root, rel, tagged());
    await items(root, { dataDir });
    await new Promise((r) => setTimeout(r, 50));
    const metaFile = join(dataDir, 'library-meta.json');
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    meta.entries[rel].artifact.url = 'https://evil.example/x';
    writeFileSync(metaFile, JSON.stringify(meta));
    const got = await items(root, { dataDir });
    expect('artifact' in (got.find((i) => i.path === rel) ?? {})).toBe(false);
  });

  describe('writer and reader agree: the real tdsapp-files add-artifact script', () => {
    const SCRIPT = join(process.cwd(), 'brain-skills/tdsapp-files/scripts/tdsapp-files.cjs');
    const run = (brain: string, home: string, input: object) => {
      const r = spawnSync(process.execPath, [SCRIPT, 'add-artifact'], {
        input: JSON.stringify(input),
        cwd: brain,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: home, BRAIN_ROOT: brain },
      });
      return {
        status: r.status,
        reply: JSON.parse(r.stdout.split('\n').filter(Boolean)[0] ?? '{}'),
        err: r.stderr,
      };
    };
    const gitBrain = () => {
      const brain = tempDir();
      const home = tempDir();
      const g = (args: string[]) =>
        execFileSync('git', args, {
          cwd: brain,
          env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
        });
      g(['init', '-q']);
      g(['config', 'user.email', 'olive@example.test']);
      mkdirSync(join(brain, '.team-config'));
      writeFileSync(
        join(brain, '.team-config', 'roles.json'),
        JSON.stringify({ members: [{ name: 'Olive Owner', email: 'olive@example.test', role: 'owner' }] }),
      );
      put(brain, 'clients/acme/profile.md', '# Acme');
      mkdirSync(join(brain, 'clients/acme/projects/site'), { recursive: true });
      put(brain, 'clients/acme/projects/site/project.md', '# Site');
      return { brain, home };
    };

    it('a copy and a link card, as the script writes them, read back through artifactSource and the library', async () => {
      const { brain, home } = gitBrain();
      const src = join(tempDir(), 'page.html');
      writeFileSync(src, '<!doctype html><html><head><title>Mine</title></head><body>hi</body></html>');
      const copy = run(brain, home, {
        url: `${URL}?utm=1#x`,
        path: 'clients/acme/projects/site/files/mine.html',
        source: src,
        partial: true,
        copied: '2026-11-23',
      });
      expect(copy.reply, copy.err).toMatchObject({ ok: true, kind: 'copy' });
      const card = run(brain, home, {
        url: URL,
        path: 'clients/acme/projects/site/files/card.html',
        title: 'A <b>card</b>',
        copied: '2026-11-22',
      });
      expect(card.reply, card.err).toMatchObject({ ok: true, kind: 'link' });

      const copyText = readFileSync(join(brain, copy.reply.path), 'utf8');
      const cardText = readFileSync(join(brain, card.reply.path), 'utf8');
      // byte-identical block
      const block = artifactMetaBlock({ url: URL, copied: '2026-11-23', kind: 'copy', partial: true });
      expect(copyText.startsWith(`<!doctype html>${block}`) || copyText.includes(block)).toBe(true);
      expect(artifactSource(copyText)).toEqual({
        url: URL,
        copied: '2026-11-23',
        kind: 'copy',
        partial: true,
      });
      expect(artifactSource(cardText)).toEqual({
        url: URL,
        copied: '2026-11-22',
        kind: 'link',
        partial: false,
      });

      const got = byPath(await items(brain));
      expect(got.get(copy.reply.path)?.artifact?.kind).toBe('copy');
      expect(got.get(card.reply.path)?.artifact?.kind).toBe('link');
    });
  });
});
