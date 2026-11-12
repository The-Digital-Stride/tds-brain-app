/**
 * `pnpm start`: start the local server, then open Chrome with a one-time sign-in code (A15).
 *
 * Logs are short status lines only: never prompts, replies, tokens or cookie values.
 */
import { homedir } from 'node:os';
import { getSessionMessages, listSessions, query } from '@anthropic-ai/claude-agent-sdk';
import { APP_HOST, type EngineHealth } from '../shared/contract.ts';
import { createBrainReaders } from './brain/index.ts';
import { createThumbnailer, QUICK_LOOK_COMMAND, quickLookAvailable } from './brain/thumbs.ts';
import { resolveConfig } from './config.ts';
import { resolvePermissionMode } from './engine/permission-mode.ts';
import { createSessionManager, type EngineFns } from './engine/session-manager.ts';
import { createAuthCodes } from './http/security.ts';
import { createAppServer } from './http/server.ts';
import {
  appUrl as appUrlFor,
  codeFromRunningServer,
  openBrowser as openLink,
  signInUrl,
} from './launcher.ts';
import { createAppStore } from './store/app-store.ts';
import { createUploadStaging } from './uploads/staging.ts';

const noOpen = process.argv.slice(2).includes('--no-open');

function log(line: string): void {
  console.log(`[tds-brain] ${line}`);
}

const config = resolveConfig();
const appUrl = appUrlFor(config.port);
const authCodes = createAuthCodes(config.launchToken);
const openBrowser = (url: string) => {
  if (!noOpen) openLink(url);
};

function engineHealth(): EngineHealth {
  const permissionMode = resolvePermissionMode(config.brainPath, homedir());
  return config.claudePath
    ? { ok: true, permissionMode, claudePath: config.claudePath, problem: null }
    : {
        ok: false,
        permissionMode,
        claudePath: null,
        problem: 'Claude Code is not installed on this computer, or the app cannot find it.',
      };
}

const engine: EngineFns = {
  query: (params) => query(params),
  listSessions: (opts) => listSessions(opts),
  getSessionMessages: (id, opts) => getSessionMessages(id, opts),
};

// Checked once, and the same answer given to both: the list offers document pictures only where they can be made.
const quickLook = quickLookAvailable() ? { command: QUICK_LOOK_COMMAND } : null;
const brain = createBrainReaders(config.brainPath, {
  dataDir: config.dataDir,
  docThumbs: quickLook !== null,
});
const thumbs = createThumbnailer(config.dataDir, { brainRoot: config.brainPath, quickLook });
const store = createAppStore(config.dataDir);
// Off (root null) when the data folder and the brain overlap; it logs why. It sweeps only once
// started, after `listen`: a second `pnpm start` that finds the port taken must leave it alone.
const uploads = createUploadStaging({ dataDir: config.dataDir, brainRoot: config.brainPath, log });
const sessions = createSessionManager({
  brain,
  brainRoot: config.brainPath,
  claudePath: config.claudePath,
  engine,
  env: process.env,
  log,
  uploads,
  dataDir: config.dataDir,
});

const app = createAppServer({
  port: config.port,
  clientDir: config.clientDir,
  launchToken: config.launchToken,
  authCodes,
  appVersion: config.appVersion,
  brain,
  store,
  sessions,
  thumbs,
  uploads,
  engineHealth,
  log,
});

app.server.on('error', (err: NodeJS.ErrnoException) => {
  app.stop();
  uploads.close();
  if (err.code === 'EADDRINUSE') {
    void codeFromRunningServer(config.port, config.launchToken).then((code) => {
      if (code) {
        log(`TDS Brain is already running at ${appUrl}. Opening it.`);
        openBrowser(signInUrl(config.port, code));
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
  uploads.start();
  log(`TDS Brain ${config.appVersion} is running at ${appUrl}`);
  log(config.claudePath ? 'Claude Code found.' : 'Claude Code was not found on this computer.');
  void brain.health().then(
    (h) => log(h.ok ? `Brain found at ${h.path}` : `Brain not ready at ${h.path}`),
    () => log('Could not check the brain folder.'),
  );
  if (!noOpen) {
    const code = authCodes.mint();
    if (code) openBrowser(signInUrl(config.port, code));
  }
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Closing chats and stopping.');
  setTimeout(() => process.exit(1), 20_000).unref();
  app.stop();
  uploads.close();
  app.server.close();
  await sessions.closeAll().catch(() => {});
  app.server.closeAllConnections();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
