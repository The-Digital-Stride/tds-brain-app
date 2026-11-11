import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { type LibraryListing, ROUTES } from '../../shared/contract.ts';
import { createBrainReaders } from '../brain/index.ts';
import { copyFixture } from '../brain/test-helpers.ts';
import { createThumbnailer } from '../brain/thumbs.ts';
import { HttpError, handleApi, parseStartRequest, type RouteContext } from './routes.ts';
import { PAGE_CSP, PDF_CSP, SECURITY_HEADERS } from './security.ts';

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('parseStartRequest', () => {
  it('passes prompt, client, resume and todoId through', () => {
    expect(
      parseStartRequest({ prompt: 'hi', client: 'acme', resume: null, todoId: '20261111-x.md' }),
    ).toEqual({
      prompt: 'hi',
      client: 'acme',
      resume: null,
      todoId: '20261111-x.md',
    });
    expect(parseStartRequest({ prompt: 'hi', todoId: null })).toEqual({ prompt: 'hi', todoId: null });
    expect(parseStartRequest({ prompt: 'hi' })).toEqual({ prompt: 'hi' });
  });

  it('refuses a todoId that is not text or null', () => {
    for (const todoId of [42, true, ['a'], { id: 'a' }]) {
      expect(() => parseStartRequest({ prompt: 'hi', todoId })).toThrow(HttpError);
    }
  });

  it('refuses other fields of the wrong type, and a body that is not an object', () => {
    expect(() => parseStartRequest({ prompt: 7 })).toThrow(HttpError);
    expect(() => parseStartRequest({ client: 7 })).toThrow(HttpError);
    expect(() => parseStartRequest({ resume: 7 })).toThrow(HttpError);
    expect(() => parseStartRequest([])).toThrow(HttpError);
  });
});

describe('POST /api/todos/complete', () => {
  const TODO = '20261105-send-report.md';

  async function tick(directWrites: boolean) {
    const root = copyFixture();
    const whoami = { name: 'Sam Example', slug: 'sam-example', role: 'scout', knownMember: true };
    const brain = createBrainReaders(root, {
      run: async () => ({ stdout: JSON.stringify(whoami) }),
      now: () => new Date('2026-11-11T17:07:38Z'),
    });
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ id: TODO }))]), {
      method: 'POST',
      headers: {},
    });
    const sent = { status: 0, body: '' };
    const res = {
      headersSent: false,
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    const ctx = { brain, store: { get: async () => ({ directWrites }) }, log: () => {} };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL('http://127.0.0.1:3877/api/todos/complete'),
      ctx as unknown as RouteContext,
    );
    return { root, sent };
  }

  it('records the person using the app as the one who ticked it', async () => {
    const { root, sent } = await tick(true);
    expect(sent.status).toBe(200);
    expect(existsSync(join(root, 'todo', TODO))).toBe(false);
    const done = readFileSync(join(root, 'todo', 'done', TODO), 'utf8');
    expect(done).toContain('\ncompleted_at: 2026-11-11T17:07:38+00:00\ncompleted_by: sam-example\n');
    expect(done).toContain('Ticked off by Sam Example at 17:07 UK time (TDS Brain App).');
    expect(JSON.parse(sent.body).mine.map((t: { id: string }) => t.id)).not.toContain(TODO);
  });

  it('changes nothing while changes to the shared brain are switched off', async () => {
    const { root, sent } = await tick(false);
    expect(sent.status).toBe(403);
    expect(existsSync(join(root, 'todo', TODO))).toBe(true);
    expect(existsSync(join(root, 'todo', 'done', TODO))).toBe(false);
  });
});

describe('library routes', () => {
  type Sent = { status: number; headers: Record<string, string | number>; body: Buffer };

  function setup() {
    const root = copyFixture();
    const dataDir = mkdtempSync(join(tmpdir(), 'tba-routes-'));
    tempDirs.push(dataDir);
    const ctx = {
      brain: createBrainReaders(root),
      thumbs: createThumbnailer(dataDir, { brainRoot: root }),
      log: () => {},
    } as unknown as RouteContext;
    return { root, ctx };
  }

  async function call(ctx: RouteContext, path: string, method = 'GET'): Promise<Sent> {
    const req = Object.assign(Readable.from([]), { method, headers: {} });
    const sent: Sent = { status: 0, headers: {}, body: Buffer.alloc(0) };
    const res = {
      headersSent: false,
      setHeader(name: string, value: string | number) {
        sent.headers[name.toLowerCase()] = value;
      },
      writeHead(status: number, headers: Record<string, string | number> = {}) {
        sent.status = status;
        for (const [k, v] of Object.entries(headers)) sent.headers[k.toLowerCase()] = v;
        res.headersSent = true;
      },
      end(body?: string | Buffer) {
        if (body !== undefined) sent.body = Buffer.isBuffer(body) ? body : Buffer.from(body);
      },
    };
    // as the server does for every reply
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${path}`),
      ctx,
    );
    return sent;
  }

  const json = (s: Sent) => JSON.parse(s.body.toString('utf8'));

  async function idOf(ctx: RouteContext, name: string, scope = 'client:acme-heating'): Promise<string> {
    const listing = json(await call(ctx, ROUTES.library(scope))) as LibraryListing;
    const id = listing.items.find((i) => i.name === name)?.id;
    if (!id) throw new Error(`missing ${name}`);
    return id;
  }

  it('lists the scopes, and a scope', async () => {
    const { ctx } = setup();
    const scopes = await call(ctx, ROUTES.libraryScopes);
    expect(scopes.status).toBe(200);
    expect(json(scopes).map((s: { id: string }) => s.id)).toEqual([
      'personal',
      'client:acme-heating',
      'client:northwind',
    ]);
    const listing = await call(ctx, ROUTES.library('client:acme-heating'));
    expect(listing.status).toBe(200);
    expect(json(listing).groups[0]).toBe('Reports');
    expect(listing.headers['cache-control']).toBe('no-store');
  });

  it('answers 404 for a scope that is not listed and 400 when none is given', async () => {
    const { ctx } = setup();
    const missing = await call(ctx, ROUTES.library('client:../acme-heating'));
    expect(missing.status).toBe(404);
    expect(json(missing).error.code).toBe('not-found');
    expect((await call(ctx, '/api/library')).status).toBe(400);
    expect((await call(ctx, ROUTES.libraryScopes, 'POST')).status).toBe(405);
  });

  it('sends a WebP picture, cached for a year, for an image', async () => {
    const { ctx } = setup();
    const id = await idOf(ctx, 'logo.png');
    const sent = await call(ctx, ROUTES.libraryThumb(id, 96, '2026-11-11T00:00:00.000Z'));
    expect(sent.status).toBe(200);
    expect(sent.headers['content-type']).toBe('image/webp');
    expect(sent.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(sent.body.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('refuses a bad width, an unknown id, a document and a broken image', async () => {
    const { ctx } = setup();
    const logo = await idOf(ctx, 'logo.png');
    for (const w of ['97', '', '96abc', '0x60', '96.0', '-96']) {
      const sent = await call(ctx, `/api/library/thumb/${encodeURIComponent(logo)}?w=${w}`);
      expect(sent.status, w).toBe(400);
      expect(json(sent).error.code).toBe('bad-request');
      expect(sent.headers['cache-control']).toBe('no-store');
    }
    expect((await call(ctx, `/api/library/thumb/${encodeURIComponent(logo)}`)).status).toBe(400);
    const unknown = await call(
      ctx,
      ROUTES.libraryThumb('client:acme-heating.000000000000000000000000', 96, 'x'),
    );
    expect(unknown.status).toBe(404);
    expect((await call(ctx, '/api/library/thumb/%E0%A4%A?w=96')).status).toBe(404);
    const doc = await idOf(ctx, 'monthly-report.md');
    expect((await call(ctx, ROUTES.libraryThumb(doc, 96, 'x'))).status).toBe(400);
    const broken = await idOf(ctx, 'broken.png');
    const b = await call(ctx, ROUTES.libraryThumb(broken, 96, 'x'));
    expect(b.status).toBe(404);
    expect(b.headers['cache-control']).toBe('no-store');
  });

  it('sends a note as text without its frontmatter, and refuses other views', async () => {
    const { ctx } = setup();
    const note = await idOf(ctx, '2026-11-01-call-follow-up.md');
    const sent = await call(ctx, ROUTES.libraryText(note));
    expect(sent.status).toBe(200);
    expect(json(sent)).toEqual({ text: '# Not this heading\n\nBody text.\n', truncated: false });
    expect(sent.headers['cache-control']).toBe('no-store');
    const loose = json(await call(ctx, ROUTES.libraryText(await idOf(ctx, 'loose-note.txt'))));
    expect(loose).toEqual({ text: 'A loose note in the client root.\n', truncated: false });
    expect((await call(ctx, ROUTES.libraryText(await idOf(ctx, 'logo.png')))).status).toBe(400);
    expect((await call(ctx, ROUTES.libraryText(await idOf(ctx, 'page.html')))).status).toBe(400);
    expect((await call(ctx, ROUTES.libraryText('personal.000000000000000000000000'))).status).toBe(404);
  });

  it('sends long text cut at 1 MB on a character boundary, marked truncated', async () => {
    const { root, ctx } = setup();
    // 'é' is two bytes: 1 MB + 1 byte in, so the cut falls inside a character
    writeFileSync(join(root, 'clients/acme-heating/notes/long.md'), `x${'é'.repeat(600_000)}`);
    const sent = await call(ctx, ROUTES.libraryText(await idOf(ctx, 'long.md')));
    expect(sent.status).toBe(200);
    const body = json(sent) as { text: string; truncated: boolean };
    expect(body.truncated).toBe(true);
    expect(body.text).not.toContain('\uFFFD');
    expect(Buffer.byteLength(body.text)).toBe(1024 * 1024 - 1);
  });

  it('sends an HTML page under its own sandboxed policy', async () => {
    const { root, ctx } = setup();
    const id = await idOf(ctx, 'page.html');
    const sent = await call(ctx, ROUTES.libraryPage(id));
    expect(sent.status).toBe(200);
    expect(sent.headers['content-security-policy']).toBe(PAGE_CSP);
    expect(sent.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(sent.headers['x-content-type-options']).toBe('nosniff');
    expect(
      sent.body.equals(readFileSync(join(root, 'clients/acme-heating/landing-pages/boiler/page.html'))),
    ).toBe(true);
    const personal = await call(ctx, ROUTES.libraryPage(await idOf(ctx, 'explainer.html', 'personal')));
    expect(personal.status).toBe(200);
  });

  it('answers page errors as a small HTML page under the same policy, never JSON', async () => {
    const { ctx } = setup();
    const cases: [string, number, string][] = [
      [ROUTES.libraryPage(await idOf(ctx, 'monthly-report.md')), 400, 'GET'],
      [ROUTES.libraryPage('client:acme-heating.000000000000000000000000'), 404, 'GET'],
      ['/api/library/page/%E0%A4%A', 404, 'GET'],
      [ROUTES.libraryPage(await idOf(ctx, 'page.html')), 405, 'POST'],
    ];
    for (const [path, status, method] of cases) {
      const sent = await call(ctx, path, method);
      expect(sent.status, path).toBe(status);
      expect(sent.headers['content-security-policy']).toBe(PAGE_CSP);
      expect(sent.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(sent.headers['cache-control']).toBe('no-store');
      expect(sent.body.toString('utf8')).toMatch(/^<!doctype html>/);
    }
  });

  /** Like `call`, but the reply is a real stream, as a download is piped into it. */
  async function download(ctx: RouteContext, path: string, method = 'GET'): Promise<Sent> {
    const req = Object.assign(Readable.from([]), { method, headers: {} });
    const sent: Sent = { status: 0, headers: {}, body: Buffer.alloc(0) };
    const chunks: Buffer[] = [];
    const res = Object.assign(
      new Writable({
        write(chunk: Buffer, _enc, done) {
          chunks.push(chunk);
          done();
        },
      }),
      {
        headersSent: false,
        setHeader(name: string, value: string | number) {
          sent.headers[name.toLowerCase()] = value;
        },
        writeHead(status: number, headers: Record<string, string | number> = {}) {
          sent.status = status;
          for (const [k, v] of Object.entries(headers)) sent.headers[k.toLowerCase()] = v;
          res.headersSent = true;
        },
      },
    );
    const end = res.end.bind(res);
    res.end = ((body?: string | Buffer) => {
      if (body !== undefined) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
      return end();
    }) as typeof res.end;
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL(`http://127.0.0.1:3877${path}`),
      ctx,
    );
    sent.body = Buffer.concat(chunks);
    return sent;
  }

  it('sends any listed file as a download, byte for byte, never shown in the app', async () => {
    const { root, ctx } = setup();
    const cases: [string, string, string][] = [
      ['logo.png', 'client:acme-heating', 'clients/acme-heating/context/brand/logo.png'],
      ['page.html', 'client:acme-heating', 'clients/acme-heating/landing-pages/boiler/page.html'],
      ['explainer.html', 'personal', 'personal/explainer.html'],
    ];
    for (const [name, scope, rel] of cases) {
      const sent = await download(ctx, ROUTES.libraryFile(await idOf(ctx, name, scope)));
      expect(sent.status, name).toBe(200);
      expect(sent.headers['content-type']).toBe('application/octet-stream');
      expect(sent.headers['content-disposition']).toBe(
        `attachment; filename="${name}"; filename*=UTF-8''${name}`,
      );
      expect(sent.headers['x-content-type-options']).toBe('nosniff');
      expect(sent.headers['cache-control']).toBe('no-store');
      expect(sent.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
      const disk = readFileSync(join(root, rel));
      expect(sent.headers['content-length']).toBe(disk.length);
      expect(sent.body.equals(disk), name).toBe(true);
    }
  });

  it('names a download safely when the file name has quotes or letters outside plain ASCII', async () => {
    const { root, ctx } = setup();
    writeFileSync(join(root, 'clients/acme-heating/notes/Café "plan" 100%.md'), 'x');
    const sent = await download(ctx, ROUTES.libraryFile(await idOf(ctx, 'Café "plan" 100%.md')));
    expect(sent.status).toBe(200);
    expect(sent.headers['content-disposition']).toBe(
      `attachment; filename="Caf_ _plan_ 100%.md"; filename*=UTF-8''Caf%C3%A9%20%22plan%22%20100%25.md`,
    );
    expect(sent.body.toString('utf8')).toBe('x');
  });

  it('sends an empty file as an empty download', async () => {
    const { root, ctx } = setup();
    writeFileSync(join(root, 'clients/acme-heating/notes/empty.txt'), '');
    const sent = await download(ctx, ROUTES.libraryFile(await idOf(ctx, 'empty.txt')));
    expect(sent.status).toBe(200);
    expect(sent.headers['content-length']).toBe(0);
    expect(sent.body.length).toBe(0);
  });

  it('sends a PDF to be shown in the browser’s own reader, under its own policy', async () => {
    const { root, ctx } = setup();
    const sent = await download(ctx, ROUTES.libraryPdf(await idOf(ctx, '2026-10-summary.pdf')));
    expect(sent.status).toBe(200);
    expect(sent.headers['content-type']).toBe('application/pdf');
    expect(sent.headers['content-disposition']).toBe(
      `inline; filename="2026-10-summary.pdf"; filename*=UTF-8''2026-10-summary.pdf`,
    );
    expect(sent.headers['x-content-type-options']).toBe('nosniff');
    expect(sent.headers['cache-control']).toBe('no-store');
    expect(sent.headers['content-security-policy']).toBe(PDF_CSP);
    const disk = readFileSync(join(root, 'clients/acme-heating/reports/2026-10-summary.pdf'));
    expect(sent.headers['content-length']).toBe(disk.length);
    expect(sent.body.equals(disk)).toBe(true);
  });

  it('refuses to show a file named .pdf that is not a PDF, and anything that is not a PDF', async () => {
    const { root, ctx } = setup();
    writeFileSync(
      join(root, 'clients/acme-heating/reports/fake.pdf'),
      '<!doctype html><script>alert(1)</script>',
    );
    const cases: [string, number, string][] = [
      [ROUTES.libraryPdf(await idOf(ctx, 'fake.pdf')), 400, 'GET'],
      [ROUTES.libraryPdf(await idOf(ctx, 'page.html')), 400, 'GET'],
      [ROUTES.libraryPdf('client:acme-heating.000000000000000000000000'), 404, 'GET'],
      ['/api/library/pdf/%E0%A4%A', 404, 'GET'],
      [ROUTES.libraryPdf(await idOf(ctx, '2026-10-summary.pdf')), 405, 'POST'],
    ];
    for (const [path, status, method] of cases) {
      const sent = await download(ctx, path, method);
      expect(sent.status, path).toBe(status);
      // The frame shows the error, so it is a small page under the sandboxed page policy.
      expect(sent.headers['content-security-policy']).toBe(PAGE_CSP);
      expect(sent.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(sent.body.toString('utf8')).not.toContain('<script>');
    }
  });

  it('refuses a download for an unknown id, a bad id, a file gone since listing, and a POST', async () => {
    const { root, ctx } = setup();
    const unknown = await download(ctx, ROUTES.libraryFile('client:acme-heating.000000000000000000000000'));
    expect(unknown.status).toBe(404);
    expect(unknown.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(unknown.body.toString('utf8')).error.code).toBe('not-found');
    expect((await download(ctx, '/api/library/file/%E0%A4%A')).status).toBe(404);
    const id = await idOf(ctx, 'loose-note.txt');
    expect((await download(ctx, ROUTES.libraryFile(id), 'POST')).status).toBe(405);
    rmSync(join(root, 'clients/acme-heating/loose-note.txt'));
    expect((await download(ctx, ROUTES.libraryFile(id))).status).toBe(404);
  });

  it('refuses a page that has grown past its cap since it was listed', async () => {
    const { root, ctx } = setup();
    const id = await idOf(ctx, 'page.html');
    writeFileSync(
      join(root, 'clients/acme-heating/landing-pages/boiler/page.html'),
      Buffer.alloc(5 * 1024 * 1024 + 1, 0x61),
    );
    const sent = await call(ctx, ROUTES.libraryPage(id));
    expect(sent.status).toBe(400);
    expect(sent.headers['content-security-policy']).toBe(PAGE_CSP);
  });
});
