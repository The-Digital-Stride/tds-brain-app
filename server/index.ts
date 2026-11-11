/**
 * `pnpm start`: start the local server, then open Chrome at the launch URL.
 *
 * Logs are short status lines only: never prompts, replies, tokens or cookie values.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { getSessionMessages, listSessions, query } from '@anthropic-ai/claude-agent-sdk';
import { APP_HOST, type EngineHealth } from '../shared/contract.ts';
import { createBrainReaders } from './brain/index.ts';
import { resolveConfig } from './config.ts';
import { createSessionManager, type EngineFns } from './engine/session-manager.ts';
import { AUTH_PING_PATH, pingProof, safeEqual } from './http/security.ts';
import { createAppServer } from './http/server.ts';
import { createAppStore } from './store/app-store.ts';

const noOpen = process.argv.slice(2).includes('--no-open');

function log(line: string): void {
  console.log(`[tds-brain] ${line}`);
}

function openBrowser(url: string): void {
  if (noOpen) return;
  if (process.platform === 'darwin') {
    const chrome = spawn('open', ['-a', 'Google Chrome', url], { stdio: 'ignore' });
    const fallback = () => spawn('open', [url], { stdio: 'ignore' }).on('error', () => {});
    chrome.on('error', fallback);
    chrome.on('exit', (code) => {
      if (code !== 0) fallback();
    });
    return;
  }
  // No reliable way to pick Chrome elsewhere yet: the person opens the link themselves.
  console.log(`Open this link in Chrome to use TDS Brain:\n${url}`);
}

const config = resolveConfig();
const appUrl = `http://${APP_HOST}:${config.port}`;
const authUrl = `${appUrl}/auth?token=${encodeURIComponent(config.launchToken)}`;

/** Asks the app already on the port to prove it holds our launch token, before the token goes anywhere. */
async function isOurServerRunning(): Promise<boolean> {
  const nonce = randomBytes(18).toString('base64url');
  try {
    const res = await fetch(`${appUrl}${AUTH_PING_PATH}?nonce=${nonce}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    return safeEqual((await res.text()).trim(), pingProof(config.launchToken, nonce));
  } catch {
    return false;
  }
}

const engineHealth: EngineHealth = config.claudePath
  ? { ok: true, claudePath: config.claudePath, problem: null }
  : {
      ok: false,
      claudePath: null,
      problem: 'Claude Code is not installed on this computer, or the app cannot find it.',
    };

const engine: EngineFns = {
  query: (params) => query(params),
  listSessions: (opts) => listSessions(opts),
  getSessionMessages: (id, opts) => getSessionMessages(id, opts),
};

const brain = createBrainReaders(config.brainPath);
const store = createAppStore(config.dataDir);
const sessions = createSessionManager({
  brain,
  brainRoot: config.brainPath,
  claudePath: config.claudePath,
  engine,
  env: process.env,
  log,
});

const app = createAppServer({
  port: config.port,
  clientDir: config.clientDir,
  launchToken: config.launchToken,
  appVersion: config.appVersion,
  brain,
  store,
  sessions,
  engineHealth,
  log,
});

app.server.on('error', (err: NodeJS.ErrnoException) => {
  app.stop();
  if (err.code === 'EADDRINUSE') {
    void isOurServerRunning().then((ours) => {
      if (ours) {
        log(`TDS Brain is already running at ${appUrl}. Opening it.`);
        openBrowser(authUrl);
        setTimeout(() => process.exit(0), 1500).unref();
      } else {
        // Never send the launch token to some other program that happens to hold the port.
        log(
          `Port ${config.port} is in use by another program. Set TDS_BRAIN_APP_PORT to a free port and try again.`,
        );
        process.exit(1);
      }
    });
    return;
  }
  log(`Could not start the server (${err.code ?? 'unknown error'}).`);
  process.exit(1);
});

app.server.listen(config.port, APP_HOST, () => {
  log(`TDS Brain ${config.appVersion} is running at ${appUrl}`);
  log(config.claudePath ? 'Claude Code found.' : 'Claude Code was not found on this computer.');
  void brain.health().then(
    (h) => log(h.ok ? `Brain found at ${h.path}` : `Brain not ready at ${h.path}`),
    () => log('Could not check the brain folder.'),
  );
  openBrowser(authUrl);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Closing chats and stopping.');
  setTimeout(() => process.exit(1), 20_000).unref();
  app.stop();
  app.server.close();
  await sessions.closeAll().catch(() => {});
  app.server.closeAllConnections();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
