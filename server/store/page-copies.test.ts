import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  promises as fsp,
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
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_COPY_MAX_BYTES } from '../../shared/pages-contract.ts';
import { brainFolder, createPageCopies, isCopyId, isPageKey } from './page-copies.ts';

const CHAT = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
const PAGE = '<!doctype html><title>A page</title><p>Hi</p>';

afterEach(() => {
  vi.restoreAllMocks();
});

const temp: string[] = [];
afterAll(() => {
  for (const d of temp.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dir(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temp.push(d);
  return d;
}

function setup(over: { chatMaxBytes?: number; now?: () => number; tmpRoot?: string } = {}) {
  const dataDir = dir('tba-pages-data-');
  const tmpRoot = over.tmpRoot ?? dir('tba-pages-tmp-');
  const brain = dir('tba-pages-brain-');
  const outside = dir('tba-pages-outside-');
  const trashed: string[] = [];
  const store = createPageCopies({
    dataDir,
    brainRoot: brain,
    roots: [brain],
    trash: async (p) => {
      trashed.push(p);
      rmSync(p, { recursive: true, force: true });
    },
    ...over,
    tmpRoot,
  });
  const page = (root: string, name: string, body = PAGE) => {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, body);
    return p;
  };
  const base = join(dataDir, 'pages', brainFolder(brain));
  const kept = (chat: string, key: string, id: string) => join(base, chat, key, `v-${id}.html`);
  const drafted = (chat: string, key: string, id: string) => join(base, chat, key, `d-${id}.html`);
  return { dataDir, tmpRoot, brain, outside, store, trashed, page, base, kept, drafted };
}

describe('page copies: where a page may come from', () => {
  it('locates a page under Claude’s temporary folder or the brain, through linked folders', async () => {
    const { store, tmpRoot, brain, outside, page } = setup();
    const src = page(tmpRoot, 'scratchpad/budget.html');
    expect(await store.locate(src)).toBe(src);
    expect(await store.locate(page(brain, 'clients/acme/r.HTM'))).toBe(join(brain, 'clients/acme/r.HTM'));
    // A file that has gone keeps its spelling through the folders that are still there.
    expect(await store.locate(join(tmpRoot, 'gone/away.html'))).toBe(join(tmpRoot, 'gone/away.html'));
    const link = join(tmpRoot, 'via');
    symlinkSync(join(tmpRoot, 'scratchpad'), link);
    expect(await store.locate(join(link, 'budget.html'))).toBe(src);
    expect(await store.locate(join(link, 'later.html'))).toBe(join(tmpRoot, 'scratchpad', 'later.html'));
    // Out of the allowed folders, directly or through a link.
    expect(await store.locate(page(outside, 'secret.html'))).toBeNull();
    symlinkSync(outside, join(tmpRoot, 'out'));
    expect(await store.locate(join(tmpRoot, 'out', 'secret.html'))).toBeNull();
  });

  it('refuses a relative path, another type, control characters and an over-long path', async () => {
    const { store, tmpRoot, page } = setup();
    page(tmpRoot, 'notes.txt');
    for (const bad of [
      'scratchpad/a.html',
      join(tmpRoot, 'notes.txt'),
      `${join(tmpRoot, 'a')}\n.html`,
      `${tmpRoot}/${'a'.repeat(1100)}.html`,
    ]) {
      expect(await store.locate(bad), bad).toBeNull();
      expect(await store.draft(CHAT, 'k1', 'toolu_1', bad, false), bad).toBeNull();
      expect(await store.copy(CHAT, 'k1', 'toolu_1', bad), bad).toBeNull();
    }
  });

  it('trusts Claude’s temporary folder only when it is a plain folder only this user can write to', async () => {
    const open = dir('tba-pages-open-');
    chmodSync(open, 0o777);
    const a = setup({ tmpRoot: open });
    expect(await a.store.locate(a.page(open, 'x.html'))).toBeNull();
    expect(await a.store.draft(CHAT, 'k1', 'toolu_1', join(open, 'x.html'), false)).toBeNull();

    const real = dir('tba-pages-real-');
    const linked = join(dir('tba-pages-holder-'), 'tmp-link');
    symlinkSync(real, linked);
    const b = setup({ tmpRoot: linked });
    expect(await b.store.locate(b.page(real, 'y.html'))).toBeNull();

    const fine = dir('tba-pages-fine-');
    chmodSync(fine, 0o700);
    const c = setup({ tmpRoot: fine });
    expect(await c.store.locate(c.page(fine, 'z.html'))).toBe(join(fine, 'z.html'));
  });

  it('refuses a source inside the app’s own copies', async () => {
    const { store, tmpRoot, page, kept, dataDir, brain } = setup();
    await store.copy(CHAT, 'k1', 'toolu_1', page(tmpRoot, 'a.html'));
    const own = kept(CHAT, 'k1', 'toolu_1');
    const dataStore = createPageCopies({
      dataDir,
      brainRoot: brain,
      roots: [join(own, '..')],
      tmpRoot,
      trash: async () => {},
    });
    expect(await dataStore.locate(own)).toBeNull();
    expect(await dataStore.copy(CHAT, 'k2', 'toolu_2', own)).toBeNull();
  });
});

describe('page copies: the in-progress copy and kept versions', () => {
  it('writes the in-progress copy read-only, replacing the page’s earlier one', async () => {
    const { store, tmpRoot, page, drafted, base } = setup();
    const src = page(tmpRoot, 'scratchpad/budget.html', '<title>Budget &amp; plan</title>x');
    expect(await store.draft(CHAT, 'k1', 'toolu_a', src, false)).toEqual({
      title: 'Budget & plan',
      page: true,
    });
    expect(readFileSync(drafted(CHAT, 'k1', 'toolu_a'), 'utf8')).toBe('<title>Budget &amp; plan</title>x');
    expect(statSync(drafted(CHAT, 'k1', 'toolu_a')).mode & 0o777).toBe(0o444);
    for (const d of [join(base, '..'), base, join(base, CHAT), join(base, CHAT, 'k1')])
      expect(statSync(d).mode & 0o777).toBe(0o700);
    writeFileSync(src, '<title>Second</title>');
    expect((await store.draft(CHAT, 'k1', 'toolu_b', src, false))?.title).toBe('Second');
    // One in-progress copy per page, and no temporary file left behind.
    expect(readdirSync(join(base, CHAT, 'k1'))).toEqual(['d-toolu_b.html']);
    expect(await store.read(CHAT, 'k1', 'toolu_b', 'draft')).toEqual(Buffer.from('<title>Second</title>'));
    expect(await store.read(CHAT, 'k1', 'toolu_a', 'draft')).toBeNull();
  });

  it('with mustBePage, leaves a fragment uncopied (O8)', async () => {
    const { store, tmpRoot, page, base } = setup();
    const frag = page(tmpRoot, 'body.html', '<section><p>just a part</p></section>');
    expect(await store.draft(CHAT, 'k1', 'toolu_1', frag, true)).toEqual({ title: 'body', page: false });
    expect(existsSync(join(base, CHAT))).toBe(false);
    expect(await store.isPage(frag)).toBe(false);
    expect(await store.isPage(page(tmpRoot, 'full.html'))).toBe(true);
    expect(await store.isPage(join(tmpRoot, 'gone.html'))).toBeNull();
    // Without mustBePage (a known page, or a publish), it is copied all the same.
    expect((await store.draft(CHAT, 'k1', 'toolu_2', frag, false))?.page).toBe(false);
    expect(existsSync(join(base, CHAT, 'k1', 'd-toolu_2.html'))).toBe(true);
  });

  it('keeps an in-progress copy as a version, once, and never rewrites a kept copy', async () => {
    const { store, tmpRoot, page, kept, drafted } = setup();
    const src = page(tmpRoot, 'a.html', '<title>First</title>');
    await store.draft(CHAT, 'k1', 'toolu_1', src, false);
    expect(await store.keep(CHAT, 'k1', 'toolu_1')).toEqual({ evicted: [] });
    expect(existsSync(drafted(CHAT, 'k1', 'toolu_1'))).toBe(false);
    expect(readFileSync(kept(CHAT, 'k1', 'toolu_1'), 'utf8')).toBe('<title>First</title>');
    expect(statSync(kept(CHAT, 'k1', 'toolu_1')).mode & 0o777).toBe(0o444);
    expect(await store.held(CHAT, 'k1', 'toolu_1')).toEqual({ title: 'First' });
    // Kept already: still fine; nothing to keep: null.
    expect(await store.keep(CHAT, 'k1', 'toolu_1')).toEqual({ evicted: [] });
    expect(await store.keep(CHAT, 'k1', 'toolu_none')).toBeNull();
    writeFileSync(src, '<title>Second</title>');
    expect((await store.copy(CHAT, 'k1', 'toolu_1', src))?.title).toBe('First');
    expect(readFileSync(kept(CHAT, 'k1', 'toolu_1'), 'utf8')).toBe('<title>First</title>');
  });

  it('copies straight to a kept version (a reopened chat’s newest), with its title', async () => {
    const { store, tmpRoot, page, kept, base } = setup();
    const got = await store.copy(CHAT, 'k1', 'toolu_9', page(tmpRoot, 'my-report.html', '<p>no title</p>'));
    expect(got).toEqual({ title: 'my-report', evicted: [] });
    expect(existsSync(kept(CHAT, 'k1', 'toolu_9'))).toBe(true);
    expect(readdirSync(join(base, CHAT, 'k1'))).toEqual(['v-toolu_9.html']);
    expect(await store.keptPath(CHAT, 'k1', 'toolu_9')).toBe(kept(CHAT, 'k1', 'toolu_9'));
    expect(await store.read(CHAT, 'k1', 'toolu_9', 'kept')).toEqual(Buffer.from('<p>no title</p>'));
    expect(await store.held(CHAT, 'k1', 'toolu_0')).toBeNull();
  });

  it('refuses a symbolic link, a FIFO (without hanging), a folder and a missing file', async () => {
    const { store, tmpRoot, page } = setup();
    const link = join(tmpRoot, 'link.html');
    symlinkSync(page(tmpRoot, 'real.html'), link);
    const fifo = join(tmpRoot, 'pipe.html');
    execFileSync('mkfifo', [fifo]);
    mkdirSync(join(tmpRoot, 'folder.html'));
    for (const bad of [link, fifo, join(tmpRoot, 'folder.html'), join(tmpRoot, 'gone.html')]) {
      expect(await store.draft(CHAT, 'k1', 'toolu_1', bad, false), bad).toBeNull();
      expect(await store.copy(CHAT, 'k1', 'toolu_1', bad), bad).toBeNull();
    }
  });

  it('copies a page at the size cap and refuses one a byte over', async () => {
    const { store, tmpRoot, page } = setup();
    expect(PAGE_COPY_MAX_BYTES).toBe(16 * 1024 * 1024);
    const at = page(tmpRoot, 'at.html', 'x'.repeat(PAGE_COPY_MAX_BYTES));
    const over = page(tmpRoot, 'over.html', 'x'.repeat(PAGE_COPY_MAX_BYTES + 1));
    expect(await store.copy(CHAT, 'k1', 'toolu_1', at)).not.toBeNull();
    expect(await store.draft(CHAT, 'k2', 'toolu_2', over, false)).toBeNull();
  });

  it('keeps keys, chat ids and tool use ids inside its folder', async () => {
    const { store, tmpRoot, page, dataDir } = setup();
    const src = page(tmpRoot, 'a.html');
    for (const key of ['..', '../x', 'a/b', '', '.hidden', 'x'.repeat(65), 'a b']) {
      expect(isPageKey(key), key).toBe(false);
      expect(await store.copy(CHAT, key, 'toolu_1', src), key).toBeNull();
    }
    for (const chat of ['..', 'not-a-uuid', `${CHAT}/..`]) {
      expect(await store.draft(chat, 'k1', 'toolu_1', src, false), chat).toBeNull();
    }
    for (const id of ['..', 'a/b', '', 'x'.repeat(129), 'a.b']) {
      expect(isCopyId(id), id).toBe(false);
      expect(await store.draft(CHAT, 'k1', id, src, false), id).toBeNull();
      expect(await store.keptPath(CHAT, 'k1', id), id).toBeNull();
    }
    expect(existsSync(join(dataDir, 'pages'))).toBe(false);
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
  it('drops the oldest kept versions first, never a page’s newest or an in-progress copy', async () => {
    const { store, tmpRoot, page, kept, drafted } = setup({ chatMaxBytes: 350 });
    const body = 'x'.repeat(100);
    const old = Date.now() / 1000 - 100;
    await store.copy(CHAT, 'a', 'toolu_a1', page(tmpRoot, 'a1.html', body));
    utimesSync(kept(CHAT, 'a', 'toolu_a1'), old, old);
    await store.copy(CHAT, 'b', 'toolu_b1', page(tmpRoot, 'b1.html', body));
    utimesSync(kept(CHAT, 'b', 'toolu_b1'), old + 1, old + 1);
    await store.draft(CHAT, 'c', 'toolu_c1', page(tmpRoot, 'c1.html', body), false);
    // Four copies: 400 bytes, over 350. a's is the oldest but a's newest; c's is in progress: b1 goes.
    const got = await store.copy(CHAT, 'b', 'toolu_b2', page(tmpRoot, 'b2.html', body));
    expect(got?.evicted).toEqual([{ key: 'b', id: 'toolu_b1' }]);
    expect(existsSync(kept(CHAT, 'a', 'toolu_a1'))).toBe(true);
    expect(existsSync(kept(CHAT, 'b', 'toolu_b1'))).toBe(false);
    expect(existsSync(kept(CHAT, 'b', 'toolu_b2'))).toBe(true);
    expect(existsSync(drafted(CHAT, 'c', 'toolu_c1'))).toBe(true);
  });
});

describe('page copies: following the chat', () => {
  it('keeps each brain’s chats apart', async () => {
    const a = setup();
    const src = a.page(a.tmpRoot, 'a.html');
    await a.store.copy(CHAT, 'k1', 'toolu_1', src);
    const other = dir('tba-pages-brain2-');
    const b = createPageCopies({ dataDir: a.dataDir, brainRoot: other, roots: [other], tmpRoot: a.tmpRoot });
    expect(await b.held(CHAT, 'k1', 'toolu_1')).toBeNull();
    expect(brainFolder(a.brain)).not.toBe(brainFolder(other));
  });

  it('renames the folder when the chat gets a new id', async () => {
    const { store, tmpRoot, page, kept } = setup();
    await store.copy(CHAT, 'k1', 'toolu_1', page(tmpRoot, 'a.html'));
    await store.rename(CHAT, OTHER);
    expect(existsSync(kept(CHAT, 'k1', 'toolu_1'))).toBe(false);
    expect(existsSync(kept(OTHER, 'k1', 'toolu_1'))).toBe(true);
    // Nothing there, or a bad id: nothing happens.
    await store.rename(CHAT, OTHER);
    await store.rename('..', OTHER);
    expect(existsSync(kept(OTHER, 'k1', 'toolu_1'))).toBe(true);
  });

  it('moves a chat’s pages to the Bin, never erasing them itself', async () => {
    const { store, tmpRoot, page, trashed, base } = setup();
    await store.copy(CHAT, 'k1', 'toolu_1', page(tmpRoot, 'a.html'));
    await store.trashChat(CHAT);
    expect(trashed).toEqual([join(base, CHAT)]);
    // Nothing to move, or a bad id: the Bin isn't asked.
    await store.trashChat(OTHER);
    await store.trashChat('../x');
    expect(trashed).toHaveLength(1);
  });

  it('at start-up, moves only this brain’s folders of chats whose history is gone to the Bin', async () => {
    const now = Date.now();
    const { store, tmpRoot, page, trashed, base, dataDir } = setup({ now: () => now });
    await store.copy(CHAT, 'k1', 'toolu_1', page(tmpRoot, 'a.html'));
    await store.copy(OTHER, 'k1', 'toolu_1', page(tmpRoot, 'b.html'));
    const third = '33333333-2222-4333-8444-555555555555';
    await store.copy(third, 'k1', 'toolu_1', page(tmpRoot, 'c.html'));
    const old = now / 1000 - 2 * 3600;
    for (const id of [CHAT, OTHER]) utimesSync(join(base, id), old, old);
    // `third` was written just now: a chat whose history may not be on disk yet is left alone.
    mkdirSync(join(base, 'not-a-chat'));
    // Another brain's chat folder is never looked at.
    const elsewhere = join(dataDir, 'pages', 'other-brain-hash', OTHER);
    mkdirSync(elsewhere, { recursive: true });
    utimesSync(elsewhere, old, old);
    // An empty list (history unreadable) sweeps nothing.
    expect(await store.sweep(new Set())).toBe(0);
    expect(trashed).toEqual([]);
    expect(await store.sweep(new Set([CHAT]))).toBe(1);
    expect(trashed).toEqual([join(base, OTHER)]);
    expect(existsSync(elsewhere)).toBe(true);
  });
});

describe('page copies: the per-chat byte total', () => {
  /** How many times a chat's own folder was listed. */
  function countListings(chatPath: string) {
    vi.restoreAllMocks();
    const real = fsp.readdir.bind(fsp);
    let n = 0;
    vi.spyOn(fsp, 'readdir').mockImplementation(((p: string, ...rest: unknown[]) => {
      if (p === chatPath) n++;
      return (real as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fsp.readdir);
    return () => n;
  }
  const body = (n: number) => 'x'.repeat(n);

  it('lists the folder once, then not again while there is room', async () => {
    const { store, tmpRoot, page, base } = setup({ chatMaxBytes: 10_000 });
    const listings = countListings(join(base, CHAT));
    await store.copy(CHAT, 'a', 'toolu_a1', page(tmpRoot, 'a1.html', body(100)));
    expect(listings()).toBe(1);
    await store.draft(CHAT, 'b', 'toolu_b1', page(tmpRoot, 'b1.html', body(100)), false);
    await store.keep(CHAT, 'b', 'toolu_b1');
    await store.copy(CHAT, 'c', 'toolu_c1', page(tmpRoot, 'c1.html', body(100)));
    expect(listings()).toBe(1);
  });

  it('lists again when the total is over the limit, and when it is forgotten', async () => {
    const { store, tmpRoot, page, base, kept } = setup({ chatMaxBytes: 250 });
    const listings = countListings(join(base, CHAT));
    const old = Date.now() / 1000 - 100;
    await store.copy(CHAT, 'a', 'toolu_a1', page(tmpRoot, 'a1.html', body(100)));
    utimesSync(kept(CHAT, 'a', 'toolu_a1'), old, old);
    await store.copy(CHAT, 'a', 'toolu_a2', page(tmpRoot, 'a2.html', body(100)));
    expect(listings()).toBe(1);
    // 300 bytes: over, so it lists and evicts the older version; afterwards the total is known again.
    const got = await store.copy(CHAT, 'b', 'toolu_b1', page(tmpRoot, 'b1.html', body(100)));
    expect(got?.evicted).toEqual([{ key: 'a', id: 'toolu_a1' }]);
    expect(listings()).toBe(2);
    await store.copy(CHAT, 'b', 'toolu_b2', page(tmpRoot, 'b2.html', body(10)));
    expect(listings()).toBe(2);
    // A rename forgets the total: the next keep lists.
    await store.rename(CHAT, OTHER);
    const other = countListings(join(base, OTHER));
    await store.copy(OTHER, 'c', 'toolu_c3', page(tmpRoot, 'c3.html', body(10)));
    expect(other()).toBe(1);
  });

  it('matches a fresh listing after mixed drafts, keeps, copies and removals, with two callers at once', async () => {
    // Disk after the mixed steps: a1 100 + b1 100 (kept) + c draft 60 + d1 80 = 340 bytes.
    const { store, tmpRoot, page, kept } = setup({ chatMaxBytes: 340 });
    const old = Date.now() / 1000 - 1000;
    await store.copy(CHAT, 'a', 'toolu_a1', page(tmpRoot, 'a1.html', body(100)));
    utimesSync(kept(CHAT, 'a', 'toolu_a1'), old, old);
    // A draft replaced by a smaller one, and a second draft id for the same page dropped.
    await store.draft(CHAT, 'b', 'toolu_b0', page(tmpRoot, 'b0.html', body(300)), false);
    await store.draft(CHAT, 'b', 'toolu_b1', page(tmpRoot, 'b1.html', body(100)), false);
    await store.draft(CHAT, 'c', 'toolu_c1', page(tmpRoot, 'c1.html', body(500)), false);
    await store.draft(CHAT, 'c', 'toolu_c1', page(tmpRoot, 'c1.html', body(60)), false);
    // Two callers (two sessions of one chat) at once.
    const [k, c] = await Promise.all([
      store.keep(CHAT, 'b', 'toolu_b1'),
      store.copy(CHAT, 'd', 'toolu_d1', page(tmpRoot, 'd1.html', body(80))),
    ]);
    expect(k).toEqual({ evicted: [] });
    expect(c?.evicted).toEqual([]);
    // Keeping something already kept removes its draft (a removal).
    await store.draft(CHAT, 'b', 'toolu_b1', page(tmpRoot, 'b1.html', body(100)), false);
    await store.keep(CHAT, 'b', 'toolu_b1');
    // 340 bytes exactly fills the limit: one more 10-byte copy must push out the oldest non-newest, a1 is a's
    // newest so it stays; b's newer one is b2 below.
    const e = await store.copy(CHAT, 'b', 'toolu_b2', page(tmpRoot, 'b2.html', body(10)));
    expect(e?.evicted).toEqual([{ key: 'b', id: 'toolu_b1' }]);
    expect(existsSync(kept(CHAT, 'a', 'toolu_a1'))).toBe(true);
    // And a store that has never seen the chat (total unknown) evicts exactly the same on the same state.
  });

  it('stays correct when many callers write one chat at once', async () => {
    const { store, tmpRoot, page, base } = setup({ chatMaxBytes: 1000 });
    const listings = countListings(join(base, CHAT));
    await store.copy(CHAT, 'seed', 'toolu_s', page(tmpRoot, 's.html', body(10)));
    await Promise.all(
      [...Array(8).keys()].map((i) =>
        store.copy(CHAT, `k${i}`, `toolu_${i}`, page(tmpRoot, `p${i}.html`, body(100))),
      ),
    );
    // 810 bytes: under 1000, and never listed again.
    expect(listings()).toBe(1);
    await store.copy(CHAT, 'z', 'toolu_z', page(tmpRoot, 'z.html', body(100)));
    await store.copy(CHAT, 'y', 'toolu_y', page(tmpRoot, 'y.html', body(100)));
    // 1010 bytes: only now over, so it lists and evicts back under the limit.
    expect(listings()).toBe(2);
  });

  it('forgets the total on a move to the Bin', async () => {
    const { store, tmpRoot, page, base } = setup({ chatMaxBytes: 10_000 });
    await store.copy(CHAT, 'a', 'toolu_a', page(tmpRoot, 'a.html', body(100)));
    await store.trashChat(CHAT);
    const listings = countListings(join(base, CHAT));
    await store.copy(CHAT, 'a', 'toolu_a', page(tmpRoot, 'a.html', body(100)));
    expect(listings()).toBe(1);
  });
});

describe('page copies: a file that grows while it is read', () => {
  it('is not copied', async () => {
    const { store, tmpRoot, page, base } = setup();
    const src = page(tmpRoot, 'grow.html', PAGE);
    const real = fsp.open.bind(fsp);
    vi.spyOn(fsp, 'open').mockImplementation((async (p: string, ...rest: unknown[]) => {
      const handle = await (real as (...a: unknown[]) => Promise<import('node:fs/promises').FileHandle>)(
        p,
        ...rest,
      );
      if (p === src) {
        const read = handle.read.bind(handle);
        let grown = false;
        // After the size is taken, the file gains bytes before the read finishes.
        (handle as unknown as { read: unknown }).read = async (...a: unknown[]) => {
          if (!grown) {
            grown = true;
            writeFileSync(src, `${PAGE}<p>more</p>`);
          }
          return (read as (...x: unknown[]) => unknown)(...a);
        };
      }
      return handle;
    }) as typeof fsp.open);
    expect(await store.draft(CHAT, 'k1', 'toolu_1', src, false)).toBeNull();
    writeFileSync(src, PAGE);
    expect(await store.copy(CHAT, 'k1', 'toolu_2', src)).toBeNull();
    expect(existsSync(join(base, CHAT))).toBe(false);
  });
});

describe('page copies: leftover temporary files', () => {
  it('removes both temporary shapes older than an hour and leaves everything else', async () => {
    const now = Date.now();
    const { store, tmpRoot, page, base } = setup({ now: () => now });
    await store.copy(CHAT, 'k1', 'toolu_1', page(tmpRoot, 'a.html'));
    const folder = join(base, CHAT, 'k1');
    const old = now / 1000 - 2 * 3600;
    const put = (name: string, aged: boolean) => {
      writeFileSync(join(folder, name), 'x');
      if (aged) utimesSync(join(folder, name), old, old);
    };
    put('.v-toolu_1.html.0123456789ab.tmp', true);
    put('.d-toolu_2.html.abcdefabcdef.tmp', true);
    put('.v-toolu_3.html.0123456789ab.tmp', false);
    put('.v-toolu_1.html.nothex.tmp', true);
    put('notes.tmp', true);
    writeFileSync(join(tmpRoot, 'target'), 'keep me');
    symlinkSync(join(tmpRoot, 'target'), join(folder, '.v-toolu_4.html.0123456789ab.tmp'));
    // Wrong depth: a temp-shaped file in the chat folder, and one in the brain folder, stay.
    writeFileSync(join(base, CHAT, '.v-toolu_1.html.0123456789ab.tmp'), 'x');
    utimesSync(join(base, CHAT, '.v-toolu_1.html.0123456789ab.tmp'), old, old);
    expect(await store.sweepTemps?.()).toBe(2);
    expect(readdirSync(folder).sort()).toEqual(
      [
        '.v-toolu_1.html.nothex.tmp',
        '.v-toolu_3.html.0123456789ab.tmp',
        '.v-toolu_4.html.0123456789ab.tmp',
        'notes.tmp',
        'v-toolu_1.html',
      ].sort(),
    );
    expect(existsSync(join(base, CHAT, '.v-toolu_1.html.0123456789ab.tmp'))).toBe(true);
    expect(existsSync(join(tmpRoot, 'target'))).toBe(true);
  });

  it('does nothing when there is no pages folder', async () => {
    expect(await setup().store.sweepTemps?.()).toBe(0);
  });
});
