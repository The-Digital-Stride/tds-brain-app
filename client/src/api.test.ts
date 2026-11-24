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
    // Held for its Undo time first, then sent; closing the page must not cut it off.
    expect(init.keepalive).toBe(true);
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

describe('api.deleteLibraryFile', () => {
  afterEach(() => vi.unstubAllGlobals());
  async function allowed(url: string, init: RequestInit) {
    const { checkRequest, cookieValueFor } = await import('../../server/http/security.ts');
    const { sessionCookieName } = await import('../../shared/contract.ts');
    const port = 3877;
    const token = 'launch-token';
    const sent = Object.fromEntries(
      Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return checkRequest(
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
  }

  it('sends a JSON DELETE with { expect } that passes the real request check, and reads a 204', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.deleteLibraryFile('client:acme/logo 1.png', 'v1')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/library/items/client%3Aacme%2Flogo%201.png');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(String(init.body))).toEqual({ expect: 'v1' });
    expect(await allowed(url, init)).toEqual({ action: 'allow' });
  });

  it('sends {} when there is no version, and passes the request check when the page is closing (keepalive)', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.deleteLibraryFile('a', undefined, { keepalive: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('{}');
    expect(init.keepalive).toBe(true);
    expect(await allowed(url, init)).toEqual({ action: 'allow' });
  });

  it('reads a refusal into an ApiFailure with its code and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'changed', message: 'Changed.' } }), { status: 409 }),
      ),
    );
    await expect(api.deleteLibraryFile('a', 'v1')).rejects.toMatchObject({ code: 'changed', status: 409 });
  });

  it('also reads a flat { error, code } refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'No.', code: 'not-allowed' }), { status: 403 })),
    );
    await expect(api.deleteLibraryFile('a')).rejects.toMatchObject({
      code: 'not-allowed',
      message: 'No.',
      status: 403,
    });
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
  it('opens the stream with files, levels and context', () => {
    expect(streamUrl('s1', 4)).toBe('/api/stream?session=s1&after=4&files=1&levels=1&context=1');
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

describe('api.chatContext', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('gets the detail through the shared request helper', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ reading: null, items: [], lastCompaction: null, approximate: false })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api.chatContext('s 1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/sessions/s%201/context');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('same-origin');
  });
});

describe('api.resend', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends a POST that passes the server request check and reaches the resend route', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    await api.resend('s 1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/sessions/s%201/resend');
    expect(init.method).toBe('POST');
    const { checkRequest, cookieValueFor } = await import('../../server/http/security.ts');
    const { sessionCookieName } = await import('../../shared/contract.ts');
    const port = 3877;
    const token = 'launch-token';
    const sent = Object.fromEntries(
      Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
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

describe('api.chatSummaryDraft', () => {
  it('posts the chat and project with headers that pass the real request check', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await api.chatSummaryDraft({ chat: '6127dcf1-a50e-43e0-bc6d-f370942a7e48', project: 'acme/site' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/chat-summary/draft');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      chat: '6127dcf1-a50e-43e0-bc6d-f370942a7e48',
      project: 'acme/site',
    });
    const { checkRequest, cookieValueFor } = await import('../../server/http/security.ts');
    const { sessionCookieName } = await import('../../shared/contract.ts');
    const port = 3877;
    const token = 'launch-token';
    const sent = Object.fromEntries(
      Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
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

describe('api.projectUnsavedChats', () => {
  it('gets the project key, encoded', async () => {
    const body = { chats: [], canSave: true };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body)));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.projectUnsavedChats('acme/site')).resolves.toEqual(body);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      '/api/projects/unsaved-chats?key=acme%2Fsite',
    );
  });
});
