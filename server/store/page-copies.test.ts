import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PAGE_COPY_MAX_BYTES } from '../../shared/pages-contract.ts';
import { createPageCopies, isPageKey } from './page-copies.ts';

const CHAT = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';

const temp: string[] = [];
afterAll(() => {
  for (const d of temp.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dir(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temp.push(d);
  return d;
}

function setup(over: { chatMaxBytes?: number; maxBytes?: number; now?: () => number } = {}) {
  const dataDir = dir('tba-pages-data-');
  const tmpRoot = dir('tba-pages-tmp-');
  const brain = dir('tba-pages-brain-');
  const outside = dir('tba-pages-outside-');
  const trashed: string[] = [];
  const store = createPageCopies({
    dataDir,
    roots: [brain],
    tmpRoot,
    trash: async (p) => {
      trashed.push(p);
      rmSync(p, { recursive: true, force: true });
    },
    ...over,
  });
  const page = (root: string, name: string, body = '<title>A page</title><p>Hi</p>') => {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body);
    return p;
  };
  const copyFile = (chat: string, key: string, n: number) => join(dataDir, 'pages', chat, key, `v${n}.html`);
  return { dataDir, tmpRoot, brain, outside, store, trashed, page, copyFile };
}

describe('page copies: what is copied', () => {
  it('copies a page under Claude’s temporary folder, read-only, with its title', async () => {
    const { store, tmpRoot, page, copyFile, dataDir } = setup();
    const src = page(tmpRoot, 'scratchpad/budget.html', '<title>Budget &amp; plan</title>x');
    const got = await store.copy(CHAT, 'k1', 1, src);
    expect(got).toEqual({ title: 'Budget & plan', evicted: [] });
    const dest = copyFile(CHAT, 'k1', 1);
    expect(readFileSync(dest, 'utf8')).toBe('<title>Budget &amp; plan</title>x');
    expect(statSync(dest).mode & 0o777).toBe(0o444);
    expect(statSync(join(dataDir, 'pages')).mode & 0o777).toBe(0o700);
    expect(statSync(join(dataDir, 'pages', CHAT)).mode & 0o777).toBe(0o700);
    expect(statSync(join(dataDir, 'pages', CHAT, 'k1')).mode & 0o777).toBe(0o700);
    // No temporary file is left behind (the write is a temp file, then a link into place).
    expect(readdirSync(join(dataDir, 'pages', CHAT, 'k1'))).toEqual(['v1.html']);
  });

  it('copies a page in the brain, and takes .htm in any case', async () => {
    const { store, brain, page } = setup();
    expect(await store.copy(CHAT, 'k1', 1, page(brain, 'clients/acme/reports/r.html'))).not.toBeNull();
    expect(await store.copy(CHAT, 'k2', 1, page(brain, 'clients/acme/reports/r.HTM'))).not.toBeNull();
  });

  it('names an untitled page after its file', async () => {
    const { store, tmpRoot, page } = setup();
    const got = await store.copy(CHAT, 'k1', 1, page(tmpRoot, 'my-report.html', '<p>no title</p>'));
    expect(got?.title).toBe('my-report');
  });

  it('refuses a path outside the allowed folders', async () => {
    const { store, outside, page, copyFile } = setup();
    expect(await store.copy(CHAT, 'k1', 1, page(outside, 'secret.html'))).toBeNull();
    expect(existsSync(copyFile(CHAT, 'k1', 1))).toBe(false);
  });

  it('refuses a relative path, another type, control characters and an over-long path', async () => {
    const { store, tmpRoot, page } = setup();
    page(tmpRoot, 'notes.txt');
    expect(await store.copy(CHAT, 'k1', 1, 'scratchpad/a.html')).toBeNull();
    expect(await store.copy(CHAT, 'k1', 1, join(tmpRoot, 'notes.txt'))).toBeNull();
    expect(await store.copy(CHAT, 'k1', 1, `${join(tmpRoot, 'a')}\n.html`)).toBeNull();
    expect(await store.copy(CHAT, 'k1', 1, `${tmpRoot}/${'a'.repeat(1100)}.html`)).toBeNull();
  });

  it('refuses a symbolic link, even one to an allowed page', async () => {
    const { store, tmpRoot, page } = setup();
    const real = page(tmpRoot, 'real.html');
    const link = join(tmpRoot, 'link.html');
    symlinkSync(real, link);
    expect(await store.copy(CHAT, 'k1', 1, link)).toBeNull();
  });

  it('refuses a link out of the allowed folders through a linked folder', async () => {
    const { store, tmpRoot, outside, page } = setup();
    page(outside, 'secret.html');
    symlinkSync(outside, join(tmpRoot, 'out'));
    expect(await store.copy(CHAT, 'k1', 1, join(tmpRoot, 'out', 'secret.html'))).toBeNull();
  });

  it('refuses a FIFO without hanging, a folder and a missing file', async () => {
    const { store, tmpRoot } = setup();
    const fifo = join(tmpRoot, 'pipe.html');
    execFileSync('mkfifo', [fifo]);
    expect(await store.copy(CHAT, 'k1', 1, fifo)).toBeNull();
    mkdirSync(join(tmpRoot, 'folder.html'));
    expect(await store.copy(CHAT, 'k1', 1, join(tmpRoot, 'folder.html'))).toBeNull();
    expect(await store.copy(CHAT, 'k1', 1, join(tmpRoot, 'gone.html'))).toBeNull();
  });

  it('copies a page at the size cap and refuses one a byte over', async () => {
    const { store, tmpRoot, page } = setup();
    expect(PAGE_COPY_MAX_BYTES).toBe(16 * 1024 * 1024);
    const at = page(tmpRoot, 'at.html', 'x'.repeat(PAGE_COPY_MAX_BYTES));
    const over = page(tmpRoot, 'over.html', 'x'.repeat(PAGE_COPY_MAX_BYTES + 1));
    expect(await store.copy(CHAT, 'k1', 1, at)).not.toBeNull();
    expect(await store.copy(CHAT, 'k2', 1, over)).toBeNull();
  });

  it('refuses a source inside the app’s own copies', async () => {
    const { store, tmpRoot, page, copyFile } = setup();
    await store.copy(CHAT, 'k1', 1, page(tmpRoot, 'a.html'));
    const dataStore = createPageCopies({
      dataDir: join(copyFile(CHAT, 'k1', 1), '..', '..', '..', '..'),
      roots: [join(copyFile(CHAT, 'k1', 1), '..')],
      tmpRoot,
      trash: async () => {},
    });
    expect(await dataStore.copy(CHAT, 'k2', 1, copyFile(CHAT, 'k1', 1))).toBeNull();
  });

  it('never rewrites a stored copy', async () => {
    const { store, tmpRoot, page, copyFile } = setup();
    const src = page(tmpRoot, 'a.html', '<title>First</title>');
    await store.copy(CHAT, 'k1', 1, src);
    writeFileSync(src, '<title>Second</title>');
    expect((await store.copy(CHAT, 'k1', 1, src))?.title).toBe('First');
    expect(readFileSync(copyFile(CHAT, 'k1', 1), 'utf8')).toBe('<title>First</title>');
  });

  it('keeps keys, chat ids and version numbers inside its folder', async () => {
    const { store, tmpRoot, page, dataDir } = setup();
    const src = page(tmpRoot, 'a.html');
    for (const key of ['..', '../x', 'a/b', '', '.hidden', 'x'.repeat(65), 'a b']) {
      expect(isPageKey(key), key).toBe(false);
      expect(await store.copy(CHAT, key, 1, src), key).toBeNull();
    }
    for (const chat of ['..', 'not-a-uuid', `${CHAT}/..`]) {
      expect(await store.copy(chat, 'k1', 1, src), chat).toBeNull();
    }
    for (const n of [0, -1, 1.5, Number.NaN, 100_000]) {
      expect(await store.copy(CHAT, 'k1', n, src), String(n)).toBeNull();
    }
    expect(existsSync(join(dataDir, 'pages'))).toBe(false);
  });
});

describe('page copies: reading them back', () => {
  it('reads a stored copy, its title and its path; null when there is none', async () => {
    const { store, tmpRoot, page, copyFile } = setup();
    await store.copy(CHAT, 'k1', 2, page(tmpRoot, 'a.html', '<title>T</title>body'));
    expect((await store.read(CHAT, 'k1', 2))?.toString('utf8')).toBe('<title>T</title>body');
    expect(await store.held(CHAT, 'k1', 2)).toEqual({ title: 'T' });
    expect(await store.copyPath(CHAT, 'k1', 2)).toBe(copyFile(CHAT, 'k1', 2));
    expect(await store.read(CHAT, 'k1', 1)).toBeNull();
    expect(await store.held(CHAT, 'k1', 1)).toBeNull();
    expect(await store.copyPath(CHAT, 'k1', 1)).toBeNull();
    expect(await store.read(CHAT, '..', 2)).toBeNull();
  });

  it('says whether a source can still be read', async () => {
    const { store, tmpRoot, outside, page } = setup();
    const src = page(tmpRoot, 'a.html');
    expect(await store.sourceOk(src)).toBe(true);
    expect(await store.sourceOk(page(outside, 'b.html'))).toBe(false);
    rmSync(src);
    expect(await store.sourceOk(src)).toBe(false);
  });
});

describe('page copies: room per chat', () => {
  it('drops the oldest versions first, never a page’s newest', async () => {
    const { store, tmpRoot, page, copyFile } = setup({ chatMaxBytes: 250 });
    const body = 'x'.repeat(100);
    const old = Date.now() / 1000 - 100;
    await store.copy(CHAT, 'a', 1, page(tmpRoot, 'a1.html', body));
    utimesSync(copyFile(CHAT, 'a', 1), old, old);
    await store.copy(CHAT, 'b', 1, page(tmpRoot, 'b1.html', body));
    utimesSync(copyFile(CHAT, 'b', 1), old + 1, old + 1);
    // Three copies: 300 bytes, over 250. a/v1 is the oldest, but it is page a's newest: b/v1 isn't.
    const got = await store.copy(CHAT, 'b', 2, page(tmpRoot, 'b2.html', body));
    expect(got?.evicted).toEqual([{ key: 'b', n: 1 }]);
    expect(existsSync(copyFile(CHAT, 'a', 1))).toBe(true);
    expect(existsSync(copyFile(CHAT, 'b', 1))).toBe(false);
    expect(existsSync(copyFile(CHAT, 'b', 2))).toBe(true);
  });
});

describe('page copies: following the chat', () => {
  it('renames the folder when the chat gets a new id', async () => {
    const { store, tmpRoot, page, copyFile } = setup();
    await store.copy(CHAT, 'k1', 1, page(tmpRoot, 'a.html'));
    await store.rename(CHAT, OTHER);
    expect(existsSync(copyFile(CHAT, 'k1', 1))).toBe(false);
    expect(existsSync(copyFile(OTHER, 'k1', 1))).toBe(true);
    // Nothing there, or a bad id: nothing happens.
    await store.rename(CHAT, OTHER);
    await store.rename('..', OTHER);
    expect(existsSync(copyFile(OTHER, 'k1', 1))).toBe(true);
  });

  it('moves a chat’s pages to the Bin, never erasing them itself', async () => {
    const { store, tmpRoot, page, trashed, dataDir } = setup();
    await store.copy(CHAT, 'k1', 1, page(tmpRoot, 'a.html'));
    await store.trashChat(CHAT);
    expect(trashed).toEqual([join(dataDir, 'pages', CHAT)]);
    // Nothing to move, or a bad id: the Bin isn't asked.
    await store.trashChat(OTHER);
    await store.trashChat('../x');
    expect(trashed).toHaveLength(1);
  });

  it('at start-up, moves the folders of chats whose history is gone to the Bin', async () => {
    const now = Date.now();
    const { store, tmpRoot, page, trashed, dataDir } = setup({ now: () => now });
    await store.copy(CHAT, 'k1', 1, page(tmpRoot, 'a.html'));
    await store.copy(OTHER, 'k1', 1, page(tmpRoot, 'b.html'));
    const third = '33333333-2222-4333-8444-555555555555';
    await store.copy(third, 'k1', 1, page(tmpRoot, 'c.html'));
    const old = now / 1000 - 2 * 3600;
    for (const id of [CHAT, OTHER]) utimesSync(join(dataDir, 'pages', id), old, old);
    // `third` was written just now: a chat whose history may not be on disk yet is left alone.
    mkdirSync(join(dataDir, 'pages', 'not-a-chat'));
    // An empty list (history unreadable) sweeps nothing.
    expect(await store.sweep(new Set())).toBe(0);
    expect(trashed).toEqual([]);
    expect(await store.sweep(new Set([CHAT]))).toBe(1);
    expect(trashed).toEqual([join(dataDir, 'pages', OTHER)]);
  });
});
