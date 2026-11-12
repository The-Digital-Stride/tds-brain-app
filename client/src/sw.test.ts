import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'http://localhost:3877';

type Handler = (event: unknown) => void;

function setup(fetchImpl: (req: unknown) => Promise<unknown>, existing: string[] = []) {
  const handlers = {} as Record<'install' | 'activate' | 'fetch', Handler>;
  const stores = new Map<string, Map<string, unknown>>(existing.map((n) => [n, new Map()]));
  const added: string[][] = [];
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      return {
        addAll: async (urls: string[]) => {
          added.push(urls);
          for (const u of urls) stores.get(name)?.set(u, `cached:${u}`);
        },
        put: async () => {
          throw new Error('nothing else may be cached');
        },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (url: string) => {
      for (const s of stores.values()) if (s.has(url)) return s.get(url);
      return undefined;
    },
  };
  const state = { skipped: false, claimed: false };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, h: Handler) => {
      (handlers as Record<string, Handler>)[type] = h;
    },
    skipWaiting: () => {
      state.skipped = true;
      return Promise.resolve();
    },
    clients: {
      claim: () => {
        state.claimed = true;
        return Promise.resolve();
      },
    },
  };
  vm.runInNewContext(SOURCE, {
    self,
    caches,
    fetch: fetchImpl,
    URL,
    Response: { error: () => 'error-response' },
  });
  return { handlers, stores, added, state };
}

function dispatch(handler: Handler, extra: Record<string, unknown> = {}) {
  let waited: Promise<unknown> | undefined;
  let responded: Promise<unknown> | undefined;
  const event = {
    ...extra,
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
    respondWith: (p: Promise<unknown>) => {
      responded = p;
    },
  };
  handler(event);
  return { waited, responded };
}

const nav = (path: string, mode = 'navigate') => ({ request: { url: ORIGIN + path, mode, method: 'GET' } });
const down = () => Promise.reject(new TypeError('Failed to fetch'));

describe('service worker', () => {
  it('gives offline.html when a page load cannot reach the server', async () => {
    const { handlers } = setup(down, []);
    await dispatch(handlers.install).waited;
    const { responded } = dispatch(handlers.fetch, nav('/'));
    expect(await responded).toBe('cached:/offline.html');
  });

  it.each([401, 500])('passes an HTTP %i through untouched', async (status) => {
    const answer = { status };
    const { handlers } = setup(() => Promise.resolve(answer));
    const { responded } = dispatch(handlers.fetch, nav('/'));
    expect(await responded).toBe(answer);
  });

  it.each([
    ['/api/x', 'navigate'],
    ['/auth?code=abc', 'navigate'],
    ['/manifest.webmanifest', 'navigate'],
    ['/sw.js', 'navigate'],
    ['/', 'cors'],
    ['/icons/other.svg', 'no-cors'],
  ])('never answers %s (%s)', (path, mode) => {
    const { handlers, stores } = setup(down);
    const { responded } = dispatch(handlers.fetch, nav(path, mode));
    expect(responded).toBeUndefined();
    expect(stores.size).toBe(0);
  });

  it.each(['/offline.css', '/icons/brain.svg'])(
    'serves the cached %s when the server is down',
    async (path) => {
      const { handlers } = setup(down);
      await dispatch(handlers.install).waited;
      const { responded } = dispatch(handlers.fetch, {
        request: { url: ORIGIN + path, mode: 'no-cors', method: 'GET' },
      });
      expect(await responded).toBe(`cached:${path}`);
    },
  );

  it('prefers the network for the offline assets when it answers', async () => {
    const answer = { status: 200 };
    const { handlers } = setup(() => Promise.resolve(answer));
    const { responded } = dispatch(handlers.fetch, {
      request: { url: `${ORIGIN}/offline.css`, mode: 'no-cors', method: 'GET' },
    });
    expect(await responded).toBe(answer);
  });

  it('does not answer a POST to the offline assets', () => {
    const { handlers } = setup(down);
    const { responded } = dispatch(handlers.fetch, {
      request: { url: `${ORIGIN}/offline.css`, mode: 'no-cors', method: 'POST' },
    });
    expect(responded).toBeUndefined();
  });

  it('sw-off.js unregisters itself and clears every cache, standalone', async () => {
    const handlers: Record<string, Handler> = {};
    const deleted: string[] = [];
    let unregistered = false;
    const self = {
      addEventListener: (t: string, h: Handler) => {
        handlers[t] = h;
      },
      skipWaiting: () => Promise.resolve(),
      registration: {
        unregister: async () => {
          unregistered = true;
          return true;
        },
      },
    };
    const caches = {
      keys: async () => ['a', 'b'],
      delete: async (k: string) => {
        deleted.push(k);
        return true;
      },
    };
    vm.runInNewContext(readFileSync(new URL('../public/sw-off.js', import.meta.url), 'utf8'), {
      self,
      caches,
    });
    await dispatch(handlers.activate as Handler).waited;
    expect(unregistered).toBe(true);
    expect(deleted).toEqual(['a', 'b']);
  });

  it('ignores navigations to another origin', () => {
    const { handlers } = setup(down);
    const { responded } = dispatch(handlers.fetch, {
      request: { url: 'https://example.com/', mode: 'navigate' },
    });
    expect(responded).toBeUndefined();
  });

  it('caches exactly the three offline files on install, then skips waiting', async () => {
    const { handlers, added, stores, state } = setup(down);
    await dispatch(handlers.install).waited;
    expect(added).toEqual([['/offline.html', '/offline.css', '/icons/brain.svg']]);
    expect(stores.size).toBe(1);
    expect(state.skipped).toBe(true);
  });

  it('deletes old caches on activate, then claims clients', async () => {
    const { handlers, stores, state } = setup(down, ['tds-brain-offline-v0', 'something-else']);
    await dispatch(handlers.install).waited;
    await dispatch(handlers.activate).waited;
    expect([...stores.keys()]).toEqual(['tds-brain-offline-v3']);
    expect(state.claimed).toBe(true);
  });
});
