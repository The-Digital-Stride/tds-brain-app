/**
 * `pnpm start`: start the local server, then open Chrome with a one-time sign-in code (A15).
 *
 * Logs are short status lines only: never prompts, replies, tokens or cookie values.
 */
import { homedir } from 'node:os';
import { getSessionMessages, listSessions, query } from '@anthropic-ai/claude-agent-sdk';
import { APP_HOST } from '../shared/contract.ts';
import type { BrainDecision, BrainRefusal } from '../shared/install-contract.ts';
import { appStateFor, decideBrain } from './brain/decide.ts';
import { createBrainReaders } from './brain/index.ts';
import { checkBrain, findBrainCandidates } from './brain/locate.ts';
import { createThumbnailer, QUICK_LOOK_COMMAND, quickLookAvailable } from './brain/thumbs.ts';
import { createChangelogReader } from './changelog.ts';
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
import { mergeSettings } from './settings.ts';
import {
  createEngineHealth,
  createSetupBrain,
  createSetupSessions,
  createSetupThumbs,
  createSetupUploads,
} from './setup-mode.ts';
import { createSetupService } from './setup-service.ts';
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

const home = homedir();
const brainCheckContext = { home, appRoot: config.appRoot, dataDir: config.dataDir };

// Decided once, and checked, before anything that touches the brain is built (setup-screen plan,
// decision 1). Only a `ready` decision's path is ever handed to brain code.
const decision: BrainDecision = await decideBrain(config.brainCandidate, (p) =>
  checkBrain(p, brainCheckContext),
);
const brainPath = decision.kind === 'ready' ? decision.path : null;

const engine: EngineFns = {
  query: (params) => query(params),
  listSessions: (opts) => listSessions(opts),
  getSessionMessages: (id, opts) => getSessionMessages(id, opts),
};

const store = createAppStore(config.dataDir);

/**
 * The real readers, thumbnailer, upload staging and session manager on a checked brain; in setup mode,
 * stand-ins that read nothing and can never start Claude (decision 2).
 */
function buildBrainSide(path: string | null) {
  if (path === null) {
    return {
      brain: createSetupBrain(),
      thumbs: createSetupThumbs(),
      uploads: createSetupUploads(),
      sessions: createSetupSessions(),
    };
  }
  // Checked once, and the same answer given to both: the list offers document pictures only where they can be made.
  const quickLook = quickLookAvailable() ? { command: QUICK_LOOK_COMMAND } : null;
  const brain = createBrainReaders(path, { dataDir: config.dataDir, docThumbs: quickLook !== null });
  const thumbs = createThumbnailer(config.dataDir, { brainRoot: path, quickLook });
  // Off (root null) when the data folder and the brain overlap; it logs why. It sweeps only once
  // started, after `listen`: a second `pnpm start` that finds the port taken must leave it alone.
  const uploads = createUploadStaging({ dataDir: config.dataDir, brainRoot: path, log });
  const sessions = createSessionManager({
    brain,
    brainRoot: path,
    claudePath: config.claudePath,
    engine,
    env: process.env,
    log,
    uploads,
    dataDir: config.dataDir,
  });
  return { brain, thumbs, uploads, sessions };
}

const { brain, thumbs, uploads, sessions } = buildBrainSide(brainPath);
const engineHealth = createEngineHealth(brainPath, config.claudePath, home, resolvePermissionMode);

const setup = createSetupService({
  env: process.env,
  home,
  appRoot: config.appRoot,
  dataDir: config.dataDir,
  underService: config.underService,
  current: decision.kind === 'ready' ? { path: decision.path, source: decision.source } : null,
  openChats: async () => (await sessions.list()).live.length,
  checkBrain,
  findBrainCandidates,
  mergeSettings,
  log,
  restart: () => void shutdown(),
});

const app = createAppServer({
  port: config.port,
  clientDir: config.clientDir,
  launchToken: config.launchToken,
  authCodes,
  appVersion: config.appVersion,
  changelog: createChangelogReader(config.appRoot),
  underService: config.underService,
  brain,
  store,
  sessions,
  thumbs,
  uploads,
  engineHealth,
  appState: appStateFor(decision),
  setup,
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
  logBrainDecision(decision);
  if (!noOpen) {
    const code = authCodes.mint();
    if (code) openBrowser(signInUrl(config.port, code));
  }
});

const FROM = { env: 'from TDS_BRAIN_PATH', settings: 'from settings', default: 'the default' } as const;
const REFUSAL_LOG: Record<BrainRefusal, string> = {
  'not-absolute': 'not a full path',
  'not-found': 'no folder there',
  'outside-home': 'outside the home folder',
  'is-app-folder': 'the app folder',
  'is-data-folder': 'the data folder',
  'protected-folder': 'macOS refused access',
  'missing-roles': 'no .team-config/roles.json',
  'missing-whoami': 'no tools/whoami.cjs',
  'not-a-repo': 'not a git folder',
};

function logBrainDecision(d: BrainDecision): void {
  if (d.kind === 'ready') {
    const from = FROM[d.source];
    void brain.health().then(
      (h) => log(h.ok ? `Brain found at ${h.path} (${from})` : `Brain not ready at ${h.path} (${from})`),
      () => log('Could not check the brain folder.'),
    );
    return;
  }
  if (d.tried === null || d.source === null || d.reason === null) {
    log('No brain folder chosen yet. Waiting for one to be chosen in the app; Claude is off.');
    return;
  }
  log(
    `Brain folder ${JSON.stringify(d.tried)} (${FROM[d.source]}) can't be used (${REFUSAL_LOG[d.reason]}). Waiting for one to be chosen in the app; Claude is off.`,
  );
}

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
