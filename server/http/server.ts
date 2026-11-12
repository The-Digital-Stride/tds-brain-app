/**
 * The one local server (decision 2): the built client and the API on 127.0.0.1 only.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import {
  APP_HOST,
  APP_NAME,
  type AppStore,
  type BrainReaders,
  type EngineHealth,
  type Thumbnailer,
} from '../../shared/contract.ts';
import type { SessionManager } from '../engine/session-manager.ts';
import type { UploadStaging } from '../uploads/staging.ts';
import { handleApi, sendError, sendPageError } from './routes.ts';
import {
  type AuthCodes,
  authExchange,
  checkRequest,
  isLibraryPagePath,
  pingProof,
  SECURITY_HEADERS,
} from './security.ts';
import { type AppEventHub, createAppEventHub } from './stream.ts';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A tiny page with no scripts or styles (the CSP forbids inline ones anyway). */
function plainPage(heading: string, paragraphs: string[]): string {
  return `<!doctype html>
<html lang="en-GB">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(APP_NAME)}</title></head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
</main>
</body>
</html>
`;
}

function sendHtml(res: ServerResponse, status: number, html: string, method: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(method === 'HEAD' ? undefined : html);
}

export const LAUNCHER_PAGE = plainPage('Open TDS Brain from its launcher', [
  'This page was opened without signing in. If you started it yourself, start it again and it will open in Chrome.',
]);

const NOT_BUILT_PAGE = plainPage('TDS Brain is not quite ready', [
  'Its screens have not been set up on this computer yet. Ask whoever looks after the brain to finish setting it up.',
]);

async function fileIfExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Serves the built client with path-traversal protection and an SPA fallback to index.html. */
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  clientDir: string,
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    sendError(res, 405, 'bad-request', 'That is not something this address does.');
    return;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendHtml(res, 400, plainPage('That address is not valid', []), method);
    return;
  }
  const root = resolve(clientDir);
  const segments = decoded.split('/').filter(Boolean);
  const unsafe = decoded.includes('\0') || decoded.includes('\\') || segments.some((s) => s.startsWith('.'));
  const target = resolve(root, ...segments);
  const inside = target === root || target.startsWith(root + sep);

  let file: string | null = null;
  if (!unsafe && inside && target !== root && (await fileIfExists(target))) {
    file = target;
  } else if (unsafe || !inside || extname(decoded) !== '') {
    sendHtml(res, 404, plainPage('Page not found', ['There is nothing at that address.']), method);
    return;
  }
  if (!file) {
    const index = resolve(root, 'index.html');
    if (!(await fileIfExists(index))) {
      sendHtml(res, 503, NOT_BUILT_PAGE, method);
      return;
    }
    file = index;
  }

  const ext = extname(file).toLowerCase();
  const info = await stat(file);
  const immutable = file.startsWith(resolve(root, 'assets') + sep);
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

export interface ServerDeps {
  port: number;
  clientDir: string;
  launchToken: string;
  /** Single-use sign-in codes (A15). */
  authCodes: AuthCodes;
  appVersion: string;
  brain: BrainReaders;
  store: AppStore;
  sessions: SessionManager;
  /** The library's small pictures, cached in the app's data folder. */
  thumbs: Thumbnailer;
  /** Chat attachments waiting in the app's data folder. */
  uploads: UploadStaging;
  /** Built per request: the permission mode is read afresh (A18). */
  engineHealth: () => EngineHealth;
  log?: (line: string) => void;
}

export interface AppServer {
  server: Server;
  hub: AppEventHub;
  /** Stops watching the brain and the chats; does not close the socket. */
  stop(): void;
}

export function createAppServer(deps: ServerDeps): AppServer {
  const log = deps.log ?? (() => {});
  const hub = createAppEventHub();
  const serverStartedAt = new Date().toISOString();

  const stopWatch = deps.brain.watch((area) => hub.publish({ type: 'brain-changed', area }));
  // Chats change state many times a turn; tell the page at most every 150 ms.
  let pendingChange: ReturnType<typeof setTimeout> | null = null;
  const stopSessions = deps.sessions.onChange(() => {
    if (pendingChange) return;
    pendingChange = setTimeout(() => {
      pendingChange = null;
      hub.publish({ type: 'sessions-changed' });
    }, 150);
  });

  const routeCtx = {
    brain: deps.brain,
    store: deps.store,
    sessions: deps.sessions,
    thumbs: deps.thumbs,
    uploads: deps.uploads,
    hub,
    engineHealth: deps.engineHealth,
    appVersion: deps.appVersion,
    serverStartedAt,
    log,
  };

  const server = createServer((req, res) => {
    // The library page route answers in HTML under its own policy, errors included.
    let pageRoute = false;
    void (async () => {
      const method = (req.method ?? 'GET').toUpperCase();
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
      let url: URL;
      try {
        url = new URL(req.url ?? '/', `http://${APP_HOST}:${deps.port}`);
      } catch {
        sendError(res, 400, 'bad-request', 'That address is not valid.');
        return;
      }
      const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
      pageRoute = isLibraryPagePath(url.pathname);
      const decision = checkRequest(
        { method, path: url.pathname, headers: req.headers },
        { port: deps.port, launchToken: deps.launchToken },
      );
      switch (decision.action) {
        case 'reject':
          if (pageRoute) sendPageError(res, decision.status, decision.message);
          else if (isApi) sendError(res, decision.status, decision.code, decision.message);
          else
            sendHtml(
              res,
              decision.status,
              plainPage('TDS Brain could not open that', [decision.message]),
              method,
            );
          return;
        case 'launcher':
          sendHtml(res, 401, LAUNCHER_PAGE, method);
          return;
        case 'ping': {
          const nonce = url.searchParams.get('nonce') ?? '';
          if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
            sendError(res, 400, 'bad-request', 'That check was not understood.');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(pingProof(deps.launchToken, nonce));
          return;
        }
        case 'auth-code': {
          const issued = deps.authCodes.issueForLauncher(
            url.searchParams.get('nonce'),
            url.searchParams.get('proof'),
          );
          if (!issued.ok) {
            sendError(res, issued.status, issued.code, issued.message);
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(issued.code);
          return;
        }
        case 'auth': {
          // Only a single-use code works here; the old `?token=` is ignored (A15).
          const result = authExchange(url.searchParams.get('code'), deps.authCodes, deps.launchToken);
          if (!result.ok) {
            sendHtml(res, 403, LAUNCHER_PAGE, method);
            return;
          }
          res.writeHead(303, { 'Set-Cookie': result.setCookie, Location: '/', 'Cache-Control': 'no-store' });
          res.end();
          return;
        }
        case 'allow':
          if (isApi) await handleApi(req, res, url, routeCtx);
          else await serveStatic(req, res, url.pathname, deps.clientDir);
          return;
      }
    })().catch(() => {
      log('A request failed unexpectedly.');
      if (!res.headersSent && pageRoute) sendPageError(res, 500, 'Something went wrong in the app.');
      else if (!res.headersSent) sendError(res, 500, 'internal', 'Something went wrong in the app.');
      else res.end();
    });
  });

  return {
    server,
    hub,
    stop() {
      stopWatch();
      stopSessions();
      if (pendingChange) clearTimeout(pendingChange);
    },
  };
}
