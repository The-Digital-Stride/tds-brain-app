import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BrainReaders, type ChatEvent, ROUTES, sessionCookieName } from '../../shared/contract.ts';
import { createBrainReaders } from '../brain/index.ts';
import { copyFixture } from '../brain/test-helpers.ts';
import { createSessionManager, type EngineFns, type SessionManager } from '../engine/session-manager.ts';
import { createPageCopies } from '../store/page-copies.ts';
import { cookieValueFor, createAuthCodes, PAGE_PREVIEW_CSP } from './security.ts';
import { type AppServer, createAppServer } from './server.ts';

/**
 * A page written in a fake chat turn, served, versioned, branded and asked about through the real
 * routes and `checkRequest` (the request gate): the way the browser uses them, not just the parts.
 */

const PORT = 45878;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://${HOST}`;
const TOKEN = 'launch-token-pages-e2e';
const COOKIE = `${sessionCookieName(PORT)}=${cookieValueFor(TOKEN)}`;
/** The policy a download is served under (`server/http/routes.ts`, not exported). */
const DOWNLOAD_CSP = "sandbox; default-src 'none'";
const PAGE = '<!doctype html><html><head><title>Budget plan</title></head><body><p>Hello</p></body></html>';

class FakeQuery implements AsyncIterable<unknown> {
  sid = '33333333-2222-4333-8444-555555555555';
  ended = false;
  private queue: unknown[] = [];
  private wake: (() => void) | null = null;
  emit(msg: unknown): void {
    this.queue.push(msg);
    this.wake?.();
  }
  async interrupt(): Promise<undefined> {
    return undefined;
  }
  close(): void {
    this.ended = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift();
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((r) => {
        this.wake = r;
      });
      this.wake = null;
    }
  }
}

let dir: string;
let brainDir: string;
let clientDir: string;
let sourceFile: string;
let app: AppServer;
let sessions: SessionManager;
let listenPort: number;
let turns = 0;

/** Turn 0 writes the page (the file is on disk, then the Write is reported); later turns just reply. */
const engine: EngineFns = {
  query: ({ prompt }: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    const q = new FakeQuery();
    void (async () => {
      for await (const _ of prompt) {
        const turn = turns++;
        q.emit({
          type: 'system',
          subtype: 'init',
          session_id: q.sid,
          model: 'claude-test',
          claude_code_version: '2.1.322',
          apiKeySource: 'none',
        });
        if (turn === 0) {
          writeFileSync(sourceFile, PAGE);
          q.emit({
            type: 'assistant',
            message: {
              id: 'm-w1',
              content: [
                {
                  type: 'tool_use',
                  id: 'w1',
                  name: 'Write',
                  input: { file_path: sourceFile, content: PAGE },
                },
              ],
            },
            parent_tool_use_id: null,
            session_id: q.sid,
          });
          q.emit({
            type: 'user',
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'ok' }] },
            parent_tool_use_id: null,
            session_id: q.sid,
          });
        }
        q.emit({
          type: 'assistant',
          message: { id: `m-${turn}`, content: [{ type: 'text', text: `Reply ${turn}` }] },
          parent_tool_use_id: null,
          session_id: q.sid,
        });
        q.emit({
          type: 'result',
          subtype: 'success',
          is_error: false,
          duration_ms: 1,
          result: 'ok',
          errors: [],
        });
      }
      q.close();
    })();
    return q as never;
  },
  listSessions: async () => [],
  getSessionMessages: async () => [],
};

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'tba-pages-e2e-')));
  brainDir = join(dir, 'brain');
  clientDir = join(dir, 'client');
  mkdirSync(brainDir);
  mkdirSync(clientDir);
  writeFileSync(join(clientDir, 'index.html'), '<!doctype html><title>the app</title>');
  sourceFile = join(brainDir, 'budget.html');

  const brain = {
    identity: async () => ({
      name: 'Test Person',
      slug: 'test-person',
      email: null,
      role: 'team',
      knownMember: true,
    }),
    skillAccess: async () => 'unknown-skill',
    clients: async () => [],
    todos: async () => ({
      mine: [],
      open: [],
      othersCount: 0,
      team: [],
      changes: 'no-skill',
      canAddOpen: false,
      canUsePersonal: false,
    }),
  } as unknown as Pick<BrainReaders, 'identity' | 'skillAccess' | 'clients' | 'todos' | 'libraryItemForPath'>;

  sessions = createSessionManager({
    brain,
    brainRoot: brainDir,
    claudePath: '/usr/local/bin/claude',
    engine,
    env: { PATH: '/bin', HOME: '/home/x' },
    permissionMode: () => 'default',
    engineDefaults: () => ({ model: null }),
    log: () => {},
    pageCopies: createPageCopies({
      dataDir: join(dir, 'data'),
      brainRoot: brainDir,
      roots: [brainDir],
      tmpRoot: join(dir, 'claude-tmp'),
    }),
  });

  app = createAppServer({
    port: PORT,
    clientDir,
    launchToken: TOKEN,
    authCodes: createAuthCodes(TOKEN),
    appVersion: '0',
    underService: false,
    brain: createBrainReaders(copyFixture()),
    store: {} as never,
    sessions,
    thumbs: {} as never,
    uploads: {} as never,
    engineHealth: () =>
      ({ ok: true, claudePath: '/bin/claude', problem: null, permissionMode: 'default' }) as never,
    appState: { kind: 'ready' },
    setup: {} as never,
  });
  await new Promise<void>((done) => app.server.listen(0, '127.0.0.1', done));
  listenPort = (app.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await sessions.closeAll();
  app.stop();
  await new Promise((done) => app.server.close(done));
  rmSync(dir, { recursive: true, force: true });
});

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; cookie?: boolean } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { host: HOST, ...opts.headers };
  if (opts.cookie !== false) headers.cookie = COOKIE;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: listenPort, path, method: opts.method ?? 'GET', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}, cookie = true) =>
  send(path, {
    method: 'POST',
    body: JSON.stringify(body),
    cookie,
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
  });

async function waitFor<T>(read: () => T | undefined | null | false): Promise<T> {
  for (let i = 0; i < 400; i++) {
    const v = read();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out');
}

function pageOf(id: string) {
  const sub = sessions.subscribe(id, 0, () => {});
  sub.unsubscribe();
  const files = sub.replay
    .map((s) => s.event as ChatEvent)
    .filter((e): e is Extract<ChatEvent, { type: 'files' }> => e.type === 'files');
  return files.at(-1)?.pages?.[0];
}

describe('a page written in a chat, through the request gate', () => {
  let id = '';
  let key = '';

  it('shows the page the turn wrote, as the in-progress copy', async () => {
    id = (await sessions.start({ prompt: 'Make a budget page' })).id;
    key = (await waitFor(() => pageOf(id)?.key)) as string;

    const r = await send(ROUTES.chatPage(id, key, 0));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.headers['content-security-policy']).toBe(PAGE_PREVIEW_CSP);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.startsWith('<!doctype html>')).toBe(true);
    expect(r.body).toContain('Budget plan');
  });

  it('keeps a numbered version after the next message, and serves it', async () => {
    // Nothing is numbered until the person's next message.
    expect((await send(ROUTES.chatPage(id, key, 1))).status).toBe(404);
    const ask = await post(ROUTES.chatPageAsk(id, key), { kind: 'change', note: 'Make the heading bigger' });
    expect(ask.status).toBe(200);
    expect(JSON.parse(ask.body)).toEqual({ ok: true });
    await waitFor(() => pageOf(id)?.versions.length === 1);

    const r = await send(ROUTES.chatPage(id, key, 1));
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.headers['content-security-policy']).toBe(PAGE_PREVIEW_CSP);
    expect(r.body.startsWith('<!doctype html>')).toBe(true);
    expect(r.body).toContain('Budget plan');
  });

  it('downloads the branded copy under the download policy', async () => {
    const r = await send(ROUTES.chatPageBranded(id, key, 1));
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toBe(DOWNLOAD_CSP);
    expect(r.headers['content-type']).toBe('application/octet-stream');
    expect(String(r.headers['content-disposition'])).toMatch(/^attachment;/);
    expect(['yes', 'partial']).toContain(r.headers['x-page-self-contained']);
    expect(r.body).toContain('Budget plan');
  });

  it('refuses requests that fail the gate, whatever the route', async () => {
    const pageUrl = ROUTES.chatPage(id, key, 1);
    // Not signed in: an API path is refused, never answered with the page.
    const noCookie = await send(pageUrl, { cookie: false });
    expect(noCookie.status).toBe(401);
    expect(noCookie.body).not.toContain('Budget plan');
    // Wrong Host (DNS rebinding) and a foreign Origin.
    expect((await send(pageUrl, { headers: { host: `localhost:${PORT}` } })).status).toBe(403);
    expect((await send(pageUrl, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await send(pageUrl, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await send(ROUTES.chatPageBranded(id, key, 1), { cookie: false })).status).toBe(401);
    // The change ask: signed out, from another site, or not JSON.
    const body = { kind: 'change', note: 'x' };
    expect((await post(ROUTES.chatPageAsk(id, key), body, {}, false)).status).toBe(401);
    expect((await post(ROUTES.chatPageAsk(id, key), body, { origin: 'https://evil.example' })).status).toBe(
      403,
    );
    const noOrigin = await send(ROUTES.chatPageAsk(id, key), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
    expect(noOrigin.status).toBe(403);
    const wrongType = await send(ROUTES.chatPageAsk(id, key), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { origin: ORIGIN, 'content-type': 'text/plain' },
    });
    expect(wrongType.status).toBe(415);
  });
});
