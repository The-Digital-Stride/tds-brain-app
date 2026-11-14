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

describe('api.deletePastChat', () => {
  it('sends a DELETE that passes the server request check (JSON, like every changing request)', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const id = '6127dcf1-a50e-43e0-bc6d-f370942a7e48';
    await api.deletePastChat(id);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/sessions/past/${id}`);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBe('{}');
    // The browser adds Host, Origin, Sec-Fetch-Site and the cookie; the app adds the rest.
    const { checkRequest, cookieValueFor } = await import('../../server/http/security.ts');
    const { sessionCookieName } = await import('../../shared/contract.ts');
    const port = 3877;
    const token = 'launch-token';
    const sent = Object.fromEntries(
      Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const decision = checkRequest(
      {
        method: 'DELETE',
        path: url,
        headers: {
          host: `127.0.0.1:${port}`,
          origin: `http://127.0.0.1:${port}`,
          'sec-fetch-site': 'same-origin',
          cookie: `${sessionCookieName(port)}=${cookieValueFor(token)}`,
          ...sent,
        },
      },
      { port, launchToken: token },
    );
    expect(decision).toEqual({ action: 'allow' });
  });
});

describe('api.askPage', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('posts JSON that passes the real request check', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    await api.askPage('s 1', 'k/1', { kind: 'change', note: 'Make it blue' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/sessions/s%201/pages/k%2F1/ask');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'change', note: 'Make it blue' });
    const { checkRequest, cookieValueFor } = await import('../../server/http/security.ts');
    const { sessionCookieName } = await import('../../shared/contract.ts');
    const port = 3877;
    const token = 'launch-token';
    const sent = Object.fromEntries(
      Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    expect(sent['content-type']).toBe('application/json');
    const decision = checkRequest(
      {
        method: 'POST',
        path: url,
        headers: {
          host: `127.0.0.1:${port}`,
          origin: `http://127.0.0.1:${port}`,
          'sec-fetch-site': 'same-origin',
          cookie: `${sessionCookieName(port)}=${cookieValueFor(token)}`,
          ...sent,
        },
      },
      { port, launchToken: token },
    );
    expect(decision).toEqual({ action: 'allow' });
  });
});

describe('downloadBranded', () => {
  it('fetches the branded copy with a GET that passes the real request check', async () => {
    const fetchMock = vi.fn(async () => new Response('<html></html>'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
    const a = { click: vi.fn(), remove: vi.fn(), href: '', download: '', rel: '' };
    vi.stubGlobal('document', { createElement: () => a, body: { appendChild: vi.fn() } });
    const { downloadBranded } = await import('./api.ts');
    const path = '/api/sessions/s1/pages/pg1/1/branded';
    await downloadBranded(path, 'My page');
    expect(a.download).toBe('My page-tds.html');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(path);
    const { checkRequest, cookieValueFor } = await import('../../server/http/security.ts');
    const { sessionCookieName } = await import('../../shared/contract.ts');
    const port = 3877;
    const token = 'launch-token';
    const sent = Object.fromEntries(
      Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const decision = checkRequest(
      {
        method: 'GET',
        path: url,
        headers: {
          host: `127.0.0.1:${port}`,
          origin: `http://127.0.0.1:${port}`,
          'sec-fetch-site': 'same-origin',
          cookie: `${sessionCookieName(port)}=${cookieValueFor(token)}`,
          ...sent,
        },
      },
      { port, launchToken: token },
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('reads the file name from Content-Disposition, plain or encoded', async () => {
    const { dispositionName } = await import('./api.ts');
    expect(dispositionName('attachment; filename="a b-tds.html"')).toBe('a b-tds.html');
    expect(dispositionName("attachment; filename*=UTF-8''caf%C3%A9-tds.html")).toBe('café-tds.html');
    expect(dispositionName(null)).toBeNull();
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
