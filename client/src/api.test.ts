import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, streamUrl } from './api.ts';

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

describe('api.engineChoices', () => {
  it('gets the model and effort choices', async () => {
    const body = { models: [], claudeCode: { model: null } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body)));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.engineChoices()).resolves.toEqual(body);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/engine/choices');
  });
});

describe('streamUrl', () => {
  it('opens the stream with files and levels', () => {
    expect(streamUrl('s1', 4)).toBe('/api/stream?session=s1&after=4&files=1&levels=1');
  });
});

describe('levels routes', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('posts a skill level, a clear and a chat level', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ levels: {}, canSet: true, writable: true })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api.setSkillLevel({ skill: 'a', tier: 'deep' });
    await api.setSkillLevel({ skill: 'a', tier: null });
    await api.setChatLevel('s 1', 'quick');
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[0]).toBe('/api/skill-levels');
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({ skill: 'a', tier: 'deep' });
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({ skill: 'a', tier: null });
    expect(calls[2]?.[0]).toBe('/api/sessions/s%201/level');
    expect(JSON.parse(String(calls[2]?.[1].body))).toEqual({ tier: 'quick' });
  });
});
