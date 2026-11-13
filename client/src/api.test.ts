import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.ts';

afterEach(() => vi.unstubAllGlobals());

describe('api.librarySearch', () => {
  it('sends the query and kind (documents as "doc") and the abort signal', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ hits: [], total: 0, partial: false })));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    await api.librarySearch('board report', 'document', { signal });
    await api.librarySearch('logo', 'image');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/library/search?q=board%20report&kind=doc');
    expect(init.signal).toBe(signal);
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe('/api/library/search?q=logo&kind=image');
  });

  it('lets an abort through as it is, not as a network failure', async () => {
    const controller = new AbortController();
    const abort = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort();
        throw abort;
      }),
    );
    await expect(api.librarySearch('ab', 'image', { signal: controller.signal })).rejects.toBe(abort);
  });
});
